# Uji API permission (dijalankan terhadap wrangler dev lokal, D1 lokal)
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8790'

function Call($method, $path, $body, $token) {
  $h = @{ 'content-type' = 'application/json' }
  if ($token) { $h['authorization'] = 'Bearer ' + $token }
  $p = @{ Uri = ($base + $path); Method = $method; Headers = $h; UseBasicParsing = $true; TimeoutSec = 30 }
  if ($body -ne $null) { $p.Body = ($body | ConvertTo-Json -Depth 8 -Compress) }
  try {
    return Invoke-RestMethod @p
  } catch {
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

$suf = Get-Random
$ownerMail = "owner.uji$suf@rasa.local"
$kitchenMail = "kitchen.uji$suf@rasa.local"

Write-Host "== 1. health =="
$h = Call 'GET' '/api/health'
if ($h.ok) { Ok "server hidup, db=$($h.db)" } else { Fail 'health'; exit 1 }

Write-Host "== 2. daftar owner =="
$r = Call 'POST' '/api/auth/request' @{ email = $ownerMail; purpose = 'register'; name = 'Owner Uji'; resto = 'Resto Uji' }
if (-not $r.otp) { Fail 'otp register tidak ada'; exit 1 }
$v = Call 'POST' '/api/auth/verify' @{ email = $ownerMail; code = $r.otp }
if (-not $v.token) { Fail 'token owner tidak ada'; exit 1 }
$ownerTok = $v.token
Ok "owner masuk (role=$($v.user.role))"

Write-Host "== 3. tambah staf kitchen =="
$s = Call 'POST' '/api/staff' @{ name = 'Kitchen Uji'; email = $kitchenMail; role = 'kitchen' } $ownerTok
if (-not $s.ok) { Fail 'tambah staf'; exit 1 }
$kuid = $s.user.id
Ok "staf $kuid"

Write-Host "== 3b. isi data restoran (bahan uji: data tetap utuh saat dicabut) =="
$seed = Call 'PUT' '/api/data' @{ payload = @{ reservations = @(@{ id = 'r1'; date = '2026-10-10'; guest = 'Budi' }); orders = @(@{ id = 'o1'; item = 'Nasi Goreng' }) }; changed = @('reservations', 'orders') } $ownerTok
if ($seed.ok -and (@($seed.applied) -contains 'reservations')) { Ok 'data reservasi & pesanan tersimpan' } else { Fail 'seed data'; exit 1 }

Write-Host "== 4. staf login (SEBELUM pencabutan) =="
$r2 = Call 'POST' '/api/auth/request' @{ email = $kitchenMail; purpose = 'login' }
if (-not $r2.otp) { Fail 'otp login staf'; exit 1 }
$v2 = Call 'POST' '/api/auth/verify' @{ email = $kitchenMail; code = $r2.otp }
if (-not $v2.token) { Fail 'token staf'; exit 1 }
$staffTok = $v2.token
if ($v2.permissions.reservations -contains 'read') { Ok 'awal: staf BOLEH membuka Reservasi' } else { Fail 'awal: staf tidak punya reservations' }

Write-Host "== 5. baca preset izin role (owner) =="
$p = Call 'GET' '/api/permissions' $null $ownerTok
if (-not $p.ok) { Fail 'get permissions'; exit 1 }
Ok ("preset role: " + (($p.matrix.PSObject.Properties.Name) -join ', '))
$eff = @{}
$p.matrix.kitchen.PSObject.Properties | ForEach-Object { $eff[$_.Name] = @($_.Value) }

Write-Host "== 6. owner MENCABUT wewenang Reservasi dari staf itu =="
$eff['reservations'] = @()
$users = @{}; $users[$kuid] = $eff
# kontrak baru: cukup kirim wewenang staf yang diubah (tanpa matriks role),
# dan hanya baris staf itu yang boleh diganti oleh server
$set = Call 'PUT' '/api/permissions' @{ users = $users } $ownerTok
if (-not $set.ok) { Fail 'set permissions'; exit 1 }
if ($set.users.$kuid.PSObject.Properties.Name -contains 'reservations') { Ok 'override tersimpan (user_perms)' } else { Fail 'override tidak tersimpan' }

Write-Host "== 6b. validasi ketat setiap centang (modul/aksi tak dikenal = tolak) =="
$bad = Call 'PUT' '/api/permissions' @{ users = @{ ($kuid) = @{ modul_ngawur = @('read') } } } $ownerTok
if ($bad.ok) { Fail 'modul ngawur diterima server!' } else { Ok "modul ngawur ditolak ($($bad.error))" }
$bad2 = Call 'PUT' '/api/permissions' @{ users = @{ ($kuid) = @{ kitchen = @('menghapus-semua') } } } $ownerTok
if ($bad2.ok) { Fail 'aksi ngawur diterima server!' } else { Ok "aksi ngawur ditolak ($($bad2.error))" }
$bad3 = Call 'PUT' '/api/permissions' @{ users = @{ ('usr_bukan_staf_kita') = @{ kitchen = @() } } } $ownerTok
if ($bad3.ok) { Fail 'staf restoran lain bisa disetel!' } else { Ok 'staf restoran lain ditolak' }

Write-Host "== 7. sesi staf yang sama TANPA login ulang =="
$me = Call 'GET' '/api/auth/me' $null $staffTok
if ($me.permissions.reservations -eq $null) { Fail 'permissions tidak ikut' }
elseif (@($me.permissions.reservations).Count -eq 0) { Ok 'izin staf langsung berubah: reservations = []' }
else { Fail "reservations staf masih: $(@($me.permissions.reservations) -join ',')" }

# PERUBAHAN PERILAKU: data TIDAK dipotong lagi. Staf tetap terhubung & data
# tetap utuh - yang dicabut hanya AKSES (menu/halaman) dan TULISAN (403).
$d = Call 'GET' '/api/data' $null $staffTok
if ($d.payload.PSObject.Properties.Name -contains 'reservations') { Ok 'data reservasi TETAP terkirim (tidak dipotong, tidak hilang)' } else { Fail 'data reservasi ikut hilang dari staf!' }
if ($d.payload.PSObject.Properties.Name -contains 'orders') { Ok 'data pesanan juga tetap utuh' } else { Fail 'data pesanan hilang' }

Write-Host "== 8. staf coba MENULIS data reservasi =="
$put = Call 'PUT' '/api/data' @{ payload = @{ reservations = @(@{ id = 'x' }) }; changed = @('reservations') } $staffTok
if (@($put.applied) -contains 'reservations') { Fail 'staf berhasil menulis reservasi!' } else { Ok 'tulisan reservasi DITOLAK server' }
$deniedKeys = @($put.denied | ForEach-Object { $_.key })
if ($deniedKeys -contains 'reservations') { Ok 'kunci yang ditolak dilaporkan (denied)' } else { Fail 'laporan denied kosong' }

Write-Host "== 9. staf coba buka API permission & staf =="
$gp = Call 'GET' '/api/permissions' $null $staffTok
if ($gp.ok) { Fail 'staf bisa membaca matriks permission' } else { Ok "GET /api/permissions ditolak" }
$gs = Call 'GET' '/api/staff' $null $staffTok
if ($gs.ok) { Fail 'staf bisa membaca daftar staf' } else { Ok "GET /api/staff ditolak" }

Write-Host "== 10. owner MENGEMBALIKAN wewenang =="
$eff2 = @{}
$p.matrix.kitchen.PSObject.Properties | ForEach-Object { $eff2[$_.Name] = @($_.Value) }
$users2 = @{}; $users2[$kuid] = $eff2
$set2 = Call 'PUT' '/api/permissions' @{ users = $users2 } $ownerTok
if (-not $set2.ok) { Fail 'set permissions (restore)' }
$me3 = Call 'GET' '/api/auth/me' $null $staffTok
if (@($me3.permissions.reservations) -contains 'read') { Ok 'wewenang KEMBALI tanpa login ulang' } else { Fail "kembali gagal: $(@($me3.permissions.reservations) -join ',')" }
$d3 = Call 'GET' '/api/data' $null $staffTok
if ($d3.payload.PSObject.Properties.Name -contains 'reservations') { Ok 'data reservasi tetap terbaca' } else { Fail 'data reservasi hilang' }

Write-Host "== 11. preset per role (kitchen kehilangan orders) - masih tersedia via API =="
$m2 = @{}
$p.matrix.PSObject.Properties | ForEach-Object {
  $role = $_.Name
  if ($role -eq 'owner') { return }
  $m = @{}
  $_.Value.PSObject.Properties | ForEach-Object { $m[$_.Name] = @($_.Value) }
  if ($role -eq 'kitchen') { $m['orders'] = @() }
  $m2[$role] = $m
}
$set3 = Call 'PUT' '/api/permissions' @{ matrix = $m2 } $ownerTok
if (-not $set3.ok) { Fail 'set preset role'; }
$me4 = Call 'GET' '/api/auth/me' $null $staffTok
if (@($me4.permissions.orders).Count -eq 0) { Ok 'preset role juga langsung berlaku (orders = [])' } else { Fail "orders masih: $(@($me4.permissions.orders) -join ',')" }
# kembalikan preset bawaan supaya uji berikutnya tidak terpengaruh
$reset = @{}
$p.matrix.PSObject.Properties | ForEach-Object {
  $role = $_.Name
  if ($role -eq 'owner') { return }
  $m = @{}
  $_.Value.PSObject.Properties | ForEach-Object { $m[$_.Name] = @($_.Value) }
  $reset[$role] = $m
}
$null = Call 'PUT' '/api/permissions' @{ matrix = $reset } $ownerTok

Write-Host "== 12. ketat antar-staf: cabut staf A tidak menyentuh staf B =="
$s2 = Call 'POST' '/api/staff' @{ name = 'Kitchen Kedua'; email = "kitchen2.uji$suf@rasa.local"; role = 'kitchen' } $ownerTok
if (-not $s2.ok) { Fail 'tambah staf kedua'; exit 1 }
$k2uid = $s2.user.id
$onlyA = @{}; $onlyA[$kuid] = @{ kitchen = @('read', 'update') }   # staf A: hanya kitchen
$setA = Call 'PUT' '/api/permissions' @{ users = $onlyA } $ownerTok
if (-not $setA.ok) { Fail 'set staf A'; exit 1 }
if ($setA.users.$k2uid) { Fail 'wewenang staf B ikut terganti!' } else { Ok 'staf B tidak tersentuh oleh perubahan staf A' }
$clean = @{}; $clean[$kuid] = $eff2
$null = Call 'PUT' '/api/permissions' @{ users = $clean } $ownerTok  # bersihkan

Write-Host ""
if ($script:failed) { Write-Host 'HASIL: ADA KEGAGALAN'; exit 1 } else { Write-Host 'HASIL: SEMUA LULUS' }
