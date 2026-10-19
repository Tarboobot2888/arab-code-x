// GET /api/users — admin only. ?filter=all|verified|unverified|unconfirmed
const { loadUsers, publicUser } = require('../_auth');
const { requireAdmin } = require('../_guard');
const { wrap, methodGuard, noStore } = require('../_http');

module.exports = wrap('users', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  await requireAdmin(req, { csrf: false });
  noStore(res);

  const { users } = await loadUsers();
  const filter = new URL(req.url, 'http://localhost').searchParams.get('filter') || 'all';
  let list = users.map(publicUser);
  if (filter === 'verified') list = list.filter((u) => u.is_verified_badge);
  else if (filter === 'unverified') list = list.filter((u) => !u.is_verified_badge && !u.is_admin);
  else if (filter === 'unconfirmed') list = list.filter((u) => !u.verified);
  list.sort((a, b) => (String(a.created_at || '') < String(b.created_at || '') ? 1 : -1));
  res.status(200).json({ users: list });
});
