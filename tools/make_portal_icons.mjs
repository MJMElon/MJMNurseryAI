/* Home-screen icons for the three portals.
 *
 *   node tools/make_portal_icons.mjs        (needs playwright)
 *
 * Writes <key>-512.png, -192.png and -180.png into the working directory.
 * Copy them where they belong:
 *
 *   fc     Barcode_Counter/public/  icon-512 · icon-192 · apple-touch-icon
 *   admin  Mobile/public/           icon-512 · icon-192 · apple-touch-icon
 *   audit  mjm-ai-system/audit/     audit_icon-512 · audit_icon-192 ·
 *                                   audit_apple-touch-icon
 *
 * Kept because the mark will change again, and redrawing it by hand from a
 * screenshot is how the icon and the login cover drift apart.
 */
/* Render the book-cover mark as a home-screen icon.
 *
 * The mark is the login page's: MJM Nursery, the 555 logotype, and the portal
 * under it — the thing people already recognise. Values copied from
 * Barcode_Counter/src/components/bookCover.js so the icon and the cover
 * cannot drift.
 *
 * Rendered rather than hand-written as SVG because the logotype is an
 * extruded text-shadow stack over a textured cover, and a browser is the
 * thing that already knows how to draw that.
 */
import { chromium } from 'playwright';
import fs from 'fs';

const PORTALS = [
  { key: 'fc',    portal: 'FC Portal',      cover: ['#a9c5de', '#93b3d1', '#84a4c3'] },
  { key: 'admin', portal: 'Admin Portal',   cover: ['#e8a9bd', '#dc97ad', '#cf8ba3'] },
  { key: 'audit', portal: 'Auditor Portal', cover: ['#e9d071', '#ddc463', '#d0b755'] },
];

const page = (p) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:512px;height:512px;overflow:hidden}
  /* The mark is kept inside a safe area: Android crops a home-screen icon to
     a circle or a squircle, and a 555 that reached the edge lost its outer
     strokes to the mask. */
  .ic{width:512px;height:512px;position:relative;display:flex;flex-direction:column;
      padding:0 34px;
      align-items:center;justify-content:center;
      font-family:Outfit,system-ui,-apple-system,sans-serif;
      background:
        radial-gradient(ellipse at 32% 62%,rgba(255,255,255,.18),transparent 46%),
        radial-gradient(ellipse at 78% 18%,rgba(0,0,0,.05),transparent 52%),
        repeating-linear-gradient(101deg,rgba(255,255,255,.045) 0 2px,transparent 2px 6px),
        linear-gradient(160deg,${p.cover[0]} 0%,${p.cover[1]} 78%,${p.cover[2]} 100%);}
  /* The spine, as on the cover. */
  .ic::before{content:'';position:absolute;left:0;top:0;bottom:0;width:22px;
      background:linear-gradient(90deg,rgba(0,0,0,.16),transparent);}
  .brand{--ls:.26em;font-size:33px;font-weight:900;letter-spacing:var(--ls);
      text-indent:var(--ls);text-transform:uppercase;color:rgba(35,48,63,.62);
      margin-bottom:4px;text-align:center;}
  .logo{font-weight:900;font-style:italic;font-size:158px;line-height:.9;
      letter-spacing:-.02em;color:#1f7a45;
      -webkit-text-stroke:3px #f4fbf6;paint-order:stroke fill;
      text-shadow:1.6px 1.6px 0 #155c33,3.2px 3.2px 0 #155c33,4.8px 4.8px 0 #155c33,6.4px 6.4px 0 #155c33,
                  8px 8px 0 #0f4a29,9.6px 9.6px 0 #0f4a29,11.2px 11.2px 0 #0b3d21,12.8px 12.8px 0 #0b3d21,
                  16px 19px 26px rgba(6,42,22,.4);
      transform:translateX(calc(3.4px - .025em)) rotate(-1.2deg);}
  .portal{--ls:.3em;font-size:${p.portal.length > 12 ? 22 : 25}px;font-weight:900;
      letter-spacing:var(--ls);text-indent:var(--ls);text-transform:uppercase;
      color:rgba(35,48,63,.62);margin-top:26px;text-align:center;white-space:nowrap;}
</style></head><body>
<div class="ic">
  <div class="brand">MJM Nursery</div>
  <div class="logo">555</div>
  <div class="portal">${p.portal}</div>
</div></body></html>`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const p of PORTALS) {
  /* Drawn once at 512 and resampled down for the smaller two. Rendering the
     same CSS into a 192 viewport was the obvious route and does not work:
     the mark is laid out in fixed px, so a smaller viewport crops it rather
     than scaling it. The downscale is Chromium's own, at high quality. */
  const pg = await b.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await pg.setContent(page(p), { waitUntil: 'networkidle' });
  const ok = await pg.evaluate(() => document.fonts.check('900 158px Outfit'));
  console.log(p.key.padEnd(6), 'Outfit loaded:', ok);
  const big = await pg.screenshot({ path: `${p.key}-512.png` });

  const src = 'data:image/png;base64,' + big.toString('base64');
  for (const size of [192, 180]) {
    const out = await pg.evaluate(async ({ src, size }) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png');
    }, { src, size });
    fs.writeFileSync(`${p.key}-${size}.png`, Buffer.from(out.split(',')[1], 'base64'));
  }
  await pg.close();
}
await b.close();
