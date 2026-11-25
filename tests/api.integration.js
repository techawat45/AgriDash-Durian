// ทดสอบระบบ API และความเชื่อมโยงฐานข้อมูล MongoDB Atlas ครบทั้ง 7 โมดูล
const BASE = process.env.BASE || 'http://localhost:3100';
const assert = require('node:assert/strict');

let passed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log('✔', name);
  } catch (e) {
    console.error('✘', name, '\n   ', e.stack || e.message);
    process.exitCode = 1;
  }
}

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(headers || {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}

(async () => {
  const devA = 'erpa' + rid().replace(/[^a-z0-9]/gi, '');
  const devB = 'erpb' + rid().replace(/[^a-z0-9]/gi, '');
  let tA, tB;

  await step('1) ตรวจสอบสถานะเซิร์ฟเวอร์และฐานข้อมูล MongoDB Atlas', async () => {
    const r = await call('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.mongoConnected, true);
  });

  await step('2) ป้องกันการเข้าถึงโดยไม่มี Token ทุกคอลเลกชัน', async () => {
    for (const p of ['/api/orchards', '/api/plots', '/api/trees', '/api/inventory', '/api/workers', '/api/harvests', '/api/workspace']) {
      const r = await call('GET', p);
      assert.equal(r.status, 401, p);
    }
  });

  await step('3) ออก Token แยกรายผู้ใช้งาน และแยกข้อมูลไม่ปะปนกัน', async () => {
    const a = await call('POST', '/api/auth/guest', { body: { deviceId: devA } });
    const b = await call('POST', '/api/auth/guest', { body: { deviceId: devB } });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    tA = a.json.token;
    tB = b.json.token;
  });

  const orcId = 'orc-' + rid();
  const plot1 = 'plt-1-' + rid();
  const plot2 = 'plt-2-' + rid();

  await step('4) โมดูล 1: สร้างสวน ตั้งชื่อเอง และสร้างแปลงย่อยไม่จำกัด', async () => {
    const o = await call('POST', '/api/orchards', {
      token: tA,
      body: { id: orcId, name: 'สวนทุเรียนบูรพา', address: 'ขลุง จันทบุรี', lat: 12.4545, lng: 102.2215, areaRai: 10, areaNgan: 0, areaWah: 0 }
    });
    assert.equal(o.status, 200);

    const p1 = await call('POST', '/api/plots', {
      token: tA,
      body: { id: plot1, orchardId: orcId, name: 'โซนเนินตะวันออก', areaRai: 4, spacingX: 8, spacingY: 8, mainVariety: 'หมอนทอง', valveCount: 8 }
    });
    const p2 = await call('POST', '/api/plots', {
      token: tA,
      body: { id: plot2, orchardId: orcId, name: 'โซนริมสระน้ำ', areaRai: 6, spacingX: 9, spacingY: 9, mainVariety: 'พวงมณี', valveCount: 10 }
    });
    assert.equal(p1.status, 200);
    assert.equal(p2.status, 200);
    // ผู้ใช้ B ต้องมองไม่เห็น
    assert.equal((await call('GET', '/api/orchards', { token: tB })).json.data.length, 0);
  });

  await step('5) โมดูล 2: สถานีวัดอากาศส่วนตัวในสวน (สร้างรหัส + รับค่าผ่าน Webhook)', async () => {
    const tok = await call('POST', `/api/orchards/${orcId}/weather-token`, { token: tA });
    assert.equal(tok.status, 200);
    assert.ok(tok.json.weatherToken.length >= 16);

    // รหัสผิดต้องถูกปฏิเสธ
    assert.equal((await call('POST', `/api/weather/webhook/${orcId}?token=wrong`, { body: { tempC: 30 } })).status, 403);

    // ส่งค่าแบบ Tempest Weather System
    const wh = await call('POST', `/api/weather/webhook/${orcId}?token=${tok.json.weatherToken}`, {
      body: { device_type: 'tempest', obs: { air_temperature: 28.4, relative_humidity: 74, wind_avg: 1.5, rain_accumulated: 0, uv: 4.2 } }
    });
    assert.equal(wh.status, 200);
    assert.equal(wh.json.data.tempC, 28.4);
    assert.equal(wh.json.data.windKmh, 5.4); // 1.5 m/s * 3.6

    const latest = await call('GET', `/api/weather/latest/${orcId}`, { token: tA });
    assert.equal(latest.status, 200);
    assert.equal(latest.json.latest.tempC, 28.4);
  });

  const treeIds = [];
  await step('6) โมดูล 3: บันทึกทะเบียนรายต้นแบบกลุ่ม (/api/trees/bulk) พร้อมพิกัด GeoJSON 2dsphere', async () => {
    const items = [];
    for (let i = 1; i <= 10; i++) {
      const id = `tr-${i}-${rid()}`;
      treeIds.push(id);
      items.push({
        id,
        treeCode: `E-${String(i).padStart(3, '0')}`,
        orchardId: orcId,
        plotId: plot1,
        variety: 'หมอนทอง',
        age: 6,
        spacing: '8x8',
        valveZone: 'วาล์ว 1',
        health: i === 3 ? 'เฝ้าระวังไฟท็อปธอร่า' : 'ปกติ',
        stage: 'สะสมอาหาร',
        lat: 12.4545 + i * 0.00007,
        lng: 102.2215 + i * 0.00007
      });
    }
    const r = await call('POST', '/api/trees/bulk', { token: tA, body: { items } });
    assert.equal(r.status, 200);
    assert.equal(r.json.saved, 10);

    const list = await call('GET', `/api/trees?plotId=${plot1}`, { token: tA });
    assert.equal(list.json.data.length, 10);
    assert.equal(list.json.data[0].location.type, 'Point');
  });

  const invId = 'inv-' + rid();
  const purId = 'pur-' + rid();
  const sprayId = 'spr-' + rid();

  await step('7) โมดูล 4: ซื้อสารเคมีเข้าคลัง → คำนวณต้นทุนเฉลี่ย + ลงสมุดบัญชีอัตโนมัติ', async () => {
    const p1 = await call('POST', '/api/inventory/purchase', {
      token: tA,
      body: {
        id: purId,
        date: '2026-11-24',
        qty: 5,
        unitPrice: 400,
        vendor: 'ร้านเกษตรจันท์',
        newItem: {
          id: invId,
          name: 'อะบาเมกติน 1.8',
          category: 'สารป้องกันกำจัดแมลง',
          formulation: 'EC/OD',
          unit: 'ลิตร',
          doseUnit: 'ซีซี',
          phiDays: 14,
          reorderLevel: 1
        }
      }
    });
    assert.equal(p1.status, 200);
    assert.equal(p1.json.item.stockQty, 5);
    assert.equal(p1.json.item.avgCost, 400);
    assert.equal(p1.json.ledgerEntry.amount, 2000);
  });

  await step('8) โมดูล 4: พ่นยา 2 แปลง → ตัดสต็อก + กระจายรายจ่ายตามพื้นที่ไร่ + ลบแล้วย้อนสต็อกคืน', async () => {
    // น้ำ 1,000 ลิตร × 2 ถัง = 2,000 ลิตร (ตัวคูณ 10 เท่า) × 200 ซีซี = 2,000 ซีซี = 2 ลิตร (@400 = 800 บาท)
    // กระจายตามพื้นที่: plot1 (4 ไร่ = 40% = 320 บาท), plot2 (6 ไร่ = 60% = 480 บาท)
    const sp = await call('POST', '/api/spray/commit', {
      token: tA,
      body: {
        id: sprayId,
        date: '2026-11-24',
        orchardId: orcId,
        plotIds: [plot1, plot2],
        stage: 'สะสมอาหาร',
        tankSize: 1000,
        tanks: 2,
        ingredients: [{ itemId: invId, ratePer200L: 200, doseUnit: 'ซีซี' }]
      }
    });
    assert.equal(sp.status, 200);
    assert.equal(sp.json.spray.totalCost, 800);
    assert.equal(sp.json.spray.phiUntil, '2026-12-08');
    assert.equal(sp.json.updatedInventory[0].stockQty, 3); // 5 - 2 = 3 ลิตร
    assert.equal(sp.json.ledgerEntries.length, 2);
    assert.equal(sp.json.ledgerEntries[0].amount, 320);
    assert.equal(sp.json.ledgerEntries[1].amount, 480);

    // ทดสอบลบการพ่น → สต็อกต้องคืนกลับมาเป็น 5 ลิตร
    const del = await call('DELETE', `/api/spray/${sprayId}`, { token: tA });
    assert.equal(del.status, 200);
    const invNow = await call('GET', '/api/inventory', { token: tA });
    assert.equal(invNow.json.data[0].stockQty, 5);
  });

  const workerId = 'wrk-' + rid();
  const wl1 = 'wl1-' + rid();
  const wl2 = 'wl2-' + rid();
  const advId = 'adv-' + rid();
  const payId = 'pay-' + rid();

  await step('9) โมดูล 5: ทะเบียนคนงาน เช็กชื่อ+เหมาพ่น เบิกล่วงหน้า และสรุปจ่ายค่าแรงลงบัญชี', async () => {
    await call('POST', '/api/workers', {
      token: tA,
      body: { id: workerId, name: 'นายสมพร ขยันดี', workerType: 'daily', baseRate: 450, otHourlyRate: 60 }
    });
    await call('POST', '/api/work-logs', {
      token: tA,
      body: { id: wl1, date: '2026-11-23', workerId, orchardId: orcId, plotId: plot1, taskType: 'ตัดหญ้า', payMode: 'attendance', dayFraction: 1, otHours: 2, amount: 570 }
    });
    await call('POST', '/api/work-logs', {
      token: tA,
      body: { id: wl2, date: '2026-11-24', workerId, orchardId: orcId, plotId: plot1, taskType: 'พ่นยา', payMode: 'piece_tank', pieceQty: 3, pieceRate: 150, amount: 450 }
    });
    await call('POST', '/api/advances', {
      token: tA,
      body: { id: advId, date: '2026-11-23', workerId, amount: 300, reason: 'เบิกค่ากับข้าว' }
    });

    const pay = await call('POST', '/api/payroll/pay', {
      token: tA,
      body: { id: payId, paidDate: '2026-11-24', workerId, orchardId: orcId, plotId: plot1, plotLabel: 'สวนทุเรียนบูรพา › โซนเนินตะวันออก' }
    });
    assert.equal(pay.status, 200);
    assert.equal(pay.json.payroll.grossWage, 1020); // 570 + 450
    assert.equal(pay.json.payroll.advanceDeducted, 300);
    assert.equal(pay.json.payroll.netPaid, 720);
    assert.equal(pay.json.ledgerEntry.amount, 1020);
  });

  const harvId = 'harv-' + rid();
  await step('10) โมดูล 6 & 7: บันทึกตัดทุเรียนแยกเกรด → ลงรายรับสมุดบัญชี + โหลด Workspace ครบทุกคอลเลกชัน', async () => {
    const hv = await call('POST', '/api/harvest/commit', {
      token: tA,
      body: {
        id: harvId,
        date: '2026-11-24',
        roundNo: 1,
        orchardId: orcId,
        plotId: plot1,
        variety: 'หมอนทอง',
        buyer: 'ล้งเจริญผล',
        harvestCost: 2500,
        grades: [
          { grade: 'เกรด AB', fruitCount: 280, kg: 900, pricePerKg: 150 },
          { grade: 'เกรด C', fruitCount: 80, kg: 200, pricePerKg: 115 },
          { grade: 'เกรด D', fruitCount: 30, kg: 60, pricePerKg: 90 },
          { grade: 'ตกไซส์/จัมโบ้', fruitCount: 20, kg: 90, pricePerKg: 80 }
        ]
      }
    });
    assert.equal(hv.status, 200);
    assert.equal(hv.json.harvest.totalKg, 1250);
    assert.equal(hv.json.harvest.grossRevenue, 170600);
    assert.equal(hv.json.harvest.netRevenue, 168100);
    assert.equal(hv.json.ledgerEntry.amount, 170600);

    const ws = await call('GET', '/api/workspace', { token: tA });
    assert.equal(ws.status, 200);
    assert.equal(ws.json.data.orchards.length, 1);
    assert.equal(ws.json.data.plots.length, 2);
    assert.equal(ws.json.data.trees.length, 10);
    assert.equal(ws.json.data.harvests.length, 1);
    assert.ok(ws.json.data.accEntries.length >= 4);
  });

  // ล้างข้อมูลทดสอบทั้งหมดแบบถาวร (hard=1) เพื่อไม่ให้ค้างในฐานข้อมูลจริง
  await step('11) ล้างข้อมูลทดสอบออกจากฐานข้อมูลอย่างสะอาด', async () => {
    await call('POST', '/api/trees/bulk-delete', { token: tA, body: { ids: treeIds, hard: true } });
    await call('DELETE', `/api/orchards/${orcId}?hard=1`, { token: tA });
    await call('DELETE', `/api/inventory/${invId}?hard=1`, { token: tA });
    await call('DELETE', `/api/stock-movements/${purId}?hard=1`, { token: tA });
    await call('DELETE', `/api/workers/${workerId}?hard=1`, { token: tA });
    await call('DELETE', `/api/work-logs/${wl1}?hard=1`, { token: tA });
    await call('DELETE', `/api/work-logs/${wl2}?hard=1`, { token: tA });
    await call('DELETE', `/api/advances/${advId}?hard=1`, { token: tA });
    await call('DELETE', `/api/payrolls/${payId}?hard=1`, { token: tA });
    await call('DELETE', `/api/harvests/${harvId}?hard=1`, { token: tA });
    const ws = await call('GET', '/api/workspace', { token: tA });
    for (const acc of ws.json.data.accEntries) {
      await call('DELETE', `/api/data/accEntries/${acc.id}`, { token: tA });
    }
    for (const fl of ws.json.data.fieldLogs) {
      await call('DELETE', `/api/data/fieldLogs/${fl.id}`, { token: tA });
    }
  });

  console.log(`\nผ่านทั้งหมด ${passed} ขั้นตอน`);
})();
