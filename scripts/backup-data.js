#!/usr/bin/env node
// Timestamped backup of every operational JSON file, taken BEFORE any
// destructive maintenance (plan 6.1 step 7, 6.2 step 2: "لا تتخلص من بيانات
// المصدر قبل التحقق").
//
//   node scripts/backup-data.js [--out <dir>]
//
// Output goes to backups/<timestamp>/ which is gitignored, so a backup is never
// committed and personal data is not copied into the repository history.
// Each backup carries a manifest with record counts and a SHA-256 per file so a
// restore can be verified.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function countRecords(json) {
  if (!json || typeof json !== 'object') return null;
  const key = Object.keys(json)[0];
  if (Array.isArray(json[key])) return { collection: key, records: json[key].length };
  return { collection: null, records: Object.keys(json).length };
}

function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`[backup] no data directory at ${DATA_DIR}`);
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(arg('--out', path.join(ROOT, 'backups', stamp)));
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = { created_at: new Date().toISOString(), source: 'data/', files: [] };

  for (const name of fs.readdirSync(DATA_DIR).sort()) {
    if (!name.endsWith('.json')) continue;
    const src = path.join(DATA_DIR, name);
    const buf = fs.readFileSync(src);
    fs.writeFileSync(path.join(outDir, name), buf);
    let parsed = null;
    try { parsed = JSON.parse(buf.toString('utf8')); } catch { /* recorded as unparsable */ }
    manifest.files.push({
      name,
      bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      ...(parsed ? countRecords(parsed) : { parse_error: true }),
    });
  }

  fs.writeFileSync(path.join(outDir, '_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[backup] ${manifest.files.length} file(s) -> ${outDir}`);
  for (const f of manifest.files) {
    console.log(`  ${f.name}: ${f.records == null ? 'unparsable' : `${f.records} record(s)`} (${f.bytes} bytes)`);
  }
  console.log('[backup] verify a restore with: node scripts/verify-data.js --dir ' + outDir);
  return outDir;
}

if (require.main === module) main();
module.exports = { main, countRecords };
