const SEED_ORDERS=[
 {id:'#RS-2841',guest:'Nadia Putri',items:'2 item',type:'QR Meja 12',total:'Rp 86.000',status:'Diproses',cls:'preparing',time:'12:42'},
 {id:'#RS-2840',guest:'Walk-in',items:'4 item',type:'POS · Meja 03',total:'Rp 214.000',status:'Siap',cls:'ready',time:'12:39'},
 {id:'#RS-2839',guest:'Bima Pratama',items:'1 item',type:'QR Meja 08',total:'Rp 42.000',status:'Dibayar',cls:'paid',time:'12:36'},
 {id:'#RS-2838',guest:'Salsa Aulia',items:'3 item',type:'QR Meja 05',total:'Rp 137.000',status:'Diproses',cls:'preparing',time:'12:31'},
 {id:'#RS-2837',guest:'Dito Mahendra',items:'2 item',type:'QR Meja 02',total:'Rp 95.000',status:'Dibayar',cls:'paid',time:'12:26'}
];
const pageNames={overview:'Ringkasan',orders:'Pesanan',reservations:'Reservasi',menu:'Menu & produk',kitchen:'Dapur / KDS',pelayan:'Antar Ke Meja',inventory:'Persediaan',recipes:'Resep / BOM',procurement:'Pengadaan',finance:'Keuangan',reports:'Laporan',settings:'Pengaturan'};
const money=n=>'Rp '+(Number(n)||0).toLocaleString('id-ID');
const parseRp=s=>parseInt(String(s||'').replace(/[^\d]/g,''),10)||0;
/* 6 pilihan tampilan warna (color grading) — disimpan di store.theme */
const THEMES=[
  {id:'espresso',name:'Espresso & Emas',desc:'Coklat premium hangat — warna bawaan',sw:['#221812','#c9a24b','#f6f0e6'],tc:'#f6f0e6'},
  {id:'forest',name:'Hutan Zamrud',desc:'Hijau alami yang segar & menenangkan',sw:['#0e2016','#3f9f6d','#e9f3ec'],tc:'#e9f3ec'},
  {id:'ocean',name:'Samudra Biru',desc:'Biru navy elegan & bersih',sw:['#0e1728','#3f7fd6','#eef2f9'],tc:'#eef2f9'},
  {id:'plum',name:'Anggur Mawar',desc:'Ungu mawar lembut & kekinian',sw:['#26121f','#c96a8b','#f8eff3'],tc:'#f8eff3'},
  {id:'coral',name:'Koral Laut',desc:'Merah segar khas restoran seafood',sw:['#270d07','#d1442f','#fdf1ed'],tc:'#fdf1ed'},
  {id:'midnight',name:'Midnight Neon',desc:'Mode gelap dengan aksen cyan',sw:['#0b0f15','#3ec7dc','#141a23'],tc:'#141a23'}
];
/* Workspace Ringkasan memakai riwayat penuh (live + arsip), sehingga tombol
   Kosongkan di Pesanan/Dapur tidak menghapus data ringkasan. */
function archivedOrders(){return Array.isArray(store.archive)?store.archive:[]}
function historyOrders(){return orders.concat(archivedOrders())}
function liveOrders(){return historyOrders().filter(o=>o.cls!=='cancelled')}
function salesTotal(){return liveOrders().reduce((n,o)=>n+parseRp(o.total),0)}
function avgTicket(){const l=liveOrders();return l.length?Math.round(salesTotal()/l.length):0}
/* ---------- Master meja & mesin ketersediaan reservasi ----------
   Status meja selalu dihitung dari data reservasi di store (bukan warna
   semata): satu meja dianggap terpakai bila ada reservasi aktif
   (bukan "Dibatalkan") yang rentang waktunya bertabrakan. */
const TABLE_COUNT=18;
const DEFAULT_TABLES=(function(){
  const caps=[2,2,4,4,4,4,4,4,6,6,6,6,8,8,8,8,10,10];
  return caps.map((cap,i)=>({no:i+1,capacity:cap}));
})();
const RES_DURATION_DEFAULT=120; /* menit — durasi standar sebuah reservasi */
function tablesMaster(){
  const t=(store&&Array.isArray(store.tables)&&store.tables.length)?store.tables:DEFAULT_TABLES;
  return t.filter(x=>x&&x.no).slice().sort((a,b)=>Number(a.no)-Number(b.no));
}
function tableCapacity(no){
  const t=tablesMaster().find(x=>Number(x.no)===Number(no));
  return t&&Number(t.capacity)>0?Number(t.capacity):4;
}
function activeReservations(){
  return (store.reservations||[]).filter(r=>r&&r.status!=='cancelled');
}
/* Akhir reservasi: pakai endTime bila valid, selain itu time + durasi */
function resEndMs(r){
  const s=resStart(r);
  if(!s)return null;
  const et=String((r&&r.endTime)||'');
  if(/^\d{1,2}:\d{2}$/.test(et)){
    const p=et.split(':');
    const e=new Date(s.getTime());
    e.setHours(Number(p[0])||0,Number(p[1])||0,0,0);
    if(e.getTime()>s.getTime())return e.getTime();
  }
  let mins=parseInt(r&&r.duration,10);
  if(!(mins>=15))mins=RES_DURATION_DEFAULT;
  return s.getTime()+mins*60000;
}
const rangesOverlap=(aS,aE,bS,bE)=>aS<bE&&bS<aE;
/* Cari reservasi aktif yang bentrok pada meja & rentang waktu tertentu */
function findResConflict(tableNo,date,startMs,endMs,excludeId){
  return activeReservations().find(r=>{
    if(excludeId!=null&&String(r.id)===String(excludeId))return false;
    if(String(r.date||'')!==String(date||''))return false;
    if(Number(r.table)!==Number(tableNo))return false;
    const s=resStart(r);
    if(!s)return false;
    return rangesOverlap(startMs,endMs,s.getTime(),resEndMs(r));
  })||null;
}
function tableStatusAt(no,date,startMs,endMs,excludeId){
  const conflict=findResConflict(no,date,startMs,endMs,excludeId);
  return conflict?{busy:true,conflict:conflict}:{busy:false,conflict:null};
}
/* Meja yang sedang terisi SEKARANG (dipakai Ringkasan & Antar Ke Meja) */
function usedTables(){
  const now=Date.now(),t={};
  activeReservations().forEach(r=>{
    const s=resStart(r);
    if(!s)return;
    if(now>=s.getTime()&&now<resEndMs(r))t[r.table]=1;
  });
  return Object.keys(t).length;
}
function channelStats(){
  const sum=arr=>arr.reduce((n,o)=>n+parseRp(o.total),0);
  const groups=[
    {icon:'⌗',name:'QR Self-service',list:liveOrders().filter(o=>/QR/i.test(o.type||''))},
    {icon:'▣',name:'POS Walk-in',list:liveOrders().filter(o=>/POS/i.test(o.type||''))},
    {icon:'▦',name:'Reservasi',list:liveOrders().filter(o=>/Reserv/i.test(o.type||''))}
  ];
  const base=Math.max(1,groups.reduce((n,g)=>n+sum(g.list),0));
  return groups.map(g=>({icon:g.icon,name:g.name,count:g.list.length,value:sum(g.list),
    share:Math.round(sum(g.list)/base*100)}));
}
function hasOperations(){return historyOrders().length>0||products.length>0||(store.reservations||[]).length>0}
/* Panel sambutan — hanya tampil selama semua data masih kosong */
function onboardPanel(){
  if(hasOperations())return '';
  return `<div class="panel onboard-panel"><div class="panel-head"><div><div class="panel-title">Restoran Anda masih baru</div><div class="panel-caption">Semua data masih kosong — mulai dari langkah pertama. Data yang Anda isi tersimpan otomatis dan tersinkron dengan akun email Anda — bisa dibuka lagi dari perangkat lain yang login dengan email sama.</div></div></div><div class="onboard-steps"><button class="onboard-step" data-page="settings"><b>1</b> Atur nama &amp; lokasi</button><button class="onboard-step" data-page="menu"><b>2</b> Tambah menu pertama</button><button class="onboard-step" data-action="booking"><b>3</b> Buat reservasi</button><button class="onboard-step" data-action="toggle-open"><b>4</b> Status buka / tutup</button></div></div>`;
}
function heading(title,subtitle,action='') {return `<div class="page-heading"><div><div class="eyebrow">${(store.restaurantName||'Restoran').toUpperCase()} · ${DATE_LABEL}</div><h1>${title}</h1><div class="subtitle">${subtitle}</div></div><div class="heading-actions"><button class="btn date-btn" data-action="date"><span class="btn-icon">▦</span> Hari ini⌄</button>${action}</div></div>`}
function stat(label,value,foot,icon,trend='') {return `<div class="stat-card"><div class="stat-top">${label}<span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot"><span class="trend ${trend.includes('−')?'warn':''}">${trend}</span>${foot}</div></div>`}
function tableRows(rows){return rows.map(o=>`<tr><td>${o.id}<span class="subcell">${o.guest}</span></td><td>${o.items}</td><td class="method">${o.type}</td><td>${o.total}</td><td><span class="status ${o.cls}">${o.status}</span></td><td>${o.time}</td></tr>`).join('')}
function orderTable(rows=orders){const body=rows.length?tableRows(rows):'<tr><td colspan="6" class="empty-state">Belum ada pesanan — daftar kosong.</td></tr>';return `<div class="panel orders-panel"><div class="panel-head"><div><div class="panel-title">Pesanan terbaru</div><div class="panel-caption">Order QR dan POS yang masuk hari ini</div></div><button class="link-btn" data-page="orders">Lihat semua →</button></div><div class="table-wrap"><table><thead><tr><th>ID Pesanan</th><th>Item</th><th>Channel</th><th>Total</th><th>Status</th><th>Waktu</th></tr></thead><tbody>${body}</tbody></table></div></div>`}
/* ---------- Tren penjualan ----------
   Titik grafik dihitung dari data pesanan per jam (08.00–20.00), garis putus-putus
   = rata-rata penjualan per jam, dan sumbu-Y mengikuti nilai tertinggi (bukan
   angka tetap). Karena itu grafik selalu "bergerak" mengikuti data terbaru. */
const CHART_START=8,CHART_END=20,CHART_W=600,CHART_H=125;
function salesSeries(){
  const n=CHART_END-CHART_START+1;
  const buckets=[];
  for(let i=0;i<n;i++)buckets.push(0);
  historyOrders().filter(o=>o.cls!=='cancelled').forEach(o=>{
    const m=/(\d{1,2}):(\d{2})/.exec(String(o.time||''));
    if(!m)return;
    let h=parseInt(m[1],10);
    if(!isFinite(h))return;
    h=Math.max(CHART_START,Math.min(CHART_END,h));
    buckets[h-CHART_START]+=parseRp(o.total);
  });
  return buckets;
}
function shortMoney(v){
  if(v>=1000000){const j=v/1000000;return (j%1?j.toFixed(1).replace('.',','):j)+' jt'}
  if(v>=1000)return Math.round(v/1000)+' rb';
  return String(Math.round(v));
}
function niceCeil(v){
  const steps=[50000,100000,250000,500000,750000,1000000,2000000,2500000,5000000,7500000,10000000,20000000,50000000,100000000];
  for(let i=0;i<steps.length;i++)if(steps[i]>=v)return steps[i];
  return Math.ceil(v/100000000)*100000000;
}
function smoothPath(pts){
  if(!pts.length)return '';
  if(pts.length===1)return 'M'+pts[0].x.toFixed(2)+' '+pts[0].y.toFixed(2);
  let d='M'+pts[0].x.toFixed(2)+' '+pts[0].y.toFixed(2);
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[i-1]||pts[i],p1=pts[i],p2=pts[i+1],p3=pts[i+2]||p2,t=.17;
    const c1x=p1.x+(p2.x-p0.x)*t,c1y=p1.y+(p2.y-p0.y)*t;
    const c2x=p2.x-(p3.x-p1.x)*t,c2y=p2.y-(p3.y-p1.y)*t;
    d+=' C'+c1x.toFixed(2)+' '+c1y.toFixed(2)+', '+c2x.toFixed(2)+' '+c2y.toFixed(2)+', '+p2.x.toFixed(2)+' '+p2.y.toFixed(2);
  }
  return d;
}
function chart(){
  const sales=salesTotal();
  const count=liveOrders().length;
  const series=salesSeries();
  const peak=Math.max.apply(null,series);
  const top=niceCeil(count?Math.max(1,peak):500000);   /* skala tetap wajar saat data masih kosong */
  const avg=series.reduce((n,v)=>n+v,0)/series.length;
  const xOf=i=>i/(series.length-1)*CHART_W;
  const yOf=v=>CHART_H-6-(v/top)*(CHART_H-14);
  const pts=series.map((v,i)=>({x:xOf(i),y:yOf(v)}));
  const line=smoothPath(pts);
  const area=line+' L'+CHART_W+' '+CHART_H+' L0 '+CHART_H+' Z';
  const grid=[top,top*.75,top*.5,top*.25].map(v=>'<div class="gridline"><span>'+shortMoney(v)+'</span></div>').join('');
  const labels=['08.00','10.00','12.00','14.00','16.00','18.00','20.00'].map(t=>'<span>'+t+'</span>').join('');
  const half=Math.floor(series.length/2);
  const early=series.slice(0,half).reduce((n,v)=>n+v,0);
  const late=series.slice(-half).reduce((n,v)=>n+v,0);
  let trendTxt='Menunggu data',trendCls='is-muted';
  if(count&&early===0&&late===0){trendTxt='Belum ada jam 08–20';trendCls='is-muted'}
  else if(count&&early===0){trendTxt='↗ Mulai terisi';trendCls='is-up'}
  else if(count){const pct=Math.round((late-early)/early*100);
    trendTxt=(pct>=0?'↗ Naik ':'↘ Turun ')+Math.abs(pct)+'%';
    trendCls=pct<0?'is-warn':'is-up'}
  const last=pts[pts.length-1];
  return `<div class="panel"><div class="panel-head"><div><div class="panel-title">Tren penjualan</div><div class="panel-caption">Penjualan per jam — ikut berubah mengikuti data pesanan</div></div><div class="legend"><span><i></i>Hari ini</span><span><i></i>Rata-rata / jam</span></div></div><div class="sales-summary"><div class="sales-total" data-count="${sales}">${money(sales)}</div><div class="sales-change">${count} transaksi</div><span class="chart-trend ${trendCls}">${trendTxt}</span></div><div class="chart${count?'':' is-empty'}"><div class="chart-grid">${grid}</div><svg viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" role="img" aria-label="Grafik penjualan per jam"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#c9a24b" stop-opacity=".2"/><stop offset="1" stop-color="#c9a24b" stop-opacity="0"/></linearGradient></defs><path class="area-today" d="${area}" fill="url(#fill)"/>${count?`<path class="line-avg" d="M0 ${yOf(avg).toFixed(2)} L${CHART_W} ${yOf(avg).toFixed(2)}" fill="none" stroke="#e6d5b4" stroke-width="2" vector-effect="non-scaling-stroke" stroke-dasharray="5 5"/>`:''}<path class="line-today" d="${line}" fill="none" stroke="#a97c2c" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>${count?`<circle class="dot-today" r="3.4" cx="${Math.max(0,last.x-4.5)}" cy="${last.y.toFixed(2)}"/>`:''}</svg><div class="chart-days">${labels}</div>${count?'':'<div class="chart-empty">Belum ada transaksi — grafik akan terisi otomatis saat pesanan masuk.</div>'}</div></div>`;
}
/* Animasi: garis "terbuka" dari kiri ke kanan tiap kali grafik dirender,
   lalu angka total penjualan ikut berhitung naik mengikuti data. */
function animateChart(){
  const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el=document.querySelector('.sales-total');
  if(!el||reduce)return;
  const target=parseInt(el.getAttribute('data-count'),10)||0;
  if(!target)return;
  const t0=(window.performance&&performance.now)?performance.now():0;
  const step=now=>{
    const p=Math.min(1,((typeof now==='number'?now:0)-t0)/900);
    el.textContent=money(Math.round(target*(1-Math.pow(1-p,3))));
    if(p<1)requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function channels(){const g=channelStats();return `<div class="panel"><div class="panel-head"><div><div class="panel-title">Penjualan per channel</div><div class="panel-caption">Kontribusi transaksi tersimpan</div></div><button class="link-btn" data-page="reports">Detail</button></div><div class="channel-list">${g.map((c,i)=>`<div class="channel-row"><span class="channel-icon">${c.icon}</span><div><div class="channel-name">${c.name}</div><div class="channel-orders">${c.count} pesanan</div></div><div class="channel-right"><div class="channel-value">${c.value>=1000000?(c.value/1000000).toFixed(2).replace('.',',')+' jt':Math.round(c.value/1000)+' rb'}</div><div class="channel-share">${c.share}% penjualan</div></div><div class="progress${i===1?' p2':i===2?' p3':''}"><i style="width:${c.share}%"></i></div></div>`).join('')}</div></div>`}
function inventory(){
  const low=products.filter(p=>(Number(p.stock)||0)<=10).slice(0,4);
  const rows=low.length?low.map(p=>{
    const st=Math.max(0,Math.min(100,Math.round((Number(p.stock)||0)/40*100)));
    const habis=(Number(p.stock)||0)<=0;
    return `<div class="ingredient"><div><div class="ingredient-name">${esc(p.name)}</div><div class="ingredient-meta">${esc(p.cat||'Menu')} · Min. 5 porsi</div></div><div class="ingredient-stock">${Number(p.stock)||0} porsi <b style="color:${habis?'var(--red)':'var(--gold-deep)'}">· ${habis?'Habis':'Menipis'}</b></div><div class="stockbar${habis?' low':''}"><i style="width:${st}%"></i></div></div>`;
  }).join(''):`<div class="empty-state">${products.length?'Semua stok menu aman — belum ada item yang menipis.':'Belum ada menu. Tambahkan produk pertama di halaman <b>Menu &amp; produk</b>.'}</div>`;
  return `<div class="panel"><div class="panel-head"><div><div class="panel-title">Perlu restock</div><div class="panel-caption">Item menu dengan stok menipis · dihitung dari data produk</div></div><button class="link-btn" data-page="inventory">Kelola stok →</button></div><div class="inventory-list">${rows}</div></div>`;
}
function ledger(){
  const rows=historyOrders().filter(o=>o.cls!=='cancelled').slice(-2).reverse();
  const body=rows.length?rows.map(o=>{
    const v=parseRp(o.total),ref=String(o.id||'').replace('#','');
    const akun=/QR/i.test(o.type||'')?'Bank / Gateway':(/Reserv/i.test(o.type||'')?'Titipan DP':'Kas kasir');
    return `<tr><td>${esc(ref)}</td><td class="account">${akun}</td><td class="amount debit">+ ${money(v)}</td></tr><tr><td>${esc(ref)}</td><td class="account">Pendapatan penjualan</td><td class="amount credit">− ${money(v)}</td></tr>`;
  }).join(''):'<tr><td colspan="3" class="empty-state">Belum ada jurnal — transaksi pertama akan tercatat otomatis di sini.</td></tr>';
  return `<div class="panel"><div class="panel-head"><div><div class="panel-title">Jurnal terbaru</div><div class="panel-caption">Pencatatan otomatis · Double-entry dari data pesanan</div></div><button class="link-btn" data-page="finance">Buku besar →</button></div><table class="ledger"><thead><tr><th>Transaksi</th><th>Akun</th><th style="text-align:right">Debit / Kredit</th></tr></thead><tbody>${body}</tbody></table>${rows.length?'<div class="ledger-foot"><span>Saldo debit & kredit seimbang</span><b>✓ Balanced</b></div>':''}</div>`;
}
function dashboard(){
  const sales=salesTotal();      /* termasuk arsip — tidak hilang saat workspace dikosongkan */
  const live=liveOrders();
  const g=channelStats();
  const resCount=(store.reservations||[]).length;   /* ikut tersinkron penuh; wewenang dicabut = akses ditutup, data tidak dihapus */
  const used=usedTables();
  const pct=Math.round(used/TABLE_COUNT*100);
  return `${heading(greeting(),'Berikut ringkasan operasional restoran Anda hari ini — ikut berubah mengikuti data pesanan, menu, dan reservasi. Semua perubahan tersimpan otomatis.','<button class="btn" data-action="refresh-dash"><span class="btn-icon">↻</span> Segarkan</button><button class="btn btn-danger" data-action="reset-data"><span class="btn-icon">↺</span> Reset Data</button>')}
  <div class="stats-grid">
    ${stat('Penjualan hari ini',money(sales),'dari '+live.length+' pesanan tercatat','↗',live.length?'↗ '+live.length+' transaksi':'—')}
    ${stat('Pesanan masuk',String(orders.length),g[0].count+' QR · '+g[1].count+' POS · '+resCount+' reservasi','▤',orders.filter(o=>o.cls==='preparing').length+' perlu diproses')}
    ${stat('Rata-rata transaksi',money(avgTicket()),'dari '+live.length+' transaksi','◉',live.length?live.length+' nota':'—')}
    ${stat('Meja terisi',used+' / '+TABLE_COUNT+' meja',pct+'% kapasitas restoran','▦',resCount+' reservasi tersimpan')}
  </div>
  ${onboardPanel()}
  <div class="dashboard-grid">${chart()}${channels()}</div><div style="margin-bottom:14px">${orderTable(historyOrders())}</div><div class="bottom-grid">${inventory()}${ledger()}</div>`
}
function ordersPage(){
  promoteDueScheduled();
  const total=orders.length;
  const prep=orders.filter(o=>o.cls==='preparing').length;
  const ready=orders.filter(o=>o.cls==='ready').length;
  const paid=orders.filter(o=>o.cls==='paid').length;
  const cancelled=orders.filter(o=>o.cls==='cancelled').length;
  const sched=orders.filter(o=>o.cls==='scheduled').length;
  const delivering=orders.filter(o=>o.cls==='delivering').length;
  const served=orders.filter(o=>o.cls==='served').length;
  return `${heading('Semua pesanan','Pantau dan kelola pesanan dari QR self-service dan POS.','<button class="btn" data-action="clear-orders"><span class="btn-icon">🗑</span> Kosongkan</button>')}
  <div class="stats-grid">${stat('Semua pesanan',String(total),'Tersinkron dengan akun email','▤','')}${stat('Perlu diproses',String(prep),'Masuk ke antrean dapur','♨','')}${stat('Siap disajikan',String(ready),'Menunggu diantar ke meja','✓','')}${stat('Sudah dibayar',String(paid),'Pembayaran lunas','◷','')}</div>
  <div class="filter-row"><button class="filter-chip selected" data-filter="Semua">Semua <b>${total}</b></button><button class="filter-chip" data-filter="Diproses">Diproses <b>${prep}</b></button><button class="filter-chip" data-filter="Siap">Siap <b>${ready}</b></button><button class="filter-chip" data-filter="Diantar">Diantar <b>${delivering}</b></button><button class="filter-chip" data-filter="Tersaji">Tersaji <b>${served}</b></button><button class="filter-chip" data-filter="Dibayar">Dibayar <b>${paid}</b></button><button class="filter-chip" data-filter="Dibatalkan">Dibatalkan <b>${cancelled}</b></button><button class="filter-chip" data-filter="Terjadwal">Terjadwal <b>${sched}</b></button></div>${orderTable(orders)}</div>`
}
/* Umur pesanan (menit) untuk KDS — Blok G */
function orderAgeMin(o){
  let at=Number(o&&o.at)||0;
  if(!at&&o&&/^\d{1,2}:\d{2}$/.test(String(o.time||''))){
    const p=String(o.time).split(':');
    const d=new Date();d.setHours(Number(p[0])||0,Number(p[1])||0,0,0);at=d.getTime();
    if(at>Date.now())at-=864e5;
  }
  if(!at)return -1;
  return Math.max(0,Math.floor((Date.now()-at)/60000));
}
function promoteDueScheduled(){
  const now=new Date();
  const today=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  const hhmm=nowHM();
  let changed=false;
  orders.forEach(o=>{
    if(o.cls!=='scheduled')return;
    const d=String(o.resDate||today),t=String(o.resTime||o.time||'00:00');
    if(d<today||(d===today&&t<=hhmm)){o.cls='paid';o.status='Dibayar';applyBom(o);changed=true}
  });
  if(changed){store.orders=orders;saveStore()}
}
function kitchenPage(){
  promoteDueScheduled();
  const scheduled=orders.filter(o=>o.cls==='scheduled').slice().sort((a,b)=>String((a.resDate||'')+(a.resTime||'')).localeCompare(String((b.resDate||'')+(b.resTime||''))));
  const incoming=orders.filter(o=>o.cls==='paid');
  const prep=orders.filter(o=>o.cls==='preparing');
  const ready=orders.filter(o=>o.cls==='ready');
  const itemsOf=o=>(o.detail&&o.detail.length)?o.detail.map(x=>'<li>'+x.qty+'× '+esc(x.name)+'</li>').join(''):'<li>'+esc(o.items||'')+'</li>';
  const ageTag=o=>{
    /* pesanan terjadwal: tampilkan sisa waktu sampai jam reservasi tiba
       (bukan lama sejak dibuat) agar tahu prioritas persiapan dapur */
    if(o.cls==='scheduled'){
      const cd=countdownOf({date:o.resDate||todayIso(),time:o.resTime||o.time});
      if(!cd)return '';
      const cls=cd.level==='far'?'':(cd.level==='soon'?'warm':'hot');
      return '<i class="ticket-age '+cls+'" data-sched="1" data-id="'+esc(String(o.id))+'">⏱ '+esc(cd.label)+'</i>';
    }
    const m=orderAgeMin(o);
    if(m<0)return '';
    const cls=m>=15?'hot':m>=8?'warm':'';
    return '<i class="ticket-age '+cls+'" data-at="'+(o.at||0)+'" data-id="'+esc(String(o.id))+'">⏱ '+m+' mnt</i>';
  };
  const ticket=(o,btn)=>'<div class="ticket'+(o.cls==='scheduled'?' ticket-res':'')+'"><div class="ticket-top"><span>'+esc(String(o.id))+'</span><span>'+esc(o.resTime||o.time||'')+'</span></div>'+
    '<small>'+(o.resDate?esc(fmtDate(o.resDate))+' · ':'')+esc(o.guest||'Walk-in')+' · '+esc(o.type||'')+'</small><ul>'+itemsOf(o)+'</ul>'+
    '<span class="ticket-status">'+(btn||'<span class="status ready">Menunggu diantar</span>')+ageTag(o)+'</span></div>';
  const col=(title,list,btnFn,empty)=>'<div class="kitchen-column"><h3>'+title+' <span class="nav-count">'+list.length+'</span></h3>'+
    (list.length?list.map(o=>ticket(o,btnFn?btnFn(o):'')).join(''):'<div class="empty-state">'+empty+'</div>')+'</div>';
  return `${heading('Kitchen display system','Pesanan reservasi muncul di kolom <b>Terjadwal</b> dan otomatis naik ke <b>Baru masuk</b> saat jam reservasi tiba. Setelah ditandai <b>Siap</b>, pesanan langsung muncul di workspace <b>Antar Ke Meja</b> untuk diambil pelayan dan diantar ke meja.','<button class="btn" data-action="clear-orders"><span class="btn-icon">🗑</span> Kosongkan</button><button class="btn" data-action="refresh-kitchen">↻ Segarkan</button>')}
  <div class="kitchen-board">
    ${col('Terjadwal (reservasi)',scheduled,o=>'<button class="btn btn-primary" data-action="start-prep:'+esc(String(o.id))+'">Mulai menyiapkan →</button>','Tidak ada pesanan terjadwal.')}
    ${col('Baru masuk',incoming,o=>'<button class="btn btn-primary" data-action="start-prep:'+esc(String(o.id))+'">Mulai menyiapkan →</button>','Belum ada pesanan baru.')}
    ${col('Sedang disiapkan',prep,o=>'<button class="btn" data-action="mark-ready:'+esc(String(o.id))+'">Tandai siap →</button>','Tidak ada antrean dapur.')}
    ${col('Siap disajikan',ready,null,'Belum ada yang siap. Setelah dapur menandai Siap, pesanan menunggu Acc pelayan di workspace Antar Ke Meja.')}
  </div>`
}
function advanceOrder(id,cls,status){
  const o=orders.find(x=>String(x.id)===String(id));
  if(!o){toast('Pesanan tidak ditemukan.');return}
  if(o.cls==='cancelled'){toast('Pesanan sudah dibatalkan.');return}
  const backup={cls:o.cls,status:o.status};
  o.cls=cls;o.status=status;
  store.orders=orders;
  if(!saveStore()){o.cls=backup.cls;o.status=backup.status;toast('Gagal menyimpan perubahan.');return}
  render(currentPage);
  toast(o.id+' → '+status+'.');
}
/* ---------- Workspace Antar Ke Meja ----------
   Alur penyajian: dapur menandai pesanan "Siap" → pesanan muncul di sini →
   pelayan meng-Acc ("Acc & antar") → makanan diantar ke meja → pelayan
   menandai "Sampai di meja" sehingga status pesanan menjadi Tersaji. */
function pelayanItems(o){
  return (o.detail&&o.detail.length)?o.detail.map(x=>'<li>'+x.qty+'× '+esc(x.name)+'</li>').join(''):'<li>'+esc(o.items||'')+'</li>';
}
function pelayanCard(o,btn){
  return '<div class="ticket"><div class="ticket-top"><span>'+esc(String(o.id))+'</span><span>'+esc(o.resTime||o.time||'')+'</span></div>'+
    '<small>'+(o.resDate?esc(fmtDate(o.resDate))+' · ':'')+esc(o.guest||'Walk-in')+' · '+esc(o.type||'')+'</small>'+
    '<ul>'+pelayanItems(o)+'</ul><span class="ticket-status">'+btn+'</span></div>';
}
function pelayanCol(title,list,btnFn,empty){
  return '<div class="kitchen-column"><h3>'+title+' <span class="nav-count">'+list.length+'</span></h3>'+
    (list.length?list.map(o=>pelayanCard(o,btnFn?btnFn(o):'')).join(''):'<div class="empty-state">'+empty+'</div>')+'</div>';
}
function pelayanPage(){
  promoteDueScheduled();
  const ready=orders.filter(o=>o.cls==='ready');
  /* data lama ber-status "Diantar" tetap tampil di kolom yang sama agar
     tidak ada pesanan hilang — statusnya langsung bisa ditandai Tersaji */
  const legacy=orders.filter(o=>o.cls==='delivering');
  const toServe=ready.concat(legacy);
  const served=orders.filter(o=>o.cls==='served');
  const prep=orders.filter(o=>o.cls==='preparing');
  const used=usedTables();
  const resList=sortedReservations().filter(r=>r.status!=='cancelled').slice(0,4);
  const resRows=resList.length?resList.map(r=>{
    const cap=tableCapacity(r.table);
    const end=endOfResLabel(r);
    return '<tr><td><b>'+esc(r.name||r.guest||'Tamu')+'</b><span class="subcell">'+esc(r.phone||'')+'</span></td>'+
    '<td>'+esc(fmtDate(r.date||''))+'<span class="subcell">'+esc(r.time||'')+(end?' – '+esc(end):'')+'</span></td>'+
    '<td>Meja '+esc(String(r.table))+'<span class="subcell">kap. '+cap+' orang</span></td>'+
    '<td>'+esc(String(r.people||r.guests||1))+' orang</td>'+
    '<td><span class="status '+(r.status==='ready'?'ready':'preparing')+'">'+(r.status==='ready'?'Terkonfirmasi':'Menunggu')+'</span></td></tr>';
  }).join('')
    :'<tr><td colspan="5" class="empty-state">Belum ada reservasi — tambah lewat halaman Reservasi.</td></tr>';
  return `${heading('Antar Ke Meja','Alur disederhanakan: pesanan <b>siap dari dapur</b> → pelayan menekan <b>Acc &amp; antar</b> → langsung ditandai <b>Tersaji</b>. Tidak ada tahap "sedang diantar" agar alur kerja tidak membingungkan.','<button class="btn" data-action="refresh-pelayan"><span class="btn-icon">↻</span> Segarkan</button>')}
  <div class="stats-grid">
    ${stat('Menunggu Acc pelayan',String(ready.length),'siap dari dapur · perlu diantar','✓',ready.length?'segera antar':'lancar')}
    ${stat('Sudah tersaji',String(served.length),'selesai diantar hari ini','☑',served.length?served.length+' meja':'belum ada')}
    ${stat('Sedang dimasak',String(prep.length),'masih di dapur','♨',prep.length?prep.length+' antrean':'lancar')}
    ${stat('Meja terisi',used+' / '+TABLE_COUNT,'berdasarkan reservasi aktif','▦',resList.length+' jadwal berikutnya')}
  </div>
  <div class="kitchen-board">
    ${pelayanCol('Siap diantar',toServe,o=>o.cls==='delivering'
      ?'<button class="btn" data-action="deliver-done:'+esc(String(o.id))+'">Sampai di meja ✓</button>'
      :'<button class="btn btn-primary" data-action="serve-order:'+esc(String(o.id))+'">Acc &amp; antar ✓</button>','Tidak ada pesanan yang menunggu. Semua sudah tersaji.')}
    ${pelayanCol('Selesai · tersaji',served,o=>'<span class="status served">Tersaji</span>','Belum ada pesanan selesai diantar.')}
  </div>
  <div class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Reservasi berikutnya</div><div class="panel-caption">Sambut tamu & siapkan meja sebelum pesanan diantar</div></div><button class="link-btn" data-page="reservations">Semua reservasi →</button></div>
    <div class="table-wrap"><table><thead><tr><th>Tamu</th><th>Jadwal</th><th>Meja</th><th>Orang</th><th>Status</th></tr></thead><tbody>${resRows}</tbody></table></div></div>`;
}
function endOfResLabel(r){
  const e=resEndMs(r);
  return e?fmtHm(e):'';
}
function reservationsPage(){
  promoteDueScheduled();
  const all=sortedReservations();
  const active=all.filter(r=>r.status!=='cancelled');
  const cancelled=all.filter(r=>r.status==='cancelled');
  const waiting=active.filter(r=>r.status!=='ready').length;
  const confirmed=active.length-waiting;
  const now=Date.now();
  const usedNow=usedTables();
  const free=Math.max(0,TABLE_COUNT-usedNow);
  const today=todayIso();
  const usedToday={};active.forEach(r=>{if(String(r.date)===today)usedToday[r.table]=1});
  const near=nearestReservation(active);
  const prog=!near?inProgressReservation(active):null;
  const progFlow=prog?resFlowOf(prog):null;
  const nextStrip=near
    ? '<div class="res-next lvl-'+near.cd.level+'"><span class="res-next-icon">⏱</span><div><b>Prioritas berikutnya · '+esc(near.res.name)+'</b><small>'+fmtDate(near.res.date)+' pukul '+esc(near.res.time)+' · Meja '+esc(String(near.res.table))+' (kap. '+tableCapacity(near.res.table)+' orang) · '+esc(String(near.res.guests))+' orang'+(near.res.status==='ready'?' · DP diterima':' · menunggu DP')+'</small></div><span class="res-next-time" data-cd-time="'+(resStart(near.res)?resStart(near.res).getTime():0)+'">'+esc(near.cd.label)+'</span></div>'
    : progFlow
      ? '<div class="res-next res-next-flow lvl-soon"><span class="res-next-icon">'+progFlow.icon+'</span><div><b>'+esc(prog.name)+' · '+esc(progFlow.label)+'</b><small>'+fmtDate(prog.date)+' pukul '+esc(prog.time)+' · Meja '+esc(String(prog.table))+' (kap. '+tableCapacity(prog.table)+' orang) · '+esc(String(prog.guests))+' orang · Pesanan '+esc(progFlow.ids)+'</small></div><span class="res-next-time is-flow">'+esc(progFlow.sub)+'</span></div>'
      : active.length
        ? '<div class="res-next is-empty"><span class="res-next-icon">▦</span><div><b>Belum ada jadwal mendatang</b><small>Semua jadwal sudah lewat dari waktu sekarang — periksa status pesanannya di kartu jadwal di bawah.</small></div></div>'
        : '<div class="res-next is-empty"><span class="res-next-icon">▦</span><div><b>Belum ada jadwal mendatang</b><small>Hitung mundur reservasi muncul di sini mengikuti tanggal &amp; jam yang dipilih pelanggan.</small></div></div>';
  const grid=active.length?active.map(bookingCard).join(''):emptyResBlock();
  const histPanel=cancelled.length
    ?'<div class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Riwayat reservasi</div><div class="panel-caption">Reservasi yang dibatalkan — <b>datanya tidak dihapus</b>, tetap tersimpan untuk arsip owner</div></div></div><div class="booking-grid">'+cancelled.map(bookingCard).join('')+'</div></div>'
    :'';
  return `${heading('Reservasi meja','Buat jadwal booking lengkap dengan pilihan meja &amp; menu — jadwal bisa diubah, dan pembatalan hanya menandai status "Dibatalkan" tanpa menghapus data.','<button class="btn btn-primary" data-action="booking"><span class="btn-icon">＋</span> Reservasi baru</button>')}
  <div class="stats-grid">${stat('Total reservasi',active.length+' booking','Tersimpan & tersinkron dengan akun','▦','')}${stat('Menunggu DP',waiting+' booking','Link pembayaran dikirim','◷','')}${stat('DP diterima',confirmed+' booking','Terkonfirmasi otomatis','✓','')}${stat('Meja terpakai',usedNow+' meja','Sisa '+free+' dari '+TABLE_COUNT+' meja','⌂',Object.keys(usedToday).length+' meja terpakai hari ini')}</div>
  ${tableStatusPanel()}
  <div class="panel"><div class="panel-head"><div><div class="panel-title">Jadwal reservasi</div><div class="panel-caption">Urut berdasarkan tanggal &amp; jam · hitung mundur <b>Dimulai dalam …</b> berdetak tiap detik, lalu otomatis berganti jadi <b>status pesanan</b> (disiapkan dapur / sudah disajikan) begitu pesanan mulai diolah</div></div><button class="btn date-btn" data-action="date">▦ ${active.length} jadwal</button></div>${nextStrip}<div class="booking-grid">${grid}</div></div>
  ${histPanel}`
}
/* Empty state reservasi (poin 13): informasi + tombol, bukan halaman kosong */
function emptyResBlock(){
  return '<div class="empty-block"><span class="empty-icon">▦</span><b>Belum ada reservasi</b><small>Belum ada reservasi yang dibuat untuk tanggal ini. Buat jadwal baru agar meja dan dapur bisa disiapkan lebih awal.</small><button class="btn btn-primary" data-action="booking"><span class="btn-icon">＋</span> Tambah Reservasi</button></div>';
}
/* Tampilan status meja: dihitung langsung dari data reservasi (bukan warna manual) */
function tableStatusPanel(){
  const now=Date.now(),today=todayIso();
  const list=tablesMaster();
  const chips=list.map(t=>{
    const no=Number(t.no),cap=tableCapacity(no);
    let busy=null,upcoming=null;
    activeReservations().forEach(r=>{
      if(Number(r.table)!==no)return;
      const s=resStart(r);
      if(!s)return;
      if(now>=s.getTime()&&now<resEndMs(r))busy=r;
      else if(!busy&&String(r.date)===today&&s.getTime()>now&&(!upcoming||s.getTime()<resStart(upcoming).getTime()))upcoming=r;
    });
    return '<div class="meja-chip '+(busy?'busy':'free')+'"><b>Meja '+String(no).padStart(2,'0')+'</b><small>kap. '+cap+' orang</small><span class="tbl-badge '+(busy?'busy':'free')+'">'+(busy?'Sudah dipesan':'Tersedia')+'</span>'+(busy?'<i>'+(busy.name||'Tamu')+' · '+esc(String(busy.time||''))+'</i>':(upcoming?'<i>berikutnya '+esc(String(upcoming.time||''))+'</i>':''))+'</div>';
  }).join('');
  return '<div class="panel" style="margin-bottom:14px"><div class="panel-head"><div><div class="panel-title">Status meja · saat ini</div><div class="panel-caption">Dihitung langsung dari data reservasi — hijau berarti meja siap dipakai, merah berarti sudah dipesan</div></div></div><div class="meja-grid">'+chips+'</div><div class="meja-legend"><span><i class="dot free"></i> Hijau = Tersedia</span><span><i class="dot busy"></i> Merah = Tidak tersedia / sudah dipesan</span></div></div>';
}
/* ---------- Menu produk: pemesanan & pembayaran ---------- */
/* ---------- Kategori & jenis produk ----------
   Kategori = kelompok besar (Makanan, Makanan ringan, Minuman, Pastry, Dessert…)
   Jenis    = rincian dalam kategori (Kopi, Non-kopi, Nasi, Teh, Kue…) */
const CATEGORIES=['Makanan','Makanan ringan','Minuman','Pastry','Dessert','Lainnya'];
function mapLegacyCat(s){
  const l=String(s||'').toLowerCase();
  if(!l)return '';
  if(/kopi|non-kopi|teh|jus|minuman|drink|milkshake|smoothie/.test(l))return 'Minuman';
  if(/roti|bread|bakery|kue|cake/.test(l))return 'Pastry';
  if(/dessert|gelato|es krim|ice cream|puding/.test(l))return 'Dessert';
  if(/ringan|snack|kudapan|keripik|fries/.test(l))return 'Makanan ringan';
  if(/makan|nasi|berat|rice|ayam|ikan|mie/.test(l))return 'Makanan';
  return '';
}
function applyCategory(p){
  if(!p)return '';
  const old=String(p.cat||'').trim();
  const exact=CATEGORIES.find(c=>c.toLowerCase()===old.toLowerCase());
  if(exact){p.cat=exact;return p.cat}
  const mapped=mapLegacyCat(old);
  if(mapped){
    if(!p.type&&old)p.type=old;   /* kategori lama ('Kopi') menjadi jenis */
    p.cat=mapped;
  }else{
    p.cat=old||'Lainnya';         /* kategori buatan sendiri tetap dipakai */
  }
  return p.cat;
}
const DEFAULT_PRODUCTS=[
  {id:'p1',name:'Kopi Susu Gula Aren',price:32000,cat:'Minuman',type:'Kopi',sold:48,stock:40,variants:[{name:'Regular'},{name:'Large',price:38000}],image:'',available:true},
  {id:'p2',name:'Matcha Latte',price:38000,cat:'Minuman',type:'Non-kopi',sold:26,stock:25,variants:[{name:'Regular'},{name:'Large',price:44000}],image:'',available:true},
  {id:'p3',name:'Croissant Butter',price:28000,cat:'Pastry',type:'Roti',sold:19,stock:12,variants:[],image:'',available:true},
  {id:'p4',name:'Nasi Ayam Kecombrang',price:52000,cat:'Makanan',type:'Nasi',sold:32,stock:15,variants:[{name:'Biasa'},{name:'Porsi besar',price:62000}],image:'',available:true},
  {id:'p5',name:'Burnt Cheesecake',price:42000,cat:'Dessert',type:'Kue',sold:14,stock:8,variants:[],image:'',available:true},
  {id:'p6',name:'Es Teh Leci',price:25000,cat:'Minuman',type:'Teh',sold:21,stock:0,variants:[],image:'',available:false}
];
let products=[];
const productById=id=>products.find(p=>p.id===id);
const productNote=p=>(p.cat||'Menu')+(p.type?' · '+p.type:'')+' · '+(p.sold||0)+' terjual';
const variantName=v=>typeof v==='string'?v:(v&&v.name)||'';
function variantPrice(p,v){
  const x=(p&&p.variants||[]).find(y=>variantName(y)===variantName(v));
  const pr=x&&typeof x==='object'?Number(x.price):0;
  return pr>0?pr:(p&&Number(p.price)||0);
}
function variantDelta(p,v){return variantPrice(p,v)-((p&&Number(p.price))||0)}
const isSoldOut=p=>!p||!p.available||!(p.stock>0);
/* Ikon produk tanpa emoji: foto produk bila ada, kalau tidak pakai inisial nama */
function productInitials(p){
  const words=String((p&&p.name)||'').trim().split(/\s+/).filter(Boolean);
  const ini=(words[0]?words[0][0]:'')+(words[1]?words[1][0]:'');
  return (ini||'R').toUpperCase();
}
function productThumb(p){
  if(p&&p.image)return '<img src="'+p.image+'" alt="'+esc(p.name||'')+'">';
  return '<span class="food-initials">'+esc(productInitials(p))+'</span>';
}
const lineKey=(id,variant)=>id+'|'+(variant||'');
const normKey=s=>String(s||'').indexOf('|')>=0?String(s):lineKey(String(s),'');
let cart={}; /* { key: {pid,variant,qty} } */
const cartLines=()=>Object.keys(cart).map(k=>{
  const c=cart[k],p=productById(c.pid);
  if(!p)return null;
  return {key:k,product:p,variant:c.variant||'',qty:c.qty,price:(Number(c.price)>0?Number(c.price):p.price),sub:(Number(c.price)>0?Number(c.price):p.price)*c.qty,label:p.name+(c.variant?' · '+c.variant:'')};
}).filter(Boolean);
const cartCount=()=>Object.keys(cart).reduce((n,k)=>n+cart[k].qty,0);
const cartTotal=()=>cartLines().reduce((n,l)=>n+l.sub,0);
const inCartQty=id=>Object.keys(cart).filter(k=>cart[k].pid===id).reduce((n,k)=>n+cart[k].qty,0);
function addToCart(id,variant,qty,price){
  const p=productById(id);if(!p)return;
  if(isSoldOut(p)){toast(p.name+' sedang habis.');return}
  qty=qty||1;
  const key=lineKey(id,variant);
  const cur=cart[key]?cart[key].qty:0;
  const room=(p.stock||0)-inCartQty(id);
  if(room<=0){toast('Stok '+p.name+' tinggal '+p.stock+'.');return}
  if(qty>room){qty=room;toast('Ditambahkan sesuai sisa stok: '+qty+'.')}
  const unit=Number(price)>0?Number(price):variantPrice(p,variant);
  cart[key]={pid:id,variant:variant||'',qty:cur+qty,price:unit};
  saveStore();
  render('menu',true);
  toast(p.name+(variant?' ('+variant+')':'')+' masuk keranjang · '+money(unit)+'.');
}
function subFromCart(key){
  const k=normKey(key);
  if(!cart[k])return;
  cart[k].qty-=1;
  if(cart[k].qty<=0)delete cart[k];
  saveStore();
  render('menu',true);
}
let pickingProduct='';
function openVariantPicker(id){
  const p=productById(id);if(!p)return;
  if(isSoldOut(p)){toast(p.name+' sedang habis.');return}
  if(!(p.variants||[]).length){addToCart(id,'',1);return}
  pickingProduct=id;
  const first=p.variants[0];
  const rows=p.variants.map((v,i)=>{
    const nm=variantName(v),pr=variantPrice(p,v),d=variantDelta(p,v);
    return '<label class="pv-row'+(i===0?' on':'')+'"><input type="radio" name="pvV" value="'+esc(nm)+'"'+(i===0?' checked':'')+'>'+
      '<span class="pv-name">'+esc(nm)+'</span>'+
      '<span class="pv-price">'+money(pr)+(d?'<i class="'+(d>0?'up':'down')+'">'+(d>0?'+':'−')+money(Math.abs(d))+'</i>':'')+'</span></label>';
  }).join('');
  openModal('<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">'+esc(productInitials(p))+'</span><div><b>'+esc(p.name)+'</b><small>'+esc(productNote(p))+'</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>'+
    (p.image?'<div class="modal-img"><img src="'+p.image+'" alt=""></div>':'')+
    '<span class="field-label">Pilih varian &amp; harga</span><div class="pv-list">'+rows+'</div>'+
    '<input type="hidden" id="pvVariant" value="'+esc(variantName(first))+'">'+
    '<div class="field-row"><label class="field"><span>Jumlah</span><input class="input" type="number" id="pvQty" min="1" max="'+(p.stock||1)+'" value="1"></label><label class="field"><span>Sisa stok</span><input class="input" value="'+(p.stock||0)+'" disabled></label></div>'+
    '<div class="pv-total">Total sementara <b id="pvTotal">'+money(variantPrice(p,first))+'</b></div>'+
    '<div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-primary" data-action="add-variant:'+p.id+'">Tambah ke keranjang</button></div>');
}
function updatePvTotal(){
  const p=productById(pickingProduct);if(!p)return;
  const v=fieldVal('pvVariant')||variantName(p.variants[0]);
  const q=parseInt(fieldVal('pvQty'),10)||1;
  const el=document.getElementById('pvTotal');
  if(el)el.textContent=money(variantPrice(p,v)*q);
}
function pvPickChanged(target){
  if(!target)return;
  if(target.name==='pvV'){
    const hid=document.getElementById('pvVariant');if(hid)hid.value=target.value;
    const rows=document.querySelectorAll('.pv-row');
    rows.forEach(r=>{const i=r.querySelector('input');r.classList.toggle('on',!!(i&&i.checked))});
  }
  updatePvTotal();
}
function confirmVariant(id){
  const p=productById(id);if(!p)return;
  const variant=fieldVal('pvVariant')||'';
  const qty=parseInt(fieldVal('pvQty'),10)||1;
  const price=variantPrice(p,variant);
  closeModal();
  addToCart(id,variant,qty,price);
}

/* ---------- Kelola menu: varian, stok, foto produk ---------- */
let pendingMenuImage='';
function menuFormBody(p){
  const variants=(p&&p.variants||[]).map(v=>variantName(v)+(typeof v==='object'&&Number(v.price)>0?':'+v.price:'')).join(', ');
  const preview=p&&p.image?p.image:'';
  const catOpts=CATEGORIES.concat(products.map(x=>x.cat).filter(c=>c&&CATEGORIES.indexOf(c)<0)).filter((v,i,a)=>a.indexOf(v)===i);
  const typeOpts=['Kopi','Non-kopi','Teh','Jus','Nasi','Ayam','Ikan','Mie','Roti','Kue','Snack'].concat(products.map(x=>x.type).filter(Boolean)).filter((v,i,a)=>a.indexOf(v)===i);
  return '<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">'+(p?esc(productInitials(p)):'＋')+'</span><div><b>'+(p?'Ubah menu':'Tambah menu baru')+'</b><small>Kategori, jenis, varian, stok, dan foto produk</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>'+
    '<div class="mf-grid">'+
      '<div class="mf-fields">'+
        '<div class="field-row"><label class="field"><span>Kategori</span><input class="input" id="mfCat" list="mfCatList" maxlength="20" placeholder="Minuman" value="'+esc(p?p.cat:'')+'"></label>'+
        '<label class="field"><span>Jenis</span><input class="input" id="mfType" list="mfTypeList" maxlength="20" placeholder="Kopi" value="'+esc(p?(p.type||''):'')+'"></label></div>'+
        '<label class="field"><span>Nama produk</span><input class="input" id="mfName" maxlength="44" placeholder="Contoh: Kopi Susu Gula Aren" value="'+esc(p?p.name:'')+'"></label>'+
        '<div class="field-row"><label class="field"><span>Harga (Rp)</span><input class="input" type="number" id="mfPrice" min="0" step="500" value="'+(p?p.price:'')+'" placeholder="32000"></label>'+
        '<label class="field"><span>Jumlah stok</span><input class="input" type="number" id="mfStock" min="0" value="'+(p?(p.stock||0):'')+'" placeholder="20"></label></div>'+
        '<label class="field"><span>Varian &amp; harga (pisahkan koma, format Nama:harga)</span><input class="input" id="mfVariants" maxlength="70" placeholder="Regular, Large:38000" value="'+esc(variants)+'"></label>'+
        '<label class="field"><span>Status penjualan</span><select class="input" id="mfStatus"><option value="on"'+(!p||p.available?' selected':'')+'>Tersedia</option><option value="off"'+(p&&!p.available?' selected':'')+'>Habis / nonaktif</option></select></label>'+
        '<datalist id="mfCatList">'+catOpts.map(c=>'<option value="'+esc(c)+'">').join('')+'</datalist>'+
        '<datalist id="mfTypeList">'+typeOpts.map(t=>'<option value="'+esc(t)+'">').join('')+'</datalist>'+
      '</div>'+
      '<div class="mf-media">'+
        '<span class="field-label">Foto produk</span>'+
        '<div class="mf-photo">'+(preview?'<img id="mfPreview" src="'+preview+'" alt="">':'<img id="mfPreview" alt="" style="display:none">')+'<span class="mf-photo-empty" id="mfPreviewEmpty"'+(preview?' style="display:none"':'')+'>＋</span></div>'+
        '<label class="btn mf-pick" for="mfImage"><span class="btn-icon">▣</span> Pilih gambar</label>'+
        '<input type="file" id="mfImage" accept="image/*" hidden>'+
        '<button class="btn btn-ghost" data-action="remove-menu-image">Hapus gambar</button>'+
        '<small>Foto dipotong jadi persegi 360px agar seragam dan ringan.</small>'+
      '</div>'+
    '</div>'+
    '<div class="modal-actions">'+(p?'<button class="btn btn-danger" data-action="delete-menu:'+p.id+'">Hapus menu</button>':'')+'<button class="btn" data-action="close-modal">Batal</button><button class="btn btn-primary" data-action="save-menu:'+(p?p.id:'new')+'">Simpan menu</button></div>';
}
function openMenuForm(id){
  const p=id&&id!=='new'?productById(id):null;
  pendingMenuImage=p?(p.image||''):'';
  openModal(menuFormBody(p||null));
  const n=document.getElementById('mfName');if(n)n.focus();
}
function handleMenuImage(file){
  if(!file)return;
  if(!/^image\//.test(file.type)){toast('Pilih file gambar (JPG atau PNG).');return}
  if(file.size>8*1024*1024){toast('Ukuran gambar maksimal 8 MB.');return}
  const reader=new FileReader();
  reader.onload=e=>cropSquare(e.target.result,360,url=>{
    pendingMenuImage=url;
    const pv=document.getElementById('mfPreview');
    if(pv){pv.src=url;pv.style.display='block'}
    const ph=document.getElementById('mfPreviewEmpty');if(ph)ph.style.display='none';
    toast('Foto siap — jangan lupa klik Simpan menu.');
  });
  reader.onerror=()=>toast('File gagal dibaca.');
  reader.readAsDataURL(file);
}
function saveMenu(id){
  const name=fieldVal('mfName');
  const price=parseInt(fieldVal('mfPrice'),10);
  const stock=parseInt(fieldVal('mfStock'),10);
  if(!name){toast('Nama produk wajib diisi.');return}
  if(isNaN(price)||price<0){toast('Harga tidak valid.');return}
  if(isNaN(stock)||stock<0){toast('Jumlah stok tidak valid.');return}
  const variants=fieldVal('mfVariants').split(',').map(s=>s.trim()).filter(Boolean).map(s=>{
    const bits=s.split(':');
    const nm=(bits[0]||'').trim().slice(0,18);
    if(!nm)return null;
    let pr=0;
    if(bits.length>1){const n=parseInt(bits.slice(1).join(':'),10);pr=isNaN(n)||n<0?0:n}
    return {name:nm,price:pr};
  }).filter(Boolean).slice(0,6);
  const rawCat=(fieldVal('mfCat')||'').trim();
  const catExact=CATEGORIES.find(c=>c.toLowerCase()===rawCat.toLowerCase());
  const data={
    name:name,price:price,stock:stock,variants:variants,
    cat:catExact||rawCat||'Lainnya',
    type:(fieldVal('mfType')||'').trim().slice(0,20),
    available:fieldVal('mfStatus')!=='off',
    image:pendingMenuImage
  };
  const isNew=(id==='new'||!id);
  let backup=null;
  if(isNew){products.push(Object.assign({id:'m'+Date.now(),sold:0},data))}
  else{const p=productById(id);if(!p){closeModal();toast('Produk tidak ditemukan.');return}backup=Object.assign({},p);Object.assign(p,data)}
  store.products=products;
  if(!saveStore()){toast('Gagal menyimpan — penyimpanan browser penuh.');if(isNew)products.pop();else Object.assign(productById(id),backup);return}
  closeModal();render('menu');
  toast(isNew?('Menu '+name+' ditambahkan.'):('Menu '+name+' diperbarui.'));
}
function deleteMenu(id){
  const i=products.findIndex(p=>p.id===id);
  if(i<0){closeModal();return}
  const name=products[i].name;
  products.splice(i,1);
  store.products=products;
  Object.keys(cart).forEach(k=>{if(cart[k].pid===id)delete cart[k]});
  if(!saveStore()){toast('Gagal menyimpan perubahan.');return}
  closeModal();render('menu');
  toast('Menu '+name+' dihapus.');
}
function clearMenuImage(){
  pendingMenuImage='';
  const pv=document.getElementById('mfPreview');
  if(pv){pv.removeAttribute('src');pv.style.display='none'}
  const ph=document.getElementById('mfPreviewEmpty');if(ph)ph.style.display='block';
}

/* ---------- Kosongkan semua data pesanan ---------- */
function askClearOrders(){
  const n=orders.length;
  if(!n){toast('Daftar pesanan sudah kosong.');return}
  openModal('<div class="modal-head"><span class="provider-mark" style="--pm:#8a3324">🗑</span><div><b>Kosongkan semua pesanan?</b><small>'+n+' pesanan dikosongkan dari workspace ini saja</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>'+
    '<p class="modal-text">Riwayat pada halaman <b>Pesanan</b> dan antrean <b>Kitchen display</b> akan dikosongkan (dipindahkan ke arsip). Data pada workspace <b>Ringkasan</b> — penjualan, rata-rata transaksi, channel, dan daftar pesanan terbaru — <b>tidak ikut terhapus</b> dan tetap tersimpan. Untuk menghapus semuanya, gunakan tombol <b>↺ Reset Data</b> di Ringkasan. Tindakan ini tidak bisa dibatalkan.</p>'+
    '<div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-danger" data-action="confirm-clear-orders">Ya, kosongkan</button></div>');
}
function clearOrders(){
  if(!orders.length){closeModal();toast('Daftar pesanan sudah kosong.');return}
  const backup=orders.slice();
  const archBackup=archivedOrders().slice();
  store.archive=archBackup.concat(orders); /* riwayat disimpan sebagai arsip ringkasan */
  orders.length=0; /* array yang sama dengan store.orders */
  store.orders=orders;
  if(!saveStore()){orders.push.apply(orders,backup);store.archive=archBackup;toast('Gagal menyimpan.');return}
  closeModal();
  render(currentPage);
  toast('Workspace Pesanan & dapur dikosongkan · data Ringkasan tetap tersimpan.');
}

/* ---------- Segarkan ringkasan ---------- */
function refreshDashboard(){
  store=loadStore();          /* baca ulang data terbaru dari perangkat */
  orders=store.orders;
  products=store.products;
  cart=store.cart||{};
  render('overview');
  if(window.RasaSync&&window.RasaSync.enabled){
    window.RasaSync.pull().then(()=>toast('Ringkasan disegarkan dari server · '+nowHM()));
  }else{
    toast('Ringkasan disegarkan · '+nowHM());
  }
}
/* ---------- Reset data (verifikasi 2 langkah) ---------- */
function askResetData(){
  const n=orders.length;
  openModal('<div class="modal-head"><span class="provider-mark" style="--pm:#8a3324">↺</span><div><b>Reset data operasional?</b><small>Langkah verifikasi 1 dari 2</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>'+
    '<p class="modal-text">Reset akan mengembalikan <b>semua data</b> ke kondisi awal: <b>penjualan kembali Rp 0</b> ('+n+' pesanan &amp; arsip dihapus, lalu dihitung ulang dari nol), <b>'+(store.reservations||[]).length+' reservasi</b>, <b>'+products.length+' menu</b> (termasuk foto &amp; varian), keranjang, serta pengaturan nama restoran, foto profil, dan tautan akun. Tema tampilan warna pilihan Anda tetap dipertahankan.</p>'+
    '<p class="modal-note">Belum ada yang dihapus — klik <b>Lanjutkan</b> bila ingin melanjutkan ke verifikasi terakhir.</p>'+
    '<div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-danger" data-action="reset-step1">Lanjutkan</button></div>');
}
function askResetConfirm(){
  openModal('<div class="modal-head"><span class="provider-mark" style="--pm:#8a3324">⚠</span><div><b>Yakin direset permanen?</b><small>Langkah verifikasi 2 dari 2</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>'+
    '<p class="modal-text">Ini konfirmasi terakhir. Seluruh data operasional akan <b>terhapus permanen</b>, penjualan <b>dimulai lagi dari Rp 0</b> dan dihitung ulang sejak awal. Tindakan ini tidak bisa dibatalkan.</p>'+
    '<div class="modal-actions"><button class="btn" data-action="close-modal">Batalkan reset</button><button class="btn btn-danger" data-action="confirm-reset">Ya, reset sekarang</button></div>');
}
function resetAllData(){
  const keepTheme=(store&&store.theme)||'espresso';
  let backup=null;
  try{backup=localStorage.getItem(STORE_KEY)}catch(e){}
  try{localStorage.removeItem(STORE_KEY)}catch(e){}
  store=freshStore();          /* kembali ke kondisi baru — semua data kosong */
  store.theme=keepTheme;       /* tema tampilan tetap dipakai */
  orders=store.orders;
  products=store.products;
  cart=store.cart||{};
  if(!saveStore()){
    if(backup){try{localStorage.setItem(STORE_KEY,backup)}catch(e){}}
    store=loadStore();orders=store.orders;products=store.products;cart=store.cart||{};
    applyTheme();
    closeModal();toast('Gagal menyimpan reset — data lama dipulihkan.');return;
  }
  applyTheme();
  currentPage='overview';
  closeModal();
  render('overview');
  toast('Data direset — semua data kembali kosong seperti baru dibuka.');
}
function nextOrderId(){
  let max=1000;
  historyOrders().forEach(o=>{const n=parseInt(String(o.id).replace(/\D/g,''),10);if(isFinite(n)&&n>max)max=n});
  return '#RS-'+(max+1);
}
function nowHM(){const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function cartBar(){
  const lines=cartLines();if(!lines.length)return '';
  const n=cartCount();
  const rows=lines.map(l=>'<div class="cart-line"><span class="cart-line-name" title="'+esc(l.label)+'">'+l.qty+'× '+esc(l.label)+'</span><span class="cart-line-sub">'+money(l.sub)+'</span><button class="cart-line-x" data-action="remove-line:'+l.key+'" title="Buang dari keranjang" aria-label="Buang '+esc(l.label)+'">×</button></div>').join('');
  return '<div class="cart-bar"><div class="cart-bar-info"><b>'+n+' item dipilih</b><span>Total '+money(cartTotal())+'</span></div>'+
    '<div class="cart-lines">'+rows+'</div>'+
    '<div class="cart-bar-actions"><button class="btn btn-ghost" data-action="clear-cart">Buang keranjang</button><button class="btn btn-primary" data-action="checkout">Lihat keranjang &amp; bayar →</button></div></div>';
}
function removeLine(key){
  const k=normKey(key);
  if(!cart[k]){toast('Item sudah tidak ada di keranjang.');return}
  const p=productById(cart[k].pid);
  delete cart[k];
  saveStore();
  render('menu',true);
  toast((p?p.name:'Item')+' dibuang dari keranjang.');
}
function clearCart(){
  if(!cartCount()){toast('Keranjang sudah kosong.');return}
  cart={};
  saveStore();
  render('menu',true);
  toast('Keranjang dikosongkan.');
}
function productCard(p){
  const out=isSoldOut(p);
  const qty=inCartQty(p.id);
  const variants=p.variants||[];
  let control;
  if(out){control='<span class="status pending">Habis</span>'}
  else if(variants.length){
    control=(qty?'<span class="picked">✓ '+qty+' di keranjang</span>':'')+'<button class="btn btn-add" data-action="pick-variant:'+p.id+'">＋ Pilih varian</button>';
  }
  else if(qty>0){
    const k=lineKey(p.id,'');
    control='<div class="stepper"><button class="step" data-action="cart-sub:'+k+'" aria-label="Kurangi">−</button><b>'+qty+'</b><button class="step" data-action="cart-add:'+k+'" aria-label="Tambah">＋</button></div>';
  }
  else{control='<button class="btn btn-add" data-action="cart-add:'+p.id+'">＋ Tambah</button>'}
  const badge=out?'<span class="status pending">Habis</span>':'<span class="avail yes">Tersedia</span><span class="stock-badge">Stok '+(p.stock||0)+'</span>';
  const hay=esc(searchHay(p));
  return '<div class="product-card'+(out?' sold-out':'')+'" data-search="'+hay+'">'+
    '<div class="product-row"><div class="food-icon">'+productThumb(p)+'</div>'+
    '<div class="product-info"><b>'+esc(p.name)+'</b><small>'+esc(productNote(p))+'</small>'+
    (variants.length?'<div class="variant-chips">'+variants.map(v=>{const nm=variantName(v),d=variantDelta(p,v);return '<span class="vchip">'+esc(nm)+(d?'<b class="'+(d>0?'up':'down')+'">'+(d>0?'+':'−')+money(Math.abs(d))+'</b>':'')+'</span>'}).join('')+'</div>':'')+'</div>'+
    '<div class="product-side"><div class="product-price">'+money(p.price)+'</div><button class="chip-edit" data-action="edit-menu:'+p.id+'" title="Ubah menu" aria-label="Ubah '+esc(p.name)+'">✎</button></div></div>'+
    '<div class="product-actions"><span class="product-meta">'+badge+'</span>'+control+'</div>'+
  '</div>';
}
function receiptRows(lines){
  return lines.map(l=>'<div class="receipt-row"><span>'+l.qty+'× '+esc(l.label||l.name||(l.product&&l.product.name)||'')+'</span><b>'+money(l.sub!=null?l.sub:(l.price*l.qty))+'</b></div>').join('');
}
function openCheckout(){
  const lines=cartLines();
  if(!lines.length){toast('Keranjang masih kosong. Pilih menu dulu.');return}
  openModal('<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">⌗</span><div><b>Keranjang & pembayaran</b><small>'+cartCount()+' item dari menu produk</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>'+
    '<div class="receipt">'+receiptRows(lines)+'<div class="receipt-total"><span>Total bayar</span><b>'+money(cartTotal())+'</b></div></div>'+
    '<label class="field"><span>Nama pembeli</span><input class="input" id="coName" maxlength="40" placeholder="Nama Anda (opsional)" autocomplete="off"></label>'+
    '<label class="field"><span>Metode pembayaran</span><select class="input" id="coMethod"><option>QRIS</option><option>Tunai di kasir</option><option>Kartu debit / kredit</option><option>E-wallet (GoPay / OVO)</option></select></label>'+
    '<div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-primary" data-action="pay-now">Bayar '+money(cartTotal())+'</button></div>'+
    '<small class="modal-note">Pembayaran pada prototipe ini disimulasikan — tidak ada uang yang benar-benar dipotong.</small>');
  const n=document.getElementById('coName');if(n)n.focus();
}
function payNow(){
  const lines=cartLines();
  if(!lines.length){closeModal();toast('Keranjang kosong.');return}
  if(!modalEl)return;
  const name=fieldVal('coName')||'Tamu';
  const method=fieldVal('coMethod')||'QRIS';
  const total=cartTotal();
  const count=cartCount();
  modalEl.querySelector('.modal').innerHTML='<div class="center-text"><div class="spinner"></div><b>Memproses pembayaran…</b><small>'+esc(method)+' · '+money(total)+'</small></div>';
  setTimeout(()=>{
    const order={
      id:nextOrderId(),guest:name,items:count+' item',type:'QR · Self-order',
      total:money(total),status:'Dibayar',cls:'paid',time:nowHM(),at:Date.now(),
      detail:lines.map(l=>({name:l.label||l.product.name,qty:l.qty,price:l.product.price,pid:l.product.id})),
      method:method,mine:true
    };
    orders.unshift(order);
    store.orders=orders;
    if(!saveStore()){orders.shift();return}
    applyBom(order);
    cart={};
    store.cart=cart;
    if(modalEl){
      modalEl.querySelector('.modal').innerHTML=
        '<div class="modal-success"><div class="ok">✓</div><div class="center-text"><b>Pembayaran berhasil</b><small>Pesanan '+order.id+' tercatat di halaman <b>Pesanan</b>.</small></div>'+
        '<div class="receipt">'+receiptRows(cartCountLines(order))+'<div class="receipt-total"><span>Total dibayar</span><b>'+order.total+'</b></div></div>'+
        '<div class="modal-actions" style="justify-content:center"><button class="btn btn-primary" data-action="finish-pay">Lihat pesanan saya</button></div></div>';
    }
    render('menu',true);
    toast('Pembayaran berhasil · '+order.id);
  },1400);
}
const cartCountLines=o=>(o.detail||[]).map(d=>({name:d.name,qty:d.qty,price:d.price,sub:d.price*d.qty}));
function finishPay(){
  closeModal();
  render('menu');
  setTimeout(()=>{
    const el=document.getElementById('myOrders');
    if(el&&el.scrollIntoView)el.scrollIntoView({behavior:'smooth',block:'start'});
  },80);
}
function myOrdersPanel(){
  const mine=historyOrders().filter(o=>o.mine);
  const body=mine.length?mine.map(o=>{
    const lines=(o.detail||[]).map(d=>'<li>'+d.qty+'× '+esc(d.name)+'<span>'+money(d.price*d.qty)+'</span></li>').join('');
    const cancelled=o.cls==='cancelled';
    const actions=cancelled?'<div class="my-order-actions"><span class="cancelled-note">Pesanan dibatalkan</span></div>'
      :'<div class="my-order-actions"><button class="btn btn-ghost" data-action="cancel-order:'+esc(String(o.id))+'">Batalkan pesanan</button></div>';
    return '<div class="my-order'+(cancelled?' is-cancelled':'')+'"><div class="my-order-top"><b>'+o.id+'</b><span class="status '+o.cls+'">'+o.status+'</span><small>'+o.time+' · '+esc(o.method||o.type)+'</small></div>'+
      '<ul class="my-order-items">'+lines+'</ul>'+
      '<div class="my-order-foot"><span>Total pembayaran'+(o.guest?' · '+esc(o.guest):'')+'</span><b>'+o.total+'</b></div>'+actions+'</div>';
  }).join(''):'<div class="empty-state">Belum ada pesanan. Pilih menu di atas, lalu klik <b>Bayar</b> — pesanan Anda akan tampil di sini dan di halaman <b>Pesanan</b>.</div>';
  return '<div class="panel" id="myOrders"><div class="panel-head"><div><div class="panel-title">Pesanan saya</div><div class="panel-caption">Rincian item dan jumlah total yang Anda bayar ('+mine.length+' pesanan) · bisa dibatalkan sebelum disiapkan</div></div><button class="link-btn" data-page="orders">Lihat di halaman Pesanan →</button></div><div class="my-orders">'+body+'</div></div>';
}
function askCancelOrder(id){
  const o=historyOrders().find(x=>String(x.id)===String(id));
  if(!o){toast('Pesanan tidak ditemukan.');return}
  if(o.cls==='cancelled'){toast('Pesanan sudah dibatalkan.');return}
  openModal('<div class="modal-head"><span class="provider-mark" style="--pm:#8a3324">✕</span><div><b>Batalkan pesanan '+esc(String(o.id))+'?</b><small>'+esc(o.items||'')+' · '+esc(o.total)+'</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>'+
    '<p class="modal-text">Pesanan berstatus <b>'+esc(o.status)+'</b> akan ditandai <b>Dibatalkan</b> dan hilang dari antrean dapur. Total yang sudah dibayar tidak lagi dihitung di ringkasan penjualan.</p>'+
    '<div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-danger" data-action="confirm-cancel-order:'+esc(String(o.id))+'">Ya, batalkan pesanan</button></div>');
}
function cancelOrder(id){
  const o=historyOrders().find(x=>String(x.id)===String(id));
  if(!o){closeModal();toast('Pesanan tidak ditemukan.');return}
  const backup={cls:o.cls,status:o.status};
  o.cls='cancelled';o.status='Dibatalkan';
  store.orders=orders;
  if(!saveStore()){o.cls=backup.cls;o.status=backup.status;toast('Gagal menyimpan perubahan.');return}
  closeModal();
  render(currentPage);
  toast('Pesanan '+o.id+' dibatalkan.');
}
let activeMenuCat='Semua';
let menuQuery='';                 /* pencarian cepat POS (Blok G) */
function menuCategories(){
  const cats=[];
  products.forEach(p=>{const c=p.cat||'Lainnya';if(cats.indexOf(c)<0)cats.push(c)});
  return cats.sort((a,b)=>{
    const ia=CATEGORIES.indexOf(a),ib=CATEGORIES.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib)||(a<b?-1:a>b?1:0);
  });
}
/* satu sumber kebenaran untuk pencarian POS: haystack huruf kecil yang
   dipakai menuMatches() saat render dan disimpan ke atribut data-search */
function searchHay(p){
  return [p.name,p.cat,p.type].filter(Boolean).join(' ').toLowerCase();
}
function menuMatches(p,q){
  if(!q)return true;
  return searchHay(p).indexOf(q)>=0;
}
function menuPage(){
  const cats=menuCategories();
  if(activeMenuCat!=='Semua'&&cats.indexOf(activeMenuCat)<0)activeMenuCat='Semua';
  const q=menuQuery.trim().toLowerCase();
  const base=activeMenuCat==='Semua'?products:products.filter(p=>(p.cat||'Lainnya')===activeMenuCat);
  const hits=base.filter(p=>menuMatches(p,q)).length;
  const chips='<button class="filter-chip'+(activeMenuCat==='Semua'?' selected':'')+'" data-menucat="Semua">Semua menu · '+products.length+'</button>'+
    cats.map(c=>{const n=products.filter(p=>(p.cat||'Lainnya')===c).length;
      return '<button class="filter-chip'+(activeMenuCat===c?' selected':'')+'" data-menucat="'+esc(c)+'">'+esc(c)+' · '+n+'</button>'}).join('');
  /* semua kartu ikut dirender; kata kunci diterapkan lewat filterMenuDom()
     supaya mengetik/menghapus huruf tetap bisa memperluas hasil tanpa render ulang */
  const cards=base.map(productCard).join('');
  const empty=products.length
    ? '<div class="empty-state">Tidak ada produk pada kategori ini. Klik <b>Tambah menu</b> atau pilih kategori lain.</div>'
    : '<div class="empty-state">Belum ada menu sama sekali — restoran Anda masih baru. Klik <b>Tambah menu</b> untuk menambahkan produk pertama.</div>';
  return `${heading('Menu & produk','Pilih kategori — Makanan, Makanan ringan, Minuman, Pastry, Dessert — agar produk lebih cepat ditemukan; kelola varian, stok, dan foto di sini. Pembeli bisa langsung memesan.','<button class="btn btn-primary" data-action="add-menu"><span class="btn-icon">＋</span> Tambah menu</button>')}
  <div class="filter-row">${chips}</div>
  <div class="panel"><div class="panel-head menu-head"><div><div class="panel-title">${activeMenuCat==='Semua'?'Menu aktif':'Menu · '+esc(activeMenuCat)}</div><div class="panel-caption">Klik ✎ untuk mengubah kategori, jenis, varian, stok, dan foto · <b id="menuCount">${hits}</b> produk ditampilkan</div></div>
  <div class="menu-search"><input class="input" id="menuSearch" type="search" placeholder="⌕ Cari menu, kategori, atau jenis…" value="${esc(menuQuery)}" autocomplete="off" aria-label="Cari menu"><button class="link-btn menu-search-x" data-action="menu-search-clear" aria-label="Hapus pencarian" ${menuQuery?'':'hidden'}>✕</button></div></div>
  <div class="menu-grid">${cards||empty}</div></div>
  ${cartBar()}
  ${myOrdersPanel()}`
}
/* ============================================================
   BLOK D — Persediaan & Resep (Bill of Materials)
   Stok bahan nyata, terhubung ke produk lewat resep, dan otomatis
   berkurang saat pesanan dibayar. Semua perubahan ikut sinkronisasi.
   ============================================================ */
const INV_CATEGORIES=['Bahan utama','Protein','Kopi','Teh','Dairy','Sirup','Bumbu','Bahan dasar','Kemasan','Lainnya'];
const invById=id=>store.inventory.find(x=>String(x.id)===String(id));
const rid=p=>p+Date.now().toString(36)+Math.floor(Math.random()*1000).toString(36);
const dayKey=(d)=>{const x=d||new Date();return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')};
const invValue=()=>store.inventory.reduce((n,x)=>n+(Number(x.stock)||0)*(Number(x.cost)||0),0);
const invLow=()=>store.inventory.filter(x=>(Number(x.stock)||0)<=(Number(x.min)||0));
function invStatus(x){
  const s=Number(x.stock)||0,m=Number(x.min)||0;
  if(s<=0)return{label:'Habis',cls:'cancelled'};
  if(s<=m)return{label:'Rendah',cls:'pending'};
  if(m>0&&s<=m*1.5)return{label:'Menipis',cls:'preparing'};
  return{label:'Aman',cls:'ready'};
}
function logValue(kind){
  const today=dayKey();
  return (store.stockLog||[]).filter(e=>e&&e.kind===kind&&e.day===today)
    .reduce((n,e)=>n+(Math.abs(Number(e.qty)||0)*(Number(e.cost)||0)),0);
}
function pushStockLog(invId,qty,kind,ref,cost){
  if(!Array.isArray(store.stockLog))store.stockLog=[];
  store.stockLog.push({t:Date.now(),day:dayKey(),invId:String(invId),qty:Number(qty)||0,kind:kind,ref:String(ref||''),cost:Number(cost)||0});
  if(store.stockLog.length>400)store.stockLog=store.stockLog.slice(-400);
}
const fmtQty=v=>{const n=Number(v)||0;return (Math.round(n*1000)/1000).toLocaleString('id-ID')};

function inventoryPage(){
  const canWrite=window.canPerm('inventory','update');
  const canCreate=window.canPerm('inventory','create');
  const canDelete=window.canPerm('inventory','delete');
  const rows=store.inventory.length?store.inventory.map(x=>{
    const st=invStatus(x);
    const acts=[];
    if(canWrite)acts.push('<button class="link-btn" data-action="inv-adjust:'+esc(String(x.id))+'">Penyesuaian</button><button class="link-btn" data-action="inv-edit:'+esc(String(x.id))+'">Ubah</button>');
    if(canDelete)acts.push('<button class="link-btn danger-link" data-action="inv-del:'+esc(String(x.id))+'">Hapus</button>');
    return `<tr><td><b>${esc(x.name)}</b><span class="subcell">${fmtQty(x.stock)} ${esc(x.unit)} tersisa</span></td>
      <td>${esc(x.cat||'Lainnya')}</td><td>${fmtQty(x.stock)} ${esc(x.unit)}</td><td>${fmtQty(x.min)} ${esc(x.unit)}</td>
      <td>${money((Number(x.stock)||0)*(Number(x.cost)||0))}</td>
      <td><span class="status ${st.cls}">${st.label}</span></td>
      <td style="text-align:right;white-space:nowrap">${acts.join(' · ')||'—'}</td></tr>`;
  }).join(''):'<tr><td colspan="7" class="empty-state">Belum ada bahan. Tambahkan bahan pertama, lalu hubungkan ke produk lewat halaman <b>Resep / BOM</b>.</td></tr>';
  const recipesCount=store.recipes.length;
  return `${heading('Persediaan bahan baku','Stok real-time yang terhubung ke resep (BOM) dan berkurang otomatis saat pesanan dibayar.',
    canCreate?'<button class="btn btn-primary" data-action="inv-add"><span class="btn-icon">＋</span> Tambah bahan</button>':'')}
  <div class="stats-grid">
    ${stat('Nilai persediaan',money(invValue()),store.inventory.length+' jenis bahan baku','▧','')}
    ${stat('Stok menipis',invLow().length+' bahan','Perlu dibuat purchase order','◷',invLow().length?'perlu restock':'semua aman')}
    ${stat('Pemakaian hari ini',money(logValue('bom')),'Berdasarkan resep (BOM)','↘',store.recipes.length+' resep aktif')}
    ${stat('Waste hari ini',money(logValue('waste')),'tercatat di log stok','♲',logValue('restock')?'+ '+money(logValue('restock'))+' restock':'belum ada restock')}
  </div>
  <div class="panel">
    <div class="panel-head"><div><div class="panel-title">Bahan baku</div>
    <div class="panel-caption">Pengurangan otomatis sesuai Bill of Materials saat pesanan dibayar</div></div>
    <button class="link-btn" data-page="recipes">Kelola resep (${recipesCount}) →</button></div>
    <div class="table-wrap"><table><thead><tr><th>Bahan baku</th><th>Kategori</th><th>Stok tersedia</th><th>Minimum</th><th>Nilai stok</th><th>Status</th><th style="text-align:right">Aksi</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <div class="hint">Stok berkurang otomatis mengikuti resep setiap produk yang dibayar. Stok bahan tidak boleh kurang dari 0 — validasi juga dilakukan di server saat disinkronkan.</div>
  </div>`;
}

function invFormHtml(id){
  const isNew=id==='new';
  const x=isNew?{name:'',cat:'Bahan utama',unit:'kg',stock:'',min:'',cost:''}:(invById(id)||{});
  return `<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">▧</span><div><b>${isNew?'Tambah bahan baku':'Ubah bahan baku'}</b><small>Data persediaan · tersinkron ke server</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
  <label class="field"><span>Nama bahan</span><input class="input" id="invName" maxlength="60" placeholder="Contoh: Biji kopi Arabika" value="${esc(x.name||'')}"></label>
  <div class="field-row">
    <label class="field"><span>Kategori</span><select class="input" id="invCat">${INV_CATEGORIES.map(c=>`<option${c===(x.cat||'Bahan utama')?' selected':''}>${c}</option>`).join('')}</select></label>
    <label class="field"><span>Satuan</span><input class="input" id="invUnit" maxlength="10" placeholder="kg / liter / pcs" value="${esc(x.unit||'')}"></label>
  </div>
  <div class="field-row">
    <label class="field"><span>Stok tersedia</span><input class="input" id="invStock" inputmode="decimal" placeholder="0" value="${esc(x.stock===''?'':x.stock)}"></label>
    <label class="field"><span>Stok minimum</span><input class="input" id="invMin" inputmode="decimal" placeholder="0" value="${esc(x.min===''?'':x.min)}"></label>
    <label class="field"><span>Harga per satuan</span><input class="input" id="invCost" inputmode="numeric" placeholder="160000" value="${esc(x.cost===''?'':x.cost)}"></label>
  </div>
  <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button>
  <button class="btn btn-primary" data-action="save-inv:${esc(id)}">${isNew?'Simpan bahan':'Simpan perubahan'}</button></div>`;
}
function openInvForm(id){
  const perm=id==='new'?'create':'update';
  if(!window.canPerm('inventory',perm)){toast('Role Anda tidak punya izin '+(perm==='create'?'menambah':'mengubah')+' persediaan.');return}
  if(id!=='new'&&!invById(id)){toast('Bahan tidak ditemukan.');return}
  openModal(invFormHtml(id));
  const n=document.getElementById('invName');if(n)n.focus();
}
function numVal(id,min,max){
  const raw=fieldVal(id).replace(/\./g,'').replace(',','.');
  if(raw==='')return null;
  const n=Number(raw);
  if(!isFinite(n)||n<min||n>max)return NaN;
  return n;
}
function saveInv(id){
  const name=fieldVal('invName');
  if(!name){toast('Nama bahan wajib diisi.');return}
  if(name.length>60){toast('Nama bahan maksimal 60 karakter.');return}
  const unit=fieldVal('invUnit')||'pcs';
  if(unit.length>10){toast('Satuan maksimal 10 karakter.');return}
  const cat=fieldVal('invCat')||'Lainnya';
  const stock=numVal('invStock',0,1e9);
  const min=numVal('invMin',0,1e9);
  const cost=numVal('invCost',0,1e12);
  if(stock===null||isNaN(stock)){toast('Stok harus angka 0 ke atas.');return}
  if(min===null||isNaN(min)){toast('Stok minimum harus angka 0 ke atas.');return}
  if(cost===null||isNaN(cost)){toast('Harga per satuan harus angka 0 ke atas.');return}
  const isNew=id==='new';
  if(isNew){
    if(!window.canPerm('inventory','create')){toast('Role Anda tidak punya izin menambah bahan.');return}
    store.inventory.push({id:rid('i'),name:name,cat:cat,unit:unit,stock:stock,min:min,cost:cost});
    if(!saveStore()){store.inventory.pop();return}
    toast('Bahan "'+name+'" ditambahkan.');
  }else{
    const x=invById(id);
    if(!x){toast('Bahan tidak ditemukan.');return}
    if(!window.canPerm('inventory','update')){toast('Role Anda tidak punya izin mengubah persediaan.');return}
    const backup=Object.assign({},x);
    Object.assign(x,{name:name,cat:cat,unit:unit,stock:stock,min:min,cost:cost});
    if(!saveStore()){Object.assign(x,backup);return}
    toast('Bahan "'+name+'" diperbarui.');
  }
  closeModal();render('inventory',true);
}
function openInvAdjust(id){
  if(!window.canPerm('inventory','update')){toast('Role Anda tidak punya izin mengubah persediaan.');return}
  const x=invById(id);if(!x){toast('Bahan tidak ditemukan.');return}
  openModal(`<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">⇄</span><div><b>Penyesuaian stok</b><small>${esc(x.name)} · stok saat ini ${fmtQty(x.stock)} ${esc(x.unit)}</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
  <label class="field"><span>Stok baru (${esc(x.unit)})</span><input class="input" id="adjStock" inputmode="decimal" placeholder="${fmtQty(x.stock)}" value="${fmtQty(x.stock)}"></label>
  <label class="field"><span>Alasan</span><select class="input" id="adjReason">
    <option value="restock">Restock / pembelian masuk</option>
    <option value="waste">Waste / rusak / tumpah</option>
    <option value="adjust">Hitung ulang (stock opname)</option>
  </select></label>
  <label class="field"><span>Catatan (opsional)</span><input class="input" id="adjNote" maxlength="60" placeholder="Contoh: kiriman supplier pagi ini"></label>
  <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button>
  <button class="btn btn-primary" data-action="save-adjust:${esc(id)}">Simpan stok</button></div>`);
}
function saveAdjust(id){
  const x=invById(id);if(!x){toast('Bahan tidak ditemukan.');return}
  const stock=numVal('adjStock',0,1e9);
  if(stock===null||isNaN(stock)){toast('Stok harus angka 0 ke atas.');return}
  const reason=fieldVal('adjReason')||'adjust';
  const note=fieldVal('adjNote');
  const delta=stock-(Number(x.stock)||0);
  if(delta===0){closeModal();toast('Stok tidak berubah.');return}
  const backup=x.stock;
  x.stock=stock;
  pushStockLog(x.id,delta,reason==='waste'?'waste':(delta>0?'restock':'adjust'),note,x.cost);
  if(!saveStore()){x.stock=backup;store.stockLog.pop();toast('Gagal menyimpan perubahan.');return}
  closeModal();render('inventory',true);
  toast('Stok '+x.name+' → '+fmtQty(stock)+' '+x.unit+(reason==='waste'?' (waste dicatat)':reason==='restock'?' (restock dicatat)':'')+'.');
}
function askDeleteInv(id){
  if(!window.canPerm('inventory','delete')){toast('Role Anda tidak punya izin menghapus bahan.');return}
  const x=invById(id);if(!x){toast('Bahan tidak ditemukan.');return}
  const used=store.recipes.filter(r=>(r.items||[]).some(it=>String(it.invId)===String(id))).length;
  openModal(`<div class="modal-head"><span class="provider-mark" style="--pm:#b0473a">✕</span><div><b>Hapus bahan ${esc(x.name)}?</b><small>${used} resep memakai bahan ini</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
  <p class="modal-text">Bahan akan dihapus dari daftar persediaan${used?' beserta penggunaannya di <b>'+used+' resep</b>':''}. Riwayat log stok tetap tersimpan.</p>
  <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button>
  <button class="btn btn-danger" data-action="inv-del-confirm:${esc(id)}">Hapus bahan</button></div>`);
}
function deleteInv(id){
  const i=store.inventory.findIndex(x=>String(x.id)===String(id));
  if(i<0){toast('Bahan tidak ditemukan.');return}
  const removed=store.inventory.splice(i,1)[0];
  const touched=store.recipes.filter(r=>(r.items||[]).some(it=>String(it.invId)===String(id)));
  const backups=touched.map(r=>({r:r,items:r.items.slice()}));
  touched.forEach(r=>{r.items=r.items.filter(it=>String(it.invId)!==String(id))});
  if(!saveStore()){
    store.inventory.splice(i,0,removed);
    backups.forEach(b=>{b.r.items=b.items});
    toast('Gagal menyimpan perubahan.');return;
  }
  closeModal();render('inventory',true);
  toast('Bahan "'+removed.name+'" dihapus'+(touched.length?' dari '+touched.length+' resep':'')+'.');
}

/* ---------- Resep / BOM ---------- */
const recipeOf=pid=>store.recipes.find(r=>String(r.productId)===String(pid));
function bomCost(r){
  return (r.items||[]).reduce((n,it)=>{const x=invById(it.invId);return n+(Number(it.qty)||0)*(x?Number(x.cost)||0:0)},0);
}
function recipesPage(){
  const canWrite=window.canPerm('recipes','update');
  const rows=products.length?products.map(p=>{
    const r=recipeOf(p.id);
    const items=(r&&r.items)||[];
    const used=items.map(it=>{const x=invById(it.invId);return x?fmtQty(it.qty)+' '+x.unit+' '+x.name:'—'}).join(' · ');
    const cost=bomCost(r||{items:[]});
    return `<tr><td><b>${esc(p.name)}</b><span class="subcell">${esc(p.cat||'Menu')} · ${money(p.price||0)}</span></td>
      <td>${items.length?esc(used):'<span class="status pending">Belum ada resep</span>'}</td>
      <td>${items.length?money(cost):'—'}</td>
      <td>${items.length?(p.price?Math.round(cost/(Number(p.price)||1)*100)+'%':'—'):'—'}</td>
      <td style="text-align:right">${canWrite?`<button class="link-btn" data-action="recipe-edit:${esc(String(p.id))}">${items.length?'Ubah resep':'Buat resep'} →</button>`:(items.length?'<span class="hint-inline">hanya baca</span>':'—')}</td></tr>`;
  }).join(''):'<tr><td colspan="5" class="empty-state">Belum ada produk. Tambahkan menu dulu di halaman <b>Menu &amp; produk</b>.</td></tr>';
  return `${heading('Resep & Bill of Materials','Tentukan bahan apa yang dipakai setiap produk — stok bahan otomatis berkurang saat pesanan dibayar.','')}
  <div class="stats-grid">
    ${stat('Produk ber-resep',store.recipes.length+' / '+products.length,'sudah punya BOM','✓',products.length-store.recipes.length+' belum')}
    ${stat('Bahan terpakai',String(store.inventory.length),'jenis bahan tersedia','▧','')}
    ${stat('Nilai persediaan',money(invValue()),'seluruh bahan baku','⌁','')}
    ${stat('Rata-rata HPP',products.length&&store.recipes.length?money(products.filter(p=>recipeOf(p.id)).reduce((n,p)=>n+bomCost(recipeOf(p.id)),0)/Math.max(1,products.filter(p=>recipeOf(p.id)).length)):'—','harga pokok per porsi','↘','')}
  </div>
  <div class="panel">
    <div class="panel-head"><div><div class="panel-title">BOM per produk</div>
    <div class="panel-caption">Hubungkan produk dengan bahan persediaan beserta takarannya</div></div>
    <button class="link-btn" data-page="inventory">Kelola bahan →</button></div>
    <div class="table-wrap"><table><thead><tr><th>Produk</th><th>Bahan (takaran)</th><th>HPP / porsi</th><th>% dari harga jual</th><th style="text-align:right">Aksi</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <div class="hint">Saat pesanan dibayar, stok bahan pada resep dipotong otomatis dan dicatat ke <b>log stok</b> (pemakaian &amp; waste) — data tersinkron ke server untuk semua perangkat.</div>
  </div>`;
}

let recipeDraft=null;
function recipeModalHtml(){
  const d=recipeDraft||{pid:'',items:[]};
  const p=productById(d.pid);
  const rows=d.items.length?d.items.map((it,i)=>{
    const x=invById(it.invId);
    return `<div class="bom-row"><b>${x?esc(x.name):'Bahan hilang'}</b>
      <input class="input input-sm" data-bom-qty="${i}" inputmode="decimal" value="${fmtQty(it.qty)}">
      <span class="bom-unit">${x?esc(x.unit):''}</span>
      <span class="bom-cost">${money((Number(it.qty)||0)*(x?Number(x.cost)||0:0))}</span>
      <button class="link-btn danger-link" data-action="recipe-remove:${i}">Hapus</button></div>`;
  }).join(''):'<div class="empty-state">Belum ada bahan — pilih bahan di bawah lalu klik Tambah.</div>';
  const usedIds=d.items.map(it=>String(it.invId));
  const options=store.inventory.filter(x=>usedIds.indexOf(String(x.id))<0)
    .map(x=>`<option value="${esc(String(x.id))}">${esc(x.name)} (${esc(x.unit)} · sisa ${fmtQty(x.stock)})</option>`).join('');
  const cost=bomCost({items:d.items});
  return `<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">✽</span><div><b>Resep — ${p?esc(p.name):'produk'}</b><small>Bill of Materials per porsi</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
  <div class="bom-list">${rows}</div>
  <div class="bom-add">
    <select class="input" id="bomPick" ${options?'':'disabled'}>${options||'<option>Semua bahan sudah dipakai</option>'}</select>
    <input class="input input-sm" id="bomQty" inputmode="decimal" placeholder="takaran">
    <button class="btn" data-action="recipe-add" ${options?'':'disabled'}>＋ Tambah</button>
  </div>
  <div class="bom-total"><span>HPP per porsi</span><b>${money(cost)}</b></div>
  <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button>
  <button class="btn btn-primary" data-action="recipe-save">Simpan resep</button></div>`;
}
function openRecipe(pid){
  if(!window.canPerm('recipes','update')){toast('Role Anda tidak punya izin mengubah resep.');return}
  const p=productById(pid);if(!p){toast('Produk tidak ditemukan.');return}
  const r=recipeOf(pid);
  recipeDraft={pid:pid,items:(r&&r.items?r.items.map(it=>({invId:String(it.invId),qty:Number(it.qty)||0})):[])};
  openModal(recipeModalHtml());
}
function recipeAdd(){
  const d=recipeDraft;if(!d)return;
  const invId=fieldVal('bomPick');
  if(!invId){toast('Pilih bahan terlebih dahulu.');return}
  const qty=numVal('bomQty',0.000001,1e6);
  if(qty===null||isNaN(qty)||qty<=0){toast('Takaran harus angka lebih dari 0.');return}
  if(d.items.some(it=>String(it.invId)===String(invId))){toast('Bahan sudah ada di resep.');return}
  d.items.push({invId:String(invId),qty:qty});
  const m=modalEl&&modalEl.querySelector('.modal');if(m)m.innerHTML=recipeModalHtml();
}
function recipeRemove(i){
  const d=recipeDraft;if(!d)return;
  d.items.splice(Number(i)||0,1);
  const m=modalEl&&modalEl.querySelector('.modal');if(m)m.innerHTML=recipeModalHtml();
}
function saveRecipe(){
  const d=recipeDraft;if(!d)return;
  if(!window.canPerm('recipes','update')){toast('Role Anda tidak punya izin mengubah resep.');return}
  /* baca ulang takaran yang diedit pengguna */
  const qtyInputs=(modalEl?modalEl.querySelectorAll('[data-bom-qty]'):[]);
  let bad=false;
  d.items.forEach((it,i)=>{const el=qtyInputs[i];if(!el)return;const n=Number(String(el.value).replace(/\./g,'').replace(',','.'));if(!isFinite(n)||n<=0)bad=true;else it.qty=n});
  if(bad){toast('Semua takaran harus angka lebih dari 0.');return}
  const i=store.recipes.findIndex(r=>String(r.productId)===String(d.pid));
  const prev=i>=0?Object.assign({},store.recipes[i]):null;
  if(!d.items.length){
    if(i>=0)store.recipes.splice(i,1);
    else{closeModal();recipeDraft=null;return}
  }else if(i>=0){
    store.recipes[i]={id:store.recipes[i].id,productId:d.pid,items:d.items};
  }else{
    store.recipes.push({id:rid('rc'),productId:d.pid,items:d.items});
  }
  if(!saveStore()){
    if(prev&&i>=0)store.recipes[i]=prev;
    else if(i>=0)store.recipes.splice(i,1);
    else store.recipes.pop();
    toast('Gagal menyimpan resep.');return;
  }
  recipeDraft=null;closeModal();render('recipes',true);
  toast(d.items.length?'Resep tersimpan · '+d.items.length+' bahan per porsi.':'Resep dihapus untuk produk ini.');
}

/* ---------- Pemotongan stok otomatis (BOM) saat pesanan dibayar ---------- */
function applyBom(order){
  if(!order||order.bomApplied)return false;
  order.bomApplied=true;
  let touched=false;
  (order.detail||[]).forEach(d=>{
    const qty=Number(d.qty)||0;
    if(!qty)return;
    const p=d.pid?productById(d.pid):products.find(x=>x.name===d.name);
    if(p){
      p.stock=Math.max(0,(Number(p.stock)||0)-qty);
      p.sold=(Number(p.sold)||0)+qty;
      touched=true;
    }
    const pid=p?p.id:(d.pid||'');
    const r=pid?recipeOf(pid):null;
    if(!r)return;
    (r.items||[]).forEach(it=>{
      const x=invById(it.invId);if(!x)return;
      const used=(Number(it.qty)||0)*qty;
      if(used<=0)return;
      x.stock=Math.max(0,Math.round(((Number(x.stock)||0)-used)*1000)/1000);
      pushStockLog(x.id,used,'bom',order.id,x.cost);
      touched=true;
    });
  });
  if(touched)saveStore();
  return touched;
}
function procurementPage(){return `${heading('Pengadaan bahan baku','Kelola purchase order dan penerimaan barang dari pemasok.','<button class="btn btn-primary" data-action="po"><span class="btn-icon">＋</span> Purchase order</button>')}<div class="stats-grid">${stat('PO aktif','3 pesanan','2 menunggu konfirmasi','⇄','')}${stat('Estimasi pengadaan','Rp 3,25 jt','Untuk periode ini','◈','')}${stat('Pemasok aktif','8 pemasok','Semua terverifikasi','♙','')}${stat('Barang diterima','12 PO','Bulan September','✓','')}</div><div class="panel"><div class="panel-head"><div><div class="panel-title">Purchase order terbaru</div><div class="panel-caption">Riwayat permintaan pembelian stok</div></div><button class="link-btn" data-action="po">Lihat semua →</button></div><table><thead><tr><th>No. PO</th><th>Pemasok</th><th>Tanggal</th><th>Item</th><th>Total</th><th>Status</th></tr></thead><tbody><tr><td><b>PO-2026-091</b></td><td>PT Kopi Nusantara</td><td>24 Sep 2026</td><td>3 item</td><td>Rp 1.280.000</td><td><span class="status preparing">Menunggu</span></td></tr><tr><td><b>PO-2026-090</b></td><td>Segar Makmur</td><td>23 Sep 2026</td><td>5 item</td><td>Rp 845.000</td><td><span class="status paid">Dalam perjalanan</span></td></tr><tr><td><b>PO-2026-089</b></td><td>Pastry Supply Co.</td><td>22 Sep 2026</td><td>2 item</td><td>Rp 560.000</td><td><span class="status ready">Diterima</span></td></tr></tbody></table></div>`}
/* ============================================================
   BLOK E — Akuntansi double-entry: COA, jurnal otomatis + manual,
   neraca percobaan, ikhtisar laba rugi. Semua seimbang debit=kredit.
   ============================================================ */
const COA=[
  {code:'1100',name:'Kas',cat:'Aset'},
  {code:'1110',name:'Bank / QRIS / Gateway',cat:'Aset'},
  {code:'1200',name:'Persediaan bahan',cat:'Aset'},
  {code:'1300',name:'Piutang usaha',cat:'Aset'},
  {code:'2100',name:'Utang usaha',cat:'Liabilitas'},
  {code:'2200',name:'DP / titipan pelanggan',cat:'Liabilitas'},
  {code:'3100',name:'Modal pemilik',cat:'Ekuitas'},
  {code:'3200',name:'Ikhtisar laba rugi',cat:'Ekuitas'},
  {code:'4100',name:'Pendapatan penjualan',cat:'Pendapatan'},
  {code:'4900',name:'Diskon & pembatalan',cat:'Pendapatan'},
  {code:'5100',name:'Harga pokok penjualan',cat:'HPP'},
  {code:'6100',name:'Gaji karyawan',cat:'Beban'},
  {code:'6200',name:'Sewa tempat',cat:'Beban'},
  {code:'6300',name:'Listrik, air & gas',cat:'Beban'},
  {code:'6400',name:'Marketing & promosi',cat:'Beban'},
  {code:'6500',name:'Perlengkapan & lain-lain',cat:'Beban'}
];
const coaLabel=code=>{const a=COA.find(x=>x.code===code);return a?a.code+' · '+a.name:String(code)};
const manualJournal=()=>(store.accounting&&Array.isArray(store.accounting.journal))?store.accounting.journal:[];
const isCashMethod=o=>/QRIS|Kartu|E-wallet|Bank/i.test(String(o.method||''))||/QR/i.test(String(o.type||''));
function orderCogs(o){
  return (o.detail||[]).reduce((n,d)=>{
    const q=Number(d.qty)||0;
    const p=d.pid?productById(d.pid):products.find(x=>x.name===d.name);
    const r=p?recipeOf(p.id):null;
    if(!r)return n;
    return n+(r.items||[]).reduce((m,it)=>{const x=invById(it.invId);return m+(Number(it.qty)||0)*q*(x?Number(x.cost)||0:0)},0);
  },0);
}
function autoJournal(){
  const today=dayKey();
  const list=[];
  liveOrders().forEach(o=>{
    if(o.cls==='cancelled'||o.cls==='scheduled')return;
    const ref=String(o.id||'');
    const total=parseRp(o.total);
    if(total>0)list.push({id:'auto-s-'+ref,date:today,ref:ref,source:'auto',memo:'Penjualan '+ref+' · '+(o.type||'POS'),
      lines:[{acc:isCashMethod(o)?'1110':'1100',debit:total,credit:0},{acc:'4100',debit:0,credit:total}]});
    const cogs=Math.round(orderCogs(o));
    if(cogs>0)list.push({id:'auto-c-'+ref,date:today,ref:ref,source:'auto',memo:'HPP '+ref+' · potong persediaan (BOM)',
      lines:[{acc:'5100',debit:cogs,credit:0},{acc:'1200',debit:0,credit:cogs}]});
  });
  return list;
}
function allJournal(){
  return autoJournal().concat(manualJournal())
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.id||'').localeCompare(String(a.id||'')));
}
function journalTotals(){
  let debit=0,credit=0;
  allJournal().forEach(e=>(e.lines||[]).forEach(l=>{debit+=Number(l.debit)||0;credit+=Number(l.credit)||0}));
  return {debit:Math.round(debit),credit:Math.round(credit)};
}
function accountBalance(code){
  if(code==='1200')return invValue();
  let bal=0;
  allJournal().forEach(e=>(e.lines||[]).forEach(l=>{if(l.acc===code)bal+=(Number(l.debit)||0)-(Number(l.credit)||0)}));
  if(/^[234]/.test(code))bal=-bal; /* saldo normal: liabilitas, ekuitas, pendapatan */
  return Math.round(bal);
}
function expenseTotal(){
  return COA.filter(a=>a.cat==='Beban').reduce((n,a)=>n+Math.max(0,accountBalance(a.code)),0);
}
function financeStats(){
  const pendapatan=Math.max(0,accountBalance('4100'));
  const hpp=Math.max(0,accountBalance('5100'));
  const beban=expenseTotal();
  return {pendapatan,hpp,beban,laba:pendapatan-hpp-beban,t:journalTotals()};
}

function financePage(){
  const s=financeStats();
  const canPost=window.canPerm('accounting','update');
  const canExport=window.canPerm('accounting','export')||window.canPerm('finance','export');
  const journal=allJournal();
  const coaRows=COA.map(a=>{
    const bal=accountBalance(a.code);
    if(!bal&&['1100','1110','1200','4100','5100'].indexOf(a.code)<0)return '';
    return `<tr><td class="account">${coaLabel(a.code)}</td><td>${a.cat}</td><td class="amount" style="text-align:right">${money(Math.abs(bal))}${bal<0?' <small>(kredit)</small>':''}</td></tr>`;
  }).join('');
  const jRows=journal.length?journal.slice(0,25).map(e=>{
    const d=(e.lines||[]).reduce((n,l)=>n+(Number(l.debit)||0),0);
    return `<tr><td>${esc(e.date||'')}</td><td class="account">${esc(e.memo||'')}</td>
      <td>${(e.lines||[]).map(l=>esc(coaLabel(l.acc))+'<span class="subcell">D '+money(Number(l.debit)||0)+' · K '+money(Number(l.credit)||0)+'</span>').join('')}</td>
      <td class="amount" style="text-align:right">${money(d)}</td>
      <td><span class="status ${e.source==='auto'?'ready':'preparing'}">${e.source==='auto'?'Otomatis':'Manual'}</span></td></tr>`;
  }).join(''):'<tr><td colspan="5" class="empty-state">Belum ada jurnal — penjualan pertama akan tercatat otomatis.</td></tr>';
  const balanced=s.t.debit===s.t.credit;
  return `${heading('Keuangan & akuntansi','Pembukuan double-entry — jurnal otomatis dari penjualan &amp; HPP, plus jurnal manual untuk beban.',
    (canExport?'<button class="btn" data-action="export-journal">↓ Ekspor CSV</button>':'')+(canPost?'<button class="btn btn-primary" data-action="journal-add">＋ Entri jurnal</button>':''))}
  <div class="stats-grid">
    ${stat('Pendapatan',money(s.pendapatan),journal.length+' entri jurnal tercatat','↗','')}
    ${stat('Harga pokok (HPP)',money(s.hpp),s.pendapatan?Math.round(s.hpp/Math.max(1,s.pendapatan)*100)+'% dari pendapatan':'menunggu penjualan','↘','')}
    ${stat('Beban operasional',money(s.beban),'gaji, sewa, listrik, dll','⌁',manualJournal().length+' entri manual')}
    ${stat('Laba bersih',money(s.laba),s.pendapatan?'margin '+Math.round(s.laba/Math.max(1,s.pendapatan)*100)+'%':'belum ada transaksi',s.laba>=0?'✓':'!',s.laba>=0?'laba':'rugi')}
  </div>
  <div class="dashboard-grid">
    <div class="panel">
      <div class="panel-head"><div><div class="panel-title">Ikhtisar laba rugi</div><div class="panel-caption">Periode berjalan · diperbarui otomatis dari transaksi</div></div></div>
      <div class="money-card"><small>Laba bersih periode berjalan</small><strong>${money(s.laba)}</strong></div>
      <table class="ledger"><thead><tr><th>Akun</th><th>Kategori</th><th style="text-align:right">Saldo</th></tr></thead><tbody>
        <tr><td class="account">4100 · Pendapatan penjualan</td><td>Pendapatan</td><td class="amount" style="text-align:right">${money(s.pendapatan)}</td></tr>
        <tr><td class="account">5100 · Harga pokok penjualan</td><td>HPP</td><td class="amount" style="text-align:right">− ${money(s.hpp)}</td></tr>
        <tr><td class="account">6xxx · Beban operasional</td><td>Beban</td><td class="amount" style="text-align:right">− ${money(s.beban)}</td></tr>
        <tr><td class="account"><b>Laba bersih</b></td><td>Ikhtisar</td><td class="amount" style="text-align:right"><b>${money(s.laba)}</b></td></tr>
      </tbody></table>
      <div class="ledger-foot"><span>Neraca percobaan</span><b>${balanced?'✓ Debit = Kredit':'⚠ Selisih '+money(Math.abs(s.t.debit-s.t.credit))}</b></div>
    </div>
    <div class="panel">
      <div class="panel-head"><div><div class="panel-title">Buku besar (COA)</div><div class="panel-caption">${COA.length} akun · saldo dihitung dari seluruh jurnal</div></div></div>
      <div class="table-wrap"><table class="ledger"><thead><tr><th>Akun</th><th>Kategori</th><th style="text-align:right">Saldo</th></tr></thead><tbody>${coaRows}</tbody></table></div>
      <div class="hint">Akun <b>1200 Persediaan</b> mengikuti nilai stok riil di halaman Persediaan. Akun lain dihitung dari debit − kredit seluruh jurnal.</div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><div><div class="panel-title">Jurnal umum</div>
    <div class="panel-caption">Double-entry · penjualan &amp; HPP tercatat otomatis, beban dicatat manual</div></div>
    <div class="hint-inline">Total D ${money(s.t.debit)} · K ${money(s.t.credit)}</div></div>
    <div class="table-wrap"><table class="ledger"><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Akun &amp; rincian</th><th style="text-align:right">Debit</th><th>Sumber</th></tr></thead><tbody>${jRows}</tbody></table></div>
    <div class="hint">Jurnal tidak dapat dihapus (immutable) — koreksi dilakukan dengan entri pembalik baru. Setiap perubahan tercatat di audit log server.</div>
  </div>`;
}

let jDraft=null;
function journalModalHtml(){
  const d=jDraft||{date:dayKey(),memo:'',lines:[]};
  const rows=d.lines.length?d.lines.map((l,i)=>
    `<div class="bom-row journal-row" data-jl="${i}">
      <select class="input input-sm" data-jl-acc="${i}">${COA.map(a=>`<option value="${a.code}"${a.code===l.acc?' selected':''}>${a.code} · ${a.name}</option>`).join('')}</select>
      <input class="input input-sm" data-jl-debit="${i}" inputmode="decimal" placeholder="Debit" value="${l.debit===''?'':esc(l.debit)}">
      <input class="input input-sm" data-jl-credit="${i}" inputmode="decimal" placeholder="Kredit" value="${l.credit===''?'':esc(l.credit)}">
      <button class="link-btn danger-link" data-action="journal-line-remove:${i}">Hapus</button></div>`).join('')
    :'<div class="empty-state">Belum ada baris — minimal dua baris (debit &amp; kredit).</div>';
  return `<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">⌁</span><div><b>Entri jurnal manual</b><small>Untuk beban, modal, atau koreksi — wajib seimbang</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>
  <div class="field-row">
    <label class="field"><span>Tanggal</span><input class="input" type="date" id="jDate" value="${esc(d.date)}"></label>
    <label class="field"><span>Keterangan</span><input class="input" id="jMemo" maxlength="80" placeholder="Contoh: Bayar listrik September" value="${esc(d.memo)}"></label>
  </div>
  <div class="bom-list">${rows}</div>
  <div class="btn-row"><button class="btn" data-action="journal-line-add">＋ Tambah baris</button></div>
  <div class="bom-total"><span>Total debit / kredit</span><b id="jTotal">0 / 0</b></div>
  <div class="hint">Contoh beban: baris 1 akun <b>6300 Listrik</b> debit, baris 2 akun <b>1100 Kas</b> kredit.</div>
  <div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button>
  <button class="btn btn-primary" data-action="journal-save">Simpan jurnal</button></div>`;
}
function openJournalEntry(){
  if(!window.canPerm('accounting','update')){toast('Role Anda tidak punya izin mencatat jurnal.');return}
  jDraft={date:dayKey(),memo:'',lines:[{acc:'6300',debit:'',credit:''},{acc:'1100',debit:'',credit:''}]};
  openModal(journalModalHtml());
}
function readJournalDraft(){
  if(!jDraft||!modalEl)return;
  const memoEl=modalEl.querySelector('#jMemo'),dateEl=modalEl.querySelector('#jDate');
  if(memoEl)jDraft.memo=memoEl.value;
  if(dateEl)jDraft.date=dateEl.value;
  jDraft.lines.forEach((l,i)=>{
    const a=modalEl.querySelector('[data-jl-acc="'+i+'"]');
    const dd=modalEl.querySelector('[data-jl-debit="'+i+'"]');
    const cc=modalEl.querySelector('[data-jl-credit="'+i+'"]');
    if(a)l.acc=a.value;
    if(dd)l.debit=String(dd.value||'').trim();
    if(cc)l.credit=String(cc.value||'').trim();
  });
}
function journalLineAdd(){
  if(!jDraft)return;
  readJournalDraft();
  jDraft.lines.push({acc:'1100',debit:'',credit:''});
  const m=modalEl&&modalEl.querySelector('.modal');if(m)m.innerHTML=journalModalHtml();
}
function journalLineRemove(i){
  if(!jDraft)return;
  readJournalDraft();
  jDraft.lines.splice(Number(i)||0,1);
  const m=modalEl&&modalEl.querySelector('.modal');if(m)m.innerHTML=journalModalHtml();
}
function saveJournal(){
  if(!jDraft)return;
  if(!window.canPerm('accounting','update')){toast('Role Anda tidak punya izin mencatat jurnal.');return}
  readJournalDraft();
  const memo=String(jDraft.memo||'').trim();
  const date=String(jDraft.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){toast('Tanggal jurnal belum diisi dengan benar.');return}
  if(!memo){toast('Keterangan jurnal wajib diisi.');return}
  if(memo.length>80){toast('Keterangan maksimal 80 karakter.');return}
  const lines=[];
  let debit=0,credit=0;
  for(const l of jDraft.lines){
    const dRaw=String(l.debit||'').replace(/\./g,'').replace(',','.');
    const cRaw=String(l.credit||'').replace(/\./g,'').replace(',','.');
    if(!dRaw&&!cRaw)continue;
    const dn=dRaw?Number(dRaw):0,cn=cRaw?Number(cRaw):0;
    if(!isFinite(dn)||dn<0||!isFinite(cn)||cn<0){toast('Nilai debit/kredit harus angka 0 ke atas.');return}
    if(dn&&cn){toast('Satu baris tidak boleh debit dan kredit sekaligus.');return}
    if(!dn&&!cn)continue;
    if(!COA.some(a=>a.code===l.acc)){toast('Akun tidak dikenal.');return}
    lines.push({acc:l.acc,debit:Math.round(dn),credit:Math.round(cn)});
    debit+=Math.round(dn);credit+=Math.round(cn);
  }
  if(lines.length<2){toast('Minimal dua baris jurnal (debit & kredit).');return}
  if(debit!==credit){toast('Jurnal tidak seimbang — selisih '+money(Math.abs(debit-credit))+'.');return}
  if(!store.accounting||!Array.isArray(store.accounting.journal))store.accounting={journal:[]};
  store.accounting.journal.push({id:'j'+Date.now().toString(36),date:date,memo:memo,source:'manual',lines:lines});
  if(!saveStore()){store.accounting.journal.pop();toast('Gagal menyimpan jurnal.');return}
  jDraft=null;closeModal();render('finance',true);
  toast('Jurnal tersimpan · debit = kredit '+money(debit)+'.');
}
function exportJournal(){
  if(!window.canPerm('accounting','export')&&!window.canPerm('finance','export')){toast('Role Anda tidak punya izin ekspor.');return}
  const rows=[['tanggal','keterangan','akun','nama_akun','debit','kredit','sumber']];
  allJournal().forEach(e=>(e.lines||[]).forEach(l=>rows.push([e.date,e.memo,l.acc,(COA.find(a=>a.code===l.acc)||{}).name||'',Number(l.debit)||0,Number(l.credit)||0,e.source])));
  const csv=rows.map(r=>r.map(c=>'"'+String(c==null?'':c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  try{
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download='jurnal-'+dayKey()+'.csv';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>{try{URL.revokeObjectURL(url)}catch(e){}},2000);
    toast('Jurnal diekspor ('+(rows.length-1)+' baris).');
  }catch(e){toast('Ekspor tidak didukung di peramban ini.')}
}
function reportsPage(){return `${heading('Laporan','Insight operasional dan keuangan untuk membantu keputusan bisnis.','<button class="btn" data-action="export">↓ Ekspor laporan</button>')}<div class="stats-grid">${stat('Penjualan bulan ini','Rp 184,6 jt','Target Rp 200 juta','↗','92% target')}${stat('Total transaksi','1.284 order','Rata-rata 54 per hari','▤','↗ 11,2%')}${stat('Produk terlaris','Kopi Susu Aren','368 gelas terjual','☕','')}${stat('Laba kotor','Rp 132,8 jt','Margin 72%','⌁','↗ 8,6%')}</div><div class="dashboard-grid">${chart()}${channels()}</div><div class="bottom-grid">${inventory()}${ledger()}</div>`}
/* =========================================================
   Pengaturan · foto profil · tautan akun · nama restoran
   Semua data disimpan lokal (localStorage) lalu disinkronkan ke server
   mengikuti email yang login (lihat core/sync.js).
   ========================================================= */
const STORE_KEY='restaurant-os:v1';
const DATE_LABEL=(function(){
  const d=new Date();
  const hari=['MINGGU','SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU'][d.getDay()];
  const bulan=['JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI','JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'][d.getMonth()];
  return hari+', '+d.getDate()+' '+bulan+' '+d.getFullYear();
})();
const DEFAULTS={restaurantName:'Rasa & Rona',restaurantLocation:'Jakarta Selatan',brandName:'',ownerName:'Raka Adinata',ownerRole:'Owner',avatar:'',lat:'',lng:'',accounts:{},theme:'espresso',isOpen:true,
  tables:DEFAULT_TABLES.map(t=>Object.assign({},t)),
  orders:SEED_ORDERS.map(o=>Object.assign({},o)),
  archive:[],
  products:DEFAULT_PRODUCTS.map(p=>Object.assign({},p,{variants:(p.variants||[]).slice()})),
  reservations:[
    {id:'r1',name:'Nadia Putri',date:'2026-09-24',time:'12:30',table:12,guests:4,status:'ready'},
    {id:'r2',name:'Aditya Prakoso',date:'2026-09-24',time:'13:00',table:4,guests:2,status:'ready'},
    {id:'r3',name:'Citra Maheswari',date:'2026-09-24',time:'13:30',table:8,guests:6,status:'preparing'},
    {id:'r4',name:'Rizky Ramadhan',date:'2026-09-24',time:'14:00',table:2,guests:3,status:'ready'},
    {id:'r5',name:'Salsabila Putri',date:'2026-09-24',time:'15:00',table:15,guests:5,status:'preparing'},
    {id:'r6',name:'Kevin Wijaya',date:'2026-09-25',time:'18:30',table:6,guests:2,status:'ready'}
  ],
  inventory:[
    {id:'i1',name:'Biji kopi Arabika',cat:'Kopi',unit:'kg',stock:1.2,min:2,cost:160000},
    {id:'i2',name:'Susu segar',cat:'Dairy',unit:'liter',stock:5,min:8,cost:17000},
    {id:'i3',name:'Sirup gula aren',cat:'Sirup',unit:'liter',stock:2.4,min:3,cost:45000},
    {id:'i4',name:'Beras pandan wangi',cat:'Bahan utama',unit:'kg',stock:18,min:5,cost:18000},
    {id:'i5',name:'Ayam fillet',cat:'Protein',unit:'kg',stock:12,min:5,cost:48000},
    {id:'i6',name:'Matcha powder',cat:'Teh',unit:'kg',stock:3.5,min:1,cost:300000},
    {id:'i7',name:'Gula pasir',cat:'Bahan dasar',unit:'kg',stock:7,min:2,cost:15000},
    {id:'i8',name:'Cup plastik 16oz',cat:'Kemasan',unit:'pcs',stock:240,min:100,cost:1200}
  ],
  recipes:[
    {id:'rc1',productId:'p1',items:[{invId:'i1',qty:0.02},{invId:'i2',qty:0.2},{invId:'i3',qty:0.03},{invId:'i7',qty:0.02}]},
    {id:'rc2',productId:'p2',items:[{invId:'i6',qty:0.03},{invId:'i2',qty:0.25},{invId:'i7',qty:0.02}]},
    {id:'rc3',productId:'p4',items:[{invId:'i4',qty:0.25},{invId:'i5',qty:0.15}]}
  ], 
  accounting:{journal:[]},
  stockLog:[]};
const cloneRecords=(list,fallback)=>Array.isArray(list)?list.filter(r=>r&&r.id).map(r=>Object.assign({},r)):(fallback||[]).map(r=>Object.assign({},r));
/* Kondisi "baru": semua data masih kosong (pesanan, arsip, menu, reservasi,
   identitas restoran). Dipakai saat pengunjung pertama kali membuka website
   dan saat Reset Data — jadi tidak perlu repot mereset secara manual. */
function freshStore(){
  return Object.assign({},DEFAULTS,{
    restaurantName:'',restaurantLocation:'',brandName:'',
    ownerName:'',ownerRole:'',avatar:'',lat:'',lng:'',accounts:{},
    orders:[],archive:[],products:[],reservations:[],cart:{},
    tables:DEFAULT_TABLES.map(t=>Object.assign({},t)),
    inventory:[],recipes:[],stockLog:[],accounting:{journal:[]},
    isOpen:true
  });
}
function loadStore(){try{const raw=localStorage.getItem(STORE_KEY);if(!raw)return freshStore();const data=JSON.parse(raw);const s=Object.assign({},DEFAULTS,data,{accounts:Object.assign({},(data&&data.accounts)||{})});s.reservations=cloneRecords(data.reservations);s.orders=cloneRecords(data.orders);s.archive=cloneRecords(data.archive);s.products=cloneRecords(data.products).map(p=>{p.variants=(p.variants||[]).map(v=>{if(v&&typeof v==='object')return v;const def=DEFAULT_PRODUCTS.find(d=>d.name===p.name);const dv=def?(def.variants||[]).find(x=>variantName(x)===v):null;return dv&&typeof dv==='object'?Object.assign({},dv):{name:String(v||''),price:0}}).filter(v=>v&&v.name);applyCategory(p);return p});
  const prods=s.products;
  const rawCart=(data&&data.cart)||{};
  const cartSaved={};
  Object.keys(rawCart).forEach(k=>{
    const it=rawCart[k];if(!it||!it.pid)return;
    const p=prods.find(x=>x.id===it.pid);if(!p)return;
    let q=parseInt(it.qty,10)||0;
    q=Math.max(0,Math.min(q,p.stock||0));
    if(!q)return;
    cartSaved[k]={pid:it.pid,variant:String(it.variant||''),qty:q,price:Number(it.price)>0?Number(it.price):p.price};
  });
  s.cart=cartSaved;
  /* master meja: data lama tanpa `tables` tetap mendapat default 18 meja */
  s.tables=(Array.isArray(data.tables)&&data.tables.length)
    ?data.tables.filter(t=>t&&Number(t.no)>0).map(t=>({no:Number(t.no),capacity:Number(t.capacity)>0?Number(t.capacity):4}))
    :DEFAULT_TABLES.map(t=>Object.assign({},t));
  s.inventory=cloneRecords(data.inventory,DEFAULTS.inventory);
  s.recipes=cloneRecords(data.recipes,DEFAULTS.recipes);
  s.stockLog=Array.isArray(data.stockLog)?data.stockLog.filter(e=>e&&e.t&&e.invId).slice(-400):[];
  const acc=data&&data.accounting;
  s.accounting={journal:Array.isArray(acc&&acc.journal)?acc.journal.filter(e=>e&&e.id&&Array.isArray(e.lines)).slice(-500):[]};
  return s}catch(e){return freshStore()}}
let store=loadStore();
let orders=store.orders;
products=store.products;
cart=store.cart||{};
let currentPage='overview';
applyTheme();
function saveStore(){try{store.cart=cart;localStorage.setItem(STORE_KEY,JSON.stringify(store));if(window.RasaSync){window.RasaSync.markOwner();window.RasaSync.schedulePush()}return true}catch(e){toast('Penyimpanan browser penuh.');return false}}
/* Simpan otomatis saat tab ditutup / diberalih agar tidak ada data hilang */
if(typeof window!=='undefined'&&window.addEventListener){
  window.addEventListener('beforeunload',()=>{try{store.cart=cart;localStorage.setItem(STORE_KEY,JSON.stringify(store))}catch(e){}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){try{store.cart=cart;localStorage.setItem(STORE_KEY,JSON.stringify(store))}catch(e){}}});
}
const initialsOf=name=>{const parts=(name||'').trim().split(/\s+/).filter(Boolean);if(!parts.length)return 'RA';return parts.slice(0,2).map(w=>w[0].toUpperCase()).join('')};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const firstNameOf=(fallback)=>{const parts=(store.ownerName||'').trim().split(/\s+/).filter(Boolean);if(parts.length)return parts[0];const r=(store.restaurantName||'').trim().split(/\s+/).filter(Boolean);return r.length?r[0]:(fallback||'Anda')};
function brandLabel(){const b=(store.brandName||'').trim();return (store.restaurantName||'').trim()||b||'rasa'}
function greeting(){const h=new Date().getHours();const part=h<11?'pagi':(h<15?'siang':(h<18?'sore':'malam'));return 'Selamat '+part+', '+firstNameOf()+' 👋'}

function applyBrand(){
  const label=brandLabel();
  const markEl=document.querySelector('.brand-mark');
  const letter=(label.match(/[A-Za-z0-9]/)||['r'])[0].toLowerCase()+'.';
  const markSrc=(store.avatar||'');
  if(markEl){
    if(markSrc){markEl.innerHTML='<img src="'+markSrc+'" alt="Logo">';markEl.title='Logo '+label}
    else{markEl.textContent=letter;markEl.title='Logo '+label}
  }
  const brandEl=document.querySelector('.brand-name');
  if(brandEl){brandEl.innerHTML=esc(label)+'<span class="brand-sub">RESTAURANT OS</span>';brandEl.title=label}
  document.title=label+' — Restaurant OS';
  const pv=document.getElementById('brandPreviewText');if(pv)pv.textContent=label;
  const bpm=document.getElementById('brandPreviewMark');
  if(bpm){if(markSrc){bpm.innerHTML='<img src="'+markSrc+'" alt="Logo">'}else{bpm.textContent=letter}}}

function applyIdentity(){
  applyTheme();
  const name=(store.restaurantName||'').trim()||'Tanpa nama';
  const loc=(store.restaurantLocation||'').trim()||'Lokasi belum diatur';
  const owner=(store.ownerName||'').trim()||'Pemilik';
  const role=(store.ownerRole||'').trim()||'Owner';
  const ini=initialsOf(owner);
  const branchName=document.querySelector('.branch b');if(branchName)branchName.textContent=name;
  const branchLoc=document.querySelector('.branch small');if(branchLoc)branchLoc.textContent=loc;
  const profName=document.querySelector('.profile b');if(profName)profName.textContent=owner;
  const profRole=document.querySelector('.profile small');if(profRole)profRole.textContent=role;
  document.querySelectorAll('.avatar,.top-avatar,.settings-avatar').forEach(el=>{
    if(store.avatar){el.innerHTML='<img src="'+store.avatar+'" alt="Foto profil">'}
    else{el.textContent=ini}
  });
  const eye=document.querySelector('.eyebrow');if(eye)eye.textContent=name.toUpperCase()+' · '+DATE_LABEL;
  applyBrand();
  applyLocationUI(name,loc);
  const pv=document.getElementById('namePreviewText');if(pv)pv.textContent=name;
  const pvLoc=document.getElementById('namePreviewLoc');if(pvLoc)pvLoc.textContent=loc;
  const greet=document.querySelector('#pageContent h1');if(greet&&currentPage==='overview')greet.textContent=greeting();
  applyStatusUI();
}

/* ---------- Lokasi cabang & Google Maps ---------- */
function validLatLng(){
  const lat=parseFloat(store.lat),lng=parseFloat(store.lng);
  if(!isFinite(lat)||!isFinite(lng))return null;
  if(Math.abs(lat)>90||Math.abs(lng)>180)return null;
  return {lat:lat,lng:lng};
}
function mapsUrl(){const c=validLatLng();return c?'https://www.google.com/maps?q='+c.lat+','+c.lng:''}
function openMaps(){
  const c=validLatLng();
  if(!c){toast('Koordinat belum diatur. Silakan isi di menu Pengaturan → Lokasi.');return}
  window.open(mapsUrl(),'_blank','noopener');
}
/* ---------- Status restoran: BUKA / TUTUP ----------
   Status disimpan pemilik di perangkat ini (localStorage). Karena website ini
   statis, status "dikirim" ke pelanggan lewat parameter link:
   https://…/?status=buka  atau  https://…/?status=tutup
   Pelanggan yang membuka link langsung melihat keterangan BUKA / TUTUP. */
let publicStatus=null;
(function readPublicStatus(){
  try{
    const v=String(new URLSearchParams(location.search).get('status')||'').toLowerCase();
    if(v)publicStatus=(v==='tutup'||v==='closed'||v==='0')?'tutup':'buka';
  }catch(e){}
})();
function isOpen(){return publicStatus?publicStatus==='buka':store.isOpen!==false}
function statusWord(){return isOpen()?'BUKA':'TUTUP'}
function statusShareUrl(){
  const base=(location.origin&&location.origin!=='null')?location.origin+location.pathname
    :'https://rasa-restaurant-os.rasa-os.workers.dev/';
  return base+'?status='+(isOpen()?'buka':'tutup');
}
function applyStatusUI(){
  const open=isOpen();
  const name=(store.restaurantName||'').trim()||'Restoran';
  const set=(id,txt)=>{const el=document.getElementById(id);if(el)el.textContent=txt};
  set('osName',name);
  set('osState',statusWord());
  set('branchStatus',statusWord());
  set('statusWord',statusWord());
  set('statusPreviewName',name);
  const btn=document.getElementById('openStatus');
  if(btn){btn.classList.toggle('is-closed',!open);btn.setAttribute('aria-pressed',String(open));
    btn.title=open?'Restoran sedang BUKA — klik untuk menutup':'Restoran sedang TUTUP — klik untuk membuka'}
  const chip=document.getElementById('branchStatus');
  if(chip)chip.classList.toggle('is-closed',!open);
  const card=document.getElementById('statusCard');
  if(card)card.classList.toggle('is-closed',!open);
  const link=document.getElementById('statusLink');
  if(link)link.value=statusShareUrl();
  const tog=document.getElementById('statusToggle');
  if(tog){tog.className='status-toggle'+(open?' is-on':' is-off');tog.setAttribute('aria-pressed',String(open))}
}
function toggleOpenStatus(){
  const next=!(store.isOpen!==false);
  store.isOpen=next;
  if(publicStatus){publicStatus=null;try{history.replaceState({},'',location.pathname+location.hash)}catch(e){}}
  saveStore();
  render(currentPage,true);
  const nama=(store.restaurantName||'Restoran').trim();
  toast(next?'Status diperbarui: '+nama+' BUKA — pelanggan melihat "BUKA" lewat link.'
            :'Status diperbarui: '+nama+' TUTUP — pelanggan melihat "TUTUP" lewat link.');
}
function fallbackCopy(text,done){
  try{
    const ta=document.createElement('textarea');
    ta.value=text;ta.setAttribute('readonly','');
    ta.style.position='fixed';ta.style.top='-1000px';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();
    const ok=document.execCommand('copy');
    document.body.removeChild(ta);
    ok?done():toast('Salin manual: '+text);
  }catch(e){toast('Salin manual: '+text)}
}
function copyStatusLink(){
  const url=statusShareUrl(),done=()=>toast('Link status disalin — kirimkan ke pelanggan.');
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(done).catch(()=>fallbackCopy(url,done));
  }else fallbackCopy(url,done);
}
function shareStatusLink(){
  const url=statusShareUrl();
  const text=(store.restaurantName||'Restoran').trim()+' sedang '+statusWord();
  if(navigator.share){navigator.share({title:document.title,text:text,url:url}).catch(()=>{})}
  else copyStatusLink();
}
function statusBanner(){
  if(!publicStatus)return '';
  const name=(store.restaurantName||'').trim()||'Restoran';
  return `<div class="status-banner${isOpen()?' is-open':' is-closed'}"><i></i><span><b>${esc(name)}</b> sedang <b>${statusWord()}</b> — status dari pemilik, dilihat lewat link bersama.</span><button class="banner-maps" data-action="open-maps">Buka di Google Maps ↗</button></div>`;
}
function statusPanel(){
  const open=isOpen();
  return `<div class="panel span-2">
    <div class="panel-head"><div><div class="panel-title">Status restoran · Buka / Tutup</div><div class="panel-caption">Nama restoran Anda akan tertulis BUKA atau TUTUP untuk pelanggan</div></div><button class="link-btn" data-action="open-maps">Buka di Google Maps ↗</button></div>
    <div class="status-grid">
      <div class="status-card${open?'':' is-closed'}" id="statusCard">
        <span class="status-card-mark">⌖</span>
        <b id="statusPreviewName">${esc(store.restaurantName||'Restoran')}</b>
        <span class="status-pill" id="statusWord">${statusWord()}</span>
        <small>Begini tampilan untuk pelanggan</small>
      </div>
      <div class="status-controls">
        <button class="status-toggle${open?' is-on':' is-off'}" id="statusToggle" data-action="toggle-open" aria-pressed="${open}">
          <span class="status-toggle-dot"></span>
          <span class="status-toggle-text">${open?'Sedang BUKA':'Sedang TUTUP'}</span>
          <em>klik untuk mengubah</em>
        </button>
        <div class="field"><span>Link status untuk pelanggan</span>
          <span class="link-row"><input class="input" id="statusLink" readonly value="${esc(statusShareUrl())}"><button class="btn" type="button" data-action="copy-status">Salin</button></span>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" data-action="share-status">⌁ Bagikan status</button>
          <button class="btn" data-action="open-maps">Lihat di Google Maps</button>
        </div>
      </div>
    </div>
    <div class="hint">Status disimpan otomatis di perangkat ini. Karena website berjalan statis, status dikirim ke pelanggan lewat link <b>?status=buka</b> / <b>?status=tutup</b> — pelanggan yang membuka link langsung melihat keterangan <b>BUKA</b> atau <b>TUTUP</b> beserta lokasi Anda di Google Maps. Google Maps tidak menyimpan status ini, jadi tempelkan link status tersebut pada kolom website/deskripsi di Google Business Profile Anda.</div>
  </div>`;
}
function applyLocationUI(name,loc){
  const c=validLatLng();
  const branch=document.querySelector('.branch');
  if(branch)branch.title=c?('Buka lokasi '+(name||'cabang')+' di Google Maps · '+c.lat+', '+c.lng):'Koordinat belum diatur';
  const coord=document.getElementById('coordPreviewText');
  if(coord)coord.textContent=c?(String(store.lat)+', '+String(store.lng)):'Koordinat belum diatur';
  const mn=document.getElementById('mapPreviewName');if(mn)mn.textContent=name||'Tanpa nama';
  const ma=document.getElementById('mapPreviewAddr');if(ma)ma.textContent=loc||'Alamat belum diatur';
  const link=document.getElementById('mapLink');
  if(link)link.classList.toggle('is-disabled',!c);
  document.querySelectorAll('[data-action="open-maps"]:not(.branch)').forEach(b=>b.classList.toggle('is-disabled',!c));
}
function setCoords(c){
  store.lat=c.lat;store.lng=c.lng;
  if(!saveStore())return;
  const li=document.getElementById('latInput');if(li)li.value=c.lat;
  const gi=document.getElementById('lngInput');if(gi)gi.value=c.lng;
  applyIdentity();
}
function parseMapsUrl(url){
  if(!url)return null;
  let m=url.match(/[?&#](?:q|ll|center)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if(!m)m=url.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if(!m)m=url.match(/(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  if(!m)return null;
  const lat=parseFloat(m[1]),lng=parseFloat(m[2]);
  if(Math.abs(lat)>90||Math.abs(lng)>180)return null;
  return {lat:String(lat),lng:String(lng)};
}
function pasteMapsLink(){
  const el=document.getElementById('mapsPaste');
  const c=parseMapsUrl(el?String(el.value||'').trim():'');
  if(!c){toast('Tautan Google Maps tidak dikenali. Salin link lengkap /place /maps/?q atau yang berisi @lat,lng.');return}
  setCoords(c);
  if(el)el.value='';
  toast('Koordinat diambil dari tautan Google Maps.');
}
function useMyLocation(){
  if(typeof navigator==='undefined'||!navigator.geolocation){toast('Browser ini tidak mendukung pembacaan lokasi perangkat.');return}
  toast('Membaca lokasi perangkat…');
  navigator.geolocation.getCurrentPosition(pos=>{
    setCoords({lat:pos.coords.latitude.toFixed(6),lng:pos.coords.longitude.toFixed(6)});
    toast('Koordinat perangkat berhasil disimpan.');
  },()=>toast('Izin lokasi ditolak atau gagal dibaca. Anda bisa isi manual atau tempel tautan Maps.'),{enableHighAccuracy:true,timeout:10000});
}

/* ---------- Reservasi: master data, hitung mundur, pemilihan meja & menu ---------- */
const MONTHS=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
function fmtDate(iso){
  const p=String(iso||'').split('-');
  if(p.length!==3)return String(iso||'');
  const d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]));
  if(isNaN(d.getTime()))return String(iso||'');
  return d.getDate()+' '+MONTHS[d.getMonth()]+' '+d.getFullYear();
}
function sortedReservations(){return (store.reservations||[]).slice().sort((a,b)=>String((a.date||'')+(a.time||'')).localeCompare(String((b.date||'')+(b.time||''))))}
function statusOf(r){
  if(r&&r.status==='cancelled')return {cls:'cancelled',label:'Dibatalkan'};
  return r&&r.status==='ready'?{cls:'ready',label:'DP diterima'}:{cls:'preparing',label:'Menunggu DP'};
}
function resStart(r){return resMoment(r)}
function fmtHm(ms){const d=new Date(ms);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function todayIso(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function resMoment(r){
  const p=String((r&&r.date)||'').split('-');
  const t=String((r&&r.time)||'00:00').split(':');
  if(p.length!==3)return null;
  const d=new Date(Number(p[0])||2020,(Number(p[1])||1)-1,Number(p[2])||1,Number(t[0])||0,Number(t[1])||0,0,0);
  return isNaN(d.getTime())?null:d;
}
function untilText(dt){
  const diff=dt.getTime()-Date.now();
  const past=diff<0,ms=Math.abs(diff);
  const DAY=864e5,HOUR=36e5,MIN=6e4;
  let txt;
  if(ms<MIN)txt=past?'kurang dari 1 menit':'segera tiba';
  else if(ms<DAY){const h=Math.floor(ms/HOUR),m=Math.floor((ms%HOUR)/MIN);txt=(h?h+' jam ':'')+m+' menit'}
  else{const d=Math.floor(ms/DAY),h=Math.floor((ms%DAY)/HOUR);txt=d+' hari'+(h?' '+h+' jam':'')}
  let short;
  if(ms<MIN)short=past?'lewat':'segera';
  else if(ms<DAY){const h=Math.floor(ms/HOUR),m=Math.floor((ms%HOUR)/MIN);short=h?(h+'j '+(m?m+'m':'')):(m+' menit')}
  else short='H-'+Math.floor(ms/DAY);
  return {
    past:past,ms:ms,
    level:past?'past':(ms<=2*HOUR?'urgent':(ms<=DAY?'soon':'far')),
    label:past?('telah lewat '+txt):(txt+' lagi'),
    short:short
  };
}
/* Format hitung mundur detail: "02 Jam 15 Menit 30 Detik" (>= 1 hari: "2 Hari 05 Jam") */
function cdFull(ms){
  const s=Math.max(0,Math.floor((Number(ms)||0)/1000));
  const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60),ss=s%60;
  if(d>0)return d+' Hari '+String(h).padStart(2,'0')+' Jam';
  return String(h).padStart(2,'0')+' Jam '+String(m).padStart(2,'0')+' Menit '+String(ss).padStart(2,'0')+' Detik';
}
function countdownOf(r){
  const dt=resStart(r);
  if(!dt)return null;
  return untilText(dt);
}
/* Hitung mundur live: diperbarui tiap detik tanpa refresh halaman.
   Lewat tenggat → merah "Telah melewati tenggat waktu". */
let liveCdTimer=null,liveCdBound=false;
function tickLiveCountdown(){
  if(typeof document==='undefined'||document.hidden)return;
  document.querySelectorAll('[data-cd-time]').forEach(el=>{
    const target=Number(el.getAttribute('data-cd-time'))||0;
    const diff=target-Date.now();
    if(diff<=0){
      if(el.textContent!=='Telah melewati tenggat waktu')el.textContent='Telah melewati tenggat waktu';
      el.classList.add('is-past','past');
      el.classList.remove('far','soon','urgent');
    }else{
      const txt=cdFull(diff);
      if(el.textContent!==txt)el.textContent=txt;
      el.classList.remove('is-past','past');
      el.classList.toggle('far',diff>864e5);
      el.classList.toggle('soon',diff<=864e5&&diff>2*36e5);
      el.classList.toggle('urgent',diff<=2*36e5);
    }
  });
}
function startLiveCountdown(){
  if(liveCdTimer)return;
  liveCdTimer=setInterval(tickLiveCountdown,1000);
  if(!liveCdBound){
    liveCdBound=true;
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden)return;
      if(!liveCdTimer)liveCdTimer=setInterval(tickLiveCountdown,1000);
      tickLiveCountdown();
    });
  }
}
/* ---------- Status penyajian pesanan reservasi ----------
   Pesanan yang terhubung ke jadwal (order.resId) menentukan apa yang
   tampil di kartu jadwal: bukan sekadar hitung mundur / "Telah melewati
   tenggat waktu", tapi kabar sebenarnya dari dapur & pelayan. */
const RES_FLOW={
  served:{rank:5,cls:'served',icon:'☑',label:'Pesanan sudah disajikan ke pelanggan',sub:'Tamu sudah menerima pesanannya — jadwal ini selesai dilayani.'},
  delivering:{rank:4,cls:'delivering',icon:'➤',label:'Pesanan sedang diantar ke meja',sub:'Pelayan sedang membawa pesanan ke meja tamu.'},
  ready:{rank:3,cls:'ready',icon:'✓',label:'Pesanan siap disajikan',sub:'Menunggu pelayan mengantar ke meja.'},
  preparing:{rank:2,cls:'preparing',icon:'♨',label:'Pesanan sedang disiapkan di dapur',sub:'Kitchen Display sedang memasak pesanan jadwal ini.'},
  paid:{rank:1,cls:'paid',icon:'⌗',label:'Pesanan sudah masuk ke dapur',sub:'Antrean baru — menunggu dapur mulai menyiapkan.'}
};
function resLinkedOrders(r){
  if(!r||!Array.isArray(orders))return [];
  return orders.filter(o=>o&&RES_FLOW[o.cls]&&String(o.resId)===String(r.id));
}
function resFlowOf(r){
  const list=resLinkedOrders(r);
  if(!list.length)return null;
  let best=null;
  list.forEach(o=>{const f=RES_FLOW[o.cls];if(f&&(!best||f.rank>best.rank))best=f});
  if(!best)return null;
  const ids=list.map(o=>String(o.id)).join(', ');
  return {cls:best.cls,rank:best.rank,icon:best.icon,label:best.label,sub:best.sub,ids:ids,count:list.length};
}
/* Badge status penyajian untuk kartu jadwal (menggantikan hitung mundur) */
function resFlowHtml(r){
  const f=resFlowOf(r);
  if(!f)return '';
  return '<span class="res-serve is-'+f.cls+'" title="Pesanan '+esc(f.ids)+' · '+esc(f.sub)+'">'+
    '<i class="res-serve-icon">'+f.icon+'</i>'+
    '<b class="res-serve-label">'+esc(f.label)+'</b>'+
    '<small class="res-serve-sub">'+esc(f.sub)+' · Pesanan '+esc(f.ids)+'</small></span>';
}
function inProgressReservation(list){
  for(let i=0;i<list.length;i++){if(resFlowOf(list[i]))return list[i]}
  return null;
}
function bookingCountdown(r){
  if(!r||r.status==='cancelled')return '';
  /* pesanan jadwal ini sedang disiapkan / disajikan → tampilkan status
     nyata dari dapur, bukan "Telah melewati tenggat waktu" */
  const flow=resFlowHtml(r);
  if(flow)return flow;
  const dt=resStart(r);
  if(!dt)return '';
  if(dt.getTime()<=Date.now()){
    return '<span class="res-count is-past" data-cd-time="'+dt.getTime()+'" title="Jadwal sudah lewat">Telah melewati tenggat waktu</span>';
  }
  return '<span class="res-cd"><span class="res-cd-label">⏱ Dimulai dalam</span> <span class="res-count" data-cd-time="'+dt.getTime()+'">'+cdFull(dt.getTime()-Date.now())+'</span></span>';
}
function nearestReservation(list){
  for(let i=0;i<list.length;i++){
    const cd=countdownOf(list[i]);
    if(cd&&!cd.past)return {res:list[i],cd:cd};
  }
  return null;
}
/* Rincian keuangan reservasi: subtotal menu, service charge, DP, sisa */
function resTotals(r){
  const items=(r&&Array.isArray(r.order))?r.order.filter(i=>i&&i.qty>0):[];
  const sub=items.reduce((n,i)=>n+(Number(i.price)||0)*Number(i.qty||0),0);
  const pct=Number(r&&r.servicePct)>0?Number(r.servicePct):0;
  const svc=Math.round(sub*pct/100);
  const dep=Number(r&&r.deposit)>0?Number(r.deposit):0;
  return {sub:sub,svc:svc,dep:dep,total:sub+svc,rest:Math.max(0,sub+svc-dep)};
}
function endTimeOf(r){
  const e=resEndMs(r);
  return e?fmtHm(e):'';
}
function bookingCard(r){
  const st=statusOf(r);
  const rid=esc(String(r.id));
  const cancelled=r.status==='cancelled';
  const cap=tableCapacity(r.table);
  const t=resTotals(r);
  const acc=(!cancelled&&r.status!=='ready')?'<button class="btn btn-add" data-action="toggle-dp:'+rid+'" title="Acc pembayaran DP tamu" aria-label="Acc DP '+esc(r.name)+'">✓ Acc DP</button>':'';
  const menu=(r.order&&r.order.length)?'<ul class="booking-menu">'+r.order.map(i=>'<li>'+i.qty+'× '+esc(i.name)+'<span>'+money(i.price*i.qty)+'</span></li>').join('')+
    '<li class="booking-total"><b>Total estimasi</b><span>'+money(t.total)+'</span></li>'+
    (t.dep?'<li class="booking-total dim"><b>Uang muka (DP)</b><span>− '+money(t.dep)+'</span></li>':'')+'</ul>':'';
  const hist=(r.history&&r.history.length)?'<small class="booking-hist">↻ Diubah '+r.history.length+' kali · terakhir: '+esc(r.history[r.history.length-1].note||'diperbarui')+'</small>':'';
  const range=esc(String(r.time||''))+(r.endTime?' – '+esc(String(r.endTime)):(r.duration?' – '+fmtHm((resStart(r)?resStart(r).getTime():0)+Number(r.duration||0)*60000):''));
  const actions=cancelled
    ?'<span class="status cancelled">Dibatalkan</span>'
    :'<button class="btn btn-mini" data-action="edit-res:'+rid+'" title="Ubah reservasi — data lama tetap tersimpan di riwayat" aria-label="Ubah reservasi '+esc(r.name)+'">✎ Ubah</button>'+
     '<button class="btn btn-mini btn-mini-danger" data-action="cancel-res:'+rid+'" title="Batalkan reservasi (tidak dihapus)" aria-label="Batalkan reservasi '+esc(r.name)+'">Batalkan</button>';
  return '<div class="booking-card'+(cancelled?' is-cancelled':'')+'"><div><b>'+esc(r.time)+' · '+esc(r.name)+'</b><small>'+esc(String(r.guests))+' orang · Meja '+esc(String(r.table))+' (kap. '+cap+' orang)<br>'+fmtDate(r.date)+' · '+range+'</small>'+bookingCountdown(r)+menu+hist+'</div><div class="booking-side">'+
    '<span class="status '+st.cls+'">'+st.label+'</span>'+acc+actions+'</div></div>';
}

/* ---------- Draf formulir reservasi (pilih meja + pilih menu) ---------- */
let resDraft=null;
function blankResDraft(){
  return {editingId:null,name:'',date:todayIso(),time:'18:30',durMin:RES_DURATION_DEFAULT,guests:2,table:null,order:{},deposit:0,servicePct:10};
}
function resDraftFrom(r){
  const order={};
  (r.order||[]).forEach(i=>{if(i&&i.pid&&Number(i.qty)>0)order[String(i.pid)]=Number(i.qty)});
  const st=resStart(r),en=resEndMs(r);
  let dur=parseInt(r.duration,10);
  if(!(dur>=15)&&st&&en)dur=Math.max(15,Math.round((en-st.getTime())/60000));
  return {editingId:String(r.id),name:String(r.name||''),date:String(r.date||todayIso()),time:String(r.time||'18:30'),
    durMin:dur>=15?dur:RES_DURATION_DEFAULT,guests:Number(r.guests)||1,table:Number(r.table)||null,
    order:order,deposit:Number(r.deposit)>0?Number(r.deposit):0,servicePct:Number(r.servicePct)>0?Number(r.servicePct):10};
}
function draftStartMs(d){
  if(!d)return null;
  const p=String(d.date||'').split('-');
  if(p.length!==3||!/^\d{1,2}:\d{2}$/.test(String(d.time||'')))return null;
  const t=String(d.time).split(':');
  const ms=new Date(Number(p[0])||2020,(Number(p[1])||1)-1,Number(p[2])||1,Number(t[0])||0,Number(t[1])||0,0,0).getTime();
  return isNaN(ms)?null:ms;
}
function draftEndMs(d){
  const s=draftStartMs(d);
  if(!s)return null;
  let mins=parseInt(d&&d.durMin,10);
  if(!(mins>=15))mins=RES_DURATION_DEFAULT;
  return s+mins*60000;
}
function resMenuQty(pid){return Math.max(0,Number(resDraft&&resDraft.order[String(pid)])||0)}
function resDraftLines(){
  if(!resDraft)return [];
  return products.filter(p=>resMenuQty(p.id)>0).map(p=>({pid:p.id,name:p.name,qty:resMenuQty(p.id),price:Number(p.price)||0}));
}
/* ---------- Grid kartu menu (foto, nama, harga, kategori, stepper) ---------- */
function resMenuGridHtml(){
  const list=products.filter(p=>!isSoldOut(p));
  if(!list.length){
    return '<div class="empty-block"><span class="empty-icon">🍽</span><b>Belum ada menu tersedia</b><small>Tambahkan menu lewat halaman <b>Menu &amp; produk</b>. Reservasi tetap bisa dibuat tanpa pesanan menu.</small></div>';
  }
  return '<div class="rm-card-grid">'+list.map(p=>{
    const pid=String(p.id);
    const qty=resMenuQty(p.id);
    const max=Math.max(1,p.stock||1);
    return '<div class="rm-card'+(qty>0?' has':'')+'" id="rmCard_'+esc(pid)+'">'+
      '<div class="rm-photo">'+productThumb(p)+(qty>0?'<span class="rm-badge" id="rmBadge_'+esc(pid)+'">'+qty+'</span>':'')+'</div>'+
      '<div class="rm-info"><span class="rm-cat">'+esc(p.cat||'Menu')+'</span><b>'+esc(p.name)+'</b><span class="rm-price">'+money(p.price)+'</span></div>'+
      '<div class="rm-stepper">'+
        '<button type="button" class="rm-step" data-action="res-menu-dec:'+esc(pid)+'" aria-label="Kurangi '+esc(p.name)+'"'+(qty<1?' disabled':'')+'>−</button>'+
        '<span class="rm-qty-num" id="rmQty_'+esc(pid)+'">'+qty+'</span>'+
        '<button type="button" class="rm-step" data-action="res-menu-inc:'+esc(pid)+'" aria-label="Tambah '+esc(p.name)+'"'+(qty>=max?' disabled':'')+'>＋</button>'+
      '</div></div>';
  }).join('')+'</div>';
}
function resMenuCardUpdate(pid){
  pid=String(pid);
  const card=document.getElementById('rmCard_'+pid);
  if(!card||!resDraft)return;
  const qty=resMenuQty(pid);
  const p=productById(pid);
  card.classList.toggle('has',qty>0);
  const q=document.getElementById('rmQty_'+pid);
  if(q)q.textContent=String(qty);
  const badge=document.getElementById('rmBadge_'+pid);
  if(qty>0){
    if(badge)badge.textContent=String(qty);
    else{const ph=card.querySelector('.rm-photo');if(ph){const b=document.createElement('span');b.className='rm-badge';b.id='rmBadge_'+pid;b.textContent=String(qty);ph.appendChild(b)}}
  }else if(badge){badge.remove()}
  const dec=card.querySelector('[data-action^="res-menu-dec:"]');if(dec)dec.disabled=qty<1;
  const inc=card.querySelector('[data-action^="res-menu-inc:"]');if(inc)inc.disabled=!!(p&&p.stock>0&&qty>=Math.max(1,p.stock||1));
}
function resMenuInc(pid){
  if(!resDraft)return;
  const p=productById(pid);if(!p)return;
  if(isSoldOut(p)){toast(p.name+' sedang habis.');return}
  const max=Math.max(1,p.stock||1);
  const cur=resMenuQty(pid);
  if(cur>=max){toast('Stok '+p.name+' tinggal '+max+'.');return}
  resDraft.order[String(pid)]=cur+1;
  resMenuCardUpdate(pid);
  resSumRefresh();
}
function resMenuDec(pid){
  if(!resDraft)return;
  const cur=resMenuQty(pid);
  if(cur<1)return;
  if(cur-1<1)delete resDraft.order[String(pid)];else resDraft.order[String(pid)]=cur-1;
  resMenuCardUpdate(pid);
  resSumRefresh();
}
/* ---------- Grid kartu meja (hijau = tersedia, merah = sudah dipesan) ---------- */
function resTblLegend(){
  return '<div class="meja-legend"><span><i class="dot free"></i> Hijau = Tersedia</span><span><i class="dot busy"></i> Merah = Tidak tersedia / sudah dipesan</span></div>';
}
function resTblGridHtml(){
  if(!resDraft)return '';
  const guests=Math.max(1,Number(resDraft.guests)||1);
  const start=draftStartMs(resDraft),end=draftEndMs(resDraft);
  const list=tablesMaster();
  if(!list.length){
    return '<div class="empty-block"><span class="empty-icon">▦</span><b>Belum ada data meja</b><small>Master meja tidak ditemukan — muat ulang halaman.</small></div>';
  }
  const cards=list.map(t=>{
    const no=Number(t.no),cap=Number(t.capacity)||4;
    const capShort=cap<guests;
    const st=(start&&end)?tableStatusAt(no,resDraft.date,start,end,resDraft.editingId):{busy:false,conflict:null};
    let cls='tbl-card',badge,badgeCls;
    if(capShort){cls+=' too-small';badge='Kapasitas kurang';badgeCls='busy'}
    else if(st.busy){cls+=' busy';badge='Sudah dipesan';badgeCls='busy'}
    else{cls+=' free';badge='Tersedia';badgeCls='free'}
    const selected=Number(resDraft.table)===no;
    if(selected)cls+=' selected';
    const when=st.conflict?('<i class="tbl-when">'+esc(String(st.conflict.time||''))+(st.conflict.endTime?' – '+esc(String(st.conflict.endTime)):'')+' · '+esc(String(st.conflict.name||'Tamu'))+'</i>'):'';
    return '<button type="button" class="'+cls+'" data-action="res-pick-table:'+no+'" aria-pressed="'+(selected?'true':'false')+'"'+((capShort||st.busy)?' disabled':'')+'>'+
      '<span class="tbl-no">Meja '+String(no).padStart(2,'0')+'</span>'+
      '<span class="tbl-meta">Kapasitas '+cap+' orang</span>'+
      '<span class="tbl-badge '+badgeCls+'">'+badge+'</span>'+when+
      '</button>';
  }).join('');
  return '<div class="tbl-grid">'+cards+'</div>'+resTblLegend();
}
function resShowWarn(msg){
  const w=document.getElementById('resWarn');
  if(w)w.innerHTML='<div class="res-warn">⚠ '+esc(msg)+'</div>';
  toast(msg);
}
/* ---------- Ringkasan pesanan & rincian biaya ---------- */
function resSumHtml(){
  const lines=resDraftLines();
  if(!lines.length){
    return '<div class="res-sum is-empty"><span>Belum ada menu dipilih — pilih makanan atau minuman di bagian Pilih Menu.</span></div>';
  }
  const sub=lines.reduce((n,l)=>n+l.price*l.qty,0);
  const pct=Number(resDraft&&resDraft.servicePct)>0?Number(resDraft.servicePct):0;
  const svc=Math.round(sub*pct/100);
  const dep=Math.max(0,Number(resDraft&&resDraft.deposit)||0);
  return '<div class="res-sum">'+
    '<div class="res-form-title" style="margin-bottom:6px">Menu Pesanan</div>'+
    lines.map(l=>'<div class="res-sum-line item"><span>'+esc(l.name)+' <i class="res-sum-qty">×'+l.qty+'</i></span><b>'+money(l.price*l.qty)+'</b></div>').join('')+
    '<div class="res-sum-line"><span>Subtotal menu</span><b>'+money(sub)+'</b></div>'+
    (svc?'<div class="res-sum-line fee"><span>Service charge ('+pct+'%)</span><b>'+money(svc)+'</b></div>':'')+
    '<div class="res-sum-line grand"><span>Total Estimasi</span><b>'+money(sub+svc)+'</b></div>'+
    (dep?'<div class="res-sum-line fee"><span>Uang muka (DP)</span><b>− '+money(dep)+'</b></div><div class="res-sum-line"><span>Sisa tagihan saat datang</span><b>'+money(Math.max(0,sub+svc-dep))+'</b></div>':'')+
    '</div>';
}
function resSumRefresh(){
  const sg=document.getElementById('resSumBox');
  if(sg)sg.innerHTML=resSumHtml();
}
/* ---------- Hitung mundur di dalam formulir ---------- */
function resCdBoxHtml(){
  const s=resDraft?draftStartMs(resDraft):null;
  const e=resDraft?draftEndMs(resDraft):null;
  if(!s||!e){
    return '<div class="res-cd-box idle"><b>Hitung mundur</b><small>Muncul otomatis setelah tanggal &amp; jam reservasi diisi — diperbarui tiap detik tanpa refresh.</small></div>';
  }
  const range=esc(String(resDraft.time))+' – '+fmtHm(e);
  /* jadwal yang sedang disiapkan / disajikan: tampilkan status pesanan */
  const rec=resDraft.editingId?store.reservations.find(x=>String(x.id)===String(resDraft.editingId)):null;
  const flow=rec?resFlowOf(rec):null;
  if(flow){
    return '<div class="res-cd-box flow"><b>Status pesanan jadwal ini</b>'+
      '<span class="res-serve is-'+flow.cls+'"><i class="res-serve-icon">'+flow.icon+'</i><b class="res-serve-label">'+esc(flow.label)+'</b></span>'+
      '<small>'+range+' · '+esc(flow.sub)+' · Pesanan '+esc(flow.ids)+'</small></div>';
  }
  if(s<=Date.now()){
    return '<div class="res-cd-box past"><b>Tenggat waktu</b><span class="res-count is-past" data-cd-time="'+s+'">Telah melewati tenggat waktu</span><small>'+range+' · jadwal sudah lewat dari waktu sekarang</small></div>';
  }
  return '<div class="res-cd-box"><b>Dimulai dalam</b><span class="res-count" data-cd-time="'+s+'">'+cdFull(s-Date.now())+'</span><small>'+range+'</small></div>';
}
function resFormRefresh(){
  if(!resDraft||!modalEl)return;
  const cd=document.getElementById('resCdBox');if(cd)cd.innerHTML=resCdBoxHtml();
  const tg=document.getElementById('resTblGrid');if(tg)tg.innerHTML=resTblGridHtml();
  resSumRefresh();
}
function resPickTable(no){
  if(!resDraft)return;
  no=Number(no);
  const guests=Math.max(1,Number(resDraft.guests)||1);
  const cap=tableCapacity(no);
  if(cap<guests){resShowWarn('Meja '+no+' hanya berkapasitas '+cap+' orang untuk '+guests+' tamu — silakan pilih meja lain.');return}
  const start=draftStartMs(resDraft),end=draftEndMs(resDraft);
  if(start&&end){
    const conflict=findResConflict(no,resDraft.date,start,end,resDraft.editingId);
    if(conflict){
      resShowWarn('Meja '+no+' tidak tersedia pada waktu tersebut karena sudah memiliki reservasi '+(conflict.time||'')+(conflict.endTime?' – '+conflict.endTime:'')+' atas nama '+(conflict.name||'tamu')+'.');
      return;
    }
  }
  resDraft.table=no;
  document.querySelectorAll('#resTblGrid .tbl-card').forEach(el=>{
    const parts=String(el.getAttribute('data-action')||'').split(':');
    const on=Number(parts[1])===no;
    el.classList.toggle('selected',on);
    el.setAttribute('aria-pressed',on?'true':'false');
  });
  const w=document.getElementById('resWarn');if(w)w.innerHTML='';
}
/* ---------- Formulir reservasi (modal lebar: meja + menu + biaya) ---------- */
function resFormHtml(editingRec){
  const d=resDraft||blankResDraft();
  const durOpts=[60,90,120,180].map(m=>'<option value="'+m+'"'+(Number(d.durMin)===m?' selected':'')+'>'+(m>=60?(m/60)+' jam':'')+(m%60?' '+(m%60)+' menit':'')+'</option>').join('');
  return '<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">▦</span><div><b>'+(editingRec?'Ubah reservasi':'Reservasi baru')+'</b><small>'+(editingRec?'Perbarui jadwal — data lama tetap tersimpan di riwayat':'Pilih meja, tentukan jam, dan pesan menu sejak awal')+'</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>'+
  '<div class="res-form">'+
  '<div class="res-form-sec"><div class="res-form-title">1 · Data tamu</div>'+
    '<label class="field"><span>Nama tamu</span><input class="input" id="resName" placeholder="Contoh: Nadia Putri" maxlength="40" autocomplete="off" value="'+esc(d.name)+'"></label>'+
    '<div class="field-row"><label class="field"><span>Tanggal</span><input class="input" type="date" id="resDate" value="'+esc(d.date)+'"></label>'+
    '<label class="field"><span>Jam mulai</span><input class="input" type="time" id="resTime" value="'+esc(d.time)+'"></label></div>'+
    '<div class="field-row"><label class="field"><span>Durasi meja</span><select class="input" id="resDur">'+durOpts+'</select></label>'+
    '<label class="field"><span>Jumlah tamu</span><input class="input" type="number" id="resGuests" min="1" max="60" value="'+Number(d.guests||1)+'"></label></div>'+
    '<div id="resCdBox">'+resCdBoxHtml()+'</div></div>'+
  '<div class="res-form-sec"><div class="res-form-title">2 · Pilih nomor meja <span class="res-sec-note">otomatis memeriksa ketersediaan berdasarkan tanggal, jam, &amp; jumlah tamu</span></div><div id="resTblGrid">'+resTblGridHtml()+'</div></div>'+
  '<div class="res-form-sec"><div class="res-form-title">3 · Pilih menu <span class="res-sec-note">opsional — untuk disiapkan saat tamu datang</span></div><div id="resMenuGrid">'+resMenuGridHtml()+'</div></div>'+
  '<div class="res-form-sec"><div class="res-form-title">4 · Rincian biaya</div>'+
    '<label class="field"><span>Uang muka / deposit (Rp) · opsional</span><input class="input" type="number" id="resDeposit" min="0" step="1000" value="'+Number(d.deposit||0)+'" placeholder="0"></label>'+
    '<div id="resSumBox">'+resSumHtml()+'</div></div>'+
  '<div id="resWarn"></div>'+
  '</div>'+
  '<div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-primary" data-action="res-confirm">Periksa &amp; Konfirmasi →</button></div>'+
  '<p class="modal-note">Ketersediaan meja dihitung dari reservasi tersimpan — sistem tidak mengizinkan dua reservasi aktif pada meja &amp; jam yang bertabrakan.</p>';
}
function openResForm(editId,keepDraft){
  if(!(keepDraft&&resDraft)){
    const r=(editId!=null&&editId!=='')?store.reservations.find(x=>String(x.id)===String(editId)):null;
    resDraft=r?resDraftFrom(r):blankResDraft();
  }
  const editing=resDraft&&resDraft.editingId?store.reservations.find(x=>String(x.id)===resDraft.editingId):null;
  openModal(resFormHtml(editing),{wide:true});
  const n=document.getElementById('resName');if(n)n.focus();
  startLiveCountdown();
  tickLiveCountdown();
}
function resBackToForm(){openResForm(null,true)}
function resCollectDraft(){
  if(!resDraft)return null;
  resDraft.name=fieldVal('resName');
  resDraft.date=fieldVal('resDate');
  resDraft.time=fieldVal('resTime');
  const guests=parseInt(fieldVal('resGuests'),10);
  if(guests>=1)resDraft.guests=Math.min(60,guests);
  resDraft.deposit=Math.max(0,parseRp(fieldVal('resDeposit')));
  const durEl=document.getElementById('resDur');
  if(durEl){const m=parseInt(durEl.value,10);if(m>=15)resDraft.durMin=m}
  return resDraft;
}
function fieldVal(id){const el=document.getElementById(id);return el?String(el.value||'').trim():''}
/* Langkah 1 validasi → tampilkan modal konfirmasi (poin 9) */
function openResConfirm(){
  const d=resCollectDraft();
  if(!d)return;
  if(!d.name.trim()){resShowWarn('Nama tamu wajib diisi.');return}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)){resShowWarn('Tanggal reservasi belum dipilih.');return}
  if(!/^\d{2}:\d{2}$/.test(d.time)){resShowWarn('Jam reservasi belum diisi.');return}
  const start=draftStartMs(d);
  if(!start){resShowWarn('Tanggal atau jam reservasi tidak valid.');return}
  const end=draftEndMs(d);
  if(!d.table){resShowWarn('Pilih nomor meja terlebih dahulu.');return}
  const cap=tableCapacity(d.table);
  if(cap<d.guests){resShowWarn('Meja '+d.table+' hanya berkapasitas '+cap+' orang — silakan pilih meja lain.');return}
  const conflict=findResConflict(d.table,d.date,start,end,d.editingId);
  if(conflict){
    resShowWarn('Meja '+d.table+' tidak tersedia pada waktu tersebut karena sudah memiliki reservasi '+(conflict.time||'')+(conflict.endTime?' – '+conflict.endTime:'')+' atas nama '+(conflict.name||'tamu')+'. Silakan pilih meja lain atau ubah waktu reservasi.');
    return;
  }
  openModal(resConfirmHtml(d,cap,start,end));
  startLiveCountdown();
  tickLiveCountdown();
}
function resConfirmHtml(d,cap,start,end){
  const lines=resDraftLines();
  const sub=lines.reduce((n,l)=>n+l.price*l.qty,0);
  const svc=Math.round(sub*(Number(d.servicePct)>0?Number(d.servicePct):0)/100);
  const total=sub+svc;
  const dep=Math.max(0,Number(d.deposit)||0);
  const menuHtml=lines.length
    ?'<ul class="res-confirm-menu">'+lines.map(l=>'<li><span>'+esc(l.name)+' <i>×'+l.qty+'</i></span><b>'+money(l.price*l.qty)+'</b></li>').join('')+'</ul>'
    :'<p class="modal-note" style="text-align:left">Tidak ada menu dipesan — tamu akan memesan di tempat.</p>';
  const pastStart=(start&&start<=Date.now());
  const editingRec=(d&&d.editingId)?store.reservations.find(x=>String(x.id)===String(d.editingId)):null;
  const editingFlow=editingRec?resFlowOf(editingRec):null;
  const pastWarn=pastStart?'<div class="res-warn">'+(editingFlow
    ? '⚠ Jadwal ini sudah lewat, tetapi pesanannya sedang <b>'+esc(editingFlow.label.toLowerCase())+'</b> (Pesanan '+esc(editingFlow.ids)+') — kartu jadwal akan menampilkan status tersebut, bukan hitung mundur.'
    : '⚠ Jadwal ini sudah lewat dari waktu sekarang — hitung mundur akan menampilkan <b>"Telah melewati tenggat waktu"</b>.')+'</div>':'';
  return '<div class="modal-head"><span class="provider-mark" style="--pm:#3f7a4a">✓</span><div><b>Konfirmasi Reservasi</b><small>Periksa kembali data sebelum disimpan</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>'+
  '<div class="res-confirm">'+pastWarn+
  '<dl class="res-confirm-grid">'+
    '<div><dt>Nama</dt><dd>'+esc(d.name)+'</dd></div>'+
    '<div><dt>Tanggal</dt><dd>'+fmtDate(d.date)+'</dd></div>'+
    '<div><dt>Waktu</dt><dd>'+esc(d.time)+' – '+fmtHm(end)+'</dd></div>'+
    '<div><dt>Jumlah tamu</dt><dd>'+Number(d.guests||1)+' Orang</dd></div>'+
    '<div><dt>Meja</dt><dd>Meja '+String(d.table).padStart(2,'0')+'<small class="dd-sub">kapasitas '+cap+' orang</small></dd></div>'+
  '</dl>'+
  '<div class="res-form-title" style="margin-top:12px">Menu</div>'+menuHtml+
  '<div class="res-sum confirm">'+
    '<div class="res-sum-line"><span>Subtotal menu</span><b>'+money(sub)+'</b></div>'+
    (svc?'<div class="res-sum-line fee"><span>Service charge ('+(Number(d.servicePct)||0)+'%)</span><b>'+money(svc)+'</b></div>':'')+
    '<div class="res-sum-line grand"><span>Estimasi Total</span><b>'+money(total)+'</b></div>'+
    (dep?'<div class="res-sum-line fee"><span>Uang muka (DP)</span><b>− '+money(dep)+'</b></div><div class="res-sum-line"><span>Sisa tagihan saat datang</span><b>'+money(Math.max(0,total-dep))+'</b></div>':'')+
  '</div></div>'+
  '<div class="modal-actions"><button class="btn" data-action="res-back">← Kembali</button><button class="btn btn-primary" data-action="res-commit">Konfirmasi Reservasi</button></div>'+
  '<p class="modal-note">Setelah dikonfirmasi, reservasi tersimpan dan status meja ikut diperbarui otomatis dari data ini.</p>';
}
/* Langkah 2 simpan — data lama tidak pernah dihapus.
   Draft sudah dikumpulkan saat membuka modal konfirmasi (form sudah tertutup),
   jadi commit membaca resDraft apa adanya, bukan membaca input DOM lagi. */
function commitRes(){
  const d=resDraft;
  if(!d)return;
  if(!d.name.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!/^\d{2}:\d{2}$/.test(d.time)||!d.table){
    closeModal();toast('Data reservasi tidak lengkap — silakan periksa kembali.');return;
  }
  const start=draftStartMs(d),end=draftEndMs(d);
  if(!start||!end){closeModal();toast('Tanggal atau jam reservasi tidak valid.');return}
  const conflict=findResConflict(d.table,d.date,start,end,d.editingId);
  if(conflict){
    openResForm(null,true);
    resShowWarn('Meja '+d.table+' tidak tersedia pada waktu tersebut karena sudah memiliki reservasi '+(conflict.time||'')+(conflict.endTime?' – '+conflict.endTime:'')+' atas nama '+(conflict.name||'tamu')+'. Silakan pilih meja lain atau ubah waktu reservasi.');
    return;
  }
  const lines=resDraftLines();
  const endTime=fmtHm(end);
  const now=Date.now();
  if(d.editingId){
    const r=store.reservations.find(x=>String(x.id)===String(d.editingId));
    if(!r){closeModal();toast('Reservasi tidak ditemukan.');return}
    const backup=Object.assign({},r);
    const hist=Array.isArray(r.history)?r.history.slice():[];
    hist.push({at:now,note:'Diperbarui · meja '+r.table+' '+r.time+(r.endTime?'–'+r.endTime:'')+' → meja '+d.table+' '+d.time+'–'+endTime});
    r.name=d.name.trim();r.date=d.date;r.time=d.time;r.table=d.table;r.guests=d.guests;
    r.duration=d.durMin;r.endTime=endTime;r.deposit=d.deposit;r.servicePct=d.servicePct;
    r.order=lines.map(l=>({pid:l.pid,name:l.name,qty:l.qty,price:l.price}));
    r.history=hist.slice(-20);r.updatedAt=now;
    if(!saveStore()){Object.assign(r,backup);toast('Gagal menyimpan perubahan — data lama dipulihkan.');return}
    closeModal();resDraft=null;render('reservations');
    toast('Reservasi '+r.name+' diperbarui · '+fmtDate(r.date)+' '+r.time+'–'+endTime+' · Meja '+r.table+'. Data lama tercatat di riwayat.');
    return;
  }
  const rec={id:'r'+Date.now()+Math.floor(Math.random()*1000),name:d.name.trim(),date:d.date,time:d.time,table:d.table,guests:d.guests,
    status:'preparing',
    order:lines.map(l=>({pid:l.pid,name:l.name,qty:l.qty,price:l.price})),
    duration:d.durMin,endTime:endTime,deposit:d.deposit,servicePct:d.servicePct,
    history:[],createdAt:now,updatedAt:now};
  store.reservations.push(rec);
  if(!saveStore()){store.reservations.pop();toast('Gagal menyimpan reservasi.');return}
  closeModal();resDraft=null;render('reservations');
  toast('Reservasi '+rec.name+' · '+fmtDate(rec.date)+' pukul '+rec.time+'–'+endTime+' · Meja '+rec.table+' tersimpan.');
}
function resToOrder(r){
  const items=(r.order||[]).filter(i=>i&&i.qty>0);
  if(!items.length)return null;
  const total=items.reduce((n,i)=>n+Number(i.price||0)*i.qty,0);
  const count=items.reduce((n,i)=>n+i.qty,0);
  const order={
    id:nextOrderId(),guest:r.name,items:count+' item',type:'Reservasi · Meja '+r.table,
    total:money(total),status:'Terjadwal',cls:'scheduled',time:r.time,at:Date.now(),
    detail:items.map(i=>({name:i.name,qty:i.qty,price:Number(i.price)||0,pid:i.pid||''})),
    method:'DP reservasi',resId:r.id,resDate:r.date,resTime:r.time
  };
  orders.unshift(order);
  store.orders=orders;
  if(!saveStore()){orders.shift();return null}
  return order;
}
function toggleDp(id){
  const r=store.reservations.find(x=>String(x.id)===String(id));
  if(!r){toast('Reservasi tidak ditemukan.');return}
  if(r.status==='cancelled'){toast('Reservasi '+r.name+' sudah dibatalkan — DP tidak bisa diacc.');return}
  if(r.status==='ready'){toast('DP '+r.name+' sudah pernah diacc.');return}
  r.status='ready';
  if(!saveStore()){r.status='preparing';toast('Gagal menyimpan perubahan.');return}
  render('reservations');
  if(r.order&&r.order.length){
    const already=orders.find(o=>String(o.resId)===String(r.id)&&o.cls!=='cancelled');
    if(already){toast('DP diacc · menu sudah di kitchen display (jadwal '+already.time+').');return}
    const ord=resToOrder(r);
    toast(ord?('DP diacc · '+r.order.length+' menu masuk Kitchen Display, jadwal '+r.time+'.'):'DP diacc, tetapi menu gagal dikirim ke dapur.');
    return;
  }
  toast('Pembayaran DP '+r.name+' diacc. Reservasi terkonfirmasi.');
}
/* Pembatalan: status menjadi "Dibatalkan", data TIDAK dihapus (riwayat owner) */
function askCancelRes(id){
  const r=store.reservations.find(x=>String(x.id)===String(id));
  if(!r){toast('Reservasi tidak ditemukan.');return}
  const linked=orders.find(o=>String(o.resId)===String(r.id)&&o.cls!=='cancelled'&&o.cls!=='served');
  openModal('<div class="modal-head"><span class="provider-mark" style="--pm:#8a3324">✕</span><div><b>Batalkan reservasi '+esc(r.name)+'?</b><small>'+fmtDate(r.date)+' · '+esc(String(r.time))+' · Meja '+esc(String(r.table))+'</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>'+
    '<p class="modal-text">Reservasi akan ditandai <b>Dibatalkan</b> — <b>tidak dihapus</b>, sehingga Anda tetap dapat melihat riwayatnya di halaman Reservasi.'+(linked?' Pesanan dapur <b>'+esc(String(linked.id))+'</b> yang masih aktif juga akan dibatalkan agar dapur tidak menyiapkan meja batal.':'')+'</p>'+
    '<div class="modal-actions"><button class="btn" data-action="close-modal">Kembali</button><button class="btn btn-danger" data-action="confirm-cancel-res:'+esc(String(id))+'">Ya, batalkan reservasi</button></div>');
}
function cancelRes(id){
  const r=store.reservations.find(x=>String(x.id)===String(id));
  if(!r){toast('Reservasi tidak ditemukan.');return}
  if(r.status==='cancelled'){toast('Reservasi '+r.name+' sudah pernah dibatalkan.');return}
  const backup=Object.assign({},r);
  const now=Date.now();
  const hist=Array.isArray(r.history)?r.history.slice():[];
  hist.push({at:now,note:'Dibatalkan'});
  r.status='cancelled';r.cancelledAt=now;r.history=hist.slice(-20);r.updatedAt=now;
  const linkedOrders=orders.filter(o=>String(o.resId)===String(r.id)&&o.cls!=='cancelled'&&o.cls!=='served');
  const orderBackups=linkedOrders.map(o=>({o:o,cls:o.cls,status:o.status}));
  orderBackups.forEach(b=>{b.o.cls='cancelled';b.o.status='Dibatalkan'});
  store.orders=orders;
  if(!saveStore()){
    Object.assign(r,backup);
    orderBackups.forEach(b=>{b.o.cls=b.cls;b.o.status=b.status});
    toast('Gagal menyimpan — reservasi tidak dibatalkan.');return;
  }
  render('reservations');
  toast('Reservasi '+r.name+' ('+fmtDate(r.date)+') dibatalkan — data tetap tersimpan di riwayat.'+(orderBackups.length?' '+orderBackups.length+' pesanan dapur ikut dibatalkan.':''));
}

/* ---------- Tautan akun (simulasi OAuth) ---------- */
const providers=[
  {id:'google',name:'Google',desc:'Masuk satu klik dengan akun Google',hue:'#d93025',mark:'G',handle:'raditya@gmail.com',field:'Email',share:'nama, foto profil, dan email'},
  {id:'gmail',name:'Gmail',desc:'Notifikasi laporan dikirim ke inbox',hue:'#c5221f',mark:'✉',handle:'raditya@gmail.com',field:'Alamat email',share:'alamat email dan notifikasi'},
  {id:'facebook',name:'Facebook',desc:'Bagikan promo ke halaman restoran',hue:'#1877f2',mark:'f',handle:'Raka Adinata',field:'Email atau nomor HP',share:'nama publik dan halaman yang dikelola'},
  {id:'tiktok',name:'TikTok',desc:'Publikasi menu & reels harian',hue:'#111827',mark:'♪',handle:'@rasarona',field:'Username',share:'username dan akun kreator'}
];
const providerById=id=>providers.find(p=>p.id===id);

let modalEl=null;
function closeModal(){if(modalEl){modalEl.remove();modalEl=null}}
function openModal(html,opts){
  closeModal();
  modalEl=document.createElement('div');
  modalEl.className='modal-overlay';
  modalEl.innerHTML='<div class="modal'+(opts&&opts.wide?' modal-wide':'')+'">'+html+'</div>';
  document.body.appendChild(modalEl);
  modalEl.addEventListener('click',ev=>{if(ev.target===modalEl)closeModal()});
  if(opts&&opts.wide){startLiveCountdown();tickLiveCountdown()}
}
function modalHead(p){
  return '<div class="modal-head"><span class="provider-mark" style="--pm:'+p.hue+'">'+p.mark+'</span><div><b>Tautkan '+p.name+'</b><small>'+p.desc+'</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>';
}
function openConnect(id){
  const p=providerById(id);if(!p)return;
  const acc=store.accounts[id];
  const value=acc&&acc.handle?acc.handle:p.handle;
  openModal(modalHead(p)+
    '<p class="modal-text">Anda akan masuk memakai <b>'+p.name+'</b>. Data yang dibagikan: '+p.share+'. Kata sandi tidak pernah disimpan.</p>'+
    '<label class="field"><span>'+p.field+'</span><input class="input" id="authInput" value="'+esc(value)+'" autocomplete="off"></label>'+
    '<div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-primary" data-action="do-auth:'+id+'">Lanjutkan dengan '+p.name+'</button></div>'+
    '<small class="modal-note">Prototipe demonstrasi — tidak terhubung ke server OAuth sungguhan.</small>');
  const input=document.getElementById('authInput');if(input){input.focus();input.select()}
}
function doAuth(id){
  const p=providerById(id);if(!p||!modalEl)return;
  const input=document.getElementById('authInput');
  const handle=(input&&input.value.trim())||p.handle;
  modalEl.querySelector('.modal').innerHTML='<div class="center-text"><div class="spinner"></div><b>Menyambungkan ke '+p.name+'…</b><small>Memverifikasi izin dan mengambil profil Anda.</small></div>';
  setTimeout(()=>{
    store.accounts[id]={handle:handle,at:Date.now()};
    saveStore();
    if(modalEl){
      modalEl.querySelector('.modal').innerHTML='<div class="modal-success"><div class="ok">✓</div><div class="center-text"><b>'+p.name+' tersambung</b><small>'+esc(handle)+' kini dapat digunakan untuk masuk dan sinkronisasi data restoran.</small></div><div class="modal-actions" style="justify-content:center"><button class="btn btn-primary" data-action="finish-auth">Selesai</button></div></div>';
    }
    render(currentPage);
    toast(p.name+' berhasil ditautkan.');
  },1200);
}
function askDisconnect(id){
  const p=providerById(id);if(!p)return;
  const acc=store.accounts[id]||{};
  openModal(modalHead(p)+
    '<p class="modal-text">Putuskan <b>'+p.name+'</b> ('+esc(acc.handle||'')+')? Anda tidak akan bisa masuk atau sinkronisasi lewat '+p.name+' sampai ditautkan ulang.</p>'+
    '<div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-danger" data-action="confirm-disconnect:'+id+'">Ya, putuskan</button></div>');
}
function disconnect(id){
  const p=providerById(id);
  if(store.accounts[id]){delete store.accounts[id];saveStore()}
  closeModal();render(currentPage);
  if(p)toast(p.name+' telah diputuskan.');
}

/* ---------- Foto profil ---------- */
function cropSquare(dataUrl,size,cb){
  const img=new Image();
  img.onload=()=>{
    const s=Math.min(img.width,img.height);
    const c=document.createElement('canvas');c.width=c.height=size;
    const ctx=c.getContext('2d');
    ctx.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,size,size);
    try{cb(c.toDataURL('image/jpeg',.85))}catch(e){toast('Gambar gagal diproses.')}
  };
  img.onerror=()=>toast('File gambar tidak dapat dibaca.');
  img.src=dataUrl;
}
function handleAvatarFile(file){
  if(!file)return;
  if(!/^image\//.test(file.type)){toast('Pilih file gambar (JPG atau PNG).');return}
  if(file.size>8*1024*1024){toast('Ukuran gambar maksimal 8 MB.');return}
  const reader=new FileReader();
  reader.onload=e=>cropSquare(e.target.result,320,url=>{
    store.avatar=url;
    if(saveStore()){applyIdentity();toast('Foto profil diperbarui — logo ikut menyesuaikan.')}
  });
  reader.onerror=()=>toast('File gagal dibaca.');
  reader.readAsDataURL(file);
}
function removeAvatar(){
  if(!store.avatar){toast('Belum ada foto profil yang dipasang.');return}
  store.avatar='';
  saveStore();applyIdentity();
  toast('Foto profil dihapus. Logo kembali ke huruf inisial.');
}

/* ---------- Halaman pengaturan ---------- */
function applyTheme(){
  const t=THEMES.some(x=>x.id===store.theme)?store.theme:'espresso';
  const el=(typeof document!=='undefined')&&document.documentElement;
  if(el&&el.setAttribute)el.setAttribute('data-theme',t);
  /* samakan warna chrome browser (bilah atas HP) dengan tema aktif */
  try{
    const meta=document.querySelector('meta[name="theme-color"]');
    const def=THEMES.find(x=>x.id===t);
    if(meta&&def&&def.tc)meta.setAttribute('content',def.tc);
  }catch(e){}
}
function setTheme(id){
  if(!THEMES.some(t=>t.id===id)){toast('Tema tidak ditemukan.');return}
  store.theme=id;
  if(!saveStore()){toast('Gagal menyimpan tema.');return}
  applyTheme();
  render('settings');
  toast('Tampilan "'+THEMES.find(t=>t.id===id).name+'" diterapkan.');
}
function themeCard(t){
  const sel=(store.theme||'espresso')===t.id;
  return '<button class="theme-card'+(sel?' selected':'')+'" data-action="set-theme:'+t.id+'" aria-pressed="'+(sel?'true':'false')+'">'+
    '<span class="theme-sw">'+t.sw.map(c=>'<i style="background:'+c+'"></i>').join('')+'</span>'+
    '<b>'+esc(t.name)+'<span class="theme-ok">✓ Terpilih</span></b><small>'+esc(t.desc)+'</small></button>';
}
function providerCard(p){
  const acc=store.accounts[p.id];
  const right=acc
    ? '<span class="provider-badge">● Aktif</span><button class="btn btn-ghost" data-action="disconnect:'+p.id+'">Putuskan</button>'
    : '<button class="btn btn-primary" data-action="connect:'+p.id+'">Hubungkan</button>';
  return '<div class="provider-card'+(acc?' connected':'')+'"><span class="provider-mark" style="--pm:'+p.hue+'">'+p.mark+'</span><div class="provider-info"><b>'+p.name+'</b><small>'+(acc?'Tersambung · '+esc(acc.handle):p.desc)+'</small></div>'+right+'</div>';
}
function settingsPage(){
  const linked=providers.filter(p=>store.accounts[p.id]).length;
  return `${heading('Pengaturan & akun','Sesuaikan foto profil, nama restoran, dan akun yang ditautkan. Semua perubahan tersimpan otomatis dan tersinkron dengan akun email Anda — termasuk saat tab ditutup.','')}
  <div class="settings-grid">
    <div class="panel">
      <div class="panel-head"><div><div class="panel-title">Foto profil & pemilik</div><div class="panel-caption">Tampil di sidebar dan bilah atas</div></div></div>
      <div class="profile-editor">
        <div class="settings-avatar"></div>
        <div class="profile-actions">
          <label class="btn btn-primary" for="avatarInput"><span class="btn-icon">📷</span> Ganti foto</label>
          <input type="file" id="avatarInput" accept="image/*" hidden>
          <button class="btn" data-action="remove-avatar">Hapus foto</button>
          <small>Format JPG/PNG, maksimal 8 MB, dipotong otomatis jadi persegi. Foto ini juga otomatis dipakai sebagai <b>logo di pojok kiri atas</b>.</small>
        </div>
      </div>
      <label class="field"><span>Nama pemilik</span><input class="input" id="ownerInput" value="${esc(store.ownerName)}" maxlength="40" placeholder="Nama Anda"></label>
      <label class="field"><span>Jabatan</span><input class="input" id="roleInput" value="${esc(store.ownerRole)}" maxlength="24" placeholder="Owner"></label>
      <div class="hint">Logo <b>brand</b>, judul tab browser, dan kalimat sapaan pada halaman Ringkasan otomatis mengikuti <b>nama restoran</b> di panel Identitas restoran.</div>
    </div>

    <div class="panel">
      <div class="panel-head"><div><div class="panel-title">Identitas restoran</div><div class="panel-caption">Nama tampil langsung di sidebar dan judul halaman</div></div></div>
      <label class="field"><span>Nama restoran</span><input class="input" id="restoInput" value="${esc(store.restaurantName)}" maxlength="34" placeholder="Nama restoran Anda"></label>
      <div class="name-preview"><span class="np-mark">⌂</span><span><b id="namePreviewText">${esc(store.restaurantName)}</b><small id="namePreviewLoc">${esc(store.restaurantLocation)}</small></span></div>
      <div class="name-preview" style="margin-top:10px"><span class="np-mark" id="brandPreviewMark">r.</span><span><b id="brandPreviewText">${esc(brandLabel())}</b><small>Logo brand & judul tab</small></span></div>
      <div class="hint">Perubahan tersimpan otomatis saat Anda mengetik. Klik profil di sidebar untuk kembali ke sini kapan saja.</div>
    </div>

    <div class="panel span-2">
      <div class="panel-head"><div><div class="panel-title">Tampilan & warna</div><div class="panel-caption">6 pilihan color grading — bebas diganti kapan saja, tersimpan otomatis</div></div></div>
      <div class="theme-grid">${THEMES.map(themeCard).join('')}</div>
      <div class="hint">Tema mengubah warna sidebar, kanvas, tombol, aksen, kartu, hingga grafik Ringkasan sekaligus. Pilihan tema <b>tetap dipertahankan</b> meski data operasional di-reset.</div>
    </div>

    <div class="panel span-2">
      <div class="panel-head"><div><div class="panel-title">Lokasi cabang & Google Maps</div><div class="panel-caption">Tentukan titik koordinat agar setiap orang bisa membuka lokasi cabang Anda</div></div><button class="link-btn" data-action="open-maps">Buka di Google Maps ↗</button></div>
      <div class="map-grid">
        <div>
          <label class="field"><span>Nama lokasi / cabang</span><input class="input" id="locInput" value="${esc(store.restaurantLocation)}" maxlength="40" placeholder="Kota / area / cabang"></label>
          <div class="field-row">
            <label class="field"><span>Latitude</span><input class="input" id="latInput" inputmode="decimal" value="${esc(store.lat)}" placeholder="-6.244170" autocomplete="off"></label>
            <label class="field"><span>Longitude</span><input class="input" id="lngInput" inputmode="decimal" value="${esc(store.lng)}" placeholder="106.799300" autocomplete="off"></label>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" data-action="use-location">◎ Gunakan lokasi saya</button>
            <button class="btn" data-action="open-maps">Lihat di peta</button>
          </div>
          <div class="field-row paste-row">
            <label class="field"><span>atau tempel tautan Google Maps</span><input class="input" id="mapsPaste" placeholder="https://www.google.com/maps/place/…" autocomplete="off"></label>
            <button class="btn paste-btn" data-action="paste-maps">Ambil koordinat</button>
          </div>
        </div>
        <div class="map-preview">
          <div class="map-pin">⌖</div>
          <b id="mapPreviewName">${esc(store.restaurantName)}</b>
          <small id="mapPreviewAddr">${esc(store.restaurantLocation)}</small>
          <code id="coordPreviewText">${validLatLng()?esc(store.lat)+', '+esc(store.lng):'Koordinat belum diatur'}</code>
          <button class="map-link${validLatLng()?'':' is-disabled'}" id="mapLink" data-action="open-maps">Buka Google Maps ↗</button>
        </div>
      </div>
      <div class="hint">Isi manual <b>Latitude/Longitude</b>, klik <b>Gunakan lokasi saya</b> (izin GPS browser), atau tempel tautan Google Maps — koordinat tersimpan bersama cabang sehingga link peta bisa dibagikan ke siapa saja.</div>
    </div>

    ${statusPanel()}

    ${window.RasaAuth?RasaAuth.accountPanel():''}

    <div class="panel span-2">
      <div class="panel-head"><div><div class="panel-title">Tautan akun & masuk</div><div class="panel-caption">Gunakan akun ini untuk login dan sinkronisasi · ${linked} dari ${providers.length} tersambung</div></div><button class="link-btn" data-action="logout">Keluar dari sesi</button></div>
      <div class="provider-list">${providers.map(providerCard).join('')}</div>
      <div class="hint">Status tautan disimpan pada browser ini (localStorage). Implementasi produksi perlu OAuth 2.0 ke server backend.</div>
    </div>
  </div>`;
}
/* ---------- Tautan langsung (deep link) per halaman ----------
   URL selalu mencerminkan halaman yang dibuka, sehingga membuka
   /#reservations secara langsung melewati pemeriksaan izin yang sama
   dengan klik menu (guard ada di core/roles.js). */
function pageFromHash(){
  try{return String(location.hash||'').replace(/^#/,'').split('?')[0]||'overview'}catch(e){return 'overview'}
}
function syncHash(page){
  try{
    const want=(page&&page!=='overview')?'#'+page:'';
    if((location.hash||'')===want)return;
    history.replaceState(null,'',location.pathname+location.search+want);
  }catch(e){}
}

const renderers={overview:dashboard,orders:ordersPage,kitchen:kitchenPage,pelayan:pelayanPage,reservations:reservationsPage,menu:menuPage,inventory:inventoryPage,recipes:recipesPage,procurement:procurementPage,finance:financePage,reports:reportsPage,settings:settingsPage};
function render(page='overview',keepScroll){
  const y=(typeof window!=='undefined'&&window.scrollY)||0;
  currentPage=page;
  syncHash(page);
  const pc=document.getElementById('pageContent');
  pc.innerHTML=(renderers[page]||dashboard)();
  const banner=statusBanner();
  if(banner)pc.insertAdjacentHTML('afterbegin',banner);
  document.getElementById('crumb').textContent=pageNames[page]||'Ringkasan';
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  closeSidebar();
  applyIdentity();
  if(page==='menu')filterMenuDom();   /* terapkan kata kunci POS yang tersimpan */
  const badge=document.querySelector('.nav-item[data-page="orders"] .nav-count');
  if(badge)badge.textContent=String(orders.filter(o=>o.cls==='preparing').length);
  const pBadge=document.querySelector('.nav-item[data-page="pelayan"] .nav-count');
  if(pBadge)pBadge.textContent=String(orders.filter(o=>o.cls==='ready').length);
  if(keepScroll&&window.scrollTo)window.scrollTo(0,y);else window.scrollTo(0,0);
  animateChart();
}
function closeSidebar(){
  const sb=document.getElementById('sidebar');if(sb)sb.classList.remove('open');
  const bd=document.getElementById('sidebarBackdrop');if(bd)bd.classList.remove('show');
}
function openSidebar(){
  const sb=document.getElementById('sidebar');if(!sb)return;
  const opened=sb.classList.toggle('open');
  const bd=document.getElementById('sidebarBackdrop');
  if(bd)bd.classList.toggle('show',opened);
  if(opened){const first=sb.querySelector('.nav-item:not([hidden])');if(first&&first.focus)first.focus()}
}
/* KDS auto-refresh (Blok G): reservasi jatuh tempo naik kolom & label umur pesanan ikut berdetak */
let kdsTimer=null;
let kdsVisibilityBound=false;
function kdsTick(){
  if(document.hidden)return;
  const before=orders.filter(o=>o.cls==='scheduled').length;
  promoteDueScheduled();
  const after=orders.filter(o=>o.cls==='scheduled').length;
  if(currentPage==='kitchen'){
    if(before!==after){render('kitchen',true);return}
    document.querySelectorAll('.ticket-age[data-id]').forEach(el=>{
      const o=orders.find(x=>String(x.id)===el.getAttribute('data-id'));
      if(!o)return;
      if(o.cls==='scheduled'){
        const cd=countdownOf({date:o.resDate||todayIso(),time:o.resTime||o.time});
        if(!cd)return;
        el.textContent='⏱ '+cd.label;
        el.classList.toggle('warm',cd.level==='soon');
        el.classList.toggle('hot',cd.level==='urgent'||cd.level==='past');
        el.classList.toggle('far',cd.level==='far');
        el.classList.toggle('sched',true);
        return;
      }
      const m=orderAgeMin(o);
      if(m<0)return;
      el.textContent='⏱ '+m+' mnt';
      el.classList.toggle('hot',m>=15);
      el.classList.toggle('warm',m>=8&&m<15);
      el.classList.toggle('far',false);
    });
  }
}
function startKdsTimer(){
  if(kdsTimer)return;
  kdsTimer=setInterval(kdsTick,20000);
  if(!kdsVisibilityBound){
    kdsVisibilityBound=true;
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden)return;
      if(!kdsTimer)kdsTimer=setInterval(kdsTick,20000);
      kdsTick();
    });
  }
}
/* ---------- Guard izin per aksi ----------
   Setiap aksi yang mengubah data dicek dulu di sini (dan tetap divalidasi
   backend pada /api/*), jadi staf yang wewenangnya dicabut tidak hanya
   kehilangan menu — tombol aksinya juga mati. */
const PERM_MODULE_LABEL={overview:'Ringkasan',pos:'POS / Kasir',orders:'Pesanan',kitchen:'Kitchen Display',tables:'Meja',reservations:'Reservasi',menu:'Menu & produk',inventory:'Persediaan',recipes:'Resep / BOM',procurement:'Pengadaan',staff:'Staf',shifts:'Shift',customers:'Pelanggan',finance:'Keuangan',accounting:'Accounting',reports:'Laporan',analytics:'Analytics',alerts:'Alert Center',audit:'Audit log',settings:'Pengaturan',permissions:'Permission'};
const PERM_ACTION_LABEL={read:'membuka',create:'menambah',update:'mengubah',delete:'menghapus',approve:'menyetujui',export:'mengekspor'};
const ACTION_PERM={
  'booking':['reservations','create'],'save-res':['reservations','create'],'res-confirm':['reservations','create'],'res-commit':['reservations','create'],
  'edit-res:':['reservations','update'],'toggle-dp:':['reservations','update'],'cancel-res:':['reservations','update'],'confirm-cancel-res:':['reservations','update'],'del-res:':['reservations','update'],
  'add-menu':['menu','create'],'save-menu:':['menu','update'],'edit-menu:':['menu','update'],'delete-menu:':['menu','delete'],
  'add-variant:':['menu','update'],'pick-variant:':['menu','create'],'remove-menu-image':['menu','update'],
  'start-prep:':['orders','update'],'mark-ready:':['orders','update'],'cancel-order:':['orders','update'],'confirm-cancel-order:':['orders','update'],
  'deliver-start:':['orders','update'],'serve-order:':['orders','update'],'deliver-done:':['orders','update'],'start-prep':['orders','update'],
  'clear-orders':['orders','delete'],'confirm-clear-orders':['orders','delete'],
  'inv-add':['inventory','create'],'inv-edit:':['inventory','update'],'inv-adjust:':['inventory','update'],'save-inv:':['inventory','update'],'save-adjust:':['inventory','update'],'inv-del:':['inventory','delete'],'inv-del-confirm:':['inventory','delete'],
  'recipe-add':['recipes','create'],'recipe-edit:':['recipes','update'],'recipe-save':['recipes','update'],'recipe-remove:':['recipes','delete'],
  'journal-add':['accounting','create'],'journal-save':['accounting','create'],'journal-line-add':['accounting','create'],'export-journal':['accounting','export'],
  'staff-add':['staff','create'],'staff-form-toggle':['staff','create'],'staff-toggle:':['staff','update'],'staff-del:':['staff','delete'],'staff-del-confirm:':['staff','delete'],'staff-perms:':['permissions','update'],
  'reset-data':['settings','delete']
};
function actionAllowed(action){
  const key=String(action||'');
  const rule=ACTION_PERM[key]||ACTION_PERM[key.split(':')[0]+':'];
  if(!rule)return true;
  if(window.canPerm&&window.canPerm(rule[0],rule[1]))return true;
  toast('Anda tidak punya izin untuk '+PERM_ACTION_LABEL[rule[1]]+' '+
    (PERM_MODULE_LABEL[rule[0]]||rule[0])+'. Minta Owner memberikan wewenang tersebut.');
  return false;
}
let toastTimer;function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600)}
document.addEventListener('click',e=>{
  const nav=e.target.closest('[data-page]');
  if(nav){closeModal();render(nav.dataset.page);return}
  const filter=e.target.closest('[data-filter]');
  if(filter){document.querySelectorAll('.filter-chip').forEach(x=>x.classList.remove('selected'));filter.classList.add('selected');let subset=filter.dataset.filter==='Semua'?orders:orders.filter(o=>o.status===filter.dataset.filter);const tbody=document.querySelector('.orders-panel tbody');if(tbody)tbody.innerHTML=tableRows(subset);return}
  const mcat=e.target.closest('[data-menucat]');
  if(mcat){activeMenuCat=mcat.getAttribute('data-menucat')||'Semua';render('menu',true);return}
  const el=e.target.closest('[data-action]');
  if(!el)return;
  const action=el.dataset.action;
  if(!actionAllowed(action))return;   /* izin dicek sebelum aksi dijalankan */
  const arg=action.includes(':')?action.split(':')[1]:'';
  if(action==='close-modal'||action==='finish-auth'){closeModal();return}
  if(action==='remove-avatar'){removeAvatar();return}
  if(action==='booking'){openResForm();return}
  if(action==='save-res'||action==='res-confirm'){openResConfirm();return}
  if(action==='res-back'){resBackToForm();return}
  if(action==='res-commit'){commitRes();return}
  if(action.startsWith('edit-res:')){openResForm(arg);return}
  if(action.startsWith('cancel-res:')){askCancelRes(arg);return}
  if(action.startsWith('confirm-cancel-res:')){cancelRes(arg);return}
  if(action.startsWith('del-res:')){askCancelRes(arg);return}
  if(action.startsWith('res-menu-inc:')){resMenuInc(arg);return}
  if(action.startsWith('res-menu-dec:')){resMenuDec(arg);return}
  if(action.startsWith('res-pick-table:')){resPickTable(arg);return}
  if(action.startsWith('toggle-dp:')){toggleDp(arg);return}
  if(action==='refresh-dash'){refreshDashboard();return}
  if(action==='reset-data'){askResetData();return}
  if(action==='reset-step1'){askResetConfirm();return}
  if(action==='confirm-reset'){resetAllData();return}
  if(action.startsWith('set-theme:')){setTheme(arg);return}
  if(action.startsWith('cart-add:')){const parts=String(arg).split('|');addToCart(parts[0],parts[1]||'',1);return}
  if(action.startsWith('cart-sub:')){subFromCart(arg);return}
  if(action.startsWith('pick-variant:')){openVariantPicker(arg);return}
  if(action.startsWith('add-variant:')){confirmVariant(arg);return}
  if(action==='add-menu'){openMenuForm('new');return}
  if(action.startsWith('edit-menu:')){openMenuForm(arg);return}
  if(action.startsWith('save-menu:')){saveMenu(arg);return}
  if(action.startsWith('delete-menu:')){deleteMenu(arg);return}
  if(action==='remove-menu-image'){clearMenuImage();return}
  if(action==='clear-orders'){askClearOrders();return}
  if(action==='confirm-clear-orders'){clearOrders();return}
  if(action.startsWith('remove-line:')){removeLine(arg);return}
  if(action==='clear-cart'){clearCart();return}
  if(action.startsWith('cancel-order:')){askCancelOrder(arg);return}
  if(action.startsWith('confirm-cancel-order:')){cancelOrder(arg);return}
  if(action.startsWith('start-prep:')){advanceOrder(arg,'preparing','Diproses');return}
  if(action.startsWith('mark-ready:')){advanceOrder(arg,'ready','Siap');return}
  if(action.startsWith('deliver-start:')){
    if(!window.canPerm('orders','update')){toast('Role Anda tidak punya izin mengubah pesanan.');return}
    advanceOrder(arg,'delivering','Diantar');return}
  if(action.startsWith('serve-order:')){
    /* alur disederhanakan: Acc & antar → langsung Tersaji (tanpa tahap "sedang diantar") */
    if(!window.canPerm('orders','update')){toast('Role Anda tidak punya izin mengubah pesanan.');return}
    advanceOrder(arg,'served','Tersaji');return}
  if(action.startsWith('deliver-done:')){
    if(!window.canPerm('orders','update')){toast('Role Anda tidak punya izin mengubah pesanan.');return}
    advanceOrder(arg,'served','Tersaji');return}
  if(action==='refresh-pelayan'){render('pelayan');toast('Daftar antar ke meja disegarkan.');return}
  if(action==='refresh-kitchen'){render('kitchen');toast('Antrean dapur disegarkan.');return}
  if(action==='menu-search-clear'){clearMenuSearch();return}
  if(action==='open-sidebar'){openSidebar();return}
  if(action==='checkout'){openCheckout();return}
  if(action==='pay-now'){payNow();return}
  if(action==='finish-pay'){finishPay();return}
  if(action==='open-maps'){openMaps();return}
  if(action==='toggle-open'){toggleOpenStatus();return}
  if(action==='copy-status'){copyStatusLink();return}
  if(action==='share-status'){shareStatusLink();return}
  if(action==='use-location'){useMyLocation();return}
  if(action==='paste-maps'){pasteMapsLink();return}
  if(action.startsWith('connect:')){openConnect(arg);return}
  if(action.startsWith('do-auth:')){doAuth(arg);return}
  if(action.startsWith('disconnect:')){askDisconnect(arg);return}
  if(action.startsWith('confirm-disconnect:')){disconnect(arg);return}
  if(action==='logout'){
    openModal('<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">⇥</span><div><b>Keluar dari sesi?</b><small>Rasa · '+(store.restaurantName||'Restoran')+'</small></div><button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div><p class="modal-text">'+((window.RasaSession&&window.RasaSession.token)?'Sesi akun Anda berakhir di perangkat ini. Data restoran tetap tersimpan di server dan di perangkat.':'Foto profil, nama restoran, dan tautan akun tetap tersimpan di perangkat ini. Anda hanya keluar dari sesi demo ini.')+'</p><div class="modal-actions"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-danger" data-action="confirm-logout">Keluar</button></div>');
    return}
  if(action==='confirm-logout'){
    closeModal();
    if(window.RasaSession&&window.RasaSession.token){window.RasaAuth.logout()}
    else{toast('Anda telah keluar dari sesi demo.')}
    return}
  if(action==='account-login'){window.RasaAuth.showGate();return}
  if(action==='inv-add'){openInvForm('new');return}
  if(action.startsWith('inv-edit:')){openInvForm(arg);return}
  if(action.startsWith('inv-adjust:')){openInvAdjust(arg);return}
  if(action.startsWith('inv-del:')){askDeleteInv(arg);return}
  if(action.startsWith('inv-del-confirm:')){deleteInv(arg);return}
  if(action.startsWith('save-inv:')){saveInv(arg);return}
  if(action.startsWith('save-adjust:')){saveAdjust(arg);return}
  if(action.startsWith('recipe-edit:')){openRecipe(arg);return}
  if(action==='recipe-add'){recipeAdd();return}
  if(action.startsWith('recipe-remove:')){recipeRemove(arg);return}
  if(action==='recipe-save'){saveRecipe();return}
  if(action==='journal-add'){openJournalEntry();return}
  if(action==='journal-line-add'){journalLineAdd();return}
  if(action.startsWith('journal-line-remove:')){journalLineRemove(arg);return}
  if(action==='journal-save'){saveJournal();return}
  if(action==='export-journal'){exportJournal();return}
  if(action==='account-logout'){window.RasaAuth.logout();return}
  /* ekstensi: modul baru mendaftarkan handler lewat window.RASA.actions.
     Kunci boleh memakai nama penuh ("staff-perms:usr_123") atau nama dasar
     ("staff-perms") — handler dipanggil dengan argumen setelah tanda titik dua. */
  const R=window.RASA;
  const extHandler=(R&&R.actions&&(R.actions[action]||R.actions[action.split(':')[0]]))||null;
  if(extHandler){extHandler(arg,el);return}
  const messages={'date':'Rentang tanggal: '+DATE_LABEL.toLowerCase(),'stock':'Form penyesuaian stok siap dibuka.','po':'Form purchase order siap dibuka.','export':'Laporan berhasil disiapkan untuk ekspor.','audit':'Audit log terbaru telah dimuat.'};
  toast(messages[action]||'Berhasil.');
});

/* Perubahan pengaturan disimpan otomatis saat diketik */
document.addEventListener('input',e=>{
  const id=e.target.id;
  if(id==='restoInput'){store.restaurantName=e.target.value}
  else if(id==='locInput'){store.restaurantLocation=e.target.value}
  else if(id==='ownerInput'){store.ownerName=e.target.value}
  else if(id==='roleInput'){store.ownerRole=e.target.value}
  else if(id==='latInput'||id==='lngInput'){
    store[id==='latInput'?'lat':'lng']=e.target.value.trim();
    saveStore();
    const coord=document.getElementById('coordPreviewText');if(coord)coord.textContent=validLatLng()?(String(store.lat)+', '+String(store.lng)):'Koordinat belum diatur';
    const link=document.getElementById('mapLink');if(link)link.classList.toggle('is-disabled',!validLatLng());
    return;
  }
  else if(id==='pvQty'||e.target.name==='pvV'){pvPickChanged(e.target);return}
  else if(id==='menuSearch'){menuQuery=e.target.value;filterMenuDom();return}
  else if(id==='resName'||id==='resDate'||id==='resTime'||id==='resGuests'||id==='resDeposit'){
    if(!resDraft)return;
    if(id==='resName')resDraft.name=e.target.value;
    else if(id==='resDate'){resDraft.date=e.target.value;resFormRefresh()}
    else if(id==='resTime'){resDraft.time=e.target.value;resFormRefresh()}
    else if(id==='resGuests'){const g=parseInt(e.target.value,10);if(g>=1)resDraft.guests=Math.min(60,g);resFormRefresh()}
    else if(id==='resDeposit'){resDraft.deposit=Math.max(0,parseRp(e.target.value));resSumRefresh()}
    return;
  }
  else return;
  applyIdentity();saveStore();
});

/* Pencarian cepat POS (Blok G) — filter DOM saja supaya fokus keyboard tetap di kolom */
function filterMenuDom(){
  const q=menuQuery.trim().toLowerCase();
  const grid=document.querySelector('.menu-grid');
  if(!grid)return;
  const cards=grid.querySelectorAll('.product-card');
  let shown=0;
  cards.forEach(c=>{
    const hay=c.getAttribute('data-search')||'';
    const ok=!q||hay.indexOf(q)>=0;
    c.hidden=!ok;
    if(ok)shown++;
  });
  let none=grid.querySelector('.no-match');
  /* hanya tampilkan "tidak ada cocok" bila memang ada kartu yang bisa difilter —
     kalau kategorinya kosong, empty-state kategori sudah menjelaskan */
  if(q&&!shown&&cards.length){
    if(!none){
      none=document.createElement('div');
      none.className='empty-state no-match';
      grid.appendChild(none);
    }
    none.innerHTML='Tidak ada menu yang cocok dengan <b>'+esc(menuQuery)+'</b>. Hapus pencarian atau pilih kategori lain.';
    none.hidden=false;
  }else if(none){none.hidden=true}
  const cnt=document.getElementById('menuCount');
  if(cnt)cnt.textContent=String(shown);
  const x=document.querySelector('.menu-search-x');
  if(x)x.hidden=!q;
}
function clearMenuSearch(){
  if(!menuQuery){toast('Pencarian sudah kosong.');return}
  menuQuery='';
  render('menu',true);
  const el=document.getElementById('menuSearch');
  if(el)el.focus();
}
document.addEventListener('change',e=>{
  if(e.target.id==='avatarInput'){handleAvatarFile(e.target.files&&e.target.files[0]);e.target.value=''}
  else if(e.target.id==='mfImage'){handleMenuImage(e.target.files&&e.target.files[0]);e.target.value=''}
  else if(e.target.id==='pvQty'||e.target.name==='pvV'){pvPickChanged(e.target)}
  else if(e.target.id==='resDur'){
    const m=parseInt(e.target.value,10);
    if(resDraft&&m>=15){resDraft.durMin=m;resFormRefresh()}
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();closeSidebar()}});
document.getElementById('menuToggle').addEventListener('click',openSidebar);
const sidebarBackdrop=document.getElementById('sidebarBackdrop');
if(sidebarBackdrop)sidebarBackdrop.addEventListener('click',closeSidebar);
/* Gabungkan halaman/nav/aksi yang didaftarkan modul lewat window.RASA */
(function mergeRasaRegistry(){
  const R=window.RASA;
  if(!R)return;
  Object.assign(renderers,R.pages||{});
  Object.assign(pageNames,R.pageNames||{});
})();
render(pageFromHash());   /* dukung buka langsung lewat tautan, izin dicek roles.js */
window.RASA.appReady=true;
startKdsTimer();
startLiveCountdown();
tickLiveCountdown();
if(window.RasaAuth)window.RasaAuth.start();
