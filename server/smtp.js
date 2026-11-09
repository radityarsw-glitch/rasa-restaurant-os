/* ============================================================
   RASA Restaurant OS — klien SMTP minimal (Brevo/Gmail/provider)
   Alur: connect (465 = TLS langsung / 587 = STARTTLS) → sapaan 220
   → EHLO → [STARTTLS bila port 587 + EHLO ulang] → AUTH LOGIN
   (base64) → MAIL FROM → RCPT TO → DATA (pesan MIME
   multipart/alternative teks+HTML, UTF-8) → QUIT.

   Catatan Cloudflare: connect() dari cloudflare:sockets TANPA TLS
   secara default (secureTransport: "off") — port 465 wajib
   secureTransport: "on", port 587 memakai "starttls" + startTls().

   Dipakai bila SMTP_USER + SMTP_PASSWORD (atau alias lama
   GMAIL_USER + GMAIL_APP_PASSWORD) terpasang — pengiriman
   tanpa domain, tanpa verifikasi DNS.

   `deps.connect` bersifat opsional: hanya dipakai skrip uji lokal
   untuk menyambungkan ke server SMTP palsu tanpa jaringan.
   Produksi memakai cloudflare:sockets lewat ./net.js.
   ============================================================ */

const CRLF = '\r\n';

function b64(str) {
  const bytes = new TextEncoder().encode(String(str));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64wrap(s) { return (s.match(/.{1,76}/g) || [s]).join(CRLF); }
function headerSafe(s, max) {
  return String(s == null ? '' : s).replace(/[\r\n"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 60);
}

/* Susun pesan MIME (header + bagian teks + bagian HTML). */
export function buildMessage(opts) {
  const fromName = headerSafe(opts.fromName, 60);
  const fromAddr = headerSafe(opts.fromAddr, 120);
  const to = headerSafe(opts.to, 120);
  const subject = String(opts.subject == null ? '' : opts.subject).replace(/[\r\n]/g, ' ');
  const boundary = '=_rasa_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const headers = [
    'From: "' + fromName + '" <' + fromAddr + '>',
    'To: <' + to + '>',
    'Subject: =?UTF-8?B?' + b64(subject) + '?=',
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) +
      '@' + (fromAddr.split('@')[1] || 'localhost') + '>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"'
  ];

  const part = (type, body) => [
    '--' + boundary,
    'Content-Type: ' + type,
    'Content-Transfer-Encoding: base64',
    '',
    b64wrap(b64(body))
  ].join(CRLF);

  const data = headers.join(CRLF) + CRLF + CRLF +
    part('text/plain; charset=utf-8', String(opts.text || '')) + CRLF +
    part('text/html; charset=utf-8', String(opts.html || '')) + CRLF +
    '--' + boundary + '--' + CRLF;

  /* dot-stuffing: baris yang diawali titik digandakan saat fase DATA */
  return data.replace(/^\./gm, '..');
}

/* Kirim satu email. Melempar Error bila tahap SMTP mana pun gagal —
   pesan galat tidak pernah memuat kata sandi. */
export async function smtpSend(opts, deps) {
  const host = opts.host || 'smtp.gmail.com';
  const port = opts.port || 465;
  const timeout = opts.timeout || 20000;
  const deadline = Date.now() + timeout;
  const user = String(opts.user || '');
  const pass = String(opts.pass || '');
  const to = String(opts.to || '').trim();

  if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASSWORD belum dipasang');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('alamat tujuan tidak valid');

  const open = (deps && deps.connect) || (await import('./net.js')).connect;
  /* 465 = TLS sejak awal (implicit TLS); port lain (587/dsb) = STARTTLS.
     PENTING: signature connect(address, options) — secureTransport HARUS
     di objek options terpisah, bukan digabung ke address (diabaikan). */
  const tlsMode = port === 465 ? 'on' : 'starttls';
  const addr = { hostname: host, port };
  const optsSocket = { secureTransport: tlsMode };
  let sock = open(addr, optsSocket);
  const waitOpen = (s, label) => {
    if (!s || !s.opened || typeof s.opened.then !== 'function') return Promise.resolve();
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error('timeout ' + (label || 'koneksi') + ' ke ' + host)), 15000);
    });
    return Promise.race([s.opened, timeout]).finally(() => clearTimeout(timer));
  };
  await waitOpen(sock, 'koneksi awal');

  const encoder = new TextEncoder();
  let decoder = new TextDecoder();
  let writer, reader, buf = '';
  /* (re)ikat reader/writer — wajib dipanggil ulang setelah startTls()
     karena socket lama sudah tidak bisa dibaca/ditulis */
  const bind = s => {
    sock = s;
    writer = s.writable.getWriter();
    reader = s.readable.getReader();
    decoder = new TextDecoder();
    /* buf TIDAK dikosongkan: startTls() hanya dipanggil tepat setelah
       balasan EHLO lengkap, jadi sisa buffer = data yang sah */
  };
  bind(sock);

  const checkTime = () => { if (Date.now() > deadline) throw new Error('timeout SMTP setelah ' + timeout + ' ms'); };
  /* tahap berjalan — dilampirkan ke pesan putusnya koneksi untuk
     memudahkan diagnosa (sapaan/EHLO/AUTH/dsb) */
  let stage = 'koneksi';

  async function readLine() {
    for (;;) {
      const i = buf.indexOf('\r\n');
      if (i >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); return line; }
      checkTime();
      let r;
      try {
        r = await reader.read();
      } catch (e) {
        throw new Error('koneksi SMTP gagal dibaca saat ' + stage + ' oleh ' + host + ': ' + String(e && e.message || e).slice(0, 140));
      }
      if (r.done) throw new Error('koneksi SMTP terputus oleh ' + host + ' (tahap: ' + stage + ')');
      buf += decoder.decode(r.value, { stream: true });
    }
  }
  /* balasan SMTP: baris "NNN-" berlanjut, "NNN " = selesai */
  async function readReply() {
    const lines = [];
    for (;;) {
      const l = await readLine();
      if (!/^\d{3}/.test(l)) continue;
      lines.push(l);
      if (l.length === 3 || l[3] === ' ') break;
    }
    return { code: parseInt(lines[0].slice(0, 3), 10), text: lines.join('\n') };
  }
  async function cmd(command, expect, label) {
    const lbl = label || String(command).split(' ')[0];
    stage = lbl;
    await writer.write(encoder.encode(command + CRLF));
    const r = await readReply();
    if (expect.indexOf(r.code) < 0) {
      throw new Error('SMTP ' + lbl + ' ditolak (' + r.code + '): ' + r.text.slice(0, 160));
    }
    stage = 'menunggu balasan ' + lbl;
    return r;
  }

  try {
    stage = 'sapaan (220)';
    const greet = await readReply();
    if (greet.code !== 220) throw new Error('sapaan SMTP tidak valid (' + greet.code + ')');

    stage = 'EHLO';
    const ehlo = await cmd('EHLO localhost', [250], 'EHLO');
    /* STARTTLS (port 587): naikkan ke TLS lalu EHLO ulang —
       info capability sebelum TLS dibuang sesuai RFC 3207.
       Bila server tidak menawarkan STARTTLS, gagal jelas daripada
       mengirim AUTH dalam bentuk plaintext. */
    if (tlsMode === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.text)) {
        throw new Error('server ' + host + ':' + port + ' tidak mendukung STARTTLS — gunakan port 465 (TLS langsung)');
      }
      if (typeof sock.startTls !== 'function') {
        throw new Error('runtime tidak mendukung startTls() untuk ' + host + ':' + port);
      }
      stage = 'STARTTLS';
      const secure = sock.startTls();
      /* handshake TLS: bila janji `opened` tidak selesai dalam 15 detik,
         lanjutkan saja — stream akan menunggu handshake, dan bila memang
         bermasalah tahap berikutnya (EHLO) yang akan melaporkan galat */
      try {
        await waitOpen(secure, 'handshake TLS');
      } catch (e) {
        console.log('smtp-tls-handshake', String(e && e.message || e));
      }
      bind(secure);
      await cmd('EHLO localhost', [250], 'EHLO setelah TLS');
    }
    await cmd('AUTH LOGIN', [334], 'AUTH LOGIN');
    await cmd(b64(user), [334], 'AUTH username');
    await cmd(b64(pass), [235], 'AUTH password');
    /* MAIL FROM memakai alamat pengirim terverifikasi (opts.fromAddr),
       bukan otentikasi — Brevo/Gmail memisahkan keduanya */
    await cmd('MAIL FROM:<' + (String(opts.fromAddr || '').trim() || user) + '>', [250], 'MAIL FROM');
    await cmd('RCPT TO:<' + to + '>', [250, 251], 'RCPT TO');
    await cmd('DATA', [354], 'DATA');

    stage = 'DATA';
    await writer.write(encoder.encode(buildMessage(opts) + CRLF + '.' + CRLF));
    const ack = await readReply();
    if (ack.code !== 250) throw new Error('pesan ditolak server (' + ack.code + '): ' + ack.text.slice(0, 160));

    stage = 'QUIT';
    try { await cmd('QUIT', [221], 'QUIT'); } catch (e) { /* penutupan bubar tidak fatal */ }
    return { ok: true, code: 250 };
  } finally {
    try { reader.releaseLock(); } catch (e) {}
    try { writer.releaseLock(); } catch (e) {}
    try { if (typeof sock.close === 'function') sock.close(); } catch (e) {}
  }
}
