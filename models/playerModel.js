const { run, all, get } = require('../database/db');

async function getAllPlayers() {
  return all('SELECT * FROM players ORDER BY name ASC');
}

async function getPlayerById(id) {
  return get('SELECT * FROM players WHERE id = ?', [id]);
}

function parseRating(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  if (n < 1.0 || n > 7.0) throw new Error('Club Locker Rating must be between 1.0 and 7.0');
  return Math.round(n * 100) / 100;
}

async function addPlayer({ name, email, phone, wsrc_member, club_locker_rating, member_number }) {
  const rating = parseRating(club_locker_rating);
  const result = await run(
    'INSERT INTO players (name, email, phone, wsrc_member, club_locker_rating, member_number) VALUES (?, ?, ?, ?, ?, ?)',
    [name, email || null, phone || null, wsrc_member ? 1 : 0, rating, member_number || null]
  );
  return getPlayerById(result.lastID);
}

async function updatePlayer({ id, name, email, phone, wsrc_member, club_locker_rating, member_number }) {
  const rating = parseRating(club_locker_rating);
  await run(
    'UPDATE players SET name = ?, email = ?, phone = ?, wsrc_member = ?, club_locker_rating = ?, member_number = ? WHERE id = ?',
    [name, email || null, phone || null, wsrc_member ? 1 : 0, rating, member_number || null, id]
  );
  return getPlayerById(id);
}

async function deletePlayer(id) {
  return run('DELETE FROM players WHERE id = ?', [id]);
}

/**
 * Return all completed matches for a player with context (league, week, opponent, score, result).
 */
async function getPlayerMatchHistory(id) {
  // A player appears in a match if:
  //   (a) they are player1/player2 AND were NOT subbed out, OR
  //   (b) they subbed IN for someone
  // "played_as_p1" = true means this player was on the player1 side (original or sub)
  return all(`
    SELECT
      m.id,
      played_as_p1,
      CASE WHEN played_as_p1 THEN m.player1_score ELSE m.player2_score END AS my_score,
      CASE WHEN played_as_p1 THEN m.player2_score ELSE m.player1_score END AS their_score,
      CASE WHEN m.winner_id = eff_winner THEN 'W' ELSE 'L' END AS result,
      opp_name  AS opponent_name,
      opp_id    AS opponent_id,
      w.date        AS week_date,
      w.week_number,
      l.id          AS league_id,
      l.name        AS league_name,
      d.name        AS division_name
    FROM (
      -- Player is original player1 and was NOT subbed out
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

      -- Player is original player2 and was NOT subbed out
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

      -- Player subbed in on the player1 side
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

      -- Player subbed in on the player2 side
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
    ORDER BY w.date DESC, w.week_number DESC
  `, [id, id, id, id]);
}

/**
 * Return win/loss counts for every player in one query.
 * Returns [{ id, wins, losses }].
 */
async function getAllPlayerRecords() {
  // Build a view of effective participants: original players not subbed out, plus subs
  return all(`
    SELECT p.id,
      COUNT(CASE WHEN played AND won  THEN 1 END) AS wins,
      COUNT(CASE WHEN played AND NOT won AND finished THEN 1 END) AS losses
    FROM players p
    LEFT JOIN (
      -- Original player1, not subbed out
      SELECT m.player1_id AS player_id,
             m.winner_id IS NOT NULL AS finished,
             (m.winner_id = m.player1_id) AS won,
             1 AS played
      FROM matches m
      LEFT JOIN match_subs s ON s.match_id = m.id AND s.original_player_id = m.player1_id
      WHERE s.sub_player_id IS NULL AND m.player1_score IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)

      UNION ALL

      -- Original player2, not subbed out
      SELECT m.player2_id AS player_id,
             m.winner_id IS NOT NULL AS finished,
             (m.winner_id = m.player2_id) AS won,
             1 AS played
      FROM matches m
      LEFT JOIN match_subs s ON s.match_id = m.id AND s.original_player_id = m.player2_id
      WHERE s.sub_player_id IS NULL AND m.player1_score IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)

      UNION ALL

      -- Subs (credited as the side they played)
      SELECT s.sub_player_id AS player_id,
             m.winner_id IS NOT NULL AS finished,
             (m.winner_id = s.original_player_id) AS won,
             1 AS played
      FROM match_subs s
      JOIN matches m ON m.id = s.match_id AND m.player1_score IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)
    ) AS participation ON participation.player_id = p.id
    GROUP BY p.id
  `);
}

async function getPlayerUpcomingMatches(id) {
  return all(`
    SELECT
      m.id,
      w.date        AS week_date,
      w.week_number,
      l.id          AS league_id,
      l.name        AS league_name,
      d.name        AS division_name,
      CASE WHEN m.player1_id = ? THEN COALESCE(sp2.name, p2.name) ELSE COALESCE(sp1.name, p1.name) END AS opponent_name,
      m.court_number,
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
    WHERE s.sub_player_id = ?
      AND m.player1_score IS NULL AND (m.skipped = 0 OR m.skipped IS NULL)

    ORDER BY week_date ASC, match_time ASC
  `, [id, id, id, id]);
}

module.exports = { getAllPlayers, getPlayerById, addPlayer, updatePlayer, deletePlayer, getPlayerMatchHistory, getPlayerUpcomingMatches, getAllPlayerRecords };
