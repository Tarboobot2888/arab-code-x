// GET /api/search?q=&language=&tag=&license=&author=&sort=&page=&per_page=
//
// Server-side search with Arabic normalisation, filters and real pagination
// (plan 7.1 P0 and 8.2: "أضف بحثاً على الخادم مع ترقيم نتائج وفلاتر").
const { readJson } = require('../_gh');
const { enrichCodes } = require('../_enrich');
const { searchCodes, suggestions } = require('../_search');
const { wrap, methodGuard } = require('../_http');
const { STATUS } = require('../_moderation');
const { LANGUAGE_KEYS, KNOWN_LICENSES } = require('../_content');

module.exports = wrap('search', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  const url = new URL(req.url, 'http://localhost');
  const p = (k) => String((req.query && req.query[k]) || url.searchParams.get(k) || '').slice(0, 120);

  const { data } = await readJson('data/manifest.json', { codes: [] });
  const approved = (data.codes || []).filter((c) => !c.status || c.status === STATUS.APPROVED);

  const opts = {
    q: p('q'),
    language: p('language'),
    tag: p('tag'),
    license: p('license'),
    author: p('author'),
    sort: ['relevance', 'newest', 'oldest'].includes(p('sort')) ? p('sort') : 'relevance',
    page: p('page'),
    perPage: p('per_page'),
  };

  const result = searchCodes(approved, opts);
  const out = {
    codes: await enrichCodes(result.codes),
    total: result.total,
    page: result.page,
    per_page: result.per_page,
    pages: result.pages,
    terms: result.terms,
    facets: { languages: LANGUAGE_KEYS, licenses: KNOWN_LICENSES },
  };
  if (!result.total) out.suggestions = suggestions(approved, opts);

  // A search response depends only on public data, so a short shared cache is
  // fine and keeps the index read off GitHub for repeated queries.
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
  res.status(200).json(out);
});
