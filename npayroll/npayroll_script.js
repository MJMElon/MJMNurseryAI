/* ════════════════════════════════════════════════════════════════
   MJM NURSERY — Payroll System
   npayroll_script.js

   Three tabs:
     Payroll       Work Maintenance · Transplanting · Seedlings Collection
                   · Monthly Payroll
     Worker System PN · BNN · UNN1 · UNN2 · UNE · Driver
     Piece Rate    job description · unit · rate

   Work Maintenance is READ from the Worker Record in the Nursery Operation
   module. That sheet records the capacity each worker completed and carries
   no money; this one prices it. One place records the work, one place pays
   for it. Transplanting and Seedlings Collection are keyed here, priced from
   the Piece Rate list.
════════════════════════════════════════════════════════════════ */

const _supabase = supabase.createClient(SHARED_SUPA_URL, SHARED_SUPA_KEY);
const $  = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* Sections the payroll is filed under. The first four match the nurseries;
   UNE and Driver exist only here. */
const SECTIONS = [
  { code:'PN',     name:'PN — Pre Nursery'     },
  { code:'BNN',    name:'BNN — Batu Niah'      },
  { code:'UNN1',   name:'UNN1 — Ulu Niah 1'    },
  { code:'UNN2',   name:'UNN2 — Ulu Niah 2'    },
  { code:'UNE',    name:'UNE'                  },
  { code:'Driver', name:'Driver'               }
];
const SECTION_NAME = Object.fromEntries(SECTIONS.map(s => [s.code, s.name]));
const NURSERY_FULL = { PN:'Pre Nursery', BNN:'Batu Niah Nursery', UNN1:'Ulu Niah Nursery 1', UNN2:'Ulu Niah Nursery 2' };
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let workers   = [];    // mjmnpayroll_workers
let rates     = [];    // mjmnpayroll_piece_rates
let entries   = [];    // mjmnpayroll_work_entries for the open month
let userEmail = '';
let isAdmin   = false;
let _tablesOk = true;

/* Work-maintenance data, mirrored from the Nursery Operation module. */
let maint = { records: [], ticks: {}, rates: {}, workers: {}, localWorkers: {} };

/* The Work Maintenance tick sheets take their worker names from the Worker
   System below — a nursery's own section, general workers only. Resolve it the
   same way here, or the salary claim would price a different set of names than
   the sheet it is priced from shows. Kept identical to isGeneralWorker in
   nursery_ops/plot_maintenance_script.js. */
const MAINT_NURSERIES  = ['PN', 'BNN', 'UNN1', 'UNN2'];
const GENERAL_ROLE     = /general|pekerja am|buruh am/i;
const NON_GENERAL_ROLE = /driver|pemandu|conductor|kondektor|konduktor|supervisor|penyelia|mandor|mandur|kepala|kerani|clerk|admin|manager|pengurus|executive|eksekutif|mekanik|mechanic|technician|juruteknik|security|pengawal|jaga|foreman|operator|storekeeper|storeman/i;
const roleOf = w => String(w.role || w.job_title || '');

/* Three rules, in order: the worker's own switch settles it; else, if the
   nursery names the role at all, only those carrying it count; else everyone
   bar the plainly non-general roles. `maint_general` is the switch and the
   only rule that cannot be wrong — the role lists are a starting guess. */
function isGeneralWorker(w, nurseryNamesTheRole) {
  if (w.active === false) return false;
  if (w.maint_general === true)  return true;
  if (w.maint_general === false) return false;
  if (nurseryNamesTheRole) return GENERAL_ROLE.test(roleOf(w));
  return !NON_GENERAL_ROLE.test(roleOf(w));
}
/* Does this nursery label its general workers by role? */
function nurseryNamesRole(n) {
  return workers.some(w => String(w.section || '').trim().toUpperCase() === n &&
                           w.active !== false && GENERAL_ROLE.test(roleOf(w)));
}
/* Is this worker on the Work Maintenance sheets? Used by the list and the
   worker form, so what is shown is what the sheets actually do. */
function onMaintSheet(w) {
  const n = String(w.section || '').trim().toUpperCase();
  if (!MAINT_NURSERIES.includes(n)) return false;
  return isGeneralWorker(w, nurseryNamesRole(n));
}

function resolveMaintWorkers() {
  maint.workers = {};
  MAINT_NURSERIES.forEach(n => {
    const named = nurseryNamesRole(n);
    const linked = [...new Set(workers
      .filter(w => String(w.section || '').trim().toUpperCase() === n)   // UNE, Driver excluded
      .filter(w => isGeneralWorker(w, named))
      .map(w => String(w.full_name || '').trim())
      .filter(Boolean))].sort((a, b) => a.localeCompare(b));
    maint.workers[n] = linked.length ? linked : (maint.localWorkers[n] || []);
  });
}

const money = v => 'RM ' + (Number(v) || 0).toFixed(2);
/* A rate may carry more than two decimals (0.015). Printing it as "0.01"
   next to money worked out from 0.015 makes the sheet look wrong. */
function rateTxt(v) {
  if (v == null) return '—';
  const n = Number(v) || 0;
  for (let d = 2; d <= 4; d++) if (Math.abs(n - Number(n.toFixed(d))) < 1e-9) return 'RM ' + n.toFixed(d);
  return 'RM ' + n.toFixed(4);
}
const num   = v => (Number(v) || 0).toLocaleString();
function monthValue() { return $('global-month').value || todayMonth(); }
function todayMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function monthLabel(m) { const [y, mo] = String(m).split('-'); return `${MONTHS_SHORT[+mo-1] || mo} ${y}`; }
/* The maintenance module stores its month as "Apr 2026". */
function maintMonthLabel(m) { return monthLabel(m); }

/* ════════════ TABS ════════════ */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $('tab-' + name).classList.add('active');
  try { localStorage.setItem('npayroll_tab', name); } catch (_) {}
  if (name === 'workers') renderWorkers();
  if (name === 'rates')   renderRates();
  if (name === 'payroll') refreshPayrollTab();
}
function switchSub(name) {
  document.querySelectorAll('.subtab').forEach(b => b.classList.toggle('active', b.dataset.sub === name));
  document.querySelectorAll('.subpanel').forEach(p => p.classList.remove('active'));
  $('sub-' + name).classList.add('active');
  try { localStorage.setItem('npayroll_sub', name); } catch (_) {}
  refreshPayrollTab();
}
function activeSub() {
  const b = document.querySelector('.subtab.active');
  return b ? b.dataset.sub : 'maint';
}
function refreshPayrollTab() {
  const s = activeSub();
  if (s === 'maint')    renderMaint();
  if (s === 'transpl')  renderEntries('transplanting');
  if (s === 'seedling') renderEntries('seedlings');
  if (s === 'monthly')  renderMonthly();
}

function closeModal(id) { $(id).classList.remove('open'); }

/* ════════════ WORKER SYSTEM ════════════ */
function renderWorkers() {
  const box = $('worker-sections');
  const showInactive = $('w-show-inactive').checked;
  const q = ($('w-search').value || '').trim().toLowerCase();

  box.innerHTML = SECTIONS.map(sec => {
    const list = workers.filter(w =>
      (w.section || '') === sec.code &&
      (showInactive || w.active !== false) &&
      (!q || `${w.full_name || ''} ${w.role || ''}`.toLowerCase().includes(q))
    );
    const rows = list.length ? list.map((w, i) => `
      <tr>
        <td style="color:var(--text-faint);width:44px;">${i + 1}</td>
        <td class="l" style="font-weight:700;color:var(--text-head);">${esc(w.full_name)}${
          w.worker_no ? `<div style="font-size:11px;font-weight:400;color:var(--text-faint);">${esc(w.worker_no)}</div>` : ''}</td>
        <td class="l">${esc(w.role || '—')}${onMaintSheet(w)
          ? '<div class="maint-chip" title="Has a column on the Work Maintenance tick sheets">🌱 maintenance</div>' : ''}</td>
        <td><span class="pill ${w.active === false ? 'pill-off' : 'pill-on'}">${w.active === false ? 'Inactive' : 'Active'}</span></td>
        <td class="r" style="white-space:nowrap;">
          <button class="btn btn-sm" onclick="openWorker(${w.id})">Edit</button>
          ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="removeWorker(${w.id})">Remove</button>` : ''}
        </td>
      </tr>`).join('')
      // While a search is running an empty section means "nothing matched",
      // not "nobody works here" — offering to add someone there would be wrong.
      : q
        ? `<tr><td colspan="5" class="empty">No match in this section.</td></tr>`
        : `<tr><td colspan="5" class="empty">No worker in this section yet.
             <button class="btn btn-sm wsec-add-inline" onclick="openWorker(null,'${sec.code}')"
                     >+ Add to ${esc(sec.code)}</button></td></tr>`;

    return `
      <div class="wsec">
        <div class="wsec-head">
          <span class="wsec-name">${esc(sec.name)}</span>
          <span class="wsec-count">${list.length} worker${list.length === 1 ? '' : 's'}</span>
          <button class="btn btn-sm wsec-add" onclick="openWorker(null,'${sec.code}')"
                  title="Add a worker to ${esc(sec.name)}">+ Add Worker</button>
        </div>
        <div class="wsec-body"><div class="tbl-wrap"><table>
          <thead><tr><th style="width:44px;">No.</th><th class="l">Name</th><th class="l">Role</th>
                     <th style="width:100px;">Status</th><th style="width:150px;"></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div></div>
      </div>`;
  }).join('');
}

function fillSectionSelect(el, includeAll, selected) {
  if (!el) return;
  el.innerHTML = (includeAll ? '<option value="">All sections</option>' : '') +
    SECTIONS.map(s => `<option value="${s.code}">${esc(s.name)}</option>`).join('');
  if (selected != null) el.value = selected;
}

let editWorkerId = null;
/* `section` is the section the button was pressed in. Every section heads its
   own Add Worker button, so the section is known before the form opens — there
   is no location to fill in, and no filing a Batu Niah sprayer under PN because
   the form happened to open on PN. Editing can still move somebody, but that is
   behind "Move…" rather than a field to answer every time. */
function openWorker(id, section) {
  if (!_tablesOk) { alert('Set the database up first — see the notice at the top.'); return; }
  const w = id ? workers.find(x => x.id === id) : null;
  editWorkerId = w ? w.id : null;
  fillSectionSelect($('wf-section'), false, w?.section || section || SECTIONS[0].code);
  $('wf-section-row').classList.add('hidden');
  $('wf-move-btn').classList.toggle('hidden', !w);   // only an existing worker moves
  onWorkerSectionChange();               // titles the modal with that section
  $('wf-name').value   = w?.full_name || '';
  $('wf-role').value   = w?.role || '';
  $('wf-no').value     = w?.worker_no || '';
  $('wf-active').value = (w && w.active === false) ? '0' : '1';
  $('wf-remark').value = w?.remark || '';
  _maintExplicit = w ? (w.maint_general === true || w.maint_general === false) : false;
  $('wf-maint').checked = w ? onMaintSheet(w) : true;
  onWorkerRoleChange();
  $('worker-modal').classList.add('open');
  $('wf-name').focus();
}

/* The tick box starts on whatever the role implies, so an existing worker
   opens showing what the sheets are actually doing today. Typing a role
   re-guesses it — until somebody sets the box themselves, after which their
   answer stands and the role stops moving it. */
let _maintExplicit = false;
function onWorkerRoleChange() {
  const row = $('wf-maint-row');
  const sec = $('wf-section').value;
  const nursery = MAINT_NURSERIES.includes(sec);
  row.classList.toggle('hidden', !nursery);        // UNE and Driver have no sheet
  if (!nursery) return;
  if (!_maintExplicit) {
    const named = nurseryNamesRole(sec);
    $('wf-maint').checked = isGeneralWorker({ role: $('wf-role').value, active: true }, named);
  }
  const why = _maintExplicit ? 'Set on this worker.'
    : nurseryNamesRole(sec)
      ? `Guessed from the role — ${SECTION_NAME[sec] || sec} labels its general workers, so only those roles are ticked. Change it here if that is wrong.`
      : 'Guessed from the role. Change it here if that is wrong.';
  $('wf-maint-why').textContent = _maintGeneralCol ? why
    : 'Guessed from the role. Run shared/fix_npayroll_maint_general.sql to set it per worker.';
}

/* Keep the modal saying, in words, where this worker is filed — in the title
   and again in the body, so it is read either way. */
function onWorkerSectionChange() {
  const code  = $('wf-section').value;
  const label = SECTION_NAME[code] || code;
  $('worker-modal-title').textContent = `${editWorkerId ? 'Edit' : 'Add'} Worker — ${label}`;
  $('wf-section-hint').textContent = `Filed under ${label}.`;
  if ($('wf-maint-row')) onWorkerRoleChange();
}

/* Correcting a worker who ended up in the wrong section. Hidden until asked
   for, so adding a worker never puts the question in front of anyone. */
function showWorkerSectionSelect() {
  $('wf-section-row').classList.remove('hidden');
  $('wf-move-btn').classList.add('hidden');
  $('wf-section').focus();
}

async function saveWorker() {
  const name = $('wf-name').value.trim();
  if (!name) { alert('Enter the worker\'s name.'); return; }
  const row = {
    full_name: name,
    section:   $('wf-section').value,
    role:      $('wf-role').value.trim() || null,
    worker_no: $('wf-no').value.trim() || null,
    active:    $('wf-active').value === '1',
    remark:    $('wf-remark').value.trim() || null,
    // Kept in step so anything still reading the original columns agrees.
    nursery:   $('wf-section').value,
    job_title: $('wf-role').value.trim() || null,
    updated_at: new Date().toISOString(),
    updated_by: userEmail || null
  };
  // Writing a column the table does not have fails the whole save.
  if (_maintGeneralCol && MAINT_NURSERIES.includes(row.section)) row.maint_general = $('wf-maint').checked;
  $('wf-save').disabled = true;
  try {
    let error;
    if (editWorkerId) ({ error } = await _supabase.from('mjmnpayroll_workers').update(row).eq('id', editWorkerId));
    else { row.created_by = userEmail || null; ({ error } = await _supabase.from('mjmnpayroll_workers').insert(row)); }
    if (error) throw error;
    closeModal('worker-modal');
    await loadWorkers();
    resolveMaintWorkers();          // the maintenance sheets read this register
    renderWorkers();
  } catch (e) {
    alert('Could not save the worker.\n\n' + (e.message || e));
  } finally { $('wf-save').disabled = false; }
}

async function removeWorker(id) {
  const w = workers.find(x => x.id === id);
  if (!w) return;
  if (!isAdmin) { alert('Only an administrator can remove a worker.'); return; }
  // Deleting takes their pay entries with it, so offer the safe option first.
  const ok = confirm(`Remove ${w.full_name}?\n\nOK = delete permanently (their work entries go too).\n` +
                     `Cancel = keep the record and mark them Inactive.`);
  const q = ok
    ? _supabase.from('mjmnpayroll_workers').delete().eq('id', id)
    : _supabase.from('mjmnpayroll_workers').update({ active: false, updated_by: userEmail || null }).eq('id', id);
  const { error } = await q;
  if (error) { alert('Could not update: ' + error.message); return; }
  await loadWorkers();
  resolveMaintWorkers();
  renderWorkers();
}

/* ════════════ PIECE RATE ════════════ */
const CAT_LABEL = { transplanting:'Transplanting', seedlings:'Seedlings Collection',
                    maintenance:'Work Maintenance', other:'Other', '':'Any sheet' };

/* The three groups a job is filed under. A separate question from `category`
   above, which says which sheet offers the job — a Main Nursery job can be a
   transplanting job, so both are kept. */
const RATE_GROUPS = [
  { code:'MN',        name:'MN — Main Nursery' },
  { code:'PN',        name:'PN — Pre Nursery'  },
  { code:'Machinery', name:'Machinery'         }
];
const RATE_GROUP_NAME = Object.fromEntries(RATE_GROUPS.map(g => [g.code, g.name]));
/* False until the group_code column exists — see loadRates. */
let _rateGroupCol = true;

function renderRates() {
  const codes = RATE_GROUPS.map(g => g.code);
  const ungrouped = rates.filter(r => !codes.includes(r.group_code));
  // "Not grouped yet" is shown only when something is actually sitting in it,
  // so a tidy list never carries an empty fourth block.
  const blocks = RATE_GROUPS.concat(
    ungrouped.length ? [{ code:'', name:'Not grouped yet' }] : []);

  $('rate-groups').innerHTML = blocks.map(g => {
    const list = g.code ? rates.filter(r => r.group_code === g.code) : ungrouped;
    const rows = list.length ? list.map((r, i) => `
      <tr>
        <td style="color:var(--text-faint);width:44px;">${i + 1}</td>
        <td class="l" style="font-weight:700;color:var(--text-head);">${esc(r.job_desc)}</td>
        <td>${esc(r.unit || '—')}</td>
        <td class="money">${rateTxt(r.rate)}</td>
        <td>${esc(CAT_LABEL[r.category || ''] || r.category)}</td>
        <td><span class="pill ${r.active === false ? 'pill-off' : 'pill-on'}">${r.active === false ? 'Inactive' : 'Active'}</span></td>
        <td class="r" style="white-space:nowrap;">
          <button class="btn btn-sm" onclick="openRate(${r.id})">Edit</button>
          ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="removeRate(${r.id})">Remove</button>` : ''}
        </td>
      </tr>`).join('')
      : `<tr><td colspan="7" class="empty">No job in this group yet.${
          g.code ? ` <button class="btn btn-sm wsec-add-inline" onclick="openRate(null,'${g.code}')"
                            >+ Add to ${esc(g.code)}</button>` : ''}</td></tr>`;

    return `
      <div class="wsec">
        <div class="wsec-head">
          <span class="wsec-name">${esc(g.name)}</span>
          <span class="wsec-count">${list.length} job${list.length === 1 ? '' : 's'}</span>
          ${g.code ? `<button class="btn btn-sm wsec-add" onclick="openRate(null,'${g.code}')"
                              title="Add a job to ${esc(g.name)}">+ Add Job</button>` : ''}
        </div>
        <div class="wsec-body"><div class="tbl-wrap"><table>
          <thead><tr>
            <th style="width:44px;">No.</th><th class="l">Job Description</th><th style="width:110px;">Unit</th>
            <th style="width:130px;">Piece Rate</th><th style="width:170px;">Used For</th>
            <th style="width:100px;">Status</th><th style="width:150px;"></th>
          </tr></thead><tbody>${rows}</tbody>
        </table></div></div>
      </div>`;
  }).join('');
}

let editRateId  = null;
let rateGroup   = 'MN';
/* `group` is the group whose Add Job button was pressed, so the group is
   settled before the form opens — same as a worker's section. */
function openRate(id, group) {
  if (!_tablesOk) { alert('Set the database up first — see the notice at the top.'); return; }
  const r = id ? rates.find(x => x.id === id) : null;
  editRateId = r ? r.id : null;
  rateGroup  = (r && r.group_code) || group || RATE_GROUPS[0].code;
  const label = RATE_GROUP_NAME[rateGroup] || rateGroup;
  $('rate-modal-title').textContent = `${r ? 'Edit' : 'Add'} Job — ${label}`;
  $('rf-group-hint').textContent = _rateGroupCol
    ? `Filed under ${label}.`
    : `Grouping is off until shared/fix_npayroll_rate_groups.sql is run.`;
  $('rf-group-row').classList.add('hidden');
  $('rf-move-btn').classList.toggle('hidden', !r || !_rateGroupCol);
  $('rf-group').innerHTML = RATE_GROUPS.map(g => `<option value="${g.code}">${esc(g.name)}</option>`).join('');
  $('rf-group').value  = rateGroup;
  $('rf-job').value    = r?.job_desc || '';
  $('rf-unit').value   = r?.unit || '';
  $('rf-rate').value   = (r && r.rate != null) ? r.rate : '';
  $('rf-cat').value    = r?.category || '';
  $('rf-active').value = (r && r.active === false) ? '0' : '1';
  $('rate-modal').classList.add('open');
  $('rf-job').focus();
}

function onRateGroupChange() {
  rateGroup = $('rf-group').value;
  const label = RATE_GROUP_NAME[rateGroup] || rateGroup;
  $('rate-modal-title').textContent = `${editRateId ? 'Edit' : 'Add'} Job — ${label}`;
  $('rf-group-hint').textContent = `Filed under ${label}.`;
}
function showRateGroupSelect() {
  $('rf-group-row').classList.remove('hidden');
  $('rf-move-btn').classList.add('hidden');
  $('rf-group').focus();
}

async function saveRate() {
  const job = $('rf-job').value.trim();
  if (!job) { alert('Enter the job description.'); return; }
  const raw = ($('rf-rate').value ?? '').trim();
  if (raw === '') { alert('Enter the piece rate.'); return; }
  const row = {
    job_desc: job,
    unit:     $('rf-unit').value.trim() || null,
    rate:     Math.max(0, parseFloat(raw) || 0),
    category: $('rf-cat').value || null,
    active:   $('rf-active').value === '1',
    updated_at: new Date().toISOString(),
    updated_by: userEmail || null
  };
  // Writing a column the table does not have fails the whole save, so hold
  // the group back until the migration has been run.
  if (_rateGroupCol) row.group_code = rateGroup;
  $('rf-save').disabled = true;
  try {
    let error;
    if (editRateId) ({ error } = await _supabase.from('mjmnpayroll_piece_rates').update(row).eq('id', editRateId));
    else { row.created_by = userEmail || null; ({ error } = await _supabase.from('mjmnpayroll_piece_rates').insert(row)); }
    if (error) throw error;
    closeModal('rate-modal');
    await loadRates();
    renderRates();
  } catch (e) {
    alert('Could not save the job.\n\n' + (e.message || e));
  } finally { $('rf-save').disabled = false; }
}

async function removeRate(id) {
  const r = rates.find(x => x.id === id);
  if (!r) return;
  if (!isAdmin) { alert('Only an administrator can remove a job.'); return; }
  // Entries keep their own copy of the rate, so removing the job here cannot
  // change a month that has already been keyed.
  if (!confirm(`Remove "${r.job_desc}"?\n\nWork already keyed against it keeps its own rate and stays correct.`)) return;
  const { error } = await _supabase.from('mjmnpayroll_piece_rates').delete().eq('id', id);
  if (error) { alert('Could not remove: ' + error.message); return; }
  await loadRates();
  renderRates();
}

/* ════════════ TRANSPLANTING / SEEDLINGS ════════════ */
const SHEET = {
  transplanting: { table:'transpl-table',  section:'transpl-section',  title:'Transplanting' },
  seedlings:     { table:'seedling-table', section:'seedling-section', title:'Seedlings Collection' }
};

function renderEntries(category) {
  const cfg = SHEET[category];
  const secFilter = $(cfg.section).value || '';
  const list = entries
    .filter(e => e.category === category)
    .filter(e => !secFilter || (e.section || '') === secFilter)
    .sort((a, b) => String(a.work_date || '').localeCompare(String(b.work_date || '')) || a.id - b.id);

  const wName = id => (workers.find(w => w.id === id) || {}).full_name || '—';
  const rows = list.length ? list.map((e, i) => `
    <tr>
      <td style="color:var(--text-faint);width:44px;">${i + 1}</td>
      <td>${e.work_date ? fmtDay(e.work_date) : '—'}</td>
      <td class="l" style="font-weight:700;color:var(--text-head);">${esc(wName(e.worker_id))}</td>
      <td>${esc(e.section || '—')}</td>
      <td class="l">${esc(e.job_desc || '—')}</td>
      <td>${num(e.qty)}${e.unit ? ' ' + esc(e.unit) : ''}</td>
      <td>${rateTxt(e.rate)}</td>
      <td class="money">${money(e.amount)}</td>
      <td class="r" style="white-space:nowrap;">
        <button class="btn btn-sm" onclick="openEntry('${category}',${e.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="removeEntry(${e.id})">Del</button>
      </td>
    </tr>`).join('')
    : `<tr><td colspan="9" class="empty">Nothing keyed for ${monthLabel(monthValue())} yet.</td></tr>`;

  const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
  $(cfg.table).innerHTML = `
    <thead><tr>
      <th style="width:44px;">No.</th><th style="width:110px;">Date</th><th class="l">Worker</th>
      <th style="width:90px;">Section</th><th class="l">Job</th><th style="width:130px;">Quantity</th>
      <th style="width:110px;">Rate</th><th style="width:120px;">Amount</th><th style="width:140px;"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
    ${list.length ? `<tfoot><tr><td class="l" colspan="7">TOTAL — ${esc(monthLabel(monthValue()))}</td>
       <td>${money(total)}</td><td></td></tr></tfoot>` : ''}`;
}

const fmtDay = d => {
  const t = String(d || '');
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]} ${MONTHS_SHORT[+m[2]-1]}` : t;
};

let editEntryId = null, entryCategory = null;
function openEntry(category, id) {
  if (!_tablesOk) { alert('Set the database up first — see the notice at the top.'); return; }
  const e = id ? entries.find(x => x.id === id) : null;
  editEntryId = e ? e.id : null;
  entryCategory = category;
  $('entry-modal-title').textContent = (e ? 'Edit ' : 'Add ') + SHEET[category].title + ' Entry';

  fillSectionSelect($('ef-section'), false, e?.section || $(SHEET[category].section).value || 'BNN');
  $('ef-section').onchange = fillEntryWorkers;
  fillEntryWorkers(e?.worker_id);

  // Jobs for this sheet: its own category plus any left unassigned.
  const pool = rates.filter(r => r.active !== false && (!r.category || r.category === category));
  $('ef-rate').innerHTML = pool.length
    ? pool.map(r => `<option value="${r.id}">${esc(r.job_desc)}${r.unit ? ' (' + esc(r.unit) + ')' : ''} — ${rateTxt(r.rate)}</option>`).join('')
    : '<option value="">— no job set up under Piece Rate —</option>';
  if (e && e.rate_id) $('ef-rate').value = e.rate_id;

  $('ef-date').value   = e?.work_date || new Date().toISOString().slice(0, 10);
  $('ef-qty').value    = (e && e.qty != null) ? e.qty : '';
  $('ef-remark').value = e?.remark || '';
  onEntryQtyChange();
  $('entry-modal').classList.add('open');
}

function fillEntryWorkers(selectedId) {
  const sec = $('ef-section').value;
  const pool = workers.filter(w => w.active !== false && (w.section || '') === sec);
  $('ef-worker').innerHTML = pool.length
    ? pool.map(w => `<option value="${w.id}">${esc(w.full_name)}${w.role ? ' — ' + esc(w.role) : ''}</option>`).join('')
    : '<option value="">— no active worker in this section —</option>';
  if (selectedId) $('ef-worker').value = selectedId;
}

function currentEntryRate() { return rates.find(r => String(r.id) === String($('ef-rate').value)) || null; }
function onEntryJobChange() { onEntryQtyChange(); }
function onEntryQtyChange() {
  const r = currentEntryRate();
  const qty = parseFloat($('ef-qty').value) || 0;
  $('ef-amount').value = r ? (qty * Number(r.rate || 0)).toFixed(2) : '0.00';
}

async function saveEntry() {
  const workerId = $('ef-worker').value;
  const r = currentEntryRate();
  if (!workerId) { alert('Pick a worker. Add one under Worker System if the section is empty.'); return; }
  if (!r) { alert('Pick a job. Add one under Piece Rate first.'); return; }
  const qtyRaw = ($('ef-qty').value ?? '').trim();
  if (qtyRaw === '') { alert('Enter the quantity.'); return; }
  const qty = Math.max(0, parseFloat(qtyRaw) || 0);

  const row = {
    month:     monthValue(),
    category:  entryCategory,
    section:   $('ef-section').value,
    worker_id: Number(workerId),
    rate_id:   r.id,
    job_desc:  r.job_desc,          // snapshot — the job may be renamed later
    unit:      r.unit || null,
    work_date: $('ef-date').value || null,
    qty,
    rate:      Number(r.rate || 0), // snapshot — the rate may change later
    amount:    Math.round(qty * Number(r.rate || 0) * 100) / 100,
    remark:    $('ef-remark').value.trim() || null
  };
  $('ef-save').disabled = true;
  try {
    let error;
    if (editEntryId) ({ error } = await _supabase.from('mjmnpayroll_work_entries').update(row).eq('id', editEntryId));
    else { row.created_by = userEmail || null; ({ error } = await _supabase.from('mjmnpayroll_work_entries').insert(row)); }
    if (error) throw error;
    closeModal('entry-modal');
    await loadEntries();
    refreshPayrollTab();
  } catch (e) {
    alert('Could not save the entry.\n\n' + (e.message || e));
  } finally { $('ef-save').disabled = false; }
}

async function removeEntry(id) {
  if (!confirm('Delete this entry?')) return;
  const { error } = await _supabase.from('mjmnpayroll_work_entries').delete().eq('id', id);
  if (error) { alert('Could not delete: ' + error.message); return; }
  await loadEntries();
  refreshPayrollTab();
}

/* ════════════ WORK MAINTENANCE (mirrored from Nursery Operation) ════════════
   The maintenance module divides a plot's quantity among the workers ticked
   on that row, then pays it at that work type's piece rate. Repeat that here
   so the two always show the same figures. */
const MAINT_TYPES = [
  { code:'pd',       label:'P & D Spraying', jenis:'Penyemburan racun kulat dan serangga' },
  { code:'manuring', label:'Manuring',       jenis:'Membaja' },
  { code:'weeding',  label:'Weeding',        jenis:'Merumput' },
  { code:'interrow', label:'Interrow Spray', jenis:'Meracun rumput secara selingan' }
];

function maintTotals(nursery, month) {
  const wk = maint.workers[nursery] || [];
  const per = {};                       // worker → { code: capacity }
  wk.forEach(w => { per[w] = {}; MAINT_TYPES.forEach(t => per[w][t.code] = 0); });

  MAINT_TYPES.forEach(t => {
    const store = maint.ticks[`${nursery}_${month}_${t.code}`] || {};
    maint.records
      .filter(r => r.jenis === t.jenis && (r.__nursery === nursery))
      .forEach(r => {
        const cells  = store[r.id] || {};
        const ticked = wk.filter(w => cells[w]);
        if (!ticked.length) return;
        const cap = Number(r.qty) || 0;
        const share = cap / ticked.length;
        ticked.forEach(w => { per[w][t.code] += share; });
      });
  });
  return per;
}

function renderMaint() {
  const n = $('maint-nursery').value;
  const monthTxt = maintMonthLabel(monthValue());     // "Apr 2026"
  const wk = maint.workers[n] || [];
  const rateOf = c => (maint.rates[n] || {})[c];
  const per = maintTotals(n, monthTxt);

  $('maint-sub').textContent =
    `From Work Maintenance · ${NURSERY_FULL[n] || n} · ${monthTxt}`;

  if (!wk.length) {
    $('maint-table').innerHTML = `<tbody><tr><td class="empty">
      No general worker for ${esc(NURSERY_FULL[n] || n)} on the Worker System register.
      Add them under Worker System and they appear on the Work Maintenance sheet too.
    </td></tr></tbody>`;
    $('maint-note').textContent = '';
    return;
  }

  // Money from the rounded capacity, so the printed row multiplies out.
  const capOf = (w, c) => Math.round(per[w] ? per[w][c] : 0);
  const rmOf  = (w, c) => {
    const r = rateOf(c);
    if (r == null) return 0;
    return Math.round(capOf(w, c) * Math.round(r * 100000) / 1000) / 100;
  };
  const earned = w => MAINT_TYPES.reduce((s, t) => s + rmOf(w, t.code), 0);

  const head = `
    <thead>
      <tr>
        <th rowspan="2" style="width:44px;">No.</th>
        <th rowspan="2" class="l">Worker</th>
        ${MAINT_TYPES.map(t => `<th colspan="2">${esc(t.label)}</th>`).join('')}
        <th rowspan="2" style="width:120px;">Total Earned</th>
      </tr>
      <tr>${MAINT_TYPES.map(() => `<th style="width:90px;">Capacity</th><th style="width:110px;">Earned</th>`).join('')}</tr>
      <tr>
        <td colspan="2" class="l" style="font-weight:800;background:#fafaff;">Piece Rate</td>
        ${MAINT_TYPES.map(t => {
          const r = rateOf(t.code);
          return `<td colspan="2" style="background:#fafaff;font-size:12px;">${rateTxt(r)}</td>`;
        }).join('')}
        <td style="background:#fafaff;"></td>
      </tr>
    </thead>`;

  const body = wk.map((w, i) => `
    <tr>
      <td style="color:var(--text-faint);">${i + 1}</td>
      <td class="l" style="font-weight:700;color:var(--text-head);">${esc(w)}</td>
      ${MAINT_TYPES.map(t => {
        const c = capOf(w, t.code);
        return `<td>${c ? num(c) : '—'}</td><td>${c ? money(rmOf(w, t.code)) : '—'}</td>`;
      }).join('')}
      <td class="money">${money(earned(w))}</td>
    </tr>`).join('');

  const capSum = c => wk.reduce((s, w) => s + capOf(w, c), 0);
  const rmSum  = c => wk.reduce((s, w) => s + rmOf(w, c), 0);
  const grand  = wk.reduce((s, w) => s + earned(w), 0);
  const foot = `
    <tfoot><tr>
      <td class="l" colspan="2">GRAND TOTAL</td>
      ${MAINT_TYPES.map(t => `<td>${num(capSum(t.code))}</td><td>${money(rmSum(t.code))}</td>`).join('')}
      <td>${money(grand)}</td>
    </tr></tfoot>`;

  $('maint-table').innerHTML = head + `<tbody>${body}</tbody>` + foot;

  const missing = MAINT_TYPES.filter(t => rateOf(t.code) == null).map(t => t.label);
  $('maint-note').textContent = missing.length
    ? `No piece rate set for ${missing.join(', ')} — set it under Nursery Operation → Work Maintenance → Setting → Piece Rate.`
    : 'Capacity comes from the Worker Record in Work Maintenance — a plot’s quantity divided among the workers ticked on that row. The money is worked out here.';
}

/* ════════════ MONTHLY PAYROLL ════════════ */
function monthlyRows() {
  const secFilter = $('monthly-section').value || '';
  const month = monthValue();
  const monthTxt = maintMonthLabel(month);

  // Start from the payroll's own worker list.
  const rows = new Map();      // key → { name, section, maint, transpl, seedling }
  const keyFor = (name, section) => `${section}${name.toLowerCase()}`;
  const touch = (name, section) => {
    const k = keyFor(name, section);
    if (!rows.has(k)) rows.set(k, { name, section, maint: 0, transpl: 0, seedling: 0 });
    return rows.get(k);
  };

  workers.filter(w => w.active !== false && (!secFilter || (w.section || '') === secFilter))
         .forEach(w => touch(w.full_name, w.section || ''));

  // Work Maintenance — matched by name against the maintenance module's list.
  //
  // That module keeps its own per-nursery worker lists, which need not agree
  // with the section a worker is filed under here. The Worker System is the
  // register of record, so resolve the name to it and use ITS section; without
  // that the same person shows up twice, once per filing.
  const byName = new Map();
  workers.forEach(w => { if (w.full_name) byName.set(w.full_name.trim().toLowerCase(), w); });

  ['PN','BNN','UNN1','UNN2'].forEach(n => {
    const wk = maint.workers[n] || [];
    if (!wk.length) return;
    const per = maintTotals(n, monthTxt);
    const rateOf = c => (maint.rates[n] || {})[c];
    wk.forEach(w => {
      const known = byName.get(String(w).trim().toLowerCase());
      const section = known ? (known.section || '') : n;
      if (secFilter && section !== secFilter) return;
      const amt = MAINT_TYPES.reduce((s, t) => {
        const r = rateOf(t.code);
        if (r == null) return s;
        const cap = Math.round(per[w] ? per[w][t.code] : 0);
        return s + Math.round(cap * Math.round(r * 100000) / 1000) / 100;
      }, 0);
      if (amt) touch(known ? known.full_name : w, section).maint += amt;
    });
  });

  // Keyed sheets.
  entries.filter(e => e.month === month).forEach(e => {
    const w = workers.find(x => x.id === e.worker_id);
    if (!w) return;
    if (secFilter && (w.section || '') !== secFilter) return;
    const row = touch(w.full_name, w.section || '');
    if (e.category === 'transplanting') row.transpl  += Number(e.amount || 0);
    if (e.category === 'seedlings')     row.seedling += Number(e.amount || 0);
  });

  return [...rows.values()]
    .map(r => ({ ...r, total: r.maint + r.transpl + r.seedling }))
    .filter(r => r.total > 0 || !secFilter)
    .sort((a, b) => (a.section || '').localeCompare(b.section || '') || a.name.localeCompare(b.name));
}

function renderMonthly() {
  const list = monthlyRows();
  const rows = list.length ? list.map((r, i) => `
    <tr>
      <td style="color:var(--text-faint);width:44px;">${i + 1}</td>
      <td class="l" style="font-weight:700;color:var(--text-head);">${esc(r.name)}</td>
      <td>${esc(r.section || '—')}</td>
      <td>${r.maint    ? money(r.maint)    : '—'}</td>
      <td>${r.transpl  ? money(r.transpl)  : '—'}</td>
      <td>${r.seedling ? money(r.seedling) : '—'}</td>
      <td class="money">${money(r.total)}</td>
    </tr>`).join('')
    : `<tr><td colspan="7" class="empty">Nothing earned in ${esc(monthLabel(monthValue()))} yet.</td></tr>`;

  const sum = k => list.reduce((s, r) => s + r[k], 0);
  $('monthly-table').innerHTML = `
    <thead><tr>
      <th style="width:44px;">No.</th><th class="l">Worker</th><th style="width:90px;">Section</th>
      <th style="width:140px;">Work Maintenance</th><th style="width:130px;">Transplanting</th>
      <th style="width:150px;">Seedlings Collection</th><th style="width:130px;">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    ${list.length ? `<tfoot><tr><td class="l" colspan="3">GRAND TOTAL — ${esc(monthLabel(monthValue()))}</td>
      <td>${money(sum('maint'))}</td><td>${money(sum('transpl'))}</td>
      <td>${money(sum('seedling'))}</td><td>${money(sum('total'))}</td></tr></tfoot>` : ''}`;

  $('monthly-note').textContent =
    'Work Maintenance is read from the Nursery Operation module and matched to a worker by name; Transplanting and Seedlings Collection come from the sheets keyed here.';
}

/* ════════════ PDF ════════════ */
function pdfDoc() {
  const { jsPDF } = window.jspdf;
  return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
}
/* Shared cell drawer — centred both ways, shrunk to fit, never wrapping a number. */
function pdfCell(doc, x, y, w, h, text, o) {
  o = Object.assign({ bold: false, size: 9, fill: null, nowrap: false }, o || {});
  if (o.fill) { doc.setFillColor(o.fill[0], o.fill[1], o.fill[2]); doc.rect(x, y, w, h, 'F'); }
  doc.setDrawColor(80, 80, 80); doc.setLineWidth(0.2); doc.rect(x, y, w, h);
  const str = String(text ?? ''); if (!str) return;
  doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setTextColor(0, 0, 0);
  let size = o.size, lines;
  if (o.nowrap) {
    for (;;) { doc.setFontSize(size); if (doc.getTextWidth(str) <= w - 1.6 || size <= 4) break; size -= 0.25; }
    lines = [str];
  } else {
    for (;;) {
      doc.setFontSize(size); lines = doc.splitTextToSize(str, w - 3);
      if (lines.length * size * 0.3528 * 1.15 <= h - 1.5 || size <= 5) break;
      size -= 0.4;
    }
  }
  doc.setFontSize(size);
  const lh = size * 0.3528 * 1.15;
  let ty = y + (h - lines.length * lh) / 2 + lh * 0.78;
  lines.forEach(l => { doc.text(l, x + w / 2, ty, { align: 'center' }); ty += lh; });
}
function pdfTitle(doc, lines) {
  let y = 25;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('MEGA JUTAMAS SDN BHD', 105, y + 5, { align: 'center' });
  doc.setFontSize(12); doc.text(lines[0], 105, y + 12, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text(lines[1], 105, y + 19, { align: 'center' });
  doc.text(lines[2], 105, y + 25.5, { align: 'center' });
  doc.setDrawColor(79, 70, 229); doc.setLineWidth(0.6);
  doc.line(25, y + 29, 185, y + 29); doc.setLineWidth(0.2);
  return y + 34;
}
function pdfFooterNote(doc, y) {
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(110, 110, 110);
  doc.text('This salary claim form is automatically generated by the MJM Nursery AI system.', 105, y + 12, { align: 'center' });
}

function downloadMaintPDF() {
  const n = $('maint-nursery').value, month = monthValue(), monthTxt = maintMonthLabel(month);
  const wk = maint.workers[n] || [];
  if (!wk.length) { alert('No worker on the Work Maintenance list for this nursery.'); return; }
  const rateOf = c => (maint.rates[n] || {})[c];
  const per = maintTotals(n, monthTxt);
  const capOf = (w, c) => Math.round(per[w] ? per[w][c] : 0);
  const rmOf  = (w, c) => { const r = rateOf(c); return r == null ? 0 : Math.round(capOf(w, c) * Math.round(r * 100000) / 1000) / 100; };
  const earned = w => MAINT_TYPES.reduce((s, t) => s + rmOf(w, t.code), 0);

  const doc = pdfDoc();
  const COL = [7, 30, 11, 15, 11, 15, 11, 15, 11, 15, 19];
  const X = []; COL.reduce((x, w, i) => { X[i] = x; return x + w; }, 25);
  const PAIR = i => 2 + i * 2, I_TOTAL = COL.length - 1;
  const HF = [232, 236, 252], TF = [222, 228, 250];

  const drawHead = () => {
    let y = pdfTitle(doc, ['SALARY CLAIM FORM — WORK MAINTENANCE', `${NURSERY_FULL[n] || n} (${n})`, `Month ${monthTxt}`]);
    const H1 = 9, H2 = 7;
    pdfCell(doc, X[0], y, COL[0], H1 + H2, 'No.', { bold: true, size: 8, nowrap: true, fill: HF });
    pdfCell(doc, X[1], y, COL[1], H1 + H2, 'Worker Name', { bold: true, size: 8.5, fill: HF });
    MAINT_TYPES.forEach((t, i) => {
      const c = PAIR(i);
      pdfCell(doc, X[c], y, COL[c] + COL[c+1], H1, t.label, { bold: true, size: 7.5, fill: HF });
      pdfCell(doc, X[c],   y + H1, COL[c],   H2, 'Capacity', { bold: true, size: 6.5, nowrap: true, fill: HF });
      pdfCell(doc, X[c+1], y + H1, COL[c+1], H2, 'Earned',   { bold: true, size: 6.5, nowrap: true, fill: HF });
    });
    pdfCell(doc, X[I_TOTAL], y, COL[I_TOTAL], H1 + H2, 'Total Earned (RM)', { bold: true, size: 7.5, fill: HF });
    y += H1 + H2;
    const RH = 7;
    pdfCell(doc, X[0], y, COL[0] + COL[1], RH, 'Piece Rate (RM)', { bold: true, size: 7.5, fill: [246, 247, 252] });
    MAINT_TYPES.forEach((t, i) => {
      const c = PAIR(i), r = rateOf(t.code);
      pdfCell(doc, X[c], y, COL[c] + COL[c+1], RH, rateTxt(r),
              { size: 7, nowrap: true, fill: [246, 247, 252] });
    });
    pdfCell(doc, X[I_TOTAL], y, COL[I_TOTAL], RH, '', { fill: [246, 247, 252] });
    return y + RH;
  };

  let y = drawHead();
  const RH = 9;
  wk.forEach((w, i) => {
    if (y + RH > 297 - 25 - 40) { doc.addPage(); y = drawHead(); }
    const z = i % 2 ? [250, 250, 253] : null;
    pdfCell(doc, X[0], y, COL[0], RH, String(i + 1), { size: 8, nowrap: true, fill: z });
    pdfCell(doc, X[1], y, COL[1], RH, w, { size: 8.5, fill: z });
    MAINT_TYPES.forEach((t, k) => {
      const c = PAIR(k), cap = capOf(w, t.code);
      pdfCell(doc, X[c],   y, COL[c],   RH, cap ? cap.toLocaleString() : '—', { size: 8, nowrap: true, fill: z });
      pdfCell(doc, X[c+1], y, COL[c+1], RH, cap ? 'RM ' + rmOf(w, t.code).toFixed(2) : '—', { size: 7.5, nowrap: true, fill: z });
    });
    pdfCell(doc, X[I_TOTAL], y, COL[I_TOTAL], RH, 'RM ' + earned(w).toFixed(2), { bold: true, size: 8.5, nowrap: true, fill: z });
    y += RH;
  });

  pdfCell(doc, X[0], y, COL[0] + COL[1], RH + 1, 'GRAND TOTAL', { bold: true, size: 8.5, fill: TF });
  MAINT_TYPES.forEach((t, k) => {
    const c = PAIR(k);
    const cs = wk.reduce((s, w) => s + capOf(w, t.code), 0);
    const rs = wk.reduce((s, w) => s + rmOf(w, t.code), 0);
    pdfCell(doc, X[c],   y, COL[c],   RH + 1, cs ? cs.toLocaleString() : '—', { bold: true, size: 8, nowrap: true, fill: TF });
    pdfCell(doc, X[c+1], y, COL[c+1], RH + 1, 'RM ' + rs.toFixed(2), { bold: true, size: 7.5, nowrap: true, fill: TF });
  });
  pdfCell(doc, X[I_TOTAL], y, COL[I_TOTAL], RH + 1, 'RM ' + wk.reduce((s, w) => s + earned(w), 0).toFixed(2),
          { bold: true, size: 9, nowrap: true, fill: TF });
  y += RH + 1;
  pdfFooterNote(doc, y);
  doc.save(`Salary_Claim_Work_Maintenance_${n}_${monthTxt.replace(/\s+/g, '_')}.pdf`);
}

function downloadMonthlyPDF() {
  const list = monthlyRows().filter(r => r.total > 0);
  if (!list.length) { alert('Nothing earned this month yet.'); return; }
  const sec = $('monthly-section').value;
  const doc = pdfDoc();
  const COL = [8, 46, 18, 24, 22, 24, 25];       // 167 → fits 160 after trim
  const total = COL.reduce((a, b) => a + b, 0);
  const scale = 160 / total;
  const C = COL.map(w => w * scale);
  const X = []; C.reduce((x, w, i) => { X[i] = x; return x + w; }, 25);
  const HF = [232, 236, 252], TF = [222, 228, 250];

  const drawHead = () => {
    let y = pdfTitle(doc, ['MONTHLY PAYROLL', sec ? (SECTION_NAME[sec] || sec) : 'All Sections', `Month ${monthLabel(monthValue())}`]);
    const H = 13;
    ['No.', 'Worker Name', 'Section', 'Work Maintenance', 'Transplanting', 'Seedlings Collection', 'Total (RM)']
      .forEach((t, i) => pdfCell(doc, X[i], y, C[i], H, t, { bold: true, size: 7.5, fill: HF }));
    return y + H;
  };

  let y = drawHead();
  const RH = 9;
  list.forEach((r, i) => {
    if (y + RH > 297 - 25 - 40) { doc.addPage(); y = drawHead(); }
    const z = i % 2 ? [250, 250, 253] : null;
    const cells = [String(i + 1), r.name, r.section || '—',
                   r.maint ? 'RM ' + r.maint.toFixed(2) : '—',
                   r.transpl ? 'RM ' + r.transpl.toFixed(2) : '—',
                   r.seedling ? 'RM ' + r.seedling.toFixed(2) : '—',
                   'RM ' + r.total.toFixed(2)];
    cells.forEach((t, k) => pdfCell(doc, X[k], y, C[k], RH, t,
      { size: k === 1 ? 8.5 : 8, bold: k === 6, nowrap: k !== 1, fill: z }));
    y += RH;
  });

  const sum = k => list.reduce((s, r) => s + r[k], 0);
  const foot = ['', 'GRAND TOTAL', '', 'RM ' + sum('maint').toFixed(2), 'RM ' + sum('transpl').toFixed(2),
                'RM ' + sum('seedling').toFixed(2), 'RM ' + sum('total').toFixed(2)];
  foot.forEach((t, k) => pdfCell(doc, X[k], y, C[k], RH + 1, t, { bold: true, size: 8, nowrap: k !== 1, fill: TF }));
  y += RH + 1;
  pdfFooterNote(doc, y);
  doc.save(`Monthly_Payroll_${sec || 'All'}_${monthLabel(monthValue()).replace(/\s+/g, '_')}.pdf`);
}

/* ════════════ LOAD ════════════ */
let _maintGeneralCol = true;
async function loadWorkers() {
  const { data, error } = await _supabase.from('mjmnpayroll_workers').select('*').order('full_name');
  if (error) { flagSetup(error.message); return; }
  workers = data || [];
  // On an empty table there is no row to read the column names off, so ask.
  const probe = await _supabase.from('mjmnpayroll_workers').select('maint_general').limit(1);
  _maintGeneralCol = !probe.error;
  const w = $('worker-setup');
  if (w) w.classList.toggle('hidden', _maintGeneralCol);
}
async function loadRates() {
  const { data, error } = await _supabase.from('mjmnpayroll_piece_rates')
    .select('*').order('sort_order').order('job_desc');
  if (error) { flagSetup(error.message); return; }
  rates = data || [];

  /* MN / PN / Machinery live in group_code, added after the module shipped.
     Ask the database rather than guessing: on an empty table there is no row
     to read the column names off, and a save that names a column the table
     does not have fails outright. */
  const probe = await _supabase.from('mjmnpayroll_piece_rates').select('group_code').limit(1);
  _rateGroupCol = !probe.error;
  $('rate-setup').classList.toggle('hidden', _rateGroupCol);
}
async function loadEntries() {
  const { data, error } = await _supabase.from('mjmnpayroll_work_entries')
    .select('*').eq('month', monthValue()).order('work_date');
  if (error) { flagSetup(error.message); return; }
  entries = data || [];
}
function flagSetup(msg) {
  _tablesOk = false;
  $('setup').classList.remove('hidden');
  $('setup-err').textContent = msg || '';
}

/* Work Maintenance lives in the Nursery Operation module; read it as-is. */
async function loadMaint() {
  const [recRes, tickRes, rateRes, wkRes] = await Promise.all([
    _supabase.from('nops_maint_records').select('records').eq('id', 1).maybeSingle().then(r => r, () => ({ data: null })),
    _supabase.from('nops_maint_payroll').select('nursery, month, work_type, data').then(r => r, () => ({ data: [] })),
    _supabase.from('nops_maint_piece_rates').select('nursery, work_type, rate').then(r => r, () => ({ data: [] })),
    _supabase.from('nops_maint_workers').select('nursery, name').then(r => r, () => ({ data: [] }))
  ]);

  // The maintenance module's own old list — only the fallback now.
  maint.localWorkers = {};
  ((wkRes && wkRes.data) || []).forEach(r => {
    (maint.localWorkers[r.nursery] ||= []).push(r.name);
  });
  maint.rates = {};
  ((rateRes && rateRes.data) || []).forEach(r => {
    const targets = r.nursery ? [r.nursery] : ['PN','BNN','UNN1','UNN2'];
    targets.forEach(n => { (maint.rates[n] ||= {})[r.work_type] = r.rate; });
  });
  maint.ticks = {};
  ((tickRes && tickRes.data) || []).forEach(r => {
    maint.ticks[`${r.nursery}_${r.month}_${r.work_type}`] = r.data || {};
  });

  // A record's plot tells us its nursery — the maintenance module keeps one
  // global list, so tag each row before use.
  const NPLOTS = {
    PN:   Array.from({ length: 52 }, (_, i) => 'P' + String(i + 1).padStart(2, '0')),
    BNN:  Array.from({ length: 14 }, (_, i) => 'B' + (i + 1)),
    UNN1: Array.from({ length: 40 }, (_, i) => 'U' + (i + 1)),
    UNN2: Array.from({ length: 40 }, (_, i) => 'V' + (i + 1))
  };
  const plotNursery = {};
  Object.entries(NPLOTS).forEach(([n, ps]) => ps.forEach(p => { plotNursery[p] = n; }));

  const recs = (recRes && recRes.data && Array.isArray(recRes.data.records)) ? recRes.data.records : [];
  maint.records = recs.map(r => ({ ...r, __nursery: plotNursery[r.plot] || null }));
}

/* ════════════ BOOT ════════════ */
$('global-month').addEventListener('change', async () => {
  try { localStorage.setItem('npayroll_month', monthValue()); } catch (_) {}
  await loadEntries();
  refreshPayrollTab();
});

['worker-modal','rate-modal','entry-modal'].forEach(id => {
  $(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(id); });
});

(async () => {
  try {
    await MJMAccess.load(_supabase);
    if (!MJMAccess.user()) { window.location.href = '../index.html'; return; }
    if (!MJMAccess.canAccess('npayroll')) {
      alert('You do not have access to the Nursery Payroll System.');
      window.location.href = '../index.html';
      return;
    }
    const u = MJMAccess.user();
    userEmail = u.email || '';
    isAdmin   = MJMAccess.isAdminOf('npayroll');
    $('who').textContent = u.full_name || u.email || '';

    let savedMonth = null;
    try { savedMonth = localStorage.getItem('npayroll_month'); } catch (_) {}
    $('global-month').value = savedMonth || todayMonth();

    fillSectionSelect($('transpl-section'),  true, '');
    fillSectionSelect($('seedling-section'), true, '');
    fillSectionSelect($('monthly-section'),  true, '');

    await Promise.all([loadWorkers(), loadRates(), loadEntries(), loadMaint()]);
    resolveMaintWorkers();

    let tab = 'payroll', sub = 'maint';
    try { tab = localStorage.getItem('npayroll_tab') || tab; sub = localStorage.getItem('npayroll_sub') || sub; } catch (_) {}
    if ($('sub-' + sub)) switchSub(sub);
    if ($('tab-' + tab)) switchTab(tab);

    renderWorkers(); renderRates();
    $('loading').classList.add('hidden');
    $('main').classList.remove('hidden');
  } catch (e) {
    if (e && e.message === 'NO_OPS_ACCESS') return;
    console.warn(e);
    window.location.href = '../index.html';
  }
})();
