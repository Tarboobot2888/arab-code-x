const {
  bcrypt, EMAIL_RE, USERNAME_RE, RESERVED_USERNAMES, updateUsers, readBody, isAdminEmail,
} = require('../_auth');
const { SKIP_WRITE } = require('../_gh');
const tokens = require('../_tokens');
const { sendVerification } = require('../_mail');
const { getSettings } = require('../_settings');
const { verifyTurnstile, clientIp } = require('../_turnstile');
const { wrap, methodGuard, HttpError, noStore, assertSameOrigin } = require('../_http');
const { enforce } = require('../_ratelimit');
const { baseUrl } = require('../_config');

module.exports = wrap('signup', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  assertSameOrigin(req);
  noStore(res);

  if (!(await enforce(req, res, 'signup')).allowed) return;

  const s = await getSettings();
  if (s.signup_enabled === false) throw new HttpError(403, 'التسجيل الجديد متوقف مؤقتاً');

  const body = await readBody(req, { maxBytes: 8192 });
  const ts = await verifyTurnstile(body.turnstile_token, clientIp(req));
  if (!ts.ok) throw new HttpError(400, ts.error);

  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  // `phone` is deliberately NOT read. It was collected and stored but never used
  // by any feature, so keeping it was personal data held without a purpose
  // (plan 9.3: "اجعل الهاتف اختيارياً فقط إذا كانت له حاجة منتجية").

  if (!username || !email || !password) throw new HttpError(400, 'الاسم والإيميل وكلمة السر مطلوبة');
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'اسم المستخدم: 3-20 حرف/رقم/شرطة سفلية');
  if (RESERVED_USERNAMES.has(username.toLowerCase())) throw new HttpError(400, 'اسم المستخدم محجوز');
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'إيميل غير صالح');
  if (password.length < 8) throw new HttpError(400, 'كلمة السر 8 أحرف على الأقل');
  if (password.length > 200) throw new HttpError(400, 'كلمة السر طويلة جداً');

  const emailLower = email.toLowerCase();
  if (isAdminEmail(emailLower)) throw new HttpError(400, 'الإيميل مسجل مسبقاً');

  const password_hash = await bcrypt.hash(password, 10);
  let verifyToken = null;
  let conflict = null;

  // One atomic read-modify-write: the uniqueness check and the insert can no
  // longer be split by a concurrent signup (SEC-08).
  const { written } = await updateUsers((data) => {
    if (data.users.some((u) => String(u.username || '').toLowerCase() === username.toLowerCase())) {
      conflict = 'اسم المستخدم مستخدم مسبقاً';
      return SKIP_WRITE;
    }
    if (data.users.some((u) => String(u.email || '').toLowerCase() === emailLower)) {
      conflict = 'الإيميل مسجل مسبقاً';
      return SKIP_WRITE;
    }
    const user = {
      username,
      email,
      password_hash,
      display_name: username,
      verified: false,
      is_verified_badge: false,
      session_version: 0,
      created_at: new Date().toISOString(),
    };
    // Stores sha256(token) + a mandatory 24h expiry; the plaintext only ever
    // leaves in the email link (SEC-01).
    verifyToken = tokens.issue(user, 'verify');
    data.users.push(user);
    return null;
  }, `chore: register ${username}`);

  if (conflict) throw new HttpError(409, conflict);
  if (!written) throw new HttpError(500, 'تعذّر إنشاء الحساب، حاول لاحقاً');

  const verifyUrl = `${baseUrl(req)}/api/verify?token=${verifyToken}&u=${encodeURIComponent(username)}`;
  try {
    await sendVerification({ to: email, username, verifyUrl });
  } catch (e) {
    // The account exists; say so without leaking SMTP details.
    // eslint-disable-next-line no-console
    console.error('[signup] verification mail failed:', e.message);
    return res.status(200).json({
      ok: true,
      needs_verification: true,
      warning: 'الحساب أنشئ لكن فشل إرسال إيميل التفعيل. اطلب رسالة تفعيل جديدة أو راسل الإدارة.',
    });
  }

  res.status(200).json({ ok: true, needs_verification: true });
});
