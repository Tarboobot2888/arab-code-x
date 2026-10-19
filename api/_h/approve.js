// POST /api/approve { id, filename? } — admin approves a queued contribution.
//
// Fixes: the filename is derived from the server-side language allowlist (an
// admin-supplied override is still validated), the manifest write is atomic, and
// the decision is recorded in the audit log.
const { readBody } = require('../_auth');
const { requireAdmin } = require('../_guard');
const { getFile, putFile, deleteFile, updateJson } = require('../_gh');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { STATUS, logDecision } = require('../_moderation');
const { LANGUAGES, normalizeLanguage, slugify, validateFilename, extensionOf } = require('../_content');

const MANIFEST = 'data/manifest.json';
const ID_RE = /^[a-z0-9]{1,16}-[a-z0-9]{1,16}$/i;

module.exports = wrap('approve', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);

  const { user } = await requireAdmin(req);
  if (!(await enforce(req, res, 'admin-write', user.username)).allowed) return;

  const body = await readBody(req, { maxBytes: 4096 });
  const id = String(body.id || '').trim();
  if (!id || !ID_RE.test(id)) throw new HttpError(400, 'معرّف الطلب غير صالح');

  const pf = await getFile(`pending/${id}.json`, true);
  if (!pf) throw new HttpError(404, 'الطلب غير موجود');

  let entry;
  try { entry = JSON.parse(pf.content); } catch { throw new HttpError(422, 'ملف الطلب تالف'); }

  const language = normalizeLanguage(entry.language);
  if (!language) throw new HttpError(422, 'لغة الطلب غير مدعومة — ارفضه أو صحّح اللغة');
  const ext = LANGUAGES[language].ext;

  // The admin may rename, but the name still has to pass the allowlist and keep
  // an extension consistent with the approved language.
  let filename;
  if (body.filename) {
    const v = validateFilename(body.filename);
    if (!v.ok) throw new HttpError(400, v.error);
    if (extensionOf(v.name) !== ext) {
      throw new HttpError(400, `امتداد الملف يجب أن يكون .${ext} ليطابق لغة الكود`);
    }
    filename = v.name;
  }

  const now = new Date().toISOString();
  let finalName = filename;

  await updateJson(MANIFEST, { codes: [] }, (manifest) => {
    if (!Array.isArray(manifest.codes)) manifest.codes = [];
    if (!finalName) {
      const base = slugify(entry.title);
      let candidate = `${base}.${ext}`;
      let i = 1;
      while (manifest.codes.some((c) => c.filename === candidate)) {
        candidate = `${base}-${i}.${ext}`;
        i += 1;
      }
      finalName = candidate;
    }
    manifest.codes = manifest.codes.filter((c) => c.filename !== finalName);
    manifest.codes.unshift({
      filename: finalName,
      title: String(entry.title || finalName).slice(0, 120),
      description: String(entry.description || '').slice(0, 600),
      language,
      license: entry.license || null,
      tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 8) : [],
      author: entry.author,
      author_avatar: entry.author_avatar || null,
      author_verified: !!entry.author_verified,
      admin_added: !!entry.author_is_admin,
      status: STATUS.APPROVED,
      executable: !!LANGUAGES[language].executable,
      approved_at: now,
      published_at: now,
      approved_by: user.username,
    });
    return null;
  }, `approve: manifest +${finalName || id}`);

  if (!finalName) throw new HttpError(500, 'تعذّر تحديد اسم الملف');

  const codePath = `codes/${finalName}`;
  const existing = await getFile(codePath, true);
  await putFile(codePath, String(entry.code || ''), `approve: ${finalName} by ${entry.author}`, existing && existing.sha);

  await deleteFile(`pending/${id}.json`, `approved ${id}`, pf.sha);

  await logDecision({
    actor: user.username, action: 'approve', target: `codes/${finalName}`,
    from: STATUS.PENDING, to: STATUS.APPROVED,
    meta: { request_id: id, executable: !!LANGUAGES[language].executable },
  });

  res.status(200).json({ ok: true, url: `/c/${finalName}`, filename: finalName });
});
