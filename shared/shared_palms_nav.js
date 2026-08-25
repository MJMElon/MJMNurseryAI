/* ================================================================
   PALMS — the tab strip
   shared/shared_palms_nav.js

   PALMS used to be four tiles on the Nursery Operation Manage
   dashboard: the board, Life of Plot, the motion study and its
   settings. Four tiles side by side said nothing about the four being
   one thing, and the dashboard was mostly PALMS by tile count while
   PALMS is one of three jobs the module does.

   So the dashboard has one PALMS tile now, and this is what you get
   once you are through it: the same strip on every PALMS page, with
   the page you are on marked. Getting from the board to the motion
   study no longer means going back out to the dashboard first.

   All four are readings of the SAME record — the plot log the Field
   Conductor keeps in the FC Portal (fcportal_palms_plot_logs). That is
   what makes them one module rather than four pages that happen to be
   filed together, and it is why the settings page belongs here: the
   ideal durations it holds are what the board calls a plot late by and
   what the motion study measures against.

   Usage — a mount point, anywhere on the page:

     <div id="palms-nav" data-page="board"></div>
     <script src="../shared/shared_palms_nav.js"></script>

   data-page is one of the keys in PAGES below. An unknown key, or none,
   simply marks nothing current — a page that is not in the strip can
   still show the strip to get out of.

   Inline styles, like shared_ribbon.js, so it renders the same whether
   the host page has Tailwind or not.
   ================================================================ */
(function (global) {

  /* Href is relative to nursery_ops/, which is where all four live. */
  var PAGES = [
    { key: 'board',    label: 'Board',        icon: '🪴', href: 'nursery_ops_palms_board.html' },
    { key: 'life',     label: 'Life of Plot', icon: '🌱', href: 'nursery_ops_plot_life.html' },
    { key: 'motion',   label: 'Motion Study', icon: '⏱️', href: 'nursery_ops_palms_motion.html' },
    { key: 'settings', label: 'Settings',     icon: '⚙️', href: 'nursery_ops_settings.html' },
  ];

  var BASE =
    'display:inline-flex;align-items:center;gap:7px;padding:8px 15px;border-radius:999px;' +
    'font-size:12px;font-weight:800;text-decoration:none;white-space:nowrap;' +
    'border:1px solid transparent;transition:background .15s,color .15s;';

  /* The current page is a filled tab, not a link that looks pressed —
     it stays an <a> to its own href so a tap on it is a reload rather
     than nothing happening, which is what a dead tab feels like. */
  var ON  = BASE + 'background:#0f766e;color:#fff;';
  var OFF = BASE + 'background:#f0fdfa;color:#0f766e;border-color:#99f6e4;';

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function html(current) {
    var tabs = PAGES.map(function (p) {
      var on = p.key === current;
      return '<a class="palms-nav-tab' + (on ? ' is-on' : '') + '" href="' + esc(p.href) + '"' +
             (on ? ' aria-current="page"' : '') +
             ' style="' + (on ? ON : OFF) + '">' +
               '<span aria-hidden="true">' + p.icon + '</span>' + esc(p.label) +
             '</a>';
    }).join('');

    return '' +
      '<nav aria-label="PALMS" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;' +
                 'font-family:Outfit,system-ui,-apple-system,sans-serif;">' +
        /* Out of PALMS entirely, kept visually apart from the four tabs
           so it does not read as a fifth one. */
        '<a href="nursery_ops_dashboard.html" style="' + BASE +
           'background:#f8fafc;color:#64748b;border-color:#e2e8f0;margin-right:4px;">' +
          '&#8592; Module</a>' +
        tabs +
      '</nav>' +
      '<style>#palms-nav .palms-nav-tab:hover{background:#ccfbf1;}' +
             '#palms-nav .palms-nav-tab.is-on:hover{background:#115e59;}</style>';
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
