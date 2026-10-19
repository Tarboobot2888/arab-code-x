// POST /api/reset-password { email, token, password }
//
// The token is hashed, single-use and expiring (see _tokens.js). On success every
// existing session of the account is revoked by bumping session_version — a
// password reset must log out whoever held the old cookie (plan 5.3).
const { bcrypt, updateUsers, findUserByEmail, readBody, bumpSessionVersion } = require('../_auth');
const { SKIP_WRITE } = require('../_gh');
const tokens = require('../_tokens');
const { sendAccountNotice } = require('../_mail');
const { wrap, methodGuard, HttpError, noStore, assertSameOrigin } = require('../_http');
const { enforce } = require('../_ratelimit');

module.exports = wrap('reset-password', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  assertSameOrigin(req);
  noStore(res);

  const body = await readBody(req, { maxBytes: 4096 });
  const email = String(body.email || '').trim().toLowerCase();
  const token = String(body.token || '');
  const password = String(body.password || '');

  if (!(await enforce(req, res, 'reset-password', email)).allowed) return;
  if (!email || !token || !password) throw new HttpError(400, 'بيانات ناقصة');
  if (password.length < 8) throw new HttpError(400, 'كلمة السر 8 أحرف على الأقل');
  if (password.length > 200) throw new HttpError(400, 'كلمة السر طويلة جداً');

  const password_hash = await bcrypt.hash(password, 10);
  let outcome = 'invalid';
  let notify = null;

  await updateUsers((data) => {
    const u = findUserByEmail(data.users, email);
    if (!u) return SKIP_WRITE;
    const r = tokens.consume(u, 'reset', token);
    if (!r.ok) {
      outcome = r.reason === 'expired' ? 'expired' : 'invalid';
      return r.reason === 'expired' ? null : SKIP_WRITE;
    }
    u.password_hash = password_hash;
    u.password_changed_at = new Date().toISOString();
    // A successful reset also confirms control of the mailbox.
    u.verified = true;
    delete u.lock_until;
    delete u.lock_strikes;
    bumpSessionVersion(u);
    outcome = 'ok';
    notify = { email: u.email, username: u.username };
    return null;
  }, 'chore: password reset completed');

  if (outcome !== 'ok') {
    // Same message for expired, reused, mismatched and unknown — one signal only.
    throw new HttpError(400, 'رابط غير صالح أو منتهي الصلاحية');
  }

  if (notify) {
    try {
      await sendAccountNotice({
        to: notify.email,
        username: notify.username,
        title: 'تم تغيير كلمة السر',
        text: 'تم تعيين كلمة سر جديدة لحسابك في ARAB code وتم إنهاء كل الجلسات السابقة.\n'
          + 'إذا لم تكن أنت من قام بذلك تواصل مع الدعم فوراً.',
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[reset-password] notice mail failed:', e.message);
    }
  }

  res.status(200).json({ ok: true });
});
