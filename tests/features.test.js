// Likes, statistics, Arabic search, the quality card and the moderation trail
// (plan: APP-01, APP-02, 7.1 P0, 7.2.ج, 13).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/harness');
const search = require('../api/_search');
const content = require('../api/_content');

const ctx = (extra = {}) => h.loadApi({ files: { ...h.baseFiles(extra.base || {}), ...(extra.files || {}) } });

// ---------------------------------------------------------------------------
// Likes (APP-01)
// ---------------------------------------------------------------------------
test('the likes endpoint exists and is registered on the router', () => {
  const c = ctx();
  assert.equal(typeof c.routes.likes, 'function', '/api/likes was called by popular.html but never registered');
});

test('a like toggles on and off and the total follows', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u], codes: [h.manifestEntry({ filename: 'demo.js' })] } });
  const cookies = h.sessionFor(c, u);
  const toggle = () => h.call(c.routes.likes, { method: 'POST', url: '/api/likes', body: { code: 'demo.js' }, cookies });

  let res = await toggle();
  assert.deepEqual({ like: res.body.like, total: res.body.total }, { like: true, total: 1 });
  res = await toggle();
  assert.deepEqual({ like: res.body.like, total: res.body.total }, { like: false, total: 0 });
  res = await toggle();
  assert.deepEqual({ like: res.body.like, total: res.body.total }, { like: true, total: 1 });
});

test('GET reports the caller\'s own like state', async () => {
  const u = h.user();
  const other = h.user({ username: 'other2', email: 'other2@example.invalid' });
  const c = ctx({
    base: {
      users: [u, other],
      codes: [h.manifestEntry({ filename: 'demo.js' })],
      interactions: { likes: { 'other2|demo.js': '2026-01-01T00:00:00.000Z' } },
    },
  });
  const mine = await h.call(c.routes.likes, { method: 'GET', url: '/api/likes?code=demo.js', cookies: h.sessionFor(c, u) });
  assert.deepEqual({ like: mine.body.like, total: mine.body.total }, { like: false, total: 1 });

  const theirs = await h.call(c.routes.likes, { method: 'GET', url: '/api/likes?code=demo.js', cookies: h.sessionFor(c, other) });
  assert.equal(theirs.body.like, true);

  const anon = await h.call(c.routes.likes, { method: 'GET', url: '/api/likes?code=demo.js' });
  assert.deepEqual({ like: anon.body.like, total: anon.body.total }, { like: false, total: 1 });
});

test('?top=1 ranks by total and is cacheable', async () => {
  const c = ctx({
    base: {
      codes: [h.manifestEntry({ filename: 'a.js' }), h.manifestEntry({ filename: 'b.js' })],
      interactions: {
        likes: {
          'u1|a.js': 'x', 'u2|a.js': 'x', 'u3|a.js': 'x',
          'u1|b.js': 'x',
        },
      },
    },
  });
  const res = await h.call(c.routes.likes, { method: 'GET', url: '/api/likes?top=1' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.top, [{ code: 'a.js', total: 3 }, { code: 'b.js', total: 1 }]);
  assert.match(String(res.headers['cache-control']), /s-maxage/);
});

test('likes cannot be attached to a code that is not published', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u], codes: [] } });
  const res = await h.call(c.routes.likes, {
    method: 'POST', url: '/api/likes', body: { code: 'ghost.js' }, cookies: h.sessionFor(c, u),
  });
  assert.equal(res.statusCode, 404);
});

test('totals are derived from the keys, so a tampered likeTotals is corrected', async () => {
  const u = h.user();
  const c = ctx({
    base: {
      users: [u],
      codes: [h.manifestEntry({ filename: 'demo.js' })],
      interactions: { likes: {}, likeTotals: { 'demo.js': 9999 } },
    },
  });
  const res = await h.call(c.routes.likes, {
    method: 'POST', url: '/api/likes', body: { code: 'demo.js' }, cookies: h.sessionFor(c, u),
  });
  assert.equal(res.body.total, 1, 'an inflated counter must be recomputed from the keys');
  assert.equal(c.store.json('data/interactions.json').likeTotals['demo.js'], 1);
});

test('recomputeTotals ignores falsy and malformed keys', () => {
  const { recomputeTotals } = require('../api/_h/likes');
  const totals = recomputeTotals({
    'a|x.js': 'date', 'b|x.js': 'date', 'c|y.js': 'date',
    'malformed-no-pipe': 'date', 'd|': 'date', 'e|z.js': null,
  });
  assert.deepEqual(totals, { 'x.js': 2, 'y.js': 1 });
});

// ---------------------------------------------------------------------------
// Stats (APP-02)
// ---------------------------------------------------------------------------
test('stats reads the real sources and the real timestamp field', async () => {
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const old = '2020-01-01T00:00:00.000Z';
  const c = ctx({
    base: {
      users: [
        admin,
        h.user({ username: 'm1', email: 'm1@example.invalid', created_at: recent }),
        h.user({ username: 'm2', email: 'm2@example.invalid', verified: false, created_at: old }),
        h.user({ username: 'm3', email: 'm3@example.invalid', provider: 'google', created_at: old }),
      ],
      codes: [
        // Only `approved_at` is set, exactly like the rows the audited handler
        // counted with `published_at` and therefore always scored as 0.
        h.manifestEntry({ filename: 'new.js', approved_at: recent, published_at: undefined }),
        h.manifestEntry({ filename: 'old.js', approved_at: old, published_at: old }),
        h.manifestEntry({ filename: 'page.html', language: 'html', executable: true, approved_at: old, published_at: old }),
      ],
      interactions: {
        comments: [{ id: 'c1', code: 'new.js', author: 'm1', text: 'x', created_at: recent }],
        likes: { 'm1|new.js': recent },
        reports: [{ id: 'r1', reporter: 'm1', text: 'x', status: 'open', created_at: recent },
          { id: 'r2', reporter: 'm1', text: 'y', status: 'dismissed', created_at: recent }],
      },
    },
    files: {
      // Pending items are files under pending/, not data/pending.json.
      'pending/aaa111-bbb222.json': { id: 'aaa111-bbb222', status: 'pending', author: 'm1', title: 'q', code: 'x' },
      'pending/ccc333-ddd444.json': { id: 'ccc333-ddd444', status: 'pending', author: 'm1', title: 'r', code: 'y' },
      // Delete requests live in the underscore filename.
      'data/delete_requests.json': {
        items: [
          { id: 'd1', filename: 'old.js', author: 'm1', status: 'pending', created_at: recent },
          { id: 'd2', filename: 'old.js', author: 'm1', status: 'approved', created_at: old },
        ],
      },
    },
  });

  const res = await h.call(c.routes.stats, { method: 'GET', url: '/api/stats', cookies: h.sessionFor(c, admin) });
  assert.equal(res.statusCode, 200);
  const s = res.body.stats;
  assert.equal(s.users, 4);
  assert.equal(s.unconfirmed_users, 1);
  assert.equal(s.google_users, 1);
  assert.equal(s.codes, 3);
  assert.equal(s.executable_codes, 1);
  assert.equal(s.pending, 2, 'pending must be counted from the pending/ directory');
  assert.equal(s.delete_requests, 1, 'only the open delete request counts');
  assert.equal(s.comments, 1);
  assert.equal(s.open_reports, 1);
  assert.equal(s.likes, 1);
  assert.equal(s.new_users_week, 1);
  assert.equal(s.new_codes_week, 1, 'approved_at must be accepted as the publication time (APP-02)');
  assert.deepEqual(s.top_languages[0], ['js', 2]);
});

test('stats returns zeros, not an error, on an empty platform', async () => {
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const c = ctx({ base: { users: [admin] } });
  const res = await h.call(c.routes.stats, { method: 'GET', url: '/api/stats', cookies: h.sessionFor(c, admin) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stats.pending, 0);
  assert.equal(res.body.stats.delete_requests, 0);
  assert.equal(res.body.stats.new_codes_week, 0);
});

// ---------------------------------------------------------------------------
// Arabic search normalisation
// ---------------------------------------------------------------------------
test('normalisation folds hamza, ya, ta-marbuta, diacritics and tatweel', () => {
  const n = search.normalize;
  assert.equal(n('إضافة'), n('اضافة'));
  assert.equal(n('أحمد'), n('احمد'));
  assert.equal(n('آلة'), n('اله'));
  assert.equal(n('مُحَمَّد'), n('محمد'));
  assert.equal(n('مـــرحـبا'), n('مرحبا'));
  assert.equal(n('على'), n('علي'));
  assert.equal(n('مكتبة'), n('مكتبه'));
  assert.equal(n('مسؤول'), n('مسوول'));
});

test('normalisation unifies digits, case and whitespace', () => {
  const n = search.normalize;
  assert.equal(n('كود ٣'), n('كود 3'));
  assert.equal(n('۴۵'), '45');
  assert.equal(n('  Hello   WORLD  '), 'hello world');
  assert.equal(n('a​b'), 'ab', 'zero-width characters must be stripped');
});

test('search finds an Arabic title written with a different hamza', () => {
  const codes = [
    h.manifestEntry({ filename: 'add.js', title: 'إضافة ميتا للجروب' }),
    h.manifestEntry({ filename: 'dl.js', title: 'تحميل فيديو' }),
  ];
  const r = search.searchCodes(codes, { q: 'اضافه' });
  assert.equal(r.total, 1);
  assert.equal(r.codes[0].filename, 'add.js');
});

test('search requires every term to match (AND)', () => {
  const codes = [
    h.manifestEntry({ filename: 'a.js', title: 'تحميل فيديو من انستجرام' }),
    h.manifestEntry({ filename: 'b.js', title: 'تحميل صور' }),
  ];
  assert.equal(search.searchCodes(codes, { q: 'تحميل فيديو' }).total, 1);
  assert.equal(search.searchCodes(codes, { q: 'تحميل' }).total, 2);
  assert.equal(search.searchCodes(codes, { q: 'تحميل مفقود' }).total, 0);
});

test('an exact title outranks a description match', () => {
  const codes = [
    h.manifestEntry({ filename: 'x.js', title: 'other', description: 'qr generator inside' }),
    h.manifestEntry({ filename: 'qr.js', title: 'qr' }),
  ];
  const r = search.searchCodes(codes, { q: 'qr' });
  assert.equal(r.codes[0].filename, 'qr.js');
});

test('filters narrow by language, tag, licence and author', () => {
  const codes = [
    h.manifestEntry({ filename: 'a.js', language: 'js', tags: ['bot'], license: 'MIT', author: 'alpha' }),
    h.manifestEntry({ filename: 'b.py', language: 'py', tags: ['cli'], license: 'Apache-2.0', author: 'beta' }),
  ];
  assert.equal(search.searchCodes(codes, { language: 'py' }).codes[0].filename, 'b.py');
  assert.equal(search.searchCodes(codes, { tag: 'bot' }).codes[0].filename, 'a.js');
  assert.equal(search.searchCodes(codes, { license: 'apache-2.0' }).codes[0].filename, 'b.py');
  assert.equal(search.searchCodes(codes, { author: 'ALPHA' }).codes[0].filename, 'a.js');
});

test('pagination reports total, page and pages', () => {
  const codes = Array.from({ length: 30 }, (_, i) =>
    h.manifestEntry({ filename: `c${i}.js`, title: `code ${i}` }));
  const r = search.searchCodes(codes, { perPage: 10, page: 2 });
  assert.equal(r.total, 30);
  assert.equal(r.pages, 3);
  assert.equal(r.page, 2);
  assert.equal(r.codes.length, 10);
  const over = search.searchCodes(codes, { perPage: 10, page: 99 });
  assert.equal(over.codes.length, 0, 'a page past the end is empty, not an error');
});

test('an empty result set comes with useful suggestions', () => {
  const codes = [
    h.manifestEntry({ filename: 'a.js', language: 'js', tags: ['bot', 'telegram'], title: 'تحميل فيديو' }),
    h.manifestEntry({ filename: 'b.py', language: 'py', tags: ['bot'] }),
  ];
  const s = search.suggestions(codes, { q: 'تحم' });
  assert.ok(s.languages.length);
  assert.deepEqual(s.tags[0], { value: 'bot', count: 2 });
  assert.ok(s.near.some((n) => n.filename === 'a.js'), 'a near match should be offered');
});

test('the search route only returns approved codes and reports facets', async () => {
  const c = ctx({
    base: {
      codes: [
        h.manifestEntry({ filename: 'live.js', title: 'منشور' }),
        h.manifestEntry({ filename: 'draft.js', title: 'منشور', status: 'pending' }),
      ],
    },
  });
  const res = await h.call(c.routes.search, { method: 'GET', url: '/api/search?q=منشور' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.codes.map((x) => x.filename), ['live.js']);
  assert.ok(Array.isArray(res.body.facets.languages));
  assert.ok(res.body.facets.licenses.includes('MIT'));
});

test('the list route hides anything not approved', async () => {
  const c = ctx({
    base: {
      codes: [
        h.manifestEntry({ filename: 'ok.js' }),
        h.manifestEntry({ filename: 'queued.js', status: 'pending' }),
        h.manifestEntry({ filename: 'legacy.js', status: undefined }),
      ],
    },
  });
  const res = await h.call(c.routes.list, { method: 'GET', url: '/api/list' });
  const names = res.body.codes.map((x) => x.filename).sort();
  assert.deepEqual(names, ['legacy.js', 'ok.js'], 'rows predating the status field stay public');
});

// ---------------------------------------------------------------------------
// Badges must not be derivable from a username (APP-03)
// ---------------------------------------------------------------------------
test('trust markers come from the record, never from the username', async () => {
  const ziad = h.user({ username: 'ziad', email: 'ziad@example.invalid' });
  const c = ctx({ base: { users: [ziad], codes: [h.manifestEntry({ filename: 'z.js', author: 'ziad' })] } });
  const res = await h.call(c.routes.list, { method: 'GET', url: '/api/list' });
  const row = res.body.codes[0];
  assert.equal(row.author_is_admin, false, 'a username must never confer admin status');
  assert.equal(row.author_verified, false);

  const src = require('fs').readFileSync(require('path').join(h.ROOT, 'app.js'), 'utf8');
  const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''); // ignore comments
  assert.ok(!/['"]ziad['"]/.test(code), 'app.js still hardcodes a privileged username');
});

test('a snapshot badge on a manifest row cannot survive if the account lost it', async () => {
  const u = h.user({ username: 'demoted', email: 'demoted@example.invalid', is_verified_badge: false });
  const c = ctx({
    base: {
      users: [u],
      codes: [h.manifestEntry({ filename: 'd.js', author: 'demoted', author_verified: true })],
    },
  });
  const res = await h.call(c.routes.list, { method: 'GET', url: '/api/list' });
  assert.equal(res.body.codes[0].author_verified, false, 'the live record is the source of truth');
});

test('a code whose author no longer exists loses every badge', async () => {
  const c = ctx({ base: { users: [], codes: [h.manifestEntry({ filename: 'orphan.js', author: 'gone', author_verified: true })] } });
  const res = await h.call(c.routes.list, { method: 'GET', url: '/api/list' });
  assert.equal(res.body.codes[0].author_verified, false);
  assert.equal(res.body.codes[0].author_is_admin, false);
});

// ---------------------------------------------------------------------------
// Quality card (plan 7.2.ج)
// ---------------------------------------------------------------------------
test('the quality card scores metadata, licence, size and secrets', () => {
  const good = content.qualityCard({
    title: 'QR generator', description: 'يولّد صور QR من نص عربي أو إنجليزي بدون مكتبات خارجية.',
    language: 'js', code: 'export const qr = () => {};', license: 'MIT',
  });
  assert.equal(good.score, 100, JSON.stringify(good.checks));
  assert.equal(good.requires_review, false);

  const bad = content.qualityCard({
    title: 'x', description: '', language: 'nope', code: '', license: 'whatever',
  });
  assert.ok(bad.score < 50);
  const failed = bad.checks.filter((ch) => !ch.ok).map((ch) => ch.id);
  for (const id of ['language', 'title', 'description', 'license', 'size']) {
    assert.ok(failed.includes(id), `${id} should have failed`);
  }
});

test('the quality card flags executable content as needing review', () => {
  const card = content.qualityCard({ title: 'Page', description: 'x'.repeat(30), language: 'html', code: '<h1>a</h1>', license: 'MIT' });
  assert.equal(card.executable, true);
  assert.equal(card.requires_review, true);
});

test('the quality card detects secrets without echoing them', () => {
  const card = content.qualityCard({
    title: 'Deploy', description: 'x'.repeat(30), language: 'sh', license: 'MIT',
    code: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n',
  });
  const check = card.checks.find((ch) => ch.id === 'secrets');
  assert.equal(check.ok, false);
  assert.ok(!JSON.stringify(card).includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'));
  assert.ok(card.secret_findings.includes('github_token'));
});

test('scanForSecrets covers the common credential shapes', () => {
  const samples = {
    aws_access_key: 'AKIAIOSFODNN7EXAMPLE',
    google_api_key: 'AIzaSyA-1234567890abcdefghijklmnopqrstu',
    private_key: '-----BEGIN RSA PRIVATE KEY-----',
    slack_token: 'xoxb-1234567890-abcdefghijkl',
    smtp_url: 'smtps://user:secretpass@mail.example.invalid',
    bearer: 'api_key = "abcdefghijklmnop"',
  };
  for (const [id, text] of Object.entries(samples)) {
    const hits = content.scanForSecrets(text).map((x) => x.id);
    assert.ok(hits.includes(id), `${id} not detected in: ${text.slice(0, 30)}`);
  }
  assert.deepEqual(content.scanForSecrets('const total = sum(a, b);'), []);
});

test('the quality-check route returns the card and the allowlists', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  const res = await h.call(c.routes['quality-check'], {
    method: 'POST', url: '/api/quality-check',
    body: { title: 'Thing', description: 'x'.repeat(40), language: 'js', code: 'const a = 1;', license: 'MIT' },
    cookies: h.sessionFor(c, u),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.quality.score, 'number');
  assert.ok(res.body.languages.includes('js'));
  assert.ok(res.body.licenses.includes('MIT'));
});

// ---------------------------------------------------------------------------
// Reports: the missing-await bug
// ---------------------------------------------------------------------------
test('a clean report is stored (the audited handler blocked every report)', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u], settings: { filter_enabled: true, banned_words: ['forbiddenword'] } } });
  const res = await h.call(c.routes.reports, {
    method: 'POST', url: '/api/reports', body: { text: 'هذا الكود مكرر' }, cookies: h.sessionFor(c, u),
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.blocked, false);
  assert.equal(c.store.json('data/interactions.json').reports.length, 1);
  assert.ok(c.mail.some((m) => m.kind === 'mail'), 'the admin should be notified');
});

test('a report containing a banned word is blocked with 409', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u], settings: { filter_enabled: true, banned_words: ['forbiddenword'] } } });
  const res = await h.call(c.routes.reports, {
    method: 'POST', url: '/api/reports', body: { text: 'this has forbiddenword in it' }, cookies: h.sessionFor(c, u),
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.blocked, true);
  assert.equal(c.store.json('data/interactions.json').reports.length, 0);
});

test('report-check agrees with the report route', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u], settings: { filter_enabled: true, banned_words: ['forbiddenword'] } } });
  const cookies = h.sessionFor(c, u);
  const clean = await h.call(c.routes['report-check'], {
    method: 'POST', url: '/api/report-check', body: { text: 'all good' }, cookies,
  });
  assert.equal(clean.statusCode, 200);
  assert.equal(clean.body.blocked, false);

  const dirty = await h.call(c.routes['report-check'], {
    method: 'POST', url: '/api/report-check', body: { text: 'forbiddenword' }, cookies,
  });
  assert.equal(dirty.statusCode, 409);
});

test('a stored report keeps no copy of the reporter email', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u], settings: { filter_enabled: false } } });
  await h.call(c.routes.reports, {
    method: 'POST', url: '/api/reports', body: { text: 'plain report' }, cookies: h.sessionFor(c, u),
  });
  const stored = c.store.json('data/interactions.json').reports[0];
  assert.ok(!('reporter_email' in stored), 'one fewer copy of personal data');
  assert.equal(stored.reporter, 'member1');
});

// ---------------------------------------------------------------------------
// Moderation trail
// ---------------------------------------------------------------------------
test('the state machine only allows the documented transitions', () => {
  const m = require('../api/_moderation');
  assert.equal(m.canTransition('draft', 'pending'), true);
  assert.equal(m.canTransition('pending', 'approved'), true);
  assert.equal(m.canTransition('pending', 'rejected'), true);
  assert.equal(m.canTransition('draft', 'approved'), false, 'a draft may not skip review');
  assert.equal(m.canTransition('rejected', 'approved'), false);
  assert.equal(m.canTransition('approved', 'draft'), false);
});

test('admin decisions are written to the audit log and readable by the admin only', async () => {
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const member = h.user();
  const c = ctx({ base: { users: [admin, member] } });

  await h.call(c.routes['toggle-verify'], {
    method: 'POST', url: '/api/toggle-verify', body: { username: 'member1', verified: true },
    cookies: h.sessionFor(c, admin),
  });

  const log = await h.call(c.routes['moderation-log'], {
    method: 'GET', url: '/api/moderation-log', cookies: h.sessionFor(c, admin),
  });
  assert.equal(log.statusCode, 200);
  assert.ok(log.body.entries.some((e) => e.action === 'badge-grant' && e.target === 'user:member1'));

  const denied = await h.call(c.routes['moderation-log'], {
    method: 'GET', url: '/api/moderation-log', cookies: h.sessionFor(c, member),
  });
  assert.equal(denied.statusCode, 403);
});

test('the audit log records a settings change without storing the word list', async () => {
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const c = ctx({ base: { users: [admin] } });
  await h.call(c.routes.settings, {
    method: 'POST', url: '/api/settings', body: { auto_approve: true }, cookies: h.sessionFor(c, admin),
  });
  const entry = c.store.json('data/moderation_log.json').entries.find((e) => e.action === 'settings-update');
  assert.ok(entry);
  assert.deepEqual(entry.meta.changed, ['auto_approve']);
  assert.equal(typeof entry.meta.banned_words, 'number', 'only the count, not the list');
});

test('settings keeps unknown keys out and never empties the word list', async () => {
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const c = ctx({ base: { users: [admin] } });
  const res = await h.call(c.routes.settings, {
    method: 'POST', url: '/api/settings',
    body: { auto_approve: true, evil_flag: true, banned_words: [] },
    cookies: h.sessionFor(c, admin),
  });
  assert.equal(res.statusCode, 200);
  assert.ok(!('evil_flag' in res.body.settings), 'an unknown setting must be dropped');
  assert.ok(res.body.settings.banned_words.length > 0, 'the list falls back to the defaults');
});

test('public-settings never exposes the word list or admin data', async () => {
  const c = ctx();
  const res = await h.call(c.routes['public-settings'], { method: 'GET', url: '/api/public-settings' });
  assert.equal(res.statusCode, 200);
  assert.ok(!('banned_words' in res.body.settings));
  assert.equal(Object.keys(res.body.settings).length, 8);
});

test('settings falls back to the safe defaults when the file is unreadable', async () => {
  const c = ctx();
  c.store.put('data/settings.json', '{ corrupt');
  const { getSettings } = c.require('_settings.js');
  const s = await getSettings();
  assert.equal(s.auto_approve, false, 'a corrupt settings file must not open the gate');
  assert.equal(s.filter_enabled, true);
});
