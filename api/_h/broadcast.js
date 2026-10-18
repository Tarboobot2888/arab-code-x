const { currentUser, loadUsers, isAdminEmail, readBody } = require('../_auth');
const { sendBroadcast } = require('../_mail');

// POST /api/broadcast
// { subject, heading, body, target: 'all'|'verified'|'unverified'|'custom', emails?: [], offset?, limit?, test? }
// Sends one private email per recipient (no shared To/BCC). Batched so serverless never times out.
module.exports = async (req, res) => {
  const me = await currentUser(req);
  if (!me || !isAdminEmail(me.email)) return res.status(403).json({ error: 'ممنوع' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const b = await readBody(req);
    const subject = String(b.subject || '').trim();
    const body = String(b.body || '').trim();
    const heading = String(b.heading || '').trim();
    if (!subject) return res.status(400).json({ error: 'عنوان الرسالة مطلوب' });
    if (!body) return res.status(400).json({ error: 'نص الرسالة مطلوب' });

    // Test send goes only to the admin.
    if (b.test) {
      await sendBroadcast({ to: me.email, subject: '[تجربة] ' + subject, heading, body, username: me.username });
      return res.status(200).json({ ok: true, test: true, sent: 1 });
    }

    const { users } = await loadUsers();
    const target = b.target || 'all';
    let list = users.filter((u) => u.email && u.verified !== false);
    if (target === 'verified') list = list.filter((u) => u.is_verified_badge || isAdminEmail(u.email));
    else if (target === 'unverified') list = list.filter((u) => !u.is_verified_badge && !isAdminEmail(u.email));
    else if (target === 'custom') {
      // Free-form list: registered members keep their name, unknown addresses
      // still receive the same branded email.
      const wanted = [...new Set(
        (Array.isArray(b.emails) ? b.emails : String(b.emails || '').split(/[\s,;]+/))
          .map((e) => String(e).trim().toLowerCase())
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      )];
      if (!wanted.length) return res.status(400).json({ error: 'أضف إيميل واحد على الأقل' });
      const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]));
      list = wanted.map((e) => byEmail.get(e) || { email: e, username: e.split('@')[0] });
    }

    const offset = Math.max(0, parseInt(b.offset || 0, 10) || 0);
    const limit = Math.min(25, Math.max(1, parseInt(b.limit || 15, 10) || 15));
    const slice = list.slice(offset, offset + limit);

    let sent = 0;
    const failed = [];
    for (const u of slice) {
      try {
        await sendBroadcast({ to: u.email, subject, heading, body, username: u.display_name || u.username });
        sent++;
      } catch (e) {
        console.error('broadcast fail', u.email, e && e.message);
        failed.push(u.email);
      }
    }

    const next = offset + slice.length;
    res.status(200).json({
      ok: true,
      total: list.length,
      sent,
      failed,
      next: next < list.length ? next : null,
      done: next >= list.length,
    });
  } catch (e) {
    console.error('broadcast error:', e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
};
