/* ══════════════════════════════════════════════════════════════════
   555 AUDITOR PORTAL — top-ribbon welcome name
   ══════════════════════════════════════════════════════════════════
   Small helper that fills in the "Welcome, <name>" text on the shared
   FC-style ribbon (see audit_ribbon.css). The ribbon is written in each
   page's static markup rather than injected, because the pages need to
   render before any script runs — this only patches the name in once
   the mjm_user object is available in localStorage.

   Kept as its own file so a page can drop the FC ribbon in with two
   lines: a stylesheet link and this script tag. Nothing else is
   required — the pill onclick handlers wire straight to whatever
   sign-out and language functions the page already defines.
   ══════════════════════════════════════════════════════════════════ */
(function(){
  function fill(){
    var el = document.getElementById('fcr-welcome');
    if (!el) return;
    var name = '';
    try {
      var u = JSON.parse(localStorage.getItem('mjm_user') || '{}');
      /* Prefer explicit `name`, fall back to full_name (main portal), then
         the email prefix — same order the audit login page uses. */
      name = u.name || u.full_name || (u.email && u.email.split('@')[0]) || '';
    } catch (e) {}
    if (!name) return;
    /* First two words at most, so a five-word Malay name does not push
       the pills off the row on a phone. */
    var short = name.split(' ').slice(0, 2).join(' ');
    el.textContent = 'Welcome, ' + short;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fill);
  } else {
    fill();
  }
})();
