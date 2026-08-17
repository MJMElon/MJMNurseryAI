/* BUILD: 2026-08-17g */
/* ================================================================
   MJM NURSERY — SUPABASE SHARED CONFIG
   supabase.js
   ================================================================ */

const SUPA_URL = 'https://kibqjztozokohqmhqqqf.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';

/* ================================================================
   SIGNING IN TO THE DATABASE

   Every request used to go out with the anon key, so Postgres saw the
   role `anon` no matter who was logged in. The only policies on the
   audit_* tables are audit_module_read / audit_module_write, both
   "TO authenticated" (shared/migration_rls_hardening.sql), and both call
   _mjm_has_module(), which needs auth.uid(). As anon there is no uid, so
   SELECT was filtered down to zero rows — silently, because RLS filters
   rather than errors — and INSERT was refused, which is what parked
   records in the offline queue forever.

   The login already stores a real session; this just uses it. Falls back
   to the anon key when there is no session (first run, offline login),
   which is no worse than before.
================================================================ */
const SUPA_REF = SUPA_URL.replace(/^https:\/\//, '').split('.')[0];
const AUTH_STORAGE_KEY = `sb-${SUPA_REF}-auth-token`;

function storedSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null'); }
  catch (e) { return null; }
}

let _refreshing = null;

/* The signed-in user's access token, refreshed if it has aged out.
   Returns null when there is no usable session — never throws. */
async function accessToken() {
  const s = storedSession();
  if (!s || !s.access_token) return null;

  // 60s of slack so a token does not expire mid-request.
  const expiresAt = (s.expires_at || 0) * 1000;
  if (!expiresAt || expiresAt - Date.now() > 60000) return s.access_token;
  if (!s.refresh_token) return null;

  // Only one refresh in flight; the rest of the page waits on the same one.
  if (!_refreshing) {
    _refreshing = fetch(`${SUPA_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    })
      .then(r => r.ok ? r.json() : null)
      .then(fresh => {
        if (!fresh || !fresh.access_token) return null;
        // Write it back in the shape supabase-js stores, so the login page's
        // client picks up the same session.
        const next = Object.assign({}, s, fresh);
        next.expires_at = fresh.expires_at ||
          Math.floor(Date.now() / 1000) + (fresh.expires_in || 3600);
        try { localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
        return next.access_token;
      })
      .catch(() => null)          // offline, or the refresh token is spent
      .finally(() => { _refreshing = null; });
  }
  return _refreshing;
}

/* ================================================================
   WHO MAY DELETE

   Deleting an audit record is admin-only. This lives here, once, because
   every audit page loads this file — four copies of the same rule is how
   plot ended up with no gate at all while papan had one.

   This only decides what the screen offers. It is trivially bypassable
   from the console, so the real gate is the RLS delete policy on the
   audit_* tables (shared/migration_audit_admin_delete.sql). Keep both.
================================================================ */
/* ================================================================
   PAGE ACCESS

   audit_user_access.html has always written audit_actions.<page> and
   audit_pages.<page> into shared_profiles, but nothing in the audit
   module ever read them — the pages gated on the role string in
   mjm_user instead. So unticking "Audit Report" for an auditor saved
   correctly and changed nothing they could see. Two access systems for
   one module; this is the audit side finally reading the portal's.

   Inferred from the filename so there is one gate rather than one per
   page. Keys match the `pages` list in audit_user_access.html.
================================================================ */
const AUDIT_PAGE_KEYS = {
  'audit_plot_audit.html':        'plot_audit',
  'audit_height_index.html':      'height',
  'audit_papan_index.html':       'papan',
  'audit_maintenance_index.html': 'maintenance',
  'audit_report.html':            'report'
};

function canOpenAuditPage(page) {
  try {
    const u = JSON.parse(localStorage.getItem('mjm_user') || '{}');
    const p = u.permissions || {};
    // audit_actions is authoritative; audit_pages mirrors it.
    const acts = p.audit_actions && p.audit_actions[page];
    if (acts) return !!acts.view;
    const lvl = p.audit_pages && p.audit_pages[page];
    if (lvl) return lvl !== 'none';
    // Nothing configured for this user: unchanged behaviour, everything open.
    // Deliberately not gated on modules.audit — most auditors have never had
    // that set, and using it here would lock out the whole team at once.
    return true;
  } catch (e) { return true; }
}

/* Pull the current permissions down so a revoked page stops working on the
   next page load rather than at the next login. */
async function refreshAuditPermissions() {
  try {
    if (!navigator.onLine) return false;
    const u = JSON.parse(localStorage.getItem('mjm_user') || '{}');
    if (!u.id) return false;
    const rows = await sbFetch(
      `shared_profiles?select=permissions,role,user_type&id=eq.${encodeURIComponent(u.id)}`);
    if (!rows || !rows.length) return false;
    u.permissions = rows[0].permissions || null;
    if (rows[0].role) u.role = rows[0].role;
    localStorage.setItem('mjm_user', JSON.stringify(u));
    return true;
  } catch (e) { return false; }
}

/* Send them back to the menu and explain there, rather than blanking the page
   under a half-initialised script. */
function denyAuditPage(page) {
  location.replace('audit_home.html#no-access=' + encodeURIComponent(page));
}

/* The other end of that redirect. Lives here so audit_home needs no changes. */
function showNoAccessNotice() {
  const m = /#no-access=([\w-]+)/.exec(location.hash || '');
  if (!m) return;
  history.replaceState(null, '', location.pathname);   // don't re-fire on reload
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;padding:11px 16px;' +
    'background:#b45309;color:#fff;font-size:12.5px;font-weight:600;text-align:center;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;cursor:pointer";
  b.textContent = '🔒 You no longer have access to that page. Ask an admin to switch it ' +
                  'back on in User Access.';
  b.onclick = () => b.remove();
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 9000);
}

/* Hide links to pages this user may not open, so the menu matches reality. */
function hideDeniedAuditLinks() {
  Object.keys(AUDIT_PAGE_KEYS).forEach(file => {
    if (canOpenAuditPage(AUDIT_PAGE_KEYS[file])) return;
    document.querySelectorAll('a[href*="' + file + '"]').forEach(a => {
      a.style.display = 'none';
    });
  });
}

function currentAuditPageKey() {
  return AUDIT_PAGE_KEYS[(location.pathname.split('/').pop() || '').toLowerCase()];
}

/* Runs while the document is still parsing — this file is loaded above each
   page's own script — so a page we already know is off limits redirects
   before anything of it is built. */
(function denyEarly() {
  const page = currentAuditPageKey();
  if (page && !canOpenAuditPage(page)) denyAuditPage(page);
})();

async function applyAuditAccess() {
  const page = currentAuditPageKey();
  showNoAccessNotice();
  hideDeniedAuditLinks();

  // Confirm against the server, in case it changed since they last signed in.
  if (await refreshAuditPermissions()) {
    if (page && !canOpenAuditPage(page)) { denyAuditPage(page); return; }
    hideDeniedAuditLinks();
  }

  /* Anything drawn from the cached permissions — the admin-only Back End
     link, say — was decided before this refresh landed, so a role changed
     in User Access would not show until the load after next. Tell the page
     the fresh answer is in. */
  document.dispatchEvent(new Event('mjm-audit-access-ready'));
}
document.addEventListener('DOMContentLoaded', applyAuditAccess);

/* A signed-in user whose session has lapsed falls back to the anon key, and
   anon reads come back empty rather than failing — the screen would just say
   "no records" again. Say so instead. */
async function warnIfSessionLapsed() {
  try {
    if (!navigator.onLine) return;                       // offline is expected
    if (!localStorage.getItem('mjm_user')) return;       // not signed in at all
    if (await accessToken()) return;                     // all good
    if (document.getElementById('_sess_warn')) return;

    const b = document.createElement('div');
    b.id = '_sess_warn';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;padding:9px 14px;' +
      'background:#b45309;color:#fff;font-size:12px;font-weight:700;text-align:center;cursor:pointer';
    b.textContent = '⚠ Session expired — tap to sign in again, or records will not load';
    b.onclick = () => { window.location.href = 'audit_index.html'; };
    document.body.appendChild(b);

    /* It is position:fixed with nothing making room for it, so it sat on top
       of the header — covering the sign-in route on the very page telling you
       to sign in. Push the page down by however tall it actually is; it wraps
       to two lines on a narrow phone, so measure rather than assume. */
    const makeRoom = () => { document.body.style.paddingTop = b.offsetHeight + 'px'; };
    makeRoom();
    window.addEventListener('resize', makeRoom);
  } catch (e) {}
}
document.addEventListener('DOMContentLoaded', warnIfSessionLapsed);

function isAuditAdmin() {
  try {
    // The portal's own answer, when the page has the shared layer loaded.
    if (typeof MJMAccess !== 'undefined' && MJMAccess.isAdminOf) {
      if (MJMAccess.isAdminOf('audit')) return true;
    }
    const u = JSON.parse(localStorage.getItem('mjm_user') || '{}');

    // Same permissions blob the portal uses, cached at login so this still
    // works with no signal.
    const mod = u.permissions && u.permissions.modules && u.permissions.modules.audit;
    if (mod === 'admin') return true;

    // Fallback for accounts that predate permissions: audit_role wins over
    // role, matching how audit_home.html picks a role.
    const role = (u.audit_role || u.role || '').toLowerCase();
    return role === 'admin' || role === 'administrator';
  } catch (e) { return false; }
}

async function sbFetch(path, options = {}) {
  const url = `${SUPA_URL}/rest/v1/${path}`;
  const token = await accessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${token || SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const sb = {
  async select(table, query = '') {
    try {
      return await sbFetch(`${table}?${query}&order=created_at.desc`);
    } catch (e) {
      /* Some audit tables were made by hand and have no created_at. PostgREST
         rejects the whole read with a 400 on the order clause, which reaches
         the screen as an empty list — indistinguishable from "no records".
         Read it unordered instead. */
      if (/created_at/.test(e.message) && /42703|does not exist/i.test(e.message)) {
        console.warn('[sb] no created_at on', table, '— reading unordered');
        return await sbFetch(`${table}?${query}`);
      }
      throw e;
    }
  },
  async insert(table, data) {
    return sbFetch(table, { method: 'POST', body: JSON.stringify(data), prefer: 'return=representation' });
  },
  async update(table, id, data) {
    return sbFetch(`${table}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=representation' });
  },
  async delete(table, id) {
    return sbFetch(`${table}?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
  },
  async uploadPhoto(bucket, filename, base64dataUrl) {
    if (!base64dataUrl || !base64dataUrl.startsWith('data:')) return base64dataUrl;
    const [meta, data] = base64dataUrl.split(',');
    const mime = meta.match(/:(.*?);/)[1];
    const binary = atob(data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const ext  = mime.split('/')[1] || 'jpg';
    const path = `${filename}_${Date.now()}.${ext}`;
    const token = await accessToken();   // storage policies are per-role too
    const res = await fetch(`${SUPA_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${token || SUPA_KEY}`, 'Content-Type': mime, 'x-upsert': 'true' },
      body: blob
    });
    if (!res.ok) {
      /* Returning null here meant the reason died in the console: a missing
         audit-photos bucket and a storage policy refusing the write looked
         identical to the caller. Keep returning null so existing callers
         behave, but record why so the toast can say it. */
      const body = await res.text();
      console.error('Photo upload failed', res.status, body);
      sb.lastPhotoError = 'Photo upload failed ' + res.status + ': ' + body.slice(0, 120);
      return null;
    }
    sb.lastPhotoError = null;
    return `${SUPA_URL}/storage/v1/object/public/${bucket}/${path}`;
  }
};