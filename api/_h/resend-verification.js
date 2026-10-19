// POST /api/resend-verification { email }
//
// Added because revoking the 33 legacy (never-expiring) verification tokens left
// those accounts with no way to confirm their address. Answers 200 regardless of
// whether the address exists, so it cannot be used to enumerate accounts.
const { updateUsers, findUserByEmail, readBody, EMAIL_RE } = require('../_auth');
const { SKIP_WRITE } = require('../_gh');
const tokens = require('../_tokens');
const { sendVerification } = require('../_mail');
const { verifyTurnstile, clientIp } = require('../_turnstile');
const { wrap, methodGuard, HttpError, noStore, assertSameOrigin } = require('../_http');
const { enforce } = require('../_ratelimit');
const { baseUrl } = require('../_config');

const OK = { ok: true, message: 'إذا كان البريد مسجلاً وغير مُفعّل فستصلك رسالة تفعيل جديدة.' };

module.exports = wrap('resend-verification', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  assertSameOrigin(req);
  noStore(res);

  const body = await readBody(req, { maxBytes: 2048 });
  const email = String(body.email || '').trim().toLowerCase();
  if (!(await enforce(req, res, 'resend-verification', email)).allowed) return;

  const ts = await verifyTurnstile(body.turnstile_token, clientIp(req));
  if (!ts.ok) throw new HttpError(400, ts.error);
  if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, 'إيميل غير صالح');

  let token = null;
  let username = null;
  await updateUsers((data) => {
    const u = findUserByEmail(data.users, email);
    if (!u || u.verified) return SKIP_WRITE;
    token = tokens.issue(u, 'verify');
    username = u.username;
    return null;
  }, 'chore: reissue verification token');

  if (token && username) {
    const verifyUrl = `${baseUrl(req)}/api/verify?token=${token}&u=${encodeURIComponent(username)}`;
    try {
      await sendVerification({ to: email, username, verifyUrl });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[resend-verification] mail failed:', e.message);
    }
  }
  res.status(200).json(OK);
});
