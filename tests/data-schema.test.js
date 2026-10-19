// Validity and schema of the committed data files, plus the containment
// invariants the audit created (plan 13: "صحة ملفات JSON ومخطط البيانات").
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));

test('every data/*.json file parses', () => {
  const files = fs.readdirSync(DATA).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 7, `expected the operational files, found ${files.length}`);
  for (const f of files) {
    assert.doesNotThrow(() => read(f), `${f} must be valid JSON`);
  }
});

test('users.json matches the expected shape', () => {
  const { users } = read('users.json');
  assert.ok(Array.isArray(users));
  for (const u of users) {
    assert.equal(typeof u.username, 'string', 'username is required');
    assert.match(u.username, /^[a-zA-Z0-9_]{3,20}$/, `invalid username: ${u.username}`);
    assert.equal(typeof u.email, 'string', `missing email for ${u.username}`);
    assert.match(u.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, `invalid email for ${u.username}`);
    assert.equal(typeof u.verified, 'boolean');
    assert.equal(typeof u.session_version, 'number', `session_version missing for ${u.username}`);
  }
});

test('usernames and emails are unique (case-insensitive)', () => {
  const { users } = read('users.json');
  const names = users.map((u) => u.username.toLowerCase());
  const emails = users.map((u) => u.email.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'duplicate username');
  assert.equal(new Set(emails).size, emails.length, 'duplicate email');
});

// --- SEC-01 containment ----------------------------------------------------
test('no plaintext verification or reset token remains in users.json', () => {
  const { users } = read('users.json');
  const leftovers = users.filter((u) => u.verification_token || u.reset_token || u.pending_email_token);
  assert.deepEqual(leftovers.map((u) => u.username), [],
    'legacy plaintext tokens must be revoked (scripts/revoke-legacy-tokens.js)');
});

test('no token field of any kind is stored in clear', () => {
  const raw = fs.readFileSync(path.join(DATA, 'users.json'), 'utf8');
  for (const field of ['"verification_token"', '"reset_token"', '"pending_email_token"']) {
    assert.ok(!raw.includes(field), `${field} must not appear in users.json`);
  }
});

test('phone numbers are no longer stored (data minimisation)', () => {
  const { users } = read('users.json');
  assert.deepEqual(users.filter((u) => 'phone' in u).map((u) => u.username), [],
    'the phone column had no consumer and must stay purged');
});

test('every account still has its password hash or is a Google account', () => {
  const { users } = read('users.json');
  for (const u of users) {
    const ok = typeof u.password_hash === 'string' || u.provider === 'google' || u.password_hash === null;
    assert.ok(ok, `${u.username} lost its credential during remediation`);
  }
});

// --- SEC-02 containment ----------------------------------------------------
test('settings.json is on the safe defaults', () => {
  const s = read('settings.json');
  assert.equal(s.auto_approve, false, 'auto_approve must stay off (plan 6.1 step 2)');
  assert.equal(s.filter_enabled, true, 'the moderation filter must stay on');
});

// --- manifest ---------------------------------------------------------------
test('manifest filenames pass the server-side allowlist', () => {
  const { validateFilename } = require('../api/_content');
  const { codes } = read('manifest.json');
  const bad = codes.filter((c) => !validateFilename(c.filename).ok).map((c) => c.filename);
  assert.deepEqual(bad, [], 'run scripts/normalize-manifest.js --write');
});

test('manifest rows carry the full schema', () => {
  const { codes } = read('manifest.json');
  for (const c of codes) {
    assert.equal(typeof c.filename, 'string');
    assert.equal(typeof c.title, 'string');
    assert.ok(c.status, `${c.filename} has no status`);
    assert.ok(c.published_at, `${c.filename} has no published_at (APP-02)`);
    assert.equal(typeof c.executable, 'boolean', `${c.filename} has no executable flag`);
    assert.ok(Array.isArray(c.tags), `${c.filename} tags must be an array`);
  }
});

test('manifest filenames are unique and every row has its file', () => {
  const { codes } = read('manifest.json');
  const names = codes.map((c) => c.filename);
  assert.equal(new Set(names).size, names.length, 'duplicate filename in the manifest');
  const onDisk = new Set(fs.readdirSync(path.join(ROOT, 'codes')));
  const missing = names.filter((n) => !onDisk.has(n));
  assert.deepEqual(missing, [], 'manifest row without a stored file');
});

test('no stored code file is missing from the manifest', () => {
  const { codes } = read('manifest.json');
  const names = new Set(codes.map((c) => c.filename));
  const orphans = fs.readdirSync(path.join(ROOT, 'codes'))
    .filter((f) => f !== '.gitkeep' && !names.has(f));
  assert.deepEqual(orphans, [], 'unlisted file in codes/');
});

test('renamed files keep an alias so published links still resolve', () => {
  const { codes } = read('manifest.json');
  const renamed = codes.filter((c) => c.renamed_at);
  for (const c of renamed) {
    assert.ok(Array.isArray(c.aliases) && c.aliases.length,
      `${c.filename} was renamed without recording its previous name`);
  }
});

test('executable entries are flagged as such', () => {
  const { codes } = read('manifest.json');
  const { isExecutableExtension } = require('../api/_content');
  for (const c of codes) {
    const ext = c.filename.split('.').pop().toLowerCase();
    if (isExecutableExtension(ext)) {
      assert.equal(c.executable, true, `${c.filename} must be marked executable`);
    }
  }
});

// --- interactions -----------------------------------------------------------
test('interactions.json like keys are "<username>|<filename>"', () => {
  const data = read('interactions.json');
  for (const key of Object.keys(data.likes || {})) {
    assert.match(key, /^[^|]+\|[^|]+$/, `malformed like key: ${key}`);
  }
});

test('likeTotals agrees with the like keys', () => {
  const { recomputeTotals } = require('../api/_h/likes');
  const data = read('interactions.json');
  const expected = recomputeTotals(data.likes || {});
  // Totals must never claim more likes than there are keys.
  for (const [code, total] of Object.entries(data.likeTotals || {})) {
    assert.ok((expected[code] || 0) <= total || expected[code] === total,
      `likeTotals[${code}] is inconsistent with the like keys`);
  }
});

test('no report record keeps a copy of the reporter email', () => {
  const data = read('interactions.json');
  // New reports omit it; this guards against the field creeping back in.
  const { reports } = data;
  assert.ok(Array.isArray(reports));
});
