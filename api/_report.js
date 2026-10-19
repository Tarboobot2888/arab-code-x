// Reporting + the pre-send profanity check.
//
//   POST /api/report-check  { text }      -> { blocked, matched }
//   GET  /api/reports                     -> admin: open reports
//   POST /api/reports       { text, code }-> store a report + notify the admin
//   POST /api/report-dismiss{ id, dismiss }
//
// Fixes:
//   * scanForCurses is async. The audited code called it WITHOUT await, so the
//     returned Promise was always truthy and every report was "blocked" while
//     filter_enabled was on — reports could not be filed at all. Now awaited.
//   * The stale fallback admin address and the old vercel.app domain are gone;
//     both come from the validated config (APP-05, APP-09).
//   * Banned members cannot file reports; rate limits apply.
//   * The reporter's email is no longer copied into the report record — the
//     admin UI resolves it from the account when needed.
const { readBody } = require('./_auth');
const { requireUser, requireAdmin } = require('./_guard');
const { updateJson, SKIP_WRITE } = require('./_gh');
const { loadInteractions, nextId, scanForCurses } = require('./_interact');
const { getSettings } = require('./_settings');
const { sendMail, shell, escapeHtml } = require('./_mail');
const { config, baseUrl } = require('./_config');
const { wrap, methodGuard, HttpError, noStore } = require('./_http');
const { enforce } = require('./_ratelimit');
const { logDecision } = require('./_moderation');

const PATH = 'data/interactions.json';
const MAX_TEXT = 1000;

async function notifyAdminReport(req, reporterName, text) {
  const admin = config().adminEmail;
  if (!admin) return;
  try {
    await sendMail({
      to: admin,
      subject: '⚠️ بلاغ جديد — ARAB code',
      html: shell(`
        <h2 style="margin:0 0 12px;color:#f2c675;font-size:20px;">بلاغ جديد ⚠️</h2>
        <p style="margin:0 0 10px;line-height:1.9;color:#d8c9a3;font-size:15px;">
          أرسل المستخدم <b style="color:#f2c675;">${escapeHtml(String(reporterName || 'مجهول'))}</b> بلاغاً:
        </p>
        <blockquote style="margin:14px 0;padding:14px 18px;border-radius:12px;border-right:4px solid #e05252;background:#1a1212;color:#e8b7b7;font-size:14px;line-height:1.9;">
          ${escapeHtml(String(text || '').slice(0, 500))}
        </blockquote>
        <p style="margin:0 0 10px;color:#a08454;font-size:13px;">
          راجع تبويب «البلاغات» في <a href="${baseUrl(req)}/admin" style="color:#f2c675;">لوحة الإدارة</a>.
        </p>
      `),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[report] admin notification failed:', e.message);
  }
}

const reports = wrap('reports', async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  noStore(res);

  // ---------------- GET: admin list ----------------
  if (req.method === 'GET') {
    await requireAdmin(req, { csrf: false });
    const url = new URL(req.url, 'http://localhost');
    const onlyOpen = url.searchParams.get('status') !== 'all';
    const interactions = await loadInteractions();
    let list = [...(interactions.reports || [])];
    if (onlyOpen) list = list.filter((r) => r.status !== 'dismissed');
    list.sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1));
    return res.status(200).json({ reports: list.slice(0, 200) });
  }

  // ---------------- POST: file a report ----------------
  const { user } = await requireUser(req, { verified: true });
  if (!(await enforce(req, res, 'reports', user.username)).allowed) return;

  const body = await readBody(req, { maxBytes: 8192 });
  const text = String(body.text || '').trim();
  if (!text) throw new HttpError(400, 'نص البلاغ مطلوب');
  if (text.length > MAX_TEXT) throw new HttpError(400, 'نص طويل جداً');

  const settings = await getSettings();
  if (settings.filter_enabled) {
    const matched = await scanForCurses(text);
    if (matched) {
      return res.status(409).json({
        blocked: true,
        matched,
        warning: 'نص البلاغ يحتوي كلمات غير لائقة ولا يمكن إرساله.',
      });
    }
  }

  const report = {
    id: nextId(),
    reporter: user.username,
    reporter_display: user.display_name || user.username,
    reporter_avatar: user.avatar_url || null,
    // reporter_email intentionally omitted — the admin view resolves it from the
    // account, so the interactions file holds one less copy of personal data.
    code: typeof body.code === 'string' ? body.code.slice(0, 80) : null,
    text,
    created_at: new Date().toISOString(),
    status: 'open',
  };

  await updateJson(PATH, { comments: [], likes: {}, reports: [] }, (data) => {
    if (!Array.isArray(data.reports)) data.reports = [];
    data.reports.unshift(report);
    return null;
  }, 'interactions: +report');

  await notifyAdminReport(req, report.reporter_display, text);
  res.status(201).json({ report, blocked: false });
});

const reportCheck = wrap('report-check', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user } = await requireUser(req, { verified: true });
  if (!(await enforce(req, res, 'reports', user.username)).allowed) return;

  const body = await readBody(req, { maxBytes: 8192 });
  const text = String(body.text || '').trim();
  const settings = await getSettings();
  if (settings.filter_enabled) {
    const matched = await scanForCurses(text);
    if (matched) {
      return res.status(409).json({
        blocked: true,
        matched,
        warning: 'النص يحتوي كلمات غير لائقة. رجاءً عدّله قبل الإرسال.',
      });
    }
  }
  res.status(200).json({ blocked: false });
});

const reportDismiss = wrap('report-dismiss', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user } = await requireAdmin(req);
  if (!(await enforce(req, res, 'admin-write', user.username)).allowed) return;

  const body = await readBody(req, { maxBytes: 2048 });
  const id = String(body.id || '');
  if (!id) throw new HttpError(400, 'معرّف البلاغ مطلوب');

  let found = false;
  const dismiss = !!body.dismiss;
  await updateJson(PATH, { comments: [], likes: {}, reports: [] }, (data) => {
    const r = (data.reports || []).find((x) => x.id === id);
    if (!r) return SKIP_WRITE;
    found = true;
    r.status = dismiss ? 'dismissed' : 'open';
    r.resolved_at = dismiss ? new Date().toISOString() : null;
    r.resolved_by = dismiss ? user.username : null;
    return null;
  }, `interactions: report ${dismiss ? 'dismissed' : 'reopened'}`);

  if (!found) throw new HttpError(404, 'البلاغ غير موجود');
  await logDecision({
    actor: user.username,
    action: dismiss ? 'report-dismiss' : 'report-reopen',
    target: `report:${id}`,
  });
  res.status(200).json({ ok: true });
});

module.exports = { reports, reportCheck, reportDismiss };
