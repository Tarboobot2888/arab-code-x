// End-to-end account flows against the real handlers (plan 13: "تدفقات التسجيل
// وتسجيل الدخول والتفعيل واستعادة كلمة المرور" و"تغيير البريد واسم المستخدم
// وحذف الحساب").
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/harness');

const ADMIN_EMAIL = 'admin@example.invalid';

function ctx(extra = {}) {
  return h.loadApi({ files: { ...h.baseFiles(extra.base || {}), ...(extra.files || {}) }, env: extra.env });
}

const post = (c, route, body, cookies, headers) => h.call(c.routes[route], {
  method: 'POST', url: `/api/${route}`, body, cookies, headers,
});
const get = (c, route, qs, cookies) => h.call(c.routes[route], {
  method: 'GET', url: `/api/${route}${qs || ''}`, cookies,
});

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------
test('signup creates an unverified account and mails a hashed token', async () => {
  const c = ctx();
  const res = await post(c, 'signup', {
    username: 'fresh1', email: 'fresh1@example.invalid', password: 'a-good-password',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.needs_verification, true);

  const stored = c.store.json('data/users.json').users.find((u) => u.username === 'fresh1');
  assert.ok(stored, 'the account was not stored');
  assert.equal(stored.verified, false);
  assert.ok(stored.verification_token_hash, 'a token hash must be stored');
  assert.ok(!('verification_token' in stored), 'no plaintext token may be stored');
  assert.ok(stored.verification_token_expires > Date.now(), 'the token must expire');
  assert.ok(!('phone' in stored), 'signup must not store a phone number');

  const mail = c.mail.find((m) => m.kind === 'verification');
  assert.ok(mail, 'no verification mail was sent');
  const token = new URL(mail.verifyUrl).searchParams.get('token');
  assert.match(token, /^[0-9a-f]{64}$/);
  // The link carries the plaintext; the store only has its hash.
  assert.notEqual(token, stored.verification_token_hash);
});

test('signup rejects a weak password, a bad email and a reserved name', async () => {
  for (const [body, pattern] of [
    [{ username: 'ok1', email: 'ok1@example.invalid', password: 'short' }, /8 أحرف/],
    [{ username: 'ok2', email: 'not-an-email', password: 'a-good-password' }, /إيميل/],
    [{ username: 'admin', email: 'ok3@example.invalid', password: 'a-good-password' }, /محجوز/],
    [{ username: 'ab', email: 'ok4@example.invalid', password: 'a-good-password' }, /اسم المستخدم/],
  ]) {
    const c = ctx();
    const res = await post(c, 'signup', body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.match(String(res.body.error), pattern);
  }
});

test('signup refuses a duplicate username or email with 409', async () => {
  const existing = h.user({ username: 'taken', email: 'taken@example.invalid' });
  let c = ctx({ base: { users: [existing] } });
  let res = await post(c, 'signup', { username: 'TAKEN', email: 'other@example.invalid', password: 'a-good-password' });
  assert.equal(res.statusCode, 409);

  c = ctx({ base: { users: [existing] } });
  res = await post(c, 'signup', { username: 'other', email: 'TAKEN@example.invalid', password: 'a-good-password' });
  assert.equal(res.statusCode, 409);
});

test('public signup can never claim the admin address', async () => {
  const c = ctx();
  const res = await post(c, 'signup', { username: 'wannabe', email: ADMIN_EMAIL, password: 'a-good-password' });
  assert.equal(res.statusCode, 400);
  assert.equal(c.store.json('data/users.json').users.length, 0);
});

test('signup is refused when the admin disabled registration', async () => {
  const c = ctx({ base: { settings: { signup_enabled: false } } });
  const res = await post(c, 'signup', { username: 'nope', email: 'nope@example.invalid', password: 'a-good-password' });
  assert.equal(res.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------
test('the verification link activates the account exactly once', async () => {
  const c = ctx();
  await post(c, 'signup', { username: 'fresh2', email: 'fresh2@example.invalid', password: 'a-good-password' });
  const token = new URL(c.mail.find((m) => m.kind === 'verification').verifyUrl).searchParams.get('token');

  let res = await get(c, 'verify', `?token=${token}&u=fresh2`);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.body), /تم تفعيل حسابك/);
  assert.ok(res.cookies.session, 'a session should be issued on success');
  assert.equal(c.store.json('data/users.json').users[0].verified, true);

  // Replay: the token is gone, so the account reports "already verified".
  res = await get(c, 'verify', `?token=${token}&u=fresh2`);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.body), /مُفعّل بالفعل/);
});

test('an expired verification token cannot activate an account', async () => {
  const u = h.user({ username: 'pend1', email: 'pend1@example.invalid', verified: false });
  const tokensMod = require('../api/_tokens');
  const plain = tokensMod.issue(u, 'verify', -1000);
  const c = ctx({ base: { users: [u] } });

  const res = await get(c, 'verify', `?token=${plain}&u=pend1`);
  assert.equal(res.statusCode, 400);
  assert.match(String(res.body), /انتهت صلاحية/);
  assert.equal(c.store.json('data/users.json').users[0].verified, false);
  assert.ok(!res.cookies.session, 'no session may be issued for an expired token');
});

test('a legacy no-expiry verification token is refused (SEC-01 regression guard)', async () => {
  const u = h.user({
    username: 'legacy1', email: 'legacy1@example.invalid', verified: false,
    verification_token: 'leaked-plaintext-token',
  });
  const c = ctx({ base: { users: [u] } });
  const res = await get(c, 'verify', '?token=leaked-plaintext-token&u=legacy1');
  assert.ok(res.statusCode >= 400, 'a leaked legacy token must never activate an account');
  assert.equal(c.store.json('data/users.json').users[0].verified, false);
  assert.ok(!res.cookies.session);
});

test('a wrong token and an unknown user give the same answer', async () => {
  const u = h.user({ username: 'pend2', email: 'pend2@example.invalid', verified: false });
  require('../api/_tokens').issue(u, 'verify');
  const c = ctx({ base: { users: [u] } });
  const wrong = await get(c, 'verify', `?token=${'0'.repeat(64)}&u=pend2`);
  const unknown = await get(c, 'verify', `?token=${'0'.repeat(64)}&u=doesnotexist`);
  assert.equal(wrong.statusCode, unknown.statusCode);
  assert.equal(String(wrong.body), String(unknown.body));
});

test('resend-verification issues a fresh token and never leaks existence', async () => {
  const u = h.user({ username: 'pend3', email: 'pend3@example.invalid', verified: false });
  const c = ctx({ base: { users: [u] } });

  const known = await post(c, 'resend-verification', { email: 'pend3@example.invalid' });
  const unknown = await post(c, 'resend-verification', { email: 'nobody@example.invalid' });
  assert.equal(known.statusCode, 200);
  assert.equal(unknown.statusCode, 200);
  assert.deepEqual(known.body, unknown.body, 'the reply must not reveal whether the address exists');
  assert.ok(c.mail.some((m) => m.kind === 'verification'));
  assert.equal(c.mail.filter((m) => m.kind === 'verification').length, 1, 'only the real address gets mail');
});

test('resend-verification does nothing for an already verified account', async () => {
  const c = ctx({ base: { users: [h.user({ username: 'done1', email: 'done1@example.invalid', verified: true })] } });
  const res = await post(c, 'resend-verification', { email: 'done1@example.invalid' });
  assert.equal(res.statusCode, 200);
  assert.equal(c.mail.filter((m) => m.kind === 'verification').length, 0);
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
test('login succeeds for a verified member and sets a session cookie', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  const res = await post(c, 'login', { email: u.email, password: h.TEST_PASSWORD });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.username, 'member1');
  const cookie = res.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test('login gives one identical error for a wrong password and an unknown email', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  const wrongPw = await post(c, 'login', { email: u.email, password: 'not-the-password' });
  const unknown = await post(c, 'login', { email: 'ghost@example.invalid', password: 'not-the-password' });
  assert.equal(wrongPw.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.equal(wrongPw.body.error, unknown.body.error, 'account enumeration via the error message');
});

test('login refuses an unverified account', async () => {
  const u = h.user({ verified: false });
  const c = ctx({ base: { users: [u] } });
  const res = await post(c, 'login', { email: u.email, password: h.TEST_PASSWORD });
  assert.equal(res.statusCode, 403);
  assert.match(String(res.body.error), /غير مفعّل/);
});

test('login refuses a banned account instead of issuing a session', async () => {
  const u = h.user({ username: 'bannedguy', email: 'bannedguy@example.invalid' });
  const c = ctx({ base: { users: [u], bans: { bannedguy: { banned: true, reason: 'abuse' } } } });
  const res = await post(c, 'login', { email: u.email, password: h.TEST_PASSWORD });
  assert.equal(res.statusCode, 403);
  assert.ok(!res.cookies.session, 'a banned account must not receive a session (SEC-05)');
});

test('login locks the account after repeated failures', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  let last;
  for (let i = 0; i < 6; i++) {
    last = await post(c, 'login', { email: u.email, password: `wrong-${i}` });
  }
  assert.ok([401, 429].includes(last.statusCode));
  const stored = c.store.json('data/users.json').users[0];
  assert.ok(Number(stored.lock_until) > Date.now(), 'a lock should be persisted after the threshold');

  // Even the correct password is refused while the lock holds.
  const blocked = await post(c, 'login', { email: u.email, password: h.TEST_PASSWORD });
  assert.equal(blocked.statusCode, 429);
  assert.ok(blocked.headers['retry-after']);
});

test('an account with no local password cannot be signed into with one', async () => {
  const u = h.user({ username: 'ggl', email: 'ggl@example.invalid', password_hash: null, provider: 'google' });
  const c = ctx({ base: { users: [u] } });
  const res = await post(c, 'login', { email: u.email, password: 'anything' });
  assert.equal(res.statusCode, 401);
});

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
test('forgot-password answers the same whether or not the address exists', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  const known = await post(c, 'forgot-password', { email: u.email });
  const unknown = await post(c, 'forgot-password', { email: 'ghost@example.invalid' });
  assert.equal(known.statusCode, 200);
  assert.equal(unknown.statusCode, 200);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(c.mail.filter((m) => m.kind === 'reset').length, 1);
});

test('the reset link works once, rotates the session and is then dead', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  await post(c, 'forgot-password', { email: u.email });
  const token = new URL(c.mail.find((m) => m.kind === 'reset').resetUrl).searchParams.get('token');

  let res = await post(c, 'reset-password', { email: u.email, token, password: 'a-brand-new-password' });
  assert.equal(res.statusCode, 200);

  const stored = c.store.json('data/users.json').users[0];
  assert.equal(stored.session_version, 1, 'a reset must invalidate existing sessions');
  assert.ok(!stored.reset_token_hash, 'the token must be cleared');
  assert.ok(await require('bcryptjs').compare('a-brand-new-password', stored.password_hash));

  // Replay fails.
  res = await post(c, 'reset-password', { email: u.email, token, password: 'another-password' });
  assert.equal(res.statusCode, 400);
});

test('an expired reset token is refused', async () => {
  const u = h.user();
  const plain = require('../api/_tokens').issue(u, 'reset', -1000);
  const c = ctx({ base: { users: [u] } });
  const res = await post(c, 'reset-password', { email: u.email, token: plain, password: 'a-brand-new-password' });
  assert.equal(res.statusCode, 400);
  assert.match(String(res.body.error), /غير صالح أو منتهي/);
});

test('a reset token from one account cannot be used on another', async () => {
  const a = h.user({ username: 'ua', email: 'ua@example.invalid' });
  const b = h.user({ username: 'ub', email: 'ub@example.invalid' });
  const plain = require('../api/_tokens').issue(a, 'reset');
  const c = ctx({ base: { users: [a, b] } });
  const res = await post(c, 'reset-password', { email: b.email, token: plain, password: 'a-brand-new-password' });
  assert.equal(res.statusCode, 400);
});

test('reset clears an active lockout', async () => {
  const u = h.user({ lock_until: Date.now() + 60000, lock_strikes: 2 });
  const plain = require('../api/_tokens').issue(u, 'reset');
  const c = ctx({ base: { users: [u] } });
  const res = await post(c, 'reset-password', { email: u.email, token: plain, password: 'a-brand-new-password' });
  assert.equal(res.statusCode, 200);
  const stored = c.store.json('data/users.json').users[0];
  assert.ok(!stored.lock_until);
});

// ---------------------------------------------------------------------------
// Email change
// ---------------------------------------------------------------------------
test('change-email requires the current password and only stores a pending address', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  const cookies = h.sessionFor(c, u);

  let res = await post(c, 'change-email', { email: 'new@example.invalid', password: 'wrong' }, cookies);
  assert.equal(res.statusCode, 401);

  res = await post(c, 'change-email', { email: 'new@example.invalid', password: h.TEST_PASSWORD }, cookies);
  assert.equal(res.statusCode, 200);
  const stored = c.store.json('data/users.json').users[0];
  assert.equal(stored.email, u.email, 'the address must not change before confirmation');
  assert.equal(stored.pending_email, 'new@example.invalid');
  assert.ok(stored.pending_email_token_hash);
  assert.ok(!('pending_email_token' in stored), 'no plaintext token');
});

test('confirm-email applies the change once and rotates the session', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  const cookies = h.sessionFor(c, u);
  await post(c, 'change-email', { email: 'new@example.invalid', password: h.TEST_PASSWORD }, cookies);
  const token = new URL(c.mail.find((m) => m.kind === 'change-email').confirmUrl).searchParams.get('token');

  let res = await get(c, 'confirm-email', `?u=${u.username}&token=${token}`);
  assert.equal(res.statusCode, 200);
  let stored = c.store.json('data/users.json').users[0];
  assert.equal(stored.email, 'new@example.invalid');
  assert.equal(stored.session_version, 1);

  res = await get(c, 'confirm-email', `?u=${u.username}&token=${token}`);
  assert.equal(res.statusCode, 400, 'the confirmation link must be single-use');
  stored = c.store.json('data/users.json').users[0];
  assert.equal(stored.email, 'new@example.invalid');
});

test('change-email refuses an address already in use and the admin address', async () => {
  const u = h.user();
  const other = h.user({ username: 'other1', email: 'other1@example.invalid' });
  let c = ctx({ base: { users: [u, other] } });
  let res = await post(c, 'change-email', { email: other.email, password: h.TEST_PASSWORD }, h.sessionFor(c, u));
  assert.equal(res.statusCode, 409);

  c = ctx({ base: { users: [u] } });
  res = await post(c, 'change-email', { email: ADMIN_EMAIL, password: h.TEST_PASSWORD }, h.sessionFor(c, u));
  assert.equal(res.statusCode, 400);
});

test('a confirmation token cannot move an address to a second account', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  await post(c, 'change-email', { email: 'contested@example.invalid', password: h.TEST_PASSWORD }, h.sessionFor(c, u));
  const token = new URL(c.mail.find((m) => m.kind === 'change-email').confirmUrl).searchParams.get('token');

  // Someone else registers the address in the meantime.
  const data = c.store.json('data/users.json');
  data.users.push(h.user({ username: 'sniper', email: 'contested@example.invalid' }));
  c.store.put('data/users.json', data);

  const res = await get(c, 'confirm-email', `?u=${u.username}&token=${token}`);
  assert.equal(res.statusCode, 409);
  assert.equal(c.store.json('data/users.json').users[0].email, u.email);
});

// ---------------------------------------------------------------------------
// Username change
// ---------------------------------------------------------------------------
test('change-username moves the member\'s content and rotates the session', async () => {
  const u = h.user();
  const c = ctx({
    base: {
      users: [u],
      codes: [h.manifestEntry({ filename: 'mine.js', author: 'member1' })],
      interactions: {
        comments: [{ id: 'c1', code: 'mine.js', author: 'member1', text: 'hi', created_at: '2026-01-01' }],
        likes: { 'member1|mine.js': '2026-01-01T00:00:00.000Z' },
      },
    },
  });
  const res = await post(c, 'change-username', { username: 'renamed1', password: h.TEST_PASSWORD }, h.sessionFor(c, u));
  assert.equal(res.statusCode, 200);

  const stored = c.store.json('data/users.json').users[0];
  assert.equal(stored.username, 'renamed1');
  assert.equal(stored.session_version, 1);
  assert.equal(c.store.json('data/manifest.json').codes[0].author, 'renamed1');
  const inter = c.store.json('data/interactions.json');
  assert.equal(inter.comments[0].author, 'renamed1');
  assert.ok(inter.likes['renamed1|mine.js'], 'the like key must follow the rename');
  assert.ok(!inter.likes['member1|mine.js']);
});

test('change-username refuses a taken name and a reserved name', async () => {
  const u = h.user();
  const other = h.user({ username: 'occupied', email: 'occupied@example.invalid' });
  let c = ctx({ base: { users: [u, other] } });
  let res = await post(c, 'change-username', { username: 'OCCUPIED', password: h.TEST_PASSWORD }, h.sessionFor(c, u));
  assert.equal(res.statusCode, 409);

  c = ctx({ base: { users: [u] } });
  res = await post(c, 'change-username', { username: 'support', password: h.TEST_PASSWORD }, h.sessionFor(c, u));
  assert.equal(res.statusCode, 400);
  assert.match(String(res.body.error), /محجوز/);
});

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------
test('delete-account needs the password and detaches the member\'s traces', async () => {
  const u = h.user();
  const c = ctx({
    base: {
      users: [u],
      codes: [h.manifestEntry({ filename: 'mine.js', author: 'member1' })],
      interactions: {
        comments: [{ id: 'c1', code: 'mine.js', author: 'member1', text: 'hi', created_at: '2026-01-01' }],
        likes: { 'member1|mine.js': '2026-01-01T00:00:00.000Z' },
      },
    },
    files: { 'codes/mine.js': 'console.log(1)' },
  });
  const cookies = h.sessionFor(c, u);

  let res = await post(c, 'delete-account', { password: 'wrong' }, cookies);
  assert.equal(res.statusCode, 401);
  assert.equal(c.store.json('data/users.json').users.length, 1);

  res = await post(c, 'delete-account', { password: h.TEST_PASSWORD, delete_codes: true }, cookies);
  assert.equal(res.statusCode, 200);
  assert.equal(c.store.json('data/users.json').users.length, 0);
  assert.equal(c.store.json('data/manifest.json').codes.length, 0);
  assert.ok(!c.store.files.has('codes/mine.js'));

  const inter = c.store.json('data/interactions.json');
  assert.equal(inter.comments[0].author, '[deleted]', 'comments stay readable but detached');
  assert.deepEqual(inter.likes, {});
  assert.match(String(res.cookies.session || ''), /^$/, 'the session cookie must be cleared');
});

test('the admin account cannot be deleted or renamed away', async () => {
  const admin = h.user({ username: 'siteadmin', email: ADMIN_EMAIL });
  const c = ctx({ base: { users: [admin] } });
  const cookies = h.sessionFor(c, admin);
  const del = await post(c, 'delete-account', { password: h.TEST_PASSWORD }, cookies);
  assert.equal(del.statusCode, 403);
  const email = await post(c, 'change-email', { email: 'x@example.invalid', password: h.TEST_PASSWORD }, cookies);
  assert.equal(email.statusCode, 403);
});

test('a Google-only account deletes by typing its username instead of a password', async () => {
  const u = h.user({ username: 'ggl2', email: 'ggl2@example.invalid', password_hash: null, provider: 'google' });
  const c = ctx({ base: { users: [u] } });
  const cookies = h.sessionFor(c, u);
  let res = await post(c, 'delete-account', { confirm: 'wrong' }, cookies);
  assert.equal(res.statusCode, 400);
  res = await post(c, 'delete-account', { confirm: 'ggl2' }, cookies);
  assert.equal(res.statusCode, 200);
});

// ---------------------------------------------------------------------------
// Self-service flags
// ---------------------------------------------------------------------------
test('account self-service respects the admin switches', async () => {
  const u = h.user();
  for (const [flag, route, body] of [
    ['email_change_enabled', 'change-email', { email: 'x@example.invalid', password: h.TEST_PASSWORD }],
    ['username_change_enabled', 'change-username', { username: 'newname1', password: h.TEST_PASSWORD }],
    ['account_delete_enabled', 'delete-account', { password: h.TEST_PASSWORD }],
  ]) {
    const c = ctx({ base: { users: [u], settings: { [flag]: false } } });
    const res = await post(c, route, body, h.sessionFor(c, u));
    assert.equal(res.statusCode, 403, `${route} ignored ${flag}=false`);
  }
});
