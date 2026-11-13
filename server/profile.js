/* ============================================================
   RASA Restaurant OS — Profil pribadi pengguna (user_profile)
   Terpisah dari identitas restoran (tabel restaurants + workspace):
   - foto profil pribadi (users.avatar)
   - nama tampilan (users.name)
   - telepon pribadi (users.phone)
   - preferensi tema pribadi (users.theme)
   - jabatan/role & email TIDAK bisa diubah lewat jalur ini
     (role oleh Owner lewat Staf & Role; email hanya kebijakan Owner)
   Setiap akun HANYA bisa membaca/mengubah dirinya sendiri, dan semua
   perubahan dicatat ke audit log.
   ============================================================ */

import { json, err, clean, readJson, maskEmail } from './lib.js';
import { requireAuth, publicUser } from './auth.js';
import { RESTAURANT_IDENTITY_KEYS } from './permissions.js';
import { writeAudit } from './audit.js';

const DB = env => env.rasa_restaurant_os_db;

const ALLOWED = ['name', 'phone', 'theme', 'avatar'];
const THEME_RE = /^[a-z0-9-]{0,30}$/;
const PHOTO_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO = 900000;   /* ≈ 675 KB base64 — foto sudah dipotong persegi 320px di klien */

function profilePayload(u) {
  return {
    id: u.id, restaurantId: u.restaurant_id, email: u.email,
    name: u.name || '', phone: u.phone || '', role: u.role,
    avatar: u.avatar || '', theme: u.theme || '', status: u.status,
    outletId: u.outlet_id || '', createdAt: u.created_at, lastLoginAt: u.last_login_at
  };
}

/* ---------- GET /api/profile — profil pribadi milik sesi aktif ---------- */
export async function getProfile(req, env) {
  const a = await requireAuth(req, env);
  return json({
    ok: true,
    profile: profilePayload(a.user),
    user: publicUser(a.user),
    session: {
      device: a.session.device, createdAt: a.session.created_at,
      expiresAt: a.session.expires_at
    }
  });
}

/* ---------- PUT /api/profile — hanya field profil pribadi yang diizinkan ---------- */
export async function updateProfile(req, env) {
  const a = await requireAuth(req, env);
  const body = await readJson(req);
  const u = a.user;

  /* 1. tolak setiap field di luar profil pribadi — termasuk percobaan
        mengubah identitas restoran, role, atau email langsung lewat API. */
  const extra = Object.keys(body || {}).filter(k => ALLOWED.indexOf(k) < 0);
  if (extra.length) {
    const k = extra[0];
    if (k === 'role') return err('Role dan permission tidak dapat diubah dari profil pribadi.', 403, { code: 'forbidden_field', field: 'role' });
    if (k === 'email') return err('Email akun hanya dapat diubah oleh Owner.', 403, { code: 'forbidden_field', field: 'email' });
    if (RESTAURANT_IDENTITY_KEYS.indexOf(k) >= 0) {
      return err('Identitas restoran hanya dapat diubah oleh Owner.', 403, { code: 'owner_only', field: k });
    }
    return err('Field profil tidak dikenal: ' + k + '.', 400, { field: k });
  }

  const changes = {};
  let nextName = null, nextPhone = null, nextTheme = null, nextAvatar = null;

  if (body.name !== undefined) {
    const v = clean(body.name, 60);
    if (!v) return err('Nama tampilan tidak boleh kosong.', 400, { field: 'name' });
    if (v !== String(u.name || '')) { nextName = v; changes.name = v; }
  }
  if (body.phone !== undefined) {
    const v = clean(body.phone, 24);
    if (v !== String(u.phone || '')) { nextPhone = v; changes.phone = v; }
  }
  if (body.theme !== undefined) {
    const v = clean(body.theme, 30);
    if (v && !THEME_RE.test(v)) return err('Tema pribadi tidak dikenal.', 400, { field: 'theme' });
    if (v !== String(u.theme || '')) { nextTheme = v; changes.theme = v || '(ikut restoran)'; }
  }
  if (body.avatar !== undefined) {
    const v = String(body.avatar == null ? '' : body.avatar);
    if (v) {
      if (!PHOTO_RE.test(v) || v.length > MAX_PHOTO) {
        return err('Foto profil tidak valid — pakai gambar JPG/PNG hasil potongan (maksimal ± 675 KB).', 400, { field: 'avatar' });
      }
    }
    if (v !== String(u.avatar || '')) {
      nextAvatar = v;
      changes.photo = v ? 'updated' : 'removed';   /* jangan simpan data URL ke audit */
    }
  }

  if (!Object.keys(changes).length) return json({ ok: true, profile: profilePayload(u), changes: {} });

  const sets = [], binds = [];
  if (nextName !== null) { sets.push('name = ?'); binds.push(nextName); }
  if (nextPhone !== null) { sets.push('phone = ?'); binds.push(nextPhone); }
  if (nextTheme !== null) { sets.push('theme = ?'); binds.push(nextTheme); }
  if (nextAvatar !== null) { sets.push('avatar = ?'); binds.push(nextAvatar); }
  binds.push(u.id, u.restaurant_id);
  await DB(env).prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ? AND restaurant_id = ?')
    .bind(...binds).run();

  const fresh = await DB(env).prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
  await writeAudit(env, a.ctx, 'profile.update', 'user_profile', {
    id: u.id, changes, email: maskEmail(u.email)
  });
  return json({ ok: true, profile: profilePayload(fresh), user: publicUser(fresh), changes });
}

/* ---------- POST /api/auth/logout-all — cabut SELURUH sesi akun ini ---------- */
export async function logoutAllSessions(req, env) {
  const a = await requireAuth(req, env);
  const now = Date.now();
  const r = await DB(env).prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at = 0')
    .bind(now, a.user.id).run();
  await writeAudit(env, a.ctx, 'auth.logout_all', 'session', {
    revoked: (r && r.meta && r.meta.changes) || 0, device: a.session.device
  });
  return json({ ok: true, revoked: (r && r.meta && r.meta.changes) || 0 });
}
