const { currentUser, readBody, randomToken } = require('../_auth');
const { readJson, writeJson } = require('../_gh');
const { getSettings } = require('../_settings');
const { resolveFilename } = require('../_resolve');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'سجل دخول أولاً' });
  try {
    let { filename, reason } = await readBody(req);
    if (!filename) return res.status(400).json({ error: 'الملف مطلوب' });
    filename = await resolveFilename(filename);

    const settings = await getSettings();
    if (settings.direct_delete) {
      return res.status(400).json({ error: 'الحذف المباشر مفعّل — احذف الكود مباشرة من صفحته', direct: true });
    }
    if (!settings.delete_requests_enabled) {
      return res.status(403).json({ error: 'طلبات الحذف موقوفة حالياً من الإدارة' });
    }

    const { data: manifest } = await readJson('data/manifest.json', { codes: [] });
    const code = (manifest.codes || []).find((c) => c.filename === filename);
    if (!code) return res.status(404).json({ error: 'الكود غير موجود' });
    if ((code.author || '').toLowerCase() !== u.username.toLowerCase()) {
      return res.status(403).json({ error: 'يمكنك طلب حذف أكوادك فقط' });
    }
    const { data: dr } = await readJson('data/delete_requests.json', { items: [] });
    if (!dr.items) dr.items = [];
    if (dr.items.find((x) => x.filename === filename && x.status === 'pending')) {
      return res.status(400).json({ error: 'هناك طلب حذف معلق بالفعل' });
    }
    dr.items.unshift({
      id: Date.now().toString(36) + '-' + randomToken(3),
      filename,
      author: u.username,
      email: u.email,
      reason: String(reason || '').slice(0, 400),
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    await writeJson('data/delete_requests.json', dr, `delete-request: ${filename}`);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
};
