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
const COVERAGE_PER_PUMP = 800; // standard spray coverage (seedlings per pump)
const CHEMICAL_COVERAGE = { // overrides for chemicals with different cover-per-pump
  'Asir': 1, // per-seedling: capacity × dose / 1000
};

function fmtUsage(totalAmount, unit, decimals = 2){
  // gm → kg, mL → L; default 2 decimals (no round-up)
  const big = totalAmount / 1000;
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(big * factor) / factor;
  return rounded + (unit === 'gm' ? ' kg' : ' L');
}
/* Unit per chemical — used to auto-set mL/gm when a chemical is selected */
const CHEMICAL_UNITS = {
  // Pest
  'Cyper':'mL','Destroy':'mL','Becker':'mL','Asir':'gm',
  // Disease
  'Antracol':'gm','Dithane':'gm','Thiram':'gm','Daconil':'gm','Manzate':'gm',
  // Weedicide / sticker
  'Widex':'gm','Sentry':'mL','Ally':'gm','Basta':'mL','Monex':'mL','Acosta':'mL',
  'Bond':'mL','Activator':'mL',
  // Fertilizer
  'Sk Cote':'gm','Yaramila':'gm','Compound 55':'gm','Ajimino':'gm','ERP':'gm','Organic Matter':'gm',
};
function getUnitForChem(name){ return CHEMICAL_UNITS[name] || 'gm'; }

function calcMaxChem(seedlings, chemName, dose, unit, decimals = 2){
  if(!seedlings || !chemName || chemName === '—' || !dose) return '—';
  // Formula: (plot capacity / coverage per pump) × dose per pump / 1000
  const coverage = CHEMICAL_COVERAGE[chemName] || COVERAGE_PER_PUMP;
  const totalUnits = (seedlings / coverage) * dose;
  return fmtUsage(totalUnits, unit, decimals);
}
function sumSeedlings(nursery, plots, ticked){
  return plots.filter(p => ticked(p)).reduce((s,p) => s + getPlotQty(nursery, p), 0);
}
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* Chemical option lists — only chemicals MJM Nursery uses. Names only; dose set separately. */
const PD_SERANGGA_OPTIONS = ['Cyper','Destroy','Becker','Asir','—'];
const PD_KULAT_OPTIONS    = ['Antracol','Dithane','Thiram','Daconil','Manzate','—'];
const PD_STICKER_OPTIONS  = ['Bond','—'];
const FERT_OPTIONS        = ['Sk Cote','Yaramila','Compound 55','Ajimino','ERP','Organic Matter','—'];
/* Fertilizer catalog — dose per seedling and bag size for kg/bag calculation */
const FERTILIZER_INFO = {
  'Sk Cote':        { defaultDose:5,  bagSizeGm:25000,   bagLabel:'25 kg' },
  'Yaramila':       { defaultDose:20, bagSizeGm:50000,   bagLabel:'50 kg' },
  'Compound 55':    { defaultDose:20, bagSizeGm:50000,   bagLabel:'50 kg' },
  'Ajimino':        { defaultDose:20, bagSizeGm:25000,   bagLabel:'25 kg' },
  'ERP':            { defaultDose:20, bagSizeGm:50000,   bagLabel:'50 kg' },
  'Organic Matter': { defaultDose:60, bagSizeGm:1000000, bagLabel:'1,000 kg' },
};
function calcFertUsage(seedlings, fertName, doseGm, decimals = 2){
  if (!seedlings || !fertName || fertName === '—' || !doseGm) return { kg:'—', bags:'—', totalGm:0 };
  const info = FERTILIZER_INFO[fertName];
  const totalGm = seedlings * doseGm;
  const totalKg = totalGm / 1000;
  const factor = Math.pow(10, decimals);
  const kgStr = (Math.round(totalKg * factor) / factor).toLocaleString() + ' kg';
  const bagsStr = info ? (Math.round((totalGm / info.bagSizeGm) * factor) / factor) + ' ' + t('unit.bags') + ' (' + info.bagLabel + ' ' + t('unit.each') + ')' : '—';
  return { kg: kgStr, bags: bagsStr, totalGm };
}
const INTERROW_CHEM_OPTIONS = ['Basta','Monex','Acosta'];

/* Categorized chemical catalog with default dose per chemical — used by Chemical Calculator */
const CHEMICAL_CATEGORIES = [
  { group: 'Pest', chems: [
    { name:'Cyper',   dose:60, unit:'mL' },
    { name:'Destroy', dose:30, unit:'mL' },
    { name:'Becker',  dose:20, unit:'mL' },
    { name:'Asir',    dose:5,  unit:'gm' },
  ]},
  { group: 'Disease', chems: [
    { name:'Antracol', dose:30, unit:'gm' },
    { name:'Dithane',  dose:30, unit:'gm' },
    { name:'Thiram',   dose:30, unit:'gm' },
    { name:'Daconil',  dose:30, unit:'gm' },
    { name:'Manzate',  dose:30, unit:'gm' },
  ]},
  { group: 'Weedicide : Contact', chems: [
    { name:'Widex', dose:8, unit:'gm' },
  ]},
  { group: 'Weedicide : Systemic', chems: [
    { name:'Sentry', dose:200, unit:'mL' },
    { name:'Ally',   dose:3,   unit:'gm' },
  ]},
  { group: 'Weedicide : Contact + Systemic', chems: [
    { name:'Basta',  dose:200, unit:'mL' },
    { name:'Monex',  dose:200, unit:'mL' },
    { name:'Acosta', dose:200, unit:'mL' },
  ]},
  { group: 'Sticker for fungicide', chems: [
    { name:'Bond', dose:15, unit:'mL' },
  ]},
  { group: 'Sticker for weedicide', chems: [
    { name:'Activator', dose:15, unit:'mL' },
  ]},
];

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
function defaultManuringConfig() {
  // Nested: array of rounds → each round is an array of fertilizer columns
  return [
    [
      { name:'Yaramila',       dose:20,  unit:'gm' },
      { name:'Compound 55',    dose:20,  unit:'gm' },
      { name:'Organic Matter', dose:180, unit:'gm' },
    ],
  ];
}
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
/* Admin of the "Nursery Operation Management" module in User Access.
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
  renderAll(); autoSyncRecords(); renderSettingPlots(); renderSettingWorkers();
}

function removeCustomPlot(n, name) {
  if (!confirm(`Remove plot "${name}" from ${NURSERY_NAMES[n]}?\n\nIts row disappears from all four schedules. Saved work records for it are kept.`)) return;
  customPlots[n] = (customPlots[n] || []).filter(p => p !== name);
  if (NURSERY_PLOTS[n]) {
    const i = NURSERY_PLOTS[n].indexOf(name);
    if (i >= 0) NURSERY_PLOTS[n].splice(i, 1);
  }
  persistCustomPlot(n, name, true);
  renderAll(); autoSyncRecords(); renderSettingPlots(); renderSettingWorkers();
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

function payrollKey(n, m, type) { return `${n}_${m}_${type}`; }

function switchPayrollView(type, btn) {
  _payrollView = type;
  const bar = btn ? btn.closest('.subtabs-bar') : null;
  if (bar) bar.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderPayroll();
}

function payrollRows() {
  const n = getNursery();
  const plots = NURSERY_PLOTS[n] || [];
  const jenis = PAYROLL_TYPES[_payrollView].jenis;
  return records
    .filter(r => r.jenis === jenis && plots.includes(r.plot))
    .sort((a, b) => plots.indexOf(a.plot) - plots.indexOf(b.plot));
}

function renderPayroll() {
  const tbl = document.getElementById('payroll-table');
  if (!tbl) return;
  const n = getNursery(), m = getMonth();
  const cfg = PAYROLL_TYPES[_payrollView];
  const line = document.getElementById('payroll-form-line');
  if (line) line.textContent = `Borang Tuntutan Gaji (${NURSERY_NAMES[n]}) — Bulan ${m}`;

  const wk = workers[n] || [];
  const rows = payrollRows();
  const rate = pieceRates[_payrollView];
  const store = payrollData[payrollKey(n, m, _payrollView)] || {};

  if (!wk.length) {
    tbl.innerHTML = `<tbody><tr><td style="padding:2rem;text-align:center;color:var(--text-faint);font-size:13px;">
      Add worker names under <strong>Setting → Workers</strong> to build this form.</td></tr></tbody>`;
    return;
  }

  const rateTxt = (rate === null || rate === undefined) ? '—' : Number(rate).toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
  let h = `<thead>
    <tr><th class="wk-th" colspan="${3 + wk.length + 1}">${t(cfg.label)} — RM ${rateTxt}/${cfg.unit}</th></tr>
    <tr>
      <th class="th-left" style="min-width:92px;">Tarikh</th>
      <th style="min-width:64px;">Plot</th>
      <th style="min-width:96px;">Kapasiti plot<br>(bibit)</th>
      ${wk.map(w => `<th style="min-width:104px;">${w}</th>`).join('')}
      <th style="min-width:104px;">Kapasiti Kerja<br>Setiap Orang (bibit)</th>
    </tr></thead><tbody>`;

  const totals = {}; wk.forEach(w => totals[w] = 0);
  let capTotal = 0;

  if (!rows.length) {
    h += `<tr><td colspan="${3 + wk.length + 1}" style="padding:1.6rem;text-align:center;color:var(--text-faint);">
      No ${t(cfg.label)} records for this nursery and month yet — tick the schedule, then Sync from Schedule.</td></tr>`;
  } else {
    rows.forEach(r => {
      const cells = store[r.id] || {};
      let rowSum = 0;
      wk.forEach(w => { const v = Number(cells[w] || 0); rowSum += v; totals[w] += v; });
      const cap = (r.qty === 0 || r.qty) ? Number(r.qty) : 0;
      capTotal += cap;
      h += `<tr>
        <td class="th-left" style="font-weight:600;">${r.tarikh || '-'}</td>
        <td class="plot-td">${r.plot}</td>
        <td>${cap ? cap.toLocaleString() : '—'}</td>
        ${wk.map(w => `<td style="padding:4px 6px;"><input type="number" min="0" value="${cells[w] ?? ''}"
            onchange="setPayrollCell(${r.id},'${String(w).replace(/'/g, "\\'")}',this.value)"
            style="width:100%;min-width:0;height:32px;padding:0 6px;font-size:12px;text-align:right;border:1.5px solid var(--border);border-radius:4px;font-family:inherit;"></td>`).join('')}
        <td style="font-weight:700;">${rowSum ? rowSum.toLocaleString() : '—'}</td>
      </tr>`;
    });
  }

  const grand = wk.reduce((sk, w) => sk + totals[w], 0);
  h += `</tbody><tfoot>
    <tr class="jumlah-tr"><td colspan="2">Jumlah (Capacity)</td><td>${capTotal ? capTotal.toLocaleString() : '—'}</td>
      ${wk.map(w => `<td>${totals[w] ? totals[w].toLocaleString() : '0'}</td>`).join('')}
      <td>${grand ? grand.toLocaleString() : '0'}</td></tr>
    <tr class="jumlah-tr"><td colspan="3">Piece Rate (RM)</td>
      ${wk.map(() => `<td>${rateTxt}</td>`).join('')}<td></td></tr>
    <tr class="jumlah-tr"><td colspan="3">Total (RM)</td>
      ${wk.map(w => `<td>${rate ? (totals[w] * rate).toFixed(2) : '0.00'}</td>`).join('')}
      <td>${rate ? (grand * rate).toFixed(2) : '0.00'}</td></tr>
  </tfoot>`;
  tbl.innerHTML = h;
}

function setPayrollCell(recId, worker, val) {
  const n = getNursery(), m = getMonth();
  const k = payrollKey(n, m, _payrollView);
  if (!payrollData[k]) payrollData[k] = {};
  if (!payrollData[k][recId]) payrollData[k][recId] = {};
  const raw = String(val ?? '').trim();
  if (raw === '') delete payrollData[k][recId][worker];
  else payrollData[k][recId][worker] = Math.max(0, parseInt(raw) || 0);
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

function downloadPayrollPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const n = getNursery(), m = getMonth(), cfg = PAYROLL_TYPES[_payrollView];
  const wk = workers[n] || [], rows = payrollRows();
  const rate = pieceRates[_payrollView] || 0;
  const store = payrollData[payrollKey(n, m, _payrollView)] || {};

  doc.setFont('times', 'bold'); doc.setFontSize(13);
  doc.text('Mega Jutamas Sdn Bhd', 148, 12, { align: 'center' });
  doc.setFontSize(11);
  doc.text(`Borang Tuntutan Gaji (${NURSERY_NAMES[n]})`, 148, 18, { align: 'center' });
  doc.setFont('times', 'normal');
  doc.text(`Bulan ${m}`, 148, 24, { align: 'center' });
  doc.setFontSize(9);
  doc.text(`${t(cfg.label)} — RM ${rate}/${cfg.unit}`, 148, 31, { align: 'center' });

  const head = ['Tarikh', 'Plot', 'Kapasiti plot', ...wk, 'Kapasiti/Orang'];
  const colW = [22, 16, 22, ...wk.map(() => Math.max(16, (200 - 60) / Math.max(1, wk.length))), 24];
  let y = 38;
  const drawRow = (cells, bold) => {
    doc.setFont('times', bold ? 'bold' : 'normal'); doc.setFontSize(8);
    let x = 10;
    cells.forEach((c, i) => { doc.rect(x, y, colW[i], 6); doc.text(String(c ?? ''), x + colW[i] - 1.5, y + 4, { align: 'right' }); x += colW[i]; });
    y += 6;
  };
  drawRow(head, true);
  const totals = {}; wk.forEach(w => totals[w] = 0); let capTotal = 0;
  rows.forEach(r => {
    if (y > 190) { doc.addPage(); y = 15; drawRow(head, true); }
    const cells = store[r.id] || {};
    let rowSum = 0; wk.forEach(w => { const v = Number(cells[w] || 0); rowSum += v; totals[w] += v; });
    const cap = (r.qty === 0 || r.qty) ? Number(r.qty) : 0; capTotal += cap;
    drawRow([r.tarikh || '-', r.plot, cap || '-', ...wk.map(w => cells[w] ?? ''), rowSum || '-']);
  });
  const grand = wk.reduce((sk, w) => sk + totals[w], 0);
  drawRow(['Jumlah', '', capTotal || '-', ...wk.map(w => totals[w]), grand], true);
  drawRow(['Piece Rate', '', '', ...wk.map(() => rate), ''], true);
  drawRow(['Total (RM)', '', '', ...wk.map(w => (totals[w] * rate).toFixed(2)), (grand * rate).toFixed(2)], true);
  doc.save(`Borang_Tuntutan_Gaji_${n}_${m.replace(' ', '_')}_${_payrollView}.pdf`);
}

/* ── Piece rates (one rate card for all nurseries) ── */
const PIECE_RATE_TYPES = [
  { code: 'pd',       key: 'jenis.pd'       },
  { code: 'manuring', key: 'jenis.manuring' },
  { code: 'weeding',  key: 'jenis.weeding'  },
  { code: 'interrow', key: 'jenis.interrow' }
];
let pieceRates = { pd: null, manuring: null, weeding: null, interrow: null };

function renderSettingRates() {
  const box = document.getElementById('setting-rate-list');
  if (!box) return;
  box.innerHTML = PIECE_RATE_TYPES.map(rt => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;border:1.5px solid var(--border);border-radius:var(--r-sm);padding:9px 12px;">
      <span style="font-size:12px;font-weight:700;color:var(--text-head);">${t(rt.key)}</span>
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="font-size:11px;font-weight:700;color:var(--text-muted);">RM</span>
        <input type="number" min="0" step="0.01" value="${pieceRates[rt.code] ?? ''}" placeholder="0.00"
          onchange="setPieceRate('${rt.code}', this.value)"
          style="width:88px;height:32px;padding:0 8px;font-size:12px;text-align:right;border:1.5px solid var(--border);border-radius:4px;font-family:inherit;">
      </span>
    </div>`).join('');
}

function setPieceRate(code, val) {
  const raw = String(val ?? '').trim();
  pieceRates[code] = raw === '' ? null : Math.max(0, parseFloat(raw) || 0);
  if (!_supabase) return;
  const q = pieceRates[code] === null
    ? _supabase.from('nops_maint_piece_rates').delete().eq('work_type', code)
    : _supabase.from('nops_maint_piece_rates').upsert({ work_type: code, rate: pieceRates[code] }, { onConflict: 'work_type' });
  q.then(({ error }) => { if (error) console.warn('[maint] piece rate save failed:', error.message); });
  renderSettingRates(); renderPayroll();
}

/* ── Workers (per nursery) ── */
let workers = { PN: [], BNN: [], UNN1: [], UNN2: [] };

function renderSettingWorkers() {
  const box = document.getElementById('setting-worker-list');
  if (!box) return;
  const n = getNursery();
  const list = workers[n] || [];
  box.innerHTML = list.length
    ? list.map(w => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;border:1.5px solid var(--border);border-radius:var(--r-sm);padding:9px 12px;">
          <span style="font-size:12px;font-weight:700;color:var(--text-head);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${w}</span>
          <button class="btn btn-sm btn-danger" style="font-size:11px;" onclick="removeWorker('${String(w).replace(/'/g, "\\'")}')">Remove</button>
        </div>`).join('')
    : '<div style="font-size:12px;color:var(--text-faint);">No workers added yet for this nursery.</div>';
}

function addWorkerFromSetting() {
  const el = document.getElementById('setting-new-worker');
  const name = (el?.value || '').trim();
  if (!name) { alert('Key in a worker name first.'); return; }
  const n = getNursery();
  if (!workers[n]) workers[n] = [];
  if (workers[n].some(w => w.toLowerCase() === name.toLowerCase())) { alert(`"${name}" is already on this nursery's list.`); return; }
  workers[n].push(name);
  persistWorker(n, name, false);
  if (el) el.value = '';
  renderSettingWorkers(); renderPayroll();
}

function removeWorker(name) {
  const n = getNursery();
  if (!confirm(`Remove worker "${name}" from ${NURSERY_NAMES[n]}?`)) return;
  workers[n] = (workers[n] || []).filter(w => w !== name);
  persistWorker(n, name, true);
  renderSettingWorkers(); renderPayroll();
}

function persistWorker(n, name, remove) {
  if (!_supabase) return;
  const q = remove
    ? _supabase.from('nops_maint_workers').delete().eq('nursery', n).eq('name', name)
    : _supabase.from('nops_maint_workers').upsert({ nursery: n, name }, { onConflict: 'nursery,name' });
  q.then(({ error }) => { if (error) console.warn('[maint] worker save failed:', error.message); });
}

/* Setting tab — list of user-added plots for the current nursery. */
function renderSettingPlots() {
  const box = document.getElementById('setting-plot-list');
  if (!box) return;
  const n = getNursery();
  const list = customPlots[n] || [];
  box.innerHTML = list.length
    ? list.map(p => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;border:1.5px solid var(--border);border-radius:var(--r-sm);padding:9px 12px;">
          <span style="font-size:13px;font-weight:700;color:var(--green-text);">${p}</span>
          <button class="btn btn-sm btn-danger" style="font-size:11px;" onclick="removeCustomPlot('${n}','${p}')">Remove</button>
        </div>`).join('')
    : '<div style="font-size:12px;color:var(--text-faint);">No added plots yet — use “➕ Add Row” on a schedule, or add one below.</div>';
}

function addPlotFromSetting() {
  const el = document.getElementById('setting-new-plot');
  const name = (el?.value || '').trim().toUpperCase();
  if (!name) { alert('Key in a plot name first.'); return; }
  addCustomPlot(getNursery(), name);
  if (el) el.value = '';
}
let _dbReady     = false; // guards writes until the initial DB load lands

/* ════════════════════════════
   PERSISTENCE LAYER
   localStorage removed 2026-07-21 — data now lives in memory for the session
   only; Supabase wiring is pending. Each function below is the seam where a
   DB call will drop in (marked TODO(supabase)). The editable state already
   lives in `appState`, so nothing is lost within a session.
════════════════════════════ */
function stateKey(n, m) { return `${n}_${m}`; }   // future DB row id (nursery+month)

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
    _savedPd:       s._savedPd,
  };
  dbStateCache[stateKey(n, m)] = JSON.parse(JSON.stringify(_payload));
  if (_supabase) {
    _supabase.from('nops_maint_state')
      .upsert({ nursery: n, month: m, payload: _payload, updated_at: new Date().toISOString() }, { onConflict: 'nursery,month' })
      .then(({ error }) => { if (error) console.warn('[maint] schedule save failed:', error.message); });
  }
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
    'btn.pdf':'⬇ PDF', 'btn.save':'💾 Save Schedule',
    'btn.addRecord':'+ Add Record', 'btn.sync':'↺ Sync from Schedule',
    'btn.reset':'↺ Reset to Defaults', 'btn.clearAll':'Clear All', 'btn.selectAll':'Select All',
    'tab.pd':'P & D — Spraying', 'tab.manuring':'Manuring', 'tab.weeding':'Weeding',
    'tab.interrow':'Interrow Spray', 'tab.record':'Work Record', 'tab.chart':'Analytics', 'tab.schedule':'Schedule', 'tab.payroll':'💵 Monthly Payroll', 'tab.setting':'⚙️ Setting',
    'tab.calc':'💊 Dosage Calc',
    'badge.pd':'PEST & DISEASE SPRAYING SCHEDULE', 'badge.manuring':'MANURING SCHEDULE',
    'badge.weeding':'WEEDING SCHEDULE', 'badge.interrow':'INTERROW SPRAYING SCHEDULE',
    'badge.calc':'💊 DOSAGE CALCULATOR',
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
    'calc.capacity':'Nursery Plot Capacity (seedlings per plot — editable)',
    'calc.chemHead':'🧪 Chemical (Racun)', 'calc.fertHead':'🌱 Fertilizer (Baja)',
    'calc.tickPlots':'Tick plots to include',
    'calc.plotsSel':'Plots Selected', 'calc.noPlots':'No plots for this nursery.',
    'calc.jumlahBibit':'Total Seedlings', 'calc.maxRacun':'Max Chemical Used',
    'calc.maxBaja':'Max Fertilizer Used', 'calc.bags':'Bags Needed',
    'unit.bags':'bags', 'unit.each':'each',
    'pdf.title':'Download Schedule PDF', 'pdf.short.pd':'P&D SPRAYING', 'pdf.short.manuring':'MANURING',
    'pdf.short.weeding':'WEEDING', 'pdf.short.interrow':'INTERROW SPRAY', 'pdf.merumput':'Weeding in polybag',
    'pdf.include':'Include schedules', 'btn.cancel':'Cancel', 'btn.downloadPdf':'⬇ Download PDF',
    'rec.tarikh':'Date', 'rec.jenis':'Work Type', 'rec.racun':'Chemical',
    'rec.plot':'Plot', 'rec.batch':'Batch', 'rec.qty':'Quantity', 'rec.gaia':'Gaia', 'rec.remark':'Remark',
    'rec.allJenis':'All Work Types', 'rec.allPlot':'All Plots', 'rec.filterDate':'Filter by date…',
    'rec.totalTasks':'Total Tasks', 'rec.gaiaDone':'Gaia Done', 'rec.gaiaPending':'Gaia Pending',
    'rec.donePct':'Done %', 'rec.none':'No records found.',
    'jenis.pd':'P & D Spraying', 'jenis.interrow':'Interrow Spraying',
    'jenis.weeding':'Weeding', 'jenis.manuring':'Manuring',
  },
  bm: {
    'top.month':'Bulan', 'top.nursery':'Tapak Semaian',
    'btn.pdf':'⬇ PDF', 'btn.save':'💾 Simpan Jadual',
    'btn.addRecord':'+ Tambah Rekod', 'btn.sync':'↺ Segerak dari Jadual',
    'btn.reset':'↺ Set Semula', 'btn.clearAll':'Kosongkan', 'btn.selectAll':'Pilih Semua',
    'tab.pd':'P & D — Racun', 'tab.manuring':'Membaja', 'tab.weeding':'Merumput',
    'tab.interrow':'Racun Selingan', 'tab.record':'Rekod Kerja', 'tab.chart':'Analitik', 'tab.schedule':'Jadual', 'tab.payroll':'💵 Penggajian Bulanan', 'tab.setting':'⚙️ Tetapan',
    'tab.calc':'💊 Kira Dos',
    'badge.pd':'JADUAL PENYEMBURAN RACUN KULAT DAN SERANGGA', 'badge.manuring':'JADUAL MEMBAJA',
    'badge.weeding':'JADUAL MERUMPUT', 'badge.interrow':'JADUAL MERACUN RUMPUT SECARA SELINGAN',
    'badge.calc':'💊 KALKULATOR DOS',
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
    'calc.capacity':'Kapasiti Plot Semaian (bibit setiap plot — boleh ubah)',
    'calc.chemHead':'🧪 Racun (Chemical)', 'calc.fertHead':'🌱 Baja (Fertilizer)',
    'calc.tickPlots':'Tanda plot untuk disertakan',
    'calc.plotsSel':'Plot Dipilih', 'calc.noPlots':'Tiada plot untuk tapak semaian ini.',
    'calc.jumlahBibit':'Jumlah Bibit', 'calc.maxRacun':'Maksimal Racun Guna',
    'calc.maxBaja':'Maksimal Baja Guna', 'calc.bags':'Bag Diperlukan',
    'unit.bags':'beg', 'unit.each':'setiap',
    'pdf.title':'Muat Turun Jadual PDF', 'pdf.short.pd':'RACUN P&D', 'pdf.short.manuring':'MEMBAJA',
    'pdf.short.weeding':'MERUMPUT', 'pdf.short.interrow':'RACUN SELINGAN', 'pdf.merumput':'Merumput dalam polibeg',
    'pdf.include':'Sertakan jadual', 'btn.cancel':'Batal', 'btn.downloadPdf':'⬇ Muat Turun PDF',
    'rec.tarikh':'Tarikh', 'rec.jenis':'Jenis Kerja', 'rec.racun':'Racun / Bahan',
    'rec.plot':'Plot', 'rec.batch':'Batch', 'rec.qty':'Kuantiti', 'rec.gaia':'Gaia', 'rec.remark':'Catatan',
    'rec.allJenis':'Semua Jenis Kerja', 'rec.allPlot':'Semua Plot', 'rec.filterDate':'Tapis ikut tarikh…',
    'rec.totalTasks':'Jumlah Tugasan', 'rec.gaiaDone':'Gaia Selesai', 'rec.gaiaPending':'Gaia Belum',
    'rec.donePct':'% Selesai', 'rec.none':'Tiada rekod dijumpai.',
    'jenis.pd':'Penyemburan racun kulat dan serangga', 'jenis.interrow':'Meracun rumput secara selingan',
    'jenis.weeding':'Merumput', 'jenis.manuring':'Membaja',
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
function _syncMonthButtons() {
  const g = document.getElementById('global-month'), gb = document.getElementById('global-month-btn');
  if (g && gb) gb.textContent = (monthInputToLabel(g.value) || 'Select month') + ' \u25BE';
  const p = document.getElementById('pdf-month'), pb = document.getElementById('pdf-month-btn');
  if (p && pb) pb.textContent = (monthInputToLabel(p.value) || 'Select month') + ' \u25BE';
}

function onNurseryChange() {
  document.getElementById('nursery-pill').textContent = getNursery();
syncNurseryCircles();
  renderAll();
  autoSyncRecords();
}
function renderAll() {
  const m=getMonth(), n=getNursery(), lbl=NURSERY_LABELS[n];
  syncNurseryCircles();
  // Big single-line header: "Batu Niah Nursery — Apr 2026"
  const bigHdr = `${NURSERY_NAMES[n] || lbl} — ${m}`;
  ['record','payroll','setting'].forEach(k => {
    const el = document.getElementById(`${k}-nursery-line`);
    if (el) el.textContent = bigHdr;
  });
  // Remember the last-viewed month & nursery (restored on next visit).
  try { localStorage.setItem('mjm_maint_month', m); localStorage.setItem('mjm_maint_nursery', n); } catch (_) {}
  ['pd','manuring','weeding','interrow'].forEach(k => {
    const el = document.getElementById(`${k}-nursery-line`);
    if (el) el.textContent = bigHdr;
  });
  renderPD(); renderManuring(); renderWeeding(); renderInterrow(); renderRecords();
  // Re-render analytics when its sub-view inside Work Record is showing
  const chartView = document.getElementById('recview-chart');
  if (chartView && chartView.classList.contains('active')) renderCharts();
  const payTab = document.getElementById('tab-payroll');
  if (payTab && payTab.classList.contains('active')) renderPayroll();
  // Re-render calculator if its tab is active (clear ticks since plots may differ between nurseries)
  const calcTab = document.getElementById('tab-calc');
  if (calcTab && calcTab.classList.contains('active')) { calcTicked = {}; renderCalc(); }
}

/* Auto-sync: silently regenerate records from current schedule (no confirm, no alert) */
function autoSyncRecords() {
  const n=getNursery(), m=getMonth(), s=getState(n,m), cfg=s.pdConfig;
  const plots=NURSERY_PLOTS[n];
  const newRecs=[]; let id=Date.now();

  ['W1','W2','W3','W4'].forEach(w=>{
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
  ['R1','R2'].forEach(r=>{
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
  renderRecords();
  persistRecords();
}
function switchTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  const panel = document.getElementById('tab-'+name);
  if (panel) panel.classList.add('active');
  if (name==='record') { renderRecords(); if (_recordView==='chart') renderCharts(); }
  if (name==='calc')    renderCalc();
  if (name==='setting') { renderSettingPlots(); renderSettingRates(); renderSettingWorkers(); }
  if (name==='payroll') renderPayroll();
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
function switchSchedView(name, btn) {
  const bar = btn ? btn.closest('.subtabs-bar') : null;
  if (bar) bar.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.sched-panel').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('sched-' + name);
  if (el) el.classList.add('active');
}

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

/* ════════════════════════════
   CHEMICAL USAGE CALCULATOR
════════════════════════════ */
const CALC_CHEMICALS = (() => {
  const out = [];
  CHEMICAL_CATEGORIES.forEach(cat => {
    cat.chems.forEach(c => {
      out.push({ name: c.name, dose: c.dose, unit: c.unit, group: cat.group });
    });
  });
  return out;
})();

let calcTicked = {}; // {plot: true}
let calcChemIdx = 0;
let calcInited = false;

function initCalcChemDropdown() {
  const sel = document.getElementById('calc-chem');
  if (!sel || calcInited) return;
  // Build with optgroups so chemicals are visually grouped by category — show NAME only
  let html = '';
  CALC_CHEMICALS.forEach((c, i) => { c._idx = i; });
  CHEMICAL_CATEGORIES.forEach(cat => {
    const options = CALC_CHEMICALS
      .filter(c => c.group === cat.group)
      .map(c => `<option value="${c._idx}">${c.name}</option>`).join('');
    if (options) html += `<optgroup label="${cat.group}">${options}</optgroup>`;
  });
  sel.innerHTML = html;
  calcInited = true;
  onCalcChemChange();
}

function onCalcChemChange() {
  const sel = document.getElementById('calc-chem');
  calcChemIdx = +sel.value;
  const c = CALC_CHEMICALS[calcChemIdx];
  if (!c) return;
  document.getElementById('calc-dose').value = c.dose;
  document.getElementById('calc-unit').value = c.unit;
  renderCalcResults();
}

function toggleCalcPlot(plot, el) {
  calcTicked[plot] = !calcTicked[plot];
  el.classList.toggle('ticked', calcTicked[plot]);
  el.textContent = (calcTicked[plot] ? '☑ ' : '☐ ') + plot;
  renderCalcResults();
}

function clearCalcTicks() {
  calcTicked = {};
  renderCalcPlots();
  renderCalcResults();
}

function selectAllCalcPlots() {
  const plots = NURSERY_PLOTS[getNursery()];
  plots.forEach(p => calcTicked[p] = true);
  renderCalcPlots();
  renderCalcResults();
}

function renderCalcPlots() {
  const grid = document.getElementById('calc-plot-grid');
  if (!grid) return;
  const plots = NURSERY_PLOTS[getNursery()];
  grid.innerHTML = plots.map(p => {
    const tk = !!calcTicked[p];
    return `<button class="calc-plot-btn${tk ? ' ticked' : ''}" onclick="toggleCalcPlot('${p}',this)">${tk ? '☑' : '☐'} ${p}</button>`;
  }).join('');
}

function renderCalcResults() {
  const wrap = document.getElementById('calc-results');
  if (!wrap) return;
  const n = getNursery();
  const plots = NURSERY_PLOTS[n];
  const chem = CALC_CHEMICALS[calcChemIdx];
  const dose = +document.getElementById('calc-dose').value || 0;
  const unit = document.getElementById('calc-unit').value || 'gm';
  const tickedCount = plots.filter(p => calcTicked[p]).length;
  const seedlings = sumSeedlings(n, plots, p => calcTicked[p]);
  const maxUsage = calcMaxChem(seedlings, chem?.name || '', dose, unit);
  wrap.innerHTML = `
    <div class="calc-result-card"><div class="lbl">${t('calc.plotsSel')}</div><div class="val">${tickedCount}</div></div>
    <div class="calc-result-card"><div class="lbl">${t('calc.jumlahBibit')}</div><div class="val">${seedlings ? seedlings.toLocaleString() : '—'}</div></div>
    <div class="calc-result-card highlight"><div class="lbl">${t('calc.maxRacun')}</div><div class="val">${maxUsage}</div></div>
  `;
}

function renderCalcCapacity() {
  const grid = document.getElementById('calc-capacity-grid');
  if (!grid) return;
  const n = getNursery();
  const plots = NURSERY_PLOTS[n];
  if (!plots.length) { grid.innerHTML = `<div style="font-size:15px;color:#888">${t('calc.noPlots')}</div>`; return; }
  grid.innerHTML = plots.map(p => `
    <div style="display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #d4d8d4;border-radius:6px;padding:5px 8px">
      <span style="font-size:12px;font-weight:700;color:#236023;min-width:38px">${p}</span>
      <input type="number" min="0" step="1" value="${getPlotQty(n, p)}"
        onchange="onCalcCapacityChange('${n}','${p}',this.value)"
        style="flex:1;width:100%;min-width:0;height:28px;padding:0 6px;font-size:12px;border:1px solid #d4d8d4;border-radius:4px;font-family:inherit;text-align:right">
    </div>
  `).join('');
}

function onCalcCapacityChange(n, p, v) {
  setPlotQty(n, p, v);
  renderCalcResults();
  renderFertCalcResults();
  // Push the new capacity through to the schedule tables so their
  // Jumlah Bibit / Max Racun / Max Baja calculations stay correct.
  if (n === getNursery()) {
    renderPD();
    renderManuring();
    renderInterrow();
  }
}

function resetCalcCapacity() {
  if (!confirm(`Reset all plot capacities for ${getNursery()} to default values?`)) return;
  resetPlotQty(getNursery());
  renderCalcCapacity();
  renderCalcResults();
  renderFertCalcResults();
  renderPD();
  renderManuring();
  renderInterrow();
}

function renderCalc() {
  const nLine = document.getElementById('calc-nursery-line');
  if (nLine) nLine.textContent = `${NURSERY_LABELS[getNursery()]} — ${getMonth()}`;
  renderCalcCapacity();
  initCalcChemDropdown();
  renderCalcPlots();
  renderCalcResults();
  initFertCalcDropdown();
  renderFertCalcPlots();
  renderFertCalcResults();
}

/* ─── Fertilizer Calculator ─── */
let fertTicked = {};
let fertCalcInited = false;

function initFertCalcDropdown() {
  const sel = document.getElementById('fcalc-fert');
  if (!sel || fertCalcInited) return;
  const names = FERT_OPTIONS.filter(x => x !== '—');
  sel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
  fertCalcInited = true;
  onFertCalcChange();
}

function onFertCalcChange() {
  const sel = document.getElementById('fcalc-fert');
  const name = sel.value;
  const info = FERTILIZER_INFO[name];
  if (info) {
    document.getElementById('fcalc-dose').value = info.defaultDose;
    document.getElementById('fcalc-bag').value = info.bagLabel;
  }
  renderFertCalcResults();
}

function toggleFertCalcPlot(plot, el) {
  fertTicked[plot] = !fertTicked[plot];
  el.classList.toggle('ticked', fertTicked[plot]);
  el.textContent = (fertTicked[plot] ? '☑ ' : '☐ ') + plot;
  renderFertCalcResults();
}

function clearFertCalcTicks() {
  fertTicked = {};
  renderFertCalcPlots();
  renderFertCalcResults();
}

function selectAllFertCalcPlots() {
  const plots = NURSERY_PLOTS[getNursery()];
  plots.forEach(p => fertTicked[p] = true);
  renderFertCalcPlots();
  renderFertCalcResults();
}

function renderFertCalcPlots() {
  const grid = document.getElementById('fcalc-plot-grid');
  if (!grid) return;
  const plots = NURSERY_PLOTS[getNursery()];
  grid.innerHTML = plots.map(p => {
    const tk = !!fertTicked[p];
    return `<button class="calc-plot-btn${tk ? ' ticked' : ''}" onclick="toggleFertCalcPlot('${p}',this)">${tk ? '☑' : '☐'} ${p}</button>`;
  }).join('');
}

function renderFertCalcResults() {
  const wrap = document.getElementById('fcalc-results');
  if (!wrap) return;
  const n = getNursery();
  const plots = NURSERY_PLOTS[n];
  const sel = document.getElementById('fcalc-fert');
  const fertName = sel?.value || '';
  const dose = +document.getElementById('fcalc-dose').value || 0;
  const tickedCount = plots.filter(p => fertTicked[p]).length;
  const seedlings = sumSeedlings(n, plots, p => fertTicked[p]);
  const usage = calcFertUsage(seedlings, fertName, dose);
  wrap.innerHTML = `
    <div class="calc-result-card"><div class="lbl">${t('calc.plotsSel')}</div><div class="val">${tickedCount}</div></div>
    <div class="calc-result-card"><div class="lbl">${t('calc.jumlahBibit')}</div><div class="val">${seedlings ? seedlings.toLocaleString() : '—'}</div></div>
    <div class="calc-result-card highlight"><div class="lbl">${t('calc.maxBaja')}</div><div class="val">${usage.kg}</div></div>
    <div class="calc-result-card"><div class="lbl">${t('calc.bags')}</div><div class="val" style="font-size:16px">${usage.bags}</div></div>
  `;
}

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
}
function updatePDDose(w,f,v){ if(!canEditSchedule) return; getState(getNursery(),getMonth()).pdConfig[w][f]=v; renderPD(); }

function renderPD() {
  const n=getNursery(), m=getMonth(), s=getState(n,m), cfg=s.pdConfig, plots=NURSERY_PLOTS[n];
  const W=['W1','W2','W3','W4'];
  let h='<thead>';
  h+=`<tr><th rowspan="4" class="plot-col-hdr">${t('col.plot')}</th>`;
  W.forEach(w=>h+=`<th colspan="2" class="wk-th">${t('hdr.week')} ${w[1]}</th>`);
  h+='</tr><tr>';
  W.forEach(()=>h+=`<th class="p-th">${t('hdr.pSerangga')}</th><th class="d-th">${t('hdr.dKulat')}</th>`);
  h+='</tr><tr>';
  W.forEach(w=>{
    const c=cfg[w];
    h+=`<th class="hdr-input-cell p-bg">${mkSel(PD_SERANGGA_OPTIONS,c.P,`updatePDChem('${w}','P',this.value)`)}${mkDose(c.P_dose,c.P_unit,`updatePDDose('${w}','P_dose',+this.value)`)}</th>`;
    h+=`<th class="hdr-input-cell d-bg">${mkSel(PD_KULAT_OPTIONS,c.D,`updatePDChem('${w}','D',this.value)`)}${mkDose(c.D_dose,c.D_unit,`updatePDDose('${w}','D_dose',+this.value)`)}</th>`;
  });
  h+='</tr><tr>';
  W.forEach(w=>{
    const c=cfg[w];
    h+=`<th class="hdr-input-cell sticker-bg">${mkSel(PD_STICKER_OPTIONS,c.P_sticker,`updatePDChem('${w}','P_sticker',this.value)`)}${mkDose(c.P_sticker_dose,c.P_sticker_unit,`updatePDDose('${w}','P_sticker_dose',+this.value)`)}</th>`;
    h+=`<th class="hdr-input-cell sticker-bg">${mkSel(PD_STICKER_OPTIONS,c.D_sticker,`updatePDChem('${w}','D_sticker',this.value)`)}${mkDose(c.D_sticker_dose,c.D_sticker_unit,`updatePDDose('${w}','D_sticker_dose',+this.value)`)}</th>`;
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
}
function togPD(n,m,w,plot,type,el){
  if(!canEditSchedule) return;
  const s=getState(n,m);
  if(!s.pd[w][plot]) s.pd[w][plot]={P:false,D:false};
  s.pd[w][plot][type]=!s.pd[w][plot][type];
  renderPD();          // full re-render so 'modified' class updates correctly
  autoSyncRecords();
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
}
function updateManuringDose(ri, ci, v){
  if(!canEditSchedule) return;
  getState(getNursery(),getMonth()).manuringConfig[ri][ci].dose = v;
  renderManuring();
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
}
function removeManuringRound(){
  if(!canEditSchedule) return;
  const s = getState(getNursery(),getMonth());
  if (s.manuringConfig.length <= 1) return;
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
        <span class="th-title">${t('hdr.round')} ${ri+1}</span>
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
      h+=`<th class="hdr-input-cell f-bg">${mkSel(FERT_OPTIONS,c.name,`updateManuringChem(${ri},${ci},this.value)`)}</th>`;
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
      h+=`<td class="check-td${all?' ticked':''}" style="background:#eef6ff" onclick="toggleAllManuring(${ri},${ci})" title="${t('act.selectAll')} ${t('hdr.round')} ${ri+1}"></td>`;
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
}
function togManuring(n,m,plot,ri,ci,el){
  if(!canEditSchedule) return;
  const s=getState(n,m);
  if(!s.manuring[plot]) s.manuring[plot]=[];
  if(!s.manuring[plot][ri]) s.manuring[plot][ri]=[];
  s.manuring[plot][ri][ci] = !s.manuring[plot][ri][ci];
  renderManuring();
  autoSyncRecords();
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
}

/* ════════════════════════════
   WEEDING TABLE  (Round 1 & Round 2 only)
════════════════════════════ */
function renderWeeding() {
  const n=getNursery(), m=getMonth(), s=getState(n,m), plots=NURSERY_PLOTS[n];
  const rounds=['R1','R2'];
  let h='<thead><tr>';
  h+=`<th rowspan="2" class="plot-col-hdr">${t('col.plot')}</th>`;
  h+=`<th colspan="2" class="wk-th">${t('hdr.weeding')}</th>`;
  h+='</tr><tr>';
  rounds.forEach(r=>h+=`<th class="p-th" style="min-width:130px;">${t('hdr.round')} ${r[1]}</th>`);
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
}
function updateInterrowDose(ri, ci, f, v){
  if(!canEditSchedule) return;
  getState(getNursery(),getMonth()).interrowConfig[ri][ci][f] = v;
  renderInterrow();
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
}
function removeInterrowRound(){
  if(!canEditSchedule) return;
  const s = getState(getNursery(),getMonth());
  if (s.interrowConfig.length <= 1) return;
  s.interrowConfig.pop();
  NURSERY_PLOTS[getNursery()].forEach(p => {
    if (s.interrow[p]) s.interrow[p].pop();
  });
  renderInterrow();
  autoSyncRecords();
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
}

function renderInterrow() {
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
        <span class="th-title">${t('hdr.round')} ${ri+1}</span>
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
        ${mkSel(INTERROW_CHEM_OPTIONS,c.chem,`updateInterrowChem(${ri},${ci},this.value)`)}
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
      h+=`<td class="check-td${all?' ticked':''}" style="background:#eef6ff" onclick="toggleAllInterrow(${ri},${ci})" title="${t('act.selectAll')} ${t('hdr.round')} ${ri+1}"></td>`;
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
}
function togInterrow(n,m,plot,ri,ci,el){
  if(!canEditSchedule) return;
  const s=getState(n,m);
  if(!s.interrow[plot]) s.interrow[plot]=[];
  if(!s.interrow[plot][ri]) s.interrow[plot][ri]=[];
  s.interrow[plot][ri][ci] = !s.interrow[plot][ri][ci];
  renderInterrow();
  autoSyncRecords();
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
function saveSchedule() {
  const n = getNursery(), m = getMonth(), s = getState(n, m);
  const plots = NURSERY_PLOTS[n];
  const tasks = [];
  let id = 1;

  // Build flat task list from schedule state
  const cfg = s.pdConfig;
  ['W1','W2','W3','W4'].forEach(w => {
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
  ['R1','R2'].forEach(r => {
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

  showSaveToast(tasks.length);
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
    if (dF && !r.tarikh.toLowerCase().includes(dF)) return false;
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
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2.5rem;color:var(--text-faint);">${t('rec.none')}</td></tr>`;
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
      <td colspan="9" class="rec-group-cell" style="padding:12px 14px 9px;font-weight:700;letter-spacing:1px;
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
        <td style="font-weight:600;color:var(--green-text);">${r.tarikh}</td>
        <td>${jenisLabel(r.jenis)}</td>
        <td><span class="pill ${pillCls(r.jenis)}">${r.racun||'—'}</span></td>
        <td style="text-align:center;font-weight:700;color:var(--green-text);">${r.plot}</td>
        <td style="text-align:center;color:var(--text-muted);">${r.batch||'—'}</td>
        <td style="text-align:center;font-weight:700;color:var(--text-head);">${(r.qty===0||r.qty)?Number(r.qty).toLocaleString():'—'}</td>
        <td style="text-align:center;"><span class="chk-btn ${r.gaia?'chk-on':'chk-off'}${(r.checked && !isNopsAdmin)?' chk-locked':''}" ${(r.checked && !isNopsAdmin)?'title="Checked — only an admin can change this"':`onclick="togRec(${r.id},'gaia')"`}>${r.gaia?'☑':'☐'}</span></td>
        <td style="color:var(--text-muted);">${r.remark||'—'}</td>
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
function persistRecords() {
  if (!_supabase || !_dbReady) return;
  clearTimeout(_recSaveTimer);
  _recSaveTimer = setTimeout(() => {
    _supabase.from('nops_maint_records')
      .upsert({ id: 1, records: records, updated_at: new Date().toISOString() })
      .then(({ error }) => { if (error) console.warn('[maint] records save failed:', error.message); });
  }, 400);
}
/* A checked row is locked to everyone except an admin of the
   Nursery Operation Management module (User Access). */
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
  document.getElementById('rec-modal-title').textContent=editRecId?'Edit Record':'Add Work Record';
  document.getElementById('rf-tarikh').value=pre?.tarikh||'';
  document.getElementById('rf-jenis').value=pre?.jenis||'Penyemburan racun kulat dan serangga';
  document.getElementById('rf-racun').value=pre?.racun||'';
  document.getElementById('rf-plot').value=pre?.plot||'';
  document.getElementById('rf-batch').value=pre?.batch||'';
  document.getElementById('rf-qty').value=(pre && (pre.qty===0||pre.qty)) ? pre.qty : '';
  document.getElementById('rf-gaia').value=pre?.gaia||0;
  document.getElementById('rf-remark').value=pre?.remark||'';
  document.getElementById('rec-modal').classList.add('open');
}
function closeRecModal(){ document.getElementById('rec-modal').classList.remove('open'); }
function editRec(id){ const r=records.find(x=>x.id===id); if(_recLocked(r)) return _denyLocked(); openRecModal(r); }
function deleteRec(id){ const r=records.find(x=>x.id===id); if(_recLocked(r)) return _denyLocked(); if(!confirm('Delete this record?')) return; records=records.filter(x=>x.id!==id); renderRecords(); persistRecords(); }
function saveRec(){
  const obj={
    tarikh:document.getElementById('rf-tarikh').value,
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
  const PALETTE = {
    headerDark:  {fill:[8,92,51],   textColor:[255,255,255]},
    headerP:     {fill:[196,239,209], textColor:[8,92,51]},
    headerD:     {fill:[194,213,242], textColor:[24,69,140]},
    chemP:       {fill:[235,250,240], textColor:[8,92,51]},
    chemD:       {fill:[235,242,252], textColor:[24,69,140]},
    sticker:     {fill:[255,247,219], textColor:[140,95,12]},
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
      cell(x, y, colW*2, rowH, `${t('hdr.week')} ${w[1]}`, {...PALETTE.headerDark, style:'bold', size:8});
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
      cell(x, y, colW, rowH, pStk, {...PALETTE.sticker, size:6.5});
      cell(x + colW, y, colW, rowH, dStk, {...PALETTE.sticker, size:6.5});
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
      cell(x, y, colW, rowH, String(plots.filter(p=>s.pd[w]?.[p]?.P).length), {...PALETTE.summary, style:'bold', size:8});
      cell(x+colW, y, colW, rowH, String(plots.filter(p=>s.pd[w]?.[p]?.D).length), {...PALETTE.summary, style:'bold', size:8});
    });
    y += rowH;

    // Jumlah Bibit
    cell(startX, y, plotColW, rowH, t('sum.jumlahBibit'), {...PALETTE.summaryDark, style:'bold', size:8});
    W.forEach((w, wi) => {
      const x = startX + plotColW + wi*colW*2;
      const pSeed = sumSeedlings(pN, plots, p => s.pd[w]?.[p]?.P);
      const dSeed = sumSeedlings(pN, plots, p => s.pd[w]?.[p]?.D);
      cell(x, y, colW, rowH, pSeed ? pSeed.toLocaleString() : '—', {...PALETTE.summary, size:8});
      cell(x+colW, y, colW, rowH, dSeed ? dSeed.toLocaleString() : '—', {...PALETTE.summary, size:8});
    });
    y += rowH;

    // Maksimal Racun Guna — 1 decimal
    cell(startX, y, plotColW, rowH, t('sum.maxRacun'), {...PALETTE.summaryDark, style:'bold', size:7.5});
    W.forEach((w, wi) => {
      const c = cfg[w];
      const x = startX + plotColW + wi*colW*2;
      const pSeed = sumSeedlings(pN, plots, p => s.pd[w]?.[p]?.P);
      const dSeed = sumSeedlings(pN, plots, p => s.pd[w]?.[p]?.D);
      cell(x, y, colW, rowH, calcMaxChem(pSeed, c.P, c.P_dose, c.P_unit, 1), {...PALETTE.summary, style:'bold', size:8});
      cell(x+colW, y, colW, rowH, calcMaxChem(dSeed, c.D, c.D_dose, c.D_unit, 1), {...PALETTE.summary, style:'bold', size:8});
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
      cell(x, y, colW, rowH, pBond, {...PALETTE.summary, style:'bold', size:8});
      cell(x+colW, y, colW, rowH, dBond, {...PALETTE.summary, style:'bold', size:8});
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
      cell(xCursor, y, w, rowH, `${t('hdr.round')} ${ri+1}`, {...PALETTE.headerDark, style:'bold', size:8});
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
      cell(x, y, colW, rowH, `${t('hdr.round')} ${r[1]}`, {...PALETTE.headerDark, style:'bold', size:8});
    });
    y += rowH;
    rounds.forEach((r, i) => {
      const x = startX + plotColW + i*colW;
      cell(x, y, colW, rowH, t('pdf.merumput'), {...PALETTE.chemP, size:7});
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
      cell(xCursor, y, w, rowH, `${t('hdr.round')} ${ri+1}`, {...PALETTE.headerDark, style:'bold', size:8});
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
        cell(xCursor, y, colW, rowH, `Activator ${c.activator_dose}${c.activator_unit}`, {...PALETTE.sticker, size:7});
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
    if (r.tarikh && r.tarikh !== '-') {
      const parts = r.tarikh.split('-');
      if (parts.length === 3) {
        const mi = parseInt(parts[1]) - 1;
        if (mi >= 0 && mi < 12) {
          if (r.gaia) monthlyDone[mi]++;
          else monthlyPending[mi]++;
        }
      }
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
document.getElementById('nursery-pill').textContent = getNursery();
syncNurseryCircles();
applyLang();        // applies saved language + renders all views
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
    }
    const [stRes, recRes, qtyRes, cpRes, prRes, wkRes, payRes] = await Promise.all([
      _supabase.from('nops_maint_state').select('nursery, month, payload'),
      _supabase.from('nops_maint_records').select('records').eq('id', 1).maybeSingle(),
      _supabase.from('nops_maint_plot_qty').select('nursery, plot, qty'),
      _supabase.from('nops_maint_custom_plots').select('nursery, plot').then(r => r, () => ({ data: [] })),
      _supabase.from('nops_maint_piece_rates').select('work_type, rate').then(r => r, () => ({ data: [] })),
      _supabase.from('nops_maint_workers').select('nursery, name').then(r => r, () => ({ data: [] })),
      _supabase.from('nops_maint_payroll').select('nursery, month, work_type, data').then(r => r, () => ({ data: [] }))
    ]);
    (stRes.data || []).forEach(r => {
      dbStateCache[`${r.nursery}_${r.month}`] = r.payload;
      if (appState[r.nursery]) delete appState[r.nursery][r.month]; // rebuild from DB
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
    ((prRes && prRes.data) || []).forEach(r => { pieceRates[r.work_type] = r.rate; });
    ((wkRes && wkRes.data) || []).forEach(r => {
      if (!workers[r.nursery]) workers[r.nursery] = [];
      if (!workers[r.nursery].includes(r.name)) workers[r.nursery].push(r.name);
    });
    ((payRes && payRes.data) || []).forEach(r => {
      payrollData[payrollKey(r.nursery, r.month, r.work_type)] = r.data || {};
    });
  } catch (e) { console.warn('[maint] initial DB load failed:', e); }
  _dbReady = true;
  renderAll();
  autoSyncRecords();
  renderSettingPlots(); renderSettingRates(); renderSettingWorkers();
}
initDb();