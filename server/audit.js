/* ============================================================
   RASA Restaurant OS — Audit log
   Setiap aktivitas penting (autentikasi, perubahan data, izin)
   dicatat di tabel audit_logs: user, role, aksi, data, waktu,
   outlet, device, dan sesi.
   ============================================================ */

import { json, clean } from './lib.js';

export async function writeAudit(env, ctx, action, entity, detail) {
  try {
    const payload = typeof detail === 'string' ? detail : JSON.stringify(detail || {});
    await env.rasa_restaurant_os_db
      .prepare(
        `INSERT INTO audit_logs
         (restaurant_id,outlet_id,user_id,user_name,role,action,entity,detail,device,session_id,ip,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        clean(ctx.restaurantId, 60),
        clean(ctx.outletId, 60),
        clean(ctx.userId, 60),
        clean(ctx.userName, 80),
        clean(ctx.role, 30),
        clean(action, 60),
        clean(entity, 60),
        payload.slice(0, 4000),
        clean(ctx.device, 80),
        clean(ctx.sessionId, 80),
        clean(ctx.ip, 60),
        Date.now()
      )
      .run();
  } catch (e) {
    /* audit tidak boleh menjatuhkan request utama, tapi tetap dicatat di log */
    console.log('audit-write-failed', action, String(e && e.message));
  }
}

export async function listAudit(env, ctx, limit, offset) {
  const restId = ctx.restaurantId;
  const total = await env.rasa_restaurant_os_db
    .prepare('SELECT COUNT(*) AS c FROM audit_logs WHERE restaurant_id = ?')
    .bind(restId).first();
  const rows = await env.rasa_restaurant_os_db
    .prepare(
      `SELECT id,restaurant_id,outlet_id,user_id,user_name,role,action,entity,detail,device,session_id,ip,created_at
       FROM audit_logs WHERE restaurant_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    .bind(restId, Math.min(200, Math.max(1, limit || 50)), Math.max(0, offset || 0))
    .all();
  return json({ ok: true, total: (total && total.c) || 0, items: rows.results || [] });
}
