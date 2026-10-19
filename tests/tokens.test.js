// Verification / reset / email-change tokens: expiry, single use, hashing and
// replay (plan 4.ب and 13: "انتهاء رموز التفعيل وإعادة التعيين ومنع إعادة
// الاستخدام").
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const tokens = require('../api/_tokens');

const PURPOSES = ['verify', 'reset', 'email_change'];

for (const purpose of PURPOSES) {
  test(`${purpose}: issue stores only a hash and a mandatory expiry`, () => {
    const u = {};
    const plain = tokens.issue(u, purpose);
    const f = tokens.FIELDS[purpose];
    assert.match(plain, /^[0-9a-f]{64}$/, 'the token must be 32 random bytes in hex');
    assert.equal(u[f.hash], crypto.createHash('sha256').update(plain).digest('hex'));
    assert.ok(Number.isFinite(u[f.exp]) && u[f.exp] > Date.now(), 'an expiry is mandatory');
    // The plaintext must never be persisted.
    assert.ok(!Object.values(u).includes(plain), 'the plaintext token was stored');
  });

  test(`${purpose}: the correct token is accepted exactly once`, () => {
    const u = {};
    const plain = tokens.issue(u, purpose);
    assert.deepEqual(tokens.consume(u, purpose, plain), { ok: true });
    // Replay must fail: consume() cleared the stored hash.
    assert.deepEqual(tokens.consume(u, purpose, plain), { ok: false, reason: 'missing' });
  });

  test(`${purpose}: a wrong token is rejected and does not burn the real one`, () => {
    const u = {};
    const plain = tokens.issue(u, purpose);
    assert.deepEqual(tokens.consume(u, purpose, 'f'.repeat(64)), { ok: false, reason: 'mismatch' });
    assert.deepEqual(tokens.consume(u, purpose, plain), { ok: true });
  });

  test(`${purpose}: an expired token is rejected and cleared`, () => {
    const u = {};
    const plain = tokens.issue(u, purpose, -1000); // already expired
    assert.deepEqual(tokens.consume(u, purpose, plain), { ok: false, reason: 'expired' });
    const f = tokens.FIELDS[purpose];
    assert.equal(u[f.hash], null, 'an expired token must be removed, not left usable');
  });

  test(`${purpose}: a legacy row with NO expiry is treated as expired`, () => {
    // This is the exact SEC-01 shape: a plaintext token with no expiry field.
    const u = { [tokens.FIELDS[purpose].legacy]: 'legacy-plaintext-value' };
    const r = tokens.consume(u, purpose, 'legacy-plaintext-value');
    assert.equal(r.ok, false, 'a never-expiring legacy token must not authenticate');
    assert.equal(r.reason, 'expired');
  });

  test(`${purpose}: a hash with a missing expiry is rejected`, () => {
    const f = tokens.FIELDS[purpose];
    const plain = 'a'.repeat(64);
    const u = { [f.hash]: tokens.hashToken(plain) }; // no expiry at all
    assert.equal(tokens.consume(u, purpose, plain).ok, false);
  });

  test(`${purpose}: issuing a new token invalidates the previous one`, () => {
    const u = {};
    const first = tokens.issue(u, purpose);
    const second = tokens.issue(u, purpose);
    assert.notEqual(first, second);
    assert.deepEqual(tokens.consume(u, purpose, first), { ok: false, reason: 'mismatch' });
  });

  test(`${purpose}: an empty token never matches`, () => {
    const u = {};
    tokens.issue(u, purpose);
    for (const bad of [undefined, null, '', 0, false]) {
      assert.equal(tokens.consume(u, purpose, bad).ok, false, `accepted ${JSON.stringify(bad)}`);
    }
  });
}

test('issue clears the legacy plaintext column', () => {
  const u = { verification_token: 'old-clear-value' };
  tokens.issue(u, 'verify');
  assert.equal(u.verification_token, null);
});

test('isActive reflects presence and expiry', () => {
  const u = {};
  assert.equal(tokens.isActive(u, 'verify'), false);
  tokens.issue(u, 'verify');
  assert.equal(tokens.isActive(u, 'verify'), true);
  tokens.clear(u, 'verify');
  assert.equal(tokens.isActive(u, 'verify'), false);
  tokens.issue(u, 'verify', -1);
  assert.equal(tokens.isActive(u, 'verify'), false);
});

test('safeEqual is length-safe and value-correct', () => {
  assert.equal(tokens.safeEqual('abc', 'abc'), true);
  assert.equal(tokens.safeEqual('abc', 'abd'), false);
  assert.equal(tokens.safeEqual('abc', 'abcd'), false, 'differing lengths must not throw');
  assert.equal(tokens.safeEqual('', ''), true);
  assert.equal(tokens.safeEqual(null, undefined), true, 'both empty');
});

test('an unknown purpose throws rather than silently doing nothing', () => {
  assert.throws(() => tokens.issue({}, 'nope'), /unknown token purpose/);
});

test('tokens from two issues are not predictable from each other', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(tokens.issue({}, 'verify'));
  assert.equal(seen.size, 200, 'token generation must not repeat');
});
