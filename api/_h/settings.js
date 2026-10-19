// GET  /api/settings          -> admin: full settings
// POST /api/settings { ... }  -> admin: update
const { readBody } = require('../_auth');
const { requireAdmin } = require('../_guard');
const { getSettings, saveSettings, DEFAULT_BANNED, BOOLEAN_KEYS } = require('../_settings');
const { wrap, methodGuard, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { logDecision } = require('../_moderation');

module.exports = wrap('settings', async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  noStore(res);
  const { user } = await requireAdmin(req, { csrf: req.method !== 'GET' });

  if (req.method === 'GET') {
    return res.status(200).json({ settings: await getSettings() });
  }

  if (!(await enforce(req, res, 'admin-write', user.username)).allowed) return;
  const body = await readBody(req, { maxBytes: 64 * 1024 });
  const cur = await getSettings();
  const pick = (k) => (body[k] === undefined ? cur[k] : !!body[k]);

  const next = {};
  for (const k of BOOLEAN_KEYS) next[k] = pick(k);
  next.banned_words = Array.isArray(body.banned_words)
    ? [...new Set(body.banned_words.map((w) => String(w).trim()).filter(Boolean))].slice(0, 400)
    : cur.banned_words;
  if (!next.banned_words.length) next.banned_words = [...DEFAULT_BANNED];

  await saveSettings(next);
  // Settings changes are part of the audit trail (plan 5.3).
  const changed = BOOLEAN_KEYS.filter((k) => cur[k] !== next[k]);
  await logDecision({
    actor: user.username, action: 'settings-update', target: 'data/settings.json',
    meta: { changed, banned_words: next.banned_words.length },
  });
  res.status(200).json({ ok: true, settings: next });
});
