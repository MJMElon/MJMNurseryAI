/* ================================================================
   The nursery map, as a component
   shared/shared_plot_map.js

   The map — the nursery's uploaded photo with each plot's polygon drawn
   over it — was written inside Life of Plot and lived only there. The
   PALMS Monitoring Board wants the same map with different colours on
   it, so rather than a second copy drifting away from the first, it is
   this file, and both pages mount it.

   The polygons and the photo are the office's own data and are edited in
   one place, Seedling Stock Management → System Settings:

       shared_plots.map_top      the polygon, JSON [{x,y},…] in percent
       operation_nurseries       .map_image_url, the photo behind it

   WHAT THIS FILE DOES NOT KNOW is what a plot's status means. It asks the
   page, through statusOf(), and paints what it gets back. That is the
   whole reason it is reusable: Life of Plot and the PALMS board colour
   the same polygons from different tables, and neither has to explain
   itself to the map.

       const map = MJMPlotMap.create({
         mount: document.getElementById('map-here'),
         statusOf: (plot) => ({ tone: 'over', line: 'Culling · day 4/2' }),
         onPlotClick: (plot) => openPlot(plot),
       });
       await map.load(_supabase, { nurseries: ['BNN'] });
       map.refresh();          // after the status data changes

   tone is 'ok' | 'over' | 'none'. Anything else is treated as 'none', so
   a page that invents a fourth tone gets grey rather than a broken map.
   ================================================================ */
(function (global) {

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const CSS = `
  .pm-tab { padding:8px 16px; font-weight:900; font-size:11px; text-transform:uppercase; letter-spacing:.06em;
            border-radius:12px; border:1.5px solid #e2e8f0; background:white; color:#64748b; cursor:pointer;
            white-space:nowrap; transition:all .15s; }
  .pm-tab.active { background:#0d9488; border-color:#0f766e; color:white; box-shadow:0 4px 10px -2px rgba(13,148,136,.4); }
  .pm-viewport { position:relative; width:100%; height:100%; overflow:hidden; touch-action:none; }
  .pm-stage { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
              transform-origin:center center; transition:transform .12s ease-out; will-change:transform; cursor:grab; }
  .pm-stage.is-dragging { cursor:grabbing; transition:none; }
  .pm-shape { transition:all .2s ease-in-out; cursor:pointer; }
  .pm-shape:hover { fill:rgba(250,204,21,.55)!important; stroke-width:.7!important; }
  /* The labels sit on the stage, so they scale with it — and would grow to
     billboard size at 5x. The inverse scale keeps them legible at every
     zoom, which is the point of putting them in HTML rather than the SVG. */
  .pm-label { position:absolute; display:flex; flex-direction:column; align-items:center; text-align:center;
              pointer-events:none; max-width:150px; transform-origin:center center;
              transform:translate(-50%,-50%) scale(calc(1 / var(--pm-zoom, 1))); }
  .pm-tag { font-size:11px; font-weight:900; background:white; padding:2px 7px; border-radius:6px; color:#1e293b;
            margin-bottom:2px; box-shadow:0 2px 6px rgba(0,0,0,.18); text-transform:uppercase;
            border:1px solid #cbd5e1; letter-spacing:.04em; }
  .pm-line { font-size:9.5px; font-weight:800; line-height:1.15; padding:1px 6px; border-radius:4px; margin-top:1px;
             white-space:nowrap; background:rgba(255,255,255,.9); color:#065f46; }
  .pm-line.over { color:#9f1239; }
  .pm-line.none { color:#94a3b8; font-weight:700; }
  .pm-zoom { position:absolute; top:8px; right:8px; display:flex; flex-direction:column; gap:4px; z-index:5;
             background:white; border-radius:10px; box-shadow:0 4px 10px rgba(0,0,0,.12); padding:4px;
             border:1px solid #e2e8f0; }
  .pm-zbtn { width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:none;
             background:white; color:#475569; font-weight:900; font-size:14px; cursor:pointer; border-radius:6px;
             transition:all .15s; }
  .pm-zbtn:hover { background:#ccfbf1; color:#0f766e; }
  .pm-zlvl { font-size:9px; font-weight:900; color:#64748b; text-align:center; padding:2px 0;
             border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0; }`;

  function injectCss() {
    if (document.getElementById('pm-css')) return;
    const el = document.createElement('style');
    el.id = 'pm-css';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  const TONES = {
    ok:   { fill: 'rgba(74,222,128,.40)',  stroke: '#22c55e' },
    over: { fill: 'rgba(244,114,128,.45)', stroke: '#ef4444' },
    none: { fill: 'rgba(148,163,184,.25)', stroke: '#94a3b8' },
  };

  function create(opts) {
    const o = opts || {};
    const mount = o.mount;
    if (!mount) throw new Error('MJMPlotMap: mount is required');
    const height = o.height || '58vh';
    const statusOf = typeof o.statusOf === 'function' ? o.statusOf : () => null;
    const onPlotClick = typeof o.onPlotClick === 'function' ? o.onPlotClick : null;

    injectCss();

    let plots = [];        // [{ nursery_name, plot_name, map_top }]
    let nurseries = [];    // [{ name, map_image_url }]
    let active = null;
    let z = { zoom: 1, panX: 0, panY: 0 };
    // How far the pointer travelled while down. A drag that ends on a plot
    // must not also count as a click on it, or panning the map keeps opening
    // whatever happened to be under the finger.
    let dragDist = 0;

    mount.innerHTML = `
      <div class="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <h2 class="font-black text-slate-800 uppercase tracking-widest text-[13px]">${esc(o.title || '🗺️ Plot Status Map')}</h2>
        <div class="pm-tabs flex gap-2 overflow-x-auto"></div>
      </div>
      <div class="relative bg-slate-100" style="height:${height}; min-height:380px;">
        <div class="pm-viewport">
          <div class="pm-stage">
            <div class="relative inline-block">
              <img class="pm-image" alt="Nursery map"
                   style="max-height:calc(${height} - 16px); width:auto; object-fit:contain; display:block;
                          user-select:none; -webkit-user-drag:none;">
              <svg class="pm-svg" viewBox="0 0 100 100" preserveAspectRatio="none"
                   style="position:absolute; inset:0; width:100%; height:100%;"></svg>
              <div class="pm-labels" style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none;"></div>
            </div>
          </div>
          <div class="pm-zoom">
            <button class="pm-zbtn pm-in" title="Zoom in">＋</button>
            <div class="pm-zlvl">100%</div>
            <button class="pm-zbtn pm-out" title="Zoom out">－</button>
            <button class="pm-zbtn pm-reset" title="Reset zoom">↺</button>
          </div>
        </div>
        <div class="pm-nomap" style="display:none; position:absolute; inset:0; flex-direction:column;
             align-items:center; justify-content:center; gap:8px;" class="text-slate-400">
          <span class="font-bold uppercase tracking-widest text-[11px] text-slate-400">No map uploaded for this nursery</span>
          <span class="text-[11px] text-slate-400">Upload it in Seedling Stock Management → System Settings.</span>
        </div>
      </div>
      <div class="px-4 py-3 border-t border-slate-100 flex flex-wrap gap-x-6 gap-y-2 items-center bg-slate-50/60">
        <span class="text-[10px] font-black text-slate-500 uppercase tracking-widest">Legend:</span>
        <span class="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600"><span class="w-3.5 h-3.5 rounded border-2 inline-block" style="background:rgba(74,222,128,.4); border-color:#22c55e"></span> On schedule</span>
        <span class="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600"><span class="w-3.5 h-3.5 rounded border-2 inline-block" style="background:rgba(244,114,128,.45); border-color:#ef4444"></span> Over its time</span>
        <span class="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600"><span class="w-3.5 h-3.5 rounded border-2 inline-block" style="background:rgba(148,163,184,.25); border-color:#94a3b8"></span> Nothing recorded</span>
      </div>`;

    const q = (sel) => mount.querySelector(sel);
    const elTabs = q('.pm-tabs'), elView = q('.pm-viewport'), elStage = q('.pm-stage');
    const elImg = q('.pm-image'), elSvg = q('.pm-svg'), elLabels = q('.pm-labels');
    const elNone = q('.pm-nomap'), elLvl = q('.pm-zlvl');

    function applyTransform() {
      elStage.style.transform = `translate(${z.panX}px, ${z.panY}px) scale(${z.zoom})`;
      elLabels.style.setProperty('--pm-zoom', z.zoom);
      elLvl.textContent = Math.round(z.zoom * 100) + '%';
    }

    function zoomBy(d) {
      z.zoom = Math.max(0.5, Math.min(5, z.zoom + d));
      if (z.zoom <= 1.01) { z.panX = 0; z.panY = 0; }
      applyTransform();
    }

    function renderTabs() {
      elTabs.innerHTML = nurseries.length
        ? nurseries.map((n) =>
            `<button class="pm-tab ${active === n.name ? 'active' : ''}" data-pm-tab="${esc(n.name)}">🏠 ${esc(n.name)}</button>`
          ).join('')
        : '<span class="text-[11px] text-slate-400 font-bold">No nurseries configured</span>';
    }

    /* Redraw the polygons against whatever statusOf() says now. Cheap enough
       to call on every data change — it is a few dozen shapes. */
    function refresh() {
      elSvg.innerHTML = '';
      elLabels.innerHTML = '';
      const shapes = [];
      const labels = [];
      plots.filter((p) => p.nursery_name === active).forEach((p) => {
        if (!p.map_top || !String(p.map_top).startsWith('[')) return;
        let pts;
        try { pts = JSON.parse(p.map_top); } catch (e) { return; }
        if (!Array.isArray(pts) || !pts.length) return;

        const st = statusOf(p.plot_name) || null;
        const tone = TONES[(st && st.tone) || 'none'] || TONES.none;
        shapes.push(
          `<polygon points="${pts.map((pt) => pt.x + ',' + pt.y).join(' ')}" fill="${tone.fill}" ` +
          `stroke="${tone.stroke}" stroke-width=".4" class="pm-shape" data-pm-plot="${esc(p.plot_name)}"/>`);

        const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
        const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;
        const cls = st && st.tone === 'over' ? 'over' : (st && st.tone === 'ok' ? '' : 'none');
        labels.push(
          `<div class="pm-label" style="left:${cx}%; top:${cy}%;">` +
            `<div class="pm-tag">${esc(p.plot_name)}</div>` +
            `<div class="pm-line ${cls}">${esc((st && st.line) || 'no status')}</div>` +
          `</div>`);
      });
      elSvg.innerHTML = shapes.join('');
      elLabels.innerHTML = labels.join('');
    }

    function setNursery(name) {
      active = name;
      z = { zoom: 1, panX: 0, panY: 0 };
      renderTabs();
      const n = nurseries.find((x) => x.name === name);
      const hasMap = !!(n && n.map_image_url);
      elView.style.display = hasMap ? '' : 'none';
      elNone.style.display = hasMap ? 'none' : 'flex';
      if (hasMap) elImg.src = n.map_image_url;
      refresh();
      applyTransform();
      if (typeof o.onNurseryChange === 'function') o.onNurseryChange(name);
    }

    /* ---- wiring ---- */
    q('.pm-in').addEventListener('click', () => zoomBy(0.25));
    q('.pm-out').addEventListener('click', () => zoomBy(-0.25));
    q('.pm-reset').addEventListener('click', () => { z = { zoom: 1, panX: 0, panY: 0 }; applyTransform(); });

    elTabs.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pm-tab]');
      if (t) setNursery(t.dataset.pmTab);
    });

    elView.addEventListener('wheel', (e) => {
      e.preventDefault();
      const old = z.zoom;
      z.zoom = Math.max(0.5, Math.min(5, z.zoom + (e.deltaY < 0 ? 0.15 : -0.15)));
      // Zoom toward the pointer rather than the middle, so the thing being
      // looked at stays under it.
      const r = elView.getBoundingClientRect();
      const cx = e.clientX - r.left - r.width / 2;
      const cy = e.clientY - r.top - r.height / 2;
      const k = z.zoom / old;
      z.panX = (z.panX - cx) * k + cx;
      z.panY = (z.panY - cy) * k + cy;
      if (z.zoom <= 1.01) { z.panX = 0; z.panY = 0; }
      applyTransform();
    }, { passive: false });

    let dragging = false, lastX = 0, lastY = 0;
    const onDown = (e) => {
      if (e.target.closest('.pm-zoom')) return;
      dragging = true; dragDist = 0;
      elStage.classList.add('is-dragging');
      const pt = e.touches ? e.touches[0] : e;
      lastX = pt.clientX; lastY = pt.clientY;
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - lastX, dy = pt.clientY - lastY;
      lastX = pt.clientX; lastY = pt.clientY;
      dragDist += Math.abs(dx) + Math.abs(dy);
      z.panX += dx; z.panY += dy;
      applyTransform();
    };
    const onUp = () => { if (dragging) { dragging = false; elStage.classList.remove('is-dragging'); } };
    elView.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    elView.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);

    if (onPlotClick) {
      elSvg.addEventListener('click', (e) => {
        const shape = e.target.closest('[data-pm-plot]');
        // 6px of slop: a tap is never perfectly still, a pan always moves.
        if (shape && dragDist < 6) onPlotClick(shape.dataset.pmPlot);
      });
    }

    /**
     * Read the plots and the nursery photos.
     * `opts.nurseries` narrows the tabs to the ones this person may see —
     * pass the same list the page scopes its table by, or omit for all.
     */
    async function load(supa, loadOpts) {
      const lo = loadOpts || {};
      const [plotRes, nurRes] = await Promise.all([
        supa.from('shared_plots').select('nursery_name, plot_name, map_top').order('plot_name'),
        supa.from('operation_nurseries').select('name, map_image_url').order('name'),
      ]);
      plots = (plotRes && !plotRes.error && plotRes.data) ? plotRes.data : [];
      /* B1, B2, … B10 — the way the nursery says them. The server orders by
         plot_name, which is text, so a plain sort gives B1, B10, B11, B2 and
         the office reads a list that jumps about. Sorted on the NUMBER, with
         the letters as the tie-break. */
      plots.sort((a, b) => {
        const A = String(a.plot_name || ''), B = String(b.plot_name || '');
        const pa = A.replace(/[0-9]/g, ''), pb = B.replace(/[0-9]/g, '');
        if (pa !== pb) return pa.localeCompare(pb);
        return (parseInt(A.replace(/\D/g, ''), 10) || 0) - (parseInt(B.replace(/\D/g, ''), 10) || 0)
            || A.localeCompare(B);
      });
      nurseries = (nurRes && !nurRes.error && nurRes.data) ? nurRes.data : [];
      if (Array.isArray(lo.nurseries)) {
        const want = lo.nurseries.map((n) => String(n).replace(/[^a-z0-9]/gi, '').toUpperCase());
        nurseries = nurseries.filter((n) =>
          want.indexOf(String(n.name).replace(/[^a-z0-9]/gi, '').toUpperCase()) !== -1);
      }
      setNursery(nurseries.length ? nurseries[0].name : null);
      return { plots: plots.length, nurseries: nurseries.length };
    }

    return {
      load: load,
      refresh: refresh,
      setNursery: setNursery,
      active: () => active,
      nurseries: () => nurseries.slice(),
      plotsOf: (name) => plots.filter((p) => p.nursery_name === (name || active)),
    };
  }

  global.MJMPlotMap = { create: create };
})(window);
