// POST /api/submit — publish or queue a code contribution.
//
// Fixes (plan: SEC-02, SEC-05, APP-07, 7.1 P0):
//   * `language` is validated against a server-side allowlist and the stored
//     extension comes from that allowlist, never from the request. The audited
//     version used the submitted value directly as the file extension.
//   * Executable content (HTML/SVG) ALWAYS goes to review and is never
//     auto-published, whatever auto_approve or the author's badge says.
//   * The ban check runs here (via _guard), so a banned member cannot publish by
//     calling the API directly.
//   * The banned-word filter is kept as a moderation aid and is explicitly NOT
//     treated as a security control.
//   * Secret-shaped strings in the code force review instead of being published.
const { readBody } = require('../_auth');
const { requireUser } = require('../_guard');
const { getFile, putFile, updateJson, SKIP_WRITE } = require('../_gh');
const { getSettings, scanContent } = require('../_settings');
const { sendRejection } = require('../_mail');
const { verifyTurnstile, clientIp } = require('../_turnstile');
const { wrap, methodGuard, HttpError, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { config } = require('../_config');
const { STATUS, logDecision } = require('../_moderation');
const {
  LANGUAGES, normalizeLanguage, normalizeLicense, slugify, scanForSecrets, qualityCard,
} = require('../_content');

const MANIFEST = 'data/manifest.json';

/** Insert an approved entry into the manifest under a unique filename. */
async function publish({ title, description, language, code, license, tags, user, isAdmin, moderator }) {
  const lang = LANGUAGES[language];
  const base = slugify(title);
  let filename = null;
  const now = new Date().toISOString();

  await updateJson(MANIFEST, { codes: [] }, (manifest) => {
    if (!Array.isArray(manifest.codes)) manifest.codes = [];
    // Uniqueness is decided against the freshest manifest inside the same
    // read-modify-write, so two concurrent publishes cannot pick one name.
    let candidate = `${base}.${lang.ext}`;
    let i = 1;
    while (manifest.codes.some((c) => c.filename === candidate)) {
      candidate = `${base}-${i}.${lang.ext}`;
      i += 1;
    }
    filename = candidate;
    manifest.codes.unshift({
      filename,
      title: String(title).slice(0, 120),
      description: String(description || '').slice(0, 600),
      language,
      license: license || null,
      tags: tags || [],
      author: user.username,
      author_avatar: user.avatar_url || null,
      author_verified: isAdmin || !!user.is_verified_badge,
      admin_added: !!isAdmin,
      status: STATUS.APPROVED,
      executable: !!lang.executable,
      // Both fields are written: the audited stats handler read `published_at`
      // while the index only ever stored `approved_at` (APP-02).
      approved_at: now,
      published_at: now,
      approved_by: moderator || (isAdmin ? user.username : 'auto'),
    });
    return null;
  }, `publish: manifest +${base}.${lang.ext} by ${user.username}`);

  if (!filename) throw new HttpError(500, 'تعذّر تسجيل الكود، حاول لاحقاً');

  const codePath = `codes/${filename}`;
  const existing = await getFile(codePath, true);
  await putFile(codePath, code, `publish: ${filename} by ${user.username}`, existing && existing.sha);
  return filename;
}

module.exports = wrap('submit', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);

  const { user, isAdmin } = await requireUser(req, { verified: true });
  if (!(await enforce(req, res, 'submit', user.username)).allowed) return;

  // Code can legitimately be large; the cap is still explicit and enforced
  // while streaming (SEC-09).
  const body = await readBody(req, { maxBytes: 1024 * 1024 });
  const ts = await verifyTurnstile(body.turnstile_token, clientIp(req));
  if (!ts.ok) throw new HttpError(400, ts.error);

  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const code = typeof body.code === 'string' ? body.code : '';

  if (!title || !code.trim()) throw new HttpError(400, 'العنوان والكود مطلوبان');
  if (title.length > 120) throw new HttpError(400, 'العنوان طويل جداً');
  if (code.length > config().limits.codeChars) throw new HttpError(400, 'الكود طويل جداً');

  const language = normalizeLanguage(body.language);
  if (!language) throw new HttpError(400, 'اللغة غير مدعومة. اختر لغة من القائمة.');
  const license = normalizeLicense(body.license);
  const tags = String(body.tags || '').split(/[,،]/).map((t) => t.trim().slice(0, 24)).filter(Boolean).slice(0, 8);

  const settings = await getSettings();

  // Moderation aid only. It is a word list, not a security boundary — the
  // isolation of untrusted content is what protects the origin.
  if (settings.filter_enabled && !isAdmin) {
    const hit = scanContent({ title, description, code }, settings.banned_words);
    if (hit) {
      try {
        await sendRejection({
          to: user.email, username: user.username, title,
          reason: `تم رصد محتوى مخالف لقواعد المنصة داخل الكود أو وصفه (الكلمة المرصودة: "${hit}").`,
          auto: true,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[submit] rejection mail failed:', e.message);
      }
      await logDecision({
        actor: 'auto-filter', action: 'reject', target: `submit:${slugify(title)}`,
        from: STATUS.DRAFT, to: STATUS.REJECTED, reason: 'banned word', meta: { word: hit },
      });
      throw new HttpError(400, `تم رفض الكود (${title}) تلقائياً لمخالفته قواعد المنصة. راسل الدعم للمراجعة.`);
    }
  }

  const card = qualityCard({ title, description, language, code, license });
  const secrets = scanForSecrets(code);
  const executable = !!LANGUAGES[language].executable;

  // --- publication decision ------------------------------------------------
  // Executable content is never auto-published; neither is code that looks like
  // it carries credentials. Everything else follows the admin's settings.
  const mustReview = executable || secrets.length > 0;
  const autoAllowed = isAdmin || (!mustReview && (!!user.is_verified_badge || settings.auto_approve));

  if (autoAllowed) {
    const filename = await publish({
      title, description, language, code, license, tags, user, isAdmin,
      moderator: isAdmin ? user.username : 'auto',
    });
    await logDecision({
      actor: user.username, action: 'publish', target: `codes/${filename}`,
      from: STATUS.DRAFT, to: STATUS.APPROVED, reason: isAdmin ? 'admin' : 'auto-approve',
    });
    return res.status(200).json({ ok: true, published: true, url: `/c/${filename}`, quality: card });
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const entry = {
    id,
    status: STATUS.PENDING,
    title: title.slice(0, 120),
    description: description.slice(0, 600),
    language,
    license: license || null,
    tags,
    code,
    author: user.username,
    author_avatar: user.avatar_url || null,
    author_verified: false,
    author_is_admin: false,
    executable,
    review_flags: {
      executable,
      // Pattern ids only — the matched text is never stored or echoed back.
      secret_findings: secrets.map((s) => s.id),
      quality_score: card.score,
    },
    submitted_at: new Date().toISOString(),
  };
  const { written } = await updateJson(`pending/${id}.json`, {}, (data) => {
    if (data && data.id) return SKIP_WRITE; // id collision — astronomically unlikely
    Object.assign(data, entry);
    return null;
  }, `submit: ${user.username} - ${entry.title}`);
  if (!written) throw new HttpError(500, 'تعذّر إرسال الكود، حاول لاحقاً');

  await logDecision({
    actor: user.username, action: 'submit', target: `pending/${id}.json`,
    from: STATUS.DRAFT, to: STATUS.PENDING,
    reason: executable ? 'executable content requires review' : (secrets.length ? 'possible secrets' : 'review queue'),
  });

  res.status(200).json({
    ok: true,
    published: false,
    id,
    status: STATUS.PENDING,
    quality: card,
    message: executable
      ? 'المحتوى القابل للتنفيذ (HTML/SVG) يخضع للمراجعة قبل النشر.'
      : 'تم إرسال الكود للمراجعة.',
  });
});

module.exports.publish = publish;
