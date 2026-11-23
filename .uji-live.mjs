/* Smoke test deployment live: API + render halaman operasional di site produksi. */
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env.RASA_BASE || 'https://rasa-restaurant-os.rasa-os.workers.dev';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let bad = 0, ok = 0;
const check = (v, m) => { if (v) { ok++; console.log('  [OK] ' + m) } else { bad++; console.log('  [GAGAL] ' + m) } };

async function call(method, path, body, tok, tries) {
  const h = { 'content-type': 'application/json' };
  if (tok) h.authorization = 'Bearer ' + tok;
  for (let i = 0; i < (tries || 5); i++) {
    try {
      const r = await fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      try { return await r.json() } catch (e) { return null }
    } catch (e) { if (i === (tries || 5) - 1) throw e; await new Promise(s => setTimeout(s, 3000)) }
  }
  return null;
}

/* Live mengirim OTP lewat email (channel=email), jadi kode diambil dari
   hash di D1 remote lalu dipecahkan offline (6 digit) — hanya 1 verify. */
import { createHash } from 'node:crypto';
function d1(sql) {
  /* Node menolak spawn .cmd tanpa shell (CVE-2024-27980) -> lewat cmd.exe.
     SQL hanya berisi kutip tunggal, aman dibungkus kutip ganda. */
  const cmd = `npx.cmd wrangler d1 execute rasa-restaurant-os-db --remote --json --command "${sql}"`;
  for (let i = 0; i < 6; i++) {
    try {
      const out = execFileSync(cmd, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000, shell: true });
      return JSON.parse(out)[0].results || [];
    } catch (e) { if (i === 5) throw e; }
  }
  return [];
}
async function liveLogin(email, extra) {
  const r = await call('POST', '/api/auth/request', Object.assign({ email, purpose: 'register' }, extra || {}));
  if (!r || !r.ok) throw new Error('auth/request gagal: ' + JSON.stringify(r));
  const rows = d1(`SELECT id, code_hash FROM otp_codes WHERE email = '${email}' AND used_at = 0 ORDER BY created_at DESC LIMIT 1`);
  if (!rows.length) throw new Error('otp row tidak ditemukan');
  const { id, code_hash } = rows[0];
  let code = '';
  for (let i = 0; i < 1000000 && !code; i++) {
    const c6 = String(i).padStart(6, '0');
    if (createHash('sha256').update(id + ':' + email + ':' + c6).digest('hex') === code_hash) code = c6;
  }
  if (!code) throw new Error('kode otp tidak terpecahkan');
  const v = await call('POST', '/api/auth/verify', { email, code });
  if (!v || !v.token) throw new Error('auth/verify gagal: ' + JSON.stringify(v));
  return v.token;
}

console.log('== smoke live: ' + base + ' ==');
const h = await call('GET', '/api/health').catch(() => null);
check(h && h.ok, 'health live: ' + JSON.stringify(h));

const stamp = Date.now();
const email = `live${stamp}@rasa.local`;
let tok = null;
try { tok = await liveLogin(email, { name: 'Live Uji', resto: 'Resto Live Uji' }) }
catch (e) { console.log('  liveLogin: ' + e.message) }
check(!!tok, 'owner live bisa daftar & masuk (OTP lewat email + D1)');

if (tok) {
  const g = await call('GET', '/api/data', null, tok).catch(() => null);
  check(g && g.ok, 'GET /api/data live');
  /* restoran baru masih kosong -> uji round-trip: tulis kunci operasional
     lalu baca ulang (membuktikan validator + penyimpanan live bekerja). */
  const seed = {
    inventory: [{ id: 'inv_live1', name: 'Beras Live', cat: 'Bahan dasar', unit: 'kg', stock: 10, min: 2, cost: 14000, expiry: '2027-01-31', batch: 'B-001' }],
    suppliers: [{ id: 'sp_live1', name: 'Pemasok Live', items: [{ invId: 'inv_live1', price: 13500 }] }],
    purchaseRequests: [{ id: 'pr_live1', no: 'PR-2026-900', date: '2026-11-23', status: 'pending', items: [{ invId: 'inv_live1', qty: 5, price: 13500 }], by: 'Live Uji' }],
    purchaseOrders: [{ id: 'po_live1', no: 'PO-2026-900', date: '2026-11-23', status: 'draft', supplierId: 'sp_live1', supplierName: 'Pemasok Live', prId: 'pr_live1', items: [{ invId: 'inv_live1', qty: 5, price: 13500, recv: 0, rej: 0, total: 67500 }], total: 67500, payments: [], createdBy: 'Live Uji' }],
    recipeLog: [{ id: 'rl_live1', productId: 'p_live1', t: Date.now(), items: [{ invId: 'inv_live1', qty: 100, u: 'g' }], by: 'Live Uji', note: 'uji live' }],
    stockLog: [{ id: 'sl_live1', t: Date.now(), day: '2026-11-23', invId: 'inv_live1', qty: 10, kind: 'purchase', before: 0, after: 10, note: 'PO-2026-900', by: 'Live Uji' }]
  };
  const changed = Object.keys(seed);
  const w = await call('PUT', '/api/data', { payload: seed, changed }, tok).catch(() => null);
  check(w && w.ok && Array.isArray(w.applied) && w.applied.length === changed.length && !(w.denied || []).length && !(w.invalid || []).length,
    'PUT kunci operasional live diterima: ' + JSON.stringify({ applied: w && w.applied, denied: w && w.denied, invalid: w && w.invalid }));
  const g2 = await call('GET', '/api/data', null, tok).catch(() => null);
  const p = (g2 && g2.payload) || {};
  check(['suppliers', 'purchaseRequests', 'purchaseOrders', 'recipeLog', 'stockLog'].every(k => Array.isArray(p[k]) && p[k].length),
    'kunci operasional tersimpan & terbaca ulang: ' + ['suppliers','purchaseRequests','purchaseOrders','recipeLog','stockLog'].map(k => k + '=' + (Array.isArray(p[k]) ? p[k].length : '-')).join(', '));
}

/* Halaman uji dibuat STANIS (token lewat hash) agar bisa dideploy sekali,
   lalu dijalankan berulang terhadap origin workers.dev yang sama dengan SPA. */
const html = `<!doctype html><html lang="id"><meta charset="utf-8"><title>live uji</title>
<pre id="out">pending</pre>
<script>
var tok=(location.hash||'').replace(/^#t=/,'');
try{if(tok)localStorage.setItem('restaurant-os:session',tok);}catch(e){}
var f=document.createElement('iframe');
f.style.cssText='position:fixed;left:-5000px;top:0;width:1440px;height:900px';
f.src='/#overview';
document.body.appendChild(f);
var R={pages:[]},step=0;
var seq=['overview','procurement','finance','reports'];
var iv=setInterval(function(){
  var d=null;try{d=f.contentDocument}catch(e){}
  if(!d)return;
  var h=d.querySelector('.page-heading h1');
  if(!h)return;
  R.pages.push({p:seq[step],t:h.textContent});
  step++;
  if(step>=seq.length){ clearInterval(iv); document.getElementById('out').textContent='RESULT:'+JSON.stringify(R); return }
  var b=d.querySelector('[data-page="'+seq[step]+'"]');
  if(b)b.click();
},600);
</script></html>`;
writeFileSync(join(process.cwd(), 'live-smoke.html'), html, 'utf8');

/* halaman uji harus berada di ORIGIN yang sama dengan SPA (workers.dev),
   jadi file-nya dideploy lebih dulu: wrangler deploy, baru uji ini dijalankan. */
let dom = '';
try {
  dom = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--user-data-dir=' + join(process.cwd(), 'live-prof'), '--virtual-time-budget=45000',
    '--dump-dom', base + '/live-smoke.html#t=' + encodeURIComponent(tok || '')],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 90000 });
} catch (e) { console.log('chrome: ' + e.message.slice(0, 300)) }
try { rmSync(join(process.cwd(), 'live-prof'), { recursive: true, force: true }) } catch (e) {}

const m = /RESULT:([\s\S]*?)<\/pre>/.exec(dom);
const unesc = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
if (!m) { check(false, 'tidak ada hasil Chrome live (dom ' + dom.length + ')') }
else {
  let R = null;
  try { R = JSON.parse(unesc(m[1]).trim()) } catch (e) { check(false, 'hasil bukan JSON: ' + unesc(m[1]).slice(0, 300)) }
  if (R) {
    console.log('  halaman: ' + JSON.stringify(R.pages));
    check(R.pages.some(x => x.p === 'procurement' && /Pengadaan/.test(x.t)), 'halaman Pengadaan render live');
    check(R.pages.some(x => x.p === 'finance' && /Keuangan/.test(x.t)), 'halaman Keuangan render live');
    check(R.pages.some(x => x.p === 'reports' && /Laporan/.test(x.t)), 'halaman Laporan render live');
  }
}

console.log(bad ? `\n== GAGAL: ${bad} pemeriksaan ==` : `\n== SEMUA LULUS (${ok}) ==`);
process.exit(bad ? 1 : 0);
