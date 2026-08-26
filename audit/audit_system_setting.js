/* ══════════════════════════════════════════════════════════════════════
   NURSERY AUDIT — SYSTEM SETTING

   The second half of Settings (audit_user_access.html). User Access says
   who may do what; this says what the module asks for in the first place:

     • Rounds and schedule — how many times each audit runs in a month and
       on which days, per nursery scope. Add or remove rounds freely; a
       round is only a first and a last day.

     • Maintenance — not on a calendar. Its audits follow the work, so
       each work type carries the number of days an auditor has after the
       work was done. 0 means that work type raises no audit.

     • Batch ages — which ages, in whole months, are being audited. Tick
       the ages and the grids offer only the batches that match.

   Everything is stored in one JSON row (audit_settings) and read back by
   audit_settings.js, whose defaults are the behaviour that was hardcoded
   before this screen existed — so a database that has never been here
   behaves exactly as it always did.
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  const SCOPE_LABEL = { MN: 'Main Nursery', PN: 'Pre Nursery' };
  const MOD_LABEL   = { plot: 'Plot Condition Audit', height: 'Seedling Height Audit', papan: 'Papan Tanda Audit' };
  const WT_LABEL    = {
    manuring: 'Manuring',
    weeding:  'Weeding',
    interrow: 'Interrow Spray',
    pd:       'P & D Spraying',
    other:    'Anything else'
  };
  const WT_NOTE = {
    pd: 'Left at 0 by default — pest and disease spraying is looked at in the plot condition audit.'
  };
  const MAX_AGE = 24;                       // 0…24 months of tick boxes

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* Working copy. Edited by the controls, written on Save. */
  let draft = null;
  let root  = null;
  let supa  = null;

  const html = `
<div id="ss-offline" class="hidden rounded-xl border border-rose-200 bg-rose-50 p-4">
  <div class="text-[12px] font-black text-rose-800 uppercase tracking-widest">The portal is not reading these settings</div>
  <p class="text-[12px] text-rose-800 mt-1.5 leading-relaxed">
    What is on this screen saves, but the auditor portal cannot read it back, so auditors
    still see the built-in schedule. Run <code class="font-bold">shared/create_audit_settings.sql</code>
    in the Supabase SQL Editor and reload this page.
  </p>
  <p id="ss-offline-why" class="text-[11px] text-rose-700 mt-2 font-mono break-all"></p>
</div>

<div class="card p-6 space-y-5">
  <div class="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h2 class="text-sm font-black text-slate-800 uppercase tracking-widest">Rounds &amp; Schedule</h2>
      <p class="text-[12px] text-slate-500 mt-1 leading-relaxed">
        How many times each audit runs in a month, and the days it is open.
        A round is a first and a last day — add as many as the work needs.
      </p>
    </div>
    <span id="ss-sched-note" class="text-[11px] font-bold text-slate-400"></span>
  </div>
  <div id="ss-schedule" class="space-y-5"></div>
</div>

<div class="card p-6 space-y-5">
  <div>
    <h2 class="text-sm font-black text-slate-800 uppercase tracking-widest">Maintenance Audit Window</h2>
    <p class="text-[12px] text-slate-500 mt-1 leading-relaxed">
      Maintenance is not on a calendar — its audits follow the work. For each type,
      how many days does an auditor have after the work was done?
      <strong>0 means that work raises no audit.</strong>
    </p>
  </div>
  <div id="ss-maint" class="grid grid-cols-1 sm:grid-cols-2 gap-3"></div>
</div>

<div class="card p-6 space-y-5">
  <div class="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h2 class="text-sm font-black text-slate-800 uppercase tracking-widest">Batch Age to Audit</h2>
      <p class="text-[12px] text-slate-500 mt-1 leading-relaxed">
        Tick the ages, in whole months, that are being audited. A batch's age is
        counted from the day it was planted — the same age the office's movement
        report prints. With nothing ticked no batch is offered, which is a way of
        pausing the audits rather than a mistake.
      </p>
    </div>
    <label class="flex items-center gap-2 text-[11px] font-black text-slate-600 uppercase tracking-widest whitespace-nowrap">
      <input type="checkbox" id="ss-age-all" class="w-4 h-4 accent-orange-500">
      All ages
    </label>
  </div>
  <div id="ss-ages" class="flex flex-wrap gap-2"></div>
</div>

<div class="flex flex-wrap items-center gap-3">
  <button id="ss-save" class="bg-orange-600 hover:bg-orange-700 text-white font-black text-[10px] uppercase tracking-widest px-6 py-3 rounded-xl">
    Save settings
  </button>
  <button id="ss-reset" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[10px] uppercase tracking-widest px-5 py-3 rounded-xl border border-slate-200">
    Back to defaults
  </button>
  <span id="ss-status" class="text-[11px] font-bold text-slate-500"></span>
</div>

<div class="card p-6 space-y-4">
  <div>
    <h2 class="text-sm font-black text-slate-800 uppercase tracking-widest">App &amp; Offline Copy</h2>
    <p class="text-[12px] text-slate-500 mt-1 leading-relaxed">
      This device keeps its own copy of the audit portal so it opens without a signal.
      If a screen looks out of date, update the copy here.
    </p>
  </div>
  <div class="rounded-xl border border-slate-200 bg-slate-50 divide-y divide-slate-200">
    <div class="flex items-center justify-between gap-4 px-4 py-3">
      <span class="text-[11px] font-black text-slate-500 uppercase tracking-widest">Copy on this device</span>
      <span id="sys-ver" class="text-[12px] font-bold text-slate-800 text-right break-all">Checking…</span>
    </div>
    <div class="flex items-center justify-between gap-4 px-4 py-3">
      <span class="text-[11px] font-black text-slate-500 uppercase tracking-widest">Offline pages held</span>
      <span id="sys-cached" class="text-[12px] font-bold text-slate-800">—</span>
    </div>
    <div class="flex items-center justify-between gap-4 px-4 py-3">
      <span class="text-[11px] font-black text-slate-500 uppercase tracking-widest">Connection</span>
      <span id="sys-online" class="text-[12px] font-bold text-slate-800">—</span>
    </div>
  </div>
  <div class="flex flex-wrap gap-3">
    <button id="sys-update" class="bg-slate-800 hover:bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest px-5 py-3 rounded-xl">
      Update the app now
    </button>
    <a href="audit_diagnostics.html" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[10px] uppercase tracking-widest px-5 py-3 rounded-xl border border-slate-200 no-underline">
      Open diagnostics
    </a>
  </div>
  <p class="text-[11px] text-slate-500 leading-relaxed">
    Updating clears the saved pages and reloads. Anything already recorded is safe —
    audits live in the database, and anything still waiting to sync stays queued on this device.
  </p>
</div>`;

  const $ = (id) => root.querySelector('#' + id);

  /* ── Rounds ─────────────────────────────────────────────────────── */
  function scheduleHtml() {
    return MJMAuditSettings.SCOPES.map(scope => `
      <div>
        <div class="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">${esc(SCOPE_LABEL[scope])}</div>
        <div class="rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden">
          ${MJMAuditSettings.MODULES.map(mod => `
            <div class="p-4 bg-white">
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <span class="font-black text-slate-800 text-[13px]">${esc(MOD_LABEL[mod])}</span>
                <button class="ss-add text-[10px] font-black uppercase tracking-widest text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-3 py-1.5"
                        data-scope="${scope}" data-mod="${mod}">+ Add round</button>
              </div>
              <div class="mt-3 space-y-2" id="ss-rounds-${scope}-${mod}"></div>
            </div>`).join('')}
        </div>
      </div>`).join('');
  }

  function drawRounds() {
    MJMAuditSettings.SCOPES.forEach(scope => {
      MJMAuditSettings.MODULES.forEach(mod => {
        const box = $(`ss-rounds-${scope}-${mod}`);
        if (!box) return;
        const list = draft.schedule[scope][mod];
        box.innerHTML = list.length ? list.map((w, i) => `
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest w-16 shrink-0">Round ${i + 1}</span>
            <span class="text-[11px] font-bold text-slate-500">Day</span>
            <input type="number" min="1" max="31" value="${w[0]}" data-r="start" data-scope="${scope}" data-mod="${mod}" data-i="${i}"
                   class="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold text-center outline-none focus:border-orange-500">
            <span class="text-[11px] font-bold text-slate-500">to</span>
            <input type="number" min="1" max="31" value="${w[1]}" data-r="end" data-scope="${scope}" data-mod="${mod}" data-i="${i}"
                   class="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold text-center outline-none focus:border-orange-500">
            <button class="ss-del text-[10px] font-black uppercase tracking-widest text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-3 py-1.5"
                    data-scope="${scope}" data-mod="${mod}" data-i="${i}">Remove</button>
          </div>`).join('')
          : `<p class="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
               No round — this audit is not asked for in ${esc(SCOPE_LABEL[scope])}.
             </p>`;
      });
    });
    const n = MJMAuditSettings.SCOPES.reduce((s, sc) =>
      s + MJMAuditSettings.MODULES.reduce((k, m) => k + draft.schedule[sc][m].length, 0), 0);
    const note = $('ss-sched-note');
    if (note) note.textContent = n + ' round' + (n === 1 ? '' : 's') + ' in all';
  }

  /* ── Maintenance ────────────────────────────────────────────────── */
  function drawMaint() {
    $('ss-maint').innerHTML = MJMAuditSettings.WORKTYPES.map(wt => `
      <label class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span class="min-w-0">
          <span class="block font-black text-slate-800 text-[13px]">${esc(WT_LABEL[wt])}</span>
          ${WT_NOTE[wt] ? `<span class="block text-[11px] text-slate-500 mt-0.5 leading-snug">${esc(WT_NOTE[wt])}</span>` : ''}
        </span>
        <span class="flex items-center gap-2 shrink-0">
          <input type="number" min="0" max="365" value="${draft.maintenance[wt]}" data-wt="${wt}"
                 class="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold text-center outline-none focus:border-orange-500">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">days</span>
        </span>
      </label>`).join('');
  }

  /* ── Ages ───────────────────────────────────────────────────────── */
  function drawAges() {
    const all = draft.ages === null;
    $('ss-age-all').checked = all;
    const picked = new Set(draft.ages || []);
    $('ss-ages').innerHTML = Array.from({ length: MAX_AGE + 1 }, (_, m) => `
      <label class="ss-age inline-flex items-center gap-2 rounded-full border px-3 py-2 cursor-pointer ${
        all ? 'opacity-40 pointer-events-none border-slate-200 bg-white'
            : (picked.has(m) ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white')}">
        <input type="checkbox" data-age="${m}" ${picked.has(m) ? 'checked' : ''} ${all ? 'disabled' : ''}
               class="w-4 h-4 accent-orange-500">
        <span class="text-[11px] font-black text-slate-700 whitespace-nowrap">${m} month${m === 1 ? '' : 's'}</span>
      </label>`).join('');
  }

  function draw() { drawRounds(); drawMaint(); drawAges(); }

  function status(msg, kind) {
    const el = $('ss-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'text-[11px] font-bold ' +
      (kind === 'err' ? 'text-rose-700' : kind === 'ok' ? 'text-emerald-700' : 'text-slate-500');
  }

  /* ── App & offline copy ─────────────────────────────────────────── */
  function mountApp() {
    const online = () => { const el = $('sys-online'); if (el) el.textContent = navigator.onLine ? 'Online' : 'Offline'; };
    online();
    window.addEventListener('online', online);
    window.addEventListener('offline', online);

    /* The version is the cache's own name — audit_sw.js opens one cache per
       build. Reading it back is how the device says which build it is
       actually serving, rather than which one the server has. */
    (async function () {
      const ver = $('sys-ver'), cached = $('sys-cached');
      try {
        if (!window.caches || !caches.keys) throw new Error('no cache API');
        const keys = (await caches.keys()).filter(k => k.indexOf('mjm-') === 0);
        if (ver) ver.textContent = keys.length ? keys.join(', ') : 'Not saved offline yet';
        if (cached) {
          if (!keys.length) { cached.textContent = '0 files'; return; }
          const all = await (await caches.open(keys[0])).keys();
          cached.textContent = all.length + ' file' + (all.length === 1 ? '' : 's');
        }
      } catch (_) {
        if (ver) ver.textContent = 'Not available on this browser';
        if (cached) cached.textContent = '—';
      }
    })();

    const btn = $('sys-update');
    if (btn) btn.addEventListener('click', async () => {
      if (!confirm('Update this device to the latest version?\n\nThe saved offline pages are cleared and the page reloads. Recorded audits are not affected.')) return;
      btn.disabled = true; btn.textContent = 'Updating…';
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch (_) { /* the caches matter more */ }
      try {
        if (window.caches && caches.keys) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
      } catch (_) {}
      location.replace(location.pathname + '?updated=' + Date.now());
    });
  }

  /* ── Mount ──────────────────────────────────────────────────────── */
  async function mount(el) {
    root = el;
    $('ss-schedule').innerHTML = scheduleHtml();
    mountApp();

    supa = supabase.createClient(SHARED_SUPA_URL, SHARED_SUPA_KEY);
    await MJMAuditSettings.load(supa);

    /* This screen reads through supabase-js; the portal reads through
       audit_supabase.js, which orders every request by created_at. A table
       missing that column answers this screen and refuses the portal — the
       two then disagree with nothing on screen to say so. Ask the portal's
       own question here, and say plainly when it comes back empty. */
    try {
      const probe = await supa.from('audit_settings')
        .select('data').eq('id', 1).order('created_at', { ascending: false });
      if (probe.error) throw probe.error;
    } catch (e) {
      const box = $('ss-offline'), why = $('ss-offline-why');
      if (box) box.classList.remove('hidden');
      if (why) why.textContent = e.message || String(e);
      console.warn('[system-setting] the portal cannot read this table:', e);
    }
    draft = MJMAuditSettings.normalise(MJMAuditSettings.current());
    draw();

    root.addEventListener('click', (e) => {
      const add = e.target.closest('.ss-add');
      if (add) {
        const list = draft.schedule[add.dataset.scope][add.dataset.mod];
        // A new round starts as the whole month; narrowing it is one edit,
        // guessing a range nobody asked for is a wrong answer.
        list.push([1, 31]);
        drawRounds();
        return;
      }
      const del = e.target.closest('.ss-del');
      if (del) {
        draft.schedule[del.dataset.scope][del.dataset.mod].splice(+del.dataset.i, 1);
        drawRounds();
      }
    });

    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.r) {
        const w = draft.schedule[t.dataset.scope][t.dataset.mod][+t.dataset.i];
        const v = Math.min(31, Math.max(1, parseInt(t.value, 10) || 1));
        w[t.dataset.r === 'start' ? 0 : 1] = v;
        // Keeping them in order here means the auditor never sees a round
        // reading "day 20 to day 5" and wondering which the system believes.
        if (w[0] > w[1]) w.reverse();
        drawRounds();
        return;
      }
      if (t.dataset.wt) {
        draft.maintenance[t.dataset.wt] = Math.min(365, Math.max(0, parseInt(t.value, 10) || 0));
        return;
      }
      if (t.id === 'ss-age-all') {
        draft.ages = t.checked ? null : (draft.ages || []);
        drawAges();
        return;
      }
      if (t.dataset.age != null) {
        const m = +t.dataset.age;
        const set = new Set(draft.ages || []);
        if (t.checked) set.add(m); else set.delete(m);
        draft.ages = Array.from(set).sort((a, b) => a - b);
        drawAges();
      }
    });

    $('ss-reset').addEventListener('click', () => {
      if (!confirm('Put every setting back to the defaults?\n\nNothing is saved until you press Save settings.')) return;
      draft = MJMAuditSettings.defaults();
      draw();
      status('Defaults loaded — not saved yet.');
    });

    $('ss-save').addEventListener('click', async () => {
      const btn = $('ss-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      status('');
      try {
        const me = (typeof MJMAccess !== 'undefined' && MJMAccess.user()) || null;
        await MJMAuditSettings.save(supa, draft, me && me.email);
        status('Saved. Auditors pick this up on their next refresh.', 'ok');
      } catch (err) {
        console.error(err);
        status('Could not save: ' + (err.message || err), 'err');
      }
      btn.disabled = false; btn.textContent = 'Save settings';
    });
  }

  global.AuditSystemSetting = { html, mount };
})(window);
