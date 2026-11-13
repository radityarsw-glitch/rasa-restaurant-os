/* ============================================================
   RASA Restaurant OS — migrasi kolom ringan (jalankan otomatis)
   Menambahkan kolom identitas pribadi & status akun yang dibutuhkan
   halaman Staf & Role dan Profil Pribadi pada basis data yang sudah
   ada, tanpa perlu perintah manual. Aman dijalankan berulang:
   kegagalan "duplicate column" diabaikan.

   Jalankan juga migrasi resmi untuk produksi:
     npx wrangler d1 execute rasa-restaurant-os-db --file=server/schema.sql --remote
   ============================================================ */

const DB = env => env.rasa_restaurant_os_db;

const COLUMNS = [
  ['users', 'phone', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'theme', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'deactivated_at', 'INTEGER NOT NULL DEFAULT 0']
];

let ready = false;

export async function ensureColumns(env) {
  if (ready) return;
  for (const [table, col, def] of COLUMNS) {
    try {
      await DB(env).prepare('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + def).run();
    } catch (e) {
      /* kolom sudah ada (ALTER berulang) — abaikan; galat lain dicatat */
      const msg = String((e && e.message) || '');
      if (msg && !/duplicate column/i.test(msg)) console.log('migrate-skip', table + '.' + col, msg);
    }
  }
  ready = true;
}

/* Status akun: canonical 'active' | 'inactive' (legacy 'suspended' diperlakukan inactive). */
export const isActiveStatus = s => String(s || '') === 'active';
