/* ============================================================
   AgriDash - Offline-First Storage Module (storage.js)
   Handles: API calls, localStorage cache, sync & retry
   ============================================================ */
const AGRI_STORAGE = (() => {
  const CACHE_PREFIX = 'agridash_v2_';

  // ----- Safe localStorage wrapper -----
  const mem = {};
  const ls = {
    get(k) {
      try { return localStorage.getItem(CACHE_PREFIX + k); }
      catch(e) { return mem[k] || null; }
    },
    set(k, v) {
      try { localStorage.setItem(CACHE_PREFIX + k, v); }
      catch(e) { mem[k] = v; }
    },
    remove(k) {
      try { localStorage.removeItem(CACHE_PREFIX + k); }
      catch(e) { delete mem[k]; }
    }
  };

  // ----- Session helpers -----
  const SESSION_KEY_EMAIL = 'session_email';
  const SESSION_KEY_GUEST = 'session_guest';
  const SESSION_KEY_DATA  = 'session_data';
  const API_BASE_KEY      = 'custom_backend_url';
  const DEFAULT_CLOUD_API_URL = 'https://agridash-durian-api.onrender.com';

  function getApiBaseUrl() {
    const custom = (ls.get(API_BASE_KEY) || '').trim().replace(/\/+$/, '');
    if (custom) return custom;
    if (typeof window !== 'undefined' && window.location && window.location.hostname.includes('github.io')) {
      return DEFAULT_CLOUD_API_URL;
    }
    return '';
  }
  function setApiBaseUrl(url) {
    if (!url) ls.remove(API_BASE_KEY);
    else ls.set(API_BASE_KEY, url.trim().replace(/\/+$/, ''));
  }
  function apiUrl(endpoint) {
    const base = getApiBaseUrl();
    if (!base) return endpoint;
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : ('/' + endpoint);
    return base + cleanEndpoint;
  }
  function getTimeoutMs(localMs = 4000, cloudMs = 25000) {
    return getApiBaseUrl() ? cloudMs : localMs;
  }

  // ----- Session token (ออกโดยเซิร์ฟเวอร์ตอนเข้าสู่ระบบ / เข้าเป็นผู้เยี่ยมชม) -----
  const TOKEN_KEY  = 'auth_token';
  const DEVICE_KEY = 'device_id';

  function getToken() { return ls.get(TOKEN_KEY) || ''; }
  function setToken(t) { if (t) ls.set(TOKEN_KEY, t); else ls.remove(TOKEN_KEY); }
  function getDeviceId() {
    let id = ls.get(DEVICE_KEY);
    if (!id) {
      const raw = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, '')
        : (Math.random().toString(36).slice(2) + Date.now().toString(36));
      id = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
      ls.set(DEVICE_KEY, id);
    }
    return id;
  }

  /** เรียก API พร้อมแนบ token — หากเซิร์ฟเวอร์ปฏิเสธ (หมดอายุ) จะส่งสัญญาณให้หน้าเว็บจัดการ */
  async function authFetch(endpoint, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(apiUrl(endpoint), { ...opts, headers });
    if (r.status === 401 && token && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('agri-auth-expired'));
    }
    return r;
  }

  /** ผู้เยี่ยมชมที่ยังไม่มี token → ขอ token แยกรายเครื่องจากเซิร์ฟเวอร์ */
  async function ensureToken() {
    if (getToken()) return getToken();
    const s = getSession();
    if (s.email && !s.isGuest && s.email !== 'guest') return '';
    try {
      const r = await fetch(apiUrl('/api/auth/guest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: getDeviceId() }),
        signal: AbortSignal.timeout(getTimeoutMs(5000, 25000))
      });
      const j = await parseResponseSafely(r);
      if (j && j.success && j.token) { setToken(j.token); return j.token; }
    } catch (e) { /* ออฟไลน์/โฮสต์สแตติก: ใช้ข้อมูลในเครื่องต่อไป */ }
    return '';
  }

  function saveSession(email, isGuest) {
    ls.set(SESSION_KEY_EMAIL, email);
    ls.set(SESSION_KEY_GUEST, isGuest ? '1' : '0');
  }
  function getSession() {
    return {
      email: ls.get(SESSION_KEY_EMAIL) || null,
      isGuest: ls.get(SESSION_KEY_GUEST) === '1'
    };
  }
  function clearSession() {
    ls.remove(SESSION_KEY_EMAIL);
    ls.remove(SESSION_KEY_GUEST);
    ls.remove(SESSION_KEY_DATA);
    ls.remove(TOKEN_KEY);
  }

  // ----- Offline data cache (Keyed per user email for safe multi-user switching) -----
  function saveDataCache(data, email = 'guest') {
    const userKey = SESSION_KEY_DATA + '_' + (email || 'guest').toLowerCase();
    ls.set(userKey, JSON.stringify(data));
    ls.set(SESSION_KEY_DATA, JSON.stringify(data));
  }
  function getDataCache(email = 'guest') {
    try {
      const userKey = SESSION_KEY_DATA + '_' + (email || 'guest').toLowerCase();
      const raw = ls.get(userKey) || ls.get(SESSION_KEY_DATA);
      if (!raw) return { fieldLogs: [], plantSurveys: [], accEntries: [] };
      const parsed = JSON.parse(raw);
      return {
        fieldLogs: Array.isArray(parsed.fieldLogs) ? parsed.fieldLogs : [],
        plantSurveys: Array.isArray(parsed.plantSurveys) ? parsed.plantSurveys : [],
        accEntries: Array.isArray(parsed.accEntries) ? parsed.accEntries : []
      };
    } catch(e) {
      return { fieldLogs: [], plantSurveys: [], accEntries: [] };
    }
  }

  // ----- Safe Response Parser (Guards against HTML 404 responses on static hosting like GitHub Pages) -----
  async function parseResponseSafely(r) {
    if (!r) throw new Error('ไม่ได้รับการตอบกลับจากเซิร์ฟเวอร์');
    const contentType = (r.headers && r.headers.get('content-type')) || '';
    const isHtml = contentType.includes('text/html');
    if (!r.ok || isHtml) {
      let msg = `HTTP ${r.status}`;
      try {
        const text = await r.text();
        if (text && text.trim().startsWith('{')) {
          const parsed = JSON.parse(text);
          if (parsed && parsed.message) msg = parsed.message;
        }
      } catch (e) {}
      const err = new Error(msg);
      err.status = r.status;
      err.isHtml = isHtml;
      throw err;
    }
    return await r.json();
  }

  // ----- Registered users in LocalStorage (for offline and static GitHub Pages hosting) -----
  function getRegisteredUsers() {
    try {
      const raw = ls.get('registered_users');
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }

  function saveRegisteredUser(user) {
    if (!user || !user.email) return;
    try {
      const cleanEmail = user.email.toLowerCase().trim();
      const list = getRegisteredUsers().filter(u => u.email.toLowerCase() !== cleanEmail);
      list.push({ ...user, email: cleanEmail });
      ls.set('registered_users', JSON.stringify(list));
    } catch(e) {}
  }

  // ----- Recent Accounts (for quick Switch User) -----
  function getRecentAccounts() {
    try {
      const raw = ls.get('recent_accounts');
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }

  function addRecentAccount(email, firstName = '', farmName = '') {
    if (!email || email === 'guest') return;
    try {
      const clean = email.toLowerCase().trim();
      let accounts = getRecentAccounts().filter(a => a.email.toLowerCase() !== clean);
      accounts.unshift({ email: clean, firstName: firstName || clean.split('@')[0], farmName: farmName || 'สวนทุเรียน', lastLogin: new Date().toISOString() });
      if (accounts.length > 5) accounts = accounts.slice(0, 5);
      ls.set('recent_accounts', JSON.stringify(accounts));
    } catch(e) {}
  }

  function removeRecentAccount(email) {
    try {
      const clean = (email || '').toLowerCase().trim();
      const accounts = getRecentAccounts().filter(a => a.email.toLowerCase() !== clean);
      ls.set('recent_accounts', JSON.stringify(accounts));
    } catch(e) {}
  }

  // ----- Agro Measurements cache -----
  function saveAgroMeasurementsCache(m) {
    ls.set('agro_measurements', JSON.stringify(m));
  }
  function getAgroMeasurementsCache() {
    try { return JSON.parse(ls.get('agro_measurements') || 'null'); }
    catch(e) { return null; }
  }

  // ----- Health check -----
  let _backendOnline = null;
  async function checkHealth() {
    try {
      const r = await fetch(apiUrl('/api/health'), { signal: AbortSignal.timeout(getTimeoutMs(3000, 20000)) });
      const json = await parseResponseSafely(r);
      _backendOnline = json && json.success === true;
      return json || { success: false, status: 'offline' };
    } catch(e) {
      _backendOnline = false;
      return { success: false, status: 'offline' };
    }
  }
  function isBackendOnline() { return _backendOnline; }

  // ----- Auth (with automatic offline / GitHub Pages static fallback) -----
  async function login(email, password) {
    const cleanEmail = (email || '').toLowerCase().trim();
    try {
      const r = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
        signal: AbortSignal.timeout(getTimeoutMs(5000, 25000))
      });
      const json = await parseResponseSafely(r);
      if (!json.success) throw new Error(json.message || 'เข้าสู่ระบบไม่สำเร็จ');
      setToken(json.token || '');
      addRecentAccount(json.email || cleanEmail, json.firstName, json.farmName);
      saveRegisteredUser({ email: cleanEmail, password, firstName: json.firstName, farmName: json.farmName });
      return json;
    } catch(e) {
      // หากเซิร์ฟเวอร์จริงตอบปฏิเสธ (เช่น 400 รหัสผ่านผิด/ไม่พบบัญชี) ให้แสดงข้อความจริง
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 404 && !e.isHtml) {
        throw e;
      }
      if (e.message && (e.message.includes('รหัสผ่านไม่ถูกต้อง') || e.message.includes('ไม่พบอีเมลนี้ในระบบ'))) {
        throw e;
      }

      console.warn('[Storage] Backend auth unavailable, using local store:', e.message);
      setToken(''); // ออฟไลน์: ห้ามใช้ token ของบัญชีก่อนหน้ากับบัญชีนี้

      // โหมดออฟไลน์ / โฮสต์แบบสแตติก (GitHub Pages)
      const localUsers = getRegisteredUsers();
      const user = localUsers.find(u => u.email.toLowerCase() === cleanEmail);

      if (user) {
        if (user.password && user.password !== password) {
          throw new Error('รหัสผ่านไม่ถูกต้อง');
        }
        addRecentAccount(user.email, user.firstName, user.farmName);
        return {
          success: true,
          email: user.email,
          firstName: user.firstName,
          farmName: user.farmName,
          message: 'เข้าสู่ระบบสำเร็จ (โหมดแคชในเครื่อง)'
        };
      }

      // หากยังไม่เคยบันทึกในเครื่อง สร้างบัญชีให้อัตโนมัติในโหมดสแตติก
      const recentAccounts = getRecentAccounts();
      const recent = recentAccounts.find(a => a.email.toLowerCase() === cleanEmail);
      const firstName = recent ? recent.firstName : cleanEmail.split('@')[0];
      const farmName = recent ? recent.farmName : 'สวนทุเรียน';

      saveRegisteredUser({ email: cleanEmail, password, firstName, farmName });
      addRecentAccount(cleanEmail, firstName, farmName);

      return {
        success: true,
        email: cleanEmail,
        firstName,
        farmName,
        message: 'เข้าสู่ระบบสำเร็จ (โหมดแคชในเครื่อง)'
      };
    }
  }

  async function register(payload) {
    const cleanEmail = (payload.email || '').toLowerCase().trim();
    try {
      const r = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, email: cleanEmail }),
        signal: AbortSignal.timeout(getTimeoutMs(5000, 25000))
      });
      const json = await parseResponseSafely(r);
      if (!json.success) throw new Error(json.message || 'สมัครสมาชิกไม่สำเร็จ');
      addRecentAccount(cleanEmail, payload.firstName, payload.farmName);
      saveRegisteredUser({ ...payload, email: cleanEmail });
      return json;
    } catch(e) {
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 404 && !e.isHtml) {
        throw e;
      }
      if (e.message && e.message.includes('อีเมลนี้ถูกสมัครใช้งานแล้ว')) {
        throw e;
      }
      console.warn('[Storage] Backend register unavailable, saving locally:', e.message);
      saveRegisteredUser({ ...payload, email: cleanEmail });
      addRecentAccount(cleanEmail, payload.firstName, payload.farmName);
      return {
        success: true,
        message: 'สมัครสมาชิกสำเร็จ (โหมดแคชในเครื่อง)!'
      };
    }
  }

  // ----- Fetch user data (with offline fallback — NEVER wipes existing cache) -----
  async function loadData(email) {
    const cleanEmail = (email || 'guest').toLowerCase().trim();
    try {
      const r = await authFetch('/api/data?userEmail=' + encodeURIComponent(cleanEmail), {
        signal: AbortSignal.timeout(getTimeoutMs(5000, 25000))
      });
      const json = await parseResponseSafely(r);
      if (json && json.success && json.data) {
        const data = {
          fieldLogs: json.data.fieldLogs || [],
          plantSurveys: json.data.plantSurveys || [],
          accEntries: json.data.accEntries || []
        };
        saveDataCache(data, cleanEmail);
        return { source: json.source, data };
      }
      throw new Error('Invalid server response');
    } catch(e) {
      console.warn('[Storage] Backend unavailable, using cache for ' + cleanEmail + ':', e.message);
      const cached = getDataCache(cleanEmail);
      return { source: 'cache', data: cached, offline: true };
    }
  }

  // ----- Save data (always write cache first, then try backend) -----
  async function saveData(email, fieldLogs, plantSurveys, accEntries) {
    const cleanEmail = (email || 'guest').toLowerCase().trim();
    // 1. Always update local cache immediately (per user key)
    saveDataCache({ fieldLogs, plantSurveys, accEntries }, cleanEmail);

    // 2. Try backend (non-blocking — don't throw on failure)
    try {
      const r = await authFetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: cleanEmail, fieldLogs, plantSurveys, accEntries }),
        signal: AbortSignal.timeout(getTimeoutMs(5000, 25000))
      });
      const json = await parseResponseSafely(r);
      return { success: true, synced: true, message: json.message };
    } catch(e) {
      console.warn('[Storage] Offline — saved to cache only:', e.message);
      return { success: true, synced: false, message: 'บันทึกในเครื่องแล้ว (Offline)' };
    }
  }

  // ----- Delete single item -----
  async function deleteItem(collection, id, email, currentData) {
    const cleanEmail = (email || 'guest').toLowerCase().trim();
    // 1. Remove from local cache
    const updated = { ...currentData };
    updated[collection] = (updated[collection] || []).filter(item => item.id !== id);
    saveDataCache(updated, cleanEmail);

    // 2. Try backend delete
    try {
      const r = await authFetch('/api/data/' + collection + '/' + id + '?userEmail=' + encodeURIComponent(cleanEmail), {
        method: 'DELETE',
        signal: AbortSignal.timeout(4000)
      });
      await parseResponseSafely(r);
    } catch(e) {
      console.warn('[Storage] Delete offline — only removed from cache:', e.message);
    }
    return updated;
  }

  return {
    ls,
    parseResponseSafely,
    apiUrl, getApiBaseUrl, setApiBaseUrl, getTimeoutMs,
    getToken, setToken, getDeviceId, authFetch, ensureToken,
    saveSession, getSession, clearSession,
    saveDataCache, getDataCache,
    getRegisteredUsers, saveRegisteredUser,
    getRecentAccounts, addRecentAccount, removeRecentAccount,
    saveAgroMeasurementsCache, getAgroMeasurementsCache,
    checkHealth, isBackendOnline,
    login, register,
    loadData, saveData, deleteItem
  };
})();
