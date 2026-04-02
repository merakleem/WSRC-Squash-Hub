const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { initDB, getDB } = require('./database/db');
const playerService = require('./services/playerService');
const leagueService = require('./services/leagueService');
const leagueModel = require('./models/leagueModel');
const ladderModel = require('./models/ladderModel');
const { getValidConfigurations } = require('./utils/helpers');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'squash.db');
const ADMIN_PASSWORD = process.env.SITE_PASSWORD || 'wsrc2025';
const SESSION_SECRET = process.env.SESSION_SECRET || 'wsrc-dev-secret-change-in-production';
const COOKIE_NAME = 'wsrc_session';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
  <title>${title} — WSRC Squash Manager</title>
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
      <h1>WSRC Squash Manager</h1>
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

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Admin login — email blank, password matches env var
  if (!email || !email.trim()) {
    if (password === ADMIN_PASSWORD) {
      setSessionCookie(res, { role: 'admin' });
      return res.redirect('/');
    }
    return res.status(401).send(authPage({ title: 'Sign In', error: 'Incorrect password.', body: loginFormBody() }));
  }

  // Player login — authenticate with email + member number
  const db = getDB();
  const player = db.prepare('SELECT * FROM players WHERE LOWER(email) = LOWER(?)').get([email.trim()]);
  if (!player) {
    return res.status(401).send(authPage({ title: 'Sign In', error: 'No account found for that email.', body: loginFormBody() }));
  }
  if (!player.member_number) {
    return res.status(401).send(authPage({ title: 'Sign In', error: 'Your member number has not been set. Contact your administrator.', body: loginFormBody() }));
  }
  if (player.member_number.toUpperCase() !== (password || '').toUpperCase()) {
    return res.status(401).send(authPage({ title: 'Sign In', error: 'Incorrect member number.', body: loginFormBody() }));
  }

  setSessionCookie(res, { role: 'player', playerId: player.id });
  res.redirect('/');
});

function loginFormBody() {
  return `<form method="POST" action="/login">
    <label>Email <span style="color:#aaa;font-weight:400">(leave blank for admin)</span></label>
    <input type="email" name="email" placeholder="your@email.com" autocomplete="email">
    <label>Member Number <span style="color:#aaa;font-weight:400">(admin: use your password)</span></label>
    <input type="password" name="password" placeholder="e.g. X118" autofocus autocomplete="current-password">
    <button type="submit">Sign In</button>
  </form>
  <div class="link-row"><a href="/forgot-password">Forgot your member number?</a></div>`;
}

app.get('/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/login');
});

app.get('/forgot-password', (req, res) => {
  res.send(authPage({
    title: 'Forgot Member Number',
    body: `<p style="font-size:13px;color:#6b7e93;margin-bottom:20px">
      Your password is your WSRC member number (e.g. X118). Contact your administrator if you don't know it.
    </p>
    <div class="link-row"><a href="/login">Back to login</a></div>`,
  }));
});

// ===== PROTECT ALL OTHER ROUTES =====

app.use((req, res, next) => {
  const session = getSession(req);
  if (!session) return res.redirect('/login');
  req.session = session;
  next();
});

app.use(express.static(path.join(__dirname, 'renderer')));

// Wrap async route handlers
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(500).json({ error: err.message || String(err) }));

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

app.get('/api/players/records', wrap(async (req, res) => {
  const rows = await playerService.getAllPlayerRecords();
  const map = {};
  rows.forEach((r) => { map[r.id] = { wins: r.wins || 0, losses: r.losses || 0 }; });
  res.json(map);
}));

app.get('/api/players/:id/history', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [player, history, records] = await Promise.all([
    playerService.getPlayerById(id),
    playerService.getPlayerMatchHistory(id),
    playerService.getAllPlayerRecords(),
  ]);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const rec = records.find((r) => r.id === id) || { wins: 0, losses: 0 };
  res.json({ ...player, wins: rec.wins || 0, losses: rec.losses || 0, history });
}));

// ===== LEAGUES =====

app.get('/api/leagues', wrap(async (req, res) => {
  res.json(await leagueModel.getAllLeagues());
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

app.put('/api/matches/:id/score', requireAdmin, wrap(async (req, res) => {
  await leagueModel.updateMatchScore({ matchId: Number(req.params.id), ...req.body });
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

app.put('/api/leagues/:id/sub-remaining', requireAdmin, wrap(async (req, res) => {
  const { originalPlayerId, subPlayerId } = req.body;
  const count = await leagueModel.setSubForRemaining(Number(req.params.id), originalPlayerId, subPlayerId);
  res.json({ ok: true, count });
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
    console.log('  WSRC Squash Manager is running!');
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
