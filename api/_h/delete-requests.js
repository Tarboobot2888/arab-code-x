const { currentUser, isAdminEmail } = require('../_auth');
const { readJson } = require('../_gh');

module.exports = async (req, res) => {
  const u = await currentUser(req);
  if (!u || !isAdminEmail(u.email)) return res.status(403).json({ error: 'ممنوع' });
  const { data } = await readJson('data/delete_requests.json', { items: [] });
  const items = (data.items || []).filter((x) => x.status === 'pending');
  res.status(200).json({ items });
};
