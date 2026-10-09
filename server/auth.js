/* ============================================================
   RASA Restaurant OS — Autentikasi akun, OTP, dan sesi
   Alur: email -> kode OTP (5 menit, sekali pakai) -> token sesi.
   OTP tidak pernah dijadikan identitas permanen; identitas selalu
   User ID + Restaurant ID + Outlet ID.
   ============================================================ */

import {
  json, err, sha256, safeEqual, randomToken, randomDigits, rid,
  normEmail, clean, readJson, deviceOf, ipOf, tokenFrom, maskEmail
} from './lib.js';
import {
  matrixFor, matrixToRows, ROLES, roleLabel, MODULES,
  applyUserOverrides, userPermsToRows, diffFromRole, ACTIONS
} from './permissions.js';
import { writeAudit } from './audit.js';

const DB = env => env.rasa_restaurant_os_db;

export const OTP_TTL = 5 * 60 * 1000;        /* masa berlaku 5 menit */
const OTP_MAX_ATTEMPTS = 5;
const OTP_WINDOW = 15 * 60 * 1000;
const OTP_MAX_PER_WINDOW = 5;
export const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; /* 30 hari */

/* ============================================================
   Konteks sesi — dipakai semua endpoint sebagai penjaga akses
   ============================================================ */
export async function authContext(req, env) {
  const token = tokenFrom(req);
  if (!token || token.length < 20) return null;
  const hash = await sha256(token);
  const s = await DB(env).prepare('SELECT * FROM sessions WHERE token_hash = ?').bind(hash).first();
  if (!s) return null;
  if (s.revoked_at) return null;
  const now = Date.now();
  if (s.expires_at <= now) return null;
  const u = await DB(env).prepare('SELECT * FROM users WHERE id = ?').bind(s.user_id).first();
  if (!u || u.status !== 'active') return null;

  /* perpanjangan bergeser (sliding) — hanya bila tinggal setengah masa berlaku */
  if (s.expires_at - now < SESSION_TTL / 2) {
    await DB(env)
      .prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?')
      .bind(now + SESSION_TTL, now, hash).run().catch(() => {});
  }

  const perms = await loadPerms(env, u.restaurant_id, u.role, u.id);
  return {
    token, hash, session: s, user: u, perms,
    ctx: {
      userId: u.id, userName: u.name || u.email, role: u.role,
      restaurantId: u.restaurant_id, outletId: u.outlet_id || '',
      device: s.device, ip: s.ip, sessionId: hash.slice(0, 24)
    }
  };
}

/* Izin efektif = matriks role + wewenang khusus staf (user_perms).
   Selalu dibaca ulang dari database setiap request sehingga perubahan
   yang dibuat Owner langsung berlaku — tanpa staf perlu login ulang. */
let userPermsReady = false;
async function ensureUserPerms(env) {
  if (userPermsReady) return;
  try {
    await DB(env).prepare(
      `CREATE TABLE IF NOT EXISTS user_perms (
         restaurant_id TEXT NOT NULL,
         user_id       TEXT NOT NULL,
         module        TEXT NOT NULL,
         actions       TEXT NOT NULL DEFAULT '[]',
         updated_at    INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (restaurant_id, user_id, module)
       )`
    ).run();
  } catch (e) {
    console.log('user-perms-create-failed', String(e && e.message));
  }
  userPermsReady = true;
}

export async function loadPerms(env, restaurantId, role, userId) {
  let base;
  if (role === 'owner') {
    base = matrixFor('owner', null);
  } else {
    let rows = [];
    if (restaurantId) {
      try {
        const r = await DB(env)
          .prepare('SELECT role,module,outlet_id,actions FROM role_perms WHERE restaurant_id = ? AND role = ?')
          .bind(restaurantId, role).all();
        rows = r.results || [];
      } catch (e) { rows = []; }
    }
    base = matrixFor(role, rows);
  }
  if (role === 'owner' || !userId || !restaurantId) return base;

  await ensureUserPerms(env);
  try {
    const r = await DB(env)
      .prepare('SELECT module,actions FROM user_perms WHERE restaurant_id = ? AND user_id = ?')
      .bind(restaurantId, userId).all();
    return applyUserOverrides(base, r.results || []);
  } catch (e) {
    console.log('user-perms-read-failed', String(e && e.message));
    return base;
  }
}

/* wajib login — melempar Response 401 bila tidak valid */
export async function requireAuth(req, env) {
  const a = await authContext(req, env);
  if (!a) throw err('Sesi tidak valid atau sudah berakhir. Silakan masuk kembali.', 401);
  return a;
}

/* wajib memiliki izin — melempar Response 403 */
export function requirePerm(a, module, action) {
  const ok = module === 'misc' ? true : Array.isArray(a.perms[module]) && a.perms[module].indexOf(action) >= 0;
  if (!ok) throw err('Anda tidak memiliki izin untuk tindakan ini (' + module + ':' + action + ').', 403, { module, action });
}

/* ============================================================
   Pengiriman OTP — layar (default) atau email bila RESEND_API_KEY ada
   ============================================================ */
async function deliverOtp(env, email, code, purpose) {
  const key = env.RESEND_API_KEY;
  if (key) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.OTP_FROM || 'RASA Restaurant OS <onboarding@resend.dev>',
          to: [email],
          subject: code + ' adalah kode OTP Anda — RASA Restaurant OS',
          text:
            'Kode verifikasi Anda: ' + code + '\n\n' +
            'Berlaku 5 menit dan hanya bisa dipakai satu kali. ' +
            (purpose === 'register' ? 'Kode ini dipakai untuk membuat akun baru.' : 'Kode ini dipakai untuk masuk ke akun Anda.') +
            '\n\nJika Anda tidak meminta kode ini, abaikan email ini.'
        })
      });
      if (res.ok) return 'email';
      console.log('otp-email-failed', res.status, await res.text());
    } catch (e) {
      console.log('otp-email-error', String(e && e.message));
    }
  }
  return 'screen';
}

/* ============================================================
   Permintaan OTP
   ============================================================ */
export async function requestOtp(req, env) {
  const body = await readJson(req);
  const email = normEmail(body.email);
  if (!email) return err('Format email tidak valid.', 400, { field: 'email' });

  let purpose = clean(body.purpose, 20) || 'login';
  if (['register', 'login', 'sensitive'].indexOf(purpose) < 0) purpose = 'login';

  const invite = clean(body.invite, 24);
  const name = clean(body.name, 60);
  const resto = clean(body.resto, 60);
  const roleReq = clean(body.role, 20);

  const user = await DB(env).prepare('SELECT * FROM users WHERE email = ?').bind(email).first();

  if (purpose === 'register' && user) {
    /* email sudah punya akun -> lanjutkan sebagai login agar pengalaman mulus */
    purpose = 'login';
  }
  if (purpose === 'login' && !user) {
    return err('Email belum terdaftar. Buat akun baru terlebih dahulu.', 404, { code: 'not_found', field: 'email' });
  }

  /* undangan restoran: bila kode cocok, pendaftar bergabung ke restoran itu */
  let inviteRestaurant = null;
  if (invite) {
    inviteRestaurant = await DB(env)
      .prepare('SELECT id,name,invite_code FROM restaurants WHERE invite_code = ?')
      .bind(invite.toUpperCase()).first();
    if (!inviteRestaurant) return err('Kode undangan tidak dikenali.', 404, { field: 'invite' });
  }

  /* throttle: maksimal 5 permintaan per email dalam 15 menit */
  const now = Date.now();
  const th = await DB(env).prepare('SELECT * FROM otp_throttle WHERE email = ?').bind(email).first();
  let count = (!th || now - (th.window_at || 0) > OTP_WINDOW) ? 1 : (th.count || 0) + 1;
  if (count > OTP_MAX_PER_WINDOW) {
    return err('Terlalu banyak permintaan kode. Coba lagi dalam 15 menit.', 429, { code: 'throttled' });
  }
  await DB(env).prepare(
    `INSERT INTO otp_throttle (email,window_at,count) VALUES (?,?,1)
     ON CONFLICT(email) DO UPDATE SET window_at = CASE WHEN otp_throttle.window_at < ? THEN ? ELSE otp_throttle.window_at END,
                                      count = CASE WHEN otp_throttle.window_at < ? THEN 1 ELSE otp_throttle.count + 1 END`
  ).bind(email, now, now, now, now).run();

  /* kode OTP 6 digit — disimpan sebagai hash, sekali pakai, punya masa berlaku */
  const code = randomDigits(6);
  const id = rid('otp');
  const payload = JSON.stringify({
    purpose,
    name: name || (user && user.name) || '',
    resto,
    role: purpose === 'register' ? (ROLES.some(r => r.id === roleReq) && roleReq !== 'owner' ? roleReq : (inviteRestaurant ? 'waiter' : 'owner')) : '',
    invite: inviteRestaurant ? inviteRestaurant.id : '',
    inviteName: inviteRestaurant ? inviteRestaurant.name : ''
  });

  /* OTP lama yang belum dipakai untuk email+purpose sama dibatalkan */
  await DB(env)
    .prepare('UPDATE otp_codes SET used_at = ? WHERE email = ? AND purpose = ? AND used_at = 0 AND expires_at > ?')
    .bind(now, email, purpose, now).run();

  await DB(env).prepare(
    `INSERT INTO otp_codes (id,email,code_hash,purpose,payload,channel,attempts,expires_at,used_at,created_at)
     VALUES (?,?,?,?,?, 'screen', 0, ?, 0, ?)`
  ).bind(id, email, await sha256(id + ':' + email + ':' + code), purpose, payload, now + OTP_TTL, now).run();

  const channel = await deliverOtp(env, email, code, purpose);

  return json({
    ok: true,
    email,
    purpose,
    delivery: channel,
    expiresAt: now + OTP_TTL,
    /* kode hanya dikembalikan bila pengiriman lewat layar (belum ada layanan email) */
    otp: channel === 'screen' ? code : null
  });
}

/* ============================================================
   Verifikasi OTP -> sesi token
   ============================================================ */
export async function verifyOtp(req, env) {
  const body = await readJson(req);
  const email = normEmail(body.email);
  const code = String(body.code || '').replace(/\D/g, '');
  if (!email) return err('Format email tidak valid.', 400, { field: 'email' });
  if (code.length !== 6) return err('Kode OTP harus 6 digit.', 400, { field: 'code' });

  const now = Date.now();
  const row = await DB(env)
    .prepare('SELECT * FROM otp_codes WHERE email = ? AND used_at = 0 ORDER BY created_at DESC LIMIT 1')
    .bind(email).first();

  if (!row) return err('Kode OTP tidak ditemukan atau sudah dipakai. Minta kode baru.', 404, { code: 'otp_missing' });
  if (row.expires_at <= now) return err('Kode OTP kedaluwarsa. Minta kode baru.', 410, { code: 'otp_expired' });
  if ((row.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    await DB(env).prepare('UPDATE otp_codes SET used_at = ? WHERE id = ?').bind(now, row.id).run();
    return err('Kode OTP terlalu banyak salah percobaan. Minta kode baru.', 429, { code: 'otp_locked' });
  }

  const ok = await safeEqual(row.code_hash, await sha256(row.id + ':' + email + ':' + code));
  if (!ok) {
    await DB(env).prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    const left = OTP_MAX_ATTEMPTS - ((row.attempts || 0) + 1);
    return err('Kode OTP salah. Sisa percobaan: ' + Math.max(0, left) + '.', 401, { code: 'otp_wrong', attemptsLeft: Math.max(0, left) });
  }

  /* OTP ditandai terpakai — tidak boleh bisa dipakai lagi */
  await DB(env).prepare('UPDATE otp_codes SET used_at = ? WHERE id = ? AND used_at = 0').bind(now, row.id).run();
  const meta = safeParse(row.payload) || {};

  let user = await DB(env).prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const reqDevice = deviceOf(req), reqIp = ipOf(req);

  if (row.purpose === 'register' && !user) {
    const restoName = clean(meta.resto, 60);
    const created = await createRestaurant(env, {
      email,
      name: clean(meta.name, 60) || email.split('@')[0],
      resto: restoName,
      role: meta.role || 'owner',
      invite: meta.invite || ''
    });
    user = created.user;
    await writeAudit(env, {
      userId: user.id, userName: user.name, role: user.role,
      restaurantId: user.restaurant_id, outletId: user.outlet_id,
      device: reqDevice, ip: reqIp, sessionId: 'otp:' + row.id
    }, 'auth.register', 'user', { email: maskEmail(email), restaurant: (created.restaurant && created.restaurant.name) || restoName });
  }

  if (!user) return err('Akun tidak ditemukan. Daftar terlebih dahulu.', 404, { code: 'not_found' });
  if (user.status !== 'active') return err('Akun dinonaktifkan. Hubungi pemilik restoran.', 403, { code: 'disabled' });

  const token = await createSession(env, user, reqDevice, reqIp);
  await DB(env).prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();

  const perms = await loadPerms(env, user.restaurant_id, user.role, user.id);
  const restaurant = await DB(env).prepare('SELECT * FROM restaurants WHERE id = ?').bind(user.restaurant_id).first();

  await writeAudit(env, {
    userId: user.id, userName: user.name, role: user.role,
    restaurantId: user.restaurant_id, outletId: user.outlet_id,
    device: reqDevice, ip: reqIp, sessionId: 'otp:' + row.id
  }, 'auth.login', 'session', { channel: row.channel, purpose: row.purpose });

  return json({
    ok: true, token,
    user: publicUser(user),
    restaurant: publicRestaurant(restaurant),
    permissions: perms,
    expiresAt: now + SESSION_TTL
  });
}

/* ============================================================
   Pembuatan restoran + akun owner pertama
   ============================================================ */
async function createRestaurant(env, opts) {
  const now = Date.now();
  const userId = rid('usr');

  /* --- bergabung ke restoran lain lewat kode undangan:
     tidak membuat restoran baru — akun langsung menempel ke restoran tujuan --- */
  if (opts.invite) {
    const target = await DB(env).prepare('SELECT id,name FROM restaurants WHERE id = ?').bind(opts.invite).first();
    if (target) {
      const main = await DB(env).prepare('SELECT id FROM outlets WHERE restaurant_id = ? AND is_main = 1').bind(opts.invite).first();
      const outletId = main ? main.id : '';
      await DB(env).prepare(
        `INSERT INTO users (id,restaurant_id,email,name,role,outlet_id,avatar,status,created_at,last_login_at)
         VALUES (?,?,?,?,? ,?,'','active',?,0)`
      ).bind(userId, opts.invite, opts.email, opts.name || '', 'waiter', outletId, now).run();
      const user = await DB(env).prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
      return { user, restaurant: target };
    }
    /* kode tidak valid → jatuh membuat restoran baru sebagai owner */
  }

  /* --- restoran baru: pembuatnya selalu owner --- */
  const restoId = rid('rst');
  const outletId = rid('out');
  const invite = (randomToken(4) + randomToken(4)).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
  const restoName = clean(opts.resto, 60) || opts.email.split('@')[0];

  await DB(env).prepare(
    `INSERT INTO restaurants (id,name,location,lat,lng,logo,owner_id,status,invite_code,settings,created_at,updated_at)
     VALUES (?,?, '', '', '', '', ?, 'buka', ?, '{}', ?, ?)`
  ).bind(restoId, restoName, userId, invite, now, now).run();

  await DB(env).prepare(
    `INSERT INTO outlets (id,restaurant_id,name,location,is_main,created_at) VALUES (?,?,?, '', 1, ?)`
  ).bind(outletId, restoId, 'Outlet Utama', now).run();

  await DB(env).prepare(
    `INSERT INTO users (id,restaurant_id,email,name,role,outlet_id,avatar,status,created_at,last_login_at)
     VALUES (?,?,?,?,?,?,'','active',?,0)`
  ).bind(userId, restoId, opts.email, opts.name || '', 'owner', outletId, now).run();

  await seedPermissions(env, restoId);

  const user = await DB(env).prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  const resto = await DB(env).prepare('SELECT * FROM restaurants WHERE id = ?').bind(user.restaurant_id).first();
  return { user, restaurant: resto };
}

export async function seedPermissions(env, restaurantId) {
  const now = Date.now();
  const rows = [];
  ['manager', 'kasir', 'kitchen', 'waiter'].forEach(role => {
    const matrix = matrixFor(role, null);
    Object.keys(matrix).forEach(mod => {
      rows.push(matrixToRows(role, { [mod]: matrix[mod] })[0]);
    });
  });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await DB(env).prepare(
      `INSERT INTO role_perms (restaurant_id,role,module,outlet_id,actions,updated_at)
       VALUES (?,?,?,?,?,?) ON CONFLICT(restaurant_id,role,module,outlet_id) DO UPDATE SET actions = excluded.actions, updated_at = excluded.updated_at`
    ).bind(restaurantId, r.role, r.module, r.outlet_id, r.actions, now).run();
  }
}

/* ============================================================
   Sesi
   ============================================================ */
async function createSession(env, user, device, ip) {
  const token = randomToken(32);
  const hash = await sha256(token);
  const now = Date.now();
  await DB(env).prepare(
    `INSERT INTO sessions (token_hash,user_id,restaurant_id,outlet_id,device,ip,created_at,last_seen_at,expires_at,revoked_at)
     VALUES (?,?,?,?,?,?,?,?,?,0)`
  ).bind(hash, user.id, user.restaurant_id, user.outlet_id || '', device, ip, now, now, now + SESSION_TTL).run();
  return token;
}

export async function logout(req, env) {
  const a = await authContext(req, env);
  if (!a) return json({ ok: true, message: 'Sesi sudah berakhir.' });
  await DB(env).prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?').bind(Date.now(), a.hash).run();
  await writeAudit(env, a.ctx, 'auth.logout', 'session', { device: a.session.device });
  return json({ ok: true });
}

export async function me(req, env) {
  const a = await authContext(req, env);
  if (!a) return err('Belum masuk.', 401, { code: 'unauthenticated' });
  const restaurant = await DB(env).prepare('SELECT * FROM restaurants WHERE id = ?').bind(a.user.restaurant_id).first();
  return json({
    ok: true,
    user: publicUser(a.user),
    restaurant: publicRestaurant(restaurant),
    permissions: a.perms,
    session: { device: a.session.device, createdAt: a.session.created_at, expiresAt: a.session.expires_at },
    roles: ROLES
  });
}

/* ============================================================
   Manajemen staf oleh owner / manager
   ============================================================ */
export async function addStaff(req, env, a) {
  const body = await readJson(req);
  const email = normEmail(body.email);
  const name = clean(body.name, 60);
  const role = clean(body.role, 20);
  if (!email) return err('Format email tidak valid.', 400, { field: 'email' });
  if (!name) return err('Nama staf wajib diisi.', 400, { field: 'name' });
  if (!ROLES.some(r => r.id === role)) return err('Role tidak dikenal.', 400, { field: 'role' });
  if (role === 'owner' && a.user.role !== 'owner') return err('Hanya owner yang boleh membuat akun owner lain.', 403);

  const exists = await DB(env).prepare('SELECT id,restaurant_id FROM users WHERE email = ?').bind(email).first();
  if (exists) {
    if (exists.restaurant_id === a.user.restaurant_id) return err('Email ini sudah terdaftar di restoran Anda.', 409, { field: 'email' });
    return err('Email sudah dipakai akun lain.', 409, { field: 'email' });
  }

  const now = Date.now();
  const userId = rid('usr');
  await DB(env).prepare(
    `INSERT INTO users (id,restaurant_id,email,name,role,outlet_id,avatar,status,created_at,last_login_at)
     VALUES (?,?,?,?,?,?,'','active',?,0)`
  ).bind(userId, a.user.restaurant_id, email, name, role, a.user.outlet_id || '', now).run();

  const user = await DB(env).prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  await writeAudit(env, a.ctx, 'staff.create', 'user', { email: maskEmail(email), name, role, roleLabel: roleLabel(role) });
  return json({ ok: true, user: publicUser(user) });
}

export async function listStaff(req, env, a) {
  const rows = await DB(env)
    .prepare('SELECT id,email,name,role,outlet_id,status,created_at,last_login_at FROM users WHERE restaurant_id = ? ORDER BY created_at ASC')
    .bind(a.user.restaurant_id).all();
  return json({ ok: true, items: rows.results || [] });
}

export async function updateStaff(req, env, a, id) {
  const body = await readJson(req);
  const target = await DB(env).prepare('SELECT * FROM users WHERE id = ? AND restaurant_id = ?').bind(id, a.user.restaurant_id).first();
  if (!target) return err('Staf tidak ditemukan.', 404);
  const role = clean(body.role, 20);
  const name = clean(body.name, 60);
  const status = clean(body.status, 20);

  if (role && ROLES.some(r => r.id === role) && role !== target.role) {
    if (a.user.role !== 'owner') return err('Hanya owner yang boleh mengubah role.', 403);
    if (target.role === 'owner' && target.id !== a.user.id) {
      const owners = await DB(env).prepare('SELECT COUNT(*) AS c FROM users WHERE restaurant_id = ? AND role = ? AND status = ?')
        .bind(a.user.restaurant_id, 'owner', 'active').first();
      if ((owners && owners.c) <= 1) return err('Tidak bisa mengubah role owner terakhir.', 409);
    }
    await DB(env).prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run();
  }
  if (name) await DB(env).prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, id).run();
  if (status === 'active' || status === 'suspended') {
    if (target.id === a.user.id && status === 'suspended') return err('Tidak bisa menonaktifkan akun sendiri.', 409);
    await DB(env).prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, id).run();
    if (status === 'suspended') {
      await DB(env).prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ?').bind(Date.now(), id).run();
    }
  }
  const user = await DB(env).prepare('SELECT id,email,name,role,outlet_id,status,created_at,last_login_at FROM users WHERE id = ?').bind(id).first();
  await writeAudit(env, a.ctx, 'staff.update', 'user', { id, role: user.role, status: user.status, name: user.name });
  return json({ ok: true, user });
}

export async function removeStaff(req, env, a, id) {
  if (id === a.user.id) return err('Tidak bisa menghapus akun sendiri.', 409);
  const target = await DB(env).prepare('SELECT * FROM users WHERE id = ? AND restaurant_id = ?').bind(id, a.user.restaurant_id).first();
  if (!target) return err('Staf tidak ditemukan.', 404);
  if (target.role === 'owner' && a.user.role !== 'owner') return err('Hanya owner yang boleh menghapus owner.', 403);
  if (target.role === 'owner') {
    const owners = await DB(env).prepare('SELECT COUNT(*) AS c FROM users WHERE restaurant_id = ? AND role = ? AND status = ?')
      .bind(a.user.restaurant_id, 'owner', 'active').first();
    if ((owners && owners.c) <= 1) return err('Tidak bisa menghapus owner terakhir.', 409);
  }
  await DB(env).prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ?').bind(Date.now(), id).run();
  await DB(env).prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await writeAudit(env, a.ctx, 'staff.delete', 'user', { id, email: maskEmail(target.email), role: target.role });
  return json({ ok: true });
}

/* ============================================================
   Permission (hanya owner boleh mengubah)
   Bentuk: users[userId][modul] = [aksi] → wewenang khusus staf
           matrix[role][modul]  = [aksi] → preset dasar per role
                                     (opsional; UI matriks sudah dihapus,
                                      tetap tersedia lewat API untuk
                                      penyetelan preset)
   Setiap modul & aksi yang dikirim DIVALIDASI ULANG oleh server:
   modul harus terdaftar di MODULES dan aksi harus termasuk ACTIONS,
   selain itu permintaan ditolak 400 (bukan diam-diam dibuang).
   ============================================================ */
function validatePermMap(map) {
  const mods = Object.keys(map || {});
  for (const mod of mods) {
    if (!MODULES.some(m => m.id === mod)) return 'Modul tidak dikenal: ' + mod;
    const acts = map[mod];
    if (!Array.isArray(acts)) return 'Daftar aksi pada modul "' + mod + '" tidak valid.';
    for (const act of acts) {
      if (ACTIONS.indexOf(act) < 0) return 'Aksi tidak dikenal pada modul "' + mod + '": ' + act;
    }
  }
  return null;
}

export async function listUserPerms(env, restaurantId) {
  await ensureUserPerms(env);
  try {
    const r = await DB(env)
      .prepare('SELECT user_id,module,actions FROM user_perms WHERE restaurant_id = ?')
      .bind(restaurantId).all();
    const out = {};
    (r.results || []).forEach(row => {
      out[row.user_id] = out[row.user_id] || {};
      out[row.user_id][row.module] = safeList(row.actions);
    });
    return out;
  } catch (e) {
    console.log('user-perms-list-failed', String(e && e.message));
    return {};
  }
}

export async function getPermissions(req, env, a) {
  const rows = await DB(env)
    .prepare('SELECT role,module,outlet_id,actions,updated_at FROM role_perms WHERE restaurant_id = ?')
    .bind(a.user.restaurant_id).all();
  const byRole = {};
  ROLES.forEach(r => { byRole[r.id] = matrixFor(r.id, rows.results || []) });
  const users = await listUserPerms(env, a.user.restaurant_id);
  return json({ ok: true, matrix: byRole, overrides: rows.results || [], users });
}

export async function setPermissions(req, env, a) {
  if (a.user.role !== 'owner') return err('Hanya owner yang boleh mengubah permission.', 403);
  const body = await readJson(req);
  const matrix = body.matrix;
  const users = body.users;
  if (matrix !== undefined && (!matrix || typeof matrix !== 'object' || Array.isArray(matrix))) {
    return err('Format permission tidak valid.', 400, { field: 'matrix' });
  }
  if (users !== undefined && (!users || typeof users !== 'object' || Array.isArray(users))) {
    return err('Format wewenang staf tidak valid.', 400, { field: 'users' });
  }
  const now = Date.now();
  const touched = [];

  /* --- preset per role (opsional, divalidasi ketat) ---
     Kunci `owner` diabaikan: owner selalu memiliki akses penuh dan tidak
     pernah disimpan di role_perms. Role yang tidak dikenal = tolak 400. */
  const roleKeys = matrix ? Object.keys(matrix) : [];
  for (const role of roleKeys) {
    if (role === 'owner') continue;
    if (!ROLES.some(x => x.id === role)) {
      return err('Role tidak dikenal: ' + role, 400, { field: 'matrix.' + role });
    }
    const row = matrix[role];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return err('Format matriks role "' + role + '" tidak valid.', 400, { field: 'matrix.' + role });
    }
    const problem = validatePermMap(row);
    if (problem) return err(problem, 400, { field: 'matrix.' + role });
  }
  const roles = roleKeys.filter(r => r !== 'owner');
  for (const role of roles) {
    const rows = matrixToRows(role, matrix[role]);
    for (const r of rows) {
      await DB(env).prepare(
        `INSERT INTO role_perms (restaurant_id,role,module,outlet_id,actions,updated_at)
         VALUES (?,?,?,?,?,?) ON CONFLICT(restaurant_id,role,module,outlet_id) DO UPDATE SET actions = excluded.actions, updated_at = excluded.updated_at`
      ).bind(a.user.restaurant_id, r.role, r.module, r.outlet_id, r.actions, now).run();
    }
  }

  /* --- wewenang khusus per staf: hanya baris staf yang dikirim yang diganti --- */
  let staffTouched = 0;
  if (users !== undefined && Object.keys(users).length) {
    await ensureUserPerms(env);
    const valid = await DB(env)
      .prepare('SELECT id,role FROM users WHERE restaurant_id = ?')
      .bind(a.user.restaurant_id).all();
    const roleOf = {};
    (valid.results || []).forEach(u => { roleOf[u.id] = u.role });

    const stored = await DB(env)
      .prepare('SELECT role,module,actions FROM role_perms WHERE restaurant_id = ?')
      .bind(a.user.restaurant_id).all();
    const roleRows = stored.results || [];

    const toInsert = [];
    for (const uid of Object.keys(users)) {
      /* staf lain / bukan milik restoran ini → tolak, bukan abaikan */
      if (!roleOf[uid]) return err('Wewenang hanya bisa diatur untuk staf restoran Anda sendiri.', 403, { field: 'users.' + uid });
      if (uid === a.user.id) continue;             /* owner tidak bisa membatasi dirinya sendiri */
      if (roleOf[uid] === 'owner') continue;        /* owner lain selalu penuh */
      const eff = users[uid];
      if (!eff || typeof eff !== 'object' || Array.isArray(eff)) {
        return err('Format wewenang staf tidak valid.', 400, { field: 'users.' + uid });
      }
      const problem = validatePermMap(eff);
      if (problem) return err(problem, 400, { field: 'users.' + uid });
      const roleMatrix = matrixFor(String(roleOf[uid]), roleRows);
      const rows = userPermsToRows(uid, diffFromRole(roleMatrix, eff));
      toInsert.push({ uid, rows });
      staffTouched++;
      touched.push(uid);
    }

    for (const item of toInsert) {
      await DB(env).prepare('DELETE FROM user_perms WHERE restaurant_id = ? AND user_id = ?')
        .bind(a.user.restaurant_id, item.uid).run();
      for (const r of item.rows) {
        await DB(env).prepare(
          `INSERT INTO user_perms (restaurant_id,user_id,module,actions,updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(restaurant_id,user_id,module) DO UPDATE SET actions = excluded.actions, updated_at = excluded.updated_at`
        ).bind(a.user.restaurant_id, r.userId, r.module, r.actions, now).run();
      }
    }
  }

  await writeAudit(env, a.ctx, 'permissions.update', 'role_perms', {
    roles,
    modules: roles.reduce((n, r) => n + Object.keys(matrix[r] || {}).length, 0),
    staffOverrides: staffTouched,
    staff: touched.slice(0, 40)
  });
  return getPermissions(req, env, a);
}

function safeList(raw) {
  let list = raw;
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch (e) { list = [] } }
  if (!Array.isArray(list)) return [];
  return list.filter(a => ACTIONS.indexOf(a) >= 0);
}

/* ============================================================
   Helper publik
   ============================================================ */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, role: u.role,
    restaurantId: u.restaurant_id, outletId: u.outlet_id, avatar: u.avatar,
    status: u.status, createdAt: u.created_at, lastLoginAt: u.last_login_at
  };
}

export function publicRestaurant(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, location: r.location, lat: r.lat, lng: r.lng,
    logo: r.logo, status: r.status, inviteCode: r.invite_code,
    ownerId: r.owner_id, createdAt: r.created_at
  };
}

function safeParse(s) {
  try { return JSON.parse(s) } catch (e) { return null }
}
