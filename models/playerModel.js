const { getDB } = require('../database/db');

function getAllPlayers() {
  return getDB().prepare('SELECT * FROM players ORDER BY name ASC').all();
}

function getPlayerById(id) {
  return getDB().prepare('SELECT * FROM players WHERE id = ?').get(Number(id));
}

function addPlayer({ name, email, phone, club_locker_rating, exclude_from_ladder }) {
  const db = getDB();
  const result = db.prepare(
    'INSERT INTO players (name, email, phone, club_locker_rating, exclude_from_ladder) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email || null, phone || null, club_locker_rating ?? null, exclude_from_ladder ? 1 : 0);
  return getPlayerById(result.lastInsertRowid);
}

function updatePlayer({ id, name, email, phone, club_locker_rating, exclude_from_ladder }) {
  getDB().prepare(
    'UPDATE players SET name = ?, email = ?, phone = ?, club_locker_rating = ?, exclude_from_ladder = ? WHERE id = ?'
  ).run(name, email || null, phone || null, club_locker_rating ?? null, exclude_from_ladder ? 1 : 0, Number(id));
  return getPlayerById(id);
}

function deletePlayer(id) {
  getDB().prepare('DELETE FROM players WHERE id = ?').run(Number(id));
}

/**
 * All completed matches for a player with context (league, week, opponent, score, result).
 * Handles subs on either side.
 */
function getPlayerMatchHistory(id) {
  const numId = Number(id);
  return getDB().prepare(`
    SELECT
      m.id,
      played_as_p1,
      CASE WHEN played_as_p1 THEN m.player1_score ELSE m.player2_score END AS my_score,
      CASE WHEN played_as_p1 THEN m.player2_score ELSE m.player1_score END AS their_score,
      CASE WHEN m.winner_id = eff_winner THEN 'W' ELSE 'L' END AS result,
      opp_name  AS opponent_name,
      opp_id    AS opponent_id,
      COALESCE(m.confirmed_at, w.date) AS week_date,
      w.week_number,
      l.id          AS league_id,
      l.name        AS league_name,
      d.name        AS division_name
    FROM (
      SELECT m.id, 1 AS played_as_p1,
             COALESCE(s1.sub_player_id, m.player1_id) AS eff_winner,
             COALESCE(s2.sub_player_id, m.player2_id) AS opp_id,
             COALESCE(sp2.name, p2.name)               AS opp_name
      FROM matches m
      JOIN players p2 ON p2.id = m.player2_id
      LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
      LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
      LEFT JOIN players sp2   ON sp2.id = s2.sub_player_id
      WHERE m.player1_id = ? AND s1.sub_player_id IS NULL

      UNION ALL

      SELECT m.id, 0 AS played_as_p1,
             COALESCE(s2.sub_player_id, m.player2_id) AS eff_winner,
             COALESCE(s1.sub_player_id, m.player1_id) AS opp_id,
             COALESCE(sp1.name, p1.name)               AS opp_name
      FROM matches m
      JOIN players p1 ON p1.id = m.player1_id
      LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
      LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
      LEFT JOIN players sp1   ON sp1.id = s1.sub_player_id
      WHERE m.player2_id = ? AND s2.sub_player_id IS NULL

      UNION ALL

      SELECT m.id, 1 AS played_as_p1,
             m.player1_id AS eff_winner,
             COALESCE(s2.sub_player_id, m.player2_id) AS opp_id,
             COALESCE(sp2.name, p2.name)               AS opp_name
      FROM match_subs sub_in
      JOIN matches m  ON m.id = sub_in.match_id AND sub_in.original_player_id = m.player1_id
      JOIN players p2 ON p2.id = m.player2_id
      LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
      LEFT JOIN players sp2   ON sp2.id = s2.sub_player_id
      WHERE sub_in.sub_player_id = ?

      UNION ALL

      SELECT m.id, 0 AS played_as_p1,
             m.player2_id AS eff_winner,
             COALESCE(s1.sub_player_id, m.player1_id) AS opp_id,
             COALESCE(sp1.name, p1.name)               AS opp_name
      FROM match_subs sub_in
      JOIN matches m  ON m.id = sub_in.match_id AND sub_in.original_player_id = m.player2_id
      JOIN players p1 ON p1.id = m.player1_id
      LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
      LEFT JOIN players sp1   ON sp1.id = s1.sub_player_id
      WHERE sub_in.sub_player_id = ?
    ) AS participated
    JOIN matches m  ON m.id = participated.id
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w          ON tm.week_id = w.id
    JOIN leagues l        ON w.league_id = l.id
    JOIN divisions d      ON m.division_id = d.id
    WHERE m.player1_score IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)
    ORDER BY COALESCE(m.confirmed_at, w.date) DESC, w.week_number DESC
  `).all(numId, numId, numId, numId);
}

/** Win/loss counts for every player in one query (league + tournament). */
function getAllPlayerRecords() {
  return getDB().prepare(`
    SELECT p.id,
      COUNT(CASE WHEN played AND won  THEN 1 END) AS wins,
      COUNT(CASE WHEN played AND NOT won AND finished THEN 1 END) AS losses
    FROM players p
    LEFT JOIN (
      SELECT m.player1_id AS player_id,
             m.winner_id IS NOT NULL AS finished,
             (m.winner_id = m.player1_id) AS won,
             1 AS played
      FROM matches m
      LEFT JOIN match_subs s ON s.match_id = m.id AND s.original_player_id = m.player1_id
      WHERE s.sub_player_id IS NULL AND m.player1_score IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)

      UNION ALL

      SELECT m.player2_id AS player_id,
             m.winner_id IS NOT NULL AS finished,
             (m.winner_id = m.player2_id) AS won,
             1 AS played
      FROM matches m
      LEFT JOIN match_subs s ON s.match_id = m.id AND s.original_player_id = m.player2_id
      WHERE s.sub_player_id IS NULL AND m.player1_score IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)

      UNION ALL

      SELECT s.sub_player_id AS player_id,
             m.winner_id IS NOT NULL AS finished,
             (m.winner_id = s.original_player_id) AS won,
             1 AS played
      FROM match_subs s
      JOIN matches m ON m.id = s.match_id AND m.player1_score IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)

      UNION ALL

      SELECT tm.player1_id AS player_id,
             1 AS finished,
             (tm.winner_id = tm.player1_id) AS won,
             1 AS played
      FROM tournament_matches tm
      WHERE tm.winner_id IS NOT NULL AND tm.player1_id IS NOT NULL AND tm.player2_id IS NOT NULL

      UNION ALL

      SELECT tm.player2_id AS player_id,
             1 AS finished,
             (tm.winner_id = tm.player2_id) AS won,
             1 AS played
      FROM tournament_matches tm
      WHERE tm.winner_id IS NOT NULL AND tm.player1_id IS NOT NULL AND tm.player2_id IS NOT NULL

      UNION ALL

      SELECT pm.player1_id AS player_id,
             1 AS finished,
             (pm.winner_id = pm.player1_id) AS won,
             1 AS played
      FROM pickup_matches pm

      UNION ALL

      SELECT pm.player2_id AS player_id,
             1 AS finished,
             (pm.winner_id = pm.player2_id) AS won,
             1 AS played
      FROM pickup_matches pm
    ) AS participation ON participation.player_id = p.id
    GROUP BY p.id
  `).all();
}

function getPickupMatchHistory(id) {
  const numId = Number(id);
  return getDB().prepare(`
    SELECT
      pm.id,
      CASE WHEN pm.player1_id = ? THEN 1 ELSE 0 END AS played_as_p1,
      CASE WHEN pm.player1_id = ? THEN pm.player1_score ELSE pm.player2_score END AS my_score,
      CASE WHEN pm.player1_id = ? THEN pm.player2_score ELSE pm.player1_score END AS their_score,
      CASE WHEN pm.winner_id = ? THEN 'W' ELSE 'L' END AS result,
      opp.name AS opponent_name,
      CASE WHEN pm.player1_id = ? THEN pm.player2_id ELSE pm.player1_id END AS opponent_id,
      pm.played_at AS week_date,
      NULL AS week_number,
      NULL AS league_id,
      'Pickup Game' AS league_name,
      NULL AS division_name,
      'pickup' AS source
    FROM pickup_matches pm
    JOIN players opp ON opp.id = CASE WHEN pm.player1_id = ? THEN pm.player2_id ELSE pm.player1_id END
    WHERE pm.player1_id = ? OR pm.player2_id = ?
    ORDER BY pm.played_at DESC
  `).all(numId, numId, numId, numId, numId, numId, numId, numId);
}

function getPlayerUpcomingMatches(id) {
  const numId = Number(id);
  return getDB().prepare(`
    SELECT
      m.id,
      w.date        AS week_date,
      w.week_number,
      l.id          AS league_id,
      l.name        AS league_name,
      d.name        AS division_name,
      CASE WHEN m.player1_id = ? THEN COALESCE(sp2.name, p2.name) ELSE COALESCE(sp1.name, p1.name) END AS opponent_name,
      m.court_number,
      m.court_id,
      c.name AS court_name,
      m.match_time,
      l.schedule_courts
    FROM matches m
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
    LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
    LEFT JOIN players sp1 ON sp1.id = s1.sub_player_id
    LEFT JOIN players sp2 ON sp2.id = s2.sub_player_id
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w          ON tm.week_id = w.id
    JOIN leagues l        ON w.league_id = l.id
    JOIN divisions d      ON m.division_id = d.id
    LEFT JOIN courts c    ON c.id = m.court_id
    WHERE ((m.player1_id = ? AND s1.sub_player_id IS NULL)
       OR  (m.player2_id = ? AND s2.sub_player_id IS NULL))
      AND m.player1_score IS NULL AND (m.skipped = 0 OR m.skipped IS NULL)

    UNION

    SELECT
      m.id,
      w.date        AS week_date,
      w.week_number,
      l.id          AS league_id,
      l.name        AS league_name,
      d.name        AS division_name,
      CASE WHEN s.original_player_id = m.player1_id THEN COALESCE(sp2.name, p2.name) ELSE COALESCE(sp1.name, p1.name) END AS opponent_name,
      m.court_number,
      m.court_id,
      c.name AS court_name,
      m.match_time,
      l.schedule_courts
    FROM match_subs s
    JOIN matches m ON m.id = s.match_id
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
    LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
    LEFT JOIN players sp1 ON sp1.id = s1.sub_player_id
    LEFT JOIN players sp2 ON sp2.id = s2.sub_player_id
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w          ON tm.week_id = w.id
    JOIN leagues l        ON w.league_id = l.id
    JOIN divisions d      ON m.division_id = d.id
    LEFT JOIN courts c    ON c.id = m.court_id
    WHERE s.sub_player_id = ?
      AND m.player1_score IS NULL AND (m.skipped = 0 OR m.skipped IS NULL)

    ORDER BY week_date ASC, match_time ASC
  `).all(numId, numId, numId, numId);
}

module.exports = {
  getAllPlayers, getPlayerById, addPlayer, updatePlayer, deletePlayer,
  getPlayerMatchHistory, getPickupMatchHistory, getPlayerUpcomingMatches, getAllPlayerRecords,
};
