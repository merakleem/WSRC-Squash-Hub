const express = require('express');
const { getDB } = require('../database/db');
const leagueModel = require('../models/leagueModel');
const { wrap, requireAdmin, requireAuth } = require('../middleware');

const router = express.Router();

router.put('/matches/:id/timing', requireAdmin, wrap(async (req, res) => {
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

router.put('/matches/:id/score', requireAdmin, wrap(async (req, res) => {
  await leagueModel.updateMatchScore({ matchId: Number(req.params.id), submittedByPlayerId: null, ...req.body });
  res.json({ ok: true });
}));

router.put('/matches/:id/player-score', requireAuth, wrap(async (req, res) => {
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
  if (match.player1_score !== null) return res.status(409).json({ error: 'Score has already been reported for this match' });

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

// /matches/pickup must come before /matches/:id/* to avoid "pickup" matching as :id
router.post('/matches/pickup', requireAuth, wrap(async (req, res) => {
  const db = getDB();
  const submitterId = req.session.playerId;
  const isAdminUser = req.session.role === 'admin';

  let { player1Id, player2Id, player1Score, player2Score } = req.body;
  player1Id    = Number(player1Id);
  player2Id    = Number(player2Id);
  player1Score = Number(player1Score);
  player2Score = Number(player2Score);

  if (!player1Id || !player2Id || isNaN(player1Score) || isNaN(player2Score)) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (player1Id === player2Id) return res.status(400).json({ error: 'Players must be different.' });
  if (!isAdminUser && submitterId !== player1Id && submitterId !== player2Id) {
    return res.status(403).json({ error: 'You can only submit scores for matches you played in.' });
  }

  const valid = Number.isInteger(player1Score) && Number.isInteger(player2Score)
    && player1Score >= 0 && player1Score <= 3
    && player2Score >= 0 && player2Score <= 3
    && (player1Score === 3 || player2Score === 3)
    && player1Score !== player2Score;
  if (!valid) return res.status(400).json({ error: 'Invalid score — one player must win 3 games (e.g. 3-1, 2-3).' });

  const winnerId = player1Score > player2Score ? player1Id : player2Id;
  db.prepare(
    'INSERT INTO pickup_matches (player1_id, player2_id, player1_score, player2_score, winner_id, submitted_by_player_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(player1Id, player2Id, player1Score, player2Score, winnerId, submitterId);

  res.json({ ok: true });
}));

router.delete('/matches/pickup/:id', requireAdmin, wrap(async (req, res) => {
  getDB().prepare('DELETE FROM pickup_matches WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
}));

router.put('/matches/:id/skip', requireAdmin, wrap(async (req, res) => {
  await leagueModel.skipMatch(Number(req.params.id));
  res.json({ ok: true });
}));

router.put('/matches/:id/unskip', requireAdmin, wrap(async (req, res) => {
  await leagueModel.unskipMatch(Number(req.params.id));
  res.json({ ok: true });
}));

router.put('/matches/:id/sub', requireAdmin, wrap(async (req, res) => {
  const { originalPlayerId, subPlayerId } = req.body;
  await leagueModel.setMatchSub(Number(req.params.id), originalPlayerId, subPlayerId);
  res.json({ ok: true });
}));

router.delete('/matches/:id/sub', requireAdmin, wrap(async (req, res) => {
  const { originalPlayerId } = req.body;
  await leagueModel.removeMatchSub(Number(req.params.id), originalPlayerId);
  res.json({ ok: true });
}));

module.exports = router;
