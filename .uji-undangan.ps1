# Uji cepat: Fitur Undangan Staf lewat email (Gmail).
# Memeriksa alur penuh lewat API terhadap wrangler dev --port 8790 --local:
#   1. Owner mengundang Gmail + peran (validasi, cegah dobel)
#   2. Indang tersimpan pending sampai pemilik email yang sama masuk
#   3. Hanya pemilik email yang boleh menerima/menolak
#   4. Terima -> akun jadi staf dengan peran benar + izin role
#   5. Tolak -> tidak ada keanggotaan
#   6. Undangan sudah diproses tidak bisa diproses ulang
#   7. Pembatalan undangan oleh owner
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
    # PowerShell 5.1: badan respons error dibaca lewat ErrorDetails
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

Write-Host '== uji fitur undangan staf via Gmail =='
try { Invoke-RestMethod ($base + '/api/health') -TimeoutSec 10 | Out-Null }
catch { Fail 'server wrangler dev belum hidup di port 8790'; exit 1 }
Ok 'server hidup'

$rand = Get-Random
$ownerMail = "owner.inv$rand@rasa.local"
$calonMail = "calon.inv$rand@gmail.com"

# --- 1. owner mendaftar & masuk ---
$owner = Register $ownerMail 'Owner Undangan' 'Resto Undangan'
if (-not $owner.token) { Fail 'login owner'; exit 1 }
$tokO = $owner.token
$restoA = $owner.restaurant.id
Ok ('owner masuk · restoran ' + $owner.restaurant.name)

# --- 2. undangan dibuat (pending) ---
$iv = Call 'POST' '/api/invitations' @{ email = $calonMail; role = 'waiter'; note = 'shift malam' } $tokO
if ($iv.ok -and $iv.invitation.status -eq 'pending') { Ok ('undangan dibuat · status ' + $iv.invitation.status + ' · peran ' + $iv.invitation.roleLabel) }
else { Fail ('undangan tidak dibuat: ' + ($iv | ConvertTo-Json -Compress)) }
$invId = $iv.invitation.id

# --- 3. validasi input ---
$badEmail = Call 'POST' '/api/invitations' @{ email = 'bukan-email'; role = 'waiter' } $tokO
if ($badEmail -and $badEmail.ok -eq $false -and $badEmail.error -like '*email*') { Ok 'email tidak valid ditolak (400)' } else { Fail 'email tidak valid tidak ditolak' }
$badRole = Call 'POST' '/api/invitations' @{ email = "x$rand@gmail.com"; role = 'superuser' } $tokO
if ($badRole -and $badRole.ok -eq $false) { Ok 'role tidak dikenal ditolak (400)' } else { Fail 'role tidak dikenal tidak ditolak' }
$self = Call 'POST' '/api/invitations' @{ email = $ownerMail; role = 'waiter' } $tokO
if ($self -and $self.ok -eq $false) { Ok 'undangan ke diri sendiri ditolak' } else { Fail 'undangan ke diri sendiri tidak ditolak' }

# --- 4. undangan dobel ditolak ---
$dup = Call 'POST' '/api/invitations' @{ email = $calonMail; role = 'kasir' } $tokO
if ($dup -and $dup.ok -eq $false -and $dup.code -eq 'pending_exists') { Ok 'undangan pending dobel ditolak (409)' } else { Fail 'undangan dobel tidak ditolak' }

# --- 5. daftar undangan restoran ---
$list = Call 'GET' '/api/invitations' $null $tokO
if ($list.ok -and $list.pending -ge 1) { Ok ('daftar undangan memuat ' + $list.pending + ' pending') } else { Fail 'daftar undangan kosong' }

# --- 6. calon staf BELUM punya akun: undangan tetap tersimpan, tak terlihat oleh akun lain ---
$ownerMine = Call 'GET' '/api/invitations/mine' $null $tokO
if ($ownerMine.ok -and ($ownerMine.items | Where-Object { $_.id -eq $invId }).Count -eq 0) { Ok 'undangan orang lain tidak terlihat di /mine' } else { Fail 'undangan orang lain bocor di /mine' }

# --- 7. calon staf mendaftar dengan email yang diundang (jadi owner resto baru) ---
$calon = Register $calonMail 'Calon Waiter' 'Resto Calon'
if (-not $calon.token) { Fail 'login calon staf'; exit 1 }
$tokC = $calon.token
Ok 'calon staf masuk dengan email yang diundang'

# --- 8. notifikasi undangan muncul untuk pemilik email ---
$mine = Call 'GET' '/api/invitations/mine' $null $tokC
$target = @($mine.items | Where-Object { $_.id -eq $invId })
if ($target.Count -eq 1 -and $target[0].restaurantName -eq 'Resto Undangan' -and $target[0].roleLabel -eq 'Waiter') {
  Ok ('notifikasi undangan tampil: "' + $target[0].restaurantName + '" sebagai ' + $target[0].roleLabel)
} else { Fail ('undangan tidak muncul di /mine calon staf: ' + ($mine | ConvertTo-Json -Compress)) }

# --- 9. pemilik email lain TIDAK boleh menerima ---
$wrong = Call 'POST' ("/api/invitations/$invId/accept") @{} $tokO
if ($wrong -and $wrong.ok -eq $false -and $wrong.code -eq 'not_owner') { Ok 'pemilik lain ditolak saat menerima (403)' } else { Fail 'pemilik lain bisa menerima undangan' }

# --- 10. Terima -> keanggotaan aktif dengan peran benar ---
$acc = Call 'POST' ("/api/invitations/$invId/accept") @{} $tokC
if ($acc.ok -and $acc.status -eq 'accepted' -and $acc.user.role -eq 'waiter' -and $acc.user.restaurantId -eq $restoA) {
  Ok ('diterima -> staf ' + $acc.restaurant.name + ' sebagai ' + $acc.user.role)
} else { Fail ('terima gagal: ' + ($acc | ConvertTo-Json -Compress)) }
if ($acc.permissions -and $acc.permissions.orders -contains 'update' -and -not ($acc.permissions.pos -contains 'create')) {
  Ok 'izin role waiter ikut berlaku (orders:update, tanpa pos:create)'
} else { Fail 'izin hasil terima tidak sesuai preset waiter' }

# --- 11. Terima ulang ditolak (tidak diproses dua kali) ---
$acc2 = Call 'POST' ("/api/invitations/$invId/accept") @{} $tokC
if ($acc2 -and $acc2.ok -eq $false -and $acc2.code -eq 'already_processed') { Ok 'terima ulang ditolak (409)' } else { Fail 'undangan bisa diterima dua kali' }

# --- 12. owner melihat staf baru di daftarnya ---
$staff = Call 'GET' '/api/staff' $null $tokO
$baru = @($staff.items | Where-Object { $_.email -eq $calonMail })
if ($baru.Count -eq 1 -and $baru[0].role -eq 'waiter' -and $baru[0].status -eq 'active') {
  Ok 'staf baru tampil di daftar staf owner (aktif, role waiter)'
} else { Fail 'staf baru tidak ada di daftar staf owner' }

# --- 13. staf baru bisa masuk & permission terbaca dari restoran tujuan ---
$meC = Call 'GET' '/api/auth/me' $null $tokC
if ($meC.ok -and $meC.user.role -eq 'waiter' -and $meC.restaurant.id -eq $restoA) { Ok 'sesi calon staf langsung memakai peran & restoran baru' } else { Fail 'sesi tidak ikut berubah setelah terima' }

# --- 14. undangan kedua: ditolak oleh pemilik email ---
$iv2 = Call 'POST' '/api/invitations' @{ email = "calon2.$rand@gmail.com"; role = 'kitchen' } $tokO
$inv2Id = $iv2.invitation.id
$calon2 = Register "calon2.$rand@gmail.com" 'Calon Kitchen' 'Resto Dua'
if (-not $calon2.token) { Fail 'login calon staf 2'; exit 1 }
$rej = Call 'POST' ("/api/invitations/$inv2Id/reject") @{} $calon2.token
if ($rej.ok -and $rej.status -eq 'rejected') { Ok 'undangan ditolak -> status rejected' } else { Fail 'tolak gagal' }
$rej2 = Call 'POST' ("/api/invitations/$inv2Id/reject") @{} $calon2.token
if ($rej2 -and $rej2.ok -eq $false -and $rej2.code -eq 'already_processed') { Ok 'tolak ulang ditolak (409)' } else { Fail 'undangan bisa ditolak dua kali' }
$staff2 = Call 'GET' '/api/staff' $null $tokO
$hitung = @($staff2.items | Where-Object { $_.email -eq "calon2.$rand@gmail.com" }).Count
if ($hitung -eq 0) { Ok 'penolakan tidak menambah keanggotaan staf' } else { Fail 'penolakan tetap membuat staf' }

# --- 15. undangan ke email yang sudah jadi staf ditolak ---
$dupStaff = Call 'POST' '/api/invitations' @{ email = $calonMail; role = 'kasir' } $tokO
if ($dupStaff -and $dupStaff.ok -eq $false) { Ok 'undangan ke staf aktif ditolak (409)' } else { Fail 'undangan ke staf aktif diterima' }

# --- 16. pembatalan undangan oleh owner ---
$iv3 = Call 'POST' '/api/invitations' @{ email = "batal.$rand@gmail.com"; role = 'kasir' } $tokO
$rev = Call 'DELETE' ("/api/invitations/" + $iv3.invitation.id) $null $tokO
if ($rev.ok) { Ok 'undangan pending dibatalkan owner' } else { Fail 'pembatalan undangan gagal' }
$rev2 = Call 'DELETE' ("/api/invitations/" + $iv3.invitation.id) $null $tokO
if ($rev2 -and $rev2.ok -eq $false) { Ok 'pembatalan kedua ditolak (undangan sudah tidak ada)' } else { Fail 'undangan terhapus bisa dibatalkan lagi' }

# --- 17. audit log mencatat seluruh alur ---
$audit = Call 'GET' '/api/audit?limit=100' $null $tokO
$acts = ($audit.items | ForEach-Object { $_.action }) -join ','
foreach ($k in @('staff.invite.create','staff.invite.accept','staff.invite.reject','staff.invite.revoke')) {
  if ($acts -like "*$k*") { Ok ("audit log mencatat " + $k) } else { Fail ("audit log tidak mencatat " + $k) }
}

# ================= 18-21. frontend (headless Chrome) =================
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) {
  Write-Host '  [LEWAT] Chrome tidak tersedia — uji frontend dilewati' -ForegroundColor Yellow
} else {
  $assets = if ($env:RASA_ASSETS) { $env:RASA_ASSETS } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  New-Item -ItemType Directory -Force -Path $assets | Out-Null
  $rand2 = Get-Random
  $oMail2 = "ui.owner$rand2@rasa.local"
  $cMail2 = "ui.calon$rand2@gmail.com"
  $o2 = Register $oMail2 'Owner UI' 'Resto UI'
  if (-not $o2.token) { Fail 'login owner uji frontend'; exit 1 }
  $ivUi = Call 'POST' '/api/invitations' @{ email = $cMail2; role = 'kasir'; note = 'shift pagi' } $o2.token
  $invUiId = $ivUi.invitation.id
  $c2 = Register $cMail2 'Calon UI' 'Resto Lain'

  # --- 18. sisi pemilik: panel Undangan staf tampil di Pengaturan ---
  $bootOwner = @'
<!doctype html><meta charset="utf-8"><title>uji undangan owner</title>
<style>body{font:12px sans-serif;padding:8px}iframe{position:fixed;left:-6000px;top:0;width:1280px;height:900px}</style>
<div>memuat aplikasi…</div><pre id="out">pending</pre>
<script>
try{localStorage.setItem('restaurant-os:session','__TOKEN__');}catch(e){}
var f=document.createElement('iframe');f.src='/#settings';document.body.appendChild(f);
var n=0;
var iv=setInterval(function(){
  n++;
  var d=null;try{d=f.contentDocument}catch(e){}
  if(!d)return;
  var p=d.getElementById('invitePanel');
  if(!p){ if(n>90){clearInterval(iv);document.getElementById('out').textContent=JSON.stringify({panel:false});} return; }
  var txt=(p.textContent||'');
  var hasRow=txt.indexOf('__EMAIL__')>=0&&txt.indexOf('Menunggu')>=0;
  /* panel muncul lebih dulu; baris menyusul setelah GET /api/invitations selesai */
  if(!hasRow&&n<60) return;
  clearInterval(iv);
  var th=p.querySelectorAll('thead th').length;
  document.getElementById('out').textContent=JSON.stringify({
    panel:true,
    title:!!p.querySelector('.panel-title')&&p.querySelector('.panel-title').textContent.trim(),
    formBtn:!!d.querySelector('[data-action="invite-form-toggle"]'),
    sendBtn:!!d.querySelector('[data-action="invite-send"]'),
    emailField:!!d.getElementById('ivEmail'),
    roleOptions:d.querySelectorAll('#ivRole option').length,
    headers:th,
    hasEmailRow:txt.indexOf('__EMAIL__')>=0,
    statusMenunggu:txt.indexOf('Menunggu')>=0
  });
},250);
</script>
'@
  $bootOwner = $bootOwner.Replace('__TOKEN__', $o2.token).Replace('__EMAIL__', $cMail2)
  Set-Content -Path (Join-Path $assets '_uji-inv-owner.html') -Value $bootOwner -Encoding UTF8

  function Invoke-Chrome($file, $tag) {
    $prof = Join-Path $env:TEMP ('iv-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    $out  = Join-Path $env:TEMP ('iv-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.txt')
    $errp = $out + '.err'
    $arg = @('--headless=new','--disable-gpu','--no-first-run',('--user-data-dir=' + $prof),
      '--virtual-time-budget=25000','--dump-dom',($base + '/' + $file))
    Start-Process -FilePath $chrome -ArgumentList $arg -Wait -NoNewWindow `
      -RedirectStandardOutput $out -RedirectStandardError $errp | Out-Null
    $dom = Get-Content $out -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $out,$errp -Force -ErrorAction SilentlyContinue
    $m = [regex]::Match($dom, '<pre id="out">([\s\S]*?)</pre>').Groups[1].Value
    try { return ($m | ConvertFrom-Json) } catch { return $null }
  }

  $jOwner = Invoke-Chrome '_uji-inv-owner.html'
  if ($jOwner -and $jOwner.panel) {
    Ok ('panel Undangan staf tampil di Pengaturan (' + $jOwner.title + ')')
    if ($jOwner.formBtn -and $jOwner.sendBtn -and $jOwner.emailField) { Ok 'form undangan (email, kirim) tampil untuk pemilik' } else { Fail 'form undangan tidak lengkap' }
    if ($jOwner.roleOptions -eq 5) { Ok 'pilihan peran undangan memuat 5 role' } else { Fail ('pilihan peran hanya ' + $jOwner.roleOptions) }
    if ($jOwner.headers -eq 5) { Ok 'tabel undangan memuat 5 kolom' } else { Fail ('tabel undangan hanya ' + $jOwner.headers + ' kolom') }
    if ($jOwner.hasEmailRow -and $jOwner.statusMenunggu) { Ok 'undangan pending tampil di tabel dengan status Menunggu' } else { Fail 'undangan pending tidak tampil di tabel pemilik' }
  } else { Fail 'panel Undangan staf tidak tampil di halaman Pengaturan' }

  # --- 19-21. sisi calon staf: notifikasi muncul, tombol Terima bekerja ---
  $bootCalon = @'
<!doctype html><meta charset="utf-8"><title>uji undangan calon</title>
<style>body{font:12px sans-serif;padding:8px}iframe{position:fixed;left:-6000px;top:0;width:1280px;height:900px}</style>
<div>memuat aplikasi…</div><pre id="out">pending</pre>
<script>
try{localStorage.setItem('restaurant-os:session','__TOKEN__');}catch(e){}
var f=document.createElement('iframe');f.src='/#settings';document.body.appendChild(f);
var n=0,phase=0,out={};
var iv=setInterval(function(){
  n++;
  var d=null;try{d=f.contentDocument}catch(e){}
  if(!d)return;
  if(phase===0){
    var btn=d.querySelector('[data-action^="invite-accept:"]');
    if(!btn){
      if(n>100){clearInterval(iv);out.modal=false;document.getElementById('out').textContent=JSON.stringify(out);}
      return;
    }
    var txt=((d.querySelector('.modal-text')||{}).textContent||'').replace(/\s+/g,' ').trim();
    out.modal=true;
    out.text=txt.slice(0,140);
    out.hasAccept=!!btn;
    out.hasReject=!!d.querySelector('[data-action^="invite-reject:"]');
    out.acceptLabel=(btn.textContent||'').trim();
    out.rejectLabel=((d.querySelector('[data-action^="invite-reject:"]')||{}).textContent||'').trim();
    phase=1;btn.click();return;
  }
  if(phase===1){
    if(d.querySelector('[data-action^="invite-accept:"]'))return;
    out.closed=true;
    out.toast=((d.getElementById('toast')||{}).textContent||'').trim();
    out.staffPanelGone=!d.getElementById('invitePanel');
    clearInterval(iv);
    document.getElementById('out').textContent=JSON.stringify(out);
  }
},250);
</script>
'@
  $bootCalon = $bootCalon.Replace('__TOKEN__', $c2.token)
  Set-Content -Path (Join-Path $assets '_uji-inv-calon.html') -Value $bootCalon -Encoding UTF8

  $jCalon = Invoke-Chrome '_uji-inv-calon.html'
  if ($jCalon -and $jCalon.modal) {
    Ok 'notifikasi undangan otomatis tampil untuk calon staf saat masuk'
    if ($jCalon.text -like '*Resto UI*' -and $jCalon.text -like '*Kasir*') {
      Ok ('format notifikasi benar: "' + $jCalon.text + '"')
    } else { Fail ('format notifikasi salah: ' + $jCalon.text) }
    if ($jCalon.acceptLabel -eq 'Terima' -and $jCalon.rejectLabel -eq 'Tolak') { Ok 'tombol Terima & Tolak tampil' } else { Fail ('label tombol salah: ' + $jCalon.acceptLabel + '/' + $jCalon.rejectLabel) }
  } else { Fail 'notifikasi undangan tidak muncul untuk calon staf' }

  if ($jCalon -and $jCalon.closed) {
    Ok 'tombol Terima menutup notifikasi & memproses undangan'
    if ($jCalon.toast -like '*diterima*') { Ok ('toast konfirmasi: "' + $jCalon.toast + '"') } else { Fail ('toast konfirmasi tidak muncul: ' + $jCalon.toast) }
    $listUi = Call 'GET' '/api/invitations' $null $o2.token
    $invRow = @($listUi.items | Where-Object { $_.id -eq $invUiId })
    if ($invRow.Count -eq 1 -and $invRow[0].status -eq 'accepted') { Ok 'status undangan di server menjadi accepted' } else { Fail 'status undangan tidak berubah di server' }
    $staffUi = Call 'GET' '/api/staff' $null $o2.token
    $row = @($staffUi.items | Where-Object { $_.email -eq $cMail2 })
    if ($row.Count -eq 1 -and $row[0].role -eq 'kasir' -and $row[0].status -eq 'active') {
      Ok 'setelah tombol Terima: akun menjadi staf aktif role Kasir di daftar owner'
    } else { Fail 'tombol Terima tidak membentuk keanggotaan staf' }
  } else { Fail 'tombol Terima tidak memproses undangan di UI' }

  Remove-Item (Join-Path $assets '_uji-inv-owner.html'),(Join-Path $assets '_uji-inv-calon.html') -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($failed -eq 0) { Write-Host 'HASIL: SEMUA LULUS' -ForegroundColor Green; exit 0 }
Write-Host ("HASIL: " + $failed + " GAGAL") -ForegroundColor Red; exit 1
