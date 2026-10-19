// Resolves a requested code name to the real file in codes/.
//
// Handles three cases:
//   1. an exact filename,
//   2. Vercel's cleanUrls stripping ".html" (/c/demo -> demo.html),
//   3. legacy names renamed by scripts/normalize-manifest.js — the previous
//      name is kept in the entry's `aliases`, so published links keep working
//      after the APP-07 filename clean-up.
//
// It returns a name taken from the manifest (never one assembled from the
// request), and callers re-validate it with validateFilename before touching
// the store.
const { readJson } = require('./_gh');
const { STATUS } = require('./_moderation');

async function resolveFilename(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;

  const { data } = await readJson('data/manifest.json', { codes: [] });
  const codes = (data.codes || []).filter((c) => c && c.filename && (!c.status || c.status === STATUS.APPROVED));
  const strip = (s) => String(s).replace(/\.[^.]+$/, '');
  const lower = raw.toLowerCase();

  const exact = codes.find((c) => c.filename === raw);
  if (exact) return exact.filename;

  const alias = codes.find((c) => Array.isArray(c.aliases)
    && c.aliases.some((a) => a === raw || String(a).toLowerCase() === lower));
  if (alias) return alias.filename;

  const base = strip(raw).toLowerCase();
  const byBase = codes.find((c) => strip(c.filename).toLowerCase() === base);
  if (byBase) return byBase.filename;

  const byPrefix = codes.find((c) => c.filename.toLowerCase().startsWith(`${lower}.`));
  if (byPrefix) return byPrefix.filename;

  const aliasBase = codes.find((c) => Array.isArray(c.aliases)
    && c.aliases.some((a) => strip(a).toLowerCase() === base));
  if (aliasBase) return aliasBase.filename;

  return null; // unknown — the caller answers 404 rather than guessing a path
}

/**
 * Validate a client-supplied name, resolve it through the manifest, and return a
 * canonical filename that passes the strict allowlist — or null.
 * Every route that takes a filename from a request uses this, so no handler
 * builds a store path out of raw input.
 */
async function resolveRequested(name) {
  const { validateRequestedName, validateFilename } = require('./_content');
  const v = validateRequestedName(name);
  if (!v.ok) return { ok: false, error: v.error };
  const strict = validateFilename(v.name);
  const resolved = await resolveFilename(v.name);
  const candidate = resolved || (strict.ok ? v.name : null);
  if (!candidate) return { ok: false, error: 'الكود غير موجود', notFound: true };
  const final = validateFilename(candidate);
  if (!final.ok) return { ok: false, error: 'اسم ملف غير صالح' };
  return { ok: true, name: final.name };
}

module.exports = { resolveFilename, resolveRequested };
