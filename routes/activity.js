const express = require('express');
const { getDB } = require('../database/db');
const seasonModel = require('../models/seasonModel');
const matchModel = require('../models/matchModel');
const ladderModel = require('../models/ladderModel');
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
      COALESCE(sp1.photo_path, p1.photo_path) AS p1_photo,
      COALESCE(sp2.photo_path, p2.photo_path) AS p2_photo,
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

  // The replay below reproduces positional ladder places, which are a leapfrog
  // concept: under a rating ladder they would be invented. A rating ladder has
  // real positions of its own, so the labels come from it instead - the rank
  // each player held on the day, which is what the ladder page would have shown
  // then. Cached by date, since a night of league play shares one.
  const currentSeason = seasonModel.getCurrentSeason();
  const isElo = !!currentSeason && currentSeason.ladder_system === 'elo';
  const showPositions = !isElo;

  const ladderSettings = seasonModel.getSettings();
  const _ranksByDate = new Map();
  function eloRanksOn(day) {
    if (!day) return null;
    if (!_ranksByDate.has(day)) {
      const map = new Map();
      try {
        const rows = ladderModel.computeEloLadder(currentSeason.key, ladderSettings, day);
        rows.forEach((r, i) => map.set(r.id, i + 1));
      } catch (_) {
        // A date outside the season has no ladder to read; the row simply goes
        // unlabelled rather than carrying a rank from the wrong season.
      }
      _ranksByDate.set(day, map);
    }
    return _ranksByDate.get(day);
  }

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
      const day = (match.confirmed_at || '').slice(0, 10);
      const placesWon = (winnerIdx !== -1 && loserIdx !== -1 && winnerIdx > loserIdx)
        ? winnerIdx - loserIdx : 0;
      activity.push({
        ...match,
        // Positions and "moved up N places" are leapfrog concepts. Under a
        // rating ladder they would be fabricated, so they are omitted rather
        // than shown as something the ladder never did.
        p1_pos: showPositions
          ? (p1Idx !== -1 ? p1Idx + 1 : null)
          : (eloRanksOn(day)?.get(effP1Id) ?? null),
        p2_pos: showPositions
          ? (p2Idx !== -1 ? p2Idx + 1 : null)
          : (eloRanksOn(day)?.get(effP2Id) ?? null),
        places_moved: showPositions ? placesWon : 0,
      });
    }

    if (!ladderPlayerIds.has(effWinnerId) || !ladderPlayerIds.has(effLoserId)) continue;
    if (winnerIdx === -1 || loserIdx === -1) continue;
    if (winnerIdx <= loserIdx) continue;
    ranking.splice(winnerIdx, 1);
    ranking.splice(loserIdx, 0, effWinnerId);
  }

  // Doubles results ride in the same feed, newest first with everything else.
  // They carry no ladder position or movement - the doubles ladder is a
  // rating, and a pair has no place to move - just the two sides.
  const doublesRows = db.prepare(`
    SELECT m.id, m.type, ${matchModel.SOURCE_OF_TYPE} AS source,
           m.player1_score, m.player2_score, m.winner_id, m.round,
           ${matchModel.WON_SIDE} AS won_side,
           ${matchModel.EFF_P1} AS s1a, ${matchModel.EFF_P1B} AS s1b,
           ${matchModel.EFF_P2} AS s2a, ${matchModel.EFF_P2B} AS s2b,
           p1.name AS s1a_name, p1b.name AS s1b_name, p2.name AS s2a_name, p2b.name AS s2b_name,
           p1.photo_path AS s1a_photo, p1b.photo_path AS s1b_photo,
           p2.photo_path AS s2a_photo, p2b.photo_path AS s2b_photo,
           sub_by.name AS submitted_by_name, m.submitted_by_player_id,
           m.played_at AS confirmed_at,
           l.name AS league_name
    FROM matches m ${matchModel.DBL_JOIN}
    LEFT JOIN players p1  ON p1.id  = ${matchModel.EFF_P1}
    LEFT JOIN players p1b ON p1b.id = ${matchModel.EFF_P1B}
    LEFT JOIN players p2  ON p2.id  = ${matchModel.EFF_P2}
    LEFT JOIN players p2b ON p2b.id = ${matchModel.EFF_P2B}
    LEFT JOIN players sub_by ON sub_by.id = m.submitted_by_player_id
    LEFT JOIN leagues l ON l.id = m.league_id
    WHERE ${matchModel.COUNTS_DOUBLES}
      AND substr(m.played_at, 1, 10) >= @cutoff
  `).all({ cutoff }).map((m) => {
    const team1 = [{ id: m.s1a, name: m.s1a_name, photo_path: m.s1a_photo }, { id: m.s1b, name: m.s1b_name, photo_path: m.s1b_photo }];
    const team2 = [{ id: m.s2a, name: m.s2a_name, photo_path: m.s2a_photo }, { id: m.s2b, name: m.s2b_name, photo_path: m.s2b_photo }];
    return {
      id: m.id,
      source: m.source,
      format: 'doubles',
      type: m.type,
      team1, team2,
      player1_id: m.s1a, player2_id: m.s2a,
      eff_p1_id: m.s1a, eff_p2_id: m.s2a,
      won_side: m.won_side,
      winner_id: m.won_side === 1 ? m.s1a : m.s2a,
      p1_name: team1.map((p) => p.name).join(' & '),
      p2_name: team2.map((p) => p.name).join(' & '),
      player1_score: m.player1_score, player2_score: m.player2_score,
      p1_pos: null, p2_pos: null, places_moved: 0,
      submitted_by_player_id: m.submitted_by_player_id,
      submitted_by_name: m.submitted_by_name,
      confirmed_at: m.confirmed_at,
      league_name: m.league_name,
      tournament_name: null, round: null,
    };
  });

  const merged = [...activity.map((m) => ({ ...m, format: 'singles' })), ...doublesRows]
    .sort((a, b) => (b.confirmed_at || '').localeCompare(a.confirmed_at || '') || b.id - a.id);
  res.json(merged);
}));

module.exports = router;
