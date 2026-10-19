// GET /sitemap.xml (rewritten to the router) — generated from live data.
//
// APP-04: the static sitemap listed /search, for which no page existed (a
// guaranteed 404), and covered none of the content pages. This handler emits
// only pages that really exist and are really public:
//   * static public pages (no admin page, no login-gated page),
//   * approved codes  -> /c/<filename>,
//   * member profiles -> /u/<username>.
// Executable previews, /admin, /api/*, pending items and archive detail pages
// (which require a session) are all excluded.
const { readJson } = require('../_gh');
const { loadUsers } = require('../_auth');
const { wrap, methodGuard } = require('../_http');
const { config, baseUrl } = require('../_config');
const { STATUS } = require('../_moderation');

// Kept in sync with tests/sitemap.test.js, which asserts every entry maps to a
// real file or rewrite in vercel.json.
const STATIC_PAGES = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/search', priority: '0.8', changefreq: 'daily' },
  { path: '/popular', priority: '0.8', changefreq: 'daily' },
  { path: '/info', priority: '0.5', changefreq: 'monthly' },
  { path: '/auth', priority: '0.3', changefreq: 'yearly' },
];

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

function urlEntry(loc, { lastmod, changefreq, priority } = {}) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `    <lastmod>${xmlEscape(lastmod)}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    '  </url>',
  ].filter(Boolean).join('\n');
}

function isoDay(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** Pure builder so tests can assert the output without network access. */
function buildSitemap(base, codes, usernames) {
  const origin = String(base).replace(/\/+$/, '');
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const p of STATIC_PAGES) {
    parts.push(urlEntry(`${origin}${p.path}`, { changefreq: p.changefreq, priority: p.priority }));
  }
  for (const c of codes) {
    parts.push(urlEntry(`${origin}/c/${encodeURIComponent(c.filename)}`, {
      lastmod: isoDay(c.published_at || c.approved_at),
      changefreq: 'monthly',
      priority: '0.7',
    }));
  }
  for (const u of usernames) {
    parts.push(urlEntry(`${origin}/u/${encodeURIComponent(u)}`, { changefreq: 'weekly', priority: '0.4' }));
  }
  parts.push('</urlset>');
  return parts.join('\n');
}

module.exports = wrap('sitemap', async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'HEAD'])) return;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  const origin = config().publicBaseUrl || baseUrl(req);
  let codes = [];
  let usernames = [];
  try {
    const { data } = await readJson('data/manifest.json', { codes: [] });
    codes = (data.codes || [])
      .filter((c) => c.filename && (!c.status || c.status === STATUS.APPROVED))
      .slice(0, 20000);
    const authors = new Set(codes.map((c) => String(c.author || '').toLowerCase()).filter(Boolean));
    const { users } = await loadUsers();
    // Only profiles that have something public to show are listed.
    usernames = users
      .filter((u) => u.username && u.verified && authors.has(String(u.username).toLowerCase()))
      .map((u) => u.username);
  } catch (e) {
    // Still serve the static pages rather than a 500 — a broken sitemap is worse
    // than a short one.
    // eslint-disable-next-line no-console
    console.error('[sitemap] falling back to static pages:', e.message);
  }

  const xml = buildSitemap(origin, codes, usernames);
  if (req.method === 'HEAD') return res.status(200).end();
  res.status(200).send(xml);
});

module.exports.buildSitemap = buildSitemap;
module.exports.STATIC_PAGES = STATIC_PAGES;
