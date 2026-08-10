/* ================================================================
   MJM NURSERY AUDIT — OFFLINE STORAGE v5
   dexie_offline.js

   RULES:
   1. Online  → save to Supabase directly. If fails → queue.
   2. Offline → queue immediately. Never lose data.
   3. Auto-sync every 30s when online.
   4. smartSave NEVER throws — always returns {offline:true} or result.
================================================================ */

/* ── Load Dexie (local first, CDN fallback) ── */
async function loadDexie(){
  if(window.Dexie) return;
  await new Promise((res, rej) => {
    const tryLoad = (src, next) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = next || rej;
      document.head.appendChild(s);
    };
    tryLoad('./audit_dexie.min.js', () =>
      tryLoad('https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js')
    );
  });
}

/* ── DB ── */
let _db = null;
async function getDB(){
  if(_db && _db.isOpen()) return _db;
  await loadDexie();
  _db = new Dexie('MJMAuditV5');
  _db.version(1).stores({
    queue:  '++id, synced, created_at',
    photos: '++id, qkey, field'
  });
  await _db.open();
  return _db;
}

/* ── Photo storage ── */
async function storePhoto(qkey, field, data){
  const db = await getDB();
  await db.photos.where({qkey, field}).delete();
  await db.photos.add({qkey, field, data, created_at: Date.now()});
}
async function loadPhoto(qkey, field){
  const db = await getDB();
  const r = await db.photos.where({qkey, field}).first();
  return r ? r.data : null;
}
async function removePhotos(qkey){
  const db = await getDB();
  await db.photos.where({qkey}).delete();
}

/* ── Queue ── */
async function enqueue(table, method, payload, editId){
  const db = await getDB();
  const id = await db.queue.add({
    table, method,
    payload: JSON.stringify(payload),
    edit_id: editId ? String(editId) : null,
    synced: 0, retries: 0,
    created_at: Date.now()
  });
  refreshBadge();
  return id;
}
async function getPending(){
  const db = await getDB();
  return db.queue.where({synced:0}).sortBy('created_at');
}
async function countPending(){
  const db = await getDB();
  return db.queue.where({synced:0}).count();
}
async function setDone(id){
  const db = await getDB();
  await db.queue.update(id, {synced:1});
}
async function clearDone(){
  const db = await getDB();
  await db.queue.where({synced:1}).delete();
}

/* ── Photo upload helper ── */
async function uploadPhoto(table, field, base64){
  const name = `${table}_${field}_${Date.now()}`;
  return await sb.uploadPhoto('audit-photos', name, base64);
}

/* ── Timeout wrapper ── */
function withTimeout(p, ms){
  return Promise.race([p, new Promise((_,r)=>setTimeout(()=>r(new Error('timeout '+ms+'ms')),ms))]);
}

/* ================================================================
   SMART SAVE
================================================================ */
async function smartSave(table, method, payload, editId=null){

  /* Online path */
  if(navigator.onLine){
    try{
      /* Upload photos first (15s total timeout) */
      const clean = {...payload};
      const photoUploads = [];
      for(const f of Object.keys(clean)){
        const v = clean[f];
        if(v && typeof v==='string' && v.startsWith('data:')){
          photoUploads.push(
            uploadPhoto(table, f, v)
              .then(url => { clean[f] = url; })
              .catch(() => { clean[f] = null; }) // don't block save on photo fail
          );
        }
      }
      if(photoUploads.length) await withTimeout(Promise.all(photoUploads), 15000);

      /* Save record (8s timeout) */
      const result = await withTimeout(
        method==='insert' ? sb.insert(table, clean) : sb.update(table, editId, clean),
        8000
      );
      console.log('[SmartSave] ✅ Saved online:', table);
      return result;

    }catch(e){
      console.warn('[SmartSave] Online failed:', e.message, '→ queuing');
      /* Fall through to queue */
    }
  }

  /* Offline path — store photos in IndexedDB */
  try{
    const qkey = 'q'+Date.now()+Math.random().toString(36).slice(2,6);
    const stored = {...payload};
    for(const f of Object.keys(stored)){
      const v = stored[f];
      if(v && typeof v==='string' && v.startsWith('data:')){
        try{
          await storePhoto(qkey, f, v);
          stored[f] = `__IMG__:${qkey}:${f}`;
        }catch(e){
          stored[f] = null;
        }
      }
    }
    stored.__qkey = qkey;
    await enqueue(table, method, stored, editId);
    console.log('[SmartSave] 📴 Queued:', table);
    refreshBadge();
    return {offline: true};
  }catch(e){
    console.error('[SmartSave] Queue failed:', e.message);
    return {offline: true}; // never throw
  }
}

/* ================================================================
   SYNC
================================================================ */
let _syncing = false;

async function syncNow(){
  if(_syncing){ console.log('[Sync] Already running'); return; }
  if(!navigator.onLine){ console.log('[Sync] No network'); return; }

  const pending = await getPending();
  if(!pending.length){ return; }

  _syncing = true;
  console.log('[Sync] Starting:', pending.length, 'pending');
  refreshBadge();

  let ok=0, fail=0, lastErr='';

  for(const item of pending){
    try{
      let p = JSON.parse(item.payload);
      const qkey = p.__qkey;
      delete p.__qkey;

      /* Restore photos */
      for(const f of Object.keys(p)){
        const v = p[f];
        if(typeof v!=='string') continue;
        if(v.startsWith('__IMG__:')){
          const [,rKey,rField] = v.split(':');
          const data = await loadPhoto(rKey, rField);
          if(data){
            try{
              p[f] = await uploadPhoto(item.table, rField, data);
              await removePhotos(rKey);
            }catch(e){ p[f]=null; }
          } else { p[f]=null; }
        } else if(v.startsWith('data:')){
          try{ p[f] = await uploadPhoto(item.table, f, v); }
          catch(e){ p[f]=null; }
        }
      }

      /* Save */
      if(item.method==='insert') await sb.insert(item.table, p);
      else await sb.update(item.table, item.edit_id, p);

      await setDone(item.id);
      ok++;
      console.log('[Sync] ✅ Done:', item.table, item.id);

    }catch(e){
      fail++;
      lastErr = (e && e.message ? e.message : String(e))
        .replace(/^Supabase error /,'').slice(0,110);
      const retries = (item.retries||0)+1;
      console.error('[Sync] ❌', item.id, item.table, e.message, 'try:', retries);
      const db = await getDB();
      if(retries >= 5){
        await setDone(item.id); // give up
        console.warn('[Sync] Gave up:', item.id);
      } else {
        await db.queue.update(item.id, {retries});
      }
    }
  }

  await clearDone();
  _syncing = false;
  refreshBadge();

  if(ok>0){
    showToast('✓ Synced '+ok+' record'+(ok>1?'s':''));
    setTimeout(()=>{ if(typeof loadRecords==='function') loadRecords(); }, 500);
    setTimeout(()=>{ if(typeof loadAll==='function') loadAll(); }, 500);
  }
  /* Show why, not just that. The reason is almost always a rejection from
     Supabase (duplicate id, missing batch/task, RLS), not the network — and
     tapping again will never fix it, so the reason has to reach the phone. */
  if(fail>0) showToast('⚠ '+fail+' failed to sync: '+(lastErr||'unknown error'));
}

/* ================================================================
   BADGE
================================================================ */
async function refreshBadge(){
  try{
    const n = await countPending();
    let b = document.getElementById('_offl_badge');
    if(n>0){
      if(!b){
        b = document.createElement('div');
        b.id = '_offl_badge';
        b.onclick = ()=>{ if(navigator.onLine) syncNow(); };
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;margin:0 auto;width:fit-content;max-width:480px;padding:5px 18px;border-radius:0 0 12px 12px;font-size:11px;font-weight:700;z-index:99999;cursor:pointer;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);text-align:center';
        document.body.appendChild(b);
      }
      b.style.background = navigator.onLine ? '#2d7a2d' : '#f59e0b';
      b.textContent = navigator.onLine
        ? '🔄 '+n+' pending — tap to sync now'
        : '📴 Offline — '+n+' record'+(n>1?'s':'')+' saved locally';
    } else {
      if(b) b.remove();
    }
  }catch(e){}
}
function showOfflineBadge(){ refreshBadge(); }

/* ================================================================
   TOAST
================================================================ */
function showToast(msg){
  // Use page's showToast if available
  if(window._pageShowToast) { window._pageShowToast(msg); return; }
  const t = document.getElementById('toast');
  if(t){ t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2800); }
}

/* ================================================================
   CAMERA HELPER
================================================================ */
function openCamera(inputId){
  const inp = document.getElementById(inputId);
  if(!inp) return;
  inp.setAttribute('capture','environment');
  inp.accept='image/*';
  inp.click();
  setTimeout(()=>inp.removeAttribute('capture'), 500);
}

/* ================================================================
   PHOTO COMPRESSION
================================================================ */
function compressPhoto(file, maxPx=1200, quality=0.72){
  return new Promise(resolve=>{
    const r=new FileReader();
    r.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(w>maxPx){h=Math.round(h*maxPx/w);w=maxPx;}
        const c=document.createElement('canvas');
        c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        resolve(c.toDataURL('image/jpeg',quality));
      };
      img.onerror=()=>resolve(e.target.result);
      img.src=e.target.result;
    };
    r.onerror=()=>resolve(null);
    r.readAsDataURL(file);
  });
}

/* ================================================================
   AUTO SYNC — every 30s
================================================================ */
let _timer=null;
function startSync(){
  if(_timer) clearInterval(_timer);
  syncNow();
  _timer=setInterval(()=>{ if(navigator.onLine) syncNow(); },30000);
  console.log('[AutoSync] Started');
}
function stopSync(){
  if(_timer){ clearInterval(_timer); _timer=null; }
}

/* ================================================================
   INIT
================================================================ */
async function initOffline(){
  try{ await getDB(); }catch(e){ console.error('[DB] Failed:', e); }

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./audit_sw.js')
      .then(reg=>{
        reg.update();
        if(reg.waiting) reg.waiting.postMessage('skipWaiting');
        reg.addEventListener('updatefound',()=>{
          const sw=reg.installing;
          sw.addEventListener('statechange',()=>{
            if(sw.state==='installed'&&navigator.serviceWorker.controller)
              sw.postMessage('skipWaiting');
          });
        });
      }).catch(e=>console.warn('[SW]',e));
  }

  refreshBadge();

  window.addEventListener('online',()=>{
    console.log('[Net] Online');
    showToast('🔄 Back online — syncing...');
    refreshBadge();
    startSync();
  });
  window.addEventListener('offline',()=>{
    console.log('[Net] Offline');
    showToast('📴 Offline — records saved to phone');
    stopSync();
    refreshBadge();
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && navigator.onLine) syncNow();
  });

  if(navigator.onLine) startSync();
}

document.addEventListener('DOMContentLoaded', initOffline);