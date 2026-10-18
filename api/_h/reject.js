const { currentUser, readBody, ADMIN_EMAIL, loadUsers } = require('../_auth');
const { getFile, deleteFile } = require('../_gh');
const { sendRejection } = require('../_mail');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = await currentUser(req);
  if (!u || u.email.toLowerCase() !== ADMIN_EMAIL) return res.status(403).json({ error: 'ممنوع' });
  const { id, reason } = await readBody(req);
  if (!id) return res.status(400).json({ error: 'id مطلوب' });
  const pf = await getFile(`pending/${id}.json`);
  if (!pf) return res.status(404).json({ error: 'غير موجود' });

  let entry = {};
  try { entry = JSON.parse(pf.content); } catch {}

  await deleteFile(`pending/${id}.json`, `reject ${id}`, pf.sha);

  let mailed = false;
  try {
    const { users } = await loadUsers();
    const author = users.find((x) => x.username.toLowerCase() === String(entry.author || '').toLowerCase());
    if (author && author.email) {
      await sendRejection({
        to: author.email,
        username: author.username,
        title: entry.title || 'كود',
        reason: String(reason || '').slice(0, 800),
        auto: false,
      });
      mailed = true;
    }
  } catch (e) { console.error('reject mail failed:', e.message); }

  res.status(200).json({ ok: true, mailed });
};
