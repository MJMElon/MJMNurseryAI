/* BUILD: 2026-08-18b */
/* ================================================================
   MJM NURSERY — WHERE THE AUDIT MODULE SENDS YOU TO SIGN IN

   The audit module used to carry its own login page. Two doors onto
   one system meant two sessions written two different ways, and the
   audit door was the only one that stored a usable one — signing in at
   the portal left every audit page thinking you were a nobody.

   There is one login now: the MJM AI System page at the root.

   audit_index.html survives for exactly one job. The portal login needs
   Supabase Auth, so it cannot sign anyone in without signal, and this
   module is used on phones in nurseries. When the device is offline and
   has credentials cached from a previous sign-in, that page can still
   let an auditor in; nothing else can. So offline falls back to it.

   Loaded in the <head>, above each page's own script, so a page nobody
   is entitled to redirects before it renders rather than flashing.
================================================================ */
(function (global) {

  function loginUrl() {
    try {
      if (!navigator.onLine && localStorage.getItem('mjm_cached_creds'))
        return 'audit_index.html';
    } catch (e) {}
    return '../index.html';
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
     admin goes to the view they are entitled to. */
  function requireAdmin() {
    if (!requireSignIn()) return false;
    if (isAdmin()) return true;
    global.location.replace('audit_home.html');
    return false;
  }

  global.MJMAuditLogin = {
    url: loginUrl,
    requireSignIn: requireSignIn,
    requireAdmin: requireAdmin,
    isAdmin: isAdmin
  };
})(window);
