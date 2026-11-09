/* ============================================================
   RASA Restaurant OS — pengiriman email notifikasi (OTP & undangan)

   Urutan kanal (yang pertama cocok dipakai):
     1. OTP_FROM + RESEND_API_KEY  → Resend dengan domain terverifikasi
     2. SMTP_USER + SMTP_PASSWORD      → SMTP generik (Brevo/Gmail/dll,
                                         tanpa domain/DNS; host diatur
                                         lewat SMTP_HOST/SMTP_PORT)
     3. RESEND_API_KEY saja        → Resend pengirim bawaan (mode uji:
                                      hanya sampai ke alamat akun Resend)
     4. Tidak ada satu pun         → not_configured (pesan jelas, kode
                                      tidak pernah bocor ke klien)

   Kegagalan pada satu kanal otomatis jatuh ke kanal berikutnya bila
   tersedia; bila semuanya gagal, alasan PERTAMA dilaporkan (paling
   relevan dengan konfigurasi utama).
   ============================================================ */

const trim = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);

/* ---- Resend (HTTPS) ---- */
async function viaResend(key, customFrom, msg) {
  const fromNameValue = String(msg.fromName || '').replace(/["\\<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'RASA Restaurant';
  const from = trim(customFrom, 120) || ('"' + fromNameValue + '" <onboarding@resend.dev>');
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html
      })
    });
    if (res.ok) return { ok: true, channel: 'email', via: 'resend' };
    const detail = await res.text();
    return { ok: false, reason: 'provider_rejected', status: res.status, detail: String(detail || '').slice(0, 300) };
  } catch (e) {
    return { ok: false, reason: 'provider_error', detail: String(e && e.message || '').slice(0, 200) };
  }
}

/* ---- SMTP generik (Brevo / Gmail / provider apa pun) ----
   Konfigurasi secret:
     SMTP_HOST     — mis. smtp-relay.brevo.com (default smtp.gmail.com)
     SMTP_PORT     — 465 (TLS langsung, default) atau 587
     SMTP_USER     — username otentikasi (Brevo: Login di halaman SMTP & API)
     SMTP_PASSWORD — password/key (Brevo: SMTP Key; Gmail: App Password)
     SMTP_FROM     — alamat pengirim terverifikasi (Brevo: sender yang sudah
                     diverifikasi; default = SMTP_USER)
   Alias lama GMAIL_USER + GMAIL_APP_PASSWORD tetap didukung. */
function smtpConfig(env) {
  const host = trim(env.SMTP_HOST, 120);
  const port = parseInt(trim(env.SMTP_PORT, 6), 10) || 465;
  const user = trim(env.SMTP_USER, 120) || trim(env.GMAIL_USER, 120);
  const pass = trim(env.SMTP_PASSWORD, 120) || trim(env.GMAIL_APP_PASSWORD, 120).replace(/\s+/g, '');
  const from = trim(env.SMTP_FROM, 120) || user;
  if (!user || !pass) return null;
  return { host: host || 'smtp.gmail.com', port, user, pass, from };
}

async function viaSmtp(cfg, msg, deps) {
  try {
    const { smtpSend } = await import('./smtp.js');
    await smtpSend({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      pass: cfg.pass,
      to: msg.to,
      fromName: msg.fromName,
      fromAddr: cfg.from,
      subject: msg.subject,
      text: msg.text,
      html: msg.html
    }, deps);
    return { ok: true, channel: 'email', via: 'smtp' };
  } catch (e) {
    return { ok: false, reason: 'smtp_error', detail: String(e && e.message || e).slice(0, 300) };
  }
}

/* Kirim email memakai kanal terbaik yang tersedia.
   Mengembalikan { ok, channel, via } atau { ok:false, reason, status?, detail? }. */
export async function deliverMail(env, msg, deps) {
  const resendKey = trim(env.RESEND_API_KEY, 200);
  const customFrom = trim(env.OTP_FROM, 120);
  const smtp = smtpConfig(env);

  const plan = [];
  if (customFrom && resendKey) plan.push(() => viaResend(resendKey, customFrom, msg));
  if (smtp) plan.push(() => viaSmtp(smtp, msg, deps));
  if (resendKey && !customFrom) plan.push(() => viaResend(resendKey, '', msg));

  if (!plan.length) {
    console.log('mail-skipped', 'tidak ada kanal email terpasang (OTP_FROM/RESEND_API_KEY/SMTP_USER+SMTP_PASSWORD)');
    return { ok: false, reason: 'not_configured' };
  }

  const failures = [];
  for (const step of plan) {
    const r = await step();
    if (r.ok) { console.log('mail-sent', r.via || r.channel, msg.to); return r; }
    console.log('mail-failed', r.reason, r.status || '', r.detail || '');
    failures.push(r);
  }
  return failures[0];
}
