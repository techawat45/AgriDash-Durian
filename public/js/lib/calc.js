/* ============================================================
   AgriDash Durian Pro - คลังสูตรคำนวณหลัก (calc.js)
   ฟังก์ชันบริสุทธิ์ ใช้ร่วมกันทั้งหน้าเว็บ เซิร์ฟเวอร์ และชุดทดสอบอัตโนมัติ
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AGRI_CALC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // 1 ไร่ = 4 งาน = 400 ตารางวา = 1,600 ตารางเมตร (1 ตารางวา = 4 ตารางเมตร)
  const SQWAH_PER_NGAN = 100;
  const SQWAH_PER_RAI = 400;
  const SQM_PER_SQWAH = 4;
  const SQM_PER_RAI = 1600;

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const round4 = (v) => Math.round((num(v) + Number.EPSILON) * 10000) / 10000;

  // ====== 1. พื้นที่ไทย (ไร่-งาน-ตารางวา) และรูปหลายเหลี่ยมพิกัดภูมิศาสตร์ ======
  function toSqWah(parts) {
    const p = parts || {};
    return round2(num(p.rai) * SQWAH_PER_RAI + num(p.ngan) * SQWAH_PER_NGAN + num(p.wah));
  }

  function fromSqWah(total) {
    const t = Math.max(0, round2(num(total)));
    const rai = Math.floor(t / SQWAH_PER_RAI);
    const remain = round2(t - rai * SQWAH_PER_RAI);
    const ngan = Math.floor(remain / SQWAH_PER_NGAN);
    const wah = round2(remain - ngan * SQWAH_PER_NGAN);
    return { rai, ngan, wah };
  }

  function toDecimalRai(parts) {
    return toSqWah(parts) / SQWAH_PER_RAI;
  }

  function fromDecimalRai(rai) {
    return fromSqWah(num(rai) * SQWAH_PER_RAI);
  }

  const sqmToSqWah = (m2) => num(m2) / SQM_PER_SQWAH;
  const sqmToRai = (m2) => num(m2) / SQM_PER_RAI;
  const sqmToThaiParts = (m2) => fromSqWah(sqmToSqWah(m2));

  function formatArea(parts) {
    const p = parts || {};
    const out = [];
    if (num(p.rai)) out.push(`${num(p.rai)} ไร่`);
    if (num(p.ngan)) out.push(`${num(p.ngan)} งาน`);
    if (num(p.wah)) out.push(`${round2(num(p.wah))} ตารางวา`);
    return out.length ? out.join(' ') : '0 ไร่';
  }

  function treesPerRai(spacingX, spacingY) {
    const x = num(spacingX), y = num(spacingY);
    if (x <= 0 || y <= 0) return 0;
    return SQM_PER_RAI / (x * y);
  }

  function estimateTrees(areaRai, spacingX, spacingY) {
    return Math.floor(num(areaRai) * treesPerRai(spacingX, spacingY));
  }

  // แปลงละติจูด/ลองจิจูด เป็นพิกัดเมตรท้องถิ่นรอบจุดศูนย์กลาง
  function metersProjection(lat0Deg) {
    const rad = (lat0Deg * Math.PI) / 180;
    const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * rad) + 1.175 * Math.cos(4 * rad);
    const mPerDegLng = 111412.84 * Math.cos(rad) - 93.5 * Math.cos(3 * rad);
    return {
      toXY: (lng, lat, lng0) => [(lng - lng0) * mPerDegLng, (lat - lat0Deg) * mPerDegLat],
      toLngLat: (x, y, lng0) => [lng0 + x / mPerDegLng, lat0Deg + y / mPerDegLat]
    };
  }

  function extractRings(geojsonOrCoords) {
    if (!geojsonOrCoords) return [];
    let g = geojsonOrCoords;
    if (g.type === 'Feature') g = g.geometry;
    if (!g) return [];
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) return g.coordinates;
    if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates[0]) return g.coordinates[0];
    if (Array.isArray(g) && Array.isArray(g[0]) && typeof g[0][0] === 'number') return [g];
    if (Array.isArray(g) && Array.isArray(g[0]) && Array.isArray(g[0][0])) return g;
    return [];
  }

  function ringAreaSqm(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    const lat0 = ring.reduce((s, p) => s + num(p[1]), 0) / ring.length;
    const lng0 = ring.reduce((s, p) => s + num(p[0]), 0) / ring.length;
    const proj = metersProjection(lat0);
    const pts = ring.map((p) => proj.toXY(num(p[0]), num(p[1]), lng0));
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
  }

  function polygonAreaSqm(geojsonOrCoords) {
    const rings = extractRings(geojsonOrCoords);
    if (!rings.length) return 0;
    let area = ringAreaSqm(rings[0]);
    for (let i = 1; i < rings.length; i++) area -= ringAreaSqm(rings[i]);
    return Math.max(0, round2(area));
  }

  // ====== 2. สร้างผังระยะปลูกอัตโนมัติภายในขอบเขตแปลง ======
  function pointInRingXY(px, py, ringXY) {
    let inside = false;
    for (let i = 0, j = ringXY.length - 1; i < ringXY.length; j = i++) {
      const xi = ringXY[i][0], yi = ringXY[i][1];
      const xj = ringXY[j][0], yj = ringXY[j][1];
      const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function distPointToSegSq(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return (px - cx) * (px - cx) + (py - cy) * (py - cy);
  }

  function minDistToRingSq(px, py, ringXY) {
    let best = Infinity;
    for (let i = 0; i < ringXY.length; i++) {
      const [x1, y1] = ringXY[i];
      const [x2, y2] = ringXY[(i + 1) % ringXY.length];
      const d = distPointToSegSq(px, py, x1, y1, x2, y2);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * สร้างจุดพิกัดต้นไม้ตามระยะปลูกภายใน Polygon
   * @returns {Array<{treeCode:string, row:number, col:number, lat:number, lng:number}>}
   */
  function generateTreeGrid(geojsonOrCoords, opts = {}) {
    const rings = extractRings(geojsonOrCoords);
    if (!rings.length || rings[0].length < 3) return [];
    const spacingX = Math.max(1, num(opts.spacingX) || 8);
    const spacingY = Math.max(1, num(opts.spacingY) || 8);
    const angleRad = ((num(opts.angleDeg) || 0) * Math.PI) / 180;
    const staggered = Boolean(opts.staggered);
    const margin = Math.max(0, opts.marginMeters === undefined ? 1.5 : num(opts.marginMeters));
    const prefix = String(opts.codePrefix || 'T').trim() || 'T';
    const maxTrees = Math.max(1, Math.min(5000, num(opts.maxTrees) || 3000));

    const outer = rings[0];
    const lat0 = outer.reduce((s, p) => s + num(p[1]), 0) / outer.length;
    const lng0 = outer.reduce((s, p) => s + num(p[0]), 0) / outer.length;
    const proj = metersProjection(lat0);

    const ringsXY = rings.map((r) => r.map((p) => proj.toXY(num(p[0]), num(p[1]), lng0)));
    const cosA = Math.cos(-angleRad), sinA = Math.sin(-angleRad);
    const cosB = Math.cos(angleRad), sinB = Math.sin(angleRad);
    const rotOuter = ringsXY[0].map(([x, y]) => [x * cosA - y * sinA, x * sinA + y * cosA]);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rotOuter.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });

    const marginSq = margin * margin;
    const out = [];
    let rowIdx = 0;
    for (let ry = minY + spacingY / 2; ry <= maxY; ry += spacingY) {
      rowIdx++;
      const xOffset = staggered && rowIdx % 2 === 0 ? spacingX / 2 : 0;
      let colIdx = 0;
      for (let rx = minX + spacingX / 2 + xOffset; rx <= maxX; rx += spacingX) {
        const wx = rx * cosB - ry * sinB;
        const wy = rx * sinB + ry * cosB;
        if (!pointInRingXY(wx, wy, ringsXY[0])) continue;
        let inHole = false;
        for (let h = 1; h < ringsXY.length; h++) {
          if (pointInRingXY(wx, wy, ringsXY[h])) { inHole = true; break; }
        }
        if (inHole) continue;
        if (margin > 0 && minDistToRingSq(wx, wy, ringsXY[0]) < marginSq) continue;

        colIdx++;
        const [lng, lat] = proj.toLngLat(wx, wy, lng0);
        const seq = String(out.length + 1).padStart(3, '0');
        out.push({
          treeCode: `${prefix}-${seq}`,
          row: rowIdx,
          col: colIdx,
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6))
        });
        if (out.length >= maxTrees) return out;
      }
    }
    return out;
  }

  // ====== 3. พยากรณ์อากาศเชิงเกษตร ค่า VPD และความเหมาะสมในการพ่นสาร ======
  function calcVPD(tempC, rhPct) {
    const t = num(tempC);
    const rh = Math.max(0, Math.min(100, num(rhPct)));
    const es = 0.61078 * Math.exp((17.27 * t) / (t + 237.3));
    const vpd = es * (1 - rh / 100);
    return Math.max(0, round2(vpd));
  }

  function evaluateSprayWindow(input = {}) {
    const tempC = num(input.tempC ?? 28);
    const rh = num(input.rh ?? 70);
    const windKmh = num(input.windKmh ?? 5);
    const rainMm = num(input.rainMm ?? 0);
    const rainProbPct = num(input.rainProbPct ?? 0);
    const uvIndex = num(input.uvIndex ?? 3);
    const vpd = calcVPD(tempC, rh);

    const stopReasons = [];
    const cautionReasons = [];

    if (rainMm >= 0.5 || rainProbPct >= 55) stopReasons.push('เสี่ยงฝนตกชะล้างสารเคมี');
    if (windKmh > 15) stopReasons.push(`ลมแรงจัด ${round2(windKmh)} กม./ชม. ละอองยาปลิวสูญเสีย`);
    if (tempC >= 37 || (rh < 45 && vpd > 2.0)) stopReasons.push('อากาศร้อนจัดและแห้ง ปากใบปิด เสี่ยงใบไหม้');

    if (stopReasons.length) {
      return {
        status: 'stop',
        level: 'danger',
        label: 'งดพ่นสาร — เสี่ยงฝนชะล้างหรือสภาพอากาศไม่เหมาะสม',
        shortLabel: 'งดพ่นสาร',
        vpd,
        reasons: stopReasons
      };
    }

    if (windKmh > 10) cautionReasons.push(`ลมค่อนข้างแรง ${round2(windKmh)} กม./ชม.`);
    else if (windKmh < 1.5) cautionReasons.push('ลมสงบจัด ละอองอาจลอยค้างในพุ่มทึบ');
    if (rainProbPct >= 30) cautionReasons.push(`มีโอกาสฝนตก ${Math.round(rainProbPct)}%`);
    if (vpd < 0.35) cautionReasons.push(`ความชื้นสูงจัด ค่าแรงดันไอน้ำ ${vpd} กิโลปาสคาล น้ำยาแห้งช้า`);
    else if (vpd > 1.4) cautionReasons.push(`อากาศเริ่มแห้ง ค่าแรงดันไอน้ำ ${vpd} กิโลปาสคาล ปากใบเริ่มหรี่`);
    if (tempC > 33) cautionReasons.push(`อุณหภูมิสูง ${round2(tempC)}°C ระวังสารระเหยไว`);
    if (uvIndex >= 8) cautionReasons.push(`รังสียูวีสูงระดับ ${round2(uvIndex)} สารชีวภัณฑ์เสื่อมเร็ว`);

    if (cautionReasons.length) {
      return {
        status: 'caution',
        level: 'warning',
        label: 'ควรระวัง — ตรวจสอบแรงลมและความชื้นก่อนพ่น',
        shortLabel: 'ควรระวัง',
        vpd,
        reasons: cautionReasons
      };
    }

    return {
      status: 'optimal',
      level: 'optimal',
      label: 'เหมาะสมแก่การพ่นทางใบ — ปากใบทุเรียนเปิดรับสารได้ดี',
      shortLabel: 'เหมาะสมพ่นทางใบ',
      vpd,
      reasons: [`ค่าแรงดันไอน้ำ ${vpd} กิโลปาสคาล สมดุล ลม ${round2(windKmh)} กม./ชม.`]
    };
  }

  // ====== 4. คลังปุ๋ย/สารเคมี และการคำนวณถังพ่นยา ======
  const MIX_ORDER_MAP = {
    'ปรับสภาพน้ำ': { order: 1, stepName: 'ขั้นที่ 1 ปรับสภาพน้ำ' },
    'WP/WG': { order: 2, stepName: 'ขั้นที่ 2 สารชนิดผงหรือเม็ดละลายน้ำ' },
    'ปุ๋ยเกร็ด/ผง': { order: 2, stepName: 'ขั้นที่ 2 ปุ๋ยเกร็ดและธาตุอาหารผง' },
    'SC/SL': { order: 3, stepName: 'ขั้นที่ 3 สารชนิดครีมข้นและน้ำใส' },
    'EC/OD': { order: 4, stepName: 'ขั้นที่ 4 สารชนิดน้ำมันเข้มข้น' },
    'ธาตุอาหารน้ำ': { order: 5, stepName: 'ขั้นที่ 5 ธาตุอาหารน้ำ อะมิโน และฮอร์โมน' },
    'ทั่วไป': { order: 5, stepName: 'ขั้นที่ 5 สารบำรุงทั่วไป' },
    'สารจับใบ': { order: 6, stepName: 'ขั้นที่ 6 สารจับใบและแพร่กระจาย (ใส่ท้ายสุด)' }
  };

  function getMixOrder(formulation, category) {
    if (formulation && MIX_ORDER_MAP[formulation]) return MIX_ORDER_MAP[formulation];
    const cat = String(category || '');
    if (cat.includes('จับใบ') || cat.includes('ปรับสภาพน้ำ')) {
      return cat.includes('ปรับ') ? MIX_ORDER_MAP['ปรับสภาพน้ำ'] : MIX_ORDER_MAP['สารจับใบ'];
    }
    if (cat.includes('ปุ๋ยทางใบ') || cat.includes('ควบคุม')) return MIX_ORDER_MAP['ธาตุอาหารน้ำ'];
    return MIX_ORDER_MAP['SC/SL'];
  }

  function defaultPackSizeBase(stockUnit) {
    const u = String(stockUnit || '').trim();
    if (u === 'ลิตร' || u === 'กิโลกรัม') return 1000;
    if (u === 'แกลลอน') return 4000;
    if (u === 'กระสอบ') return 50000;
    return 1; // ซีซี, มิลลิลิตร, กรัม, ขวด, ถุง ฯลฯ (ถ้าไม่ระบุขนาดบรรจุย่อย)
  }

  function convertDoseToStockQty(totalDose, doseUnit, stockUnit, packSize) {
    const d = Math.max(0, num(totalDose));
    const du = String(doseUnit || '').trim();
    const su = String(stockUnit || '').trim();
    if (!d) return 0;
    if (du === su) return round4(d);

    const isDoseSmall = du === 'ซีซี' || du === 'มิลลิลิตร' || du === 'กรัม';
    const isDoseLarge = du === 'ลิตร' || du === 'กิโลกรัม';
    const basePerStock = num(packSize) > 0 ? num(packSize) : defaultPackSizeBase(su);

    if (isDoseSmall) {
      if (su === 'ซีซี' || su === 'มิลลิลิตร' || su === 'กรัม') return round4(d);
      return round4(d / basePerStock);
    }
    if (isDoseLarge) {
      const doseInSmall = d * 1000;
      if (su === 'ซีซี' || su === 'มิลลิลิตร' || su === 'กรัม') return round4(doseInSmall);
      return round4(doseInSmall / basePerStock);
    }
    return round4(d / (num(packSize) > 0 ? num(packSize) : 1));
  }

  function calcWeightedAvgCost(oldQty, oldAvgCost, addQty, buyUnitPrice) {
    const oq = Math.max(0, num(oldQty));
    const oc = Math.max(0, num(oldAvgCost));
    const aq = Math.max(0, num(addQty));
    const bp = Math.max(0, num(buyUnitPrice));
    if (aq <= 0) return round2(oc);
    if (oq <= 0) return round2(bp);
    return round2((oq * oc + aq * bp) / (oq + aq));
  }

  function addDaysISO(isoDate, days) {
    const parts = String(isoDate || '').split('-').map((x) => parseInt(x, 10));
    const d = parts.length === 3 && !parts.some(isNaN)
      ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
      : new Date();
    d.setUTCDate(d.getUTCDate() + Math.max(0, Math.round(num(days))));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * คำนวณแผนผสมถังพ่นยา 200 / 1,000 ลิตร พร้อมลำดับการผสม ต้นทุน และการตัดสต็อก
   */
  function calculateSprayPlan(opts = {}) {
    const tankSize = Math.max(1, num(opts.tankSize) || 1000);
    const tanks = Math.max(0.1, num(opts.tanks) || 1);
    const totalWaterLiters = round2(tankSize * tanks);
    const factorPerTank = tankSize / 200;
    const totalFactor = totalWaterLiters / 200;
    const sprayDate = opts.date || new Date().toISOString().slice(0, 10);

    let maxPhiDays = 0;
    const items = (opts.ingredients || []).map((ing) => {
      const inv = ing.inventoryItem || {};
      const ratePer200L = Math.max(0, num(ing.ratePer200L));
      const doseUnit = ing.doseUnit || inv.doseUnit || 'ซีซี';
      const stockUnit = ing.stockUnit || inv.unit || doseUnit;
      const packSize = ing.packSize ?? inv.packSize;
      const unitCost = Math.max(0, num(ing.unitCost ?? inv.avgCost));
      const phiDays = Math.max(0, Math.round(num(ing.phiDays ?? inv.phiDays)));
      if (phiDays > maxPhiDays) maxPhiDays = phiDays;

      const dosePerTank = round2(ratePer200L * factorPerTank);
      const totalDose = round2(ratePer200L * totalFactor);
      const stockDeducted = convertDoseToStockQty(totalDose, doseUnit, stockUnit, packSize);
      const cost = round2(stockDeducted * unitCost);
      const mix = getMixOrder(ing.formulation || inv.formulation, ing.category || inv.category);
      const availableStock = inv.stockQty !== undefined ? num(inv.stockQty) : null;

      return {
        itemId: ing.itemId || inv.id || '',
        name: ing.name || inv.name || '',
        category: ing.category || inv.category || '',
        formulation: ing.formulation || inv.formulation || 'SC/SL',
        mixOrder: mix.order,
        mixStepName: mix.stepName,
        ratePer200L,
        doseUnit,
        dosePerTank,
        totalDose,
        stockDeducted,
        stockUnit,
        unitCost,
        cost,
        phiDays,
        insufficientStock: availableStock !== null && stockDeducted > availableStock + 1e-6
      };
    }).sort((a, b) => a.mixOrder - b.mixOrder);

    const totalCost = round2(items.reduce((s, i) => s + i.cost, 0));
    const costPerTank = round2(tanks > 0 ? totalCost / tanks : totalCost);
    const phiUntil = maxPhiDays > 0 ? addDaysISO(sprayDate, maxPhiDays) : '';

    return {
      tankSize,
      tanks,
      totalWaterLiters,
      items,
      totalCost,
      costPerTank,
      maxPhiDays,
      phiUntil
    };
  }

  // ====== 5. แรงงานและค่าจ้างคนงาน ======
  function calcWorkLogAmount(log = {}, worker = {}) {
    const mode = log.payMode || 'attendance';
    if (mode === 'piece_tank' || mode === 'piece_kg') {
      return round2(Math.max(0, num(log.pieceQty)) * Math.max(0, num(log.pieceRate)));
    }
    if (mode === 'piece_flat') {
      return round2(Math.max(0, num(log.pieceRate || log.amount)));
    }
    // เช็กชื่อทำงานรายวัน / โอที
    const wType = worker.workerType || log.workerType || 'daily';
    const dayFraction = Math.max(0, num(log.dayFraction ?? 1));
    const otHours = Math.max(0, num(log.otHours));
    const otRate = Math.max(0, num(log.otHourlyRate ?? worker.otHourlyRate));
    if (wType === 'monthly') {
      // พนักงานรายเดือนคิดเงินเดือนตอนสรุปงวด รายวันเก็บเฉพาะค่าโอที
      return round2(otHours * otRate);
    }
    const dailyRate = Math.max(0, num(log.dailyRate ?? worker.baseRate));
    return round2(dayFraction * dailyRate + otHours * otRate);
  }

  function calcWorkerPayroll(opts = {}) {
    const worker = opts.worker || {};
    const logs = Array.isArray(opts.workLogs) ? opts.workLogs : [];
    const advances = Array.isArray(opts.advances) ? opts.advances : [];
    const bonus = num(opts.bonusOrAdjust);

    let workDays = 0;
    let otHours = 0;
    let logsWage = 0;
    logs.forEach((l) => {
      if ((l.payMode || 'attendance') === 'attendance') workDays += Math.max(0, num(l.dayFraction ?? 1));
      otHours += Math.max(0, num(l.otHours));
      logsWage += num(l.amount !== undefined ? l.amount : calcWorkLogAmount(l, worker));
    });

    const monthlyBase = worker.workerType === 'monthly'
      ? Math.max(0, num(opts.monthlySalaryOverride ?? worker.baseRate))
      : 0;

    const grossWage = round2(monthlyBase + logsWage + bonus);
    const unsettledTotal = round2(
      advances.filter((a) => !a.settled).reduce((s, a) => s + Math.max(0, num(a.amount)), 0)
    );
    const advanceDeducted = opts.deductAdvance === false
      ? 0
      : round2(Math.min(Math.max(0, grossWage), unsettledTotal));
    const netPaid = round2(grossWage - advanceDeducted);
    const unsettledLeft = round2(unsettledTotal - advanceDeducted);

    return {
      workDays: round2(workDays),
      otHours: round2(otHours),
      monthlyBase: round2(monthlyBase),
      logsWage: round2(logsWage),
      grossWage,
      unsettledTotal,
      advanceDeducted,
      netPaid,
      unsettledLeft
    };
  }

  // ====== 6. บันทึกผลผลิตและการขายแยกเกรด ======
  function calcHarvestSummary(grades = [], harvestCost = 0) {
    let totalFruits = 0;
    let totalKg = 0;
    let grossRevenue = 0;

    const rows = (grades || []).map((g) => {
      const fruitCount = Math.max(0, Math.round(num(g.fruitCount)));
      const kg = Math.max(0, num(g.kg));
      const pricePerKg = Math.max(0, num(g.pricePerKg));
      const amount = round2(kg * pricePerKg);
      totalFruits += fruitCount;
      totalKg += kg;
      grossRevenue += amount;
      return { grade: g.grade || 'เกรดรวม', fruitCount, kg: round2(kg), pricePerKg: round2(pricePerKg), amount };
    });

    totalKg = round2(totalKg);
    grossRevenue = round2(grossRevenue);
    const cost = Math.max(0, round2(num(harvestCost)));
    const netRevenue = round2(grossRevenue - cost);
    const avgPricePerKg = totalKg > 0 ? round2(grossRevenue / totalKg) : 0;

    const enriched = rows.map((r) => ({
      ...r,
      sharePct: totalKg > 0 ? round2((r.kg / totalKg) * 100) : 0
    }));

    return {
      grades: enriched,
      totalFruits,
      totalKg,
      grossRevenue,
      harvestCost: cost,
      netRevenue,
      avgPricePerKg
    };
  }

  // ====== 7. ตัวชี้วัดผู้บริหาร (KPIs) และเศรษฐศาสตร์รายต้น/รายไร่/จุดคุ้มทุน ======
  function calcOrchardKPIs(opts = {}) {
    const orchards = opts.orchards || [];
    const plots = opts.plots || [];
    const trees = opts.trees || [];
    const accEntries = opts.accEntries || [];
    const harvests = opts.harvests || [];
    const filter = String(opts.filter || 'all'); // 'all' | 'o:<id>' | 'p:<id>'
    const allocateCommon = Boolean(opts.allocateCommon);

    const activeOrchards = orchards.filter((o) => o.active !== false);
    const activePlots = plots.filter((p) => p.active !== false);

    let scopedPlots = activePlots;
    let scopedOrchards = activeOrchards;
    if (filter.startsWith('o:')) {
      const oid = filter.slice(2);
      scopedOrchards = activeOrchards.filter((o) => o.id === oid);
      scopedPlots = activePlots.filter((p) => p.orchardId === oid);
    } else if (filter.startsWith('p:')) {
      const pid = filter.slice(2);
      scopedPlots = activePlots.filter((p) => p.id === pid);
      const oid = scopedPlots[0] && scopedPlots[0].orchardId;
      scopedOrchards = oid ? activeOrchards.filter((o) => o.id === oid) : [];
    }

    const totalFarmRai = activePlots.reduce((s, p) => s + Math.max(0, num(p.areaRai)), 0) ||
      activeOrchards.reduce((s, o) => s + toDecimalRai({ rai: o.areaRai, ngan: o.areaNgan, wah: o.areaWah }), 0);

    let scopeRai = scopedPlots.reduce((s, p) => s + Math.max(0, num(p.areaRai)), 0);
    if (scopeRai <= 0 && filter !== 'all' && !filter.startsWith('p:') && scopedOrchards.length) {
      scopeRai = scopedOrchards.reduce((s, o) => s + toDecimalRai({ rai: o.areaRai, ngan: o.areaNgan, wah: o.areaWah }), 0);
    }
    if (scopeRai <= 0 && filter === 'all') scopeRai = totalFarmRai;

    const scopedPlotIds = new Set(scopedPlots.map((p) => p.id));
    const scopedOrchardIds = new Set(scopedOrchards.map((o) => o.id));

    const actualTrees = trees.filter((t) => {
      if (t.deletedAt) return false;
      if (filter === 'all') return true;
      if (filter.startsWith('p:')) return t.plotId === filter.slice(2);
      if (filter.startsWith('o:')) return t.orchardId === filter.slice(2);
      return true;
    }).length;

    const estimatedTreesCount = scopedPlots.reduce(
      (s, p) => s + estimateTrees(p.areaRai, p.spacingX, p.spacingY),
      0
    );
    const treeCount = actualTrees > 0 ? actualTrees : estimatedTreesCount;

    let directIncome = 0;
    let directExpense = 0;
    let commonIncome = 0;
    let commonExpense = 0;

    accEntries.forEach((e) => {
      if (e.deletedAt) return;
      const amt = Math.max(0, num(e.amount));
      const isCommon = !e.orchardId && !e.plotId;
      const isInc = e.type === 'income';

      if (filter === 'all') {
        if (isCommon) {
          if (isInc) commonIncome += amt; else commonExpense += amt;
        } else {
          if (isInc) directIncome += amt; else directExpense += amt;
        }
        return;
      }

      if (isCommon) {
        if (isInc) commonIncome += amt; else commonExpense += amt;
        return;
      }

      if (filter.startsWith('o:')) {
        if (e.orchardId === filter.slice(2) || scopedPlotIds.has(e.plotId)) {
          if (isInc) directIncome += amt; else directExpense += amt;
        }
      } else if (filter.startsWith('p:')) {
        const pid = filter.slice(2);
        if (e.plotId === pid) {
          if (isInc) directIncome += amt; else directExpense += amt;
        } else if (!e.plotId && scopedOrchardIds.has(e.orchardId)) {
          // รายการระดับทั้งสวน กระจายตามสัดส่วนพื้นที่ของแปลงในสวนนั้น
          const orchardRai = activePlots
            .filter((p) => p.orchardId === e.orchardId)
            .reduce((s, p) => s + Math.max(0, num(p.areaRai)), 0);
          const share = orchardRai > 0 ? scopeRai / orchardRai : 0;
          if (isInc) directIncome += amt * share; else directExpense += amt * share;
        }
      }
    });

    const areaShare = filter === 'all'
      ? 1
      : (totalFarmRai > 0 ? Math.min(1, scopeRai / totalFarmRai) : 0);

    const allocatedCommonExpense = filter === 'all'
      ? commonExpense
      : (allocateCommon ? commonExpense * areaShare : 0);
    const allocatedCommonIncome = filter === 'all'
      ? commonIncome
      : (allocateCommon ? commonIncome * areaShare : 0);

    const totalIncome = round2(directIncome + allocatedCommonIncome);
    const totalExpense = round2(directExpense + allocatedCommonExpense);
    const netProfit = round2(totalIncome - totalExpense);

    const totalHarvestKg = round2(
      harvests.filter((h) => {
        if (h.deletedAt) return false;
        if (filter === 'all') return true;
        if (filter.startsWith('p:')) return h.plotId === filter.slice(2);
        if (filter.startsWith('o:')) return h.orchardId === filter.slice(2);
        return true;
      }).reduce((s, h) => s + Math.max(0, num(h.totalKg)), 0)
    );

    const costPerTree = treeCount > 0 ? round2(totalExpense / treeCount) : 0;
    const costPerRai = scopeRai > 0 ? round2(totalExpense / scopeRai) : 0;
    const breakevenPerKg = totalHarvestKg > 0 ? round2(totalExpense / totalHarvestKg) : 0;
    const yieldPerTreeKg = treeCount > 0 ? round2(totalHarvestKg / treeCount) : 0;

    return {
      totalIncome,
      totalExpense,
      commonExpense: round2(commonExpense),
      allocatedCommonExpense: round2(allocatedCommonExpense),
      netProfit,
      areaRai: round2(scopeRai),
      treeCount,
      actualTrees,
      estimatedTreesCount,
      totalHarvestKg,
      costPerTree,
      costPerRai,
      breakevenPerKg,
      yieldPerTreeKg
    };
  }

  return {
    SQWAH_PER_RAI, SQWAH_PER_NGAN, SQM_PER_SQWAH, SQM_PER_RAI,
    num, round2, round4, addDaysISO,
    toSqWah, fromSqWah, toDecimalRai, fromDecimalRai,
    sqmToSqWah, sqmToRai, sqmToThaiParts, formatArea,
    treesPerRai, estimateTrees, polygonAreaSqm, generateTreeGrid,
    calcVPD, evaluateSprayWindow,
    getMixOrder, convertDoseToStockQty, calcWeightedAvgCost, calculateSprayPlan,
    calcWorkLogAmount, calcWorkerPayroll,
    calcHarvestSummary,
    calcOrchardKPIs
  };
});
