/* ============================================================
   RASA Restaurant OS — sistem role, modul, aksi, dan permission
   Dipakai backend untuk memvalidasi setiap baca/tulis data dan
   dipakai frontend untuk menyembunyikan menu yang tidak berhak.
   ============================================================ */

export const ROLES = [
  { id: 'owner',   name: 'Owner',   desc: 'Kontrol penuh atas bisnis, keuangan, dan konfigurasi' },
  { id: 'manager', name: 'Manager', desc: 'Operasional restoran, staf, stok, dan laporan' },
  { id: 'kasir',   name: 'Kasir',   desc: 'POS, pembayaran, struk, dan riwayat transaksi' },
  { id: 'kitchen', name: 'Kitchen', desc: 'Kitchen display, status masakan, dan stok bahan' },
  { id: 'waiter',  name: 'Waiter',  desc: 'Meja, order tamu, request, dan reservasi' }
];

export const roleLabel = id => (ROLES.find(r => r.id === id) || {}).name || String(id || '');

export const ACTIONS = ['read', 'create', 'update', 'delete', 'approve', 'export'];

/* Modul beserta label dan section payload yang diwakilinya. */
export const MODULES = [
  { id: 'overview',    label: 'Ringkasan',        sections: [] },
  { id: 'pos',         label: 'POS / Kasir',      sections: ['cart', 'pos'] },
  { id: 'orders',      label: 'Pesanan',          sections: ['orders', 'archive'] },
  { id: 'kitchen',     label: 'Kitchen Display',  sections: ['kitchen'] },
  { id: 'antar',       label: 'Antar Ke Meja',    sections: [] },
  { id: 'clear-table', label: 'Kosongkan Meja',    sections: [] },
  { id: 'tables',      label: 'Meja',             sections: ['tables'] },
  { id: 'reservations',label: 'Reservasi',        sections: ['reservations'] },
  { id: 'menu',        label: 'Menu & produk',    sections: ['products'] },
  { id: 'inventory',   label: 'Persediaan',       sections: ['inventory'] },
  { id: 'recipes',     label: 'Resep / BOM',      sections: ['recipes'] },
  { id: 'procurement', label: 'Pengadaan',        sections: ['suppliers', 'purchaseOrders'] },
  { id: 'staff',       label: 'Staf',             sections: ['staff'] },
  { id: 'shifts',      label: 'Shift',            sections: ['shifts'] },
  { id: 'customers',   label: 'Pelanggan',        sections: ['customers'] },
  { id: 'finance',     label: 'Keuangan',         sections: ['finance'] },
  { id: 'accounting',  label: 'Accounting',       sections: ['accounting', 'journal', 'ledger'] },
  { id: 'reports',     label: 'Laporan',          sections: ['reports'] },
  { id: 'analytics',   label: 'Analytics',        sections: ['analytics'] },
  { id: 'alerts',      label: 'Alert Center',     sections: ['alerts'] },
  { id: 'audit',       label: 'Audit log',        sections: ['audit'] },
  { id: 'settings',    label: 'Pengaturan',       sections: ['settings'] },
  { id: 'permissions', label: 'Permission',       sections: ['permissions'] }
];

const SECTION_TO_MODULE = {};
MODULES.forEach(m => m.sections.forEach(s => { SECTION_TO_MODULE[s] = m.id; }));

/* Key payload lama (aplikasi localStorage) yang harus dipetakan ke modul. */
const KEY_TO_MODULE = Object.assign({}, SECTION_TO_MODULE, {
  restaurantName: 'settings', restaurantLocation: 'settings', restaurantId: 'settings',
  brandName: 'settings', ownerName: 'settings', ownerRole: 'settings', avatar: 'settings',
  logo: 'settings', theme: 'settings', isOpen: 'settings', accounts: 'settings',
  lat: 'settings', lng: 'settings', profile: 'settings', identity: 'settings',
  outlet: 'settings', outlets: 'settings', tables: 'tables',
  orders: 'orders', archive: 'orders', products: 'menu', reservations: 'reservations',
  cart: 'pos', inventory: 'inventory', stock: 'inventory', recipes: 'recipes',
  bom: 'recipes', suppliers: 'procurement', purchaseOrders: 'procurement',
  staff: 'staff', shifts: 'shifts', customers: 'customers',
  finance: 'finance', accounting: 'accounting', journal: 'accounting', ledger: 'accounting',
  reports: 'reports', analytics: 'analytics', alerts: 'alerts', audit: 'audit',
  permissions: 'permissions', kitchen: 'kitchen'
});

/* Key yang tidak dikenal dianggap milik modul 'misc' (boleh dibaca/ditulis semua
   role) — semua key sensitif sudah terdaftar di atas, jadi tidak ada jalan pintas. */
export function moduleOfKey(key) {
  return KEY_TO_MODULE[key] || 'misc';
}

export function sectionKeysOf(moduleId) {
  const m = MODULES.find(x => x.id === moduleId);
  return m ? m.sections.slice() : [];
}

/* ---------- Matriks bawaan per role ---------- */
const ALL = ['read', 'create', 'update', 'delete', 'approve', 'export'];

const M = (read, extra) => {
  const list = read ? ['read'] : [];
  (extra || []).forEach(a => { if (list.indexOf(a) < 0) list.push(a) });
  return list;
};

export const DEFAULT_MATRIX = {
  owner: null, /* owner selalu memiliki akses penuh */
  manager: {
    overview:    M(true, ['export']),
    pos:         M(true, ['create', 'update']),
    orders:      M(true, ['create', 'update', 'delete', 'approve']),
    kitchen:     M(true, ['update']),
    antar:       M(true, ['update']),
    'clear-table': M(true, ['update']),
    tables:      M(true, ['create', 'update', 'delete']),
    reservations:M(true, ['create', 'update', 'delete', 'approve']),
    menu:        M(true, ['create', 'update', 'delete']),
    inventory:   M(true, ['create', 'update', 'delete']),
    recipes:     M(true, ['create', 'update']),
    procurement: M(true, ['create', 'update', 'approve']),
    staff:       M(true, ['create', 'update']),
    shifts:      M(true, ['create', 'update']),
    customers:   M(true, ['create', 'update']),
    finance:     M(true),
    accounting:  M(true),
    reports:     M(true, ['export']),
    analytics:   M(true),
    alerts:      M(true, ['update']),
    audit:       M(true),
    settings:    M(true, ['update']),
    permissions: M(true)
  },
  kasir: {
    overview:    M(true),
    pos:         M(true, ['create', 'update']),
    orders:      M(true, ['create', 'update']),
    kitchen:     M(true),
    antar:       M(true, ['update']),
    'clear-table': M(true, ['update']),
    tables:      M(true, ['update']),
    reservations:M(true, ['create']),
    menu:        M(true),
    inventory:   M(false),
    recipes:     M(false),
    procurement: M(false),
    staff:       M(false),
    shifts:      M(true),
    customers:   M(true, ['create', 'update']),
    finance:     M(false),
    accounting:  M(false),
    reports:     M(false),
    analytics:   M(false),
    alerts:      M(true),
    audit:       M(false),
    settings:    M(true),
    permissions: M(false)
  },
  kitchen: {
    overview:    M(true),
    pos:         M(false),
    orders:      M(true, ['update']),
    kitchen:     M(true, ['update']),
    antar:       M(true, ['update']),
    'clear-table': M(true, ['update']),
    tables:      M(true),
    reservations:M(true),
    menu:        M(true),
    inventory:   M(true),
    recipes:     M(true),
    procurement: M(false),
    staff:       M(false),
    shifts:      M(true),
    customers:   M(true),
    finance:     M(false),
    accounting:  M(false),
    reports:     M(false),
    analytics:   M(false),
    alerts:      M(true),
    audit:       M(false),
    settings:    M(true),
    permissions: M(false)
  },
  waiter: {
    overview:    M(true),
    pos:         M(false),
    orders:      M(true, ['create', 'update']),
    kitchen:     M(true),
    antar:       M(true, ['update']),
    'clear-table': M(true, ['update']),
    tables:      M(true, ['update']),
    reservations:M(true, ['create', 'update']),
    menu:        M(true),
    inventory:   M(false),
    recipes:     M(false),
    procurement: M(false),
    staff:       M(false),
    shifts:      M(true),
    customers:   M(true, ['update']),
    finance:     M(false),
    accounting:  M(false),
    reports:     M(false),
    analytics:   M(false),
    alerts:      M(true),
    audit:       M(false),
    settings:    M(true),
    permissions: M(false)
  }
};

/* Bentuk matriks siap dikirim ke klien: { module: [aksi] } */
export function matrixFor(role, storedRows) {
  if (role === 'owner') {
    const full = {};
    MODULES.forEach(m => { full[m.id] = ALL.slice() });
    full.overview = ['read', 'export'];
    return full;
  }
  const base = DEFAULT_MATRIX[role] || {};
  const out = {};
  MODULES.forEach(m => { out[m.id] = (base[m.id] || []).slice() });
  if (Array.isArray(storedRows)) {
    storedRows.forEach(row => {
      if (!row || row.role !== role) return;
      const mod = row.module === '*' ? null : row.module;
      const acts = safeActions(row.actions);
      if (!mod) return;
      out[mod] = acts;
    });
  }
  return out;
}

function safeActions(raw) {
  let list = raw;
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch (e) { list = [] } }
  if (!Array.isArray(list)) return [];
  return list.filter(a => ACTIONS.indexOf(a) >= 0);
}

/* Simpan matriks hasil edit owner ke bentuk baris role_perms */
export function matrixToRows(role, matrix) {
  const rows = [];
  Object.keys(matrix || {}).forEach(mod => {
    if (!MODULES.some(m => m.id === mod)) return;
    const acts = (Array.isArray(matrix[mod]) ? matrix[mod] : []).filter(a => ACTIONS.indexOf(a) >= 0);
    rows.push({ role, module: mod, outlet_id: '*', actions: JSON.stringify(acts) });
  });
  return rows;
}

/* ---------- Wewenang khusus per staf (tabel user_perms) ----------
   Owner bisa mencabut / menambah wewenang satu staf tanpa mengubah
   matriks role. Baris ini menimpa matriks role untuk staf tersebut. */
export function applyUserOverrides(perms, rows) {
  if (!Array.isArray(rows) || !rows.length) return perms || {};
  const out = Object.assign({}, perms || {});
  rows.forEach(row => {
    if (!row || !MODULES.some(m => m.id === row.module)) return;
    out[row.module] = safeActions(row.actions);
  });
  return out;
}

/* Bentuk { module: [aksi] } -> baris user_perms siap simpan */
export function userPermsToRows(userId, map) {
  const rows = [];
  Object.keys(map || {}).forEach(mod => {
    if (!MODULES.some(m => m.id === mod)) return;
    const acts = (Array.isArray(map[mod]) ? map[mod] : []).filter(a => ACTIONS.indexOf(a) >= 0);
    rows.push({ userId, module: mod, actions: JSON.stringify(acts) });
  });
  return rows;
}

/* Matriks per staf -> { module: [aksi] } yang efektif berbeda dari role */
export function diffFromRole(roleMatrix, map) {
  const out = {};
  Object.keys(map || {}).forEach(mod => {
    if (!MODULES.some(m => m.id === mod)) return;
    const acts = (Array.isArray(map[mod]) ? map[mod] : []).filter(a => ACTIONS.indexOf(a) >= 0);
    const base = (roleMatrix && Array.isArray(roleMatrix[mod])) ? roleMatrix[mod] : [];
    const same = acts.length === base.length && acts.every(a => base.indexOf(a) >= 0);
    if (!same) out[mod] = acts;
  });
  return out;
}

/* Pemeriksaan izin tunggal.
   perms = { module: [aksi] } hasil matrixFor()
   outlet = outlet aktif pengguna (default '*') */
export function can(perms, module, action, outlet) {
  if (!perms) return false;
  if (module === 'misc') return true;
  const list = perms[module];
  if (!list) return false;
  if (list.indexOf('*') >= 0) return true;
  return list.indexOf(action) >= 0;
}

/* Modul yang boleh dibaca oleh role ini (untuk menyaring GET /api/data) */
export function readableModules(perms) {
  return MODULES.filter(m => can(perms, m.id, 'read')).map(m => m.id);
}
