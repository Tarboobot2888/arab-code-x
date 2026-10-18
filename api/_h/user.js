const { loadUsers, currentUser, isAdminEmail } = require('../_auth');
const { readJson } = require('../_gh');
module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const username = (req.query && req.query.username) || url.searchParams.get('username');
    if (!username) return res.status(400).json({ error: 'username مطلوب' });
    const { users } = await loadUsers();
    const u = users.find((x) => x.username.toLowerCase() === String(username).toLowerCase());
    if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const me = await currentUser(req);
    const isSelf = !!(me && me.username.toLowerCase() === u.username.toLowerCase());
    const { data } = await readJson('data/manifest.json', { codes: [] });
    const codes = (data.codes || []).filter((c) => c.author && c.author.toLowerCase() === u.username.toLowerCase());
    const admin = isAdminEmail(u.email);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      user: {
        username: u.username,
        display_name: u.display_name || u.username,
        bio: u.bio || '',
        links: Array.isArray(u.links) ? u.links : [],
        banner_url: u.banner_url || null,
        location: u.location || '',
        website: u.website || '',
        created_at: u.created_at,
        is_admin: admin,
        is_verified_badge: admin || !!u.is_verified_badge,
        avatar_url: u.avatar_url || null,
      },
      codes,
      count: codes.length,
      is_self: isSelf,
      pending: [],
    });
  } catch (e) {
    console.error("USER_API_ERROR:", e);
    res.status(500).json({ error: e.message });
  }
};
