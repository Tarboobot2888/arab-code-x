// POST /api/update-profile — self-service profile fields.
//
// Fixes: atomic write (SEC-08), ban enforced (SEC-05), bounded body, and every
// URL field restricted to https with a length cap so nothing can smuggle a
// javascript:/data: URL into the rendered profile (APP-08).
const { readBody, updateUsers, findUser } = require('../_auth');
const { requireUser } = require('../_guard');
const { SKIP_WRITE } = require('../_gh');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { isProviderUrl } = require('../_uploads');

const HTTPS_RE = /^https:\/\/[^\s<>"']{4,300}$/i;
const MAILTO_RE = /^mailto:[^\s<>"']{5,200}$/i;

function checkUrl(value, label) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (!HTTPS_RE.test(v)) throw new HttpError(400, `${label} يجب أن يبدأ بـ https://`);
  return v;
}

module.exports = wrap('update-profile', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user } = await requireUser(req, { verified: true });

  const body = await readBody(req, { maxBytes: 32 * 1024 });
  let profile = null;
  let missing = false;

  await updateUsers((data) => {
    const rec = findUser(data.users, user.username);
    if (!rec) { missing = true; return SKIP_WRITE; }

    if ('avatar_url' in body) {
      const v = checkUrl(body.avatar_url, 'رابط الصورة');
      // An avatar must come from our own upload route, so a profile cannot be
      // used to beacon viewers to an arbitrary third-party host.
      if (v && !isProviderUrl(v)) throw new HttpError(400, 'ارفع الصورة من المنصة بدل لصق رابط خارجي');
      rec.avatar_url = v || null;
    }
    if ('banner_url' in body) {
      const v = checkUrl(body.banner_url, 'رابط الغلاف');
      if (v && !isProviderUrl(v)) throw new HttpError(400, 'ارفع الغلاف من المنصة بدل لصق رابط خارجي');
      rec.banner_url = v || null;
    }
    if ('display_name' in body) {
      rec.display_name = String(body.display_name || '').trim().slice(0, 40) || rec.username;
    }
    if ('bio' in body) rec.bio = String(body.bio || '').slice(0, 8000);
    if ('location' in body) rec.location = String(body.location || '').trim().slice(0, 60);
    if ('website' in body) rec.website = checkUrl(body.website, 'رابط الموقع');

    if ('links' in body) {
      if (!Array.isArray(body.links)) throw new HttpError(400, 'الروابط غير صالحة');
      const links = [];
      for (const l of body.links.slice(0, 12)) {
        const label = String((l && l.label) || '').trim().slice(0, 30);
        const raw = String((l && l.url) || '').trim();
        if (!label || !raw) continue;
        if (!HTTPS_RE.test(raw) && !MAILTO_RE.test(raw)) {
          throw new HttpError(400, `رابط غير صالح: ${label} (https:// أو mailto: فقط)`);
        }
        links.push({ label, url: raw, icon: String((l && l.icon) || '').slice(0, 4) });
      }
      rec.links = links;
    }

    rec.profile_updated_at = new Date().toISOString();
    profile = {
      avatar_url: rec.avatar_url || null,
      banner_url: rec.banner_url || null,
      display_name: rec.display_name || rec.username,
      bio: rec.bio || '',
      links: rec.links || [],
      location: rec.location || '',
      website: rec.website || '',
    };
    return null;
  }, `profile: ${user.username} update`);

  if (missing) throw new HttpError(404, 'المستخدم غير موجود');
  res.status(200).json({ ok: true, profile });
});
