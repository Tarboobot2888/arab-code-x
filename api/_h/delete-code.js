// POST /api/delete-code { filename }
// Direct delete: admin, verified owner, or any owner when direct_delete is on.
const { readBody } = require('../_auth');
const { requireUser } = require('../_guard');
const { getFile, deleteFile, updateJson, SKIP_WRITE } = require('../_gh');
const { getSettings } = require('../_settings');
const { resolveRequested } = require('../_resolve');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { logDecision, STATUS } = require('../_moderation');

module.exports = wrap('delete-code', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user, isAdmin } = await requireUser(req, { verified: true });

  const body = await readBody(req, { maxBytes: 2048 });
  const rv = await resolveRequested(body.filename);
  if (!rv.ok) throw new HttpError(rv.notFound ? 404 : 400, rv.error);
  const filename = rv.name;

  const settings = await getSettings();

  let missing = false;
  let denied = false;
  await updateJson('data/manifest.json', { codes: [] }, (manifest) => {
    if (!Array.isArray(manifest.codes)) manifest.codes = [];
    const entry = manifest.codes.find((c) => c.filename === filename);
    if (!entry) { missing = true; return SKIP_WRITE; }

    // Ownership is re-checked against the freshest manifest, inside the same
    // read-modify-write that performs the removal.
    const isOwner = String(user.username).toLowerCase() === String(entry.author || '').toLowerCase();
    const allowed = isAdmin || (isOwner && (settings.direct_delete || !!user.is_verified_badge));
    if (!allowed) { denied = true; return SKIP_WRITE; }

    manifest.codes = manifest.codes.filter((c) => c.filename !== filename);
    return null;
  }, `delete: -${filename}`);

  if (missing) throw new HttpError(404, 'الكود غير موجود');
  if (denied) throw new HttpError(403, 'الحذف المباشر غير مفعّل لحسابك، أرسل طلب حذف للإدارة');

  const f = await getFile(`codes/${filename}`, true);
  if (f) await deleteFile(`codes/${filename}`, `delete ${filename} by ${user.username}`, f.sha);

  await logDecision({
    actor: user.username, action: 'delete-code', target: `codes/${filename}`,
    from: STATUS.APPROVED, to: STATUS.REJECTED, reason: isAdmin ? 'admin delete' : 'owner delete',
  });
  res.status(200).json({ ok: true });
});
