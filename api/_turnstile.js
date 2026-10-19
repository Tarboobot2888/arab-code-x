// Cloudflare Turnstile server-side verification.
//
// SEC-07: the audited version returned { ok:true, skipped:true } whenever
// TURNSTILE_SECRET_KEY was absent, so a missing secret silently disabled bot
// protection on login, signup and submit. Now:
//   * In production a missing secret is a configuration ERROR. _config refuses
//     to mark the service ready, so the router answers 503 — it never degrades
//     into "no protection" without anyone noticing.
//   * Outside production the check is skipped, loudly and only once per process.
//   * The secret is read from the validated config and is never logged.
//   * The remote call has a timeout; a Cloudflare outage cannot hang a lambda.
const { config } = require('./_config');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = parseInt(process.env.TURNSTILE_TIMEOUT_MS || '6000', 10);

let warned = false;

async function verifyTurnstile(token, ip) {
  const cfg = config();
  const secret = cfg.turnstileSecret;

  if (!secret) {
    if (cfg.production) {
      // Defence in depth: _config already blocks the request, but if this is
      // ever reached in production it must FAIL CLOSED, not skip.
      return { ok: false, error: 'التحقق الأمني غير مهيّأ. تواصل مع الإدارة.' };
    }
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn('[turnstile] TURNSTILE_SECRET_KEY is not set — bot verification is SKIPPED (non-production only).');
    }
    return { ok: true, skipped: true };
  }

  if (!token || typeof token !== 'string' || token.length > 4096) {
    return { ok: false, error: 'تحقق أنك لست روبوت (Turnstile)' };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const r = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctl.signal,
    });
    if (!r.ok) return { ok: false, error: 'تعذر التحقق الأمني، حاول لاحقاً' };
    const data = await r.json();
    if (!data.success) {
      // Log the error codes (never the token or the secret) for monitoring.
      // eslint-disable-next-line no-console
      console.warn('[turnstile] rejected:', Array.isArray(data['error-codes']) ? data['error-codes'].join(',') : 'unknown');
      return { ok: false, error: 'فشل التحقق الأمني، حاول مرة أخرى' };
    }
    return { ok: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[turnstile] verification call failed:', e && e.name === 'AbortError' ? 'timeout' : e.message);
    return { ok: false, error: 'تعذر التحقق الأمني، حاول لاحقاً' };
  } finally {
    clearTimeout(timer);
  }
}

function clientIp(req) {
  const h = req.headers['x-forwarded-for'];
  if (h) return String(h).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  return real ? String(real).trim() : undefined;
}

function _resetWarning() { warned = false; }

module.exports = { verifyTurnstile, clientIp, _resetWarning };
