const { currentUser, loadUsers, isAdminEmail } = require('../_auth');
const { readJson } = require('../_gh');

// GET /api/stats — admin dashboard numbers.
module.exports = async (req, res) => {
  const me = await currentUser(req);
  if (!me || !isAdminEmail(me.email)) return res.status(403).json({ error: 'ممنوع' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { users } = await loadUsers();
    const { data: man } = await readJson('data/manifest.json', { codes: [] });
    const { data: pend } = await readJson('data/pending.json', { items: [] });
    const { data: dels } = await readJson('data/delete-requests.json', { items: [] });
    const codes = man.codes || [];
    const byLang = {};
    codes.forEach((c) => { const l = c.language || 'txt'; byLang[l] = (byLang[l] || 0) + 1; });
    const week = Date.now() - 7 * 864e5;
    res.status(200).json({
      stats: {
        users: users.length,
        verified_users: users.filter((u) => u.is_verified_badge).length,
        google_users: users.filter((u) => u.provider === 'google').length,
        unconfirmed_users: users.filter((u) => !u.verified).length,
        codes: codes.length,
        pending: (pend.items || []).filter((i) => i.status === 'pending' || !i.status).length,
        delete_requests: (dels.items || []).filter((i) => i.status === 'pending' || !i.status).length,
        new_users_week: users.filter((u) => u.created_at && Date.parse(u.created_at) > week).length,
        new_codes_week: codes.filter((c) => c.published_at && Date.parse(c.published_at) > week).length,
        top_languages: Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 6),
      },
    });
  } catch (e) {
    console.error('stats error', e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
};
