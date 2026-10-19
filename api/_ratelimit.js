// Rate limiting for a serverless runtime (plan: SEC-07, 5.3).
//
// A per-instance Map is NOT a distributed control: Vercel runs many concurrent
// lambdas, so an in-memory counter only slows a single warm instance. This module
// therefore prefers a shared store and states plainly which backend is active:
//
//   backend = 'upstash'  → Upstash Redis REST (atomic INCR + EXPIRE over fetch,
//                          no npm dependency). Configure UPSTASH_REDIS_REST_URL
//                          and UPSTASH_REDIS_REST_TOKEN.
//   backend = 'memory'   → best-effort fallback. Reported by /api/health so the
//                          gap is visible instead of silently assumed covered.
//
// Account-level lockout (password guessing) does not rely on this module at all:
// it is persisted on the user record itself — see _lockout.js.
const crypto = require('crypto');

const MEM = new Map(); // key -> { count, resetAt }
let MEM_SWEEP = 0;

function upstash() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return url && token ? { url, token } : null;
}

function backend() {
  return upstash() ? 'upstash' : 'memory';
}

function isDistributed() {
  return backend() !== 'memory';
}

/** Keys are hashed so an IP or email never lands in a third-party store in clear. */
function hashKey(parts) {
  return 'rl:' + crypto.createHash('sha256').update(parts.join('|'), 'utf8').digest('hex').slice(0, 32);
}

async function upstashHit(key, windowSec) {
  const { url, token } = upstash();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  try {
    // Pipeline: INCR then EXPIRE ... NX (only set TTL on the first hit).
    const r = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, String(windowSec), 'NX'], ['TTL', key]]),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`upstash ${r.status}`);
    const out = await r.json();
    const count = Number(out[0] && out[0].result);
    const ttl = Number(out[2] && out[2].result);
    if (!Number.isFinite(count)) throw new Error('upstash bad reply');
    return { count, ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : windowSec };
  } finally {
    clearTimeout(timer);
  }
}

function memoryHit(key, windowMs) {
  const now = Date.now();
  if (now - MEM_SWEEP > 60000) {
    MEM_SWEEP = now;
    for (const [k, v] of MEM) if (v.resetAt <= now) MEM.delete(k);
  }
  let e = MEM.get(key);
  if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; MEM.set(key, e); }
  e.count += 1;
  return { count: e.count, ttl: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) };
}

/**
 * Count one hit against `parts` and report whether it is allowed.
 * Fails OPEN on backend errors (an unreachable Redis must not lock everyone out)
 * but records the failure so monitoring can see it.
 *
 * @returns {Promise<{allowed:boolean, remaining:number, retryAfter:number, backend:string}>}
 */
async function hit(parts, { max, windowMs }) {
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const key = hashKey([...parts, String(windowSec), String(max)]);
  const be = backend();
  try {
    const { count, ttl } = be === 'upstash'
      ? await upstashHit(key, windowSec)
      : memoryHit(key, windowMs);
    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      retryAfter: ttl,
      backend: be,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ratelimit] backend failure, allowing request:', e.message);
    return { allowed: true, remaining: max, retryAfter: 0, backend: be + '-degraded' };
  }
}

/** Named policies. Keep them in one place so routes cannot drift apart. */
const POLICIES = {
  login: { max: 10, windowMs: 10 * 60 * 1000 },
  signup: { max: 5, windowMs: 60 * 60 * 1000 },
  verify: { max: 20, windowMs: 60 * 60 * 1000 },
  'resend-verification': { max: 3, windowMs: 60 * 60 * 1000 },
  'forgot-password': { max: 5, windowMs: 60 * 60 * 1000 },
  'reset-password': { max: 10, windowMs: 60 * 60 * 1000 },
  'change-email': { max: 5, windowMs: 60 * 60 * 1000 },
  'confirm-email': { max: 20, windowMs: 60 * 60 * 1000 },
  'change-username': { max: 5, windowMs: 24 * 60 * 60 * 1000 },
  'delete-account': { max: 5, windowMs: 60 * 60 * 1000 },
  comments: { max: 20, windowMs: 10 * 60 * 1000 },
  reports: { max: 10, windowMs: 60 * 60 * 1000 },
  messages: { max: 10, windowMs: 60 * 60 * 1000 },
  submit: { max: 10, windowMs: 60 * 60 * 1000 },
  likes: { max: 60, windowMs: 10 * 60 * 1000 },
  'upload-avatar': { max: 10, windowMs: 60 * 60 * 1000 },
  'zip-upload': { max: 10, windowMs: 60 * 60 * 1000 },
  'zip-publish': { max: 10, windowMs: 60 * 60 * 1000 },
  broadcast: { max: 60, windowMs: 60 * 60 * 1000 },
  google: { max: 20, windowMs: 10 * 60 * 1000 },
  'admin-write': { max: 120, windowMs: 10 * 60 * 1000 },
};

function clientIp(req) {
  const h = req.headers['x-forwarded-for'];
  if (h) return String(h).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Enforce a named policy. Buckets by IP and, when known, by actor identity —
 * so one abusive account cannot hide behind many IPs and vice-versa
 * (plan: "أضف حدوداً حسب المستخدم وIP والإجراء، مع عدم الاعتماد على IP وحده").
 *
 * @returns {Promise<{allowed:boolean, retryAfter:number}>}
 */
async function enforce(req, res, name, actor) {
  const policy = POLICIES[name];
  if (!policy) throw new Error(`unknown rate-limit policy: ${name}`);
  const ip = clientIp(req);

  const buckets = [['ip', name, ip]];
  if (actor) buckets.push(['actor', name, String(actor).toLowerCase()]);

  let worst = null;
  for (const b of buckets) {
    // An identified actor gets a slightly tighter personal budget.
    const r = await hit(b, b[0] === 'actor' ? { max: policy.max, windowMs: policy.windowMs } : policy);
    if (!r.allowed && (!worst || r.retryAfter > worst.retryAfter)) worst = r;
  }
  if (worst) {
    if (res && !res.headersSent) {
      res.setHeader('Retry-After', String(worst.retryAfter));
      res.status(429).json({
        error: 'عدد المحاولات كبير. انتظر قليلاً ثم حاول مرة أخرى.',
        retry_after: worst.retryAfter,
      });
    }
    return { allowed: false, retryAfter: worst.retryAfter };
  }
  return { allowed: true, retryAfter: 0 };
}

function _resetMemory() { MEM.clear(); MEM_SWEEP = 0; }

module.exports = { enforce, hit, clientIp, backend, isDistributed, POLICIES, _resetMemory };
