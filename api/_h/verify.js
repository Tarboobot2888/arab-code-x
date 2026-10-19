// GET /api/verify?token=&u=  — confirm an email address.
//
// The audited version matched a plaintext token stored in data/users.json with
// NO expiry and NO invalidation, so any copy of that file could activate (and
// then sign in as) 33 accounts. Now: hashed token, mandatory expiry, single use,
// and the session is only issued after the token has been burned (SEC-01).
const { updateUsers, findUser, issueSession } = require('../_auth');
const { SKIP_WRITE } = require('../_gh');
const tokens = require('../_tokens');
const { wrap, methodGuard, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { page } = require('../_page');

module.exports = wrap('verify', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  noStore(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const url = new URL(req.url, 'http://localhost');
  const token = String((req.query && req.query.token) || url.searchParams.get('token') || '');
  const username = String((req.query && req.query.u) || url.searchParams.get('u') || '');

  if (!(await enforce(req, res, 'verify', username)).allowed) return;
  if (!token || !username) return res.status(400).send(page('رابط غير صالح.', false));

  let outcome = 'invalid';
  let record = null;

  await updateUsers((data) => {
    const user = findUser(data.users, username);
    if (!user) return SKIP_WRITE;

    if (user.verified && !tokens.isActive(user, 'verify')) {
      outcome = 'already';
      return SKIP_WRITE;
    }

    const r = tokens.consume(user, 'verify', token);
    if (!r.ok) {
      outcome = r.reason === 'expired' ? 'expired' : 'invalid';
      // consume() already cleared an expired or legacy (no-expiry) token, so
      // persist that clearing; nothing to write for a plain mismatch.
      return r.reason === 'expired' ? null : SKIP_WRITE;
    }
    user.verified = true;
    user.verified_at = new Date().toISOString();
    outcome = 'ok';
    record = user;
    return null;
  }, `chore: verify ${username}`);

  if (outcome === 'ok') {
    issueSession(res, record);
    return res.status(200).send(page('تم تفعيل حسابك بنجاح ✓', true));
  }
  if (outcome === 'already') {
    return res.status(200).send(page('هذا الحساب مُفعّل بالفعل. يمكنك تسجيل الدخول.', true));
  }
  if (outcome === 'expired') {
    return res.status(400).send(page(
      'انتهت صلاحية رابط التحقق أو استُخدم مسبقاً. اطلب رسالة تفعيل جديدة من صفحة الدخول.',
      false,
    ));
  }
  // Same message for a wrong token and an unknown user — no account enumeration.
  return res.status(400).send(page('رابط التحقق غير صالح أو منتهي.', false));
});
