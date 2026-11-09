/* ============================================================
   RASA Restaurant OS — Undangan staf lewat email (Gmail)
   Owner/manager mengundang calon staf dengan alamat Gmail dan
   peran tertentu. Undangan berstatus `pending` sampai pemilik
   alamat email yang sama menekan Terima / Tolak di aplikasi.
   - Keanggotaan staf TIDAK dibuat sebelum undangan diterima
   - Hanya pemilik alamat email undangan yang boleh merespons
   - Undangan yang sudah diterima/ditolak tidak bisa diproses ulang
   - Bila akun belum ada, undangan tetap tersimpan (pending) dan
     tampil setelah pemilik email mendaftar + masuk
   Otorisasi mengikuti sistem yang ada: pembuatan/pembatalan
   memakai izin modul `staff` (create/read/delete) yang dicek di
   worker dan divalidasi ulang oleh requireAuth di tiap endpoint.
   ============================================================ */

import { json, err, rid, normEmail, clean, readJson, maskEmail } from './lib.js';
import { ROLES, roleLabel } from './permissions.js';
import { requireAuth, loadPerms, publicUser, publicRestaurant, DEFAULT_BRAND, brandContact } from './auth.js';
import { writeAudit } from './audit.js';

const DB = env => env.rasa_restaurant_os_db;

/* ---------- migrasi ringan: tabel dibuat bila belum ada ----------
   Pola yang sama dengan user_perms di auth.js, sehingga fitur ini
   langsung jalan di database yang sudah ada tanpa migrasi manual. */
let invitesReady = false;
async function ensureInvites(env) {
  if (invitesReady) return;
  try {
    await DB(env).prepare(
      `CREATE TABLE IF NOT EXISTS staff_invitations (
         id              TEXT PRIMARY KEY,
         restaurant_id   TEXT NOT NULL,
         email           TEXT NOT NULL,
         role            TEXT NOT NULL DEFAULT 'waiter',
         status          TEXT NOT NULL DEFAULT 'pending',
         invited_by      TEXT NOT NULL DEFAULT '',
         invited_by_name TEXT NOT NULL DEFAULT '',
         note            TEXT NOT NULL DEFAULT '',
         created_at      INTEGER NOT NULL,
         responded_at    INTEGER NOT NULL DEFAULT 0
       )`
    ).run();
    await DB(env).prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_pending
       ON staff_invitations(restaurant_id, email) WHERE status = 'pending'`
    ).run().catch(() => {});
  } catch (e) {
    console.log('invites-create-failed', String(e && e.message));
  }
  invitesReady = true;
}

const STATUS_LABEL = { pending: 'Menunggu', accepted: 'Diterima', rejected: 'Ditolak' };

function publicInvite(row, withRestaurant) {
  if (!row) return null;
  const out = {
    id: row.id,
    restaurantId: row.restaurant_id,
    email: row.email,
    role: row.role,
    roleLabel: roleLabel(row.role),
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    invitedBy: row.invited_by,
    invitedByName: row.invited_by_name,
    note: row.note || '',
    createdAt: row.created_at,
    respondedAt: row.responded_at || 0
  };
  if (withRestaurant && row.restaurant_name !== undefined) out.restaurantName = row.restaurant_name || '';
  return out;
}

/* ---------- pengiriman email undangan (best-effort, pola sama dengan OTP)
   Bila RESEND_API_KEY belum dipasang, undangan tetap tersimpan dan
   tampil sebagai notifikasi di aplikasi ketika calon staf masuk. */
async function deliverInvite(env, email, restaurantName, role, inviterName, restaurantId) {
  const key = env.RESEND_API_KEY;
  if (!key) return 'app';
  const brand = (restaurantName || '').trim() || DEFAULT_BRAND;
  const contact = await brandContact(env, restaurantId || '');
  const from = clean(env.OTP_FROM, 120) ||
    ('"' + brand.replace(/["\\<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) + '" <onboarding@resend.dev>');
  const e = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const origin = [brand, contact.address, contact.phone ? 'Telp/WA: ' + contact.phone : '', contact.website]
    .filter(Boolean).join('\n');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Undangan staf ' + brand + ' — RASA Restaurant OS',
        text:
          'Anda diundang untuk menjadi Staf di ' + brand + ' sebagai ' + (roleLabel(role) || role) + '.\n' +
          (inviterName ? 'Diundang oleh: ' + inviterName + '\n' : '') +
          '\nAsal notifikasi:\n' + origin + '\n' +
          '\nMasuk ke aplikasi dengan email ini, lalu tekan Terima atau Tolak pada notifikasi undangan.',
        html:
          '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827">' +
          '<div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#a97c2c;font-weight:700">RASA Restaurant OS</div>' +
          '<h2 style="margin:14px 0 6px;font-size:20px">Undangan staf ' + e(brand) + '</h2>' +
          '<p style="font-size:14px;color:#374151;margin:6px 0">Anda diundang menjadi <b>' + e(roleLabel(role) || role) + '</b>' +
          (inviterName ? ' oleh <b>' + e(inviterName) + '</b>' : '') + '.</p>' +
          '<div style="margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:13px"><b>Asal notifikasi</b>' +
          '<div style="font-weight:700">' + e(brand) + '</div>' +
          (contact.address ? '<div style="color:#6b7280">' + e(contact.address) + '</div>' : '') +
          (contact.phone ? '<div style="color:#6b7280">' + e(contact.phone) + '</div>' : '') +
          (contact.website ? '<div style="color:#6b7280">' + e(contact.website) + '</div>' : '') +
          '</div>' +
          '<div style="margin-top:14px;font-size:12px;color:#9ca3af">Masuk ke aplikasi dengan email ini, lalu tekan Terima atau Tolak pada notifikasi undangan.</div>' +
          '</div>'
      })
    });
    if (res.ok) return 'email';
    console.log('invite-email-failed', res.status, await res.text());
  } catch (e) {
    console.log('invite-email-error', String(e && e.message));
  }
  return 'app';
}

/* ============================================================
   POST /api/invitations — buat undangan (izins: staff:create)
   body: { email, role, note? }
   ============================================================ */
export async function createInvite(req, env, a) {
  await ensureInvites(env);
  const body = await readJson(req, 8192);
  const email = normEmail(body.email);
  const role = clean(body.role, 20);
  const note = clean(body.note, 120);

  if (!email) return err('Format email tidak valid.', 400, { field: 'email' });
  if (!ROLES.some(r => r.id === role)) return err('Role tidak dikenal.', 400, { field: 'role' });
  if (role === 'owner' && a.user.role !== 'owner') {
    return err('Hanya owner yang boleh mengundang sebagai owner.', 403, { field: 'role' });
  }
  if (email === String(a.user.email || '').toLowerCase()) {
    return err('Tidak bisa mengundang alamat email sendiri.', 409, { field: 'email' });
  }

  /* email sudah punya akun di restoran ini -> bukan undangan, sudah staf */
  const exists = await DB(env).prepare('SELECT id,restaurant_id FROM users WHERE email = ?').bind(email).first();
  if (exists && exists.restaurant_id === a.user.restaurant_id) {
    return err('Email ini sudah terdaftar sebagai staf restoran Anda.', 409, { field: 'email' });
  }

  /* satu undangan pending per email per restoran */
  const pending = await DB(env)
    .prepare("SELECT id FROM staff_invitations WHERE restaurant_id = ? AND email = ? AND status = 'pending'")
    .bind(a.user.restaurant_id, email).first();
  if (pending) {
    return err('Undangan untuk email ini masih menunggu jawaban. Batalkan dulu bila ingin mengundang ulang.', 409, {
      code: 'pending_exists', field: 'email', invitationId: pending.id
    });
  }

  const now = Date.now();
  const id = rid('inv');
  await DB(env).prepare(
    `INSERT INTO staff_invitations (id,restaurant_id,email,role,status,invited_by,invited_by_name,note,created_at,responded_at)
     VALUES (?,?,?,?, 'pending', ?,?,?,?,0)`
  ).bind(id, a.user.restaurant_id, email, role, a.user.id, a.user.name || a.user.email || '', note, now).run();

  const restaurant = await DB(env).prepare('SELECT id,name FROM restaurants WHERE id = ?').bind(a.user.restaurant_id).first();
  const inviterName = a.user.name || a.user.email || '';
  const channel = await deliverInvite(env, email, (restaurant && restaurant.name) || '', role, inviterName, (restaurant && restaurant.id) || '');

  await writeAudit(env, a.ctx, 'staff.invite.create', 'staff_invitation', {
    invitationId: id, email: maskEmail(email), role, roleLabel: roleLabel(role), delivery: channel
  });

  const row = await DB(env).prepare('SELECT * FROM staff_invitations WHERE id = ?').bind(id).first();
  return json({ ok: true, invitation: publicInvite(row), delivery: channel });
}

/* ============================================================
   GET /api/invitations — daftar undangan restoran ini (izins: staff:read)
   ============================================================ */
export async function listInvites(req, env, a) {
  await ensureInvites(env);
  const rows = await DB(env)
    .prepare('SELECT * FROM staff_invitations WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 200')
    .bind(a.user.restaurant_id).all();
  const items = (rows.results || []).map(r => publicInvite(r));
  const pending = items.filter(i => i.status === 'pending').length;
  return json({ ok: true, items, pending });
}

/* ============================================================
   DELETE /api/invitations/:id — batalkan undangan pending (izins: staff:delete)
   Riwayat pembatalan tetap tercatat di audit log.
   ============================================================ */
export async function revokeInvite(req, env, a, id) {
  await ensureInvites(env);
  const inv = await DB(env)
    .prepare('SELECT * FROM staff_invitations WHERE id = ? AND restaurant_id = ?')
    .bind(String(id || ''), a.user.restaurant_id).first();
  if (!inv) return err('Undangan tidak ditemukan.', 404);
  if (inv.status !== 'pending') {
    return err('Undangan ini sudah diproses (' + (STATUS_LABEL[inv.status] || inv.status) + ') dan tidak bisa dibatalkan.', 409, {
      code: 'already_processed', status: inv.status
    });
  }
  await DB(env).prepare('DELETE FROM staff_invitations WHERE id = ? AND status = ?').bind(inv.id, 'pending').run();
  await writeAudit(env, a.ctx, 'staff.invite.revoke', 'staff_invitation', {
    invitationId: inv.id, email: maskEmail(inv.email), role: inv.role, roleLabel: roleLabel(inv.role)
  });
  return json({ ok: true, id: inv.id, status: 'revoked' });
}

/* ============================================================
   GET /api/invitations/mine — undangan untuk email yang sedang masuk
   Hanya mengembalikan undangan yang alamat emailnya COKOK dengan akun
   aktif; undangan orang lain tidak pernah dikirim ke klien ini.
   ============================================================ */
export async function myInvites(req, env) {
  await ensureInvites(env);
  const a = await requireAuth(req, env);
  const email = String(a.user.email || '').toLowerCase();
  const rows = await DB(env).prepare(
    `SELECT i.*, r.name AS restaurant_name
     FROM staff_invitations i LEFT JOIN restaurants r ON r.id = i.restaurant_id
     WHERE i.email = ? ORDER BY i.created_at DESC LIMIT 20`
  ).bind(email).all();
  const all = (rows.results || []).map(r => publicInvite(r, true));
  return json({
    ok: true,
    items: all.filter(i => i.status === 'pending'),
    history: all.filter(i => i.status !== 'pending').slice(0, 5)
  });
}

/* ============================================================
   POST /api/invitations/:id/accept | /reject — tanggapan pemilik email
   Keamanan yang ditegakkan di sini:
   - email sesi harus sama dengan email undangan (403 bila bukan miliknya)
   - hanya undangan berstatus `pending` (409 bila sudah diproses)
   - UPDATE memakai syarat status='pending' sehingga proses ganda
     tidak pernah menggandakan keanggotaan (dicek lewat jumlah baris)
   ============================================================ */
export async function respondInvite(req, env, a, id, action) {
  await ensureInvites(env);
  const inv = await DB(env).prepare('SELECT * FROM staff_invitations WHERE id = ?').bind(String(id || '')).first();
  if (!inv) return err('Undangan tidak ditemukan.', 404);

  const myEmail = String(a.user.email || '').toLowerCase();
  /* audit tanggapan dicatat pada restoran PENGIUNDANG — pemilik yang
     melihat riwayat undangannya; identitas pelaku tetap dari sesi */
  const invCtx = Object.assign({}, a.ctx, { restaurantId: inv.restaurant_id });
  if (inv.email !== myEmail) {
    await writeAudit(env, invCtx, 'staff.invite.denied', 'staff_invitation', {
      invitationId: inv.id, email: maskEmail(inv.email), by: a.user.id
    });
    return err('Undangan ini bukan milik alamat email Anda.', 403, { code: 'not_owner' });
  }
  if (inv.status !== 'pending') {
    return err('Undangan ini sudah pernah diproses (' + (STATUS_LABEL[inv.status] || inv.status) + ').', 409, {
      code: 'already_processed', status: inv.status
    });
  }

  const now = Date.now();

  /* ---------- Tolak: status saja, tanpa keanggotaan ---------- */
  if (action === 'reject') {
    const okClaim = await claimInvite(env, inv.id, 'rejected', now);
    if (!okClaim) return err('Undangan ini sudah pernah diproses.', 409, { code: 'already_processed' });
    await writeAudit(env, invCtx, 'staff.invite.reject', 'staff_invitation', {
      invitationId: inv.id, role: inv.role, roleLabel: roleLabel(inv.role), by: a.user.id
    });
    return json({ ok: true, id: inv.id, status: 'rejected' });
  }

  /* ---------- Terima: tandai undangan + pindahkan akun ke restoran pengundang ---------- */
  const target = await DB(env).prepare('SELECT id,name FROM restaurants WHERE id = ?').bind(inv.restaurant_id).first();
  if (!target) return err('Restoran pengundang sudah tidak tersedia. Hubungi pemilik restoran.', 404, { code: 'restaurant_missing' });

  /* syarat status='pending' = kunci anti-proses-ganda */
  const okClaim = await claimInvite(env, inv.id, 'accepted', now);
  if (!okClaim) return err('Undangan ini sudah pernah diproses.', 409, { code: 'already_processed' });

  /* outlet utama restoran tujuan (bukan outlet lama) */
  const main = await DB(env).prepare('SELECT id FROM outlets WHERE restaurant_id = ? AND is_main = 1').bind(inv.restaurant_id).first();
  const outletId = main ? main.id : '';

  const fromRestaurant = a.user.restaurant_id;
  await DB(env).batch([
    DB(env).prepare(
      `UPDATE users SET restaurant_id = ?, role = ?, outlet_id = ?, status = 'active'
       WHERE id = ? AND email = ?`
    ).bind(inv.restaurant_id, inv.role, outletId, a.user.id, inv.email),
    /* wewenang khusus restoran lama tidak ikut terbawa */
    DB(env).prepare('DELETE FROM user_perms WHERE restaurant_id = ? AND user_id = ?').bind(fromRestaurant, a.user.id)
  ]);

  await writeAudit(env, invCtx, 'staff.invite.accept', 'staff_invitation', {
    invitationId: inv.id, role: inv.role, roleLabel: roleLabel(inv.role),
    fromRestaurant, toRestaurant: inv.restaurant_id, restaurant: target.name, by: a.user.id
  });

  /* izin efektif baru + identitas segar: sesi lama langsung memakai
     peran baru tanpa perlu login ulang (izin dibaca ulang tiap request) */
  const user = await DB(env).prepare('SELECT * FROM users WHERE id = ?').bind(a.user.id).first();
  const perms = await loadPerms(env, user.restaurant_id, user.role, user.id);
  const restaurant = await DB(env).prepare('SELECT * FROM restaurants WHERE id = ?').bind(user.restaurant_id).first();

  return json({
    ok: true,
    id: inv.id,
    status: 'accepted',
    user: publicUser(user),
    restaurant: publicRestaurant(restaurant),
    permissions: perms
  });
}

/* Klaim status undangan secara atomik: UPDATE hanya bila masih `pending`.
   Jumlah baris yang berubah membuktikan kamilah yang pertama memproses —
   undangan tidak bisa diterima/ditolak dua kali. Bila runtime tidak
   melaporkan jumlah baris, jatuh ke pemeriksaan baris ulang. */
async function claimInvite(env, id, status, now) {
  const res = await DB(env)
    .prepare("UPDATE staff_invitations SET status = ?, responded_at = ? WHERE id = ? AND status = 'pending'")
    .bind(status, now, id).run();
  const meta = res && res.meta;
  if (meta && typeof meta.changes === 'number') return meta.changes > 0;
  const row = await DB(env).prepare('SELECT status FROM staff_invitations WHERE id = ?').bind(id).first();
  return !!row && row.status === status;
}
