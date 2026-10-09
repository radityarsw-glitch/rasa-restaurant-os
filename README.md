# Rasa — Restaurant OS

Prototipe antarmuka web untuk blueprint Enterprise Restaurant Management System.

## Menjalankan

- **Lokal:** buka `Buka RASA.bat` (menjalankan server di `http://127.0.0.1:8787`), atau buka `index.html` langsung di browser.
- **Online (Cloudflare Workers):** https://rasa-restaurant-os.rasa-os.workers.dev
- **Online (GitHub Pages):** https://radityarsw-glitch.github.io/rasa-restaurant-os/ — frontend yang sama, backend tetap Worker di atas.

## Mulai dari nol

Saat pertama kali dibuka, **semua data masih kosong** (penjualan Rp 0, pesanan, menu, reservasi, nama restoran, lokasi, dan profil). Panel **"Restoran Anda masih baru"** di Ringkasan menuntun langkah pertama.

Setiap data yang Anda isi **tersimpan otomatis** — dulu hanya di `localStorage` perangkat, sekarang **mengikuti email yang login**: masuk dengan email A di perangkat mana pun, data restoran yang sama muncul kembali; email lain tidak pernah melihat data Anda (workspace terpisah per restoran/email). Tombol **Reset Data** di Ringkasan mengembalikan semuanya ke kondisi kosong (tema warna tetap dipertahankan).

## Sinkronisasi mengikuti email

- **Masuk dengan email** (kode OTP 5 menit) → setiap perubahan disimpan ke server di bawah `restaurant_id` milik email tersebut, lalu di-snapshot lokal dengan kunci `restaurant-os:snapshot:<restaurantId>`.
- **Perangkat baru / ganti perangkat:** snapshot diambil dari server lebih dulu, jadi data lama tidak menimpa data akun. Perangkat yang terakhir dipakai akun lain otomatis di-reset dulu supaya tidak ada bocor data antar akun.
- **Akun baru pertama kali di sebuah perangkat** (belum ada data di server): data lokal yang ada didorong ke server sebagai migrasi awal.
- **Mode lokal (tanpa login):** data hanya tersimpan di perangkat tersebut dan tidak tersambung ke akun mana pun.

## Tampilan, font, dan notifikasi

- **Font:** display **Fraunces** (judul, angka penting) + teks **Plus Jakarta Sans** via Google Fonts.
- **Color grading (6 pilihan):** Ambar Emas, Hutan Zamrud, Samudra Biru, Anggur Mawar, **Koral Laut** (nuansa restoran seafood, merah bata/coral), dan **Midnight Neon** (gelap). Dipilih lewat **Pengaturan → Color grading**, tersimpan otomatis.
- **Kontras aman di semua tema:** gradien puncak panel/kartu memakai variabel `--surface-hi` (di tema gelap menjadi gelap, bukan tetap putih), jadi judul dan angka terang tidak pernah jadi putih di atas putih. Elemen grafik tren penjualan (angka total, garis kisi, label hari, legenda, titik hari ini), tombol status, serta kartu uang/panel ikut disesuaikan per tema. Setiap color grading diuji otomatis: teks utama, caption, label tombol, badge status, dan sisi sidebar semuanya memenuhi rasio kontras **≥ 4.5 : 1 (WCAG AA)**.
- **Tombol Reset Data** (Ringkasan) ditetapkan ulang di blok CSS terakhir sehingga selalu tampil jelas: latar merah gelap + tulisan putih di setiap color grading.
- **Notifikasi:** kartu notifikasi melayang di **pojok kanan atas** (maksimal 4, hilang otomatis ~8 detik) dan daftarnya bisa dibuka lewat tombol **🔔 lonceng** di bilah atas — **klik notifikasi untuk langsung menuju halaman tujuannya** (misal reservasi yang mendekat, stok menipis, pesanan baru).
- **Menu produk:** foto produk atau **inisial nama** agar daftar menu lebih rapi dan konsisten.
- **Reservasi v2:** form reservasi kini memuat **pilihan nomor meja** (kartu hijau = tersedia, merah = sudah dipesan/kapasitas kurang, non-klik), **pilihan menu** (kartu foto + stepper [+]/[−]), **rincian biaya** (subtotal, service charge, uang muka/DP, total estimasi), lalu **modal konfirmasi** sebelum tersimpan. Setiap jadwal menampilkan **hitung mundur live** “Dimulai dalam 02 Jam 15 Menit 30 Detik” yang berdetak tiap detik tanpa refresh — bila jadwal sudah lewat, tulisan berubah menjadi **merah** “Telah melewati tenggat waktu”.
- **Status nyata di kartu jadwal:** begitu jadwal punya pesanan yang terhubung (`order.resId`), kartu di *Jadwal reservasi* menampilkan **status penyajian sebenarnya dari dapur/pelayan** — *Pesanan sudah masuk ke dapur* → *sedang disiapkan di dapur* → *siap disajikan* → *sedang diantar ke meja* → *sudah disajikan* — lengkap dengan nomor pesanannya, **menggantikan hitung mundur / “Telah melewati tenggat waktu”**. Hitung mundur tetap dipakai untuk jadwal yang belum punya pesanan. Panel form reservasi dan daftar “berikutnya” memakai logika yang sama, jadi jadwal terlihat sesuai kenyataan.
- **Foto menu utuh:** foto yang diunggah ditampilkan dengan `object-fit: contain` (diberi jarak di dalam bingkai), bukan dipotong — di kartu produk *Menu & produk*, kartu foto pilihan menu pada form reservasi, dan thumbnail daftar, dengan ukuran kotak yang lebih besar (46 px / 96 px, 100 px di HP) supaya gambar terbaca seluruhnya.
- **Deteksi bentrok & kapasitas meja:** sistem memeriksa reservasi tersimpan — meja yang rentang waktunya bertabrakan ditandai **Sudah Dipesan** (merah, tidak bisa diklik), dan meja berkapasitas kecil otomatis dinonaktifkan bila jumlah tamu melebihi kapasitasnya. Status meja dihitung **langsung dari data reservasi**, bukan warna manual.
- **Riwayat, bukan penghapusan:** reservasi yang diubah dicatat riwayatnya; yang dibatalkan berubah status menjadi **Dibatalkan** dan tetap tampil di panel *Riwayat reservasi* — owner tetap bisa melihat historinya.

## Status Buka / Tutup

- Tombol status di bilah atas (`● Nama Restoran · BUKA/TUTUP`) bisa diklik untuk berpindah status, tersimpan otomatis.
- Panel **Pengaturan → Status restoran** menampilkan pratinjau, tombol ganti status, link status untuk pelanggan, dan tombol **Buka di Google Maps**.
- Karena website ini statis, status dikirim ke pelanggan lewat parameter link:

```
https://rasa-restaurant-os.rasa-os.workers.dev/?status=buka
https://rasa-restaurant-os.rasa-os.workers.dev/?status=tutup
```

Pelanggan yang membuka link langsung melihat banner **BUKA** atau **TUTUP** beserta lokasi restoran di Google Maps. Tempelkan link status pada kolom website/deskripsi Google Business Profile Anda.

## Tren penjualan

Grafik Ringkasan dihitung dari data pesanan **per jam (08.00–20.00)**, lengkap dengan garis rata-rata per jam, label sumbu-Y yang mengikuti nilai tertinggi, dan indikator tren (naik/turun). Grafik digambar ulang dengan animasi setiap kali data berubah.

## Tampilan HP (portrait)

Sidebar menjadi latar belakang yang bisa ditutup dengan sekali ketuk, foto profil di bilah atas tetap tampil dan bisa ditekan, serta seluruh tombol dibuat berukuran minimal ±38–44 px agar nyaman ditekan tanpa memutar layar. Grid pemilihan meja (3–2 kolom), kartu menu, stepper [−/+] reservasi, ringkasan biaya, dan modal konfirmasi semuanya menyesuaikan layar HP/tablet dengan target sentuh yang cukup besar.

## Ruang kerja (sidebar)

Sidebar dikelompokkan per peran, bukan lagi daftar panjang satu tumpukan:

| Kelompok | Isi |
| --- | --- |
| **WORKSPACE** | Ringkasan · Dapur / KDS |
| **KASIR** | Pesanan · Reservasi · Menu & produk (transaksi harian dalam satu tempat) |
| **PELAYAN** | Workspace **Pelayan** (acc & antar pesanan) |
| **OPERASIONAL** | Persediaan, Resep/BOM, Pengadaan, Keuangan, Laporan, Alert, Audit log, Pengaturan |

Kelompok yang tidak berhak diakses peran login akan disembunyikan otomatis; workspace Pelayan memakai modul izin **Pesanan** (`orders`).

## Izin & wewenang (permission)

Izin ditentukan dua lapis dan **dicek di setiap akses** (bukan hanya saat membuka halaman):

1. **Matriks role** — 20 modul × aksi (baca/tambah/ubah/hapus/setujui/ekspor) per peran (Owner, Manager, Kasir, Kitchen, Waiter). Diubah lewat **Pengaturan → Permission**.
2. **Wewenang khusus per staf** — tombol **Wewenang** pada tabel staf mengizinkan Owner mencabut/menambah satu modul untuk satu staf tertentu tanpa mengubah matriks role-nya. Disimpan di tabel `user_perms` dan menimpa matriks role (Owner selalu penuh).

Yang terjadi begitu Owner menyimpan perubahan — **tanpa staf perlu login ulang**:

- **Menu navigasi** modul yang dicabut langsung disembunyikan (termasuk label grupnya bila kosong).
- **Tautan langsung** (`/#reservations`, `/#inventory`, …) tidak bisa dipakai menyiasati: halaman diganti layar **“Anda tidak punya izin”** yang menjelaskan modul, peran, dan jumlah wewenang aktif, plus tombol kembali ke Ringkasan. Tautan yang tidak dikenal menampilkan layar 404 terpisah.
- **Data ikut dibersihkan:** baris data modul tanpa izin dikeluarkan dari respons `GET /api/data` (dan dilaporkan sebagai `stripped`), salinan lokal di perangkat staf dibuang, serta kunci tersebut tidak pernah ikut disinkronkan.
- **Tulis ditolak server:** `PUT /api/data` untuk modul tanpa izin `update` dikembalikan sebagai `denied` — klien hanya mengirim key yang memang boleh ditulis, jadi tidak ada toast penolakan yang tidak perlu.
- **API lain ikut dikunci:** `GET /api/permissions`, `GET/POST/PUT/DELETE /api/staff` menolak staf tanpa izin (403), dan `GET /api/data` mengembalikan 403 bila staf kehilangan seluruh modul.
- **Dipantau terus:** klien membaca ulang izin dari `/api/auth/me` setiap 20 detik, saat jendela kembali aktif/fokus, dan saat menerima 403 — begitu izin berubah, menu, layar izin, dan data lokal menyesuaikan sendiri; perubahan juga muncul sebagai notifikasi “Owner mencabut wewenang …”.

Izin yang sama tetap ditegakkan di backend (`server/permissions.js` + pemeriksaan di tiap endpoint), jadi menyembunyikan menu di sisi klien bukan satu-satunya pengaman.

## Alur penyajian: dapur → pelayan → meja

Status pesanan kini berjalan: **Dibayar → Diproses → Siap → Tersaji** (tahap "sedang diantar" dihapus dari workspace Pelayan agar alur kerja lebih sederhana — data pesanan lama ber-status Diantar tetap aman dan bisa langsung ditandai Tersaji).

1. Dapur menandai pesanan **Siap** di *Dapur / KDS* — pesanan langsung muncul di workspace **Pelayan**.
2. Pelayan menekan **Acc & antar ✓** (perlu izin ubah pesanan) — satu langkah, pesanan langsung berstatus **Tersaji**.

Halaman Pelayan menampilkan dua kolom sederhana: *Siap diantar* dan *Selesai · tersaji*, plus statistik, status meja terisi (dihitung dari reservasi aktif), dan daftar reservasi berikutnya. Badge di sidebar menunjukkan jumlah yang menunggu Acc; Alert Center punya pintasan langsung ke workspace ini.

## Modul yang tersedia

- Ringkasan penjualan, channel, pesanan, stok, dan jurnal (semuanya mengikuti data)
- Daftar pesanan (termasuk filter Diantar/Tersaji) dan Kitchen Display System
- Workspace Pelayan (acc & antar pesanan)
- Reservasi meja: pilihan meja & menu, deteksi bentrok jadwal, kapasitas tamu, hitung mundur live, **status penyajian pesanan terhubung di kartu jadwal**, konfirmasi, dan riwayat pembatalan
- Katalog menu
- Persediaan dan pengadaan bahan baku
- Keuangan, Chart of Accounts, jurnal double-entry, audit trail, dan laporan

## Deploy ke Cloudflare

```bat
:: sekali saja bila skema database berubah (menambah tabel user_perms)
npx.cmd wrangler d1 execute rasa-restaurant-os-db --remote --file=server\schema.sql

npx.cmd wrangler deploy
```

Konfigurasi ada di `wrangler.jsonc`; file `.bat`, `README.md`, `*.ps1`, dan `wrangler.jsonc` tidak ikut ter-upload (lihat `.assetsignore`).

> Catatan: gunakan `npx.cmd` (bukan `npx`) bila dijalankan lewat PowerShell dengan execution policy default.

## Deploy ke GitHub Pages (github.io)

Frontend juga bisa dipublikasikan lewat GitHub Pages tanpa menyentuh backend. Yang di-push ke GitHub cukup isi folder ini, lalu GitHub Actions (`.github/workflows/pages.yml`) mem-build dan men-deploy **hanya** `index.html`, `app.js`, `style.css`, dan `core/*` ke https://radityarsw-glitch.github.io/rasa-restaurant-os/ (repo: https://github.com/radityarsw-glitch/rasa-restaurant-os).

- **Backend tetap di Cloudflare.** Login OTP, sinkronisasi per email, permission, dan D1 tetap dilayani Worker `https://rasa-restaurant-os.rasa-os.workers.dev` — Worker sudah mengirim `access-control-allow-origin: *` plus preflight `OPTIONS`, jadi pemanggilan lintas-origin dari github.io diterima.
- **Penunjuk API otomatis.** `core/api.js` menghitung `window.RasaAPIBase`: di `localhost` / `*.workers.dev` / `*.pages.dev` / `file://` tetap same-origin (relatif), di domain lain (termasuk `*.github.io`) diarahkan ke Worker. Untuk menimpa, tetapkan `window.RASA_API_BASE = 'https://…'` **sebelum** `core/api.js` dimuat.
- **Repo harus publik** (GitHub Pages gratis hanya untuk repo publik), dan **Settings → Pages → Source: GitHub Actions** harus dipilih sekali.

```bat
:: sekali saja di mesin ini
git remote add origin https://github.com/radityarsw-glitch/rasa-restaurant-os.git   :: sudah dilakukan

:: setelah tiap perubahan
git add .
git commit -m "perubahan"
git push -u origin main                 :: GitHub Actions otomatis build & deploy
```

### Pengujian otomatis

Dua skrip pengujian dijalankan terhadap `wrangler dev --port 8790 --local` (D1 lokal):

- `.uji-permisi.ps1` — 11 skenario API permission: cabut/kanthi wewenang, data di-strip, tulis & API permission ditolak, matriks role berlaku langsung.
- `.uji-frontend.ps1` — pemeriksaan DOM via headless Chrome: badge status jadwal, foto `object-fit: contain`, tautan langsung yang ditolak, menu disembunyikan, dan pencabutan saat halaman terbuka (poll izin 20 detik).

## Batasan

Login memakai email + kode OTP, dan data tersimpan di D1 (Cloudflare) mengikuti restoran milik email tersebut — bukan sekadar `localStorage`. Integrasi PostgreSQL/Redis, payment gateway, push notification, dan PWA offline belum dikonfigurasi. Penautan sosial (Google/Apple) masih berupa panel tautan, bukan OAuth 2.0 penuh.
