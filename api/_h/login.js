const { bcrypt, loadUsers, sign, setSessionCookie, readBody, ADMIN_EMAIL } = require('../_auth');
const { verifyTurnstile, clientIp } = require('../_turnstile');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    let { email, password, turnstile_token } = await readBody(req);
    const ts = await verifyTurnstile(turnstile_token, clientIp(req));
    if (!ts.ok) return res.status(400).json({ error: ts.error });
    email = (email || '').trim();
    if (!email || !password) return res.status(400).json({ error: 'الإيميل وكلمة السر مطلوبان' });
    const data = await loadUsers();
    const u = data.users.find((x) => x.email && x.email.toLowerCase() === email.toLowerCase());
    if (!u || !u.password_hash) return res.status(401).json({ error: 'بيانات دخول خاطئة' });
    let ok = false;
    try { ok = await bcrypt.compare(password, u.password_hash); } catch (e) { ok = false; }
    if (!ok) return res.status(401).json({ error: 'بيانات دخول خاطئة' });
    if (!u.verified) return res.status(403).json({ error: 'الحساب غير مفعّل. راجع بريدك.' });
    const token = sign({ u: u.username, e: u.email });
    setSessionCookie(res, token);
    res.status(200).json({
      ok: true,
      user: { username: u.username, email: u.email, is_admin: u.email.toLowerCase() === ADMIN_EMAIL },
    });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e && e.message ? e.message : 'unknown') });
  }
};
