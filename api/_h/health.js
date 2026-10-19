// GET /api/health — liveness/readiness without leaking configuration.
//
// Plan 9.2: "أضف health check لا يسرّب إعدادات، وفحص readiness يتأكد من الاتصال
// بقاعدة البيانات وخدمة التخزين دون كشف أسرار."
//
// Public response: booleans and names only — never a value, host, address or
// key. `?deep=1` additionally probes the data store, and is admin-only because
// it costs an upstream request.
const { readJson } = require('../_gh');
const { config } = require('../_config');
const { backend, isDistributed } = require('../_ratelimit');
const { optionalUser } = require('../_guard');
const { wrap, methodGuard, noStore } = require('../_http');

module.exports = wrap('health', async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;
  noStore(res);
  const cfg = config();

  const out = {
    status: cfg.ok ? 'ok' : 'misconfigured',
    time: new Date().toISOString(),
    checks: {
      // Presence only. No value of any of these is ever returned.
      session_secret: !!cfg.jwtSecret && cfg.problems.every((p) => !p.includes('JWT_SECRET')),
      admin_identity: !!cfg.adminEmail,
      public_base_url: !!cfg.publicBaseUrl,
      store_configured: !!cfg.github.repo && (!cfg.production || !!cfg.github.token),
      mail_configured: cfg.mailEnabled,
      bot_protection: !!cfg.turnstileSecret,
      google_login: cfg.googleConfigured,
      uploads: cfg.uploadsEnabled,
      database_configured: !!cfg.databaseUrl,
      untrusted_content_isolated: !!cfg.untrustedContentOrigin,
      rate_limit_distributed: isDistributed(),
    },
    rate_limit_backend: backend(),
    // Counts only; the reasons themselves name variables and are logged
    // server-side, so they are not echoed to anonymous callers.
    config_problems: cfg.problems.length,
    config_warnings: cfg.warnings.length,
  };

  const { isAdmin } = await optionalUser(req);
  if (isAdmin) {
    // Admins get the variable NAMES (still never the values) and a live probe.
    out.problems = cfg.problems;
    out.warnings = cfg.warnings;
    if (new URL(req.url, 'http://localhost').searchParams.get('deep')) {
      const started = Date.now();
      try {
        const { data } = await readJson('data/manifest.json', { codes: [] });
        out.store = { reachable: true, latency_ms: Date.now() - started, codes: (data.codes || []).length };
      } catch (e) {
        out.store = { reachable: false, latency_ms: Date.now() - started, error: e.message };
        out.status = 'degraded';
      }
    }
  }

  res.status(out.status === 'ok' ? 200 : 503).json(out);
});
