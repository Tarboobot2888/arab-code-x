// Self-service account management: change email, confirm email, change username,
// delete account.
//
// Fixes (plan: SEC-01, SEC-05, SEC-08, 5.3):
//   * The email-change token is hashed, expiring and single-use (it had no
//     expiry at all and was stored in clear).
//   * Every sensitive change rotates the session (bumpSessionVersion), so a
//     stolen cookie stops working after the account changes hands.
//   * Writes are atomic read-modify-write instead of load → mutate → save.
//   * Confirmation links are built from the validated PUBLIC_BASE_URL, never from
//     a client-controlled Host header (the old appUrl() read req.headers.host).
//   * Rate limits on each flow.
const {
  bcrypt, currentUser, loadUsers, updateUsers, findUser, readBody, issueSession,
  bumpSessionVersion, clearSessionCookie, isAdminEmail, EMAIL_RE, USERNAME_RE,
  RESERVED_USERNAMES,
} = require('../_auth');
const { requireUser } = require('../_guard');
const { readJson, updateJson, listDir, getFile, deleteFile, SKIP_WRITE } = require('../_gh');
const tokens = require('../_tokens');
const { getSettings } = require('../_settings');
const { sendChangeEmail, sendAccountNotice } = require('../_mail');
const { baseUrl } = require('../_config');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { page } = require('../_page');
const { logDecision } = require('../_moderation');

async function checkPassword(user, password) {
  if (!user || !user.password_hash) return false;
  try { return await bcrypt.compare(String(password || ''), user.password_hash); } catch { return false; }
}

/** Google-only accounts have no local password; they confirm by re-authenticating. */
function hasLocalPassword(user) { return !!(user && user.password_hash); }

// ---------------------------------------------------------------------------
// POST /api/change-email { email, password }
// ---------------------------------------------------------------------------
const changeEmail = wrap('change-email', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user: me } = await requireUser(req, { verified: true });
  if (!(await enforce(req, res, 'change-email', me.username)).allowed) return;

  const s = await getSettings();
  if (s.email_change_enabled === false) throw new HttpError(403, 'تغيير البريد متوقف حالياً');
  if (isAdminEmail(me.email)) throw new HttpError(403, 'لا يمكن تغيير بريد حساب الإدارة');

  const b = await readBody(req, { maxBytes: 4096 });
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'بريد غير صالح');
  if (email === String(me.email || '').toLowerCase()) throw new HttpError(400, 'هذا بريدك الحالي');
  if (isAdminEmail(email)) throw new HttpError(400, 'هذا البريد محجوز');

  if (!hasLocalPassword(me)) {
    throw new HttpError(403, 'حسابك يستخدم الدخول بجوجل. عيّن كلمة سر أولاً من صفحة «نسيت كلمة السر».');
  }
  if (!(await checkPassword(me, b.password))) throw new HttpError(401, 'كلمة السر غير صحيحة');

  let token = null;
  let taken = false;
  await updateUsers((data) => {
    if (data.users.some((u) => String(u.email || '').toLowerCase() === email)) {
      taken = true;
      return SKIP_WRITE;
    }
    const rec = findUser(data.users, me.username);
    if (!rec) { taken = true; return SKIP_WRITE; }
    rec.pending_email = email;
    token = tokens.issue(rec, 'email_change');
    rec.pending_email_at = new Date().toISOString();
    return null;
  }, `account: ${me.username} email change requested`);

  if (taken) throw new HttpError(409, 'البريد مستخدم بحساب آخر');

  const confirmUrl = `${baseUrl(req)}/api/confirm-email?u=${encodeURIComponent(me.username)}&token=${token}`;
  try {
    await sendChangeEmail({ to: email, username: me.username, confirmUrl });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[change-email] mail failed:', e.message);
    throw new HttpError(502, 'تعذّر إرسال رسالة التأكيد، حاول لاحقاً');
  }
  res.status(200).json({ ok: true, message: 'أرسلنا رسالة تأكيد إلى بريدك الجديد (صالحة ساعتين)' });
});

// ---------------------------------------------------------------------------
// GET /api/confirm-email?u=&token=
// ---------------------------------------------------------------------------
const confirmEmail = wrap('confirm-email', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  noStore(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const url = new URL(req.url, 'http://localhost');
  const username = String(url.searchParams.get('u') || '');
  const token = String(url.searchParams.get('token') || '');
  if (!(await enforce(req, res, 'confirm-email', username)).allowed) return;
  if (!username || !token) return res.status(400).send(page('رابط غير صالح.', false));

  let outcome = 'invalid';
  let record = null;
  let oldEmail = null;

  await updateUsers((data) => {
    const rec = findUser(data.users, username);
    if (!rec || !rec.pending_email) return SKIP_WRITE;

    const r = tokens.consume(rec, 'email_change', token);
    if (!r.ok) {
      outcome = r.reason === 'expired' ? 'expired' : 'invalid';
      if (r.reason === 'expired') { rec.pending_email = null; return null; }
      return SKIP_WRITE;
    }
    const wanted = String(rec.pending_email).toLowerCase();
    if (data.users.some((x) => x !== rec && String(x.email || '').toLowerCase() === wanted)) {
      rec.pending_email = null;
      outcome = 'taken';
      return null;
    }
    oldEmail = rec.email;
    rec.email = rec.pending_email;
    rec.verified = true;
    rec.pending_email = null;
    rec.pending_email_at = null;
    rec.email_changed_at = new Date().toISOString();
    // The identity behind the session changed: rotate it.
    bumpSessionVersion(rec);
    outcome = 'ok';
    record = rec;
    return null;
  }, `account: ${username} email changed`);

  if (outcome === 'taken') return res.status(409).send(page('هذا البريد أصبح مستخدماً بحساب آخر.', false));
  if (outcome === 'expired') return res.status(400).send(page('انتهت صلاحية رابط التأكيد. أعد المحاولة من إعدادات حسابك.', false));
  if (outcome !== 'ok') return res.status(400).send(page('رابط التأكيد غير صالح أو منتهي.', false));

  try {
    await sendAccountNotice({
      to: oldEmail,
      username: record.username,
      title: 'تم تغيير بريد حسابك',
      text: `تم تغيير بريد حسابك في ARAB code.\nإذا لم تكن أنت من قام بذلك تواصل مع الدعم فوراً.`,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[confirm-email] notice mail failed:', e.message);
  }

  // A fresh session on the new identity (the old cookie is already invalid).
  issueSession(res, record);
  res.status(200).send(page('تم تغيير بريدك بنجاح ✓', true));
});

// ---------------------------------------------------------------------------
// POST /api/change-username { username, password }
// ---------------------------------------------------------------------------
const changeUsername = wrap('change-username', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user: me } = await requireUser(req, { verified: true });
  if (!(await enforce(req, res, 'change-username', me.username)).allowed) return;

  const s = await getSettings();
  if (s.username_change_enabled === false) throw new HttpError(403, 'تغيير اسم المستخدم متوقف حالياً');

  const b = await readBody(req, { maxBytes: 4096 });
  const next = String(b.username || '').trim();
  if (!USERNAME_RE.test(next)) throw new HttpError(400, 'اسم المستخدم: 3-20 حرف إنجليزي/أرقام/شرطة سفلية');
  if (RESERVED_USERNAMES.has(next.toLowerCase())) throw new HttpError(400, 'اسم المستخدم محجوز');
  if (next.toLowerCase() === me.username.toLowerCase()) throw new HttpError(400, 'هذا اسمك الحالي');

  if (!hasLocalPassword(me)) {
    throw new HttpError(403, 'حسابك يستخدم الدخول بجوجل. عيّن كلمة سر أولاً من صفحة «نسيت كلمة السر».');
  }
  if (!(await checkPassword(me, b.password))) throw new HttpError(401, 'كلمة السر غير صحيحة');

  const old = me.username;
  let taken = false;
  let record = null;
  await updateUsers((data) => {
    if (data.users.some((u) => String(u.username || '').toLowerCase() === next.toLowerCase())) {
      taken = true;
      return SKIP_WRITE;
    }
    const rec = findUser(data.users, old);
    if (!rec) { taken = true; return SKIP_WRITE; }
    rec.username = next;
    rec.username_changed_at = new Date().toISOString();
    bumpSessionVersion(rec);
    record = rec;
    return null;
  }, `account: ${old} -> ${next}`);

  if (taken) throw new HttpError(409, 'اسم المستخدم محجوز');

  // Keep published codes, queue entries, comments and likes attached to the
  // same person. Each store is updated atomically.
  await updateJson('data/manifest.json', { codes: [] }, (manifest) => {
    let touched = false;
    (manifest.codes || []).forEach((c) => {
      if (String(c.author || '').toLowerCase() === old.toLowerCase()) { c.author = next; touched = true; }
    });
    return touched ? null : SKIP_WRITE;
  }, `manifest: rename author ${old} -> ${next}`);

  await updateJson('data/interactions.json', { comments: [], likes: {}, reports: [] }, (data) => {
    let touched = false;
    (data.comments || []).forEach((c) => {
      if (String(c.author || '').toLowerCase() === old.toLowerCase()) { c.author = next; touched = true; }
    });
    (data.reports || []).forEach((r) => {
      if (String(r.reporter || '').toLowerCase() === old.toLowerCase()) { r.reporter = next; touched = true; }
    });
    if (data.likes && typeof data.likes === 'object') {
      for (const key of Object.keys(data.likes)) {
        const sep = key.indexOf('|');
        if (sep > 0 && key.slice(0, sep).toLowerCase() === old.toLowerCase()) {
          data.likes[`${next.toLowerCase()}|${key.slice(sep + 1)}`] = data.likes[key];
          delete data.likes[key];
          touched = true;
        }
      }
    }
    return touched ? null : SKIP_WRITE;
  }, `interactions: rename author ${old} -> ${next}`);

  for (const it of await listDir('pending')) {
    if (!it.name || !it.name.endsWith('.json')) continue;
    await updateJson(it.path, {}, (j) => {
      if (String(j.author || '').toLowerCase() !== old.toLowerCase()) return SKIP_WRITE;
      j.author = next;
      return null;
    }, `pending: rename author ${old} -> ${next}`);
  }

  issueSession(res, record);
  res.status(200).json({ ok: true, username: next });
});

// ---------------------------------------------------------------------------
// POST /api/delete-account { password, delete_codes }
// ---------------------------------------------------------------------------
const deleteAccount = wrap('delete-account', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user: me } = await requireUser(req, { verified: false });
  if (!(await enforce(req, res, 'delete-account', me.username)).allowed) return;

  const s = await getSettings();
  if (s.account_delete_enabled === false) throw new HttpError(403, 'حذف الحساب متوقف حالياً');
  if (isAdminEmail(me.email)) throw new HttpError(403, 'لا يمكن حذف حساب الإدارة');

  const b = await readBody(req, { maxBytes: 4096 });
  if (hasLocalPassword(me)) {
    if (!(await checkPassword(me, b.password))) throw new HttpError(401, 'كلمة السر غير صحيحة');
  } else if (String(b.confirm || '').trim().toLowerCase() !== me.username.toLowerCase()) {
    // Google-only account: confirm by typing the username instead.
    throw new HttpError(400, 'اكتب اسم المستخدم للتأكيد');
  }

  const uname = me.username.toLowerCase();
  const email = me.email;

  if (b.delete_codes) {
    const removed = [];
    await updateJson('data/manifest.json', { codes: [] }, (manifest) => {
      if (!Array.isArray(manifest.codes)) return SKIP_WRITE;
      const kept = [];
      for (const c of manifest.codes) {
        if (String(c.author || '').toLowerCase() === uname) removed.push(c.filename);
        else kept.push(c);
      }
      if (!removed.length) return SKIP_WRITE;
      manifest.codes = kept;
      return null;
    }, `manifest: remove codes of ${me.username}`);
    for (const name of removed) {
      try {
        const f = await getFile(`codes/${name}`, true);
        if (f) await deleteFile(`codes/${name}`, `delete ${name} (account removed)`, f.sha);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[delete-account] failed to delete codes/${name}:`, e.message);
      }
    }
  }

  for (const it of await listDir('pending')) {
    if (!it.name || !it.name.endsWith('.json')) continue;
    try {
      const f = await getFile(it.path, true);
      if (!f) continue;
      const j = JSON.parse(f.content);
      if (String(j.author || '').toLowerCase() === uname) {
        await deleteFile(it.path, `pending cleanup ${me.username}`, f.sha);
      }
    } catch { /* a corrupt queue entry must not block the deletion */ }
  }

  // Drop the member's likes; keep comments but detach the identity so threads
  // stay readable (plan 9.3: "حذف قابل للتدقيق").
  await updateJson('data/interactions.json', { comments: [], likes: {}, reports: [] }, (data) => {
    let touched = false;
    if (data.likes && typeof data.likes === 'object') {
      for (const key of Object.keys(data.likes)) {
        if (key.slice(0, key.indexOf('|')).toLowerCase() === uname) { delete data.likes[key]; touched = true; }
      }
    }
    (data.comments || []).forEach((c) => {
      if (String(c.author || '').toLowerCase() === uname) {
        c.author = '[deleted]';
        c.display_name = 'عضو محذوف';
        c.avatar_url = null;
        c.is_verified_badge = false;
        touched = true;
      }
    });
    return touched ? null : SKIP_WRITE;
  }, `interactions: detach ${me.username}`);

  await updateUsers((data) => {
    const before = data.users.length;
    data.users = data.users.filter((x) => String(x.username || '').toLowerCase() !== uname);
    return data.users.length === before ? SKIP_WRITE : null;
  }, `account: delete ${me.username}`);

  try {
    await sendAccountNotice({
      to: email,
      username: me.username,
      title: 'تم حذف حسابك',
      text: 'تم حذف حسابك في منصة ARAB code بناءً على طلبك. نأسف لمغادرتك 💛\nيمكنك إنشاء حساب جديد في أي وقت.',
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[delete-account] notice mail failed:', e.message);
  }

  await logDecision({
    actor: me.username, action: 'account-delete', target: `user:${me.username}`,
    meta: { codes_deleted: !!b.delete_codes },
  });

  clearSessionCookie(res);
  res.status(200).json({ ok: true });
});

module.exports = { changeEmail, confirmEmail, changeUsername, deleteAccount, checkPassword, hasLocalPassword };
