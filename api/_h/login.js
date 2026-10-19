const {
  bcrypt, loadUsers, findUserByEmail, issueSession, readBody, isAdminEmail,
} = require('../_auth');
const { verifyTurnstile, clientIp } = require('../_turnstile');
const { wrap, methodGuard, HttpError, noStore, assertSameOrigin } = require('../_http');
const { enforce } = require('../_ratelimit');
const { banOf } = require('../_guard');
const lockout = require('../_lockout');

// Identical message for "unknown email" and "wrong password" so the endpoint
// cannot be used to enumerate accounts (plan 7: "احمِ النظام من تخمين الحسابات
// وتعداد البريد").
const GENERIC = 'بيانات دخول خاطئة';

module.exports = wrap('login', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  assertSameOrigin(req);
  noStore(res);

  const body = await readBody(req, { maxBytes: 4096 });
  const email = String(body.email || '').trim().toLowerCase();

  // Rate limit before any expensive work, bucketed by IP and by the claimed
  // identity so one account cannot be hammered from many addresses.
  if (!(await enforce(req, res, 'login', email)).allowed) return;

  const ts = await verifyTurnstile(body.turnstile_token, clientIp(req));
  if (!ts.ok) throw new HttpError(400, ts.error);

  if (!email || !body.password) throw new HttpError(400, 'الإيميل وكلمة السر مطلوبان');

  const { users } = await loadUsers();
  const u = findUserByEmail(users, email);

  // Burn roughly the same time whether or not the account exists.
  const hash = (u && u.password_hash) || '$2a$10$0000000000000000000000000000000000000000000000000000';
  let ok = false;
  try { ok = await bcrypt.compare(String(body.password), hash); } catch { ok = false; }
  if (!u || !u.password_hash || !ok) {
    const result = await lockout.registerFailure(email);
    if (result.locked) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      throw new HttpError(429, 'تم قفل الحساب مؤقتاً بعد محاولات دخول متكررة. حاول لاحقاً.');
    }
    throw new HttpError(401, GENERIC);
  }

  const lockLeft = lockout.lockedFor(u);
  if (lockLeft > 0) {
    res.setHeader('Retry-After', String(Math.ceil(lockLeft / 1000)));
    throw new HttpError(429, 'الحساب مقفل مؤقتاً بسبب محاولات دخول متكررة. حاول لاحقاً.');
  }

  if (!u.verified) throw new HttpError(403, 'الحساب غير مفعّل. راجع بريدك أو اطلب رسالة تفعيل جديدة.');

  // A banned account must not receive a session at all — the audited version let
  // it in and relied on a UI overlay (SEC-05).
  const ban = await banOf(u);
  if (ban) throw new HttpError(403, `حسابك محظور (${ban.reason}). تواصل مع الدعم.`);

  await lockout.registerSuccess(email, u);
  issueSession(res, u);

  res.status(200).json({
    ok: true,
    user: { username: u.username, email: u.email, is_admin: isAdminEmail(u.email) },
  });
});
