// Minimal server-rendered confirmation page, shared by /api/verify and
// /api/confirm-email (it was duplicated in both handlers before).
// The message is always escaped even though every caller passes a constant.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function page(msg, ok) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ARAB code</title>
<link rel="stylesheet" href="/styles.css"></head>
<body class="center-page"><main class="msg-card ${ok ? 'ok' : 'err'}" role="status" aria-live="polite">
  <div class="sphere-mini" aria-hidden="true"></div><h1>${escapeHtml(msg)}</h1>
  <a href="/" class="btn primary">الذهاب للرئيسية</a>
</main></body></html>`;
}

module.exports = { page, escapeHtml };
