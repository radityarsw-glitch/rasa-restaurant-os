# Uji frontend (headless Chrome) terhadap wrangler dev lokal di port 8790
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8790'
# folder aset = folder yang disajikan `wrangler dev`. Bisa dioverride lewat
# RASA_ASSETS bila server dijalankan dari lokasi lain.
$assets = if ($env:RASA_ASSETS) { $env:RASA_ASSETS } else { Join-Path $env:TEMP 'rasa-assets' }
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$domDir = Join-Path $env:TEMP 'rasa-dom'
New-Item -ItemType Directory -Force -Path $domDir | Out-Null
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$today = Get-Date -Format 'yyyy-MM-dd'

function Call($method, $path, $body, $token) {
  $h = @{ 'content-type' = 'application/json' }
  if ($token) { $h['authorization'] = 'Bearer ' + $token }
  $p = @{ Uri = ($base + $path); Method = $method; Headers = $h; UseBasicParsing = $true; TimeoutSec = 30 }
  if ($body -ne $null) { $p.Body = ($body | ConvertTo-Json -Depth 8 -Compress) }
  try { return Invoke-RestMethod @p }
  catch {
    $txt = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $txt = $_.ErrorDetails.Message }
    $resp = $_.Exception.Response
    if ($resp) {
      if (-not $txt) {
        try {
          $sr = New-Object IO.StreamReader($resp.GetResponseStream())
          $txt = $sr.ReadToEnd()
        } catch { $txt = '' }
      }
      Write-Host ("  ! " + $method + ' ' + $path + ' -> ' + [int]$resp.StatusCode + ' ' + $txt)
      try { return ($txt | ConvertFrom-Json) } catch { return @{ ok = $false; error = $txt } }
    }
    throw
  }
}
function Ok($msg) { Write-Host ("  [OK] " + $msg) }
function Fail($msg) { Write-Host ("  [GAGAL] " + $msg); $script:failed = $true }
$script:failed = $false

function Dump($url, $file, $budget) {
  if (-not $budget) { $budget = 15000 }
  $prof = Join-Path $env:TEMP ('rasa-chrome-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $out = Join-Path $env:TEMP ('rasa-dom-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.txt')
  $err = $out + '.err'
  $a = @('--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    ('--user-data-dir=' + $prof), ('--virtual-time-budget=' + $budget), '--dump-dom', $url)
  Start-Process -FilePath $chrome -ArgumentList $a -Wait -NoNewWindow `
    -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
  $dom = (Get-Content $out -Raw -ErrorAction SilentlyContinue)
  if (-not $dom) { $dom = '' }
  Set-Content -Path (Join-Path $domDir $file) -Value $dom -Encoding UTF8
  if (-not $dom) { Write-Host ("  ! chrome kosong: " + (Get-Content $err -Raw -ErrorAction SilentlyContinue)) }
  Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $out, $err -Force -ErrorAction SilentlyContinue
  return $dom
}

Write-Host "== 1. siapkan restoran, data, & dua staf =="
$ownerMail = "owner.fe$((Get-Random))@rasa.local"
$r = Call 'POST' '/api/auth/request' @{ email = $ownerMail; purpose = 'register'; name = 'Owner FE'; resto = 'Resto FE' }
$v = Call 'POST' '/api/auth/verify' @{ email = $ownerMail; code = $r.otp }
if (-not $v.token) { Fail 'owner login'; exit 1 }
$ownerTok = $v.token

$svg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='90'><rect width='160' height='90' fill='%23c0623a'/><text x='12' y='52' font-size='20' fill='white'>RASA</text></svg>"
$seed = Call 'PUT' '/api/data' @{
  payload = @{
    reservations = @(
      @{ id = 'r1'; name = 'Nadia Putri';    date = $today; time = '00:10'; table = 12; guests = 4; status = 'ready' },
      @{ id = 'r2'; name = 'Aditya Prakoso'; date = $today; time = '00:20'; table = 4;  guests = 2; status = 'ready' },
      @{ id = 'r3'; name = 'Citra Maheswari';date = $today; time = '00:30'; table = 8;  guests = 6; status = 'preparing' }
    )
    orders = @(
      @{ id = 'o1'; resId = 'r1'; cls = 'preparing'; guest = 'Nadia Putri';     items = '2 item'; type = 'QR Meja 12'; total = 'Rp 86.000';  status = 'Diproses'; time = '12:42' },
      @{ id = 'o2'; resId = 'r2'; cls = 'served';    guest = 'Aditya Prakoso';  items = '1 item'; type = 'QR Meja 04'; total = 'Rp 42.000';  status = 'Selesai';  time = '12:39' },
      @{ id = 'o3'; resId = 'r3'; cls = 'ready';     guest = 'Citra Maheswari'; items = '3 item'; type = 'QR Meja 08'; total = 'Rp 137.000'; status = 'Siap';     time = '12:31' }
    )
    products = @(
      @{ id = 'p1'; name = 'Kopi Susu Gula Aren'; price = 32000; cat = 'Minuman'; type = 'Kopi'; sold = 48; stock = 40; variants = @(@{ name = 'Regular' }); image = $svg; available = $true },
      @{ id = 'p2'; name = 'Nasi Goreng Rasa';    price = 35000; cat = 'Makanan'; type = 'Makanan'; sold = 21; stock = 15; variants = @(); image = $svg; available = $true }
    )
  }
  changed = @('reservations', 'orders', 'products')
} $ownerTok
if (-not $seed.ok) { Fail 'seed data'; exit 1 }
Ok 'data reservasi (3, semua berpesanan), pesanan, & menu bergambar tersimpan'

$sFull = Call 'POST' '/api/staff' @{ name = 'Staf Lengkap'; email = "fe.full$((Get-Random))@rasa.local"; role = 'kitchen' } $ownerTok
$sRev  = Call 'POST' '/api/staff' @{ name = 'StafDicabut';  email = "fe.rev$((Get-Random))@rasa.local";  role = 'kitchen' } $ownerTok
if (-not $sFull.ok -or -not $sRev.ok) { Fail 'tambah staf'; exit 1 }
$uidRev = $sRev.user.id

function Login($email) {
  $a = Call 'POST' '/api/auth/request' @{ email = $email; purpose = 'login' }
  $b = Call 'POST' '/api/auth/verify' @{ email = $email; code = $a.otp }
  return $b.token
}
$tokFull = Login $sFull.user.email
$tokRev  = Login $sRev.user.email
if (-not $tokFull -or -not $tokRev) { Fail 'login staf'; exit 1 }
Ok 'dua staf kitchen masuk'

Write-Host "== 2. owner mencabut wewenang Reservasi dari staf kedua =="
$p = Call 'GET' '/api/permissions' $null $ownerTok
$eff = @{}
$p.matrix.kitchen.PSObject.Properties | ForEach-Object { $eff[$_.Name] = @($_.Value) }
$eff['reservations'] = @()
$users = @{}; $users[$uidRev] = $eff
$set = Call 'PUT' '/api/permissions' @{ users = $users } $ownerTok
if ($set.users.$uidRev.PSObject.Properties.Name -contains 'reservations') { Ok 'wewenang dicabut' } else { Fail 'cabut wewenang' }

# data TETAP utuh & tetap terkirim - yang hilang hanya akses menu/halaman
$dRev = Call 'GET' '/api/data' $null $tokRev
if ($dRev.payload.PSObject.Properties.Name -contains 'reservations') { Ok 'data reservasi staf tetap terkirim (tidak dipotong)' } else { Fail 'data reservasi hilang dari staf yang dicabut' }

Write-Host "== 3. halaman boot (set sesi lalu buka tautan langsung) =="
$boot = @'
<!doctype html><meta charset="utf-8"><title>boot</title><script>
(function(){
  var q=new URLSearchParams(location.search);
  var tok=q.get('token');
  if(tok){try{localStorage.setItem("restaurant-os:session",tok)}catch(e){}}
  location.replace(q.get('go')||"/");
})();
</script>
'@
Set-Content -Path (Join-Path $assets 'test-boot.html') -Value $boot -Encoding UTF8

# pencabutan langsung: halaman staf sendiri yang mencabut wewenangnya memakai
# token Owner - untuk menguji bahwa PANTAUAN IZIN (poll 20 detik) benar-benar
# menangkap perubahan tanpa login ulang.
$live = @'
<script>
/* RASA_REVOKER: uji pencabutan langsung dari halaman staf */
(function(){
  var q=new URLSearchParams(location.search);
  var ot=q.get('owner'), uid=q.get('uid');
  if(!ot||!uid) return;
  var tries=0;
  var iv=setInterval(function(){
    tries++;
    var s=window.RasaSession;
    if(!(s&&s.token&&s.ready)){ if(tries>400) clearInterval(iv); return; }
    clearInterval(iv);
    fetch('/api/permissions',{headers:{authorization:'Bearer '+ot}})
      .then(function(r){return r.json()})
      .then(function(p){
        var k=p.matrix&&p.matrix.kitchen||{}, eff={};
        Object.keys(k).forEach(function(m){eff[m]=k[m].slice()});
        eff.reservations=[];
        var users={}; users[uid]=eff;
        return fetch('/api/permissions',{method:'PUT',
          headers:{authorization:'Bearer '+ot,'content-type':'application/json'},
          body:JSON.stringify({users:users})});
      })
      .then(function(){ window.__revoked=true; })
      .catch(function(e){ window.__revoked='err: '+e.message; });
      /* tandai di DOM supaya hasil dump chrome bisa memeriksanya */
      var mark=function(){ var v=window.__revoked; if(v!==undefined) document.documentElement.setAttribute('data-revoked',String(v)); };
      setTimeout(function(){ var t=setInterval(function(){ mark(); if(window.__revoked!==undefined) clearInterval(t); },200); },0);
  },100);
})();
</script>
</body>
'@
$idx = Join-Path $assets 'index.html'
$ic = Get-Content $idx -Raw
if ($ic -notmatch 'RASA_REVOKER') {
  $ic = $ic -replace '</body>', $live
  Set-Content -Path $idx -Value $ic -Encoding UTF8
  Ok 'pemicu pencabutan langsung dipasang di index.html (aset uji)'
}
$img = @'
<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><title>img</title>
<div class="food-icon"><img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><rect width='40' height='20' fill='red'/></svg>"></div>
<div class="rm-photo"><img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><rect width='40' height='20' fill='blue'/></svg>"></div>
<pre id="out">pending</pre>
<script>
window.addEventListener("load",function(){
  var a=document.querySelector(".food-icon img"),b=document.querySelector(".rm-photo img");
  var ca=getComputedStyle(a),cb=getComputedStyle(b);
  document.getElementById("out").textContent=
    "food-icon object-fit="+ca.objectFit+" | rm-photo object-fit="+cb.objectFit+
    " | food-icon w="+ca.width+" | rm-photo w="+cb.width;
});
</script>
'@
Set-Content -Path (Join-Path $assets 'test-img.html') -Value $img -Encoding UTF8
Ok 'halaman boot & uji gambar dibuat di folder aset'

Write-Host "== 4. Chrome: staf LENGKAP buka #reservations =="
$domA = Dump ($base + '/test-boot.html?token=' + [uri]::EscapeDataString($tokFull) + '&go=' + [uri]::EscapeDataString('/#reservations')) 'res-ok.html'
if ($domA -match 'res-serve is-preparing') { Ok 'badge "sedang disiapkan dapur" tampil' } else { Fail 'badge preparing tidak ada' }
if ($domA -match 'res-serve is-served') { Ok 'badge "sudah disajikan" tampil' } else { Fail 'badge served tidak ada' }
if ($domA -match 'res-serve is-ready') { Ok 'badge "siap disajikan" tampil' } else { Fail 'badge ready tidak ada' }
if ($domA -match 'Telah melewati tenggat waktu') { Fail 'masih menampilkan "Telah melewati tenggat waktu" utk jadwal berpesanan' } else { Ok 'tidak ada "Telah melewati tenggat waktu" pada jadwal berpesanan' }
if ($domA -match 'data-page="reservations"[^>]*>\s*<span>[^<]*</span>\s*Reservasi') { Ok 'menu Reservasi terlihat' } else { Fail 'menu Reservasi hilang utk staf berhak' }
if ($domA -match 'res-serve-label') { Ok 'label status penyajian tampil di kartu' } else { Fail 'label status penyajian tidak ada' }
if ($domA -match 'tidak sesuai izin role Anda') { Fail 'masih ada toast penolakan push yang tidak perlu (kirim key tanpa izin tulis)' } else { Ok 'tidak ada toast push yang ditolak server' }

Write-Host "== 5. Chrome: staf DICABUT buka #reservations (tautan langsung) =="
$domB = Dump ($base + '/test-boot.html?token=' + [uri]::EscapeDataString($tokRev) + '&go=' + [uri]::EscapeDataString('/#reservations')) 'res-denied.html'
if ($domB -match 'Anda tidak punya izin') { Ok 'layar "Anda tidak punya izin" tampil' } else { Fail 'layar penolakan tidak tampil' }
if ($domB -match 'Tidak dapat dibuka karena wewenang|tidak dapat dibuka karena wewenang') { Ok 'keterangan penolakan muncul' } else { Fail 'keterangan penolakan hilang' }
$m = [regex]::Match($domB, '<button[^>]*data-page="reservations"[^>]*>')
if (-not $m.Success) { Ok 'menu Reservasi tidak ada di navigasi' }
elseif ($m.Value -match 'display:\s*none' -or $m.Value -match 'hidden') { Ok 'menu Reservasi disembunyikan dari navigasi' }
else { Fail 'menu Reservasi masih terlihat: ' + $m.Value }
if ($domB -match 'res-serve-label') { Fail 'data jadwal bocor ke staf tanpa izin' } else { Ok 'data reservasi tidak dirender utk staf tanpa izin' }

Write-Host "== 6. Chrome: uji CSS gambar (object-fit) =="
$domC = Dump ($base + '/test-img.html') 'img.html'
if ($domC -match 'food-icon object-fit=contain' -and $domC -match 'rm-photo object-fit=contain') { Ok 'gambar produk & kartu reservasi pakai object-fit: contain' } else {
  $line = [regex]::Match($domC, 'food-icon object-fit=[^<]*').Value
  Fail ('object-fit salah: ' + $line)
}

Write-Host "== 7. Chrome: pencabutan saat halaman staf SEDANG terbuka (tanpa login ulang) =="
$goLive = '/?owner=' + [uri]::EscapeDataString($ownerTok) + '&uid=' + [uri]::EscapeDataString($sFull.user.id) + '#reservations'
$urlLive = $base + '/test-boot.html?token=' + [uri]::EscapeDataString($tokFull) + '&go=' + [uri]::EscapeDataString($goLive)
$domD = Dump $urlLive 'res-live.html' 45000
if ($domD -match 'data-revoked="true"') { Ok 'pencabutan oleh Owner terjadi saat halaman terbuka' } else {
  $rv = [regex]::Match($domD, 'data-revoked="[^"]*"').Value
  Fail ('status pencabutan tidak diketahui: ' + $rv)
}
if ($domD -match 'Anda tidak punya izin') { Ok 'pantauan izin otomatis mengganti halaman jadi layar izin' } else { Fail 'halaman tidak berubah jadi layar izin setelah pencabutan' }
$m2 = [regex]::Match($domD, '<button[^>]*data-page="reservations"[^>]*>')
if ($m2.Success -and ($m2.Value -match 'display:\s*none' -or $m2.Value -match 'hidden')) { Ok 'menu Reservasi ikut disembunyikan otomatis' } else { Fail 'menu Reservasi masih terbuka setelah pencabutan' }
if ($domD -match 'Owner mencabut wewenang') { Ok 'notifikasi pencabutan muncul di layar staf' } else { Fail 'notifikasi pencabutan tidak muncul' }

Write-Host ""
if ($script:failed) { Write-Host 'HASIL: ADA KEGAGALAN'; exit 1 } else { Write-Host 'HASIL: SEMUA LULUS' }
