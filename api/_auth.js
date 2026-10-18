const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { readJson, writeJson } = require('./_gh');

const SECRET = process.env.JWT_SECRET || 'change-me';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '3rab_top_devs@top.com').toLowerCase();
const USERS_PATH = 'data/users.json';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function sign(payload) { return jwt.sign(payload, SECRET, { expiresIn: '30d' }); }
function verify(token) { try { return jwt.verify(token, SECRET); } catch { return null; } }

function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  h.split(';').forEach((c) => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', [
    `session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
  ]);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', ['session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0']);
}

async function loadUsers() {
  const { data } = await readJson(USERS_PATH, { users: [] });
  if (!data.users) data.users = [];
  return data;
}
async function saveUsers(data, msg) {
  await writeJson(USERS_PATH, data, msg || 'chore: update users');
}

function isAdminEmail(email) { return (email || '').toLowerCase() === ADMIN_EMAIL; }

function publicUser(u) {
  if (!u) return null;
  const admin = isAdminEmail(u.email);
  return {
    username: u.username,
    display_name: u.display_name || u.username,
    email: u.email,
    verified: !!u.verified,
    is_admin: admin,
    is_verified_badge: admin || !!u.is_verified_badge,
    avatar_url: u.avatar_url || null,
    bio: u.bio || '',
    links: Array.isArray(u.links) ? u.links : [],
    created_at: u.created_at,
  };
}

async function currentUser(req) {
  const cookies = parseCookies(req);
  const t = cookies.session;
  if (!t) return null;
  const p = verify(t);
  if (!p) return null;
  const { users } = await loadUsers();
  const u = users.find((x) => x.username.toLowerCase() === p.u.toLowerCase());
  return u || null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function randomToken(n = 24) { return crypto.randomBytes(n).toString('hex'); }

module.exports = {
  bcrypt, jwt, sign, verify, parseCookies, setSessionCookie, clearSessionCookie,
  loadUsers, saveUsers, currentUser, publicUser, readBody, randomToken,
  isAdminEmail, ADMIN_EMAIL, EMAIL_RE, USERNAME_RE, SECRET,
};
