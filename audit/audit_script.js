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
// Per-(plot,batch) current balance from shared_plot_batch_balance — the
// same figure the Operation Movement Report shows. Populated in
// loadRecords, keyed 'PLOT|BATCH'. Missing key OR value ≤ 0 means the
// batch is out (culled, sold or moved on) and audit is Not Required.
let balanceByPB = {};
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
  /* One back arrow at a time. Sub-views (plot detail, form) each carry
     their own back button inside .form-view-header, so the outer top-bar
     one steps aside; on the list view it comes back to be the only way
     out to the audit home. */
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

/* --- LOAD ---
   The plot icon grid needs to know 'which batches are on plot Pxx'.
   Rather than reading the stale audit_batches table (which was a
   one-shot snapshot from Nursery AI), we pull the same source
   Operation Reports uses: shared_inventory_logs — every Transplanted*
   log tells us a batch has landed on a plot. That way the audit's
   yellow dots always match what the operation module says is out
   there today. audit_batches would only see rows manually keyed in.

   PLOT_TO_NURSERY is a reverse lookup of NURSERY_PLOTS (plot code →
   nursery). Anything not in the four scoped lists is skipped so a stray
   plot name in the logs can't inflate the grid. */
/* Canonical plot code — the audit's NURSERY_PLOTS uses padded form
   ('B01', 'U09'), but the operation ledger and shared_plots store the
   unpadded form ('B1', 'U9'). Left alone the two never matched and
   every log was silently dropped from the grid. Preserves the '-R'
   suffix used for reserve plots (e.g. 'B4-R'). */
function _canonicalPlot(raw){
  const s = String(raw || '').trim().toUpperCase();
  const m = s.match(/^([A-Z]+)(\d+)(-R)?$/);
  if (!m) return s;
  return m[1] + m[2].padStart(2, '0') + (m[3] || '');
}
/* PLOT_TO_NURSERY is a reverse lookup of NURSERY_PLOTS keyed by
   BOTH the padded ('B01') and the unpadded ('B1') form, so lookups
   from either source resolve without a canonicalise-then-lookup
   two-step. */
const PLOT_TO_NURSERY = (function(){
  const m = {};
  Object.keys(NURSERY_PLOTS).forEach(n => NURSERY_PLOTS[n].forEach(p => {
    m[p] = n;
    // Unpadded variant of the same plot (B01 → B1) also maps to the
    // same nursery, so a raw log spelling matches without pre-work.
    const stripped = p.replace(/^([A-Z]+)0+(\d)/, '$1$2');
    if (stripped !== p) m[stripped] = n;
  }));
  return m;
})();
async function loadRecords(){
  setLoading(true);
  try{
    // Pull audit records + two possible batch sources + operation_batches
    // (for breed fallback) in parallel. Two sources because the operation
    // ledger (shared_inventory_logs) is the freshest but might be RLS-
    // locked for auditor accounts; audit_batches is the Nursery-AI-sync
    // snapshot that every auditor can already read. We merge both so the
    // grid populates from whichever answers.
    const [aRows, tRows, abRows, bMetaRows, balRows] = await Promise.all([
      sb.select('audit_plot_audits', 'select=*'),
      // Two life stages tell us a batch is standing on a plot:
      //   Planted            → seeds went into a PN plot (P01–P52)
      //   Transplanted*      → seedlings went into an MN plot (B/U/N)
      // Loading only the transplant types missed every PN batch — the
      // Pre-Nursery grid was permanently blank because pre-nursery
      // batches never have a Transplanted log (they only have Planted
      // and later Transplanted OUT to a main nursery plot).
      sb.select('shared_inventory_logs',
                'select=batch_name,plot_name,transaction_type,breed_name'
              + '&transaction_type=in.(Planted,Transplanted,Transplanted_Premium,Transplanted_DoubleTone)')
        .catch(e => { console.warn('[plot-audit] life-stage logs load failed:', e); return []; }),
      sb.select('audit_batches', 'select=nursery,plot,batch_no,breed')
        .catch(e => { console.warn('[plot-audit] audit_batches load failed:', e); return []; }),
      sb.select('operation_batches', 'select=name,breed_name')
        .catch(e => { console.warn('[plot-audit] operation_batches load failed:', e); return []; }),
      // Current plot·batch standing balance — same figure the movement
      // report shows. Missing key OR value ≤ 0 → batch is out, audit is
      // Not Required. Fail-open on any error so the grid keeps working;
      // without balance data every batch is treated as still standing.
      sb.select('shared_plot_batch_balance', 'select=plot_name,batch_name,qty')
        .catch(e => { console.warn('[plot-audit] shared_plot_batch_balance load failed:', e); return []; })
    ]);
    records = aRows.map(r => ({
      uid:String(r.id),id:r.audit_id,nursery:r.nursery,
      // Canonicalise so records saved as 'B1' vs 'B01' still match the
      // grid's padded form.
      plot:_canonicalPlot(r.plot),
      batch:r.batch,ulat:r.pest,tikus:r.tikus,bintik:r.disease,
      warna:r.warna_daun,photo:r.photo_url,photo2:r.photo_2_url||null,
      date:r.date,createdAt:r.created_at
    }));
    // breed_name fallback for logs that predate the breed column being filled.
    const breedByBatch = {};
    (bMetaRows || []).forEach(b => { if (b && b.name) breedByBatch[b.name] = b.breed_name || ''; });

    // Build (nursery, plot, batch) triples from BOTH sources, deduped
    // so the same batch on the same plot doesn't produce multiple dots
    // (Transplanted + Transplanted_Premium for one plot, or the same
    // row appearing in both sources).
    const seen = new Set();
    plotBatches = [];
    const addBatch = (nursery, plot, batch, breed) => {
      if (!nursery || !plot || !batch) return;
      const key = nursery + '|' + plot + '|' + batch;
      if (seen.has(key)) return;
      seen.add(key);
      plotBatches.push({ nursery, plot, batch, breed: breed || breedByBatch[batch] || '' });
    };
    (tRows || []).forEach(l => {
      // Canonicalise the plot as it comes off the ledger — logs use
      // 'B1' but the audit grid iterates 'B01'.
      const plot  = _canonicalPlot(l.plot_name);
      const batch = String(l.batch_name || '').trim();
      const nursery = plot ? PLOT_TO_NURSERY[plot] : null;
      addBatch(nursery, plot, batch, l.breed_name);
    });
    (abRows || []).forEach(r => {
      // audit_batches carries `nursery` directly, but re-check via
      // PLOT_TO_NURSERY so a stale nursery label can't sneak a plot
      // into the wrong grid.
      const plot = _canonicalPlot(r.plot);
      const batch = String(r.batch_no || '').trim();
      const nursery = plot ? PLOT_TO_NURSERY[plot] : null;
      addBatch(nursery, plot, batch, r.breed);
    });
    // Build the balance lookup. Plot / batch keys are upper-cased, since
    // the view keeps them in their original spelling and audit_batches
    // and logs both cased. The 'not required' rule fires on missing key
    // OR value ≤ 0 (see batchesOnPlot()).
    balanceByPB = {};
    (balRows || []).forEach(r => {
      // Same canonical form as the audit grid uses, so isBatchNotRequired
      // matches without a second normalisation step.
      const plot  = _canonicalPlot(r.plot_name);
      const batch = String(r.batch_name || '').trim();
      if (!plot || !batch) return;
      balanceByPB[plot + '|' + batch] = Number(r.qty || 0);
    });

    console.log('[plot-audit] loaded', {
      audits: records.length,
      fromLogs: (tRows || []).length,
      fromAuditBatches: (abRows || []).length,
      totalPlotBatches: plotBatches.length,
      balanceRows: (balRows || []).length
    });
    renderList();
  }catch(e){showToast(t('err_load'));console.error(e);}
  setLoading(false);
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
/* Both PN and MN audit by plot now — batch-by-batch was cancelled at
   the auditor's request. The batches sitting on the plot are still
   read from the roster (see plotHasWork) so the tile can flag empty
   plots, and they render as read-only chips inside the form's
   Audit Information card. */
function byPlot(){ return true; }
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
  /* Fill the read-only batches chips inside the form so the auditor
     sees which batches sit on this plot. Sorted by batch number. */
  _paintBatchesChips(plot);
}
window.openPlotAudit = openPlotAudit;

function _paintBatchesChips(plot){
  const chips = document.getElementById('f-batches-chips');
  if (!chips) return;
  const bs = batchesOnPlot(plot).slice().sort((a,b)=>{
    const na=Number(a.batch)||0, nb=Number(b.batch)||0;
    if(na!==nb)return na-nb;
    return String(a.batch).localeCompare(String(b.batch));
  });
  if (!bs.length){
    chips.innerHTML='<span style="font-size:12px;color:#94a3b8">No batches on file</span>';
    return;
  }
  chips.innerHTML=bs.map(b=>{
    const breed=b.breed ? ' · '+b.breed : '';
    return '<span class="batch-chip" style="display:inline-flex;align-items:center;padding:5px 11px;'
      +'border-radius:999px;background:#e0f2e0;border:1px solid #a7d5b0;color:#0f5527;'
      +'font-size:11.5px;font-weight:700;letter-spacing:.2px">Batch '+b.batch+breed+'</span>';
  }).join('');
}
window._paintBatchesChips = _paintBatchesChips;
/* The batch box belongs to a batch-by-batch audit. Hide it where the
   audit is the plot, and hide the row it sits in so nothing gaps. */
function syncBatchField(){
  const bf = document.getElementById('f-batch');
  if (!bf) return;
  const row = bf.closest('.form-field');
  if (row) row.style.display = byPlot() ? 'none' : '';
}

/* --- RENDER LIST --- */
/* Not-required = the operation ledger says nothing is standing in
   this (plot, batch) right now. Balance ≤ 0 counts (culled, sold,
   moved on, or over-issued); a batch not present in the balance map
   at all also counts, since the view drops zero-balance rows.

   When we don't have any balance data at all (view unreadable /
   Supabase blip), fall CLOSED to 'required' so we never accidentally
   mark a real batch as done — the auditor can decide by eye. */
function isBatchNotRequired(plot, batch){
  if (!Object.keys(balanceByPB).length) return false;   // no data → don't skip
  const key = _canonicalPlot(plot) + '|' + String(batch || '').trim();
  const qty = balanceByPB[key];
  return qty === undefined || qty <= 0;
}
window.isBatchNotRequired = isBatchNotRequired;

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
  // Count BATCHES to audit, not plots — the ratio in the header now
  // tells the auditor how many actual audit tasks are left. A plot
  // with 6 required batches counts 6, a plot with 0 required
  // (everything sold out / Not-Required) counts 0. Batches the
  // operation ledger says are out are excluded from both sides of
  // the fraction so a plot that has no work never inflates the total.
  let totalRequired = 0;
  let totalAudited  = 0;
  plots.forEach(p => {
    if (byPlot()) {
      if (plotHasWork(p)) { totalRequired++; if (isPlotAudited(p)) totalAudited++; }
      return;
    }
    const required = batchesOnPlot(p).filter(b => !isBatchNotRequired(p, b.batch));
    totalRequired += required.length;
    totalAudited  += required.filter(b => isBatchAudited(p, b.batch)).length;
  });
  document.getElementById('list-count').textContent =
    fmtNum(totalAudited) + ' / ' + fmtNum(totalRequired) + ' ' + t('audited');
  document.getElementById('list-heading').textContent =
    t('plot_title') + ' — ' + NURSERY_LABELS[activeTab];
  document.querySelectorAll('.tab-item').forEach(t=>{
    const cnt=records.filter(r=>r.nursery===t.dataset.n).length;
    let b=t.querySelector('.tab-badge');
    if(cnt>0){if(!b){b=document.createElement('span');b.className='tab-badge';t.appendChild(b);}b.textContent=fmtNum(cnt);}
    else if(b)b.remove();
  });

  const grid=document.getElementById('plot-grid');
  if(!plots.length){
    grid.innerHTML = '<div class="plot-grid-empty">No plots configured for ' + NURSERY_LABELS[activeTab] + '.</div>';
    return;
  }
  grid.innerHTML = plots.map(p => {
    const bs = batchesOnPlot(p);
    // Only REQUIRED batches count — anything the operation ledger says
    // is out (balance ≤ 0) is Not Required and never turns into work.
    const onePlot  = byPlot();
    const required = onePlot ? (plotHasWork(p) ? [p] : [])
                             : bs.filter(b => !isBatchNotRequired(p, b.batch));
    const pending  = onePlot ? (required.length && !isPlotAudited(p) ? 1 : 0)
                             : required.filter(b => !isBatchAudited(p, b.batch)).length;
    const done     = required.length - pending;
    const allDone  = required.length > 0 && pending === 0;

    // Corner badge — pending count on amber, or a green ✓ when every
    // required batch is audited. Nothing at all when a plot has no
    // required batches to audit (avoids a phantom "0" on empty plots).
    let badgeHtml = '';
    if (required.length) {
      badgeHtml = allDone
        ? '<div class="plot-badge done" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 8"/></svg></div>'
        : '<div class="plot-badge" aria-hidden="true">' + pending + '</div>';
    }
    // Subtitle carries the ratio when there is work; falls back to the
    // total-batch count on plots with only Not-Required (or none at all).
    const subtitle = onePlot
      ? (required.length ? (pending ? t('pending_word') : t('all_audited')) : '—')
      : required.length
        ? done + ' / ' + required.length + ' ' + t('audited')
        : (bs.length ? bs.length + ' ' + t(bs.length > 1 ? 'batches_many' : 'batch_one') : t('no_batches'));
    return `
      <button class="plot-cell ${allDone ? 'done' : ''}"
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

/* --- PLOT DETAIL VIEW ---
   One plot's batches as a list, each row → open the audit form with
   plot + batch pre-selected. Existing audits show an Edit button
   instead so re-auditing takes the same path everyone else uses. */
function openPlotDetail(plot){
  // Remember which plot is on screen so the top-bar refresh can re-open
  // the same detail after loadRecords() completes.
  window._lastOpenedPlot = plot;
  // Row order: pending on top, audited in the middle, Not-Required at
  // the bottom. Within each band, batch number ascending. That way an
  // auditor opens the plot and their next task is the first thing under
  // the thumb; a batch flips to "done" and slides down; anything the
  // ledger says is out sits at the very bottom out of the way. Sort key
  // 0/1/2 makes the ordering explicit and future-proof (add 3 for a new
  // band without touching the compare).
  const bs = batchesOnPlot(plot).slice().sort((a, b) => {
    const rank = x => {
      const aud = records.some(r => r.nursery === activeTab && r.plot === plot &&
                                String(r.batch || '').trim() === x.batch);
      if (aud)                                    return 1;    // audited
      if (isBatchNotRequired(plot, x.batch))      return 2;    // not required
      return 0;                                                // pending
    };
    const rd = rank(a) - rank(b);
    if (rd) return rd;
    // Numeric batch sort within a band — '221' before '235', not
    // '221' after '2350' which localeCompare would give.
    const na = Number(a.batch) || 0, nb = Number(b.batch) || 0;
    if (na !== nb) return na - nb;
    return String(a.batch).localeCompare(String(b.batch));
  });
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
  // Card design mirrors the Seedling Height list: thumb on the left,
  // batch code + breed + audit-id/date, findings as chip pills, and
  // icon buttons on the right (green edit; red trash for admins only,
  // matching the height and papan lists — anyone can edit, only an
  // admin may delete). Pending batches keep a text 'Audit Now' button
  // because there's no record to edit or delete yet.
  const canDelete = typeof isAuditAdmin === 'function' && isAuditAdmin();
  const editSvg = '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const delSvg  = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>';

  listEl.innerHTML = bs.map(b => {
    const audit = records.find(r => r.nursery === activeTab && r.plot === plot &&
                              String(r.batch || '').trim() === b.batch);
    const done = !!audit;
    // The operation ledger's Plot·Batch Balance says nothing is standing
    // here — culled, sold or moved on. No audit needed. Skip Not-
    // Required if an audit ALREADY exists on this batch (don't hide
    // the auditor's work just because the batch was sold off later).
    const notReq = !done && isBatchNotRequired(plot, b.batch);
    const rowStyle = done
      ? 'border-left:4px solid #22a34a'
      : notReq
        ? 'border-left:4px solid #cbd5e1;opacity:.72'
        : 'border-left:4px solid #f4c94a';
    const thumbHtml = done && audit.photo
      ? `<img class="record-thumb" src="${audit.photo}" alt="Batch ${b.batch}" onclick="event.stopPropagation();openLightbox('${audit.photo}')"/>`
      : `<div class="record-thumb-placeholder"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg></div>`;
    const breedHtml = b.breed
      ? ` <span style="font-size:11px;color:var(--text3);font-weight:500">· ${b.breed}</span>`
      : '';
    const metaHtml = done
      ? `${audit.id || ''}${audit.createdAt ? ' · ' + fmtDT(audit.createdAt) : ''}`
      : notReq
        ? '<span style="color:#94a3b8;font-weight:600">✕ Not Required</span> · balance ≤ 0 in operation ledger'
        : 'Pending';
    // "No Audit Required" records get one compact pill instead of the
    // four measurement chips — the four fields carry the sentinel
    // string, not real measurements, so rendering them as chips would
    // be misleading. Shows who declined for accountability.
    const chipsHtml = done
      ? (isNoAuditRequired(audit)
          ? `<div class="record-chips">
               <span class="mini-chip" style="background:#e0f2e0;color:#0f5527;border:1px solid #a7d5b0;padding:3px 10px">
                 ✕ ${noAuditReason(audit) || 'No Audit Required'} · by ${audit.auditor_name || 'Auditor'}
               </span>
             </div>`
          : `<div class="record-chips">
               <span class="mini-chip ${chipClass(audit.ulat)}">Pest:${audit.ulat}</span>
               <span class="mini-chip ${chipClass(audit.tikus)}">Animal:${audit.tikus}</span>
               <span class="mini-chip ${chipClass(audit.bintik)}">Disease:${audit.bintik}</span>
               <span class="mc-w mini-chip" style="background:${WARNA_BG[audit.warna]||'#888'}">Leaf ${audit.warna}</span>
             </div>`)
      : '';
    // Actions on the right:
    //   audited → edit + (admin) delete icon buttons
    //   pending → nothing on the right; the row itself is the tap target
    const actionsHtml = done
      ? `<div class="record-actions" onclick="event.stopPropagation()">`
          + `<button class="icon-btn edit-btn" title="Edit audit" aria-label="Edit audit" onclick="openEdit('${audit.uid}')">${editSvg}</button>`
          + (canDelete ? `<button class="icon-btn del-btn" title="Delete audit" aria-label="Delete audit" onclick="confirmDelete('${audit.uid}')">${delSvg}</button>` : '')
        + '</div>'
      : '';
    // Whole-row click opens the right form: pending → new audit for this
    // batch; audited → edit that audit. Not-Required rows are DEAD
    // targets — no action, no keyboard activation — so a tap doesn't
    // trigger an audit that wasn't asked for. The auditor can still
    // manually add one via the FAB if they want.
    const rowClick = done
      ? `openEdit('${audit.uid}')`
      : notReq
        ? ''
        : `_openFormForPlot('${plot}','${b.batch}')`;
    const rowLabel = done
      ? 'Edit audit for batch ' + b.batch
      : notReq
        ? 'Batch ' + b.batch + ' — audit not required (operation ledger balance ≤ 0)'
        : 'Audit batch ' + b.batch;
    const rowAttrs = notReq
      // no role=button, no tabindex, no click — the row is inert.
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

/* Open the audit form with plot + batch already filled. Reuses the same
   openAddForm path so nothing on the form changes; just seeds formState
   and pre-fills the two inputs after the form renders.

   Both fields are LOCKED once auto-linked from the plot detail — the
   audit's identity (which plot, which batch) is what the whole grid
   navigation just chose, so allowing the user to edit them here would
   let a tap on B04's Batch 231 save an audit against B12 · Batch 999
   by mistake. The user can still cancel and pick a different batch
   from the grid. */
function _openFormForPlot(plot, batch){
  openAddForm();
  const ps = document.getElementById('f-plot');
  if (ps) {
    // populateForm rebuilt the options; select the target plot.
    Array.from(ps.options).forEach(o => { if (o.value === plot) ps.value = plot; });
    ps.disabled = true;
    ps.setAttribute('aria-readonly', 'true');
    ps.title = 'Plot is fixed for this audit — cancel and choose another to change';
  }
  const bf = document.getElementById('f-batch');
  if (bf && batch != null) {
    bf.value = batch;
    bf.readOnly = true;
    bf.setAttribute('aria-readonly', 'true');
    bf.title = 'Batch is fixed for this audit — cancel and choose another to change';
    // A readOnly + disabled visual — same subdued tint the other
    // read-only fields (Audit ID, Date) use.
    bf.style.background = 'var(--g50)';
    bf.style.color = 'var(--text3)';
    bf.style.cursor = 'not-allowed';
  }
  if (ps) {
    ps.style.background = 'var(--g50)';
    ps.style.color = 'var(--text3)';
    ps.style.cursor = 'not-allowed';
  }
}

/* --- REFRESH THAT STAYS ON THE CURRENT VIEW ---
   The top-bar refresh button used to call loadRecords() directly. That
   re-ran the fetch but left the plot detail view showing stale data —
   or made it look like a bounce back to the grid. This wrapper
   remembers which view was open, reloads, and re-opens it in place. */
async function refreshCurrentView(){
  const rememberPlot = window._lastOpenedPlot;
  const rememberView = activeView;
  await loadRecords();
  if (rememberView === 'plot' && rememberPlot) {
    openPlotDetail(rememberPlot);      // rebuilds the batch list from fresh data
  }
}
window.refreshCurrentView = refreshCurrentView;
window.openPlotDetail = openPlotDetail;
window._openFormForPlot = _openFormForPlot;

/* Reset the lock state that _openFormForPlot sets when auto-linking.
   The FAB path (openAddForm) needs the plot/batch inputs to be freely
   editable again — otherwise a manual +New audit after a batch-locked
   one would still be frozen on the previous batch's identity. */
function _unlockPlotBatchInputs(){
  const ps = document.getElementById('f-plot');
  if (ps){ ps.disabled=false; ps.removeAttribute('aria-readonly'); ps.title=''; ps.style.background=''; ps.style.color=''; ps.style.cursor=''; }
  const bf = document.getElementById('f-batch');
  if (bf){ bf.readOnly=false; bf.removeAttribute('aria-readonly'); bf.title=''; bf.style.background=''; bf.style.color=''; bf.style.cursor=''; }
}

/* Reset the "No Audit Required" UI so a new form doesn't start with
   the previous decline still greyed-out or its confirmation panel
   still showing. Called at the top of openAddForm / openEdit. */
function _resetDeclineUI(){
  const btn  = document.getElementById('no-audit-choices'); if (btn) btn.style.display = '';
  const note = document.getElementById('no-audit-note');  if (note) note.style.display = 'none';
  document.querySelectorAll('.tri-btn, .warna-btn').forEach(b => {
    b.disabled = false;
    b.style.opacity = '';
    b.style.pointerEvents = '';
  });
  document.querySelectorAll('.photo-slot').forEach(s => {
    s.style.opacity = '';
    s.style.pointerEvents = '';
  });
}

/* --- FORM --- */
function openAddForm(){
  editMode=false;editId=null;
  formState={nursery:activeTab,ulat:null,tikus:null,bintik:null,warna:null,photo1:null,photo2:null};
  populateForm();setView('form');
  _unlockPlotBatchInputs();
  _resetDeclineUI();
  document.getElementById('form-view-title').textContent=t('new_audit')+' — '+NURSERY_LABELS[activeTab];
}
function openEdit(uid){
  const r=records.find(x=>x.uid===uid);if(!r)return;
  editMode=true;editId=uid;
  formState={nursery:r.nursery,ulat:r.ulat,tikus:r.tikus,bintik:r.bintik,warna:r.warna,photo1:r.photo||null,photo2:r.photo2||null};
  populateForm(r);setView('form');
  _resetDeclineUI();
  // If this record was closed with "No Audit Required", replay the same
  // greyed-out state so the auditor can see (or re-decline / re-open).
  if (isNoAuditRequired(r)) {
    const btn  = document.getElementById('no-audit-choices'); if (btn) btn.style.display = 'none';
    const note = document.getElementById('no-audit-note');  if (note) note.style.display = '';
    const nr   = document.getElementById('no-audit-reason');if (nr)   nr.textContent = noAuditReason(r) || NO_AUDIT_SENTINEL;
    const nb   = document.getElementById('no-audit-by');    if (nb)   nb.textContent = r.auditor_name || 'Auditor';
    const nw   = document.getElementById('no-audit-when');  if (nw)   nw.textContent = fmtDT(r.createdAt);
    document.querySelectorAll('.tri-btn, .warna-btn').forEach(b => {
      b.disabled = true; b.style.opacity = '.4'; b.style.pointerEvents = 'none';
    });
    document.querySelectorAll('.photo-slot').forEach(s => {
      s.style.opacity = '.4'; s.style.pointerEvents = 'none';
    });
    const photoReq = document.getElementById('photo-req-note');
    if (photoReq){ photoReq.classList.remove('error'); photoReq.textContent = 'Not required — this batch was closed with No Audit Required.'; }
  }
  // Editing an existing audit: plot and batch are what identify the
  // record; changing them would silently rewrite a different plot's
  // audit. Lock them the same way _openFormForPlot does.
  _unlockPlotBatchInputs();     // clear any stale lock…
  const ps = document.getElementById('f-plot');
  const bf = document.getElementById('f-batch');
  if (ps){ ps.disabled=true; ps.setAttribute('aria-readonly','true'); ps.title='Plot fixed on saved audits — delete and re-audit to change'; ps.style.background='var(--g50)'; ps.style.color='var(--text3)'; ps.style.cursor='not-allowed'; }
  if (bf){ bf.readOnly=true; bf.setAttribute('aria-readonly','true'); bf.title='Batch fixed on saved audits — delete and re-audit to change'; bf.style.background='var(--g50)'; bf.style.color='var(--text3)'; bf.style.cursor='not-allowed'; }
  document.getElementById('form-view-title').textContent='Edit — '+r.id;
}
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
/* NO_AUDIT_SENTINEL — the string we stamp into pest / tikus / disease /
   warna_daun when an auditor closes a batch out without checking it.
   Detection uses `isNoAuditRequired(r)` below, and the plot detail /
   detail modal render swap the chip row for a compact "No audit
   required — by X · date" pill. Kept as a distinctive constant string
   rather than a Boolean column so nothing has to change in the DB. */
const NO_AUDIT_SENTINEL = 'No Audit Required';
/* The auditor now says WHY a batch needs no audit — it is a culling plot
   or a transplanting plot. The reason rides in the same field, appended
   to the sentinel ('No Audit Required — Culling Plot'), so no column has
   to be added and every record written before this still reads as
   declined. Records from then carry no reason and simply show none. */
const NO_AUDIT_REASONS = ['Culling Plot','Transplanting Plot'];
function isNoAuditRequired(r){
  return !!r && String(r.ulat||'').indexOf(NO_AUDIT_SENTINEL) === 0
             && String(r.warna||'').indexOf(NO_AUDIT_SENTINEL) === 0;
}
function noAuditReason(r){
  const m = String((r&&r.ulat)||'').split('—')[1];
  return m ? m.trim() : '';
}
window.isNoAuditRequired = isNoAuditRequired;
window.noAuditReason = noAuditReason;

/* Decline flow — one tap on the form's NO AUDIT REQUIRED button:
   fills formState with the sentinel values, shows the "who + when"
   confirmation panel, disables every other field, and lets the auditor
   press Save to write the record. The user's own name is captured from
   localStorage.mjm_user (the same field auditor_name uses elsewhere). */
function declineAudit(reason){
  const u = (function(){ try { return JSON.parse(localStorage.getItem('mjm_user')||'{}'); } catch(e){ return {}; } })();
  const who = u.name || u.email || 'Auditor';
  const why = NO_AUDIT_REASONS.indexOf(reason) !== -1 ? reason : '';
  const stamp = why ? NO_AUDIT_SENTINEL + ' — ' + why : NO_AUDIT_SENTINEL;
  formState.ulat   = stamp;
  formState.tikus  = stamp;
  formState.bintik = stamp;
  formState.warna  = stamp;
  formState.photo1 = null;
  formState.photo2 = null;

  // Reveal the confirmation panel + hide the decline button so it can't
  // be tapped again. Stamp the "by <name> · <when>" line at the same time.
  const btn  = document.getElementById('no-audit-choices'); if (btn) btn.style.display = 'none';
  const note = document.getElementById('no-audit-note');  if (note) note.style.display = '';
  const nr   = document.getElementById('no-audit-reason');if (nr)   nr.textContent = why || NO_AUDIT_SENTINEL;
  const nb   = document.getElementById('no-audit-by');    if (nb)   nb.textContent = who;
  const nw   = document.getElementById('no-audit-when');  if (nw)   nw.textContent = new Date().toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});

  // Disable every condition control below so it visually reads as
  // 'you don't need to fill this'. The controls stay in the DOM so
  // save-time serialisation still works; they just can't be interacted
  // with. Includes tri-buttons, warna colour swatches, and the two
  // photo slots.
  document.querySelectorAll('.tri-btn, .warna-btn').forEach(b => {
    b.disabled = true;
    b.style.opacity = '.4';
    b.style.pointerEvents = 'none';
  });
  document.querySelectorAll('.photo-slot').forEach(s => {
    s.style.opacity = '.4';
    s.style.pointerEvents = 'none';
  });
  const photoReq = document.getElementById('photo-req-note');
  if (photoReq){ photoReq.classList.remove('error'); photoReq.textContent = 'Not required — this batch is being closed as a ' + (why || 'no-audit') + '.'; }

  showToast('Marked "' + (why || NO_AUDIT_SENTINEL) + '". Tap Save to close this batch.');
}
window.declineAudit = declineAudit;

/* Undo the decline — for when the auditor tapped NO AUDIT REQUIRED by
   mistake. Clears the sentinel out of formState, re-enables every
   field (tri-buttons, warna swatches, photo slots), hides the
   confirmation panel and shows the NO AUDIT REQUIRED button again.
   Photo-slot rendering is untouched — the sample colour buttons keep
   whatever they were on before the mis-tap so a two-tap mistake
   ('decline' → 'undo') doesn't clear a half-filled real audit. */
function undoDeclineAudit(){
  formState.ulat   = null;
  formState.tikus  = null;
  formState.bintik = null;
  formState.warna  = null;
  const btn  = document.getElementById('no-audit-choices'); if (btn) btn.style.display = '';
  const note = document.getElementById('no-audit-note');  if (note) note.style.display = 'none';
  document.querySelectorAll('.tri-btn, .warna-btn').forEach(b => {
    b.disabled = false;
    b.style.opacity = '';
    b.style.pointerEvents = '';
    b.classList.remove('sel-b','sel-s','sel-t','sel-ok','sel-warn','sel-bad','active');
  });
  document.querySelectorAll('.photo-slot').forEach(s => {
    s.style.opacity = '';
    s.style.pointerEvents = '';
  });
  const photoReq = document.getElementById('photo-req-note');
  if (photoReq){ photoReq.classList.remove('error'); photoReq.textContent = t('photo_req'); }
  showToast('Undone. Fill in the audit, or name the plot type again.');
}
window.undoDeclineAudit = undoDeclineAudit;

async function saveRecord(){
  const plot=document.getElementById('f-plot').value;
  const batch=document.getElementById('f-batch').value.trim();
  if(!plot)           {showToast(t('err_select_plot'));return;}
  if(!byPlot() && !batch){showToast(t('err_batch'));return;}
  // "No Audit Required" bypasses the four measurement + two-photo
  // requirements — the whole point is that the auditor is closing out
  // a batch without checking it. All four fields carry NO_AUDIT_SENTINEL,
  // set by declineAudit(). Everything else on the payload (audit_id,
  // date, auditor_name) is captured the same way as a normal save.
  const declined = isNoAuditRequired({ulat:formState.ulat, warna:formState.warna});
  if (!declined) {
    if(!formState.ulat) {showToast(t('err_pest'));return;}
    if(!formState.tikus){showToast(t('err_animal'));return;}
    if(!formState.bintik){showToast(t('err_disease'));return;}
    if(!formState.warna){showToast(t('err_leaf'));return;}
    if(!formState.photo1||!formState.photo2){
      const note=document.getElementById('photo-req-note');
      if(note){note.classList.add('error');note.textContent=t('photo_both_req');}
      showToast(t('photo_both_req'));return;
    }
  }
  setLoading(true);
  try{
    const payload={
      nursery:formState.nursery,plot,batch:batch||null,
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
  // FAB was removed from the page but a stub is kept so this binding
  // still succeeds without a null-check. If a future refactor drops
  // the stub too, the ?. means the whole init doesn't die.
  document.getElementById('fab')?.addEventListener('click',openAddForm);
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
  // Hide out-of-scope tabs AND rewrite grid-template-columns so the
  // remaining tabs stretch evenly across the row. Without the rewrite,
  // MN scope leaves the three kept buttons pinned to whichever grid
  // columns they had (empty space where PN used to sit). Matches how
  // Papan and Maintenance already do it.
  const _bar = document.querySelector('.bottom-tabs');
  let _kept = 0;
  document.querySelectorAll('.bottom-tabs .tab-item').forEach(function(b){
    if (_SCOPE.indexOf(b.dataset.n) === -1) b.style.display = 'none';
    else _kept++;
  });
  if (_bar && _kept > 1) _bar.style.gridTemplateColumns = 'repeat(' + _kept + ',1fr)';
  // PN scope only has one nursery — the tab bar is redundant and just
  // shows a lonely PN chip with empty space next to it. Hide it and
  // drop --tab-h to 0 so the page reclaims the space and the toast /
  // FAB positions collapse back to the bottom edge.
  if (_SCOPE.length <= 1) {
    if (_bar) _bar.style.display = 'none';
    document.documentElement.style.setProperty('--tab-h', '0px');
  }
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
  /* ?plot=<code> on top of ?nursery= opens that plot's batch list
     straight away — the portal's pending-plot circles link here, and
     landing on the grid would make the auditor find in fifty-two icons
     the plot they just tapped. After loadRecords(), because the detail
     is built from the records it fetches. */
  loadRecords().then(() => {
    MJMAuditDeepLink.openPlot(NURSERY_PLOTS[activeTab] || [], openPlotDetail);
  });
}
document.addEventListener('DOMContentLoaded',init);