#!/usr/bin/env node
// Integrity report for the operational JSON files (plan 6.2 step 2: "تقرير عن
// عدد السجلات والمفاتيح المكررة والحقول غير الصالحة").
//
//   node scripts/verify-data.js             # check data/
//   node scripts/verify-data.js --dir <d>   # check a backup directory
//
// Exits non-zero when an invariant is broken, so CI and a restore drill can
// both use it as a gate. It reads only — nothing is written.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argIdx = process.argv.indexOf('--dir');
const DIR = argIdx > -1 && process.argv[argIdx + 1]
  ? path.resolve(process.argv[argIdx + 1])
  : path.join(ROOT, 'data');

const errors = [];
const warnings = [];
const stats = {};
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function load(name, fallback) {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) { warn(`${name} is missing`); return fallback; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { fail(`${name} is not valid JSON: ${e.message}`); return fallback; }
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- users ----------------------------------------------------------------
const users = load('users.json', { users: [] }).users || [];
stats.users = users.length;
{
  const names = new Map();
  const emails = new Map();
  let tokenLeaks = 0;
  let phones = 0;
  for (const u of users) {
    const where = u.username || '(no username)';
    if (!USERNAME_RE.test(String(u.username || ''))) fail(`invalid username: ${where}`);
    if (!EMAIL_RE.test(String(u.email || ''))) fail(`invalid email on ${where}`);
    if (typeof u.verified !== 'boolean') fail(`verified is not boolean on ${where}`);
    if (typeof u.session_version !== 'number') warn(`session_version missing on ${where}`);
    if (!u.password_hash && u.provider !== 'google') warn(`${where} has no credential and no provider`);
    if (u.verification_token || u.reset_token || u.pending_email_token) tokenLeaks += 1;
    if ('phone' in u && String(u.phone || '').trim()) phones += 1;
    const n = String(u.username || '').toLowerCase();
    const e = String(u.email || '').toLowerCase();
    names.set(n, (names.get(n) || 0) + 1);
    emails.set(e, (emails.get(e) || 0) + 1);
  }
  for (const [n, c] of names) if (c > 1) fail(`duplicate username: ${n} (${c}x)`);
  for (const [e, c] of emails) if (c > 1) fail(`duplicate email seen ${c} times`);
  if (tokenLeaks) fail(`${tokenLeaks} account(s) still carry a plaintext token — run scripts/revoke-legacy-tokens.js`);
  if (phones) warn(`${phones} account(s) still store a phone number`);
  stats.unverified = users.filter((u) => !u.verified).length;
}

// ---- manifest -------------------------------------------------------------
const codes = load('manifest.json', { codes: [] }).codes || [];
stats.codes = codes.length;
{
  const { validateFilename, normalizeLanguage } = require('../api/_content');
  const seen = new Map();
  const codesDir = path.join(path.dirname(DIR) === ROOT ? ROOT : path.dirname(DIR), 'codes');
  const onDisk = fs.existsSync(codesDir) ? new Set(fs.readdirSync(codesDir)) : null;
  const authors = new Set(users.map((u) => String(u.username).toLowerCase()));

  for (const c of codes) {
    const name = c.filename || '(no filename)';
    const v = validateFilename(c.filename);
    if (!v.ok) fail(`invalid filename "${name}": ${v.error} — run scripts/normalize-manifest.js`);
    if (!normalizeLanguage(c.language)) fail(`unsupported language on ${name}: ${c.language}`);
    if (!c.title) fail(`missing title on ${name}`);
    if (!c.status) warn(`missing status on ${name}`);
    if (!c.published_at && !c.approved_at) warn(`no publication timestamp on ${name}`);
    if (!Array.isArray(c.tags)) warn(`tags is not an array on ${name}`);
    if (c.author && !authors.has(String(c.author).toLowerCase())) {
      warn(`${name} is attributed to a non-existent account "${c.author}"`);
    }
    if (onDisk && !onDisk.has(c.filename)) fail(`${name} is listed but the file is missing`);
    seen.set(c.filename, (seen.get(c.filename) || 0) + 1);
  }
  for (const [n, c] of seen) if (c > 1) fail(`duplicate manifest entry: ${n}`);
  if (onDisk) {
    const listed = new Set(codes.map((c) => c.filename));
    for (const f of onDisk) {
      if (f === '.gitkeep') continue;
      if (!listed.has(f)) warn(`codes/${f} is stored but not listed in the manifest`);
    }
  }
  stats.executable = codes.filter((c) => c.executable).length;
}

// ---- interactions ---------------------------------------------------------
const inter = load('interactions.json', { comments: [], likes: {}, reports: [] });
stats.comments = (inter.comments || []).length;
stats.reports = (inter.reports || []).length;
stats.likes = Object.keys(inter.likes || {}).length;
{
  const listed = new Set(codes.map((c) => c.filename));
  const ids = new Set();
  for (const c of inter.comments || []) {
    if (!c.id) fail('a comment has no id');
    if (ids.has(c.id)) fail(`duplicate comment id: ${c.id}`);
    ids.add(c.id);
    if (!c.author) fail(`comment ${c.id} has no author`);
    if (c.code && !listed.has(c.code)) warn(`comment ${c.id} points at a missing code "${c.code}"`);
  }
  for (const key of Object.keys(inter.likes || {})) {
    if (!/^[^|]+\|[^|]+$/.test(key)) fail(`malformed like key: ${key}`);
    const code = key.slice(key.indexOf('|') + 1);
    if (!listed.has(code)) warn(`like points at a missing code "${code}"`);
  }
  const { recomputeTotals } = require('../api/_h/likes');
  const expected = recomputeTotals(inter.likes || {});
  for (const [code, total] of Object.entries(inter.likeTotals || {})) {
    if ((expected[code] || 0) !== total) {
      warn(`likeTotals["${code}"]=${total} but the keys say ${expected[code] || 0}`);
    }
  }
}

// ---- settings -------------------------------------------------------------
{
  const s = load('settings.json', {});
  const { BOOLEAN_KEYS } = require('../api/_settings');
  for (const k of BOOLEAN_KEYS) {
    if (!(k in s)) warn(`settings.json has no ${k} (the safe default applies)`);
    else if (typeof s[k] !== 'boolean') fail(`settings.${k} is not a boolean`);
  }
  if (s.auto_approve === true) warn('auto_approve is ON — executable content is still held for review, but check this is intended');
  if (s.filter_enabled === false) warn('filter_enabled is OFF — the moderation word list is disabled');
}

// ---- bans / messages / zips / delete requests ------------------------------
{
  const bans = load('bans.json', {});
  stats.bans = Object.values(bans).filter((b) => b && b.banned).length;
  const known = new Set(users.map((u) => String(u.username).toLowerCase()));
  for (const name of Object.keys(bans)) {
    if (!known.has(name.toLowerCase())) warn(`ban record for an unknown account "${name}"`);
  }

  const zips = load('zips.json', { zips: [] }).zips || [];
  stats.zips = zips.length;
  const slugs = new Set();
  for (const z of zips) {
    if (!z.slug) fail('a package has no slug');
    if (slugs.has(z.slug)) fail(`duplicate package slug: ${z.slug}`);
    slugs.add(z.slug);
    if (!z.url) fail(`package ${z.slug} has no download URL`);
    if (!z.sha256) warn(`package ${z.slug} has no checksum`);
  }

  const dr = load('delete_requests.json', { items: [] }).items || [];
  stats.delete_requests = dr.length;
  for (const d of dr) {
    if (!d.id) fail('a delete request has no id');
    if (!['pending', 'approved', 'rejected'].includes(d.status || 'pending')) {
      fail(`delete request ${d.id} has an unknown status: ${d.status}`);
    }
  }
  stats.messages = (load('messages.json', { messages: [] }).messages || []).length;
}

// ---- report ---------------------------------------------------------------
console.log(`[verify-data] directory: ${DIR}`);
console.log('[verify-data] record counts:');
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
if (warnings.length) {
  console.log(`[verify-data] ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log(`[verify-data] ${errors.length} ERROR(s):`);
  for (const e of errors) console.log(`  x ${e}`);
  process.exit(1);
}
console.log('[verify-data] all invariants hold');
