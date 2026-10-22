# Uji cepat: staf bisa memesan menu (gerbang aksi pesanan + tombol konsisten).
# Memeriksa alur penuh lewat API + headless Chrome terhadap wrangler dev --port 8790 --local:
#   1. Preset role: kasir punya pos:create, orders:update, reservations:update; menu read-only
#   2. Undang A sebagai Kasir -> terima -> izin sesuai preset
#   3. UI kasir di #menu: tombol "Pilih varian" -> modal varian -> keranjang -> bayar
#      (dulu diblokir "izin menambah Menu & produk" untuk semua produk bervarian)
#   4. Struk memakai harga varian; pesanan tercatat di server (dilihat owner)
#   5. Tombol mati disembunyikan: Tambah menu, chip-edit, Kosongkan pesanan
#   6. Negatif: staf tanpa izin orders|antar DITOLAK di depan (pesan izin, modal tak terbuka)
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8790'
$failed = 0
function Ok($m)  { Write-Host ("  [OK] " + $m) -ForegroundColor Green }
function Fail($m){ $script:failed++; Write-Host ("  [GAGAL] " + $m) -ForegroundColor Red }
function Call($method, $path, $body, $tok) {
  $h = @{ 'content-type' = 'application/json' }
  if ($tok) { $h['authorization'] = 'Bearer ' + $tok }
  $p = @{ Method = $method; Uri = ($base + $path); Headers = $h; UseBasicParsing = $true }
  if ($body -ne $null) { $p.Body = ($body | ConvertTo-Json -Depth 8) }
  try { $r = Invoke-WebRequest @p -TimeoutSec 20 } catch {
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      try { return ($_.ErrorDetails.Message | ConvertFrom-Json) } catch { }
    }
    if ($_.Exception.Response) {
      try {
        $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $txt = $sr.ReadToEnd()
        if ($txt) { return ($txt | ConvertFrom-Json) }
      } catch { }
    }
    return $null
  }
  try { return ($r.Content | ConvertFrom-Json) } catch { return $null }
}
function Register($mail, $name, $resto) {
  $r = Call 'POST' '/api/auth/request' @{ email = $mail; purpose = 'register'; name = $name; resto = $resto }
  if (-not $r.otp) { return $null }
  return Call 'POST' '/api/auth/verify' @{ email = $mail; code = $r.otp }
}
function JoinArr($v) { return (@($v) | ForEach-Object { $_ }) -join ',' }

Write-Host '== uji pemesanan menu oleh staf =='
try { Invoke-RestMethod ($base + '/api/health') -TimeoutSec 10 | Out-Null }
catch { Fail 'server wrangler dev belum hidup di port 8790'; exit 1 }
Ok 'server hidup'

$rand = Get-Random
$ownerMail = "owner.psn$rand@rasa.local"
$kasirMail  = "kasir.psn$rand@gmail.com"
$waiterMail = "waiter.psn$rand@gmail.com"

# --- 1. owner masuk ---
$owner = Register $ownerMail 'Owner Pesanan' 'Resto Pesanan'
if (-not $owner.token) { Fail 'login owner'; exit 1 }
$tokO = $owner.token
Ok ('owner masuk · restoran ' + $owner.restaurant.name)

# --- 2. seed produk: satu bervarian, satu tanpa varian ---
$prods = @(
  @{ id = 'pu1'; name = 'Kopi Susu Uji'; price = 32000; cat = 'Minuman'; type = 'Kopi'; sold = 5; stock = 40; available = $true; image = ''; variants = @(@{ name = 'Regular' }, @{ name = 'Large'; price = 38000 }) },
  @{ id = 'pu2'; name = 'Roti Uji'; price = 20000; cat = 'Pastry'; type = 'Roti'; sold = 2; stock = 15; available = $true; image = ''; variants = @() }
)
$seedP = Call 'PUT' '/api/data' @{ payload = @{ products = $prods }; changed = @('products') } $tokO
if ($seedP.ok -and (@($seedP.applied) -contains 'products')) { Ok 'produk bervarian & tanpa varian tersimpan' }
else { Fail ('seed produk gagal: ' + ($seedP | ConvertTo-Json -Compress)); exit 1 }

# --- 3. preset role (matriks dari server) ---
$perms = Call 'GET' '/api/permissions' $null $tokO
$mk = $perms.matrix.kasir
if ((@($mk.orders) -contains 'update') -and (@($mk.pos) -contains 'create')) { Ok 'preset kasir: orders:update & pos:create (bisa pesan)' }
else { Fail ('preset kasir orders=' + (JoinArr $mk.orders) + ' pos=' + (JoinArr $mk.pos)) }
if (@($mk.reservations) -contains 'update') { Ok 'preset kasir reservations:update (buat lalu bisa ubah/batal)' }
else { Fail ('preset kasir reservations=' + (JoinArr $mk.reservations)) }
if ((-not (@($mk.menu) -contains 'update')) -and (-not (@($mk.menu) -contains 'create'))) { Ok 'preset kasir menu tetap read-only' }
else { Fail 'preset kasir menu ikut berubah (harus tetap read-only)' }

# --- 4. undang A sebagai Kasir -> terima ---
$iv = Call 'POST' '/api/invitations' @{ email = $kasirMail; role = 'kasir' } $tokO
if (-not $iv.ok) { Fail ('undangan kasir gagal: ' + ($iv | ConvertTo-Json -Compress)); exit 1 }
$k = Register $kasirMail 'A Kasir' 'Resto Lain'
if (-not $k.token) { Fail 'login calon kasir'; exit 1 }
$tokK = $k.token
$mines = Call 'GET' '/api/invitations/mine' $null $tokK
$acc = Call 'POST' ('/api/invitations/' + $mines.items[0].id + '/accept') $null $tokK
if (-not $acc.ok) { Fail ('terima undangan gagal: ' + ($acc | ConvertTo-Json -Compress)); exit 1 }
$meK = Call 'GET' '/api/auth/me' $null $tokK
if ($meK.user.role -eq 'kasir' -and (@($meK.permissions.orders) -contains 'update') -and (-not (@($meK.permissions.menu) -contains 'update'))) {
  Ok 'kasir aktif: role kasir, orders:update, menu read-only'
} else {
  Fail ('izin kasir salah: role=' + $meK.user.role + ' orders=' + (JoinArr $meK.permissions.orders) + ' menu=' + (JoinArr $meK.permissions.menu))
}
if (@($meK.permissions.reservations) -contains 'update') { Ok 'kasir dapat reservations:update (preset baru)' }
else { Fail 'kasir tanpa reservations:update' }

# ================= UI headless Chrome =================
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) {
  Write-Host '  [LEWAT] Chrome tidak tersedia — uji frontend dilewati' -ForegroundColor Yellow
} else {
  $assets = if ($env:RASA_ASSETS) { $env:RASA_ASSETS } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  New-Item -ItemType Directory -Force -Path $assets | Out-Null

  function Invoke-Chrome($file) {
    $prof = Join-Path $env:TEMP ('psn-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    $out  = Join-Path $env:TEMP ('psn-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.txt')
    $errp = $out + '.err'
    $arg = @('--headless=new','--disable-gpu','--no-first-run',('--user-data-dir=' + $prof),
      '--virtual-time-budget=45000','--dump-dom',($base + '/' + $file))
    Start-Process -FilePath $chrome -ArgumentList $arg -Wait -NoNewWindow `
      -RedirectStandardOutput $out -RedirectStandardError $errp | Out-Null
    $dom = Get-Content $out -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $out,$errp -Force -ErrorAction SilentlyContinue
    $m = [regex]::Match($dom, '<pre id="out">([\s\S]*?)</pre>').Groups[1].Value
    try { return ($m | ConvertFrom-Json) } catch { return $null }
  }

  # ---------- A. kasir memesan produk bervarian sampai bayar ----------
  $bootA = @'
<!doctype html><meta charset="utf-8"><title>uji pesanan kasir</title>
<style>body{font:12px sans-serif;padding:8px}iframe{position:fixed;left:-6000px;top:0;width:1280px;height:900px}</style>
<div>memuat aplikasi…</div><pre id="out">pending</pre>
<script>
try{localStorage.setItem('restaurant-os:session','__TOKEN__');}catch(e){}
var f=document.createElement('iframe');f.src='/#menu';document.body.appendChild(f);
var n=0,ph=0,out={denied:[],steps:[]};
function q(s){var d=null;try{d=f.contentDocument}catch(e){}return d?d.querySelector(s):null}
function fin(){clearInterval(iv);out.done=1;document.getElementById('out').textContent=JSON.stringify(out);}
var iv=setInterval(function(){
  n++;
  var d=null;try{d=f.contentDocument}catch(e){}
  if(!d)return;
  var tst=(d.getElementById('toast')||{}).textContent||'';
  if(tst&&tst.indexOf('izin')>=0&&out.denied.indexOf(tst)<0)out.denied.push(tst);
  if(ph===0){
    var pick=q('[data-action^="pick-variant:"]');
    if(!pick){ if(n>90)fin(); return; }
    out.hasPick=true;
    out.addMenu=!!q('[data-action="add-menu"]');
    out.chipEdit=d.querySelectorAll('.chip-edit').length;
    pick.click();out.steps.push('pick');ph=1;return;
  }
  if(ph===1){
    var av=q('[data-action^="add-variant:"]');
    if(!av){ if(n>150){out.modal=false;fin();} return; }
    out.modal=true;
    /* pilih varian Large (harga 38000) supaya harga varian benar-benar teruji */
    var rads=d.querySelectorAll('.pv-list input[type="radio"]');
    if(rads.length>1&&rads[1].click)rads[1].click();
    av.click();out.steps.push('addvar');ph=2;return;
  }
  if(ph===2){
    var co=q('[data-action="checkout"]');
    if(!co){ if(n>200){out.cart=false;fin();} return; }
    out.cart=true;co.click();out.steps.push('checkout');ph=3;return;
  }
  if(ph===3){
    var pay=q('[data-action="pay-now"]');
    if(!pay){ if(n>250){out.checkout=false;fin();} return; }
    out.checkout=true;
    var nm=d.getElementById('coName');if(nm)nm.value='Kasir Uji';
    pay.click();out.steps.push('pay');ph=4;return;
  }
  if(ph===4){
    if(!q('.modal-success')&&n<360)return;
    out.paid=!!q('.modal-success');
    var mo=d.getElementById('myOrders');
    out.myOrderText=mo?(mo.textContent||'').slice(0,400):'';
    fin();return;
  }
},250);
</script>
'@
  $bootA = $bootA.Replace('__TOKEN__', $tokK)
  Set-Content -Path (Join-Path $assets '_uji-psn-kasir.html') -Value $bootA -Encoding UTF8
  $jA = Invoke-Chrome '_uji-psn-kasir.html'

  if ($jA) {
    if ($jA.hasPick) { Ok 'kasir melihat tombol "Pilih varian" di menu aktif' } else { Fail 'tombol Pilih varian tidak tampil untuk kasir' }
    if ($jA.modal) { Ok 'modal varian terbuka (sebelumnya diblokir izin Menu & produk)' } else { Fail 'modal varian tidak terbuka' }
    if ($jA.cart) { Ok 'varian masuk keranjang' } else { Fail 'keranjang tidak terisi' }
    if ($jA.checkout) { Ok 'modal keranjang & pembayaran terbuka' } else { Fail 'checkout tidak terbuka' }
    if ($jA.paid) { Ok 'pembayaran selesai — sukses modal tampil' } else { Fail 'pembayaran tidak selesai' }
    if ($jA.myOrderText -like '*Kasir Uji*') { Ok 'pesanan tampil di "Pesanan saya" (nama pembeli terbaca)' } else { Fail 'pesanan tidak muncul di panel pesanan saya' }
    if (@($jA.denied).Count -eq 0) { Ok 'tanpa satu pun toast "tidak punya izin" selama alur pesan' }
    else { Fail ('toast izin muncul: ' + (@($jA.denied) -join ' | ')) }
    if ($jA.addMenu -eq $false) { Ok 'tombol "Tambah menu" disembunyikan untuk kasir' } else { Fail 'tombol Tambah menu masih tampil untuk kasir' }
    if ($jA.chipEdit -eq 0) { Ok 'chip edit (✎) menu disembunyikan untuk kasir' } else { Fail ('chip edit masih tampil: ' + $jA.chipEdit) }
  } else { Fail 'Chrome A: keluaran kosong/tidak terbaca' }

  # ---------- B. halaman Pesanan kasir: tanpa tombol Kosongkan ----------
  $bootB = @'
<!doctype html><meta charset="utf-8"><title>uji halaman pesanan kasir</title>
<style>body{font:12px sans-serif;padding:8px}iframe{position:fixed;left:-6000px;top:0;width:1280px;height:900px}</style>
<div>memuat aplikasi…</div><pre id="out">pending</pre>
<script>
try{localStorage.setItem('restaurant-os:session','__TOKEN__');}catch(e){}
var f=document.createElement('iframe');f.src='/#orders';document.body.appendChild(f);
var n=0,out={};
var iv=setInterval(function(){
  n++;
  var d=null;try{d=f.contentDocument}catch(e){}
  if(!d)return;
  var marker=d.querySelector('[data-filter="Semua"]');
  if(!marker){ if(n>90){clearInterval(iv);out.rendered=false;document.getElementById('out').textContent=JSON.stringify(out);} return; }
  clearInterval(iv);
  out.rendered=true;
  out.clearBtn=!!d.querySelector('[data-action="clear-orders"]');
  document.getElementById('out').textContent=JSON.stringify(out);
},250);
</script>
'@
  $bootB = $bootB.Replace('__TOKEN__', $tokK)
  Set-Content -Path (Join-Path $assets '_uji-psn-orders.html') -Value $bootB -Encoding UTF8
  $jB = Invoke-Chrome '_uji-psn-orders.html'
  if ($jB) {
    if ($jB.rendered) { Ok 'halaman Pesanan terbuka untuk kasir' } else { Fail 'halaman Pesanan tidak termuat untuk kasir' }
    if ($jB.clearBtn -eq $false) { Ok 'tombol "Kosongkan" disembunyikan (kasir tanpa orders:delete)' } else { Fail 'tombol Kosongkan masih tampil untuk kasir' }
  } else { Fail 'Chrome B: keluaran kosong/tidak terbaca' }

  # ---------- C. negatif: staf tanpa orders|antar ditolak di depan ----------
  $ivW = Call 'POST' '/api/invitations' @{ email = $waiterMail; role = 'waiter' } $tokO
  if (-not $ivW.ok) { Fail 'undangan waiter gagal' } else {
    $w = Register $waiterMail 'W Uji' 'Resto Lain'
    if (-not $w.token) { Fail 'login calon waiter' } else {
      $tokW = $w.token
      $mw = Call 'GET' '/api/invitations/mine' $null $tokW
      $aw = Call 'POST' ('/api/invitations/' + $mw.items[0].id + '/accept') $null $tokW
      if (-not $aw.ok) { Fail 'terima undangan waiter gagal' } else {
        $uidW = $aw.user.id
        $setW = Call 'PUT' '/api/permissions' @{ users = @{ $uidW = @{ orders = @(); antar = @() } } } $tokO
        if ($setW.ok) { Ok 'owner mencabut orders & antar dari waiter (user_perms)' } else { Fail 'set permissions gagal' }
        $meW = Call 'GET' '/api/auth/me' $null $tokW
        if (@($meW.permissions.orders).Count -eq 0) { Ok 'izin waiter orders = [] terbaca di sesi' } else { Fail 'orders waiter tidak kosong' }

        $bootC = @'
<!doctype html><meta charset="utf-8"><title>uji tolak pesanan waiter</title>
<style>body{font:12px sans-serif;padding:8px}iframe{position:fixed;left:-6000px;top:0;width:1280px;height:900px}</style>
<div>memuat aplikasi…</div><pre id="out">pending</pre>
<script>
try{localStorage.setItem('restaurant-os:session','__TOKEN__');}catch(e){}
var f=document.createElement('iframe');f.src='/#menu';document.body.appendChild(f);
var n=0,ph=0,out={};
function q(s){var d=null;try{d=f.contentDocument}catch(e){}return d?d.querySelector(s):null}
var iv=setInterval(function(){
  n++;
  var d=null;try{d=f.contentDocument}catch(e){}
  if(!d)return;
  var tst=(d.getElementById('toast')||{}).textContent||'';
  if(tst)tst=tst.replace(/\s+/g,' ').trim();
  if(ph===0){
    var pick=q('[data-action^="pick-variant:"]');
    if(!pick){ if(n>90){clearInterval(iv);out.done=1;out.found=false;document.getElementById('out').textContent=JSON.stringify(out);} return; }
    out.found=true;pick.click();ph=1;return;
  }
  if(ph===1){
    if(q('.pv-list')){clearInterval(iv);out.done=1;out.modal=true;out.toast=tst;document.getElementById('out').textContent=JSON.stringify(out);return;}
    if(tst&&tst.indexOf('izin')>=0){clearInterval(iv);out.done=1;out.modal=false;out.toast=tst;document.getElementById('out').textContent=JSON.stringify(out);return;}
    if(n>150){clearInterval(iv);out.done=1;out.modal=false;out.toast=tst;document.getElementById('out').textContent=JSON.stringify(out);return;}
    return;
  }
},250);
</script>
'@
        $bootC = $bootC.Replace('__TOKEN__', $tokW)
        Set-Content -Path (Join-Path $assets '_uji-psn-tolak.html') -Value $bootC -Encoding UTF8
        $jC = Invoke-Chrome '_uji-psn-tolak.html'
        if ($jC) {
          if ($jC.found -and $jC.modal -eq $false) { Ok 'tanpa izin orders: modal varian TIDAK terbuka (ditolak di depan)' }
          else { Fail ('diharapkan ditolak, hasil: ' + ($jC | ConvertTo-Json -Compress)) }
          if ($jC.toast -like '*izin*') { Ok ('pesan jelas: "' + $jC.toast + '"') } else { Fail ('toast penolakan tidak muncul: "' + $jC.toast + '"') }
        } else { Fail 'Chrome C: keluaran kosong/tidak terbaca' }
      }
    }
  }
}

# --- 4b. pesanan kasir tercatat di server (dilihat dari owner) ---
$d = Call 'GET' '/api/data' $null $tokO
$order = @($d.payload.orders) | Where-Object { $_.guest -eq 'Kasir Uji' } | Select-Object -First 1
if ($order) {
  Ok ('pesanan tercatat di server: ' + $order.id + ' · ' + $order.total + ' · status ' + $order.status)
  $line = @($order.detail) | Where-Object { $_.name -like '*Kopi Susu Uji*' } | Select-Object -First 1
  if ($line -and $line.price -eq 38000) { Ok 'harga varian (Large 38000) dipakai di rincian — struk benar' }
  elseif ($line) { Fail ('harga rincian salah: ' + $line.price + ' (diharapkan 38000 varian Regular? cek pemilihan)') }
  else { Fail 'rincian item Kopi Susu Uji tidak ada di pesanan' }
} else {
  Fail 'pesanan kasir tidak ada di workspace server'
}

Remove-Item (Join-Path $assets '_uji-psn-kasir.html'),(Join-Path $assets '_uji-psn-orders.html'),(Join-Path $assets '_uji-psn-tolak.html') -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($failed -eq 0) { Write-Host 'HASIL: SEMUA LULUS' -ForegroundColor Green; exit 0 }
else { Write-Host ("HASIL: " + $failed + " GAGAL") -ForegroundColor Red; exit 1 }
