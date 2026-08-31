/* ══════════════════════════════════════════════════════════════════
   555 AUDITOR PORTAL — WHICH PLOTS STILL OWE WORK
   ══════════════════════════════════════════════════════════════════
   The auditor portal's to-do list used to name a module and a date and
   stop there: "Plot Condition Audit — due, 10 Aug". Which plots that
   actually meant was only discoverable by opening the module and
   reading its grid. This answers the question on the portal itself, as
   a row of plot circles under each to-do row.

   One question, one file. The four module scripts each work this out
   for their own grid, and this deliberately does NOT reach into them —
   they run on their own pages, not here. It reads the same tables and
   applies the same rules instead, which means the rules exist twice
   and have to be kept in step. Where they could drift is written down
   at each rule below.

   THE ONE RULE THAT IS DELIBERATELY DIFFERENT
   A module grid asks "has this batch ever been audited". This asks
   "has it been audited inside the window the to-do row is about".
   They have to differ: the row above the circles says a window is due
   or overdue, and circles answering "ever" would leave a row sitting
   at due with nothing under it every month after the first. The
   schedule repeats; the work repeats with it. When the routine becomes
   configurable (monthly, fortnightly, per module) it is the window
   passed to plots() that changes, and nothing here has to.

   USAGE
     await MJMAuditPending.load(['BNN','UNN1','UNN2']);
     MJMAuditPending.plots('plot', 'BNN', '2026-08-10', '2026-08-10');
       → ['B01','B04','B11']          plots with work left in that window

   Maintenance is not here. It is task-driven rather than batch-driven,
   and audit_home.html already walks those tasks to build its timeline —
   it collects the plots on the same pass. See loadMaintTimeline().
   ══════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  /* Same four lists the module scripts carry. Copied rather than
     imported because each module script declares NURSERY_PLOTS as a
     top-level const and loading two of them together would collide. */
  const NURSERY_PLOTS = {
    PN:   Array.from({length:52}, (_,i)=>'P'+String(i+1).padStart(2,'0')),
    BNN:  Array.from({length:14}, (_,i)=>'B'+String(i+1).padStart(2,'0')),
    UNN1: Array.from({length:18}, (_,i)=>'U'+String(i+1).padStart(2,'0')),
    UNN2: Array.from({length:20}, (_,i)=>'N'+String(i+1).padStart(2,'0'))
  };

  /* Plot codes are padded here ('B01') but the operation ledger and the
     saved audits both write them however they were typed ('B1'), so
     everything is canonicalised on the way in. Same regex the module
     scripts use. */
  function canonPlot(raw){
    const s = String(raw || '').trim().toUpperCase();
    const m = s.match(/^([A-Z]+)(\d+)(-R)?$/);
    return m ? m[1] + m[2].padStart(2,'0') + (m[3] || '') : s;
  }

  const PLOT_TO_NURSERY = (function(){
    const m = {};
    Object.keys(NURSERY_PLOTS).forEach(n => NURSERY_PLOTS[n].forEach(p => {
      m[p] = n;
      const stripped = p.replace(/^([A-Z]+)0+(\d)/, '$1$2');
      if (stripped !== p) m[stripped] = n;
    }));
    return m;
  })();

  const trim = v => String(v == null ? '' : v).trim();
  const key3 = (n, p, b) => n + '|' + p + '|' + b;

  /* ── STATE ─────────────────────────────────────────────────────── */
  let roster   = [];    // [{nursery, plot, batch}] — batches standing on plots
  let balance  = {};    // 'PLOT|BATCH' → qty
  let audited  = {};    // mod → Map('nursery|plot|batch' → [ISO date, …])
  let papanBat = [];    // [{nursery, plot, batch, date}] — papan's own roster
  let scope    = [];
  let loaded   = false;

  /* ── NOT REQUIRED ───────────────────────────────────────────────
     The operation ledger says nothing is standing in this (plot,
     batch) right now: balance ≤ 0, or no row at all since the view
     drops zero-balance rows. Such a batch never becomes work.

     Fails OPEN, exactly as isBatchNotRequired() does in
     audit_script.js: with no balance data at all — the view
     unreadable, a Supabase blip — every batch counts as required, so
     the portal shows too much rather than quietly retiring plots that
     still need walking. */
  function notRequired(plot, batch){
    if (!Object.keys(balance).length) return false;
    const qty = balance[plot + '|' + batch];
    return qty === undefined || qty <= 0;
  }

  /* Was this batch audited between two ISO dates, inclusive? */
  function auditedIn(mod, nursery, plot, batch, fromISO, toISO){
    const hits = audited[mod] && audited[mod].get(key3(nursery, plot, batch));
    if (!hits) return false;
    for (let i = 0; i < hits.length; i++)
      if (hits[i] >= fromISO && hits[i] <= toISO) return true;
    return false;
  }

  /* ── OFFLINE CACHE ──
     Six live reads feed this, and none of them had anywhere to fall
     back to with no signal — every one turned into [] via soft()
     below, roster and papanBat both ended up empty, covers() said no
     for every module, and the portal's plot chips vanished with the
     pending count falling back to counting ROWS instead of plots (a
     nursery with 114 plots owed read as "3 pending" — three ROWS,
     Seedling Height / Plot Condition / Papan, not three plots).

     The fix is the one smartSave() already uses for writes: keep the
     last good answer somewhere durable, and hand it back when there
     is nothing better to offer. Cached is the PROCESSED state
     (roster, balance, audited, papanBat), not the raw rows — restoring
     it offline needs no re-derivation, just what plots() already
     reads from these same variables when the load was live. */
  const _CACHE_KEY = 'mjm_pending_cache_v1';
  function _saveCache(){
    try {
      localStorage.setItem(_CACHE_KEY, JSON.stringify({
        scope, roster, balance,
        audited: {
          plot:   [...audited.plot.entries()],
          height: [...audited.height.entries()],
          papan:  [...audited.papan.entries()]
        },
        papanBat,
        savedAt: Date.now()
      }));
    } catch (e) { /* storage full/unavailable — no offline fallback next time, not fatal now */ }
  }
  function _loadCache(){
    try {
      const raw = localStorage.getItem(_CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      scope    = c.scope   || [];
      roster   = c.roster  || [];
      balance  = c.balance || {};
      audited  = {
        plot:   new Map((c.audited && c.audited.plot)   || []),
        height: new Map((c.audited && c.audited.height) || []),
        papan:  new Map((c.audited && c.audited.papan)  || [])
      };
      papanBat = c.papanBat || [];
      return c.savedAt || 0;
    } catch (e) { return null; }
  }

  /* ── LOAD ───────────────────────────────────────────────────────
     Every table this needs, in one pass, on page load. Each read
     fails soft on its own: a module whose audits could not be read
     shows every plot as pending rather than none, which is the safe
     direction to be wrong in — an auditor re-walking a done plot
     loses an hour, a plot silently dropped loses a month. */
  async function load(nurseries){
    scope = (nurseries || []).slice();

    /* Offline: six requests would just be six round trips to the
       service worker's synthetic 503 — send none of them, and use
       whatever this device last saw while it still had a signal. A
       device that has never loaded successfully has nothing cached;
       that case falls through to the live attempt below, which fails
       soft per table exactly as it always did. */
    if (!navigator.onLine) {
      const savedAt = _loadCache();
      if (savedAt) {
        loaded = true;
        console.log('[audit-pending] offline — served from cache saved',
          new Date(savedAt).toLocaleString());
        return;
      }
    }

    const soft = (label) => (e) => {
      console.warn('[audit-pending] ' + label + ' load failed:', e);
      return [];
    };

    const [logRows, batchRows, balRows, plotAud, heightAud, papanAud] =
      await Promise.all([
        /* The four life-stage events that put a batch onto a plot.
           Planted covers pre nursery, the Transplanted* trio covers
           main — loading only the transplants leaves PN permanently
           empty, which is the bug audit_script.js carries a comment
           about. */
        sb.select('shared_inventory_logs',
              'select=plot_name,batch_name,transaction_type,transaction_date,created_at'
            + '&transaction_type=in.(Planted,Transplanted,Transplanted_Premium,Transplanted_DoubleTone)')
          .catch(soft('shared_inventory_logs')),
        sb.select('audit_batches',
              'select=nursery,plot,batch_no,date_planted,date_transplant')
          .catch(soft('audit_batches')),
        sb.select('shared_plot_batch_balance', 'select=plot_name,batch_name,qty')
          .catch(soft('shared_plot_batch_balance')),
        sb.select('audit_plot_audits',    'select=nursery,plot,batch,date')
          .catch(soft('audit_plot_audits')),
        sb.select('audit_height_records', 'select=nursery,plot,batch,date')
          .catch(soft('audit_height_records')),
        sb.select('audit_papan_audits',   'select=nursery,plot,batch_no,date')
          .catch(soft('audit_papan_audits'))
      ]);

    /* ── Roster: which batches are standing on which plots ──
       Both sources, deduped, exactly as the plot and height grids
       build it. audit_batches carries a nursery column, but the
       nursery is re-derived from the plot code either way so a stale
       label cannot file a plot under the wrong nursery. */
    const seen = new Set();
    roster = [];
    const add = (plotRaw, batchRaw) => {
      const plot  = canonPlot(plotRaw);
      const batch = trim(batchRaw);
      const nursery = plot ? PLOT_TO_NURSERY[plot] : null;
      if (!nursery || !plot || !batch) return;
      const k = key3(nursery, plot, batch);
      if (seen.has(k)) return;
      seen.add(k);
      roster.push({ nursery, plot, batch });
    };
    (logRows   || []).forEach(l => add(l.plot_name, l.batch_name));
    (batchRows || []).forEach(r => add(r.plot,      r.batch_no));

    /* ── Balance ── */
    balance = {};
    (balRows || []).forEach(r => {
      const plot = canonPlot(r.plot_name), batch = trim(r.batch_name);
      if (plot && batch) balance[plot + '|' + batch] = Number(r.qty || 0);
    });

    /* ── Audits, indexed by batch and carrying every date they hold ──
       Several audits of one batch across months is normal, and each
       window asks about its own dates, so the dates are kept as a list
       rather than collapsed to the latest. */
    function index(rows, batchCol){
      const m = new Map();
      (rows || []).forEach(r => {
        const plot = canonPlot(r.plot), batch = trim(r[batchCol]);
        const nursery = plot ? PLOT_TO_NURSERY[plot] : null;
        const date = trim(r.date).slice(0, 10);
        if (!nursery || !plot || !batch || !date) return;
        const k = key3(nursery, plot, batch);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(date);
      });
      return m;
    }
    audited = {
      plot:   index(plotAud,   'batch'),
      height: index(heightAud, 'batch'),
      papan:  index(papanAud,  'batch_no')
    };

    /* ── Papan's roster is a different shape ──
       Papan audits the sign on the batch that was most recently placed
       on a plot, so it needs the placement DATE that the plot and
       height grids can ignore. Manual rows win over ledger rows for
       the same batch, the same precedence audit_papan_script.js
       applies. */
    const papanSeen = new Set();
    papanBat = [];
    const addPapan = (plotRaw, batchRaw, date) => {
      const plot  = canonPlot(plotRaw);
      const batch = trim(batchRaw);
      const nursery = plot ? PLOT_TO_NURSERY[plot] : null;
      if (!nursery || !plot || !batch) return;
      const k = key3(nursery, plot, batch);
      if (papanSeen.has(k)) return;
      papanSeen.add(k);
      papanBat.push({ nursery, plot, batch, date: trim(date).slice(0, 10) });
    };
    (batchRows || []).forEach(r =>
      addPapan(r.plot, r.batch_no, r.date_transplant || r.date_planted || ''));
    (logRows || []).forEach(l =>
      addPapan(l.plot_name, l.batch_name,
               l.transaction_date || (l.created_at || '').split('T')[0]));

    loaded = true;
    /* Only worth keeping when at least the roster came back — an
       empty roster from a genuinely empty nursery and an empty
       roster from a failed read look identical here, and caching the
       second would serve a blank state offline just as confidently
       as a real one. roster.length also being legitimately 0 (a
       nursery truly carrying nothing right now) is the one case this
       gets conservative about — it simply won't refresh the cache
       that round, and the previous real snapshot keeps serving until
       a load that actually sees rows replaces it. */
    if (roster.length) _saveCache();
    console.log('[audit-pending] loaded', {
      scope, roster: roster.length, balanceRows: Object.keys(balance).length,
      papanBatches: papanBat.length,
      audits: { plot: audited.plot.size, height: audited.height.size,
                papan: audited.papan.size }
    });
  }

  /* First of the current calendar month — papan audits track new
     signage that went up this month, matching the module page's
     transaction_date >= monthStart filter. Without this, the roster
     carried every Planted/Transplanted event ever recorded and the
     home to-do chips listed every plot in the nursery, not just the
     ones with fresh signage due. */
  function _startOfThisMonthISO(){
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
  }

  /* Latest batch per plot, for one nursery — papan's unit of work.
     Restricted to batches placed on the plot inside the current
     month (see comment on _startOfThisMonthISO above). A batch with
     no date is dropped rather than counted; if the office hasn't
     dated it we can't say whether it belongs in this month's
     window. */
  function latestPapanPerPlot(nursery){
    const monthStart = _startOfThisMonthISO();
    const best = {};
    papanBat.forEach(b => {
      if (b.nursery !== nursery) return;
      if (!b.date || b.date < monthStart) return;
      const cur = best[b.plot];
      if (!cur || b.date >= (cur.date || '')) best[b.plot] = b;
    });
    return Object.values(best);
  }

  /* ── THE ANSWER ─────────────────────────────────────────────────
     Plots in this nursery carrying work. With `ignoreAudits`, every
     plot that has any required work at all — the size of the job; the
     figure the progress bar divides by. Without it, only what is still
     owed inside [fromISO, toISO].

     Returned in the nursery's own plot order rather than the order the
     tables happened to arrive in, so the circles read P03 · P07 · P12
     and an auditor can find one by eye. */
  function _plots(mod, nursery, fromISO, toISO, ignoreAudits){
    if (!loaded) return [];
    const owed = new Set();

    if (mod === 'plot' || mod === 'height') {
      roster.forEach(b => {
        if (b.nursery !== nursery) return;
        if (notRequired(b.plot, b.batch)) return;
        if (!ignoreAudits &&
            auditedIn(mod, nursery, b.plot, b.batch, fromISO, toISO)) return;
        owed.add(b.plot);
      });
    } else if (mod === 'papan') {
      latestPapanPerPlot(nursery).forEach(b => {
        if (!ignoreAudits &&
            auditedIn('papan', nursery, b.plot, b.batch, fromISO, toISO)) return;
        owed.add(b.plot);
      });
    } else {
      return [];        /* maintenance is audit_home.html's own to answer */
    }

    const order = NURSERY_PLOTS[nursery] || [];
    const ranked = order.filter(p => owed.has(p));
    /* Anything the ledger knows about that is not in the nursery's
       configured plot list still gets shown, after the known ones,
       rather than vanishing. */
    const extra = [...owed].filter(p => order.indexOf(p) === -1).sort();
    return ranked.concat(extra);
  }

  /* Plots still owed inside the window. */
  function plots(mod, nursery, fromISO, toISO){
    return _plots(mod, nursery, fromISO, toISO, false);
  }

  /* Every plot with work, audited or not — one task per plot, which is
     how the portal counts a day's workload. */
  function plotsAll(mod, nursery){
    return _plots(mod, nursery, '', '', true);
  }

  /* Is there any basis to judge this module and nursery at all?

     plots() returning nothing is two very different answers wearing
     the same clothes: "every plot is audited" and "the roster could
     not be read, so no plot is known". The first should close a to-do
     row; the second must not, or an RLS refusal on the batch tables
     silently empties an auditor's month. Callers ask this first and
     fall back to their own date-based rule when it says no. */
  function covers(mod, nursery){
    if (!loaded) return false;
    if (mod === 'plot' || mod === 'height')
      return roster.some(b => b.nursery === nursery);
    if (mod === 'papan')
      return papanBat.some(b => b.nursery === nursery);
    return false;
  }

  global.MJMAuditPending = {
    load: load,
    plots: plots,
    plotsAll: plotsAll,
    covers: covers,
    ready: () => loaded,
    plotList: (n) => (NURSERY_PLOTS[n] || []).slice()
  };

})(window);
