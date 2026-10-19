// Google sign-in.
//
// Fixes (plan: SEC-06, SEC-10):
//   * The ID token is verified for real (signature via Google's JWKS, issuer,
//     audience, expiry) in _google_verify.js. Nothing is read from an unverified
//     payload any more.
//   * email_verified must be exactly true.
//   * `state` is bound to an HttpOnly cookie and compared in constant time;
//     a `nonce` is sent to Google and checked in the returned token.
//   * No local password is generated and NO password is ever emailed. A Google
//     account signs in with Google; a local password is opt-in through the
//     ordinary reset flow.
//   * A banned account cannot obtain a session through this path either.
const crypto = require('crypto');
const {
  updateUsers, loadUsers, findUserByEmail, issueSession, USERNAME_RE,
  RESERVED_USERNAMES, isAdminEmail, appendCookie,
} = require('../_auth');
const { SKIP_WRITE } = require('../_gh');
const { sendWelcome } = require('../_mail');
const { getSettings } = require('../_settings');
const { verifyIdToken, GoogleAuthError } = require('../_google_verify');
const { config, baseUrl } = require('../_config');
const { safeEqual } = require('../_tokens');
const { wrap, methodGuard } = require('../_http');
const { enforce } = require('../_ratelimit');
const { banOf } = require('../_guard');

const STATE_COOKIE = 'g_state';
const NONCE_COOKIE = 'g_nonce';
const SHORT = 'HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600';

function redirectUri(req) { return `${baseUrl(req)}/api/google-callback`; }

function uniqueUsername(users, email) {
  let base = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (base.length < 3) base = `dev${base}`;
  base = base.slice(0, 16);
  if (!USERNAME_RE.test(base) || RESERVED_USERNAMES.has(base)) {
    base = `dev${crypto.randomInt(1000, 9999)}`;
  }
  const taken = new Set(users.map((u) => String(u.username || '').toLowerCase()));
  let candidate = base;
  let i = 1;
  while (taken.has(candidate.toLowerCase()) || RESERVED_USERNAMES.has(candidate.toLowerCase())) {
    candidate = `${base}${++i}`.slice(0, 20);
  }
  return candidate;
}

function fail(res, msg) {
  res.writeHead(302, { Location: `/auth?error=${encodeURIComponent(msg)}`, 'Cache-Control': 'no-store' });
  res.end();
}

function cookieValue(req, name) {
  const found = String(req.headers.cookie || '').split(';').map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  if (!found) return null;
  try { return decodeURIComponent(found.slice(name.length + 1)); } catch { return found.slice(name.length + 1); }
}

// GET /api/google -> redirect to Google consent
const start = wrap('google-start', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!(await enforce(req, res, 'google')).allowed) return;

  const s = await getSettings();
  if (s.google_login_enabled === false) return res.status(403).send('تسجيل الدخول بجوجل معطّل حالياً');

  const cfg = config();
  if (!cfg.googleConfigured) {
    // eslint-disable-next-line no-console
    console.error('[google] GOOGLE_CLIENT_ID/SECRET are not configured');
    return res.status(503).send('تسجيل الدخول بجوجل غير مهيّأ حالياً');
  }

  const state = crypto.randomBytes(24).toString('hex');
  const nonce = crypto.randomBytes(24).toString('hex');
  appendCookie(res, `${STATE_COOKIE}=${state}; ${SHORT}`);
  appendCookie(res, `${NONCE_COOKIE}=${nonce}; ${SHORT}`);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', cfg.google.clientId);
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('prompt', 'select_account');
  res.writeHead(302, { Location: url.toString() });
  res.end();
});

// GET /api/google-callback
const callback = wrap('google-callback', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!(await enforce(req, res, 'google')).allowed) return;

  const cfg = config();
  if (!cfg.googleConfigured) return fail(res, 'تسجيل الدخول بجوجل غير مهيّأ');

  const url = new URL(req.url, 'http://localhost');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';

  // Clear the one-shot cookies no matter how this ends.
  appendCookie(res, `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  appendCookie(res, `${NONCE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);

  if (!code) return fail(res, 'تم إلغاء تسجيل الدخول بجوجل');

  const cookieState = cookieValue(req, STATE_COOKIE);
  const nonce = cookieValue(req, NONCE_COOKIE);
  if (!cookieState || !state || !safeEqual(cookieState, state)) {
    return fail(res, 'جلسة جوجل غير صالحة، حاول مرة أخرى');
  }

  // --- exchange the code -------------------------------------------------
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  let tok;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.google.clientId,
        client_secret: cfg.google.clientSecret,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
      signal: ctl.signal,
    });
    if (!tokenRes.ok) {
      // eslint-disable-next-line no-console
      console.error('[google] token exchange failed with status', tokenRes.status);
      return fail(res, 'فشل التحقق مع جوجل');
    }
    tok = await tokenRes.json();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[google] token exchange error:', e && e.name === 'AbortError' ? 'timeout' : e.message);
    return fail(res, 'تعذّر الاتصال بجوجل، حاول لاحقاً');
  } finally {
    clearTimeout(timer);
  }

  // --- verify the ID token (signature + iss + aud + exp + nonce) ---------
  let identity;
  try {
    identity = await verifyIdToken(tok && tok.id_token, { clientId: cfg.google.clientId, nonce });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[google] id_token rejected:', e instanceof GoogleAuthError ? `${e.code}: ${e.message}` : e.message);
    if (e instanceof GoogleAuthError && e.code === 'email_unverified') {
      return fail(res, 'بريد جوجل غير مُفعّل');
    }
    if (e instanceof GoogleAuthError && e.code === 'jwks_unavailable') {
      return fail(res, 'تعذّر التحقق مع جوجل حالياً، حاول لاحقاً');
    }
    return fail(res, 'فشل التحقق مع جوجل');
  }

  const { email } = identity;

  // --- find or create the account ----------------------------------------
  const existing = findUserByEmail((await loadUsers()).users, email);
  let created = false;

  if (!existing) {
    const s = await getSettings();
    if (s.signup_enabled === false) return fail(res, 'التسجيل الجديد متوقف مؤقتاً');
  }

  let conflict = false;
  await updateUsers((data) => {
    let user = findUserByEmail(data.users, email);
    if (!user) {
      const username = uniqueUsername(data.users, email);
      user = {
        username,
        email,
        // No password_hash at all: this account has no local password until the
        // member deliberately sets one through the reset flow (SEC-10).
        password_hash: null,
        display_name: identity.name || username,
        avatar_url: identity.picture || null,
        verified: true,
        verified_at: new Date().toISOString(),
        is_verified_badge: false,
        provider: 'google',
        google_sub: identity.sub || null,
        session_version: 0,
        created_at: new Date().toISOString(),
      };
      data.users.push(user);
      created = true;
      return null;
    }
    // Existing account: Google confirmed the mailbox, so trust that much.
    let touched = false;
    if (!user.verified) { user.verified = true; user.verified_at = new Date().toISOString(); touched = true; }
    if (!user.avatar_url && identity.picture) { user.avatar_url = identity.picture; touched = true; }
    if (!user.google_sub && identity.sub) { user.google_sub = identity.sub; touched = true; }
    if (user.verification_token || user.verification_token_hash) {
      user.verification_token = null;
      user.verification_token_hash = null;
      user.verification_token_expires = null;
      touched = true;
    }
    if (!touched) { conflict = false; return SKIP_WRITE; }
    return null;
  }, created ? `chore: google signup ${email.split('@')[0]}` : 'chore: google sign-in refresh');

  if (conflict) return fail(res, 'تعذّر إنشاء الحساب، حاول لاحقاً');

  const user = findUserByEmail((await loadUsers()).users, email);
  if (!user) return fail(res, 'تعذّر إنشاء الحساب، حاول لاحقاً');

  // A ban applies to Google sign-in too (SEC-05).
  try {
    const ban = await banOf(user);
    if (ban) return fail(res, `حسابك محظور (${ban.reason})`);
  } catch {
    return fail(res, 'تعذّر التحقق من حالة الحساب، حاول لاحقاً');
  }

  if (created) {
    try {
      await sendWelcome({
        to: email,
        display: user.display_name || user.username,
        loginUrl: `${baseUrl(req)}/auth`,
        setPasswordUrl: `${baseUrl(req)}/auth?mode=forgot`,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[google] welcome mail failed:', e.message);
    }
  }

  issueSession(res, user);
  const dest = isAdminEmail(user.email) ? '/admin' : (created ? '/?welcome=1' : '/');
  res.writeHead(302, { Location: dest });
  res.end();
});

module.exports = { start, callback };
