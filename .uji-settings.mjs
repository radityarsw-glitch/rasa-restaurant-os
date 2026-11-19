/* Uji UI: SEMUA staf (waiter) bisa membuka modul Pengaturan tanpa wewenang owner —
   bahkan setelah owner mencabut SELURUH wewenangnya lewat tombol Wewenang. */
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

const stamp = Date.now();
console.log('== uji modul Pengaturan untuk staf ==');
const owner = await login(`owner.set${stamp}@rasa.local`, 'register', { name: 'Owner Set', resto: 'Resto Set' });
const otok = owner.token;
const MAIL = `waiter.set${stamp}@rasa.local`;
const created = await call('POST', '/api/staff', { name: 'Waiter Set', email: MAIL, role: 'waiter' }, otok);
if (!created.data || !created.data.ok) { console.log('gagal membuat staf: ' + JSON.stringify(created.data)); process.exit(1) }
const staffId = created.data.user.id;
ok('staf waiter dibuat');

/* owner mencabut SEMUA wewenang staf (termasuk Pengaturan) lewat API yang sama
   dengan tombol Wewenang */
const perms = await call('GET', '/api/permissions', null, otok);
const eff = {};
Object.keys(perms.data.matrix.waiter || {}).forEach(m => { eff[m] = []; });
const put = await call('PUT', '/api/permissions', { users: { [staffId]: eff } }, otok);
check(put.status === 200, 'owner mencabut seluruh wewenang staf');

const sess = await login(MAIL, 'login');
const stok = sess.token;
const me = await call('GET', '/api/auth/me', null, stok);
check((me.data.permissions || {}).settings && me.data.permissions.settings.indexOf('read') >= 0,
  'izin efektif staf tetap memuat settings:read -> ' + JSON.stringify((me.data.permissions || {}).settings));

const page = `<!doctype html><html lang="id"><meta charset="utf-8"><title>uji settings</title>
<style>body{font:13px sans-serif;padding:10px}#out{white-space:pre-wrap}</style>
<pre id="out">pending</pre>
<script>
try{localStorage.setItem('restaurant-os:session',${JSON.stringify(stok)});}catch(e){}
var R={},n=0;
var f=document.createElement('iframe');
f.style.cssText='position:fixed;left:-5000px;top:0;width:1440px;height:900px';
f.src='/#settings';
document.body.appendChild(f);
function done(o){clearInterval(iv);document.getElementById('out').textContent='RESULT:'+JSON.stringify(o);}
var iv=setInterval(function(){
  n++;
  var d=null;try{d=f.contentDocument}catch(e){}
  if(!d){if(n>300)done({error:'iframe gagal'});return;}
  var pc=d.getElementById('pageContent');
  if(!pc){if(n>300)done({error:'halaman tidak termuat'});return;}
  if(n<40 && !d.getElementById('profilePanel') && !d.querySelector('.denied-screen'))return;
  if(n>=40 || d.getElementById('profilePanel') || d.querySelector('.denied-screen')){
    var navBtn=null;
    var navs=Array.prototype.slice.call(d.querySelectorAll('.nav-item[data-page="settings"]'));
    if(navs.length)navBtn=navs[0];
    R.navFound=!!navBtn;
    R.navVisible=!!navBtn && !navBtn.hidden && navBtn.style.display!=='none';
    R.denied=!!d.querySelector('.denied-screen');
    R.deniedText=(d.querySelector('.denied-screen')||{textContent:''}).textContent.slice(0,160);
    R.hasProfile=!!d.getElementById('profilePanel');
    R.hasStaffPanel=!!d.getElementById('staffPanel');
    R.pageText=(pc.textContent||'').slice(0,200);
    done(R);
  }
},200);
</script>`;

const file = join(process.cwd(), 'test-uji-settings.html');
writeFileSync(file, page, 'utf8');
const prof = mkdtempSync(join(tmpdir(), 'set-'));
let dom = '';
try {
  dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--user-data-dir=' + prof, '--virtual-time-budget=30000', '--dump-dom', base + '/test-uji-settings.html'
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
} catch (e) { console.log('Chrome gagal: ' + String(e.message).slice(0, 300)) }
try { rmSync(file, { force: true }) } catch (e) {}
try { rmSync(prof, { recursive: true, force: true }) } catch (e) {}

const m = /RESULT:([\s\S]*?)<\/pre>/.exec(dom);
if (!m) { bad('tidak ada hasil uji'); console.log(dom.slice(0, 500)) }
else {
  let R = null;
  try { R = JSON.parse(m[1].trim()) } catch (e) { bad('hasil bukan JSON: ' + m[1].slice(0, 300)) }
  if (R) {
    if (R.error) bad('error: ' + R.error);
    check(R.navFound === true, 'menu Pengaturan ada di sidebar');
    check(R.navVisible === true, 'menu Pengaturan TIDAK tersembunyi untuk staf');
    check(R.denied !== true, 'halaman tidak ditolak (tanpa layar "Anda tidak punya izin")' + (R.denied ? ' — ' + R.deniedText : ''));
    check(R.hasProfile === true, 'panel Profil pribadi staf terbuka di halaman Pengaturan');
    check(R.hasStaffPanel !== true, 'staf tidak melihat panel Staf & role (wajar)');
  }
}
console.log('');
console.log(failed === 0 ? 'HASIL: SEMUA LULUS' : 'HASIL: ' + failed + ' GAGAL');
process.exit(failed === 0 ? 0 : 1);
