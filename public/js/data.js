/* ============================================================
   AgriDash Durian Pro - ชั้นข้อมูลกลางและคลังออฟไลน์ (data.js)
   เชื่อมต่อ MongoDB Atlas + IndexedDB (สำหรับทะเบียนต้นไม้จำนวนมาก) + คิวส่งซ้ำอัตโนมัติ
   ============================================================ */
const AGRI_DATA = (() => {
  const S = AGRI_STORAGE;
  let scope = 'guest';
  let flushing = false;
  let flushTimer = null;
  const pendingListeners = [];
  const stateListeners = [];

  const COLLECTIONS = [
    'orchards', 'plots', 'trees',
    'inventory', 'stock-movements', 'sprays', 'irrigations',
    'workers', 'work-logs', 'advances', 'payrolls', 'harvests'
  ];

  const KEY_TO_STATE = {
    'orchards': 'orchards',
    'plots': 'plots',
    'trees': 'trees',
    'inventory': 'inventory',
    'stock-movements': 'stockMovements',
    'sprays': 'sprays',
    'irrigations': 'irrigations',
    'workers': 'workers',
    'work-logs': 'workLogs',
    'advances': 'advances',
    'payrolls': 'payrolls',
    'harvests': 'harvests'
  };

  const state = {
    orchards: [],
    plots: [],
    trees: [],
    inventory: [],
    stockMovements: [],
    sprays: [],
    irrigations: [],
    workers: [],
    workLogs: [],
    advances: [],
    payrolls: [],
    harvests: []
  };

  // ====== IndexedDB สำหรับคอลเลกชันขนาดใหญ่ (เช่น ทะเบียนต้นไม้หลักพันต้น) ======
  const IDB_NAME = 'agridash_erp_idb_v1';
  const IDB_STORE = 'collections';
  let idbPromise = null;

  function openIdb() {
    if (idbPromise) return idbPromise;
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    idbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return idbPromise;
  }

  async function idbGet(key) {
    const db = await openIdb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function idbSet(key, value) {
    const db = await openIdb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  const cacheKey = (name) => `data_${scope}_${name}`;
  const outboxKey = () => `outbox_${scope}`;

  function setScope(email) {
    scope = String(email || 'guest').toLowerCase();
    Object.keys(state).forEach((k) => { state[k] = []; });
    notifyPending();
  }
  const getScope = () => scope;

  function readJson(key, fallback) {
    try { const raw = S.ls.get(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }

  async function readCache(name) {
    if (name === 'trees') {
      const fromIdb = await idbGet(cacheKey(name));
      if (Array.isArray(fromIdb)) return fromIdb;
    }
    return readJson(cacheKey(name), []);
  }

  async function writeCache(name, arr) {
    const sk = KEY_TO_STATE[name];
    if (sk) state[sk] = Array.isArray(arr) ? arr : [];
    if (name === 'trees') {
      const ok = await idbSet(cacheKey(name), arr);
      if (ok) return;
    }
    try { S.ls.set(cacheKey(name), JSON.stringify(arr)); } catch (e) {}
  }

  const readOutbox = () => readJson(outboxKey(), []);
  const writeOutbox = (q) => { S.ls.set(outboxKey(), JSON.stringify(q)); notifyPending(); };

  function onPendingChange(fn) { pendingListeners.push(fn); }
  function notifyPending() {
    const n = readOutbox().length;
    pendingListeners.forEach((fn) => { try { fn(n); } catch (e) {} });
  }
  const pendingCount = () => readOutbox().length;

  function onChange(fn) { stateListeners.push(fn); }
  function emitChange(reason = 'update') {
    stateListeners.forEach((fn) => { try { fn(state, reason); } catch (e) { console.error(e); } });
  }

  async function request(method, path, body) {
    const r = await S.authFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(S.getTimeoutMs(8000, 25000))
    });
    return S.parseResponseSafely(r);
  }

  function isPermanent(e) {
    const s = e && e.status;
    return Boolean(s) && s >= 400 && s < 500 && s !== 401 && s !== 408 && s !== 429;
  }

  function enqueue(op) {
    let q = readOutbox();
    if (op.kind === 'crud' && op.method === 'POST') {
      q = q.filter((x) => !(x.kind === 'crud' && x.method === 'POST' && x.name === op.name && x.id === op.id));
    } else if (op.kind === 'crud' && op.method === 'DELETE') {
      q = q.filter((x) => !(x.kind === 'crud' && x.name === op.name && x.id === op.id));
    }
    q.push(op);
    writeOutbox(q);
  }

  function applyOutbox(name, arr) {
    let out = [...(arr || [])];
    readOutbox()
      .filter((x) => x.kind === 'crud' && x.name === name)
      .forEach((op) => {
        if (op.method === 'POST') {
          const i = out.findIndex((d) => d.id === op.id);
          if (i >= 0) out[i] = { ...out[i], ...op.body }; else out.push(op.body);
        } else if (op.method === 'DELETE') {
          out = out.filter((d) => d.id !== op.id);
        } else if (op.method === 'BULK') {
          (op.items || []).forEach((item) => {
            const i = out.findIndex((d) => d.id === item.id);
            if (i >= 0) out[i] = { ...out[i], ...item }; else out.push(item);
          });
        } else if (op.method === 'BULK_DELETE') {
          const idSet = new Set(op.ids || []);
          out = out.filter((d) => !idSet.has(d.id));
        }
      });
    return out;
  }

  // ====== โหลดข้อมูลทั้งหมดของบัญชีในคำขอเดียว ======
  async function loadWorkspace() {
    // 1. โหลดจากแคชก่อนเพื่อให้หน้าจอพร้อมใช้งานทันที
    for (const col of COLLECTIONS) {
      const cached = await readCache(col);
      const sk = KEY_TO_STATE[col];
      if (sk) state[sk] = applyOutbox(col, cached);
    }

    try {
      const j = await request('GET', '/api/workspace');
      const d = (j && j.data) || {};
      const pairs = [
        ['orchards', d.orchards],
        ['plots', d.plots],
        ['trees', d.trees],
        ['inventory', d.inventory],
        ['stock-movements', d.stockMovements],
        ['sprays', d.sprays],
        ['irrigations', d.irrigations],
        ['workers', d.workers],
        ['work-logs', d.workLogs],
        ['advances', d.advances],
        ['payrolls', d.payrolls],
        ['harvests', d.harvests]
      ];
      for (const [col, arr] of pairs) {
        if (Array.isArray(arr)) {
          const merged = applyOutbox(col, arr);
          await writeCache(col, merged);
        }
      }
      scheduleFlush();
      emitChange('workspace');
      return { offline: false, legacy: { fieldLogs: d.fieldLogs, plantSurveys: d.plantSurveys, accEntries: d.accEntries } };
    } catch (e) {
      emitChange('workspace-offline');
      return { offline: true, error: e, legacy: null };
    }
  }

  async function list(name) {
    try {
      const j = await request('GET', '/api/' + name);
      const merged = applyOutbox(name, j.data || []);
      await writeCache(name, merged);
      scheduleFlush();
      return { data: merged, offline: false };
    } catch (e) {
      const cached = applyOutbox(name, await readCache(name));
      const sk = KEY_TO_STATE[name];
      if (sk) state[sk] = cached;
      return { data: cached, offline: true, error: e };
    }
  }

  async function save(name, doc) {
    const before = await readCache(name);
    const next = [...before];
    const i = next.findIndex((d) => d.id === doc.id);
    if (i >= 0) next[i] = { ...next[i], ...doc }; else next.push(doc);
    await writeCache(name, next);
    try {
      const j = await request('POST', '/api/' + name, doc);
      const saved = j.data || doc;
      const idx = next.findIndex((d) => d.id === doc.id);
      if (idx >= 0) next[idx] = { ...next[idx], ...saved };
      await writeCache(name, next);
      scheduleFlush();
      emitChange(name);
      return { ok: true, queued: false, data: saved };
    } catch (e) {
      if (isPermanent(e)) { await writeCache(name, before); throw e; }
      enqueue({ kind: 'crud', method: 'POST', name, id: doc.id, body: doc });
      emitChange(name);
      return { ok: true, queued: true, data: doc };
    }
  }

  async function saveBulk(name, items) {
    if (!Array.isArray(items) || !items.length) return { ok: true, saved: 0, queued: false };
    const before = await readCache(name);
    const map = new Map(before.map((d) => [d.id, d]));
    items.forEach((it) => map.set(it.id, { ...(map.get(it.id) || {}), ...it }));
    const next = [...map.values()];
    await writeCache(name, next);
    try {
      await request('POST', `/api/${name}/bulk`, { items });
      scheduleFlush();
      emitChange(name);
      return { ok: true, saved: items.length, queued: false };
    } catch (e) {
      if (isPermanent(e)) { await writeCache(name, before); throw e; }
      enqueue({ kind: 'crud', method: 'BULK', name, items });
      emitChange(name);
      return { ok: true, saved: items.length, queued: true };
    }
  }

  async function remove(name, id, opts = {}) {
    const before = await readCache(name);
    await writeCache(name, before.filter((d) => d.id !== id));
    const path = '/api/' + name + '/' + encodeURIComponent(id) + (opts.hard ? '?hard=1' : '');
    try {
      await request('DELETE', path);
      scheduleFlush();
      emitChange(name);
      return { ok: true, queued: false };
    } catch (e) {
      if (e && e.status === 404) { emitChange(name); return { ok: true, queued: false }; }
      if (isPermanent(e)) { await writeCache(name, before); throw e; }
      enqueue({ kind: 'crud', method: 'DELETE', name, id, path });
      emitChange(name);
      return { ok: true, queued: true };
    }
  }

  async function removeBulk(name, ids, opts = {}) {
    if (!Array.isArray(ids) || !ids.length) return { ok: true, count: 0, queued: false };
    const before = await readCache(name);
    const idSet = new Set(ids);
    await writeCache(name, before.filter((d) => !idSet.has(d.id)));
    try {
      await request('POST', `/api/${name}/bulk-delete`, { ids, hard: Boolean(opts.hard) });
      scheduleFlush();
      emitChange(name);
      return { ok: true, count: ids.length, queued: false };
    } catch (e) {
      if (isPermanent(e)) { await writeCache(name, before); throw e; }
      enqueue({ kind: 'crud', method: 'BULK_DELETE', name, ids, hard: Boolean(opts.hard) });
      emitChange(name);
      return { ok: true, count: ids.length, queued: true };
    }
  }

  // ====== ธุรกรรมเชื่อมโยงข้ามโมดูล (รองรับทั้งออนไลน์และออฟไลน์ในสวน) ======
  function pushLedgerLocal(entry) {
    if (!entry || typeof accEntries === 'undefined') return;
    const idx = accEntries.findIndex((x) => x.id === entry.id);
    if (idx >= 0) accEntries[idx] = entry; else accEntries.unshift(entry);
    S.saveDataCache({ fieldLogs, plantSurveys, accEntries }, scope);
    if (typeof renderAccEntries === 'function') renderAccEntries();
  }

  function removeLedgerByRefLocal(refType, refId) {
    if (typeof accEntries === 'undefined') return;
    for (let i = accEntries.length - 1; i >= 0; i--) {
      if (accEntries[i].refType === refType && accEntries[i].refId === refId) accEntries.splice(i, 1);
    }
    if (typeof fieldLogs !== 'undefined') {
      for (let i = fieldLogs.length - 1; i >= 0; i--) {
        if (fieldLogs[i].refType === refType && fieldLogs[i].refId === refId) fieldLogs.splice(i, 1);
      }
    }
    S.saveDataCache({ fieldLogs, plantSurveys, accEntries }, scope);
    if (typeof renderAllTables === 'function') renderAllTables();
  }

  async function purchaseInventory(payload) {
    try {
      const res = await request('POST', '/api/inventory/purchase', payload);
      if (res.item) {
        const inv = [...state.inventory];
        const i = inv.findIndex((x) => x.id === res.item.id);
        if (i >= 0) inv[i] = res.item; else inv.push(res.item);
        await writeCache('inventory', inv);
      }
      if (res.movement) await writeCache('stock-movements', [res.movement, ...state.stockMovements]);
      if (res.ledgerEntry) pushLedgerLocal(res.ledgerEntry);
      emitChange('inventory');
      return { ...res, queued: false };
    } catch (e) {
      if (isPermanent(e)) throw e;
      // ออฟไลน์ในสวน: คำนวณต้นทุนเฉลี่ยและลงสมุดบัญชีในเครื่องทันที แล้วเข้าคิวส่งซ้ำ
      const C = AGRI_CALC;
      const movId = payload.id || ('pur-' + Date.now().toString(36));
      const qty = C.num(payload.qty), unitPrice = C.num(payload.unitPrice);
      const inv = [...state.inventory];
      let item = payload.itemId ? inv.find((x) => x.id === payload.itemId) : null;
      if (!item) {
        const np = payload.newItem || {};
        item = {
          id: np.id || ('inv-' + Date.now().toString(36)),
          name: np.name || payload.itemName,
          category: np.category || 'ปุ๋ยทางดิน',
          formulation: np.formulation || 'ทั่วไป',
          unit: np.unit || 'กระสอบ',
          doseUnit: np.doseUnit || 'กรัม',
          packSize: C.num(np.packSize),
          ratePer200LDefault: C.num(np.ratePer200LDefault),
          stockQty: 0,
          avgCost: unitPrice,
          phiDays: Math.max(0, Math.round(C.num(np.phiDays))),
          reorderLevel: Math.max(0, C.num(np.reorderLevel ?? 1)),
          activeIngredient: np.activeIngredient || '',
          active: true
        };
        inv.push(item);
      }
      item.avgCost = C.calcWeightedAvgCost(item.stockQty, item.avgCost, qty, unitPrice);
      item.stockQty = C.round4(C.num(item.stockQty) + qty);
      await writeCache('inventory', inv);

      const totalCost = C.round2(qty * unitPrice);
      const mov = {
        id: movId, date: payload.date, itemId: item.id, itemName: item.name,
        type: 'in', qty, unit: item.unit, unitPrice, totalCost,
        vendor: payload.vendor || '', orchardId: payload.orchardId || '', plotId: payload.plotId || '',
        refType: 'purchase', refId: movId
      };
      await writeCache('stock-movements', [mov, ...state.stockMovements]);

      let ledgerEntry = null;
      if (payload.postToLedger !== false && totalCost > 0) {
        const isFert = String(item.category || '').includes('ปุ๋ย') || String(item.category || '').includes('ธาตุ');
        ledgerEntry = {
          id: `acc-pur-${movId}`,
          date: payload.date,
          type: 'expense',
          plot: payload.plotLabel || 'กองกลาง / ใช้ร่วมกัน',
          orchardId: payload.orchardId || '',
          plotId: payload.plotId || '',
          category: isFert ? 'ปุ๋ยและธาตุอาหาร' : 'ยาและฮอร์โมน',
          detail: `ซื้อเข้าคลัง: ${item.name} (${qty} ${item.unit} @฿${unitPrice.toLocaleString('th-TH')})`,
          amount: totalCost,
          refType: 'purchase',
          refId: movId
        };
        pushLedgerLocal(ledgerEntry);
      }
      enqueue({ kind: 'tx', path: '/api/inventory/purchase', method: 'POST', body: { ...payload, id: movId, itemId: item.id } });
      emitChange('inventory');
      return { success: true, item, movement: mov, ledgerEntry, queued: true };
    }
  }

  async function commitSpray(payload) {
    try {
      const res = await request('POST', '/api/spray/commit', payload);
      if (Array.isArray(res.updatedInventory)) {
        const map = new Map(state.inventory.map((x) => [x.id, x]));
        res.updatedInventory.forEach((u) => map.set(u.id, u));
        await writeCache('inventory', [...map.values()]);
      }
      if (Array.isArray(res.movements) && res.movements.length) {
        await writeCache('stock-movements', [...res.movements, ...state.stockMovements]);
      }
      if (res.spray) await writeCache('sprays', [res.spray, ...state.sprays]);
      if (Array.isArray(res.ledgerEntries)) res.ledgerEntries.forEach(pushLedgerLocal);
      if (res.fieldLog && typeof fieldLogs !== 'undefined') {
        fieldLogs.unshift(res.fieldLog);
        if (typeof renderFieldLogs === 'function') renderFieldLogs();
      }
      emitChange('sprays');
      return { ...res, queued: false };
    } catch (e) {
      if (isPermanent(e)) throw e;
      const C = AGRI_CALC;
      const sprayId = payload.id || ('spr-' + Date.now().toString(36));
      const inv = [...state.inventory];
      const invMap = new Map(inv.map((d) => [d.id, d]));
      const plan = C.calculateSprayPlan({
        date: payload.date,
        tankSize: payload.tankSize,
        tanks: payload.tanks,
        ingredients: (payload.ingredients || []).map((ing) => ({
          ...ing,
          inventoryItem: ing.itemId ? invMap.get(ing.itemId) : undefined
        }))
      });
      plan.items.forEach((line) => {
        if (line.itemId && invMap.has(line.itemId)) {
          const it = invMap.get(line.itemId);
          it.stockQty = Math.max(0, C.round4(C.num(it.stockQty) - line.stockDeducted));
        }
      });
      await writeCache('inventory', inv);

      const spray = {
        id: sprayId,
        date: payload.date,
        orchardId: payload.orchardId || '',
        plotIds: payload.plotIds || [],
        plotNames: payload.plotNames || 'กองกลาง / ใช้ร่วมกัน',
        stage: payload.stage || '',
        tankSize: plan.tankSize,
        tanks: plan.tanks,
        totalWaterLiters: plan.totalWaterLiters,
        ingredients: plan.items,
        totalCost: plan.totalCost,
        costPerTank: plan.costPerTank,
        maxPhiDays: plan.maxPhiDays,
        phiUntil: plan.phiUntil,
        note: payload.note || ''
      };
      await writeCache('sprays', [spray, ...state.sprays]);

      if (payload.postToLedger !== false && plan.totalCost > 0) {
        pushLedgerLocal({
          id: `acc-spr-${sprayId}`,
          date: payload.date,
          type: 'expense',
          plot: spray.plotNames,
          orchardId: spray.orchardId,
          plotId: (spray.plotIds && spray.plotIds.length === 1) ? spray.plotIds[0] : '',
          category: 'ยาและฮอร์โมน',
          detail: `พ่นสาร (${plan.tankSize} ล. × ${plan.tanks} ถัง)`,
          amount: plan.totalCost,
          refType: 'spray',
          refId: sprayId
        });
      }
      enqueue({ kind: 'tx', path: '/api/spray/commit', method: 'POST', body: { ...payload, id: sprayId } });
      emitChange('sprays');
      return { success: true, spray, queued: true };
    }
  }

  async function deleteSpray(id) {
    const target = state.sprays.find((s) => s.id === id);
    await writeCache('sprays', state.sprays.filter((s) => s.id !== id));
    removeLedgerByRefLocal('spray', id);
    try {
      await request('DELETE', `/api/spray/${encodeURIComponent(id)}`);
      await list('inventory');
      emitChange('sprays');
      return { ok: true, queued: false };
    } catch (e) {
      if (target && Array.isArray(target.ingredients)) {
        const inv = [...state.inventory];
        target.ingredients.forEach((ing) => {
          const doc = inv.find((x) => x.id === ing.itemId);
          if (doc) doc.stockQty = AGRI_CALC.round4(AGRI_CALC.num(doc.stockQty) + AGRI_CALC.num(ing.stockDeducted));
        });
        await writeCache('inventory', inv);
      }
      enqueue({ kind: 'tx', path: `/api/spray/${encodeURIComponent(id)}`, method: 'DELETE' });
      emitChange('sprays');
      return { ok: true, queued: true };
    }
  }

  async function payPayroll(payload) {
    try {
      const res = await request('POST', '/api/payroll/pay', payload);
      await Promise.all([list('work-logs'), list('advances'), list('payrolls')]);
      if (res.ledgerEntry) pushLedgerLocal(res.ledgerEntry);
      emitChange('payrolls');
      return { ...res, queued: false };
    } catch (e) {
      if (isPermanent(e)) throw e;
      const C = AGRI_CALC;
      const payId = payload.id || ('pay-' + Date.now().toString(36));
      const worker = state.workers.find((w) => w.id === payload.workerId) || { name: 'คนงาน' };
      const logs = state.workLogs.filter((l) => !l.paid && l.workerId === payload.workerId &&
        (!payload.periodStart || l.date >= payload.periodStart) &&
        (!payload.periodEnd || l.date <= payload.periodEnd));
      const advs = state.advances.filter((a) => !a.settled && a.workerId === payload.workerId);
      const calc = C.calcWorkerPayroll({
        worker, workLogs: logs, advances: advs,
        monthlySalaryOverride: payload.monthlySalaryOverride,
        bonusOrAdjust: payload.bonusOrAdjust,
        deductAdvance: payload.deductAdvance !== false
      });
      const logIdSet = new Set(logs.map((l) => l.id));
      await writeCache('work-logs', state.workLogs.map((l) => logIdSet.has(l.id) ? { ...l, paid: true, payrollId: payId } : l));
      let rem = calc.advanceDeducted;
      await writeCache('advances', state.advances.map((a) => {
        if (!a.settled && a.workerId === payload.workerId && rem > 0) {
          const take = Math.min(rem, C.num(a.amount));
          rem = C.round2(rem - take);
          if (take >= C.num(a.amount) - 1e-6) return { ...a, settled: true, payrollId: payId };
        }
        return a;
      }));
      const payroll = {
        id: payId, paidDate: payload.paidDate, periodStart: payload.periodStart || '', periodEnd: payload.periodEnd || '',
        workerId: worker.id, workerName: worker.name, workerType: worker.workerType,
        workDays: calc.workDays, otHours: calc.otHours, grossWage: calc.grossWage,
        advanceDeducted: calc.advanceDeducted, netPaid: calc.netPaid, note: payload.note || ''
      };
      await writeCache('payrolls', [payroll, ...state.payrolls]);
      if (calc.grossWage > 0) {
        pushLedgerLocal({
          id: `acc-pay-${payId}`, date: payload.paidDate, type: 'expense',
          plot: payload.plotLabel || 'กองกลาง / ใช้ร่วมกัน',
          orchardId: payload.orchardId || '', plotId: payload.plotId || '',
          category: 'ค่าแรงคนงาน',
          detail: `จ่ายค่าแรง: ${worker.name} | จ่ายสุทธิ ฿${calc.netPaid.toLocaleString('th-TH')}`,
          amount: calc.grossWage, refType: 'payroll', refId: payId
        });
      }
      enqueue({ kind: 'tx', path: '/api/payroll/pay', method: 'POST', body: { ...payload, id: payId } });
      emitChange('payrolls');
      return { success: true, payroll, queued: true };
    }
  }

  async function deletePayroll(id) {
    await writeCache('payrolls', state.payrolls.filter((p) => p.id !== id));
    await writeCache('work-logs', state.workLogs.map((l) => l.payrollId === id ? { ...l, paid: false, payrollId: '' } : l));
    await writeCache('advances', state.advances.map((a) => a.payrollId === id ? { ...a, settled: false, payrollId: '' } : a));
    removeLedgerByRefLocal('payroll', id);
    try {
      await request('DELETE', `/api/payroll/${encodeURIComponent(id)}`);
      emitChange('payrolls');
      return { ok: true, queued: false };
    } catch (e) {
      enqueue({ kind: 'tx', path: `/api/payroll/${encodeURIComponent(id)}`, method: 'DELETE' });
      emitChange('payrolls');
      return { ok: true, queued: true };
    }
  }

  async function commitHarvest(payload) {
    try {
      const res = await request('POST', '/api/harvest/commit', payload);
      if (res.harvest) {
        const next = [res.harvest, ...state.harvests.filter((h) => h.id !== res.harvest.id)];
        await writeCache('harvests', next);
      }
      if (res.ledgerEntry) pushLedgerLocal(res.ledgerEntry);
      if (res.costLedgerEntry) pushLedgerLocal(res.costLedgerEntry);
      emitChange('harvests');
      return { ...res, queued: false };
    } catch (e) {
      if (isPermanent(e)) throw e;
      const C = AGRI_CALC;
      const hid = payload.id || ('harv-' + Date.now().toString(36));
      const sum = C.calcHarvestSummary(payload.grades || [], payload.harvestCost || 0);
      const harvest = {
        id: hid, date: payload.date, roundNo: payload.roundNo || 1,
        orchardId: payload.orchardId || '', plotId: payload.plotId || '', plotName: payload.plotName || '',
        variety: payload.variety || 'หมอนทอง', buyer: payload.buyer || '',
        grades: sum.grades, totalFruits: sum.totalFruits, totalKg: sum.totalKg,
        grossRevenue: sum.grossRevenue, harvestCost: sum.harvestCost,
        netRevenue: sum.netRevenue, avgPricePerKg: sum.avgPricePerKg, note: payload.note || ''
      };
      await writeCache('harvests', [harvest, ...state.harvests.filter((h) => h.id !== hid)]);
      if (payload.postToLedger !== false && sum.grossRevenue > 0) {
        pushLedgerLocal({
          id: `acc-harv-${hid}`, date: payload.date, type: 'income',
          plot: payload.plotName || 'กองกลาง / ใช้ร่วมกัน',
          orchardId: payload.orchardId || '', plotId: payload.plotId || '',
          category: 'รายได้ขายผลผลิต',
          detail: `ขายทุเรียน ${harvest.variety} รวม ${sum.totalKg.toLocaleString('th-TH')} กก.`,
          amount: sum.grossRevenue, refType: 'harvest', refId: hid
        });
      }
      enqueue({ kind: 'tx', path: '/api/harvest/commit', method: 'POST', body: { ...payload, id: hid } });
      emitChange('harvests');
      return { success: true, harvest, queued: true };
    }
  }

  async function deleteHarvest(id) {
    await writeCache('harvests', state.harvests.filter((h) => h.id !== id));
    removeLedgerByRefLocal('harvest', id);
    try {
      await request('DELETE', `/api/harvest/${encodeURIComponent(id)}`);
      emitChange('harvests');
      return { ok: true, queued: false };
    } catch (e) {
      enqueue({ kind: 'tx', path: `/api/harvest/${encodeURIComponent(id)}`, method: 'DELETE' });
      emitChange('harvests');
      return { ok: true, queued: true };
    }
  }

  async function flush() {
    if (flushing) return { sent: 0, left: pendingCount() };
    flushing = true;
    let sent = 0;
    try {
      let q = readOutbox();
      while (q.length) {
        const op = q[0];
        try {
          if (op.kind === 'tx') {
            await request(op.method, op.path, op.body);
          } else if (op.method === 'POST') {
            await request('POST', '/api/' + op.name, op.body);
          } else if (op.method === 'BULK') {
            await request('POST', `/api/${op.name}/bulk`, { items: op.items });
          } else if (op.method === 'BULK_DELETE') {
            await request('POST', `/api/${op.name}/bulk-delete`, { ids: op.ids, hard: op.hard });
          } else {
            await request('DELETE', op.path);
          }
          sent++;
        } catch (e) {
          if (e && e.status === 404 && op.method === 'DELETE') sent++;
          else if (!isPermanent(e)) break;
        }
        q.shift();
        writeOutbox(q);
      }
    } finally { flushing = false; }
    if (sent > 0) emitChange('flushed');
    return { sent, left: pendingCount() };
  }

  function scheduleFlush() {
    if (!pendingCount() || flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 1500);
  }

  if (typeof window !== 'undefined') window.addEventListener('online', () => flush());

  return {
    state,
    setScope, getScope,
    loadWorkspace,
    list, save, saveBulk, remove, removeBulk,
    purchaseInventory, commitSpray, deleteSpray,
    payPayroll, deletePayroll,
    commitHarvest, deleteHarvest,
    request,
    flush, pendingCount, onPendingChange,
    onChange, emitChange
  };
})();
