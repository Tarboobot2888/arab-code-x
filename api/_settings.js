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

const DEFAULTS = {
  auto_approve: false,
  filter_enabled: true,
  // When true, any user can delete their own code instantly (no admin request).
  direct_delete: false,
  // When false, the "طلب حذف" flow is disabled entirely.
  delete_requests_enabled: true,
  // Google one-click sign-in.
  google_login_enabled: true,
  // Master switch for new account creation (email + google).
  signup_enabled: true,
  // Account self-service features.
  email_change_enabled: true,
  username_change_enabled: true,
  account_delete_enabled: true,
  banned_words: DEFAULT_BANNED,
};

const bool = (v, d) => (v === undefined ? d : !!v);

async function getSettings() {
  const { data } = await readJson(PATH, {});
  return {
    auto_approve: bool(data.auto_approve, false),
    filter_enabled: bool(data.filter_enabled, true),
    direct_delete: bool(data.direct_delete, false),
    delete_requests_enabled: bool(data.delete_requests_enabled, true),
    google_login_enabled: bool(data.google_login_enabled, true),
    signup_enabled: bool(data.signup_enabled, true),
    email_change_enabled: bool(data.email_change_enabled, true),
    username_change_enabled: bool(data.username_change_enabled, true),
    account_delete_enabled: bool(data.account_delete_enabled, true),
    banned_words: Array.isArray(data.banned_words) && data.banned_words.length
      ? data.banned_words
      : DEFAULT_BANNED,
  };
}

async function saveSettings(next) {
  await writeJson(PATH, next, 'settings: update');
  return next;
}

// Returns the matched banned word, or null when clean.
function scanContent({ title = '', description = '', code = '', filename = '' }, words) {
  const hay = `${title}\n${description}\n${filename}\n${code}`.toLowerCase();
  for (const w of words || []) {
    const t = String(w || '').trim().toLowerCase();
    if (!t) continue;
    if (hay.includes(t)) return t;
  }
  return null;
}

module.exports = { getSettings, saveSettings, scanContent, DEFAULTS, DEFAULT_BANNED };
