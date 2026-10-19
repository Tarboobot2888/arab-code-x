// GET /api/raw?file=<name> — the ONLY way a stored contribution is served.
//
// codes/ is excluded from the deployment (.vercelignore) and blocked by a
// redirect rule (vercel.json), so a stored HTML/SVG file can no longer be
// fetched as a document from the application origin (SEC-02). This route hands
// the same bytes back as inert text:
//   * Content-Type: text/plain — never text/html, never sniffed (nosniff).
//   * Content-Disposition: attachment — a browser that ignores the type still
//     downloads instead of rendering.
//   * A per-response CSP of `sandbox` plus default-src 'none' so even a
//     mis-typed response cannot execute or call out.
const { getFile } = require('../_gh');
const { resolveFilename } = require('../_resolve');
const { wrap, methodGuard, HttpError } = require('../_http');
const { validateFilename, validateRequestedName } = require('../_content');

module.exports = wrap('raw', async (req, res) => {
  if (!methodGuard(req, res, ['GET', 'HEAD'])) return;

  const url = new URL(req.url, 'http://localhost');
  const requested = (req.query && req.query.file) || url.searchParams.get('file') || '';
  // Looser check first: legacy published names have no extension (APP-07).
  const v = validateRequestedName(requested);
  if (!v.ok) throw new HttpError(400, 'اسم غير صالح');

  let name = validateFilename(v.name).ok ? v.name : null;
  let f = name ? await getFile(`codes/${name}`) : null;
  if (!f) {
    // Vercel's cleanUrls strips ".html" from the address bar, so /c/demo has to
    // resolve back to demo.html through the manifest.
    const resolved = await resolveFilename(v.name);
    if (resolved && resolved !== name) {
      const rv = validateFilename(resolved);
      if (!rv.ok) throw new HttpError(404, 'غير موجود');
      name = rv.name;
      f = await getFile(`codes/${name}`);
    }
  }
  if (!f) throw new HttpError(404, 'غير موجود');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'none'; script-src 'none'");
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('X-Code-Filename', name);
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  if (req.method === 'HEAD') return res.status(200).end();
  res.status(200).send(f.content);
});
