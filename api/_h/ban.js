// POST /api/ban { username, ban, reason }   — admin only
// GET  /api/ban?username=<u>                -> this user's ban record
//
// Fixes:
//   * deleteFile() was called WITHOUT a blob sha, which GitHub rejects (422), so
//     "delete the banned member's codes" silently did nothing. _gh.deleteFile now
//     resolves the sha itself and failures are reported instead of swallowed.
//   * Banning bumps session_version, so the member's existing cookie stops
//     working immediately instead of staying valid until it expires.
//   * The stale fallback admin address / vercel.app domain are gone (APP-05).
//   * Every ban and unban is written to the moderation audit log.
const { readBody, loadUsers, findUser, updateUsers, bumpSessionVersion } = require('../_auth');
const { requireAdmin, BANS_PATH } = require('../_guard');
const { readJson, updateJson, deleteFile, listDir, getFile, SKIP_WRITE } = require('../_gh');
const { sendMail, shell, escapeHtml } = require('../_mail');
const { config, baseUrl } = require('../_config');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { logDecision } = require('../_moderation');

const SUPPORT_WA = (process.env.SUPPORT_WHATSAPP || '').replace(/[^\d]/g, '');

function supportBlock(req) {
  if (SUPPORT_WA) {
    return `<div style="text-align:center;margin-top:18px;">
      <a href="https://wa.me/${SUPPORT_WA}" style="display:inline-block;margin:6px 4px;padding:12px 26px;background:linear-gradient(135deg,#5ce18b,#25d366);color:#0a0a0a;text-decoration:none;font-weight:bold;border-radius:10px;font-size:15px;">💬 التواصل مع الدعم عبر واتساب</a>
    </div>`;
  }
  const admin = config().adminEmail;
  return `<p style="margin:14px 0 0;color:#a08454;font-size:13px;">
    للتواصل مع الدعم: <a href="mailto:${escapeHtml(admin)}" style="color:#f2c675;">${escapeHtml(admin)}</a>
    أو من <a href="${baseUrl(req)}/info" style="color:#f2c675;">صفحة معلومات المنصة</a>.
  </p>`;
}

/**
 * Remove every approved code of a banned member, plus their queue entries.
 * Returns what actually happened so the caller can report real results.
 */
async function deleteUsersCodes(username) {
  const target = String(username).toLowerCase();
  const removed = [];
  const failed = [];

  await updateJson('data/manifest.json', { codes: [] }, (manifest) => {
    if (!Array.isArray(manifest.codes)) return SKIP_WRITE;
    const kept = [];
    for (const c of manifest.codes) {
      const item = typeof c === 'string' ? { filename: c } : c;
      if (item.author && String(item.author).toLowerCase() === target) removed.push(item.filename);
      else kept.push(c);
    }
    if (!removed.length) return SKIP_WRITE;
    manifest.codes = kept;
    return null;
  }, `ban: clear codes of ${username}`);

  for (const name of removed) {
    try {
      await deleteFile(`codes/${name}`, `ban: remove ${name}`);
    } catch (e) {
      failed.push(name);
      // eslint-disable-next-line no-console
      console.error(`[ban] failed to delete codes/${name}:`, e.message);
    }
  }

  for (const it of await listDir('pending')) {
    if (!it.name || !it.name.endsWith('.json')) continue;
    try {
      const f = await getFile(`pending/${it.name}`, true);
      if (!f) continue;
      const j = JSON.parse(f.content);
      if (j.author && String(j.author).toLowerCase() === target) {
        await deleteFile(`pending/${it.name}`, `ban: remove pending ${it.name}`, f.sha);
        removed.push(`pending/${it.name}`);
      }
    } catch (e) {
      failed.push(`pending/${it.name}`);
      // eslint-disable-next-line no-console
      console.error(`[ban] failed to clear pending/${it.name}:`, e.message);
    }
  }

  return { removed, failed };
}

async function sendBanEmail(req, { to, username, reason }) {
  await sendMail({
    to,
    subject: '🚫 إغلاق حسابك — ARAB code',
    html: shell(`
      <h2 style="margin:0 0 12px;color:#e05252;font-size:20px;">تم إغلاق هذا الحساب</h2>
      <p style="margin:0 0 10px;line-height:1.9;color:#d8c9a3;font-size:15px;">
        مرحباً <b style="color:#f2c675;">${escapeHtml(String(username))}</b>،<br>
        تم إغلاق حسابك${reason ? `: <b style="color:#e8b7b7;">${escapeHtml(String(reason))}</b>` : '.'}
      </p>
      ${supportBlock(req)}
    `),
  });
}

async function sendUnbanEmail(req, { to, username }) {
  await sendMail({
    to,
    subject: '✅ عودة حسابك — ARAB code',
    html: shell(`
      <h2 style="margin:0 0 12px;color:#5ce18b;font-size:20px;">عاد حسابك مجدداً ✅</h2>
      <p style="margin:0 0 10px;line-height:1.9;color:#d8c9a3;font-size:15px;">
        مرحباً <b style="color:#f2c675;">${escapeHtml(String(username))}</b>،<br>
        تم إعادة تفعيل حسابك. يمكنك الآن الدخول والنشر بشكل طبيعي.
      </p>
      <div style="text-align:center;margin-top:18px;">
        <a href="${baseUrl(req)}" style="display:inline-block;margin:6px 4px;padding:12px 26px;background:linear-gradient(135deg,#e6a44a,#c67a1e);color:#0a0a0a;text-decoration:none;font-weight:bold;border-radius:10px;font-size:15px;">فتح المنصة</a>
      </div>
    `),
  });
}

module.exports = wrap('ban', async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  noStore(res);
  const { user: me } = await requireAdmin(req, { csrf: req.method !== 'GET' });

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const username = url.searchParams.get('username') || '';
    const { data: bans } = await readJson(BANS_PATH, {});
    const b = username ? (bans[String(username).toLowerCase()] || null) : bans;
    return res.status(200).json({ bans: b });
  }

  if (!(await enforce(req, res, 'admin-write', me.username)).allowed) return;

  const body = await readBody(req, { maxBytes: 4096 });
  const username = String(body.username || '').trim();
  const ban = !!body.ban;
  const reason = String(body.reason || '').trim().slice(0, 400);
  if (!username) throw new HttpError(400, 'حدد المستخدم');

  const { users } = await loadUsers();
  const target = findUser(users, username);
  if (!target) throw new HttpError(404, 'المستخدم غير موجود');
  const { isAdminEmail } = require('../_auth');
  if (isAdminEmail(target.email)) throw new HttpError(400, 'لا يمكن حظر الأدمن');

  const key = target.username.toLowerCase();
  let record = null;
  await updateJson(BANS_PATH, {}, (bans) => {
    const prev = bans[key] || {};
    record = {
      banned: ban,
      reason: reason || (ban ? 'أسباب أمنية' : null),
      banned_at: ban ? new Date().toISOString() : (prev.banned_at || null),
      unbanned_at: ban ? null : new Date().toISOString(),
      by: me.username,
    };
    bans[key] = record;
    return null;
  }, `bans: ${ban ? 'ban' : 'unban'} ${target.username}`);

  // Revoke the member's live sessions: a ban must take effect now, not when the
  // cookie expires.
  await updateUsers((data) => {
    const u = findUser(data.users, target.username);
    if (!u) return SKIP_WRITE;
    bumpSessionVersion(u);
    u.banned = ban;
    if (!ban) delete u.banned;
    return null;
  }, `security: rotate sessions after ${ban ? 'ban' : 'unban'} of ${target.username}`);

  let cleanup = { removed: [], failed: [] };
  if (ban) {
    try {
      cleanup = await deleteUsersCodes(target.username);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[ban] code cleanup failed:', e.message);
      cleanup.failed.push('cleanup-aborted');
    }
  }

  let mailed = false;
  try {
    if (ban) await sendBanEmail(req, { to: target.email, username: target.username, reason: record.reason });
    else await sendUnbanEmail(req, { to: target.email, username: target.username });
    mailed = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ban] notification mail failed:', e.message);
  }

  await logDecision({
    actor: me.username,
    action: ban ? 'ban' : 'unban',
    target: `user:${target.username}`,
    reason: record.reason,
    meta: { removed: cleanup.removed.length, failed: cleanup.failed.length, mailed },
  });

  // Report what really happened — including partial failures.
  res.status(200).json({
    ok: cleanup.failed.length === 0,
    banned: ban,
    mailed,
    removed_codes: cleanup.removed.length,
    failed_deletions: cleanup.failed,
  });
});

module.exports.isBanned = async function isBanned(username) {
  if (!username) return null;
  const { data } = await readJson(BANS_PATH, {});
  const b = data[String(username).toLowerCase()] || null;
  return b && b.banned ? b : null;
};
module.exports.deleteUsersCodes = deleteUsersCodes;
