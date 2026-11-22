/* ============================================================
   RASA Restaurant OS — Penyimpanan data terpusat (sinkronisasi)
   Satu workspace JSON per Restaurant ID. Setiap PUT dicek
   permission-nya per modul di backend, lalu dicatat ke audit log.
   ============================================================ */

import { json, err, readJson, clean, MAX_PAYLOAD } from './lib.js';
import { can, moduleOfKey, RESTAURANT_IDENTITY_KEYS } from './permissions.js';
import { requireAuth } from './auth.js';
import { writeAudit } from './audit.js';

const DB = env => env.rasa_restaurant_os_db;
const parse = s => { try { return JSON.parse(s) } catch (e) { return {} } };

/* ---------- validasi bentuk payload (server adalah penentu akhir) ----------
   Mencegah data rusak / berbahaya masuk ke penyimpanan terpusat,
   termasuk proteksi terhadap prototype pollution. */
const BAD_KEY = /(__proto__|constructor|prototype|__defineGetter__|__defineSetter__)/;
function deepSafe(v, depth) {
  if (depth > 8) return 'data terlalu bersarang';
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { const r = deepSafe(v[i], depth + 1); if (r) return r; }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (BAD_KEY.test(k)) return 'kunci tidak aman';
      const r = deepSafe(v[k], depth + 1); if (r) return r;
    }
  }
  return null;
}
const isNum = (n, min, max) => typeof n === 'number' && isFinite(n) && n >= min && n <= max;
const isStr = (s, max) => typeof s === 'string' && s.length <= max;
const isId = s => typeof s === 'string' && s.length >= 1 && s.length <= 40;

function validateValue(key, v) {
  const deep = deepSafe(v, 0);
  if (deep) return deep;

  if (key === 'inventory') {
    if (!Array.isArray(v)) return 'harus berupa daftar';
    if (v.length > 1000) return 'maksimal 1000 bahan';
    for (const it of v) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) return 'baris bahan tidak valid';
      if (!isId(it.id)) return 'id bahan tidak valid';
      if (typeof it.name !== 'string' || !it.name.trim() || it.name.length > 60) return 'nama bahan tidak valid';
      if (!isStr(it.cat == null ? '' : String(it.cat), 40)) return 'kategori terlalu panjang';
      if (!isStr(it.unit == null ? '' : String(it.unit), 10)) return 'satuan terlalu panjang';
      if (!isNum(it.stock, 0, 1e9)) return 'stok harus angka 0 ke atas';
      if (!isNum(it.min, 0, 1e9)) return 'stok minimum harus angka 0 ke atas';
      if (!isNum(it.cost, 0, 1e12)) return 'harga satuan tidak valid';
      /* tanggal kedaluwarsa & nomor batch (opsional) untuk bahan yang butuh */
      if (it.expiry != null && it.expiry !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(it.expiry))) return 'tanggal kedaluwarsa tidak valid';
      if (it.batch != null && !isStr(String(it.batch), 24)) return 'nomor batch terlalu panjang';
    }
    return null;
  }

  if (key === 'recipes') {
    if (!Array.isArray(v)) return 'harus berupa daftar';
    if (v.length > 1000) return 'maksimal 1000 resep';
    for (const r of v) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) return 'baris resep tidak valid';
      if (!isId(r.id)) return 'id resep tidak valid';
      if (!isId(r.productId)) return 'id produk tidak valid';
      if (r.yield != null && !isNum(r.yield, 1, 1000)) return 'jumlah porsi tidak valid';
      if (!Array.isArray(r.items)) return 'daftar bahan tidak valid';
      if (r.items.length > 100) return 'maksimal 100 bahan per resep';
      for (const it of r.items) {
        if (!it || typeof it !== 'object') return 'baris bahan resep tidak valid';
        /* bahan = bahan persediaan (invId) ATAU sub-resep produk lain (sub) */
        const hasInv = typeof it.invId === 'string' && it.invId.length >= 1 && it.invId.length <= 40;
        const hasSub = typeof it.sub === 'string' && it.sub.length >= 1 && it.sub.length <= 40;
        if (!hasInv && !hasSub) return 'bahan resep tidak valid';
        if (!isNum(it.qty, 0.000001, 1e6)) return 'takaran harus angka lebih dari 0';
        if (it.u != null && !isStr(String(it.u), 10)) return 'satuan takaran tidak valid';
        if (it.v != null && !isStr(String(it.v), 30)) return 'varian tidak valid';
      }
    }
    return null;
  }

  if (key === 'stockLog') {
    if (!Array.isArray(v)) return 'harus berupa daftar';
    if (v.length > 500) return 'maksimal 500 entri log';
    for (const e of v) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return 'entri log tidak valid';
      if (!isNum(e.t, 0, 4e12)) return 'waktu log tidak valid';
      if (!isId(e.invId)) return 'id bahan tidak valid';
      if (!isNum(e.qty, -1e9, 1e9)) return 'jumlah log tidak valid';
      if (!isStr(e.kind == null ? '' : String(e.kind), 12)) return 'jenis log tidak valid';
      if (!isStr(e.day == null ? '' : String(e.day), 12)) return 'tanggal log tidak valid';
      if (e.cost != null && !isNum(e.cost, 0, 1e12)) return 'nilai log tidak valid';
      if (e.note != null && !isStr(String(e.note), 60)) return 'catatan log terlalu panjang';
      if (e.before != null && !isNum(e.before, 0, 1e9)) return 'stok sebelum tidak valid';
      if (e.after != null && !isNum(e.after, 0, 1e9)) return 'stok sesudah tidak valid';
      if (e.by != null && !isStr(String(e.by), 60)) return 'pelaku perubahan tidak valid';
    }
    return null;
  }

  /* ---------- Pengadaan: pemasok, permintaan beli (PR), purchase order (PO) ----------
     Stok HANYA bertambah lewat penerimaan barang di PO — bukan saat PO dibuat. */
  if (key === 'suppliers') {
    if (!Array.isArray(v)) return 'harus berupa daftar';
    if (v.length > 500) return 'maksimal 500 pemasok';
    for (const s of v) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return 'baris pemasok tidak valid';
      if (!isId(s.id)) return 'id pemasok tidak valid';
      if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60) return 'nama pemasok tidak valid';
      if (s.contact != null && !isStr(String(s.contact), 60)) return 'nama kontak terlalu panjang';
      if (s.phone != null && !isStr(String(s.phone), 24)) return 'telepon pemasok tidak valid';
      if (s.address != null && !isStr(String(s.address), 90)) return 'alamat terlalu panjang';
      if (s.note != null && !isStr(String(s.note), 160)) return 'catatan terlalu panjang';
      if (s.items != null) {
        if (!Array.isArray(s.items) || s.items.length > 300) return 'daftar harga pemasok tidak valid';
        for (const p of s.items) {
          if (!p || typeof p !== 'object' || Array.isArray(p)) return 'harga pemasok tidak valid';
          if (!isId(p.invId)) return 'id bahan pada harga pemasok tidak valid';
          if (!isNum(p.price, 0, 1e12)) return 'harga pemasok tidak valid';
        }
      }
    }
    return null;
  }

  if (key === 'purchaseRequests') {
    if (!Array.isArray(v)) return 'harus berupa daftar';
    if (v.length > 500) return 'maksimal 500 permintaan pembelian';
    for (const p of v) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return 'permintaan pembelian tidak valid';
      if (!isId(p.id)) return 'id permintaan tidak valid';
      if (p.no != null && !isStr(String(p.no), 24)) return 'nomor permintaan tidak valid';
      if (p.date != null && !isStr(String(p.date), 12)) return 'tanggal permintaan tidak valid';
      if (p.status != null && !isStr(String(p.status), 16)) return 'status permintaan tidak valid';
      if (!Array.isArray(p.items) || !p.items.length || p.items.length > 100) return 'daftar barang permintaan tidak valid';
      for (const it of p.items) {
        if (!it || typeof it !== 'object' || Array.isArray(it)) return 'barang permintaan tidak valid';
        if (!isId(it.invId)) return 'id bahan pada permintaan tidak valid';
        if (!isNum(it.qty, 0.000001, 1e9)) return 'jumlah barang tidak valid';
        if (it.price != null && !isNum(it.price, 0, 1e12)) return 'estimasi harga tidak valid';
      }
      if (p.note != null && !isStr(String(p.note), 200)) return 'catatan permintaan terlalu panjang';
      if (p.by != null && !isStr(String(p.by), 60)) return 'nama pemohon tidak valid';
      if (p.approver != null && !isStr(String(p.approver), 60)) return 'nama penyetuju tidak valid';
      if (p.decidedAt != null && !isNum(p.decidedAt, 0, 4e12)) return 'waktu keputusan tidak valid';
    }
    return null;
  }

  if (key === 'purchaseOrders') {
    if (!Array.isArray(v)) return 'harus berupa daftar';
    if (v.length > 500) return 'maksimal 500 purchase order';
    for (const po of v) {
      if (!po || typeof po !== 'object' || Array.isArray(po)) return 'purchase order tidak valid';
      if (!isId(po.id)) return 'id PO tidak valid';
      if (po.no != null && !isStr(String(po.no), 24)) return 'nomor PO tidak valid';
      if (po.date != null && !isStr(String(po.date), 12)) return 'tanggal PO tidak valid';
      if (po.status != null && !isStr(String(po.status), 16)) return 'status PO tidak valid';
      if (po.supplierId != null && !isStr(String(po.supplierId), 40)) return 'id pemasok tidak valid';
      if (po.supplierName != null && !isStr(String(po.supplierName), 60)) return 'nama pemasok tidak valid';
      if (po.prId != null && !isStr(String(po.prId), 40)) return 'id permintaan tidak valid';
      if (!Array.isArray(po.items) || !po.items.length || po.items.length > 100) return 'daftar barang PO tidak valid';
      for (const it of po.items) {
        if (!it || typeof it !== 'object' || Array.isArray(it)) return 'barang PO tidak valid';
        if (!isId(it.invId)) return 'id bahan pada PO tidak valid';
        if (it.name != null && !isStr(String(it.name), 60)) return 'nama barang terlalu panjang';
        if (it.unit != null && !isStr(String(it.unit), 10)) return 'satuan barang tidak valid';
        if (!isNum(it.qty, 0.000001, 1e9)) return 'jumlah dipesan tidak valid';
        if (it.recv != null && !isNum(it.recv, 0, 1e9)) return 'jumlah diterima tidak valid';
        if (it.rej != null && !isNum(it.rej, 0, 1e9)) return 'jumlah ditolak tidak valid';
        if (it.price != null && !isNum(it.price, 0, 1e12)) return 'harga beli tidak valid';
        if (it.rejects != null) {
          if (!Array.isArray(it.rejects) || it.rejects.length > 50) return 'riwayat penolakan tidak valid';
          for (const rj of it.rejects) {
            if (!rj || typeof rj !== 'object') return 'riwayat penolakan tidak valid';
            if (!isNum(rj.qty, 0.000001, 1e9)) return 'jumlah ditolak tidak valid';
            if (rj.reason != null && !isStr(String(rj.reason), 80)) return 'alasan penolakan terlalu panjang';
          }
        }
      }
      if (po.total != null && !isNum(po.total, 0, 1e13)) return 'total PO tidak valid';
      if (po.payments != null) {
        if (!Array.isArray(po.payments) || po.payments.length > 300) return 'riwayat pembayaran tidak valid';
        for (const pay of po.payments) {
          if (!pay || typeof pay !== 'object' || Array.isArray(pay)) return 'pembayaran tidak valid';
          if (!isNum(pay.amount, 0, 1e13)) return 'nilai pembayaran tidak valid';
          if (pay.method != null && !isStr(String(pay.method), 24)) return 'metode pembayaran tidak valid';
          if (pay.by != null && !isStr(String(pay.by), 60)) return 'nama pelaku pembayaran tidak valid';
          if (pay.t != null && !isNum(pay.t, 0, 4e12)) return 'waktu pembayaran tidak valid';
        }
      }
      if (po.invoice != null) {
        if (typeof po.invoice !== 'object' || Array.isArray(po.invoice)) return 'invoice tidak valid';
        if (po.invoice.no != null && !isStr(String(po.invoice.no), 40)) return 'nomor invoice terlalu panjang';
        if (po.invoice.date != null && !isStr(String(po.invoice.date), 12)) return 'tanggal invoice tidak valid';
        if (po.invoice.amount != null && !isNum(po.invoice.amount, 0, 1e13)) return 'nilai invoice tidak valid';
      }
      if (po.createdBy != null && !isStr(String(po.createdBy), 60)) return 'pembuat PO tidak valid';
      if (po.approvedBy != null && !isStr(String(po.approvedBy), 60)) return 'penyetuju PO tidak valid';
      if (po.receivedBy != null && !isStr(String(po.receivedBy), 60)) return 'penerima PO tidak valid';
    }
    return null;
  }

  /* ---------- Riwayat resep: perubahan komposisi tidak mengubah
     perhitungan transaksi penjualan lama (COGS disimpan per pesanan) ---------- */
  if (key === 'recipeLog') {
    if (!Array.isArray(v)) return 'harus berupa daftar';
    if (v.length > 500) return 'maksimal 500 riwayat resep';
    for (const e of v) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return 'riwayat resep tidak valid';
      if (!isId(e.id)) return 'id riwayat resep tidak valid';
      if (!isId(e.productId)) return 'id produk tidak valid';
      if (!isNum(e.t, 0, 4e12)) return 'waktu riwayat tidak valid';
      if (!Array.isArray(e.items) || e.items.length > 100) return 'daftar bahan riwayat tidak valid';
      if (e.by != null && !isStr(String(e.by), 60)) return 'nama pengubah resep tidak valid';
      if (e.note != null && !isStr(String(e.note), 80)) return 'catatan resep terlalu panjang';
    }
    return null;
  }

  if (key === 'accounting') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return 'harus berupa objek';
    const j = v.journal;
    if (j == null) return null;
    if (!Array.isArray(j)) return 'jurnal harus berupa daftar';
    if (j.length > 500) return 'maksimal 500 entri jurnal';
    for (const e of j) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return 'entri jurnal tidak valid';
      if (!isId(e.id)) return 'id jurnal tidak valid';
      if (!isStr(e.date == null ? '' : String(e.date), 12)) return 'tanggal jurnal tidak valid';
      if (typeof e.memo !== 'string' || !e.memo.trim() || e.memo.length > 80) return 'keterangan jurnal tidak valid';
      if (!Array.isArray(e.lines) || e.lines.length < 1 || e.lines.length > 60) return 'baris jurnal tidak valid';
      let d = 0, c = 0;
      for (const l of e.lines) {
        if (!l || typeof l !== 'object') return 'baris jurnal tidak valid';
        if (!isStr(String(l.acc == null ? '' : l.acc), 12)) return 'akun jurnal tidak valid';
        if (!isNum(l.debit, 0, 1e12)) return 'debit harus angka 0 ke atas';
        if (!isNum(l.credit, 0, 1e12)) return 'kredit harus angka 0 ke atas';
        d += l.debit; c += l.credit;
      }
      if (Math.round(d) !== Math.round(c)) return 'jurnal tidak seimbang (debit ≠ kredit)';
    }
    return null;
  }

  /* key pengaturan berbentuk skalar wajib string dengan batas wajar */
  const SCALAR = {
    restaurantName: 60, restaurantLocation: 80, brandName: 60, ownerName: 60,
    ownerRole: 40, lat: 20, lng: 20, theme: 30,
    restoAddress: 90, restoPhone: 24, restoEmail: 60, restoWebsite: 60, restoSocial: 60
  };
  if (Object.prototype.hasOwnProperty.call(SCALAR, key)) {
    if (v == null) return null;
    if (typeof v !== 'string' || v.length > SCALAR[key]) return 'nilai teks tidak valid';
    return null;
  }
  if (key === 'isOpen' && v != null && typeof v !== 'boolean') return 'status buka harus boolean';
  if (key === 'accounts' && v != null && (typeof v !== 'object' || Array.isArray(v))) return 'akun harus objek';
  return null;
}

/* ---------- GET /api/data ----------
   Keputusan desain: seluruh payload restoran SELALU dikirim, tanpa disaring
   per modul. Pencabutan wewenang oleh Owner tidak memutus sinkronisasi dan
   tidak pernah menghapus data — yang dibatasi adalah AKSES (menu
   disembunyikan, tautan langsung ditolak) dan TULISAN (PUT /api/data). */
export async function getData(req, env) {
  const a = await requireAuth(req, env);

  const row = await DB(env)
    .prepare('SELECT payload,rev,updated_at,updated_by FROM workspace WHERE restaurant_id = ?')
    .bind(a.user.restaurant_id).first();

  const payload = row ? parse(row.payload) : {};

  return json({
    ok: true,
    payload,
    rev: row ? row.rev : 0,
    updatedAt: row ? row.updated_at : 0,
    updatedBy: row ? row.updated_by : '',
    permissions: a.perms,
    user: { id: a.user.id, name: a.user.name, role: a.user.role, email: a.user.email }
  });
}

/* ---------- PUT /api/data ----------
   body: { payload, changed?: string[], baseRev?: number }
   Hanya key pada `changed` yang boleh menimpa data; sisanya tetap milik server.
   Key yang tidak berhak diubah (permission) TIDAK ditulis dan dilaporkan. */
export async function putData(req, env) {
  const a = await requireAuth(req, env);
  const body = await readJson(req, MAX_PAYLOAD);
  const incoming = body.payload;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return err('Payload tidak valid.', 400, { field: 'payload' });
  }

  const row = await DB(env)
    .prepare('SELECT payload,rev,updated_at FROM workspace WHERE restaurant_id = ?')
    .bind(a.user.restaurant_id).first();
  const serverPayload = row ? parse(row.payload) : {};
  const serverRev = row ? row.rev : 0;

  let changed = Array.isArray(body.changed) ? body.changed.map(String).slice(0, 200) : null;
  if (!changed) changed = Object.keys(incoming);
  changed = changed.filter(k => typeof k === 'string' && k.length <= 60);

  const merged = Object.assign({}, serverPayload);
  const applied = [], denied = [], unchanged = [], invalid = [];

  for (const key of changed) {
    const mod = moduleOfKey(key);
    const nextVal = incoming[key];
    const prevVal = serverPayload[key];
    const same = JSON.stringify(nextVal) === JSON.stringify(prevVal);
    if (same) { unchanged.push(key); continue; }
    const problem = nextVal === undefined ? null : validateValue(key, nextVal);
    if (problem) { invalid.push({ key, reason: problem }); continue; }

    /* --- PROTEKSI IDENTITAS RESTORAN ---
       Key identitas restoran (logo, nama pemilik, nama restoran, kontak,
       tampilan/warna, lokasi) hanya boleh ditulis oleh Owner — berlaku
       MESKIPUN role tersebut punya permission settings:update penuh.
       Permintaan non-owner ditolak dan dicatat ke audit log. */
    if (RESTAURANT_IDENTITY_KEYS.indexOf(key) >= 0 && a.user.role !== 'owner') {
      denied.push({ key, module: mod, reason: 'owner_only' });
      continue;
    }
    /* Workspace "Antar Ke Meja" (modul 'antar') juga menulis key pesanan:
       Acc & antar / Sampai di meja cukup berwewenang antar — modul 'orders'
       tetap yang utama; keduanya berlaku sebagai izin alternatif.
       Serupa, "Kosongkan Meja" (modul 'clear-table') menulis 'reservations'
       (field clearedAt) — cukup berwewenang clear-table tanpa perlu
       reservations:update penuh, agar bisa dicabut/diberikan terpisah. */
    if (mod !== 'misc' && !can(a.perms, mod, 'update') &&
        !(mod === 'orders' && can(a.perms, 'antar', 'update')) &&
        !(mod === 'reservations' && can(a.perms, 'clear-table', 'update'))) {
      denied.push({ key, module: mod });
      continue;
    }
    if (nextVal === undefined) continue;
    merged[key] = nextVal;
    applied.push(key);
  }

  const now = Date.now();
  let rev = serverRev;

  if (applied.length || denied.length) {
    rev = serverRev + 1;
    await DB(env).prepare(
      `INSERT INTO workspace (restaurant_id,payload,rev,updated_at,updated_by)
       VALUES (?,?,?,?,?)
       ON CONFLICT(restaurant_id) DO UPDATE SET payload = excluded.payload, rev = excluded.rev,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(a.user.restaurant_id, JSON.stringify(merged), rev, now, a.user.id).run();

    /* mirror identitas restoran agar staf yang belum sync tetap melihat nama & status */
    await mirrorRestaurant(env, a.user.restaurant_id, merged);

    await writeAudit(env, a.ctx, denied.length ? 'data.update.partial' : 'data.update', 'workspace', {
      rev,
      applied: applied.map(k => moduleOfKey(k) + ':' + k).slice(0, 40),
      denied: denied.map(d => d.module + ':' + d.key + (d.reason ? '(' + d.reason + ')' : '')).slice(0, 20),
      invalid: invalid.map(x => x.key).slice(0, 20),
      bytes: JSON.stringify(merged).length
    });
  }

  if (denied.length) {
    await writeAudit(env, a.ctx, denied.some(d => d.reason === 'owner_only') ? 'permission.denied.owner' : 'permission.denied', 'workspace', {
      denied: denied.map(d => d.module + ':' + d.key + (d.reason ? '(' + d.reason + ')' : '')).slice(0, 20)
    });
  }
  if (invalid.length) {
    await writeAudit(env, a.ctx, 'data.invalid', 'workspace', {
      invalid: invalid.map(x => x.key + ':' + x.reason).slice(0, 20)
    });
  }

  /* Kanonik untuk klien = payload penuh (data tidak pernah disembunyikan;
     yang ditolak hanya tulisan, dan sudah dilaporkan lewat `denied`). */
  return json({
    ok: true,
    rev,
    updatedAt: now,
    applied,
    denied,
    invalid,
    unchanged: unchanged.length,
    payload: merged
  });
}

async function mirrorRestaurant(env, restaurantId, payload) {
  try {
    const name = clean(payload.restaurantName, 60);
    const location = clean(payload.restaurantLocation, 80);
    const lat = clean(payload.lat, 20), lng = clean(payload.lng, 20);
    const status = payload.isOpen === false ? 'tutup' : 'buka';
    if (name || location || lat || lng) {
      await DB(env).prepare(
        `UPDATE restaurants SET name = CASE WHEN ? != '' THEN ? ELSE name END,
                                location = CASE WHEN ? != '' THEN ? ELSE location END,
                                lat = CASE WHEN ? != '' THEN ? ELSE lat END,
                                lng = CASE WHEN ? != '' THEN ? ELSE lng END,
                                status = ?, updated_at = ?
         WHERE id = ?`
      ).bind(name, name, location, location, lat, lat, lng, lng, status, Date.now(), restaurantId).run();
    } else {
      await DB(env).prepare('UPDATE restaurants SET status = ?, updated_at = ? WHERE id = ?')
        .bind(status, Date.now(), restaurantId).run();
    }
  } catch (e) {
    console.log('mirror-restaurant-failed', String(e && e.message));
  }
}

/* ---------- PUT /api/restaurant — putaran kode undangan ---------- */
export async function rotateInvite(req, env) {
  const a = await requireAuth(req, env);
  if (a.user.role !== 'owner') return err('Hanya owner yang bisa mengelola kode undangan.', 403);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 8; i++) code += chars[buf[i] % chars.length];
  await DB(env).prepare('UPDATE restaurants SET invite_code = ?, updated_at = ? WHERE id = ?')
    .bind(code, Date.now(), a.user.restaurant_id).run();
  await writeAudit(env, a.ctx, 'restaurant.invite.rotate', 'restaurant', { code });
  return json({ ok: true, inviteCode: code });
}
