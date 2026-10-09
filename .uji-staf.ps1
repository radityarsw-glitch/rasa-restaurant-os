# Uji cepat: halaman Staf & role dengan sesi login sungguhan.
# Memeriksa tombol Nonaktifkan / Aktifkan / Wewenang / Hapus tampil
# beserta warna latar & tulisannya (kontras berlawanan).
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8790'
$assets = if ($env:RASA_ASSETS) { $env:RASA_ASSETS } else { Join-Path $env:TEMP 'rasa-assets' }
$failed = 0
function Ok($m)  { Write-Host ("  [OK] " + $m) -ForegroundColor Green }
function Fail($m){ $script:failed++; Write-Host ("  [GAGAL] " + $m) -ForegroundColor Red }
function Call($method, $path, $body, $tok) {
  $h = @{ 'content-type' = 'application/json' }
  if ($tok) { $h['authorization'] = 'Bearer ' + $tok }
  $p = @{ Method = $method; Uri = ($base + $path); Headers = $h; UseBasicParsing = $true }
  if ($body -ne $null) { $p.Body = ($body | ConvertTo-Json -Depth 8) }
  try { $r = Invoke-WebRequest @p -TimeoutSec 20 } catch { return $null }
  try { return ($r.Content | ConvertFrom-Json) } catch { return $null }
}

Write-Host '== uji halaman Staf & role (sesi login) =='
try { Invoke-RestMethod ($base + '/api/health') -TimeoutSec 10 | Out-Null }
catch { Fail 'server wrangler dev belum hidup di port 8790'; exit 1 }
Ok 'server hidup'

$mail = "staf.btn$((Get-Random))@rasa.local"
$r = Call 'POST' '/api/auth/request' @{ email = $mail; purpose = 'register'; name = 'Owner Tombol'; resto = 'Resto Tombol' }
$v = Call 'POST' '/api/auth/verify' @{ email = $mail; code = $r.otp }
if (-not $v.token) { Fail 'login owner'; exit 1 }
$tok = $v.token
Ok 'owner login'

# tambah satu staf supaya barisnya muncul di tabel
$s = Call 'POST' '/api/staff' @{ name = 'Staf Uji Tombol'; email = "staf.btn2$((Get-Random))@rasa.local"; role = 'kitchen' } $tok
if (-not $s.ok) { Fail 'tambah staf'; exit 1 }
Ok 'staf ditambahkan'

$page = @"
<!doctype html><meta charset="utf-8"><title>boot staf login</title><script>
try{localStorage.setItem('restaurant-os:session','$tok');}catch(e){}
location.replace('/#settings');
</script>
"@
Set-Content -Path (Join-Path $assets 'test-staff-login.html') -Value $page -Encoding UTF8

$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$prof = Join-Path $env:TEMP ('sb-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$out  = Join-Path $env:TEMP ('sb-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.txt')
$err  = $out + '.err'
$arg = @('--headless=new','--disable-gpu','--no-first-run',('--user-data-dir=' + $prof),
  '--virtual-time-budget=15000','--dump-dom',($base + '/test-staff-login.html'))
Start-Process -FilePath $chrome -ArgumentList $arg -Wait -NoNewWindow `
  -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
$dom = Get-Content $out -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
if (-not $dom) { Fail 'DOM kosong'; exit 1 }

if ($dom -match 'Staf &amp; role') { Ok 'panel Staf & role tampil' } else { Fail 'panel Staf & role tidak tampil' }
foreach ($k in @('Nonaktifkan','Wewenang','Hapus')) {
  if ($dom.Contains($k)) { Ok ("tombol " + $k + " tampil") } else { Fail ("tombol " + $k + " tidak tampil") }
}
if ($dom.Contains('Tambah staf')) { Ok 'tombol Tambah staf tampil' } else { Fail 'tombol Tambah staf tidak tampil' }

# ukur warna terhitung tiap tombol staf (harus latar solid + tulisan berlawanan)
$probe = @'
<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><title>warna staf</title>
<style>body{padding:14px}#probe{display:flex;gap:8px;flex-wrap:wrap}</style>
<div id="probe"></div><pre id="out">pending</pre>
<script>
var ITEMS=[['Nonaktifkan','staff-act is-off'],['Aktifkan','staff-act is-on'],
           ['Wewenang','staff-act is-perms'],['Hapus','staff-act is-del']];
function chan(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
function lum(c){return 0.2126*chan(c[0])+0.7152*chan(c[1])+0.0722*chan(c[2]);}
function parse(c){var m=c.match(/[\d.]+/g);if(!m)return null;return [Number(m[0]),Number(m[1]),Number(m[2])];}
function ratio(a,b){var l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
function run(theme){
  document.documentElement.setAttribute('data-theme',theme);
  var probe=document.getElementById('probe'),rows=[];
  ITEMS.forEach(function(it){
    var d=document.createElement('div'); d.className=it[1]; d.textContent='Aa';
    probe.appendChild(d);
    var cs=getComputedStyle(d);
    var fg=parse(cs.color), bg=parse(cs.backgroundColor);
    var r=(fg&&bg)?ratio(fg,bg):0;
    rows.push([theme,it[0],cs.backgroundColor,cs.color,r.toFixed(2)].join('|'));
    probe.removeChild(d);
  });
  return rows;
}
window.addEventListener('load',function(){
  var out=[];
  ['espresso','forest','ocean','plum','coral','midnight'].forEach(function(t){out=out.concat(run(t))});
  document.getElementById('out').textContent=out.join('\n');
});
</script>
'@
Set-Content -Path (Join-Path $assets 'test-staff-warna.html') -Value $probe -Encoding UTF8

$prof2 = Join-Path $env:TEMP ('sw-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$out2  = Join-Path $env:TEMP ('sw-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.txt')
$err2  = $out2 + '.err'
$arg2 = @('--headless=new','--disable-gpu','--no-first-run',('--user-data-dir=' + $prof2),
  '--virtual-time-budget=8000','--dump-dom',($base + '/test-staff-warna.html'))
Start-Process -FilePath $chrome -ArgumentList $arg2 -Wait -NoNewWindow `
  -RedirectStandardOutput $out2 -RedirectStandardError $err2 | Out-Null
$dom2 = Get-Content $out2 -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
Remove-Item $prof2 -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $out2,$err2 -Force -ErrorAction SilentlyContinue
$m = [regex]::Match($dom2, '<pre id="out">([\s\S]*?)</pre>').Groups[1].Value
if (-not $m) { Fail 'pengukuran warna tidak menghasilkan data' }
else {
  $worst = 99.0
  foreach ($line in ($m -split "`n")) {
    if (-not $line.Trim()) { continue }
    $p = $line -split '\|'
    $ratio = [double]$p[4]
    if ($ratio -lt $worst) { $worst = $ratio }
    if ($ratio -lt 4.5) { Fail ('{0} / {1}: kontras {2} (latar {3}, teks {4})' -f $p[0],$p[1],$p[4],$p[2],$p[3]) }
  }
  if ($worst -ge 4.5) { Ok ('24 kombinasi warna tombol staf (6 tema), kontras terendah ' + $worst.ToString('0.00') + ':1') }
}

Write-Host ''
if ($failed -eq 0) { Write-Host 'HASIL: SEMUA LULUS' -ForegroundColor Green; exit 0 }
Write-Host ("HASIL: " + $failed + " GAGAL") -ForegroundColor Red; exit 1
