// Single source of truth for runtime configuration.
//
// Rules enforced here (plan: SEC-04, SEC-07, APP-05, APP-09, ملحق ب):
//   * No secret is ever hardcoded and no "fallback" value may let the service run
//     in an insecure configuration in production.
//   * Missing required configuration fails CLOSED: the router answers 503 with a
//     generic message, and the detailed reason is logged server-side only.
//   * Outside production a missing JWT secret produces an EPHEMERAL random key
//     (sessions simply don't survive a restart) — never a shared known constant.
//
// Nothing in this file is allowed to print a secret value.
const crypto = require('crypto');

const PROD_ENVS = new Set(['production']);

function env(name) {
  const v = process.env[name];
  return v === undefined || v === null ? '' : String(v).trim();
}

function isProduction() {
  // Vercel sets VERCEL_ENV to production | preview | development.
  const vercelEnv = env('VERCEL_ENV');
  if (vercelEnv) return PROD_ENVS.has(vercelEnv);
  return env('NODE_ENV') === 'production';
}

function bool(name, dflt) {
  const v = env(name).toLowerCase();
  if (!v) return dflt;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function int(name, dflt) {
  const n = parseInt(env(name), 10);
  return Number.isFinite(n) ? n : dflt;
}

const MIN_SECRET_LEN = 32;

// Per-process ephemeral key for local development only. Regenerated on every
// cold start, so a leaked build artefact can never be used to forge a session.
let ephemeralSecret = null;
function devSecret() {
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(48).toString('hex');
    // eslint-disable-next-line no-console
    console.warn('[config] JWT_SECRET is not set — using an ephemeral development key. Sessions reset on restart.');
  }
  return ephemeralSecret;
}

function build() {
  const production = isProduction();
  const problems = [];
  const warnings = [];

  // ---- sessions -----------------------------------------------------------
  let jwtSecret = env('JWT_SECRET');
  if (!jwtSecret) {
    if (production) problems.push('JWT_SECRET is required in production');
    else jwtSecret = devSecret();
  } else if (jwtSecret.length < MIN_SECRET_LEN) {
    const msg = `JWT_SECRET must be at least ${MIN_SECRET_LEN} characters`;
    if (production) problems.push(msg);
    else warnings.push(msg);
  }
  // Known placeholder values are rejected everywhere.
  if (/^(change-?me|secret|test|changeit|password)$/i.test(jwtSecret)) {
    problems.push('JWT_SECRET is a placeholder value');
  }

  // ---- identity -----------------------------------------------------------
  const adminEmail = env('ADMIN_EMAIL').toLowerCase();
  if (!adminEmail) problems.push('ADMIN_EMAIL is required');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) problems.push('ADMIN_EMAIL is not a valid address');

  // ---- public origin ------------------------------------------------------
  // Security-relevant links (verification, reset, OAuth redirect) must never be
  // built from a client-controlled Host header when a trusted value exists.
  let publicBaseUrl = env('PUBLIC_BASE_URL').replace(/\/+$/, '');
  if (!publicBaseUrl) {
    if (production) problems.push('PUBLIC_BASE_URL is required in production');
  } else if (!/^https?:\/\//i.test(publicBaseUrl)) {
    problems.push('PUBLIC_BASE_URL must be an absolute http(s) URL');
  }

  // Origin that serves untrusted, user-submitted executable content. It MUST NOT
  // be the application origin (plan 5.3) — community content may never run with
  // the platform's cookies.
  const untrustedContentOrigin = env('UNTRUSTED_CONTENT_ORIGIN').replace(/\/+$/, '');
  if (untrustedContentOrigin && publicBaseUrl) {
    try {
      if (new URL(untrustedContentOrigin).host === new URL(publicBaseUrl).host) {
        problems.push('UNTRUSTED_CONTENT_ORIGIN must differ from PUBLIC_BASE_URL');
      }
    } catch { problems.push('UNTRUSTED_CONTENT_ORIGIN is not a valid URL'); }
  }

  // ---- storage (GitHub, transitional) -------------------------------------
  const githubRepo = env('GITHUB_REPO');
  const githubToken = env('GITHUB_TOKEN');
  const githubBranch = env('GITHUB_BRANCH') || 'main';
  if (!githubRepo) problems.push('GITHUB_REPO is required while GitHub is the operational store');
  else if (!/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) problems.push('GITHUB_REPO must look like owner/repo');
  if (!githubToken && production) problems.push('GITHUB_TOKEN is required in production');

  // ---- mail ---------------------------------------------------------------
  const smtp = {
    host: env('SMTP_HOST'),
    port: int('SMTP_PORT', 465),
    secure: bool('SMTP_SECURE', true),
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
  };
  const mailEnabled = !!(smtp.host && smtp.user && smtp.pass);
  if (!mailEnabled && production) {
    warnings.push('SMTP_* is incomplete — verification and reset mail will fail');
  }

  // ---- bot protection -----------------------------------------------------
  const turnstileSecret = env('TURNSTILE_SECRET_KEY');
  if (!turnstileSecret && production) {
    problems.push('TURNSTILE_SECRET_KEY is required in production (verification must not be skipped silently)');
  }

  // ---- Google OAuth -------------------------------------------------------
  const google = {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
  };
  const googleConfigured = !!(google.clientId && google.clientSecret);

  // ---- external file uploads ---------------------------------------------
  // UPLOADS_API_KEY is the current name; NEZUKO_API_KEY is accepted during the
  // transition. There is deliberately NO default: upload routes refuse to run
  // without an explicitly configured key.
  const uploads = {
    apiKey: env('UPLOADS_API_KEY') || env('NEZUKO_API_KEY'),
    apiUrl: env('UPLOADS_API_URL') || 'https://nezukouploads.hidenplay.net/api/upload',
    publicOrigin: (env('UPLOADS_PUBLIC_ORIGIN') || 'https://nezukouploads.hidenplay.net').replace(/\/+$/, ''),
    timeoutMs: int('UPLOADS_TIMEOUT_MS', 15000),
  };
  const uploadsEnabled = !!uploads.apiKey;
  if (!uploadsEnabled) warnings.push('UPLOADS_API_KEY is not set — avatar and archive uploads are disabled');

  // ---- database (migration target, optional until cut-over) ---------------
  const databaseUrl = env('DATABASE_URL');

  const cfg = {
    production,
    jwtSecret,
    adminEmail,
    publicBaseUrl,
    untrustedContentOrigin,
    github: { repo: githubRepo, token: githubToken, branch: githubBranch },
    smtp,
    mailEnabled,
    turnstileSecret,
    google,
    googleConfigured,
    uploads,
    uploadsEnabled,
    databaseUrl,
    // Operational knobs (safe, non-secret).
    limits: {
      jsonBodyBytes: int('MAX_JSON_BODY_BYTES', 256 * 1024),
      codeChars: int('MAX_CODE_CHARS', 200000),
      avatarBytes: int('MAX_AVATAR_BYTES', 3 * 1024 * 1024),
      archiveBytes: int('MAX_ARCHIVE_BYTES', 4 * 1024 * 1024),
    },
    problems,
    warnings,
    ok: problems.length === 0,
  };
  return Object.freeze(cfg);
}

let cached = null;
function config() {
  if (!cached) cached = build();
  return cached;
}
// Tests change process.env between cases.
function reset() { cached = null; ephemeralSecret = null; }

// Absolute URL for a security-relevant link. Falls back to the request host only
// when no trusted base URL is configured (never in production — build() refuses).
function baseUrl(req) {
  const c = config();
  if (c.publicBaseUrl) return c.publicBaseUrl;
  const host = (req && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost';
  return `https://${String(host).split(',')[0].trim()}`;
}

function requireConfigured(res) {
  const c = config();
  if (c.ok) return true;
  // Log the reasons (names only — never values) and answer generically.
  // eslint-disable-next-line no-console
  console.error('[config] service is misconfigured:', c.problems.join(' | '));
  if (res && !res.headersSent) {
    res.status(503).json({ error: 'الخدمة غير مهيّأة بشكل صحيح. تواصل مع الإدارة.' });
  }
  return false;
}

module.exports = { config, reset, baseUrl, isProduction, requireConfigured, MIN_SECRET_LEN };
