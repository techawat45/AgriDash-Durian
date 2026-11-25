const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/js/lib/calc.js');

test('1) แปลง ไร่-งาน-ตารางวา และตารางเมตร', () => {
  assert.equal(C.toSqWah({ rai: 1 }), 400);
  assert.equal(C.toSqWah({ rai: 2, ngan: 1, wah: 50 }), 950);
  assert.deepEqual(C.fromSqWah(950), { rai: 2, ngan: 1, wah: 50 });
  assert.equal(C.toDecimalRai({ rai: 1, ngan: 2 }), 1.5);
  assert.deepEqual(C.fromDecimalRai(2.25), { rai: 2, ngan: 1, wah: 0 });
  assert.equal(C.sqmToSqWah(1600), 400);
  assert.equal(C.sqmToRai(3200), 2);
  assert.equal(C.formatArea({ rai: 2, ngan: 1, wah: 50 }), '2 ไร่ 1 งาน 50 ตารางวา');
  assert.equal(C.treesPerRai(8, 8), 25);
  assert.equal(C.estimateTrees(4, 9, 9), 79);
});

test('2) คำนวณเนื้อที่ Polygon และสร้างผังระยะปลูกอัตโนมัติ (ประมาณ 1 ไร่ = 40×40 เมตร, 8×8 เมตร ได้ ~25 ต้น)', () => {
  const lat0 = 12.6;
  const lng0 = 102.1;
  // 40 เมตร × 40 เมตร ≈ 1,600 ตร.ม. = 1 ไร่
  const dLat = 40 / 110627;
  const dLng = 40 / (111412.84 * Math.cos((lat0 * Math.PI) / 180));
  const poly = {
    type: 'Polygon',
    coordinates: [[
      [lng0, lat0],
      [lng0 + dLng, lat0],
      [lng0 + dLng, lat0 + dLat],
      [lng0, lat0 + dLat],
      [lng0, lat0]
    ]]
  };
  const area = C.polygonAreaSqm(poly);
  assert.ok(area > 1580 && area < 1620, `พื้นที่ควรใกล้ 1,600 ตร.ม. แต่ได้ ${area}`);

  const grid = C.generateTreeGrid(poly, { spacingX: 8, spacingY: 8, marginMeters: 0, codePrefix: 'A1' });
  assert.equal(grid.length, 25);
  assert.equal(grid[0].treeCode, 'A1-001');
  assert.equal(grid[24].treeCode, 'A1-025');
});

test('3) คำนวณ VPD และป้ายแนะนำช่วงเวลาพ่นสาร', () => {
  const vpd = C.calcVPD(28, 70);
  assert.ok(vpd >= 1.0 && vpd <= 1.2, `VPD ที่ 28C/70% ควรประมาณ 1.13 แต่ได้ ${vpd}`);

  const good = C.evaluateSprayWindow({ tempC: 27, rh: 72, windKmh: 5, rainMm: 0, rainProbPct: 10, uvIndex: 3 });
  assert.equal(good.status, 'optimal');

  const windy = C.evaluateSprayWindow({ tempC: 28, rh: 70, windKmh: 18, rainMm: 0, rainProbPct: 10 });
  assert.equal(windy.status, 'stop');

  const rainy = C.evaluateSprayWindow({ tempC: 26, rh: 85, windKmh: 4, rainMm: 1.2, rainProbPct: 70 });
  assert.equal(rainy.status, 'stop');

  const caution = C.evaluateSprayWindow({ tempC: 34, rh: 65, windKmh: 12, rainMm: 0, rainProbPct: 35, uvIndex: 6 });
  assert.equal(caution.status, 'caution');
});

test('4) คลังปัจจัยการผลิต ลำดับการผสมถังพ่นยา ต้นทุน และวันครบกำหนด PHI', () => {
  // ต้นทุนเฉลี่ยถ่วงน้ำหนัก: เดิม 2 ลิตร @300 + ซื้อเพิ่ม 3 ลิตร @400 = 1800 / 5 = 360
  assert.equal(C.calcWeightedAvgCost(2, 300, 3, 400), 360);
  // แปลงหน่วยตวงเป็นหน่วยตัดสต็อก
  assert.equal(C.convertDoseToStockQty(1000, 'ซีซี', 'ลิตร'), 1);
  assert.equal(C.convertDoseToStockQty(500, 'กรัม', 'กิโลกรัม'), 0.5);

  const plan = C.calculateSprayPlan({
    date: '2026-11-24',
    tankSize: 1000,
    tanks: 2,
    ingredients: [
      { itemId: 's3', name: 'สารจับใบ', formulation: 'สารจับใบ', ratePer200L: 50, doseUnit: 'ซีซี', stockUnit: 'ลิตร', unitCost: 200, phiDays: 0 },
      { itemId: 's1', name: 'แมนโคเซบ', formulation: 'WP/WG', ratePer200L: 200, doseUnit: 'กรัม', stockUnit: 'กิโลกรัม', unitCost: 250, phiDays: 14 },
      { itemId: 's2', name: 'อะบาเมกติน', formulation: 'EC/OD', ratePer200L: 150, doseUnit: 'ซีซี', stockUnit: 'ลิตร', unitCost: 400, phiDays: 7 }
    ]
  });

  // น้ำรวม 2,000 ลิตร (ตัวคูณ 10 เท่าของอัตราต่อ 200 ลิตร)
  assert.equal(plan.totalWaterLiters, 2000);
  // ลำดับการผสมต้องเรียง WP/WG -> EC/OD -> สารจับใบ
  assert.deepEqual(plan.items.map((i) => i.name), ['แมนโคเซบ', 'อะบาเมกติน', 'สารจับใบ']);
  // ปริมาณตัดสต็อก: แมนโคเซบ 200*10=2000 กรัม = 2 กก. (@250 = 500), อะบา 1500 ซีซี = 1.5 ล. (@400 = 600), จับใบ 500 ซีซี = 0.5 ล. (@200 = 100)
  assert.equal(plan.totalCost, 1200);
  assert.equal(plan.costPerTank, 600);
  assert.equal(plan.maxPhiDays, 14);
  assert.equal(plan.phiUntil, '2026-12-08');
});

test('5) คำนวณค่าแรงคนงาน (รายวัน/โอที/เหมาถัง/เหมากิโล) และหักเบิกล่วงหน้า', () => {
  const dailyWorker = { workerType: 'daily', baseRate: 400, otHourlyRate: 60 };
  const log1 = { payMode: 'attendance', dayFraction: 1, otHours: 2 }; // 400 + 120 = 520
  const log2 = { payMode: 'attendance', dayFraction: 0.5, otHours: 0 }; // 200
  const log3 = { payMode: 'piece_tank', pieceQty: 4, pieceRate: 150 }; // 600
  assert.equal(C.calcWorkLogAmount(log1, dailyWorker), 520);
  assert.equal(C.calcWorkLogAmount(log2, dailyWorker), 200);
  assert.equal(C.calcWorkLogAmount(log3, dailyWorker), 600);

  const summary = C.calcWorkerPayroll({
    worker: dailyWorker,
    workLogs: [log1, log2, log3],
    advances: [{ amount: 500, settled: false }, { amount: 300, settled: true }]
  });
  assert.equal(summary.grossWage, 1320);
  assert.equal(summary.advanceDeducted, 500);
  assert.equal(summary.netPaid, 820);
});

test('6) บันทึกผลผลิตแยกเกรดและวิเคราะห์รายได้เฉลี่ย', () => {
  const h = C.calcHarvestSummary([
    { grade: 'เกรด AB', fruitCount: 300, kg: 1000, pricePerKg: 145 },
    { grade: 'เกรด C', fruitCount: 100, kg: 250, pricePerKg: 110 },
    { grade: 'ตกไซส์/จัมโบ้', fruitCount: 40, kg: 250, pricePerKg: 85 }
  ], 3750);
  assert.equal(h.totalFruits, 440);
  assert.equal(h.totalKg, 1500);
  assert.equal(h.grossRevenue, 193750);
  assert.equal(h.netRevenue, 190000);
  assert.equal(h.avgPricePerKg, 129.17);
});

test('7) ตัวชี้วัดผู้บริหาร 6 ใบ จุดคุ้มทุนต่อกิโลกรัม และการกระจายค่าใช้จ่ายกองกลาง', () => {
  const orchards = [{ id: 'o1', name: 'สวนหลัก', active: true }];
  const plots = [
    { id: 'p1', orchardId: 'o1', name: 'โซนเหนือ', areaRai: 4, spacingX: 8, spacingY: 8, active: true }, // 100 ต้น
    { id: 'p2', orchardId: 'o1', name: 'โซนใต้', areaRai: 6, spacingX: 8, spacingY: 8, active: true }    // 150 ต้น
  ];
  const accEntries = [
    { id: 'a1', type: 'expense', amount: 20000, orchardId: 'o1', plotId: 'p1' },
    { id: 'a2', type: 'expense', amount: 10000, orchardId: '', plotId: '' }, // กองกลาง 10,000 บาท
    { id: 'a3', type: 'income', amount: 150000, orchardId: 'o1', plotId: 'p1' }
  ];
  const harvests = [{ id: 'h1', orchardId: 'o1', plotId: 'p1', totalKg: 1000 }];

  // ดูเฉพาะแปลง p1 แบบไม่กระจายกองกลาง: รายจ่าย 20,000 / 100 ต้น = 200 บาท/ต้น, / 4 ไร่ = 5,000 บาท/ไร่, จุดคุ้มทุน 20 บาท/กก.
  const kpiNoAlloc = C.calcOrchardKPIs({ orchards, plots, accEntries, harvests, filter: 'p:p1', allocateCommon: false });
  assert.equal(kpiNoAlloc.totalExpense, 20000);
  assert.equal(kpiNoAlloc.costPerTree, 200);
  assert.equal(kpiNoAlloc.costPerRai, 5000);
  assert.equal(kpiNoAlloc.breakevenPerKg, 20);
  assert.equal(kpiNoAlloc.yieldPerTreeKg, 10);

  // ดูเฉพาะแปลง p1 แบบกระจายกองกลางตามพื้นที่ (4/10 = 40% ของ 10,000 = 4,000 -> รวม 24,000)
  const kpiAlloc = C.calcOrchardKPIs({ orchards, plots, accEntries, harvests, filter: 'p:p1', allocateCommon: true });
  assert.equal(kpiAlloc.allocatedCommonExpense, 4000);
  assert.equal(kpiAlloc.totalExpense, 24000);
  assert.equal(kpiAlloc.breakevenPerKg, 24);
});
