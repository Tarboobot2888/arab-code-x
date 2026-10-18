const { bcrypt, EMAIL_RE, USERNAME_RE, loadUsers, saveUsers, readBody, randomToken, ADMIN_EMAIL } = require('../_auth');
const { sendVerification } = require('../_mail');
const { getSettings } = require('../_settings');
const { verifyTurnstile, clientIp } = require('../_turnstile');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const _s = await getSettings();
    if (_s.signup_enabled === false) return res.status(403).json({ error: 'التسجيل الجديد متوقف مؤقتاً' });
    let { username, email, password, phone, turnstile_token } = await readBody(req);
    const ts = await verifyTurnstile(turnstile_token, clientIp(req));
    if (!ts.ok) return res.status(400).json({ error: ts.error });
    username = (username || '').trim();
    email = (email || '').trim();
    phone = (phone || '').trim();

    if (!username || !email || !password) return res.status(400).json({ error: 'الاسم والإيميل وكلمة السر مطلوبة' });
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'اسم المستخدم: 3-20 حرف/رقم/شرطة سفلية' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'إيميل غير صالح' });
    if (password.length < 8) return res.status(400).json({ error: 'كلمة السر 8 أحرف على الأقل' });
    // phone is fully optional; accept any reasonable string (digits, +, spaces, dashes, parens)
    if (phone && !/^[\d+\-\s()]{4,25}$/.test(phone)) {
      return res.status(400).json({ error: 'رقم الهاتف يحتوي على رموز غير مسموحة' });
    }

    const data = await loadUsers();
    const emailLower = email.toLowerCase();
    if (data.users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
      return res.status(400).json({ error: 'اسم المستخدم مستخدم مسبقاً' });
    if (data.users.some((u) => u.email.toLowerCase() === emailLower))
      return res.status(400).json({ error: 'الإيميل مسجل مسبقاً' });

    // The main admin already exists; public signup can never create an admin.
    if (emailLower === ADMIN_EMAIL) return res.status(400).json({ error: 'الإيميل مسجل مسبقاً' });
    const password_hash = await bcrypt.hash(password, 10);
    const verification_token = randomToken(24);
    const user = {
      username, email, phone: phone || '',
      password_hash,
      display_name: username,
      verified: false,
      is_verified_badge: false,
      verification_token,
      created_at: new Date().toISOString(),
    };
    data.users.push(user);
    await saveUsers(data, `chore: register ${username}`);

    {
      const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
      const verifyUrl = `${base}/api/verify?token=${verification_token}&u=${encodeURIComponent(username)}`;
      try {
        await sendVerification({ to: email, username, verifyUrl });
      } catch (e) {
        console.error('mail error', e);
        return res.status(200).json({ ok: true, warning: 'الحساب أنشئ لكن فشل إرسال إيميل التفعيل. جرّب "نسيت كلمة السر" أو راسل الإدارة.' });
      }
    }
    res.status(200).json({ ok: true, needs_verification: true });
  } catch (e) {
    console.error('signup error:', e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e && e.message ? e.message : 'unknown') });
  }
};
