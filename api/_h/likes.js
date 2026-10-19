// Likes — the endpoint popular.html has always called but which was never
// registered (APP-01: "صفحة الأكثر إعجاباً مرشحة للفشل").
//
//   GET  /api/likes?code=<filename>  -> { code, total, like }
//   GET  /api/likes?top=1[&limit=]   -> { top: [{ code, total }], totals }
//   POST /api/likes { code }         -> toggle the caller's like
//
// Uniqueness is structural, not a check-then-write: the store keys a like by
// "<username>|<filename>", so one member can never like the same code twice
// even under concurrent requests. Totals are recomputed from those keys rather
// than being an independently incremented counter that could drift.
const { readBody } = require('../_auth');
const { requireUser, optionalUser } = require('../_guard');
const { readJson, updateJson } = require('../_gh');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { validateRequestedName } = require('../_content');
const { resolveRequested } = require('../_resolve');

const PATH = 'data/interactions.json';

function likeKey(username, code) {
  return `${String(username).toLowerCase()}|${code}`;
}

/** Recompute every total from the like keys — the keys are the source of truth. */
function recomputeTotals(likes) {
  const totals = {};
  for (const key of Object.keys(likes || {})) {
    if (!likes[key]) continue;
    const sep = key.indexOf('|');
    // A key without the separator is malformed; counting it would invent a code
    // name (indexOf returns -1, so slice(0) would take the whole key).
    if (sep <= 0) continue;
    const code = key.slice(sep + 1);
    if (!code) continue;
    totals[code] = (totals[code] || 0) + 1;
  }
  return totals;
}

async function load() {
  const { data } = await readJson(PATH, { comments: [], likes: {}, reports: [], likeTotals: {} });
  if (!data.likes || typeof data.likes !== 'object') data.likes = {};
  return data;
}

module.exports = wrap('likes', async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  const url = new URL(req.url, 'http://localhost');

  // ---------------- GET ----------------
  if (req.method === 'GET') {
    const data = await load();
    const totals = recomputeTotals(data.likes);

    if (url.searchParams.get('top')) {
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '24', 10) || 24));
      const top = Object.entries(totals)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([code, total]) => ({ code, total }));
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
      return res.status(200).json({ top, totals });
    }

    const requested = url.searchParams.get('code') || '';
    const v = validateRequestedName(requested);
    if (!v.ok) throw new HttpError(400, 'اسم الملف غير صالح');
    // A legacy alias resolves to its canonical name so one code has one counter.
    const canonical = await resolveRequested(v.name);
    const code = canonical.ok ? canonical.name : v.name;

    const { user } = await optionalUser(req);
    // A per-account field makes the answer private to this caller.
    noStore(res);
    return res.status(200).json({
      code,
      total: totals[code] || 0,
      like: !!(user && data.likes[likeKey(user.username, code)]),
    });
  }

  // ---------------- POST (toggle) ----------------
  const { user } = await requireUser(req, { verified: true });
  if (!(await enforce(req, res, 'likes', user.username)).allowed) return;
  noStore(res);

  const body = await readBody(req, { maxBytes: 2048 });
  // Only a published code can be liked, and the name is resolved through the
  // manifest so /c/demo, demo.html and a legacy alias cannot accumulate
  // separate counters.
  const rv = await resolveRequested(body.code);
  if (!rv.ok) throw new HttpError(rv.notFound ? 404 : 400, rv.error);
  const code = rv.name;

  const { data: man } = await readJson('data/manifest.json', { codes: [] });
  if (!(man.codes || []).some((c) => c.filename === code)) throw new HttpError(404, 'الكود غير موجود');

  const key = likeKey(user.username, code);
  let liked = false;
  let total = 0;

  await updateJson(PATH, { comments: [], likes: {}, reports: [], likeTotals: {} }, (data) => {
    if (!data.likes || typeof data.likes !== 'object') data.likes = {};
    if (data.likes[key]) delete data.likes[key];
    else data.likes[key] = new Date().toISOString();
    liked = !!data.likes[key];
    data.likeTotals = recomputeTotals(data.likes);
    total = data.likeTotals[code] || 0;
    return null;
  }, `likes: ${liked ? '+' : '-'}${code}`);

  res.status(200).json({ ok: true, code, like: liked, total });
});

module.exports.recomputeTotals = recomputeTotals;
module.exports.likeKey = likeKey;
