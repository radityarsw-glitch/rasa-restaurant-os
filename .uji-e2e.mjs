/* Uji end-to-end API: nonaktifkan staf, simpan profil pribadi, modul Settings
   selalu terbuka. Jalankan terhadap `wrangler dev` (OTP_SCREEN_FALLBACK=1). */
const base = process.env.RASA_BASE || 'http://127.0.0.1:8790';
let failed = 0;
const ok = m => console.log('  [OK] ' + m);
const bad = m => { failed++; console.log('  [GAGAL] ' + m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

async function call(method, path, body, tok) {
  const h = { 'content-type': 'application/json' };
  if (tok) h.authorization = 'Bearer ' + tok;
  const r = await fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json() } catch (e) { data = null }
  return { status: r.status, data };
}

async function login(email, purpose, extra) {
  const r = await call('POST', '/api/auth/request', Object.assign({ email, purpose }, extra || {}));
  if (!r.data || !r.data.otp) throw new Error('OTP tidak tersedia: ' + JSON.stringify(r.data));
  const v = await call('POST', '/api/auth/verify', { email, code: r.data.otp });
  if (!v.data || !v.data.token) throw new Error('verify gagal: ' + JSON.stringify(v.data));
  return v.data;
}

const stamp = Date.now();
const ownerMail = `owner.e2e${stamp}@rasa.local`;
const staffMail = `staf.e2e${stamp}@rasa.local`;

console.log('== uji e2e (API) ==');
const health = await call('GET', '/api/health');
check(health.status === 200 && health.data.ok, 'server dev hidup');

/* --- 1. owner login + tambah staf --- */
const owner = await login(ownerMail, 'register', { name: 'Owner E2E', resto: 'Resto E2E' });
const otok = owner.token;
ok('owner login');
const created = await call('POST', '/api/staff', { name: 'Staf E2E', email: staffMail, role: 'waiter' }, otok);
check(created.status === 200 && created.data.ok, 'staf ditambahkan');
const staffId = created.data.user.id;

/* --- 2. staf masih aktif: bisa masuk --- */
const staff0 = await login(staffMail, 'login');
const stok0 = staff0.token;
const prof0 = await call('GET', '/api/profile', null, stok0);
check(prof0.status === 200, 'staf aktif: GET /api/profile bisa dibuka');

/* --- 3. NONAKTIFKAN staf --- */
const before = (await call('GET', '/api/staff', null, otok)).data.counts;
const deact = await call('PUT', '/api/staff/' + staffId, { status: 'inactive' }, otok);
check(deact.status === 200 && deact.data.ok, 'PUT status=inactive diterima (' + JSON.stringify(deact.data && deact.data.changes) + ')');
const list1 = await call('GET', '/api/staff', null, otok);
const row1 = (list1.data.items || []).find(u => u.id === staffId);
check(list1.data.counts.inactive === before.inactive + 1, 'hitung tab Akun Nonaktif naik ' + before.inactive + ' -> ' + list1.data.counts.inactive);
check(row1 && row1.status === 'inactive', 'staf berpindah ke status inactive');
check(row1 && row1.deactivatedAt > 0, 'waktu penonaktifkan tersimpan (' + (row1 && row1.deactivatedAt) + ')');

/* seluruh sesi staf dicabut -> token lama langsung 401 */
const afterDeact = await call('GET', '/api/profile', null, stok0);
check(afterDeact.status === 401, 'sesi staf dicabut saat nonaktif (status ' + afterDeact.status + ')');
/* login ulang ditolak selama masih nonaktif */
const reloginBlocked = await (async () => {
  try { return await login(staffMail, 'login') } catch (e) { return { denied: true } }
})();
check(reloginBlocked.denied === true || reloginBlocked.status === 403, 'login ulang staf nonaktif ditolak');

/* --- 4. AKTIFKAN kembali --- */
const react = await call('PUT', '/api/staff/' + staffId, { status: 'active' }, otok);
check(react.status === 200 && react.data.ok, 'staf diaktifkan kembali');
const list2 = await call('GET', '/api/staff', null, otok);
check(list2.data.counts.inactive === before.inactive && list2.data.counts.active === before.active,
  'kembali persis ke kondisi awal: aktif=' + list2.data.counts.active + ' nonaktif=' + list2.data.counts.inactive);

/* --- 5. PROFIL PRIBADI tersimpan --- */
const staff1 = await login(staffMail, 'login');
const stok = staff1.token;
const save = await call('PUT', '/api/profile', { name: 'Nama Baru Staf', phone: '0812-3456-7890' }, stok);
check(save.status === 200 && save.data.ok, 'PUT /api/profile diterima');
const profAfter = await call('GET', '/api/profile', null, stok);
check(profAfter.data.profile.name === 'Nama Baru Staf', 'nama tersimpan: ' + profAfter.data.profile.name);
check(profAfter.data.profile.phone === '0812-3456-7890', 'telepon tersimpan: ' + profAfter.data.profile.phone);
const meStaff = await call('GET', '/api/auth/me', null, stok);
check(meStaff.data.user.name === 'Nama Baru Staf', 'sesi ikut terbarui: ' + meStaff.data.user.name);

/* --- 6. modul Settings SELALU terbuka (meski owner mencabutnya) --- */
const permsRes = await call('GET', '/api/permissions', null, otok);
check(permsRes.status === 200, 'GET /api/permissions bisa dibuka');
const effBefore = (meStaff.data.permissions || {}).settings;
check(Array.isArray(effBefore) && effBefore.indexOf('read') >= 0, 'settings read untuk staf: ' + JSON.stringify(effBefore));
/* owner mencabut SEMUA wewenang staf (termasuk settings) */
const eff = {};
Object.keys(permsRes.data.matrix.waiter || {}).forEach(m => { eff[m] = []; });
const put = await call('PUT', '/api/permissions', { users: { [staffId]: eff } }, otok);
check(put.status === 200, 'owner menyimpan wewenang (semua dicabut)');
const meAfter = await call('GET', '/api/auth/me', null, stok);
const settingsAfter = (meAfter.data.permissions || {}).settings;
check(Array.isArray(settingsAfter) && settingsAfter.indexOf('read') >= 0, 'settings TETAP terbuka setelah dicabut: ' + JSON.stringify(settingsAfter));
/* modul lain benar-benar tercabut oleh wewenang khusus staf */
check(!meAfter.data.permissions.orders || meAfter.data.permissions.orders.length === 0, 'modul lain benar-benar tercabut: ' + JSON.stringify(meAfter.data.permissions.orders));
const profAgain = await call('GET', '/api/profile', null, stok);
check(profAgain.status === 200, 'profil tetap bisa dibuka setelah wewenang dicabut');

console.log('');
console.log(failed === 0 ? 'HASIL: SEMUA LULUS' : 'HASIL: ' + failed + ' GAGAL');
process.exit(failed === 0 ? 0 : 1);
