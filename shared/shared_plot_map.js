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
  /* Map beside its key. The key is a column on a desk and a block underneath
     on a phone, where 196px taken off the width would leave the map itself
     too small to read. */
  .pm-body { display:flex; align-items:stretch; }
  .pm-mapcol { position:relative; flex:1 1 auto; min-width:0; background:#f1f5f9; }
  .pm-legend { flex:0 0 200px; border-left:1px solid #f1f5f9; background:#fff;
               padding:12px 14px; overflow-y:auto; }
  .pm-lg-cap { font-size:9px; font-weight:900; letter-spacing:.16em; text-transform:uppercase;
               color:#94a3b8; margin:0 0 7px; }
  .pm-lg-cap.mt { margin-top:13px; padding-top:11px; border-top:1px solid #f1f5f9; }
  .pm-lg-row { display:flex; align-items:flex-start; gap:8px; padding:3.5px 0;
               font-size:11px; font-weight:700; color:#475569; line-height:1.25; }
  .pm-sw { width:14px; height:14px; border-radius:4px; border:2px solid; flex:0 0 auto; margin-top:1px; }
  /* Holds the indent for a stage that shares the colour above it, so the
     names line up in one column whether or not the row carries a swatch. */
  .pm-sw-none { border-color:transparent; background:none; }
  /* The bar stretches to the group's height, so every stage under it is
     visibly the same colour. */
  .pm-lg-grp { display:flex; gap:9px; align-items:stretch; margin-bottom:7px; }
  .pm-lg-bar { width:13px; border-radius:5px; border:2px solid; flex:0 0 auto; }
  .pm-lg-names { min-width:0; display:flex; flex-direction:column; justify-content:center; gap:4px; }
  .pm-lg-name { font-size:11.5px; font-weight:800; color:#334155; line-height:1.25; }
  @media(max-width:767px){
    .pm-body { flex-direction:column; height:auto !important; }
    .pm-mapcol { height:52vh; min-height:320px; }
    .pm-legend { flex:0 0 auto; border-left:none; border-top:1px solid #f1f5f9; max-height:none; }
  }
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

  /* ---------- the key a caller colours its stages with ----------
     Eleven stages, and there is no set of eleven colours a person can tell
     apart on this map. Plots sit next to each other, so every colour is
     compared with every other one rather than only its neighbour in a list,
     and against that test even a validated eight-hue palette does not clear
     the floors. Measured, not guessed: one hue in eleven shades leaves
     adjacent stages at ΔE 4.2, and four hues in three shades each puts pale
     blue against pale violet at ΔE 5.1.

     So colour carries a GROUP of stages, the caller says which stages go
     together and what colour each group is, and the key names the stages
     inside each one. Which stage exactly is in that key and in the table
     under the map, per plot, which is what those are for.

         MJMPlotMap.phases([
           { stages: ['Saringan Anak Bibit', 'Culling'], color: '#e34948' },
           { stages: ['Membesar'],                       color: '#eda100' },
         ])

     Returns { legend, keyOf }: pass `legend` to create(), and answer
     `keyOf[stageName]` as the `key` from statusOf().

     The fill is translucent because a photograph is underneath and the plot
     has to stay recognisable through the colour; the stroke is the same hue
     opaque, so the edge holds where the fill is palest. */

  const hexToRgb = (h) => {
    const n = parseInt(String(h).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /* Late is a near-black outline rather than a red one. Red is a stage
     colour now, and an outline in a colour that is also a fill cannot be
     read as a different fact. Black is in none of the groups, so it can
     only mean the one thing. The days-over on the label say it in words
     as well, so it is never colour alone. */
  const LATE_STROKE = '#111827';

  function phases(groups) {
    const list = (groups || []).filter((g) => g && g.color && (g.stages || []).length);
    const keyOf = {};
    const legend = list.map(function (g, i) {
      const stages = g.stages.map(String);
      const key = g.key || ('p' + i);
      stages.forEach((name) => { keyOf[name] = key; });
      const rgb = hexToRgb(g.color);
      return {
        key: key,
        label: g.label || stages.join(' · '),
        stages: stages,
        fill: 'rgba(' + rgb.join(',') + ',.55)',
        stroke: g.color,
      };
    });
    return { legend: legend, keyOf: keyOf };
  }

  function create(opts) {
    const o = opts || {};
    const mount = o.mount;
    if (!mount) throw new Error('MJMPlotMap: mount is required');
    const height = o.height || '58vh';
    const statusOf = typeof o.statusOf === 'function' ? o.statusOf : () => null;
    /* The key beside the map: [{ key, label, fill, stroke }, …], usually
       straight from MJMPlotMap.ramp(). statusOf() then returns which entry a
       plot belongs to as `key`. With no legend the map keeps its original
       three-tone behaviour, so a caller written before this still works. */
    const legend = Array.isArray(o.legend) ? o.legend : null;
    const byKey = {};
    (legend || []).forEach((e) => { byKey[e.key] = e; });
    const onPlotClick = typeof o.onPlotClick === 'function' ? o.onPlotClick : null;

    injectCss();

    let plots = [];        // [{ nursery_name, plot_name, map_top }]
    /* plot_name → [{ area_key, polygon, batch_name }], for plots that have
       been split. Filled by the page through setAreas(); empty means every
       plot is drawn whole, which is how this started and still behaves. */
    let AREAS = {};
    let nurseries = [];    // [{ name, map_image_url }]
    let active = null;
    let z = { zoom: 1, panX: 0, panY: 0 };
    // How far the pointer travelled while down. A drag that ends on a plot
    // must not also count as a click on it, or panning the map keeps opening
    // whatever happened to be under the finger.
    let dragDist = 0;

    mount.innerHTML = `
      <div class="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <h2 class="font-black text-slate-800 uppercase tracking-widest text-[13px]">${esc(o.title || 'Plot Status Map')}</h2>
        <div class="pm-tabs flex gap-2 overflow-x-auto"></div>
      </div>
      <div class="pm-body" style="height:${height}; min-height:380px;">
       <div class="pm-mapcol">
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
       <aside class="pm-legend"></aside>
      </div>`;

    const q = (sel) => mount.querySelector(sel);
    const elTabs = q('.pm-tabs'), elView = q('.pm-viewport'), elStage = q('.pm-stage');

    /* The key, drawn once — it does not change as the data does. In stage
       order, top to bottom, so it reads as the run through the nursery and
       a reader can find a colour by where it sits as much as by its hue.
       The two states below the rule are not stages and are kept apart from
       them: a plot is on a stage AND late, not late instead of a stage. */
    (function renderLegend() {
      const box = q('.pm-legend');
      if (!box) return;
      if (!legend) { box.style.display = 'none'; return; }
      /* One row per STAGE, not per colour. Stages that share a colour used to
         be crushed onto one line joined by " · ", which reads as a single
         long name rather than three separate answers. They get a line each,
         and only the first of a group carries the swatch — the colour is
         said once and the rows under it sit beneath it. */
      /* One BAR per colour, running the full height of the stages that share
         it, and the stage names stacked beside it. A single small square on
         the first row left the others looking as if they had no colour at
         all — which is the one thing a key exists to say. */
      box.innerHTML =
        '<p class="pm-lg-cap">' + esc(o.legendTitle || 'Status') + '</p>' +
        legend.map((e) => {
          const names = (e.stages && e.stages.length) ? e.stages : [e.label];
          return '<div class="pm-lg-grp">' +
            '<span class="pm-lg-bar" style="background:' + e.fill + ';border-color:' + e.stroke + '"></span>' +
            '<div class="pm-lg-names">' +
              names.map((n) => '<div class="pm-lg-name">' + esc(n) + '</div>').join('') +
            '</div></div>';
        }).join('');
    })();
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
            `<button class="pm-tab ${active === n.name ? 'active' : ''}" data-pm-tab="${esc(n.name)}">${esc(n.name)}</button>`
          ).join('')
        : '<span class="text-[11px] text-slate-400 font-bold">No nurseries configured</span>';
    }

    /* Redraw the polygons against whatever statusOf() says now. Cheap enough
       to call on every data change — it is a few dozen shapes. */
    /* A plot drawn as one shape, or as its areas when it has been split.

       A plot carrying two batches planted weeks apart has two stages
       running at once, and one polygon can only be one colour. So when
       nops_plot_areas has shapes for a plot, THEY are drawn — each keyed
       "B2#A", which is the unit key PALMS has always logged against — and
       the plot's own map_top is not. Mixing the two would draw the halves
       on top of the whole. */
    const shapesOf = (p) => {
      const areas = (AREAS[p.plot_name] || []).filter((a) => a && a.polygon);
      if (areas.length) {
        return areas.map((a) => ({
        key: p.plot_name + '#' + a.area_key,
        label: p.plot_name + ' · ' + a.area_key,
        plot: p.plot_name,
        area: a.area_key,
        raw: a.polygon,
        }));
      }
      return [{ key: p.plot_name, label: p.plot_name, plot: p.plot_name, area: null, raw: p.map_top }];
    };

    /* Exactly what refresh() draws, in the order it draws it. The page's
       table reads this too — a table listing plots while the map draws
       areas is how B1#B went missing from one and not the other. */
    function unitList(nursery) {
      const want = nursery || active;
      const out = [];
      plots.filter((p) => p.nursery_name === want).forEach((p) => {
        shapesOf(p).forEach((u) => out.push(u));
      });
      return out;
    }

    function refresh() {
      elSvg.innerHTML = '';
      elLabels.innerHTML = '';
      const shapes = [];
      const labels = [];
      unitList().forEach((p) => {
        if (!p.raw || !String(p.raw).startsWith('[')) return;
        let pts;
        try { pts = JSON.parse(p.raw); } catch (e) { return; }
        if (!Array.isArray(pts) || !pts.length) return;

        const st = statusOf(p.key) || null;
        /* With a legend the FILL says which stage the plot is on, and being
           late is an outline on top of it rather than a colour of its own —
           the two are different questions and a single colour could only
           answer one. Without a legend, the old three tones. */
        const hit = legend && st && byKey[st.key];
        const tone = TONES[(st && st.tone) || 'none'] || TONES.none;
        const late = st && st.tone === 'over';
        const fill = hit ? hit.fill : tone.fill;
        const stroke = legend ? (late ? LATE_STROKE : (hit ? hit.stroke : TONES.none.stroke))
                              : tone.stroke;
        const width = legend && late ? '1.1' : '.4';
        shapes.push(
          `<polygon points="${pts.map((pt) => pt.x + ',' + pt.y).join(' ')}" fill="${fill}" ` +
          `stroke="${stroke}" stroke-width="${width}" class="pm-shape" data-pm-plot="${esc(p.key)}"/>`);

        const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
        const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;
        const cls = st && st.tone === 'over' ? 'over' : (st && st.tone === 'ok' ? '' : 'none');
        /* The stage name is in the key now, so the label is the plot and, on
           a late plot, how late — which is short. Naming every plot's stage
           on the map is what made fourteen labels overlap into a wall. */
        const line = legend ? (st && st.late ? st.late : '') : ((st && st.line) || 'no status');
        labels.push(
          `<div class="pm-label" style="left:${cx}%; top:${cy}%;">` +
            `<div class="pm-tag">${esc(p.label)}</div>` +
            (line ? `<div class="pm-line ${cls}">${esc(line)}</div>` : '') +
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

    /* No wheel zoom. Scrolling the page over the map used to jump the zoom
       instead, which is startling and easy to do by accident on a laptop.
       The + and − buttons are the only way to change it now; dragging still
       pans, because that is deliberate. */

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
      /* is_active comes from migration_plot_hide.sql and may not exist yet.
         Naming a column that is not there fails the WHOLE read, so the read
         is retried without it — a nursery that has not run that migration
         sees every plot, which is exactly how this behaved before. */
      async function readPlots() {
        const withFlag = await supa.from('shared_plots')
          .select('nursery_name, plot_name, map_top, is_active').order('plot_name');
        if (!withFlag.error) return (withFlag.data || []).filter((p) => p.is_active !== false);
        if (!/is_active/i.test(withFlag.error.message || '')) throw withFlag.error;
        const plain = await supa.from('shared_plots')
          .select('nursery_name, plot_name, map_top').order('plot_name');
        if (plain.error) throw plain.error;
        return plain.data || [];
      }

      const [plotRes, nurRes] = await Promise.all([
        readPlots().catch((e) => { console.warn('[map] plots not read:', e.message); return []; }),
        supa.from('operation_nurseries').select('name, map_image_url').order('name'),
      ]);
      plots = Array.isArray(plotRes) ? plotRes : [];
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
      /* KEEP THE NURSERY THAT IS OPEN. This used to be an unconditional
         setNursery(nurseries[0].name), so every reload snapped back to the
         first tab — and load() is called after hiding a plot, restoring
         one, or redrawing a boundary. Hide a plot on UNN2 and you were
         thrown back to BNN, having to find your way back to the row you
         were working on. Only fall back to the first when nothing is open
         yet (the initial load) or when the nursery that was open has gone.

         The zoom and pan go with it. setNursery resets them, which is right
         when somebody picks a DIFFERENT nursery — different image, different
         framing — and wrong when the same one is simply being re-read. */
      const stillThere = nurseries.some((n) => n.name === active);
      if (stillThere) {
        const keepZ = { zoom: z.zoom, panX: z.panX, panY: z.panY };
        setNursery(active);
        z = keepZ;
        applyTransform();
      } else {
        setNursery(nurseries.length ? nurseries[0].name : null);
      }
      return { plots: plots.length, nurseries: nurseries.length };
    }

    return {
      load: load,
      refresh: refresh,
      setNursery: setNursery,
      active: () => active,
      nurseries: () => nurseries.slice(),
      plotsOf: (name) => plots.filter((p) => p.nursery_name === (name || active)),
      /* Which plots are split, and where. Passing {} puts every plot back to
         being drawn whole. */
      setAreas: function (byPlot) { AREAS = byPlot || {}; refresh(); },
      areasOf: function (plot) { return (AREAS[plot] || []).slice(); },
      /* Every shape on the map, as { key, label, plot, area, raw }. */
      units: function (nursery) { return unitList(nursery); },
    };
  }

  global.MJMPlotMap = { phases: phases, create: create };
})(window);
