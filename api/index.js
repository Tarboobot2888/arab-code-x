// Single dispatcher — keeps the project under Vercel Hobby's 12-function cap.
//
// Added here (plan: 5.1 middleware row, APP-09):
//   * A configuration gate: if required environment variables are missing the
//     router answers 503 with a generic message instead of running on insecure
//     fallbacks. Health and the static sitemap stay reachable so an operator can
//     see what is wrong.
//   * A request id on every response and uniform error shapes; internal
//     exception text never reaches the client.
//   * /sitemap.xml is served by a handler (the static file listed a page that
//     did not exist — APP-04).
const { requireConfigured, config } = require('./_config');
const { requestId } = require('./_http');

const routes = {
  // --- identity -----------------------------------------------------------
  login: require('./_h/login'),
  signup: require('./_h/signup'),
  logout: require('./_h/logout'),
  me: require('./_h/me'),
  verify: require('./_h/verify'),
  'resend-verification': require('./_h/resend-verification'),
  'forgot-password': require('./_h/forgot-password'),
  'reset-password': require('./_h/reset-password'),
  google: require('./_h/google').start,
  'google-callback': require('./_h/google').callback,
  'change-email': require('./_h/account').changeEmail,
  'confirm-email': require('./_h/account').confirmEmail,
  'change-username': require('./_h/account').changeUsername,
  'delete-account': require('./_h/account').deleteAccount,

  // --- content ------------------------------------------------------------
  list: require('./_h/list'),
  search: require('./_h/search'),
  raw: require('./_h/raw'),
  submit: require('./_h/submit'),
  'quality-check': require('./_h/quality-check'),
  approve: require('./_h/approve'),
  reject: require('./_h/reject'),
  pending: require('./_h/pending'),
  'delete-code': require('./_h/delete-code'),
  'delete-request': require('./_h/delete-request'),
  'delete-requests': require('./_h/delete-requests'),
  'resolve-delete': require('./_h/resolve-delete'),

  // --- profiles -----------------------------------------------------------
  user: require('./_h/user'),
  'update-profile': require('./_h/update-profile'),
  'upload-avatar': require('./_h/upload-avatar'),

  // --- interactions -------------------------------------------------------
  comments: require('./_h/comments'),
  likes: require('./_h/likes'),
  'report-check': require('./_report').reportCheck,
  reports: require('./_report').reports,
  'report-dismiss': require('./_report').reportDismiss,
  messages: require('./_h/messages'),

  // --- archives -----------------------------------------------------------
  zips: require('./_h/zips').list,
  zip: require('./_h/zips').get,
  'zip-upload': require('./_h/zips').upload,
  'zip-publish': require('./_h/zips').publish,
  'zip-delete': require('./_h/zips').del,

  // --- administration -----------------------------------------------------
  users: require('./_h/users'),
  settings: require('./_h/settings'),
  'public-settings': require('./_h/public-settings'),
  'toggle-verify': require('./_h/toggle-verify'),
  ban: require('./_h/ban'),
  broadcast: require('./_h/broadcast'),
  stats: require('./_h/stats'),
  'moderation-log': require('./_h/moderation-log'),

  // --- operations ---------------------------------------------------------
  health: require('./_h/health'),
  sitemap: require('./_h/sitemap'),
};

// Routes that must answer even when the configuration is incomplete, so an
// operator can diagnose the deployment.
const ALWAYS_AVAILABLE = new Set(['health', 'sitemap']);

/** Map an incoming path to a route name. */
function routeNameFor(pathname) {
  if (pathname === '/sitemap.xml') return 'sitemap';
  const p = pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  if (!p || p === 'index' || p === '/api' || p === '/') return 'me';
  return p;
}

module.exports = async (req, res) => {
  const rid = requestId(req);
  try {
    res.setHeader('X-Request-Id', rid);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const name = routeNameFor(url.pathname);
    const h = routes[name];
    if (!h) return res.status(404).json({ error: 'Not found', request_id: rid });

    if (!ALWAYS_AVAILABLE.has(name) && !requireConfigured(res)) return undefined;

    return await h(req, res);
  } catch (e) {
    // Last-resort handler. Individual routes are wrapped already; anything that
    // lands here is logged with the id and answered generically.
    // eslint-disable-next-line no-console
    console.error(`[router][rid=${rid}]`, e && e.stack ? e.stack : e);
    if (res.headersSent) return undefined;
    const status = Number.isInteger(e && e.status) && e.status >= 400 && e.status < 600 ? e.status : 500;
    return res.status(status).json({
      error: e && e.expose && e.message ? e.message : 'حدث خطأ غير متوقع، حاول لاحقاً',
      request_id: rid,
    });
  }
};

module.exports.routes = routes;
module.exports.routeNameFor = routeNameFor;
module.exports.ALWAYS_AVAILABLE = ALWAYS_AVAILABLE;
module.exports._config = config;
