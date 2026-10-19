// POST /api/reject { id, reason } — admin rejects a queued contribution.
const { readBody, loadUsers, findUser } = require('../_auth');
const { requireAdmin } = require('../_guard');
const { getFile, deleteFile } = require('../_gh');
const { sendRejection } = require('../_mail');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { STATUS, logDecision } = require('../_moderation');

const ID_RE = /^[a-z0-9]{1,16}-[a-z0-9]{1,16}$/i;

module.exports = wrap('reject', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);

  const { user } = await requireAdmin(req);
  if (!(await enforce(req, res, 'admin-write', user.username)).allowed) return;

  const body = await readBody(req, { maxBytes: 4096 });
  const id = String(body.id || '').trim();
  const reason = String(body.reason || '').slice(0, 800);
  if (!id || !ID_RE.test(id)) throw new HttpError(400, 'معرّف الطلب غير صالح');

  const pf = await getFile(`pending/${id}.json`, true);
  if (!pf) throw new HttpError(404, 'الطلب غير موجود');

  let entry = {};
  try { entry = JSON.parse(pf.content); } catch { /* still removable */ }

  await deleteFile(`pending/${id}.json`, `reject ${id}`, pf.sha);

  // The contributor is told the reason (plan 7.1 P0: "عرض سبب الرفض").
  let mailed = false;
  try {
    const { users } = await loadUsers();
    const author = findUser(users, entry.author);
    if (author && author.email) {
      await sendRejection({
        to: author.email,
        username: author.username,
        title: entry.title || 'كود',
        reason,
        auto: false,
      });
      mailed = true;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[reject] mail failed:', e.message);
  }

  await logDecision({
    actor: user.username, action: 'reject', target: `pending/${id}.json`,
    from: STATUS.PENDING, to: STATUS.REJECTED, reason,
    meta: { author: entry.author || null, mailed },
  });

  res.status(200).json({ ok: true, mailed });
});
