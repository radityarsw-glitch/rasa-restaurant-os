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
    $resp = $_.Exception.Response
    if ($resp) {
      $sr = New-Object IO.StreamReader($resp.GetResponseStream())
      $txt = $sr.ReadToEnd()
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

Write-Host "== 3b. isi data restoran (supaya pengujian strip punya data) =="
$seed = Call 'PUT' '/api/data' @{ payload = @{ reservations = @(@{ id = 'r1'; date = '2026-10-10'; guest = 'Budi' }); orders = @(@{ id = 'o1'; item = 'Nasi Goreng' }) }; changed = @('reservations', 'orders') } $ownerTok
if ($seed.ok -and (@($seed.applied) -contains 'reservations')) { Ok 'data reservasi & pesanan tersimpan' } else { Fail 'seed data'; exit 1 }

Write-Host "== 4. staf login (SEBELUM pencabutan) =="
$r2 = Call 'POST' '/api/auth/request' @{ email = $kitchenMail; purpose = 'login' }
if (-not $r2.otp) { Fail 'otp login staf'; exit 1 }
$v2 = Call 'POST' '/api/auth/verify' @{ email = $kitchenMail; code = $r2.otp }
if (-not $v2.token) { Fail 'token staf'; exit 1 }
$staffTok = $v2.token
if ($v2.permissions.reservations -contains 'read') { Ok 'awal: staf BOLEH membuka Reservasi' } else { Fail 'awal: staf tidak punya reservations' }

Write-Host "== 5. baca matriks permission (owner) =="
$p = Call 'GET' '/api/permissions' $null $ownerTok
if (-not $p.ok) { Fail 'get permissions'; exit 1 }
Ok ("role: " + (($p.matrix.PSObject.Properties.Name) -join ', '))
$eff = @{}
$p.matrix.kitchen.PSObject.Properties | ForEach-Object { $eff[$_.Name] = @($_.Value) }

Write-Host "== 6. owner MENCABUT wewenang Reservasi dari staf itu =="
$eff['reservations'] = @()
$users = @{}; $users[$kuid] = $eff
$set = Call 'PUT' '/api/permissions' @{ matrix = $p.matrix; users = $users } $ownerTok
if (-not $set.ok) { Fail 'set permissions'; exit 1 }
if ($set.users.$kuid.PSObject.Properties.Name -contains 'reservations') { Ok 'override tersimpan (user_perms)' } else { Fail 'override tidak tersimpan' }

Write-Host "== 7. sesi staf yang sama TANPA login ulang =="
$me = Call 'GET' '/api/auth/me' $null $staffTok
if ($me.permissions.reservations -eq $null) { Fail 'permissions tidak ikut' }
elseif (@($me.permissions.reservations).Count -eq 0) { Ok 'izin staf langsung berubah: reservations = []' }
else { Fail "reservations staf masih: $(@($me.permissions.reservations) -join ',')" }

$d = Call 'GET' '/api/data' $null $staffTok
if ($d.payload.PSObject.Properties.Name -contains 'reservations') { Fail 'data reservasi masih dikirim ke staf!' } else { Ok 'data reservasi TIDAK dikirim ke staf' }
if (@($d.stripped) -contains 'reservations') { Ok "stripped: $(@($d.stripped) -join ', ')" } else { Fail 'modul reservations tidak ada di stripped' }

Write-Host "== 8. staf coba MENULIS data reservasi =="
$put = Call 'PUT' '/api/data' @{ payload = @{ reservations = @(@{ id = 'x' }) }; changed = @('reservations') } $staffTok
if (@($put.applied) -contains 'reservations') { Fail 'staf berhasil menulis reservasi!' } else { Ok 'tulisan reservasi DITOLAK server' }

Write-Host "== 9. staf coba buka API permission & staf =="
$gp = Call 'GET' '/api/permissions' $null $staffTok
if ($gp.ok) { Fail 'staf bisa membaca matriks permission' } else { Ok "GET /api/permissions ditolak" }
$gs = Call 'GET' '/api/staff' $null $staffTok
if ($gs.ok) { Fail 'staf bisa membaca daftar staf' } else { Ok "GET /api/staff ditolak" }

Write-Host "== 10. owner MENGEMBALIKAN wewenang =="
$eff2 = @{}
$p.matrix.kitchen.PSObject.Properties | ForEach-Object { $eff2[$_.Name] = @($_.Value) }
$users2 = @{}; $users2[$kuid] = $eff2
$set2 = Call 'PUT' '/api/permissions' @{ matrix = $p.matrix; users = $users2 } $ownerTok
if (-not $set2.ok) { Fail 'set permissions (restore)' }
$me3 = Call 'GET' '/api/auth/me' $null $staffTok
if (@($me3.permissions.reservations) -contains 'read') { Ok 'wewenang KEMBALI tanpa login ulang' } else { Fail "kembali gagal: $(@($me3.permissions.reservations) -join ',')" }
$d3 = Call 'GET' '/api/data' $null $staffTok
if ($d3.payload.PSObject.Properties.Name -contains 'reservations') { Ok 'data reservasi kembali terbaca' } else { Fail 'data reservasi tidak kembali' }

Write-Host "== 11. uji matriks role (kitchen kehilangan orders) =="
$m2 = @{}
$p.matrix.PSObject.Properties | ForEach-Object {
  $role = $_.Name
  $m = @{}
  $_.Value.PSObject.Properties | ForEach-Object { $m[$_.Name] = @($_.Value) }
  if ($role -eq 'kitchen') { $m['orders'] = @() }
  $m2[$role] = $m
}
$set3 = Call 'PUT' '/api/permissions' @{ matrix = $m2; users = @{} } $ownerTok
if (-not $set3.ok) { Fail 'set matrix role'; }
$me4 = Call 'GET' '/api/auth/me' $null $staffTok
if (@($me4.permissions.orders).Count -eq 0) { Ok 'matriks role juga langsung berlaku (orders = [])' } else { Fail "orders masih: $(@($me4.permissions.orders) -join ',')" }

Write-Host ""
if ($script:failed) { Write-Host 'HASIL: ADA KEGAGALAN'; exit 1 } else { Write-Host 'HASIL: SEMUA LULUS' }
