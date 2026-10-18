// GET  /api/comments?code=<filename>  — all comments on a code
// POST /api/comments                  — { code, text, line }
// DELETE /api/comments                — { id }  (author or admin only)
const { currentUser, isAdminEmail, readBody } = require('../_auth');
const { loadInteractions, saveInteractions, nextId, requireAuth, scanForCurses } = require('../_interact');
const { getSettings } = require('../_settings');

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const me = await requireAuth(req);
      const body = await readBody(req);
      const code = String(body.code || '').trim();
      const text = String(body.text || '').trim();
      if (!code || !text) return res.status(400).json({ error: 'التعليق مطلوب' });
      if (text.length > 1000) return res.status(400).json({ error: 'التعليق طويل جداً (حد أقصى ١٠٠٠ حرف)' });

      const settings = await getSettings();
      if (settings.filter_enabled) {
        const curses = await scanForCurses(text);
        if (curses) {
          // Warning before publish: client asks check first; if published anyway, notify admin
          return res.status(409).json({ warning: true, matched: curses, message: 'تعليقك يحتوي كلمات غير لائقة. عدّله أو أرسله كما هو — وإذا تم نشره سيصل تحذير للإدارة تلقائياً.' });
        }
      }

      const interaction = await loadInteractions();
      const entry = {
        id: nextId(),
        code,
        author: me.username,
        display_name: me.display_name || me.username,
        avatar_url: me.avatar_url || null,
        is_verified_badge: isAdminEmail(me.email) || !!me.is_verified_badge,
        text,
        line: body.line != null ? Number(body.line) : null,
        created_at: new Date().toISOString(),
      };
      interaction.comments.unshift(entry);
      await saveInteractions(interaction);
      return res.status(201).json({ comment: entry });
    }

    if (req.method === 'DELETE') {
      const me = await requireAuth(req);
      const body = await readBody(req);
      const interaction = await loadInteractions();
      const idx = interaction.comments.findIndex((c) => c.id === body.id);
      if (idx === -1) return res.status(404).json({ error: 'التعليق غير موجود' });
      if (interaction.comments[idx].author.toLowerCase() !== String(me.username).toLowerCase() && !isAdminEmail(me.email)) {
        return res.status(403).json({ error: 'ممنوع' });
      }
      interaction.comments.splice(idx, 1);
      await saveInteractions(interaction);
      return res.status(200).json({ ok: true });
    }

    // GET
    const url = new URL(req.url, 'http://x');
    const code = url.searchParams.get('code') || '';
    const interaction = await loadInteractions();
    let list = code ? interaction.comments.filter((c) => c.code === code) : interaction.comments;
    list = list.slice(0, 200);
    return res.status(200).json({ comments: list });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
