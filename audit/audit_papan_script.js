/* BUILD: 2026-08-17g */
/* ================================================================
   MJM NURSERY — PAPAN TANDA AUDIT
   papan_script.js — auto-linked from Nursery AI batches table
================================================================ */
'use strict';

const NURSERY_LABELS = {PN:'PN',BNN:'BNN',UNN1:'UNN 1',UNN2:'UNN 2'};

const NURSERY_PLOTS = {
  PN:   Array.from({length:52},(_,i)=>'P'+String(i+1).padStart(2,'0')),
  BNN:  Array.from({length:14},(_,i)=>'B'+String(i+1).padStart(2,'0')),
  UNN1: Array.from({length:18},(_,i)=>'U'+String(i+1).padStart(2,'0')),
  UNN2: Array.from({length:20},(_,i)=>'N'+String(i+1).padStart(2,'0'))
};


let batches=[], audits=[];
let activeNursery='PN';
let activeTab='audit', activeView='list';
let editMode=false, editId=null, detailId=null, deleteTarget=null, deleteType='audit';
let auditFormBatchUid=null;
let batchFormNursery='PN';
let batchEditId=null;
let formState={presence:null,infoCorrect:null,condition:null,remarks:'',photo:null};
let toastTimer=null;

/* --- HELPERS --- */
function pad(n){return String(n).padStart(3,'0');}
function todayISO(){return new Date().toISOString().split('T')[0];}
function fmtDate(iso){
  if(!iso||iso==='—')return'—';
  const s=iso.split('T')[0].split('-');
  return s[2]+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+s[1]-1]+' '+s[0];
}

/* Get latest batch per plot based on date_transplant */
function getLatestBatchPerPlot(){
  const map={};
  batches.forEach(b=>{
    const key=b.nursery+'_'+b.plot;
    if(!map[key]||(b.dateTransplant||'')>=(map[key].dateTransplant||''))
      map[key]=b;
  });
  return Object.values(map);
}

/* Find audit for a batch */
function getAuditForBatch(batchUid){
  return audits.find(a=>String(a.batchUid)===String(batchUid))||null;
}

/* Status logic */
function overallStatus(audit){
  if(!audit)return'pending';
  const v=[audit.presence,audit.infoCorrect,audit.condition];
  if(v.includes('Bad'))return'fail';
  if(v.includes('Wrong')||v.includes('Empty'))return'issue';
  if(v.every(x=>x==='Correct'||x==='Good'))return'pass';
  return'issue';
}
function statusLabel(s){return{pending:t('pending_s'),pass:t('pass_s'),issue:t('issues_s'),fail:t('fail_s')}[s]||t('pending_s');}
function statusBadgeClass(s){return{pending:'badge-pending',pass:'badge-pass',issue:'badge-issue',fail:'badge-fail'}[s]||'badge-pending';}
function valClass(v){if(['Good','Correct'].includes(v))return'val-ok';if(['Bad','Wrong'].includes(v))return'val-bad';if(v==='Empty')return'val-warn';return'';}
function chipClass(v){if(['Good','Correct'].includes(v))return'cc-ok';if(['Bad','Wrong'].includes(v))return'cc-bad';if(v==='Empty')return'cc-warn';return'cc-na';}
function getTriClass(v){if(['Good','Correct'].includes(v))return'sel-ok';if(v==='Empty')return'sel-warn';return'sel-bad';}
function nextAuditID(){return'PTA-'+pad(audits.length+1);}

/* --- UI HELPERS --- */
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
  const fab=document.getElementById('fab');
  if(fab)fab.classList.toggle('hidden',!(v==='list'&&activeTab==='batch'));
  window.scrollTo(0,0);
}
function selectTab(tab){
  activeTab=tab;
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.toggle('active',t.dataset.t===tab));
  document.getElementById('audit-list-wrap').classList.toggle('hidden',tab!=='audit');
  document.getElementById('batch-list-wrap').classList.toggle('hidden',tab!=='batch');
  const fab=document.getElementById('fab');
  if(fab)fab.classList.toggle('hidden',tab!=='batch'||activeView!=='list');
}

function selectNursery(nursery, el){
  activeNursery=nursery;
  document.querySelectorAll('.nursery-filter-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('topbar-nursery').textContent=NURSERY_LABELS[nursery];
  renderAuditList();
  /* The three counters are per-nursery, but only loadAll() ever refreshed
     them — so switching tabs re-rendered the list and left the previous
     nursery's numbers sitting above it. Landing on PN (empty) and tapping
     BNN gave "Total 0 / Pending 0" over a list with a plot in it. */
  updateStats();
}

/* --- STATS --- */
function updateStats(){
  const latest=getLatestBatchPerPlot().filter(b=>b.nursery===activeNursery);
  document.getElementById('stat-total').textContent=latest.length;
  const pending=latest.filter(b=>!getAuditForBatch(b.uid)).length;
  const passed=latest.filter(b=>{const a=getAuditForBatch(b.uid);return a&&overallStatus(a)==='pass';}).length;
  document.getElementById('stat-pending').textContent=pending;
  document.getElementById('stat-pass').textContent=passed;
  // Badge on audit tab — total pending across ALL nurseries
  const latestAll=getLatestBatchPerPlot();
  const allPending=latestAll.filter(b=>!getAuditForBatch(b.uid)).length;
  const auditTab=document.querySelector('[data-t="audit"]');
  let badge=auditTab?auditTab.querySelector('.tab-badge'):null;
  if(allPending>0&&auditTab){
    if(!badge){badge=document.createElement('span');badge.className='tab-badge';auditTab.appendChild(badge);}
    badge.textContent=allPending;
  } else if(badge) badge.remove();

  /* Same count, split per nursery, on the nursery tabs themselves.
     The total at the bottom says work exists somewhere; this says where,
     so a pending plot on BNN is visible while standing on PN instead of
     needing a tap through all four tabs to find it. */
  document.querySelectorAll('.nursery-filter-btn').forEach(btn=>{
    const n=btn.dataset.n;
    if(!n) return;
    const count=latestAll.filter(b=>b.nursery===n&&!getAuditForBatch(b.uid)).length;
    let dot=btn.querySelector('.nursery-badge');
    if(count>0){
      if(!dot){dot=document.createElement('span');dot.className='nursery-badge';btn.appendChild(dot);}
      dot.textContent=count;
      btn.setAttribute('aria-label',NURSERY_LABELS[n]+' — '+count+' pending');
    } else {
      if(dot) dot.remove();
      btn.removeAttribute('aria-label');
    }
  });
}

/* ================================================================
   LOAD — reads from existing Nursery AI batches table + papan_audits
================================================================ */
async function loadAll(){
  setLoading(true);
  try{
    const [bRows,aRows]=await Promise.all([
      sb.select('audit_batches','select=*'),
      sb.select('audit_papan_audits','select=*')
    ]);

    // Map batches from Nursery AI
    batches=bRows.map(r=>({
      uid:           String(r.id),
      id:            r.batch_id||String(r.id),
      nursery:       r.nursery||'',
      plot:          r.plot||'',
      batch:         r.batch_no||'',
      breed:         r.breed||'',
      qtyTransplant: r.qty_transplant?.toString()||'',
      datePlanted:   r.date_planted||'',
      dateTransplant:r.date_transplant||'',
      dateMature:    r.date_mature||'',
      createdAt:     r.created_at
    }));

    // Map papan audits — batch_ref = batches.id
    audits=aRows.map(r=>({
      uid:        String(r.id),
      id:         r.audit_id,
      batchUid:   String(r.batch_ref),
      nursery:    r.nursery||'',
      plot:       r.plot||'',
      batch:      r.batch_no||'',
      presence:   r.presence||'',
      infoCorrect:r.info_correct||'',
      condition:  r.condition||'',
      remarks:    r.remarks||'',
      photo:      r.photo_url||null,
      date:       r.date||'',
      createdAt:  r.created_at
    }));

    renderAuditList();
    renderPapanAlerts();
    renderBatchTable();
    updateStats();
  }catch(e){
    showToast('⚠ Failed to load');console.error(e);
  }
  setLoading(false);
}

/* --- PAPAN ALERT STRIP --- */
function renderPapanAlerts(){
  const strip=document.getElementById('papan-alert-strip');
  if(!strip)return;

  // Get latest audit per plot
  const latestAudit={};
  audits.forEach(a=>{
    if(!latestAudit[a.plot]||a.createdAt>latestAudit[a.plot].createdAt)
      latestAudit[a.plot]=a;
  });
  const latest=Object.values(latestAudit);

  const badPlots   =latest.filter(a=>a.presence==='Bad'  ||a.infoCorrect==='Wrong' ||a.condition==='Wrong');
  const emptyPlots =latest.filter(a=>a.presence==='Empty'||a.infoCorrect==='Empty' ||a.condition==='Empty');

  if(!badPlots.length&&!emptyPlots.length){strip.innerHTML='';return;}

  function alertRow(icon,label,plots,bg,color){
    const pills=plots.map(p=>`<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:#f4f6f4;border:1px solid #dde8dd;color:#3d5c3d">${p.plot}</span>`).join('');
    return `<div style="background:#fff;border:1px solid #dde8dd;border-radius:12px;margin-bottom:6px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='flex'?'none':'flex'">
        <span style="font-size:16px">${icon}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:#182018">${label}</div>
          <div style="font-size:11px;color:#6b8a6b">${plots.length} plot${plots.length>1?'s':''} affected</div>
        </div>
        <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${bg};color:${color}">${plots.length}</span>
      </div>
      <div style="display:none;padding:0 12px 10px;flex-wrap:wrap;gap:5px">${pills}</div>
    </div>`;
  }

  let html='<div style="margin-bottom:4px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6b8a6b;margin-bottom:8px">⚠ Papan Tanda Alerts</div>';
  if(badPlots.length)   html+=alertRow('🚨','Bad / Wrong Papan',badPlots,'#fff1f1','#b91c1c');
  if(emptyPlots.length) html+=alertRow('⬜','Empty Papan',emptyPlots,'#fff7ed','#c2410c');
  html+='</div>';
  strip.innerHTML=html;
}

/* --- RENDER AUDIT LIST --- */
/* Was a local copy of the admin rule. It now defers to isAuditAdmin() in
   audit_supabase.js so every audit module answers this the same way — the
   local copy is why papan gated deletes and the plot module never did. */
function isAdmin(){ return isAuditAdmin(); }

function renderAuditList(){
  const listEl=document.getElementById('audit-list');
  const compListEl=document.getElementById('completion-list');
  const compSection=document.getElementById('completion-section');
  // Filter by active nursery tab
  const latest=getLatestBatchPerPlot().filter(b=>b.nursery===activeNursery);

  if(!latest.length){
    listEl.innerHTML=`<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg></div>
      <h3>No plots to audit</h3>
      <p>Add batch records in the <strong>Batch Info</strong> tab first.</p>
    </div>`;
    if(compSection)compSection.style.display='none';
    return;
  }

  // Split into pending and audited
  const pending=latest.filter(b=>overallStatus(getAuditForBatch(b.uid))==='pending');
  const audited=latest.filter(b=>overallStatus(getAuditForBatch(b.uid))!=='pending');

  document.getElementById('audit-count').textContent=pending.length+' plot'+(pending.length!==1?'s':'');

  /* opts.canView  — may open the read-only detail of a finished audit
     opts.canAudit — may start or redo an audit

     These used to be one flag, so the completion list passed isAdmin() for
     both and a non-admin got no buttons at all — not even View, which the
     line above it says everyone should have. Viewing a finished audit and
     rewriting one are different rights; they are two flags now. */
  function makeCard(b, opts){
    const o = (opts===true)  ? {canView:true,  canAudit:true}
            : (opts===false) ? {canView:false, canAudit:false}
            : (opts || {});
    const audit=getAuditForBatch(b.uid);
    const status=overallStatus(audit);
    const chips=audit?`<div class="audit-checks">
      <span class="check-chip ${chipClass(audit.presence)}">Presence: ${audit.presence}</span>
      <span class="check-chip ${chipClass(audit.infoCorrect)}">Info: ${audit.infoCorrect}</span>
      <span class="check-chip ${chipClass(audit.condition)}">Height: ${audit.condition}</span>
    </div>`:'';
    const btns=[];
    if(audit && o.canView)
      btns.push(`<button class="btn-view-audit" onclick="openDetail('${audit.uid}')">View</button>`);
    if(audit && o.canAudit)
      btns.push(`<button class="btn-audit-now" onclick="openAuditForm('${b.uid}',true,'${audit.uid}')">Re-audit</button>`);
    if(!audit && o.canAudit)
      btns.push(`<button class="btn-audit-now" onclick="openAuditForm('${b.uid}',false,null)">Audit Now</button>`);
    const actions=btns.length?`<div class="audit-item-actions">${btns.join('')}</div>`:'';
    return `<div class="audit-item status-${status}">
      <div class="audit-item-top">
        <span class="audit-nursery-tag">${b.nursery||'—'}</span>
        <span class="audit-status-badge ${statusBadgeClass(status)}">${statusLabel(status)}</span>
        <span class="audit-item-date">${fmtDate(b.dateTransplant)}</span>
      </div>
      <div class="audit-plot">${b.plot}</div>
      <div class="audit-batch">Batch: ${b.batch}${b.breed?' · '+b.breed:''}${b.qtyTransplant?' · Qty: '+b.qtyTransplant:''}</div>
      ${chips}${actions}
    </div>`;
  }

  // Plots to audit (pending only)
  if(pending.length){
    listEl.innerHTML=pending.sort((a,b)=>(a.plot).localeCompare(b.plot))
      .map(b=>makeCard(b,{canView:true,canAudit:true})).join('');
  } else {
    listEl.innerHTML=`<div style="text-align:center;padding:20px;color:var(--text4);font-size:13px">🎉 All plots audited!</div>`;
  }

  // Completion section — visible to all, re-audit only for admin
  if(audited.length){
    if(compSection)compSection.style.display='block';
    document.getElementById('completion-count').textContent=audited.length+' audited';
    const admin=isAdmin();
    compListEl.innerHTML=audited.sort((a,b)=>(a.plot).localeCompare(b.plot))
      .map(b=>makeCard(b,{canView:true,canAudit:admin})).join('');
  } else {
    if(compSection)compSection.style.display='none';
  }
}

/* --- RENDER BATCH TABLE --- */
function renderBatchTable(){
  const tbody=document.getElementById('batch-tbody');
  document.getElementById('batch-count').textContent=batches.length+' batch'+(batches.length!==1?'es':'');
  if(!batches.length){
    tbody.innerHTML=`<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
      <h3>No batches yet</h3>
      <p>Tap <strong>+</strong> to add the first batch.</p>
    </div>`;
    return;
  }
  const latestUids=new Set(getLatestBatchPerPlot().map(b=>b.uid));
  const sorted=[...batches].sort((a,b)=>(b.dateTransplant||'').localeCompare(a.dateTransplant||''));
  tbody.innerHTML='<div class="record-list">'+sorted.map(b=>{
    const audit=getAuditForBatch(b.uid);
    const status=overallStatus(audit);
    const isLatest=latestUids.has(b.uid);
    return `<div class="audit-item status-${status}">
      <div class="audit-item-top">
        <span class="audit-nursery-tag">${b.nursery||'—'}</span>
        ${isLatest&&status==='pending'?'<span class="audit-status-badge badge-pending">Latest · Pending</span>':''}
        ${status!=='pending'?`<span class="audit-status-badge ${statusBadgeClass(status)}">${statusLabel(status)}</span>`:''}
        <span class="audit-item-date">${fmtDate(b.dateTransplant)}</span>
      </div>
      <div class="audit-plot">${b.plot}</div>
      <div class="audit-batch">Batch: ${b.batch||'—'} · ${b.breed||'—'} · Qty: ${b.qtyTransplant||'—'}</div>
      <div class="audit-checks">
        <span class="check-chip cc-na">Planted: ${fmtDate(b.datePlanted)}</span>
        <span class="check-chip cc-na">Transplant: ${fmtDate(b.dateTransplant)}</span>
        ${b.dateMature?`<span class="check-chip cc-na">Mature: ${fmtDate(b.dateMature)}</span>`:''}
      </div>
      <div class="audit-item-actions">
        <button class="btn-view-audit" onclick="openEditBatch('${b.uid}')">Edit</button>
        ${isAuditAdmin()?`<button class="btn-audit-now" style="background:var(--danger-text)" onclick="confirmDeleteBatch('${b.uid}')">Delete</button>`:''}
      </div>
    </div>`;
  }).join('');
}


/* ================================================================
   BATCH FORM — manual entry
================================================================ */
function addMonths(dateStr, months){
  if(!dateStr)return'';
  const d=new Date(dateStr);d.setMonth(d.getMonth()+months);
  return d.toISOString().split('T')[0];
}
function autoCalcDates(){
  const planted=document.getElementById('bf-date-planted').value;
  if(!planted)return;
  document.getElementById('bf-date-transplant').value=addMonths(planted,3);
  if(batchFormNursery!=='PN')
    document.getElementById('bf-date-mature').value=addMonths(planted,9);
}
function selectBatchNursery(el){
  document.querySelectorAll('.nursery-sel').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');batchFormNursery=el.dataset.n;
  document.getElementById('dm-field').style.display=batchFormNursery==='PN'?'none':'block';
  const ps=document.getElementById('bf-plot');ps.innerHTML='<option value="">— Select —</option>';
  NURSERY_PLOTS[batchFormNursery].forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;ps.appendChild(o);});
  autoCalcDates();
}
function openAddBatch(){
  batchEditId=null;batchFormNursery='PN';
  document.querySelectorAll('.nursery-sel').forEach(t=>t.classList.toggle('active',t.dataset.n==='PN'));
  document.getElementById('dm-field').style.display='none';
  const ps=document.getElementById('bf-plot');ps.innerHTML='<option value="">— Select —</option>';
  NURSERY_PLOTS['PN'].forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;ps.appendChild(o);});
  document.getElementById('bf-batch').value='';
  document.getElementById('bf-breed').value='';
  document.getElementById('bf-qty').value='';
  document.getElementById('bf-date-planted').value='';
  document.getElementById('bf-date-transplant').value='';
  document.getElementById('bf-date-mature').value='';
  document.getElementById('batch-form-title').textContent='New Batch';
  document.getElementById('batch-form-id').textContent='';
  setView('batch-form');
}
function openEditBatch(uid){
  const b=batches.find(x=>x.uid===uid);if(!b)return;
  batchEditId=uid;batchFormNursery=b.nursery||'PN';
  document.querySelectorAll('.nursery-sel').forEach(t=>t.classList.toggle('active',t.dataset.n===batchFormNursery));
  document.getElementById('dm-field').style.display=batchFormNursery==='PN'?'none':'block';
  const ps=document.getElementById('bf-plot');ps.innerHTML='<option value="">— Select —</option>';
  NURSERY_PLOTS[batchFormNursery].forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;if(p===b.plot)o.selected=true;ps.appendChild(o);});
  document.getElementById('bf-batch').value=b.batch||'';
  document.getElementById('bf-breed').value=b.breed||'';
  document.getElementById('bf-qty').value=b.qtyTransplant||'';
  document.getElementById('bf-date-planted').value=b.datePlanted||'';
  document.getElementById('bf-date-transplant').value=b.dateTransplant||'';
  document.getElementById('bf-date-mature').value=b.dateMature||'';
  document.getElementById('batch-form-title').textContent='Edit Batch';
  document.getElementById('batch-form-id').textContent=b.id;
  setView('batch-form');
}
async function saveBatch(){
  const plot=document.getElementById('bf-plot').value;
  const batch=document.getElementById('bf-batch').value.trim();
  const breed=document.getElementById('bf-breed').value.trim();
  const qty=document.getElementById('bf-qty').value.trim();
  const dp=document.getElementById('bf-date-planted').value;
  const dt=document.getElementById('bf-date-transplant').value;
  const dm=document.getElementById('bf-date-mature').value;
  if(!plot){showToast(t('err_select_plot'));return;}
  if(!batch){showToast(t('err_batch'));return;}
  if(!breed){showToast('⚠ Please enter breed/variety');return;}
  if(!qty){showToast(t('err_qty'));return;}
  if(!dp){showToast(t('err_date_planted'));return;}
  if(!dt){showToast(t('err_date_transplant'));return;}
  setLoading(true);
  try{
    const payload={
      nursery:batchFormNursery,plot,batch_no:batch,breed,
      qty_transplant:parseInt(qty)||null,
      date_planted:dp||null,date_transplant:dt,date_mature:dm||null
    };
    if(batchEditId){
      await sb.update('audit_batches',batchEditId,payload);showToast(t('batch_updated'));
    } else {
      payload.batch_id='BTH-'+batchFormNursery+'-'+batch+'-'+plot;
      await sb.insert('audit_batches',payload);showToast(t('batch_saved'));
    }
    await loadAll();setView('list');selectTab('batch');
  }catch(e){showToast(t('err_save'));console.error(e);setLoading(false);}
}

/* --- AUDIT FORM --- */
function openAuditForm(batchUid, isEdit, existingAuditUid){
  auditFormBatchUid=batchUid;
  const b=batches.find(x=>x.uid===batchUid);if(!b)return;

  if(isEdit&&existingAuditUid){
    const ex=audits.find(a=>a.uid===existingAuditUid);
    editMode=true;editId=existingAuditUid;
    formState={presence:ex?.presence||null,infoCorrect:ex?.infoCorrect||null,condition:ex?.condition||null,remarks:ex?.remarks||'',photo:ex?.photo||null};
  } else {
    editMode=false;editId=null;
    formState={presence:null,infoCorrect:null,condition:null,remarks:'',photo:null};
  }

  // Fill banner
  document.getElementById('banner-nursery').textContent=b.nursery||'—';
  document.getElementById('banner-plot').textContent=b.plot;
  document.getElementById('banner-batch').textContent=b.batch||'—';
  document.getElementById('banner-breed').textContent=b.breed||'—';
  document.getElementById('banner-qty').textContent=b.qtyTransplant||'—';
  document.getElementById('banner-dt').textContent=fmtDate(b.dateTransplant);
  document.getElementById('banner-dm').textContent=fmtDate(b.dateMature);
  document.getElementById('audit-form-title').textContent='Audit — '+b.plot;
  document.getElementById('audit-form-id').textContent=editMode?editId:nextAuditID();

  // Reset tri buttons
  ['presence','info','cond'].forEach(f=>{
    const grp=document.getElementById('f-'+f+'-grp');
    if(grp)grp.querySelectorAll('.tri-btn').forEach(b=>b.className='tri-btn');
  });
  if(formState.presence){const btn=document.querySelector('#f-presence-grp [data-val="'+formState.presence+'"]');if(btn)btn.classList.add(getTriClass(formState.presence));}
  if(formState.infoCorrect){const btn=document.querySelector('#f-info-grp [data-val="'+formState.infoCorrect+'"]');if(btn)btn.classList.add(getTriClass(formState.infoCorrect));}
  if(formState.condition){const btn=document.querySelector('#f-cond-grp [data-val="'+formState.condition+'"]');if(btn)btn.classList.add(getTriClass(formState.condition));}
  // no remarks field

  // Photo
  renderPapanPhoto(formState.photo||null);
  setView('audit-form');
}

function pickTri(field,val,el){
  document.getElementById('f-'+field+'-grp').querySelectorAll('.tri-btn').forEach(b=>b.className='tri-btn');
  el.classList.add(getTriClass(val));
  if(field==='presence')formState.presence=val;
  if(field==='info')formState.infoCorrect=val;
  if(field==='cond')formState.condition=val;
}
function triggerPapanPhoto(){
  const sheet=document.createElement('div');
  sheet.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  sheet.innerHTML=`<div style="background:#fff;border-radius:20px 20px 0 0;padding:20px 16px 36px;width:100%;max-width:480px">
    <div style="font-size:14px;font-weight:700;color:#182018;margin-bottom:16px;text-align:center">${t('add_photo')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <button onclick="openCamera('papan-photo-input');this.closest('[style]').remove()" style="height:64px;border-radius:12px;background:#1a4d1a;color:#fff;font-size:15px;font-weight:600;border:none;font-family:inherit;cursor:pointer">📷<br><span style="font-size:11px">${t('cam')}</span></button>
      <button onclick="document.getElementById('papan-photo-gallery').click();this.closest('[style]').remove()" style="height:64px;border-radius:12px;background:#f4f6f4;color:#3d5c3d;font-size:15px;font-weight:600;border:1px solid #dde8dd;font-family:inherit;cursor:pointer">🖼<br><span style="font-size:11px">${t('gal')}</span></button>
    </div>
    <button onclick="this.closest('[style]').remove()" style="width:100%;height:44px;border-radius:12px;background:#f4f6f4;border:1px solid #dde8dd;color:#6b8a6b;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer">${t('cancel')}</button>
  </div>`;
  sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.remove();});
  document.body.appendChild(sheet);
}
async function handlePhoto(input){
  if(!input.files||!input.files[0])return;
  const file=input.files[0];
  /* compressPhoto resolves null when FileReader fails, and the result went
     straight into formState — so an unreadable file cleared the photo and
     drew nothing, which is indistinguishable from the picker never having
     opened. Say something either way. */
  let compressed=null;
  try{
    compressed=await compressPhoto(file);
  }catch(e){
    console.error('[Papan] compressPhoto threw', e);
  }
  input.value='';
  if(!compressed){
    showToast('Could not read that image ('+(file.type||'unknown type')+'). Try Kamera, or pick a JPG.', 5000);
    return;                       // keep whatever photo was already there
  }
  formState.photo=compressed;
  renderPapanPhoto(compressed);
}
/* Show or hide the picked photo.

   This used to write into #papan-photo-slot and bail at `if(!slot)return`
   when it was missing — and it is missing: this page's markup is a drop
   zone plus a hidden preview (#papan-photo-drop / #papan-photo-preview /
   #papan-photo-img), from a redesign the script never caught up with. So
   picking a photo stored it in formState, compressed and ready, and drew
   nothing. The box stayed on "Tambah Gambar" and the whole thing looked
   like a failed upload when nothing had actually failed yet.

   Named for what it renders now, so the next markup change breaks loudly
   instead of silently. */
function renderPapanPhoto(src){
  const drop = document.getElementById('papan-photo-drop');
  const wrap = document.getElementById('papan-photo-preview');
  const img  = document.getElementById('papan-photo-img');
  if(!wrap || !img){
    console.warn('[Papan] photo preview elements missing — check the markup');
    return;
  }
  if(src){
    img.src = src;
    wrap.style.display = 'block';
    if(drop) drop.style.display = 'none';
  }else{
    img.removeAttribute('src');
    wrap.style.display = 'none';
    if(drop) drop.style.display = '';
  }
}
function clearPhoto(e){
  if(e)e.stopPropagation();
  formState.photo=null;
  renderPapanPhoto(null);
  document.getElementById('papan-photo-input').value='';
}

async function saveAudit(){
  if(!formState.presence){showToast(t('err_kehadiran'));return;}
  if(!formState.infoCorrect){showToast(t('err_maklumat'));return;}
  if(!formState.condition){showToast(t('err_keadaan'));return;}
  if(!formState.photo){showToast(t('err_photo_required'));return;}
  const b=batches.find(x=>x.uid===auditFormBatchUid);if(!b)return;
  setLoading(true);
  try{
    const payload={
      batch_ref:parseInt(auditFormBatchUid),
      nursery:b.nursery,plot:b.plot,batch_no:b.batch,
      presence:formState.presence,info_correct:formState.infoCorrect,
      condition:formState.condition,remarks:null,
      photo_url:formState.photo||null,date:todayISO(),
      auditor_name:(JSON.parse(localStorage.getItem('mjm_user')||'{}').name||'')
    };
    const result=await smartSave('audit_papan_audits',editMode?'update':'insert',
      editMode?payload:{...payload,audit_id:nextAuditID()},
      editMode?editId:null);
    setLoading(false);
    showToast(result?.offline?t('offline_saved'):editMode?t('audit_updated'):t('audit_saved'));
    if(!result?.offline){await loadAll();}
    setView('list');selectTab('audit');
  }catch(e){setLoading(false);console.error('[Save]',e);showToast('⚠ '+(e.message||t('err_save')));}
}

/* --- DETAIL --- */
function openDetail(auditUid){
  const audit=audits.find(a=>a.uid===auditUid);if(!audit)return;
  detailId=auditUid;
  const b=batches.find(x=>x.uid===audit.batchUid);
  const heroImg=document.getElementById('detail-hero-img');
  const heroPh=document.getElementById('detail-hero-placeholder');
  if(audit.photo){heroImg.src=audit.photo;heroImg.style.display='block';heroPh.style.display='none';}
  else{heroImg.style.display='none';heroPh.style.display='flex';}
  document.getElementById('detail-nursery-tag').textContent=audit.nursery||'—';
  document.getElementById('detail-id').textContent=audit.id;
  document.getElementById('detail-date').textContent=fmtDate(audit.date);
  document.getElementById('detail-plot').textContent=audit.plot;
  document.getElementById('detail-sub').textContent=t('batch_lbl')+' '+audit.batch+(b?' · '+b.breed:'');
  const pv=document.getElementById('detail-presence-val');pv.textContent=audit.presence||'—';pv.className='detail-check-val '+valClass(audit.presence);
  const iv=document.getElementById('detail-info-val');iv.textContent=audit.infoCorrect||'—';iv.className='detail-check-val '+valClass(audit.infoCorrect);
  const cv=document.getElementById('detail-cond-val');cv.textContent=audit.condition||'—';cv.className='detail-check-val '+valClass(audit.condition);
  document.getElementById('detail-remarks').textContent=audit.remarks||'No remarks.';
  if(b){
    document.getElementById('detail-batch-grid').innerHTML=`
      <div class="bbg-row"><span class="bbg-label">Nursery:</span><span class="bbg-val">${b.nursery}</span></div>
      <div class="bbg-row"><span class="bbg-label">Plot:</span><span class="bbg-val">${b.plot}</span></div>
      <div class="bbg-row"><span class="bbg-label">Breed:</span><span class="bbg-val">${b.breed||'—'}</span></div>
      <div class="bbg-row"><span class="bbg-label">Qty:</span><span class="bbg-val">${b.qtyTransplant||'—'}</span></div>
      <div class="bbg-row"><span class="bbg-label">Transplant:</span><span class="bbg-val">${fmtDate(b.dateTransplant)}</span></div>
      <div class="bbg-row"><span class="bbg-label">Planted:</span><span class="bbg-val">${fmtDate(b.datePlanted)}</span></div>
      <div class="bbg-row"><span class="bbg-label">Mature:</span><span class="bbg-val">${fmtDate(b.dateMature)}</span></div>`;
  }
  setView('detail');
}
function closeDetail(){setView('list');selectTab('audit');}
function editFromDetail(){const audit=audits.find(a=>a.uid===detailId);if(audit)openAuditForm(audit.batchUid,true,audit.uid);}
function deleteFromDetail(){if(detailId)confirmDelete(detailId);}

/* --- DELETE --- */
function confirmDelete(uid){
  if(!isAuditAdmin()){showToast(t('err_delete_admin_only'));return;}
  deleteTarget=uid;deleteType='audit';document.getElementById('modal-overlay').classList.add('show');
}
function confirmDeleteBatch(uid){
  if(!isAuditAdmin()){showToast(t('err_delete_admin_only'));return;}
  deleteTarget=uid;deleteType='batch';document.getElementById('modal-overlay').classList.add('show');
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
    if(deleteType==='batch'){
      // Also delete linked audit if exists
      const linked=audits.find(a=>a.batchUid===deleteTarget);
      if(linked)await sb.delete('audit_papan_audits',linked.uid);
      await sb.delete('audit_batches',deleteTarget);
      showToast(t('batch_deleted'));
    } else {
      await sb.delete('audit_papan_audits',deleteTarget);
      showToast(t('audit_deleted'));
    }
    deleteTarget=null;
    await loadAll();
    if(activeView==='detail'){setView('list');selectTab('audit');}
  }catch(e){showToast(t('err_delete'));console.error(e);setLoading(false);}
}

/* --- INIT --- */
function init(){
  const d=document.getElementById('nav-today');if(d)d.textContent=new Date().toLocaleDateString('en-MY',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  document.getElementById('modal-overlay').addEventListener('click',e=>{if(e.target===document.getElementById('modal-overlay'))cancelDelete();});
  selectTab('audit');setView('list');loadAll();
}
document.addEventListener('DOMContentLoaded',init);