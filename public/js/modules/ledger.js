/* ============================================================
   AgriDash Durian Pro - โมดูลสมุดบัญชีเกษตรและการวิเคราะห์การเงินเชิงลึก (ledger.js)
   รองรับตัวกรองช่วงวันที่ สวน แปลงย่อย หมวดหมู่ แถวสรุปท้ายตาราง กราฟจริงจากข้อมูลบัญชี และส่งออก CSV ภาษาไทย
   ============================================================ */
const AGRI_LEDGER = (() => {
  const O = AGRI_ORCHARDS;
  const C = AGRI_CALC;
  const $ = (id) => document.getElementById(id);
  const toast = (msg, type) => (typeof showToast === 'function' ? showToast(msg, type || 'success') : alert(msg));

  const INCOME_CATEGORIES = [
    'รายได้ขายผลผลิต',
    'รายรับอื่นๆ',
    'เงินกองกลางสวน'
  ];

  const EXPENSE_CATEGORIES = [
    'ปุ๋ยและธาตุอาหาร',
    'ยาและฮอร์โมน',
    'ค่าแรงคนงาน',
    'ค่าน้ำมันและค่าไฟ',
    'อุปกรณ์และซ่อมบำรุง',
    'ค่าใช้จ่ายกองกลาง'
  ];

  function formatMoney(v) {
    return '฿' + C.num(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // จัดกลุ่มหมวดหมู่เก่าให้เข้าคู่กับหมวดหมู่มาตรฐานได้ครบถ้วน
  function normalizeCategoryGroup(cat, type) {
    const s = String(cat || '');
    if (type === 'income') {
      if (s.includes('ขายผลผลิต') || s === 'รายได้ขายผลผลิต') return 'รายได้ขายผลผลิต';
      if (s.includes('กองกลาง')) return 'เงินกองกลางสวน';
      return 'รายรับอื่นๆ';
    }
    if (s.includes('ปุ๋ย') || s.includes('ธาตุอาหาร')) return 'ปุ๋ยและธาตุอาหาร';
    if (s.includes('ยา') || s.includes('สารเคมี') || s.includes('ฮอร์โมน') || s.includes('แพคโคล')) return 'ยาและฮอร์โมน';
    if (s.includes('แรงงาน') || s.includes('ค่าแรง')) return 'ค่าแรงคนงาน';
    if (s.includes('น้ำมัน') || s.includes('ไฟฟ้า') || s.includes('ค่าไฟ')) return 'ค่าน้ำมันและค่าไฟ';
    if (s.includes('ซ่อม') || s.includes('อุปกรณ์') || s.includes('ท่อ')) return 'อุปกรณ์และซ่อมบำรุง';
    return 'ค่าใช้จ่ายกองกลาง';
  }

  function populateFormCategories(type) {
    const sel = $('acc-category');
    if (!sel) return;
    const list = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const prev = sel.value;
    sel.innerHTML = list.map((c) => `<option value="${O.esc(c)}">${O.esc(c)}</option>`).join('');
    if (prev && list.includes(prev)) sel.value = prev;
  }

  function collectLegacyEntryLabels() {
    const labels = new Set();
    const list = typeof accEntries !== 'undefined' ? accEntries : [];
    list.forEach((e) => {
      if (!e.orchardId && !e.plotId) {
        const lbl = e.plot || '';
        if (lbl && lbl !== O.COMMON_LABEL && lbl !== 'รวมทุกแปลง') labels.add(lbl);
      }
    });
    return [...labels];
  }

  function refreshLedgerSelectors() {
    // 1. ช่องเลือกสวนและแปลงในฟอร์มบันทึกบัญชี
    const formPlotSel = $('acc-plot');
    if (formPlotSel) {
      const prev = formPlotSel.value;
      formPlotSel.innerHTML = O.optionsHTML({
        includeAll: false,
        includeCommon: true,
        allowOrchardLevel: true
      });
      if (prev && Array.from(formPlotSel.options).some((op) => op.value === prev)) {
        formPlotSel.value = prev;
      }
    }

    // 2. ตัวกรองสวน
    const orcFilter = $('acc-filter-orchard');
    if (orcFilter) {
      const prevO = orcFilter.value || 'all';
      const opts = [
        `<option value="all">ทุกสวนรวมกัน</option>`,
        `<option value="common">🏛️ ${O.esc(O.COMMON_LABEL)}</option>`
      ];
      O.allOrchards().forEach((o) => {
        opts.push(`<option value="${O.esc(o.id)}">🌳 ${O.esc(o.name)}</option>`);
      });
      orcFilter.innerHTML = opts.join('');
      if (Array.from(orcFilter.options).some((op) => op.value === prevO)) orcFilter.value = prevO;
    }

    // 3. ตัวกรองแปลงย่อย (ปรับตามสวนที่เลือก)
    refreshPlotFilterDropdown();

    // 4. ตัวกรองหมวดหมู่
    const catFilter = $('acc-filter-category');
    if (catFilter && !catFilter.dataset.initialized) {
      catFilter.innerHTML = [
        `<option value="all">ทุกหมวดหมู่</option>`,
        `<option value="__income">เฉพาะรายรับทั้งหมด</option>`,
        `<option value="__expense">เฉพาะรายจ่ายทั้งหมด</option>`,
        `<optgroup label="หมวดรายจ่าย">${EXPENSE_CATEGORIES.map((c) => `<option value="${O.esc(c)}">${O.esc(c)}</option>`).join('')}</optgroup>`,
        `<optgroup label="หมวดรายรับ">${INCOME_CATEGORIES.map((c) => `<option value="${O.esc(c)}">${O.esc(c)}</option>`).join('')}</optgroup>`
      ].join('');
      catFilter.dataset.initialized = '1';
    }
  }

  function refreshPlotFilterDropdown() {
    const orcVal = $('acc-filter-orchard')?.value || 'all';
    const plotFilter = $('acc-filter-plot');
    if (!plotFilter) return;
    const prevP = plotFilter.value || 'all';
    const opts = [`<option value="all">ทุกแปลงย่อย</option>`];

    if (orcVal === 'common') {
      plotFilter.innerHTML = `<option value="all">รายการกองกลางทั้งหมด</option>`;
      return;
    }
    if (orcVal === 'all') {
      O.allOrchards().forEach((o) => {
        const ps = O.plotsOf(o.id, false);
        if (ps.length) {
          opts.push(`<optgroup label="🌳 ${O.esc(o.name)}">${ps.map((p) => `<option value="p:${O.esc(p.id)}">${O.esc(p.name)}</option>`).join('')}</optgroup>`);
        }
      });
      const legacy = collectLegacyEntryLabels();
      if (legacy.length) {
        opts.push(`<optgroup label="ป้ายชื่อเดิม">${legacy.map((l) => `<option value="legacy:${O.esc(l)}">${O.esc(l)}</option>`).join('')}</optgroup>`);
      }
    } else {
      const ps = O.plotsOf(orcVal, false);
      opts.push(`<option value="orchard_only">เฉพาะระดับทั้งสวน (ไม่เจาะจงแปลง)</option>`);
      ps.forEach((p) => {
        opts.push(`<option value="p:${O.esc(p.id)}">${O.esc(p.name)}</option>`);
      });
    }

    plotFilter.innerHTML = opts.join('');
    if (Array.from(plotFilter.options).some((op) => op.value === prevP)) plotFilter.value = prevP;
  }

  function onOrchardFilterChange() {
    refreshPlotFilterDropdown();
    renderLedgerAndCharts();
  }

  function resetFilters() {
    if ($('acc-filter-from')) $('acc-filter-from').value = '';
    if ($('acc-filter-to')) $('acc-filter-to').value = '';
    if ($('acc-filter-orchard')) $('acc-filter-orchard').value = 'all';
    refreshPlotFilterDropdown();
    if ($('acc-filter-plot')) $('acc-filter-plot').value = 'all';
    if ($('acc-filter-category')) $('acc-filter-category').value = 'all';
    renderLedgerAndCharts();
    toast('ล้างตัวกรอง แสดงสมุดบัญชีทั้งหมดแล้ว');
  }

  function getFilteredEntries() {
    const list = typeof accEntries !== 'undefined' ? accEntries : [];
    const fromDate = $('acc-filter-from')?.value || '';
    const toDate = $('acc-filter-to')?.value || '';
    const orcFilter = $('acc-filter-orchard')?.value || 'all';
    const plotFilter = $('acc-filter-plot')?.value || 'all';
    const catFilter = $('acc-filter-category')?.value || 'all';

    return [...list]
      .filter((e) => {
        if (!e || e.deletedAt) return false;
        const d = String(e.date || '');
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;

        if (orcFilter === 'common') {
          if (e.orchardId || e.plotId) return false;
        } else if (orcFilter !== 'all') {
          const plotObj = e.plotId ? O.getPlot(e.plotId) : null;
          const matchOrc = e.orchardId === orcFilter || (plotObj && plotObj.orchardId === orcFilter);
          if (!matchOrc) return false;
        }

        if (plotFilter === 'orchard_only') {
          if (e.plotId) return false;
        } else if (plotFilter.startsWith('p:')) {
          if (e.plotId !== plotFilter.slice(2)) return false;
        } else if (plotFilter.startsWith('legacy:')) {
          const lbl = e.plot || '';
          if (e.orchardId || e.plotId || lbl !== plotFilter.slice(7)) return false;
        }

        if (catFilter === '__income') {
          if (e.type !== 'income') return false;
        } else if (catFilter === '__expense') {
          if (e.type !== 'expense') return false;
        } else if (catFilter !== 'all') {
          const norm = normalizeCategoryGroup(e.category, e.type);
          if (e.category !== catFilter && norm !== catFilter) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }

  function resolveEntryDisplayLocation(e) {
    if (e.plotId) {
      const plot = O.getPlot(e.plotId);
      if (plot) {
        const orc = O.getOrchard(plot.orchardId);
        return { orchardName: orc ? orc.name : '-', plotName: plot.name, fullLabel: O.plotLabel(plot) };
      }
    }
    if (e.orchardId) {
      const orc = O.getOrchard(e.orchardId);
      if (orc) return { orchardName: orc.name, plotName: 'ทั้งสวน', fullLabel: O.orchardLabel(orc) };
    }
    const fallback = e.plot || O.COMMON_LABEL;
    return { orchardName: fallback, plotName: '-', fullLabel: fallback };
  }

  function renderLedgerAndCharts() {
    const allList = (typeof accEntries !== 'undefined' ? accEntries : []).filter((e) => e && !e.deletedAt);
    let allInc = 0, allExp = 0;
    allList.forEach((e) => {
      const a = C.num(e.amount);
      if (e.type === 'income') allInc += a; else allExp += a;
    });
    if (typeof totalIncomeAcc !== 'undefined') totalIncomeAcc = allInc;
    if (typeof totalExpenseAcc !== 'undefined') totalExpenseAcc = allExp;
    const allNet = C.round2(allInc - allExp);
    const allMargin = allInc > 0 ? ((allNet / allInc) * 100).toFixed(1) : '0.0';

    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };
    set('fin-rev-display', formatMoney(allInc));
    set('fin-exp-display', formatMoney(allExp));
    set('fin-net-display', (allNet >= 0 ? '+' : '') + formatMoney(allNet));
    set('fin-margin-display', allMargin + '%');
    set('dash-net-profit', formatMoney(allNet));

    const filtered = getFilteredEntries();
    let fInc = 0, fExp = 0, incCount = 0, expCount = 0;
    filtered.forEach((e) => {
      const a = C.num(e.amount);
      if (e.type === 'income') { fInc += a; incCount++; }
      else { fExp += a; expCount++; }
    });
    const fNet = C.round2(fInc - fExp);
    const fMargin = fInc > 0 ? ((fNet / fInc) * 100).toFixed(1) : '0.0';

    set('acc-top-inc', formatMoney(fInc));
    set('acc-top-exp', formatMoney(fExp));
    set('acc-top-net', (fNet >= 0 ? '+' : '') + formatMoney(fNet));
    set('acc-top-inc-count', `รายรับ ${incCount.toLocaleString('th-TH')} รายการ`);
    set('acc-top-exp-count', `รายจ่าย ${expCount.toLocaleString('th-TH')} รายการ`);
    set('acc-top-margin', `สัดส่วนกำไรสุทธิ ${fMargin}%`);

    const netEl = $('acc-top-net');
    if (netEl) netEl.style.color = fNet >= 0 ? 'var(--blue-700)' : 'var(--rose-700)';

    const tbody = $('acc-table-body');
    const tfoot = $('acc-table-foot');
    if (tbody) {
      if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--slate-500);padding:28px;font-weight:600;">ไม่พบรายการบัญชีตามเงื่อนไขตัวกรองที่เลือก</td></tr>`;
      } else {
        tbody.innerHTML = filtered.map((entry) => {
          const isInc = entry.type === 'income';
          const amt = C.num(entry.amount);
          const loc = resolveEntryDisplayLocation(entry);
          const dateTxt = typeof formatDateSlashThai === 'function' ? formatDateSlashThai(entry.date) : entry.date;
          return `
            <tr>
              <td data-label="วันที่" style="font-weight:700;white-space:nowrap;">${O.esc(dateTxt)}</td>
              <td data-label="ประเภท">${isInc ? '<span class="badge-income">รายรับ</span>' : '<span class="badge-expense">รายจ่าย</span>'}</td>
              <td data-label="สวนแปลง & หมวดหมู่">
                <div style="font-weight:800;color:var(--slate-900);">${O.esc(entry.category || '-')}</div>
                <div style="font-size:0.78rem;color:var(--emerald-700);font-weight:700;">📍 ${O.esc(loc.fullLabel)}</div>
              </td>
              <td data-label="รายละเอียด" style="font-size:0.88rem;color:var(--slate-700);">${O.esc(entry.detail || '-')}</td>
              <td data-label="จำนวนเงิน" style="text-align:right;font-weight:800;font-size:1rem;white-space:nowrap;${isInc ? 'color:var(--emerald-700)' : 'color:var(--rose-700)'}">${isInc ? '+' : '-'}${formatMoney(amt)}</td>
              <td data-label="จัดการ" style="text-align:center;">
                <button type="button" class="btn-icon danger" onclick="deleteAccEntry('${O.esc(entry.id || '')}')" title="ลบรายการ">🗑️</button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    if (tfoot) {
      tfoot.innerHTML = `
        <tr class="ledger-foot-row">
          <td colspan="3" data-label="สรุปท้ายตาราง">
            <strong>รวมตามตัวกรอง (${filtered.length.toLocaleString('th-TH')} รายการ)</strong>
          </td>
          <td data-label="รายรับ / รายจ่ายรวม" style="font-size:0.86rem;">
            <span style="color:var(--emerald-700);font-weight:800;">รายรับ +${formatMoney(fInc)}</span>
            <span style="margin:0 8px;color:var(--slate-400);">|</span>
            <span style="color:var(--rose-700);font-weight:800;">รายจ่าย -${formatMoney(fExp)}</span>
          </td>
          <td data-label="กำไรสุทธิ" style="text-align:right;font-weight:800;font-size:1.05rem;color:${fNet >= 0 ? 'var(--emerald-800)' : 'var(--rose-700)'};">
            ${fNet >= 0 ? '+' : ''}${formatMoney(fNet)}
          </td>
          <td></td>
        </tr>
      `;
    }

    renderFinanceAnalytics(allList);
    if (typeof AGRI_DASHBOARD !== 'undefined' && AGRI_DASHBOARD.renderKPIs) {
      AGRI_DASHBOARD.renderKPIs();
    }
  }

  // ====== กราฟวิเคราะห์งบการเงินจากข้อมูลจริงของผู้ใช้ ======
  function renderFinanceAnalytics(allList) {
    const catTotals = new Map();
    EXPENSE_CATEGORIES.forEach((c) => catTotals.set(c, 0));

    allList.filter((e) => e.type === 'expense').forEach((e) => {
      const grp = normalizeCategoryGroup(e.category, 'expense');
      catTotals.set(grp, C.round2((catTotals.get(grp) || 0) + C.num(e.amount)));
    });

    const totalExp = [...catTotals.values()].reduce((s, v) => s + v, 0);
    const palette = ['#059669', '#d97706', '#2563eb', '#e11d48', '#7c3aed', '#64748b'];

    const legendHost = $('fin-cat-pills');
    const donutHost = $('fin-donut-svg');
    if (legendHost && donutHost) {
      let offset = 25;
      const circles = [`<circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#e2e8f0" stroke-width="5"/>`];
      const pills = [];

      [...catTotals.entries()].forEach(([cat, amt], i) => {
        const pct = totalExp > 0 ? C.round2((amt / totalExp) * 100) : 0;
        const col = palette[i % palette.length];
        if (pct > 0) {
          const dash = `${pct} ${Math.max(0, 100 - pct)}`;
          circles.push(`<circle cx="21" cy="21" r="15.915" fill="transparent" stroke="${col}" stroke-width="5" stroke-dasharray="${dash}" stroke-dashoffset="${offset}" class="pie-segment" onclick="drillDownCategory('${O.esc(cat)}')"/>`);
          offset = (offset - pct + 100) % 100;
        }
        pills.push(`
          <button type="button" class="chart-pill" style="justify-content:space-between;width:100%;" onclick="drillDownCategory('${O.esc(cat)}')">
            <span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${col};margin-right:6px;"></i>${O.esc(cat)}</span>
            <strong>${formatMoney(amt)} (${pct}%)</strong>
          </button>
        `);
      });

      donutHost.innerHTML = circles.join('');
      legendHost.innerHTML = pills.join('');
    }

    // สรุปรายเดือน 6 เดือนล่าสุดสำหรับกราฟเส้น
    const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const now = new Date();
    const buckets = [];
    for (let k = 5; k >= 0; k--) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.push({ ym, label: `${monthNames[d.getMonth()]} ${String(d.getFullYear() + 543).slice(-2)}`, inc: 0, exp: 0 });
    }
    allList.forEach((e) => {
      const ym = String(e.date || '').slice(0, 7);
      const b = buckets.find((x) => x.ym === ym);
      if (b) {
        if (e.type === 'income') b.inc += C.num(e.amount);
        else b.exp += C.num(e.amount);
      }
    });

    const maxVal = Math.max(1000, ...buckets.map((b) => Math.max(b.inc, b.exp)));
    const xs = [35, 122, 209, 296, 383, 470];
    const toY = (v) => Math.round(170 - (v / maxVal) * 135);

    const incPts = buckets.map((b, i) => `${xs[i]},${toY(b.inc)}`);
    const expPts = buckets.map((b, i) => `${xs[i]},${toY(b.exp)}`);

    const svgEl = $('fin-trend-svg');
    if (svgEl) {
      svgEl.innerHTML = `
        <line x1="0" y1="40" x2="500" y2="40" stroke="#e2e8f0" stroke-width="1"/>
        <line x1="0" y1="105" x2="500" y2="105" stroke="#e2e8f0" stroke-width="1"/>
        <line x1="0" y1="170" x2="500" y2="170" stroke="#e2e8f0" stroke-width="1"/>
        <polyline points="${incPts.join(' ')}" fill="none" stroke="#059669" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="${expPts.join(' ')}" fill="none" stroke="#e11d48" stroke-width="3.5" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round"/>
        ${buckets.map((b, i) => `
          <circle cx="${xs[i]}" cy="${toY(b.inc)}" r="6.5" fill="#059669" stroke="#ffffff" stroke-width="2" style="cursor:pointer" onclick="showChartTooltip('${O.esc(b.label)}', ${C.round2(b.inc)}, ${C.round2(b.exp)})"/>
          <circle cx="${xs[i]}" cy="${toY(b.exp)}" r="5.5" fill="#e11d48" stroke="#ffffff" stroke-width="2" style="cursor:pointer" onclick="showChartTooltip('${O.esc(b.label)}', ${C.round2(b.inc)}, ${C.round2(b.exp)})"/>
        `).join('')}
      `;
    }

    const xLabels = $('fin-trend-xlabels');
    if (xLabels) {
      xLabels.innerHTML = buckets.map((b) => `<span>${O.esc(b.label)}</span>`).join('');
    }
    const curB = buckets[buckets.length - 1];
    if (curB && typeof showChartTooltip === 'function') {
      showChartTooltip(curB.label, C.round2(curB.inc), C.round2(curB.exp));
    }
  }

  function drillDownRealCategory(categoryName) {
    const card = $('drilldown-card');
    const title = $('drill-title');
    const tbody = $('drill-table-body');
    if (!card || !title || !tbody) return;

    const allList = (typeof accEntries !== 'undefined' ? accEntries : []).filter((e) => e && !e.deletedAt && e.type === 'expense');
    const matched = allList
      .filter((e) => e.category === categoryName || normalizeCategoryGroup(e.category, 'expense') === categoryName)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const sumAmt = matched.reduce((s, e) => s + C.num(e.amount), 0);

    title.innerText = `🔍 รายการในหมวด "${categoryName}" รวม ${formatMoney(sumAmt)}`;
    if (!matched.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--slate-500);">ยังไม่มีรายการค่าใช้จ่ายในหมวดหมู่นี้</td></tr>`;
    } else {
      tbody.innerHTML = matched.map((it) => {
        const loc = resolveEntryDisplayLocation(it);
        return `
          <tr>
            <td data-label="วันที่" style="font-weight:700;">${O.esc(typeof formatDateSlashThai === 'function' ? formatDateSlashThai(it.date) : it.date)}</td>
            <td data-label="หมวดหมู่"><span class="badge-op">${O.esc(it.category || categoryName)}</span></td>
            <td data-label="รายละเอียด">${O.esc(it.detail || '-')}</td>
            <td data-label="สวน / แปลง" style="font-weight:700;">${O.esc(loc.fullLabel)}</td>
            <td data-label="จำนวนเงิน" style="text-align:right;font-weight:800;color:var(--rose-700);">${formatMoney(it.amount)}</td>
          </tr>
        `;
      }).join('');
    }
    card.classList.remove('hidden');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function exportFilteredCSV() {
    const filtered = getFilteredEntries();
    const rows = [[
      'วันที่ (วว/ดด/ปปปป)',
      'ประเภท',
      'สวน',
      'แปลงย่อย',
      'หมวดหมู่',
      'รายละเอียด',
      'จำนวนเงิน (บาท)'
    ]];

    let incSum = 0, expSum = 0;
    filtered.forEach((e) => {
      const loc = resolveEntryDisplayLocation(e);
      const amt = C.num(e.amount);
      if (e.type === 'income') incSum += amt; else expSum += amt;
      rows.push([
        typeof formatDateSlashThai === 'function' ? formatDateSlashThai(e.date) : e.date,
        e.type === 'income' ? 'รายรับ' : 'รายจ่าย',
        loc.orchardName,
        loc.plotName,
        e.category || '',
        e.detail || '',
        amt.toFixed(2)
      ]);
    });

    rows.push([]);
    rows.push(['สรุปรวมตามตัวกรอง', `รายรับรวม ${incSum.toFixed(2)} บาท`, `รายจ่ายรวม ${expSum.toFixed(2)} บาท`, `กำไรสุทธิ ${(incSum - expSum).toFixed(2)} บาท`, '', '', '']);

    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `สมุดบัญชีสวนทุเรียน_${typeof getTodayISO === 'function' ? getTodayISO() : 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`ส่งออกรายงาน CSV (${filtered.length} รายการ) เรียบร้อยแล้ว`);
  }

  O.onChange(() => {
    refreshLedgerSelectors();
    renderLedgerAndCharts();
  });

  Object.assign(window, {
    INCOME_CATEGORIES_STD: INCOME_CATEGORIES,
    EXPENSE_CATEGORIES_STD: EXPENSE_CATEGORIES,
    populateLedgerFormCategories: populateFormCategories,
    refreshLedgerSelectors,
    onAccOrchardFilterChange: onOrchardFilterChange,
    resetAccFilters: resetFilters,
    renderAccEntries: renderLedgerAndCharts,
    drillDownCategory: drillDownRealCategory,
    exportAccCSV: exportFilteredCSV
  });

  return {
    INCOME_CATEGORIES,
    EXPENSE_CATEGORIES,
    refreshLedgerSelectors,
    renderLedgerAndCharts,
    populateFormCategories
  };
})();
