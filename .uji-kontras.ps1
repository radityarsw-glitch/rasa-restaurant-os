# .uji-kontras.ps1 - mengukur rasio kontras (WCAG AA 4.5:1) label tombol terhadap
# latarnya di SEMUA tema. Membuktikan poin "warna tombol dibuat terang dan mudah dibaca".
#
# Jalankan dengan wrangler dev sudah hidup (port 8790) dan folder aset uji tersedia:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\.uji-kontras.ps1
# Folder aset dioverride lewat RASA_ASSETS (default %TEMP%\rasa-assets).

$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8790'
$assets = if ($env:RASA_ASSETS) { $env:RASA_ASSETS } else { Join-Path $env:TEMP 'rasa-assets' }
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'

function Ok($m) { Write-Host ("  [OK] " + $m) -ForegroundColor Green }
function Fail($m) { $script:failed++; Write-Host ("  [GAGAL] " + $m) -ForegroundColor Red }
$failed = 0

$probes = @(
  @{ label = 'tombol sekunder';     cls = 'btn' },
  @{ label = 'tombol utama';        cls = 'btn-primary' },
  @{ label = 'tombol berbahaya';    cls = 'btn-danger' },
  @{ label = 'tautan aksi';         cls = 'link-btn' },
  @{ label = 'aksi staf wewenang';  cls = 'staff-act is-perms' },
  @{ label = 'aksi staf hapus';     cls = 'staff-act is-del' },
  @{ label = 'aksi staf nonaktif';  cls = 'staff-act is-off' },
  @{ label = 'aksi staf aktifkan';  cls = 'staff-act is-on' }
)
$themes = @('espresso', 'forest', 'ocean', 'plum', 'coral', 'midnight')

$js = @'
<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><title>kontras</title>
<style>body{padding:14px}#probe{display:flex;gap:8px;flex-wrap:wrap}</style>
<div id="probe"></div>
<pre id="out">pending</pre>
<script>
var PROBES=__PROBES__, THEMES=__THEMES__;
function chan(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
function lum(c){return 0.2126*chan(c[0])+0.7152*chan(c[1])+0.0722*chan(c[2]);}
function ratio(a,b){var l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
function parse(c){var m=c.match(/[\d.]+/g);if(!m)return null;return [Number(m[0]),Number(m[1]),Number(m[2])];}
/* semua warna latar tombol: stop gradien (kecuali yang transparan) + warna dasar solid */
function backgrounds(el){
  var cs=getComputedStyle(el),out=[];
  var bi=cs.backgroundImage;
  if(bi&&bi!=='none'){ (bi.match(/rgba?\([^)]+\)/g)||[]).forEach(function(s){
    var a=(s.match(/[\d.]+/g)||[])[3];
    if(a!==undefined&&Number(a)<0.5) return;
    var p=parse(s); if(p) out.push(p);
  }); }
  var bc=parse(cs.backgroundColor);
  var al=(cs.backgroundColor.match(/[\d.]+/g)||[]);
  if(bc&&(!al[3]||Number(al[3])>0.4)) return out.concat([bc]);
  if(out.length) return out;
  var p=el.parentElement;   /* tanpa latar sendiri: pakai latar panel/halaman */
  while(p){
    var pcs=getComputedStyle(p), pa=(pcs.backgroundColor.match(/[\d.]+/g)||[]), pbc=parse(pcs.backgroundColor);
    if(pbc&&(!pa[3]||Number(pa[3])>0.8)) return [pbc];
    p=p.parentElement;
  }
  return [[255,255,255]];
}
function run(theme){
  document.documentElement.setAttribute('data-theme',theme);
  var probe=document.getElementById('probe'),rows=[];
  PROBES.forEach(function(it){
    var d=document.createElement('div'); d.className=it.cls; d.textContent='Aa';
    probe.appendChild(d);
    var fg=parse(getComputedStyle(d).color), worst=99, worstBg='';
    backgrounds(d).forEach(function(bg){var r=ratio(fg,bg); if(r<worst){worst=r;worstBg='rgb('+bg.join(',')+')';}});
    rows.push([theme,it.label,worst.toFixed(2),worstBg,worst>=4.5?'LULUS':'GAGAL'].join('|'));
    probe.removeChild(d);
  });
  return rows;
}
window.addEventListener('load',function(){
  var out=[];
  THEMES.forEach(function(t){out=out.concat(run(t))});
  document.getElementById('out').textContent=out.join('\n');
});
</script>
'@

Write-Host '== uji kontras warna tombol (WCAG AA 4.5:1) =='

if (-not (Test-Path (Join-Path $assets 'style.css'))) {
  Fail "folder aset tidak ada: $assets (salin berkas proyek ke sana atau set RASA_ASSETS)"
  exit 1
}
Ok "folder aset: $assets"

$page = $js.Replace('__PROBES__', ($probes | ConvertTo-Json -Compress)).Replace('__THEMES__', ($themes | ConvertTo-Json -Compress))
Set-Content -Path (Join-Path $assets 'test-kontras.html') -Value $page -Encoding UTF8
Ok 'halaman uji kontras dibuat'

try { Invoke-RestMethod ($base + '/api/health') -TimeoutSec 10 | Out-Null }
catch { Fail 'server wrangler dev belum hidup di port 8790'; exit 1 }
Ok 'server hidup'

$prof = Join-Path $env:TEMP ('kons-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$out = Join-Path $env:TEMP ('kons-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.txt')
$err = $out + '.err'
$arg = @('--headless=new', '--disable-gpu', '--no-first-run', ('--user-data-dir=' + $prof),
  '--virtual-time-budget=8000', '--dump-dom', ($base + '/test-kontras.html'))
Start-Process -FilePath $chrome -ArgumentList $arg -Wait -NoNewWindow `
  -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
$dom = Get-Content $out -Raw -ErrorAction SilentlyContinue
Remove-Item $prof -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $out, $err -Force -ErrorAction SilentlyContinue

$rows = @()
if ($dom) {
  $inside = [regex]::Match($dom, '<pre id="out">([\s\S]*?)</pre>').Groups[1].Value
  $rows = @($inside -split "`n" | Where-Object { $_ -match '\|' })
}
if (-not $rows.Count) { Fail 'halaman uji tidak menghasilkan ukuran'; exit 1 }

$min = 99.0
foreach ($r in $rows) {
  $p = $r -split '\|'
  $ratio = [double]$p[2]
  if ($ratio -lt $min) { $min = $ratio }
  if ($p[4] -eq 'GAGAL') { Fail ('{0} / {1}: kontras {2} (latar {3})' -f $p[0], $p[1], $p[2], $p[3]) }
}
Ok ('{0} pemeriksaan ({1} tema x {2} tombol), kontras terendah {3}:1' -f $rows.Count, $themes.Count, $probes.Count, $min.ToString('0.00'))
if ($min -ge 4.5) { Ok 'semua label tombol memenuhi WCAG AA (>= 4.5:1)' }
else { Fail ('kontras terendah di bawah 4.5:1') }

Write-Host ''
if ($failed -eq 0) { Write-Host 'HASIL: SEMUA LULUS' -ForegroundColor Green; exit 0 }
Write-Host ("HASIL: " + $failed + " GAGAL") -ForegroundColor Red; exit 1
