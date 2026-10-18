const { readJson } = require('./_gh');

// Resolves a requested code name to the real file in codes/.
// Handles Vercel cleanUrls stripping ".html" (e.g. /c/demo.html -> /c/demo).
async function resolveFilename(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const { data } = await readJson('data/manifest.json', { codes: [] });
  const codes = data.codes || [];
  const strip = (s) => String(s).replace(/\.[^.]+$/, '');

  const exact = codes.find((c) => c.filename === raw);
  if (exact) return exact.filename;

  const base = strip(raw);
  const byBase = codes.find((c) => strip(c.filename) === base);
  if (byBase) return byBase.filename;

  const byPrefix = codes.find((c) => c.filename.startsWith(raw + '.'));
  if (byPrefix) return byPrefix.filename;

  return raw;
}

module.exports = { resolveFilename };
