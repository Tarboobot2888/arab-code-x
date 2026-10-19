// Google ID token verification (plan: SEC-06).
//
// The audited version base64-decoded the JWT payload and trusted `email` without
// checking the signature, issuer, audience or expiry — anyone able to reach the
// callback with a self-made token could have signed in as any address.
//
// This module does the real thing with no new dependency:
//   1. fetch Google's JWKS (cached, with a timeout),
//   2. pick the key by `kid`, import it with node:crypto (JWK support),
//   3. jwt.verify() with algorithms RS256, the expected issuer and audience,
//      clock tolerance and mandatory exp/iat,
//   4. require email_verified === true and a non-empty email,
//   5. check `nonce` when the caller supplied one.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const JWKS_TIMEOUT_MS = parseInt(process.env.GOOGLE_JWKS_TIMEOUT_MS || '6000', 10);
const JWKS_TTL_MS = 60 * 60 * 1000;

let cache = { keys: null, fetchedAt: 0 };

class GoogleAuthError extends Error {
  constructor(message, code) { super(message); this.code = code || 'invalid_token'; }
}

async function fetchJwks(force) {
  if (!force && cache.keys && Date.now() - cache.fetchedAt < JWKS_TTL_MS) return cache.keys;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), JWKS_TIMEOUT_MS);
  try {
    const r = await fetch(JWKS_URL, { signal: ctl.signal });
    if (!r.ok) throw new GoogleAuthError(`JWKS fetch failed (${r.status})`, 'jwks_unavailable');
    const body = await r.json();
    if (!body || !Array.isArray(body.keys) || !body.keys.length) {
      throw new GoogleAuthError('JWKS response had no keys', 'jwks_unavailable');
    }
    cache = { keys: body.keys, fetchedAt: Date.now() };
    return cache.keys;
  } catch (e) {
    if (e instanceof GoogleAuthError) throw e;
    throw new GoogleAuthError(
      e && e.name === 'AbortError' ? 'JWKS fetch timed out' : `JWKS fetch error: ${e.message}`,
      'jwks_unavailable',
    );
  } finally {
    clearTimeout(timer);
  }
}

function decodeHeader(idToken) {
  const part = String(idToken || '').split('.')[0];
  if (!part) throw new GoogleAuthError('malformed token');
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new GoogleAuthError('malformed token header');
  }
}

function keyToPem(jwk) {
  // node:crypto imports a JWK directly — no third-party JWKS library needed.
  return crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
}

async function publicKeyFor(kid, retried) {
  const keys = await fetchJwks(!!retried);
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    // Google rotates keys; refetch once before giving up.
    if (!retried) return publicKeyFor(kid, true);
    throw new GoogleAuthError('signing key not found in Google JWKS');
  }
  return keyToPem(jwk);
}

/**
 * @param {string} idToken
 * @param {{clientId:string, nonce?:string|null}} opts
 * @returns {Promise<{email:string, sub:string, name:string|null, picture:string|null, claims:object}>}
 * @throws GoogleAuthError
 */
async function verifyIdToken(idToken, { clientId, nonce } = {}) {
  if (!idToken || typeof idToken !== 'string') throw new GoogleAuthError('missing id_token');
  if (!clientId) throw new GoogleAuthError('GOOGLE_CLIENT_ID is not configured', 'not_configured');

  const header = decodeHeader(idToken);
  if (header.alg !== 'RS256') throw new GoogleAuthError(`unexpected alg ${header.alg}`);
  if (!header.kid) throw new GoogleAuthError('token has no kid');

  const pem = await publicKeyFor(header.kid);

  let claims;
  try {
    claims = jwt.verify(idToken, pem, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: ISSUERS,
      clockTolerance: 60,
      // jsonwebtoken rejects an expired token by default; make exp mandatory too.
      ignoreExpiration: false,
    });
  } catch (e) {
    throw new GoogleAuthError(`signature/claims rejected: ${e.message}`);
  }
  if (!claims || typeof claims !== 'object') throw new GoogleAuthError('empty claims');
  if (!claims.exp) throw new GoogleAuthError('token has no exp');

  // Explicitly require a verified address — `!== false` used to let a missing
  // claim through, which is exactly the hole SEC-06 describes.
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new GoogleAuthError('email_verified is not true', 'email_unverified');
  }
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GoogleAuthError('no usable email claim');

  if (nonce && claims.nonce !== nonce) throw new GoogleAuthError('nonce mismatch', 'nonce_mismatch');

  return {
    email,
    sub: String(claims.sub || ''),
    name: claims.name ? String(claims.name).slice(0, 80) : null,
    picture: typeof claims.picture === 'string' && /^https:\/\//i.test(claims.picture)
      ? claims.picture.slice(0, 400)
      : null,
    claims,
  };
}

function _resetCache() { cache = { keys: null, fetchedAt: 0 }; }
function _seedCache(keys) { cache = { keys, fetchedAt: Date.now() }; }

module.exports = { verifyIdToken, GoogleAuthError, _resetCache, _seedCache, keyToPem, ISSUERS, JWKS_URL };
