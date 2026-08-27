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

   Which is what `photos` is. Each module names its photo columns
   differently, and these were read off the payload each one actually
   inserts rather than guessed:

     audit_plot_audits         photo_url, photo_2_url
     audit_height_records      photo_1_url, photo_2_url, photo_3_url
     audit_papan_audits        photo_url
     audit_maintenance_audits  photo_url

   A module with no photo column would simply carry no `photos` key.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* TWO THINGS LIVE HERE, AND THEY ARE GATED DIFFERENTLY.

     The completed-records SECTION under a module's plot grid is the
     manage view's, and still returns early below.

     The SUMMARY — the dialog that opens on a record, its values and its
     photos — is not. The auditor portal's own Audit History wants the
     same thing on the same records, so it is exported as
     MJMAuditSummary and the styles it needs are injected by this file
     rather than assumed from a stylesheet. That keeps it portable to a
     page which loads neither audit_theme.css nor anything else of
     ours. */

  /* ── WHAT EACH MODULE KEEPS, AND WHAT IS WORTH SHOWING ──
     `cols` is copied from audit_report.html's query for the same
     table — see the note above about PostgREST's all-or-nothing
     SELECT. `row` is the one line in the list; `fields` is the
     summary that opens, in the order it should be read. */
  var MODULES = {
    plot: {
      table: 'audit_plot_audits',
      key:   'audit_id',
      cols:  'audit_id,nursery,plot,batch,pest,tikus,disease,warna_daun,auditor_name,date,'
           + 'photo_url,photo_2_url',
      photos: ['photo_url', 'photo_2_url'],
      name:  'Plot Condition',
      sub:   function (r) { return 'Batch ' + (r.batch || '—'); },
      fields: [
        ['Pest infestation',   'pest'],
        ['Animal infestation', 'tikus'],
        ['Disease',            'disease'],
        ['Leaf colour',        'warna_daun']
      ]
    },
    height: {
      table: 'audit_height_records',
      key:   'record_id',
      cols:  'record_id,nursery,plot,batch,sample_1,sample_2,sample_3,avg_height,auditor_name,date,'
           + 'photo_1_url,photo_2_url,photo_3_url',
      photos: ['photo_1_url', 'photo_2_url', 'photo_3_url'],
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
    papan: {
      table: 'audit_papan_audits',
      key:   'audit_id',
      cols:  'audit_id,nursery,plot,batch_no,presence,info_correct,condition,auditor_name,date,'
           + 'photo_url',
      photos: ['photo_url'],
      name:  'Papan Tanda',
      sub:   function (r) { return 'Batch ' + (r.batch_no || '—'); },
      fields: [
        ['Presence',        'presence'],
        ['Info correct',    'info_correct'],
        ['Condition',       'condition']
      ]
    },
    maint: {
      table: 'audit_maintenance_audits',
      key:   'audit_id',
      cols:  'audit_id,nursery,plot,task_type,result,auditor_name,date,'
           + 'photo_url',
      photos: ['photo_url'],
      name:  'Maintenance',
      /* The only one of the four with a real work type on the record.
         The others store findings (pest / disease / leaf colour,
         presence / info / condition) or numbers, so they get the month
         filter alone rather than a dropdown of something that is not
         the work that was done. */
      work:  { field: 'task_type', label: 'Work' },
      sub:   function (r) { return r.task_type || '—'; },
      fields: [
        ['Task',   'task_type'],
        ['Result', 'result']
      ]
    }
  };

  /* Which module a module PAGE is. The auditor portal asks by key
     instead, because its history already knows which table a row came
     from. */
  var PAGE_MOD = {
    'audit_plot_audit.html':        'plot',
    'audit_height_index.html':      'height',
    'audit_papan_index.html':       'papan',
    'audit_maintenance_index.html': 'maint'
  };
  var CFG = MODULES[PAGE_MOD[location.pathname.split('/').pop()]] || null;

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* Shared with audit_home.html's Audit History. `spec(mod)` hands back
     the same field list, photo columns and label this file uses, so the
     two surfaces cannot describe the same record differently. */
  window.MJMAuditSummary = {
    open:  function (record, mod) { openSummary(record, MODULES[mod] || mod); },
    close: function () { close(); },
    spec:  function (mod) { return MODULES[mod] || null; }
  };
  var rows = [];      // every nursery; the tab and the filters narrow it at render time
  var loaded = false;
  var fMonth = '';    // '' = every month;  otherwise 'YYYY-MM'
  var fWork  = '';    // '' = every kind of work

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
      '<div class="hist-filters" id="hist-filters"></div>' +
      '<div class="record-list" id="hist-list"></div>';
    list.appendChild(wrap);
    return wrap;
  }

  /* ── THE FILTERS ──
     Both are built from the records actually in hand rather than from a
     fixed list: a month with nothing in it is not worth offering, and
     the work types a nursery has actually been audited for are the only
     ones worth choosing between. Rebuilt on every render so switching
     nursery re-offers the months that nursery has.

     The nursery is deliberately NOT one of them — it is the tab bar at
     the foot of the page, and a second control for it would be two
     places to set one thing. */
  function monthsIn(list) {
    var seen = {}, out = [];
    list.forEach(function (r) {
      var m = String(r.date || '').slice(0, 7);
      if (m.length === 7 && !seen[m]) { seen[m] = 1; out.push(m); }
    });
    return out.sort().reverse();
  }
  function worksIn(list) {
    if (!CFG.work) return [];
    var seen = {}, out = [];
    list.forEach(function (r) {
      var v = r[CFG.work.field];
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out.sort();
  }
  function monthLabel(m) {
    var p = m.split('-');
    return MONTHS[(+p[1]) - 1] + ' ' + p[0];
  }

  function renderFilters(scoped) {
    var bar = document.getElementById('hist-filters');
    if (!bar) return;

    var months = monthsIn(scoped);
    var works  = worksIn(scoped);

    /* A filter set to something the current nursery has none of would
       hide every row with no way back other than guessing. Reset it. */
    if (fMonth && months.indexOf(fMonth) === -1) fMonth = '';
    if (fWork  && works.indexOf(fWork)   === -1) fWork  = '';

    var html = '';
    if (works.length) {
      html += '<label class="hist-filter">' +
                '<span class="hist-filter-label">' + esc(CFG.work.label) + '</span>' +
                '<select class="input hist-select" id="hist-f-work">' +
                  '<option value="">All</option>' +
                  works.map(function (w) {
                    return '<option value="' + esc(w) + '"' +
                           (w === fWork ? ' selected' : '') + '>' + esc(w) + '</option>';
                  }).join('') +
                '</select>' +
              '</label>';
    }
    if (months.length) {
      html += '<label class="hist-filter">' +
                '<span class="hist-filter-label">Month</span>' +
                '<select class="input hist-select" id="hist-f-month">' +
                  '<option value="">All months</option>' +
                  months.map(function (m) {
                    return '<option value="' + m + '"' +
                           (m === fMonth ? ' selected' : '') + '>' + esc(monthLabel(m)) + '</option>';
                  }).join('') +
                '</select>' +
              '</label>';
    }
    if ((fMonth || fWork)) {
      html += '<button type="button" class="hist-clear" id="hist-clear">Clear</button>';
    }
    bar.innerHTML = html;
    bar.style.display = html ? '' : 'none';

    var w = document.getElementById('hist-f-work');
    if (w) w.addEventListener('change', function () { fWork = w.value; render(); });
    var m = document.getElementById('hist-f-month');
    if (m) m.addEventListener('change', function () { fMonth = m.value; render(); });
    var c = document.getElementById('hist-clear');
    if (c) c.addEventListener('click', function () { fMonth = ''; fWork = ''; render(); });
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
    /* The nursery scopes what the filters are built from, so a month
       with records only in another nursery is not offered here. */
    var scoped = n ? rows.filter(function (r) { return r.nursery === n; }) : rows.slice();
    renderFilters(scoped);

    var mine = scoped.filter(function (r) {
      if (fMonth && String(r.date || '').slice(0, 7) !== fMonth) return false;
      if (fWork && CFG.work && r[CFG.work.field] !== fWork) return false;
      return true;
    });

    countEl.textContent = mine.length + (mine.length === 1 ? ' record' : ' records');
    if (!mine.length) {
      listEl.innerHTML = '<div class="hist-empty">' +
        (scoped.length
          ? 'No records match this filter.'
          : 'No completed records yet' + (n ? ' for ' + esc(n) : '') + '.') +
        '</div>';
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
        openSummary(mine[+b.dataset.i], CFG);
      });
    });
  }

  /* ── THE SUMMARY ──
     Its own overlay, not the module's #modal-overlay: that one is the
     delete confirmation, with its own body and its own handlers bound
     in each module's init(). Reuses the .modal-* classes so it is
     styled by audit_theme.css along with everything else. */
  /* The dialog carries its own look. audit_theme.css has the same rules
     for the module pages, which is harmless duplication; the point is
     that audit_home.html loads no stylesheet of ours and still gets a
     correct dialog. Scoped to #hist-modal so nothing here can reach the
     auditor portal's own .hist-row / .hist-empty / .hist-date. */
  var STYLE_ID = 'mjm-audit-summary-css';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '#hist-modal{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;' +
        'justify-content:center;background:rgba(16,40,60,.45);opacity:0;pointer-events:none;' +
        'transition:opacity .2s}' +
      '#hist-modal.show{opacity:1;pointer-events:auto}' +
      '#hist-modal .modal-box{background:#fff;border:1px solid #e6ecf2;border-radius:18px;' +
        'box-shadow:0 20px 50px rgba(16,40,60,.2);max-width:460px;width:calc(100% - 32px);' +
        'max-height:86vh;overflow:auto;padding:18px 18px 16px;' +
        "font-family:'DM Sans',system-ui,-apple-system,sans-serif}" +
      '#hist-modal .hist-modal-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}' +
      '#hist-modal .modal-title{font-size:16px;font-weight:800;color:#16323f}' +
      '#hist-modal .hist-modal-sub{font-size:11px;font-weight:700;color:#94a7b4;margin-top:3px;' +
        'text-transform:uppercase;letter-spacing:.6px}' +
      '#hist-modal .hist-close{margin-left:auto;width:30px;height:30px;border-radius:9px;' +
        'background:#f4f7fa;border:1px solid #e6ecf2;color:#5b7280;font-size:19px;line-height:1;' +
        'cursor:pointer;flex-shrink:0;font-family:inherit}' +
      '#hist-modal .hist-close:hover{background:#eaeff5;color:#16323f}' +
      '#hist-modal .hist-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}' +
      '#hist-modal .hist-cell{background:#f8fafc;border:1px solid #e6ecf2;border-radius:12px;padding:10px 12px}' +
      '#hist-modal .hist-cell-label{font-size:9.5px;font-weight:800;text-transform:uppercase;' +
        'letter-spacing:.7px;color:#94a7b4}' +
      '#hist-modal .hist-cell-val{font-size:14px;font-weight:700;color:#16323f;margin-top:3px;' +
        'word-break:break-word}' +
      '#hist-modal .hist-shots{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
      '#hist-modal .hist-shot{display:block;width:78px;height:78px;border-radius:12px;overflow:hidden;' +
        'border:1px solid #e6ecf2;background:#f8fafc;flex-shrink:0}' +
      '#hist-modal .hist-shot:hover{border-color:#a7f3d0}' +
      '#hist-modal .hist-shot img{width:100%;height:100%;object-fit:cover;display:block}' +
      '#hist-modal .hist-meta{display:flex;justify-content:space-between;gap:12px;margin-top:14px;' +
        'padding-top:12px;border-top:1px solid #e6ecf2;font-size:11px;font-weight:700;color:#94a7b4}';
    document.head.appendChild(st);
  }

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

  function openSummary(r, spec) {
    /* The spec is always passed. It used to fall back to a file-level
       CFG, which only existed on a module page — and reaching for it via
       arguments.callee is a TypeError under 'use strict' anyway. */
    var CFG = spec;
    if (!r || !CFG) return;
    injectStyles();
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

    /* Photos, where the module records any and the record has them. A
       record with no photo gets no strip at all rather than an empty
       frame — most of these audits are keyed without one.

       Each is a link as well as a thumbnail: the stored value is
       whatever went into the column, a Supabase storage URL for a photo
       uploaded online and a base64 data URL for one queued offline, and
       both open. onerror hides a thumbnail whose file has gone rather
       than leaving a broken-image icon in the summary. */
    var shots = (CFG.photos || [])
      .map(function (c) { return r[c]; })
      .filter(function (v) { return v && String(v).trim(); });
    var photoHtml = shots.length
      ? '<div class="hist-shots">' + shots.map(function (u, i) {
          return '<a class="hist-shot" href="' + esc(u) + '" target="_blank" rel="noopener" ' +
                    'aria-label="Photo ' + (i + 1) + ' — open full size">' +
                   '<img src="' + esc(u) + '" alt="Audit photo ' + (i + 1) + '" ' +
                        'loading="lazy" onerror="this.closest(\'.hist-shot\').style.display=\'none\'"/>' +
                 '</a>';
        }).join('') + '</div>'
      : '';

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
      photoHtml +
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
    /* The photo columns are the one part of this SELECT that could not be
       checked against the live schema — they were read off each module's
       insert payload, which is good evidence and not proof. PostgREST
       fails a query whole, so a column that turned out not to exist would
       empty the section rather than merely drop the photos.

       So: ask for them, and on any failure ask again without them. A
       wrong guess costs the thumbnails and one extra request, not the
       records. If the second attempt fails too the table really is
       unreadable, and that is what the catch below reports. */
    var withPhotos = 'select=' + CFG.cols + '&limit=300';
    var noPhotos   = 'select=' + CFG.cols.split(',')
                       .filter(function (c) { return !/^photo/.test(c.trim()); })
                       .join(',') + '&limit=300';

    var keep = function (data) {
      rows = (Array.isArray(data) ? data : []).slice().sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || ''));
      });
      loaded = true;
      render();
    };

    sb.select(CFG.table, withPhotos)
      .then(keep)
      .catch(function () {
        return sb.select(CFG.table, noPhotos).then(keep);
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
    /* The completed-records section is the manage view's. Without
       ?from=manage this file has still defined MJMAuditSummary above —
       which is all the auditor portal wants from it — and does nothing
       else. */
    if (typeof MJMAuditLogin === 'undefined' ||
        typeof MJMAuditLogin.fromManage !== 'function' ||
        !MJMAuditLogin.fromManage()) return;
    if (!CFG) return;
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
