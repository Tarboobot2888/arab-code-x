// Test harness: runs the real route handlers against an in-memory store.
//
// Nothing here reaches the network. api/_gh.js is replaced in the module cache
// by a fake backed by a plain object, which also lets a test simulate a write
// conflict (the SEC-08 concurrency cases).
//
// All fixtures are synthetic: example.invalid addresses, obvious placeholder
// hashes, no real user data (the task forbids using production data in tests).
'use strict';

const path = require('path');
const { EventEmitter } = require('events');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const api = (p) => path.join(ROOT, 'api', p);

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const TEST_ENV = {
  NODE_ENV: 'test',
  VERCEL_ENV: 'development',
  JWT_SECRET: 'test-secret-'.repeat(4), // 48 chars, not a known placeholder
  ADMIN_EMAIL: 'admin@example.invalid',
  GITHUB_REPO: 'example/arab-code-test',
  GITHUB_TOKEN: 'test-token',
  GITHUB_BRANCH: 'main',
  PUBLIC_BASE_URL: 'https://test.example.invalid',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  TURNSTILE_SECRET_KEY: '',
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  UPLOADS_API_KEY: '',
  UPSTASH_REDIS_REST_URL: '',
  UPSTASH_REDIS_REST_TOKEN: '',
};

function applyEnv(overrides = {}) {
  for (const [k, v] of Object.entries({ ...TEST_ENV, ...overrides })) {
    if (v === undefined || v === null || v === '') delete process.env[k];
    else process.env[k] = String(v);
  }
}

// ---------------------------------------------------------------------------
// Fake store (stands in for the GitHub Contents API)
// ---------------------------------------------------------------------------
class FakeStore {
  constructor(files = {}) {
    this.files = new Map();
    this.writes = [];
    this.failNextPut = 0;        // simulate N consecutive 409 conflicts
    this.onBeforePut = null;     // hook to mutate the store mid-write
    for (const [p, content] of Object.entries(files)) this.put(p, content);
  }

  static sha(content) {
    return require('crypto').createHash('sha1').update(String(content)).digest('hex');
  }

  put(p, content) {
    const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    this.files.set(p, { content: body, sha: FakeStore.sha(body) });
  }

  json(p) {
    const f = this.files.get(p);
    return f ? JSON.parse(f.content) : null;
  }
}

/** Build the module object that replaces api/_gh.js. */
function fakeGh(store) {
  class GhError extends Error {
    constructor(status, p, detail) {
      super(`خطأ في الاتصال بقاعدة البيانات (${status})`);
      this.status = status; this.ghPath = p; this.detail = detail;
    }
  }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const SKIP_WRITE = Symbol.for('arabcode.SKIP_WRITE');

  async function getFile(p) {
    const f = store.files.get(p);
    return f ? { content: f.content, sha: f.sha } : null;
  }
  async function listDir(prefix) {
    const out = [];
    for (const key of store.files.keys()) {
      if (!key.startsWith(`${prefix}/`)) continue;
      const rest = key.slice(prefix.length + 1);
      if (rest.includes('/')) continue;
      out.push({ name: rest, path: key, type: 'file' });
    }
    return out;
  }
  async function putFile(p, content, message, sha) {
    if (store.onBeforePut) await store.onBeforePut(p, content, sha);
    if (store.failNextPut > 0) { store.failNextPut -= 1; throw new GhError(409, p, 'simulated conflict'); }
    const existing = store.files.get(p);
    if (existing && sha && existing.sha !== sha) throw new GhError(409, p, 'sha mismatch');
    store.put(p, content);
    store.writes.push({ path: p, message });
    return { ok: true };
  }
  async function deleteFile(p, message, sha) {
    const existing = store.files.get(p);
    if (!existing) return { skipped: true, reason: 'missing' };
    if (sha && existing.sha !== sha) throw new GhError(409, p, 'sha mismatch');
    store.files.delete(p);
    store.writes.push({ path: p, message, deleted: true });
    return { ok: true };
  }
  async function readJson(p, fallback) {
    const f = store.files.get(p);
    if (!f) return { data: clone(fallback), sha: null };
    try { return { data: JSON.parse(f.content), sha: f.sha }; }
    catch (e) { throw new GhError(500, p, `invalid JSON: ${e.message}`); }
  }
  async function writeJson(p, data, message) {
    const f = store.files.get(p);
    return putFile(p, JSON.stringify(data, null, 2), message, f ? f.sha : undefined);
  }
  async function updateJson(p, fallback, mutate, message) {
    let lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const f = store.files.get(p);
      let data;
      if (f) {
        try { data = JSON.parse(f.content); } catch (e) { throw new GhError(500, p, `invalid JSON: ${e.message}`); }
      } else data = clone(fallback);
      const result = await mutate(data);
      if (result === SKIP_WRITE) return { data, result: null, written: false, attempts: attempt };
      try {
        await putFile(p, JSON.stringify(data, null, 2), message, f ? f.sha : undefined);
        return { data, result, written: true, attempts: attempt };
      } catch (e) {
        lastErr = e;
        if (!(e instanceof GhError && (e.status === 409 || e.status === 422))) throw e;
      }
    }
    throw lastErr;
  }
  return {
    getFile, putFile, deleteFile, listDir, readJson, writeJson, updateJson,
    SKIP_WRITE, GhError, _clearCache() {},
    REPO: process.env.GITHUB_REPO, BRANCH: 'main',
  };
}

// ---------------------------------------------------------------------------
// Module cache control
// ---------------------------------------------------------------------------
function freshRequire(id) {
  const resolved = require.resolve(id);
  delete require.cache[resolved];
  return require(resolved);
}

function clearApiCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(ROOT, 'api'))) delete require.cache[key];
  }
}

/**
 * Load the API with a fake store and (optionally) a fake mailer.
 * @returns {{store:FakeStore, mail:Array, require:(p:string)=>any, routes:object}}
 */
function loadApi({ files = {}, env = {}, mail = true } = {}) {
  applyEnv(env);
  clearApiCache();

  const store = new FakeStore(files);
  // Inject the fake _gh before anything requires it.
  const ghPath = require.resolve(api('_gh.js'));
  const ghModule = new Module(ghPath, null);
  ghModule.filename = ghPath;
  ghModule.loaded = true;
  ghModule.exports = fakeGh(store);
  require.cache[ghPath] = ghModule;

  const sent = [];
  if (mail) {
    const mailPath = require.resolve(api('_mail.js'));
    const mailModule = new Module(mailPath, null);
    mailModule.filename = mailPath;
    mailModule.loaded = true;
    const record = (kind) => async (args) => { sent.push({ kind, ...args }); };
    const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    mailModule.exports = {
      sendVerification: record('verification'),
      sendPasswordReset: record('reset'),
      sendMail: record('mail'),
      sendRejection: record('rejection'),
      sendWelcome: record('welcome'),
      sendBroadcast: record('broadcast'),
      sendChangeEmail: record('change-email'),
      sendAccountNotice: record('notice'),
      shell: (x) => x,
      escapeHtml,
      rejectionHtml: () => '', welcomeHtml: () => '', passwordResetHtml: () => '',
      broadcastHtml: () => '', renderRichBody: (b) => escapeHtml(String(b || '')),
    };
    require.cache[mailPath] = mailModule;
  }

  // _config and the rate limiter keep process-level state.
  freshRequire(api('_config.js')).reset();
  freshRequire(api('_ratelimit.js'))._resetMemory();
  freshRequire(api('_lockout.js'))._reset();

  return {
    store,
    mail: sent,
    require: (p) => require(api(p)),
    get routes() { return require(api('index.js')).routes; },
    router: require(api('index.js')),
  };
}

// ---------------------------------------------------------------------------
// Request / response doubles
// ---------------------------------------------------------------------------
class FakeReq extends EventEmitter {
  constructor({ method = 'GET', url = '/api/me', headers = {}, body, cookies } = {}) {
    super();
    this.method = method;
    this.url = url;
    this.headers = {
      host: 'test.example.invalid',
      origin: 'https://test.example.invalid',
      ...headers,
    };
    if (cookies) {
      this.headers.cookie = Object.entries(cookies)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    }
    this.socket = { remoteAddress: '203.0.113.7' };
    this._raw = body === undefined ? null
      : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    if (this._raw && !this.headers['content-type'] && !Buffer.isBuffer(body) && typeof body !== 'string') {
      this.headers['content-type'] = 'application/json';
    }
    if (this._raw && this.headers['content-length'] === undefined) {
      this.headers['content-length'] = String(this._raw.length);
    }
    // Stream the body on the next tick so handlers can attach listeners first.
    setImmediate(() => {
      if (this._raw) this.emit('data', this._raw);
      this.emit('end');
    });
  }

  destroy() { this.destroyed = true; }
}

class FakeRes {
  constructor() {
    this.statusCode = 200;
    this.headers = {};
    this.body = undefined;
    this.headersSent = false;
    this.ended = false;
  }

  setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }
  getHeader(k) { return this.headers[k.toLowerCase()]; }
  status(code) { this.statusCode = code; return this; }

  json(obj) { this.headersSent = true; this.ended = true; this.body = obj; return this; }
  send(payload) { this.headersSent = true; this.ended = true; this.body = payload; return this; }
  end(payload) { this.headersSent = true; this.ended = true; if (payload !== undefined) this.body = payload; return this; }
  writeHead(code, headers) {
    this.statusCode = code;
    for (const [k, v] of Object.entries(headers || {})) this.setHeader(k, v);
    this.headersSent = true;
    return this;
  }

  get cookies() {
    const raw = this.headers['set-cookie'];
    const list = raw ? [].concat(raw) : [];
    const out = {};
    for (const c of list) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
    }
    return out;
  }
}

/** Invoke a handler and return the response double. */
async function call(handler, reqOpts) {
  const req = new FakeReq(reqOpts);
  const res = new FakeRes();
  await handler(req, res);
  return res;
}

// ---------------------------------------------------------------------------
// Fixtures — synthetic data only
// ---------------------------------------------------------------------------
// bcrypt hash of "correct horse battery" at cost 10, generated for tests only.
const TEST_PASSWORD = 'correct horse battery';

function hashSync(pw) {
  return require('bcryptjs').hashSync(pw, 4); // low cost keeps the suite fast
}

function user(overrides = {}) {
  return {
    username: 'member1',
    email: 'member1@example.invalid',
    password_hash: hashSync(TEST_PASSWORD),
    display_name: 'Member One',
    verified: true,
    is_verified_badge: false,
    session_version: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function manifestEntry(overrides = {}) {
  return {
    filename: 'demo.js',
    title: 'Demo',
    description: 'A demo snippet',
    language: 'js',
    license: 'MIT',
    tags: ['demo'],
    author: 'member1',
    author_verified: false,
    admin_added: false,
    status: 'approved',
    executable: false,
    approved_at: '2026-02-01T00:00:00.000Z',
    published_at: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A session cookie for `u`, signed with the test secret. */
function sessionFor(ctx, u) {
  const { sign } = ctx.require('_auth.js');
  return { session: sign({ u: u.username, e: u.email, v: Number(u.session_version) || 0 }) };
}

const baseFiles = ({ users = [], codes = [], settings = {}, bans = {}, interactions = {}, extra = {} } = {}) => ({
  'data/users.json': { users },
  'data/manifest.json': { codes },
  'data/settings.json': {
    auto_approve: false,
    filter_enabled: true,
    direct_delete: false,
    delete_requests_enabled: true,
    google_login_enabled: true,
    signup_enabled: true,
    email_change_enabled: true,
    username_change_enabled: true,
    account_delete_enabled: true,
    banned_words: ['forbiddenword'],
    ...settings,
  },
  'data/bans.json': bans,
  'data/interactions.json': { comments: [], likes: {}, reports: [], likeTotals: {}, ...interactions },
  'data/messages.json': { messages: [] },
  'data/zips.json': { zips: [] },
  'data/delete_requests.json': { items: [] },
  ...extra,
});

module.exports = {
  ROOT, TEST_ENV, TEST_PASSWORD,
  applyEnv, loadApi, call, FakeReq, FakeRes, FakeStore,
  user, manifestEntry, sessionFor, baseFiles, hashSync, clearApiCache,
};
