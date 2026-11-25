/* ============================================================
   AgriDash Durian Pro - โมดูลภาพรวมผู้บริหาร พยากรณ์อากาศ และแจ้งเตือนด่วน (dashboard.js)
   ============================================================ */
const AGRI_DASHBOARD = (() => {
  const O = AGRI_ORCHARDS;
  const C = AGRI_CALC;
  const $ = (id) => document.getElementById(id);

  // พิกัดเริ่มต้นกรณีสวนยังไม่ปักหมุด (แหล่งปลูกทุเรียนจันทบุรี)
  const DEFAULT_COORDS = { lat: 12.6096, lng: 102.1045, isDefault: true, name: 'ค่าเริ่มต้นภาคตะวันออก' };

  let currentScope = 'all';
  let allocateCommon = false;
  let weatherCacheKey = '';
  let lastWeather = null;
  let lastStation = null;

  function formatMoney(v) {
    return '฿' + C.num(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function refreshScopeSelect() {
    const sel = $('dash-scope-filter');
    if (!sel) return;
    const prev = sel.value || currentScope || 'all';
    sel.innerHTML = O.optionsHTML({
      includeAll: true,
      allLabel: '🌳 ทุกสวนรวมกัน',
      includeCommon: false,
      allowOrchardLevel: true
    });
    const exists = Array.from(sel.options).some((op) => op.value === prev);
    sel.value = exists ? prev : 'all';
    currentScope = sel.value || 'all';
  }

  function onScopeChange() {
    const sel = $('dash-scope-filter');
    currentScope = sel ? sel.value : 'all';
    allocateCommon = Boolean($('dash-alloc-common')?.checked);
    renderKPIs();
    renderUrgentAlerts();
    loadWeatherForScope(false);
  }

  // ====== 1. การ์ดสรุปสถานะธุรกิจ 6 ใบ ======
  function renderKPIs() {
    const kpi = C.calcOrchardKPIs({
      orchards: O.allOrchards(),
      plots: O.allPlots(),
      trees: AGRI_DATA.state.trees || [],
      accEntries: typeof accEntries !== 'undefined' ? accEntries : [],
      harvests: AGRI_DATA.state.harvests || [],
      filter: currentScope,
      allocateCommon
    });

    const set = (id, text) => { const el = $(id); if (el) el.innerText = text; };
    set('exec-kpi-income', formatMoney(kpi.totalIncome));
    set('exec-kpi-expense', formatMoney(kpi.totalExpense));
    set('exec-kpi-profit', (kpi.netProfit >= 0 ? '+' : '') + formatMoney(kpi.netProfit));
    set('exec-kpi-cost-tree', kpi.treeCount > 0 ? formatMoney(kpi.costPerTree) : '฿0.00');
    set('exec-kpi-cost-rai', kpi.areaRai > 0 ? formatMoney(kpi.costPerRai) : '฿0.00');
    set('exec-kpi-breakeven', kpi.totalHarvestKg > 0 ? formatMoney(kpi.breakevenPerKg) + '/กก.' : 'รอผลผลิต');

    const margin = kpi.totalIncome > 0 ? ((kpi.netProfit / kpi.totalIncome) * 100).toFixed(1) : '0.0';
    set('exec-kpi-income-sub', kpi.totalHarvestKg > 0
      ? `ผลผลิตสะสม ${kpi.totalHarvestKg.toLocaleString('th-TH')} กก.`
      : 'รายรับสะสมตามขอบเขตที่เลือก');
    set('exec-kpi-expense-sub', kpi.commonExpense > 0 && currentScope !== 'all'
      ? (allocateCommon
        ? `รวมปันส่วนกองกลาง ${formatMoney(kpi.allocatedCommonExpense)}`
        : `ยังไม่รวมกองกลาง ${formatMoney(kpi.commonExpense)}`)
      : 'ต้นทุนสะสมรวมทุกหมวด');
    set('exec-kpi-profit-sub', `อัตรากำไรสุทธิ ${margin}%`);
    set('exec-kpi-tree-sub', kpi.treeCount > 0
      ? (kpi.actualTrees > 0
        ? `จากทะเบียนจริง ${kpi.actualTrees.toLocaleString('th-TH')} ต้น`
        : `ประมาณการตามระยะปลูก ${kpi.treeCount.toLocaleString('th-TH')} ต้น`)
      : 'เพิ่มสวนและแปลงเพื่อคำนวณ');
    set('exec-kpi-rai-sub', kpi.areaRai > 0
      ? `พื้นที่รวม ${kpi.areaRai.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ไร่`
      : 'ระบุพื้นที่แปลงเพื่อคำนวณ');
    set('exec-kpi-breakeven-sub', kpi.totalHarvestKg > 0 && kpi.treeCount > 0
      ? `เฉลี่ย ${kpi.yieldPerTreeKg.toLocaleString('th-TH', { maximumFractionDigits: 2 })} กก./ต้น`
      : 'คำนวณเมื่อมีการบันทึกตัดทุเรียน');

    const profitEl = $('exec-kpi-profit');
    if (profitEl) {
      profitEl.style.color = kpi.netProfit >= 0 ? 'var(--emerald-700)' : 'var(--rose-700)';
    }

    // แถบแนะนำสร้างสวนแรกหากยังไม่มีสวนในระบบ
    const onboard = $('dash-onboard-banner');
    if (onboard) onboard.classList.toggle('hidden', O.hasOrchards());

    // ซ่อน/แสดงตัวเลือกกระจายกองกลางเฉพาะเมื่อดูรายสวนหรือรายแปลง
    const allocWrap = $('dash-alloc-wrap');
    if (allocWrap) allocWrap.classList.toggle('hidden', currentScope === 'all');
  }

  // ====== 2. แถบแจ้งเตือนงานด่วน (สต็อกใกล้หมด, ระยะปลอดภัย PHI, รอบให้น้ำ/พ่นสาร) ======
  function daysBetweenISO(a, b) {
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }

  function renderUrgentAlerts() {
    const host = $('dash-urgent-alerts');
    if (!host) return;
    const today = typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10);
    const alerts = [];

    // 1) สต็อกปุ๋ย/สารเคมีใกล้หมด
    const lowStock = (AGRI_DATA.state.inventory || []).filter(
      (i) => i.active !== false && C.num(i.stockQty) <= C.num(i.reorderLevel ?? 1)
    );
    if (lowStock.length) {
      const names = lowStock.slice(0, 4).map((i) => `${O.esc(i.name)} (เหลือ ${C.num(i.stockQty)} ${O.esc(i.unit)})`).join(', ');
      alerts.push({
        tone: 'warning',
        icon: '📦',
        title: `คลังปุ๋ยและสารเคมีใกล้หมด ${lowStock.length} รายการ`,
        desc: names + (lowStock.length > 4 ? ` และอีก ${lowStock.length - 4} รายการ` : ''),
        btn: 'เปิดคลังปัจจัยการผลิต',
        action: "openOpsTab('inventory')"
      });
    }

    // 2) แปลงที่ยังติดระยะปลอดภัยก่อนเก็บเกี่ยว (PHI)
    const activePhi = (AGRI_DATA.state.sprays || []).filter((s) => s.phiUntil && s.phiUntil >= today);
    if (activePhi.length) {
      const latest = [...activePhi].sort((a, b) => String(b.phiUntil).localeCompare(String(a.phiUntil)))[0];
      const leftDays = Math.max(0, daysBetweenISO(today, latest.phiUntil));
      alerts.push({
        tone: 'danger',
        icon: '🛡️',
        title: `เฝ้าระวังระยะปลอดภัยก่อนเก็บเกี่ยว เหลืออีก ${leftDays} วัน`,
        desc: `${O.esc(latest.plotNames || 'แปลงที่พ่นล่าสุด')} — งดตัดผลผลิตจนถึงวันที่ ${typeof formatDateSlashThai === 'function' ? formatDateSlashThai(latest.phiUntil) : latest.phiUntil}`,
        btn: 'ดูประวัติการพ่นสาร',
        action: "openOpsTab('spray')"
      });
    }

    // 3) แจ้งเตือนรอบการให้น้ำและพ่นบำรุง
    const activePlots = O.allPlots(true);
    if (activePlots.length) {
      const irrigations = AGRI_DATA.state.irrigations || [];
      if (irrigations.length) {
        const latestIrr = [...irrigations].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
        const gap = daysBetweenISO(latestIrr.date, today);
        if (gap >= 3) {
          alerts.push({
            tone: 'info',
            icon: '💧',
            title: `ครบกำหนดตรวจรอบการให้น้ำ (เว้นมาแล้ว ${gap} วัน)`,
            desc: `บันทึกล่าสุดที่ ${O.esc(latestIrr.plotName || 'แปลงสวน')} เมื่อ ${typeof formatDateSlashThai === 'function' ? formatDateSlashThai(latestIrr.date) : latestIrr.date}`,
            btn: 'บันทึกการให้น้ำ',
            action: "openOpsTab('irrigation')"
          });
        }
      }
      const sprays = AGRI_DATA.state.sprays || [];
      if (sprays.length) {
        const latestSp = [...sprays].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
        const spGap = daysBetweenISO(latestSp.date, today);
        if (spGap >= 12) {
          alerts.push({
            tone: 'info',
            icon: '💦',
            title: `ถึงรอบพ่นบำรุงทางใบหรือป้องกันศัตรูพืช (ผ่านมา ${spGap} วัน)`,
            desc: `พ่นครั้งล่าสุดเมื่อ ${typeof formatDateSlashThai === 'function' ? formatDateSlashThai(latestSp.date) : latestSp.date}`,
            btn: 'คำนวณถังพ่นยา',
            action: "openOpsTab('spray')"
          });
        }
      }
    }

    if (!alerts.length) {
      host.innerHTML = `
        <div class="urgent-alert-bar tone-ok">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.25rem;">✅</span>
            <div>
              <div style="font-weight:800;color:var(--emerald-900);">สถานะการจัดการสวนปกติ ไม่มีรายการค้างเร่งด่วน</div>
              <div style="font-size:0.82rem;color:var(--emerald-800);">สต็อกเพียงพอ และไม่มีแปลงที่ติดระยะห้ามเก็บเกี่ยวในขณะนี้</div>
            </div>
          </div>
        </div>`;
      return;
    }

    host.innerHTML = alerts.map((a) => `
      <div class="urgent-alert-bar tone-${a.tone}">
        <div style="display:flex;align-items:flex-start;gap:10px;flex:1;min-width:220px;">
          <span style="font-size:1.3rem;line-height:1.2;">${a.icon}</span>
          <div>
            <div class="urgent-alert-title">${a.title}</div>
            <div class="urgent-alert-desc">${a.desc}</div>
          </div>
        </div>
        <button type="button" class="btn btn-outline" style="height:38px;font-size:0.84rem;background:#fff;" onclick="${a.action}">${a.btn}</button>
      </div>
    `).join('');
  }

  // ====== 3. พยากรณ์อากาศเชิงเกษตร (Open-Meteo) + วิเคราะห์เวลาพ่นสาร + สถานีวัดอากาศส่วนตัว ======
  function resolveScopeOrchardCoords() {
    let orchard = null;
    if (currentScope.startsWith('o:')) orchard = O.getOrchard(currentScope.slice(2));
    else if (currentScope.startsWith('p:')) {
      const plot = O.getPlot(currentScope.slice(2));
      if (plot) orchard = O.getOrchard(plot.orchardId);
    } else {
      orchard = O.activeOrchards().find((o) => o.lat != null && o.lng != null) || O.activeOrchards()[0] || null;
    }
    if (orchard && orchard.lat != null && orchard.lng != null) {
      return { lat: Number(orchard.lat), lng: Number(orchard.lng), isDefault: false, name: orchard.name, orchardId: orchard.id };
    }
    return { ...DEFAULT_COORDS, orchardId: orchard ? orchard.id : '' };
  }

  function weatherCodeDesc(code) {
    const c = Number(code);
    if (c === 0) return { icon: '☀️', text: 'ท้องฟ้าแจ่มใส' };
    if (c <= 3) return { icon: '⛅', text: 'มีเมฆบางส่วน' };
    if (c <= 48) return { icon: '🌫️', text: 'มีหมอกหรือฟ้าหลัว' };
    if (c <= 57) return { icon: '🌦️', text: 'ฝนปรอย' };
    if (c <= 67) return { icon: '🌧️', text: 'ฝนตกปานกลางถึงหนัก' };
    if (c <= 82) return { icon: '⛈️', text: 'ฝนฟ้าคะนองเป็นแห่งๆ' };
    if (c >= 95) return { icon: '🌩️', text: 'พายุฝนฟ้าคะนอง' };
    return { icon: '🌤️', text: 'เมฆเป็นส่วนมาก' };
  }

  async function loadWeatherForScope(forceRefresh) {
    const loc = resolveScopeOrchardCoords();
    const locLabel = $('wx-location-label');
    if (locLabel) {
      locLabel.innerText = loc.isDefault
        ? `📍 ${loc.name} (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}) — ปักหมุดพิกัดสวนจริงได้ที่เมนูสวนและแปลง`
        : `📍 สวน${loc.name} (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})`;
    }

    // โหลดข้อมูลสถานีวัดอากาศส่วนตัวของสวนควบคู่กัน
    if (loc.orchardId) {
      loadStationReading(loc.orchardId);
    } else {
      lastStation = null;
      renderStationBox('');
    }

    const key = `${loc.lat.toFixed(3)}_${loc.lng.toFixed(3)}`;
    if (!forceRefresh && key === weatherCacheKey && lastWeather) {
      renderWeatherUI(lastWeather);
      return;
    }

    const lsKey = 'agri_wx_cache_' + key;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,uv_index,weather_code` +
      `&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,uv_index` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max` +
      `&timezone=Asia%2FBangkok&forecast_days=7`;

    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      weatherCacheKey = key;
      lastWeather = data;
      try { localStorage.setItem(lsKey, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
      renderWeatherUI(data);
    } catch (e) {
      try {
        const cached = JSON.parse(localStorage.getItem(lsKey) || 'null');
        if (cached && cached.data) {
          lastWeather = cached.data;
          renderWeatherUI(cached.data, true);
          return;
        }
      } catch (err) {}
      const host = $('wx-advisor-banner');
      if (host) {
        host.className = 'spray-advisor-banner level-warning';
        host.innerHTML = '<div><strong>ไม่สามารถดึงพยากรณ์อากาศออนไลน์ได้ในขณะนี้</strong><div style="font-size:0.84rem;">ตรวจสอบสัญญาณอินเทอร์เน็ต หรือดูค่าจากสถานีวัดอากาศในสวน</div></div>';
      }
    }
  }

  function renderWeatherUI(data, fromCache = false) {
    if (!data || !data.current) return;
    // หากมีค่าจากสถานีวัดอากาศในสวนภายใน 2 ชั่วโมงล่าสุด นำมาใช้ร่วมวิเคราะห์พ่นยาได้ทันที
    const stationFresh = lastStation && lastStation.recordedAt &&
      (Date.now() - new Date(lastStation.recordedAt).getTime() < 2 * 3600 * 1000);

    const cur = data.current;
    const tempC = stationFresh && lastStation.tempC != null ? lastStation.tempC : cur.temperature_2m;
    const rh = stationFresh && lastStation.humidity != null ? lastStation.humidity : cur.relative_humidity_2m;
    const windKmh = stationFresh && lastStation.windKmh != null ? lastStation.windKmh : cur.wind_speed_10m;
    const rainMm = stationFresh && lastStation.rainMm != null ? lastStation.rainMm : cur.precipitation;
    const uvIndex = stationFresh && lastStation.uvIndex != null ? lastStation.uvIndex : cur.uv_index;

    // หาโอกาสฝนใน 3 ชั่วโมงข้างหน้า
    const nowIsoHour = new Date().toISOString().slice(0, 13);
    const hTimes = (data.hourly && data.hourly.time) || [];
    let startIdx = hTimes.findIndex((t) => t.slice(0, 13) >= nowIsoHour);
    if (startIdx < 0) startIdx = 0;
    let next3hRainProb = 0;
    for (let i = startIdx; i < Math.min(hTimes.length, startIdx + 3); i++) {
      const p = C.num(data.hourly.precipitation_probability?.[i]);
      if (p > next3hRainProb) next3hRainProb = p;
    }

    const advice = C.evaluateSprayWindow({ tempC, rh, windKmh, rainMm, rainProbPct: next3hRainProb, uvIndex });
    const wDesc = weatherCodeDesc(cur.weather_code);

    const set = (id, v) => { const el = $(id); if (el) el.innerText = v; };
    set('wx-cur-temp', `${C.round2(tempC)}°C`);
    set('wx-cur-rh', `${Math.round(C.num(rh))}%`);
    set('wx-cur-wind', `${C.round2(windKmh)} กม./ชม.`);
    set('wx-cur-rain', `${C.round2(rainMm)} มม.`);
    set('wx-cur-uv', `${C.round2(uvIndex)}`);
    set('wx-cur-vpd', `${advice.vpd} กิโลปาสคาล`);
    set('wx-cur-cond', `${wDesc.icon} ${wDesc.text}${fromCache ? ' · ข้อมูลแคช' : ''}${stationFresh ? ' · จากสถานีในสวน' : ''}`);

    const banner = $('wx-advisor-banner');
    if (banner) {
      const icon = advice.status === 'optimal' ? '🟢' : (advice.status === 'caution' ? '🟡' : '🔴');
      banner.className = `spray-advisor-banner level-${advice.level}`;
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;flex:1;">
          <span style="font-size:1.7rem;">${icon}</span>
          <div>
            <div style="font-weight:800;font-size:1.02rem;">คำแนะนำการพ่นสารตอนนี้: ${O.esc(advice.label)}</div>
            <div style="font-size:0.86rem;opacity:0.92;margin-top:2px;">${advice.reasons.map(O.esc).join(' · ')} (โอกาสฝน 3 ชม. ข้างหน้า ${Math.round(next3hRainProb)}%)</div>
          </div>
        </div>
        <button type="button" class="btn btn-outline" style="background:#fff;height:40px;" onclick="openOpsTab('spray')">💦 ไปหน้าคำนวณถังพ่น</button>
      `;
    }

    // ตารางรายชั่วโมง 12 ช่วงถัดไป
    const hourlyHost = $('wx-hourly-strip');
    if (hourlyHost && data.hourly) {
      const cards = [];
      for (let i = startIdx; i < Math.min(hTimes.length, startIdx + 12); i++) {
        const tStr = String(hTimes[i]).split('T')[1]?.slice(0, 5) || '';
        const ht = C.num(data.hourly.temperature_2m?.[i]);
        const hrh = C.num(data.hourly.relative_humidity_2m?.[i]);
        const hw = C.num(data.hourly.wind_speed_10m?.[i]);
        const hp = C.num(data.hourly.precipitation_probability?.[i]);
        const hr = C.num(data.hourly.precipitation?.[i]);
        const huv = C.num(data.hourly.uv_index?.[i]);
        const ev = C.evaluateSprayWindow({ tempC: ht, rh: hrh, windKmh: hw, rainMm: hr, rainProbPct: hp, uvIndex: huv });
        const badgeCls = ev.status === 'optimal' ? 'wx-pill-ok' : (ev.status === 'caution' ? 'wx-pill-warn' : 'wx-pill-stop');
        cards.push(`
          <div class="wx-hour-card">
            <div class="wx-hour-time">${O.esc(tStr)} น.</div>
            <div class="wx-hour-temp">${ht.toFixed(1)}°C</div>
            <div class="wx-hour-meta">💧 ${Math.round(hrh)}% · 💨 ${hw.toFixed(0)}</div>
            <div class="wx-hour-meta">☔ โอกาสฝน ${Math.round(hp)}%</div>
            <span class="wx-pill ${badgeCls}">${O.esc(ev.shortLabel)}</span>
          </div>
        `);
      }
      hourlyHost.innerHTML = cards.join('');
    }

    // พยากรณ์ล่วงหน้า 7 วัน
    const dailyHost = $('wx-daily-grid');
    if (dailyHost && data.daily && Array.isArray(data.daily.time)) {
      const dayNames = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
      dailyHost.innerHTML = data.daily.time.map((iso, idx) => {
        const dObj = new Date(iso + 'T00:00:00');
        const dLabel = idx === 0 ? 'วันนี้' : `${dayNames[dObj.getDay()]} ${dObj.getDate()}/${dObj.getMonth() + 1}`;
        const wc = weatherCodeDesc(data.daily.weather_code?.[idx]);
        const tmax = C.num(data.daily.temperature_2m_max?.[idx]).toFixed(0);
        const tmin = C.num(data.daily.temperature_2m_min?.[idx]).toFixed(0);
        const rsum = C.num(data.daily.precipitation_sum?.[idx]).toFixed(1);
        const rprob = Math.round(C.num(data.daily.precipitation_probability_max?.[idx]));
        const wmax = C.num(data.daily.wind_speed_10m_max?.[idx]).toFixed(0);
        const umax = C.num(data.daily.uv_index_max?.[idx]).toFixed(1);
        return `
          <div class="wx-day-card">
            <div class="wx-day-name">${O.esc(dLabel)}</div>
            <div class="wx-day-icon" title="${O.esc(wc.text)}">${wc.icon}</div>
            <div class="wx-day-temp"><strong>${tmax}°</strong> / ${tmin}°C</div>
            <div class="wx-day-sub">🌧️ ${rsum} มม. (${rprob}%)</div>
            <div class="wx-day-sub">💨 ลม ${wmax} · ☀️ ยูวี ${umax}</div>
          </div>
        `;
      }).join('');
    }
  }

  // ====== สถานีวัดอากาศส่วนตัวในสวน (Webhook) ======
  async function loadStationReading(orchardId) {
    if (!orchardId) { renderStationBox(''); return; }
    try {
      const res = await AGRI_DATA.request('GET', `/api/weather/latest/${encodeURIComponent(orchardId)}`);
      lastStation = res.latest || null;
      renderStationBox(orchardId);
      if (lastStation && lastWeather) renderWeatherUI(lastWeather);
    } catch (e) {
      lastStation = null;
      renderStationBox(orchardId);
    }
  }

  function renderStationBox(orchardId) {
    const box = $('wx-station-box');
    if (!box) return;
    const orchard = orchardId ? O.getOrchard(orchardId) : (O.activeOrchards()[0] || null);
    if (!orchard) {
      box.innerHTML = `<div style="font-size:0.86rem;color:var(--slate-600);">สร้างสวนในเมนู <strong>สวนและแปลง</strong> เพื่อรับลิงก์เชื่อมต่อสถานีวัดอากาศส่วนตัวในสวน</div>`;
      return;
    }
    const base = AGRI_STORAGE.getApiBaseUrl() || window.location.origin;
    const tokenPart = orchard.weatherToken
      ? `${base}/api/weather/webhook/${orchard.id}?token=${orchard.weatherToken}`
      : '';
    const latestHtml = lastStation
      ? `<div style="font-size:0.84rem;color:var(--emerald-800);font-weight:700;margin-top:4px;">
           📡 ค่าล่าสุดจากสถานี (${new Date(lastStation.recordedAt).toLocaleString('th-TH')}):
           อุณหภูมิ ${lastStation.tempC ?? '-'}°C · ความชื้น ${lastStation.humidity ?? '-'}% · ลม ${lastStation.windKmh ?? '-'} กม./ชม. · ฝน ${lastStation.rainMm ?? 0} มม.
         </div>`
      : `<div style="font-size:0.82rem;color:var(--slate-500);margin-top:2px;">ยังไม่มีข้อมูลส่งเข้ามาจากสถานีวัดอากาศในสวน "${O.esc(orchard.name)}"</div>`;

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;font-size:0.92rem;color:var(--slate-900);">📡 เชื่อมต่อสถานีวัดอากาศส่วนตัวในสวน (${O.esc(orchard.name)})</div>
          ${latestHtml}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-outline" style="height:38px;font-size:0.84rem;" onclick="generateOrchardWeatherWebhook('${O.esc(orchard.id)}')">
            🔗 ${tokenPart ? 'คัดลอกลิงก์รับข้อมูลสถานี' : 'เปิดใช้งานลิงก์สถานีอากาศ'}
          </button>
          ${tokenPart ? `<button type="button" class="btn btn-outline" style="height:38px;font-size:0.84rem;" onclick="sendTestWeatherWebhook('${O.esc(orchard.id)}','${O.esc(orchard.weatherToken)}')">🧪 ทดสอบส่งค่า</button>` : ''}
        </div>
      </div>
      ${tokenPart ? `<div style="margin-top:8px;padding:8px 10px;background:var(--slate-50);border:1px dashed var(--slate-300);border-radius:10px;font-size:0.78rem;word-break:break-all;color:var(--slate-700);">ลิงก์รับข้อมูลอัตโนมัติ: <strong>${O.esc(tokenPart)}</strong></div>` : ''}
    `;
  }

  async function generateOrchardWeatherWebhook(orchardId) {
    try {
      const res = await AGRI_DATA.request('POST', `/api/orchards/${encodeURIComponent(orchardId)}/weather-token`, {});
      const orchard = O.getOrchard(orchardId);
      if (orchard && res.weatherToken) {
        orchard.weatherToken = res.weatherToken;
      }
      const base = AGRI_STORAGE.getApiBaseUrl() || window.location.origin;
      const fullUrl = `${base}/api/weather/webhook/${orchardId}?token=${res.weatherToken}`;
      try { await navigator.clipboard.writeText(fullUrl); } catch (e) {}
      renderStationBox(orchardId);
      if (typeof showToast === 'function') showToast('สร้างและคัดลอกลิงก์รับข้อมูลสถานีอากาศแล้ว', 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast('สร้างลิงก์ไม่สำเร็จ: ' + e.message, 'error');
    }
  }

  async function sendTestWeatherWebhook(orchardId, token) {
    try {
      const r = await fetch(AGRI_STORAGE.apiUrl(`/api/weather/webhook/${encodeURIComponent(orchardId)}?token=${encodeURIComponent(token)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempC: 27.8, humidity: 74, windKmh: 5.5, rainMm: 0, uvIndex: 3.5, source: 'ทดสอบสถานีในสวน' })
      });
      const j = await AGRI_STORAGE.parseResponseSafely(r);
      if (j && j.success) {
        if (typeof showToast === 'function') showToast('รับค่าจากสถานีวัดอากาศสำเร็จ', 'success');
        await loadStationReading(orchardId);
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('ส่งค่าทดสอบไม่สำเร็จ: ' + e.message, 'error');
    }
  }

  function refreshAll() {
    refreshScopeSelect();
    renderKPIs();
    renderUrgentAlerts();
  }

  O.onChange(refreshAll);
  AGRI_DATA.onChange(refreshAll);

  Object.assign(window, {
    onDashScopeChange: onScopeChange,
    refreshDashboardWeather: () => loadWeatherForScope(true),
    generateOrchardWeatherWebhook,
    sendTestWeatherWebhook,
    refreshExecutiveDashboard: () => { refreshAll(); loadWeatherForScope(false); }
  });

  return { refreshAll, renderKPIs, renderUrgentAlerts, loadWeatherForScope };
})();
