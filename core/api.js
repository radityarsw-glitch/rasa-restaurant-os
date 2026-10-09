/* ============================================================
   RASA Restaurant OS — inti frontend: registry, API client, sesi
   File ini dimuat PERTAMA kali, sebelum app.js.
   Modul lain mendaftarkan halaman/nav/aksi lewat window.RASA,
   lalu app.js menggabungkannya saat boot.
   ============================================================ */

window.RASA = window.RASA || {
  pages: {},        /* nama halaman -> function renderer */
  pageNames: {},    /* nama halaman -> label breadcrumb */
  nav: [],          /* item navigasi tambahan */
  actions: {},      /* data-action -> handler(arg) */
  dashboards: {},   /* role -> function renderer dashboard */
  searchSources: [],/* fungsi(q) -> hasil global search */
  alertSources: [], /* fungsi() -> daftar alert */
  boot: [],         /* dipanggil sekali setelah aplikasi siap */
  render: [],       /* dipanggil setiap halaman di-render */
  roles: ['owner', 'manager', 'kasir', 'kitchen', 'waiter']
};

const SESSION_KEY = 'restaurant-os:session';

/* ---------- Sesi login (token disimpan aman di perangkat) ---------- */
window.RasaSession = {
  token: (function () { try { return localStorage.getItem(SESSION_KEY) || '' } catch (e) { return '' } })(),
  user: null,
  restaurant: null,
  permissions: null,
  roles: [],
  guest: false,
  ready: false,
  set(token) {
    this.token = token || '';
    try { token ? localStorage.setItem(SESSION_KEY, token) : localStorage.removeItem(SESSION_KEY) } catch (e) {}
  },
  clear() {
    this.set(''); this.user = null; this.restaurant = null; this.permissions = null; this.ready = false;
    try { localStorage.removeItem(SESSION_KEY) } catch (e) {}
  }
};

/* ---------- Izin berbasis role (dicek juga di backend) ---------- */
window.canPerm = function (module, action) {
  const s = window.RasaSession;
  if (!s.user) return true;                 /* mode lokal tanpa akun: fitur tetap jalan */
  if (!s.permissions) return false;
  if (module === 'misc') return true;
  const list = s.permissions[module];
  if (!Array.isArray(list)) return false;
  return list.indexOf(action || 'read') >= 0;
};

/* ---------- Basis API ----------
   Semua endpoint ditulis relatif ('/api/…'). Di origin yang sama
   (Cloudflare Workers, wrangler dev, server lokal) cukup relatif.
   Saat frontend di-host di tempat lain — mis. GitHub Pages
   (https://<user>.github.io/rasa-restaurant-os/) — path relatif itu
   menunjuk ke github.io yang statis dan berujung 404, jadi diarahkan
   ke backend Cloudflare Worker (CORS 'access-control-allow-origin: *'
   + preflight OPTIONS sudah disiapkan di server/worker.js).
   Cara menimpa: set window.RASA_API_BASE = 'https://…' SEBELUM file ini
   dimuat (mis. lewat skrip config sendiri). */
window.RasaAPIBase = (function () {
  if (window.RASA_API_BASE) return String(window.RASA_API_BASE).replace(/\/+$/, '');
  let host = '';
  try { host = String(location.hostname || '').toLowerCase(); } catch (e) {}
  const sameOrigin = !host                                  /* file:// */
    || host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
    || /\.workers\.dev$/.test(host)                         /* deploy Cloudflare */
    || /\.pages\.dev$/.test(host);
  return sameOrigin ? '' : 'https://rasa-restaurant-os.rasa-os.workers.dev';
})();

/* ---------- Klien API ---------- */
window.RasaAPI = {
  async call(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    const tok = window.RasaSession.token;
    if (tok) headers['authorization'] = 'Bearer ' + tok;
    const url = (window.RasaAPIBase || '') + path;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined || body === null ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      const err = new Error('Tidak bisa terhubung ke server. Periksa koneksi internet Anda.');
      err.code = 'network'; throw err;
    }
    let data = null;
    try { data = await res.json() } catch (e) { data = null }
    if (res.status === 401 && data && data.code === 'unauthenticated') {
      window.RasaSession.clear();
    }
    if (res.status === 403) {
      /* server menolak karena izin → minta frontend menyegarkan permission */
      try { window.dispatchEvent(new Event('rasa:denied')) } catch (e) {}
    }
    if (!res.ok || (data && data.ok === false)) {
      const err = new Error((data && data.error) || ('Gagal (' + res.status + ')'));
      err.status = res.status; err.code = (data && data.code) || '';
      err.payload = data; throw err;
    }
    return data;
  },
  get(path) { return this.call('GET', path) },
  post(path, body) { return this.call('POST', path, body || {}) },
  put(path, body) { return this.call('PUT', path, body || {}) },
  del(path) { return this.call('DELETE', path) }
};
