/* ============================================================
   RASA Restaurant OS — entry Worker (API /api/*)
   Aset statis (index.html, app.js, style.css) disajikan langsung
   oleh Cloudflare; hanya /api/* masuk ke Worker ini.
   ============================================================ */

import { json, err, readJson, clean } from './lib.js';
import {
  requestOtp, verifyOtp, logout, me, addStaff, listStaff, updateStaff,
  removeStaff, getPermissions, setPermissions, authContext, requireAuth
} from './auth.js';
import { getData, putData, rotateInvite } from './data.js';
import { listAudit, writeAudit } from './audit.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-session-token'
};

async function route(req, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();
  const key = method + ' ' + path;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  /* --- autentikasi --- */
  if (key === 'POST /api/auth/request') return withCors(await requestOtp(req, env));
  if (key === 'POST /api/auth/resend') return withCors(await requestOtp(req, env));
  if (key === 'POST /api/auth/verify') return withCors(await verifyOtp(req, env));
  if (key === 'POST /api/auth/logout') return withCors(await logout(req, env));
  if (key === 'GET /api/auth/me') return withCors(await me(req, env));

  /* --- sinkronisasi data --- */
  if (key === 'GET /api/data') return withCors(await getData(req, env));
  if (key === 'PUT /api/data') return withCors(await putData(req, env));

  /* --- staf --- */
  if (key === 'GET /api/staff') {
    const a = await requireAuth(req, env);
    if (!Array.isArray(a.perms.staff) || a.perms.staff.indexOf('read') < 0) return withCors(err('Tidak boleh melihat daftar staf.', 403));
    return withCors(await listStaff(req, env, a));
  }
  if (key === 'POST /api/staff') {
    const a = await requireAuth(req, env);
    if (!Array.isArray(a.perms.staff) || a.perms.staff.indexOf('create') < 0) return withCors(err('Tidak boleh menambah staf.', 403));
    return withCors(await addStaff(req, env, a));
  }
  const staffPut = /^PUT \/api\/staff\/([^/]+)$/.exec(key);
  if (staffPut) {
    const a = await requireAuth(req, env);
    if (!Array.isArray(a.perms.staff) || a.perms.staff.indexOf('update') < 0) return withCors(err('Tidak boleh mengubah staf.', 403));
    return withCors(await updateStaff(req, env, a, staffPut[1]));
  }
  const staffDel = /^DELETE \/api\/staff\/([^/]+)$/.exec(key);
  if (staffDel) {
    const a = await requireAuth(req, env);
    if (!Array.isArray(a.perms.staff) || a.perms.staff.indexOf('delete') < 0) return withCors(err('Tidak boleh menghapus staf.', 403));
    return withCors(await removeStaff(req, env, a, staffDel[1]));
  }

  /* --- permission --- */
  if (key === 'GET /api/permissions') {
    const a = await requireAuth(req, env);
    if (!Array.isArray(a.perms.permissions) || a.perms.permissions.indexOf('read') < 0) return withCors(err('Tidak boleh melihat permission.', 403));
    return withCors(await getPermissions(req, env, a));
  }
  if (key === 'PUT /api/permissions') {
    const a = await requireAuth(req, env);
    return withCors(await setPermissions(req, env, a));
  }

  /* --- audit log --- */
  if (key === 'GET /api/audit') {
    const a = await requireAuth(req, env);
    if (!Array.isArray(a.perms.audit) || a.perms.audit.indexOf('read') < 0) return withCors(err('Tidak boleh membaca audit log.', 403));
    const q = url.searchParams;
    const limit = parseInt(q.get('limit'), 10) || 50;
    const offset = parseInt(q.get('offset'), 10) || 0;
    return withCors(await listAudit(env, a.ctx, limit, offset));
  }
  if (key === 'POST /api/audit') {
    const a = await requireAuth(req, env);
    const body = await readJson(req, 16384);
    const action = clean(body.action, 60);
    const entity = clean(body.entity, 60);
    if (!action) return withCors(err('Aksi tidak boleh kosong.', 400, { field: 'action' }));
    await writeAudit(env, a.ctx, action, entity, body.detail || {});
    return withCors(json({ ok: true }));
  }

  /* --- restoran --- */
  if (key === 'POST /api/restaurant/invite') return withCors(await rotateInvite(req, env));

  /* --- kesehatan --- */
  if (key === 'GET /api/health') {
    let db = 'ok';
    try { await env.rasa_restaurant_os_db.prepare('SELECT 1 AS x').first() } catch (e) { db = 'error' }
    return withCors(json({ ok: db === 'ok', db, time: Date.now() }));
  }

  return withCors(err('Endpoint tidak ditemukan: ' + method + ' ' + path, 404));
}

function withCors(res) {
  if (!res || !(res instanceof Response)) return res;
  const headers = new Headers(res.headers);
  Object.keys(CORS).forEach(k => headers.set(k, CORS[k]));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await route(req, env, url);
      } catch (e) {
        if (e instanceof Response) return withCors(e);
        const msg = String((e && e.message) || '');
        if (msg === 'payload_too_large') return withCors(err('Data terlalu besar (maksimal 1,5 MB). Kompresi gambar atau hapus foto.', 413));
        if (msg === 'invalid_json') return withCors(err('Body request bukan JSON yang valid.', 400));
        console.log('api-error', msg, e && e.stack);
        return withCors(err('Terjadi kesalahan pada server.', 500));
      }
    }
    /* fallback bila aset statis diminta lewat Worker */
    return env.ASSETS.fetch(req);
  }
};
