#!/usr/bin/env node
// Dependency-free static checks (plan 9.1 CI row: "تنسيق/Lint، syntax").
//
// ESLint is not a dependency of this project, so this script covers the checks
// that actually caught bugs during the audit:
//   1. every first-party .js file parses (CommonJS or module, as appropriate),
//   2. every inline <script> in a page parses,
//   3. no `await`-less call to a known async helper (the _report.js bug),
//   4. no leftover debugger / console.log in the API,
//   5. no dangerous DOM sink fed by an unescaped template expression,
//   6. no TODO marker left on a security-relevant line.
//
// Files under codes/ are USER-SUBMITTED and are never parsed or executed here;
// they are untrusted data (task: "لا تشغّل ملفات المستخدمين").
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'codes', 'backups', '.vercel', 'docs']);

const problems = [];
const add = (file, line, msg) => problems.push({ file: path.relative(ROOT, file), line, msg });

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const jsFiles = files.filter((f) => f.endsWith('.js'));
const htmlFiles = files.filter((f) => f.endsWith('.html'));

// --- 1. syntax -------------------------------------------------------------
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const isModule = /^\s*(import|export)\s/m.test(src);
  try {
    if (isModule) new vm.SourceTextModule(src, { identifier: f });
    else new vm.Script(src, { filename: f });
  } catch (e) {
    // SourceTextModule needs --experimental-vm-modules; fall back to a parse
    // that still catches a genuine syntax error.
    if (isModule && /SourceTextModule is not a constructor|experimental/i.test(e.message)) {
      try {
        // eslint-disable-next-line no-new-func
        new Function(`return (async () => { ${src.replace(/^\s*(import|export)[^\n]*$/gm, '')} })`);
      } catch (e2) {
        add(f, 0, `syntax error: ${e2.message}`);
      }
    } else {
      add(f, 0, `syntax error: ${e.message}`);
    }
  }
}

// --- 2. inline page scripts -------------------------------------------------
for (const f of htmlFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1] || '';
    if (/type\s*=\s*"(?!text\/javascript|module)/.test(attrs)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    try {
      if (/type\s*=\s*"module"/.test(attrs)) {
        // eslint-disable-next-line no-new-func
        new Function(`return (async () => { ${m[2]} })`);
      } else {
        new vm.Script(m[2], { filename: `${f}:${line}` });
      }
    } catch (e) {
      add(f, line, `inline script syntax error: ${e.message}`);
    }
  }
}

// --- 3. missing await on async helpers --------------------------------------
// The audited _report.js called scanForCurses() without await, so its Promise
// was always truthy and every report was treated as blocked.
const ASYNC_HELPERS = [
  'scanForCurses', 'getSettings', 'loadUsers', 'saveUsers', 'updateUsers',
  'loadInteractions', 'saveInteractions', 'currentUser', 'requireUser',
  'requireAdmin', 'optionalUser', 'readBody', 'readJsonBody', 'readRawBody',
  'resolveFilename', 'resolveRequested', 'verifyTurnstile', 'verifyIdToken',
  'updateJson', 'readJson', 'writeJson', 'getFile', 'putFile', 'deleteFile',
  'listDir', 'banOf', 'logDecision', 'enrichCodes', 'userMap', 'enforce',
];
const apiFiles = jsFiles.filter((f) => f.includes(`${path.sep}api${path.sep}`));
// Strips block comments, line comments, and JSDoc continuation lines (a line
// starting with `*` inside a /** ... */ block, which has no delimiter of its own).
const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\*.*$/gm, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\/.*$/gm, '');

for (const f of apiFiles) {
  const raw = fs.readFileSync(f, 'utf8');
  const lines = raw.split('\n');
  lines.forEach((text, i) => {
    const code = stripComments(text);
    if (!code.trim()) return;
    // Promise.all([...]) and .then() chains often span several lines, so the
    // surrounding window is what decides whether the call is awaited.
    // Wide enough to cover a multi-line Promise.all([...]) argument list.
    const window = stripComments(lines.slice(Math.max(0, i - 12), i + 3).join('\n'));
    for (const helper of ASYNC_HELPERS) {
      const call = new RegExp(`(^|[^\\w.])${helper}\\s*\\(`);
      if (!call.test(code)) continue;
      const awaited = new RegExp(`await\\s+(module\\.exports\\.)?${helper}\\s*\\(`).test(code)
        || new RegExp(`return\\s+${helper}\\s*\\(`).test(code)
        || /\.then\s*\(/.test(code)
        || /Promise\.(all|allSettled|race)\s*\(/.test(window)
        || new RegExp(`(async\\s+)?function\\s+${helper}\\b`).test(code)
        || new RegExp(`(const|let|var)\\s+${helper}\\b`).test(code)
        || new RegExp(`${helper}\\s*[:=]`).test(code)
        || /require\(/.test(code)
        || /^\s*(module\.)?exports/.test(code)
        || /^\s*[\w$]+,?$/.test(code.trim());
      if (!awaited) add(f, i + 1, `possible missing await on async helper ${helper}()`);
    }
  });
}

// --- 4. leftovers in the API ------------------------------------------------
for (const f of apiFiles) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((text, i) => {
    if (/\bdebugger\b/.test(text)) add(f, i + 1, 'debugger statement');
    // console.error/warn are the intended logging channel; console.log is not.
    if (/\bconsole\.log\s*\(/.test(text)) add(f, i + 1, 'console.log in API code (use console.error/warn)');
  });
}

// --- 5. DOM sinks fed by an unescaped expression ----------------------------
const SAFE_WRAPPERS = /^(esc|escUrl|escCss|encodeURIComponent|avatarNode|authorLink|verifiedBadge|eagleBadge|renderMarkdown|codeCard|mdToHtml|md|fmtSize|fmtDate|Number|String)\(/;

// Project convention: a variable holding ALREADY-ESCAPED markup is named with
// one of these suffixes. The check trusts the name and relies on review to keep
// the convention honest; anything else interpolated into a DOM sink is flagged.
const FRAGMENT_NAME = /(Html|Link|Links|Badge|Node|Card|Row|Rows|Block|Markup|Actions|Icon|Nav)$/;

// Deliberate exceptions, each with the reason it is safe.
const SINK_ALLOWLIST = [
  // highlight.js escapes its own output; this only re-splits it into lines.
  { file: 'code.html', expr: 'line' },
];
for (const f of [...htmlFiles, path.join(ROOT, 'app.js')]) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  lines.forEach((text, i) => {
    if (!/innerHTML|insertAdjacentHTML|outerHTML|document\.write|srcdoc/.test(text)) return;
    // Flag only expressions that interpolate something unwrapped AND are not a
    // numeric/boolean/known-safe value.
    for (const m of text.matchAll(/\$\{([^}]+)\}/g)) {
      const expr = m[1].trim();
      if (SAFE_WRAPPERS.test(expr)) continue;
      if (FRAGMENT_NAME.test(expr)) continue;
      if (SINK_ALLOWLIST.some((a) => path.basename(f) === a.file && a.expr === expr)) continue;
      if (/^[\w.]+ \? |^!/.test(expr)) continue;              // ternary / negation guard
      if (/^(i|index|count|total|n|page|pages|sent|len)$/.test(expr)) continue;
      if (/\.(length|size|score)$/.test(expr)) continue;
      if (/^new Date\(/.test(expr)) continue;
      if (/^[A-Z_]+$/.test(expr)) continue;                   // module constant
      add(f, i + 1, `DOM sink interpolates an unwrapped expression: \${${expr.slice(0, 60)}}`);
    }
  });
}

// --- 6. security TODOs ------------------------------------------------------
for (const f of [...apiFiles, path.join(ROOT, 'app.js')]) {
  if (!fs.existsSync(f)) continue;
  fs.readFileSync(f, 'utf8').split('\n').forEach((text, i) => {
    if (/\b(TODO|FIXME|XXX)\b/.test(text) && /(auth|secret|token|password|csrf|xss|sanitiz|escape)/i.test(text)) {
      add(f, i + 1, 'unresolved security TODO');
    }
  });
}

// --- report -----------------------------------------------------------------
console.log(`[lint] ${jsFiles.length} JS file(s), ${htmlFiles.length} page(s) checked`);
console.log('[lint] codes/ skipped on purpose: user-submitted files are untrusted data and are never parsed');
if (!problems.length) {
  console.log('[lint] no problems found');
  process.exit(0);
}
for (const p of problems) console.log(`  ${p.file}:${p.line}  ${p.msg}`);
console.log(`[lint] ${problems.length} problem(s)`);
process.exit(1);
