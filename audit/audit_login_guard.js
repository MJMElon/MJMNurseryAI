/* BUILD: 2026-08-24a */
/* ================================================================
   MJM NURSERY — WHERE THE AUDIT MODULE SENDS YOU TO SIGN IN

   Every audit page routes unauthenticated visitors to the 555 Auditor
   Portal (audit_index.html). It is a thin skin over the same Supabase
   Auth the main MJM AI login uses — the same email/password works, the
   same mjm_user object and sb-*-auth-token session land in localStorage
   — so signing in here is interchangeable with signing in at the root.
   Admin who wants the module hub still has the "Back to Portal" button
   on audit_admin.html to reach ../index.html.

   The auditor login used to redirect to ../index.html (MJM AI System)
   as its default, and only fell through to audit_index.html when the
   device was offline. That meant the field-facing "555 Auditor Portal"
   rebrand was never the door anyone actually saw — everyone landed on
   the generic system login. This build flips that: the audit portal is
   the primary door, and it works online and off the same way.

   Loaded in the <head>, above each page's own script, so a page nobody
   is entitled to redirects before it renders rather than flashing.
================================================================ */
(function (global) {

  /* Always the 555 Auditor Portal. Same Supabase session as the main
     login, so a sign-in here is a sign-in everywhere. */
  function loginUrl() {
    return 'audit_index.html';
  }

  /* Signed in at all? Sends them to sign in and reports false if not, so a
     caller can stop rather than carry on against a half-built page. */
  function requireSignIn() {
    try {
      if (localStorage.getItem('mjm_user')) return true;
    } catch (e) {}
    global.location.replace(loginUrl());
    return false;
  }

  /* Duplicated from isAuditAdmin() in audit_supabase.js on purpose: this
     runs in the head, above that file, so a page it guards never renders
     for the wrong person. Keep the two in step. */
  function isAdmin() {
    try {
      var u = JSON.parse(localStorage.getItem('mjm_user') || '{}');
      var mod = u.permissions && u.permissions.modules && u.permissions.modules.audit;
      if (mod === 'admin') return true;
      // Explicit non-admin level → the legacy fallback below MUST NOT
      // promote a normal auditor whose profile role happens to be 'admin'
      // for another module. Only fall through when audit is unset entirely.
      if (mod !== undefined && mod !== null && mod !== '') return false;
      var role = (u.audit_role || u.role || '').toLowerCase();
      return role === 'admin' || role === 'administrator';
    } catch (e) { return false; }
  }

  /* Admin-only page. Not signed in goes to the login; signed in but not an
     admin goes wherever the caller says they belong.

     The default is the auditor view, which is right when someone is being
     turned away from a page (the report). audit_admin.html passes the
     nursery chooser instead, because that page is what the portal's Nursery
     Audit tile opens: a normal account tapping the tile should arrive at
     the chooser, not bounce through the auditor view to reach it. */
  function requireAdmin(fallback) {
    if (!requireSignIn()) return false;
    if (isAdmin()) return true;
    global.location.replace(fallback || 'audit_home.html');
    return false;
  }

  /* Best-effort revoke of the refresh token, so signing out on a shared or
     lost phone ends the session server-side too and not just in this
     browser. keepalive, because the page is navigating away as it fires.
     The project ref is taken from the storage key rather than hardcoded. */
  function revokeSession() {
    try {
      var key = null;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /^sb-.+-auth-token$/.test(k)) { key = k; break; }
      }
      if (!key || typeof SUPA_KEY === 'undefined') return;
      var sess = JSON.parse(localStorage.getItem(key) || 'null');
      if (!sess || !sess.access_token) return;
      var ref = key.slice(3, key.length - '-auth-token'.length);
      fetch('https://' + ref + '.supabase.co/auth/v1/logout', {
        method: 'POST',
        keepalive: true,
        headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + sess.access_token }
      }).catch(function () {});
    } catch (e) {}
  }

  /* ── SIGNING OUT ──
     This used to remove mjm_user and stop there. It also tried
     sb._client.auth.signOut() and window._supaClient — neither of which
     exists, so the whole block was dead and the Supabase session simply
     stayed alive. Sign out of audit and you landed on the portal, which
     found a live session and showed the module hub: signed out of one
     module, still signed in to everything.

     Three things have to go, or the next page just lets you back in:
     the audit user, the Supabase session, and the portal's
     mjm_session_active flag — index.html skips its own session gate while
     that flag is set. */
  function signOut() {
    revokeSession();
    clearScope();
    try {
      localStorage.removeItem('mjm_user');
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('sb-') === 0) localStorage.removeItem(k);
      });
      sessionStorage.removeItem('mjm_session_active');
    } catch (e) {}
    global.location.replace(loginUrl());
  }

  /* ── WHICH NURSERY THIS SESSION IS FOR ──
     Keyed by account rather than stored flat: the nursery office phone is
     shared, and a flat key would hand the next person to sign in the last
     person's choice. Cleared on sign-out for the same reason. */
  function scopeKey() {
    var u = {};
    try { u = JSON.parse(localStorage.getItem('mjm_user') || '{}'); } catch (e) {}
    return 'mjm_nursery_scope:' + (u.id || u.email || 'anon');
  }
  function scope() {
    try { return localStorage.getItem(scopeKey()); } catch (e) { return null; }
  }
  function setScope(v) {
    try { localStorage.setItem(scopeKey(), v); } catch (e) {}
  }
  function clearScope() {
    try { localStorage.removeItem(scopeKey()); } catch (e) {}
  }

  /* Which nurseries this account may audit: both, for everybody.

     This used to be inferred from the role string — "Auditor PN" was held
     to the pre nursery — which meant the chooser silently offered one card
     to anyone whose role happened to name a nursery, and a plain "Auditor"
     was given the main nursery and nothing else. Guessing access from free
     text was the problem; both nurseries are offered now and the choice is
     the auditor's.

     If per-person limits are wanted later they belong in User Access,
     alongside the other permissions, not in a substring match on a job
     title. audit_home builds its rows from this same answer, so the two
     cannot disagree. */
  function allowedScopes() {
    return ['PN', 'MN'];
  }

  global.MJMAuditLogin = {
    url: loginUrl,
    requireSignIn: requireSignIn,
    requireAdmin: requireAdmin,
    isAdmin: isAdmin,
    signOut: signOut,
    scope: scope,
    setScope: setScope,
    clearScope: clearScope,
    allowedScopes: allowedScopes
  };
})(window);
