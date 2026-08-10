/* ================================================================
   MJM NURSERY — SUPABASE SHARED CONFIG
   supabase.js
   ================================================================ */

const SUPA_URL = 'https://kibqjztozokohqmhqqqf.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';

/* ================================================================
   WHO MAY DELETE

   Deleting an audit record is admin-only. This lives here, once, because
   every audit page loads this file — four copies of the same rule is how
   plot ended up with no gate at all while papan had one.

   This only decides what the screen offers. It is trivially bypassable
   from the console, so the real gate is the RLS delete policy on the
   audit_* tables (shared/migration_audit_admin_delete.sql). Keep both.
================================================================ */
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
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
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
    return sbFetch(`${table}?${query}&order=created_at.desc`);
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
    const res = await fetch(`${SUPA_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': mime, 'x-upsert': 'true' },
      body: blob
    });
    if (!res.ok) { console.error('Photo upload failed', await res.text()); return null; }
    return `${SUPA_URL}/storage/v1/object/public/${bucket}/${path}`;
  }
};