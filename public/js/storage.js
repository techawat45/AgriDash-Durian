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
  }

  // ----- Offline data cache -----
  function saveDataCache(data) {
    ls.set(SESSION_KEY_DATA, JSON.stringify(data));
  }
  function getDataCache() {
    try {
      const raw = ls.get(SESSION_KEY_DATA);
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
      const r = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
      const json = await r.json();
      _backendOnline = json.success === true;
      return json;
    } catch(e) {
      _backendOnline = false;
      return { success: false, status: 'offline' };
    }
  }
  function isBackendOnline() { return _backendOnline; }

  // ----- Auth -----
  async function login(email, password) {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(8000)
    });
    const json = await r.json();
    if (!json.success) throw new Error(json.message || 'Login failed');
    return json;
  }

  async function register(payload) {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
    const json = await r.json();
    if (!json.success) throw new Error(json.message || 'Register failed');
    return json;
  }

  // ----- Fetch user data (with offline fallback — NEVER wipes existing cache) -----
  async function loadData(email) {
    try {
      const r = await fetch('/api/data?userEmail=' + encodeURIComponent(email), {
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) throw new Error('Server returned ' + r.status);
      const json = await r.json();
      if (json.success && json.data) {
        const data = {
          fieldLogs: json.data.fieldLogs || [],
          plantSurveys: json.data.plantSurveys || [],
          accEntries: json.data.accEntries || []
        };
        saveDataCache(data);
        return { source: json.source, data };
      }
      throw new Error('Invalid server response');
    } catch(e) {
      console.warn('[Storage] Backend unavailable, using cache:', e.message);
      const cached = getDataCache();
      return { source: 'cache', data: cached, offline: true };
    }
  }

  // ----- Save data (always write cache first, then try backend) -----
  async function saveData(email, fieldLogs, plantSurveys, accEntries) {
    // 1. Always update local cache immediately
    saveDataCache({ fieldLogs, plantSurveys, accEntries });

    // 2. Try backend (non-blocking — don't throw on failure)
    try {
      const r = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: email, fieldLogs, plantSurveys, accEntries }),
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) throw new Error('Server returned ' + r.status);
      const json = await r.json();
      return { success: true, synced: true, message: json.message };
    } catch(e) {
      console.warn('[Storage] Offline — saved to cache only:', e.message);
      return { success: true, synced: false, message: 'บันทึกในเครื่องแล้ว (Offline)' };
    }
  }

  // ----- Delete single item -----
  async function deleteItem(collection, id, email, currentData) {
    // 1. Remove from local cache
    const updated = { ...currentData };
    updated[collection] = (updated[collection] || []).filter(item => item.id !== id);
    saveDataCache(updated);

    // 2. Try backend delete
    try {
      await fetch('/api/data/' + collection + '/' + id + '?userEmail=' + encodeURIComponent(email), {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000)
      });
    } catch(e) {
      console.warn('[Storage] Delete offline — only removed from cache:', e.message);
    }
    return updated;
  }

  return {
    ls,
    saveSession, getSession, clearSession,
    saveDataCache, getDataCache,
    saveAgroMeasurementsCache, getAgroMeasurementsCache,
    checkHealth, isBackendOnline,
    login, register,
    loadData, saveData, deleteItem
  };
})();
