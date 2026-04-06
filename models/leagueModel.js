const { run, all, get } = require('../database/db');
const crypto = require('crypto');

async function getAllLeagues() {
  return all('SELECT * FROM leagues ORDER BY created_at DESC');
}

async function getLeagueById(id) {
  return get('SELECT * FROM leagues WHERE id = ?', [id]);
}

async function createLeagueRecord({ name, startDate, numTeams, numDivisions, numRounds = 1, blackoutDates = [], matchStartTime = '19:00', numCourts = 2, matchDuration = 45, matchBuffer = 15, scheduleCourts = false }) {
  const publicToken = crypto.randomBytes(2).toString('hex');
  const result = await run(
    `INSERT INTO leagues (name, start_date, num_teams, num_divisions, num_rounds, blackout_dates,
       match_start_time, num_courts, match_duration, match_buffer, schedule_courts, public_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, startDate, numTeams, numDivisions, numRounds, JSON.stringify(blackoutDates),
     matchStartTime, numCourts, matchDuration, matchBuffer, scheduleCourts ? 1 : 0, publicToken]
  );
  return result.lastID;
}

async function deleteLeague(id) {
  return run('DELETE FROM leagues WHERE id = ?', [id]);
}

async function getTeams(leagueId) {
  return all(
    'SELECT * FROM teams WHERE league_id = ? ORDER BY team_order ASC',
    [leagueId]
  );
}

async function getDivisions(leagueId) {
  return all(
    'SELECT * FROM divisions WHERE league_id = ? ORDER BY level ASC',
    [leagueId]
  );
}

async function getLeaguePlayers(leagueId) {
  return all(
    `SELECT lp.*, p.name AS player_name, p.email AS player_email,
            t.name AS team_name, t.team_order,
            d.name AS division_name, d.level AS division_level
     FROM league_players lp
     JOIN players p ON lp.player_id = p.id
     JOIN teams t   ON lp.team_id = t.id
     JOIN divisions d ON lp.division_id = d.id
     WHERE lp.league_id = ?
     ORDER BY lp.skill_rank ASC`,
    [leagueId]
  );
}

async function getWeeks(leagueId) {
  return all(
    'SELECT * FROM weeks WHERE league_id = ? ORDER BY week_number ASC',
    [leagueId]
  );
}

async function getMatchups(weekId) {
  return all(
    `SELECT tm.*,
            t1.name AS team1_name,
            t2.name AS team2_name,
            tb.name AS bye_team_name
     FROM team_matchups tm
     LEFT JOIN teams t1 ON tm.team1_id = t1.id
     LEFT JOIN teams t2 ON tm.team2_id = t2.id
     LEFT JOIN teams tb ON tm.bye_team_id = tb.id
     WHERE tm.week_id = ?`,
    [weekId]
  );
}

async function getMatches(matchupId) {
  return all(
    `SELECT m.*,
            p1.name  AS player1_name,
            p2.name  AS player2_name,
            d.name   AS division_name,
            d.level  AS division_level,
            s1.sub_player_id AS sub1_id,
            sp1.name         AS sub1_name,
            s2.sub_player_id AS sub2_id,
            sp2.name         AS sub2_name
     FROM matches m
     JOIN players p1   ON m.player1_id = p1.id
     JOIN players p2   ON m.player2_id = p2.id
     JOIN divisions d  ON m.division_id = d.id
     LEFT JOIN match_subs s1  ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
     LEFT JOIN players sp1    ON sp1.id = s1.sub_player_id
     LEFT JOIN match_subs s2  ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
     LEFT JOIN players sp2    ON sp2.id = s2.sub_player_id
     WHERE m.matchup_id = ?
     ORDER BY d.level ASC`,
    [matchupId]
  );
}

async function updateMatchScore({ matchId, player1Score, player2Score, winnerId }) {
  return run(
    'UPDATE matches SET player1_score = ?, player2_score = ?, winner_id = ? WHERE id = ?',
    [player1Score, player2Score, winnerId || null, matchId]
  );
}

async function setMatchSub(matchId, originalPlayerId, subPlayerId) {
  return run(
    `INSERT INTO match_subs (match_id, original_player_id, sub_player_id) VALUES (?, ?, ?)
     ON CONFLICT (match_id, original_player_id) DO UPDATE SET sub_player_id = excluded.sub_player_id`,
    [matchId, originalPlayerId, subPlayerId]
  );
}

async function removeMatchSub(matchId, originalPlayerId) {
  return run(
    'DELETE FROM match_subs WHERE match_id = ? AND original_player_id = ?',
    [matchId, originalPlayerId]
  );
}

async function skipMatch(matchId) {
  return run(
    'UPDATE matches SET skipped = 1, player1_score = NULL, player2_score = NULL, winner_id = NULL WHERE id = ?',
    [matchId]
  );
}

async function unskipMatch(matchId) {
  return run('UPDATE matches SET skipped = 0 WHERE id = ?', [matchId]);
}

async function setSubForRemaining(leagueId, originalPlayerId, subPlayerId) {
  // Find all unscored matches in this league where the original player is involved
  const remaining = await all(
    `SELECT m.id FROM matches m
     JOIN team_matchups tm ON m.matchup_id = tm.id
     JOIN weeks w ON tm.week_id = w.id
     WHERE w.league_id = ?
       AND m.player1_score IS NULL
       AND (m.player1_id = ? OR m.player2_id = ?)`,
    [leagueId, originalPlayerId, originalPlayerId]
  );
  for (const m of remaining) {
    await setMatchSub(m.id, originalPlayerId, subPlayerId);
  }
  return remaining.length;
}

module.exports = {
  getAllLeagues,
  getLeagueById,
  createLeagueRecord,
  deleteLeague,
  getTeams,
  getDivisions,
  getLeaguePlayers,
  getWeeks,
  getMatchups,
  getMatches,
  updateMatchScore,
  setMatchSub,
  removeMatchSub,
  skipMatch,
  unskipMatch,
  setSubForRemaining,
};
