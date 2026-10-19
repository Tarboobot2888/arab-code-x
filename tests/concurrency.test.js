// Concurrent writes must not lose an update (plan: SEC-08, 13 "تزامن عمليات
// الكتابة وعدم فقد التحديثات", 10 "صفر فقد تحديث معروف بسبب التزامن").
//
// The audited _gh.writeJson re-read the file's sha before writing but then wrote
// the object the CALLER had built from an older copy, so whoever wrote second
// silently erased the first writer's change. updateJson replays the mutator
// against the freshest content instead, which is what these tests pin down.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/harness');

function ctx(extra = {}) {
  return h.loadApi({ files: { ...h.baseFiles(extra.base || {}), ...(extra.files || {}) } });
}

test('updateJson replays the mutator after a conflict instead of overwriting', async () => {
  const c = ctx();
  const gh = c.require('_gh.js');

  c.store.put('data/counter.json', { items: ['a'] });
  // The first PUT fails with 409; the second must see the newest content.
  c.store.failNextPut = 1;
  c.store.onBeforePut = async () => {
    // Another writer lands while our first attempt is in flight.
    const current = c.store.json('data/counter.json');
    if (!current.items.includes('b')) {
      current.items.push('b');
      c.store.put('data/counter.json', current);
    }
    c.store.onBeforePut = null;
  };

  const out = await gh.updateJson('data/counter.json', { items: [] }, (data) => {
    data.items.push('c');
    return null;
  }, 'test');

  assert.ok(out.attempts >= 2, 'the mutator should have been replayed');
  const final = c.store.json('data/counter.json');
  assert.deepEqual(final.items, ['a', 'b', 'c'], "the other writer's change must survive");
});

test('updateJson gives up after repeated conflicts rather than writing stale data', async () => {
  const c = ctx();
  const gh = c.require('_gh.js');
  c.store.put('data/x.json', { n: 0 });
  c.store.failNextPut = 99;
  await assert.rejects(
    () => gh.updateJson('data/x.json', { n: 0 }, (d) => { d.n += 1; return null; }, 'test'),
    (e) => e.status === 409,
  );
  assert.equal(c.store.json('data/x.json').n, 0, 'nothing may be written on give-up');
});

test('SKIP_WRITE cancels the write without an error', async () => {
  const c = ctx();
  const gh = c.require('_gh.js');
  c.store.put('data/y.json', { n: 1 });
  const before = c.store.writes.length;
  const out = await gh.updateJson('data/y.json', {}, () => gh.SKIP_WRITE, 'test');
  assert.equal(out.written, false);
  assert.equal(c.store.writes.length, before, 'no write should have been issued');
});

test('a corrupt JSON file surfaces an error instead of being replaced by the fallback', async () => {
  const c = ctx();
  const gh = c.require('_gh.js');
  c.store.put('data/broken.json', '{ not json');
  // The client-facing message stays generic; the real reason is on `detail`
  // and in the server log (APP-09).
  const isParseError = (e) => e.status === 500 && /invalid JSON/.test(String(e.detail));
  await assert.rejects(() => gh.readJson('data/broken.json', { ok: true }), isParseError);
  await assert.rejects(
    () => gh.updateJson('data/broken.json', { ok: true }, (d) => { d.ok = false; return null; }, 'test'),
    isParseError,
  );
  assert.equal(c.store.files.get('data/broken.json').content, '{ not json', 'data must not be clobbered');
});

// ---------------------------------------------------------------------------
// Route-level: two members acting at once
// ---------------------------------------------------------------------------
test('two profile updates in flight do not erase each other', async () => {
  const a = h.user({ username: 'alice1', email: 'alice1@example.invalid' });
  const b = h.user({ username: 'bob1', email: 'bob1@example.invalid' });
  const c = ctx({ base: { users: [a, b] } });

  const [r1, r2] = await Promise.all([
    h.call(c.routes['update-profile'], {
      method: 'POST', url: '/api/update-profile', body: { bio: 'alice bio' }, cookies: h.sessionFor(c, a),
    }),
    h.call(c.routes['update-profile'], {
      method: 'POST', url: '/api/update-profile', body: { bio: 'bob bio' }, cookies: h.sessionFor(c, b),
    }),
  ]);
  assert.equal(r1.statusCode, 200);
  assert.equal(r2.statusCode, 200);

  const users = c.store.json('data/users.json').users;
  assert.equal(users.find((u) => u.username === 'alice1').bio, 'alice bio');
  assert.equal(users.find((u) => u.username === 'bob1').bio, 'bob bio');
});

test('concurrent comments on the same code all survive', async () => {
  const users = Array.from({ length: 5 }, (_, i) =>
    h.user({ username: `writer${i}`, email: `writer${i}@example.invalid` }));
  const c = ctx({
    base: {
      users,
      codes: [h.manifestEntry({ filename: 'demo.js' })],
      settings: { filter_enabled: false },
    },
  });

  const results = await Promise.all(users.map((u) => h.call(c.routes.comments, {
    method: 'POST', url: '/api/comments',
    body: { code: 'demo.js', text: `from ${u.username}` },
    cookies: h.sessionFor(c, u),
  })));
  for (const r of results) assert.equal(r.statusCode, 201);

  const stored = c.store.json('data/interactions.json').comments;
  assert.equal(stored.length, 5, `expected 5 comments, found ${stored.length}`);
  const authors = stored.map((x) => x.author).sort();
  assert.deepEqual(authors, users.map((u) => u.username).sort());
});

test('concurrent signups with different names all land', async () => {
  const c = ctx();
  const results = await Promise.all([1, 2, 3, 4].map((i) => h.call(c.routes.signup, {
    method: 'POST', url: '/api/signup',
    body: { username: `batch${i}`, email: `batch${i}@example.invalid`, password: 'a-good-password' },
  })));
  for (const r of results) assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(c.store.json('data/users.json').users.length, 4);
});

test('two signups racing for the same username: exactly one wins', async () => {
  const c = ctx();
  const results = await Promise.all([
    h.call(c.routes.signup, {
      method: 'POST', url: '/api/signup',
      body: { username: 'racer', email: 'r1@example.invalid', password: 'a-good-password' },
    }),
    h.call(c.routes.signup, {
      method: 'POST', url: '/api/signup',
      body: { username: 'racer', email: 'r2@example.invalid', password: 'a-good-password' },
    }),
  ]);
  const ok = results.filter((r) => r.statusCode === 200);
  const conflict = results.filter((r) => r.statusCode === 409);
  assert.equal(ok.length, 1, 'exactly one signup may succeed');
  assert.equal(conflict.length, 1);
  assert.equal(c.store.json('data/users.json').users.filter((u) => u.username === 'racer').length, 1);
});

test('concurrent likes from different members all count once each', async () => {
  const users = Array.from({ length: 6 }, (_, i) =>
    h.user({ username: `liker${i}`, email: `liker${i}@example.invalid` }));
  const c = ctx({ base: { users, codes: [h.manifestEntry({ filename: 'demo.js' })] } });

  const results = await Promise.all(users.map((u) => h.call(c.routes.likes, {
    method: 'POST', url: '/api/likes', body: { code: 'demo.js' }, cookies: h.sessionFor(c, u),
  })));
  for (const r of results) assert.equal(r.statusCode, 200, JSON.stringify(r.body));

  const data = c.store.json('data/interactions.json');
  assert.equal(Object.keys(data.likes).length, 6);
  assert.equal(data.likeTotals['demo.js'], 6);
});

test('the same member cannot like the same code twice, even concurrently', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u], codes: [h.manifestEntry({ filename: 'demo.js' })] } });
  const cookies = h.sessionFor(c, u);

  // Fire the toggle an even number of times: the structural key guarantees the
  // store can only ever hold 0 or 1 like for this (member, code) pair.
  await Promise.all([1, 2, 3, 4].map(() => h.call(c.routes.likes, {
    method: 'POST', url: '/api/likes', body: { code: 'demo.js' }, cookies,
  })));

  const data = c.store.json('data/interactions.json');
  const mine = Object.keys(data.likes).filter((k) => k.startsWith('member1|'));
  assert.ok(mine.length <= 1, `a duplicate like was stored: ${JSON.stringify(mine)}`);
  assert.ok((data.likeTotals['demo.js'] || 0) <= 1, 'the total must never exceed one like per member');
});

test('two concurrent publishes never collide on a filename', async () => {
  const users = [1, 2, 3].map((i) =>
    h.user({ username: `pub${i}`, email: `pub${i}@example.invalid`, is_verified_badge: true }));
  const c = ctx({ base: { users, settings: { filter_enabled: false } } });

  await Promise.all(users.map((u) => h.call(c.routes.submit, {
    method: 'POST', url: '/api/submit',
    body: { title: 'Shared title', language: 'js', code: `// ${u.username}` },
    cookies: h.sessionFor(c, u),
  })));

  const names = c.store.json('data/manifest.json').codes.map((x) => x.filename);
  assert.equal(new Set(names).size, names.length, `duplicate filename: ${names.join(', ')}`);
  assert.equal(names.length, 3);
});

test('ban cleanup removes the stored files (the sha bug made this a no-op)', async () => {
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const target = h.user({ username: 'spammer', email: 'spammer@example.invalid' });
  const c = ctx({
    base: {
      users: [admin, target],
      codes: [
        h.manifestEntry({ filename: 'spam-1.js', author: 'spammer' }),
        h.manifestEntry({ filename: 'spam-2.js', author: 'spammer' }),
        h.manifestEntry({ filename: 'keep.js', author: 'siteadmin' }),
      ],
    },
    files: {
      'codes/spam-1.js': 'a',
      'codes/spam-2.js': 'b',
      'codes/keep.js': 'c',
      'pending/zzz111-yyy222.json': { id: 'zzz111-yyy222', author: 'spammer', title: 'queued', code: 'x' },
    },
  });

  const res = await h.call(c.routes.ban, {
    method: 'POST', url: '/api/ban', body: { username: 'spammer', ban: true, reason: 'spam' },
    cookies: h.sessionFor(c, admin),
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.failed_deletions, [], 'deletions must actually succeed');
  assert.equal(res.body.removed_codes, 3, 'two codes plus one queued item');

  assert.ok(!c.store.files.has('codes/spam-1.js'));
  assert.ok(!c.store.files.has('codes/spam-2.js'));
  assert.ok(c.store.files.has('codes/keep.js'), "another member's code must be untouched");
  assert.ok(!c.store.files.has('pending/zzz111-yyy222.json'));
  assert.deepEqual(c.store.json('data/manifest.json').codes.map((x) => x.filename), ['keep.js']);

  // The ban must also revoke the member's live session.
  assert.equal(c.store.json('data/users.json').users.find((u) => u.username === 'spammer').session_version, 1);
});

test('a banned member\'s existing cookie stops working immediately', async () => {
  const admin = h.user({ username: 'siteadmin', email: 'admin@example.invalid' });
  const target = h.user({ username: 'tobanned', email: 'tobanned@example.invalid' });
  const c = ctx({ base: { users: [admin, target] } });
  const victimCookie = h.sessionFor(c, target);

  // Works before the ban.
  let res = await h.call(c.routes['update-profile'], {
    method: 'POST', url: '/api/update-profile', body: { bio: 'ok' }, cookies: victimCookie,
  });
  assert.equal(res.statusCode, 200);

  await h.call(c.routes.ban, {
    method: 'POST', url: '/api/ban', body: { username: 'tobanned', ban: true }, cookies: h.sessionFor(c, admin),
  });

  res = await h.call(c.routes['update-profile'], {
    method: 'POST', url: '/api/update-profile', body: { bio: 'after ban' }, cookies: victimCookie,
  });
  assert.equal(res.statusCode, 401, 'the old cookie must no longer authenticate');
});
