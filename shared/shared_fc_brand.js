/* ================================================================
   555 FC Portal — the ribbon's wordmark, on the portal's own pages
   shared/shared_fc_brand.js

   The standard ribbon opens with an [AI] square and "MJM NURSERY AI".
   The FC Portal's own pages in this system wear the portal's mark
   instead, centred, stacked the way the phone app's header is:

       555                 the exercise-book logotype, as on the login
       MJM Nursery
       WORKER PORTAL <sub>   Manage, Setting, …

   The portal name comes from data-portal and falls back to "FC Portal",
   which is what this file said before it could be told.

   Only these pages. Every other module keeps the standard ribbon, so
   this is a per-page swap and not a change to what everybody loads.

   Load it AFTER shared_ribbon.js. The mount point needs all three:

       <div id="mjm-ribbon" data-logo="off" data-brand="" data-center=" "></div>
       <script src="../shared/shared_ribbon.js"></script>
       <script src="../shared/shared_fc_brand.js"
               data-portal="Worker Portal" data-sub="Manage"></script>

   data-center must be non-empty or the ribbon does not render a middle
   slot at all — a single space is enough, and it is that slot the mark
   goes into. It sits between two flex:1 siblings, so it is genuinely
   centred in the bar whatever the buttons on the right are doing.
   data-logo="off" drops the [AI] square. The wordmark beside it has to
   be emptied HERE, not by the attribute: the ribbon reads
   `d.brand || 'MJM Nursery AI'`, and an empty string is falsy, so
   data-brand="" gets the default straight back and the page ends up
   wearing both marks at once. The left slot stays in place as the empty
   spacer that makes the centring work.

   Nothing else goes in it. A page that wants a back control puts it in
   the page, beside its own title — two arrows in one bar is a coin toss
   when [← Portal] leaves the FC Portal and the other only goes back a
   step inside it.

   The mark is the phone app's bar, not the login cover: flat, no
   extrusion, no tilt. The cover's 555 is printing on a book; a bar
   wants a wordmark. Values are copied from TopNav.jsx — see the block
   above CSS below, and keep the two in step.

   The ribbon mounts on DOMContentLoaded when the page is still
   parsing, which is every normal case — so this cannot simply run and
   assume the bar is there. It tries now and again when the DOM is
   ready, and gives up quietly: a page wearing the standard wordmark is
   a worse header, not a broken page.
   ================================================================ */
(function () {
  var me = document.currentScript;
  var sub  = (me && me.dataset && me.dataset.sub)  || '';
  /* Which portal's mark this is. Defaults to FC Portal, which is what every
     page wore when this file only knew one name, so a page that does not say
     is unchanged. The back office sets data-portal="Worker Portal". */
  var portal = (me && me.dataset && me.dataset.portal) || 'FC Portal';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* The phone app's own bar, copied value for value out of
     Barcode_Counter/src/components/TopNav.jsx, Tailwind classes resolved:

         555        font-black italic text-[#065f46]
                    text-[27px] sm:text-[34px] leading-none tracking-tight
         name       font-black text-slate-800 text-[11px] sm:text-[13px]
                    tracking-[0.14em] uppercase leading-none mt-1
         sub        font-black text-emerald-600 text-[9px] sm:text-[10px]
                    tracking-[0.18em] sm:tracking-[0.25em] uppercase
                    leading-none mt-1

     Flat on purpose. The extruded 555 belongs on the login COVER, where
     it is the printing on a book; in a bar it is a wordmark, and the
     phone app has read that way since the bar was built. These two are
     the same mark on the same portal and must not drift — if the bar
     changes there, change it here.

     sm: is 640px, so this needs a stylesheet rather than the inline
     styles the rest of this file uses. */
  var CSS =
    '#mjm-ribbon .fcb{min-width:0;text-align:center;' +
      'font-family:Outfit,system-ui,-apple-system,sans-serif;}' +
    '#mjm-ribbon .fcb-555{font-weight:900;font-style:italic;color:#065f46;' +
      'font-size:27px;line-height:1;letter-spacing:-.025em;}' +
    '#mjm-ribbon .fcb-name{font-weight:900;color:#1e293b;font-size:11px;' +
      'letter-spacing:.14em;text-transform:uppercase;line-height:1;' +
      'margin-top:4px;white-space:nowrap;}' +
    '#mjm-ribbon .fcb-sub{font-weight:900;color:#059669;font-size:9px;' +
      'letter-spacing:.18em;text-transform:uppercase;line-height:1;' +
      'margin-top:4px;white-space:nowrap;}' +
    '@media(min-width:640px){' +
      '#mjm-ribbon .fcb-555{font-size:34px;}' +
      '#mjm-ribbon .fcb-name{font-size:13px;}' +
      '#mjm-ribbon .fcb-sub{font-size:10px;letter-spacing:.25em;}' +
    '}';

  function injectCss() {
    if (document.getElementById('fc-brand-css')) return;
    var el = document.createElement('style');
    el.id = 'fc-brand-css';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function paint() {
    var bar = document.querySelector('#mjm-ribbon');
    var slot = bar && bar.querySelector('.mjm-rb-centre');
    if (!slot) return false;

    /* The ribbon's default wordmark, out — see the note above on
       data-brand="". Anchored from #mjm-ribbon on purpose: scoped as
       'div > div:first-child' this also matched the ribbon BAR itself, since
       the bar is the first child of #mjm-ribbon, which is a div. */
    var left = document.querySelector('#mjm-ribbon > div > div:first-child');
    if (left) left.innerHTML = '';
    injectCss();
    slot.innerHTML =
      '<div class="fcb">' +
        '<div class="fcb-555">555</div>' +
        '<div class="fcb-name">MJM Nursery</div>' +
        '<div class="fcb-sub">' + esc(portal) + (sub ? ' ' + esc(sub) : '') + '</div>' +
      '</div>';
    return true;
  }

  if (!paint()) document.addEventListener('DOMContentLoaded', paint);
})();
