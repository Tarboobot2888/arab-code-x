// POST /api/resolve-delete { id, approve } — admin decides a delete request.
const { readBody } = require('../_auth');
const { requireAdmin } = require('../_guard');
const { updateJson, getFile, deleteFile, SKIP_WRITE } = require('../_gh');
const { validateFilename } = require('../_content');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { logDecision } = require('../_moderation');

const PATH = 'data/delete_requests.json';

module.exports = wrap('resolve-delete', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user } = await requireAdmin(req);
  if (!(await enforce(req, res, 'admin-write', user.username)).allowed) return;

  const body = await readBody(req, { maxBytes: 2048 });
  const id = String(body.id || '');
  const approve = !!body.approve;
  if (!id) throw new HttpError(400, 'id مطلوب');

  let target = null;
  let missing = false;
  await updateJson(PATH, { items: [] }, (dr) => {
    const item = (dr.items || []).find((x) => x.id === id);
    if (!item) { missing = true; return SKIP_WRITE; }
    if (item.status && item.status !== 'pending') { target = { ...item, already: true }; return SKIP_WRITE; }
    item.status = approve ? 'approved' : 'rejected';
    item.resolved_at = new Date().toISOString();
    item.resolved_by = user.username;
    target = { ...item };
    return null;
  }, `delete-req ${approve ? 'approved' : 'rejected'}: ${id}`);

  if (missing) throw new HttpError(404, 'الطلب غير موجود');
  if (target && target.already) throw new HttpError(409, 'الطلب محسوم مسبقاً');

  if (approve && target) {
    const v = validateFilename(target.filename);
    if (!v.ok) throw new HttpError(422, 'اسم الملف في الطلب غير صالح');
    await updateJson('data/manifest.json', { codes: [] }, (manifest) => {
      if (!Array.isArray(manifest.codes)) return SKIP_WRITE;
      const before = manifest.codes.length;
      manifest.codes = manifest.codes.filter((c) => c.filename !== v.name);
      return manifest.codes.length === before ? SKIP_WRITE : null;
    }, `manifest: -${v.name}`);
    const f = await getFile(`codes/${v.name}`, true);
    if (f) await deleteFile(`codes/${v.name}`, `delete: ${v.name}`, f.sha);
  }

  await logDecision({
    actor: user.username,
    action: approve ? 'delete-request-approve' : 'delete-request-reject',
    target: target ? `codes/${target.filename}` : `request:${id}`,
    reason: target ? target.reason : null,
  });
  res.status(200).json({ ok: true });
});
