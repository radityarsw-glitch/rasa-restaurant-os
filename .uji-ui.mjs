/* Uji UI (headless Chrome) terhadap wrangler dev:
   1. Staf & Role  : tombol Nonaktifkan -> konfirmasi -> akun pindah ke tab Akun Nonaktif
   2. Profil Staf  : field "Tema tampilan pribadi" sudah tidak ada
   3. Profil Staf  : input nama/telepon benar-benar tersimpan ke server */
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
const PHONE = '0819-7777-5555';
const owner = await login(`owner.ui${stamp}@rasa.local`, 'register', { name: 'Owner UI', resto: 'Resto UI' });
const otok = owner.token;
const NAME = 'Staf UI ' + stamp;
const MAIL = `staf.ui${stamp}@rasa.local`;
const created = await call('POST', '/api/staff', { name: NAME, email: MAIL, role: 'waiter' }, otok);
if (!created.data || !created.data.ok) { console.log('gagal membuat staf: ' + JSON.stringify(created.data)); process.exit(1) }
console.log('== uji UI (Chrome headless) ==');
ok('owner login + staf uji dibuat');

const page = `<!doctype html><html lang="id"><meta charset="utf-8"><title>uji ui</title>
<style>body{font:13px sans-serif;padding:10px}#out{white-space:pre-wrap}</style>
<pre id="out">pending</pre>
<script>
var TOKEN=${JSON.stringify(otok)}, NAME=${JSON.stringify(NAME)}, PHONE=${JSON.stringify(PHONE)};
try{localStorage.setItem('restaurant-os:session',TOKEN);}catch(e){}
var R={}, step=0, n=0;
var f=document.createElement('iframe');
f.style.cssText='position:fixed;left:-5000px;top:0;width:1440px;height:900px';
f.src='/#settings';
document.body.appendChild(f);
function done(o){ clearInterval(iv); document.getElementById('out').textContent='RESULT:'+JSON.stringify(o); }
function q(d,s){return d.querySelector(s)}
function all(d,s){return Array.prototype.slice.call(d.querySelectorAll(s))}
var iv=setInterval(function(){
  n++;
  var d=null; try{d=f.contentDocument}catch(e){}
  if(!d){ if(n>300) done({error:'iframe tidak bisa dibuka', step:step, n:n}); return; }
  var body=d.getElementById('staffBody');
  if(step===0){
    if(!body){ if(n>300) done({error:'panel Staf & role tidak tampil', step:step}); return; }
    var btns=all(d,'[data-action^="staff-toggle:"]').filter(function(b){
      var tr=b.closest('tr'); return tr && tr.textContent.indexOf(NAME)>=0; });
    if(!btns.length){ if(n>300) done({error:'tombol Nonaktifkan tidak ditemukan pada staf uji',
        sample:(body.textContent||'').slice(0,300)}); return; }
    R.toggleFound=true; btns[0].click(); step=1; return;
  }
  if(step===1){
    var c=q(d,'[data-action^="staff-deact-confirm:"]');
    if(!c){ if(n>300) done({error:'modal konfirmasi penonaktifan tidak muncul', R:R}); return; }
    R.confirmShown=true; c.click(); step=2; return;
  }
  if(step===2){
    var ci=d.getElementById('staffCountInactive');
    var still = body && body.textContent.indexOf(NAME)>=0;
    var cnt = ci ? ci.textContent : '?';
    if(cnt==='1' && !still){
      R.countInactive=cnt; R.movedOutOfActive=true;
      var tab=all(d,'[data-staff-tab]').filter(function(t){return t.getAttribute('data-staff-tab')==='inactive'})[0];
      if(!tab){ done({error:'tab Akun Nonaktif tidak ada', R:R}); return; }
      tab.click(); step=3; return;
    }
    if(n>300){ done({error:'staf tidak berpindah ke tab Akun Nonaktif',
      countInactive:cnt, stillInActive:!!still,
      bodyText:(body?body.textContent:'').slice(0,300), R:R}); return; }
    return;
  }
  if(step===3){
    var b2=d.getElementById('staffBody');
    if(!b2){ if(n>400) done({error:'tbody hilang', R:R}); return; }
    var rows=all(d,'#staffBody tr').filter(function(tr){return tr.textContent.indexOf(NAME)>=0});
    if(!rows.length){ if(n>400) done({error:'staf tidak muncul di tab Akun Nonaktif',
      body:(b2.textContent||'').slice(0,300), R:R}); return; }
    var txt=rows[0].textContent;
    var dateCell=rows[0].children[3] ? rows[0].children[3].textContent.trim() : '';
    R.inactiveRow=true;
    R.hasActivateBtn = txt.indexOf('Aktifkan')>=0;
    R.deactDate = dateCell;
    R.deactDateShown = !!dateCell && dateCell!=='—' && /\\d{4}/.test(dateCell);
    /* tombol Akun Nonaktif harus MENYALA (kelas glow-act) & sel aksi tidak redup */
    var glowBtns=rows[0].querySelectorAll('.staff-act.glow-act');
    R.glowBtnCount=glowBtns.length;
    R.glowOn=!!rows[0].querySelector('.staff-act.is-on.glow-act');
    R.glowDel=!!rows[0].querySelector('.staff-act.is-del.glow-act');
    var actTd=rows[0].querySelector('td.cell-actions');
    R.actionsNotDimmed=!!actTd && getComputedStyle(actTd).opacity==='1';
    step=4; return;
  }
  if(step===4){
    var panel=d.getElementById('profilePanel');
    if(!panel){ if(n>400) done({error:'panel Profil pribadi tidak tampil', R:R}); return; }
    R.noThemeSelect = !d.getElementById('pfTheme');
    R.noThemeLabel = panel.textContent.indexOf('Tema tampilan pribadi')<0;
    R.noSaveBtn = !q(d,'[data-action="profile-save"]');
    var phone=d.getElementById('pfPhone'), name=d.getElementById('pfName');
    if(!phone||!name){ done({error:'kolom profil tidak ada', R:R}); return; }
    R.nameBefore=name.value;
    name.value='Nama Profil Uji';
    name.dispatchEvent(new Event('input',{bubbles:true}));
    phone.value=PHONE;
    phone.dispatchEvent(new Event('input',{bubbles:true}));
    R.inputKept = phone.value===PHONE;
    step=5; return;
  }
  if(step===5){
    var t=d.getElementById('toast');
    if(t && /Profil pribadi/.test(t.textContent||'')){ R.toast=t.textContent; step=6; return; }
    if(n>400){ R.toast=(t?t.textContent:'(tanpa toast)'); step=6; return; }
    return;
  }
  if(step===6){
    /* kembali ke tab Akun Aktif — kolom No Telepon ada di tab itu */
    var tabs=Array.prototype.slice.call(d.querySelectorAll('[data-staff-tab]'));
    var activeTab=tabs.filter(function(b){return b.getAttribute('data-staff-tab')==='active'})[0];
    if(activeTab)activeTab.click();
    step=7; return;
  }
  if(step===7){
    step=8;
    /* kolom No Telepon ada & baris "Anda" sudah ikut terupdate seketika
       (syncSelfRow dipanggil app.js setelah Profil pribadi tersimpan) */
    var hd=d.getElementById('staffHead'), bd=d.getElementById('staffBody');
    R.phoneHeader=!!(hd&&/No Telepon/.test(hd.textContent||''));
    R.phoneInTable=!!(bd&&(bd.textContent||'').indexOf(PHONE)>=0);
    R.staffHeadText=hd?(hd.textContent||'').slice(0,120):'(thead tidak ada)';
    fetch('/api/profile',{headers:{authorization:'Bearer '+TOKEN}}).then(function(r){return r.json()}).then(function(j){
      var p=(j&&j.profile)||{};
      R.savedName=p.name; R.savedPhone=p.phone;
      var inp=f.contentDocument.getElementById('pfPhone');
      R.inputStillShows = !!inp && inp.value===PHONE;
      done(R);
    }).catch(function(e){ R.fetchError=String(e); done(R); });
    return;
  }
},200);
</script>`;

const file = join(process.cwd(), 'test-uji-ui.html');
writeFileSync(file, page, 'utf8');
const prof = mkdtempSync(join(tmpdir(), 'ui-'));
let dom = '';
try {
  dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--user-data-dir=' + prof, '--virtual-time-budget=40000', '--dump-dom', base + '/test-uji-ui.html'
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
} catch (e) {
  console.log('Chrome gagal: ' + String(e.message).slice(0, 400));
}
try { rmSync(file, { force: true }) } catch (e) {}
try { rmSync(prof, { recursive: true, force: true }) } catch (e) {}

const m = /RESULT:([\s\S]*?)<\/pre>/.exec(dom);
if (!m) { bad('tidak ada hasil dari halaman uji (DOM ' + dom.length + ' char)'); console.log(dom.slice(0, 600)); }
else {
  let R = null;
  try { R = JSON.parse(m[1].trim()) } catch (e) { bad('hasil bukan JSON: ' + m[1].slice(0, 400)) }
  if (R) {
    if (R.error) bad('error UI: ' + R.error);
    check(R.toggleFound === true, 'tombol Nonaktifkan tampil pada baris staf');
    check(R.confirmShown === true, 'modal konfirmasi penonaktifan muncul');
    check(R.movedOutOfActive === true, 'staf berpindah keluar dari tab Akun Aktif (count nonaktif=' + R.countInactive + ')');
    check(R.inactiveRow === true, 'staf muncul di tab Akun Nonaktif');
    check(R.hasActivateBtn === true, 'tab nonaktif memuat tombol Aktifkan');
    check(R.glowBtnCount >= 2 && R.glowOn === true && R.glowDel === true,
      'tombol Aktifkan & Hapus di Akun Nonaktif memakai gaya menyala (glow-act)');
    check(R.actionsNotDimmed === true, 'sel aksi tidak ikut redup (opacity 100%)');
    check(R.deactDateShown === true, 'tanggal penonaktifkan tampil: ' + R.deactDate);
    check(R.noThemeSelect === true, 'field "Tema tampilan pribadi" sudah dihapus (select pfTheme tidak ada)');
    check(R.noThemeLabel === true, 'label "Tema tampilan pribadi" tidak ada di panel profil');
    check(R.noSaveBtn === true, 'tombol "Simpan profil" sudah dihapus (penyimpanan sepenuhnya otomatis)');
    check(R.inputKept === true, 'nilai input diterima di kolom profil');
    check(/Profil pribadi/.test(R.toast || ''), 'toast simpan muncul: ' + R.toast);
    check(R.savedName === 'Nama Profil Uji', 'nama profil TERSIMPAN di server: ' + R.savedName);
    check(R.savedPhone === PHONE, 'telepon TERSIMPAN di server: ' + R.savedPhone);
    check(R.inputStillShows === true, 'kolom masih menampilkan nilai tersimpan (tidak kembali kosong)');
    check(R.phoneHeader === true, 'kolom No Telepon tersedia di tabel Staf & Role');
    check(R.phoneInTable === true, 'nomor telepon pemilik sesi langsung terupdate di tabel Staf & Role');
  }
}

console.log('');
console.log(failed === 0 ? 'HASIL UI: SEMUA LULUS' : 'HASIL UI: ' + failed + ' GAGAL');
process.exit(failed === 0 ? 0 : 1);
