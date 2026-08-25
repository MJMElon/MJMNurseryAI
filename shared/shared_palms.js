/* ================================================================
   PALMS — Plot Activity Log Monitoring System, for the office
   shared/shared_palms.js

   PALMS is recorded in the field, in the FC Portal. The plot log now
   reaches the server (fcportal_palms_plot_logs — see
   create_palms_tables.sql), which is what lets the office read it at
   all: the monitoring board and the motion study live here, in Nursery
   Operation Management, rather than on a Field Conductor's phone.

   This file is the reading of that log. The Field Conductor's app is
   where the same rules were written first — cyclesOf, daysForActivity
   and the span measurements are ported from its motion.js, and the
   activity list and status rules from its data.js. Those are the
   source; if a rule changes there it has to change here, and the
   comments below say WHY each one is the way it is so the two do not
   quietly drift into different answers.

   Nothing here writes. The office reads the field's record; it does not
   correct it.
   ================================================================ */
(function (global) {

  /* Activity names are nursery vocabulary and are not translated.
     `days` is the ideal duration of the stage — what the motion study
     measures the real one against. Keep in step with ACTIVITIES in the
     FC Portal's src/modules/palms/data.js. */
  const ACTIVITIES = [
    { n: 1,  name: 'Saringan Anak Bibit',        days: 2 },
    { n: 2,  name: 'Tunggu buat culling',        days: 3 },
    { n: 3,  name: 'Culling',                    days: 2 },
    { n: 4,  name: 'Membersih',                  days: 1 },
    { n: 5,  name: 'Meracun secara selingan',    days: 1 },
    { n: 6,  name: 'Angkat tanah',               days: 5 },
    { n: 7,  name: 'Isi polibeg',                days: 5 },
    { n: 8,  name: 'Lining',                     days: 2 },
    { n: 9,  name: 'Transplanting',              days: 2 },
    { n: 10, name: 'Membesar',                   days: 270 },
    { n: 11, name: 'Pengambilan',                days: 30 },
  ];

  const FIRST_ACT = 1;   // Saringan Anak Bibit
  const LAST_ACT = 11;   // Pengambilan
  const TARGET_DAYS = 15; // the speed incentive: Saringan → Transplanting

  const actByN = (n) => ACTIVITIES.find((a) => a.n === n) || null;

  /* ---------- dates ---------- */
  const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                     '-' + String(d.getDate()).padStart(2, '0');
  const todayStr = () => fmt(new Date());
  function parseD(s) {
    const p = String(s).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return fmt(d); };
  const diffDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
  const prettyD = (s) => (!s ? '—' : parseD(s).toLocaleDateString('en-MY',
    { day: '2-digit', month: 'short', year: 'numeric' }));

  /* A unit key is the plot while it is whole ("B2") and "B2#A" once it is
     split into areas. Work is logged against the unit, so that is what the
     server stores and what everything here counts. */
  const keyLabel = (k) => (String(k).indexOf('#') !== -1 ? String(k).replace('#', ' · ') : String(k));
  const plotOf = (k) => String(k).split('#')[0];

  const NURSERY_PREFIX = { B: 'BNN', U: 'UNN1', N: 'UNN2' };
  const nurseryOfPlot = (p) => NURSERY_PREFIX[String(p).charAt(0).toUpperCase()] || null;

  /* ---------- the log ----------
     Server rows into the shape the measurements below read: one array of
     entries per unit, oldest first. The order matters — cyclesOf walks the
     log forward looking for where one intake ends and the next begins. */
  function logsFromRows(rows) {
    const logs = {};
    (rows || []).forEach((r) => {
      const key = r.plot_name;
      if (!key) return;
      (logs[key] = logs[key] || []).push({
        uid: r.client_uid,
        no: r.seq_no == null ? 0 : r.seq_no,
        actN: r.act_n,
        start: r.start_date,
        end: r.end_date || null,
        ideal: r.ideal_days == null ? (actByN(r.act_n) || {}).days : r.ideal_days,
        by: r.recorded_by || null,
      });
    });
    Object.keys(logs).forEach((k) => logs[k].sort(
      (a, b) => String(a.start).localeCompare(String(b.start)) || (a.no - b.no)
    ));
    return logs;
  }

  /* ---------- what is running right now (the monitoring board) ---------- */
  const currentEntries = (logs, key) => (logs[key] || []).filter((e) => e.end === null);

  /* An activity is overdue once more days have passed than the stage is
     meant to take. "Soon" is a Settings rule in the field app and is not
     read here: the office has no per-device settings, and a warning
     threshold the office cannot see the value of would be a number nobody
     could check. Overdue or on schedule, and the days left say the rest. */
  function statusOfEntry(key, e) {
    const act = actByN(e.actN);
    const due = addDays(e.start, e.ideal == null ? 0 : e.ideal);
    const left = diffDays(todayStr(), due);
    return { state: left < 0 ? 'overdue' : 'ontrack', act, due, left, start: e.start, key };
  }

  const STATE_RANK = { overdue: 0, ontrack: 1, none: 2 };

  /* With two activities able to run at once, a unit is only as healthy as
     its worse one. */
  function computeStatus(logs, key) {
    const open = currentEntries(logs, key);
    if (!open.length) return { state: 'none' };
    return open.map((e) => statusOfEntry(key, e)).sort((a, b) => {
      const r = STATE_RANK[a.state] - STATE_RANK[b.state];
      return r !== 0 ? r : (a.left == null ? Infinity : a.left) - (b.left == null ? Infinity : b.left);
    })[0];
  }

  const openActivities = (logs, key) =>
    currentEntries(logs, key).map((e) => actByN(e.actN)).filter(Boolean).sort((a, b) => a.n - b.n);

  /** Every unit with anything logged, narrowed to a nursery.
      `nursery` is one key, 'all', or a list — a list is how somebody
      restricted to some nurseries asks for "all of the ones I may see". */
  function unitsOf(logs, nursery) {
    const keys = Array.isArray(nursery) ? nursery : null;
    return Object.keys(logs || {}).filter((k) => {
      if (!(logs[k] || []).length) return false;
      if (keys) return keys.indexOf(nurseryOfPlot(plotOf(k))) !== -1;
      if (!nursery || nursery === 'all') return true;
      return nurseryOfPlot(plotOf(k)) === nursery;
    });
  }

  /* ---------- the motion study ----------
     The unit of measurement is a CYCLE: Saringan Anak Bibit through to
     Pengambilan, one intake of seedlings worked from start to sale. A plot
     goes round it again and again, so the same activity has one figure per
     cycle and the interesting numbers are the shortest and the longest. */

  /* Entries recorded before the first Saringan are left out: there is no way
     to know how much of that cycle happened before the plot was being
     logged, and a half-measured cycle would drag the minimum down. */
  function cyclesOf(log) {
    const rows = (log || []).slice().sort((a, b) => (a.no - b.no) || String(a.start).localeCompare(String(b.start)));
    const out = [];
    let cur = null;
    rows.forEach((e) => {
      // Saringan opens a cycle, but only starts a NEW one once the running
      // cycle has moved past Saringan — otherwise a stage keyed in, stopped
      // and picked up again looks like a second intake.
      if (e.actN === FIRST_ACT && (!cur || cur.entries.some((x) => x.actN > FIRST_ACT))) {
        if (cur) out.push(cur);
        cur = { entries: [] };
      }
      if (!cur) return;  // still in the unmeasurable head of the log
      cur.entries.push(e);
      if (e.actN === LAST_ACT && e.end) { out.push(cur); cur = null; }
    });
    if (cur) out.push(cur);
    return out;
  }

  /* Days ONE activity took inside one cycle. An activity keyed in twice in
     the same cycle — stopped and picked up again — counts as the days
     worked, not the calendar span, so an idle gap in between is not charged
     to it. A span is right for a RUN across different activities, where days
     shared by two of them must count once; it is wrong for one activity,
     where it bills the standing idle. */
  function daysForActivity(cycle, n) {
    const parts = cycle.entries.filter((e) => e.actN === n && e.end);
    if (!parts.length) return null;
    const days = parts.reduce((s, e) => s + Math.max(0, diffDays(e.start, e.end)), 0);
    return { days: days, start: parts[0].start, end: parts[parts.length - 1].end };
  }

  /* A measurement belongs to the month it FINISHED in — the month the work
     was signed off, and the only date every measurement has. */
  const inMonth = (month, date) => !month || String(date || '').slice(0, 7) === month;

  function summarise(samples) {
    if (!samples.length) return null;
    const sorted = samples.slice().sort((a, b) => a.days - b.days);
    const total = sorted.reduce((s, x) => s + x.days, 0);
    return {
      n: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round((total / sorted.length) * 10) / 10,
    };
  }

  function activitySamples(logs, nursery, n, month) {
    const out = [];
    unitsOf(logs, nursery).forEach((key) => {
      cyclesOf(logs[key]).forEach((cycle) => {
        const d = daysForActivity(cycle, n);
        if (d && inMonth(month, d.end)) {
          out.push({ days: d.days, key: key, label: keyLabel(key), start: d.start, end: d.end });
        }
      });
    });
    return out;
  }

  const activityStats = (logs, nursery, n, month) => summarise(activitySamples(logs, nursery, n, month));

  /** Every activity's shortest / longest / average, in activity order. */
  const perActivityStats = (logs, nursery, month) =>
    ACTIVITIES.map((a) => ({ act: a, stats: activityStats(logs, nursery, a.n, month) }));

  /** One activity, split by unit: which plots take longest over it.
      Slowest first, because that is the list worth acting on. */
  function perUnitActivityStats(logs, nursery, n, month) {
    const by = {};
    activitySamples(logs, nursery, n, month).forEach((s) => { (by[s.key] = by[s.key] || []).push(s); });
    return Object.keys(by)
      .map((key) => ({ key: key, label: keyLabel(key), stats: summarise(by[key]) }))
      .sort((a, b) => b.stats.avg - a.stats.avg);
  }

  /* Days a RUN of activities took inside one cycle — first activity's start
     to last activity's end. Measuring the span is what keeps two activities
     that ran on the same days from being counted twice. */
  function spanSamples(logs, nursery, fromN, toN, month) {
    const lo = Math.min(fromN, toN);
    const hi = Math.max(fromN, toN);
    const samples = [];
    unitsOf(logs, nursery).forEach((key) => {
      cyclesOf(logs[key]).forEach((cycle) => {
        const starts = cycle.entries.filter((e) => e.actN === lo).map((e) => e.start);
        const ends = cycle.entries.filter((e) => e.actN === hi && e.end).map((e) => e.end);
        if (!starts.length || !ends.length) return;   // cycle does not cover the run
        const start = starts.sort()[0];
        const end = ends.sort()[ends.length - 1];
        const days = diffDays(start, end);
        if (days >= 0 && inMonth(month, end)) {
          samples.push({ days: days, key: key, label: keyLabel(key), start: start, end: end });
        }
      });
    });
    return samples;
  }

  const spanStats = (logs, nursery, fromN, toN, month) => summarise(spanSamples(logs, nursery, fromN, toN, month));

  function perUnitStats(logs, nursery, fromN, toN, month) {
    const by = {};
    spanSamples(logs, nursery, fromN, toN, month).forEach((s) => { (by[s.key] = by[s.key] || []).push(s); });
    return Object.keys(by)
      .map((key) => ({ key: key, label: keyLabel(key), stats: summarise(by[key]) }))
      .sort((a, b) => b.stats.avg - a.stats.avg);
  }

  /* The speed incentive. Aggregates cannot answer this: a plot with cycles
     of 12, 30 and 33 days reports "min 12, avg 25" — you can see somebody
     once managed 12 days, but not which cycle, not when it finished, and so
     not whether to pay it. One row per completed run. */
  function incentiveRuns(logs, nursery, fromN, toN, month) {
    return spanSamples(logs, nursery, fromN, toN, month)
      .map((s) => {
        const parts = String(s.key).split('#');
        return Object.assign({}, s, {
          plot: parts[0],
          area: parts[1] || null,
          withinTarget: s.days <= TARGET_DAYS,
        });
      })
      .sort((a, b) => a.days - b.days || a.label.localeCompare(b.label));
  }

  /** The ideal the run is judged against, for comparison. */
  function idealSpan(fromN, toN) {
    const lo = Math.min(fromN, toN);
    const hi = Math.max(fromN, toN);
    return ACTIVITIES.filter((a) => a.n >= lo && a.n <= hi).reduce((s, a) => s + a.days, 0);
  }

  /** Every month with at least one finished measurement, newest first, so a
      picker only ever offers months with something behind them. */
  function monthsWithData(logs, nursery) {
    const set = {};
    unitsOf(logs, nursery).forEach((key) => {
      cyclesOf(logs[key]).forEach((cycle) => {
        cycle.entries.forEach((e) => { if (e.end) set[e.end.slice(0, 7)] = true; });
      });
    });
    return Object.keys(set).sort().reverse();
  }

  /* ---------- loading ----------
     Supabase caps one request at 1000 rows, and the plot log passes that
     inside a season. A partial read does not fail — it quietly returns a
     shorter history, which here would mean inventing a faster nursery. */
  async function loadLogs(supa) {
    const all = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const res = await supa.from('fcportal_palms_plot_logs')
        .select('client_uid, plot_name, act_n, start_date, end_date, ideal_days, recorded_by, seq_no')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (res.error) throw res.error;
      const rows = res.data || [];
      all.push.apply(all, rows);
      if (rows.length < PAGE) break;
    }
    return logsFromRows(all);
  }

  global.MJMPalms = {
    ACTIVITIES: ACTIVITIES,
    FIRST_ACT: FIRST_ACT,
    LAST_ACT: LAST_ACT,
    TARGET_DAYS: TARGET_DAYS,
    actByN: actByN,
    addDays: addDays,
    diffDays: diffDays,
    todayStr: todayStr,
    prettyD: prettyD,
    keyLabel: keyLabel,
    plotOf: plotOf,
    nurseryOfPlot: nurseryOfPlot,
    loadLogs: loadLogs,
    logsFromRows: logsFromRows,
    unitsOf: unitsOf,
    currentEntries: currentEntries,
    computeStatus: computeStatus,
    openActivities: openActivities,
    cyclesOf: cyclesOf,
    activityStats: activityStats,
    perActivityStats: perActivityStats,
    perUnitActivityStats: perUnitActivityStats,
    spanStats: spanStats,
    perUnitStats: perUnitStats,
    incentiveRuns: incentiveRuns,
    idealSpan: idealSpan,
    monthsWithData: monthsWithData,
  };
})(window);
