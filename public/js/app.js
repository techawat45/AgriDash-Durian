/* AgriDash Durian Pro - Main App Controller v2.0 (app.js) */
'use strict';

let currentLoggedInEmail = 'guest', isGuestMode = false, isRegisterMode = false;
let selectedVigour = 4, currentAccType = 'income', currentPredictorMode = 'flower';
let isPHISafe = false, isSaving = false;
let fieldLogs = [], plantSurveys = [], accEntries = [];
let totalIncomeAcc = 0, totalExpenseAcc = 0;

let purchaseItems = [
  { name: 'ท่อ PE', qty: 10, unit: 'อัน', price: 5 },
  { name: 'ไทอะมีทอกแซม', qty: 1, unit: 'ลัง', price: 2500 },
  { name: 'อะบาเมกติน', qty: 2, unit: 'ขวด', price: 350 },
  { name: 'น้ำตาลซอร์บิทอล', qty: 4, unit: 'แกลลอน', price: 480 }
];
let sprayItems = [
  { type: 'ปุ๋ยทางใบ', name: 'ปุ๋ย 15-0-0', dose: 300, unit: 'กรัม' },
  { type: 'ยาฆ่าแมลง', name: 'อะบาเมกติน', dose: 200, unit: 'cc' },
  { type: 'ยาฆ่าเชื้อรา', name: 'แมนโคเซบ', dose: 150, unit: 'กรัม' },
  { type: 'ยาจับใบ', name: 'ยาจับใบเกรดพรีเมียม', dose: 50, unit: 'cc' }
];
const incomeCategories = [
  'เงินสะสม / บัญชีกองกลางสวน','ขายผลผลิตทุเรียนตัดสด','ขายผลผลิตทุเรียนคัดเกรด',
  'ขายผลผลิตทุเรียนแปรรูป / ตกเกรด','ขายผลผลิตพืชร่วม','เงินอุดหนุนเกษตร / รายรับอื่น'
];
const expenseCategories = [
  'ค่าใช้จ่ายกองกลางสวน','ค่าปุ๋ยเคมี / ปุ๋ยอินทรีย์','สารเคมีเกษตร / สารแพคโคล',
  'ค่าแรงงาน','ค่าน้ำมัน / ค่าไฟ','ค่าซ่อมบำรุง','ค่าวัสดุอุปกรณ์','ค่าขนส่ง / อื่นๆ'
];

// ====== UTILITY HELPERS ======
function safeNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatCurrency(amount) { return '฿' + safeNum(amount).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function formatDateThai(d) {
  const months=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return d.getDate()+' '+months[d.getMonth()]+' '+(d.getFullYear()+543);
}
function addDays(d, n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function setSyncIndicator(state, text) {
  const el=document.getElementById('sync-indicator');
  if(!el) return;
  el.className='sync-indicator '+state;
  el.innerText=(state==='syncing'?'🔄 ':state==='synced'?'✅ ':'⚠️ ')+text;
}

// ====== TOAST ======
let toastTimer=null;
function showToast(text, type='success') {
  const toast=document.getElementById('toast');
  const span=document.getElementById('toast-text');
  if(!toast||!span) return;
  span.innerText=text;
  toast.className='toast toast-'+type+' show';
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toast.classList.remove('show'),3500);
}

// ====== CONNECTION UI ======
function updateConnectionUI(health) {
  const bar=document.getElementById('connection-status-bar');
  const dot=document.getElementById('status-dot');
  const ct=document.getElementById('status-cloud-text');
  if(!bar) return;
  if(!health||!health.success) {
    bar.className='offline-banner'; bar.innerHTML='⚠️ เซิร์ฟเวอร์ Offline — ข้อมูลบันทึกในเครื่องโดยอัตโนมัติ';
    bar.classList.remove('hidden');
    if(dot) dot.className='status-dot offline';
    if(ct) ct.innerText='Offline Mode';
  } else {
    bar.classList.add('hidden');
    if(dot) dot.className='status-dot online';
    const mode=health.mode==='mongodb_atlas'?'MongoDB Atlas':'Local JSON';
    if(ct) { ct.innerText='🟢 '+mode; ct.style.display='block'; }
  }
}

// ====== PAGE LOADER ======
function hidePageLoader() {
  const loader=document.getElementById('page-loading');
  if(!loader) return;
  setTimeout(()=>{ loader.classList.add('fade-out'); setTimeout(()=>loader.style.display='none',400); },600);
}

// ====== AVATAR ======
function updateAvatarUI(email, firstName) {
  const disp=document.getElementById('user-email-display');
  const av=document.getElementById('avatar-display');
  if(disp) disp.innerText=email;
  if(av) {
    const str=(firstName?firstName.substring(0,2):email.substring(0,2)).toUpperCase();
    av.childNodes[0].nodeValue=str;
  }
}

// ====== AUTH ======
function showAuthModal() { document.getElementById('auth-modal')?.classList.remove('hidden'); }
function toggleAuthMode(event) {
  if(event) event.preventDefault();
  isRegisterMode=!isRegisterMode;
  document.querySelectorAll('.register-only').forEach(el=>el.style.display=isRegisterMode?'block':'none');
  const ti=document.getElementById('auth-modal-title');
  const mb=document.getElementById('auth-main-btn');
  const tt=document.getElementById('auth-toggle-text');
  const tl=document.getElementById('auth-toggle-link');
  if(isRegisterMode){
    if(ti) ti.innerText='ลงทะเบียนบัญชีใหม่';
    if(mb) mb.innerText='สมัครสมาชิก';
    if(tt) tt.innerText='มีบัญชีอยู่แล้ว?';
    if(tl) tl.innerText='เข้าสู่ระบบ';
  } else {
    if(ti) ti.innerText='ลงชื่อเข้าใช้งาน';
    if(mb) mb.innerText='เข้าสู่ระบบ';
    if(tt) tt.innerText='ยังไม่มีบัญชี?';
    if(tl) tl.innerText='สมัครสมาชิก';
  }
}

async function handleEmailAuthSubmit(event) {
  if(event) event.preventDefault();
  const btn=document.getElementById('auth-main-btn');
  const email=(document.getElementById('login-email-input')?.value||'').trim();
  const password=document.getElementById('login-password-input')?.value||'';
  if(!email.includes('@')||password.length<4){ showToast('กรอกอีเมลและรหัสผ่านให้ถูกต้อง','error'); return; }
  if(btn) btn.classList.add('loading');
  try {
    if(isRegisterMode){
      const rp=document.getElementById('reg-repassword')?.value||'';
      if(password!==rp){ showToast('รหัสผ่านไม่ตรงกัน','error'); return; }
      const payload={email,password,
        firstName:document.getElementById('reg-firstname')?.value.trim()||'',
        lastName:document.getElementById('reg-lastname')?.value.trim()||'',
        phone:document.getElementById('reg-phone')?.value.trim()||'',
        farmName:document.getElementById('reg-farmname')?.value.trim()||''
      };
      const r=await AGRI_STORAGE.register(payload);
      showToast(r.message,'success'); toggleAuthMode();
    } else {
      const r=await AGRI_STORAGE.login(email,password);
      currentLoggedInEmail=r.email; isGuestMode=false;
      AGRI_STORAGE.saveSession(r.email,false);
      document.getElementById('auth-modal')?.classList.add('hidden');
      updateAvatarUI(r.email,r.firstName);
      showToast('ยินดีต้อนรับ '+(r.firstName||r.email),'success');
      await loadUserData();
    }
  } catch(err){ showToast(err.message,'error'); }
  finally { if(btn) btn.classList.remove('loading'); }
}

function handleGuestMode(event) {
  if(event){ event.preventDefault(); event.stopPropagation(); }
  currentLoggedInEmail='guest'; isGuestMode=true;
  AGRI_STORAGE.saveSession('guest',true);
  document.getElementById('auth-modal')?.classList.add('hidden');
  updateAvatarUI('guest');
  showToast('เข้าสู่ระบบ Guest Mode','success');
  loadUserData();
}

function toggleSignOutMenu(event) {
  if(event) event.stopPropagation();
  document.getElementById('signout-menu')?.classList.toggle('hidden');
}
document.addEventListener('click',()=>document.getElementById('signout-menu')?.classList.add('hidden'));

function signOutUser() {
  AGRI_STORAGE.clearSession();
  fieldLogs=[]; plantSurveys=[]; accEntries=[];
  currentLoggedInEmail='guest'; isGuestMode=false;
  renderAllTables();
  const av=document.getElementById('avatar-display');
  if(av) av.childNodes[0].nodeValue='JD';
  document.getElementById('signout-menu')?.classList.add('hidden');
  showAuthModal();
  showToast('ออกจากระบบเรียบร้อยแล้ว','success');
}

// ====== DATA LOAD/SAVE ======
async function loadUserData() {
  setSyncIndicator('syncing','กำลังโหลด...');
  const result=await AGRI_STORAGE.loadData(currentLoggedInEmail);
  fieldLogs=result.data.fieldLogs; plantSurveys=result.data.plantSurveys; accEntries=result.data.accEntries;
  setSyncIndicator(result.offline?'error':'synced', result.offline?'Offline — ใช้ Cache':'ซิงค์แล้ว ('+result.source+')');
  renderAllTables(); calculateFlowerDates(); loadAgroMeasurementsFromCache();
}

async function saveLocalData() {
  if(isSaving) return; isSaving=true;
  setSyncIndicator('syncing','กำลังบันทึก...');
  const r=await AGRI_STORAGE.saveData(currentLoggedInEmail,fieldLogs,plantSurveys,accEntries);
  isSaving=false;
  setSyncIndicator(r.synced?'synced':'error', r.synced?'บันทึกแล้ว':'บันทึกในเครื่อง (Offline)');
}

// ====== RENDER TABLES ======
function renderAllTables(){ renderFieldLogs(); renderPlantSurveys(); renderAccEntries(); }

function renderFieldLogs() {
  const tbody=document.getElementById('table-body'); if(!tbody) return;
  tbody.innerHTML='';
  if(!fieldLogs.length){ tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--slate-400);padding:24px;">ยังไม่มีบันทึกกิจกรรมแปลง</td></tr>'; return; }
  [...fieldLogs].sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(log=>{
    const tr=document.createElement('tr');
    const cost=safeNum(log.cost);
    tr.innerHTML=`<td data-label="วันที่">${escapeHtml(log.date||'')}</td><td data-label="แปลง" style="font-weight:700">${escapeHtml(log.plot||'')}</td><td data-label="กิจกรรม"><span class="badge-op">${escapeHtml(log.activity||'')}</span></td><td data-label="รายละเอียด" style="font-size:0.82rem;color:var(--slate-600)">${escapeHtml(log.detail||'')}</td><td data-label="ค่าใช้จ่าย" style="text-align:right;font-weight:700">฿${cost.toLocaleString('th-TH',{minimumFractionDigits:2})}</td><td style="text-align:center"><button class="btn btn-outline" style="height:28px;width:28px;padding:0;color:var(--rose-500);border-color:var(--rose-200);border-radius:6px;" onclick="deleteFieldLog('${escapeHtml(log.id||'')}')">🗑️</button></td>`;
    tbody.appendChild(tr);
  });
}

function renderPlantSurveys() {
  const tbody=document.getElementById('plant-table-body'); if(!tbody) return;
  tbody.innerHTML='';
  if(!plantSurveys.length){ tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--slate-400);padding:24px;">ยังไม่มีบันทึกผลการสำรวจต้น</td></tr>'; return; }
  [...plantSurveys].sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(sv=>{
    const tr=document.createElement('tr');
    const danger=(sv.trunk||'').includes('พบแผล')||(sv.trunk||'').includes('มอด');
    tr.innerHTML=`<td data-label="วันที่">${escapeHtml(sv.date||'')}</td><td data-label="แปลง" style="font-weight:700">${escapeHtml(sv.plot||'')}</td><td data-label="ระยะ"><span class="badge-stage">${escapeHtml(sv.stage||'')}</span></td><td data-label="ใบ/ศัตรู" style="font-size:0.82rem;color:var(--slate-600)">${escapeHtml(sv.leafPest||'')}</td><td data-label="ลำต้น" style="font-size:0.82rem;font-weight:700;color:${danger?'var(--rose-600)':'var(--emerald-600)'}">${escapeHtml(sv.trunk||'')}</td><td data-label="คำแนะนำ" style="font-size:0.82rem">${escapeHtml(sv.recommendation||'')}</td><td style="text-align:center"><button class="btn btn-outline" style="height:28px;width:28px;padding:0;color:var(--rose-500);border-color:var(--rose-200);border-radius:6px;" onclick="deletePlantSurvey('${escapeHtml(sv.id||'')}')">🗑️</button></td>`;
    tbody.appendChild(tr);
  });
}

function renderAccEntries() {
  const tbody=document.getElementById('acc-table-body'); if(!tbody) return;
  tbody.innerHTML='';
  const sorted=[...accEntries].sort((a,b)=>new Date(b.date)-new Date(a.date));
  let inc=0,exp=0;
  sorted.forEach(e=>{ const a=safeNum(e.amount); if(e.type==='income') inc+=a; else exp+=a; });
  totalIncomeAcc=inc; totalExpenseAcc=exp;
  const net=inc-exp; const margin=inc>0?((net/inc)*100).toFixed(1):'0.0';
  const set=(id,v)=>{const el=document.getElementById(id);if(el) el.innerText=v;};
  set('fin-rev-display',formatCurrency(inc)); set('fin-exp-display',formatCurrency(exp));
  set('fin-net-display',formatCurrency(net)); set('fin-margin-display',margin+'%'); set('dash-net-profit',formatCurrency(net));
  if(!sorted.length){ tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--slate-400);padding:24px;">ยังไม่มีรายการบัญชี</td></tr>'; return; }
  sorted.forEach(entry=>{
    const isInc=entry.type==='income'; const a=safeNum(entry.amount);
    const tr=document.createElement('tr');
    tr.innerHTML=`<td data-label="วันที่">${escapeHtml(entry.date||'')}</td><td data-label="ประเภท">${isInc?'<span class="badge-income">รายรับ</span>':'<span class="badge-expense">รายจ่าย</span>'}</td><td data-label="หมวดหมู่" style="font-weight:700">${escapeHtml(entry.category||'')}</td><td data-label="รายละเอียด" style="font-size:0.82rem;color:var(--slate-600)">${escapeHtml(entry.detail||'')}</td><td data-label="จำนวนเงิน" style="text-align:right;font-weight:800;${isInc?'color:var(--emerald-600)':'color:var(--rose-600)'}">${isInc?'+':'-'}${formatCurrency(a)}</td><td style="text-align:center"><button class="btn btn-outline" style="height:28px;width:28px;padding:0;color:var(--rose-500);border-color:var(--rose-200);border-radius:6px;" onclick="deleteAccEntry('${escapeHtml(entry.id||'')}')">🗑️</button></td>`;
    tbody.appendChild(tr);
  });
}

// ====== DELETE (Offline-safe) ======
async function deleteFieldLog(id) {
  if(!confirm('ต้องการลบรายการกิจกรรมแปลงนี้?')) return;
  const u=await AGRI_STORAGE.deleteItem('fieldLogs',id,currentLoggedInEmail,{fieldLogs,plantSurveys,accEntries});
  fieldLogs=u.fieldLogs; renderFieldLogs(); showToast('ลบรายการเรียบร้อย','success');
}
async function deletePlantSurvey(id) {
  if(!confirm('ต้องการลบรายการสำรวจนี้?')) return;
  const u=await AGRI_STORAGE.deleteItem('plantSurveys',id,currentLoggedInEmail,{fieldLogs,plantSurveys,accEntries});
  plantSurveys=u.plantSurveys; renderPlantSurveys(); showToast('ลบรายการเรียบร้อย','success');
}
async function deleteAccEntry(id) {
  if(!confirm('ต้องการลบรายการบัญชีนี้?')) return;
  const u=await AGRI_STORAGE.deleteItem('accEntries',id,currentLoggedInEmail,{fieldLogs,plantSurveys,accEntries});
  accEntries=u.accEntries; renderAccEntries(); showToast('ลบรายการเรียบร้อย','success');
}

// ====== SAVE FORMS ======
function saveFieldLog(e) {
  e.preventDefault();
  const dateVal=document.getElementById('log-date')?.value;
  const plotVal=document.getElementById('log-plot')?.value;
  let actVal=document.getElementById('log-activity')?.value||'';
  if(actVal.includes('อื่นๆ')){ const c=document.getElementById('custom-activity-text')?.value; if(c) actVal=c; }
  if(!dateVal||!plotVal||!actVal){ showToast('กรุณากรอกข้อมูลให้ครบ','error'); return; }
  const note=document.getElementById('log-note')?.value||'';
  let totalCost=0, detailText=note;
  if(actVal.includes('ทำสาร')){
    const days=parseInt(document.getElementById('induction-custom-days')?.value||35);
    const variety=document.getElementById('induction-variety-select')?.value||'monthong';
    let hd=120,vl='หมอนทอง';
    if(variety==='kradoom'){hd=90;vl='กระดุมทอง';} else if(variety==='chanee'){hd=105;vl='ชะนี';} else if(variety==='kanyao'){hd=130;vl='ก้านยาว';}
    const tf=formatDateThai(addDays(new Date(dateVal),days));
    const th=formatDateThai(addDays(new Date(dateVal),days+60+hd));
    detailText=`พันธุ์: ${vl} | สาร ${days}วัน ➔ ดอก: ${tf} | เก็บ: ${th}${note?' | '+note:''}`;
  } else if(actVal.includes('พ่นยา')){
    const tanks=document.getElementById('tank-count')?.value||1;
    const items=sprayItems.filter(i=>i.name.trim());
    detailText=items.map(i=>`${i.name}(${i.dose}${i.unit})`).join('+')+` / ${tanks}ถัง${note?' | '+note:''}`;
  }
  if(document.getElementById('expense-itemized-section')&&!document.getElementById('expense-itemized-section').classList.contains('hidden'))
    purchaseItems.forEach(p=>{ totalCost+=safeNum(p.qty)*safeNum(p.price); });
  const log={id:'field-'+Date.now(),date:dateVal,plot:plotVal,activity:actVal,detail:detailText,cost:totalCost};
  fieldLogs.unshift(log); saveLocalData(); renderFieldLogs();
  showToast('บันทึกกิจกรรม '+dateVal+' เรียบร้อย','success');
  setTimeout(()=>switchView('dashboard'),1500);
}

function savePlantSurvey(e) {
  e.preventDefault();
  const dateVal=document.getElementById('plant-date')?.value;
  const plotVal=document.getElementById('plant-plot')?.value;
  if(!dateVal||!plotVal){ showToast('กรุณากรอกข้อมูลให้ครบ','error'); return; }
  let sv=document.getElementById('plant-stage')?.value||'';
  if(sv.includes('อื่นๆ')){const c=document.getElementById('custom-stage-text')?.value;if(c) sv='🌱'+c;}
  let lf=document.getElementById('plant-leaf-condition')?.value||'';
  if(lf.includes('อื่นๆ')){const c=document.getElementById('custom-leaf-text')?.value;if(c) lf=c;}
  let pest=document.getElementById('plant-pest')?.value||'';
  if(pest.includes('อื่นๆ')){const c=document.getElementById('custom-pest-text')?.value;if(c) pest=c;}
  let trunk=document.getElementById('plant-trunk')?.value||'';
  if(trunk.includes('อื่นๆ')){const c=document.getElementById('custom-trunk-text')?.value;if(c) trunk=c;}
  const notes=document.getElementById('plant-custom-notes')?.value||'';
  const rec=document.getElementById('plant-recommendation')?.value||'';
  const leafPest=notes?`${lf}, ${pest} (${notes})`:`${lf}, ${pest}`;
  const survey={id:'survey-'+Date.now(),date:dateVal,plot:plotVal,stage:sv,leafPest,trunk,recommendation:rec};
  plantSurveys.unshift(survey); saveLocalData(); renderPlantSurveys();
  showToast('บันทึกผลสำรวจแปลง '+plotVal+' เรียบร้อย','success');
  setTimeout(()=>switchView('dashboard'),1500);
}

function saveAccEntry(e) {
  e.preventDefault();
  const dateVal=document.getElementById('acc-date')?.value;
  const catVal=document.getElementById('acc-category')?.value||'';
  const amountVal=safeNum(document.getElementById('acc-amount')?.value||0);
  const descVal=document.getElementById('acc-desc')?.value||'';
  if(!dateVal||amountVal<=0){ showToast('กรุณากรอกวันที่และจำนวนเงิน','error'); return; }
  const isInc=currentAccType==='income';
  let detail=descVal;
  if(!isInc){
    const valid=purchaseItems.filter(p=>p.name.trim());
    if(valid.length) detail=valid.map(p=>`${p.name}(${p.qty}${p.unit})`).join(',')+( descVal?' | '+descVal:'');
  }
  const entry={id:'acc-'+Date.now(),date:dateVal,type:currentAccType,category:catVal,detail:detail||'-',amount:amountVal};
  accEntries.unshift(entry); saveLocalData(); renderAccEntries();
  showToast((isInc?'รายรับ ':'รายจ่าย ')+formatCurrency(amountVal)+' บันทึกแล้ว','success');
}

function saveAgronomyRecommendation() {
  const stage=document.getElementById('calc-stage')?.value||'';
  const tank=document.getElementById('calc-trees')?.value||1000;
  const npk=document.getElementById('rec-npk')?.innerText||'';
  const pest=document.getElementById('rec-pest')?.innerText||'';
  const dateVal=new Date().toISOString().split('T')[0];
  const log={id:'field-'+Date.now(),date:dateVal,plot:'ทุกแปลง',activity:'แนะนำปุ๋ย ('+stage+')',detail:'สูตรดิน: '+npk+' | ศัตรูพืช: '+pest,cost:0};
  fieldLogs.unshift(log); saveLocalData(); renderFieldLogs();
  showToast('บันทึกแผนคำแนะนำระยะ '+stage+' เรียบร้อย','success');
}

// ====== VIEW SWITCHING ======
function switchView(viewName) {
  ['dashboard','agrotech','calc','finance','field','plant','accounting'].forEach(v=>{
    document.getElementById('view-'+v)?.classList.add('hidden');
    document.getElementById('nav-'+v+'-btn')?.classList.remove('active');
    document.getElementById('mob-'+v+'-btn')?.classList.remove('active');
  });
  document.getElementById('view-'+viewName)?.classList.remove('hidden');
  document.getElementById('nav-'+viewName+'-btn')?.classList.add('active');
  document.getElementById('mob-'+viewName+'-btn')?.classList.add('active');

  // Highlight centered add button if in field view
  const centerBtn = document.getElementById('mob-field-btn');
  if (centerBtn) {
    if (viewName === 'field') {
      centerBtn.style.transform = 'scale(1.08)';
      centerBtn.style.boxShadow = '0 10px 24px rgba(16, 185, 129, 0.6)';
    } else {
      centerBtn.style.transform = 'scale(1)';
      centerBtn.style.boxShadow = '0 8px 20px rgba(16, 185, 129, 0.42)';
    }
  }

  window.scrollTo({top:0,behavior:'smooth'});
}
function handleNav(event,viewName){ if(event) event.preventDefault(); switchView(viewName); }

// Mobile Action Sheet
function openMobileSheet() {
  document.getElementById('mobile-action-sheet')?.classList.remove('hidden');
}
function closeMobileSheet(e) {
  if (e && e.target !== e.currentTarget && !e.target.closest('.mobile-sheet-item') && !e.target.closest('button')) return;
  document.getElementById('mobile-action-sheet')?.classList.add('hidden');
}

// Compatibility alias for form onsubmit
function saveLog(e) { return saveFieldLog(e); }


// ====== FORM HELPERS ======
function setAccType(type) {
  currentAccType=type;
  document.getElementById('type-inc-btn')?.classList.toggle('active',type==='income');
  document.getElementById('type-exp-btn')?.classList.toggle('active',type==='expense');
  document.getElementById('expense-itemized-section')?.classList.toggle('hidden',type!=='expense');
  updateAccCategories();
}
function updateAccCategories() {
  const sel=document.getElementById('acc-category'); if(!sel) return;
  sel.innerHTML='';
  (currentAccType==='income'?incomeCategories:expenseCategories).forEach(c=>{
    const opt=document.createElement('option'); opt.value=c; opt.innerText=c; sel.appendChild(opt);
  });
}
function onActivityChange() {
  const act=document.getElementById('log-activity')?.value||'';
  document.getElementById('spray-section')?.classList.toggle('hidden',!act.includes('พ่นยา'));
  document.getElementById('chemical-induction-section')?.classList.toggle('hidden',!act.includes('ทำสาร'));
  document.getElementById('custom-activity-box')?.classList.toggle('hidden',!act.includes('อื่นๆ'));
}
function checkCustomOption(selId,boxId){
  document.getElementById(boxId)?.classList.toggle('hidden',!(document.getElementById(selId)?.value||'').includes('อื่นๆ'));
}
function selectVigour(btn,r){ selectedVigour=r; document.querySelectorAll('#plant-form .segmented-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }
function selectGrade(btn){ document.querySelectorAll('#field-form .segmented-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }
function togglePHI() {
  isPHISafe=!isPHISafe;
  if(isPHISafe){
    document.getElementById('phi-banner')?.setAttribute('class','phi-banner clear');
    const t=document.getElementById('phi-title'); if(t) t.innerText='PHI Clear: ปลอดภัยเก็บเกี่ยวได้';
    const d=document.getElementById('phi-desc'); if(d) d.innerText='ระยะเว้นครบกำหนดแล้ว';
    const bh=document.getElementById('btn-harvest'); if(bh) bh.disabled=false;
    showToast('PHI Clear — ปลดล็อกแล้ว','success');
  } else {
    document.getElementById('phi-banner')?.setAttribute('class','phi-banner active');
    const t=document.getElementById('phi-title'); if(t) t.innerText='PHI Active: เหลือ 5 วัน';
    const d=document.getElementById('phi-desc'); if(d) d.innerText='ห้ามเก็บเกี่ยวจนกว่าจะครบ PHI';
    const bh=document.getElementById('btn-harvest'); if(bh) bh.disabled=true;
  }
}

// ====== PURCHASE & SPRAY ITEMS ======
function renderPurchaseItems() {
  const c=document.getElementById('purchase-items-container'); if(!c) return;
  c.innerHTML='';
  purchaseItems.forEach((item,i)=>{
    const row=document.createElement('div');
    row.style='display:grid;grid-template-columns:2fr 1fr 1fr 1fr 34px;gap:6px;margin-bottom:8px;align-items:center;';
    row.innerHTML=`<input type="text" class="form-control" style="height:36px;font-size:0.8rem;padding:0 8px;" placeholder="ชื่อสินค้า" value="${escapeHtml(item.name)}" onchange="updatePurchaseItem(${i},'name',this.value)" /><input type="number" class="form-control" style="height:36px;font-size:0.8rem;" placeholder="จำนวน" value="${item.qty}" onchange="updatePurchaseItem(${i},'qty',this.value)" /><select class="form-control" style="height:36px;font-size:0.75rem;" onchange="updatePurchaseItem(${i},'unit',this.value)">${['ขวด','แกลลอน','กระสอบ','อัน','ชิ้น','ลัง'].map(u=>`<option value="${u}" ${item.unit===u?'selected':''}>${u}</option>`).join('')}</select><input type="number" class="form-control" style="height:36px;font-size:0.8rem;" placeholder="ราคา/หน่วย" value="${item.price}" onchange="updatePurchaseItem(${i},'price',this.value)" /><button type="button" class="btn btn-outline" style="height:36px;width:34px;padding:0;color:var(--rose-500);border-color:var(--rose-200);" onclick="removePurchaseItem(${i})">✕</button>`;
    c.appendChild(row);
  });
  calculateTotalPurchaseAmount();
}
function addPurchaseItem(){ purchaseItems.push({name:'',qty:1,unit:'ขวด',price:0}); renderPurchaseItems(); }
function removePurchaseItem(i){ if(purchaseItems.length<=1){showToast('ต้องมีอย่างน้อย 1 รายการ','warning');return;} purchaseItems.splice(i,1); renderPurchaseItems(); }
function updatePurchaseItem(i,f,v){ purchaseItems[i][f]=v; renderPurchaseItems(); }
function calculateTotalPurchaseAmount(){
  const t=purchaseItems.reduce((s,p)=>s+safeNum(p.qty)*safeNum(p.price),0);
  const el=document.getElementById('acc-amount'); if(el) el.value=t>0?t.toFixed(2):'';
}
function renderSprayRecipe(){
  const c=document.getElementById('spray-items-container'); if(!c) return;
  c.innerHTML='';
  const types=['ปุ๋ยทางใบ','ยาฆ่าแมลง','ยาฆ่าเชื้อรา','ยาไร','อาหารเสริม','ยาจับใบ','อื่นๆ'];
  sprayItems.forEach((item,i)=>{
    const row=document.createElement('div');
    row.style='display:grid;grid-template-columns:1.2fr 2fr 1fr 1fr 38px;gap:8px;margin-bottom:8px;align-items:center;';
    row.innerHTML=`<select class="form-control" style="height:38px;font-size:0.8rem;padding:0 6px;" onchange="updateSprayItem(${i},'type',this.value)">${types.map(t=>`<option value="${t}" ${item.type===t?'selected':''}>${t}</option>`).join('')}</select><input type="text" class="form-control" style="height:38px;" placeholder="ชื่อยา/ปุ๋ย" value="${escapeHtml(item.name)}" onchange="updateSprayItem(${i},'name',this.value)" /><input type="number" class="form-control" style="height:38px;" placeholder="ปริมาณ" value="${item.dose}" onchange="updateSprayItem(${i},'dose',this.value)" /><select class="form-control" style="height:38px;font-size:0.8rem;padding:0 6px;" onchange="updateSprayItem(${i},'unit',this.value)"><option value="cc" ${item.unit==='cc'?'selected':''}>cc</option><option value="กรัม" ${item.unit==='กรัม'?'selected':''}>กรัม</option></select><button type="button" class="btn btn-outline" style="height:38px;width:38px;padding:0;color:var(--rose-500);border-color:var(--rose-200);border-radius:8px;" onclick="removeSprayItem(${i})">✕</button>`;
    c.appendChild(row);
  });
}
function addSprayItem(){ sprayItems.push({type:'อื่นๆ',name:'',dose:'',unit:'cc'}); renderSprayRecipe(); }
function removeSprayItem(i){ if(sprayItems.length<=1){showToast('ต้องมีอย่างน้อย 1 รายการ','warning');return;} sprayItems.splice(i,1); renderSprayRecipe(); }
function updateSprayItem(i,f,v){ sprayItems[i][f]=v; }

// ====== PREDICTOR ======
let currentPredictorModeLocal='flower';
function switchPredictorMode(mode){ currentPredictorModeLocal=mode; calculateFlowerDates(); showToast(mode==='flower'?'โหมดดอกและผล':'โหมดชุดใบ','success'); }
function syncVariety(src){
  const d=document.getElementById('dash-predictor-variety'); const f=document.getElementById('induction-variety-select');
  if(src==='dash'&&d&&f) f.value=d.value; else if(src==='form'&&d&&f) d.value=f.value;
  calculateFlowerDates();
}
function calculateFlowerDates() {
  let dv=document.getElementById('dash-predictor-date')?.value;
  if(!dv){ dv=new Date().toISOString().split('T')[0]; const el=document.getElementById('dash-predictor-date'); if(el) el.value=dv; }
  const ldEl=document.getElementById('log-date'); if(ldEl&&!ldEl.value) ldEl.value=dv;
}
function savePredictorPlan(){
  const dv=document.getElementById('dash-predictor-date')?.value||new Date().toISOString().split('T')[0];
  const days=parseInt(document.getElementById('dash-predictor-days')?.value||35);
  const variety=document.getElementById('dash-predictor-variety')?.value||'monthong';
  let hd=120,vl='หมอนทอง';
  if(variety==='kradoom'){hd=90;vl='กระดุมทอง';} else if(variety==='chanee'){hd=105;vl='ชะนี';} else if(variety==='kanyao'){hd=130;vl='ก้านยาว';}
  const tf=formatDateThai(addDays(new Date(dv),days));
  const th=formatDateThai(addDays(new Date(dv),days+60+hd));
  const log={id:'field-'+Date.now(),date:dv,plot:'ทุกแปลง (แผนคาดการณ์)',activity:'ราดสาร / ทำสาร',detail:`พันธุ์: ${vl} | สาร ${days}วัน ➔ ดอก: ${tf} | เก็บ: ${th}`,cost:0};
  fieldLogs.unshift(log); saveLocalData(); renderFieldLogs();
  showToast('บันทึกแผนคาดการณ์ '+dv+' เรียบร้อย','success');
}

// ====== AGRO MEASUREMENTS ======
function saveAgroMeasurements(){
  const g=id=>document.getElementById(id)?.value||'0';
  const m={soil15:g('input-soil-15'),soil30:g('input-soil-30'),ph:g('input-soil-ph'),ec:g('input-soil-ec'),temp:g('input-air-temp'),hum:g('input-air-hum'),rain:g('input-rain')};
  AGRI_STORAGE.saveAgroMeasurementsCache(m);
  const dv=new Date().toISOString().split('T')[0];
  const log={id:'field-soil-'+Date.now(),date:dv,plot:'ทุกแปลง (ตรวจวัดดินน้ำ)',activity:'ตรวจวัดสภาพแปลง',detail:`ชื้น15cm:${safeNum(m.soil15).toFixed(1)}% | pH:${safeNum(m.ph).toFixed(1)} | EC:${safeNum(m.ec).toFixed(1)} | อุณหภูมิ:${safeNum(m.temp).toFixed(1)}°C`,cost:0};
  fieldLogs.unshift(log); saveLocalData(); renderFieldLogs();
  showToast('บันทึกค่าตรวจวัดเรียบร้อย','success');
}
function loadAgroMeasurementsFromCache(){
  const m=AGRI_STORAGE.getAgroMeasurementsCache(); if(!m){if(typeof runAgroAnalysis==='function') runAgroAnalysis(); return;}
  const sv=(id,v)=>{const el=document.getElementById(id);if(el&&v!==undefined) el.value=v;};
  sv('input-soil-15',m.soil15); sv('input-soil-30',m.soil30); sv('input-soil-ph',m.ph); sv('input-soil-ec',m.ec);
  sv('input-air-temp',m.temp); sv('input-air-hum',m.hum); sv('input-rain',m.rain);
  if(typeof runAgroAnalysis==='function') runAgroAnalysis();
}

// ====== CSV EXPORT ======
function exportAccCSV(){
  const rows=[['วันที่','ประเภท','หมวดหมู่','รายละเอียด','จำนวนเงิน']];
  [...accEntries].sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(e=>{
    rows.push([e.date,e.type==='income'?'รายรับ':'รายจ่าย',e.category,e.detail,safeNum(e.amount).toFixed(2)]);
  });
  const csv=rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='AgriDash_'+new Date().toISOString().split('T')[0]+'.csv';
  a.click(); URL.revokeObjectURL(url);
  showToast('ส่งออก CSV เรียบร้อย','success');
}

function showSensorTooltip(title,d15,d30){ showToast(title+': '+d15+' | '+d30,'success'); }

// ====== SESSION RESTORE ON LOAD ======
document.addEventListener('DOMContentLoaded',async()=>{
  hidePageLoader();
  const health=await AGRI_STORAGE.checkHealth();
  updateConnectionUI(health);
  const session=AGRI_STORAGE.getSession();
  if(session.email){
    currentLoggedInEmail=session.email; isGuestMode=session.isGuest;
    document.getElementById('auth-modal')?.classList.add('hidden');
    updateAvatarUI(session.email);
    showToast(session.isGuest?'Guest Mode':'ยินดีต้อนรับกลับ '+session.email,'success');
    await loadUserData();
  } else {
    document.getElementById('auth-modal')?.classList.remove('hidden');
  }
  updateAccCategories(); renderPurchaseItems(); renderSprayRecipe(); calculateFlowerDates(); loadAgroMeasurementsFromCache();
  setInterval(async()=>{ updateConnectionUI(await AGRI_STORAGE.checkHealth()); },30000);
});
// ====== AGRONOMY CALCULATIONS & PREDICTIONS ======
function calculateFlowerDates() {
  let dashDateVal = document.getElementById('dash-predictor-date')?.value;
  let logDateVal = document.getElementById('log-date')?.value;

  if (!dashDateVal) {
    dashDateVal = new Date().toISOString().split('T')[0];
    const dashDateEl = document.getElementById('dash-predictor-date');
    if (dashDateEl) dashDateEl.value = dashDateVal;
  }

  if (!logDateVal) {
    logDateVal = dashDateVal;
    const logDateEl = document.getElementById('log-date');
    if (logDateEl) logDateEl.value = logDateVal;
  }

  const appDate = new Date(dashDateVal || logDateVal);

  if (currentPredictorModeLocal === 'flower') {
    const customDays = parseInt(document.getElementById('dash-predictor-days')?.value || document.getElementById('induction-custom-days')?.value || 35);
    const activeDays = customDays > 0 ? customDays : 35;
    
    const variety = document.getElementById('dash-predictor-variety')?.value || 'monthong';
    let harvestDays = 120;
    let varietyLabel = 'หมอนทอง';
    if (variety === 'kradoom') {
      harvestDays = 90;
      varietyLabel = 'กระดุมทอง';
    } else if (variety === 'chanee') {
      harvestDays = 105;
      varietyLabel = 'ชะนี/พวงมณี';
    } else if (variety === 'kanyao') {
      harvestDays = 130;
      varietyLabel = 'ก้านยาว';
    }

    const stages = [
      { num: 'ระยะที่ 1', name: '🧪 วันราดสาร/พ่นทำสาร', date: appDate, desc: 'เริ่มต้นกระตุ้นการออกดอก (' + varietyLabel + ')', highlight: false },
      { num: 'ระยะที่ 2', name: '🌸 แทงตาดอกไข่ปลา / ตาพู', date: addDays(appDate, activeDays), desc: activeDays + ' วันหลังทำสาร', highlight: true },
      { num: 'ระยะที่ 3', name: '🍡 มะเขือพวงเล็ก - มะเขือพวงใหญ่', date: addDays(appDate, activeDays + 15), desc: '+15 วัน หลังแทงตาพู', highlight: false },
      { num: 'ระยะที่ 4', name: '🏮 ระยะหัวฉีด (ดอกโตเต็มที่)', date: addDays(appDate, activeDays + 40), desc: '+25 วัน หลังมะเขือพวง', highlight: false },
      { num: 'ระยะที่ 5', name: '🌺 ระยะดอกบาน (Full Bloom)', date: addDays(appDate, activeDays + 60), desc: '+20 วัน หลังหัวฉีด', highlight: true },
      { num: 'ระยะที่ 6', name: '🎓 หางแย้ถอดหมวก (ติดผลอ่อน)', date: addDays(appDate, activeDays + 67), desc: '+7 วัน หลังดอกบาน', highlight: false },
      { num: 'ระยะที่ 7', name: '🍈 ระยะกระปุก', date: addDays(appDate, activeDays + 60 + Math.round(42 * harvestDays / 120)), desc: 'ราว ' + Math.round(42 * harvestDays / 120) + ' วัน หลังดอกบาน', highlight: false },
      { num: 'ระยะที่ 8', name: '📦 ระยะกระป๋อง / ขยายพู', date: addDays(appDate, activeDays + 60 + Math.round(62 * harvestDays / 120)), desc: 'ราว ' + Math.round(62 * harvestDays / 120) + ' วัน หลังดอกบาน', highlight: false },
      { num: 'ระยะที่ 9', name: '🍯 ระยะสร้างเนื้อ / สะสมแป้ง', date: addDays(appDate, activeDays + 60 + Math.round(97 * harvestDays / 120)), desc: 'ราว ' + Math.round(97 * harvestDays / 120) + ' วัน หลังดอกบาน', highlight: false },
      { num: 'ระยะที่ 10', name: '🏆 ผลแก่พร้อมเก็บเกี่ยว (Harvest)', date: addDays(appDate, activeDays + 60 + harvestDays), desc: '+' + harvestDays + ' วัน หลังดอกบาน (ทุเรียน' + varietyLabel + ' แก่จัด)', harvest: true }
    ];

    let gridHTML = '';
    stages.forEach(st => {
      const cardClass = st.harvest ? 'stage-card harvest-card' : (st.highlight ? 'stage-card highlight' : 'stage-card');
      gridHTML += `
        <div class="${cardClass}">
          <div class="stage-num">${st.num}</div>
          <div class="stage-name">${st.name}</div>
          <div class="stage-date">${formatDateThai(st.date)}</div>
          <div class="stage-desc">${st.desc}</div>
        </div>
      `;
    });

    const formGrid = document.getElementById('form-10-stage-grid');
    const dashGrid = document.getElementById('dash-10-stage-grid');
    if (formGrid) formGrid.innerHTML = gridHTML;
    if (dashGrid) dashGrid.innerHTML = gridHTML;

  } else {
    const leafStages = [
      { num: 'ระยะที่ 1', name: '🌱 แทงยอดอ่อน / ใบหางตระกวด', date: appDate, desc: 'เริ่มแตกยอดอ่อนใหม่ (0 วัน)', highlight: true },
      { num: 'ระยะที่ 2', name: '🍃 ระยะใบหางปลา (Fish-tail)', date: addDays(appDate, 7), desc: '+7 วัน (เริ่มพ่นยาน้ำส้มสายชู/ยาฆ่าแมลง)', highlight: false },
      { num: 'ระยะที่ 3', name: '🍃 ระยะใบกางขยาย (Expanding Leaf)', date: addDays(appDate, 16), desc: '+9 วัน (ฉีดพ่นปุ๋ยทางใบ + Ca-B)', highlight: false },
      { num: 'ระยะที่ 4', name: '🌿 ระยะใบเพสลาดอ่อน (Soft Green)', date: addDays(appDate, 28), desc: '+12 วัน (ใบเริ่มเปลี่ยนเป็นสีเขียวอ่อน)', highlight: true },
      { num: 'ระยะที่ 5', name: '🌿 ระยะใบเพสลาดแก่ (Maturing Green)', date: addDays(appDate, 40), desc: '+12 วัน (สะสมอาหาร ดึง N-P-K)', highlight: false },
      { num: 'ระยะที่ 6', name: '🌳 ใบแก่เขียวเข้มมันเงา (Mature Canopy)', date: addDays(appDate, 55), desc: '+15 วัน (ใบแก่เต็มที่ พร้อมทำสารรอบใหม่)', harvest: true }
    ];

    let gridHTML = '';
    leafStages.forEach(st => {
      const cardClass = st.harvest ? 'stage-card harvest-card' : (st.highlight ? 'stage-card highlight' : 'stage-card');
      gridHTML += `
        <div class="${cardClass}">
          <div class="stage-num">${st.num}</div>
          <div class="stage-name">${st.name}</div>
          <div class="stage-date">${formatDateThai(st.date)}</div>
          <div class="stage-desc">${st.desc}</div>
        </div>
      `;
    });

    const formGrid = document.getElementById('form-10-stage-grid');
    const dashGrid = document.getElementById('dash-10-stage-grid');
    if (formGrid) formGrid.innerHTML = gridHTML;
    if (dashGrid) dashGrid.innerHTML = gridHTML;
  }
}

function calculateNutrients() {
  const stage = document.getElementById('calc-stage')?.value || '';
  const tankLiters = parseFloat(document.getElementById('calc-trees')?.value || 1000);
  const factor = tankLiters / 1000;

  const headerTitle = document.getElementById('rec-header-title');
  if (headerTitle) {
    headerTitle.innerText = "📋 สูตรปุ๋ย สารเคมีเกษตร และชีวภาพที่แนะนำสรีรพืช (คำนวณสำหรับถัง " + tankLiters + " ลิตร):";
  }

  const recNpk = document.getElementById('rec-npk');
  const recNpkSub = document.getElementById('rec-npk-sub');
  const recCamg = document.getElementById('rec-camg');
  const recCamgSub = document.getElementById('rec-camg-sub');
  const recZnb = document.getElementById('rec-znb');
  const recZnbSub = document.getElementById('rec-znb-sub');
  const recPest = document.getElementById('rec-pest');
  const recPestSub = document.getElementById('rec-pest-sub');

  if (!recNpk) return;

  if (stage.includes('หางปลา')) {
    recNpk.innerText = "15-0-0 (แคลเซียมไนเตรต) หรือ 25-7-7";
    recNpkSub.innerText = "อัตรา 800 กรัม / ต้น (ใส่ทางดิน ดึงยอดและแตกใบใหม่สม่ำเสมอ)";
    recCamg.innerText = "แมกนีเซียมคีเลต + ซิงค์สังกะสี (Zn)";
    recCamgSub.innerText = "อัตรา " + (1.0 * factor).toFixed(1) + " ลิตร + ซิงค์ " + (750 * factor).toFixed(0) + " กรัม / ถัง " + tankLiters + "L";
    recZnb.innerText = "สาหร่ายทะเล (Seaweed) + อะมิโนสร้างใบ";
    recZnbSub.innerText = "อัตรา " + (1.5 * factor).toFixed(1) + " ลิตร + อะมิโน " + (1.5 * factor).toFixed(1) + " ลิตร / ถัง " + tankLiters + "L";
    recPest.innerText = "ป้องกันเพลี้ยไก่แจ้ & เพลี้ยไฟดักยอด";
    recPestSub.innerText = "พ่น อิมิดาโคลพริด (" + (1.0 * factor).toFixed(1) + "L) + แมนโคเซบ (" + (1.5 * factor).toFixed(1) + "kg) กันราใบติด";
  } else if (stage.includes('ใบกาง')) {
    recNpk.innerText = "15-5-20 หรือ 16-16-16";
    recNpkSub.innerText = "อัตรา 1.0 กก. / ต้น (ใส่ทางดิน ขยายขนาดแผ่นใบให้หนากว้าง)";
    recCamg.innerText = "ธาตุอาหารรวม Micronutrients (Fe,Mn,Cu,B)";
    recCamgSub.innerText = "อัตรา " + (1.0 * factor).toFixed(1) + " ลิตร / ถัง " + tankLiters + "L (ช่วยสังเคราะห์แสงเร่งใบเขียวเข้ม)";
    recZnb.innerText = "ปุ๋ยทางใบ 15-5-20 หรือ 20-20-20";
    recZnbSub.innerText = "อัตรา " + (1.5 * factor).toFixed(1) + " กก. + น้ำตาลทางด่วน " + (1.5 * factor).toFixed(1) + " ลิตร / ถัง " + tankLiters + "L";
    recPest.innerText = "ป้องกันโรคใบติด & แอนแทรคโนสใบอ่อน";
    recPestSub.innerText = "พ่น คาร์เบนดาซิม (" + (1.0 * factor).toFixed(1) + "L) + อะบาเมกติน (" + (1.0 * factor).toFixed(1) + "L)";
  } else if (stage.includes('ใบเพสลาด')) {
    recNpk.innerText = "15-5-25 หรือ 13-13-21";
    recNpkSub.innerText = "อัตรา 1.2 กก. / ต้น (ใส่ทางดิน สร้างความสมบูรณ์บำรุงใบแก่เต็มที่)";
    recCamg.innerText = "แคลเซียม-โบรอน (Ca-B) เข้มข้น";
    recCamgSub.innerText = "อัตรา " + (1.5 * factor).toFixed(1) + " ลิตร / ถัง " + tankLiters + "L (เพิ่มความหนาแน่นโครงสร้างผนังเซลล์ใบ)";
    recZnb.innerText = "ปุ๋ยทางใบสะสมอาหาร 0-20-44 หรือ 0-52-34";
    recZnbSub.innerText = "อัตรา " + (2.5 * factor).toFixed(1) + " กก. / ถัง " + tankLiters + "L (สะสมอาหาร P-K ก่อนเข้าสาร)";
    recPest.innerText = "ป้องกันไรแดง & เพลี้ยจักจั่นฝอย";
    recPestSub.innerText = "พ่น อะบาเมกติน (" + (1.0 * factor).toFixed(1) + "L) หรือ ไพริดาเบน (" + (1.0 * factor).toFixed(1) + "kg)";
  } else if (stage.includes('สะสมอาหาร')) {
    recNpk.innerText = "8-24-24 หรือ 9-25-25";
    recNpkSub.innerText = "อัตรา 800 กรัม / ต้น (ใส่ทางดิน กดใบอ่อน สะสม P-K ในกิ่งเตรียมนอก)";
    recCamg.innerText = "โบรอนดักผล + ซิงค์สังกะสีตาดอก";
    recCamgSub.innerText = "อัตรา " + (1.0 * factor).toFixed(1) + " ลิตร / ถัง " + tankLiters + "L (สะสมตาดอกตามกิ่งทุเรียน)";
    recZnb.innerText = "สะสมอาหาร 0-52-34 หรือ 0-20-44 + ซอร์บิทอล";
    recZnbSub.innerText = "อัตรา " + (5.0 * factor).toFixed(1) + " กก. + น้ำตาลทางด่วน " + (1.5 * factor).toFixed(1) + " ลิตร / ถัง " + tankLiters + "L (สะกดใบอ่อน)";
    recPest.innerText = "ป้องกันราสีชมพู & ไฟทอปธอรากิ่ง";
    recPestSub.innerText = "พ่น ฟอสอีทิล-อะลูมิเนียม (" + (1.5 * factor).toFixed(1) + "kg) หรือ เมทาแลกซิล ทาแผลโคนต้น";
  } else if (stage.includes('ดอกบาน')) {
    recNpk.innerText = "งดปุ๋ย N สูง (ใส่ 13-13-21 ได้ 200g/ต้น)";
    recNpkSub.innerText = "อัตรา 200 กรัม / ต้น (ห้ามให้น้ำโชก เน้นพ่นทางใบช่วงดอกบาน)";
    recCamg.innerText = "แคลเซียม-โบรอน + โบรอนดักผล";
    recCamgSub.innerText = "อัตรา " + (1.5 * factor).toFixed(1) + " ลิตร / ถัง " + tankLiters + "L (ช่วยผสมเกสร ลดดอกเหี่ยวร่วง)";
    recZnb.innerText = "ฮอร์โมนออกซิน (NAA) + อะมิโนขั้วเหนียว";
    recZnbSub.innerText = "อัตราต่ำ " + (250 * factor).toFixed(0) + " cc / ถัง " + tankLiters + "L (ลดการหลุดร่วงระยะหางแย้ถอดหมวก)";
    recPest.innerText = "ป้องกันหนอนชอนดอก & แอนแทรคโนสดอก";
    recPestSub.innerText = "พ่น คาร์เบนดาซิม (" + (1.0 * factor).toFixed(1) + "L) + อะบาเมกติน (" + (1.0 * factor).toFixed(1) + "L)";
  } else if (stage.includes('ขยายพู')) {
    recNpk.innerText = "13-13-21 หรือ 12-12-17-2";
    recNpkSub.innerText = "อัตรา 1.5 กก. / ต้น (ใส่ทางดิน เน้นโพแทสเซียม สร้างเนื้อ หวาน มัน)";
    recCamg.innerText = "แคลเซียมไนเตรต (15-0-0) + Mg";
    recCamgSub.innerText = "อัตรา " + (1.5 * factor).toFixed(1) + " ลิตร / ถัง " + tankLiters + "L (เพิ่มความหนาเปลือก ป้องกันผลแตก)";
    recZnb.innerText = "ปุ๋ยทางใบ 0-0-50 + โพแทสเซียมฮิวเมต";
    recZnbSub.innerText = "อัตรา " + (2.5 * factor).toFixed(1) + " กก. + ฮิวเมต " + (1.0 * factor).toFixed(1) + " กก. / ถัง " + tankLiters + "L";
    recPest.innerText = "ป้องกันเพลี้ยแป้ง & หนอนเจาะผลทุเรียน";
    recPestSub.innerText = "พ่น ฟิโพรนิล (" + (1.0 * factor).toFixed(1) + "L) หรือ คลอร์ไพริฟอส + สารจับใบพรีเมียม";
  }
}

function calculateSprayWater() {
  const ph = parseFloat(document.getElementById('water-ph')?.value || 7.8);
  const tankLiters = parseFloat(document.getElementById('water-tank')?.value || 1000);
  const resultBox = document.getElementById('ph-adj-result');
  if (!resultBox) return;

  let adjText = '';
  if (ph > 7.0) {
    const acidCc = ((ph - 6.2) * 200 * (tankLiters / 1000)).toFixed(0);
    adjText = "💧 <strong>การปรับคุณภาพน้ำ</strong>: ค่า pH น้ำ " + ph + " (เป็นด่าง) <br/>👉 แนะนำเติมสารปรับกรด (Water Conditioner) จำนวน <strong>" + acidCc + " cc</strong> เพื่อลด pH มาอยู่ที่ <strong>5.5 - 6.5</strong>";
  } else if (ph < 5.0) {
    adjText = "💧 <strong>การปรับคุณภาพน้ำ</strong>: ค่า pH น้ำ " + ph + " (เป็นกรดจัด) <br/>👉 แนะนำปรับค่า pH ให้อยู่ที่ <strong>6.0</strong> ก่อนผสมยา";
  } else {
    adjText = "💧 <strong>การปรับคุณภาพน้ำ</strong>: ค่า pH น้ำ " + ph + " อยู่ในเกณฑ์สมบูรณ์พร้อมผสมยาพ่น (5.5 - 6.5)";
  }

  const treesCount = (tankLiters / 10).toFixed(0);
  resultBox.innerHTML = adjText + " <br/>💧 <strong>อัตราพ่นต่อต้น</strong>: ใช้น้ำเฉลี่ย <strong>10 ลิตร/ต้น</strong> (ถัง " + tankLiters + " ลิตร พ่นได้ประมาณ " + treesCount + " ต้น)";
}

const drillDownData = {
  'ปุ๋ย/ยา/สารเคมี': [
    { date: '2026-07-24', subcat: 'สารเคมี/สารแพคโคล', desc: 'ท่อ PE (10อัน), ไทอะมีทอกแซม (1ลัง), อะบาเมกติน (2ขวด), น้ำตาลซอร์บิทอล (4แกลลอน)', plot: '1) สวนหมอนทอง', amount: 5170 },
    { date: '2026-07-20', subcat: 'ปุ๋ยเคมี/อินทรีย์', desc: 'ปุ๋ยสูตร 15-15-15 จำนวน 25 กระสอบ', plot: '2) สวนกระดุม', amount: 38500 }
  ],
  'ค่าแรงงานเกษตร': [
    { date: '2026-07-15', subcat: 'ค่าแรงจ้างเหมา', desc: 'ค่าแรงจ้างโยงลูกและแต่งดอก 5 คน', plot: '3) สวนมังคุด', amount: 5150 }
  ],
  'กองกลาง/อื่นๆ': [
    { date: '2026-07-24', subcat: 'โอนกองกลาง', desc: 'โอนปันผลกองกลางสวนเข้าสมุดกงสี', plot: '🏛️ บัญชีกองกลางสวน', amount: 3500 }
  ]
};

function drillDownCategory(categoryName, amountFormatted) {
  const card = document.getElementById('drilldown-card');
  const title = document.getElementById('drill-title');
  const tbody = document.getElementById('drill-table-body');
  if (!card || !title || !tbody) return;

  title.innerText = "🔍 รายละเอียดรายการบัญชีในหมวดหมู่: " + categoryName + " (" + amountFormatted + ")";
  tbody.innerHTML = '';

  const items = drillDownData[categoryName] || [];
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--slate-400); padding:16px;">ไม่พบรายการย่อยสำหรับหมวดหมู่นี้</td></tr>';
  } else {
    items.forEach(it => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="วันที่">${it.date}</td>
        <td data-label="หมวดหมู่ย่อย"><span class="badge-op">${it.subcat}</span></td>
        <td data-label="รายละเอียด" style="font-size:0.82rem; color:var(--slate-700)">${it.desc}</td>
        <td data-label="แปลง" style="font-weight:700; color:var(--slate-900)">${it.plot}</td>
        <td data-label="จำนวนเงิน" style="text-align:right; font-weight:800; color:var(--slate-900)">฿${it.amount.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  card.classList.remove('hidden');
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  showToast("🔍 กำลังเจาะลึกดูรายการ: " + categoryName);
}

function runAgroAnalysis() {
  const soil15 = parseFloat(document.getElementById('input-soil-15')?.value || 0);
  const soil30 = parseFloat(document.getElementById('input-soil-30')?.value || 0);
  const ph = parseFloat(document.getElementById('input-soil-ph')?.value || 0);
  const ec = parseFloat(document.getElementById('input-soil-ec')?.value || 0);
  const temp = parseFloat(document.getElementById('input-air-temp')?.value || 0);
  const hum = parseFloat(document.getElementById('input-air-hum')?.value || 0);
  const rain = parseFloat(document.getElementById('input-rain')?.value || 0);

  const k15 = document.getElementById('kpi-soil-15');
  const k30 = document.getElementById('kpi-soil-30');
  const kph = document.getElementById('kpi-soil-ph');
  const kec = document.getElementById('kpi-soil-ec');

  if (k15) k15.innerText = soil15.toFixed(1) + "%";
  if (k30) k30.innerText = soil30.toFixed(1) + "%";
  if (kph) kph.innerText = ph.toFixed(1) + " pH";
  if (kec) kec.innerText = ec.toFixed(1) + " dS/m";

  const t15 = document.getElementById('trend-soil-15');
  const t30 = document.getElementById('trend-soil-30');
  const tph = document.getElementById('trend-soil-ph');
  const tec = document.getElementById('trend-soil-ec');

  if (t15) {
    if (soil15 < 20) {
      t15.innerHTML = '🔴 แห้งจัด! เสี่ยงรากฝอยขาดน้ำ';
      t15.style.color = 'var(--rose-600)';
    } else if (soil15 >= 20 && soil15 <= 35) {
      t15.innerHTML = '🟢 แห้งพอดีสำหรับงดน้ำกระตุ้นดอก';
      t15.style.color = 'var(--emerald-600)';
    } else if (soil15 > 35 && soil15 <= 50) {
      t15.innerHTML = '🟢 ความชื้นเหมาะสม ปล่อยน้ำโชยได้';
      t15.style.color = 'var(--blue-600)';
    } else {
      t15.innerHTML = '⚠️ ดินแฉะเกินไป ใบอ่อนอาจแตกทับตาดอก';
      t15.style.color = 'var(--amber-600)';
    }
  }

  if (t30) {
    if (soil30 < 25) {
      t30.innerHTML = '🔴 แห้งรุนแรง! รากแกนดูดปุ๋ยไม่ได้';
      t30.style.color = 'var(--rose-600)';
    } else if (soil30 >= 25 && soil30 <= 45) {
      t30.innerHTML = '🟢 ความชื้นปานกลาง อยู่ในเกณฑ์ดี';
      t30.style.color = 'var(--emerald-600)';
    } else if (soil30 > 45 && soil30 <= 65) {
      t30.innerHTML = '🟢 รากดูดซึมปุ๋ยได้มีประสิทธิภาพสูง';
      t30.style.color = 'var(--emerald-600)';
    } else {
      t30.innerHTML = '🔴 ดินอิ่มน้ำจัด เสี่ยงเน่าคอดิน/รากเน่า';
      t30.style.color = 'var(--rose-600)';
    }
  }

  if (tph) {
    if (ph < 5.0) {
      tph.innerHTML = '🔴 กรดจัด! ตรึงฟอสฟอรัส-แร่ธาตุ';
      tph.style.color = 'var(--rose-600)';
    } else if (ph >= 5.0 && ph < 5.5) {
      tph.innerHTML = '⚠️ ดินเริ่มเปรี้ยว แนะนำปรับค่าดิน';
      tph.style.color = 'var(--amber-600)';
    } else if (ph >= 5.5 && ph <= 6.5) {
      tph.innerHTML = '🟢 เหมาะสมทุเรียนยอดเยี่ยม (5.5-6.5)';
      tph.style.color = 'var(--emerald-600)';
    } else if (ph > 6.5 && ph <= 7.5) {
      tph.innerHTML = '⚠️ ด่างอ่อน ดินเริ่มตรึงแร่ธาตุเสริม';
      tph.style.color = 'var(--amber-600)';
    } else {
      tph.innerHTML = '🔴 ด่างจัด! เสี่ยงใบเหลืองขาดแร่ธาตุ';
      tph.style.color = 'var(--rose-600)';
    }
  }

  if (tec) {
    if (ec < 0.5) {
      tec.innerHTML = '⚠️ ดินจืดเกินไป ปริมาณปุ๋ยต่ำมาก';
      tec.style.color = 'var(--amber-600)';
    } else if (ec >= 0.5 && ec <= 1.8) {
      tec.innerHTML = '🟢 ความเข้มข้นปุ๋ยเหมาะสม ปลอดภัย';
      tec.style.color = 'var(--emerald-600)';
    } else if (ec > 1.8 && ec <= 2.5) {
      tec.innerHTML = '⚠️ ปุ๋ยหนาแน่นปานกลาง ควรระมัดระวัง';
      tec.style.color = 'var(--amber-600)';
    } else {
      tec.innerHTML = '🔴 ดินเค็มจัด! เสี่ยงรากฝอยไหม้แห้ง';
      tec.style.color = 'var(--rose-600)';
    }
  }

  let recWaterHtml = '';
  if (currentPredictorModeLocal === 'flower') {
    if (soil15 > 35 && soil30 > 45) {
      recWaterHtml = `
        <div style="background:var(--rose-50); padding:14px; border-radius:8px; border:1px solid var(--rose-200);">
          <strong style="color:var(--rose-800); font-size:0.9rem;">💧 แนะนำการจัดการน้ำ: งดน้ำขั้นวิกฤต</strong>
          <p style="font-size:0.8rem; color:var(--rose-700); margin-top:6px;">
            ขณะนี้อยู่ในโหมดทำดอก แต่ความชื้นดินค่อนข้างสูง (ชั้นบน ${soil15.toFixed(1)}%) <strong>ให้งดให้น้ำโดยเด็ดขาด</strong> เพื่อกระตุ้นให้ใบลู่โศกและแทงตาดอก หากฝนตกให้ฉีดพ่นสะสมอาหารสะกดใบอ่อนด่วน!
          </p>
        </div>
      `;
    } else if (soil15 <= 25 && soil30 <= 35) {
      recWaterHtml = `
        <div style="background:var(--emerald-50); padding:14px; border-radius:8px; border:1px solid var(--emerald-200);">
          <strong style="color:var(--emerald-800); font-size:0.9rem;">💧 แนะนำการจัดการน้ำ: เริ่มให้น้ำโชย (โชยดอก)</strong>
          <p style="font-size:0.8rem; color:var(--emerald-700); margin-top:6px;">
            ความชื้นดินลดลงเพียงพอต่อการโศกสะสมตาดอกแล้ว ทุเรียนจะเริ่มโผล่ตาดอกไข่ปลาทอง <strong>แนะนำให้เริ่มเหวี่ยงน้ำแบบโชยเบาๆ (10-15 นาที)</strong> เพื่อกระตุ้นตาดอกให้พัฒนาหลุดพ้นกิ่ง ห้ามอัดน้ำแรงเกินไปจะทำให้ตาดอกฝ่อกลายเป็นยอดใบ
          </p>
        </div>
      `;
    } else {
      recWaterHtml = `
        <div style="background:var(--blue-50); padding:14px; border-radius:8px; border:1px solid var(--blue-200);">
          <strong style="color:var(--blue-800); font-size:0.9rem;">💧 แนะนำการจัดการน้ำ: ให้น้ำอัตราปกติ</strong>
          <p style="font-size:0.8rem; color:var(--blue-700); margin-top:6px;">
            รักษาความชื้นดินให้อยู่ในระดับ 30-40% ให้น้ำวันเว้นวัน หรือวันเว้นสองวัน เพื่อเลี้ยงดอกและประคองตาดอกให้สมบูรณ์ แต่อัตราการให้น้ำต้องไม่เกิน 60-100 ลิตร/ต้น เพื่อป้องกันดอกร่วง
          </p>
        </div>
      `;
    }
  } else {
    if (soil15 < 30) {
      recWaterHtml = `
        <div style="background:var(--rose-50); padding:14px; border-radius:8px; border:1px solid var(--rose-200);">
          <strong style="color:var(--rose-800); font-size:0.9rem;">💧 แนะนำการจัดการน้ำ: เพิ่มการให้น้ำดึงใบ</strong>
          <p style="font-size:0.8rem; color:var(--rose-700); margin-top:6px;">
            อยู่ระหว่างระยะทำใบใหม่แต่ดินแห้งเกินไป (${soil15.toFixed(1)}%) ส่งผลให้ใบเหี่ยวแห้งและแทงยอดอ่อนได้ไม่ดี <strong>แนะนำให้อัดน้ำเต็มสูตร 150-200 ลิตร/ต้น</strong> สัปดาห์ละ 2-3 ครั้ง และพ่นปุ๋ยทางใบตัวหน้าสูงดึงยอดด่วน
          </p>
        </div>
      `;
    } else {
      recWaterHtml = `
        <div style="background:var(--emerald-50); padding:14px; border-radius:8px; border:1px solid var(--emerald-200);">
          <strong style="color:var(--emerald-800); font-size:0.9rem;">💧 แนะนำการจัดการน้ำ: เลี้ยงความชื้นบำรุงใบ</strong>
          <p style="font-size:0.8rem; color:var(--emerald-700); margin-top:6px;">
            ความชื้นดินเหมาะสมดีมาก รักษาความชื้นดินในทรงพุ่มไว้ระดับ 40-50% เพื่อสนับสนุนปุ๋ยทางดิน เช่น สูตร 15-15-15 ให้ปลดปล่อยธาตุอาหารบำรุงเนื้อใบให้หนาและเข้มเป็นมันเงาอย่างรวดเร็ว
          </p>
        </div>
      `;
    }
  }

  let recSoilHtml = '';
  if (ph < 5.5) {
    recSoilHtml = `
      <div style="background:var(--rose-50); padding:14px; border-radius:8px; border:1px solid var(--rose-200);">
        <strong style="color:var(--rose-800); font-size:0.9rem;">🧪 คำแนะนำด้านดิน: ดินเป็นกรดรุนแรง</strong>
        <p style="font-size:0.8rem; color:var(--rose-700); margin-top:6px;">
          ค่า pH ในดินอยู่ที่ ${ph.toFixed(1)} ซึ่งเป็นกรดสูงมาก ดินเปรี้ยวจะตรึงปุ๋ยไม่ให้พืชนำไปใช้ และส่งเสริมสปอร์ไฟทอปธอรา <strong>แนะนำหว่านปูนโดโลไมท์ อัตรา 2-3 กิโลกรัมต่อต้น</strong>
        </p>
      </div>
    `;
  } else if (ph > 6.5) {
    recSoilHtml = `
      <div style="background:var(--amber-50); padding:14px; border-radius:8px; border:1px solid var(--amber-200);">
        <strong style="color:var(--amber-800); font-size:0.9rem;">🧪 คำแนะนำด้านดิน: ดินเป็นด่าง</strong>
        <p style="font-size:0.8rem; color:var(--amber-700); margin-top:6px;">
          ค่า pH ดินอยู่ที่ ${ph.toFixed(1)} มีสภาพเป็นด่างอ่อนถึงปานกลาง หลีกเลี่ยงการโรยปูนขาว และใส่ปุ๋ยหมักเพื่อปรับสภาพดิน
        </p>
      </div>
    `;
  } else if (ec > 1.8) {
    recSoilHtml = `
      <div style="background:var(--rose-50); padding:14px; border-radius:8px; border:1px solid var(--rose-200);">
        <strong style="color:var(--rose-800); font-size:0.9rem;">🧪 คำแนะนำด้านดิน: ดินเค็ม / ปุ๋ยตกค้างสูง</strong>
        <p style="font-size:0.8rem; color:var(--rose-700); margin-top:6px;">
          ค่าความเค็ม EC สูงถึง ${ec.toFixed(1)} dS/m เสี่ยงรากไหม้ แนะนำหยุดป้อนปุ๋ยเคมีทั้งหมดทันที และระบายน้ำจืดล้างดิน
        </p>
      </div>
    `;
  } else {
    recSoilHtml = `
      <div style="background:var(--emerald-50); padding:14px; border-radius:8px; border:1px solid var(--emerald-200);">
        <strong style="color:var(--emerald-800); font-size:0.9rem;">🧪 คำแนะนำด้านดิน: สภาพดินสมบูรณ์ดีเยี่ยม</strong>
        <p style="font-size:0.8rem; color:var(--emerald-700); margin-top:6px;">
          คุณสมบัติเคมีในดินดีมาก (pH: ${ph.toFixed(1)} / EC: ${ec.toFixed(1)}) รากทุเรียนดูดซับธาตุอาหารได้ครบถ้วน
        </p>
      </div>
    `;
  }

  let recWeatherHtml = '';
  if (hum > 85 && rain > 5) {
    recWeatherHtml = `
      <div style="background:var(--rose-50); padding:14px; border-radius:8px; border:1px solid var(--rose-200);">
        <strong style="color:var(--rose-800); font-size:0.9rem;">🌦️ ดัชนีสภาพอากาศ: เสี่ยงโรคเชื้อราสูงจัด</strong>
        <p style="font-size:0.8rem; color:var(--rose-700); margin-top:6px;">
          ความชื้นสัมพัทธ์สูง (${hum.toFixed(0)}%) ฝนสะสม ${rain.toFixed(1)} มม. แนะนำพ่นยาป้องกันเชื้อราเมทาแลกซิลหรือฟอสฟอนิกแอซิดด่วน
        </p>
      </div>
    `;
  } else if (temp > 35) {
    recWeatherHtml = `
      <div style="background:var(--amber-50); padding:14px; border-radius:8px; border:1px solid var(--amber-200);">
        <strong style="color:var(--amber-800); font-size:0.9rem;">🌦️ ดัชนีสภาพอากาศ: เฝ้าระวังความเครียดจากความร้อน</strong>
        <p style="font-size:0.8rem; color:var(--amber-700); margin-top:6px;">
          อุณหภูมิพุ่งสูงถึง ${temp.toFixed(1)}°C แดดจัด แนะนำตั้งเวลาสปริงเกอร์รดน้ำพ่นฝอยระบายอากาศร้อนช่วง 11.00 - 13.00 น.
        </p>
      </div>
    `;
  } else {
    recWeatherHtml = `
      <div style="background:var(--emerald-50); padding:14px; border-radius:8px; border:1px solid var(--emerald-200);">
        <strong style="color:var(--emerald-800); font-size:0.9rem;">🌦️ ดัชนีสภาพอากาศ: สภาพอากาศปกติ</strong>
        <p style="font-size:0.8rem; color:var(--emerald-700); margin-top:6px;">
          อุณหภูมิอากาศเฉลี่ย ${temp.toFixed(1)}°C ความชื้น ${hum.toFixed(0)}% เหมาะสำหรับการฉีดพ่นยาสารเคมีทางใบตามตารางปกติ
        </p>
      </div>
    `;
  }

  const advBoard = document.getElementById('expert-advisory-board');
  if (advBoard) {
    advBoard.innerHTML = recWaterHtml + recSoilHtml + recWeatherHtml;
  }
}
