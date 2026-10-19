// POST /api/forgot-password { email, turnstile_token }
//
// Fixes against the audited version: Turnstile is now required (it was the one
// sensitive route with no bot check at all), the request is rate limited, and
// the reset token is stored hashed with a mandatory expiry (SEC-01, SEC-07).
const { updateUsers, findUserByEmail, readBody, EMAIL_RE } = require('../_auth');
const { SKIP_WRITE } = require('../_gh');
const tokens = require('../_tokens');
const { sendPasswordReset } = require('../_mail');
const { verifyTurnstile, clientIp } = require('../_turnstile');
const { wrap, methodGuard, HttpError, noStore, assertSameOrigin } = require('../_http');
const { enforce } = require('../_ratelimit');
const { baseUrl } = require('../_config');

// Always the same answer — the endpoint must not reveal whether an address is
// registered (plan 7: منع تعداد البريد).
const OK = { ok: true, message: 'إذا كان البريد مسجلاً فستصلك رسالة لإعادة التعيين.' };

module.exports = wrap('forgot-password', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  assertSameOrigin(req);
  noStore(res);

  const body = await readBody(req, { maxBytes: 2048 });
  const email = String(body.email || '').trim().toLowerCase();
  if (!(await enforce(req, res, 'forgot-password', email)).allowed) return;

  const ts = await verifyTurnstile(body.turnstile_token, clientIp(req));
  if (!ts.ok) throw new HttpError(400, ts.error);
  if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, 'إيميل غير صالح');

  let token = null;
  let username = null;
  await updateUsers((data) => {
    const u = findUserByEmail(data.users, email);
    if (!u) return SKIP_WRITE;
    token = tokens.issue(u, 'reset');
    username = u.username;
    return null;
  }, 'chore: password reset requested');

  if (token) {
    const resetUrl = `${baseUrl(req)}/auth?mode=reset&token=${token}&email=${encodeURIComponent(email)}`;
    try {
      await sendPasswordReset({ to: email, username, resetUrl });
    } catch (e) {
      // Never surface SMTP detail, and never log the token.
      // eslint-disable-next-line no-console
      console.error('[forgot-password] mail failed:', e.message);
    }
  }

  res.status(200).json(OK);
});
