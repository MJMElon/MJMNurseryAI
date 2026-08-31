/* BUILD: 2026-08-31a */
/* ================================================================
   MJM NURSERY AUDIT — OFFLINE RE-LOGIN VAULT

   Replaces mjm_cached_creds, which kept the person's EMAIL AND PASSWORD IN
   PLAINTEXT in localStorage so the login page could check them offline.
   Anyone holding the phone could read that password out of devtools.

   Now the phone keeps a copy of the signed-in state SEALED UNDER THE
   PASSWORD ITSELF: PBKDF2 (SHA-256, 310,000 rounds) derives an AES-GCM key
   and only ciphertext is stored, one entry per email. Nothing readable is
   kept — without the password the entry is noise, and a wrong password does
   not "almost" open it, GCM authenticates and it simply fails.

   The sealed payload carries the mjm_user object AND the Supabase session
   token, which the plaintext version never restored — so after an offline
   re-login, the Dexie queue can actually sync once the line returns instead
   of being refused by RLS until somebody signs in online again.

   Same rules, bundled per app, in Barcode_Counter and Mobile —
   src/lib/offlineVault.js in each. Change one, change the others.
================================================================ */
(function (global) {

  var VKEY = 'mjm_offline_vault_v1';

  function norm(email) { return String(email || '').trim().toLowerCase(); }

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(VKEY)) || {}; } catch (e) { return {}; }
  }
  function saveAll(v) {
    try { localStorage.setItem(VKEY, JSON.stringify(v)); } catch (e) {}
  }

  function b64(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  function keyFor(password, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 310000, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
      });
  }

  /* Seal `payload` under this person's password. Resolves false rather than
     throwing when WebCrypto is unavailable — the phone then simply cannot
     re-login offline, which is where it started. */
  function seal(email, password, payload) {
    try {
      if (!norm(email) || !password || !payload) return Promise.resolve(false);
      if (typeof crypto === 'undefined' || !crypto.subtle) return Promise.resolve(false);
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return keyFor(password, salt).then(function (key) {
        return crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: iv },
          key,
          new TextEncoder().encode(JSON.stringify(payload))
        );
      }).then(function (ct) {
        var all = loadAll();
        all[norm(email)] = { salt: b64(salt), iv: b64(iv), ct: b64(ct), at: Date.now() };
        saveAll(all);
        return true;
      }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  /* The sealed payload back, or null — wrong password, no entry, no
     WebCrypto. has() answers the "is there anything here" half. */
  function open(email, password) {
    try {
      var e = loadAll()[norm(email)];
      if (!e || typeof crypto === 'undefined' || !crypto.subtle) return Promise.resolve(null);
      return keyFor(password, unb64(e.salt)).then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) }, key, unb64(e.ct));
      }).then(function (pt) {
        return JSON.parse(new TextDecoder().decode(pt));
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function has(email) { return !!loadAll()[norm(email)]; }

  /* The plaintext keys the vault replaces. Called on every load of the login
     page and after every online login, so no phone keeps a readable password
     around once it has picked this build up. */
  function dropPlaintext() {
    try {
      localStorage.removeItem('mjm_cached_creds');
      localStorage.removeItem('mjm_cached_user');
    } catch (e) {}
  }

  global.MJMOfflineVault = { seal: seal, open: open, has: has, dropPlaintext: dropPlaintext };
})(window);
