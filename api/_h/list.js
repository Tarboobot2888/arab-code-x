// GET /api/list — the public, approved code index.
const { readJson } = require('../_gh');
const { enrichCodes } = require('../_enrich');
const { wrap, methodGuard } = require('../_http');
const { STATUS } = require('../_moderation');

module.exports = wrap('list', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  const { data } = await readJson('data/manifest.json', { codes: [] });
  // Only approved entries are public. Rows written before the status field
  // existed are approved by definition (they were already in the live index).
  const approved = (data.codes || []).filter((c) => !c.status || c.status === STATUS.APPROVED);
  const codes = await enrichCodes(approved);
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
  res.status(200).json({ codes });
});
