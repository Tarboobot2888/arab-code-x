// Joins stored code entries with the LIVE user record so avatars and verified
// badges are never stale snapshots.
//
// APP-03: trust markers come from the account record and the configured admin
// address only. No username is ever special-cased (app.js used to grant the
// admin badge to whoever was called "ziad").
const { loadUsers, isAdminEmail } = require('./_auth');

async function userMap() {
  const { users } = await loadUsers();
  const m = new Map();
  for (const u of users) m.set(String(u.username || '').toLowerCase(), u);
  return m;
}

function liveAuthor(entry, u) {
  if (!u) {
    // Unknown author (deleted account): never inherit a badge from the snapshot.
    return { ...entry, author_verified: false, author_is_admin: false, admin_added: !!entry.admin_added };
  }
  const admin = isAdminEmail(u.email);
  return {
    ...entry,
    author: u.username,
    author_display: u.display_name || u.username,
    author_avatar: u.avatar_url || null,
    author_verified: admin || !!u.is_verified_badge,
    author_is_admin: admin,
    admin_added: !!entry.admin_added || admin,
  };
}

async function enrichCodes(codes) {
  const m = await userMap();
  return (codes || []).map((c) => liveAuthor(c, m.get(String(c.author || '').toLowerCase())));
}

module.exports = { enrichCodes, userMap, liveAuthor };
