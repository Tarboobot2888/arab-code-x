// Arabic + English search normalisation (plan 7.1 P0: "بحث بالعربية
// والإنجليزية مع تطبيع الهمزات/التشكيل والمسافات").
//
// Without normalisation a search for "اضافة" misses a code titled "إضافة", and
// "تشكيل" with diacritics misses the same word without them. The audited handler
// did a plain lowercase substring match, so Arabic lookups mostly failed.

// Arabic diacritics (harakat), tatweel and the Quranic marks block.
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
// Zero-width / bidi control characters that get pasted in from editors.
const INVISIBLES = /[​-‏‪-‮⁦-⁩﻿]/g;

const FOLD_MAP = new Map(Object.entries({
  // hamza forms -> bare alef
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ٲ': 'ا', 'ٳ': 'ا',
  // ya / alef maqsura
  'ى': 'ي', 'ئ': 'ي', 'ۍ': 'ي', 'ێ': 'ي', 'ی': 'ي',
  // waw with hamza
  'ؤ': 'و', 'ٶ': 'و', 'ٷ': 'و',
  // ta marbuta -> ha
  'ة': 'ه',
  // kaf / heh variants used in Persian/Urdu keyboards
  'ك': 'ك', 'ک': 'ك', 'ګ': 'ك', 'ہ': 'ه', 'ھ': 'ه',
  // standalone hamza
  'ء': '',
}));

// Arabic-Indic and Eastern Arabic-Indic digits -> ASCII.
const DIGITS = new Map();
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => DIGITS.set(d, String(i)));
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => DIGITS.set(d, String(i)));

/**
 * Fold a string into its searchable form:
 * NFKC → strip invisibles → strip diacritics/tatweel → unify hamza/ya/ta-marbuta
 * → normalise digits → lowercase → collapse whitespace and most punctuation.
 */
function normalize(input) {
  let s = String(input == null ? '' : input);
  try { s = s.normalize('NFKC'); } catch { /* older ICU — continue unfolded */ }
  s = s.replace(INVISIBLES, '').replace(DIACRITICS, '');
  let out = '';
  for (const ch of s) {
    if (FOLD_MAP.has(ch)) { out += FOLD_MAP.get(ch); continue; }
    if (DIGITS.has(ch)) { out += DIGITS.get(ch); continue; }
    out += ch;
  }
  return out
    .toLowerCase()
    // Keep letters, digits, and the separators that matter in filenames.
    .replace(/[^\p{L}\p{N}._/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a query into normalised terms (every term must match: AND). */
function terms(query) {
  const n = normalize(query);
  if (!n) return [];
  return [...new Set(n.split(' ').filter((t) => t.length >= 1))].slice(0, 10);
}

/** The haystack for one manifest entry. */
function haystack(code) {
  return normalize([
    code.title, code.description, code.filename, code.author,
    code.language, code.license, Array.isArray(code.tags) ? code.tags.join(' ') : '',
  ].filter(Boolean).join(' \n '));
}

/** Simple relevance: title hits beat description hits, exact term beats prefix. */
function score(code, queryTerms) {
  const title = normalize(code.title);
  const name = normalize(code.filename);
  const hay = haystack(code);
  let total = 0;
  for (const t of queryTerms) {
    if (!hay.includes(t)) return 0; // AND semantics
    if (title === t || name === t) total += 100;
    else if (title.startsWith(t) || name.startsWith(t)) total += 40;
    else if (title.includes(t)) total += 25;
    else total += 8;
  }
  return total;
}

/**
 * Filter + rank + paginate.
 * @param {Array} codes
 * @param {object} opts { q, language, tag, license, author, sort, page, perPage }
 */
function searchCodes(codes, opts = {}) {
  const list = Array.isArray(codes) ? codes : [];
  const queryTerms = terms(opts.q);
  const language = opts.language ? normalize(opts.language) : '';
  const tag = opts.tag ? normalize(opts.tag) : '';
  const license = opts.license ? String(opts.license).toLowerCase() : '';
  const author = opts.author ? normalize(opts.author) : '';

  let rows = list;
  if (language) rows = rows.filter((c) => normalize(c.language) === language);
  if (license) rows = rows.filter((c) => String(c.license || '').toLowerCase() === license);
  if (author) rows = rows.filter((c) => normalize(c.author) === author);
  if (tag) rows = rows.filter((c) => (Array.isArray(c.tags) ? c.tags : []).some((t) => normalize(t) === tag));

  let scored;
  if (queryTerms.length) {
    scored = rows.map((c) => ({ c, s: score(c, queryTerms) })).filter((x) => x.s > 0);
  } else {
    scored = rows.map((c) => ({ c, s: 0 }));
  }

  const dateOf = (c) => Date.parse(c.published_at || c.approved_at || 0) || 0;
  if (opts.sort === 'newest' || !queryTerms.length) scored.sort((a, b) => dateOf(b.c) - dateOf(a.c));
  else if (opts.sort === 'oldest') scored.sort((a, b) => dateOf(a.c) - dateOf(b.c));
  else scored.sort((a, b) => b.s - a.s || dateOf(b.c) - dateOf(a.c));

  const perPage = Math.min(60, Math.max(1, parseInt(opts.perPage, 10) || 24));
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const total = scored.length;
  const slice = scored.slice((page - 1) * perPage, page * perPage).map((x) => x.c);

  return {
    codes: slice,
    total,
    page,
    per_page: perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    terms: queryTerms,
  };
}

/** Helpful suggestions when a search comes back empty (plan 7.1 P0). */
function suggestions(codes, opts = {}) {
  const list = Array.isArray(codes) ? codes : [];
  const langs = {};
  const tags = {};
  for (const c of list) {
    if (c.language) langs[c.language] = (langs[c.language] || 0) + 1;
    for (const t of (Array.isArray(c.tags) ? c.tags : [])) tags[t] = (tags[t] || 0) + 1;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ value: k, count: v }));

  // Closest titles by shared normalised prefix, so a typo still finds something.
  const qt = terms(opts.q);
  let near = [];
  if (qt.length) {
    const head = qt[0].slice(0, 3);
    near = list
      .filter((c) => head && normalize(c.title).includes(head))
      .slice(0, 6)
      .map((c) => ({ filename: c.filename, title: c.title }));
  }
  return { languages: top(langs, 8), tags: top(tags, 12), near };
}

module.exports = { normalize, terms, haystack, score, searchCodes, suggestions };
