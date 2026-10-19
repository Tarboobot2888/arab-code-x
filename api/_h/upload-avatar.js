// POST /api/upload-avatar { data_url, filename? }
//
// Fixes (plan: SEC-03, SEC-09, 8):
//   * No hardcoded provider key — see _uploads.js.
//   * The body is capped WHILE streaming, so a 50 MB data URL is rejected with
//     413 before it is buffered. The audited version parsed the whole JSON body
//     and only then checked the decoded image size.
//   * The real image type is detected from the bytes; the declared MIME is only
//     used as a hint and must agree with the content. SVG is refused outright
//     because it is an executable document.
const { readBody } = require('../_auth');
const { requireUser } = require('../_guard');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { config } = require('../_config');
const { sniffImage } = require('../_content');
const { upload } = require('../_uploads');

const DATA_URL_RE = /^data:(image\/[a-z0-9+.-]{2,20});base64,([A-Za-z0-9+/=\s]+)$/i;

module.exports = wrap('upload-avatar', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);

  const { user } = await requireUser(req, { verified: true });
  if (!(await enforce(req, res, 'upload-avatar', user.username)).allowed) return;

  const maxImage = config().limits.avatarBytes;
  // base64 inflates by ~4/3; allow that plus a small JSON envelope.
  const body = await readBody(req, { maxBytes: Math.ceil(maxImage * 1.4) + 2048 });

  const dataUrl = typeof body.data_url === 'string' ? body.data_url : '';
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) throw new HttpError(400, 'ملف صورة غير صالح');

  const declaredMime = m[1].toLowerCase();
  if (declaredMime === 'image/svg+xml') {
    throw new HttpError(415, 'صور SVG غير مدعومة للصور الشخصية');
  }

  let buf;
  try { buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64'); } catch { throw new HttpError(400, 'ترميز الصورة غير صالح'); }
  if (!buf.length) throw new HttpError(400, 'الصورة فارغة');
  if (buf.length > maxImage) {
    throw new HttpError(413, `الصورة أكبر من ${Math.round(maxImage / (1024 * 1024))} ميغا`);
  }

  // Content decides the type, not the client.
  const sniffed = sniffImage(buf);
  if (!sniffed.ok) throw new HttpError(415, sniffed.error);
  if (sniffed.mime !== declaredMime && !(declaredMime === 'image/jpg' && sniffed.mime === 'image/jpeg')) {
    throw new HttpError(415, 'نوع الصورة المعلن لا يطابق محتواها');
  }

  const safeBase = String(body.filename || `avatar_${user.username}`)
    .replace(/[^\w-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || `avatar_${user.username}`;
  const name = `${safeBase}.${sniffed.ext}`;

  const result = await upload(buf, name, sniffed.mime);
  res.status(200).json({ ok: true, url: result.url });
});
