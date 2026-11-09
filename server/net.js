/* ============================================================
   RASA Restaurant OS — jembatan ke cloudflare:sockets
   Dipisah dari smtp.js supaya modul SMTP bisa diuji lokal (Node)
   tanpa memuat modul bawaan runtime Cloudflare.
   ============================================================ */
export { connect } from 'cloudflare:sockets';
