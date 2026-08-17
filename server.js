const crypto = require('crypto');
require('dotenv').config();
const dns = require('dns');

// Use Google Public DNS for reliable SRV resolution on Windows
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
  console.warn('DNS setServers notice:', e.message);
}

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const MONGODB_URI = process.env.MONGODB_URI || '';

app.use(cors());
app.use(express.json());

// Serve static frontend files from agri-dashboard directory
app.use(express.static(path.join(__dirname, 'public')));


// --- MongoDB User Schema for Auth ---
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true, index: true },
  passwordHash: { type: String, required: true },
  salt: { type: String, required: true },
  firstName: { type: String },
  lastName: { type: String },
  phone: { type: String },
  farmName: { type: String }
}, { timestamps: true });

const UserModel = mongoose.model('User', UserSchema);

// Helper functions for password hashing
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

// --- MongoDB Mongoose Schemas & Models (Scoped by userEmail) ---
const FieldLogSchema = new mongoose.Schema({
  id: String,
  userEmail: { type: String, index: true, default: 'guest' },
  date: String,
  plot: String,
  activity: String,
  detail: String,
  cost: Number
}, { timestamps: true });

const PlantSurveySchema = new mongoose.Schema({
  id: String,
  userEmail: { type: String, index: true, default: 'guest' },
  date: String,
  plot: String,
  vigour: Number,
  disease: String,
  detail: String
}, { timestamps: true });

const AccEntrySchema = new mongoose.Schema({
  id: String,
  userEmail: { type: String, index: true, default: 'guest' },
  date: String,
  type: String,
  category: String,
  detail: String,
  amount: Number
}, { timestamps: true });

const FieldLogModel = mongoose.model('FieldLog', FieldLogSchema);
const PlantSurveyModel = mongoose.model('PlantSurvey', PlantSurveySchema);
const AccEntryModel = mongoose.model('AccEntry', AccEntrySchema);

let isMongoConnected = false;

const connectMongoDB = () => {
  if (!MONGODB_URI || MONGODB_URI.includes('<db_password>')) {
    console.log('ℹ️ MongoDB URI contains placeholder <db_password> or is empty. Operating in local data.json mode.');
    return;
  }

  if (isMongoConnected) return;

  mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => {
      isMongoConnected = true;
      console.log('🟢 Successfully connected to MongoDB Atlas Cloud!');
    })
    .catch(err => {
      isMongoConnected = false;
      console.warn('⚠️ MongoDB connection notice (local data.json active):', err.message);
    });
};

connectMongoDB();
setInterval(() => {
  if (!isMongoConnected && MONGODB_URI && !MONGODB_URI.includes('<db_password>')) {
    connectMongoDB();
  }
}, 15000);

// Local JSON File Helper Functions
const initializeLocalData = () => {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = { fieldLogs: [], plantSurveys: [], accEntries: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
  }
};

const readLocalData = () => {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading local data.json:", error);
    return { fieldLogs: [], plantSurveys: [], accEntries: [] };
  }
};

const writeLocalData = (data) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error("Error writing local data.json:", error);
    return false;
  }
};


// --- Authentication API Endpoints ---

// Register Endpoint
app.post('/api/auth/register', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const password = req.body.password || '';
  const { firstName, lastName, phone, farmName } = req.body;

  if (!email || !email.includes('@') || password.length < 4) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกอีเมลให้ถูกต้อง และรหัสผ่านอย่างน้อย 4 ตัวอักษร' });
  }

  try {
    if (isMongoConnected) {
      const existingUser = await UserModel.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'อีเมลนี้ถูกสมัครใช้งานแล้ว' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      const newUser = new UserModel({ email, passwordHash, salt, firstName, lastName, phone, farmName });
      await newUser.save();
      return res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ!' });
    } else {
      // Local fallback simulation
      return res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ (โหมดจำลอง Local JSON)' });
    }
  } catch (e) {
    console.error('Register error:', e);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์: ' + e.message });
  }
});

// Login Endpoint
app.post('/api/auth/login', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const password = req.body.password || '';

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    if (isMongoConnected) {
      const user = await UserModel.findOne({ email });
      if (!user) {
        return res.status(400).json({ success: false, message: 'ไม่พบอีเมลนี้ในระบบ หรือรหัสผ่านไม่ถูกต้อง' });
      }
      const checkHash = hashPassword(password, user.salt);
      if (user.passwordHash !== checkHash) {
        return res.status(400).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });
      }
      return res.json({ success: true, email: user.email, message: 'เข้าสู่ระบบสำเร็จ!' });
    } else {
      // Offline fallback: allow access
      return res.json({ success: true, email, message: 'เข้าสู่ระบบสำเร็จ (โหมดจำลอง Local JSON)' });
    }
  } catch (e) {
    console.error('Login error:', e);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์: ' + e.message });
  }
});

// --- API Endpoints Scoped by User Email ---

// 1. GET /api/data?userEmail=... : Read user-specific data from MongoDB Atlas (or local JSON fallback)
app.get('/api/data', async (req, res) => {
  const userEmail = (req.query.userEmail || 'guest').toLowerCase().trim();

  if (isMongoConnected) {
    try {
      const fieldLogs = await FieldLogModel.find({ userEmail }).lean();
      const plantSurveys = await PlantSurveyModel.find({ userEmail }).lean();
      const accEntries = await AccEntryModel.find({ userEmail }).lean();
      return res.json({
        success: true,
        source: 'mongodb_atlas',
        userEmail,
        data: { fieldLogs, plantSurveys, accEntries }
      });
    } catch (e) {
      console.error('MongoDB read error, falling back to local file:', e.message);
    }
  }

  // Fallback to local data.json filtered by userEmail
  initializeLocalData();
  const allData = readLocalData();
  const fieldLogs = (allData.fieldLogs || []).filter(item => (item.userEmail || 'guest').toLowerCase() === userEmail);
  const plantSurveys = (allData.plantSurveys || []).filter(item => (item.userEmail || 'guest').toLowerCase() === userEmail);
  const accEntries = (allData.accEntries || []).filter(item => (item.userEmail || 'guest').toLowerCase() === userEmail);

  res.json({
    success: true,
    source: 'local_file',
    userEmail,
    data: { fieldLogs, plantSurveys, accEntries }
  });
});

// 2. POST /api/data : Save user-specific data to MongoDB Atlas and backup to local JSON
app.post('/api/data', async (req, res) => {
  const userEmail = (req.body.userEmail || 'guest').toLowerCase().trim();
  const { fieldLogs, plantSurveys, accEntries } = req.body;

  // 1. Local JSON Backup
  initializeLocalData();
  const allLocal = readLocalData();
  
  if (Array.isArray(fieldLogs)) {
    allLocal.fieldLogs = (allLocal.fieldLogs || []).filter(item => (item.userEmail || 'guest').toLowerCase() !== userEmail);
    fieldLogs.forEach(log => allLocal.fieldLogs.push({ ...log, userEmail }));
  }
  if (Array.isArray(plantSurveys)) {
    allLocal.plantSurveys = (allLocal.plantSurveys || []).filter(item => (item.userEmail || 'guest').toLowerCase() !== userEmail);
    plantSurveys.forEach(s => allLocal.plantSurveys.push({ ...s, userEmail }));
  }
  if (Array.isArray(accEntries)) {
    allLocal.accEntries = (allLocal.accEntries || []).filter(item => (item.userEmail || 'guest').toLowerCase() !== userEmail);
    accEntries.forEach(acc => allLocal.accEntries.push({ ...acc, userEmail }));
  }
  writeLocalData(allLocal);

  // 2. Sync to MongoDB Atlas Cloud scoped by userEmail
  if (isMongoConnected) {
    try {
      if (Array.isArray(fieldLogs)) {
        for (const log of fieldLogs) {
          if (log.id) {
            await FieldLogModel.findOneAndUpdate(
              { id: log.id, userEmail },
              { ...log, userEmail },
              { upsert: true, new: true }
            );
          }
        }
      }
      if (Array.isArray(plantSurveys)) {
        for (const s of plantSurveys) {
          if (s.id) {
            await PlantSurveyModel.findOneAndUpdate(
              { id: s.id, userEmail },
              { ...s, userEmail },
              { upsert: true, new: true }
            );
          }
        }
      }
      if (Array.isArray(accEntries)) {
        for (const acc of accEntries) {
          if (acc.id) {
            await AccEntryModel.findOneAndUpdate(
              { id: acc.id, userEmail },
              { ...acc, userEmail },
              { upsert: true, new: true }
            );
          }
        }
      }
      console.log(`✅ Synced private user data for [${userEmail}] with MongoDB Atlas Cloud`);
    } catch (e) {
      console.error('MongoDB sync error:', e.message);
    }
  }

  res.json({
    success: true,
    userEmail,
    message: isMongoConnected ? `บันทึกข้อมูลส่วนตัวของ (${userEmail}) ขึ้น MongoDB Atlas สำเร็จ` : `บันทึกข้อมูลส่วนตัวลงไฟล์เครื่องสำเร็จ`
  });
});

// Start backend server
app.listen(PORT, () => {
  console.log(`✅ AgriDash Backend Server running at http://localhost:${PORT}`);
});
