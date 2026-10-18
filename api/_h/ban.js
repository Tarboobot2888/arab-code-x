// POST /api/ban        { username, ban, reason }   — admin only
// GET  /api/ban?username=<u>                       -> { banned, reason, banned_at }
// Admins store bans in data/bans.json: { "<username>": { banned:true, reason, banned_at, unbanned_at, messages: [...] } }
// On ban: delete all approved codes of the user (files + manifest + pending), send emails.
// On unban: send restoration email. Users see ban overlay on frontend via /api/ban check.
const { currentUser, isAdminEmail, readBody, loadUsers, saveUsers } = require('../_auth');
const { readJson, writeJson, deleteFile, listDir, getFile, putFile, REPO, BRANCH } = require('../_gh');
const { sendMail, shell, escapeHtml } = require('../_mail');

const BANS_PATH = 'data/bans.json';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'mzmlzip@gmail.com').toLowerCase();
const SITE_URL = process.env.SITE_URL || process.env.APP_URL || 'https://monte-top-v.vercel.app';
const WA_1 = '249918614328';

async function loadBans() {
  const { data } = await readJson(BANS_PATH, {});
  return data;
}
async function saveBans(d) {
  await writeJson(BANS_PATH, d, 'bans: update');
  return d;
}

async function loadManifest() {
  const f = await getFile('data/manifest.json');
  if (!f) return { data: { codes: [] }, sha: null };
  try { return { data: JSON.parse(f.content), sha: f.sha }; }
  catch { return { data: { codes: [] }, sha: f.sha }; }
}

function waButton(label, number) {
  return `<a href="https://wa.me/${number}" style="display:inline-block;margin:6px 4px;padding:12px 26px;background:linear-gradient(135deg,#5ce18b,#25d366);color:#0a0a0a;text-decoration:none;font-weight:bold;border-radius:10px;font-size:15px;">${label}</a>`;
}

async function deleteUsersCodes(username) {
  // 1) collect filenames authored by the user from the manifest (author is tracked there)
  const { data: manifest, sha: manifestSha } = await loadManifest();
  const target = String(username).toLowerCase();
  const kept = [];
  const removed = [];
  if (manifest && Array.isArray(manifest.codes)) {
    for (const c of manifest.codes) {
      const item = typeof c === 'string' ? { filename: c } : c;
      if (item.author && String(item.author).toLowerCase() === target) removed.push(item.filename);
      else kept.push(c);
    }
    if (removed.length) {
      await putFile('data/manifest.json', JSON.stringify({ ...manifest, codes: kept }, null, 2), `ban: clear codes of ${username}`, manifestSha);
    }
  }
  // 2) delete the physical files + pending entries of the removed filenames
  for (const name of removed) {
    try { await deleteFile('codes/' + name, `ban: remove ${name}`); } catch (e) { console.error('delete failed', name, e && e.message); }
  }
  // Pending items store author inside their JSON body
  const pendingFiles = await listDir('pending');
  for (const it of pendingFiles) {
    if (!it.name || it.name.endsWith('.json') === false) continue;
    try {
      const f = await getFile('pending/' + it.name);
      if (!f) continue;
      const j = JSON.parse(f.content);
      if (j.author && String(j.author).toLowerCase() === target) {
        await deleteFile('pending/' + it.name, `ban: remove pending ${it.name}`);
      }
    } catch { /* skip */ }
  }
}

async function sendBanEmail({ to, username, reason }) {
  await sendMail({
    to,
    subject: '🚫 إغلاق حسابك — ARAB code',
    html: shell(`
      <h2 style="margin:0 0 12px;color:#e05252;font-size:20px;">تم إغلاق هذا الحساب</h2>
      <p style="margin:0 0 10px;line-height:1.9;color:#d8c9a3;font-size:15px;">
        مرحباً <b style="color:#f2c675;">${escapeHtml(String(username))}</b>،<br>
        لقد تم إغلاق حسابك لأسباب أمنية${reason ? `: <b style="color:#e8b7b7;">${escapeHtml(String(reason))}</b>` : '.'}
      </p>
      <p style="margin:14px 0 0;line-height:1.9;color:#d8c9a3;font-size:15px;">
        يمكنك التواصل مع الدعم عبر واتساب لحل المشكلة وإعادة تفعيل حسابك:
      </p>
      <div style="text-align:center;margin-top:18px;">
        ${waButton('💬 اضغط هنا للمراسلة عبر واتساب', WA_1)}
      </div>
    `),
  });
}

async function sendUnbanEmail({ to, username }) {
  await sendMail({
    to,
    subject: '✅ عودة حسابك — ARAB code',
    html: shell(`
      <h2 style="margin:0 0 12px;color:#5ce18b;font-size:20px;">عادت حسابك مجدداً ✅</h2>
      <p style="margin:0 0 10px;line-height:1.9;color:#d8c9a3;font-size:15px;">
        مرحباً <b style="color:#f2c675;">${escapeHtml(String(username))}</b>،<br>
        تم إعادة تفعيل حسابك بنجاح. يمكنك الآن الدخول والنشر بشكل طبيعي.
      </p>
      <div style="text-align:center;margin-top:18px;">
        <a href="${SITE_URL}" style="display:inline-block;margin:6px 4px;padding:12px 26px;background:linear-gradient(135deg,#e6a44a,#c67a1e);color:#0a0a0a;text-decoration:none;font-weight:bold;border-radius:10px;font-size:15px;">فتح المنصة</a>
      </div>
    `),
  });
}

module.exports = async (req, res) => {
  try {
    const me = await currentUser(req);
    if (!me || !isAdminEmail(me.email)) return res.status(403).json({ error: 'ممنوع' });

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const username = url.searchParams.get('username') || '';
      const bans = await loadBans();
      const b = username ? (bans[String(username).toLowerCase()] || null) : bans;
      return res.status(200).json({ bans: b });
    }

    // POST
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const ban = !!body.ban;
    if (!username) return res.status(400).json({ error: 'حدد المستخدم' });

    const users = (await loadUsers()).users;
    const target = users.find((u) => String(u.username || '').toLowerCase() === String(username).toLowerCase());
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (isAdminEmail(target.email)) return res.status(400).json({ error: 'لا يمكن حظر الأدمن' });

    const bans = await loadBans();
    bans[String(username).toLowerCase()] = {
      banned: ban,
      reason: String(body.reason || '').trim() || (ban ? 'أسباب أمنية' : null),
      banned_at: ban ? new Date().toISOString() : (bans[String(username).toLowerCase()] && bans[String(username).toLowerCase()].banned_at) || null,
      unbanned_at: ban ? null : new Date().toISOString(),
    };
    await saveBans(bans);

    if (ban) {
      try { await deleteUsersCodes(username); }
      catch (e) { console.error('code deletion failed:', e && e.message); }
      try { await sendBanEmail({ to: target.email, username: target.username, reason: bans[String(username).toLowerCase()].reason }); }
      catch (e) { console.error('ban mail failed:', e && e.message); }
      return res.status(200).json({ ok: true, banned: true });
    }

    try { await sendUnbanEmail({ to: target.email, username: target.username }); }
    catch (e) { console.error('unban mail failed:', e && e.message); }
    return res.status(200).json({ ok: true, banned: false });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};

module.exports.isBanned = async function isBanned(username) {
  if (!username) return null;
  const { data } = await readJson(BANS_PATH, {});
  const b = data[String(username).toLowerCase()] || null;
  if (!b || !b.banned) return null;
  return b;
};
