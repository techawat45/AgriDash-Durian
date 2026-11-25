// โครงสร้างฐานข้อมูล MongoDB แบบ Relational Reference สำหรับ AgriDash Durian Pro (ครบ 7 โมดูล)
// ทุกคอลเลกชันมี userEmail (เจ้าของ), id (รหัสฝั่งไคลเอนต์), deletedAt (ลบแบบซ่อน)
module.exports = function defineModels(mongoose) {
  const { Schema } = mongoose;

  const base = {
    id: { type: String, required: true },
    userEmail: { type: String, required: true, index: true },
    deletedAt: { type: Date, default: null }
  };

  // 1. สวน (Orchard)
  const OrchardSchema = new Schema(
    {
      ...base,
      name: { type: String, required: true, trim: true, maxlength: 120 },
      address: { type: String, default: "" },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      areaRai: { type: Number, default: 0 },
      areaNgan: { type: Number, default: 0 },
      areaWah: { type: Number, default: 0 },
      active: { type: Boolean, default: true },
      note: { type: String, default: "" },
      weatherToken: { type: String, default: "" }
    },
    { timestamps: true }
  );
  OrchardSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 2. แปลงย่อย / โซน (Plot)
  const PlotSchema = new Schema(
    {
      ...base,
      orchardId: { type: String, required: true, index: true },
      name: { type: String, required: true, trim: true, maxlength: 120 },
      areaRai: { type: Number, default: 0 },
      areaNgan: { type: Number, default: 0 },
      areaWah: { type: Number, default: 0 },
      spacingX: { type: Number, default: 8 },
      spacingY: { type: Number, default: 8 },
      mainVariety: { type: String, default: "" },
      treeAge: { type: Number, default: 0 },
      valveCount: { type: Number, default: 0 },
      irrigationType: { type: String, default: "" },
      boundary: { type: Schema.Types.Mixed, default: null },
      color: { type: String, default: "#10b981" },
      active: { type: Boolean, default: true },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  PlotSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 3. ทะเบียนรายต้น (Tree) — รองรับพิกัด GeoJSON สำหรับ SW Maps และ GIS
  const TreeSchema = new Schema(
    {
      ...base,
      treeCode: { type: String, default: "" },
      orchardId: { type: String, required: true, index: true },
      plotId: { type: String, required: true, index: true },
      variety: { type: String, default: "หมอนทอง" },
      age: { type: Number, default: 0 },
      spacing: { type: String, default: "8x8" },
      valveZone: { type: String, default: "" },
      health: { type: String, default: "ปกติ" },
      stage: { type: String, default: "พักต้น" },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      location: { type: Schema.Types.Mixed, default: undefined },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  TreeSchema.index({ userEmail: 1, id: 1 }, { unique: true });
  TreeSchema.index({ location: "2dsphere" }, { sparse: true });

  // 4. คลังปุ๋ย สารเคมี และปัจจัยการผลิต (InventoryItem)
  const InventoryItemSchema = new Schema(
    {
      ...base,
      name: { type: String, required: true, trim: true, maxlength: 160 },
      category: { type: String, default: "สารป้องกันกำจัดแมลง" },
      formulation: { type: String, default: "SC/SL" },
      unit: { type: String, default: "ลิตร" },
      doseUnit: { type: String, default: "ซีซี" },
      packSize: { type: Number, default: 0 },
      ratePer200LDefault: { type: Number, default: 0 },
      stockQty: { type: Number, default: 0 },
      avgCost: { type: Number, default: 0 },
      phiDays: { type: Number, default: 0 },
      reorderLevel: { type: Number, default: 1 },
      activeIngredient: { type: String, default: "" },
      active: { type: Boolean, default: true },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  InventoryItemSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 5. ความเคลื่อนไหวสต็อก (StockMovement)
  const StockMovementSchema = new Schema(
    {
      ...base,
      date: { type: String, required: true },
      itemId: { type: String, required: true, index: true },
      itemName: { type: String, default: "" },
      type: { type: String, enum: ["in", "out", "adjust"], required: true },
      qty: { type: Number, default: 0 },
      unit: { type: String, default: "" },
      unitPrice: { type: Number, default: 0 },
      totalCost: { type: Number, default: 0 },
      orchardId: { type: String, default: "" },
      plotId: { type: String, default: "" },
      vendor: { type: String, default: "" },
      refType: { type: String, default: "" },
      refId: { type: String, default: "", index: true },
      ledgerId: { type: String, default: "" },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  StockMovementSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 6. ประวัติการพ่นสารเคมีและปุ๋ยทางใบ (SprayLog)
  const SprayLogSchema = new Schema(
    {
      ...base,
      date: { type: String, required: true },
      orchardId: { type: String, default: "", index: true },
      plotIds: { type: [String], default: [] },
      plotNames: { type: String, default: "" },
      stage: { type: String, default: "" },
      tankSize: { type: Number, default: 1000 },
      tanks: { type: Number, default: 1 },
      totalWaterLiters: { type: Number, default: 1000 },
      ingredients: { type: [Schema.Types.Mixed], default: [] },
      totalCost: { type: Number, default: 0 },
      costPerTank: { type: Number, default: 0 },
      maxPhiDays: { type: Number, default: 0 },
      phiUntil: { type: String, default: "" },
      ledgerIds: { type: [String], default: [] },
      weatherSnapshot: { type: Schema.Types.Mixed, default: null },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  SprayLogSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 7. ประวัติการให้น้ำและโซนวาล์ว (IrrigationLog)
  const IrrigationLogSchema = new Schema(
    {
      ...base,
      date: { type: String, required: true },
      orchardId: { type: String, default: "", index: true },
      plotId: { type: String, default: "", index: true },
      plotName: { type: String, default: "" },
      valveZone: { type: String, default: "" },
      durationHours: { type: Number, default: 0 },
      pumpHours: { type: Number, default: 0 },
      waterSource: { type: String, default: "" },
      energyCost: { type: Number, default: 0 },
      ledgerId: { type: String, default: "" },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  IrrigationLogSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 8. ทะเบียนคนงาน (Worker)
  const WorkerSchema = new Schema(
    {
      ...base,
      name: { type: String, required: true, trim: true, maxlength: 120 },
      nickname: { type: String, default: "" },
      workerType: { type: String, enum: ["monthly", "daily", "piece"], default: "daily" },
      baseRate: { type: Number, default: 400 },
      otHourlyRate: { type: Number, default: 60 },
      phone: { type: String, default: "" },
      role: { type: String, default: "" },
      active: { type: Boolean, default: true },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  WorkerSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 9. บันทึกการทำงานรายวันและงานเหมา (WorkLog)
  const WorkLogSchema = new Schema(
    {
      ...base,
      date: { type: String, required: true },
      workerId: { type: String, required: true, index: true },
      workerName: { type: String, default: "" },
      orchardId: { type: String, default: "", index: true },
      plotId: { type: String, default: "", index: true },
      plotName: { type: String, default: "" },
      taskType: { type: String, default: "งานทั่วไป" },
      payMode: { type: String, enum: ["attendance", "piece_tank", "piece_kg", "piece_flat"], default: "attendance" },
      dayFraction: { type: Number, default: 1 },
      otHours: { type: Number, default: 0 },
      pieceQty: { type: Number, default: 0 },
      pieceRate: { type: Number, default: 0 },
      amount: { type: Number, default: 0 },
      paid: { type: Boolean, default: false },
      payrollId: { type: String, default: "" },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  WorkLogSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 10. เบิกเงินล่วงหน้า (Advance)
  const AdvanceSchema = new Schema(
    {
      ...base,
      date: { type: String, required: true },
      workerId: { type: String, required: true, index: true },
      workerName: { type: String, default: "" },
      amount: { type: Number, required: true, default: 0 },
      reason: { type: String, default: "" },
      settled: { type: Boolean, default: false },
      payrollId: { type: String, default: "" },
      ledgerId: { type: String, default: "" },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  AdvanceSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 11. ใบสรุปจ่ายเงินเดือนและค่าแรง (Payroll)
  const PayrollSchema = new Schema(
    {
      ...base,
      paidDate: { type: String, required: true },
      periodStart: { type: String, default: "" },
      periodEnd: { type: String, default: "" },
      workerId: { type: String, required: true, index: true },
      workerName: { type: String, default: "" },
      workerType: { type: String, default: "daily" },
      orchardId: { type: String, default: "" },
      plotId: { type: String, default: "" },
      workDays: { type: Number, default: 0 },
      otHours: { type: Number, default: 0 },
      grossWage: { type: Number, default: 0 },
      advanceDeducted: { type: Number, default: 0 },
      bonusOrAdjust: { type: Number, default: 0 },
      netPaid: { type: Number, default: 0 },
      workLogIds: { type: [String], default: [] },
      advanceIds: { type: [String], default: [] },
      ledgerId: { type: String, default: "" },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  PayrollSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 12. บันทึกผลผลิตและการขายแยกเกรด (Harvest)
  const HarvestSchema = new Schema(
    {
      ...base,
      date: { type: String, required: true },
      roundNo: { type: Number, default: 1 },
      orchardId: { type: String, default: "", index: true },
      plotId: { type: String, default: "", index: true },
      plotName: { type: String, default: "" },
      variety: { type: String, default: "หมอนทอง" },
      buyer: { type: String, default: "" },
      grades: { type: [Schema.Types.Mixed], default: [] },
      totalFruits: { type: Number, default: 0 },
      totalKg: { type: Number, default: 0 },
      grossRevenue: { type: Number, default: 0 },
      harvestCost: { type: Number, default: 0 },
      netRevenue: { type: Number, default: 0 },
      avgPricePerKg: { type: Number, default: 0 },
      ledgerId: { type: String, default: "" },
      costLedgerId: { type: String, default: "" },
      note: { type: String, default: "" }
    },
    { timestamps: true }
  );
  HarvestSchema.index({ userEmail: 1, id: 1 }, { unique: true });

  // 13. ข้อมูลสถานีวัดอากาศส่วนตัวในสวน (WeatherReading)
  const WeatherReadingSchema = new Schema(
    {
      id: { type: String, required: true },
      userEmail: { type: String, required: true, index: true },
      orchardId: { type: String, required: true, index: true },
      recordedAt: { type: Date, default: Date.now, index: true },
      tempC: { type: Number, default: null },
      humidity: { type: Number, default: null },
      windKmh: { type: Number, default: null },
      rainMm: { type: Number, default: 0 },
      uvIndex: { type: Number, default: null },
      pressureHpa: { type: Number, default: null },
      solarWm2: { type: Number, default: null },
      source: { type: String, default: "station" },
      raw: { type: Schema.Types.Mixed, default: null }
    },
    { timestamps: true }
  );
  WeatherReadingSchema.index({ orchardId: 1, recordedAt: -1 });

  return {
    Orchard: mongoose.model("Orchard", OrchardSchema),
    Plot: mongoose.model("Plot", PlotSchema),
    Tree: mongoose.model("Tree", TreeSchema),
    InventoryItem: mongoose.model("InventoryItem", InventoryItemSchema),
    StockMovement: mongoose.model("StockMovement", StockMovementSchema),
    SprayLog: mongoose.model("SprayLog", SprayLogSchema),
    IrrigationLog: mongoose.model("IrrigationLog", IrrigationLogSchema),
    Worker: mongoose.model("Worker", WorkerSchema),
    WorkLog: mongoose.model("WorkLog", WorkLogSchema),
    Advance: mongoose.model("Advance", AdvanceSchema),
    Payroll: mongoose.model("Payroll", PayrollSchema),
    Harvest: mongoose.model("Harvest", HarvestSchema),
    WeatherReading: mongoose.model("WeatherReading", WeatherReadingSchema)
  };
};
