const { currentUser, ADMIN_EMAIL } = require('../_auth');
const { listDir, getFile } = require('../_gh');
const { userMap, liveAuthor } = require('../_enrich');

module.exports = async (req, res) => {
  const u = await currentUser(req);
  if (!u || u.email.toLowerCase() !== ADMIN_EMAIL) return res.status(403).json({ error: 'ممنوع' });
  const items = await listDir('pending');
  const m = await userMap();
  const out = [];
  for (const it of items) {
    if (!it.name.endsWith('.json')) continue;
    const f = await getFile(it.path);
    if (!f) continue;
    try {
      const j = JSON.parse(f.content);
      out.push(liveAuthor(j, m.get(String(j.author || '').toLowerCase())));
    } catch {}
  }
  out.sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ items: out });
};
