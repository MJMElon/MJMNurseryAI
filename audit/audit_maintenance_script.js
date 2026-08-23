/* BUILD: 2026-08-22m */
/* ================================================================
   MJM NURSERY — MAINTENANCE AUDIT
   maintenance_script.js

   Task source: nops_maint_field_records (the same table the operation
   Maintenance system writes into when a field worker records a
   completed job). As soon as the work_date is keyed in over there, the
   task shows up here with a "Pending" audit status. The auditor's
   verdict continues to be written to audit_maintenance_audits, keyed
   by field_records.id.
================================================================ */
'use strict';

/* Filter categories — five tiles across the top of the list, mirroring
   the operation Maintenance module's icons. The values below match the
   normalised task.type each field row is mapped to in loadAll(). */
const TASK_TYPES = ['P & D Spraying','Manuring','Weeding','Interrow Spray','Others'];

/* Map the operation ledger's short work_type codes onto the human
   labels the audit UI uses. Any code that isn't one of the four known
   ones falls into "Others". */
const WORK_TYPE_LABEL = {
  pd:       'P & D Spraying',
  manuring: 'Manuring',
  weeding:  'Weeding',
  interrow: 'Interrow Spray'
};

let tasks=[], audits=[];
let activeTab='audit';
// Default filter is 'All' — the first tile in the row is pre-selected
// and the type filter is a no-op until the auditor picks a specific
// work type. 'All' or '' both mean "no type filter".
let activeFilter='All', activeView='list';
// The nursery filter respects the scope chosen on audit_nursery_select:
//   Pre Nursery scope → only PN
//   Main Nursery scope → BNN, UNN1, UNN2
// so a PN auditor never sees the three main-nursery tabs (and vice
// versa). The active default is the first entry in that list.
const NURSERY_LABELS={PN:'PN',BNN:'BNN',UNN1:'UNN 1',UNN2:'UNN 2'};
function _scopeNurseries(){
  try {
    var s = (window.MJMAuditLogin && MJMAuditLogin.scope && MJMAuditLogin.scope()) || '';
    if (s === 'PN') return ['PN'];
    if (s === 'MN') return ['BNN','UNN1','UNN2'];
  } catch (e) {}
  return ['PN','BNN','UNN1','UNN2'];        // scope unknown → show all
}
const SCOPE_NURSERIES = _scopeNurseries();
let activeNursery = SCOPE_NURSERIES[0] || 'PN';
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
/* selectTab was the old bottom "To Audit / History" toggle. That bar is
   gone (the bottom bar is now the nursery tabs), and the two sections
   (pending + audited) both sit on the page one under the other, so this
   is only kept as a no-op wrapper in case any surviving call site still
   invokes it. */
function selectTab(tab){
  activeTab=tab;
  const p=document.getElementById('pending-wrap');
  const d=document.getElementById('done-wrap');
  if(p) p.style.display='block';
  if(d) d.style.display='block';
  renderLists();
}
function setFilter(f,el){
  // 'All' is a real tile now — tapping it just clears the type filter
  // and stays highlighted so the row always shows one active tile.
  // Tapping a specific tile while it's already active reverts to 'All'.
  const alreadyActive = (activeFilter === f);
  activeFilter = (f === 'All' || alreadyActive) ? 'All' : f;
  document.querySelectorAll('.filter-icon, .filter-chip').forEach(c=>c.classList.remove('active'));
  if (activeFilter === 'All') {
    const allBtn = document.querySelector('.filter-icon[data-f="All"]');
    if (allBtn) allBtn.classList.add('active');
  } else if (el) {
    el.classList.add('active');
  }
  renderLists();
  updateStats();
}

/* Nursery selector is a bottom tab bar (see .nursery-bottom-tabs).
   Marks the active tab, flips the top-bar `— <nursery>` label, then
   re-renders + re-counts. `el` is the clicked button when called from
   the DOM; when called from the URL param handler / scope init it
   falls back to the matching data-n button. */
function selectNursery(n, el){
  activeNursery=n;
  document.querySelectorAll('.nursery-tab-item').forEach(b=>b.classList.remove('active'));
  if (el) el.classList.add('active');
  else {
    const btn=document.querySelector('.nursery-tab-item[data-n="'+n+'"]');
    if (btn) btn.classList.add('active');
  }
  const label=document.getElementById('topbar-nursery');
  if (label) label.textContent=NURSERY_LABELS[n]||n;
  renderLists();
  updateStats();
}

/* --- STATS --- */
function updateStats(){
  const filtered=filterTasks(tasks);
  const pending=filtered.filter(t=>!getAuditForTask(t.id));
  const done=filtered.filter(t=>!!getAuditForTask(t.id));
  document.getElementById('stat-total').textContent=fmtNum(filtered.length);
  document.getElementById('stat-pending').textContent=fmtNum(pending.length);
  document.getElementById('stat-done').textContent=fmtNum(done.length);
  // Pending count per nursery on the bottom tab bar — a green badge on
  // BNN says work exists there while you're standing on PN, so nobody
  // has to click through four tabs to find it. Same shape as the plot
  // audit and height audit's tab-badges.
  document.querySelectorAll('.nursery-tab-item').forEach(btn=>{
    const n=btn.dataset.n; if(!n) return;
    const count=tasks.filter(t=>t.nursery===n && !getAuditForTask(t.id)).length;
    let dot=btn.querySelector('.tab-badge');
    if(count>0){
      if(!dot){dot=document.createElement('span');dot.className='tab-badge';btn.appendChild(dot);}
      dot.textContent=fmtNum(count);
      btn.setAttribute('aria-label',(NURSERY_LABELS[n]||n)+' — '+fmtNum(count)+' pending');
    } else {
      if(dot) dot.remove();
      btn.removeAttribute('aria-label');
    }
  });
}

/* Applies BOTH filters together — nursery first (cheaper), then task
   type. 'All' (or an empty activeFilter as a legacy fallback) means
   "no type filter, show every task on this nursery". */
function filterTasks(list){
  let out = list.filter(t=>t.nursery===activeNursery);
  if(activeFilter && activeFilter !== 'All') out = out.filter(t=>t.type===activeFilter);
  return out;
}

/* Field records only carry plot_name (e.g. 'B1', 'B4-R'); the audit
   grid keys everything by nursery + padded plot code ('B01', 'B04-R').
   This is the same helper the Plot / Height / Papan audits use. */
function _canonicalPlot(raw){
  const s = String(raw||'').trim().toUpperCase();
  const m = s.match(/^([A-Z]+)(\d+)(-R)?$/);
  if(!m) return s;
  return m[1] + m[2].padStart(2,'0') + (m[3]||'');
}
const PLOT_TO_NURSERY_M = (function(){
  const P = {
    PN:   Array.from({length:52},(_,i)=>'P'+String(i+1).padStart(2,'0')),
    BNN:  Array.from({length:14},(_,i)=>'B'+String(i+1).padStart(2,'0')),
    UNN1: Array.from({length:18},(_,i)=>'U'+String(i+1).padStart(2,'0')),
    UNN2: Array.from({length:20},(_,i)=>'N'+String(i+1).padStart(2,'0'))
  };
  const m = {};
  Object.keys(P).forEach(n => P[n].forEach(p => {
    m[p] = n;
    const stripped = p.replace(/^([A-Z]+)0+(\d)/, '$1$2');
    if(stripped !== p) m[stripped] = n;
  }));
  return m;
})();

/* --- LOAD ---
   Tasks now come from the operation Maintenance module's own ledger
   (nops_maint_field_records). Every row there is a completed job the
   field worker keyed in; the moment its work_date is set, the row
   arrives here as a Pending audit task. Fall back to the legacy
   audit_maintenance_tasks table when nops_maint_field_records isn't
   readable (RLS gap on a fresh auditor account), so the page always
   renders something rather than staying blank. */
async function loadAll(){
  setLoading(true);
  try{
    // nops_maint_field_records is the SINGLE source of truth for tasks
    // now. As soon as a field worker keys a work_date over on the
    // operation Maintenance page, the row shows up here as a Pending
    // audit. The legacy audit_maintenance_tasks table was never keyed
    // into and its UUID ids don't fit the BIGINT task_id column on
    // audit_maintenance_audits anyway, so it's no longer read.
    // Column list must match the actual schema of nops_maint_field_records
    // (see shared/fix_nops_maint_field_records.sql + add_maint_field_batch.sql
    // + add_maint_field_photos.sql). The worker's name is `reported_by`,
    // NOT `worker_name` — the previous query asked for a column that
    // doesn't exist, Supabase 400'd the whole request, the .catch() below
    // swallowed it, and every auditor saw an empty task list even when
    // the operation Maintenance system was actively logging work.
    const [fRows, aRows] = await Promise.all([
      sb.select('nops_maint_field_records',
                'select=id,work_date,nursery_name,plot_name,work_type,jenis,chemical,'
              + 'batch_name,reported_by,photo_urls,qty,remark,created_at')
        .catch(e => { console.warn('[maint-audit] nops_maint_field_records unavailable:', e); return []; }),
      sb.select('audit_maintenance_audits','select=*')
    ]);

    tasks = [];
    (fRows||[]).forEach(r => {
      // Prefer nursery_name if the field wrote it; fall back to deriving
      // from the plot code (older rows written before nursery_name was
      // required will still map correctly). Unknown plots — stray codes
      // in the log — are dropped instead of forced into a wrong nursery.
      const plot    = _canonicalPlot(r.plot_name);
      const nursery = (r.nursery_name && PLOT_TO_NURSERY_M[plot])
                        ? PLOT_TO_NURSERY_M[plot]
                        : (plot ? PLOT_TO_NURSERY_M[plot] : null);
      if(!nursery) return;
      // photo_urls is a comma-separated TEXT column, not JSONB. Split
      // it into an array so the card's "N worker photos" chip counts
      // correctly.
      const photos = (typeof r.photo_urls === 'string' && r.photo_urls.length)
        ? r.photo_urls.split(',').map(s => s.trim()).filter(Boolean)
        : (Array.isArray(r.photo_urls) ? r.photo_urls : []);
      tasks.push({
        id:            String(r.id),                    // field-record BIGSERIAL id
        nursery,
        plot,
        type:          WORK_TYPE_LABEL[r.work_type] || 'Others',
        // Prefer the office-worded chemical when it's set; otherwise
        // fall back to `jenis` (the wording the FC Scan Portal uses).
        chemical:      r.chemical || r.jenis || '',
        round:         '',                              // field record doesn't carry a schedule round
        batch:         r.batch_name || '',
        worker:        r.reported_by || '',
        qty:           r.qty ?? null,
        remark:        r.remark || '',
        completedDate: r.work_date || '',
        workerPhotos:  photos,
        createdAt:     r.created_at,
        _source:       'field'
      });
    });

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

    console.log('[maint-audit] loaded', {
      fromFieldRecords: (fRows||[]).length,
      totalTasks:       tasks.length,
      audits:           audits.length
    });
    renderLists();
    updateStats();
  }catch(e){
    showToast('⚠ Failed to load');console.error(e);
  }
  setLoading(false);
}

/* --- RENDER ---
   Both lists sort oldest → newest by work_date so the auditor works the
   backlog in the order it happened. Ties fall through to plot code so
   two jobs on the same day still land in a repeatable order. */
function renderLists(){
  const filtered = filterTasks(tasks);
  const pending  = filtered.filter(t=>!getAuditForTask(t.id));
  const done     = filtered.filter(t=>!!getAuditForTask(t.id));

  document.getElementById('pending-count').textContent = fmtNum(pending.length) + ' task' + (pending.length!==1?'s':'');
  document.getElementById('done-count').textContent    = fmtNum(done.length)    + ' task' + (done.length!==1?'s':'');

  const byWorkDateAsc = (a,b) => {
    const cmp = String(a.completedDate||'').localeCompare(String(b.completedDate||''));
    if (cmp) return cmp;
    return String(a.plot||'').localeCompare(String(b.plot||''));
  };

  // Pending list — oldest task the field recorded is at the top so the
  // auditor works through the backlog in date order.
  const pendingEl=document.getElementById('pending-list');
  if(!pending.length){
    pendingEl.innerHTML=`<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg></div>
      <h3>No tasks to audit</h3>
      <p>Once a worker keys in a work date on the Maintenance system, it appears here automatically.</p>
    </div>`;
  } else {
    pendingEl.innerHTML=pending.slice().sort(byWorkDateAsc).map(t=>makeTaskCard(t,null)).join('');
  }

  // Done list — same ordering rule so the auditor can scan chronologically.
  const doneEl=document.getElementById('done-list');
  if(!done.length){
    doneEl.innerHTML='<div style="text-align:center;padding:16px;color:var(--text4);font-size:13px">No audited tasks yet.</div>';
  } else {
    doneEl.innerHTML=done.slice().sort(byWorkDateAsc).map(t=>makeTaskCard(t,getAuditForTask(t.id))).join('');
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
  // Legacy 'Not Done' audits map onto the Unsatisfied branch so their
  // remark / photo stays visible on re-open. The button itself stays
  // unselected (there's no 'Not Done' button any more), but the
  // Unsatisfied section shows so the auditor can review or update.
  const isUnsat = formState.result === 'Unsatisfactory' || formState.result === 'Not Done';
  const wrap = document.getElementById('unsat-only');
  if (wrap) wrap.style.display = isUnsat ? '' : 'none';

  const rem = document.getElementById('f-remarks');
  if (rem) rem.value = formState.remarks || '';
  if (formState.photo) {
    document.getElementById('photo-img').src = formState.photo;
    document.getElementById('photo-drop').style.display = 'none';
    document.getElementById('photo-preview').style.display = 'block';
  } else {
    document.getElementById('photo-drop').style.display = 'block';
    document.getElementById('photo-preview').style.display = 'none';
    document.getElementById('photo-img').src = '';
  }
  setView('form');
}
function getTriClass(v){
  if(v==='Satisfactory')return'sel-ok';
  if(v==='Unsatisfactory')return'sel-bad';
  return'sel-na';
}
/* Two-option flow: Satisfied is the whole audit; Unsatisfied reveals
   the Remarks + Photo cards (photo becomes compulsory, remark stays
   optional). Toggle #unsat-only here so the form stays honest — the
   only time the auditor sees the photo card is when the answer needs it. */
function pickResult(val,el){
  document.querySelectorAll('#f-result-grp .tri-btn').forEach(b=>b.className='tri-btn');
  if (el) el.classList.add(getTriClass(val));
  formState.result=val;
  const wrap = document.getElementById('unsat-only');
  if (wrap) wrap.style.display = (val === 'Unsatisfactory') ? '' : 'none';
  // Clear a stale Satisfied → Unsatisfied swap: if the auditor flipped
  // back to Satisfied, drop any remark / photo they'd tentatively keyed
  // so the saved record can't carry misleading residue.
  if (val === 'Satisfactory') {
    const rem = document.getElementById('f-remarks'); if (rem) rem.value = '';
    formState.remarks = '';
    formState.photo = null;
    const drop = document.getElementById('photo-drop');    if (drop) drop.style.display = 'block';
    const prev = document.getElementById('photo-preview'); if (prev) prev.style.display = 'none';
    const img  = document.getElementById('photo-img');     if (img)  img.src = '';
  }
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

/* --- SAVE ---
   Two-branch validation matching the new UI:
     Satisfied   → just needs the result; no remark or photo required
     Unsatisfied → photo is compulsory (auditor has to show what's wrong);
                   remark stays optional
*/
async function saveAudit(){
  if(!formState.result){showToast('⚠ Please select Work Quality');return;}
  const isUnsat = (formState.result === 'Unsatisfactory');
  if (isUnsat && !formState.photo){
    showToast('⚠ A photo is required when the work is Unsatisfied');
    return;
  }
  const t=tasks.find(x=>x.id===formTaskId);if(!t)return;
  const remEl = document.getElementById('f-remarks');
  const remarks = remEl ? remEl.value.trim() : '';
  const user=JSON.parse(localStorage.getItem('mjm_user')||'{}');
  setLoading(true);
  try{
    // Photo only uploaded on the Unsatisfied branch — a Satisfied audit
    // leaves photo_url null in the DB, which is the honest signal that
    // no exception photo was needed.
    let photoUrl = null;
    if (isUnsat && formState.photo) {
      photoUrl = formState.photo;
      if (photoUrl && photoUrl.startsWith('data:'))
        photoUrl = await sb.uploadPhoto('audit-photos','maint_'+t.plot+'_'+Date.now(),photoUrl);
    }
    const payload={
      task_id:parseInt(formTaskId),
      nursery:t.nursery,plot:t.plot,task_type:t.type,
      result:formState.result,
      // Satisfied → drop any residual remark too; only the Unsatisfied
      // branch is supposed to carry commentary.
      remarks: isUnsat ? (remarks || null) : null,
      photo_url: photoUrl,
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
  selectTab('audit');setView('list');
  // Hide the nursery tabs that fall outside the current scope
  // (Pre Nursery = PN only; Main Nursery = BNN/UNN1/UNN2). Applies to
  // the bottom nursery bar; the remaining tabs stretch to fill the row.
  (function _applyScope(){
    var row = document.querySelector('.nursery-bottom-tabs');
    var kept = 0;
    document.querySelectorAll('.nursery-tab-item').forEach(function(b){
      if (SCOPE_NURSERIES.indexOf(b.dataset.n) === -1) {
        b.style.display = 'none';
        b.classList.remove('active');
      } else { kept++; }
    });
    if (row && kept) row.style.gridTemplateColumns = 'repeat(' + kept + ',1fr)';
    var d = document.querySelector('.nursery-tab-item[data-n="'+activeNursery+'"]');
    if (d) d.classList.add('active');
    var label = document.getElementById('topbar-nursery');
    if (label) label.textContent = NURSERY_LABELS[activeNursery] || activeNursery;
  })();
  // Deep-link support: the auditor hub tags its nursery chips with
  // ?nursery=X&from=home. Only honour it when the target is in scope.
  const _q = new URLSearchParams(location.search);
  const _nq = String(_q.get('nursery') || '').toUpperCase();
  if (NURSERY_LABELS[_nq] && SCOPE_NURSERIES.indexOf(_nq) !== -1) selectNursery(_nq);
  loadAll();
  if (_q.get('from') === 'home') {
    const back = document.querySelector('.top-bar-back');
    if (back) {
      back.setAttribute('href', 'audit_home.html');
      back.setAttribute('title', 'Choose another nursery');
      back.setAttribute('aria-label', 'Choose another nursery');
    }
  }
}
document.addEventListener('DOMContentLoaded',init);