const express = require('express');
const path = require('path');
const { initDB } = require('./database/db');
const playerService = require('./services/playerService');
const leagueService = require('./services/leagueService');
const leagueModel = require('./models/leagueModel');
const ladderModel = require('./models/ladderModel');
const { getValidConfigurations } = require('./utils/helpers');

const PORT = 3000;
const DB_PATH = path.join(__dirname, 'squash.db');

const app = express();
app.use(express.json());
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
