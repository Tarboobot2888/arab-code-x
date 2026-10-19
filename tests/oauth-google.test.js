// Google ID-token verification (plan: SEC-06, SEC-10, 13 "تحقق Google OAuth").
//
// A real RSA keypair is generated per run and the JWKS fetch is stubbed, so the
// full verification path (signature, kid lookup, iss, aud, exp, nonce,
// email_verified) is exercised without any network access and without a real
// Google credential.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const h = require('./helpers/harness');

h.applyEnv();
const verifier = require('../api/_google_verify');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const KID = 'test-key-1';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

const otherPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function seed() { verifier._seedCache([jwk]); }

function idToken(claims = {}, { key = privateKey, kid = KID, alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    email: 'googleuser@example.invalid',
    email_verified: true,
    name: 'Google User',
    iat: now,
    exp: now + 3600,
    ...claims,
  };
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  return jwt.sign(payload, key, { algorithm: alg, keyid: kid, noTimestamp: true });
}

test('a correctly signed token is accepted', async () => {
  seed();
  const r = await verifier.verifyIdToken(idToken(), { clientId: CLIENT_ID });
  assert.equal(r.email, 'googleuser@example.invalid');
  assert.equal(r.sub, '1234567890');
  assert.equal(r.name, 'Google User');
});

test('an unsigned token (alg=none) is refused', async () => {
  seed();
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: KID })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, email: 'attacker@example.invalid',
    email_verified: true, exp: Math.floor(Date.now() / 1000) + 600,
  })).toString('base64url');
  await assert.rejects(
    () => verifier.verifyIdToken(`${header}.${body}.`, { clientId: CLIENT_ID }),
    /unexpected alg/,
  );
});

test('a token signed by a different key is refused', async () => {
  seed();
  const forged = idToken({ email: 'attacker@example.invalid' }, { key: otherPair.privateKey });
  await assert.rejects(
    () => verifier.verifyIdToken(forged, { clientId: CLIENT_ID }),
    /signature\/claims rejected/,
  );
});

test('a token whose kid is not in the JWKS is refused', async () => {
  seed();
  // Force the refetch path to return the same keyset, so the kid stays unknown.
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
  try {
    const forged = idToken({}, { kid: 'unknown-kid' });
    await assert.rejects(
      () => verifier.verifyIdToken(forged, { clientId: CLIENT_ID }),
      /signing key not found/,
    );
  } finally { global.fetch = originalFetch; }
});

test('a wrong audience is refused (token minted for another app)', async () => {
  seed();
  const other = idToken({ aud: 'someone-elses-client-id' });
  await assert.rejects(() => verifier.verifyIdToken(other, { clientId: CLIENT_ID }), /rejected/);
});

test('a wrong issuer is refused', async () => {
  seed();
  const bad = idToken({ iss: 'https://evil.example.invalid' });
  await assert.rejects(() => verifier.verifyIdToken(bad, { clientId: CLIENT_ID }), /rejected/);
});

test('an expired token is refused', async () => {
  seed();
  const now = Math.floor(Date.now() / 1000);
  const old = idToken({ iat: now - 7200, exp: now - 3600 });
  await assert.rejects(() => verifier.verifyIdToken(old, { clientId: CLIENT_ID }), /rejected/);
});

test('email_verified must be exactly true, not merely "not false"', async () => {
  seed();
  for (const value of [undefined, null, 0, '', 'maybe', false]) {
    const t = idToken({ email_verified: value });
    await assert.rejects(
      () => verifier.verifyIdToken(t, { clientId: CLIENT_ID }),
      (e) => e.code === 'email_unverified' || /rejected|email_verified/.test(e.message),
      `accepted email_verified=${JSON.stringify(value)}`,
    );
  }
});

test('a missing or malformed email claim is refused', async () => {
  seed();
  for (const email of [undefined, '', 'not-an-email', '   ']) {
    const t = idToken({ email });
    await assert.rejects(() => verifier.verifyIdToken(t, { clientId: CLIENT_ID }), /email|rejected/);
  }
});

test('a nonce mismatch is refused when a nonce was requested', async () => {
  seed();
  const t = idToken({ nonce: 'from-google' });
  await assert.rejects(
    () => verifier.verifyIdToken(t, { clientId: CLIENT_ID, nonce: 'what-we-sent' }),
    (e) => e.code === 'nonce_mismatch',
  );
  const good = await verifier.verifyIdToken(idToken({ nonce: 'match' }), { clientId: CLIENT_ID, nonce: 'match' });
  assert.equal(good.email, 'googleuser@example.invalid');
});

test('a non-https picture claim is dropped', async () => {
  seed();
  const r = await verifier.verifyIdToken(idToken({ picture: 'javascript:alert(1)' }), { clientId: CLIENT_ID });
  assert.equal(r.picture, null);
  const ok = await verifier.verifyIdToken(idToken({ picture: 'https://img.example.invalid/a.png' }), { clientId: CLIENT_ID });
  assert.equal(ok.picture, 'https://img.example.invalid/a.png');
});

test('verification refuses to run without a configured client id', async () => {
  seed();
  await assert.rejects(
    () => verifier.verifyIdToken(idToken(), { clientId: '' }),
    (e) => e.code === 'not_configured',
  );
});

test('garbage input is refused rather than parsed optimistically', async () => {
  seed();
  for (const bad of ['', 'not.a.jwt', 'a.b', null, undefined, 42, {}]) {
    await assert.rejects(() => verifier.verifyIdToken(bad, { clientId: CLIENT_ID }));
  }
});

// ---------------------------------------------------------------------------
// The callback route
// ---------------------------------------------------------------------------
function withStubbedGoogle(token, run) {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ id_token: token, access_token: 'a' }) };
    }
    if (u.includes('googleapis.com/oauth2/v3/certs')) {
      return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
    }
    throw new Error(`unexpected fetch to ${u}`);
  };
  return run().finally(() => { global.fetch = originalFetch; });
}

const callbackUrl = (state) => `/api/google-callback?code=auth-code&state=${state}`;

test('the callback creates an account with NO password and emails no credential', async () => {
  seed();
  const c = h.loadApi({ files: h.baseFiles() });
  await withStubbedGoogle(idToken({ email: 'newgoogle@example.invalid' }), async () => {
    const res = await h.call(c.routes['google-callback'], {
      method: 'GET',
      url: callbackUrl('state-abc'),
      headers: { cookie: 'g_state=state-abc; g_nonce=' },
    });
    assert.equal(res.statusCode, 302);
    const stored = c.store.json('data/users.json').users[0];
    assert.equal(stored.email, 'newgoogle@example.invalid');
    assert.equal(stored.provider, 'google');
    assert.equal(stored.password_hash, null, 'SEC-10: no local password may be generated');
    assert.equal(stored.verified, true);

    const welcome = c.mail.find((m) => m.kind === 'welcome');
    assert.ok(welcome, 'a welcome mail should be sent');
    const serialized = JSON.stringify(c.mail);
    assert.ok(!/password/i.test(serialized) || !welcome.password,
      'SEC-10: no password may ever be emailed');
    assert.equal(welcome.password, undefined);
  });
});

test('the callback refuses a state that does not match the cookie (CSRF)', async () => {
  seed();
  const c = h.loadApi({ files: h.baseFiles() });
  await withStubbedGoogle(idToken(), async () => {
    const res = await h.call(c.routes['google-callback'], {
      method: 'GET',
      url: callbackUrl('attacker-state'),
      headers: { cookie: 'g_state=the-real-state' },
    });
    assert.equal(res.statusCode, 302);
    assert.match(String(res.headers.location), /auth\?error=/);
    assert.equal(c.store.json('data/users.json').users.length, 0, 'no account may be created');
  });
});

test('the callback refuses when no state cookie is present at all', async () => {
  seed();
  const c = h.loadApi({ files: h.baseFiles() });
  await withStubbedGoogle(idToken(), async () => {
    const res = await h.call(c.routes['google-callback'], { method: 'GET', url: callbackUrl('x') });
    assert.match(String(res.headers.location), /auth\?error=/);
    assert.equal(c.store.json('data/users.json').users.length, 0);
  });
});

test('the callback refuses a forged id_token even with a valid state', async () => {
  seed();
  const c = h.loadApi({ files: h.baseFiles() });
  const forged = idToken({ email: 'admin@example.invalid' }, { key: otherPair.privateKey });
  await withStubbedGoogle(forged, async () => {
    const res = await h.call(c.routes['google-callback'], {
      method: 'GET', url: callbackUrl('s1'), headers: { cookie: 'g_state=s1' },
    });
    assert.match(String(res.headers.location), /auth\?error=/);
    assert.equal(c.store.json('data/users.json').users.length, 0,
      'a forged token must never create or sign into an account');
  });
});

test('the callback refuses a banned account', async () => {
  seed();
  const target = h.user({ username: 'gbanned', email: 'gbanned@example.invalid' });
  const c = h.loadApi({ files: h.baseFiles({ users: [target], bans: { gbanned: { banned: true, reason: 'x' } } }) });
  await withStubbedGoogle(idToken({ email: target.email }), async () => {
    const res = await h.call(c.routes['google-callback'], {
      method: 'GET', url: callbackUrl('s2'), headers: { cookie: 'g_state=s2' },
    });
    assert.match(decodeURIComponent(String(res.headers.location)), /محظور/);
    assert.ok(!res.cookies.session);
  });
});

test('the callback verifies an existing unverified account and clears its token', async () => {
  seed();
  const u = h.user({ username: 'pendg', email: 'pendg@example.invalid', verified: false });
  require('../api/_tokens').issue(u, 'verify');
  const c = h.loadApi({ files: h.baseFiles({ users: [u] }) });
  await withStubbedGoogle(idToken({ email: u.email }), async () => {
    const res = await h.call(c.routes['google-callback'], {
      method: 'GET', url: callbackUrl('s3'), headers: { cookie: 'g_state=s3' },
    });
    assert.equal(res.statusCode, 302);
    const stored = c.store.json('data/users.json').users[0];
    assert.equal(stored.verified, true);
    assert.ok(!stored.verification_token_hash, 'a pending verification token must be cleared');
    assert.ok(res.cookies.session, 'the member should be signed in');
  });
});

test('the callback respects signup_enabled=false for a new address', async () => {
  seed();
  const c = h.loadApi({ files: h.baseFiles({ settings: { signup_enabled: false } }) });
  await withStubbedGoogle(idToken({ email: 'blocked@example.invalid' }), async () => {
    const res = await h.call(c.routes['google-callback'], {
      method: 'GET', url: callbackUrl('s4'), headers: { cookie: 'g_state=s4' },
    });
    assert.match(String(res.headers.location), /auth\?error=/);
    assert.equal(c.store.json('data/users.json').users.length, 0);
  });
});

test('/api/google sets a state AND a nonce cookie', async () => {
  const c = h.loadApi({ files: h.baseFiles() });
  const res = await h.call(c.routes.google, { method: 'GET', url: '/api/google' });
  assert.equal(res.statusCode, 302);
  const location = new URL(String(res.headers.location));
  assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.ok(location.searchParams.get('state'));
  assert.ok(location.searchParams.get('nonce'), 'a nonce must be requested');
  const cookies = res.cookies;
  assert.equal(cookies.g_state, location.searchParams.get('state'));
  assert.equal(cookies.g_nonce, location.searchParams.get('nonce'));
  for (const c2 of [].concat(res.headers['set-cookie'])) {
    assert.match(c2, /HttpOnly/);
    assert.match(c2, /Secure/);
  }
});

test('/api/google is refused when the admin disabled Google sign-in', async () => {
  const c = h.loadApi({ files: h.baseFiles({ settings: { google_login_enabled: false } }) });
  const res = await h.call(c.routes.google, { method: 'GET', url: '/api/google' });
  assert.equal(res.statusCode, 403);
});

test('/api/google reports 503 when the credentials are not configured', async () => {
  const c = h.loadApi({ files: h.baseFiles(), env: { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' } });
  const res = await h.call(c.routes.google, { method: 'GET', url: '/api/google' });
  assert.equal(res.statusCode, 503);
});
