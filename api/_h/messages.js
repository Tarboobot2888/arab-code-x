// Admin "Messages" tab: user->admin contact messages stored in data/messages.json
// GET  /api/messages                — admin only, list
// POST /api/messages                — any logged user can send a message to admin
const { currentUser, isAdminEmail, readBody } = require('../_auth');
const { readJson, writeJson } = require('../_gh');

const PATH = 'data/messages.json';

async function loadMessages() {
  const { data } = await readJson(PATH, { messages: [] });
  if (!Array.isArray(data.messages)) data.messages = [];
  return data;
}
async function saveMessages(d) {
  await writeJson(PATH, d, 'messages: update');
  return d;
}
function nextId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

module.exports = async (req, res) => {
  try {
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'سجّل دخول أولاً' });

    if (req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      const subject = String(body.subject || '').trim();
      if (!text) return res.status(400).json({ error: 'نص الرسالة مطلوب' });
      if (text.length > 2000) return res.status(400).json({ error: 'الرسالة طويلة جداً' });
      const d = await loadMessages();
      d.messages.unshift({
        id: nextId(),
        author: me.username,
        display_name: me.display_name || me.username,
        avatar_url: me.avatar_url || null,
        email: me.email,
        subject: subject || 'رسالة للدعم',
        text,
        created_at: new Date().toISOString(),
        read: false,
      });
      await saveMessages(d);
      return res.status(201).json({ ok: true });
    }

    // GET — admin only
    if (!isAdminEmail(me.email)) return res.status(403).json({ error: 'ممنوع' });
    const d = await loadMessages();
    return res.status(200).json({ messages: d.messages.slice(0, 200) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
