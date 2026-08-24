/* ================================================================
   MJM AI POWERED SYSTEM — NELOS FLOATING DOCK
   shared/shared_nelos_dock.js

   The round Nelos button that follows the user around the portal.

   Every page that loads this file gets a small floating circle in the
   bottom-right corner with the number of pending Nelos cases on it.
   Tap it and it expands into a To-Do panel — pending cases, worst
   first, each one a link straight into nelos/nelos_case.html. Tap the
   minimise arrow and it shrinks back to the circle. Whether it is open
   or shut, and which tab it was on, is remembered in localStorage, so
   it stays the way the user left it as they move from Stock to Audit
   to Payroll.

   Usage — one line, anywhere in the page, no markup and no init call:

     <script src="../shared/shared_nelos_dock.js"></script>     (module page)
     <script src="shared/shared_nelos_dock.js"></script>        (portal root)

   Optional attributes on that same tag:

     data-source="operation"   only cases raised by one module
     data-hide-on="/mobile/"   extra path fragment to stay off

   WHY THIS DOES NOT USE shared_nelos.js
   -------------------------------------
   shared_nelos.js needs a Supabase client, and the pages this dock has
   to live on build theirs in five different ways (operation/* make one
   from SUPABASE_URL, audit/* have audit_supabase.js, some pages have
   none at all). Rather than guess at the host page's client — or make a
   second GoTrue client and fight it for the auth lock — the dock reads
   the signed-in session out of localStorage and talks to PostgREST
   directly. That is the same trick audit/audit_supabase.js already uses,
   and it means this file can be dropped onto ANY page in the portal
   without caring what else that page loaded.

   WHO SEES WHAT
   -------------
   The dock obeys the same visibility rule as MJMNelos.pending(): the
   memberships on nelos/nelos_user_setting.html decide which modules —
   and which categories inside them — a person's cases come from. No
   membership rows anywhere means no restriction, and a Nelos admin
   always sees everything. Re-implemented here rather than imported for
   the same reason as the query above; shared_nelos.js scope() is the
   authority on the rule, so keep the two in step.

   Everything fails SOFT, exactly like the To-Do widget: no session, no
   table, no network, migration not run — the dock removes itself and
   the host page never notices. A floating button is not allowed to
   break a dashboard.
   ================================================================ */
(function () {
  'use strict';

  /* ── Where we are ────────────────────────────────────────────── */

  var THIS_SCRIPT = document.currentScript;
  var SRC = (THIS_SCRIPT && THIS_SCRIPT.getAttribute('src')) || '';

  /* Path back to the portal root, taken from our own src so the same
     one-line include works at any depth. 'shared/…' → we are at the
     root; '../shared/…' → one folder down. */
  var ROOT = SRC.replace(/shared\/shared_nelos_dock\.js.*$/, '');
  if (ROOT === SRC) ROOT = '../';               // unrecognised src, assume module page

  var OPT_SOURCE  = (THIS_SCRIPT && THIS_SCRIPT.getAttribute('data-source')) || '';
  var OPT_HIDE_ON = (THIS_SCRIPT && THIS_SCRIPT.getAttribute('data-hide-on')) || '';

  var LS_OPEN = 'mjm_nelos_dock_open';
  var LS_TAB  = 'mjm_nelos_dock_tab';

  var REFRESH_MS = 90000;      // background refresh while the page is open
  var LIMIT      = 40;

  /* ── Stand down quietly where the dock does not belong ───────── */

  //   • Nelos' own pages already ARE the case log.
  //   • Anything the host page marks off with window.NELOS_DOCK_OFF.
  //   • Whatever data-hide-on names (customer-facing pages, kiosks…).
  function unwanted() {
    if (window.NELOS_DOCK_OFF) return true;
    var p = location.pathname || '';
    if (p.indexOf('/nelos/') !== -1 || p.indexOf('nelos_') !== -1) return true;
    if (OPT_HIDE_ON && p.indexOf(OPT_HIDE_ON) !== -1) return true;
    return false;
  }

  /* ── Supabase config ─────────────────────────────────────────── */

  /* shared_supabase.js and audit_supabase.js both declare their config
     with `const` at the top level of a classic script, which makes it a
     global LEXICAL binding — readable by name, but not a property of
     window. An indirect eval reads it without a ReferenceError blowing
     up this file when the page never loaded either one. */
  function globalConst(name) {
    try { return (0, eval)(name); } catch (_) { return undefined; }
  }

  function config() {
    var url = globalConst('SHARED_SUPA_URL') || globalConst('SUPA_URL') || globalConst('SUPABASE_URL');
    var key = globalConst('SHARED_SUPA_KEY') || globalConst('SUPA_KEY') || globalConst('SUPABASE_KEY');
    return (url && key) ? { url: String(url), key: String(key) } : null;
  }

  /* Pages that carry no Supabase config of their own still get a dock:
     pull in shared_supabase.js and carry on. */
  function loadConfig() {
    return new Promise(function (resolve) {
      var c = config();
      if (c) return resolve(c);
      var s = document.createElement('script');
      s.src = ROOT + 'shared/shared_supabase.js';
      s.onload  = function () { resolve(config()); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
  }

  /* ── The signed-in session, straight from storage ────────────── */

  var CFG = null;
  var _refreshing = null;

  function authKey() {
    var ref = CFG.url.replace(/^https:\/\//, '').split('.')[0];
    return 'sb-' + ref + '-auth-token';
  }

  function storedSession() {
    try {
      var raw = JSON.parse(localStorage.getItem(authKey()) || 'null');
      if (!raw) return null;
      return raw.currentSession || raw;      // v1 wrapped it, v2 does not
    } catch (_) { return null; }
  }

  function me() {
    var s = storedSession();
    var u = s && s.user;
    if (!u) return { id: null, name: null, email: null };
    return {
      id: u.id || null,
      name: (u.user_metadata && u.user_metadata.full_name) || u.email || null,
      email: u.email || null
    };
  }

  /* The access token, refreshed if it has aged out. null when there is
     no usable session — which is how login pages end up with no dock. */
  async function accessToken() {
    var s = storedSession();
    if (!s || !s.access_token) return null;

    var expiresAt = (s.expires_at || 0) * 1000;
    if (!expiresAt || expiresAt - Date.now() > 60000) return s.access_token;
    if (!s.refresh_token) return null;

    if (!_refreshing) {
      _refreshing = fetch(CFG.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'apikey': CFG.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token })
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (fresh) {
          if (!fresh || !fresh.access_token) return null;
          var next = Object.assign({}, s, fresh);
          next.expires_at = fresh.expires_at ||
            Math.floor(Date.now() / 1000) + (fresh.expires_in || 3600);
          try { localStorage.setItem(authKey(), JSON.stringify(next)); } catch (_) {}
          return next.access_token;
        })
        .catch(function () { return null; })
        .finally(function () { _refreshing = null; });
    }
    return _refreshing;
  }

  /* ── Reading the pending cases ───────────────────────────────── */

  var PENDING_COLS = 'id,case_no,title,category,priority,status,source_module,nursery_name,' +
                     'plot_name,batch_name,assignee_id,assignee_name,due_date,created_at';

  var PRIORITY_RANK  = { urgent: 0, high: 1, normal: 2, low: 3 };
  var PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
  /* Labels for the chip on each line. The live ones are rows in
     nelos_modules, which the User Setting page can rename.

     On a page that also loads shared_nelos.js, borrow its map rather than
     keeping a second copy — two hand-maintained copies had already drifted
     apart once, leaving the dock saying "AI Stock System" after the block
     was renamed. The literal below is only for the pages that load the
     dock alone. */
  var SOURCE_LABEL = (window.MJMNelos && window.MJMNelos.SOURCE_LABEL) || {
    operation: 'Seedling Stock System', nursery_ops: 'Nursery Operation',
    scan: 'FC Portal', mobile: 'Admin Portal', audit: 'Audit Portal',
    npayroll: 'Payroll', nelos: 'Nelos'
  };

  function authHeaders(token) {
    return { 'apikey': CFG.key, 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' };
  }

  /* ── Who sees which cases ────────────────────────────────────────
     Mirrors MJMNelos.scope(): memberships set on nelos_user_setting.html
     narrow a person to certain modules, and optionally to certain
     categories inside them. No rows at all → no restriction. A Nelos
     admin → no restriction, so nobody can lock themselves out of their
     own case log. Any failure yields the unrestricted scope, because a
     lookup that cannot run must not hide cases from anyone. */

  var _scope = null;

  async function isNelosAdmin(token) {
    // shared_access.js already knows, on the pages that load it.
    try {
      if (window.MJMAccess && window.MJMAccess.isAdminOf &&
          window.MJMAccess.isAdminOf('nelos')) return true;
    } catch (_) { /* fall through and ask the database */ }

    var u = me();
    if (!u.id) return false;
    try {
      // self_read_profile lets anyone signed in read their own row.
      var r = await fetch(CFG.url + '/rest/v1/shared_profiles?select=permissions&id=eq.' +
                          encodeURIComponent(u.id), { headers: authHeaders(token) });
      if (!r.ok) return false;
      var rows = await r.json();
      var perms = rows && rows[0] && rows[0].permissions;
      return !!(perms && perms.modules && perms.modules.nelos === 'admin');
    } catch (_) { return false; }
  }

  async function loadScope(token) {
    if (_scope) return _scope;
    var open = { unrestricted: true, modules: null, cats: null };

    if (await isNelosAdmin(token)) return (_scope = open);

    var u = me();
    var email = (u.email || '').toLowerCase();

    // Match on user_id and on email both, so someone added before they
    // ever signed in is still recognised. The or() list is comma
    // separated, so an address carrying a comma or a bracket would split
    // the filter into nonsense — those fall back to the user_id match.
    // Everything else is percent-encoded, so a '+' in an address stays a
    // '+' rather than arriving as a space.
    var ors = [];
    if (u.id) ors.push('user_id.eq.' + encodeURIComponent(u.id));
    if (email && !/[,()"\\]/.test(email)) ors.push('email.ilike.' + encodeURIComponent(email));
    if (!ors.length) return (_scope = open);

    try {
      var res = await fetch(CFG.url + '/rest/v1/nelos_module_members' +
                            '?select=module_key,categories&or=(' + ors.join(',') + ')',
                            { headers: authHeaders(token) });
      if (!res.ok) return (_scope = open);
      var rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) return (_scope = open);

      var modules = {};                 // module_key → true
      var cats = {};                    // module_key → { name: true }, or null for all
      rows.forEach(function (r) {
        modules[r.module_key] = true;
        var list = Array.isArray(r.categories) ? r.categories.filter(Boolean) : [];
        if (!list.length) { cats[r.module_key] = null; return; }   // every category
        if (cats[r.module_key] === null) return;                   // already unrestricted here
        cats[r.module_key] = cats[r.module_key] || {};
        list.forEach(function (c) { cats[r.module_key][c] = true; });
      });
      return (_scope = { unrestricted: false, modules: modules, cats: cats });
    } catch (_) {
      return (_scope = open);
    }
  }

  function inScope(c, sc) {
    if (!sc || sc.unrestricted) return true;
    if (!sc.modules[c.source_module]) return false;
    var allowed = sc.cats[c.source_module];
    if (allowed === null || allowed === undefined) return true;    // every category
    return !!c.category && !!allowed[c.category];
  }

  /* Returns { rows, error }. A 404 (table missing, migration not run yet)
     and a 401 (session gone stale) both come back as errors, and an error
     means the dock hides rather than shouting at the user. */
  async function fetchPending() {
    var token = await accessToken();
    if (!token) return { rows: [], error: 'no-session' };

    var q = CFG.url + '/rest/v1/nelos_cases' +
            '?select=' + encodeURIComponent(PENDING_COLS) +
            '&status=in.(open,in_progress)' +
            '&order=due_date.asc.nullslast,created_at.asc' +
            '&limit=' + LIMIT;
    if (OPT_SOURCE) q += '&source_module=eq.' + encodeURIComponent(OPT_SOURCE);

    try {
      var res = await fetch(q, { headers: authHeaders(token) });
      if (!res.ok) return { rows: [], error: 'http-' + res.status };
      var rows = await res.json();
      if (!Array.isArray(rows)) return { rows: [], error: 'shape' };
      // Priority is a word in the database, so worst-first is sorted here.
      rows.sort(function (a, b) {
        return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
      });
      // Narrow to what this person is set up to see (User Setting page).
      var sc = await loadScope(token);
      if (!sc.unrestricted) rows = rows.filter(function (c) { return inScope(c, sc); });
      return { rows: rows, error: null };
    } catch (e) {
      return { rows: [], error: 'network' };
    }
  }

  /* ── Look ────────────────────────────────────────────────────── */

  var CSS = `
  #nelos-dock, #nelos-dock * { box-sizing:border-box; font-family:'Outfit',system-ui,-apple-system,sans-serif; }
  #nelos-dock { position:fixed; right:18px; bottom:18px; z-index:2147483000;
                display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
  #nelos-dock[hidden] { display:none !important; }

  /* ── the round button ── */
  #nelos-dock-fab { position:relative; width:58px; height:58px; border:none; border-radius:50%;
                    cursor:pointer; padding:0; color:#fff; font-family:inherit;
                    background:linear-gradient(135deg,#7c3aed 0%,#a855f7 55%,#6d28d9 100%);
                    box-shadow:0 10px 26px rgba(109,40,217,.42), 0 2px 6px rgba(15,23,42,.2);
                    display:flex; align-items:center; justify-content:center;
                    transition:transform .18s ease, box-shadow .18s ease; }
  #nelos-dock-fab:hover  { transform:translateY(-2px) scale(1.04);
                           box-shadow:0 14px 32px rgba(109,40,217,.5), 0 3px 8px rgba(15,23,42,.24); }
  #nelos-dock-fab:active { transform:scale(.96); }
  #nelos-dock-fab .nd-mark { font-size:15px; font-weight:900; letter-spacing:.06em; line-height:1; }
  #nelos-dock-fab .nd-sub  { font-size:7px; font-weight:900; letter-spacing:.14em; opacity:.82; margin-top:2px; }
  #nelos-dock-fab .nd-stack { display:flex; flex-direction:column; align-items:center; }

  /* the count sitting on the shoulder of the circle */
  #nelos-dock-badge { position:absolute; top:-3px; right:-3px; min-width:23px; height:23px; padding:0 6px;
                      border-radius:999px; background:#dc2626; color:#fff; border:2.5px solid #fff;
                      font-size:11px; font-weight:900; line-height:1;
                      display:flex; align-items:center; justify-content:center; }
  #nelos-dock-badge.zero  { background:#16a34a; }
  #nelos-dock-badge.hot   { animation:nd-pulse 1.9s ease-in-out infinite; }
  #nelos-dock-badge[hidden]{ display:none; }
  @keyframes nd-pulse {
    0%,100% { box-shadow:0 0 0 0 rgba(220,38,38,.55); }
    70%     { box-shadow:0 0 0 9px rgba(220,38,38,0); }
  }

  /* ── the panel ── */
  #nelos-dock-panel { width:min(370px, calc(100vw - 30px)); max-height:min(70vh, 560px);
                      background:#fff; border:1.5px solid #ede9fe; border-radius:18px; overflow:hidden;
                      box-shadow:0 22px 55px rgba(15,23,42,.22); display:flex; flex-direction:column;
                      transform-origin:bottom right; animation:nd-in .18s ease-out; }
  #nelos-dock-panel[hidden] { display:none; }
  @keyframes nd-in { from { opacity:0; transform:translateY(10px) scale(.96); } to { opacity:1; transform:none; } }

  .nd-head { display:flex; align-items:center; gap:9px; padding:13px 14px 11px;
             background:linear-gradient(135deg,#7c3aed 0%,#8b5cf6 100%); color:#fff; }
  .nd-head-mark { width:29px; height:29px; border-radius:9px; background:rgba(255,255,255,.2);
                  display:flex; align-items:center; justify-content:center;
                  font-size:11px; font-weight:900; flex-shrink:0; }
  .nd-head-t  { font-size:13px; font-weight:900; letter-spacing:.12em; text-transform:uppercase; line-height:1.1; }
  .nd-head-s  { font-size:9px; font-weight:700; letter-spacing:.08em; opacity:.82; margin-top:1px; }
  .nd-min { margin-left:auto; width:28px; height:28px; border-radius:8px; border:none; cursor:pointer;
            background:rgba(255,255,255,.18); color:#fff; font-size:15px; font-weight:900; line-height:1;
            display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .nd-min:hover { background:rgba(255,255,255,.3); }

  .nd-tabs { display:flex; gap:6px; padding:10px 12px 8px; border-bottom:1px solid #f1f5f9; background:#faf5ff; }
  .nd-tab { flex:1; padding:6px 4px; border-radius:8px; border:1px solid transparent; cursor:pointer;
            background:transparent; font-family:inherit; font-size:9.5px; font-weight:900;
            letter-spacing:.07em; text-transform:uppercase; color:#7e22ce; }
  .nd-tab:hover    { background:#f3e8ff; }
  .nd-tab.on       { background:#fff; border-color:#ddd6fe; color:#5b21b6; box-shadow:0 1px 3px rgba(88,28,135,.12); }
  .nd-tab .nd-tab-n { font-weight:900; opacity:.65; margin-left:3px; }

  .nd-list { overflow-y:auto; flex:1; padding:4px 0; -webkit-overflow-scrolling:touch; }
  .nd-row { display:flex; align-items:flex-start; gap:9px; padding:10px 14px;
            border-bottom:1px dashed #f1f5f9; text-decoration:none; color:inherit; }
  .nd-row:last-child { border-bottom:none; }
  .nd-row:hover { background:#faf5ff; }
  .nd-dot { width:8px; height:8px; border-radius:50%; margin-top:5px; flex-shrink:0; }
  .nd-p-urgent { background:#dc2626; } .nd-p-high { background:#f97316; }
  .nd-p-normal { background:#0ea5e9; } .nd-p-low  { background:#94a3b8; }
  .nd-main  { min-width:0; flex:1; }
  .nd-title { font-size:12.5px; font-weight:700; color:#1e293b; line-height:1.35;
              display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .nd-meta  { font-size:9.5px; font-weight:600; color:#94a3b8; margin-top:3px; line-height:1.5; }
  .nd-chip  { display:inline-block; font-size:8.5px; font-weight:900; letter-spacing:.06em; text-transform:uppercase;
              padding:1px 6px; border-radius:5px; background:#f1f5f9; color:#64748b; margin-right:5px;
              max-width:100%; vertical-align:middle; }
  /* the due date and the owner read as one thing each, so they wrap
     whole rather than splitting across two lines */
  .nd-nw    { white-space:nowrap; }
  .nd-over  { color:#b91c1c; font-weight:900; white-space:nowrap; }
  .nd-empty { text-align:center; font-size:11.5px; font-weight:700; color:#94a3b8; padding:34px 16px; line-height:1.7; }

  .nd-foot { display:flex; gap:7px; padding:10px 12px; border-top:1px solid #f1f5f9; background:#fff; }
  .nd-btn  { flex:1; text-align:center; padding:9px 10px; border-radius:10px; text-decoration:none;
             font-size:9.5px; font-weight:900; letter-spacing:.07em; text-transform:uppercase; }
  .nd-btn-a { background:#7c3aed; color:#fff; }  .nd-btn-a:hover { background:#6d28d9; }
  .nd-btn-b { background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe; }
  .nd-btn-b:hover { background:#ede9fe; }

  @media (max-width:640px) {
    #nelos-dock { right:14px; bottom:14px; }
    #nelos-dock-fab { width:54px; height:54px; }
  }
  @media (prefers-reduced-motion:reduce) {
    #nelos-dock-fab, #nelos-dock-panel, #nelos-dock-badge { transition:none !important; animation:none !important; }
  }
  `;

  /* ── Rendering ───────────────────────────────────────────────── */

  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  var todayISO = function () { return new Date().toISOString().slice(0, 10); };
  var isOverdue = function (c) { return !!c.due_date && c.due_date < todayISO(); };

  function dueText(d) {
    if (!d) return '';
    var label;
    try {
      label = new Date(d + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
    } catch (_) { label = d; }
    return d < todayISO()
      ? '<span class="nd-over">⏰ overdue ' + esc(label) + '</span>'
      : '<span class="nd-nw">due ' + esc(label) + '</span>';
  }

  function caseHref(id) { return ROOT + 'nelos/nelos_case.html?id=' + encodeURIComponent(id); }
  function homeHref()   { return ROOT + 'nelos/nelos_dashboard.html'; }

  function rowHtml(c) {
    var subject = [c.batch_name && 'Batch ' + c.batch_name, c.plot_name, c.nursery_name]
      .filter(Boolean).join(' · ');
    var bits = [
      esc(c.case_no || ''),
      subject && esc(subject),
      c.assignee_name ? '<span class="nd-nw">→ ' + esc(c.assignee_name) + '</span>'
                      : '<em>unassigned</em>',
      dueText(c.due_date)
    ].filter(Boolean);
    return '<a class="nd-row" href="' + esc(caseHref(c.id)) + '">' +
             '<span class="nd-dot nd-p-' + esc(c.priority || 'normal') + '" ' +
                   'title="' + esc(PRIORITY_LABEL[c.priority] || '') + '"></span>' +
             '<span class="nd-main">' +
               '<span class="nd-title">' + esc(c.title) + '</span>' +
               '<span class="nd-meta">' +
                 '<span class="nd-chip">' + esc(SOURCE_LABEL[c.source_module] || c.source_module || '') + '</span>' +
                 bits.join(' · ') +
               '</span>' +
             '</span>' +
           '</a>';
  }

  var dock, fab, badge, panel, listEl, tabsEl;
  var rows = [], tab = 'all', open = false;

  function build() {
    var style = document.createElement('style');
    style.id = 'nelos-dock-css';
    style.textContent = CSS;
    document.head.appendChild(style);

    dock = document.createElement('div');
    dock.id = 'nelos-dock';
    dock.setAttribute('aria-live', 'polite');
    dock.innerHTML =
      '<div id="nelos-dock-panel" hidden role="dialog" aria-label="Nelos pending cases">' +
        '<div class="nd-head">' +
          '<div class="nd-head-mark">NL</div>' +
          '<div>' +
            '<div class="nd-head-t">Nelos</div>' +
            '<div class="nd-head-s">To-Do · Pending Cases</div>' +
          '</div>' +
          '<button class="nd-min" type="button" title="Minimise" aria-label="Minimise">&#8211;</button>' +
        '</div>' +
        '<div class="nd-tabs">' +
          '<button class="nd-tab on" type="button" data-tab="all">All<span class="nd-tab-n"></span></button>' +
          '<button class="nd-tab" type="button" data-tab="mine">Mine<span class="nd-tab-n"></span></button>' +
          '<button class="nd-tab" type="button" data-tab="overdue">Overdue<span class="nd-tab-n"></span></button>' +
        '</div>' +
        '<div class="nd-list"><div class="nd-empty">loading cases…</div></div>' +
        '<div class="nd-foot">' +
          '<a class="nd-btn nd-btn-b" href="' + esc(homeHref()) + '">Open Nelos →</a>' +
          '<a class="nd-btn nd-btn-a" href="' + esc(homeHref()) + '?new=1' +
             (OPT_SOURCE ? '&source=' + encodeURIComponent(OPT_SOURCE) : '') + '">➕ Raise a Case</a>' +
        '</div>' +
      '</div>' +
      '<button id="nelos-dock-fab" type="button" title="Nelos — pending cases" aria-label="Nelos — pending cases">' +
        '<span class="nd-stack"><span class="nd-mark">NL</span><span class="nd-sub">NELOS</span></span>' +
        '<span id="nelos-dock-badge" hidden>0</span>' +
      '</button>';
    document.body.appendChild(dock);

    fab    = dock.querySelector('#nelos-dock-fab');
    badge  = dock.querySelector('#nelos-dock-badge');
    panel  = dock.querySelector('#nelos-dock-panel');
    listEl = dock.querySelector('.nd-list');
    tabsEl = dock.querySelector('.nd-tabs');

    fab.addEventListener('click', function () { setOpen(!open); });
    dock.querySelector('.nd-min').addEventListener('click', function () { setOpen(false); });
    tabsEl.addEventListener('click', function (e) {
      var b = e.target.closest('.nd-tab');
      if (!b) return;
      tab = b.getAttribute('data-tab');
      try { localStorage.setItem(LS_TAB, tab); } catch (_) {}
      paint();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) setOpen(false);
    });
  }

  /* Expanded or minimised — remembered, so it carries across pages. */
  function setOpen(next) {
    open = !!next;
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    try { localStorage.setItem(LS_OPEN, open ? '1' : '0'); } catch (_) {}
    if (open) refresh();
  }

  function visible() {
    var mineId = me().id;
    if (tab === 'mine')    return rows.filter(function (c) { return mineId && c.assignee_id === mineId; });
    if (tab === 'overdue') return rows.filter(isOverdue);
    return rows;
  }

  function paint() {
    var mineId = me().id;
    var counts = {
      all: rows.length,
      mine: rows.filter(function (c) { return mineId && c.assignee_id === mineId; }).length,
      overdue: rows.filter(isOverdue).length
    };

    // Badge: the pending total, red, and pulsing when something is
    // overdue or urgent.
    var hot = counts.overdue > 0 || rows.some(function (c) { return c.priority === 'urgent'; });
    badge.hidden = false;
    badge.textContent = counts.all > 99 ? '99+' : String(counts.all);
    badge.className = (counts.all ? '' : 'zero') + (counts.all && hot ? ' hot' : '');

    Array.prototype.forEach.call(tabsEl.querySelectorAll('.nd-tab'), function (b) {
      var k = b.getAttribute('data-tab');
      b.classList.toggle('on', k === tab);
      b.querySelector('.nd-tab-n').textContent = counts[k] ? '(' + counts[k] + ')' : '';
    });

    var show = visible();
    listEl.innerHTML = show.length
      ? show.map(rowHtml).join('')
      : '<div class="nd-empty">' + (
          tab === 'mine'    ? 'Nothing assigned to you ✓' :
          tab === 'overdue' ? 'Nothing overdue ✓' :
                              'Nothing pending — all clear ✓'
        ) + '</div>';
  }

  /* ── Refresh loop ────────────────────────────────────────────── */

  var busy = false;
  var loaded = false;      // has the list ever come back cleanly?

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      var out = await fetchPending();
      if (out.error) {
        // No session, table missing, no rights — stand down for good.
        // (A stale session is the common one: the guard on the page will
        // be sending them to the login anyway.)
        if (out.error === 'no-session' || out.error === 'http-401' ||
            out.error === 'http-403'   || out.error === 'http-404') {
          dock.hidden = true;
          stopTimer();
          return;
        }
        // Transient — offline, a 5xx, a dropped connection. Keep whatever
        // is already on screen; if nothing ever loaded, show no button at
        // all rather than one that opens onto "loading…" forever. The
        // timer keeps running, so it appears by itself once the network
        // comes back.
        if (!loaded) dock.hidden = true;
        return;
      }
      loaded = true;
      dock.hidden = false;
      rows = out.rows;
      paint();
    } finally {
      busy = false;
    }
  }

  var timer = null;
  function startTimer() {
    stopTimer();
    timer = setInterval(function () {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MS);
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  /* ── Boot ────────────────────────────────────────────────────── */

  async function boot() {
    if (unwanted()) return;

    CFG = await loadConfig();
    if (!CFG) return;                       // no config anywhere — nothing to read
    if (!storedSession()) return;           // signed out: login pages get no dock

    build();

    try { tab  = localStorage.getItem(LS_TAB) || 'all'; } catch (_) {}
    try { open = localStorage.getItem(LS_OPEN) === '1'; } catch (_) {}
    if (['all', 'mine', 'overdue'].indexOf(tab) === -1) tab = 'all';
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');

    await refresh();
    startTimer();
    // Coming back to the tab, or back from another page, should show the
    // current state rather than whatever was pending ten minutes ago.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh();
    });
    window.addEventListener('focus', function () { refresh(); });
  }

  /* Public handle, for the rare page that wants to nudge the dock after
     it raises a case of its own: window.NelosDock.refresh() */
  window.NelosDock = {
    refresh: function () { if (dock) refresh(); },
    open:    function () { if (dock) setOpen(true); },
    close:   function () { if (dock) setOpen(false); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
