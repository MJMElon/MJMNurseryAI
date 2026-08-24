/* ================================================================
   MJM AI POWERED SYSTEM — NELOS FLOATING DOCK
   shared/shared_nelos_dock.js

   The round Nelos button that follows the user around the portal.

   Every page that loads this file gets a small floating circle with the
   number of cases waiting on THAT PERSON on it. Tap it and it expands
   into their To-Do list — overdue pinned at the top, then the rest,
   each row a link straight into nelos/nelos_case.html. Tap the minus
   and it shrinks back to the circle.

   It is deliberately ONE list, not a set of tabs: overdue first and
   pinned there, then what has my name on it, then the rest of my home
   module's queue. Every case, every status and every filter live one
   tap away on "Open Nelos →" — the dock is a reminder, not a second
   dashboard.

   The circle can be dragged anywhere on the screen and the panel can be
   dragged bigger by its corner grip. Where it sits, how big it is and
   whether it was left open all live in localStorage, so it stays put as
   the user moves from Stock to Audit to Payroll.

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
   home module pinned on nelos/nelos_user_setting.html decides whose
   queue a person sees, plus anything assigned to them personally in any
   queue. Not pinned, or a Nelos admin, means no restriction.
   Re-implemented here rather than imported for the same reason as the
   query above; shared_nelos.js scope() is the authority on the rule, so
   keep the two in step.

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
  var LS_POS  = 'mjm_nelos_dock_pos';      // where the user parked the circle
  var LS_SIZE = 'mjm_nelos_dock_size';     // how big they dragged the panel

  var REFRESH_MS = 90000;      // background refresh while the page is open
  var LIMIT      = 60;

  var GAP    = 10;             // circle ↔ panel
  var EDGE   = 8;              // closest the circle may sit to a screen edge
  var MIN_W  = 280, MIN_H = 220;
  var DEF_W  = 370, DEF_H = 0; // 0 = let the content decide, up to the max

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

  /* ── Reading my pending cases ────────────────────────────────── */

  var PENDING_COLS = 'id,case_no,title,category,priority,status,source_module,assigned_module,nursery_name,' +
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
     Mirrors MJMNelos.scope(). A person is pinned to one home module on
     nelos_user_setting.html, and from that pin sees their home module's
     QUEUE (assigned_module) wherever they are, plus anything assigned to
     them personally in any queue — which is exactly why this dock is
     worth having on every page. Optional category narrowing applies to
     the queue, never to a case with your name on it.

     Not pinned → no restriction, so a new grantee is not met by an empty
     dock. Nelos admin → no restriction, so nobody can lock themselves
     out. Any failure yields the unrestricted scope, because a lookup
     that cannot run must not hide cases from anyone.

     This reads over one RPC rather than the two round trips the
     membership version needed. */

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
    var open = { unrestricted: true, home: null, cats: null, userId: null };

    if (await isNelosAdmin(token)) return (_scope = open);

    var u = me();
    if (!u.id) return (_scope = open);

    try {
      // nelos_my_scope() answers only for the caller, so an ordinary user
      // can read their own pin — nelos_people() is admin-only.
      var res = await fetch(CFG.url + '/rest/v1/rpc/nelos_my_scope', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(token)),
        body: '{}'
      });
      if (!res.ok) return (_scope = open);
      var rows = await res.json();
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return (_scope = open);
      if (row.is_admin) return (_scope = open);
      if (!row.primary_module) return (_scope = open);     // not pinned yet

      var list = Array.isArray(row.categories) ? row.categories.filter(Boolean) : [];
      var cats = null;
      if (list.length) { cats = {}; list.forEach(function (c) { cats[c] = true; }); }
      return (_scope = {
        unrestricted: false,
        home: row.primary_module,
        cats: cats,
        userId: u.id
      });
    } catch (_) {
      return (_scope = open);
    }
  }

  function queueOf(c) { return c.assigned_module || c.source_module; }

  function inScope(c, sc) {
    if (!sc || sc.unrestricted) return true;
    // Assigned to me — mine wherever it sits, and never category-filtered.
    if (sc.userId && c.assignee_id && c.assignee_id === sc.userId) return true;
    if (queueOf(c) !== sc.home) return false;
    if (!sc.cats) return true;                                     // every category
    return !!c.category && !!sc.cats[c.category];
  }

  /* Returns { rows, error }. A 404 (table missing, migration not run yet)
     and a 401 (session gone stale) both come back as errors, and an error
     means the dock hides rather than shouting at the user. */
  async function fetchPending() {
    var token = await accessToken();
    if (!token) return { rows: [], error: 'no-session' };

    if (!me().id) return { rows: [], error: 'no-session' };

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
  /* Parked in the top half → the panel hangs below the circle instead
     of above it; parked on the left → everything aligns left. */
  #nelos-dock.nd-below { flex-direction:column-reverse; }
  #nelos-dock.nd-left  { align-items:flex-start; }
  #nelos-dock.nd-busy  { user-select:none; -webkit-user-select:none; }

  /* ── the round button ── */
  #nelos-dock-fab { position:relative; width:58px; height:58px; border:none; border-radius:50%;
                    cursor:grab; padding:0; color:#fff; font-family:inherit; touch-action:none;
                    background:linear-gradient(135deg,#7c3aed 0%,#a855f7 55%,#6d28d9 100%);
                    box-shadow:0 10px 26px rgba(109,40,217,.42), 0 2px 6px rgba(15,23,42,.2);
                    display:flex; align-items:center; justify-content:center;
                    transition:transform .18s ease, box-shadow .18s ease; }
  #nelos-dock-fab:hover  { transform:translateY(-2px) scale(1.04);
                           box-shadow:0 14px 32px rgba(109,40,217,.5), 0 3px 8px rgba(15,23,42,.24); }
  #nelos-dock-fab:active { transform:scale(.96); }
  #nelos-dock.nd-busy #nelos-dock-fab { cursor:grabbing; transform:scale(1.06);
                                        box-shadow:0 18px 38px rgba(109,40,217,.55); transition:none; }
  #nelos-dock-fab .nd-mark { font-size:15px; font-weight:900; letter-spacing:.06em; line-height:1; }
  #nelos-dock-fab .nd-sub  { font-size:7px; font-weight:900; letter-spacing:.14em; opacity:.82; margin-top:2px; }
  #nelos-dock-fab .nd-stack { display:flex; flex-direction:column; align-items:center; pointer-events:none; }

  /* the count sitting on the shoulder of the circle */
  #nelos-dock-badge { position:absolute; top:-3px; right:-3px; min-width:23px; height:23px; padding:0 6px;
                      border-radius:999px; background:#dc2626; color:#fff; border:2.5px solid #fff;
                      font-size:11px; font-weight:900; line-height:1; pointer-events:none;
                      display:flex; align-items:center; justify-content:center; }
  #nelos-dock-badge.zero  { background:#16a34a; }
  #nelos-dock-badge.hot   { animation:nd-pulse 1.9s ease-in-out infinite; }
  #nelos-dock-badge[hidden]{ display:none; }
  @keyframes nd-pulse {
    0%,100% { box-shadow:0 0 0 0 rgba(220,38,38,.55); }
    70%     { box-shadow:0 0 0 9px rgba(220,38,38,0); }
  }

  /* ── the panel ── */
  #nelos-dock-panel { position:relative; width:370px; max-width:calc(100vw - 24px); max-height:min(70vh,560px);
                      background:#fff; border:1.5px solid #ede9fe; border-radius:18px; overflow:hidden;
                      box-shadow:0 22px 55px rgba(15,23,42,.22); display:flex; flex-direction:column; }
  #nelos-dock-panel[hidden] { display:none; }
  #nelos-dock-panel.nd-in { animation:nd-in .18s ease-out; }
  @keyframes nd-in { from { opacity:0; transform:translateY(10px) scale(.96); } to { opacity:1; transform:none; } }

  .nd-head { display:flex; align-items:center; gap:9px; padding:13px 14px 11px;
             background:linear-gradient(135deg,#7c3aed 0%,#8b5cf6 100%); color:#fff; flex-shrink:0; }
  .nd-head-mark { width:29px; height:29px; border-radius:9px; background:rgba(255,255,255,.2);
                  display:flex; align-items:center; justify-content:center;
                  font-size:11px; font-weight:900; flex-shrink:0; }
  .nd-head-t  { font-size:13px; font-weight:900; letter-spacing:.12em; text-transform:uppercase; line-height:1.1; }
  .nd-head-s  { font-size:9px; font-weight:700; letter-spacing:.08em; opacity:.82; margin-top:1px; }
  .nd-min { margin-left:auto; width:28px; height:28px; border-radius:8px; border:none; cursor:pointer;
            background:rgba(255,255,255,.18); color:#fff; font-size:15px; font-weight:900; line-height:1;
            display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .nd-min:hover { background:rgba(255,255,255,.3); }

  .nd-list { overflow-y:auto; flex:1; padding:0 0 4px; -webkit-overflow-scrolling:touch; }

  /* the overdue block, pinned to the top of the scroll */
  .nd-sec { padding:7px 14px 5px; font-size:9px; font-weight:900; letter-spacing:.1em; text-transform:uppercase;
            color:#94a3b8; background:#fff; }
  .nd-sec-over { position:sticky; top:0; z-index:2; color:#b91c1c; background:#fef2f2;
                 border-bottom:1px solid #fee2e2; padding:7px 14px; }

  .nd-row { display:flex; align-items:flex-start; gap:9px; padding:10px 14px;
            border-bottom:1px dashed #f1f5f9; text-decoration:none; color:inherit; }
  .nd-row:last-child { border-bottom:none; }
  .nd-row:hover { background:#faf5ff; }
  .nd-row-over { background:#fffbfb; }
  .nd-row-over:hover { background:#fef2f2; }
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

  .nd-foot { display:flex; gap:7px; padding:10px 12px; border-top:1px solid #f1f5f9; background:#fff; flex-shrink:0; }
  .nd-btn  { flex:1; text-align:center; padding:9px 10px; border-radius:10px; text-decoration:none;
             font-size:9.5px; font-weight:900; letter-spacing:.07em; text-transform:uppercase; }
  .nd-btn-a { background:#7c3aed; color:#fff; }  .nd-btn-a:hover { background:#6d28d9; }
  .nd-btn-b { background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe; }
  .nd-btn-b:hover { background:#ede9fe; }

  /* ── the resize grip ──
     It sits on whichever corner of the panel is pointing AWAY from the
     circle, so dragging it outward always means bigger. */
  .nd-grip { position:absolute; width:22px; height:22px; z-index:3; touch-action:none;
             cursor:nwse-resize; opacity:.55; }
  .nd-grip:hover { opacity:1; }
  .nd-grip::after { content:''; position:absolute; inset:5px;
                    border-top:2px solid currentColor; border-left:2px solid currentColor;
                    border-radius:3px 0 0 0; }
  #nelos-dock .nd-grip { top:2px; left:2px; color:#fff; }                                  /* panel above, right-aligned */
  #nelos-dock.nd-left  .nd-grip { left:auto; right:2px; cursor:nesw-resize; transform:scaleX(-1); }
  #nelos-dock.nd-below .nd-grip { top:auto; bottom:2px; color:#94a3b8; cursor:nesw-resize; transform:scaleY(-1); }
  #nelos-dock.nd-below.nd-left .nd-grip { cursor:nwse-resize; transform:scale(-1,-1); }

  @media (max-width:640px) {
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
    return '<a class="nd-row' + (isOverdue(c) ? ' nd-row-over' : '') + '" href="' + esc(caseHref(c.id)) + '">' +
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

  var dock, fab, badge, panel, listEl, grip;
  var rows = [], open = false;

  function build() {
    var style = document.createElement('style');
    style.id = 'nelos-dock-css';
    style.textContent = CSS;
    document.head.appendChild(style);

    dock = document.createElement('div');
    dock.id = 'nelos-dock';
    dock.setAttribute('aria-live', 'polite');
    dock.innerHTML =
      '<div id="nelos-dock-panel" hidden role="dialog" aria-label="My Nelos to-do list">' +
        '<div class="nd-grip" title="Drag to resize"></div>' +
        '<div class="nd-head">' +
          '<div class="nd-head-mark">NL</div>' +
          '<div>' +
            '<div class="nd-head-t">My To-Do</div>' +
            '<div class="nd-head-s">Nelos · Pending on me</div>' +
          '</div>' +
          '<button class="nd-min" type="button" title="Minimise" aria-label="Minimise">&#8211;</button>' +
        '</div>' +
        '<div class="nd-list"><div class="nd-empty">loading cases…</div></div>' +
        '<div class="nd-foot">' +
          '<a class="nd-btn nd-btn-b" href="' + esc(homeHref()) + '">Open Nelos →</a>' +
          '<a class="nd-btn nd-btn-a" href="' + esc(homeHref()) + '?new=1' +
             (OPT_SOURCE ? '&source=' + encodeURIComponent(OPT_SOURCE) : '') + '">➕ Raise a Case</a>' +
        '</div>' +
      '</div>' +
      '<button id="nelos-dock-fab" type="button" title="Nelos — my to-do (drag to move)" ' +
              'aria-label="Nelos — my to-do">' +
        '<span class="nd-stack"><span class="nd-mark">NL</span><span class="nd-sub">NELOS</span></span>' +
        '<span id="nelos-dock-badge" hidden>0</span>' +
      '</button>';
    document.body.appendChild(dock);

    fab    = dock.querySelector('#nelos-dock-fab');
    badge  = dock.querySelector('#nelos-dock-badge');
    panel  = dock.querySelector('#nelos-dock-panel');
    listEl = dock.querySelector('.nd-list');
    grip   = dock.querySelector('.nd-grip');

    fab.addEventListener('click', function (e) {
      // A drag that ended on the circle is not a tap.
      if (fab.dataset.ndDragged === '1') { fab.dataset.ndDragged = '0'; e.preventDefault(); return; }
      setOpen(!open);
    });
    dock.querySelector('.nd-min').addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) setOpen(false);
    });

    wireDrag();
    wireResize();
    window.addEventListener('resize', function () { applyPos(pos, true); });
  }

  /* Expanded or minimised — remembered, so it carries across pages. */
  var _inTimer = null;

  function setOpen(next) {
    open = !!next;
    panel.hidden = !open;
    if (open) {
      panel.classList.add('nd-in');
      clearTimeout(_inTimer);
      _inTimer = setTimeout(function () { panel.classList.remove('nd-in'); }, 260);
    }
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    try { localStorage.setItem(LS_OPEN, open ? '1' : '0'); } catch (_) {}
    if (open) { applyPos(pos); refresh(); }
  }

  /* ── Where the circle is parked ──────────────────────────────────
     Stored as the distance to the two nearest edges, so the dock keeps
     its corner when the window changes size. nd-below / nd-left then
     decide which way the panel opens out of it. */

  var pos = null;      // { ex:'right'|'left', x, ey:'bottom'|'top', y }

  function defaultPos() { return { ex: 'right', x: 18, ey: 'bottom', y: 18 }; }

  function loadPos() {
    try {
      var p = JSON.parse(localStorage.getItem(LS_POS) || 'null');
      if (p && (p.ex === 'left' || p.ex === 'right') && (p.ey === 'top' || p.ey === 'bottom') &&
          isFinite(p.x) && isFinite(p.y)) return p;
    } catch (_) {}
    return defaultPos();
  }

  function savePos(p) { try { localStorage.setItem(LS_POS, JSON.stringify(p)); } catch (_) {} }

  /* Keep the circle on screen and give the panel the room that is left. */
  function applyPos(p, clampOnly) {
    if (!p) p = defaultPos();
    var vw = window.innerWidth, vh = window.innerHeight;
    var fw = fab.offsetWidth || 58, fh = fab.offsetHeight || 58;

    p.x = Math.max(EDGE, Math.min(p.x, Math.max(EDGE, vw - fw - EDGE)));
    p.y = Math.max(EDGE, Math.min(p.y, Math.max(EDGE, vh - fh - EDGE)));
    pos = p;

    dock.style.left   = p.ex === 'left'   ? p.x + 'px' : 'auto';
    dock.style.right  = p.ex === 'right'  ? p.x + 'px' : 'auto';
    dock.style.top    = p.ey === 'top'    ? p.y + 'px' : 'auto';
    dock.style.bottom = p.ey === 'bottom' ? p.y + 'px' : 'auto';
    dock.classList.toggle('nd-left',  p.ex === 'left');
    dock.classList.toggle('nd-below', p.ey === 'top');

    // The panel may only use the space between the circle and the far
    // side of the screen.
    var availH = Math.max(MIN_H, vh - p.y - fh - GAP - 12);
    var availW = Math.max(MIN_W, vw - p.x - 12);
    panel.style.maxHeight = Math.min(availH, vh - 24) + 'px';
    panel.style.maxWidth  = Math.min(availW, vw - 24) + 'px';

    if (!clampOnly) savePos(p);
  }

  /* The corner-to-corner anchor for a circle sitting at this rectangle. */
  function anchorFor(left, top) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var fw = fab.offsetWidth || 58, fh = fab.offsetHeight || 58;
    var cx = left + fw / 2, cy = top + fh / 2;
    return {
      ex: cx > vw / 2 ? 'right' : 'left',
      x:  cx > vw / 2 ? vw - (left + fw) : left,
      ey: cy > vh / 2 ? 'bottom' : 'top',
      y:  cy > vh / 2 ? vh - (top + fh) : top
    };
  }

  /* ── Dragging the circle ─────────────────────────────────────── */

  function wireDrag() {
    var dragging = false, moved = false, grabX = 0, grabY = 0;

    fab.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) return;
      var r = fab.getBoundingClientRect();
      grabX = e.clientX - r.left;
      grabY = e.clientY - r.top;
      dragging = true; moved = false;
      fab.dataset.ndDragged = '0';
      try { fab.setPointerCapture(e.pointerId); } catch (_) {}
    });

    fab.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var left = e.clientX - grabX, top = e.clientY - grabY;
      if (!moved) {
        // A few pixels of slop, so a tap with a shaky finger still opens
        // the panel instead of nudging the circle.
        var r = fab.getBoundingClientRect();
        if (Math.abs(left - r.left) < 4 && Math.abs(top - r.top) < 4) return;
        moved = true;
        dock.classList.add('nd-busy');
      }
      e.preventDefault();
      applyPos(anchorFor(left, top), true);
    });

    function end(e) {
      if (!dragging) return;
      dragging = false;
      dock.classList.remove('nd-busy');
      try { fab.releasePointerCapture(e.pointerId); } catch (_) {}
      if (moved) {
        fab.dataset.ndDragged = '1';       // swallow the click that follows
        applyPos(pos);                     // clamp + save where it landed
      }
    }
    fab.addEventListener('pointerup', end);
    fab.addEventListener('pointercancel', end);
  }

  /* ── Dragging the panel bigger ───────────────────────────────── */

  var size = null;     // { w, h } once the user has resized it

  function loadSize() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_SIZE) || 'null');
      if (s && isFinite(s.w) && isFinite(s.h) && s.w >= MIN_W && s.h >= MIN_H) return s;
    } catch (_) {}
    return null;
  }

  function applySize(s) {
    size = s;
    if (!s) { panel.style.width = DEF_W + 'px'; panel.style.height = ''; return; }
    panel.style.width  = s.w + 'px';
    panel.style.height = s.h + 'px';
  }

  function wireResize() {
    var sizing = false, sx = 0, sy = 0, sw = 0, sh = 0, signX = -1, signY = -1, live = null;

    grip.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) return;
      var r = panel.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sw = r.width; sh = r.height; live = null;
      // The grip is on the corner facing away from the circle, so which
      // way "bigger" runs depends on where the dock is parked.
      signX = dock.classList.contains('nd-left')  ? 1 : -1;
      signY = dock.classList.contains('nd-below') ? 1 : -1;
      sizing = true;
      dock.classList.add('nd-busy');
      try { grip.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault(); e.stopPropagation();
    });

    grip.addEventListener('pointermove', function (e) {
      if (!sizing) return;
      e.preventDefault();
      var vw = window.innerWidth, vh = window.innerHeight;
      var w = sw + signX * (e.clientX - sx);
      var h = sh + signY * (e.clientY - sy);
      live = {
        w: Math.round(Math.max(MIN_W, Math.min(w, vw - 24))),
        h: Math.round(Math.max(MIN_H, Math.min(h, vh - 24)))
      };
      panel.style.width  = live.w + 'px';
      panel.style.height = live.h + 'px';
    });

    function end(e) {
      if (!sizing) return;
      sizing = false;
      dock.classList.remove('nd-busy');
      try { grip.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!live) return;                    // pressed the grip but never moved
      size = live; live = null;
      try { localStorage.setItem(LS_SIZE, JSON.stringify(size)); } catch (_) {}
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  /* ── The list ────────────────────────────────────────────────── */

  /* One list, in the order the day is actually worked:

       ⏰ Overdue          — pinned to the top of the scroll, so it stays
                             in sight however far down you are
       Assigned to me      — my name on it, not yet late
       Other pending cases — the rest of what this person is scoped to
                             see (their home module's queue; everything,
                             for a Nelos admin)

     No tabs. Every case, every status and every filter is one tap away
     on "Open Nelos →", and that is where they belong. */
  function paint() {
    var uid = me().id;
    var mine = function (c) { return !!uid && c.assignee_id === uid; };

    var over  = rows.filter(isOverdue);
    var rest  = rows.filter(function (c) { return !isOverdue(c); });
    var restM = rest.filter(mine);
    var restO = rest.filter(function (c) { return !mine(c); });

    // Badge: how much is on this person's plate, red and pulsing when
    // any of it is late or urgent.
    var hot = over.length > 0 || rows.some(function (c) { return c.priority === 'urgent'; });
    badge.hidden = false;
    badge.textContent = rows.length > 99 ? '99+' : String(rows.length);
    badge.className = (rows.length ? '' : 'zero') + (rows.length && hot ? ' hot' : '');

    if (!rows.length) {
      listEl.innerHTML = '<div class="nd-empty">Nothing pending for you ✓<br>' +
                         'Open Nelos to see every case.</div>';
      return;
    }

    // A heading only earns its place when there is more than one group.
    var groups = [over.length, restM.length, restO.length].filter(Boolean).length;
    var head = function (cls, text) { return groups > 1 ? '<div class="nd-sec ' + cls + '">' + text + '</div>' : ''; };

    var html = '';
    if (over.length) {
      // Overdue rides at the top of the scroll and stays there. It is
      // sticky rather than merely first, so scrolling never buries it.
      html += '<div class="nd-sec nd-sec-over">⏰ Overdue · ' + over.length + '</div>' +
              over.map(rowHtml).join('');
    }
    if (restM.length) html += head('', 'Assigned to me · ' + restM.length) + restM.map(rowHtml).join('');
    if (restO.length) html += head('', 'Other pending cases · ' + restO.length) + restO.map(rowHtml).join('');
    listEl.innerHTML = html;
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

    try { open = localStorage.getItem(LS_OPEN) === '1'; } catch (_) {}
    applySize(loadSize());
    applyPos(loadPos(), true);
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
    close:   function () { if (dock) setOpen(false); },
    /* Back to the bottom-right corner at its default size, for a circle
       someone has parked somewhere unhelpful. */
    reset:   function () {
      try { localStorage.removeItem(LS_POS); localStorage.removeItem(LS_SIZE); } catch (_) {}
      if (!dock) return;
      applySize(null);
      applyPos(defaultPos());
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
