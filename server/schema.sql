-- ============================================================
-- RASA Restaurant OS — skema database Cloudflare D1 (SQLite)
-- Jalankan dengan: npx wrangler d1 execute rasa-restaurant-os-db --file=server/schema.sql --remote
-- ============================================================

-- Restoran (penyewa / tenant) — identitas permanen penyimpanan data
CREATE TABLE IF NOT EXISTS restaurants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',
  lat           TEXT NOT NULL DEFAULT '',
  lng           TEXT NOT NULL DEFAULT '',
  logo          TEXT NOT NULL DEFAULT '',
  owner_id      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'buka',
  invite_code   TEXT NOT NULL DEFAULT '',
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Outlet (struktur siap untuk multi-outlet / Tahap 5)
CREATE TABLE IF NOT EXISTS outlets (
  id            TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  location      TEXT NOT NULL DEFAULT '',
  is_main       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- Akun pengguna. OTP TIDAK PERNAH dijadikan identitas permanen.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  restaurant_id  TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  role           TEXT NOT NULL DEFAULT 'owner',
  outlet_id      TEXT NOT NULL DEFAULT '',
  avatar         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_rest ON users(restaurant_id);

-- Kode OTP: sekali pakai, ada masa berlaku, hanya disimpan sebagai hash
CREATE TABLE IF NOT EXISTS otp_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL,            -- register | login | sensitive
  payload     TEXT NOT NULL DEFAULT '{}',
  channel     TEXT NOT NULL DEFAULT 'screen',
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_exp ON otp_codes(expires_at);

-- Sesi / token aman setelah verifikasi OTP berhasil
CREATE TABLE IF NOT EXISTS sessions (
  token_hash     TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  restaurant_id  TEXT NOT NULL DEFAULT '',
  outlet_id      TEXT NOT NULL DEFAULT '',
  device         TEXT NOT NULL DEFAULT '',
  ip             TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  revoked_at     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

-- Penyimpanan terpusat: satu workspace JSON per restoran (ID restoran, bukan OTP)
CREATE TABLE IF NOT EXISTS workspace (
  restaurant_id  TEXT PRIMARY KEY,
  payload        TEXT NOT NULL DEFAULT '{}',
  rev            INTEGER NOT NULL DEFAULT 1,
  updated_at     INTEGER NOT NULL,
  updated_by     TEXT NOT NULL DEFAULT ''
);

-- Audit log: setiap aktivitas penting
CREATE TABLE IF NOT EXISTS audit_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id  TEXT NOT NULL DEFAULT '',
  outlet_id      TEXT NOT NULL DEFAULT '',
  user_id        TEXT NOT NULL DEFAULT '',
  user_name      TEXT NOT NULL DEFAULT '',
  role           TEXT NOT NULL DEFAULT '',
  action         TEXT NOT NULL,
  entity         TEXT NOT NULL DEFAULT '',
  detail         TEXT NOT NULL DEFAULT '{}',
  device         TEXT NOT NULL DEFAULT '',
  session_id     TEXT NOT NULL DEFAULT '',
  ip             TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_rest ON audit_logs(restaurant_id, created_at);

-- Permission granular: role x modul x aksi x outlet
CREATE TABLE IF NOT EXISTS role_perms (
  restaurant_id  TEXT NOT NULL,
  role           TEXT NOT NULL,
  module         TEXT NOT NULL,
  outlet_id      TEXT NOT NULL DEFAULT '*',
  actions        TEXT NOT NULL DEFAULT '[]',
  updated_at     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, role, module, outlet_id)
);

-- Wewenang khusus per staf: menimpa matriks role untuk satu akun.
-- Baris kosong (actions='[]') = wewenang dicabut dari staf tersebut.
CREATE TABLE IF NOT EXISTS user_perms (
  restaurant_id  TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  module         TEXT NOT NULL,
  actions        TEXT NOT NULL DEFAULT '[]',
  updated_at     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, user_id, module)
);

CREATE INDEX IF NOT EXISTS idx_user_perms_rest ON user_perms(restaurant_id, user_id);

-- Rate limit sederhana untuk permintaan OTP
CREATE TABLE IF NOT EXISTS otp_throttle (
  email      TEXT PRIMARY KEY,
  window_at  INTEGER NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0
);
