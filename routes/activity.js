const express = require('express');
const { getDB } = require('../database/db');
const seasonModel = require('../models/seasonModel');
const matchModel = require('../models/matchModel');
const { wrap } = require('../middleware');

const router = express.Router();

router.get('/activity', wrap(async (req, res) => {
  const db = getDB();

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

  // One query over one table. The feed used to assemble three - league,
  // tournament and ladder - each with its own idea of the match date and of who
  // won, so it could disagree with the profile and the ladder about the same
  // match.
  const allMatches = db.prepare(`
    SELECT
      m.id, m.player1_id, m.player2_id, m.player1_score, m.player2_score,
      m.scores, m.winner_id, m.round, m.submitted_by_player_id,
      sub_by.name AS submitted_by_name,
      COALESCE(sp1.name, p1.name) AS p1_name,
      COALESCE(sp2.name, p2.name) AS p2_name,
      ${matchModel.EFF_P1} AS eff_p1_id,
      ${matchModel.EFF_P2} AS eff_p2_id,
      ${matchModel.WON_SIDE} AS won_side,
      m.played_at AS confirmed_at,
      l.name AS league_name,
      t.name AS tournament_name,
      ${matchModel.SOURCE_OF_TYPE} AS source
    FROM matches m
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    ${matchModel.EFF_JOIN}
    LEFT JOIN players sp1     ON sp1.id = s1.sub_player_id
    LEFT JOIN players sp2     ON sp2.id = s2.sub_player_id
    LEFT JOIN players sub_by  ON sub_by.id = m.submitted_by_player_id
    LEFT JOIN leagues l       ON l.id = m.league_id
    LEFT JOIN tournaments t   ON t.id = m.tournament_id
    WHERE ${matchModel.COUNTS}
  `).all().map((m) => {
    // Tournaments keep their per-game detail as text rather than as game
    // counts, so those two columns are filled in here.
    if (m.source !== 'tournament') return { ...m, scores: undefined };
    let sc = { p1: 0, p2: 0 };
    try { if (m.scores) sc = JSON.parse(m.scores); } catch (_) {}
    return { ...m, player1_score: sc.p1, player2_score: sc.p2, scores: undefined };
  }).sort((a, b) => (a.confirmed_at || '').localeCompare(b.confirmed_at || '') || 0);

  // The replay below reproduces positional ladder places. Only label matches
  // with them while the current season is actually played that way; under a
  // rating ladder those positions would be invented.
  const currentSeason = seasonModel.getCurrentSeason();
  const showPositions = !currentSeason || currentSeason.ladder_system !== 'elo';

  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 3650);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const activity = [];

  for (const match of allMatches) {
    const effP1Id     = match.eff_p1_id;
    const effP2Id     = match.eff_p2_id;
    const effWinnerId = match.won_side === 1 ? effP1Id : effP2Id;
    const effLoserId  = match.won_side === 1 ? effP2Id : effP1Id;

    const p1Idx     = ranking.indexOf(effP1Id);
    const p2Idx     = ranking.indexOf(effP2Id);
    const winnerIdx = ranking.indexOf(effWinnerId);
    const loserIdx  = ranking.indexOf(effLoserId);

    if ((match.confirmed_at || '') >= cutoff) {
      const placesWon = (winnerIdx !== -1 && loserIdx !== -1 && winnerIdx > loserIdx)
        ? winnerIdx - loserIdx : 0;
      activity.push({
        ...match,
        // Positions and "moved up N places" are leapfrog concepts. Under a
        // rating ladder they would be fabricated, so they are omitted rather
        // than shown as something the ladder never did.
        p1_pos: showPositions && p1Idx !== -1 ? p1Idx + 1 : null,
        p2_pos: showPositions && p2Idx !== -1 ? p2Idx + 1 : null,
        places_moved: showPositions ? placesWon : 0,
      });
    }

    if (!ladderPlayerIds.has(effWinnerId) || !ladderPlayerIds.has(effLoserId)) continue;
    if (winnerIdx === -1 || loserIdx === -1) continue;
    if (winnerIdx <= loserIdx) continue;
    ranking.splice(winnerIdx, 1);
    ranking.splice(loserIdx, 0, effWinnerId);
  }

  res.json(activity.reverse());
}));

module.exports = router;
