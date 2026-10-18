const REPO = process.env.GITHUB_REPO || 'mzml-gg/arab-web';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const API = 'https://api.github.com';

const CACHE = new Map();
const CACHE_TTL = 15000; // warm-instance cache for GET requests
const INFLIGHT = new Map(); // dedupe identical concurrent GETs

async function gh(path, opts = {}, retries = 2) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'arab-code-web',
    ...(opts.headers || {})
  };
  if (TOKEN && !opts.__anon) headers['Authorization'] = `Bearer ${TOKEN}`;

  // Cache handling for GET requests
  const isGet = !opts.method || opts.method === 'GET';
  if (isGet && !opts.noCache && CACHE.has(path)) {
    const entry = CACHE.get(path);
    if (Date.now() - entry.time < CACHE_TTL) return entry.res.clone();
  }

  if (isGet && !opts.noCache && !opts.__anon && INFLIGHT.has(path)) {
    try { return (await INFLIGHT.get(path)).clone(); } catch (_) {}
  }
  try {
    const p = fetch(`${API}${path}`, { ...opts, headers });
    if (isGet && !opts.noCache && !opts.__anon) {
      INFLIGHT.set(path, p);
      p.finally(() => setTimeout(() => INFLIGHT.delete(path), 0)).catch(() => {});
    }
    const res = (await p).clone();
    if ((res.status === 403 || res.status === 429) && retries > 0 && res.headers.get('x-ratelimit-remaining') !== null) {
      await new Promise(r => setTimeout(r, 800 * (3 - retries)));
      return gh(path, { ...opts, noCache: true }, retries - 1);
    }
    if (!res.ok) {
      if (res.status === 401 && isGet && TOKEN && !opts.__anon) {
        // Public repository fallback: keep read-only pages available if Vercel's
        // secret is stale/invalid. Mutations never use this fallback.
        return gh(path, { ...opts, __anon: true }, retries);
      }
      if (false) { // Conflict retry (common in GH API)
        await new Promise(r => setTimeout(r, 1000));
        return gh(path, opts, retries - 1);
      }
      const text = await res.text();
      console.error(`GH ERROR: ${res.status} ${text} on ${path}`);
      throw new Error(`خطأ في الاتصال بقاعدة البيانات (${res.status})`);
    }
    
    if (isGet) {
      if (CACHE.size > 500) CACHE.clear();
      CACHE.set(path, { res: res.clone(), time: Date.now() });
    } else {
      // Clear cache on mutations to ensure fresh data
      CACHE.clear();
    }
    
    return res;
  } catch (e) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1000));
      return gh(path, opts, retries - 1);
    }
    throw e;
  }
}

async function getFile(path, noCache) {
  try {
    const res = await gh(`/repos/${REPO}/contents/${encodeURIComponent(path)}?ref=${BRANCH}`, { noCache });
    const j = await res.json();
    return { content: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
  } catch (e) {
    if (e.message.includes('404')) return null;
    throw e;
  }
}

async function listDir(path) {
  try {
    const res = await gh(`/repos/${REPO}/contents/${encodeURIComponent(path)}?ref=${BRANCH}`);
    return await res.json();
  } catch (e) {
    if (e.message.includes('404')) return [];
    throw e;
  }
}

async function putFile(path, content, message, sha) {
  const body = { message, content: Buffer.from(content).toString('base64'), branch: BRANCH };
  if (sha) body.sha = sha;
  return gh(`/repos/${REPO}/contents/${encodeURIComponent(path)}`, { method: 'PUT', body: JSON.stringify(body) });
}

async function deleteFile(path, message, sha) {
  const body = { message, sha, branch: BRANCH };
  return gh(`/repos/${REPO}/contents/${encodeURIComponent(path)}`, { method: 'DELETE', body: JSON.stringify(body) });
}

async function readJson(path, fallback) {
  const f = await getFile(path);
  if (!f) return { data: fallback, sha: null };
  try {
    return { data: JSON.parse(f.content), sha: f.sha };
  } catch {
    return { data: fallback, sha: f.sha };
  }
}

async function writeJson(path, data, message) {
  // Always use a fresh sha (cache may be stale across instances) and retry on conflict.
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const f = await getFile(path, true);
    try {
      return await putFile(path, JSON.stringify(data, null, 2), message, f ? f.sha : undefined);
    } catch (e) { lastErr = e; if (!/\((409|422)\)/.test(e.message)) throw e; }
  }
  throw lastErr;
}

module.exports = { getFile, putFile, deleteFile, listDir, readJson, writeJson, REPO, BRANCH };
