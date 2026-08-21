/* ================================================================
   MJM NURSERY — PLOT CONDITION AUDIT
   script.js — Supabase connected
================================================================ */
'use strict';

const NURSERY_PLOTS = {
  PN:   Array.from({length:52}, (_,i)=>'P'+String(i+1).padStart(2,'0')),
  BNN:  Array.from({length:14}, (_,i)=>'B'+String(i+1).padStart(2,'0')),
  UNN1: Array.from({length:18}, (_,i)=>'U'+String(i+1).padStart(2,'0')),
  UNN2: Array.from({length:20}, (_,i)=>'N'+String(i+1).padStart(2,'0'))
};
const NURSERY_LABELS = {PN:'PN',BNN:'BNN',UNN1:'UNN 1',UNN2:'UNN 2'};
const WARNA_BG  = {'1':'#1e3d0f','2':'#2d6a1f','3':'#5a8a2a','4':'#b5a800','5':'#d4c200'};
const WARNA_LBL = {'1':'Very Green','2':'Green','3':'Light Green','4':'Yellowish','5':'Very Yellow'};

let records=[], activeTab='PN', activeView='list';
let editMode=false, editId=null, detailId=null, deleteTarget=null;
let formState={nursery:'PN',ulat:null,tikus:null,bintik:null,warna:null,photo1:null,photo2:null};
let toastTimer=null;

function pad(n){return String(n).padStart(3,'0');}
function todayISO(){return new Date().toISOString().split('T')[0];}
function fmtDate(iso){
  if(!iso)return'—';
  const s=iso.split('T')[0].split('-');
  return s[2]+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+s[1]-1]+' '+s[0];
}
function fmtDT(iso){
  if(!iso)return'—';
  return new Date(iso).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
}
function nextID(nursery){return 'AUD-'+nursery+'-'+pad(records.filter(r=>r.nursery===nursery).length+1);}
function chipClass(v){return v==='Banyak'?'mc-b':v==='Sedikit'?'mc-s':'mc-t';}

function showToast(msg, ms){ window._pageShowToast=showToast;
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),ms || 2600);
}
function setLoading(on){
  const o=document.getElementById('loading-overlay');
  if(o)on?o.classList.remove('hidden'):o.classList.add('hidden');
}
function setView(v){
  activeView=v;
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  const el=document.getElementById('view-'+v);if(el)el.classList.add('active');
  const fab=document.getElementById('fab');if(fab)fab.classList.toggle('hidden',v!=='list');
  window.scrollTo(0,0);
}
function selectTab(nursery){
  activeTab=nursery;
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.toggle('active',t.dataset.n===nursery));
  document.getElementById('topbar-nursery').textContent=NURSERY_LABELS[nursery];
  renderList();
  setView('list');
}

/* --- LOAD --- */
async function loadRecords(){
  setLoading(true);
  try{
    const rows=await sb.select('audit_plot_audits','select=*');
    records=rows.map(r=>({
      uid:String(r.id),id:r.audit_id,nursery:r.nursery,plot:r.plot,
      batch:r.batch,ulat:r.pest,tikus:r.tikus,bintik:r.disease,
      warna:r.warna_daun,photo:r.photo_url,photo2:r.photo_2_url||null,
      date:r.date,createdAt:r.created_at
    }));
    renderList();
  }catch(e){showToast(t('err_load'));console.error(e);}
  setLoading(false);
}

/* --- RENDER LIST --- */
function renderList(){
  const recs=records.filter(r=>r.nursery===activeTab);
  document.getElementById('list-count').textContent=recs.length+' record'+(recs.length!==1?'s':'');
  document.getElementById('list-heading').textContent=t('plot_title')+' — '+NURSERY_LABELS[activeTab];
  document.querySelectorAll('.tab-item').forEach(t=>{
    const cnt=records.filter(r=>r.nursery===t.dataset.n).length;
    let b=t.querySelector('.tab-badge');
    if(cnt>0){if(!b){b=document.createElement('span');b.className='tab-badge';t.appendChild(b);}b.textContent=cnt;}
    else if(b)b.remove();
  });
  const el=document.getElementById('records-list');
  if(!recs.length){
    el.innerHTML='<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg></div><h3>No audits yet</h3><p>Tap <strong>+</strong> to add the first audit for '+NURSERY_LABELS[activeTab]+'.</p></div>';
    return;
  }
  el.innerHTML=recs.map(r=>`
    <div class="record-item" onclick="openDetail('${r.uid}')">
      ${r.photo
        ?`<img class="record-thumb" src="${r.photo}" alt="plot" onclick="event.stopPropagation();openLightbox('${r.photo}')"/>`
        :`<div class="record-thumb-placeholder"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg></div>`}
      <div class="record-info">
        <div class="record-plot">${r.plot}</div>
        <div class="record-meta">${r.id} · ${fmtDT(r.createdAt)}</div>
        <div class="record-chips">
          <span class="mini-chip ${chipClass(r.ulat)}">Pest:${r.ulat}</span>
          <span class="mini-chip ${chipClass(r.tikus)}">Animal:${r.tikus}</span>
          <span class="mini-chip ${chipClass(r.bintik)}">Disease:${r.bintik}</span>
          <span class="mc-w mini-chip" style="background:${WARNA_BG[r.warna]||'#888'}">Leaf ${r.warna}</span>
        </div>
      </div>
      <div class="record-actions" onclick="event.stopPropagation()">
        <button class="icon-btn edit-btn" onclick="openEdit('${r.uid}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        ${isAuditAdmin()?`<button class="icon-btn del-btn"  onclick="confirmDelete('${r.uid}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>`:''}
      </div>
    </div>`).join('');
}

/* --- FORM --- */
function openAddForm(){
  editMode=false;editId=null;
  formState={nursery:activeTab,ulat:null,tikus:null,bintik:null,warna:null,photo1:null,photo2:null};
  populateForm();setView('form');
  document.getElementById('form-view-title').textContent=t('new_audit')+' — '+NURSERY_LABELS[activeTab];
}
function openEdit(uid){
  const r=records.find(x=>x.uid===uid);if(!r)return;
  editMode=true;editId=uid;
  formState={nursery:r.nursery,ulat:r.ulat,tikus:r.tikus,bintik:r.bintik,warna:r.warna,photo1:r.photo||null,photo2:r.photo2||null};
  populateForm(r);setView('form');
  document.getElementById('form-view-title').textContent='Edit — '+r.id;
}
function populateForm(r){
  const id=editMode?r.id:nextID(formState.nursery);
  document.getElementById('f-id').value=id;
  document.getElementById('f-date').value=editMode?r.date:todayISO();
  document.getElementById('form-view-id').textContent=id;
  const ps=document.getElementById('f-plot');
  ps.innerHTML='<option value="">'+t('select_plot')+'</option>';
  NURSERY_PLOTS[formState.nursery].forEach(p=>{
    const o=document.createElement('option');o.value=p;o.textContent=p;
    if(r&&r.plot===p)o.selected=true;ps.appendChild(o);
  });
  document.getElementById('f-batch').value=r?r.batch||'':'';
  const TRI={'Banyak':'sel-b','Sedikit':'sel-s','Tidak Ada':'sel-t'};
  ['ulat','tikus','bintik'].forEach(f=>{
    const grp=document.getElementById('f-'+f+'-grp');
    grp.querySelectorAll('.tri-btn').forEach(b=>b.className='tri-btn');
    if(formState[f]){const btn=[...grp.querySelectorAll('.tri-btn')].find(b=>b.dataset.val===formState[f]);if(btn)btn.classList.add(TRI[formState[f]]);}
  });
  document.querySelectorAll('.warna-btn').forEach(b=>b.classList.toggle('active',b.dataset.v===formState.warna));
  renderPlotSlot(1,formState.photo1||null);
  renderPlotSlot(2,formState.photo2||null);
  const note=document.getElementById('photo-req-note');
  if(note){note.classList.remove('error');note.textContent=t('photo_req');}
}

const TRI_CLASS={'Banyak':'sel-b','Sedikit':'sel-s','Tidak Ada':'sel-t'};
function pickTri(field,val,el){
  document.getElementById('f-'+field+'-grp').querySelectorAll('.tri-btn').forEach(b=>b.className='tri-btn');
  el.classList.add(TRI_CLASS[val]);formState[field]=val;
}
function pickWarna(el){
  document.querySelectorAll('.warna-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');formState.warna=el.dataset.v;
}

/* --- PHOTO SLOTS --- */
function triggerPlotPhoto(n){
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  sheet.innerHTML=`<div style="background:#fff;border-radius:20px 20px 0 0;padding:20px 16px 36px;width:100%;max-width:480px">
    <div style="font-size:14px;font-weight:700;color:#182018;margin-bottom:16px;text-align:center">Photo ${n}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <button onclick="openCamera('plot-photo-camera-${n}');this.closest('[style*=fixed]').remove()" style="height:64px;border-radius:12px;background:#1a4d1a;color:#fff;font-size:15px;font-weight:600;border:none;font-family:inherit;cursor:pointer">📷<br><span style="font-size:11px">Camera</span></button>
      <button onclick="document.getElementById('plot-photo-gallery-${n}').click();this.closest('[style*=fixed]').remove()" style="height:64px;border-radius:12px;background:#f4f6f4;color:#3d5c3d;font-size:15px;font-weight:600;border:1px solid #dde8dd;font-family:inherit;cursor:pointer">🖼<br><span style="font-size:11px">Gallery</span></button>
    </div>
    <button onclick="this.closest('[style*=fixed]').remove()" style="width:100%;height:44px;border-radius:12px;background:#f4f6f4;border:1px solid #dde8dd;color:#6b8a6b;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer">Cancel</button>
  </div>`;
  sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.remove();});
  document.body.appendChild(sheet);
}
async function handlePlotPhoto(n,input){
  if(!input.files||!input.files[0])return;
  const compressed=await compressPhoto(input.files[0]);
  formState['photo'+n]=compressed;
  renderPlotSlot(n,compressed);
  if(formState.photo1&&formState.photo2){
    const note=document.getElementById('photo-req-note');
    if(note){note.classList.remove('error');note.textContent=t('photo_req');}
  }
  input.value='';
}
function renderPlotSlot(n,src){
  const slot=document.getElementById('photo-slot-'+n);if(!slot)return;
  while(slot.firstChild)slot.removeChild(slot.firstChild);
  if(src){
    slot.classList.add('has-photo');
    const img=document.createElement('img');img.src=src;img.alt='Photo '+n;
    img.onclick=()=>openLightbox(src);slot.appendChild(img);
    const btn=document.createElement('button');btn.className='photo-slot-clear';btn.textContent='×';
    btn.onclick=e=>{e.stopPropagation();formState['photo'+n]=null;renderPlotSlot(n,null);};
    slot.appendChild(btn);
  }else{
    slot.classList.remove('has-photo');
    const num=document.createElement('div');num.className='photo-slot-num';num.textContent=n;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');
    svg.innerHTML='<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M9 5l1.5-2h3L15 5"/>';
    const lbl=document.createElement('span');lbl.className='photo-slot-label';lbl.textContent='Photo '+n;
    slot.appendChild(num);slot.appendChild(svg);slot.appendChild(lbl);
  }
}
function cancelForm(){setView('list');}

/* --- SAVE --- */
async function saveRecord(){
  const plot=document.getElementById('f-plot').value;
  const batch=document.getElementById('f-batch').value.trim();
  if(!plot)           {showToast(t('err_select_plot'));return;}
  if(!batch)          {showToast(t('err_batch'));return;}
  if(!formState.ulat) {showToast(t('err_pest'));return;}
  if(!formState.tikus){showToast(t('err_animal'));return;}
  if(!formState.bintik){showToast(t('err_disease'));return;}
  if(!formState.warna){showToast(t('err_leaf'));return;}
  if(!formState.photo1||!formState.photo2){
    const note=document.getElementById('photo-req-note');
    if(note){note.classList.add('error');note.textContent=t('photo_both_req');}
    showToast(t('photo_both_req'));return;
  }
  setLoading(true);
  try{
    const payload={
      nursery:formState.nursery,plot,batch,
      pest:formState.ulat,tikus:formState.tikus,disease:formState.bintik,
      warna_daun:formState.warna,
      photo_url:formState.photo1||null,
      photo_2_url:formState.photo2||null,
      date:todayISO(),
      auditor_name:(JSON.parse(localStorage.getItem('mjm_user')||'{}').name||'')
    };
    const result=await smartSave('audit_plot_audits',editMode?'update':'insert',
      editMode?payload:{...payload,audit_id:nextID(formState.nursery)},
      editMode?editId:null);
    setLoading(false);
    showToast(result?.offline?t('offline_saved'):editMode?t('record_updated'):t('record_saved'));
    if(!result?.offline){await loadRecords();}
    setView('list');
  }catch(e){
    setLoading(false);
    console.error('[Save]',e);
    showToast('⚠ '+(e.message||t('err_save')));
  }
}

/* --- DETAIL --- */
function openDetail(uid){
  const r=records.find(x=>x.uid===uid);if(!r)return;
  detailId=uid;
  const heroImg=document.getElementById('detail-hero-img');
  const heroPh=document.getElementById('detail-hero-placeholder');
  if(r.photo){heroImg.src=r.photo;heroImg.style.display='block';heroPh.style.display='none';}
  else{heroImg.style.display='none';heroPh.style.display='flex';}
  document.getElementById('detail-nursery-tag').textContent=NURSERY_LABELS[r.nursery];
  document.getElementById('detail-id').textContent=r.id;
  document.getElementById('detail-date').textContent=fmtDate(r.date);
  document.getElementById('detail-plot').textContent=r.plot;
  document.getElementById('detail-batch').textContent=r.batch?'Batch: '+r.batch:'';
  [['detail-ulat-val','ulat'],['detail-tikus-val','tikus'],['detail-bintik-val','bintik']].forEach(([elId,field])=>{
    const el=document.getElementById(elId);
    el.textContent=r[field]||'—';
    el.className='detail-cell-val '+(r[field]==='Banyak'?'val-b':r[field]==='Sedikit'?'val-s':'val-t');
  });
  const wb=document.getElementById('detail-warna-box');
  wb.style.background=WARNA_BG[r.warna]||'#888';
  document.getElementById('detail-warna-label').textContent=t('leaf_cond')+' — '+(WARNA_LBL[r.warna]||'—');
  document.getElementById('detail-warna-desc').textContent=t('ranking')+' '+r.warna+' '+t('of5');
  setView('detail');
}
function closeDetail(){setView('list');}
function editFromDetail(){if(detailId)openEdit(detailId);}

/* --- LIGHTBOX --- */
function openLightbox(src){
  const lb=document.getElementById('lightbox');
  document.getElementById('lightbox-img').src=src;
  lb.classList.add('open');
}
function closeLightbox(){document.getElementById('lightbox').classList.remove('open');}

/* --- DELETE --- */
function confirmDelete(uid){
  if(!isAuditAdmin()){showToast(t('err_delete_admin_only'));return;}
  deleteTarget=uid;document.getElementById('modal-overlay').classList.add('show');
}
function cancelDelete(){deleteTarget=null;document.getElementById('modal-overlay').classList.remove('show');}
async function doDelete(){
  if(!deleteTarget)return;
  /* Checked again here: the modal's Delete button is reachable on its own. */
  if(!isAuditAdmin()){
    deleteTarget=null;
    document.getElementById('modal-overlay').classList.remove('show');
    showToast(t('err_delete_admin_only'));return;
  }
  document.getElementById('modal-overlay').classList.remove('show');
  setLoading(true);
  try{
    await sb.delete('audit_plot_audits',deleteTarget);deleteTarget=null;
    await loadRecords();showToast(t('record_deleted'));
    if(activeView==='detail')setView('list');
  }catch(e){showToast(t('err_delete'));console.error(e);setLoading(false);}
}

/* --- INIT --- */
function init(){
  const d=document.getElementById('nav-today');if(d)d.textContent=fmtDate(todayISO());
  document.getElementById('fab').addEventListener('click',openAddForm);
  document.getElementById('modal-overlay').addEventListener('click',e=>{
    if(e.target===document.getElementById('modal-overlay'))cancelDelete();
  });
  document.getElementById('lightbox').addEventListener('click',e=>{
    if(e.target===document.getElementById('lightbox'))closeLightbox();
  });
  selectTab('PN');
  loadRecords();
}
document.addEventListener('DOMContentLoaded',init);