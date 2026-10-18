const { getSettings } = require('../_settings');

// Public, non-sensitive flags the UI needs (no banned words, no admin data).
module.exports = async (req, res) => {
  try {
    const s = await getSettings();
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    res.status(200).json({
      settings: {
        direct_delete: s.direct_delete,
        delete_requests_enabled: s.delete_requests_enabled,
        auto_approve: s.auto_approve,
        google_login_enabled: s.google_login_enabled !== false,
        signup_enabled: s.signup_enabled !== false,
        email_change_enabled: s.email_change_enabled !== false,
        username_change_enabled: s.username_change_enabled !== false,
        account_delete_enabled: s.account_delete_enabled !== false,
      },
    });
  } catch (e) {
    res.status(200).json({ settings: { direct_delete: false, delete_requests_enabled: true, auto_approve: false, google_login_enabled: true, signup_enabled: true, email_change_enabled: true, username_change_enabled: true, account_delete_enabled: true } });
  }
};
