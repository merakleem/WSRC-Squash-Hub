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

async function addPlayer({ name, email, phone, wsrc_member, club_locker_rating }) {
  const rating = parseRating(club_locker_rating);
  const result = await run(
    'INSERT INTO players (name, email, phone, wsrc_member, club_locker_rating) VALUES (?, ?, ?, ?, ?)',
    [name, email || null, phone || null, wsrc_member ? 1 : 0, rating]
  );
  return getPlayerById(result.lastID);
}

async function updatePlayer({ id, name, email, phone, wsrc_member, club_locker_rating }) {
  const rating = parseRating(club_locker_rating);
  await run(
    'UPDATE players SET name = ?, email = ?, phone = ?, wsrc_member = ?, club_locker_rating = ? WHERE id = ?',
    [name, email || null, phone || null, wsrc_member ? 1 : 0, rating, id]
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
  return all(`
    SELECT
      m.id,
      CASE WHEN m.player1_id = ? THEN m.player1_score ELSE m.player2_score END AS my_score,
      CASE WHEN m.player1_id = ? THEN m.player2_score ELSE m.player1_score END AS their_score,
      CASE WHEN m.winner_id = ? THEN 'W' ELSE 'L' END AS result,
      CASE WHEN m.player1_id = ? THEN p2.name ELSE p1.name END AS opponent_name,
      CASE WHEN m.player1_id = ? THEN p2.id   ELSE p1.id   END AS opponent_id,
      w.date        AS week_date,
      w.week_number,
      l.id          AS league_id,
      l.name        AS league_name,
      d.name        AS division_name
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w          ON tm.week_id = w.id
    JOIN leagues l        ON w.league_id = l.id
    JOIN players p1       ON m.player1_id = p1.id
    JOIN players p2       ON m.player2_id = p2.id
    JOIN divisions d      ON m.division_id = d.id
    WHERE (m.player1_id = ? OR m.player2_id = ?)
      AND m.player1_score IS NOT NULL
    ORDER BY w.date DESC, w.week_number DESC
  `, [id, id, id, id, id, id, id]);
}

/**
 * Return win/loss counts for every player in one query.
 * Returns [{ id, wins, losses }].
 */
async function getAllPlayerRecords() {
  return all(`
    SELECT
      p.id,
      SUM(CASE WHEN m.winner_id = p.id THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN m.winner_id IS NOT NULL AND m.winner_id != p.id THEN 1 ELSE 0 END) AS losses
    FROM players p
    LEFT JOIN matches m ON m.player1_id = p.id OR m.player2_id = p.id
    GROUP BY p.id
  `);
}

module.exports = { getAllPlayers, getPlayerById, addPlayer, updatePlayer, deletePlayer, getPlayerMatchHistory, getAllPlayerRecords };
