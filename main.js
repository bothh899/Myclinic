const TOOTH_PATH = "M224 0C170 0 112 12 68 40 24 68 -4 110 6 165c7 40 24 118 47 165 20 41 40 62 61 62 21 0 30-18 35-46 4-24 8-38 16-38s12 14 16 38c5 28 14 46 35 46 21 0 41-21 61-62 23-47 40-125 47-165 10-55-18-97-62-125C336 12 278 0 224 0Z";
const UPPER_TEETH = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
const LOWER_TEETH = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];

let settings = { clinicName:'', clinicSub:'', clinicFacebook:'', exRate:4100 };
let rows = []; // {tooth, treatment, qty, price}
let toothState = {}; // {num: 'untreated'|'treated'}
let currentPatientKey = null;
let presetServices = [];
let pendingToothIndices = [];

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBPiwRHcLf21WlLfwQi8gufOwo2vER6Idw",
  authDomain: "myclinic-e2837.firebaseapp.com",
  projectId: "myclinic-e2837",
  storageBucket: "myclinic-e2837.firebasestorage.app",
  messagingSenderId: "323594166146",
  appId: "1:323594166146:web:c2e60a163d1f30b2b9799b",
  measurementId: "G-V3YR657RKK"
};

function esc(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- local persistent storage (works on any web server, survives refresh) ---------- */
const LocalStore = {
  async get(key){
    try{
      const v = localStorage.getItem(key);
      return v!==null ? {key, value:v} : null;
    }catch(e){ return null; }
  },
  async set(key, value){
    try{
      localStorage.setItem(key, value);
      return {key, value};
    }catch(e){ return null; }
  }
};


/* ---------- toast notifications ---------- */
function showToast(message, type){
  type = type || 'info';
  let container = document.getElementById('toastContainer');
  if(!container){
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icon = type==='success' ? '✅' : type==='error' ? '⚠️' : 'ℹ️';
  const toast = document.createElement('div');
  toast.className = 'toast toast-'+type;
  toast.innerHTML = '<span class="toast-icon">'+icon+'</span><span class="toast-msg">'+esc(message)+'</span>';
  container.appendChild(toast);
  requestAnimationFrame(()=>toast.classList.add('show'));
  setTimeout(()=>{
    toast.classList.remove('show');
    setTimeout(()=>toast.remove(), 250);
  }, 2800);
}

/* ---------- custom confirm modal (replaces native confirm()) ---------- */
function showConfirm(message, opts){
  opts = opts || {};
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal confirm-modal" role="alertdialog">' +
        '<div class="confirm-icon">'+(opts.icon || '❓')+'</div>' +
        '<p class="confirm-message">'+esc(message)+'</p>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-secondary" data-action="cancel">'+esc(opts.cancelLabel || 'បោះបង់')+'</button>' +
          '<button class="btn btn-danger" data-action="ok">'+esc(opts.okLabel || 'យល់ព្រម')+'</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>overlay.classList.add('show'));
    function close(result){
      overlay.classList.remove('show');
      setTimeout(()=>overlay.remove(), 180);
      resolve(result);
    }
    overlay.addEventListener('click', e=>{
      if(e.target===overlay){ close(false); return; }
      const btn = e.target.closest('button[data-action]');
      if(btn) close(btn.dataset.action==='ok');
    });
  });
}


/* ---------- generic modal ---------- */
function closeModal(){
  const overlay = document.getElementById('activeModalOverlay');
  if(!overlay) return;
  overlay.classList.remove('show');
  setTimeout(()=>overlay.remove(), 180);
}
function openModal(innerHtml, extraClass){
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'activeModalOverlay';
  overlay.innerHTML = '<div class="modal '+(extraClass||'')+'">'+innerHtml+'</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) closeModal(); });
  requestAnimationFrame(()=>overlay.classList.add('show'));
  return overlay;
}

/* ---------- nav / views ---------- */
function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const target = document.getElementById('view-'+name);
  if(target) target.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  window.scrollTo({top:0, behavior:'smooth'});
  if(name==='prescription') refreshPrescriptionView();
}
function clearAllSilent(){
  rows = [];
  toothState = {};
  currentPatientKey = null;
  pendingToothIndices = [];
  loadedInvoiceId = null;
  document.getElementById('surname').value='';
  document.getElementById('givenName').value='';
  document.getElementById('gender').value='';
  document.getElementById('age').value='';
  document.getElementById('patientPhone').value='';
  document.getElementById('doctorName').value=settings.doctorName || '';
  document.getElementById('cashierName').value=settings.cashierName || '';
  document.getElementById('discountValue').value=0;
  document.getElementById('depositValue').value=0;
  document.getElementById('depositCurrency').value='usd';
  document.getElementById('invoiceNotes').value='';
  peekInvoiceNo().then(no=>{ document.getElementById('invoiceNo').value = no; });
  updatePendingLabel();
  renderRows();
  renderTeeth();
}
async function newInvoice(){
  const hasData = rows.length>0 ||
    document.getElementById('surname').value.trim() ||
    document.getElementById('givenName').value.trim();
  if(hasData){
    const ok = await showConfirm('ចាប់ផ្ដើមវិក្កយបត្រថ្មី? ទិន្នន័យបច្ចុប្បន្នដែលមិនទាន់រក្សាទុក នឹងបាត់។', {icon:'🧾', okLabel:'បង្កើតថ្មី'});
    if(!ok) return;
  }
  clearAllSilent();
  switchView('invoice');
  showToast('ត្រៀមរួចរាល់សម្រាប់វិក្កយបត្រថ្មី', 'success');
}

/* ---------- settings ---------- */
function updateClinicHeaderDisplay(){
  const name = settings.clinicName || 'We Trust Dental Clinic';
  const sub = settings.clinicSub || 'Tel: 092 463 646 | Phnom Penh, Cambodia';
  const fb = settings.clinicFacebook || '';
  const logo = settings.clinicLogo || '';
  const address = settings.clinicAddress || '';
  const email = settings.clinicEmail || '';
  const website = settings.clinicWebsite || '';
  const phone = settings.clinicPhone || '';
  const nameEl = document.getElementById('clinicNameDisplay');
  const subEl = document.getElementById('clinicSubDisplay');
  const fbEl = document.getElementById('clinicFbDisplay');
  const navEl = document.getElementById('navClinicName');
  const rxNameEl = document.getElementById('rxClinicNameDisplay');
  const rxSubEl = document.getElementById('rxClinicSubDisplay');
  const logoEl = document.getElementById('clinicLogoImg');
  const rxLogoEl = document.getElementById('rxClinicLogoImg');
  if(nameEl) nameEl.textContent = name;
  if(subEl) subEl.textContent = sub;
  if(fbEl) fbEl.textContent = fb;
  if(navEl) navEl.textContent = name;
  if(rxNameEl) rxNameEl.textContent = name;
  if(rxSubEl) rxSubEl.textContent = sub;
  [logoEl, rxLogoEl].forEach(el=>{
    if(!el) return;
    if(logo){ el.src = logo; el.style.display = 'inline-block'; }
    else{ el.style.display = 'none'; el.removeAttribute('src'); }
  });

  // invoice print letterhead
  const invLogoEl = document.getElementById('invPrintLogo');
  if(invLogoEl){
    if(logo){ invLogoEl.src = logo; invLogoEl.style.display = 'inline-block'; }
    else{ invLogoEl.style.display = 'none'; invLogoEl.removeAttribute('src'); }
  }
  const nameKhEl = document.getElementById('invPrintNameKh');
  if(nameKhEl) nameKhEl.textContent = name;

  setRowText('invPrintEmailRow', 'invPrintEmail', email, 'Email');
  setRowText('invPrintWebsiteRow', 'invPrintWebsite', website, 'Website');
  setRowText('invPrintFbRow', 'invPrintFb', fb, 'Facebook');
  setRowText('invPrintPhoneRow', 'invPrintPhone', phone, 'Tel');

  const addrEl = document.getElementById('invPrintAddress');
  if(addrEl){
    addrEl.textContent = address;
    addrEl.style.display = address ? 'block' : 'none';
  }
}
function setRowText(rowId, spanId, value, label){
  const row = document.getElementById(rowId);
  const span = document.getElementById(spanId);
  if(!row || !span) return;
  span.textContent = value;
  row.style.display = value ? 'block' : 'none';
}
function renderLogoPreview(){
  const preview = document.getElementById('clinicLogoPreview');
  if(!preview) return;
  if(settings.clinicLogo){
    preview.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<img src="'+settings.clinicLogo+'" style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid var(--line);">' +
        '<button class="del-btn" onclick="removeClinicLogo()">✕ លុប Logo</button>' +
      '</div>';
  }else{
    preview.innerHTML = '';
  }
}
async function handleLogoUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){
    showToast('សូមជ្រើសរើសឯកសាររូបភាព', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async function(ev){
    settings.clinicLogo = ev.target.result;
    try{ await LocalStore.set('clinic-settings', JSON.stringify(settings)); }catch(err){}
    updateClinicHeaderDisplay();
    renderLogoPreview();
    showToast('បានបញ្ចូល Logo រួចរាល់', 'success');
  };
  reader.readAsDataURL(file);
}
async function removeClinicLogo(){
  delete settings.clinicLogo;
  try{ await LocalStore.set('clinic-settings', JSON.stringify(settings)); }catch(e){}
  updateClinicHeaderDisplay();
  renderLogoPreview();
  const input = document.getElementById('clinicLogoInput');
  if(input) input.value = '';
  showToast('បានលុប Logo រួចរាល់', 'success');
}
async function loadSettings(){
  try{
    const r = await LocalStore.get('clinic-settings');
    if(r && r.value) settings = JSON.parse(r.value);
  }catch(e){}
  document.getElementById('clinicName').value = settings.clinicName || 'We Trust Dental Clinic';
  document.getElementById('clinicSub').value = settings.clinicSub || 'Tel: 092 463 646 | Phnom Penh, Cambodia';
  document.getElementById('clinicFacebook').value = settings.clinicFacebook || '';
  document.getElementById('clinicAddress').value = settings.clinicAddress || '';
  document.getElementById('clinicEmail').value = settings.clinicEmail || '';
  document.getElementById('clinicWebsite').value = settings.clinicWebsite || '';
  document.getElementById('clinicPhone').value = settings.clinicPhone || '';
  document.getElementById('exRate').value = settings.exRate || 4100;
  document.getElementById('doctorName').value = settings.doctorName || '';
  document.getElementById('cashierName').value = settings.cashierName || '';
  updateClinicHeaderDisplay();
  renderLogoPreview();
}
async function saveSettings(){
  settings = {
    clinicName: document.getElementById('clinicName').value.trim(),
    clinicSub: document.getElementById('clinicSub').value.trim(),
    clinicFacebook: document.getElementById('clinicFacebook').value.trim(),
    clinicAddress: document.getElementById('clinicAddress').value.trim(),
    clinicEmail: document.getElementById('clinicEmail').value.trim(),
    clinicWebsite: document.getElementById('clinicWebsite').value.trim(),
    clinicPhone: document.getElementById('clinicPhone').value.trim(),
    exRate: parseFloat(document.getElementById('exRate').value) || 4100,
    doctorName: settings.doctorName,
    cashierName: settings.cashierName,
    clinicLogo: settings.clinicLogo
  };
  try{ await LocalStore.set('clinic-settings', JSON.stringify(settings)); }catch(e){}
  updateClinicHeaderDisplay();
  renderTotals();
}
document.getElementById('clinicAddress').addEventListener('input', saveSettings);
document.getElementById('clinicEmail').addEventListener('input', saveSettings);
document.getElementById('clinicWebsite').addEventListener('input', saveSettings);
document.getElementById('clinicPhone').addEventListener('input', saveSettings);
document.getElementById('clinicName').addEventListener('input', saveSettings);
document.getElementById('clinicSub').addEventListener('input', saveSettings);
document.getElementById('clinicFacebook').addEventListener('input', saveSettings);
document.getElementById('exRate').addEventListener('input', saveSettings);
document.getElementById('discountValue').addEventListener('input', renderTotals);
document.getElementById('discountType').addEventListener('change', renderTotals);
document.getElementById('depositValue').addEventListener('input', renderTotals);
document.getElementById('depositCurrency').addEventListener('change', renderTotals);
document.getElementById('doctorName').addEventListener('change', async ()=>{
  settings.doctorName = document.getElementById('doctorName').value.trim();
  try{ await LocalStore.set('clinic-settings', JSON.stringify(settings)); }catch(e){}
});
document.getElementById('cashierName').addEventListener('change', async ()=>{
  settings.cashierName = document.getElementById('cashierName').value.trim();
  try{ await LocalStore.set('clinic-settings', JSON.stringify(settings)); }catch(e){}
});

/* ---------- tooth chart ---------- */
function patientKey(){
  const sn = document.getElementById('surname').value.trim().toLowerCase();
  const gn = document.getElementById('givenName').value.trim().toLowerCase();
  const full = (sn+' '+gn).trim();
  return full ? 'dental-chart:'+full : null;
}
async function loadToothChartForPatient(){
  const key = patientKey();
  if(!key){ toothState = {}; currentPatientKey = null; renderTeeth(); return; }
  currentPatientKey = key;
  try{
    const r = await LocalStore.get(key);
    toothState = (r && r.value) ? JSON.parse(r.value) : {};
  }catch(e){ toothState = {}; }
  renderTeeth();
}
async function saveToothChart(){
  if(!currentPatientKey) return;
  try{ await LocalStore.set(currentPatientKey, JSON.stringify(toothState)); }catch(e){}
}

// បង្កើត Firestore instance តែម្ដងគត់ ហើយប្រើឡើងវិញគ្រប់កន្លែង
let fbDb = null;
async function getFbDb() {
  if (fbDb) return fbDb;
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js");
  const { getFirestore } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
  const app = initializeApp(FIREBASE_CONFIG);
  fbDb = getFirestore(app);
  return fbDb;
}

// រក្សាទុកដោយកំណត់ document ID ខ្លួនឯង (setDoc) ជំនួស addDoc ID ចៃដន្យ
// ដូច្នេះ history អាចផ្ទុកមកវិញបានតាម id ដដែល
async function saveToFirebase(id, invoiceData) {
  try {
    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
    const db = await getFbDb();
    await setDoc(doc(db, "invoices", id), invoiceData);
    console.log("រក្សាទុកទៅ Firebase ជោគជ័យ!");
  } catch (e) {
    console.error("កំហុសក្នុងការរក្សាទុក:", e);
  }
}

// ទាញយក invoice មួយ ពី Firebase តាម id
async function fetchInvoiceRecord(id) {
  const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
  const db = await getFbDb();
  const snap = await getDoc(doc(db, "invoices", id));
  return snap.exists() ? snap.data() : null;
}

function cycleTooth(num){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  const cur = toothState[num] || 'normal';
  const next = cur==='normal' ? 'untreated' : (cur==='untreated' ? 'treated' : 'normal');

  if(next==='normal'){
    delete toothState[num];
    const idx = rows.findIndex(r=>String(r.tooth)===String(num));
    if(idx!==-1 && !rows[idx].treatment){
      rows.splice(idx,1);
      pendingToothIndices = pendingToothIndices.filter(i=>i!==idx).map(i=>i>idx ? i-1 : i);
      renderRows();
      updatePendingLabel();
    }
    saveToothChart();
    renderTeeth();
    return;
  }

  toothState[num] = next;
  saveToothChart();

  let idx = rows.findIndex(r=>String(r.tooth)===String(num));
  if(idx===-1){
    rows.push({tooth:num, treatment:'', qty:1, price:0});
    idx = rows.length-1;
  }
  pendingToothIndices = [idx];
  renderRows();
  renderTeeth();
  updatePendingLabel();
  document.getElementById('serviceInput').focus();
}
function selectRange(start, end){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  const nums = [];
  for(let n=start; n<=end; n++) nums.push(n);
  toggleSelection(nums);
}
function selectAllTeeth(){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  toggleSelection([...UPPER_TEETH, ...LOWER_TEETH]);
}
function selectAllUpper(){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  toggleSelection(UPPER_TEETH);
}
function selectAllLower(){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  toggleSelection(LOWER_TEETH);
}
/* ---------- toggle: if every tooth in nums is already marked, clicking again clears them; ---------- */
/* ---------- otherwise it selects them. Rows with a treatment already saved are never deleted. ---------- */
function toggleSelection(nums){
  const allMarked = nums.every(n => toothState[n]==='untreated' || toothState[n]==='treated');
  if(allMarked){
    nums.forEach(num=>{ delete toothState[num]; });
    rows = rows.filter(r => !(nums.map(String).includes(String(r.tooth)) && !r.treatment));
    saveToothChart();
    pendingToothIndices = [];
    renderRows();
    renderTeeth();
    updatePendingLabel();
    showToast('បានដកការជ្រើសរើសធ្មេញចេញ', 'info');
  }else{
    applyPendingSelection(nums);
  }
}
function applyPendingSelection(nums){
  const indices = [];
  nums.forEach(num=>{
    if(!(toothState[num]==='untreated' || toothState[num]==='treated')){
      toothState[num] = 'untreated';
    }
    let idx = rows.findIndex(r=>String(r.tooth)===String(num));
    if(idx===-1){
      rows.push({tooth:num, treatment:'', qty:1, price:0});
      idx = rows.length-1;
    }
    indices.push(idx);
  });
  saveToothChart();
  pendingToothIndices = indices;
  renderRows();
  renderTeeth();
  updatePendingLabel();
  document.getElementById('serviceInput').focus();
}
function updatePendingLabel(){
  const el = document.getElementById('pendingLabel');
  const valid = pendingToothIndices.filter(i=>rows[i]);
  if(valid.length>0){
    el.style.display='inline-block';
    const nums = valid.map(i=>rows[i].tooth);
    el.textContent = 'កំពុងជ្រើសរើសសេវាកម្មសម្រាប់ធ្មេញលេខ ' + nums.join(', ');
  }else{
    el.style.display='none';
  }
}
function toothBtn(num){
  const state = toothState[num] || 'normal';
  return `<button class="tooth-btn ${state}" onclick="cycleTooth(${num})" title="ធ្មេញលេខ ${num}">
    <svg viewBox="0 0 448 512"><path d="${TOOTH_PATH}" stroke-width="6"/></svg>
    <span class="num">${num}</span>
  </button>`;
}
function renderTeeth(){
  document.getElementById('upperRow').innerHTML =
    UPPER_TEETH.slice(0,8).map(toothBtn).join('') +
    '<span class="quad-divider"></span>' +
    UPPER_TEETH.slice(8).map(toothBtn).join('');
  document.getElementById('lowerRow').innerHTML =
    LOWER_TEETH.slice(0,8).map(toothBtn).join('') +
    '<span class="quad-divider"></span>' +
    LOWER_TEETH.slice(8).map(toothBtn).join('');
}
document.getElementById('surname').addEventListener('input', loadToothChartForPatient);
document.getElementById('givenName').addEventListener('input', loadToothChartForPatient);

/* ---------- item rows ---------- */
async function loadPresetServices(){
  try{
    const r = await LocalStore.get('preset-services');
    if(r && r.value) presetServices = JSON.parse(r.value);
  }catch(e){
    presetServices = [
      {id:'s1', name:'ជូតធ្មេញ', price:8},
      {id:'s2', name:'ខួងធ្មេញ', price:15},
      {id:'s3', name:'ដកធ្មេញ', price:10},
      {id:'s4', name:'ឆ្នូតធ្មេញ', price:5}
    ];
    await savePresetServices();
  }
  renderServiceOptions();
  renderServiceManageList();
}
async function savePresetServices(){
  try{ await LocalStore.set('preset-services', JSON.stringify(presetServices)); }catch(e){}
}
function renderServiceOptions(){
  document.getElementById('serviceOptions').innerHTML =
    presetServices.map(s=>`<option value="${esc(s.name)}"></option>`).join('');
}
function renderServiceManageList(){
  const list = document.getElementById('serviceManageList');
  if(presetServices.length===0){
    list.innerHTML = '<div style="font-size:11.5px;color:#a9b8b5;">មិនទាន់មានសេវាកម្មទេ</div>';
    return;
  }
  list.innerHTML = presetServices.map(s=>`
    <div class="service-manage-item">
      <span>${esc(s.name)} — $${Number(s.price).toFixed(2)}</span>
      <button class="del-btn" onclick="deletePresetService('${s.id}')">✕</button>
    </div>`).join('');
}
async function deletePresetService(id){
  const svc = presetServices.find(s=>s.id===id);
  const ok = await showConfirm('លុបសេវាកម្ម "'+(svc?svc.name:'')+'" ចេញពីបញ្ជី?', {icon:'🗑️', okLabel:'លុប'});
  if(!ok) return;
  presetServices = presetServices.filter(s=>s.id!==id);
  await savePresetServices();
  renderServiceOptions();
  renderServiceManageList();
  showToast('បានលុបសេវាកម្មរួចរាល់', 'success');
}
async function addPresetServiceDirect(){
  const nameEl = document.getElementById('newServiceName');
  const priceEl = document.getElementById('newServicePrice');
  const name = nameEl.value.trim();
  const price = parseFloat(priceEl.value);
  if(!name){ nameEl.focus(); return; }
  if(isNaN(price)){ priceEl.focus(); return; }
  if(presetServices.some(s=>s.name===name)){
    showToast('សេវាកម្មនេះមានរួចហើយ', 'error');
    return;
  }
  presetServices.push({id:'s'+Date.now(), name, price});
  await savePresetServices();
  renderServiceOptions();
  renderServiceManageList();
  nameEl.value=''; priceEl.value='';
  nameEl.focus();
  showToast('បានបន្ថែមសេវាកម្មរួចរាល់', 'success');
}
function onServiceInputChange(){
  const name = document.getElementById('serviceInput').value.trim();
  const match = presetServices.find(s=>s.name===name);
  if(match){
    document.getElementById('servicePriceInput').value = match.price;
  }
}
async function addServiceToInvoice(){

  const name = document.getElementById('serviceInput').value.trim();
  const price = parseFloat(document.getElementById('servicePriceInput').value);
  const qty = parseFloat(document.getElementById('serviceQtyInput').value) || 1;
  if(!name || isNaN(price)) return;

  // ពិនិត្យមើលថាតើសេវាជា Scaling ឬ X-Ray ឬការជ្រើសរើស Full Mouth
  const isFullMouthService = name.toLowerCase().includes('scaling') || name.toLowerCase().includes('x-ray');

  if(pendingToothIndices.length>0){
    // បើសិនជាជ្រើសរើសធ្មេញទាំងអស់ (Full Mouth ស្មើ ៣២ ធ្មេញ) ឬជាសេវា Scaling/X-Ray
    if (pendingToothIndices.length === 32 || isFullMouthService) {
      // ទុកតែជួរទីមួយ ហើយដាក់ឈ្មោះធ្មេញជា "Full Mouth"
      const firstIdx = pendingToothIndices[0];
      
      // លុបជួរធ្មេញផ្សេងទៀតដែលរាយលេខចោល
      for (let i = pendingToothIndices.length - 1; i > 0; i--) {
        const idxToRemove = pendingToothIndices[i];
        rows.splice(idxToRemove, 1);
      }
      
      if(rows[firstIdx]){
        rows[firstIdx].tooth = 'Full Mouth';
        rows[firstIdx].treatment = name;
        rows[firstIdx].price = price;
        rows[firstIdx].qty = qty;
      }
    } else {
      // ប្រសិនបើជ្រើសរើសធ្មេញធម្មតា បញ្ចូលឈ្មោះសេវា និងតម្លៃតាមលេខធ្មេញនីមួយៗ
      pendingToothIndices.forEach(idx=>{
        if(rows[idx]){
          rows[idx].treatment = name;
          rows[idx].price = price;
          rows[idx].qty = qty;
        }
      });
    }
    pendingToothIndices = [];
  }else{
    // បើមិនបានចុចរើសធ្មេញទេ ប៉ុន្តែសេវានោះជា Scaling/X-Ray ឲ្យចេញ Full Mouth
    const toothValue = isFullMouthService ? 'Full Mouth' : '';
    rows.push({tooth: toothValue, treatment: name, qty: qty, price: price});
  }

  const exists = presetServices.some(s=>s.name===name);
  if(!exists){
    presetServices.push({id:'s'+Date.now(), name, price});
    await savePresetServices();
    renderServiceOptions();
    renderServiceManageList();
  }
  document.getElementById('serviceInput').value='';
  document.getElementById('servicePriceInput').value='';
  document.getElementById('serviceQtyInput').value=1;
  document.getElementById('serviceInput').focus();
  updatePendingLabel();
  renderRows();
}

function addRow(){
  rows.push({tooth:'', treatment:'', qty:1, price:0});
  renderRows();
}
function updateRow(idx, field, value){
  if(field==='qty' || field==='price') value = parseFloat(value)||0;
  rows[idx][field] = value;
  renderRows();
}
function removeRow(idx){
  rows.splice(idx,1);
  pendingToothIndices = pendingToothIndices
    .filter(i=>i!==idx)
    .map(i=>i>idx ? i-1 : i);
  updatePendingLabel();
  renderRows();
}
function compactToothRange(teethArr){
  if(teethArr.length===0) return '';
  const sorted = [...teethArr].map(Number).sort((a,b)=>a-b);
  let consecutive = true;
  for(let i=1;i<sorted.length;i++){
    if(sorted[i]!==sorted[i-1]+1){ consecutive = false; break; }
  }
  if(consecutive && sorted.length>1) return sorted[0]+'-'+sorted[sorted.length-1];
  return sorted.join(', ');
}
function renderPrintRows(){

  const tbody = document.getElementById('printRows');
  if(rows.length===0){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">មិនទាន់មានធាតុនៅឡើយទេ</td></tr>';
    return;
  }
  const groups = {};
  const order = [];
  rows.forEach(r=>{
    const key = (r.treatment||'')+'|'+(r.price||0);
    if(!groups[key]){
      groups[key] = {treatment:r.treatment, price:Number(r.price)||0, teeth:[], qty:0, rawTooth: r.tooth};
      order.push(key);
    }
    if(r.tooth!=='' && r.tooth!=null) groups[key].teeth.push(r.tooth);
    groups[key].qty += (r.qty||0);
  });

  tbody.innerHTML = order.map(key=>{
    const g = groups[key];
    const subtotal = g.qty * g.price;
    
    // ត្រង់នេះ៖ ឆែកមើលបើមានពាក្យ "Full Mouth" ឬរើសធ្មេញគ្រប់ ៣២ ឱ្យចេញពាក្យ Full Mouth ពេល Print
    let toothLabel = compactToothRange(g.teeth);
    if (g.rawTooth === 'Full Mouth' || g.teeth.includes('Full Mouth') || g.teeth.length === 32) {
      toothLabel = 'Full Mouth';
    }

    const priceLabel = g.price===0 ? 'Free' : '$'+g.price.toFixed(2);
    const subtotalLabel = g.price===0 ? 'Free' : '$'+subtotal.toFixed(2);
    return `<tr>
      <td>${esc(toothLabel)}</td>
      <td>${esc(g.treatment)}</td>
      <td class="num">${g.qty}</td>
      <td class="num">${priceLabel}</td>
      <td class="num">${subtotalLabel}</td>
    </tr>`;
  }).join('');
}
function renderRows(){
  const tbody = document.getElementById('rows');
  if(rows.length===0){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">មិនទាន់មានធាតុនៅឡើយទេ — ចុច + ដើម្បីបញ្ចូល</td></tr>';
  }else{
    tbody.innerHTML = rows.map((r,idx)=>{
      const subtotal = (r.qty||0) * (r.price||0);
      const subtotalLabel = (r.price||0)===0 ? 'Free' : '$'+subtotal.toFixed(2);
      return `<tr>
        <td class="tooth-cell"><input value="${esc(String(r.tooth))}" placeholder="#" onchange="updateRow(${idx},'tooth',this.value)"></td>
        <td><input value="${esc(r.treatment)}" placeholder="Treatment" onchange="updateRow(${idx},'treatment',this.value)"></td>
        <td class="num"><input class="qty" type="number" min="1" value="${r.qty}" onchange="updateRow(${idx},'qty',this.value)"></td>
        <td class="num"><input class="price" type="number" step="0.01" value="${r.price}" onchange="updateRow(${idx},'price',this.value)" placeholder="0 = Free"></td>
        <td class="num subtotal-cell">${subtotalLabel}</td>
        <td><button class="del-btn" onclick="removeRow(${idx})">✕</button></td>
      </tr>`;
    }).join('');
  }
  renderTotals();
  renderPrintRows();
}
function renderTotals(){
  const subtotalUsd = rows.reduce((s,r)=>s+(r.qty||0)*(r.price||0),0);
  const discVal = parseFloat(document.getElementById('discountValue').value) || 0;
  const discType = document.getElementById('discountType').value;
  const discountUsd = discType==='percent' ? subtotalUsd*(discVal/100) : discVal;
  const totalUsd = Math.max(0, subtotalUsd - discountUsd);
  const rate = parseFloat(document.getElementById('exRate').value)||4100;

  const depositRaw = parseFloat(document.getElementById('depositValue').value) || 0;
  const depositCurrency = document.getElementById('depositCurrency').value;
  const deposit = depositCurrency==='khr' ? (depositRaw / rate) : depositRaw;
  const balance = Math.max(0, totalUsd - deposit);

  document.getElementById('subtotalLine').textContent = '$'+subtotalUsd.toFixed(2);
  document.getElementById('grandUsd').textContent = '$'+totalUsd.toFixed(2);
  document.getElementById('grandKhr').textContent = '≈ '+Math.round(totalUsd*rate).toLocaleString('en-US')+' ៛';
  document.getElementById('balanceDue').textContent = '$'+balance.toFixed(2);
  document.getElementById('balanceDueKhr').textContent = '≈ '+Math.round(balance*rate).toLocaleString('en-US')+' ៛';
  document.getElementById('totalPaidDisplay').textContent = '$'+deposit.toFixed(2);

  // ប្រសិនបើមិនបញ្ចុះតម្លៃទេ (Discount = 0) មិនបាច់បង្ហាញ Grand Total / Paid / Due / Total Paid ទេ — បង្ហាញតែ Sub Total
  const showExtra = discVal > 0;
  ['grandTotalRow','paidRow','totalDueRow','totalPaidRow'].forEach(rowId=>{
    const el = document.getElementById(rowId);
    if(el) el.style.display = showExtra ? 'table-row' : 'none';
  });
  const totalsTableEl = document.getElementById('invTotalsTable');
  if(totalsTableEl) totalsTableEl.classList.toggle('inv-totals-boxed', showExtra);

  const rateLine = document.getElementById('rateDisplayLine');
  if(rateLine) rateLine.textContent = '1$ = '+Math.round(rate).toLocaleString('en-US')+' ៛';
}

async function loadDiscountPref(){
  try{
    const r = await LocalStore.get('discount-pref');
    if(r && r.value){
      const d = JSON.parse(r.value);
      document.getElementById('discountValue').value = d.value || 0;
      document.getElementById('discountType').value = d.type || 'percent';
    }
  }catch(e){}
}
async function peekInvoiceNo(){
  let counter = 1000;
  try{
    const r = await LocalStore.get('invoice-counter');
    if(r && r.value) counter = parseInt(r.value) || 1000;
  }catch(e){}
  return counter + 1;
}
async function getNextInvoiceNo(){
  let counter = 1000;
  try{
    const r = await LocalStore.get('invoice-counter');
    if(r && r.value) counter = parseInt(r.value) || 1000;
  }catch(e){}
  const next = counter + 1;
  try{ await LocalStore.set('invoice-counter', String(next)); }catch(e){}
  return next;
}
let loadedInvoiceId = null;
let invoiceIndex = [];

function invoiceRecordToIndexEntry(id, record){
  const subtotal = (record.rows||[]).reduce((s,x)=>s+(x.qty||0)*(x.price||0),0);
  const discVal = parseFloat(record.discountValue)||0;
  const discType = record.discountType || 'percent';
  const discAmt = discType==='percent' ? subtotal*(discVal/100) : discVal;
  const total = Math.max(0, subtotal-discAmt);
  const deposit = parseFloat(record.depositValue)||0;
  const balance = Math.max(0, total-deposit);
  let status = 'unpaid';
  if(deposit>0 && balance<=0.004) status='paid'; else if(deposit>0) status='partial';
  return { id, fullName: record.fullName, date: record.date, total,
           invoiceNo: record.invoiceNo, doctorName: record.doctorName, deposit, balance, status };
}
async function loadInvoiceIndex(){
  try{
    const { collection, getDocs, query, orderBy } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
    const db = await getFbDb();
    const q = query(collection(db, "invoices"), orderBy("savedAt", "desc"));
    const snap = await getDocs(q);
    invoiceIndex = snap.docs.map(d => invoiceRecordToIndexEntry(d.id, d.data()));
  }catch(e){ console.error('មិនអាចទាញយកប្រវត្តិវិក្កយបត្របានទេ:', e); invoiceIndex = []; }
}
async function saveInvoiceAndPrint() {
  const surname = document.getElementById('surname').value.trim();
  const givenName = document.getElementById('givenName').value.trim();
  const fullName = (surname + ' ' + givenName).trim();
  const wasEditingExisting = !!loadedInvoiceId; // ចាប់ទុកមុននឹងកំណត់ id ថ្មី៖ តើនេះជាការកែសម្រួលវិក្កយបត្រចាស់ ឬបង្កើតថ្មី?

  if (fullName && rows.length > 0) {
    if (!loadedInvoiceId && !document.getElementById('invoiceNo').value.trim()) {
      const no = await getNextInvoiceNo();
      document.getElementById('invoiceNo').value = no;
    }

    const totalUsd = (function () {
      const subtotal = rows.reduce((s, r) => s + (r.qty || 0) * (r.price || 0), 0);
      const discVal = parseFloat(document.getElementById('discountValue').value) || 0;
      const discType = document.getElementById('discountType').value;
      const disc = discType === 'percent' ? subtotal * (discVal / 100) : discVal;
      return Math.max(0, subtotal - disc);
    })();

    const id = loadedInvoiceId || ('inv_' + Date.now());
    const record = {
      id, surname, givenName, fullName,
      invoiceNo: document.getElementById('invoiceNo').value,
      cashierName: document.getElementById('cashierName').value,
      gender: document.getElementById('gender').value,
      age: document.getElementById('age').value,
      patientPhone: document.getElementById('patientPhone').value,
      doctorName: document.getElementById('doctorName').value,
      date: document.getElementById('invDate').value,
      rows: JSON.parse(JSON.stringify(rows)),
      discountValue: document.getElementById('discountValue').value,
      discountType: document.getElementById('discountType').value,
      depositValue: document.getElementById('depositValue').value,
      depositCurrency: document.getElementById('depositCurrency').value,
      notes: document.getElementById('invoiceNotes').value,
      total: totalUsd,
      savedAt: new Date().toISOString()
    };

    // រក្សាទុកទៅ Firebase (source of truth តែមួយ)
    await saveToFirebase(id, record);

    loadedInvoiceId = id;
    invoiceIndex = invoiceIndex.filter(r => r.id !== id);
    invoiceIndex.unshift(invoiceRecordToIndexEntry(id, record));
    applyHistoryFilters();
    showToast(wasEditingExisting ? 'វិក្កយបត្របានធ្វើបច្ចុប្បន្នភាពរួចរាល់' : 'វិក្កយបត្របានរក្សាទុករួចរាល់', 'success');
    // សម្អាតទម្រង់ដោយស្វ័យប្រវត្តិ តែសម្រាប់វិក្កយបត្រថ្មីប៉ុណ្ណោះ។
    // ប្រសិនបើកំពុងកែសម្រួលវិក្កយបត្រចាស់ ត្រូវទុកឲ្យវានៅដដែលក្រោយពេលបោះពុម្ព
    // ដើម្បីកុំឲ្យ save លើកក្រោយបង្កើតកំណត់ត្រាថ្មីស្ទួន (multi loop ជាន់គ្នា)។
    autoClearAfterPrint = !wasEditingExisting;
  }
  fillPrintLetterhead();
  window.print();
}
function fillPrintLetterhead(){
  const setText = (id, val)=>{ const el = document.getElementById(id); if(el) el.textContent = val || ''; };
  const surname = document.getElementById('surname').value.trim();
  const givenName = document.getElementById('givenName').value.trim();
  setText('invPrintNo', document.getElementById('invoiceNo').value);
  const dateVal = document.getElementById('invDate').value;
  let dateLabel = dateVal;
  if(dateVal){
    const d = new Date(dateVal+'T00:00:00');
    if(!isNaN(d)) dateLabel = d.toLocaleDateString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric'});
  }
  setText('invPrintDate', dateLabel);
  setText('invPrintCashier', document.getElementById('cashierName').value);
  setText('invPrintDoctor', document.getElementById('doctorName').value);
  setText('invPrintPatientName', (surname + ' ' + givenName).trim());
  setText('invPrintGender', document.getElementById('gender').value);
  setText('invPrintAge', document.getElementById('age').value);
  setText('invPrintPatientPhone', document.getElementById('patientPhone').value);
}
let autoClearAfterPrint = false;
window.addEventListener('afterprint', ()=>{
  if(autoClearAfterPrint){
    autoClearAfterPrint = false;
    clearAllSilent();
    showToast('ទម្រង់វិក្កយបត្រត្រូវបានសម្អាត ត្រៀមសម្រាប់ភ្ញៀវបន្ទាប់', 'info');
  }
});
let historyFilter = 'all';
function applyHistoryFilters(){
  const q = document.getElementById('historySearch').value.trim().toLowerCase();
  let list = invoiceIndex;
  if(q) list = list.filter(r=>r.fullName.toLowerCase().includes(q));
  if(historyFilter !== 'all') list = list.filter(r=>r.status===historyFilter);
  renderHistoryList(list.slice(0,50), list.length);
}
function setHistoryFilter(f){
  historyFilter = f;
  document.querySelectorAll('.filter-pill').forEach(b=>b.classList.toggle('active', b.dataset.filter===f));
  applyHistoryFilters();
}
// លុប invoice មួយ ចេញពី Firebase តាម id
async function deleteInvoiceRecordFromFirebase(id) {
  const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
  const db = await getFbDb();
  await deleteDoc(doc(db, "invoices", id));
}
async function deleteInvoice(id){
  const rec = invoiceIndex.find(r=>r.id===id);
  const name = rec ? rec.fullName : '';
  const ok = await showConfirm('លុបវិក្កយបត្រ'+(name?(' របស់ "'+name+'"'):'')+' ចេញពីប្រវត្តិ? សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។', {icon:'🗑️', okLabel:'លុប'});
  if(!ok) return;
  try{
    await deleteInvoiceRecordFromFirebase(id);
    invoiceIndex = invoiceIndex.filter(r=>r.id!==id);
    applyHistoryFilters();
    showToast('បានលុបវិក្កយបត្ររួចរាល់', 'success');
  }catch(e){
    showToast('មិនអាចលុបវិក្កយបត្របានទេ', 'error');
  }
}
function statusBadge(status){
  if(status==='paid') return '<span class="status-badge status-paid">✅ បង់គ្រប់</span>';
  if(status==='partial') return '<span class="status-badge status-partial">🟡 បង់ខ្លះ</span>';
  if(status==='unpaid') return '<span class="status-badge status-unpaid">🔴 មិនទាន់បង់</span>';
  return '<span class="status-badge status-unknown">—</span>';
}
function renderHistoryList(list, totalCount){
  const el = document.getElementById('historyList');
  const countEl = document.getElementById('historyCount');
  if(countEl) countEl.textContent = (totalCount!=null ? totalCount : (list?list.length:0)) + ' វិក្កយបត្រ';
  if(!list || list.length===0){
    el.innerHTML = '<div class="history-empty">មិនទាន់មានប្រវត្តិត្រូវនឹងលក្ខខណ្ឌនេះទេ</div>';
    return;
  }
  el.innerHTML = list.map(r=>{
    const initial = esc((r.fullName||'?').trim().charAt(0).toUpperCase() || '?');
    const inv = r.invoiceNo ? '#'+esc(String(r.invoiceNo))+' · ' : '';
    return `
    <div class="history-item">
      <div class="history-item-left">
        <div class="history-avatar">${initial}</div>
        <div class="history-item-info">
          <div class="hi-name">${esc(r.fullName)}</div>
          <div class="hi-meta">${inv}${esc(r.date||'')} · $${Number(r.total).toFixed(2)}</div>
        </div>
      </div>
      <div class="history-item-right">
        ${statusBadge(r.status)}
        <button class="history-load-btn" onclick="openHistoryDetail('${r.id}')">បើកមើល</button>
        <button class="history-del-btn" onclick="deleteInvoice('${r.id}')" title="លុប">🗑️</button>
      </div>
    </div>`;
  }).join('');
}
async function openHistoryDetail(id){
  try{
    const rec = await fetchInvoiceRecord(id);
    if(!rec){ showToast('រកមិនឃើញវិក្កយបត្រនេះទេ', 'error'); return; }
    const subtotal = (rec.rows||[]).reduce((s,x)=>s+(x.qty||0)*(x.price||0),0);
    const discVal = parseFloat(rec.discountValue)||0;
    const discType = rec.discountType || 'percent';
    const discAmt = discType==='percent' ? subtotal*(discVal/100) : discVal;
    const total = Math.max(0, subtotal-discAmt);
    const deposit = parseFloat(rec.depositValue)||0;
    const balance = Math.max(0, total-deposit);
    let status = 'unpaid';
    if(deposit>0 && balance<=0.004) status='paid'; else if(deposit>0) status='partial';

    const itemsHtml = (rec.rows||[]).length===0
      ? '<tr><td colspan="4" class="empty-row">មិនមានធាតុ</td></tr>'
      : rec.rows.map(x=>`<tr>
          <td>${esc(String(x.tooth||'—'))}</td>
          <td>${esc(x.treatment||'')}</td>
          <td class="num">${x.qty||0}</td>
          <td class="num">${(x.price||0)===0?'Free':'$'+Number((x.qty||0)*(x.price||0)).toFixed(2)}</td>
        </tr>`).join('');

    const html = `
      <div class="modal-header">
        <div>
          <h3>${esc(rec.fullName)} ${statusBadge(status)}</h3>
          <div class="modal-subtitle">Invoice #${esc(String(rec.invoiceNo||'—'))} · ${esc(rec.date||'')}</div>
        </div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-grid">
          <div><label>គ្រូពេទ្យ</label><span>${esc(rec.doctorName||'—')}</span></div>
          <div><label>អ្នកគិតលុយ</label><span>${esc(rec.cashierName||'—')}</span></div>
          <div><label>ភេទ / អាយុ</label><span>${esc(rec.gender||'—')} / ${esc(String(rec.age||'—'))}</span></div>
          <div><label>លេខទូរស័ព្ទ</label><span>${esc(rec.patientPhone||'—')}</span></div>
        </div>
        <table class="items detail-items">
          <thead><tr><th>Tooth#</th><th>Treatment</th><th class="num">Qty</th><th class="num">Subtotal</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div class="detail-totals">
          <div><span>Subtotal</span><b>$${subtotal.toFixed(2)}</b></div>
          <div><span>បញ្ចុះតម្លៃ</span><b>-$${discAmt.toFixed(2)}</b></div>
          <div class="detail-total-grand"><span>សរុប / Total</span><b>$${total.toFixed(2)}</b></div>
          <div><span>ប្រាក់កក់</span><b>$${deposit.toFixed(2)}</b></div>
          <div class="detail-balance"><span>នៅសល់ត្រូវបង់</span><b>$${balance.toFixed(2)}</b></div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">បិទ</button>
        <button class="btn btn-danger" onclick="closeModal(); deleteInvoice('${id}');">🗑️ លុប</button>
        <button class="btn btn-primary" onclick="closeModal(); loadInvoiceById('${id}');">✏️ ផ្ទុកទៅកែសម្រួល/បោះពុម្ព</button>
      </div>`;
    openModal(html, 'detail-modal');
  }catch(e){ showToast('មានបញ្ហាក្នុងការបើកមើលវិក្កយបត្រ', 'error'); }
}
async function loadInvoiceById(id){
  try{
    const rec = await fetchInvoiceRecord(id);
    if(!rec) return;
    document.getElementById('surname').value = rec.surname || '';
    document.getElementById('givenName').value = rec.givenName || '';
    document.getElementById('invoiceNo').value = rec.invoiceNo || '';
    document.getElementById('cashierName').value = rec.cashierName || '';
    document.getElementById('gender').value = rec.gender || '';
    document.getElementById('age').value = rec.age || '';
    document.getElementById('patientPhone').value = rec.patientPhone || '';
    document.getElementById('doctorName').value = rec.doctorName || '';
    document.getElementById('invDate').value = rec.date || '';
    document.getElementById('discountValue').value = rec.discountValue || 0;
    document.getElementById('discountType').value = rec.discountType || 'percent';
    document.getElementById('depositValue').value = rec.depositValue || 0;
    document.getElementById('depositCurrency').value = rec.depositCurrency || 'usd';
    document.getElementById('invoiceNotes').value = rec.notes || '';
    rows = rec.rows || [];
    pendingToothIndices = [];
    loadedInvoiceId = rec.id;
    await loadToothChartForPatient();
    renderRows();
    updatePendingLabel();
    switchView('invoice');
    showToast('បានផ្ទុកវិក្កយបត្ររបស់ '+rec.fullName, 'success');
  }catch(e){ showToast('មិនអាចផ្ទុកវិក្កយបត្រនេះបានទេ', 'error'); }
}

async function clearAll(){
  const ok = await showConfirm('សម្អាតទិន្នន័យទាំងអស់ក្នុងវិក្កយបត្រនេះ?', {icon:'🗑️', okLabel:'សម្អាត'});
  if(!ok) return;
  clearAllSilent();
  showToast('សម្អាតទិន្នន័យរួចរាល់', 'success');
}

/* ---------- prescription ---------- */
let rxMedications = []; // draft list: {name, dosage, qty}
let presetMedications = []; // {id, name, dosage}

async function loadPresetMedications(){
  try{
    const r = await LocalStore.get('preset-medications');
    if(r && r.value) presetMedications = JSON.parse(r.value);
  }catch(e){ presetMedications = []; }
  renderMedOptions();
  renderMedManageList();
}
async function savePresetMedications(){
  try{ await LocalStore.set('preset-medications', JSON.stringify(presetMedications)); }catch(e){}
}
function renderMedOptions(){
  const dl = document.getElementById('rxMedOptions');
  if(dl) dl.innerHTML = presetMedications.map(m=>`<option value="${esc(m.name)}"></option>`).join('');
}
function renderMedManageList(){
  const list = document.getElementById('medManageList');
  if(!list) return;
  if(presetMedications.length===0){
    list.innerHTML = '<div style="font-size:11.5px;color:#a9b8b5;">មិនទាន់មានថ្នាំរក្សាទុកទេ</div>';
    return;
  }
  list.innerHTML = presetMedications.map(m=>`
    <div class="service-manage-item">
      <span>${esc(m.name)}${m.dosage ? (' — '+esc(m.dosage)) : ''}</span>
      <button class="del-btn" onclick="deletePresetMedication('${m.id}')">✕</button>
    </div>`).join('');
}
async function deletePresetMedication(id){
  const med = presetMedications.find(m=>m.id===id);
  const ok = await showConfirm('លុបថ្នាំ "'+(med?med.name:'')+'" ចេញពីបញ្ជី?', {icon:'🗑️', okLabel:'លុប'});
  if(!ok) return;
  presetMedications = presetMedications.filter(m=>m.id!==id);
  await savePresetMedications();
  renderMedOptions();
  renderMedManageList();
  showToast('បានលុបថ្នាំរួចរាល់', 'success');
}
async function addPresetMedicationDirect(){
  const nameEl = document.getElementById('newMedName');
  const dosageEl = document.getElementById('newMedDosage');
  const name = nameEl.value.trim();
  const dosage = dosageEl.value.trim();
  if(!name){ nameEl.focus(); return; }
  if(presetMedications.some(m=>m.name===name)){
    showToast('ថ្នាំនេះមានរួចហើយ', 'error');
    return;
  }
  presetMedications.push({id:'m'+Date.now(), name, dosage});
  await savePresetMedications();
  renderMedOptions();
  renderMedManageList();
  nameEl.value=''; dosageEl.value='';
  nameEl.focus();
  showToast('បានបន្ថែមថ្នាំរួចរាល់', 'success');
}
function onRxMedNameChange(){
  const name = document.getElementById('rxMedName').value.trim();
  const match = presetMedications.find(m=>m.name===name);
  if(match && match.dosage){
    document.getElementById('rxMedDosage').value = match.dosage;
  }
}

function rxKey(){
  const key = patientKey();
  if(!key) return null;
  return key.replace('dental-chart:', 'rx:');
}
function rxDraftKey(){
  const key = rxKey();
  return key ? key + ':draft' : null;
}
async function saveRxDraft(){
  const key = rxDraftKey();
  if(!key) return;
  try{ await LocalStore.set(key, JSON.stringify(rxMedications)); }catch(e){}
}
async function loadRxDraft(){
  const key = rxDraftKey();
  if(!key){ rxMedications = []; renderRxMedTable(); return; }
  try{
    const r = await LocalStore.get(key);
    rxMedications = (r && r.value) ? JSON.parse(r.value) : [];
  }catch(e){ rxMedications = []; }
  renderRxMedTable();
}
async function clearRxDraft(){
  const key = rxDraftKey();
  if(!key) return;
  try{ await LocalStore.set(key, JSON.stringify([])); }catch(e){}
}
function refreshPrescriptionView(){
  const surname = document.getElementById('surname').value.trim();
  const givenName = document.getElementById('givenName').value.trim();
  const fullName = (surname + ' ' + givenName).trim();
  const gender = document.getElementById('gender').value;
  const age = document.getElementById('age').value;
  const phone = document.getElementById('patientPhone').value.trim();
  const doctor = document.getElementById('doctorName').value.trim();

  document.getElementById('rxPatientName').textContent = fullName || '—';
  document.getElementById('rxPatientGenderAge').textContent = (gender || '—') + ' / ' + (age || '—');
  document.getElementById('rxPatientPhone').textContent = phone || '—';
  document.getElementById('rxPatientDoctor').textContent = doctor || '—';

  const hint = document.getElementById('rxNoPatientHint');
  const saveBtn = document.getElementById('rxSaveBtn');
  const printBtn = document.getElementById('rxPrintBtn');
  if(fullName){
    hint.style.display = 'none';
    saveBtn.disabled = false;
    printBtn.disabled = false;
  }else{
    hint.style.display = 'block';
    saveBtn.disabled = true;
    printBtn.disabled = true;
  }
  loadRxDraft();
  loadRxHistory();
}
function renderRxMedTable(){
  const tbody = document.getElementById('rxMedList');
  if(rxMedications.length===0){
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">មិនទាន់មានថ្នាំបញ្ចូលនៅឡើយទេ</td></tr>';
    return;
  }
  tbody.innerHTML = rxMedications.map((m,idx)=>`
    <tr>
      <td>${idx+1}</td>
      <td>${esc(m.name)}</td>
      <td>${esc(m.dosage)}</td>
      <td class="text-center">${esc(String(m.qty))}</td>
      <td><button class="del-btn" onclick="removeMedication(${idx})">✕</button></td>
    </tr>`).join('');
}
function addMedication(){
  const nameEl = document.getElementById('rxMedName');
  const dosageEl = document.getElementById('rxMedDosage');
  const qtyEl = document.getElementById('rxMedQty');
  const name = nameEl.value.trim();
  const dosage = dosageEl.value.trim();
  const qty = parseInt(qtyEl.value) || 1;
  if(!name){ nameEl.focus(); showToast('សូមបញ្ចូលឈ្មោះថ្នាំ', 'error'); return; }
  rxMedications.push({name, dosage, qty});
  renderRxMedTable();
  saveRxDraft();

  const exists = presetMedications.some(m=>m.name===name);
  if(!exists){
    presetMedications.push({id:'m'+Date.now(), name, dosage});
    savePresetMedications();
    renderMedOptions();
    renderMedManageList();
  }

  nameEl.value=''; dosageEl.value=''; qtyEl.value=1;
  nameEl.focus();
}
function removeMedication(idx){
  rxMedications.splice(idx,1);
  renderRxMedTable();
  saveRxDraft();
}
async function loadRxHistory(){
  const key = rxKey();
  const list = document.getElementById('rxHistoryList');
  if(!key){
    list.innerHTML = '<p class="text-muted text-center">សូមបញ្ចូលឈ្មោះអ្នកជំងឺនៅផ្ទាំង "វិក្កយបត្រ" សិន</p>';
    return;
  }
  let entries = [];
  try{
    const r = await LocalStore.get(key);
    if(r && r.value) entries = JSON.parse(r.value);
  }catch(e){ entries = []; }
  if(entries.length===0){
    list.innerHTML = '<p class="text-muted text-center">មិនទាន់មានប្រវត្តិវេជ្ជបញ្ជាទេ</p>';
    return;
  }
  list.innerHTML = entries.slice().reverse().map(e=>{
    const meds = (e.items||[]).map(m=>
      `<div class="presc-history-med">💊 ${esc(m.name)} ${m.dosage?('— '+esc(m.dosage)):''} ${m.qty?('(x'+esc(String(m.qty))+')'):''}</div>`
    ).join('');
    return `<div class="presc-history-item">
      <div class="presc-history-date">${esc(e.date)}</div>
      ${meds || '<div class="presc-history-med text-muted">—</div>'}
    </div>`;
  }).join('');
}
async function persistPrescription(){
  const key = rxKey();
  if(!key || rxMedications.length===0) return false;
  let entries = [];
  try{
    const r = await LocalStore.get(key);
    if(r && r.value) entries = JSON.parse(r.value);
  }catch(e){ entries = []; }
  entries.push({
    date: new Date().toLocaleString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}),
    items: JSON.parse(JSON.stringify(rxMedications))
  });
  try{ await LocalStore.set(key, JSON.stringify(entries)); }catch(e){}
  return true;
}
async function savePrescription(){
  const key = rxKey();
  if(!key){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺនៅផ្ទាំង "វិក្កយបត្រ" សិន', 'error');
    return;
  }
  if(rxMedications.length===0){
    showToast('សូមបញ្ចូលថ្នាំយ៉ាងហោចណាស់មួយមុនរក្សាទុក', 'error');
    return;
  }
  const ok = await persistPrescription();
  if(ok){
    rxMedications = [];
    renderRxMedTable();
    await clearRxDraft();
    loadRxHistory();
    showToast('វេជ្ជបញ្ជាបានរក្សាទុករួចរាល់', 'success');
  }
}
async function savePrescriptionAndPrint(){
  const key = rxKey();
  if(!key){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺនៅផ្ទាំង "វិក្កយបត្រ" សិន', 'error');
    return;
  }
  if(rxMedications.length===0){
    showToast('សូមបញ្ចូលថ្នាំយ៉ាងហោចណាស់មួយមុនបោះពុម្ព', 'error');
    return;
  }
  await persistPrescription();
  loadRxHistory();
  const dateEl = document.getElementById('rxPrintDate');
  if(dateEl) dateEl.textContent = new Date().toLocaleString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
  document.body.classList.add('print-rx');
  autoClearRxAfterPrint = true;
  window.print();
}
let autoClearRxAfterPrint = false;
window.addEventListener('afterprint', ()=>{
  if(document.body.classList.contains('print-rx')){
    document.body.classList.remove('print-rx');
  }
  if(autoClearRxAfterPrint){
    autoClearRxAfterPrint = false;
    rxMedications = [];
    renderRxMedTable();
    clearRxDraft();
    showToast('វេជ្ជបញ្ជាបានបោះពុម្ព ត្រៀមសម្រាប់ថ្នាំបន្ទាប់', 'info');
  }
});

(async function init(){
  document.getElementById('invDate').value = new Date().toISOString().slice(0,10);
  await loadSettings();
  await loadDiscountPref();
  await loadPresetServices();
  await loadInvoiceIndex();
  document.getElementById('invoiceNo').value = await peekInvoiceNo();
  applyHistoryFilters();
  renderTeeth();
  renderRows();
})();