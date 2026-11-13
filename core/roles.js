/* ============================================================
   RASA Restaurant OS — role experience (Blok C)
   - Dashboard khusus per role (owner/manager/kasir/kitchen/waiter)
   - Saring navigasi & jaga halaman sesuai permission
   - Panel Staf (tombol Nonaktifkan / Wewenang / Hapus) di Pengaturan
   Matriks permission per role TIDAK lagi ditampilkan; izin dasar diambil
   dari preset role di server, lalu disesuaikan per staf lewat tombol
   Wewenang. Semua keputusan izin tetap divalidasi backend; file ini hanya
   menyesuaikan pengalaman pengguna agar sesuai role.
   ============================================================ */

window.RasaRoles = (function () {
  const $ = id => document.getElementById(id);

  /* Halaman lama -> modul permission. Halaman baru memakai nama modul.
     Halaman "undangan" (undangan staf milik email sendiri) memakai izin
     overview karena berlaku untuk semua role yang sedang masuk. */
  const PAGE_MODULE = {
    overview: 'overview', orders: 'orders', kitchen: 'kitchen',
    pelayan: 'antar', 'pelayan-meja': 'clear-table',
    reservations: 'reservations', menu: 'menu', inventory: 'inventory',
    procurement: 'procurement', finance: 'finance', reports: 'reports',
    settings: 'settings', undangan: 'overview'
  };

  const MODULE_LABELS = [
    ['overview', 'Ringkasan'], ['pos', 'POS / Kasir'], ['orders', 'Pesanan'],
    ['kitchen', 'Kitchen Display'], ['antar', 'Antar Ke Meja'], ['clear-table', 'Kosongkan Meja'],
    ['tables', 'Meja'], ['reservations', 'Reservasi'],
    ['menu', 'Menu & produk'], ['inventory', 'Persediaan'], ['recipes', 'Resep / BOM'],
    ['procurement', 'Pengadaan'], ['staff', 'Staf'], ['shifts', 'Shift'],
    ['customers', 'Pelanggan'], ['finance', 'Keuangan'], ['accounting', 'Accounting'],
    ['reports', 'Laporan'], ['analytics', 'Analytics'], ['alerts', 'Alert Center'],
    ['audit', 'Audit log'], ['settings', 'Pengaturan'], ['permissions', 'Permission']
  ];
  const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', kasir: 'Kasir', kitchen: 'Kitchen', waiter: 'Waiter' };

  const state = {
    staff: null, matrix: null, staffLoading: false, permLoading: false, formOpen: false,
    userPerms: null,          /* { userId: { modul: [aksi] } } wewenang khusus staf */
    deniedFor: '',            /* halaman terakhir yang ditolak (bukan halaman biasa) */
    requested: 'overview',    /* halaman terakhir yang diminta pengguna */
    ready: false,             /* sesi sudah dipulihkan (izin final diketahui) */
    staffTab: 'active',       /* tab Staf & Role: 'active' | 'inactive' */
    staffQuery: '',           /* pencarian nama / email */
    staffRoleFilter: '',      /* filter role ('' = semua) */
    staffCounts: null         /* jumlah dari server: { active, inactive, total } */
  };

  const moduleOf = page => PAGE_MODULE[page] || page;
  const currentUser = () => (window.RasaSession && window.RasaSession.user) || null;
  const currentRole = () => { const u = currentUser(); return u ? u.role : ''; };
  const isOwner = () => currentRole() === 'owner';

  function can(page, action) { return window.canPerm(moduleOf(page), action || 'read'); }

  /* ---------- Daftar halaman yang dikenal aplikasi ---------- */
  const KNOWN = {};
  try { Object.assign(KNOWN, (typeof renderers !== 'undefined' ? renderers : {})) } catch (e) {}
  Object.assign(KNOWN, (window.RASA && window.RASA.pages) || {});
  const pageLabel = page => {
    const names = {};
    try { Object.assign(names, (typeof pageNames !== 'undefined' ? pageNames : {})) } catch (e) {}
    Object.assign(names, (window.RASA && window.RASA.pageNames) || {});
    return names[page] || (KNOWN[page] ? page : '');
  };
  /* Modul -> key data lokal. Dipakai untuk memetakan key ke modul saat push
     (server tetap penentu akhir) dan untuk menandai modul yang wewenangnya
     dicabut — TIDAK untuk menghapus data: data tetap utuh di perangkat maupun
     di server, yang dicabut hanya aksesnya. */
  const MODULE_KEYS = {
    pos: ['cart'], orders: ['orders', 'archive'], kitchen: ['kitchen'], tables: ['tables'],
    reservations: ['reservations'], menu: ['products'], inventory: ['inventory', 'stockLog'],
    recipes: ['recipes'], procurement: ['suppliers', 'purchaseOrders'], staff: ['staff'],
    shifts: ['shifts'], customers: ['customers'], finance: ['finance'],
    accounting: ['accounting', 'journal', 'ledger'], reports: ['reports'], analytics: ['analytics'],
    alerts: ['alerts'], audit: ['audit'], settings: ['restaurantName', 'restaurantLocation', 'brandName',
      'ownerName', 'ownerRole', 'avatar', 'logo', 'accounts', 'lat', 'lng', 'profile', 'identity', 'outlet', 'outlets',
      'restoAddress', 'restoPhone', 'restoEmail', 'restoWebsite', 'restoSocial',
      'theme', 'isOpen'],
    permissions: ['permissions']
  };
  /* Pemetaan key data -> modul (dipakai sync untuk tidak mengirim key yang
     memang tidak boleh ditulis role ini — server tetap penentu akhir). */
  const KEY_MODULE = {};
  Object.keys(MODULE_KEYS).forEach(m => MODULE_KEYS[m].forEach(k => { KEY_MODULE[k] = m }));
  window.RasaKeyModule = k => KEY_MODULE[k] || 'misc';
  /* Key identitas restoran (logo, nama pemilik & restoran, kontak, tampilan,
     lokasi) — HANYA Owner yang boleh menulis. Dipakai sync.js untuk tidak
     mendorong key ini dari sesi non-owner; server tetap memeriksa ulang. */
  const IDENTITY_KEYS = ['restaurantName', 'restaurantLocation', 'brandName',
    'ownerName', 'ownerRole', 'avatar', 'logo', 'lat', 'lng', 'theme',
    'restaurantId', 'identity', 'profile',
    'restoAddress', 'restoPhone', 'restoEmail', 'restoWebsite', 'restoSocial'];
  window.RasaIdentityKeys = IDENTITY_KEYS;
  const readableModulesOf = perms => Object.keys(perms || {}).filter(m => Array.isArray(perms[m]) && perms[m].indexOf('read') >= 0);

  /* ---------- 1. Saring navigasi ---------- */
  function applyNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      const ok = can(btn.dataset.page, 'read');
      btn.hidden = !ok;
      btn.style.display = ok ? '' : 'none';
    });
    /* item nav tambahan dari modul (window.RASA.nav) */
    (window.RASA.nav || []).forEach(item => {
      const btn = document.querySelector('.nav-item[data-page="' + item.page + '"]');
      if (!btn) return;
      const ok = can(item.page, 'read');
      btn.hidden = !ok;
      btn.style.display = ok ? '' : 'none';
    });
    /* label grup ikut disembunyikan bila semua isinya tidak berhak */
    document.querySelectorAll('.nav-label').forEach(lbl => {
      const list = lbl.nextElementSibling;
      if (!list || !list.classList.contains('nav-list')) return;
      const any = Array.prototype.some.call(list.querySelectorAll('.nav-item[data-page]'), b => !b.hidden);
      lbl.hidden = !any;
      lbl.style.display = any ? '' : 'none';
    });
    /* bilah tab bawah ikut disinkronkan setelah izin berubah — tab aktif
       tidak boleh hilang hanya karena satu tab disembunyikan */
    if (typeof syncTabActive === 'function') syncTabActive();
  }

  function injectNav() {
    const lists = document.querySelectorAll('.nav-list');
    if (!lists.length) return;
    const target = lists[lists.length - 1];
    (window.RASA.nav || []).forEach(item => {
      if (document.querySelector('.nav-item[data-page="' + item.page + '"]')) return;
      const html = '<button class="nav-item" data-page="' + item.page + '"><span>' + (item.icon || '◆') + '</span> ' + item.label + '</button>';
      const settings = target.querySelector('.nav-item[data-page="settings"]');
      if (settings) settings.insertAdjacentHTML('beforebegin', html);
      else target.insertAdjacentHTML('beforeend', html);
    });
    applyNav();
  }

  /* ---------- 2. Dashboard per role ---------- */
  function roleHeading(title, sub) {
    return heading(title, sub, '<button class="btn" data-action="refresh-dash"><span class="btn-icon">↻</span> Segarkan</button>');
  }

  function dashManager() {
    const sales = salesTotal(), live = liveOrders(), g = channelStats();
    const prep = orders.filter(o => o.cls === 'preparing').length;
    const ready = orders.filter(o => o.cls === 'ready').length;
    const low = products.filter(p => (Number(p.stock) || 0) <= 10).length;
    const staffN = state.staff ? state.staff.length : 0;
    return `${roleHeading('Ringkasan Manager', 'Operasional restoran hari ini — pesanan, stok, tim, dan keuangan dalam satu layar.')}
    <div class="stats-grid">
      ${stat('Penjualan hari ini', money(sales), 'dari ' + live.length + ' pesanan', '↗', live.length ? live.length + ' transaksi' : '—')}
      ${stat('Perlu diproses', String(prep), ready + ' siap disajikan', '♨', prep ? 'prioritas dapur' : 'lancar')}
      ${stat('Stok menipis', String(low), 'item menu di bawah batas', '▧', low ? 'perlu restock' : 'aman')}
      ${stat('Tim aktif', String(staffN || '—'), 'akun staf terdaftar', '♟', currentRole() ? 'role ' + ROLE_LABELS[currentRole()] : '')}
    </div>
    <div class="dashboard-grid">${chart()}${channels()}</div>
    <div style="margin-bottom:14px">${orderTable(historyOrders())}</div>
    <div class="bottom-grid">${inventory()}${ledger()}</div>`;
  }

  function dashKasir() {
    const live = liveOrders();
    const paid = orders.filter(o => o.cls === 'paid').length;
    const g = channelStats();
    return `${roleHeading('Ringkasan Kasir', 'Fokus transaksi, pembayaran, dan struk hari ini. Gunakan halaman Menu untuk membuat pesanan baru.')}
    <div class="stats-grid">
      ${stat('Pendapatan hari ini', money(salesTotal()), 'semua channel', '↗', live.length + ' nota')}
      ${stat('Rata-rata struk', money(avgTicket()), 'per transaksi', '◉', live.length ? live.length + ' nota' : '—')}
      ${stat('Sudah dibayar', String(paid), 'transaksi lunas', '✓', orders.length + ' total order')}
      ${stat('Channel', g[0].count + ' QR · ' + g[1].count + ' POS', g[2].count + ' reservasi', '▤', 'sumber pesanan')}
    </div>
    <div class="quick-row">
      <button class="btn btn-primary" data-page="menu">▸ Buka POS / Menu</button>
      <button class="btn" data-page="orders">▤ Pesanan</button>
      <button class="btn" data-page="reservations">▦ Reservasi</button>
    </div>
    <div style="margin-bottom:14px">${orderTable(historyOrders().slice(0, 8))}</div>
    <div class="bottom-grid">${channels()}${ledger()}</div>`;
  }

  function dashKitchen() {
    /* Ringkasan Dapur (halaman overview) — IKHTISAR antrean, bukan papan KDS.
       Papan KDS tetap menjadi halaman tersendiri lewat menu/tab "Dapur".
       Sebelumnya halaman Ringkasan langsung menampilkan kitchenPage(), sehingga
       staf dapur yang membuka Ringkasan (di HP lain pun) justru melihat papan
       KDS — menu Ringkasan terasa "tidak tersambung" dan operasi jadi membingungkan. */
    const incoming = orders.filter(o => o.cls === 'paid').length;
    const prep = orders.filter(o => o.cls === 'preparing').length;
    const ready = orders.filter(o => o.cls === 'ready').length;
    const sched = orders.filter(o => o.cls === 'scheduled').length;
    const queue = orders.filter(o => o.cls === 'scheduled' || o.cls === 'paid' || o.cls === 'preparing');
    const queueRows = queue.length
      ? queue.slice(0, 8).map(o => `<tr><td>${esc(String(o.id))}<span class="subcell">${esc(o.guest || 'Walk-in')}</span></td>
        <td>${esc(o.items || '')}</td><td class="method">${esc(o.type || '')}</td>
        <td><span class="status ${o.cls}">${esc(o.status || '')}</span></td>
        <td>${esc(o.resTime || o.time || '')}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-state">Belum ada antrean dapur — semua pesanan sudah diproses.</td></tr>';
    return `${roleHeading('Ringkasan Dapur', 'Antrean masak, jadwal reservasi, dan pesanan siap disajikan hari ini — buka Kitchen Display untuk memproses tiket satu per satu.')}
    <div class="stats-grid">
      ${stat('Baru masuk', String(incoming), 'menunggu mulai dimasak', '▤', incoming ? 'prioritas segera' : 'antrean kosong')}
      ${stat('Sedang dimasak', String(prep), 'di dapur sekarang', '♨', prep ? prep + ' tiket aktif' : 'lancar')}
      ${stat('Siap disajikan', String(ready), 'menunggu pelayan ambil', '✓', ready ? 'segera diantar' : 'belum ada')}
      ${stat('Terjadwal', String(sched), 'pesanan reservasi', '▦', sched ? 'periksa jadwal' : 'tidak ada')}
    </div>
    <div class="quick-row">
      <button class="btn btn-primary" data-page="kitchen">♨ Buka Kitchen Display</button>
      <button class="btn" data-page="orders">▤ Pesanan</button>
      <button class="btn" data-page="pelayan">▣ Antar ke meja</button>
      <button class="btn" data-action="refresh-dash">↻ Segarkan</button>
    </div>
    <div class="panel orders-panel"><div class="panel-head"><div><div class="panel-title">Antrean dapur</div><div class="panel-caption">Pesanan yang belum selesai diproses · terbaru di atas</div></div><button class="link-btn" data-page="kitchen">Buka KDS →</button></div>
      <div class="table-wrap"><table><thead><tr><th>ID Pesanan</th><th>Item</th><th>Channel</th><th>Status</th><th>Waktu</th></tr></thead><tbody>${queueRows}</tbody></table></div></div>
    ${orderTable(orders)}`;
  }

  function dashWaiter() {
    const list = sortedReservations();
    const ready = orders.filter(o => o.cls === 'ready').length;
    const prep = orders.filter(o => o.cls === 'preparing').length;
    const used = usedTables();
    const resRows = list.length ? list.slice(0, 5).map(r =>
      `<tr><td><b>${esc(r.name || r.guest || 'Tamu')}</b><span class="subcell">${esc(r.phone || '')}</span></td>
       <td>${esc(r.date || '')} ${esc(r.time || '')}</td><td>${esc(r.table || '—')}</td>
       <td>${esc(r.people || 1)} orang</td>
       <td><span class="status ${r.status === 'ready' ? 'ready' : 'preparing'}">${r.status === 'ready' ? 'Terkonfirmasi' : 'Menunggu'}</span></td>
       <td>${r.dp ? '<span class="status paid">DP masuk</span>' : '<span class="status pending">Belum DP</span>'}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty-state">Belum ada reservasi — tambah lewat halaman Reservasi.</td></tr>';
    return `${roleHeading('Ringkasan Waiter', 'Meja, reservasi tamu, dan pesanan yang harus diantar ke meja.')}
    <div class="stats-grid">
      ${stat('Reservasi', String(list.length), 'tersimpan hari ini', '▦', used + ' meja terisi')}
      ${stat('Siap diantar', String(ready), 'menunggu waiter ambil', '✓', ready ? 'segera' : 'lancar')}
      ${stat('Sedang dimasak', String(prep), 'di dapur', '♨', prep + ' antrean')}
      ${stat('Meja terisi', used + ' / 18', 'kapasitas restoran', '◉', Math.round(used / 18 * 100) + '% terisi')}
    </div>
    <div class="quick-row">
      <button class="btn btn-primary" data-action="booking">＋ Reservasi baru</button>
      <button class="btn" data-page="pelayan">▤ Antar ke meja</button>
      <button class="btn" data-page="kitchen">♨ Lihat dapur</button>
      <button class="btn" data-page="orders">▤ Pesanan meja</button>
    </div>
    <div class="panel"><div class="panel-head"><div><div class="panel-title">Reservasi terbaru</div><div class="panel-caption">Prioritas sambut tamu & penempatan meja</div></div><button class="link-btn" data-page="reservations">Semua reservasi →</button></div>
      <div class="table-wrap"><table><thead><tr><th>Tamu</th><th>Jadwal</th><th>Meja</th><th>Orang</th><th>Status</th><th>Pembayaran</th></tr></thead><tbody>${resRows}</tbody></table></div></div>
    ${orderTable(historyOrders().slice(0, 6))}`;
  }

  function defaultDashboards() {
    const d = window.RASA.dashboards = window.RASA.dashboards || {};
    if (!d.manager) d.manager = dashManager;
    if (!d.kasir) d.kasir = dashKasir;
    if (!d.kitchen) d.kitchen = dashKitchen;
    if (!d.waiter) d.waiter = dashWaiter;
  }

  /* ---------- 3. Panel Pengaturan: staf ----------
     Penambahan staf TIDAK dilakukan lewat form manual lagi — owner
     mengundang calon staf lewat email (Gmail) di panel "Undangan staf".
     Panel ini hanya menampilkan daftar staf beserta aksi Nonaktifkan,
     Wewenang, dan Hapus. */
  function staffPanelHtml() {
    const canCreate = window.canPerm('staff', 'create');
    return `
    <div class="panel span-2" id="staffPanel">
      <div class="panel-head"><div><div class="panel-title">Staf &amp; role</div>
      <div class="panel-caption">Kelola akun staf restoran ini · setiap perubahan divalidasi server dan tercatat di <b>audit log</b></div></div>
      <div class="staff-head-actions">
        <button class="btn btn-primary" data-action="staff-add"${canCreate ? '' : ' hidden'}><span class="btn-icon">＋</span> Tambah staf</button>
        <button class="link-btn" data-action="staff-invite-jump">Undang staf lewat email →</button>
      </div></div>
      <div class="staff-tabs" role="tablist" aria-label="Kategori akun">
        <button class="staff-tab is-active" data-staff-tab="active" role="tab" aria-selected="true">Akun Aktif <span class="staff-tab-count" id="staffCountActive">0</span></button>
        <button class="staff-tab" data-staff-tab="inactive" role="tab" aria-selected="false">Akun Nonaktif <span class="staff-tab-count" id="staffCountInactive">0</span></button>
      </div>
      <div class="staff-toolbar">
        <input class="input staff-search" id="staffSearch" type="search" placeholder="Cari nama atau email…" value="${esc(state.staffQuery)}" aria-label="Cari nama atau email staf">
        <select class="input staff-filter" id="staffRoleFilter" aria-label="Filter berdasarkan role">
          <option value="">Semua role</option>
          ${Object.keys(ROLE_LABELS).map(r => `<option value="${r}"${state.staffRoleFilter === r ? ' selected' : ''}>${ROLE_LABELS[r]}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap"><table class="staff-table">
      <thead id="staffHead"></thead>
      <tbody id="staffBody"><tr><td colspan="6" class="empty-state">Memuat daftar staf…</td></tr></tbody></table></div>
      <div class="hint">Staf baru dapat ditambahkan lewat tombol <b>Tambah staf</b> atau diundang lewat email (panel <b>Undangan staf</b>). Menonaktifkan akun <b>menarik seluruh sesi</b> staf tersebut dan memindahkannya ke tab <b>Akun Nonaktif</b> — data operasional tetap utuh. Menghapus permanen hanya tersedia bagi <b>Owner</b>. Setiap perubahan tercatat di <b>audit log</b> dan langsung berlaku.</div>
    </div>`;
  }

  const fmtWhen = ts => (ts ? new Date(ts).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const emptyRow = (cols, html) => '<tr><td colspan="' + cols + '" class="empty-state">' + html + '</td></tr>';
  const staffHeadOf = tab => tab === 'inactive'
    ? '<tr><th>Nama</th><th>Email</th><th>Role terakhir</th><th>Dinonaktifkan</th><th style="text-align:right">Aksi</th></tr>'
    : '<tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Login terakhir</th><th style="text-align:right">Aksi</th></tr>';

  /* Ringkasan wewenang satu staf (override per staf vs matriks role) */
  function staffPermSummary(u) {
    if (!u) return '';
    if (u.role === 'owner') return 'Akses penuh (owner)';
    const ov = state.userPerms && state.userPerms[u.id];
    if (ov && Object.keys(ov).length) {
      const added = Object.keys(ov).filter(m => Array.isArray(ov[m]) && ov[m].length).length;
      const cut = Object.keys(ov).length - added;
      return 'Wewenang khusus · ' + (cut ? cut + ' dicabut' : '') + (added ? (cut ? ' · ' : '') + added + ' ditambah' : '');
    }
    return 'Sesuai role ' + (ROLE_LABELS[u.role] || u.role);
  }

  const roleOptions = sel => Object.keys(ROLE_LABELS)
    .map(r => '<option value="' + r + '"' + (sel === r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>').join('');

  function staffMatches(u) {
    const q = state.staffQuery.trim().toLowerCase();
    if (q) {
      const hay = String(u.name || '').toLowerCase() + ' ' + String(u.email || '').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    if (state.staffRoleFilter && u.role !== state.staffRoleFilter) return false;
    return true;
  }

  function renderStaff() {
    const body = $('staffBody');
    if (!body) return;
    const head = $('staffHead');
    const tab = state.staffTab === 'inactive' ? 'inactive' : 'active';
    const me = currentUser();
    const canUpdate = window.canPerm('staff', 'update');
    const canDelete = window.canPerm('staff', 'delete');
    const canPermEdit = isOwner() && window.canPerm('permissions', 'update');
    const ownerActor = isOwner();   /* hapus permanen = kebijakan Owner */

    /* jumlah tab selalu dari data server (dihitung di database) */
    const counts = state.staffCounts ||
      (state.staff ? { active: state.staff.filter(u => u.status === 'active').length, total: state.staff.length } : null);
    const cA = $('staffCountActive'), cI = $('staffCountInactive');
    if (cA) cA.textContent = String(counts ? counts.active : 0);
    if (cI) cI.textContent = String(counts ? counts.inactive : (counts ? counts.total - counts.active : 0));
    document.querySelectorAll('[data-staff-tab]').forEach(b => {
      const on = b.getAttribute('data-staff-tab') === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const addBtn = document.querySelector('[data-action="staff-add"]');
    if (addBtn) addBtn.hidden = !window.canPerm('staff', 'create');
    if (head) head.innerHTML = staffHeadOf(tab);

    if (!state.staff) { body.innerHTML = emptyRow(6, 'Daftar staf belum dimuat.'); return; }

    const rows = state.staff
      .filter(u => (tab === 'active' ? u.status === 'active' : u.status !== 'active'))
      .filter(staffMatches);

    if (!rows.length) {
      let msg;
      if (state.staffQuery || state.staffRoleFilter) msg = 'Tidak ada akun yang cocok dengan pencarian/filter Anda.';
      else if (tab === 'inactive') msg = 'Belum ada akun nonaktif — akun yang dinonaktifkan akan muncul di sini beserta tanggal penonaktifannya.';
      else msg = 'Belum ada staf — tambah lewat tombol <b>Tambah staf</b> atau undang calon staf lewat email di panel <b>Undangan staf (Gmail)</b>.';
      body.innerHTML = emptyRow(6, msg);
      return;
    }

    body.innerHTML = rows.map(u => {
      const mine = me && String(u.id) === String(me.id);
      const isOwnerRow = u.role === 'owner';

      /* --- TAB AKTIF --- */
      if (tab === 'active') {
        const last = u.lastLoginAt ? fmtWhen(u.lastLoginAt) : 'Belum pernah';
        const roleCell = (canUpdate && !mine && !isOwnerRow)
          ? `<select class="input input-sm" data-staff-role="${u.id}">${roleOptions(u.role)}</select><small class="subcell">${esc(staffPermSummary(u))}</small>`
          : `<b>${esc(ROLE_LABELS[u.role] || u.role)}</b><small class="subcell">${isOwnerRow ? 'Akun Owner dilindungi' : esc(staffPermSummary(u))}</small>`;
        const actions = [];
        /* baris Owner hanya bisa diedit oleh Owner sendiri */
        if (canUpdate && !mine && (!isOwnerRow || ownerActor)) {
          actions.push(`<button class="staff-act is-edit" data-action="staff-edit:${esc(String(u.id))}" title="Ubah informasi staf ini"><i>✎</i>Ubah</button>`);
          /* perlindungan Owner: baris Owner tidak pernah jadi target penonaktifan */
          if (!isOwnerRow) {
            actions.push(`<button class="staff-act is-off" data-action="staff-toggle:${esc(String(u.id))}" title="Nonaktifkan akun ini"><i>⏻</i>Nonaktifkan</button>`);
          }
        }
        if (canPermEdit && !mine && !isOwnerRow) {
          actions.push(`<button class="staff-act is-perms" data-action="staff-perms:${esc(String(u.id))}" title="Cabut atau berikan wewenang staf ini"><i>⛨</i>Wewenang</button>`);
        }
        if (canDelete && ownerActor && !mine && !isOwnerRow) {
          actions.push(`<button class="staff-act is-del" data-action="staff-del:${esc(String(u.id))}" title="Hapus staf ini selamanya"><i>✕</i>Hapus</button>`);
        }
        if (mine) actions.push('<span class="hint-inline">Anda</span>');
        return `<tr><td><b>${esc(u.name || '—')}</b></td><td>${esc(u.email || '')}</td>
          <td>${roleCell}</td><td><span class="status ready">Aktif</span></td><td>${esc(last)}</td>
          <td style="text-align:right"><div class="staff-actions">${actions.join('')}</div></td></tr>`;
      }

      /* --- TAB NONAKTIF --- */
      const acts = [];
      if (canUpdate) {
        acts.push(`<button class="staff-act is-on" data-action="staff-toggle:${esc(String(u.id))}" title="Aktifkan kembali akun ini"><i>⏻</i>Aktifkan</button>`);
      }
      if (canDelete && ownerActor && String(u.id) !== String(me && me.id)) {
        acts.push(`<button class="staff-act is-del" data-action="staff-del:${esc(String(u.id))}" title="Hapus akun secara permanen"><i>✕</i>Hapus</button>`);
      }
      return `<tr class="row-dim"><td><b>${esc(u.name || '—')}</b></td><td>${esc(u.email || '')}</td>
        <td><b>${esc(ROLE_LABELS[u.role] || u.role)}</b><small class="subcell">${esc(staffPermSummary(u))}</small></td>
        <td>${esc(fmtWhen(u.deactivatedAt))}</td>
        <td style="text-align:right"><div class="staff-actions">${acts.join('')}</div></td></tr>`;
    }).join('');
  }

  async function loadStaff(force) {
    if (!currentUser() || !window.canPerm('staff', 'read')) return;
    if (state.staff && !force) { renderStaff(); return; }
    if (state.staffLoading) return;
    state.staffLoading = true;
    if (state.staff) renderStaff();   /* tampilkan daftar lama dulu, lalu segarkan dari server */
    try {
      const res = await window.RasaAPI.get('/api/staff');
      state.staff = res.items || [];
      state.staffCounts = res.counts || null;
      renderStaff();
    } catch (e) {
      const body = $('staffBody');
      if (body) body.innerHTML = emptyRow(6, 'Gagal memuat staf: ' + esc(e.message));
    } finally { state.staffLoading = false; }
  }

  /* ---------- 4. Preset izin per role (dibaca dari server) ----------
     Panel Matriks permission sudah dihapus dari UI: satu-satunya tempat
     Owner mengatur izin adalah tombol "Wewenang" di tabel staf.
     `state.matrix` tetap diambil dari server sebagai DASAR penghitungan
     wewenang efektif tiap staf (preset bawaan role). */
  async function loadPerms(force) {
    if (!currentUser() || !window.canPerm('permissions', 'read')) return;
    if (state.matrix && state.userPerms && !force) return;
    if (state.permLoading) return;
    state.permLoading = true;
    try {
      const res = await window.RasaAPI.get('/api/permissions');
      state.matrix = res.matrix || {};
      state.userPerms = res.users || {};
      renderStaff();
    } catch (e) {
      console.log('load-perms-failed', String(e && e.message));
    } finally { state.permLoading = false; }
  }

  /* ---------- 4b. Wewenang khusus per staf ----------
     Owner mencabut / memberi satu wewenang pada satu staf tanpa mengubah
     matriks role; hasilnya tersimpan di server dan langsung berlaku untuk
     sesi staf tersebut (dicek ulang tiap request & tiap penyegaran izin). */
  function staffEffective(u) {
    const roleMatrix = (state.matrix && state.matrix[u.role]) || {};
    const ov = (state.userPerms && state.userPerms[u.id]) || null;
    const out = {};
    MODULE_LABELS.forEach(([id]) => {
      const base = Array.isArray(roleMatrix[id]) ? roleMatrix[id].slice() : [];
      out[id] = (ov && Object.prototype.hasOwnProperty.call(ov, id)) ? (Array.isArray(ov[id]) ? ov[id].slice() : []) : base;
    });
    return out;
  }

  async function staffPermsModal(id) {
    const u = (state.staff || []).find(x => String(x.id) === String(id));
    if (!u) { toast('Staf tidak ditemukan.'); return; }
    if (!isOwner()) { toast('Hanya Owner yang boleh mengubah wewenang staf.'); return; }
    if (u.role === 'owner') { toast('Akun Owner selalu memiliki akses penuh — wewenang tidak dapat diubah.'); return; }
    /* Preset role & wewenang khusus harus sudah diambil dari server dulu,
       supaya centang modal mengikuti keadaan sebenarnya (bukan kosong semua
       saat Owner membuka modal untuk pertama kali). */
    if (!state.matrix || !state.userPerms) { await loadPerms(); }
    if (!state.matrix) { toast('Preset izin role belum dimuat dari server.'); return; }
    const eff = staffEffective(u);
    const rows = MODULE_LABELS.map(([mod, label]) => {
      const on = Array.isArray(eff[mod]) && eff[mod].indexOf('read') >= 0;
      const locked = mod === 'overview';
      return `<label class="uperm-row${locked ? ' locked' : ''}">
        <input type="checkbox" data-uperm="${mod}"${on ? ' checked' : ''}${locked ? ' disabled' : ''}>
        <span class="uperm-text"><b>${esc(label)}</b><small>${esc(mod)}${locked ? ' · selalu terbuka' : ''}</small></span></label>`;
    }).join('');
    openModal(`<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">⛨</span><div><b>Wewenang ${esc(u.name || u.email)}</b><small>${esc(ROLE_LABELS[u.role] || u.role)} · dicabut/diberikan per staf, berlaku langsung</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <p class="modal-text">Batalkan centang untuk <b>mencabut</b> wewenang, centang lagi untuk <b>mengembalikan</b>. Perubahan hanya menyangkut staf ini dan <b>tidak mengubah staf lain</b> — disimpan ke server, divalidasi ulang, lalu langsung dipakai setiap staf ini membuka fitur (termasuk lewat tautan langsung) tanpa perlu masuk ulang. <b>Data restoran tetap tersimpan utuh</b>; yang dicabut hanya aksesnya.</p>
    <div class="uperm-list">${rows}</div>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-primary" data-action="staff-perms-save:${esc(String(u.id))}">Simpan wewenang</button></div>
    <small class="modal-note">Centang mengikuti preset role <b>${esc(ROLE_LABELS[u.role] || u.role)}</b>, lalu disesuaikan per staf. Setiap centang divalidasi ulang oleh server.</small>`);
  }

  async function staffPermsSave(id) {
    const u = (state.staff || []).find(x => String(x.id) === String(id));
    if (!u) { closeModal(); return; }
    if (!isOwner()) { toast('Hanya Owner yang boleh mengubah wewenang staf.'); return; }
    if (u.role === 'owner') { closeModal(); toast('Akun Owner selalu memiliki akses penuh — wewenang tidak dapat diubah.'); return; }
    if (!state.matrix) { await loadPerms(true); }
    if (!state.matrix) { toast('Preset izin role belum dimuat dari server.'); return; }
    const eff = {};
    MODULE_LABELS.forEach(([mod]) => {
      const cb = document.querySelector('[data-uperm="' + mod + '"]');
      if (!cb) return;
      if (mod === 'overview') { eff[mod] = ['read', 'export']; return; }
      const roleRow = (state.matrix[u.role] && state.matrix[u.role][mod]) || [];
      eff[mod] = cb.checked ? (roleRow.length ? roleRow.slice() : ['read']) : [];
    });
    try {
      /* hanya staf ini yang dikirim — baris wewenang staf lain tidak tersentuh */
      const res = await window.RasaAPI.put('/api/permissions', { users: { [u.id]: eff } });
      if (res.matrix) state.matrix = res.matrix;
      state.userPerms = res.users || {};
      closeModal();
      renderStaff();
      toast('Wewenang ' + (u.name || u.email) + ' disimpan — langsung berlaku di server.');
    } catch (e) {
      toast(e.message);
    }
  }

  function injectSettings() {
    const grid = document.querySelector('.settings-grid');
    if (!grid) return;
    const u = currentUser();
    if (!u) {
      if (!document.getElementById('staffPanel')) {
        grid.insertAdjacentHTML('beforeend', `<div class="panel span-2"><div class="panel-head"><div><div class="panel-title">Staf &amp; permission</div>
        <div class="panel-caption">Role-based access control</div></div></div>
        <div class="empty-state">Masuk dengan akun restoran untuk mengelola staf dan permission. Saat ini mode lokal (tanpa role).</div></div>`);
      }
      return;
    }
    if (window.canPerm('staff', 'read') && !$('staffPanel')) {
      grid.insertAdjacentHTML('beforeend', staffPanelHtml());
      loadStaff(true);   /* selalu segarkan dari database saat panel dibuka */
    }
  }

  /* ---------- 5. Aksi (delegate lewat window.RASA.actions) ----------
     Form "Tambah staf" sudah dihapus — penambahan staf hanya lewat
     undangan email (panel Undangan staf di invites.js). */
  function staffInviteJump() {
    const panel = document.getElementById('invitePanel');
    if (!panel) {
      toast('Panel Undangan staf belum tersedia di halaman Pengaturan.');
      return;
    }
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const form = document.getElementById('inviteForm');
    if (window.canPerm('staff', 'create') && form && form.hidden) {
      const btn = panel.querySelector('[data-action="invite-form-toggle"]');
      if (btn) btn.click();
    }
  }

  async function staffToggle(id, confirmed) {
    if (!window.canPerm('staff', 'update')) { toast('Anda tidak punya izin mengubah staf.'); return; }
    const u = (state.staff || []).find(x => String(x.id) === String(id));
    if (!u) return;
    const active = u.status === 'active';

    /* --- perlindungan akun Owner (juga dijaga server) --- */
    if (active && u.role === 'owner') {
      toast('Anda Tidak Memiliki Wewenang untuk Menonaktifkan Akun Owner.');
      return;
    }
    if (active && !confirmed) {
      openModal(`<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">⏻</span><div><b>Nonaktifkan akun?</b><small>${esc(u.name || '')} · ${esc(u.email || '')}</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
      <p class="modal-text">Akun ini langsung <b>kehilangan akses login</b>: seluruh sesi aktif dicabut dan akun pindah ke tab <b>Akun Nonaktif</b>. Role, permission, email, dan seluruh riwayat aktivitas <b>TETAP tersimpan</b> dan dipulihkan saat akun diaktifkan kembali.</p>
      <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-danger" data-action="staff-deact-confirm:${esc(String(u.id))}">Nonaktifkan akun</button></div>`);
      return;
    }
    try {
      await window.RasaAPI.put('/api/staff/' + encodeURIComponent(id), { status: active ? 'inactive' : 'active' });
      closeModal();
      toast((u.name || 'Staf') + (active ? ' dinonaktifkan — sesi dicabut, akun pindah ke Akun Nonaktif.' : ' diaktifkan kembali dengan role & permission sebelumnya.'));
      await loadStaff(true);
    } catch (e) { toast(e.message); await loadStaff(true); }
  }

  function staffDelete(id) {
    if (!window.canPerm('staff', 'delete')) { toast('Anda tidak punya izin menghapus staf.'); return; }
    if (!isOwner()) { toast('Hanya Owner yang boleh menghapus akun secara permanen.'); return; }
    const u = (state.staff || []).find(x => String(x.id) === String(id));
    if (!u) return;
    if (u.role === 'owner') { toast('Anda Tidak Memiliki Wewenang untuk Menghapus Akun Owner.'); return; }
    openModal(`<div class="modal-head"><span class="provider-mark" style="--pm:#b0473a">✕</span><div><b>Hapus permanen?</b><small>${esc(u.name || '')} · ${esc(u.email || '')}</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <p class="modal-text">Akun dihapus <b>permanen</b> dari restoran Anda dan seluruh sesinya dicabut. Data operasional restoran (pesanan, menu, laporan) <b>tidak ikut terhapus</b>; riwayat audit tetap tersimpan. Bila hanya ingin menghentikan akses sementara, gunakan <b>Nonaktifkan</b>.</p>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-danger" data-action="staff-del-confirm:${esc(String(u.id))}">Hapus permanen</button></div>`);
  }

  async function staffDeleteConfirm(id) {
    if (!window.canPerm('staff', 'delete')) { closeModal(); toast('Anda tidak punya izin menghapus staf.'); return; }
    if (!isOwner()) { closeModal(); toast('Hanya Owner yang boleh menghapus akun secara permanen.'); return; }
    closeModal();
    try {
      await window.RasaAPI.del('/api/staff/' + encodeURIComponent(id));
      toast('Akun dihapus permanen — data operasional restoran tetap utuh.');
      await loadStaff(true);
    } catch (e) { toast(e.message); await loadStaff(true); }
  }

  /* ---------- 4c. Tambah & edit informasi staf ---------- */
  function staffAddModal() {
    if (!window.canPerm('staff', 'create')) { toast('Anda tidak punya izin menambah staf.'); return; }
    openModal(`<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">＋</span><div><b>Tambah staf</b><small>Akun baru langsung aktif dan bisa masuk dengan email ini</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <label class="field"><span>Nama staf</span><input class="input" id="stfName" maxlength="60" placeholder="Nama lengkap"></label>
    <label class="field"><span>Email akun</span><input class="input" id="stfEmail" type="email" maxlength="160" placeholder="nama@restoran.com" autocomplete="off"></label>
    <label class="field"><span>Role</span><select class="input" id="stfRole">${roleOptions('waiter')}</select></label>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-primary" data-action="staff-add-save">Tambah staf</button></div>
    <small class="modal-note">Email yang sudah terdaftar di restoran Anda tidak bisa dipakai ulang. Role dapat diubah kapan saja dari tabel staf, dan wewenang rinci diatur lewat tombol <b>Wewenang</b>.</small>`);
    const el = document.getElementById('stfName'); if (el && el.focus) el.focus();
  }

  async function staffAddSave() {
    if (!window.canPerm('staff', 'create')) { closeModal(); toast('Anda tidak punya izin menambah staf.'); return; }
    const name = String((document.getElementById('stfName') || {}).value || '').trim();
    const email = String((document.getElementById('stfEmail') || {}).value || '').trim().toLowerCase();
    const role = String((document.getElementById('stfRole') || {}).value || 'waiter');
    if (!name) { toast('Nama staf wajib diisi.'); return; }
    if (!email) { toast('Email akun wajib diisi.'); return; }
    try {
      const res = await window.RasaAPI.post('/api/staff', { name, email, role });
      closeModal();
      toast((res.user && res.user.name || name) + ' ditambahkan sebagai ' + (ROLE_LABELS[role] || role) + '.');
      await loadStaff(true);
    } catch (e) { toast(e.message); }
  }

  function staffEditModal(id) {
    if (!window.canPerm('staff', 'update')) { toast('Anda tidak punya izin mengubah staf.'); return; }
    const u = (state.staff || []).find(x => String(x.id) === String(id));
    if (!u) { toast('Staf tidak ditemukan.'); return; }
    const ownerActor = isOwner();
    const emailField = ownerActor && String(u.id) !== String((currentUser() || {}).id)
      ? `<label class="field"><span>Email akun (kebijakan Owner)</span><input class="input" id="stfEmailEdit" type="email" maxlength="160" value="${esc(u.email || '')}" autocomplete="off"></label>`
      : `<label class="field"><span>Email akun</span><input class="input" value="${esc(u.email || '')}" disabled><small class="subcell">${ownerActor ? 'Email Anda sendiri tidak dapat diubah di sini' : 'Perubahan email hanya dapat dilakukan oleh Owner'}</small></label>`;
    openModal(`<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">✎</span><div><b>Ubah informasi staf</b><small>${esc(u.name || '')} · ${esc(ROLE_LABELS[u.role] || u.role)}</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <label class="field"><span>Nama tampilan</span><input class="input" id="stfNameEdit" maxlength="60" value="${esc(u.name || '')}"></label>
    <div class="field-row">
      <label class="field"><span>Telepon pribadi</span><input class="input" id="stfPhoneEdit" maxlength="24" value="${esc(u.phone || '')}" placeholder="0812-3456-7890" autocomplete="off"></label>
      <label class="field"><span>Role</span><input class="input" value="${esc(ROLE_LABELS[u.role] || u.role)}" disabled><small class="subcell">${u.role === 'owner' ? 'Akun Owner dilindungi' : 'Ubah lewat pilihan Role pada tabel'}</small></label>
    </div>
    ${emailField}
    <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-primary" data-action="staff-edit-save:${esc(String(u.id))}">Simpan perubahan</button></div>
    <small class="modal-note">Perubahan divalidasi server dan tercatat di <b>audit log</b>. Nama tampilan pribadi tidak memengaruhi nama restoran maupun akun lain.</small>`);
    const el = document.getElementById('stfNameEdit'); if (el && el.focus) el.focus();
  }

  async function staffEditSave(id) {
    if (!window.canPerm('staff', 'update')) { closeModal(); toast('Anda tidak punya izin mengubah staf.'); return; }
    const u = (state.staff || []).find(x => String(x.id) === String(id));
    if (!u) { closeModal(); return; }
    const body = {};
    const name = String((document.getElementById('stfNameEdit') || {}).value || '').trim();
    const phone = String((document.getElementById('stfPhoneEdit') || {}).value || '').trim();
    const emailEl = document.getElementById('stfEmailEdit');
    if (name) body.name = name;
    body.phone = phone;
    if (emailEl) body.email = String(emailEl.value || '').trim();
    try {
      const res = await window.RasaAPI.put('/api/staff/' + encodeURIComponent(id), body);
      closeModal();
      toast('Informasi ' + ((res.user && res.user.name) || u.name || 'staf') + ' diperbarui.');
      await loadStaff(true);
    } catch (e) { toast(e.message); }
  }

  function setStaffTab(tab) {
    state.staffTab = tab === 'inactive' ? 'inactive' : 'active';
    renderStaff();
  }

  const actions = {
    'staff-invite-jump': () => staffInviteJump(),
    'staff-tab': id => setStaffTab(id),
    'staff-add': () => staffAddModal(),
    'staff-add-save': () => staffAddSave(),
    'staff-edit': id => staffEditModal(id),
    'staff-edit-save': id => staffEditSave(id),
    'staff-toggle': id => staffToggle(id),
    'staff-deact-confirm': id => staffToggle(id, true),
    'staff-del': id => staffDelete(id),
    'staff-del-confirm': id => staffDeleteConfirm(id),
    'staff-perms': id => staffPermsModal(id),
    'staff-perms-save': id => staffPermsSave(id)
  };

  /* ---------- 6. Hook render & sesi ---------- */
  /* Tombol LogOut / Masuk akun wajib ada di SETIAP varian halaman Ringkasan.
     Dashboard per role (manager, kasir, kitchen, waiter) tidak dibuat lewat
     dashboard() milik owner — masing-masing punya heading sendiri lewat
     roleHeading()/kitchenPage(), jadi tombolnya dipasang di sini begitu
     halaman Ringkasan selesai digambar. Dashboard owner sudah memuat tombol
     ini, karena itu dicek dulu agar tidak dobel. */
  function ensureLogoutButton() {
    const pc = $('pageContent');
    if (!pc) return;
    const actions = pc.querySelector('.heading-actions');
    if (!actions) return;
    if (actions.querySelector('[data-action="logout"],[data-action="account-login"]')) return;
    const fn = typeof dashboardLogoutBtn === 'function' ? dashboardLogoutBtn : null;
    if (!fn) return;
    actions.insertAdjacentHTML('beforeend', fn());
  }

  function postRender(page) {
    const R = window.RASA;
    if (page === 'overview' && !state.deniedFor) {
      const role = currentRole();
      const builder = role && R.dashboards ? R.dashboards[role] : null;
      if (builder) {
        const pc = $('pageContent');
        if (pc) {
          pc.innerHTML = builder();
          const banner = statusBanner();
          if (banner) pc.insertAdjacentHTML('afterbegin', banner);
          if (typeof window.RASA_wrapTables === 'function') window.RASA_wrapTables(pc);
          animateChart();
        }
      }
      ensureLogoutButton();
    }
    if (page === 'settings') injectSettings();
    applyNav();
    (R.render || []).forEach(fn => { try { fn(page) } catch (e) { console.error('RASA.render', e) } });
  }

  /* ---------- Layar pemberitahuan: tidak punya izin / halaman salah ---------- */
  function paintDenied(page) {
    const pc = $('pageContent');
    if (!pc) return;
    const known = !!KNOWN[page];
    const label = pageLabel(page) || String(page || '');
    const mod = moduleOf(page);
    const u = currentUser();
    const role = u ? (ROLE_LABELS[u.role] || u.role) : '—';
    const allowed = readableModulesOf((window.RasaSession && window.RasaSession.permissions) || {}).length;
    const total = MODULE_LABELS.length;
    pc.innerHTML = '<div class="denied-screen"><div class="denied-card">' +
      '<span class="denied-icon">' + (known ? '⛨' : '404') + '</span>' +
      '<h2>' + (known ? 'Anda tidak punya izin' : 'Halaman tidak ditemukan') + '</h2>' +
      (known
        ? '<p class="denied-lead">Halaman <b>' + esc(label) + '</b> tidak dapat dibuka karena wewenang Anda tidak mencakupnya.</p>'
        : '<p class="denied-lead">Tautan <b>#' + esc(String(page || '')) + '</b> tidak menunjuk ke halaman mana pun.</p>') +
      (known ? '<div class="denied-meta">' +
        '<span><small>Peran Anda</small><b>' + esc(role) + '</b></span>' +
        '<span><small>Modul</small><b>' + esc(mod) + '</b></span>' +
        '<span><small>Wewenang aktif</small><b>' + allowed + ' / ' + total + ' modul</b></span>' +
        '</div>' : '') +
      '<p class="denied-hint">' + (known
        ? 'Menu fitur ini sudah disembunyikan dan tautan langsung pun tetap ditolak. Minta <b>Owner</b> mengembalikan wewenang <b>' + esc(label) + '</b> — begitu disimpan, layar ini terganti otomatis tanpa perlu masuk ulang.'
        : 'Periksa kembali alamat, atau pilih fitur lain dari menu di sebelah kiri.') + '</p>' +
      '<div class="denied-actions"><button class="btn btn-primary" data-page="overview">← Kembali ke Ringkasan</button></div>' +
      '</div></div>';
    const c = $('crumb');
    if (c) c.textContent = known ? 'Akses ditolak' : 'Tidak ditemukan';
    /* Layar izin menggantikan halaman Ringkasan, jadi menu + tab Ringkasan
       yang disorot — bilah tab bawah tidak pernah kehilangan tab aktifnya. */
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === 'overview'));
  }

  function wrapRender() {
    if (window.__rasaRenderWrapped) return;
    const orig = window.render;
    if (typeof orig !== 'function') return;
    window.render = function (page, keepScroll) {
      page = page || 'overview';
      state.requested = page;
      const s = window.RasaSession;
      const ready = !s || !s.token || !!s.ready;   /* mode lokal (tanpa akun) dianggap siap */
      let denied = '', shown = page;

      if (!ready) {
        shown = 'overview';                        /* sesi belum dipulihkan: tahan dulu */
      } else if (page !== 'overview' && (!KNOWN[page] || !can(page, 'read'))) {
        denied = page;                             /* URL langsung / menu yang dicabut */
        shown = 'overview';
      }
      state.deniedFor = denied;
      orig(shown, keepScroll);
      /* Render "tahanan" (sesi belum siap / izin ditolak) memakai halaman
         pengganti — jangan sampai halaman yang diminta user (mis. tautan
         langsung /#reservations) hilang dari acuan render berikutnya. */
      if (shown !== page) {
        try { currentPage = page } catch (e) {}
        try { if (typeof syncHash === 'function') syncHash(page) } catch (e) {}
      }
      try { postRender(shown) } catch (e) { console.error('postRender', e) }
      if (denied) {
        paintDenied(denied);
        try { if (typeof syncHash === 'function') syncHash(denied) } catch (e) {}
      }
    };
    window.__rasaRenderWrapped = true;
  }

  /* ---------- 5b. Penyegaran izin dari server ----------
     Izin selalu dibaca ulang dari backend (tanpa login ulang) sehingga
     pencabutan wewenang oleh Owner langsung terasa: menu disembunyikan dan
     halaman aktif diganti layar izin. DATA TIDAK DIHAPUS di mana pun —
     salinan lokal dan data server tetap utuh, sinkronisasi tetap jalan. */
  let permBusy = false, permTimer = null, lastPermJson = null;

  async function refreshPerms(force) {
    const s = window.RasaSession;
    if (!s || !s.token || !s.ready) return false;
    if (permBusy) return false;
    permBusy = true;
    try {
      const before = readableModulesOf(s.permissions);
      const me = await window.RasaAPI.get('/api/auth/me');
      const next = (me && me.permissions) || null;
      if (me && me.user) s.user = me.user;
      if (me && me.restaurant) s.restaurant = me.restaurant;
      s.permissions = next;

      const json = JSON.stringify(next || {});
      const first = lastPermJson === null;
      const changed = json !== lastPermJson;
      lastPermJson = json;

      const after = readableModulesOf(next);
      const revoked = before.filter(m => after.indexOf(m) < 0);
      applyNav();
      injectNav();

      if (!changed && !first && !force) return false;
      /* Dasar perbandingan adalah izin sesi (saat masuk / poll sebelumnya),
         jadi wewenang yang hilang antar-poll tetap diumumkan — termasuk pada
         poll pertama setelah halaman dibuka. */
      if (revoked.length) {
        toast('Owner mencabut wewenang ' + revoked.map(m => (MODULE_LABELS.find(x => x[0] === m) || [])[1] || m).join(', ') +
          ' — menu disembunyikan, data tetap tersimpan & tersinkron.');
      }
      /* evaluasi ulang halaman yang sedang terbuka */
      const req = state.requested;
      if (req && req !== 'overview' && (!KNOWN[req] || !can(req, 'read'))) window.render(req, true);
      else if (state.deniedFor && can(state.deniedFor, 'read')) window.render(state.deniedFor, true);
      return true;
    } catch (e) {
      if (e && e.status !== 401) return false;   /* 401 ditangani API client */
      return false;
    } finally { permBusy = false; }
  }

  function startPermWatch() {
    if (permTimer) return;
    permTimer = setInterval(() => { if (!document.hidden) refreshPerms(); }, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPerms(); });
    window.addEventListener('focus', () => refreshPerms());
    window.addEventListener('rasa:denied', () => refreshPerms(true));
  }

  function refreshRoleUI() {
    applyNav();
    injectNav();
    if (document.getElementById('pageContent')) window.render(state.requested || 'overview', true);
    refreshPerms();
  }

  function hookAuth() {
    const A = window.RasaAuth;
    if (!A || A.__rolesHooked) return;
    const orig = A.applyAccountUI;
    A.applyAccountUI = function () {
      try { orig.apply(A, arguments) } catch (e) {}
      try { refreshRoleUI() } catch (e) { console.error('refreshRoleUI', e) }
    };
    A.__rolesHooked = true;
  }

  function init() {
    defaultDashboards();
    Object.keys(actions).forEach(k => {
      window.RASA.actions[k] = actions[k];
    });
    wrapRender();
    hookAuth();

    /* perubahan role staf langsung dari tabel */
    document.addEventListener('change', e => {
      const t = e.target;
      /* filter role pada toolbar Staf & Role */
      if (t && t.id === 'staffRoleFilter') {
        state.staffRoleFilter = String(t.value || '');
        renderStaff();
        return;
      }
      const sel = t && t.closest ? t.closest('[data-staff-role]') : null;
      if (sel) {
        const id = sel.getAttribute('data-staff-role');
        const role = sel.value;
        if (!window.canPerm('staff', 'update')) { toast('Anda tidak punya izin mengubah staf.'); loadStaff(true); return; }
        window.RasaAPI.put('/api/staff/' + encodeURIComponent(id), { role })
          .then(() => { toast('Role staf diubah menjadi ' + (ROLE_LABELS[role] || role) + '.'); loadStaff(true); })
          .catch(err => { toast(err.message); loadStaff(true); });
        return;
      }
    });

    /* tab Akun Aktif / Akun Nonaktif */
    document.addEventListener('click', e => {
      const tab = e.target && e.target.closest ? e.target.closest('[data-staff-tab]') : null;
      if (tab) setStaffTab(tab.getAttribute('data-staff-tab'));
    });

    /* pencarian nama & email (DOM saja — daftar sudah termuat dari server) */
    document.addEventListener('input', e => {
      if (e.target && e.target.id === 'staffSearch') {
        state.staffQuery = String(e.target.value || '');
        renderStaff();
      }
    });

    injectNav();
    applyNav();
    /* render ulang agar guard + dashboard role aktif sejak awal */
    const startPage = (function () {
      try {
        const h = String(location.hash || '').replace(/^#/, '').split('?')[0];
        return h || (typeof currentPage !== 'undefined' ? currentPage : 'overview');
      } catch (e) { return 'overview' }
    })();
    state.requested = startPage;
    if (document.getElementById('pageContent')) window.render(startPage, true);

    /* buka langsung lewat tautan: /#reservasi tetap melewati guard izin */
    window.addEventListener('hashchange', () => {
      let h = '';
      try { h = String(location.hash || '').replace(/^#/, '').split('?')[0] } catch (e) { h = '' }
      const page = h || 'overview';
      if (page === (state.deniedFor || state.requested)) return;
      window.render(page);
    });

    /* izin dipantau: pencabutan oleh Owner langsung terbaca tanpa login ulang */
    startPermWatch();
    refreshPerms(true);

    /* Jaring pengaman: bila sesi baru siap SETELAH init selesai (proses
       restore akun bisa lebih cepat daripada pemuatan skrip ini), halaman
       yang diminta lewat tautan langsung tetap dievaluasi ulang begitu
       sesi siap — guard izin berlaku, bukan diam-diam jatuh ke Ringkasan. */
    (function watchSessionReady() {
      let tries = 0;
      const iv = setInterval(function () {
        tries++;
        const s = window.RasaSession;
        const ready = !s || !s.token || !!s.ready;
        if (!ready && tries < 80) return;
        clearInterval(iv);
        if (document.getElementById('pageContent')) {
          window.render(state.requested || 'overview', true);
        }
      }, 250);
    })();
  }

  return { init, applyNav, state, moduleOf };
})();

window.RasaRoles.init();
