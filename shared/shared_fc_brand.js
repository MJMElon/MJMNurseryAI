/* ================================================================
   555 FC Portal — the ribbon's wordmark, on the portal's own pages
   shared/shared_fc_brand.js

   The standard ribbon opens with an [AI] square and "MJM NURSERY AI".
   The FC Portal's own pages in this system wear the portal's mark
   instead, centred, stacked the way the phone app's header is:

       555                 the exercise-book logotype, as on the login
       MJM Nursery
       FC PORTAL <sub>     Manage, Setting, …

   Only these pages. Every other module keeps the standard ribbon, so
   this is a per-page swap and not a change to what everybody loads.

   Load it AFTER shared_ribbon.js. The mount point needs all three:

       <div id="mjm-ribbon" data-logo="off" data-brand="" data-center=" "></div>
       <script src="../shared/shared_ribbon.js"></script>
       <script src="../shared/shared_fc_brand.js" data-sub="Manage"></script>

   data-center must be non-empty or the ribbon does not render a middle
   slot at all — a single space is enough, and it is that slot the mark
   goes into. It sits between two flex:1 siblings, so it is genuinely
   centred in the bar whatever the buttons on the right are doing.
   data-logo="off" and an empty data-brand leave the left side as the
   empty spacer that makes the centring work — which is where a back
   link goes, if the page wants one:

       <script src="../shared/shared_fc_brand.js"
               data-sub="Setting" data-back="scan_admin.html"></script>

   Deliberately separate from the ribbon's own [← Portal] on the right:
   that one leaves the FC Portal for the module selection, this one goes
   back a step inside it.

   The colours are the login cover's own (--bk-green and its three
   shadow steps in AuthScreen.jsx). Keep them in step: this mark and
   that one are meant to be the same 555.

   The ribbon mounts on DOMContentLoaded when the page is still
   parsing, which is every normal case — so this cannot simply run and
   assume the bar is there. It tries now and again when the DOM is
   ready, and gives up quietly: a page wearing the standard wordmark is
   a worse header, not a broken page.
   ================================================================ */
(function () {
  var me = document.currentScript;
  var sub  = (me && me.dataset && me.dataset.sub)  || '';
  var back = (me && me.dataset && me.dataset.back) || '';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function paint() {
    var bar = document.querySelector('#mjm-ribbon');
    var slot = bar && bar.querySelector('.mjm-rb-centre');
    if (!slot) return false;

    /* Into the empty left spacer, so it does not move the centred mark.
       Anchored from #mjm-ribbon on purpose: scoped as 'div > div:first-child'
       this also matched the ribbon BAR itself — the bar is the first child of
       #mjm-ribbon, which is a div — and rewriting it wiped the whole ribbon,
       centred mark and buttons included. */
    var left = document.querySelector('#mjm-ribbon > div > div:first-child');
    if (back && left) {
      left.innerHTML =
        '<a href="' + esc(back) + '" title="Back" aria-label="Back" ' +
           'style="display:grid;place-items:center;width:38px;height:38px;border-radius:999px;' +
                  'background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;text-decoration:none;' +
                  'font-size:17px;font-weight:900;line-height:1;flex-shrink:0;">&#8592;</a>';
    }
    slot.innerHTML =
      '<div style="line-height:1;">' +
        // The 555 of the exercise book: dark green, italic, stacked shadow.
        // clamp() so a narrow phone does not push it into the buttons.
        '<div style="font-family:Outfit,system-ui,sans-serif;font-weight:900;font-style:italic;' +
                    'font-size:clamp(30px,6vw,42px);letter-spacing:-.02em;color:#1f7a45;' +
                    '-webkit-text-stroke:1.1px #f4fbf6;paint-order:stroke fill;' +
                    'text-shadow:1px 1px 0 #155c33,2px 2px 0 #155c33,' +
                                '3px 3px 0 #0f4a29,4px 4px 0 #0b3d21;' +
                    'transform:rotate(-1.2deg);display:inline-block;">555</div>' +
        '<div style="font-weight:900;color:#1e293b;font-size:clamp(13px,1.7vw,16px);' +
                    'margin-top:5px;white-space:nowrap;">MJM Nursery</div>' +
        '<div style="font-weight:900;color:#1f7a45;font-size:clamp(9px,1.1vw,10.5px);' +
                    'text-transform:uppercase;letter-spacing:.2em;margin-top:2px;' +
                    'white-space:nowrap;">' +
          'FC Portal' + (sub ? ' ' + esc(sub) : '') +
        '</div>' +
      '</div>';
    return true;
  }

  if (!paint()) document.addEventListener('DOMContentLoaded', paint);
})();
