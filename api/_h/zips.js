// Ready-made archive packages.
//
// Fixes (plan: SEC-03, SEC-05, APP-07, 7.1 P2):
//   * The ban check goes through _guard (the audited code tested `u.banned` on
//     the user record while bans actually live in data/bans.json — SEC-05).
//   * No hardcoded provider key (SEC-03).
//   * Archives are identified by magic bytes, the declared extension must agree,
//     and ZIPs are inspected for zip-slip paths and bomb-like ratios without
//     ever being extracted.
//   * A SHA-256 checksum and the scan status are stored with every package.
//   * Writes use updateJson so two concurrent publishes cannot lose one another.
const crypto = require('crypto');
const { readBody } = require('../_auth');
const { requireUser, assertOwnerOrAdmin } = require('../_guard');
const { readJson, updateJson, SKIP_WRITE } = require('../_gh');
const { getSettings, scanContent } = require('../_settings');
const { verifyTurnstile, clientIp } = require('../_turnstile');
const { wrap, methodGuard, HttpError, noStore, readRawBody } = require('../_http');
const { enforce } = require('../_ratelimit');
const { config } = require('../_config');
const { inspectArchive, scanForSecrets } = require('../_content');
const { upload, isProviderUrl } = require('../_uploads');
const { logDecision } = require('../_moderation');

const MANIFEST = 'data/zips.json';
const ALLOWED_NAME = /\.(zip|rar|7z|tar|gz|tgz|xz|bz2)$/i;

function slugify(s) {
  return String(s || 'file').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'file';
}

function typeOf(name) {
  const m = String(name || '').toLowerCase().match(/\.(tar\.gz|tar\.xz|[a-z0-9]+)$/);
  return m ? m[1].toUpperCase() : 'FILE';
}

const list = wrap('zips-list', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  await requireUser(req, { csrf: false });
  noStore(res);
  const { data } = await readJson(MANIFEST, { zips: [] });
  const url = new URL(req.url, 'http://localhost');
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  // `readme` can be 30k characters — it is only sent on the detail route.
  let zips = (data.zips || []).map(({ readme, ...z }) => z);
  if (q) {
    zips = zips.filter((z) => [z.title, z.description, z.author, (z.tags || []).join(' ')]
      .join(' ').toLowerCase().includes(q));
  }
  res.status(200).json({ zips });
});

const get = wrap('zip-get', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  await requireUser(req, { csrf: false });
  noStore(res);
  const slug = new URL(req.url, 'http://localhost').searchParams.get('slug') || '';
  const { data } = await readJson(MANIFEST, { zips: [] });
  const z = (data.zips || []).find((x) => x.slug === slug);
  if (!z) throw new HttpError(404, 'الملف غير موجود');
  res.status(200).json({ zip: z });
});

const uploadHandler = wrap('zip-upload', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);

  const { user } = await requireUser(req, { verified: true });
  if (!(await enforce(req, res, 'zip-upload', user.username)).allowed) return;

  // The provider receives this as the stored filename, so it is validated the
  // same way a path segment would be: no traversal, no separators, no control
  // characters, and an extension from the archive allowlist.
  let declared = '';
  try {
    declared = decodeURIComponent(new URL(req.url, 'http://localhost').searchParams.get('name') || '');
  } catch {
    throw new HttpError(400, 'اسم الملف غير صالح');
  }
  declared = declared.trim().slice(0, 80);
  const unsafeName = !declared
    || declared.includes('..')
    || declared.startsWith('.')
    || /[^\w.-]/.test(declared)
    || !ALLOWED_NAME.test(declared);
  if (unsafeName) {
    throw new HttpError(415, 'اسم أو نوع الملف غير مدعوم (zip, rar, 7z, tar.gz ...)');
  }

  const max = config().limits.archiveBytes;
  // Rejects with 413 the moment the cap is crossed — never buffers past it.
  const buf = await readRawBody(req, max);
  if (!buf.length) throw new HttpError(400, 'الملف فارغ');

  // Magic bytes + structural inspection. Nothing is extracted.
  const verdict = inspectArchive(buf, declared);
  if (!verdict.ok) {
    await logDecision({
      actor: user.username, action: 'archive-rejected', target: declared,
      reason: verdict.error, meta: verdict.findings || null,
    });
    throw new HttpError(422, verdict.error);
  }

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const result = await upload(buf, declared, 'application/octet-stream');

  res.status(200).json({
    ok: true,
    url: result.url,
    filename: result.filename,
    size: result.size,
    sha256,
    archive_type: verdict.type,
    // Signature + structure only. A malware engine is a separate worker — see
    // AUDIT_FINAL_ARAB_CODE.md (ما زال يحتاج تدخلاً تشغيلياً).
    scan_status: verdict.findings && verdict.findings.inspected === 'signature-only'
      ? 'signature-only'
      : 'structure-checked',
    findings: verdict.findings || null,
  });
});

const publish = wrap('zip-publish', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);

  const { user, isAdmin } = await requireUser(req, { verified: true });
  if (!(await enforce(req, res, 'zip-publish', user.username)).allowed) return;

  const b = await readBody(req, { maxBytes: 128 * 1024 });
  const ts = await verifyTurnstile(b.turnstile_token, clientIp(req));
  if (!ts.ok) throw new HttpError(400, ts.error);

  const title = String(b.title || '').trim().slice(0, 120);
  if (!title) throw new HttpError(400, 'اسم الملف مطلوب');
  if (!isProviderUrl(b.url)) throw new HttpError(400, 'ارفع الملف أولاً');

  const readme = String(b.readme || '').slice(0, 30000);
  const description = String(b.description || '').slice(0, 300);
  const settings = await getSettings();

  if (settings.filter_enabled && !isAdmin) {
    const hit = scanContent({ title, description, code: readme }, settings.banned_words);
    if (hit) throw new HttpError(400, `تم رفض الملف لاحتوائه على محتوى مخالف ("${hit}")`);
  }

  const secrets = scanForSecrets(readme);
  const tags = String(b.tags || '').split(/[,،]/).map((t) => t.trim().slice(0, 24)).filter(Boolean).slice(0, 8);
  const sha256 = /^[a-f0-9]{64}$/i.test(String(b.sha256 || '')) ? String(b.sha256).toLowerCase() : null;

  let slug = null;
  await updateJson(MANIFEST, { zips: [] }, (data) => {
    if (!Array.isArray(data.zips)) data.zips = [];
    const base = slugify(title);
    let candidate = base;
    let i = 1;
    while (data.zips.some((z) => z.slug === candidate)) candidate = `${base}-${i++}`;
    slug = candidate;
    data.zips.unshift({
      slug,
      title,
      description,
      readme,
      tags,
      version: String(b.version || '').slice(0, 30),
      thumb: isProviderUrl(b.thumb) ? String(b.thumb).slice(0, 400) : '',
      url: String(b.url),
      filename: String(b.filename || '').slice(0, 100),
      type: typeOf(b.filename || b.url),
      size: Math.max(0, Number(b.size) || 0),
      sha256,
      scan_status: ['structure-checked', 'signature-only'].includes(b.scan_status) ? b.scan_status : 'unknown',
      archive_type: String(b.archive_type || '').slice(0, 10) || null,
      secret_findings: secrets.map((s) => s.id),
      downloads: 0,
      author: user.username,
      author_avatar: user.avatar_url || null,
      author_verified: isAdmin || !!user.is_verified_badge,
      created_at: new Date().toISOString(),
    });
    return null;
  }, `zip: +${slugify(title)} by ${user.username}`);

  if (!slug) throw new HttpError(500, 'تعذّر نشر الملف، حاول لاحقاً');
  res.status(200).json({ ok: true, url: `/zip/${encodeURIComponent(slug)}` });
});

const del = wrap('zip-delete', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);

  const ctx = await requireUser(req, { verified: true });
  const { slug } = await readBody(req, { maxBytes: 2048 });
  if (!slug || typeof slug !== 'string') throw new HttpError(400, 'الملف مطلوب');

  let found = false;
  let denied = false;
  await updateJson(MANIFEST, { zips: [] }, (data) => {
    if (!Array.isArray(data.zips)) data.zips = [];
    const z = data.zips.find((x) => x.slug === slug);
    if (!z) return SKIP_WRITE;
    found = true;
    try {
      assertOwnerOrAdmin(ctx, z.author, 'غير مسموح');
    } catch {
      denied = true;
      return SKIP_WRITE;
    }
    data.zips = data.zips.filter((x) => x.slug !== slug);
    return null;
  }, `zip: -${slug}`);

  if (!found) throw new HttpError(404, 'الملف غير موجود');
  if (denied) throw new HttpError(403, 'غير مسموح');

  await logDecision({ actor: ctx.user.username, action: 'zip-delete', target: `zip:${slug}` });
  res.status(200).json({ ok: true });
});

module.exports = { list, get, upload: uploadHandler, publish, del };
