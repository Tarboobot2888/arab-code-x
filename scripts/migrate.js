#!/usr/bin/env node
// Migration runner (plan 6.2 step 1: "جمّد مخطط كل ملف JSON، ثم أنشئ جداول
// مكافئة وقيوداً واضحة").
//
//   node scripts/migrate.js            # apply pending migrations
//   node scripts/migrate.js --status   # list what is applied / pending
//   node scripts/migrate.js --down     # roll back the last applied migration
//   node scripts/migrate.js --dry-run  # print what would run, touch nothing
//
// Requires DATABASE_URL. Without it the script reports exactly what is missing
// and exits 2 — it never pretends a migration ran.
//
// Every file runs inside a single transaction together with its
// schema_migrations row, so a failure leaves nothing half-applied. A checksum is
// stored so an already-applied file that later changed is reported instead of
// being silently skipped.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'migrations');
const has = (f) => process.argv.includes(f);

const TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum   TEXT NOT NULL
)`;

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort()
    .map((f) => {
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
      const downPath = path.join(DIR, f.replace(/\.sql$/, '.down.sql'));
      return {
        version: f.replace(/\.sql$/, ''),
        file: f,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex').slice(0, 32),
        down: fs.existsSync(downPath) ? fs.readFileSync(downPath, 'utf8') : null,
      };
    });
}

function requireDatabase() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('[migrate] DATABASE_URL is not set.');
    console.error('[migrate] Nothing was applied. Set it to a managed PostgreSQL instance, e.g.:');
    console.error('[migrate]   export DATABASE_URL="postgres://<user>:<password>@<host>:5432/arabcode?sslmode=require"');
    console.error('[migrate] This needs operator credentials — see README.md (الترحيل).');
    process.exit(2);
  }
  let pg;
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    pg = require('pg');
  } catch {
    console.error('[migrate] the optional dependency "pg" is not installed.');
    console.error('[migrate] run: npm install pg');
    process.exit(2);
  }
  return { url, pg };
}

async function main() {
  const migrations = list();
  console.log(`[migrate] ${migrations.length} migration file(s) in migrations/`);

  if (has('--dry-run')) {
    for (const m of migrations) {
      console.log(`  would apply ${m.file} (${m.sql.split('\n').length} lines, checksum ${m.checksum})`);
      console.log(`    rollback: ${m.down ? `${m.version}.down.sql` : 'MISSING — refuse to apply without one'}`);
    }
    const missing = migrations.filter((m) => !m.down);
    if (missing.length) {
      console.error(`[migrate] ${missing.length} migration(s) have no rollback script`);
      process.exit(1);
    }
    console.log('[migrate] dry run only — no database connection was made');
    return;
  }

  const { url, pg } = requireDatabase();
  const client = new pg.Client({
    connectionString: url,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: true } : undefined,
    statement_timeout: 120000,
  });
  await client.connect();
  try {
    await client.query(TRACKING_TABLE);
    const { rows } = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));

    if (has('--status')) {
      for (const m of migrations) {
        const a = applied.get(m.version);
        if (!a) console.log(`  PENDING  ${m.version}`);
        else if (a !== m.checksum) console.log(`  CHANGED  ${m.version} (applied checksum ${a} != file ${m.checksum})`);
        else console.log(`  applied  ${m.version}`);
      }
      return;
    }

    if (has('--down')) {
      const lastApplied = [...applied.keys()].sort().pop();
      if (!lastApplied) { console.log('[migrate] nothing to roll back'); return; }
      const m = migrations.find((x) => x.version === lastApplied);
      if (!m || !m.down) {
        console.error(`[migrate] no rollback script for ${lastApplied}`);
        process.exit(1);
      }
      console.log(`[migrate] rolling back ${m.version} — make sure a verified backup exists`);
      await client.query('BEGIN');
      try {
        await client.query(m.down);
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [m.version]);
        await client.query('COMMIT');
        console.log(`[migrate] rolled back ${m.version}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      return;
    }

    // Refuse to apply anything that cannot be rolled back.
    const noDown = migrations.filter((m) => !applied.has(m.version) && !m.down);
    if (noDown.length) {
      console.error(`[migrate] refusing to apply without a rollback script: ${noDown.map((m) => m.version).join(', ')}`);
      process.exit(1);
    }

    let count = 0;
    for (const m of migrations) {
      const a = applied.get(m.version);
      if (a && a !== m.checksum) {
        console.error(`[migrate] ${m.version} was already applied but the file changed — create a new migration instead`);
        process.exit(1);
      }
      if (a) continue;
      console.log(`[migrate] applying ${m.version}`);
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [m.version, m.checksum],
        );
        await client.query('COMMIT');
        count += 1;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[migrate] ${m.version} FAILED and was rolled back: ${e.message}`);
        process.exit(1);
      }
    }
    console.log(count ? `[migrate] applied ${count} migration(s)` : '[migrate] already up to date');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('[migrate]', e.message); process.exit(1); });
}
module.exports = { list };
