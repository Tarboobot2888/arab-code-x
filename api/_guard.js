// The single authorization gate for every route (plan: SEC-05, 5.1, 6.1).
//
// Before this module each handler re-implemented its own mix of checks and three
// of them disagreed about what "banned" even means (`u.banned` on the record vs.
// data/bans.json). Nothing is enforced in the UI any more: hiding a button is
// not a control, so every sensitive read and write passes through here.
//
// Checks, in order: identity → session validity → ban → email verification →
// role → ownership. Denials throw HttpError, which _http.wrap turns into a
// uniform response.
const { currentUser, isAdminEmail } = require('./_auth');
const { readJson } = require('./_gh');
const { HttpError, assertSameOrigin, methodGuard } = require('./_http');

const BANS_PATH = 'data/bans.json';

/**
 * Authoritative ban lookup. data/bans.json is the single source of truth;
 * a legacy `banned` flag on the user record is honoured as well so an older
 * record can never slip through.
 */
async function banOf(user) {
  if (!user) return null;
  let record = null;
  try {
    const { data } = await readJson(BANS_PATH, {});
    record = data[String(user.username || '').toLowerCase()] || null;
  } catch (e) {
    // Fail CLOSED for writes is handled by the caller via `strictBan`; here we
    // surface the failure instead of silently treating the user as unbanned.
    throw new HttpError(503, 'تعذّر التحقق من حالة الحساب، حاول لاحقاً', { cause: e.message });
  }
  if (record && record.banned) {
    return { reason: record.reason || 'أسباب أمنية', banned_at: record.banned_at || null };
  }
  if (user.banned === true) return { reason: 'أسباب أمنية', banned_at: user.banned_at || null };
  return null;
}

/**
 * @param {object} req
 * @param {object} opts
 *   verified      require a confirmed email address
 *   admin         require the admin account
 *   allowBanned   skip the ban check (only /api/me and /api/logout)
 *   csrf          same-origin check for state-changing methods (default true)
 * @returns {Promise<{user:object, isAdmin:boolean, ban:object|null}>}
 */
async function requireUser(req, opts = {}) {
  const { verified = false, admin = false, allowBanned = false, csrf = true } = opts;
  if (csrf) assertSameOrigin(req);

  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'سجّل دخول أولاً');

  const ban = await banOf(user);
  if (ban && !allowBanned) {
    throw new HttpError(403, `حسابك محظور (${ban.reason}). تواصل مع الدعم.`);
  }

  const isAdmin = isAdminEmail(user.email);
  if (admin && !isAdmin) throw new HttpError(403, 'ممنوع');
  if (verified && !user.verified) throw new HttpError(403, 'فعّل بريدك أولاً');

  return { user, isAdmin, ban };
}

/** Admin-only shorthand. */
function requireAdmin(req, opts = {}) {
  return requireUser(req, { ...opts, admin: true });
}

/** Optional identity for public reads; never throws on an anonymous visitor. */
async function optionalUser(req) {
  try {
    const user = await currentUser(req);
    if (!user) return { user: null, isAdmin: false, ban: null };
    let ban = null;
    try { ban = await banOf(user); } catch { ban = null; }
    return { user, isAdmin: isAdminEmail(user.email), ban };
  } catch {
    return { user: null, isAdmin: false, ban: null };
  }
}

/**
 * Ownership check used by delete/edit routes. Admin always passes.
 * `ownerName` is whatever the stored record says the author is.
 */
function assertOwnerOrAdmin({ user, isAdmin }, ownerName, message) {
  if (isAdmin) return true;
  const mine = String(user.username || '').toLowerCase();
  const owner = String(ownerName || '').toLowerCase();
  if (!owner || owner !== mine) throw new HttpError(403, message || 'غير مسموح');
  return true;
}

module.exports = { requireUser, requireAdmin, optionalUser, assertOwnerOrAdmin, banOf, methodGuard, BANS_PATH };
