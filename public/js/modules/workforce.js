/* ============================================================
   AgriDash Durian Pro - โมดูลบริหารแรงงานและค่าจ้างคนงาน (workforce.js)
   รองรับพนักงานรายเดือน แรงงานรายวัน เหมาถังพ่น/เหมากิโล เบิกล่วงหน้า และสรุปจ่ายลงสมุดบัญชี
   ============================================================ */
const AGRI_WORKFORCE = (() => {
  const O = AGRI_ORCHARDS;
  const C = AGRI_CALC;
  const $ = (id) => document.getElementById(id);
  const toast = (msg, type) => (typeof showToast === 'function' ? showToast(msg, type || 'success') : alert(msg));

  const TYPE_LABELS = {
    monthly: 'พนักงานประจำรายเดือน',
    daily: 'แรงงานรายวัน',
    piece: 'แรงงานเหมาจ่าย'
  };

  let activeTab = 'worklog'; // 'worklog' | 'payroll' | 'workers'

  function formatMoney(v) {
    return '฿' + C.num(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function switchWorkforceTab(tab) {
    activeTab = tab;
    ['worklog', 'payroll', 'workers'].forEach((t) => {
      $('wf-panel-' + t)?.classList.toggle('hidden', t !== tab);
      $('wf-tab-' + t)?.classList.toggle('active', t === tab);
    });
    refreshAll();
  }

  // ====== 1. ทะเบียนคนงาน ======
  function openWorkerModal(workerId) {
    const w = workerId ? (AGRI_DATA.state.workers || []).find((x) => x.id === workerId) : null;
    $('wf-modal-title').innerText = w ? '✏️ แก้ไขข้อมูลคนงาน' : '➕ เพิ่มคนงานใหม่';
    $('wf-edit-id').value = w ? w.id : '';
    $('wf-edit-name').value = w ? w.name : '';
    $('wf-edit-nick').value = w ? (w.nickname || '') : '';
    $('wf-edit-type').value = w ? (w.workerType || 'daily') : 'daily';
    $('wf-edit-rate').value = w ? C.num(w.baseRate) : 400;
    $('wf-edit-ot').value = w ? C.num(w.otHourlyRate) : 60;
    $('wf-edit-phone').value = w ? (w.phone || '') : '';
    $('wf-edit-role').value = w ? (w.role || '') : '';
    onWorkerTypeSelectChange();
    $('wf-worker-modal')?.classList.remove('hidden');
  }

  function closeWorkerModal(e) {
    if (e && e.target !== e.currentTarget) return;
    $('wf-worker-modal')?.classList.add('hidden');
  }

  function onWorkerTypeSelectChange() {
    const t = $('wf-edit-type')?.value || 'daily';
    const lbl = $('wf-rate-label');
    if (!lbl) return;
    if (t === 'monthly') lbl.innerText = 'เงินเดือนประจำ (บาท/เดือน)';
    else if (t === 'piece') lbl.innerText = 'อัตราค่าแรงเหมาเริ่มต้น (บาท/หน่วย)';
    else lbl.innerText = 'ค่าแรงมาตรฐาน (บาท/วัน)';
  }

  async function saveWorkerForm(e) {
    if (e) e.preventDefault();
    const name = ($('wf-edit-name')?.value || '').trim();
    if (!name) { toast('กรุณาระบุชื่อคนงาน', 'error'); return; }
    const existing = $('wf-edit-id')?.value
      ? (AGRI_DATA.state.workers || []).find((x) => x.id === $('wf-edit-id').value)
      : null;
    const doc = {
      id: existing ? existing.id : O.newId('wrk'),
      name,
      nickname: ($('wf-edit-nick')?.value || '').trim(),
      workerType: $('wf-edit-type')?.value || 'daily',
      baseRate: Math.max(0, C.num($('wf-edit-rate')?.value)),
      otHourlyRate: Math.max(0, C.num($('wf-edit-ot')?.value)),
      phone: ($('wf-edit-phone')?.value || '').trim(),
      role: ($('wf-edit-role')?.value || '').trim(),
      active: existing ? existing.active !== false : true
    };
    await AGRI_DATA.save('workers', doc);
    closeWorkerModal();
    refreshAll();
    toast('บันทึกข้อมูลคนงานเรียบร้อย');
  }

  async function toggleWorkerActive(id) {
    const w = (AGRI_DATA.state.workers || []).find((x) => x.id === id);
    if (!w) return;
    await AGRI_DATA.save('workers', { ...w, active: w.active === false });
    refreshAll();
    toast(w.active === false ? 'เปิดสถานะคนงานแล้ว' : 'พักสถานะคนงานแล้ว');
  }

  async function deleteWorker(id) {
    const w = (AGRI_DATA.state.workers || []).find((x) => x.id === id);
    if (!w || !confirm(`ลบ "${w.name}" ออกจากทะเบียนคนงาน? (ประวัติการจ่ายเงินเดิมยังเก็บรักษาไว้)`)) return;
    await AGRI_DATA.remove('workers', id);
    refreshAll();
    toast('ลบข้อมูลคนงานแล้ว');
  }

  function renderWorkersTable() {
    const tbody = $('wf-workers-tbody');
    if (!tbody) return;
    const workers = AGRI_DATA.state.workers || [];
    if (!workers.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--slate-500);">ยังไม่มีรายชื่อคนงาน — กดปุ่ม "เพิ่มคนงานใหม่" ด้านบนเพื่อเริ่มต้น</td></tr>`;
      return;
    }
    tbody.innerHTML = workers.map((w) => {
      const unsettled = (AGRI_DATA.state.advances || [])
        .filter((a) => !a.settled && a.workerId === w.id)
        .reduce((s, a) => s + C.num(a.amount), 0);
      const unitTxt = w.workerType === 'monthly' ? '/เดือน' : (w.workerType === 'piece' ? '/หน่วย' : '/วัน');
      return `
        <tr class="${w.active === false ? 'row-inactive' : ''}">
          <td data-label="ชื่อคนงาน">
            <strong>${O.esc(w.name)}</strong>${w.nickname ? ` (${O.esc(w.nickname)})` : ''}
            ${w.active === false ? ' <span class="badge-muted">พักงาน</span>' : ''}
          </td>
          <td data-label="ประเภทการจ้าง">${O.esc(TYPE_LABELS[w.workerType] || 'แรงงานรายวัน')}</td>
          <td data-label="อัตราค่าจ้าง"><strong>${formatMoney(w.baseRate)}</strong>${unitTxt}</td>
          <td data-label="ค่าโอที">${formatMoney(w.otHourlyRate)}/ชม.</td>
          <td data-label="เบิกค้างหัก" style="color:${unsettled > 0 ? 'var(--rose-600)' : 'var(--slate-500)'};font-weight:700;">${unsettled > 0 ? formatMoney(unsettled) : '-'}</td>
          <td data-label="เบอร์โทร / หน้าที่">${O.esc([w.role, w.phone].filter(Boolean).join(' · ') || '-')}</td>
          <td data-label="จัดการ" style="white-space:nowrap;">
            <button type="button" class="btn-icon" title="แก้ไข" onclick="openWorkerModal('${O.esc(w.id)}')">✏️</button>
            <button type="button" class="btn-icon" title="${w.active === false ? 'เปิดใช้งาน' : 'พักงาน'}" onclick="toggleWorkerActive('${O.esc(w.id)}')">${w.active === false ? '▶️' : '⏸️'}</button>
            <button type="button" class="btn-icon danger" title="ลบ" onclick="deleteWorker('${O.esc(w.id)}')">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ====== 2. บันทึกการทำงานรายวัน / เหมาจ่าย และเบิกเงินล่วงหน้า ======
  function refreshSelectors() {
    const activeWorkers = (AGRI_DATA.state.workers || []).filter((w) => w.active !== false);
    const workerOpts = activeWorkers.length
      ? activeWorkers.map((w) => `<option value="${O.esc(w.id)}">👷 ${O.esc(w.name)} (${O.esc(TYPE_LABELS[w.workerType] || '')})</option>`).join('')
      : `<option value="">— กรุณาเพิ่มคนงานก่อน —</option>`;

    ['wl-worker', 'adv-worker'].forEach((id) => {
      const sel = $(id);
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = workerOpts;
      if (prev && Array.from(sel.options).some((x) => x.value === prev)) sel.value = prev;
    });

    ['wl-plot', 'pay-target-plot'].forEach((id) => {
      const sel = $(id);
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = O.optionsHTML({ includeCommon: true, allowOrchardLevel: true });
      if (prev && Array.from(sel.options).some((x) => x.value === prev)) sel.value = prev;
    });

    onWorkLogInputChange();
  }

  function onWorkLogInputChange() {
    const payMode = $('wl-paymode')?.value || 'attendance';
    const isAtt = payMode === 'attendance';
    $('wl-attendance-box')?.classList.toggle('hidden', !isAtt);
    $('wl-piece-box')?.classList.toggle('hidden', isAtt);

    const qtyLbl = $('wl-piece-qty-label');
    const rateLbl = $('wl-piece-rate-label');
    if (payMode === 'piece_tank') {
      if (qtyLbl) qtyLbl.innerText = 'จำนวนถังที่พ่น (ถัง)';
      if (rateLbl) rateLbl.innerText = 'อัตราค่าแรงเหมาต่อถัง (บาท/ถัง)';
      $('wl-piece-qty-wrap')?.classList.remove('hidden');
    } else if (payMode === 'piece_kg') {
      if (qtyLbl) qtyLbl.innerText = 'น้ำหนักทุเรียนที่ตัด/คัด (กิโลกรัม)';
      if (rateLbl) rateLbl.innerText = 'อัตราเหมาต่อกิโลกรัม (บาท/กก.)';
      $('wl-piece-qty-wrap')?.classList.remove('hidden');
    } else if (payMode === 'piece_flat') {
      if (rateLbl) rateLbl.innerText = 'ยอดค่าจ้างเหมารวมงานนี้ (บาท)';
      $('wl-piece-qty-wrap')?.classList.add('hidden');
    }

    const worker = (AGRI_DATA.state.workers || []).find((w) => w.id === $('wl-worker')?.value) || {};
    const draft = {
      payMode,
      dayFraction: C.num($('wl-day-fraction')?.value ?? 1),
      otHours: C.num($('wl-ot-hours')?.value),
      pieceQty: C.num($('wl-piece-qty')?.value),
      pieceRate: C.num($('wl-piece-rate')?.value)
    };
    const amt = C.calcWorkLogAmount(draft, worker);
    const prevEl = $('wl-amount-preview');
    if (prevEl) {
      prevEl.innerText = worker.workerType === 'monthly' && isAtt
        ? `${formatMoney(amt)} (เฉพาะโอที · เงินเดือนคิดตอนสรุปงวด)`
        : formatMoney(amt);
    }
  }

  async function submitWorkLogForm(e) {
    if (e) e.preventDefault();
    const workerId = $('wl-worker')?.value || '';
    const worker = (AGRI_DATA.state.workers || []).find((w) => w.id === workerId);
    if (!worker) { toast('กรุณาเพิ่มและเลือกคนงานก่อนบันทึกงาน', 'error'); return; }

    const payMode = $('wl-paymode')?.value || 'attendance';
    const target = O.resolve($('wl-plot')?.value || 'common');
    const draft = {
      payMode,
      dayFraction: C.num($('wl-day-fraction')?.value ?? 1),
      otHours: C.num($('wl-ot-hours')?.value),
      pieceQty: C.num($('wl-piece-qty')?.value),
      pieceRate: C.num($('wl-piece-rate')?.value)
    };
    if ((payMode === 'piece_tank' || payMode === 'piece_kg') && draft.pieceQty <= 0) {
      toast('กรุณาระบุจำนวนถังหรือน้ำหนักกิโลกรัม', 'error');
      return;
    }

    const amount = C.calcWorkLogAmount(draft, worker);
    const doc = {
      id: O.newId('wl'),
      date: $('wl-date')?.value || getTodayISO(),
      workerId: worker.id,
      workerName: worker.name,
      orchardId: target.orchardId,
      plotId: target.plotId,
      plotName: target.label,
      taskType: $('wl-task')?.value || 'งานทั่วไป',
      payMode,
      dayFraction: draft.dayFraction,
      otHours: draft.otHours,
      pieceQty: draft.pieceQty,
      pieceRate: draft.pieceRate,
      amount,
      paid: false,
      note: ($('wl-note')?.value || '').trim()
    };

    await AGRI_DATA.save('work-logs', doc);
    if ($('wl-note')) $('wl-note').value = '';
    if ($('wl-ot-hours')) $('wl-ot-hours').value = 0;
    renderWorkLogsAndAdvances();
    renderPayrollSummary();
    toast(`บันทึกการทำงานของ ${worker.name} เรียบร้อย`);
  }

  async function deleteWorkLog(id) {
    if (!confirm('ลบรายการบันทึกการทำงานนี้ใช่หรือไม่?')) return;
    await AGRI_DATA.remove('work-logs', id);
    renderWorkLogsAndAdvances();
    renderPayrollSummary();
    toast('ลบรายการทำงานแล้ว');
  }

  async function submitAdvanceForm(e) {
    if (e) e.preventDefault();
    const workerId = $('adv-worker')?.value || '';
    const worker = (AGRI_DATA.state.workers || []).find((w) => w.id === workerId);
    if (!worker) { toast('กรุณาเลือกคนงานที่เบิกเงินล่วงหน้า', 'error'); return; }
    const amount = C.num($('adv-amount')?.value);
    if (amount <= 0) { toast('กรุณาระบุยอดเงินเบิกล่วงหน้าให้มากกว่า 0 บาท', 'error'); return; }

    const doc = {
      id: O.newId('adv'),
      date: $('adv-date')?.value || getTodayISO(),
      workerId: worker.id,
      workerName: worker.name,
      amount,
      reason: ($('adv-reason')?.value || '').trim() || 'เบิกล่วงหน้า',
      settled: false
    };
    await AGRI_DATA.save('advances', doc);
    if ($('adv-amount')) $('adv-amount').value = '';
    if ($('adv-reason')) $('adv-reason').value = '';
    renderWorkLogsAndAdvances();
    renderWorkersTable();
    renderPayrollSummary();
    toast(`บันทึกเบิกเงินล่วงหน้า ${worker.name} จำนวน ${formatMoney(amount)} เรียบร้อย`);
  }

  async function deleteAdvance(id) {
    if (!confirm('ลบรายการเบิกเงินล่วงหน้านี้ใช่หรือไม่?')) return;
    await AGRI_DATA.remove('advances', id);
    renderWorkLogsAndAdvances();
    renderWorkersTable();
    renderPayrollSummary();
    toast('ลบรายการเบิกล่วงหน้าแล้ว');
  }

  function describeWorkMode(l) {
    if (l.payMode === 'piece_tank') return `เหมาพ่น ${C.num(l.pieceQty)} ถัง (@฿${C.num(l.pieceRate)})`;
    if (l.payMode === 'piece_kg') return `เหมาตัด/คัด ${C.num(l.pieceQty)} กก. (@฿${C.num(l.pieceRate)})`;
    if (l.payMode === 'piece_flat') return `เหมางาน`;
    const dTxt = C.num(l.dayFraction) === 0.5 ? 'ครึ่งวัน' : (C.num(l.dayFraction) === 0 ? 'เฉพาะโอที' : 'เต็มวัน');
    return dTxt + (C.num(l.otHours) > 0 ? ` + โอที ${C.num(l.otHours)} ชม.` : '');
  }

  function renderWorkLogsAndAdvances() {
    const wlBody = $('wf-worklogs-tbody');
    if (wlBody) {
      const logs = [...(AGRI_DATA.state.workLogs || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 80);
      wlBody.innerHTML = logs.length ? logs.map((l) => `
        <tr>
          <td data-label="วันที่">${O.esc(typeof formatDateSlashThai === 'function' ? formatDateSlashThai(l.date) : l.date)}</td>
          <td data-label="คนงาน"><strong>${O.esc(l.workerName || '-')}</strong></td>
          <td data-label="สวน / แปลง">${O.esc(l.plotName || '-')}</td>
          <td data-label="งานที่ทำ"><span class="badge-op">${O.esc(l.taskType || '-')}</span></td>
          <td data-label="รายละเอียดเวลา/เหมา" style="font-size:0.84rem;">${O.esc(describeWorkMode(l))}</td>
          <td data-label="ค่าแรง" style="text-align:right;font-weight:800;">${formatMoney(l.amount)}</td>
          <td data-label="สถานะ">${l.paid ? '<span class="badge-income">จ่ายแล้ว</span>' : '<span class="badge-guest">รอสรุปจ่าย</span>'}</td>
          <td data-label="จัดการ" style="text-align:center;">
            ${l.paid ? '-' : `<button type="button" class="btn-icon danger" onclick="deleteWorkLog('${O.esc(l.id)}')">🗑️</button>`}
          </td>
        </tr>
      `).join('') : `<tr><td colspan="8" style="text-align:center;padding:22px;color:var(--slate-500);">ยังไม่มีประวัติการเช็กชื่อหรือบันทึกงาน</td></tr>`;
    }

    const advBody = $('wf-advances-tbody');
    if (advBody) {
      const advs = [...(AGRI_DATA.state.advances || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 60);
      advBody.innerHTML = advs.length ? advs.map((a) => `
        <tr>
          <td data-label="วันที่เบิก">${O.esc(typeof formatDateSlashThai === 'function' ? formatDateSlashThai(a.date) : a.date)}</td>
          <td data-label="คนงาน"><strong>${O.esc(a.workerName || '-')}</strong></td>
          <td data-label="รายการ">${O.esc(a.reason || 'เบิกล่วงหน้า')}</td>
          <td data-label="จำนวนเงิน" style="text-align:right;font-weight:800;color:var(--rose-600);">${formatMoney(a.amount)}</td>
          <td data-label="สถานะ">${a.settled ? '<span class="badge-income">หักแล้ว</span>' : '<span class="badge-expense">ค้างหัก</span>'}</td>
          <td data-label="จัดการ" style="text-align:center;">
            ${a.settled ? '-' : `<button type="button" class="btn-icon danger" onclick="deleteAdvance('${O.esc(a.id)}')">🗑️</button>`}
          </td>
        </tr>
      `).join('') : `<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--slate-500);">ยังไม่มีรายการเบิกเงินล่วงหน้า</td></tr>`;
    }
  }

  // ====== 3. สรุปงวดจ่ายเงินเดือนและค่าแรง ======
  function renderPayrollSummary() {
    const start = $('pay-period-start')?.value || '';
    const end = $('pay-period-end')?.value || '';
    const tbody = $('wf-payroll-calc-tbody');
    if (!tbody) return;

    const workers = (AGRI_DATA.state.workers || []).filter((w) => w.active !== false);
    let sumGross = 0, sumAdv = 0, sumNet = 0;

    const rows = workers.map((w) => {
      const logs = (AGRI_DATA.state.workLogs || []).filter((l) =>
        !l.paid && l.workerId === w.id &&
        (!start || l.date >= start) &&
        (!end || l.date <= end)
      );
      const advs = (AGRI_DATA.state.advances || []).filter((a) => !a.settled && a.workerId === w.id);
      const calc = C.calcWorkerPayroll({ worker: w, workLogs: logs, advances: advs });
      sumGross += calc.grossWage;
      sumAdv += calc.advanceDeducted;
      sumNet += calc.netPaid;
      return { w, logs, calc };
    });

    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };
    set('pay-kpi-gross', formatMoney(sumGross));
    set('pay-kpi-adv', formatMoney(sumAdv));
    set('pay-kpi-net', formatMoney(sumNet));

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--slate-500);">ยังไม่มีรายชื่อคนงานในระบบ</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(({ w, logs, calc }) => {
        const canPay = calc.grossWage > 0 || logs.length > 0;
        return `
          <tr>
            <td data-label="คนงาน">
              <strong>${O.esc(w.name)}</strong>
              <div style="font-size:0.76rem;color:var(--slate-500);">${O.esc(TYPE_LABELS[w.workerType] || '')}</div>
            </td>
            <td data-label="วันทำงาน / โอที">${calc.workDays} วัน${calc.otHours ? ` · โอที ${calc.otHours} ชม.` : ''} (${logs.length} รายการ)</td>
            <td data-label="ค่าแรงรวม" style="text-align:right;font-weight:700;">${formatMoney(calc.grossWage)}</td>
            <td data-label="หักเบิกล่วงหน้า" style="text-align:right;color:var(--rose-600);font-weight:700;">-${formatMoney(calc.advanceDeducted)}</td>
            <td data-label="ยอดจ่ายสุทธิ" style="text-align:right;font-weight:800;font-size:1.02rem;color:var(--emerald-800);">${formatMoney(calc.netPaid)}</td>
            <td data-label="เบิกคงเหลือยกไป" style="text-align:right;font-size:0.82rem;color:var(--slate-500);">${calc.unsettledLeft > 0 ? formatMoney(calc.unsettledLeft) : '-'}</td>
            <td data-label="ยืนยันจ่าย" style="text-align:center;">
              <button type="button" class="btn ${canPay ? 'btn-primary' : 'btn-outline'}" style="height:38px;padding:0 12px;font-size:0.84rem;" ${canPay ? '' : 'disabled'} onclick="confirmPayWorker('${O.esc(w.id)}')">
                💰 ยืนยันจ่ายและลงบัญชี
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    const histBody = $('wf-payrolls-history-tbody');
    if (histBody) {
      const list = (AGRI_DATA.state.payrolls || []).slice(0, 50);
      histBody.innerHTML = list.length ? list.map((p) => `
        <tr>
          <td data-label="วันที่จ่าย">${O.esc(typeof formatDateSlashThai === 'function' ? formatDateSlashThai(p.paidDate) : p.paidDate)}</td>
          <td data-label="คนงาน"><strong>${O.esc(p.workerName || '-')}</strong></td>
          <td data-label="ค่าแรงรวม" style="text-align:right;">${formatMoney(p.grossWage)}</td>
          <td data-label="หักเบิกล่วงหน้า" style="text-align:right;color:var(--rose-600);">-${formatMoney(p.advanceDeducted)}</td>
          <td data-label="จ่ายจริงสุทธิ" style="text-align:right;font-weight:800;color:var(--emerald-800);">${formatMoney(p.netPaid)}</td>
          <td data-label="จัดการ" style="text-align:center;">
            <button type="button" class="btn-icon danger" title="ยกเลิกใบจ่ายค่าแรงและย้อนบัญชี" onclick="cancelPayrollRecord('${O.esc(p.id)}')">🗑️</button>
          </td>
        </tr>
      `).join('') : `<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--slate-500);">ยังไม่มีประวัติการจ่ายเงินเดือนหรือค่าแรง</td></tr>`;
    }
  }

  async function confirmPayWorker(workerId) {
    const w = (AGRI_DATA.state.workers || []).find((x) => x.id === workerId);
    if (!w) return;
    const start = $('pay-period-start')?.value || '';
    const end = $('pay-period-end')?.value || '';
    const target = O.resolve($('pay-target-plot')?.value || 'common');
    const paidDate = $('pay-date')?.value || getTodayISO();

    if (!confirm(`ยืนยันการจ่ายค่าแรงของ "${w.name}" หักยอดเบิกล่วงหน้า และบันทึกลงสมุดบัญชีใช่หรือไม่?`)) return;

    try {
      const res = await AGRI_DATA.payPayroll({
        id: O.newId('pay'),
        paidDate,
        periodStart: start,
        periodEnd: end,
        workerId: w.id,
        orchardId: target.orchardId,
        plotId: target.plotId,
        plotLabel: target.label
      });
      refreshAll();
      toast(`จ่ายค่าแรง ${w.name} สุทธิ ${formatMoney(res.payroll?.netPaid)} และบันทึกลงสมุดบัญชีเรียบร้อย`);
    } catch (err) {
      toast('จ่ายค่าแรงไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  async function cancelPayrollRecord(id) {
    if (!confirm('ยกเลิกใบจ่ายค่าแรงนี้? ระบบจะคืนสถานะค้างจ่ายและลบรายการในสมุดบัญชีให้อัตโนมัติ')) return;
    await AGRI_DATA.deletePayroll(id);
    refreshAll();
    toast('ยกเลิกใบจ่ายค่าแรงเรียบร้อยแล้ว');
  }

  function refreshAll() {
    const today = typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10);
    ['wl-date', 'adv-date', 'pay-date'].forEach((id) => {
      if ($(id) && !$(id).value) $(id).value = today;
    });
    if ($('pay-period-start') && !$('pay-period-start').value) {
      $('pay-period-start').value = today.slice(0, 8) + '01';
    }
    if ($('pay-period-end') && !$('pay-period-end').value) {
      $('pay-period-end').value = today;
    }
    refreshSelectors();
    renderWorkersTable();
    renderWorkLogsAndAdvances();
    renderPayrollSummary();
  }

  O.onChange(refreshSelectors);
  AGRI_DATA.onChange((_, reason) => {
    if (['workers', 'work-logs', 'advances', 'payrolls', 'workspace', 'workspace-offline'].includes(reason)) {
      refreshAll();
    }
  });

  Object.assign(window, {
    switchWorkforceTab,
    openWorkerModal,
    closeWorkerModal,
    onWorkerTypeSelectChange,
    saveWorkerForm,
    toggleWorkerActive,
    deleteWorker,
    onWorkLogInputChange,
    submitWorkLogForm,
    deleteWorkLog,
    submitAdvanceForm,
    deleteAdvance,
    renderPayrollSummary,
    confirmPayWorker,
    cancelPayrollRecord,
    refreshWorkforceAll: refreshAll
  });

  return { refreshAll, switchWorkforceTab };
})();
