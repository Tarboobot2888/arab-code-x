// Single dispatcher — keeps us under Vercel Hobby's 12-function cap
const routes = {
  login: require('./_h/login'),
  signup: require('./_h/signup'),
  logout: require('./_h/logout'),
  me: require('./_h/me'),
  list: require('./_h/list'),
  search: require('./_h/search'),
  submit: require('./_h/submit'),
  approve: require('./_h/approve'),
  reject: require('./_h/reject'),
  pending: require('./_h/pending'),
  user: require('./_h/user'),
  verify: require('./_h/verify'),
  'forgot-password': require('./_h/forgot-password'),
  'reset-password': require('./_h/reset-password'),
  'update-profile': require('./_h/update-profile'),
  'upload-avatar': require('./_h/upload-avatar'),
  'delete-request': require('./_h/delete-request'),
  'delete-requests': require('./_h/delete-requests'),
  'resolve-delete': require('./_h/resolve-delete'),
  'delete-code': require('./_h/delete-code'),
  users: require('./_h/users'),
  settings: require('./_h/settings'),
  'public-settings': require('./_h/public-settings'),
  'toggle-verify': require('./_h/toggle-verify'),
  raw: require('./_h/raw'),
  broadcast: require('./_h/broadcast'),
  stats: require('./_h/stats'),
  'change-email': require('./_h/account').changeEmail,
  'confirm-email': require('./_h/account').confirmEmail,
  'change-username': require('./_h/account').changeUsername,
  'delete-account': require('./_h/account').deleteAccount,
  google: require('./_h/google').start,
  'google-callback': require('./_h/google').callback,
  // --- New experiment features ---
  comments: require('./_h/comments'),

  'report-check': require('./_report').reportCheck,
  reports: require('./_report').reports,
  'report-dismiss': require('./_report').reportDismiss,
  ban: require('./_h/ban'),
  messages: require('./_h/messages'),
  zips: require('./_h/zips').list,
  zip: require('./_h/zips').get,
  'zip-upload': require('./_h/zips').upload,
  'zip-publish': require('./_h/zips').publish,
  'zip-delete': require('./_h/zips').del,

};

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let p = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
    if (!p || p === 'index') p = 'me';
    const h = routes[p];
    if (!h) return res.status(404).json({ error: 'Not found: ' + p });
    return await h(req, res);
  } catch (e) {
    console.error('router error:', e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e && e.message ? e.message : 'unknown') });
  }
};
