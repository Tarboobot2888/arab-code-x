const { readJson } = require('../_gh');
const { enrichCodes } = require('../_enrich');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = String((req.query && req.query.q) || url.searchParams.get('q') || '').trim().toLowerCase();
  res.setHeader('Cache-Control', 'no-store');
  if (!q) return res.status(200).json({ codes: [] });
  const { data } = await readJson('data/manifest.json', { codes: [] });
  const out = (data.codes || []).filter((c) => (
    (c.title && c.title.toLowerCase().includes(q))
    || (c.description && c.description.toLowerCase().includes(q))
    || (c.filename && c.filename.toLowerCase().includes(q))
    || (c.author && c.author.toLowerCase().includes(q))
    || (c.language && c.language.toLowerCase().includes(q))
  ));
  res.status(200).json({ codes: await enrichCodes(out) });
};
