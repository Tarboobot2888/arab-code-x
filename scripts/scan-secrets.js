#!/usr/bin/env node
// Secret scanning for CI (plan 9.1: "secret scanning", 12).
//
//   node scripts/scan-secrets.js            # scan the working tree
//   node scripts/scan-secrets.js --staged   # scan only staged changes
//   node scripts/scan-secrets.js --history  # also scan the git history
//
// Reports the FILE, LINE and the kind of finding — never the matched value, so
// the CI log does not become the new leak (task: "لا تعرض أي قيمة سرية مكتشفة
// في التقرير؛ اذكر الملف والسطر ونوع المشكلة فقط").
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const has = (f) => process.argv.includes(f);

// data/ holds real records, and codes/ holds user-submitted samples; both are
// scanned but reported separately so a sample in the library does not fail CI.
const SKIP_DIRS = new Set(['node_modules', '.git', 'backups', '.vercel']);
const DATA_DIRS = new Set(['codes', 'data']);

const RULES = [
  { id: 'nezuko-upload-key', re: /\bnzk_[0-9a-f]{20,}\b/, severity: 'critical' },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/, severity: 'critical' },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, severity: 'critical' },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: 'critical' },
  { id: 'slack-token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/, severity: 'critical' },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, severity: 'critical' },
  { id: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/, severity: 'critical' },
  // A real credential, not a documentation placeholder: `<password>`, `***`,
  // `REPLACE_ME` and friends are how the README and the scripts' help text
  // show the shape of the URL, and flagging them made the scan useless.
  { id: 'connection-string-with-password', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|smtps?):\/\/(?!<)[^\s:@/<>]+:(?!<|\*|REPLACE|CHANGE|YOUR|xxx|XXX)[^\s@/<>]{4,}@/, severity: 'high' },
  { id: 'insecure-secret-fallback', re: /(?:JWT_SECRET|SECRET|TOKEN|API_KEY)\s*\|\|\s*['"][^'"]{4,}['"]/, severity: 'high' },
  { id: 'bearer-literal', re: /Authorization['"]?\s*[:=]\s*['"]Bearer\s+[A-Za-z0-9._-]{20,}['"]/, severity: 'high' },
];

// Lines that are allowed to contain a pattern, with the reason.
const ALLOW = [
  { file: 'scripts/scan-secrets.js', reason: 'this file defines the patterns' },
  { file: 'api/_content.js', reason: 'the quality-card detector defines the patterns' },
  { file: 'tests/', reason: 'tests use synthetic example values' },
  { file: '.env.example', reason: 'placeholder names only' },
  { file: 'AUDIT_', reason: 'the audit report documents the pattern shapes' },
];

const findings = [];

function allowed(rel) {
  return ALLOW.some((a) => rel === a.file || rel.startsWith(a.file));
}

function scanText(rel, text, origin) {
  if (allowed(rel)) return;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.length > 4000) return; // minified or data blob
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        findings.push({
          file: rel, line: i + 1, rule: rule.id, severity: rule.severity, origin,
        });
      }
    }
  });
}

function walk(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { walk(abs, r); continue; }
    if (fs.statSync(abs).size > 2 * 1024 * 1024) continue;
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const topDir = r.split('/')[0];
    scanText(r, text, DATA_DIRS.has(topDir) ? 'user-content' : 'source');
  }
}

if (has('--staged')) {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { cwd: ROOT, encoding: 'utf8' });
  for (const rel of out.split('\n').filter(Boolean)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    scanText(rel, fs.readFileSync(abs, 'utf8'), 'staged');
  }
} else {
  walk(ROOT);
}

if (has('--history')) {
  // A key removed from the working tree is still in every commit that carried
  // it, so this pass is what tells the operator a history rewrite is needed.
  //
  // Each rule runs on its own: `git grep` exits 1 when a pattern matches
  // nothing, and the rule sources use Perl syntax ((?:...)), so they need -P and
  // per-rule error handling. Combining them into one ERE made this pass
  // silently report "clean".
  const seen = new Set();
  let revs = [];
  try {
    revs = execFileSync('git', ['rev-list', '--all'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch {
    console.log('[scan-secrets] history scan skipped: not a git repository');
  }
  for (const rev of revs.slice(0, 500)) {
    for (const rule of RULES) {
      let out = '';
      try {
        out = execFileSync('git', ['grep', '-I', '-n', '-P', rule.re.source, rev],
          { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        continue; // exit 1 = no match in this revision for this rule
      }
      for (const line of out.split('\n').filter(Boolean)) {
        const m = line.match(/^([0-9a-f]+):(.+?):(\d+):/);
        if (!m) continue;
        const file = m[2];
        if (allowed(file)) continue;
        const key = `${rule.id}|${file}`;
        if (seen.has(key)) continue; // report each (rule, path) once, not per commit
        seen.add(key);
        findings.push({
          file, line: Number(m[3]), rule: rule.id, severity: rule.severity,
          origin: `commit ${m[1].slice(0, 8)}`,
        });
      }
    }
  }
}

const source = findings.filter((f) => f.origin === 'source' || f.origin === 'staged');
const userContent = findings.filter((f) => f.origin === 'user-content');
const history = findings.filter((f) => String(f.origin).startsWith('commit'));

const show = (list, label) => {
  if (!list.length) return;
  console.log(`[scan-secrets] ${label}: ${list.length}`);
  for (const f of list) console.log(`  ${f.severity.toUpperCase()} ${f.file}:${f.line} (${f.rule})`);
};

console.log('[scan-secrets] values are never printed — file, line and rule id only');
show(source, 'FINDINGS IN FIRST-PARTY SOURCE');
show(userContent, 'findings inside user-submitted content (review, does not fail the build)');
show(history, 'findings in git history (needs a coordinated history rewrite + key rotation)');

if (!findings.length) console.log('[scan-secrets] clean');
if (source.length) {
  console.log('[scan-secrets] FAILED: remove the value, rotate it at the provider, and load it from the environment');
  process.exit(1);
}
process.exit(0);
