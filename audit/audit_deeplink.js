/* ══════════════════════════════════════════════════════════════════
   555 AUDITOR PORTAL — ARRIVING ON A PARTICULAR PLOT
   ══════════════════════════════════════════════════════════════════
   The portal's to-do list names the plots that still owe work, as a
   row of circles under each row (see audit_pending.js). Tapping one
   has to land on that plot, not merely on the module's front page —
   otherwise the circle has told the auditor which plot to walk and
   then made them find it again in a grid of fifty-two.

   The link carries ?plot=<code> alongside the ?nursery= the modules
   already understood. What a page does with it depends on what the
   page is:

     Plot Condition, Seedling Height — a grid of plots, so the plot
       has a screen of its own. They pass an opener and it is called.

     Papan Tanda, Maintenance — a list, so there is nothing to open.
       The row is scrolled to and flashed instead, which is the same
       promise kept in the shape those pages have.

   An unknown or out-of-scope plot is ignored rather than corrected:
   the page opens where it would have anyway. A stale bookmark should
   not be an error message.
   ══════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  /* Padded form, matching the plot lists the modules iterate. Same
     regex the module scripts and audit_pending.js use. */
  function canon(raw){
    const s = String(raw || '').trim().toUpperCase();
    const m = s.match(/^([A-Z]+)(\d+)(-R)?$/);
    return m ? m[1] + m[2].padStart(2,'0') + (m[3] || '') : s;
  }

  /* The plot asked for in the URL, or ''. */
  function wanted(){
    try {
      return canon(new URLSearchParams(location.search).get('plot') || '');
    } catch (e) { return ''; }
  }

  /* The flash. Injected from here so a page can adopt the deep link by
     loading this one file — four stylesheets each growing the same
     keyframes is how they drift apart. */
  let styled = false;
  function ensureStyle(){
    if (styled) return;
    styled = true;
    const el = document.createElement('style');
    el.textContent =
      '@keyframes mjm-dl-flash{' +
        '0%,100%{box-shadow:0 0 0 0 rgba(45,122,45,0)}' +
        '35%{box-shadow:0 0 0 5px rgba(45,122,45,.32)}' +
      '}' +
      '.mjm-dl-focus{animation:mjm-dl-flash 1.1s ease-in-out 2;' +
        'border-radius:12px;scroll-margin-top:96px}' +
      '@media (prefers-reduced-motion:reduce){' +
        '.mjm-dl-focus{animation:none;outline:2.5px solid rgba(45,122,45,.7);' +
          'outline-offset:2px}' +
      '}';
    document.head.appendChild(el);
  }

  /* Scroll a list row into view and flash it. Returns false when the
     plot is not on the page — the caller has nothing to do about it,
     but it makes the "did this work" question answerable in a console. */
  function reveal(plot){
    const p = canon(plot || wanted());
    if (!p) return false;
    const el = document.querySelector('[data-plot="' + p + '"]');
    if (!el) return false;
    ensureStyle();
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      el.scrollIntoView();          /* older WebViews take no options */
    }
    el.classList.add('mjm-dl-focus');
    setTimeout(() => el.classList.remove('mjm-dl-focus'), 2600);
    return true;
  }

  /* For the grid pages: hand over an opener and it is called once, with
     the canonical plot code, if the URL named one this nursery has.

     `plots` is the nursery's own plot list — an out-of-scope code (a
     main-nursery plot on a link opened while the app is in pre nursery)
     is dropped rather than opened onto an empty detail screen. */
  function openPlot(plots, open){
    const p = wanted();
    if (!p || typeof open !== 'function') return false;
    if (Array.isArray(plots) && plots.length && plots.indexOf(p) === -1) return false;
    open(p);
    return true;
  }

  global.MJMAuditDeepLink = {
    plot: wanted,
    reveal: reveal,
    openPlot: openPlot
  };

})(window);
