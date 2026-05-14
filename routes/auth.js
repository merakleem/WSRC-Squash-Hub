const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDB } = require('../database/db');
const { wrap, loginLimiter, signSession, setSessionCookie, clearSessionCookie, getSession } = require('../middleware');

const router = express.Router();
const ADMIN_PASSWORD = process.env.SITE_PASSWORD;

// ===== HTML HELPERS =====

function serverEsc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function authPage({ title, body, error, info }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Play WSRC</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #1e2758; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; overflow: hidden; width: 100%;
            max-width: 380px; box-shadow: 0 8px 32px rgba(0,0,0,0.35); }
    .card-header { background: #1e2758; padding: 28px 36px 24px; text-align: center; }
    .logo { width: 80px; height: 80px; object-fit: contain; }
    .card-body { padding: 28px 32px 32px; }
    h1 { font-family: 'Barlow', sans-serif; font-size: 17px; font-weight: 700; color: #1e2758; margin-bottom: 4px; }
    .subtitle { font-size: 13px; color: #6b7e93; margin-bottom: 22px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #444; margin-bottom: 5px; }
    input[type=email], input[type=password], input[type=text] {
      width: 100%; padding: 9px 12px; border: 1px solid #dce3ed;
      border-radius: 7px; font-size: 14px; margin-bottom: 14px; outline: none; }
    input:focus { border-color: #3a4db5; }
    button { width: 100%; padding: 10px; background: #1e2758; color: #fff; border: none;
             border-radius: 7px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 4px; }
    button:hover { background: #28348a; }
    .error { color: #c0392b; font-size: 13px; margin-top: 10px; }
    .info  { color: #1e6b3c; background: #d5f5e3; border-radius: 6px;
             padding: 10px 14px; font-size: 13px; margin-bottom: 16px; }
    .link-row { text-align: center; margin-top: 16px; font-size: 13px; color: #6b7e93; }
    .link-row a { color: #3a4db5; text-decoration: none; }
    .link-row a:hover { text-decoration: underline; }
    .token-box { background: #f0f3f7; border: 1px solid #dce3ed; border-radius: 7px;
                 padding: 10px 14px; font-size: 12px; word-break: break-all;
                 font-family: monospace; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <img class="logo" src="/assets/WSRC_Logo_Grey%203.png" alt="WSRC Logo">
    </div>
    <div class="card-body">
      <h1>Play WSRC</h1>
      ${info  ? `<div class="info">${info}</div>` : '<p class="subtitle">Sign in to continue</p>'}
      ${body}
      ${error ? `<div class="error">${error}</div>` : ''}
    </div>
  </div>
</body>
</html>`;
}

function loginFormBody() {
  return `<form method="POST" action="/login">
    <label>Email</label>
    <input type="email" name="email" placeholder="your@email.com" autocomplete="email">
    <label>Password</label>
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
    <button type="submit">Sign In</button>
    <div class="link-row"><a href="/forgot-password">Forgot password?</a></div>
  </form>`;
}

function inviteFormBody(token) {
  return `<form method="POST" action="/invite/${serverEsc(token)}">
    <label>New Password</label>
    <input type="password" name="password" placeholder="At least 8 characters" autofocus autocomplete="new-password">
    <label>Confirm Password</label>
    <input type="password" name="confirm" placeholder="Repeat password" autocomplete="new-password">
    <button type="submit">Activate Account</button>
  </form>`;
}

function resetFormBody(token) {
  return `<form method="POST" action="/reset-password/${serverEsc(token)}">
    <label>New Password</label>
    <input type="password" name="password" placeholder="At least 8 characters" autofocus autocomplete="new-password">
    <label>Confirm Password</label>
    <input type="password" name="confirm" placeholder="Repeat password" autocomplete="new-password">
    <button type="submit">Reset Password</button>
  </form>`;
}

// ===== LOGIN / LOGOUT =====

router.get('/login', (req, res) => {
  if (getSession(req)) return res.redirect('/');
  res.send(authPage({ title: 'Sign In', body: loginFormBody() }));
});

router.post('/login', loginLimiter, wrap(async (req, res) => {
  if (!req.body) return res.status(400).send(authPage({ title: 'Sign In', error: 'Bad request.', body: loginFormBody() }));
  const { email, password } = req.body;

  // Admin login — email blank, password matches env var
  if (!email || !email.trim()) {
    if (password === ADMIN_PASSWORD) {
      setSessionCookie(res, { role: 'admin' });
      return res.redirect('/');
    }
    return res.status(401).send(authPage({ title: 'Sign In', error: 'Incorrect password.', body: loginFormBody() }));
  }

  // Player login — email + bcrypt password via user_accounts
  const db = getDB();
  const player = db.prepare('SELECT * FROM players WHERE LOWER(email) = LOWER(?)').get([email.trim()]);
  if (!player) {
    return res.status(401).send(authPage({ title: 'Sign In', error: 'Invalid email or password.', body: loginFormBody() }));
  }
  const account = db.prepare('SELECT * FROM user_accounts WHERE player_id = ?').get(player.id);
  if (!account || !account.password_hash) {
    return res.status(401).send(authPage({ title: 'Sign In', error: 'Your account has not been activated yet. Check your email for an invite link, or contact your administrator.', body: loginFormBody() }));
  }
  const match = await bcrypt.compare(password || '', account.password_hash);
  if (!match) {
    return res.status(401).send(authPage({ title: 'Sign In', error: 'Invalid email or password.', body: loginFormBody() }));
  }

  setSessionCookie(res, { role: 'player', playerId: player.id });
  res.redirect('/');
}));

router.get('/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/login');
});

// ===== MOBILE AUTH =====
// Returns a long-lived Bearer token for native mobile apps.
// Same credential check as /login but responds with JSON instead of a redirect.
router.post('/api/auth/token', loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body;
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  if (!email || !email.trim()) {
    // Admin login (blank email)
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signSession({ role: 'admin', csrf: crypto.randomBytes(16).toString('hex'), exp: Date.now() + THIRTY_DAYS });
    return res.json({ token, role: 'admin', playerId: null });
  }

  const db = getDB();
  const player = db.prepare('SELECT * FROM players WHERE LOWER(email) = LOWER(?)').get([email.trim()]);
  if (!player) return res.status(401).json({ error: 'Invalid email or password' });
  const account = db.prepare('SELECT * FROM user_accounts WHERE player_id = ?').get(player.id);
  if (!account || !account.password_hash) return res.status(401).json({ error: 'Account not yet activated' });
  const match = await bcrypt.compare(password || '', account.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });

  const token = signSession({ role: 'player', playerId: player.id, csrf: crypto.randomBytes(16).toString('hex'), exp: Date.now() + THIRTY_DAYS });
  res.json({ token, role: 'player', playerId: player.id });
}));

// ===== INVITE (first-time account setup) =====

router.get('/invite/:token', (req, res) => {
  const db = getDB();
  const account = db.prepare('SELECT * FROM user_accounts WHERE invite_token = ?').get(req.params.token);
  if (!account || !account.invite_expires || new Date(account.invite_expires) < new Date()) {
    return res.send(authPage({ title: 'Invalid Link', body: `<p style="font-size:13px;color:#6b7e93;margin-bottom:20px">This invite link is invalid or has expired. Contact your administrator for a new one.</p><div class="link-row"><a href="/login">Back to login</a></div>` }));
  }
  const player = db.prepare('SELECT name FROM players WHERE id = ?').get(account.player_id);
  res.send(authPage({
    title: 'Activate Your Account',
    info: `Welcome, ${serverEsc(player?.name || '')}! Choose a password to activate your account.`,
    body: inviteFormBody(req.params.token),
  }));
});

router.post('/invite/:token', wrap(async (req, res) => {
  const db = getDB();
  const account = db.prepare('SELECT * FROM user_accounts WHERE invite_token = ?').get(req.params.token);
  if (!account || !account.invite_expires || new Date(account.invite_expires) < new Date()) {
    return res.send(authPage({ title: 'Invalid Link', body: `<p style="font-size:13px;color:#6b7e93;margin-bottom:20px">This invite link is invalid or has expired.</p><div class="link-row"><a href="/login">Back to login</a></div>` }));
  }
  const { password, confirm } = req.body;
  if (!password || password.length < 8) {
    return res.send(authPage({ title: 'Activate Your Account', error: 'Password must be at least 8 characters.', body: inviteFormBody(req.params.token) }));
  }
  if (password !== confirm) {
    return res.send(authPage({ title: 'Activate Your Account', error: 'Passwords do not match.', body: inviteFormBody(req.params.token) }));
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE user_accounts SET password_hash = ?, invite_token = NULL, invite_expires = NULL WHERE player_id = ?').run(hash, account.player_id);
  setSessionCookie(res, { role: 'player', playerId: account.player_id });
  res.redirect('/');
}));

// ===== PASSWORD RESET =====

router.get('/reset-password/:token', (req, res) => {
  const db = getDB();
  const account = db.prepare('SELECT * FROM user_accounts WHERE reset_token = ?').get(req.params.token);
  if (!account || !account.reset_expires || new Date(account.reset_expires) < new Date()) {
    return res.send(authPage({ title: 'Invalid Link', body: `<p style="font-size:13px;color:#6b7e93;margin-bottom:20px">This password reset link is invalid or has expired. Contact your administrator for a new one.</p><div class="link-row"><a href="/login">Back to login</a></div>` }));
  }
  res.send(authPage({ title: 'Reset Password', body: resetFormBody(req.params.token) }));
});

router.post('/reset-password/:token', wrap(async (req, res) => {
  const db = getDB();
  const account = db.prepare('SELECT * FROM user_accounts WHERE reset_token = ?').get(req.params.token);
  if (!account || !account.reset_expires || new Date(account.reset_expires) < new Date()) {
    return res.send(authPage({ title: 'Invalid Link', body: `<p style="font-size:13px;color:#6b7e93;margin-bottom:20px">This password reset link is invalid or has expired.</p><div class="link-row"><a href="/login">Back to login</a></div>` }));
  }
  const { password, confirm } = req.body;
  if (!password || password.length < 8) {
    return res.send(authPage({ title: 'Reset Password', error: 'Password must be at least 8 characters.', body: resetFormBody(req.params.token) }));
  }
  if (password !== confirm) {
    return res.send(authPage({ title: 'Reset Password', error: 'Passwords do not match.', body: resetFormBody(req.params.token) }));
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE user_accounts SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE player_id = ?').run(hash, account.player_id);
  setSessionCookie(res, { role: 'player', playerId: account.player_id });
  res.redirect('/');
}));

router.get('/forgot-password', (req, res) => {
  res.send(authPage({
    title: 'Forgot Password',
    body: `<p style="font-size:13px;color:#6b7e93;margin-bottom:20px">Contact your administrator to send you a password reset link.</p>
    <div class="link-row"><a href="/login">Back to login</a></div>`,
  }));
});

module.exports = router;
