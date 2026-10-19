// Shared store for code interactions: comments, likes and reports, kept in
// data/interactions.json.
//
// Schema
//   comments: [{ id, code, author, display_name, avatar_url, is_verified_badge,
//                text, line, created_at }]
//   likes:    { "<username>|<filename>": "<iso date>" }   // one per member/code
//   likeTotals: { "<filename>": <count> }                  // derived from likes
//   reports:  [{ id, code, reporter, reporter_display, reporter_avatar, text,
//                created_at, status: 'open'|'dismissed' }]
const { readJson, writeJson } = require('./_gh');
const { getSettings } = require('./_settings');

const PATH = 'data/interactions.json';
const EMPTY = { comments: [], likes: {}, reports: [], likeTotals: {} };

async function loadInteractions() {
  const { data } = await readJson(PATH, { ...EMPTY });
  if (!Array.isArray(data.comments)) data.comments = [];
  if (!Array.isArray(data.reports)) data.reports = [];
  if (!data.likes || typeof data.likes !== 'object') data.likes = {};
  if (!data.likeTotals || typeof data.likeTotals !== 'object') data.likeTotals = {};
  return data;
}

async function saveInteractions(d) {
  await writeJson(PATH, d, 'interactions: update');
  return d;
}

function nextId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Profanity guard against the admin-configured word list.
 * ASYNC — it reads the settings. The audited _report.js called it without
 * `await`, so the returned Promise was always truthy and every report counted as
 * blocked. Callers must await it.
 *
 * @returns {Promise<string[]|null>} matched words, or null when clean
 */
async function scanForCurses(text) {
  const settings = await getSettings();
  const words = Array.isArray(settings.banned_words) ? settings.banned_words : [];
  const hay = String(text || '').toLowerCase();
  const found = [];
  for (const w of words) {
    const t = String(w || '').trim().toLowerCase();
    if (!t) continue;
    if (hay.includes(t)) found.push(w);
  }
  return found.length ? found : null;
}

module.exports = { loadInteractions, saveInteractions, nextId, scanForCurses, PATH, EMPTY };
