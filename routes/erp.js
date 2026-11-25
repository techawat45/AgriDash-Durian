// เส้นทางธุรกรรมเชื่อมโยงข้ามโมดูล (คลัง ↔ พ่นยา ↔ แรงงาน ↔ ผลผลิต ↔ สมุดบัญชี ↔ สถานีอากาศ)
const crypto = require("crypto");
const express = require("express");
const C = require("../public/js/lib/calc");

function makeErpRouter(deps) {
  const {
    auth,
    ready,
    models,
    FieldLogModel,
    PlantSurveyModel,
    AccEntryModel,
    syncSheetHelper
  } = deps;

  const {
    Orchard,
    Plot,
    Tree,
    InventoryItem,
    StockMovement,
    SprayLog,
    IrrigationLog,
    Worker,
    WorkLog,
    Advance,
    Payroll,
    Harvest,
    WeatherReading
  } = models;

  const router = express.Router();

  const ensureReady = (req, res, next) => {
    if (ready && !ready()) {
      return res.status(503).json({ success: false, message: "ฐานข้อมูลคลาวด์ยังไม่พร้อม กรุณาลองใหม่" });
    }
    next();
  };

  const genId = (prefix) =>
    `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  // ====== 1. โหลดข้อมูลทั้งระบบในคำขอเดียว ======
  router.get("/workspace", auth, ensureReady, async (req, res) => {
    const userEmail = req.userEmail;
    const q = { userEmail, deletedAt: null };
    try {
      const [
        orchards,
        plots,
        trees,
        inventory,
        stockMovements,
        sprays,
        irrigations,
        workers,
        workLogs,
        advances,
        payrolls,
        harvests,
        fieldLogs,
        plantSurveys,
        accEntries
      ] = await Promise.all([
        Orchard.find(q).sort({ createdAt: 1 }).lean(),
        Plot.find(q).sort({ createdAt: 1 }).lean(),
        Tree.find(q).sort({ createdAt: 1 }).lean(),
        InventoryItem.find(q).sort({ name: 1 }).lean(),
        StockMovement.find(q).sort({ date: -1, createdAt: -1 }).limit(500).lean(),
        SprayLog.find(q).sort({ date: -1, createdAt: -1 }).limit(300).lean(),
        IrrigationLog.find(q).sort({ date: -1, createdAt: -1 }).limit(300).lean(),
        Worker.find(q).sort({ createdAt: 1 }).lean(),
        WorkLog.find(q).sort({ date: -1, createdAt: -1 }).limit(1000).lean(),
        Advance.find(q).sort({ date: -1, createdAt: -1 }).limit(500).lean(),
        Payroll.find(q).sort({ paidDate: -1, createdAt: -1 }).limit(300).lean(),
        Harvest.find(q).sort({ date: -1, createdAt: -1 }).limit(300).lean(),
        FieldLogModel.find({ userEmail }).lean(),
        PlantSurveyModel.find({ userEmail }).lean(),
        AccEntryModel.find({ userEmail }).lean()
      ]);

      res.json({
        success: true,
        data: {
          orchards,
          plots,
          trees,
          inventory,
          stockMovements,
          sprays,
          irrigations,
          workers,
          workLogs,
          advances,
          payrolls,
          harvests,
          fieldLogs,
          plantSurveys,
          accEntries
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ====== 2. ซื้อปัจจัยการผลิตเข้าคลัง + คำนวณต้นทุนเฉลี่ย + ลงสมุดบัญชีอัตโนมัติ ======
  router.post("/inventory/purchase", auth, ensureReady, async (req, res) => {
    const userEmail = req.userEmail;
    const b = req.body || {};
    const qty = C.num(b.qty);
    const unitPrice = C.num(b.unitPrice);
    const date = b.date || new Date().toISOString().slice(0, 10);
    if (qty <= 0 || unitPrice < 0) {
      return res.status(400).json({ success: false, message: "จำนวนที่ซื้อต้องมากกว่า 0" });
    }

    try {
      const movId = b.id || genId("pur");
      // ป้องกันการบันทึกซ้ำหากส่งคำขอเดิมซ้ำ
      const existingMov = await StockMovement.findOne({ id: movId, userEmail, deletedAt: null }).lean();
      if (existingMov) {
        const itemNow = await InventoryItem.findOne({ id: existingMov.itemId, userEmail }).lean();
        return res.json({ success: true, duplicate: true, item: itemNow, movement: existingMov });
      }

      let item = b.itemId
        ? await InventoryItem.findOne({ id: String(b.itemId), userEmail, deletedAt: null })
        : null;

      if (!item) {
        const np = b.newItem || {};
        const name = String(np.name || b.itemName || "").trim();
        if (!name) return res.status(400).json({ success: false, message: "กรุณาระบุสินค้าในคลัง" });
        item = new InventoryItem({
          id: np.id || b.itemId || genId("inv"),
          userEmail,
          name,
          category: np.category || "ปุ๋ยทางดิน",
          formulation: np.formulation || "ทั่วไป",
          unit: np.unit || "กระสอบ",
          doseUnit: np.doseUnit || "กรัม",
          packSize: C.num(np.packSize),
          ratePer200LDefault: C.num(np.ratePer200LDefault),
          stockQty: 0,
          avgCost: unitPrice,
          phiDays: Math.max(0, Math.round(C.num(np.phiDays))),
          reorderLevel: Math.max(0, C.num(np.reorderLevel ?? 1)),
          activeIngredient: np.activeIngredient || "",
          note: np.note || ""
        });
      }

      const newAvg = C.calcWeightedAvgCost(item.stockQty, item.avgCost, qty, unitPrice);
      item.stockQty = C.round4(C.num(item.stockQty) + qty);
      item.avgCost = newAvg;
      await item.save();

      const totalCost = C.round2(qty * unitPrice);
      const ledgerId = b.postToLedger !== false && totalCost > 0 ? `acc-pur-${movId}` : "";

      const movement = await StockMovement.findOneAndUpdate(
        { id: movId, userEmail },
        {
          $set: {
            id: movId,
            userEmail,
            date,
            itemId: item.id,
            itemName: item.name,
            type: "in",
            qty,
            unit: item.unit,
            unitPrice,
            totalCost,
            orchardId: b.orchardId || "",
            plotId: b.plotId || "",
            vendor: b.vendor || "",
            refType: "purchase",
            refId: movId,
            ledgerId,
            note: b.note || "",
            deletedAt: null
          }
        },
        { upsert: true, new: true }
      ).lean();

      let ledgerEntry = null;
      if (ledgerId) {
        const isFert = String(item.category || "").includes("ปุ๋ย") || String(item.category || "").includes("ธาตุ");
        const category = isFert ? "ปุ๋ยและธาตุอาหาร" : (String(item.category || "").includes("วัสดุ") ? "อุปกรณ์และซ่อมบำรุง" : "ยาและฮอร์โมน");
        const plotLabel = b.plotLabel || "กองกลาง / ใช้ร่วมกัน";
        const detail = [
          `ซื้อเข้าคลัง: ${item.name} (${qty} ${item.unit} @฿${unitPrice.toLocaleString("th-TH")})`,
          b.vendor ? `ร้าน ${b.vendor}` : null,
          b.note || null
        ].filter(Boolean).join(" | ");

        ledgerEntry = await AccEntryModel.findOneAndUpdate(
          { id: ledgerId, userEmail },
          {
            $set: {
              id: ledgerId,
              userEmail,
              date,
              type: "expense",
              plot: plotLabel,
              orchardId: b.orchardId || "",
              plotId: b.plotId || "",
              category,
              detail,
              amount: totalCost,
              refType: "purchase",
              refId: movId
            }
          },
          { upsert: true, new: true }
        ).lean();

        if (syncSheetHelper) syncSheetHelper(userEmail, { accEntry: ledgerEntry }).catch(() => {});
      }

      res.json({ success: true, item: item.toObject(), movement, ledgerEntry });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ====== 3. บันทึกการพ่นยา 1 คลิก → ตัดสต็อก + บันทึก PHI + ลงสมุดบัญชีแยกตามแปลง ======
  router.post("/spray/commit", auth, ensureReady, async (req, res) => {
    const userEmail = req.userEmail;
    const b = req.body || {};
    const sprayId = b.id || genId("spr");
    const date = b.date || new Date().toISOString().slice(0, 10);
    const rawIngs = Array.isArray(b.ingredients) ? b.ingredients.filter((x) => C.num(x.ratePer200L) > 0 && (x.itemId || x.name)) : [];

    if (!rawIngs.length) {
      return res.status(400).json({ success: false, message: "กรุณาเลือกสารหรือปุ๋ยทางใบอย่างน้อย 1 รายการ" });
    }

    try {
      const existing = await SprayLog.findOne({ id: sprayId, userEmail, deletedAt: null }).lean();
      if (existing) {
        return res.json({ success: true, duplicate: true, spray: existing });
      }

      const itemIds = rawIngs.map((x) => x.itemId).filter(Boolean);
      const invDocs = itemIds.length
        ? await InventoryItem.find({ userEmail, id: { $in: itemIds }, deletedAt: null })
        : [];
      const invMap = new Map(invDocs.map((d) => [d.id, d]));

      const plan = C.calculateSprayPlan({
        date,
        tankSize: b.tankSize || 1000,
        tanks: b.tanks || 1,
        ingredients: rawIngs.map((ing) => ({
          ...ing,
          inventoryItem: ing.itemId ? invMap.get(ing.itemId) : undefined
        }))
      });

      // ตัดสต็อกจากคลังและสร้าง StockMovement
      const movements = [];
      for (let idx = 0; idx < plan.items.length; idx++) {
        const line = plan.items[idx];
        if (line.itemId && invMap.has(line.itemId) && line.stockDeducted > 0) {
          const doc = invMap.get(line.itemId);
          doc.stockQty = Math.max(0, C.round4(C.num(doc.stockQty) - line.stockDeducted));
          await doc.save();

          const movId = `mov-${sprayId}-${idx + 1}`;
          const mov = await StockMovement.findOneAndUpdate(
            { id: movId, userEmail },
            {
              $set: {
                id: movId,
                userEmail,
                date,
                itemId: doc.id,
                itemName: doc.name,
                type: "out",
                qty: line.stockDeducted,
                unit: doc.unit,
                unitPrice: line.unitCost,
                totalCost: line.cost,
                orchardId: b.orchardId || "",
                plotId: Array.isArray(b.plotIds) && b.plotIds.length === 1 ? b.plotIds[0] : "",
                refType: "spray",
                refId: sprayId,
                note: `พ่นยา ${plan.totalWaterLiters.toLocaleString("th-TH")} ลิตร`,
                deletedAt: null
              }
            },
            { upsert: true, new: true }
          ).lean();
          movements.push(mov);
        }
      }

      // เตรียมรายชื่อแปลงเป้าหมายและสัดส่วนพื้นที่สำหรับกระจายต้นทุนลงสมุดบัญชี
      const plotIds = Array.isArray(b.plotIds) ? b.plotIds.filter(Boolean) : (b.plotId ? [b.plotId] : []);
      const targetPlots = plotIds.length
        ? await Plot.find({ userEmail, id: { $in: plotIds }, deletedAt: null }).lean()
        : [];
      const orchardDoc = b.orchardId
        ? await Orchard.findOne({ userEmail, id: b.orchardId, deletedAt: null }).lean()
        : null;

      const plotNames = targetPlots.length
        ? targetPlots.map((p) => (orchardDoc ? `${orchardDoc.name} › ${p.name}` : p.name)).join(", ")
        : (orchardDoc ? `${orchardDoc.name} (ทั้งสวน)` : (b.plotNames || "กองกลาง / ใช้ร่วมกัน"));

      const ingSummary = plan.items
        .map((i) => `${i.name} (${i.totalDose.toLocaleString("th-TH")} ${i.doseUnit})`)
        .join(" + ");

      const ledgerEntries = [];
      const ledgerIds = [];
      if (b.postToLedger !== false && plan.totalCost > 0) {
        if (targetPlots.length > 1) {
          const sumArea = targetPlots.reduce((s, p) => s + Math.max(0, C.num(p.areaRai)), 0);
          let allocatedSoFar = 0;
          for (let i = 0; i < targetPlots.length; i++) {
            const p = targetPlots[i];
            const isLast = i === targetPlots.length - 1;
            const share = sumArea > 0 ? Math.max(0, C.num(p.areaRai)) / sumArea : 1 / targetPlots.length;
            const amt = isLast ? C.round2(plan.totalCost - allocatedSoFar) : C.round2(plan.totalCost * share);
            allocatedSoFar = C.round2(allocatedSoFar + amt);
            if (amt <= 0) continue;

            const lid = `acc-spr-${sprayId}-${i + 1}`;
            const label = orchardDoc ? `${orchardDoc.name} › ${p.name}` : p.name;
            const entry = await AccEntryModel.findOneAndUpdate(
              { id: lid, userEmail },
              {
                $set: {
                  id: lid,
                  userEmail,
                  date,
                  type: "expense",
                  plot: label,
                  orchardId: p.orchardId,
                  plotId: p.id,
                  category: "ยาและฮอร์โมน",
                  detail: `พ่นสาร (${plan.tankSize} ล. × ${plan.tanks} ถัง) | ${ingSummary}${b.note ? " | " + b.note : ""}`,
                  amount: amt,
                  refType: "spray",
                  refId: sprayId
                }
              },
              { upsert: true, new: true }
            ).lean();
            ledgerEntries.push(entry);
            ledgerIds.push(lid);
          }
        } else {
          const singlePlot = targetPlots[0] || null;
          const lid = `acc-spr-${sprayId}`;
          const entry = await AccEntryModel.findOneAndUpdate(
            { id: lid, userEmail },
            {
              $set: {
                id: lid,
                userEmail,
                date,
                type: "expense",
                plot: plotNames,
                orchardId: singlePlot ? singlePlot.orchardId : (b.orchardId || ""),
                plotId: singlePlot ? singlePlot.id : "",
                category: "ยาและฮอร์โมน",
                detail: `พ่นสาร (${plan.tankSize} ล. × ${plan.tanks} ถัง) | ${ingSummary}${b.note ? " | " + b.note : ""}`,
                amount: plan.totalCost,
                refType: "spray",
                refId: sprayId
              }
            },
            { upsert: true, new: true }
          ).lean();
          ledgerEntries.push(entry);
          ledgerIds.push(lid);
        }
      }

      // บันทึกเข้าประวัติงานแปลงด้วยเพื่อให้เห็นในไทม์ไลน์เดียว
      const fieldLog = await FieldLogModel.findOneAndUpdate(
        { id: `field-${sprayId}`, userEmail },
        {
          $set: {
            id: `field-${sprayId}`,
            userEmail,
            date,
            plot: plotNames,
            orchardId: b.orchardId || (targetPlots[0] && targetPlots[0].orchardId) || "",
            plotId: targetPlots.length === 1 ? targetPlots[0].id : "",
            activity: `💦 พ่นสารและปุ๋ยทางใบ${b.stage ? " (" + b.stage + ")" : ""}`,
            detail: `${ingSummary} | น้ำรวม ${plan.totalWaterLiters.toLocaleString("th-TH")} ลิตร${plan.phiUntil ? " | ปลอดภัยเก็บเกี่ยวหลัง " + plan.phiUntil : ""}`,
            cost: plan.totalCost,
            refType: "spray",
            refId: sprayId
          }
        },
        { upsert: true, new: true }
      ).lean();

      const spray = await SprayLog.findOneAndUpdate(
        { id: sprayId, userEmail },
        {
          $set: {
            id: sprayId,
            userEmail,
            date,
            orchardId: b.orchardId || (targetPlots[0] && targetPlots[0].orchardId) || "",
            plotIds: targetPlots.map((p) => p.id),
            plotNames,
            stage: b.stage || "",
            tankSize: plan.tankSize,
            tanks: plan.tanks,
            totalWaterLiters: plan.totalWaterLiters,
            ingredients: plan.items,
            totalCost: plan.totalCost,
            costPerTank: plan.costPerTank,
            maxPhiDays: plan.maxPhiDays,
            phiUntil: plan.phiUntil,
            ledgerIds,
            weatherSnapshot: b.weatherSnapshot || null,
            note: b.note || "",
            deletedAt: null
          }
        },
        { upsert: true, new: true }
      ).lean();

      if (syncSheetHelper) {
        for (const le of ledgerEntries) syncSheetHelper(userEmail, { accEntry: le }).catch(() => {});
        syncSheetHelper(userEmail, { fieldLog }).catch(() => {});
      }

      const updatedInventory = itemIds.length
        ? await InventoryItem.find({ userEmail, id: { $in: itemIds }, deletedAt: null }).lean()
        : [];

      res.json({ success: true, spray, movements, ledgerEntries, fieldLog, updatedInventory });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.delete("/spray/:id", auth, ensureReady, async (req, res) => {
    const userEmail = req.userEmail;
    const sprayId = req.params.id;
    try {
      const spray = await SprayLog.findOne({ id: sprayId, userEmail, deletedAt: null });
      if (!spray) return res.status(404).json({ success: false, message: "ไม่พบรายการพ่นสาร" });

      const movs = await StockMovement.find({ userEmail, refType: "spray", refId: sprayId, deletedAt: null });
      for (const m of movs) {
        if (m.itemId && m.qty > 0) {
          await InventoryItem.updateOne(
            { id: m.itemId, userEmail },
            { $inc: { stockQty: C.round4(m.qty) } }
          );
        }
        m.deletedAt = new Date();
        await m.save();
      }

      await AccEntryModel.deleteMany({ userEmail, refType: "spray", refId: sprayId });
      await FieldLogModel.deleteMany({ userEmail, refType: "spray", refId: sprayId });
      spray.deletedAt = new Date();
      await spray.save();

      res.json({ success: true, reversedMovements: movs.length });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ====== 4. ยืนยันจ่ายเงินเดือน/ค่าแรง → ปิดยอดเบิกล่วงหน้า + ลงสมุดบัญชี ======
  router.post("/payroll/pay", auth, ensureReady, async (req, res) => {
    const userEmail = req.userEmail;
    const b = req.body || {};
    const payrollId = b.id || genId("pay");
    const paidDate = b.paidDate || new Date().toISOString().slice(0, 10);

    if (!b.workerId) return res.status(400).json({ success: false, message: "กรุณาเลือกคนงาน" });

    try {
      const existing = await Payroll.findOne({ id: payrollId, userEmail, deletedAt: null }).lean();
      if (existing) return res.json({ success: true, duplicate: true, payroll: existing });

      const worker = await Worker.findOne({ id: String(b.workerId), userEmail, deletedAt: null }).lean();
      if (!worker) return res.status(404).json({ success: false, message: "ไม่พบข้อมูลคนงาน" });

      const logQuery = { userEmail, workerId: worker.id, paid: false, deletedAt: null };
      if (Array.isArray(b.workLogIds) && b.workLogIds.length) {
        logQuery.id = { $in: b.workLogIds.map(String) };
      } else {
        if (b.periodStart || b.periodEnd) {
          logQuery.date = {};
          if (b.periodStart) logQuery.date.$gte = String(b.periodStart);
          if (b.periodEnd) logQuery.date.$lte = String(b.periodEnd);
        }
      }
      const logs = await WorkLog.find(logQuery).sort({ date: 1 }).lean();
      const unsettledAdvances = await Advance.find({
        userEmail,
        workerId: worker.id,
        settled: false,
        deletedAt: null
      }).sort({ date: 1, createdAt: 1 });

      const calc = C.calcWorkerPayroll({
        worker,
        workLogs: logs,
        advances: unsettledAdvances,
        monthlySalaryOverride: b.monthlySalaryOverride,
        bonusOrAdjust: b.bonusOrAdjust,
        deductAdvance: b.deductAdvance !== false
      });

      if (calc.grossWage <= 0 && !logs.length) {
        return res.status(400).json({ success: false, message: "ไม่มียอดค่าแรงค้างจ่ายในช่วงที่เลือก" });
      }

      // ตัดยอดเบิกเงินล่วงหน้าตามลำดับเก่าสุดก่อน
      let remainToDeduct = calc.advanceDeducted;
      let alreadyExpensedAdvance = 0;
      const settledIds = [];
      for (const adv of unsettledAdvances) {
        if (remainToDeduct <= 0) break;
        const advAmt = Math.max(0, C.num(adv.amount));
        if (advAmt <= remainToDeduct + 1e-6) {
          adv.settled = true;
          adv.payrollId = payrollId;
          await adv.save();
          settledIds.push(adv.id);
          if (adv.ledgerId) alreadyExpensedAdvance += advAmt;
          remainToDeduct = C.round2(remainToDeduct - advAmt);
        } else {
          // หักบางส่วน: ปิดใบเดิมเท่าที่หักได้ และสร้างใบคงเหลือใหม่
          const leftAmt = C.round2(advAmt - remainToDeduct);
          adv.amount = remainToDeduct;
          adv.settled = true;
          adv.payrollId = payrollId;
          await adv.save();
          settledIds.push(adv.id);
          if (adv.ledgerId) alreadyExpensedAdvance += remainToDeduct;

          await Advance.create({
            id: genId("adv"),
            userEmail,
            date: adv.date,
            workerId: worker.id,
            workerName: worker.name,
            amount: leftAmt,
            reason: (adv.reason ? adv.reason + " " : "") + "(ยอดคงเหลือยกมา)",
            settled: false
          });
          remainToDeduct = 0;
        }
      }

      const logIds = logs.map((l) => l.id);
      if (logIds.length) {
        await WorkLog.updateMany(
          { userEmail, id: { $in: logIds } },
          { $set: { paid: true, payrollId } }
        );
      }

      // หาสวน/แปลงหลักจากงานที่ทำ หรือใช้ค่าที่ส่งมา
      const orchardId = b.orchardId || (logs.find((l) => l.orchardId) || {}).orchardId || "";
      const plotId = b.plotId || "";
      const plotLabel = b.plotLabel || "กองกลาง / ใช้ร่วมกัน";

      // ยอดลงสมุดบัญชี = ต้นทุนค่าแรงรวม (หักเฉพาะใบเบิกที่เคยลงบัญชีไปแล้ว เพื่อไม่ให้ซ้ำ)
      const ledgerAmount = Math.max(0, C.round2(calc.grossWage - alreadyExpensedAdvance));
      const ledgerId = ledgerAmount > 0 ? `acc-pay-${payrollId}` : "";
      let ledgerEntry = null;

      if (ledgerId) {
        const detail = [
          `จ่ายค่าแรง: ${worker.name}`,
          calc.workDays ? `ทำงาน ${calc.workDays} วัน` : null,
          calc.otHours ? `โอที ${calc.otHours} ชม.` : null,
          calc.advanceDeducted > 0
            ? `ค่าแรงรวม ฿${calc.grossWage.toLocaleString("th-TH")} หักเบิกล่วงหน้า ฿${calc.advanceDeducted.toLocaleString("th-TH")} จ่ายสุทธิ ฿${calc.netPaid.toLocaleString("th-TH")}`
            : `จ่ายสุทธิ ฿${calc.netPaid.toLocaleString("th-TH")}`,
          b.note || null
        ].filter(Boolean).join(" | ");

        ledgerEntry = await AccEntryModel.findOneAndUpdate(
          { id: ledgerId, userEmail },
          {
            $set: {
              id: ledgerId,
              userEmail,
              date: paidDate,
              type: "expense",
              plot: plotLabel,
              orchardId,
              plotId,
              category: "ค่าแรงคนงาน",
              detail,
              amount: ledgerAmount,
              refType: "payroll",
              refId: payrollId
            }
          },
          { upsert: true, new: true }
        ).lean();

        if (syncSheetHelper) syncSheetHelper(userEmail, { accEntry: ledgerEntry }).catch(() => {});
      }

      const payroll = await Payroll.findOneAndUpdate(
        { id: payrollId, userEmail },
        {
          $set: {
            id: payrollId,
            userEmail,
            paidDate,
            periodStart: b.periodStart || "",
            periodEnd: b.periodEnd || "",
            workerId: worker.id,
            workerName: worker.name,
            workerType: worker.workerType,
            orchardId,
            plotId,
            workDays: calc.workDays,
            otHours: calc.otHours,
            grossWage: calc.grossWage,
            advanceDeducted: calc.advanceDeducted,
            bonusOrAdjust: C.round2(b.bonusOrAdjust),
            netPaid: calc.netPaid,
            workLogIds: logIds,
            advanceIds: settledIds,
            ledgerId,
            note: b.note || "",
            deletedAt: null
          }
        },
        { upsert: true, new: true }
      ).lean();

      res.json({ success: true, payroll, ledgerEntry });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.delete("/payroll/:id", auth, ensureReady, async (req, res) => {
    const userEmail = req.userEmail;
    const payrollId = req.params.id;
    try {
      const p = await Payroll.findOne({ id: payrollId, userEmail, deletedAt: null });
      if (!p) return res.status(404).json({ success: false, message: "ไม่พบใบจ่ายค่าแรง" });
      await WorkLog.updateMany({ userEmail, payrollId }, { $set: { paid: false, payrollId: "" } });
      await Advance.updateMany({ userEmail, payrollId }, { $set: { settled: false, payrollId: "" } });
      await AccEntryModel.deleteMany({ userEmail, refType: "payroll", refId: payrollId });
      p.deletedAt = new Date();
      await p.save();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ====== 5. บันทึกผลผลิตและการขายแยกเกรด → ลงรายรับสมุดบัญชีอัตโนมัติ ======
  router.post("/harvest/commit", auth, ensureReady, async (req, res) => {
    const userEmail = req.userEmail;
    const b = req.body || {};
    const harvestId = b.id || genId("harv");
    const date = b.date || new Date().toISOString().slice(0, 10);

    const summary = C.calcHarvestSummary(b.grades || [], b.harvestCost || 0);
    if (summary.totalKg <= 0) {
      return res.status(400).json({ success: false, message: "กรุณาระบุน้ำหนักผลผลิตอย่างน้อย 1 เกรด" });
    }

    try {
      const plotDoc = b.plotId
        ? await Plot.findOne({ userEmail, id: String(b.plotId), deletedAt: null }).lean()
        : null;
      const orchardId = b.orchardId || (plotDoc && plotDoc.orchardId) || "";
      const orchardDoc = orchardId
        ? await Orchard.findOne({ userEmail, id: orchardId, deletedAt: null }).lean()
        : null;
      const plotName = b.plotName || (plotDoc
        ? (orchardDoc ? `${orchardDoc.name} › ${plotDoc.name}` : plotDoc.name)
        : (orchardDoc ? `${orchardDoc.name} (ทั้งสวน)` : "กองกลาง / ใช้ร่วมกัน"));

      const gradeDetail = summary.grades
        .filter((g) => g.kg > 0)
        .map((g) => `${g.grade}: ${g.kg.toLocaleString("th-TH")} กก. @฿${g.pricePerKg.toLocaleString("th-TH")}`)
        .join(" + ");

      let ledgerEntry = null;
      let costLedgerEntry = null;
      const ledgerId = b.postToLedger !== false && summary.grossRevenue > 0 ? `acc-harv-${harvestId}` : "";
      const costLedgerId = b.postToLedger !== false && summary.harvestCost > 0 ? `acc-harvcost-${harvestId}` : "";

      if (ledgerId) {
        ledgerEntry = await AccEntryModel.findOneAndUpdate(
          { id: ledgerId, userEmail },
          {
            $set: {
              id: ledgerId,
              userEmail,
              date,
              type: "income",
              plot: plotName,
              orchardId,
              plotId: plotDoc ? plotDoc.id : (b.plotId || ""),
              category: "รายได้ขายผลผลิต",
              detail: [
                `ขายทุเรียน ${b.variety || "หมอนทอง"} รอบที่ ${b.roundNo || 1} รวม ${summary.totalKg.toLocaleString("th-TH")} กก. (เฉลี่ย ฿${summary.avgPricePerKg.toLocaleString("th-TH")}/กก.)`,
                gradeDetail,
                b.buyer ? `ผู้รับซื้อ: ${b.buyer}` : null,
                b.note || null
              ].filter(Boolean).join(" | "),
              amount: summary.grossRevenue,
              refType: "harvest",
              refId: harvestId
            }
          },
          { upsert: true, new: true }
        ).lean();
        if (syncSheetHelper) syncSheetHelper(userEmail, { accEntry: ledgerEntry }).catch(() => {});
      }

      if (costLedgerId) {
        costLedgerEntry = await AccEntryModel.findOneAndUpdate(
          { id: costLedgerId, userEmail },
          {
            $set: {
              id: costLedgerId,
              userEmail,
              date,
              type: "expense",
              plot: plotName,
              orchardId,
              plotId: plotDoc ? plotDoc.id : (b.plotId || ""),
              category: "ค่าแรงคนงาน",
              detail: `ค่าตัดและคัดเกรดทุเรียน รอบที่ ${b.roundNo || 1} (${summary.totalKg.toLocaleString("th-TH")} กก.)`,
              amount: summary.harvestCost,
              refType: "harvest",
              refId: harvestId
            }
          },
          { upsert: true, new: true }
        ).lean();
        if (syncSheetHelper) syncSheetHelper(userEmail, { accEntry: costLedgerEntry }).catch(() => {});
      } else {
        await AccEntryModel.deleteMany({ id: `acc-harvcost-${harvestId}`, userEmail });
      }

      const harvest = await Harvest.findOneAndUpdate(
        { id: harvestId, userEmail },
        {
          $set: {
            id: harvestId,
            userEmail,
            date,
            roundNo: Math.max(1, Math.round(C.num(b.roundNo || 1))),
            orchardId,
            plotId: plotDoc ? plotDoc.id : (b.plotId || ""),
            plotName,
            variety: b.variety || "หมอนทอง",
            buyer: b.buyer || "",
            grades: summary.grades,
            totalFruits: summary.totalFruits,
            totalKg: summary.totalKg,
            grossRevenue: summary.grossRevenue,
            harvestCost: summary.harvestCost,
            netRevenue: summary.netRevenue,
            avgPricePerKg: summary.avgPricePerKg,
            ledgerId,
            costLedgerId,
            note: b.note || "",
            deletedAt: null
          }
        },
        { upsert: true, new: true }
      ).lean();

      res.json({ success: true, harvest, ledgerEntry, costLedgerEntry });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.delete("/harvest/:id", auth, ensureReady, async (req, res) => {
    const userEmail = req.userEmail;
    const harvestId = req.params.id;
    try {
      const h = await Harvest.findOne({ id: harvestId, userEmail, deletedAt: null });
      if (!h) return res.status(404).json({ success: false, message: "ไม่พบรายการเก็บเกี่ยว" });
      await AccEntryModel.deleteMany({ userEmail, refType: "harvest", refId: harvestId });
      h.deletedAt = new Date();
      await h.save();
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ====== 6. สถานีวัดอากาศส่วนตัวในสวน (Webhook รองรับ Tempest & JSON ทั่วไป) ======
  router.post("/orchards/:id/weather-token", auth, ensureReady, async (req, res) => {
    const userEmail = req.userEmail;
    try {
      const orchard = await Orchard.findOne({ id: req.params.id, userEmail, deletedAt: null });
      if (!orchard) return res.status(404).json({ success: false, message: "ไม่พบข้อมูลสวน" });
      if (!orchard.weatherToken || req.body?.rotate) {
        orchard.weatherToken = crypto.randomBytes(16).toString("hex");
        await orchard.save();
      }
      res.json({ success: true, orchardId: orchard.id, weatherToken: orchard.weatherToken });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.post("/weather/webhook/:orchardId", ensureReady, async (req, res) => {
    const orchardId = String(req.params.orchardId || "");
    const token = String(req.query.token || req.headers["x-weather-token"] || req.body?.token || "").trim();
    if (!token) return res.status(401).json({ success: false, message: "ต้องระบุรหัสยืนยันสถานีวัดอากาศ" });

    try {
      const orchard = await Orchard.findOne({ id: orchardId, deletedAt: null }).lean();
      if (!orchard || !orchard.weatherToken || orchard.weatherToken !== token) {
        return res.status(403).json({ success: false, message: "รหัสสถานีวัดอากาศไม่ถูกต้อง" });
      }

      const b = req.body || {};
      // รองรับทั้งรูปแบบ JSON มาตรฐาน และรูปแบบ Tempest Weather System (obs array / summary)
      const obs = Array.isArray(b.obs) && Array.isArray(b.obs[0]) ? null : (b.obs && typeof b.obs === "object" ? b.obs : b);
      const windMs = obs && obs.wind_avg !== undefined ? C.num(obs.wind_avg) : null;

      const tempC = obs?.tempC ?? obs?.air_temperature ?? obs?.temperature ?? null;
      const humidity = obs?.humidity ?? obs?.relative_humidity ?? obs?.rh ?? null;
      const windKmh = obs?.windKmh ?? (windMs !== null ? C.round2(windMs * 3.6) : (obs?.wind_speed ?? null));
      const rainMm = obs?.rainMm ?? obs?.rain_accumulated ?? obs?.precip ?? 0;
      const uvIndex = obs?.uvIndex ?? obs?.uv ?? null;
      const pressureHpa = obs?.pressureHpa ?? obs?.station_pressure ?? obs?.sea_level_pressure ?? null;
      const solarWm2 = obs?.solarWm2 ?? obs?.solar_radiation ?? null;

      const reading = await WeatherReading.create({
        id: genId("wx"),
        userEmail: orchard.userEmail,
        orchardId: orchard.id,
        recordedAt: b.recordedAt ? new Date(b.recordedAt) : new Date(),
        tempC: tempC !== null ? C.num(tempC) : null,
        humidity: humidity !== null ? C.num(humidity) : null,
        windKmh: windKmh !== null ? C.num(windKmh) : null,
        rainMm: C.num(rainMm),
        uvIndex: uvIndex !== null ? C.num(uvIndex) : null,
        pressureHpa: pressureHpa !== null ? C.num(pressureHpa) : null,
        solarWm2: solarWm2 !== null ? C.num(solarWm2) : null,
        source: String(b.source || b.device_type || "station"),
        raw: b
      });

      res.json({ success: true, data: reading.toObject() });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.get("/weather/latest/:orchardId", auth, ensureReady, async (req, res) => {
    try {
      const readings = await WeatherReading.find({
        userEmail: req.userEmail,
        orchardId: String(req.params.orchardId)
      })
        .sort({ recordedAt: -1 })
        .limit(24)
        .lean();
      res.json({ success: true, latest: readings[0] || null, history: readings });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  return router;
}

module.exports = { makeErpRouter };
