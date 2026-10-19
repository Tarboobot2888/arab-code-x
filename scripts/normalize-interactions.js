#!/usr/bin/env node
// Re-keys comments and likes onto canonical filenames (APP-02 / APP-07 follow-up).
//
//   node scripts/normalize-interactions.js            # dry run (default)
//   node scripts/normalize-interactions.js --write     # apply (backs up first)
//
// Why this is needed: code.html takes the filename from the URL, and Vercel's
// cleanUrls strips ".html". So a comment left on /c/planet-earth was stored with
// code "planet-earth" while the manifest says "planet-earth.html" — the comment
// then never appeared again on the page it belonged to. scripts/verify-data.js
// reports that drift; this script repairs it.
//
// It also drops likes pointing at codes that no longer exist, so like totals
// stop counting deleted content. Comments on deleted codes are KEPT (they are
// user-authored content) and only reported.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const has = (flag) => process.argv.includes(flag);

function canonicalMap(codes) {
  // name (and alias, and extension-less stem) -> canonical filename
  const map = new Map();
  const put = (key, value) => {
    const k = String(key || '').toLowerCase();
    if (k && !map.has(k)) map.set(k, value);
  };
  for (const c of codes) {
    put(c.filename, c.filename);
    put(String(c.filename).replace(/\.[^.]+$/, ''), c.filename);
    for (const a of c.aliases || []) {
      put(a, c.filename);
      put(String(a).replace(/\.[^.]+$/, ''), c.filename);
    }
  }
  return map;
}

function plan(interactions, codes, knownUsers) {
  const map = canonicalMap(codes);
  const users = knownUsers || null;
  const report = {
    comments: interactions.comments.length,
    comments_rekeyed: [],
    comments_orphaned: [],
    likes: Object.keys(interactions.likes || {}).length,
    likes_rekeyed: [],
    likes_dropped: [],
    likes_deduped: [],
  };

  for (const c of interactions.comments) {
    const current = String(c.code || '');
    if (!current) continue;
    const canonical = map.get(current.toLowerCase());
    if (!canonical) { report.comments_orphaned.push({ id: c.id, code: current }); continue; }
    if (canonical !== current) report.comments_rekeyed.push({ id: c.id, from: current, to: canonical });
  }

  const seen = new Set();
  for (const key of Object.keys(interactions.likes || {})) {
    const sep = key.indexOf('|');
    if (sep <= 0) { report.likes_dropped.push({ key, reason: 'malformed' }); continue; }
    const user = key.slice(0, sep);
    const code = key.slice(sep + 1);
    if (users && !users.has(user.toLowerCase())) {
      report.likes_dropped.push({ key, reason: 'account no longer exists' });
      continue;
    }
    const canonical = map.get(code.toLowerCase());
    if (!canonical) { report.likes_dropped.push({ key, reason: 'code no longer published' }); continue; }
    const next = `${user.toLowerCase()}|${canonical}`;
    if (seen.has(next)) { report.likes_deduped.push({ key, into: next }); continue; }
    seen.add(next);
    if (next !== key) report.likes_rekeyed.push({ from: key, to: next });
  }
  return report;
}

function apply(interactions, codes, knownUsers) {
  const map = canonicalMap(codes);
  const users = knownUsers || null;

  for (const c of interactions.comments) {
    const canonical = map.get(String(c.code || '').toLowerCase());
    if (canonical && canonical !== c.code) {
      c.code_legacy = c.code;
      c.code = canonical;
    }
  }

  const nextLikes = {};
  for (const [key, value] of Object.entries(interactions.likes || {})) {
    const sep = key.indexOf('|');
    if (sep <= 0) continue;
    if (users && !users.has(key.slice(0, sep).toLowerCase())) continue;
    const canonical = map.get(key.slice(sep + 1).toLowerCase());
    if (!canonical) continue;
    const next = `${key.slice(0, sep).toLowerCase()}|${canonical}`;
    // Keep the earliest timestamp when two keys collapse into one.
    if (!nextLikes[next] || String(value) < String(nextLikes[next])) nextLikes[next] = value;
  }
  interactions.likes = nextLikes;

  const totals = {};
  for (const key of Object.keys(nextLikes)) {
    const code = key.slice(key.indexOf('|') + 1);
    totals[code] = (totals[code] || 0) + 1;
  }
  interactions.likeTotals = totals;
  return interactions;
}

function main() {
  const write = has('--write');
  const interPath = path.join(DATA, 'interactions.json');
  const interactions = JSON.parse(fs.readFileSync(interPath, 'utf8'));
  if (!Array.isArray(interactions.comments)) interactions.comments = [];
  if (!interactions.likes || typeof interactions.likes !== 'object') interactions.likes = {};
  const codes = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8')).codes || [];
  const knownUsers = new Set(
    (JSON.parse(fs.readFileSync(path.join(DATA, 'users.json'), 'utf8')).users || [])
      .map((u) => String(u.username || '').toLowerCase()),
  );

  const report = plan(interactions, codes, knownUsers);
  console.log(`[normalize-interactions] mode: ${write ? 'WRITE' : 'DRY RUN (pass --write to apply)'}`);
  console.log(`  comments: ${report.comments} (re-key ${report.comments_rekeyed.length}, orphaned ${report.comments_orphaned.length})`);
  for (const r of report.comments_rekeyed) console.log(`    ${r.id}: "${r.from}" -> "${r.to}"`);
  for (const r of report.comments_orphaned) console.log(`    ${r.id}: code "${r.code}" no longer exists (kept)`);
  console.log(`  likes: ${report.likes} (re-key ${report.likes_rekeyed.length}, drop ${report.likes_dropped.length}, dedupe ${report.likes_deduped.length})`);
  for (const r of report.likes_rekeyed) console.log(`    "${r.from}" -> "${r.to}"`);
  for (const r of report.likes_dropped) console.log(`    drop "${r.key}" (${r.reason})`);

  if (!write) return report;

  const { main: backup } = require('./backup-data');
  console.log(`[normalize-interactions] backup taken at ${backup()}`);
  apply(interactions, codes, knownUsers);
  fs.writeFileSync(interPath, `${JSON.stringify(interactions, null, 2)}\n`);
  console.log(`[normalize-interactions] wrote ${interPath}`);
  return report;
}

if (require.main === module) main();
module.exports = { plan, apply, canonicalMap, main };
