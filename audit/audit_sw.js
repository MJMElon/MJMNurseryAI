/* ================================================================
   MJM NURSERY AUDIT — SERVICE WORKER v34
   
   Strategy:
   - On install: cache ALL files immediately
   - HTML pages: try network first (get latest), fallback to cache
   - JS/CSS/images: cache first (fast load)
   - Supabase API: network only (never cache)
   - On activate: delete old caches, claim all clients
================================================================ */
const VER = 'mjm-1793030400';

const ALL_FILES = [
  './audit_index.html',
  './audit_login_guard.js',
  './audit_nursery_select.html',
  './audit_home.html',
  './audit_admin.html',
  './audit_plot_audit.html',
  './audit_styles.css',
  './audit_script.js',
  './audit_height_index.html',
  './audit_height_styles.css',
  './audit_height_script.js',
  './audit_papan_index.html',
  './audit_papan_styles.css',
  './audit_papan_script.js',
  './audit_maintenance_index.html',
  './audit_maintenance_styles.css',
  './audit_maintenance_script.js',
  './audit_supabase.js',
  './audit_pending.js',
  './audit_settings.js',
  './audit_deeplink.js',
  './audit_dexie_offline.js',
  './audit_dexie.min.js',
  './audit_lang.js',
  './audit_manifest.json',
  './audit_icon-192.png',
  './audit_icon-512.png',
];

/* ── INSTALL: cache everything ── */
self.addEventListener('install', e => {
  console.log('[SW] Installing', VER);
  self.skipWaiting(); // activate immediately
  /* cache.add() goes through the browser's HTTP cache, and Pages serves
     these assets with a max-age. So a version bump could open a brand new
     cache and fill it with the SAME stale files the old one had — the
     version changes, the code does not, and a deploy looks like it never
     happened. {cache:'reload'} forces the network copy. */
  e.waitUntil(
    caches.open(VER).then(cache =>
      Promise.allSettled(
        ALL_FILES.map(url =>
          fetch(url, { cache: 'reload' })
            .then(res => {
              if (!res || res.status !== 200) throw new Error('HTTP ' + (res && res.status));
              return cache.put(url, res);
            })
            .catch(err => console.warn('[SW] Failed to cache:', url, err.message))
        )
      )
    )
  );
});

/* ── ACTIVATE: clear old caches ── */
self.addEventListener('activate', e => {
  console.log('[SW] Activating', VER);
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== VER).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (!url.startsWith('http')) return;

  /* Supabase — always network, never cache */
  if (url.includes('supabase.co')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  /* Google Fonts — cache first */
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(VER).then(c => c.put(e.request, clone));
          return res;
        }).catch(() => new Response('', { status: 200 }));
      })
    );
    return;
  }

  /* HTML pages — network first, fallback to cache */
  if (url.endsWith('.html') || url.endsWith('/') || 
      e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          /* Cache the fresh copy for offline use */
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(VER).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          /* Offline — serve from cache */
          return caches.match(e.request)
            .then(cached => cached || caches.match('./audit_index.html'));
        })
    );
    return;
  }

  /* JS / CSS / images / fonts — cache first, update in background.
     The background refresh also has to bypass the HTTP cache, or it just
     re-stores the stale copy it was meant to replace and the app stays a
     deploy behind indefinitely. */
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request.url, { cache: 'reload' }).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(VER).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => null);

      return cached || fetchPromise;
    })
  );
});

/* ── Force update ── */
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});