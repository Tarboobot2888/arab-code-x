const { currentUser, readBody, isAdminEmail } = require('../_auth');
const { readJson, writeJson } = require('../_gh');
const { getSettings, scanContent } = require('../_settings');
const { verifyTurnstile, clientIp } = require('../_turnstile');

const NEZUKO_URL = 'https://nezukouploads.hidenplay.net/api/upload';
const UPLOADS_ORIGIN = 'https://nezukouploads.hidenplay.net';
const MANIFEST = 'data/zips.json';
const ALLOWED = /\.(zip|rar|7z|tar|gz|tgz|tar\.gz|tar\.xz|xz|bz2)$/i;
const MAX = 4 * 1024 * 1024;
function publicUploadUrl(url) {
  const u = new URL(url);
  const match = u.pathname.match(/^\/file\/([^/]+)$/);
  return match ? `${UPLOADS_ORIGIN}/file/${encodeURIComponent(match[1])}` : url;
}

function slugify(s) {
  return String(s || 'file').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'file';
}
function typeOf(name) {
  const m = String(name).toLowerCase().match(/\.(tar\.gz|tar\.xz|[a-z0-9]+)$/);
  return m ? m[1].toUpperCase() : 'FILE';
}
async function mustUser(req, res) {
  const u = await currentUser(req);
  if (!u) { res.status(401).json({ error: 'القسم للمسجلين فقط — سجّل دخول أولاً' }); return null; }
  if (u.banned) { res.status(403).json({ error: 'حسابك محظور' }); return null; }
  return u;
}
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX) { reject(new Error('TOO_BIG')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function list(req, res) {
  if (!(await mustUser(req, res))) return;
  const { data } = await readJson(MANIFEST, { zips: [] });
  const url = new URL(req.url, 'http://x');
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  let zips = (data.zips || []).map(({ readme, ...z }) => z);
  if (q) zips = zips.filter((z) => [z.title, z.description, z.author, (z.tags || []).join(' ')].join(' ').toLowerCase().includes(q));
  res.status(200).json({ zips });
}

async function get(req, res) {
  if (!(await mustUser(req, res))) return;
  const slug = new URL(req.url, 'http://x').searchParams.get('slug') || '';
  const { data } = await readJson(MANIFEST, { zips: [] });
  const z = (data.zips || []).find((x) => x.slug === slug);
  if (!z) return res.status(404).json({ error: 'الملف غير موجود' });
  res.status(200).json({ zip: z });
}

async function upload(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = await mustUser(req, res); if (!u) return;
  const name = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('name') || '').replace(/[^\w.\-]/g, '_').slice(0, 80);
  if (!name || !ALLOWED.test(name)) return res.status(400).json({ error: 'نوع الملف غير مدعوم (zip, rar, 7z, tar.gz ...)' });
  let buf;
  try { buf = await readRaw(req); } catch (e) {
    return res.status(413).json({ error: 'الملف أكبر من 4 ميغا' });
  }
  if (!buf.length) return res.status(400).json({ error: 'الملف فارغ' });
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/octet-stream' }), name);
  const r = await fetch(NEZUKO_URL, { method: 'POST', headers: { 'x-api-key': process.env.NEZUKO_API_KEY || 'nzk_f250ea202babe341bc1c064d168054d4f6ba14bace44eab981cc0a1b435e9992', accept: '*/*' }, body: fd });
  let j; try { j = JSON.parse(await r.text()); } catch { j = {}; }
  if (!r.ok || !j.success || !j.file || !j.file.url) return res.status(502).json({ error: 'فشل رفع الملف، حاول مرة ثانية' });
  res.status(200).json({ ok: true, url: publicUploadUrl(j.file.url), filename: j.file.filename || name, size: j.file.size || buf.length });
}

async function publish(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = await mustUser(req, res); if (!u) return;
  if (!u.verified) return res.status(403).json({ error: 'فعّل بريدك أولاً' });
  const b = await readBody(req);
  const ts = await verifyTurnstile(b.turnstile_token, clientIp(req));
  if (!ts.ok) return res.status(400).json({ error: ts.error });
  const title = String(b.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'اسم الملف مطلوب' });
  if (!b.url || !/^https:\/\/nezukouploads\.hidenplay\.net\/file\/[^/]+$/.test(b.url)) return res.status(400).json({ error: 'ارفع الملف أولاً' });
  const readme = String(b.readme || '').slice(0, 30000);
  const description = String(b.description || '').slice(0, 300);
  const isAdmin = isAdminEmail(u.email);
  const settings = await getSettings();
  if (settings.filter_enabled && !isAdmin) {
    const hit = scanContent({ title, description, code: readme }, settings.banned_words);
    if (hit) return res.status(400).json({ error: `تم رفض الملف لاحتوائه على محتوى مخالف ("${hit}")` });
  }
  const { data } = await readJson(MANIFEST, { zips: [] });
  data.zips = data.zips || [];
  const base = slugify(title); let slug = base, i = 1;
  while (data.zips.some((z) => z.slug === slug)) slug = `${base}-${i++}`;
  const tags = String(b.tags || '').split(/[,،]/).map((t) => t.trim()).filter(Boolean).slice(0, 8);
  data.zips.unshift({
    slug, title, description, readme, tags,
    version: String(b.version || '').slice(0, 30),
    thumb: /^https:\/\/nezukouploads\.hidenplay\.net\/file\/[^/]+$/.test(b.thumb || '') ? String(b.thumb).slice(0, 400) : '',
    url: b.url, filename: String(b.filename || '').slice(0, 100), type: typeOf(b.filename || b.url),
    size: Number(b.size) || 0, author: u.username, author_avatar: u.avatar_url || null,
    author_verified: isAdmin || !!u.is_verified_badge, created_at: new Date().toISOString(),
  });
  await writeJson(MANIFEST, data, `zip: +${slug} by ${u.username}`);
  res.status(200).json({ ok: true, url: '/zip/' + encodeURIComponent(slug) });
}

async function del(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = await mustUser(req, res); if (!u) return;
  const { slug } = await readBody(req);
  const { data } = await readJson(MANIFEST, { zips: [] });
  const z = (data.zips || []).find((x) => x.slug === slug);
  if (!z) return res.status(404).json({ error: 'الملف غير موجود' });
  if (!isAdminEmail(u.email) && z.author.toLowerCase() !== u.username.toLowerCase()) return res.status(403).json({ error: 'غير مسموح' });
  data.zips = data.zips.filter((x) => x.slug !== slug);
  await writeJson(MANIFEST, data, `zip: -${slug}`);
  res.status(200).json({ ok: true });
}

module.exports = { list, get, upload, publish, del };
