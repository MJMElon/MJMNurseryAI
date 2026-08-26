/* BUILD: 2026-08-22e */
/* ================================================================
   MJM NURSERY — SEEDLING HEIGHT SYSTEM
   height_script.js — Supabase connected

   Same nav flow as Plot Condition Audit: plot-icon grid → plot detail
   → form. The grid pulls its batch roster from shared_inventory_logs
   (Planted for PN, Transplanted* for MN) and uses
   shared_plot_batch_balance to grey out batches that are "out"
   (balance ≤ 0) so the auditor never sees a phantom task.
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
// Roster of known batches per plot — same shape and source as the plot
// condition audit. Populated in loadRecords().
let plotBatches=[];
// Per-(plot,batch) current standing balance from shared_plot_batch_balance.
// Missing key OR value ≤ 0 → batch is out (culled, sold or moved on) →
// isBatchNotRequired() returns true and the row goes grey.
let balanceByPB={};
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
  /* One back arrow at a time. Sub-views carry their own back button in
     the sub-header, so the outer top-bar back steps aside; on the list
     view it returns as the only way back to audit_home. */
  /* One back arrow, and it is the ribbon's. The sub-views used to carry
     their own under it; now the ribbon names the plot instead and its
     arrow steps back a view at a time. */
  const topBack=document.querySelector('.top-bar-back');
  if(topBack)topBack.style.display='';
  const ctxP=document.getElementById('ctx-plot');
  const ctxF=document.getElementById('ctx-form');
  const today=document.getElementById('nav-today');
  if(ctxP)ctxP.style.display=(v==='plot')?'':'none';
  if(ctxF)ctxF.style.display=(v==='form')?'':'none';
  if(today)today.style.display=(v==='plot'||v==='form')?'none':'';
  window.scrollTo(0,0);
}
/* The ribbon arrow: out of the form to the plot it belongs to, out of
   the plot to the grid, and only from the grid out of the module — which
   is the link's own href, so ?from=home still decides where that goes. */
function goBack(e){
  if(activeView==='form'){
    if(e)e.preventDefault();
    if(window._lastOpenedPlot) openPlotDetail(window._lastOpenedPlot); else setView('list');
    return false;
  }
  if(activeView==='plot'||activeView==='detail'){
    if(e)e.preventDefault();
    setView('list');
    return false;
  }
  return true;
}
window.goBack=goBack;

function selectTab(nursery){
  activeTab=nursery;
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.toggle('active',t.dataset.n===nursery));
  document.getElementById('topbar-nursery').textContent=NURSERY_LABELS[nursery];
  renderList();
  setView('list');
}

/* Canonical plot code — NURSERY_PLOTS is padded ('B01'), but the
   operation ledger and shared_plots keep the unpadded form ('B1').
   Preserves the '-R' reserve suffix. Same helper the plot audit uses. */
function _canonicalPlot(raw){
  const s=String(raw||'').trim().toUpperCase();
  const m=s.match(/^([A-Z]+)(\d+)(-R)?$/);
  if(!m)return s;
  return m[1]+m[2].padStart(2,'0')+(m[3]||'');
}
/* Reverse lookup keyed by BOTH padded and unpadded plot codes so a raw
   log spelling from the ledger resolves without a normalise-then-lookup
   two-step. */
const PLOT_TO_NURSERY=(function(){
  const m={};
  Object.keys(NURSERY_PLOTS).forEach(n=>NURSERY_PLOTS[n].forEach(p=>{
    m[p]=n;
    const stripped=p.replace(/^([A-Z]+)0+(\d)/,'$1$2');
    if(stripped!==p)m[stripped]=n;
  }));
  return m;
})();

/* --- LOAD FROM SUPABASE ---
   Fetch audit records + batch roster (from two sources) + balance in
   parallel. All non-critical sources fail-open (empty array) so a stray
   RLS block on one table doesn't take the whole grid down. */
async function loadRecords(){
  setLoading(true);
  try{
    // The ages being audited are read alongside everything else; a failure
    // there leaves MJMAuditSettings on its defaults, which is every age.
    try { await MJMAuditSettings.load(); } catch(_) {}
    const [aRows, tRows, abRows, balRows] = await Promise.all([
      sb.select('audit_height_records','select=*'),
      // Planted → PN, Transplanted* → MN. Both are enough to know a
      // batch is standing on a plot at some point in its life.
      sb.select('shared_inventory_logs',
                'select=batch_name,plot_name,transaction_type,breed_name,transaction_date,created_at,remark'
              + '&transaction_type=in.(Planted,Transplanted,Transplanted_Premium,Transplanted_DoubleTone)')
        .catch(e=>{console.warn('[height-audit] logs load failed:',e);return[];}),
      sb.select('audit_batches','select=nursery,plot,batch_no,breed')
        .catch(e=>{console.warn('[height-audit] audit_batches load failed:',e);return[];}),
      sb.select('shared_plot_batch_balance','select=plot_name,batch_name,qty')
        .catch(e=>{console.warn('[height-audit] balance load failed:',e);return[];})
    ]);
    records = aRows.map(r=>({
      uid:String(r.id), id:r.record_id, nursery:r.nursery,
      plot:_canonicalPlot(r.plot),
      batch:r.batch,
      s1:r.sample_1!=null?String(r.sample_1):'',
      s2:r.sample_2!=null?String(r.sample_2):'',
      s3:r.sample_3!=null?String(r.sample_3):'',
      p1:r.photo_1_url||null, p2:r.photo_2_url||null, p3:r.photo_3_url||null,
      date:r.date, createdAt:r.created_at,
      auditor_name:r.auditor_name||''
    }));

    // Build (nursery, plot, batch) triples from BOTH sources, deduped.
    const seen=new Set();
    plotBatches=[];
    const addBatch=(nursery, plot, batch, breed, planted)=>{
      if(!nursery||!plot||!batch)return;
      const key=nursery+'|'+plot+'|'+batch;
      if(seen.has(key))return;
      seen.add(key);
      plotBatches.push({nursery, plot, batch, breed:breed||'', planted:planted||''});
    };
    (tRows||[]).forEach(l=>{
      const plot=_canonicalPlot(l.plot_name);
      const batch=String(l.batch_name||'').trim();
      const nursery=plot?PLOT_TO_NURSERY[plot]:null;
      addBatch(nursery, plot, batch, l.breed_name, _logDate(l));
    });
    (abRows||[]).forEach(r=>{
      const plot=_canonicalPlot(r.plot);
      const batch=String(r.batch_no||'').trim();
      const nursery=plot?PLOT_TO_NURSERY[plot]:null;
      addBatch(nursery, plot, batch, r.breed);
    });

    balanceByPB={};
    (balRows||[]).forEach(r=>{
      const plot=_canonicalPlot(r.plot_name);
      const batch=String(r.batch_name||'').trim();
      if(!plot||!batch)return;
      balanceByPB[plot+'|'+batch]=Number(r.qty||0);
    });

    _rebuildPlanted();
    console.log('[height-audit] loaded', {
      audits: records.length,
      fromLogs:(tRows||[]).length,
      fromAuditBatches:(abRows||[]).length,
      totalPlotBatches: plotBatches.length,
      balanceRows:(balRows||[]).length
    });
    renderList();
  }catch(e){showToast(t('err_load'));console.error(e);}
  setLoading(false);
}

/* The date a movement row actually happened on. Most rows are saved with
   no transaction_date and carry the keyed date in the remark instead —
   the same resolution shared/shared_plot_movement.js uses, so an auditor
   and the office read one batch as the same age. */
function _logDate(l){
  if(l.transaction_date) return String(l.transaction_date).slice(0,10);
  const m = l.remark ? String(l.remark).match(/(?:Cull)?Date:\s*(\d{4}-\d{2}-\d{2})/i) : null;
  if(m) return m[1];
  return l.created_at ? String(l.created_at).slice(0,10) : '';
}

/* Earliest planting known for a batch anywhere — a batch moves from PN to
   MN and its age follows it, so the age is counted from where it started,
   not from the transplant. */
const _plantedByBatch = {};
function _rebuildPlanted(){
  Object.keys(_plantedByBatch).forEach(k=>delete _plantedByBatch[k]);
  plotBatches.forEach(b=>{
    if(!b.planted) return;
    const k=String(b.batch||'').trim();
    if(!k) return;
    if(!_plantedByBatch[k] || b.planted < _plantedByBatch[k]) _plantedByBatch[k]=b.planted;
  });
}

/* Is this batch one of the ages being audited? Set on Settings → System
   Setting. Unknown age is never hidden: a batch with no planting on
   record is a data gap, and hiding it would quietly drop real work. */
function isBatchInAgeScope(batch){
  if(typeof MJMAuditSettings==='undefined') return true;
  if(MJMAuditSettings.ages()===null) return true;
  const planted=_plantedByBatch[String(batch||'').trim()];
  if(!planted) return true;
  return MJMAuditSettings.ageAllowed(MJMAuditSettings.ageMonths(planted));
}
window.isBatchInAgeScope=isBatchInAgeScope;

/* --- BATCH HELPERS (mirror plot-condition semantics exactly) --- */
/* Fail closed: no balance data at all → treat every batch as required so
   the auditor decides by eye instead of skipping real work. */
function isBatchNotRequired(plot, batch){
  if(!Object.keys(balanceByPB).length)return false;
  const key=_canonicalPlot(plot)+'|'+String(batch||'').trim();
  const qty=balanceByPB[key];
  return qty===undefined||qty<=0;
}
window.isBatchNotRequired=isBatchNotRequired;

function batchesOnPlot(plot){
  const seen=new Set();
  const out=[];
  plotBatches.forEach(b=>{
    if(b.nursery!==activeTab||b.plot!==plot)return;
    if(seen.has(b.batch))return;
    // Out of the ages being audited — unless it has already been audited,
    // in which case it stays so its record is still reachable.
    if(!isBatchInAgeScope(b.batch) && !isBatchAudited(plot, b.batch))return;
    seen.add(b.batch);
    out.push(b);
  });
  // Fold in any batch we have an audit for but no roster row — otherwise
  // a plot audited before the roster synced would disappear.
  records.forEach(r=>{
    if(r.nursery!==activeTab||r.plot!==plot)return;
    const bn=String(r.batch||'').trim();
    if(!bn||seen.has(bn))return;
    seen.add(bn);
    out.push({batch:bn, breed:''});
  });
  return out;
}
function isBatchAudited(plot, batch){
  const wanted=String(batch||'').trim();
  return records.some(r=>
    r.nursery===activeTab && r.plot===plot && String(r.batch||'').trim()===wanted);
}

/* ── PRE NURSERY IS AUDITED BY PLOT ──────────────────────────────────
   The main nursery tracks work batch by batch: a plot holds several,
   each with its own age and its own audit. Pre Nursery does not work
   that way — the seedlings there are audited plot by plot, so the batch
   layer is noise on the screen and a second tap for nothing. For PN the
   grid counts one task per plot, tapping a plot goes straight to the
   form (or to the record, once there is one), and the batch box is not
   on the form at all. The batches are still read behind the scenes —
   they are how we know whether anything is standing on the plot. */
function byPlot(){ return activeTab === 'PN'; }
function plotHasWork(p){
  return batchesOnPlot(p).some(b => !isBatchNotRequired(p, b.batch));
}
function isPlotAudited(p){
  return records.some(r => r.nursery === activeTab && r.plot === p);
}
function openPlotAudit(plot){
  window._lastOpenedPlot = plot;
  const rec = records.find(r => r.nursery === activeTab && r.plot === plot);
  if (rec) { openDetail(rec.uid); return; }
  _openFormForPlot(plot, null);
}
window.openPlotAudit = openPlotAudit;
/* The batch box belongs to a batch-by-batch audit. Hide it where the
   audit is the plot, and hide the row it sits in so nothing gaps. */
function syncBatchField(){
  const bf = document.getElementById('f-batch');
  if (!bf) return;
  const row = bf.closest('.form-field');
  if (row) row.style.display = byPlot() ? 'none' : '';
}

/* --- RENDER LIST — plot-icon grid --- */
function renderList(){
  const plots=NURSERY_PLOTS[activeTab]||[];
  // Count BATCHES (required only). A plot with 4 required batches counts
  // 4 towards the header ratio; a plot with all Not-Required counts 0.
  let totalRequired=0;
  let totalAudited=0;
  plots.forEach(p=>{
    if (byPlot()) {
      if (plotHasWork(p)) { totalRequired++; if (isPlotAudited(p)) totalAudited++; }
      return;
    }
    const required = batchesOnPlot(p).filter(b => !isBatchNotRequired(p, b.batch));
    totalRequired += required.length;
    totalAudited  += required.filter(b=>isBatchAudited(p, b.batch)).length;
  });
  document.getElementById('list-count').textContent =
    fmtNum(totalAudited) + ' / ' + fmtNum(totalRequired) + ' ' + t('audited');
  document.getElementById('list-heading').textContent =
    t('height_title') + ' — ' + NURSERY_LABELS[activeTab];

  // Tab badges — record count per nursery, same as the plot audit.
  document.querySelectorAll('.tab-item').forEach(tb=>{
    const cnt=records.filter(r=>r.nursery===tb.dataset.n).length;
    let b=tb.querySelector('.tab-badge');
    if(cnt>0){if(!b){b=document.createElement('span');b.className='tab-badge';tb.appendChild(b);}b.textContent=fmtNum(cnt);}
    else if(b)b.remove();
  });

  const grid=document.getElementById('plot-grid');
  if(!plots.length){
    grid.innerHTML='<div class="plot-grid-empty">No plots configured for '+NURSERY_LABELS[activeTab]+'.</div>';
    return;
  }
  grid.innerHTML = plots.map(p=>{
    const bs=batchesOnPlot(p);
    const onePlot = byPlot();
    const required = onePlot ? (plotHasWork(p) ? [p] : [])
                            : bs.filter(b => !isBatchNotRequired(p, b.batch));
    const pending  = onePlot ? (required.length && !isPlotAudited(p) ? 1 : 0)
                            : required.filter(b => !isBatchAudited(p, b.batch)).length;
    const done = required.length - pending;
    const allDone = required.length > 0 && pending === 0;

    let badgeHtml='';
    if(required.length){
      badgeHtml = allDone
        ? '<div class="plot-badge done" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 8"/></svg></div>'
        : '<div class="plot-badge" aria-hidden="true">'+pending+'</div>';
    }
    const subtitle = onePlot
      ? (required.length ? (pending ? t('pending_word') : t('all_audited')) : '—')
      : required.length
        ? done + ' / ' + required.length + ' ' + t('audited')
        : (bs.length ? bs.length + ' ' + t(bs.length > 1 ? 'batches_many' : 'batch_one') : t('no_batches'));
    return `
      <button class="plot-cell ${allDone?'done':''}"
              data-plot="${p}"
              onclick="${onePlot ? 'openPlotAudit' : 'openPlotDetail'}('${p}')"
              aria-label="Plot ${p} — ${
                required.length
                  ? (allDone ? t('all_audited') : pending + ' ' + t('pending_word'))
                  : t('no_audit_required_a11y')
              }">
        <div class="plot-icon">
          <div class="plot-icon-num">${p}</div>
          ${badgeHtml}
          <div class="plot-tick"><svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg></div>
        </div>
        <div class="plot-name">${subtitle}</div>
      </button>`;
  }).join('');
}

/* --- PLOT DETAIL — one plot's batches as a list.
   Row ordering: pending on top, audited middle, Not-Required at the
   bottom; ascending batch number within each band. Whole row is the
   tap target (opens the form pre-linked to that batch). */
function openPlotDetail(plot){
  window._lastOpenedPlot=plot;
  const bs=batchesOnPlot(plot).slice().sort((a,b)=>{
    const rank=x=>{
      const aud=records.some(r=>r.nursery===activeTab && r.plot===plot &&
                             String(r.batch||'').trim()===x.batch);
      if(aud)                              return 1;   // audited
      if(isBatchNotRequired(plot,x.batch)) return 2;   // not required
      return 0;                                        // pending
    };
    const rd=rank(a)-rank(b);
    if(rd)return rd;
    const na=Number(a.batch)||0, nb=Number(b.batch)||0;
    if(na!==nb)return na-nb;
    return String(a.batch).localeCompare(String(b.batch));
  });
  document.getElementById('plot-detail-plot').textContent='Plot '+plot+' — '+NURSERY_LABELS[activeTab];
  document.getElementById('plot-detail-count').textContent =
    bs.length ? bs.length+' batch'+(bs.length>1?'es':'') : 'no batches on file';
  const listEl=document.getElementById('plot-detail-list');
  if(!bs.length){
    listEl.innerHTML='<div class="empty-state"><div class="empty-state-icon">'+
      '<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>'+
      '</div><h3>No batches on file</h3><p>Add a batch on this plot from the Nursery AI batches table, then it will appear here to audit.</p>'+
      '<button class="btn-audit-now" style="margin-top:16px" onclick="_openFormForPlot(\''+plot+'\',null)">Audit without a batch</button></div>';
    setView('plot');
    return;
  }
  const canDelete = typeof isAuditAdmin==='function' && isAuditAdmin();
  const editSvg='<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const delSvg ='<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>';

  listEl.innerHTML = bs.map(b=>{
    const audit=records.find(r=>r.nursery===activeTab && r.plot===plot &&
                            String(r.batch||'').trim()===b.batch);
    const done=!!audit;
    const notReq=!done && isBatchNotRequired(plot, b.batch);
    const rowStyle = done
      ? 'border-left:4px solid #22a34a'
      : notReq
        ? 'border-left:4px solid #cbd5e1;opacity:.72'
        : 'border-left:4px solid #f4c94a';
    // Thumbnail: first photo when audited (skip if it's a sentinel), or
    // a placeholder tile otherwise.
    const firstPhoto = done && audit.p1 && audit.p1!=='NO_AUDIT_REQUIRED' ? audit.p1 : null;
    const thumbHtml = firstPhoto
      ? `<img class="record-thumb" src="${firstPhoto}" alt="Batch ${b.batch}" style="width:64px;height:64px;object-fit:cover;border-radius:10px;flex-shrink:0" onclick="event.stopPropagation();openLightbox('${firstPhoto}')"/>`
      : `<div class="record-thumb-placeholder"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg></div>`;
    const breedHtml = b.breed
      ? ` <span style="font-size:11px;color:var(--text3);font-weight:500">· ${b.breed}</span>`
      : '';
    const metaHtml = done
      ? `${audit.id||''}${audit.createdAt?' · '+fmtDT(audit.createdAt):''}`
      : notReq
        ? '<span style="color:#94a3b8;font-weight:600">✕ Not Required</span> · balance ≤ 0 in operation ledger'
        : 'Pending';
    // Height chips replace the plot-condition chips. Declined audits get
    // the same compact "No audit required" pill as the plot audit.
    const avg = done ? calcAvg(audit.s1, audit.s2, audit.s3) : null;
    const chipsHtml = done
      ? (isNoAuditRequired(audit)
          ? `<div class="record-chips" style="margin-top:6px">
               <span class="mini-chip" style="background:#e0f2e0;color:#0f5527;border:1px solid #a7d5b0">
                 ✕ ${noAuditReason(audit)||'No Audit Required'} · by ${audit.auditor_name||'Auditor'}
               </span>
             </div>`
          : `<div class="record-chips" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
               ${audit.s1?`<span class="mini-chip" style="background:#e0f2e0;color:#0f5527">S1:${audit.s1}cm</span>`:'<span class="mini-chip" style="background:#f4f6f4;color:#94a3b8">S1:—</span>'}
               ${audit.s2?`<span class="mini-chip" style="background:#e0f2e0;color:#0f5527">S2:${audit.s2}cm</span>`:'<span class="mini-chip" style="background:#f4f6f4;color:#94a3b8">S2:—</span>'}
               ${audit.s3?`<span class="mini-chip" style="background:#e0f2e0;color:#0f5527">S3:${audit.s3}cm</span>`:'<span class="mini-chip" style="background:#f4f6f4;color:#94a3b8">S3:—</span>'}
               ${avg?`<span class="mini-chip" style="background:#1a4d1a;color:#fff">Avg:${avg}cm</span>`:''}
             </div>`)
      : '';
    const actionsHtml = done
      ? `<div class="record-actions" onclick="event.stopPropagation()">`
          + `<button class="icon-btn edit-btn" title="Edit record" aria-label="Edit record" onclick="openEdit('${audit.uid}')">${editSvg}</button>`
          + (canDelete ? `<button class="icon-btn del-btn" title="Delete record" aria-label="Delete record" onclick="confirmDelete('${audit.uid}')">${delSvg}</button>` : '')
        + '</div>'
      : '';
    const rowClick = done
      ? `openEdit('${audit.uid}')`
      : notReq ? '' : `_openFormForPlot('${plot}','${b.batch}')`;
    const rowLabel = done
      ? 'Edit record for batch '+b.batch
      : notReq
        ? 'Batch '+b.batch+' — audit not required (operation ledger balance ≤ 0)'
        : 'Audit batch '+b.batch;
    const rowAttrs = notReq
      ? `aria-label="${rowLabel}" style="${rowStyle}"`
      : `role="button" tabindex="0" aria-label="${rowLabel}" style="${rowStyle}" onclick="${rowClick}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${rowClick};}"`;
    return `<div class="record-item" ${rowAttrs}>
      ${thumbHtml}
      <div class="record-info">
        <div class="record-plot">Batch ${b.batch}${breedHtml}</div>
        <div class="record-meta">${metaHtml}</div>
        ${chipsHtml}
      </div>
      ${notReq ? '' : actionsHtml}
    </div>`;
  }).join('');
  setView('plot');
}
window.openPlotDetail=openPlotDetail;

/* Open the form with plot + batch already selected and LOCKED — the
   plot / batch pair is what identifies the audit; a stray edit here
   would silently write against a different batch. */
function _openFormForPlot(plot, batch){
  openAddForm();
  const ps=document.getElementById('f-plot');
  if(ps){
    Array.from(ps.options).forEach(o=>{if(o.value===plot)ps.value=plot;});
    ps.disabled=true;
    ps.setAttribute('aria-readonly','true');
    ps.title='Plot is fixed for this audit — cancel and choose another to change';
    ps.style.background='var(--g50)';
    ps.style.color='var(--text3)';
    ps.style.cursor='not-allowed';
  }
  const bf=document.getElementById('f-batch');
  if(bf && batch!=null){
    bf.value=batch;
    bf.readOnly=true;
    bf.setAttribute('aria-readonly','true');
    bf.title='Batch is fixed for this audit — cancel and choose another to change';
    bf.style.background='var(--g50)';
    bf.style.color='var(--text3)';
    bf.style.cursor='not-allowed';
  }
}
window._openFormForPlot=_openFormForPlot;

/* Refresh that stays on the current view — remember which plot detail
   was open, reload, and re-open the same detail with fresh data. */
async function refreshCurrentView(){
  const rememberPlot=window._lastOpenedPlot;
  const rememberView=activeView;
  await loadRecords();
  if(rememberView==='plot' && rememberPlot){
    openPlotDetail(rememberPlot);
  }
}
window.refreshCurrentView=refreshCurrentView;

/* Reset the plot/batch input lock so the FAB path (openAddForm) can
   freely edit them again after a batch-locked flow. */
function _unlockPlotBatchInputs(){
  const ps=document.getElementById('f-plot');
  if(ps){ ps.disabled=false; ps.removeAttribute('aria-readonly'); ps.title=''; ps.style.background=''; ps.style.color=''; ps.style.cursor=''; }
  const bf=document.getElementById('f-batch');
  if(bf){ bf.readOnly=false; bf.removeAttribute('aria-readonly'); bf.title=''; bf.style.background=''; bf.style.color=''; bf.style.cursor=''; }
}

/* Reset the "No Audit Required" UI so a new form doesn't start with the
   previous decline still greyed-out or its confirmation panel showing. */
function _resetDeclineUI(){
  const btn =document.getElementById('no-audit-choices'); if(btn) btn.style.display='';
  const note=document.getElementById('no-audit-note'); if(note)note.style.display='none';
  document.querySelectorAll('.height-input, .photo-slot').forEach(el=>{
    el.style.opacity='';
    el.style.pointerEvents='';
    if(el.tagName==='INPUT') el.disabled=false;
  });
}

/* --- NO-AUDIT-REQUIRED SENTINEL ---
   audit_height_records has no boolean column for "declined". We stamp
   the URL columns with a distinctive non-URL sentinel so the record
   round-trips through the existing schema untouched. Detection is on
   photo_1_url + photo_2_url both carrying the sentinel — a real photo
   would be a base64/https URL, never plain 'NO_AUDIT_REQUIRED'. */
const NO_AUDIT_SENTINEL='NO_AUDIT_REQUIRED';
/* The auditor says WHY no audit is needed — a culling plot or a
   transplanting plot. The reason rides on the sentinel itself
   ('NO_AUDIT_REQUIRED — Culling Plot') so no column has to be added and
   records written before this still read as declined, just unexplained. */
const NO_AUDIT_REASONS=['Culling Plot','Transplanting Plot'];
function isSentinel(v){ return String(v||'').indexOf(NO_AUDIT_SENTINEL)===0; }
function isNoAuditRequired(r){
  return !!r && isSentinel(r.p1) && isSentinel(r.p2);
}
function noAuditReason(r){
  const m=String((r&&r.p1)||'').split('—')[1];
  return m?m.trim():'';
}
window.isNoAuditRequired=isNoAuditRequired;
window.noAuditReason=noAuditReason;

/* --- FORM --- */
function openAddForm(){
  editMode=false;editId=null;
  formState={nursery:activeTab,s1:'',s2:'',s3:'',p1:null,p2:null,p3:null};
  populateForm();setView('form');
  _unlockPlotBatchInputs();
  _resetDeclineUI();
  document.getElementById('form-view-title').textContent='New Record — '+NURSERY_LABELS[activeTab];
}
function openEdit(uid){
  const r=records.find(x=>x.uid===uid);if(!r)return;
  editMode=true;editId=uid;
  formState={nursery:r.nursery,s1:r.s1,s2:r.s2,s3:r.s3,p1:r.p1,p2:r.p2,p3:r.p3};
  populateForm(r);setView('form');
  _resetDeclineUI();
  // Replay the declined state if this record was closed with No Audit
  // Required — the auditor can still Undo and fill in real numbers.
  if(isNoAuditRequired(r)){
    const btn =document.getElementById('no-audit-choices'); if(btn) btn.style.display='none';
    const note=document.getElementById('no-audit-note'); if(note)note.style.display='';
    const nr  =document.getElementById('no-audit-reason');if(nr)  nr.textContent=noAuditReason(r)||'No Audit Required';
    const nb  =document.getElementById('no-audit-by');   if(nb)  nb.textContent=r.auditor_name||'Auditor';
    const nw  =document.getElementById('no-audit-when'); if(nw)  nw.textContent=fmtDT(r.createdAt);
    document.querySelectorAll('.height-input').forEach(el=>{
      el.disabled=true;
      el.style.opacity='.4';
      el.style.pointerEvents='none';
    });
    document.querySelectorAll('.photo-slot').forEach(s=>{
      s.style.opacity='.4';
      s.style.pointerEvents='none';
    });
    const photoReq=document.getElementById('photo-req-note');
    if(photoReq){photoReq.classList.remove('error'); photoReq.textContent='Not required — this batch was closed with No Audit Required.';}
  }
  // Plot + batch identify the audit — lock them the same way the plot
  // audit does. Delete + re-audit to change.
  _unlockPlotBatchInputs();
  const ps=document.getElementById('f-plot');
  const bf=document.getElementById('f-batch');
  if(ps){ ps.disabled=true; ps.setAttribute('aria-readonly','true'); ps.title='Plot fixed on saved records — delete and re-audit to change'; ps.style.background='var(--g50)'; ps.style.color='var(--text3)'; ps.style.cursor='not-allowed'; }
  if(bf){ bf.readOnly=true; bf.setAttribute('aria-readonly','true'); bf.title='Batch fixed on saved records — delete and re-audit to change'; bf.style.background='var(--g50)'; bf.style.color='var(--text3)'; bf.style.cursor='not-allowed'; }
  document.getElementById('form-view-title').textContent=t('edit_lbl')+' — '+r.id;
}

/* Decline: fill formState with the sentinel, grey out the fields, show
   the "who + when" confirmation panel. The auditor still has to press
   Save to persist. */
function declineAudit(reason){
  const u=(function(){try{return JSON.parse(localStorage.getItem('mjm_user')||'{}');}catch(e){return{};}})();
  const who=u.name||u.email||'Auditor';
  const why=NO_AUDIT_REASONS.indexOf(reason)!==-1?reason:'';
  const stamp=why?NO_AUDIT_SENTINEL+' — '+why:NO_AUDIT_SENTINEL;
  formState.s1=''; formState.s2=''; formState.s3='';
  formState.p1=stamp;
  formState.p2=stamp;
  formState.p3=stamp;

  const btn =document.getElementById('no-audit-choices'); if(btn) btn.style.display='none';
  const note=document.getElementById('no-audit-note'); if(note)note.style.display='';
  const nr  =document.getElementById('no-audit-reason');if(nr)  nr.textContent=why||'No Audit Required';
  const nb  =document.getElementById('no-audit-by');   if(nb)  nb.textContent=who;
  const nw  =document.getElementById('no-audit-when'); if(nw)  nw.textContent=new Date().toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});

  document.querySelectorAll('.height-input').forEach(el=>{
    el.disabled=true;
    el.style.opacity='.4';
    el.style.pointerEvents='none';
  });
  document.querySelectorAll('.photo-slot').forEach(s=>{
    s.style.opacity='.4';
    s.style.pointerEvents='none';
  });
  const photoReq=document.getElementById('photo-req-note');
  if(photoReq){photoReq.classList.remove('error'); photoReq.textContent='Not required — this batch is being closed as a '+(why||'no-audit')+'.';}
  showToast('Marked "'+(why||'No Audit Required')+'". Tap Save to close this batch.');
}
window.declineAudit=declineAudit;

/* Undo the decline — clears the sentinel out of formState, re-enables
   fields, hides the confirmation panel. The height inputs and photo
   slots keep whatever was in them before the mistap so a two-tap
   mistake doesn't wipe half-filled real work. */
function undoDeclineAudit(){
  if(isSentinel(formState.p1)) formState.p1=null;
  if(isSentinel(formState.p2)) formState.p2=null;
  if(isSentinel(formState.p3)) formState.p3=null;
  const btn =document.getElementById('no-audit-choices'); if(btn) btn.style.display='';
  const note=document.getElementById('no-audit-note'); if(note)note.style.display='none';
  document.querySelectorAll('.height-input').forEach(el=>{
    el.disabled=false;
    el.style.opacity='';
    el.style.pointerEvents='';
  });
  document.querySelectorAll('.photo-slot').forEach(s=>{
    s.style.opacity='';
    s.style.pointerEvents='';
  });
  const photoReq=document.getElementById('photo-req-note');
  if(photoReq){photoReq.classList.remove('error'); photoReq.textContent=t('photo_3_req');}
  showToast('Undone. Fill in the audit, or name the plot type again.');
}
window.undoDeclineAudit=undoDeclineAudit;
function populateForm(r){
  document.getElementById('f-date').value=editMode?r.date:todayISO();
  syncBatchField();
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
  // Guard: the "No Audit Required" sentinel lives in the same field, but
  // is not a URL — render the empty placeholder instead of a broken image.
  if(src && !isSentinel(src)){
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
  // "No Audit Required" bypasses samples + 3 photo checks — the whole
  // point is that the auditor is closing out a batch without measuring.
  const declined = isSentinel(formState.p1) && isSentinel(formState.p2);
  if(!declined){
    if(!formState.s1&&!formState.s2&&!formState.s3){showToast(t('err_height'));return;}
    if(!formState.p1||!formState.p2||!formState.p3){
      const note=document.getElementById('photo-req-note');
      if(note){note.classList.add('error');note.textContent='⚠ All 3 photos are required';}
      showToast(t('err_3_photos'));return;
    }
  }
  setLoading(true);
  try{
    // Pass photos as base64 — smartSave handles upload (online) or queues (offline).
    // Declined rows write nulls into the numeric columns and the sentinel
    // into the URL columns, so isNoAuditRequired() picks them up on reload.
    const avg=declined ? null : calcAvg(formState.s1,formState.s2,formState.s3);
    const payload={
      nursery:formState.nursery,plot,batch:batch||null,
      sample_1: declined ? null : (formState.s1?parseFloat(formState.s1):null),
      sample_2: declined ? null : (formState.s2?parseFloat(formState.s2):null),
      sample_3: declined ? null : (formState.s3?parseFloat(formState.s3):null),
      avg_height: avg?parseFloat(avg):null,
      photo_1_url: declined ? formState.p1 : (formState.p1||null),
      photo_2_url: declined ? formState.p2 : (formState.p2||null),
      photo_3_url: declined ? formState.p3 : (formState.p3||null),
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
    const src=r['p'+n];
    if(src && !isSentinel(src)){
      const img=document.createElement('img');img.src=src;img.alt='S'+n;
      img.onclick=()=>openLightbox(src);el.appendChild(img);
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
  // Scope-aware tab bar — Pre Nursery auditor sees only PN, Main
  // Nursery sees BNN/UNN1/UNN2. Matches plot audit + papan + maintenance.
  const _SCOPE = (function(){
    try {
      var s = (window.MJMAuditLogin && MJMAuditLogin.scope && MJMAuditLogin.scope()) || '';
      if (s === 'PN') return ['PN'];
      if (s === 'MN') return ['BNN','UNN1','UNN2'];
    } catch(e){}
    return ['PN','BNN','UNN1','UNN2'];
  })();
  // Hide out-of-scope tabs AND rewrite grid-template-columns so the
  // remaining ones stretch evenly across the row. Otherwise MN scope
  // leaves BNN/UNN1/UNN2 pinned to their original grid columns with
  // empty space where PN used to sit. Same fix Papan / Maintenance
  // already apply.
  const _bar = document.querySelector('.bottom-tabs');
  let _kept = 0;
  document.querySelectorAll('.bottom-tabs .tab-item').forEach(function(b){
    if (_SCOPE.indexOf(b.dataset.n) === -1) b.style.display = 'none';
    else _kept++;
  });
  if (_bar && _kept > 1) _bar.style.gridTemplateColumns = 'repeat(' + _kept + ',1fr)';
  // PN scope has only one nursery — hide the whole bar so a lonely PN
  // chip doesn't sit next to empty space, and reclaim the height by
  // dropping --tab-h to 0 (page-scroll / toast / FAB all use it).
  if (_SCOPE.length <= 1) {
    if (_bar) _bar.style.display = 'none';
    document.documentElement.style.setProperty('--tab-h', '0px');
  }
  // Deep-link support — same contract as audit_plot_audit: ?nursery=X
  // opens straight on that tab; &from=home re-labels the top-bar back
  // arrow as Choose-Another-Nursery.
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
  /* ?plot=<code> opens that plot's batches directly — same deep link
     the portal's pending-plot circles use for Plot Condition. */
  loadRecords().then(() => {
    MJMAuditDeepLink.openPlot(NURSERY_PLOTS[activeTab] || [], openPlotDetail);
  });
}
document.addEventListener('DOMContentLoaded', init);