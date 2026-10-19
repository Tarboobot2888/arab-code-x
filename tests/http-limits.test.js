// Request body limits, content-type handling and error hygiene
// (plan 8 and 13: "تجاوزات حجم الطلب ونوع المحتوى", SEC-09, APP-09).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/harness');

const { HttpError } = (() => {
  h.applyEnv();
  return require('../api/_http');
})();

function ctx(extra = {}) {
  return h.loadApi({ files: h.baseFiles(extra), env: extra.env });
}

test('readRawBody rejects an oversized body with 413 and destroys the request', async () => {
  const c = ctx();
  const { readRawBody } = c.require('_http.js');
  const req = new h.FakeReq({ method: 'POST', body: Buffer.alloc(5000), headers: { 'content-length': undefined } });
  delete req.headers['content-length']; // force the streaming path, not the pre-check
  await assert.rejects(() => readRawBody(req, 1024), (e) => e.status === 413);
  assert.equal(req.destroyed, true, 'the connection must be dropped, not drained');
});

test('readRawBody rejects early on a too-large Content-Length', async () => {
  const c = ctx();
  const { readRawBody } = c.require('_http.js');
  const req = new h.FakeReq({ method: 'POST', body: 'x', headers: { 'content-length': '99999999' } });
  await assert.rejects(() => readRawBody(req, 1024), (e) => e.status === 413);
});

test('readJsonBody refuses a non-JSON content type with 415', async () => {
  const c = ctx();
  const { readJsonBody } = c.require('_http.js');
  const req = new h.FakeReq({
    method: 'POST', body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  await assert.rejects(() => readJsonBody(req), (e) => e.status === 415);
});

test('readJsonBody refuses malformed JSON with 400', async () => {
  const c = ctx();
  const { readJsonBody } = c.require('_http.js');
  const req = new h.FakeReq({ method: 'POST', body: '{not json', headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => readJsonBody(req), (e) => e.status === 400);
});

test('readJsonBody refuses a JSON array or scalar at the top level', async () => {
  const c = ctx();
  const { readJsonBody } = c.require('_http.js');
  for (const payload of ['[1,2,3]', '"hello"', '42', 'null']) {
    const req = new h.FakeReq({ method: 'POST', body: payload, headers: { 'content-type': 'application/json' } });
    await assert.rejects(() => readJsonBody(req), (e) => e.status === 400, `accepted ${payload}`);
  }
});

test('an empty body is an empty object, not a crash', async () => {
  const c = ctx();
  const { readJsonBody } = c.require('_http.js');
  const req = new h.FakeReq({ method: 'POST' });
  assert.deepEqual(await readJsonBody(req), {});
});

// --- per-route limits -------------------------------------------------------
test('submit refuses a payload over its own cap with 413', async () => {
  const u = h.user();
  const c = ctx({ users: [u] });
  const huge = JSON.stringify({ title: 'big', language: 'js', code: 'x'.repeat(2 * 1024 * 1024) });
  const res = await h.call(c.routes.submit, {
    method: 'POST', url: '/api/submit', body: huge,
    headers: { 'content-type': 'application/json' },
    cookies: h.sessionFor(c, u),
  });
  assert.equal(res.statusCode, 413);
});

test('submit refuses code longer than the configured character limit', async () => {
  const u = h.user();
  const c = ctx({ users: [u], env: { MAX_CODE_CHARS: '100' } });
  const res = await h.call(c.routes.submit, {
    method: 'POST', url: '/api/submit',
    body: { title: 'too long', language: 'js', code: 'x'.repeat(200) },
    cookies: h.sessionFor(c, u),
  });
  assert.equal(res.statusCode, 400);
  assert.match(String(res.body.error), /طويل/);
});

test('login refuses an oversized body before touching the user store', async () => {
  const c = ctx({ users: [h.user()] });
  const res = await h.call(c.routes.login, {
    method: 'POST', url: '/api/login',
    body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(20000) }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 413);
});

test('a tiny-cap route rejects a body just over the line', async () => {
  const u = h.user();
  const c = ctx({ users: [u] });
  const res = await h.call(c.routes['delete-code'], {
    method: 'POST', url: '/api/delete-code',
    body: JSON.stringify({ filename: `${'a'.repeat(3000)}.js` }),
    headers: { 'content-type': 'application/json' },
    cookies: h.sessionFor(c, u),
  });
  assert.equal(res.statusCode, 413);
});

// --- error hygiene ----------------------------------------------------------
test('an internal failure returns a generic message and a request id', async () => {
  const c = ctx({ users: [h.user()] });
  const { wrap } = c.require('_http.js');
  const boom = wrap('test', async () => { throw new Error('secret internal detail: /var/task/api/_gh.js'); });
  const res = await h.call(boom, { method: 'GET', url: '/api/test' });
  assert.equal(res.statusCode, 500);
  assert.ok(!String(res.body.error).includes('secret internal detail'), 'the internal message leaked');
  assert.ok(!String(res.body.error).includes('/var/task'), 'an internal path leaked');
  assert.ok(res.body.request_id, 'a request id must be returned for correlation');
  assert.equal(res.headers['x-request-id'], res.body.request_id);
});

test('an HttpError message IS shown (it is written for the user)', async () => {
  const c = ctx();
  const { wrap, HttpError: HE } = c.require('_http.js');
  const handler = wrap('test', async () => { throw new HE(400, 'الإيميل غير صالح'); });
  const res = await h.call(handler, { method: 'GET', url: '/api/test' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'الإيميل غير صالح');
});

test('the router answers 404 for an unknown route without echoing the path', async () => {
  const c = ctx();
  const res = await h.call(c.router, { method: 'GET', url: '/api/../../etc/passwd' });
  assert.equal(res.statusCode, 404);
  assert.ok(!String(res.body.error).includes('etc/passwd'), 'the requested path was reflected back');
});

test('the router gates every route when the configuration is incomplete', async () => {
  const c = h.loadApi({ files: h.baseFiles(), env: { VERCEL_ENV: 'production', JWT_SECRET: '' } });
  const res = await h.call(c.router, { method: 'GET', url: '/api/list' });
  assert.equal(res.statusCode, 503);
  assert.ok(!JSON.stringify(res.body).includes('JWT_SECRET'), 'the response must not name the missing variable');
});

test('health and sitemap stay reachable while misconfigured', async () => {
  const c = h.loadApi({ files: h.baseFiles(), env: { VERCEL_ENV: 'production', JWT_SECRET: '' } });
  const health = await h.call(c.router, { method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 503);
  assert.equal(health.body.status, 'misconfigured');
  const sitemap = await h.call(c.router, { method: 'GET', url: '/sitemap.xml' });
  assert.equal(sitemap.statusCode, 200);
});

test('the health check never returns a secret value', async () => {
  const c = ctx({ users: [h.user({ username: 'siteadmin', email: 'admin@example.invalid' })] });
  const res = await h.call(c.routes.health, { method: 'GET', url: '/api/health' });
  const serialized = JSON.stringify(res.body);
  for (const secret of [process.env.JWT_SECRET, process.env.GITHUB_TOKEN, process.env.GOOGLE_CLIENT_SECRET]) {
    if (!secret) continue;
    assert.ok(!serialized.includes(secret), 'the health check leaked a secret value');
  }
  assert.equal(typeof res.body.checks.session_secret, 'boolean', 'only booleans may be reported');
});

test('every per-account response is marked no-store', async () => {
  const u = h.user();
  const c = ctx({ users: [u] });
  for (const route of ['me', 'user']) {
    const res = await h.call(c.routes[route], {
      method: 'GET', url: `/api/${route}?username=member1`, cookies: h.sessionFor(c, u),
    });
    assert.match(String(res.headers['cache-control']), /no-store/, `${route} is cacheable`);
  }
});
