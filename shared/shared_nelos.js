/* ================================================================
   MJM AI POWERED SYSTEM — NELOS BRIDGE
   shared/shared_nelos.js

   Nelos (Nursery Carlos) is the case log. This file is how every OTHER
   module talks to it, so a module never needs to know the table shape:

     • MJMNelos.raise({...})        create a case from anywhere
     • MJMNelos.mountTodo(el, {…})  drop a "pending cases" To-Do list
                                    into a dashboard
     • MJMNelos.pending({…})        the same data, raw, if you want to
                                    render it yourself
     • MJMNelos.countPending({…})   just the number, for a badge
     • MJMNelos.scope() / applyScope(rows)
                                    who may see which cases, as set on
                                    the User Setting page — see the block
                                    above scope() for the exact rule

   Usage in any module page:

     <script src="../shared/shared_supabase.js"></script>
     <script src="../shared/shared_access.js"></script>
     <script src="../shared/shared_nelos.js"></script>
     …
     MJMNelos.init(_supabase);                     // once, after load()
     MJMNelos.mountTodo('#nelos-todo', { module: 'operation' });

   Everything here fails SOFT. A dashboard is not allowed to break
   because the case log is unreachable or the migration has not been run
   yet — the widget hides itself and the host page carries on. That is
   deliberate: these widgets are bolted onto four existing dashboards
   that all worked before Nelos existed.
   ================================================================ */
(function (global) {

  const NELOS_HOME = 'nelos/nelos_dashboard.html';   // from the portal root
  const PENDING = ['open', 'in_progress'];

  const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
  const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
  const STATUS_LABEL = {
    open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed'
  };

  /* Which module a case came from, for the chip on each line. These are the
     fallback labels: the live ones are rows in nelos_modules, which the User
     Setting page renders and can rename. Keep the two in step. */
  const SOURCE_LABEL = {
    operation:   'Seedling Stock System',
    nursery_ops: 'Nursery Operation',
    scan:        'FC Portal',
    mobile:      'Admin Portal',
    audit:       'Audit Portal',
    npayroll:    'Payroll',
    nelos:       'Nelos'
  };

  let _supa = null;
  let _rootPrefix = '../';   // path back to the portal root from the host page

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ── Setup ──────────────────────────────────────────────────── */

  /**
   * MJMNelos.init(supabaseClient, { root:'../' })
   * `root` is how the host page reaches the portal root — '' for
   * index.html itself, '../' for a module page one folder down.
   */
  function init(supa, opts) {
    _supa = supa || null;
    if (opts && typeof opts.root === 'string') _rootPrefix = opts.root;
    return api;
  }

  function homeHref() { return _rootPrefix + NELOS_HOME; }
  function caseHref(id) { return _rootPrefix + 'nelos/nelos_case.html?id=' + encodeURIComponent(id); }

  function requireClient() {
    if (_supa) return _supa;
    // Convenience: build one from the shared config if the host page
    // loaded shared_supabase.js but never called init().
    try {
      if (global.supabase && global.SHARED_SUPA_URL && global.SHARED_SUPA_KEY) {
        _supa = global.supabase.createClient(global.SHARED_SUPA_URL, global.SHARED_SUPA_KEY);
        return _supa;
      }
    } catch (_) { /* fall through */ }
    return null;
  }

  /* Who is signed in, if shared_access.js has loaded. Nelos never blocks
     on this — a case raised by an unknown user is still better than a
     case that was never raised. */
  function currentUser() {
    try {
      const u = global.MJMAccess && global.MJMAccess.user && global.MJMAccess.user();
      if (!u) return { id: null, name: null, email: null };
      return { id: u.id || null, name: u.full_name || u.email || null, email: u.email || null };
    } catch (_) { return { id: null, name: null, email: null }; }
  }

  /* ── Who may see which cases ────────────────────────────────────
     A person is pinned to one home module on the User Setting page —
     "this person handles Nursery Operation cases". From that pin:

       • every case in their home module's QUEUE (assigned_module), no
         matter which page they are looking at. An auditor pinned to Audit
         still gets the To-Do dock on the Stock system, showing Audit's
         queue — that is the whole reason this replaced per-module
         membership.
       • minus anything routed to a NUMBER that is not theirs. A system
         numbers its handlers 1, 2, 3… — "Admin 1", "Admin 2" — and a case
         sent to one of them is not the others' work. A case with no
         number is the whole system's to take.
       • plus every case ASSIGNED TO THEM personally, whatever queue it
         sits in. So work handed to you follows you around.
       • optionally narrowed by category inside the home queue. A case
         with your name on it is never hidden by that narrowing — somebody
         has already decided it is yours.

       • not pinned yet → sees everything. Somebody who has just been
         granted Nelos must not find an empty screen.
       • Nelos admin    → sees everything regardless, so an admin cannot
         lock themselves out of their own case log.

     Note this keys on assigned_module, not source_module: an FC Portal
     case routed to Audit belongs to Audit's queue while still reading as
     an FC Portal case. Rows written before the routing migration have
     assigned_module backfilled from source_module, and the fallback below
     covers any that slipped through.

     Loaded once per page and cached; call scope({reload:true}) after
     changing a pin. Any failure yields the unrestricted scope — a lookup
     that cannot run must not hide cases from anyone. */

  let _scope = null;

  const QUEUE_OF = c => c.assigned_module || c.source_module;

  async function scope(opts) {
    if (_scope && !(opts && opts.reload)) return _scope;

    const open = { unrestricted: true, home: null, cats: null, userId: null };
    const supa = requireClient();
    if (!supa) return (_scope = open);

    try {
      if (global.MJMAccess && global.MJMAccess.isAdminOf &&
          global.MJMAccess.isAdminOf('nelos')) return (_scope = open);
    } catch (_) { /* fall through and ask the database */ }

    const me = currentUser();
    if (!me.id) return (_scope = open);

    try {
      // nelos_my_scope() answers for the caller only, so this works for an
      // ordinary user — nelos_people() is admin-only and would return
      // nothing here.
      const { data, error } = await supa.rpc('nelos_my_scope');
      const row = (data && data[0]) || null;
      if (error || !row) return (_scope = open);
      if (row.is_admin) return (_scope = open);
      if (!row.primary_module) return (_scope = open);   // not pinned yet

      const list = Array.isArray(row.categories) ? row.categories.filter(Boolean) : [];
      return (_scope = {
        unrestricted: false,
        home: row.primary_module,
        seatNo: row.seat_no ?? null,
        cats: list.length ? new Set(list) : null,
        userId: me.id
      });
    } catch (_) {
      return (_scope = open);
    }
  }

  /* True when this case is inside the given scope. */
  function inScope(c, sc) {
    if (!sc || sc.unrestricted) return true;
    // Assigned to me — mine wherever it sits, past every filter below.
    if (sc.userId && c.assignee_id && c.assignee_id === sc.userId) return true;
    if (QUEUE_OF(c) !== sc.home) return false;
    // Routed to one numbered handler: only that person. No number on the
    // case means anyone in the system may take it.
    if (c.assigned_seat_no && c.assigned_seat_no !== sc.seatNo) return false;
    if (!sc.cats) return true;                      // every category in my queue
    return !!c.category && sc.cats.has(c.category);
  }

  /* Filter a list of cases by the signed-in user's scope. */
  async function applyScope(rows) {
    const sc = await scope();
    if (sc.unrestricted) return rows;
    return rows.filter(c => inScope(c, sc));
  }

  /* ── Raising a case ─────────────────────────────────────────── */

  /**
   * MJMNelos.raise({
   *   title,          // required — one line, what is wrong
   *   description,    // optional — the detail
   *   category,       // optional — a nelos_categories.name
   *   priority,       // optional — low|normal|high|urgent   (default normal)
   *   source,         // optional — which module is raising it (default 'nelos')
   *   sourceRef,      // optional — link back to the page raising this, written
   *                   //   as seen from a module folder (start it '../'), since
   *                   //   nelos/nelos_case.html is what follows it
   *   nursery, plot, batch,        // optional subject of the case
   *   assigneeId, assigneeName,    // optional owner
   *   dueDate,        // optional 'YYYY-MM-DD'
   *   dedupe          // optional — when true, an identical OPEN case from
   *                   //   the same source/batch/plot is reused instead of
   *                   //   inserting a second one. Use this for cases raised
   *                   //   automatically on save, which would otherwise pile
   *                   //   up one row per save.
   * })
   *
   * Returns { data, error } — never throws, so a caller can ignore the
   * result and the host page still saves.
   */
  async function raise(opts) {
    const supa = requireClient();
    if (!supa) return { data: null, error: new Error('Nelos: no Supabase client') };
    if (!opts || !opts.title) return { data: null, error: new Error('Nelos: title is required') };

    const me = currentUser();

    try {
      if (opts.dedupe) {
        const existing = await findOpenDuplicate(supa, opts);
        if (existing) return { data: existing, error: null, deduped: true };
      }

      const row = {
        title:         String(opts.title).slice(0, 300),
        description:   opts.description || null,
        category:      opts.category || null,
        priority:      PRIORITY_RANK[opts.priority] !== undefined ? opts.priority : 'normal',
        status:        'open',
        source_module: opts.source || 'nelos',
        source_ref:    opts.sourceRef || null,
        nursery_name:  opts.nursery || null,
        plot_name:     opts.plot || null,
        batch_name:    opts.batch || null,
        assignee_id:   opts.assigneeId || null,
        assignee_name: opts.assigneeName || null,
        due_date:      opts.dueDate || null,
        raised_by:     me.name,
        raised_by_id:  me.id
      };

      const { data, error } = await supa.from('nelos_cases').insert([row]).select().single();
      if (error) return { data: null, error };

      if (opts.description) {
        // The opening description also lands in the thread, so the case
        // page reads as one conversation from the first line.
        await supa.from('nelos_case_comments').insert([{
          case_id: data.id, body: opts.description, kind: 'comment',
          author_name: me.name, author_id: me.id
        }]).then(r => r, () => ({}));
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  /* An open case with the same source + subject + category is the same
     case being raised again, not a new one. */
  async function findOpenDuplicate(supa, opts) {
    let q = supa.from('nelos_cases').select('*')
      .in('status', PENDING)
      .eq('source_module', opts.source || 'nelos');
    if (opts.category) q = q.eq('category', opts.category);
    q = opts.batch ? q.eq('batch_name', opts.batch) : q.is('batch_name', null);
    q = opts.plot  ? q.eq('plot_name',  opts.plot)  : q.is('plot_name',  null);
    const { data, error } = await q.limit(1);
    if (error || !data || !data.length) return null;
    return data[0];
  }

  /* ── Reading pending cases ──────────────────────────────────── */

  /**
   * MJMNelos.pending({
   *   module,     // only cases waiting in this module's QUEUE — what a
   *               //   module's own To-Do list wants
   *   source,     // only cases RAISED by this module (rarely what you want)
   *   mine,       // true → only cases assigned to the signed-in user
   *   plot, batch, nursery,
   *   limit       // default 50
   * })
   */
  async function pending(opts) {
    opts = opts || {};
    const supa = requireClient();
    if (!supa) return { data: [], error: new Error('Nelos: no Supabase client') };

    try {
      let q = supa.from('nelos_cases')
        .select('id,case_no,title,category,priority,status,source_module,assigned_module,' +
                'assigned_seat_no,source_ref,nursery_name,plot_name,batch_name,' +
                'assignee_id,assignee_name,due_date,created_at')
        .in('status', PENDING);

      // `module` is the QUEUE a case is waiting in — what a module's own
      // To-Do list wants. `source` is where it was raised, which is only
      // useful for asking "what has this module been reporting?".
      if (opts.module)  q = q.eq('assigned_module', opts.module);
      if (opts.source)  q = q.eq('source_module', opts.source);
      if (opts.plot)    q = q.eq('plot_name', opts.plot);
      if (opts.batch)   q = q.eq('batch_name', opts.batch);
      if (opts.nursery) q = q.eq('nursery_name', opts.nursery);
      if (opts.mine) {
        const me = currentUser();
        if (!me.id) return { data: [], error: null };
        q = q.eq('assignee_id', me.id);
      }

      const { data, error } = await q
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(opts.limit || 50);

      if (error) return { data: [], error };
      // Priority is a word in the database, so worst-first has to be sorted
      // here rather than in the query.
      const rows = (data || []).slice().sort((a, b) =>
        (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
      // Narrow to what this person is set up to see (User Setting page).
      return { data: await applyScope(rows), error: null };
    } catch (e) {
      return { data: [], error: e };
    }
  }

  async function countPending(opts) {
    const { data } = await pending(Object.assign({ limit: 500 }, opts || {}));
    return data.length;
  }

  /* ── The To-Do widget ───────────────────────────────────────── */

  const WIDGET_CSS = `
    .nelos-todo { background:#fff; border:1.5px solid #e2e8f0; border-radius:16px; padding:16px 18px;
                  box-shadow:0 4px 14px rgba(15,23,42,.05); font-family:'Outfit',system-ui,sans-serif; }
    .nelos-todo-head { display:flex; align-items:center; gap:9px; margin-bottom:11px; }
    .nelos-todo-title { font-size:11px; font-weight:900; letter-spacing:.11em; text-transform:uppercase; color:#334155; }
    .nelos-todo-count { font-size:10px; font-weight:900; padding:2px 8px; border-radius:999px;
                        background:#fee2e2; color:#b91c1c; letter-spacing:.04em; }
    .nelos-todo-count.zero { background:#dcfce7; color:#15803d; }
    .nelos-todo-all { margin-left:auto; font-size:10px; font-weight:900; letter-spacing:.08em; text-transform:uppercase;
                      color:#7c3aed; text-decoration:none; }
    .nelos-todo-all:hover { text-decoration:underline; }
    .nelos-row { display:flex; align-items:flex-start; gap:9px; padding:8px 2px; border-bottom:1px dashed #e2e8f0;
                 text-decoration:none; color:inherit; }
    .nelos-row:last-child { border-bottom:none; }
    .nelos-row:hover { background:#faf5ff; }
    .nelos-dot { width:8px; height:8px; border-radius:50%; margin-top:5px; flex-shrink:0; }
    .nelos-p-urgent { background:#dc2626; } .nelos-p-high { background:#f97316; }
    .nelos-p-normal { background:#0ea5e9; } .nelos-p-low  { background:#94a3b8; }
    .nelos-row-main { min-width:0; flex:1; }
    .nelos-row-title { font-size:13px; font-weight:700; color:#1e293b; line-height:1.3;
                       overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .nelos-row-meta { font-size:10px; font-weight:600; color:#94a3b8; margin-top:2px; }
    .nelos-chip { display:inline-block; font-size:9px; font-weight:900; letter-spacing:.06em; text-transform:uppercase;
                  padding:1px 6px; border-radius:5px; background:#f1f5f9; color:#64748b; margin-right:5px; }
    .nelos-due-over { color:#b91c1c; font-weight:900; }
    .nelos-empty { text-align:center; font-size:12px; font-weight:700; color:#94a3b8; padding:22px 6px; }
    .nelos-new { display:inline-flex; align-items:center; gap:6px; margin-top:11px; padding:8px 15px; border-radius:10px;
                 background:#7c3aed; color:#fff; font-size:10px; font-weight:900; letter-spacing:.08em;
                 text-transform:uppercase; text-decoration:none; border:none; cursor:pointer; }
    .nelos-new:hover { background:#6d28d9; }
  `;

  function injectCss() {
    if (document.getElementById('nelos-widget-css')) return;
    const s = document.createElement('style');
    s.id = 'nelos-widget-css';
    s.textContent = WIDGET_CSS;
    document.head.appendChild(s);
  }

  const todayISO = () => new Date().toISOString().slice(0, 10);

  function dueText(d) {
    if (!d) return '';
    const label = new Date(d + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
    return d < todayISO()
      ? `<span class="nelos-due-over">⏰ overdue ${esc(label)}</span>`
      : `due ${esc(label)}`;
  }

  function rowHtml(c) {
    const subject = [c.batch_name && 'Batch ' + c.batch_name, c.plot_name, c.nursery_name]
      .filter(Boolean).join(' · ');
    const bits = [
      esc(c.case_no || ''),
      subject && esc(subject),
      c.assignee_name ? '→ ' + esc(c.assignee_name) : '<em>unassigned</em>',
      dueText(c.due_date)
    ].filter(Boolean);
    return `
      <a class="nelos-row" href="${esc(caseHref(c.id))}">
        <span class="nelos-dot nelos-p-${esc(c.priority || 'normal')}"
              title="${esc(PRIORITY_LABEL[c.priority] || '')}"></span>
        <span class="nelos-row-main">
          <span class="nelos-row-title">${esc(c.title)}</span>
          <span class="nelos-row-meta">
            <span class="nelos-chip">${esc(SOURCE_LABEL[c.source_module] || c.source_module || '')}</span>
            ${bits.join(' · ')}
          </span>
        </span>
      </a>`;
  }

  /**
   * MJMNelos.mountTodo(target, {
   *   module,      // this module's queue — cases it has to work
   *   source,      // cases this module raised, wherever they went
   *   mine,        // true → only what is assigned to me
   *   plot, batch, nursery,
   *   limit,       // rows to show (default 6)
   *   title,       // widget heading (default 'Nelos — Pending Cases')
   *   newCase,     // false to hide the "Raise a Case" button
   *   hideIfEmpty  // true → remove the widget entirely when nothing is pending
   * })
   *
   * `target` is an element or a selector. Returns the number of pending
   * cases, or 0 if anything went wrong.
   */
  async function mountTodo(target, opts) {
    opts = opts || {};
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return 0;

    injectCss();
    el.innerHTML = `<div class="nelos-todo"><div class="nelos-empty">loading cases…</div></div>`;

    const { data, error } = await pending(Object.assign({}, opts, { limit: opts.limit || 6 }));

    if (error) {
      // Migration not run, table missing, network down — say nothing loud,
      // just stand down. The host dashboard is not ours to break.
      el.innerHTML = '';
      return 0;
    }
    if (!data.length && opts.hideIfEmpty) { el.innerHTML = ''; return 0; }

    const total = data.length;
    // Raising from a dashboard means raising AS that module, so the prefill
    // follows `module` when the caller filtered by queue rather than source
    // — otherwise a widget mounted with { module: 'audit' } would open the
    // form with no section chosen and the case would route as if raised in
    // Nelos itself.
    const raisedAs = opts.source || opts.module;
    const newBtn = opts.newCase === false ? '' :
      `<a class="nelos-new" href="${esc(homeHref())}?new=1${raisedAs ? '&source=' + encodeURIComponent(raisedAs) : ''}${opts.batch ? '&batch=' + encodeURIComponent(opts.batch) : ''}${opts.plot ? '&plot=' + encodeURIComponent(opts.plot) : ''}">➕ Raise a Case</a>`;

    el.innerHTML = `
      <div class="nelos-todo">
        <div class="nelos-todo-head">
          <span class="nelos-todo-title">📋 ${esc(opts.title || 'Nelos — Pending Cases')}</span>
          <span class="nelos-todo-count ${total ? '' : 'zero'}">${total || 'clear'}</span>
          <a class="nelos-todo-all" href="${esc(homeHref())}">Open Nelos →</a>
        </div>
        ${total
          ? data.map(rowHtml).join('')
          : '<div class="nelos-empty">Nothing pending — all clear ✓</div>'}
        ${newBtn}
      </div>`;
    return total;
  }

  const api = {
    init, raise, pending, countPending, mountTodo,
    scope, inScope, applyScope,
    homeHref, caseHref,
    PENDING, PRIORITY_LABEL, STATUS_LABEL, SOURCE_LABEL, PRIORITY_RANK,
    esc
  };

  global.MJMNelos = api;

})(window);
