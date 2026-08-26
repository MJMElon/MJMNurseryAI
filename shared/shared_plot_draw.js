/* ================================================================
   Redrawing a plot's boundary, and splitting it by batch
   shared/shared_plot_draw.js

   Opens over the Plot Status Map: pick the whole plot or one of its
   areas, drag its corners, drop new ones, and pin the batch that is
   standing in it.

   WHY A PLOT HAS AREAS AT ALL

   A plot carrying two batches planted weeks apart has two stages
   running at once — half on Culling while the other half is still on
   Tunggu buat culling. One polygon can only be one colour, so the map
   was telling half a truth. PALMS has always had the unit key for this
   ("B2" whole, "B2#A" once split); what was missing was anywhere to say
   where on the photo area A is. That is nops_plot_areas, and this is
   what writes it.

   WHERE THE SHAPES LIVE

     whole plot   shared_plots.map_top       JSON [{x,y},…] in percent
     an area      nops_plot_areas.polygon    the same format

   Percent of the photo, not pixels, so a shape survives the image being
   re-uploaded at a different size — and so the map and this editor can
   share one renderer.

       MJMPlotDraw.open({
         supa, plot: 'B2', nursery: 'BNN', imageUrl: '…',
         mapTop: '[{"x":10,"y":10},…]',
         by: 'Siti',
         onSaved: () => reloadTheMap(),
       });

   Pointer events throughout, like the map itself: the office does this
   on a tablet, where mousedown never fires.
   ================================================================ */
(function (global) {

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const CSS = `
  .pd-bg { position:fixed; inset:0; background:rgba(15,23,42,.62); z-index:70;
           display:flex; align-items:center; justify-content:center; padding:14px; }
  .pd-card { background:white; border-radius:20px; width:100%; max-width:1080px; height:min(92vh,780px);
             display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 60px rgba(0,0,0,.3);
             font-family:Outfit,system-ui,sans-serif; }
  .pd-head { display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1px solid #f1f5f9; flex:none; }
  .pd-title { font-weight:900; color:#0f172a; font-size:17px; }
  .pd-sub { font-size:11px; font-weight:900; color:#0d9488; text-transform:uppercase; letter-spacing:.12em; }
  .pd-body { flex:1 1 auto; min-height:0; display:flex; }
  .pd-stage { flex:1 1 auto; min-width:0; position:relative; background:#0f172a; overflow:hidden; touch-action:none; }
  .pd-wrap { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
  .pd-inner { position:relative; display:inline-block; }
  .pd-img { display:block; max-width:100%; max-height:100%; user-select:none; -webkit-user-drag:none; }
  .pd-svg { position:absolute; inset:0; width:100%; height:100%; }
  .pd-side { flex:0 0 268px; border-left:1px solid #f1f5f9; display:flex; flex-direction:column; min-height:0; background:#fbfdfd; }
  .pd-sec { padding:12px 14px; border-bottom:1px solid #f1f5f9; }
  .pd-sec-t { font-size:10px; font-weight:900; color:#94a3b8; text-transform:uppercase; letter-spacing:.12em; margin-bottom:8px; }
  .pd-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; }
  .pd-chip { display:inline-flex; align-items:center; gap:6px; padding:7px 11px; border-radius:10px; cursor:pointer;
             border:1.5px solid #e2e8f0; background:white; font-weight:900; font-size:12px; color:#475569;
             font-family:inherit; margin:0 6px 6px 0; }
  .pd-chip.on { border-color:#0d9488; background:#ccfbf1; color:#0f766e; }
  .pd-batch { display:block; width:100%; text-align:left; padding:9px 11px; border-radius:11px; cursor:pointer;
              border:1.5px solid #e2e8f0; background:white; font-family:inherit; margin-bottom:6px; }
  .pd-batch:hover { border-color:#99f6e4; }
  .pd-batch.on { border-color:#0d9488; background:#ccfbf1; }
  .pd-batch-n { font-weight:900; font-size:12px; color:#0f172a; }
  .pd-batch-q { font-size:11px; font-weight:700; color:#64748b; margin-top:2px; }
  .pd-foot { display:flex; align-items:center; gap:8px; padding:12px 18px; border-top:1px solid #f1f5f9; flex:none; }
  .pd-btn { padding:9px 16px; border-radius:11px; font-size:11px; font-weight:900; letter-spacing:.08em;
            text-transform:uppercase; cursor:pointer; border:1.5px solid transparent; font-family:inherit; }
  .pd-dark { background:#0f172a; color:white; }
  .pd-dark:hover { background:#1e293b; }
  .pd-ghost { background:white; color:#475569; border-color:#e2e8f0; }
  .pd-ghost:hover { background:#f8fafc; }
  .pd-danger { background:white; color:#be123c; border-color:#fecdd3; }
  .pd-danger:hover { background:#fff1f2; }
  .pd-msg { font-size:11px; font-weight:900; color:#64748b; }
  .pd-hint { font-size:11px; color:#64748b; line-height:1.5; }
  @media (max-width:820px) {
    .pd-body { flex-direction:column; }
    .pd-side { flex:0 0 auto; max-height:38%; border-left:none; border-top:1px solid #f1f5f9; }
  }`;

  function injectCss() {
    if (document.getElementById('pd-css')) return;
    const el = document.createElement('style');
    el.id = 'pd-css';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  const parsePoly = (raw) => {
    if (!raw || !String(raw).startsWith('[')) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  };

  /* Area keys are letters, so "B2#A" reads the way the field app says it.
     The next free letter, not the count — deleting B and adding again
     should not produce a second B. */
  function nextKey(areas) {
    const used = {};
    areas.forEach((a) => { used[String(a.area_key).toUpperCase()] = true; });
    for (let i = 0; i < 26; i++) {
      const k = String.fromCharCode(65 + i);
      if (!used[k]) return k;
    }
    return 'Z';
  }

  function open(opts) {
    const o = opts || {};
    const supa = o.supa;
    const plot = String(o.plot || '');
    if (!supa || !plot) throw new Error('MJMPlotDraw: supa and plot are required');
    injectCss();

    /* The working copy. `whole` is shared_plots.map_top; `areas` are rows of
       nops_plot_areas. Nothing is written until Save, so Cancel is free. */
    let whole = parsePoly(o.mapTop);
    let areas = [];
    let batches = [];
    let sel = '#whole';        // '#whole' or an area_key
    let removed = [];          // area_keys deleted in this session
    let drag = null;           // { type:'pt'|'poly', i, lastX, lastY }
    let msg = '';

    const bg = document.createElement('div');
    bg.className = 'pd-bg';
    bg.innerHTML = `
      <div class="pd-card">
        <div class="pd-head">
          <div>
            <div class="pd-sub">Plot boundary</div>
            <div class="pd-title">${esc(plot)}${o.nursery ? ' · ' + esc(o.nursery) : ''}</div>
          </div>
          <button class="pd-btn pd-ghost pd-close" style="margin-left:auto">Close</button>
        </div>
        <div class="pd-body">
          <div class="pd-stage">
            <div class="pd-wrap">
              <div class="pd-inner">
                <img class="pd-img" alt="">
                <svg class="pd-svg" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
              </div>
            </div>
          </div>
          <div class="pd-side">
            <div class="pd-sec">
              <div class="pd-sec-t">Drawing</div>
              <div class="pd-parts"></div>
              <button class="pd-btn pd-ghost pd-add" style="width:100%; margin-top:4px">＋ Split into another area</button>
            </div>
            <div class="pd-sec">
              <div class="pd-hint pd-guide"></div>
            </div>
            <div class="pd-sec" style="border-bottom:none; padding-bottom:6px">
              <div class="pd-sec-t">Batches in this plot</div>
            </div>
            <div class="pd-scroll" style="padding:0 14px 14px"><div class="pd-batches"></div></div>
          </div>
        </div>
        <div class="pd-foot">
          <button class="pd-btn pd-danger pd-clear">Clear shape</button>
          <span class="pd-msg"></span>
          <button class="pd-btn pd-ghost pd-cancel" style="margin-left:auto">Cancel</button>
          <button class="pd-btn pd-dark pd-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(bg);

    const q = (c) => bg.querySelector(c);
    const elImg = q('.pd-img'), elSvg = q('.pd-svg'), elStage = q('.pd-stage');
    if (o.imageUrl) elImg.src = o.imageUrl;

    const current = () => (sel === '#whole'
      ? whole
      : (areas.find((a) => a.area_key === sel) || { points: [] }).points);

    function setCurrent(pts) {
      if (sel === '#whole') whole = pts;
      else {
        const a = areas.find((x) => x.area_key === sel);
        if (a) a.points = pts;
      }
    }

    function say(t) { msg = t || ''; q('.pd-msg').textContent = msg; }

    /* ---------- drawing ---------- */
    function draw() {
      const parts = [];
      // Everything not being edited, faint, so a split can be lined up
      // against the halves already drawn.
      if (sel !== '#whole' && whole.length) parts.push({ pts: whole, on: false });
      areas.forEach((a) => { if (a.area_key !== sel) parts.push({ pts: a.points, on: false, tag: a.area_key }); });

      let html = parts.filter((p) => p.pts.length > 1).map((p) =>
        `<polygon points="${p.pts.map((t) => t.x + ',' + t.y).join(' ')}" fill="rgba(148,163,184,.28)" ` +
        `stroke="#cbd5e1" stroke-width=".35"/>`).join('');

      const pts = current();
      if (pts.length) {
        if (pts.length > 1) {
          html += `<polygon points="${pts.map((t) => t.x + ',' + t.y).join(' ')}" ` +
                  `fill="rgba(250,204,21,.42)" stroke="#facc15" stroke-width=".55" ` +
                  `class="pd-poly" style="cursor:move"/>`;
        }
        pts.forEach((t, i) => {
          html += `<circle cx="${t.x}" cy="${t.y}" r="${i === 0 ? 1.3 : 1}" ` +
                  `fill="${i === 0 ? '#ef4444' : '#ffffff'}" stroke="#facc15" stroke-width=".35" ` +
                  `data-pt="${i}" style="cursor:grab"/>`;
        });
      }
      elSvg.innerHTML = html;
    }

    function renderParts() {
      const list = [{ key: '#whole', label: 'Whole plot' }]
        .concat(areas.map((a) => ({ key: a.area_key, label: 'Area ' + a.area_key })));
      q('.pd-parts').innerHTML = list.map((it) =>
        `<button class="pd-chip${it.key === sel ? ' on' : ''}" data-part="${esc(it.key)}">${esc(it.label)}</button>`
      ).join('') + (sel !== '#whole'
        ? `<button class="pd-chip pd-drop" style="border-color:#fecdd3;color:#be123c">Remove area ${esc(sel)}</button>`
        : '');

      q('.pd-guide').innerHTML = sel === '#whole'
        ? 'Tap the photo to drop corners. Drag a corner to move it, drag inside to move the whole shape, ' +
          'double-tap a corner to remove it. This is the plot as one piece.'
        : 'Area <strong>' + esc(sel) + '</strong> — draw the part of the plot this batch is standing in. ' +
          'Once a plot has areas the map draws THOSE instead of the whole plot, and each one carries its ' +
          'own PALMS status (' + esc(plot) + '#' + esc(sel) + ').';
      renderBatches();
    }

    function renderBatches() {
      const a = sel === '#whole' ? null : areas.find((x) => x.area_key === sel);
      const el = q('.pd-batches');
      if (!batches.length) {
        el.innerHTML = '<div class="pd-hint">No batch standing in this plot, or the balance view could not be read.</div>';
        return;
      }
      el.innerHTML =
        (sel === '#whole'
          ? '<div class="pd-hint" style="margin-bottom:8px">Pin a batch to an <strong>area</strong>, not to the whole plot — ' +
            'pinning is what says which half is which.</div>'
          : '') +
        batches.map((b) => {
          const on = !!(a && a.batch_name === b.batch_name);
          return `<button class="pd-batch${on ? ' on' : ''}" data-batch="${esc(b.batch_name)}"${sel === '#whole' ? ' disabled style="opacity:.5;cursor:default"' : ''}>
              <div class="pd-batch-n">${esc(b.batch_name)}</div>
              <div class="pd-batch-q">${esc(b.qty == null ? '—' : Number(b.qty).toLocaleString())} standing${on ? ' · pinned here' : ''}</div>
            </button>`;
        }).join('');
    }

    /* ---------- pointer ---------- */
    const pctOf = (e) => {
      const r = elSvg.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
        y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
      };
    };

    let lastTap = { i: -1, at: 0 };

    elSvg.addEventListener('pointerdown', (e) => {
      const pt = e.target.closest('[data-pt]');
      const p = pctOf(e);
      if (pt) {
        const i = Number(pt.dataset.pt);
        // Double-tap a corner to drop it. 400ms, and the shape keeps at
        // least three corners or it stops being a shape.
        const now = Date.now();
        if (lastTap.i === i && now - lastTap.at < 400) {
          const pts = current();
          if (pts.length > 3) { pts.splice(i, 1); setCurrent(pts); draw(); say(''); }
          else say('A shape needs at least three corners.');
          lastTap = { i: -1, at: 0 };
          return;
        }
        lastTap = { i: i, at: now };
        drag = { type: 'pt', i: i };
        elSvg.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.target.closest('.pd-poly')) {
        drag = { type: 'poly', lastX: p.x, lastY: p.y };
        elSvg.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      // Empty ground: a new corner on the end of the shape.
      const pts = current().slice();
      pts.push({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
      setCurrent(pts);
      draw();
      say('');
    });

    elSvg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = pctOf(e);
      const pts = current();
      if (drag.type === 'pt') {
        pts[drag.i] = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
      } else {
        const dx = p.x - drag.lastX, dy = p.y - drag.lastY;
        pts.forEach((t) => {
          t.x = Math.max(0, Math.min(100, Math.round((t.x + dx) * 100) / 100));
          t.y = Math.max(0, Math.min(100, Math.round((t.y + dy) * 100) / 100));
        });
        drag.lastX = p.x; drag.lastY = p.y;
      }
      setCurrent(pts);
      draw();
    });

    const endDrag = () => { drag = null; };
    elSvg.addEventListener('pointerup', endDrag);
    elSvg.addEventListener('pointercancel', endDrag);

    /* ---------- sidebar ---------- */
    bg.addEventListener('click', (e) => {
      const part = e.target.closest('[data-part]');
      if (part) { sel = part.dataset.part; renderParts(); draw(); return; }

      if (e.target.closest('.pd-drop')) {
        const a = areas.find((x) => x.area_key === sel);
        if (a) {
          if (!confirm('Remove area ' + sel + ' from the map?\n\nWhat PALMS has logged against ' +
                       plot + '#' + sel + ' is kept — the area just stops being drawn.')) return;
          removed.push(a.area_key);
          areas = areas.filter((x) => x.area_key !== sel);
          sel = areas.length ? areas[0].area_key : '#whole';
          renderParts(); draw();
        }
        return;
      }

      if (e.target.closest('.pd-add')) {
        const key = nextKey(areas);
        // A new area starts from the whole plot's shape rather than empty:
        // the halves of a plot are nearly always the plot with one edge moved,
        // and redrawing all of it from scratch is the slow way to say that.
        areas.push({ area_key: key, points: whole.map((t) => ({ x: t.x, y: t.y })), batch_name: null });
        sel = key;
        renderParts(); draw();
        say('Area ' + key + ' starts as a copy of the whole plot — drag its edge to where the split is.');
        return;
      }

      const b = e.target.closest('[data-batch]');
      if (b && !b.disabled) {
        const a = areas.find((x) => x.area_key === sel);
        if (a) {
          a.batch_name = a.batch_name === b.dataset.batch ? null : b.dataset.batch;
          renderBatches();
        }
        return;
      }

      if (e.target.closest('.pd-clear')) {
        setCurrent([]);
        draw();
        say('Cleared. Tap the photo to draw it again.');
        return;
      }
      if (e.target.closest('.pd-cancel') || e.target.closest('.pd-close') || e.target === bg) close();
    });

    function close() {
      bg.remove();
      if (typeof o.onClose === 'function') o.onClose();
    }

    /* ---------- save ---------- */
    q('.pd-save').addEventListener('click', async () => {
      const bad = areas.find((a) => a.points.length && a.points.length < 3);
      if (bad) { say('Area ' + bad.area_key + ' needs at least three corners.'); return; }
      if (whole.length && whole.length < 3) { say('The plot outline needs at least three corners.'); return; }

      const btn = q('.pd-save');
      btn.disabled = true;
      say('Saving…');
      try {
        // The plot outline. Empty means "no shape", which is what map_top
        // holds for a plot nobody has drawn yet — so it is nulled, not "[]".
        const res = await supa.from('shared_plots')
          .update({ map_top: whole.length ? JSON.stringify(whole) : null })
          .eq('plot_name', plot);
        if (res.error) throw res.error;

        for (const key of removed) {
          const r = await supa.from('nops_plot_areas').delete()
            .eq('plot_name', plot).eq('area_key', key);
          if (r.error) throw r.error;
        }

        const rows = areas.filter((a) => a.points.length >= 3).map((a) => ({
          plot_name: plot,
          area_key: a.area_key,
          polygon: JSON.stringify(a.points),
          batch_name: a.batch_name || null,
          updated_by: o.by || null,
          updated_at: new Date().toISOString(),
        }));
        if (rows.length) {
          const r = await supa.from('nops_plot_areas')
            .upsert(rows, { onConflict: 'plot_name,area_key' });
          if (r.error) throw r.error;
        }

        if (typeof o.onSaved === 'function') o.onSaved();
        close();
      } catch (err) {
        console.warn(err);
        // Redrawing the nursery is an admin job — the likeliest failure by
        // far is the policy, and saying so beats "something went wrong".
        say((err && err.message) || 'Could not save.');
        btn.disabled = false;
      }
    });

    /* ---------- load ---------- */
    (async () => {
      try {
        const [ar, ba] = await Promise.all([
          supa.from('nops_plot_areas')
            .select('area_key, polygon, batch_name').eq('plot_name', plot).order('area_key'),
          supa.from('shared_plot_batch_balance')
            .select('plot_name, batch_name, qty').eq('plot_name', plot),
        ]);
        if (!ar.error) {
          areas = (ar.data || []).map((a) => ({
            area_key: a.area_key, batch_name: a.batch_name, points: parsePoly(a.polygon),
          }));
        } else {
          console.warn('[plot draw] areas not read:', ar.error.message);
        }
        if (!ba.error) {
          batches = (ba.data || []).filter((b) => b.batch_name)
            .sort((x, y) => String(x.batch_name).localeCompare(String(y.batch_name)));
        } else {
          console.warn('[plot draw] batch balance not read:', ba.error.message);
        }
      } catch (e) {
        console.warn('[plot draw]', e);
      }
      if (areas.length) sel = areas[0].area_key;
      renderParts();
      draw();
    })();

    return { close: close };
  }

  global.MJMPlotDraw = { open: open };
})(window);
