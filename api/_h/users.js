const { currentUser, loadUsers, isAdminEmail, publicUser } = require('../_auth');

// GET /api/users — admin only. ?filter=verified | all (default all)
module.exports = async (req, res) => {
  const me = await currentUser(req);
  if (!me || !isAdminEmail(me.email)) return res.status(403).json({ error: 'ممنوع' });
  const { users } = await loadUsers();
  const url = new URL(req.url, 'http://x');
  const filter = url.searchParams.get('filter') || 'all';
  let list = users.map(publicUser);
  if (filter === 'verified') list = list.filter((u) => u.is_verified_badge);
  else if (filter === 'unverified') list = list.filter((u) => !u.is_verified_badge && !u.is_admin);
  list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  res.status(200).json({ users: list });
};
