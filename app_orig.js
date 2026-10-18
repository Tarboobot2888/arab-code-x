// Shared client helpers
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function avatarLetter(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

// Always resolves the LIVE avatar coming from the API (never a stale snapshot).
function avatarUrl(entry) {
  if (!entry) return null;
  return entry.avatar_url || entry.author_avatar || entry.avatar || null;
}

function avatarNode(user, size = '') {
  const name = typeof user === 'string' ? user : (user && (user.username || user.author)) || '?';
  const url = typeof user === 'object' ? avatarUrl(user) : null;
  const cls = 'avatar' + (size ? ' ' + size : '');
  if (url) return `<span class="${cls}"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy"></span>`;
  return `<span class="${cls}">${esc(avatarLetter(name))}</span>`;
}

function verifiedBadge(title) {
  return `<span class="verified-badge" title="${esc(title || 'حساب موثّق')}">
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="#a259ff" d="M12 1l2.6 2.1 3.3-.3.8 3.2 3 1.5-1.2 3.1 1.2 3.1-3 1.5-.8 3.2-3.3-.3L12 20l-2.6-1.9-3.3.3-.8-3.2-3-1.5 1.2-3.1L2.3 7.5l3-1.5.8-3.2 3.3.3z"/>
      <path fill="#fff" d="M10.6 14.2l-2.4-2.4 1.1-1.1 1.3 1.3 3.7-3.7 1.1 1.1z"/>
    </svg>
  </span>`;
}

// Single source of truth for "is this author verified?" across every page.
function isVerified(entry) {
  if (!entry) return false;
  return !!(entry.author_verified || entry.is_verified_badge || entry.is_admin || entry.author_is_admin);
}

function authorLink(entry, opts = {}) {
  const username = entry.author || entry.username || 'unknown';
  const name = entry.author_display || entry.display_name || username;
  return `<a href="/u/${encodeURIComponent(username)}" class="author" onclick="event.stopPropagation()">
    ${avatarNode({ username, avatar_url: avatarUrl(entry) }, opts.size || 'sm')}
    <span class="uname">${esc(name)}</span>
    ${isVerified(entry) ? verifiedBadge() : ''}
  </a>`;
}

async function loadMe() {
  try { const { user, ban } = await api('/api/me'); if (user) user.ban = ban || null; return user; } catch { return null; }
}

async function renderNav() {
  const el = document.getElementById('nav-actions');
  if (!el) return;
  const me = await loadMe();
  const searchBtn = `<button class="icon-btn" title="بحث" onclick="openSearch()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg></button>`;
  if (me) {
    const adminLink = me.is_admin ? `<a class="btn ghost" href="/admin">الإدارة</a>` : '';
    el.innerHTML = `${searchBtn}
      <a class="btn" href="/submit">+ كود</a>
      ${adminLink}
      ${authorLink({ username: me.username, author_avatar: me.avatar_url, author_verified: me.is_verified_badge })}
      <button class="icon-btn" title="خروج" onclick="doLogout()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>`;
  } else {
    el.innerHTML = `${searchBtn}<a class="btn primary" href="/auth">دخول</a>`;
  }
}

async function doLogout() { await api('/api/logout', { method: 'POST' }); location.href = '/'; }

// Search overlay
function ensureSearchOverlay() {
  if (document.getElementById('search-overlay')) return;
  const div = document.createElement('div');
  div.id = 'search-overlay';
  div.className = 'search-overlay';
  div.innerHTML = `<div class="search-box">
    <input id="search-input" type="text" placeholder="ابحث عن كود..." autocomplete="off"/>
    <div class="search-results grid" id="search-results"></div>
  </div>`;
  div.addEventListener('click', (e) => { if (e.target === div) closeSearch(); });
  document.body.appendChild(div);
  const input = div.querySelector('#search-input');
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(runSearch, 250); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
}
function openSearch() { ensureSearchOverlay(); document.getElementById('search-overlay').classList.add('open'); document.getElementById('search-input').focus(); }
function closeSearch() { const o = document.getElementById('search-overlay'); if (o) o.classList.remove('open'); }
async function runSearch() {
  const q = document.getElementById('search-input').value.trim();
  const box = document.getElementById('search-results');
  if (!q) { box.innerHTML = ''; return; }
  try {
    const { codes } = await api('/api/search?q=' + encodeURIComponent(q));
    if (!codes.length) { box.innerHTML = '<p style="color:var(--muted);text-align:center;padding:30px">لا نتائج</p>'; return; }
    box.innerHTML = codes.map(codeCard).join('');
  } catch (e) { box.innerHTML = `<p style="color:var(--danger)">${esc(e.message)}</p>`; }
}

function codeCard(c, opts = {}) {
  const file = c.filename || c.title;
  const likes = opts.likes != null ? opts.likes : (c.like_count != null ? c.like_count : null);
  const likeBadge = likes !== null
    ? `<span style="color:${likes > 0 ? '#e05252' : 'var(--muted)'};font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">${heartSvg(likes > 0)} ${likes}</span>`
    : '';
  return `<article class="code-card" onclick="location.href='/c/${encodeURIComponent(file)}'">
    <div>
      <h3 class="card-title">${esc(c.title || file)}${c.admin_added ? ' <span class="admin-mark" title="مضاف من الإدارة">' + verifiedBadge('مضاف من الإدارة') + '</span>' : ''}</h3>
      <p class="card-desc">${esc(c.description || 'لا يوجد وصف لهذا الكود')}</p>
    </div>
    <div class="card-footer">
      ${authorLink(c)}
      <span class="lang-badge">${esc(c.language || 'txt')}</span>
      ${likeBadge}
    </div>
  </article>`;
}

window.api = api; window.esc = esc;
window.avatarNode = avatarNode; window.avatarUrl = avatarUrl; window.isVerified = isVerified; window.authorLink = authorLink; window.verifiedBadge = verifiedBadge;
window.renderNav = renderNav; window.doLogout = doLogout;
window.openSearch = openSearch; window.closeSearch = closeSearch;
window.codeCard = codeCard; window.loadMe = loadMe;

// --- Interaction helpers (comments / likes / reports / ban overlay) ---
function heartSvg(filled) {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="${filled ? '#e05252' : 'none'}" stroke="${filled ? '#e05252' : 'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}
async function loadLike(code) {
  try { return await api('/api/likes?code=' + encodeURIComponent(code)); } catch { return { like: false, total: 0 }; }
}
async function toggleLike(code) {
  return api('/api/likes', { method: 'POST', body: JSON.stringify({ code }) });
}
async function loadComments(code) {
  try { const r = await api('/api/comments?code=' + encodeURIComponent(code)); return r.comments || []; } catch { return []; }
}
// Warning check BEFORE sending a comment/report. Returns { ok } or { ok:false, warning }.
async function checkProfanity(text) {
  try {
    await api('/api/report-check', { method: 'POST', body: JSON.stringify({ text }) });
    return { ok: true };
  } catch (e) {
    let msg = e.message;
    try { const d = JSON.parse(msg.replace(/^HTTP \d+:\s*/, '')); msg = d.warning || d.error || msg; } catch {}
    return { ok: false, warning: msg };
  }
}
async function submitReport(text) {
  return api('/api/reports', { method: 'POST', body: JSON.stringify({ text }) });
}
async function renderBanOverlay(me) {
  if (!me || !me.ban) return;
  if (document.getElementById('ban-overlay')) return;
  const div = document.createElement('div');
  div.id = 'ban-overlay';
  div.innerHTML = `<div style="position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:rgba(5,5,5,.92);">
    <div style="max-width:460px;width:100%;background:#12100a;border:2px solid #e05252;border-radius:22px;padding:34px 28px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6);">
      <div style="width:74px;height:74px;margin:0 auto 16px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#e05252 0%,#5c1212 100%);display:grid;place-items:center;font-size:34px;">🚫</div>
      <h2 style="margin:0 0 12px;color:#e05252;font-size:22px;">تم إغلاق هذا الحساب</h2>
      <p style="margin:0 0 8px;color:#d8c9a3;font-size:15px;line-height:1.9;">لقد تم غلق هذا الحساب لأسباب أمنية${me.ban.reason ? ' (<b>' + esc(me.ban.reason) + '</b>)' : ''}.</p>
      <p style="margin:14px 0 0;color:#a08454;font-size:13.5px;line-height:1.8;">يمكنك التواصل مع الدعم عبر تطبيق واتساب لإعادة تفعيل حسابك، اضغط على الزر أدناه.</p>
      <div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <a href="https://wa.me/249918614328" style="display:inline-flex;align-items:center;gap:8px;padding:13px 28px;background:linear-gradient(135deg,#5ce18b,#25d366);color:#0a0a0a;text-decoration:none;font-weight:800;border-radius:12px;font-size:15px;">💬 واتساب — التواصل مع الدعم</a>
      </div>
    </div>
  </div>`;
  document.body.appendChild(div);
  document.body.style.overflow = 'hidden';
}
window.heartSvg = heartSvg; window.loadLike = loadLike; window.toggleLike = toggleLike;
window.loadComments = loadComments; window.checkProfanity = checkProfanity;
window.submitReport = submitReport; window.renderBanOverlay = renderBanOverlay;
