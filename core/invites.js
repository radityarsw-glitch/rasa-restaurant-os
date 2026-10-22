/* ============================================================
   RASA Restaurant OS — Undangan staf lewat email (Gmail)
   Dua sisi dalam satu modul:
   1. Pemilik (owner/manager dengan izin `staff`) — panel
      "Undangan staf (Gmail)" di Pengaturan: kirim undangan lewat
      alamat Gmail + peran, lihat status, batalkan undangan pending.
   2. Calon staf — notifikasi otomatis saat masuk dengan email yang
      diundang, tombol Terima / Tolak, plus halaman #undangan dan
      kartu di Alert Center (window.RASA.alertSources).
   Keanggotaan staf baru terbentuk di server SETELAH Terima ditekan;
   semua keputusan (email cocok, status pending, izin role) divalidasi
   backend — file ini hanya menampilkan dan meneruskan.
   Dimuat SEBELUM app.js agar halaman & sumber alert terdaftar di
   registry window.RASA (pola sama dengan core/insights.js).
   ============================================================ */

window.RasaInvites = (function () {
  const $ = id => document.getElementById(id);
  const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', kasir: 'Kasir', kitchen: 'Kitchen', waiter: 'Waiter' };
  const roleLabelLocal = id => ROLE_LABELS[id] || String(id || '');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const state = {
    list: null,        /* undangan restoran ini (panel Pengaturan) */
    mine: null,        /* undangan pending untuk email yang sedang masuk */
    history: null,     /* riwayat tanggapan saya (accepted/rejected) */
    listLoading: false,
    formOpen: false,
    shown: {}          /* id yang modal notifikasinya sudah pernah dibuka sesi ini */
  };

  const me = () => (window.RasaSession && window.RasaSession.user) || null;
  const whenText = ts => ts ? new Date(ts).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const statusCell = st => st === 'pending'
    ? '<span class="status pending">Menunggu</span>'
    : (st === 'accepted' ? '<span class="status ready">Diterima</span>' : '<span class="status cancelled">Ditolak</span>');

  /* ============================================================
     1. Sisi pemilik — panel undangan di halaman Pengaturan
     ============================================================ */
  function panelHtml() {
    const canCreate = window.canPerm('staff', 'create');
    return `
    <div class="panel span-2" id="invitePanel">
      <div class="panel-head"><div><div class="panel-title">Undangan staf (Gmail)</div>
      <div class="panel-caption">Undang calon staf lewat alamat Gmail &amp; peran — keanggotaan aktif hanya setelah mereka menekan <b>Terima</b> di aplikasi</div></div>
      ${canCreate ? '<button class="btn btn-primary" data-action="invite-form-toggle">＋ Undang staf</button>' : ''}</div>
      <div class="staff-form" id="inviteForm" ${state.formOpen ? '' : 'hidden'}>
        <label class="field"><span>Alamat Gmail calon staf</span><input class="input" id="ivEmail" type="email" maxlength="160" placeholder="nama@gmail.com" autocomplete="off"></label>
        <label class="field"><span>Peran / jabatan</span><select class="input" id="ivRole">
          ${Object.keys(ROLE_LABELS).map(r => '<option value="' + r + '"' + (r === 'waiter' ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>').join('')}
        </select></label>
        <label class="field"><span>Catatan (opsional)</span><input class="input" id="ivNote" maxlength="120" placeholder="Contoh: shift malam"></label>
        <div class="btn-row">
          <button class="btn btn-primary" data-action="invite-send">Kirim undangan</button>
          <button class="btn" data-action="invite-form-toggle">Batal</button>
        </div>
        <div class="hint">Bila alamat Gmail belum memiliki akun, undangan <b>tetap tersimpan</b> dan tampil sebagai notifikasi setelah mereka mendaftar &amp; masuk dengan email yang sama. Hanya satu undangan aktif per email — batalkan dulu bila ingin mengundang ulang.</div>
      </div>
      <div class="table-wrap"><table class="staff-table"><thead><tr><th>Email</th><th>Peran</th><th>Status</th><th>Diundang</th><th style="text-align:right">Aksi</th></tr></thead>
      <tbody id="inviteBody"><tr><td colspan="5" class="empty-state">Memuat undangan…</td></tr></tbody></table></div>
      <div class="hint">Calon staf menekan <b>Terima</b> / <b>Tolak</b> lewat notifikasi di aplikasi. Setelah <b>diterima</b>, akunnya menjadi staf dengan peran ini dan izinnya mengikuti sistem permission yang berlaku; setelah <b>ditolak</b>, tidak ada keanggotaan yang dibuat. Semua perubahan tercatat di <b>audit log</b>.</div>
    </div>`;
  }

  function renderList() {
    const body = $('inviteBody');
    if (!body) return;
    if (!state.list) { body.innerHTML = '<tr><td colspan="5" class="empty-state">Daftar undangan belum dimuat.</td></tr>'; return; }
    if (!state.list.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">Belum ada undangan — undang calon staf lewat tombol <b>＋ Undang staf</b>.</td></tr>';
      return;
    }
    const canRevoke = window.canPerm('staff', 'delete');
    body.innerHTML = state.list.map(inv => {
      const actions = [];
      if (inv.status === 'pending' && canRevoke) {
        actions.push('<button class="staff-act is-del" data-action="invite-revoke:' + esc(String(inv.id)) + '" title="Batalkan undangan ini"><i>✕</i>Batalkan</button>');
      }
      if (!actions.length) actions.push('<span class="hint-inline">—</span>');
      return '<tr' + (inv.status !== 'pending' ? ' class="row-dim"' : '') + '>' +
        '<td><b>' + esc(inv.email || '') + '</b>' + (inv.note ? '<small class="subcell">' + esc(inv.note) + '</small>' : '') + '</td>' +
        '<td><b>' + esc(inv.roleLabel || roleLabelLocal(inv.role)) + '</b></td>' +
        '<td>' + statusCell(inv.status) + '</td>' +
        '<td>' + esc(inv.invitedByName || '—') + '<small class="subcell">' + esc(whenText(inv.createdAt)) + '</small></td>' +
        '<td style="text-align:right"><div class="staff-actions">' + actions.join('') + '</div></td></tr>';
    }).join('');
  }

  async function loadList(force) {
    const u = me();
    if (!u || !window.canPerm('staff', 'read')) return;
    if (state.list && !force) { renderList(); return; }
    if (state.listLoading) return;
    state.listLoading = true;
    try {
      const res = await window.RasaAPI.get('/api/invitations');
      state.list = res.items || [];
      renderList();
    } catch (e) {
      const body = $('inviteBody');
      if (body) body.innerHTML = '<tr><td colspan="5" class="empty-state">Gagal memuat undangan: ' + esc(e.message) + '</td></tr>';
    } finally { state.listLoading = false; }
  }

  function injectInvitePanel() {
    const grid = document.querySelector('.settings-grid');
    if (!grid || document.getElementById('invitePanel')) return;
    const u = me();
    if (!u || !window.canPerm('staff', 'read')) return;
    grid.insertAdjacentHTML('beforeend', panelHtml());
    loadList();
  }

  async function inviteSend(arg, el) {
    if (!window.canPerm('staff', 'create')) { toast('Anda tidak punya izin mengundang staf.'); return; }
    const email = String(($('ivEmail') && $('ivEmail').value || '').trim()).toLowerCase();
    const role = String(($('ivRole') && $('ivRole').value || 'waiter'));
    const note = String(($('ivNote') && $('ivNote').value || '').trim());
    if (!EMAIL_RE.test(email)) { toast('Format email tidak valid.'); if ($('ivEmail')) $('ivEmail').focus(); return; }
    if (el) el.disabled = true;
    try {
      const res = await window.RasaAPI.post('/api/invitations', { email, role, note });
      toast('Undangan dikirim ke ' + email + ' sebagai ' + roleLabelLocal(role) + '.');
      state.formOpen = false;
      const f = $('inviteForm'); if (f) f.hidden = true;
      const i1 = $('ivEmail'); if (i1) i1.value = '';
      const i2 = $('ivNote'); if (i2) i2.value = '';
      void res;
      await loadList(true);
    } catch (e) { toast(e.message); }
    finally { if (el) el.disabled = false; }
  }

  function inviteRevoke(id) {
    if (!window.canPerm('staff', 'delete')) { toast('Anda tidak punya izin membatalkan undangan.'); return; }
    const inv = (state.list || []).find(x => String(x.id) === String(id));
    if (!inv) return;
    openModal('<div class="modal-head"><span class="provider-mark" style="--pm:#b0473a">✕</span><div><b>Batalkan undangan?</b><small>' + esc(inv.email) + ' · ' + esc(inv.roleLabel || roleLabelLocal(inv.role)) + '</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>' +
      '<p class="modal-text">Calon staf tidak lagi melihat undangan ini. Anda tetap bisa mengundang ulang email yang sama kapan saja. Tindakan ini tercatat di audit log.</p>' +
      '<div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-danger" data-action="invite-revoke-confirm:' + esc(String(inv.id)) + '">Batalkan undangan</button></div>');
  }

  async function inviteRevokeConfirm(id) {
    closeModal();
    if (!window.canPerm('staff', 'delete')) { toast('Anda tidak punya izin membatalkan undangan.'); return; }
    try {
      await window.RasaAPI.del('/api/invitations/' + encodeURIComponent(id));
      toast('Undangan dibatalkan.');
      await loadList(true);
    } catch (e) { toast(e.message); }
  }

  /* ============================================================
     2. Sisi calon staf — notifikasi, halaman #undangan, Terima/Tolak
     ============================================================ */
  function inviteModalHtml(inv) {
    const resto = inv.restaurantName || 'Restoran';
    const role = inv.roleLabel || roleLabelLocal(inv.role);
    return '<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">✉</span>' +
      '<div><b>Undangan staf</b><small>' + esc(inv.invitedByName || 'Owner') + ' · ' + esc(resto) + '</small></div>' +
      '<button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>' +
      '<p class="modal-text">Anda telah diundang untuk menjadi Staf di <b>' + esc(resto) + '</b> sebagai <b>' + esc(role) + '</b>.</p>' +
      '<div class="modal-actions" style="justify-content:center">' +
      '<button class="btn btn-danger" data-action="invite-reject:' + esc(String(inv.id)) + '">Tolak</button>' +
      '<button class="btn btn-primary" data-action="invite-accept:' + esc(String(inv.id)) + '">Terima</button></div>' +
      '<small class="modal-note">Menekan <b>Terima</b> menjadikan akun Anda staf ' + esc(resto) + ' dengan peran ' + esc(role) + ' — bila kini tergabung di restoran lain, Anda otomatis keluar dari restoran tersebut. Menekan <b>Tolak</b> menutup undangan tanpa menambahkan keanggotaan apa pun. Undangan ini hanya bisa dijawab oleh alamat email yang diundang.</small>';
  }

  function maybeShowInvite() {
    const s = window.RasaSession;
    if (!s || !s.token || !s.user) return;
    const list = state.mine || [];
    if (!list.length) return;
    const next = list.filter(i => !state.shown[String(i.id)])[0];
    if (!next) return;
    const gate = document.getElementById('authGate');
    if (gate && !gate.hidden) return;                            /* jangan tampil di layar masuk */
    if (document.querySelector('.modal-overlay')) return;        /* hormati modal yang sedang terbuka */
    if (window.RasaRoles && window.RasaRoles.state && window.RasaRoles.state.requested === 'undangan') return;
    state.shown[String(next.id)] = true;
    openModal(inviteModalHtml(next));
  }

  let mineLoading = false;
  async function refreshMine() {
    const s = window.RasaSession;
    if (!s || !s.token || !s.user) { state.mine = null; state.history = null; return; }
    if (mineLoading) return;
    mineLoading = true;
    try {
      const res = await window.RasaAPI.get('/api/invitations/mine');
      state.mine = res.items || [];
      state.history = res.history || [];
      maybeShowInvite();
      try { if (window.RasaInsights && window.RasaInsights.updateBell) window.RasaInsights.updateBell(); } catch (e) {}
      if (typeof currentPage !== 'undefined' && currentPage === 'undangan') window.render('undangan', true);
    } catch (e) { /* diam — dicoba lagi pada pemantau berikutnya */ }
    finally { mineLoading = false; }
  }

  function historyTable(hist) {
    if (!hist || !hist.length) return '';
    const rows = hist.map(inv => '<tr' + ' class="row-dim"' + '>' +
      '<td><b>' + esc(inv.restaurantName || 'Restoran') + '</b></td>' +
      '<td>' + esc(inv.roleLabel || roleLabelLocal(inv.role)) + '</td>' +
      '<td>' + statusCell(inv.status) + '</td>' +
      '<td>' + esc(whenText(inv.respondedAt || inv.createdAt)) + '</td></tr>').join('');
    return '<div class="panel"><div class="panel-head"><div><div class="panel-title">Riwayat tanggapan</div>' +
      '<div class="panel-caption">Undangan yang sudah Anda terima atau tolak — statusnya tersimpan permanen di server</div></div></div>' +
      '<div class="table-wrap"><table class="staff-table"><thead><tr><th>Restoran</th><th>Peran</th><th>Status</th><th>Dijawab</th></tr></thead><tbody>' +
      rows + '</tbody></table></div></div>';
  }

  function myInvitesPage() {
    const s = window.RasaSession;
    if (!s || !s.user) {
      return heading('Undangan staf', 'Undangan keanggotaan restoran untuk alamat email Anda.') +
        '<div class="panel"><div class="empty-state">Masuk dengan akun Gmail yang diundang untuk melihat undangan. Bila akunnya belum ada, undangan tetap tersimpan dan tampil setelah Anda mendaftar dengan email yang sama.</div></div>';
    }
    const mine = state.mine || [];
    const cards = mine.length ? mine.map(inv => {
      const resto = inv.restaurantName || 'Restoran';
      const role = inv.roleLabel || roleLabelLocal(inv.role);
      return '<div class="panel">' +
        '<div class="panel-head"><div><div class="panel-title">Undangan dari ' + esc(resto) + '</div>' +
        '<div class="panel-caption">Diundang oleh ' + esc(inv.invitedByName || 'Owner') + ' · ' + esc(whenText(inv.createdAt)) + (inv.note ? ' · catatan: ' + esc(inv.note) : '') + '</div></div>' +
        statusCell(inv.status) + '</div>' +
        '<p class="modal-text">Anda telah diundang untuk menjadi Staf di <b>' + esc(resto) + '</b> sebagai <b>' + esc(role) + '</b>.</p>' +
        '<div class="btn-row">' +
        '<button class="btn btn-primary" data-action="invite-accept:' + esc(String(inv.id)) + '">Terima</button>' +
        '<button class="btn btn-danger" data-action="invite-reject:' + esc(String(inv.id)) + '">Tolak</button>' +
        '</div>' +
        '<div class="hint">Menekan <b>Terima</b> menjadikan akun Anda staf ' + esc(resto) + ' dengan peran ' + esc(role) + ' — izin mengikuti sistem role yang berlaku. Menekan <b>Tolak</b> menutup undangan tanpa keanggotaan.</div>' +
        '</div>';
    }).join('') : '<div class="panel"><div class="empty-state">Tidak ada undangan yang menunggu jawaban untuk email <b>' + esc(s.user.email || '') + '</b>. Undangan baru akan tampil otomatis di sini dan sebagai notifikasi saat Anda masuk.</div></div>';

    return heading('Undangan staf', 'Undangan keanggotaan restoran untuk alamat email <b>' + esc(s.user.email || '') + '</b> — hanya undangan untuk email ini yang ditampilkan.',
      '<button class="btn" data-action="invite-refresh"><span class="btn-icon">↻</span> Segarkan</button>') +
      cards +
      (state.history === null ? '' : historyTable(state.history));
  }

  async function inviteAccept(id, el) {
    if (el) el.disabled = true;
    try {
      const res = await window.RasaAPI.post('/api/invitations/' + encodeURIComponent(id) + '/accept');
      closeModal();
      /* perbarui sesi lokal dengan identitas & izin baru dari server —
         tanpa perlu login ulang (izin tetap dicek ulang backend tiap request) */
      const s = window.RasaSession;
      if (res.user) s.user = res.user;
      if (res.restaurant) s.restaurant = res.restaurant;
      if (res.permissions) s.permissions = res.permissions;
      state.list = null; state.mine = null; state.history = null;
      const role = res.user ? roleLabelLocal(res.user.role) : 'Staf';
      const resto = (res.restaurant && res.restaurant.name) || 'restoran';
      toast('Undangan diterima — Anda kini staf ' + resto + ' sebagai ' + role + '.');
      try { if (window.RasaAuth && window.RasaAuth.applyAccountUI) window.RasaAuth.applyAccountUI(); } catch (e) {}
      try { window.RasaSync.start(); } catch (e) {}
      refreshMine();
      loadList(true);
    } catch (e) {
      toast(e.message);
      refreshMine();
    } finally { if (el) el.disabled = false; }
  }

  async function inviteReject(id, el) {
    if (el) el.disabled = true;
    try {
      await window.RasaAPI.post('/api/invitations/' + encodeURIComponent(id) + '/reject');
      closeModal();
      toast('Undangan ditolak — tidak ada keanggotaan yang ditambahkan.');
      state.mine = null; state.history = null;
      refreshMine();
    } catch (e) {
      toast(e.message);
      refreshMine();
    } finally { if (el) el.disabled = false; }
  }

  /* ============================================================
     3. Pendaftaran ke registry aplikasi (window.RASA)
     ============================================================ */
  function afterRender(page) {
    if (page === 'settings') injectInvitePanel();
    if (page === 'undangan') {
      if (state.mine === null) refreshMine();
      else maybeShowInvite();
    }
  }

  function hookAuth() {
    const A = window.RasaAuth;
    if (A && !A.__invitesHooked) {
      const orig = A.applyAccountUI;
      A.applyAccountUI = function () {
        try { orig.apply(A, arguments) } catch (e) {}
        try { setTimeout(refreshMine, 600); } catch (e) {}
      };
      A.__invitesHooked = true;
    }
    /* RasaSync.start dipanggil aplikasi SETELAH sesi dipulihkan saat boot
       maupun saat login lewat gerbang OTP — di titik itulah undangan paling
       perlu diperiksa (dan tidak mengandung data sensitif apa pun). */
    const S = window.RasaSync;
    if (S && typeof S.start === 'function' && !S.__invitesHooked) {
      const origStart = S.start;
      S.start = function () {
        const r = origStart.apply(S, arguments);
        try {
          if (r && typeof r.then === 'function') r.then(() => setTimeout(refreshMine, 400), () => {});
          else setTimeout(refreshMine, 1200);
        } catch (e) {}
        return r;
      };
      S.__invitesHooked = true;
    }
  }

  let watching = false;
  function startWatch() {
    if (watching) return;
    watching = true;
    /* pemantau seperti poll izin: undangan baru terlihat tanpa reload */
    setInterval(() => { if (!document.hidden) refreshMine(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMine(); });
    window.addEventListener('focus', () => refreshMine());
  }

  const actions = {
    'invite-form-toggle': () => {
      if (!window.canPerm('staff', 'create')) { toast('Anda tidak punya izin mengundang staf.'); return; }
      state.formOpen = !state.formOpen;
      const f = $('inviteForm');
      if (f) { f.hidden = !state.formOpen; if (state.formOpen && $('ivEmail')) $('ivEmail').focus(); }
    },
    'invite-send': (arg, el) => inviteSend(arg, el),
    'invite-revoke': id => inviteRevoke(id),
    'invite-revoke-confirm': id => inviteRevokeConfirm(id),
    'invite-accept': (id, el) => inviteAccept(id, el),
    'invite-reject': (id, el) => inviteReject(id, el),
    'invite-refresh': () => { refreshMine(); loadList(true); toast('Daftar undangan disegarkan.'); }
  };

  function init() {
    const R = window.RASA;
    R.pages = R.pages || {};
    R.pages.undangan = myInvitesPage;
    R.pageNames = R.pageNames || {};
    R.pageNames.undangan = 'Undangan staf';
    R.actions = R.actions || {};
    Object.keys(actions).forEach(k => { R.actions[k] = actions[k]; });
    R.render = R.render || [];
    R.render.push(afterRender);
    /* undangan yang menunggu jawaban ikut muncul di lonceng & Alert Center */
    R.alertSources = R.alertSources || [];
    R.alertSources.push(function () {
      return (state.mine || []).map(inv => ({
        id: 'invite-' + inv.id,
        level: 'warn',
        module: 'staff',
        page: 'undangan',
        title: 'Undangan staf dari ' + (inv.restaurantName || 'restoran'),
        detail: 'Anda diundang menjadi ' + (inv.roleLabel || roleLabelLocal(inv.role)) + '. Buka untuk menerima atau menolak.',
        actionLabel: 'Lihat undangan'
      }));
    });
    hookAuth();
    startWatch();
  }

  return { init, state, refreshMine, loadList, myInvitesPage };
})();

window.RasaInvites.init();
