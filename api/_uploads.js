// Shared client for the external file-upload provider.
//
// SEC-03: the API key used to be a hardcoded fallback in two handlers, so it was
// readable by anyone with the source. There is now NO default: the key comes
// from the validated config and upload routes refuse to run without it.
// The key is never logged and never returned to a client.
const { config } = require('./_config');
const { HttpError } = require('./_http');

/** Rewrite a provider URL to the canonical public form, or refuse it. */
function publicUrl(url) {
  const { publicOrigin } = config().uploads;
  let u;
  try { u = new URL(url); } catch { return null; }
  const origin = `${u.protocol}//${u.host}`;
  if (origin !== publicOrigin) return null;
  const match = u.pathname.match(/^\/file\/([^/]+)$/);
  return match ? `${publicOrigin}/file/${encodeURIComponent(match[1])}` : null;
}

/** True when `url` is a URL this provider could have produced. */
function isProviderUrl(url) {
  return !!publicUrl(url);
}

/**
 * Upload a buffer. Times out, never retries blindly, and surfaces a generic
 * error to the caller while logging the provider status server-side.
 * @returns {Promise<{url:string, filename:string, size:number}>}
 */
async function upload(buffer, filename, mime) {
  const cfg = config();
  if (!cfg.uploadsEnabled) {
    // eslint-disable-next-line no-console
    console.error('[uploads] UPLOADS_API_KEY is not configured — refusing upload');
    throw new HttpError(503, 'خدمة رفع الملفات غير مهيّأة حالياً');
  }

  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), filename);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.uploads.timeoutMs);
  let r;
  let text = '';
  try {
    r = await fetch(cfg.uploads.apiUrl, {
      method: 'POST',
      headers: { 'x-api-key': cfg.uploads.apiKey, accept: '*/*' },
      body: fd,
      signal: ctl.signal,
    });
    // Cap how much of the provider's reply we read into memory.
    text = (await r.text()).slice(0, 8192);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[uploads] provider call failed:', e && e.name === 'AbortError' ? 'timeout' : e.message);
    throw new HttpError(502, 'تعذّر رفع الملف، حاول مرة ثانية');
  } finally {
    clearTimeout(timer);
  }

  let j;
  try { j = JSON.parse(text); } catch { j = null; }
  if (!r.ok || !j || !j.success || !j.file || !j.file.url) {
    // The provider's raw body is logged, not returned: it could carry internal
    // detail the client has no business seeing (APP-09).
    // eslint-disable-next-line no-console
    console.error(`[uploads] provider rejected upload (status ${r.status})`);
    throw new HttpError(502, 'فشل رفع الملف، حاول مرة ثانية');
  }

  const url = publicUrl(j.file.url);
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('[uploads] provider returned an unexpected URL origin');
    throw new HttpError(502, 'فشل رفع الملف، حاول مرة ثانية');
  }
  return {
    url,
    filename: String(j.file.filename || filename).slice(0, 100),
    size: Number(j.file.size) || buffer.length,
  };
}

module.exports = { upload, publicUrl, isProviderUrl };
