// GET /api/stats — admin dashboard numbers.
//
// APP-02: the audited version read data/pending.json and data/delete-requests.json,
// neither of which exists. Pending contributions are files under pending/ and
// delete requests live in data/delete_requests.json (underscore). It also counted
// new_codes_week from `published_at` while the manifest only ever stored
// `approved_at`, so that figure was always 0. All three sources are corrected
// here and covered by tests.
const { loadUsers } = require('../_auth');
const { requireAdmin } = require('../_guard');
const { readJson, listDir } = require('../_gh');
const { wrap, methodGuard, noStore } = require('../_http');
const { STATUS } = require('../_moderation');
const { recomputeTotals } = require('./likes');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Accepts either timestamp field so old and new manifest rows both count. */
function publishedAt(code) {
  return code.published_at || code.approved_at || null;
}

function isPending(item) {
  const s = String(item && item.status ? item.status : STATUS.PENDING).toLowerCase();
  return s === STATUS.PENDING;
}

module.exports = wrap('stats', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  await requireAdmin(req);
  noStore(res);

  const [{ users }, man, dels, interactions, pendingDir] = await Promise.all([
    loadUsers(),
    readJson('data/manifest.json', { codes: [] }).then((r) => r.data),
    // Correct path: underscore, matching what delete-request.js writes.
    readJson('data/delete_requests.json', { items: [] }).then((r) => r.data),
    readJson('data/interactions.json', { comments: [], likes: {}, reports: [] }).then((r) => r.data),
    // Pending contributions are one JSON file each under pending/.
    listDir('pending'),
  ]);

  const codes = Array.isArray(man.codes) ? man.codes : [];
  const week = Date.now() - WEEK_MS;

  const byLang = {};
  codes.forEach((c) => {
    const l = c.language || 'txt';
    byLang[l] = (byLang[l] || 0) + 1;
  });

  const pendingCount = (Array.isArray(pendingDir) ? pendingDir : [])
    .filter((f) => f && f.name && f.name.endsWith('.json')).length;

  const deleteItems = Array.isArray(dels.items) ? dels.items : [];
  const likeTotals = recomputeTotals(interactions.likes || {});

  res.status(200).json({
    stats: {
      users: users.length,
      verified_users: users.filter((u) => u.is_verified_badge).length,
      google_users: users.filter((u) => u.provider === 'google').length,
      unconfirmed_users: users.filter((u) => !u.verified).length,
      locked_users: users.filter((u) => Number(u.lock_until) > Date.now()).length,
      codes: codes.length,
      executable_codes: codes.filter((c) => c.executable).length,
      pending: pendingCount,
      delete_requests: deleteItems.filter(isPending).length,
      comments: Array.isArray(interactions.comments) ? interactions.comments.length : 0,
      open_reports: (Array.isArray(interactions.reports) ? interactions.reports : [])
        .filter((r) => r.status !== 'dismissed').length,
      likes: Object.values(likeTotals).reduce((a, b) => a + b, 0),
      new_users_week: users.filter((u) => u.created_at && Date.parse(u.created_at) > week).length,
      new_codes_week: codes.filter((c) => {
        const at = publishedAt(c);
        return at && Date.parse(at) > week;
      }).length,
      top_languages: Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 6),
    },
  });
});

module.exports.publishedAt = publishedAt;
module.exports.isPending = isPending;
