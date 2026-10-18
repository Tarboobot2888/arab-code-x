const { currentUser, publicUser } = require('../_auth');
const { readJson } = require('../_gh');
const BANS_PATH = 'data/bans.json';
module.exports = async (req, res) => {
  const u = await currentUser(req);
  const out = { user: publicUser(u) };
  if (u) {
    try {
      const { data } = await readJson(BANS_PATH, {});
      const b = data[String(u.username).toLowerCase()] || null;
      if (b && b.banned) {
        out.ban = { reason: b.reason || 'أسباب أمنية', banned_at: b.banned_at };
      }
    } catch (e) {
      console.error('ban check failed:', e && e.message);
    }
  }
  res.status(200).json(out);
};
