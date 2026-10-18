// Shared client helpers
// Spam Protection: simple lock for interactive requests
const API_LOCKS = new Set();
async function api(path, opts = {}, retries = 2) {
  const isWrite = !!(opts.method && opts.method !== 'GET');
  const lockKey = `${opts.method || 'GET'}:${path.split('?')[0]}`;
  // Block accidental double-clicks on writes. Throw (never return a fake object)
  // so callers don't read properties of an unexpected response.
  if (isWrite && API_LOCKS.has(lockKey)) throw new Error('الطلب قيد التنفيذ، انتظر لحظة...');
  if (isWrite) API_LOCKS.add(lockKey);
  try {
    let res;
    try {
      res = await fetch(path, {
        credentials: 'same-origin',
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      });
    } catch (netErr) {
      // Only retry network failures on safe (GET) requests — never replay writes.
      if (!isWrite && retries > 0) {
        await new Promise(r => setTimeout(r, 800));
        return api(path, opts, retries - 1);
      }
      throw new Error('تعذّر الاتصال بالخادم، تحقق من الإنترنت');
    }
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      if (!isWrite && res.status >= 500 && retries > 0) {
        await new Promise(r => setTimeout(r, 800));
        return api(path, opts, retries - 1);
      }
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  } finally {
    if (isWrite) API_LOCKS.delete(lockKey);
  }
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

function eagleBadge(title) {
  return `<span class="eagle-badge" title="${esc(title || 'شارة المنصة')}"><img src="/assets/brand/logo.png"></span>`;
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
  const isAdmin = entry.is_admin || entry.author_is_admin || (username.toLowerCase() === 'ziad');
  return `<a href="/u/${encodeURIComponent(username)}" class="author" onclick="event.stopPropagation()">
    ${avatarNode({ username, avatar_url: avatarUrl(entry) }, opts.size || 'sm')}
    <span class="uname">${esc(name)}</span>
    ${isVerified(entry) ? verifiedBadge() : ''}
    ${isAdmin ? eagleBadge() : ''}
  </a>`;
}

async function loadMe() {
  try { const { user, ban } = await api('/api/me'); if (user) user.ban = ban || null; return user; } catch { return null; }
}

function ensureSidebar() {
  if (document.getElementById('sidebar-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'sidebar-overlay';
  overlay.className = 'sidebar-overlay';
  overlay.onclick = closeSidebar;
  
  const sidebar = document.createElement('div');
  sidebar.id = 'sidebar';
  sidebar.className = 'sidebar';
  sidebar.innerHTML = `
    <div class="sidebar-header">
      <h3>القائمة</h3>
      <button class="close-sidebar" onclick="closeSidebar()">&times;</button>
    </div>
    <div class="sidebar-nav" id="sidebar-nav"></div>
  `;
  
  document.body.appendChild(overlay);
  document.body.appendChild(sidebar);
}

function openSidebar() {
  ensureSidebar();
  document.getElementById('sidebar-overlay').classList.add('open');
  document.getElementById('sidebar').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar-overlay').classList.remove('open');
  document.getElementById('sidebar').classList.remove('open');
}

async function renderNav() {
  const el = document.getElementById('nav-actions');
  if (!el) return;
  ensureSidebar();
  const me = await loadMe();
  const sideNav = document.getElementById('sidebar-nav');
  if (!sideNav) return;
  
  const searchLink = `<a href="#" class="sidebar-link" onclick="closeSidebar(); openSearch(); return false;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg> بحث عن كود</a>`;
  const homeLink = `<a href="/" class="sidebar-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> الرئيسية</a>`;
  
  if (me) {
    const profileLink = `<a href="/u/${esc(me.username)}" class="sidebar-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> الملف الشخصي</a>`;
    const settingsLink = `<a href="/u/${esc(me.username)}?tab=settings" class="sidebar-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> إعدادات الحساب</a>`;
    const adminLink = me.is_admin ? `<a href="/admin" class="sidebar-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> الإدارة</a>` : '';
    const submitLink = `<a href="/submit" class="sidebar-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> إضافة كود</a>`;
    const logoutLink = `<a href="#" class="sidebar-link danger" onclick="doLogout(); return false;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> تسجيل خروج</a>`;
    
    sideNav.innerHTML = `${homeLink}${profileLink}${settingsLink}${searchLink}${submitLink}<a href="/zip" class="sidebar-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg> الملفات الجاهزة</a>${adminLink}<a href="/info" class="sidebar-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> معلومات المنصة</a>${logoutLink}
      <div style="margin-top:auto;padding:20px;font-size:11px;color:var(--gold-dim);text-align:center;font-weight:800;letter-spacing:1px;border-top:1px dashed var(--border);">BMG-CODE.2.0.0</div>`;
    el.innerHTML = `
      <div class="nav-profile" onclick="location.href='/u/${esc(me.username)}'">
        ${avatarNode({ username: me.username, avatar_url: me.avatar_url }, 'sm')}
        <span class="name">${esc(me.display_name || me.username)}</span>
        ${isVerified(me) ? verifiedBadge() : ''}
        ${me.is_admin ? eagleBadge() : ''}
      </div>
      <button class="menu-btn" onclick="openSidebar()">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>`;
  } else {
    sideNav.innerHTML = `${homeLink}${searchLink}<a href="/auth" class="sidebar-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> تسجيل دخول</a><a href="/info" class="sidebar-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> معلومات المنصة</a>
      <div style="margin-top:auto;padding:20px;font-size:11px;color:var(--gold-dim);text-align:center;font-weight:800;letter-spacing:1px;border-top:1px dashed var(--border);">BMG-CODE.2.0.0</div>`;
    el.innerHTML = `
      <a class="btn primary" href="/auth">دخول</a>
      <button class="menu-btn" onclick="openSidebar()">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>`;
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

function codeCard(c) {
  const file = c.filename || c.title;
  return `<article class="code-card" onclick="location.href='/c/${encodeURIComponent(file)}'">
    <div>
      <h3 class="card-title">${esc(c.title || file)}</h3>
      <p class="card-desc">${esc(c.description || 'لا يوجد وصف لهذا الكود')}</p>
    </div>
    <div class="card-footer">
      ${authorLink(c)}
      <span class="lang-badge">${esc(c.language || 'txt')}</span>
    </div>
  </article>`;
}

window.api = api; window.esc = esc;
window.avatarNode = avatarNode; window.avatarUrl = avatarUrl; window.isVerified = isVerified; window.authorLink = authorLink; window.verifiedBadge = verifiedBadge;
window.renderNav = renderNav; window.doLogout = doLogout;
window.openSearch = openSearch; window.closeSearch = closeSearch;
window.codeCard = codeCard; window.loadMe = loadMe;

// --- Interaction helpers (comments / reports / ban overlay) ---
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
window.loadComments = loadComments; window.checkProfanity = checkProfanity;
window.submitReport = submitReport; window.renderBanOverlay = renderBanOverlay;



