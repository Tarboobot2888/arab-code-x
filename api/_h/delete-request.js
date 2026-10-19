// POST /api/delete-request { filename, reason }
const { readBody, randomToken } = require('../_auth');
const { requireUser } = require('../_guard');
const { readJson, updateJson, SKIP_WRITE } = require('../_gh');
const { getSettings } = require('../_settings');
const { resolveRequested } = require('../_resolve');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');

const PATH = 'data/delete_requests.json';

module.exports = wrap('delete-request', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user } = await requireUser(req, { verified: true });

  const body = await readBody(req, { maxBytes: 4096 });
  const rv = await resolveRequested(body.filename);
  if (!rv.ok) throw new HttpError(rv.notFound ? 404 : 400, rv.error);
  const filename = rv.name;
  const reason = String(body.reason || '').slice(0, 400);

  const settings = await getSettings();
  if (settings.direct_delete) {
    throw new HttpError(400, 'الحذف المباشر مفعّل — احذف الكود مباشرة من صفحته');
  }
  if (!settings.delete_requests_enabled) {
    throw new HttpError(403, 'طلبات الحذف موقوفة حالياً من الإدارة');
  }

  const { data: manifest } = await readJson('data/manifest.json', { codes: [] });
  const code = (manifest.codes || []).find((c) => c.filename === filename);
  if (!code) throw new HttpError(404, 'الكود غير موجود');
  if (String(code.author || '').toLowerCase() !== String(user.username).toLowerCase()) {
    throw new HttpError(403, 'يمكنك طلب حذف أكوادك فقط');
  }

  let duplicate = false;
  await updateJson(PATH, { items: [] }, (dr) => {
    if (!Array.isArray(dr.items)) dr.items = [];
    if (dr.items.some((x) => x.filename === filename && x.status === 'pending')) {
      duplicate = true;
      return SKIP_WRITE;
    }
    dr.items.unshift({
      id: `${Date.now().toString(36)}-${randomToken(3)}`,
      filename,
      author: user.username,
      // The requester's email is no longer copied here; the admin view resolves
      // it from the account, keeping one less copy of personal data in the file.
      reason,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    return null;
  }, `delete-request: ${filename}`);

  if (duplicate) throw new HttpError(409, 'هناك طلب حذف معلق بالفعل');
  res.status(200).json({ ok: true });
});
