const { currentUser, readBody, loadUsers, saveUsers, isAdminEmail, publicUser } = require('../_auth');

// POST /api/toggle-verify { username, verified }
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const me = await currentUser(req);
  if (!me || !isAdminEmail(me.email)) return res.status(403).json({ error: 'ممنوع' });
  try {
    const { username, verified } = await readBody(req);
    if (!username) return res.status(400).json({ error: 'username مطلوب' });
    const data = await loadUsers();
    const u = data.users.find((x) => x.username.toLowerCase() === String(username).toLowerCase());
    if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (isAdminEmail(u.email)) return res.status(400).json({ error: 'لا يمكن تعديل حساب الأدمن' });
    u.is_verified_badge = !!verified;
    await saveUsers(data, `verify: ${u.username} = ${!!verified}`);
    res.status(200).json({ ok: true, user: publicUser(u) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
};
