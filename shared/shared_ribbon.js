/* ═══════════════════════════════════════════════════════════════
   MJM Nursery AI — Standardised top ribbon
   ═══════════════════════════════════════════════════════════════
   Mounts the same header strip on every module page:

       [AI] MJM NURSERY AI          Welcome, name   [← Portal]  [Sign Out]

   Usage:
     <div id="mjm-ribbon"></div>                 <!-- where the ribbon renders -->
     <script src="../shared/shared_ribbon.js"></script>

   The mount point ID is fixed (`mjm-ribbon`) so pages don't repeat markup.
   Styles are inline so this works on pages with Tailwind and without.

   Depends on window._supabase (loaded via shared_supabase.js) for the
   welcome name and sign-out. If it's absent the ribbon still renders,
   only the welcome text stays blank and Sign Out becomes a plain
   navigation back to the portal.

   The portal path is derived from this script's own src — one folder
   deep → `../index.html`; at the site root → `index.html`. This keeps
   every page dropping the same `<script src=...>` regardless of depth.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Resolve portal href from this script's src ─────────────────
  //    Any depth ≥ 1 → ../index.html (e.g. /operation/foo.html)
  //    Root         → index.html    (e.g. /user_access.html)
  function _portalHref() {
    try {
      var src = document.currentScript && document.currentScript.getAttribute('src');
      if (src && src.startsWith('shared/')) return 'index.html';   // page at root
      return '../index.html';                                       // page in a subfolder
    } catch (_) {
      return '../index.html';
    }
  }

  var PORTAL = _portalHref();

  // ── Ribbon markup — inline styles so it renders identically on
  //    Tailwind and non-Tailwind pages ────────────────────────────
  var RIBBON_HTML =
    '<div style="background:#fff;border-bottom:1px solid #e2e8f0;padding:14px 24px;' +
              'display:flex;justify-content:space-between;align-items:center;position:sticky;' +
              'top:0;z-index:40;box-shadow:0 1px 3px rgba(0,0,0,.06);' +
              'font-family:Outfit,system-ui,-apple-system,sans-serif;">' +
      '<div style="display:flex;align-items:center;gap:12px;min-width:0;">' +
        '<div style="width:32px;height:32px;background:#10b981;border-radius:8px;' +
                    'display:flex;align-items:center;justify-content:center;color:#fff;' +
                    'font-weight:900;font-size:11px;flex-shrink:0;">AI</div>' +
        '<span style="font-weight:900;color:#1e293b;text-transform:uppercase;letter-spacing:.15em;' +
                     'font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">MJM Nursery AI</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:12px;flex-shrink:0;">' +
        '<span id="welcome-text" style="font-size:12px;font-weight:700;color:#94a3b8;white-space:nowrap;" class="mjm-rb-hide-sm"></span>' +
        '<a id="portal-link" href="' + PORTAL + '" ' +
           'style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.15em;' +
                  'background:#f8fafc;padding:8px 16px;border-radius:999px;border:1px solid #e2e8f0;' +
                  'cursor:pointer;text-decoration:none;transition:all .15s;white-space:nowrap;">&#8592; Portal</a>' +
        '<button id="logout-btn" type="button" ' +
                'style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.15em;' +
                       'background:#f8fafc;padding:8px 16px;border-radius:999px;border:1px solid #e2e8f0;' +
                       'cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap;">Sign Out</button>' +
      '</div>' +
    '</div>' +
    '<style>' +
      '#mjm-ribbon a#portal-link:hover{background:#ecfdf5;color:#059669;border-color:#a7f3d0;}' +
      '#mjm-ribbon button#logout-btn:hover{background:#fef2f2;color:#dc2626;border-color:#fecaca;}' +
      '@media(max-width:640px){#mjm-ribbon .mjm-rb-hide-sm{display:none !important;}}' +
    '</style>';

  // ── Mount ripple: render into the fixed mount point ────────────
  function mount() {
    var host = document.getElementById('mjm-ribbon');
    if (!host) return;                            // page didn't ask for the ribbon
    if (host.dataset.mjmRbMounted === '1') return; // idempotent
    host.dataset.mjmRbMounted = '1';
    host.innerHTML = RIBBON_HTML;
    // Portal click: replace() (fresh navigator-lock context) instead of an
    // in-place navigation that could keep the auth mutex held.
    var link = host.querySelector('#portal-link');
    if (link) link.addEventListener('click', function (e) {
      e.preventDefault();
      window.location.replace(PORTAL);
    });
    var out = host.querySelector('#logout-btn');
    if (out) out.addEventListener('click', function () { window.handleLogout(); });
    _fillWelcome();
  }

  // ── Welcome text — best-effort read from Supabase session.
  //    Pages load shared_supabase.js at different points in the body
  //    (audit_home.html, for instance, loads it after this script), so
  //    poll for it briefly before giving up. ─────────────────────
  async function _fillWelcome(retries) {
    if (retries === undefined) retries = 20;   // ~4 s of grace
    if (!window._supabase) {
      if (retries > 0) return setTimeout(function () { _fillWelcome(retries - 1); }, 200);
      return;
    }
    try {
      var s = await window._supabase.auth.getSession();
      var sess = s && s.data && s.data.session;
      if (!sess) return;
      var name = (sess.user && sess.user.user_metadata && sess.user.user_metadata.full_name)
              || (sess.user && sess.user.email)
              || '';
      var el = document.getElementById('welcome-text');
      if (el && name) el.innerText = 'Welcome, ' + name;
    } catch (_) { /* silent */ }
  }

  // ── Sign Out — matches operation_dashboard's proven pattern:
  //    scrub every persistence layer, race signOut against a 1.5s timeout
  //    (Supabase's navigator-lock can stall behind in-flight page queries),
  //    then leave for a fresh page so the lock context resets. ──
  window.handleLogout = async function () {
    var btn = document.getElementById('logout-btn');
    if (btn) { btn.innerText = 'Signing Out…'; btn.disabled = true; }
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('sb-') === 0) localStorage.removeItem(k);
      });
      Object.keys(sessionStorage).forEach(function (k) {
        if (k.indexOf('sb-') === 0 || k === 'mjm_session_active') sessionStorage.removeItem(k);
      });
    } catch (_) {}
    try {
      await Promise.race([
        window._supabase && window._supabase.auth.signOut({ scope: 'local' }),
        new Promise(function (r) { setTimeout(r, 1500); })
      ]);
    } catch (_) {}
    window.location.replace(PORTAL);
  };

  // Ready or later, mount when the DOM has the placeholder.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
