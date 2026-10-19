// GET    /api/comments?code=<filename>  — comments on a code
// POST   /api/comments { code, text, line }
// DELETE /api/comments { id }            — author or admin
//
// Fixes: the ban check now runs (a banned member used to be able to comment by
// calling the API directly — SEC-05), the comment is bound to a real published
// code, the text length and rate are limited, and the stored record keeps no
// HTML (the client renders it with textContent / escaping).
const { readBody, isAdminEmail } = require('../_auth');
const { requireUser, optionalUser } = require('../_guard');
const { readJson, updateJson, SKIP_WRITE } = require('../_gh');
const { loadInteractions, nextId, scanForCurses } = require('../_interact');
const { getSettings } = require('../_settings');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { validateRequestedName } = require('../_content');
const { resolveRequested } = require('../_resolve');

const PATH = 'data/interactions.json';
const MAX_TEXT = 1000;
const MAX_LISTED = 200;

module.exports = wrap('comments', async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST', 'DELETE'])) return;

  // ---------------- POST ----------------
  if (req.method === 'POST') {
    const { user } = await requireUser(req, { verified: true });
    if (!(await enforce(req, res, 'comments', user.username)).allowed) return;
    noStore(res);

    const body = await readBody(req, { maxBytes: 8192 });
    const text = String(body.text || '').trim();
    if (!text) throw new HttpError(400, 'التعليق مطلوب');
    if (text.length > MAX_TEXT) throw new HttpError(400, `التعليق طويل جداً (حد أقصى ${MAX_TEXT} حرف)`);

    const rv = await resolveRequested(body.code);
    if (!rv.ok) throw new HttpError(rv.notFound ? 404 : 400, rv.error);
    const code = rv.name;

    const { data: man } = await readJson('data/manifest.json', { codes: [] });
    if (!(man.codes || []).some((c) => c.filename === code)) throw new HttpError(404, 'الكود غير موجود');

    const settings = await getSettings();
    if (settings.filter_enabled) {
      // scanForCurses is async — the audited report handler called it without
      // await, which made its result always truthy. Awaited here and in _report.
      const curses = await scanForCurses(text);
      if (curses) {
        return res.status(409).json({
          warning: true,
          matched: curses,
          message: 'تعليقك يحتوي كلمات غير لائقة. عدّله قبل الإرسال.',
        });
      }
    }

    let line = null;
    if (body.line != null) {
      const n = Number(body.line);
      if (Number.isFinite(n) && n >= 1 && n <= 1000000) line = Math.floor(n);
    }

    const entry = {
      id: nextId(),
      code,
      author: user.username,
      display_name: user.display_name || user.username,
      avatar_url: user.avatar_url || null,
      is_verified_badge: isAdminEmail(user.email) || !!user.is_verified_badge,
      text,
      line,
      created_at: new Date().toISOString(),
    };

    await updateJson(PATH, { comments: [], likes: {}, reports: [] }, (data) => {
      if (!Array.isArray(data.comments)) data.comments = [];
      data.comments.unshift(entry);
      return null;
    }, 'interactions: +comment');

    return res.status(201).json({ comment: entry });
  }

  // ---------------- DELETE ----------------
  if (req.method === 'DELETE') {
    const ctx = await requireUser(req, { verified: true });
    noStore(res);
    const body = await readBody(req, { maxBytes: 2048 });
    const id = String(body.id || '');
    if (!id) throw new HttpError(400, 'معرّف التعليق مطلوب');

    let found = false;
    let denied = false;
    await updateJson(PATH, { comments: [], likes: {}, reports: [] }, (data) => {
      if (!Array.isArray(data.comments)) data.comments = [];
      const idx = data.comments.findIndex((c) => c.id === id);
      if (idx === -1) return SKIP_WRITE;
      found = true;
      const owner = String(data.comments[idx].author || '').toLowerCase();
      if (owner !== String(ctx.user.username).toLowerCase() && !ctx.isAdmin) {
        denied = true;
        return SKIP_WRITE;
      }
      data.comments.splice(idx, 1);
      return null;
    }, 'interactions: -comment');

    if (!found) throw new HttpError(404, 'التعليق غير موجود');
    if (denied) throw new HttpError(403, 'ممنوع');
    return res.status(200).json({ ok: true });
  }

  // ---------------- GET ----------------
  const url = new URL(req.url, 'http://localhost');
  const requested = url.searchParams.get('code') || '';
  const interactions = await loadInteractions();
  let list = interactions.comments;
  if (requested) {
    const v = validateRequestedName(requested);
    if (!v.ok) throw new HttpError(400, 'اسم الكود غير صالح');
    const canonical = (await resolveRequested(v.name));
    const key = canonical.ok ? canonical.name : v.name;
    // Comments written before the APP-07 rename are keyed by the old name.
    list = list.filter((c) => c.code === key || c.code === v.name);
  }
  // Comments are public, but the response is tied to no account, so a short
  // shared cache is safe. Admin/owner-only data is never included.
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
  await optionalUser(req); // keeps behaviour uniform; no privileged fields are added
  res.status(200).json({ comments: list.slice(0, MAX_LISTED) });
});
