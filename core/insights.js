/* ============================================================
   RASA Restaurant OS — Blok F: Alert Center, pencarian global,
   dan halaman Audit log.
   - Alert dibangun dari data tersinkron (stok, menu, reservasi,
     pesanan) + sumber ekstra lewat window.RASA.alertSources
   - Pencarian global memakai window.RASA.searchSources
   - Audit log membaca backend /api/audit (immutable, per sesi role)
   Dimuat SEBELUM app.js agar terdaftar di registry RASA.pages.
   ============================================================ */

window.RasaInsights = (function () {
  const $ = id => document.getElementById(id);
  const LOCAL_KEY = 'restaurant-os:alerts';   /* status baca: lokal per perangkat */

  const PAGE_OF_MODULE = {
    inventory: 'inventory', menu: 'menu', orders: 'orders', kitchen: 'kitchen',
    reservations: 'reservations', staff: 'settings', settings: 'settings',
    finance: 'finance', accounting: 'finance', procurement: 'procurement',
    reports: 'reports', recipes: 'recipes', alerts: 'alerts', audit: 'audit',
    permissions: 'settings', overview: 'overview'
  };

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const data = raw ? JSON.parse(raw) : null;
      return data && typeof data === 'object'
        ? { seen: Array.isArray(data.seen) ? data.seen.slice(-300) : [], lastCount: Number(data.lastCount) || 0 }
        : { seen: [], lastCount: 0 };
    } catch (e) { return { seen: [], lastCount: 0 }; }
  }
  function saveLocal(d) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function store0() {
    /* store adalah binding lexical milik app.js — aman dipanggil setelah boot */
    try { return typeof store !== 'undefined' ? store : null } catch (e) { return null }
  }

  /* ---------- sumber alert bawaan ---------- */
  function builtinAlerts() {
    const s = store0();
    if (!s) return [];
    const out = [];
    (s.inventory || []).forEach(x => {
      const st = Number(x.stock) || 0, min = Number(x.min) || 0;
      if (st > min) return;
      out.push({
        id: 'stock-' + x.id, level: st <= 0 ? 'danger' : 'warn',
        module: 'inventory', title: st <= 0 ? (x.name + ' habis') : (x.name + ' menipis'),
        detail: 'Sisa ' + (Math.round(st * 100) / 100) + ' ' + (x.unit || '') + ' · batas minimum ' + (Math.round(min * 100) / 100) + ' ' + (x.unit || '') + '. Buat purchase order sebelum kehabisan.',
        actionLabel: 'Kelola persediaan'
      });
    });
    (s.products || []).forEach(p => {
      if (p.available !== false && (Number(p.stock) || 0) > 0) return;
      out.push({
        id: 'soldout-' + p.id, level: 'warn', module: 'menu',
        title: (p.name || 'Produk') + ' tidak tersedia',
        detail: 'Stok habis atau dinonaktifkan — pelanggan tidak bisa memesan menu ini.',
        actionLabel: 'Buka menu'
      });
    });
    const lowMenu = (s.products || []).filter(p => p.available !== false && (Number(p.stock) || 0) > 0 && (Number(p.stock) || 0) <= 5);
    lowMenu.forEach(p => out.push({
      id: 'menulow-' + p.id, level: 'info', module: 'menu',
      title: 'Stok ' + p.name + ' tinggal ' + (Number(p.stock) || 0),
      detail: 'Segera tambah stok porsi agar menu tidak kehabisan di jam sibuk.',
      actionLabel: 'Buka menu'
    }));
    const pending = (typeof orders !== 'undefined' ? orders : []).filter(o => o.cls === 'preparing');
    if (pending.length) out.push({
      id: 'kds-' + pending.length, level: 'info', module: 'kitchen',
      title: pending.length + ' pesanan sedang dimasak',
      detail: 'Antrean dapur perlu diselesaikan agar tamu tidak menunggu lama.',
      actionLabel: 'Buka Kitchen Display'
    });
    const ready = (typeof orders !== 'undefined' ? orders : []).filter(o => o.cls === 'ready');
    if (ready.length) out.push({
      id: 'serve-' + ready.length, level: 'info', module: 'orders', page: 'pelayan',
      title: ready.length + ' pesanan siap diantar',
      detail: 'Menunggu Acc pelayan untuk diantar ke meja tamu — buka workspace Pelayan.',
      actionLabel: 'Buka workspace Pelayan'
    });
    const onWay = (typeof orders !== 'undefined' ? orders : []).filter(o => o.cls === 'delivering');
    if (onWay.length) out.push({
      id: 'deliver-' + onWay.length, level: 'info', module: 'orders', page: 'pelayan',
      title: onWay.length + ' pesanan sedang diantar',
      detail: 'Pelayan sedang membawa pesanan ke meja — tandai "Sampai di meja" setelah tersaji.',
      actionLabel: 'Buka workspace Pelayan'
    });
    const today = new Date();
    const iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const waiting = (s.reservations || []).filter(r => r.date === iso && r.status !== 'ready' && r.status !== 'cancelled');
    if (waiting.length) out.push({
      id: 'res-wait-' + waiting.length, level: 'warn', module: 'reservations',
      title: waiting.length + ' reservasi menunggu konfirmasi DP',
      detail: 'Reservasi hari ini belum dikonfirmasi — hubungi tamu atau acc DP.',
      actionLabel: 'Buka reservasi'
    });

    /* reservasi yang jam kedatangannya sudah dekat — prioritas persiapan */
    if (typeof countdownOf === 'function' && typeof fmtDate === 'function') {
      (s.reservations || []).forEach(r => {
        if (r.status === 'cancelled') return;
        const cd = countdownOf(r);
        if (!cd || cd.past || cd.ms > 2 * 3600000) return;
        out.push({
          id: 'res-soon-' + r.id, level: cd.ms <= 30 * 60000 ? 'danger' : 'warn', module: 'reservations',
          title: (r.name || 'Tamu') + ' · tiba ' + cd.label,
          detail: fmtDate(r.date) + ' pukul ' + (r.time || '') + ' · Meja ' + (r.table || '—') + ' · ' + (r.guests || 1) + ' orang. Siapkan meja dan menunya sekarang.',
          actionLabel: 'Buka reservasi'
        });
      });
    }

    /* sumber tambahan dari modul lain */
    (window.RASA.alertSources || []).forEach(fn => {
      try {
        const extra = fn() || [];
        extra.forEach(a => { if (a && a.id && a.title) out.push(a) });
      } catch (e) { console.log('alert-source-failed', String(e && e.message)); }
    });
    return out;
  }

  function activeAlerts() {
    const local = loadLocal();
    return builtinAlerts().filter(a => local.seen.indexOf(a.id) < 0);
  }
  function allAlerts() { return builtinAlerts(); }
  function dismiss(id) {
    const local = loadLocal();
    if (local.seen.indexOf(String(id)) < 0) local.seen.push(String(id));
    saveLocal(local);
  }
  function clearDismissed() { saveLocal({ seen: [], lastCount: 0 }); }

  function levelMeta(level) {
    if (level === 'danger') return { icon: '✕', cls: 'cancelled', label: 'Kritis' };
    if (level === 'warn') return { icon: '!', cls: 'pending', label: 'Perhatian' };
    return { icon: 'i', cls: 'preparing', label: 'Info' };
  }

  /* ---------- halaman Alert Center ---------- */
  function alertsPage() {
    const all = allAlerts();
    const active = activeAlerts();
    const danger = active.filter(a => a.level === 'danger').length;
    const warn = active.filter(a => a.level === 'warn').length;
    const cards = active.length ? active.map(a => {
      const m = levelMeta(a.level);
      const page = a.page || PAGE_OF_MODULE[a.module] || 'overview';
      return `<div class="alert-card lvl-${a.level}">
        <span class="alert-icon ${m.cls}">${m.icon}</span>
        <div class="alert-body"><b>${esc(a.title)}</b><small>${esc(a.detail)}</small></div>
        <div class="alert-actions">
          <button class="btn btn-ghost" data-page="${page}">${esc(a.actionLabel || 'Buka')} →</button>
          <button class="link-btn" data-action="alert-dismiss:${esc(String(a.id))}">Tandai dibaca</button>
        </div></div>`;
    }).join('') : `<div class="empty-state">Tidak ada peringatan aktif — semua berjalan lancar. ✔ Peringatan muncul otomatis saat stok menipis, menu habis, atau ada pesanan yang tertunda.</div>`;
    return `${heading('Alert Center','Peringatan operasional otomatis dari data restoran — stok, menu, dapur, dan reservasi.',
      (all.length && active.length ? '<button class="btn" data-action="alert-readall">Tandai semua dibaca</button>' : '') + (all.length && !active.length ? '<button class="btn" data-action="alert-reset">Tampilkan ulang peringatan</button>' : ''))}
    <div class="stats-grid">
      ${stat('Peringatan aktif',String(active.length),'dari '+all.length+' total peringatan','🔔',active.length?'perlu tindakan':'semua aman')}
      ${stat('Kritis',String(danger),'stok habis / masalah serius','✕',danger?'segera tangani':'tidak ada')}
      ${stat('Perhatian',String(warn),'stok menipis / menunggu','!',warn?'pantau':'tidak ada')}
      ${stat('Sumber data','Otomatis','stok · menu · dapur · reservasi','↻','disegarkan tiap render')}
    </div>
    <div class="panel"><div class="panel-head"><div><div class="panel-title">Peringatan berjalan</div>
    <div class="panel-caption">Diurutkan dari yang paling mendesak</div></div></div>
    <div class="alert-list">${cards}</div></div>
    ${all.length && !active.length ? `<div class="panel"><div class="empty-state">Semua peringatan sudah ditandai dibaca. Klik <b>Tampilkan ulang</b> bila perlu melihatnya lagi.</div></div>` : ''}`;
  }

  /* ---------- halaman Audit log ---------- */
  function auditRows(rows) {
    if (!rows || !rows.length) return '<tr><td colspan="6" class="empty-state">Belum ada aktivitas tercatat.</td></tr>';
    return rows.map(r => {
      let detail = '';
      try { detail = typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail || {}); } catch (e) { detail = ''; }
      if (detail.length > 140) detail = detail.slice(0, 137) + '…';
      const when = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
      const lvl = /denied|invalid/i.test(String(r.action || '')) ? 'pending' : (/logout|delete|suspend/i.test(String(r.action || '')) ? 'preparing' : 'ready');
      return `<tr><td>${esc(when)}</td><td class="account"><b>${esc(r.action || '')}</b><span class="subcell">${esc(r.entity || '')}</span></td>
        <td class="method">${esc(detail)}</td><td>${esc(r.user_name || r.user_id || '—')}</td>
        <td>${esc(r.role || '')} ${r.device ? '<span class="subcell">' + esc(r.device) + '</span>' : ''}</td>
        <td><span class="status ${lvl}">${lvl === 'pending' ? 'Ditolak' : lvl === 'preparing' ? 'Sensitif' : 'Tercatat'}</span></td></tr>`;
    }).join('');
  }
  function auditPage() {
    const s = window.RasaSession;
    if (!s.user) {
      return `${heading('Audit log','Riwayat aktivitas immutable di server.')}
      <div class="panel"><div class="empty-state">Masuk dengan akun restoran untuk melihat audit log. Log disimpan di server dan tidak bisa diubah dari sisi klien.</div></div>`;
    }
    if (!window.canPerm('audit', 'read')) {
      return `${heading('Audit log','Riwayat aktivitas immutable di server.')}
      <div class="panel"><div class="empty-state">Role <b>${esc(s.user.role)}</b> tidak memiliki izin membaca audit log. Hubungi owner bila Anda membutuhkannya.</div></div>`;
    }
    return `${heading('Audit log','Setiap login, perubahan data, dan penolakan permission tercatat permanen di server.',
      '<button class="btn" data-action="audit-refresh">↻ Segarkan</button>')}
    <div class="stats-grid">
      ${stat('Sesi aktif','1 per perangkat','token 30 hari bergulir','◉',esc(s.user.role))}
      ${stat('Restoran',esc((s.restaurant && s.restaurant.name) || store0() && store0().restaurantName || '—'),'ID ' + esc((s.restaurant && s.restaurant.id) || '—'),'⌂','')}
      ${stat('Sifat log','Immutable','tidak bisa dihapus dari UI','⛨','server-side')}
      ${stat('Rentang','Terbaru 100','urut dari yang terbaru','▤','')}
    </div>
    <div class="panel"><div class="panel-head"><div><div class="panel-title">Aktivitas terbaru</div>
    <div class="panel-caption">Sumber: tabel <code>audit_logs</code> di D1</div></div></div>
    <div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Aksi / entitas</th><th>Detail</th><th>Pengguna</th><th>Role &amp; perangkat</th><th>Status</th></tr></thead>
    <tbody id="auditBody"><tr><td colspan="6" class="empty-state">Memuat audit log…</td></tr></tbody></table></div></div>`;
  }
  async function loadAudit() {
    const body = $('auditBody');
    if (!body) return;
    try {
      const res = await window.RasaAPI.get('/api/audit?limit=100');
      const rows = res.items || res.rows || [];
      body.innerHTML = auditRows(rows);
      if (!rows.length) body.innerHTML = '<tr><td colspan="6" class="empty-state">Belum ada aktivitas tercatat.</td></tr>';
    } catch (e) {
      body.innerHTML = '<tr><td colspan="6" class="empty-state">Gagal memuat audit log: ' + esc(e.message) + '</td></tr>';
    }
  }

  /* ---------- pencarian global ---------- */
  function searchAll(q) {
    const query = String(q || '').trim().toLowerCase();
    const out = [];
    if (!query) return out;
    const push = (title, sub, page) => { if (title) out.push({ title: String(title), sub: String(sub || ''), page: page || '' }); };

    /* halaman (pageNames global milik app.js + registry modul) */
    let names = {};
    try { names = Object.assign({}, (typeof pageNames !== 'undefined' ? pageNames : {}), window.RASA.pageNames || {}) } catch (e) { names = Object.assign({}, window.RASA.pageNames || {}) }
    Object.keys(names).forEach(p => {
      const label = names[p];
      if (label && label.toLowerCase().indexOf(query) >= 0 && window.canPerm(window.RasaRoles ? window.RasaRoles.moduleOf(p) : p, 'read')) {
        push(label, 'Halaman', p);
      }
    });
    const s = store0();
    if (s) {
      (s.products || []).forEach(p => { if ((p.name || '').toLowerCase().indexOf(query) >= 0) push(p.name, 'Menu · ' + (p.cat || '') + ' · ' + money(p.price || 0), 'menu'); });
      (s.inventory || []).forEach(x => { if ((x.name || '').toLowerCase().indexOf(query) >= 0) push(x.name, 'Persediaan · sisa ' + (Math.round((Number(x.stock) || 0) * 100) / 100) + ' ' + (x.unit || ''), 'inventory'); });
      (s.reservations || []).forEach(r => {
        const hay = String(r.name || '') + ' ' + String(r.table || '');
        if (hay.toLowerCase().indexOf(query) >= 0) push(r.name, 'Reservasi · meja ' + r.table + ' · ' + (r.date || ''), 'reservations');
      });
    }
    (typeof orders !== 'undefined' ? orders : []).forEach(o => {
      const hay = String(o.id || '') + ' ' + String(o.guest || '');
      if (hay.toLowerCase().indexOf(query) >= 0) push(o.id + ' · ' + (o.guest || ''), 'Pesanan · ' + (o.status || '') + ' · ' + (o.total || ''), 'orders');
    });
    const staff = window.RasaRoles && window.RasaRoles.state.staff;
    (staff || []).forEach(u => { if ((u.name || '').toLowerCase().indexOf(query) >= 0 || (u.email || '').toLowerCase().indexOf(query) >= 0) push(u.name, 'Staf · ' + u.role + ' · ' + u.email, 'settings'); });

    (window.RASA.searchSources || []).forEach(fn => {
      try {
        const extra = fn(query) || [];
        extra.forEach(r => { if (r && r.title) out.push(r) });
      } catch (e) { console.log('search-source-failed', String(e && e.message)); }
    });
    return out.slice(0, 30);
  }
  function renderSearchResults() {
    const q = $('gsInput') ? $('gsInput').value : '';
    const box = $('gsResults');
    if (!box) return;
    const res = searchAll(q);
    if (!String(q).trim()) {
      box.innerHTML = '<div class="gs-hint">Ketik untuk mencari menu, pesanan, reservasi, staf, atau halaman. Tekan <b>Esc</b> untuk menutup.</div>';
      return;
    }
    if (!res.length) {
      box.innerHTML = '<div class="gs-hint">Tidak ada hasil untuk “' + esc(q) + '”.</div>';
      return;
    }
    box.innerHTML = res.map(r => `<button class="gs-item" data-page="${esc(r.page || 'overview')}">
      <b>${esc(r.title)}</b><small>${esc(r.sub)}</small></button>`).join('');
  }
  function openSearch() {
    window.openModal(`<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">⌕</span><div><b>Pencarian global</b><small>Cari apa saja — menu, pesanan, tamu, staf, halaman</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <label class="field"><span>Kata kunci</span><input class="input" id="gsInput" placeholder="Contoh: kopi, #RS-2841, Nadia, keuangan…" autocomplete="off"></label>
    <div class="gs-results" id="gsResults"></div>`);
    renderSearchResults();
    const el = $('gsInput');
    if (el) {
      el.addEventListener('input', renderSearchResults);
      setTimeout(() => el.focus(), 40);
    }
  }

  /* ---------- lonceng notifikasi ---------- */
  function updateBell() {
    const bell = document.querySelector('.top-actions .notification');
    if (!bell) return;
    const n = activeAlerts().length;
    bell.classList.toggle('has-alerts', n > 0);
    let badge = bell.querySelector('i');
    if (badge) {
      badge.textContent = n > 0 ? String(Math.min(9, n)) : '';
      badge.style.display = n > 0 ? '' : 'none';
    }
  }

  /* ---------- pemberitahuan di pojok atas ----------
     Kartu baru muncul di kanan atas; sekali diklik langsung menuju
     halaman tujuan peringatan tersebut (dan ditandai sudah dibaca). */
  const NOTIFIED_KEY = 'restaurant-os:notified';
  let notifSeen = null;      /* id yang sudah pernah dipunculkan */
  let notifReady = false;
  let stackEl = null;
  let panelEl = null;
  let panelOpen = false;

  function notifiedList() {
    if (notifReady) return notifSeen;
    notifReady = true;
    notifSeen = null;
    try {
      const raw = localStorage.getItem(NOTIFIED_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr)) notifSeen = arr.map(String);
    } catch (e) { notifSeen = null; }
    return notifSeen;      /* null = baru pertama kali jalan -> jadikan baseline */
  }
  function saveNotified(list) {
    notifSeen = list.map(String).slice(-300);
    try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notifSeen)); } catch (e) {}
  }

  function ensureUi() {
    if (!stackEl || !document.body.contains(stackEl)) {
      stackEl = document.createElement('div');
      stackEl.className = 'notif-stack';
      stackEl.id = 'notifStack';
      stackEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(stackEl);
    }
    if (!panelEl || !document.body.contains(panelEl)) {
      panelEl = document.createElement('div');
      panelEl.className = 'notif-panel';
      panelEl.id = 'notifPanel';
      panelEl.hidden = true;
      document.body.appendChild(panelEl);
    }
  }

  const pageOf = a => a.page || PAGE_OF_MODULE[a.module] || 'overview';

  function showNotif(a) {
    ensureUi();
    const card = document.createElement('div');
    card.className = 'notif-card lvl-' + (a.level || 'info');
    card.setAttribute('data-notif', String(a.id));
    card.setAttribute('data-page', pageOf(a));
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.title = 'Klik untuk membuka ' + (a.actionLabel || 'peringatan ini');
    const m = levelMeta(a.level);
    card.innerHTML =
      '<span class="notif-icon ' + m.cls + '">' + m.icon + '</span>' +
      '<span class="notif-body"><b>' + esc(a.title) + '</b><small>' + esc(a.detail) + '</small>' +
      '<i class="notif-cta">' + esc(a.actionLabel || 'Buka') + ' →</i></span>' +
      '<button type="button" class="notif-x" data-notif-x="' + esc(String(a.id)) + '" aria-label="Tutup notifikasi">×</button>';
    stackEl.appendChild(card);
    requestAnimationFrame(() => card.classList.add('in'));

    let timer = setTimeout(removeCard.bind(null, String(a.id)), 8000);
    card.addEventListener('mouseenter', () => clearTimeout(timer));
    card.addEventListener('mouseleave', () => { clearTimeout(timer); timer = setTimeout(removeCard.bind(null, String(a.id)), 3000); });
    while (stackEl.children.length > 4) stackEl.removeChild(stackEl.firstElementChild);
  }

  function removeCard(id) {
    ensureUi();
    const el = stackEl.querySelector('[data-notif="' + String(id).replace(/"/g, '') + '"]');
    if (!el) return;
    el.classList.add('out');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
  }

  function syncNotifications() {
    const gate = document.getElementById('authGate');
    if (gate && !gate.hidden) return;              /* jangan spam di layar masuk */
    const active = activeAlerts();
    const seen = notifiedList();
    if (!seen) { saveNotified(active.map(a => String(a.id))); return; }  /* baseline saat pertama kali */
    const fresh = active.filter(a => seen.indexOf(String(a.id)) < 0);
    if (!fresh.length) return;
    const next = seen.slice();
    fresh.slice(0, 3).forEach(a => { next.push(String(a.id)); showNotif(a); });
    fresh.slice(3).forEach(a => next.push(String(a.id)));   /* sisanya dicatat, tidak menumpuk */
    saveNotified(next);
    updateBell();
  }

  /* ---------- panel lonceng (daftar pemberitahuan) ---------- */
  function panelHtml() {
    const active = activeAlerts();
    const all = allAlerts();
    const rows = active.length ? active.slice(0, 8).map(a => {
      const m = levelMeta(a.level);
      return '<button type="button" class="notif-row lvl-' + a.level + '" data-notif="' + esc(String(a.id)) + '" data-page="' + pageOf(a) + '">' +
        '<span class="notif-icon ' + m.cls + '">' + m.icon + '</span>' +
        '<span class="notif-body"><b>' + esc(a.title) + '</b><small>' + esc(a.detail) + '</small></span>' +
        '</button>';
    }).join('') : '<div class="gs-hint">Tidak ada pemberitahuan baru — semua berjalan lancar. ✔</div>';
    return '<div class="notif-panel-head"><b>🔔 Pemberitahuan</b><span>' + active.length + ' aktif</span></div>' +
      '<div class="notif-rows">' + rows + '</div>' +
      '<div class="notif-panel-foot"><button type="button" class="btn btn-primary btn-block" data-page="alerts">Buka Alert Center</button>' +
      (all.length && !active.length ? '<button type="button" class="link-btn" data-action="alert-reset">Tampilkan ulang peringatan</button>' : '') +
      '</div>';
  }
  function openPanel() {
    ensureUi();
    panelEl.innerHTML = panelHtml();
    panelEl.hidden = false;
    panelOpen = true;
    document.addEventListener('click', outsidePanel, true);
  }
  function closePanel() {
    if (!panelEl) return;
    panelEl.hidden = true;
    panelOpen = false;
    document.removeEventListener('click', outsidePanel, true);
  }
  function outsidePanel(e) {
    if (!panelOpen || !panelEl) return;
    if (panelEl.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.icon-btn.notification')) return;
    closePanel();
  }

  function afterRender(page) {
    updateBell();
    if (page === 'audit') loadAudit();
    if (page === 'alerts') updateBell();
    setTimeout(syncNotifications, 400);
  }

  /* ---------- aksi ---------- */
  const actions = {
    'alert-dismiss': id => { dismiss(id); window.render('alerts'); toast('Peringatan ditandai dibaca.'); },
    'alert-readall': () => {
      allAlerts().forEach(a => dismiss(a.id));
      window.render('alerts'); toast('Semua peringatan ditandai dibaca.');
    },
    'alert-reset': () => { clearDismissed(); window.render('alerts'); toast('Peringatan ditampilkan kembali.'); },
    'audit-refresh': () => { window.render('audit'); toast('Audit log disegarkan.'); },
    'global-search': () => openSearch(),
    'open-alerts': () => { panelOpen ? closePanel() : openPanel(); }
  };

  function init() {
    const R = window.RASA;
    R.pages = R.pages || {};
    R.pages.alerts = alertsPage;
    R.pages.audit = auditPage;
    R.pageNames = R.pageNames || {};
    R.pageNames.alerts = 'Alert Center';
    R.pageNames.audit = 'Audit log';
    R.nav = R.nav || [];
    R.nav.push({ page: 'alerts', label: 'Alert Center', icon: '🔔' });
    R.nav.push({ page: 'audit', label: 'Audit log', icon: '⛨' });
    Object.keys(actions).forEach(k => { R.actions[k] = actions[k] });
    R.render = R.render || [];
    R.render.push(afterRender);

    /* klik pemberitahuan: tutup kartunya, tandai dibaca, lalu ikuti
       data-page-nya (ditangani listener app.js) menuju halaman tujuan */
    document.addEventListener('click', e => {
      if (!e.target || !e.target.closest) return;
      const x = e.target.closest('[data-notif-x]');
      if (x) {
        e.stopPropagation();
        const id = String(x.getAttribute('data-notif-x') || '');
        dismiss(id); removeCard(id); closePanel(); updateBell();
        toast('Pemberitahuan ditutup.');
        return;
      }
      const n = e.target.closest('[data-notif]');
      if (n) {
        const id = String(n.getAttribute('data-notif') || '');
        dismiss(id); removeCard(id); closePanel(); updateBell();
      }
    }, true);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closePanel(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest &&
          e.target.closest('.notif-card[role="button"]')) {
        e.preventDefault();
        e.target.click();
      }
    });

    /* pemeriksaan berkala: peringatan baru langsung muncul di pojok atas */
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      syncNotifications();
      updateBell();
    }, 30000);

    /* hasil pencarian: tutup modal sebelum pindah halaman */
    document.addEventListener('click', e => {
      const item = e.target.closest ? e.target.closest('.gs-item') : null;
      if (item && window.closeModal) window.closeModal();
    }, true);

    /* pintasan papan ketik: Ctrl/Cmd+K atau / */
    document.addEventListener('keydown', e => {
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault(); openSearch(); return;
      }
      if (e.key === '/' && !typing) {
        const gate = document.getElementById('authGate');
        if (gate && !gate.hidden) return;
        e.preventDefault(); openSearch();
      }
    });
  }

  return { init, alertsPage, auditPage, activeAlerts, allAlerts, searchAll, openSearch, loadAudit, syncNotifications, updateBell };
})();

window.RasaInsights.init();
