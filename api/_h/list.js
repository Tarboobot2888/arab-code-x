const { readJson } = require('../_gh');
const { enrichCodes } = require('../_enrich');

module.exports = async (req, res) => {
  const { data } = await readJson('data/manifest.json', { codes: [] });
  const codes = await enrichCodes(data.codes || []);
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
  res.status(200).json({ codes });
};
