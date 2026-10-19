// GitHub Contents API data store (transitional — see migrations/ for the
// PostgreSQL target this is being replaced by).
//
// Fixes against the audited version (plan: SEC-08, APP-09):
//   * updateJson() is real optimistic concurrency: the mutator runs against a
//     freshly fetched copy and is REPLAYED on every conflict. The old writeJson
//     re-read the sha but then wrote a payload the caller had built from stale
//     data, which silently dropped a concurrent update.
//   * Errors carry a numeric `status` instead of forcing callers to substring
//     match a translated message.
//   * Every request has a timeout; a hung GitHub call can no longer hold a
//     lambda open until the platform kills it.
//   * The anonymous read fallback is restricted to GET and is never used for
//     mutations.
const { config } = require('./_config');

const API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = parseInt(process.env.GITHUB_TIMEOUT_MS || '10000', 10);

const CACHE = new Map();
const CACHE_TTL = 15000; // warm-instance cache for GETs only
const INFLIGHT = new Map();

function repo() { return config().github.repo; }
function branch() { return config().github.branch; }
function token() { return config().github.token; }

class GhError extends Error {
  constructor(status, path, detail) {
    super(`خطأ في الاتصال بقاعدة البيانات (${status})`);
    this.status = status;
    this.ghPath = path;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function contentsUrl(path, withRef) {
  // Each path segment is encoded separately: encodeURIComponent on the whole
  // path would turn "data/users.json" into "data%2Fusers.json".
  const encoded = String(path).split('/').map(encodeURIComponent).join('/');
  return `/repos/${repo()}/contents/${encoded}${withRef ? `?ref=${encodeURIComponent(branch())}` : ''}`;
}

async function gh(path, opts = {}, retries = 2) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'arab-code-web',
    ...(opts.headers || {}),
  };
  const isGet = !opts.method || opts.method === 'GET';
  if (token() && !opts.__anon) headers.Authorization = `Bearer ${token()}`;

  if (isGet && !opts.noCache && CACHE.has(path)) {
    const entry = CACHE.get(path);
    if (Date.now() - entry.time < CACHE_TTL) return entry.res.clone();
  }
  if (isGet && !opts.noCache && !opts.__anon && INFLIGHT.has(path)) {
    try { return (await INFLIGHT.get(path)).clone(); } catch { /* fall through to a fresh call */ }
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const p = fetch(`${API}${path}`, { ...opts, headers, signal: ctl.signal });
    if (isGet && !opts.noCache && !opts.__anon) {
      INFLIGHT.set(path, p);
      p.then(() => {}, () => {}).finally(() => setTimeout(() => INFLIGHT.delete(path), 0));
    }
    const res = (await p).clone();

    if ((res.status === 403 || res.status === 429) && retries > 0) {
      await sleep(800 * (3 - retries));
      return gh(path, { ...opts, noCache: true }, retries - 1);
    }
    if (!res.ok) {
      // A stale/invalid token must not take read-only pages down, but it must
      // never let a MUTATION through unauthenticated.
      if (res.status === 401 && isGet && token() && !opts.__anon) {
        return gh(path, { ...opts, __anon: true }, retries);
      }
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch { /* body already consumed */ }
      // eslint-disable-next-line no-console
      console.error(`[gh] ${res.status} on ${path}${detail ? ` :: ${detail}` : ''}`);
      throw new GhError(res.status, path, detail);
    }

    if (isGet) {
      if (CACHE.size > 500) CACHE.clear();
      CACHE.set(path, { res: res.clone(), time: Date.now() });
    } else {
      CACHE.clear(); // a mutation invalidates every cached read
    }
    return res;
  } catch (e) {
    if (e instanceof GhError) throw e;
    if (e && e.name === 'AbortError') {
      if (retries > 0) { await sleep(500); return gh(path, { ...opts, noCache: true }, retries - 1); }
      throw new GhError(504, path, 'timeout');
    }
    if (retries > 0) { await sleep(1000); return gh(path, opts, retries - 1); }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function getFile(path, noCache) {
  try {
    const res = await gh(contentsUrl(path, true), { noCache });
    const j = await res.json();
    if (!j || typeof j.content !== 'string') return null; // a directory, not a file
    return { content: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return null;
    throw e;
  }
}

async function listDir(path) {
  try {
    const res = await gh(contentsUrl(path, true));
    const j = await res.json();
    return Array.isArray(j) ? j : [];
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return [];
    throw e;
  }
}

async function putFile(path, content, message, sha) {
  const body = { message, content: Buffer.from(content).toString('base64'), branch: branch() };
  if (sha) body.sha = sha;
  return gh(contentsUrl(path, false), { method: 'PUT', body: JSON.stringify(body) });
}

async function deleteFile(path, message, sha) {
  // GitHub requires the blob sha. The audited code called this without one from
  // _h/ban.js, so every delete during a ban silently failed with 422.
  let blobSha = sha;
  if (!blobSha) {
    const f = await getFile(path, true);
    if (!f) return { skipped: true, reason: 'missing' };
    blobSha = f.sha;
  }
  const body = { message, sha: blobSha, branch: branch() };
  return gh(contentsUrl(path, false), { method: 'DELETE', body: JSON.stringify(body) });
}

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

async function readJson(path, fallback) {
  const f = await getFile(path);
  if (!f) return { data: clone(fallback), sha: null };
  try {
    return { data: JSON.parse(f.content), sha: f.sha };
  } catch (e) {
    // A corrupt file must not be silently replaced by the fallback and then
    // written back — that would destroy data. Surface it instead.
    throw new GhError(500, path, `invalid JSON: ${e.message}`);
  }
}

/** Sentinel a mutator can return to abort the write without an error. */
const SKIP_WRITE = Symbol('SKIP_WRITE');

/**
 * Atomic read-modify-write with conflict replay.
 *
 * @param {string} path
 * @param {*} fallback         value used when the file does not exist yet
 * @param {(data:any)=>any} mutate   receives the FRESHEST copy; mutate in place.
 *                                   Return SKIP_WRITE to cancel the write.
 * @param {string} message     commit message
 * @returns {Promise<{data:any, result:any, written:boolean, attempts:number}>}
 */
async function updateJson(path, fallback, mutate, message) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const f = await getFile(path, true); // always a fresh sha AND fresh content
    let data;
    if (f) {
      try { data = JSON.parse(f.content); } catch (e) { throw new GhError(500, path, `invalid JSON: ${e.message}`); }
    } else {
      data = clone(fallback);
    }

    const result = await mutate(data);
    if (result === SKIP_WRITE) return { data, result: null, written: false, attempts: attempt };

    try {
      await putFile(path, JSON.stringify(data, null, 2), message, f ? f.sha : undefined);
      return { data, result, written: true, attempts: attempt };
    } catch (e) {
      lastErr = e;
      const conflict = e instanceof GhError && (e.status === 409 || e.status === 422);
      if (!conflict) throw e;
      // Someone else wrote first: discard our copy and replay the mutator
      // against their version. This is the fix for SEC-08.
      await sleep(120 * attempt + Math.floor(Math.random() * 120));
    }
  }
  throw lastErr;
}

/**
 * Legacy whole-object write. Still used where the caller genuinely owns the
 * whole document (settings, single-record files). Prefer updateJson() for any
 * collection that concurrent requests append to.
 */
async function writeJson(path, data, message) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const f = await getFile(path, true);
    try {
      return await putFile(path, JSON.stringify(data, null, 2), message, f ? f.sha : undefined);
    } catch (e) {
      lastErr = e;
      const conflict = e instanceof GhError && (e.status === 409 || e.status === 422);
      if (!conflict) throw e;
      await sleep(150 * (i + 1));
    }
  }
  throw lastErr;
}

function _clearCache() { CACHE.clear(); INFLIGHT.clear(); }

module.exports = {
  getFile, putFile, deleteFile, listDir, readJson, writeJson, updateJson,
  SKIP_WRITE, GhError, _clearCache,
  get REPO() { return repo(); },
  get BRANCH() { return branch(); },
};
