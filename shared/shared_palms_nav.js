/* ================================================================
   PALMS — the side bar
   shared/shared_palms_nav.js

   PALMS is four pages: the monitoring board, Life of Plot, the motion
   study and its settings. All four are readings of the SAME record —
   the plot log the Field Conductor keeps in the FC Portal
   (fcportal_palms_plot_logs) — which is what makes them one module
   rather than four pages that happen to be filed together, and why the
   settings page belongs with them: the ideal durations it holds are
   what the board calls a plot late by.

   So they share a side bar, and the bar is where you move between them.
   It also carries the way out, back to Nursery Operation Manage, which
   is a different thing from moving around inside PALMS and is kept
   visually apart from the four for that reason.

   Usage — a mount point where the bar should sit:

     <aside id="palms-nav" data-page="board"></aside>
     <script src="../shared/shared_palms_nav.js"></script>

   data-page is one of the keys in PAGES. An unknown key, or none, marks
   nothing current — a page not in the bar can still show it to get out.

   STYLING NOTE. Everything here is a class in the injected <style>, not
   an inline style attribute. That is deliberate: an inline declaration
   outranks a stylesheet one whatever the selector, so a bar styled
   inline could not be narrowed by a media query — which is exactly the
   bug the ribbon carried, where its phone title never applied and an
   867px title was clipped into 372px of bar. The bar has to change shape
   on a phone, so it cannot be built that way.
   ================================================================ */
(function (global) {

  /* Hrefs are relative to nursery_ops/, where these live.

     Life of Plot is deliberately NOT in this strip. It is still a page and
     still reached from the Nursery Operation Manage dashboard; it simply is
     not one of PALMS's own three. A page that is not listed can still mount
     the strip to get out of — an unknown data-page marks nothing current. */
  var PAGES = [
    { key: 'board',    label: 'Plot Status Map',  icon: '🪴', href: 'nursery_ops_palms_board.html' },
    { key: 'motion',   label: 'Plot Motion Study', icon: '⏱️', href: 'nursery_ops_palms_motion.html' },
    /* nursery_ops_settings.html is the MAINTENANCE module's work types
       (P&D, Manuring, Weeding, Interrow) and is read by the monthly
       schedule — it is not PALMS and must not be reached from this strip.
       PALMS's own setting is the stage list a plot moves through. */
    { key: 'settings', label: 'Settings',         icon: '⚙️', href: 'nursery_ops_palms_stages.html' },
  ];

  /* The two-column frame lives here, not in the host page's Tailwind.
     These pages pull Tailwind from a CDN, so a layout written as
     `md:grid-cols-[212px_minmax(0,1fr)]` is a layout that exists only if
     that CDN answered — and one that cannot be checked anywhere the CDN
     is unreachable. The bar owns its own geometry instead: .palms-frame
     on the page's #main, .palms-body on the content beside it. */
  var CSS =
    '.palms-frame{display:block;}' +
    '.palms-body{min-width:0;}' +
    '@media(min-width:768px){.palms-frame{display:grid;' +
      'grid-template-columns:212px minmax(0,1fr);gap:28px;align-items:start;}}' +
    '#palms-nav{display:block;font-family:Outfit,system-ui,-apple-system,sans-serif;}' +
    '#palms-nav .pn-out{display:flex;align-items:center;gap:8px;padding:10px 13px;border-radius:12px;' +
      'background:#f8fafc;border:1px solid #e2e8f0;color:#475569;text-decoration:none;' +
      'font-size:11px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;' +
      'line-height:1.25;transition:background .15s,color .15s;}' +
    '#palms-nav .pn-out:hover{background:#f1f5f9;color:#0f172a;}' +
    /* The four pages, held apart from the way out by a rule rather than
       by distance alone, so the bar reads as "leave" then "inside". */
    '#palms-nav .pn-group{margin-top:14px;padding-top:14px;border-top:1px solid #ccfbf1;' +
      'display:flex;flex-direction:column;gap:4px;}' +
    '#palms-nav .pn-cap{font-size:9.5px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;' +
      'color:#5eead4;padding:0 4px 7px;}' +
    '#palms-nav .pn-tab{display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:12px;' +
      'text-decoration:none;font-size:12.5px;font-weight:800;color:#0f766e;background:transparent;' +
      'border:1px solid transparent;line-height:1.25;transition:background .15s,color .15s;}' +
    '#palms-nav .pn-tab:hover{background:#ccfbf1;}' +
    '#palms-nav .pn-tab.is-on{background:#0f766e;color:#fff;}' +
    '#palms-nav .pn-tab.is-on:hover{background:#115e59;}' +
    '#palms-nav .pn-ico{font-size:14px;line-height:1;flex:0 0 auto;}' +
    /* Desktop: a real column that stays put while a long board scrolls
       past it. 84px clears the ribbon, which is sticky. */
    '@media(min-width:768px){#palms-nav{position:sticky;top:84px;align-self:start;}}' +
    /* Phone: the column becomes a row above the content — a 212px column
       beside a table on a 412px screen leaves neither of them usable.
       The four scroll sideways if they have to, and the way out stays on
       its own line above them. */
    '@media(max-width:767px){' +
      '#palms-nav .pn-group{margin-top:10px;padding-top:10px;flex-direction:row;overflow-x:auto;' +
        'gap:6px;-webkit-overflow-scrolling:touch;scrollbar-width:none;}' +
      '#palms-nav .pn-group::-webkit-scrollbar{display:none;}' +
      '#palms-nav .pn-cap{display:none;}' +
      '#palms-nav .pn-tab{flex:0 0 auto;background:#f0fdfa;border-color:#99f6e4;font-size:12px;padding:9px 13px;}' +
      '#palms-nav .pn-out{justify-content:center;}' +
    '}';

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function html(current) {
    var tabs = PAGES.map(function (p) {
      var on = p.key === current;
      return '<a class="pn-tab' + (on ? ' is-on' : '') + '" href="' + esc(p.href) + '"' +
             (on ? ' aria-current="page"' : '') + '>' +
               '<span class="pn-ico" aria-hidden="true">' + p.icon + '</span>' +
               '<span>' + esc(p.label) + '</span>' +
             '</a>';
    }).join('');

    return '' +
      '<nav aria-label="PALMS">' +
        '<a class="pn-out" href="nursery_ops_dashboard.html">' +
          '<span aria-hidden="true">&#8592;</span>' +
          '<span>Back to Operation Manage Page</span>' +
        '</a>' +
        '<div class="pn-group">' +
          '<div class="pn-cap">PALMS</div>' + tabs +
        '</div>' +
      '</nav>' +
      '<style>' + CSS + '</style>';
  }

  function mount() {
    var host = document.getElementById('palms-nav');
    if (!host) return;
    host.innerHTML = html((host.dataset && host.dataset.page) || '');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  global.MJMPalmsNav = { mount: mount, pages: PAGES };

})(window);
