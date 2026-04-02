const { run, all, get } = require('../database/db');

async function getAllLeagues() {
  return all('SELECT * FROM leagues ORDER BY created_at DESC');
}

async function getLeagueById(id) {
  return get('SELECT * FROM leagues WHERE id = ?', [id]);
}

async function createLeagueRecord({ name, startDate, numTeams, numDivisions, numRounds = 1, blackoutDates = [] }) {
  const result = await run(
    'INSERT INTO leagues (name, start_date, num_teams, num_divisions, num_rounds, blackout_dates) VALUES (?, ?, ?, ?, ?, ?)',
    [name, startDate, numTeams, numDivisions, numRounds, JSON.stringify(blackoutDates)]
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
    `SELECT lp.*, p.name AS player_name,
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
            p1.name AS player1_name,
            p2.name AS player2_name,
            d.name  AS division_name,
            d.level AS division_level
     FROM matches m
     JOIN players p1  ON m.player1_id = p1.id
     JOIN players p2  ON m.player2_id = p2.id
     JOIN divisions d ON m.division_id = d.id
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
};
