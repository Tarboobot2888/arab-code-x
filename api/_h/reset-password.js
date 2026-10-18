const { bcrypt, loadUsers, saveUsers, readBody } = require('../_auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { email, token, password } = await readBody(req);
    if (!email || !token || !password) return res.status(400).json({ error: 'بيانات ناقصة' });
    if (password.length < 8) return res.status(400).json({ error: 'كلمة السر 8 أحرف على الأقل' });

    const data = await loadUsers();
    const u = data.users.find((x) => 
      x.email.toLowerCase() === email.toLowerCase() && 
      x.reset_token === token && 
      x.reset_expires > Date.now()
    );

    if (!u) return res.status(400).json({ error: 'رابط غير صالح أو منتهي الصلاحية' });

    u.password_hash = await bcrypt.hash(password, 10);
    u.reset_token = null;
    u.reset_expires = null;
    await saveUsers(data, `chore: reset password for ${u.username}`);

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ داخلي' });
  }
};
