#!/usr/bin/env node
// One-off controlled migration for APP-07 and APP-02 (plan: "اعتمد قائمة
// امتدادات وخيارات لغة على الخادم، ونظّف الأسماء في ترحيل مضبوط" و"عرّف schema
// ومصدر حقيقة واحداً").
//
//   node scripts/normalize-manifest.js            # dry run (default)
//   node scripts/normalize-manifest.js --write    # apply (takes a backup first)
//
// 1. Backfills the manifest schema so every row carries the same fields:
//      status, published_at, license, tags, executable
//    `published_at` is copied from `approved_at` — the audited stats handler read
//    published_at while the index only ever wrote approved_at, so
//    `new_codes_week` was permanently 0.
// 2. Renames filenames that the server-side allowlist now rejects (no extension,
//    uppercase, leading dot) to a canonical form, renames the file on disk, and
//    records the previous name in `aliases` so published /c/<old> links keep
//    resolving (see api/_resolve.js).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'data', 'manifest.json');
const CODES_DIR = path.join(ROOT, 'codes');

const {
  normalizeLanguage, validateFilename, canonicalFilename, LANGUAGES,
} = require('../api/_content');
const { STATUS } = require('../api/_moderation');

const has = (flag) => process.argv.includes(flag);

function plan(codes, existingNames) {
  const taken = new Set(codes.map((c) => c.filename));
  const renames = [];
  const backfilled = [];
  const problems = [];

  for (const c of codes) {
    const lang = normalizeLanguage(c.language);
    if (!lang) problems.push({ filename: c.filename, issue: `unsupported language "${c.language}"` });

    // --- schema backfill ---
    const changes = [];
    if (!c.status) { c.status = STATUS.APPROVED; changes.push('status'); }
    if (!c.published_at && c.approved_at) { c.published_at = c.approved_at; changes.push('published_at'); }
    if (c.license === undefined) { c.license = null; changes.push('license'); }
    if (!Array.isArray(c.tags)) { c.tags = []; changes.push('tags'); }
    if (c.executable === undefined) {
      c.executable = !!(lang && LANGUAGES[lang].executable);
      changes.push('executable');
    }
    if (changes.length) backfilled.push({ filename: c.filename, fields: changes });

    // --- filename normalisation ---
    if (validateFilename(c.filename).ok) continue;
    let next = canonicalFilename(c.filename, lang || 'txt');
    const ext = next.slice(next.lastIndexOf('.'));
    const stem = next.slice(0, next.lastIndexOf('.'));
    let i = 1;
    while ((taken.has(next) && next !== c.filename) || (existingNames.has(next) && next !== c.filename)) {
      next = `${stem}-${i}${ext}`;
      i += 1;
    }
    const check = validateFilename(next);
    if (!check.ok) {
      problems.push({ filename: c.filename, issue: `cannot canonicalise: ${check.error}` });
      continue;
    }
    taken.delete(c.filename);
    taken.add(next);
    renames.push({ from: c.filename, to: next });
  }
  return { renames, backfilled, problems };
}

function main() {
  const write = has('--write');
  const raw = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  if (!Array.isArray(raw.codes)) {
    console.error('[normalize] unexpected manifest shape');
    process.exit(1);
  }
  const existingNames = new Set(fs.existsSync(CODES_DIR) ? fs.readdirSync(CODES_DIR) : []);

  const { renames, backfilled, problems } = plan(raw.codes, existingNames);

  console.log(`[normalize] mode: ${write ? 'WRITE' : 'DRY RUN (pass --write to apply)'}`);
  console.log(`  entries: ${raw.codes.length}`);
  console.log(`  schema backfilled: ${backfilled.length}`);
  console.log(`  filename renames: ${renames.length}`);
  for (const r of renames) console.log(`    ${r.from}  ->  ${r.to}`);
  if (problems.length) {
    console.log(`  problems: ${problems.length}`);
    for (const p of problems) console.log(`    ${p.filename}: ${p.issue}`);
  }

  if (!write) return { renames, backfilled, problems };

  const { main: backup } = require('./backup-data');
  console.log(`[normalize] backup taken at ${backup()}`);

  // Apply renames to both the manifest row and the stored file.
  const byName = new Map(raw.codes.map((c) => [c.filename, c]));
  for (const r of renames) {
    const entry = byName.get(r.from);
    if (!entry) continue;
    entry.aliases = [...new Set([...(entry.aliases || []), r.from])];
    entry.filename = r.to;
    entry.renamed_at = new Date().toISOString();

    const src = path.join(CODES_DIR, r.from);
    const dst = path.join(CODES_DIR, r.to);
    if (fs.existsSync(src)) {
      if (fs.existsSync(dst)) {
        console.error(`[normalize] refusing to overwrite ${r.to}`);
        process.exit(1);
      }
      fs.renameSync(src, dst);
      console.log(`[normalize] renamed codes/${r.from} -> codes/${r.to}`);
    } else {
      console.warn(`[normalize] codes/${r.from} missing on disk — manifest row updated only`);
    }
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`[normalize] wrote ${MANIFEST}`);
  return { renames, backfilled, problems };
}

if (require.main === module) main();
module.exports = { plan, main };
