// GET /api/pending — admin review queue.
const { requireAdmin } = require('../_guard');
const { listDir, getFile } = require('../_gh');
const { userMap, liveAuthor } = require('../_enrich');
const { wrap, methodGuard, noStore } = require('../_http');
const { STATUS } = require('../_moderation');

module.exports = wrap('pending', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  await requireAdmin(req);
  noStore(res);

  const items = await listDir('pending');
  const m = await userMap();
  const out = [];
  for (const it of items) {
    if (!it.name || !it.name.endsWith('.json')) continue;
    const f = await getFile(it.path);
    if (!f) continue;
    try {
      const j = JSON.parse(f.content);
      // `code` can be 200k characters; the queue only needs enough to triage.
      const { code, ...rest } = j;
      out.push(liveAuthor({
        ...rest,
        status: rest.status || STATUS.PENDING,
        code_preview: String(code || '').slice(0, 2000),
        code_length: String(code || '').length,
      }, m.get(String(j.author || '').toLowerCase())));
    } catch {
      out.push({ id: it.name.replace(/\.json$/, ''), corrupt: true, status: STATUS.PENDING });
    }
  }
  out.sort((a, b) => (String(a.submitted_at || '') < String(b.submitted_at || '') ? 1 : -1));
  res.status(200).json({ items: out });
});
