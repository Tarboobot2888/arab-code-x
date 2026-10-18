const { loadUsers, saveUsers, readBody, randomToken, EMAIL_RE } = require('../_auth');
const { sendMail } = require('../_mail');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { email } = await readBody(req);
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'إيميل غير صالح' });

    const data = await loadUsers();
    const u = data.users.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!u) return res.status(200).json({ ok: true }); // Don't leak user existence

    const reset_token = randomToken(32);
    u.reset_token = reset_token;
    u.reset_expires = Date.now() + 3600000; // 1 hour
    await saveUsers(data, `chore: reset request for ${u.username}`);

    const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
    const resetUrl = `${base}/auth?mode=reset&token=${reset_token}&email=${encodeURIComponent(email)}`;
    
    await sendMail({
      to: email,
      subject: 'استعادة كلمة السر - ARAB code',
      html: `
        <div dir="rtl" style="font-family:sans-serif;padding:20px;background:#111;color:#eee;">
          <h2 style="color:#d4af37;">استعادة كلمة السر</h2>
          <p>أهلاً ${u.username}،</p>
          <p>لقد طلبت استعادة كلمة السر الخاصة بك في ARAB code. اضغط على الزر أدناه لتعيين كلمة سر جديدة:</p>
          <a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#d4af37;color:#000;text-decoration:none;border-radius:5px;font-weight:bold;">تعيين كلمة سر جديدة</a>
          <p style="margin-top:20px;font-size:0.8rem;color:#888;">هذا الرابط صالح لمدة ساعة واحدة فقط.</p>
        </div>
      `
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ داخلي' });
  }
};
