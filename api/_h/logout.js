const { clearSessionCookie } = require('../_auth');
const { wrap, methodGuard, noStore } = require('../_http');

// POST is the correct method for a state change, but GET stays accepted so an
// existing link cannot break; neither path can log anyone else out because the
// only thing it does is clear the caller's own cookie.
module.exports = wrap('logout', async (req, res) => {
  if (!methodGuard(req, res, ['POST', 'GET'])) return;
  noStore(res);
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
});
