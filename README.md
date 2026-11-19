# 🌳 AgriDash Durian Pro v3.0
ระบบบริหารจัดการสวนทุเรียนอัจฉริยะ ออกแบบมาเพื่อการทำงานภาคสนาม รองรับทั้งคอมพิวเตอร์ แท็บเล็ต และสมาร์ทโฟน

---

## ✨ จุดเด่นและฟีเจอร์หลัก (Key Features)

1. **อินเทอร์เฟซภาษาไทย 100% ใช้งานง่าย (Clean Thai UI)**
   - ตัดคำภาษาอังกฤษในวงเล็บที่ไม่จำเป็นออกทั้งหมด อ่านง่าย ชัดเจน
   - โทนสีและฟอนต์คมชัดสูง (High Contrast) ออกแบบให้อ่านง่ายแม้อยู่กลางแดดจ้าในแปลงสวน

2. **เมนูนำทางสะดวกทุกอุปกรณ์ (Responsive Navigation)**
   - คอมพิวเตอร์: แถบเมนูด้านบนที่กระชับ ไม่เบียดตา
   - มือถือ/แท็บเล็ต: แถบเมนูด้านล่าง (Bottom Navigation Bar) พร้อมปุ่ม `+` ตรงกลางสำหรับกดบันทึกรายการด่วนขณะเดินตรวจสวน

3. **สมุดบัญชีรายรับ-รายจ่าย (Agri-Ledger)**
   - การ์ดสรุปยอดเงิน 3 ใบ: **รายรับรวม**, **รายจ่ายรวม**, และ **กำไร/ขาดทุนสุทธิ**
   - ตัวกรองรายการตามเดือนและแปลงสวน
   - ฟอร์มบันทึกรายการขนาดใหญ่ กดง่ายในมือถือ พร้อมระบบช่วยพิมพ์แนะนำอัตโนมัติ (Autocomplete)

4. **คำนวณปุ๋ย & สารเคมี พร้อมส่งเข้าบัญชีในคลิกเดียว (1-Click Sync)**
   - คำนวณสูตรปุ๋ยและสารเคมีตามระยะการเติบโตของทุเรียน
   - ปุ่มลัดส่งยอดค่าใช้จ่ายจากการคำนวณเข้าสู่ "สมุดบัญชี" และสำรองเข้า Google Sheet อัตโนมัติ

5. **ระบบฐานข้อมูลแบบ 2 ชั้น มั่นใจข้อมูลไม่สูญหาย (Dual Storage Architecture)**
   - **ฐานข้อมูลหลัก:** MongoDB Atlas สำหรับการทำงานแบบ Real-time และความปลอดภัยสูง
   - **ฐานข้อมูลสำรอง:** Google Sheets สำหรับดูข้อมูลแบบตารางและสำรองข้อมูลกรณีเครือข่ายขัดข้อง
   - **ออฟไลน์แคช:** รองรับการทำงานเบื้องต้นแม้ไม่มีสัญญาณอินเทอร์เน็ตในสวน

---

## 🚀 การติดตั้งและเริ่มต้นใช้งาน (Getting Started)

### 1. ความต้องการของระบบ (Prerequisites)
- [Node.js](https://nodejs.org/) (เวอร์ชัน 18 ขึ้นไป)
- บัญชี [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) หรือ MongoDB Server ท้องถิ่น

### 2. ติดตั้ง Dependencies
```bash
npm install
```

### 3. ตั้งค่าตัวแปรสภาพแวดล้อม (Environment Setup)
คัดลอกไฟล์ `.env.example` เป็น `.env`:
```bash
cp .env.example .env
```
เปิดไฟล์ `.env` แล้วระบุ Connection String ของ MongoDB Atlas:
```env
PORT=3000
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/agridash?retryWrites=true&w=majority
GOOGLE_SHEET_ID=<ID_ของ_Google_Sheet>
```

### 4. สตาร์ทระบบ (Start Application)
```bash
npm start
```
เปิดเบราว์เซอร์ไปที่: `http://localhost:3000`

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
AgriDash-Durian/
├── public/                  # Static Frontend Files
│   ├── css/
│   │   └── style.css        # Responsive Styling, Modern Thai Theme & Mobile Bottom Nav
│   ├── js/
│   │   ├── app.js           # Main UI Logic, 1-Click Sync & Thai Date Format
│   │   └── storage.js       # Offline-first Caching & MongoDB Integration
│   └── index.html           # Main Single Page Application
├── server.js                # Express Server, MongoDB Atlas Mongoose Schema & APIs
├── package.json             # Dependencies and Scripts
├── .env.example             # Template for Environment Variables
├── .gitignore               # Ignored Files (Secrets, node_modules)
└── README.md                # Project Documentation
```

---

## 🛡️ ความปลอดภัย (Security)
- ไฟล์ `.env` ที่เก็บรหัสผ่านฐานข้อมูลถูกระบุไว้ใน `.gitignore` เสมอ เพื่อป้องกันไม่ให้ข้อมูลสำคัญรั่วไหลขึ้น Git Repository
