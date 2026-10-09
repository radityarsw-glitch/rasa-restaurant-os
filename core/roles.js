/* ============================================================
   RASA Restaurant OS — role experience (Blok C)
   - Dashboard khusus per role (owner/manager/kasir/kitchen/waiter)
   - Saring navigasi & jaga halaman sesuai permission
   - Panel Staf + matriks permission di Pengaturan
   Semua keputusan izin tetap divalidasi backend; file ini hanya
   menyesuaikan pengalaman pengguna agar sesuai role.
   ============================================================ */

window.RasaRoles = (function () {
  const $ = id => document.getElementById(id);

  /* Halaman lama -> modul permission. Halaman baru memakai nama modul. */
  const PAGE_MODULE = {
    overview: 'overview', orders: 'orders', kitchen: 'kitchen',
    pelayan: 'orders',
    reservations: 'reservations', menu: 'menu', inventory: 'inventory',
    procurement: 'procurement', finance: 'finance', reports: 'reports',
    settings: 'settings'
  };

  const MODULE_LABELS = [
    ['overview', 'Ringkasan'], ['pos', 'POS / Kasir'], ['orders', 'Pesanan'],
    ['kitchen', 'Kitchen Display'], ['tables', 'Meja'], ['reservations', 'Reservasi'],
    ['menu', 'Menu & produk'], ['inventory', 'Persediaan'], ['recipes', 'Resep / BOM'],
    ['procurement', 'Pengadaan'], ['staff', 'Staf'], ['shifts', 'Shift'],
    ['customers', 'Pelanggan'], ['finance', 'Keuangan'], ['accounting', 'Accounting'],
    ['reports', 'Laporan'], ['analytics', 'Analytics'], ['alerts', 'Alert Center'],
    ['audit', 'Audit log'], ['settings', 'Pengaturan'], ['permissions', 'Permission']
  ];
  const ACTIONS = ['read', 'create', 'update', 'delete', 'approve', 'export'];
  const ACTION_LABELS = { read: 'Baca', create: 'Tambah', update: 'Ubah', delete: 'Hapus', approve: 'Setujui', export: 'Ekspor' };
  const ROLE_TABS = ['manager', 'kasir', 'kitchen', 'waiter'];
  const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', kasir: 'Kasir', kitchen: 'Kitchen', waiter: 'Waiter' };

  const state = {
    staff: null, matrix: null, permRole: 'manager', staffLoading: false, permLoading: false, formOpen: false,
    userPerms: null,          /* { userId: { modul: [aksi] } } wewenang khusus staf */
    deniedFor: '',            /* halaman terakhir yang ditolak (bukan halaman biasa) */
    requested: 'overview',    /* halaman terakhir yang diminta pengguna */
    ready: false              /* sesi sudah dipulihkan (izin final diketahui) */
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
  /* Modul -> key data lokal yang harus dibersihkan saat wewenang dicabut */
  const MODULE_KEYS = {
    pos: ['cart'], orders: ['orders', 'archive'], kitchen: ['kitchen'], tables: ['tables'],
    reservations: ['reservations'], menu: ['products'], inventory: ['inventory', 'stockLog'],
    recipes: ['recipes'], procurement: ['suppliers', 'purchaseOrders'], staff: ['staff'],
    shifts: ['shifts'], customers: ['customers'], finance: ['finance'],
    accounting: ['accounting', 'journal', 'ledger'], reports: ['reports'], analytics: ['analytics'],
    alerts: ['alerts'], audit: ['audit'], settings: ['restaurantName', 'restaurantLocation', 'brandName',
      'ownerName', 'ownerRole', 'avatar', 'logo', 'accounts', 'lat', 'lng', 'profile', 'identity', 'outlet', 'outlets',
      'theme', 'isOpen'],
    permissions: ['permissions']
  };
  /* Pemetaan key data -> modul (dipakai sync untuk tidak mengirim key yang
     memang tidak boleh ditulis role ini — server tetap penentu akhir). */
  const KEY_MODULE = {};
  Object.keys(MODULE_KEYS).forEach(m => MODULE_KEYS[m].forEach(k => { KEY_MODULE[k] = m }));
  window.RasaKeyModule = k => KEY_MODULE[k] || 'misc';
  const readableModulesOf = perms => Object.keys(perms || {}).filter(m => Array.isArray(perms[m]) && perms[m].indexOf('read') >= 0);

  /* Hapus data lokal milik modul yang wewenangnya dicabut, supaya staf
     tidak lagi melihat salinan lama di perangkatnya. */
  function purgeModules(modules) {
    const keys = [];
    modules.forEach(m => { (MODULE_KEYS[m] || []).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k) }) });
    if (!keys.length) return false;
    const S = window.RasaSession;
    void S;
    if (window.RasaSync && typeof window.RasaSync.dropKeys === 'function') return window.RasaSync.dropKeys(keys);
    try {
      keys.forEach(k => { if (k in store) delete store[k] });
      saveStore();
    } catch (e) { console.log('purge-failed', String(e && e.message)) }
    return true;
  }

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
    /* Kitchen selalu masuk ke papan KDS — tugas utama role ini. */
    return kitchenPage();
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
      <button class="btn" data-page="pelayan">▤ Antar pesanan</button>
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

  /* ---------- 3. Panel Pengaturan: staf ---------- */
  function staffPanelHtml() {
    const canCreate = window.canPerm('staff', 'create');
    const form = `
      <div class="staff-form" id="staffForm" ${state.formOpen ? '' : 'hidden'}>
        <label class="field"><span>Nama staf</span><input class="input" id="stName" maxlength="60" placeholder="Nama lengkap"></label>
        <label class="field"><span>Email</span><input class="input" id="stEmail" type="email" maxlength="160" placeholder="nama@restoran.com"></label>
        <label class="field"><span>Role</span><select class="input" id="stRole">
          ${Object.keys(ROLE_LABELS).map(r => '<option value="' + r + '"' + (r === 'waiter' ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>').join('')}
        </select></label>
        <div class="btn-row">
          <button class="btn btn-primary" data-action="staff-add">Simpan staf</button>
          <button class="btn" data-action="staff-form-toggle">Batal</button>
        </div>
        <div class="hint">Staf masuk memakai email ini — kode OTP 6 digit dikirim ke email mereka (ditampilkan di layar).</div>
      </div>`;
    return `
    <div class="panel span-2" id="staffPanel">
      <div class="panel-head"><div><div class="panel-title">Staf &amp; role</div>
      <div class="panel-caption">Akun yang boleh masuk ke restoran ini · divalidasi server</div></div>
      ${canCreate ? '<button class="btn btn-primary" data-action="staff-form-toggle">＋ Tambah staf</button>' : ''}</div>
      ${form}
      <div class="table-wrap"><table class="staff-table"><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Login terakhir</th><th style="text-align:right">Aksi</th></tr></thead>
      <tbody id="staffBody"><tr><td colspan="6" class="empty-state">Memuat daftar staf…</td></tr></tbody></table></div>
      <div class="hint">Setiap perubahan role/status tercatat di <b>audit log</b> dan langsung mengubah permission saat staf masuk berikutnya.</div>
    </div>`;
  }

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

  function renderStaff() {
    const body = $('staffBody');
    if (!body) return;
    if (!state.staff) { body.innerHTML = '<tr><td colspan="6" class="empty-state">Daftar staf belum dimuat.</td></tr>'; return; }
    const me = currentUser();
    const canUpdate = window.canPerm('staff', 'update');
    const canDelete = window.canPerm('staff', 'delete');
    const canPermEdit = isOwner() && window.canPerm('permissions', 'update');
    if (!state.staff.length) { body.innerHTML = '<tr><td colspan="6" class="empty-state">Belum ada staf — tambahkan akun pertama.</td></tr>'; return; }
    body.innerHTML = state.staff.map(u => {
      const mine = me && u.id === me.id;
      const last = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Belum pernah';
      const roleCell = canUpdate && !mine
        ? `<select class="input input-sm" data-staff-role="${u.id}">${Object.keys(ROLE_LABELS).map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>').join('')}</select><small class="subcell">${esc(staffPermSummary(u))}</small>`
        : `<b>${ROLE_LABELS[u.role]}</b><small class="subcell">${esc(staffPermSummary(u))}</small>`;
      const statusCell = u.status === 'active'
        ? '<span class="status ready">Aktif</span>'
        : '<span class="status pending">Dinonaktifkan</span>';
      const actions = [];
      if (canUpdate && !mine) actions.push(`<button class="link-btn" data-action="staff-toggle:${u.id}">${u.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}</button>`);
      if (canPermEdit && !mine && u.role !== 'owner') actions.push(`<button class="link-btn" data-action="staff-perms:${u.id}" title="Cabut atau berikan wewenang staf ini">Wewenang</button>`);
      if (canDelete && !mine) actions.push(`<button class="link-btn danger-link" data-action="staff-del:${u.id}">Hapus</button>`);
      if (mine) actions.push('<span class="hint-inline">Anda</span>');
      return `<tr${u.status !== 'active' ? ' class="row-dim"' : ''}><td><b>${esc(u.name || '—')}</b></td><td>${esc(u.email || '')}</td>
        <td>${roleCell}</td><td>${statusCell}</td><td>${esc(last)}</td>
        <td style="text-align:right;white-space:nowrap">${actions.join(' &nbsp; ')}</td></tr>`;
    }).join('');
  }

  async function loadStaff(force) {
    if (!currentUser() || !window.canPerm('staff', 'read')) return;
    if (state.staff && !force) { renderStaff(); return; }
    if (state.staffLoading) return;
    state.staffLoading = true;
    try {
      const res = await window.RasaAPI.get('/api/staff');
      state.staff = res.items || [];
      renderStaff();
    } catch (e) {
      const body = $('staffBody');
      if (body) body.innerHTML = '<tr><td colspan="6" class="empty-state">Gagal memuat staf: ' + esc(e.message) + '</td></tr>';
    } finally { state.staffLoading = false; }
  }

  /* ---------- 4. Panel Pengaturan: matriks permission ---------- */
  function permPanelHtml() {
    const editable = isOwner();
    const tabs = ROLE_TABS.map(r =>
      `<button class="perm-tab${state.permRole === r ? ' selected' : ''}" data-action="perm-tab:${r}">${ROLE_LABELS[r]}</button>`).join('');
    return `
    <div class="panel span-2" id="permPanel">
      <div class="panel-head"><div><div class="panel-title">Matriks permission per role</div>
      <div class="panel-caption">Atur siapa boleh mengakses modul apa — setiap centang divalidasi ulang oleh server</div></div>
      <div class="perm-tabs">${tabs}</div></div>
      <div id="permBody"><div class="empty-state">Memuat matriks permission…</div></div>
      ${editable ? `<div class="btn-row" style="margin-top:12px">
        <button class="btn btn-primary" data-action="perm-save">Simpan permission</button>
        <button class="btn" data-action="perm-reset">Muat ulang</button>
      </div>` : '<div class="hint">Hanya <b>Owner</b> yang boleh mengubah matriks ini.</div>'}
    </div>`;
  }

  function renderPerms() {
    const box = $('permBody');
    if (!box) return;
    if (!state.matrix) { box.innerHTML = '<div class="empty-state">Matriks belum dimuat.</div>'; return; }
    const role = state.permRole;
    const row = state.matrix[role] || {};
    const editable = isOwner();
    box.innerHTML = `<div class="table-wrap"><table class="perm-table"><thead><tr><th>Modul</th>${ACTIONS.map(a => '<th>' + ACTION_LABELS[a] + '</th>').join('')}</tr></thead><tbody>
      ${MODULE_LABELS.map(([id, label]) => `<tr${id === 'overview' ? ' class="row-dim"' : ''}><td><b>${label}</b><span class="subcell">${id}</span></td>
      ${ACTIONS.map(a => {
        const on = Array.isArray(row[id]) && row[id].indexOf(a) >= 0;
        const lock = !editable || id === 'overview' && a !== 'read' && a !== 'export';
        return '<td><label class="perm-cell' + (lock ? ' locked' : '') + '"><input type="checkbox" data-perm="' + id + '" data-act="' + a + '"' +
          (on ? ' checked' : '') + (lock ? ' disabled' : '') + '></label></td>';
      }).join('')}</tr>`).join('')}
    </tbody></table></div>`;
  }

  async function loadPerms(force) {
    if (!currentUser() || !window.canPerm('permissions', 'read')) return;
    if (state.matrix && state.userPerms && !force) { renderPerms(); return; }
    if (state.permLoading) return;
    state.permLoading = true;
    try {
      const res = await window.RasaAPI.get('/api/permissions');
      state.matrix = res.matrix || {};
      state.userPerms = res.users || {};
      renderPerms();
      renderStaff();
    } catch (e) {
      const box = $('permBody');
      if (box) box.innerHTML = '<div class="empty-state">Gagal memuat permission: ' + esc(e.message) + '</div>';
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

  function staffPermsModal(id) {
    const u = (state.staff || []).find(x => String(x.id) === String(id));
    if (!u) { toast('Staf tidak ditemukan.'); return; }
    if (!isOwner()) { toast('Hanya Owner yang boleh mengubah wewenang staf.'); return; }
    const eff = staffEffective(u);
    const rows = MODULE_LABELS.map(([mod, label]) => {
      const on = Array.isArray(eff[mod]) && eff[mod].indexOf('read') >= 0;
      const locked = mod === 'overview';
      return `<label class="uperm-row${locked ? ' locked' : ''}">
        <input type="checkbox" data-uperm="${mod}"${on ? ' checked' : ''}${locked ? ' disabled' : ''}>
        <span class="uperm-text"><b>${esc(label)}</b><small>${esc(mod)}${locked ? ' · selalu terbuka' : ''}</small></span></label>`;
    }).join('');
    openModal(`<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">⛨</span><div><b>Wewenang ${esc(u.name || u.email)}</b><small>${esc(ROLE_LABELS[u.role] || u.role)} · dicabut/diberikan per staf, berlaku langsung</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <p class="modal-text">Batalkan centang untuk <b>mencabut</b> wewenang, centang lagi untuk <b>mengembalikan</b>. Perubahan disimpan ke server dan langsung dipakai sistem setiap staf ini membuka fitur — termasuk lewat tautan langsung — tanpa perlu masuk ulang.</p>
    <div class="uperm-list">${rows}</div>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-primary" data-action="staff-perms-save:${esc(String(u.id))}">Simpan wewenang</button></div>
    <small class="modal-note">Wewenang yang berbeda dari matriks role <b>${esc(ROLE_LABELS[u.role] || u.role)}</b> disimpan sebagai pengecualian khusus staf ini.</small>`);
  }

  async function staffPermsSave(id) {
    const u = (state.staff || []).find(x => String(x.id) === String(id));
    if (!u) { closeModal(); return; }
    if (!isOwner()) { toast('Hanya Owner yang boleh mengubah wewenang staf.'); return; }
    if (!state.matrix) { toast('Matriks permission belum dimuat.'); return; }
    const eff = {};
    MODULE_LABELS.forEach(([mod]) => {
      const cb = document.querySelector('[data-uperm="' + mod + '"]');
      if (!cb) return;
      if (mod === 'overview') { eff[mod] = ['read', 'export']; return; }
      const roleRow = (state.matrix[u.role] && state.matrix[u.role][mod]) || [];
      eff[mod] = cb.checked ? (roleRow.length ? roleRow.slice() : ['read']) : [];
    });
    /* kirim peta efektif SEMUA staf — server menyimpan selisihnya terhadap role */
    const users = {};
    (state.staff || []).forEach(s => {
      if (s.role === 'owner' || String(s.id) === String(u.id)) return;
      users[s.id] = staffEffective(s);
    });
    users[u.id] = eff;
    try {
      const res = await window.RasaAPI.put('/api/permissions', { matrix: state.matrix, users });
      if (res.matrix) state.matrix = res.matrix;
      state.userPerms = res.users || {};
      closeModal();
      renderStaff();
      renderPerms();
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
      loadStaff();
    }
    if (window.canPerm('permissions', 'read') && !$('permPanel')) {
      grid.insertAdjacentHTML('beforeend', permPanelHtml());
      loadPerms();
    }
  }

  /* ---------- 5. Aksi (delegate lewat window.RASA.actions) ---------- */
  async function staffAdd(arg, el) {
    if (!window.canPerm('staff', 'create')) { toast('Anda tidak punya izin menambah staf.'); return; }
    const name = String(($('stName') && $('stName').value || '').trim());
    const email = String(($('stEmail') && $('stEmail').value || '').trim()).toLowerCase();
    const role = String(($('stRole') && $('stRole').value || 'waiter'));
    if (!name) { toast('Nama staf wajib diisi.'); if ($('stName')) $('stName').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { toast('Format email tidak valid.'); if ($('stEmail')) $('stEmail').focus(); return; }
    if (el) { el.disabled = true; }
    try {
      const res = await window.RasaAPI.post('/api/staff', { name, email, role });
      toast(name + ' ditambahkan sebagai ' + (ROLE_LABELS[role] || role) + '.');
      state.formOpen = false;
      await loadStaff(true);
      const form = $('staffForm'); if (form) form.hidden = true;
      /* audit lokal + server sudah ditulis backend */
    } catch (e) { toast(e.message); }
    finally { if (el) el.disabled = false; }
  }

  async function staffToggle(id) {
    if (!window.canPerm('staff', 'update')) { toast('Anda tidak punya izin mengubah staf.'); return; }
    const u = (state.staff || []).find(x => x.id === id);
    if (!u) return;
    try {
      await window.RasaAPI.put('/api/staff/' + encodeURIComponent(id), { status: u.status === 'active' ? 'suspended' : 'active' });
      toast((u.name || 'Staf') + (u.status === 'active' ? ' dinonaktifkan.' : ' diaktifkan.'));
      await loadStaff(true);
    } catch (e) { toast(e.message); }
  }

  function staffDelete(id) {
    if (!window.canPerm('staff', 'delete')) { toast('Anda tidak punya izin menghapus staf.'); return; }
    const u = (state.staff || []).find(x => x.id === id);
    if (!u) return;
    openModal(`<div class="modal-head"><span class="provider-mark" style="--pm:#b0473a">✕</span><div><b>Hapus staf?</b><small>${esc(u.name)} · ${esc(u.email)}</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
    <p class="modal-text">Akun ini langsung keluar dari restoran Anda dan semua sesinya dicabut. Tindakan ini tercatat di audit log.</p>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-danger" data-action="staff-del-confirm:${esc(id)}">Hapus staf</button></div>`);
  }

  async function staffDeleteConfirm(id) {
    if (!window.canPerm('staff', 'delete')) { closeModal(); toast('Anda tidak punya izin menghapus staf.'); return; }
    closeModal();
    try {
      await window.RasaAPI.del('/api/staff/' + encodeURIComponent(id));
      toast('Staf dihapus.');
      await loadStaff(true);
    } catch (e) { toast(e.message); }
  }

  async function permSave() {
    if (!isOwner()) { toast('Hanya owner yang boleh mengubah permission.'); return; }
    if (!state.matrix) { toast('Matriks belum dimuat.'); return; }
    try {
      const res = await window.RasaAPI.put('/api/permissions', { matrix: state.matrix });
      if (res.matrix) state.matrix = res.matrix;
      /* perbarui sesi sendiri bila role berubah */
      const me = currentUser();
      if (me && state.matrix[me.role]) window.RasaSession.permissions = state.matrix[me.role];
      renderPerms();
      applyNav();
      toast('Permission tersimpan & berlaku di server.');
    } catch (e) { toast(e.message); }
  }

  const actions = {
    'staff-form-toggle': () => {
      state.formOpen = !state.formOpen;
      const f = $('staffForm');
      if (f) { f.hidden = !state.formOpen; if (state.formOpen) $('stName').focus(); }
    },
    'staff-add': (arg, el) => staffAdd(arg, el),
    'staff-toggle': id => staffToggle(id),
    'staff-del': id => staffDelete(id),
    'staff-del-confirm': id => staffDeleteConfirm(id),
    'staff-perms': id => staffPermsModal(id),
    'staff-perms-save': id => staffPermsSave(id),
    'perm-tab': role => { if (ROLE_TABS.indexOf(role) >= 0) { state.permRole = role; document.querySelectorAll('.perm-tab').forEach(b => b.classList.toggle('selected', b.dataset.action === 'perm-tab:' + role)); renderPerms(); } },
    'perm-save': () => permSave(),
    'perm-reset': () => { state.matrix = null; loadPerms(true); toast('Matriks dimuat ulang dari server.'); }
  };

  /* ---------- 6. Hook render & sesi ---------- */
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
          animateChart();
        }
      }
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
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
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
     pencabutan wewenang oleh Owner langsung terasa: menu disembunyikan,
     halaman aktif diganti layar izin, dan data lokal ikut dibersihkan. */
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
      const allModules = MODULE_LABELS.map(x => x[0]);
      /* salinan data lokal milik modul tanpa izin ikut dibuang */
      purgeModules(allModules.filter(m => after.indexOf(m) < 0));
      applyNav();
      injectNav();

      if (!changed && !first && !force) return false;
      /* Dasar perbandingan adalah izin sesi (saat masuk / poll sebelumnya),
         jadi wewenang yang hilang antar-poll tetap diumumkan — termasuk pada
         poll pertama setelah halaman dibuka. */
      if (revoked.length) {
        toast('Owner mencabut wewenang ' + revoked.map(m => (MODULE_LABELS.find(x => x[0] === m) || [])[1] || m).join(', ') + '.');
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
      const sel = e.target && e.target.closest ? e.target.closest('[data-staff-role]') : null;
      if (sel) {
        const id = sel.getAttribute('data-staff-role');
        const role = sel.value;
        if (!window.canPerm('staff', 'update')) { toast('Anda tidak punya izin mengubah staf.'); loadStaff(true); return; }
        window.RasaAPI.put('/api/staff/' + encodeURIComponent(id), { role })
          .then(() => { toast('Role staf diubah menjadi ' + (ROLE_LABELS[role] || role) + '.'); loadStaff(true); })
          .catch(err => { toast(err.message); loadStaff(true); });
        return;
      }
      const cb = e.target && e.target.closest ? e.target.closest('[data-perm]') : null;
      if (cb) {
        if (!state.matrix) return;
        const mod = cb.getAttribute('data-perm'), act = cb.getAttribute('data-act');
        const role = state.permRole;
        state.matrix[role] = state.matrix[role] || {};
        const list = Array.isArray(state.matrix[role][mod]) ? state.matrix[role][mod].slice() : [];
        const i = list.indexOf(act);
        if (cb.checked && i < 0) list.push(act);
        if (!cb.checked && i >= 0) list.splice(i, 1);
        state.matrix[role][mod] = list;
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
