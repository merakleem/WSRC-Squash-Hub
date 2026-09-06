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

// The sign-in chrome: a full-bleed court photo under a navy gradient, with a
// frosted panel on the right. The invite, reset and forgot-password pages
// render through the same shell, so they inherit it for free.
//
// `heading`/`sub` name the panel; `link` is the centred link under it, and
// `variant: 'login'` drops the panel heading and field labels on mobile
// (the design puts the form straight on the gradient there, where "Sign in"
// above a Sign in button is noise — the other pages keep theirs, since
// "Activate your account" is the only thing naming the task). Everything
// dropped visually stays in the accessibility tree.
function authPage({ title, heading, sub, body, error, info, link, variant }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title} — Play WSRC</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1533;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow-x: hidden;
    }
    .shot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 70%; }
    .veil { position: absolute; inset: 0; background: linear-gradient(120deg, rgba(15,21,51,.9) 0%, rgba(30,39,88,.6) 50%, rgba(15,21,51,.75) 100%); }

    .row {
      position: relative;
      width: min(1040px, 100% - 80px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 60px;
    }
    .intro { display: flex; flex-direction: column; gap: 28px; max-width: 440px; }
    .crest { height: 88px; width: auto; align-self: flex-start; }
    .headline {
      font-family: 'Barlow', sans-serif;
      font-size: 52px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -.015em;
      color: #fff;
    }
    .blurb { font-size: 16px; line-height: 1.5; color: rgba(255,255,255,.78); }

    .panel {
      width: 400px;
      flex: none;
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.16);
      -webkit-backdrop-filter: blur(18px);
      backdrop-filter: blur(18px);
      border-radius: 18px;
      padding: 36px;
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    @supports not ((backdrop-filter: blur(18px)) or (-webkit-backdrop-filter: blur(18px))) {
      .panel { background: rgba(30,39,88,.55); }
    }
    .panel-head { display: flex; flex-direction: column; gap: 4px; }
    h1 { font-family: 'Barlow', sans-serif; font-size: 24px; font-weight: 700; color: #fff; }
    .panel-sub { font-size: 13.5px; color: rgba(255,255,255,.7); }

    form { display: flex; flex-direction: column; gap: 22px; }
    .fields { display: flex; flex-direction: column; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,.88); }
    input[type=email], input[type=password], input[type=text] {
      width: 100%;
      height: 46px;
      padding: 0 14px;
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 10px;
      font-family: inherit;
      font-size: 15px;
      font-weight: 400;
      background: rgba(255,255,255,.1);
      color: #fff;
      outline: none;
      transition: background 120ms ease, border-color 120ms ease;
    }
    input::placeholder { color: rgba(255,255,255,.5); }
    input:focus { border-color: #fff; background: rgba(255,255,255,.16); }
    button {
      height: 48px;
      border: none;
      border-radius: 10px;
      background: #fff;
      color: #1e2758;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 120ms ease;
    }
    button:hover { background: #e9ecf7; }

    .foot-link { font-size: 13px; font-weight: 500; text-align: center; color: rgba(255,255,255,.8); text-decoration: none; transition: color 120ms ease; }
    .foot-link:hover { color: #fff; }
    .error { font-size: 13px; color: #ffb4a8; }
    .info { background: rgba(255,255,255,.14); color: #fff; border-radius: 10px; padding: 10px 14px; font-size: 13px; }
    .note { font-size: 13.5px; line-height: 1.5; color: rgba(255,255,255,.78); }

    /* Dropped from view, kept for screen readers. */
    .quiet {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }

    @media (max-width: 1140px) {
      .headline { font-size: 44px; }
    }

    @media (max-width: 899px) {
      body { align-items: stretch; }
      .shot { object-position: 62% 60%; }
      .veil { background: linear-gradient(180deg, rgba(15,21,51,.55) 0%, rgba(15,21,51,.82) 45%, rgba(15,21,51,.96) 100%); }
      .row {
        width: 100%;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-end;
        gap: 28px;
        padding: 28px 24px calc(28px + env(safe-area-inset-bottom));
      }
      .intro { gap: 16px; max-width: none; }
      .crest { height: 64px; }
      .headline { font-size: 34px; line-height: 1.02; }
      .blurb { display: none; }
      /* The form sits straight on the gradient — no panel. */
      .panel {
        width: 100%;
        background: none;
        border: none;
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
        border-radius: 0;
        padding: 0;
        gap: 16px;
      }
      form { gap: 12px; }
      input[type=email], input[type=password], input[type=text] {
        height: 50px;
        padding: 0 16px;
        border-radius: 12px;
        font-size: 16px; /* keeps iOS from zooming on focus */
      }
      button { height: 52px; margin-top: 6px; border-radius: 12px; font-size: 16px; }
      .foot-link { font-size: 14px; padding: 8px 0; }
      .is-login .panel-head,
      .is-login .field > span { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    }
  </style>
</head>
<body${variant === 'login' ? ' class="is-login"' : ''}>
  <img class="shot" src="/assets/court-racquets.jpg" alt="">
  <div class="veil"></div>
  <div class="row">
    <div class="intro">
      <img class="crest" src="/assets/WSRC_Logo_Grey%203.png" alt="WSRC">
      <h2 class="headline">Your club,<br>on your schedule.</h2>
      <p class="blurb">Court bookings, ladder standings and league results for WSRC members.</p>
    </div>
    <div class="panel">
      <div class="panel-head">
        <h1>${heading || title}</h1>
        ${sub ? `<p class="panel-sub">${sub}</p>` : ''}
      </div>
      ${info  ? `<div class="info">${info}</div>` : ''}
      ${body}
      ${error ? `<div class="error">${error}</div>` : ''}
      ${link ? `<a class="foot-link" href="${link.href}">${link.text}</a>` : ''}
    </div>
  </div>
  <script>
    // The mobile layout drops the labels, so the placeholders carry the field
    // names there instead. Runs during parse, before first paint.
    if (window.matchMedia('(max-width: 899px)').matches) {
      document.querySelectorAll('input[data-mph]').forEach(function (i) { i.placeholder = i.dataset.mph; });
    }
  </script>
</body>
</html>`;
}

// data-mph is the placeholder the mobile layout swaps in, where the label is
// dropped. Field names, actions and autocomplete values are unchanged.
function loginFormBody() {
  return `<form method="POST" action="/login">
    <div class="fields">
      <label class="field"><span>Email</span>
        <input type="email" name="email" placeholder="your@email.com" data-mph="Email" autocomplete="email">
      </label>
      <label class="field"><span>Password</span>
        <input type="password" name="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" data-mph="Password" autofocus autocomplete="current-password">
      </label>
    </div>
    <button type="submit">Sign in</button>
  </form>`;
}

function passwordFormBody(action, submitLabel) {
  return `<form method="POST" action="${action}">
    <div class="fields">
      <label class="field"><span>New password</span>
        <input type="password" name="password" placeholder="At least 8 characters" autofocus autocomplete="new-password">
      </label>
      <label class="field"><span>Confirm password</span>
        <input type="password" name="confirm" placeholder="Repeat password" autocomplete="new-password">
      </label>
    </div>
    <button type="submit">${submitLabel}</button>
  </form>`;
}

function inviteFormBody(token) {
  return passwordFormBody(`/invite/${serverEsc(token)}`, 'Activate account');
}

function resetFormBody(token) {
  return passwordFormBody(`/reset-password/${serverEsc(token)}`, 'Reset password');
}

// Every sign-in render shares one heading, subtitle and footer link.
function loginPage(extra = {}) {
  return authPage({
    title: 'Sign In',
    heading: 'Sign in',
    sub: 'Welcome back to Play WSRC.',
    body: loginFormBody(),
    link: { href: '/forgot-password', text: 'Forgot password?' },
    variant: 'login',
    ...extra,
  });
}

// A page with a message instead of a form: expired links, and the
// forgot-password note.
function messagePage(title, heading, message) {
  return authPage({
    title,
    heading,
    body: `<p class="note">${message}</p>`,
    link: { href: '/login', text: 'Back to login' },
  });
}

// ===== LOGIN / LOGOUT =====

router.get('/login', (req, res) => {
  if (getSession(req)) return res.redirect('/');
  res.send(loginPage());
});

router.post('/login', loginLimiter, wrap(async (req, res) => {
  if (!req.body) return res.status(400).send(loginPage({ error: 'Bad request.' }));
  const { email, password } = req.body;

  // Admin login — email blank, password matches env var
  if (!email || !email.trim()) {
    if (password === ADMIN_PASSWORD) {
      setSessionCookie(res, { role: 'admin' });
      return res.redirect('/');
    }
    return res.status(401).send(loginPage({ error: 'Incorrect password.' }));
  }

  // Player login — email + bcrypt password via user_accounts
  const db = getDB();
  const player = db.prepare('SELECT * FROM players WHERE LOWER(email) = LOWER(?)').get([email.trim()]);
  if (!player) {
    return res.status(401).send(loginPage({ error: 'Invalid email or password.' }));
  }
  const account = db.prepare('SELECT * FROM user_accounts WHERE player_id = ?').get(player.id);
  if (!account || !account.password_hash) {
    return res.status(401).send(loginPage({ error: 'Your account has not been activated yet. Check your email for an invite link, or contact your administrator.' }));
  }
  const match = await bcrypt.compare(password || '', account.password_hash);
  if (!match) {
    return res.status(401).send(loginPage({ error: 'Invalid email or password.' }));
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
    return res.send(messagePage('Invalid Link', 'Link expired', 'This invite link is invalid or has expired. Contact your administrator for a new one.'));
  }
  const player = db.prepare('SELECT name FROM players WHERE id = ?').get(account.player_id);
  res.send(authPage({
    title: 'Activate Your Account',
    heading: 'Activate your account',
    info: `Welcome, ${serverEsc(player?.name || '')}! Choose a password to activate your account.`,
    body: inviteFormBody(req.params.token),
  }));
});

router.post('/invite/:token', wrap(async (req, res) => {
  const db = getDB();
  const account = db.prepare('SELECT * FROM user_accounts WHERE invite_token = ?').get(req.params.token);
  if (!account || !account.invite_expires || new Date(account.invite_expires) < new Date()) {
    return res.send(messagePage('Invalid Link', 'Link expired', 'This invite link is invalid or has expired.'));
  }
  const { password, confirm } = req.body;
  if (!password || password.length < 8) {
    return res.send(authPage({ title: 'Activate Your Account', heading: 'Activate your account', error: 'Password must be at least 8 characters.', body: inviteFormBody(req.params.token) }));
  }
  if (password !== confirm) {
    return res.send(authPage({ title: 'Activate Your Account', heading: 'Activate your account', error: 'Passwords do not match.', body: inviteFormBody(req.params.token) }));
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
    return res.send(messagePage('Invalid Link', 'Link expired', 'This password reset link is invalid or has expired. Contact your administrator for a new one.'));
  }
  res.send(authPage({ title: 'Reset Password', heading: 'Reset password', body: resetFormBody(req.params.token) }));
});

router.post('/reset-password/:token', wrap(async (req, res) => {
  const db = getDB();
  const account = db.prepare('SELECT * FROM user_accounts WHERE reset_token = ?').get(req.params.token);
  if (!account || !account.reset_expires || new Date(account.reset_expires) < new Date()) {
    return res.send(messagePage('Invalid Link', 'Link expired', 'This password reset link is invalid or has expired.'));
  }
  const { password, confirm } = req.body;
  if (!password || password.length < 8) {
    return res.send(authPage({ title: 'Reset Password', heading: 'Reset password', error: 'Password must be at least 8 characters.', body: resetFormBody(req.params.token) }));
  }
  if (password !== confirm) {
    return res.send(authPage({ title: 'Reset Password', heading: 'Reset password', error: 'Passwords do not match.', body: resetFormBody(req.params.token) }));
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE user_accounts SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE player_id = ?').run(hash, account.player_id);
  setSessionCookie(res, { role: 'player', playerId: account.player_id });
  res.redirect('/');
}));

router.get('/forgot-password', (req, res) => {
  res.send(messagePage('Forgot Password', 'Forgot password',
    'Contact your administrator to send you a password reset link.'));
});


module.exports = router;
