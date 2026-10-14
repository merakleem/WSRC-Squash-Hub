const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../database/db');
const {
  wrap, setSessionCookie, getSession, setPendingSignIn, getPendingSignIn, clearPendingSignIn,
} = require('../middleware');
const { sendEmail, isConfigured: emailConfigured } = require('../lib/email');
const staff = require('../lib/staff');
const log = require('../lib/log');
const { authPage, messagePage, loginPage, serverEsc: esc } = require('./auth');

// The sign-in pages that are staff accounts' alone: the authenticator code
// after the password, backup codes, the invite landing page, a password
// reset, setting up two-step sign-in, and confirming a new email. They render
// in the same shell as the login page, which is otherwise unchanged.
const router = express.Router();

const APPS = 'Works with Google Authenticator, Microsoft Authenticator, 1Password and Apple Passwords.';

function steps(on) {
  const names = ['Account', 'Authenticator', 'Backup codes'];
  const parts = names.map((n, i) => {
    const cls = i + 1 < on ? ' sa-step--done' : i + 1 === on ? ' sa-step--on' : '';
    return `<span class="sa-step${cls}"><span class="sa-step-n">${i + 1 < on ? '✓' : i + 1}</span>${n}</span>`;
  });
  return `<div class="sa-steps">${parts.join('<span class="sa-step-line"></span>')}</div>`;
}

/** Signed in: the session, a fresh last-signed-in time, nothing pending. */
function finishSignIn(res, s) {
  getDB().prepare('UPDATE staff_accounts SET last_signed_in_at = ? WHERE id = ?').run(new Date().toISOString(), s.id);
  clearPendingSignIn(res);
  setSessionCookie(res, { role: 'staff', staffId: s.id, sv: s.session_version });
  res.redirect('/');
}

/** The pending sign-in, if it is for `purpose` and its account still stands. */
function pendingFor(req, purpose) {
  const p = getPendingSignIn(req);
  if (!p || p.purpose !== purpose) return null;
  const s = staff.getById(p.staffId);
  if (!s || s.status !== 'active' || s.session_version !== p.sv) return null;
  return { p, s };
}

const expiredLogin = (res) => {
  clearPendingSignIn(res);
  return res.send(loginPage({ info: "That took a while, so the sign-in expired. Enter your password again and you'll get a fresh code prompt." }));
};

/** Start two-step setup for `s` with a fresh secret, then go to the setup page. */
function startSetup(res, s, { inFlow, fromAccount = false }) {
  setPendingSignIn(res, { purpose: 'setup', staffId: s.id, sv: s.session_version, secret: null, inFlow, fromAccount });
  res.redirect('/staff/two-step/setup');
}

// ===== THE PASSWORD STEP (from POST /login in auth.js) =====

async function passwordSignIn(req, res, s, password) {
  const invalid = () => res.status(401).send(loginPage({ error: 'Invalid email or password.' }));
  if (s.status === 'invited') {
    return res.status(401).send(loginPage({ error: 'Your account has not been activated yet. Check your email for an invite link, or contact your administrator.' }));
  }
  if (s.status !== 'active' || !s.password_hash) return invalid();
  if (!(await bcrypt.compare(String(password || ''), s.password_hash))) return invalid();
  if (s.totp_enabled_at) {
    setPendingSignIn(res, { purpose: 'code', staffId: s.id, sv: s.session_version });
    return res.redirect('/login/code');
  }
  if (s.require_two_step) return startSetup(res, s, { inFlow: false });
  return finishSignIn(res, s);
}

// ===== THE CODE STEP =====

function codePage(s, { error } = {}) {
  return authPage({
    title: 'Enter Your Code',
    heading: 'Enter your code',
    sub: 'Open your authenticator app and enter the 6-digit code for Play WSRC.',
    body: `<form method="POST" action="/login/code">
      <div class="fields">
        <label class="field"><span>Code</span><input type="text" class="sa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" autofocus></label>
      </div>
      <button type="submit">Verify</button>
    </form>`,
    error,
    link: { href: '/login/backup', text: 'Use a backup code instead' },
    after: `<p class="sa-apps" style="text-align:center">Signing in as ${esc(s.email)} · <a href="/login/cancel">Not you?</a></p>`,
  });
}

function backupPage({ error } = {}) {
  return authPage({
    title: 'Use a Backup Code',
    heading: 'Use a backup code',
    sub: 'One of the codes you saved when you set up two-step sign-in. Each works once.',
    body: `<form method="POST" action="/login/backup">
      <div class="fields">
        <label class="field"><span>Backup code</span><input type="text" class="sa-code sa-code--backup" name="code" autocomplete="off" maxlength="9" placeholder="XXXX-XXXX" autofocus></label>
      </div>
      <button type="submit">Verify</button>
    </form>`,
    error,
    link: { href: '/login/code', text: 'Use your authenticator app instead' },
    after: '<p class="sa-apps" style="text-align:center">Lost your codes too? Ask the club administrator to send a password reset; it also resets two-step sign-in.</p>',
  });
}

const lockedPage = (res) => {
  clearPendingSignIn(res);
  return res.status(429).send(loginPage({ error: `Too many wrong codes. Wait ${staff.LOCK_MINUTES} minutes, then sign in again.` }));
};

router.get('/login/code', (req, res) => {
  const found = pendingFor(req, 'code');
  if (!found) return expiredLogin(res);
  res.send(codePage(found.s));
});

router.post('/login/code', (req, res) => {
  const found = pendingFor(req, 'code');
  if (!found) return expiredLogin(res);
  const { s } = found;
  if (staff.isLocked(s)) return lockedPage(res);
  const step = staff.checkTotp(s.totp_secret, s.email, req.body?.code, s.totp_last_step);
  if (step === null) {
    const left = staff.recordCodeFailure(s.id);
    if (left === 0) return lockedPage(res);
    return res.status(401).send(codePage(s, { error: `That code isn't right. Check the code your app shows now and try again. ${left} attempt${left === 1 ? '' : 's'} left.` }));
  }
  getDB().prepare('UPDATE staff_accounts SET totp_last_step = ? WHERE id = ?').run(step, s.id);
  staff.clearCodeFailures(s.id);
  finishSignIn(res, s);
});

router.get('/login/backup', (req, res) => {
  if (!pendingFor(req, 'code')) return expiredLogin(res);
  res.send(backupPage());
});

router.post('/login/backup', (req, res) => {
  const found = pendingFor(req, 'code');
  if (!found) return expiredLogin(res);
  const { s } = found;
  if (staff.isLocked(s)) return lockedPage(res);
  if (!staff.useBackupCode(s.id, req.body?.code)) {
    const left = staff.recordCodeFailure(s.id);
    if (left === 0) return lockedPage(res);
    return res.status(401).send(backupPage({ error: `That backup code isn't right, or it was already used. ${left} attempt${left === 1 ? '' : 's'} left.` }));
  }
  staff.clearCodeFailures(s.id);
  finishSignIn(res, s);
});

router.get('/login/cancel', (req, res) => {
  clearPendingSignIn(res);
  res.redirect('/login');
});

// ===== SETTING A PASSWORD: THE INVITE AND A RESET =====

function passwordForm(action, { name = null, submit }) {
  return `<form method="POST" action="${action}">
    <div class="fields">
      ${name !== null ? `<label class="field"><span>Your name</span><input type="text" name="name" value="${esc(name)}" autocomplete="name"></label>` : ''}
      <label class="field"><span>New password</span><input type="password" name="password" placeholder="At least 8 characters" autocomplete="new-password"${name === null ? ' autofocus' : ''}></label>
      <label class="field"><span>Confirm password</span><input type="password" name="confirm" placeholder="Repeat password" autocomplete="new-password"></label>
    </div>
    <button type="submit">${submit}</button>
  </form>`;
}

function invitePage(token, s, { error, name } = {}) {
  return authPage({
    title: 'Set Up Your Staff Account',
    heading: 'Set up your staff account',
    sub: "You've been invited to help run Play WSRC. Choose a password to get started.",
    top: s.require_two_step ? steps(1) : '',
    info: `You're signing in as <strong>${esc(s.email)}</strong>. This is a staff account, separate from any player account you have.`,
    body: passwordForm(`/staff/invite/${esc(token)}`, { name: name ?? s.name, submit: s.require_two_step ? 'Continue' : 'Activate account' }),
    error,
  });
}

const passwordProblem = (password, confirm) => (!password || String(password).length < 8 ? 'Password must be at least 8 characters.'
  : password !== confirm ? 'Passwords do not match.' : '');

router.get('/staff/invite/:token', (req, res) => {
  const s = staff.byInviteToken(req.params.token);
  if (!s) {
    return res.send(messagePage('Link Expired', 'Link expired', 'This invite link is invalid or has expired. Ask the club administrator to send a new one from Settings, Staff accounts.'));
  }
  res.send(invitePage(req.params.token, s));
});

router.post('/staff/invite/:token', wrap(async (req, res) => {
  const s = staff.byInviteToken(req.params.token);
  if (!s) {
    return res.send(messagePage('Link Expired', 'Link expired', 'This invite link is invalid or has expired. Ask the club administrator to send a new one from Settings, Staff accounts.'));
  }
  const name = String(req.body?.name || '').trim();
  const { password, confirm } = req.body || {};
  const problem = !name ? 'Enter your name.' : passwordProblem(password, confirm);
  if (problem) return res.send(invitePage(req.params.token, s, { error: problem, name }));
  const hash = await bcrypt.hash(String(password), 12);
  getDB().prepare(`UPDATE staff_accounts SET name = ?, password_hash = ?, password_changed_at = ?, status = 'active',
    invite_token_hash = NULL, invite_expires = NULL WHERE id = ?`).run(name, hash, new Date().toISOString(), s.id);
  require('../lib/audit').record({ staffId: s.id, area: 'staff', text: 'accepted their staff invite' });
  const fresh = staff.getById(s.id);
  if (fresh.require_two_step) return startSetup(res, fresh, { inFlow: true });
  finishSignIn(res, fresh);
}));

function resetPage(token, { error } = {}) {
  return authPage({
    title: 'Reset Password',
    heading: 'Reset password',
    body: passwordForm(`/staff/reset/${esc(token)}`, { submit: 'Reset password' }),
    error,
  });
}

router.get('/staff/reset/:token', (req, res) => {
  if (!staff.byResetToken(req.params.token)) {
    return res.send(messagePage('Invalid Link', 'Link expired', 'This password reset link is invalid or has expired. Ask the club administrator to send a new one.'));
  }
  res.send(resetPage(req.params.token));
});

router.post('/staff/reset/:token', wrap(async (req, res) => {
  const s = staff.byResetToken(req.params.token);
  if (!s) {
    return res.send(messagePage('Invalid Link', 'Link expired', 'This password reset link is invalid or has expired. Ask the club administrator to send a new one.'));
  }
  const problem = passwordProblem(req.body?.password, req.body?.confirm);
  if (problem) return res.send(resetPage(req.params.token, { error: problem }));
  const hash = await bcrypt.hash(String(req.body.password), 12);
  const db = getDB();
  // A reset also clears two-step sign-in: someone who lost their phone and
  // their codes gets back in this way, and sets it up again if required.
  db.transaction(() => {
    db.prepare(`UPDATE staff_accounts SET password_hash = ?, password_changed_at = ?, reset_token_hash = NULL, reset_expires = NULL,
      totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, two_step_failures = 0, two_step_locked_until = NULL,
      session_version = session_version + 1 WHERE id = ?`).run(hash, new Date().toISOString(), s.id);
    db.prepare('DELETE FROM staff_backup_codes WHERE staff_id = ?').run(s.id);
  })();
  const fresh = staff.getById(s.id);
  if (fresh.require_two_step) return startSetup(res, fresh, { inFlow: false });
  finishSignIn(res, fresh);
}));

// ===== SETTING UP TWO-STEP SIGN-IN =====
// Reached from the invite, from a sign-in that requires it but has none set
// up, or from My account (signed in already).

async function setupPage(res, s, p, { error } = {}) {
  // A wrong code keeps the same secret: the app they scanned must still match.
  const setup = await staff.newTotpSetup(s.email, error ? p.secret : null);
  setPendingSignIn(res, { ...p, secret: setup.secret });
  return res.send(authPage({
    title: 'Set Up Two-Step Sign-In',
    heading: 'Set up two-step sign-in',
    sub: s.require_two_step && !p.fromAccount
      ? 'Your account requires this. Scan the code with an authenticator app, then enter the 6-digit code it shows.'
      : 'Scan the code with an authenticator app, then enter the 6-digit code it shows.',
    top: p.inFlow ? steps(2) : '',
    body: `<div class="sa-qr-row">
        <div class="sa-qr"><img src="${setup.qr}" alt="QR code for your authenticator app"></div>
        <div class="sa-key-wrap"><span class="sa-key-label">Can't scan? Enter this key instead</span><span class="sa-key" id="saKey">${esc(setup.key)}</span><button type="button" class="sa-key-copy" data-copy="${esc(setup.secret)}">Copy key</button></div>
      </div>
      <form method="POST" action="/staff/two-step/setup">
        <div class="fields">
          <label class="field"><span>Code from your app</span><input type="text" class="sa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000"></label>
        </div>
        <button type="submit">Verify and continue</button>
      </form>
      ${error ? '' : `<p class="sa-apps">${APPS}</p>`}
      ${copyScript()}`,
    error,
    link: p.fromAccount ? { href: '/', text: 'Cancel' } : null,
  }));
}

function copyScript() {
  return `<script>
    document.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var label = b.textContent;
        navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = label; }, 1500); });
      });
    });
  </script>`;
}

/** Who is setting up: a pending sign-in, or a signed-in staff member. */
function setupIdentity(req) {
  const found = pendingFor(req, 'setup');
  if (found) return found;
  const session = getSession(req);
  if (session?.role === 'staff') {
    const s = staff.getById(session.staffId);
    return { s, p: { purpose: 'setup', staffId: s.id, sv: s.session_version, inFlow: false, fromAccount: true } };
  }
  return null;
}

router.get('/staff/two-step/setup', wrap(async (req, res) => {
  const who = setupIdentity(req);
  if (!who) return expiredLogin(res);
  await setupPage(res, who.s, who.p);
}));

router.post('/staff/two-step/setup', wrap(async (req, res) => {
  const found = pendingFor(req, 'setup');
  if (!found || !found.p.secret) return expiredLogin(res);
  const { s, p } = found;
  const step = staff.checkTotp(p.secret, s.email, req.body?.code);
  if (step === null) {
    return setupPage(res.status(401), s, p, { error: "That code didn't match. Codes change every 30 seconds; enter the one your app shows right now." });
  }
  getDB().prepare('UPDATE staff_accounts SET totp_secret = ?, totp_enabled_at = ?, totp_last_step = ?, two_step_failures = 0, two_step_locked_until = NULL WHERE id = ?')
    .run(p.secret, new Date().toISOString(), step, s.id);
  const codes = staff.newBackupCodes(s.id);
  setPendingSignIn(res, { purpose: 'finish', staffId: s.id, sv: s.session_version, fromAccount: !!p.fromAccount });
  res.send(codesPage(codes, { inFlow: p.inFlow, fromAccount: p.fromAccount }));
}));

function codesPage(codes, { inFlow, fromAccount }) {
  return authPage({
    title: 'Save Your Backup Codes',
    heading: 'Save your backup codes',
    sub: 'If you lose your phone, one of these gets you in. Each works once. Keep them somewhere safe, not in the app.',
    top: inFlow ? steps(3) : '',
    body: `<div class="sa-backup">${codes.map((c) => `<span>${c}</span>`).join('')}</div>
      <div class="sa-backup-actions"><button type="button" class="sa-key-copy" data-copy="${codes.join('\n')}">Copy codes</button><button type="button" class="sa-key-copy" id="saDownload">Download .txt</button></div>
      <form method="POST" action="/staff/two-step/finish">
        <label class="sa-check"><input type="checkbox" id="saSaved">I've saved these codes somewhere safe</label>
        <button type="submit" id="saFinish" disabled>${fromAccount ? 'Done' : 'Finish and sign in'}</button>
      </form>
      ${copyScript()}
      <script>
        document.getElementById('saSaved').addEventListener('change', function (e) { document.getElementById('saFinish').disabled = !e.target.checked; });
        document.getElementById('saDownload').addEventListener('click', function () {
          var blob = new Blob(['Play WSRC backup codes\\n\\n${codes.join('\\n')}\\n'], { type: 'text/plain' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = 'play-wsrc-backup-codes.txt'; a.click();
        });
      </script>`,
  });
}

router.post('/staff/two-step/finish', (req, res) => {
  const found = pendingFor(req, 'finish');
  if (!found) return res.redirect('/');
  if (found.p.fromAccount) {
    clearPendingSignIn(res);
    return res.redirect('/');
  }
  finishSignIn(res, found.s);
});

// ===== CONFIRMING A NEW EMAIL =====

router.get('/staff/confirm-email/:token', wrap(async (req, res) => {
  const db = getDB();
  const expired = () => res.send(messagePage('Link Expired', 'Link expired',
    'This confirmation link has expired or was already used. Your sign-in email has not changed. To try again, open Settings, My account.'));
  const change = db.prepare('SELECT * FROM staff_email_changes WHERE token_hash = ?').get(staff.sha256(req.params.token));
  if (!change || new Date(change.expires_at) < new Date()) return expired();
  const s = staff.getById(change.staff_id);
  if (!s || staff.emailProblem(change.new_email, s.id)) {
    db.prepare('DELETE FROM staff_email_changes WHERE staff_id = ?').run(change.staff_id);
    return expired();
  }
  db.transaction(() => {
    db.prepare('UPDATE staff_accounts SET email = ?, reset_token_hash = NULL, reset_expires = NULL WHERE id = ?').run(change.new_email, s.id);
    db.prepare('DELETE FROM staff_email_changes WHERE staff_id = ?').run(s.id);
  })();
  if (emailConfigured()) {
    const { emailChangedNoticeEmail } = require('../lib/email');
    const sent = await sendEmail({ to: s.email, ...emailChangedNoticeEmail({ newEmail: change.new_email }) });
    if (!sent.ok) log.warn({ staffId: s.id, error: sent.error }, 'staff email change notice not sent');
  }
  res.send(messagePage('Email Confirmed', 'Email confirmed', `You now sign in with ${esc(change.new_email)}.`, { href: '/', text: 'Open Play WSRC' }));
}));

module.exports = router;
module.exports.passwordSignIn = passwordSignIn;
