// GET /api/delete-requests — admin queue of pending delete requests.
const { requireAdmin } = require('../_guard');
const { readJson } = require('../_gh');
const { wrap, methodGuard, noStore } = require('../_http');

module.exports = wrap('delete-requests', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  await requireAdmin(req, { csrf: false });
  noStore(res);
  const { data } = await readJson('data/delete_requests.json', { items: [] });
  const items = (data.items || []).filter((x) => (x.status || 'pending') === 'pending');
  res.status(200).json({ items });
});
