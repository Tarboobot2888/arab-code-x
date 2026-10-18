const { currentUser, readBody, loadUsers, saveUsers } = require('../_auth');

const URL_RE = /^https:\/\/[^\s]{4,300}$/i;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'سجل دخول أولاً' });
  try {
    const body = await readBody(req);
    const data = await loadUsers();
    const idx = data.users.findIndex((x) => x.username.toLowerCase() === u.username.toLowerCase());
    if (idx === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const rec = data.users[idx];

    if ('avatar_url' in body) {
      if (body.avatar_url && !URL_RE.test(body.avatar_url)) {
        return res.status(400).json({ error: 'رابط الصورة غير صالح' });
      }
      rec.avatar_url = body.avatar_url || null;
    }
    if ('banner_url' in body) {
      if (body.banner_url && !URL_RE.test(body.banner_url)) {
        return res.status(400).json({ error: 'رابط الغلاف غير صالح' });
      }
      rec.banner_url = body.banner_url || null;
    }
    if ('display_name' in body) {
      rec.display_name = String(body.display_name || '').slice(0, 40) || rec.username;
    }
    if ('bio' in body) {
      rec.bio = String(body.bio || '').slice(0, 8000);
    }
    if ('location' in body) rec.location = String(body.location || '').slice(0, 60);
    if ('website' in body) {
      const w = String(body.website || '').trim();
      if (w && !URL_RE.test(w)) return res.status(400).json({ error: 'رابط الموقع يجب أن يبدأ بـ https://' });
      rec.website = w;
    }
    if ('links' in body) {
      if (!Array.isArray(body.links)) return res.status(400).json({ error: 'الروابط غير صالحة' });
      const links = [];
      for (const l of body.links.slice(0, 12)) {
        const label = String((l && l.label) || '').trim().slice(0, 30);
        const url = String((l && l.url) || '').trim();
        if (!label || !url) continue;
        if (!URL_RE.test(url) && !/^mailto:|^https:\/\//i.test(url)) {
          return res.status(400).json({ error: `رابط غير صالح: ${label} (يجب أن يبدأ بـ https://)` });
        }
        links.push({ label, url, icon: String((l && l.icon) || '').slice(0, 4) });
      }
      rec.links = links;
    }

    rec.profile_updated_at = new Date().toISOString();
    data.users[idx] = rec;
    await saveUsers(data, `profile: ${u.username} update`);
    res.status(200).json({
      ok: true,
      profile: {
        avatar_url: rec.avatar_url || null,
        banner_url: rec.banner_url || null,
        display_name: rec.display_name || rec.username,
        bio: rec.bio || '',
        links: rec.links || [],
        location: rec.location || '',
        website: rec.website || '',
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
};
