const { currentUser, readBody, isAdminEmail } = require('../_auth');
const { getSettings, saveSettings, DEFAULT_BANNED } = require('../_settings');

// GET  /api/settings            -> admin: full settings
// POST /api/settings { ... }    -> admin: update
module.exports = async (req, res) => {
  const me = await currentUser(req);
  if (!me || !isAdminEmail(me.email)) return res.status(403).json({ error: 'ممنوع' });
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ settings: await getSettings() });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await readBody(req);
    const cur = await getSettings();
    const pick = (k) => (body[k] === undefined ? cur[k] : !!body[k]);
    const next = {
      auto_approve: pick('auto_approve'),
      filter_enabled: pick('filter_enabled'),
      direct_delete: pick('direct_delete'),
      delete_requests_enabled: pick('delete_requests_enabled'),
      google_login_enabled: pick('google_login_enabled'),
      signup_enabled: pick('signup_enabled'),
      email_change_enabled: pick('email_change_enabled'),
      username_change_enabled: pick('username_change_enabled'),
      account_delete_enabled: pick('account_delete_enabled'),
      banned_words: Array.isArray(body.banned_words)
        ? body.banned_words.map((w) => String(w).trim()).filter(Boolean).slice(0, 400)
        : cur.banned_words,
    };
    if (!next.banned_words.length) next.banned_words = DEFAULT_BANNED;
    await saveSettings(next);
    res.status(200).json({ ok: true, settings: next });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
};
