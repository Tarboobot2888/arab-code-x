const { currentUser, readBody, isAdminEmail } = require('../_auth');
const { getFile, putFile, writeJson, readJson } = require('../_gh');
const { getSettings, scanContent } = require('../_settings');
const { sendRejection } = require('../_mail');
const { verifyTurnstile, clientIp } = require('../_turnstile');

function slugify(s) {
  return String(s || 'code').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'code';
}

async function publish({ title, description, language, code, u, isAdmin }) {
  const lang = String(language || 'txt').slice(0, 20);
  const base = slugify(title);
  let filename = `${base}.${lang}`;
  const { data: manifest } = await readJson('data/manifest.json', { codes: [] });
  if (!manifest.codes) manifest.codes = [];
  let i = 1;
  while (manifest.codes.some((c) => c.filename === filename)) {
    filename = `${base}-${i}.${lang}`;
    i++;
  }
  const codePath = `codes/${filename}`;
  const existing = await getFile(codePath);
  await putFile(codePath, code, `publish: ${filename} by ${u.username}`, existing?.sha);
  manifest.codes.unshift({
    filename,
    title: String(title).slice(0, 120),
    description: String(description || '').slice(0, 600),
    language: lang,
    author: u.username,
    author_avatar: u.avatar_url || null,
    author_verified: isAdmin || !!u.is_verified_badge,
    admin_added: isAdmin,
    approved_at: new Date().toISOString(),
  });
  await writeJson('data/manifest.json', manifest, `manifest: +${filename}`);
  return filename;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'سجل دخول أولاً' });
  if (!u.verified) return res.status(403).json({ error: 'فعّل بريدك أولاً' });
  try {
    const { title, description, language, code, turnstile_token } = await readBody(req);
    const ts = await verifyTurnstile(turnstile_token, clientIp(req));
    if (!ts.ok) return res.status(400).json({ error: ts.error });
    if (!title || !code) return res.status(400).json({ error: 'العنوان والكود مطلوبان' });
    if (code.length > 200000) return res.status(400).json({ error: 'الكود طويل جداً' });

    const isAdmin = isAdminEmail(u.email);
    const isVerified = isAdmin || !!u.is_verified_badge;
    const settings = await getSettings();

    // Content filter — auto reject violating submissions (admins are exempt)
    if (settings.filter_enabled && !isAdmin) {
      const hit = scanContent({ title, description, code }, settings.banned_words);
      if (hit) {
        const reason = `تم رصد محتوى مخالف لقواعد المنصة داخل الكود أو وصفه (الكلمة المرصودة: "${hit}").`;
        try {
          await sendRejection({ to: u.email, username: u.username, title, reason, auto: true });
        } catch (e) { console.error('rejection mail failed:', e.message); }
        return res.status(400).json({
          error: `لقد اكتشفنا أن كودك (${title}) لديه انتهاكات في قواعد معينة وتم رفضه تلقائياً. راسل الدعم عبر البريد الأساسي.`,
          filtered: true,
        });
      }
    }

    if (isVerified || settings.auto_approve) {
      const filename = await publish({ title, description, language, code, u, isAdmin });
      return res.status(200).json({ ok: true, published: true, url: `/c/${filename}` });
    }

    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    const entry = {
      id,
      title: String(title).slice(0, 120),
      description: String(description || '').slice(0, 600),
      language: String(language || 'txt').slice(0, 20),
      code,
      author: u.username,
      author_avatar: u.avatar_url || null,
      author_verified: false,
      author_is_admin: false,
      submitted_at: new Date().toISOString(),
    };
    await writeJson(`pending/${id}.json`, entry, `submit: ${u.username} - ${entry.title}`);
    res.status(200).json({ ok: true, published: false, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
};
