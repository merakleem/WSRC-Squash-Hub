require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { initDB, getDB } = require('./database/db');
const playerService = require('./services/playerService');
const leagueService = require('./services/leagueService');
const leagueModel = require('./models/leagueModel');
const ladderModel = require('./models/ladderModel');
const courtModel = require('./models/courtModel');
const bookingModel = require('./models/bookingModel');
const { getValidConfigurations } = require('./utils/helpers');

function serverEsc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'squash.db');
const ADMIN_PASSWORD = process.env.SITE_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = 'wsrc_session';

const missingVars = [
  !ADMIN_PASSWORD && 'SITE_PASSWORD',
  !SESSION_SECRET && 'SESSION_SECRET',
].filter(Boolean);

if (missingVars.length > 0) {
  console.error(`\n  ERROR: Missing required environment variable(s): ${missingVars.join(', ')}`);
  console.error('  Railway: set these in your project\'s Variables tab.');
  console.error('  Local: copy .env.example to .env and fill in the values.\n');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false }));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'An internal error occurred' });
  });

// ===== RATE LIMITERS =====

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// ===== SESSION TOKENS =====

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function signSession(payload) {
  const withExp = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const data = Buffer.from(JSON.stringify(withExp)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  return `${data}.${sig}`;
}

function verifySession(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const data = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('='));
  });
  return out;
}

function getSession(req) {
  return verifySession(parseCookies(req)[COOKIE_NAME]);
}

const SECURE_FLAG = process.env.NODE_ENV === 'production' ? '; Secure' : '';

function setSessionCookie(res, payload) {
  const csrf = crypto.randomBytes(16).toString('hex');
  const token = signSession({ ...payload, csrf });
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax${SECURE_FLAG}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${SECURE_FLAG}; Max-Age=0`);
}

// ===== AUTH HELPERS =====

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.redirect('/login');
  req.session = session;
  next();
}

function requireAdmin(req, res, next) {
  if (req.session?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireAdminPage(req, res, next) {
  const session = getSession(req);
  if (!session) return res.redirect('/login');
  if (session.role !== 'admin') return res.redirect('/');
  req.session = session;
  next();
}

function requireCsrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const token = req.headers['x-csrf-token'];
  if (!token || !req.session?.csrf || token !== req.session.csrf) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }
  next();
}


// ===== PAGE TEMPLATE =====

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

// ===== AUTH ROUTES =====

// Serve public assets before any auth check (login page needs the logo)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/login', (req, res) => {
  if (getSession(req)) return res.redirect('/');
  res.send(authPage({ title: 'Sign In', body: loginFormBody() }));
});

app.post('/login', loginLimiter, wrap(async (req, res) => {
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

app.get('/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/login');
});

// ===== INVITE (first-time account setup) =====

function inviteFormBody(token) {
  return `<form method="POST" action="/invite/${serverEsc(token)}">
    <label>New Password</label>
    <input type="password" name="password" placeholder="At least 8 characters" autofocus autocomplete="new-password">
    <label>Confirm Password</label>
    <input type="password" name="confirm" placeholder="Repeat password" autocomplete="new-password">
    <button type="submit">Activate Account</button>
  </form>`;
}

app.get('/invite/:token', (req, res) => {
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

app.post('/invite/:token', wrap(async (req, res) => {
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

function resetFormBody(token) {
  return `<form method="POST" action="/reset-password/${serverEsc(token)}">
    <label>New Password</label>
    <input type="password" name="password" placeholder="At least 8 characters" autofocus autocomplete="new-password">
    <label>Confirm Password</label>
    <input type="password" name="confirm" placeholder="Repeat password" autocomplete="new-password">
    <button type="submit">Reset Password</button>
  </form>`;
}

app.get('/reset-password/:token', (req, res) => {
  const db = getDB();
  const account = db.prepare('SELECT * FROM user_accounts WHERE reset_token = ?').get(req.params.token);
  if (!account || !account.reset_expires || new Date(account.reset_expires) < new Date()) {
    return res.send(authPage({ title: 'Invalid Link', body: `<p style="font-size:13px;color:#6b7e93;margin-bottom:20px">This password reset link is invalid or has expired. Contact your administrator for a new one.</p><div class="link-row"><a href="/login">Back to login</a></div>` }));
  }
  res.send(authPage({ title: 'Reset Password', body: resetFormBody(req.params.token) }));
});

app.post('/reset-password/:token', wrap(async (req, res) => {
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

app.get('/forgot-password', (req, res) => {
  res.send(authPage({
    title: 'Forgot Password',
    body: `<p style="font-size:13px;color:#6b7e93;margin-bottom:20px">Contact your administrator to send you a password reset link.</p>
    <div class="link-row"><a href="/login">Back to login</a></div>`,
  }));
});

// ===== HEALTH CHECK =====

app.get('/health', (req, res) => res.sendStatus(200));

// ===== PUBLIC LEAGUE PAGE =====

app.get('/:slug/:token', (req, res, next) => {
  if (!/^[0-9a-f]{4}$/i.test(req.params.token)) return next();
  res.send(buildPublicPage());
});

app.get('/api/public/league/:token', async (req, res) => {
  try {
    const db = getDB();
    const row = db.prepare('SELECT id FROM leagues WHERE public_token = ?').get(req.params.token);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const league = await leagueService.getFullLeague(row.id);
    if (!league) return res.status(404).json({ error: 'Not found' });
    res.json(league);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildPublicPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>League Schedule — Play WSRC</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="icon" type="image/png" href="/assets/logo-blue.png">
  <style>
    :root { --primary:#1e2758; --accent:#3a4db5; --border:#e2e8f0; --muted:#64748b; --bg:#f4f6fb; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:var(--bg); color:#1e293b; font-size:15px; line-height:1.5; }
    h1,h2,h3,h4,.header-title,.card-title { font-family:'Barlow',-apple-system,BlinkMacSystemFont,sans-serif; }

    .header { background:var(--primary); color:#fff; padding:28px 20px 24px; }
    .header-brand { display:flex; align-items:center; gap:8px; margin-bottom:14px; opacity:0.65; }
    .header-brand img { width:20px; height:20px; object-fit:contain; }
    .header-brand-text { font-size:12px; font-weight:500; letter-spacing:0.03em; }
    .header-title { font-size:28px; font-weight:800; line-height:1.15; }

    .content { max-width:660px; margin:0 auto; padding:28px 16px calc(56px + env(safe-area-inset-bottom)); }
    .section { margin-bottom:36px; }
    .section-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:12px; padding-left:2px; }

    .card { background:#fff; border-radius:12px; border:1px solid var(--border); margin-bottom:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.04); }
    .card-header { display:flex; justify-content:space-between; align-items:center; padding:16px 18px; cursor:pointer; user-select:none; gap:12px; }
    .card-header:active { background:#f8fafc; }
    .card-title { font-weight:700; font-size:15px; }
    .card-sub { font-size:13px; color:var(--muted); margin-top:2px; }
    .card-toggle { font-size:22px; font-weight:300; color:#94a3b8; line-height:1; flex-shrink:0; transition:transform 0.2s; }
    .card.open .card-toggle { transform:rotate(45deg); }
    .card-body { display:none; border-top:1px solid var(--border); }
    .card.open .card-body { display:block; }

    .roster-row { display:flex; align-items:center; gap:10px; padding:12px 18px; border-bottom:1px solid #f1f5f9; font-size:14px; }
    .roster-row:last-child { border-bottom:none; }
    .div-chip { font-size:10px; font-weight:700; background:var(--primary); color:#fff; border-radius:4px; padding:2px 7px; white-space:nowrap; flex-shrink:0; }

    .matchup-block { padding:16px 18px; border-bottom:1px solid var(--border); }
    .matchup-block:last-child { border-bottom:none; }
    .matchup-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); margin-bottom:10px; }

    .match-row { display:grid; grid-template-columns:auto 1fr auto; align-items:center; column-gap:12px; padding:9px 0; border-bottom:1px solid #f8fafc; font-size:14px; }
    .match-row:last-child { border-bottom:none; }
    .match-div { font-size:10px; font-weight:700; background:var(--accent); color:#fff; border-radius:4px; padding:2px 7px; white-space:nowrap; }
    .match-players { font-weight:500; }
    .match-vs { color:#94a3b8; font-size:12px; margin:0 4px; font-weight:400; }
    .match-win { color:var(--accent); font-weight:700; }
    .match-right { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
    .match-score { font-weight:700; font-size:14px; white-space:nowrap; }
    .match-meta { font-size:11px; color:var(--muted); white-space:nowrap; }
    .bye-label { font-size:13px; color:var(--muted); font-style:italic; padding:14px 18px; }

    .loading { text-align:center; padding:80px 16px; color:var(--muted); font-size:15px; }
    .error-msg { text-align:center; padding:80px 16px; color:#ef4444; }

    @media(max-width:480px) {
      .header { padding:22px 16px 20px; }
      .header-title { font-size:23px; }
      .content { padding:20px 12px 48px; }
      .card-header { padding:14px 14px; }
      .matchup-block { padding:14px 14px; }
      .roster-row { padding:11px 14px; }
      .match-row { column-gap:8px; }
    }
  </style>
</head>
<body>
  <div id="root"><div class="loading">Loading schedule…</div></div>
  <script>
    var parts = location.pathname.split('/').filter(Boolean);
    var token = parts[parts.length - 1] || '';
    fetch('/api/public/league/' + token)
      .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(render)
      .catch(function() {
        document.getElementById('root').innerHTML = '<div class="error-msg">League not found.</div>';
      });

    function toggleCard(el) {
      el.closest('.card').classList.toggle('open');
    }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function fmtDate(d) {
      if (!d) return '';
      var p = d.split('-').map(Number);
      return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
    }

    function fmtTime(t) {
      if (!t) return '';
      var p = t.split(':').map(Number);
      return (p[0]%12||12)+':'+(p[1]<10?'0':'')+p[1]+(p[0]>=12?'pm':'am');
    }

    function render(league) {
      var isModern = league.setup_type === 'modern';
      var playerDiv = {};
      (league.players||[]).forEach(function(p) {
        playerDiv[p.player_id] = { name: p.division_name, level: p.division_level };
      });

      var rostersHTML;
      if (isModern) {
        rostersHTML = (league.divisions||[]).map(function(div) {
          var members = (league.players||[])
            .filter(function(p){ return p.division_id === div.id; })
            .sort(function(a,b){ return a.skill_rank - b.skill_rank; });
          var rows = members.map(function(m) {
            return '<div class="roster-row"><span>'+esc(m.player_name)+'</span></div>';
          }).join('');
          return '<div class="card">'
            +'<div class="card-header" onclick="toggleCard(this)">'
            +'<div class="card-title">'+esc(div.name)+'</div>'
            +'<span class="card-toggle">+</span>'
            +'</div>'
            +'<div class="card-body">'+rows+'</div>'
            +'</div>';
        }).join('');
      } else {
        rostersHTML = (league.teams||[]).map(function(team) {
          var members = (league.players||[])
            .filter(function(p){ return p.team_id === team.id; })
            .sort(function(a,b){ return a.division_level - b.division_level; });
          var rows = members.map(function(m) {
            return '<div class="roster-row">'
              +'<span class="div-chip">'+esc(m.division_name.replace(/^Division\s*/i,'D'))+'</span>'
              +'<span>'+esc(m.player_name)+'</span>'
              +'</div>';
          }).join('');
          return '<div class="card">'
            +'<div class="card-header" onclick="toggleCard(this)">'
            +'<div class="card-title">'+esc(team.name)+'</div>'
            +'<span class="card-toggle">+</span>'
            +'</div>'
            +'<div class="card-body">'+rows+'</div>'
            +'</div>';
        }).join('');
      }

      var scheduleHTML = (league.weeks||[]).map(function(week) {
        var muHTML = week.matchups.map(function(mu) {
          if (!isModern && mu.bye_team_id) {
            return '<div class="bye-label">'+esc(mu.bye_team_name)+' \u2014 Bye week</div>';
          }
          var matchesHTML = (mu.matches||[]).map(function(m) {
            var div = playerDiv[m.player1_id] || {};
            var p1 = m.sub1_name || m.player1_name;
            var p2 = m.sub2_name || m.player2_name;
            var p1win = m.winner_id && m.winner_id === m.player1_id;
            var p2win = m.winner_id && m.winner_id === m.player2_id;
            var hasScore = m.player1_score != null && m.player2_score != null;
            var scoreHTML = hasScore ? '<div class="match-score">'+m.player1_score+'&ndash;'+m.player2_score+'</div>' : '';
            var meta = '';
            if (league.schedule_courts && m.court_number) {
              meta = 'Court '+m.court_number+(m.match_time ? ' &middot; '+fmtTime(m.match_time) : '');
            } else if (m.match_time) {
              meta = fmtTime(m.match_time);
            }
            return '<div class="match-row">'
              +(!isModern ? '<span class="match-div">'+esc((div.name||'').replace(/^Division\s*/i,'D'))+'</span>' : '')
              +'<div class="match-players">'
              +'<span class="'+(p1win?'match-win':'')+'">'+esc(p1)+'</span>'
              +' <span class="match-vs">vs</span> '
              +'<span class="'+(p2win?'match-win':'')+'">'+esc(p2)+'</span>'
              +'</div>'
              +'<div class="match-right">'
              +scoreHTML
              +(meta ? '<div class="match-meta">'+meta+'</div>' : '')
              +'</div>'
              +'</div>';
          }).join('');
          var muTitle = isModern
            ? esc(mu.division_name||'')
            : esc(mu.team1_name)+' vs '+esc(mu.team2_name);
          var byesHTML = '';
          if (isModern) {
            var divByes = (week.byes||[]).filter(function(b){ return b.division_id === mu.division_id; });
            if (divByes.length) {
              byesHTML = '<div class="bye-label" style="font-size:12px;padding:6px 0 2px">Bye: '
                +divByes.map(function(b){ return esc(b.player_name); }).join(', ')+'</div>';
            }
          }
          return '<div class="matchup-block">'
            +'<div class="matchup-title">'+muTitle+'</div>'
            +matchesHTML
            +byesHTML
            +'</div>';
        }).join('');
        return '<div class="card">'
          +'<div class="card-header" onclick="toggleCard(this)">'
          +'<div>'
          +'<div class="card-title">Week '+week.week_number+'</div>'
          +'<div class="card-sub">'+fmtDate(week.date)+'</div>'
          +'</div>'
          +'<span class="card-toggle">+</span>'
          +'</div>'
          +'<div class="card-body">'+muHTML+'</div>'
          +'</div>';
      }).join('');

      document.getElementById('root').innerHTML =
        '<div class="header">'
        +'<div class="header-brand"><img src="/assets/WSRC_Logo_Grey%203.png" alt="WSRC"><span class="header-brand-text">Play WSRC</span></div>'
        +'<div class="header-title">'+esc(league.name)+'</div>'
        +'</div>'
        +'<div class="content">'
        +'<div class="section"><div class="section-label">Rosters</div>'+rostersHTML+'</div>'
        +'<div class="section"><div class="section-label">Schedule</div>'+scheduleHTML+'</div>'
        +'</div>';
    }
  </script>
</body>
</html>`;
}

// ===== PROTECT ALL OTHER ROUTES =====

app.use((req, res, next) => {
  const session = getSession(req);
  if (!session) return res.redirect('/login');
  req.session = session;
  next();
});

// CSRF validation on all mutating API calls
app.use('/api', requireCsrf);

app.use(express.static(path.join(__dirname, 'renderer'), { etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));

// ===== API: WHO AM I =====

app.get('/api/me', (req, res) => {
  res.json({ role: req.session.role, playerId: req.session.playerId || null, csrf: req.session.csrf || null });
});

// ===== PLAYERS =====

app.get('/api/players', wrap(async (req, res) => {
  res.json(await playerService.getAllPlayers());
}));

app.post('/api/players', requireAdmin, wrap(async (req, res) => {
  const player = await playerService.addPlayer(req.body);
  res.json(player);
}));

app.put('/api/players/:id', requireAdmin, wrap(async (req, res) => {
  const player = await playerService.updatePlayer({ ...req.body, id: Number(req.params.id) });
  res.json(player);
}));

app.delete('/api/players/:id', requireAdmin, wrap(async (req, res) => {
  await playerService.deletePlayer(Number(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/players/:id/send-invite', requireAdmin, emailLimiter, wrap(async (req, res) => {
  const playerId = Number(req.params.id);
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const db = getDB();
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  db.prepare(`INSERT INTO user_accounts (player_id, invite_token, invite_expires)
    VALUES (?, ?, ?)
    ON CONFLICT (player_id) DO UPDATE SET invite_token = excluded.invite_token, invite_expires = excluded.invite_expires`
  ).run(playerId, token, expires);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const inviteUrl = `${baseUrl}/invite/${token}`;

  if (RESEND_API_KEY && player.email) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Play WSRC <no-reply@playwsrc.ca>',
        to: player.email,
        subject: 'Activate your Play WSRC account',
        html: `<p>Hi ${serverEsc(player.name)},</p>
<p>You've been invited to create an account on Play WSRC.</p>
<p><a href="${serverEsc(inviteUrl)}">Click here to activate your account</a></p>
<p>This link expires in 72 hours.</p>`,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.message || 'Failed to send email.', inviteUrl });
    }
    return res.json({ ok: true, emailSent: true, inviteUrl });
  }

  res.json({ ok: true, emailSent: false, inviteUrl });
}));

app.post('/api/players/:id/send-reset', requireAdmin, emailLimiter, wrap(async (req, res) => {
  const playerId = Number(req.params.id);
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const db = getDB();
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const account = db.prepare('SELECT * FROM user_accounts WHERE player_id = ?').get(playerId);
  if (!account || !account.password_hash) return res.status(400).json({ error: 'This player has not activated their account yet. Send an invite instead.' });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare('UPDATE user_accounts SET reset_token = ?, reset_expires = ? WHERE player_id = ?').run(token, expires, playerId);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const resetUrl = `${baseUrl}/reset-password/${token}`;

  if (RESEND_API_KEY && player.email) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Play WSRC <no-reply@playwsrc.ca>',
        to: player.email,
        subject: 'Reset your Play WSRC password',
        html: `<p>Hi ${serverEsc(player.name)},</p>
<p>A password reset was requested for your Play WSRC account.</p>
<p><a href="${serverEsc(resetUrl)}">Click here to reset your password</a></p>
<p>This link expires in 24 hours. If you did not request this, you can ignore this email.</p>`,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.message || 'Failed to send email.', resetUrl });
    }
    return res.json({ ok: true, emailSent: true, resetUrl });
  }

  res.json({ ok: true, emailSent: false, resetUrl });
}));

app.get('/api/players/records', wrap(async (req, res) => {
  const rows = await playerService.getAllPlayerRecords();
  const map = {};
  rows.forEach((r) => { map[r.id] = { wins: r.wins || 0, losses: r.losses || 0 }; });
  res.json(map);
}));

app.get('/api/players/:id/history', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [player, history, upcoming, records] = await Promise.all([
    playerService.getPlayerById(id),
    playerService.getPlayerMatchHistory(id),
    playerService.getPlayerUpcomingMatches(id),
    playerService.getAllPlayerRecords(),
  ]);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const rec = records.find((r) => r.id === id) || { wins: 0, losses: 0 };
  const db = getDB();
  const account = db.prepare('SELECT password_hash FROM user_accounts WHERE player_id = ?').get(id);
  const accountStatus = account?.password_hash ? 'verified' : (account ? 'pending' : 'none');
  res.json({ ...player, wins: rec.wins || 0, losses: rec.losses || 0, history, upcoming, accountStatus });
}));

// ===== LEAGUES =====

app.get('/api/leagues', wrap(async (req, res) => {
  const leagues = await leagueModel.getAllLeagues();
  const db = getDB();
  const memberships = db.prepare('SELECT league_id, player_id FROM league_players').all();
  const memberMap = {};
  for (const row of memberships) {
    if (!memberMap[row.league_id]) memberMap[row.league_id] = [];
    memberMap[row.league_id].push(row.player_id);
  }
  // Auto-compute completed status: all matches must be scored or skipped
  const matchCounts = db.prepare(`
    SELECT w.league_id,
      COUNT(*) AS total,
      SUM(CASE WHEN m.player1_score IS NOT NULL OR m.skipped = 1 THEN 1 ELSE 0 END) AS done
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w ON tm.week_id = w.id
    GROUP BY w.league_id
  `).all();
  const countMap = {};
  for (const row of matchCounts) countMap[row.league_id] = row;
  res.json(leagues.map((l) => {
    const counts = countMap[l.id];
    const status = counts && counts.total > 0 && counts.done === counts.total ? 'completed' : 'active';
    return { ...l, player_ids: memberMap[l.id] || [], status };
  }));
}));

app.get('/api/leagues/:id', wrap(async (req, res) => {
  const league = await leagueService.getFullLeague(Number(req.params.id));
  if (!league) return res.status(404).json({ error: 'League not found' });
  res.json(league);
}));

app.post('/api/leagues', requireAdmin, wrap(async (req, res) => {
  const leagueId = await leagueService.createLeague(req.body);
  res.json(leagueId);
}));

app.delete('/api/leagues/:id', requireAdmin, wrap(async (req, res) => {
  await leagueModel.deleteLeague(Number(req.params.id));
  res.json({ ok: true });
}));

// ===== MATCHES =====

app.put('/api/matches/:id/timing', requireAdmin, wrap(async (req, res) => {
  const matchId = Number(req.params.id);
  const { matchTime, courtNumber, courtId } = req.body;

  const db = getDB();

  const ctx = db.prepare(`
    SELECT l.schedule_courts, l.num_courts, tm.week_id
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w ON tm.week_id = w.id
    JOIN leagues l ON w.league_id = l.id
    WHERE m.id = ?
  `).get(matchId);

  if (!ctx) return res.status(404).json({ error: 'Match not found' });

  let warning = null;

  if (matchTime) {
    if (courtId) {
      // New court system: block same court_id + time in same week
      const conflict = db.prepare(`
        SELECT COUNT(*) AS cnt FROM matches m
        JOIN team_matchups tm ON m.matchup_id = tm.id
        WHERE tm.week_id = ? AND m.court_id = ? AND m.match_time = ? AND m.id != ?
      `).get(ctx.week_id, courtId, matchTime, matchId);
      if (conflict.cnt > 0) {
        const courtName = db.prepare('SELECT name FROM courts WHERE id = ?').get(courtId)?.name || `Court ${courtId}`;
        return res.status(409).json({ error: `${courtName} is already booked at ${matchTime} this week.` });
      }
    } else if (ctx.schedule_courts && courtNumber) {
      // Old court system: block same court_number + time in same week
      const conflict = db.prepare(`
        SELECT COUNT(*) AS cnt FROM matches m
        JOIN team_matchups tm ON m.matchup_id = tm.id
        WHERE tm.week_id = ? AND m.court_number = ? AND m.match_time = ? AND m.id != ?
      `).get(ctx.week_id, courtNumber, matchTime, matchId);
      if (conflict.cnt > 0) {
        return res.status(409).json({ error: `Court ${courtNumber} is already booked at ${matchTime} this week.` });
      }
    }

    if (!courtId && ctx.num_courts > 0) {
      const atSameTime = db.prepare(`
        SELECT COUNT(*) AS cnt FROM matches m
        JOIN team_matchups tm ON m.matchup_id = tm.id
        WHERE tm.week_id = ? AND m.match_time = ? AND m.id != ?
      `).get(ctx.week_id, matchTime, matchId);
      if (atSameTime.cnt >= ctx.num_courts) {
        warning = `All ${ctx.num_courts} court${ctx.num_courts !== 1 ? 's' : ''} are already booked at ${matchTime} this week.`;
      }
    }
  }

  await leagueModel.updateMatchTiming(matchId, matchTime || null, courtId ? null : (courtNumber || null), courtId || null);
  res.json({ ok: true, warning });
}));

app.put('/api/matches/:id/score', requireAdmin, wrap(async (req, res) => {
  await leagueModel.updateMatchScore({ matchId: Number(req.params.id), submittedByPlayerId: null, ...req.body });
  res.json({ ok: true });
}));

// Player self-reporting: verify the caller is in the match, then map my/their score to p1/p2
app.put('/api/matches/:id/player-score', requireAuth, wrap(async (req, res) => {
  const matchId  = Number(req.params.id);
  const playerId = req.session.playerId;
  const myScore    = Number(req.body.myScore);
  const theirScore = Number(req.body.theirScore);

  const db = getDB();
  const match = db.prepare(`
    SELECT m.id, m.player1_id, m.player2_id, m.player1_score,
           s1.sub_player_id AS p1_sub, s2.sub_player_id AS p2_sub
    FROM matches m
    LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
    LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
    WHERE m.id = ?
  `).get(matchId);

  if (!match) return res.status(404).json({ error: 'Match not found' });

  if (match.player1_score !== null) {
    return res.status(409).json({ error: 'Score has already been reported for this match' });
  }

  const effP1 = match.p1_sub ?? match.player1_id;
  const effP2 = match.p2_sub ?? match.player2_id;
  const isP1  = effP1 === playerId;
  const isP2  = effP2 === playerId;

  if (!isP1 && !isP2) return res.status(403).json({ error: 'You are not a player in this match' });

  const p1Score = isP1 ? myScore : theirScore;
  const p2Score = isP2 ? myScore : theirScore;

  const valid = Number.isInteger(p1Score) && Number.isInteger(p2Score)
    && p1Score >= 0 && p1Score <= 3 && p2Score >= 0 && p2Score <= 3
    && (p1Score === 3 || p2Score === 3) && p1Score !== p2Score;

  if (!valid) return res.status(400).json({ error: 'Invalid score — one player must win 3 games (e.g. 3–1, 3–2)' });

  const winnerId = p1Score > p2Score ? match.player1_id : match.player2_id;
  await leagueModel.updateMatchScore({ matchId, player1Score: p1Score, player2Score: p2Score, winnerId, submittedByPlayerId: playerId });
  res.json({ ok: true });
}));

app.put('/api/matches/:id/skip', requireAdmin, wrap(async (req, res) => {
  await leagueModel.skipMatch(Number(req.params.id));
  res.json({ ok: true });
}));

app.put('/api/matches/:id/unskip', requireAdmin, wrap(async (req, res) => {
  await leagueModel.unskipMatch(Number(req.params.id));
  res.json({ ok: true });
}));

app.put('/api/matches/:id/sub', requireAdmin, wrap(async (req, res) => {
  const { originalPlayerId, subPlayerId } = req.body;
  await leagueModel.setMatchSub(Number(req.params.id), originalPlayerId, subPlayerId);
  res.json({ ok: true });
}));

app.delete('/api/matches/:id/sub', requireAdmin, wrap(async (req, res) => {
  const { originalPlayerId } = req.body;
  await leagueModel.removeMatchSub(Number(req.params.id), originalPlayerId);
  res.json({ ok: true });
}));

app.post('/api/leagues/:id/replace-player', requireAdmin, wrap(async (req, res) => {
  const { oldPlayerId, newPlayerId } = req.body;
  if (!oldPlayerId || !newPlayerId) return res.status(400).json({ error: 'oldPlayerId and newPlayerId are required' });
  await leagueModel.replacePlayerInLeague(Number(req.params.id), Number(oldPlayerId), Number(newPlayerId));
  res.json({ ok: true });
}));

app.put('/api/leagues/:id/sub-remaining', requireAdmin, wrap(async (req, res) => {
  const { originalPlayerId, subPlayerId } = req.body;
  const count = await leagueModel.setSubForRemaining(Number(req.params.id), originalPlayerId, subPlayerId);
  res.json({ ok: true, count });
}));

// ===== MESSAGE PLAYERS =====

app.post('/api/leagues/:id/message', requireAdmin, wrap(async (req, res) => {
  const { subject, body, attachments } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'Subject and body are required' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });

  const players = await leagueModel.getLeaguePlayers(Number(req.params.id));
  const recipients = players.filter((p) => p.player_email);

  if (recipients.length === 0) return res.json({ sent: 0 });


  let sent = 0;
  for (const player of recipients) {
    const htmlBody = body
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Play WSRC <no-reply@playwsrc.ca>`,
        to: [player.player_email],
        subject,
        html: `<p>${htmlBody}</p>`,
        ...(attachments && attachments.length ? { attachments } : {}),
      }),
    });
    if (response.ok) sent++;
  }

  res.json({ sent });
}));

// ===== LADDER =====

app.get('/api/ladder', wrap(async (req, res) => {
  res.json(await ladderModel.getLadder());
}));

// ===== ACTIVITY FEED =====

app.get('/api/activity', wrap(async (req, res) => {
  const db = getDB();

  // Build the same initial ranking as getLadder()
  const players = db.prepare(`
    SELECT id, club_locker_rating, exclude_from_ladder
    FROM players
    WHERE exclude_from_ladder = 0 OR exclude_from_ladder IS NULL
    ORDER BY
      CASE WHEN club_locker_rating IS NULL THEN 1 ELSE 0 END ASC,
      club_locker_rating DESC,
      name ASC
  `).all();
  const ladderPlayerIds = new Set(players.map((p) => p.id));
  let ranking = players.map((p) => p.id);

  // All scored matches in chronological order, with display data
  const allMatches = db.prepare(`
    SELECT
      m.id,
      m.player1_id,
      m.player2_id,
      m.player1_score,
      m.player2_score,
      m.winner_id,
      m.submitted_by_player_id,
      sub_by.name AS submitted_by_name,
      COALESCE(sp1.name, p1.name) AS p1_name,
      COALESCE(sp2.name, p2.name) AS p2_name,
      COALESCE(s1.sub_player_id, m.player1_id) AS eff_p1_id,
      COALESCE(s2.sub_player_id, m.player2_id) AS eff_p2_id,
      COALESCE(m.confirmed_at, w.date) AS confirmed_at
    FROM matches m
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w ON tm.week_id = w.id
    LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
    LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
    LEFT JOIN players sp1 ON sp1.id = s1.sub_player_id
    LEFT JOIN players sp2 ON sp2.id = s2.sub_player_id
    LEFT JOIN players sub_by ON sub_by.id = m.submitted_by_player_id
    WHERE m.winner_id IS NOT NULL
      AND (m.skipped = 0 OR m.skipped IS NULL)
    ORDER BY COALESCE(m.confirmed_at, w.date) ASC, m.id ASC
  `).all();

  // Walk every match chronologically:
  //   1. Snapshot pre-match ranks for activity items within the 7-day window
  //   2. Apply the ladder effect for all matches (so ranks stay accurate)
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 3650);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const activity = [];

  for (const match of allMatches) {
    const effP1Id     = match.eff_p1_id;
    const effP2Id     = match.eff_p2_id;
    const effWinnerId = match.winner_id === match.player1_id ? effP1Id : effP2Id;
    const effLoserId  = match.winner_id === match.player1_id ? effP2Id : effP1Id;

    const p1Idx     = ranking.indexOf(effP1Id);
    const p2Idx     = ranking.indexOf(effP2Id);
    const winnerIdx = ranking.indexOf(effWinnerId);
    const loserIdx  = ranking.indexOf(effLoserId);

    // Capture pre-match positions for matches within the window
    if ((match.confirmed_at || '') >= cutoff) {
      // places_moved: how many spots the winner jumps up (only when upset occurs)
      const placesWon = (winnerIdx !== -1 && loserIdx !== -1 && winnerIdx > loserIdx)
        ? winnerIdx - loserIdx : 0;
      activity.push({
        ...match,
        p1_pos: p1Idx !== -1 ? p1Idx + 1 : null,
        p2_pos: p2Idx !== -1 ? p2Idx + 1 : null,
        places_moved: placesWon,
      });
    }

    // Apply ladder movement (same logic as getLadder)
    if (!ladderPlayerIds.has(effWinnerId) || !ladderPlayerIds.has(effLoserId)) continue;
    if (winnerIdx === -1 || loserIdx === -1) continue;
    if (winnerIdx <= loserIdx) continue;
    ranking.splice(winnerIdx, 1);
    ranking.splice(loserIdx, 0, effWinnerId);
  }

  res.json(activity.reverse()); // newest first
}));

// ===== HELPERS =====

app.get('/api/configs/:numPlayers', wrap(async (req, res) => {
  res.json(getValidConfigurations(Number(req.params.numPlayers)));
}));

// ===== SCHEDULE =====

app.get('/api/schedule', wrap(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(bookingModel.getScheduleForDate(date));
}));

// ===== BOOKING TYPES =====

app.get('/api/booking-types', wrap(async (req, res) => {
  res.json(await bookingModel.getAllBookingTypes());
}));

app.post('/api/booking-types', requireAdmin, wrap(async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!color?.trim()) return res.status(400).json({ error: 'Color is required' });
  res.json(await bookingModel.addBookingType({ name: name.trim(), color: color.trim() }));
}));

app.put('/api/booking-types/:id', requireAdmin, wrap(async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!color?.trim()) return res.status(400).json({ error: 'Color is required' });
  res.json(await bookingModel.updateBookingType({ id: req.params.id, name: name.trim(), color: color.trim() }));
}));

app.delete('/api/booking-types/:id', requireAdmin, wrap(async (req, res) => {
  await bookingModel.deleteBookingType(req.params.id);
  res.json({ ok: true });
}));

// ===== BOOKINGS =====

app.post('/api/bookings', requireAdmin, wrap(async (req, res) => {
  const { courtId, date, startTime, durationMinutes, bookingTypeId, info } = req.body;
  if (!courtId) return res.status(400).json({ error: 'Court is required' });
  if (!date) return res.status(400).json({ error: 'Date is required' });
  if (!startTime) return res.status(400).json({ error: 'Start time is required' });
  if (!durationMinutes) return res.status(400).json({ error: 'Duration is required' });
  res.json(await bookingModel.addBooking({ courtId, date, startTime, durationMinutes, bookingTypeId, info }));
}));

app.put('/api/bookings/:id', requireAdmin, wrap(async (req, res) => {
  const { courtId, date, startTime, durationMinutes, bookingTypeId, info } = req.body;
  res.json(await bookingModel.updateBooking({ id: req.params.id, courtId, date, startTime, durationMinutes, bookingTypeId, info }));
}));

app.delete('/api/bookings/:id', requireAdmin, wrap(async (req, res) => {
  await bookingModel.deleteBooking(req.params.id);
  res.json({ ok: true });
}));

// ===== COURTS =====

app.get('/api/courts', wrap(async (req, res) => {
  res.json(await courtModel.getAllCourts());
}));

app.post('/api/courts', requireAdmin, wrap(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Court name is required' });
  res.json(await courtModel.addCourt({ name: name.trim() }));
}));

app.put('/api/courts/:id', requireAdmin, wrap(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Court name is required' });
  res.json(await courtModel.updateCourt({ id: req.params.id, name: name.trim() }));
}));

app.delete('/api/courts/:id', requireAdmin, wrap(async (req, res) => {
  await courtModel.deleteCourt(req.params.id);
  res.json({ ok: true });
}));

// ===== START =====

async function start() {
  await initDB(DB_PATH);
  app.listen(PORT, () => {
    console.log('');
    console.log('  Play WSRC is running!');
    console.log(`  Open http://localhost:${PORT} in your browser`);
    console.log('');
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
