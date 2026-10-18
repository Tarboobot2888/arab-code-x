// Reporting + pre-publish profanity check.
// POST /api/report-check  { text } -> { blocked, matched }   (warning before send)
// POST /api/report        { text } ->  stores report + notifies admin by mail
const { currentUser, isAdminEmail, readBody } = require('./_auth');
const { loadInteractions, saveInteractions, nextId, scanForCurses } = require('./_interact');
const { getSettings } = require('./_settings');
const { sendMail, shell, escapeHtml } = require('./_mail');

const route = {}; // filled below; keeps handler names distinct from helpers

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'mzmlzip@gmail.com').toLowerCase();
const SITE_URL = process.env.SITE_URL || process.env.APP_URL || 'https://monte-top-v.vercel.app';

async function notifyAdminReport(reporterName, text) {
  try {
    await sendMail({
      to: ADMIN_EMAIL,
      subject: '⚠️ بلاغ تعليق — ARAB code',
      html: shell(`
        <h2 style="margin:0 0 12px;color:#f2c675;font-size:20px;">بلاغ تعليق جديد ⚠️</h2>
        <p style="margin:0 0 10px;line-height:1.9;color:#d8c9a3;font-size:15px;">
          قام المستخدم <b style="color:#f2c675;">${escapeHtml(String(reporterName || 'مجهول'))}</b> بنشر تعليق
          يحتوي كلمات غير لائقة (تم تجاوز التحذير):
        </p>
        <blockquote style="margin:14px 0;padding:14px 18px;border-radius:12px;border-right:4px solid #e05252;background:#1a1212;color:#e8b7b7;font-size:14px;line-height:1.9;">
          ${escapeHtml(String(text || '').slice(0, 500))}
        </blockquote>
        <p style="margin:0 0 10px;color:#a08454;font-size:13px;">راجع تبويب «البلاغات» في لوحة الإدارة.</p>
      `),
    });
  } catch (e) {
    console.error('notifyAdminReport failed:', e && e.message);
  }
}

// Route registration wrapper: GET/POST dispatcher
route.reports = async (req, res) => {
  try {
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'سجّل دخول أولاً' });

    if (req.method === 'GET') {
      if (!isAdminEmail(me.email)) return res.status(403).json({ error: 'ممنوع' });
      const url = new URL(req.url, 'http://x');
      const onlyOpen = url.searchParams.get('status') !== 'all';
      const interaction = await loadInteractions();
      let list = [...(interaction.reports || [])];
      if (onlyOpen) list = list.filter((r) => r.status !== 'dismissed');
      list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return res.status(200).json({ reports: list.slice(0, 200) });
    }

    // POST
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'نص البلاغ مطلوب' });
    if (text.length > 1000) return res.status(400).json({ error: 'نص طويل جداً' });

    const settings = await getSettings();
    let blocked = false;
    if (settings.filter_enabled) {
      const matched = scanForCurses(text);
      if (matched) blocked = true;
    }

    if (!blocked) {
      const interaction = await loadInteractions();
      interaction.reports = interaction.reports || [];
      const report = {
        id: nextId(),
        reporter: me.username,
        reporter_display: me.display_name || me.username,
        reporter_avatar: me.avatar_url || null,
        reporter_email: me.email || null,
        text,
        created_at: new Date().toISOString(),
        status: 'open',
      };
      interaction.reports.unshift(report);
      await saveInteractions(interaction);
      await notifyAdminReport(me.display_name || me.username, text);
      return res.status(201).json({ report, blocked });
    }

    // blocked: send warning, do not store (admin still gets notified via 409 flow)
    const matched = scanForCurses(text);
    return res.status(409).json({
      blocked: true,
      matched,
      warning: 'التعليق يحتوي كلمات غير لائقة ولا يمكن نشره.',
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

route.reportCheck = async (req, res) => {
  try {
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'سجّل دخول أولاً' });
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    const settings = await getSettings();
    if (settings.filter_enabled) {
      const matched = scanForCurses(text);
      if (matched) {
        return res.status(409).json({
          blocked: true,
          matched,
          warning: 'تعليقك يحتوي كلمات غير لائقة. رجاءً عدّل التعليق قبل الإرسال.',
        });
      }
    }
    return res.status(200).json({ blocked: false });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

route.reportDismiss = async (req, res) => {
  try {
    const me = await currentUser(req);
    if (!me || !isAdminEmail(me.email)) return res.status(403).json({ error: 'ممنوع' });
    const body = await readBody(req);
    const interaction = await loadInteractions();
    const r = (interaction.reports || []).find((x) => x.id === body.id);
    if (!r) return res.status(404).json({ error: 'البلاغ غير موجود' });
    r.status = body.dismiss ? 'dismissed' : 'open';
    await saveInteractions(interaction);
    return res.status(200).json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

module.exports = route;
