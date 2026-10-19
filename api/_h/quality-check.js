// POST /api/quality-check — the pre-publish quality card (plan 7.2.ج).
//
// Returns diagnostics instead of a blunt rejection: metadata completeness, a
// known licence, size, whether the content is executable (and therefore needs
// review), and whether it contains secret-shaped strings. Signals for the
// author and the moderator — explicitly NOT a security guarantee.
const { readBody } = require('../_auth');
const { requireUser } = require('../_guard');
const { wrap, methodGuard, noStore } = require('../_http');
const { enforce } = require('../_ratelimit');
const { qualityCard, LANGUAGE_KEYS, KNOWN_LICENSES } = require('../_content');

module.exports = wrap('quality-check', async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  noStore(res);
  const { user } = await requireUser(req, { verified: true });
  if (!(await enforce(req, res, 'submit', user.username)).allowed) return;

  const body = await readBody(req, { maxBytes: 1024 * 1024 });
  const card = qualityCard({
    title: body.title,
    description: body.description,
    language: body.language,
    code: typeof body.code === 'string' ? body.code : '',
    license: body.license,
    filename: body.filename,
  });
  res.status(200).json({ quality: card, languages: LANGUAGE_KEYS, licenses: KNOWN_LICENSES });
});
