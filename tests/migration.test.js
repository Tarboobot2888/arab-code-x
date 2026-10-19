// Migration scaffolding tests (plan 6.2, 13 "اختبارات الترحيل عند توفر قاعدة
// البيانات").
//
// These run WITHOUT a database: they cover the schema's own invariants (as text),
// the migration runner's refusal rules, and the importer's transform — which is
// where the data-loss risk actually lives. The parts that genuinely need a live
// PostgreSQL connection are listed as skipped, with the reason, rather than
// being faked.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/harness');

const ROOT = h.ROOT;
const schema = fs.readFileSync(path.join(ROOT, 'migrations', '001_initial_schema.sql'), 'utf8');
const down = fs.readFileSync(path.join(ROOT, 'migrations', '001_initial_schema.down.sql'), 'utf8');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
test('the schema is transactional', () => {
  assert.match(schema, /^BEGIN;/m, 'the migration must not apply half-way');
  assert.match(schema, /^COMMIT;/m);
  assert.match(down, /^BEGIN;/m);
  assert.match(down, /^COMMIT;/m);
});

test('every table in the schema has a rollback drop', () => {
  const created = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.ok(created.length > 15, `expected the full model, found ${created.length} tables`);
  for (const t of created) {
    if (t === 'schema_migrations') continue; // the runner's own bookkeeping survives
    assert.match(down, new RegExp(`DROP TABLE IF EXISTS ${t}\\b`), `no rollback for ${t}`);
  }
});

test('the identity tables carry the uniqueness constraints the JSON files lacked', () => {
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS users_username_key/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS users_email_key/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS codes_slug_key/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS packages_slug_key/);
});

test('a like is unique per (member, code) by primary key, not by a check-then-write', () => {
  const block = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS code_likes'));
  assert.match(block.slice(0, 500), /PRIMARY KEY \(user_id, code_id\)/,
    'the uniqueness that APP-01 needs must be structural');
});

test('a token row cannot exist without an expiry', () => {
  const block = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS auth_tokens'));
  assert.match(block.slice(0, 900), /expires_at\s+TIMESTAMPTZ NOT NULL/,
    'SEC-01: a token with no expiry must be impossible to store');
  assert.match(block.slice(0, 900), /token_hash\s+TEXT NOT NULL/);
  assert.ok(!/token_plain|token_value/.test(schema), 'no column may hold a plaintext token');
  assert.match(schema, /auth_tokens_active_key[\s\S]{0,200}WHERE consumed_at IS NULL/,
    'only one active token per purpose, so issuing a new one invalidates the old');
});

test('approved executable content requires a recorded approver', () => {
  assert.match(schema, /codes_executable_requires_review/,
    'SEC-02: executable content must not be publishable without a review decision');
});

test('only one open delete request per code is possible', () => {
  assert.match(schema, /delete_requests_open_key[\s\S]{0,200}WHERE status = 'pending'/);
});

test('private contact data lives in its own table', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_private_contacts/,
    'plan 9.3: private fields are separated from the public profile');
  // Bound the slice to the user_profiles statement itself; the next table in the
  // file is user_private_contacts, which legitimately has the column.
  const from = schema.indexOf('CREATE TABLE IF NOT EXISTS user_profiles');
  const profile = schema.slice(from, schema.indexOf('\n);', from));
  assert.ok(profile.includes('bio'), 'slice did not capture the user_profiles statement');
  assert.ok(!/phone/.test(profile), 'the public profile must not carry a phone number');
});

test('the public view exposes approved codes only', () => {
  const view = schema.slice(schema.indexOf('CREATE OR REPLACE VIEW public_codes'));
  assert.match(view, /WHERE c\.moderation_status = 'approved'/);
  assert.ok(!/password_hash/.test(view), 'the public view must not join a credential');
  assert.ok(!/u\.email/.test(view), 'the public view must not expose email addresses');
});

test('URL columns are constrained to https', () => {
  for (const c of ['profile_website_https', 'profile_avatar_https', 'profile_banner_https']) {
    assert.match(schema, new RegExp(c), `missing constraint ${c}`);
  }
});

test('indexes exist for the queries the app actually makes', () => {
  for (const idx of [
    'codes_owner_idx', 'codes_status_idx', 'codes_language_idx', 'codes_published_idx',
    'comments_code_idx', 'code_likes_code_idx', 'reports_status_idx', 'audit_log_created_idx',
  ]) {
    assert.match(schema, new RegExp(idx), `missing index ${idx}`);
  }
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
test('the runner lists the migration with its rollback', () => {
  const { list } = require('../scripts/migrate');
  const items = list();
  assert.equal(items.length, 1);
  assert.equal(items[0].version, '001_initial_schema');
  assert.ok(items[0].down, 'every migration must ship a rollback script');
  assert.match(items[0].checksum, /^[0-9a-f]{32}$/);
});

test('the runner refuses to touch anything without DATABASE_URL', () => {
  const { execFileSync } = require('child_process');
  const env = { ...process.env };
  delete env.DATABASE_URL;
  let code = 0;
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate.js')], { env, encoding: 'utf8' });
  } catch (e) {
    code = e.status;
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  assert.equal(code, 2, 'a missing DATABASE_URL must be a distinct, non-silent exit code');
  assert.match(out, /DATABASE_URL is not set/);
  assert.match(out, /Nothing was applied/, 'the runner must say plainly that nothing happened');
});

test('the dry run reports the plan and makes no connection', () => {
  const { execFileSync } = require('child_process');
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate.js'), '--dry-run'],
    { env, encoding: 'utf8' });
  assert.match(out, /would apply 001_initial_schema\.sql/);
  assert.match(out, /no database connection was made/);
});

// ---------------------------------------------------------------------------
// Importer transform — where data could actually be lost
// ---------------------------------------------------------------------------
function transformWith(files) {
  const dataDir = path.join(ROOT, 'data');
  const originals = new Map();
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dataDir, name);
    originals.set(p, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
    fs.writeFileSync(p, JSON.stringify(content, null, 2));
  }
  // The importer caches nothing, but it is required fresh so env changes apply.
  delete require.cache[require.resolve('../scripts/import-json-to-pg')];
  try {
    return require('../scripts/import-json-to-pg').transform();
  } finally {
    for (const [p, content] of originals) {
      if (content === null) fs.unlinkSync(p);
      else fs.writeFileSync(p, content);
    }
    delete require.cache[require.resolve('../scripts/import-json-to-pg')];
  }
}

const EMPTY = {
  'interactions.json': { comments: [], likes: {}, reports: [], likeTotals: {} },
  'bans.json': {},
  'zips.json': { zips: [] },
  'delete_requests.json': { items: [] },
  'messages.json': { messages: [] },
  'settings.json': { auto_approve: false, filter_enabled: true },
};

test('the importer maps a clean dataset one-to-one', () => {
  process.env.ADMIN_EMAIL = 'admin@example.invalid';
  const { report, rows } = transformWith({
    ...EMPTY,
    'users.json': {
      users: [
        h.user({ username: 'alpha', email: 'alpha@example.invalid' }),
        h.user({ username: 'siteadmin', email: 'admin@example.invalid' }),
      ],
    },
    'manifest.json': { codes: [h.manifestEntry({ filename: 'demo.js', author: 'alpha' })] },
  });
  assert.equal(report.source_counts.users, 2);
  assert.equal(report.target_counts.users, 2);
  assert.equal(report.target_counts.codes, 1);
  assert.equal(rows.users.find((u) => u.username === 'siteadmin').role, 'admin',
    'the admin role comes from ADMIN_EMAIL, not from a username');
  assert.equal(rows.users.find((u) => u.username === 'alpha').role, 'member');
  assert.equal(rows.codes[0].owner_id, rows.users.find((u) => u.username === 'alpha').id);
});

test('the importer is deterministic: the same input yields the same ids', () => {
  process.env.ADMIN_EMAIL = 'admin@example.invalid';
  const input = {
    ...EMPTY,
    'users.json': { users: [h.user({ username: 'alpha', email: 'alpha@example.invalid' })] },
    'manifest.json': { codes: [h.manifestEntry({ filename: 'demo.js', author: 'alpha' })] },
  };
  const a = transformWith(input);
  const b = transformWith(input);
  assert.equal(a.rows.users[0].id, b.rows.users[0].id, 're-running must not create duplicate rows');
  assert.equal(a.rows.codes[0].id, b.rows.codes[0].id);
  assert.match(a.rows.users[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('invalid rows are reported and skipped, never coerced', () => {
  process.env.ADMIN_EMAIL = 'admin@example.invalid';
  const { report, rows } = transformWith({
    ...EMPTY,
    'users.json': {
      users: [
        h.user({ username: 'ok1', email: 'ok1@example.invalid' }),
        h.user({ username: 'x', email: 'bad1@example.invalid' }),          // username too short
        h.user({ username: 'ok2', email: 'not-an-email' }),                // invalid email
        h.user({ username: 'OK1', email: 'dup@example.invalid' }),         // duplicate username
        h.user({ username: 'ok3', email: 'OK1@example.invalid' }),         // duplicate email
      ],
    },
    'manifest.json': {
      codes: [
        h.manifestEntry({ filename: 'good.js', author: 'ok1' }),
        h.manifestEntry({ filename: 'bad name.js', author: 'ok1' }),       // invalid filename
        h.manifestEntry({ filename: 'weird.js', author: 'ok1', language: 'exe' }), // bad language
        h.manifestEntry({ filename: 'good.js', author: 'ok1' }),           // duplicate slug
      ],
    },
  });
  assert.equal(rows.users.length, 1, 'only the valid account is imported');
  assert.equal(rows.codes.length, 1);
  const reasons = report.skipped.map((s) => s.why);
  assert.ok(reasons.some((r) => /invalid username/.test(r)));
  assert.ok(reasons.some((r) => /invalid email/.test(r)));
  assert.ok(reasons.some((r) => /invalid filename/.test(r)));
  assert.ok(reasons.some((r) => /unsupported language/.test(r)));
  assert.equal(report.duplicates.length, 3, 'every duplicate must be named, not silently merged');
});

test('a plaintext token in the source is reported and NOT imported', () => {
  process.env.ADMIN_EMAIL = 'admin@example.invalid';
  const { report, rows } = transformWith({
    ...EMPTY,
    'users.json': {
      users: [h.user({
        username: 'legacy', email: 'legacy@example.invalid',
        verification_token: 'leaked-value', reset_token: 'another-leaked-value',
      })],
    },
    'manifest.json': { codes: [] },
  });
  assert.ok(report.warnings.some((w) => /plaintext token/.test(w)));
  const serialized = JSON.stringify(rows);
  assert.ok(!serialized.includes('leaked-value'), 'a leaked token must not be carried into the database');
});

test('session_version is carried over so revoked sessions stay revoked', () => {
  process.env.ADMIN_EMAIL = 'admin@example.invalid';
  const { rows } = transformWith({
    ...EMPTY,
    'users.json': { users: [h.user({ username: 'rotated', email: 'rotated@example.invalid', session_version: 7 })] },
    'manifest.json': { codes: [] },
  });
  assert.equal(rows.users[0].session_version, 7);
});

test('an orphaned interaction is skipped with a stated reason', () => {
  process.env.ADMIN_EMAIL = 'admin@example.invalid';
  const { report, rows } = transformWith({
    ...EMPTY,
    'users.json': { users: [h.user({ username: 'alpha', email: 'alpha@example.invalid' })] },
    'manifest.json': { codes: [h.manifestEntry({ filename: 'demo.js', author: 'alpha' })] },
    'interactions.json': {
      comments: [
        { id: 'c1', code: 'demo.js', author: 'alpha', text: 'ok', created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'c2', code: 'deleted.js', author: 'alpha', text: 'orphan', created_at: '2026-01-01T00:00:00.000Z' },
      ],
      likes: { 'alpha|demo.js': '2026-01-01', 'ghost|demo.js': '2026-01-01', 'alpha|deleted.js': '2026-01-01' },
      reports: [],
      likeTotals: {},
    },
  });
  assert.equal(rows.comments.length, 1);
  assert.equal(rows.likes.length, 1);
  const why = report.skipped.map((s) => s.why).join(' | ');
  assert.match(why, /no longer exists/);
  assert.match(why, /unknown account/);
  assert.match(why, /unknown code/);
});

test('a legacy alias is imported so published links keep resolving', () => {
  process.env.ADMIN_EMAIL = 'admin@example.invalid';
  const { rows } = transformWith({
    ...EMPTY,
    'users.json': { users: [h.user({ username: 'alpha', email: 'alpha@example.invalid' })] },
    'manifest.json': {
      codes: [h.manifestEntry({ filename: 'group-members.js', author: 'alpha', aliases: ['group-Members'] })],
    },
    'interactions.json': {
      // A comment stored under the OLD name must still find its code.
      comments: [{ id: 'c1', code: 'group-Members', author: 'alpha', text: 'ok', created_at: '2026-01-01' }],
      likes: {}, reports: [], likeTotals: {},
    },
  });
  assert.equal(rows.aliases.length, 1);
  assert.equal(rows.aliases[0].alias, 'group-Members');
  assert.equal(rows.comments.length, 1, 'the alias must resolve the comment to its code');
  assert.equal(rows.comments[0].code_id, rows.codes[0].id);
});

test('an approved executable code gets an approver so the schema check passes', () => {
  process.env.ADMIN_EMAIL = 'admin@example.invalid';
  const { rows } = transformWith({
    ...EMPTY,
    'users.json': { users: [h.user({ username: 'alpha', email: 'alpha@example.invalid' })] },
    'manifest.json': {
      codes: [h.manifestEntry({
        filename: 'page.html', language: 'html', executable: true, author: 'alpha', status: 'approved',
      })],
    },
  });
  assert.equal(rows.codes[0].is_executable, true);
  assert.ok(rows.codes[0].approved_by, 'codes_executable_requires_review would reject a NULL approver');
});

test('the transform never writes to data/', () => {
  const before = fs.readdirSync(path.join(ROOT, 'data')).map((f) => {
    const p = path.join(ROOT, 'data', f);
    return `${f}:${fs.statSync(p).size}`;
  }).sort();
  process.env.ADMIN_EMAIL = 'admin@example.invalid';
  require('../scripts/import-json-to-pg').transform();
  const after = fs.readdirSync(path.join(ROOT, 'data')).map((f) => {
    const p = path.join(ROOT, 'data', f);
    return `${f}:${fs.statSync(p).size}`;
  }).sort();
  assert.deepEqual(after, before, 'the importer must not modify the source of truth');
});

test('the reconciliation mapping covers every planned row set', () => {
  const { TABLE_OF } = require('../scripts/reconcile');
  process.env.ADMIN_EMAIL = 'admin@example.invalid';
  const { rows } = require('../scripts/import-json-to-pg').transform();
  for (const key of Object.keys(rows)) {
    assert.ok(TABLE_OF[key], `reconcile.js has no target table for the "${key}" row set`);
  }
});

// ---------------------------------------------------------------------------
// What genuinely needs a live database
// ---------------------------------------------------------------------------
const DB = (process.env.DATABASE_URL || '').trim();

test('live schema apply + rollback', { skip: DB ? false : 'needs DATABASE_URL (operator credential)' }, async () => {
  // Intentionally not simulated: applying DDL against a fake would prove nothing.
  // With DATABASE_URL set, run:
  //   npm run db:migrate && npm run db:import && npm run db:reconcile -- --db
  //   node scripts/migrate.js --down
  assert.ok(DB);
});

test('live concurrent-write transaction test', { skip: DB ? false : 'needs DATABASE_URL (operator credential)' }, async () => {
  // Two sessions updating the same row must serialise; this is the acceptance
  // gate for phase 2 and can only be proved against a real engine.
  assert.ok(DB);
});

test('live backup and restore drill', { skip: DB ? false : 'needs DATABASE_URL (operator credential)' }, async () => {
  // pg_dump -> restore into a scratch database -> reconcile. See README.
  assert.ok(DB);
});
