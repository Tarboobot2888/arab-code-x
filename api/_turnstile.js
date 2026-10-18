// Cloudflare Turnstile server-side verification.
// Secret comes from process.env.TURNSTILE_SECRET_KEY only — never hardcoded, never logged.
async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true }; // not configured yet — don't break the site
  if (!token || typeof token !== 'string') return { ok: false, error: 'تحقق أنك لست روبوت (Turnstile)' };
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json();
    if (!data.success) return { ok: false, error: 'فشل التحقق الأمني، حاول مرة أخرى' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'تعذر التحقق الأمني، حاول لاحقاً' };
  }
}

function clientIp(req) {
  const h = req.headers['x-forwarded-for'];
  return h ? String(h).split(',')[0].trim() : undefined;
}

module.exports = { verifyTurnstile, clientIp };
