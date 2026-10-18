const { currentUser, readBody, isAdminEmail } = require('../_auth');
const { readJson, writeJson, getFile, deleteFile } = require('../_gh');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = await currentUser(req);
  if (!u || !isAdminEmail(u.email)) return res.status(403).json({ error: 'ممنوع' });
  try {
    const { id, approve } = await readBody(req);
    if (!id) return res.status(400).json({ error: 'id مطلوب' });
    const { data: dr } = await readJson('data/delete_requests.json', { items: [] });
    const item = (dr.items || []).find((x) => x.id === id);
    if (!item) return res.status(404).json({ error: 'الطلب غير موجود' });
    item.status = approve ? 'approved' : 'rejected';
    item.resolved_at = new Date().toISOString();

    if (approve) {
      const codePath = `codes/${item.filename}`;
      const f = await getFile(codePath);
      if (f) await deleteFile(codePath, `delete: ${item.filename}`, f.sha);
      const { data: manifest } = await readJson('data/manifest.json', { codes: [] });
      manifest.codes = (manifest.codes || []).filter((c) => c.filename !== item.filename);
      await writeJson('data/manifest.json', manifest, `manifest: -${item.filename}`);
    }
    await writeJson('data/delete_requests.json', dr, `delete-req ${item.status}: ${item.filename}`);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
};
