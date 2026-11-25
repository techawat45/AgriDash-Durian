/* ============================================================
   AgriDash Durian Pro - โมดูลบันทึกผลผลิตและการขายแยกเกรด (harvest.js)
   รองรับบันทึกตัดทุเรียนรายรอบ แยกเกรด AB / C / D / ตกไซส์-จัมโบ้ ตรวจระยะปลอดภัย และส่งรายรับเข้าสมุดบัญชีอัตโนมัติ
   ============================================================ */
const AGRI_HARVEST = (() => {
  const O = AGRI_ORCHARDS;
  const C = AGRI_CALC;
  const $ = (id) => document.getElementById(id);
  const toast = (msg, type) => (typeof showToast === 'function' ? showToast(msg, type || 'success') : alert(msg));

  const DEFAULT_GRADES = [
    { grade: 'เกรด AB', desc: 'ทรงสวย พูเต็ม น้ำหนักมาตรฐานส่งออก', fruitCount: '', kg: '', pricePerKg: 145 },
    { grade: 'เกรด C', desc: 'ทรงรอง พูขาดเล็กน้อย ตลาดในประเทศ', fruitCount: '', kg: '', pricePerKg: 115 },
    { grade: 'เกรด D', desc: 'ลูกเล็ก พูไม่เต็ม เนื้อดี', fruitCount: '', kg: '', pricePerKg: 85 },
    { grade: 'ตกไซส์/จัมโบ้', desc: 'ลูกใหญ่พิเศษ หรือตกไซส์/แกะเนื้อ', fruitCount: '', kg: '', pricePerKg: 70 }
  ];

  let gradeDraft = DEFAULT_GRADES.map((g) => ({ ...g }));

  function formatMoney(v) {
    return '฿' + C.num(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function refreshSelectors() {
    const plotSel = $('harv-plot');
    if (plotSel) {
      const prev = plotSel.value;
      plotSel.innerHTML = O.optionsHTML({
        includeAll: false,
        includeCommon: false,
        allowOrchardLevel: true
      });
      if (prev && Array.from(plotSel.options).some((op) => op.value === prev)) {
        plotSel.value = prev;
      }
    }

    const filterSel = $('harv-filter-scope');
    if (filterSel) {
      const prevF = filterSel.value || 'all';
      filterSel.innerHTML = O.optionsHTML({
        includeAll: true,
        allLabel: 'ทุกสวนและทุกแปลง',
        includeCommon: false,
        allowOrchardLevel: true
      });
      if (Array.from(filterSel.options).some((op) => op.value === prevF)) {
        filterSel.value = prevF;
      }
    }

    onTargetPlotChange(true);
  }

  function onTargetPlotChange(silentVariety) {
    const target = O.resolve($('harv-plot')?.value || '');
    if (!silentVariety && target.plotId) {
      const plot = O.getPlot(target.plotId);
      const varSel = $('harv-variety');
      if (plot && plot.mainVariety && varSel) {
        const match = Array.from(varSel.options).some((op) => op.value === plot.mainVariety);
        if (match) varSel.value = plot.mainVariety;
      }
    }
    // คำนวณรอบตัดถัดไปของแปลงให้อัตโนมัติ
    const roundEl = $('harv-round');
    if (roundEl && (target.plotId || target.orchardId)) {
      const existingRounds = (AGRI_DATA.state.harvests || []).filter((h) =>
        target.plotId ? h.plotId === target.plotId : h.orchardId === target.orchardId
      );
      roundEl.value = existingRounds.length + 1;
    }
    checkHarvestPhiSafety();
  }

  function findActivePhiConflicts() {
    const harvDate = $('harv-date')?.value || (typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10));
    const target = O.resolve($('harv-plot')?.value || '');
    const sprays = AGRI_DATA.state.sprays || [];
    return sprays.filter((s) => {
      if (!s.phiUntil || s.phiUntil < harvDate) return false;
      if (target.plotId) {
        if (Array.isArray(s.plotIds) && s.plotIds.includes(target.plotId)) return true;
        if ((!s.plotIds || !s.plotIds.length) && s.orchardId && s.orchardId === target.orchardId) return true;
        return false;
      }
      if (target.orchardId) {
        return s.orchardId === target.orchardId;
      }
      return true;
    });
  }

  function checkHarvestPhiSafety() {
    const box = $('harv-phi-alert');
    if (!box) return;
    const conflicts = findActivePhiConflicts();
    if (!conflicts.length) {
      box.className = 'phi-banner clear';
      box.style.marginBottom = '18px';
      box.innerHTML = `
        <div style="font-size:1.35rem;line-height:1.1;">✅</div>
        <div style="flex:1;">
          <div style="font-weight:800;font-size:0.95rem;">ระยะปลอดภัยผ่านเกณฑ์ พร้อมตัดเก็บเกี่ยวผลผลิต</div>
          <div style="font-size:0.84rem;opacity:0.9;">ไม่พบประวัติพ่นสารเคมีที่ยังติดระยะเว้นเก็บเกี่ยวในแปลงและวันที่เลือก</div>
        </div>
      `;
      return;
    }

    const latest = [...conflicts].sort((a, b) => String(b.phiUntil).localeCompare(String(a.phiUntil)))[0];
    const untilTxt = typeof formatDateSlashThai === 'function' ? formatDateSlashThai(latest.phiUntil) : latest.phiUntil;
    const spDateTxt = typeof formatDateSlashThai === 'function' ? formatDateSlashThai(latest.date) : latest.date;
    const chemNames = (latest.ingredients || []).filter((i) => C.num(i.phiDays) > 0).map((i) => i.name).join(', ') || 'สารเคมีเกษตร';

    box.className = 'weather-alert-card danger';
    box.style.marginBottom = '18px';
    box.innerHTML = `
      <div style="font-size:1.6rem;line-height:1.1;">🛡️</div>
      <div style="flex:1;">
        <div style="font-weight:800;font-size:0.98rem;">แจ้งเตือนระยะปลอดภัยก่อนเก็บเกี่ยว: ห้ามตัดก่อนวันที่ ${O.esc(untilTxt)}</div>
        <div style="font-size:0.86rem;margin-top:3px;">แปลงนี้มีบันทึกพ่น <strong>${O.esc(chemNames)}</strong> เมื่อวันที่ ${O.esc(spDateTxt)} เสี่ยงสารตกค้างในเนื้อทุเรียน</div>
      </div>
    `;
  }

  function renderGradeRows() {
    const host = $('harv-grades-body');
    if (!host) return;
    host.innerHTML = gradeDraft.map((g, idx) => `
      <div class="grade-row-card">
        <div class="grade-row-head">
          <div>
            <span class="grade-badge grade-badge-${idx}">${O.esc(g.grade)}</span>
            <span class="grade-desc">${O.esc(g.desc)}</span>
          </div>
          <div class="grade-subtotal-chip">
            <span id="harv-row-share-${idx}" style="font-size:0.78rem;color:var(--slate-500);margin-right:6px;">0%</span>
            <strong id="harv-row-amt-${idx}" style="color:var(--emerald-800);font-size:1rem;">฿0.00</strong>
          </div>
        </div>
        <div class="grade-input-grid">
          <div>
            <span class="purchase-field-label">จำนวนผล (ลูก)</span>
            <input type="number" min="0" step="1" class="form-control" placeholder="0" value="${O.esc(g.fruitCount)}" oninput="onHarvestGradeInput(${idx}, 'fruitCount', this.value)" />
          </div>
          <div>
            <span class="purchase-field-label">น้ำหนักชั่งได้ (กิโลกรัม)</span>
            <input type="number" min="0" step="0.1" class="form-control" placeholder="0.0" value="${O.esc(g.kg)}" oninput="onHarvestGradeInput(${idx}, 'kg', this.value)" />
          </div>
          <div>
            <span class="purchase-field-label">ราคาขายต่อกิโลกรัม (บาท)</span>
            <input type="number" min="0" step="0.5" class="form-control" placeholder="0.00" value="${O.esc(g.pricePerKg)}" oninput="onHarvestGradeInput(${idx}, 'pricePerKg', this.value)" />
          </div>
        </div>
      </div>
    `).join('');
    recalcHarvestLive();
  }

  function onHarvestGradeInput(idx, field, val) {
    if (!gradeDraft[idx]) return;
    gradeDraft[idx][field] = val;
    recalcHarvestLive();
  }

  function getCurrentSummary() {
    const harvestCost = C.num($('harv-cost')?.value);
    return C.calcHarvestSummary(gradeDraft, harvestCost);
  }

  function recalcHarvestLive() {
    const sum = getCurrentSummary();
    sum.grades.forEach((r, idx) => {
      const amtEl = $(`harv-row-amt-${idx}`);
      const shEl = $(`harv-row-share-${idx}`);
      if (amtEl) amtEl.innerText = formatMoney(r.amount);
      if (shEl) shEl.innerText = `สัดส่วน ${r.sharePct}%`;
    });

    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };
    set('harv-sum-kg', `${sum.totalKg.toLocaleString('th-TH', { maximumFractionDigits: 2 })} กก.`);
    set('harv-sum-fruits', `รวม ${sum.totalFruits.toLocaleString('th-TH')} ลูก`);
    set('harv-sum-avg-price', `${formatMoney(sum.avgPricePerKg)}/กก.`);
    set('harv-sum-gross', formatMoney(sum.grossRevenue));
    set('harv-sum-net', formatMoney(sum.netRevenue));
  }

  async function submitHarvestForm(e) {
    if (e) e.preventDefault();
    const target = O.resolve($('harv-plot')?.value || '');
    if (!target.orchardId && !target.plotId) {
      toast('กรุณาสร้างและเลือกสวนหรือแปลงที่เก็บเกี่ยวก่อนบันทึก', 'error');
      return;
    }

    const sum = getCurrentSummary();
    if (sum.totalKg <= 0) {
      toast('กรุณากรอกน้ำหนักทุเรียนอย่างน้อย 1 เกรดให้มากกว่า 0 กิโลกรัม', 'error');
      return;
    }

    const conflicts = findActivePhiConflicts();
    if (conflicts.length) {
      const latest = [...conflicts].sort((a, b) => String(b.phiUntil).localeCompare(String(a.phiUntil)))[0];
      const untilTxt = typeof formatDateSlashThai === 'function' ? formatDateSlashThai(latest.phiUntil) : latest.phiUntil;
      if (!confirm(`⚠️ แปลงนี้ยังติดระยะปลอดภัยหลังพ่นสารเคมีจนถึงวันที่ ${untilTxt}\nยืนยันต้องการบันทึกการตัดผลผลิตในวันนี้หรือไม่?`)) {
        return;
      }
    }

    const date = $('harv-date')?.value || (typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10));
    const roundNo = Math.max(1, Math.round(C.num($('harv-round')?.value) || 1));
    const variety = $('harv-variety')?.value || 'หมอนทอง';
    const buyer = ($('harv-buyer')?.value || '').trim();
    const note = ($('harv-note')?.value || '').trim();
    const postToLedger = $('harv-post-ledger')?.checked !== false;

    const btn = $('harv-submit-btn');
    if (btn) btn.classList.add('loading');
    try {
      const res = await AGRI_DATA.commitHarvest({
        id: O.newId('harv'),
        date,
        roundNo,
        orchardId: target.orchardId,
        plotId: target.plotId,
        plotName: target.label,
        variety,
        buyer,
        grades: sum.grades,
        harvestCost: sum.harvestCost,
        postToLedger,
        note
      });

      if (res.ledgerEntry && typeof syncSingleEntryToSheet === 'function') {
        syncSingleEntryToSheet({ accEntry: res.ledgerEntry });
      }
      if (res.costLedgerEntry && typeof syncSingleEntryToSheet === 'function') {
        syncSingleEntryToSheet({ accEntry: res.costLedgerEntry });
      }

      // ล้างเฉพาะช่องจำนวนลูก น้ำหนัก ค่าตัด และหมายเหตุ คงราคาต่อกิโลไว้ให้กรอกรอบถัดไปได้รวดเร็ว
      gradeDraft = gradeDraft.map((g) => ({ ...g, fruitCount: '', kg: '' }));
      if ($('harv-cost')) $('harv-cost').value = '';
      if ($('harv-note')) $('harv-note').value = '';

      renderGradeRows();
      onTargetPlotChange(true);
      renderSeasonKPIsAndHistory();

      toast(res.queued
        ? `บันทึกผลผลิต ${sum.totalKg.toLocaleString('th-TH')} กก. ในเครื่องแล้ว (รอซิงค์คลาวด์เมื่อมีสัญญาณ)`
        : `บันทึกขายทุเรียน ${sum.totalKg.toLocaleString('th-TH')} กก. ยอดรวม ${formatMoney(sum.grossRevenue)} เข้าสมุดบัญชีเรียบร้อย!`);
    } catch (err) {
      toast('บันทึกผลผลิตไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      if (btn) btn.classList.remove('loading');
    }
  }

  function getFilteredHarvests() {
    const scope = $('harv-filter-scope')?.value || 'all';
    return [...(AGRI_DATA.state.harvests || [])]
      .filter((h) => {
        if (h.deletedAt) return false;
        if (scope === 'all') return true;
        if (scope.startsWith('p:')) return h.plotId === scope.slice(2);
        if (scope.startsWith('o:')) return h.orchardId === scope.slice(2);
        return true;
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function renderSeasonKPIsAndHistory() {
    const list = getFilteredHarvests();
    let seasonKg = 0;
    let seasonFruits = 0;
    let seasonGross = 0;
    let seasonNet = 0;
    let abKg = 0;

    list.forEach((h) => {
      seasonKg += C.num(h.totalKg);
      seasonFruits += C.num(h.totalFruits);
      seasonGross += C.num(h.grossRevenue);
      seasonNet += C.num(h.netRevenue ?? h.grossRevenue);
      (h.grades || []).forEach((g) => {
        if (String(g.grade || '').includes('AB')) abKg += C.num(g.kg);
      });
    });

    const avgPrice = seasonKg > 0 ? C.round2(seasonGross / seasonKg) : 0;
    const abPct = seasonKg > 0 ? C.round2((abKg / seasonKg) * 100) : 0;

    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };
    set('harv-kpi-season-kg', `${C.round2(seasonKg).toLocaleString('th-TH')} กก.`);
    set('harv-kpi-season-fruits', `รวม ${seasonFruits.toLocaleString('th-TH')} ลูก (${list.length} รอบตัด)`);
    set('harv-kpi-season-rev', formatMoney(seasonGross));
    set('harv-kpi-season-net', `รายได้สุทธิหลังหักค่าตัด ${formatMoney(seasonNet)}`);
    set('harv-kpi-season-avg', `${formatMoney(avgPrice)}/กก.`);
    set('harv-kpi-ab-share', `สัดส่วนเกรด AB ${abPct}% (${C.round2(abKg).toLocaleString('th-TH')} กก.)`);

    const tbody = $('harv-history-tbody');
    if (!tbody) return;
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:26px;color:var(--slate-500);font-weight:600;">ยังไม่มีประวัติการเก็บเกี่ยวและขายทุเรียนตามขอบเขตที่เลือก</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((h) => {
      const gradeBreakdown = (h.grades || [])
        .filter((g) => C.num(g.kg) > 0)
        .map((g) => `${g.grade}: ${C.num(g.kg).toLocaleString('th-TH')} กก. (@฿${C.num(g.pricePerKg)})`)
        .join(' · ');
      return `
        <tr>
          <td data-label="วันที่ตัด" style="white-space:nowrap;font-weight:700;">${O.esc(typeof formatDateSlashThai === 'function' ? formatDateSlashThai(h.date) : h.date)}</td>
          <td data-label="สวน / แปลง">
            <strong>${O.esc(h.plotName || O.entryLabel(h) || '-')}</strong>
            <div style="font-size:0.78rem;color:var(--emerald-700);font-weight:700;">รอบที่ ${C.num(h.roundNo || 1)} · พันธุ์${O.esc(h.variety || 'หมอนทอง')}</div>
          </td>
          <td data-label="ผู้รับซื้อ / ล้ง">${O.esc(h.buyer || '-')}</td>
          <td data-label="รายละเอียดคัดเกรด" style="font-size:0.84rem;color:var(--slate-700);">${O.esc(gradeBreakdown || '-')}</td>
          <td data-label="น้ำหนักรวม" style="text-align:right;font-weight:800;">
            ${C.num(h.totalKg).toLocaleString('th-TH')} กก.
            ${C.num(h.totalFruits) > 0 ? `<div style="font-size:0.75rem;color:var(--slate-500);">${C.num(h.totalFruits).toLocaleString('th-TH')} ลูก</div>` : ''}
          </td>
          <td data-label="เฉลี่ย/กก." style="text-align:right;font-weight:700;">${formatMoney(h.avgPricePerKg)}</td>
          <td data-label="รายได้รวม" style="text-align:right;font-weight:800;color:var(--emerald-700);font-size:1rem;">+${formatMoney(h.grossRevenue)}</td>
          <td data-label="จัดการ" style="text-align:center;">
            <button type="button" class="btn-icon danger" title="ลบรายการและย้อนยอดสมุดบัญชี" onclick="removeHarvestRecord('${O.esc(h.id)}')">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function removeHarvestRecord(id) {
    if (!confirm('ลบรายการเก็บเกี่ยวรอบนี้? ระบบจะลบยอดรายรับที่ผูกไว้ในสมุดบัญชีและคำนวณจุดคุ้มทุนใหม่ให้อัตโนมัติ')) return;
    await AGRI_DATA.deleteHarvest(id);
    renderSeasonKPIsAndHistory();
    toast('ลบรายการเก็บเกี่ยวและปรับปรุงสมุดบัญชีแล้ว');
  }

  function exportHarvestCSV() {
    const list = getFilteredHarvests();
    const header = [
      'วันที่ตัด', 'รอบที่', 'สวนและแปลง', 'สายพันธุ์', 'ล้ง/ผู้รับซื้อ',
      'เกรด AB (กก.)', 'เกรด C (กก.)', 'เกรด D (กก.)', 'ตกไซส์/จัมโบ้ (กก.)',
      'จำนวนลูกรวม', 'น้ำหนักรวม (กก.)', 'ราคาเฉลี่ย (บาท/กก.)', 'รายได้รวม (บาท)', 'ค่าตัด (บาท)', 'รายได้สุทธิ (บาท)'
    ];
    const rows = [header];
    list.forEach((h) => {
      const findKg = (key) => {
        const g = (h.grades || []).find((x) => String(x.grade || '').includes(key));
        return g ? C.num(g.kg) : 0;
      };
      rows.push([
        typeof formatDateSlashThai === 'function' ? formatDateSlashThai(h.date) : h.date,
        C.num(h.roundNo || 1),
        h.plotName || O.entryLabel(h) || '',
        h.variety || '',
        h.buyer || '',
        findKg('AB'),
        findKg('เกรด C'),
        findKg('เกรด D'),
        findKg('ตกไซส์'),
        C.num(h.totalFruits),
        C.num(h.totalKg),
        C.num(h.avgPricePerKg).toFixed(2),
        C.num(h.grossRevenue).toFixed(2),
        C.num(h.harvestCost).toFixed(2),
        C.num(h.netRevenue ?? h.grossRevenue).toFixed(2)
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `รายงานผลผลิตทุเรียนแยกเกรด_${typeof getTodayISO === 'function' ? getTodayISO() : 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('ส่งออกรายงานผลผลิตไฟล์ CSV เรียบร้อยแล้ว');
  }

  function refreshAll() {
    const today = typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10);
    if ($('harv-date') && !$('harv-date').value) $('harv-date').value = today;
    refreshSelectors();
    renderGradeRows();
    renderSeasonKPIsAndHistory();
  }

  O.onChange(refreshSelectors);
  AGRI_DATA.onChange((_, reason) => {
    if (['harvests', 'sprays', 'workspace', 'workspace-offline'].includes(reason)) {
      checkHarvestPhiSafety();
      renderSeasonKPIsAndHistory();
    }
  });

  Object.assign(window, {
    onHarvestPlotChange: () => onTargetPlotChange(false),
    onHarvestDateChange: () => {
      if (typeof updateAllThaiDateBadges === 'function') updateAllThaiDateBadges();
      checkHarvestPhiSafety();
    },
    onHarvestGradeInput,
    recalcHarvestLive,
    submitHarvestForm,
    removeHarvestRecord,
    onHarvestFilterChange: renderSeasonKPIsAndHistory,
    exportHarvestCSV,
    refreshHarvestAll: refreshAll
  });

  return { refreshAll, renderSeasonKPIsAndHistory };
})();
