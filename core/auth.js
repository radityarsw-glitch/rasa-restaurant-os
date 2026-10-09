/* ============================================================
   RASA Restaurant OS — gerbang akun: email → OTP → sesi
   - Mendaftar: email + nama + nama restoran (opsional kode undangan)
   - Masuk: email → kode 6 digit (ditampilkan di layar, siap email)
   - Mode lokal tetap tersedia (tanpa sinkronisasi) agar fitur lama
     tidak hilang untuk pengguna tanpa akun.
   ============================================================ */

window.RasaAuth = (function () {
  const GUEST_KEY = 'restaurant-os:guest';
  let step = 'email';          /* email | otp */
  let purpose = 'login';       /* login | register */
  let pendingEmail = '';
  let pendingOtp = null;       /* kode dari server (delivery=screen) */
  let resendLeft = 0;
  let resendTimer = null;
  let busy = false;

  const $ = id => document.getElementById(id);
  const isGuest = () => { try { return localStorage.getItem(GUEST_KEY) === '1' } catch (e) { return false } };
  const setGuest = v => { try { v ? localStorage.setItem(GUEST_KEY, '1') : localStorage.removeItem(GUEST_KEY) } catch (e) {} };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* ---------- lapisan gerbang ---------- */
  function gateHtml() {
    return `
    <div class="gate-backdrop" id="authGate" hidden>
      <div class="gate-card" role="dialog" aria-modal="true" aria-label="Masuk ke RASA">
        <div class="gate-brand"><span class="brand-mark">r.</span><span class="brand-name">rasa<span class="brand-sub">RESTAURANT OS</span></span></div>
        <div id="gateBody"></div>
        <div class="gate-foot">
          <button type="button" class="link-btn" data-gate="local">Lanjutkan mode lokal tanpa akun</button>
        </div>
      </div>
    </div>`;
  }

  function emailStepHtml(msg) {
    const reg = purpose === 'register';
    return `
      <h2 class="gate-title">${reg ? 'Buat akun restoran' : 'Masuk ke akun Anda'}</h2>
      <p class="gate-sub">${reg ? 'Satu akun untuk semua perangkat — data restoran tersimpan aman di server RASA.' : 'Gunakan email Anda. Kami kirim kode OTP 6 digit.'}</p>
      ${msg ? '<div class="gate-alert">' + escHtml(msg) + '</div>' : ''}
      <label class="field"><span>Email</span>
        <input class="input" id="gateEmail" type="email" inputmode="email" autocomplete="email" maxlength="160" placeholder="nama@restoran.com" value="${escHtml(pendingEmail)}"></label>
      ${reg ? `
      <div class="field-row">
        <label class="field"><span>Nama Anda</span><input class="input" id="gateName" maxlength="60" placeholder="Nama lengkap" autocomplete="name"></label>
        <label class="field"><span>Nama restoran</span><input class="input" id="gateResto" maxlength="60" placeholder="Contoh: Rasa &amp; Rona"></label>
      </div>
      <label class="field"><span>Kode undangan restoran (opsional)</span><input class="input" id="gateInvite" maxlength="24" placeholder="Gabung ke restoran yang sudah ada" autocapitalize="characters"></label>` : ''}
      <div class="gate-actions">
        <button class="btn btn-primary btn-block" id="gateSubmit" data-gate="send">${reg ? 'Buat akun & kirim kode' : 'Kirim kode OTP'}</button>
      </div>
      <div class="gate-switch">
        ${reg ? 'Sudah punya akun?' : 'Belum punya akun?'}
        <button type="button" class="link-btn" data-gate="toggle-mode">${reg ? 'Masuk' : 'Daftar baru'}</button>
      </div>`;
  }

  function otpStepHtml(msg) {
    return `
      <h2 class="gate-title">Masukkan kode OTP</h2>
      <p class="gate-sub">Kode dikirim ke <b>${escHtml(pendingEmail)}</b>${purpose === 'register' ? ' untuk membuat akun' : ''} · berlaku 5 menit.</p>
      ${msg ? '<div class="gate-alert">' + escHtml(msg) + '</div>' : ''}
      ${pendingOtp ? `
      <div class="otp-screen">
        <small>Kode Anda (pengiriman lewat layar)</small>
        <b class="otp-code" id="otpShown">${escHtml(pendingOtp)}</b>
        <button type="button" class="link-btn" data-gate="copy-otp">Salin kode</button>
      </div>` : `
      <div class="gate-alert info">Kode dikirim ke email Anda — masukkan 6 digit angka.</div>`}
      <label class="field"><span>Kode 6 digit</span>
        <input class="input otp-input" id="gateCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></label>
      <div class="gate-actions">
        <button class="btn btn-primary btn-block" id="gateSubmit" data-gate="verify">Verifikasi &amp; masuk</button>
      </div>
      <div class="gate-switch">
        <button type="button" class="link-btn" data-gate="back">← Ganti email</button>
        <span id="resendBox"></span>
      </div>`;
  }

  function renderGate(msg) {
    const body = $('gateBody');
    if (!body) return;
    body.innerHTML = step === 'otp' ? otpStepHtml(msg) : emailStepHtml(msg);
    const focus = $(step === 'otp' ? 'gateCode' : 'gateEmail');
    if (focus) setTimeout(() => focus.focus(), 50);
    if (step === 'otp') renderResend();
  }

  function showGate(msg) {
    let gate = $('authGate');
    if (!gate) {
      document.body.insertAdjacentHTML('beforeend', gateHtml());
      gate = $('authGate');
      gate.addEventListener('click', onGateClick);
      gate.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id) { e.preventDefault(); onGateClick({ target: e.target, currentTarget: gate }) } });
    }
    gate.hidden = false;
    document.documentElement.classList.add('gate-open');
    renderGate(msg);
  }

  function hideGate() {
    const gate = $('authGate');
    if (gate) gate.hidden = true;
    document.documentElement.classList.remove('gate-open');
  }

  /* ---------- interaksi gerbang ---------- */
  async function onGateClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-gate]') : null;
    if (!t) return;
    const act = t.dataset.gate;

    if (act === 'local') { setGuest(true); hideGate(); toast('Mode lokal — data tersimpan di perangkat ini tanpa sinkronisasi.'); return; }
    if (act === 'toggle-mode') { purpose = purpose === 'register' ? 'login' : 'register'; step = 'email'; renderGate(); return; }
    if (act === 'back') { step = 'email'; pendingOtp = null; stopResend(); renderGate(); return; }
    if (act === 'copy-otp') {
      try { await navigator.clipboard.writeText(pendingOtp || ''); toast('Kode disalin.'); } catch (err) { toast('Gagal menyalin — salin manual: ' + pendingOtp); }
      return;
    }
    if (act === 'send') { await sendOtp(); return; }
    if (act === 'verify') { await verifyOtp(); return; }
    if (act === 'resend') { purpose = pendingEmail && purpose === 'register' ? 'register' : 'login'; await sendOtp(true); return; }
  }

  async function sendOtp(isResend) {
    if (busy) return;
    const email = String(($('gateEmail') && $('gateEmail').value || pendingEmail) || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { renderGate('Format email tidak valid.'); return; }
    const body = { email: email, purpose: purpose };
    if (purpose === 'register') {
      body.name = String(($('gateName') && $('gateName').value || '').trim());
      body.resto = String(($('gateResto') && $('gateResto').value || '').trim());
      body.invite = String(($('gateInvite') && $('gateInvite').value || '').trim());
      if (!body.name) { renderGate('Isi nama Anda terlebih dahulu.'); return; }
    }
    busy = true;
    setBusy(true);
    try {
      const res = await window.RasaAPI.post('/api/auth/request', body);
      pendingEmail = email;
      pendingOtp = res.otp || null;
      step = 'otp';
      startResend();
      renderGate();
      if (!isResend) toast('Kode OTP dikirim.');
      else toast('Kode baru dikirim.');
    } catch (err) {
      if (purpose === 'register' && err.status === 404) { /* tetap lanjut */ }
      renderGate(err.message || 'Gagal mengirim kode. Coba lagi.');
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (busy) return;
    const code = String(($('gateCode') && $('gateCode').value || '').replace(/\D/g, ''));
    if (code.length !== 6) { renderGate('Kode harus 6 digit angka.'); return; }
    busy = true;
    setBusy(true);
    try {
      const res = await window.RasaAPI.post('/api/auth/verify', { email: pendingEmail, code: code });
      applySession(res);
      setGuest(false);
      hideGate();
      stopResend();
      toast('Selamat datang, ' + (res.user && res.user.name || res.user && res.user.email || 'Owner') + '!');
      window.RasaSync.start();
    } catch (err) {
      renderGate(err.message || 'Verifikasi gagal.');
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  function setBusy(v) {
    const b = $('gateSubmit');
    if (b) { b.disabled = v; b.classList.toggle('is-loading', v); if (v) b.textContent = 'Memproses…'; }
  }

  function startResend() {
    resendLeft = 30;
    stopResend();
    resendTimer = setInterval(() => {
      resendLeft--;
      renderResend();
      if (resendLeft <= 0) stopResend();
    }, 1000);
  }
  function stopResend() { if (resendTimer) { clearInterval(resendTimer); resendTimer = null; } resendLeft = 0; renderResend(); }
  function renderResend() {
    const box = $('resendBox');
    if (!box) return;
    box.innerHTML = resendLeft > 0
      ? '<span class="resend-timer">Kirim ulang dalam ' + resendLeft + 's</span>'
      : '<button type="button" class="link-btn" data-gate="resend">Kirim ulang kode</button>';
  }

  /* ---------- sesi ---------- */
  function applySession(res) {
    const s = window.RasaSession;
    s.set(res.token);
    s.user = res.user || null;
    s.restaurant = res.restaurant || null;
    s.permissions = res.permissions || null;
    s.ready = true;
    applyAccountUI();
  }

  async function restore() {
    const me = await window.RasaAPI.get('/api/auth/me');
    const s = window.RasaSession;
    s.user = me.user || null;
    s.restaurant = me.restaurant || null;
    s.permissions = me.permissions || null;
    s.ready = true;
    applyAccountUI();
    return me;
  }

  async function logout() {
    try { await window.RasaAPI.post('/api/auth/logout'); } catch (e) {}
    window.RasaSession.clear();
    window.RasaSync.stop();
    step = 'email'; purpose = 'login'; pendingOtp = null; stopResend();
    applyAccountUI();
    showGate('Anda telah keluar. Data restoran tersimpan di server — masuk lagi dengan email yang sama untuk melanjutkan.');
    toast('Berhasil keluar dari akun.');
  }

  /* ---------- UI akun di sidebar & pengaturan ---------- */
  function applyAccountUI() {
    const s = window.RasaSession;
    const name = s.user && (s.user.name || s.user.email) || '';
    const role = (s.user && s.user.role || '').toUpperCase() || 'LOKAL';
    document.querySelectorAll('.sidebar .profile span b').forEach(el => { if (name) el.textContent = name; });
    document.querySelectorAll('.sidebar .profile span small').forEach(el => { if (name) el.textContent = role.charAt(0) + role.slice(1).toLowerCase(); });
    const av = document.querySelector('.sidebar .profile .avatar');
    if (av && name) av.textContent = initialsOf(name);
    const pa = document.querySelector('.top-avatar');
    if (pa && name) pa.textContent = initialsOf(name);
  }

  function accountPanel() {
    const s = window.RasaSession;
    if (!s.user) {
      return `
      <div class="panel span-2">
        <div class="panel-head"><div><div class="panel-title">Akun &amp; sinkronisasi</div>
        <div class="panel-caption">Masuk agar data restoran tersimpan di server dan bisa dibuka dari perangkat lain</div></div>
        <button class="btn btn-primary" data-action="account-login">Masuk / Daftar akun</button></div>
        <div class="hint">Saat ini data tersimpan <b>lokal di perangkat ini</b>. Dengan akun, setiap perubahan otomatis tersinkronisasi ke pusat dan permission role berlaku di server.</div>
      </div>`;
    }
    const r = s.restaurant || {};
    const u = s.user || {};
    const role = u.role || 'owner';
    return `
      <div class="panel span-2">
        <div class="panel-head"><div><div class="panel-title">Akun &amp; sinkronisasi</div>
        <div class="panel-caption">Sesi aktif · data restoran tersinkronisasi ke server</div></div>
        <button class="btn btn-danger" data-action="account-logout">Keluar</button></div>
        <div class="account-grid">
          <div class="account-cell"><small>Email</small><b>${esc(u.email || '')}</b></div>
          <div class="account-cell"><small>Nama</small><b>${esc(u.name || '—')}</b></div>
          <div class="account-cell"><small>Role</small><b>${esc(roleLabelLocal(role))}</b></div>
          <div class="account-cell"><small>Restoran</small><b>${esc(r.name || store.restaurantName || '—')}</b></div>
          <div class="account-cell"><small>ID restoran</small><code>${esc(r.id || '')}</code></div>
          <div class="account-cell"><small>Kode undangan</small><code>${esc(r.inviteCode || r.invite_code || '—')}</code></div>
        </div>
        <div class="hint">Setiap perubahan (menu, pesanan, reservasi, pengaturan) otomatis dikirim ke server dalam 1,5 detik dan berlaku untuk semua perangkat pada role yang sama.</div>
      </div>`;
  }

  function roleLabelLocal(id) {
    const map = { owner: 'Owner', manager: 'Manager', kasir: 'Kasir', kitchen: 'Kitchen', waiter: 'Waiter' };
    return map[id] || String(id || '');
  }

  /* ---------- titik awal (dipanggil app.js setelah render pertama) ---------- */
  async function start() {
    if (!document.getElementById('authGate')) {
      document.body.insertAdjacentHTML('beforeend', gateHtml());
      const gate = $('authGate');
      gate.addEventListener('click', onGateClick);
      gate.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target && ['gateEmail', 'gateCode', 'gateName', 'gateResto', 'gateInvite'].indexOf(e.target.id) >= 0) {
          e.preventDefault();
          onGateClick({ target: $('gateSubmit') || e.target, currentTarget: gate });
        }
      });
    }
    applyAccountUI();

    if (window.RasaSession.token) {
      try {
        await restore();
        hideGate();
        await window.RasaSync.start();
        return;
      } catch (e) {
        window.RasaSession.clear();
        window.RasaSync.status('', null);
      }
    }
    if (isGuest()) { hideGate(); return; }
    showGate();
  }

  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  return { start, showGate, hideGate, logout, accountPanel, applyAccountUI, isGuest, setGuest };
})();
