/* BUILD: 2026-08-18f */
/* ================================================================
   MJM NURSERY — SEEDLING HEIGHT SYSTEM
   height_script.js — Supabase connected
================================================================ */
'use strict';

const NURSERY_PLOTS = {
  PN:   Array.from({length:52}, (_,i)=>'P'+String(i+1).padStart(2,'0')),
  BNN:  Array.from({length:14}, (_,i)=>'B'+String(i+1).padStart(2,'0')),
  UNN1: Array.from({length:18}, (_,i)=>'U'+String(i+1).padStart(2,'0')),
  UNN2: Array.from({length:20}, (_,i)=>'N'+String(i+1).padStart(2,'0'))
};
const NURSERY_LABELS = {PN:'PN',BNN:'BNN',UNN1:'UNN 1',UNN2:'UNN 2'};

let records=[], activeTab='PN', activeView='list';
let editMode=false, editId=null, detailId=null, deleteTarget=null;
let formState={nursery:'PN',s1:'',s2:'',s3:'',p1:null,p2:null,p3:null};
let toastTimer=null;

/* --- HELPERS --- */
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
function calcAvg(s1,s2,s3){
  const v=[s1,s2,s3].map(x=>parseFloat(x)).filter(x=>!isNaN(x)&&x>0);
  return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):null;
}
function nextID(nursery){return 'HGT-'+nursery+'-'+pad(records.filter(r=>r.nursery===nursery).length+1);}

/* --- UI --- */
function showToast(msg, ms){ window._pageShowToast=showToast;
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
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

/* --- LOAD FROM SUPABASE --- */
async function loadRecords(){
  setLoading(true);
  try{
    const rows=await sb.select('audit_height_records','select=*');
    records=rows.map(r=>({
      uid:String(r.id), id:r.record_id, nursery:r.nursery, plot:r.plot, batch:r.batch,
      s1:r.sample_1!=null?String(r.sample_1):'',
      s2:r.sample_2!=null?String(r.sample_2):'',
      s3:r.sample_3!=null?String(r.sample_3):'',
      p1:r.photo_1_url||null, p2:r.photo_2_url||null, p3:r.photo_3_url||null,
      date:r.date, createdAt:r.created_at
    }));
    renderList();
  }catch(e){showToast(t('err_load'));console.error(e);}
  setLoading(false);
}

/* --- RENDER LIST --- */
function renderList(){
  const recs=records.filter(r=>r.nursery===activeTab);
  document.getElementById('list-count').textContent=recs.length+' '+(recs.length!==1?t('records'):t('record'));
  document.getElementById('list-heading').textContent=t('height_title')+' — '+NURSERY_LABELS[activeTab];

  // Stat 1: This month's audits
  const now=new Date();
  const thisMonth=recs.filter(r=>{
    if(!r.createdAt)return false;
    const d=new Date(r.createdAt);
    return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
  });
  document.getElementById('stat-total').textContent=thisMonth.length;

  // Stat 2 & 3: Plots with avg ≥ 150cm
  const plotsReached=recs.filter(r=>{
    const avg=parseFloat(calcAvg(r.s1,r.s2,r.s3));
    return !isNaN(avg)&&avg>=150;
  });
  document.getElementById('stat-avg').textContent=plotsReached.length;
  document.getElementById('stat-max').textContent=recs.length>0?Math.round((plotsReached.length/recs.length)*100)+'%':'—';

  // tab badges
  document.querySelectorAll('.tab-item').forEach(t=>{
    const cnt=records.filter(r=>r.nursery===t.dataset.n).length;
    let b=t.querySelector('.tab-badge');
    if(cnt>0){if(!b){b=document.createElement('span');b.className='tab-badge';t.appendChild(b);}b.textContent=cnt;}
    else if(b)b.remove();
  });

  const el=document.getElementById('records-list');
  if(!recs.length){
    el.innerHTML='<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div><h3>No height records yet</h3><p>Tap <strong>+</strong> to record seedling heights for '+NURSERY_LABELS[activeTab]+'.</p></div>';
    return;
  }
  el.innerHTML=recs.map(r=>{
    const avg=calcAvg(r.s1,r.s2,r.s3);
    const thumbs=[r.p1,r.p2,r.p3].map(p=>
      p?'<img src="'+p+'" alt="photo"/>':
      '<div class="thumb-ph"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg></div>'
    ).join('');
    return '<div class="record-item" onclick="openDetail(\''+r.uid+'\')">'+
      '<div class="record-thumb-stack">'+thumbs+'</div>'+
      '<div class="record-info">'+
        '<div class="record-plot">'+r.plot+(r.batch?' <span style="font-size:11px;color:var(--text3)">· '+r.batch+'</span>':'')+'</div>'+
        '<div class="record-meta">'+r.id+' · '+fmtDT(r.createdAt)+'</div>'+
        '<div class="record-heights">'+
          (r.s1?'<span class="height-pill">S1: '+r.s1+' cm</span>':'<span class="height-pill missing">S1: —</span>')+
          (r.s2?'<span class="height-pill">S2: '+r.s2+' cm</span>':'<span class="height-pill missing">S2: —</span>')+
          (r.s3?'<span class="height-pill">S3: '+r.s3+' cm</span>':'<span class="height-pill missing">S3: —</span>')+
          (avg?'<span class="avg-pill">Avg: '+avg+' cm</span>':'')+
        '</div>'+
      '</div>'+
      '<div class="record-actions" onclick="event.stopPropagation()">'+
        '<button class="icon-btn edit-btn" onclick="openEdit(\''+r.uid+'\')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'+
        (isAuditAdmin()?'<button class="icon-btn del-btn" onclick="confirmDelete(\''+r.uid+'\')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>':'')+
      '</div>'+
    '</div>';
  }).join('');
}

/* --- FORM --- */
function openAddForm(){
  editMode=false;editId=null;
  formState={nursery:activeTab,s1:'',s2:'',s3:'',p1:null,p2:null,p3:null};
  populateForm();setView('form');
  document.getElementById('form-view-title').textContent='New Record — '+NURSERY_LABELS[activeTab];
}
function openEdit(uid){
  const r=records.find(x=>x.uid===uid);if(!r)return;
  editMode=true;editId=uid;
  formState={nursery:r.nursery,s1:r.s1,s2:r.s2,s3:r.s3,p1:r.p1,p2:r.p2,p3:r.p3};
  populateForm(r);setView('form');
  document.getElementById('form-view-title').textContent=t('edit_lbl')+' — '+r.id;
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
  document.getElementById('f-s1').value=formState.s1||'';
  document.getElementById('f-s2').value=formState.s2||'';
  document.getElementById('f-s3').value=formState.s3||'';
  updateAvg();
  [1,2,3].forEach(n=>renderSlot(n,formState['p'+n]));
  const note=document.getElementById('photo-req-note');
  if(note){note.classList.remove('error');note.textContent=t('photo_3_req');}
}
function onHeightInput(n,el){
  formState['s'+n]=el.value.trim();updateAvg();
  const fb=document.getElementById('s'+n+'-fb');
  if(fb)fb.textContent=(el.value&&parseFloat(el.value)>0)?'✓':'';
}
function updateAvg(){
  const a=calcAvg(formState.s1,formState.s2,formState.s3);
  const el=document.getElementById('avg-display');if(el)el.textContent=a||'—';
}
function renderSlot(n,src){
  const slot=document.getElementById('photo-slot-'+n);if(!slot)return;
  while(slot.firstChild)slot.removeChild(slot.firstChild);
  if(src){
    slot.classList.add('has-photo');
    const img=document.createElement('img');img.src=src;img.alt='S'+n;slot.appendChild(img);
    const lbl=document.createElement('span');lbl.className='detail-photo-num';lbl.textContent=t('sample')+' '+n;slot.appendChild(lbl);
    const btn=document.createElement('button');btn.className='photo-slot-clear';btn.textContent='×';
    btn.onclick=e=>{e.stopPropagation();formState['p'+n]=null;renderSlot(n,null);};
    slot.appendChild(btn);
  }else{
    slot.classList.remove('has-photo');
    const num=document.createElement('div');num.className='photo-slot-num';num.textContent=n;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');
    svg.innerHTML='<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M9 5l1.5-2h3L15 5"/>';
    const lbl=document.createElement('span');lbl.className='photo-slot-label';lbl.textContent='Sample '+n;
    slot.appendChild(num);slot.appendChild(svg);slot.appendChild(lbl);
  }
}
function triggerPhoto(n){
  // Show camera/gallery choice
  const existing=document.getElementById('photo-choice-sheet');
  if(existing)existing.remove();
  const sheet=document.createElement('div');
  sheet.id='photo-choice-sheet';
  sheet.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  sheet.innerHTML=`<div style="background:#fff;border-radius:20px 20px 0 0;padding:20px 16px 36px;width:100%;max-width:480px">
    <div style="font-size:14px;font-weight:700;color:#182018;margin-bottom:16px;text-align:center">${t('sample')} ${n}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <button onclick="openCamera('photo-input-${n}');document.getElementById('photo-choice-sheet').remove()" style="height:64px;border-radius:12px;background:#1a4d1a;color:#fff;font-size:15px;font-weight:600;border:none;font-family:inherit;cursor:pointer">📷<br><span style="font-size:11px">${t('cam')}</span></button>
      <button onclick="document.getElementById('photo-gallery-${n}').click();document.getElementById('photo-choice-sheet').remove()" style="height:64px;border-radius:12px;background:#f4f6f4;color:#3d5c3d;font-size:15px;font-weight:600;border:1px solid #dde8dd;font-family:inherit;cursor:pointer">🖼<br><span style="font-size:11px">${t('gal')}</span></button>
    </div>
    <button onclick="document.getElementById('photo-choice-sheet').remove()" style="width:100%;height:44px;border-radius:12px;background:#f4f6f4;border:1px solid #dde8dd;color:#6b8a6b;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer">${t('cancel')}</button>
  </div>`;
  sheet.addEventListener('click', e=>{ if(e.target===sheet) sheet.remove(); });
  document.body.appendChild(sheet);
  // Add gallery inputs if not exist
  [1,2,3].forEach(i=>{
    if(!document.getElementById('photo-gallery-'+i)){
      const inp=document.createElement('input');
      inp.type='file';inp.id='photo-gallery-'+i;inp.accept='image/*';inp.style.display='none';
      const slot=i; // capture value not reference
      inp.onchange=function(){handlePhoto(slot,this);};
      document.body.appendChild(inp);
    }
  });
}
async function handlePhoto(n,input){
  if(!input.files||!input.files[0])return;
  const compressed=await compressPhoto(input.files[0]);
  formState['p'+n]=compressed;
  renderSlot(n,compressed);
  if(formState.p1&&formState.p2&&formState.p3){
    const note=document.getElementById('photo-req-note');
    if(note){note.classList.remove('error');note.textContent=t('photo_3_req');}
  }
  input.value='';
}
function cancelForm(){setView('list');}

/* --- SAVE --- */
async function saveRecord(){
  const plot=document.getElementById('f-plot').value;
  const batch=document.getElementById('f-batch').value.trim();
  if(!plot){showToast(t('err_select_plot'));return;}
  if(!formState.s1&&!formState.s2&&!formState.s3){showToast(t('err_height'));return;}
  if(!formState.p1||!formState.p2||!formState.p3){
    const note=document.getElementById('photo-req-note');
    if(note){note.classList.add('error');note.textContent='⚠ All 3 photos are required';}
    showToast(t('err_3_photos'));return;
  }
  setLoading(true);
  try{
    // Pass photos as base64 — smartSave handles upload (online) or queues (offline)
    const avg=calcAvg(formState.s1,formState.s2,formState.s3);
    const payload={
      nursery:formState.nursery,plot,batch:batch||null,
      sample_1:formState.s1?parseFloat(formState.s1):null,
      sample_2:formState.s2?parseFloat(formState.s2):null,
      sample_3:formState.s3?parseFloat(formState.s3):null,
      avg_height:avg?parseFloat(avg):null,
      photo_1_url:formState.p1||null,
      photo_2_url:formState.p2||null,
      photo_3_url:formState.p3||null,
      date:todayISO(),
      auditor_name:(JSON.parse(localStorage.getItem('mjm_user')||'{}').name||'')
    };
    const result=await smartSave('audit_height_records',editMode?'update':'insert',
      editMode?payload:{...payload,record_id:nextID(formState.nursery)},
      editMode?editId:null);
    showToast(result?.offline?t('offline_saved'):editMode?t('record_updated'):t('record_saved'));
    if(!result?.offline){await loadRecords();}
    setView('list');
  }catch(e){console.error('[Save]',e);showToast('⚠ '+(e.message||'Save failed'));setLoading(false);}
}

/* --- DETAIL --- */
function openDetail(uid){
  const r=records.find(x=>x.uid===uid);if(!r)return;
  detailId=uid;
  [1,2,3].forEach(n=>{
    const el=document.getElementById('detail-p'+n);if(!el)return;el.innerHTML='';
    if(r['p'+n]){
      const img=document.createElement('img');img.src=r['p'+n];img.alt='S'+n;
      img.onclick=()=>openLightbox(r['p'+n]);el.appendChild(img);
      const lbl=document.createElement('span');lbl.className='detail-photo-num';lbl.textContent=t('sample')+' '+n;el.appendChild(lbl);
    }else{
      const ph=document.createElement('div');ph.className='detail-photo-empty';
      ph.innerHTML='<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg>';
      el.appendChild(ph);
    }
  });
  document.getElementById('detail-nursery-tag').textContent=NURSERY_LABELS[r.nursery];
  const dtitle=document.getElementById('detail-top-title');if(dtitle)dtitle.textContent=r.plot+' — '+NURSERY_LABELS[r.nursery];
  document.getElementById('detail-id').textContent=r.id;
  document.getElementById('detail-date').textContent=fmtDate(r.date);
  document.getElementById('detail-plot').textContent=r.plot;
  document.getElementById('detail-batch').textContent=r.batch?'Batch: '+r.batch:'';
  document.getElementById('detail-s1').textContent=r.s1||'—';
  document.getElementById('detail-s2').textContent=r.s2||'—';
  document.getElementById('detail-s3').textContent=r.s3||'—';
  document.getElementById('detail-avg-val').textContent=calcAvg(r.s1,r.s2,r.s3)||'—';
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
    await sb.delete('audit_height_records',deleteTarget);
    deleteTarget=null;await loadRecords();showToast(t('record_deleted'));
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