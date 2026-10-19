// POST /api/toggle-verify { username, verified } — admin grants/revokes the
// verified badge. The badge is never derived from a username on the client
// (APP-03): it lives on the record and only an admin can change it.
const { readBody, updateUsers, findUser, publicUser, isAdminEmail } = require('../_auth');
const { requireAdmin } = require('../_guard');
const { SKIP_WRITE } = require('../_gh');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { logDecision } = require('../_moderation');

module.exports = wrap('toggle-verify', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user: me } = await requireAdmin(req);
  if (!(await enforce(req, res, 'admin-write', me.username)).allowed) return;

  const { username, verified } = await readBody(req, { maxBytes: 2048 });
  if (!username) throw new HttpError(400, 'username مطلوب');

  let out = null;
  let missing = false;
  let isAdminTarget = false;
  await updateUsers((data) => {
    const u = findUser(data.users, username);
    if (!u) { missing = true; return SKIP_WRITE; }
    if (isAdminEmail(u.email)) { isAdminTarget = true; return SKIP_WRITE; }
    u.is_verified_badge = !!verified;
    u.badge_changed_at = new Date().toISOString();
    u.badge_changed_by = me.username;
    out = publicUser(u);
    return null;
  }, `verify: ${username} = ${!!verified}`);

  if (missing) throw new HttpError(404, 'المستخدم غير موجود');
  if (isAdminTarget) throw new HttpError(400, 'لا يمكن تعديل حساب الأدمن');

  await logDecision({
    actor: me.username, action: verified ? 'badge-grant' : 'badge-revoke',
    target: `user:${username}`,
  });
  res.status(200).json({ ok: true, user: out });
});
