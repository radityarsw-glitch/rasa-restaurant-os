/* ============================================================
   RASA Restaurant OS — utilitas bersama untuk Worker API
   Helper murni: respons JSON, hash, token, validasi, identitas
   permintaan. Tidak ada logika bisnis di file ini.
   ============================================================ */

export const MAX_PAYLOAD = 1572860; /* 1.5 MB — batas aman untuk satu baris D1 */

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign(
      { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' },
      headers
    )
  });
}

export function err(message, status = 400, extra = {}) {
  return json(Object.assign({ ok: false, error: message }, extra), status);
}

/* ---- kriptografi (WebCrypto bawaan Cloudflare Workers) ---- */
export async function sha256(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* perbandingan waktu-konstan agar hash OTP tidak bisa ditebak lewat timing */
export async function safeEqual(a, b) {
  const ha = await sha256(String(a));
  const hb = await sha256(String(b));
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toB64url(a);
}

export function randomDigits(n = 6) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let out = '';
  for (let i = 0; i < n; i++) out += String(a[i] % 10);
  return out;
}

/* id pendek, terurut waktu — cukup untuk primary key aplikasi */
export function rid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + randomToken(5).replace(/[^a-z0-9]/gi, '').slice(0, 8);
}

/* ---- validasi ---- */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 160 ? e : null;
}

/* bersihkan teks dari kontrol berbahaya, batasi panjang */
export function clean(v, max = 120) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function maskEmail(e) {
  const parts = String(e || '').split('@');
  if (parts.length !== 2) return '***';
  const u = parts[0], d = parts[1];
  const head = u.slice(0, Math.min(2, u.length));
  return head + '*'.repeat(Math.max(1, u.length - head.length)) + '@' + d;
}

export async function readJson(req, max = MAX_PAYLOAD) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max) throw new Error('payload_too_large');
  const raw = await req.text();
  if (raw.length > max) throw new Error('payload_too_large');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('invalid_json');
  }
}

/* ---- identitas permintaan (untuk audit & sesi) ---- */
export function deviceOf(req) {
  const ua = String(req.headers.get('user-agent') || '').slice(0, 200);
  if (!ua) return 'Perangkat tidak dikenal';
  let os = 'Unknown', br = 'Browser';
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  if (/Edg\//i.test(ua)) br = 'Edge';
  else if (/OPR\//i.test(ua)) br = 'Opera';
  else if (/Firefox\//i.test(ua)) br = 'Firefox';
  else if (/Chrome\//i.test(ua)) br = 'Chrome';
  else if (/Safari\//i.test(ua)) br = 'Safari';
  return br + ' · ' + os;
}

export function ipOf(req) {
  return String(req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '')
    .split(',')[0].trim().slice(0, 60);
}

export function tokenFrom(req) {
  const auth = String(req.headers.get('authorization') || '');
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const alt = req.headers.get('x-session-token');
  if (alt) return String(alt).trim();
  return '';
}

/* baca nilai string dari body dengan batas panjang */
export function str(body, key, max = 120) {
  return clean(body && body[key], max);
}
