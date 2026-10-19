// POST /api/broadcast — admin mass mail, one private message per recipient.
// Batched so a serverless invocation never times out.
const { readBody, loadUsers, isAdminEmail } = require('../_auth');
const { requireAdmin } = require('../_guard');
const { sendBroadcast } = require('../_mail');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { logDecision } = require('../_moderation');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = wrap('broadcast', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user: me } = await requireAdmin(req);
  if (!(await enforce(req, res, 'broadcast', me.username)).allowed) return;

  const b = await readBody(req, { maxBytes: 128 * 1024 });
  const subject = String(b.subject || '').trim().slice(0, 200);
  const body = String(b.body || '').trim().slice(0, 20000);
  const heading = String(b.heading || '').trim().slice(0, 200);
  if (!subject) throw new HttpError(400, 'عنوان الرسالة مطلوب');
  if (!body) throw new HttpError(400, 'نص الرسالة مطلوب');

  if (b.test) {
    await sendBroadcast({ to: me.email, subject: `[تجربة] ${subject}`, heading, body, username: me.username });
    return res.status(200).json({ ok: true, test: true, sent: 1 });
  }

  const { users } = await loadUsers();
  const target = ['all', 'verified', 'unverified', 'custom'].includes(b.target) ? b.target : 'all';
  let list = users.filter((u) => u.email && u.verified !== false);
  if (target === 'verified') list = list.filter((u) => u.is_verified_badge || isAdminEmail(u.email));
  else if (target === 'unverified') list = list.filter((u) => !u.is_verified_badge && !isAdminEmail(u.email));
  else if (target === 'custom') {
    const wanted = [...new Set(
      (Array.isArray(b.emails) ? b.emails : String(b.emails || '').split(/[\s,;]+/))
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => EMAIL_RE.test(e)),
    )].slice(0, 2000);
    if (!wanted.length) throw new HttpError(400, 'أضف إيميل واحد على الأقل');
    const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]));
    list = wanted.map((e) => byEmail.get(e) || { email: e, username: e.split('@')[0] });
  }

  const offset = Math.max(0, parseInt(b.offset, 10) || 0);
  const limit = Math.min(25, Math.max(1, parseInt(b.limit, 10) || 15));
  const slice = list.slice(offset, offset + limit);

  let sent = 0;
  const failed = [];
  for (const u of slice) {
    try {
      await sendBroadcast({ to: u.email, subject, heading, body, username: u.display_name || u.username });
      sent += 1;
    } catch (e) {
      // Log the username, not the address, so the server log holds less PII.
      // eslint-disable-next-line no-console
      console.error('[broadcast] send failed for', u.username || 'unknown-recipient', ':', e.message);
      failed.push(u.username || 'unknown');
    }
  }

  const next = offset + slice.length;
  if (offset === 0) {
    await logDecision({
      actor: me.username, action: 'broadcast', target: `audience:${target}`,
      meta: { recipients: list.length, subject_length: subject.length },
    });
  }
  res.status(200).json({
    ok: true, total: list.length, sent, failed,
    next: next < list.length ? next : null,
    done: next >= list.length,
  });
});
