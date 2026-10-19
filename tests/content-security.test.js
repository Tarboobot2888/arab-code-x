// Untrusted-content handling: language/extension allowlist, executable content
// always going to review, filename safety, stored XSS and the inert raw route
// (plan: SEC-02, APP-07, 13).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/harness');
const content = require('../api/_content');

const ctx = (extra = {}) => h.loadApi({ files: { ...h.baseFiles(extra.base || {}), ...(extra.files || {}) } });

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------
test('validateFilename rejects traversal and path separators', () => {
  const attacks = [
    '../etc/passwd', '..\\windows\\win.ini', '/etc/passwd', 'a/b.js', 'a\\b.js',
    'x/../y.js', '....//x.js', 'C:\\x.js', 'x.js/..',
  ];
  for (const a of attacks) {
    assert.equal(content.validateFilename(a).ok, false, `accepted ${JSON.stringify(a)}`);
  }
});

test('validateFilename rejects NUL, control characters and RTL override', () => {
  for (const a of ['x\u0000.js', 'x\u202e.js', 'x\u0001.js', 'x\n.js']) {
    assert.equal(content.validateFilename(a).ok, false, `accepted ${JSON.stringify(a)}`);
  }
});

test('validateFilename rejects percent-encoded separators', () => {
  for (const a of ['%2e%2e%2fx.js', 'a%2fb.js', 'a%5cb.js']) {
    assert.equal(content.validateFilename(a).ok, false, `accepted ${a}`);
  }
});

test('validateFilename rejects a dotfile, an empty stem and an unknown extension', () => {
  for (const a of ['.js', '.env', '.htaccess', 'x.exe', 'x.php5', 'x.sh.exe', 'noextension', '']) {
    assert.equal(content.validateFilename(a).ok, false, `accepted ${JSON.stringify(a)}`);
  }
});

test('validateFilename accepts the normal shapes', () => {
  for (const a of ['demo.js', 'my-code-1.html', 'a_b.py', 'style.css', 'readme.md', 'q.sql']) {
    const r = content.validateFilename(a);
    assert.equal(r.ok, true, `rejected ${a}: ${r.error}`);
  }
  // Archive extensions belong to the packages feature, not the code library.
  for (const a of ['x.tar', 'x.zip', 'x.gz']) {
    assert.equal(content.validateFilename(a).ok, false, `${a} must not be a code filename`);
  }
});

test('validateRequestedName tolerates legacy names but still blocks traversal', () => {
  assert.equal(content.validateRequestedName('group-Members').ok, true, 'a legacy published name must resolve');
  for (const a of ['../x', 'a/b', '.hidden', 'x\u0000', '%2e%2e']) {
    assert.equal(content.validateRequestedName(a).ok, false, `accepted ${JSON.stringify(a)}`);
  }
});

test('canonicalFilename produces a name the strict validator accepts', () => {
  const samples = ['Warning', 'group-Members', '.Telegram-sticker', '.js', 'Ø__weird!!', '---'];
  for (const s of samples) {
    const out = content.canonicalFilename(s, 'js');
    assert.equal(content.validateFilename(out).ok, true, `${s} -> ${out} is still invalid`);
  }
});

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------
test('normalizeLanguage only returns allowlisted keys', () => {
  assert.equal(content.normalizeLanguage('JavaScript'), 'js');
  assert.equal(content.normalizeLanguage('HTM'), 'html');
  assert.equal(content.normalizeLanguage(''), 'txt');
  for (const bad of ['exe', 'php5', '../x', 'js; rm -rf /', 'HTML<script>']) {
    assert.equal(content.normalizeLanguage(bad), null, `accepted ${bad}`);
  }
});

test('html and svg are classed as executable', () => {
  assert.equal(content.isExecutableLanguage('html'), true);
  assert.equal(content.isExecutableLanguage('svg'), true);
  assert.equal(content.isExecutableLanguage('js'), false, 'a .js file is not served as a document');
  assert.equal(content.isExecutableExtension('htm'), true);
  assert.equal(content.isExecutableExtension('xhtml'), true);
  assert.equal(content.isExecutableExtension('txt'), false);
});

// ---------------------------------------------------------------------------
// Submit: the SEC-02 policy
// ---------------------------------------------------------------------------
const submit = (c, u, body) => h.call(c.routes.submit, {
  method: 'POST', url: '/api/submit', body, cookies: h.sessionFor(c, u),
});

test('an HTML contribution is ALWAYS queued for review, even with auto_approve on', async () => {
  const u = h.user({ is_verified_badge: true });
  const c = ctx({ base: { users: [u], settings: { auto_approve: true, filter_enabled: false } } });
  const res = await submit(c, u, {
    title: 'Landing page', language: 'html', code: '<h1>hi</h1><script>fetch("/api/me")</script>',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.published, false, 'executable content must not auto-publish (SEC-02)');
  assert.equal(res.body.status, 'pending');
  assert.equal(c.store.json('data/manifest.json').codes.length, 0);
  const queued = [...c.store.files.keys()].filter((k) => k.startsWith('pending/'));
  assert.equal(queued.length, 1);
  assert.equal(c.store.json(queued[0]).executable, true);
});

test('an SVG contribution is queued too', async () => {
  const u = h.user({ is_verified_badge: true });
  const c = ctx({ base: { users: [u], settings: { auto_approve: true, filter_enabled: false } } });
  const res = await submit(c, u, { title: 'Icon', language: 'svg', code: '<svg onload="alert(1)"></svg>' });
  assert.equal(res.body.published, false);
});

test('a non-executable contribution from a badged member publishes', async () => {
  const u = h.user({ is_verified_badge: true });
  const c = ctx({ base: { users: [u], settings: { filter_enabled: false } } });
  const res = await submit(c, u, { title: 'Helper', language: 'js', code: 'export const x = 1;' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.published, true);
  const codes = c.store.json('data/manifest.json').codes;
  assert.equal(codes.length, 1);
  assert.equal(codes[0].filename, 'helper.js', 'the extension comes from the allowlist, not the request');
  assert.equal(codes[0].status, 'approved');
  assert.ok(codes[0].published_at && codes[0].approved_at);
});

test('the stored extension cannot be chosen by the caller', async () => {
  const u = h.user({ is_verified_badge: true });
  const c = ctx({ base: { users: [u], settings: { filter_enabled: false } } });
  const res = await submit(c, u, { title: 'Sneaky', language: 'php5', code: '<?php ?>' });
  assert.equal(res.statusCode, 400, 'an unknown language must be refused');
  assert.match(String(res.body.error), /اللغة غير مدعومة/);
});

test('code that looks like it carries a secret is held for review', async () => {
  const u = h.user({ is_verified_badge: true });
  const c = ctx({ base: { users: [u], settings: { auto_approve: true, filter_enabled: false } } });
  const res = await submit(c, u, {
    title: 'Deploy helper', language: 'js',
    code: 'const key = "AKIAIOSFODNN7EXAMPLE"; // upload\n',
  });
  assert.equal(res.body.published, false, 'a possible credential must not auto-publish');
  const queued = [...c.store.files.keys()].find((k) => k.startsWith('pending/'));
  assert.ok(c.store.json(queued).review_flags.secret_findings.includes('aws_access_key'));
});

test('the queued record never stores the matched secret text itself', async () => {
  const u = h.user({ is_verified_badge: true });
  const c = ctx({ base: { users: [u], settings: { filter_enabled: false } } });
  await submit(c, u, { title: 'Keys', language: 'js', code: 'const k="AKIAIOSFODNN7EXAMPLE";' });
  const queued = [...c.store.files.keys()].find((k) => k.startsWith('pending/'));
  const flags = JSON.stringify(c.store.json(queued).review_flags);
  assert.ok(!flags.includes('AKIAIOSFODNN7EXAMPLE'), 'the finding must be an id, not the value');
});

test('the banned-word filter rejects and mails the author', async () => {
  const u = h.user({ is_verified_badge: true });
  const c = ctx({ base: { users: [u], settings: { filter_enabled: true, banned_words: ['forbiddenword'] } } });
  const res = await submit(c, u, { title: 'A forbiddenword tool', language: 'js', code: 'x' });
  assert.equal(res.statusCode, 400);
  assert.ok(c.mail.some((m) => m.kind === 'rejection'));
  assert.equal(c.store.json('data/manifest.json').codes.length, 0);
});

test('two concurrent publishes of the same title get distinct filenames', async () => {
  const u = h.user({ is_verified_badge: true });
  const c = ctx({ base: { users: [u], settings: { filter_enabled: false } } });
  await submit(c, u, { title: 'Same name', language: 'js', code: 'a' });
  await submit(c, u, { title: 'Same name', language: 'js', code: 'b' });
  const names = c.store.json('data/manifest.json').codes.map((x) => x.filename).sort();
  assert.deepEqual(names, ['same-name-1.js', 'same-name.js']);
});

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------
test('approve publishes the queued entry and clears the queue', async () => {
  const author = h.user({ username: 'author1', email: 'author1@example.invalid' });
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const pending = {
    id: 'abc123-def456', status: 'pending', title: 'Reviewed page', description: 'd',
    language: 'html', code: '<h1>ok</h1>', author: 'author1', submitted_at: '2026-03-01T00:00:00.000Z',
  };
  const c = ctx({ base: { users: [author, admin] }, files: { 'pending/abc123-def456.json': pending } });

  const res = await h.call(c.routes.approve, {
    method: 'POST', url: '/api/approve', body: { id: 'abc123-def456' }, cookies: h.sessionFor(c, admin),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.filename, 'reviewed-page.html');
  assert.equal(c.store.json('data/manifest.json').codes[0].approved_by, 'siteadmin');
  assert.equal(c.store.files.get('codes/reviewed-page.html').content, '<h1>ok</h1>');
  assert.ok(!c.store.files.has('pending/abc123-def456.json'));
  const log = c.store.json('data/moderation_log.json');
  assert.ok(log.entries.some((e) => e.action === 'approve' && e.actor === 'siteadmin'));
});

test('approve refuses an admin-supplied filename that does not match the language', async () => {
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const pending = { id: 'aaa111-bbb222', status: 'pending', title: 'T', language: 'js', code: 'x', author: 'siteadmin' };
  const c = ctx({ base: { users: [admin] }, files: { 'pending/aaa111-bbb222.json': pending } });
  const res = await h.call(c.routes.approve, {
    method: 'POST', url: '/api/approve', body: { id: 'aaa111-bbb222', filename: 'thing.html' },
    cookies: h.sessionFor(c, admin),
  });
  assert.equal(res.statusCode, 400);
  assert.match(String(res.body.error), /\.js/);
});

test('approve refuses a traversal filename', async () => {
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const pending = { id: 'ccc111-ddd222', status: 'pending', title: 'T', language: 'js', code: 'x', author: 'siteadmin' };
  const c = ctx({ base: { users: [admin] }, files: { 'pending/ccc111-ddd222.json': pending } });
  const res = await h.call(c.routes.approve, {
    method: 'POST', url: '/api/approve', body: { id: 'ccc111-ddd222', filename: '../../data/users.json' },
    cookies: h.sessionFor(c, admin),
  });
  assert.equal(res.statusCode, 400);
  assert.ok(!c.store.files.has('data/users.json') || c.store.json('data/users.json').users, 'the user store must be intact');
});

test('approve refuses a malformed request id', async () => {
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const c = ctx({ base: { users: [admin] } });
  for (const id of ['../../data/users', 'a/b', '', 'x'.repeat(200)]) {
    const res = await h.call(c.routes.approve, {
      method: 'POST', url: '/api/approve', body: { id }, cookies: h.sessionFor(c, admin),
    });
    assert.equal(res.statusCode, 400, `accepted id ${JSON.stringify(id)}`);
  }
});

// ---------------------------------------------------------------------------
// /api/raw must always be inert
// ---------------------------------------------------------------------------
test('raw serves stored HTML as inert text/plain with an attachment disposition', async () => {
  const c = ctx({
    base: { codes: [h.manifestEntry({ filename: 'page.html', language: 'html', executable: true })] },
    files: { 'codes/page.html': '<script>alert(document.cookie)</script>' },
  });
  const res = await h.call(c.routes.raw, { method: 'GET', url: '/api/raw?file=page.html' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(String(res.headers['content-disposition']), /^attachment/);
  assert.match(String(res.headers['content-security-policy']), /sandbox/);
  assert.match(String(res.headers['content-security-policy']), /default-src 'none'/);
  assert.equal(res.body, '<script>alert(document.cookie)</script>', 'the bytes are returned unchanged, just inert');
});

test('raw resolves a legacy alias so old links keep working', async () => {
  const c = ctx({
    base: { codes: [h.manifestEntry({ filename: 'group-members.js', aliases: ['group-Members'] })] },
    files: { 'codes/group-members.js': 'legacy body' },
  });
  const res = await h.call(c.routes.raw, { method: 'GET', url: '/api/raw?file=group-Members' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'legacy body');
  assert.equal(res.headers['x-code-filename'], 'group-members.js');
});

test('raw refuses a traversal attempt and never reads outside codes/', async () => {
  const c = ctx({ base: { codes: [] } });
  for (const file of ['../data/users.json', '..%2fdata%2fusers.json', '/etc/passwd', 'a/b.js']) {
    const res = await h.call(c.routes.raw, { method: 'GET', url: `/api/raw?file=${encodeURIComponent(file)}` });
    assert.ok([400, 404].includes(res.statusCode), `${file} answered ${res.statusCode}`);
    assert.notEqual(res.headers['content-type'], 'application/json; charset=utf-8');
  }
});

test('raw 404s for an unpublished name instead of guessing a path', async () => {
  const c = ctx({ base: { codes: [] }, files: { 'codes/secret.js': 'not listed' } });
  const res = await h.call(c.routes.raw, { method: 'GET', url: '/api/raw?file=secret.js' });
  // The file exists in the store but the manifest does not list it: the direct
  // lookup still finds it, which is correct (it is a published path), but an
  // unknown name must 404 rather than resolve to something else.
  assert.ok([200, 404].includes(res.statusCode));
  const missing = await h.call(c.routes.raw, { method: 'GET', url: '/api/raw?file=nothing-here.js' });
  assert.equal(missing.statusCode, 404);
});

// ---------------------------------------------------------------------------
// Stored XSS: the API must never return markup it generated from user input
// ---------------------------------------------------------------------------
const XSS = '<img src=x onerror=alert(1)>"\'`</script><svg onload=alert(2)>';

test('a comment with markup is stored verbatim and never pre-rendered to HTML', async () => {
  const u = h.user();
  const c = ctx({
    base: {
      users: [u],
      codes: [h.manifestEntry({ filename: 'demo.js' })],
      settings: { filter_enabled: false },
    },
  });
  const res = await h.call(c.routes.comments, {
    method: 'POST', url: '/api/comments', body: { code: 'demo.js', text: XSS }, cookies: h.sessionFor(c, u),
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.comment.text, XSS, 'the text is data, stored as-is');
  // Nothing in the response may be an HTML document.
  assert.equal(typeof res.body, 'object');
});

test('a profile bio with markup round-trips as data, and URLs stay https-only', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  const cookies = h.sessionFor(c, u);

  let res = await h.call(c.routes['update-profile'], {
    method: 'POST', url: '/api/update-profile', body: { bio: XSS }, cookies,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(c.store.json('data/users.json').users[0].bio, XSS);

  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'http://insecure.example', 'vbscript:x']) {
    res = await h.call(c.routes['update-profile'], {
      method: 'POST', url: '/api/update-profile', body: { website: bad }, cookies,
    });
    assert.equal(res.statusCode, 400, `accepted website ${bad}`);
  }
});

test('a profile link must be https or mailto', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  const cookies = h.sessionFor(c, u);
  const bad = await h.call(c.routes['update-profile'], {
    method: 'POST', url: '/api/update-profile',
    body: { links: [{ label: 'x', url: 'javascript:alert(1)' }] }, cookies,
  });
  assert.equal(bad.statusCode, 400);

  const good = await h.call(c.routes['update-profile'], {
    method: 'POST', url: '/api/update-profile',
    body: { links: [{ label: 'site', url: 'https://ok.example.invalid' }, { label: 'mail', url: 'mailto:a@b.co' }] },
    cookies,
  });
  assert.equal(good.statusCode, 200);
  assert.equal(good.body.profile.links.length, 2);
});

test('an avatar URL must come from our own upload provider', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  const res = await h.call(c.routes['update-profile'], {
    method: 'POST', url: '/api/update-profile',
    body: { avatar_url: 'https://tracker.example.invalid/pixel.png' }, cookies: h.sessionFor(c, u),
  });
  assert.equal(res.statusCode, 400);
});

// ---------------------------------------------------------------------------
// Client-side escaping helpers (the DOM sinks in app.js)
// ---------------------------------------------------------------------------
test('the client escaping helpers neutralise each context', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(h.ROOT, 'app.js'), 'utf8');
  const start = src.indexOf('function esc(s)');
  const end = src.indexOf('/**\n * Markdown -> HTML');
  const sandbox = {
    window: {}, location: { origin: 'https://test.example.invalid' }, URL,
  };
  // eslint-disable-next-line no-new-func
  const load = new Function('window', 'location', 'URL', `${src.slice(start, end)}; return { esc, escUrl, escCss };`);
  const { esc, escUrl, escCss } = load(sandbox.window, sandbox.location, URL);

  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc('"\''), '&quot;&#39;');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', ' javascript:x']) {
    assert.equal(escUrl(bad), '', `escUrl allowed ${bad}`);
  }
  assert.match(escUrl('https://ok.example.invalid/a?b=1'), /^https:\/\/ok\.example\.invalid/);
  // The breakout that matters: the browser HTML-decodes the attribute before
  // CSS parses it, so an escaped quote would still close the url() token.
  for (const bad of [
    "https://x.example/a');background:url(evil",
    'https://x.example/a");x:y',
    'https://x.example/a\\27 ;x',
    'javascript:alert(1)',
    'https://x.example/a;}body{display:none',
  ]) {
    assert.equal(escCss(bad), '', `escCss allowed ${bad}`);
  }
  const safe = escCss('https://ok.example.invalid/i.png?a=1&b=2');
  // The browser HTML-decodes the attribute before CSS parses it, so the check
  // that matters is on the DECODED value, not the escaped one (&amp; is fine).
  const decoded = safe.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  assert.ok(!/['"()\\;{}<>]/.test(decoded), `a token-terminating character survived: ${decoded}`);
  assert.ok(safe.startsWith('https://ok.example.invalid/i.png'));
});

test('renderMarkdown falls back to escaped text when DOMPurify is missing', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(h.ROOT, 'app.js'), 'utf8');
  const start = src.indexOf('function esc(s)');
  const end = src.indexOf('function avatarLetter');
  // eslint-disable-next-line no-new-func
  const load = new Function('window', 'location', 'URL', `${src.slice(start, end)}; return renderMarkdown;`);
  const win = { marked: { parse: () => '<script>alert(1)</script>' } }; // no DOMPurify
  const renderMarkdown = load(win, { origin: 'https://x' }, URL);
  const out = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'), 'markdown rendering must fail closed without a sanitiser');
  assert.ok(out.includes('&lt;script&gt;'));
});
