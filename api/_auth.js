// Session primitives and the user store.
//
// Changes against the audited version (plan: SEC-04, SEC-09, 5.3):
//   * JWT_SECRET comes from the validated config — there is no 'change-me'
//     fallback, and production refuses to start without it.
//   * Sessions carry a version (`v`). Bumping `session_version` on a user record
//     invalidates every existing cookie for that account, which is how password
//     reset / email change / username change / ban rotate the session.
//   * readBody() is now a thin wrapper over the size- and type-checked
//     implementation in _http.js. Unbounded body reads are gone.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { readJson, writeJson, updateJson } = require('./_gh');
const { config } = require('./_config');
const { readJsonBody } = require('./_http');

const USERS_PATH = 'data/users.json';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// Usernames that must never belong to a normal member: they would let someone
// impersonate platform surfaces or shadow a route.
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'api', 'www',
  'arabcode', 'arab_code', 'moderator', 'mod', 'staff', 'official', 'security',
  'me', 'null', 'undefined', 'anonymous', 'owner',
]);

const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() { return config().jwtSecret; }

function sign(payload) {
  return jwt.sign(payload, secret(), { expiresIn: '30d' });
}
function verify(token) {
  try { return jwt.verify(token, secret()); } catch { return null; }
}

function parseCookies(req) {
  const h = (req && req.headers && req.headers.cookie) || '';
  const out = {};
  h.split(';').forEach((c) => {
    const [k, ...v] = c.trim().split('=');
    if (k) {
      try { out[k] = decodeURIComponent(v.join('=')); } catch { out[k] = v.join('='); }
    }
  });
  return out;
}

/** Append a Set-Cookie without clobbering cookies another helper already set. */
function appendCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? [].concat(existing) : [];
  list.push(cookie);
  res.setHeader('Set-Cookie', list);
}

function sessionCookie(value, maxAge) {
  // Secure is intentionally unconditional: the platform is HTTPS-only and a
  // cookie that works over plain HTTP would be a downgrade path.
  return `session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function setSessionCookie(res, token) {
  appendCookie(res, sessionCookie(encodeURIComponent(token), SESSION_MAX_AGE));
}
function clearSessionCookie(res) {
  appendCookie(res, sessionCookie('', 0));
}

/** Issue a fresh session bound to the record's current session_version. */
function issueSession(res, user) {
  const token = sign({ u: user.username, e: user.email, v: Number(user.session_version) || 0 });
  setSessionCookie(res, token);
  return token;
}

/** Invalidate every existing session of this account. */
function bumpSessionVersion(user) {
  user.session_version = (Number(user.session_version) || 0) + 1;
  return user.session_version;
}

async function loadUsers() {
  const { data } = await readJson(USERS_PATH, { users: [] });
  if (!data.users) data.users = [];
  return data;
}
async function saveUsers(data, msg) {
  await writeJson(USERS_PATH, data, msg || 'chore: update users');
}

/**
 * Atomic read-modify-write on the user store (plan: SEC-08).
 * `mutate(data)` is replayed against a freshly fetched copy on conflict, so a
 * concurrent profile update can no longer be silently overwritten.
 */
async function updateUsers(mutate, msg) {
  return updateJson(USERS_PATH, { users: [] }, (data) => {
    if (!data.users) data.users = [];
    return mutate(data);
  }, msg || 'chore: update users');
}

function findUser(users, username) {
  const t = String(username || '').toLowerCase();
  if (!t) return null;
  return users.find((x) => String(x.username || '').toLowerCase() === t) || null;
}
function findUserByEmail(users, email) {
  const t = String(email || '').toLowerCase();
  if (!t) return null;
  return users.find((x) => String(x.email || '').toLowerCase() === t) || null;
}

function isAdminEmail(email) {
  const admin = config().adminEmail;
  if (!admin) return false;
  return String(email || '').toLowerCase() === admin;
}

/** The only shape of a user object that may cross the network to a client. */
function publicUser(u) {
  if (!u) return null;
  const admin = isAdminEmail(u.email);
  return {
    username: u.username,
    display_name: u.display_name || u.username,
    email: u.email,
    verified: !!u.verified,
    is_admin: admin,
    is_verified_badge: admin || !!u.is_verified_badge,
    avatar_url: u.avatar_url || null,
    bio: u.bio || '',
    links: Array.isArray(u.links) ? u.links : [],
    created_at: u.created_at,
  };
}

/**
 * Resolve the session cookie to a stored user.
 * Rejects a cookie whose session version no longer matches the record, which is
 * what makes password reset / email change / ban revoke old sessions.
 */
async function currentUser(req) {
  const t = parseCookies(req).session;
  if (!t) return null;
  const p = verify(t);
  if (!p || !p.u) return null;
  const { users } = await loadUsers();
  const u = findUser(users, p.u);
  if (!u) return null;
  const expected = Number(u.session_version) || 0;
  const presented = Number(p.v) || 0;
  if (presented !== expected) return null;
  return u;
}

/** Size- and content-type-checked JSON body. */
function readBody(req, opts) { return readJsonBody(req, opts); }

function randomToken(n = 24) { return crypto.randomBytes(n).toString('hex'); }

module.exports = {
  bcrypt, jwt, sign, verify, parseCookies, setSessionCookie, clearSessionCookie,
  appendCookie, issueSession, bumpSessionVersion,
  loadUsers, saveUsers, updateUsers, findUser, findUserByEmail,
  currentUser, publicUser, readBody, randomToken,
  isAdminEmail, EMAIL_RE, USERNAME_RE, RESERVED_USERNAMES, SESSION_MAX_AGE,
  get ADMIN_EMAIL() { return config().adminEmail; },
  get SECRET() { return config().jwtSecret; },
};
