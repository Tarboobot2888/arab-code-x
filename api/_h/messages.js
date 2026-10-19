// GET  /api/messages — admin inbox
// POST /api/messages — a signed-in member writes to the admin
const { readBody } = require('../_auth');
const { requireUser, requireAdmin } = require('../_guard');
const { readJson, updateJson } = require('../_gh');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');

const PATH = 'data/messages.json';
const MAX_TEXT = 2000;

function nextId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

module.exports = wrap('messages', async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  noStore(res);

  if (req.method === 'POST') {
    const { user } = await requireUser(req, { verified: true });
    if (!(await enforce(req, res, 'messages', user.username)).allowed) return;

    const body = await readBody(req, { maxBytes: 16 * 1024 });
    const text = String(body.text || '').trim();
    const subject = String(body.subject || '').trim().slice(0, 120);
    if (!text) throw new HttpError(400, 'نص الرسالة مطلوب');
    if (text.length > MAX_TEXT) throw new HttpError(400, 'الرسالة طويلة جداً');

    await updateJson(PATH, { messages: [] }, (data) => {
      if (!Array.isArray(data.messages)) data.messages = [];
      data.messages.unshift({
        id: nextId(),
        author: user.username,
        display_name: user.display_name || user.username,
        avatar_url: user.avatar_url || null,
        subject: subject || 'رسالة للدعم',
        text,
        created_at: new Date().toISOString(),
        read: false,
      });
      if (data.messages.length > 2000) data.messages.length = 2000;
      return null;
    }, 'messages: +message');

    return res.status(201).json({ ok: true });
  }

  await requireAdmin(req, { csrf: false });
  const { data } = await readJson(PATH, { messages: [] });
  res.status(200).json({ messages: (data.messages || []).slice(0, 200) });
});
