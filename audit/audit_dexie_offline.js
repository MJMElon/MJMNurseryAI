/* BUILD: 2026-08-18f */
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
/* Queued and still worth retrying. Blocked rows are excluded so a
   permanently-refused record does not make every sync report a failure
   forever — but it stays in the table, and stays in the badge. */
async function getPending(){
  const db = await getDB();
  const rows = await db.queue.where({synced:0}).sortBy('created_at');
  return rows.filter(r => !r.blocked);
}
async function countPending(){
  return (await getPending()).length;
}

/* Parked: the server refused these and will keep refusing until
   something is fixed on its side. */
async function getBlocked(){
  const db = await getDB();
  const rows = await db.queue.where({synced:0}).sortBy('created_at');
  return rows.filter(r => r.blocked);
}
async function countBlocked(){
  return (await getBlocked()).length;
}

/* Un-park everything and try again — what to call once the RLS policy
   or the missing profile has been sorted out. */
async function retryBlocked(){
  const db = await getDB();
  const rows = await getBlocked();
  for(const r of rows){
    await db.queue.update(r.id, {blocked:0, retries:0, last_error:null});
  }
  console.log('[Sync] Un-parked', rows.length, 'record(s)');
  refreshBadge();
  if(rows.length && navigator.onLine) await syncNow();
  return rows.length;
}
window.retryBlocked = retryBlocked;
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
   ERROR READING

   sb throws `Supabase error 403: {"code":"42501","details":null,...}`.
   The toast used to print the first 110 characters of that, which on a
   phone is the status and the opening brace — the table name and the
   reason are past the cut. A whole afternoon can go by looking at
   "1 failed to sync: 403: {"code":"42501","details":null,"hint":null".

   So: pull the code out of the JSON and say what it means in words.
   The raw body still goes to the console for anyone who wants it.
================================================================ */
function parseSbError(e){
  const raw = (e && e.message ? e.message : String(e));
  const m   = raw.match(/^Supabase error (\d+):\s*([\s\S]*)$/);
  const out = { status: m ? Number(m[1]) : 0, code:'', message:'', raw };
  if(!m) return out;
  try{
    const body = JSON.parse(m[2]);
    out.code    = body.code    || '';
    out.message = body.message || '';
    out.hint    = body.hint    || '';
  }catch(err){
    out.message = m[2].slice(0, 200);
  }
  return out;
}

/* True when retrying is pointless — the server has made a decision that
   another attempt will not change. These must never be discarded: the
   record is still good, it is the permission or the linked row that is
   wrong, and both are fixable without the auditor re-keying anything. */
function isPermanentError(p){
  return p.code === '42501'        // RLS refused the row
      || p.code === '23503'        // referenced row missing
      || p.status === 401
      || p.status === 403;
}

/* Plain-language reason, short enough to survive a toast. */
function describeSbError(e){
  const p = parseSbError(e);

  if(p.code === '42501' || p.status === 403){
    // Recover the table name the truncated toast used to hide.
    const t = (p.message.match(/table "([^"]+)"/) || [])[1];
    return 'Not allowed to save' + (t ? ' to ' + t : '') +
           '. Your login lacks database permission (RLS) — ask an admin; '
         + 'the record is kept on this phone.';
  }
  if(p.status === 401 || /JWT|token/i.test(p.message)){
    return 'Login expired. Sign in again — the record is kept on this phone.';
  }
  if(/photo upload rejected/i.test(p.raw)){
    // sb records the storage reason; without it this is just "failed".
    const why = (typeof sb !== 'undefined' && sb.lastPhotoError) || '';
    return 'Photo did not upload'
         + (/not found|404/i.test(why) ? ' — the audit-photos bucket is missing' : '')
         + (/403|row-level|policy/i.test(why) ? ' — storage permission refused it' : '')
         + '. The record and photo are kept on this phone.';
  }
  if(p.code === '23505') return 'Already saved (duplicate record).';
  if(p.code === '23503') return 'A linked record (batch or task) is missing.';
  if(/timeout/i.test(p.raw)) return 'Server did not answer in time — will retry.';

  return (p.message || p.raw).slice(0, 140);
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
          /* A failed upload used to become clean[f] = null and the record
             saved anyway — photo-less, silently, on a form that marks the
             photo required. Fail the online save instead: the catch below
             queues it, the photo is kept in IndexedDB, and the sync retries
             it. Slower, but the photo survives. */
          photoUploads.push(
            uploadPhoto(table, f, v).then(url => {
              if(!url) throw new Error('photo upload rejected for '+f);
              clean[f] = url;
            })
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
            /* removePhotos() used to run whether or not the upload worked,
               because uploadPhoto returns null on failure rather than
               throwing — so a rejected upload deleted the only copy of the
               photo. Delete the local one only once it is safely uploaded,
               and let a failure abort the item so it retries with the photo
               still in hand. */
            const url = await uploadPhoto(item.table, rField, data);
            if(!url) throw new Error('photo upload rejected for '+rField);
            p[f] = url;
            await removePhotos(rKey);
          } else { p[f]=null; }
        } else if(v.startsWith('data:')){
          const url = await uploadPhoto(item.table, f, v);
          if(!url) throw new Error('photo upload rejected for '+f);
          p[f] = url;
        }
      }

      /* Save */
      if(item.method==='insert') await sb.insert(item.table, p);
      else await sb.update(item.table, item.edit_id, p);

      await setDone(item.id);
      ok++;
      console.log('[Sync] ✅ Done:', item.table, item.id);

    }catch(e){
      const p = parseSbError(e);

      /* A duplicate key means the row reached the table on an earlier
         attempt and only the acknowledgement was lost. It is saved.
         Counting that as a failure leaves a record in the queue that can
         never succeed, so retire it quietly. */
      if(p.code === '23505'){
        await setDone(item.id);
        ok++;
        console.log('[Sync] ✅ Already present:', item.table, item.id);
        continue;
      }

      fail++;
      lastErr  = describeSbError(e);
      const retries = (item.retries||0)+1;
      console.error('[Sync] ❌', item.id, item.table, 'try:', retries, p.raw);
      const db = await getDB();

      /* "Gave up" used to mean setDone(), and setDone() is followed by
         clearDone(), which DELETES. So a record the server kept
         refusing was erased after five tries — with auto-sync at 30s,
         about two and a half minutes from the first failure, silently.
         A permanently-refused record is exactly the one worth keeping:
         fix the permission and it still needs to go up.

         Park it instead. Blocked rows stop being retried, stay in the
         queue, and show in the badge until they sync or are dropped
         on purpose. */
      if(isPermanentError(p)){
        await db.queue.update(item.id, {
          retries, blocked: 1, last_error: lastErr, blocked_at: Date.now()
        });
        console.warn('[Sync] Parked (needs a fix server-side):', item.id, item.table);
      } else if(retries >= 5){
        await db.queue.update(item.id, {
          retries, blocked: 1, last_error: lastErr, blocked_at: Date.now()
        });
        console.warn('[Sync] Parked after 5 tries:', item.id, item.table);
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
  if(fail>0) showToast('⚠ '+fail+' failed to sync — '+(lastErr||'unknown error'), 7000);
}

/* ================================================================
   BADGE
================================================================ */
async function refreshBadge(){
  try{
    const n       = await countPending();
    const blocked = await countBlocked();
    let b = document.getElementById('_offl_badge');
    if(n>0 || blocked>0){
      if(!b){
        b = document.createElement('div');
        b.id = '_offl_badge';
        b.onclick = async ()=>{
          if(!navigator.onLine) return;
          // Tapping a parked record is a deliberate "try that again".
          if(await countBlocked()) await retryBlocked();
          else await syncNow();
        };
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;margin:0 auto;width:fit-content;max-width:480px;padding:5px 18px;border-radius:0 0 12px 12px;font-size:11px;font-weight:700;z-index:99999;cursor:pointer;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);text-align:center';
        document.body.appendChild(b);
      }
      if(blocked>0 && n===0){
        // Nothing is going to happen on its own — say so, and say the reason.
        const why = (await getBlocked())[0];
        b.style.background = '#b91c1c';
        b.textContent = '⚠ '+blocked+' record'+(blocked>1?'s':'')+' stuck — '
                      + (why && why.last_error ? why.last_error : 'tap to retry');
      } else {
        b.style.background = navigator.onLine ? '#2d7a2d' : '#f59e0b';
        b.textContent = navigator.onLine
          ? '🔄 '+n+' pending — tap to sync now'
            + (blocked ? ' ('+blocked+' stuck)' : '')
          : '📴 Offline — '+n+' record'+(n>1?'s':'')+' saved locally';
      }
    } else {
      if(b) b.remove();
    }
  }catch(e){}
}
function showOfflineBadge(){ refreshBadge(); }

/* ================================================================
   TOAST
================================================================ */
/* ms is generous for failures: a reason worth printing is a reason worth
   leaving on screen long enough to read, and these run two lines now. */
function showToast(msg, ms){
  // Use page's showToast if available
  if(window._pageShowToast) { window._pageShowToast(msg, ms); return; }
  const t = document.getElementById('toast');
  if(t){ t.textContent=msg; t.classList.add('show');
         clearTimeout(t._hide);
         t._hide = setTimeout(()=>t.classList.remove('show'), ms || 2800); }
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