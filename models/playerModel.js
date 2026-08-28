const { getDB } = require('../database/db');
const matchModel = require('./matchModel');

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

function updatePlayer({ id, name, email, phone, club_locker_rating, exclude_from_ladder, is_tester }) {
  getDB().prepare(
    'UPDATE players SET name = ?, email = ?, phone = ?, club_locker_rating = ?, exclude_from_ladder = ?, is_tester = ? WHERE id = ?'
  ).run(name, email || null, phone || null, club_locker_rating ?? null, exclude_from_ladder ? 1 : 0, is_tester ? 1 : 0, Number(id));
  return getPlayerById(id);
}

function deletePlayer(id) {
  getDB().prepare('DELETE FROM players WHERE id = ?').run(Number(id));
}

// Kept separate from updatePlayer so an ordinary player edit can't clear a photo.
function setPlayerPhoto(id, photoPath) {
  getDB().prepare('UPDATE players SET photo_path = ? WHERE id = ?').run(photoPath, Number(id));
  return getPlayerById(id);
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
      m.played_at AS week_date,
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
    JOIN weeks w    ON w.id = m.week_id
    JOIN leagues l  ON l.id = m.league_id
    JOIN divisions d ON d.id = m.division_id
    WHERE m.player1_score IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)
    ORDER BY m.played_at DESC, w.week_number DESC
  `).all(numId, numId, numId, numId);
}

/** Win/loss counts for every player in one query (league + tournament). */
/**
 * Every player's win/loss record, across every kind of match.
 *
 * One row per player per match, taken from whoever actually played it - a
 * substitute is credited, the player they stood in for is not. Reading the
 * same effective-player rule the match history reads is what keeps the two
 * from disagreeing; they used to be assembled separately and could return
 * different counts for the same match.
 */
function getAllPlayerRecords() {
  return getDB().prepare(`
    SELECT p.id,
      COUNT(CASE WHEN part.won THEN 1 END)     AS wins,
      COUNT(CASE WHEN part.won = 0 THEN 1 END) AS losses
    FROM players p
    LEFT JOIN (
      SELECT ${matchModel.EFF_P1} AS player_id, (${matchModel.WON_SIDE} = 1) AS won
      FROM matches m ${matchModel.EFF_JOIN} WHERE ${matchModel.COUNTS}
      UNION ALL
      SELECT ${matchModel.EFF_P2}, (${matchModel.WON_SIDE} = 2)
      FROM matches m ${matchModel.EFF_JOIN} WHERE ${matchModel.COUNTS}
    ) AS part ON part.player_id = p.id
    GROUP BY p.id
  `).all();
}

function getPickupMatchHistory(id) {
  const numId = Number(id);
  return getDB().prepare(`
    SELECT
      m.id,
      CASE WHEN m.player1_id = @id THEN 1 ELSE 0 END AS played_as_p1,
      CASE WHEN m.player1_id = @id THEN m.player1_score ELSE m.player2_score END AS my_score,
      CASE WHEN m.player1_id = @id THEN m.player2_score ELSE m.player1_score END AS their_score,
      CASE WHEN m.winner_id = @id THEN 'W' ELSE 'L' END AS result,
      opp.name AS opponent_name,
      CASE WHEN m.player1_id = @id THEN m.player2_id ELSE m.player1_id END AS opponent_id,
      m.played_at AS week_date,
      NULL AS week_number,
      NULL AS league_id,
      'Ladder Match' AS league_name,
      NULL AS division_name,
      'pickup' AS source
    FROM matches m
    JOIN players opp ON opp.id = CASE WHEN m.player1_id = @id THEN m.player2_id ELSE m.player1_id END
    WHERE m.type = 'ladder' AND (m.player1_id = @id OR m.player2_id = @id)
    ORDER BY m.played_at DESC
  `).all({ id: numId });
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
      CASE WHEN m.player1_id = ? THEN COALESCE(s2.sub_player_id, m.player2_id) ELSE COALESCE(s1.sub_player_id, m.player1_id) END AS opponent_id,
      m.court_number,
      m.court_id,
      c.name AS court_name,
      m.scheduled_time AS match_time,
      l.schedule_courts
    FROM matches m
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
    LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
    LEFT JOIN players sp1 ON sp1.id = s1.sub_player_id
    LEFT JOIN players sp2 ON sp2.id = s2.sub_player_id
    JOIN weeks w       ON w.id = m.week_id
    JOIN leagues l     ON l.id = m.league_id
    JOIN divisions d   ON d.id = m.division_id
    LEFT JOIN courts c ON c.id = m.court_id
    WHERE m.type = 'league'
      AND ((m.player1_id = ? AND s1.sub_player_id IS NULL)
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
      CASE WHEN s.original_player_id = m.player1_id THEN COALESCE(s2.sub_player_id, m.player2_id) ELSE COALESCE(s1.sub_player_id, m.player1_id) END AS opponent_id,
      m.court_number,
      m.court_id,
      c.name AS court_name,
      m.scheduled_time AS match_time,
      l.schedule_courts
    FROM match_subs s
    JOIN matches m ON m.id = s.match_id
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
    LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
    LEFT JOIN players sp1 ON sp1.id = s1.sub_player_id
    LEFT JOIN players sp2 ON sp2.id = s2.sub_player_id
    JOIN weeks w       ON w.id = m.week_id
    JOIN leagues l     ON l.id = m.league_id
    JOIN divisions d   ON d.id = m.division_id
    LEFT JOIN courts c ON c.id = m.court_id
    WHERE m.type = 'league' AND s.sub_player_id = ?
      AND m.player1_score IS NULL AND (m.skipped = 0 OR m.skipped IS NULL)

    ORDER BY week_date ASC, match_time ASC
  `).all(numId, numId, numId, numId, numId);
}

module.exports = {
  getAllPlayers, getPlayerById, addPlayer, updatePlayer, deletePlayer, setPlayerPhoto,
  getPlayerMatchHistory, getPickupMatchHistory, getPlayerUpcomingMatches, getAllPlayerRecords,
};
