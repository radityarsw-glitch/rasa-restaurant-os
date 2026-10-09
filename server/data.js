/* ============================================================
   RASA Restaurant OS — Penyimpanan data terpusat (sinkronisasi)
   Satu workspace JSON per Restaurant ID. Setiap PUT dicek
   permission-nya per modul di backend, lalu dicatat ke audit log.
   ============================================================ */

import { json, err, readJson, clean, MAX_PAYLOAD } from './lib.js';
import { can, moduleOfKey } from './permissions.js';
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
      if (!Array.isArray(r.items)) return 'daftar bahan tidak valid';
      if (r.items.length > 100) return 'maksimal 100 bahan per resep';
      for (const it of r.items) {
        if (!it || typeof it !== 'object') return 'baris bahan resep tidak valid';
        if (!isId(it.invId)) return 'id bahan tidak valid';
        if (!isNum(it.qty, 0.000001, 1e6)) return 'takaran harus angka lebih dari 0';
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
    ownerRole: 40, lat: 20, lng: 20, theme: 30
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
    /* Workspace "Antar Ke Meja" (modul 'antar') juga menulis key pesanan:
       Acc & antar / Sampai di meja cukup berwewenang antar — modul 'orders'
       tetap yang utama; keduanya berlaku sebagai izin alternatif. */
    if (mod !== 'misc' && !can(a.perms, mod, 'update') &&
        !(mod === 'orders' && can(a.perms, 'antar', 'update'))) {
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
      denied: denied.map(d => d.module + ':' + d.key).slice(0, 20),
      invalid: invalid.map(x => x.key).slice(0, 20),
      bytes: JSON.stringify(merged).length
    });
  }

  if (denied.length) {
    await writeAudit(env, a.ctx, 'permission.denied', 'workspace', {
      denied: denied.map(d => d.module + ':' + d.key).slice(0, 20)
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
