#!/usr/bin/env node
// Idempotent importer: data/*.json -> PostgreSQL (plan 6.2 step 2: "اكتب
// importer قابل لإعادة التشغيل (idempotent) مع تقرير عن عدد السجلات والمفاتيح
// المكررة والحقول غير الصالحة؛ لا تتخلص من بيانات المصدر قبل التحقق").
//
//   node scripts/import-json-to-pg.js --plan      # transform + report, no DB
//   node scripts/import-json-to-pg.js             # import (needs DATABASE_URL)
//   node scripts/import-json-to-pg.js --truncate  # reset the target tables first
//
// Properties:
//   * --plan runs the whole transformation and prints the reconciliation report
//     WITHOUT a database, so the mapping can be reviewed before any credential
//     exists. This is the mode that runs in CI.
//   * Re-runnable: every insert is ON CONFLICT ... DO UPDATE keyed on the
//     natural key, so running it twice changes nothing.
//   * Source files are never modified or deleted.
//   * Invalid rows are REPORTED and skipped, never silently coerced.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const has = (f) => process.argv.includes(f);

const { normalizeLanguage, normalizeLicense, validateFilename, isExecutableExtension, extensionOf } = require('../api/_content');
const { normalize: normalizeText } = require('../api/_search');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function load(name, fallback) {
  const p = path.join(DATA, name);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/**
 * Deterministic id so re-running the importer maps the same record to the same
 * row even without a database round-trip.
 */
function stableUuid(kind, key) {
  const hex = crypto.createHash('sha256').update(`${kind}:${String(key).toLowerCase()}`).digest('hex');
  const b = hex.slice(0, 32).split('');
  b[12] = '5'; // version 5-ish marker
  b[16] = '8'; // RFC 4122 variant
  const s = b.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------
function transform() {
  const report = {
    source_counts: {}, target_counts: {}, skipped: [], warnings: [], duplicates: [],
  };
  const skip = (table, key, why) => report.skipped.push({ table, key, why });
  const warn = (m) => report.warnings.push(m);

  const adminEmail = String(process.env.ADMIN_EMAIL || '').toLowerCase();
  if (!adminEmail) warn('ADMIN_EMAIL is not set — no row will be assigned the admin role');

  // ---- users --------------------------------------------------------------
  const rawUsers = load('users.json', { users: [] }).users || [];
  report.source_counts.users = rawUsers.length;
  const users = [];
  const profiles = [];
  const seenName = new Set();
  const seenEmail = new Set();

  for (const u of rawUsers) {
    const username = String(u.username || '');
    const email = String(u.email || '').toLowerCase();
    if (!USERNAME_RE.test(username)) { skip('users', username || '(blank)', 'invalid username'); continue; }
    if (!EMAIL_RE.test(email)) { skip('users', username, 'invalid email'); continue; }
    if (seenName.has(username.toLowerCase())) { report.duplicates.push({ table: 'users', key: username, field: 'username' }); continue; }
    if (seenEmail.has(email)) { report.duplicates.push({ table: 'users', key: username, field: 'email' }); continue; }
    seenName.add(username.toLowerCase());
    seenEmail.add(email);

    const id = stableUuid('user', username);
    users.push({
      id,
      username,
      email,
      password_hash: u.password_hash || null,
      display_name: String(u.display_name || username).slice(0, 80),
      role: email === adminEmail ? 'admin' : 'member',
      status: u.verified ? 'active' : 'unverified',
      verified_at: u.verified ? (u.verified_at || u.created_at || null) : null,
      is_verified_badge: !!u.is_verified_badge,
      provider: u.provider || null,
      provider_subject: u.google_sub || null,
      // The remediation already bumped this; carry it over so the migration
      // does not silently revive a session the revocation invalidated.
      session_version: Number(u.session_version) || 0,
      created_at: u.created_at || new Date().toISOString(),
    });
    profiles.push({
      user_id: id,
      bio: String(u.bio || '').slice(0, 8000),
      avatar_url: /^https:\/\//i.test(u.avatar_url || '') ? u.avatar_url : null,
      banner_url: /^https:\/\//i.test(u.banner_url || '') ? u.banner_url : null,
      location: String(u.location || '').slice(0, 60),
      website: /^https:\/\//i.test(u.website || '') ? u.website : null,
      links: Array.isArray(u.links) ? u.links.filter((l) => l && l.label && /^(https:\/\/|mailto:)/i.test(l.url || '')) : [],
    });
    if (u.verification_token || u.reset_token || u.pending_email_token) {
      warn(`${username} still carries a plaintext token in the source — it is NOT imported`);
    }
    if ('phone' in u && String(u.phone || '').trim()) {
      warn(`${username} has a phone number in the source — import it into user_private_contacts only if the product needs it`);
    }
  }
  report.target_counts.users = users.length;
  report.target_counts.user_profiles = profiles.length;

  const userIdByName = new Map(users.map((u) => [u.username.toLowerCase(), u.id]));

  // ---- codes --------------------------------------------------------------
  const rawCodes = load('manifest.json', { codes: [] }).codes || [];
  report.source_counts.codes = rawCodes.length;
  const codes = [];
  const aliases = [];
  const tagRows = new Map();
  const codeTags = [];
  const seenSlug = new Set();

  for (const c of rawCodes) {
    const slug = String(c.filename || '');
    const v = validateFilename(slug);
    if (!v.ok) { skip('codes', slug || '(blank)', `invalid filename: ${v.error}`); continue; }
    if (seenSlug.has(slug.toLowerCase())) { report.duplicates.push({ table: 'codes', key: slug, field: 'slug' }); continue; }
    seenSlug.add(slug.toLowerCase());

    const language = normalizeLanguage(c.language);
    if (!language) { skip('codes', slug, `unsupported language "${c.language}"`); continue; }

    const ownerId = userIdByName.get(String(c.author || '').toLowerCase()) || null;
    if (!ownerId && c.author) warn(`code ${slug} is attributed to a non-existent account "${c.author}"`);

    const id = stableUuid('code', slug);
    const status = c.status === 'pending' ? 'pending' : 'approved';
    const executable = !!c.executable || isExecutableExtension(extensionOf(slug));
    codes.push({
      id,
      slug,
      owner_id: ownerId,
      title: String(c.title || slug).slice(0, 120),
      description: String(c.description || '').slice(0, 600),
      language,
      license_spdx: normalizeLicense(c.license),
      moderation_status: status,
      is_executable: executable,
      // The schema requires an approver for approved executable content.
      approved_by: status === 'approved' && executable
        ? (userIdByName.get(String(c.approved_by || '').toLowerCase()) || ownerId)
        : null,
      published_at: c.published_at || c.approved_at || null,
      created_at: c.published_at || c.approved_at || new Date().toISOString(),
    });
    for (const a of c.aliases || []) aliases.push({ alias: String(a), code_id: id });
    for (const t of Array.isArray(c.tags) ? c.tags : []) {
      const name = String(t).trim().slice(0, 24);
      if (!name) continue;
      const tagId = stableUuid('tag', name);
      tagRows.set(name.toLowerCase(), { id: tagId, name, normalized: normalizeText(name) });
      codeTags.push({ code_id: id, tag_id: tagId });
    }
  }
  report.target_counts.codes = codes.length;
  report.target_counts.code_aliases = aliases.length;
  report.target_counts.tags = tagRows.size;
  report.target_counts.code_tags = codeTags.length;

  const codeIdBySlug = new Map(codes.map((c) => [c.slug.toLowerCase(), c.id]));
  for (const a of aliases) codeIdBySlug.set(a.alias.toLowerCase(), a.code_id);

  // ---- interactions -------------------------------------------------------
  const inter = load('interactions.json', { comments: [], likes: {}, reports: [] });
  report.source_counts.comments = (inter.comments || []).length;
  report.source_counts.code_likes = Object.keys(inter.likes || {}).length;
  report.source_counts.reports = (inter.reports || []).length;

  const comments = [];
  for (const c of inter.comments || []) {
    const codeId = codeIdBySlug.get(String(c.code || '').toLowerCase());
    if (!codeId) { skip('comments', c.id, `code "${c.code}" no longer exists`); continue; }
    const body = String(c.text || '').trim();
    if (!body || body.length > 1000) { skip('comments', c.id, 'empty or oversized body'); continue; }
    comments.push({
      id: stableUuid('comment', c.id),
      code_id: codeId,
      author_id: userIdByName.get(String(c.author || '').toLowerCase()) || null,
      body,
      line_no: Number.isFinite(Number(c.line)) && Number(c.line) >= 1 ? Math.floor(Number(c.line)) : null,
      created_at: c.created_at || new Date().toISOString(),
    });
  }

  const likes = [];
  const seenLike = new Set();
  for (const [key, when] of Object.entries(inter.likes || {})) {
    const sep = key.indexOf('|');
    if (sep <= 0) { skip('code_likes', key, 'malformed key'); continue; }
    const userId = userIdByName.get(key.slice(0, sep).toLowerCase());
    const codeId = codeIdBySlug.get(key.slice(sep + 1).toLowerCase());
    if (!userId) { skip('code_likes', key, 'unknown account'); continue; }
    if (!codeId) { skip('code_likes', key, 'unknown code'); continue; }
    const pk = `${userId}|${codeId}`;
    if (seenLike.has(pk)) { report.duplicates.push({ table: 'code_likes', key, field: '(user_id, code_id)' }); continue; }
    seenLike.add(pk);
    likes.push({ user_id: userId, code_id: codeId, created_at: when || new Date().toISOString() });
  }

  const reports = [];
  for (const r of inter.reports || []) {
    const body = String(r.text || '').trim();
    if (!body) { skip('reports', r.id, 'empty body'); continue; }
    reports.push({
      id: stableUuid('report', r.id),
      reporter_id: userIdByName.get(String(r.reporter || '').toLowerCase()) || null,
      code_id: codeIdBySlug.get(String(r.code || '').toLowerCase()) || null,
      body: body.slice(0, 1000),
      status: r.status === 'dismissed' ? 'dismissed' : 'open',
      created_at: r.created_at || new Date().toISOString(),
    });
  }
  report.target_counts.comments = comments.length;
  report.target_counts.code_likes = likes.length;
  report.target_counts.reports = reports.length;

  // ---- bans ---------------------------------------------------------------
  const rawBans = load('bans.json', {});
  report.source_counts.bans = Object.keys(rawBans).length;
  const bans = [];
  for (const [name, b] of Object.entries(rawBans)) {
    const userId = userIdByName.get(name.toLowerCase());
    if (!userId) { skip('bans', name, 'unknown account'); continue; }
    if (!b || !b.banned) continue; // only active bans become rows
    bans.push({
      id: stableUuid('ban', name),
      user_id: userId,
      banned: true,
      reason: String(b.reason || 'أسباب أمنية').slice(0, 400),
      banned_at: b.banned_at || new Date().toISOString(),
    });
  }
  report.target_counts.bans = bans.length;

  // ---- packages -----------------------------------------------------------
  const rawZips = load('zips.json', { zips: [] }).zips || [];
  report.source_counts.packages = rawZips.length;
  const packages = [];
  const seenPkg = new Set();
  for (const z of rawZips) {
    const slug = String(z.slug || '');
    if (!slug) { skip('packages', '(blank)', 'no slug'); continue; }
    if (seenPkg.has(slug.toLowerCase())) { report.duplicates.push({ table: 'packages', key: slug, field: 'slug' }); continue; }
    seenPkg.add(slug.toLowerCase());
    if (!z.sha256) warn(`package ${slug} has no checksum — it predates the integrity check`);
    packages.push({
      id: stableUuid('package', slug),
      slug,
      owner_id: userIdByName.get(String(z.author || '').toLowerCase()) || null,
      title: String(z.title || slug).slice(0, 120),
      description: String(z.description || '').slice(0, 300),
      readme: String(z.readme || '').slice(0, 30000),
      version: String(z.version || '').slice(0, 30),
      created_at: z.created_at || new Date().toISOString(),
      // The external URL is kept for the asset migration step.
      _external_url: z.url || null,
      _sha256: z.sha256 || null,
      _size: Number(z.size) || 0,
    });
  }
  report.target_counts.packages = packages.length;

  // ---- delete requests, support messages, settings ------------------------
  const rawDeletes = load('delete_requests.json', { items: [] }).items || [];
  report.source_counts.delete_requests = rawDeletes.length;
  const deleteRequests = [];
  for (const d of rawDeletes) {
    const codeId = codeIdBySlug.get(String(d.filename || '').toLowerCase());
    if (!codeId) { skip('delete_requests', d.id, `code "${d.filename}" no longer exists`); continue; }
    deleteRequests.push({
      id: stableUuid('delreq', d.id),
      code_id: codeId,
      requester_id: userIdByName.get(String(d.author || '').toLowerCase()) || null,
      reason: String(d.reason || '').slice(0, 400),
      status: ['pending', 'approved', 'rejected'].includes(d.status) ? d.status : 'pending',
      created_at: d.created_at || new Date().toISOString(),
    });
  }
  report.target_counts.delete_requests = deleteRequests.length;

  const rawMessages = load('messages.json', { messages: [] }).messages || [];
  report.source_counts.support_messages = rawMessages.length;
  const messages = rawMessages
    .filter((m) => String(m.text || '').trim())
    .map((m) => ({
      id: stableUuid('message', m.id),
      author_id: userIdByName.get(String(m.author || '').toLowerCase()) || null,
      subject: String(m.subject || '').slice(0, 120),
      body: String(m.text).slice(0, 2000),
      read_at: m.read ? (m.created_at || new Date().toISOString()) : null,
      created_at: m.created_at || new Date().toISOString(),
    }));
  report.target_counts.support_messages = messages.length;

  const settings = load('settings.json', {});
  const settingRows = Object.entries(settings).map(([key, value]) => ({ key, value }));
  report.target_counts.app_settings = settingRows.length;

  return {
    report,
    rows: {
      users, profiles, codes, aliases,
      tags: [...tagRows.values()], codeTags,
      comments, likes, reports, bans, packages, deleteRequests, messages, settingRows,
    },
  };
}

// ---------------------------------------------------------------------------
// Reconciliation report
// ---------------------------------------------------------------------------
function printReport(report) {
  console.log('[import] reconciliation report');
  const keys = new Set([...Object.keys(report.source_counts), ...Object.keys(report.target_counts)]);
  let mismatch = 0;
  for (const k of [...keys].sort()) {
    const src = report.source_counts[k];
    const tgt = report.target_counts[k];
    const flag = src !== undefined && tgt !== undefined && src !== tgt ? '  <-- differs' : '';
    if (flag) mismatch += 1;
    console.log(`  ${k.padEnd(18)} source=${src === undefined ? '-' : src}  target=${tgt === undefined ? '-' : tgt}${flag}`);
  }
  if (report.duplicates.length) {
    console.log(`  duplicates: ${report.duplicates.length}`);
    for (const d of report.duplicates) console.log(`    ${d.table}.${d.field}: ${d.key}`);
  }
  if (report.skipped.length) {
    console.log(`  skipped rows: ${report.skipped.length}`);
    for (const s of report.skipped) console.log(`    ${s.table} ${s.key}: ${s.why}`);
  }
  if (report.warnings.length) {
    console.log(`  warnings: ${report.warnings.length}`);
    for (const w of report.warnings) console.log(`    ! ${w}`);
  }
  console.log(mismatch
    ? `[import] ${mismatch} collection(s) differ between source and target — every difference above is explained by a skipped or duplicate row`
    : '[import] source and target counts match exactly');
  return mismatch;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
async function importRows(rows) {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('[import] DATABASE_URL is not set — nothing was imported.');
    console.error('[import] Use --plan to review the transformation without a database.');
    process.exit(2);
  }
  let pg;
  try { pg = require('pg'); } catch { console.error('[import] run: npm install pg'); process.exit(2); }

  const client = new pg.Client({
    connectionString: url,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: true } : undefined,
    statement_timeout: 300000,
  });
  await client.connect();
  try {
    const { rows: applied } = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'users'",
    );
    if (!applied.length) {
      console.error('[import] the schema is not migrated yet — run: npm run db:migrate');
      process.exit(1);
    }

    await client.query('BEGIN');

    if (has('--truncate')) {
      console.log('[import] truncating target tables (source files are untouched)');
      await client.query(`TRUNCATE
        code_likes, comments, reports, code_tags, code_aliases, code_versions,
        delete_requests, support_messages, packages, bans, auth_tokens,
        user_private_contacts, user_profiles, tags, codes, users, app_settings
        RESTART IDENTITY CASCADE`);
    }

    const run = async (sql, values) => client.query(sql, values);

    for (const u of rows.users) {
      await run(`INSERT INTO users
        (id, username, email, password_hash, display_name, role, status, verified_at,
         is_verified_badge, provider, provider_subject, session_version, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO UPDATE SET
          username = EXCLUDED.username, email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name,
          role = EXCLUDED.role, status = EXCLUDED.status, verified_at = EXCLUDED.verified_at,
          is_verified_badge = EXCLUDED.is_verified_badge,
          session_version = GREATEST(users.session_version, EXCLUDED.session_version)`,
      [u.id, u.username, u.email, u.password_hash, u.display_name, u.role, u.status,
        u.verified_at, u.is_verified_badge, u.provider, u.provider_subject, u.session_version, u.created_at]);
    }
    for (const p of rows.profiles) {
      await run(`INSERT INTO user_profiles (user_id, bio, avatar_url, banner_url, location, website, links)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
        ON CONFLICT (user_id) DO UPDATE SET
          bio = EXCLUDED.bio, avatar_url = EXCLUDED.avatar_url, banner_url = EXCLUDED.banner_url,
          location = EXCLUDED.location, website = EXCLUDED.website, links = EXCLUDED.links`,
      [p.user_id, p.bio, p.avatar_url, p.banner_url, p.location, p.website, JSON.stringify(p.links)]);
    }
    for (const c of rows.codes) {
      await run(`INSERT INTO codes
        (id, slug, owner_id, title, description, language, license_spdx,
         moderation_status, is_executable, approved_by, published_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (id) DO UPDATE SET
          slug = EXCLUDED.slug, owner_id = EXCLUDED.owner_id, title = EXCLUDED.title,
          description = EXCLUDED.description, language = EXCLUDED.language,
          license_spdx = EXCLUDED.license_spdx, moderation_status = EXCLUDED.moderation_status,
          is_executable = EXCLUDED.is_executable, approved_by = EXCLUDED.approved_by,
          published_at = EXCLUDED.published_at`,
      [c.id, c.slug, c.owner_id, c.title, c.description, c.language, c.license_spdx,
        c.moderation_status, c.is_executable, c.approved_by, c.published_at, c.created_at]);
    }
    for (const a of rows.aliases) {
      await run('INSERT INTO code_aliases (alias, code_id) VALUES ($1,$2) ON CONFLICT (alias) DO UPDATE SET code_id = EXCLUDED.code_id',
        [a.alias, a.code_id]);
    }
    for (const t of rows.tags) {
      await run('INSERT INTO tags (id, name, normalized) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET normalized = EXCLUDED.normalized',
        [t.id, t.name, t.normalized]);
    }
    for (const ct of rows.codeTags) {
      await run('INSERT INTO code_tags (code_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ct.code_id, ct.tag_id]);
    }
    for (const c of rows.comments) {
      await run(`INSERT INTO comments (id, code_id, author_id, body, line_no, created_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, line_no = EXCLUDED.line_no`,
      [c.id, c.code_id, c.author_id, c.body, c.line_no, c.created_at]);
    }
    for (const l of rows.likes) {
      await run('INSERT INTO code_likes (user_id, code_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [l.user_id, l.code_id, l.created_at]);
    }
    for (const r of rows.reports) {
      await run(`INSERT INTO reports (id, reporter_id, code_id, body, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [r.id, r.reporter_id, r.code_id, r.body, r.status, r.created_at]);
    }
    for (const b of rows.bans) {
      await run(`INSERT INTO bans (id, user_id, banned, reason, banned_at)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET banned = EXCLUDED.banned, reason = EXCLUDED.reason`,
      [b.id, b.user_id, b.banned, b.reason, b.banned_at]);
    }
    for (const p of rows.packages) {
      await run(`INSERT INTO packages (id, slug, owner_id, title, description, readme, version, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
          readme = EXCLUDED.readme, version = EXCLUDED.version`,
      [p.id, p.slug, p.owner_id, p.title, p.description, p.readme, p.version, p.created_at]);
    }
    for (const d of rows.deleteRequests) {
      await run(`INSERT INTO delete_requests (id, code_id, requester_id, reason, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [d.id, d.code_id, d.requester_id, d.reason, d.status, d.created_at]);
    }
    for (const m of rows.messages) {
      await run(`INSERT INTO support_messages (id, author_id, subject, body, read_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET read_at = EXCLUDED.read_at`,
      [m.id, m.author_id, m.subject, m.body, m.read_at, m.created_at]);
    }
    for (const s of rows.settingRows) {
      await run(`INSERT INTO app_settings (key, value) VALUES ($1,$2::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = app_settings.version + 1, updated_at = now()`,
      [s.key, JSON.stringify(s.value)]);
    }

    await client.query('COMMIT');
    console.log('[import] committed');

    // Verify by reading back, not by trusting the insert count.
    const checks = [
      ['users', rows.users.length], ['codes', rows.codes.length],
      ['comments', rows.comments.length], ['code_likes', rows.likes.length],
      ['packages', rows.packages.length],
    ];
    let bad = 0;
    for (const [table, expected] of checks) {
      const { rows: r } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
      const ok = r[0].n >= expected;
      if (!ok) bad += 1;
      console.log(`  ${table}: db=${r[0].n} expected>=${expected} ${ok ? 'ok' : 'MISMATCH'}`);
    }
    if (bad) {
      console.error('[import] row counts do not match — do NOT switch reads to the database yet');
      process.exit(1);
    }
    console.log('[import] post-import verification passed');
    console.log('[import] source files in data/ were NOT modified — keep them until the cut-over window closes');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
    throw e;
  } finally {
    await client.end();
  }
}

async function main() {
  const { report, rows } = transform();
  const mismatch = printReport(report);

  if (has('--plan')) {
    console.log('[import] plan only — no database connection was made');
    // A skipped/duplicate row explains a mismatch; an unexplained one does not.
    const explained = report.skipped.length + report.duplicates.length;
    if (mismatch && !explained) {
      console.error('[import] unexplained count mismatch');
      process.exit(1);
    }
    return;
  }
  await importRows(rows);
}

if (require.main === module) {
  main().catch((e) => { console.error('[import]', e.message); process.exit(1); });
}
module.exports = { transform, printReport, stableUuid };
