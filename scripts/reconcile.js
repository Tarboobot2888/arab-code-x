#!/usr/bin/env node
// Pre/post-migration reconciliation (plan 6.2 step 3 and the acceptance gate of
// phase 2: "تقرير مطابقة counts قبل/بعد").
//
//   node scripts/reconcile.js              # offline: JSON vs. the planned rows
//   node scripts/reconcile.js --db         # compare the live database with data/
//
// Offline mode needs no credentials and runs in CI. --db mode is the gate that
// must pass before reads are switched to the database; it exits non-zero on any
// difference the transform did not already explain.
'use strict';

const { transform, printReport } = require('./import-json-to-pg');

const has = (f) => process.argv.includes(f);

// Planned row set -> the table that should hold it.
const TABLE_OF = {
  users: 'users',
  profiles: 'user_profiles',
  codes: 'codes',
  aliases: 'code_aliases',
  tags: 'tags',
  codeTags: 'code_tags',
  comments: 'comments',
  likes: 'code_likes',
  reports: 'reports',
  bans: 'bans',
  packages: 'packages',
  deleteRequests: 'delete_requests',
  messages: 'support_messages',
  settingRows: 'app_settings',
};

async function compareWithDatabase(rows) {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('[reconcile] DATABASE_URL is not set — cannot compare with the database.');
    console.error('[reconcile] This step needs operator credentials; run without --db for the offline report.');
    process.exit(2);
  }
  let pg;
  try { pg = require('pg'); } catch { console.error('[reconcile] run: npm install pg'); process.exit(2); }

  const client = new pg.Client({
    connectionString: url,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: true } : undefined,
  });
  await client.connect();
  const diffs = [];
  try {
    console.log('[reconcile] expected (from data/) vs. actual (database)');
    for (const [key, table] of Object.entries(TABLE_OF)) {
      const expected = (rows[key] || []).length;
      let actual;
      try {
        const { rows: r } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
        actual = r[0].n;
      } catch (e) {
        diffs.push(`${table}: unreadable (${e.message})`);
        continue;
      }
      const ok = actual === expected;
      if (!ok) diffs.push(`${table}: expected ${expected}, found ${actual}`);
      console.log(`  ${table.padEnd(20)} expected=${String(expected).padStart(5)} actual=${String(actual).padStart(5)} ${ok ? 'ok' : 'DIFFERS'}`);
    }

    // Spot-check a few natural keys actually landed, not just the counts.
    const sampleUsers = (rows.users || []).slice(0, 5);
    for (const u of sampleUsers) {
      const { rows: r } = await client.query('SELECT username, email FROM users WHERE id = $1', [u.id]);
      if (!r.length) diffs.push(`users: ${u.username} is missing`);
      else if (String(r[0].username).toLowerCase() !== u.username.toLowerCase()) {
        diffs.push(`users: ${u.username} maps to ${r[0].username}`);
      }
    }
    const sampleCodes = (rows.codes || []).slice(0, 5);
    for (const c of sampleCodes) {
      const { rows: r } = await client.query('SELECT slug FROM codes WHERE id = $1', [c.id]);
      if (!r.length) diffs.push(`codes: ${c.slug} is missing`);
    }

    // Likes must stay unique per (member, code) — the APP-01 invariant.
    const { rows: dup } = await client.query(
      'SELECT user_id, code_id, count(*) AS n FROM code_likes GROUP BY 1,2 HAVING count(*) > 1',
    );
    if (dup.length) diffs.push(`code_likes: ${dup.length} duplicate (user, code) pair(s)`);
  } finally {
    await client.end();
  }

  if (diffs.length) {
    console.log(`[reconcile] ${diffs.length} difference(s):`);
    for (const d of diffs) console.log(`  x ${d}`);
    console.log('[reconcile] DO NOT switch reads to the database until these are explained');
    process.exit(1);
  }
  console.log('[reconcile] database matches the source files');
}

async function main() {
  const { report, rows } = transform();
  printReport(report);
  console.log('[reconcile] planned row counts:');
  for (const [key, table] of Object.entries(TABLE_OF)) {
    console.log(`  ${table.padEnd(20)} ${(rows[key] || []).length}`);
  }
  if (has('--db')) {
    await compareWithDatabase(rows);
    return;
  }
  console.log('[reconcile] offline report only. Run with --db (and DATABASE_URL) after an import.');
}

if (require.main === module) {
  main().catch((e) => { console.error('[reconcile]', e.message); process.exit(1); });
}
module.exports = { TABLE_OF };
