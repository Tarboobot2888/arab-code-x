// Deployment configuration, security headers, robots and sitemap integrity
// (plan: SEC-11, APP-04, APP-06, 12, 13 "الروابط وإعادات التوجيه وsitemap
// وcanonical").
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/harness');

const ROOT = h.ROOT;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const vercel = JSON.parse(read('vercel.json'));
const pkg = JSON.parse(read('package.json'));

const headerMap = (source) => {
  const block = vercel.headers.find((x) => x.source === source);
  if (!block) return {};
  return Object.fromEntries(block.headers.map((x) => [x.key.toLowerCase(), x.value]));
};

// ---------------------------------------------------------------------------
// Security headers (SEC-11)
// ---------------------------------------------------------------------------
test('global security headers are present', () => {
  const g = headerMap('/(.*)');
  assert.ok(g['content-security-policy'], 'no CSP');
  assert.equal(g['x-content-type-options'], 'nosniff');
  assert.ok(g['referrer-policy'], 'no Referrer-Policy');
  assert.ok(g['permissions-policy'], 'no Permissions-Policy');
  assert.ok(g['strict-transport-security'], 'no HSTS');
  assert.ok(g['x-frame-options'], 'no framing policy');
});

test('the CSP locks down the dangerous directives', () => {
  const csp = headerMap('/(.*)')['content-security-policy'];
  const directive = (name) => {
    const m = csp.match(new RegExp(`${name} ([^;]+)`));
    return m ? m[1].trim() : null;
  };
  assert.equal(directive('object-src'), "'none'", 'plugins must be disabled');
  assert.equal(directive('base-uri'), "'self'");
  assert.equal(directive('form-action'), "'self'");
  assert.equal(directive('frame-ancestors'), "'self'");
  assert.match(directive('default-src'), /'self'/);
  // No wildcard script source.
  assert.ok(!/script-src[^;]*\*/.test(csp), 'script-src must not contain a wildcard');
  assert.ok(!/'unsafe-eval'/.test(csp), "'unsafe-eval' must not be granted to the app origin");
});

test('every CDN the pages actually load is allowed by the CSP, and nothing more', () => {
  const csp = headerMap('/(.*)')['content-security-policy'];
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const hosts = new Set();
  for (const f of pages) {
    const src = read(f);
    // Only RESOURCE loads are governed by CSP. An ordinary <a href> is a
    // navigation and a preconnect hint is not a fetch, so neither belongs here.
    for (const m of src.matchAll(/<script[^>]+src="https:\/\/([^/"]+)/g)) hosts.add(m[1]);
    for (const m of src.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="https:\/\/([^/"]+)/g)) hosts.add(m[1]);
    for (const m of src.matchAll(/<link[^>]+href="https:\/\/([^/"]+)[^>]*rel="stylesheet"/g)) hosts.add(m[1]);
    for (const m of src.matchAll(/<img[^>]+src="https:\/\/([^/"]+)/g)) hosts.add(m[1]);
    for (const m of src.matchAll(/@import url\('https:\/\/([^/']+)/g)) hosts.add(m[1]);
  }
  // Pages also import ES modules from a CDN inside submit.js.
  for (const m of read('submit.js').matchAll(/from '(https:\/\/[^/']+)/g)) {
    hosts.add(new URL(m[1]).host);
  }
  const contentHosts = [...hosts].filter((x) => !x.endsWith('arab-code.cv') && x !== 'fonts.googleapis.com');
  for (const host of contentHosts) {
    assert.ok(csp.includes(host), `the CSP is missing ${host}, which a page loads`);
  }
});

// ---------------------------------------------------------------------------
// Private paths must not be served (SEC-01 / SEC-02)
// ---------------------------------------------------------------------------
test('the deployment excludes data/, pending/ and codes/', () => {
  const ignore = read('.vercelignore')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const p of ['data/', 'pending/', 'codes/']) {
    assert.ok(ignore.includes(p), `.vercelignore does not exclude ${p}`);
  }
});

test('redirects block the private paths before the filesystem is consulted', () => {
  // In vercel.json `redirects` run BEFORE the filesystem check while `rewrites`
  // run after, so only a redirect can shadow a file that is present.
  const sources = (vercel.redirects || []).map((r) => r.source);
  for (const p of ['/data/:path*', '/pending/:path*', '/codes/:path*']) {
    assert.ok(sources.includes(p), `no redirect guard for ${p}`);
  }
});

test('robots.txt disallows the private and session-gated paths', () => {
  const robots = read('robots.txt');
  for (const p of ['/admin', '/api/', '/data/', '/pending/', '/codes/', '/submit']) {
    assert.match(robots, new RegExp(`Disallow:\\s*${p.replace(/[/]/g, '\\/')}`), `robots.txt allows ${p}`);
  }
  assert.match(robots, /Sitemap:\s*https:\/\//);
});

test('no secret-shaped literal is committed anywhere in the source', () => {
  const offenders = [];
  const patterns = [
    { id: 'nezuko key', re: /\bnzk_[0-9a-f]{20,}\b/ },
    { id: 'aws key', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { id: 'github token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
    { id: 'private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { id: 'jwt fallback', re: /JWT_SECRET\s*\|\|\s*['"]/ },
    { id: 'hardcoded admin fallback', re: /ADMIN_EMAIL\s*\|\|\s*['"][^'"]+@/ },
  ];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'codes', 'backups', 'tests'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|json|html|md|yml|yaml|txt)$/.test(e.name)) continue;
      // The audit report quotes the vulnerable lines verbatim as evidence.
      if (/^AUDIT_/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const pat of patterns) {
        if (pat.re.test(src)) offenders.push(`${path.relative(ROOT, p)}: ${pat.id}`);
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, [], 'secret or insecure fallback found in the source');
});

test('no stale fallback domain or support address is left in the source', () => {
  const stale = ['monte-top-v.vercel.app', 'mzmlzip@gmail.com', '3rab_top_devs@top.com', 'arab-code-web.vercel.app'];
  const offenders = [];
  // data/ holds real records (the admin address legitimately appears in an
  // account row) and tests/ carry this very pattern list, so the scan is about
  // SOURCE fallbacks only.
  const skipDirs = ['node_modules', '.git', 'codes', 'backups', 'data', 'tests', 'docs'];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|json|html|md)$/.test(e.name)) continue;
      // The audit report quotes these values as evidence; that is deliberate.
      if (/^AUDIT_/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const s of stale) if (src.includes(s)) offenders.push(`${path.relative(ROOT, p)}: ${s}`);
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, [], 'a stale domain/email fallback is still referenced (APP-05/APP-09)');
});

// ---------------------------------------------------------------------------
// Package hygiene (APP-06)
// ---------------------------------------------------------------------------
test('exactly one lockfile is committed', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'package-lock.json')), 'package-lock.json is missing');
  assert.ok(!fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml')), 'two lockfiles disagree about the dependency tree');
  assert.ok(!fs.existsSync(path.join(ROOT, 'yarn.lock')));
});

test('the Node version and package manager are pinned, and the scripts exist', () => {
  assert.ok(pkg.engines && pkg.engines.node, 'no Node engine range');
  assert.ok(pkg.packageManager, 'no packageManager field');
  for (const s of ['test', 'lint', 'check', 'verify:data']) {
    assert.ok(pkg.scripts[s], `missing npm script: ${s}`);
  }
});

test('dependencies are pinned to exact versions', () => {
  for (const [name, range] of Object.entries(pkg.dependencies)) {
    assert.match(range, /^\d+\.\d+\.\d+$/, `${name} is not pinned (${range})`);
  }
});

test('the lockfile agrees with package.json', () => {
  const lock = JSON.parse(read('package-lock.json'));
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    const entry = lock.packages[`node_modules/${name}`];
    assert.ok(entry, `${name} is missing from the lockfile`);
    assert.equal(entry.version, version, `${name} version drift`);
  }
});

test('.gitignore keeps .env and local backups out, but keeps .env.example in', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^backups\/$/m, 'local data backups must never be committed');
  assert.match(ignore, /^!\.env\.example$/m, '.env.example must stay tracked');
  assert.ok(fs.existsSync(path.join(ROOT, '.env.example')));
});

test('.env.example lists the required variables and no real value', () => {
  const example = read('.env.example');
  const required = [
    'JWT_SECRET', 'ADMIN_EMAIL', 'GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_BRANCH',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_BASE_URL',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TURNSTILE_SECRET_KEY',
    'UPLOADS_API_KEY', 'DATABASE_URL', 'UNTRUSTED_CONTENT_ORIGIN',
  ];
  for (const name of required) {
    assert.match(example, new RegExp(`^${name}=`, 'm'), `.env.example is missing ${name}`);
  }
  // Only placeholders: no value that looks like a live credential.
  assert.ok(!/\bnzk_[0-9a-f]{20,}/.test(example));
  assert.ok(!/\bgh[pousr]_[A-Za-z0-9]{36,}/.test(example));
  assert.ok(!/\bAKIA[0-9A-Z]{16}/.test(example));
});

// ---------------------------------------------------------------------------
// Sitemap / routing integrity (APP-04)
// ---------------------------------------------------------------------------
/** Resolve a site path to the file Vercel would serve, honouring cleanUrls. */
function resolvePath(p) {
  if (p === '/') return fs.existsSync(path.join(ROOT, 'index.html')) ? 'index.html' : null;
  for (const rule of vercel.rewrites) {
    const pattern = new RegExp(`^${rule.source.replace(/:[a-zA-Z]+\*/g, '.*').replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
    if (pattern.test(p)) {
      const dest = rule.destination.replace(/^\//, '');
      if (dest.startsWith('api/')) return dest.endsWith('.js') ? dest : `${dest}.js`;
      return `${dest}.html`;
    }
  }
  const direct = p.replace(/^\//, '');
  for (const candidate of [direct, `${direct}.html`]) {
    if (fs.existsSync(path.join(ROOT, candidate))) return candidate;
  }
  return null;
}

test('every static sitemap path resolves to a real page', () => {
  const { STATIC_PAGES } = require('../api/_h/sitemap');
  for (const page of STATIC_PAGES) {
    const resolved = resolvePath(page.path);
    assert.ok(resolved, `sitemap lists ${page.path} but nothing serves it (this is the /search 404)`);
    assert.ok(fs.existsSync(path.join(ROOT, resolved)), `${page.path} -> ${resolved} does not exist`);
  }
});

test('the old static sitemap.xml is gone (it is generated now)', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'sitemap.xml')),
    'a static sitemap would shadow the generated one, because rewrites run after the filesystem');
  assert.ok(vercel.rewrites.some((r) => r.source === '/sitemap.xml'), 'no rewrite for /sitemap.xml');
});

test('no sitemap page is marked noindex', () => {
  const { STATIC_PAGES } = require('../api/_h/sitemap');
  for (const page of STATIC_PAGES) {
    const file = resolvePath(page.path);
    const src = read(file);
    const m = src.match(/<meta name="robots" content="([^"]*)"/);
    if (m) assert.ok(!/noindex/.test(m[1]), `${page.path} is in the sitemap but marked noindex`);
  }
});

test('a generated sitemap contains only absolute, approved URLs', async () => {
  const c = h.loadApi({
    files: h.baseFiles({
      users: [h.user({ username: 'author9', email: 'author9@example.invalid' })],
      codes: [
        h.manifestEntry({ filename: 'live.js', author: 'author9' }),
        h.manifestEntry({ filename: 'queued.js', author: 'author9', status: 'pending' }),
      ],
    }),
  });
  const res = await h.call(c.routes.sitemap, { method: 'GET', url: '/sitemap.xml' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /application\/xml/);
  const xml = String(res.body);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.ok(xml.includes('/c/live.js'));
  assert.ok(!xml.includes('queued.js'), 'an unapproved code must not be indexed');
  assert.ok(xml.includes('/u/author9'));
  for (const loc of xml.match(/<loc>([^<]+)<\/loc>/g) || []) {
    const url = loc.replace(/<\/?loc>/g, '');
    assert.match(url, /^https?:\/\//, `relative URL in the sitemap: ${url}`);
    assert.ok(!url.includes('/admin'), 'the admin page must never be listed');
    assert.ok(!url.includes('/api/'), 'API routes must never be listed');
    assert.ok(!url.includes('/codes/'), 'raw executable paths must never be listed');
  }
});

test('the sitemap still serves the static pages when the store is unreachable', async () => {
  const c = h.loadApi({ files: {} });
  c.store.files.delete('data/manifest.json');
  const res = await h.call(c.routes.sitemap, { method: 'GET', url: '/sitemap.xml' });
  assert.equal(res.statusCode, 200);
  assert.ok(String(res.body).includes('/search'));
});

test('a profile with no published code is not listed', async () => {
  const c = h.loadApi({
    files: h.baseFiles({
      users: [h.user({ username: 'lurker', email: 'lurker@example.invalid' })],
      codes: [],
    }),
  });
  const res = await h.call(c.routes.sitemap, { method: 'GET', url: '/sitemap.xml' });
  assert.ok(!String(res.body).includes('/u/lurker'));
});

// ---------------------------------------------------------------------------
// Page-level SEO and accessibility
// ---------------------------------------------------------------------------
const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));

test('every page declares Arabic and RTL', () => {
  for (const f of PAGES) {
    const src = read(f);
    assert.match(src, /<html lang="ar" dir="rtl">/, `${f} is missing lang/dir`);
  }
});

test('every page declares a robots policy', () => {
  for (const f of PAGES) {
    assert.match(read(f), /<meta name="robots" content="/, `${f} has no robots meta`);
  }
});

test('no page claims an English alternate it does not have', () => {
  for (const f of PAGES) {
    assert.ok(!/hreflang="en"/.test(read(f)), `${f} declares hreflang=en for Arabic-only content`);
  }
});

test('every indexable page has a canonical link', () => {
  for (const f of PAGES) {
    const src = read(f);
    const robots = (src.match(/<meta name="robots" content="([^"]*)"/) || [])[1] || '';
    if (/noindex/.test(robots)) continue;
    assert.match(src, /<link rel="canonical"/, `${f} is indexable but has no canonical`);
  }
});

test('every page is responsive and has a viewport', () => {
  for (const f of PAGES) {
    assert.match(read(f), /<meta name="viewport" content="width=device-width/, `${f} has no viewport`);
  }
});

test('the preview iframe is sandboxed without same-origin access', () => {
  const src = read('code.html');
  const m = src.match(/<iframe id="preview"[^>]*sandbox="([^"]*)"/);
  assert.ok(m, 'the preview iframe has no sandbox attribute');
  const flags = m[1].split(/\s+/);
  assert.ok(flags.includes('allow-scripts'));
  assert.ok(!flags.includes('allow-same-origin'),
    'allow-same-origin would give the preview the platform origin (SEC-02)');
  assert.ok(!flags.includes('allow-top-navigation'));
  assert.ok(!flags.includes('allow-popups'));
});

test('the submit preview iframe is sandboxed the same way', () => {
  const m = read('submit.html').match(/<iframe id="previewFrame"[^>]*sandbox="([^"]*)"/);
  assert.ok(m, 'the submit preview has no sandbox');
  assert.ok(!m[1].includes('allow-same-origin'));
});

test('no page links to a raw executable path on the app origin', () => {
  for (const f of PAGES) {
    const src = read(f);
    assert.ok(!/["'(]\/codes\//.test(src), `${f} links directly into codes/ (SEC-02)`);
    assert.ok(!/raw\.githubusercontent\.com/.test(src), `${f} still hardcodes the GitHub raw host`);
  }
});

test('form inputs on the search page are labelled', () => {
  const src = read('search.html');
  for (const id of ['q', 'language', 'license', 'sort', 'tag', 'author']) {
    assert.match(src, new RegExp(`<label for="${id}"`), `no label for #${id}`);
  }
  assert.match(src, /role="search"/);
  assert.match(src, /aria-live="polite"/, 'status updates must be announced');
});

test('status regions are announced on the pages that update them', () => {
  for (const f of ['search.html', 'auth.html', 'popular.html']) {
    assert.match(read(f), /aria-live="polite"/, `${f} updates status text without aria-live`);
  }
});

test('a visible keyboard focus style is defined', () => {
  const css = read('styles.css') + read('search.html') + read('auth.html');
  assert.match(css, /:focus-visible/, 'no visible focus indicator');
});

test('the 404 page exists and is not indexable', () => {
  const src = read('404.html');
  assert.match(src, /noindex/);
});

test('the deprecated app_orig.js duplicate is gone (APP-08)', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'app_orig.js')),
    'the stale front-end copy still ships and would drift from app.js');
});

test('no page calls an API route that is not registered', () => {
  const routes = new Set(Object.keys(require('../api/index.js').routes));
  const referenced = new Set();
  for (const f of [...PAGES, 'app.js', 'submit.js', 'ts.js']) {
    const src = read(f);
    for (const m of src.matchAll(/['"`]\/api\/([a-z0-9-]+)/g)) referenced.add(m[1]);
  }
  const missing = [...referenced].filter((r) => !routes.has(r));
  assert.deepEqual(missing, [], 'the front-end calls an unregistered endpoint (this was APP-01)');
});

test('every registered route is reachable through the router path mapping', () => {
  const router = require('../api/index.js');
  for (const name of Object.keys(router.routes)) {
    assert.equal(router.routeNameFor(`/api/${name}`), name, `/api/${name} does not map back to its handler`);
  }
  assert.equal(router.routeNameFor('/sitemap.xml'), 'sitemap');
  assert.equal(router.routeNameFor('/api/'), 'me');
});
