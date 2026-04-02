const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { initDB } = require('./database/db');
const playerService = require('./services/playerService');
const leagueService = require('./services/leagueService');
const leagueModel = require('./models/leagueModel');
const ladderModel = require('./models/ladderModel');
const { getValidConfigurations } = require('./utils/helpers');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'squash.db');
const SITE_PASSWORD = process.env.SITE_PASSWORD || 'wsrc2025';
// Token is a hash of the password — used as the cookie value
const AUTH_TOKEN = crypto.createHash('sha256').update(SITE_PASSWORD).digest('hex');
const COOKIE_NAME = 'wsrc_auth';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ===== AUTH =====

function parseCookies(req) {
  const list = {};
  const header = req.headers.cookie;
  if (!header) return list;
  header.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    list[key.trim()] = decodeURIComponent(rest.join('='));
  });
  return list;
}

function isAuthenticated(req) {
  return parseCookies(req)[COOKIE_NAME] === AUTH_TOKEN;
}

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WSRC Squash Manager</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1e2758;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 40px 36px;
      width: 100%;
      max-width: 360px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25);
      text-align: center;
    }
    .logo { width: 80px; height: 80px; object-fit: contain; margin-bottom: 16px; }
    h1 { font-size: 18px; font-weight: 700; color: #1e2758; margin-bottom: 6px; }
    p { font-size: 13px; color: #6b7e93; margin-bottom: 24px; }
    input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #dce3ed;
      border-radius: 8px;
      font-size: 14px;
      margin-bottom: 12px;
      outline: none;
    }
    input:focus { border-color: #3a4db5; }
    button {
      width: 100%;
      padding: 10px;
      background: #1e2758;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #28348a; }
    .error { color: #c0392b; font-size: 13px; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="/assets/WSRC_Logo_Grey%203.png" alt="WSRC Logo">
    <h1>WSRC Squash Manager</h1>
    <p>Enter the password to continue</p>
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
      <button type="submit">Sign In</button>
      ${res.locals.error ? `<div class="error">Incorrect password</div>` : ''}
    </form>
  </div>
</body>
</html>`);
});

app.post('/login', (req, res) => {
  if (req.body.password === SITE_PASSWORD) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Lax`);
    return res.redirect('/');
  }
  res.locals.error = true;
  res.status(401).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WSRC Squash Manager</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1e2758;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 40px 36px;
      width: 100%;
      max-width: 360px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25);
      text-align: center;
    }
    .logo { width: 80px; height: 80px; object-fit: contain; margin-bottom: 16px; }
    h1 { font-size: 18px; font-weight: 700; color: #1e2758; margin-bottom: 6px; }
    p { font-size: 13px; color: #6b7e93; margin-bottom: 24px; }
    input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #dce3ed;
      border-radius: 8px;
      font-size: 14px;
      margin-bottom: 12px;
      outline: none;
    }
    input:focus { border-color: #3a4db5; }
    button {
      width: 100%;
      padding: 10px;
      background: #1e2758;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #28348a; }
    .error { color: #c0392b; font-size: 13px; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="card">
    <img class="logo" src="/assets/WSRC_Logo_Grey%203.png" alt="WSRC Logo">
    <h1>WSRC Squash Manager</h1>
    <p>Enter the password to continue</p>
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
      <button type="submit">Sign In</button>
      <div class="error">Incorrect password</div>
    </form>
  </div>
</body>
</html>`);
});

// Protect all other routes
app.use((req, res, next) => {
  if (isAuthenticated(req)) return next();
  res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'renderer')));
app.use(express.static(path.join(__dirname, 'public')));

// Wrap async route handlers so unhandled rejections become 500 responses
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(500).json({ error: err.message || String(err) }));

// ===== PLAYERS =====

app.get('/api/players', wrap(async (req, res) => {
  res.json(await playerService.getAllPlayers());
}));

app.post('/api/players', wrap(async (req, res) => {
  res.json(await playerService.addPlayer(req.body));
}));

app.put('/api/players/:id', wrap(async (req, res) => {
  res.json(await playerService.updatePlayer({ ...req.body, id: Number(req.params.id) }));
}));

app.delete('/api/players/:id', wrap(async (req, res) => {
  await playerService.deletePlayer(Number(req.params.id));
  res.json({ ok: true });
}));

app.get('/api/players/records', wrap(async (req, res) => {
  const rows = await playerService.getAllPlayerRecords();
  // Return as a map { playerId: { wins, losses } } for easy lookup
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

app.post('/api/leagues', wrap(async (req, res) => {
  const leagueId = await leagueService.createLeague(req.body);
  res.json(leagueId);
}));

app.delete('/api/leagues/:id', wrap(async (req, res) => {
  await leagueModel.deleteLeague(Number(req.params.id));
  res.json({ ok: true });
}));

// ===== MATCHES =====

app.put('/api/matches/:id/score', wrap(async (req, res) => {
  await leagueModel.updateMatchScore({ matchId: Number(req.params.id), ...req.body });
  res.json({ ok: true });
}));

// ===== LADDER =====

app.get('/api/ladder', wrap(async (req, res) => {
  res.json(await ladderModel.getLadder());
}));

app.put('/api/ladder', wrap(async (req, res) => {
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
    console.log('  Squash Manager is running!');
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
