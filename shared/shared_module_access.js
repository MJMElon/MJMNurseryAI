/* ================================================================
   MJM AI POWERED SYSTEM — MODULE USER ACCESS PAGE
   shared/shared_module_access.js

   The per-module User Access screen, as first built for Nursery
   Seedling Stock Management (operation/operation_user_access.html).
   That page is the design; this file is that design made reusable so
   every module gets the same screen instead of four drifting copies.

   A module's page is then only its configuration:

     <script src="../shared/shared_module_access.js"></script>
     <script>
       MJMModuleAccess.init({
         module:  'nursery_ops',
         title:   'Nursery Operation Manage',
         icon:    '🌿',
         accent:  'teal',                       // see ACCENTS below
         back:    { href:'nursery_ops_dashboard.html', label:'Back to Main Page' },
         pages: [
           { key:'maintenance', label:'Work Maintenance', desc:'…',
             actions:[ { key:'edit_schedule', label:'…', desc:'…' } ] }
         ]
       });
     </script>

   What it writes, per user, on shared_profiles.permissions:
     <module>_actions.<page> = { view:bool, <action>:bool, … }   authoritative
     <module>_pages.<page>   = 'normal' | 'none'                 mirror, so a
                               page that only asks "open or closed?" agrees
   Read them back with MJMAccess.canDo(module, page, action).

   Who may open it: anyone with the Manage Users flag — the same flag the
   database RLS policy requires to write another user's permissions, so the
   page cannot promise an edit the database would refuse.
   ================================================================ */
(function (global) {

  /* Tailwind is loaded per page, so classes must appear literally. */
  const ACCENTS = {
    emerald: { btn:'#10b981,#059669', ring:'rgba(16,185,129,.4)', ring2:'rgba(16,185,129,.5)',
               grad:'from-emerald-500 to-teal-600', text:'text-emerald-700', save:'bg-emerald-600 hover:bg-emerald-700',
               focus:'focus:border-emerald-500 focus:ring-emerald-100', chk:'#10b981', hdr:'bg-emerald-500' },
    teal:    { btn:'#14b8a6,#0d9488', ring:'rgba(20,184,166,.4)', ring2:'rgba(20,184,166,.5)',
               grad:'from-teal-500 to-cyan-600', text:'text-teal-700', save:'bg-teal-600 hover:bg-teal-700',
               focus:'focus:border-teal-500 focus:ring-teal-100', chk:'#14b8a6', hdr:'bg-teal-600' },
    orange:  { btn:'#f97316,#ea580c', ring:'rgba(249,115,22,.4)', ring2:'rgba(249,115,22,.5)',
               grad:'from-orange-500 to-amber-600', text:'text-orange-700', save:'bg-orange-600 hover:bg-orange-700',
               focus:'focus:border-orange-500 focus:ring-orange-100', chk:'#f97316', hdr:'bg-orange-500' },
    indigo:  { btn:'#6366f1,#4f46e5', ring:'rgba(99,102,241,.4)', ring2:'rgba(99,102,241,.5)',
               grad:'from-indigo-500 to-violet-600', text:'text-indigo-700', save:'bg-indigo-600 hover:bg-indigo-700',
               focus:'focus:border-indigo-500 focus:ring-indigo-100', chk:'#6366f1', hdr:'bg-indigo-500' },
    violet:  { btn:'#8b5cf6,#7c3aed', ring:'rgba(139,92,246,.4)', ring2:'rgba(139,92,246,.5)',
               grad:'from-violet-500 to-purple-600', text:'text-violet-700', save:'bg-violet-600 hover:bg-violet-700',
               focus:'focus:border-violet-500 focus:ring-violet-100', chk:'#8b5cf6', hdr:'bg-violet-500' }
  };

  const LEVEL_LABEL = { admin:'Admin', normal:'Normal', none:'None' };
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                                 .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function init(cfg) {
    const A       = ACCENTS[cfg.accent] || ACCENTS.emerald;
    const MODULE  = cfg.module;
    const PAGES   = cfg.pages || [];
    const SCOPES  = cfg.scopes || [];
    // Filled in before first render; a scope's choices can come from the
    // database (nursery names) rather than being hardcoded here.
    const scopeOptions = {};
    const ACT_KEY = MODULE + '_actions';
    const PG_KEY  = MODULE + '_pages';
    const BACK    = cfg.back || { href:'../index.html', label:'Back to Main Page' };
    const supa    = supabase.createClient(SHARED_SUPA_URL, SHARED_SUPA_KEY);

    let allUsers = [], totalSystem = 0, editingUid = null, editingPerms = null;

    /* A module may file this screen under a broader name — the Audit
       module calls it Settings and puts User Access inside it — and may
       hang its own sections beside the user list. Both are opt-in: with
       neither, the page is exactly the User Access screen it has always
       been. */
    const PAGE_LABEL = cfg.pageLabel || 'User Access';
    const TABS       = cfg.tabs || [];
    /* Per-user settings beyond the access ticks — the Audit module uses
       this for the portal an auditor lands on. Stored on the same
       permissions object, under the key each field names. */
    const FIELDS     = cfg.userFields || [];

    document.title = PAGE_LABEL + ' — ' + cfg.title;
    document.head.insertAdjacentHTML('beforeend', styleTag(A));
    document.body.innerHTML = pageHtml(cfg, A, BACK, PAGE_LABEL, TABS);

    const $ = id => document.getElementById(id);

    /* ── Section tabs ────────────────────────────────────────────────
       Only rendered when the module asked for extra sections. The user
       list is always the first one, so a module that adds none behaves
       as before and nothing here runs. */
    if (TABS.length) {
      const panels = ['access'].concat(TABS.map(s => s.key));
      const show = (key) => {
        panels.forEach(k => {
          const panel = $('ma-sec-' + k);
          const tab   = $('ma-tab-' + k);
          if (panel) panel.classList.toggle('hidden', k !== key);
          if (tab) {
            tab.classList.toggle('ma-tab-on', k === key);
            tab.setAttribute('aria-selected', k === key ? 'true' : 'false');
          }
        });
        try { sessionStorage.setItem('ma_tab_' + MODULE, key); } catch (_) {}
      };
      panels.forEach(k => {
        const tab = $('ma-tab-' + k);
        if (tab) tab.addEventListener('click', () => show(k));
      });
      // Each section is handed its own container once, after it is in the
      // DOM, so it can wire up whatever it drew.
      TABS.forEach(s => {
        const el = $('ma-sec-' + s.key);
        if (el && typeof s.mount === 'function') {
          try { s.mount(el); } catch (e) { console.warn('[module-access] section', s.key, e); }
        }
      });
      let start = 'access';
      try { start = sessionStorage.getItem('ma_tab_' + MODULE) || 'access'; } catch (_) {}
      show(panels.includes(start) ? start : 'access');
    }

    /* ── What this user can actually do on one page, today ──────────
       The saved entry wins when present. Otherwise nothing has been
       decided for them, so show what the module level alone allows —
       which is what they can do right now. Anything else would show an
       admin ticks that do not match reality. */
    function effectiveActions(perms, d) {
      const saved = perms[ACT_KEY] && perms[ACT_KEY][d.key];
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        const out = { view: !!saved.view };
        (d.actions || []).forEach(a => { out[a.key] = out.view && !!saved[a.key]; });
        return out;
      }
      const lvl = (perms.modules && perms.modules[MODULE]) || 'none';
      const view = lvl !== 'none';
      const out = { view };
      // Admin-only functions are the ones a module admin already has; the
      // rest come with the page, which is how the module behaved before
      // per-function access existed.
      (d.actions || []).forEach(a => { out[a.key] = view && (a.adminOnly ? lvl === 'admin' : true); });
      return out;
    }

    function initials(p) {
      const src = (p.full_name || p.email || '?').trim();
      return src.split(/\s+/).map(s => s[0]).slice(0,2).join('').toUpperCase() || '?';
    }

    function showToast(msg, kind) {
      const t = $('toast');
      t.textContent = msg;
      t.className = 'fixed bottom-6 right-6 z-[80] px-5 py-3 rounded-xl font-bold text-sm shadow-lg ' +
        (kind === 'err' ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200');
      setTimeout(() => t.classList.add('hidden'), 2400);
      t.classList.remove('hidden');
    }

    function summaryHtml(perms) {
      const locked = [], roles = [];
      PAGES.forEach(d => {
        const eff = effectiveActions(perms, d);
        if (!eff.view) { locked.push(`<span class="chip chip-none">${esc(d.label)} · Locked</span>`); return; }
        (d.actions || []).forEach(a => {
          if (a.highlight && eff[a.key]) roles.push(`<span class="chip chip-manage">${esc(a.chip || a.label)}</span>`);
        });
      });
      const manageChip = perms.manage_users ? '<span class="chip chip-manage">Can Change User Roles</span>' : '';
      const chips = locked.join(' ') + roles.join(' ');
      const fallback = !chips && !manageChip ? '<span class="chip chip-info">All pages open</span>' : '';
      return `<div class="flex flex-wrap gap-1.5">${chips}${manageChip}${fallback}</div>`;
    }

    function rowHtml(p) {
      const lvl = (p.permissions.modules && p.permissions.modules[MODULE]) || 'none';
      return `
        <div class="user-row" data-uid="${p.id}">
          <div class="w-11 h-11 rounded-full bg-gradient-to-br ${A.grad} text-white flex items-center justify-center font-black text-sm shrink-0">${initials(p)}</div>
          <div class="flex-1 min-w-0">
            <div class="font-black text-slate-800 text-sm leading-tight truncate">${esc(p.full_name) || '<span class="text-slate-400">(no name)</span>'}
              <span class="chip chip-${lvl === 'admin' ? 'admin' : 'normal'}" style="margin-left:6px">Module · ${LEVEL_LABEL[lvl] || lvl}</span>
            </div>
            <div class="text-[12px] text-slate-500 font-semibold truncate">${esc(p.email) || '—'}</div>
            <div class="mt-2">${summaryHtml(p.permissions)}</div>
          </div>
          <button class="edit-btn shrink-0" data-action="edit" data-uid="${p.id}">
            Edit Access
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>`;
    }

    function render() {
      const q = ($('search').value || '').toLowerCase().trim();
      const filtered = !q ? allUsers : allUsers.filter(p =>
        (p.email || '').toLowerCase().includes(q) || (p.full_name || '').toLowerCase().includes(q));
      $('users-list').innerHTML = filtered.length
        ? filtered.map(rowHtml).join('')
        : `<div class="text-center text-slate-400 text-sm py-12">${allUsers.length ? 'No users match your search.' : 'No users have been opened for this module yet.'}</div>`;
      // The list is module-scoped on purpose — say so with numbers, so an
      // absent colleague reads as "not opened here" rather than "missing".
      const notOpened = Math.max(0, totalSystem - allUsers.length);
      $('count-line').textContent =
        `${allUsers.length} user${allUsers.length === 1 ? '' : 's'} opened for this module` +
        (notOpened ? ` · ${notOpened} other system user${notOpened === 1 ? '' : 's'} not opened for it (manage on the main portal)` : '');
    }

    // ── Drawer ───────────────────────────────────────────────────
    function pageCardHtml(d, eff) {
      const acts = (d.actions || []).map(a => `
          <label class="act-row" for="d-act-${d.key}-${a.key}">
            <input type="checkbox" class="act-chk" id="d-act-${d.key}-${a.key}"
                   data-page="${d.key}" data-action="${a.key}" ${eff[a.key] ? 'checked' : ''}>
            <span>
              <span class="block font-bold text-slate-800 text-[13px] leading-tight">${esc(a.label)}</span>
              <span class="block text-[11px] text-slate-500">${esc(a.desc)}</span>
            </span>
          </label>`).join('');
      return `
        <div class="page-card ${eff.view ? '' : 'page-off'}" id="d-card-${d.key}">
          <div class="page-card-head">
            <div>
              <div class="font-black text-slate-800 text-sm">${esc(d.label)}</div>
              <div class="text-[11px] text-slate-500">${esc(d.desc)}</div>
            </div>
            <label class="flex items-center gap-2 cursor-pointer shrink-0">
              <span class="text-[9px] font-black uppercase tracking-widest ${eff.view ? A.text : 'text-rose-600'}" id="d-view-label-${d.key}">${eff.view ? 'Open Page' : 'Locked'}</span>
              <span class="tog">
                <input type="checkbox" id="d-view-${d.key}" data-view-page="${d.key}" ${eff.view ? 'checked' : ''}>
                <span class="tog-slider"></span>
              </span>
            </label>
          </div>
          ${acts ? `<div class="page-card-acts">${acts}</div>`
                 : `<div class="page-card-acts text-[11px] text-slate-400 py-2">View-only page — no extra functions.</div>`}
        </div>`;
    }

    /* ── Scopes ──────────────────────────────────────────────────────
       A page answers "may they open it?". A scope answers "how much of
       it do they see?" — for the Scan Portal, which nurseries.

       Stored as a bare array on permissions, e.g.
         plot_status_nurseries: ['BNN']
       and ABSENT when the answer is "all of them". Absent-means-all is
       the reader's existing rule (lib/access.js in the FC portal), and
       keeping it that way means nobody who has never been near this
       screen is quietly narrowed to nothing. */
    function scopeValue(perms, s) {
      const v = perms[s.key];
      return Array.isArray(v) ? v : null;          // null = everything
    }

    function scopeCardHtml(s, perms) {
      const sel  = scopeValue(perms, s);
      const all  = sel === null;
      const opts = (scopeOptions[s.key] || []).map(o => `
          <label class="act-row" for="d-scope-${s.key}-${o}">
            <input type="checkbox" class="act-chk" id="d-scope-${s.key}-${o}"
                   data-scope="${s.key}" value="${esc(o)}" ${!all && sel.includes(o) ? 'checked' : ''}>
            <span><span class="block font-bold text-slate-800 text-[13px] leading-tight">${esc(o)}</span></span>
          </label>`).join('');
      return `
        <div class="page-card" id="d-scope-card-${s.key}">
          <div class="page-card-head">
            <div>
              <div class="font-black text-slate-800 text-sm">${esc(s.label)}</div>
              <div class="text-[11px] text-slate-500">${esc(s.desc || '')}</div>
            </div>
            <label class="flex items-center gap-2 cursor-pointer shrink-0">
              <span class="text-[9px] font-black uppercase tracking-widest ${A.text}" id="d-scope-all-label-${s.key}">${esc(s.allLabel || 'All')}</span>
              <span class="tog">
                <input type="checkbox" id="d-scope-all-${s.key}" data-scope-all="${s.key}" ${all ? 'checked' : ''}>
                <span class="tog-slider"></span>
              </span>
            </label>
          </div>
          <div class="page-card-acts" id="d-scope-list-${s.key}">
            ${opts || `<div class="text-[11px] text-slate-400 py-2">${esc(s.emptyText || 'Nothing to choose from yet.')}</div>`}
          </div>
        </div>`;
    }

    function syncScopeCard(scopeKey) {
      const allEl = $('d-scope-all-' + scopeKey);
      if (!allEl) return;
      const list = $('d-scope-list-' + scopeKey);
      // "All" and a hand-picked list are alternatives, so show only one.
      if (list) list.style.display = allEl.checked ? 'none' : '';
    }

    function syncPageCard(pageKey) {
      const view = $('d-view-' + pageKey).checked;
      $('d-card-' + pageKey).classList.toggle('page-off', !view);
      const lbl = $('d-view-label-' + pageKey);
      if (lbl) {
        lbl.textContent = view ? 'Open Page' : 'Locked';
        lbl.className = 'text-[9px] font-black uppercase tracking-widest ' + (view ? A.text : 'text-rose-600');
      }
    }

    function openDrawer(uid) {
      const p = allUsers.find(x => x.id === uid);
      if (!p) return;
      editingUid = uid;
      editingPerms = JSON.parse(JSON.stringify(p.permissions));
      $('d-avatar').textContent = initials(p);
      $('d-name').textContent  = p.full_name || '(no name)';
      $('d-email').textContent = p.email || '—';
      const lvl = (editingPerms.modules && editingPerms.modules[MODULE]) || 'none';
      $('d-level').innerHTML =
        `<span class="chip chip-${lvl === 'admin' ? 'admin' : 'normal'}">Module level · ${LEVEL_LABEL[lvl] || lvl}</span>
         <span class="chip chip-info">set on main portal</span>`;
      $('d-fields').innerHTML = FIELDS.map(f => userFieldHtml(f, editingPerms[f.key])).join('');
      $('d-pages').innerHTML = PAGES.map(d => pageCardHtml(d, effectiveActions(editingPerms, d))).join('')
                             + SCOPES.map(s => scopeCardHtml(s, editingPerms)).join('');
      SCOPES.forEach(s => syncScopeCard(s.key));
      $('d-manage-users').checked = !!editingPerms.manage_users;
      $('drawer').classList.add('open');
      $('drawer-backdrop').classList.add('open');
      $('drawer').setAttribute('aria-hidden', 'false');
    }

    function closeDrawer() {
      $('drawer').classList.remove('open');
      $('drawer-backdrop').classList.remove('open');
      $('drawer').setAttribute('aria-hidden', 'true');
      editingUid = null; editingPerms = null;
    }

    function applyPreset(preset) {
      PAGES.forEach(d => {
        const viewEl = $('d-view-' + d.key);
        if (viewEl) viewEl.checked = preset !== 'none';
        (d.actions || []).forEach(a => {
          const el = $(`d-act-${d.key}-${a.key}`);
          if (el) el.checked = preset === 'full';
        });
        syncPageCard(d.key);
      });
    }

    async function saveDrawer() {
      if (!editingUid || !editingPerms) return;
      const p = allUsers.find(x => x.id === editingUid);
      if (!p) return;

      // Mutate ONLY this module's fields on the full permissions object, so
      // nothing managed elsewhere (module levels, other modules) is touched.
      const next = JSON.parse(JSON.stringify(editingPerms));
      next[ACT_KEY] = next[ACT_KEY] || {};
      next[PG_KEY]  = next[PG_KEY]  || {};
      PAGES.forEach(d => {
        const view = $('d-view-' + d.key).checked;
        const acts = { view };
        (d.actions || []).forEach(a => { acts[a.key] = view && $(`d-act-${d.key}-${a.key}`).checked; });
        next[ACT_KEY][d.key] = acts;
        next[PG_KEY][d.key]  = view ? 'normal' : 'none';
      });

      FIELDS.forEach(f => {
        const el = $('d-field-' + f.key);
        if (!el) return;
        const v = el.value;
        // An empty choice is the field's own default, and defaults are
        // written by absence so a later change of default reaches everyone
        // who never chose.
        if (v === '') delete next[f.key]; else next[f.key] = v;
      });

      SCOPES.forEach(sc => {
        const allEl = $('d-scope-all-' + sc.key);
        if (!allEl) return;
        if (allEl.checked) {
          // Absent means "everything" to the reader, so remove the key rather
          // than writing out every option — a nursery added later is then
          // included automatically instead of silently missing.
          delete next[sc.key];
        } else {
          next[sc.key] = Array.from(
            document.querySelectorAll(`input[data-scope="${sc.key}"]:checked`)
          ).map(el => el.value);
        }
      });

      const manageEl = $('d-manage-users');
      const me = MJMAccess.user();
      if (me && editingUid === me.id && editingPerms.manage_users && !manageEl.checked
          && !confirm('You are removing YOUR OWN "able to change user roles" permission. You will lose access to this page. Continue?')) {
        return;
      }
      next.manage_users = manageEl.checked;

      const btn = $('d-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      const { error } = await supa.from('shared_profiles').update({ permissions: next }).eq('id', editingUid);
      btn.disabled = false; btn.textContent = 'Save Changes';

      if (error) { console.error(error); showToast('Save failed: ' + error.message, 'err'); return; }

      p.permissions = next;
      showToast('Saved. Changes apply on the user’s next refresh.');
      render();
      closeDrawer();
    }

    // ── Events ───────────────────────────────────────────────────
    document.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-action="edit"]');
      if (editBtn) { openDrawer(editBtn.dataset.uid); return; }
      const preset = e.target.closest('[data-preset]');
      if (preset) { applyPreset(preset.dataset.preset); return; }
    });
    document.addEventListener('change', (e) => {
      if (e.target.matches('input[data-view-page]')) syncPageCard(e.target.dataset.viewPage);
      if (e.target.matches('input[data-scope-all]')) syncScopeCard(e.target.dataset.scopeAll);
    });
    $('d-close').addEventListener('click', closeDrawer);
    $('d-cancel').addEventListener('click', closeDrawer);
    $('d-save').addEventListener('click', saveDrawer);
    $('drawer-backdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
    $('search').addEventListener('input', render);
    $('reload-btn').addEventListener('click', () => bootstrap());

    // ── Bootstrap ────────────────────────────────────────────────
    async function bootstrap() {
      $('loading').classList.remove('hidden');
      $('main').classList.add('hidden');
      $('forbidden').classList.add('hidden');

      await MJMAccess.load(supa);
      if (!MJMAccess.user()) { window.location.href = BACK.href; return; }
      // Writing another user's permissions needs the Manage Users flag (the
      // database RLS policy enforces it), so gate the page on the same flag
      // rather than letting somebody fill a form that cannot save.
      if (!MJMAccess.canManageUsers()) {
        $('loading').classList.add('hidden');
        $('forbidden').classList.remove('hidden');
        return;
      }

      // A scope's choices may come from the database (the nursery list), so
      // resolve them before anyone can open a drawer. A failure here leaves
      // the scope card empty rather than taking the whole page down.
      await Promise.all(SCOPES.map(async sc => {
        try {
          const v = typeof sc.options === 'function' ? await sc.options(supa) : sc.options;
          scopeOptions[sc.key] = Array.isArray(v) ? v : [];
        } catch (e) {
          console.error('scope options failed for ' + sc.key, e);
          scopeOptions[sc.key] = [];
        }
      }));

      const { data, error } = await supa
        .from('shared_profiles')
        .select('id, email, full_name, permissions, user_type')
        .order('email', { ascending: true });

      if (error) {
        $('loading').classList.add('hidden');
        showToast('Load failed: ' + error.message, 'err');
        return;
      }

      const systemUsers = (data || [])
        .filter(p => (p.user_type || 'system') === 'system')
        .map(p => ({ id: p.id, email: p.email, full_name: p.full_name,
                     permissions: (p.permissions && typeof p.permissions === 'object') ? p.permissions : {} }));
      totalSystem = systemUsers.length;
      allUsers = systemUsers.filter(p => {
        const lvl = p.permissions.modules && p.permissions.modules[MODULE];
        return lvl === 'admin' || lvl === 'normal';
      });

      $('loading').classList.add('hidden');
      $('main').classList.remove('hidden');
      render();
    }

    bootstrap();
  }

  /* ── Markup and styling, identical across modules bar the accent ── */
  function styleTag(A) {
    return `<style>
  * { font-family: 'Outfit', system-ui, sans-serif; }
  body { background:#f1f5f9; margin:0; }
  .card { background:white; border:1px solid #e2e8f0; border-radius:20px; box-shadow:0 4px 16px rgba(0,0,0,.06); }
  .chip { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; font-size:10px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
  .chip-admin  { background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; }
  .chip-normal { background:#eff6ff; color:#1e3a8a; border:1px solid #bfdbfe; }
  .chip-none   { background:#fff1f2; color:#9f1239; border:1px solid #fecdd3; }
  .chip-info   { background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0; }
  .chip-manage { background:#fffbeb; color:#92400e; border:1px solid #fde68a; }
  .edit-btn { display:inline-flex; align-items:center; gap:6px; padding:10px 16px; border-radius:12px; font-size:11px; font-weight:900; letter-spacing:.1em; text-transform:uppercase; background:linear-gradient(135deg,${A.btn}); color:white; border:none; cursor:pointer; box-shadow:0 6px 14px -4px ${A.ring}; transition:all .15s; }
  .edit-btn:hover { transform:translateY(-1px); box-shadow:0 10px 18px -4px ${A.ring2}; }
  .drawer-backdrop { position:fixed; inset:0; background:rgba(15,23,42,.6); z-index:60; opacity:0; pointer-events:none; transition:opacity .25s; backdrop-filter:blur(4px); }
  .drawer-backdrop.open { opacity:1; pointer-events:auto; }
  .drawer { position:fixed; top:0; right:0; bottom:0; width:100%; max-width:480px; background:white; z-index:70; transform:translateX(100%); transition:transform .3s cubic-bezier(.4,0,.2,1); display:flex; flex-direction:column; box-shadow:-20px 0 60px rgba(0,0,0,.2); }
  .drawer.open { transform:translateX(0); }
  .page-card { border:1.5px solid #e2e8f0; border-radius:16px; overflow:hidden; transition:border-color .15s; }
  .page-card.page-off { border-color:#fecdd3; background:#fff7f7; }
  .page-card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; background:#f8fafc; }
  .page-card.page-off .page-card-head { background:#fff1f2; }
  .page-card-acts { padding:6px 16px 12px; }
  .page-card.page-off .page-card-acts { opacity:.45; pointer-events:none; }
  .act-row { display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-bottom:1px dashed #f1f5f9; cursor:pointer; }
  .act-row:last-child { border-bottom:none; }
  .act-chk { width:19px; height:19px; margin-top:1px; accent-color:${A.chk}; cursor:pointer; flex-shrink:0; }
  .tog { position:relative; display:inline-block; width:48px; height:26px; flex-shrink:0; }
  .tog input { opacity:0; width:0; height:0; }
  .tog-slider { position:absolute; cursor:pointer; inset:0; background:#cbd5e1; border-radius:999px; transition:.25s; }
  .tog-slider::before { position:absolute; content:''; left:3px; top:3px; width:20px; height:20px; background:white; border-radius:50%; transition:.25s; box-shadow:0 1px 3px rgba(0,0,0,.25); }
  .tog input:checked + .tog-slider { background:#f59e0b; }
  .tog input:checked + .tog-slider::before { transform:translateX(22px); }
  .preset-btn { padding:8px 14px; font-size:11px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; border-radius:10px; border:1.5px solid #e2e8f0; background:white; color:#334155; cursor:pointer; transition:all .15s; }
  .preset-btn:hover { background:#f1f5f9; border-color:#cbd5e1; }
  /* Section tabs — only present on a page that asked for sections. */
  .ma-tabs { display:flex; gap:8px; flex-wrap:wrap; }
  .ma-tab { font-size:11px; font-weight:900; letter-spacing:.12em; text-transform:uppercase;
            color:#64748b; background:#fff; border:1px solid #e2e8f0; border-radius:999px;
            padding:10px 18px; cursor:pointer; font-family:inherit; transition:all .15s; }
  .ma-tab:hover { background:#f8fafc; color:#334155; }
  .ma-tab-on { color:#fff; border-color:transparent; background:${A.chk}; box-shadow:0 4px 12px ${A.ring}; }
  .user-row { padding:18px 22px; display:flex; align-items:center; gap:16px; border-bottom:1px solid #f1f5f9; transition:background .15s; }
  .user-row:hover { background:#f8fafc; }
  .user-row:last-child { border-bottom:none; }
</style>`;
  }

  /* One extra per-user setting. Only a select for now — the one thing
     asked for is a choice from a short list, and a text box would invite
     values nothing can honour. */
  function userFieldHtml(f, value) {
    const v = value == null ? '' : String(value);
    return `
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="font-black text-slate-800 text-sm">${esc(f.label)}</div>
      ${f.help ? `<p class="text-[11px] text-slate-600 mt-1 leading-relaxed">${f.help}</p>` : ''}
      <select id="d-field-${esc(f.key)}"
              class="mt-3 w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-semibold outline-none">
        ${(f.options || []).map(o =>
          `<option value="${esc(o.value)}"${o.value === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
    </div>`;
  }

  function pageHtml(cfg, A, BACK, PAGE_LABEL, TABS) {
    const note = cfg.note ||
      `This page manages users who were <strong>opened for this module</strong> on the main portal's User Access.
       For each of them, tick exactly what they can do on every page — and whether they can
       <strong>change other users' roles</strong>.`;
    return `
<div class="bg-white border-b border-slate-200 px-6 py-4 grid grid-cols-3 items-center sticky top-0 z-30 shadow-sm">
  <a href="${esc(BACK.href)}" class="justify-self-start text-[10px] font-bold text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 hover:bg-slate-100 px-4 py-2 rounded-full border border-slate-200 no-underline transition-colors">&#8592; ${esc(BACK.label)}</a>
  <span class="justify-self-center text-center font-black text-slate-800 uppercase tracking-widest text-sm">${esc(cfg.barLabel || 'Module User Access')}</span>
  <div class="justify-self-end flex items-center gap-2">
    ${cfg.portal ? `<a href="${esc(cfg.portal.href)}" target="_blank" rel="noopener"
       class="text-[10px] font-bold ${A.text} hover:brightness-90 uppercase tracking-widest bg-white px-4 py-2 rounded-full border border-slate-200 no-underline transition-colors whitespace-nowrap">${esc(cfg.portal.label)} &#8599;</a>` : ''}
    <div class="w-8 h-8 ${A.hdr} rounded-lg flex items-center justify-center text-white font-black text-xs">AI</div>
  </div>
</div>

<div id="loading" class="max-w-[900px] mx-auto px-6 py-16 text-center text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">Loading user list…</div>

<div id="forbidden" class="max-w-[900px] mx-auto px-6 py-16 hidden">
  <div class="card p-10 text-center">
    <div class="text-4xl mb-3">🔒</div>
    <h2 class="text-lg font-black text-slate-800 uppercase tracking-widest">Access Denied</h2>
    <p class="text-xs text-slate-500 mt-2">Only users with <strong>Manage Users</strong> permission can open this page.</p>
    <a href="${esc(BACK.href)}" class="inline-block mt-6 text-[10px] font-bold ${A.text} uppercase tracking-widest bg-slate-50 border border-slate-200 rounded-full px-4 py-2 no-underline">${esc(BACK.label)}</a>
  </div>
</div>

<div id="main" class="max-w-[900px] mx-auto px-6 py-8 space-y-6 hidden">
  <div class="card p-6 space-y-4">
    <div class="flex items-center gap-3">
      <span class="text-2xl">${cfg.icon || '🔐'}</span>
      <h1 class="text-base font-black text-slate-800 uppercase tracking-widest">${esc(cfg.title)} — ${esc(PAGE_LABEL)}</h1>
    </div>
    <p class="text-[13px] text-slate-600 leading-relaxed">${note}</p>
    <p class="text-[12px] text-slate-500 leading-relaxed">
      To open or close the module itself for someone (or add a new user), use the main portal's
      <a href="../user_access.html" class="${A.text} font-bold underline underline-offset-2">User Access</a>.
    </p>
  </div>

  ${TABS.length ? `
  <div class="ma-tabs" role="tablist">
    <button id="ma-tab-access" role="tab" class="ma-tab">${esc(cfg.accessLabel || 'User Access')}</button>
    ${TABS.map(s => `<button id="ma-tab-${esc(s.key)}" role="tab" class="ma-tab">${esc(s.label)}</button>`).join('')}
  </div>` : ''}

  <div id="ma-sec-access" class="space-y-6">
    <div class="flex flex-col md:flex-row gap-3 items-stretch">
      <input id="search" type="text" placeholder="🔎 Search users by email or name…" class="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold outline-none ${A.focus} focus:ring-4">
      <button id="reload-btn" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[10px] uppercase tracking-widest px-5 py-3 rounded-xl border border-slate-200">Reload</button>
    </div>

    <div id="users-list" class="card overflow-hidden"></div>

    <p id="count-line" class="text-[11px] font-bold text-slate-600 text-center">—</p>
    <p class="text-[11px] text-slate-500 text-center">
      Someone missing here? They haven't been opened for this module yet — grant them
      <strong>${esc(cfg.moduleLabel || cfg.title)}</strong> access on the main portal's
      <a href="../user_access.html" class="${A.text} font-bold underline underline-offset-2">User Access</a> first.
    </p>
  </div>

  ${TABS.map(s => `<div id="ma-sec-${esc(s.key)}" class="space-y-6 hidden">${s.html || ''}</div>`).join('')}
</div>

<div id="drawer-backdrop" class="drawer-backdrop"></div>
<aside id="drawer" class="drawer" aria-hidden="true">
  <header class="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4">
    <div class="flex items-center gap-3 min-w-0">
      <div id="d-avatar" class="w-12 h-12 rounded-full bg-gradient-to-br ${A.grad} text-white flex items-center justify-center font-black text-sm shrink-0">??</div>
      <div class="min-w-0">
        <div id="d-name"  class="font-black text-slate-800 truncate">—</div>
        <div id="d-email" class="text-[12px] text-slate-500 font-semibold truncate">—</div>
        <div id="d-level" class="mt-1"></div>
      </div>
    </div>
    <button id="d-close" class="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center text-xl leading-none">×</button>
  </header>

  <div class="flex-1 overflow-y-auto">
    <section class="px-6 py-5">
      <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Function Access — Inside This Module</div>
      <p class="text-[11px] text-slate-500 leading-relaxed mb-4">
        Tick each function this user may use. <strong>Open page</strong> controls whether the page appears at all —
        switching it off locks every function on that page.
      </p>
      <div id="d-pages" class="space-y-3"></div>
      <div id="d-fields" class="mt-5 space-y-3"></div>

      <div class="mt-5 pt-4 border-t border-dashed border-slate-200">
        <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Quick Set — applies to all pages</div>
        <div class="flex flex-wrap gap-2">
          <button class="preset-btn" data-preset="full">Full Access</button>
          <button class="preset-btn" data-preset="view">View Only</button>
          <button class="preset-btn" data-preset="none">No Access</button>
        </div>
      </div>
    </section>

    <section class="px-6 py-5 border-t border-slate-200 bg-rose-50/40">
      <div class="text-[10px] font-black text-rose-700 uppercase tracking-widest mb-2">User Management</div>
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="font-black text-slate-800 text-sm">Able to change user roles</div>
          <p class="text-[11px] text-slate-600 mt-1 leading-relaxed">
            Lets this user open the <strong>User Access</strong> pages and set every other user's
            access — pages, functions, and roles. Give this only to admins you trust to manage access for you.
          </p>
        </div>
        <label class="tog mt-1">
          <input id="d-manage-users" type="checkbox">
          <span class="tog-slider"></span>
        </label>
      </div>
    </section>
  </div>

  <footer class="px-6 py-4 border-t border-slate-200 flex justify-end items-center gap-3 bg-slate-50">
    <button id="d-cancel" class="px-5 py-3 rounded-xl text-slate-600 font-black text-[11px] uppercase tracking-widest hover:bg-slate-100">Cancel</button>
    <button id="d-save"   class="px-6 py-3 rounded-xl ${A.save} text-white font-black text-[11px] uppercase tracking-widest shadow">Save Changes</button>
  </footer>
</aside>

<div id="toast" class="fixed bottom-6 right-6 hidden z-[80] px-5 py-3 rounded-xl font-bold text-sm shadow-lg"></div>`;
  }

  global.MJMModuleAccess = { init };
})(window);
