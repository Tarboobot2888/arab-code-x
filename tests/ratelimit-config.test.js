// Rate limiting, Turnstile fail-closed behaviour and environment validation
// (plan: SEC-04, SEC-07, 13 "تحديد معدل الطلبات", "غياب متغيرات البيئة
// المطلوبة").
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/harness');

const ctx = (extra = {}) => h.loadApi({ files: h.baseFiles(extra.base || {}), env: extra.env });

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------
test('a bucket allows exactly `max` hits and then refuses', async () => {
  const c = ctx();
  const rl = c.require('_ratelimit.js');
  const policy = { max: 3, windowMs: 60000 };
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await rl.hit(['t', 'unit'], policy));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false, false]);
  assert.equal(results[2].remaining, 0);
  assert.ok(results[3].retryAfter > 0);
});

test('separate keys have separate budgets', async () => {
  const c = ctx();
  const rl = c.require('_ratelimit.js');
  const policy = { max: 1, windowMs: 60000 };
  assert.equal((await rl.hit(['a'], policy)).allowed, true);
  assert.equal((await rl.hit(['b'], policy)).allowed, true);
  assert.equal((await rl.hit(['a'], policy)).allowed, false);
});

test('enforce answers 429 with Retry-After once the budget is gone', async () => {
  const c = ctx();
  const rl = c.require('_ratelimit.js');
  const policy = rl.POLICIES['forgot-password'];
  const req = new h.FakeReq({ method: 'POST', headers: { 'x-forwarded-for': '198.51.100.9' } });
  let res;
  for (let i = 0; i <= policy.max; i++) {
    res = new h.FakeRes();
    // eslint-disable-next-line no-await-in-loop
    var out = await rl.enforce(req, res, 'forgot-password', 'victim@example.invalid');
  }
  assert.equal(out.allowed, false);
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers['retry-after']);
  assert.match(String(res.body.error), /عدد المحاولات/);
});

test('the limiter buckets by actor as well as IP', async () => {
  const c = ctx();
  const rl = c.require('_ratelimit.js');
  // Same actor, different IPs: the actor bucket still trips.
  const max = rl.POLICIES['forgot-password'].max;
  let out;
  for (let i = 0; i <= max; i++) {
    const req = new h.FakeReq({ method: 'POST', headers: { 'x-forwarded-for': `203.0.113.${i + 10}` } });
    // eslint-disable-next-line no-await-in-loop
    out = await rl.enforce(req, new h.FakeRes(), 'forgot-password', 'same-victim@example.invalid');
  }
  assert.equal(out.allowed, false, 'rotating the IP must not reset an actor budget');
});

test('the backend is reported honestly so the gap is visible', async () => {
  let c = ctx();
  let rl = c.require('_ratelimit.js');
  assert.equal(rl.backend(), 'memory');
  assert.equal(rl.isDistributed(), false, 'an in-process Map is not a distributed control');

  c = ctx({ env: { UPSTASH_REDIS_REST_URL: 'https://redis.example.invalid', UPSTASH_REDIS_REST_TOKEN: 'tok' } });
  rl = c.require('_ratelimit.js');
  assert.equal(rl.backend(), 'upstash');
  assert.equal(rl.isDistributed(), true);
});

test('a backend outage fails OPEN but is reported as degraded', async () => {
  const c = ctx({ env: { UPSTASH_REDIS_REST_URL: 'https://redis.example.invalid', UPSTASH_REDIS_REST_TOKEN: 'tok' } });
  const rl = c.require('_ratelimit.js');
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('connection refused'); };
  try {
    const r = await rl.hit(['x'], { max: 1, windowMs: 1000 });
    assert.equal(r.allowed, true, 'an unreachable limiter must not lock everyone out');
    assert.match(r.backend, /degraded/);
  } finally { global.fetch = originalFetch; }
});

test('every policy name used by a route exists', () => {
  const c = ctx();
  const rl = c.require('_ratelimit.js');
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(h.ROOT, 'api');
  const used = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/enforce\(req,\s*res,\s*'([^']+)'/g)) used.add(m[1]);
    }
  };
  walk(dir);
  assert.ok(used.size > 10, `expected many rate-limited routes, found ${used.size}`);
  for (const name of used) {
    assert.ok(rl.POLICIES[name], `route uses an undefined policy: ${name}`);
  }
});

test('signup is rate limited', async () => {
  const c = ctx();
  const max = c.require('_ratelimit.js').POLICIES.signup.max;
  let last;
  for (let i = 0; i <= max; i++) {
    // eslint-disable-next-line no-await-in-loop
    last = await h.call(c.routes.signup, {
      method: 'POST', url: '/api/signup',
      body: { username: `spam${i}`, email: `spam${i}@example.invalid`, password: 'a-good-password' },
    });
  }
  assert.equal(last.statusCode, 429);
});

test('forgot-password is rate limited (it had no protection at all)', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] } });
  const max = c.require('_ratelimit.js').POLICIES['forgot-password'].max;
  let last;
  for (let i = 0; i <= max; i++) {
    // eslint-disable-next-line no-await-in-loop
    last = await h.call(c.routes['forgot-password'], {
      method: 'POST', url: '/api/forgot-password', body: { email: u.email },
    });
  }
  assert.equal(last.statusCode, 429);
});

// ---------------------------------------------------------------------------
// Turnstile
// ---------------------------------------------------------------------------
test('Turnstile is skipped (loudly) outside production when unconfigured', async () => {
  const c = ctx({ env: { VERCEL_ENV: 'development', TURNSTILE_SECRET_KEY: '' } });
  const ts = c.require('_turnstile.js');
  const r = await ts.verifyTurnstile(undefined, '198.51.100.1');
  assert.deepEqual(r, { ok: true, skipped: true });
});

test('Turnstile FAILS CLOSED in production when unconfigured (SEC-07)', async () => {
  const c = ctx({ env: { VERCEL_ENV: 'production', TURNSTILE_SECRET_KEY: '', GITHUB_TOKEN: 'x' } });
  const ts = c.require('_turnstile.js');
  const r = await ts.verifyTurnstile('any-token', '198.51.100.1');
  assert.equal(r.ok, false, 'a missing secret must never silently skip verification');
  assert.match(String(r.error), /غير مهيّأ/);
});

test('a configured Turnstile secret rejects a missing or oversized token', async () => {
  const c = ctx({ env: { TURNSTILE_SECRET_KEY: 'test-secret' } });
  const ts = c.require('_turnstile.js');
  assert.equal((await ts.verifyTurnstile(undefined)).ok, false);
  assert.equal((await ts.verifyTurnstile('')).ok, false);
  assert.equal((await ts.verifyTurnstile('x'.repeat(5000))).ok, false);
});

test('a Turnstile failure from Cloudflare blocks the request', async () => {
  const c = ctx({ env: { TURNSTILE_SECRET_KEY: 'test-secret' } });
  const ts = c.require('_turnstile.js');
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) });
  try {
    const r = await ts.verifyTurnstile('bad-token');
    assert.equal(r.ok, false);
  } finally { global.fetch = originalFetch; }
});

test('a Turnstile outage blocks rather than letting the request through', async () => {
  const c = ctx({ env: { TURNSTILE_SECRET_KEY: 'test-secret' } });
  const ts = c.require('_turnstile.js');
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  try {
    const r = await ts.verifyTurnstile('token');
    assert.equal(r.ok, false, 'bot verification must fail closed');
  } finally { global.fetch = originalFetch; }
});

test('login is blocked when Turnstile rejects the token', async () => {
  const u = h.user();
  const c = ctx({ base: { users: [u] }, env: { TURNSTILE_SECRET_KEY: 'test-secret' } });
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] }) });
  try {
    const res = await h.call(c.routes.login, {
      method: 'POST', url: '/api/login', body: { email: u.email, password: h.TEST_PASSWORD, turnstile_token: 'x' },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(!res.cookies.session);
  } finally { global.fetch = originalFetch; }
});

// ---------------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------------
function cfgWith(env) {
  const c = h.loadApi({ files: h.baseFiles(), env });
  return c.require('_config.js').config();
}

test('production requires JWT_SECRET, ADMIN_EMAIL, PUBLIC_BASE_URL, repo, token and Turnstile', () => {
  const cfg = cfgWith({
    VERCEL_ENV: 'production',
    JWT_SECRET: '', ADMIN_EMAIL: '', PUBLIC_BASE_URL: '',
    GITHUB_REPO: '', GITHUB_TOKEN: '', TURNSTILE_SECRET_KEY: '',
  });
  assert.equal(cfg.ok, false);
  const joined = cfg.problems.join(' | ');
  for (const name of ['JWT_SECRET', 'ADMIN_EMAIL', 'PUBLIC_BASE_URL', 'GITHUB_REPO', 'GITHUB_TOKEN', 'TURNSTILE_SECRET_KEY']) {
    assert.match(joined, new RegExp(name), `${name} is not validated`);
  }
});

test('a fully configured production environment validates', () => {
  const cfg = cfgWith({
    VERCEL_ENV: 'production',
    JWT_SECRET: 'x'.repeat(64),
    ADMIN_EMAIL: 'ops@example.invalid',
    PUBLIC_BASE_URL: 'https://www.example.invalid',
    GITHUB_REPO: 'owner/repo',
    GITHUB_TOKEN: 'ghp_example',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
  });
  assert.equal(cfg.ok, true, cfg.problems.join(' | '));
});

test('a placeholder secret is rejected in every environment', () => {
  for (const value of ['change-me', 'changeme', 'secret', 'password', 'test']) {
    const cfg = cfgWith({ JWT_SECRET: value });
    assert.equal(cfg.ok, false, `accepted JWT_SECRET=${value}`);
    assert.match(cfg.problems.join(' '), /placeholder/);
  }
});

test('a short secret is a hard failure in production and a warning locally', () => {
  const prod = cfgWith({ VERCEL_ENV: 'production', JWT_SECRET: 'tooshort', GITHUB_TOKEN: 'x', TURNSTILE_SECRET_KEY: 'k' });
  assert.equal(prod.ok, false);
  assert.match(prod.problems.join(' '), /at least 32/);

  const dev = cfgWith({ VERCEL_ENV: 'development', JWT_SECRET: 'alsoshort' });
  assert.equal(dev.ok, true);
  assert.match(dev.warnings.join(' '), /at least 32/);
});

test('an ephemeral development key is generated, never a shared constant', () => {
  const a = cfgWith({ VERCEL_ENV: 'development', JWT_SECRET: '' });
  const first = a.jwtSecret;
  assert.ok(first && first.length >= 32);
  assert.notEqual(first, 'change-me');
  const b = cfgWith({ VERCEL_ENV: 'development', JWT_SECRET: '' });
  assert.notEqual(b.jwtSecret, first, 'each process must generate its own key');
});

test('UNTRUSTED_CONTENT_ORIGIN may not equal the application origin', () => {
  const same = cfgWith({
    PUBLIC_BASE_URL: 'https://www.example.invalid',
    UNTRUSTED_CONTENT_ORIGIN: 'https://www.example.invalid',
  });
  assert.equal(same.ok, false);
  assert.match(same.problems.join(' '), /must differ/);

  const ok = cfgWith({
    PUBLIC_BASE_URL: 'https://www.example.invalid',
    UNTRUSTED_CONTENT_ORIGIN: 'https://usercontent.example.invalid',
  });
  assert.equal(ok.ok, true, ok.problems.join(' | '));
});

test('an invalid admin email or base URL is caught', () => {
  assert.equal(cfgWith({ ADMIN_EMAIL: 'not-an-email' }).ok, false);
  assert.equal(cfgWith({ PUBLIC_BASE_URL: 'ftp://x' }).ok, false);
  assert.equal(cfgWith({ GITHUB_REPO: 'not-a-repo' }).ok, false);
});

test('a missing upload key is a warning, not a hard failure (uploads just refuse)', () => {
  const cfg = cfgWith({ UPLOADS_API_KEY: '' });
  assert.equal(cfg.ok, true);
  assert.match(cfg.warnings.join(' '), /UPLOADS_API_KEY/);
  assert.equal(cfg.uploadsEnabled, false);
});

test('security-relevant links never come from the Host header when a base URL is set', () => {
  const c = h.loadApi({ files: h.baseFiles(), env: { PUBLIC_BASE_URL: 'https://trusted.example.invalid' } });
  const { baseUrl } = c.require('_config.js');
  const req = new h.FakeReq({ headers: { host: 'evil.example.invalid', 'x-forwarded-host': 'evil.example.invalid' } });
  assert.equal(baseUrl(req), 'https://trusted.example.invalid');
});

test('the verification link uses the trusted base URL, not the request host', async () => {
  const c = h.loadApi({ files: h.baseFiles(), env: { PUBLIC_BASE_URL: 'https://trusted.example.invalid' } });
  await h.call(c.routes.signup, {
    method: 'POST', url: '/api/signup',
    body: { username: 'hostcheck', email: 'hostcheck@example.invalid', password: 'a-good-password' },
    headers: { host: 'evil.example.invalid', origin: 'https://trusted.example.invalid' },
  });
  const mail = c.mail.find((m) => m.kind === 'verification');
  assert.match(mail.verifyUrl, /^https:\/\/trusted\.example\.invalid\//,
    'a poisoned Host header must not steer the verification link');
});
