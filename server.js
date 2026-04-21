const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { initDB, getDB } = require('./database/db');
const playerService = require('./services/playerService');
const leagueService = require('./services/leagueService');
const leagueModel = require('./models/leagueModel');
const ladderModel = require('./models/ladderModel');
const { getValidConfigurations } = require('./utils/helpers');

function serverEsc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'squash.db');
const ADMIN_PASSWORD = process.env.SITE_PASSWORD || 'wsrc2025';
const SESSION_SECRET = process.env.SESSION_SECRET || 'wsrc-dev-secret-change-in-production';
const COOKIE_NAME = 'wsrc_session';

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false }));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(500).json({ error: err.message || String(err) }));

// ===== SESSION TOKENS =====

function signSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
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

function setSessionCookie(res, payload) {
  const token = signSession(payload);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
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


// ===== PAGE TEMPLATE =====

function authPage({ title, body, error, info }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — WSRC Squash Hub</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #1e2758; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; overflow: hidden; width: 100%;
            max-width: 380px; box-shadow: 0 8px 32px rgba(0,0,0,0.35); }
    .card-header { background: #1e2758; padding: 28px 36px 24px; text-align: center; }
    .logo { width: 80px; height: 80px; object-fit: contain; }
    .card-body { padding: 28px 32px 32px; }
    h1 { font-size: 17px; font-weight: 700; color: #1e2758; margin-bottom: 4px; }
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
      <h1>WSRC Squash Hub</h1>
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

app.post('/login', wrap(async (req, res) => {
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
    return res.status(401).send(authPage({ title: 'Sign In', error: 'No account found for that email.', body: loginFormBody() }));
  }
  const account = db.prepare('SELECT * FROM user_accounts WHERE player_id = ?').get(player.id);
  if (!account || !account.password_hash) {
    return res.status(401).send(authPage({ title: 'Sign In', error: 'Your account has not been activated yet. Check your email for an invite link, or contact your administrator.', body: loginFormBody() }));
  }
  const match = await bcrypt.compare(password || '', account.password_hash);
  if (!match) {
    return res.status(401).send(authPage({ title: 'Sign In', error: 'Incorrect password.', body: loginFormBody() }));
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
  <title>League Schedule — WSRC Squash Hub</title>
  <link rel="icon" type="image/png" href="/assets/logo-blue.png">
  <style>
    :root { --primary:#1e2758; --accent:#3a4db5; --border:#e2e8f0; --muted:#64748b; --bg:#f4f6fb; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:#1e293b; font-size:15px; line-height:1.5; }

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
        +'<div class="header-brand"><img src="/assets/WSRC_Logo_Grey%203.png" alt="WSRC"><span class="header-brand-text">WSRC Squash Hub</span></div>'
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

app.use(express.static(path.join(__dirname, 'renderer')));

// ===== API: WHO AM I =====

app.get('/api/me', (req, res) => {
  res.json({ role: req.session.role, playerId: req.session.playerId || null });
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

app.post('/api/players/:id/send-invite', requireAdmin, wrap(async (req, res) => {
  const playerId = Number(req.params.id);
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });

  const db = getDB();
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (!player.email) return res.status(400).json({ error: 'This player has no email address on file.' });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  db.prepare(`INSERT INTO user_accounts (player_id, invite_token, invite_expires)
    VALUES (?, ?, ?)
    ON CONFLICT (player_id) DO UPDATE SET invite_token = excluded.invite_token, invite_expires = excluded.invite_expires`
  ).run(playerId, token, expires);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const inviteUrl = `${baseUrl}/invite/${token}`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'WSRC Squash Hub <no-reply@playwsrc.ca>',
      to: player.email,
      subject: 'Activate your WSRC Squash Hub account',
      html: `<p>Hi ${serverEsc(player.name)},</p>
<p>You've been invited to create an account on WSRC Squash Hub.</p>
<p><a href="${serverEsc(inviteUrl)}">Click here to activate your account</a></p>
<p>This link expires in 72 hours.</p>`,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return res.status(502).json({ error: err.message || 'Failed to send email.' });
  }
  res.json({ ok: true });
}));

app.post('/api/players/:id/send-reset', requireAdmin, wrap(async (req, res) => {
  const playerId = Number(req.params.id);
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });

  const db = getDB();
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (!player.email) return res.status(400).json({ error: 'This player has no email address on file.' });

  const account = db.prepare('SELECT * FROM user_accounts WHERE player_id = ?').get(playerId);
  if (!account || !account.password_hash) return res.status(400).json({ error: 'This player has not activated their account yet. Send an invite instead.' });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare('UPDATE user_accounts SET reset_token = ?, reset_expires = ? WHERE player_id = ?').run(token, expires, playerId);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const resetUrl = `${baseUrl}/reset-password/${token}`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'WSRC Squash Hub <no-reply@playwsrc.ca>',
      to: player.email,
      subject: 'Reset your WSRC Squash Hub password',
      html: `<p>Hi ${serverEsc(player.name)},</p>
<p>A password reset was requested for your WSRC Squash Hub account.</p>
<p><a href="${serverEsc(resetUrl)}">Click here to reset your password</a></p>
<p>This link expires in 24 hours. If you did not request this, you can ignore this email.</p>`,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return res.status(502).json({ error: err.message || 'Failed to send email.' });
  }
  res.json({ ok: true });
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
  const { matchTime, courtNumber } = req.body;

  const db = getDB();

  // Get league settings and week context for this match
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
    if (ctx.schedule_courts && courtNumber) {
      // Hard block: same court + same time in same week (excluding this match)
      const conflict = db.prepare(`
        SELECT COUNT(*) AS cnt FROM matches m
        JOIN team_matchups tm ON m.matchup_id = tm.id
        WHERE tm.week_id = ? AND m.court_number = ? AND m.match_time = ? AND m.id != ?
      `).get(ctx.week_id, courtNumber, matchTime, matchId);
      if (conflict.cnt > 0) {
        return res.status(409).json({ error: `Court ${courtNumber} is already booked at ${matchTime} this week.` });
      }
    }

    if (ctx.num_courts > 0) {
      // Count other matches at this time in the same week
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

  await leagueModel.updateMatchTiming(matchId, matchTime || null, courtNumber || null);
  res.json({ ok: true, warning });
}));

app.put('/api/matches/:id/score', requireAdmin, wrap(async (req, res) => {
  await leagueModel.updateMatchScore({ matchId: Number(req.params.id), ...req.body });
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
        from: `WSRC Squash Hub <no-reply@playwsrc.ca>`,
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

app.put('/api/ladder', requireAdmin, wrap(async (req, res) => {
  const { playerIds } = req.body;
  if (!Array.isArray(playerIds)) return res.status(400).json({ error: 'playerIds must be an array' });
  await ladderModel.setLadder(playerIds);
  res.json({ ok: true });
}));

// ===== HELPERS =====

app.get('/api/configs/:numPlayers', wrap(async (req, res) => {
  res.json(getValidConfigurations(Number(req.params.numPlayers)));
}));

// ===== START =====

async function start() {
  await initDB(DB_PATH);
  app.listen(PORT, () => {
    console.log('');
    console.log('  WSRC Squash Hub is running!');
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
