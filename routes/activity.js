const express = require('express');
const { getDB } = require('../database/db');
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

  const leagueMatches = db.prepare(`
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
      COALESCE(m.confirmed_at, w.date) AS confirmed_at,
      'league' AS source
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
  `).all();

  const tournamentMatchesRaw = db.prepare(`
    SELECT
      tm.id,
      tm.winner_id,
      tm.player1_id,
      tm.player2_id,
      tm.player1_id AS eff_p1_id,
      tm.player2_id AS eff_p2_id,
      tm.scores,
      tm.round,
      COALESCE(tm.confirmed_at, tm.match_date) AS confirmed_at,
      p1.name AS p1_name,
      p2.name AS p2_name,
      t.name AS tournament_name,
      'tournament' AS source
    FROM tournament_matches tm
    JOIN tournaments t ON t.id = tm.tournament_id
    JOIN players p1 ON p1.id = tm.player1_id
    JOIN players p2 ON p2.id = tm.player2_id
    WHERE tm.winner_id IS NOT NULL
      AND tm.player1_id IS NOT NULL
      AND tm.player2_id IS NOT NULL
  `).all().map((m) => {
    let sc = { p1: 0, p2: 0 };
    try { if (m.scores) sc = JSON.parse(m.scores); } catch (_) {}
    return { ...m, player1_score: sc.p1, player2_score: sc.p2, scores: undefined };
  });

  const pickupMatchesRaw = db.prepare(`
    SELECT
      pm.id,
      pm.winner_id,
      pm.player1_id,
      pm.player2_id,
      pm.player1_id AS eff_p1_id,
      pm.player2_id AS eff_p2_id,
      pm.player1_score,
      pm.player2_score,
      p1.name AS p1_name,
      p2.name AS p2_name,
      sub_by.name AS submitted_by_name,
      pm.submitted_by_player_id,
      pm.played_at AS confirmed_at,
      'pickup' AS source
    FROM pickup_matches pm
    JOIN players p1 ON p1.id = pm.player1_id
    JOIN players p2 ON p2.id = pm.player2_id
    LEFT JOIN players sub_by ON sub_by.id = pm.submitted_by_player_id
  `).all();

  const allMatches = [...leagueMatches, ...tournamentMatchesRaw, ...pickupMatchesRaw]
    .sort((a, b) => (a.confirmed_at || '').localeCompare(b.confirmed_at || '') || 0);

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

    if ((match.confirmed_at || '') >= cutoff) {
      const placesWon = (winnerIdx !== -1 && loserIdx !== -1 && winnerIdx > loserIdx)
        ? winnerIdx - loserIdx : 0;
      activity.push({
        ...match,
        p1_pos: p1Idx !== -1 ? p1Idx + 1 : null,
        p2_pos: p2Idx !== -1 ? p2Idx + 1 : null,
        places_moved: placesWon,
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
