// Shared HTTP plumbing for every route (plan: SEC-09, APP-09, 5.1 middleware row).
//
//   * readJsonBody() enforces a byte cap WHILE streaming and aborts early with
//     413 — the body is never fully buffered before the size is known.
//   * Content-Type is validated (415) and malformed JSON answered with 400.
//   * Internal exception details never reach the client; a request id is logged
//     next to the real reason and returned so support can correlate.
const crypto = require('crypto');
const { config } = require('./_config');

class HttpError extends Error {
  constructor(status, message, meta) {
    super(message);
    this.status = status;
    this.expose = true;
    this.meta = meta || null;
  }
}

function requestId(req) {
  if (req && req.__rid) return req.__rid;
  const rid = (req && (req.headers['x-vercel-id'] || req.headers['x-request-id']))
    || crypto.randomBytes(8).toString('hex');
  if (req) req.__rid = String(rid).slice(0, 80);
  return req ? req.__rid : String(rid);
}

/** Reject anything but the listed methods with 405 + Allow. */
function methodGuard(req, res, allowed) {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  const methods = [...new Set([...list, 'OPTIONS'])];
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', methods.join(', '));
    res.status(204).end();
    return false;
  }
  if (!list.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    res.status(405).json({ error: 'طريقة الطلب غير مسموحة' });
    return false;
  }
  return true;
}

/**
 * Stream the request body with a hard byte cap.
 * @returns {Promise<Buffer>}
 * @throws HttpError 413 as soon as the cap is exceeded (connection destroyed).
 */
function readRawBody(req, maxBytes) {
  const cap = Number.isFinite(maxBytes) ? maxBytes : config().limits.jsonBodyBytes;

  // Cheap pre-check: trust Content-Length only to reject early, never to accept.
  const declared = parseInt(req.headers['content-length'] || '', 10);
  if (Number.isFinite(declared) && declared > cap) {
    return Promise.reject(new HttpError(413, 'حجم الطلب أكبر من المسموح'));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    req.on('data', (c) => {
      if (settled) return;
      size += c.length;
      if (size > cap) {
        finish(reject, new HttpError(413, 'حجم الطلب أكبر من المسموح'));
        try { req.destroy(); } catch { /* already closed */ }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => finish(resolve, Buffer.concat(chunks)));
    req.on('aborted', () => finish(reject, new HttpError(400, 'تم إلغاء الطلب')));
    req.on('error', (e) => finish(reject, new HttpError(400, 'تعذّر قراءة الطلب', { cause: e.message })));
  });
}

function contentTypeOf(req) {
  return String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}

/**
 * Parse a JSON request body.
 * @param {object} opts { maxBytes, required (default true), allowEmpty }
 */
async function readJsonBody(req, opts = {}) {
  const { maxBytes, allowEmpty = true } = opts;

  // Vercel's Node runtime may have parsed the body already.
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const ct = contentTypeOf(req);
  const raw = await readRawBody(req, maxBytes);
  if (!raw.length) {
    if (allowEmpty) return {};
    throw new HttpError(400, 'جسم الطلب مطلوب');
  }
  if (ct && ct !== 'application/json' && ct !== 'text/json') {
    throw new HttpError(415, 'نوع المحتوى يجب أن يكون application/json');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON غير صالح');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'يجب أن يكون جسم الطلب كائن JSON');
  }
  return parsed;
}

/**
 * Same-origin check for cookie-authenticated state changes (CSRF defence).
 * SameSite=Lax already blocks cross-site POSTs in modern browsers; this is the
 * server-side backstop the plan asks for (5.1: "فحص Origin للعمليات الحساسة").
 */
function assertSameOrigin(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const source = origin || referer;
  // No Origin/Referer at all: non-browser client (curl, server-to-server). Those
  // carry no ambient cookies from a third-party page, so there is nothing to forge.
  if (!source) return;

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  let sourceHost;
  try { sourceHost = new URL(source).host.toLowerCase(); } catch { throw new HttpError(403, 'أصل الطلب غير صالح'); }

  const allowed = new Set([host].filter(Boolean));
  const base = config().publicBaseUrl;
  if (base) { try { allowed.add(new URL(base).host.toLowerCase()); } catch { /* validated in config */ } }
  for (const extra of String(process.env.EXTRA_ALLOWED_ORIGINS || '').split(',')) {
    const t = extra.trim();
    if (!t) continue;
    try { allowed.add(new URL(t).host.toLowerCase()); } catch { /* ignore bad entry */ }
  }
  if (!allowed.has(sourceHost)) throw new HttpError(403, 'أصل الطلب غير مسموح');
}

/** Uniform error response. Only HttpError messages are shown to the client. */
function sendError(req, res, err, label) {
  const rid = requestId(req);
  const status = err instanceof HttpError ? err.status : (Number.isInteger(err && err.status) ? err.status : 500);
  // Log the real reason server-side, with the id, without request bodies.
  // eslint-disable-next-line no-console
  console.error(`[${label || 'api'}][rid=${rid}] ${status} ${err && err.message ? err.message : 'unknown'}`);
  if (res.headersSent) return;
  res.setHeader('X-Request-Id', rid);
  const exposed = (err instanceof HttpError) || (err && err.expose === true);
  const body = { error: exposed && err.message ? err.message : 'حدث خطأ غير متوقع، حاول لاحقاً', request_id: rid };
  res.status(status >= 400 && status < 600 ? status : 500).json(body);
}

/** Wrap a handler so thrown errors become uniform responses. */
function wrap(label, fn) {
  return async (req, res) => {
    try {
      res.setHeader('X-Request-Id', requestId(req));
      return await fn(req, res);
    } catch (e) {
      return sendError(req, res, e, label);
    }
  };
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Vary', 'Cookie');
}

module.exports = {
  HttpError, readRawBody, readJsonBody, methodGuard, assertSameOrigin,
  sendError, wrap, requestId, noStore, contentTypeOf,
};
