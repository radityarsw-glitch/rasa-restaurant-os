/* ============================================================
   RASA Restaurant OS — Struk Pelanggan (Customer Receipt)

   Satu sumber kebenaran untuk struk: SEMUA data diambil dari
   transaksi yang tersimpan (store.orders / archive) dan profil
   restoran di Pengaturan — tidak ada data contoh / statis.

   Isi struk:
     1. Identitas restoran (logo, nama, alamat, telp, email, web, sosmed)
     2. Informasi transaksi (no. struk, tanggal, kasir, pelanggan,
        no. pesanan, meja, jenis pesanan, no. reservasi)
     3. Rincian pesanan (produk, varian, qty, harga satuan, subtotal, catatan)
     4. Ringkasan pembayaran (subtotal, diskon, pajak, service charge,
        biaya tambahan, TOTAL PEMBAYARAN)
     5. Informasi pembayaran (metode, status, uang dibayarkan, kembalian,
        nomor referensi)
     6. Informasi tambahan (QR verifikasi, ucapan terima kasih, kontak,
        media sosial, keterangan bukti pembayaran)

   Fungsi: pratinjau, cetak thermal 58 mm & 80 mm, unduh PDF,
   bagikan via WhatsApp / email, dan buka lagi dari riwayat pesanan.
   Tautan QR menuju /#struk=<id> yang membuka detail transaksi asli.
   ============================================================ */

window.RasaReceipt = (function () {
  'use strict';

  /* ============================================================
     0. Util kecil (mandiri — tidak bergantung pada app.js)
     ============================================================ */
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const pad2 = n => (n < 10 ? '0' : '') + n;

  function hx(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* Rupiah — memakai pembentuk uang aplikasi bila tersedia, supaya
     format struk identik dengan POS/laporan (Rp + pemisah ribuan). */
  function rp(v) {
    const n = Number(v) || 0;
    try { if (typeof money === 'function') return money(n); } catch (e) {}
    return 'Rp ' + n.toLocaleString('id-ID');
  }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v) : 0;
    try { if (typeof parseRp === 'function') return parseRp(v); } catch (e) {}
    return parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10) || 0;
  }

  function fmtDateMs(ms) {
    const d = new Date(Number(ms) || 0);
    if (!ms || isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear();
  }
  function fmtTimeMs(ms) {
    const d = new Date(Number(ms) || 0);
    if (!ms || isNaN(d.getTime())) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fmtDateTime(ms, fallback) {
    const date = fmtDateMs(ms);
    if (!date) return fallback ? String(fallback) : '—';
    return date + ', ' + fmtTimeMs(ms);
  }

  /* ============================================================
     1. Model struk — dibangun dari transaksi tersimpan
     ============================================================ */
  function storeObj() {
    try { return (typeof store !== 'undefined' && store) ? store : {}; } catch (e) { return {}; }
  }
  function findOrder(id) {
    const key = String(id == null ? '' : id);
    let list = [];
    try { list = (typeof historyOrders === 'function') ? historyOrders() : []; } catch (e) { list = []; }
    if (!list.length) {
      try { list = (typeof orders !== 'undefined' && orders) ? orders : []; } catch (e) { list = []; }
    }
    return list.find(o => String(o.id) === key) || null;
  }

  function tableOf(o) {
    if (o.table != null && String(o.table).trim() !== '') return String(o.table).trim();
    const m = /Meja\s*([0-9]+)/i.exec(String(o.type || ''));
    return m ? m[1] : '';
  }

  function typeOf(o) {
    if (o.orderType) return String(o.orderType);
    const t = String(o.type || '');
    if (/bawa|take.?away|delivery|antar/i.test(t)) return 'Bawa Pulang';
    if (/reserv/i.test(t)) return 'Makan di Tempat';
    return 'Makan di Tempat';
  }

  function payStatusOf(o) {
    if (o.payStatus) return String(o.payStatus);
    if (o.cls === 'cancelled') return 'Dibatalkan';
    if (o.cls === 'scheduled') return 'Belum Dibayar';
    return 'Lunas';
  }

  function itemsOf(o) {
    const det = Array.isArray(o.detail) ? o.detail : [];
    if (!det.length) {
      /* pesanan lama tanpa rincian tersimpan — total tetap ditampilkan apa adanya */
      const total = num(o.total);
      return {
        legacy: true,
        list: [{ name: String(o.items || 'Pesanan'), variant: '', qty: 1, price: total, sub: total, note: '' }]
      };
    }
    return {
      legacy: false,
      list: det.map(d => {
        d = d || {};
        let name = String(d.name || d.product || '');
        const variant = String(d.variant || '');
        if (variant && name.slice(-(variant.length + 3)) === ' · ' + variant) name = name.slice(0, -(variant.length + 3));
        const qty = Number(d.qty) || 0;
        const price = Number(d.price) || 0;
        return { name: name || 'Item', variant: variant, qty: qty, price: price, sub: qty * price, note: String(d.note || '') };
      })
    };
  }

  function verifyUrl(id) {
    let base = '';
    try { base = String(location.href || '').split('#')[0]; } catch (e) { base = ''; }
    return base + '#struk=' + encodeURIComponent(String(id));
  }

  function model(order) {
    if (!order) return null;
    const s = storeObj();
    const items = itemsOf(order);
    const list = items.list;
    const subtotal = list.reduce((n, i) => n + i.sub, 0);
    const total = num(order.total);
    let discount = num(order.discount);
    if (!order.discount && subtotal > total) discount = subtotal - total;   /* selisih = potongan tersimpan */
    const tax = num(order.tax);
    const service = num(order.service);
    const fee = num(order.fee);
    const paid = order.paid != null && order.paid !== '' ? num(order.paid) : total;
    const change = order.change != null && order.change !== '' ? num(order.change) : Math.max(0, paid - total);
    const rows = [{ k: 'Subtotal', v: subtotal }];
    if (discount > 0) rows.push({ k: 'Diskon / potongan', v: -discount });
    if (tax > 0) rows.push({ k: 'Pajak', v: tax });
    if (service > 0) rows.push({ k: 'Service charge', v: service });
    if (fee > 0) rows.push({ k: 'Biaya tambahan', v: fee });
    const hitung = subtotal - discount + tax + service + fee;
    if (hitung !== total) rows.push({ k: 'Penyesuaian', v: total - hitung });  /* selalu cocok dgn total tersimpan */

    const logo = String(s.avatar || '');
    const restoName = String(s.restaurantName || s.brandName || '').trim() || 'Restoran';
    let nameFn = null;
    try { if (typeof brandLabel === 'function') nameFn = brandLabel; } catch (e) {}
    let namaResto = restoName;
    try { if (nameFn) namaResto = String(nameFn() || restoName); } catch (e) {}

    return {
      id: String(order.id || ''),
      receiptNo: String(order.id || ''),
      orderNo: String(order.id || ''),
      at: Number(order.at) || 0,
      dateText: fmtDateTime(order.at, order.time),
      timeText: fmtTimeMs(order.at) || String(order.time || ''),
      cashier: String(order.cashier || s.ownerName || '').trim() || '—',
      customer: String(order.guest || '').trim() || 'Tamu',
      table: tableOf(order),
      orderType: typeOf(order),
      channel: String(order.type || order.method || '').trim(),
      reservationNo: order.resId ? String(order.resId) : '',
      status: String(order.status || ''),
      cls: String(order.cls || ''),

      restaurant: {
        name: namaResto,
        logo: logo,
        address: String(s.restoAddress || s.restaurantLocation || '').trim(),
        phone: String(s.restoPhone || '').trim(),
        email: String(s.restoEmail || '').trim(),
        website: String(s.restoWebsite || '').trim(),
        social: String(s.restoSocial || '').trim()
      },

      items: list,
      itemsLegacy: items.legacy,
      summary: { rows: rows, subtotal: subtotal, discount: discount, tax: tax, service: service, fee: fee, total: total },

      payment: {
        method: String(order.method || order.channel || '—').trim() || '—',
        status: payStatusOf(order),
        paid: paid,
        change: change,
        ref: String(order.ref || '').trim()
      },

      verifyUrl: verifyUrl(order.id)
    };
  }

  /* ============================================================
     2. QR Code (byte mode, EC level M, versi 1–10) — encoder mandiri
        sehingga QR selalu tersedia tanpa layanan pihak ketiga.
        Modul QR menyimpan tautan verifikasi struk yang valid.
     ============================================================ */
  const EC_M = {
    1: { ec: 10, blocks: [[1, 16]] },
    2: { ec: 16, blocks: [[1, 28]] },
    3: { ec: 26, blocks: [[1, 44]] },
    4: { ec: 18, blocks: [[2, 32]] },
    5: { ec: 24, blocks: [[2, 43]] },
    6: { ec: 16, blocks: [[4, 27]] },
    7: { ec: 18, blocks: [[4, 31]] },
    8: { ec: 22, blocks: [[2, 38], [2, 39]] },
    9: { ec: 22, blocks: [[3, 36], [2, 37]] },
    10: { ec: 26, blocks: [[4, 43], [1, 44]] }
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        const c2 = str.charCodeAt(++i);
        const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
  }

  function dataCapacity(ver) {
    const spec = EC_M[ver];
    let dc = 0;
    spec.blocks.forEach(b => { dc += b[0] * b[1]; });
    return ver >= 10 ? dc - 3 : dc - 2;   /* byte mode: 4 bit mode + 8/16 bit hitung */
  }
  function pickVersion(len) {
    for (let v = 1; v <= 10; v++) if (dataCapacity(v) >= len) return v;
    return 0;
  }

  /* --- Galois field GF(256), polinom 0x11d --- */
  const GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
  (function initGf() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x; GF_LOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();
  function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]; }

  function rsGenerator(deg) {
    let poly = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= gfMul(poly[j], GF_EXP[i]);
        next[j + 1] ^= poly[j];
      }
      poly = next;
    }
    /* hasil disusun tinggi → rendah (koefisien tertinggi di depan, monik) */
    return poly.reverse();
  }
  function rsEncode(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const res = new Array(ecLen).fill(0);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ res[0];
      res.shift(); res.push(0);
      if (factor !== 0) for (let j = 0; j < ecLen; j++) res[j] ^= gfMul(gen[j + 1], factor);
    }
    return res;
  }

  function buildCodewords(bytes, ver) {
    const spec = EC_M[ver];
    let totalData = 0;
    spec.blocks.forEach(b => { totalData += b[0] * b[1]; });

    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0x4, 4);                                   /* mode byte */
    push(bytes.length, ver >= 10 ? 16 : 8);         /* jumlah karakter */
    bytes.forEach(b => push(b, 8));
    for (let i = 0; i < 4 && bits.length < totalData * 8; i++) bits.push(0);   /* terminator */
    while (bits.length % 8) bits.push(0);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      cw.push(v);
    }
    const PAD = [0xec, 0x11];
    let p = 0;
    while (cw.length < totalData) cw.push(PAD[p++ % 2]);

    /* potong per blok, hitung EC tiap blok, lalu susun ulang (interleave) */
    const dBlocks = [], eBlocks = [];
    let off = 0;
    spec.blocks.forEach(pair => {
      for (let i = 0; i < pair[0]; i++) {
        const blk = cw.slice(off, off + pair[1]); off += pair[1];
        dBlocks.push(blk);
        eBlocks.push(rsEncode(blk, spec.ec));
      }
    });
    const out = [];
    const maxData = Math.max.apply(null, dBlocks.map(b => b.length));
    for (let i = 0; i < maxData; i++) dBlocks.forEach(b => { if (i < b.length) out.push(b[i]); });
    for (let i = 0; i < spec.ec; i++) eBlocks.forEach(b => out.push(b[i]));
    return out;
  }

  function bchDigit(d) { let n = 0; while (d !== 0) { n++; d >>>= 1; } return n; }
  function formatBits(mask) {                       /* EC level M = 0b00 */
    const data = (0 << 3) | mask;
    let d = data << 10;
    while (bchDigit(d) - bchDigit(0x537) >= 0) d ^= 0x537 << (bchDigit(d) - bchDigit(0x537));
    return ((data << 10) | d) ^ 0x5412;
  }
  function versionBits(ver) {
    let d = ver << 12;
    while (bchDigit(d) - bchDigit(0x1f25) >= 0) d ^= 0x1f25 << (bchDigit(d) - bchDigit(0x1f25));
    return (ver << 12) | d;
  }
  const MASK_FN = [
    (i, j) => (i + j) % 2 === 0,
    (i, j) => i % 2 === 0,
    (i, j) => j % 3 === 0,
    (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
    (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
    (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0
  ];

  function qrMatrix(text, forceMask) {
    const bytes = utf8Bytes(String(text));
    const ver = pickVersion(bytes.length);
    if (!ver) return null;                                   /* terlalu panjang */
    const size = 17 + ver * 4;
    const mod = [];
    for (let r = 0; r < size; r++) mod.push(new Array(size).fill(null));

    /* pola pencari + pemisah */
    const finder = (row, col) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = row + r, cc = col + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          mod[rr][cc] = dark;
        }
      }
    };
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);

    /* pola penyesuaian (alignment) — sebelum garis timing */
    const pos = ALIGN[ver];
    for (let a = 0; a < pos.length; a++) {
      for (let b = 0; b < pos.length; b++) {
        const row = pos[a], col = pos[b];
        if (mod[row][col] !== null) continue;                /* menimpa pola pencari */
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            mod[row + r][col + c] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
          }
        }
      }
    }

    /* garis timing */
    for (let r = 8; r < size - 8; r++) if (mod[r][6] === null) mod[r][6] = (r % 2 === 0);
    for (let c = 8; c < size - 8; c++) if (mod[6][c] === null) mod[6][c] = (c % 2 === 0);

    /* info format (2 salinan) + modul gelap tetap */
    const mask = (forceMask == null ? 0 : forceMask) & 7;
    const fb = formatBits(mask);
    for (let i = 0; i < 15; i++) {
      const bit = ((fb >> i) & 1) === 1;
      if (i < 6) mod[i][8] = bit;
      else if (i < 8) mod[i + 1][8] = bit;
      else mod[size - 15 + i][8] = bit;

      if (i < 8) mod[8][size - i - 1] = bit;
      else if (i < 9) mod[8][15 - i] = bit;
      else mod[8][14 - i] = bit;
    }
    mod[size - 8][8] = true;

    /* info versi (versi >= 7) */
    if (ver >= 7) {
      const vb = versionBits(ver);
      for (let i = 0; i < 18; i++) {
        const bit = ((vb >> i) & 1) === 1;
        mod[Math.floor(i / 3)][i % 3 + size - 8 - 3] = bit;
        mod[i % 3 + size - 8 - 3][Math.floor(i / 3)] = bit;
      }
    }

    /* isi data (zigzag dari kanan bawah) — masking diterapkan di sini */
    const data = buildCodewords(bytes, ver);
    let inc = -1, row = size - 1, bitIndex = 7, byteIndex = 0;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let c = 0; c < 2; c++) {
          if (mod[row][col - c] === null) {
            let dark = false;
            if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            if (MASK_FN[mask](row, col - c)) dark = !dark;
            mod[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
      }
    }
    return { modules: mod, version: ver, mask: mask, size: size };
  }

  /* Pilih mask dengan aturan penalti standar (QR versi 1.0) */
  function penalty(m) {
    const n = m.length;
    let score = 0;
    /* N1 — lima modul sejajar warna sama */
    for (let r = 0; r < n; r++) {
      let runC = 1, runR = 1;
      for (let c = 1; c < n; c++) {
        if (m[r][c] === m[r][c - 1]) { runC++; } else { if (runC >= 5) score += 3 + (runC - 5); runC = 1; }
        if (m[c][r] === m[c - 1][r]) { runR++; } else { if (runR >= 5) score += 3 + (runR - 5); runR = 1; }
      }
      if (runC >= 5) score += 3 + (runC - 5);
      if (runR >= 5) score += 3 + (runR - 5);
    }
    /* N2 — blok 2x2 */
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    /* N3 — pola mirip pola pencari */
    const P1 = [true, false, true, true, true, false, true, false, false, false, false];
    const P2 = [false, false, false, false, true, false, true, true, true, false, true];
    const matchAt = (get, i) => {
      let a = true, b = true;
      for (let k = 0; k < 11; k++) {
        const v = get(i + k);
        if (v !== P1[k]) a = false;
        if (v !== P2[k]) b = false;
      }
      return a || b;
    };
    for (let r = 0; r < n; r++) {
      for (let c = 0; c + 11 <= n; c++) {
        if (matchAt(k => m[r][k], c)) score += 40;
        if (matchAt(k => m[k][r], c)) score += 40;
      }
    }
    /* N4 — penyimpangan rasio modul gelap */
    let dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) dark++;
    const ratio = dark * 100 / (n * n);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  }

  function qrAuto(text) {
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const q = qrMatrix(text, mask);
      if (!q) return null;
      const s = penalty(q.modules);
      if (s < bestScore) { bestScore = s; best = q; }
    }
    return best;
  }

  function qrSvg(text, px) {
    const q = qrAuto(text);
    if (!q) return '';
    const quiet = 4, n = q.size, box = n + quiet * 2;
    let cells = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (q.modules[r][c]) cells += '<rect x="' + (c + quiet) + '" y="' + (r + quiet) + '" width="1" height="1"/>';
      }
    }
    const p = px || 108;
    return '<svg class="rcpt-qr" viewBox="0 0 ' + box + ' ' + box + '" width="' + p + '" height="' + p +
      '" shape-rendering="crispEdges" role="img" aria-label="QR verifikasi struk ' + hx(text) + '">' +
      '<rect width="' + box + '" height="' + box + '" fill="#ffffff"/>' +
      '<g fill="#111111">' + cells + '</g></svg>';
  }

  /* ============================================================
     3. HTML struk (dipakai pratinjau modal & area cetak)
     ============================================================ */
  function rowHtml(k, v, cls) {
    return '<div class="rcpt-line' + (cls ? ' ' + cls : '') + '"><span>' + hx(k) + '</span><b>' + v + '</b></div>';
  }

  function html(m, opts) {
    opts = opts || {};
    if (!m) return '';
    const r = m.restaurant;
    const initial = (r.name.trim()[0] || 'R').toUpperCase();
    const logo = r.logo
      ? '<img src="' + hx(r.logo) + '" alt="Logo ' + hx(r.name) + '">'
      : '<span>' + hx(initial) + '</span>';

    const contacts = [];
    if (r.address) contacts.push(hx(r.address));
    const line2 = [];
    if (r.phone) line2.push('Telp/WA: ' + hx(r.phone));
    if (r.email) line2.push('Email: ' + hx(r.email));
    const line3 = [];
    if (r.website) line3.push(hx(r.website));
    if (r.social) line3.push(hx(r.social));

    /* --- identitas --- */
    let out = '<div class="rcpt' + (opts.print ? ' is-print' : '') + '">';
    out += '<div class="rcpt-head"><div class="rcpt-logo">' + logo + '</div>' +
      '<div class="rcpt-name">' + hx(r.name) + '</div>';
    if (contacts.length) out += '<div class="rcpt-contact">' + contacts.join('<br>') + '</div>';
    if (line2.length) out += '<div class="rcpt-contact">' + line2.join(' · ') + '</div>';
    if (line3.length) out += '<div class="rcpt-contact">' + line3.join(' · ') + '</div>';
    out += '</div>';

    out += '<div class="rcpt-rule"><span>STRUK PEMBAYARAN</span></div>';
    out += '<div class="rcpt-meta">';
    out += rowHtml('No. struk', hx(m.receiptNo));
    out += rowHtml('Tanggal', hx(m.dateText));
    out += rowHtml('Kasir', hx(m.cashier));
    out += rowHtml('Pelanggan', hx(m.customer));
    out += rowHtml('No. pesanan', hx(m.orderNo));
    if (m.table) out += rowHtml('Nomor meja', hx(m.table));
    out += rowHtml('Jenis pesanan', hx(m.orderType));
    if (m.channel) out += rowHtml('Channel', hx(m.channel));
    if (m.reservationNo) out += rowHtml('No. reservasi', hx(m.reservationNo));
    out += '</div>';

    /* --- rincian pesanan --- */
    out += '<div class="rcpt-rule"><span>RINCIAN PESANAN</span></div>';
    out += '<div class="rcpt-items">';
    m.items.forEach(it => {
      out += '<div class="rcpt-item"><div class="rcpt-item-top"><b>' + hx(it.name) + '</b><span>' + rp(it.sub) + '</span></div>';
      out += '<small>' + it.qty + ' × ' + rp(it.price) + (it.variant ? ' · varian ' + hx(it.variant) : '') + '</small>';
      if (it.note) out += '<small class="rcpt-note">Catatan: ' + hx(it.note) + '</small>';
      out += '</div>';
    });
    out += '</div>';
    if (m.itemsLegacy) out += '<div class="rcpt-hint">Rincian item terperinci tidak tersimpan untuk pesanan ini — total mengikuti transaksi yang tercatat.</div>';

    /* --- ringkasan pembayaran --- */
    out += '<div class="rcpt-rule"><span>RINGKASAN PEMBAYARAN</span></div>';
    out += '<div class="rcpt-summary">';
    m.summary.rows.forEach(row => {
      out += rowHtml(row.k, (row.v < 0 ? '−' : '') + rp(Math.abs(row.v)));
    });
    out += '</div>';
    out += '<div class="rcpt-grand"><span>TOTAL PEMBAYARAN</span><b>' + rp(m.summary.total) + '</b></div>';

    /* --- informasi pembayaran --- */
    out += '<div class="rcpt-rule"><span>INFORMASI PEMBAYARAN</span></div>';
    out += '<div class="rcpt-meta">';
    out += rowHtml('Metode pembayaran', hx(m.payment.method));
    out += rowHtml('Status pembayaran', '<i class="rcpt-status ' + (m.payment.status === 'Lunas' ? 'ok' : (m.payment.status === 'Dibatalkan' ? 'bad' : 'wait')) + '">' + hx(m.payment.status) + '</i>');
    out += rowHtml('Jumlah dibayarkan', rp(m.payment.paid));
    if (/tunai|cash/i.test(m.payment.method) || m.payment.change > 0) out += rowHtml('Kembalian', rp(m.payment.change));
    if (m.payment.ref) out += rowHtml('No. referensi', hx(m.payment.ref));
    out += '</div>';

    /* --- informasi tambahan --- */
    out += '<div class="rcpt-foot">';
    out += '<div class="rcpt-qrbox">' + qrSvg(m.verifyUrl, opts.qrSize || 104) +
      '<small>Pindai untuk membuka<br>detail transaksi ini</small></div>';
    out += '<div class="rcpt-thanks">Terima kasih atas kunjungan Anda</div>';
    const tail = [];
    if (r.phone) tail.push('Telp/WA ' + hx(r.phone));
    if (r.email) tail.push(hx(r.email));
    if (r.website) tail.push(hx(r.website));
    if (r.social) tail.push(hx(r.social));
    if (tail.length) out += '<div class="rcpt-contact">' + tail.join('<br>') + '</div>';
    out += '<div class="rcpt-proof">Struk ini merupakan bukti pembayaran yang sah.<br>Simpan struk ini untuk keperluan klaim atau komplain.</div>';
    out += '<div class="rcpt-gen">Dicetak ' + hx(fmtDateTime(Date.now())) + ' · ' + hx(m.receiptNo) + '</div>';
    out += '</div></div>';
    return out;
  }

  /* ============================================================
     4. Pratinjau (modal) + aksi cetak / PDF / bagikan
     ============================================================ */
  let currentId = '';

  function open(id) {
    currentId = String(id == null ? '' : id);
    const order = findOrder(currentId);
    if (!order) { notFound(); return; }
    const m = model(order);
    const actions =
      '<div class="rcpt-actions">' +
      '<button class="btn btn-primary" data-action="rcpt-print:80">🖨 Cetak 80 mm</button>' +
      '<button class="btn" data-action="rcpt-print:58">🖨 Cetak 58 mm</button>' +
      '<button class="btn" data-action="rcpt-pdf">⤓ Unduh PDF</button>' +
      '<button class="btn" data-action="rcpt-wa">WhatsApp</button>' +
      '<button class="btn" data-action="rcpt-email">Email</button>' +
      '</div>';
    openModal(
      '<div class="modal-head"><span class="provider-mark" style="--pm:#a97c2c">⌗</span>' +
      '<div><b>Struk ' + hx(m.receiptNo) + '</b><small>Pratinjau struk pelanggan · ' + hx(m.dateText) + ' · ' + rp(m.summary.total) + '</small></div>' +
      '<button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>' +
      '<div class="rcpt-preview">' + html(m, { qrSize: 118 }) + '</div>' +
      actions +
      '<small class="modal-note">Struk memakai data transaksi yang tersimpan — sama persis dengan nilai di POS, Pesanan, dan laporan keuangan.</small>',
      { className: 'modal-receipt' }
    );
  }

  function notFound() {
    openModal(
      '<div class="modal-head"><span class="provider-mark" style="--pm:#8a3324">✕</span>' +
      '<div><b>Struk tidak ditemukan</b><small>Transaksi tidak tersedia di perangkat ini</small></div>' +
      '<button class="modal-close" data-action="close-modal" aria-label="Tutup">×</button></div>' +
      '<p class="modal-text">Nomor struk yang diminta tidak ada di data perangkat ini. Struk hanya dapat dibuka pada perangkat yang memiliki transaksi tersebut (data restoran tersimpan per akun). Buka riwayat <b>Pesanan</b> untuk memilih struk yang tersedia.</p>' +
      '<div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">Tutup</button></div>'
    );
  }

  /* ---------- Cetak thermal 58 mm / 80 mm ---------- */
  function print(id, width) {
    const order = findOrder(id || currentId);
    if (!order) { notFound(); return; }
    const m = model(order);
    const w = Number(width) === 58 ? 58 : 80;

    let area = document.getElementById('rasaPrintArea');
    if (!area) {
      area = document.createElement('div');
      area.id = 'rasaPrintArea';
      document.body.appendChild(area);
    }
    area.className = 'rcpt-print-area rcpt-w' + w;
    area.innerHTML = html(m, { print: true, qrSize: w === 58 ? 74 : 96 });

    let st = document.getElementById('rasaPrintPage');
    if (!st) { st = document.createElement('style'); st.id = 'rasaPrintPage'; document.head.appendChild(st); }
    st.textContent = '@page{size:' + w + 'mm auto;margin:2mm}';

    document.body.classList.add('rcpt-printing');
    const cleanup = () => {
      document.body.classList.remove('rcpt-printing');
      try { window.removeEventListener('afterprint', cleanup); } catch (e) {}
    };
    try { window.addEventListener('afterprint', cleanup); } catch (e) {}
    setTimeout(() => {
      try { window.print(); } catch (e) {}
      setTimeout(cleanup, 1200);
    }, 80);
    toast('Menyiapkan cetak struk ' + w + ' mm…');
  }

  /* ============================================================
     5. Unduh PDF — penulis PDF mandiri (teks monospace, halaman
        selebar 80 mm) tanpa pustaka eksternal.
     ============================================================ */
  const PDF_W = 226.77;      /* 80 mm */
  const PDF_M = 20;          /* margin kiri/kanan (pt) */
  const PDF_LH = 9.6;        /* tinggi baris */
  const PDF_FS = 7.5;        /* ukuran font */
  const PDF_COLS = 42;       /* lebar teks (karakter) */
  const PDF_MAX_LINES = 78;  /* baris per halaman */

  function repeat(ch, n) { let s = ''; for (let i = 0; i < n; i++) s += ch; return s; }

  function wrap(text, width) {
    /* kata yang lebih panjang dari lebar baris (mis. tautan verifikasi)
       dipotong keras supaya teks PDF tidak keluar dari margin halaman */
    const raw = String(text).split(/\s+/).filter(Boolean);
    const words = [];
    raw.forEach(w => {
      while (w.length > width) { words.push(w.slice(0, width)); w = w.slice(width); }
      if (w) words.push(w);
    });
    const lines = [];
    let cur = '';
    words.forEach(w => {
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function pair(left, right, width) {
    const l = String(left), r = String(right);
    if (l.length + r.length + 1 <= width) return l + repeat(' ', width - l.length - r.length) + r;
    const lines = [];
    const head = l.slice(0, Math.max(1, width - r.length - 1));
    lines.push(head + repeat(' ', Math.max(1, width - head.length - r.length)) + r);
    if (l.length > head.length) lines.push.apply(lines, wrap(l.slice(head.length).trim(), width));
    return lines.join('\n');
  }

  function pdfTextLines(m) {
    const W = PDF_COLS;
    const L = [];
    const rule = ch => L.push(repeat(ch || '-', W));
    const center = s => {
      const t = String(s);
      if (t.length >= W) { L.push(t.slice(0, W)); return; }
      const sp = Math.floor((W - t.length) / 2);
      L.push(repeat(' ', sp) + t);
    };

    center(m.restaurant.name);
    if (m.restaurant.address) wrap(m.restaurant.address, W).forEach(x => center(x));
    if (m.restaurant.phone || m.restaurant.email) {
      const c = [];
      if (m.restaurant.phone) c.push('Telp/WA: ' + m.restaurant.phone);
      if (m.restaurant.email) c.push('Email: ' + m.restaurant.email);
      wrap(c.join('  '), W).forEach(x => center(x));
    }
    if (m.restaurant.website) center(m.restaurant.website);
    if (m.restaurant.social) center(m.restaurant.social);
    L.push('');
    center('STRUK PEMBAYARAN');
    rule('=');
    L.push(pair('No. struk', m.receiptNo, W));
    L.push(pair('Tanggal', m.dateText, W));
    L.push(pair('Kasir', m.cashier, W));
    L.push(pair('Pelanggan', m.customer, W));
    L.push(pair('No. pesanan', m.orderNo, W));
    if (m.table) L.push(pair('Nomor meja', m.table, W));
    L.push(pair('Jenis pesanan', m.orderType, W));
    if (m.channel) L.push(pair('Channel', m.channel, W));
    if (m.reservationNo) L.push(pair('No. reservasi', m.reservationNo, W));
    L.push('');
    rule('=');
    center('RINCIAN PESANAN');
    rule('-');
    m.items.forEach(it => {
      const head = pair(it.qty + 'x ' + it.name, rp(it.sub), W);
      head.split('\n').forEach(x => L.push(x));
      L.push('    @ ' + rp(it.price) + (it.variant ? '  (' + it.variant + ')' : ''));
      if (it.note) wrap('    Catatan: ' + it.note, W).forEach(x => L.push(x));
    });
    if (m.itemsLegacy) wrap('Rincian item terperinci tidak tersimpan untuk pesanan ini.', W).forEach(x => L.push(x));
    L.push('');
    rule('=');
    center('RINGKASAN PEMBAYARAN');
    rule('-');
    m.summary.rows.forEach(row => {
      L.push(pair(row.k, (row.v < 0 ? '- ' : '') + rp(Math.abs(row.v)), W));
    });
    rule('-');
    const grand = 'TOTAL PEMBAYARAN';
    L.push(pair(grand, rp(m.summary.total), W));
    rule('=');
    L.push('');
    center('INFORMASI PEMBAYARAN');
    rule('-');
    L.push(pair('Metode pembayaran', m.payment.method, W));
    L.push(pair('Status pembayaran', m.payment.status, W));
    L.push(pair('Jumlah dibayarkan', rp(m.payment.paid), W));
    if (/tunai|cash/i.test(m.payment.method) || m.payment.change > 0) L.push(pair('Kembalian', rp(m.payment.change), W));
    if (m.payment.ref) L.push(pair('No. referensi', m.payment.ref, W));
    L.push('');
    rule('=');
    center('Terima kasih atas kunjungan Anda');
    L.push('');
    wrap('Pindai QR untuk verifikasi: ' + m.verifyUrl, W).forEach(x => L.push(x));
    L.push('');
    if (m.restaurant.phone) L.push(pair('Telp/WA', m.restaurant.phone, W));
    if (m.restaurant.email) L.push(pair('Email', m.restaurant.email, W));
    if (m.restaurant.website) L.push(pair('Website', m.restaurant.website, W));
    if (m.restaurant.social) L.push(pair('Media sosial', m.restaurant.social, W));
    L.push('');
    wrap('Struk ini merupakan bukti pembayaran yang sah. Simpan struk ini untuk keperluan klaim atau komplain.', W)
      .forEach(x => L.push(x));
    L.push('');
    center('Dicetak ' + fmtDateTime(Date.now()));
    center(m.receiptNo);
    return L;
  }

  /* Konversi string → byte WinAnsi (karakter di luar 32..255 diganti '?') */
  function toWinAnsi(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c === 0x2028 || c === 0x2029) c = 32;
      if (c < 32) c = 32;
      if (c > 255) {
        const map = { '−': 45, '–': 45, '—': 45, '·': 183, '×': 215, '…': 33, '“': 34, '”': 34, '‘': 39, '’': 39, '•': 45, '⚠': 33 };
        c = (map[s[i]] != null) ? map[s[i]] : 63;
      }
      out.push(c);
    }
    return out;
  }

  function pdfBytes(m) {
    const lines = pdfTextLines(m);
    const pages = [];
    for (let i = 0; i < lines.length; i += PDF_MAX_LINES) pages.push(lines.slice(i, i + PDF_MAX_LINES));
    if (!pages.length) pages.push(['']);

    const pageH = Math.max(200, PDF_MAX_LINES * PDF_LH + 2 * PDF_M);
    const bytes = [];
    const S = s => { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff); };
    const A = a => { for (let i = 0; i < a.length; i++) bytes.push(a[i] & 0xff); };

    const pageObjs = [];
    pages.forEach((_, i) => { pageObjs.push(4 + i * 2); });
    const contentObjs = [];
    pages.forEach((_, i) => { contentObjs.push(5 + i * 2); });
    const fontObj = 3;
    const nextObj = 4 + pages.length * 2;

    S('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    const offsets = [];
    const beginObj = n => { offsets[n] = bytes.length; S(n + ' 0 obj\n'); };
    const endObj = () => S('endobj\n');

    beginObj(1); S('<< /Type /Catalog /Pages 2 0 R >>\n'); endObj();
    beginObj(2); S('<< /Type /Pages /Kids [' + pageObjs.map(o => o + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>\n'); endObj();
    beginObj(fontObj); S('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\n'); endObj();

    pages.forEach((plines, i) => {
      beginObj(pageObjs[i]);
      S('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PDF_W.toFixed(2) + ' ' + pageH.toFixed(2) + '] ' +
        '/Resources << /Font << /F1 ' + fontObj + ' 0 R >> >> /Contents ' + contentObjs[i] + ' 0 R >>\n');
      endObj();

      const content = [];
      content.push('BT');
      content.push('/F1 ' + PDF_FS + ' Tf');
      content.push(PDF_LH + ' TL');
      content.push('1 0 0 1 ' + PDF_M.toFixed(2) + ' ' + (pageH - PDF_M - PDF_FS).toFixed(2) + ' Tm');
      plines.forEach(ln => {
        content.push('(' + toWinAnsi(ln).map(b => {
          const ch = String.fromCharCode(b);
          if (ch === '(' || ch === ')' || ch === '\\') return '\\' + ch;
          return ch;
        }).join('') + ') Tj');
        content.push('T*');
      });
      content.push('ET');
      const stream = content.join('\n');

      beginObj(contentObjs[i]);
      S('<< /Length ' + stream.length + ' >>\nstream\n');
      S(stream);
      S('\nendstream\n');
      endObj();
    });

    const xrefPos = bytes.length;
    const totalObjs = nextObj - 1;
    S('xref\n0 ' + (totalObjs + 1) + '\n');
    S('0000000000 65535 f\r\n');
    for (let n = 1; n <= totalObjs; n++) {
      const off = offsets[n] || 0;
      S(('0000000000' + off).slice(-10) + ' 00000 n\r\n');
    }
    S('trailer\n<< /Size ' + (totalObjs + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

    return new Uint8Array(bytes);
  }

  function downloadPdf(id) {
    const order = findOrder(id || currentId);
    if (!order) { notFound(); return; }
    const m = model(order);
    const blob = new Blob([pdfBytes(m)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'struk-' + String(m.receiptNo).replace(/[^\w-]/g, '') + '.pdf';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
    toast('Struk ' + m.receiptNo + ' diunduh sebagai PDF.');
  }

  /* ============================================================
     6. Bagikan struk (WhatsApp / email)
     ============================================================ */
  function shareText(m) {
    const lines = [
      'Struk ' + m.receiptNo + ' — ' + m.restaurant.name,
      'Tanggal: ' + m.dateText,
      'Pesanan: ' + m.items.map(i => i.qty + 'x ' + i.name).join(', '),
      'Total: ' + rp(m.summary.total),
      'Metode: ' + m.payment.method + ' (' + m.payment.status + ')',
      'Terima kasih atas kunjungan Anda.',
      'Detail transaksi: ' + m.verifyUrl
    ];
    return lines.join('\n');
  }

  function shareWa(id) {
    const order = findOrder(id || currentId);
    if (!order) { notFound(); return; }
    const m = model(order);
    const phone = String(m.restaurant.phone || '').replace(/\D/g, '');
    const url = 'https://wa.me/' + (phone ? phone.replace(/^0/, '62') : '') +
      '?text=' + encodeURIComponent(shareText(m));
    window.open(url, '_blank', 'noopener');
    toast('Membuka WhatsApp untuk membagikan struk…');
  }

  function shareEmail(id) {
    const order = findOrder(id || currentId);
    if (!order) { notFound(); return; }
    const m = model(order);
    const subject = 'Struk ' + m.receiptNo + ' — ' + m.restaurant.name;
    window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(shareText(m));
    toast('Membuka aplikasi email untuk membagikan struk…');
  }

  /* ============================================================
     7. Pendaftaran aksi + tautan verifikasi /#struk=<id>
     ============================================================ */
  const R = (window.RASA = window.RASA || { actions: {} });
  R.actions = R.actions || {};
  R.actions['receipt'] = id => open(id);
  R.actions['rcpt-print'] = w => print(currentId, w);
  R.actions['rcpt-print-quick'] = id => { currentId = String(id || currentId); print(currentId, 80); };
  R.actions['rcpt-pdf'] = () => downloadPdf(currentId);
  R.actions['rcpt-wa'] = () => shareWa(currentId);
  R.actions['rcpt-email'] = () => shareEmail(currentId);

  /* Tautan QR: buka langsung ke detail transaksi. Hash dibersihkan
     lebih dulu supaya halaman aplikasi tidak jatuh ke layar 404. */
  let pendingId = null;
  try {
    const h = String(location.hash || '');
    if (h.indexOf('#struk=') === 0) {
      pendingId = decodeURIComponent(h.slice(7));
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) { pendingId = null; }

  function openPending(tries) {
    if (!pendingId) return;
    if (!window.RASA || !window.RASA.appReady) {
      if (tries > 0) setTimeout(() => openPending(tries - 1), 250);
      else { const id = pendingId; pendingId = null; open(id); }
      return;
    }
    const id = pendingId;
    pendingId = null;
    open(id);
  }
  if (pendingId) setTimeout(() => openPending(60), 120);

  return {
    open: open,
    print: print,
    pdf: downloadPdf,
    wa: shareWa,
    email: shareEmail,
    model: model,
    html: html,
    qr: qrSvg,
    qrMatrix: qrAuto,
    pdfBytes: pdfBytes,
    pdfTextLines: pdfTextLines,
    verifyUrl: verifyUrl
  };
})();
