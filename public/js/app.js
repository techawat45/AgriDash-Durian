/* ============================================================
   AgriDash Durian Pro - Production Field Controller v3.0 (app.js)
   MongoDB Atlas Connected | Pure Thai UI | Smart Auto-complete
   ============================================================ */
'use strict';

let currentLoggedInEmail = 'guest', isGuestMode = false, isRegisterMode = false;
let selectedVigour = 4, currentAccType = 'income', currentPredictorModeLocal = 'flower';
let isSaving = false;
let fieldLogs = [], plantSurveys = [], accEntries = [];
let totalIncomeAcc = 0, totalExpenseAcc = 0;

let purchaseItems = [
  { name: 'ปุ๋ยเคมี 8-24-24', qty: 2, unit: 'กระสอบ', price: 1450 },
  { name: 'อะบาเมกติน', qty: 2, unit: 'ขวด', price: 350 },
  { name: 'น้ำตาลทางด่วนซอร์บิทอล', qty: 4, unit: 'แกลลอน', price: 480 }
];

let sprayItems = [
  { type: 'ปุ๋ยทางใบ', name: 'ปุ๋ยแคลเซียมไนเตรต 15-0-0', dose: 300, unit: 'กรัม' },
  { type: 'ยาฆ่าแมลง', name: 'อะบาเมกติน', dose: 200, unit: 'ซีซี' },
  { type: 'ยาฆ่าเชื้อรา', name: 'แมนโคเซบ', dose: 150, unit: 'กรัม' },
  { type: 'ยาจับใบ', name: 'ยาจับใบเกรดพรีเมียม', dose: 50, unit: 'ซีซี' }
];

const defaultProductSuggestions = [
  'ปุ๋ยเคมี 15-15-15', 'ปุ๋ยเคมี 8-24-24', 'ปุ๋ยเคมี 13-13-21', 'ปุ๋ยเคมี 12-12-17-2',
  'ปุ๋ยแคลเซียมไนเตรต 15-0-0', 'ปุ๋ยเกร็ดสะสมอาหาร 0-52-34', 'ปุ๋ยทางใบ 0-0-50',
  'แคลเซียม-โบรอน', 'แมกนีเซียมคีเลต', 'ซิงค์คีเลต', 'สาหร่ายทะเลสกัดเข้มข้น',
  'น้ำตาลทางด่วนซอร์บิทอล', 'สารแพคโคลบิวทราโซล', 'อะบาเมกติน', 'ไทอะมีทอกแซม',
  'อิมิดาโคลพริด', 'ฟิโพรนิล', 'แมนโคเซบ', 'คาร์เบนดาซิม', 'เมทาแลกซิล',
  'ฟอสอีทิล-อะลูมิเนียม', 'ยาจับใบเกรดพรีเมียม', 'ปูนโดโลไมท์', 'ท่อน้ำเกษตร',
  'หัวสปริงเกอร์สวนทุเรียน', 'เชือกโยงกิ่งทุเรียน', 'น้ำมันดีเซลเครื่องสูบน้ำ'
];

// ====== UTILITY & THAI DATE HELPERS ======
function safeNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function formatCurrency(amount) { return '฿' + safeNum(amount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function getTodayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// แปลงวันที่เป็นรูปแบบ วว/ดด/ปปปป (พ.ศ.)
function formatDateSlashThai(isoStr) {
  if (!isoStr) return '-';
  const parts = String(isoStr).split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const buddhistYear = y < 2400 ? y + 543 : y;
    return `${parts[2]}/${parts[1]}/${buddhistYear}`;
  }
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear() + 543;
  return `${day}/${month}/${year}`;
}

function formatDateThai(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '-';
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function updateAllThaiDateBadges() {
  const pairs = [
    ['acc-date', 'acc-date-thai-badge'],
    ['log-date', 'log-date-thai-badge'],
    ['plant-date', 'plant-date-thai-badge'],
    ['harv-date', 'harv-date-thai-badge']
  ];
  pairs.forEach(([inputId, badgeId]) => {
    const input = document.getElementById(inputId);
    const badge = document.getElementById(badgeId);
    if (input && badge) {
      if (!input.value) input.value = getTodayISO();
      badge.innerText = '📅 วันที่: ' + formatDateSlashThai(input.value);
    }
  });
}

function setDefaultTodayDates() {
  const today = getTodayISO();
  ['acc-date', 'log-date', 'plant-date', 'dash-predictor-date', 'harv-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = today;
  });
  updateAllThaiDateBadges();
}

// ====== DYNAMIC ORCHARD/PLOT SELECTS ======
function refreshPlotSelects() {
  if (typeof AGRI_ORCHARDS === 'undefined') return;
  const calcSel = document.getElementById('calc-plot');
  if (calcSel) {
    const prev = calcSel.value;
    calcSel.innerHTML = AGRI_ORCHARDS.optionsHTML({ includeAll: false, includeCommon: true, allowOrchardLevel: true });
    if (prev && Array.from(calcSel.options).some(o => o.value === prev)) calcSel.value = prev;
  }
  const logSel = document.getElementById('log-plot');
  if (logSel) {
    const prev = logSel.value;
    logSel.innerHTML = AGRI_ORCHARDS.optionsHTML({ includeAll: false, includeCommon: true, allowOrchardLevel: true });
    if (prev && Array.from(logSel.options).some(o => o.value === prev)) logSel.value = prev;
  }
  const plantSel = document.getElementById('plant-plot');
  if (plantSel) {
    const prev = plantSel.value;
    plantSel.innerHTML = AGRI_ORCHARDS.optionsHTML({ includeAll: false, includeCommon: false, allowOrchardLevel: true });
    if (prev && Array.from(plantSel.options).some(o => o.value === prev)) plantSel.value = prev;
  }
  if (typeof refreshLedgerSelectors === 'function') refreshLedgerSelectors();
}

// ====== AUTO-COMPLETE PRODUCT SUGGESTIONS ======
function getSavedCustomProducts() {
  try {
    return JSON.parse(localStorage.getItem('agri_custom_products') || '[]');
  } catch (e) { return []; }
}

function rememberProductNames(names) {
  try {
    const existing = new Set([...defaultProductSuggestions, ...getSavedCustomProducts()]);
    names.forEach(n => {
      const clean = String(n || '').trim();
      if (clean && clean.length >= 2) existing.add(clean);
    });
    const customOnly = [...existing].filter(x => !defaultProductSuggestions.includes(x));
    localStorage.setItem('agri_custom_products', JSON.stringify(customOnly));
    refreshProductDatalist();
  } catch (e) {}
}

function refreshProductDatalist() {
  const dl = document.getElementById('agri-product-suggestions');
  if (!dl) return;
  const all = new Set([...defaultProductSuggestions, ...getSavedCustomProducts()]);
  if (typeof AGRI_DATA !== 'undefined' && AGRI_DATA.state && Array.isArray(AGRI_DATA.state.inventory)) {
    AGRI_DATA.state.inventory.forEach(it => {
      if (it && it.name) all.add(String(it.name).trim());
    });
  }
  // ดึงชื่อสินค้าจากประวัติสมุดบัญชีที่เคยบันทึกไว้ด้วย
  accEntries.forEach(e => {
    if (e.detail) {
      const matches = e.detail.split(/[,+|]/);
      matches.forEach(m => {
        const namePart = m.split('(')[0].trim();
        if (namePart && namePart.length >= 2 && namePart.length <= 40) all.add(namePart);
      });
    }
  });
  dl.innerHTML = [...all].map(item => `<option value="${escapeHtml(item)}"></option>`).join('');
}

// ====== SYNC & CONNECTION UI ======
function setSyncIndicator(state, text) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  el.style.display = 'inline-flex';
  el.className = 'sync-indicator btn-desktop ' + state;
  el.innerText = (state === 'syncing' ? '🔄 ' : state === 'synced' ? '✅ ' : '⚠️ ') + text;
}

let toastTimer = null;
function showToast(text, type = 'success') {
  const toast = document.getElementById('toast');
  const span = document.getElementById('toast-text');
  if (!toast || !span) return;
  span.innerText = text;
  toast.className = 'toast toast-' + type + ' show';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function updateConnectionUI(health) {
  const bar = document.getElementById('connection-status-bar');
  const dot = document.getElementById('status-dot');
  const ct = document.getElementById('status-cloud-text');
  if (!bar) return;

  if (sessionStorage.getItem('agri_hide_offline_banner') === '1') {
    bar.classList.add('hidden');
  }

  if (!health || !health.success) {
    if (dot) dot.className = 'status-dot offline';
    const isGhPages = window.location.hostname.includes('github.io');
    if (ct) {
      ct.innerText = isGhPages ? 'แคชในเครื่อง' : 'โหมดในเครื่อง';
      ct.style.display = 'block';
    }

    if (sessionStorage.getItem('agri_hide_offline_banner') !== '1') {
      bar.className = 'offline-banner';
      const userTag = (!isGuestMode && currentLoggedInEmail !== 'guest')
        ? `👤 บัญชี: <strong>${escapeHtml(currentLoggedInEmail)}</strong>`
        : '👤 โหมดผู้เยี่ยมชม';

      bar.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap; font-size:0.86rem; padding: 2px 0;">
          <span>ℹ️ ${userTag} — ${isGhPages ? 'เปิดใช้งานโหมดข้อมูลในเครื่อง และพร้อมสำรองออนไลน์' : 'โหมดออฟไลน์ — ข้อมูลถูกจัดเก็บสำรองไว้ในเครื่อง'}</span>
          <button type="button" onclick="dismissOfflineBanner()" style="background:rgba(0,0,0,0.08); border:none; border-radius:6px; color:inherit; font-weight:800; cursor:pointer; padding:3px 10px; font-size:0.82rem;" title="ปิดแถบแจ้งเตือนนี้">✕ ปิดแถบนี้</button>
        </div>
      `;
      bar.classList.remove('hidden');
    }
  } else {
    bar.classList.add('hidden');
    if (dot) dot.className = 'status-dot online';
    const mode = health.mode === 'mongodb_atlas' ? 'ฐานข้อมูลคลาวด์' : 'ฐานข้อมูลเครื่อง';
    if (ct) { ct.innerText = '🟢 ' + mode; ct.style.display = 'block'; }
  }
}

function dismissOfflineBanner() {
  sessionStorage.setItem('agri_hide_offline_banner', '1');
  document.getElementById('connection-status-bar')?.classList.add('hidden');
}

function hidePageLoader() {
  const loader = document.getElementById('page-loading');
  if (!loader) return;
  setTimeout(() => {
    loader.classList.add('fade-out');
    setTimeout(() => loader.style.display = 'none', 350);
  }, 450);
}

function updateAvatarUI(email, firstName, farmName) {
  const isGuest = !email || email === 'guest';
  const disp = document.getElementById('user-email-display');
  const av = document.getElementById('avatar-display');
  const loginHeaderBtn = document.getElementById('header-guest-login-btn');
  const statusBadge = document.getElementById('user-status-badge');
  const menuTitle = document.getElementById('user-menu-title');
  const menuLoginBtn = document.getElementById('menu-login-btn');
  const menuRegisterBtn = document.getElementById('menu-register-btn');
  const menuSwitchBtn = document.getElementById('menu-switch-btn');
  const menuLogoutBtn = document.getElementById('menu-logout-btn');
  const mobAuthTitle = document.getElementById('mob-sheet-auth-title');
  const mobAuthSub = document.getElementById('mob-sheet-auth-sub');

  if (isGuest) {
    if (disp) disp.innerText = 'ข้อมูลบันทึกแยกตามเครื่องและกองกลาง';
    if (menuTitle) menuTitle.innerText = 'โหมดผู้เยี่ยมชม';
    if (loginHeaderBtn) loginHeaderBtn.style.display = 'inline-flex';
    if (statusBadge) {
      statusBadge.className = 'badge-guest';
      statusBadge.innerText = '👤 ผู้เยี่ยมชม';
    }
    if (av) {
      av.classList.add('avatar-guest');
      av.childNodes[0].nodeValue = 'สวน';
      av.title = 'ผู้เยี่ยมชม — คลิกเพื่อเข้าสู่ระบบหรือจัดการบัญชี';
    }
    if (menuLoginBtn) menuLoginBtn.style.display = 'flex';
    if (menuRegisterBtn) menuRegisterBtn.style.display = 'flex';
    if (menuSwitchBtn) menuSwitchBtn.style.display = 'flex';
    if (menuLogoutBtn) menuLogoutBtn.innerText = '🧹 ล้างแคชผู้เยี่ยมชม';

    if (mobAuthTitle) mobAuthTitle.innerText = 'เข้าสู่ระบบ';
    if (mobAuthSub) mobAuthSub.innerText = 'เชื่อมต่อบัญชีจริงคลาวด์';
  } else {
    const cleanEmail = email.toLowerCase();
    const displayName = firstName || farmName || cleanEmail.split('@')[0];
    if (disp) disp.innerText = cleanEmail;
    if (menuTitle) menuTitle.innerText = farmName ? `🏡 ${farmName}` : `👤 ${displayName}`;
    if (loginHeaderBtn) loginHeaderBtn.style.display = 'none';
    if (statusBadge) {
      statusBadge.className = 'badge-member';
      statusBadge.innerText = `✅ ${displayName}`;
    }
    if (av) {
      av.classList.remove('avatar-guest');
      const initials = (firstName ? firstName.substring(0, 2) : cleanEmail.substring(0, 2)).toUpperCase();
      av.childNodes[0].nodeValue = initials;
      av.title = `เข้าสู่ระบบเป็น ${cleanEmail}`;
    }
    if (menuLoginBtn) menuLoginBtn.style.display = 'none';
    if (menuRegisterBtn) menuRegisterBtn.style.display = 'none';
    if (menuSwitchBtn) menuSwitchBtn.style.display = 'flex';
    if (menuLogoutBtn) menuLogoutBtn.innerText = '🚪 ออกจากระบบ';

    if (mobAuthTitle) mobAuthTitle.innerText = 'สลับผู้ใช้งาน / ออกจากระบบ';
    if (mobAuthSub) mobAuthSub.innerText = `บัญชี: ${cleanEmail}`;
  }
}

// ====== AUTHENTICATION & MULTI-USER SWITCH ======
function renderSavedAccounts() {
  const section = document.getElementById('saved-accounts-section');
  const list = document.getElementById('saved-accounts-list');
  if (!section || !list) return;

  const accounts = AGRI_STORAGE.getRecentAccounts ? AGRI_STORAGE.getRecentAccounts() : [];
  if (!accounts || accounts.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = accounts.map(acc => {
    const isCurrent = acc.email.toLowerCase() === (currentLoggedInEmail || '').toLowerCase();
    const label = escapeHtml(acc.firstName || acc.email);
    return `
      <div class="saved-account-chip ${isCurrent ? 'active' : ''}" onclick="quickSwitchTo('${escapeHtml(acc.email)}')" title="คลิกเพื่อสลับไปยังบัญชีนี้">
        <span>👤 ${label}</span>
        <span style="font-size:0.75rem; color:var(--slate-500);">(${escapeHtml(acc.email)})</span>
        ${isCurrent ? '<span style="font-size:0.72rem; color:var(--emerald-700); font-weight:800;">[ปัจจุบัน]</span>' : ''}
      </div>
    `;
  }).join('');
}

function quickSwitchTo(email) {
  const emailInput = document.getElementById('login-email-input');
  const passInput = document.getElementById('login-password-input');
  if (emailInput) emailInput.value = email;
  if (passInput) {
    passInput.value = '';
    passInput.focus();
  }
  showToast(`เลือกบัญชี ${email} เรียบร้อย กรุณาใส่รหัสผ่านเพื่อเข้าสู่ระบบ`, 'info');
}

function openLoginModal() {
  isRegisterMode = false;
  document.querySelectorAll('.register-only').forEach(el => el.style.display = 'none');
  const ti = document.getElementById('auth-modal-title');
  const sub = document.getElementById('auth-modal-sub');
  const mb = document.getElementById('auth-main-btn');
  const tt = document.getElementById('auth-toggle-text');
  const tl = document.getElementById('auth-toggle-link');
  if (ti) ti.innerText = 'ลงชื่อเข้าใช้งานระบบสวนทุเรียน';
  if (sub) sub.innerText = 'เข้าสู่ระบบเพื่อซิงค์ข้อมูลสวนและสมุดบัญชีกับฐานข้อมูลคลาวด์ MongoDB Atlas';
  if (mb) mb.innerText = '🔐 เข้าสู่ระบบ';
  if (tt) tt.innerText = 'ยังไม่มีบัญชีใช่หรือไม่?';
  if (tl) tl.innerText = 'สมัครสมาชิกใหม่';
  renderSavedAccounts();
  document.getElementById('signout-menu')?.classList.add('hidden');
  document.getElementById('auth-modal')?.classList.remove('hidden');
}

function openRegisterModal() {
  isRegisterMode = true;
  document.querySelectorAll('.register-only').forEach(el => el.style.display = 'block');
  const ti = document.getElementById('auth-modal-title');
  const sub = document.getElementById('auth-modal-sub');
  const mb = document.getElementById('auth-main-btn');
  const tt = document.getElementById('auth-toggle-text');
  const tl = document.getElementById('auth-toggle-link');
  const savedSec = document.getElementById('saved-accounts-section');
  if (savedSec) savedSec.style.display = 'none';
  if (ti) ti.innerText = 'ลงทะเบียนบัญชีสวนทุเรียนใหม่';
  if (sub) sub.innerText = 'สร้างบัญชีเพื่อจัดเก็บประวัติแปลงและบัญชีรายรับ-รายจ่ายของคุณบนคลาวด์';
  if (mb) mb.innerText = '📝 ยืนยันการสมัครสมาชิก';
  if (tt) tt.innerText = 'มีบัญชีผู้ใช้งานอยู่แล้ว?';
  if (tl) tl.innerText = 'เข้าสู่ระบบ';
  document.getElementById('signout-menu')?.classList.add('hidden');
  document.getElementById('auth-modal')?.classList.remove('hidden');
}

function promptSwitchUser() {
  document.getElementById('signout-menu')?.classList.add('hidden');
  openLoginModal();
  const ti = document.getElementById('auth-modal-title');
  const sub = document.getElementById('auth-modal-sub');
  if (ti) ti.innerText = '🔄 สลับบัญชีผู้ใช้งาน';
  if (sub) sub.innerText = 'เลือกบัญชีที่เคยบันทึกไว้ หรือกรอกอีเมลใหม่เพื่อสลับบัญชี';
}

function closeAuthModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('auth-modal')?.classList.add('hidden');
}

function showAuthModal() { openLoginModal(); }

function toggleAuthMode(event) {
  if (event) event.preventDefault();
  if (isRegisterMode) openLoginModal();
  else openRegisterModal();
}

async function handleEmailAuthSubmit(event) {
  if (event) event.preventDefault();
  const btn = document.getElementById('auth-main-btn');
  const email = (document.getElementById('login-email-input')?.value || '').trim();
  const password = document.getElementById('login-password-input')?.value || '';
  if (!email.includes('@') || password.length < 4) {
    showToast('กรุณากรอกอีเมลและรหัสผ่านอย่างน้อย 4 ตัวอักษร', 'error');
    return;
  }
  if (btn) btn.classList.add('loading');
  try {
    if (isRegisterMode) {
      const rp = document.getElementById('reg-repassword')?.value || '';
      if (password !== rp) { showToast('รหัสผ่านทั้งสองช่องไม่ตรงกัน', 'error'); return; }
      const payload = {
        email, password,
        firstName: document.getElementById('reg-firstname')?.value.trim() || '',
        lastName: document.getElementById('reg-lastname')?.value.trim() || '',
        phone: document.getElementById('reg-phone')?.value.trim() || '',
        farmName: document.getElementById('reg-farmname')?.value.trim() || ''
      };
      const r = await AGRI_STORAGE.register(payload);
      showToast(r.message || 'สมัครสมาชิกสำเร็จ!', 'success');
      openLoginModal();
      const loginEmail = document.getElementById('login-email-input');
      if (loginEmail) loginEmail.value = email;
    } else {
      const r = await AGRI_STORAGE.login(email, password);
      currentLoggedInEmail = r.email;
      isGuestMode = false;
      AGRI_STORAGE.saveSession(r.email, false);
      document.getElementById('auth-modal')?.classList.add('hidden');
      updateAvatarUI(r.email, r.firstName, r.farmName);
      showToast('ยินดีต้อนรับ ' + (r.firstName || r.email) + ' เข้าสู่ระบบเรียบร้อย', 'success');
      await reloadUserWorkspace();
      AGRI_STORAGE.checkHealth().then(updateConnectionUI);
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

async function handleGuestMode(event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  currentLoggedInEmail = 'guest';
  isGuestMode = true;
  AGRI_STORAGE.setToken('');
  AGRI_STORAGE.saveSession('guest', true);
  document.getElementById('auth-modal')?.classList.add('hidden');
  updateAvatarUI('guest');
  showToast('เข้าใช้งานในโหมดผู้เยี่ยมชมเรียบร้อย', 'success');
  await reloadUserWorkspace();
}

function toggleSignOutMenu(event) {
  if (event) event.stopPropagation();
  document.getElementById('signout-menu')?.classList.toggle('hidden');
}
document.addEventListener('click', () => document.getElementById('signout-menu')?.classList.add('hidden'));

async function signOutUser() {
  document.getElementById('signout-menu')?.classList.add('hidden');
  const prevEmail = currentLoggedInEmail;
  AGRI_STORAGE.clearSession();
  currentLoggedInEmail = 'guest';
  isGuestMode = true;
  AGRI_STORAGE.saveSession('guest', true);
  updateAvatarUI('guest');
  await reloadUserWorkspace();
  showToast(prevEmail !== 'guest' ? 'ออกจากระบบเรียบร้อยแล้ว — สลับเป็นโหมดผู้เยี่ยมชม' : 'ล้างแคชผู้เยี่ยมชมเรียบร้อยแล้ว', 'success');
}

// ====== DATA LOAD & SAVE (MONGODB ATLAS + WORKSPACE) ======
async function reloadUserWorkspace() {
  setSyncIndicator('syncing', 'กำลังดึงข้อมูลสวนจากคลาวด์...');
  await AGRI_STORAGE.ensureToken();
  const scopeEmail = currentLoggedInEmail || 'guest';
  AGRI_DATA.setScope(scopeEmail);

  const ws = await AGRI_DATA.loadWorkspace();
  if (ws && !ws.offline && ws.legacy) {
    fieldLogs = (ws.legacy.fieldLogs || []).filter(x => !String(x.activity || '').includes('???'));
    plantSurveys = ws.legacy.plantSurveys || [];
    accEntries = ws.legacy.accEntries || [];
    AGRI_STORAGE.saveDataCache({ fieldLogs, plantSurveys, accEntries }, scopeEmail);
    setSyncIndicator('synced', 'ซิงค์คลาวด์แล้ว');
  } else {
    const result = await AGRI_STORAGE.loadData(scopeEmail);
    fieldLogs = (result.data.fieldLogs || []).filter(x => !String(x.activity || '').includes('???'));
    plantSurveys = result.data.plantSurveys || [];
    accEntries = result.data.accEntries || [];
    setSyncIndicator(result.offline ? 'error' : 'synced', result.offline ? 'โหมดออฟไลน์' : 'ซิงค์คลาวด์แล้ว');
  }

  if (typeof AGRI_ORCHARDS !== 'undefined') AGRI_ORCHARDS.syncFromState();
  refreshPlotSelects();
  refreshProductDatalist();
  renderAllTables();
  calculateFlowerDates();
  loadAgroMeasurementsFromCache();
  if (typeof refreshExecutiveDashboard === 'function') refreshExecutiveDashboard();
  if (typeof refreshOpsAll === 'function') refreshOpsAll();
  if (typeof refreshWorkforceAll === 'function') refreshWorkforceAll();
  if (typeof refreshHarvestAll === 'function') refreshHarvestAll();
}

async function loadUserData() {
  return reloadUserWorkspace();
}

async function saveLocalData() {
  if (isSaving) return;
  isSaving = true;
  setSyncIndicator('syncing', 'กำลังบันทึกขึ้นคลาวด์...');
  const r = await AGRI_STORAGE.saveData(currentLoggedInEmail, fieldLogs, plantSurveys, accEntries);
  isSaving = false;
  setSyncIndicator(r.synced ? 'synced' : 'error', r.synced ? 'บันทึกขึ้นคลาวด์แล้ว' : 'บันทึกในเครื่องแล้ว');
}

// ====== RENDER TABLES & LEDGER FILTERS ======
function renderAllTables() {
  renderFieldLogs();
  renderPlantSurveys();
  if (typeof renderAccEntries === 'function') renderAccEntries();
  if (typeof renderLegacyMapping === 'function') renderLegacyMapping();
}

function renderFieldLogs() {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!fieldLogs.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--slate-500);padding:24px;font-weight:600;">ยังไม่มีประวัติการทำงานในแปลง — กดปุ่ม "เพิ่มบันทึกงานแปลง" เพื่อเพิ่มรายการ</td></tr>';
    return;
  }
  [...fieldLogs].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(log => {
    const tr = document.createElement('tr');
    const cost = safeNum(log.cost);
    const plotLabel = typeof AGRI_ORCHARDS !== 'undefined' ? (AGRI_ORCHARDS.entryLabel(log) || log.plot || '') : (log.plot || '');
    tr.innerHTML = `
      <td data-label="วันที่" style="font-weight:700;white-space:nowrap;">${escapeHtml(formatDateSlashThai(log.date))}</td>
      <td data-label="สวน / แปลง" style="font-weight:800;color:var(--slate-900)">${escapeHtml(plotLabel)}</td>
      <td data-label="กิจกรรม"><span class="badge-op">${escapeHtml(log.activity || '')}</span></td>
      <td data-label="รายละเอียด" style="font-size:0.88rem;color:var(--slate-700)">${escapeHtml(log.detail || '-')}</td>
      <td data-label="ค่าใช้จ่าย" style="text-align:right;font-weight:800;color:var(--slate-900)">฿${cost.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
      <td data-label="จัดการ" style="text-align:center"><button class="btn-icon danger" onclick="deleteFieldLog('${escapeHtml(log.id || '')}')" title="ลบรายการ">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPlantSurveys() {
  const tbody = document.getElementById('plant-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!plantSurveys.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--slate-500);padding:24px;font-weight:600;">ยังไม่มีประวัติการสำรวจต้นทุเรียน</td></tr>';
    return;
  }
  [...plantSurveys].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(sv => {
    const tr = document.createElement('tr');
    const danger = (sv.trunk || '').includes('พบแผล') || (sv.trunk || '').includes('มอด');
    const plotLabel = typeof AGRI_ORCHARDS !== 'undefined' ? (AGRI_ORCHARDS.entryLabel(sv) || sv.plot || '') : (sv.plot || '');
    tr.innerHTML = `
      <td data-label="วันที่สำรวจ" style="font-weight:700;white-space:nowrap;">${escapeHtml(formatDateSlashThai(sv.date))}</td>
      <td data-label="สวน / แปลง" style="font-weight:800">${escapeHtml(plotLabel)}</td>
      <td data-label="ระยะ"><span class="badge-stage">${escapeHtml(sv.stage || '')}</span></td>
      <td data-label="สภาพใบ/ศัตรูพืช" style="font-size:0.88rem;color:var(--slate-700)">${escapeHtml(sv.leafPest || '')}</td>
      <td data-label="สภาพลำต้น" style="font-size:0.88rem;font-weight:800;color:${danger ? 'var(--rose-700)' : 'var(--emerald-700)'}">${escapeHtml(sv.trunk || '')}</td>
      <td data-label="คำแนะนำ" style="font-size:0.88rem">${escapeHtml(sv.recommendation || '')}</td>
      <td data-label="จัดการ" style="text-align:center"><button class="btn-icon danger" onclick="deletePlantSurvey('${escapeHtml(sv.id || '')}')" title="ลบรายการ">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function extractEntryPlot(entry) {
  if (typeof AGRI_ORCHARDS !== 'undefined') {
    const lbl = AGRI_ORCHARDS.entryLabel(entry);
    if (lbl) return lbl;
  }
  if (entry.plot) return entry.plot;
  if (entry.detail && entry.detail.includes('|')) {
    const parts = entry.detail.split('|').map(s => s.trim());
    const last = parts[parts.length - 1];
    if (last.includes('สวน') || last.includes('แปลง') || last.includes('กองกลาง')) return last;
  }
  return 'กองกลาง / ใช้ร่วมกัน';
}

// ====== DELETE ITEMS ======
async function deleteFieldLog(id) {
  if (!confirm('ต้องการลบรายการกิจกรรมแปลงนี้ใช่หรือไม่?')) return;
  const u = await AGRI_STORAGE.deleteItem('fieldLogs', id, currentLoggedInEmail, { fieldLogs, plantSurveys, accEntries });
  fieldLogs = u.fieldLogs;
  renderFieldLogs();
  showToast('ลบรายการกิจกรรมแปลงเรียบร้อยแล้ว', 'success');
}

async function deletePlantSurvey(id) {
  if (!confirm('ต้องการลบรายการสำรวจต้นนี้ใช่หรือไม่?')) return;
  const u = await AGRI_STORAGE.deleteItem('plantSurveys', id, currentLoggedInEmail, { fieldLogs, plantSurveys, accEntries });
  plantSurveys = u.plantSurveys;
  renderPlantSurveys();
  showToast('ลบรายการสำรวจต้นเรียบร้อยแล้ว', 'success');
}

async function deleteAccEntry(id) {
  if (!confirm('ต้องการลบรายการบัญชีนี้ใช่หรือไม่?')) return;
  const u = await AGRI_STORAGE.deleteItem('accEntries', id, currentLoggedInEmail, { fieldLogs, plantSurveys, accEntries });
  accEntries = u.accEntries;
  renderAccEntries();
  showToast('ลบรายการบัญชีเรียบร้อยแล้ว', 'success');
}

// ====== SAVE FORMS ======
function saveFieldLog(e) {
  e.preventDefault();
  const dateVal = document.getElementById('log-date')?.value || getTodayISO();
  const plotRaw = document.getElementById('log-plot')?.value || '';
  const target = typeof AGRI_ORCHARDS !== 'undefined' ? AGRI_ORCHARDS.resolve(plotRaw) : { orchardId: '', plotId: '', label: plotRaw };
  let actVal = document.getElementById('log-activity')?.value || '';
  if (actVal.includes('อื่นๆ')) {
    const c = document.getElementById('custom-activity-text')?.value;
    if (c) actVal = '🔧 ' + c;
  }
  if (!dateVal || !target.label || !actVal) {
    showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'error');
    return;
  }

  const labCost = safeNum(document.getElementById('log-cost-labour')?.value);
  const matCost = safeNum(document.getElementById('log-cost-mat')?.value);
  const totalCost = labCost + matCost;
  const note = document.getElementById('log-note')?.value || '';
  let detailText = note || '-';

  if (actVal.includes('ทำสาร')) {
    const days = parseInt(document.getElementById('induction-custom-days')?.value || 35, 10);
    const variety = document.getElementById('induction-variety-select')?.value || 'monthong';
    let hd = 120, vl = 'หมอนทอง';
    if (variety === 'kradoom') { hd = 90; vl = 'กระดุมทอง'; }
    else if (variety === 'chanee') { hd = 105; vl = 'ชะนี/พวงมณี'; }
    else if (variety === 'kanyao') { hd = 130; vl = 'ก้านยาว'; }
    const tf = formatDateThai(addDays(new Date(dateVal), days));
    const th = formatDateThai(addDays(new Date(dateVal), days + 60 + hd));
    detailText = `พันธุ์: ${vl} | สารออกฤทธิ์ ${days} วัน ➔ คาดการณ์ออกดอก: ${tf} | เก็บเกี่ยว: ${th}${note ? ' | ' + note : ''}`;
  } else if (actVal.includes('พ่นยา')) {
    const tanks = document.getElementById('tank-count')?.value || 1;
    const items = sprayItems.filter(i => i.name.trim());
    rememberProductNames(items.map(i => i.name));
    detailText = items.map(i => `${i.name} (${i.dose} ${i.unit})`).join(' + ') + ` / พ่น ${tanks} ถัง${note ? ' | ' + note : ''}`;
  }

  const log = {
    id: 'field-' + Date.now(),
    date: dateVal,
    orchardId: target.orchardId,
    plotId: target.plotId,
    plot: target.label,
    activity: actVal,
    detail: detailText,
    cost: totalCost
  };

  fieldLogs.unshift(log);
  saveLocalData();
  syncSingleEntryToSheet({ fieldLog: log });
  renderFieldLogs();
  if (typeof renderLegacyMapping === 'function') renderLegacyMapping();
  showToast('บันทึกกิจกรรมแปลงวันที่ ' + formatDateSlashThai(dateVal) + ' สำเร็จ!', 'success');
  setTimeout(() => switchView('dashboard'), 1000);
}
function saveLog(e) { return saveFieldLog(e); }

function savePlantSurvey(e) {
  e.preventDefault();
  const dateVal = document.getElementById('plant-date')?.value || getTodayISO();
  const plotRaw = document.getElementById('plant-plot')?.value || '';
  const target = typeof AGRI_ORCHARDS !== 'undefined' ? AGRI_ORCHARDS.resolve(plotRaw) : { orchardId: '', plotId: '', label: plotRaw };
  if (!dateVal || (!target.orchardId && !target.plotId)) {
    showToast('กรุณาสร้างและเลือกสวนหรือแปลงที่สำรวจก่อนบันทึก', 'error');
    return;
  }
  let sv = document.getElementById('plant-stage')?.value || '';
  if (sv.includes('อื่นๆ')) { const c = document.getElementById('custom-stage-text')?.value; if (c) sv = '🌱 ' + c; }
  let lf = document.getElementById('plant-leaf-condition')?.value || '';
  if (lf.includes('อื่นๆ')) { const c = document.getElementById('custom-leaf-text')?.value; if (c) lf = c; }
  let pest = document.getElementById('plant-pest')?.value || '';
  if (pest.includes('อื่นๆ')) { const c = document.getElementById('custom-pest-text')?.value; if (c) pest = c; }
  let trunk = document.getElementById('plant-trunk')?.value || '';
  if (trunk.includes('อื่นๆ')) { const c = document.getElementById('custom-trunk-text')?.value; if (c) trunk = c; }
  const notes = document.getElementById('plant-custom-notes')?.value || '';
  const rec = document.getElementById('plant-recommendation')?.value || '';
  const leafPest = notes ? `${lf}, ${pest} (${notes})` : `${lf}, ${pest}`;

  const survey = {
    id: 'survey-' + Date.now(),
    date: dateVal,
    orchardId: target.orchardId,
    plotId: target.plotId,
    plot: target.label,
    stage: sv,
    leafPest,
    trunk,
    recommendation: rec
  };

  plantSurveys.unshift(survey);
  saveLocalData();
  syncSingleEntryToSheet({ plantSurvey: survey });
  renderPlantSurveys();
  showToast('บันทึกผลสำรวจแปลง ' + target.label + ' สำเร็จ!', 'success');
  setTimeout(() => switchView('dashboard'), 1000);
}

function saveAccEntry(e) {
  e.preventDefault();
  const dateVal = document.getElementById('acc-date')?.value || getTodayISO();
  const plotRaw = document.getElementById('acc-plot')?.value || 'common';
  const target = typeof AGRI_ORCHARDS !== 'undefined'
    ? AGRI_ORCHARDS.resolve(plotRaw)
    : { orchardId: '', plotId: '', label: 'กองกลาง / ใช้ร่วมกัน' };
  const catVal = document.getElementById('acc-category')?.value || '';
  const amountVal = safeNum(document.getElementById('acc-amount')?.value || 0);
  const descVal = (document.getElementById('acc-desc')?.value || '').trim();

  if (!dateVal || amountVal <= 0) {
    showToast('กรุณาระบุจำนวนเงินให้มากกว่า 0 บาท', 'error');
    return;
  }

  const isInc = currentAccType === 'income';
  let detailParts = [];

  if (!isInc) {
    const valid = purchaseItems.filter(p => p.name.trim() !== '');
    if (valid.length > 0) {
      rememberProductNames(valid.map(p => p.name));
      const itemsText = valid.map(p => `${p.name.trim()} (${p.qty} ${p.unit} @฿${safeNum(p.price).toLocaleString('th-TH')})`).join(' + ');
      detailParts.push(itemsText);
    }
  }

  if (descVal) detailParts.push(descVal);
  if (!detailParts.length) detailParts.push(target.label);

  const entry = {
    id: 'acc-' + Date.now(),
    date: dateVal,
    type: currentAccType,
    orchardId: target.orchardId,
    plotId: target.plotId,
    plot: target.label,
    category: catVal,
    detail: detailParts.join(' | '),
    amount: amountVal
  };

  accEntries.unshift(entry);
  saveLocalData();
  syncSingleEntryToSheet({ accEntry: entry });
  if (typeof renderAccEntries === 'function') renderAccEntries();

  const descInput = document.getElementById('acc-desc');
  if (descInput) descInput.value = '';
  if (isInc) {
    const amtInput = document.getElementById('acc-amount');
    if (amtInput) amtInput.value = '';
  }

  showToast('บันทึก' + (isInc ? 'รายรับ ' : 'รายจ่าย ') + formatCurrency(amountVal) + ' เรียบร้อยแล้ว!', 'success');
}

function saveAgronomyRecommendation() {
  const stage = document.getElementById('calc-stage')?.value || '';
  const tank = document.getElementById('calc-trees')?.value || 1000;
  const plotRaw = document.getElementById('calc-plot')?.value || 'common';
  const target = typeof AGRI_ORCHARDS !== 'undefined'
    ? AGRI_ORCHARDS.resolve(plotRaw)
    : { orchardId: '', plotId: '', label: 'กองกลาง / ใช้ร่วมกัน' };
  const npk = document.getElementById('rec-npk')?.innerText || '';
  const pest = document.getElementById('rec-pest')?.innerText || '';
  const estCost = safeNum(document.getElementById('calc-total-cost')?.value || 0);
  const dateVal = getTodayISO();
  const log = {
    id: 'field-' + Date.now(),
    date: dateVal,
    orchardId: target.orchardId,
    plotId: target.plotId,
    plot: target.label,
    activity: '🌾 สูตรปุ๋ยและยา (' + stage + ')',
    detail: `ถัง ${tank} ลิตร | ปุ๋ยทางดิน: ${npk} | การป้องกัน: ${pest}`,
    cost: estCost
  };
  fieldLogs.unshift(log);
  saveLocalData();
  syncSingleEntryToSheet({ fieldLog: log });
  renderFieldLogs();
  showToast('บันทึกสูตรปุ๋ยระยะ ' + stage + ' ลงประวัติแปลงแล้ว', 'success');
}

// 1-Click: ส่งยอดค่าใช้จ่ายจากหน้าคำนวณปุ๋ยและสารเคมีเข้าสมุดบัญชีและระบบสำรอง
async function saveCalcExpenseToLedgerAndSheet() {
  const btn = document.getElementById('btn-calc-save-ledger');
  const stage = document.getElementById('calc-stage')?.value || 'สะสมอาหาร';
  const tankLiters = safeNum(document.getElementById('calc-trees')?.value || 1000);
  const plotRaw = document.getElementById('calc-plot')?.value || 'common';
  const target = typeof AGRI_ORCHARDS !== 'undefined'
    ? AGRI_ORCHARDS.resolve(plotRaw)
    : { orchardId: '', plotId: '', label: 'กองกลาง / ใช้ร่วมกัน' };
  const totalCost = safeNum(document.getElementById('calc-total-cost')?.value || 0);
  const note = (document.getElementById('calc-note')?.value || '').trim();
  const alsoSaveField = document.getElementById('calc-also-save-field')?.checked ?? true;

  if (totalCost <= 0) {
    showToast('กรุณาระบุยอดค่าใช้จ่ายให้มากกว่า 0 บาท', 'error');
    return;
  }

  const npk = document.getElementById('rec-npk')?.innerText || '';
  const camg = document.getElementById('rec-camg')?.innerText || '';
  const znb = document.getElementById('rec-znb')?.innerText || '';
  const pest = document.getElementById('rec-pest')?.innerText || '';
  const today = getTodayISO();
  const stamp = Date.now();

  const detailText = [
    `สูตรระยะ${stage} (ถัง ${tankLiters.toLocaleString('th-TH')} ลิตร)`,
    `${npk} + ${camg} + ${znb} + ${pest}`,
    note || null
  ].filter(Boolean).join(' | ');

  const accEntry = {
    id: 'acc-calc-' + stamp,
    date: today,
    type: 'expense',
    orchardId: target.orchardId,
    plotId: target.plotId,
    plot: target.label,
    category: 'ปุ๋ยและธาตุอาหาร',
    detail: detailText,
    amount: totalCost,
    refType: 'calc',
    refId: String(stamp)
  };

  const fieldLog = alsoSaveField ? {
    id: 'field-calc-' + stamp,
    date: today,
    orchardId: target.orchardId,
    plotId: target.plotId,
    plot: target.label,
    activity: `🌾 คำนวณปุ๋ยและสารเคมี (${stage})`,
    detail: `ถัง ${tankLiters.toLocaleString('th-TH')} ลิตร | ${npk} | ${znb} | ${pest}${note ? ' | ' + note : ''}`,
    cost: totalCost
  } : null;

  if (btn) btn.classList.add('loading');

  accEntries.unshift(accEntry);
  if (fieldLog) fieldLogs.unshift(fieldLog);
  AGRI_STORAGE.saveDataCache({ fieldLogs, plantSurveys, accEntries }, currentLoggedInEmail || 'guest');
  rememberProductNames([npk, camg, znb]);
  renderAllTables();

  setSyncIndicator('syncing', 'กำลังส่งเข้าสมุดบัญชีและระบบสำรอง...');

  try {
    const r = await AGRI_STORAGE.authFetch('/api/ledger/calc-expense', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: currentLoggedInEmail || 'guest', accEntry, fieldLog }),
      signal: AbortSignal.timeout(6000)
    });
    const res = await AGRI_STORAGE.parseResponseSafely(r);
    if (!res || !res.success) throw new Error(res?.message || 'บันทึกไม่สำเร็จ');

    setSyncIndicator('synced', res.sheetSynced ? 'ซิงค์คลาวด์ + สำรองแล้ว' : 'บันทึกเข้าสมุดบัญชีแล้ว');
    refreshSheetsStatus();
    if (res.mongoSaved && res.sheetSynced) {
      showToast(`✅ บันทึก ${formatCurrency(totalCost)} ลงสมุดบัญชีคลาวด์และแผ่นงานสำรองแล้ว!`, 'success');
    } else if (res.mongoSaved) {
      showToast(`✅ บันทึก ${formatCurrency(totalCost)} ลงสมุดบัญชีคลาวด์แล้ว`, 'success');
    } else if (res.sheetSynced) {
      showToast(`⚠️ คลาวด์ออฟไลน์ — ส่งสำรอง ${formatCurrency(totalCost)} เข้าแผ่นงานสำรองแล้ว!`, 'warning');
    } else {
      showToast(`⚠️ บันทึกลงเครื่องแล้ว (${formatCurrency(totalCost)})`, 'warning');
    }

    const noteEl = document.getElementById('calc-note');
    if (noteEl) noteEl.value = '';
  } catch (err) {
    const directSynced = await fallbackDirectBrowserWebhook(accEntry, fieldLog);
    setSyncIndicator(directSynced ? 'synced' : 'error', directSynced ? 'สำรองออนไลน์แล้ว' : 'บันทึกในเครื่อง');
    showToast(
      directSynced
        ? `⚠️ เซิร์ฟเวอร์ออฟไลน์ — ส่ง ${formatCurrency(totalCost)} เข้าแผ่นงานสำรองโดยตรงแล้ว!`
        : `⚠️ บันทึก ${formatCurrency(totalCost)} ในเครื่องเรียบร้อย`,
      'warning'
    );
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// ====== VIEW SWITCHING & CONSOLIDATED NAVIGATION ======
function switchView(viewName) {
  const allViews = [
    'dashboard', 'gis', 'ops', 'workforce', 'harvest', 'accounting', 'orchards',
    'agrotech', 'calc', 'field', 'plant', 'finance'
  ];
  allViews.forEach(v => {
    document.getElementById('view-' + v)?.classList.add('hidden');
    document.getElementById('nav-' + v + '-btn')?.classList.remove('active');
    document.getElementById('mob-' + v + '-btn')?.classList.remove('active');
  });

  document.getElementById('view-' + viewName)?.classList.remove('hidden');

  let navKey = viewName;
  if (['field', 'plant', 'calc', 'agrotech'].includes(viewName)) navKey = 'ops';
  if (viewName === 'finance') navKey = 'accounting';

  document.getElementById('nav-' + navKey + '-btn')?.classList.add('active');
  document.getElementById('mob-' + navKey + '-btn')?.classList.add('active');

  if (viewName === 'gis' && typeof onGisViewShown === 'function') onGisViewShown();
  else if (viewName === 'ops' && typeof refreshOpsAll === 'function') refreshOpsAll();
  else if (viewName === 'workforce' && typeof refreshWorkforceAll === 'function') refreshWorkforceAll();
  else if (viewName === 'harvest' && typeof refreshHarvestAll === 'function') refreshHarvestAll();
  else if (viewName === 'dashboard' && typeof refreshExecutiveDashboard === 'function') refreshExecutiveDashboard();
  else if (viewName === 'orchards' && typeof renderOrchardsView === 'function') renderOrchardsView();
  else if ((viewName === 'accounting' || viewName === 'finance') && typeof renderAccEntries === 'function') renderAccEntries();
  else if (['calc', 'field', 'plant'].includes(viewName)) refreshPlotSelects();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleNav(event, viewName) {
  if (event) event.preventDefault();
  switchView(viewName);
}

// เมนูลัดจากปุ่ม "+" ตรงกลางบนมือถือ
function openMobileSheet() {
  document.getElementById('mobile-action-sheet')?.classList.remove('hidden');
}
function closeMobileSheet(e) {
  if (e && e.target !== e.currentTarget && !e.target.closest('.mobile-sheet-item') && !e.target.closest('button')) return;
  document.getElementById('mobile-action-sheet')?.classList.add('hidden');
}
function quickOpenExpense() {
  switchView('accounting');
  setAccType('expense');
}
function quickOpenIncome() {
  switchView('accounting');
  setAccType('income');
}

// ====== FORM HELPERS ======
function setAccType(type) {
  currentAccType = type;
  document.getElementById('type-inc-btn')?.classList.toggle('active', type === 'income');
  document.getElementById('type-exp-btn')?.classList.toggle('active', type === 'expense');
  document.getElementById('expense-itemized-section')?.classList.toggle('hidden', type !== 'expense');
  updateAccCategories();
  if (type === 'expense') {
    calculateTotalPurchaseAmount();
  }
}

function updateAccCategories() {
  if (typeof populateLedgerFormCategories === 'function') {
    populateLedgerFormCategories(currentAccType);
  }
}

function onActivityChange() {
  const act = document.getElementById('log-activity')?.value || '';
  document.getElementById('spray-section')?.classList.toggle('hidden', !act.includes('พ่นยา'));
  document.getElementById('chemical-induction-section')?.classList.toggle('hidden', !act.includes('ทำสาร'));
  document.getElementById('custom-activity-box')?.classList.toggle('hidden', !act.includes('อื่นๆ'));
}

function checkCustomOption(selId, boxId) {
  document.getElementById(boxId)?.classList.toggle('hidden', !(document.getElementById(selId)?.value || '').includes('อื่นๆ'));
}

function selectVigour(btn, r) {
  selectedVigour = r;
  document.querySelectorAll('#plant-form .segmented-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ====== FIELD-READY ITEMIZED PURCHASES (2-ROW CARDS + AUTOCOMPLETE) ======
function renderPurchaseItems() {
  const c = document.getElementById('purchase-items-container');
  if (!c) return;
  c.innerHTML = '';
  const units = ['กระสอบ', 'ขวด', 'แกลลอน', 'ถุง', 'กิโลกรัม', 'ลิตร', 'อัน', 'ชิ้น', 'ลัง', 'ชุด'];

  purchaseItems.forEach((item, i) => {
    const subTotal = safeNum(item.qty) * safeNum(item.price);
    const card = document.createElement('div');
    card.className = 'purchase-item-card';
    card.innerHTML = `
      <div class="purchase-row-top">
        <div>
          <span class="purchase-field-label">รายการที่ ${i + 1}: ชื่อสินค้า / ปุ๋ย / ยา / อุปกรณ์</span>
          <input type="text" list="agri-product-suggestions" class="form-control" placeholder="พิมพ์หรือเลือกชื่อปุ๋ย/ยา..." value="${escapeHtml(item.name)}" onchange="updatePurchaseItem(${i}, 'name', this.value)" />
        </div>
        <button type="button" class="btn btn-outline" style="height:44px;width:42px;padding:0;margin-top:18px;color:var(--rose-600);border-color:var(--rose-200);border-radius:10px;" onclick="removePurchaseItem(${i})" title="ลบรายการนี้">✕</button>
      </div>
      <div class="purchase-row-bottom">
        <div>
          <span class="purchase-field-label">จำนวน</span>
          <input type="number" class="form-control" min="0.1" step="any" placeholder="จำนวน" value="${item.qty}" oninput="updatePurchaseItemLive(${i}, 'qty', this.value)" />
        </div>
        <div>
          <span class="purchase-field-label">หน่วยนับ</span>
          <select class="form-control" style="padding:0 8px;" onchange="updatePurchaseItem(${i}, 'unit', this.value)">
            ${units.map(u => `<option value="${u}" ${item.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
          </select>
        </div>
        <div>
          <span class="purchase-field-label">ราคาต่อหน่วย (บาท)</span>
          <input type="number" class="form-control" min="0" step="any" placeholder="0.00" value="${item.price}" oninput="updatePurchaseItemLive(${i}, 'price', this.value)" />
        </div>
      </div>
      <div class="purchase-subtotal-bar">
        <span>รวมเป็นเงินรายการนี้</span>
        <strong style="color:var(--rose-700);font-size:0.95rem;" id="purchase-sub-${i}">${formatCurrency(subTotal)}</strong>
      </div>
    `;
    c.appendChild(card);
  });
  calculateTotalPurchaseAmount();
}

function addPurchaseItem() {
  purchaseItems.push({ name: '', qty: 1, unit: 'ขวด', price: 0 });
  renderPurchaseItems();
}

function removePurchaseItem(i) {
  if (purchaseItems.length <= 1) {
    showToast('ต้องมีอย่างน้อย 1 รายการสินค้า', 'warning');
    return;
  }
  purchaseItems.splice(i, 1);
  renderPurchaseItems();
}

function updatePurchaseItem(i, f, v) {
  purchaseItems[i][f] = v;
  if (f === 'name' && v) rememberProductNames([v]);
  renderPurchaseItems();
}

function updatePurchaseItemLive(i, f, v) {
  purchaseItems[i][f] = v;
  const sub = safeNum(purchaseItems[i].qty) * safeNum(purchaseItems[i].price);
  const subEl = document.getElementById(`purchase-sub-${i}`);
  if (subEl) subEl.innerText = formatCurrency(sub);
  calculateTotalPurchaseAmount();
}

function calculateTotalPurchaseAmount() {
  const t = purchaseItems.reduce((s, p) => s + safeNum(p.qty) * safeNum(p.price), 0);
  const el = document.getElementById('acc-amount');
  if (el && currentAccType === 'expense') el.value = t > 0 ? t.toFixed(2) : '';
}

// ====== SPRAY RECIPE ITEMS ======
function renderSprayRecipe() {
  const c = document.getElementById('spray-items-container');
  if (!c) return;
  c.innerHTML = '';
  const types = ['ปุ๋ยทางใบ', 'ยาฆ่าแมลง', 'ยาฆ่าเชื้อรา', 'ยากำจัดไร', 'อาหารเสริม/ฮอร์โมน', 'ยาจับใบ', 'อื่นๆ'];

  sprayItems.forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'spray-item-card';
    card.innerHTML = `
      <div class="spray-row-top">
        <div>
          <span class="purchase-field-label">ประเภทสาร</span>
          <select class="form-control" style="padding:0 8px;" onchange="updateSprayItem(${i}, 'type', this.value)">
            ${types.map(t => `<option value="${t}" ${item.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div>
          <span class="purchase-field-label">ชื่อยา / ปุ๋ยทางใบ</span>
          <input type="text" list="agri-product-suggestions" class="form-control" placeholder="ระบุชื่อยาหรือปุ๋ย..." value="${escapeHtml(item.name)}" onchange="updateSprayItem(${i}, 'name', this.value)" />
        </div>
        <button type="button" class="btn btn-outline" style="height:44px;width:42px;padding:0;margin-top:18px;color:var(--rose-600);border-color:var(--rose-200);border-radius:10px;" onclick="removeSprayItem(${i})">✕</button>
      </div>
      <div class="spray-row-bottom">
        <div>
          <span class="purchase-field-label">อัตราผสมต่อน้ำ 200 ลิตร</span>
          <input type="number" class="form-control" placeholder="ปริมาณ" value="${item.dose}" onchange="updateSprayItem(${i}, 'dose', this.value)" />
        </div>
        <div>
          <span class="purchase-field-label">หน่วยตวง</span>
          <select class="form-control" onchange="updateSprayItem(${i}, 'unit', this.value)">
            <option value="ซีซี" ${item.unit === 'ซีซี' || item.unit === 'cc' ? 'selected' : ''}>ซีซี (มิลลิลิตร)</option>
            <option value="กรัม" ${item.unit === 'กรัม' ? 'selected' : ''}>กรัม</option>
          </select>
        </div>
      </div>
    `;
    c.appendChild(card);
  });
}

function addSprayItem() {
  sprayItems.push({ type: 'ยาฆ่าแมลง', name: '', dose: 100, unit: 'ซีซี' });
  renderSprayRecipe();
}
function removeSprayItem(i) {
  if (sprayItems.length <= 1) {
    showToast('ต้องมีอย่างน้อย 1 รายการในสูตรพ่นยา', 'warning');
    return;
  }
  sprayItems.splice(i, 1);
  renderSprayRecipe();
}
function updateSprayItem(i, f, v) {
  sprayItems[i][f] = v;
  if (f === 'name' && v) rememberProductNames([v]);
}

// ====== PREDICTOR & AGRONOMY CALCULATIONS ======
function switchPredictorMode(mode) {
  currentPredictorModeLocal = mode;
  calculateFlowerDates();
  showToast(mode === 'flower' ? '🌸 สลับเป็นโหมดคาดการณ์ดอกและผล 10 ระยะ' : '🍃 สลับเป็นโหมดคาดการณ์ชุดใบใหม่ 6 ระยะ', 'success');
}

function syncVariety(src) {
  const d = document.getElementById('dash-predictor-variety');
  const f = document.getElementById('induction-variety-select');
  if (src === 'dash' && d && f) f.value = d.value;
  else if (src === 'form' && d && f) d.value = f.value;
  calculateFlowerDates();
}

function savePredictorPlan() {
  const dv = document.getElementById('dash-predictor-date')?.value || getTodayISO();
  const days = parseInt(document.getElementById('dash-predictor-days')?.value || 35, 10);
  const variety = document.getElementById('dash-predictor-variety')?.value || 'monthong';
  let hd = 120, vl = 'หมอนทอง';
  if (variety === 'kradoom') { hd = 90; vl = 'กระดุมทอง'; }
  else if (variety === 'chanee') { hd = 105; vl = 'ชะนี/พวงมณี'; }
  else if (variety === 'kanyao') { hd = 130; vl = 'ก้านยาว'; }
  const tf = formatDateThai(addDays(new Date(dv), days));
  const th = formatDateThai(addDays(new Date(dv), days + 60 + hd));
  const log = {
    id: 'field-' + Date.now(),
    date: dv,
    plot: 'ทุกสวนรวมกัน',
    activity: '🌸 วางแผนทำสารออกดอก',
    detail: `พันธุ์: ${vl} | สารออกฤทธิ์ ${days} วัน ➔ คาดการณ์ออกดอก: ${tf} | เก็บเกี่ยว: ${th}`,
    cost: 0
  };
  fieldLogs.unshift(log);
  saveLocalData();
  syncSingleEntryToSheet({ fieldLog: log });
  renderFieldLogs();
  showToast('บันทึกแผนคาดการณ์ลงประวัติแปลงเรียบร้อย', 'success');
}
function savePredictorToLog() { return savePredictorPlan(); }

function calculateFlowerDates() {
  let dashDateVal = document.getElementById('dash-predictor-date')?.value;
  let logDateVal = document.getElementById('log-date')?.value;
  const today = getTodayISO();

  if (!dashDateVal) {
    dashDateVal = today;
    const dashDateEl = document.getElementById('dash-predictor-date');
    if (dashDateEl) dashDateEl.value = dashDateVal;
  }
  if (!logDateVal) {
    logDateVal = dashDateVal;
    const logDateEl = document.getElementById('log-date');
    if (logDateEl) logDateEl.value = logDateVal;
  }

  const appDate = new Date(dashDateVal || logDateVal);

  if (currentPredictorModeLocal === 'flower') {
    const customDays = parseInt(document.getElementById('dash-predictor-days')?.value || document.getElementById('induction-custom-days')?.value || 35, 10);
    const activeDays = customDays > 0 ? customDays : 35;

    const variety = document.getElementById('dash-predictor-variety')?.value || 'monthong';
    let harvestDays = 120, varietyLabel = 'หมอนทอง';
    if (variety === 'kradoom') { harvestDays = 90; varietyLabel = 'กระดุมทอง'; }
    else if (variety === 'chanee') { harvestDays = 105; varietyLabel = 'ชะนี/พวงมณี'; }
    else if (variety === 'kanyao') { harvestDays = 130; varietyLabel = 'ก้านยาว'; }

    const stages = [
      { num: 'ระยะที่ 1', name: '🧪 วันราดสาร/พ่นทำสาร', date: appDate, desc: 'เริ่มกระตุ้นตาดอก (' + varietyLabel + ')', highlight: false },
      { num: 'ระยะที่ 2', name: '🌸 แทงตาดอกไข่ปลา', date: addDays(appDate, activeDays), desc: activeDays + ' วันหลังทำสาร', highlight: true },
      { num: 'ระยะที่ 3', name: '🍡 ระยะมะเขือพวง', date: addDays(appDate, activeDays + 15), desc: '+15 วัน หลังแทงตาพู', highlight: false },
      { num: 'ระยะที่ 4', name: '🏮 ระยะหัวฉีด', date: addDays(appDate, activeDays + 40), desc: '+25 วัน หลังมะเขือพวง', highlight: false },
      { num: 'ระยะที่ 5', name: '🌺 ระยะดอกบาน', date: addDays(appDate, activeDays + 60), desc: '+20 วัน หลังหัวฉีด', highlight: true },
      { num: 'ระยะที่ 6', name: '🎓 หางแย้ถอดหมวก', date: addDays(appDate, activeDays + 67), desc: '+7 วัน หลังดอกบาน', highlight: false },
      { num: 'ระยะที่ 7', name: '🍈 ระยะกระปุก', date: addDays(appDate, activeDays + 60 + Math.round(42 * harvestDays / 120)), desc: 'ประมาณ ' + Math.round(42 * harvestDays / 120) + ' วัน หลังดอกบาน', highlight: false },
      { num: 'ระยะที่ 8', name: '📦 ระยะขยายพู', date: addDays(appDate, activeDays + 60 + Math.round(62 * harvestDays / 120)), desc: 'ประมาณ ' + Math.round(62 * harvestDays / 120) + ' วัน หลังดอกบาน', highlight: false },
      { num: 'ระยะที่ 9', name: '🍯 ระยะสร้างเนื้อและแป้ง', date: addDays(appDate, activeDays + 60 + Math.round(97 * harvestDays / 120)), desc: 'ประมาณ ' + Math.round(97 * harvestDays / 120) + ' วัน หลังดอกบาน', highlight: false },
      { num: 'ระยะที่ 10', name: '🏆 ผลแก่พร้อมตัดเก็บเกี่ยว', date: addDays(appDate, activeDays + 60 + harvestDays), desc: '+' + harvestDays + ' วัน หลังดอกบาน (' + varietyLabel + ')', harvest: true }
    ];

    let gridHTML = '';
    stages.forEach(st => {
      const cardClass = st.harvest ? 'stage-card harvest-card' : (st.highlight ? 'stage-card highlight' : 'stage-card');
      gridHTML += `
        <div class="${cardClass}">
          <div class="stage-num">${st.num}</div>
          <div class="stage-name">${st.name}</div>
          <div class="stage-date">${formatDateThai(st.date)}</div>
          <div class="stage-desc">${st.desc}</div>
        </div>
      `;
    });

    const formGrid = document.getElementById('form-10-stage-grid');
    const dashGrid = document.getElementById('dash-10-stage-grid');
    if (formGrid) formGrid.innerHTML = gridHTML;
    if (dashGrid) dashGrid.innerHTML = gridHTML;
  } else {
    const leafStages = [
      { num: 'ระยะที่ 1', name: '🌱 แทงยอดอ่อน / ใบหางตระกวด', date: appDate, desc: 'เริ่มแตกยอดอ่อนใหม่ (วันที่ 1)', highlight: true },
      { num: 'ระยะที่ 2', name: '🍃 ระยะใบหางปลา', date: addDays(appDate, 7), desc: '+7 วัน (พ่นป้องกันเพลี้ยไก่แจ้)', highlight: false },
      { num: 'ระยะที่ 3', name: '🍃 ระยะใบอ่อนกางขยาย', date: addDays(appDate, 16), desc: '+9 วัน (พ่นปุ๋ยทางใบ + แคลเซียมโบรอน)', highlight: false },
      { num: 'ระยะที่ 4', name: '🌿 ระยะใบเพสลาดอ่อน', date: addDays(appDate, 28), desc: '+12 วัน (ใบเริ่มเข้าสีเขียวอ่อน)', highlight: true },
      { num: 'ระยะที่ 5', name: '🌿 ระยะใบเพสลาดแก่', date: addDays(appDate, 40), desc: '+12 วัน (ใส่ปุ๋ยทางดินสะสมอาหาร)', highlight: false },
      { num: 'ระยะที่ 6', name: '🌳 ใบแก่เขียวเข้มสมบูรณ์', date: addDays(appDate, 55), desc: '+15 วัน (ใบแก่เต็มที่ พร้อมทำสาร)', harvest: true }
    ];

    let gridHTML = '';
    leafStages.forEach(st => {
      const cardClass = st.harvest ? 'stage-card harvest-card' : (st.highlight ? 'stage-card highlight' : 'stage-card');
      gridHTML += `
        <div class="${cardClass}">
          <div class="stage-num">${st.num}</div>
          <div class="stage-name">${st.name}</div>
          <div class="stage-date">${formatDateThai(st.date)}</div>
          <div class="stage-desc">${st.desc}</div>
        </div>
      `;
    });

    const formGrid = document.getElementById('form-10-stage-grid');
    const dashGrid = document.getElementById('dash-10-stage-grid');
    if (formGrid) formGrid.innerHTML = gridHTML;
    if (dashGrid) dashGrid.innerHTML = gridHTML;
  }
}

function calculateNutrients() {
  const stage = document.getElementById('calc-stage')?.value || '';
  const tankLiters = parseFloat(document.getElementById('calc-trees')?.value || 1000);
  const factor = tankLiters / 1000;

  const headerTitle = document.getElementById('rec-header-title');
  if (headerTitle) {
    headerTitle.innerText = `📋 สูตรปุ๋ยและสารป้องกันที่แนะนำ (สำหรับถัง ${tankLiters.toLocaleString('th-TH')} ลิตร):`;
  }

  const recNpk = document.getElementById('rec-npk');
  const recNpkSub = document.getElementById('rec-npk-sub');
  const recCamg = document.getElementById('rec-camg');
  const recCamgSub = document.getElementById('rec-camg-sub');
  const recZnb = document.getElementById('rec-znb');
  const recZnbSub = document.getElementById('rec-znb-sub');
  const recPest = document.getElementById('rec-pest');
  const recPestSub = document.getElementById('rec-pest-sub');
  if (!recNpk) return;

  let npkCost = 1400, camgCost = 390, znbCost = 580, pestCost = 620;

  if (stage.includes('หางปลา')) {
    recNpk.innerText = '15-0-0 หรือ 25-7-7';
    recNpkSub.innerText = 'อัตรา 800 กรัม / ต้น (เร่งการแตกยอดและใบใหม่)';
    recCamg.innerText = 'แมกนีเซียมคีเลต + ซิงค์';
    recCamgSub.innerText = `อัตรา ${(1.0 * factor).toFixed(1)} ลิตร + ซิงค์ ${(750 * factor).toFixed(0)} กรัม / ถัง ${tankLiters} ลิตร`;
    recZnb.innerText = 'สาหร่ายทะเล + อะมิโนสร้างใบ';
    recZnbSub.innerText = `อัตรา ${(1.5 * factor).toFixed(1)} ลิตร / ถัง ${tankLiters} ลิตร`;
    recPest.innerText = 'ป้องกันเพลี้ยไก่แจ้ & เพลี้ยไฟ';
    recPestSub.innerText = `พ่น อิมิดาโคลพริด (${(1.0 * factor).toFixed(1)} ลิตร) + แมนโคเซบ (${(1.5 * factor).toFixed(1)} กก.)`;
    npkCost = 1150 * factor; camgCost = 380 * factor; znbCost = 590 * factor; pestCost = 540 * factor;
  } else if (stage.includes('ใบกาง')) {
    recNpk.innerText = '15-5-20 หรือ 16-16-16';
    recNpkSub.innerText = 'อัตรา 1.0 กก. / ต้น (ขยายขนาดแผ่นใบให้หนากว้าง)';
    recCamg.innerText = 'ธาตุอาหารรอง-เสริมรวม';
    recCamgSub.innerText = `อัตรา ${(1.0 * factor).toFixed(1)} ลิตร / ถัง ${tankLiters} ลิตร`;
    recZnb.innerText = 'ปุ๋ยทางใบ 15-5-20 หรือ 20-20-20';
    recZnbSub.innerText = `อัตรา ${(1.5 * factor).toFixed(1)} กก. + น้ำตาลทางด่วน ${(1.5 * factor).toFixed(1)} ลิตร`;
    recPest.innerText = 'ป้องกันโรคใบติด & แอนแทรคโนส';
    recPestSub.innerText = `พ่น คาร์เบนดาซิม (${(1.0 * factor).toFixed(1)} ลิตร) + อะบาเมกติน (${(1.0 * factor).toFixed(1)} ลิตร)`;
    npkCost = 1350 * factor; camgCost = 340 * factor; znbCost = 520 * factor; pestCost = 580 * factor;
  } else if (stage.includes('ใบเพสลาด')) {
    recNpk.innerText = '15-5-25 หรือ 13-13-21';
    recNpkSub.innerText = 'อัตรา 1.2 กก. / ต้น (บำรุงใบแก่ให้สมบูรณ์)';
    recCamg.innerText = 'แคลเซียม-โบรอน เข้มข้น';
    recCamgSub.innerText = `อัตรา ${(1.5 * factor).toFixed(1)} ลิตร / ถัง ${tankLiters} ลิตร`;
    recZnb.innerText = 'ปุ๋ยทางใบสะสมอาหาร 0-20-44';
    recZnbSub.innerText = `อัตรา ${(2.5 * factor).toFixed(1)} กก. / ถัง ${tankLiters} ลิตร`;
    recPest.innerText = 'ป้องกันไรแดง & เพลี้ยจักจั่นฝอย';
    recPestSub.innerText = `พ่น อะบาเมกติน (${(1.0 * factor).toFixed(1)} ลิตร) หรือ ไพริดาเบน (${(1.0 * factor).toFixed(1)} กก.)`;
    npkCost = 1450 * factor; camgCost = 420 * factor; znbCost = 620 * factor; pestCost = 640 * factor;
  } else if (stage.includes('สะสมอาหาร')) {
    recNpk.innerText = '8-24-24 หรือ 9-25-25';
    recNpkSub.innerText = 'อัตรา 800 กรัม / ต้น (สะสมอาหารในกิ่งเตรียมออกดอก)';
    recCamg.innerText = 'โบรอนเดี่ยว + ซิงค์สะสมตาดอก';
    recCamgSub.innerText = `อัตรา ${(1.0 * factor).toFixed(1)} ลิตร / ถัง ${tankLiters} ลิตร`;
    recZnb.innerText = 'ปุ๋ยเกร็ด 0-52-34 + ซอร์บิทอล';
    recZnbSub.innerText = `อัตรา ${(5.0 * factor).toFixed(1)} กก. + น้ำตาลทางด่วน ${(1.5 * factor).toFixed(1)} ลิตร`;
    recPest.innerText = 'ป้องกันราสีชมพู & ไฟทอปธอรา';
    recPestSub.innerText = `พ่น ฟอสอีทิล-อะลูมิเนียม (${(1.5 * factor).toFixed(1)} กก.) หรือ เมทาแลกซิล`;
    npkCost = 1600 * factor; camgCost = 390 * factor; znbCost = 771 * factor; pestCost = 650 * factor;
  } else if (stage.includes('ดอกบาน')) {
    recNpk.innerText = 'งดปุ๋ยไนโตรเจนสูง (ใส่ 13-13-21 อัตราต่ำ)';
    recNpkSub.innerText = 'อัตรา 200 กรัม / ต้น (เน้นบำรุงทางใบช่วงดอกบาน)';
    recCamg.innerText = 'แคลเซียม-โบรอน ขั้วเหนียว';
    recCamgSub.innerText = `อัตรา ${(1.5 * factor).toFixed(1)} ลิตร / ถัง ${tankLiters} ลิตร (ช่วยผสมเกสร)`;
    recZnb.innerText = 'อะมิโนขั้วเหนียว + ฮอร์โมนติดผล';
    recZnbSub.innerText = `อัตรา ${(250 * factor).toFixed(0)} ซีซี / ถัง ${tankLiters} ลิตร`;
    recPest.innerText = 'ป้องกันหนอนเจาะดอก & ราแอนแทรคโนส';
    recPestSub.innerText = `พ่น คาร์เบนดาซิม (${(1.0 * factor).toFixed(1)} ลิตร) + อะบาเมกติน (${(1.0 * factor).toFixed(1)} ลิตร)`;
    npkCost = 450 * factor; camgCost = 440 * factor; znbCost = 480 * factor; pestCost = 580 * factor;
  } else if (stage.includes('ขยายพู')) {
    recNpk.innerText = '13-13-21 หรือ 12-12-17-2';
    recNpkSub.innerText = 'อัตรา 1.5 กก. / ต้น (ขยายพู สร้างเนื้อ หวานมัน)';
    recCamg.innerText = 'แคลเซียมไนเตรต 15-0-0 + แมกนีเซียม';
    recCamgSub.innerText = `อัตรา ${(1.5 * factor).toFixed(1)} ลิตร / ถัง ${tankLiters} ลิตร (ป้องกันผลแตก)`;
    recZnb.innerText = 'ปุ๋ยทางใบ 0-0-50 + โพแทสเซียมฮิวเมต';
    recZnbSub.innerText = `อัตรา ${(2.5 * factor).toFixed(1)} กก. / ถัง ${tankLiters} ลิตร`;
    recPest.innerText = 'ป้องกันเพลี้ยแป้ง & หนอนเจาะผล';
    recPestSub.innerText = `พ่น ฟิโพรนิล (${(1.0 * factor).toFixed(1)} ลิตร) + ยาจับใบเกรดพรีเมียม`;
    npkCost = 1750 * factor; camgCost = 490 * factor; znbCost = 680 * factor; pestCost = 610 * factor;
  }

  const setCost = (id, amt) => {
    const el = document.getElementById(id);
    if (el) el.innerText = 'ประมาณ ' + formatCurrency(amt);
  };
  setCost('rec-npk-cost', npkCost);
  setCost('rec-camg-cost', camgCost);
  setCost('rec-znb-cost', znbCost);
  setCost('rec-pest-cost', pestCost);

  const totalCostEl = document.getElementById('calc-total-cost');
  if (totalCostEl) {
    totalCostEl.value = (npkCost + camgCost + znbCost + pestCost).toFixed(2);
  }
}

function calculateSprayWater() {
  const ph = parseFloat(document.getElementById('water-ph')?.value || 7.8);
  const tankLiters = parseFloat(document.getElementById('water-tank')?.value || 1000);
  const resultBox = document.getElementById('ph-adj-result');
  if (!resultBox) return;

  let adjText = '';
  if (ph > 7.0) {
    const acidCc = ((ph - 6.2) * 200 * (tankLiters / 1000)).toFixed(0);
    adjText = `💧 <strong>การปรับคุณภาพน้ำ</strong>: ค่า pH น้ำ ${ph} (เป็นด่าง) <br/>👉 แนะนำเติมสารปรับสภาพน้ำจำนวน <strong>${acidCc} ซีซี</strong> เพื่อลด pH มาอยู่ที่ <strong>5.5 - 6.5</strong> ก่อนผสมยา`;
  } else if (ph < 5.0) {
    adjText = `💧 <strong>การปรับคุณภาพน้ำ</strong>: ค่า pH น้ำ ${ph} (เป็นกรดจัด) <br/>👉 แนะนำปรับค่า pH น้ำให้อยู่ที่ <strong>6.0</strong> ก่อนผสมสารเคมี`;
  } else {
    adjText = `💧 <strong>การปรับคุณภาพน้ำ</strong>: ค่า pH น้ำ ${ph} อยู่ในเกณฑ์เหมาะสมพร้อมผสมยาพ่น (5.5 - 6.5)`;
  }

  const treesCount = (tankLiters / 10).toFixed(0);
  resultBox.innerHTML = `${adjText} <br/>💧 <strong>อัตราพ่นต่อต้น</strong>: ใช้น้ำเฉลี่ย <strong>10 ลิตร/ต้น</strong> (ถัง ${tankLiters.toLocaleString('th-TH')} ลิตร พ่นได้ประมาณ ${treesCount} ต้น)`;
}

function showChartTooltip(monthLabel, rev, exp) {
  const mEl = document.getElementById('tt-month');
  const dEl = document.getElementById('tt-details');
  const pEl = document.getElementById('tt-profit');
  const net = rev - exp;
  if (mEl) mEl.innerText = '📍 ข้อมูล ' + monthLabel;
  if (dEl) dEl.innerHTML = `รายรับ <strong>${formatCurrency(rev)}</strong> | รายจ่าย <strong>${formatCurrency(exp)}</strong>`;
  if (pEl) pEl.innerText = `กำไรสุทธิ +${formatCurrency(net)}`;
}

// ====== AGRO MEASUREMENTS & EXPERT ANALYSIS ======
function saveAgroMeasurements() {
  const g = id => document.getElementById(id)?.value || '0';
  const m = {
    soil15: g('input-soil-15'), soil30: g('input-soil-30'),
    ph: g('input-soil-ph'), ec: g('input-soil-ec'),
    temp: g('input-air-temp'), hum: g('input-air-hum'), rain: g('input-rain')
  };
  AGRI_STORAGE.saveAgroMeasurementsCache(m);
  const dv = getTodayISO();
  const log = {
    id: 'field-soil-' + Date.now(),
    date: dv,
    plot: 'ทุกสวนรวมกัน',
    activity: '🔬 ตรวจวัดสภาพดินและอากาศ',
    detail: `ความชื้น 15 ซม.: ${safeNum(m.soil15).toFixed(1)}% | 30 ซม.: ${safeNum(m.soil30).toFixed(1)}% | กรด-ด่าง: ${safeNum(m.ph).toFixed(1)} | ความเค็ม: ${safeNum(m.ec).toFixed(1)} | อุณหภูมิ: ${safeNum(m.temp).toFixed(1)} องศา`,
    cost: 0
  };
  fieldLogs.unshift(log);
  saveLocalData();
  syncSingleEntryToSheet({ fieldLog: log });
  renderFieldLogs();
  showToast('บันทึกค่าตรวจวัดดินและอากาศเรียบร้อย', 'success');
}

function loadAgroMeasurementsFromCache() {
  const m = AGRI_STORAGE.getAgroMeasurementsCache();
  if (m) {
    const sv = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; };
    sv('input-soil-15', m.soil15); sv('input-soil-30', m.soil30);
    sv('input-soil-ph', m.ph); sv('input-soil-ec', m.ec);
    sv('input-air-temp', m.temp); sv('input-air-hum', m.hum); sv('input-rain', m.rain);
  }
  runAgroAnalysis();
}

function runAgroAnalysis() {
  const soil15 = parseFloat(document.getElementById('input-soil-15')?.value || 0);
  const soil30 = parseFloat(document.getElementById('input-soil-30')?.value || 0);
  const ph = parseFloat(document.getElementById('input-soil-ph')?.value || 0);
  const ec = parseFloat(document.getElementById('input-soil-ec')?.value || 0);
  const temp = parseFloat(document.getElementById('input-air-temp')?.value || 0);
  const hum = parseFloat(document.getElementById('input-air-hum')?.value || 0);
  const rain = parseFloat(document.getElementById('input-rain')?.value || 0);

  const k15 = document.getElementById('kpi-soil-15');
  const k30 = document.getElementById('kpi-soil-30');
  const kph = document.getElementById('kpi-soil-ph');
  const kec = document.getElementById('kpi-soil-ec');

  if (k15) k15.innerText = soil15.toFixed(1) + '%';
  if (k30) k30.innerText = soil30.toFixed(1) + '%';
  if (kph) kph.innerText = ph.toFixed(1);
  if (kec) kec.innerText = ec.toFixed(1);

  const t15 = document.getElementById('trend-soil-15');
  const t30 = document.getElementById('trend-soil-30');
  const tph = document.getElementById('trend-soil-ph');
  const tec = document.getElementById('trend-soil-ec');

  if (t15) {
    if (soil15 < 20) { t15.innerHTML = '🔴 แห้งจัด! เสี่ยงรากฝอยขาดน้ำ'; t15.style.color = 'var(--rose-700)'; }
    else if (soil15 <= 35) { t15.innerHTML = '🟢 แห้งพอดีสำหรับกักน้ำกระตุ้นดอก'; t15.style.color = 'var(--emerald-700)'; }
    else if (soil15 <= 50) { t15.innerHTML = '🟢 ความชื้นเหมาะสม ให้น้ำปกติ'; t15.style.color = 'var(--blue-700)'; }
    else { t15.innerHTML = '⚠️ ดินแฉะ ระวังแตกใบอ่อนทับตาดอก'; t15.style.color = 'var(--amber-700)'; }
  }

  if (t30) {
    if (soil30 < 25) { t30.innerHTML = '🔴 แห้งรุนแรง รากดูดปุ๋ยไม่ได้'; t30.style.color = 'var(--rose-700)'; }
    else if (soil30 <= 65) { t30.innerHTML = '🟢 รากดูดซึมธาตุอาหารได้ดี'; t30.style.color = 'var(--emerald-700)'; }
    else { t30.innerHTML = '🔴 ดินอิ่มน้ำ เสี่ยงโรครากเน่าโคนเน่า'; t30.style.color = 'var(--rose-700)'; }
  }

  if (tph) {
    if (ph < 5.5) { tph.innerHTML = '🔴 ดินเป็นกรด แนะนำหว่านโดโลไมท์'; tph.style.color = 'var(--rose-700)'; }
    else if (ph <= 6.5) { tph.innerHTML = '🟢 เหมาะสมต่อทุเรียนดีเยี่ยม (5.5-6.5)'; tph.style.color = 'var(--emerald-700)'; }
    else { tph.innerHTML = '⚠️ ดินเป็นด่าง ระวังขาดธาตุจุลธาตุ'; tph.style.color = 'var(--amber-700)'; }
  }

  if (tec) {
    if (ec < 0.5) { tec.innerHTML = '⚠️ ปริมาณธาตุอาหารในดินต่ำ'; tec.style.color = 'var(--amber-700)'; }
    else if (ec <= 1.8) { tec.innerHTML = '🟢 ความเข้มข้นปุ๋ยเหมาะสม ปลอดภัย'; tec.style.color = 'var(--emerald-700)'; }
    else { tec.innerHTML = '🔴 ดินเค็ม เสี่ยงรากฝอยไหม้'; tec.style.color = 'var(--rose-700)'; }
  }

  const pointEl = document.getElementById('chart-point-current');
  if (pointEl) {
    let pct = Math.min(1, Math.max(0, (soil15 - 10) / 70));
    pointEl.setAttribute('cy', 160 - pct * 120);
  }

  let recWaterHtml = soil15 > 35 && currentPredictorModeLocal === 'flower'
    ? `<div style="background:var(--rose-50);padding:14px;border-radius:10px;border:1.5px solid var(--rose-200);"><strong style="color:var(--rose-800)">💧 การจัดการน้ำ: แนะนำงดน้ำกระตุ้นตาดอก</strong><p style="font-size:0.86rem;color:var(--rose-700);margin-top:6px;">ความชื้นดินชั้นบนอยู่ที่ ${soil15.toFixed(1)}% ให้งดให้น้ำเพื่อให้ใบโศกและกระตุ้นการแทงตาดอก</p></div>`
    : `<div style="background:var(--emerald-50);padding:14px;border-radius:10px;border:1.5px solid var(--emerald-200);"><strong style="color:var(--emerald-800)">💧 การจัดการน้ำ: รักษาความชื้นตามเกณฑ์ปกติ</strong><p style="font-size:0.86rem;color:var(--emerald-700);margin-top:6px;">ความชื้นดิน ${soil15.toFixed(1)}% อยู่ในเกณฑ์สมดุล ให้น้ำสม่ำเสมอเพื่อประคองตาดอกและใบ</p></div>`;

  let recSoilHtml = ph < 5.5
    ? `<div style="background:var(--rose-50);padding:14px;border-radius:10px;border:1.5px solid var(--rose-200);"><strong style="color:var(--rose-800)">🧪 การจัดการดิน: ดินเปรี้ยวจัด (ระดับ ${ph.toFixed(1)})</strong><p style="font-size:0.86rem;color:var(--rose-700);margin-top:6px;">แนะนำหว่านปูนโดโลไมท์ 2-3 กก./ต้น รอบทรงพุ่มเพื่อปรับสภาพดินและลดความเสี่ยงเชื้อราไฟทอปธอรา</p></div>`
    : `<div style="background:var(--emerald-50);padding:14px;border-radius:10px;border:1.5px solid var(--emerald-200);"><strong style="color:var(--emerald-800)">🧪 การจัดการดิน: สภาพดินสมบูรณ์ดี (ระดับ ${ph.toFixed(1)})</strong><p style="font-size:0.86rem;color:var(--emerald-700);margin-top:6px;">ค่ากรด-ด่างและความเค็มดิน (${ec.toFixed(1)}) เหมาะสมต่อการดูดซึมปุ๋ยทางดิน</p></div>`;

  let recWeatherHtml = hum > 85 && rain > 5
    ? `<div style="background:var(--rose-50);padding:14px;border-radius:10px;border:1.5px solid var(--rose-200);"><strong style="color:var(--rose-800)">🌦️ สภาพอากาศ: ความชื้นสูง เสี่ยงโรคเชื้อรา</strong><p style="font-size:0.86rem;color:var(--rose-700);margin-top:6px;">ความชื้น ${hum.toFixed(0)}% และฝนสะสม ${rain.toFixed(1)} มม. แนะนำฉีดพ่นสารป้องกันเชื้อราเมทาแลกซิลหรือฟอสอีทิล-อะลูมิเนียม</p></div>`
    : `<div style="background:var(--emerald-50);padding:14px;border-radius:10px;border:1.5px solid var(--emerald-200);"><strong style="color:var(--emerald-800)">🌦️ สภาพอากาศ: ปลอดโปร่ง เหมาะแก่การพ่นยา</strong><p style="font-size:0.86rem;color:var(--emerald-700);margin-top:6px;">อุณหภูมิ ${temp.toFixed(1)} องศา ความชื้น ${hum.toFixed(0)}% สามารถให้ปุ๋ยและพ่นสารบำรุงทางใบได้ตามปกติ</p></div>`;

  const advBoard = document.getElementById('expert-advisory-board');
  if (advBoard) advBoard.innerHTML = recWaterHtml + recSoilHtml + recWeatherHtml;
}

function showSensorTooltip(title, d15, d30) {
  showToast(title + ' — ' + d15 + ' | ' + d30, 'success');
}

// ====== GOOGLE SHEET BACKUP & WEBHOOK SYNC ======
const APPS_SCRIPT_TEMPLATE = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = data.spreadsheetId ? SpreadsheetApp.openById(data.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = data.sheetName || "สมุดบัญชี";
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    var rows = Array.isArray(data.rows) ? data.rows : (data.row ? [data.row] : []);
    if (rows.length > 0) {
      var existingIds = {};
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < idValues.length; i++) {
          if (idValues[i][0]) existingIds[String(idValues[i][0])] = true;
        }
      }
      var newRows = rows.filter(function(r) {
        return !r[0] || !existingIds[String(r[0])];
      });
      if (newRows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true, added: rows.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

async function syncSingleEntryToSheet({ accEntry = null, fieldLog = null, plantSurvey = null }) {
  try {
    const r = await AGRI_STORAGE.authFetch('/api/sheets/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: currentLoggedInEmail || 'guest', accEntry, fieldLog, plantSurvey }),
      signal: AbortSignal.timeout(15000)
    });
    const res = await AGRI_STORAGE.parseResponseSafely(r);
    if (res && res.success) refreshSheetsStatus();
  } catch (e) {
    await fallbackDirectBrowserWebhook(accEntry, fieldLog, plantSurvey);
  }
}

const DEFAULT_SHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwVf9LIXdaMpM6ZVzRwWkBm561bPyzs3Hn0LevgqONarzqaJbMIlZEG513XlDqircZmBg/exec';

async function fallbackDirectBrowserWebhook(accEntry, fieldLog, plantSurvey = null) {
  const url = localStorage.getItem('agridash_sheets_webhook_url') || DEFAULT_SHEETS_WEBHOOK_URL;
  if (!url) return false;
  const nowThai = new Date().toLocaleString('th-TH');
  try {
    if (accEntry) {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          spreadsheetId: '1Z5VJksCIxIYji6FrmG2faT4M27yXbnlg-rbP3e9koOY',
          sheetName: 'สมุดบัญชี',
          rows: [[
            accEntry.id,
            formatDateSlashThai(accEntry.date),
            accEntry.type === 'income' ? 'รายรับ' : 'รายจ่าย',
            accEntry.plot || 'รวมทุกแปลง',
            accEntry.category || '-',
            accEntry.detail || '-',
            Number(accEntry.amount || 0),
            currentLoggedInEmail || 'guest',
            nowThai
          ]]
        })
      });
    }
    if (fieldLog) {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          spreadsheetId: '1Z5VJksCIxIYji6FrmG2faT4M27yXbnlg-rbP3e9koOY',
          sheetName: 'งานแปลงและคำนวณปุ๋ย',
          rows: [[
            fieldLog.id,
            formatDateSlashThai(fieldLog.date),
            fieldLog.plot || 'ทุกแปลง',
            fieldLog.activity || '-',
            fieldLog.detail || '-',
            Number(fieldLog.cost || 0),
            currentLoggedInEmail || 'guest',
            nowThai
          ]]
        })
      });
    }
    if (plantSurvey) {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          spreadsheetId: '1Z5VJksCIxIYji6FrmG2faT4M27yXbnlg-rbP3e9koOY',
          sheetName: 'สำรวจสุขภาพต้น',
          rows: [[
            plantSurvey.id,
            formatDateSlashThai(plantSurvey.date),
            plantSurvey.plot || 'ทุกแปลง',
            plantSurvey.stage || '-',
            plantSurvey.leafPest || '-',
            plantSurvey.trunk || '-',
            plantSurvey.recommendation || '-',
            currentLoggedInEmail || 'guest',
            nowThai
          ]]
        })
      });
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function refreshSheetsStatus() {
  const pill = document.getElementById('calc-sheet-status-pill');
  const modalStatus = document.getElementById('sheets-modal-status');
  const directLink = document.getElementById('sheets-direct-link');
  const inputEl = document.getElementById('sheets-webhook-input');
  try {
    const r = await AGRI_STORAGE.authFetch('/api/sheets/config', { signal: AbortSignal.timeout(5000) });
    const cfg = await AGRI_STORAGE.parseResponseSafely(r);
    if (!cfg || !cfg.success) return;

    if (cfg.webhookUrl) {
      localStorage.setItem('agridash_sheets_webhook_url', cfg.webhookUrl);
    }
    if (inputEl && !inputEl.value && cfg.webhookUrl) inputEl.value = cfg.webhookUrl;
    if (directLink && cfg.spreadsheetUrl) directLink.href = cfg.spreadsheetUrl;

    if (cfg.configured) {
      if (pill) {
        pill.innerText = `🟢 ซิงค์ Google Sheet สำรองอัตโนมัติ (ส่งแล้ว ${cfg.syncedCount} รายการ)`;
        pill.style.background = 'var(--emerald-100)';
        pill.style.color = 'var(--emerald-800)';
      }
      if (modalStatus) {
        modalStatus.innerText = `🟢 เชื่อมต่อ Google Sheet สำรองอัตโนมัติแล้ว (ซิงค์สำเร็จ ${cfg.syncedCount} รายการ)`;
      }
    } else {
      const pendingText = cfg.pendingCount > 0 ? ` — ค้างส่ง ${cfg.pendingCount} รายการ` : '';
      if (pill) {
        pill.innerText = `🟡 กดเพื่อเชื่อมต่อลิงก์ Google Sheet${pendingText}`;
        pill.style.background = 'var(--amber-100)';
        pill.style.color = 'var(--amber-800)';
      }
      if (modalStatus) {
        modalStatus.innerText = `🟡 สร้างไฟล์ Google Sheet สำรองแล้ว${pendingText} (วางลิงก์ Apps Script ด้านล่างเพื่อเปิดซิงค์อัตโนมัติ)`;
      }
    }
  } catch (e) {
    const localUrl = localStorage.getItem('agridash_sheets_webhook_url');
    if (pill) {
      pill.innerText = localUrl ? '🟢 พร้อมซิงค์ Google Sheet (สำรอง)' : '⚠️ โหมดออฟไลน์ — ใช้แคชสำรอง';
    }
  }
}

function openSheetsModal() {
  document.getElementById('sheets-modal')?.classList.remove('hidden');
  refreshSheetsStatus();
}

function closeSheetsModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('sheets-modal')?.classList.add('hidden');
}

async function saveSheetsWebhook() {
  const url = (document.getElementById('sheets-webhook-input')?.value || '').trim();
  if (url && !url.startsWith('https://script.google.com/')) {
    showToast('กรุณาวางลิงก์ Google Apps Script Web App ที่ขึ้นต้นด้วย https://script.google.com/', 'error');
    return;
  }
  if (url) localStorage.setItem('agridash_sheets_webhook_url', url);
  else localStorage.removeItem('agridash_sheets_webhook_url');

  try {
    const r = await AGRI_STORAGE.authFetch('/api/sheets/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: url }),
      signal: AbortSignal.timeout(4000)
    });
    const res = await AGRI_STORAGE.parseResponseSafely(r);
    showToast(res.message || 'บันทึกลิงก์สำเร็จ', 'success');
  } catch (e) {
    showToast('บันทึกลิงก์ในเบราว์เซอร์เรียบร้อย (โหมดสำรอง)', 'success');
  }
  refreshSheetsStatus();
  if (url) await flushAllToGoogleSheet();
}

async function flushAllToGoogleSheet() {
  try {
    showToast('🔄 กำลังซิงค์ข้อมูลทั้งหมดขึ้น Google Sheet...', 'success');
    const r = await AGRI_STORAGE.authFetch('/api/sheets/flush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: currentLoggedInEmail || 'guest' }),
      signal: AbortSignal.timeout(20000)
    });
    const res = await AGRI_STORAGE.parseResponseSafely(r);
    showToast('✅ ' + (res.message || 'ซิงค์สำเร็จ'), 'success');
    refreshSheetsStatus();
  } catch (e) {
    // โหมดออฟไลน์ / GitHub Pages: ยิงสำรองตรงเข้า Apps Script จากเบราว์เซอร์
    const localUrl = localStorage.getItem('agridash_sheets_webhook_url') || DEFAULT_SHEETS_WEBHOOK_URL;
    if (localUrl) {
      let sentCount = 0;
      for (const entry of accEntries) {
        await fallbackDirectBrowserWebhook(entry, null, null);
        sentCount++;
      }
      for (const log of fieldLogs) {
        await fallbackDirectBrowserWebhook(null, log, null);
        sentCount++;
      }
      for (const survey of plantSurveys) {
        await fallbackDirectBrowserWebhook(null, null, survey);
        sentCount++;
      }
      showToast(`✅ ส่งสำรอง ${sentCount} รายการทั้งหมดขึ้น Google Sheet สำเร็จ!`, 'success');
      refreshSheetsStatus();
    } else {
      showToast('⚠️ เซิร์ฟเวอร์ออฟไลน์ — บันทึกข้อมูลในเครื่องเรียบร้อย', 'warning');
    }
  }
}

async function copyAppsScriptCode() {
  try {
    await navigator.clipboard.writeText(APPS_SCRIPT_TEMPLATE);
    showToast('📋 คัดลอกโค้ด Apps Script เรียบร้อย! นำไปวางใน Google Sheet ได้เลย', 'success');
  } catch (e) {
    showToast('ไม่สามารถคัดลอกอัตโนมัติได้ กรุณาลองอีกครั้ง', 'error');
  }
}

// ====== SESSION EXPIRY HANDLER ======
window.addEventListener('agri-auth-expired', () => {
  AGRI_STORAGE.setToken('');
  if (!isGuestMode && currentLoggedInEmail !== 'guest') {
    showToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้งเพื่อซิงค์ข้อมูลคลาวด์', 'warning');
    openLoginModal();
  }
});

// ====== INITIALIZATION ON LOAD ======
document.addEventListener('DOMContentLoaded', async () => {
  setDefaultTodayDates();
  updateAccCategories();
  renderPurchaseItems();
  renderSprayRecipe();
  calculateNutrients();
  calculateSprayWater();
  calculateFlowerDates();

  if (typeof AGRI_ORCHARDS !== 'undefined') {
    AGRI_ORCHARDS.onChange(refreshPlotSelects);
  }
  refreshPlotSelects();

  const session = AGRI_STORAGE.getSession();
  if (session.email && !session.isGuest && session.email !== 'guest') {
    currentLoggedInEmail = session.email;
    isGuestMode = false;
    document.getElementById('auth-modal')?.classList.add('hidden');
    const recent = (AGRI_STORAGE.getRecentAccounts ? AGRI_STORAGE.getRecentAccounts() : []).find(a => a.email === session.email);
    updateAvatarUI(session.email, recent?.firstName, recent?.farmName);
  } else {
    currentLoggedInEmail = 'guest';
    isGuestMode = true;
    AGRI_STORAGE.saveSession('guest', true);
    updateAvatarUI('guest');
  }

  hidePageLoader();

  const healthPromise = AGRI_STORAGE.checkHealth().then(health => {
    updateConnectionUI(health);
    return health;
  });

  await reloadUserWorkspace();
  refreshSheetsStatus();
  await healthPromise;

  setInterval(async () => {
    updateConnectionUI(await AGRI_STORAGE.checkHealth());
  }, 30000);
});
