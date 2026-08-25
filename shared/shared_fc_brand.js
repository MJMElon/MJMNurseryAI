/* ================================================================
   555 FC Portal — the ribbon's wordmark, on the portal's own pages
   shared/shared_fc_brand.js

   The standard ribbon opens with an [AI] square and "MJM NURSERY AI".
   The FC Portal's own pages in this system wear the portal's mark
   instead, stacked the way the phone app's header is:

       555                 the exercise-book logotype, as on the login
       MJM Nursery
       FC PORTAL <sub>     Manage, Setting, …

   Only these pages. Every other module keeps the standard ribbon, so
   this is a per-page swap and not a change to what everybody loads.

   Load it AFTER shared_ribbon.js and set the mount point to
   data-logo="off" data-brand="":

       <div id="mjm-ribbon" data-logo="off" data-brand=""></div>
       <script src="../shared/shared_ribbon.js"></script>
       <script src="../shared/shared_fc_brand.js" data-sub="Manage"></script>

   The ribbon mounts on DOMContentLoaded when the page is still
   parsing, which is every normal case — so this cannot simply run and
   assume the bar is there. It tries now and again when the DOM is
   ready, and gives up quietly: a page wearing the standard wordmark is
   a worse header, not a broken page.
   ================================================================ */
(function () {
  var me = document.currentScript;
  var sub = (me && me.dataset && me.dataset.sub) || '';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function paint() {
    var slot = document.querySelector('#mjm-ribbon > div > div:first-child');
    if (!slot) return false;
    slot.innerHTML =
      '<div style="line-height:1;min-width:0;">' +
        // The 555 of the exercise book: red, italic, stacked shadow.
        '<div style="font-family:Outfit,system-ui,sans-serif;font-weight:900;font-style:italic;' +
                    'font-size:26px;letter-spacing:-.02em;color:#e23b4b;' +
                    '-webkit-text-stroke:.8px #fff5f6;paint-order:stroke fill;' +
                    'text-shadow:1px 1px 0 #a5121f,2px 2px 0 #a5121f,3px 3px 0 #8e0f1b;' +
                    'transform:rotate(-1.2deg);display:inline-block;">555</div>' +
        '<div style="font-weight:900;color:#1e293b;font-size:12.5px;margin-top:3px;' +
                    'white-space:nowrap;">MJM Nursery</div>' +
        '<div style="font-weight:900;color:#059669;font-size:9px;text-transform:uppercase;' +
                    'letter-spacing:.18em;margin-top:1px;white-space:nowrap;">' +
          'FC Portal' + (sub ? ' ' + esc(sub) : '') +
        '</div>' +
      '</div>';
    return true;
  }

  if (!paint()) document.addEventListener('DOMContentLoaded', paint);
})();
