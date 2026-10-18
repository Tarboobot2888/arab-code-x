const { loadUsers, saveUsers, sign, setSessionCookie } = require('../_auth');

module.exports = async (req, res) => {
  const { token, u } = req.query || {};
  if (!token || !u) return res.status(400).send('رابط غير صالح');
  const data = await loadUsers();
  const user = data.users.find((x) => x.username.toLowerCase() === String(u).toLowerCase());
  if (!user || user.verification_token !== token) {
    return res.status(400).send(pageMsg('رابط التحقق غير صالح أو منتهي.', false));
  }
  user.verified = true;
  user.verification_token = null;
  await saveUsers(data, `chore: verify ${user.username}`);
  const t = sign({ u: user.username, e: user.email });
  setSessionCookie(res, t);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(pageMsg('تم تفعيل حسابك بنجاح ✓', true));
};

function pageMsg(msg, ok) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ARAB code</title>
  <link rel="stylesheet" href="/styles.css"></head>
  <body class="center-page"><div class="msg-card ${ok ? 'ok' : 'err'}">
    <div class="sphere-mini"></div><h1>${msg}</h1>
    <a href="/" class="btn primary">الذهاب للرئيسية</a>
  </div></body></html>`;
}
