// Admin-configurable platform settings.
//
// Two things changed (plan: SEC-02, 6.1 step 2):
//   * The committed data/settings.json had auto_approve=true and
//     filter_enabled=false. Defaults here are the safe ones, and the live file
//     has been corrected, so a missing or corrupt settings file can no longer
//     fall back to "publish everything unchecked".
//   * The banned-word list is documented for what it is — a moderation aid, not
//     a security control. What protects the origin is that untrusted content is
//     never served as an executable document (see .vercelignore / vercel.json).
const { readJson, writeJson } = require('./_gh');

const PATH = 'data/settings.json';

const DEFAULT_BANNED = [
  'porn', 'porno', 'pornhub', 'xnxx', 'xvideos', 'xhamster', 'sex', 'sexy',
  'nude', 'nudes', 'nsfw', 'hentai', 'onlyfans', 'escort', 'viagra', 'incest',
  'rape', 'child porn', 'cp video', 'carding', 'cc checker', 'ddos', 'botnet',
  'ransomware', 'keylogger', 'stealer', 'rat malware', 'phishing', 'sqlmap dump',
  'اباحي', 'إباحي', 'اباحية', 'إباحية', 'اباحيه', 'سكس', 'جنس', 'عاري', 'عارية',
  'خلاعة', 'خلاعه', 'دعارة', 'دعاره', 'مخدرات', 'حشيش', 'اختراق حسابات',
  'تهكير حسابات', 'سرقة حسابات', 'كروت مسروقة', 'بطاقات مسروقة',
];

/** Every boolean flag and its SAFE default (deny-by-default where it matters). */
const BOOLEAN_DEFAULTS = Object.freeze({
  // Review-by-default. Executable content ignores this flag entirely and is
  // always queued for review — see api/_h/submit.js.
  auto_approve: false,
  filter_enabled: true,
  direct_delete: false,
  delete_requests_enabled: true,
  google_login_enabled: true,
  signup_enabled: true,
  email_change_enabled: true,
  username_change_enabled: true,
  account_delete_enabled: true,
});

const BOOLEAN_KEYS = Object.freeze(Object.keys(BOOLEAN_DEFAULTS));

const DEFAULTS = Object.freeze({ ...BOOLEAN_DEFAULTS, banned_words: DEFAULT_BANNED });

const bool = (v, d) => (v === undefined || v === null ? d : !!v);

async function getSettings() {
  let data = {};
  try {
    ({ data } = await readJson(PATH, {}));
  } catch (e) {
    // A corrupt settings file must not open the gate; fall back to the safe set.
    // eslint-disable-next-line no-console
    console.error('[settings] unreadable, using safe defaults:', e.message);
    data = {};
  }
  const out = {};
  for (const k of BOOLEAN_KEYS) out[k] = bool(data[k], BOOLEAN_DEFAULTS[k]);
  out.banned_words = Array.isArray(data.banned_words) && data.banned_words.length
    ? data.banned_words
    : [...DEFAULT_BANNED];
  return out;
}

async function saveSettings(next) {
  const clean = {};
  for (const k of BOOLEAN_KEYS) clean[k] = bool(next[k], BOOLEAN_DEFAULTS[k]);
  clean.banned_words = Array.isArray(next.banned_words) && next.banned_words.length
    ? next.banned_words
    : [...DEFAULT_BANNED];
  await writeJson(PATH, clean, 'settings: update');
  return clean;
}

/**
 * Returns the matched banned word, or null when clean.
 * NOTE: a substring word list. It helps moderators triage; it is explicitly NOT
 * a security boundary and must never be the only thing between untrusted input
 * and the platform (plan 4.1 SEC-02: "لا تعتمد على مرشح الكلمات باعتباره
 * ضمانًا أمنيًا").
 */
function scanContent({ title = '', description = '', code = '', filename = '' }, words) {
  const hay = `${title}\n${description}\n${filename}\n${code}`.toLowerCase();
  for (const w of words || []) {
    const t = String(w || '').trim().toLowerCase();
    if (!t) continue;
    if (hay.includes(t)) return t;
  }
  return null;
}

module.exports = {
  getSettings, saveSettings, scanContent,
  DEFAULTS, DEFAULT_BANNED, BOOLEAN_DEFAULTS, BOOLEAN_KEYS, PATH,
};
