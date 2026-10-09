/* ============================================================
   RASA Restaurant OS — sinkronisasi workspace dengan server
   Satu blob JSON per restoran (tabel `workspace`). Strategi:
   - snapshot terakhir disimpan lokal (restaurant-os:snapshot:<id-restoran>)
     sehingga SATU perangkat bisa berganti akun tanpa data saling bocor
   - PUSH: key yang berbeda dari snapshot dikirim sebagai `changed`
   - PULL: perubahan server diterapkan HANYA pada key yang tidak
     diubah secara lokal (three-way per key) — pekerjaan yang belum
     terkirim tidak pernah hilang diam-diam
   - SINKRONISASI PERTAMA (perangkat baru / akun baru): data server
     (milik email yang sama) yang menang, supaya data restoran benar-benar
     mengikuti email — bukan data contoh di perangkat baru
   - Backend tetap penentu akhir: key tanpa izin update dikembalikan
     ke versi server dan dilaporkan sebagai `denied`.
   ============================================================ */

window.RasaSync = (function () {
  const SNAP_PREFIX = 'restaurant-os:snapshot';
  const LEGACY_SNAP = 'restaurant-os:snapshot';   /* kunci lama (satu untuk semua akun) */
  const OWNER_KEY = 'restaurant-os:store-owner';  /* akun terakhir yang menulis data lokal */
  const SYNC_KEYS = [
    'restaurantName', 'restaurantLocation', 'brandName', 'ownerName', 'ownerRole',
    'avatar', 'lat', 'lng', 'accounts', 'theme', 'isOpen',
    'orders', 'archive', 'products', 'reservations',
    'inventory', 'recipes', 'stockLog', 'accounting'
  ];

  let snap = { rev: 0, payload: {}, init: false };
  let enabled = false;
  let suspend = false;     /* true saat menerapkan data server (jangan push) */
  let busy = false;
  let queued = false;
  let timer = null;
  let pullTimer = null;
  let lastError = '';

  /* ---------- identitas akun: snapshot & penanda pemilik per restoran ---------- */
  function accountId() {
    const s = window.RasaSession || {};
    if (s.user && s.user.restaurantId) return String(s.user.restaurantId);
    if (s.restaurant && s.restaurant.id) return String(s.restaurant.id);
    return '';
  }
  function snapKey() { return SNAP_PREFIX + ':' + (accountId() || 'local'); }
  function ownerOf() { try { return localStorage.getItem(OWNER_KEY) || ''; } catch (e) { return ''; } }
  function setOwner(v) { try { localStorage.setItem(OWNER_KEY, v); } catch (e) {} }
  /* Dipanggil app.js setiap kali data disimpan: menandai data lokal milik siapa.
     Data lama milik email LAIN tidak akan terbawa ke email berikutnya. */
  function markOwner() {
    try {
      const tok = window.RasaSession && window.RasaSession.token;
      if (tok) { const a = accountId(); if (a) setOwner(a); }
      else if (!ownerOf()) setOwner('local');   /* mode lokal: hanya sekali */
    } catch (e) {}
  }
  /* perangkat ini terakhir dipakai akun lain (bukan mode lokal) ? */
  function foreignOwner() {
    const owner = ownerOf(), acct = accountId();
    if (!owner || owner === 'local' || !acct) return false;
    return owner !== acct;
  }

  function loadSnap() {
    try { localStorage.removeItem(LEGACY_SNAP); } catch (e) {}
    try {
      const raw = localStorage.getItem(snapKey());
      const data = raw ? JSON.parse(raw) : null;
      snap = data && typeof data === 'object'
        ? { rev: data.rev || 0, payload: data.payload || {}, init: true }
        : { rev: 0, payload: {}, init: false };
    } catch (e) { snap = { rev: 0, payload: {}, init: false }; }
  }
  function saveSnap() {
    try { localStorage.setItem(snapKey(), JSON.stringify(snap)); } catch (e) {}
  }

  function appReady() { return !!(window.RASA && window.RASA.appReady); }
  function localPayload() {
    const out = {};
    if (!appReady()) return out;
    SYNC_KEYS.forEach(k => { if (k in store) out[k] = store[k]; });
    return out;
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function diffKeys(base, next) {
    const keys = [];
    SYNC_KEYS.forEach(k => {
      const inBase = k in base, inNext = k in next;
      if (inBase !== inNext) { keys.push(k); return; }
      if (inBase && !same(base[k], next[k])) keys.push(k);
    });
    return keys;
  }

  /* ---------- menerapkan payload server ke store lokal ---------- */
  /* ---------- pembuangan key (wewenang dicabut) ----------
     Key dibuang dari data lokal DAN dari snapshot supaya tidak ikut
     terdorong lagi ke server (server tetap menyimpan datanya untuk
     pemilik izin). Bila wewenang dikembalikan, pull berikutnya
     mengembalikan datanya otomatis. */
  function dropKeys(keys) {
    if (!Array.isArray(keys) || !keys.length) return false;
    let any = false;
    keys.forEach(k => {
      if (typeof store !== 'undefined' && store && k in store) { delete store[k]; any = true }
      if (snap.payload && k in snap.payload) { delete snap.payload[k]; any = true }
      /* global yang menunjuk key tersebut ikut dikosongkan — kalau tidak,
         salinan lama masih tampil di halaman (mis. tabel pesanan di Ringkasan)
         walaupun store sudah dibersihkan */
      try {
        if ((k === 'orders' || k === 'archive') && typeof orders !== 'undefined' && Array.isArray(orders)) orders.length = 0;
        if (k === 'products' && typeof products !== 'undefined' && Array.isArray(products)) products.length = 0;
      } catch (e) {}
    });
    if (!any) return false;
    try { if (appReady()) saveStore() } catch (e) {}
    try { saveSnap() } catch (e) {}
    return true;
  }

  function applyStore() {
    saveStore();
    store = loadStore();
    orders = store.orders;
    products = store.products;
    cart = store.cart || {};
    applyIdentity();
    render(currentPage, true);
  }

  /* Sinkronisasi PERTAMA akun ini di perangkat ini (belum pernah ada snapshot).
     Aturan: data server — milik email yang sedang masuk — yang menang, supaya
     data restoran benar-benar mengikuti email. Bila perangkat ini terakhir
     dipakai email lain, data lama dibersihkan dulu agar tidak ikut terbawa. */
  function adoptFirstSync(payload) {
    const keys = Object.keys(payload || {});
    const foreign = foreignOwner();
    let adopted = 0;

    suspend = true;
    try {
      if (foreign) {
        /* ganti akun di perangkat yang sama: buang sisa data email sebelumnya */
        try { if (typeof freshStore === 'function') store = freshStore(); } catch (e) {}
        try { localStorage.removeItem('restaurant-os:guest'); } catch (e) {}
      }
      keys.forEach(k => {
        if (SYNC_KEYS.indexOf(k) < 0) return;
        if (!same(store[k], payload[k])) { store[k] = payload[k]; adopted++; }
      });
      applyStore();
    } catch (e) {
      console.log('sync-adopt-failed', String(e && e.message));
    } finally {
      suspend = false;
    }

    if (adopted > 0) {
      const mail = (window.RasaSession && window.RasaSession.user && window.RasaSession.user.email) || 'akun Anda';
      toast('Data restoran dimuat dari ' + mail + '.');
      status('Data akun dimuat', 'ok');
    } else if (foreign) {
      status('Akun baru di perangkat ini', 'ok');
    }
    markOwner();
  }

  function applyFromServer(payload, firstTime) {
    if (!appReady()) return;
    if (firstTime) { adoptFirstSync(payload || {}); return; }
    const local = localPayload();
    const localChanged = diffKeys(snap.payload, local);   /* key yang belum terkirim */
    let adopted = 0, keptLocal = 0;

    suspend = true;
    try {
      SYNC_KEYS.forEach(k => {
        if (!(k in payload)) return;
        if (localChanged.indexOf(k) >= 0 && !same(snap.payload[k], payload[k])) {
          keptLocal++;   /* dua sisi berubah → perubahan lokal yang disimpan, akan menimpa saat push */
          return;
        }
        if (!same(store[k], payload[k])) { store[k] = payload[k]; adopted++; }
      });
      applyStore();
    } catch (e) {
      console.log('sync-apply-failed', String(e && e.message));
    } finally {
      suspend = false;
    }
    if (keptLocal > 0) status('Perubahan lokal disinkronkan ulang…');
    else if (adopted > 0) status('Data server dimuat');
  }

  /* ---------- indikator status ---------- */
  function status(text, kind) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = 'sync-pill' + (kind ? ' ' + kind : '');
  }

  /* ---------- PULL ---------- */
  async function pull() {
    if (!enabled || !window.RasaSession.token) return null;
    try {
      const res = await window.RasaAPI.get('/api/data');
      window.RasaSession.permissions = res.permissions || window.RasaSession.permissions;
      if (res.user) window.RasaSession.user = Object.assign(window.RasaSession.user || {}, res.user);
      const first = !snap.init;   /* pertama kali akun ini masuk di perangkat ini */
      applyFromServer(res.payload || {}, first);
      snap = { rev: res.rev || 0, payload: res.payload || {}, init: true };
      saveSnap();
      markOwner();
      lastError = '';
      status(first ? 'Tersinkron dengan akun' : 'Tersinkron · rev ' + snap.rev, 'ok');
      return res;
    } catch (e) {
      handleErr(e, 'Gagal memuat data server.');
      return null;
    }
  }

  /* ---------- PUSH ---------- */
  async function push() {
    if (!enabled || suspend) return;
    if (!window.RasaSession.token) return;
    if (busy) { queued = true; return; }
    if (!appReady()) return;
    const local = localPayload();
    /* Hanya key yang boleh ditulis role ini yang dikirim — menghindari
       penolakan server yang tidak perlu (toast "ditolak" tiap sinkron).
       Server tetap memeriksa ulang untuk setiap key. Modul 'antar' (Antar
       Ke Meja) ikut menulis key pesanan, jadi ikut diperbolehkan di sini. */
    const changed = diffKeys(snap.payload, local).filter(k => {
      if (!window.RasaKeyModule || !window.canPerm) return true;
      const m = window.RasaKeyModule(k);
      if (m === 'misc') return true;
      if (window.canPerm(m, 'update')) return true;
      return m === 'orders' && window.canPerm('antar', 'update');
    });
    if (!changed.length) return;

    busy = true;
    status('Menyinkronkan…', 'busy');
    try {
      const res = await window.RasaAPI.put('/api/data', {
        payload: local,
        changed: changed,
        baseRev: snap.rev
      });
      snap = { rev: res.rev || snap.rev, payload: res.payload || {} };
      saveSnap();
      /* terapkan salinan kanonik server (mis. key yang ditolak dikembalikan) */
      const denied = res.denied || [];
      const invalid = res.invalid || [];
      if (invalid.length) {
        toast('Data tidak valid ditolak server: ' + invalid.map(x => x.key + ' (' + (x.reason || 'tidak valid') + ')').join(', '));
      }
      if (denied.length) {
        const mods = denied.map(d => d.module).filter((v, i, a) => a.indexOf(v) === i);
        toast('Perubahan pada ' + mods.join(', ') + ' ditolak — tidak sesuai izin role Anda.');
        const localNow = localPayload();
        suspend = true;
        try {
          denied.forEach(d => {
            if (d.key in (res.payload || {})) store[d.key] = res.payload[d.key];
            else if (d.key in snap.payload) store[d.key] = snap.payload[d.key];
          });
          saveStore();
        } finally { suspend = false; }
        void localNow;
      }
      lastError = '';
      status('Tersinkron · rev ' + snap.rev, 'ok');
      markOwner();
    } catch (e) {
      handleErr(e, 'Gagal menyinkronkan perubahan.');
    } finally {
      busy = false;
      if (queued) { queued = false; setTimeout(push, 300); }
    }
  }

  function handleErr(e, fallback) {
    if (!e) return;
    if (e.status === 401) {
      status('Sesi berakhir — masuk kembali', 'warn');
      window.RasaSession.clear();
      enabled = false;
      if (window.RasaAuth && window.RasaAuth.showGate) window.RasaAuth.showGate('Sesi Anda berakhir. Silakan masuk kembali.');
      return;
    }
    if (e.code === 'network') {
      status('Offline — perubahan disimpan di perangkat', 'warn');
      lastError = 'offline';
      return;
    }
    if (e.message && e.message !== lastError) toast(e.message || fallback);
    lastError = e.message || '';
    status('Sinkronisasi gagal', 'warn');
  }

  /* ---------- penjadwalan ---------- */
  function schedulePush() {
    if (!enabled || suspend) return;
    clearTimeout(timer);
    timer = setTimeout(push, 1500);
  }
  function flush() {
    clearTimeout(timer);
    if (enabled) push();
  }

  /* ---------- awal: setelah login / boot dengan sesi ---------- */
  async function start() {
    loadSnap();
    enabled = !!window.RasaSession.token;
    if (!enabled) { status('', null); return; }
    status('Memuat data…', 'busy');
    const res = await pull();
    if (res) {
      /* migrasi perangkat baru: kirim data lokal yang belum ada di server */
      await push();
      markOwner();
    }
    if (pullTimer) clearInterval(pullTimer);
    pullTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && enabled) pull();
    }, 60000);
  }

  function stop() {
    enabled = false;
    clearTimeout(timer);
    if (pullTimer) { clearInterval(pullTimer); pullTimer = null; }
    status('', null);
  }

  return {
    start, stop, pull, push, flush, schedulePush, status, markOwner, dropKeys,
    get enabled() { return enabled },
    get rev() { return snap.rev },
    setEnabled(v) { enabled = !!v },
    loadSnap
  };
})();

/* dorong perubahan saat tab disembunyikan / ditutup agar tidak ada yang tertinggal */
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('beforeunload', () => { try { window.RasaSync.flush(); } catch (e) {} });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { try { window.RasaSync.flush(); } catch (e) {} }
  });
}
