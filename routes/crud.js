// ตัวสร้างเส้นทาง CRUD ทั่วไป: กรองตามเจ้าของ (จาก token) ทุกครั้ง พร้อมรองรับ Bulk Upsert & Bulk Delete
const express = require("express");

const STRIP = ["_id", "__v", "userEmail", "createdAt", "updatedAt"];

function clean(doc) {
  const out = {};
  Object.keys(doc || {}).forEach((key) => {
    if (!STRIP.includes(key)) out[key] = doc[key];
  });
  return out;
}

function makeCrudRouter(Model, opts = {}) {
  const { auth, ready, required = [], cascade, normalize } = opts;
  const router = express.Router();

  router.use(auth);
  router.use((req, res, next) => {
    if (ready && !ready()) {
      return res
        .status(503)
        .json({ success: false, message: "ฐานข้อมูลคลาวด์ยังไม่พร้อม กรุณาลองใหม่อีกครั้ง" });
    }
    next();
  });

  const prepare = (doc) => {
    const c = clean(doc);
    return normalize ? normalize(c) : c;
  };

  const validate = (doc) => {
    if (!doc || typeof doc !== "object") return "ข้อมูลไม่ถูกต้อง";
    if (!doc.id || typeof doc.id !== "string") return "ต้องระบุรหัสรายการ";
    for (const key of required) {
      const v = doc[key];
      if (v === undefined || v === null || String(v).trim() === "") return `กรุณากรอก ${key}`;
    }
    return null;
  };

  const upsert = (userEmail, doc) => {
    const prepared = prepare(doc);
    return Model.findOneAndUpdate(
      { id: doc.id, userEmail },
      { $set: { ...prepared, userEmail, deletedAt: doc.deletedAt || null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
  };

  router.get("/", async (req, res) => {
    try {
      const query = { userEmail: req.userEmail };
      if (!req.query.all) query.deletedAt = null;
      ["orchardId", "plotId", "workerId", "itemId"].forEach((k) => {
        if (req.query[k]) query[k] = String(req.query[k]);
      });
      const data = await Model.find(query).sort({ createdAt: 1 }).lean();
      res.json({ success: true, data });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.post("/", async (req, res) => {
    const error = validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error });
    try {
      const data = await upsert(req.userEmail, req.body);
      res.json({ success: true, data });
    } catch (e) {
      res.status(400).json({ success: false, message: e.message });
    }
  });

  router.post("/bulk", async (req, res) => {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : null;
    if (!items) return res.status(400).json({ success: false, message: "ข้อมูลต้องเป็นรายการอาร์เรย์" });
    if (items.length > 5000) return res.status(400).json({ success: false, message: "ส่งได้ครั้งละไม่เกิน 5,000 รายการ" });
    try {
      const ops = [];
      const errors = [];
      for (const item of items) {
        const error = validate(item);
        if (error) {
          errors.push({ id: item && item.id, message: error });
          continue;
        }
        const prepared = prepare(item);
        ops.push({
          updateOne: {
            filter: { id: item.id, userEmail: req.userEmail },
            update: { $set: { ...prepared, userEmail: req.userEmail, deletedAt: null } },
            upsert: true
          }
        });
      }
      if (ops.length) {
        await Model.bulkWrite(ops, { ordered: false });
      }
      res.json({ success: errors.length === 0, saved: ops.length, errors });
    } catch (e) {
      res.status(400).json({ success: false, message: e.message });
    }
  });

  router.post("/bulk-delete", async (req, res) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String) : [];
    const hard = Boolean(req.body && req.body.hard);
    if (!ids.length) return res.status(400).json({ success: false, message: "ไม่มีรหัสที่ต้องการลบ" });
    try {
      const filter = { userEmail: req.userEmail, id: { $in: ids } };
      const r = hard
        ? await Model.deleteMany(filter)
        : await Model.updateMany(filter, { $set: { deletedAt: new Date() } });
      res.json({ success: true, count: r.deletedCount || r.modifiedCount || 0 });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.put("/:id", async (req, res) => {
    const doc = { ...req.body, id: req.params.id };
    try {
      const existing = await Model.findOne({ id: req.params.id, userEmail: req.userEmail }).lean();
      if (!existing) return res.status(404).json({ success: false, message: "ไม่พบรายการ" });
      const merged = { ...clean(existing), ...clean(doc) };
      const error = validate(merged);
      if (error) return res.status(400).json({ success: false, message: error });
      const data = await upsert(req.userEmail, merged);
      res.json({ success: true, data });
    } catch (e) {
      res.status(400).json({ success: false, message: e.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    const hard = req.query.hard === "1";
    try {
      const filter = { id: req.params.id, userEmail: req.userEmail };
      let found;
      if (hard) found = await Model.findOneAndDelete(filter);
      else found = await Model.findOneAndUpdate(filter, { $set: { deletedAt: new Date() } });
      if (!found) return res.status(404).json({ success: false, message: "ไม่พบรายการ" });
      if (cascade) await cascade(req.userEmail, req.params.id, hard);
      res.json({ success: true, deleted: true, hard });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  return router;
}

module.exports = { makeCrudRouter };
