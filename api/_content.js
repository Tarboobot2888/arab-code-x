// Server-side content rules: what may be published, under what filename, and
// what a binary upload actually is (plan: SEC-02, APP-07, 7.1, 9.1).
//
// Nothing here trusts a client-supplied extension, MIME type or language value.

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------
// The server owns this list. The audited submit handler took `language`
// straight from the request and used it as the file extension, so a caller could
// choose any extension it liked.
const LANGUAGES = {
  js: { ext: 'js', label: 'JavaScript', executable: false },
  ts: { ext: 'ts', label: 'TypeScript', executable: false },
  html: { ext: 'html', label: 'HTML', executable: true },
  css: { ext: 'css', label: 'CSS', executable: false },
  svg: { ext: 'svg', label: 'SVG', executable: true },
  py: { ext: 'py', label: 'Python', executable: false },
  php: { ext: 'php', label: 'PHP', executable: false },
  java: { ext: 'java', label: 'Java', executable: false },
  cpp: { ext: 'cpp', label: 'C++', executable: false },
  c: { ext: 'c', label: 'C', executable: false },
  cs: { ext: 'cs', label: 'C#', executable: false },
  go: { ext: 'go', label: 'Go', executable: false },
  rs: { ext: 'rs', label: 'Rust', executable: false },
  rb: { ext: 'rb', label: 'Ruby', executable: false },
  kt: { ext: 'kt', label: 'Kotlin', executable: false },
  sh: { ext: 'sh', label: 'Shell', executable: false },
  sql: { ext: 'sql', label: 'SQL', executable: false },
  json: { ext: 'json', label: 'JSON', executable: false },
  yml: { ext: 'yml', label: 'YAML', executable: false },
  md: { ext: 'md', label: 'Markdown', executable: false },
  txt: { ext: 'txt', label: 'نص', executable: false },
};

const LANGUAGE_KEYS = Object.keys(LANGUAGES);

/** "html" for anything a browser would run if it were served as a document. */
const EXECUTABLE_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'svg', 'xml', 'mhtml', 'shtml']);

function normalizeLanguage(value) {
  const v = String(value || '').trim().toLowerCase();
  const aliases = {
    javascript: 'js', mjs: 'js', cjs: 'js', node: 'js',
    typescript: 'ts', python: 'py', python3: 'py',
    htm: 'html', markdown: 'md', yaml: 'yml', 'c++': 'cpp', csharp: 'cs',
    golang: 'go', rust: 'rs', ruby: 'rb', kotlin: 'kt', bash: 'sh', shell: 'sh',
    text: 'txt', plaintext: 'txt', '': 'txt',
  };
  const key = aliases[v] || v;
  return LANGUAGES[key] ? key : null;
}

function extensionOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function isExecutableExtension(ext) {
  return EXECUTABLE_EXTENSIONS.has(String(ext || '').toLowerCase());
}

function isExecutableLanguage(lang) {
  const key = normalizeLanguage(lang);
  return !!(key && LANGUAGES[key].executable);
}

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------
const FILENAME_RE = /^[a-z0-9][a-z0-9._-]{0,78}[a-z0-9]$/;

function slugify(s) {
  return String(s || 'code').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'code';
}

/**
 * Validate a filename that will become a path segment.
 * Rejects traversal, absolute paths, NUL, leading dots, double extensions that
 * smuggle an executable type, and anything outside the allowlist charset.
 * @returns {{ok:true, name:string}|{ok:false, error:string}}
 */
function validateFilename(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false, error: 'اسم الملف مطلوب' };
  if (raw.length > 80) return { ok: false, error: 'اسم الملف طويل جداً' };
  if (raw.includes('\0')) return { ok: false, error: 'اسم ملف غير صالح' };
  if (raw.includes('/') || raw.includes('\\')) return { ok: false, error: 'اسم ملف غير صالح' };
  if (raw.includes('..')) return { ok: false, error: 'اسم ملف غير صالح' };
  if (raw.startsWith('.')) return { ok: false, error: 'اسم ملف غير صالح' };
  // Reject percent/unicode escapes that could decode into a separator.
  if (/%2e|%2f|%5c|‮/i.test(raw)) return { ok: false, error: 'اسم ملف غير صالح' };
  const lower = raw.toLowerCase();
  if (!FILENAME_RE.test(lower)) return { ok: false, error: 'اسم ملف غير صالح' };
  const ext = extensionOf(lower);
  if (!ext) return { ok: false, error: 'اسم الملف يجب أن ينتهي بامتداد معروف' };
  const allowed = new Set([...Object.values(LANGUAGES).map((l) => l.ext), 'htm', 'mjs', 'cjs', 'yaml', 'xml']);
  if (!allowed.has(ext)) return { ok: false, error: 'امتداد غير مدعوم' };
  return { ok: true, name: lower };
}

/**
 * Looser validator for a name a VISITOR asked for, before it is resolved
 * through the manifest. It still blocks traversal, absolute paths, NUL, control
 * characters and oversized input, but it tolerates the legacy names already
 * published without an extension (e.g. "group-Members") so existing links keep
 * working. Whatever it resolves to is then re-checked with validateFilename.
 */
const REQUESTED_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,78}$/;

function validateRequestedName(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false, error: 'اسم الملف مطلوب' };
  if (raw.length > 80) return { ok: false, error: 'اسم الملف طويل جداً' };
  if (/[\0-\x1f\x7f]/.test(raw)) return { ok: false, error: 'اسم ملف غير صالح' };
  if (raw.includes('/') || raw.includes('\\')) return { ok: false, error: 'اسم ملف غير صالح' };
  if (raw.includes('..') || raw.startsWith('.')) return { ok: false, error: 'اسم ملف غير صالح' };
  if (/%2e|%2f|%5c|\u202e/i.test(raw)) return { ok: false, error: 'اسم ملف غير صالح' };
  if (!REQUESTED_RE.test(raw)) return { ok: false, error: 'اسم ملف غير صالح' };
  return { ok: true, name: raw };
}

/**
 * Canonical form for a legacy filename: lowercase, no leading dot, safe charset,
 * and an extension that matches the entry's language. Used by the one-off
 * normalisation migration (scripts/normalize-manifest.js), which keeps the old
 * name as an alias so published links do not break.
 */
function canonicalFilename(filename, languageKey) {
  const lang = LANGUAGES[normalizeLanguage(languageKey) || 'txt'] || LANGUAGES.txt;
  const raw = String(filename || '');
  const currentExt = extensionOf(raw);
  const knownExt = new Set([...Object.values(LANGUAGES).map((l) => l.ext), 'htm', 'mjs', 'cjs', 'yaml', 'xml']);
  const stem = knownExt.has(currentExt) ? raw.slice(0, -(currentExt.length + 1)) : raw;
  let base = String(stem)
    .toLowerCase()
    .replace(/^[.\s_-]+/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  if (!base) base = 'code';
  if (!/^[a-z0-9]/.test(base)) base = `c-${base}`;
  const ext = knownExt.has(currentExt) ? currentExt : lang.ext;
  return `${base}.${ext}`;
}

/** Build the stored filename from a title + an allowlisted language. */
function buildFilename(title, languageKey) {
  const lang = LANGUAGES[languageKey];
  if (!lang) throw new Error(`buildFilename: unknown language ${languageKey}`);
  return `${slugify(title)}.${lang.ext}`;
}

// ---------------------------------------------------------------------------
// Binary sniffing
// ---------------------------------------------------------------------------
const IMAGE_SIGNATURES = [
  { mime: 'image/png', ext: 'png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.length > 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

/**
 * Identify an image from its bytes.
 * SVG is deliberately NOT accepted as an avatar: it is an executable document.
 * @returns {{ok:true, mime:string, ext:string}|{ok:false, error:string}}
 */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return { ok: false, error: 'ملف صورة غير صالح' };
  for (const sig of IMAGE_SIGNATURES) {
    if (sig.test(buf)) return { ok: true, mime: sig.mime, ext: sig.ext };
  }
  return { ok: false, error: 'نوع الصورة غير مدعوم (PNG, JPG, GIF, WEBP فقط)' };
}

const ARCHIVE_SIGNATURES = [
  { type: 'zip', test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) },
  { type: 'rar', test: (b) => b.subarray(0, 6).toString('latin1') === 'Rar!\x1a\x07' },
  { type: '7z', test: (b) => b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) },
  { type: 'gz', test: (b) => b[0] === 0x1f && b[1] === 0x8b },
  { type: 'xz', test: (b) => b.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) },
  { type: 'bz2', test: (b) => b.subarray(0, 3).toString('latin1') === 'BZh' },
  // POSIX tar keeps its magic at offset 257.
  { type: 'tar', test: (b) => b.length > 265 && ['ustar\0', 'ustar '].includes(b.subarray(257, 263).toString('latin1')) },
];

function sniffArchive(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return { ok: false, error: 'الملف فارغ أو غير صالح' };
  for (const sig of ARCHIVE_SIGNATURES) {
    try { if (sig.test(buf)) return { ok: true, type: sig.type }; } catch { /* try next */ }
  }
  return { ok: false, error: 'نوع الملف غير مدعوم (zip, rar, 7z, tar, gz, xz, bz2)' };
}

// ZIP bomb / unsafe path inspection, from the central directory only. The
// archive is never extracted — untrusted archives must not be unpacked inside
// an application path (plan 8).
const MAX_ZIP_RATIO = 120;                    // compressed -> uncompressed
const MAX_ZIP_TOTAL = 256 * 1024 * 1024;      // 256 MB expanded
const MAX_ZIP_ENTRIES = 5000;

function inspectZip(buf) {
  const findings = { entries: 0, totalUncompressed: 0, totalCompressed: 0, ratio: 0, unsafePaths: [], encrypted: false };
  // End of central directory: scan backwards over the max comment length.
  const limit = Math.max(0, buf.length - 66000);
  let eocd = -1;
  for (let i = buf.length - 22; i >= limit; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) return { ok: false, error: 'أرشيف ZIP غير مكتمل أو تالف', findings };

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES) return { ok: false, error: 'الأرشيف يحتوي عدداً مفرطاً من الملفات', findings };

  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length) return { ok: false, error: 'أرشيف ZIP تالف', findings };
    if (buf.readUInt32LE(offset) !== 0x02014b50) return { ok: false, error: 'أرشيف ZIP تالف', findings };
    const flags = buf.readUInt16LE(offset + 8);
    const compressed = buf.readUInt32LE(offset + 20);
    const uncompressed = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');

    if (flags & 0x1) findings.encrypted = true;
    findings.entries += 1;
    findings.totalCompressed += compressed;
    findings.totalUncompressed += uncompressed;

    // Zip-slip: absolute paths, traversal, drive letters, backslashes, NUL.
    if (name.startsWith('/') || name.includes('..') || /^[a-zA-Z]:/.test(name)
        || name.includes('\\') || name.includes('\0')) {
      if (findings.unsafePaths.length < 10) findings.unsafePaths.push(name.slice(0, 120));
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }

  findings.ratio = findings.totalCompressed > 0
    ? Number((findings.totalUncompressed / findings.totalCompressed).toFixed(1))
    : 0;

  if (findings.unsafePaths.length) {
    return { ok: false, error: 'الأرشيف يحتوي مسارات غير آمنة (مسار مطلق أو ..)', findings };
  }
  if (findings.totalUncompressed > MAX_ZIP_TOTAL) {
    return { ok: false, error: 'حجم الأرشيف بعد فك الضغط كبير جداً', findings };
  }
  if (findings.ratio > MAX_ZIP_RATIO) {
    return { ok: false, error: 'نسبة ضغط غير طبيعية (قد يكون ZIP bomb)', findings };
  }
  return { ok: true, findings };
}

/** Full archive gate: signature, then structural checks for the formats we can read. */
function inspectArchive(buf, declaredName) {
  const sniff = sniffArchive(buf);
  if (!sniff.ok) return sniff;
  const declaredExt = extensionOf(declaredName);
  // A .zip that is actually a RAR (or vice-versa) is a mismatch worth refusing.
  const family = { zip: ['zip'], rar: ['rar'], '7z': ['7z'], gz: ['gz', 'tgz'], xz: ['xz'], bz2: ['bz2'], tar: ['tar'] };
  if (declaredExt && family[sniff.type] && !family[sniff.type].includes(declaredExt)
      && !(sniff.type === 'gz' && /(tar\.gz|tgz|gz)$/.test(String(declaredName).toLowerCase()))
      && !(sniff.type === 'xz' && /(tar\.xz|xz)$/.test(String(declaredName).toLowerCase()))) {
    return { ok: false, error: `محتوى الملف (${sniff.type}) لا يطابق امتداده (${declaredExt})` };
  }
  if (sniff.type === 'zip') {
    const z = inspectZip(buf);
    return z.ok ? { ok: true, type: 'zip', findings: z.findings } : z;
  }
  // rar/7z/gz/xz/bz2/tar: signature + size only. Deep inspection needs a
  // dedicated scanning worker — see AUDIT_FINAL (المتبقي).
  return { ok: true, type: sniff.type, findings: { inspected: 'signature-only' } };
}

// ---------------------------------------------------------------------------
// Pre-publish quality card (plan 7.2.ج) — signals for review, not a guarantee.
// ---------------------------------------------------------------------------
const SECRET_PATTERNS = [
  { id: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/, label: 'مفتاح AWS' },
  { id: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, label: 'توكن GitHub' },
  { id: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, label: 'مفتاح Google API' },
  { id: 'slack_token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/, label: 'توكن Slack' },
  { id: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, label: 'مفتاح خاص' },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, label: 'رمز JWT' },
  { id: 'bearer', re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, label: 'بيانات اعتماد مكتوبة في الشيفرة' },
  { id: 'smtp_url', re: /\b(?:smtps?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]+@/i, label: 'رابط اتصال يحتوي كلمة سر' },
];

/** Secret-shaped strings in a submission. Returns labels only — never the match. */
function scanForSecrets(text) {
  const s = String(text || '');
  const hits = [];
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(s)) hits.push({ id: p.id, label: p.label });
  }
  return hits;
}

const KNOWN_LICENSES = ['MIT', 'Apache-2.0', 'GPL-3.0-only', 'GPL-2.0-only', 'AGPL-3.0-only', 'BSD-3-Clause', 'BSD-2-Clause', 'MPL-2.0', 'ISC', 'Unlicense', 'CC0-1.0', 'CC-BY-4.0', 'proprietary'];

function normalizeLicense(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const match = KNOWN_LICENSES.find((l) => l.toLowerCase() === v.toLowerCase());
  return match || null;
}

/**
 * Diagnostic card shown before publishing instead of a blunt rejection.
 * Signals only — it is never a security guarantee, and never replaces review.
 */
function qualityCard({ title, description, language, code, license, filename }) {
  const checks = [];
  const add = (id, ok, label, hint) => checks.push({ id, ok, label, hint: ok ? null : hint });

  const langKey = normalizeLanguage(language);
  add('language', !!langKey, 'اللغة مدعومة ومعروفة في الخادم', 'اختر لغة من القائمة المدعومة');
  add('title', String(title || '').trim().length >= 4, 'العنوان واضح (4 أحرف على الأقل)', 'اكتب عنواناً وصفياً');
  add('description', String(description || '').trim().length >= 20, 'الوصف يشرح الكود (20 حرفاً على الأقل)', 'أضف وصفاً يشرح الفكرة والمتطلبات');
  const license_ok = !!normalizeLicense(license);
  add('license', license_ok, 'الترخيص معروف', `اختر ترخيصاً من: ${KNOWN_LICENSES.slice(0, 6).join(', ')}`);

  const len = String(code || '').length;
  add('size', len > 0 && len <= 200000, 'حجم الكود مناسب', 'الكود فارغ أو أكبر من الحد المسموح (200 ألف حرف)');

  const secrets = scanForSecrets(code);
  add('secrets', secrets.length === 0, 'لا توجد أسرار ظاهرة في الكود',
    `أزل القيم الحساسة قبل النشر: ${secrets.map((s) => s.label).join('، ')}`);

  const ext = filename ? extensionOf(filename) : (langKey ? LANGUAGES[langKey].ext : '');
  const executable = isExecutableExtension(ext) || (langKey ? LANGUAGES[langKey].executable : false);
  add('extension', !filename || validateFilename(filename).ok, 'الامتداد يطابق اللغة', 'اسم الملف أو امتداده غير مدعوم');

  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return {
    score,
    checks,
    executable,
    requires_review: executable,
    secret_findings: secrets.map((s) => s.id),
  };
}

module.exports = {
  LANGUAGES, LANGUAGE_KEYS, EXECUTABLE_EXTENSIONS, KNOWN_LICENSES,
  normalizeLanguage, normalizeLicense, extensionOf, isExecutableExtension, isExecutableLanguage,
  slugify, validateFilename, validateRequestedName, canonicalFilename, buildFilename, FILENAME_RE, REQUESTED_RE,
  sniffImage, sniffArchive, inspectZip, inspectArchive,
  scanForSecrets, qualityCard,
  MAX_ZIP_RATIO, MAX_ZIP_TOTAL, MAX_ZIP_ENTRIES,
};
