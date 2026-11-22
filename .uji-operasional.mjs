/* Uji operasional (API + Chrome headless) terhadap wrangler dev :8790
   1. API : kunci baru (suppliers, purchaseRequests, purchaseOrders, recipeLog,
      inventory expiry/batch, recipes yield/sub) tervalidasi ketat — data
      rusak DITOLAK, data benar DITERIMA.
   2. API : menulis kunci pengadaan butuh izin modul procurement (kasir ditolak).
   3. Chrome: alur nyata Pemasok → PR → setujui → PO → terima barang →
      stok BERTAMBAH hanya setelah penerimaan (bukan saat PO dibuat). */
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.RASA_BASE || 'http://127.0.0.1:8790';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let failed = 0;
const ok = m => console.log('  [OK] ' + m);
const bad = m => { failed++; console.log('  [GAGAL] ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

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
const put = (payload, changed, tok) => call('PUT', '/api/data', { payload, changed }, tok);

console.log('== uji operasional ==');
const health = await call('GET', '/api/health');
check(health.status === 200 && health.data.ok, 'server dev hidup');

const stamp = Date.now();
const owner = await login(`owner.ops${stamp}@rasa.local`, 'register', { name: 'Owner Ops', resto: 'Resto Ops' });
const otok = owner.token;
ok('owner login');
const boot = (await call('GET', '/api/data', null, otok)).data || {};
const seed = boot.payload || {};
const has = (arr, id) => (arr || []).some(x => String(x.id) === id);
const mergeArr = (arr, item) => (has(arr, item.id) ? (arr || []).map(x => String(x.id) === item.id ? item : x) : (arr || []).concat([item]));

/* ---------- 1. validasi ketat kunci baru ---------- */
const state = {
  inventory: (seed.inventory || []).slice(),
  recipes: (seed.recipes || []).slice(),
  suppliers: (seed.suppliers || []).slice(),
  purchaseRequests: (seed.purchaseRequests || []).slice(),
  purchaseOrders: (seed.purchaseOrders || []).slice(),
  recipeLog: (seed.recipeLog || []).slice()
};
const putKey = (key, val) => put({ [key]: val }, [key], otok);
const applied = r => r.data && Array.isArray(r.data.applied) && r.data.applied.length > 0;
const invalidOf = r => (r.data && r.data.invalid || []).map(x => x.reason).join('; ');

const INV = { id: 'inv_uji1', name: 'Beras Uji', cat: 'Bahan dasar', unit: 'kg', stock: 10, min: 2, cost: 14000, expiry: '2027-01-31', batch: 'B-001' };
state.inventory = mergeArr(state.inventory, INV);
let r = await putKey('inventory', state.inventory);
check(applied(r), 'inventory + expiry/batch diterima' + (invalidOf(r) ? ' INVALID:' + invalidOf(r) : ''));

r = await putKey('inventory', state.inventory.concat([Object.assign({}, INV, { id: 'inv_uji2', name: 'Beras Rusak', expiry: '31-01-2027' })]));
check(!applied(r) && r.data && r.data.invalid && r.data.invalid.some(x => x.key === 'inventory'),
  'expiry format rusak DITOLAK: ' + invalidOf(r));

state.recipes = mergeArr(state.recipes, { id: 'rc_uji1', productId: 'p_uji1', yield: 4, items: [{ invId: 'inv_uji1', qty: 0.5, u: 'kg', v: 'Pedas' }] });
r = await putKey('recipes', state.recipes);
check(applied(r), 'recipes (yield + varian) diterima' + (invalidOf(r) ? ' INVALID:' + invalidOf(r) : ''));

r = await putKey('recipes', state.recipes.concat([{ id: 'rc_uji2', productId: 'p_uji2', yield: 0, items: [{ invId: 'inv_uji1', qty: 1 }] }]));
check(!applied(r) && r.data && r.data.invalid && r.data.invalid.some(x => x.key === 'recipes'),
  'yield=0 DITOLAK: ' + invalidOf(r));

state.suppliers = mergeArr(state.suppliers, { id: 'sp_uji1', name: 'Pemasok Uji', phone: '0811', items: [{ invId: 'inv_uji1', price: 13500 }] });
r = await putKey('suppliers', state.suppliers);
check(applied(r), 'suppliers + daftar harga diterima' + (invalidOf(r) ? ' INVALID:' + invalidOf(r) : ''));

r = await putKey('suppliers', state.suppliers.concat([{ id: 'sp_uji2', name: '' }]));
check(!applied(r) && r.data && r.data.invalid && r.data.invalid.some(x => x.key === 'suppliers'),
  'nama pemasok kosong DITOLAK: ' + invalidOf(r));

const PR = { id: 'pr_uji1', no: 'PR-2026-001', date: '2026-11-22', status: 'pending', items: [{ invId: 'inv_uji1', qty: 5, price: 13500 }], by: 'Owner Ops' };
state.purchaseRequests = mergeArr(state.purchaseRequests, PR);
r = await putKey('purchaseRequests', state.purchaseRequests);
check(applied(r), 'purchaseRequests diterima' + (invalidOf(r) ? ' INVALID:' + invalidOf(r) : ''));

r = await putKey('purchaseRequests', state.purchaseRequests.concat([Object.assign({}, PR, { id: 'pr_uji2', items: [] })]));
check(!applied(r) && r.data && r.data.invalid && r.data.invalid.some(x => x.key === 'purchaseRequests'),
  'PR tanpa barang DITOLAK: ' + invalidOf(r));

const PO = {
  id: 'po_uji1', no: 'PO-2026-001', date: '2026-11-22', status: 'draft',
  supplierId: 'sp_uji1', supplierName: 'Pemasok Uji', prId: 'pr_uji1',
  items: [{ invId: 'inv_uji1', name: 'Beras Uji', unit: 'kg', qty: 5, price: 13500, recv: 0, rej: 0 }],
  total: 67500, payments: [], createdBy: 'Owner Ops'
};
state.purchaseOrders = mergeArr(state.purchaseOrders, PO);
r = await putKey('purchaseOrders', state.purchaseOrders);
check(applied(r), 'purchaseOrders diterima' + (invalidOf(r) ? ' INVALID:' + invalidOf(r) : ''));

r = await putKey('purchaseOrders', state.purchaseOrders.concat([Object.assign({}, PO, { id: 'po_uji2', items: [{ invId: 'inv_uji1', qty: -3 }] })]));
check(!applied(r) && r.data && r.data.invalid && r.data.invalid.some(x => x.key === 'purchaseOrders'),
  'qty PO negatif DITOLAK: ' + invalidOf(r));

state.recipeLog = mergeArr(state.recipeLog, { id: 'rl_uji1', productId: 'p_uji1', t: Date.now(), items: [{ invId: 'inv_uji1', qty: 0.5 }], by: 'Owner Ops', note: 'Membuat resep baru' });
r = await putKey('recipeLog', state.recipeLog);
check(applied(r), 'recipeLog diterima' + (invalidOf(r) ? ' INVALID:' + invalidOf(r) : ''));

/* stok TIDAK boleh berubah hanya karena menulis PO (hanya lewat penerimaan) */
let d = (await call('GET', '/api/data', null, otok)).data;
const invBefore = (d.payload.inventory || []).find(x => x.id === 'inv_uji1');
check(invBefore && invBefore.stock === 10,
  'stok tetap 10 setelah PO dibuat (belum diterima) — stok=' + (invBefore && invBefore.stock));

/* ---------- 2. izin modul: kasir TIDAK boleh menulis pengadaan ---------- */
const staff = await call('POST', '/api/staff', { name: 'Kasir Ops', email: `kasir.ops${stamp}@rasa.local`, role: 'kasir' }, otok);
if (!staff.data || !staff.data.ok) { bad('gagal membuat staf kasir: ' + JSON.stringify(staff.data)); }
const klogin = await login(`kasir.ops${stamp}@rasa.local`, 'login');
const ktok = klogin.token;
r = await put({ suppliers: [{ id: 'sp_x', name: 'Pemasok Larangan' }] }, ['suppliers'], ktok);
check(r.data && Array.isArray(r.data.denied) && r.data.denied.some(x => x.key === 'suppliers'),
  'kasir DITOLAK menulis suppliers: ' + JSON.stringify(r.data && r.data.denied));
r = await put({ purchaseOrders: [Object.assign({}, PO, { id: 'po_x' })] }, ['purchaseOrders'], ktok);
check(r.data && Array.isArray(r.data.denied) && r.data.denied.some(x => x.key === 'purchaseOrders'),
  'kasir DITOLAK menulis purchaseOrders: ' + JSON.stringify(r.data && r.data.denied));

/* ---------- 3. Chrome headless: alur pengadaan nyata ---------- */
console.log('-- alur Chrome: pemasok → PR → PO → penerimaan → stok --');
const TOKEN = otok;
const page = `<!doctype html><html lang="id"><meta charset="utf-8"><title>uji operasional</title>
<style>body{font:13px sans-serif;padding:10px}#out{white-space:pre-wrap}</style>
<pre id="out">pending</pre>
<script>
var TOKEN=${JSON.stringify(TOKEN)}, INV_ID='inv_uji1', R={}, step=0, n=0;
try{localStorage.setItem('restaurant-os:session',TOKEN);}catch(e){}
var f=document.createElement('iframe');
f.style.cssText='position:fixed;left:-5000px;top:0;width:1440px;height:900px';
f.src='/#procurement';
document.body.appendChild(f);
function done(o){ clearInterval(iv); document.getElementById('out').textContent='RESULT:'+JSON.stringify(o); }
function q(d,s){return d.querySelector(s)}
function all(d,s){return Array.prototype.slice.call(d.querySelectorAll(s))}
function txt(d,s){var e=q(d,s);return e?(e.textContent||'').trim():''}
function click(d,sel){var e=q(d,sel);if(!e)return false;e.click();return true}
function setVal(el,v){ if(!el)return false; el.value=v;
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true})); return true }
function toast(d){var t=q(d,'#toast');return t?(t.textContent||''):''}
function gotoPage(d,p){var b=all(d,'[data-page="'+p+'"]')[0];if(!b)return false;b.click();return true}
var iv=setInterval(function(){
  n++;
  var d=null; try{d=f.contentDocument}catch(e){}
  if(!d){ if(n>300) done({error:'iframe tidak bisa dibuka',n:n}); return; }
  if(step===0){
    /* halaman Pengadaan harus memuat (bukan placeholder lama) */
    var head=txt(d,'.page-heading h1');
    if(head!=='Pengadaan bahan baku'){ if(n>300) done({error:'halaman Pengadaan tidak tampil',head:head,n:n}); return; }
    R.heading=head;
    R.noFakePo = d.body.textContent.indexOf('PO-2026-091')<0;
    /* buat pemasok lewat tab Pemasok */
    var tab=all(d,'[data-action^="proc-tab:"]').filter(function(b){return b.getAttribute('data-action')==='proc-tab:supplier'})[0];
    if(!tab){ if(n>300) done({error:'tab pemasok tidak ada',R:R}); return; }
    tab.click(); step=1; return;
  }
  if(step===1){
    if(!click(d,'[data-action="sup-new"]')){ if(n>400) done({error:'tombol Tambah pemasok tidak ada',R:R}); return; }
    step=2; return;
  }
  if(step===2){
    var nm=q(d,'#supName');
    if(!nm){ if(n>400) done({error:'modal pemasok tidak terbuka',R:R,toast:toast(d)}); return; }
    setVal(nm,'Pemasok Uji Chrome');
    /* satu baris harga */
    if(!q(d,'[data-sup-price="0"]')&&q(d,'[data-action="sup-line-add"]')) q(d,'[data-action="sup-line-add"]').click();
    var sel=q(d,'[data-sup-inv="0"]');
    if(sel){ setVal(sel,INV_ID); }
    var pin=q(d,'[data-sup-price="0"]'); if(pin) setVal(pin,'13000');
    if(!click(d,'[data-action="sup-save"]')){ done({error:'tombol simpan pemasok tidak ada'}); return; }
    R.supToast=toast(d); step=3; return;
  }
  if(step===3){
    var body=d.body.textContent;
    if(body.indexOf('Pemasok Uji Chrome')>=0){ R.supSaved=true; step=4; return; }
    if(n>500){ R.supToast=toast(d); done({error:'pemasok tidak tersimpan',R:R}); return; }
    return;
  }
  if(step===4){
    /* catat stok awal dari halaman Persediaan */
    if(!gotoPage(d,'inventory')){ if(n>600) done({error:'navigasi Persediaan gagal',R:R}); return; }
    step=5; return;
  }
  if(step===5){
    var h=txt(d,'.page-heading h1');
    if(h!=='Persediaan bahan baku'){ if(n>700) done({error:'halaman Persediaan tidak tampil',h:h}); return; }
    var row=all(d,'tbody tr').filter(function(tr){return tr.getAttribute('data-hay')===null && tr.textContent.indexOf('Beras Uji')>=0})[0]
           || all(d,'tbody tr').filter(function(tr){return tr.textContent.indexOf('Beras Uji')>=0})[0];
    if(!row){ if(n>700) done({error:'baris bahan uji tidak ada di Persediaan',R:R}); return; }
    R.stockBefore=(row.children[2].textContent||'').trim();
    /* buat PR dari halaman Pengadaan */
    if(!gotoPage(d,'procurement')){ done({error:'navigasi Pengadaan gagal'}); return; }
    step=6; return;
  }
  if(step===6){
    var h2=txt(d,'.page-heading h1');
    if(h2!=='Pengadaan bahan baku'){ if(n>900) done({error:'kembali ke Pengadaan gagal',h:h2}); return; }
    if(!click(d,'[data-action="pr-new"]')){ if(n>900) done({error:'tombol PR baru tidak ada',R:R}); return; }
    step=7; return;
  }
  if(step===7){
    var sel2=q(d,'[data-doc-inv="0"]');
    if(!sel2){ if(n>1000) done({error:'modal PR tidak terbuka',R:R,toast:toast(d)}); return; }
    setVal(sel2,INV_ID);
    setVal(q(d,'[data-doc-qty="0"]'),'5');
    setVal(q(d,'[data-doc-price="0"]'),'13500');
    if(!click(d,'[data-action="doc-save"]')){ done({error:'tombol simpan PR tidak ada'}); return; }
    R.prToast=toast(d); step=8; return;
  }
  if(step===8){
    var b8=d.body.textContent;
    if(b8.indexOf('PR-2026')>=0&&b8.indexOf('Menunggu persetujuan')>=0){ R.prCreated=true; step=9; return; }
    if(n>1200){ R.prToast=toast(d); done({error:'PR tidak muncul',R:R}); return; }
    return;
  }
  if(step===9){
    /* setujui PR lalu jadikan PO */
    if(!click(d,'[data-action^="pr-approve:"]')){ if(n>1300) done({error:'tombol setujui PR tidak ada',R:R}); return; }
    step=10; return;
  }
  if(step===10){
    if(!click(d,'[data-action^="pr-po:"]')){ if(n>1400) done({error:'tombol Buat PO tidak ada',R:R,toast:toast(d)}); return; }
    R.poToast=toast(d); step=11; return;
  }
  if(step===11){
    var b11=d.body.textContent;
    if(b11.indexOf('PO-2026')>=0){ R.poCreated=true;
      /* stok BELUM boleh berubah: cek Persediaan dulu */
      if(!gotoPage(d,'inventory')){ done({error:'navigasi Persediaan (cek PO) gagal'}); return; }
      step=12; return; }
    if(n>1500){ done({error:'PO tidak muncul',R:R,toast:toast(d)}); return; }
    return;
  }
  if(step===12){
    var h3=txt(d,'.page-heading h1');
    if(h3!=='Persediaan bahan baku'){ if(n>1700) done({error:'buka Persediaan gagal',h:h3}); return; }
    var row2=all(d,'tbody tr').filter(function(tr){return tr.textContent.indexOf('Beras Uji')>=0})[0];
    R.stockAfterPo=(row2&&row2.children[2].textContent||'').trim();
    R.stockUnchangedAfterPo = R.stockAfterPo===R.stockBefore;
    if(!gotoPage(d,'procurement')){ done({error:'kembali ke Pengadaan gagal'}); return; }
    step=13; return;
  }
  if(step===13){
    var h4=txt(d,'.page-heading h1');
    if(h4!=='Pengadaan bahan baku'){ if(n>1900) done({error:'kembali Pengadaan gagal',h:h4}); return; }
    if(!click(d,'[data-action^="po-open:"]')){ if(n>1900) done({error:'tombol Detail PO tidak ada',R:R}); return; }
    step=14; return;
  }
  if(step===14){
    if(!q(d,'[data-recv="0"]')){ if(n>2000) done({error:'modal detail PO tidak terbuka',R:R,toast:toast(d)}); return; }
    /* approve & kirim dulu bila masih draft */
    if(click(d,'[data-action^="po-send:"]')){ R.sent=true; }
    step=15; return;
  }
  if(step===15){
    var rin=q(d,'[data-recv="0"]');
    if(!rin||rin.disabled){ if(n>2100) done({error:'input penerimaan tidak aktif',R:R,toast:toast(d)}); return; }
    setVal(rin,'5');
    if(!click(d,'[data-action^="po-recv:"]')){ done({error:'tombol simpan penerimaan tidak ada'}); return; }
    R.recvToast=toast(d); step=16; return;
  }
  if(step===16){
    var t=toast(d);
    if(/menambah stok|masuk stok|Penerimaan tersimpan/.test(t)){ R.recvSaved=true; R.recvToast=t; step=17; return; }
    if(n>2300){ R.recvToast=t; done({error:'penerimaan tidak tersimpan',R:R}); return; }
    return;
  }
  if(step===17){
    if(!gotoPage(d,'inventory')){ done({error:'navigasi Persediaan (akhir) gagal'}); return; }
    step=18; return;
  }
  if(step===18){
    var h5=txt(d,'.page-heading h1');
    if(h5!=='Persediaan bahan baku'){ if(n>2500) done({error:'Persediaan gagal dibuka',h:h5}); return; }
    var row3=all(d,'tbody tr').filter(function(tr){return tr.textContent.indexOf('Beras Uji')>=0})[0];
    R.stockAfterRecv=(row3&&row3.children[2].textContent||'').trim();
    R.logCell=row3?(row3.children[2].textContent||'').trim():'';
    /* halaman Keuangan & Laporan juga harus render (tanpa data contoh) */
    if(!gotoPage(d,'finance')){ done({error:'navigasi Keuangan gagal',R:R}); return; }
    step=19; return;
  }
  if(step===19){
    var h6=txt(d,'.page-heading h1');
    if(h6!=='Keuangan & akuntansi'){ if(n>2700) done({error:'halaman Keuangan gagal',h:h6,R:R}); return; }
    R.finHeading=h6;
    var fh=q(d,'.page-heading h1'); R.finHtml=fh?fh.innerHTML:'';
    R.finNoFake = d.body.textContent.indexOf('184,6')<0;
    R.finHasDebt = d.body.textContent.indexOf('Utang pemasok')>=0;
    R.finHasKas = d.body.textContent.indexOf('Kas')>=0;
    if(!gotoPage(d,'reports')){ done({error:'navigasi Laporan gagal',R:R}); return; }
    step=20; return;
  }
  if(step===20){
    var h7=txt(d,'.page-heading h1');
    if(h7!=='Laporan'){ if(n>2900) done({error:'halaman Laporan gagal',h:h7,R:R}); return; }
    R.repHeading=h7;
    R.repNoFake = d.body.textContent.indexOf('184,6 jt')<0 && d.body.textContent.indexOf('1.284 order')<0;
    R.repHasChips = all(d,'[data-action^="rep-type:"]').length;
    /* tukar jenis laporan: Persediaan harus ikut render */
    var chip=all(d,'[data-action="rep-type:inventory"]')[0];
    if(chip){ chip.click(); step=21; return; }
    done({error:'chip jenis laporan tidak ada',R:R});
    return;
  }
  if(step===21){
    R.repInvRendered = d.body.textContent.indexOf('Mutasi per bahan')>=0;
    var fchip=all(d,'[data-action="rep-type:finance"]')[0];
    if(fchip){ fchip.click(); step=22; return; }
    done({error:'chip laporan keuangan tidak ada',R:R});
    return;
  }
  if(step===22){
    R.repFinRendered = d.body.textContent.indexOf('Buku besar periode')>=0;
    done(R);
    return;
  }
},200);
</script>`;

const file = join(process.cwd(), 'test-uji-operasional.html');
writeFileSync(file, page, 'utf8');
const prof = mkdtempSync(join(tmpdir(), 'ops-'));
let dom = '';
try {
  dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--user-data-dir=' + prof, '--virtual-time-budget=90000', '--dump-dom', base + '/test-uji-operasional.html'
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
} catch (e) {
  console.log('Chrome gagal: ' + String(e.message).slice(0, 400));
}
try { rmSync(file, { force: true }) } catch (e) {}
try { rmSync(prof, { recursive: true, force: true }) } catch (e) {}

const m = /RESULT:([\s\S]*?)<\/pre>/.exec(dom);
/* --dump-dom meng-escape isi <pre> (mis. & -> &amp;); kembalikan ke teks asli
   sebelum di-parse sebagai JSON. */
const unesc = s => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
if (!m) { bad('tidak ada hasil dari halaman uji (DOM ' + dom.length + ' char)'); console.log(dom.slice(0, 600)); }
else {
  let R = null;
  try { R = JSON.parse(unesc(m[1]).trim()) } catch (e) { bad('hasil bukan JSON: ' + unesc(m[1]).slice(0, 600)) }
  if (R) {
    if (R.error) bad('error alur: ' + R.error);
    check(R.heading === 'Pengadaan bahan baku', 'halaman Pengadaan render: ' + R.heading);
    check(R.noFakePo === true, 'data contoh PO palsu sudah tidak ada');
    check(R.supSaved === true, 'pemasok tersimpan via UI: ' + (R.supToast || ''));
    check(R.stockBefore != null, 'stok awal terbaca: ' + R.stockBefore);
    check(R.prCreated === true, 'PR dibuat & menunggu persetujuan: ' + (R.prToast || ''));
    check(R.poCreated === true, 'PO dibuat dari PR: ' + (R.poToast || ''));
    check(R.stockUnchangedAfterPo === true,
      'stok BELUM berubah setelah PO dibuat (' + R.stockBefore + ' -> ' + R.stockAfterPo + ')');
    check(R.recvSaved === true, 'penerimaan tersimpan: ' + (R.recvToast || ''));
    const firstNum = s => { const m = /-?[\d.]+(?:,\d+)?/.exec(String(s || '')); return m ? parseFloat(m[0].replace(/\./g, '').replace(',', '.')) : NaN };
    const nb = firstNum(R.stockBefore);
    const na = firstNum(R.stockAfterRecv);
    check(isFinite(na) && isFinite(nb) && Math.abs((na - nb) - 5) < 1e-6,
      'stok BERTAMBAH 5 setelah penerimaan (' + R.stockBefore + ' -> ' + R.stockAfterRecv + ')');
    check(R.finHeading === 'Keuangan & akuntansi', 'halaman Keuangan render: ' + R.finHeading + ' | html=' + (R.finHtml || ''));
    check(R.finNoFake === true, 'Keuangan bebas angka contoh statis');
    check(R.finHasDebt === true, 'panel Utang pemasok tampil di Keuangan');
    check(R.finHasKas === true, 'kartu Kas/Bank tampil di Keuangan');
    check(R.repHeading === 'Laporan', 'halaman Laporan render: ' + R.repHeading);
    check(R.repNoFake === true, 'Laporan bebas angka contoh statis');
    check(R.repHasChips >= 5, '5 jenis laporan tersedia (' + R.repHasChips + ' chip)');
    check(R.repInvRendered === true, 'laporan Persediaan render "Mutasi per bahan"');
    check(R.repFinRendered === true, 'laporan Keuangan render "Buku besar periode"');
  }
}

console.log(failed ? '== GAGAL: ' + failed + ' pemeriksaan ==' : '== SEMUA LULUS ==');
process.exit(failed ? 1 : 0);
