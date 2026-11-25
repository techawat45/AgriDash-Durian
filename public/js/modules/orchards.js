/* ============================================================
   AgriDash - โมดูลสวนและแปลง (orchards.js)
   ผู้ใช้สร้างสวน ตั้งชื่อสวน และแปลงย่อยเองได้ไม่จำกัด
   ============================================================ */
const AGRI_ORCHARDS = (() => {
  const COMMON_LABEL = 'กองกลาง / ใช้ร่วมกัน';
  let orchards = [];
  let plots = [];
  let offline = false;
  const listeners = [];

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const byCreated = (a, b) => String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id));

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function onChange(fn) { listeners.push(fn); }
  function notify() { listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

  function syncFromState() {
    if (typeof AGRI_DATA !== 'undefined' && AGRI_DATA.state) {
      orchards = [...(AGRI_DATA.state.orchards || [])].sort(byCreated);
      plots = [...(AGRI_DATA.state.plots || [])].sort(byCreated);
      notify();
    }
  }

  async function load() {
    const [o, p] = await Promise.all([AGRI_DATA.list('orchards'), AGRI_DATA.list('plots')]);
    orchards = [...o.data].sort(byCreated);
    plots = [...p.data].sort(byCreated);
    offline = Boolean(o.offline || p.offline);
    notify();
    return { offline };
  }

  const getOrchard = (id) => orchards.find((o) => o.id === id) || null;
  const getPlot = (id) => plots.find((p) => p.id === id) || null;
  const allOrchards = () => orchards;
  const allPlots = (activeOnly = false) => activeOnly ? plots.filter((p) => p.active !== false) : plots;
  const activeOrchards = () => orchards.filter((o) => o.active !== false);
  const plotsOf = (orchardId, activeOnly = false) =>
    plots.filter((p) => p.orchardId === orchardId && (!activeOnly || p.active !== false));
  const hasOrchards = () => orchards.length > 0;
  const isOffline = () => offline;

  function plotLabel(plot) {
    const orchard = plot && getOrchard(plot.orchardId);
    return orchard ? `${orchard.name} › ${plot.name}` : (plot ? plot.name : '');
  }
  const orchardLabel = (orchard) => `${orchard.name} (ทั้งสวน)`;

  /** ค่าที่เลือกจาก <select> → { kind, orchardId, plotId, label } */
  function resolve(value) {
    const v = String(value || '');
    if (v === 'all') return { kind: 'all', orchardId: '', plotId: '', label: '' };
    if (v === 'common' || v === '') return { kind: 'common', orchardId: '', plotId: '', label: COMMON_LABEL };
    if (v.startsWith('p:')) {
      const plot = getPlot(v.slice(2));
      if (plot) return { kind: 'plot', orchardId: plot.orchardId, plotId: plot.id, label: plotLabel(plot) };
    }
    if (v.startsWith('o:')) {
      const orchard = getOrchard(v.slice(2));
      if (orchard) return { kind: 'orchard', orchardId: orchard.id, plotId: '', label: orchardLabel(orchard) };
    }
    const legacy = v.startsWith('legacy:') ? v.slice(7) : v;
    return { kind: 'legacy', orchardId: '', plotId: '', label: legacy };
  }

  /** ป้ายชื่อแปลงของรายการ — ใช้ชื่อปัจจุบัน หากแปลงถูกลบจะใช้ชื่อที่บันทึกไว้ตอนทำรายการ */
  function entryLabel(entry) {
    if (!entry) return '';
    if (entry.plotId) {
      const plot = getPlot(entry.plotId);
      if (plot) return plotLabel(plot);
    } else if (entry.orchardId) {
      const orchard = getOrchard(entry.orchardId);
      if (orchard) return orchardLabel(orchard);
    }
    return entry.plot || '';
  }

  /** รายการนี้ตรงกับตัวกรองหรือไม่ (all | common | o:<id> | p:<id> | legacy:<ป้ายชื่อ>) */
  function matchesFilter(entry, filterValue, fallbackLabel) {
    const f = String(filterValue || 'all');
    if (f === 'all') return true;
    if (f.startsWith('p:')) return entry.plotId === f.slice(2);
    if (f.startsWith('o:')) return entry.orchardId === f.slice(2);
    const label = entry.plot || fallbackLabel || '';
    if (f === 'common') return !entry.orchardId && !entry.plotId && label === COMMON_LABEL;
    if (f.startsWith('legacy:')) return !entry.orchardId && !entry.plotId && label === f.slice(7);
    return true;
  }

  /** สร้าง <option> จัดกลุ่มตามสวน — ไม่มีชื่อสวน/แปลงตายตัว ดึงจากฐานข้อมูลของผู้ใช้ทั้งหมด */
  function optionsHTML(opts = {}) {
    const { includeAll = false, allLabel = 'ทุกสวนและทุกแปลง', includeCommon = true,
      allowOrchardLevel = true, legacyLabels = [], includeSkip = false, skipLabel = '— ยังไม่จับคู่ —' } = opts;
    const out = [];
    if (includeSkip) out.push(`<option value="skip">${esc(skipLabel)}</option>`);
    if (includeAll) out.push(`<option value="all">${esc(allLabel)}</option>`);
    if (includeCommon) out.push(`<option value="common">🏛️ ${esc(COMMON_LABEL)}</option>`);
    activeOrchards().forEach((o) => {
      let inner = '';
      if (allowOrchardLevel) inner += `<option value="o:${esc(o.id)}">ทั้งสวน ${esc(o.name)}</option>`;
      plotsOf(o.id, true).forEach((p) => { inner += `<option value="p:${esc(p.id)}">${esc(p.name)}</option>`; });
      if (inner) out.push(`<optgroup label="🌳 ${esc(o.name)}">${inner}</optgroup>`);
    });
    if (legacyLabels.length) {
      out.push(`<optgroup label="รายการเดิม (ยังไม่จับคู่กับแปลง)">${
        legacyLabels.map((l) => `<option value="legacy:${esc(l)}">${esc(l)}</option>`).join('')}</optgroup>`);
    }
    if (!activeOrchards().length && !includeAll && !includeSkip) {
      out.push('<option value="" disabled>— ยังไม่ได้สร้างสวน: ไปที่เมนู "สวนและแปลง" —</option>');
    }
    return out.join('');
  }

  // ----- บันทึกข้อมูล -----
  async function saveOrchard(doc) {
    const res = await AGRI_DATA.save('orchards', doc);
    const i = orchards.findIndex((o) => o.id === doc.id);
    const merged = { ...(i >= 0 ? orchards[i] : {}), ...res.data };
    if (i >= 0) orchards[i] = merged; else orchards.push(merged);
    notify();
    return res;
  }
  async function savePlot(doc) {
    const res = await AGRI_DATA.save('plots', doc);
    const i = plots.findIndex((p) => p.id === doc.id);
    const merged = { ...(i >= 0 ? plots[i] : {}), ...res.data };
    if (i >= 0) plots[i] = merged; else plots.push(merged);
    notify();
    return res;
  }
  async function removeOrchard(id) {
    const res = await AGRI_DATA.remove('orchards', id);
    orchards = orchards.filter((o) => o.id !== id);
    plots = plots.filter((p) => p.orchardId !== id);
    notify();
    return res;
  }
  async function removePlot(id) {
    const res = await AGRI_DATA.remove('plots', id);
    plots = plots.filter((p) => p.id !== id);
    notify();
    return res;
  }

  function reset() { orchards = []; plots = []; notify(); }

  if (typeof AGRI_DATA !== 'undefined') {
    AGRI_DATA.onChange((_, reason) => {
      if (reason === 'workspace' || reason === 'workspace-offline') syncFromState();
    });
  }

  return {
    COMMON_LABEL, esc, newId, onChange, load, syncFromState, reset,
    getOrchard, getPlot, allOrchards, allPlots, activeOrchards, plotsOf, hasOrchards, isOffline,
    plotLabel, orchardLabel, resolve, entryLabel, matchesFilter, optionsHTML,
    saveOrchard, savePlot, removeOrchard, removePlot
  };
})();

/* ============================================================
   ส่วนหน้าจอ: จัดการสวนและแปลง
   ============================================================ */
(function () {
  const O = AGRI_ORCHARDS;
  const $ = (id) => document.getElementById(id);
  const val = (id) => ($(id) ? $(id).value : '');
  const numOr = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const toast = (msg, type) => (typeof showToast === 'function' ? showToast(msg, type || 'success') : alert(msg));

  const VARIETIES = ['หมอนทอง', 'กระดุม', 'พวงมณี', 'ชะนี', 'ก้านยาว', 'มังคุด'];
  const IRRIGATIONS = ['สปริงเกอร์', 'มินิสปริงเกอร์', 'น้ำหยด', 'ไม่มีระบบน้ำ'];

  let map = null, marker = null, mapReady = false;
  let legacyRows = [];

  // ====== หน้ารวมสวนและแปลง ======
  function render() {
    const host = $('orchards-list');
    if (!host) return;
    const orchards = O.allOrchards();

    const totalPlots = orchards.reduce((n, o) => n + O.plotsOf(o.id).length, 0);
    const totalRai = orchards.reduce((n, o) => n + O.plotsOf(o.id).reduce((s, p) => s + (+p.areaRai || 0), 0), 0);
    const totalTrees = orchards.reduce((n, o) => n + O.plotsOf(o.id).reduce((s, p) => s + AGRI_CALC.estimateTrees(p.areaRai, p.spacingX, p.spacingY), 0), 0);
    const setText = (id, v) => { if ($(id)) $(id).innerText = v; };
    setText('orc-sum-orchards', orchards.length.toLocaleString('th-TH'));
    setText('orc-sum-plots', totalPlots.toLocaleString('th-TH'));
    setText('orc-sum-rai', totalRai.toLocaleString('th-TH', { maximumFractionDigits: 2 }));
    setText('orc-sum-trees', totalTrees.toLocaleString('th-TH'));

    if (!orchards.length) {
      host.innerHTML = `
        <div class="card orchard-empty">
          <div class="orchard-empty-icon">🌳</div>
          <h3>เริ่มต้นด้วยการสร้างสวนแรกของคุณ</h3>
          <p>ตั้งชื่อสวนเองได้อิสระ แล้วเพิ่มแปลงย่อยกี่แปลงก็ได้ ระบบจะนำรายชื่อไปใช้ในบัญชี คลังปุ๋ย แรงงาน และแผนที่ให้อัตโนมัติ</p>
          <button type="button" class="btn btn-primary" onclick="openOrchardModal()">➕ เพิ่มสวนใหม่</button>
        </div>`;
      renderLegacyMapping();
      return;
    }

    host.innerHTML = orchards.map((o) => {
      const plotList = O.plotsOf(o.id);
      const area = AGRI_CALC.formatArea({ rai: o.areaRai, ngan: o.areaNgan, wah: o.areaWah });
      const gps = (o.lat != null && o.lng != null) ? `📍 ${(+o.lat).toFixed(5)}, ${(+o.lng).toFixed(5)}` : '📍 ยังไม่ปักหมุด';
      const inactive = o.active === false;
      const rows = plotList.length ? plotList.map((p) => {
        const trees = AGRI_CALC.estimateTrees(p.areaRai, p.spacingX, p.spacingY);
        const off = p.active === false;
        return `<tr class="${off ? 'row-inactive' : ''}">
          <td data-label="แปลง"><strong>${O.esc(p.name)}</strong>${off ? ' <span class="badge-muted">ปิดใช้งาน</span>' : ''}</td>
          <td data-label="พื้นที่">${(+p.areaRai || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ไร่</td>
          <td data-label="ระยะปลูก">${O.esc(p.spacingX)}×${O.esc(p.spacingY)} ม.</td>
          <td data-label="สายพันธุ์">${O.esc(p.mainVariety || '-')}</td>
          <td data-label="อายุต้น">${+p.treeAge ? O.esc(p.treeAge) + ' ปี' : '-'}</td>
          <td data-label="ระบบน้ำ">${O.esc(p.irrigationType || '-')}${+p.valveCount ? ' · ' + O.esc(p.valveCount) + ' วาล์ว' : ''}</td>
          <td data-label="ประมาณต้น">${trees ? '≈ ' + trees.toLocaleString('th-TH') + ' ต้น' : '-'}</td>
          <td data-label="จัดการ" class="orc-actions">
            <button type="button" class="btn-icon" title="แก้ไข" onclick="openPlotModal('${O.esc(o.id)}','${O.esc(p.id)}')">✏️</button>
            <button type="button" class="btn-icon" title="${off ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}" onclick="togglePlotActive('${O.esc(p.id)}')">${off ? '▶️' : '⏸️'}</button>
            <button type="button" class="btn-icon danger" title="ลบแปลง" onclick="deletePlot('${O.esc(p.id)}')">🗑️</button>
          </td></tr>`;
      }).join('') : `<tr><td colspan="8" class="orc-no-plot">ยังไม่มีแปลงในสวนนี้ — กด "เพิ่มแปลง" เพื่อเริ่มต้น</td></tr>`;
      return `
      <div class="card orchard-card ${inactive ? 'is-inactive' : ''}">
        <div class="orchard-head">
          <div>
            <h3>🌳 ${O.esc(o.name)} ${inactive ? '<span class="badge-muted">ปิดใช้งาน</span>' : ''}</h3>
            <div class="orchard-meta">
              <span>${O.esc(gps)}</span>
              <span>📐 ${O.esc(area)}</span>
              ${o.address ? `<span>🏠 ${O.esc(o.address)}</span>` : ''}
              <span>🧩 ${plotList.length} แปลง</span>
            </div>
          </div>
          <div class="orchard-actions">
            <button type="button" class="btn btn-primary" onclick="openPlotModal('${O.esc(o.id)}')">➕ เพิ่มแปลง</button>
            <button type="button" class="btn btn-outline" onclick="openOrchardModal('${O.esc(o.id)}')">✏️ แก้ไขสวน</button>
            <button type="button" class="btn btn-outline" onclick="toggleOrchardActive('${O.esc(o.id)}')">${inactive ? '▶️ เปิดใช้งาน' : '⏸️ ปิดใช้งาน'}</button>
            <button type="button" class="btn btn-outline danger" onclick="deleteOrchard('${O.esc(o.id)}')">🗑️ ลบ</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table-responsive-card orc-table">
            <thead><tr><th>แปลง</th><th>พื้นที่</th><th>ระยะปลูก</th><th>สายพันธุ์</th><th>อายุต้น</th><th>ระบบน้ำ</th><th>ประมาณต้น</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    }).join('');
    renderLegacyMapping();
  }

  // ====== หน้าต่างสวน ======
  function openOrchardModal(id) {
    const o = id ? O.getOrchard(id) : null;
    $('orchard-modal-title').innerText = o ? '✏️ แก้ไขข้อมูลสวน' : '➕ เพิ่มสวนใหม่';
    $('orc-id').value = o ? o.id : '';
    $('orc-name').value = o ? o.name : '';
    $('orc-address').value = o ? (o.address || '') : '';
    $('orc-rai').value = o ? (o.areaRai || 0) : '';
    $('orc-ngan').value = o ? (o.areaNgan || 0) : '';
    $('orc-wah').value = o ? (o.areaWah || 0) : '';
    $('orc-lat').value = o && o.lat != null ? o.lat : '';
    $('orc-lng').value = o && o.lng != null ? o.lng : '';
    $('orc-note').value = o ? (o.note || '') : '';
    updateOrchardAreaPreview();
    $('orchard-modal').classList.remove('hidden');
    setTimeout(initOrchardMap, 120);
    setTimeout(() => $('orc-name').focus(), 150);
  }
  function closeOrchardModal(e) {
    if (e && e.target !== e.currentTarget) return;
    $('orchard-modal').classList.add('hidden');
  }
  function updateOrchardAreaPreview() {
    const total = AGRI_CALC.toSqWah({ rai: val('orc-rai'), ngan: val('orc-ngan'), wah: val('orc-wah') });
    $('orc-area-preview').innerText = total
      ? `รวม ${total.toLocaleString('th-TH')} ตารางวา (${(total / 400).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ไร่ · ${(total * 4).toLocaleString('th-TH')} ตร.ม.)`
      : 'กรอกขนาดพื้นที่รวมของสวน (ไม่บังคับ)';
  }

  async function saveOrchardForm(e) {
    if (e) e.preventDefault();
    const name = val('orc-name').trim();
    if (!name) { toast('กรุณาตั้งชื่อสวน', 'error'); $('orc-name').focus(); return; }
    const existing = val('orc-id') ? O.getOrchard(val('orc-id')) : null;
    const lat = val('orc-lat') === '' ? null : numOr(val('orc-lat'), null);
    const lng = val('orc-lng') === '' ? null : numOr(val('orc-lng'), null);
    if ((lat != null && (lat < -90 || lat > 90)) || (lng != null && (lng < -180 || lng > 180))) {
      toast('พิกัดไม่ถูกต้อง (ละติจูด -90 ถึง 90, ลองจิจูด -180 ถึง 180)', 'error'); return;
    }
    const norm = AGRI_CALC.fromSqWah(AGRI_CALC.toSqWah({ rai: val('orc-rai'), ngan: val('orc-ngan'), wah: val('orc-wah') }));
    const doc = {
      id: existing ? existing.id : O.newId('orc'),
      name, address: val('orc-address').trim(), lat, lng,
      areaRai: norm.rai, areaNgan: norm.ngan, areaWah: norm.wah,
      active: existing ? existing.active !== false : true,
      note: val('orc-note').trim()
    };
    const btn = $('orc-save-btn'); btn.classList.add('loading');
    try {
      const res = await O.saveOrchard(doc);
      closeOrchardModal();
      toast(res.queued ? 'บันทึกในเครื่องแล้ว จะส่งขึ้นคลาวด์เมื่อมีสัญญาณ' : (existing ? 'แก้ไขข้อมูลสวนเรียบร้อย' : 'สร้างสวนเรียบร้อย — เพิ่มแปลงต่อได้เลย'), res.queued ? 'warning' : 'success');
      if (!existing && !O.plotsOf(doc.id).length) openPlotModal(doc.id);
    } catch (err) {
      toast('บันทึกสวนไม่สำเร็จ: ' + err.message, 'error');
    } finally { btn.classList.remove('loading'); }
  }

  async function toggleOrchardActive(id) {
    const o = O.getOrchard(id); if (!o) return;
    const next = o.active === false;
    if (!next && !confirm(`ปิดใช้งานสวน "${o.name}" ?\nสวนและแปลงจะไม่แสดงในตัวเลือกของฟอร์มใหม่ แต่ข้อมูลเดิมยังอยู่ครบ`)) return;
    try { await O.saveOrchard({ ...o, active: next }); toast(next ? 'เปิดใช้งานสวนแล้ว' : 'ปิดใช้งานสวนแล้ว'); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function deleteOrchard(id) {
    const o = O.getOrchard(id); if (!o) return;
    const n = O.plotsOf(id).length;
    if (!confirm(`ลบสวน "${o.name}" ?\n\nแปลงในสวน ${n} แปลงจะถูกซ่อนไปด้วย\nรายการบัญชี/งานแปลงเดิมจะ "ยังอยู่" และแสดงด้วยชื่อที่บันทึกไว้ตอนทำรายการ`)) return;
    try { await O.removeOrchard(id); toast('ลบสวนเรียบร้อยแล้ว'); if (typeof renderAllTables === 'function') renderAllTables(); }
    catch (err) { toast(err.message, 'error'); }
  }

  // ====== แผนที่ปักหมุด ======
  function initOrchardMap() {
    const box = $('orc-map');
    if (!box) return;
    if (typeof L === 'undefined') { box.innerHTML = '<div class="orc-map-fallback">ไม่สามารถโหลดแผนที่ได้ (ไม่มีสัญญาณ) — กรอกพิกัดด้วยตนเองได้</div>'; return; }
    if (!map) {
      map = L.map(box, { zoomControl: true }).setView([12.61, 102.10], 8);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: 'ภาพถ่ายดาวเทียม © Esri, Maxar, Earthstar Geographics'
      }).addTo(map);
      map.on('click', (ev) => setPin(ev.latlng.lat, ev.latlng.lng, false));
      mapReady = true;
    }
    map.invalidateSize();
    const lat = numOr(val('orc-lat'), null), lng = numOr(val('orc-lng'), null);
    if (lat != null && lng != null) { setPin(lat, lng, true); map.setView([lat, lng], 16); }
    else if (marker) { map.removeLayer(marker); marker = null; map.setView([12.61, 102.10], 8); }
  }
  function setPin(lat, lng, silent) {
    if (!map) return;
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); setPin(p.lat, p.lng, false); });
    } else marker.setLatLng([lat, lng]);
    if (!silent) { $('orc-lat').value = (+lat).toFixed(6); $('orc-lng').value = (+lng).toFixed(6); }
  }
  function onLatLngInput() {
    const lat = numOr(val('orc-lat'), null), lng = numOr(val('orc-lng'), null);
    if (lat != null && lng != null && map) { setPin(lat, lng, true); map.setView([lat, lng], Math.max(map.getZoom(), 15)); }
  }
  function useMyLocation() {
    if (!navigator.geolocation) { toast('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง', 'error'); return; }
    toast('กำลังค้นหาตำแหน่งของคุณ...', 'success');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setPin(pos.coords.latitude, pos.coords.longitude, false); if (map) map.setView([pos.coords.latitude, pos.coords.longitude], 17); toast('ปักหมุดตำแหน่งปัจจุบันแล้ว'); },
      () => toast('ไม่สามารถอ่านตำแหน่งได้ กรุณาอนุญาตการเข้าถึงตำแหน่ง หรือแตะบนแผนที่เพื่อปักหมุด', 'error'),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  // ====== หน้าต่างแปลง ======
  function fillSelectWithCustom(selectId, customId, items, current) {
    const sel = $(selectId);
    sel.innerHTML = items.map((v) => `<option value="${O.esc(v)}">${O.esc(v)}</option>`).join('') + '<option value="__other">อื่นๆ (ระบุเอง)</option>';
    if (current && !items.includes(current)) { sel.value = '__other'; $(customId).value = current; $(customId).classList.remove('hidden'); }
    else { sel.value = current || items[0]; $(customId).value = ''; $(customId).classList.add('hidden'); }
  }
  function onPlotSelectChange(selectId, customId) {
    $(customId).classList.toggle('hidden', $(selectId).value !== '__other');
  }
  const pickValue = (selectId, customId) => ($(selectId).value === '__other' ? $(customId).value.trim() : $(selectId).value);

  function openPlotModal(orchardId, plotId) {
    const p = plotId ? O.getPlot(plotId) : null;
    const orchardIdUse = p ? p.orchardId : orchardId;
    const sel = $('plt-orchard');
    sel.innerHTML = O.allOrchards().map((o) => `<option value="${O.esc(o.id)}">${O.esc(o.name)}</option>`).join('');
    sel.value = orchardIdUse || (O.allOrchards()[0] && O.allOrchards()[0].id) || '';
    if (!sel.value) { toast('กรุณาสร้างสวนก่อนเพิ่มแปลง', 'error'); openOrchardModal(); return; }
    $('plot-modal-title').innerText = p ? '✏️ แก้ไขแปลง' : '➕ เพิ่มแปลง / โซนย่อย';
    $('plt-id').value = p ? p.id : '';
    $('plt-name').value = p ? p.name : '';
    $('plt-area').value = p ? (p.areaRai || '') : '';
    $('plt-sx').value = p ? (p.spacingX || 8) : 8;
    $('plt-sy').value = p ? (p.spacingY || 8) : 8;
    $('plt-age').value = p ? (p.treeAge || '') : '';
    $('plt-valves').value = p ? (p.valveCount || '') : '';
    $('plt-note').value = p ? (p.note || '') : '';
    fillSelectWithCustom('plt-variety', 'plt-variety-other', VARIETIES, p ? p.mainVariety : VARIETIES[0]);
    fillSelectWithCustom('plt-irrigation', 'plt-irrigation-other', IRRIGATIONS, p ? p.irrigationType : IRRIGATIONS[0]);
    updatePlotPreview();
    $('plot-modal').classList.remove('hidden');
    setTimeout(() => $('plt-name').focus(), 150);
  }
  function closePlotModal(e) {
    if (e && e.target !== e.currentTarget) return;
    $('plot-modal').classList.add('hidden');
  }
  function updatePlotPreview() {
    const trees = AGRI_CALC.estimateTrees(val('plt-area'), val('plt-sx'), val('plt-sy'));
    const per = AGRI_CALC.treesPerRai(val('plt-sx'), val('plt-sy'));
    $('plt-preview').innerText = trees
      ? `ระยะปลูก ${val('plt-sx')}×${val('plt-sy')} ม. ≈ ${per.toLocaleString('th-TH', { maximumFractionDigits: 1 })} ต้น/ไร่ → แปลงนี้ประมาณ ${trees.toLocaleString('th-TH')} ต้น`
      : 'กรอกพื้นที่และระยะปลูกเพื่อประมาณจำนวนต้น';
  }

  async function savePlotForm(e) {
    if (e) e.preventDefault();
    const name = val('plt-name').trim();
    const orchardId = val('plt-orchard');
    if (!orchardId) { toast('กรุณาเลือกสวน', 'error'); return; }
    if (!name) { toast('กรุณาตั้งชื่อแปลง', 'error'); $('plt-name').focus(); return; }
    const sx = numOr(val('plt-sx'), 8), sy = numOr(val('plt-sy'), 8);
    if (sx <= 0 || sy <= 0) { toast('ระยะปลูกต้องมากกว่า 0 เมตร', 'error'); return; }
    const existing = val('plt-id') ? O.getPlot(val('plt-id')) : null;
    const dup = O.plotsOf(orchardId).find((p) => p.name.trim() === name && (!existing || p.id !== existing.id));
    if (dup && !confirm(`มีแปลงชื่อ "${name}" ในสวนนี้แล้ว ต้องการเพิ่มชื่อซ้ำหรือไม่?`)) return;
    const doc = {
      id: existing ? existing.id : O.newId('plt'),
      orchardId, name,
      areaRai: Math.max(0, numOr(val('plt-area'), 0)),
      spacingX: sx, spacingY: sy,
      mainVariety: pickValue('plt-variety', 'plt-variety-other'),
      treeAge: Math.max(0, numOr(val('plt-age'), 0)),
      valveCount: Math.max(0, Math.round(numOr(val('plt-valves'), 0))),
      irrigationType: pickValue('plt-irrigation', 'plt-irrigation-other'),
      active: existing ? existing.active !== false : true,
      note: val('plt-note').trim()
    };
    if (existing && existing.boundary) doc.boundary = existing.boundary;
    const btn = $('plt-save-btn'); btn.classList.add('loading');
    try {
      const res = await O.savePlot(doc);
      closePlotModal();
      toast(res.queued ? 'บันทึกในเครื่องแล้ว จะส่งขึ้นคลาวด์เมื่อมีสัญญาณ' : (existing ? 'แก้ไขแปลงเรียบร้อย' : 'เพิ่มแปลงเรียบร้อย'), res.queued ? 'warning' : 'success');
    } catch (err) {
      toast('บันทึกแปลงไม่สำเร็จ: ' + err.message, 'error');
    } finally { btn.classList.remove('loading'); }
  }

  async function togglePlotActive(id) {
    const p = O.getPlot(id); if (!p) return;
    const next = p.active === false;
    if (!next && !confirm(`ปิดใช้งานแปลง "${p.name}" ?\nแปลงจะไม่แสดงในตัวเลือกของฟอร์มใหม่ แต่ข้อมูลเดิมยังอยู่ครบ`)) return;
    try { await O.savePlot({ ...p, active: next }); toast(next ? 'เปิดใช้งานแปลงแล้ว' : 'ปิดใช้งานแปลงแล้ว'); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function deletePlot(id) {
    const p = O.getPlot(id); if (!p) return;
    if (!confirm(`ลบแปลง "${p.name}" ?\n\nรายการบัญชี/งานแปลงเดิมจะ "ยังอยู่" และแสดงด้วยชื่อที่บันทึกไว้ตอนทำรายการ`)) return;
    try { await O.removePlot(id); toast('ลบแปลงเรียบร้อยแล้ว'); if (typeof renderAllTables === 'function') renderAllTables(); }
    catch (err) { toast(err.message, 'error'); }
  }

  // ====== ข้อมูลเดิมที่ระบุแปลงเป็นข้อความ ======
  function legacyLabelOf(item) {
    if (item.orchardId || item.plotId) return '';
    const label = item.plot || (typeof extractEntryPlot === 'function' ? extractEntryPlot(item) : '');
    return label && label !== O.COMMON_LABEL ? label : '';
  }
  function collectLegacyLabels() {
    const counts = new Map();
    [typeof accEntries !== 'undefined' ? accEntries : [], typeof fieldLogs !== 'undefined' ? fieldLogs : [],
      typeof plantSurveys !== 'undefined' ? plantSurveys : []].forEach((arr) => (arr || []).forEach((it) => {
      const l = legacyLabelOf(it);
      if (l) counts.set(l, (counts.get(l) || 0) + 1);
    }));
    return [...counts.entries()].map(([label, count]) => ({ label, count }));
  }
  function renderLegacyMapping() {
    const card = $('legacy-map-card'); const body = $('legacy-map-body');
    if (!card || !body) return;
    legacyRows = collectLegacyLabels();
    card.classList.toggle('hidden', !legacyRows.length);
    if (!legacyRows.length) return;
    const options = O.optionsHTML({ includeCommon: true, includeSkip: true });
    body.innerHTML = legacyRows.map((r, i) => `
      <div class="legacy-row">
        <div class="legacy-label"><strong>${O.esc(r.label)}</strong><span>${r.count} รายการ</span></div>
        <select id="legacy-sel-${i}" class="form-control">${options}</select>
      </div>`).join('') + (O.hasOrchards() ? '' : '<p class="legacy-hint">สร้างสวนและแปลงก่อน แล้วจึงเลือกจับคู่ได้</p>');
  }
  function applyLegacyMapping() {
    let changed = 0;
    legacyRows.forEach((row, i) => {
      const v = val('legacy-sel-' + i);
      if (!v || v === 'skip') return;
      const t = O.resolve(v);
      [accEntries, fieldLogs, plantSurveys].forEach((arr) => arr.forEach((it) => {
        if (legacyLabelOf(it) === row.label) { it.plot = t.label; it.orchardId = t.orchardId; it.plotId = t.plotId; changed++; }
      }));
    });
    if (!changed) { toast('ยังไม่ได้เลือกแปลงปลายทาง', 'error'); return; }
    saveLocalData();
    renderAllTables();
    if (typeof refreshPlotSelects === 'function') refreshPlotSelects();
    renderLegacyMapping();
    toast(`จับคู่ข้อมูลเดิม ${changed} รายการเรียบร้อย`);
  }

  async function adoptLegacyGuestData() {
    if (!confirm('นำเข้าข้อมูลเดิมจากโหมดผู้เยี่ยมชมแบบเก่า (ที่ใช้ร่วมกันทุกเครื่อง) เข้าบัญชีนี้?\nข้อมูลจะถูกย้ายมาที่บัญชีนี้และหายจากที่เดิม')) return;
    try {
      const r = await AGRI_STORAGE.authFetch('/api/migrate/adopt-guest', { method: 'POST' });
      const j = await AGRI_STORAGE.parseResponseSafely(r);
      const m = j.moved || {};
      toast(`นำเข้าแล้ว: บัญชี ${m.accEntries || 0} · งานแปลง ${m.fieldLogs || 0} · สำรวจต้น ${m.plantSurveys || 0} รายการ`);
      if (typeof reloadUserWorkspace === 'function') await reloadUserWorkspace();
    } catch (err) { toast('นำเข้าไม่สำเร็จ: ' + err.message, 'error'); }
  }

  O.onChange(render);

  Object.assign(window, {
    openOrchardModal, closeOrchardModal, saveOrchardForm, updateOrchardAreaPreview, onLatLngInput, useMyLocation,
    toggleOrchardActive, deleteOrchard, openPlotModal, closePlotModal, savePlotForm, updatePlotPreview,
    onPlotSelectChange, togglePlotActive, deletePlot, applyLegacyMapping, adoptLegacyGuestData,
    renderOrchardsView: render, renderLegacyMapping, collectLegacyLabels
  });
})();
