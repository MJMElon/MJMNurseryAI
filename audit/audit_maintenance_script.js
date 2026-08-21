/* BUILD: 2026-08-21c */
/* ================================================================
   MJM NURSERY — MAINTENANCE AUDIT
   maintenance_script.js
================================================================ */
'use strict';

const TASK_TYPES = ['Manuring','Weeding','Racun','Interrow Spray','Other'];

let tasks=[], audits=[];
let activeTab='audit', activeFilter='All', activeView='list';
let editMode=false, editId=null, detailId=null, deleteTarget=null;
let formTaskId=null;
let formState={result:null,remarks:'',photo:null};
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
function getAuditForTask(taskId){return audits.find(a=>a.taskId===taskId)||null;}
function resultBadgeClass(r){
  if(r==='Satisfactory')return'badge-satisfactory';
  if(r==='Unsatisfactory')return'badge-unsatisfactory';
  if(r==='Not Done')return'badge-not_done';
  return'badge-pending';
}
function resultStatusClass(r){
  if(r==='Satisfactory')return'status-satisfactory';
  if(r==='Unsatisfactory')return'status-unsatisfactory';
  if(r==='Not Done')return'status-not_done';
  return'status-pending';
}
function resultColor(r){
  if(r==='Satisfactory')return{bg:'#ecfdf5',color:'#065f46'};
  if(r==='Unsatisfactory')return{bg:'#fff1f1',color:'#b91c1c'};
  if(r==='Not Done')return{bg:'#f1f5f9',color:'#475569'};
  return{bg:'#fef3c7',color:'#92400e'};
}
function nextAuditID(){return'MTA-'+pad(audits.length+1);}

/* --- UI --- */
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
  window.scrollTo(0,0);
}
function selectTab(tab){
  activeTab=tab;
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.toggle('active',t.dataset.t===tab));
  document.getElementById('pending-wrap').style.display=tab==='audit'?'block':'none';
  document.getElementById('done-wrap').style.display='block';
  renderLists();
}
function setFilter(f,el){
  activeFilter=f;
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  renderLists();
}

/* --- STATS --- */
function updateStats(){
  const filtered=filterTasks(tasks);
  const pending=filtered.filter(t=>!getAuditForTask(t.id));
  const done=filtered.filter(t=>!!getAuditForTask(t.id));
  document.getElementById('stat-total').textContent=filtered.length;
  document.getElementById('stat-pending').textContent=pending.length;
  document.getElementById('stat-done').textContent=done.length;
  // Badge on tab
  const tab=document.querySelector('[data-t="audit"]');
  let badge=tab.querySelector('.tab-badge');
  const allPending=tasks.filter(t=>!getAuditForTask(t.id)).length;
  if(allPending>0){
    if(!badge){badge=document.createElement('span');badge.className='tab-badge';tab.appendChild(badge);}
    badge.textContent=allPending;
  } else if(badge) badge.remove();
}

function filterTasks(list){
  if(activeFilter==='All') return list;
  return list.filter(t=>t.type===activeFilter);
}

/* --- LOAD --- */
async function loadAll(){
  setLoading(true);
  try{
    const [tRows, aRows] = await Promise.all([
      sb.select('audit_maintenance_tasks','select=*'),
      sb.select('audit_maintenance_audits','select=*')
    ]);

    tasks = tRows.map(r=>({
      id:        String(r.id),
      nursery:   r.nursery||'',
      plot:      r.plot||'',
      type:      r.task_type||'',
      chemical:  r.chemical||'',
      round:     r.round||'',
      batch:     r.batch||'',
      worker:    r.worker_name||'',
      completedDate: r.completed_date||'',
      workerPhotos: r.photo_urls||[],
      createdAt: r.created_at
    }));

    audits = aRows.map(r=>({
      uid:     String(r.id),
      id:      r.audit_id,
      taskId:  String(r.task_id),
      result:  r.result||'',
      remarks: r.remarks||'',
      photo:   r.photo_url||null,
      date:    r.date||'',
      auditor: r.auditor_name||'',
      createdAt: r.created_at
    }));

    renderLists();
    updateStats();
  }catch(e){
    showToast('⚠ Failed to load');console.error(e);
  }
  setLoading(false);
}

/* --- RENDER --- */
function renderLists(){
  const filtered = filterTasks(tasks);
  const pending  = filtered.filter(t=>!getAuditForTask(t.id));
  const done     = filtered.filter(t=>!!getAuditForTask(t.id));

  document.getElementById('pending-count').textContent=pending.length+' task'+(pending.length!==1?'s':'');
  document.getElementById('done-count').textContent=done.length+' task'+(done.length!==1?'s':'');

  // Pending list
  const pendingEl=document.getElementById('pending-list');
  if(!pending.length){
    pendingEl.innerHTML=`<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg></div>
      <h3>No tasks to audit</h3>
      <p>Completed work orders from workers will appear here automatically.</p>
    </div>`;
  } else {
    pendingEl.innerHTML=pending
      .sort((a,b)=>a.plot.localeCompare(b.plot))
      .map(t=>makeTaskCard(t,null)).join('');
  }

  // Done list
  const doneEl=document.getElementById('done-list');
  if(!done.length){
    doneEl.innerHTML='<div style="text-align:center;padding:16px;color:var(--text4);font-size:13px">No audited tasks yet.</div>';
  } else {
    doneEl.innerHTML=done
      .sort((a,b)=>b.completedDate.localeCompare(a.completedDate))
      .map(t=>makeTaskCard(t,getAuditForTask(t.id))).join('');
  }
}

function makeTaskCard(t, audit){
  const status = audit ? resultStatusClass(audit.result) : 'status-pending';
  const badgeLabel = audit ? audit.result : 'Pending';
  const badgeClass = audit ? resultBadgeClass(audit.result) : 'badge-pending';
  const chips = `<div class="task-chips">
    ${t.round?`<span class="task-chip">Round ${t.round}</span>`:''}
    ${t.batch?`<span class="task-chip">Batch ${t.batch}</span>`:''}
    ${t.chemical?`<span class="task-chip">${t.chemical}</span>`:''}
    <span class="task-chip">📅 ${fmtDate(t.completedDate)}</span>
    ${t.workerPhotos&&t.workerPhotos.length?`<span class="task-chip">📸 ${t.workerPhotos.length} worker photo${t.workerPhotos.length>1?'s':''}</span>`:''}
  </div>`;
  const actions = audit
    ? `<div class="task-actions">
        <button class="btn-view-task" onclick="openDetail('${audit.uid}')">View Audit</button>
        <button class="btn-audit-now" style="background:var(--g600)" onclick="openForm('${t.id}',true,'${audit.uid}')">Re-audit</button>
      </div>`
    : `<div class="task-actions">
        <button class="btn-audit-now" onclick="openForm('${t.id}',false,null)">Audit Now</button>
      </div>`;
  return `<div class="task-card ${status}">
    <div class="task-card-top">
      <span class="task-nursery-tag">${t.nursery||'—'}</span>
      <span class="task-type-tag">${t.type}</span>
      <span class="task-status-badge ${badgeClass}">${badgeLabel}</span>
      <span class="task-card-date">${fmtDate(t.completedDate)}</span>
    </div>
    <div class="task-plot">${t.plot}</div>
    <div class="task-meta">${t.worker?'Worker: '+t.worker:''}</div>
    ${chips}${actions}
  </div>`;
}

/* --- FORM --- */
function openForm(taskId, isEdit, existingAuditUid){
  formTaskId=taskId;
  const t=tasks.find(x=>x.id===taskId);if(!t)return;
  if(isEdit&&existingAuditUid){
    const ex=audits.find(a=>a.uid===existingAuditUid);
    editMode=true;editId=existingAuditUid;
    formState={result:ex?.result||null,remarks:ex?.remarks||'',photo:ex?.photo||null};
  } else {
    editMode=false;editId=null;
    formState={result:null,remarks:'',photo:null};
  }
  // Fill banner
  document.getElementById('b-plot').textContent=t.plot;
  document.getElementById('b-nursery').textContent=t.nursery||'—';
  document.getElementById('b-type').textContent=t.type;
  document.getElementById('b-chemical').textContent=t.chemical||'—';
  document.getElementById('b-round').textContent=t.round?'Round '+t.round:'—';
  document.getElementById('b-batch').textContent=t.batch||'—';
  document.getElementById('b-completed').textContent=fmtDate(t.completedDate);
  document.getElementById('b-worker').textContent=t.worker||'—';
  document.getElementById('form-title').textContent='Audit — '+t.plot;
  document.getElementById('form-id').textContent=editMode?editId:nextAuditID();
  // Reset tri buttons
  document.querySelectorAll('#f-result-grp .tri-btn').forEach(b=>b.className='tri-btn');
  if(formState.result){
    const btn=document.querySelector(`#f-result-grp [data-val="${formState.result}"]`);
    if(btn)btn.classList.add(getTriClass(formState.result));
  }
  document.getElementById('f-remarks').value=formState.remarks||'';
  if(formState.photo){
    document.getElementById('photo-img').src=formState.photo;
    document.getElementById('photo-drop').style.display='none';
    document.getElementById('photo-preview').style.display='block';
  } else {
    document.getElementById('photo-drop').style.display='block';
    document.getElementById('photo-preview').style.display='none';
    document.getElementById('photo-img').src='';
  }
  setView('form');
}
function getTriClass(v){
  if(v==='Satisfactory')return'sel-ok';
  if(v==='Unsatisfactory')return'sel-bad';
  return'sel-na';
}
function pickResult(val,el){
  document.querySelectorAll('#f-result-grp .tri-btn').forEach(b=>b.className='tri-btn');
  el.classList.add(getTriClass(val));
  formState.result=val;
}
async function handlePhoto(input){
  if(!input.files||!input.files[0])return;
  const compressed=await compressPhoto(input.files[0]);
  formState.photo=compressed;
  document.getElementById('photo-img').src=compressed;
  document.getElementById('photo-drop').style.display='none';
  document.getElementById('photo-preview').style.display='block';
  input.value='';
}
function clearPhoto(){
  formState.photo=null;
  document.getElementById('photo-drop').style.display='block';
  document.getElementById('photo-preview').style.display='none';
  document.getElementById('photo-img').src='';
}
function cancelForm(){setView('list');}

/* --- SAVE --- */
async function saveAudit(){
  if(!formState.result){showToast('⚠ Please select Work Quality');return;}
  if(!formState.photo){showToast('⚠ Please upload an audit photo');return;}
  const t=tasks.find(x=>x.id===formTaskId);if(!t)return;
  const remarks=document.getElementById('f-remarks').value.trim();
  const user=JSON.parse(localStorage.getItem('mjm_user')||'{}');
  setLoading(true);
  try{
    let photoUrl=formState.photo;
    if(photoUrl&&photoUrl.startsWith('data:'))
      photoUrl=await sb.uploadPhoto('audit-photos','maint_'+t.plot+'_'+Date.now(),photoUrl);
    const payload={
      task_id:parseInt(formTaskId),
      nursery:t.nursery,plot:t.plot,task_type:t.type,
      result:formState.result,remarks:remarks||null,
      photo_url:photoUrl||null,
      auditor_name:user.name||'',
      date:todayISO()
    };
    const result=await smartSave('audit_maintenance_audits',editMode?'update':'insert',
      editMode?payload:{...payload,audit_id:nextAuditID()},
      editMode?editId:null);
    showToast(result?.offline?'📴 Saved offline — will sync later':editMode?'✓ Audit updated':'✓ Audit saved');
    await loadAll();setView('list');
  }catch(e){showToast('⚠ Save failed');console.error(e);setLoading(false);}
}

/* --- DETAIL --- */
function openDetail(auditUid){
  const audit=audits.find(a=>a.uid===auditUid);if(!audit)return;
  detailId=auditUid;
  const t=tasks.find(x=>x.id===audit.taskId);
  const heroImg=document.getElementById('detail-img');
  const heroPh=document.getElementById('detail-placeholder');
  if(audit.photo){heroImg.src=audit.photo;heroImg.style.display='block';heroPh.style.display='none';}
  else{heroImg.style.display='none';heroPh.style.display='flex';}
  document.getElementById('detail-nursery').textContent=audit.nursery||'—';
  document.getElementById('detail-type').textContent=audit.taskType||t?.type||'—';
  document.getElementById('detail-date').textContent=fmtDate(audit.date);
  document.getElementById('detail-plot').textContent=audit.plot;
  document.getElementById('detail-sub').textContent='Auditor: '+(audit.auditor||'—');
  const rc=resultColor(audit.result);
  const rb=document.getElementById('detail-result-box');
  rb.style.background=rc.bg;rb.style.color=rc.color;rb.style.border='1px solid '+rc.color+'33';
  document.getElementById('detail-result-val').textContent=audit.result||'—';
  document.getElementById('detail-remarks').textContent=audit.remarks||'No remarks.';
  if(t){
    document.getElementById('detail-task-info').innerHTML=`
      <div class="tbg-row"><span class="tbg-label">Plot:</span><span class="tbg-val">${t.plot}</span></div>
      <div class="tbg-row"><span class="tbg-label">Task Type:</span><span class="tbg-val">${t.type}</span></div>
      <div class="tbg-row"><span class="tbg-label">Chemical:</span><span class="tbg-val">${t.chemical||'—'}</span></div>
      <div class="tbg-row"><span class="tbg-label">Round:</span><span class="tbg-val">${t.round?'Round '+t.round:'—'}</span></div>
      <div class="tbg-row"><span class="tbg-label">Batch:</span><span class="tbg-val">${t.batch||'—'}</span></div>
      <div class="tbg-row"><span class="tbg-label">Worker:</span><span class="tbg-val">${t.worker||'—'}</span></div>
      <div class="tbg-row"><span class="tbg-label">Completed:</span><span class="tbg-val">${fmtDate(t.completedDate)}</span></div>`;
  }
  setView('detail');
}
function closeDetail(){setView('list');}
function reAuditFromDetail(){
  const audit=audits.find(a=>a.uid===detailId);
  if(audit)openForm(audit.taskId,true,audit.uid);
}

/* --- LIGHTBOX --- */
function openLightbox(src){document.getElementById('lightbox-img').src=src;document.getElementById('lightbox').classList.add('open');}
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
    await sb.delete('audit_maintenance_audits',deleteTarget);deleteTarget=null;
    await loadAll();showToast('Audit deleted');
    if(activeView==='detail')setView('list');
  }catch(e){showToast('⚠ Delete failed');console.error(e);setLoading(false);}
}

/* --- INIT --- */
function init(){
  const d=document.getElementById('nav-today');
  if(d)d.textContent=new Date().toLocaleDateString('en-MY',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  document.getElementById('modal-overlay').addEventListener('click',e=>{
    if(e.target===document.getElementById('modal-overlay'))cancelDelete();
  });
  document.getElementById('lightbox').addEventListener('click',e=>{
    if(e.target===document.getElementById('lightbox'))closeLightbox();
  });
  selectTab('audit');setView('list');loadAll();
}
document.addEventListener('DOMContentLoaded',init);