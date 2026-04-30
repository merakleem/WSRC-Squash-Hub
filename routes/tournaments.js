const express = require('express');
const { getDB } = require('../database/db');
const tournamentModel = require('../models/tournamentModel');
const { buildTournamentTiers } = require('../utils/tournamentHelpers');
const { wrap, requireAdmin, requireAuth } = require('../middleware');

const router = express.Router();

router.get('/tournaments', wrap(async (req, res) => {
  res.json(await tournamentModel.getTournaments());
}));

router.post('/tournaments/check-date', requireAdmin, wrap(async (req, res) => {
  const { championshipDate, courtIds, matchDurationMinutes, bufferMinutes } = req.body;
  if (!championshipDate || !Array.isArray(courtIds) || courtIds.length === 0) {
    return res.status(400).json({ error: 'championshipDate and courtIds are required.' });
  }
  res.json(tournamentModel.checkTournamentDate({ championshipDate, courtIds, matchDurationMinutes, bufferMinutes }));
}));

router.post('/tournaments/suggest-groups', requireAdmin, wrap(async (req, res) => {
  const { playerIds } = req.body;
  if (!Array.isArray(playerIds) || playerIds.length !== 16) {
    return res.status(400).json({ error: 'Exactly 16 playerIds required.' });
  }
  res.json(tournamentModel.getSuggestedGroups(playerIds));
}));

router.post('/tournaments', requireAdmin, wrap(async (req, res) => {
  const { name, groups, championshipDate, courtIds, matchDurationMinutes, bufferMinutes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Tournament name is required.' });
  if (!groups || !groups.A || !groups.B || !groups.C || !groups.D) return res.status(400).json({ error: 'Groups A, B, C, D are required.' });
  for (const g of ['A', 'B', 'C', 'D']) {
    if (!Array.isArray(groups[g]) || groups[g].length !== 4) return res.status(400).json({ error: `Group ${g} must have exactly 4 players.` });
  }
  if (!championshipDate) return res.status(400).json({ error: 'Championship date is required.' });
  if (!Array.isArray(courtIds) || courtIds.length === 0) return res.status(400).json({ error: 'At least one court is required.' });
  try {
    const tournamentId = tournamentModel.createTournament({ name: name.trim(), groups, championshipDate, courtIds, matchDurationMinutes, bufferMinutes });
    res.json({ tournamentId });
  } catch (err) {
    if (err.leagueConflicts) return res.status(409).json({ error: err.message, leagueConflicts: err.leagueConflicts });
    throw err;
  }
}));

router.get('/tournaments/:id', wrap(async (req, res) => {
  const t = await tournamentModel.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournament not found.' });
  res.json(t);
}));

router.get('/tournaments/:id/results', wrap(async (req, res) => {
  let t;
  try {
    t = await tournamentModel.getTournament(req.params.id);
  } catch (e) {
    console.error('[results] getTournament failed:', e);
    return res.status(500).json({ error: `getTournament failed: ${e.message}` });
  }
  if (!t) return res.status(404).json({ error: 'Tournament not found.' });

  const tiers = buildTournamentTiers(t);
  res.json({
    tournament_id: t.id,
    name: t.name,
    status: t.status,
    _debug: { player_count: t.players.length, match_count: t.matches.length },
    results: tiers,
  });
}));

router.delete('/tournaments/:id', requireAdmin, wrap(async (req, res) => {
  await tournamentModel.deleteTournament(req.params.id);
  res.json({ ok: true });
}));

router.put('/tournament-matches/:id/score', requireAdmin, wrap(async (req, res) => {
  const { scores, winnerId } = req.body;
  if (!scores || typeof scores.p1 !== 'number' || typeof scores.p2 !== 'number') {
    return res.status(400).json({ error: 'scores must be an object with p1 and p2 set counts.' });
  }
  if (!winnerId) return res.status(400).json({ error: 'winnerId is required.' });
  const match = getDB().prepare('SELECT player1_id, player2_id FROM tournament_matches WHERE id = ?').get(Number(req.params.id));
  if (!match || !match.player1_id || !match.player2_id) {
    return res.status(409).json({ error: 'Cannot score a match until both players are determined.' });
  }
  const updated = tournamentModel.updateTournamentMatchScore(req.params.id, scores, winnerId);
  res.json(updated);
}));

router.put('/tournament-matches/:id/player-score', requireAuth, wrap(async (req, res) => {
  const matchId  = Number(req.params.id);
  const playerId = Number(req.session.playerId);
  const myScore    = Number(req.body.myScore);
  const theirScore = Number(req.body.theirScore);

  const db = getDB();
  const match = db.prepare('SELECT id, player1_id, player2_id, winner_id FROM tournament_matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (!match.player1_id || !match.player2_id) return res.status(409).json({ error: 'Cannot score a match until both players are determined.' });
  if (match.winner_id !== null) return res.status(409).json({ error: 'Score has already been reported for this match' });

  const isP1 = match.player1_id === playerId;
  const isP2 = match.player2_id === playerId;
  if (!isP1 && !isP2) return res.status(403).json({ error: 'You are not a player in this match' });

  const p1Score = isP1 ? myScore : theirScore;
  const p2Score = isP2 ? myScore : theirScore;

  const valid = Number.isInteger(p1Score) && Number.isInteger(p2Score)
    && p1Score >= 0 && p1Score <= 3 && p2Score >= 0 && p2Score <= 3
    && (p1Score === 3 || p2Score === 3) && p1Score !== p2Score;

  if (!valid) return res.status(400).json({ error: 'Invalid score — one player must win 3 sets (e.g. 3–1, 3–2)' });

  const winnerId = p1Score > p2Score ? match.player1_id : match.player2_id;
  const updated = tournamentModel.updateTournamentMatchScore(matchId, { p1: p1Score, p2: p2Score }, winnerId);
  res.json(updated);
}));

router.delete('/tournament-matches/:id/score', requireAdmin, wrap(async (req, res) => {
  tournamentModel.clearTournamentMatchScore(req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
