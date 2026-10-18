const { currentUser, readBody } = require('../_auth');

const NEZUKO_URL = 'https://nezukouploads.hidenplay.net/api/upload';
const UPLOADS_ORIGIN = 'https://nezukouploads.hidenplay.net';
const NEZUKO_KEY = process.env.NEZUKO_API_KEY || 'nzk_f250ea202babe341bc1c064d168054d4f6ba14bace44eab981cc0a1b435e9992';
function publicImageUrl(url) {
  const u = new URL(url);
  const match = u.pathname.match(/^\/file\/([^/]+)$/);
  return match ? `${UPLOADS_ORIGIN}/file/${encodeURIComponent(match[1])}` : url;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'سجل دخول أولاً' });
  try {
    const { data_url, filename } = await readBody(req);
    if (!data_url || !/^data:image\/(png|jpe?g|gif|webp);base64,/.test(data_url)) {
      return res.status(400).json({ error: 'ملف صورة غير صالح' });
    }
    const m = data_url.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
    const mime = m[1];
    const b64 = m[2];
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'الصورة أكبر من 3 ميغا' });
    const ext = mime.split('/')[1].replace('jpeg', 'jpg');
    const name = (filename || `avatar_${u.username}`).replace(/[^\w.-]/g, '_').slice(0, 40) + '.' + ext;

    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), name);
    const r = await fetch(NEZUKO_URL, {
      method: 'POST',
      headers: { 'x-api-key': NEZUKO_KEY, accept: '*/*' },
      body: fd,
    });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
    if (!r.ok || !j.success || !j.file || !j.file.url) {
      return res.status(502).json({ error: 'فشل رفع الصورة', detail: j });
    }
    res.status(200).json({ ok: true, url: publicImageUrl(j.file.url) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
};
