// ระบบ session token แบบลงลายเซ็น (HMAC-SHA256) ไม่ต้องพึ่งไลบรารีเพิ่ม
const crypto = require("crypto");

const SECRET =
  process.env.AUTH_SECRET ||
  crypto
    .createHash("sha256")
    .update("agridash-auth-v1:" + (process.env.MONGODB_URI || "dev-only-secret"))
    .digest("hex");

const TTL_MS = 1000 * 60 * 60 * 24 * 60; // 60 วัน

const b64u = (value) => Buffer.from(value).toString("base64url");
const hmac = (body) => crypto.createHmac("sha256", SECRET).update(body).digest("base64url");

function issueToken(email) {
  // อีเมลต้องเป็นตัวพิมพ์เล็กเสมอ เพื่อให้เส้นทางเดิมที่ใช้ toLowerCase() ค้นเจอเจ้าของเดียวกัน
  const body = b64u(JSON.stringify({ e: String(email).toLowerCase().trim(), exp: Date.now() + TTL_MS }));
  return body + "." + hmac(body);
}

function verifyToken(token) {
  if (typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(hmac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
    if (!payload.e || !payload.exp || payload.exp < Date.now()) return null;
    return String(payload.e);
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const email = match ? verifyToken(match[1]) : null;
  if (!email) {
    return res
      .status(401)
      .json({ success: false, code: "AUTH_REQUIRED", message: "กรุณาเข้าสู่ระบบใหม่อีกครั้ง" });
  }
  req.userEmail = email;
  next();
}

const isValidGuestDevice = (id) => /^[A-Za-z0-9]{8,40}$/.test(String(id || ""));

module.exports = { issueToken, verifyToken, requireAuth, isValidGuestDevice };
