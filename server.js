const crypto = require("crypto");
require("dotenv").config();
const dns = require("dns");

try {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
} catch (e) {
  console.warn("DNS setServers notice:", e.message);
}

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const MONGODB_URI = process.env.MONGODB_URI || "";

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

const FieldLogSchema = new mongoose.Schema({
  id: { type: String, required: true },
  userEmail: { type: String, index: true, default: "guest" },
  date: String, plot: String, activity: String, detail: String,
  cost: { type: Number, default: 0 }
}, { timestamps: true });

const PlantSurveySchema = new mongoose.Schema({
  id: { type: String, required: true },
  userEmail: { type: String, index: true, default: "guest" },
  date: String, plot: String, stage: String, leafPest: String,
  trunk: String, recommendation: String
}, { timestamps: true });

const AccEntrySchema = new mongoose.Schema({
  id: { type: String, required: true },
  userEmail: { type: String, index: true, default: "guest" },
  date: String,
  type: { type: String, enum: ["income", "expense"] },
  category: String, detail: String,
  amount: { type: Number, default: 0 }
}, { timestamps: true });

const FieldLogModel = mongoose.model("FieldLog", FieldLogSchema);
const PlantSurveyModel = mongoose.model("PlantSurvey", PlantSurveySchema);
const AccEntryModel = mongoose.model("AccEntry", AccEntrySchema);

let isMongoConnected = false;

const connectMongoDB = () => {
  if (!MONGODB_URI || MONGODB_URI.includes("<db_password>")) {
    console.log("ℹ️ MongoDB URI empty or placeholder. Operating in local data.json mode.");
    return;
  }
  if (isMongoConnected) return;
  mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => { isMongoConnected = true; console.log("🟢 Successfully connected to MongoDB Atlas Cloud!"); })
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

function validateUserEmail(req, res, next) {
  const email = (req.body.userEmail || req.query.userEmail || "guest").toLowerCase().trim();
  if (email !== "guest" && !email.includes("@")) {
    return res.status(400).json({ success: false, message: "userEmail invalid" });
  }
  next();
}

app.get("/api/health", (req, res) => {
  res.json({ success: true, status: "online", mongoConnected: isMongoConnected,
    mode: isMongoConnected ? "mongodb_atlas" : "local_json", timestamp: new Date().toISOString() });
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
      return res.json({ success: true, email: user.email, firstName: user.firstName || "", farmName: user.farmName || "", message: "เข้าสู่ระบบสำเร็จ!" });
    } else {
      return res.json({ success: true, email, firstName: "", farmName: "", message: "เข้าสู่ระบบสำเร็จ (โหมด Local)" });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

app.get("/api/data", validateUserEmail, async (req, res) => {
  const userEmail = (req.query.userEmail || "guest").toLowerCase().trim();
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

app.delete("/api/data/:collection/:id", async (req, res) => {
  const { collection, id } = req.params;
  const userEmail = (req.query.userEmail || "guest").toLowerCase().trim();
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

app.listen(PORT, () => {
  console.log(`AgriDash Backend running at http://localhost:${PORT}`);
  console.log(`Mode: ${MONGODB_URI && !MONGODB_URI.includes("<db_password>") ? "MongoDB Atlas" : "Local JSON"}`);
});