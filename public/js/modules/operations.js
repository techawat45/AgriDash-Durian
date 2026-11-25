/* ============================================================
   AgriDash Durian Pro - โมดูลปฏิบัติการในสวน ถังพ่นยา คลังปัจจัยการผลิต และการให้น้ำ (operations.js)
   ============================================================ */
const AGRI_OPS = (() => {
  const O = AGRI_ORCHARDS;
  const C = AGRI_CALC;
  const $ = (id) => document.getElementById(id);
  const toast = (msg, type) => (typeof showToast === 'function' ? showToast(msg, type || 'success') : alert(msg));

  let activeTab = 'spray'; // 'spray' | 'inventory' | 'irrigation'
  let sprayRows = [
    { itemId: '', name: 'อะบาเมกติน', category: 'สารป้องกันกำจัดแมลง', formulation: 'EC/OD', ratePer200L: 150, doseUnit: 'ซีซี', stockUnit: 'ลิตร', unitCost: 380, phiDays: 14 },
    { itemId: '', name: 'แคลเซียมโบรอน', category: 'ปุ๋ยทางใบ/ธาตุอาหาร', formulation: 'ธาตุอาหารน้ำ', ratePer200L: 200, doseUnit: 'ซีซี', stockUnit: 'ลิตร', unitCost: 220, phiDays: 0 },
    { itemId: '', name: 'สารจับใบ', category: 'สารจับใบ/ปรับสภาพน้ำ', formulation: 'สารจับใบ', ratePer200L: 40, doseUnit: 'ซีซี', stockUnit: 'ลิตร', unitCost: 180, phiDays: 0 }
  ];

  function formatMoney(v) {
    return '฿' + C.num(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function openOpsTab(tab) {
    if (typeof switchView === 'function') switchView('ops');
    switchOpsSubTab(tab || 'spray');
  }

  function switchOpsSubTab(tab) {
    activeTab = tab;
    ['spray', 'inventory', 'irrigation'].forEach((t) => {
      $('ops-panel-' + t)?.classList.toggle('hidden', t !== tab);
      $('ops-tab-' + t)?.classList.toggle('active', t === tab);
    });
    refreshAll();
  }

  // ====== 1. เครื่องคำนวณสูตรผสมถังพ่นยา 200 / 1,000 ลิตร ======
  function setSprayTankSize(liters) {
    const inp = $('ops-tank-size');
    if (inp) inp.value = liters;
    $('ops-tank-200-btn')?.classList.toggle('active', Number(liters) === 200);
    $('ops-tank-1000-btn')?.classList.toggle('active', Number(liters) === 1000);
    recalcSprayBuilder();
  }

  function refreshSprayTargetSelectors() {
    const orcSel = $('ops-spray-orchard');
    if (!orcSel) return;
    const prevOrc = orcSel.value;
    const activeOrcs = O.activeOrchards();
    orcSel.innerHTML = `<option value="">🏛️ กองกลาง / ไม่ระบุสวน</option>` +
      activeOrcs.map((o) => `<option value="${O.esc(o.id)}">🌳 ${O.esc(o.name)}</option>`).join('');

    if (prevOrc && Array.from(orcSel.options).some((x) => x.value === prevOrc)) {
      orcSel.value = prevOrc;
    } else if (activeOrcs[0]) {
      orcSel.value = activeOrcs[0].id;
    }
    renderSprayPlotCheckboxes();
  }

  function renderSprayPlotCheckboxes() {
    const box = $('ops-spray-plots-box');
    const orcId = $('ops-spray-orchard')?.value || '';
    if (!box) return;
    if (!orcId) {
      box.innerHTML = `<span style="font-size:0.84rem;color:var(--slate-500);">เลือกสวนด้านซ้ายเพื่อติ๊กเลือกแปลงย่อยที่จะพ่น (หรือบันทึกเป็นกองกลาง)</span>`;
      return;
    }
    const plots = O.plotsOf(orcId, true);
    if (!plots.length) {
      box.innerHTML = `<span style="font-size:0.84rem;color:var(--slate-500);">สวนนี้ยังไม่มีแปลงย่อย — จะบันทึกในระดับทั้งสวน</span>`;
      return;
    }
    box.innerHTML = plots.map((p, idx) => `
      <label class="plot-check-chip">
        <input type="checkbox" class="ops-spray-plot-chk" value="${O.esc(p.id)}" ${idx === 0 ? 'checked' : ''} />
        <span>${O.esc(p.name)} (${C.num(p.areaRai)} ไร่)</span>
      </label>
    `).join('');
  }

  function addSprayIngredientRow() {
    const firstInv = (AGRI_DATA.state.inventory || []).find((i) => i.active !== false);
    if (firstInv) {
      sprayRows.push({
        itemId: firstInv.id,
        name: firstInv.name,
        category: firstInv.category,
        formulation: firstInv.formulation || 'SC/SL',
        ratePer200L: C.num(firstInv.ratePer200LDefault) || 100,
        doseUnit: firstInv.doseUnit || 'ซีซี',
        stockUnit: firstInv.unit || 'ลิตร',
        packSize: firstInv.packSize,
        unitCost: C.num(firstInv.avgCost),
        phiDays: C.num(firstInv.phiDays)
      });
    } else {
      sprayRows.push({ itemId: '', name: '', category: 'สารป้องกันกำจัดแมลง', formulation: 'SC/SL', ratePer200L: 100, doseUnit: 'ซีซี', stockUnit: 'ลิตร', unitCost: 0, phiDays: 7 });
    }
    renderSprayRows();
  }

  function removeSprayIngredientRow(idx) {
    if (sprayRows.length <= 1) { toast('ต้องมีรายการสารในถังอย่างน้อย 1 รายการ', 'warning'); return; }
    sprayRows.splice(idx, 1);
    renderSprayRows();
  }

  function onSprayItemPick(idx, itemId) {
    const row = sprayRows[idx];
    if (!row) return;
    if (!itemId) {
      row.itemId = '';
      renderSprayRows();
      return;
    }
    const inv = (AGRI_DATA.state.inventory || []).find((x) => x.id === itemId);
    if (inv) {
      row.itemId = inv.id;
      row.name = inv.name;
      row.category = inv.category || 'สารป้องกันกำจัดแมลง';
      row.formulation = inv.formulation || 'SC/SL';
      if (C.num(inv.ratePer200LDefault) > 0) row.ratePer200L = C.num(inv.ratePer200LDefault);
      row.doseUnit = inv.doseUnit || (inv.unit === 'กิโลกรัม' || inv.unit === 'กรัม' || inv.unit === 'กระสอบ' || inv.unit === 'ถุง' ? 'กรัม' : 'ซีซี');
      row.stockUnit = inv.unit || 'ลิตร';
      row.packSize = inv.packSize;
      row.unitCost = C.num(inv.avgCost);
      row.phiDays = C.num(inv.phiDays);
    }
    renderSprayRows();
  }

  function updateSprayRowField(idx, field, value) {
    const row = sprayRows[idx];
    if (!row) return;
    if (field === 'ratePer200L' || field === 'unitCost' || field === 'phiDays') row[field] = C.num(value);
    else row[field] = value;
    recalcSprayBuilder();
  }

  function renderSprayRows() {
    const host = $('ops-spray-rows');
    if (!host) return;
    const invList = (AGRI_DATA.state.inventory || []).filter((i) => i.active !== false);

    host.innerHTML = sprayRows.map((r, i) => {
      const invOpts = `<option value="">— พิมพ์ระบุเอง (ไม่ตัดคลัง) —</option>` +
        invList.map((inv) => `<option value="${O.esc(inv.id)}" ${inv.id === r.itemId ? 'selected' : ''}>📦 ${O.esc(inv.name)} (คงเหลือ ${C.num(inv.stockQty)} ${O.esc(inv.unit)} · @฿${C.num(inv.avgCost).toLocaleString('th-TH')})</option>`).join('');
      const forms = ['ปรับสภาพน้ำ', 'WP/WG', 'ปุ๋ยเกร็ด/ผง', 'SC/SL', 'EC/OD', 'ธาตุอาหารน้ำ', 'สารจับใบ'];
      return `
        <div class="purchase-item-card" style="margin-bottom:10px;">
          <div style="display:grid;grid-template-columns:1.3fr 1fr auto;gap:10px;align-items:end;" class="ops-ing-top">
            <div>
              <span class="purchase-field-label">เลือกสาร/ปุ๋ยจากคลัง</span>
              <select class="form-control" onchange="onSprayItemPick(${i}, this.value)">${invOpts}</select>
            </div>
            <div>
              <span class="purchase-field-label">ชื่อสารที่พ่น</span>
              <input type="text" list="agri-product-suggestions" class="form-control" value="${O.esc(r.name)}" placeholder="เช่น อะบาเมกติน" oninput="updateSprayRowField(${i}, 'name', this.value)" />
            </div>
            <button type="button" class="btn btn-outline" style="height:46px;width:44px;padding:0;color:var(--rose-600);border-color:var(--rose-200);" onclick="removeSprayIngredientRow(${i})" title="ลบสารนี้">✕</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-top:10px;">
            <div>
              <span class="purchase-field-label">อัตราใช้ต่อน้ำ 200 ลิตร</span>
              <input type="number" step="any" min="0" class="form-control" value="${C.num(r.ratePer200L)}" oninput="updateSprayRowField(${i}, 'ratePer200L', this.value)" />
            </div>
            <div>
              <span class="purchase-field-label">หน่วยตวง</span>
              <select class="form-control" onchange="updateSprayRowField(${i}, 'doseUnit', this.value)">
                ${['ซีซี', 'กรัม', 'ลิตร', 'กิโลกรัม'].map((u) => `<option value="${u}" ${r.doseUnit === u ? 'selected' : ''}>${u}</option>`).join('')}
              </select>
            </div>
            <div>
              <span class="purchase-field-label">ชนิดเนื้อสาร (จัดลำดับผสม)</span>
              <select class="form-control" onchange="updateSprayRowField(${i}, 'formulation', this.value)">
                ${forms.map((f) => `<option value="${f}" ${r.formulation === f ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
            </div>
            <div>
              <span class="purchase-field-label">ราคาต่อ${O.esc(r.stockUnit || 'หน่วย')} (บาท)</span>
              <input type="number" step="any" min="0" class="form-control" value="${C.num(r.unitCost)}" oninput="updateSprayRowField(${i}, 'unitCost', this.value)" />
            </div>
            <div>
              <span class="purchase-field-label">หยุดพ่นก่อนตัด (วัน)</span>
              <input type="number" min="0" class="form-control" value="${C.num(r.phiDays)}" oninput="updateSprayRowField(${i}, 'phiDays', this.value)" />
            </div>
          </div>
        </div>
      `;
    }).join('');
    recalcSprayBuilder();
  }

  function getCurrentSprayPlan() {
    const invMap = new Map((AGRI_DATA.state.inventory || []).map((x) => [x.id, x]));
    const date = $('ops-spray-date')?.value || (typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10));
    const tankSize = C.num($('ops-tank-size')?.value) || 1000;
    const tanks = C.num($('ops-tank-count')?.value) || 1;
    return C.calculateSprayPlan({
      date,
      tankSize,
      tanks,
      ingredients: sprayRows
        .filter((r) => String(r.name || '').trim() !== '' && C.num(r.ratePer200L) > 0)
        .map((r) => ({ ...r, inventoryItem: r.itemId ? invMap.get(r.itemId) : undefined }))
    });
  }

  function recalcSprayBuilder() {
    const plan = getCurrentSprayPlan();
    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };
    set('ops-sum-water', `${plan.totalWaterLiters.toLocaleString('th-TH')} ลิตร`);
    set('ops-sum-tank-cost', formatMoney(plan.costPerTank));
    set('ops-sum-total-cost', formatMoney(plan.totalCost));
    set('ops-sum-phi', plan.maxPhiDays > 0
      ? `${plan.maxPhiDays} วัน (ถึง ${typeof formatDateSlashThai === 'function' ? formatDateSlashThai(plan.phiUntil) : plan.phiUntil})`
      : 'ไม่ติดระยะเว้นเก็บเกี่ยว');

    const mixBox = $('ops-mix-sequence');
    if (mixBox) {
      if (!plan.items.length) {
        mixBox.innerHTML = `<div style="color:var(--slate-500);font-size:0.88rem;">ระบุชื่อสารและอัตราใช้ต่อน้ำ 200 ลิตร เพื่อดูปริมาณตวงจริงและลำดับการผสม</div>`;
      } else {
        mixBox.innerHTML = plan.items.map((it, i) => `
          <div class="mix-step-row ${it.insufficientStock ? 'mix-insufficient' : ''}">
            <div class="mix-step-badge">${i + 1}</div>
            <div style="flex:1;">
              <div style="font-weight:800;color:var(--slate-900);">${O.esc(it.name)} <span style="font-weight:600;font-size:0.8rem;color:var(--emerald-800);">(${O.esc(it.mixStepName)})</span></div>
              <div style="font-size:0.84rem;color:var(--slate-600);">
                ตวงถังละ <strong>${it.dosePerTank.toLocaleString('th-TH')} ${O.esc(it.doseUnit)}</strong>
                · รวมทั้งหมด <strong>${it.totalDose.toLocaleString('th-TH')} ${O.esc(it.doseUnit)}</strong>
                ${it.itemId ? ` (ตัดสต็อก ${it.stockDeducted} ${O.esc(it.stockUnit)})` : ''}
                ${it.insufficientStock ? ` <strong style="color:var(--rose-600);">⚠️ สต็อกในคลังไม่พอ!</strong>` : ''}
              </div>
            </div>
            <div style="font-weight:800;color:var(--slate-900);white-space:nowrap;">${formatMoney(it.cost)}</div>
          </div>
        `).join('');
      }
    }
  }

  async function submitSprayCommit(e) {
    if (e) e.preventDefault();
    const plan = getCurrentSprayPlan();
    if (!plan.items.length) {
      toast('กรุณาเลือกหรือกรอกชื่อสารอย่างน้อย 1 รายการ', 'error');
      return;
    }
    const lacking = plan.items.filter((i) => i.insufficientStock);
    if (lacking.length && !confirm(`สาร "${lacking.map((x) => x.name).join(', ')}" มีสต็อกในคลังน้อยกว่าปริมาณที่ใช้ ต้องการบันทึกพ่นและปรับสต็อกเป็น 0 หรือไม่?`)) {
      return;
    }

    const orcId = $('ops-spray-orchard')?.value || '';
    const plotIds = Array.from(document.querySelectorAll('.ops-spray-plot-chk:checked')).map((el) => el.value);
    const orc = orcId ? O.getOrchard(orcId) : null;
    const plotNames = plotIds.length
      ? plotIds.map((pid) => O.plotLabel(O.getPlot(pid))).join(', ')
      : (orc ? O.orchardLabel(orc) : O.COMMON_LABEL);

    const btn = $('ops-spray-submit-btn');
    if (btn) btn.classList.add('loading');
    try {
      const res = await AGRI_DATA.commitSpray({
        id: O.newId('spr'),
        date: $('ops-spray-date')?.value || getTodayISO(),
        orchardId: orcId,
        plotIds,
        plotNames,
        stage: $('ops-spray-stage')?.value || '',
        tankSize: plan.tankSize,
        tanks: plan.tanks,
        ingredients: sprayRows.filter((r) => String(r.name || '').trim() !== '' && C.num(r.ratePer200L) > 0),
        postToLedger: $('ops-spray-post-ledger')?.checked !== false,
        note: ($('ops-spray-note')?.value || '').trim()
      });
      if ($('ops-spray-note')) $('ops-spray-note').value = '';
      renderSprayRows();
      renderSprayHistory();
      renderInventoryPanel();
      toast(res.queued
        ? `บันทึกการพ่น ${formatMoney(plan.totalCost)} ในเครื่องแล้ว (รอส่งคลาวด์เมื่อมีสัญญาณ)`
        : `บันทึกการพ่น ตัดสต็อก และลงสมุดบัญชี ${formatMoney(plan.totalCost)} เรียบร้อยแล้ว`);
    } catch (err) {
      toast('บันทึกการพ่นไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      if (btn) btn.classList.remove('loading');
    }
  }

  function renderSprayHistory() {
    const tbody = $('ops-spray-history-tbody');
    if (!tbody) return;
    const today = typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10);
    const list = [...(AGRI_DATA.state.sprays || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:22px;color:var(--slate-500);">ยังไม่มีประวัติการพ่นสาร</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map((s) => {
      const ings = (s.ingredients || []).map((i) => `${i.name} (${i.totalDose} ${i.doseUnit})`).join(' + ');
      const phiActive = s.phiUntil && s.phiUntil >= today;
      const phiBadge = s.phiUntil
        ? `<span class="${phiActive ? 'badge-expense' : 'badge-income'}">${phiActive ? '🛡️ ห้ามตัดถึง ' : '✅ พ้นระยะ '}${typeof formatDateSlashThai === 'function' ? formatDateSlashThai(s.phiUntil) : s.phiUntil}</span>`
        : '-';
      return `
        <tr>
          <td data-label="วันที่">${O.esc(typeof formatDateSlashThai === 'function' ? formatDateSlashThai(s.date) : s.date)}</td>
          <td data-label="สวน / แปลง"><strong>${O.esc(s.plotNames || '-')}</strong></td>
          <td data-label="ขนาดและจำนวนถัง">${C.num(s.tankSize).toLocaleString('th-TH')} ล. × ${C.num(s.tanks)} ถัง</td>
          <td data-label="รายการสารที่ผสม" style="font-size:0.84rem;">${O.esc(ings || '-')}</td>
          <td data-label="ระยะปลอดภัยเก็บเกี่ยว">${phiBadge}</td>
          <td data-label="ต้นทุนรวม" style="text-align:right;font-weight:800;">${formatMoney(s.totalCost)}</td>
          <td data-label="จัดการ" style="text-align:center;">
            <button type="button" class="btn-icon danger" title="ลบและคืนสต็อก" onclick="removeSprayRecord('${O.esc(s.id)}')">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function removeSprayRecord(id) {
    if (!confirm('ลบรายการพ่นสารนี้? ระบบจะคืนยอดสต็อกเข้าคลังและลบรายจ่ายที่ผูกไว้ในสมุดบัญชีให้อัตโนมัติ')) return;
    await AGRI_DATA.deleteSpray(id);
    renderSprayRows();
    renderSprayHistory();
    renderInventoryPanel();
    toast('ลบรายการพ่นสารและคืนสต็อกเข้าคลังแล้ว');
  }

  // ====== 2. คลังปุ๋ยและสารเคมี ======
  function renderInventoryPanel() {
    const items = (AGRI_DATA.state.inventory || []).filter((i) => i.active !== false);
    const totalValue = items.reduce((s, i) => s + Math.max(0, C.num(i.stockQty)) * Math.max(0, C.num(i.avgCost)), 0);
    const lowCount = items.filter((i) => C.num(i.stockQty) <= C.num(i.reorderLevel ?? 1)).length;

    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };
    set('inv-sum-count', `${items.length.toLocaleString('th-TH')} รายการ`);
    set('inv-sum-value', formatMoney(totalValue));
    set('inv-sum-low', `${lowCount.toLocaleString('th-TH')} รายการ`);

    const tbody = $('inv-items-tbody');
    if (tbody) {
      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--slate-500);">คลังยังว่างอยู่ — กดปุ่ม "ซื้อสินค้าเข้าคลัง" เพื่อเพิ่มปุ๋ยหรือสารเคมีรายการแรก</td></tr>`;
      } else {
        tbody.innerHTML = items.map((it) => {
          const isLow = C.num(it.stockQty) <= C.num(it.reorderLevel ?? 1);
          const val = C.round2(C.num(it.stockQty) * C.num(it.avgCost));
          return `
            <tr>
              <td data-label="ชื่อปุ๋ย / สารเคมี">
                <strong>${O.esc(it.name)}</strong>
                ${it.activeIngredient ? `<div style="font-size:0.76rem;color:var(--slate-500);">สารสามัญ: ${O.esc(it.activeIngredient)}</div>` : ''}
              </td>
              <td data-label="หมวดหมู่">${O.esc(it.category || '-')} · <span style="font-size:0.78rem;color:var(--slate-500);">${O.esc(it.formulation || '')}</span></td>
              <td data-label="คงเหลือ">
                <strong style="color:${isLow ? 'var(--rose-600)' : 'var(--emerald-800)'};">${C.num(it.stockQty).toLocaleString('th-TH', { maximumFractionDigits: 3 })} ${O.esc(it.unit)}</strong>
                ${isLow ? ' <span class="badge-expense" style="font-size:0.72rem;">ใกล้หมด</span>' : ''}
              </td>
              <td data-label="ต้นทุนเฉลี่ย/หน่วย">${formatMoney(it.avgCost)}/${O.esc(it.unit)}</td>
              <td data-label="มูลค่าคงเหลือ" style="font-weight:700;">${formatMoney(val)}</td>
              <td data-label="หยุดพ่นก่อนตัด">${C.num(it.phiDays) > 0 ? `${C.num(it.phiDays)} วัน` : '0 วัน'}</td>
              <td data-label="อัตราต่อน้ำ 200 ล.">${C.num(it.ratePer200LDefault) > 0 ? `${C.num(it.ratePer200LDefault)} ${O.esc(it.doseUnit || '')}` : '-'}</td>
              <td data-label="จัดการ" style="white-space:nowrap;">
                <button type="button" class="btn-icon" title="ซื้อเพิ่มเข้าคลัง" onclick="openPurchaseModal('${O.esc(it.id)}')">➕</button>
                <button type="button" class="btn-icon" title="แก้ไขรายการ" onclick="openInventoryItemModal('${O.esc(it.id)}')">✏️</button>
                <button type="button" class="btn-icon danger" title="ลบออกจากคลัง" onclick="deleteInventoryItem('${O.esc(it.id)}')">🗑️</button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    const movBody = $('inv-movements-tbody');
    if (movBody) {
      const movs = (AGRI_DATA.state.stockMovements || []).slice(0, 50);
      movBody.innerHTML = movs.length ? movs.map((m) => `
        <tr>
          <td data-label="วันที่">${O.esc(typeof formatDateSlashThai === 'function' ? formatDateSlashThai(m.date) : m.date)}</td>
          <td data-label="ประเภท">${m.type === 'in' ? '<span class="badge-income">รับเข้า</span>' : (m.type === 'out' ? '<span class="badge-expense">เบิกพ่น</span>' : '<span class="badge-op">ปรับยอด</span>')}</td>
          <td data-label="สินค้า"><strong>${O.esc(m.itemName || '-')}</strong></td>
          <td data-label="จำนวน">${m.type === 'out' ? '-' : '+'}${C.num(m.qty).toLocaleString('th-TH', { maximumFractionDigits: 3 })} ${O.esc(m.unit || '')}</td>
          <td data-label="มูลค่า" style="text-align:right;font-weight:700;">${formatMoney(m.totalCost)}</td>
          <td data-label="หมายเหตุ" style="font-size:0.82rem;color:var(--slate-600);">${O.esc(m.vendor || m.note || '-')}</td>
        </tr>
      `).join('') : `<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--slate-500);">ยังไม่มีประวัติความเคลื่อนไหวสต็อก</td></tr>`;
    }
  }

  function openPurchaseModal(preselectItemId) {
    const items = (AGRI_DATA.state.inventory || []).filter((i) => i.active !== false);
    const sel = $('pur-item-select');
    if (sel) {
      sel.innerHTML = `<option value="__new">➕ สร้างสินค้าใหม่เข้าคลัง</option>` +
        items.map((i) => `<option value="${O.esc(i.id)}">${O.esc(i.name)} (คงเหลือ ${C.num(i.stockQty)} ${O.esc(i.unit)})</option>`).join('');
      sel.value = preselectItemId && items.some((x) => x.id === preselectItemId) ? preselectItemId : (items[0]?.id || '__new');
    }
    const targetSel = $('pur-target-plot');
    if (targetSel) {
      targetSel.innerHTML = O.optionsHTML({ includeCommon: true, allowOrchardLevel: true });
    }
    $('pur-date').value = typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10);
    $('pur-qty').value = 1;
    $('pur-vendor').value = '';
    $('pur-note').value = '';
    $('pur-post-ledger').checked = true;
    onPurchaseItemSelectChange();
    $('inv-purchase-modal')?.classList.remove('hidden');
  }

  function closePurchaseModal(e) {
    if (e && e.target !== e.currentTarget) return;
    $('inv-purchase-modal')?.classList.add('hidden');
  }

  function onPurchaseItemSelectChange() {
    const v = $('pur-item-select')?.value || '__new';
    const isNew = v === '__new';
    $('pur-new-item-fields')?.classList.toggle('hidden', !isNew);
    if (!isNew) {
      const inv = (AGRI_DATA.state.inventory || []).find((x) => x.id === v);
      if (inv) $('pur-unit-price').value = C.num(inv.avgCost) || '';
    }
    updatePurchaseTotalPreview();
  }

  function updatePurchaseTotalPreview() {
    const q = C.num($('pur-qty')?.value);
    const p = C.num($('pur-unit-price')?.value);
    const el = $('pur-total-preview');
    if (el) el.innerText = formatMoney(q * p);
  }

  async function submitPurchaseForm(e) {
    if (e) e.preventDefault();
    const selVal = $('pur-item-select')?.value || '__new';
    const qty = C.num($('pur-qty')?.value);
    const unitPrice = C.num($('pur-unit-price')?.value);
    if (qty <= 0) { toast('กรุณาระบุจำนวนที่ซื้อให้มากกว่า 0', 'error'); return; }

    let newItem = null;
    if (selVal === '__new') {
      const name = ($('pur-new-name')?.value || '').trim();
      if (!name) { toast('กรุณาระบุชื่อปุ๋ยหรือสารเคมี', 'error'); return; }
      newItem = {
        id: O.newId('inv'),
        name,
        category: $('pur-new-category')?.value || 'สารป้องกันกำจัดแมลง',
        formulation: $('pur-new-formulation')?.value || 'SC/SL',
        unit: $('pur-new-unit')?.value || 'ลิตร',
        doseUnit: $('pur-new-dose-unit')?.value || 'ซีซี',
        packSize: C.num($('pur-new-packsize')?.value),
        ratePer200LDefault: C.num($('pur-new-rate200')?.value),
        phiDays: C.num($('pur-new-phi')?.value),
        reorderLevel: C.num($('pur-new-reorder')?.value ?? 1),
        activeIngredient: ($('pur-new-active-ing')?.value || '').trim()
      };
    }

    const target = O.resolve($('pur-target-plot')?.value || 'common');
    const btn = $('pur-submit-btn');
    if (btn) btn.classList.add('loading');
    try {
      const res = await AGRI_DATA.purchaseInventory({
        id: O.newId('pur'),
        date: $('pur-date')?.value || getTodayISO(),
        itemId: selVal === '__new' ? '' : selVal,
        newItem,
        qty,
        unitPrice,
        vendor: ($('pur-vendor')?.value || '').trim(),
        orchardId: target.orchardId,
        plotId: target.plotId,
        plotLabel: target.label,
        postToLedger: Boolean($('pur-post-ledger')?.checked),
        note: ($('pur-note')?.value || '').trim()
      });
      if (typeof rememberProductNames === 'function' && res.item) rememberProductNames([res.item.name]);
      closePurchaseModal();
      renderInventoryPanel();
      renderSprayRows();
      toast(`รับสินค้าเข้าคลังเรียบร้อย ต้นทุนเฉลี่ยใหม่ ${formatMoney(res.item?.avgCost)}/${res.item?.unit || ''}`);
    } catch (err) {
      toast('บันทึกการซื้อไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      if (btn) btn.classList.remove('loading');
    }
  }

  function openInventoryItemModal(itemId) {
    const it = itemId ? (AGRI_DATA.state.inventory || []).find((x) => x.id === itemId) : null;
    $('inv-edit-title').innerText = it ? '✏️ แก้ไขรายการคลังและตรวจนับสต็อก' : '➕ เพิ่มทะเบียนสินค้าในคลัง';
    $('inv-edit-id').value = it ? it.id : '';
    $('inv-edit-name').value = it ? it.name : '';
    $('inv-edit-category').value = it ? (it.category || 'สารป้องกันกำจัดแมลง') : 'สารป้องกันกำจัดแมลง';
    $('inv-edit-formulation').value = it ? (it.formulation || 'SC/SL') : 'SC/SL';
    $('inv-edit-unit').value = it ? (it.unit || 'ลิตร') : 'ลิตร';
    $('inv-edit-dose-unit').value = it ? (it.doseUnit || 'ซีซี') : 'ซีซี';
    $('inv-edit-packsize').value = it && C.num(it.packSize) > 0 ? it.packSize : '';
    $('inv-edit-stock').value = it ? C.num(it.stockQty) : 0;
    $('inv-edit-cost').value = it ? C.num(it.avgCost) : 0;
    $('inv-edit-rate200').value = it ? C.num(it.ratePer200LDefault) : '';
    $('inv-edit-phi').value = it ? C.num(it.phiDays) : 0;
    $('inv-edit-reorder').value = it ? C.num(it.reorderLevel ?? 1) : 1;
    $('inv-edit-active-ing').value = it ? (it.activeIngredient || '') : '';
    $('inv-item-modal')?.classList.remove('hidden');
  }

  function closeInventoryItemModal(e) {
    if (e && e.target !== e.currentTarget) return;
    $('inv-item-modal')?.classList.add('hidden');
  }

  async function saveInventoryItemForm(e) {
    if (e) e.preventDefault();
    const name = ($('inv-edit-name')?.value || '').trim();
    if (!name) { toast('กรุณากรอกชื่อสินค้า', 'error'); return; }
    const id = $('inv-edit-id')?.value || O.newId('inv');
    const doc = {
      id,
      name,
      category: $('inv-edit-category')?.value || 'สารป้องกันกำจัดแมลง',
      formulation: $('inv-edit-formulation')?.value || 'SC/SL',
      unit: $('inv-edit-unit')?.value || 'ลิตร',
      doseUnit: $('inv-edit-dose-unit')?.value || 'ซีซี',
      packSize: C.num($('inv-edit-packsize')?.value),
      stockQty: Math.max(0, C.num($('inv-edit-stock')?.value)),
      avgCost: Math.max(0, C.num($('inv-edit-cost')?.value)),
      ratePer200LDefault: Math.max(0, C.num($('inv-edit-rate200')?.value)),
      phiDays: Math.max(0, Math.round(C.num($('inv-edit-phi')?.value))),
      reorderLevel: Math.max(0, C.num($('inv-edit-reorder')?.value)),
      activeIngredient: ($('inv-edit-active-ing')?.value || '').trim(),
      active: true
    };
    await AGRI_DATA.save('inventory', doc);
    if (typeof rememberProductNames === 'function') rememberProductNames([name]);
    closeInventoryItemModal();
    renderInventoryPanel();
    renderSprayRows();
    toast('บันทึกข้อมูลสินค้าในคลังเรียบร้อย');
  }

  async function deleteInventoryItem(id) {
    const it = (AGRI_DATA.state.inventory || []).find((x) => x.id === id);
    if (!it || !confirm(`ลบ "${it.name}" ออกจากคลังใช่หรือไม่?`)) return;
    await AGRI_DATA.remove('inventory', id);
    renderInventoryPanel();
    renderSprayRows();
    toast('ลบรายการออกจากคลังแล้ว');
  }

  // ====== 3. บันทึกการให้น้ำและโซนวาล์ว ======
  function refreshIrrigationSelectors() {
    const sel = $('irr-plot-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = O.optionsHTML({ includeCommon: false, allowOrchardLevel: true });
    if (prev && Array.from(sel.options).some((x) => x.value === prev)) sel.value = prev;
    renderValveQuickChips();
  }

  function renderValveQuickChips() {
    const host = $('irr-valve-chips');
    if (!host) return;
    const resolved = O.resolve($('irr-plot-select')?.value || '');
    const plot = resolved.plotId ? O.getPlot(resolved.plotId) : null;
    const count = plot ? Math.min(36, Math.max(0, Math.round(C.num(plot.valveCount)))) : 0;
    if (!count) {
      host.innerHTML = '';
      return;
    }
    const buttons = [`<button type="button" class="saved-account-chip" onclick="pickIrrValve('ทุกวาล์ว (1-${count})')">เปิดครบทุกวาล์ว</button>`];
    for (let v = 1; v <= count; v++) {
      buttons.push(`<button type="button" class="saved-account-chip" onclick="pickIrrValve('วาล์ว ${v}')">วาล์ว ${v}</button>`);
    }
    host.innerHTML = buttons.join('');
  }

  function pickIrrValve(text) {
    const inp = $('irr-valve-input');
    if (!inp) return;
    if (!inp.value || inp.value.startsWith('ทุกวาล์ว') || text.startsWith('ทุกวาล์ว')) inp.value = text;
    else if (!inp.value.includes(text)) inp.value = inp.value + ', ' + text;
  }

  async function submitIrrigationForm(e) {
    if (e) e.preventDefault();
    const date = $('irr-date')?.value || getTodayISO();
    const target = O.resolve($('irr-plot-select')?.value || '');
    if (!target.orchardId && !target.plotId) {
      toast('กรุณาเลือกสวนหรือแปลงที่ให้น้ำ', 'error');
      return;
    }
    const durationHours = C.num($('irr-duration')?.value);
    const pumpHours = C.num($('irr-pump-hours')?.value || durationHours);
    if (durationHours <= 0 && pumpHours <= 0) {
      toast('กรุณาระบุชั่วโมงการให้น้ำหรือชั่วโมงปั๊มน้ำ', 'error');
      return;
    }
    const energyCost = Math.max(0, C.num($('irr-energy-cost')?.value));
    const irrId = O.newId('irr');
    const ledgerId = energyCost > 0 ? `acc-irr-${irrId}` : '';

    const doc = {
      id: irrId,
      date,
      orchardId: target.orchardId,
      plotId: target.plotId,
      plotName: target.label,
      valveZone: ($('irr-valve-input')?.value || '').trim() || 'ทั่วไป',
      durationHours,
      pumpHours,
      waterSource: $('irr-source')?.value || 'สระเก็บน้ำในสวน',
      energyCost,
      ledgerId,
      note: ($('irr-note')?.value || '').trim()
    };

    await AGRI_DATA.save('irrigations', doc);
    if (energyCost > 0 && typeof accEntries !== 'undefined') {
      const acc = {
        id: ledgerId,
        date,
        type: 'expense',
        plot: target.label,
        orchardId: target.orchardId,
        plotId: target.plotId,
        category: 'ค่าน้ำมันและค่าไฟ',
        detail: `ค่าเดินปั๊มน้ำ (${pumpHours} ชม. · ${doc.valveZone})${doc.note ? ' | ' + doc.note : ''}`,
        amount: energyCost,
        refType: 'irrigation',
        refId: irrId
      };
      accEntries.unshift(acc);
      if (typeof saveLocalData === 'function') saveLocalData();
      if (typeof syncSingleEntryToSheet === 'function') syncSingleEntryToSheet({ accEntry: acc });
      if (typeof renderAccEntries === 'function') renderAccEntries();
    }

    if ($('irr-note')) $('irr-note').value = '';
    if ($('irr-energy-cost')) $('irr-energy-cost').value = '';
    renderIrrigationHistory();
    toast(`บันทึกการให้น้ำแปลง "${target.label}" เรียบร้อย`);
  }

  function renderIrrigationHistory() {
    const tbody = $('irr-history-tbody');
    if (!tbody) return;
    const list = [...(AGRI_DATA.state.irrigations || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const totalPump = list.reduce((s, x) => s + C.num(x.pumpHours), 0);
    const sumEl = $('irr-sum-pump-hours');
    if (sumEl) sumEl.innerText = `${C.round2(totalPump).toLocaleString('th-TH')} ชั่วโมง`;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:22px;color:var(--slate-500);">ยังไม่มีประวัติการให้น้ำ</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map((x) => `
      <tr>
        <td data-label="วันที่">${O.esc(typeof formatDateSlashThai === 'function' ? formatDateSlashThai(x.date) : x.date)}</td>
        <td data-label="สวน / แปลง"><strong>${O.esc(x.plotName || '-')}</strong></td>
        <td data-label="โซนวาล์ว"><span class="badge-op">${O.esc(x.valveZone || '-')}</span></td>
        <td data-label="เวลาให้น้ำ">${C.num(x.durationHours)} ชม.</td>
        <td data-label="ชั่วโมงปั๊มน้ำ">${C.num(x.pumpHours)} ชม. (${O.esc(x.waterSource || '-')})</td>
        <td data-label="ค่าไฟ/น้ำมัน" style="text-align:right;font-weight:700;">${C.num(x.energyCost) > 0 ? formatMoney(x.energyCost) : '-'}</td>
        <td data-label="จัดการ" style="text-align:center;">
          <button type="button" class="btn-icon danger" onclick="deleteIrrigationLog('${O.esc(x.id)}')" title="ลบรายการ">🗑️</button>
        </td>
      </tr>
    `).join('');
  }

  async function deleteIrrigationLog(id) {
    if (!confirm('ลบประวัติการให้น้ำรายการนี้ใช่หรือไม่?')) return;
    await AGRI_DATA.remove('irrigations', id);
    if (typeof accEntries !== 'undefined') {
      const before = accEntries.length;
      for (let i = accEntries.length - 1; i >= 0; i--) {
        if (accEntries[i].refType === 'irrigation' && accEntries[i].refId === id) accEntries.splice(i, 1);
      }
      if (accEntries.length !== before && typeof saveLocalData === 'function') saveLocalData();
    }
    renderIrrigationHistory();
    toast('ลบรายการให้น้ำแล้ว');
  }

  function refreshAll() {
    const today = typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10);
    if ($('ops-spray-date') && !$('ops-spray-date').value) $('ops-spray-date').value = today;
    if ($('irr-date') && !$('irr-date').value) $('irr-date').value = today;
    refreshSprayTargetSelectors();
    renderSprayRows();
    renderSprayHistory();
    renderInventoryPanel();
    refreshIrrigationSelectors();
    renderIrrigationHistory();
  }

  O.onChange(() => { refreshSprayTargetSelectors(); refreshIrrigationSelectors(); });
  AGRI_DATA.onChange((_, reason) => {
    if (['inventory', 'sprays', 'irrigations', 'workspace', 'workspace-offline'].includes(reason)) {
      renderSprayRows();
      renderSprayHistory();
      renderInventoryPanel();
      renderIrrigationHistory();
    }
  });

  Object.assign(window, {
    openOpsTab,
    switchOpsSubTab,
    setSprayTankSize,
    renderSprayPlotCheckboxes,
    addSprayIngredientRow,
    removeSprayIngredientRow,
    onSprayItemPick,
    updateSprayRowField,
    recalcSprayBuilder,
    submitSprayCommit,
    removeSprayRecord,
    openPurchaseModal,
    closePurchaseModal,
    onPurchaseItemSelectChange,
    updatePurchaseTotalPreview,
    submitPurchaseForm,
    openInventoryItemModal,
    closeInventoryItemModal,
    saveInventoryItemForm,
    deleteInventoryItem,
    renderValveQuickChips,
    pickIrrValve,
    submitIrrigationForm,
    deleteIrrigationLog,
    refreshOpsAll: refreshAll
  });

  return { refreshAll, openOpsTab };
})();
