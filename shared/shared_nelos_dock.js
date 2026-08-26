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

   "Raise a Case" opens a short form INSIDE the panel and writes the
   case from there. Somebody notices something wrong halfway through a
   delivery note or an audit; sending them to another page to report it
   loses their work, and usually the thought with it. The case records
   the page it was raised from, so whoever picks it up lands where it
   was seen.

   The circle can be dragged anywhere on the screen and the panel can be
   dragged bigger by its corner grip. Where it sits, how big it is and
   whether it was left open all live in localStorage, so it stays put as
   the user moves from Stock to Audit to Payroll.

   Usage — one line, anywhere in the page, no markup and no init call:

     <script src="../shared/shared_nelos_dock.js"></script>     (module page)
     <script src="shared/shared_nelos_dock.js"></script>        (portal root)

   Optional attributes on that same tag:

     data-source="operation"   only cases raised by one module, and the
                               module stamped on cases raised from here
                               (otherwise taken from the page's folder)
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
   The dock obeys the same visibility rule as MJMNelos.pending(): a
   person is pinned on nelos/nelos_user_setting.html to a home system and
   numbered inside it, and sees that system's queue plus anything assigned
   to them personally, minus anything routed to a different number.
   Not tagged means no restriction, a Nelos admin always sees everything,
   and so does anyone tagged to an HQ system (nelos_modules.sees_all_cases
   — Nursery Operation by default). Re-implemented here rather than imported for the same
   reason as the query above; shared_nelos.js scope() is the authority on
   the rule, so keep the two in step.

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
  /* The dock is not allowed to break a host page, so every failure ends
     in it quietly removing itself. Quietly is right for the user and
     miserable for whoever has to work out where it went — so each
     stand-down leaves exactly one line in the console. */
  var _warned = {};
  function warn(msg) {
    if (_warned[msg]) return;
    _warned[msg] = true;
    try { console.warn('[NelosDock] ' + msg); } catch (_) {}
  }

  function unwanted() {
    if (window.NELOS_DOCK_OFF) return true;
    var p = location.pathname || '';
    if (p.indexOf('/nelos/') !== -1 || p.indexOf('nelos_') !== -1) return true;
    if (OPT_HIDE_ON && p.indexOf(OPT_HIDE_ON) !== -1) return true;
    return false;
  }

  /* ── IS A LOGIN ON SCREEN? ───────────────────────────────────────
     A stored session is not the same as being signed in to the page.
     The hub shows its sign-in over the same URL as the module grid —
     it gates on a per-tab flag, not on the Supabase session — so a
     returning visitor with a live token still meets the login screen,
     and a floating to-do circle over it looks like a bug.

     Any page can say so by marking its login element
     data-login-screen; #auth-screen is recognised too, because that is
     what the hub already calls it. */
  function loginOnScreen() {
    var el = document.querySelector('[data-login-screen]') ||
             document.getElementById('auth-screen');
    if (!el || el.hidden) return false;
    var cs;
    try { cs = getComputedStyle(el); } catch (_) { return false; }
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null;
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

  /* Two column sets, because the dock ships ahead of the SQL.

     BASE_COLS is everything migration_nelos.sql created — the columns
     every database with a case log has. ROUTED_COLS adds what the later
     routing and seat migrations bring. Asking for a column the database
     does not have is not a soft failure in PostgREST: the whole select
     comes back 400 and nothing renders. So the dock asks for the routed
     set, and drops to the base set for the rest of the session the first
     time a database says it has never heard of those columns. A portal
     that has not run the migrations yet still gets its To-Do list; it
     simply does not get queue routing until the SQL is run. */
  var BASE_COLS   = 'id,case_no,title,category,priority,status,source_module,nursery_name,' +
                    'plot_name,batch_name,assignee_id,assignee_name,due_date,created_at,' +
                    'resolution,resolved_by,resolved_at';
  var ROUTED_COLS = BASE_COLS + ',assigned_module,assigned_seat_no';
  var _cols = ROUTED_COLS;      // narrowed to BASE_COLS on the first 400

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
     worth having on every page. A case routed to a named SEAT ("Admin 1")
     is only that seat's; one with no seat is the whole module's. Optional
     category narrowing applies to the queue, never to a case with your
     name on it.

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
    var u = me();
    var open = { unrestricted: true, home: null, cats: null, userId: u.id || null };

    if (await isNelosAdmin(token)) return (_scope = open);
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
      if (row.sees_all) return (_scope = open);            // HQ system

      // Kept in step with shared_nelos.js: never set up at all still sees
      // everything, but once there IS a handler row it governs, empty or
      // not. row.has_row arrives with migration_nelos_access.sql.
      if (row.has_row === false || (row.has_row === undefined && !row.primary_module)) {
        return (_scope = open);
      }

      var list = Array.isArray(row.categories) ? row.categories.filter(Boolean) : [];
      var cats = null;
      if (list.length) { cats = {}; list.forEach(function (c) { cats[c] = true; }); }
      // access_modules is deliberately NOT read here. A ticked system says
      // somebody may WORK in that queue; it does not hand them its cases.
      // The dock is one person's to-do list — see isMine() below.
      return (_scope = {
        unrestricted: false,
        home: row.primary_module || null,
        seatNo: (row.seat_no === undefined ? null : row.seat_no),
        cats: cats,
        userId: u.id
      });
    } catch (_) {
      return (_scope = open);
    }
  }

  function queueOf(c) { return c.assigned_module || c.source_module; }

  /* ── IS THIS MINE? ───────────────────────────────────────────────
     The dock is one person's to-do list, not their module's queue.
     That distinction only started mattering when the panel gained a
     Solve button: a list you can act on has to be a list of work that
     is actually yours, or the first thing it invites you to do is
     close somebody else's case.

     Two ways a case is yours:
       • it is assigned to you by name; or
       • nobody has taken it and it is routed to your seat, in your
         module, in a category you handle.

     A case assigned to somebody ELSE is never yours, however it is
     routed. And "sees everything" — a Nelos admin, an HQ system — is a
     permission, not a workload: it makes every case visible on the
     Nelos page, and none of them personally owed. Without that last
     rule an admin's to-do list is the whole company's. */
  function isMine(c, sc) {
    var uid = sc && sc.userId;
    if (c.assignee_id) return !!uid && String(c.assignee_id) === String(uid);
    if (!sc || sc.unrestricted) return false;
    if (!sc.home || queueOf(c) !== sc.home) return false;
    if (c.assigned_seat_no != null && c.assigned_seat_no !== sc.seatNo) return false;
    if (!sc.cats) return true;
    return !!c.category && !!sc.cats[c.category];
  }

  /* Returns { rows, error }. A 404 (table missing, migration not run yet)
     and a 401 (session gone stale) both come back as errors, and an error
     means the dock hides rather than shouting at the user. */
  /* statusIn: which statuses to ask for. The to-do list wants what is
     still owed; the history view wants what this person solved and
     nobody has closed yet. Everything else about the read — the column
     fallback, the priority sort, whose cases these are — is identical,
     so it is one function with one argument rather than two that drift. */
  async function fetchCases(statusIn, order) {
    var token = await accessToken();
    if (!token) return { rows: [], error: 'no-session' };

    if (!me().id) return { rows: [], error: 'no-session' };

    var query = function (cols) {
      var q = CFG.url + '/rest/v1/nelos_cases' +
              '?select=' + encodeURIComponent(cols) +
              '&status=in.(' + statusIn + ')' +
              '&order=' + (order || 'due_date.asc.nullslast,created_at.asc') +
              '&limit=' + LIMIT;
      if (OPT_SOURCE) q += '&source_module=eq.' + encodeURIComponent(OPT_SOURCE);
      return fetch(q, { headers: authHeaders(token) });
    };

    try {
      var res = await query(_cols);

      // 400 with the routed columns = this database has not run the
      // routing/seat migrations. Ask again for what it does have, once,
      // and stay on the base set from here on.
      if (res.status === 400 && _cols === ROUTED_COLS) {
        _cols = BASE_COLS;
        warn('nelos_cases has no routing columns yet — run shared/migration_nelos_routing.sql ' +
             'and shared/migration_nelos_seats.sql for queue routing. Showing the list without it.');
        res = await query(_cols);
      }

      if (!res.ok) return { rows: [], error: 'http-' + res.status };
      var rows = await res.json();
      if (!Array.isArray(rows)) return { rows: [], error: 'shape' };
      // Priority is a word in the database, so worst-first is sorted here.
      rows.sort(function (a, b) {
        return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
      });
      // Narrow to what this person is set up to see (User Setting page).
      var sc = await loadScope(token);
      rows = rows.filter(function (c) { return isMine(c, sc); });
      return { rows: rows, error: null };
    } catch (e) {
      return { rows: [], error: 'network' };
    }
  }

  function fetchPending()  { return fetchCases('open,in_progress'); }
  /* Solved most recently first — the useful order for "did mine land?",
     where the oldest resolved case is the least interesting row. */
  function fetchResolved() { return fetchCases('resolved', 'resolved_at.desc.nullslast'); }

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
                  display:flex; align-items:center; justify-content:center;
                  font-size:11px; font-weight:900; flex-shrink:0; }
  .nd-head-t  { font-size:13px; font-weight:900; letter-spacing:.12em; text-transform:uppercase; line-height:1.1; }
  .nd-min { margin-left:auto; width:28px; height:28px; border-radius:8px; border:none; cursor:pointer;
            background:rgba(255,255,255,.18); color:#fff; font-size:15px; font-weight:900; line-height:1;
            display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .nd-min:hover { background:rgba(255,255,255,.3); }

  .nd-list { overflow-y:auto; flex:1; padding:0 0 4px; -webkit-overflow-scrolling:touch; }
  .nd-list[hidden] { display:none; }

  /* the overdue block, pinned to the top of the scroll */
  .nd-sec { padding:7px 14px 5px; font-size:9px; font-weight:900; letter-spacing:.1em; text-transform:uppercase;
            color:#94a3b8; background:#fff; }
  .nd-sec-over { position:sticky; top:0; z-index:2; color:#b91c1c; background:#fef2f2;
                 border-bottom:1px solid #fee2e2; padding:7px 14px; }

  /* A button, not a link: the case opens in this panel. The reset is
     what a <button> needs to keep looking like the row it replaced. */
  .nd-row { display:flex; align-items:flex-start; gap:9px; padding:10px 14px;
            border-bottom:1px dashed #f1f5f9; text-decoration:none; color:inherit;
            width:100%; text-align:left; background:none; border-left:none;
            border-right:none; border-top:none; font-family:inherit;
            cursor:pointer; -webkit-tap-highlight-color:transparent; }
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

  /* ── raising a case, without leaving the page ── */
  .nd-form { overflow-y:auto; flex:1; padding:12px 14px 4px; -webkit-overflow-scrolling:touch; }
  .nd-form[hidden] { display:none; }
  .nd-lbl { display:block; font-size:9px; font-weight:900; letter-spacing:.1em; text-transform:uppercase;
            color:#94a3b8; margin:0 0 4px; }
  .nd-in  { width:100%; font-family:inherit; font-size:16px; font-weight:600; color:#1e293b;
            padding:9px 11px; border:1.5px solid #e2e8f0; border-radius:10px; background:#fff; outline:none; }
  .nd-in:focus { border-color:#c4b5fd; box-shadow:0 0 0 3px rgba(196,181,253,.3); }
  .nd-in::placeholder { color:#cbd5e1; font-weight:500; }
  textarea.nd-in { resize:none; line-height:1.45; }
  select.nd-in { appearance:none; background-image:linear-gradient(45deg,transparent 50%,#94a3b8 50%),
                                                  linear-gradient(135deg,#94a3b8 50%,transparent 50%);
                 background-position:calc(100% - 16px) 19px, calc(100% - 11px) 19px;
                 background-size:5px 5px, 5px 5px; background-repeat:no-repeat; padding-right:30px; }
  .nd-fld { margin-bottom:11px; }
  .nd-2   { display:flex; gap:8px; }
  .nd-2 > * { flex:1; min-width:0; }
  /* The date the case is being raised, under the panel's own heading. */
  .nd-today { font-size:10.5px; font-weight:800; letter-spacing:.04em; color:#94a3b8;
              margin:-2px 0 10px; }
  .nd-photo-pick { display:flex; align-items:center; justify-content:center; gap:8px;
                   padding:16px 12px; border:1.5px dashed #cbd5e1; border-radius:11px;
                   font-size:12px; font-weight:800; color:#64748b; cursor:pointer;
                   background:#f8fafc; }
  .nd-photo-pick:hover { border-color:#a78bfa; color:#6d28d9; }
  /* display:flex on the class outranks the browser's [hidden]{display:none},
     so hiding the picker behind a chosen photo needs saying explicitly. */
  .nd-photo-pick[hidden], .nd-photo[hidden] { display:none; }
  .nd-photo { position:relative; }
  .nd-photo img { width:100%; max-height:180px; object-fit:cover; border-radius:11px; display:block; }
  .nd-photo-x { position:absolute; top:7px; right:7px; width:26px; height:26px; border-radius:999px;
                border:none; background:rgba(15,23,42,.72); color:#fff; font-size:11px;
                font-weight:900; cursor:pointer; line-height:1; }
  .nd-in:disabled { background:#f8fafc; color:#94a3b8; cursor:not-allowed; }
  .nd-from { font-size:9.5px; font-weight:700; color:#94a3b8; line-height:1.5; padding:2px 2px 10px; }
  .nd-from b { color:#64748b; font-weight:900; }
  .nd-err { font-size:10.5px; font-weight:800; color:#b91c1c; background:#fef2f2; border:1px solid #fecaca;
            border-radius:9px; padding:8px 10px; margin-bottom:10px; line-height:1.5; }
  .nd-err[hidden] { display:none; }
  .nd-done { text-align:center; padding:30px 18px; }
  .nd-done-t { font-size:13px; font-weight:900; color:#15803d; margin-bottom:4px; }
  .nd-done-s { font-size:11px; font-weight:700; color:#94a3b8; line-height:1.6; }
  .nd-done a { color:#7c3aed; font-weight:900; text-decoration:none; }
  .nd-done a:hover { text-decoration:underline; }

  .nd-hist { width:26px; height:26px; margin-left:auto; margin-right:2px; padding:0;
             border:none; border-radius:8px; background:rgba(255,255,255,.16); color:#fff;
             cursor:pointer; display:flex; align-items:center; justify-content:center;
             flex-shrink:0; }
  .nd-hist:hover { background:rgba(255,255,255,.28); }
  .nd-hist svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.1;
                 stroke-linecap:round; stroke-linejoin:round; }
  .nd-hist.on { background:#fff; color:#6d28d9; }

  /* ── The solve block ──
     Under the case, not beside it: read what is being asked, then do
     it. A photo and a line of remark is the whole of what the field
     can add, and both are optional except the remark — a resolution
     nobody described is one nobody can check. */
  .nd-solve { margin-top:16px; border-top:1px solid #e9e3fb; padding-top:13px; }
  .nd-solve-h { font-size:10px; font-weight:900; letter-spacing:.09em; text-transform:uppercase;
                color:#6d28d9; margin-bottom:9px; }
  .nd-shot { display:flex; gap:8px; align-items:stretch; }
  .nd-shot label { flex:1; display:flex; flex-direction:column; align-items:center;
                   justify-content:center; gap:3px; min-height:64px; cursor:pointer;
                   border:1.5px dashed #ddd6fe; border-radius:11px; background:#faf8ff;
                   color:#7c3aed; font-size:11px; font-weight:800; }
  .nd-shot label:hover { background:#f5f3ff; border-color:#c4b5fd; }
  .nd-shot input[type=file] { display:none; }
  .nd-shot svg { width:19px; height:19px; fill:none; stroke:currentColor; stroke-width:1.9;
                 stroke-linecap:round; stroke-linejoin:round; }
  .nd-shot-prev { position:relative; flex:1; min-height:64px; border-radius:11px;
                  overflow:hidden; background:#f1f5f9; }
  .nd-shot-prev img { width:100%; height:100%; object-fit:cover; display:block; }
  .nd-shot-x { position:absolute; top:4px; right:4px; width:22px; height:22px; border:none;
               border-radius:50%; background:rgba(15,23,42,.62); color:#fff; cursor:pointer;
               font-size:13px; line-height:1; display:flex; align-items:center;
               justify-content:center; }
  .nd-solve textarea { width:100%; margin-top:9px; border:1px solid #e2e8f0; border-radius:10px;
                       padding:9px 10px; font-family:inherit; font-size:12.5px; color:#0f172a;
                       resize:vertical; min-height:64px; }
  .nd-solve textarea:focus { outline:none; border-color:#c4b5fd; box-shadow:0 0 0 3px #ede9fe; }
  .nd-solved-card { margin-top:14px; border:1px solid #bbf7d0; background:#f0fdf4;
                    border-radius:11px; padding:11px 12px; }
  .nd-solved-h { font-size:10px; font-weight:900; letter-spacing:.08em; text-transform:uppercase;
                 color:#15803d; }
  .nd-solved-b { font-size:12.5px; font-weight:600; color:#334155; margin-top:5px;
                 white-space:pre-wrap; }
  .nd-solved-m { font-size:10.5px; font-weight:700; color:#15803d; margin-top:6px; }
  .nd-solved-card img { width:100%; border-radius:8px; margin-top:8px; display:block; }

  .nd-detail { overflow-y:auto; flex:1; padding:14px; -webkit-overflow-scrolling:touch; }
  .nd-detail[hidden] { display:none; }
  .nd-d-title { font-size:15px; font-weight:800; color:#0f172a; line-height:1.35; }
  .nd-d-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:9px; }
  .nd-d-chip { font-size:10px; font-weight:800; letter-spacing:.04em; text-transform:uppercase;
               padding:3px 8px; border-radius:6px; background:#f1f5f9; color:#475569; }
  .nd-d-chip.hot  { background:#fee2e2; color:#b91c1c; }
  .nd-d-chip.due  { background:#fef3c7; color:#92400e; }
  .nd-d-body { margin-top:12px; font-size:12.5px; line-height:1.55; color:#334155;
               white-space:pre-wrap; word-break:break-word; }
  .nd-d-none { margin-top:12px; font-size:12px; color:#94a3b8; font-style:italic; }
  .nd-d-grid { margin-top:14px; border-top:1px solid #f1f5f9; padding-top:10px;
               display:grid; grid-template-columns:auto 1fr; gap:5px 12px; font-size:11.5px; }
  .nd-d-k { color:#94a3b8; font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
  .nd-d-v { color:#334155; font-weight:600; word-break:break-word; }
  .nd-d-open { display:inline-block; margin-top:14px; font-size:11px; font-weight:800;
               color:#6d28d9; text-decoration:none; letter-spacing:.03em; }
  .nd-d-open:hover { text-decoration:underline; }

  .nd-foot { display:flex; gap:7px; padding:10px 12px; border-top:1px solid #f1f5f9; background:#fff; flex-shrink:0; }
  .nd-foot[hidden] { display:none; }
  .nd-btn  { flex:1; text-align:center; padding:9px 10px; border-radius:10px; text-decoration:none;
             font-size:9.5px; font-weight:900; letter-spacing:.07em; text-transform:uppercase; }
  .nd-btn-a { background:#7c3aed; color:#fff; }  .nd-btn-a:hover { background:#6d28d9; }
  .nd-btn-b { background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe; }
  .nd-btn-b:hover { background:#ede9fe; }
  .nd-btn-c { background:#f8fafc; color:#64748b; border:1px solid #e2e8f0; }
  .nd-btn-c:hover { background:#f1f5f9; }
  /* Roughly 70/30 — the primary action earns the room. Declared after
     .nd-btn, whose flex:1 would otherwise win on source order. */
  .nd-btn-wide   { flex:7 1 0; }
  .nd-btn-narrow { flex:3 1 0; font-size:11px; }
  button.nd-btn { font-family:inherit; cursor:pointer; }
  button.nd-btn:disabled { opacity:.6; cursor:progress; }

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

  /* Same wording as dueText, without the markup — for places that need
     the words rather than a styled span. */
  function dueLabel(d) {
    if (!d) return '';
    var label;
    try {
      label = new Date(d + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
    } catch (_) { label = d; }
    return (d < todayISO() ? 'overdue ' : 'due ') + label;
  }

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
    return '<button type="button" class="nd-row' + (isOverdue(c) ? ' nd-row-over' : '') +
           '" data-case="' + esc(c.id) + '">' +
             '<span class="nd-dot nd-p-' + esc(c.priority || 'normal') + '" ' +
                   'title="' + esc(PRIORITY_LABEL[c.priority] || '') + '"></span>' +
             '<span class="nd-main">' +
               '<span class="nd-title">' + esc(c.title) + '</span>' +
               '<span class="nd-meta">' +
                 '<span class="nd-chip">' + esc(SOURCE_LABEL[c.source_module] || c.source_module || '') + '</span>' +
                 bits.join(' · ') +
               '</span>' +
             '</span>' +
           '</button>';
  }

  var dock, fab, badge, panel, listEl, formEl, detailEl, grip;
  var rows = [], open = false;
  var view = 'list';           // 'list' | 'form' | 'done'

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
        /* Title alone. The NL square repeated the badge on the circle
           that opened this panel, and the "Nelos · Pending on me"
           line under it repeated the title — three pieces of chrome
           for one idea, in a panel that is mostly list. */
        '<div class="nd-head">' +
          '<div class="nd-head-t">My To Do Nelos</div>' +
          '<button class="nd-hist" type="button" title="Solved, not yet closed" ' +
                  'aria-label="Solved, not yet closed">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true">' +
              '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/>' +
              '<polyline points="12 7 12 12 15 14"/></svg>' +
          '</button>' +
          '<button class="nd-min" type="button" title="Minimise" aria-label="Minimise">&#8211;</button>' +
        '</div>' +
        '<div class="nd-list"><div class="nd-empty">loading cases…</div></div>' +
        /* The form asks its questions in the order the person answering
           them thinks: who works this, what the work is, who by name,
           where, a picture, then anything else. Same shape as the Admin
           Portal's (Mobile/src/components/NelosNewCase.jsx) — one form on
           every surface, so keep the two in step.

           No date box. The date a case is raised is today, it is printed
           under the heading, and asking somebody to confirm the current
           date is asking them to do the computer's job. The due date is
           still set — from the chosen work's default_days. */
        '<div class="nd-form" hidden>' +
          '<div class="nd-err" hidden></div>' +
          '<div class="nd-today"></div>' +
          '<div class="nd-fld">' +
            '<label class="nd-lbl" for="nd-f-to">Assign to</label>' +
            '<select class="nd-in" id="nd-f-to">' +
              '<option value="">— choose a system —</option></select>' +
          '</div>' +
          '<div class="nd-fld">' +
            '<label class="nd-lbl" for="nd-f-work">Work</label>' +
            '<select class="nd-in" id="nd-f-work" hidden>' +
              '<option value="">— choose the work —</option></select>' +
            '<input class="nd-in" id="nd-f-title" maxlength="300" autocomplete="off" ' +
                   'placeholder="Choose a system first" disabled>' +
          '</div>' +
          '<div class="nd-fld">' +
            '<label class="nd-lbl" for="nd-f-pic">PIC</label>' +
            '<select class="nd-in" id="nd-f-pic" disabled>' +
              '<option value="">Anyone in that system</option></select>' +
          '</div>' +
          '<div class="nd-fld nd-2">' +
            '<div>' +
              '<label class="nd-lbl" for="nd-f-nursery">Nursery</label>' +
              '<select class="nd-in" id="nd-f-nursery"><option value="">— none —</option></select>' +
            '</div>' +
            '<div>' +
              '<label class="nd-lbl" for="nd-f-plot">Plot</label>' +
              '<select class="nd-in" id="nd-f-plot" disabled>' +
                '<option value="">Nursery first</option></select>' +
            '</div>' +
          '</div>' +
          '<div class="nd-fld">' +
            '<span class="nd-lbl">Photo</span>' +
            /* capture="environment" opens the camera straight onto the back
               lens on a phone and is ignored on a desktop, where the same
               control is a file picker. One control, both jobs. */
            '<label class="nd-photo-pick"><input type="file" id="nd-f-photo" ' +
                   'accept="image/*" capture="environment" hidden>' +
              '<span>&#128247; Take or upload a photo</span></label>' +
            '<div class="nd-photo" hidden><img alt=""><button type="button" ' +
                 'class="nd-photo-x" aria-label="Remove photo">&#10005;</button></div>' +
          '</div>' +
          '<div class="nd-fld">' +
            '<label class="nd-lbl" for="nd-f-desc">Remarks <span style="text-transform:none;letter-spacing:0">(optional)</span></label>' +
            '<textarea class="nd-in" id="nd-f-desc" rows="3" ' +
                      'placeholder="What you saw"></textarea>' +
          '</div>' +
          '<div class="nd-from"></div>' +
        '</div>' +
        /* Raising a case is what this panel is for; leaving for the full
           Nelos page is the exception. The split says so — roughly 70/30
           rather than two buttons of equal weight. */
        '<div class="nd-foot nd-foot-list">' +
          '<a class="nd-btn nd-btn-b nd-btn-narrow" href="' + esc(homeHref()) + '">Open Nelos →</a>' +
          '<button type="button" class="nd-btn nd-btn-a nd-btn-wide nd-new">+ New Case</button>' +
        '</div>' +
        '<div class="nd-detail" hidden></div>' +
        '<div class="nd-foot nd-foot-form" hidden>' +
          '<button type="button" class="nd-btn nd-btn-c nd-cancel">Cancel</button>' +
          '<button type="button" class="nd-btn nd-btn-a nd-save">Create New Case</button>' +
        '</div>' +
        '<div class="nd-foot nd-foot-detail" hidden>' +
          '<button type="button" class="nd-btn nd-btn-c nd-btn-narrow nd-back">&#8592; Back</button>' +
          '<button type="button" class="nd-btn nd-btn-a nd-btn-wide nd-solve-go">Save &amp; Solve</button>' +
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
    formEl = dock.querySelector('.nd-form');
    detailEl = dock.querySelector('.nd-detail');
    grip   = dock.querySelector('.nd-grip');
    wireForm();

    fab.addEventListener('click', function (e) {
      // A drag that ended on the circle is not a tap.
      if (fab.dataset.ndDragged === '1') { fab.dataset.ndDragged = '0'; e.preventDefault(); return; }
      setOpen(!open);
    });
    dock.querySelector('.nd-min').addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !open) return;
      if (view !== 'list') showList(); else setOpen(false);
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
    if (open) {
      if (view === 'done') { rebuildForm(); showList(); }
      applyPos(pos);
      refresh();
    }
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

  /* ── Raising a case, without leaving the page ────────────────────
     The whole point of a dock: someone notices something wrong while
     they are in the middle of a delivery note or an audit, and can say
     so there and then. Sending them to nelos_dashboard.html to do it
     loses their page, and usually the thought with it.

     The insert mirrors MJMNelos.raise() — same columns, same opening
     comment in the thread — because a case raised here must be
     indistinguishable from one raised on the Nelos page itself. Where
     it lands is not decided here: the nelos_cases_route trigger reads
     the category and routes the case to a module and a seat. */

  /* Which module this page belongs to, and the link back to it. The
     source_ref is written as seen from a module folder — it starts
     '../' — because nelos/nelos_case.html is what follows it. */
  var MODULE_DIRS = ['operation', 'nursery_ops', 'audit', 'npayroll', 'scan',
                     'mobile', 'col_booking', 'training', 'nelos'];

  function pageDir() {
    var parts = (location.pathname || '').split('/').filter(Boolean);
    parts.pop();                                  // the file itself
    return parts.length ? parts[parts.length - 1] : '';
  }

  function sourceModule() {
    if (OPT_SOURCE) return OPT_SOURCE;
    var d = pageDir();
    return MODULE_DIRS.indexOf(d) !== -1 ? d : 'nelos';
  }

  function sourceRef() {
    var d = pageDir();
    var file = (location.pathname || '').split('/').pop() || 'index.html';
    return '../' + (MODULE_DIRS.indexOf(d) !== -1 ? d + '/' : '') + file + (location.search || '');
  }

  function pageName() {
    var t = (document.title || '').trim();
    if (t) return t.length > 46 ? t.slice(0, 45) + '…' : t;
    return (location.pathname || '').split('/').pop() || 'this page';
  }

  /* The four nurseries and the plots each one has, copied from
     audit/audit_pending.js — which itself copies the module scripts,
     deliberately, because each runs on its own page. If a nursery gains
     plots there, it gains them here. */
  var NURSERY_PLOTS = {
    PN:   pad('P', 52), BNN: pad('B', 14), UNN1: pad('U', 18), UNN2: pad('N', 20)
  };
  var NURSERY_LABEL = { PN: 'Pre Nursery', BNN: 'BNN', UNN1: 'UNN1', UNN2: 'UNN2' };
  function pad(letter, n) {
    var out = [];
    for (var i = 1; i <= n; i++) out.push(letter + (i < 10 ? '0' + i : String(i)));
    return out;
  }

  /* Shown only when nelos_modules cannot be read — the five systems as
     they stand, in the order that table seeds them, under the short names
     nelos_modules.handler_label already carries. */
  var FALLBACK_MODULES = [
    { key: 'operation',   label: 'Seedling Stock' },
    { key: 'nursery_ops', label: 'HQ Operation' },
    { key: 'scan',        label: 'FC' },
    { key: 'mobile',      label: 'Admin' },
    { key: 'audit',       label: 'Auditor' }
  ];

  var _mods = null;          // [{key, label}]
  var _people = null;        // [{user_id, full_name, email, primary_module}]
  var _cats = null;          // [{name, module_key, default_priority, default_days}]

  async function loadCategories() {
    if (_cats) return _cats;
    var token = await accessToken();
    if (!token) return (_cats = []);
    try {
      var res = await fetch(CFG.url + '/rest/v1/nelos_categories' +
                            '?select=name,module_key,default_priority,default_days&active=is.true' +
                            '&order=sort_order.asc,name.asc', { headers: authHeaders(token) });
      if (!res.ok) return (_cats = []);
      var rows = await res.json();
      return (_cats = Array.isArray(rows) ? rows : []);
    } catch (_) { return (_cats = []); }
  }

  /* The systems a case can be sent to. Read rather than hardcoded: the
     User Setting page can rename or add one, and this follows. */
  async function loadModules() {
    if (_mods) return _mods;
    var token = await accessToken();
    if (!token) return (_mods = FALLBACK_MODULES);
    try {
      /* handler_label is the short name — Seedling Stock, HQ Operation, FC,
         Admin, Auditor — and it already exists: migration_nelos_seats.sql seeded it as the
         half of "Admin 1" that is not the number. "Assign to" wants the
         same five words, so it reads them rather than inventing a second
         set that could drift. `label` is the fallback for a system added
         later that has not been given one. */
      var res = await fetch(CFG.url + '/rest/v1/nelos_modules' +
                            '?select=key,label,handler_label&active=is.true&order=sort_order.asc',
                            { headers: authHeaders(token) });
      if (!res.ok) return (_mods = FALLBACK_MODULES);
      var rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) return (_mods = FALLBACK_MODULES);
      return (_mods = rows.map(function (m) {
        return { key: m.key, label: m.handler_label || m.label };
      }));
    } catch (_) { return (_mods = FALLBACK_MODULES); }
  }

  /* Who can be named as PIC. nelos_handlers, not the nelos_people() RPC:
     that one is admin-only (it checks manage_users or nelos admin), and
     anybody entitled to raise a case needs to be able to name who should
     get it. The table is readable by any authenticated user and carries
     the pin this needs. */
  async function loadPeople() {
    if (_people) return _people;
    var token = await accessToken();
    if (!token) return (_people = []);
    try {
      var res = await fetch(CFG.url + '/rest/v1/nelos_handlers' +
                            '?select=user_id,full_name,email,primary_module',
                            { headers: authHeaders(token) });
      if (!res.ok) return (_people = []);
      var rows = await res.json();
      return (_people = Array.isArray(rows) ? rows : []);
    } catch (_) { return (_people = []); }
  }

  /* That system's own case titles. nelos_categories.module_key scopes
     them, which is the whole point of that column — the Audit Portal
     should not be offering "Height Shortfall". */
  function worksFor(moduleKey) {
    if (!moduleKey) return [];
    return (_cats || []).filter(function (c) { return c.module_key === moduleKey; });
  }

  /* Sorted by name inside the system: the pin decides who is in the list,
     the name decides the order. */
  function picsFor(moduleKey) {
    if (!moduleKey) return [];
    return (_people || [])
      .filter(function (p) { return p.primary_module === moduleKey; })
      .map(function (p) { return { id: p.user_id, name: p.full_name || p.email || 'Unnamed' }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  /* Priority is no longer asked for. It is a property of the KIND of case,
     not a judgement the person raising it should have to make at the
     moment they are raising it — nelos_categories.default_priority already
     says what each kind is normally raised at, and it was only ever
     pre-filled from there anyway. No default_priority, or no set titles
     for that system at all, means normal. */
  function priority() {
    var key  = formEl.querySelector('#nd-f-to').value;
    var name = formEl.querySelector('#nd-f-work').value;
    var c = worksFor(key).filter(function (x) { return x.name === name; })[0];
    return (c && c.default_priority) || 'normal';
  }

  function formError(msg) {
    var box = formEl.querySelector('.nd-err');
    box.hidden = !msg;
    box.textContent = msg || '';
  }

  /* One place decides which of the three panes is on screen, so a new
     pane cannot half-appear over another. */
  function showPane(which) {
    listEl.hidden   = which !== 'list';
    formEl.hidden   = which !== 'form';
    detailEl.hidden = which !== 'detail';
    panel.querySelector('.nd-foot-list').hidden   = which !== 'list';
    panel.querySelector('.nd-foot-form').hidden   = which !== 'form';
    panel.querySelector('.nd-foot-detail').hidden = which !== 'detail';
  }

  function showList() {
    view = 'list';
    showPane('list');
    panel.querySelector('.nd-head-t').textContent = 'My To Do Nelos';
    panel.querySelector('.nd-hist').classList.remove('on');
    paint();
  }

  /* ── ONE CASE, IN THE PANEL ──────────────────────────────────────
     Tapping a row used to leave the page for nelos_case.html, which
     threw away whatever the person was in the middle of — the dock
     floats over a page they were working on, and the case is usually
     something they want to read, not somewhere they want to go.

     The list already carries everything but the description, so the
     panel paints from the row it has and fills the description in when
     it arrives. A failed fetch is not an error state: the case is
     still readable, minus one field. */
  var _detailCache = {};

  async function fetchCase(id) {
    if (_detailCache[id]) return _detailCache[id];
    var token = await accessToken();
    if (!token) return null;
    try {
      var res = await fetch(CFG.url + '/rest/v1/nelos_cases?select=*&limit=1&id=eq.' +
                            encodeURIComponent(id), { headers: authHeaders(token) });
      if (!res.ok) return null;
      var out = await res.json();
      var one = Array.isArray(out) ? out[0] : null;
      if (one) _detailCache[id] = one;
      return one || null;
    } catch (_) { return null; }
  }

  function detailHtml(c, full) {
    var subject = [c.batch_name && 'Batch ' + c.batch_name, c.plot_name, c.nursery_name]
      .filter(Boolean).join(' · ');
    var due = dueLabel(c.due_date);
    var chips =
      '<span class="nd-d-chip">' + esc(SOURCE_LABEL[c.source_module] || c.source_module || 'Nelos') + '</span>' +
      '<span class="nd-d-chip' + (c.priority === 'urgent' || c.priority === 'high' ? ' hot' : '') + '">' +
        esc(PRIORITY_LABEL[c.priority] || c.priority || 'normal') + '</span>' +
      (c.status ? '<span class="nd-d-chip">' + esc(String(c.status).replace('_', ' ')) + '</span>' : '') +
      (due ? '<span class="nd-d-chip' + (isOverdue(c) ? ' hot' : ' due') + '">' + esc(due) + '</span>' : '');

    var rowsOut = [];
    var put = function (k, v) { if (v) rowsOut.push(
      '<div class="nd-d-k">' + esc(k) + '</div><div class="nd-d-v">' + esc(v) + '</div>'); };
    put('Case', c.case_no);
    put('Subject', subject);
    put('Category', c.category);
    put('Queue', SOURCE_LABEL[c.assigned_module] || c.assigned_module);
    put('Assignee', c.assignee_name || 'Unassigned');
    put('Raised', (c.created_at || '').slice(0, 10));

    var body = full === null
      ? '<div class="nd-d-none">Could not load the detail — the case above is what the list knows.</div>'
      : full && full.description
        ? '<div class="nd-d-body">' + esc(full.description) + '</div>'
        : full
          ? '<div class="nd-d-none">No further detail was written.</div>'
          : '<div class="nd-d-none">Loading detail…</div>';

    var solved = (full && full.status === 'resolved') || c.status === 'resolved';
    return '<div class="nd-d-title">' + esc(c.title || 'Case') + '</div>' +
           '<div class="nd-d-chips">' + chips + '</div>' +
           body +
           (rowsOut.length ? '<div class="nd-d-grid">' + rowsOut.join('') + '</div>' : '') +
           '<a class="nd-d-open" href="' + esc(caseHref(c.id)) + '">Open full case &#8599;</a>' +
           (solved ? solvedCardHtml(full || c) : solveBlockHtml());
  }

  /* ── SOLVING ─────────────────────────────────────────────────────
     Upload first, then patch. That order matters: a failed upload
     leaves the case exactly as it was, whereas patching first would
     mark work solved and then lose the picture of it. */
  var _shot = null;                    // the File chosen for this case

  async function uploadShot(caseId, file) {
    var token = await accessToken();
    if (!token) return null;
    var ext  = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    var path = 'solve/' + caseId + '-' + Date.now() + '.' + (ext || 'jpg');
    try {
      var res = await fetch(CFG.url + '/storage/v1/object/nelos-photos/' + path, {
        method: 'POST',
        headers: { apikey: CFG.key, Authorization: 'Bearer ' + token,
                   'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
      if (!res.ok) return null;
      return CFG.url + '/storage/v1/object/public/nelos-photos/' + path;
    } catch (_) { return null; }
  }

  async function patchCase(id, body) {
    var token = await accessToken();
    if (!token) return { ok: false, status: 0 };
    try {
      var res = await fetch(CFG.url + '/rest/v1/nelos_cases?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                               authHeaders(token)),
        body: JSON.stringify(body)
      });
      return { ok: res.ok, status: res.status };
    } catch (_) { return { ok: false, status: 0 }; }
  }

  var _solving = false;
  async function solveCase(id) {
    if (_solving) return;
    var note = detailEl.querySelector('.nd-solve-note');
    var text = note ? note.value.trim() : '';
    if (!text) {
      if (note) { note.focus(); note.style.borderColor = '#fca5a5'; }
      return;
    }
    var btn = panel.querySelector('.nd-solve-go');
    _solving = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    var url = _shot ? await uploadShot(id, _shot) : null;
    var body = {
      status: 'resolved',
      resolution: text,
      resolved_by: me().name || me().email || 'unknown',
      resolved_at: new Date().toISOString()
    };
    if (url) body.resolution_photo_url = url;

    var out = await patchCase(id, body);
    /* 400 = this database has not run migration_nelos_solve_photo.sql.
       The remark and the status matter more than the picture, so save
       them rather than failing the whole thing. */
    if (!out.ok && out.status === 400 && url) {
      warn('nelos_cases has no resolution_photo_url — run ' +
           'shared/migration_nelos_solve_photo.sql. Saving the remark without the photo.');
      delete body.resolution_photo_url;
      out = await patchCase(id, body);
    }

    _solving = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Save & Solve'; }
    if (!out.ok) {
      if (note) note.style.borderColor = '#fca5a5';
      warn('could not save the resolution (http-' + out.status + ').');
      return;
    }
    _shot = null;
    delete _detailCache[id];
    showList();
    refresh();
  }

  function solveBlockHtml() {
    return '<div class="nd-solve">' +
             '<div class="nd-solve-h">Solve</div>' +
             '<div class="nd-shot">' +
               '<label>' +
                 '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
                 '<span>Add photo</span>' +
                 '<input type="file" accept="image/*" capture="environment" class="nd-shot-in">' +
               '</label>' +
             '</div>' +
             '<textarea class="nd-solve-note" maxlength="2000" ' +
                       'placeholder="What did you do? — this is what the person closing it reads"></textarea>' +
           '</div>';
  }

  function solvedCardHtml(c) {
    return '<div class="nd-solved-card">' +
             '<div class="nd-solved-h">&#10003; Solved</div>' +
             '<div class="nd-solved-b">' + esc(c.resolution || '') + '</div>' +
             (c.resolution_photo_url
               ? '<img src="' + esc(c.resolution_photo_url) + '" alt="Photo of the fix">' : '') +
             '<div class="nd-solved-m">' + esc(c.resolved_by || 'unknown') +
               (c.resolved_at ? ' · ' + esc(String(c.resolved_at).slice(0, 10)) : '') +
               ' · waiting to be closed</div>' +
           '</div>';
  }

  var openCaseId = null;

  function syncSolveBtn(c) {
    var btn = panel.querySelector('.nd-solve-go');
    if (!btn) return;
    /* Already solved → there is nothing to save; the card explains it. */
    btn.hidden = (c.status === 'resolved' || c.status === 'closed');
    panel.querySelector('.nd-back').classList.toggle('nd-btn-narrow', !btn.hidden);
  }

  async function showDetail(id) {
    var c = (rows.concat(doneRows)).filter(function (r) {
      return String(r.id) === String(id);
    })[0];
    if (!c) return;
    view = 'detail';
    openCaseId = String(id);
    _shot = null;
    showPane('detail');
    panel.querySelector('.nd-head-t').textContent = c.case_no || 'Case';
    detailEl.innerHTML = detailHtml(c, undefined);
    detailEl.scrollTop = 0;
    syncSolveBtn(c);

    var full = await fetchCase(id);
    /* They may have gone back, or into another case, while that was in
       flight — only paint if this is still the case on screen. */
    if (view !== 'detail' || openCaseId !== String(id)) return;
    detailEl.innerHTML = detailHtml(c, full);
    syncSolveBtn(full || c);
  }

  /* ── SOLVED, NOT YET CLOSED ──────────────────────────────────────
     Where a solved case goes. It leaves the to-do list the moment it
     is saved, and without this it would simply vanish — which reads as
     "did that save?" rather than "that is done and waiting on
     somebody". Closing is still the Nelos page's job. */
  var doneRows = [];
  var doneBusy = false;
  var _cameFromHistory = false;

  async function showHistory() {
    view = 'done-list';
    showPane('list');
    panel.querySelector('.nd-foot-list').hidden = false;
    panel.querySelector('.nd-head-t').textContent = 'Solved';
    panel.querySelector('.nd-hist').classList.add('on');
    listEl.innerHTML = '<div class="nd-empty">loading…</div>';
    if (doneBusy) return;
    doneBusy = true;
    var out = await fetchResolved();
    doneBusy = false;
    if (view !== 'done-list') return;
    doneRows = out.error ? [] : out.rows;
    listEl.innerHTML = doneRows.length
      ? doneRows.map(rowHtml).join('')
      : '<div class="nd-empty">' + (out.error
          ? 'Could not read the solved cases.'
          : 'Nothing solved and waiting to be closed.') + '</div>';
  }

  function opt(v, t) { return '<option value="' + esc(v) + '">' + esc(t) + '</option>'; }

  async function showForm() {
    view = 'form';
    showPane('form');
    panel.querySelector('.nd-head-t').textContent = 'Add New Case';
    formError('');
    // The date, said rather than asked.
    formEl.querySelector('.nd-today').textContent =
      new Date().toLocaleDateString('en-MY',
        { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    formEl.querySelector('.nd-from').innerHTML =
      'Raised from <b>' + esc(pageName()) + '</b> — the case links back here.';
    formEl.scrollTop = 0;

    var nurs = formEl.querySelector('#nd-f-nursery');
    if (nurs.options.length <= 1) {
      nurs.innerHTML = opt('', '— none —') +
        Object.keys(NURSERY_PLOTS).map(function (n) { return opt(n, NURSERY_LABEL[n]); }).join('');
    }

    /* Three reads, each failing on its own terms: no modules leaves the
       five as they stand, no case titles turns Work into a typed line, no
       people leaves the case with the system rather than a person. None of
       them is allowed to block the form. */
    var all = await Promise.all([loadModules(), loadCategories(), loadPeople()]);
    var to = formEl.querySelector('#nd-f-to');
    if (to.options.length <= 1) {
      to.innerHTML = opt('', '— choose a system —') +
        all[0].map(function (m) { return opt(m.key, m.label); }).join('');
    }
    setTimeout(function () { to.focus(); }, 60);
  }

  /* Changing the system invalidates the two answers that hang off it. */
  function onAssignTo() {
    var key = formEl.querySelector('#nd-f-to').value;
    var works = worksFor(key), pics = picsFor(key);

    var sel = formEl.querySelector('#nd-f-work');
    var typed = formEl.querySelector('#nd-f-title');
    if (works.length) {
      sel.innerHTML = opt('', '— choose the work —') +
        works.map(function (c) { return opt(c.name, c.name); }).join('');
      sel.hidden = false;
      typed.hidden = true;
      typed.value = '';
    } else {
      // Either nothing chosen yet, or that system has no titles set up.
      // Both are answered by saying so rather than by an empty dropdown
      // that looks broken.
      sel.hidden = true;
      sel.value = '';
      typed.hidden = false;
      typed.disabled = !key;
      typed.placeholder = key ? 'No set titles for this system — type one'
                              : 'Choose a system first';
    }

    var pic = formEl.querySelector('#nd-f-pic');
    pic.disabled = !key;
    pic.innerHTML = opt('', key && !pics.length ? 'Nobody pinned to this system yet'
                                                : 'Anyone in that system') +
      pics.map(function (p) { return opt(p.id, p.name); }).join('');
  }

  function onNursery() {
    var n = formEl.querySelector('#nd-f-nursery').value;
    var plot = formEl.querySelector('#nd-f-plot');
    plot.disabled = !n;
    plot.innerHTML = opt('', n ? '— none —' : 'Nursery first') +
      (NURSERY_PLOTS[n] || []).map(function (p) { return opt(p, p); }).join('');
  }

  /* The due date the chosen work normally gets, counted from today. No
     default_days means no due date, which is honest — a case nobody set a
     deadline for does not get an invented one. */
  function dueFromWork() {
    var key = formEl.querySelector('#nd-f-to').value;
    var name = formEl.querySelector('#nd-f-work').value;
    var c = worksFor(key).filter(function (x) { return x.name === name; })[0];
    if (!c || c.default_days == null) return null;
    var d = new Date();
    d.setDate(d.getDate() + Number(c.default_days));
    return d.toISOString().slice(0, 10);
  }

  /* One picture, into the public nelos-photos bucket, on the path
     nelos_dashboard.html already uses. Throws with a readable message so
     the save handler can show it and leave the form filled in — better
     than a case that quietly lost its photo. */
  var MAX_PHOTO = 8 * 1024 * 1024;
  async function uploadPhoto(token) {
    var input = formEl.querySelector('#nd-f-photo');
    var file = input && input.files && input.files[0];
    if (!file) return undefined;
    if (file.size > MAX_PHOTO) throw new Error('that photo is over 8 MB — take a smaller one');

    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    var path = new Date().toISOString().slice(0, 10) + '/' +
               Math.random().toString(36).slice(2) + '.' + ext;
    var res = await fetch(CFG.url + '/storage/v1/object/nelos-photos/' + path, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': file.type || 'image/jpeg' }, authHeaders(token)),
      body: file
    });
    if (!res.ok) {
      var detail = '';
      try { var e = await res.json(); detail = e.message || e.error || ''; } catch (_) {}
      throw new Error('photo upload failed — ' + (detail || res.status));
    }
    return CFG.url + '/storage/v1/object/public/nelos-photos/' + path;
  }

  function showDone(c) {
    view = 'done';
    showPane('form');
    /* The done card sits in the form pane but is finished with, so it
       takes the LIST footer — the way on is a new case or the list. */
    panel.querySelector('.nd-foot-form').hidden = true;
    panel.querySelector('.nd-foot-list').hidden = false;
    formEl.innerHTML =
      '<div class="nd-done">' +
        '<div class="nd-done-t">✓ ' + esc(c.case_no || 'Case') + ' raised</div>' +
        '<div class="nd-done-s">' + esc(c.title || '') + '<br>' +
          '<a href="' + esc(caseHref(c.id)) + '">Open the case →</a>' +
        '</div>' +
      '</div>';
    // Back to the list on its own, so the dock is ready for the next
    // thought rather than parked on a receipt.
    setTimeout(function () { if (view === 'done') { rebuildForm(); showList(); } }, 4000);
  }

  /* showDone() eats the form markup, so put it back before it is needed. */
  var FORM_HTML = null;
  function rebuildForm() {
    if (FORM_HTML === null) return;
    formEl.innerHTML = FORM_HTML;
    wireFormFields();
  }

  async function submitCase() {
    var assignTo = formEl.querySelector('#nd-f-to').value;
    var works    = worksFor(assignTo);
    /* The chosen work IS the case's title — that is what "choose work"
       means. A system with no case titles set up yet falls back to a typed
       line, so an empty nelos_categories cannot make this form unusable. */
    var title = (works.length ? formEl.querySelector('#nd-f-work').value
                              : formEl.querySelector('#nd-f-title').value.trim());

    if (!assignTo) return formError('Choose who this is for.');
    if (!title) {
      if (works.length) return formError('Choose the work.');
      formError('Say what the case is.');
      formEl.querySelector('#nd-f-title').focus();
      return;
    }

    var btn = panel.querySelector('.nd-save');
    var reset = function () { btn.disabled = false; btn.textContent = 'Create New Case'; };
    btn.disabled = true; btn.textContent = 'Creating…';
    formError('');

    var token = await accessToken();
    if (!token) { reset(); return formError('Your session has expired — sign in again.'); }

    /* Photo first. If it fails the case is not raised and the form stays
       filled in, which beats a case that quietly lost its picture. */
    var photoUrl;
    try {
      photoUrl = await uploadPhoto(token);
    } catch (e) {
      reset();
      return formError('Could not add the photo — ' + (e && e.message ? e.message : 'try again') + '.');
    }

    var picSel = formEl.querySelector('#nd-f-pic');
    var picId  = picSel.value || null;
    var picName = picId ? picSel.options[picSel.selectedIndex].text : null;

    var u = me();
    var row = {
      title:           title.slice(0, 300),
      description:     formEl.querySelector('#nd-f-desc').value.trim() || null,
      category:        works.length ? title : null,
      priority:        priority(),
      status:          'open',
      source_module:   sourceModule(),
      /* Where it was raised stays source_module; assigned_module is what
         was chosen, and nelos_route_case() honours an explicit one —
         "routing is the default, not a rule". */
      assigned_module: assignTo,
      source_ref:      sourceRef(),
      nursery_name:    formEl.querySelector('#nd-f-nursery').value || null,
      plot_name:       formEl.querySelector('#nd-f-plot').value || null,
      assignee_id:     picId,
      assignee_name:   picName,
      due_date:        dueFromWork(),
      raised_by:       u.name,
      raised_by_id:    u.id
    };
    // photo_url arrives with migration_nelos_case_tools.sql. Only send the
    // column when there is a photo, so a database without it still takes
    // the insert.
    if (photoUrl) row.photo_url = photoUrl;

    try {
      var res = await fetch(CFG.url + '/rest/v1/nelos_cases', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                               authHeaders(token)),
        body: JSON.stringify([row])
      });
      if (!res.ok) {
        var detail = '';
        try { var e = await res.json(); detail = e.message || e.hint || ''; } catch (_) {}
        throw new Error(detail || ('the server said ' + res.status));
      }
      var out = await res.json();
      var made = Array.isArray(out) ? out[0] : out;

      // The opening detail also lands in the thread, so the case page
      // reads as one conversation from the first line. Best effort: the
      // case exists either way.
      if (made && row.description) {
        fetch(CFG.url + '/rest/v1/nelos_case_comments', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(token)),
          body: JSON.stringify([{
            case_id: made.id, body: row.description, kind: 'comment',
            author_name: u.name, author_id: u.id
          }])
        }).catch(function () {});
      }

      btn.disabled = false; btn.textContent = 'Raise Case';
      showDone(made || { title: title });
      refresh();
    } catch (err) {
      reset();
      formError('Could not raise it — ' + (err && err.message ? err.message : 'try again') + '.');
    }
  }

  /* Field-level wiring, re-run whenever the form markup is rebuilt. */
  function wireFormFields() {
    formEl.querySelector('#nd-f-to').addEventListener('change', function () {
      onAssignTo();
      formError('');
    });
    formEl.querySelector('#nd-f-nursery').addEventListener('change', onNursery);

    formEl.querySelector('#nd-f-work').addEventListener('change', function () {
      if (this.value) formError('');
    });

    var photo = formEl.querySelector('#nd-f-photo');
    photo.addEventListener('change', function () {
      var f = this.files && this.files[0];
      var box = formEl.querySelector('.nd-photo');
      var pick = formEl.querySelector('.nd-photo-pick');
      if (!f) return;
      if (f.size > MAX_PHOTO) { this.value = ''; return formError('That photo is over 8 MB — take a smaller one.'); }
      formError('');
      var img = box.querySelector('img');
      if (img.src.indexOf('blob:') === 0) URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(f);
      box.hidden = false;
      pick.hidden = true;
    });
    formEl.querySelector('.nd-photo-x').addEventListener('click', function () {
      var box = formEl.querySelector('.nd-photo');
      var img = box.querySelector('img');
      if (img.src.indexOf('blob:') === 0) URL.revokeObjectURL(img.src);
      img.removeAttribute('src');
      box.hidden = true;
      formEl.querySelector('.nd-photo-pick').hidden = false;
      photo.value = '';
    });

    formEl.querySelector('#nd-f-title').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitCase(); }
    });
    // Typing is an answer to "say what the case is" — stop shouting.
    formEl.querySelector('#nd-f-title').addEventListener('input', function () {
      if (this.value.trim()) formError('');
    });
  }

  function wireForm() {
    FORM_HTML = formEl.innerHTML;
    wireFormFields();
    panel.querySelector('.nd-new').addEventListener('click', function () {
      if (view === 'done') rebuildForm();
      showForm();
    });
    panel.querySelector('.nd-cancel').addEventListener('click', function () { showList(); });
    panel.querySelector('.nd-back').addEventListener('click', function () {
      /* Back from a case reached through history goes back to history,
         not to the to-do list it is deliberately not on. */
      if (_cameFromHistory) { _cameFromHistory = false; showHistory(); }
      else showList();
    });
    panel.querySelector('.nd-solve-go').addEventListener('click', function () {
      if (openCaseId) solveCase(openCaseId);
    });
    panel.querySelector('.nd-hist').addEventListener('click', function () {
      if (view === 'done-list') showList(); else showHistory();
    });

    /* Photo picking and clearing live in the detail pane, which is
       rebuilt on every open — so both are delegated. */
    detailEl.addEventListener('change', function (e) {
      var inp = e.target.closest('.nd-shot-in');
      if (!inp || !inp.files || !inp.files[0]) return;
      _shot = inp.files[0];
      var wrap = detailEl.querySelector('.nd-shot');
      if (!wrap) return;
      var url = URL.createObjectURL(_shot);
      wrap.innerHTML = '<div class="nd-shot-prev"><img alt="Photo of the fix" src="' + url + '">' +
                       '<button type="button" class="nd-shot-x" aria-label="Remove photo">&times;</button></div>';
    });
    detailEl.addEventListener('click', function (e) {
      if (!e.target.closest('.nd-shot-x')) return;
      _shot = null;
      var wrap = detailEl.querySelector('.nd-shot');
      if (wrap) wrap.innerHTML =
        '<label><svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
        '<span>Add photo</span><input type="file" accept="image/*" capture="environment" class="nd-shot-in"></label>';
    });
    /* Delegated: the list is repainted on every refresh. */
    listEl.addEventListener('click', function (e) {
      var row = e.target.closest('.nd-row');
      if (!row || !row.dataset.case) return;
      _cameFromHistory = (view === 'done-list');
      showDetail(row.dataset.case);
    });
    panel.querySelector('.nd-save').addEventListener('click', function () { submitCase(); });
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
          warn(out.error === 'http-404'
            ? 'no nelos_cases table — run shared/migration_nelos.sql. Standing down.'
            : 'no usable session (' + out.error + '). Standing down.');
          dock.hidden = true;
          stopTimer();
          return;
        }
        // Transient — offline, a 5xx, a dropped connection. Keep whatever
        // is already on screen; if nothing ever loaded, show no button at
        // all rather than one that opens onto "loading…" forever. The
        // timer keeps running, so it appears by itself once the network
        // comes back.
        if (!loaded) {
          warn('could not read the case list (' + out.error + '). Hiding until it answers.');
          dock.hidden = true;
        }
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

  var _booted = false;

  async function boot() {
    if (_booted || unwanted()) return;

    /* Sign-in swaps the screen without navigating, so this waits rather
       than giving up — the dock appears the moment the grid does, with
       no reload. Polling rather than observing: the login element is
       often replaced wholesale, not just hidden, and an observer bound
       to the old node would never fire. */
    if (loginOnScreen()) {
      setTimeout(boot, 700);
      return;
    }

    CFG = await loadConfig();
    if (!CFG) { warn('no Supabase config on this page and shared_supabase.js would not load.'); return; }
    if (!storedSession()) return;           // signed out: login pages get no dock, and say nothing
    _booted = true;

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
