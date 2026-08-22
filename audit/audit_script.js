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
// `plotBatches` is the roster of known batches per plot, sourced from the
// audit_batches table (populated by the Nursery AI sync). The first-page
// icon grid draws one dot per row here — yellow while no audit exists
// for (plot, batch), green once one does. A plot with zero rows still
// gets one placeholder dot so the icon is not blank on a plot that has
// not been keyed in yet.
let plotBatches=[];
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
    // Load records + batch roster in parallel. audit_batches is the same
    // table Papan Tanda reads, populated by the Nursery AI sync — each
    // row is one batch on one plot. We only need the (nursery, plot,
    // batch_no) triples, but SELECT * keeps the query simple. Fail-open
    // on batch load errors: plotBatches stays empty and the grid falls
    // back to one placeholder dot per plot.
    const [aRows, bRows] = await Promise.all([
      sb.select('audit_plot_audits','select=*'),
      sb.select('audit_batches','select=*').catch(e => { console.warn('[plot-audit] audit_batches load failed:', e); return []; })
    ]);
    records=aRows.map(r=>({
      uid:String(r.id),id:r.audit_id,nursery:r.nursery,plot:r.plot,
      batch:r.batch,ulat:r.pest,tikus:r.tikus,bintik:r.disease,
      warna:r.warna_daun,photo:r.photo_url,photo2:r.photo_2_url||null,
      date:r.date,createdAt:r.created_at
    }));
    plotBatches=(bRows||[]).map(r=>({
      uid:String(r.id),
      nursery:r.nursery||'',
      plot:r.plot||'',
      batch:String(r.batch_no||'').trim(),
      breed:r.breed||''
    })).filter(b=>b.nursery && b.plot && b.batch);
    renderList();
  }catch(e){showToast(t('err_load'));console.error(e);}
  setLoading(false);
}

/* --- RENDER LIST --- */
/* Batches on a specific plot in the current nursery, deduped by batch
   number (audit_batches occasionally carries two rows for the same batch
   during transplant windows). Also folds in any batches the plot has an
   AUDIT for but no row in audit_batches — a plot audited before the
   batches table was synced would otherwise disappear from the grid. */
function batchesOnPlot(plot){
  const seen = new Set();
  const out = [];
  plotBatches.forEach(b => {
    if (b.nursery !== activeTab || b.plot !== plot) return;
    if (seen.has(b.batch)) return;
    seen.add(b.batch);
    out.push(b);
  });
  records.forEach(r => {
    if (r.nursery !== activeTab || r.plot !== plot) return;
    const bn = String(r.batch || '').trim();
    if (!bn || seen.has(bn)) return;
    seen.add(bn);
    out.push({ batch: bn, breed: '' });
  });
  return out;
}
/* Has this (plot, batch) been audited already? Match on nursery + plot
   + batch as strings — mirrors how the form saves them. */
function isBatchAudited(plot, batch){
  const wanted = String(batch || '').trim();
  return records.some(r =>
    r.nursery === activeTab && r.plot === plot && String(r.batch || '').trim() === wanted);
}

function renderList(){
  const recs=records.filter(r=>r.nursery===activeTab);
  const plots=NURSERY_PLOTS[activeTab]||[];
  const donePlots = plots.filter(p => {
    const bs = batchesOnPlot(p);
    if (!bs.length) return false;                    // no data → never "done"
    return bs.every(b => isBatchAudited(p, b.batch));
  }).length;
  document.getElementById('list-count').textContent =
    donePlots + ' / ' + plots.length + ' done';
  document.getElementById('list-heading').textContent =
    t('plot_title') + ' — ' + NURSERY_LABELS[activeTab];
  document.querySelectorAll('.tab-item').forEach(t=>{
    const cnt=records.filter(r=>r.nursery===t.dataset.n).length;
    let b=t.querySelector('.tab-badge');
    if(cnt>0){if(!b){b=document.createElement('span');b.className='tab-badge';t.appendChild(b);}b.textContent=cnt;}
    else if(b)b.remove();
  });

  const grid=document.getElementById('plot-grid');
  if(!plots.length){
    grid.innerHTML = '<div class="plot-grid-empty">No plots configured for ' + NURSERY_LABELS[activeTab] + '.</div>';
    return;
  }
  grid.innerHTML = plots.map(p => {
    const bs = batchesOnPlot(p);
    // No batches on file yet → one placeholder dot so the icon isn't
    // blank; the plot can't reach "done" until a batch is registered.
    const dotSpecs = bs.length
      ? bs.map(b => ({ batch: b.batch, done: isBatchAudited(p, b.batch) }))
      : [{ batch: '', done: false }];
    const allDone = bs.length && dotSpecs.every(d => d.done);
    const dotsHtml = dotSpecs.map(d =>
      '<span class="plot-dot' + (d.done ? ' done' : '') + '"></span>').join('');
    return `
      <button class="plot-cell ${allDone ? 'done' : ''}"
              data-plot="${p}"
              onclick="openPlotDetail('${p}')"
              aria-label="Plot ${p}${allDone ? ' — done' : ''}">
        <div class="plot-icon">
          <div class="plot-icon-num">${p}</div>
          <div class="plot-icon-dots">${dotsHtml}</div>
          <div class="plot-tick"><svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg></div>
        </div>
        <div class="plot-name">${bs.length ? bs.length + ' batch' + (bs.length > 1 ? 'es' : '') : 'no batches'}</div>
      </button>`;
  }).join('');
}

/* --- PLOT DETAIL VIEW ---
   One plot's batches as a list, each row → open the audit form with
   plot + batch pre-selected. Existing audits show an Edit button
   instead so re-auditing takes the same path everyone else uses. */
function openPlotDetail(plot){
  const bs = batchesOnPlot(plot);
  document.getElementById('plot-detail-plot').textContent = 'Plot ' + plot + ' — ' + NURSERY_LABELS[activeTab];
  document.getElementById('plot-detail-count').textContent =
    bs.length ? bs.length + ' batch' + (bs.length > 1 ? 'es' : '') : 'no batches on file';
  const listEl = document.getElementById('plot-detail-list');
  if (!bs.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">' +
      '<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>' +
      '</div><h3>No batches on file</h3><p>Add a batch on this plot from the Nursery AI batches table, then it will appear here to audit.</p>' +
      '<button class="btn-audit-now" style="margin-top:16px" onclick="_openFormForPlot(\'' + plot + '\',null)">Audit without a batch</button></div>';
    setView('plot');
    return;
  }
  listEl.innerHTML = bs.map(b => {
    const audit = records.find(r => r.nursery === activeTab && r.plot === plot &&
                              String(r.batch || '').trim() === b.batch);
    const done = !!audit;
    const rowStyle = done ? 'border-left:4px solid #22a34a' : 'border-left:4px solid #f4c94a';
    const btnHtml = done
      ? `<button class="btn-audit-now" style="background:var(--g600)" onclick="openEdit('${audit.uid}')">Re-audit</button>`
      : `<button class="btn-audit-now" onclick="_openFormForPlot('${plot}','${b.batch}')">Audit Now</button>`;
    return `<div class="record-item" style="${rowStyle}">
      <div class="record-info">
        <div class="record-plot">Batch ${b.batch}${b.breed ? ' <span style="font-size:11px;color:var(--text3);font-weight:500">· ' + b.breed + '</span>' : ''}</div>
        <div class="record-meta">${done ? '✓ Audited · ' + (audit.id || '') + (audit.createdAt ? ' · ' + fmtDT(audit.createdAt) : '') : 'Pending'}</div>
      </div>
      <div class="record-actions" onclick="event.stopPropagation()">${btnHtml}</div>
    </div>`;
  }).join('');
  setView('plot');
}

/* Open the audit form with plot + batch already filled. Reuses the same
   openAddForm path so nothing on the form changes; just seeds formState
   and pre-fills the two inputs after the form renders. */
function _openFormForPlot(plot, batch){
  openAddForm();
  const ps = document.getElementById('f-plot');
  if (ps) {
    // populateForm rebuilt the options; select the target plot.
    Array.from(ps.options).forEach(o => { if (o.value === plot) ps.value = plot; });
  }
  const bf = document.getElementById('f-batch');
  if (bf && batch != null) bf.value = batch;
}
window.openPlotDetail = openPlotDetail;
window._openFormForPlot = _openFormForPlot;

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
  // Scope-aware tab bar: hide the tabs outside the current scope so a
  // PN auditor only sees PN and an MN auditor only sees BNN/UNN1/UNN2.
  //   Pre Nursery scope → PN only
  //   Main Nursery scope → BNN, UNN1, UNN2
  const _SCOPE = (function(){
    try {
      var s = (window.MJMAuditLogin && MJMAuditLogin.scope && MJMAuditLogin.scope()) || '';
      if (s === 'PN') return ['PN'];
      if (s === 'MN') return ['BNN','UNN1','UNN2'];
    } catch(e){}
    return ['PN','BNN','UNN1','UNN2'];      // unknown scope → show all
  })();
  document.querySelectorAll('.bottom-tabs .tab-item').forEach(function(b){
    if (_SCOPE.indexOf(b.dataset.n) === -1) b.style.display = 'none';
  });
  // Deep-link support: ?nursery=BNN pre-selects that tab so the auditor
  // hub can send the user straight to the right nursery. Falls back to
  // the first in-scope tab if the URL param is outside the scope (a
  // stray link the hub shouldn't have shown). `?from=home` on top swaps
  // the top-bar back arrow for Choose-Another-Nursery.
  const _q  = new URLSearchParams(location.search);
  const _nq = String(_q.get('nursery') || '').toUpperCase();
  const _startNursery = (NURSERY_PLOTS[_nq] && _SCOPE.indexOf(_nq) !== -1)
    ? _nq
    : (_SCOPE[0] || 'PN');
  selectTab(_startNursery);
  if (_q.get('from') === 'home') {
    const back = document.querySelector('.top-bar-back');
    if (back) {
      back.setAttribute('href', 'audit_home.html');
      back.setAttribute('title', 'Choose another nursery');
      back.setAttribute('aria-label', 'Choose another nursery');
    }
  }
  loadRecords();
}
document.addEventListener('DOMContentLoaded',init);