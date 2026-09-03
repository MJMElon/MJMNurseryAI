/* ═══════════════════════════════════════════════════
   MJM NURSERY AI — MAINTENANCE SYSTEM  v2.1
   script.js  ·  MJM Nursery Sdn Bhd (663951-U)
═══════════════════════════════════════════════════ */

/* ════════════════════════════
   CONSTANTS
════════════════════════════ */
const NURSERY_PLOTS = {
  PN:   ['P01','P02','P03','P04','P05','P06','P07','P08','P09','P10',
         'P11','P12','P13','P14','P15','P16','P17','P18','P19','P20',
         'P21','P22','P23','P24','P25','P26','P27','P28','P29','P30',
         'P31','P32','P33','P34','P35','P36','P37','P38','P39','P40',
         'P41','P42','P43','P44','P45','P46','P47','P48','P49','P50',
         'P51','P52'],
  BNN:  ['B1','B2','B3','B4','B5','B6','B7',
         'B8','B9','B10','B11','B12','B13','B14'],
  UNN1: ['U1','U2','U3','U4','U5','U6','U7','U8','U9',
         'U10','U11','U12','U13','U14','U15','U16','U17','U18'],
  UNN2: ['N1','N2','N3','N4','N5','N6','N7','N8','N9','N10',
         'N11','N12','N13','N14','N15','N16','N17','N18','N19','N20']
};
const NURSERY_LABELS = {
  PN:   'PN — Pre Nursery',
  BNN:  'BNN — Batu Niah Nursery',
  UNN1: 'UNN 1 — Ulu Niah Nursery 1',
  UNN2: 'UNN 2 — Ulu Niah Nursery 2'
};
/* The code as it is WRITTEN, for the places that show it on its own — the
   nursery circles across the top and the pill beside them. NURSERY_LABELS
   already spells "UNN 1"; those spots were printing the stored code, so one
   screen said UNN 1 and the next said UNN1 for the same nursery.

   Display only. UNN1 without the space is what the column holds and what
   every record, plot map and report is keyed by — nothing here changes
   that, and nothing here may. */
const NURSERY_SHORT = {
  PN: 'PN', BNN: 'BNN', UNN1: 'UNN 1', UNN2: 'UNN 2'
};
const nurseryShort = n => NURSERY_SHORT[n] || n;

/* Plain nursery name (no code prefix) for the big page header:
   "Batu Niah Nursery — Apr 2026". */
const NURSERY_NAMES = {
  PN: 'Pre Nursery', BNN: 'Batu Niah Nursery',
  UNN1: 'Ulu Niah Nursery 1', UNN2: 'Ulu Niah Nursery 2'
};

/* Default seedling quantity per plot — used for max chemical usage calculation.
   User-edited values override these defaults (held in memory this session). */
const DEFAULT_PLOT_QTY = {
  PN: {},
  BNN: { B1:2352, B2:3152, B3:5655, B4:2933, B5:6924, B6:7408, B7:3018,
         B8:5302, B9:2716, B10:7146, B11:12121, B12:2398, B13:3662, B14:3536 },
  UNN1: { U1:4647, U2:5088, U3:6429, U4:4374, U5:3378, U6:8062, U7:6984,
          U8:6689, U9:3970, U10:3808, U11:6159, U12:7503, U13:5931, U14:5857,
          U15:5601, U16:2902, U17:6885, U18:7794 },
  UNN2: { N1:5844, N2:5634, N3:6492, N4:6066, N5:4764, N6:4876, N7:7518,
          N8:7409, N9:5692, N10:5324, N11:4940, N12:3855, N13:1680, N14:5271,
          N15:3860, N16:5767, N17:4834, N18:2897, N19:6590, N20:2491 }
};
/* Plot-qty overrides — in-memory only (localStorage removed; Supabase pending).
   Shape: { nursery: { plot: qty } }. See PERSISTENCE LAYER below. */
let plotQtyOverrides = {};
function getPlotQtyOverrides(){ return plotQtyOverrides; }
function getPlotQty(n, p){
  const ov = plotQtyOverrides;
  if (ov[n]?.[p] !== undefined && ov[n][p] !== null) return +ov[n][p] || 0;
  return DEFAULT_PLOT_QTY[n]?.[p] || 0;
}
function setPlotQty(n, p, v){
  if (!plotQtyOverrides[n]) plotQtyOverrides[n] = {};
  plotQtyOverrides[n][p] = Math.max(0, +v || 0);
  if (_supabase) {
    _supabase.from('nops_maint_plot_qty')
      .upsert({ nursery: n, plot: p, qty: plotQtyOverrides[n][p], updated_at: new Date().toISOString() }, { onConflict: 'nursery,plot' })
      .then(({ error }) => { if (error) console.warn('[maint] plot-qty save failed:', error.message); });
  }
}
function resetPlotQty(n){
  delete plotQtyOverrides[n];
  if (_supabase) {
    _supabase.from('nops_maint_plot_qty').delete().eq('nursery', n)
      .then(({ error }) => { if (error) console.warn('[maint] plot-qty reset failed:', error.message); });
  }
}
/* The fallback until nops_maint_config is read, and the number the whole
   system has always sprayed to. The live figure is `pumpCoverage`, preset on
   the Setting page; a chemical with a coverage of its own overrides both. */
const COVERAGE_PER_PUMP = 800;

function fmtUsage(totalAmount, unit, decimals = 2){
  // gm → kg, mL → L; default 2 decimals (no round-up)
  const big = totalAmount / 1000;
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(big * factor) / factor;
  return rounded + (unit === 'gm' ? ' kg' : ' L');
}
/* Unit per chemical — used to auto-set mL/gm when one is selected. Reads
   the list; a fertiliser answers too, since the manuring sheet asks the same
   question of a fertiliser name. */
function getUnitForChem(name){
  const c = chemByName(name) || fertByName(name);
  return (c && c.unit) || 'gm';
}

function calcMaxChem(seedlings, chemName, dose, unit, decimals = 2){
  if(!seedlings || !chemName || chemName === '—' || !dose) return '—';
  // Formula: (plot capacity / coverage per pump) × dose per pump / 1000.
  // The chemical's own coverage when it has one, the preset when it does not
  // — the same rule the Setting page shows.
  const totalUnits = (seedlings / coverageFor(chemName)) * dose;
  return fmtUsage(totalUnits, unit, decimals);
}
function sumSeedlings(nursery, plots, ticked){
  return plots.filter(p => ticked(p)).reduce((s,p) => s + getPlotQty(nursery, p), 0);
}
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* Chemical option lists — only chemicals MJM Nursery uses. Names only; dose set separately. */

/* Loaded from nops_maint_chemicals / nops_maint_fertilisers / nops_maint_config
   by loadSettingLists(). Declared here rather than beside the Setting tab at
   the foot of the file because the calculators and the schedules read them,
   and a `let` further down would leave those in the temporal dead zone. */
let chemicals   = [];
let fertilisers = [];
let pumpCoverage = 800;   // COVERAGE_PER_PUMP; the preset overrides it

/* Stock Management's own nursery and plot list, filled by loadSharedPlots().
   Up here for the same reason and a sharper one: applyLang() calls renderAll()
   while this file is still being evaluated, and the Monthly Scheduled Work
   summary reads these — a `let` beside the Setting tab put them in the
   temporal dead zone, which took the rest of the file down with it.
   `typeof x !== 'undefined'` does NOT guard against that; it throws too. */
let stockNurseries = [];   // names, in Stock Management's own order
let stockPlots     = {};   // { nursery name: [plot, ...] }

/* The Monthly Scheduled Work summary's own state, up here for the same
   reason. WORKS and the two open-popup handles are read by renderSchedSummary,
   which renderAll calls. */
const WORKS = [
  { key:'pd',       label:'P & D Spray'    },
  { key:'manuring', label:'Manuring'       },
  { key:'weeding',  label:'Weeding'        },
  { key:'interrow', label:'Interrow Spray' }
];
let _expanded = {};      // { "nursery|kind": true } — which summary rows are open
let _we       = null;    // the work editor: { n, kind, week, round }
let _weekPick = null;    // the week-dates popover: { n, k }
/* &#9998; renders as a paperclip in some system fonts — it did in the Nelos
   dock, on the same button. An inline path cannot be substituted. */
const PENCIL_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

/* Every one of these lists is typed in by a person, and every one of them is
   printed straight back into innerHTML. A plot called B<img onerror=…> is
   unlikely; a fertiliser name with an ampersand in it is not. Defined up
   here because the schedule dropdowns below use it. */
const esc = v => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ── One source for the chemicals and the fertilisers ──────────────────
   These were two hardcoded catalogues — CHEMICAL_CATEGORIES and
   FERTILIZER_INFO — which the Setting page could not edit and the
   calculators read straight from. Both are gone. Everything now reads
   `chemicals` and `fertilisers`, loaded from nops_maint_chemicals and
   nops_maint_fertilisers, so a dose corrected on the Setting page is the
   dose the calculator and the schedules use.

   Every lookup below has to survive the arrays being empty. They are, until
   the first read lands, and a page that throws before its data arrives is
   worse than one that shows a blank dropdown for a moment. */
const fertByName = n => fertilisers.find(f => f.name === n) || null;
/* What one pump of this chemical covers: its own figure when it has one,
   the preset when it does not. Same rule the Setting page shows, and the
   only place the arithmetic lives now. */
function coverageFor(name) {
  const c = chemByName(name);
  const own = c && c.coverage != null && c.coverage !== '' ? +c.coverage : 0;
  return Math.max(1, own || +pumpCoverage || COVERAGE_PER_PUMP);
}
const chemByName = n => chemicals.find(c => c.name === n) || null;

/* Names for a dropdown. The trailing '—' is how every one of these lists has
   always offered "none"; it stays. */
const chemNames = kind => chemicals.filter(c => c.kind === kind).map(c => c.name).concat('—');
const taggedNames = tag => chemicals.filter(c => c.tag === tag).map(c => c.name).concat('—');
/* With no usage, every fertiliser — which is what the calculator wants,
   since it is asked about both kinds of work. With one, only the fertilisers
   ticked for it: the Manuring sheet is monthly manuring, and offering a
   transplanting-only fertiliser there is offering a rate that does not
   exist. That is what the ticks are for. */
const fertNames = usage => fertilisers
  .filter(f => !usage || (usage === 'transplant' ? f.dose_transplant : f.dose_monthly) != null)
  .map(f => f.name).concat('—');

/* A fertiliser's dose for the work being done. Transplanting when that is
   what is being planned, monthly otherwise, and whichever one is set when
   only one is. */
function fertDoseFor(name, usage) {
  const f = fertByName(name);
  if (!f) return 0;
  const first = usage === 'transplant' ? f.dose_transplant : f.dose_monthly;
  const other = usage === 'transplant' ? f.dose_monthly : f.dose_transplant;
  return +(first != null ? first : other != null ? other : 0) || 0;
}

function calcFertUsage(seedlings, fertName, doseGm, decimals = 2){
  if (!seedlings || !fertName || fertName === '—' || !doseGm) return { kg:'—', bags:'—', totalGm:0 };
  const f = fertByName(fertName);
  const info = f && f.bag_size_gm ? { bagSizeGm: +f.bag_size_gm, bagLabel: f.bag_label || '' } : null;
  const totalGm = seedlings * doseGm;
  const totalKg = totalGm / 1000;
  const factor = Math.pow(10, decimals);
  const kgStr = (Math.round(totalKg * factor) / factor).toLocaleString() + ' kg';
  const bagsStr = info ? (Math.round((totalGm / info.bagSizeGm) * factor) / factor) + ' ' + t('unit.bags') + ' (' + info.bagLabel + ' ' + t('unit.each') + ')' : '—';
  return { kg: kgStr, bags: bagsStr, totalGm };
}

/* ════════════════════════════
   DEFAULT CONFIGS
════════════════════════════ */
function defaultPDConfig() {
  const stickerOn  = { sticker:'Bond', sticker_dose:15, sticker_unit:'mL' };
  const stickerOff = { sticker:'—',    sticker_dose:0,  sticker_unit:'mL' };
  const mk = (P, D) => ({
    P:P.name, P_dose:P.dose, P_unit:P.unit,
    P_sticker: (P.sticker||stickerOff).sticker,
    P_sticker_dose: (P.sticker||stickerOff).sticker_dose,
    P_sticker_unit: (P.sticker||stickerOff).sticker_unit,
    D:D.name, D_dose:D.dose, D_unit:D.unit,
    D_sticker: (D.sticker||stickerOff).sticker,
    D_sticker_dose: (D.sticker||stickerOff).sticker_dose,
    D_sticker_unit: (D.sticker||stickerOff).sticker_unit,
  });
  return {
    W1: mk({name:'Asir',dose:5,unit:'gm',sticker:stickerOff}, {name:'Antracol',dose:30,unit:'gm',sticker:stickerOn}),
    W2: mk({name:'—',   dose:0,unit:'mL',sticker:stickerOff}, {name:'Thiram',  dose:30,unit:'gm',sticker:stickerOn}),
    W3: mk({name:'—',   dose:0,unit:'mL',sticker:stickerOff}, {name:'Manzate', dose:30,unit:'gm',sticker:stickerOn}),
    W4: mk({name:'—',   dose:0,unit:'mL',sticker:stickerOff}, {name:'Daconil', dose:30,unit:'gm',sticker:stickerOn}),
  };
}
/* One fertiliser to start with, and + in the week's header adds another.
   The default is one because most weeks are one feed and a column nobody
   needs is a column somebody has to read past — not because a week cannot
   be two. An array of rounds each holding an array of columns, which is
   also how the ticks are stored. */
function defaultManuringConfig() {
  return [ [ { name:'Yaramila', dose:20, unit:'gm' } ] ];
}

/* There WAS a migration here that collapsed every manuring round back to one
   fertiliser, dropping the ticks on any second or third. It ran on every
   load, so a week fed two things was quietly reduced to one — which is the
   right behaviour for exactly as long as "a week is one feed" is true, and
   the nursery says it is not: Yaramila on some plots and organic matter on
   others inside the same seven days is an ordinary week.

   It is gone rather than switched off, because a migration nobody wants that
   runs on every load is one edit away from eating the schedule again. The
   payload has always been [round][column] and every reader — the work
   records, the PDF, the summary counts, both phone apps — already walks the
   columns. Nothing had to change but this. */

/* Migrate old flat manuringConfig (and manuring ticks) to the new nested rounds shape */
function migrateManuringShape(s, plots) {
  if (!s || !s.manuringConfig || s.manuringConfig.length === 0) return;
  if (!Array.isArray(s.manuringConfig[0])) {
    s.manuringConfig = [s.manuringConfig];
    plots.forEach(p => {
      const v = s.manuring?.[p];
      if (Array.isArray(v) && (v.length === 0 || typeof v[0] === 'boolean')) {
        s.manuring[p] = [v];
      }
    });
  }
}
function defaultInterrowConfig() {
  // Nested: array of rounds → each round is an array of chemical columns
  return [
    [{ chem:'Monex', chem_dose:200, chem_unit:'mL', activator_dose:15, activator_unit:'mL' }],
    [{ chem:'Basta', chem_dose:200, chem_unit:'mL', activator_dose:15, activator_unit:'mL' }],
  ];
}
/* Migrate old { R1:{...}, R2:{...} } interrowConfig (and interrow ticks) to nested rounds shape */
function migrateInterrowShape(s, plots) {
  if (!s || !s.interrowConfig || Array.isArray(s.interrowConfig)) return;
  const keys = Object.keys(s.interrowConfig).sort();
  s.interrowConfig = keys.map(k => [s.interrowConfig[k]]);
  plots.forEach(p => {
    const v = s.interrow?.[p];
    if (v && !Array.isArray(v)) s.interrow[p] = keys.map(k => [!!v[k]]);
  });
}

/* ════════════════════════════
   STATE
════════════════════════════ */
let appState       = {};

/* ── Supabase (shared MJM AI database; tables prefixed nops_maint_) ──
   Loaded via ../shared/shared_supabase.js in nursery_ops_maintenance.html. */
const _supabase = (typeof supabase !== 'undefined' && typeof SHARED_SUPA_URL !== 'undefined')
  ? supabase.createClient(SHARED_SUPA_URL, SHARED_SUPA_KEY)
  : null;
let dbStateCache = {};   // `${nursery}_${month}` → saved schedule payload
/* Admin of the "Nursery Operation Manage" module in User Access.
   Only admins may edit a record once it has been marked Checked. */
let isNopsAdmin = false;
/* Plots added by the user via a schedule's "Add Row" (or Setting).
   Persisted in nops_maint_custom_plots and merged into NURSERY_PLOTS on load,
   so every existing renderer picks them up with no other changes. */
let customPlots = { PN: [], BNN: [], UNN1: [], UNN2: [] };

function _mergeCustomPlots() {
  Object.keys(customPlots).forEach(n => {
    if (!NURSERY_PLOTS[n]) return;
    customPlots[n].forEach(p => { if (!NURSERY_PLOTS[n].includes(p)) NURSERY_PLOTS[n].push(p); });
  });
}

/* Blank inline row: the user keys the plot name themselves. */
function openAddPlotRow() {
  const n = getNursery();
  const name = (prompt(`Add a row to ${NURSERY_NAMES[n]} — key in the plot name:`, '') || '').trim().toUpperCase();
  if (!name) return;
  addCustomPlot(n, name);
}

function addCustomPlot(n, name) {
  if (!name) return;
  if (NURSERY_PLOTS[n] && NURSERY_PLOTS[n].includes(name)) { alert(`Plot "${name}" already exists in this nursery.`); return; }
  if (!customPlots[n]) customPlots[n] = [];
  customPlots[n].push(name);
  if (NURSERY_PLOTS[n]) NURSERY_PLOTS[n].push(name);
  persistCustomPlot(n, name, false);
  renderAll(); autoSyncRecords();
}

function removeCustomPlot(n, name) {
  if (!confirm(`Remove plot "${name}" from ${NURSERY_NAMES[n]}?\n\nIts row disappears from all four schedules. Saved work records for it are kept.`)) return;
  customPlots[n] = (customPlots[n] || []).filter(p => p !== name);
  if (NURSERY_PLOTS[n]) {
    const i = NURSERY_PLOTS[n].indexOf(name);
    if (i >= 0) NURSERY_PLOTS[n].splice(i, 1);
  }
  persistCustomPlot(n, name, true);
  renderAll(); autoSyncRecords();
}

function persistCustomPlot(n, name, remove) {
  if (!_supabase) return;
  const q = remove
    ? _supabase.from('nops_maint_custom_plots').delete().eq('nursery', n).eq('plot', name)
    : _supabase.from('nops_maint_custom_plots').upsert({ nursery: n, plot: name }, { onConflict: 'nursery,plot' });
  q.then(({ error }) => { if (error) console.warn('[maint] custom plot save failed:', error.message); });
}


/* ════════════════════════════
   MONTHLY PAYROLL — Borang Tuntutan Gaji
   One sub-tab per work type. Rows come from the work records for the
   current nursery+month; worker columns come from Setting → Workers and
   the rate from Setting → Piece Rate. Cell values are the capacity each
   worker covered, stored per (nursery, month, work type).
════════════════════════════ */
const PAYROLL_TYPES = {
  pd:       { jenis: 'Penyemburan racun kulat dan serangga', label: 'jenis.pd',       unit: 'Beg' },
  manuring: { jenis: 'Membaja',                              label: 'jenis.manuring', unit: 'Beg' },
  weeding:  { jenis: 'Merumput',                             label: 'jenis.weeding',  unit: 'Beg' },
  interrow: { jenis: 'Meracun rumput secara selingan',       label: 'jenis.interrow', unit: 'Beg' }
};
let _payrollView = 'pd';
let payrollData  = {};   // `${nursery}_${month}_${type}` → { recId: { worker: qty } }
let _payrollSaveTimer = null;
/* `${nursery}_${month}` → names the field credited that matched no column on
   that sheet. Filled by applyFieldRecords, shown by renderPayroll. Not saved:
   it is a fact about the last sync, not about the month. */
let _fieldUnmatched = {};

function payrollKey(n, m, type) { return `${n}_${m}_${type}`; }

function switchPayrollView(type, btn) {
  _payrollView = type;
  const bar = btn ? btn.closest('.subtabs-bar') : null;
  if (bar) bar.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderPayroll();
}

function payrollRowsFor(type) {
  const n = getNursery();
  const plots = NURSERY_PLOTS[n] || [];
  const jenis = PAYROLL_TYPES[type].jenis;
  return records
    .filter(r => r.jenis === jenis && plots.includes(r.plot))
    .sort((a, b) => plots.indexOf(a.plot) - plots.indexOf(b.plot));
}
function payrollRows() { return payrollRowsFor(_payrollView); }

/* Capacity each worker earned on one work type: every ticked row hands its
   plot capacity out equally among the workers ticked on it. Same arithmetic
   the on-screen table uses, pulled out so the PDF can run it for all four
   work types at once. */
function payrollTotalsFor(type) {
  const n = getNursery(), m = getMonth();
  const wk = workers[n] || [];
  const store = payrollData[payrollKey(n, m, type)] || {};
  const perWorker = {}; wk.forEach(w => perWorker[w] = 0);
  let capTotal = 0;
  payrollRowsFor(type).forEach(r => {
    const cells = store[r.id] || {};
    const cap = recQty(r).value || 0;
    capTotal += cap;
    const ticked = wk.filter(w => cells[w]);
    if (!ticked.length) return;
    const share = cap / ticked.length;
    ticked.forEach(w => { perWorker[w] += share; });
  });
  return { perWorker, capTotal };
}

function renderPayroll() {
  const tbl = document.getElementById('payroll-table');
  if (!tbl) return;
  const n = getNursery(), m = getMonth();
  const cfg = PAYROLL_TYPES[_payrollView];
  const line = document.getElementById('payroll-form-line');
  if (line) line.textContent = `${t('pay.form')} (${NURSERY_NAMES[n]}) — ${t('pay.month')} ${m}`;
  const hint = document.getElementById('payroll-hint');
  if (hint) hint.textContent = t('pay.tickHint') + (isLinked(n) ? ' ' + t('pay.linkedNote') : '');

  const wk = workers[n] || [];
  const rows = payrollRows();
  const store = payrollData[payrollKey(n, m, _payrollView)] || {};

  /* Somebody ticked this month who is no longer a general worker of this
     nursery — renamed, moved or deactivated on the register. Their ticks are
     still in the database but no longer have a column, so their capacity has
     dropped out of the totals. Say so rather than let a figure change
     silently. */
  const off = document.getElementById('payroll-offreg');
  if (off) {
    const known = new Set(wk);
    const gone = [...new Set(Object.values(store).flatMap(c =>
      Object.keys(c || {}).filter(name => c[name] && !known.has(name))))].sort();
    /* And the other direction: a name the FIELD credited that never found a
       column, so there was no tick to lose in the first place. See
       applyFieldRecords — it is a worker's share of a plot going missing, and
       it belongs on the sheet the share was supposed to land on. */
    const nofit = (_fieldUnmatched[`${n}_${m}`] || []).filter((x) => !known.has(x));
    const lines = [];
    if (gone.length)  lines.push(`${t('pay.offRegister')} ${gone.join(', ')}`);
    if (nofit.length) lines.push(`${t('pay.fieldNoColumn')} ${nofit.join(', ')}`);
    off.style.display = lines.length ? 'block' : 'none';
    off.textContent = lines.join('\n');
    off.style.whiteSpace = 'pre-line';
  }

  if (!wk.length) {
    tbl.innerHTML = `<tbody><tr><td style="padding:2rem;text-align:center;color:var(--text-faint);font-size:13px;">${t('pay.noWorkers')}</td></tr></tbody>`;
    return;
  }

  // Column headers are capped at their own width so a long label (a worker's
  // full name, "Capacity per worker") wraps onto a second line instead of
  // stretching the column — the table is width:max-content, so without the
  // cap the widest header decides the column width.
  const payTh = (txt, w, cls) =>
    `<th class="${cls || ''}" style="min-width:${w}px;"><div class="th-wrap" style="max-width:${w}px;">${txt}</div></th>`;
  let h = `<thead>
    <tr><th class="wk-th" colspan="${3 + wk.length + 1}">${t(cfg.label)}</th></tr>
    <tr>
      ${payTh(t('pay.date'), 92)}
      ${payTh(t('pay.plot'), 64)}
      ${payTh(t('pay.plotCap'), 108)}
      ${wk.map(w => payTh(w, 108)).join('')}
      ${payTh(t('pay.perWorker'), 112)}
    </tr></thead><tbody>`;

  const totals = {}; wk.forEach(w => totals[w] = 0);   // capacity earned per worker
  let capTotal = 0;

  if (!rows.length) {
    h += `<tr><td colspan="${3 + wk.length + 1}" style="padding:1.6rem;text-align:center;color:var(--text-faint);">${t('pay.noRows')}</td></tr>`;
  } else {
    rows.forEach(r => {
      const cells = store[r.id] || {};
      // Date and plot capacity come straight from the work record.
      // Plot capacity follows the record's Quantity, linked or keyed.
      const cap    = recQty(r).value || 0;
      const ticked = wk.filter(w => cells[w]);
      const share  = ticked.length ? cap / ticked.length : 0;   // capacity ÷ ticks
      ticked.forEach(w => { totals[w] += share; });
      capTotal += cap;
      h += `<tr>
        <td style="font-weight:600;white-space:nowrap;">${_tarikhDisplay(r.tarikh)}</td>
        <td class="plot-td">${r.plot}</td>
        <td>${cap ? cap.toLocaleString() : '—'}</td>
        ${wk.map(w => `<td class="check-td${cells[w] ? ' ticked' : ''}" onclick="togglePayrollTick(${r.id},'${String(w).replace(/'/g, "\\'")}')" title="${w}"></td>`).join('')}
        <td style="font-weight:700;">${share ? Math.round(share).toLocaleString() : '—'}</td>
      </tr>`;
    });
  }

  // Total capacity = the sum of every worker's earned capacity.
  const grand = wk.reduce((sum, w) => sum + totals[w], 0);
  // Capacity only. Money lives in the Nursery Payroll System, which reads
  // this record and prices it — keeping one sheet for what was done and
  // another for what it pays.
  h += `</tbody><tfoot>
    <tr class="jumlah-tr">
      <td class="th-left">${t('pay.totalCap')}</td><td></td>
      <td>${capTotal ? capTotal.toLocaleString() : '—'}</td>
      ${wk.map(w => `<td>${Math.round(totals[w]).toLocaleString()}</td>`).join('')}
      <td>${Math.round(grand).toLocaleString()}</td></tr>
  </tfoot>`;
  tbl.innerHTML = h;
}

/* Tick / untick a worker on a payroll row. */
function togglePayrollTick(recId, worker) {
  const n = getNursery(), m = getMonth();
  const k = payrollKey(n, m, _payrollView);
  if (!payrollData[k]) payrollData[k] = {};
  if (!payrollData[k][recId]) payrollData[k][recId] = {};
  if (payrollData[k][recId][worker]) delete payrollData[k][recId][worker];
  else payrollData[k][recId][worker] = 1;
  renderPayroll();
  persistPayroll(n, m, _payrollView);
}

function persistPayroll(n, m, type) {
  if (!_supabase || !_dbReady) return;
  clearTimeout(_payrollSaveTimer);
  _payrollSaveTimer = setTimeout(() => {
    _supabase.from('nops_maint_payroll')
      .upsert({ nursery: n, month: m, work_type: type,
                data: payrollData[payrollKey(n, m, type)] || {},
                updated_at: new Date().toISOString() }, { onConflict: 'nursery,month,work_type' })
      .then(({ error }) => { if (error) console.warn('[maint] payroll save failed:', error.message); });
  }, 400);
}

/* Print a piece rate at its real precision. Forcing 2 decimals showed a rate
   of 0.015 as "0.01" while the money column was still worked out from 0.015,
   so the form appeared not to add up. */
function _fmtRate(r) {
  const n = Number(r);
  for (let d = 2; d <= 4; d++) {
    if (Math.abs(n - Number(n.toFixed(d))) < 1e-9) return n.toFixed(d);
  }
  return n.toFixed(4);
}

/* ── Worker Record ────────────────────────────────────────────────────────
   The four sheets exactly as they appear on screen — P & D Spraying,
   Manuring, Weeding and Interrow Spraying — one table per work type, each
   starting on its own page.

   Portrait A4 with 25 mm margins on all four sides. That leaves 160 mm for a
   tick grid of three fixed columns plus one per worker, so a worker column
   lands around 9 mm — wide enough for a tick, far too narrow for a name
   across it. The worker names are therefore set vertically in the header,
   which is how a piece-rate tick sheet is normally printed and keeps every
   name legible at full size. Past ten workers the sheet splits across further
   pages with the Date / Plot / Capacity columns repeated, rather than
   squeezing the columns until they are useless.

   Capacity only — no money. Pay is worked out in the Nursery Payroll System,
   which reads this same record. */
function downloadPayrollPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297, MARGIN = 25;
  const CONTENT_W = PW - MARGIN * 2;      // 160 mm
  const MID = PW / 2;

  const n = getNursery(), m = getMonth();
  const wk = workers[n] || [];
  const TYPES = ['pd', 'manuring', 'weeding', 'interrow'];

  if (!wk.length) {
    alert(t('pay.noWorkers'));
    return;
  }

  const HEAD_FILL = [232, 240, 235], TOTAL_FILL = [219, 236, 226], ZEBRA = [250, 252, 251];

  /* One bordered cell, centred both ways, shrunk to fit.
     nowrap keeps a number on one line — "1,200" broken as "1,20" / "0" reads
     as a different figure. */
  function cell(x, y, w, h, text, opt) {
    const o = Object.assign({ bold: false, size: 9, fill: null, nowrap: false, wordSafe: false, align: 'center' }, opt || {});
    if (o.fill) { doc.setFillColor(o.fill[0], o.fill[1], o.fill[2]); doc.rect(x, y, w, h, 'F'); }
    doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.2);
    doc.rect(x, y, w, h);
    const str = String(text ?? '');
    if (!str) return;
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    doc.setTextColor(0, 0, 0);
    let size = o.size, lines;
    if (o.nowrap) {
      for (;;) { doc.setFontSize(size); if (doc.getTextWidth(str) <= w - 1.8 || size <= 4) break; size -= 0.25; }
      lines = [str];
    } else {
      // Shrink first so no single word is wider than the cell — otherwise a
      // name like "Muhammad" gets split as "Muhamma" / "d", which reads as a
      // different name. Only then wrap at spaces and fit the height.
      if (o.wordSafe) {
        const words = str.split(/\s+/).filter(Boolean);
        for (;;) {
          doc.setFontSize(size);
          const widest = words.reduce((mx, wd) => Math.max(mx, doc.getTextWidth(wd)), 0);
          if (widest <= w - 2.6 || size <= 4) break;
          size -= 0.25;
        }
      }
      for (;;) {
        doc.setFontSize(size);
        lines = doc.splitTextToSize(str, w - 2.6);
        if (lines.length * size * 0.3528 * 1.15 <= h - 1.4 || size <= 4.5) break;
        size -= 0.3;
      }
    }
    doc.setFontSize(size);
    const lh = size * 0.3528 * 1.15;
    let ty = y + (h - lines.length * lh) / 2 + lh * 0.78;
    lines.forEach(ln => {
      const tx = o.align === 'left' ? x + 2 : x + w / 2;
      doc.text(ln, tx, ty, { align: o.align === 'left' ? 'left' : 'center' });
      ty += lh;
    });
  }

  /* A tick, drawn rather than typed so it renders in every viewer. */
  function drawTick(x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h) * 0.42;
    doc.setDrawColor(13, 122, 71); doc.setLineWidth(0.7);
    doc.line(cx - s * 0.55, cy + s * 0.05, cx - s * 0.1, cy + s * 0.42);
    doc.line(cx - s * 0.1,  cy + s * 0.42, cx + s * 0.6, cy - s * 0.38);
    doc.setLineWidth(0.2);
  }

  /* A worker-name header, set vertically. A 9 mm column cannot carry a name
     across it, so the text runs bottom-to-top and stays full size. */
  function vHeaderCell(x, y, w, h, text) {
    doc.setFillColor(HEAD_FILL[0], HEAD_FILL[1], HEAD_FILL[2]);
    doc.rect(x, y, w, h, 'F');
    doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.2);
    doc.rect(x, y, w, h);
    const str = String(text ?? ''); if (!str) return;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
    let size = 8.5;
    for (;;) { doc.setFontSize(size); if (doc.getTextWidth(str) <= h - 4 || size <= 5) break; size -= 0.25; }
    doc.setFontSize(size);
    const tw = doc.getTextWidth(str);
    // angle 90 runs the baseline upward from the anchor, so start low and
    // centre the run along the cell height.
    doc.text(str, x + w / 2 + size * 0.3528 * 0.35, y + (h + tw) / 2, { angle: 90 });
  }

  /* The tallest name in a chunk decides the header height. */
  function headerHeightFor(chunk) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    const longest = chunk.reduce((mx, w) => Math.max(mx, doc.getTextWidth(String(w))), 0);
    return Math.max(20, Math.min(46, longest + 6));
  }

  /* Title block at the top of a page. Returns the y to carry on from. */
  function titleBlock(typeLabel, part) {
    let y = MARGIN;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('MEGA JUTAMAS SDN BHD', MID, y + 5, { align: 'center' });
    doc.setFontSize(12);
    doc.text(t('pay.form').toUpperCase(), MID, y + 12, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    doc.text(`${NURSERY_NAMES[n] || n} (${nurseryShort(n)})  ·  ${t('pay.month')} ${m}`, MID, y + 19, { align: 'center' });
    doc.setDrawColor(13, 122, 71); doc.setLineWidth(0.6);
    doc.line(MARGIN, y + 23, PW - MARGIN, y + 23);
    doc.setLineWidth(0.2);
    y += 27;

    // Work-type banner across the full table width.
    doc.setFillColor(8, 92, 51);
    doc.rect(MARGIN, y, CONTENT_W, 9, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(255, 255, 255);
    doc.text(typeLabel + (part ? `  (${part})` : ''), MID, y + 6, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    return y + 9;
  }

  /* Column widths for one chunk of workers. The three fixed columns and the
     per-worker total keep their size; the workers share what is left. */
  const W_DATE = 22, W_PLOT = 13, W_CAP = 21, W_PER = 21;
  const FIXED = W_DATE + W_PLOT + W_CAP + W_PER;   // 77 mm, leaving 83 mm
  const MIN_WK = 8;
  const maxPerPage = Math.max(1, Math.floor((CONTENT_W - FIXED) / MIN_WK));

  // Split the worker list only when it genuinely will not fit.
  const chunks = [];
  for (let i = 0; i < wk.length; i += maxPerPage) chunks.push(wk.slice(i, i + maxPerPage));

  const ROW_H = 8;
  let firstPage = true;

  TYPES.forEach(type => {
    const cfg = PAYROLL_TYPES[type];
    const rows = payrollRowsFor(type);
    const store = payrollData[payrollKey(n, m, type)] || {};

    chunks.forEach((chunk, ci) => {
      if (!firstPage) doc.addPage();
      firstPage = false;

      const part = chunks.length > 1
        ? `${t('pay.workersRange')} ${ci * maxPerPage + 1}–${ci * maxPerPage + chunk.length} ${t('pay.ofTotal')} ${wk.length}`
        : '';
      let y = titleBlock(t(cfg.label), part);

      const wkW  = (CONTENT_W - FIXED) / chunk.length;
      const xs = [];
      let x = MARGIN;
      [W_DATE, W_PLOT, W_CAP, ...chunk.map(() => wkW), W_PER].forEach(w => { xs.push(x); x += w; });
      const widths = [W_DATE, W_PLOT, W_CAP, ...chunk.map(() => wkW), W_PER];
      const iPer = widths.length - 1;

      const HEAD_H = headerHeightFor(chunk);
      const drawHead = () => {
        cell(xs[0], y, widths[0], HEAD_H, t('pay.date'),    { bold: true, size: 8.5, fill: HEAD_FILL });
        cell(xs[1], y, widths[1], HEAD_H, t('pay.plot'),    { bold: true, size: 8.5, fill: HEAD_FILL });
        cell(xs[2], y, widths[2], HEAD_H, t('pay.plotCap'), { bold: true, size: 7.5, fill: HEAD_FILL });
        chunk.forEach((w, i) => vHeaderCell(xs[3 + i], y, widths[3 + i], HEAD_H, w));
        cell(xs[iPer], y, widths[iPer], HEAD_H, t('pay.perWorker'), { bold: true, size: 7.5, fill: HEAD_FILL });
        y += HEAD_H;
      };
      drawHead();

      const totals = {}; chunk.forEach(w => totals[w] = 0);
      let capTotal = 0;

      if (!rows.length) {
        cell(MARGIN, y, CONTENT_W, 14, t('pay.noRows'), { size: 9 });
        y += 14;
      } else {
        rows.forEach((r, ri) => {
          // Reserve room for the total row and the footer note.
          if (y + ROW_H > PH - MARGIN - 26) {
            doc.addPage();
            y = titleBlock(t(cfg.label), part);
            drawHead();
          }
          const cells  = store[r.id] || {};
          const cap    = recQty(r).value || 0;
          // The share is divided among EVERY ticked worker, not just those on
          // this page — splitting the sheet must not change the arithmetic.
          const ticked = wk.filter(w => cells[w]);
          const share  = ticked.length ? cap / ticked.length : 0;
          chunk.forEach(w => { if (cells[w]) totals[w] += share; });
          capTotal += cap;

          const z = ri % 2 ? ZEBRA : null;
          cell(xs[0], y, widths[0], ROW_H, _tarikhDisplay(r.tarikh), { size: 8, nowrap: true, fill: z });
          cell(xs[1], y, widths[1], ROW_H, r.plot,                   { size: 8.5, bold: true, nowrap: true, fill: z });
          cell(xs[2], y, widths[2], ROW_H, cap ? cap.toLocaleString() : '—', { size: 8.5, nowrap: true, fill: z });
          chunk.forEach((w, i) => {
            cell(xs[3 + i], y, widths[3 + i], ROW_H, '', { fill: z });
            if (cells[w]) drawTick(xs[3 + i], y, widths[3 + i], ROW_H);
          });
          cell(xs[iPer], y, widths[iPer], ROW_H, share ? Math.round(share).toLocaleString() : '—',
               { size: 8.5, bold: true, nowrap: true, fill: z });
          y += ROW_H;
        });
      }

      // Total (Capacity) — capacity only, as on screen.
      const grand = chunk.reduce((s, w) => s + totals[w], 0);
      cell(xs[0], y, widths[0] + widths[1], ROW_H + 1, t('pay.totalCap'), { bold: true, size: 8.5, fill: TOTAL_FILL });
      cell(xs[2], y, widths[2], ROW_H + 1, capTotal ? capTotal.toLocaleString() : '—', { bold: true, size: 8.5, nowrap: true, fill: TOTAL_FILL });
      chunk.forEach((w, i) => cell(xs[3 + i], y, widths[3 + i], ROW_H + 1,
        totals[w] ? Math.round(totals[w]).toLocaleString() : '—', { bold: true, size: 8, nowrap: true, fill: TOTAL_FILL }));
      cell(xs[iPer], y, widths[iPer], ROW_H + 1, grand ? Math.round(grand).toLocaleString() : '—',
           { bold: true, size: 8.5, nowrap: true, fill: TOTAL_FILL });
      y += ROW_H + 1;

      doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(110, 110, 110);
      doc.text(t('pay.autoNote'), MID, PH - MARGIN + 6, { align: 'center' });
      doc.setTextColor(0, 0, 0);
    });
  });

  doc.save(`Worker_Record_${n}_${m.replace(/\s+/g, '_')}.pdf`);
}

/* ── Piece rates (one rate card for all nurseries) ── */
const PIECE_RATE_TYPES = [
  { code: 'pd',       key: 'jenis.pd'       },
  { code: 'manuring', key: 'jenis.manuring' },
  { code: 'weeding',  key: 'jenis.weeding'  },
  { code: 'interrow', key: 'jenis.interrow' }
];
/* Piece rates are per nursery — BNN's rates are BNN's alone. There is no month
   dimension, so whatever is set carries forward to every future month until it
   is edited again. */
let pieceRates = { PN: {}, BNN: {}, UNN1: {}, UNN2: {} };

/* Rate card for a nursery, created on first use so a fresh nursery starts blank
   rather than inheriting another nursery's numbers. */
function nurseryRates(n) {
  if (!pieceRates[n]) pieceRates[n] = {};
  return pieceRates[n];
}

/* Rates are locked per nursery once agreed, so a stray keystroke can't quietly
   change what workers get paid. Kept in nops_maint_rate_lock. */
let rateLocks = { PN: false, BNN: false, UNN1: false, UNN2: false };
const rateLocked = n => !!rateLocks[n];
/* Set when the piece-rate table could not be read — almost always because
   migration section 8 (the per-nursery `nursery` column) has not been run.
   Without this the load returned nothing and a missing migration was
   indistinguishable from "no rates saved yet". */
let _rateLoadErr = null;

/* Typing edits a draft, not the live rates — nothing reaches the database or
   the payroll until Save & Lock is pressed. */
/* The boxes that edited these left the Setting tab when piece rates moved
   to their own module. What is below stays because Worker Record still
   computes payroll from `rates`; the draft/save half of it is unreachable
   until the new module wires its own screen to it. */
let _rateDraft = null;   // { nursery, values:{code:number|null} }

/* Re-seed the draft from the saved rates unless the user has actually typed
   into it for this nursery.

   This has to be keyed on "has been touched", not just "same nursery". The
   page renders once at boot (applyLang → renderAll) BEFORE the Supabase load
   returns, so the draft used to be seeded from empty rates and then never
   refreshed when the real ones arrived — the boxes stayed blank however many
   times they had been saved, and pressing Save & Lock wrote those blanks back
   over the real rates. */
function _seedRateDraft(n, force) {
  if (force || !_rateDraft || _rateDraft.nursery !== n || !_rateDraft.touched) {
    const rates = nurseryRates(n);
    _rateDraft = { nursery: n, touched: false, values: {} };
    PIECE_RATE_TYPES.forEach(rt => { _rateDraft.values[rt.code] = rates[rt.code] ?? null; });
  }
  return _rateDraft;
}

function _rateDirty(n) {
  const rates = nurseryRates(n), d = _seedRateDraft(n);
  return PIECE_RATE_TYPES.some(rt => (d.values[rt.code] ?? null) !== (rates[rt.code] ?? null));
}

/* Save / lock bar under the rate cards. */
function renderRateActions() {
  const bar = document.getElementById('setting-rate-actions');
  if (!bar) return;
  const n = getNursery();
  if (_rateLoadErr) {
    bar.innerHTML = `<span style="font-size:11.5px;font-weight:600;color:#a83020;line-height:1.5;">
      ⚠️ Saved piece rates could not be read, so these boxes may be blank even though rates were saved.
      Saving now would overwrite them.<br>
      <span style="font-weight:500;color:var(--text-muted);">${_rateLoadErr}</span><br>
      Run section 8 of <code>shared/migration_nops_maintenance.sql</code> in Supabase, then reload.
    </span>`;
    return;
  }
  if (rateLocked(n)) {
    bar.innerHTML = `
      <span style="font-size:12px;font-weight:700;color:var(--green-text);">🔒 ${t('rate.lockedMsg')}</span>
      <button class="btn" style="font-size:12px;" onclick="unlockPieceRates()">🔓 ${t('rate.unlock')}</button>`;
    return;
  }
  const dirty = _rateDirty(n);
  bar.innerHTML = `
    <button class="btn btn-primary" style="font-size:12px;" onclick="savePieceRates()">💾 ${t('rate.saveLock')}</button>
    <span style="font-size:11px;font-weight:600;color:${dirty ? '#a16207' : 'var(--text-muted)'};">
      ${dirty ? t('rate.unsaved') : t('rate.openMsg')}
    </span>`;
}

function onRateInput(code, val) {
  const n = getNursery();
  if (rateLocked(n)) return;
  const d = _seedRateDraft(n);
  const raw = String(val ?? '').trim();
  d.values[code] = raw === '' ? null : Math.max(0, parseFloat(raw) || 0);
  d.touched = true;             // from here the draft outranks a re-render
  renderRateActions();          // only the bar — retyping must not lose focus
}

/* Write all four rates for this nursery, then lock. */
async function savePieceRates() {
  const n = getNursery();
  if (!isNopsAdmin) { alert('Only an administrator can change piece rates.'); return; }
  if (rateLocked(n)) return;
  // Never write before the saved rates have arrived — otherwise a save made
  // during startup would push empty boxes over real values.
  if (_supabase && !_dbReady) { alert('Still loading the saved rates — try again in a moment.'); return; }
  if (_rateLoadErr) {
    alert('The saved piece rates could not be read, so saving now would overwrite them with blanks.\n\n' +
          _rateLoadErr + '\n\nRun section 8 of shared/migration_nops_maintenance.sql in Supabase, then reload.');
    return;
  }
  const d = _seedRateDraft(n);
  const rates = nurseryRates(n);
  PIECE_RATE_TYPES.forEach(rt => { rates[rt.code] = d.values[rt.code] ?? null; });

  if (_supabase) {
    const rows = [], gone = [];
    PIECE_RATE_TYPES.forEach(rt => {
      if (rates[rt.code] === null) gone.push(rt.code);
      else rows.push({ nursery: n, work_type: rt.code, rate: rates[rt.code] });
    });
    try {
      if (rows.length) {
        const { error } = await _supabase.from('nops_maint_piece_rates')
          .upsert(rows, { onConflict: 'nursery,work_type' });
        if (error) throw error;
      }
      if (gone.length) {
        await _supabase.from('nops_maint_piece_rates').delete().eq('nursery', n).in('work_type', gone);
      }
      const { error: lockErr } = await _supabase.from('nops_maint_rate_lock')
        .upsert({ nursery: n, locked: true, locked_by: (window.currentUserEmail || null) },
                { onConflict: 'nursery' });
      // A missing lock table must not lose the rates that just saved.
      if (lockErr) console.warn('[maint] rate lock save failed:', lockErr.message);
    } catch (e) {
      const msg = e.message || String(e);
      // 42P10 / "no unique or exclusion constraint" and "column ... does not
      // exist" both mean the same thing: migration section 8 has not been run.
      const needsMigration = /nursery/i.test(msg) && /(column|constraint|conflict)/i.test(msg);
      alert('Could not save the piece rates.\n\n' + msg +
            (needsMigration
              ? '\n\nThis nursery column is added by section 8 of shared/migration_nops_maintenance.sql. Run that in the Supabase SQL editor, then save again.'
              : '\n\nNothing was locked — try again.'));
      return;
    }
  }
  rateLocks[n] = true;
  _seedRateDraft(n, true);      // draft now matches what is stored
  renderPayroll();
  alert(`Piece rates saved and locked for ${NURSERY_NAMES[n]}.`);
}

async function unlockPieceRates() {
  const n = getNursery();
  if (!isNopsAdmin) { alert('Only an administrator can unlock piece rates.'); return; }
  if (!confirm(`Unlock the piece rates for ${NURSERY_NAMES[n]} so they can be edited?`)) return;
  if (_supabase) {
    const { error } = await _supabase.from('nops_maint_rate_lock')
      .upsert({ nursery: n, locked: false, locked_by: (window.currentUserEmail || null) },
              { onConflict: 'nursery' });
    if (error) { alert('Could not unlock: ' + error.message); return; }
  }
  rateLocks[n] = false;
  _seedRateDraft(n, true);      // start again from what is actually saved
}

/* ── Workers (per nursery) ────────────────────────────────────────────────
   Names come from the Worker System on the 555 Worker Portal's Manage page, so one
   register covers both modules: add, rename or deactivate somebody there and
   the tick sheets here follow, this month included. Only the general workers
   of that nursery are taken — a nursery's own section, minus the roles that
   are plainly not doing spraying or weeding.

   The `workers` map is what the rest of this file reads; it is rebuilt from
   the register, falling back per nursery to the module's own old list so a
   nursery not yet on the register still has its sheet. */
const MAINT_NURSERIES = ['PN', 'BNN', 'UNN1', 'UNN2'];
let workers        = { PN: [], BNN: [], UNN1: [], UNN2: [] };  // resolved, what the page uses
let _linkedWorkers = {};                                       // from mjmnpayroll_workers
let _localWorkers  = { PN: [], BNN: [], UNN1: [], UNN2: [] };  // from nops_maint_workers
let _linkErr       = null;
let _linkAt        = 0;

/* Who counts as a general worker. Three rules, in order:

   1. The worker's own switch. "General worker (Work Maintenance)" on the
      worker's record in the payroll module settles it outright. This is the
      only rule that cannot be wrong, so anything ticked or unticked there
      wins over everything below.

   2. Whether the nursery names the role at all. If ANY worker in that nursery
      carries a role saying general worker, then that nursery labels its
      general workers and only those count — a Field Conductor filed in UNN1
      is not one of them.

   3. Otherwise, everyone except the roles that plainly are not general work.
      For a nursery that leaves the role blank, listing everybody is far
      better than listing nobody.

   Rule 3 alone is guesswork against a list of roles nobody can finish
   enumerating, which is why rule 1 exists. */
/* The role list the payroll module offers; kept in step with ROLES there. */
const ROLES = ['Field Conductor', 'Assistant Field Conductor', 'Water Pump Operator',
               'General Worker', 'Driver', 'Gardener'];
const MAINT_ROLE       = /^general\s*worker$|pekerja am|buruh am/i;
const NON_GENERAL_ROLE = /driver|pemandu|conductor|kondektor|konduktor|supervisor|penyelia|mandor|mandur|kepala|kerani|clerk|admin|manager|pengurus|executive|eksekutif|mekanik|mechanic|technician|juruteknik|security|pengawal|jaga|foreman|operator|storekeeper|storeman/i;
const roleOf = r => String(r.role || r.job_title || '').trim();
const isKnownRole = r => ROLES.some(x => x.toLowerCase() === String(r).trim().toLowerCase());

function isGeneralWorker(r, nurseryNamesTheRole) {
  if (r.active === false) return false;
  if (r.maint_general === true)  return true;
  if (r.maint_general === false) return false;
  const role = roleOf(r);
  if (MAINT_ROLE.test(role)) return true;    // General Worker
  if (isKnownRole(role))     return false;   // another role off the list
  if (nurseryNamesTheRole)   return false;   // labelled nursery, unlabelled worker
  return !NON_GENERAL_ROLE.test(role);
}

/* Turn the whole register into nursery → [name], applying the rules above per
   nursery. Shared by the boot load and the live refresh so the two can never
   drift apart. */
/* Which sheet a register row belongs to.
 
   The two sides spell a nursery differently and always have: this page keys
   on UNN1, the Payroll register is filled in by hand and says "UNN 1". An
   exact match therefore linked BNN and PN — which have no space in them — and
   silently found nobody for UNN 1 or UNN 2, so those two sheets fell back to
   the old local list and looked like nurseries with no workers.
 
   Compare on letters and digits alone, the same rule every other crossing of
   this boundary uses. And read `nursery` when `section` has not been filled
   in: the register copies one into the other, but a row added since is only
   guaranteed to have the one the person keying it happened to use. */
function _registerNurseryKey(r) {
  const key = (x) => String(x == null ? '' : x).replace(/[^a-z0-9]/gi, '').toUpperCase();
  return key(r && r.section) || key(r && r.nursery);
}

function generalWorkersByNursery(rows) {
  const by = {};
  MAINT_NURSERIES.forEach(n => {
    const mine = (rows || []).filter(r => _registerNurseryKey(r) === n);
    const named = mine.some(r => r.active !== false && MAINT_ROLE.test(roleOf(r)));
    const names = mine.filter(r => isGeneralWorker(r, named))
                      .map(r => String(r.full_name || '').trim())
                      .filter(Boolean);
    if (names.length) by[n] = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  });
  return by;
}

async function loadLinkedWorkers() {
  if (!_supabase) return;
  _linkAt = Date.now();
  // select('*') rather than named columns: the register gains columns over
  // time (maint_general), and naming one the table does not have yet would
  // fail the whole read.
  const res = await _supabase.from('mjmnpayroll_workers').select('*')
    .then(r => r, e => ({ error: e }));
  if (res.error) {
    // The payroll module may simply not be set up yet — keep the old list.
    _linkErr = res.error.message || String(res.error);
    _linkedWorkers = {};
    resolveWorkers();
    return;
  }
  _linkErr = null;
  // UNE and Driver are their own sections in the register and belong to no
  // nursery sheet, so matching the nursery keeps them out on its own.
  _linkedWorkers = generalWorkersByNursery(res.data || []);
  resolveWorkers();
}

function resolveWorkers() {
  MAINT_NURSERIES.forEach(n => {
    const linked = _linkedWorkers[n] || [];
    workers[n] = linked.length ? linked.slice() : (_localWorkers[n] || []).slice();
  });
}
function isLinked(n) { return (_linkedWorkers[n] || []).length > 0; }

/* Pick up an amendment made in the payroll module while this page is open.
   Throttled — opening the Worker Record tab twice in a row should not fire
   two reads. */
function refreshLinkedWorkers(force) {
  if (!_supabase || !_dbReady) return;
  if (!force && Date.now() - _linkAt < 15000) return;
  loadLinkedWorkers().then(() => { renderPayroll(); });
}

function removeWorker(name) {
  const n = getNursery();
  if (isLinked(n)) {
    alert(`${NURSERY_NAMES[n]} takes its workers from the Worker System on the 555 Worker Portal's Manage page.\n\n` +
          `Remove or deactivate the worker there instead.`);
    return;
  }
  if (!confirm(`Remove worker "${name}" from ${NURSERY_NAMES[n]}?`)) return;
  _localWorkers[n] = (_localWorkers[n] || []).filter(w => w !== name);
  resolveWorkers();
  persistWorker(n, name, true);
  renderPayroll();
}

function persistWorker(n, name, remove) {
  if (!_supabase) return;
  const q = remove
    ? _supabase.from('nops_maint_workers').delete().eq('nursery', n).eq('name', name)
    : _supabase.from('nops_maint_workers').upsert({ nursery: n, name }, { onConflict: 'nursery,name' });
  q.then(({ error }) => { if (error) console.warn('[maint] worker save failed:', error.message); });
}

/* Setting tab — list of user-added plots for the current nursery. */
let _dbReady     = false; // guards writes until the initial DB load lands

/* ════════════════════════════
   PERSISTENCE LAYER
   localStorage removed 2026-07-21 — data now lives in memory for the session
   only; Supabase wiring is pending. Each function below is the seam where a
   DB call will drop in (marked TODO(supabase)). The editable state already
   lives in `appState`, so nothing is lost within a session.
════════════════════════════ */
function stateKey(n, m) { return `${n}_${m}`; }

/* Tell the user when the schedule on screen was carried forward from an
   earlier month and has not been saved for this one yet — otherwise a full
   sheet looks like it was already set up for this month. */
function updateCarryNotice() {
  const box = document.getElementById('carry-notice');
  if (!box) return;
  const n = getNursery(), m = getMonth();
  const from = appState[n]?.[m]?._carriedFrom;
  if (!from) { box.style.display = 'none'; box.textContent = ''; return; }
  box.style.display = '';
  box.innerHTML = `↩️ Carried forward from <b>${from}</b> — this is last month's schedule. ` +
                  `Change anything and it saves as <b>${m}</b>'s own.`;
}   // future DB row id (nursery+month)

/* Persist the editable state for one nursery+month.
   TODO(supabase): upsert row (nursery, month) with the fields below. */
function persistState(n, m) {
  const s = appState[n]?.[m];
  if (!s) return;
  const _payload = {   // shape kept ready for the DB upsert
    pdConfig:       s.pdConfig,
    manuringConfig: s.manuringConfig,
    interrowConfig: s.interrowConfig,
    pd:             s.pd,
    manuring:       s.manuring,
    weeding:        s.weeding,
    interrow:       s.interrow,
    periods:        s.periods,
    weeks:          s.weeks,      // the summary's shared columns
    _savedPd:       s._savedPd,
  };
  dbStateCache[stateKey(n, m)] = JSON.parse(JSON.stringify(_payload));
  delete s._carriedFrom;          // it is this month's own schedule now
  s._touched = true;              // survives the post-load reset below
  updateCarryNotice();
  if (_supabase) {
    _supabase.from('nops_maint_state')
      .upsert({ nursery: n, month: m, payload: _payload, updated_at: new Date().toISOString() }, { onConflict: 'nursery,month' })
      .then(({ error }) => { if (error) console.warn('[maint] schedule save failed:', error.message); });
  }
}

/* Ticks used to live only in this browser's memory until someone pressed
   "Save Schedule". A tick looks like it did something — the box turns green —
   so it was routinely lost on closing the tab, and nobody else ever saw it.
   Every change to the schedule now writes itself, debounced so a run of ticks
   is one request. "Save Schedule" still publishes the flat task list for the
   worker app and takes the snapshot the "modified" highlight compares against. */
let _stateSaveTimer = null;
function persistStateSoon(n, m) {
  clearTimeout(_stateSaveTimer);
  _stateSaveTimer = setTimeout(() => persistState(n, m), 700);
}

/* Sortable key for a "Aug 2026" month label — 202608. */
function monthOrder(label) {
  const m = String(label || '').trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return null;
  const i = MONTHS_SHORT.indexOf(m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase());
  return i < 0 ? null : Number(m[2]) * 100 + (i + 1);
}

/* The most recent month BEFORE this one that has a saved schedule.
   A new month starts from the last one that was set rather than blank: tick
   July and save it, and August opens showing July's schedule. Change August
   and save, and September then starts from August, not July. Going back to an
   earlier month never inherits from a later one. */
function carryForwardFrom(n, month) {
  const want = monthOrder(month);
  if (want == null) return null;
  let best = null, bestOrd = -1;
  Object.keys(dbStateCache).forEach(k => {
    if (!k.startsWith(n + '_')) return;
    const lbl = k.slice(n.length + 1);
    const ord = monthOrder(lbl);
    if (ord == null || ord >= want) return;      // strictly earlier only
    if (ord > bestOrd) { bestOrd = ord; best = lbl; }
  });
  return best;
}

/* Load a saved state for a nursery+month.
   Returns null → getState() falls back to defaults/seed.
   TODO(supabase): fetch row by (nursery, month); return its JSON or null.
   (migrateManuringShape / migrateInterrowShape still run on whatever the DB returns.) */
function loadPersistedState(n, m) {
  const cached = dbStateCache[stateKey(n, m)];
  return cached ? JSON.parse(JSON.stringify(cached)) : null;
}
let currentNursery = 'BNN';
let canEditSchedule = true;   // no login — every session has full edit access
let editRecId      = null;
let barInst        = null;
let jenisInst      = null;

/* ════════════════════════════
   I18N — English / Bahasa Melayu
   currentLang persisted in localStorage. t(key) resolves the active
   language, falling back to English then to the raw key.
════════════════════════════ */
const I18N = {
  en: {
    'top.month':'Month', 'top.nursery':'Nursery',
    'btn.pdf':'⬇ Download Schedule PDF', 'btn.save':'💾 Save Schedule',
    'btn.addRecord':'+ Add Record', 'btn.sync':'↺ Sync from Schedule',
    'btn.reset':'↺ Reset to Defaults', 'btn.clearAll':'Clear All', 'btn.selectAll':'Select All',
    'sched.ticked':'ticked', 'sched.none':'not set yet',
    'tab.pd':'P & D — Spraying', 'tab.manuring':'Manuring', 'tab.weeding':'Weeding',
    'tab.interrow':'Interrow Spray', 'tab.record':'Work Record', 'tab.chart':'Analytics', 'tab.schedule':'Monthly Scheduled Work', 'tab.payroll':'Worker Record', 'tab.setting':'Setting',
    'pay.form':'Worker Record', 'pay.month':'Month', 'pay.date':'Date', 'pay.plot':'Plot',
    'pay.plotCap':'Plot Capacity (seedlings)', 'pay.perWorker':'Capacity per Worker (seedlings)',
    'pay.totalCap':'Total (Capacity)', 'pay.rate':'Piece Rate (RM)', 'pay.totalRM':'Total (RM)',
    'pay.noWorkers':'No general worker is on the Worker System register for this nursery yet. Add them on the 555 Worker Portal\u2019s Manage page and they will appear here.',
    'pay.linkedNote':'Worker names come from the Worker System on the 555 Worker Portal\u2019s Manage page and follow any change made there.',
    'pay.offRegister':'⚠ Ticked this month but no longer a general worker of this nursery on the register, so their capacity is not counted:',
    'pay.fieldNoColumn':'⚠ The field credited work to these names and they have no column here, so their share of the plot is not counted. Check the spelling against the register, or that they are a general worker of this nursery:',
    'pay.noRows':'No records for this nursery and month yet — tick the schedule, then Sync from Schedule.',
    'pay.tickHint':'Tick each worker who did the job. Capacity per worker = plot capacity ÷ number of ticks on that row. Pay is worked out from this record in the Nursery Payroll System.',
    /* Salary claim form (PDF) */
    'pay.no':'No.', 'pay.worker':'Worker Name', 'pay.workersRange':'Workers', 'pay.ofTotal':'of',
    'pay.capBy':'CAPACITY COMPLETED (SEEDLINGS)', 'pay.totalEarn':'Total Earned (RM)',
    'pay.capShort':'Capacity', 'pay.rmShort':'Earned', 'pay.totalCapCol':'Total Capacity',
    'pay.grandTotal':'GRAND TOTAL',
    'pay.autoNote':'This worker record is automatically generated by the MJM Nursery AI system.',
    'btn.claimPdf':'⬇ Worker Record (PDF)',
    
    'badge.pd':'PEST & DISEASE SPRAYING SCHEDULE', 'badge.manuring':'MANURING SCHEDULE',
    'badge.weeding':'WEEDING SCHEDULE', 'badge.interrow':'INTERROW SPRAYING SCHEDULE',
    'badge.calc':'💊 DOSAGE CALCULATOR',
    'period.head':'When does this round run?', 'period.from':'First day', 'period.to':'Last day',
    'period.apply':'Set dates', 'period.reset':'Use the default week', 'period.tip':'Click to set this round\u2019s dates',
    'col.plot':'PLOT', 'hdr.week':'WEEK', 'hdr.round':'Round',
    'hdr.pSerangga':'P — PEST', 'hdr.dKulat':'D — DISEASE',
    'hdr.manuringRounds':'MANURING ROUNDS', 'hdr.interrowRounds':'INTERROW SPRAY ROUNDS',
    'hdr.weeding':'WEEDING', 'hdr.activator':'ACTIVATOR',
    'act.selectAll':'Select All →', 'act.addRound':'+ Round', 'act.removeRound':'− Round',
    'act.addCol':'+ Col', 'act.removeCol':'− Col',
    'sum.jumlahPlot':'Total Plots', 'sum.jumlahBibit':'Total Seedlings',
    'sum.maxRacun':'Max Chemical Used', 'sum.maxBaja':'Max Fertilizer Used',
    'sum.maxBond':'Max Bond Used', 'sum.maxActivator':'Max Activator Used',
    'sum.bags':'Bags Needed',
    'unit.bags':'bags', 'unit.each':'each',
    'pdf.title':'Download Schedule PDF', 'pdf.short.pd':'P&D SPRAYING', 'pdf.short.manuring':'MANURING',
    'pdf.short.weeding':'WEEDING', 'pdf.short.interrow':'INTERROW SPRAY', 'pdf.merumput':'Weeding in polybag',
    'pdf.include':'Include schedules', 'btn.cancel':'Cancel', 'btn.downloadPdf':'⬇ Download PDF',
    'rec.tarikh':'Date', 'rec.jenis':'Work Type', 'rec.racun':'Chemical',
    'rec.plot':'Plot', 'rec.batch':'Batch', 'rec.qty':'Quantity', 'rec.gaia':'Gaia', 'rec.remark':'Remark',
    'rec.audit':'Audit', 'rec.auditOk':'Satisfied', 'rec.auditBad':'Unsatisfied',
    'rec.auditOkTip':'The auditor checked this job and passed it',
    'rec.auditBadTip':'The auditor checked this job and did not pass it',
    'rec.allJenis':'All Work Types', 'rec.allPlot':'All Plots', 'rec.filterDate':'Filter by date…',
    'rec.totalTasks':'Total Tasks', 'rec.gaiaDone':'Gaia Done', 'rec.gaiaPending':'Gaia Pending',
    'rec.donePct':'Done %', 'rec.none':'No records found.',
    'jenis.pd':'P & D Spraying', 'jenis.interrow':'Interrow Spraying',
    'jenis.weeding':'Weeding', 'jenis.manuring':'Manuring',
    /* Add / Edit Record modal */
    'mod.addRec':'Add Work Record', 'mod.editRec':'Edit Record',
    'mod.tarikh':'Date', 'mod.jenis':'Work Type', 'mod.racun':'Chemical',
    'mod.plot':'Plot', 'mod.batch':'Batch No.', 'mod.qty':'Quantity',
    'mod.gaia':'Gaia Workdone', 'mod.remark':'Remark',
    'mod.ph.racun':'e.g. R1: Daconil 50gm + Bond 15mL',
    'mod.ph.plot':'e.g. B1',
    'mod.ph.batch':'Blank = all batches in the plot',
    'mod.ph.qty':'Leave blank to link from the batch report',
    'mod.ph.remark':'Optional remarks…',
    'mod.gaiaPending':'— Pending', 'mod.gaiaDone':'Done',
    'btn.saveRec':'Save Record',
    /* Quantity linked to the movement report */
    'link.loading':'Linking to the batch report…',
    'link.unreachable':'Could not reach the batch report — key the quantity manually.',
    'link.none':'No batch movement found for plot {x} — key the quantity manually.',
    'link.allBatches':'all batches ({x})', 'link.someBatches':'batch {x}',
    'link.asAt':'as at {x}', 'link.today':'standing today — no date picked yet',
    'link.willUse':'{x} will be used',
    'link.overridden':'Linked value is {x} — your {y} overrides it',
    'link.basis':'movement report closing balance',
    'link.negative':'Batch report nets to {x} here — check that plot\'s records.',
    /* Piece rate save / lock */
    'rate.saveLock':'Save & Lock', 'rate.unlock':'Unlock to edit',
    'rate.lockedMsg':'Locked — these rates are in use by Monthly Payroll.',
    'rate.openMsg':'Open for editing. Save & Lock when the rates are agreed.',
    'rate.unsaved':'Unsaved changes — press Save & Lock to apply them.',
  },
  bm: {
    'top.month':'Bulan', 'top.nursery':'Tapak Semaian',
    'btn.pdf':'⬇ Muat Turun Jadual PDF', 'btn.save':'💾 Simpan Jadual',
    'btn.addRecord':'+ Tambah Rekod', 'btn.sync':'↺ Segerak dari Jadual',
    'btn.reset':'↺ Set Semula', 'btn.clearAll':'Kosongkan', 'btn.selectAll':'Pilih Semua',
    'sched.ticked':'ditanda', 'sched.none':'belum ditetapkan',
    'tab.pd':'P & D — Racun', 'tab.manuring':'Membaja', 'tab.weeding':'Merumput',
    'tab.interrow':'Racun Selingan', 'tab.record':'Rekod Kerja', 'tab.chart':'Analitik', 'tab.schedule':'Kerja Berjadual Bulanan', 'tab.payroll':'Rekod Pekerja', 'tab.setting':'Tetapan',
    'pay.form':'Rekod Pekerja', 'pay.month':'Bulan', 'pay.date':'Tarikh', 'pay.plot':'Plot',
    'pay.plotCap':'Kapasiti plot (bibit)', 'pay.perWorker':'Kapasiti Kerja Setiap Orang (bibit)',
    'pay.totalCap':'Jumlah (Kapasiti)', 'pay.rate':'Kadar Sekeping (RM)', 'pay.totalRM':'Jumlah (RM)',
    'pay.noWorkers':'Belum ada pekerja am untuk nurseri ini dalam daftar Worker System. Tambah di halaman Manage Portal 555 FC dan nama akan muncul di sini.',
    'pay.linkedNote':'Nama pekerja diambil daripada Worker System di halaman Manage Portal 555 FC dan mengikut sebarang pindaan di sana.',
    'pay.offRegister':'⚠ Ditanda bulan ini tetapi bukan lagi pekerja am nurseri ini dalam daftar, jadi kapasiti mereka tidak dikira:',
    'pay.fieldNoColumn':'⚠ Lapangan mengkreditkan kerja kepada nama ini tetapi tiada lajur di sini, jadi bahagian mereka tidak dikira. Semak ejaan dengan daftar, atau sama ada mereka pekerja am nurseri ini:',
    /* Borang tuntutan gaji (PDF) */
    'pay.no':'Bil.', 'pay.worker':'Nama Pekerja', 'pay.workersRange':'Pekerja', 'pay.ofTotal':'daripada',
    'pay.capBy':'KAPASITI KERJA DISIAPKAN (BIBIT)', 'pay.totalEarn':'Jumlah Pendapatan (RM)',
    'pay.capShort':'Kapasiti', 'pay.rmShort':'Diperoleh', 'pay.totalCapCol':'Jumlah Kapasiti',
    'pay.grandTotal':'JUMLAH BESAR',
    'pay.autoNote':'Rekod pekerja ini dijana secara automatik oleh sistem MJM Nursery AI.',
    'btn.claimPdf':'⬇ Rekod Pekerja (PDF)',
    'pay.noRows':'Tiada rekod untuk nurseri dan bulan ini — tandakan jadual, kemudian Sync from Schedule.',
    'pay.tickHint':'Tandakan setiap pekerja yang membuat kerja. Kapasiti setiap pekerja = kapasiti plot ÷ bilangan tanda pada baris itu. Gaji dikira daripada rekod ini di Sistem Penggajian Nurseri.',
    
    'badge.pd':'JADUAL PENYEMBURAN RACUN KULAT DAN SERANGGA', 'badge.manuring':'JADUAL MEMBAJA',
    'badge.weeding':'JADUAL MERUMPUT', 'badge.interrow':'JADUAL MERACUN RUMPUT SECARA SELINGAN',
    'badge.calc':'💊 KALKULATOR DOS',
    'period.head':'Bila pusingan ini berjalan?', 'period.from':'Hari pertama', 'period.to':'Hari terakhir',
    'period.apply':'Tetapkan tarikh', 'period.reset':'Guna minggu asal', 'period.tip':'Klik untuk tetapkan tarikh pusingan ini',
    'col.plot':'PLOT', 'hdr.week':'MINGGU', 'hdr.round':'Pusingan',
    'hdr.pSerangga':'P — SERANGGA', 'hdr.dKulat':'D — KULAT',
    'hdr.manuringRounds':'PUSINGAN MEMBAJA', 'hdr.interrowRounds':'PUSINGAN RACUN SELINGAN',
    'hdr.weeding':'MERUMPUT', 'hdr.activator':'ACTIVATOR',
    'act.selectAll':'Pilih Semua →', 'act.addRound':'+ Pusingan', 'act.removeRound':'− Pusingan',
    'act.addCol':'+ Lajur', 'act.removeCol':'− Lajur',
    'sum.jumlahPlot':'Jumlah Plot', 'sum.jumlahBibit':'Jumlah Bibit',
    'sum.maxRacun':'Maksimal Racun Guna', 'sum.maxBaja':'Maksimal Baja Guna',
    'sum.maxBond':'Maksimal Bond Guna', 'sum.maxActivator':'Maksimal Activator Guna',
    'sum.bags':'Bag Diperlukan',
    'unit.bags':'beg', 'unit.each':'setiap',
    'pdf.title':'Muat Turun Jadual PDF', 'pdf.short.pd':'RACUN P&D', 'pdf.short.manuring':'MEMBAJA',
    'pdf.short.weeding':'MERUMPUT', 'pdf.short.interrow':'RACUN SELINGAN', 'pdf.merumput':'Merumput dalam polibeg',
    'pdf.include':'Sertakan jadual', 'btn.cancel':'Batal', 'btn.downloadPdf':'⬇ Muat Turun PDF',
    'rec.tarikh':'Tarikh', 'rec.jenis':'Jenis Kerja', 'rec.racun':'Racun / Bahan',
    'rec.plot':'Plot', 'rec.batch':'Batch', 'rec.qty':'Kuantiti', 'rec.gaia':'Gaia', 'rec.remark':'Catatan',
    'rec.audit':'Audit', 'rec.auditOk':'Memuaskan', 'rec.auditBad':'Tidak Memuaskan',
    'rec.auditOkTip':'Juruaudit telah memeriksa kerja ini dan meluluskannya',
    'rec.auditBadTip':'Juruaudit telah memeriksa kerja ini dan tidak meluluskannya',
    'rec.allJenis':'Semua Jenis Kerja', 'rec.allPlot':'Semua Plot', 'rec.filterDate':'Tapis ikut tarikh…',
    'rec.totalTasks':'Jumlah Tugasan', 'rec.gaiaDone':'Gaia Selesai', 'rec.gaiaPending':'Gaia Belum',
    'rec.donePct':'% Selesai', 'rec.none':'Tiada rekod dijumpai.',
    'jenis.pd':'Penyemburan racun kulat dan serangga', 'jenis.interrow':'Meracun rumput secara selingan',
    'jenis.weeding':'Merumput', 'jenis.manuring':'Membaja',
    /* Borang Tambah / Sunting Rekod */
    'mod.addRec':'Tambah Rekod Kerja', 'mod.editRec':'Sunting Rekod',
    'mod.tarikh':'Tarikh', 'mod.jenis':'Jenis Kerja', 'mod.racun':'Racun / Bahan Kimia',
    'mod.plot':'Plot', 'mod.batch':'No. Batch', 'mod.qty':'Kuantiti',
    'mod.gaia':'Kerja Siap Gaia', 'mod.remark':'Catatan',
    'mod.ph.racun':'cth. R1: Daconil 50gm + Bond 15mL',
    'mod.ph.plot':'cth. B1',
    'mod.ph.batch':'Kosong = semua batch dalam plot',
    'mod.ph.qty':'Biar kosong untuk ambil dari laporan batch',
    'mod.ph.remark':'Catatan tambahan…',
    'mod.gaiaPending':'— Belum Siap', 'mod.gaiaDone':'Siap',
    'btn.saveRec':'Simpan Rekod',
    /* Kuantiti diambil dari laporan pergerakan */
    'link.loading':'Menyambung ke laporan batch…',
    'link.unreachable':'Laporan batch tidak dapat dicapai — sila isi kuantiti sendiri.',
    'link.none':'Tiada pergerakan batch dijumpai untuk plot {x} — sila isi kuantiti sendiri.',
    'link.allBatches':'semua batch ({x})', 'link.someBatches':'batch {x}',
    'link.asAt':'pada {x}', 'link.today':'baki semasa — tarikh belum dipilih',
    'link.willUse':'{x} akan digunakan',
    'link.overridden':'Nilai dari laporan ialah {x} — {y} yang anda isi mengatasinya',
    'link.basis':'baki akhir laporan pergerakan',
    'link.negative':'Laporan batch menunjukkan {x} di sini — sila semak rekod plot itu.',
    /* Simpan / kunci kadar upah */
    'rate.saveLock':'Simpan & Kunci', 'rate.unlock':'Buka untuk sunting',
    'rate.lockedMsg':'Terkunci — kadar ini sedang digunakan oleh Gaji Bulanan.',
    'rate.openMsg':'Boleh disunting. Tekan Simpan & Kunci apabila kadar dipersetujui.',
    'rate.unsaved':'Perubahan belum disimpan — tekan Simpan & Kunci.',
  },
};
let currentLang = localStorage.getItem('mjm_lang') || 'en';
function t(key){
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
}
/* Canonical BM jenis value → its translation key (for display only; stored value stays BM) */
function jenisKey(j){
  const s=(j||'').toLowerCase();
  if(s.includes('penyemburan'))   return 'jenis.pd';
  if(s.includes('rumput secara')) return 'jenis.interrow';
  if(s.includes('merumput'))      return 'jenis.weeding';
  if(s.includes('membaja'))       return 'jenis.manuring';
  return null;
}
function jenisLabel(j){ const k=jenisKey(j); return k ? t(k) : j; }
function setLang(l){
  currentLang = (l==='bm') ? 'bm' : 'en';
  localStorage.setItem('mjm_lang', currentLang);
  applyLang();
}
function toggleLang(){ setLang(currentLang==='en' ? 'bm' : 'en'); }
/* Update all static [data-i18n] text, the lang toggle state, then re-render dynamic views */
function applyLang(){
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  document.querySelectorAll('.lang-seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-l')===currentLang);
  });
  // The record modal's title is set in code, so it needs re-titling too when
  // the language changes while it is open.
  const recTitle = document.getElementById('rec-modal-title');
  if (recTitle) recTitle.textContent = t(editRecId ? 'mod.editRec' : 'mod.addRec');
  // Dynamic tables/records carry their own strings through t()
  if (typeof renderAll === 'function') renderAll();
}

function getState(nursery, month) {
  if (!appState[nursery]) appState[nursery] = {};
  if (!appState[nursery][month]) {
    // Hydrate from the persistence layer if a saved state exists (Supabase seam;
    // returns null for now → falls through to defaults/seed below)
    const persisted = loadPersistedState(nursery, month);
    if (persisted) {
      migrateManuringShape(persisted, NURSERY_PLOTS[nursery]);
      migrateInterrowShape(persisted, NURSERY_PLOTS[nursery]);
      appState[nursery][month] = persisted;
      return appState[nursery][month];
    }
    // Nothing saved for this month — start from the last month that was set,
    // so a new month opens with the schedule already in place rather than
    // blank. It stays a copy: nothing is written until someone ticks or saves,
    // and the month it came from is untouched.
    const from = carryForwardFrom(nursery, month);
    if (from) {
      const inherited = loadPersistedState(nursery, from);   // already a deep copy
      if (inherited) {
        migrateManuringShape(inherited, NURSERY_PLOTS[nursery]);
        migrateInterrowShape(inherited, NURSERY_PLOTS[nursery]);
        // Snapshot what was carried in, so nothing shows as "modified" until
        // this month is actually changed.
        inherited._savedPd = JSON.parse(JSON.stringify(inherited.pd || {}));
        inherited._carriedFrom = from;
        appState[nursery][month] = inherited;
        return appState[nursery][month];
      }
    }
    const plots = NURSERY_PLOTS[nursery];
    const s = {
      pdConfig:       defaultPDConfig(),
      manuringConfig: defaultManuringConfig(),
      interrowConfig: defaultInterrowConfig(),
      pd:             {},
      manuring:       {},
      weeding:        {},   // weeding[plot] = { R1: bool, R2: bool }
      interrow:       {},   // interrow[plot] = [round1: [col1, ...], round2: [...]]
    };
    // init empty grids
    ['W1','W2','W3','W4'].forEach(w => {
      s.pd[w] = {};
      plots.forEach(p => { s.pd[w][p] = { P:false, D:false }; });
    });
    plots.forEach(p => {
      s.manuring[p]  = [[false, false, false]]; // [round1: [col1, col2, col3]]
      s.weeding[p]   = { R1:false, R2:false };
      s.interrow[p]  = [[false], [false]];  // [round1: [col1], round2: [col1]]
    });
    // Seed BNN Apr 2026
    if (nursery === 'BNN' && month === 'Apr 2026') {
      const pdSeed = {
        W1:{ P:['B2','B6','B7','B9'],    D:['B1','B3','B4','B8','B11','B12','B13','B14'] },
        W2:{ P:[],                        D:['B11','B13','B14'] },
        W3:{ P:[],                        D:['B1','B3','B4','B8','B11','B13','B14'] },
        W4:{ P:[],                        D:['B11','B13','B14'] }
      };
      Object.entries(pdSeed).forEach(([w,v]) => {
        plots.forEach(p => { s.pd[w][p] = { P:v.P.includes(p), D:v.D.includes(p) }; });
      });
      const mSeed = { 0:['B11','B13','B14'], 1:['B1','B3','B6','B11'], 2:['B2','B4','B7','B8','B9'] };
      plots.forEach(p => { s.manuring[p] = [[mSeed[0].includes(p), mSeed[1].includes(p), mSeed[2].includes(p)]]; });
    }
    appState[nursery][month] = s;
  }
  return appState[nursery][month];
}

/* ════════════════════════════
   WORK RECORDS
════════════════════════════ */
let records = [
  { id:1,  tarikh:'09-03-2026', jenis:'Penyemburan racun kulat dan serangga', racun:'R1: Daconil 50gm + Bond 15mL',     plot:'B1', batch:'234,237,241', carlos:1, gaia:0, remark:'' },
  { id:2,  tarikh:'-',          jenis:'Penyemburan racun kulat dan serangga', racun:'R1: Destroy 30mL + Bond 15mL',     plot:'B1', batch:'234,237,241', carlos:0, gaia:0, remark:'' },
  { id:3,  tarikh:'-',          jenis:'Penyemburan racun kulat dan serangga', racun:'R2: Antracol 50gm + Bond 15mL',    plot:'B1', batch:'234,237,241', carlos:0, gaia:0, remark:'' },
  { id:4,  tarikh:'-',          jenis:'Penyemburan racun kulat dan serangga', racun:'R2: Cyper 60mL + Bond 15mL',       plot:'B1', batch:'234,237,241', carlos:0, gaia:0, remark:'' },
  { id:5,  tarikh:'29-03-2026', jenis:'Meracun rumput secara selingan',       racun:'R1: Monex 200mL + Activator 15mL', plot:'B1', batch:'234,237,241', carlos:1, gaia:0, remark:'' },
  { id:6,  tarikh:'-',          jenis:'Meracun rumput secara selingan',       racun:'R2: Basta 200mL + Activator 15mL', plot:'B1', batch:'234,237,241', carlos:0, gaia:0, remark:'' },
  { id:7,  tarikh:'13-03-2026', jenis:'Merumput',                             racun:'R1: Merumput dalam polibeg',        plot:'B1', batch:'234,237,241', carlos:1, gaia:0, remark:'' },
  { id:8,  tarikh:'-',          jenis:'Merumput',                             racun:'R2: Merumput dalam polibeg',        plot:'B1', batch:'234,237,241', carlos:0, gaia:0, remark:'' },
  { id:9,  tarikh:'07-03-2026', jenis:'Membaja',                              racun:'Organic Matter 180gm',              plot:'B1', batch:'234,237,241', carlos:1, gaia:0, remark:'' },
  { id:10, tarikh:'-',          jenis:'Membaja',                              racun:'Compound 55 — 20gm',                plot:'B1', batch:'234,237,241', carlos:0, gaia:0, remark:'' },
];

/* ════════════════════════════
   NAVIGATION
════════════════════════════ */
/* The topbar now uses a native month+year picker (value "2026-04").
   All internal keys/labels keep the original "Apr 2026" format. */
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthInputToLabel(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(v || '');
  return m ? `${MONTH_ABBR[parseInt(m[2], 10) - 1]} ${m[1]}` : (v || '');
}
function monthLabelToInput(lbl) {
  const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec((lbl || '').trim());
  if (!m) return '';
  const idx = MONTH_ABBR.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  return idx >= 0 ? `${m[2]}-${String(idx + 1).padStart(2, '0')}` : '';
}
const getMonth   = () => monthInputToLabel(document.getElementById('global-month').value);

/* ── COLUMN HEADERS AS DATES ──
   The month is worked in blocks of seven days, and the field reads them as
   dates rather than as an ordinal they have to count back from: 1st - 7th,
   8th - 14th, 15th - 21st, 22nd - 28th. A block added by hand beyond the
   fourth runs to the end of the month, so February never reads "29th - 35th".
   Takes the month label ("Apr 2026") the table is being drawn for; the PDF
   draws a different month from the screen, so it passes its own. */
function daysInMonthLabel(lbl) {
  const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec((lbl || '').trim());
  if (!m) return 31;                       // unknown month — assume the longest
  const idx = MONTH_ABBR.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  if (idx < 0) return 31;
  return new Date(parseInt(m[2], 10), idx + 1, 0).getDate();  // day 0 of next
}
/* "Aug 2026" as the header says it: "Aug 26". Anything that is not the
   two-part label is handed back untouched rather than sliced blindly. */
function shortMonth(m) {
  const parts = String(m || '').trim().split(/\s+/);
  return (parts.length === 2 && /^\d{4}$/.test(parts[1]))
    ? parts[0] + ' ' + parts[1].slice(2) : String(m || '');
}

function ordinalDay(d) {
  const v = d % 100, sfx = ['th', 'st', 'nd', 'rd'];
  return d + (sfx[(v - 20) % 10] || sfx[v] || sfx[0]);
}
function periodLabel(n, monthLabel) {
  const lbl = monthLabel !== undefined
    ? monthLabel
    : (document.getElementById('global-month') ? getMonth() : '');
  const days = daysInMonthLabel(lbl);
  const from = (n - 1) * 7 + 1;
  // A block with no days left in the month — a 5th round in a 28-day
  // February. There is no date to name, so it keeps its number rather than
  // inventing a 29th of February.
  if (from > days) return `${t('hdr.round')} ${n}`;
  const to = Math.min(from + 6, days);
  return from === to ? ordinalDay(from) : `${ordinalDay(from)} - ${ordinalDay(to)}`;
}

/* ══════════════════════════════════════════════════════════════
   WHEN A ROUND ACTUALLY RUNS

   A column used to be named by where it sat: the first was the 1st–7th,
   the second the 8th–14th, and so on, seven days each whatever the work
   really was. That is a sensible default and a poor rule — a manuring
   round is not a calendar week, and the second round of the month is not
   always the second week of it.

   So a round may be given its own dates, and the header says them. What
   is stored is the two DAY NUMBERS, not two full dates: the month is
   already chosen in the top bar, and a range that carried its own month
   would fight the picker and break carry-forward into the next month.

   Sparse on purpose — s.periods holds only the rounds somebody has
   actually dated. A round with nothing stored falls back to the seven-day
   block exactly as before, so every month saved before this reads the
   same as it always did.
══════════════════════════════════════════════════════════════ */
const PERIOD_KINDS = ['pd', 'manuring', 'weeding', 'interrow'];

function periodsOf(s, kind) {
  if (!s.periods) s.periods = {};
  if (!s.periods[kind]) s.periods[kind] = {};
  return s.periods[kind];
}

/* i is 0-based. Returns null when the default block falls off the end of
   the month, which is what makes a 5th round in February keep its number. */
function periodRange(kind, i, n, m) {
  const days = daysInMonthLabel(m);
  const r = (appState[n]?.[m]?.periods?.[kind] || {})[i];
  if (r && +r.from >= 1 && +r.to >= +r.from && +r.from <= days) {
    return { from: +r.from, to: Math.min(+r.to, days), custom: true };
  }
  const from = i * 7 + 1;
  if (from > days) return null;
  return { from, to: Math.min(from + 6, days), custom: false };
}

function periodText(kind, i, n, m) {
  const r = periodRange(kind, i, n, m);
  if (!r) return `${t('hdr.round')} ${i + 1}`;
  return r.from === r.to ? ordinalDay(r.from) : `${ordinalDay(r.from)} - ${ordinalDay(r.to)}`;
}

/* The header as a button. A dated round is marked, so it is obvious at a
   glance which columns were set by hand and which are still the default. */
function periodBtn(kind, i, n, m) {
  const r = periodRange(kind, i, n, m);
  return `<button type="button" class="period-btn${r && r.custom ? ' period-set' : ''}" ` +
    `onclick="openPeriodPicker('${kind}',${i},event)" ` +
    `title="${esc(t('period.tip'))}">${periodText(kind, i, n, m)}</button>`;
}

/* ── Picking the dates ──────────────────────────────────────────────
   Two date boxes, limited to the month on screen, over the header that
   opened them. Real date inputs rather than two "day number" boxes: the
   question is "which days", and a calendar is how that question is
   normally answered. Only the day numbers are kept. */
let _periodPick = null;   // { kind, i }

function monthISO(m) {
  const mm = /^([A-Za-z]{3})\s+(\d{4})$/.exec((m || '').trim());
  if (!mm) return null;
  const idx = MONTH_ABBR.findIndex(x => x.toLowerCase() === mm[1].toLowerCase());
  if (idx < 0) return null;
  return `${mm[2]}-${String(idx + 1).padStart(2, '0')}`;
}

function openPeriodPicker(kind, i, ev) {
  if (ev) ev.stopPropagation();
  if (!canEditSchedule) return;
  closePeriodPicker();
  const n = getNursery(), m = getMonth();
  const iso = monthISO(m);
  if (!iso) return;                       // no month to hang dates off
  const days = daysInMonthLabel(m);
  const r = periodRange(kind, i, n, m) || { from: 1, to: Math.min(7, days) };
  _periodPick = { kind, i };

  const box = document.createElement('div');
  box.className = 'period-pop';
  box.id = 'period-pop';
  box.innerHTML =
    `<div class="period-pop-h">${esc(t('period.head'))}</div>` +
    `<label>${esc(t('period.from'))}<input type="date" id="period-from" ` +
      `min="${iso}-01" max="${iso}-${String(days).padStart(2,'0')}" ` +
      `value="${iso}-${String(r.from).padStart(2,'0')}"></label>` +
    `<label>${esc(t('period.to'))}<input type="date" id="period-to" ` +
      `min="${iso}-01" max="${iso}-${String(days).padStart(2,'0')}" ` +
      `value="${iso}-${String(r.to).padStart(2,'0')}"></label>` +
    `<div class="period-pop-f">` +
      `<button type="button" class="btn" onclick="clearPeriod()">${esc(t('period.reset'))}</button>` +
      `<button type="button" class="btn" onclick="closePeriodPicker()">${esc(t('btn.cancel'))}</button>` +
      `<button type="button" class="btn btn-primary" onclick="applyPeriod()">${esc(t('period.apply'))}</button>` +
    `</div>`;
  document.body.appendChild(box);

  // Over the button that opened it, nudged back inside the window.
  const btn = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect();
  const w = box.offsetWidth || 250;
  const left = btn ? Math.min(Math.max(8, btn.left), window.innerWidth - w - 8)
                   : (window.innerWidth - w) / 2;
  box.style.left = left + 'px';
  box.style.top  = ((btn ? btn.bottom : 120) + window.scrollY + 6) + 'px';

  setTimeout(() => document.addEventListener('mousedown', _periodOutside), 0);
  document.addEventListener('keydown', _periodEsc);
}

function _periodOutside(e) {
  const box = document.getElementById('period-pop');
  if (box && !box.contains(e.target)) closePeriodPicker();
}
function _periodEsc(e) { if (e.key === 'Escape') closePeriodPicker(); }

function closePeriodPicker() {
  const box = document.getElementById('period-pop');
  if (box) box.remove();
  document.removeEventListener('mousedown', _periodOutside);
  document.removeEventListener('keydown', _periodEsc);
  _periodPick = null;
}

const _dayOf = (v) => { const d = /-(\d{2})$/.exec(v || ''); return d ? +d[1] : 0; };

function applyPeriod() {
  if (!_periodPick) return;
  const from = _dayOf(document.getElementById('period-from')?.value);
  const to   = _dayOf(document.getElementById('period-to')?.value);
  if (!from || !to) return;
  if (to < from) { alert('The last day cannot come before the first.'); return; }
  const { kind, i } = _periodPick;
  const n = getNursery(), m = getMonth();
  periodsOf(getState(n, m), kind)[i] = { from, to };
  closePeriodPicker();
  persistStateSoon(n, m);
  renderPeriodOwner(kind);
}

/* Back to the seven-day block. Removing the entry rather than writing the
   default back means a round is either dated or it is not — there is no
   third state that looks dated but is not. */
function clearPeriod() {
  if (!_periodPick) return;
  const { kind, i } = _periodPick;
  const n = getNursery(), m = getMonth();
  delete periodsOf(getState(n, m), kind)[i];
  closePeriodPicker();
  persistStateSoon(n, m);
  renderPeriodOwner(kind);
}

/* Opens the date picker over a round that has just been added. Deferred a
   frame, because the header it points at does not exist until the table
   that was just asked for has painted. */
function askNewRoundDates(kind, i) {
  setTimeout(() => {
    const want = "'" + kind + "'," + i + ",";
    const btn = [...document.querySelectorAll('.period-btn')]
      .find(b => (b.getAttribute('onclick') || '').includes(want));
    if (btn) btn.click();
  }, 60);
}

function renderPeriodOwner(kind) {
  if (kind === 'pd')            renderPD();
  else if (kind === 'manuring') renderManuring();
  else if (kind === 'weeding')  renderWeeding();
  else if (kind === 'interrow') renderInterrow();
}


const getNursery = () => document.getElementById('global-nursery').value;

/* ── MONTH/YEAR WHEEL PICKER (Android-style spinner) ──
   Two independently spinnable columns (month + year) with a Cancel/OK
   footer. Writes "YYYY-MM" into the hidden #global-month / #pdf-month
   inputs — everything downstream keeps the existing formats. */
const WHEEL_ITEM_H = 40, WHEEL_YEAR_MIN = 2020, WHEEL_YEAR_MAX = 2050;
let _wheelTarget = null, _wheelSnapTimers = {};
function _ensureWheel() {
  if (document.getElementById('wheel-overlay')) return;
  const ov = document.createElement('div');
  ov.id = 'wheel-overlay'; ov.className = 'wheel-overlay';
  ov.innerHTML = `
    <div class="wheel-panel">
      <div class="wheel-cols">
        <div class="wheel-col" id="wheel-months"></div>
        <div class="wheel-col" id="wheel-years"></div>
        <div class="wheel-band"></div>
      </div>
      <div class="wheel-actions">
        <button type="button" onclick="closeMonthWheel()">Cancel</button>
        <button type="button" onclick="okMonthWheel()">OK</button>
      </div>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeMonthWheel(); });
  document.body.appendChild(ov);
  const mCol = ov.querySelector('#wheel-months');
  MONTH_ABBR.forEach((m, i) => {
    const d = document.createElement('div');
    d.className = 'wheel-item'; d.textContent = m;
    d.onclick = () => _wheelScrollTo(mCol, i);
    mCol.appendChild(d);
  });
  const yCol = ov.querySelector('#wheel-years');
  for (let y = WHEEL_YEAR_MIN; y <= WHEEL_YEAR_MAX; y++) {
    const d = document.createElement('div');
    d.className = 'wheel-item'; d.textContent = y;
    d.onclick = () => _wheelScrollTo(yCol, y - WHEEL_YEAR_MIN);
    yCol.appendChild(d);
  }
  [mCol, yCol].forEach(col => col.addEventListener('scroll', () => _wheelOnScroll(col)));
}
function _wheelScrollTo(col, idx, instant) {
  col.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: instant ? 'auto' : 'smooth' });
}
function _wheelIdx(col) {
  return Math.max(0, Math.min(col.children.length - 1, Math.round(col.scrollTop / WHEEL_ITEM_H)));
}
function _wheelOnScroll(col) {
  _wheelHighlight(col);
  clearTimeout(_wheelSnapTimers[col.id]);
  _wheelSnapTimers[col.id] = setTimeout(() => {   // snap to nearest row when spinning stops
    const idx = _wheelIdx(col);
    if (Math.abs(col.scrollTop - idx * WHEEL_ITEM_H) > 1) _wheelScrollTo(col, idx);
    _wheelHighlight(col, idx);
  }, 90);
}
function _wheelHighlight(col, idx) {
  if (idx === undefined) idx = _wheelIdx(col);
  Array.from(col.children).forEach((el, i) => el.classList.toggle('sel', i === idx));
}
function openMonthWheel(target) {
  _ensureWheel();
  _wheelTarget = target;
  const cur = document.getElementById(target === 'pdf' ? 'pdf-month' : 'global-month').value;
  const m = /^(\d{4})-(\d{2})$/.exec(cur || '');
  const now = new Date();
  const yr = m ? parseInt(m[1], 10) : now.getFullYear();
  const mo = m ? parseInt(m[2], 10) - 1 : now.getMonth();
  document.getElementById('wheel-overlay').classList.add('open');
  const mCol = document.getElementById('wheel-months');
  const yCol = document.getElementById('wheel-years');
  requestAnimationFrame(() => {
    _wheelScrollTo(mCol, mo, true);
    _wheelScrollTo(yCol, Math.max(0, Math.min(WHEEL_YEAR_MAX - WHEEL_YEAR_MIN, yr - WHEEL_YEAR_MIN)), true);
    _wheelHighlight(mCol, mo);
    _wheelHighlight(yCol, yr - WHEEL_YEAR_MIN);
  });
}
function closeMonthWheel() { document.getElementById('wheel-overlay').classList.remove('open'); }
function okMonthWheel() {
  const mi = _wheelIdx(document.getElementById('wheel-months'));
  const yi = _wheelIdx(document.getElementById('wheel-years'));
  const val = `${WHEEL_YEAR_MIN + yi}-${String(mi + 1).padStart(2, '0')}`;
  document.getElementById(_wheelTarget === 'pdf' ? 'pdf-month' : 'global-month').value = val;
  _syncMonthButtons();
  closeMonthWheel();
  if (_wheelTarget !== 'pdf') { renderAll(); autoSyncRecords(); }
}
/* ‹ › on the Schedule tab. It drives the same hidden #global-month the wheel
   writes, so everything downstream — getState, persistState, the PDF — keys
   off the month it lands on with no idea it was reached a different way.

   Which is the whole answer to "does next month get stored separately":
   nops_maint_state is keyed (nursery, month), so it always was. Stepping
   forward to a month with nothing saved shows the last month that HAS a
   schedule, copied — carryForwardFrom() — and nothing is written until you
   tick something, so looking at next month does not create next month. */
function stepSchedMonth(d) {
  const el = document.getElementById('global-month');
  if (!el) return;
  const mm = /^(\d{4})-(\d{2})$/.exec(el.value || '');
  if (!mm) return;
  let y = +mm[1], i = +mm[2] - 1 + d;
  y += Math.floor(i / 12);
  i = ((i % 12) + 12) % 12;
  if (y < WHEEL_YEAR_MIN || y > WHEEL_YEAR_MAX) return;
  el.value = `${y}-${String(i + 1).padStart(2, '0')}`;
  _syncMonthButtons();
  try { localStorage.setItem('mjm_maint_month', getMonth()); } catch (_) {}
  renderAll();
  autoSyncRecords();
}

function _syncMonthButtons() {
  const g = document.getElementById('global-month'), gb = document.getElementById('global-month-btn');
  if (g && gb) gb.textContent = (monthInputToLabel(g.value) || 'Select month') + ' \u25BE';
  const p = document.getElementById('pdf-month'), pb = document.getElementById('pdf-month-btn');
  if (p && pb) pb.textContent = (monthInputToLabel(p.value) || 'Select month') + ' \u25BE';
}

function onNurseryChange() {
  syncNurseryCircles();
  renderAll();
  autoSyncRecords();
}
/* ── Ticking a box must not move the page ──────────────────────────────
   Every tick re-renders its whole panel — deliberately, because a tick can
   change another cell's "modified" mark and a surgical update would have to
   know which. The cost is that the reader loses their place: in the work
   editor, which is one long block per week, somebody ticking plots in week
   4 was thrown back to week 1 after every single tick.

   TWO KINDS OF BOX, and the second is the one that matters here.

   A box that SURVIVES the render — only its contents replaced — can be put
   back through the element itself. But renderWorkEditor() replaces
   #we-body's innerHTML, which destroys the scrolling div inside it and
   builds a new one; the old reference is detached and setting scrollTop on
   it does nothing at all. So the offsets are also remembered against a
   SELECTOR, and re-applied to whatever took the old element's place. That
   is the whole reason the first attempt at this looked right and did
   nothing.

   Put back twice: the synchronous call covers the ordinary case, and the
   rAF covers the one where the new markup is briefly shorter than the old —
   the browser clamps the offset to the shorter content, and only once
   layout has settled is the original reachable again. */
const SCROLL_BOXES = ['.we-scroll', '.tbl-wrap', '.ss-wrap', '#we-modal .modal-body'];

function keepingScroll(fn) {
  const x = window.scrollX, y = window.scrollY;

  // Boxes that will still be here afterwards, held by reference.
  const live = [];
  document.querySelectorAll('*').forEach(el => {
    if (el.scrollTop || el.scrollLeft) live.push([el, el.scrollLeft, el.scrollTop]);
  });
  // And the same offsets held by selector, for the ones about to be rebuilt.
  const bySel = [];
  SCROLL_BOXES.forEach(sel => {
    const el = document.querySelector(sel);
    if (el && (el.scrollTop || el.scrollLeft)) bySel.push([sel, el.scrollLeft, el.scrollTop]);
  });

  fn();

  const put = () => {
    window.scrollTo(x, y);
    live.forEach(([el, l, t]) => {
      if (!el.isConnected) return;
      el.scrollLeft = l; el.scrollTop = t;
    });
    bySel.forEach(([sel, l, t]) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.scrollLeft = l; el.scrollTop = t;
    });
  };
  put();
  requestAnimationFrame(put);
}

function renderAll() {
  const m=getMonth(), n=getNursery(), lbl=NURSERY_LABELS[n];
  syncNurseryCircles();
  // Big single-line header: "Batu Niah Nursery — Apr 2026"
  const bigHdr = `${NURSERY_NAMES[n] || lbl} — ${m}`;
  ['record','payroll'].forEach(k => {
    const el = document.getElementById(`${k}-nursery-line`);
    if (el) el.textContent = bigHdr;
  });
  // Setting has neither a month nor the top bar's nursery — it shows every
  // nursery on its own tabs — so its header is just the word.
  // Remember the last-viewed month & nursery (restored on next visit).
  try { localStorage.setItem('mjm_maint_month', m); localStorage.setItem('mjm_maint_nursery', n); } catch (_) {}
  /* The Schedule tab shows every nursery at once, so its header names the
     month instead: "Monthly Work Schedule : Aug 26". */
  // The month lives in the section head now, beside the ‹ › that step it,
  // and every panel reads the same one.
  _syncMonthButtons();
  renderPD(); renderManuring(); renderWeeding(); renderInterrow(); renderRecords();
  renderSchedCounts();
  renderSchedSummary();
  updateCarryNotice();
  // Re-render analytics when its sub-view inside Work Record is showing
  const chartView = document.getElementById('recview-chart');
  if (chartView && chartView.classList.contains('active')) renderCharts();
  const payTab = document.getElementById('tab-payroll');
  if (payTab && payTab.classList.contains('active')) renderPayroll();
}

/* ══════════════════════════════════════════════════════════════
   WHAT THE FIELD RECORDED — ONCE SOMEBODY HAS VERIFIED IT
   The FC Scan Portal's Maintenance module saves one row per job done into
   nops_maint_field_records — the date the work actually happened and the
   batches that were standing in the plot. Those are the two columns this
   page otherwise chases by phone, so they are read back here and written
   onto the matching work-record row.

   VERIFIED ONES ONLY. Saving is a worker saying what they did; it is not
   the nursery agreeing it happened. Until a Field Conductor presses Verify
   on that record, it does not reach this list, does not fill in a date, does
   not tick anybody on the Worker Record, and does not count towards the
   month. Verifying is what links it — and unverifying unlinks it again,
   through the same "the field record has gone" path that already handles a
   deleted one.

   A field record finds its row by job + plot + the round the schedule asked
   for it in ("Round 2: ..." in the racun column is the second seven-day
   block of the month, which is the week the field recorded against).

   Nothing keyed in by hand is ever overwritten: a cell is filled only while
   it is still blank, or while it holds a value this sync put there itself.
   A row an admin has Checked is left alone entirely.
══════════════════════════════════════════════════════════════ */
let fieldRecords = [];

const _FIELD_JENIS = {
  pd:       'Penyemburan racun kulat dan serangga',
  manuring: 'Membaja',
  weeding:  'Merumput',
  interrow: 'Meracun rumput secara selingan'
};

/* Every read here carries the same filter, in every fallback: a record that
   nobody has verified is not this page's business. Putting it on the query
   rather than filtering after means an unverified row never arrives, so no
   later change to this file can forget it. */
const _verifiedOnly = (q) => q.not('verified_at', 'is', null);

async function loadFieldRecords() {
  if (!_supabase) return;
  try {
    // Paged: the field writes roughly one row per plot per job per week, so
    // this table passes Supabase's 1000-row cap within a couple of months —
    // and a short read does not fail, it just quietly loses the newest work.
    let res = await _mvFetchAll(() => _verifiedOnly(_supabase.from('nops_maint_field_records')
      .select('id, work_date, plot_name, work_type, jenis, batch_name, week_no, schedule_month, qty, worked_by, reported_by, verified_at'))
      .order('id', { ascending: true }));
    // batch_name / week_no / schedule_month come from
    // shared/add_maint_field_batch.sql. Until that has been run the field is
    // still recording the work itself, so fall back to reading what is there.
    if (res.error) {
      res = await _mvFetchAll(() => _verifiedOnly(_supabase.from('nops_maint_field_records')
        .select('id, work_date, plot_name, work_type, jenis, batch_name, week_no, schedule_month, qty, worked_by, reported_by, verified_at'))
        .order('id', { ascending: true }));
      // Still no? Then this database predates the batch columns too.
      if (res.error && /column .* does not exist|schema cache/i.test(String(res.error.message || ''))) {
        res = await _mvFetchAll(() => _verifiedOnly(_supabase.from('nops_maint_field_records')
          .select('id, work_date, plot_name, work_type, jenis, worked_by, reported_by, verified_at'))
          .order('id', { ascending: true }));
      }
    }
    if (res.error) {
      /* If verified_at is what is missing, this database predates
         shared/add_maint_field_verify.sql and nothing here can tell a
         verified record from an unverified one. Link NOTHING and say so —
         linking everything would be this page quietly deciding that unchecked
         work counts, which is the one thing the change was made to stop. */
      if (/verified_at/i.test(String(res.error.message || ''))) {
        console.warn('[maint] this database has no verified_at column on '
          + 'nops_maint_field_records, so verified work cannot be told from '
          + 'unverified. Nothing is linked. Run shared/add_maint_field_verify.sql.');
        fieldRecords = [];
        return;
      }
      console.warn('[maint] field records unavailable:', res.error.message);
      return;
    }
    fieldRecords = res.data || [];
  } catch (e) { console.warn('[maint] field records unavailable:', e); }
}

/* ══════════════════════════════════════════════════════════════
   WHAT THE AUDITOR SAID
   The Auditor Portal's Maintenance module files one verdict per job into
   audit_maintenance_audits — Satisfied or Unsatisfied, with the photo and
   the remark that go with it. Only the verdict is read here: this list is
   showing whether the work passed, not conducting the audit.

   task_id is a STRING of whichever id the auditor's card was built from —
   the field record's for a job the portal submitted, this page's own record
   id for one keyed here. Both are looked up, in that order, because a job
   can exist as both and the field record is the one the auditor sees.

   A missing verdict is not a failure. Most rows have not been audited, and
   the ones that never will be still render an em dash rather than a gap.
══════════════════════════════════════════════════════════════ */
let maintAudits = {};             // task_id (string) → 'Satisfactory' | 'Unsatisfactory' | …

async function loadMaintAudits() {
  if (!_supabase) return;
  try {
    const res = await _mvFetchAll(() => _supabase
      .from('audit_maintenance_audits')
      .select('id, task_id, result, date')
      .order('id', { ascending: true }));
    if (res.error) {
      /* Almost always RLS: the audit tables are readable by staff only once
         shared/migration_audit_rls_align.sql has been run, and before that
         only by audit-module users. Say which, because a silently empty
         column looks exactly like "nothing has been audited yet". */
      console.warn('[maint] audit verdicts unavailable, so the Audit column '
        + 'will stay empty:', res.error.message);
      return;
    }
    const by = {};
    (res.data || []).forEach((a) => {
      const k = String(a.task_id == null ? '' : a.task_id);
      if (!k) return;
      /* Re-audited: the later verdict is the answer. Ordered by id above, so
         this is simply the last one seen. */
      by[k] = a.result || '';
    });
    maintAudits = by;
  } catch (e) { console.warn('[maint] audit verdicts unavailable:', e); }
}

/* Satisfied / Unsatisfied and nothing else. The auditor's table can also
   hold 'Not Done' and a row can be half-filled offline; neither is a verdict
   on the work, so neither is shown as one. */
function _auditCell(r) {
  /* One row can be several field records — three workers on one job — and
     the auditor files against each one. So every verdict on the group is
     collected, and an Unsatisfied among them wins: a job somebody failed is
     a failed job, and averaging it away is how a failure stops being seen. */
  const ids = Array.isArray(r._fieldIds) && r._fieldIds.length ? r._fieldIds : [];
  let found = ids.map((i) => maintAudits[String(i)]).filter(Boolean);
  if (!found.length) found = [maintAudits[String(r.id)]].filter(Boolean);

  const many = ids.length > 1
    ? ` (${found.length} of ${ids.length} records audited)` : '';

  if (found.includes('Unsatisfactory')) {
    return `<span class="audit-pill audit-bad" title="${t('rec.auditBadTip')}${many}">${t('rec.auditBad')}</span>`;
  }
  if (found.includes('Satisfactory')) {
    return `<span class="audit-pill audit-ok" title="${t('rec.auditOkTip')}${many}">${t('rec.auditOk')}</span>`;
  }
  return '<span style="color:var(--text-faint);">—</span>';
}

/* "Round 2: Daconil 50gm" → 2 */
/* Which of the four Worker Record sheets a job belongs on. PAYROLL_TYPES
   already says it the other way round; this is that map inverted, built once
   rather than scanned on every row. */
const _PAYROLL_TYPE_BY_JENIS = Object.keys(PAYROLL_TYPES).reduce((acc, k) => {
  acc[PAYROLL_TYPES[k].jenis] = k;
  return acc;
}, {});

/* The field ticks names from the Payroll register (mjmnpayroll_workers); this
   page counts against its own maintenance worker list (nops_maint_workers).
   They are the same people and usually the same strings, but "Ali B. Hassan"
   and "Ali b Hassan" are one worker to everybody except a string comparison —
   and a tick that lands on a name with no column here drops that worker's
   capacity out of the totals silently. So match on letters and digits, and
   return the column's own spelling so what gets written is what this page
   counts. */
function _matchWorkerName(nursery, name) {
  const key = (x) => String(x == null ? '' : x).replace(/[^a-z0-9]/gi, '').toUpperCase();
  const want = key(name);
  if (!want) return null;
  return (workers[nursery] || []).find((w) => key(w) === want) || null;
}

function _recRound(racun) {
  const m = /^\s*Round\s+(\d+)\s*:/i.exec(String(racun || ''));
  return m ? parseInt(m[1], 10) : 0;
}
/* Which seven-day block of the month a date falls in — the 29th on is the 4th,
   the same way the schedule's last round runs to the end of the month. */
function _weekOfDate(iso) {
  const day = parseInt(String(iso || '').slice(8, 10), 10);
  return day ? Math.min(4, Math.ceil(day / 7)) : 0;
}
function _isoMonthLabel(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  return m ? `${_MONTHS_SHORT[parseInt(m[2], 10) - 1]} ${m[1]}` : '';
}
const _fieldKey = (jenis, plot, week) => `${jenis}||${_mvPlotKey(plot)}||${week}`;

/* Who a field record credits the work to.

   `worked_by` is the conductor keying a job for somebody whose phone was
   broken; NULL means the person who reported it did it themselves. Both are
   read, because a job three workers each saved from their own phone has
   worked_by empty on all three, and crediting nobody for a morning three
   people spent is worse than crediting the wrong person — it is silent. */
function _fieldCredits(f) {
  const raw = String(f.worked_by || '').trim() || String(f.reported_by || '').trim();
  return raw.split(',').map((x) => x.trim()).filter(Boolean);
}

/* Every field record for one (job, plot, round), summarised.

   This used to keep ONE record per job and treat any second as a correction
   of the first. That is wrong about how the work actually happens: three
   workers on B1 Round 1 Manuring each save their own record, and they are
   not corrections of one another, they are the same job. Two of them may
   even be on different days — the crew ran out of light and finished it the
   next morning — and both days are true.

   So the group is kept whole and asked three questions:

     dates    the distinct days it was worked, earliest first. One job done
              by three people on 1 Jul is "01 Jul 2026". The same job spread
              over the 1st and the 2nd is "01 & 02 Jul 2026", because the
              schedule asked for one job and it took two mornings.
     batches  every batch anybody ticked, each named once
     workers  everybody credited, each counted once, however many records
              their name appears on — three workers, three records, three
              ticks on the Worker Record, not nine

   qty stays latest-wins rather than becoming a sum. Three workers on one
   job each report the batches THEY ticked, and on a job they did together
   that is the same batch three times: adding them would treble the plot.
   Which of "they split it" and "they shared it" is true is not something
   this table can tell from the outside, and quantities here are piece-rate
   money, so it keeps the answer it has always given. */
function _summariseFieldGroup(list) {
  const newest = list.reduce((best, f) => {
    if (!best) return f;
    const a = String(f.work_date || ''), b = String(best.work_date || '');
    return (a > b || (a === b && (f.id || 0) > (best.id || 0))) ? f : best;
  }, null);

  const uniq = (xs) => [...new Set(xs.filter(Boolean))];

  return {
    list,
    ids:     list.map((f) => f.id),
    dates:   uniq(list.map((f) => f.work_date)).sort(),
    batches: uniq(list.flatMap((f) => String(f.batch_name || '').split(',').map((x) => x.trim()))),
    workers: uniq(list.flatMap(_fieldCredits)),
    qty:     newest ? newest.qty : null,
  };
}

/* The field's answer for each (job, plot, round) of one month. */
function fieldRecordIndex(monthLbl) {
  const groups = {};
  fieldRecords.forEach(f => {
    const jenis = f.jenis || _FIELD_JENIS[f.work_type];
    if (!jenis) return;
    if ((f.schedule_month || _isoMonthLabel(f.work_date)) !== monthLbl) return;
    const week = f.week_no || _weekOfDate(f.work_date);
    if (!week) return;
    const k = _fieldKey(jenis, f.plot_name, week);
    (groups[k] || (groups[k] = [])).push(f);
  });
  const idx = {};
  Object.keys(groups).forEach((k) => { idx[k] = _summariseFieldGroup(groups[k]); });
  return idx;
}

function applyFieldRecords(nursery, monthLbl) {
  const idx = fieldRecordIndex(monthLbl);
  const plots = NURSERY_PLOTS[nursery] || [];
  /* Which Worker Record sheets this pass touched, so only those are saved. */
  const touched = new Set();
  /* Names the field credited that have no column on this page — reported
     once at the end rather than dropped without a word. */
  const unmatched = new Set();

  /* Tick the workers the field said did the job.
   
     Provenance matters more than it looks. A tick put here is marked 'field',
     and only an empty cell or another 'field' tick is ever overwritten — so a
     conductor who corrects the sheet by hand keeps his correction, and a
     field record that is later deleted takes its own ticks with it and
     nobody else's. Ticks made on this page are 1, and stay 1. */
  const syncTicks = (rec, group) => {
    const type = _PAYROLL_TYPE_BY_JENIS[rec.jenis];
    if (!type) return;
    const k = payrollKey(nursery, monthLbl, type);
    const store = payrollData[k] || (payrollData[k] = {});
    const cells = store[rec.id] || {};
    const byHand = Object.keys(cells).some((w) => cells[w] !== 'field');
    if (byHand) return;                       // somebody has answered already

    /* Everybody the whole group credits, not one record's worth. Three
       workers who each saved their own record for the same job are three
       ticks on one row, and a name on two of those records is still one
       tick — _summariseFieldGroup has already made the list distinct. */
    const names = (group && group.workers) || [];

    const next = {};
    names.forEach((n) => {
      const col = _matchWorkerName(nursery, n);
      if (col) next[col] = 'field';
      else unmatched.add(n);
    });

    // Nothing to say and nothing was said before: leave the row alone.
    if (!Object.keys(next).length && !Object.keys(cells).length) return;
    if (Object.keys(next).length) store[rec.id] = next;
    else delete store[rec.id];
    touched.add(type);
  };

  records.forEach(r => {
    if (!plots.includes(r.plot) || r.checked) return;
    const week = _recRound(r.racun);
    const g = week ? idx[_fieldKey(r.jenis, r.plot, week)] : null;
    if (!g) {
      // A cell this sync filled before whose field records have gone —
      // deleted, unverified again, or the month on screen has moved on. Put
      // it back the way it was found rather than leaving another month's
      // answer sitting in it.
      if (r._fromFieldDate)  { r.tarikh = '-'; delete r._fromFieldDate; }
      if (r._fromFieldBatch) { r.batch  = '';  delete r._fromFieldBatch; }
      if (r._fromFieldQty)   { r.qty    = null; delete r._fromFieldQty; }
      delete r._fieldDates;
      delete r._fieldIds;
      syncTicks(r, null);
      return;
    }
    /* Which field records this row is showing, so the Audit column can find
       their verdicts — the auditor files against a field record's id, not
       this page's, and one job can be several records. Cleared above when the
       link goes, so an unverified or deleted record cannot leave a verdict
       pointing at nothing. */
    r._fieldIds = g.ids.slice();
    if (!r.tarikh || r.tarikh === '-' || r._fromFieldDate) {
      /* tarikh stays ONE date — the earliest. Everything downstream reads it
         as a date and would choke on a list: the month timeline, the Worker
         Record, the filter box, the Auditor Portal's own copy of this row.
         The days beyond the first ride alongside in _fieldDates, which only
         the cell below looks at. */
      r.tarikh = g.dates[0] || '-';
      r._fieldDates = g.dates.slice();
      r._fromFieldDate = 1;
    } else {
      // Somebody keyed this date by hand. Their answer stands alone; showing
      // the field's other days beside it would be this page arguing with them.
      delete r._fieldDates;
    }
    if (g.batches.length && (!r.batch || r._fromFieldBatch)) {
      r.batch = g.batches.join(', ');
      r._fromFieldBatch = 1;
    }
    // The field counted the batches it ticked, so the quantity is already
    // answered — leaving the cell to fall back to the linked figure asked the
    // batch report a question the record had already settled.
    if (g.qty != null && g.qty !== '' && (r.qty == null || r._fromFieldQty)) {
      r.qty = Number(g.qty);
      r._fromFieldQty = 1;
    }
    syncTicks(r, g);
  });

  /* Save only the sheets that changed, and only if something did — this runs
     on every schedule sync and an unconditional write would be four upserts a
     minute for nothing. */
  touched.forEach((type) => persistPayroll(nursery, monthLbl, type));
  if (touched.size) renderPayroll();

  /* Somebody the field credited who has no column on this sheet.

     This used to be a console warning and nothing else, which was tolerable
     while the field only ever credited names a conductor had typed. It is not
     any more: a worker recording their own morning IS the credit now, so a
     name that does not match a column is that worker's share of the plot
     going missing — quietly, from a piece-rate sheet, with the row still
     looking complete. It gets said on the screen where the consequence is.

     Usually a spelling that differs by more than punctuation, or somebody
     whose register row is not a general worker of this nursery. */
  _fieldUnmatched[`${nursery}_${monthLbl}`] = [...unmatched].sort();
  if (unmatched.size) {
    console.warn('[maint] the field credited work to names with no column on '
      + 'this nursery\'s Worker Record, so their capacity is not counted:',
      [...unmatched].join(', '));
    try { renderPayroll(); } catch (_) {}
  }
}

/* Auto-sync: silently regenerate records from current schedule (no confirm, no alert) */
function autoSyncRecords() {
  const n=getNursery(), m=getMonth(), s=getState(n,m), cfg=s.pdConfig;
  const plots=NURSERY_PLOTS[n];
  const newRecs=[]; let id=Date.now();

  weekKeys(n, m, 'W').forEach(w=>{
    const c=cfg[w];
    plots.forEach(plot=>{
      if (s.pd[w]?.[plot]?.P && c.P!=='—') {
        const pStick = c.P_sticker && c.P_sticker !== '—' ? ` + ${c.P_sticker} ${c.P_sticker_dose}${c.P_sticker_unit}` : '';
        newRecs.push({id:id++, tarikh:'-', jenis:'Penyemburan racun kulat dan serangga',
          racun:`Round ${w[1]}: ${c.P} ${c.P_dose}${c.P_unit}${pStick}`,
          plot, batch:'', qty:null, carlos:0, gaia:0, remark:''});
      }
      if (s.pd[w]?.[plot]?.D && c.D!=='—') {
        const dStick = c.D_sticker && c.D_sticker !== '—' ? ` + ${c.D_sticker} ${c.D_sticker_dose}${c.D_sticker_unit}` : '';
        newRecs.push({id:id++, tarikh:'-', jenis:'Penyemburan racun kulat dan serangga',
          racun:`Round ${w[1]}: ${c.D} ${c.D_dose}${c.D_unit}${dStick}`,
          plot, batch:'', qty:null, carlos:0, gaia:0, remark:''});
      }
    });
  });
  s.manuringConfig.forEach((round, ri) => {
    round.forEach((c, ci) => {
      plots.filter(p=>s.manuring[p]?.[ri]?.[ci]).forEach(plot => {
        newRecs.push({id:id++, tarikh:'-', jenis:'Membaja',
          racun:`Round ${ri+1}: ${c.name} ${c.dose}${c.unit}`,
          plot, batch:'', qty:null, carlos:0, gaia:0, remark:''});
      });
    });
  });
  weekKeys(n, m, 'R').forEach(r=>{
    plots.filter(p=>s.weeding[p]?.[r]).forEach(plot=>{
      newRecs.push({id:id++, tarikh:'-', jenis:'Merumput',
        racun:`Round ${r[1]}: Merumput dalam polibeg`,
        plot, batch:'', qty:null, carlos:0, gaia:0, remark:''});
    });
  });
  s.interrowConfig.forEach((round, ri) => {
    round.forEach((c, ci) => {
      plots.filter(p=>s.interrow[p]?.[ri]?.[ci]).forEach(plot=>{
        newRecs.push({id:id++, tarikh:'-', jenis:'Meracun rumput secara selingan',
          racun:`Round ${ri+1}: ${c.chem} ${c.chem_dose}${c.chem_unit} + Activator ${c.activator_dose}${c.activator_unit}`,
          plot, batch:'', qty:null, carlos:0, gaia:0, remark:''});
      });
    });
  });

  // Merge: keep existing records that have been filled in (tarikh/batch/carlos/gaia),
  // add new ones that don't exist yet
  const existingKey = r => `${r.jenis}||${r.racun}||${r.plot}`;
  const existingMap = {};
  records.filter(r => NURSERY_PLOTS[n].includes(r.plot)).forEach(r => {
    existingMap[existingKey(r)] = r;
  });
  const otherNurseryRecs = records.filter(r => !NURSERY_PLOTS[n].includes(r.plot));
  const merged = newRecs.map(r => existingMap[existingKey(r)] || r);
  records = [...otherNurseryRecs, ...merged];
  // Fill the date and batch of anything the field has already reported.
  try { applyFieldRecords(n, m); } catch (e) { console.warn('[maint] field sync failed:', e); }
  renderRecords();
  persistRecords();
}
/* Show or hide the admin-only parts of the page. Called once MJMAccess has
   answered — until then the Setting tab stays hidden, which is the safe
   default if the access check is slow or fails outright. */
function applyNopsAdminUI() {
  const btn = document.getElementById('tab-btn-setting');
  if (btn) btn.style.display = isNopsAdmin ? '' : 'none';
  if (!isNopsAdmin) {
    // If a non-admin is sitting on Setting (restored tab, cached page), move
    // them back to Work Record rather than leaving the panel on screen.
    const panel = document.getElementById('tab-setting');
    if (panel && panel.classList.contains('active')) {
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('#sm-nav .pn-tab').forEach(b => b.classList.remove('is-on'));
      /* The landing tab, named rather than "the first .tab-btn" — the tabs
         have been reordered once and that selector silently pointed at a
         different one than the panel below it. */
      const land = document.getElementById('tab-schedule');
      if (land) land.classList.add('active');
      const landBtn = navTabFor('schedule');
      if (landBtn) landBtn.classList.add('is-on');
      renderSchedSummary();
    }
  }
}

/* The side bar button that opens a panel. Named by the panel it opens, so
   nothing has to keep a parallel list of which button is which. */
function navTabFor(name) {
  return document.querySelector(`#sm-nav .pn-tab[onclick*="'${name}'"]`);
}

function switchTab(name, btn) {
  // Setting holds piece rates and the worker list — admin only. The tab button
  // is hidden for everyone else, but guard the switch too so a stale button, a
  // restored tab or a console call can't get in either.
  if (name === 'setting' && !isNopsAdmin) {
    alert('Setting is for administrators only.\n\nAsk an admin if a plot capacity, ' +
          'chemical or fertiliser needs changing.');
    return;
  }
  document.querySelectorAll('#sm-nav .pn-tab').forEach(b=>b.classList.remove('is-on'));
  if (btn) btn.classList.add('is-on');
  /* The section is titled with the side bar's own wording rather than a
     second list of names here — one source, and it follows the language
     toggle without being told. */
  const title = document.getElementById('sm-title');
  const src = btn || navTabFor(name);
  if (title && src) title.textContent = src.textContent.trim();
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  const panel = document.getElementById('tab-'+name);
  if (panel) panel.classList.add('active');
  if (name==='record') { renderRecords(); if (_recordView==='chart') renderCharts(); }
  // Re-read the register on the way in, so an amendment made in the payroll
  // module a moment ago is already reflected without reloading the page.
  /* Setting has its own nursery tabs and no month, so the two pickers in the
     top bar would be choosing something it does not use. */
  const topCtrl = document.getElementById('top-nursery-ctrl');
  const noNursery = (name === 'setting' || name === 'schedule');
  if (topCtrl) topCtrl.style.display = noNursery ? 'none' : '';
  // Setting is the one panel that is not about a month.
  const monthCtrl = document.getElementById('sm-month-ctrl');
  if (monthCtrl) monthCtrl.style.display = name === 'setting' ? 'none' : '';

  if (name==='schedule') renderSchedSummary();
  if (name==='setting') renderSetting();
  if (name==='payroll') { renderPayroll(); refreshLinkedWorkers(); }
}

/* Work Record sub-views: the maintenance list and the analytics charts. */
let _recordView = 'list';
function switchRecordView(view, btn) {
  _recordView = view;
  document.querySelectorAll('.subtabs-bar .subtab-btn').forEach(b => {
    if (b.id === 'subtab-list' || b.id === 'subtab-chart') b.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.recview').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('recview-' + view);
  if (el) el.classList.add('active');
  if (view === 'chart') renderCharts(); else renderRecords();
}

/* Schedule sub-tabs: P&D / Manuring / Weeding / Interrow. */
/* ══════════════════════════════════════════════════════════════
   THE SCHEDULE, ALL FOUR PROGRAMS ON ONE PAGE

   There used to be a sub-tab per program and, inside each one, its own
   ➕ Add Row and 💾 Save Schedule. Those Save buttons were four copies of
   one button: saveSchedule() has always written all four programs at once,
   whichever tab happened to be showing. The tabs were hiding three
   quarters of what you were about to save.

   So: one toolbar, one Save, and the four programs stacked in the order
   they are worked. Each is a slab you can fold shut, and each says how
   much of itself is set, so a folded one is still answering the question
   you came to the page with. Which ones you keep folded is remembered.
   Nothing about the grids themselves changed.
══════════════════════════════════════════════════════════════ */
const SCHED_BLOCKS = ['pd', 'manuring', 'weeding', 'interrow'];
const SCHED_FOLD_KEY = 'mjm_maint_sched_folded';

function getFoldedSched() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCHED_FOLD_KEY));
    return Array.isArray(raw) ? raw.filter(k => SCHED_BLOCKS.includes(k)) : [];
  } catch (_) {
    return [];
  }
}
function setFoldedSched(list) {
  try { localStorage.setItem(SCHED_FOLD_KEY, JSON.stringify(list)); } catch (_) {}
}

function toggleSchedBlock(name) {
  const el = document.getElementById('sched-' + name);
  if (!el) return;
  const folded = el.classList.toggle('collapsed');
  const hdr = el.querySelector('.sched-block-hdr');
  if (hdr) hdr.setAttribute('aria-expanded', folded ? 'false' : 'true');
  const list = getFoldedSched().filter(k => k !== name);
  if (folded) list.push(name);
  setFoldedSched(list);
}

/* Applied on load, and never on a later render: re-folding a block somebody
   has just opened, because the month changed under them, would be the page
   arguing with them. */
function applySchedFolds() {
  const folded = getFoldedSched();
  SCHED_BLOCKS.forEach(name => {
    const el = document.getElementById('sched-' + name);
    if (!el) return;
    const off = folded.includes(name);
    el.classList.toggle('collapsed', off);
    const hdr = el.querySelector('.sched-block-hdr');
    if (hdr) hdr.setAttribute('aria-expanded', off ? 'false' : 'true');
  });
}

/* A jump chip on a folded block opens it first — otherwise it scrolls you to
   a closed door. */
function jumpToSched(name) {
  const el = document.getElementById('sched-' + name);
  if (!el) return;
  if (el.classList.contains('collapsed')) toggleSchedBlock(name);
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* How many plot-ticks each program is carrying this month. This is what
   makes a folded block still worth looking at, and it is counted from the
   same state saveSchedule() reads, so it cannot disagree with what gets
   published. */
function schedTickCount(name) {
  const n = getNursery(), m = getMonth(), s = getState(n, m), plots = NURSERY_PLOTS[n] || [];
  let count = 0;
  if (name === 'pd') {
    weekKeys(n, m, 'W').forEach(w => plots.forEach(p => {
      if (s.pd[w]?.[p]?.P) count++;
      if (s.pd[w]?.[p]?.D) count++;
    }));
  } else if (name === 'weeding') {
    weekKeys(n, m, 'R').forEach(r => plots.forEach(p => { if (s.weeding[p]?.[r]) count++; }));
  } else if (name === 'manuring') {
    s.manuringConfig.forEach((round, ri) => round.forEach((_, ci) =>
      plots.forEach(p => { if (s.manuring[p]?.[ri]?.[ci]) count++; })));
  } else if (name === 'interrow') {
    s.interrowConfig.forEach((round, ri) => round.forEach((_, ci) =>
      plots.forEach(p => { if (s.interrow[p]?.[ri]?.[ci]) count++; })));
  }
  return count;
}

function renderSchedCount(name) {
  const el = document.getElementById('sched-count-' + name);
  if (!el) return;
  const n = schedTickCount(name);
  el.textContent = n ? `${n} ${t('sched.ticked')}` : t('sched.none');
  el.classList.toggle('is-set', n > 0);
}
function renderSchedCounts() { SCHED_BLOCKS.forEach(renderSchedCount); }

/* Kept so a stale bookmark, a console call or anything else still holding the
   old name lands somewhere sensible rather than throwing. */
function switchSchedView(name) { jumpToSched(name); }

/* Nursery circle buttons drive the (hidden) select, so every existing
   getNursery() caller keeps working untouched. */
function pickNursery(n) {
  const sel = document.getElementById('global-nursery');
  if (sel) sel.value = n;
  syncNurseryCircles();
  onNurseryChange();
}
function syncNurseryCircles() {
  const cur = getNursery();
  document.querySelectorAll('.nursery-circle').forEach(b =>
    b.classList.toggle('active', b.dataset.n === cur));
}

/* The Chemical Usage Calculator and the Fertilizer Calculator were here.

   Both were removed once every schedule sheet grew the same arithmetic:
   calcMaxChem() and calcFertUsage() are called from the P & D, Manuring and
   Interrow sheets and from the PDF, against the plots actually ticked for
   that week. A separate tab asking the same question about a hand-picked
   set of plots was a third place to get an answer that the sheet already
   gave, and the one place where the chemical and its dose could be chosen
   without the schedule ever hearing about it.

   The maths did NOT go with it — see calcMaxChem, calcFertUsage,
   sumSeedlings, fmtUsage and coverageFor near the top of this file. Rates
   come from the Setting tab (nops_maint_chemicals, nops_maint_fertilisers,
   nops_maint_config), capacities from nops_maint_plot_qty. */

/* ════════════════════════════
   SHARED TABLE HELPERS
════════════════════════════ */
function mkSel(opts, selected, onch, extraStyle='') {
  return `<select class="th-sel" style="${extraStyle}" onchange="${onch}">
    ${opts.map(o=>`<option${o===selected?' selected':''}>${o}</option>`).join('')}
  </select>`;
}
function mkDose(val, unit, onch) {
  return `<div class="th-dose">
    <input class="th-dose-inp" type="number" min="0" step="1" value="${val}" onchange="${onch}">
    <span class="th-dose-unit">${unit}</span>
  </div>`;
}

/* ════════════════════════════
   P&D TABLE
════════════════════════════ */
function updatePDChem(w,f,v){
  if(!canEditSchedule) return;
  const cfg = getState(getNursery(),getMonth()).pdConfig[w];
  cfg[f] = v;
  // Auto-set unit based on the selected chemical
  if (f === 'P')         cfg.P_unit         = getUnitForChem(v);
  else if (f === 'D')    cfg.D_unit         = getUnitForChem(v);
  else if (f === 'P_sticker') cfg.P_sticker_unit = getUnitForChem(v);
  else if (f === 'D_sticker') cfg.D_sticker_unit = getUnitForChem(v);
  renderPD();
  persistStateSoon(getNursery(), getMonth());
}
function updatePDDose(w,f,v){ if(!canEditSchedule) return; getState(getNursery(),getMonth()).pdConfig[w][f]=v; renderPD(); persistStateSoon(getNursery(), getMonth()); }

function renderPD() {
  /* The four sheets were removed from the Schedule tab — the summary's
     editor holds every week of a work at once, which is what they were.
     These renderers stay because the PDF and the counts still call the
     arithmetic around them; with no table to write into they do nothing. */
  if (!document.getElementById('pd-table')) return;
  const n=getNursery(), m=getMonth(), s=getState(n,m), cfg=s.pdConfig, plots=NURSERY_PLOTS[n];
  const W=['W1','W2','W3','W4'];
  let h='<thead>';
  h+=`<tr><th rowspan="4" class="plot-col-hdr">${t('col.plot')}</th>`;
  W.forEach((w,wi)=>h+=`<th colspan="2" class="wk-th">${periodBtn('pd', wi, n, m)}</th>`);
  h+='</tr><tr>';
  W.forEach(()=>h+=`<th class="p-th">${t('hdr.pSerangga')}</th><th class="d-th">${t('hdr.dKulat')}</th>`);
  h+='</tr><tr>';
  W.forEach(w=>{
    const c=cfg[w];
    h+=`<th class="hdr-input-cell p-bg">${mkSel(chemNames('pest'),c.P,`updatePDChem('${w}','P',this.value)`)}${mkDose(c.P_dose,c.P_unit,`updatePDDose('${w}','P_dose',+this.value)`)}</th>`;
    h+=`<th class="hdr-input-cell d-bg">${mkSel(chemNames('disease'),c.D,`updatePDChem('${w}','D',this.value)`)}${mkDose(c.D_dose,c.D_unit,`updatePDDose('${w}','D_dose',+this.value)`)}</th>`;
  });
  h+='</tr><tr>';
  W.forEach(w=>{
    const c=cfg[w];
    h+=`<th class="hdr-input-cell sticker-bg">${mkSel(taggedNames('sticker'),c.P_sticker,`updatePDChem('${w}','P_sticker',this.value)`)}${mkDose(c.P_sticker_dose,c.P_sticker_unit,`updatePDDose('${w}','P_sticker_dose',+this.value)`)}</th>`;
    h+=`<th class="hdr-input-cell sticker-bg">${mkSel(taggedNames('sticker'),c.D_sticker,`updatePDChem('${w}','D_sticker',this.value)`)}${mkDose(c.D_sticker_dose,c.D_sticker_unit,`updatePDDose('${w}','D_sticker_dose',+this.value)`)}</th>`;
  });
  h+='</tr></thead><tbody>';

  // Select-all row (toggle every plot in that column at once)
  h+=`<tr class="select-all-tr"><td style="text-align:right;font-size:10px;color:#666;font-weight:600;padding-right:8px;letter-spacing:.3px">${t('act.selectAll')}</td>`;
  W.forEach(w=>{
    const allP = plots.every(p => s.pd[w]?.[p]?.P);
    const allD = plots.every(p => s.pd[w]?.[p]?.D);
    h+=`<td class="check-td${allP?' ticked':''}" style="background:#eef6ff" onclick="toggleAllPD('${w}','P')" title="Select all P for ${w}"></td>`;
    h+=`<td class="check-td${allD?' ticked':''}" style="background:#eef6ff" onclick="toggleAllPD('${w}','D')" title="Select all D for ${w}"></td>`;
  });
  h+='</tr>';

  const saved = getSavedPdSnapshot(s);
  plots.forEach(plot=>{
    h+=`<tr><td class="plot-td">${plot}</td>`;
    W.forEach(w=>{
      const pv=s.pd[w]?.[plot]?.P||false, dv=s.pd[w]?.[plot]?.D||false;
      const psv=saved[w]?.[plot]?.P||false, dsv=saved[w]?.[plot]?.D||false;
      const pMod = pv !== psv, dMod = dv !== dsv;
      h+=`<td class="check-td${pv?' ticked':''}${pMod?' modified':''}" onclick="togPD('${n}','${m}','${w}','${plot}','P',this)"></td>`;
      h+=`<td class="check-td${dv?' ticked':''}${dMod?' modified':''}" onclick="togPD('${n}','${m}','${w}','${plot}','D',this)"></td>`;
    });
    h+='</tr>';
  });
  h+=`<tr class="jumlah-tr"><td>${t('sum.jumlahPlot')}</td>`;
  W.forEach(w=>{
    h+=`<td>${plots.filter(p=>s.pd[w]?.[p]?.P).length}</td>`;
    h+=`<td>${plots.filter(p=>s.pd[w]?.[p]?.D).length}</td>`;
  });
  h+='</tr>';

  // Jumlah Bibit (total seedlings for ticked plots)
  h+=`<tr class="jumlah-tr"><td>${t('sum.jumlahBibit')}</td>`;
  W.forEach(w=>{
    const pSeed = sumSeedlings(n, plots, p => s.pd[w]?.[p]?.P);
    const dSeed = sumSeedlings(n, plots, p => s.pd[w]?.[p]?.D);
    h+=`<td>${pSeed ? pSeed.toLocaleString() : '—'}</td>`;
    h+=`<td>${dSeed ? dSeed.toLocaleString() : '—'}</td>`;
  });
  h+='</tr>';

  // Maksimal Racun Guna (max chemical usage) — 1 decimal
  h+=`<tr class="jumlah-tr"><td>${t('sum.maxRacun')}</td>`;
  W.forEach(w=>{
    const c = cfg[w];
    const pSeed = sumSeedlings(n, plots, p => s.pd[w]?.[p]?.P);
    const dSeed = sumSeedlings(n, plots, p => s.pd[w]?.[p]?.D);
    h+=`<td>${calcMaxChem(pSeed, c.P, c.P_dose, c.P_unit, 1)}</td>`;
    h+=`<td>${calcMaxChem(dSeed, c.D, c.D_dose, c.D_unit, 1)}</td>`;
  });
  h+='</tr>';

  // Maksimal Bond Guna (sticker — per column) — 1 decimal
  h+=`<tr class="jumlah-tr"><td>${t('sum.maxBond')}</td>`;
  W.forEach(w=>{
    const c = cfg[w];
    const pSeed = sumSeedlings(n, plots, p => s.pd[w]?.[p]?.P);
    const dSeed = sumSeedlings(n, plots, p => s.pd[w]?.[p]?.D);
    const pBond = (!pSeed || c.P === '—' || c.P_sticker === '—')
      ? '—' : calcMaxChem(pSeed, c.P_sticker, c.P_sticker_dose, c.P_sticker_unit, 1);
    const dBond = (!dSeed || c.D === '—' || c.D_sticker === '—')
      ? '—' : calcMaxChem(dSeed, c.D_sticker, c.D_sticker_dose, c.D_sticker_unit, 1);
    h+=`<td>${pBond}</td><td>${dBond}</td>`;
  });
  h+='</tr></tbody>';
  document.getElementById('pd-table').innerHTML=h;
  renderSchedCount('pd');
}
function togPD(n,m,w,plot,type,el){
  if(!canEditSchedule) return;
  const s=getState(n,m);
  if(!s.pd[w][plot]) s.pd[w][plot]={P:false,D:false};
  s.pd[w][plot][type]=!s.pd[w][plot][type];
  renderPD();          // full re-render so 'modified' class updates correctly
  autoSyncRecords();
  persistStateSoon(n, m);
}

function toggleAllPD(w, type){
  if(!canEditSchedule) return;
  const n=getNursery(), m=getMonth(), s=getState(n,m);
  const plots=NURSERY_PLOTS[n];
  const allTicked = plots.every(p => s.pd[w]?.[p]?.[type]);
  plots.forEach(p => {
    if (!s.pd[w][p]) s.pd[w][p] = {P:false, D:false};
    s.pd[w][p][type] = !allTicked;
  });
  renderPD();
  autoSyncRecords();
  persistStateSoon(n, m);
}

/* Saved-state snapshot for highlighting modifications after save */
function getSavedPdSnapshot(s){
  if (!s._savedPd) s._savedPd = JSON.parse(JSON.stringify(s.pd));
  return s._savedPd;
}
function snapshotPdSaved(s){
  s._savedPd = JSON.parse(JSON.stringify(s.pd));
}

/* ════════════════════════════
   MANURING TABLE
════════════════════════════ */
function updateManuringChem(ri, ci, v){
  if(!canEditSchedule) return;
  const cfg = getState(getNursery(),getMonth()).manuringConfig[ri][ci];
  cfg.name = v;
  cfg.unit = getUnitForChem(v);
  renderManuring();
  persistStateSoon(getNursery(), getMonth());
}
function updateManuringDose(ri, ci, v){
  if(!canEditSchedule) return;
  getState(getNursery(),getMonth()).manuringConfig[ri][ci].dose = v;
  renderManuring();
  persistStateSoon(getNursery(), getMonth());
}
function addManuringRound(){
  if(!canEditSchedule) return;
  const s = getState(getNursery(),getMonth());
  if (s.manuringConfig.length >= 6) return;
  s.manuringConfig.push([{name:'Yaramila', dose:20, unit:'gm'}]);
  NURSERY_PLOTS[getNursery()].forEach(p => {
    if (!s.manuring[p]) s.manuring[p] = [];
    s.manuring[p].push([false]);
  });
  renderManuring();
  // Asked for its dates straight away: adding a round is the moment somebody
  // knows when it runs, and a round left on the default week is a round
  // nobody meant to schedule for the default week.
  askNewRoundDates('manuring', s.manuringConfig.length - 1);
}
function removeManuringRound(){
  if(!canEditSchedule) return;
  const s = getState(getNursery(),getMonth());
  if (s.manuringConfig.length <= 1) return;
  // The dates go with it, or the next round added would inherit the dates
  // of the one that was removed.
  delete periodsOf(s, 'manuring')[s.manuringConfig.length - 1];
  s.manuringConfig.pop();
  NURSERY_PLOTS[getNursery()].forEach(p => {
    if (s.manuring[p]) s.manuring[p].pop();
  });
  renderManuring();
}
function addManuringCol(ri){
  if(!canEditSchedule) return;
  const s = getState(getNursery(),getMonth());
  if (!s.manuringConfig[ri] || s.manuringConfig[ri].length >= 6) return;
  s.manuringConfig[ri].push({name:'Yaramila', dose:20, unit:'gm'});
  NURSERY_PLOTS[getNursery()].forEach(p => {
    if (!s.manuring[p]) s.manuring[p] = [];
    if (!s.manuring[p][ri]) s.manuring[p][ri] = [];
    s.manuring[p][ri].push(false);
  });
  renderManuring();
}
function removeManuringCol(ri){
  if(!canEditSchedule) return;
  const s = getState(getNursery(),getMonth());
  if (!s.manuringConfig[ri] || s.manuringConfig[ri].length <= 1) return;
  s.manuringConfig[ri].pop();
  NURSERY_PLOTS[getNursery()].forEach(p => {
    if (s.manuring[p]?.[ri]) s.manuring[p][ri].pop();
  });
  renderManuring();
}

function renderManuring() {
  if (!document.getElementById('manuring-table')) return;
  const n=getNursery(), m=getMonth(), s=getState(n,m), cfg=s.manuringConfig, plots=NURSERY_PLOTS[n];
  const totalCols = cfg.reduce((sum, r) => sum + r.length, 0);
  let h='<thead>';

  // Row 1: PLOT (rowspan=5) + master header with + Round / − Round
  h+='<tr>';
  h+=`<th rowspan="5" class="plot-col-hdr">${t('col.plot')}</th>`;
  h+=`<th colspan="${totalCols}" class="wk-th">
    <div class="th-flex">
      <span class="th-title">${t('hdr.manuringRounds')}</span>
      <span class="th-actions">
        <button class="th-action-btn" onclick="addManuringRound()">${t('act.addRound')}</button>
        ${cfg.length>1?`<button class="th-action-btn th-action-danger" onclick="removeManuringRound()">${t('act.removeRound')}</button>`:''}
      </span>
    </div>
  </th>`;
  h+='</tr>';

  // Row 2: Per-round headers with + Col / − Col
  h+='<tr>';
  cfg.forEach((round, ri) => {
    h+=`<th colspan="${round.length}" class="wk-th" style="background:#0d7a47;">
      <div class="th-flex">
        <span class="th-title">${periodBtn('manuring', ri, n, m)}</span>
        <span class="th-actions">
          <button class="th-action-btn" onclick="addManuringCol(${ri})">${t('act.addCol')}</button>
          ${round.length>1?`<button class="th-action-btn th-action-danger" onclick="removeManuringCol(${ri})">${t('act.removeCol')}</button>`:''}
        </span>
      </div>
    </th>`;
  });
  h+='</tr>';

  // Row 3: Fertilizer name dropdowns
  h+='<tr>';
  cfg.forEach((round, ri) => {
    round.forEach((c, ci) => {
      h+=`<th class="hdr-input-cell f-bg">${mkSel(fertNames('monthly'),c.name,`updateManuringChem(${ri},${ci},this.value)`)}</th>`;
    });
  });
  h+='</tr>';

  // Row 4: Dose inputs
  h+='<tr>';
  cfg.forEach((round, ri) => {
    round.forEach((c, ci) => {
      h+=`<th class="hdr-input-cell f-bg-light">${mkDose(c.dose,c.unit,`updateManuringDose(${ri},${ci},+this.value)`)}</th>`;
    });
  });
  h+='</tr>';

  h+='</thead><tbody>';

  // Select-all row
  h+=`<tr class="select-all-tr"><td style="text-align:right;font-size:10px;color:#666;font-weight:600;padding-right:8px;letter-spacing:.3px">${t('act.selectAll')}</td>`;
  cfg.forEach((round, ri) => {
    round.forEach((_, ci) => {
      const all = plots.every(p => s.manuring[p]?.[ri]?.[ci]);
      h+=`<td class="check-td${all?' ticked':''}" style="background:#eef6ff" onclick="toggleAllManuring(${ri},${ci})" title="${t('act.selectAll')} ${periodText('manuring', ri, n, m)}"></td>`;
    });
  });
  h+='</tr>';

  // Plot rows
  plots.forEach(plot => {
    h+=`<tr><td class="plot-td">${plot}</td>`;
    cfg.forEach((round, ri) => {
      round.forEach((_, ci) => {
        const v = s.manuring[plot]?.[ri]?.[ci] || false;
        h+=`<td class="check-td${v?' ticked':''}" onclick="togManuring('${n}','${m}','${plot}',${ri},${ci},this)"></td>`;
      });
    });
    h+='</tr>';
  });

  // Jumlah Plot
  h+=`<tr class="jumlah-tr"><td>${t('sum.jumlahPlot')}</td>`;
  cfg.forEach((round, ri) => {
    round.forEach((_, ci) => {
      h+=`<td>${plots.filter(p=>s.manuring[p]?.[ri]?.[ci]).length}</td>`;
    });
  });
  h+='</tr>';

  // Jumlah Bibit
  h+=`<tr class="jumlah-tr"><td>${t('sum.jumlahBibit')}</td>`;
  cfg.forEach((round, ri) => {
    round.forEach((_, ci) => {
      const seed = sumSeedlings(n, plots, p => s.manuring[p]?.[ri]?.[ci]);
      h+=`<td>${seed ? seed.toLocaleString() : '—'}</td>`;
    });
  });
  h+='</tr>';

  // Maksimal Baja Guna — 1 decimal
  h+=`<tr class="jumlah-tr"><td>${t('sum.maxBaja')}</td>`;
  cfg.forEach((round, ri) => {
    round.forEach((c, ci) => {
      const seed = sumSeedlings(n, plots, p => s.manuring[p]?.[ri]?.[ci]);
      const usage = calcFertUsage(seed, c.name, c.dose, 1);
      h+=`<td>${usage.kg}</td>`;
    });
  });
  h+='</tr>';

  // Bags Needed — 1 decimal
  h+=`<tr class="jumlah-tr"><td>${t('sum.bags')}</td>`;
  cfg.forEach((round, ri) => {
    round.forEach((c, ci) => {
      const seed = sumSeedlings(n, plots, p => s.manuring[p]?.[ri]?.[ci]);
      const usage = calcFertUsage(seed, c.name, c.dose, 1);
      h+=`<td style="font-size:10px">${usage.bags}</td>`;
    });
  });
  h+='</tr></tbody>';
  document.getElementById('manuring-table').innerHTML=h;
  renderSchedCount('manuring');
}
function togManuring(n,m,plot,ri,ci,el){
  if(!canEditSchedule) return;
  const s=getState(n,m);
  if(!s.manuring[plot]) s.manuring[plot]=[];
  if(!s.manuring[plot][ri]) s.manuring[plot][ri]=[];
  s.manuring[plot][ri][ci] = !s.manuring[plot][ri][ci];
  renderManuring();
  autoSyncRecords();
  persistStateSoon(n, m);
}

function toggleAllManuring(ri, ci){
  if(!canEditSchedule) return;
  const n=getNursery(), m=getMonth(), s=getState(n,m);
  const plots=NURSERY_PLOTS[n];
  const allTicked = plots.every(p => s.manuring[p]?.[ri]?.[ci]);
  plots.forEach(p => {
    if (!s.manuring[p]) s.manuring[p] = [];
    if (!s.manuring[p][ri]) s.manuring[p][ri] = [];
    s.manuring[p][ri][ci] = !allTicked;
  });
  renderManuring();
  autoSyncRecords();
  persistStateSoon(getNursery(), getMonth());
}

/* ════════════════════════════
   WEEDING TABLE  (Round 1 & Round 2 only)
════════════════════════════ */
function renderWeeding() {
  if (!document.getElementById('weeding-table')) return;
  const n=getNursery(), m=getMonth(), s=getState(n,m), plots=NURSERY_PLOTS[n];
  const rounds=['R1','R2'];
  let h='<thead><tr>';
  h+=`<th rowspan="2" class="plot-col-hdr">${t('col.plot')}</th>`;
  h+=`<th colspan="2" class="wk-th">${t('hdr.weeding')}</th>`;
  h+='</tr><tr>';
  rounds.forEach((r,ri)=>h+=`<th class="p-th" style="min-width:130px;">${periodBtn('weeding', ri, n, m)}</th>`);
  h+='</tr></thead><tbody>';

  // Select-all row
  h+=`<tr class="select-all-tr"><td style="text-align:right;font-size:10px;color:#666;font-weight:600;padding-right:8px;letter-spacing:.3px">${t('act.selectAll')}</td>`;
  rounds.forEach(r=>{
    const all = plots.every(p => s.weeding[p]?.[r]);
    h+=`<td class="check-td${all?' ticked':''}" style="background:#eef6ff" onclick="toggleAllWeeding('${r}')"></td>`;
  });
  h+='</tr>';

  plots.forEach(plot=>{
    h+=`<tr><td class="plot-td">${plot}</td>`;
    rounds.forEach(r=>{
      const v=s.weeding[plot]?.[r]||false;
      h+=`<td class="check-td${v?' ticked':''}" onclick="togWeeding('${n}','${m}','${plot}','${r}',this)"></td>`;
    });
    h+='</tr>';
  });
  h+=`<tr class="jumlah-tr"><td>${t('sum.jumlahPlot')}</td>`;
  rounds.forEach(r=>h+=`<td>${plots.filter(p=>s.weeding[p]?.[r]).length}</td>`);
  h+='</tr></tbody>';
  document.getElementById('weeding-table').innerHTML=h;
  renderSchedCount('weeding');
}
function togWeeding(n,m,plot,r,el){
  if(!canEditSchedule) return;
  const s=getState(n,m);
  if(!s.weeding[plot]) s.weeding[plot]={R1:false,R2:false};
  s.weeding[plot][r]=!s.weeding[plot][r];
  el.textContent='';
  el.classList.toggle('ticked',s.weeding[plot][r]);
  renderWeeding();
  autoSyncRecords();
  persistStateSoon(n, m);
}
function toggleAllWeeding(r){
  if(!canEditSchedule) return;
  const n=getNursery(), m=getMonth(), s=getState(n,m);
  const plots=NURSERY_PLOTS[n];
  const all = plots.every(p => s.weeding[p]?.[r]);
  plots.forEach(p => {
    if (!s.weeding[p]) s.weeding[p] = {R1:false, R2:false};
    s.weeding[p][r] = !all;
  });
  renderWeeding();
  autoSyncRecords();
  persistStateSoon(getNursery(), getMonth());
}

/* ════════════════════════════
   INTERROW SPRAY TABLE
════════════════════════════ */
function updateInterrowChem(ri, ci, v){
  if(!canEditSchedule) return;
  const cfg = getState(getNursery(),getMonth()).interrowConfig[ri][ci];
  cfg.chem = v;
  cfg.chem_unit = getUnitForChem(v);
  renderInterrow();
  persistStateSoon(getNursery(), getMonth());
}
function updateInterrowDose(ri, ci, f, v){
  if(!canEditSchedule) return;
  getState(getNursery(),getMonth()).interrowConfig[ri][ci][f] = v;
  renderInterrow();
  persistStateSoon(getNursery(), getMonth());
}
function addInterrowRound(){
  if(!canEditSchedule) return;
  const s = getState(getNursery(),getMonth());
  if (s.interrowConfig.length >= 6) return;
  s.interrowConfig.push([{chem:'Basta', chem_dose:200, chem_unit:'mL', activator_dose:15, activator_unit:'mL'}]);
  NURSERY_PLOTS[getNursery()].forEach(p => {
    if (!s.interrow[p]) s.interrow[p] = [];
    s.interrow[p].push([false]);
  });
  renderInterrow();
  askNewRoundDates('interrow', s.interrowConfig.length - 1);
}
function removeInterrowRound(){
  if(!canEditSchedule) return;
  const s = getState(getNursery(),getMonth());
  if (s.interrowConfig.length <= 1) return;
  // The dates go with it, or the next round added would inherit the dates
  // of the one that was removed.
  delete periodsOf(s, 'interrow')[s.interrowConfig.length - 1];
  s.interrowConfig.pop();
  NURSERY_PLOTS[getNursery()].forEach(p => {
    if (s.interrow[p]) s.interrow[p].pop();
  });
  renderInterrow();
  autoSyncRecords();
  persistStateSoon(getNursery(), getMonth());
}
function addInterrowCol(ri){
  if(!canEditSchedule) return;
  const s = getState(getNursery(),getMonth());
  if (!s.interrowConfig[ri] || s.interrowConfig[ri].length >= 6) return;
  s.interrowConfig[ri].push({chem:'Basta', chem_dose:200, chem_unit:'mL', activator_dose:15, activator_unit:'mL'});
  NURSERY_PLOTS[getNursery()].forEach(p => {
    if (!s.interrow[p]) s.interrow[p] = [];
    if (!s.interrow[p][ri]) s.interrow[p][ri] = [];
    s.interrow[p][ri].push(false);
  });
  renderInterrow();
}
function removeInterrowCol(ri){
  if(!canEditSchedule) return;
  const s = getState(getNursery(),getMonth());
  if (!s.interrowConfig[ri] || s.interrowConfig[ri].length <= 1) return;
  s.interrowConfig[ri].pop();
  NURSERY_PLOTS[getNursery()].forEach(p => {
    if (s.interrow[p]?.[ri]) s.interrow[p][ri].pop();
  });
  renderInterrow();
  autoSyncRecords();
  persistStateSoon(getNursery(), getMonth());
}

function renderInterrow() {
  if (!document.getElementById('interrow-table')) return;
  const n=getNursery(), m=getMonth(), s=getState(n,m), plots=NURSERY_PLOTS[n];
  const cfg=s.interrowConfig;
  const totalCols = cfg.reduce((sum, r) => sum + r.length, 0);
  let h='<thead>';

  // Row 1: PLOT (rowspan=5) + master header with + Round / − Round
  h+='<tr>';
  h+=`<th rowspan="5" class="plot-col-hdr">${t('col.plot')}</th>`;
  h+=`<th colspan="${totalCols}" class="wk-th">
    <div class="th-flex">
      <span class="th-title">${t('hdr.interrowRounds')}</span>
      <span class="th-actions">
        <button class="th-action-btn" onclick="addInterrowRound()">${t('act.addRound')}</button>
        ${cfg.length>1?`<button class="th-action-btn th-action-danger" onclick="removeInterrowRound()">${t('act.removeRound')}</button>`:''}
      </span>
    </div>
  </th>`;
  h+='</tr>';

  // Row 2: Per-round headers with + Col / − Col
  h+='<tr>';
  cfg.forEach((round, ri) => {
    h+=`<th colspan="${round.length}" class="wk-th" style="background:#0d7a47;">
      <div class="th-flex">
        <span class="th-title">${periodBtn('interrow', ri, n, m)}</span>
        <span class="th-actions">
          <button class="th-action-btn" onclick="addInterrowCol(${ri})">${t('act.addCol')}</button>
          ${round.length>1?`<button class="th-action-btn th-action-danger" onclick="removeInterrowCol(${ri})">${t('act.removeCol')}</button>`:''}
        </span>
      </div>
    </th>`;
  });
  h+='</tr>';

  // Row 3: Chemical dropdown + dose
  h+='<tr>';
  cfg.forEach((round, ri) => {
    round.forEach((c, ci) => {
      h+=`<th class="hdr-input-cell" style="background:#f0f9ff !important;">
        ${mkSel(taggedNames('interrow'),c.chem,`updateInterrowChem(${ri},${ci},this.value)`)}
        ${mkDose(c.chem_dose,c.chem_unit,`updateInterrowDose(${ri},${ci},'chem_dose',+this.value)`)}
      </th>`;
    });
  });
  h+='</tr>';

  // Row 4: Activator dose
  h+='<tr>';
  cfg.forEach((round, ri) => {
    round.forEach((c, ci) => {
      h+=`<th class="hdr-input-cell sticker-bg">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);margin-bottom:4px;letter-spacing:0.5px;">${t('hdr.activator')}</div>
        ${mkDose(c.activator_dose,c.activator_unit,`updateInterrowDose(${ri},${ci},'activator_dose',+this.value)`)}
      </th>`;
    });
  });
  h+='</tr></thead><tbody>';

  // Select-all row
  h+=`<tr class="select-all-tr"><td style="text-align:right;font-size:10px;color:#666;font-weight:600;padding-right:8px;letter-spacing:.3px">${t('act.selectAll')}</td>`;
  cfg.forEach((round, ri) => {
    round.forEach((_, ci) => {
      const all = plots.every(p => s.interrow[p]?.[ri]?.[ci]);
      h+=`<td class="check-td${all?' ticked':''}" style="background:#eef6ff" onclick="toggleAllInterrow(${ri},${ci})" title="${t('act.selectAll')} ${periodText('interrow', ri, n, m)}"></td>`;
    });
  });
  h+='</tr>';

  // Plot rows
  plots.forEach(plot=>{
    h+=`<tr><td class="plot-td">${plot}</td>`;
    cfg.forEach((round, ri) => {
      round.forEach((_, ci) => {
        const v=s.interrow[plot]?.[ri]?.[ci]||false;
        h+=`<td class="check-td${v?' ticked':''}" onclick="togInterrow('${n}','${m}','${plot}',${ri},${ci},this)"></td>`;
      });
    });
    h+='</tr>';
  });

  // Jumlah Plot
  h+=`<tr class="jumlah-tr"><td>${t('sum.jumlahPlot')}</td>`;
  cfg.forEach((round, ri) => {
    round.forEach((_, ci) => {
      h+=`<td>${plots.filter(p=>s.interrow[p]?.[ri]?.[ci]).length}</td>`;
    });
  });
  h+='</tr>';

  // Jumlah Bibit
  h+=`<tr class="jumlah-tr"><td>${t('sum.jumlahBibit')}</td>`;
  cfg.forEach((round, ri) => {
    round.forEach((_, ci) => {
      const seed = sumSeedlings(n, plots, p => s.interrow[p]?.[ri]?.[ci]);
      h+=`<td>${seed ? seed.toLocaleString() : '—'}</td>`;
    });
  });
  h+='</tr>';

  // Max Racun Guna — 1 decimal (same formula as P&D)
  h+=`<tr class="jumlah-tr"><td>${t('sum.maxRacun')}</td>`;
  cfg.forEach((round, ri) => {
    round.forEach((c, ci) => {
      const seed = sumSeedlings(n, plots, p => s.interrow[p]?.[ri]?.[ci]);
      h+=`<td>${calcMaxChem(seed, c.chem, c.chem_dose, c.chem_unit, 1)}</td>`;
    });
  });
  h+='</tr>';

  // Max Activator Guna — 1 decimal
  h+=`<tr class="jumlah-tr"><td>${t('sum.maxActivator')}</td>`;
  cfg.forEach((round, ri) => {
    round.forEach((c, ci) => {
      const seed = sumSeedlings(n, plots, p => s.interrow[p]?.[ri]?.[ci]);
      const usage = (!seed || !c.activator_dose) ? '—' : calcMaxChem(seed, 'Activator', c.activator_dose, c.activator_unit, 1);
      h+=`<td>${usage}</td>`;
    });
  });
  h+='</tr></tbody>';
  document.getElementById('interrow-table').innerHTML=h;
  renderSchedCount('interrow');
}
function togInterrow(n,m,plot,ri,ci,el){
  if(!canEditSchedule) return;
  const s=getState(n,m);
  if(!s.interrow[plot]) s.interrow[plot]=[];
  if(!s.interrow[plot][ri]) s.interrow[plot][ri]=[];
  s.interrow[plot][ri][ci] = !s.interrow[plot][ri][ci];
  renderInterrow();
  autoSyncRecords();
  persistStateSoon(n, m);
}
function toggleAllInterrow(ri, ci){
  if(!canEditSchedule) return;
  const n=getNursery(), m=getMonth(), s=getState(n,m);
  const plots=NURSERY_PLOTS[n];
  const allTicked = plots.every(p => s.interrow[p]?.[ri]?.[ci]);
  plots.forEach(p => {
    if (!s.interrow[p]) s.interrow[p] = [];
    if (!s.interrow[p][ri]) s.interrow[p][ri] = [];
    s.interrow[p][ri][ci] = !allTicked;
  });
  renderInterrow();
  autoSyncRecords();
  persistStateSoon(getNursery(), getMonth());
}

/* ════════════════════════════
   SAVE SCHEDULE — builds the flat task list and publishes it for the worker app.
   localStorage removed — publishSchedule() is the Supabase seam (TODO below).
════════════════════════════ */
/* Publish the flat task list for the worker app to consume.
   TODO(supabase): upsert `published_schedule` for (nursery, month) = tasks. */
function publishSchedule(n, m, tasks) {
  if (!_supabase) return;
  _supabase.from('nops_maint_published')
    .upsert({ nursery: n, month: m, tasks: tasks, updated_at: new Date().toISOString() }, { onConflict: 'nursery,month' })
    .then(({ error }) => { if (error) console.warn('[maint] publish failed:', error.message); });
}
/* The button the Schedule tab actually presses: every nursery on the summary,
   not whichever one the top bar happened to be on — there is no top bar on
   this tab any more, and "Save Schedule" that saved one of four silently was
   the kind of thing nobody finds out about until a nursery has no tasks. */
function saveAllSchedules() {
  const names = capNurseries().filter(n => capPlots(n).length);
  const keys = (names.length ? names.map(schedKey) : Object.keys(NURSERY_PLOTS))
    .filter(Boolean);
  if (!keys.length) { alert('No nurseries to save — they come from Seedling Stock.'); return; }
  keys.forEach(k => saveSchedule(k, true));
  alert(`Schedule published for ${keys.length} nurser${keys.length === 1 ? 'y' : 'ies'}: ` +
        keys.map(stockLabel).join(', '));
}

/* W1..Wn and R1..Rn for a month, from the weeks somebody actually made.
   These lists were hardcoded four and two, which was right while the month
   invented its own weeks and wrong the moment weeks became something you
   add — a fifth week's ticks would have saved and never published. */
function weekKeys(n, m, prefix) {
  const out = [];
  const len = weeksOf(n, m).length;
  for (let i = 0; i < len; i++) out.push(prefix + (i + 1));
  return out;
}

function saveSchedule(nursery, quiet) {
  const n = nursery || getNursery(), m = getMonth(), s = getState(n, m);
  const plots = NURSERY_PLOTS[n];
  const tasks = [];
  let id = 1;

  // Build flat task list from schedule state
  const cfg = s.pdConfig;
  weekKeys(n, m, 'W').forEach(w => {
    const c = cfg[w];
    plots.forEach(plot => {
      if (s.pd[w]?.[plot]?.P && c.P !== '—') {
        const pStick = c.P_sticker && c.P_sticker !== '—' ? ` + ${c.P_sticker} ${c.P_sticker_dose}${c.P_sticker_unit}` : '';
        tasks.push({ id:id++, type:'pd', plot, round:w,
          jenis:'Penyemburan racun kulat dan serangga',
          chemical:`${c.P} ${c.P_dose}${c.P_unit}${pStick}`,
          detail:`P — Serangga, ${w}` });
      }
      if (s.pd[w]?.[plot]?.D && c.D !== '—') {
        const dStick = c.D_sticker && c.D_sticker !== '—' ? ` + ${c.D_sticker} ${c.D_sticker_dose}${c.D_sticker_unit}` : '';
        tasks.push({ id:id++, type:'pd', plot, round:w,
          jenis:'Penyemburan racun kulat dan serangga',
          chemical:`${c.D} ${c.D_dose}${c.D_unit}${dStick}`,
          detail:`D — Kulat, ${w}` });
      }
    });
  });
  s.manuringConfig.forEach((round, ri) => {
    round.forEach((c, ci) => {
      plots.filter(p => s.manuring[p]?.[ri]?.[ci]).forEach(plot => {
        tasks.push({ id:id++, type:'manuring', plot, round:`Round ${ri+1}`,
          jenis:'Membaja',
          chemical:`${c.name} ${c.dose}${c.unit}`,
          detail:`Manuring Round ${ri+1}` });
      });
    });
  });
  weekKeys(n, m, 'R').forEach(r => {
    plots.filter(p => s.weeding[p]?.[r]).forEach(plot => {
      tasks.push({ id:id++, type:'weeding', plot, round:`Round ${r[1]}`,
        jenis:'Merumput',
        chemical:'Merumput dalam polibeg',
        detail:`Weeding Round ${r[1]}` });
    });
  });
  s.interrowConfig.forEach((round, ri) => {
    round.forEach((c, ci) => {
      plots.filter(p => s.interrow[p]?.[ri]?.[ci]).forEach(plot => {
        tasks.push({ id:id++, type:'interrow', plot, round:`Round ${ri+1}`,
          jenis:'Meracun rumput secara selingan',
          chemical:`${c.chem} ${c.chem_dose}${c.chem_unit} + Activator ${c.activator_dose}${c.activator_unit}`,
          detail:`Interrow Spray Round ${ri+1}` });
      });
    });
  });

  // Publish the flat task list for the worker app (Supabase seam)
  publishSchedule(n, m, tasks);

  // Snapshot pd state so post-save edits get the modified highlight
  snapshotPdSaved(s);

  // Persist the full editable state (Supabase seam)
  persistState(n, m);

  if (!quiet) showSaveToast(tasks.length);
  autoSyncRecords();
  renderPD();
}

function showSaveToast(taskCount) {
  const existing = document.getElementById('save-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'save-toast';
  t.style.cssText = `position:fixed;top:70px;left:50%;transform:translateX(-50%);
    background:#0a6038;color:#fff;padding:12px 24px;border-radius:12px;
    font-size:13px;font-weight:600;z-index:300;box-shadow:0 4px 16px rgba(0,40,20,0.25);
    text-align:center;line-height:1.6;`;
  t.innerHTML = `✓ Schedule saved<br>
    <span style="font-size:11px;opacity:0.85;">${taskCount} tasks · saved to database</span>`;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.4s'; setTimeout(()=>t.remove(),400); }, 3500);
}

/* ════════════════════════════
   AUTO-SYNC WORK RECORDS FROM SCHEDULE
════════════════════════════ */
function syncRecordsFromSchedule() {
  if (!confirm('Regenerate work records from current schedule? Existing entries will be preserved.')) return;
  autoSyncRecords();
  alert(`Work records synced for ${NURSERY_LABELS[getNursery()]}.`);
}

/* ════════════════════════════
   WORK RECORDS
════════════════════════════ */
function pillCls(jenis) {
  const j=jenis.toLowerCase();
  if(j.includes('penyemburan'))   return 'pill-red';
  if(j.includes('rumput secara')) return 'pill-blue';
  if(j.includes('merumput'))      return 'pill-green';
  if(j.includes('membaja'))       return 'pill-amber';
  return 'pill-green';
}

/* ════════════════════════════════════════════════════════════════
   PLOT QUANTITY — linked to the Nursery Movement Report
   ────────────────────────────────────────────────────────────────
   A work record's Quantity is the seedling count standing in its plot
   on the date the work was done:

     per (plot, batch)  →  closing balance as at the record's date

   That is the Closing column of the Nursery Movement Report for the
   same plot, batch and date, so the two can be checked against each
   other directly — B1 / 237 on 20 Apr 2026 reads 870 in both.

   Closing is already net of 2nd culling (and 1st, 3rd, damaged and
   sold) up to that date. Nothing is deducted on top: a culling dated
   after the work had not happened yet when the work was done, so those
   seedlings were still standing and still had to be sprayed.

   A blank Batch on the record means every batch standing in that plot,
   summed. Listing batches ("234, 237, 241") restricts it to those.
════════════════════════════════════════════════════════════════ */

/* The arithmetic behind all of this lives in shared/shared_plot_movement.js:
   the movement report, this page and the payroll salary claim all quote the
   same closing balance, and three copies of it is three chances to disagree.
   The local names stay as thin aliases so nothing else here has to change. */
const _mvLogDate   = PlotMovement.logDate;
const _mvParseDate = PlotMovement.parseDate;

const _MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/* YYYY-MM-DD for the <input type="date">; '' when there is no date yet. */
function _tarikhToISO(s) {
  const ms = _mvParseDate(s);
  if (ms == null) return '';
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
/* "20 Apr 2026" for reading — one format everywhere regardless of how the
   record was originally keyed. */
function _tarikhDisplay(s) {
  const ms = _mvParseDate(s);
  if (ms == null) return '-';
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* Several days for one job, written the way somebody would say them.

   A job the crew did not finish in one morning is not two jobs, and the
   schedule asked for it once — so it stays one row, carrying the days it
   actually took. Written long, "01 Jul 2026, 02 Jul 2026" says the month and
   the year twice for no reason and does not fit the column; the parts the
   dates share are said once instead:

     one day                01 Jul 2026
     two, same month        01 & 02 Jul 2026
     three, same month      01, 02 & 03 Jul 2026
     spanning a month       30 Jun & 01 Jul 2026
     spanning a year        31 Dec 2025 & 01 Jan 2026

   Four or more is not worth reading across a table: the first day and a
   count, with all of them on the hover. */
function _datesDisplay(list) {
  const ds = (list || []).map((s) => _mvParseDate(s)).filter((ms) => ms != null)
    .sort((a, b) => a - b).map((ms) => new Date(ms));
  if (!ds.length) return '-';
  if (ds.length === 1) return _tarikhDisplay(list[0]);

  const day   = (d) => String(d.getUTCDate()).padStart(2, '0');
  const mon   = (d) => _MONTHS_SHORT[d.getUTCMonth()];
  const year  = (d) => d.getUTCFullYear();
  const join  = (parts) => (parts.length === 2
    ? `${parts[0]} & ${parts[1]}`
    : `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`);

  if (ds.length > 3) {
    const first = `${day(ds[0])} ${mon(ds[0])} ${year(ds[0])}`;
    return `${first} +${ds.length - 1}`;
  }

  const sameYear  = ds.every((d) => year(d) === year(ds[0]));
  const sameMonth = sameYear && ds.every((d) => mon(d) === mon(ds[0]));

  if (sameMonth) return `${join(ds.map(day))} ${mon(ds[0])} ${year(ds[0])}`;
  if (sameYear)  return `${join(ds.map((d) => `${day(d)} ${mon(d)}`))} ${year(ds[0])}`;
  return join(ds.map((d) => `${day(d)} ${mon(d)} ${year(d)}`));
}

/* The date cell. One day reads exactly as it always has; more than one says
   so, and says which on hover. */
function _dateCell(r) {
  const ds = Array.isArray(r._fieldDates) ? r._fieldDates : null;
  if (!ds || ds.length < 2) return _tarikhDisplay(r.tarikh);
  const all = ds.map((d) => _tarikhDisplay(d)).join(', ');
  const tip = `Worked over ${ds.length} days: ${all}. The schedule asked for `
            + 'this job once, so it stays one row.';
  return `<span class="date-multi" title="${tip.replace(/"/g, '&quot;')}">`
       + `${_datesDisplay(ds)}</span>`;
}

const _mvPlotKey    = PlotMovement.plotKey;
const _mvBatchKey   = PlotMovement.batchKey;
const _mvBatchList  = PlotMovement.batchList;
const _mvSigned     = PlotMovement.signed;
const _mvFetchAll   = PlotMovement.fetchAll;
const _liveCount    = PlotMovement.liveCount;
const linkedPlotQty = PlotMovement.linkedQty;
const recQty        = PlotMovement.recQty;
function loadMovementData() { return PlotMovement.load(_supabase); }

/* Quantity cell. A linked value is marked with 🔗 and explains itself on
   hover, so nobody mistakes a derived number for one somebody keyed. */
function _qtyCell(r) {
  const q = recQty(r);
  if (q.value === null) return '—';
  const txt = q.value.toLocaleString();
  if (!q.linked) return txt;
  const i = q.info;
  const scope = i.allBatches
    ? `all batches in plot ${r.plot}`
    : `batch ${i.batches.join(', ')}`;
  const when = i.asOf ? `as at ${i.asOf}` : 'standing today (no date keyed)';
  const tip = `Linked from the batch report — ${scope}, ${when}. This is the Nursery Movement Report's closing balance for the same plot, batch and date. Key a number here to override.`;
  return `<span class="qty-linked" title="${tip.replace(/"/g, '&quot;')}">🔗 ${txt}</span>`;
}

function renderRecords() {
  const jF   = document.getElementById('rf-filter-jenis').value;
  const pF   = document.getElementById('rf-filter-plot').value;
  const dF   = document.getElementById('rf-filter-date').value.trim().toLowerCase();
  const nF   = getNursery();   // always follows topbar nursery selector

  // Only show records whose plot belongs to the current nursery
  const nurseryPlots = NURSERY_PLOTS[nF];

  const filtered = records.filter(r => {
    if (!nurseryPlots.includes(r.plot)) return false;
    if (jF && r.jenis !== jF) return false;
    if (pF && r.plot !== pF) return false;
    // Match either the stored value or the "20 Apr 2026" form on screen.
    /* Every day the row carries, not just the first: a job worked on the
       1st and the 2nd must be found by searching for either. */
    if (dF) {
      const days = Array.isArray(r._fieldDates) && r._fieldDates.length
        ? r._fieldDates : [r.tarikh];
      const hay = days.map((x) => `${x || ''} ${_tarikhDisplay(x)}`).join(' ').toLowerCase();
      if (!hay.includes(dF)) return false;
    }
    return true;
  });

  // Metrics count only current nursery records
  const nurseryRecs = records.filter(r => nurseryPlots.includes(r.plot));
  const total  = nurseryRecs.length;
  const gDone  = nurseryRecs.filter(r=>r.gaia).length;
  const gPend  = total - gDone;
  const pct    = total ? Math.round(gDone/total*100) : 0;

  const _recMx = document.getElementById('rec-metrics');
  if (_recMx) _recMx.innerHTML=`
    <div class="metric-card mc-blue" ><div class="mc-label">${t('rec.totalTasks')}</div><div class="mc-value b">${total}</div></div>
    <div class="metric-card mc-green"><div class="mc-label">${t('rec.gaiaDone')}</div><div class="mc-value g">${gDone}</div></div>
    <div class="metric-card mc-amber"><div class="mc-label">${t('rec.gaiaPending')}</div><div class="mc-value a">${gPend}</div></div>
    <div class="metric-card mc-amber"><div class="mc-label">${t('rec.donePct')}</div><div class="mc-value a">${pct}%</div></div>
  `;

  // Repopulate plot filter — only plots from current nursery that have records
  const pSel = document.getElementById('rf-filter-plot');
  const curP = pSel.value;
  const plotPool = nurseryPlots.filter(p => records.some(r => r.plot === p));
  pSel.innerHTML = `<option value="">${t('rec.allPlot')}</option>` +
    plotPool.map(p => `<option${p===curP?' selected':''}>${p}</option>`).join('');

  const tbody = document.getElementById('rec-body');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:2.5rem;color:var(--text-faint);">${t('rec.none')}</td></tr>`;
    return;
  }

  // Group by plot — sort plots in NURSERY_PLOTS order
  const allPlots = Object.values(NURSERY_PLOTS).flat();
  const plotOrder = p => { const i = allPlots.indexOf(p); return i === -1 ? 9999 : i; };
  const plotGroups = {};
  filtered.forEach(r => {
    if (!plotGroups[r.plot]) plotGroups[r.plot] = [];
    plotGroups[r.plot].push(r);
  });
  const sortedPlots = Object.keys(plotGroups).sort((a,b) => plotOrder(a) - plotOrder(b));

  let html = '';
  sortedPlots.forEach(plot => {
    const recs = plotGroups[plot];
    html += `<tr class="plot-group-row">
      <td colspan="10" class="rec-group-cell" style="padding:12px 14px 9px;font-weight:700;letter-spacing:1px;
        text-transform:uppercase;color:var(--green-text);background:var(--green-light);
        border-top:2px solid var(--green-mid);border-bottom:1px solid var(--green-mid);">
        📍 Plot ${plot}
        <span class="rec-group-sub" style="font-weight:400;color:var(--text-muted);margin-left:8px;">
          ${recs.length} task${recs.length>1?'s':''} &nbsp;·&nbsp;
          ${recs.filter(r=>r.gaia).length} Gaia ✓
        </span>
      </td>
    </tr>`;
    recs.forEach(r => {
      html += `<tr>
        <td style="font-weight:600;color:var(--green-text);">${_dateCell(r)}</td>
        <td>${jenisLabel(r.jenis)}</td>
        <td><span class="pill ${pillCls(r.jenis)}">${r.racun||'—'}</span></td>
        <td style="text-align:center;font-weight:700;color:var(--green-text);">${r.plot}</td>
        <td style="text-align:center;color:var(--text-muted);">${r.batch||'—'}</td>
        <td style="text-align:center;font-weight:700;color:var(--text-head);">${_qtyCell(r)}</td>
        <td style="text-align:center;"><span class="chk-btn ${r.gaia?'chk-on':'chk-off'}${(r.checked && !isNopsAdmin)?' chk-locked':''}" ${(r.checked && !isNopsAdmin)?'title="Checked — only an admin can change this"':`onclick="togRec(${r.id},'gaia')"`}>${r.gaia?'☑':'☐'}</span></td>
        <td style="color:var(--text-muted);">${r.remark||'—'}</td>
        <td style="text-align:center;">${_auditCell(r)}</td>
        <td style="white-space:nowrap;">
          ${r.checked
            ? `<span class="rec-checked-badge" title="Checked — locked for normal users">✓ Checked</span>` +
              (isNopsAdmin
                ? `<button class="btn btn-sm" onclick="editRec(${r.id})">Edit</button>
                   <button class="btn btn-sm btn-danger" onclick="deleteRec(${r.id})">Del</button>
                   <button class="btn btn-sm" onclick="toggleChecked(${r.id})" title="Remove the checked lock">Uncheck</button>`
                : '')
            : `<button class="btn btn-sm btn-check" onclick="toggleChecked(${r.id})" title="Mark as checked — locks the row for normal users">✓ Check</button>
               <button class="btn btn-sm" onclick="editRec(${r.id})">Edit</button>
               <button class="btn btn-sm btn-danger" onclick="deleteRec(${r.id})">Del</button>`}
        </td>
      </tr>`;
    });
  });
  tbody.innerHTML = html;
}
let _recSaveTimer = null;
function _afterRecordChange() { try { renderPayroll(); } catch(_) {} }
function persistRecords() {
  _afterRecordChange();
  if (!_supabase || !_dbReady) return;
  clearTimeout(_recSaveTimer);
  _recSaveTimer = setTimeout(() => {
    _supabase.from('nops_maint_records')
      .upsert({ id: 1, records: records, updated_at: new Date().toISOString() })
      .then(({ error }) => { if (error) console.warn('[maint] records save failed:', error.message); });
  }, 400);
}
/* A checked row is locked to everyone except an admin of the
   Nursery Operation Manage module (User Access). */
function _recLocked(r){ return !!(r && r.checked) && !isNopsAdmin; }
function _denyLocked(){ alert('This record is Checked. Only an admin can edit it.'); }

function toggleChecked(id){
  const r = records.find(x=>x.id===id);
  if (!r) return;
  if (r.checked && !isNopsAdmin) return _denyLocked();   // only admins may unlock
  r.checked = r.checked ? 0 : 1;
  renderRecords(); persistRecords();
}
function togRec(id,f){ const r=records.find(x=>x.id===id); if(_recLocked(r)) return _denyLocked(); r[f]=r[f]?0:1; renderRecords(); persistRecords(); }
function openRecModal(pre) {
  editRecId=pre?pre.id:null;
  document.getElementById('rec-modal-title').textContent=t(editRecId?'mod.editRec':'mod.addRec');
  document.getElementById('rf-tarikh').value=_tarikhToISO(pre?.tarikh);
  document.getElementById('rf-jenis').value=pre?.jenis||'Penyemburan racun kulat dan serangga';
  document.getElementById('rf-racun').value=pre?.racun||'';
  document.getElementById('rf-plot').value=pre?.plot||'';
  document.getElementById('rf-batch').value=pre?.batch||'';
  document.getElementById('rf-qty').value=(pre && (pre.qty===0||pre.qty)) ? pre.qty : '';
  document.getElementById('rf-gaia').value=pre?.gaia||0;
  document.getElementById('rf-remark').value=pre?.remark||'';
  refreshLinkedQty();
  document.getElementById('rec-modal').classList.add('open');
}

/* Live preview of the linked quantity while the record is being keyed, so the
   number is visible before saving rather than only after. */
function refreshLinkedQty() {
  const box = document.getElementById('rf-qty-link');
  if (!box) return;
  const plot   = (document.getElementById('rf-plot').value || '').trim();
  const batch  = document.getElementById('rf-batch').value || '';
  const tarikh = document.getElementById('rf-tarikh').value || '';
  const typed  = (document.getElementById('rf-qty').value ?? '').trim();

  if (!plot) { box.innerHTML = ''; return; }
  if (!PlotMovement.ready()) {
    box.innerHTML = PlotMovement.error()
      ? `<span style="color:#a83020;">${t('link.unreachable')}</span>`
      : t('link.loading');
    return;
  }
  const link = linkedPlotQty(plot, batch, tarikh);
  if (!link) {
    const where = `${plot}${batch ? ` / ${batch}` : ''}`;
    box.innerHTML = `<span style="color:#a16207;">${t('link.none').replace('{x}', where)}</span>`;
    return;
  }
  const list  = link.batches.join(', ');
  const scope = link.allBatches ? t('link.allBatches').replace('{x}', list)
                                : t('link.someBatches').replace('{x}', list);
  const when  = link.asOf ? t('link.asAt').replace('{x}', _tarikhDisplay(link.asOf)) : t('link.today');
  const head  = typed === ''
    ? t('link.willUse').replace('{x}', `<b style="color:var(--green-text);">${link.qty.toLocaleString()}</b>`)
    : t('link.overridden').replace('{x}', `<b>${link.qty.toLocaleString()}</b>`)
                          .replace('{y}', Number(typed).toLocaleString());
  const warn = link.raw < 0
    ? `<br><span style="color:#a83020;">${t('link.negative').replace('{x}', link.raw.toLocaleString())}</span>` : '';
  box.innerHTML = `🔗 ${head}<br>${scope}, ${when} · ${t('link.basis')}${warn}`;
}
function closeRecModal(){ document.getElementById('rec-modal').classList.remove('open'); }
function editRec(id){ const r=records.find(x=>x.id===id); if(_recLocked(r)) return _denyLocked(); openRecModal(r); }
function deleteRec(id){ const r=records.find(x=>x.id===id); if(_recLocked(r)) return _denyLocked(); if(!confirm('Delete this record?')) return; records=records.filter(x=>x.id!==id); renderRecords(); persistRecords(); }
function saveRec(){
  const obj={
    // The picker yields YYYY-MM-DD; blank means the work is not dated yet.
    tarikh:(document.getElementById('rf-tarikh').value||'').trim()||'-',
    jenis:document.getElementById('rf-jenis').value,
    racun:document.getElementById('rf-racun').value,
    plot:document.getElementById('rf-plot').value.trim(),
    batch:document.getElementById('rf-batch').value,
    qty:(document.getElementById('rf-qty').value ?? '').trim()==='' ? null : Math.max(0, parseInt(document.getElementById('rf-qty').value)||0),
    gaia:+document.getElementById('rf-gaia').value,
    remark:document.getElementById('rf-remark').value,
  };
  if(!obj.plot){ alert('Please enter a plot number.'); return; }
  if(editRecId){
    const i=records.findIndex(r=>r.id===editRecId);
    if(_recLocked(records[i])) { closeRecModal(); return _denyLocked(); }
    records[i]={...records[i],...obj};
  }
  else records.push({id:Date.now(),...obj});
  closeRecModal(); renderRecords(); persistRecords();
}

/* ════════════════════════════
   PDF DOWNLOAD
════════════════════════════ */
function openPdfModal(){
  document.getElementById('pdf-nursery').value=getNursery();
  document.getElementById('pdf-month').value=monthLabelToInput(getMonth()); _syncMonthButtons();
  document.getElementById('pdf-modal').classList.add('open');
}
function closePdfModal(){ document.getElementById('pdf-modal').classList.remove('open'); }

function downloadPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const pN = document.getElementById('pdf-nursery').value;
  const pM = monthInputToLabel(document.getElementById('pdf-month').value) || getMonth();
  const s  = getState(pN, pM);
  const plots = NURSERY_PLOTS[pN];
  const label = NURSERY_LABELS[pN];
  const incPD       = document.getElementById('pdf-inc-pd').checked;
  const incManuring = document.getElementById('pdf-inc-manuring').checked;
  const incWeeding  = document.getElementById('pdf-inc-weeding').checked;
  const incInterrow = document.getElementById('pdf-inc-interrow').checked;

  const PW=210, PH=297;
  let firstPage=true;

  // Responsively size rows and columns so the whole table fits one page per section
  function computeFit(bodyColCount, headerRows, summaryRows, maxColW) {
    const titleEndY = 34;
    const bottomMargin = 10;
    const sideMargin = 8;
    const availableH = PH - titleEndY - bottomMargin;
    const availableW = PW - sideMargin * 2;
    const totalRows = headerRows + plots.length + summaryRows;
    let rowH = availableH / totalRows;
    rowH = Math.min(7.5, Math.max(3.4, rowH));
    const plotColW = Math.max(16, Math.min(24, availableW * 0.13));
    let colW = (availableW - plotColW) / bodyColCount;
    colW = Math.min(maxColW, colW);
    const tableW = plotColW + colW * bodyColCount;
    const startX = (PW - tableW) / 2;
    // Font scale based on row height
    const fontMul = rowH < 4 ? 0.7 : rowH < 5 ? 0.82 : 1;
    const fs = (size) => Math.max(5, size * fontMul);
    return { rowH, plotColW, colW, startX, fs };
  }

  function addPage(title, badge) {
    if(!firstPage) doc.addPage();
    firstPage=false;
    // Banner bar (taller, brand-green)
    doc.setFillColor(8,92,51); doc.rect(0,0,PW,20,'F');
    // Accent stripe
    doc.setFillColor(13,140,80); doc.rect(0,19.6,PW,0.5,'F');

    // Left side: brand
    doc.setTextColor(255,255,255);
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('MJM NURSERY', 14, 9);
    doc.setFontSize(8.5); doc.setFont('helvetica','normal');
    doc.setTextColor(180,220,198);
    doc.text(`${label}  ·  ${pM}`, 14, 14.5);

    // Right side: pill badge
    doc.setFontSize(9); doc.setFont('helvetica','bold');
    const badgeText = badge;
    const badgePad = 5;
    const badgeW = doc.getTextWidth(badgeText) + badgePad*2;
    const badgeH = 8;
    const badgeX = PW - 14 - badgeW;
    const badgeY = 6;
    doc.setFillColor(255,255,255);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.8, 1.8, 'F');
    doc.setTextColor(8,92,51);
    doc.text(badgeText, badgeX + badgeW/2, badgeY + 5.5, {align:'center'});

    // Section title (centered below banner)
    doc.setTextColor(30,58,42);
    doc.setFontSize(12); doc.setFont('helvetica','bold');
    doc.text(title, PW/2, 28, {align:'center'});
    // Title underline accent
    const tw = doc.getTextWidth(title);
    doc.setDrawColor(13,140,80); doc.setLineWidth(0.6);
    doc.line(PW/2 - tw/2, 30, PW/2 + tw/2, 30);
    doc.setLineWidth(0.2);
  }

  // Section-level font scale (set by computeFit) — used by cell()
  let _fontMul = 1;
  // Shared cell drawer — wraps text, auto-shrinks to fit, and centres it
  // both horizontally and vertically so BM/EN labels never clip or overflow.
  const PT2MM = 0.35278;   // 1 pt in mm
  const LINE_H = 1.12;     // line-height factor
  function cell(x, y, w, h, text, opts) {
    const o = Object.assign({
      align:'center', fill:[255,255,255], stroke:[210,221,214],
      textColor:[30,58,42], font:'helvetica', style:'normal', size:7
    }, opts||{});
    doc.setFillColor(o.fill[0], o.fill[1], o.fill[2]);
    doc.setDrawColor(o.stroke[0], o.stroke[1], o.stroke[2]);
    doc.rect(x, y, w, h, 'FD');
    if (text == null || text === '') return;
    doc.setTextColor(o.textColor[0], o.textColor[1], o.textColor[2]);
    doc.setFont(o.font, o.style);

    const padX = 1.2, padY = 0.6;
    const maxW = Math.max(1, w - padX*2);
    const maxH = Math.max(1, h - padY*2);
    const str  = String(text);

    // Shrink the font until the wrapped lines fit the cell height (width
    // always fits because splitTextToSize wraps to maxW at each size).
    let size = Math.max(4, o.size * _fontMul);
    let lines, lineH;
    for (;;) {
      doc.setFontSize(size);
      lines = doc.splitTextToSize(str, maxW);
      lineH = size * PT2MM * LINE_H;
      if (lines.length * lineH <= maxH || size <= 4) break;
      size -= 0.3;
    }
    doc.setFontSize(size);

    // Vertically centre the block; first baseline sits ~0.75 of a line down.
    const blockH = lines.length * lineH;
    let ty = y + (h - blockH) / 2 + lineH * 0.75;
    const cx = x + w / 2;
    lines.forEach(ln => { doc.text(ln, cx, ty, { align:'center' }); ty += lineH; });
  }

  const PAGE_MARGIN = 8;
  function centeredX(tableW){ return (PW - tableW) / 2; }
  /* Each P&D column is one colour top to bottom, matching the on-screen
     schedule: PEST is green, DISEASE is amber. Header, chemical, bond and the
     four summary rows all use their own column's shade, so you can read a
     column straight down without losing track of which side you are on. */
  const PALETTE = {
    headerDark:  {fill:[8,92,51],   textColor:[255,255,255]},
    // PEST column — green
    headerP:     {fill:[187,235,204], textColor:[22,101,52]},
    chemP:       {fill:[220,252,231], textColor:[22,101,52]},
    bondP:       {fill:[238,251,242], textColor:[22,101,52]},
    summaryP:    {fill:[205,242,219], textColor:[22,101,52]},
    // DISEASE column — amber
    headerD:     {fill:[253,230,168], textColor:[146,64,14]},
    chemD:       {fill:[254,243,199], textColor:[146,64,14]},
    bondD:       {fill:[255,251,235], textColor:[146,64,14]},
    summaryD:    {fill:[253,236,185], textColor:[146,64,14]},
    fert:        {fill:[255,238,210], textColor:[140,90,18]},
    altRow:      {fill:[247,250,248]},
    plain:       {fill:[255,255,255]},
    summary:     {fill:[218,245,228], textColor:[8,92,51]},
    summaryDark: {fill:[13,122,71],   textColor:[255,255,255]},
  };

  // Draw a proper checkmark inside the cell — uses lines so it always renders
  function drawCheck(x, y, w, h) {
    const cx = x + w/2;
    const cy = y + h/2;
    const sz = Math.min(w, h) * 0.45;
    doc.setDrawColor(13, 122, 71);
    doc.setLineWidth(0.8);
    doc.line(cx - sz*0.55, cy + sz*0.05, cx - sz*0.1, cy + sz*0.4);
    doc.line(cx - sz*0.1, cy + sz*0.4, cx + sz*0.6, cy - sz*0.35);
    doc.setLineWidth(0.2); // reset
  }

  /* ─── P & D SECTION ─── */
  if(incPD) {
    addPage(t('badge.pd'),t('pdf.short.pd'));
    const cfg = s.pdConfig;
    const W = ['W1','W2','W3','W4'];
    // 4 header rows (MINGGU, P/D, chem, sticker), 4 summary rows
    const fit = computeFit(8, 4, 4, 22);
    const { rowH, plotColW, colW, startX } = fit;
    _fontMul = (rowH < 4 ? 0.7 : rowH < 5 ? 0.82 : 1);
    let y = 34;

    // Row 1: PLOT header spanning 4 sub-rows + MINGGU titles
    cell(startX, y, plotColW, rowH*4, t('col.plot'), {...PALETTE.headerDark, style:'bold', size:8});
    W.forEach((w, wi) => {
      const x = startX + plotColW + wi*colW*2;
      cell(x, y, colW*2, rowH, periodText('pd', wi, pN, pM), {...PALETTE.headerDark, style:'bold', size:8});
    });
    y += rowH;

    // Row 2: P / D headers
    W.forEach((w, wi) => {
      const x = startX + plotColW + wi*colW*2;
      cell(x, y, colW, rowH, t('hdr.pSerangga'), {...PALETTE.headerP, style:'bold', size:7});
      cell(x + colW, y, colW, rowH, t('hdr.dKulat'), {...PALETTE.headerD, style:'bold', size:7});
    });
    y += rowH;

    // Row 3: chemical + dose
    W.forEach((w, wi) => {
      const c = cfg[w];
      const x = startX + plotColW + wi*colW*2;
      const pText = c.P === '—' ? '—' : `${c.P} ${c.P_dose}${c.P_unit}`;
      const dText = c.D === '—' ? '—' : `${c.D} ${c.D_dose}${c.D_unit}`;
      cell(x, y, colW, rowH, pText, {...PALETTE.chemP, size:7});
      cell(x + colW, y, colW, rowH, dText, {...PALETTE.chemD, size:7});
    });
    y += rowH;

    // Row 4: sticker per column
    W.forEach((w, wi) => {
      const c = cfg[w];
      const x = startX + plotColW + wi*colW*2;
      const pStk = (c.P_sticker && c.P_sticker !== '—') ? `${c.P_sticker} ${c.P_sticker_dose}${c.P_sticker_unit}` : '—';
      const dStk = (c.D_sticker && c.D_sticker !== '—') ? `${c.D_sticker} ${c.D_sticker_dose}${c.D_sticker_unit}` : '—';
      cell(x, y, colW, rowH, pStk, {...PALETTE.bondP, size:6.5});
      cell(x + colW, y, colW, rowH, dStk, {...PALETTE.bondD, size:6.5});
    });
    y += rowH;

    // Plot rows — empty cell if not ticked
    plots.forEach((plot, ri) => {
      const bg = ri % 2 === 0 ? PALETTE.altRow : PALETTE.plain;
      cell(startX, y, plotColW, rowH, plot, {...bg, style:'bold', size:8});
      W.forEach((w, wi) => {
        const pv = s.pd[w]?.[plot]?.P || false;
        const dv = s.pd[w]?.[plot]?.D || false;
        const x = startX + plotColW + wi*colW*2;
        cell(x, y, colW, rowH, '', bg);
        if (pv) drawCheck(x, y, colW, rowH);
        cell(x + colW, y, colW, rowH, '', bg);
        if (dv) drawCheck(x + colW, y, colW, rowH);
      });
      y += rowH;
    });

    // Jumlah Plot
    cell(startX, y, plotColW, rowH, t('sum.jumlahPlot'), {...PALETTE.summaryDark, style:'bold', size:8});
    W.forEach((w, wi) => {
      const x = startX + plotColW + wi*colW*2;
      cell(x, y, colW, rowH, String(plots.filter(p=>s.pd[w]?.[p]?.P).length), {...PALETTE.summaryP, style:'bold', size:8});
      cell(x+colW, y, colW, rowH, String(plots.filter(p=>s.pd[w]?.[p]?.D).length), {...PALETTE.summaryD, style:'bold', size:8});
    });
    y += rowH;

    // Jumlah Bibit
    cell(startX, y, plotColW, rowH, t('sum.jumlahBibit'), {...PALETTE.summaryDark, style:'bold', size:8});
    W.forEach((w, wi) => {
      const x = startX + plotColW + wi*colW*2;
      const pSeed = sumSeedlings(pN, plots, p => s.pd[w]?.[p]?.P);
      const dSeed = sumSeedlings(pN, plots, p => s.pd[w]?.[p]?.D);
      cell(x, y, colW, rowH, pSeed ? pSeed.toLocaleString() : '—', {...PALETTE.summaryP, style:'bold', size:8});
      cell(x+colW, y, colW, rowH, dSeed ? dSeed.toLocaleString() : '—', {...PALETTE.summaryD, style:'bold', size:8});
    });
    y += rowH;

    // Maksimal Racun Guna — 1 decimal
    cell(startX, y, plotColW, rowH, t('sum.maxRacun'), {...PALETTE.summaryDark, style:'bold', size:7.5});
    W.forEach((w, wi) => {
      const c = cfg[w];
      const x = startX + plotColW + wi*colW*2;
      const pSeed = sumSeedlings(pN, plots, p => s.pd[w]?.[p]?.P);
      const dSeed = sumSeedlings(pN, plots, p => s.pd[w]?.[p]?.D);
      cell(x, y, colW, rowH, calcMaxChem(pSeed, c.P, c.P_dose, c.P_unit, 1), {...PALETTE.summaryP, style:'bold', size:8});
      cell(x+colW, y, colW, rowH, calcMaxChem(dSeed, c.D, c.D_dose, c.D_unit, 1), {...PALETTE.summaryD, style:'bold', size:8});
    });
    y += rowH;

    // Maksimal Bond Guna — 1 decimal
    cell(startX, y, plotColW, rowH, t('sum.maxBond'), {...PALETTE.summaryDark, style:'bold', size:7.5});
    W.forEach((w, wi) => {
      const c = cfg[w];
      const x = startX + plotColW + wi*colW*2;
      const pSeed = sumSeedlings(pN, plots, p => s.pd[w]?.[p]?.P);
      const dSeed = sumSeedlings(pN, plots, p => s.pd[w]?.[p]?.D);
      const pBond = (!pSeed || c.P === '—' || c.P_sticker === '—') ? '—' : calcMaxChem(pSeed, c.P_sticker, c.P_sticker_dose, c.P_sticker_unit, 1);
      const dBond = (!dSeed || c.D === '—' || c.D_sticker === '—') ? '—' : calcMaxChem(dSeed, c.D_sticker, c.D_sticker_dose, c.D_sticker_unit, 1);
      cell(x, y, colW, rowH, pBond, {...PALETTE.summaryP, style:'bold', size:8});
      cell(x+colW, y, colW, rowH, dBond, {...PALETTE.summaryD, style:'bold', size:8});
    });
  }

  /* ─── MANURING SECTION ─── */
  if(incManuring) {
    addPage(t('badge.manuring'),t('pdf.short.manuring'));
    const cfg = s.manuringConfig;
    const totalCols = cfg.reduce((sum, r) => sum + r.length, 0);
    // 3 header rows (Round, fert name, dose), 4 summary rows
    const fit = computeFit(totalCols, 3, 4, 50);
    const { rowH, plotColW, colW, startX } = fit;
    _fontMul = (rowH < 4 ? 0.7 : rowH < 5 ? 0.82 : 1);
    let y = 34;

    // Row 1: PLOT (rowspan=4) + Round headers
    cell(startX, y, plotColW, rowH*4, t('col.plot'), {...PALETTE.headerDark, style:'bold', size:8});
    let xCursor = startX + plotColW;
    cfg.forEach((round, ri) => {
      const w = colW * round.length;
      cell(xCursor, y, w, rowH, periodText('manuring', ri, pN, pM), {...PALETTE.headerDark, style:'bold', size:8});
      xCursor += w;
    });
    y += rowH;

    // Row 2: fertilizer name per column
    xCursor = startX + plotColW;
    cfg.forEach(round => {
      round.forEach(c => {
        cell(xCursor, y, colW, rowH, c.name, {...PALETTE.fert, style:'bold', size:7});
        xCursor += colW;
      });
    });
    y += rowH;

    // Row 3: dose per column
    xCursor = startX + plotColW;
    cfg.forEach(round => {
      round.forEach(c => {
        cell(xCursor, y, colW, rowH, `${c.dose}${c.unit}`, {...PALETTE.fert, size:7});
        xCursor += colW;
      });
    });
    y += rowH;

    // Plot rows
    plots.forEach((plot, ri_row) => {
      const bg = ri_row % 2 === 0 ? PALETTE.altRow : PALETTE.plain;
      cell(startX, y, plotColW, rowH, plot, {...bg, style:'bold', size:8});
      xCursor = startX + plotColW;
      cfg.forEach((round, ri) => {
        round.forEach((_, ci) => {
          const v = s.manuring[plot]?.[ri]?.[ci] || false;
          cell(xCursor, y, colW, rowH, '', bg);
          if (v) drawCheck(xCursor, y, colW, rowH);
          xCursor += colW;
        });
      });
      y += rowH;
    });

    // Summary rows
    cell(startX, y, plotColW, rowH, t('sum.jumlahPlot'), {...PALETTE.summaryDark, style:'bold', size:8});
    xCursor = startX + plotColW;
    cfg.forEach((round, ri) => {
      round.forEach((_, ci) => {
        cell(xCursor, y, colW, rowH, String(plots.filter(p=>s.manuring[p]?.[ri]?.[ci]).length), {...PALETTE.summary, style:'bold', size:8});
        xCursor += colW;
      });
    });
    y += rowH;

    cell(startX, y, plotColW, rowH, t('sum.jumlahBibit'), {...PALETTE.summaryDark, style:'bold', size:8});
    xCursor = startX + plotColW;
    cfg.forEach((round, ri) => {
      round.forEach((_, ci) => {
        const seed = sumSeedlings(pN, plots, p => s.manuring[p]?.[ri]?.[ci]);
        cell(xCursor, y, colW, rowH, seed ? seed.toLocaleString() : '—', {...PALETTE.summary, size:8});
        xCursor += colW;
      });
    });
    y += rowH;

    cell(startX, y, plotColW, rowH, t('sum.maxBaja'), {...PALETTE.summaryDark, style:'bold', size:7.5});
    xCursor = startX + plotColW;
    cfg.forEach((round, ri) => {
      round.forEach((c, ci) => {
        const seed = sumSeedlings(pN, plots, p => s.manuring[p]?.[ri]?.[ci]);
        const u = calcFertUsage(seed, c.name, c.dose, 1);
        cell(xCursor, y, colW, rowH, u.kg, {...PALETTE.summary, style:'bold', size:8});
        xCursor += colW;
      });
    });
    y += rowH;

    cell(startX, y, plotColW, rowH, t('sum.bags'), {...PALETTE.summaryDark, style:'bold', size:7.5});
    xCursor = startX + plotColW;
    cfg.forEach((round, ri) => {
      round.forEach((c, ci) => {
        const seed = sumSeedlings(pN, plots, p => s.manuring[p]?.[ri]?.[ci]);
        const u = calcFertUsage(seed, c.name, c.dose, 1);
        cell(xCursor, y, colW, rowH, u.bags, {...PALETTE.summary, size:7});
        xCursor += colW;
      });
    });
  }

  /* ─── WEEDING SECTION ─── */
  if(incWeeding) {
    addPage(t('badge.weeding'),t('pdf.short.weeding'));
    const rounds = ['R1','R2'];
    // 2 header rows (ROUND, label), 1 summary row
    const fit = computeFit(rounds.length, 2, 1, 80);
    const { rowH, plotColW, colW, startX } = fit;
    _fontMul = (rowH < 4 ? 0.7 : rowH < 5 ? 0.82 : 1);
    let y = 34;

    cell(startX, y, plotColW, rowH*2, t('col.plot'), {...PALETTE.headerDark, style:'bold', size:8});
    rounds.forEach((r, i) => {
      const x = startX + plotColW + i*colW;
      cell(x, y, colW, rowH, periodText('weeding', i, pN, pM), {...PALETTE.headerDark, style:'bold', size:8});
    });
    y += rowH;
    rounds.forEach((r, i) => {
      const x = startX + plotColW + i*colW;
      cell(x, y, colW, rowH, t('pdf.merumput'), {...PALETTE.chemP, style:'bold', size:7});
    });
    y += rowH;

    plots.forEach((plot, ri) => {
      const bg = ri % 2 === 0 ? PALETTE.altRow : PALETTE.plain;
      cell(startX, y, plotColW, rowH, plot, {...bg, style:'bold', size:8});
      rounds.forEach((r, i) => {
        const x = startX + plotColW + i*colW;
        const v = s.weeding[plot]?.[r] || false;
        cell(x, y, colW, rowH, '', bg);
        if (v) drawCheck(x, y, colW, rowH);
      });
      y += rowH;
    });

    cell(startX, y, plotColW, rowH, t('sum.jumlahPlot'), {...PALETTE.summaryDark, style:'bold', size:8});
    rounds.forEach((r, i) => {
      const x = startX + plotColW + i*colW;
      cell(x, y, colW, rowH, String(plots.filter(p=>s.weeding[p]?.[r]).length), {...PALETTE.summary, style:'bold', size:8});
    });
  }

  /* ─── INTERROW SECTION ─── */
  if(incInterrow) {
    addPage(t('badge.interrow'),t('pdf.short.interrow'));
    const icfg = s.interrowConfig;
    const totalCols = icfg.reduce((sum, r) => sum + r.length, 0);
    // 3 header rows (Round, chem+dose, activator), 4 summary rows
    const fit = computeFit(totalCols, 3, 4, 50);
    const { rowH, plotColW, colW, startX } = fit;
    _fontMul = (rowH < 4 ? 0.7 : rowH < 5 ? 0.82 : 1);
    let y = 34;

    // Row 1: PLOT (rowspan=3) + Round headers spanning their columns
    cell(startX, y, plotColW, rowH*3, t('col.plot'), {...PALETTE.headerDark, style:'bold', size:8});
    let xCursor = startX + plotColW;
    icfg.forEach((round, ri) => {
      const w = colW * round.length;
      cell(xCursor, y, w, rowH, periodText('interrow', ri, pN, pM), {...PALETTE.headerDark, style:'bold', size:8});
      xCursor += w;
    });
    y += rowH;

    // Row 2: chemical + dose per column
    xCursor = startX + plotColW;
    icfg.forEach(round => {
      round.forEach(c => {
        cell(xCursor, y, colW, rowH, `${c.chem} ${c.chem_dose}${c.chem_unit}`, {...PALETTE.chemP, style:'bold', size:7});
        xCursor += colW;
      });
    });
    y += rowH;

    // Row 3: activator per column
    xCursor = startX + plotColW;
    icfg.forEach(round => {
      round.forEach(c => {
        cell(xCursor, y, colW, rowH, `Activator ${c.activator_dose}${c.activator_unit}`, {...PALETTE.bondP, style:'bold', size:7});
        xCursor += colW;
      });
    });
    y += rowH;

    // Plot rows
    plots.forEach((plot, ri_row) => {
      const bg = ri_row % 2 === 0 ? PALETTE.altRow : PALETTE.plain;
      cell(startX, y, plotColW, rowH, plot, {...bg, style:'bold', size:8});
      xCursor = startX + plotColW;
      icfg.forEach((round, ri) => {
        round.forEach((_, ci) => {
          const v = s.interrow[plot]?.[ri]?.[ci] || false;
          cell(xCursor, y, colW, rowH, '', bg);
          if (v) drawCheck(xCursor, y, colW, rowH);
          xCursor += colW;
        });
      });
      y += rowH;
    });

    // Summary rows
    cell(startX, y, plotColW, rowH, t('sum.jumlahPlot'), {...PALETTE.summaryDark, style:'bold', size:8});
    xCursor = startX + plotColW;
    icfg.forEach((round, ri) => {
      round.forEach((_, ci) => {
        cell(xCursor, y, colW, rowH, String(plots.filter(p=>s.interrow[p]?.[ri]?.[ci]).length), {...PALETTE.summary, style:'bold', size:8});
        xCursor += colW;
      });
    });
    y += rowH;

    cell(startX, y, plotColW, rowH, t('sum.jumlahBibit'), {...PALETTE.summaryDark, style:'bold', size:8});
    xCursor = startX + plotColW;
    icfg.forEach((round, ri) => {
      round.forEach((_, ci) => {
        const seed = sumSeedlings(pN, plots, p => s.interrow[p]?.[ri]?.[ci]);
        cell(xCursor, y, colW, rowH, seed ? seed.toLocaleString() : '—', {...PALETTE.summary, size:8});
        xCursor += colW;
      });
    });
    y += rowH;

    cell(startX, y, plotColW, rowH, t('sum.maxRacun'), {...PALETTE.summaryDark, style:'bold', size:7.5});
    xCursor = startX + plotColW;
    icfg.forEach((round, ri) => {
      round.forEach((c, ci) => {
        const seed = sumSeedlings(pN, plots, p => s.interrow[p]?.[ri]?.[ci]);
        cell(xCursor, y, colW, rowH, calcMaxChem(seed, c.chem, c.chem_dose, c.chem_unit, 1), {...PALETTE.summary, style:'bold', size:8});
        xCursor += colW;
      });
    });
    y += rowH;

    cell(startX, y, plotColW, rowH, t('sum.maxActivator'), {...PALETTE.summaryDark, style:'bold', size:7.5});
    xCursor = startX + plotColW;
    icfg.forEach((round, ri) => {
      round.forEach((c, ci) => {
        const seed = sumSeedlings(pN, plots, p => s.interrow[p]?.[ri]?.[ci]);
        const usage = (!seed || !c.activator_dose) ? '—' : calcMaxChem(seed, 'Activator', c.activator_dose, c.activator_unit, 1);
        cell(xCursor, y, colW, rowH, usage, {...PALETTE.summary, style:'bold', size:8});
        xCursor += colW;
      });
    });
  }

  doc.save(`MJM_Maintenance_${pN}_${pM.replace(' ','_')}.pdf`);
  closePdfModal();
}

/* ════════════════════════════
   ANALYTICS
════════════════════════════ */
let staffInst = null;
let plotInst  = null;

function renderCharts() {
  const chartN = getNursery();
  const nurseryPlots = NURSERY_PLOTS[chartN];

  // Update label
  const lbl = document.getElementById('chart-nursery-label');
  if (lbl) lbl.textContent = NURSERY_LABELS[chartN];

  const recs = records.filter(r => nurseryPlots.includes(r.plot));

  const total    = recs.length;
  const gDone    = recs.filter(r => r.gaia).length;
  const gPend    = total - gDone;
  const bothDone = recs.filter(r => r.gaia).length; // same as gDone now
  const pct      = total ? Math.round(gDone/total*100) : 0;

  // ── Metric cards — single horizontal row ──
  const _chartMx = document.getElementById('chart-metrics');
  if (_chartMx) _chartMx.innerHTML = `
    <div class="metric-card mc-blue" ><div class="mc-label">Total Tasks</div><div class="mc-value b">${total}</div></div>
    <div class="metric-card mc-green"><div class="mc-label">Gaia Done</div><div class="mc-value g">${gDone}</div></div>
    <div class="metric-card mc-amber"><div class="mc-label">Gaia Pending</div><div class="mc-value a">${gPend}</div></div>
    <div class="metric-card mc-amber"><div class="mc-label">Done %</div><div class="mc-value a">${pct}%</div></div>
  `;

  // ── Chart 1: Monthly task completion ──
  const monthlyDone    = Array(12).fill(0);
  const monthlyPending = Array(12).fill(0);
  const curMi = MONTHS_SHORT.indexOf(getMonth().split(' ')[0]);
  recs.forEach(r => {
    // Split on '-' only ever worked for two of the three stored formats;
    // the shared parser handles every one of them.
    const ms = _mvParseDate(r.tarikh);
    if (ms != null) {
      const mi = new Date(ms).getUTCMonth();
      if (r.gaia) monthlyDone[mi]++;
      else monthlyPending[mi]++;
    } else {
      if (curMi >= 0) monthlyPending[curMi]++;
    }
  });

  if (barInst) barInst.destroy();
  barInst = new Chart(document.getElementById('mainChart'), {
    type: 'bar',
    data: { labels: MONTHS_SHORT, datasets: [
      { label:'Done',    data:monthlyDone,    backgroundColor:'rgba(13,122,71,0.82)', borderRadius:4, stack:'s' },
      { label:'Pending', data:monthlyPending, backgroundColor:'rgba(217,119,6,0.65)', borderRadius:4, stack:'s' },
    ]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ stacked:true, ticks:{font:{size:13},color:'#4d7060'}, grid:{color:'rgba(0,80,40,0.06)'} },
        y:{ stacked:true, ticks:{font:{size:13},color:'#4d7060',stepSize:1}, grid:{color:'rgba(0,80,40,0.06)'} }
      }
    }
  });

  // ── Chart 2: By Jenis Kerja — horizontal bar, full names, value labels ──
  const jL = ['Penyemburan racun kulat dan serangga','Meracun rumput secara selingan','Merumput','Membaja'];
  const jFullNames = ['P&D Racun\n(Penyemburan)', 'Interrow Spray\n(Racun Rumput)', 'Weeding\n(Merumput)', 'Manuring\n(Membaja)'];
  const jCounts = jL.map(j => recs.filter(r => r.jenis===j).length);
  const jColors = ['rgba(192,57,43,0.85)','rgba(245,158,11,0.85)','rgba(13,122,71,0.85)','rgba(29,78,216,0.85)'];

  const valueLabelPlugin = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const val = jCounts[i];
        if (!val) return;
        ctx.fillStyle = '#1e3a2a';
        ctx.font = 'bold 15px Outfit, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(val, bar.x + 8, bar.y);
      });
      ctx.restore();
    }
  };

  if (jenisInst) jenisInst.destroy();
  jenisInst = new Chart(document.getElementById('jenisChart'), {
    type: 'bar',
    plugins: [valueLabelPlugin],
    data: {
      labels: ['P&D Racun', 'Interrow Spray', 'Weeding', 'Manuring'],
      datasets: [{
        label: 'Records',
        borderRadius: 6,
        data: jCounts,
        backgroundColor: jColors,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { font:{ size:13 }, color:'#4d7060' },
          grid: { color:'rgba(0,80,40,0.06)' },
          suggestedMax: Math.max(...jCounts, 1) * 1.25
        },
        y: {
          ticks: { font:{ size:14, weight:'600' }, color:'#1e3a2a', crossAlign:'far' },
          grid: { display: false }
        }
      },
      layout: { padding: { right: 40 } }
    }
  });

  // ── Chart 3: Gaia completion doughnut ──
  if (staffInst) staffInst.destroy();
  staffInst = new Chart(document.getElementById('staffChart'), {
    type:'doughnut',
    data:{ labels:['Gaia Done','Gaia Pending'],
      datasets:[{
        data:[gDone, gPend],
        backgroundColor:['rgba(13,122,71,0.85)','rgba(220,245,234,0.9)'],
        borderWidth:3, borderColor:'#fff',
      }]
    },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'60%',
      plugins:{ legend:{ position:'bottom', labels:{font:{size:14},color:'#4d7060',boxWidth:14,padding:20} } }
    }
  });

  // ── Chart 4: Completion by Plot (Gaia only) ──
  const activePlots = nurseryPlots.filter(p => recs.some(r => r.plot===p));
  const plotGaia    = activePlots.map(p => recs.filter(r => r.plot===p && r.gaia).length);
  const plotPending = activePlots.map(p => recs.filter(r => r.plot===p && !r.gaia).length);

  if (plotInst) plotInst.destroy();
  plotInst = new Chart(document.getElementById('plotChart'), {
    type:'bar',
    data:{ labels:activePlots, datasets:[
      { label:'Gaia ✓',  data:plotGaia,    backgroundColor:'rgba(13,122,71,0.82)', borderRadius:3, stack:'s' },
      { label:'Pending', data:plotPending, backgroundColor:'rgba(229,231,235,0.9)', borderRadius:3, stack:'s' },
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'top', labels:{font:{size:13},color:'#4d7060',boxWidth:14,padding:18} } },
      scales:{
        x:{ stacked:true, ticks:{font:{size:12},color:'#4d7060',maxRotation:0,minRotation:0}, grid:{display:false} },
        y:{ stacked:true, ticks:{font:{size:13},color:'#4d7060',stepSize:1}, grid:{color:'rgba(0,80,40,0.06)'} }
      }
    }
  });
}

/* ════════════════════════════
   INIT
════════════════════════════ */
document.getElementById('rec-modal').addEventListener('click', e=>{ if(e.target===e.currentTarget) closeRecModal(); });
document.getElementById('pdf-modal').addEventListener('click', e=>{ if(e.target===e.currentTarget) closePdfModal(); });

// Boot straight into the app (previously done on successful login)
// Restore the last-used month & nursery before the first render.
try {
  const savedMonth   = localStorage.getItem('mjm_maint_month');
  const savedNursery = localStorage.getItem('mjm_maint_nursery');
  const mSel = document.getElementById('global-month');
  const nSel = document.getElementById('global-nursery');
  const now = new Date();
  mSel.value = monthLabelToInput(savedMonth)
            || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (savedNursery && Array.from(nSel.options).some(o => o.value === savedNursery)) nSel.value = savedNursery;
} catch (_) {}
_syncMonthButtons();
syncNurseryCircles();
applyLang();        // applies saved language + renders all views
applySchedFolds();  // whichever schedule blocks this person keeps folded
autoSyncRecords();

/* ── Initial load from Supabase ─────────────────────────────────
   Pulls every saved schedule payload, the work-records list and the
   plot-qty overrides, then re-renders. Writes are held back until this
   completes (_dbReady) so the seed data can never clobber saved rows. */
async function initDb() {
  if (!_supabase) { _dbReady = true; return; }
  try {
    if (typeof MJMAccess !== 'undefined') {
      try {
        await MJMAccess.load(_supabase);
        isNopsAdmin = MJMAccess.isAdminOf('nursery_ops');
      } catch (e) { console.warn('[maint] access load failed:', e); }
      applyNopsAdminUI();
    }
    const [stRes, recRes, qtyRes, cpRes, prRes, wkRes, regRes, payRes, lockRes] = await Promise.all([
      _supabase.from('nops_maint_state').select('nursery, month, payload'),
      _supabase.from('nops_maint_records').select('records').eq('id', 1).maybeSingle(),
      // trays arrives with migration_nops_maint_settings.sql; without it the
      // select 400s, so ask for it and fall back to the columns that predate it.
      _supabase.from('nops_maint_plot_qty').select('nursery, plot, qty, trays')
        .then(r => r.error ? _supabase.from('nops_maint_plot_qty').select('nursery, plot, qty') : r,
              () => _supabase.from('nops_maint_plot_qty').select('nursery, plot, qty')),
      _supabase.from('nops_maint_custom_plots').select('nursery, plot').then(r => r, () => ({ data: [] })),
      _supabase.from('nops_maint_piece_rates').select('nursery, work_type, rate').then(r => r, () => ({ data: [] })),
      _supabase.from('nops_maint_workers').select('nursery, name').then(r => r, () => ({ data: [] })),
      // The register the worker names really come from — see loadLinkedWorkers.
      _supabase.from('mjmnpayroll_workers').select('*').then(r => r, e => ({ error: e })),
      _supabase.from('nops_maint_payroll').select('nursery, month, work_type, data').then(r => r, () => ({ data: [] })),
      _supabase.from('nops_maint_rate_lock').select('nursery, locked').then(r => r, () => ({ data: [] })),
      // What the Field Conductors have already recorded — read alongside the
      // rest so the first paint of Work Record already carries their dates.
      loadFieldRecords(),
      // And what the auditor made of them, for the Audit column.
      loadMaintAudits(),
      // The Setting tab's own four lists, and the plot names they hang off.
      loadSharedPlots(),
      loadSettingLists()
    ]);
    (stRes.data || []).forEach(r => {
      dbStateCache[`${r.nursery}_${r.month}`] = r.payload;
    });
    // The page renders once before this load returns, so the open month already
    // holds a blank state built when the cache was empty. Drop every month that
    // has not actually been edited yet, so each is rebuilt from what the
    // database now holds — its own saved schedule, or the one carried forward
    // from the last month that was set. Anything edited in the meantime stays.
    Object.keys(appState).forEach(n => {
      Object.keys(appState[n] || {}).forEach(m => {
        if (!appState[n][m] || !appState[n][m]._touched) delete appState[n][m];
      });
    });
    if (recRes.data && Array.isArray(recRes.data.records) && recRes.data.records.length) {
      records = recRes.data.records;
    }
    (qtyRes.data || []).forEach(r => {
      if (!plotQtyOverrides[r.nursery]) plotQtyOverrides[r.nursery] = {};
      plotQtyOverrides[r.nursery][r.plot] = r.qty;
    });
    ((cpRes && cpRes.data) || []).forEach(r => {
      if (!customPlots[r.nursery]) customPlots[r.nursery] = [];
      if (!customPlots[r.nursery].includes(r.plot)) customPlots[r.nursery].push(r.plot);
    });
    _mergeCustomPlots();
    // Rates saved before they were per-nursery have no nursery column — apply
    // those to every nursery so nothing already keyed in disappears.
    if (prRes && prRes.error) {
      _rateLoadErr = prRes.error.message || String(prRes.error);
      console.warn('[maint] piece rates could not be read:', _rateLoadErr);
    }
    ((prRes && prRes.data) || []).forEach(r => {
      const targets = r.nursery ? [r.nursery] : Object.keys(pieceRates);
      targets.forEach(n => { nurseryRates(n)[r.work_type] = r.rate; });
    });
    // This module's own old list — now only the fallback for a nursery that
    // is not on the payroll register yet.
    ((wkRes && wkRes.data) || []).forEach(r => {
      if (!_localWorkers[r.nursery]) _localWorkers[r.nursery] = [];
      if (!_localWorkers[r.nursery].includes(r.name)) _localWorkers[r.nursery].push(r.name);
    });
    _linkAt = Date.now();
    if (regRes && regRes.error) {
      _linkErr = regRes.error.message || String(regRes.error);
      console.warn('[maint] worker register could not be read:', _linkErr);
    } else {
      _linkErr = null;
      _linkedWorkers = generalWorkersByNursery((regRes && regRes.data) || []);
    }
    resolveWorkers();
    ((payRes && payRes.data) || []).forEach(r => {
      payrollData[payrollKey(r.nursery, r.month, r.work_type)] = r.data || {};
    });
    ((lockRes && lockRes.data) || []).forEach(r => { rateLocks[r.nursery] = !!r.locked; });
    ((qtyRes && qtyRes.data) || []).forEach(r => {
      if (r.trays == null) return;
      if (!plotTrays[r.nursery]) plotTrays[r.nursery] = {};
      plotTrays[r.nursery][r.plot] = +r.trays || 0;
    });
  } catch (e) { console.warn('[maint] initial DB load failed:', e); }
  _dbReady = true;
  /* Land on the tab the markup marks active, through switchTab, so the side
     effects of being on it happen — Schedule hides the top bar's nursery
     picker, which it shows every nursery of. */
  try {
    const landing = document.querySelector('.tab-panel.active');
    const key = landing && landing.id.replace(/^tab-/, '');
    if (key) switchTab(key, navTabFor(key));
  } catch (_) {}
  /* The schedules build their dropdowns from `chemicals` and `fertilisers`,
     neither of which existed at first paint. */
  renderAll();
  autoSyncRecords();

  // The batch-report ledger is a separate, larger read — don't hold the page
  // on it. Repaint the pieces that show a linked quantity once it lands.
  loadMovementData().then(() => {
    if (!PlotMovement.ready()) return;
    try { renderRecords(); } catch (_) {}
    try { renderPayroll(); } catch (_) {}
    try { refreshLinkedQty(); } catch (_) {}
  });
}
initDb();
/* ═══════════════════════════════════════════════════════════════════════
   SETTING TAB
   Four lists the schedules and the calculator read from. What used to be
   here — piece rates, workers, a hand-keyed plot list — has gone to its own
   module, to the FC Portal, and to shared_plots respectively.
   See shared/migration_nops_maint_settings.sql for the tables.
═══════════════════════════════════════════════════════════════════════ */

let traySize   = {};    // { nursery: seedlings per tray }
let plotTrays  = {};    // { nursery: { plot: trays } }
/* Stock Management's own list, kept apart from NURSERY_PLOTS.

   NURSERY_PLOTS is the hardcoded list the four schedules and the payroll
   still run on. Merging stock's plots into it looked tidy and was not: the
   two spellings differ — "UNN1" here is "UNN 1" there — so the merge added
   nurseries rather than reconciling them, and the Setting page grew six
   tabs for four places. The Setting page reads THESE and nothing else. */
/* Declared at the top of the file, not here — renderAll() runs during script
   evaluation (applyLang calls it), and a `let` at this depth would still be in
   the temporal dead zone when the summary reads it. See the block by
   `chemicals`. */
let _sharedPlotsLoaded = false;

/* ── Where the plot names come from ────────────────────────────────────
   shared_plots, which Seedling Stock owns and every other module already
   reads. MERGED into NURSERY_PLOTS rather than replacing it: a plot that
   only the hardcoded list knows about is still carrying saved schedule
   rows, and dropping it would take those rows off the screen. So shared
   data adds what is missing and nothing is taken away. */
async function loadSharedPlots() {
  if (!_supabase) return;
  const [nRes, pRes] = await Promise.all([
    _supabase.from('operation_nurseries').select('name').order('name')
      .then(r => r, e => ({ error: e })),
    _supabase.from('shared_plots').select('nursery_name, plot_name')
      .then(r => r, e => ({ error: e }))
  ]);

  if (pRes && pRes.error) console.warn('[maint] shared_plots read failed:', pRes.error.message);
  const plots = (pRes && pRes.data) || [];
  stockPlots = {};
  plots.forEach(r => {
    const n = (r.nursery_name || '').trim();
    const p = (r.plot_name || '').trim();
    if (!n || !p) return;
    if (!stockPlots[n]) stockPlots[n] = [];
    if (stockPlots[n].indexOf(p) === -1) stockPlots[n].push(p);
  });
  Object.keys(stockPlots).forEach(n => stockPlots[n].sort(plotOrder));
  _sharedPlotsLoaded = plots.length > 0;

  /* Nurseries in Stock Management's own order, and only ones that have
     plots — a tab onto an empty list is a tab onto nothing. A nursery that
     only shared_plots knows about is added after, so no plot is unreachable. */
  if (nRes && nRes.error) console.warn('[maint] operation_nurseries read failed:', nRes.error.message);
  stockNurseries = (((nRes && nRes.data) || []).map(r => (r.name || '').trim()))
    .filter(n => n && (stockPlots[n] || []).length);
  Object.keys(stockPlots).forEach(n => {
    if (stockNurseries.indexOf(n) === -1) stockNurseries.push(n);
  });
}

/* B1, B2, B10 — not B1, B10, B2. A plot name is a letter run and a number,
   and the number is a number. Anything after it (B13-R) sorts beside the
   plot it belongs to rather than at the end of the alphabet. */
function plotOrder(a, b) {
  const m = v => (String(v).match(/^([^0-9]*)(\d*)(.*)$/) || []).slice(1);
  const [ap, an, at] = m(a), [bp, bn, bt] = m(b);
  if (ap !== bp) return ap.localeCompare(bp, 'en');
  if (an !== bn) return (+an || 0) - (+bn || 0);
  return at.localeCompare(bt, 'en');
}

async function loadSettingLists() {
  if (!_supabase) return;
  const [tsRes, chRes, feRes, cfgRes] = await Promise.all([
    _supabase.from('nops_maint_tray_size').select('nursery, per_tray').then(r => r, () => ({ data: [] })),
    _supabase.from('nops_maint_chemicals').select('*').order('sort_order').order('name')
      .then(r => r, () => ({ data: [] })),
    _supabase.from('nops_maint_fertilisers').select('*').order('sort_order').order('name')
      .then(r => r, () => ({ data: [] })),
    _supabase.from('nops_maint_config').select('key, num_value').then(r => r, () => ({ data: [] }))
  ]);
  ((tsRes && tsRes.data) || []).forEach(r => { traySize[r.nursery] = +r.per_tray || 0; });
  const cfg = ((cfgRes && cfgRes.data) || []).find(r => r.key === 'pump_coverage');
  if (cfg && +cfg.num_value > 0) pumpCoverage = +cfg.num_value;
  chemicals   = (chRes && chRes.data) || [];
  fertilisers = (feRes && feRes.data) || [];
}

/* ── Plot capacity ─────────────────────────────────────────────────────
   Every nursery at once, in the shape the Chemical List uses: headed
   columns of thin rows.

   It used to be one nursery at a time behind its own tab bar. Somebody
   setting capacities up is going through all four, not looking at one, so
   the tabs made one job into four screens — and made "Edit" and "Save"
   mean one nursery, which is not what anybody means by saving a capacity
   table. Now Edit opens all of them and Save writes all of them.

   A nursery with more plots than fit a readable column is split across
   several, each headed with the range it covers: Pre Nursery's 52 plots
   are four columns of fourteen rather than one column of fifty-two.

   A main nursery plot is counted in polybags; a pre nursery plot in trays,
   which come to seedlings once. Same row, different question — so the pre
   nursery columns carry a third figure and their own tray size.
────────────────────────────────────────────────────────────────────────── */
const isPreNursery = n => n === 'PN' || /^pre/i.test(n || '');

/* How many plots to a column. Fourteen keeps every column about the same
   height whatever the nursery, and happens to be exactly BNN. */
const CAP_CHUNK = 14;

let capEditing = false;
let capDraft   = null;   // { nursery: { plots:{plot:number}, perTray:number } }

function trayQty(n, p) {
  return (plotTrays[n] && plotTrays[n][p] != null) ? +plotTrays[n][p] || 0 : 0;
}

/* What the dosage is worked out from, whichever way the plot is counted. */
function capacityOf(n, p) {
  return isPreNursery(n) ? trayQty(n, p) * (traySize[n] || 0) : getPlotQty(n, p);
}

/* The nurseries this block offers, and the plots under each. Both come from
   Seedling Stock. Falls back to the built-in list so the block is never
   empty on a database that cannot be read. */
function capNurseries() { return stockNurseries; }
function capPlots(n)     { return (stockPlots[n] || []).slice(); }

function renderSetting() {
  renderCapacity();
  renderChemBoth();
  renderFertilisers();
}

function renderCapacity() {
  const wrap = document.getElementById('cap-cols');
  if (!wrap) return;

  const editBtn = document.getElementById('cap-edit-btn');
  if (editBtn) editBtn.style.display = capEditing ? 'none' : '';
  const acts = document.getElementById('cap-actions');
  if (acts) acts.style.display = capEditing ? 'flex' : 'none';

  const nurseries = capNurseries().filter(n => capPlots(n).length);
  const empty = document.getElementById('cap-empty');
  if (!nurseries.length) {
    wrap.innerHTML = '';
    if (empty) {
      empty.style.display = '';
      empty.innerHTML = 'No plots yet. They come from Seedling Stock — add them ' +
        'there and they appear here.';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  wrap.innerHTML = nurseries.map(capNurseryHtml).join('');
}

/* One nursery: its name and, if it counts in trays, its tray size — said
   once over however many columns its plots need. The columns wrap as a
   group, so a nursery is never split across two rows of the page. */
function capNurseryHtml(n) {
  const pre = isPreNursery(n), plots = capPlots(n);

  /* Divide evenly rather than filling columns to CAP_CHUNK and leaving the
     last one short: eighteen plots is two columns of nine, not fourteen and
     four. Ragged columns read as if the short one meant something. */
  const parts = Math.max(1, Math.ceil(plots.length / CAP_CHUNK));
  const size  = Math.ceil(plots.length / parts);

  let h = '<div class="cap-nursery' + (pre ? ' cap-nursery-tray' : '') + '" data-nursery="' + esc(n) + '">';
  h += '<div class="cap-nursery-h"><span class="cap-nursery-n">' + esc(n) + '</span>';
  if (pre) {
    h += '<span class="cap-tray"><span>Per tray</span>' +
         '<input type="number" min="0" step="1" data-tray="' + esc(n) + '" ' +
           'value="' + ((capEditing ? capDraft[n].perTray : traySize[n]) || '') + '" ' +
           (capEditing ? '' : 'disabled ') +
           'oninput="onDraftTraySize(\'' + esc(n) + '\', this.value)"></span>';
  }
  h += '</div><div class="cap-nursery-cols">';

  for (let i = 0; i < parts; i++) {
    h += '<div class="cap-col">';
    h += '<div class="cap-head"><span>Plot</span>' +
         (pre ? '<span>Trays</span><span>Seedlings</span>' : '<span>Capacity</span>') +
         '</div>';
    h += plots.slice(i * size, (i + 1) * size).map(p => capRowHtml(n, p, pre)).join('');
    h += '</div>';
  }
  return h + '</div></div>';
}

function capRowHtml(n, p, pre) {
  const shown = pre ? trayQty(n, p) : getPlotQty(n, p);
  const draft = capEditing ? (capDraft[n].plots[p] ?? '') : null;
  return '<div class="cap-row" data-nursery="' + esc(n) + '" data-plot="' + esc(p) + '">' +
    '<span class="cap-row-n">' + esc(p) + '</span>' +
    (capEditing
      ? '<input type="number" min="0" step="1" value="' + draft + '" placeholder="0" ' +
          'oninput="onDraftInput(\'' + esc(n) + '\', \'' + esc(p) + '\', this.value)">'
      : '<span class="cap-row-v' + (shown ? '' : ' muted') + '">' +
          (shown ? shown.toLocaleString() : '—') + '</span>') +
    (pre ? '<span class="cap-row-d" data-derived>' + derivedText(n, p) + '</span>' : '') +
    '</div>';
}

/* What a pre nursery plot's trays come to, from whichever numbers are live —
   the draft while editing, the saved ones otherwise. */
function derivedText(n, p) {
  const trays = capEditing ? (+capDraft[n].plots[p] || 0) : trayQty(n, p);
  const per   = capEditing ? (+capDraft[n].perTray || 0) : (traySize[n] || 0);
  if (!per || !trays) return '—';
  return (trays * per).toLocaleString();
}

/* ── The edit cycle ────────────────────────────────────────────────────
   Nothing is written until Save. A capacity is read by every dosage on the
   page, so a half-typed number must not be one of them, and a mistake has
   to be undoable by walking away. Edit takes in every nursery at once,
   because that is the job. */
function startCapEdit() {
  capDraft = {};
  capNurseries().forEach(n => {
    const pre = isPreNursery(n);
    const d = { plots: {}, perTray: traySize[n] || '' };
    capPlots(n).forEach(p => {
      const v = pre ? trayQty(n, p) : getPlotQty(n, p);
      d.plots[p] = v || '';
    });
    capDraft[n] = d;
  });
  capEditing = true;
  renderCapacity();
}

function cancelCapEdit() {
  capEditing = false; capDraft = null;
  renderCapacity();
}

function onDraftInput(n, plot, val) {
  if (!capEditing || !capDraft[n]) return;
  capDraft[n].plots[plot] = val === '' ? '' : Math.max(0, +val || 0);
  refreshDerived(n, plot);
}

function onDraftTraySize(n, val) {
  if (!capEditing || !capDraft[n]) return;
  capDraft[n].perTray = val === '' ? '' : Math.max(0, +val || 0);
  // Every plot's seedling figure in that nursery just changed and none of the
  // boxes did, so the derived lines redraw and the inputs are left alone.
  capPlots(n).forEach(p => refreshDerived(n, p));
  // The nursery's other columns each carry the same box; keep them level
  // without repainting the one being typed in.
  document.querySelectorAll('[data-tray="' + CSS.escape(n) + '"]').forEach(el => {
    if (el !== document.activeElement) el.value = capDraft[n].perTray;
  });
}

/* Only the line beside the box being typed in — repainting the grid would
   take the focus out of it on every keystroke. */
function refreshDerived(n, plot) {
  if (!isPreNursery(n)) return;
  const row = document.querySelector(
    '.cap-row[data-nursery="' + CSS.escape(n) + '"][data-plot="' + CSS.escape(plot) + '"]');
  const el = row && row.querySelector('[data-derived]');
  if (el) el.textContent = derivedText(n, plot);
}

async function saveCapEdit() {
  if (!capEditing || !_supabase) { cancelCapEdit(); return; }
  const btns = document.getElementById('cap-actions');
  if (btns) btns.querySelectorAll('button').forEach(b => b.disabled = true);

  /* Every nursery, in one pass. One upsert per nursery rather than one for
     the lot, because the pre nursery's rows carry a column the others do
     not and the trays fallback below is per nursery. */
  const nurseries = capNurseries().filter(n => capDraft[n] && capPlots(n).length);
  const staged = [];
  let failure = null;

  for (const n of nurseries) {
    const pre = isPreNursery(n);
    const stamp = new Date().toISOString();
    const rows = capPlots(n).map(p => {
      const v = capDraft[n].plots[p] === '' ? 0 : +capDraft[n].plots[p] || 0;
      return pre
        ? { nursery: n, plot: p, trays: v, qty: v * (+capDraft[n].perTray || 0), updated_at: stamp }
        : { nursery: n, plot: p, qty: v, updated_at: stamp };
    });

    let { error } = await _supabase.from('nops_maint_plot_qty')
      .upsert(rows, { onConflict: 'nursery,plot' }).then(r => r, e => ({ error: e }));

    /* No trays column → migration_nops_maint_settings.sql has not been run.
       The seedling figure is the one everything else reads, so it is saved
       without the trays rather than not at all. */
    if (error && pre && /trays/i.test(error.message || '')) {
      const flat = rows.map(r => ({ nursery: r.nursery, plot: r.plot, qty: r.qty, updated_at: r.updated_at }));
      ({ error } = await _supabase.from('nops_maint_plot_qty')
        .upsert(flat, { onConflict: 'nursery,plot' }).then(r => r, e => ({ error: e })));
    }

    if (!error && pre) {
      await _supabase.from('nops_maint_tray_size')
        .upsert({ nursery: n, per_tray: +capDraft[n].perTray || 0, updated_at: stamp },
                { onConflict: 'nursery' })
        .then(r => r, () => ({}));
    }

    if (error) { failure = { n, error }; break; }
    staged.push({ n, pre, rows });
  }

  /* Whatever landed is made true on screen, even if a later nursery failed —
     re-rendering those back to their old figures would be telling somebody
     their saved numbers were not saved. */
  staged.forEach(({ n, pre, rows }) => {
    if (!plotQtyOverrides[n]) plotQtyOverrides[n] = {};
    if (!plotTrays[n]) plotTrays[n] = {};
    rows.forEach(r => {
      plotQtyOverrides[n][r.plot] = r.qty;
      if (pre) plotTrays[n][r.plot] = r.trays;
    });
    if (pre) traySize[n] = +capDraft[n].perTray || 0;
  });

  if (btns) btns.querySelectorAll('button').forEach(b => b.disabled = false);

  if (failure) {
    // Stay in edit mode: the nurseries that did not save still hold what was
    // typed, and walking away is the one thing that would lose it.
    renderCapacity();
    alert('Saved ' + staged.length + ' of ' + nurseries.length + ' nurseries.\n\n' +
          failure.n + ' could not be saved — ' + (failure.error.message || 'try again'));
    return;
  }

  capEditing = false; capDraft = null;
  renderCapacity();
}

/* ── Chemicals, pest and disease ───────────────────────────────────────
   One table, one `kind`, shown as two columns of one list, edited as one
   block: Edit unlocks both columns at once, Cancel throws the lot away and
   Save writes it. Nothing reaches the database until Save — a dose is what
   somebody mixes to, so a half-typed one must never be readable as a rate.

   The dosage is keyed the way it is written on the drum — so much per pump
   — and per seedling is worked out from it. `coverage` is how many
   seedlings one pump covers: 800 for a normal spray, and 1 for a chemical
   like Asir whose dose IS per seedling. That number used to be a hardcoded
   exception (CHEMICAL_COVERAGE) which this page did not know about, so it
   divided Asir by 800 as well and disagreed with the Dosage Calculator. It
   is a column now, and shown. */
const CHEM_LABEL = { pest: 'pest', disease: 'disease', other: 'other' };
const CHEM_KINDS = ['pest', 'disease', 'other'];

/* How many seedlings one pump covers, for every chemical that does not name
   its own figure. Preset in nops_maint_config so it can be changed without a
   deploy; COVERAGE_PER_PUMP is the fallback until that row is read, and
   stays the number the rest of this file has always used. */
let presetDraft = null;

let chemEditing = false;
let chemDraft   = null;    // [{ id?, kind, name, dose, unit, coverage, _new }]
let fertEditing = false;
let fertDraft   = null;

/* A chemical's own coverage when it has one, the preset when it does not.
   NULL is not 0 here: "follow the preset" and "one seedling to a pump" are
   different answers, and only one of them should move when the preset does. */
function livePreset() {
  return Math.max(1, +(presetDraft != null ? presetDraft : pumpCoverage) || COVERAGE_PER_PUMP);
}
function coverageOf(c) {
  return c.coverage == null || c.coverage === '' ? livePreset() : Math.max(1, +c.coverage || 1);
}

/* Enough decimal places to be worth printing. 30gm over 800 seedlings is
   0.0375 — rounded to two it reads 0.04 and the arithmetic stops adding up. */
function perSeedling(dose, coverage) {
  const v = (+dose || 0) / Math.max(1, +coverage || livePreset());
  if (!v) return null;
  return v < 0.01 ? v.toFixed(4) : v < 1 ? v.toFixed(3) : String(+v.toFixed(2));
}

function chemRows(kind) {
  return (chemEditing ? chemDraft : chemicals).filter(c => c.kind === kind);
}

function renderChemicals(kind) {
  const box = document.getElementById('chem-' + kind + '-list');
  if (!box) return;

  document.querySelectorAll('.chem-add').forEach(b => b.style.display = chemEditing ? '' : 'none');
  const eb = document.getElementById('chem-edit-btn');
  if (eb) eb.style.display = chemEditing ? 'none' : '';
  const ac = document.getElementById('chem-actions');
  if (ac) ac.style.display = chemEditing ? 'flex' : 'none';

  const rows = chemRows(kind);
  if (!rows.length) {
    box.innerHTML = '<div class="lst-empty">No ' + CHEM_LABEL[kind] +
      (chemEditing ? ' chemical yet — add one below.' : ' chemical listed.') + '</div>';
    return;
  }
  /* Only the Other list carries a tag. Pest and disease already have a
     dropdown each on the P & D sheet; the ones in Other only appear on a
     sheet if this says which. */
  const tagged = kind === 'other';
  const TAG_LABEL = { sticker: 'Sticker', interrow: 'Interrow' };

  box.innerHTML = rows.map((c, i) => {
    const per = perSeedling(c.dose, c.coverage);
    const val = per ? per + ' ' + esc(c.unit || 'gm') : '—';
    return '<div class="lst-row' + (tagged ? ' other-row' : '') + '">' + (chemEditing
      ? '<input type="text" value="' + esc(c.name) + '" placeholder="Chemical name" ' +
          'oninput="onChemDraft(\'' + kind + '\',' + i + ',\'name\', this.value)">' +
        // The unit rides with the number it belongs to. Without it a new
        // chemical could only ever be gm, and half of these are mL.
        '<span class="lst-dose">' +
          '<input type="number" min="0" step="0.01" value="' + (c.dose ?? '') + '" placeholder="0" ' +
            'oninput="onChemDraft(\'' + kind + '\',' + i + ',\'dose\', this.value)">' +
          '<select onchange="onChemDraft(\'' + kind + '\',' + i + ',\'unit\', this.value)">' +
            '<option value="gm"' + ((c.unit || 'gm') === 'gm' ? ' selected' : '') + '>gm</option>' +
            '<option value="mL"' + (c.unit === 'mL' ? ' selected' : '') + '>mL</option>' +
          '</select>' +
        '</span>' +
        '<input type="number" min="1" step="1" ' +
          'value="' + (c.coverage == null || c.coverage === '' ? '' : c.coverage) + '" ' +
          'placeholder="' + livePreset() + '" ' +
          'title="Leave blank to follow the preset. 1 if the dose is already per seedling." ' +
          'oninput="onChemDraft(\'' + kind + '\',' + i + ',\'coverage\', this.value)">' +
        '<span class="lst-calc' + (per ? '' : ' none') + '">' + val + '</span>' +
        (tagged
          ? '<select class="lst-tagsel" title="Which schedule dropdown may offer this" ' +
              'onchange="onChemDraft(\'' + kind + '\',' + i + ',\'tag\', this.value)">' +
              '<option value=""' + (!c.tag ? ' selected' : '') + '>—</option>' +
              '<option value="sticker"' + (c.tag === 'sticker' ? ' selected' : '') + '>Sticker</option>' +
              '<option value="interrow"' + (c.tag === 'interrow' ? ' selected' : '') + '>Interrow</option>' +
            '</select>'
          : '') +
        '<button type="button" class="lst-x" title="Remove" aria-label="Remove" ' +
          'onclick="dropChemRow(\'' + kind + '\',' + i + ')">&#10005;</button>'
      : '<span class="lst-txt">' + esc(c.name) + '</span>' +
        '<span class="lst-num">' + (+c.dose || 0) + ' ' + esc(c.unit || 'gm') + '</span>' +
        '<span class="lst-num' + (c.coverage == null || c.coverage === '' ? ' preset' : '') + '">' +
          coverageOf(c).toLocaleString() + '</span>' +
        '<span class="lst-calc' + (per ? '' : ' none') + '">' + val + '</span>' +
        (tagged ? '<span class="lst-num' + (c.tag ? '' : ' muted') + '">' +
                    (TAG_LABEL[c.tag] || '—') + '</span>' : '') +
        '<span></span>') +
    '</div>';
  }).join('');
}

function renderChemBoth() {
  const inp = document.getElementById('pump-coverage');
  if (inp) {
    inp.disabled = !chemEditing;
    if (document.activeElement !== inp) inp.value = livePreset();
  }
  CHEM_KINDS.forEach(renderChemicals);
}

function onPresetInput(val) {
  if (!chemEditing) return;
  presetDraft = Math.max(1, +val || 1);
  // Every chemical following the preset just changed, and none of the boxes
  // did — so the derived cells redraw and the inputs are left alone.
  CHEM_KINDS.forEach(k => {
    const box = document.getElementById('chem-' + k + '-list');
    if (!box) return;
    chemRows(k).forEach((c, i) => {
      if (c.coverage != null && c.coverage !== '') return;
      const cell = box.querySelectorAll('.lst-row')[i]?.querySelector('.lst-calc');
      if (!cell) return;
      const per = perSeedling(c.dose, null);
      cell.textContent = per ? per + ' ' + (c.unit || 'gm') : '—';
      cell.classList.toggle('none', !per);
    });
  });
}

function startChemEdit() {
  chemDraft = chemicals.map(c => ({ id: c.id, kind: c.kind, name: c.name, dose: c.dose,
                                    unit: c.unit || 'gm', coverage: c.coverage ?? null,
                                    tag: c.tag ?? null }));
  presetDraft = pumpCoverage;
  chemEditing = true;
  renderChemBoth();
}

function cancelChemEdit() {
  chemEditing = false; chemDraft = null; presetDraft = null;
  renderChemBoth();
}

/* The draft is filtered per column for display, so an index within a column
   has to be turned back into the row it names in the whole draft. */
function draftAt(draft, kind, i) {
  return draft.filter(c => c.kind === kind)[i];
}

function onChemDraft(kind, i, field, val) {
  const row = draftAt(chemDraft, kind, i);
  if (!row) return;
  if (field === 'name') { row.name = val; return; }           // repaint would lose the caret
  if (field === 'unit') row.unit = val === 'mL' ? 'mL' : 'gm';
  else if (field === 'tag') row.tag = val || null;
  // Blank is "follow the preset", which is why it is not coerced to a number.
  else if (field === 'coverage') row.coverage = val === '' ? null : Math.max(1, +val || 1);
  else row[field] = Math.max(0, +val || 0);
  // Only the derived cell beside the box being typed in.
  const box = document.getElementById('chem-' + kind + '-list');
  const cell = box && box.querySelectorAll('.lst-row')[i]?.querySelector('.lst-calc');
  if (cell) {
    const per = perSeedling(row.dose, row.coverage);
    cell.textContent = per ? per + ' ' + (row.unit || 'gm') : '—';
    cell.classList.toggle('none', !per);
  }
}

function addChemRow(kind) {
  if (!chemEditing) return;
  // No coverage of its own: a new chemical follows the preset until told
  // otherwise, which is true of nearly all of them.
  chemDraft.push({ kind: kind, name: '', dose: 0, unit: 'gm', coverage: null,
                   tag: null, _new: true });
  renderChemicals(kind);
  const box = document.getElementById('chem-' + kind + '-list');
  const last = box && box.querySelector('.lst-row:last-child input[type=text]');
  if (last) last.focus();
}

function dropChemRow(kind, i) {
  const row = draftAt(chemDraft, kind, i);
  if (!row) return;
  if (row.name && !confirm('Remove “' + row.name + '” from the ' + CHEM_LABEL[kind] + ' list?')) return;
  chemDraft.splice(chemDraft.indexOf(row), 1);
  renderChemicals(kind);
}

/* A database that has not run every migration refuses a write in one of
   two ways, and both take the WHOLE row down over one field:

   - "Could not find the 'tag' column … in the schema cache" — the column
     does not exist yet (migration_nops_chem_tag.sql unrun).
   - "null value in column \"coverage\" … violates not-null constraint" —
     the column exists but still demands a number, because the migration
     that taught it NULL-means-follow-the-preset is the unrun one
     (migration_nops_chem_other_preset.sql).

   Losing one field is a smaller failure than losing the save, so either
   way the field is dropped from the payload and the write tried again: an
   UPDATE then keeps the row's old value, an INSERT takes the table's own
   default. The caller's alert names shared/RUN_ME_maintenance_setting.sql,
   which ends the need for any of this. */
function columnFallback() {
  const dropped = new Set();
  const note = e => {
    const msg = (e && e.message) || '';
    const m = /find the '([a-z_]+)' column/i.exec(msg) ||
              /null value in column "([a-z_]+)"/i.exec(msg);
    if (m && !dropped.has(m[1])) { dropped.add(m[1]); return true; }
    return false;
  };
  return {
    dropped,
    strip(o) { const out = { ...o }; dropped.forEach(k => delete out[k]); return out; },
    async attempt(run) {
      for (let go = 0; go < 4; go++) {
        const { error } = await run().then(r => r, e => ({ error: e }));
        if (!error) return null;
        if (!note(error)) return error;
      }
      return { message: 'this database refused too many columns' };
    }
  };
}

async function saveChemEdit() {
  const named = chemDraft.map(c => ({ ...c, name: (c.name || '').trim() })).filter(c => c.name);
  // Two of the same name in one column would break the table's own unique
  // index halfway through the save, leaving half of it written.
  for (const k of CHEM_KINDS) {
    const seen = new Set();
    for (const c of named.filter(x => x.kind === k)) {
      const key = c.name.toLowerCase();
      if (seen.has(key)) { alert('“' + c.name + '” is on the ' + CHEM_LABEL[k] + ' list twice.'); return; }
      seen.add(key);
    }
  }

  const btns = document.getElementById('chem-actions');
  if (btns) btns.querySelectorAll('button').forEach(b => b.disabled = true);
  const done = () => { if (btns) btns.querySelectorAll('button').forEach(b => b.disabled = false); };

  if (_supabase) {
    const keep = new Set(named.filter(c => c.id).map(c => String(c.id)));
    const gone = chemicals.filter(c => !keep.has(String(c.id))).map(c => c.id);

    const fallback = columnFallback();
    const { strip, attempt } = fallback;

    let err = null;
    if (gone.length) {
      err = await attempt(() => _supabase.from('nops_maint_chemicals').delete().in('id', gone));
    }
    for (const c of named.filter(x => x.id)) {
      if (err) break;
      err = await attempt(() => _supabase.from('nops_maint_chemicals').update(strip({
        name: c.name, dose: +c.dose || 0, unit: c.unit || 'gm', coverage: c.coverage ?? null,
        tag: c.tag ?? null, updated_at: new Date().toISOString() })).eq('id', c.id));
    }
    if (!err && named.some(x => !x.id)) {
      err = await attempt(() => _supabase.from('nops_maint_chemicals').insert(
        named.filter(c => !c.id).map(c => strip({
          kind: c.kind, name: c.name, dose: +c.dose || 0, unit: c.unit || 'gm',
          coverage: c.coverage ?? null, tag: c.tag ?? null,
          updated_at: new Date().toISOString() }))));
    }
    if (!err && presetDraft != null && +presetDraft !== +pumpCoverage) {
      const { error } = await _supabase.from('nops_maint_config').upsert({
        key: 'pump_coverage', num_value: +presetDraft,
        updated_at: new Date().toISOString() }, { onConflict: 'key' })
        .then(r => r, e => ({ error: e }));
      if (!error) pumpCoverage = +presetDraft;
      else console.warn('[maint] pump coverage save failed:', error.message);
    }
    if (err) {
      done();
      alert('Could not save — ' + (err.message || 'try again') +
            (/kind/i.test(err.message || '')
              ? '\n\nThis database does not allow Other chemicals yet. ' +
                'Run shared/RUN_ME_maintenance_setting.sql in the Supabase SQL Editor.' : ''));
      return;
    }
    if (fallback.dropped.size) {
      alert('Saved — but this database could not take ' +
            [...fallback.dropped].join(', ') + ' the way the screen means ' +
            (fallback.dropped.size > 1 ? 'them' : 'it') +
            ', so existing rows kept their old value there.\n\n' +
            'Run shared/RUN_ME_maintenance_setting.sql in the Supabase SQL Editor ' +
            'once, then save again.');
    }
    // Read it back, so what is on screen is what is stored — and so the new
    // rows arrive with the ids the next edit needs.
    const { data } = await _supabase.from('nops_maint_chemicals').select('*')
      .order('sort_order').order('name').then(r => r, () => ({ data: null }));
    if (data) chemicals = data;
    else chemicals = named;
  } else {
    chemicals = named.map((c, i) => ({ ...c, id: c.id || 'local-' + i }));
  }

  done();
  if (presetDraft != null) pumpCoverage = livePreset();
  chemEditing = false; chemDraft = null; presetDraft = null;
  renderChemBoth();
}


/* ── Fertilisers ───────────────────────────────────────────────────────
   One dosage and two ticks. The table keeps a dose per usage, which is the
   shape to grow into if transplanting and monthly manuring ever want
   different rates; until then a tick writes this dose into that usage and
   clearing it writes NULL, so "not used for this work" stays distinct from
   "used at nothing per seedling". */
function fertDose(f) {
  return f.dose_transplant != null ? f.dose_transplant
       : f.dose_monthly    != null ? f.dose_monthly : '';
}

function renderFertilisers() {
  const box = document.getElementById('fert-list');
  if (!box) return;

  const add = document.getElementById('fert-add');
  if (add) add.style.display = fertEditing ? '' : 'none';
  const eb = document.getElementById('fert-edit-btn');
  if (eb) eb.style.display = fertEditing ? 'none' : '';
  const ac = document.getElementById('fert-actions');
  if (ac) ac.style.display = fertEditing ? 'flex' : 'none';

  const rows = fertEditing ? fertDraft : fertilisers;
  if (!rows.length) {
    box.innerHTML = '<div class="lst-empty">No fertiliser ' +
      (fertEditing ? 'yet — add one below.' : 'listed.') + '</div>';
    return;
  }
  const tick = on => '<span class="lst-tick-ro' + (on ? '' : ' off') + '">' +
                     (on ? '&#10003;' : '&#8211;') + '</span>';
  box.innerHTML = rows.map((f, i) => '<div class="lst-row fert-row">' + (fertEditing
    ? '<input type="text" value="' + esc(f.name) + '" placeholder="Fertiliser type" ' +
        'oninput="onFertDraft(' + i + ',\'name\', this.value)">' +
      '<span class="lst-dose">' +
        '<input type="number" min="0" step="0.0001" value="' + fertDose(f) + '" placeholder="0" ' +
          'oninput="onFertDraft(' + i + ',\'dose\', this.value)">' +
        '<select onchange="onFertDraft(' + i + ',\'unit\', this.value)">' +
          '<option value="gm"' + ((f.unit || 'gm') === 'gm' ? ' selected' : '') + '>gm</option>' +
          '<option value="mL"' + (f.unit === 'mL' ? ' selected' : '') + '>mL</option>' +
        '</select>' +
      '</span>' +
      '<span class="lst-tick"><input type="checkbox" ' + (f.dose_transplant != null ? 'checked ' : '') +
        'onchange="onFertUse(' + i + ',\'dose_transplant\', this.checked)"></span>' +
      '<span class="lst-tick"><input type="checkbox" ' + (f.dose_monthly != null ? 'checked ' : '') +
        'onchange="onFertUse(' + i + ',\'dose_monthly\', this.checked)"></span>' +
      '<button type="button" class="lst-x" title="Remove" aria-label="Remove" ' +
        'onclick="dropFertRow(' + i + ')">&#10005;</button>'
    : '<span class="lst-txt">' + esc(f.name) + '</span>' +
      '<span class="lst-num">' + (fertDose(f) === '' ? '—' : fertDose(f) + ' ' + esc(f.unit || 'gm')) + '</span>' +
      tick(f.dose_transplant != null) + tick(f.dose_monthly != null) +
      '<span></span>') +
  '</div>').join('');
}

function startFertEdit() {
  fertDraft = fertilisers.map(f => ({ ...f }));
  fertEditing = true;
  renderFertilisers();
}

function cancelFertEdit() { fertEditing = false; fertDraft = null; renderFertilisers(); }

function onFertDraft(i, field, val) {
  const f = fertDraft[i];
  if (!f) return;
  if (field === 'name') { f.name = val; return; }
  if (field === 'unit') { f.unit = val === 'mL' ? 'mL' : 'gm'; return; }
  // The dosage goes to whichever usages are ticked, and only those.
  const d = val === '' ? 0 : Math.max(0, +val || 0);
  if (f.dose_transplant != null) f.dose_transplant = d;
  if (f.dose_monthly    != null) f.dose_monthly    = d;
  if (f.dose_transplant == null && f.dose_monthly == null) f._pending = d;
}

function onFertUse(i, field, on) {
  const f = fertDraft[i];
  if (!f) return;
  const d = +fertDose(f) || +f._pending || 0;
  f[field] = on ? d : null;
  renderFertilisers();
}

function addFertRow() {
  if (!fertEditing) return;
  // Ticked for transplanting to start with: a fertiliser used for neither
  // would never appear anywhere, which is not a useful row to have made.
  fertDraft.push({ name: '', dose_transplant: 0, dose_monthly: null, unit: 'gm', _new: true });
  renderFertilisers();
  const box = document.getElementById('fert-list');
  const last = box && box.querySelector('.lst-row:last-child input[type=text]');
  if (last) last.focus();
}

function dropFertRow(i) {
  const f = fertDraft[i];
  if (!f) return;
  if (f.name && !confirm('Remove “' + f.name + '” from the fertiliser list?')) return;
  fertDraft.splice(i, 1);
  renderFertilisers();
}

async function saveFertEdit() {
  const named = fertDraft.map(f => ({ ...f, name: (f.name || '').trim() })).filter(f => f.name);
  const seen = new Set();
  for (const f of named) {
    const key = f.name.toLowerCase();
    if (seen.has(key)) { alert('“' + f.name + '” is on the list twice.'); return; }
    seen.add(key);
  }

  const btns = document.getElementById('fert-actions');
  if (btns) btns.querySelectorAll('button').forEach(b => b.disabled = true);
  const done = () => { if (btns) btns.querySelectorAll('button').forEach(b => b.disabled = false); };

  if (_supabase) {
    const keep = new Set(named.filter(f => f.id).map(f => String(f.id)));
    const gone = fertilisers.filter(f => !keep.has(String(f.id))).map(f => f.id);
    const cols = f => ({ name: f.name, dose_transplant: f.dose_transplant,
                         dose_monthly: f.dose_monthly, unit: f.unit || 'gm',
                         updated_at: new Date().toISOString() });

    const fallback = columnFallback();

    let err = null;
    if (gone.length) {
      err = await fallback.attempt(() =>
        _supabase.from('nops_maint_fertilisers').delete().in('id', gone));
    }
    for (const f of named.filter(x => x.id)) {
      if (err) break;
      err = await fallback.attempt(() =>
        _supabase.from('nops_maint_fertilisers').update(fallback.strip(cols(f))).eq('id', f.id));
    }
    if (!err && named.some(f => !f.id)) {
      err = await fallback.attempt(() =>
        _supabase.from('nops_maint_fertilisers').insert(
          named.filter(f => !f.id).map(f => fallback.strip(cols(f)))));
    }
    if (err) { done(); alert('Could not save — ' + (err.message || 'try again')); return; }
    if (fallback.dropped.size) {
      alert('Saved — but this database could not take ' +
            [...fallback.dropped].join(', ') + '.\n\n' +
            'Run shared/RUN_ME_maintenance_setting.sql in the Supabase SQL Editor ' +
            'once, then save again.');
    }

    const { data } = await _supabase.from('nops_maint_fertilisers').select('*')
      .order('sort_order').order('name').then(r => r, () => ({ data: null }));
    fertilisers = data || named;
  } else {
    fertilisers = named.map((f, i) => ({ ...f, id: f.id || 'local-' + i }));
  }

  done();
  fertEditing = false; fertDraft = null;
  renderFertilisers();
}

/* ═══════════════════════════════════════════════════════════════════════
   MONTHLY SCHEDULED WORK — the summary above the four sheets

   One table per nursery. Columns are the weeks of the month, shared by all
   four works; rows are the four works; a tick says that work is set on at
   least one plot in that week.

   The weeks are shared and the rounds are not, which sounds like a problem
   and is not: periodRange() has always defaulted round i of EVERY work to
   the same seven-day block (i*7+1 .. i*7+7), so the four already line up
   unless somebody has dated a round by hand. A round that has been dated is
   placed in the week its start day falls in. Nothing is migrated and no
   saved schedule is touched — the summary reads what is there.

   A work with fewer rounds than there are weeks simply has fewer ticks.
   Weeding happens twice a month; two ticks across four weeks is the truth,
   not a gap.
═══════════════════════════════════════════════════════════════════════ */

/* WORKS, _expanded, _we and _weekPick are declared at the top of the file:
   renderAll() reaches this summary while the script is still evaluating, so a
   declaration here would still be in the temporal dead zone. */

/* ── A week is a round ─────────────────────────────────────────────────
   Weeks used to be five seven-day blocks this file invented for every
   month whether anybody wanted them or not, and rounds were a separate
   thing placed INTO them by date. Two ideas for one fact, and the summary
   headed six columns for a month nobody had scheduled anything in.

   A week is now something somebody makes. None exist until Add Week is
   pressed, and each one IS a round of every work: week 2 of P & D is the
   second spraying, week 2 of Manuring is the second feed. So the week
   carries the dates, the chemicals and the ticks together, which is how
   the popup asks for them and how the field reads them.

   Nothing is migrated. A saved month keeps its ticks; a month that has
   never had weeks set simply starts with none, which is the truth. */
function weeksOf(n, m) {
  const s = appState[n]?.[m];
  if (!s || !Array.isArray(s.weeks)) return [];
  /* A schedule carried forward brings last month's weeks with it, and last
     month may have been longer — so a 31-day August into a 30-day September
     would head a column "29th – 31st" for days September has not got.
     Clamped on the way out, not on the way in: the saved figure is still
     somebody's decision, and a 31-day month gets it back. */
  const days = daysInMonthLabel(m);
  return s.weeks.filter(x => +x.from <= days)
                .map(x => ({ from: +x.from, to: Math.min(+x.to, days) }));
}

/* Where a NEW week starts: the day after the last one ends, a seven-day
   run from there. The first week of a month starts on the 1st. Only a
   suggestion — the popup's from/to is the answer. */
function nextWeekRange(n, m) {
  const days = daysInMonthLabel(m);
  const w = weeksOf(n, m);
  const from = w.length ? Math.min(w[w.length - 1].to + 1, days) : 1;
  return { from, to: Math.min(from + 6, days) };
}

/* Adding a week adds a ROUND to every work, so each has somewhere to put
   its chemicals for it. Without this the new column would be a column of
   ticks with nothing saying what is being sprayed in it. */
function addWeek(n, m) {
  if (!canEditSchedule) return -1;
  const s = getState(n, m);
  if (!Array.isArray(s.weeks)) s.weeks = [];
  const days = daysInMonthLabel(m);
  if (s.weeks.length && s.weeks[s.weeks.length - 1].to >= days) {
    alert('The month is already covered to the last day.\n\n' +
          'Change an existing week\'s dates instead, or shorten the last one first.');
    return -1;
  }
  s.weeks.push(nextWeekRange(n, m));
  ensureRounds(n, m);          // the new week gets a round in all three configs
  persistStateSoon(n, m);
  return s.weeks.length - 1;
}

/* Removing a week removes the ROUND with it — its dates, its chemicals and
   its ticks — and shifts every later round down one. A week that only
   vanished from the header would leave its ticks behind under the next
   week's dates, which is worse than not being able to remove it. */
function removeWeek(n, m, k) {
  if (!canEditSchedule) return;
  const s = getState(n, m);
  const weeks = weeksOf(n, m);
  if (!weeks[k]) return;
  const plots = NURSERY_PLOTS[n] || [];
  if (!confirm(`Remove week ${k + 1} (${ordinalDay(weeks[k].from)}\u2013${ordinalDay(weeks[k].to)})?\n\n` +
               'Everything ticked in it goes with it, for all four works.')) return;

  s.weeks.splice(k, 1);
  const n2 = s.weeks.length;

  // P & D: object keys, so the tail has to be renumbered by hand.
  ['pd', 'pdConfig'].forEach(key => {
    const src = s[key] || {};
    const out = {};
    for (let i = 0; i < n2 + 1; i++) {
      const from = i < k ? i : i + 1;
      if (src['W' + (from + 1)] !== undefined && i < n2) out['W' + (i + 1)] = src['W' + (from + 1)];
    }
    s[key] = out;
  });
  // Weeding: R-keys, per plot.
  plots.forEach(p => {
    const src = s.weeding[p] || {};
    const out = {};
    for (let i = 0; i < n2; i++) {
      const from = i < k ? i : i + 1;
      out['R' + (i + 1)] = !!src['R' + (from + 1)];
    }
    s.weeding[p] = out;
  });
  // Manuring and Interrow: arrays, both the config and the per-plot ticks.
  ['manuring', 'interrow'].forEach(kind => {
    const cfg = s[kind + 'Config'];
    if (Array.isArray(cfg) && cfg.length > k) cfg.splice(k, 1);
    plots.forEach(p => {
      if (Array.isArray(s[kind][p]) && s[kind][p].length > k) s[kind][p].splice(k, 1);
    });
  });

  persistState(n, m);
  autoSyncRecords();
}

/* The plots this work is set on in one week. Week k IS round k now, so
   there is no placing-by-date left to do — one list, whatever shape the
   work keeps its ticks in, which is still four different shapes. */
function plotsInWeek(kind, i, n, m) {
  const s = appState[n]?.[m];
  if (!s || !weeksOf(n, m)[i]) return [];
  const plots = NURSERY_PLOTS[n] || [];
  const out = [];
  plots.forEach(p => {
    let on = false;
    if (kind === 'pd') {
      const cell = (s.pd || {})['W' + (i + 1)];
      const v = cell && cell[p];
      on = !!(v && (v.P || v.D));
    } else if (kind === 'weeding') {
      on = !!((s.weeding || {})[p] || {})['R' + (i + 1)];
    } else {
      const rounds = (s[kind] || {})[p];
      const cols = rounds && rounds[i];
      on = Array.isArray(cols) ? cols.some(Boolean) : !!cols;
    }
    if (on) out.push(p);
  });
  return out;
}

/* ── The tables ────────────────────────────────────────────────────────
   One per nursery, from Stock Management's list — the same list the Setting
   tab uses, so a nursery added there appears here without a code change. */

/* Seedling Stock writes "UNN 1"; the schedules have always been keyed UNN1.
   The two are the same place and the strings are not, so the summary bridges
   them the way migration_nops_capacity_to_stock.sql does — upper case, letters
   and digits only. A nursery with no key on this side has no schedule on this
   page at all, and the table says so rather than showing four empty rows. */
function schedKey(name) {
  if (NURSERY_PLOTS[name]) return name;
  const k = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return NURSERY_PLOTS[k] ? k : null;
}

/* The other way round: the schedules' key back to the name Seedling Stock
   uses, so the popup and the summary name the same nursery the same way. */
function stockLabel(key) {
  return capNurseries().find(n => schedKey(n) === key) || key;
}

function renderSchedSummary() {
  const box = document.getElementById('sched-summary');
  if (!box) return;
  const m = getMonth();
  /* The same list the Setting tab shows, for the same reason: the nurseries
     this system has on record are the ones Seedling Stock has plots for. */
  const names = capNurseries().filter(n => capPlots(n).length);
  const list = (names.length ? names : Object.keys(NURSERY_PLOTS))
    .map(name => ({ label: name, key: schedKey(name) }));

  if (!list.length) {
    box.innerHTML = '<div class="set-empty">No nurseries yet — they come from Seedling Stock.</div>';
    return;
  }
  box.innerHTML = list.map(it => summaryTable(it, m)).join('');
}

function summaryTable(it, m) {
  const n = it.key, label = it.label;
  if (!n) {
    return `<div class="ss-wrap">
      <div class="ss-head"><div class="ss-name">${esc(label)}</div></div>
      <div class="set-empty" style="padding:16px;">This nursery is in Seedling Stock but not on
        the maintenance schedule yet, so there is nothing to summarise.</div></div>`;
  }
  const weeks = weeksOf(n, m);
  /* A plain label, not a button. Dates are set inside the Edit popup, with
     the chemicals and the ticks they belong to — a header that opened its
     own little date box was a second place to do one thing. */
  const head = '<tr>' +
    '<th class="ss-work">Work</th>' +
    weeks.map((w, k) =>
      `<th><div class="ss-wk">Week ${k + 1}</div>` +
      `<div class="ss-wk-d">${ordinalDay(w.from)}\u2013${ordinalDay(w.to)}</div></th>`).join('') +
    (weeks.length ? '' : '<th class="ss-none-th">No weeks set yet</th>') +
    '<th class="ss-act">Actions</th></tr>';

  const rows = WORKS.map(work => {
    const on = weeks.map((_, k) => plotsInWeek(work.key, k, n, m).length);
    const gap = weeks.length ? '' :
      '<td class="ss-cell ss-empty-cell">Open Edit to add one</td>';
    const open = _expanded[n + '|' + work.key];
    let r = `<tr class="ss-row${open ? ' is-open' : ''}">` +
      `<td class="ss-work">${esc(work.label)}</td>` +
      on.map((count, k) => `<td class="ss-cell${count ? ' on' : ''}">` +
        (count ? `<span class="ss-tick" title="${count} plot${count === 1 ? '' : 's'}">&#10003;</span>` : '&ndash;') +
        '</td>').join('') + gap +
      `<td class="ss-act">` +
        `<button type="button" class="ss-btn" title="${open ? 'Hide the plots' : 'Show the plots'}" ` +
          `onclick="toggleSummaryRow('${esc(n)}','${work.key}')">${open ? '&#9650;' : '&#9660;'}</button>` +
        `<button type="button" class="ss-btn ss-btn-edit" title="Edit this work" ` +
          `onclick="openWorkEditor('${esc(n)}','${work.key}')">${PENCIL_SVG}</button>` +
      `</td></tr>`;

    if (open) {
      r += `<tr class="ss-detail"><td colspan="${weeks.length + (weeks.length ? 2 : 3)}">` +
        expandedPlots(n, work.key, m) + '</td></tr>';
    }
    return r;
  }).join('');

  return `<div class="ss-wrap">
      <div class="ss-head">
        <div class="ss-name">${esc(label)}</div>
        <div class="ss-count">${weeks.length} week${weeks.length === 1 ? '' : 's'}</div>
      </div>
      <div class="tbl-wrap"><table class="ss-table">
        <thead>${head}</thead><tbody>${rows}</tbody></table></div>
    </div>`;
}

/* ── What "expand" shows ───────────────────────────────────────────────
   Plots down, weeks across, one table — EVERY plot, not only the ticked
   ones. It listed just what was set, which made the panel a different shape
   every time and gave no way to see that a plot had been MISSED, which is
   the thing you open it to check. A plot with nothing set is still a row;
   its weeks are simply empty.

   One run rather than blocks of ten flowing right: the blocks repeated the
   week header beside itself, and two "PLOT 1 2 3 4 5" headers side by side
   read as ten weeks at a glance. One column of plots cannot be misread, and
   the panel is a table, which is what it always was pretending to be. */
function expandedPlots(n, kind, m) {
  const weeks = weeksOf(n, m);
  const plots = NURSERY_PLOTS[n] || [];
  if (!plots.length) return '<div class="ss-none">No plots in this nursery.</div>';

  const set = weeks.map((_, k) => new Set(plotsInWeek(kind, k, n, m)));
  const head = '<tr><th class="xp-plot">Plot</th>' +
    weeks.map((w, k) =>
      `<th title="${ordinalDay(w.from)} \u2013 ${ordinalDay(w.to)}">Wk ${k + 1}</th>`).join('') +
    '<th class="xp-tot">Set</th></tr>';
  const body = plots.map(pl => {
    const hits = weeks.map((_, k) => set[k].has(pl));
    const nOn = hits.filter(Boolean).length;
    return `<tr class="${nOn ? '' : 'xp-blank'}"><td class="xp-plot">${esc(pl)}</td>` +
      hits.map(on => on ? '<td class="xp-on">&#10003;</td>' : '<td class="xp-off"></td>').join('') +
      `<td class="xp-tot">${nOn || ''}</td></tr>`;
  }).join('');
  return `<div class="xp-wrap"><table class="xp-table">
    <thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function toggleSummaryRow(n, kind) {
  const k = n + '|' + kind;
  _expanded[k] = !_expanded[k];
  renderSchedSummary();
}

/* ── The editor: one work, one nursery, the WHOLE month ────────────────
   It used to open on a single week, which meant setting up a month of P & D
   was four trips through the same popup — and the summary row it was opened
   from is about the month, so a popup about one week answered a question
   nobody had asked.

   Now every week is in it at once: the plots down the side, the weeks across,
   and each week's own chemicals or fertilisers above the grid.

   ── Cancel actually cancels ──
   Ticks write through as they are made, the way they do everywhere else in
   this page — a tick that looks done and is not is how ticks get lost. That
   left Close as the only way out and no way back, so the state this work
   holds is COPIED when the popup opens and put back if you cancel. What is
   copied is the whole of that work: its ticks and its configuration, since
   changing a chemical mid-edit is exactly the thing somebody wants to undo. */
/* _we is declared at the top of the file with the summary's other state.
   { n, kind, before: {…} } — `before` is the copy Cancel puts back.

   The parts of the month's state one work owns. Cancel restores these and
   nothing else, so a tick made on ANOTHER work while this popup was open —
   impossible today, but the popup is modal by convention, not by lock — is
   not rolled back with it. */
/* Everything a week touches — which is everything. Adding or removing a
   week adds or removes a ROUND of all four works, so a Cancel that only put
   back the work whose popup was open would leave the other three carrying
   a round that no longer has a week. One snapshot of the month. */
const WORK_STATE_KEYS = ['weeks',
  'pd', 'pdConfig', 'weeding',
  'manuring', 'manuringConfig', 'interrow', 'interrowConfig'];

function openWorkEditor(n, kind) {
  const m = getMonth(), s = getState(n, m);
  const before = {};
  WORK_STATE_KEYS.forEach(k => {
    before[k] = JSON.parse(JSON.stringify(s[k] === undefined ? null : s[k]));
  });
  _we = { n, kind, before };
  document.getElementById('we-modal').classList.add('open');
  renderWorkEditor();
}

function closeWorkEditor() {
  document.getElementById('we-modal').classList.remove('open');
  _we = null;
}

/* Save is just "stop editing": every tick is already written. It publishes
   what is held rather than gathering it, so there is nothing here that could
   disagree with what the popup was showing. */
/* Save both keeps the schedule and PUBLISHES it. The Schedule tab used to
   carry a "Save Schedule" button whose only job was publishing the flat task
   list the worker app reads (nops_maint_published); that button has gone, so
   this is where publishing happens — at the one moment somebody has said
   they are finished with a nursery's week. Without it the ticks would save
   and the field would never be told. */
function saveWorkEditor() {
  if (_we) {
    const n = _we.n, m = getMonth();
    persistState(n, m);
    try { saveSchedule(n, true); } catch (e) { console.warn('[maint] publish failed:', e); }
  }
  closeWorkEditor();
  renderSchedSummary();
}

function cancelWorkEditor() {
  if (!_we) { closeWorkEditor(); return; }
  const { n, before } = _we;
  const m = getMonth(), s = getState(n, m);
  let changed = false;
  Object.keys(before).forEach(k => {
    if (JSON.stringify(s[k]) !== JSON.stringify(before[k])) changed = true;
  });
  if (changed && !confirm('Undo everything changed since this window opened?')) return;
  Object.keys(before).forEach(k => {
    s[k] = JSON.parse(JSON.stringify(before[k]));
  });
  if (changed) { persistState(n, m); autoSyncRecords(); }
  closeWorkEditor();
  renderSchedSummary();
  // Every work, not just this one: a cancelled week was all four's week.
  WORKS.forEach(w => redrawSheet(w.key));
}

/* The old sheets are gone from this tab but their renderers are still called
   from renderAll, and they no-op without a table. Kept in one place so a
   sheet brought back gets repainted from here without another edit. */
function redrawSheet(kind) {
  try { ({ pd: renderPD, manuring: renderManuring, weeding: renderWeeding,
            interrow: renderInterrow })[kind](); } catch (_) {}
}

/* The sub-columns one round has, whatever shape the work keeps them in. */
function roundColumns(kind, i, n, m) {
  const s = getState(n, m);
  if (kind === 'pd') return [{ label: 'Pest', ci: 0 }, { label: 'Disease', ci: 1 }];
  if (kind === 'weeding') return [{ label: 'Round ' + (i + 1), ci: 0 }];
  const cfg = (kind === 'manuring' ? s.manuringConfig : s.interrowConfig)[i] || [];
  return cfg.map((c, ci) => ({ label: c.name || c.chem || ('Column ' + (ci + 1)), ci }));
}

function weTicked(kind, i, ci, plot) {
  const s = getState(_we.n, getMonth());
  if (kind === 'pd')      return !!(s.pd['W' + (i + 1)]?.[plot]?.[ci === 0 ? 'P' : 'D']);
  if (kind === 'weeding') return !!(s.weeding[plot]?.['R' + (i + 1)]);
  return !!((s[kind][plot] || [])[i] || [])[ci];
}

function weToggle(kind, i, ci, plot, skipRender) {
  if (!canEditSchedule || !_we) return;
  const n = _we.n, m = getMonth(), s = getState(n, m);
  if (kind === 'pd') {
    const w = 'W' + (i + 1);
    if (!s.pd[w]) s.pd[w] = {};
    if (!s.pd[w][plot]) s.pd[w][plot] = { P: false, D: false };
    const f = ci === 0 ? 'P' : 'D';
    s.pd[w][plot][f] = !s.pd[w][plot][f];
  } else if (kind === 'weeding') {
    if (!s.weeding[plot]) s.weeding[plot] = { R1: false, R2: false };
    const r = 'R' + (i + 1);
    s.weeding[plot][r] = !s.weeding[plot][r];
  } else {
    if (!s[kind][plot]) s[kind][plot] = [];
    if (!s[kind][plot][i]) s[kind][plot][i] = [];
    s[kind][plot][i][ci] = !s[kind][plot][i][ci];
  }
  if (skipRender) return;
  persistStateSoon(n, m);
  autoSyncRecords();
  keepingScroll(renderWorkEditor);
  renderSchedSummary();
  redrawSheet(kind);
}

/* One repaint for the whole column, not one per plot — 52 plots through the
   single-tick path is 52 renders of a table nobody has seen yet. */
function weToggleAll(kind, i, ci) {
  if (!canEditSchedule || !_we) return;
  const n = _we.n, m = getMonth(), plots = NURSERY_PLOTS[n] || [];
  const all = plots.every(p => weTicked(kind, i, ci, p));
  plots.forEach(p => { if (weTicked(kind, i, ci, p) === all) weToggle(kind, i, ci, p, true); });
  persistStateSoon(n, m);
  autoSyncRecords();
  keepingScroll(renderWorkEditor);
  renderSchedSummary();
  redrawSheet(kind);
}

/* ── The popup ─────────────────────────────────────────────────────────
   One block per week: the week's number, its dates, what is being sprayed
   or fed in it, and every plot with a tick. That is the whole of a week,
   and it is asked for in the order somebody fills it in — when, with what,
   where.

   Weeks are made here rather than on the summary. The summary is a reading
   surface; this is the writing one, and a week made anywhere else would be
   a week with no dates and no chemicals until somebody came here anyway. */

/* A <select> whose value is not among its options shows the FIRST option
   instead — silently, and looking exactly like a saved answer. On a screen
   that says what to spray, that is the wrong kind of wrong, so a saved name
   the list no longer offers is carried in and marked rather than dropped. */
function weSel(opts, val, onch) {
  const missing = val && val !== '\u2014' && !opts.includes(val);
  const o = (missing ? [{ v: val, t: val + ' \u2014 no longer in the list' }] : [])
    .concat(opts.map(x => ({ v: x, t: x })));
  return `<select class="we-sel" onchange="${onch}">` +
    o.map(x => `<option value="${esc(x.v)}"${x.v === val ? ' selected' : ''}>${esc(x.t)}</option>`).join('') +
    '</select>';
}

function weNum(val, onch) {
  return `<input class="we-num" type="number" min="0" step="0.01" value="${val ?? ''}" oninput="${onch}">`;
}

/* What one week's column asks for, and what its ticks mean.

   P & D asks twice — pest and disease can go on different plots in the
   same week — so it has two sub-columns. Manuring and Interrow have as
   many as their config holds, one per fertiliser or chemical. Weeding has
   one, and nothing to choose.

   The STICKER is deliberately not here: a sticker goes in every tank
   whatever else does, so asking about it once a week was a question with
   one answer. The doses still save and still publish; the Setting page is
   where a sticker changes. */
/* Every week needs a round behind it, in all three configs. addWeek() makes
   one as it goes, but a month can reach the editor with more weeks than
   rounds — carried forward from a shorter month, or saved before addWeek
   existed. That left weCols() returning [], which became colspan="0"; a
   browser reads that as "to the end of the column group", which is why
   Manuring drew a white band where weeks 3 and 4 should have been. */
function ensureRounds(n, m) {
  const s = getState(n, m);
  const want = weeksOf(n, m).length;
  if (!s.pdConfig) s.pdConfig = {};
  for (let i = 0; i < want; i++) {
    const w = 'W' + (i + 1);
    if (!s.pdConfig[w]) {
      const prev = s.pdConfig['W' + i];
      s.pdConfig[w] = prev ? JSON.parse(JSON.stringify(prev)) : defaultPDConfig().W1;
    }
  }
  [['manuringConfig', defaultManuringConfig], ['interrowConfig', defaultInterrowConfig]]
    .forEach(([key, mk]) => {
      if (!Array.isArray(s[key]) || !s[key].length) s[key] = mk();
      while (s[key].length < want) {
        const prev = s[key][s[key].length - 1];
        s[key].push(JSON.parse(JSON.stringify(prev || mk()[0])));
      }
    });
}

function weCols(kind, i, n, m) {
  const s = getState(n, m);
  if (kind === 'pd') {
    const w = 'W' + (i + 1);
    if (!s.pdConfig[w]) s.pdConfig[w] = defaultPDConfig().W1;
    const c = s.pdConfig[w];
    return [
      { ci: 0, label: 'Pest', opts: chemNames('pest'), val: c.P,
        onSel: `updatePDChem('${w}','P',this.value);renderWorkEditor()`,
        dose: c.P_dose, unit: c.P_unit,
        onDose: `updatePDDose('${w}','P_dose',+this.value)` },
      { ci: 1, label: 'Disease', opts: chemNames('disease'), val: c.D,
        onSel: `updatePDChem('${w}','D',this.value);renderWorkEditor()`,
        dose: c.D_dose, unit: c.D_unit,
        onDose: `updatePDDose('${w}','D_dose',+this.value)` }
    ];
  }
  if (kind === 'weeding') return [{ ci: 0, label: 'Weeding' }];

  const many = kind === 'manuring';
  const cfg = (many ? s.manuringConfig : s.interrowConfig)[i] || [];
  const word = many ? 'Fertiliser' : 'Chemical';
  return cfg.map((c, ci) => ({
    ci,
    label: cfg.length > 1 ? `${word} ${ci + 1}` : word,
    opts: many ? fertNames('monthly') : taggedNames('interrow'),
    val: many ? c.name : c.chem,
    onSel: many
      ? `updateManuringChem(${i},${ci},this.value);renderWorkEditor()`
      : `updateInterrowChem(${i},${ci},this.value);renderWorkEditor()`,
    dose: many ? c.dose : c.chem_dose,
    unit: many ? (c.unit || 'gm') : (c.chem_unit || 'mL'),
    onDose: many
      ? `updateManuringDose(${i},${ci},'dose',+this.value)`
      : `updateInterrowDose(${i},${ci},'chem_dose',+this.value)`
  }));
}

function weTicked(kind, i, ci, plot) {
  const s = getState(_we.n, getMonth());
  if (kind === 'pd')      return !!(s.pd['W' + (i + 1)]?.[plot]?.[ci === 0 ? 'P' : 'D']);
  if (kind === 'weeding') return !!(s.weeding[plot]?.['R' + (i + 1)]);
  return !!((s[kind][plot] || [])[i] || [])[ci];
}

function weToggle(kind, i, ci, plot, skipRender) {
  if (!canEditSchedule || !_we) return;
  const n = _we.n, m = getMonth(), s = getState(n, m);
  if (kind === 'pd') {
    const w = 'W' + (i + 1);
    if (!s.pd[w]) s.pd[w] = {};
    if (!s.pd[w][plot]) s.pd[w][plot] = { P: false, D: false };
    const f = ci === 0 ? 'P' : 'D';
    s.pd[w][plot][f] = !s.pd[w][plot][f];
  } else if (kind === 'weeding') {
    if (!s.weeding[plot]) s.weeding[plot] = { R1: false, R2: false };
    const r = 'R' + (i + 1);
    s.weeding[plot][r] = !s.weeding[plot][r];
  } else {
    if (!s[kind][plot]) s[kind][plot] = [];
    if (!s[kind][plot][i]) s[kind][plot][i] = [];
    s[kind][plot][i][ci] = !s[kind][plot][i][ci];
  }
  if (skipRender) return;
  persistStateSoon(n, m);
  autoSyncRecords();
  keepingScroll(renderWorkEditor);
  renderSchedSummary();
  redrawSheet(kind);
}

/* One repaint for the whole column, not one per plot — 52 plots through the
   single-tick path is 52 renders of a table nobody has seen yet. */
function weToggleAll(kind, i, ci) {
  if (!canEditSchedule || !_we) return;
  const n = _we.n, m = getMonth(), plots = NURSERY_PLOTS[n] || [];
  const all = plots.every(p => weTicked(kind, i, ci, p));
  plots.forEach(p => { if (weTicked(kind, i, ci, p) === all) weToggle(kind, i, ci, p, true); });
  persistStateSoon(n, m);
  autoSyncRecords();
  keepingScroll(renderWorkEditor);
  renderSchedSummary();
  redrawSheet(kind);
}

/* ── The popup ─────────────────────────────────────────────────────────
   One block per week: the week's number, its dates, what is being sprayed
   or fed in it, and every plot with a tick. That is the whole of a week,
   and it is asked for in the order somebody fills it in — when, with what,
   where.

   Weeks are made here rather than on the summary. The summary is a reading
   surface; this is the writing one, and a week made anywhere else would be
   a week with no dates and no chemicals until somebody came here anyway. */

/* A <select> whose value is not among its options shows the FIRST option
   instead — silently, and looking exactly like a saved answer. On a screen
   that says what to spray, that is the wrong kind of wrong, so a saved name
   the list no longer offers is carried in and marked rather than dropped. */
function weSel(opts, val, onch) {
  const missing = val && val !== '\u2014' && !opts.includes(val);
  const o = (missing ? [{ v: val, t: val + ' \u2014 no longer in the list' }] : [])
    .concat(opts.map(x => ({ v: x, t: x })));
  return `<select class="we-sel" onchange="${onch}">` +
    o.map(x => `<option value="${esc(x.v)}"${x.v === val ? ' selected' : ''}>${esc(x.t)}</option>`).join('') +
    '</select>';
}

function weNum(val, onch) {
  return `<input class="we-num" type="number" min="0" step="0.01" value="${val ?? ''}" oninput="${onch}">`;
}

/* What this work mixes for one week. The STICKER rows are deliberately not
   here: a sticker goes in every tank whatever else does, so asking about it
   once a week was asking a question with one answer. The doses still save,
   and the Setting page is where a sticker is changed. */
function weTicked(kind, i, ci, plot) {
  const s = getState(_we.n, getMonth());
  if (kind === 'pd')      return !!(s.pd['W' + (i + 1)]?.[plot]?.[ci === 0 ? 'P' : 'D']);
  if (kind === 'weeding') return !!(s.weeding[plot]?.['R' + (i + 1)]);
  return !!((s[kind][plot] || [])[i] || [])[ci];
}

function weToggle(kind, i, ci, plot, skipRender) {
  if (!canEditSchedule || !_we) return;
  const n = _we.n, m = getMonth(), s = getState(n, m);
  if (kind === 'pd') {
    const w = 'W' + (i + 1);
    if (!s.pd[w]) s.pd[w] = {};
    if (!s.pd[w][plot]) s.pd[w][plot] = { P: false, D: false };
    const f = ci === 0 ? 'P' : 'D';
    s.pd[w][plot][f] = !s.pd[w][plot][f];
  } else if (kind === 'weeding') {
    if (!s.weeding[plot]) s.weeding[plot] = {};
    const r = 'R' + (i + 1);
    s.weeding[plot][r] = !s.weeding[plot][r];
  } else {
    if (!s[kind][plot]) s[kind][plot] = [];
    if (!s[kind][plot][i]) s[kind][plot][i] = [];
    s[kind][plot][i][ci] = !s[kind][plot][i][ci];
  }
  if (skipRender) return;
  persistStateSoon(n, m);
  autoSyncRecords();
  keepingScroll(renderWorkEditor);
  renderSchedSummary();
  redrawSheet(kind);
}

/* One repaint for the whole column, not one per plot — 52 plots through the
   single-tick path is 52 renders of a table nobody has seen yet. */
function weToggleAll(kind, i, ci) {
  if (!canEditSchedule || !_we) return;
  const n = _we.n, m = getMonth(), plots = NURSERY_PLOTS[n] || [];
  const all = plots.every(p => weTicked(kind, i, ci, p));
  plots.forEach(p => { if (weTicked(kind, i, ci, p) === all) weToggle(kind, i, ci, p, true); });
  persistStateSoon(n, m);
  autoSyncRecords();
  keepingScroll(renderWorkEditor);
  renderSchedSummary();
  redrawSheet(kind);
}

/* The week's dates. Written straight through like the ticks, because the
   popup's Cancel already puts the whole work back — and s.weeks is in that
   snapshot, so a date changed and cancelled goes back with everything else. */
function weSetDate(i, which, value) {
  if (!canEditSchedule || !_we) return;
  const n = _we.n, m = getMonth(), s = getState(n, m);
  const day = +String(value || '').slice(-2);
  const days = daysInMonthLabel(m);
  if (!day || day < 1 || day > days) return;
  const w = s.weeks && s.weeks[i];
  if (!w) return;
  if (which === 'from') { w.from = day; if (+w.to < day) w.to = day; }
  else                  { w.to = day;   if (+w.from > day) w.from = day; }
  persistStateSoon(n, m);
  renderWorkEditor();
  renderSchedSummary();
}

function weAddWeek() {
  if (!_we) return;
  const i = addWeek(_we.n, getMonth());
  if (i < 0) return;
  renderWorkEditor();
  renderSchedSummary();
  /* The new column is off the right edge of a month with a few weeks in
     it, so the scroller is sent there rather than leaving somebody to
     wonder whether the button did anything. */
  const box = document.querySelector('#we-body .we-scroll');
  if (box) box.scrollTo({ left: box.scrollWidth, behavior: 'smooth' });
}

function weRemoveWeek(i) {
  if (!_we) return;
  removeWeek(_we.n, getMonth(), i);
  renderWorkEditor();
  renderSchedSummary();
}

/* ── More than one thing in the same week ──────────────────────────────
   A week is one visit to a plot, but not necessarily one product. The
   nursery puts Yaramila on some plots and organic matter on others in the
   same seven days, and until now that meant either a second week with the
   wrong dates on it or a second nursery-month kept in somebody's head.

   The payload has always allowed it — manuringConfig and interrowConfig are
   [round][column], and autoSyncRecords, the PDF and the phone all read the
   columns rather than assuming one. Only the screen was missing the button.

   P & D has its two columns already, Pest and Disease, and they are what the
   work IS rather than a choice; weeding mixes nothing. So the control shows
   on the two works where a column means "and this product as well". */
const WE_MULTI_COL = { manuring: 'manuringConfig', interrow: 'interrowConfig' };

/** A blank column, in the shape the work keeps them in. */
function weBlankCol(kind) {
  return kind === 'manuring'
    ? { name: 'Yaramila', dose: 20, unit: 'gm' }
    : { chem: 'Basta', chem_dose: 200, chem_unit: 'mL', activator_dose: 15, activator_unit: 'mL' };
}

function weAddCol(i) {
  if (!canEditSchedule || !_we) return;
  const kind = _we.kind, key = WE_MULTI_COL[kind];
  if (!key) return;
  const n = _we.n, m = getMonth(), s = getState(n, m);
  ensureRounds(n, m);
  const round = s[key][i];
  // Six is the cap the round controls have always used. Past that the header
  // is wider than the ticks under it are useful.
  if (!round || round.length >= 6) return;
  round.push(weBlankCol(kind));
  (NURSERY_PLOTS[n] || []).forEach(pl => {
    if (!s[kind][pl]) s[kind][pl] = [];
    if (!s[kind][pl][i]) s[kind][pl][i] = [];
    s[kind][pl][i].push(false);
  });
  persistStateSoon(n, m);
  autoSyncRecords();
  renderWorkEditor();
  renderSchedSummary();
  redrawSheet(kind);
}

function weRemoveCol(i) {
  if (!canEditSchedule || !_we) return;
  const kind = _we.kind, key = WE_MULTI_COL[kind];
  if (!key) return;
  const n = _we.n, m = getMonth(), s = getState(n, m);
  const round = s[key] && s[key][i];
  // Never to nothing: a week with no column has no chemical and no ticks,
  // and is a week that should have been removed instead.
  if (!round || round.length <= 1) return;
  const ci = round.length - 1;
  const plots = NURSERY_PLOTS[n] || [];
  /* The last column's ticks go with it. Said out loud when there are any,
     because a column removed by mistake takes a morning's planning with it
     and nothing on screen would show what had gone. */
  const ticked = plots.filter(pl => weTicked(kind, i, ci, pl)).length;
  if (ticked && !confirm(
      `Remove the last column of week ${i + 1}? ${ticked} plot${ticked === 1 ? '' : 's'} `
      + 'ticked in it will lose that tick.')) return;
  round.pop();
  plots.forEach(pl => { if (s[kind][pl] && s[kind][pl][i]) s[kind][pl][i].pop(); });
  persistStateSoon(n, m);
  autoSyncRecords();
  renderWorkEditor();
  renderSchedSummary();
  redrawSheet(kind);
}

/* ── One table, not a stack of them ────────────────────────────────────
   The weeks used to be blocks down the page, each with its own copy of the
   plot list — the same fourteen names printed once per week, so comparing
   week 1 with week 3 meant scrolling past everything between them.

   The plots are a column, once, and the weeks go across: a plot is a row
   whatever week you are reading, which is the question this screen is
   asked. Under each week's dates sit its own chemical choices, directly
   over the ticks they govern. Add Week adds a column to the right. */
function renderWorkEditor() {
  if (!_we) return;
  const { n, kind } = _we;
  const m = getMonth(), iso = monthISO(m), days = daysInMonthLabel(m);
  const work = WORKS.find(w => w.key === kind);
  const weeks = weeksOf(n, m);
  const plots = NURSERY_PLOTS[n] || [];
  ensureRounds(n, m);   // no week without a round behind it

  document.getElementById('we-title').textContent = `${stockLabel(n)} \u00b7 ${work.label}`;
  document.getElementById('we-sub').textContent = weeks.length
    ? `${weeks.length} week${weeks.length === 1 ? '' : 's'} in ${m}. Ticks save as you make them \u2014 Cancel puts them back.`
    : `No weeks in ${m} yet. Add Week starts one.`;

  const body = document.getElementById('we-body');
  if (!plots.length) { body.innerHTML = '<div class="set-empty">This nursery has no plots.</div>'; return; }
  if (!weeks.length) {
    body.innerHTML = '<div class="set-empty">No weeks yet. <b>Add Week</b> starts one, ' +
      'and every week you add becomes a column here.</div>';
    return;
  }

  const cols = weeks.map((_, i) => {
    const c = weCols(kind, i, n, m);
    /* colspan="0" means "to the end of the column group" to a browser, not
       "no columns" — the bug that put a white band where Manuring's later
       weeks should have been. ensureRounds() above should make this
       impossible; this makes it harmless if it ever is not. */
    return c.length ? c : [{ ci: 0, label: '\u2014' }];
  });
  const dayInput = (i, which, day) =>
    `<input class="we-date" type="date" value="${iso ? `${iso}-${String(day).padStart(2, '0')}` : ''}" ` +
    `min="${iso}-01" max="${iso}-${String(days).padStart(2, '0')}" ` +
    `onchange="weSetDate(${i},'${which}',this.value)">`;

  /* Three header rows: which week, when, and what goes in it. The dates
     get a row of their own because two date boxes are wider than the two
     tick columns underneath them, and squeezing them into the week band
     would set the column width from the widget rather than the data. */
  /* + and − sit on the LEFT of the week band and × on the right, because
     they are not the same size of act: one adds or drops a product inside
     the week, the other takes the week and every tick in it away. Side by
     side they would be three small buttons and one bad afternoon. */
  const colWord = kind === 'manuring' ? 'fertiliser' : 'chemical';
  const colCtrl = (i) => WE_MULTI_COL[kind]
    ? `<span class="we-col-n schedule-edit-ctrl">` +
        `<button type="button" title="Another ${colWord} in this week"` +
        ` aria-label="Add a column to week ${i + 1}"` +
        ` onclick="weAddCol(${i})"${cols[i].length >= 6 ? ' disabled' : ''}>+</button>` +
        `<button type="button" title="Drop the last ${colWord} from this week"` +
        ` aria-label="Remove a column from week ${i + 1}"` +
        ` onclick="weRemoveCol(${i})"${cols[i].length <= 1 ? ' disabled' : ''}>&minus;</button>` +
      `</span>`
    : '';

  const h1 = '<tr><th class="we-plot" rowspan="3">Plot</th>' +
    weeks.map((w, i) =>
      `<th colspan="${cols[i].length}" class="we-wk">` +
        colCtrl(i) +
        `<span class="we-wk-n">Week ${i + 1}</span>` +
        `<button type="button" class="we-week-x schedule-edit-ctrl" title="Remove this week"` +
        ` onclick="weRemoveWeek(${i})">&times;</button></th>`).join('') + '</tr>';

  const h2 = '<tr>' + weeks.map((w, i) =>
    `<th colspan="${cols[i].length}" class="we-wk-d">` +
      dayInput(i, 'from', w.from) + '<span class="we-to">to</span>' + dayInput(i, 'to', w.to) +
    '</th>').join('') + '</tr>';

  const h3 = '<tr>' + weeks.map((w, i) => cols[i].map((c, k) =>
    `<th class="we-col${k === 0 && i ? ' grp' : ''}">` +
      `<div class="we-col-l">${esc(c.label)}</div>` +
      (c.opts ? weSel(c.opts, c.val, c.onSel) : '') +
      (c.opts ? `<div class="we-col-d">${weNum(c.dose, c.onDose)}` +
                `<span class="we-cfg-u">${esc(c.unit || '')}</span></div>` : '') +
      `<button type="button" class="we-all" onclick="weToggleAll('${kind}',${i},${c.ci})" ` +
      `title="Tick or clear every plot in this column">all</button>` +
    '</th>').join('')).join('') + '</tr>';

  const rows = plots.map(pl => '<tr><td class="we-plot">' + esc(pl) + '</td>' +
    weeks.map((w, i) => cols[i].map((c, k) => {
      const on = weTicked(kind, i, c.ci, pl);
      return `<td class="${k === 0 && i ? 'grp' : ''}"><button type="button" ` +
        `class="we-tick${on ? ' on' : ''}" ` +
        `onclick="weToggle('${kind}',${i},${c.ci},'${esc(pl)}')" ` +
        `aria-pressed="${on}">${on ? '&#10003;' : ''}</button></td>`;
    }).join('')).join('') + '</tr>').join('');

  body.innerHTML = `<div class="tbl-wrap we-scroll"><table class="we-table">
      <thead>${h1}${h2}${h3}</thead><tbody>${rows}</tbody></table></div>`;
}
