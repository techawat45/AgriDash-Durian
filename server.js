const crypto = require("crypto");
require("dotenv").config();
const dns = require("dns");

if (process.platform === "win32") {
  try {
    dns.setServers(["8.8.8.8", "8.8.4.4"]);
  } catch (e) {
    console.warn("DNS setServers notice:", e.message);
  }
}

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { issueToken, requireAuth, isValidGuestDevice } = require("./lib/auth");
const { makeCrudRouter } = require("./routes/crud");
const { makeErpRouter } = require("./routes/erp");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const SHEETS_CONFIG_FILE = path.join(__dirname, "sheets-config.json");
const SHEETS_BACKUP_FILE = path.join(__dirname, "sheets-backup.json");
const MONGODB_URI = process.env.MONGODB_URI || "";
const DEFAULT_SHEET_ID = process.env.GOOGLE_SHEET_ID || "1Z5VJksCIxIYji6FrmG2faT4M27yXbnlg-rbP3e9koOY";
const DEFAULT_SHEET_URL = process.env.GOOGLE_SHEET_URL || `https://docs.google.com/spreadsheets/d/${DEFAULT_SHEET_ID}/edit`;
const DEFAULT_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbwVf9LIXdaMpM6ZVzRwWkBm561bPyzs3Hn0LevgqONarzqaJbMIlZEG513XlDqircZmBg/exec";

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true, index: true },
  passwordHash: { type: String, required: true },
  salt: { type: String, required: true },
  firstName: { type: String },
  lastName: { type: String },
  phone: { type: String },
  farmName: { type: String }
}, { timestamps: true });
const UserModel = mongoose.model("User", UserSchema);

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
}

// ฟิลด์เชื่อมโยงสวน/แปลง (ใหม่) — คง plot (ข้อความ) ไว้เป็นป้ายชื่อ ณ เวลาบันทึก รองรับข้อมูลเดิม
const linkFields = {
  orchardId: { type: String, default: "", index: true },
  plotId: { type: String, default: "", index: true },
  refType: { type: String, default: "" },
  refId: { type: String, default: "" }
};

const FieldLogSchema = new mongoose.Schema({
  id: { type: String, required: true },
  userEmail: { type: String, index: true, default: "guest" },
  date: String, plot: String, activity: String, detail: String,
  cost: { type: Number, default: 0 },
  ...linkFields
}, { timestamps: true });

const PlantSurveySchema = new mongoose.Schema({
  id: { type: String, required: true },
  userEmail: { type: String, index: true, default: "guest" },
  date: String, plot: String, stage: String, leafPest: String,
  trunk: String, recommendation: String,
  ...linkFields
}, { timestamps: true });

const AccEntrySchema = new mongoose.Schema({
  id: { type: String, required: true },
  userEmail: { type: String, index: true, default: "guest" },
  date: String,
  type: { type: String, enum: ["income", "expense"] },
  plot: { type: String, default: "รวมทุกแปลง" },
  category: String, detail: String,
  amount: { type: Number, default: 0 },
  ...linkFields
}, { timestamps: true });

const FieldLogModel = mongoose.model("FieldLog", FieldLogSchema);
const PlantSurveyModel = mongoose.model("PlantSurvey", PlantSurveySchema);
const AccEntryModel = mongoose.model("AccEntry", AccEntrySchema);

const erpModels = require("./models")(mongoose);
const { Orchard: OrchardModel, Plot: PlotModel, Tree: TreeModel } = erpModels;

const AppConfigSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  spreadsheetId: String,
  spreadsheetUrl: String,
  webhookUrl: String
}, { timestamps: true });
const AppConfigModel = mongoose.model("AppConfig", AppConfigSchema);

let isMongoConnected = false;
let cachedSheetsConfig = null;

async function syncSheetsConfigFromMongo() {
  if (!isMongoConnected) return;
  try {
    const doc = await AppConfigModel.findOne({ key: "sheets_config" }).lean();
    if (doc && doc.webhookUrl) {
      cachedSheetsConfig = {
        spreadsheetId: doc.spreadsheetId || DEFAULT_SHEET_ID,
        spreadsheetUrl: doc.spreadsheetUrl || DEFAULT_SHEET_URL,
        webhookUrl: doc.webhookUrl.trim()
      };
      writeSheetsConfig(cachedSheetsConfig);
    }
  } catch (e) {
    console.warn("Could not read sheets_config from MongoDB:", e.message);
  }
}

const connectMongoDB = () => {
  if (!MONGODB_URI || MONGODB_URI.includes("<db_password>")) {
    console.log("ℹ️ MongoDB URI empty or placeholder. Operating in local data.json mode.");
    return;
  }
  if (isMongoConnected) return;
  mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(async () => {
      isMongoConnected = true;
      console.log("🟢 Successfully connected to MongoDB Atlas Cloud!");
      await syncSheetsConfigFromMongo();
    })
    .catch(err => { isMongoConnected = false; console.warn("⚠️ MongoDB notice:", err.message); });
};

mongoose.connection.on("disconnected", () => {
  isMongoConnected = false;
  console.warn("⚠️ MongoDB disconnected. Falling back to local data.json.");
});

connectMongoDB();
setInterval(() => {
  if (!isMongoConnected && MONGODB_URI && !MONGODB_URI.includes("<db_password>")) connectMongoDB();
}, 15000);

const initializeLocalData = () => {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ fieldLogs: [], plantSurveys: [], accEntries: [] }, null, 2), "utf-8");
  }
};

const readLocalData = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    return {
      fieldLogs: Array.isArray(parsed.fieldLogs) ? parsed.fieldLogs : [],
      plantSurveys: Array.isArray(parsed.plantSurveys) ? parsed.plantSurveys : [],
      accEntries: Array.isArray(parsed.accEntries) ? parsed.accEntries : []
    };
  } catch (e) { return { fieldLogs: [], plantSurveys: [], accEntries: [] }; }
};

const writeLocalData = (data) => {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8"); return true; }
  catch (e) { console.error("Error writing local data.json:", e); return false; }
};

function readSheetsConfig() {
  let fileCfg = {};
  try {
    if (fs.existsSync(SHEETS_CONFIG_FILE)) {
      fileCfg = JSON.parse(fs.readFileSync(SHEETS_CONFIG_FILE, "utf-8"));
    }
  } catch (e) {}
  return {
    spreadsheetId: fileCfg.spreadsheetId || (cachedSheetsConfig && cachedSheetsConfig.spreadsheetId) || DEFAULT_SHEET_ID,
    spreadsheetUrl: fileCfg.spreadsheetUrl || (cachedSheetsConfig && cachedSheetsConfig.spreadsheetUrl) || DEFAULT_SHEET_URL,
    webhookUrl: (fileCfg.webhookUrl || (cachedSheetsConfig && cachedSheetsConfig.webhookUrl) || DEFAULT_WEBHOOK_URL || "").trim()
  };
}

function writeSheetsConfig(cfg) {
  cachedSheetsConfig = cfg;
  try {
    fs.writeFileSync(SHEETS_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("Error writing sheets-config.json:", e);
    return false;
  }
}

function readSheetsBackupLog() {
  try {
    if (fs.existsSync(SHEETS_BACKUP_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SHEETS_BACKUP_FILE, "utf-8"));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {}
  return [];
}

function appendSheetsBackupLog(records) {
  try {
    const existing = readSheetsBackupLog();
    const map = new Map(existing.map(r => [r.id + "::" + r.sheetName, r]));
    records.forEach(r => map.set(r.id + "::" + r.sheetName, r));
    fs.writeFileSync(SHEETS_BACKUP_FILE, JSON.stringify([...map.values()], null, 2), "utf-8");
  } catch (e) {
    console.error("Error writing sheets-backup.json:", e);
  }
}

function formatDateSlashThai(isoStr) {
  if (!isoStr) return "-";
  const parts = String(isoStr).split("-");
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const by = y < 2400 ? y + 543 : y;
    return `${parts[2]}/${parts[1]}/${by}`;
  }
  return String(isoStr);
}

function buildAccSheetRow(entry, userEmail) {
  const nowThai = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  return [
    entry.id || ("acc-" + Date.now()),
    formatDateSlashThai(entry.date),
    entry.type === "income" ? "รายรับ" : "รายจ่าย",
    entry.plot || "รวมทุกแปลง",
    entry.category || "-",
    entry.detail || "-",
    Number(entry.amount || 0),
    userEmail || entry.userEmail || "guest",
    nowThai
  ];
}

function buildFieldSheetRow(log, userEmail) {
  const nowThai = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  return [
    log.id || ("field-" + Date.now()),
    formatDateSlashThai(log.date),
    log.plot || "ทุกแปลง",
    log.activity || "-",
    log.detail || "-",
    Number(log.cost || 0),
    userEmail || log.userEmail || "guest",
    nowThai
  ];
}

function buildPlantSurveySheetRow(survey, userEmail) {
  const nowThai = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  return [
    survey.id || ("survey-" + Date.now()),
    formatDateSlashThai(survey.date),
    survey.plot || "ทุกแปลง",
    survey.stage || "-",
    survey.leafPest || "-",
    survey.trunk || "-",
    survey.recommendation || "-",
    userEmail || survey.userEmail || "guest",
    nowThai
  ];
}

async function postToGoogleSheetWebhook(sheetName, rows, itemIds = []) {
  const cfg = readSheetsConfig();
  const timestamp = new Date().toISOString();
  if (!cfg.webhookUrl) {
    appendSheetsBackupLog(rows.map((row, idx) => ({
      id: itemIds[idx] || row[0],
      sheetName,
      row,
      synced: false,
      updatedAt: timestamp
    })));
    return { synced: false, queued: true, reason: "no_webhook_configured" };
  }

  try {
    const resp = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spreadsheetId: cfg.spreadsheetId, sheetName, rows }),
      redirect: "follow",
      signal: AbortSignal.timeout(10000)
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    const ok = resp.ok && (!parsed || parsed.success !== false);
    appendSheetsBackupLog(rows.map((row, idx) => ({
      id: itemIds[idx] || row[0],
      sheetName,
      row,
      synced: ok,
      updatedAt: timestamp
    })));
    return { synced: ok, queued: !ok, responseText: text.slice(0, 200) };
  } catch (err) {
    console.warn("⚠️ Google Sheet Webhook sync failed (queued locally):", err.message);
    appendSheetsBackupLog(rows.map((row, idx) => ({
      id: itemIds[idx] || row[0],
      sheetName,
      row,
      synced: false,
      error: err.message,
      updatedAt: timestamp
    })));
    return { synced: false, queued: true, error: err.message };
  }
}

// ทุกเส้นทางข้อมูลต้องแนบ token — ระบบกำหนดเจ้าของข้อมูลจาก token เท่านั้น (ไม่เชื่อ userEmail จากไคลเอนต์)
function validateUserEmail(req, res, next) {
  return requireAuth(req, res, () => {
    if (!req.body || typeof req.body !== "object") req.body = {};
    req.body.userEmail = req.userEmail;
    next();
  });
}

// ----- เส้นทางธุรกรรมเชื่อมโยงข้ามโมดูล (คลัง, พ่นยา, แรงงาน, ผลผลิต, สถานีอากาศ) -----
const syncSheetHelper = async (userEmail, payload = {}) => {
  if (payload.accEntry) {
    await postToGoogleSheetWebhook("สมุดบัญชี", [buildAccSheetRow(payload.accEntry, userEmail)], [payload.accEntry.id]);
  }
  if (payload.fieldLog) {
    await postToGoogleSheetWebhook("งานแปลงและคำนวณปุ๋ย", [buildFieldSheetRow(payload.fieldLog, userEmail)], [payload.fieldLog.id]);
  }
  if (payload.plantSurvey) {
    await postToGoogleSheetWebhook("สำรวจสุขภาพต้น", [buildPlantSurveySheetRow(payload.plantSurvey, userEmail)], [payload.plantSurvey.id]);
  }
};

app.use("/api", makeErpRouter({
  auth: requireAuth,
  ready: () => isMongoConnected,
  models: erpModels,
  FieldLogModel,
  PlantSurveyModel,
  AccEntryModel,
  syncSheetHelper
}));

// ----- สวน / แปลง / ต้น และคอลเลกชัน ERP ทั้งหมด (CRUD ทั่วไป) -----
const crudCtx = { auth: requireAuth, ready: () => isMongoConnected };
app.use("/api/orchards", makeCrudRouter(OrchardModel, {
  ...crudCtx,
  required: ["name"],
  cascade: async (userEmail, orchardId, hard) => {
    const filter = { userEmail, orchardId };
    if (hard) { await PlotModel.deleteMany(filter); await TreeModel.deleteMany(filter); }
    else {
      const now = new Date();
      await PlotModel.updateMany(filter, { $set: { deletedAt: now } });
      await TreeModel.updateMany(filter, { $set: { deletedAt: now } });
    }
  }
}));
app.use("/api/plots", makeCrudRouter(PlotModel, {
  ...crudCtx,
  required: ["name", "orchardId"],
  cascade: async (userEmail, plotId, hard) => {
    const filter = { userEmail, plotId };
    if (hard) await TreeModel.deleteMany(filter);
    else await TreeModel.updateMany(filter, { $set: { deletedAt: new Date() } });
  }
}));
app.use("/api/trees", makeCrudRouter(TreeModel, {
  ...crudCtx,
  required: ["orchardId", "plotId"],
  normalize: (doc) => {
    const out = { ...doc };
    const lat = parseFloat(out.lat);
    const lng = parseFloat(out.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out.lat = lat;
      out.lng = lng;
      out.location = { type: "Point", coordinates: [lng, lat] };
    } else if (out.location && out.location.type === "Point" && Array.isArray(out.location.coordinates) && out.location.coordinates.length === 2) {
      out.lng = Number(out.location.coordinates[0]);
      out.lat = Number(out.location.coordinates[1]);
    } else {
      delete out.location;
    }
    return out;
  }
}));
app.use("/api/inventory", makeCrudRouter(erpModels.InventoryItem, { ...crudCtx, required: ["name"] }));
app.use("/api/stock-movements", makeCrudRouter(erpModels.StockMovement, { ...crudCtx, required: ["date", "itemId", "type"] }));
app.use("/api/sprays", makeCrudRouter(erpModels.SprayLog, { ...crudCtx, required: ["date"] }));
app.use("/api/irrigations", makeCrudRouter(erpModels.IrrigationLog, {
  ...crudCtx,
  required: ["date"],
  cascade: async (userEmail, id) => {
    await AccEntryModel.deleteMany({ userEmail, refType: "irrigation", refId: id });
  }
}));
app.use("/api/workers", makeCrudRouter(erpModels.Worker, { ...crudCtx, required: ["name"] }));
app.use("/api/work-logs", makeCrudRouter(erpModels.WorkLog, { ...crudCtx, required: ["date", "workerId"] }));
app.use("/api/advances", makeCrudRouter(erpModels.Advance, { ...crudCtx, required: ["date", "workerId"] }));
app.use("/api/payrolls", makeCrudRouter(erpModels.Payroll, { ...crudCtx, required: ["paidDate", "workerId"] }));
app.use("/api/harvests", makeCrudRouter(erpModels.Harvest, { ...crudCtx, required: ["date"] }));

app.get("/api/health", (req, res) => {
  const cfg = readSheetsConfig();
  const pendingCount = readSheetsBackupLog().filter(r => !r.synced).length;
  res.json({
    success: true,
    status: "online",
    mongoConnected: isMongoConnected,
    mode: isMongoConnected ? "mongodb_atlas" : "local_json",
    googleSheetConfigured: Boolean(cfg.webhookUrl),
    googleSheetUrl: cfg.spreadsheetUrl,
    pendingSheetSync: pendingCount,
    timestamp: new Date().toISOString()
  });
});

app.post("/api/auth/register", async (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim();
  const password = req.body.password || "";
  const { firstName, lastName, phone, farmName } = req.body;
  if (!email || !email.includes("@") || password.length < 4) {
    return res.status(400).json({ success: false, message: "กรุณากรอกอีเมลให้ถูกต้อง และรหัสผ่านอย่างน้อย 4 ตัวอักษร" });
  }
  try {
    if (isMongoConnected) {
      const existing = await UserModel.findOne({ email });
      if (existing) return res.status(400).json({ success: false, message: "อีเมลนี้ถูกสมัครใช้งานแล้ว" });
      const salt = crypto.randomBytes(16).toString("hex");
      const passwordHash = hashPassword(password, salt);
      await new UserModel({ email, passwordHash, salt, firstName, lastName, phone, farmName }).save();
      return res.json({ success: true, message: "สมัครสมาชิกสำเร็จ!" });
    } else {
      return res.json({ success: true, message: "สมัครสมาชิกสำเร็จ (โหมดจำลอง Local JSON)" });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim();
  const password = req.body.password || "";
  if (!email || !password) return res.status(400).json({ success: false, message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  try {
    if (isMongoConnected) {
      const user = await UserModel.findOne({ email });
      if (!user) return res.status(400).json({ success: false, message: "ไม่พบอีเมลนี้ในระบบ หรือรหัสผ่านไม่ถูกต้อง" });
      if (user.passwordHash !== hashPassword(password, user.salt))
        return res.status(400).json({ success: false, message: "รหัสผ่านไม่ถูกต้อง" });
      return res.json({ success: true, email: user.email, token: issueToken(user.email), firstName: user.firstName || "", farmName: user.farmName || "", message: "เข้าสู่ระบบสำเร็จ!" });
    } else {
      return res.json({ success: true, email, token: issueToken(email), firstName: "", farmName: "", message: "เข้าสู่ระบบสำเร็จ (โหมด Local)" });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// ผู้เยี่ยมชม: ออก token แยกรายเครื่อง (guest-<รหัสเครื่อง>) ข้อมูลไม่ปะปนกัน
app.post("/api/auth/guest", (req, res) => {
  const deviceId = req.body && req.body.deviceId;
  if (!isValidGuestDevice(deviceId)) {
    return res.status(400).json({ success: false, message: "รหัสเครื่องไม่ถูกต้อง" });
  }
  const email = "guest-" + String(deviceId).toLowerCase();
  res.json({ success: true, email, token: issueToken(email) });
});

// ย้ายข้อมูลเดิมของโหมดผู้เยี่ยมชมแบบเก่า (ที่ใช้บัญชี "guest" ร่วมกัน) เข้าบัญชีปัจจุบัน
app.post("/api/migrate/adopt-guest", requireAuth, async (req, res) => {
  const target = req.userEmail;
  const result = { fieldLogs: 0, plantSurveys: 0, accEntries: 0 };
  try {
    if (isMongoConnected) {
      const move = async (Model, key) => {
        const r = await Model.updateMany({ userEmail: "guest" }, { $set: { userEmail: target } });
        result[key] += r.modifiedCount || 0;
      };
      await move(FieldLogModel, "fieldLogs");
      await move(PlantSurveyModel, "plantSurveys");
      await move(AccEntryModel, "accEntries");
    }
    initializeLocalData();
    const local = readLocalData();
    ["fieldLogs", "plantSurveys", "accEntries"].forEach((key) => {
      local[key] = local[key].map((i) => ((i.userEmail || "guest").toLowerCase() === "guest" ? { ...i, userEmail: target } : i));
    });
    writeLocalData(local);
    res.json({ success: true, moved: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get("/api/data", validateUserEmail, async (req, res) => {
  const userEmail = req.userEmail;
  if (isMongoConnected) {
    try {
      const fieldLogs = await FieldLogModel.find({ userEmail }).lean();
      const plantSurveys = await PlantSurveyModel.find({ userEmail }).lean();
      const accEntries = await AccEntryModel.find({ userEmail }).lean();
      return res.json({ success: true, source: "mongodb_atlas", userEmail, data: { fieldLogs, plantSurveys, accEntries } });
    } catch (e) { console.error("MongoDB read error:", e.message); }
  }
  initializeLocalData();
  const allData = readLocalData();
  res.json({
    success: true, source: "local_file", userEmail,
    data: {
      fieldLogs: allData.fieldLogs.filter(i => (i.userEmail || "guest").toLowerCase() === userEmail),
      plantSurveys: allData.plantSurveys.filter(i => (i.userEmail || "guest").toLowerCase() === userEmail),
      accEntries: allData.accEntries.filter(i => (i.userEmail || "guest").toLowerCase() === userEmail)
    }
  });
});

app.post("/api/data", validateUserEmail, async (req, res) => {
  const userEmail = (req.body.userEmail || "guest").toLowerCase().trim();
  const { fieldLogs, plantSurveys, accEntries } = req.body;
  if (fieldLogs !== undefined && !Array.isArray(fieldLogs)) return res.status(400).json({ success: false, message: "fieldLogs must be Array" });
  if (plantSurveys !== undefined && !Array.isArray(plantSurveys)) return res.status(400).json({ success: false, message: "plantSurveys must be Array" });
  if (accEntries !== undefined && !Array.isArray(accEntries)) return res.status(400).json({ success: false, message: "accEntries must be Array" });

  initializeLocalData();
  const allLocal = readLocalData();
  if (Array.isArray(fieldLogs)) {
    allLocal.fieldLogs = allLocal.fieldLogs.filter(i => (i.userEmail || "guest").toLowerCase() !== userEmail);
    fieldLogs.forEach(log => allLocal.fieldLogs.push({ ...log, userEmail }));
  }
  if (Array.isArray(plantSurveys)) {
    allLocal.plantSurveys = allLocal.plantSurveys.filter(i => (i.userEmail || "guest").toLowerCase() !== userEmail);
    plantSurveys.forEach(s => allLocal.plantSurveys.push({ ...s, userEmail }));
  }
  if (Array.isArray(accEntries)) {
    allLocal.accEntries = allLocal.accEntries.filter(i => (i.userEmail || "guest").toLowerCase() !== userEmail);
    accEntries.forEach(acc => allLocal.accEntries.push({ ...acc, userEmail }));
  }
  writeLocalData(allLocal);

  if (isMongoConnected) {
    try {
      if (Array.isArray(fieldLogs)) for (const log of fieldLogs) if (log.id)
        await FieldLogModel.findOneAndUpdate({ id: log.id, userEmail }, { ...log, userEmail }, { upsert: true, new: true });
      if (Array.isArray(plantSurveys)) for (const s of plantSurveys) if (s.id)
        await PlantSurveyModel.findOneAndUpdate({ id: s.id, userEmail }, { ...s, userEmail }, { upsert: true, new: true });
      if (Array.isArray(accEntries)) for (const acc of accEntries) if (acc.id)
        await AccEntryModel.findOneAndUpdate({ id: acc.id, userEmail }, { ...acc, userEmail }, { upsert: true, new: true });
    } catch (e) { console.error("MongoDB sync error:", e.message); }
  }
  res.json({ success: true, userEmail, message: isMongoConnected ? "Saved to MongoDB" : "Saved locally (Offline Mode)" });
});

app.delete("/api/data/:collection/:id", validateUserEmail, async (req, res) => {
  const { collection, id } = req.params;
  const userEmail = req.userEmail;
  if (!["fieldLogs", "plantSurveys", "accEntries"].includes(collection))
    return res.status(400).json({ success: false, message: "Invalid collection" });
  initializeLocalData();
  const allLocal = readLocalData();
  const before = allLocal[collection].length;
  allLocal[collection] = allLocal[collection].filter(i => !(i.id === id && (i.userEmail || "guest").toLowerCase() === userEmail));
  writeLocalData(allLocal);
  if (isMongoConnected) {
    try {
      const Map = { fieldLogs: FieldLogModel, plantSurveys: PlantSurveyModel, accEntries: AccEntryModel };
      await Map[collection].deleteOne({ id, userEmail });
    } catch (e) { console.error("Delete error:", e.message); }
  }
  res.json({ success: true, deleted: allLocal[collection].length < before });
});

// 1-Click endpoint: บันทึกค่าใช้จ่ายจากหน้าคำนวณปุ๋ย & สารเคมี ลง MongoDB Atlas (สมุดบัญชี + งานแปลง) และ Google Sheet สำรอง
app.post("/api/ledger/calc-expense", validateUserEmail, async (req, res) => {
  const userEmail = (req.body.userEmail || "guest").toLowerCase().trim();
  const { accEntry, fieldLog } = req.body || {};

  if (!accEntry || !accEntry.id || Number(accEntry.amount || 0) <= 0) {
    return res.status(400).json({ success: false, message: "ข้อมูลค่าใช้จ่ายไม่ถูกต้อง" });
  }

  // 1. บันทึกลง local data.json เสมอเพื่อสำรองข้อมูลทันที
  initializeLocalData();
  const allLocal = readLocalData();
  allLocal.accEntries = [
    { ...accEntry, userEmail },
    ...allLocal.accEntries.filter(i => i.id !== accEntry.id)
  ];
  if (fieldLog && fieldLog.id) {
    allLocal.fieldLogs = [
      { ...fieldLog, userEmail },
      ...allLocal.fieldLogs.filter(i => i.id !== fieldLog.id)
    ];
  }
  const localSaved = writeLocalData(allLocal);

  // 2. บันทึกลง MongoDB Atlas (ไม่ล้มเหลวหากฐานข้อมูลออฟไลน์ชั่วคราว)
  let mongoSaved = false;
  let mongoError = null;
  if (isMongoConnected) {
    try {
      await AccEntryModel.findOneAndUpdate(
        { id: accEntry.id, userEmail },
        { ...accEntry, userEmail },
        { upsert: true, new: true }
      );
      if (fieldLog && fieldLog.id) {
        await FieldLogModel.findOneAndUpdate(
          { id: fieldLog.id, userEmail },
          { ...fieldLog, userEmail },
          { upsert: true, new: true }
        );
      }
      mongoSaved = true;
    } catch (e) {
      mongoError = e.message;
      console.error("MongoDB calc-expense save error:", e.message);
    }
  }

  // 3. ส่งสำรองเข้า Google Sheet
  const accSheetRes = await postToGoogleSheetWebhook(
    "สมุดบัญชี",
    [buildAccSheetRow(accEntry, userEmail)],
    [accEntry.id]
  );
  let fieldSheetRes = null;
  if (fieldLog && fieldLog.id) {
    fieldSheetRes = await postToGoogleSheetWebhook(
      "งานแปลงและคำนวณปุ๋ย",
      [buildFieldSheetRow(fieldLog, userEmail)],
      [fieldLog.id]
    );
  }

  const cfg = readSheetsConfig();
  res.json({
    success: true,
    mongoSaved,
    mongoError,
    localSaved,
    sheetSynced: accSheetRes.synced,
    sheetQueued: accSheetRes.queued,
    fieldSheetSynced: fieldSheetRes ? fieldSheetRes.synced : null,
    spreadsheetUrl: cfg.spreadsheetUrl,
    message: mongoSaved
      ? (accSheetRes.synced ? "บันทึกเข้า MongoDB Atlas และ Google Sheet สำเร็จ!" : "บันทึกเข้า MongoDB Atlas สำเร็จ (สำรองเข้าคิว Google Sheet แล้ว)")
      : (accSheetRes.synced ? "ฐานข้อมูลออฟไลน์ — บันทึกสำรองลง Google Sheet และเครื่องสำเร็จ!" : "บันทึกสำรองลงเครื่องเรียบร้อย")
  });
});

// อ่าน/บันทึกการตั้งค่า Google Sheet Webhook
app.get("/api/sheets/config", requireAuth, async (req, res) => {
  if (isMongoConnected && (!cachedSheetsConfig || !cachedSheetsConfig.webhookUrl)) {
    await syncSheetsConfigFromMongo();
  }
  const cfg = readSheetsConfig();
  const backupLog = readSheetsBackupLog();
  res.json({
    success: true,
    spreadsheetId: cfg.spreadsheetId,
    spreadsheetUrl: cfg.spreadsheetUrl,
    configured: Boolean(cfg.webhookUrl),
    webhookUrl: cfg.webhookUrl,
    pendingCount: backupLog.filter(r => !r.synced).length,
    syncedCount: backupLog.filter(r => r.synced).length
  });
});

app.post("/api/sheets/config", requireAuth, async (req, res) => {
  const { webhookUrl, spreadsheetId } = req.body || {};
  const current = readSheetsConfig();
  const nextCfg = {
    spreadsheetId: (spreadsheetId || current.spreadsheetId || DEFAULT_SHEET_ID).trim(),
    spreadsheetUrl: spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId.trim()}/edit` : current.spreadsheetUrl,
    webhookUrl: typeof webhookUrl === "string" ? webhookUrl.trim() : current.webhookUrl
  };
  writeSheetsConfig(nextCfg);

  if (isMongoConnected) {
    try {
      await AppConfigModel.findOneAndUpdate(
        { key: "sheets_config" },
        { key: "sheets_config", ...nextCfg },
        { upsert: true, new: true }
      );
    } catch (e) {
      console.warn("Could not save sheets_config to MongoDB:", e.message);
    }
  }

  // อัปเดต .env ด้วยเพื่อให้คงอยู่หลังรีสตาร์ท
  try {
    const envPath = path.join(__dirname, ".env");
    if (fs.existsSync(envPath)) {
      let envText = fs.readFileSync(envPath, "utf-8");
      if (/^GOOGLE_SHEETS_WEBHOOK_URL=.*$/m.test(envText)) {
        envText = envText.replace(/^GOOGLE_SHEETS_WEBHOOK_URL=.*$/m, `GOOGLE_SHEETS_WEBHOOK_URL=${nextCfg.webhookUrl}`);
      } else {
        envText += `\nGOOGLE_SHEETS_WEBHOOK_URL=${nextCfg.webhookUrl}`;
      }
      fs.writeFileSync(envPath, envText, "utf-8");
    }
  } catch (e) {
    console.warn("Could not update .env webhook:", e.message);
  }

  res.json({
    success: true,
    configured: Boolean(nextCfg.webhookUrl),
    spreadsheetUrl: nextCfg.spreadsheetUrl,
    message: nextCfg.webhookUrl ? "บันทึกลิงก์เชื่อมต่อ Google Sheet เรียบร้อย" : "ล้างการตั้งค่า Webhook แล้ว"
  });
});

// ส่งรายการเดี่ยวหรือหลายรายการเข้า Google Sheet
app.post("/api/sheets/sync", validateUserEmail, async (req, res) => {
  const userEmail = (req.body.userEmail || "guest").toLowerCase().trim();
  const { accEntry, fieldLog, plantSurvey } = req.body || {};
  const results = {};
  if (accEntry) {
    results.acc = await postToGoogleSheetWebhook("สมุดบัญชี", [buildAccSheetRow(accEntry, userEmail)], [accEntry.id]);
  }
  if (fieldLog) {
    results.field = await postToGoogleSheetWebhook("งานแปลงและคำนวณปุ๋ย", [buildFieldSheetRow(fieldLog, userEmail)], [fieldLog.id]);
  }
  if (plantSurvey) {
    results.plant = await postToGoogleSheetWebhook("สำรวจสุขภาพต้น", [buildPlantSurveySheetRow(plantSurvey, userEmail)], [plantSurvey.id]);
  }
  const cfg = readSheetsConfig();
  res.json({
    success: true,
    configured: Boolean(cfg.webhookUrl),
    spreadsheetUrl: cfg.spreadsheetUrl,
    results
  });
});

// ซิงค์ข้อมูลทั้งหมด (MongoDB / Local + คิวค้างส่ง) ขึ้น Google Sheet
app.post("/api/sheets/flush", validateUserEmail, async (req, res) => {
  const userEmail = (req.body.userEmail || "guest").toLowerCase().trim();
  if (isMongoConnected && (!cachedSheetsConfig || !cachedSheetsConfig.webhookUrl)) {
    await syncSheetsConfigFromMongo();
  }
  const cfg = readSheetsConfig();
  if (!cfg.webhookUrl) {
    return res.status(400).json({ success: false, message: "ยังไม่ได้ใส่ลิงก์ Google Apps Script Web App" });
  }

  let accEntries = [];
  let fieldLogs = [];
  let plantSurveys = [];
  if (isMongoConnected) {
    try {
      accEntries = await AccEntryModel.find({ userEmail }).lean();
      fieldLogs = await FieldLogModel.find({ userEmail }).lean();
      plantSurveys = await PlantSurveyModel.find({ userEmail }).lean();
    } catch (e) {}
  }
  if (!accEntries.length && !fieldLogs.length && !plantSurveys.length) {
    const local = readLocalData();
    accEntries = local.accEntries.filter(i => (i.userEmail || "guest").toLowerCase() === userEmail);
    fieldLogs = local.fieldLogs.filter(i => (i.userEmail || "guest").toLowerCase() === userEmail);
    plantSurveys = local.plantSurveys.filter(i => (i.userEmail || "guest").toLowerCase() === userEmail);
  }

  let accRes = { synced: true };
  let fieldRes = { synced: true };
  let plantRes = { synced: true };
  if (accEntries.length > 0) {
    accRes = await postToGoogleSheetWebhook(
      "สมุดบัญชี",
      accEntries.map(e => buildAccSheetRow(e, userEmail)),
      accEntries.map(e => e.id)
    );
  }
  if (fieldLogs.length > 0) {
    fieldRes = await postToGoogleSheetWebhook(
      "งานแปลงและคำนวณปุ๋ย",
      fieldLogs.map(l => buildFieldSheetRow(l, userEmail)),
      fieldLogs.map(l => l.id)
    );
  }
  if (plantSurveys.length > 0) {
    plantRes = await postToGoogleSheetWebhook(
      "สำรวจสุขภาพต้น",
      plantSurveys.map(s => buildPlantSurveySheetRow(s, userEmail)),
      plantSurveys.map(s => s.id)
    );
  }

  const allOk = accRes.synced && fieldRes.synced && plantRes.synced;
  res.json({
    success: allOk,
    accCount: accEntries.length,
    fieldCount: fieldLogs.length,
    plantCount: plantSurveys.length,
    spreadsheetUrl: cfg.spreadsheetUrl,
    message: allOk
      ? `ซิงค์ข้อมูลบัญชี ${accEntries.length} รายการ, งานแปลง ${fieldLogs.length} รายการ และสำรวจต้น ${plantSurveys.length} รายการ ขึ้น Google Sheet สำเร็จ!`
      : "เชื่อมต่อ Webhook ไม่สำเร็จ กรุณาตรวจสอบลิงก์และสิทธิ์การเข้าถึง (Anyone)"
  });
});

app.listen(PORT, () => {
  console.log(`AgriDash Backend running at http://localhost:${PORT}`);
  console.log(`Mode: ${MONGODB_URI && !MONGODB_URI.includes("<db_password>") ? "MongoDB Atlas" : "Local JSON"}`);
});