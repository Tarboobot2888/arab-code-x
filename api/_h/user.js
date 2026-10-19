// GET /api/user?username=<u> — a public profile plus that member's approved codes.
//
// The response is built from an explicit allowlist of fields, so a record that
// gains a private column later cannot leak through this route. Email, phone,
// password hash, tokens, lock state and session version are never included.
const { loadUsers, findUser, isAdminEmail } = require('../_auth');
const { optionalUser } = require('../_guard');
const { readJson } = require('../_gh');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { STATUS } = require('../_moderation');

module.exports = wrap('user', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  const url = new URL(req.url, 'http://localhost');
  const username = String((req.query && req.query.username) || url.searchParams.get('username') || '');
  if (!username) throw new HttpError(400, 'username مطلوب');

  const { users } = await loadUsers();
  const u = findUser(users, username);
  if (!u) throw new HttpError(404, 'المستخدم غير موجود');

  const { user: me } = await optionalUser(req);
  const isSelf = !!(me && me.username.toLowerCase() === u.username.toLowerCase());
  const admin = isAdminEmail(u.email);

  const { data } = await readJson('data/manifest.json', { codes: [] });
  const codes = (data.codes || []).filter((c) => (
    c.author && c.author.toLowerCase() === u.username.toLowerCase()
    && (!c.status || c.status === STATUS.APPROVED)
  ));

  noStore(res); // includes is_self, so it must never be shared by a CDN
  res.status(200).json({
    user: {
      username: u.username,
      display_name: u.display_name || u.username,
      bio: u.bio || '',
      links: Array.isArray(u.links) ? u.links : [],
      avatar_url: u.avatar_url || null,
      banner_url: u.banner_url || null,
      location: u.location || '',
      website: u.website || '',
      created_at: u.created_at,
      is_admin: admin,
      is_verified_badge: admin || !!u.is_verified_badge,
    },
    codes,
    count: codes.length,
    is_self: isSelf,
    pending: [],
  });
});
