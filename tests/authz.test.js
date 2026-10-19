// Authorization matrix for every sensitive route (plan 6 "أنشئ مصفوفة اختبار"
// and 9.1: "100% من المسارات الحساسة لها حالات صلاحية صريحة").
//
// The six actors from the task:
//   1. anonymous        2. ordinary member    3. content owner
//   4. unconfirmed email 5. banned member     6. admin
//
// Every case calls the real handler directly, which is the point: the audited
// code relied in places on the UI hiding a button, so these tests exercise the
// API the way an attacker would — straight at the endpoint.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/harness');

const ADMIN = { username: 'siteadmin', email: 'admin@example.invalid' };

function actors() {
  return {
    anon: null,
    member: h.user({ username: 'member1', email: 'member1@example.invalid' }),
    owner: h.user({ username: 'owner1', email: 'owner1@example.invalid' }),
    unconfirmed: h.user({ username: 'newbie', email: 'newbie@example.invalid', verified: false }),
    banned: h.user({ username: 'badactor', email: 'badactor@example.invalid' }),
    admin: h.user({ ...ADMIN, is_verified_badge: true }),
  };
}

function ctxFor(extraFiles = {}) {
  const a = actors();
  const users = [a.member, a.owner, a.unconfirmed, a.banned, a.admin];
  const codes = [
    h.manifestEntry({ filename: 'owned.js', author: 'owner1' }),
    h.manifestEntry({ filename: 'other.js', author: 'member1' }),
  ];
  const ctx = h.loadApi({
    files: {
      ...h.baseFiles({
        users,
        codes,
        bans: { badactor: { banned: true, reason: 'test', banned_at: '2026-01-01T00:00:00.000Z' } },
      }),
      ...extraFiles,
    },
  });
  return { ctx, a };
}

/** Run a request as one of the actors. */
function as(ctx, actor, opts) {
  const cookies = actor ? h.sessionFor(ctx, actor) : undefined;
  return h.call(ctx.routes[opts.route], {
    method: opts.method || 'GET',
    url: opts.url || `/api/${opts.route}`,
    body: opts.body,
    cookies,
    headers: opts.headers,
  });
}

// ---------------------------------------------------------------------------
// Admin-only routes
// ---------------------------------------------------------------------------
const ADMIN_ONLY = [
  { route: 'users', method: 'GET' },
  { route: 'pending', method: 'GET' },
  { route: 'stats', method: 'GET' },
  { route: 'delete-requests', method: 'GET' },
  { route: 'moderation-log', method: 'GET' },
  { route: 'settings', method: 'GET' },
  { route: 'approve', method: 'POST', body: { id: 'abc-def' } },
  { route: 'reject', method: 'POST', body: { id: 'abc-def' } },
  { route: 'resolve-delete', method: 'POST', body: { id: 'x' } },
  { route: 'toggle-verify', method: 'POST', body: { username: 'member1', verified: true } },
  { route: 'ban', method: 'POST', body: { username: 'member1', ban: true } },
  { route: 'broadcast', method: 'POST', body: { subject: 's', body: 'b', test: true } },
  { route: 'report-dismiss', method: 'POST', body: { id: 'x' } },
];

for (const spec of ADMIN_ONLY) {
  test(`${spec.route}: refuses an anonymous caller with 401`, async () => {
    const { ctx } = ctxFor();
    const res = await as(ctx, null, spec);
    assert.equal(res.statusCode, 401, `${spec.route} let an anonymous caller through`);
  });

  test(`${spec.route}: refuses an ordinary member with 403`, async () => {
    const { ctx, a } = ctxFor();
    const res = await as(ctx, a.member, spec);
    assert.equal(res.statusCode, 403, `${spec.route} let a non-admin through`);
  });

  test(`${spec.route}: refuses a banned member`, async () => {
    const { ctx, a } = ctxFor();
    const res = await as(ctx, a.banned, spec);
    assert.ok([401, 403].includes(res.statusCode), `${spec.route} answered ${res.statusCode} for a banned caller`);
  });

  test(`${spec.route}: admin is not refused for authorization reasons`, async () => {
    const { ctx, a } = ctxFor();
    const res = await as(ctx, a.admin, spec);
    assert.ok(![401, 403].includes(res.statusCode),
      `${spec.route} refused the admin with ${res.statusCode}: ${JSON.stringify(res.body)}`);
  });
}

// ---------------------------------------------------------------------------
// Routes that need a signed-in, email-confirmed member
// ---------------------------------------------------------------------------
const MEMBER_ROUTES = [
  { route: 'submit', method: 'POST', body: { title: 'Hello world', code: 'console.log(1)', language: 'js' } },
  { route: 'comments', method: 'POST', body: { code: 'owned.js', text: 'nice' } },
  { route: 'likes', method: 'POST', body: { code: 'owned.js' } },
  { route: 'messages', method: 'POST', body: { text: 'hello support' } },
  { route: 'reports', method: 'POST', body: { text: 'please review this' } },
  { route: 'update-profile', method: 'POST', body: { bio: 'hi' } },
  { route: 'delete-code', method: 'POST', body: { filename: 'owned.js' } },
  { route: 'delete-request', method: 'POST', body: { filename: 'owned.js' } },
  { route: 'quality-check', method: 'POST', body: { title: 'x', code: 'y', language: 'js' } },
];

for (const spec of MEMBER_ROUTES) {
  test(`${spec.route}: anonymous gets 401`, async () => {
    const { ctx } = ctxFor();
    const res = await as(ctx, null, spec);
    assert.equal(res.statusCode, 401, `${spec.route} allowed an anonymous write`);
  });

  test(`${spec.route}: a banned member is refused even calling the API directly`, async () => {
    const { ctx, a } = ctxFor();
    const res = await as(ctx, a.banned, spec);
    assert.equal(res.statusCode, 403, `${spec.route} let a banned member act (SEC-05)`);
    assert.match(String(res.body.error), /محظور/);
  });

  test(`${spec.route}: an unconfirmed email is refused`, async () => {
    const { ctx, a } = ctxFor();
    const res = await as(ctx, a.unconfirmed, spec);
    assert.equal(res.statusCode, 403, `${spec.route} allowed an unconfirmed account`);
  });
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------
test('delete-code: a member cannot delete someone else\'s code', async () => {
  const { ctx, a } = ctxFor();
  const res = await as(ctx, a.member, { route: 'delete-code', method: 'POST', body: { filename: 'owned.js' } });
  assert.equal(res.statusCode, 403);
  const manifest = ctx.store.json('data/manifest.json');
  assert.ok(manifest.codes.some((c) => c.filename === 'owned.js'), 'the code must still be listed');
});

test('delete-code: the admin can delete any code', async () => {
  const { ctx, a } = ctxFor({ 'codes/owned.js': 'console.log(1)' });
  const res = await as(ctx, a.admin, { route: 'delete-code', method: 'POST', body: { filename: 'owned.js' } });
  assert.equal(res.statusCode, 200);
  const manifest = ctx.store.json('data/manifest.json');
  assert.ok(!manifest.codes.some((c) => c.filename === 'owned.js'));
  assert.ok(!ctx.store.files.has('codes/owned.js'), 'the stored file must be removed too');
});

test('delete-code: an owner without direct_delete is told to file a request', async () => {
  const { ctx, a } = ctxFor();
  const res = await as(ctx, a.owner, { route: 'delete-code', method: 'POST', body: { filename: 'owned.js' } });
  assert.equal(res.statusCode, 403);
  assert.match(String(res.body.error), /طلب حذف/);
});

test('delete-code: an owner may delete when direct_delete is on', async () => {
  const a = actors();
  const ctx = h.loadApi({
    files: {
      ...h.baseFiles({
        users: [a.owner],
        codes: [h.manifestEntry({ filename: 'owned.js', author: 'owner1' })],
        settings: { direct_delete: true },
      }),
      'codes/owned.js': 'console.log(1)',
    },
  });
  const res = await h.call(ctx.routes['delete-code'], {
    method: 'POST', url: '/api/delete-code', body: { filename: 'owned.js' }, cookies: h.sessionFor(ctx, a.owner),
  });
  assert.equal(res.statusCode, 200);
});

test('delete-request: a member cannot request deletion of another member\'s code', async () => {
  const a = actors();
  const ctx = h.loadApi({
    files: h.baseFiles({
      users: [a.member, a.owner],
      codes: [h.manifestEntry({ filename: 'owned.js', author: 'owner1' })],
    }),
  });
  const res = await h.call(ctx.routes['delete-request'], {
    method: 'POST', url: '/api/delete-request', body: { filename: 'owned.js' }, cookies: h.sessionFor(ctx, a.member),
  });
  assert.equal(res.statusCode, 403);
  assert.match(String(res.body.error), /أكوادك فقط/);
});

test('comments DELETE: only the author or the admin may remove a comment', async () => {
  const a = actors();
  const comment = {
    id: 'c1', code: 'owned.js', author: 'owner1', display_name: 'Owner',
    text: 'mine', created_at: '2026-02-02T00:00:00.000Z',
  };
  const files = h.baseFiles({
    users: [a.member, a.owner, a.admin],
    codes: [h.manifestEntry({ filename: 'owned.js', author: 'owner1' })],
    interactions: { comments: [comment] },
  });

  const other = h.loadApi({ files });
  let res = await h.call(other.routes.comments, {
    method: 'DELETE', url: '/api/comments', body: { id: 'c1' }, cookies: h.sessionFor(other, a.member),
  });
  assert.equal(res.statusCode, 403, 'a stranger deleted a comment');
  assert.equal(other.store.json('data/interactions.json').comments.length, 1);

  const own = h.loadApi({ files });
  res = await h.call(own.routes.comments, {
    method: 'DELETE', url: '/api/comments', body: { id: 'c1' }, cookies: h.sessionFor(own, a.owner),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(own.store.json('data/interactions.json').comments.length, 0);

  const adm = h.loadApi({ files });
  res = await h.call(adm.routes.comments, {
    method: 'DELETE', url: '/api/comments', body: { id: 'c1' }, cookies: h.sessionFor(adm, a.admin),
  });
  assert.equal(res.statusCode, 200);
});

test('zip-delete: only the uploader or the admin may delete a package', async () => {
  const a = actors();
  const zip = { slug: 'pack', title: 'Pack', author: 'owner1', url: 'https://x/file/1', created_at: '2026-01-01' };
  const files = { ...h.baseFiles({ users: [a.member, a.owner, a.admin] }), 'data/zips.json': { zips: [zip] } };

  const stranger = h.loadApi({ files });
  let res = await h.call(stranger.routes['zip-delete'], {
    method: 'POST', url: '/api/zip-delete', body: { slug: 'pack' }, cookies: h.sessionFor(stranger, a.member),
  });
  assert.equal(res.statusCode, 403);
  assert.equal(stranger.store.json('data/zips.json').zips.length, 1);

  const owner = h.loadApi({ files });
  res = await h.call(owner.routes['zip-delete'], {
    method: 'POST', url: '/api/zip-delete', body: { slug: 'pack' }, cookies: h.sessionFor(owner, a.owner),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(owner.store.json('data/zips.json').zips.length, 0);
});

// ---------------------------------------------------------------------------
// /api/me is the one route that reports a ban rather than refusing
// ---------------------------------------------------------------------------
test('me: a banned member gets their identity plus the ban reason', async () => {
  const { ctx, a } = ctxFor();
  const res = await as(ctx, a.banned, { route: 'me', method: 'GET' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.username, 'badactor');
  assert.equal(res.body.ban.reason, 'test');
});

test('me: never returns a private field', async () => {
  const { ctx, a } = ctxFor();
  const res = await as(ctx, a.member, { route: 'me', method: 'GET' });
  const keys = Object.keys(res.body.user);
  for (const forbidden of ['password_hash', 'session_version', 'lock_until', 'reset_token_hash', 'phone']) {
    assert.ok(!keys.includes(forbidden), `/api/me leaked ${forbidden}`);
  }
});

test('user: a public profile never exposes the email or credential', async () => {
  const { ctx } = ctxFor();
  const res = await h.call(ctx.routes.user, { method: 'GET', url: '/api/user?username=member1' });
  assert.equal(res.statusCode, 200);
  const keys = Object.keys(res.body.user);
  for (const forbidden of ['email', 'password_hash', 'session_version', 'phone', 'verification_token_hash']) {
    assert.ok(!keys.includes(forbidden), `/api/user leaked ${forbidden}`);
  }
});

test('users (admin list): reports accounts but no credential material', async () => {
  const { ctx, a } = ctxFor();
  const res = await as(ctx, a.admin, { route: 'users', method: 'GET' });
  assert.equal(res.statusCode, 200);
  for (const u of res.body.users) {
    assert.ok(!('password_hash' in u), 'the admin list leaked a password hash');
    assert.ok(!('session_version' in u));
  }
});

// ---------------------------------------------------------------------------
// Session invalidation
// ---------------------------------------------------------------------------
test('a session whose version is stale is rejected', async () => {
  const { ctx, a } = ctxFor();
  const stale = h.sessionFor(ctx, { ...a.member, session_version: 0 });
  // Simulate a password reset bumping the record's version.
  const users = ctx.store.json('data/users.json');
  users.users.find((u) => u.username === 'member1').session_version = 1;
  ctx.store.put('data/users.json', users);

  const res = await h.call(ctx.routes.me, { method: 'GET', url: '/api/me', cookies: stale });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user, null, 'an old cookie must stop authenticating after a rotation');
});

test('a forged session (wrong secret) is rejected', async () => {
  const { ctx, a } = ctxFor();
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ u: a.admin.username, e: a.admin.email, v: 0 }, 'not-the-real-secret', { expiresIn: '1d' });
  const res = await h.call(ctx.routes.stats, { method: 'GET', url: '/api/stats', cookies: { session: forged } });
  assert.equal(res.statusCode, 401);
});

// ---------------------------------------------------------------------------
// CSRF / Origin
// ---------------------------------------------------------------------------
test('a cross-site POST is refused (Origin check)', async () => {
  const { ctx, a } = ctxFor();
  const res = await h.call(ctx.routes['update-profile'], {
    method: 'POST',
    url: '/api/update-profile',
    body: { bio: 'injected' },
    cookies: h.sessionFor(ctx, a.member),
    headers: { origin: 'https://evil.example.invalid' },
  });
  assert.equal(res.statusCode, 403);
  assert.match(String(res.body.error), /أصل الطلب/);
});

test('a same-origin POST is allowed', async () => {
  const { ctx, a } = ctxFor();
  const res = await h.call(ctx.routes['update-profile'], {
    method: 'POST',
    url: '/api/update-profile',
    body: { bio: 'fine' },
    cookies: h.sessionFor(ctx, a.member),
    headers: { origin: 'https://test.example.invalid' },
  });
  assert.equal(res.statusCode, 200);
});

// ---------------------------------------------------------------------------
// Method guards
// ---------------------------------------------------------------------------
test('POST-only routes reject GET with 405 and an Allow header', async () => {
  const { ctx, a } = ctxFor();
  for (const route of ['submit', 'login', 'signup', 'reset-password', 'delete-code']) {
    const res = await h.call(ctx.routes[route], {
      method: 'GET', url: `/api/${route}`, cookies: h.sessionFor(ctx, a.member),
    });
    assert.equal(res.statusCode, 405, `${route} accepted GET`);
    assert.ok(res.headers.allow, `${route} did not send Allow`);
  }
});
