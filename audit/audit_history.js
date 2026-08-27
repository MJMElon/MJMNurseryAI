/* ══════════════════════════════════════════════════════════════════
   555 AUDITOR PORTAL — COMPLETED RECORDS, ON THE MANAGE VIEW ONLY
   ══════════════════════════════════════════════════════════════════
   Under the plot grid in each of the four modules: what has actually
   been audited, newest first, with a summary that opens on a tap.

   WHY IT IS NOT ON THE AUDITOR PORTAL
   -----------------------------------
   The auditor's page answers one question — what still owes work —
   and the plot grid answers it. A month of finished records under it
   is a second, longer list to scroll past on a phone in a nursery to
   reach the plots that are the point. Somebody at a desk is asking
   the opposite question: what was done, by whom, and what did they
   find. So this renders only when the page was opened from
   audit_admin.html, which is exactly what ?from=manage says. Without
   that flag the file loads, returns immediately, and the auditor's
   page is the page it always was.

   WHY IT FETCHES ITS OWN RECORDS
   ------------------------------
   Each module already holds its records, but under a different name
   in each (`records`, `audits`), declared with `let` at script top
   level — a global lexical binding, not a property of window, and
   reaching across for it by name would tie this file to four private
   variables it does not own. One query per module, from the same
   table and the same columns audit_report.html has proven, is both
   independent of their internals and identical in all four.

   The columns are deliberately verbatim from the report's SELECTs.
   PostgREST does not partially fail: ask for one column a table does
   not have and the whole query comes back 400 and the section renders
   empty. Adding a field here means checking the table first.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* The manage view, and nothing else. First line of the file, so on
     the auditor portal this costs one function call and no query. */
  if (!window.MJMAuditLogin || typeof MJMAuditLogin.fromManage !== 'function') return;
  if (!MJMAuditLogin.fromManage()) return;

  /* ── WHAT EACH MODULE KEEPS, AND WHAT IS WORTH SHOWING ──
     `cols` is copied from audit_report.html's query for the same
     table — see the note above about PostgREST's all-or-nothing
     SELECT. `row` is the one line in the list; `fields` is the
     summary that opens, in the order it should be read. */
  var MODULES = {
    'audit_plot_audit.html': {
      table: 'audit_plot_audits',
      key:   'audit_id',
      cols:  'audit_id,nursery,plot,batch,pest,tikus,disease,warna_daun,auditor_name,date',
      name:  'Plot Condition',
      sub:   function (r) { return 'Batch ' + (r.batch || '—'); },
      fields: [
        ['Pest infestation',   'pest'],
        ['Animal infestation', 'tikus'],
        ['Disease',            'disease'],
        ['Leaf colour',        'warna_daun']
      ]
    },
    'audit_height_index.html': {
      table: 'audit_height_records',
      key:   'record_id',
      cols:  'record_id,nursery,plot,batch,sample_1,sample_2,sample_3,avg_height,auditor_name,date',
      name:  'Seedling Height',
      sub:   function (r) {
        return 'Batch ' + (r.batch || '—') +
               (r.avg_height ? ' · avg ' + r.avg_height + ' cm' : '');
      },
      fields: [
        ['Sample 1', 'sample_1', 'cm'],
        ['Sample 2', 'sample_2', 'cm'],
        ['Sample 3', 'sample_3', 'cm'],
        ['Average',  'avg_height', 'cm']
      ]
    },
    'audit_papan_index.html': {
      table: 'audit_papan_audits',
      key:   'audit_id',
      cols:  'audit_id,nursery,plot,batch_no,presence,info_correct,condition,auditor_name,date',
      name:  'Papan Tanda',
      sub:   function (r) { return 'Batch ' + (r.batch_no || '—'); },
      fields: [
        ['Presence',        'presence'],
        ['Info correct',    'info_correct'],
        ['Condition',       'condition']
      ]
    },
    'audit_maintenance_index.html': {
      table: 'audit_maintenance_audits',
      key:   'audit_id',
      cols:  'audit_id,nursery,plot,task_type,result,auditor_name,date',
      name:  'Maintenance',
      sub:   function (r) { return r.task_type || '—'; },
      fields: [
        ['Task',   'task_type'],
        ['Result', 'result']
      ]
    }
  };

  var page = location.pathname.split('/').pop();
  var CFG  = MODULES[page];
  if (!CFG) return;

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var rows = [];      // every nursery; the active tab filters at render time
  var loaded = false;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var s = String(iso).split('T')[0].split('-');
    if (s.length < 3) return String(iso);
    return s[2] + ' ' + MONTHS[(+s[1]) - 1] + ' ' + s[0];
  }

  /* Which nursery tab is showing. Read off the DOM rather than the
     module's own `activeTab` for the same reason the records are
     fetched rather than borrowed — the class on the button is public,
     the variable is not. */
  function activeNursery() {
    var el = document.querySelector('.tab-item.active[data-n], .nursery-tab-item.active[data-n]');
    return el ? el.dataset.n : null;
  }

  /* ── THE SECTION ──
     Appended to the end of #view-list, which every module has and
     which the module itself hides when it switches to a form or a
     detail — so this needs no show/hide logic of its own. */
  function mount() {
    var list = document.getElementById('view-list');
    if (!list || document.getElementById('hist-section')) return null;

    var wrap = document.createElement('div');
    wrap.id = 'hist-section';
    wrap.className = 'hist-section';
    wrap.innerHTML =
      '<div class="list-header">' +
        '<span class="list-heading">Completed Records</span>' +
        '<span class="list-count" id="hist-count">—</span>' +
      '</div>' +
      '<div class="record-list" id="hist-list"></div>';
    list.appendChild(wrap);
    return wrap;
  }

  function render() {
    var listEl  = document.getElementById('hist-list');
    var countEl = document.getElementById('hist-count');
    if (!listEl) return;

    if (!loaded) {
      countEl.textContent = '…';
      listEl.innerHTML = '<div class="hist-empty">Loading completed records…</div>';
      return;
    }

    var n = activeNursery();
    var mine = n ? rows.filter(function (r) { return r.nursery === n; }) : rows.slice();

    countEl.textContent = mine.length + (mine.length === 1 ? ' record' : ' records');
    if (!mine.length) {
      listEl.innerHTML = '<div class="hist-empty">No completed records yet' +
                         (n ? ' for ' + esc(n) : '') + '.</div>';
      return;
    }

    listEl.innerHTML = mine.map(function (r, i) {
      return '<button type="button" class="record-item hist-item" data-i="' + i + '">' +
               '<div class="hist-body">' +
                 '<div class="hist-top">' +
                   '<span class="hist-plot">' + esc(r.plot || '—') + '</span>' +
                   '<span class="hist-date">' + esc(fmtDate(r.date)) + '</span>' +
                 '</div>' +
                 '<div class="hist-sub">' + esc(CFG.sub(r)) +
                   (r.auditor_name ? ' · ' + esc(r.auditor_name) : '') +
                 '</div>' +
               '</div>' +
               '<svg class="hist-chev" viewBox="0 0 24 24" aria-hidden="true">' +
                 '<polyline points="9 6 15 12 9 18"/></svg>' +
             '</button>';
    }).join('');

    listEl.querySelectorAll('.hist-item').forEach(function (b) {
      b.addEventListener('click', function () {
        openSummary(mine[+b.dataset.i]);
      });
    });
  }

  /* ── THE SUMMARY ──
     Its own overlay, not the module's #modal-overlay: that one is the
     delete confirmation, with its own body and its own handlers bound
     in each module's init(). Reuses the .modal-* classes so it is
     styled by audit_theme.css along with everything else. */
  function overlay() {
    var el = document.getElementById('hist-modal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'hist-modal';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-box hist-modal-box"></div>';
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    document.body.appendChild(el);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    return el;
  }
  function close() {
    var el = document.getElementById('hist-modal');
    if (el) el.classList.remove('show');
  }
  window.closeAuditSummary = close;

  function openSummary(r) {
    if (!r) return;
    var el  = overlay();
    var box = el.querySelector('.modal-box');

    var body = CFG.fields.map(function (f) {
      var v = r[f[1]];
      var shown = (v === null || v === undefined || v === '') ? '—'
                : esc(v) + (f[2] ? ' ' + f[2] : '');
      return '<div class="hist-cell">' +
               '<div class="hist-cell-label">' + esc(f[0]) + '</div>' +
               '<div class="hist-cell-val">' + shown + '</div>' +
             '</div>';
    }).join('');

    box.innerHTML =
      '<div class="hist-modal-head">' +
        '<div>' +
          '<div class="modal-title">' + esc(r.plot || '—') + '</div>' +
          '<div class="hist-modal-sub">' + esc(CFG.name) + ' · ' + esc(fmtDate(r.date)) + '</div>' +
        '</div>' +
        '<button type="button" class="hist-close" onclick="closeAuditSummary()" ' +
                'aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="hist-grid">' + body + '</div>' +
      '<div class="hist-meta">' +
        '<span>' + esc(r.nursery || '—') + '</span>' +
        '<span>' + (r.auditor_name ? esc(r.auditor_name) : 'Auditor not recorded') + '</span>' +
      '</div>';

    el.classList.add('show');
  }

  /* ── LOAD ──
     One query, every nursery, newest first. The nursery tabs filter
     what is already here rather than going back to the network. */
  function load() {
    /* `sb` is a top-level const in audit_supabase.js, which makes it a
       GLOBAL LEXICAL binding — reachable here by name, but never a
       property of window. Testing window.sb finds undefined however
       well the file loaded, and the section sits on "Loading…" for
       ever. typeof is the safe way to ask: it answers 'undefined'
       rather than throwing when the file genuinely is not there. */
    if (typeof sb === 'undefined' || !sb || typeof sb.select !== 'function') {
      loaded = true;
      rows = [];
      render();
      return;
    }
    /* No order= of our own: sb.select appends `order=created_at.desc`
       to every read, and two order params in one PostgREST query is
       asking for trouble. Sorted here instead, and by `date` — the day
       the audit was made, which is what a history is read by, not the
       day the row happened to be written. */
    sb.select(CFG.table, 'select=' + CFG.cols + '&limit=300')
      .then(function (data) {
        rows = (Array.isArray(data) ? data : []).slice().sort(function (a, b) {
          return String(b.date || '').localeCompare(String(a.date || ''));
        });
        loaded = true;
        render();
      })
      .catch(function () {
        loaded = true;
        rows = [];
        var el = document.getElementById('hist-list');
        if (el) el.innerHTML = '<div class="hist-empty">Could not load completed records.</div>';
        var c = document.getElementById('hist-count');
        if (c) c.textContent = '—';
      });
  }

  function start() {
    if (!mount()) return;
    render();
    load();
    /* The nursery tabs mark themselves with .active; watching for that
       keeps the list in step without the module having to tell us. */
    var bar = document.querySelector('.bottom-tabs, .nursery-bottom-tabs');
    if (bar && window.MutationObserver) {
      new MutationObserver(function () { render(); })
        .observe(bar, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
  }

  /* After the module's own DOMContentLoaded init, so #view-list is
     built and its tab bar has an active button to read. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
  } else {
    setTimeout(start, 0);
  }
})();
