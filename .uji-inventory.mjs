/* Uji modul Persediaan (API + Chrome headless) terhadap wrangler dev :8790
   1. API : data awal (beras 10 kg, ayam 2 kg min 5 kg, bumbu 3 kg, sayur 2 kg,
      minyak 5 liter) diterima; stok negatif DITOLAK; log dengan qty negatif
      diterima; kasir DITOLAK menulis persediaan.
   2. Chrome : status "Rendah" pada ayam + peringatan otomatis di Alert Center,
      konversi satuan liter → ml (angka & harga ikut, nilai persediaan tetap),
      penyesuaian stok keluar + pencegahan stok negatif, parsing desimal form,
      stock opname, riwayat stok (sebelum → sesudah, pelaku, catatan),
      pembayaran POS memotong stok sesuai resep dengan tanda minus,
      kebijakan stok tidak negatif saat stok kurang, dan pemotongan ganda. */
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
const num = s => { if (typeof s === 'number') return isFinite(s) ? s : NaN; const m = /-?[\d.,]+/.exec(String(s == null ? '' : s)); return m ? parseFloat(m[0].replace(/\./g, '').replace(',', '.')) : NaN };

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

console.log('== uji persediaan ==');
const health = await call('GET', '/api/health');
check(health.status === 200 && health.data && health.data.ok, 'server dev hidup');

const stamp = Date.now();
const owner = await login(`owner.inv${stamp}@rasa.local`, 'register', { name: 'Owner Inventori', resto: 'Resto Inventori' });
const otok = owner.token;
ok('owner login');

const applied = r => r.data && Array.isArray(r.data.applied) && r.data.applied.length > 0;
const invalidOf = r => ((r.data && r.data.invalid) || []).map(x => x.key + ': ' + x.reason).join('; ');

/* ---------- 1. data awal sesuai skenario uji ---------- */
const today = new Date();
const day = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
const INV = [
  { id: 'inv_beras', name: 'Beras Uji', cat: 'Bahan utama', unit: 'kg', stock: 10, min: 2, cost: 14000 },
  { id: 'inv_ayam', name: 'Ayam Uji', cat: 'Protein', unit: 'kg', stock: 2, min: 5, cost: 48000 },
  { id: 'inv_bumbu', name: 'Bumbu Uji', cat: 'Bumbu', unit: 'kg', stock: 3, min: 1, cost: 20000 },
  { id: 'inv_sayur', name: 'Sayur Uji', cat: 'Bahan dasar', unit: 'kg', stock: 2, min: 1, cost: 12000, expiry: '2020-01-01', batch: 'EXP-001' },
  { id: 'inv_minyak', name: 'Minyak Uji', cat: 'Bahan dasar', unit: 'liter', stock: 5, min: 2, cost: 32000 }
];
const PRD = [
  { id: 'prod_uji1', name: 'Nasi Ayam Uji', price: 25000, cat: 'Makanan', type: 'Makanan', sold: 0, stock: 20, variants: [], image: '', available: true },
  { id: 'prod_uji2', name: 'Paket Bumbu Uji', price: 10000, cat: 'Makanan', type: 'Makanan', sold: 0, stock: 20, variants: [], image: '', available: true }
];
const RC = [
  { id: 'rc_uji1', productId: 'prod_uji1', items: [{ invId: 'inv_ayam', qty: 0.25 }, { invId: 'inv_beras', qty: 0.15 }] },
  { id: 'rc_uji2', productId: 'prod_uji2', items: [{ invId: 'inv_bumbu', qty: 4 }, { invId: 'inv_minyak', qty: 0.1 }] }
];
const SEEDED_LOG = [{
  t: Date.now(), day: day, invId: 'inv_sayur', qty: -0.5, kind: 'correction', ref: 'uji-awal',
  cost: 12000, before: 2.5, after: 2, note: 'Log awal uji', by: 'Owner Inventori'
}];

let r = await put({ inventory: INV }, ['inventory'], otok);
check(applied(r), 'data awal 5 bahan diterima' + (invalidOf(r) ? ' INVALID: ' + invalidOf(r) : ''));

r = await put({ inventory: INV.map(x => x.id === 'inv_beras' ? Object.assign({}, x, { stock: -1 }) : x) }, ['inventory'], otok);
check(!applied(r) && r.data && r.data.invalid && r.data.invalid.some(x => x.key === 'inventory'),
  'stok negatif DITOLAK server: ' + invalidOf(r));

r = await put({ inventory: INV }, ['inventory'], otok);
check(!invalidOf(r) && !(r.data && r.data.denied && r.data.denied.length),
  'data awal dipulihkan' + (invalidOf(r) ? ' INVALID: ' + invalidOf(r) : '') + ' | ' + JSON.stringify(r.data));

r = await put({ stockLog: SEEDED_LOG }, ['stockLog'], otok);
check(applied(r), 'stockLog dengan qty negatif diterima server' + (invalidOf(r) ? ' INVALID: ' + invalidOf(r) : ''));

r = await put({ recipes: RC }, ['recipes'], otok);
check(applied(r), 'resep uji diterima' + (invalidOf(r) ? ' INVALID: ' + invalidOf(r) : ''));

r = await put({ products: PRD }, ['products'], otok);
check(applied(r), 'produk uji diterima' + (invalidOf(r) ? ' INVALID: ' + invalidOf(r) : ''));

/* ---------- izin: kasir tidak boleh menulis persediaan ---------- */
const staff = await call('POST', '/api/staff', { name: 'Kasir Inv', email: `kasir.inv${stamp}@rasa.local`, role: 'kasir' }, otok);
check(staff.data && staff.data.ok, 'staf kasir dibuat');
const klogin = await login(`kasir.inv${stamp}@rasa.local`, 'login');
const ktok = klogin.token;
r = await put({ inventory: INV.map(x => x.id === 'inv_beras' ? Object.assign({}, x, { name: 'Beras Dicuri' }) : x) }, ['inventory'], ktok);
check(r.data && Array.isArray(r.data.denied) && r.data.denied.some(x => x.key === 'inventory'),
  'kasir DITOLAK menulis inventory: ' + JSON.stringify(r.data && r.data.denied) + ' applied=' + JSON.stringify(r.data && r.data.applied));

/* ---------- 2. Chrome headless: alur Persediaan nyata ---------- */
console.log('-- alur Chrome: persediaan --');
const TOKEN = otok;
const page = `<!doctype html><html lang="id"><meta charset="utf-8"><title>uji persediaan</title>
<style>body{font:13px sans-serif;padding:10px}#out{white-space:pre-wrap}</style>
<pre id="out">pending</pre>
<script>
window.onerror=function(m,s,l,c){try{document.getElementById('out').textContent='ERR:'+m+' @'+l+':'+c}catch(e){}};
var TOKEN=${JSON.stringify(TOKEN)}, R={}, step=0, n=0;
try{localStorage.setItem('restaurant-os:session',TOKEN);}catch(e){}
var f=document.createElement('iframe');
f.style.cssText='position:fixed;left:-5000px;top:0;width:1440px;height:900px';
f.src='/#inventory';
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
function statVal(dd,label){var cs=all(dd,'.stat-card');for(var i=0;i<cs.length;i++){
  var t=cs[i].querySelector('.stat-top');
  if(t&&t.textContent.indexOf(label)===0){var v=cs[i].querySelector('.stat-value');return v?v.textContent.trim():''}}return ''}
function invRow(d,name){
  var rows=all(d,'tbody tr');
  for(var i=0;i<rows.length;i++){
    var tr=rows[i];
    if(tr.getAttribute('data-hay')!==null)continue;   /* baris riwayat stok */
    if(tr.children.length<7)continue;                 /* bukan tabel bahan */
    if((tr.textContent||'').indexOf(name)>=0)return tr;
  }
  return null;
}
function cell(d,name,i){var tr=invRow(d,name);if(!tr)return null;var e=tr.children[i];return e?(e.textContent||'').trim():null}
/* baris pada panel "Riwayat perubahan stok" (7 kolom) */
function readLogRows(d){
  var body=q(d,'#invLogBody');if(!body)return null;
  return all(body,'tr').slice(0,40).map(function(tr){
    var c=tr.children;
    return { waktu:(c[0]&&(c[0].textContent||'')).trim(), bahan:(c[1]&&(c[1].textContent||'')).trim(),
      jenis:(c[2]&&(c[2].textContent||'')).trim(), jumlah:(c[3]&&(c[3].textContent||'')).trim(),
      nilai:(c[4]&&(c[4].textContent||'')).trim(), pelaku:(c[5]&&(c[5].textContent||'')).trim(),
      catatan:(c[6]&&(c[6].textContent||'')).trim() };
  });
}
function invStock(id){
  try{ var s=JSON.parse(window.parent.localStorage.getItem('restaurant-os:v1')); }catch(e){ s=null }
  try{ s=JSON.parse(f.contentWindow.localStorage.getItem('restaurant-os:v1')); }catch(e){}
  if(!s)return null;
  var x=(s.inventory||[]).filter(function(i){return i.id===id})[0];
  return x?x.stock:null;
}
var iv=setInterval(function(){
  n++;
  if(n>800){ done({error:'timeout di step '+step,step:step,R:R,n:n,toast:toast(document)}); return }
  var d=null; try{d=f.contentDocument}catch(e){}
  if(!d){ if(n>400) done({error:'iframe tidak bisa dibuka',n:n}); return }
  var w=null; try{w=f.contentWindow}catch(e){}

  if(step===0){
    var head=txt(d,'.page-heading h1');
    if(head!=='Persediaan bahan baku'){ if(n>400) done({error:'halaman Persediaan tidak tampil',head:head,n:n}); return }
    /* tunggu sinkronisasi dari server: kelima bahan uji harus sudah tampil */
    if(!invRow(d,'Ayam Uji')||!invRow(d,'Minyak Uji')){ if(n>600) done({error:'data bahan belum tersinkron',R:R,n:n}); return }
    R.heading=head;
    R.nilai=statVal(d,'Nilai persediaan');
    R.rendah=statVal(d,'Stok menipis');
    R.ayamStatus=(function(){var tr=invRow(d,'Ayam Uji');return tr?(tr.children[6].textContent||'').trim():null})();
    R.sayurStatus=(function(){var tr=invRow(d,'Sayur Uji');return tr?(tr.children[6].textContent||'').trim():null})();
    R.sayurCell=cell(d,'Sayur Uji',0);
    R.ayamCell=cell(d,'Ayam Uji',2);
    R.berasCell=cell(d,'Beras Uji',2);
    R.minyakCell=cell(d,'Minyak Uji',2);
    try{ R.alerts=(w.RasaInsights.allAlerts()||[]).filter(function(a){return a.module==='inventory'})
          .map(function(a){return a.title+' | '+a.detail}); }catch(e){ R.alertsErr=String(e) }
    if(!gotoPage(d,'alerts')){ done({error:'navigasi Alert Center gagal',R:R}); return }
    step=1; return;
  }
  if(step===1){
    var h1=txt(d,'.page-heading h1');
    if(h1!=='Alert Center'){ if(n>500) done({error:'Alert Center tidak tampil',h:h1,R:R}); return }
    R.alertHeading=h1;
    R.alertHasAyam=d.body.textContent.indexOf('Ayam Uji menipis')>=0;
    if(!gotoPage(d,'inventory')){ done({error:'kembali ke Persediaan gagal',R:R}); return }
    step=2; return;
  }
  if(step===2){
    /* --- konversi satuan: liter → ml (angka, harga, dan nilai ikut) --- */
    var tr=invRow(d,'Minyak Uji');
    if(!tr){ if(n>600) done({error:'baris Minyak tidak ada',R:R}); return }
    var bEdit=tr.querySelector('[data-action^="inv-edit:"]');
    if(!bEdit){ done({error:'tombol Ubah Minyak tidak ada',R:R}); return }
    bEdit.click(); step=3; return;
  }
  if(step===3){
    var u=q(d,'#invUnit');
    if(!u){ if(n>700) done({error:'form bahan tidak terbuka',R:R,toast:toast(d)}); return }
    R.oilStockRaw=q(d,'#invStock').value;
    R.oilCostRaw=q(d,'#invCost').value;
    setVal(u,'ml');
    R.oilStockConv=q(d,'#invStock').value;
    R.oilMinConv=q(d,'#invMin').value;
    R.oilCostConv=q(d,'#invCost').value;
    if(!click(d,'.modal [data-action^="save-inv:"]')){ done({error:'tombol simpan form tidak ada',R:R}); return }
    R.oilSaveToast=toast(d); step=4; return;
  }
  if(step===4){
    if(q(d,'#invUnit')){ if(n>800){R.oilSaveToast=toast(d);done({error:'form minyak tidak tertutup',R:R});} return }
    R.minyakAfterConv=cell(d,'Minyak Uji',2);
    R.nilaiAfterConv=statVal(d,'Nilai persediaan');
    R.convToast=toast(d);
    /* takaran resep yang memakai minyak harus ikut dikonversi */
    try{
      var s2=JSON.parse(f.contentWindow.localStorage.getItem('restaurant-os:v1'));
      var oilItems=(s2.recipes||[]).reduce(function(a,r){return a.concat(r.items||[])},[])
        .filter(function(i){return String(i.invId)==='inv_minyak'});
      R.oilRecipeQty=oilItems.length?oilItems[0].qty:null;
    }catch(e){ R.oilRecipeErr=String(e) }
    /* --- penyesuaian stok: keluar 2 kg beras --- */
    var tr2=invRow(d,'Beras Uji');
    var bAdj=tr2&&tr2.querySelector('[data-action^="inv-adjust:"]');
    if(!bAdj){ done({error:'tombol Stok pada Beras tidak ada',R:R}); return }
    bAdj.click(); step=5; return;
  }
  if(step===5){
    if(!q(d,'#adjMode')){ if(n>900) done({error:'modal penyesuaian tidak terbuka',R:R,toast:toast(d)}); return }
    setVal(q(d,'#adjMode'),'out'); step=6; return;
  }
  if(step===6){
    var qty=q(d,'#adjQty');
    if(!qty){ if(n>1000) done({error:'input jumlah tidak ada setelah ganti jenis',R:R}); return }
    setVal(qty,'2');
    var rs=q(d,'#adjReason'); if(rs) setVal(rs,'damaged');
    var nt=q(d,'#adjNote'); if(nt) setVal(nt,'uji keluar beras');
    R.adjPreview=q(d,'#adjPreview')?(q(d,'#adjPreview').textContent||'').trim():'';
    if(!click(d,'.modal [data-action^="save-adjust:"]')){ done({error:'tombol Simpan stok tidak ada',R:R}); return }
    step=7; return;
  }
  if(step===7){
    if(q(d,'#adjMode')){ if(n>1100){R.adjToast=toast(d);done({error:'penyesuaian tidak tersimpan',R:R});} return }
    R.adjToast=toast(d);
    R.berasAfterAdj=cell(d,'Beras Uji',2);
    var tr3=invRow(d,'Beras Uji');
    var bAdj2=tr3&&tr3.querySelector('[data-action^="inv-adjust:"]');
    if(!bAdj2){ done({error:'tombol Stok (uji negatif) tidak ada',R:R}); return }
    bAdj2.click(); step=8; return;
  }
  if(step===8){
    if(!q(d,'#adjMode')){ if(n>1200) done({error:'modal penyesuaian kedua tidak terbuka',R:R}); return }
    setVal(q(d,'#adjMode'),'out'); step=9; return;
  }
  if(step===9){
    var qty2=q(d,'#adjQty');
    if(!qty2){ if(n>1300) done({error:'input jumlah kedua tidak ada',R:R}); return }
    setVal(qty2,'100');
    R.negPreview=q(d,'#adjPreview')?(q(d,'#adjPreview').textContent||'').trim():'';
    if(!click(d,'.modal [data-action^="save-adjust:"]')){ done({error:'tombol Simpan (uji negatif) tidak ada',R:R}); return }
    step=10; return;
  }
  if(step===10){
    R.negToast=toast(d);
    R.negModalStillOpen=!!q(d,'#adjMode');
    R.berasAfterNeg=cell(d,'Beras Uji',2);
    if(R.negModalStillOpen){ click(d,'.modal [data-action="close-modal"]'); }
    step=11; return;
  }
  if(step===11){
    if(q(d,'#adjMode')){ if(n>1400) done({error:'modal uji negatif tidak bisa ditutup',R:R}); return }
    /* --- parsing desimal: ubah ayam 2 → 2,4 --- */
    var tr4=invRow(d,'Ayam Uji');
    var bE2=tr4&&tr4.querySelector('[data-action^="inv-edit:"]');
    if(!bE2){ done({error:'tombol Ubah Ayam tidak ada',R:R}); return }
    bE2.click(); step=12; return;
  }
  if(step===12){
    if(!q(d,'#invStock')){ if(n>1500) done({error:'form ayam tidak terbuka',R:R,toast:toast(d)}); return }
    setVal(q(d,'#invStock'),'2,4');
    if(!click(d,'.modal [data-action^="save-inv:"]')){ done({error:'tombol simpan ayam tidak ada',R:R}); return }
    step=13; return;
  }
  if(step===13){
    if(q(d,'#invStock')){ if(n>1600){R.decimalToast=toast(d);done({error:'form ayam tidak tertutup',R:R});} return }
    R.decimalToast=toast(d);
    R.ayamAfterDecimal=cell(d,'Ayam Uji',2);
    /* --- REGRESI: simpan ulang form tanpa mengubah apa pun --- */
    var tr5=invRow(d,'Ayam Uji');
    var bE3=tr5&&tr5.querySelector('[data-action^="inv-edit:"]');
    if(!bE3){ done({error:'tombol Ubah Ayam (noop) tidak ada',R:R}); return }
    bE3.click(); step=14; return;
  }
  if(step===14){
    if(!q(d,'#invStock')){ if(n>1700) done({error:'form ayam (noop) tidak terbuka',R:R}); return }
    R.noopRawStock=q(d,'#invStock').value;
    R.noopRawMin=q(d,'#invMin').value;
    if(!click(d,'.modal [data-action^="save-inv:"]')){ done({error:'tombol simpan (noop) tidak ada',R:R}); return }
    step=15; return;
  }
  if(step===15){
    if(q(d,'#invStock')){ if(n>1800){R.noopToast=toast(d);done({error:'form noop tidak tertutup',R:R});} return }
    R.noopToast=toast(d);
    R.ayamAfterNoop=cell(d,'Ayam Uji',2);
    if(!click(d,'[data-action="inv-opname"]')){ done({error:'tombol Stok opname tidak ada',R:R}); return }
    step=16; return;
  }
  if(step===16){
    var rows2=all(d,'.bom-row');
    if(!rows2.length){ if(n>1900) done({error:'modal opname tidak terbuka',R:R,toast:toast(d)}); return }
    var target=null;
    for(var i=0;i<rows2.length;i++){ if(rows2[i].textContent.indexOf('Bumbu Uji')>=0){target=rows2[i];break} }
    if(!target){ done({error:'baris Bumbu tidak ada di opname',R:R}); return }
    R.opnameRows=rows2.length;
    var inp=target.querySelector('[data-opname]');
    R.opnameRaw=inp?inp.value:'';
    if(!inp||!setVal(inp,'2,5')){ done({error:'input opname bumbu tidak ada',R:R}); return }
    if(!click(d,'.modal [data-action="save-opname"]')){ done({error:'tombol Simpan opname tidak ada',R:R}); return }
    step=17; return;
  }
  if(step===17){
    if(all(d,'.bom-row').length&&q(d,'[data-action="save-opname"]')){ if(n>2000){R.opnameToast=toast(d);done({error:'opname tidak tersimpan',R:R});} return }
    R.opnameToast=toast(d);
    R.bumbuAfterOpname=cell(d,'Bumbu Uji',2);
    if(!click(d,'[data-action="inv-history"]')){ done({error:'tombol Riwayat stok tidak ada',R:R}); return }
    step=18; return;
  }
  if(step===18){
    var lrEarly=readLogRows(d);
    if(!lrEarly){ if(n>2100) done({error:'panel riwayat stok tidak tampil',R:R,toast:toast(d)}); return }
    R.logRowsEarly=lrEarly.length;
    if(!gotoPage(d,'menu')){ done({error:'navigasi Menu gagal',R:R}); return }
    step=19; return;
  }
  if(step===19){
    var h2=txt(d,'.page-heading h1');
    if(h2!=='Menu & produk'&&h2.indexOf('Menu')<0){ if(n>2200) done({error:'halaman Menu tidak tampil',h:h2,R:R}); return }
    var add=q(d,'[data-action="cart-add:prod_uji1"]');
    if(!add){ if(n>2300) done({error:'tombol tambah Nasi Ayam Uji tidak ada',R:R}); return }
    add.click(); step=20; return;
  }
  if(step===20){
    var co=q(d,'[data-action="checkout"]');
    if(!co){ if(n>2400) done({error:'tombol checkout tidak muncul',R:R,toast:toast(d)}); return }
    co.click(); step=21; return;
  }
  if(step===21){
    var pay=q(d,'#coPayBtn');
    if(!pay){ if(n>2500) done({error:'modal pembayaran tidak terbuka',R:R,toast:toast(d)}); return }
    pay.click(); step=22; return;
  }
  if(step===22){
    if(!q(d,'.modal-success')){ if(n>2700) done({error:'pembayaran tidak berhasil',R:R,toast:toast(d)}); return }
    R.paid=true;
    R.payToast=toast(d);
    if(!gotoPage(d,'inventory')){ done({error:'kembali ke Persediaan setelah bayar gagal',R:R}); return }
    step=23; return;
  }
  if(step===23){
    if(txt(d,'.page-heading h1')!=='Persediaan bahan baku'){ if(n>2800) done({error:'Persediaan tidak tampil setelah bayar',R:R}); return }
    R.ayamAfterPay=cell(d,'Ayam Uji',2);
    R.berasAfterPay=cell(d,'Beras Uji',2);
    /* --- kebijakan stok negatif + pemotongan ganda (panggilan langsung) --- */
    try{
      var before=invStock('inv_bumbu');
      var oShort={id:'ORD-SHORT-UJI',detail:[{pid:'prod_uji2',qty:1}]};
      var retShort=w.applyBom(oShort);
      var after=invStock('inv_bumbu');
      var ayam1=invStock('inv_ayam');
      var oDup={id:'ORD-DUP-UJI',detail:[{pid:'prod_uji1',qty:1}]};
      var dup1=w.applyBom(oDup);
      var ayam2=invStock('inv_ayam');
      var dup2=w.applyBom(oDup);
      var ayam3=invStock('inv_ayam');
      R.short={before:before,after:after,ret:retShort};
      R.dup={first:dup1,second:dup2,ayam1:ayam1,ayam2:ayam2,ayam3:ayam3};
      var s=JSON.parse(f.contentWindow.localStorage.getItem('restaurant-os:v1'));
      R.finalStocks={};
      (s.inventory||[]).forEach(function(x){R.finalStocks[x.name]=x.stock});
      R.recentLogs=(s.stockLog||[]).slice(-14).map(function(e){
        return {inv:e.invId,qty:e.qty,kind:e.kind,ref:e.ref,before:e.before,after:e.after,by:e.by,note:e.note||''};
      });
      R.totalLogs=(s.stockLog||[]).length;
      w.render('inventory',true);
    }catch(e){ R.applyErr=String(e&&e.message||e) }
    step=24; return;
  }
  if(step===24){
    if(txt(d,'.page-heading h1')!=='Persediaan bahan baku'){ if(n>2900) done({error:'render akhir gagal',R:R}); return }
    R.bumbuAfterShort=cell(d,'Bumbu Uji',2);
    R.bumbuStatus=(function(){var tr=invRow(d,'Bumbu Uji');return tr?(tr.children[6].textContent||'').trim():null})();
    /* baca ulang riwayat SETELAH pembayaran & pemotongan resep */
    R.logRows=readLogRows(d)||[];
    R.logCount=R.logRows.length;
    /* uji terakhir: satuan tidak sebanding (ml → pcs) harus ditolak */
    R.oilCellBeforeIncompat=cell(d,'Minyak Uji',2);
    var trO=invRow(d,'Minyak Uji');
    var bEO=trO&&trO.querySelector('[data-action^="inv-edit:"]');
    if(!bEO){ done({error:'tombol Ubah Minyak (uji satuan) tidak ada',R:R}); return }
    bEO.click(); step=25; return;
  }
  if(step===25){
    var u2=q(d,'#invUnit');
    if(!u2){ if(n>700) done({error:'form minyak (uji satuan) tidak terbuka',R:R,toast:toast(d)}); return }
    setVal(u2,'pcs');
    R.incompatToast=toast(d);
    R.incompatUnit=u2.value;
    if(!click(d,'.modal [data-action="close-modal"]')){ done({error:'tombol Batal form tidak ada',R:R}); return }
    step=26; return;
  }
  if(step===26){
    if(q(d,'#invUnit')){ if(n>760){R.incompatToast=toast(d);done({error:'form satuan tidak tertutup',R:R});} return }
    R.incompatAfterCell=cell(d,'Minyak Uji',2);
    done(R); return;
  }
if(n%20===0){try{document.getElementById('out').textContent='PROGRESS step='+step+' n='+n}catch(e){}}
},200);
</script>`;

const file = join(process.cwd(), 'test-uji-inventory.html');
writeFileSync(file, page, 'utf8');
const prof = mkdtempSync(join(tmpdir(), 'inv-'));
let dom = '';
try {
  dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--user-data-dir=' + prof, '--virtual-time-budget=180000', '--dump-dom', base + '/test-uji-inventory.html'
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 280000 });
} catch (e) {
  console.log('Chrome gagal: ' + String(e.message).slice(0, 400));
}
try { rmSync(file, { force: true }) } catch (e) {}
try { rmSync(prof, { recursive: true, force: true }) } catch (e) {}

const m = /RESULT:([\s\S]*?)<\/pre>/.exec(dom);
const unesc = s => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
if (!m) {
  bad('tidak ada hasil dari halaman uji (DOM ' + dom.length + ' char)');
  try { writeFileSync(join(process.cwd(), 'test-uji-inventory.dom.html'), dom, 'utf8'); console.log('  DOM disimpan ke test-uji-inventory.dom.html'); } catch (e) {}
  console.log('HEAD: ' + dom.slice(0, 300));
  console.log('TAIL: ' + dom.slice(-900));
}
else {
  let R = null;
  try { R = JSON.parse(unesc(m[1]).trim()) } catch (e) { bad('hasil bukan JSON: ' + unesc(m[1]).slice(0, 800)) }
  if (R) {
    if (R.error) bad('error alur: ' + R.error + (R.step != null ? ' (step ' + R.step + ')' : '') + ' | ' + JSON.stringify(R.R || R || {}).slice(0, 4000));

    /* --- data awal & status --- */
    check(R.heading === 'Persediaan bahan baku', 'halaman Persediaan render: ' + R.heading);
    check(R.nilai === 'Rp 480.000', 'nilai persediaan = Σ(stok × harga) Rp 480.000: ' + R.nilai);
    check(String(R.ayamCell).indexOf('2 kg') === 0, 'stok awal ayam 2 kg: ' + R.ayamCell);
    check(String(R.berasCell).indexOf('10 kg') === 0, 'stok awal beras 10 kg: ' + R.berasCell);
    check(String(R.minyakCell).indexOf('5 liter') === 0, 'stok awal minyak 5 liter: ' + R.minyakCell);
    check(R.ayamStatus === 'Rendah', 'ayam (2 ≤ min 5) berstatus Rendah: ' + R.ayamStatus);
    check(R.rendah && num(R.rendah) >= 1, 'kartu "Stok menipis" menyala: ' + R.rendah);
    check(Array.isArray(R.alerts) && R.alerts.some(a => a.indexOf('Ayam Uji menipis') === 0),
      'peringatan otomatis stok menipis: ' + JSON.stringify(R.alerts));
    check(R.alertHasAyam === true, 'Alert Center menampilkan "Ayam Uji menipis"');
    check(R.sayurStatus === 'Kedaluwarsa' && String(R.sayurCell).indexOf('Batch EXP-001') >= 0,
      'kedaluwarsa & nomor batch tampil: ' + R.sayurStatus + ' / ' + R.sayurCell);

    /* --- konversi satuan --- */
    check(R.oilStockRaw === '5' && R.oilCostRaw === '32000', 'form minyak terbaca apa adanya: stok=' + R.oilStockRaw + ' harga=' + R.oilCostRaw);
    check(num(R.oilStockConv) === 5000, 'stok 5 liter → 5.000 ml di form: ' + R.oilStockConv);
    check(num(R.oilMinConv) === 2000, 'stok minimum 2 liter → 2.000 ml di form: ' + R.oilMinConv);
    check(num(R.oilCostConv) === 32, 'harga Rp 32.000/liter → Rp 32/ml: ' + R.oilCostConv);
    check(String(R.minyakAfterConv).indexOf('5.000 ml') === 0 && String(R.minyakAfterConv).indexOf('≈ 5 l') >= 0,
      'tabel menampilkan 5.000 ml + setara ≈ 5 l: ' + R.minyakAfterConv);
    check(/satuan liter → ml/.test(String(R.convToast)), 'toast konversi satuan: ' + R.convToast);
    check(R.nilaiAfterConv === 'Rp 480.000', 'nilai persediaan TIDAK berubah setelah konversi satuan: ' + R.nilaiAfterConv);
    check(num(R.oilRecipeQty) === 100, 'takaran resep ikut dikonversi 0,1 liter → 100 ml: ' + R.oilRecipeQty + (R.oilRecipeErr ? ' ERR ' + R.oilRecipeErr : ''));

    /* --- penyesuaian stok & pencegahan negatif --- */
    check(String(R.berasAfterAdj).indexOf('8 kg') === 0, 'stok beras 10 − 2 = 8 kg: ' + R.berasAfterAdj + ' | toast: ' + R.adjToast);
    check(/8 kg/.test(String(R.adjToast)) && /tercatat/.test(String(R.adjToast)), 'toast penyesuaian menyebut stok & riwayat: ' + R.adjToast);
    check(num(R.adjPreview) === 8, 'pratinjau stok akhir 8 kg: ' + R.adjPreview);
    check(num(R.negPreview) < 0, 'pratinjau menunjukkan stok minus saat keluar melebihi stok: ' + R.negPreview);
    check(/melebihi stok/.test(String(R.negToast)), 'keluar 100 kg DITOLAK: ' + R.negToast);
    check(R.negModalStillOpen === true, 'modal tetap terbuka saat ditolak (data tidak berubah)');
    check(String(R.berasAfterNeg).indexOf('8 kg') === 0, 'stok beras tetap 8 kg setelah penolakan: ' + R.berasAfterNeg);

    /* --- parsing desimal form --- */
    check(String(R.ayamAfterDecimal).indexOf('2,4 kg') === 0, 'ayam tersimpan 2,4 kg (koma desimal): ' + R.ayamAfterDecimal + ' | toast: ' + R.decimalToast);
    check(R.noopRawStock === '2.4', 'form memunculkan stok 2,4 apa adanya: ' + R.noopRawStock);
    check(String(R.ayamAfterNoop).indexOf('2,4 kg') === 0,
      'REGRESI: simpan ulang form tanpa ubah apa pun tidak mengubah stok (dulu 2,4 → 24): ' + R.ayamAfterNoop);

    /* --- stock opname --- */
    check(R.opnameRaw === '3' || num(R.opnameRaw) === 3, 'input opname bumbu terisi stok tercatat: ' + R.opnameRaw);
    check(String(R.bumbuAfterOpname).indexOf('2,5 kg') === 0, 'opname bumbu 3 → 2,5 kg: ' + R.bumbuAfterOpname + ' | toast: ' + R.opnameToast);
    check(/Opname tersimpan/.test(String(R.opnameToast)), 'toast opname: ' + R.opnameToast);

    /* --- riwayat stok --- */
    check(R.logCount > 0, 'riwayat stok menampilkan ' + R.logCount + ' baris (sebelum bayar: ' + R.logRowsEarly + ')');
    const rows = R.logRows || [];
    const sayurLog = rows.filter(x => x.bahan.indexOf('Sayur Uji') === 0 && x.jumlah.indexOf('−0,5') >= 0 && x.jumlah.indexOf('2,5 → 2') >= 0);
    check(sayurLog.length > 0, 'log awal tampil dengan sebelum → sesudah: ' + JSON.stringify(sayurLog[0] || null));
    const berasLog = rows.filter(x => x.bahan.indexOf('Beras Uji') === 0 && x.jumlah.indexOf('−2') >= 0 && x.jumlah.indexOf('10 → 8') >= 0);
    check(berasLog.length > 0, 'penyesuaian beras tercatat −2 dengan 10 → 8: ' + JSON.stringify(berasLog[0] || null));
    const opnameLog = rows.filter(x => x.bahan.indexOf('Bumbu Uji') === 0 && x.jumlah.indexOf('−0,5') >= 0 && x.jumlah.indexOf('3 → 2,5') >= 0);
    check(opnameLog.length > 0, 'opname bumbu tercatat −0,5 dengan 3 → 2,5: ' + JSON.stringify(opnameLog[0] || null));
    const convLog = rows.filter(x => x.bahan.indexOf('Minyak Uji') === 0 && x.catatan.indexOf('Satuan liter') >= 0);
    check(convLog.length > 0, 'konversi satuan tercatat di riwayat: ' + JSON.stringify(convLog[0] || null));
    check(rows.every(x => x.pelaku !== '—' && String(x.pelaku).length > 0), 'semua baris riwayat punya pelaku');
    check(rows.every(x => x.jumlah.indexOf('→') >= 0), 'semua baris riwayat punya sebelum → sesudah');

    /* --- pembayaran POS memotong stok sesuai resep --- */
    check(R.paid === true, 'pembayaran POS berhasil: ' + R.payToast);
    check(String(R.ayamAfterPay).indexOf('2,15 kg') === 0, 'ayam 2,4 − 0,25 (resep) = 2,15 kg: ' + R.ayamAfterPay);
    check(String(R.berasAfterPay).indexOf('7,85 kg') === 0, 'beras 8 − 0,15 (resep) = 7,85 kg: ' + R.berasAfterPay);
    const bomLog = rows.filter(x => x.jenis === 'Pemakaian resep' && x.jumlah.indexOf('−') === 0);
    check(bomLog.length > 0, 'pemakaian resep tercatat dengan tanda MINUS: ' + JSON.stringify(bomLog[0] || null));
    if (!(sayurLog.length && berasLog.length && opnameLog.length && convLog.length && bomLog.length))
      console.log('  DEBUG baris riwayat (' + rows.length + '): ' + JSON.stringify(rows));

    /* --- kebijakan stok negatif & pemotongan ganda --- */
    check(!R.applyErr, 'panggilan applyBom tanpa error: ' + R.applyErr);
    if (R.short) {
      check(num(R.short.before) === 2.5 && num(R.short.after) === 0 && R.short.ret === true,
        'stok kurang: dipakai sebersedia, stok berhenti di 0 (bukan negatif): ' + JSON.stringify(R.short));
      check(String(R.bumbuAfterShort).indexOf('0 kg') === 0, 'baris bumbu menampilkan 0 kg: ' + R.bumbuAfterShort);
      check(R.bumbuStatus === 'Habis', 'status bumbu Habis: ' + R.bumbuStatus);
    } else bad('hasil uji kekurangan stok tidak ada');
    if (R.dup) {
      check(R.dup.first === true && R.dup.second === false, 'pemotongan ganda DITOLAK (bomApplied): first=' + R.dup.first + ' second=' + R.dup.second);
      check(num(R.dup.ayam2) === num(R.dup.ayam3), 'stok ayam tidak berubah pada pemanggilan kedua: ' + R.dup.ayam1 + ' → ' + R.dup.ayam2 + ' → ' + R.dup.ayam3);
    } else bad('hasil uji pemotongan ganda tidak ada');

    /* --- invarian log: tidak ada stok negatif & sebelum + jumlah = sesudah --- */
    if (R.finalStocks) {
      const neg = Object.keys(R.finalStocks).filter(k => Number(R.finalStocks[k]) < 0);
      check(neg.length === 0, 'semua stok akhir ≥ 0: ' + JSON.stringify(R.finalStocks));
    } else bad('stok akhir tidak terbaca');
    if (Array.isArray(R.recentLogs)) {
      const badInvariant = R.recentLogs.filter(e => e.before != null && e.after != null &&
        Math.abs(((Number(e.before) + Number(e.qty)) - Number(e.after))) > 1e-6);
      check(badInvariant.length === 0, 'sebelum + jumlah = sesudah untuk semua log terbaru: ' + JSON.stringify(badInvariant.slice(0, 3)));
      const noActor = R.recentLogs.filter(e => !String(e.by || '').trim());
      check(noActor.length === 0, 'semua log terbaru punya pelaku: ' + JSON.stringify(R.recentLogs.slice(-3)));
      const negStock = R.recentLogs.filter(e => Number(e.after) < 0 || Number(e.before) < 0);
      check(negStock.length === 0, 'tidak ada before/sesudah negatif di log');
      const lack = R.recentLogs.filter(e => String(e.note).indexOf('Kurang') === 0);
      check(lack.length > 0, 'selisih kekurangan tercatat sebagai catatan log: ' + JSON.stringify(lack[0] || null));
      ok('total log tersimpan: ' + R.totalLogs);
    } else bad('log stok akhir tidak terbaca');

    /* --- penolakan satuan tidak sebanding (ml → pcs) --- */
    check(/tidak sebanding/.test(String(R.incompatToast)),
      'satuan tidak sebanding DITOLAK saat menyimpan: ' + R.incompatToast);
    check(R.incompatUnit === 'ml', 'field satuan otomatis dikembalikan ke ml: ' + R.incompatUnit);
    check(!!R.incompatAfterCell && R.incompatAfterCell === R.oilCellBeforeIncompat,
      'stok minyak TIDAK berubah setelah penolakan: ' + R.oilCellBeforeIncompat + ' -> ' + R.incompatAfterCell);
  }
}

console.log(failed ? '== GAGAL: ' + failed + ' pemeriksaan ==' : '== SEMUA LULUS ==');
process.exit(failed ? 1 : 0);
