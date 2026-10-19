// GET /api/public-settings — the non-sensitive flags the UI needs.
// Never exposes banned words, admin data or any secret.
const { getSettings } = require('../_settings');
const { wrap, methodGuard } = require('../_http');

const SAFE_DEFAULTS = {
  direct_delete: false,
  delete_requests_enabled: true,
  auto_approve: false,
  google_login_enabled: true,
  signup_enabled: true,
  email_change_enabled: true,
  username_change_enabled: true,
  account_delete_enabled: true,
};

module.exports = wrap('public-settings', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
  try {
    const s = await getSettings();
    const out = {};
    for (const k of Object.keys(SAFE_DEFAULTS)) out[k] = s[k] !== false;
    // These two are "off by default" flags, not "on by default".
    out.direct_delete = !!s.direct_delete;
    out.auto_approve = !!s.auto_approve;
    res.status(200).json({ settings: out });
  } catch (e) {
    // Fail safe: the UI falls back to the most restrictive view.
    // eslint-disable-next-line no-console
    console.error('[public-settings] falling back to safe defaults:', e.message);
    res.status(200).json({ settings: { ...SAFE_DEFAULTS } });
  }
});
