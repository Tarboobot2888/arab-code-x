const crypto = require('crypto');
const {
  bcrypt, loadUsers, saveUsers, sign, setSessionCookie, USERNAME_RE, ADMIN_EMAIL,
} = require('../_auth');
const { sendWelcomeCredentials } = require('../_mail');
const { getSettings } = require('../_settings');

function baseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`).replace(/\/+$/, '');
}
function redirectUri(req) {
  return `${baseUrl(req)}/api/google-callback`;
}

function genPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789@#$%';
  let out = '';
  const buf = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) out += chars[buf[i] % chars.length];
  return out;
}

function uniqueUsername(users, email, name) {
  let base = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (base.length < 3) base = ('dev' + base).slice(0, 20);
  base = base.slice(0, 16);
  if (!USERNAME_RE.test(base)) base = 'dev' + Math.floor(Math.random() * 1000);
  let candidate = base;
  let i = 1;
  const taken = new Set(users.map((u) => u.username.toLowerCase()));
  while (taken.has(candidate.toLowerCase())) candidate = `${base}${++i}`.slice(0, 20);
  return candidate;
}

// GET /api/google -> redirect to Google consent
async function start(req, res) {
  const s = await getSettings();
  if (s.google_login_enabled === false) return res.status(403).send('تسجيل الدخول بجوجل معطّل حالياً');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).send('GOOGLE_CLIENT_ID غير مضبوط في متغيرات البيئة');
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', [
    `g_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
  ]);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

function decodeIdToken(idToken) {
  const part = String(idToken || '').split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch { return null; }
}

function fail(res, msg) {
  res.writeHead(302, { Location: '/auth?error=' + encodeURIComponent(msg) });
  res.end();
}

// GET /api/google-callback
async function callback(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookieState = (req.headers.cookie || '').split(';').map((c) => c.trim())
      .find((c) => c.startsWith('g_state='));
    if (!code) return fail(res, 'تم إلغاء تسجيل الدخول بجوجل');
    if (!cookieState || decodeURIComponent(cookieState.split('=')[1]) !== state) {
      return fail(res, 'جلسة جوجل غير صالحة، حاول مرة أخرى');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok) return fail(res, 'فشل التحقق مع جوجل');
    const claims = decodeIdToken(tok.id_token);
    const email = (claims && claims.email || '').toLowerCase();
    if (!email || claims.email_verified === false) return fail(res, 'بريد جوجل غير مُفعّل');

    const data = await loadUsers();
    let user = data.users.find((u) => (u.email || '').toLowerCase() === email);
    let plainPassword = null;

    if (!user) {
      const s = await getSettings();
      if (s.signup_enabled === false) return fail(res, 'التسجيل الجديد متوقف مؤقتاً');
      plainPassword = genPassword();
      const username = uniqueUsername(data.users, email, claims.name);
      user = {
        username,
        email,
        phone: '',
        password_hash: await bcrypt.hash(plainPassword, 10),
        display_name: claims.name || username,
        avatar_url: claims.picture || null,
        verified: true,
        is_verified_badge: email === ADMIN_EMAIL,
        provider: 'google',
        created_at: new Date().toISOString(),
      };
      data.users.push(user);
      await saveUsers(data, `chore: google signup ${username}`);
    } else if (!user.verified) {
      user.verified = true;
      user.verification_token = null;
      if (!user.avatar_url && claims.picture) user.avatar_url = claims.picture;
      await saveUsers(data, `chore: google verify ${user.username}`);
    }

    if (plainPassword) {
      try {
        await sendWelcomeCredentials({
          to: email,
          display: user.display_name || user.username,
          username: user.username,
          password: plainPassword,
          loginUrl: `${baseUrl(req)}/auth`,
        });
      } catch (e) { console.error('welcome mail error', e); }
    }

    setSessionCookie(res, sign({ u: user.username, e: user.email }));
    res.setHeader('Set-Cookie', [
      ...[].concat(res.getHeader('Set-Cookie') || []),
      'g_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    ]);
    const dest = email === ADMIN_EMAIL ? '/admin' : (plainPassword ? '/?welcome=1' : '/');
    res.writeHead(302, { Location: dest });
    res.end();
  } catch (e) {
    console.error('google callback error:', e);
    fail(res, 'خطأ داخلي أثناء الدخول بجوجل');
  }
}

module.exports = { start, callback };
