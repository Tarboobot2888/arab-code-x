// GET /api/moderation-log?limit= — admin-only audit trail of moderation
// decisions (plan 5.2 AuditLog, 9.2).
const { requireAdmin } = require('../_guard');
const { readLog } = require('../_moderation');
const { wrap, methodGuard, noStore } = require('../_http');

module.exports = wrap('moderation-log', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  await requireAdmin(req, { csrf: false });
  noStore(res);
  const limit = Math.min(500, Math.max(1, parseInt(new URL(req.url, 'http://localhost').searchParams.get('limit') || '200', 10) || 200));
  res.status(200).json({ entries: await readLog(limit) });
});
