/* ================================================================
   MJM AI POWERED SYSTEM — SHARED ACCESS HELPER
   shared/shared_access.js

   Loads the current user's permissions row from shared_profiles and
   exposes simple helpers to gate UI / actions per module.

   Usage:
     <script src="../shared/shared_supabase.js"></script>
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="../shared/shared_access.js"></script>
     ...
     await MJMAccess.load(_supabase);
     if (!MJMAccess.canAccess('operation')) {
        window.location.href = 'operation_dashboard.html';
        return;
     }
     if (MJMAccess.isAdminOf('operation')) showReviewButtons();

   Permission shape (shared_profiles.permissions JSONB):
     {
       "modules": {
         "operation": "admin" | "normal" | "none",
         "salesweb":  "admin" | "normal" | "none",
         "audit":     "admin" | "normal" | "none",
         "mobile":    "admin" | "normal" | "none"
       },
       "manage_users": true | false,

       // Per-FUNCTION access inside the operation module, one object per
       // page. Managed from operation/operation_user_access.html. When a
       // page's object is present it is authoritative for that page —
       // every unticked function is denied. When absent, the legacy
       // fields (module level, operation_pages, can_verify_operation)
       // decide, so users saved before this shape existed keep working.
       "operation_actions": {
         "batch":       { "view":true, "add_new":true, "fill_report":true,
                          "verify":false, "review":false, "delete":false },
         "orders":      { "view":true, "manage":true },
         "stock":       { "view":true, "manage":true },
         "reports":     { "view":false },
         "audit_trail": { "view":false, "clear_logs":false },
         "settings":    { "view":true, "manage":true }
       }
     }
   ================================================================ */
(function (global) {
  // Default skeleton — used when nothing is loaded yet. The full set of
  // active modules is sourced from the data itself in normalize() so
  // adding a new module (e.g. reports, audit_trail) doesn't require a
  // helper redeploy.
  const DEFAULT_PERMS = {
    modules: { operation: 'none', nursery_ops: 'none', nelos: 'none', npayroll: 'none', reports: 'none', audit_trail: 'none', salesweb: 'none', audit: 'none', mobile: 'none' },
    manage_users: false,
    can_verify_operation: false
  };

  const VALID_LEVELS = new Set(['admin', 'normal', 'none']);

  const state = {
    user: null,        // { id, email, full_name }
    permissions: null  // permissions JSONB (or DEFAULT_PERMS if unset)
  };

  function normalize(perms) {
    const out = JSON.parse(JSON.stringify(DEFAULT_PERMS));
    if (!perms || typeof perms !== 'object') return out;
    if (perms.modules && typeof perms.modules === 'object') {
      // Copy ANY module key from the data — not just the defaults — so
      // newly-added modules immediately work without updating this file.
      for (const [k, v] of Object.entries(perms.modules)) {
        if (VALID_LEVELS.has(v)) out.modules[k] = v;
      }
    }
    out.manage_users = !!perms.manage_users;
    out.can_verify_operation = !!perms.can_verify_operation;
    // Per-page and per-function access INSIDE a module, managed from that
    // module's own User Access page. Any `<module>_pages` / `<module>_actions`
    // key is carried through, so adding a module needs no change here.
    //
    //   <module>_pages   { batch:'admin'|'normal'|'none', ... }
    //                    a missing key means "allowed" (default 'normal'), so
    //                    existing users are unaffected until a page is locked
    //   <module>_actions { batch:{ view:true, verify:false, ... }, ... }
    //                    booleans only; a page whose value is not a plain
    //                    object is dropped, so a corrupted value falls back to
    //                    the legacy fields for that page rather than denying
    for (const [key, val] of Object.entries(perms)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      if (/_pages$/.test(key)) {
        const clean = {};
        for (const [k, v] of Object.entries(val)) if (VALID_LEVELS.has(v)) clean[k] = v;
        out[key] = clean;
      } else if (/_actions$/.test(key)) {
        const clean = {};
        for (const [page, acts] of Object.entries(val)) {
          if (!acts || typeof acts !== 'object' || Array.isArray(acts)) continue;
          const one = {};
          for (const [a, v] of Object.entries(acts)) one[a] = !!v;
          clean[page] = one;
        }
        out[key] = clean;
      }
    }
    return out;
  }

  // ── Profile-fetch cache ─────────────────────────────────────────
  //   Two layers, both aimed at stopping the same shared_profiles row
  //   being pulled over and over during Supabase blips (a 522 storm
  //   we saw on 21 Aug turned four MJMAccess.load() calls in the same
  //   second into four identical failed round-trips):
  //
  //   1. `_inflight` (in-memory, per page): if load() is already in
  //      flight for a user id, subsequent calls await the SAME promise
  //      rather than firing another HTTP call.
  //   2. sessionStorage TTL: a successful profile stays fresh for 30 s.
  //      Follow-up loads within the same tab hydrate from that cache and
  //      skip the network entirely. sessionStorage (not localStorage) so
  //      a permission change picked up in one tab does not silence the
  //      next tab's refresh — the next tab still fetches on its own.
  //
  //   The cache is BYPASSED whenever the auth session is missing —
  //   never gate a fresh sign-in decision on a stale permissions blob.
  const PROFILE_TTL_MS = 30_000;
  const _inflight = {};    // uid → Promise<{ data, error }>

  function _profileCacheKey(uid) { return 'mjm_profile_cache__' + uid; }

  function _readProfileCache(uid) {
    try {
      const raw = sessionStorage.getItem(_profileCacheKey(uid));
      if (!raw) return null;
      const rec = JSON.parse(raw);
      if (!rec || typeof rec !== 'object') return null;
      if (Date.now() - Number(rec.ts || 0) > PROFILE_TTL_MS) return null;
      return rec.data || null;
    } catch (_) { return null; }
  }

  function _writeProfileCache(uid, data) {
    try {
      sessionStorage.setItem(_profileCacheKey(uid),
        JSON.stringify({ ts: Date.now(), data: data }));
    } catch (_) { /* private mode / quota — silent */ }
  }

  async function _fetchProfile(supa, uid) {
    if (_inflight[uid]) return _inflight[uid];
    const p = supa
      .from('shared_profiles')
      .select('full_name, email, permissions')
      .eq('id', uid)
      .single()
      .then(function (r) { return r; })
      .finally(function () { delete _inflight[uid]; });
    _inflight[uid] = p;
    return p;
  }

  async function load(supa) {
    if (!supa) throw new Error('MJMAccess.load(supabase) — supabase client required');
    const { data: { session } } = await supa.auth.getSession();
    if (!session) {
      state.user = null;
      state.permissions = normalize(null);
      return state;
    }
    const u = session.user;
    state.user = {
      id: u.id,
      email: u.email || '',
      full_name: (u.user_metadata && u.user_metadata.full_name) || ''
    };
    let fetchOk = false;
    try {
      // Try the short-lived per-tab cache first — a repeat MJMAccess.load
      // inside the TTL is a no-op on the network, which cuts the dogpile
      // on shared_profiles during outages and normal navigation alike.
      let data = _readProfileCache(u.id);
      let error = null;
      if (!data) {
        const res = await _fetchProfile(supa, u.id);
        data = res.data;
        error = res.error;
        if (!error && data) _writeProfileCache(u.id, data);
      }
      if (error) throw error;
      if (data) {
        if (data.full_name) state.user.full_name = data.full_name;
        state.permissions = normalize(data.permissions);
      } else {
        state.permissions = normalize(null);
      }
      fetchOk = true;
    } catch (e) {
      console.warn('[MJMAccess] failed to load permissions:', e);
      state.permissions = normalize(null);
    }

    // Whole-system gate. The signed-in user MUST have at least one
    // staff-grade entry on their permissions row — manage_users,
    // can_verify_operation, or a non-'none' module level. Without that
    // they have no business loading any ops page, so kick them back to
    // the hub's index.html where the Pending Access screen explains
    // they're awaiting admin approval.
    //
    // Fails OPEN on a profile-read error so a transient Supabase
    // hiccup doesn't lock real ops admins out. Same policy as the hub
    // gate. Allow opt-out via window.__MJM_SKIP_ACCESS_GATE for pages
    // that already handle their own gating.
    if (fetchOk && !global.__MJM_SKIP_ACCESS_GATE) {
      const p = state.permissions || {};
      let anyAccess = !!(p.manage_users || p.can_verify_operation);
      if (!anyAccess && p.modules) {
        for (const k in p.modules) {
          if (p.modules[k] && p.modules[k] !== 'none') { anyAccess = true; break; }
        }
      }
      if (!anyAccess) {
        for (const key in p) {
          if (!/_actions$/.test(key) || !p[key]) continue;
          for (const page in p[key]) {
            const acts = p[key][page];
            if (acts && Object.keys(acts).some(a => acts[a])) { anyAccess = true; break; }
          }
          if (anyAccess) break;
        }
      }
      if (!anyAccess) {
        console.warn('[MJMAccess] no ops access — redirecting to hub');
        const here = (global.location && global.location.pathname) || '';
        // From /operation/foo.html → ../index.html. From / or /index.html
        // we're already on the hub; don't redirect-loop.
        if (!/\/index\.html?$/.test(here) && here !== '/' && here !== '') {
          global.location.href = '../index.html';
          // Throw so the caller's awaited code does not continue executing
          // pre-redirect (we're navigating away anyway).
          throw new Error('NO_OPS_ACCESS');
        }
      }
    }

    return state;
  }

  function user()        { return state.user; }
  function permissions() { return state.permissions || normalize(null); }

  function moduleLevel(name) {
    const p = permissions();
    return (p.modules && p.modules[name]) || 'none';
  }

  function canAccess(name)  { return moduleLevel(name) !== 'none'; }
  function isAdminOf(name)  { return moduleLevel(name) === 'admin'; }
  function canManageUsers() { return !!permissions().manage_users; }

  // Per-page access inside the operation module (see operation_pages above).
  // Page keys mirror the dashboard cards: batch, orders, stock, settings.
  // (Reports and Audit Trail keep their own module levels.)
  function operationPageLevel(name) {
    const op = permissions().operation_pages;
    const v = op && op[name];
    return VALID_LEVELS.has(v) ? v : 'normal'; // unset = allowed
  }

  // ── Per-FUNCTION access inside the operation module ──────────────
  // canDoOperation(page, action) is the single gate every operation page
  // should use. When the user has an operation_actions entry for the page
  // it is authoritative (unticked = denied). Otherwise the answer is
  // derived from the legacy fields so pre-existing users are unaffected:
  //   view        → operation_pages level (or module level for reports /
  //                 audit_trail, which historically live in modules)
  //   verify      → can_verify_operation flag, or operation admin
  //   review      → operation admin (mark reviewed / reject / unreview)
  //   delete      → operation admin
  //   clear_logs  → audit_trail admin
  //   anything else (add_new, fill_report, manage…) → allowed when the
  //                 page itself is open (the legacy "normal" behaviour)
  const MODULE_STORED_PAGES = new Set(['reports', 'audit_trail']);

  function canDoOperation(page, action) {
    const p = permissions();
    const acts = p.operation_actions && p.operation_actions[page];
    if (acts) {
      // The module itself must still be open for this user (set on the
      // main portal). Reports/Audit Trail are their own module entries,
      // mirrored to modules.* on save, so the tick below is the grant.
      if (!MODULE_STORED_PAGES.has(page) && !canAccess('operation')) return false;
      if (!acts.view) return false;      // page closed → every function closed
      if (action === 'view') return true;
      return !!acts[action];
    }
    // Legacy fallback.
    const viewOk = MODULE_STORED_PAGES.has(page)
      ? canAccess(page)
      : (canAccess('operation') && operationPageLevel(page) !== 'none');
    if (action === 'view') return viewOk;
    if (!viewOk) return false;
    switch (action) {
      case 'verify':     return !!p.can_verify_operation || isAdminOf('operation');
      case 'review':     return isAdminOf('operation');
      case 'delete':     return isAdminOf('operation');
      case 'clear_logs': return isAdminOf('audit_trail');
      default:           return true; // add_new, fill_report, manage…
    }
  }

  // Click-time guard for write actions: returns true when allowed,
  // otherwise alerts and returns false so the caller can just bail out.
  function requireOperationAction(page, action, message) {
    if (canDoOperation(page, action)) return true;
    try {
      alert(message || 'Access denied — you do not have permission for this action. Ask an admin to grant it in User Access.');
    } catch (e) { /* non-browser context */ }
    return false;
  }

  function canOpenOperationPage(name) { return canDoOperation(name, 'view'); }

  // ── The same gate, for any module ────────────────────────────────
  // canDo('nursery_ops', 'maintenance', 'edit_schedule')
  //
  // Reads permissions.<module>_actions.<page>, which the module's own User
  // Access page writes. When that entry is present it is authoritative: the
  // module must be open, the page must be ticked open, and the function must
  // be ticked. When it is absent nothing has been decided for this user, so
  // the answer is the module level — the behaviour before per-function access
  // existed, which keeps every existing user working until an admin sets them.
  //
  // Operation keeps its own function above: it carries legacy fields
  // (can_verify_operation, reports/audit_trail stored under modules) that this
  // generic version has no business knowing about.
  function canDo(moduleName, page, action) {
    if (moduleName === 'operation') return canDoOperation(page, action);
    const p = permissions();
    if (!canAccess(moduleName)) return false;
    const acts = p[moduleName + '_actions'] && p[moduleName + '_actions'][page];
    if (acts) {
      if (!acts.view) return false;          // page closed → every function closed
      if (action === 'view') return true;
      return !!acts[action];
    }
    // Nothing set for this user: the module level decides, as it always did.
    return true;
  }
  function canOpenPage(moduleName, page) { return canDo(moduleName, page, 'view'); }

  // Click-time guard for write actions: true when allowed, otherwise alerts
  // and returns false so the caller can bail out.
  function requireAction(moduleName, page, action, message) {
    if (canDo(moduleName, page, action)) return true;
    try {
      alert(message || 'Access denied — you do not have permission for this action. Ask an admin to grant it in User Access.');
    } catch (e) { /* non-browser context */ }
    return false;
  }

  // Convenience for batch-detail tab review gating.
  function canReviewOperation() { return canDoOperation('batch', 'review'); }

  // Two-person batch verification: Verifier tick (or operation admin under
  // the legacy shape) may verify a tab; only reviewers may then mark it
  // as reviewed.
  function canVerifyOperation() { return canDoOperation('batch', 'verify'); }

  /**
   * Redirect away from a module page if the user lacks access.
   * Call after MJMAccess.load(supa).
   *   MJMAccess.guard('operation', 'operation_dashboard.html');
   */
  function guard(moduleName, redirectTo) {
    if (!canAccess(moduleName)) {
      window.location.href = redirectTo || '../index.html';
      return false;
    }
    return true;
  }

  global.MJMAccess = {
    load,
    user,
    permissions,
    moduleLevel,
    canAccess,
    isAdminOf,
    canManageUsers,
    canReviewOperation,
    canVerifyOperation,
    operationPageLevel,
    canOpenOperationPage,
    canDoOperation,
    requireOperationAction,
    canDo,
    canOpenPage,
    requireAction,
    guard
  };
})(window);
