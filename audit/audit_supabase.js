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
    if (!res.ok) { console.error('Photo upload failed', await res.text()); return null; }
    return `${SUPA_URL}/storage/v1/object/public/${bucket}/${path}`;
  }
};