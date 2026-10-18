const {
  bcrypt, currentUser, loadUsers, saveUsers, readBody, randomToken,
  isAdminEmail, sign, setSessionCookie, clearSessionCookie, EMAIL_RE, USERNAME_RE,
} = require('../_auth');
const { getSettings } = require('../_settings');
const { sendChangeEmail, sendAccountNotice } = require('../_mail');
const { readJson, writeJson, listDir, getFile, deleteFile } = require('../_gh');

function appUrl(req) {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (base) return base;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

async function checkPassword(user, password) {
  if (!user.password_hash) return false;
  try { return await bcrypt.compare(String(password || ''), user.password_hash); } catch { return false; }
}

function idx(data, username) {
  return data.users.findIndex((x) => x.username.toLowerCase() === String(username).toLowerCase());
}

// POST /api/change-email { email, password }
async function changeEmail(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const me = await currentUser(req);
  if (!me) return res.status(401).json({ error: 'سجل دخول أولاً' });
  try {
    const s = await getSettings();
    if (s.email_change_enabled === false) return res.status(403).json({ error: 'تغيير البريد متوقف حالياً' });
    if (isAdminEmail(me.email)) return res.status(403).json({ error: 'لا يمكن تغيير بريد حساب الإدارة' });

    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'بريد غير صالح' });
    if (email === String(me.email || '').toLowerCase()) return res.status(400).json({ error: 'هذا بريدك الحالي' });
    if (isAdminEmail(email)) return res.status(400).json({ error: 'هذا البريد محجوز' });
    if (!(await checkPassword(me, b.password))) return res.status(401).json({ error: 'كلمة السر غير صحيحة' });

    const data = await loadUsers();
    if (data.users.some((u) => (u.email || '').toLowerCase() === email)) {
      return res.status(409).json({ error: 'البريد مستخدم بحساب آخر' });
    }
    const i = idx(data, me.username);
    if (i === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const token = randomToken(20);
    data.users[i].pending_email = email;
    data.users[i].pending_email_token = token;
    data.users[i].pending_email_at = new Date().toISOString();
    await saveUsers(data, `account: ${me.username} email change requested`);

    const confirmUrl = `${appUrl(req)}/api/confirm-email?u=${encodeURIComponent(me.username)}&token=${token}`;
    await sendChangeEmail({ to: email, username: me.username, confirmUrl });
    res.status(200).json({ ok: true, message: 'أرسلنا رسالة تأكيد إلى بريدك الجديد' });
  } catch (e) {
    console.error('change-email error:', e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
}

// GET /api/confirm-email?u=&token=
async function confirmEmail(req, res) {
  const url = new URL(req.url, 'http://x');
  const u = url.searchParams.get('u');
  const token = url.searchParams.get('token');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!u || !token) return res.status(400).send(page('رابط غير صالح', false));
  const data = await loadUsers();
  const i = idx(data, u);
  if (i === -1) return res.status(400).send(page('رابط غير صالح', false));
  const rec = data.users[i];
  if (!rec.pending_email || rec.pending_email_token !== token) {
    return res.status(400).send(page('رابط التأكيد غير صالح أو منتهي.', false));
  }
  if (data.users.some((x, j) => j !== i && (x.email || '').toLowerCase() === rec.pending_email)) {
    return res.status(409).send(page('هذا البريد أصبح مستخدماً بحساب آخر.', false));
  }
  const old = rec.email;
  rec.email = rec.pending_email;
  rec.verified = true;
  rec.pending_email = null;
  rec.pending_email_token = null;
  await saveUsers(data, `account: ${rec.username} email changed`);
  try {
    await sendAccountNotice({
      to: old, username: rec.username, title: 'تم تغيير بريد حسابك',
      text: `تم تغيير بريد حسابك في ARAB code إلى ${rec.email}.\nإذا لم تكن أنت من قام بذلك تواصل مع الدعم فوراً.`,
    });
  } catch {}
  setSessionCookie(res, sign({ u: rec.username, e: rec.email }));
  res.status(200).send(page('تم تغيير بريدك بنجاح ✓', true));
}

// POST /api/change-username { username, password }
async function changeUsername(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const me = await currentUser(req);
  if (!me) return res.status(401).json({ error: 'سجل دخول أولاً' });
  try {
    const s = await getSettings();
    if (s.username_change_enabled === false) return res.status(403).json({ error: 'تغيير اسم المستخدم متوقف حالياً' });

    const b = await readBody(req);
    const next = String(b.username || '').trim();
    if (!USERNAME_RE.test(next)) return res.status(400).json({ error: 'اسم المستخدم: 3-20 حرف إنجليزي/أرقام/شرطة سفلية' });
    if (next.toLowerCase() === me.username.toLowerCase()) return res.status(400).json({ error: 'هذا اسمك الحالي' });
    if (!(await checkPassword(me, b.password))) return res.status(401).json({ error: 'كلمة السر غير صحيحة' });

    const data = await loadUsers();
    if (data.users.some((u) => u.username.toLowerCase() === next.toLowerCase())) {
      return res.status(409).json({ error: 'اسم المستخدم محجوز' });
    }
    const i = idx(data, me.username);
    if (i === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const old = data.users[i].username;
    data.users[i].username = next;
    data.users[i].username_changed_at = new Date().toISOString();
    await saveUsers(data, `account: ${old} -> ${next}`);

    // Keep published codes and pending requests attached to the same person.
    const { data: manifest } = await readJson('data/manifest.json', { codes: [] });
    let touched = false;
    (manifest.codes || []).forEach((c) => {
      if ((c.author || '').toLowerCase() === old.toLowerCase()) { c.author = next; touched = true; }
    });
    if (touched) await writeJson('data/manifest.json', manifest, `manifest: rename author ${old} -> ${next}`);

    for (const it of await listDir('pending')) {
      if (!it.name.endsWith('.json')) continue;
      const f = await getFile(it.path);
      if (!f) continue;
      try {
        const j = JSON.parse(f.content);
        if ((j.author || '').toLowerCase() === old.toLowerCase()) {
          j.author = next;
          await writeJson(it.path, j, `pending: rename author ${old} -> ${next}`);
        }
      } catch {}
    }

    setSessionCookie(res, sign({ u: next, e: data.users[i].email }));
    res.status(200).json({ ok: true, username: next });
  } catch (e) {
    console.error('change-username error:', e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
}

// POST /api/delete-account { password, delete_codes }
async function deleteAccount(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const me = await currentUser(req);
  if (!me) return res.status(401).json({ error: 'سجل دخول أولاً' });
  try {
    const s = await getSettings();
    if (s.account_delete_enabled === false) return res.status(403).json({ error: 'حذف الحساب متوقف حالياً' });
    if (isAdminEmail(me.email)) return res.status(403).json({ error: 'لا يمكن حذف حساب الإدارة' });

    const b = await readBody(req);
    if (!(await checkPassword(me, b.password))) return res.status(401).json({ error: 'كلمة السر غير صحيحة' });

    const uname = me.username.toLowerCase();

    if (b.delete_codes) {
      const { data: manifest } = await readJson('data/manifest.json', { codes: [] });
      const mine = (manifest.codes || []).filter((c) => (c.author || '').toLowerCase() === uname);
      manifest.codes = (manifest.codes || []).filter((c) => (c.author || '').toLowerCase() !== uname);
      await writeJson('data/manifest.json', manifest, `manifest: remove codes of ${me.username}`);
      for (const c of mine) {
        const f = await getFile(`codes/${c.filename}`);
        if (f) await deleteFile(`codes/${c.filename}`, `delete ${c.filename} (account removed)`, f.sha);
      }
    }

    for (const it of await listDir('pending')) {
      if (!it.name.endsWith('.json')) continue;
      const f = await getFile(it.path);
      if (!f) continue;
      try {
        const j = JSON.parse(f.content);
        if ((j.author || '').toLowerCase() === uname) await deleteFile(it.path, `pending cleanup ${me.username}`, f.sha);
      } catch {}
    }

    const data = await loadUsers();
    data.users = data.users.filter((x) => x.username.toLowerCase() !== uname);
    await saveUsers(data, `account: delete ${me.username}`);

    try {
      await sendAccountNotice({
        to: me.email, username: me.username, title: 'تم حذف حسابك',
        text: 'تم حذف حسابك في منصة ARAB code بناءً على طلبك. نأسف لمغادرتك 💛\nيمكنك إنشاء حساب جديد في أي وقت.',
      });
    } catch {}

    clearSessionCookie(res);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('delete-account error:', e);
    res.status(500).json({ error: 'خطأ داخلي: ' + (e.message || 'unknown') });
  }
}

function page(msg, ok) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ARAB code</title>
  <link rel="stylesheet" href="/styles.css"></head>
  <body class="center-page"><div class="msg-card ${ok ? 'ok' : 'err'}">
    <div class="sphere-mini"></div><h1>${msg}</h1>
    <a href="/" class="btn primary">الذهاب للرئيسية</a>
  </div></body></html>`;
}

module.exports = { changeEmail, confirmEmail, changeUsername, deleteAccount };
