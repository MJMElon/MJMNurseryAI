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

  /* ── OPENED FROM THE MANAGE PAGE ──
     A module page carries ?from=manage when audit_admin.html sent the
     person into it. It is not a permission — it says where they came
     from, and two things follow from that.

     The first is that they asked for the module, not for the To Do
     list. Three of the four modules bounce a visitor with no ?plot=
     straight back to audit_home.html, on the reasoning that the
     auditor's way in is a pending-plot chip and a bare plot grid is
     redundant. That reasoning is the phone's. Somebody who pressed
     "Plot Condition Audit" on the manage page asked for the module by
     name and got the auditor portal instead.

     The second is the nursery. The stored scope is a field auditor's
     working set — one nursery at a time, flipped with the Switch pill
     — and it is the right default for the phone. On the manage page it
     is not: what is on screen there is both nurseries at once, side by
     side, and stepping into a module from it should not silently drop
     half of that because of a switch made on a phone last week. From
     the manage page every nursery is in scope. */
  function fromManage() {
    try {
      return new URLSearchParams(global.location.search).get('from') === 'manage';
    } catch (e) { return false; }
  }

  /* The nursery tabs a module page should show, as the four module
     scripts each used to work out for themselves — the same PN/MN
     mapping written four times, under three different names. One copy
     now, and it is where the manage-page override belongs. */
  function scopeNurseries() {
    if (fromManage()) return ['PN', 'BNN', 'UNN1', 'UNN2'];
    var s = scope() || '';
    if (s === 'PN') return ['PN'];
    if (s === 'MN') return ['BNN', 'UNN1', 'UNN2'];
    return ['PN', 'BNN', 'UNN1', 'UNN2'];      // scope unknown → show all
  }

  /* The way back, for a module page opened from Manage. All four carry
     the same `.top-bar-back` anchor pointing at audit_home.html, which
     is the right answer for an auditor and the wrong one here: it drops
     an admin on the auditor portal, a page they did not come from and
     have to navigate out of. Retargeted here rather than in each of the
     four scripts, because the anchor is identical in all four. */
  function retargetBack() {
    if (!fromManage()) return;
    var a = global.document && global.document.querySelector('.top-bar-back');
    if (!a) return;
    a.setAttribute('href', 'audit_admin.html');
    a.setAttribute('title', 'Back to manage');
    a.setAttribute('aria-label', 'Back to manage');
    /* Plot Condition and Seedling Height put a goBack() on this anchor
       that returns true so the href decides. Nothing to undo — but if a
       page ever preventDefaults it, this keeps the destination honest. */
    a.onclick = null;
  }
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', retargetBack);
    } else {
      retargetBack();
    }
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
    allowedScopes: allowedScopes,
    fromManage: fromManage,
    scopeNurseries: scopeNurseries
  };
})(window);
