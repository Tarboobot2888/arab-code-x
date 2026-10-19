const { publicUser } = require('../_auth');
const { optionalUser } = require('../_guard');
const { wrap, methodGuard, noStore } = require('../_http');

// GET /api/me — the session's own identity. This is the one route that reports a
// ban instead of refusing, so the UI can explain the situation; every other
// route refuses a banned caller in _guard.js.
module.exports = wrap('me', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  noStore(res); // per-account response — never cacheable by a CDN
  const { user, ban } = await optionalUser(req);
  const out = { user: publicUser(user) };
  if (user && ban) out.ban = { reason: ban.reason, banned_at: ban.banned_at };
  res.status(200).json(out);
});
