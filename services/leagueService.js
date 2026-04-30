const { run, get } = require('../database/db');
const leagueModel = require('../models/leagueModel');
const { generateRoundRobin, generateModernRoundRobin, addDays } = require('../utils/helpers');

/**
 * Create a full league: teams, divisions, player assignments, and schedule.
 *
 * @param {object} data
 * @param {string} data.name
 * @param {string} data.startDate        YYYY-MM-DD
 * @param {Array}  data.rankedPlayers    [{ playerId, rank }] sorted rank 1 = best
 * @param {number} data.numTeams
 * @param {number} data.numDivisions
 * @param {number} [data.numRounds=1]       How many times to repeat the full round-robin
 * @param {string[]} [data.blackoutDates=[]]   YYYY-MM-DD dates to skip when assigning weeks
 * @param {string[]} [data.teamNames=[]]       Custom team names; falls back to "Team A", "Team B", …
 */
function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function createModernLeague({ name, startDate, divisions, numRounds = 1, blackoutDates = [], matchStartTime = '19:00', numCourts = 2, matchDuration = 45, matchBuffer = 15, scheduleCourts = false, courtIds = [] }) {
  const numDivisions = divisions.length;
  const useNewCourts = courtIds.length > 0;
  const effectiveCourts = useNewCourts ? courtIds.length : numCourts;
  const leagueId = leagueModel.createLeagueRecord({
    name, startDate, numTeams: 0, numDivisions, setup_type: 'modern',
    numRounds, blackoutDates, matchStartTime,
    numCourts: effectiveCourts,
    matchDuration, matchBuffer,
    scheduleCourts: useNewCourts ? true : scheduleCourts,
  });

  // Create divisions
  const divisionIds = [];
  for (let i = 0; i < numDivisions; i++) {
    const result = run('INSERT INTO divisions (league_id, name, level) VALUES (?, ?, ?)', [leagueId, `Division ${i + 1}`, i + 1]);
    divisionIds.push(result.lastID);
  }

  // Assign players to divisions (no team_id)
  for (let d = 0; d < divisions.length; d++) {
    for (const { playerId, rank } of divisions[d]) {
      run(
        'INSERT INTO league_players (league_id, player_id, skill_rank, team_id, division_id) VALUES (?, ?, ?, NULL, ?)',
        [leagueId, playerId, rank, divisionIds[d]]
      );
    }
  }

  // Generate per-division round-robin schedules
  const divSchedules = divisions.map((divPlayers, d) => {
    const playerIds = divPlayers.map((p) => p.playerId);
    const oneRound = generateModernRoundRobin(playerIds);
    const allRounds = [];
    for (let rep = 0; rep < numRounds; rep++) allRounds.push(...oneRound);
    return { divisionId: divisionIds[d], rounds: allRounds };
  });

  const totalWeeks = Math.max(...divSchedules.map((d) => d.rounds.length));
  const blackoutSet = new Set(blackoutDates);
  const slotMinutes = matchDuration + matchBuffer;
  let currentDate = startDate;

  for (let w = 0; w < totalWeeks; w++) {
    while (blackoutSet.has(currentDate)) currentDate = addDays(currentDate, 7);
    const weekDate = currentDate;
    currentDate = addDays(currentDate, 7);

    const weekResult = run('INSERT INTO weeks (league_id, week_number, date) VALUES (?, ?, ?)', [leagueId, w + 1, weekDate]);
    const weekId = weekResult.lastID;

    const weekMatches = [];

    for (const { divisionId, rounds } of divSchedules) {
      if (w >= rounds.length) continue;
      const round = rounds[w];

      const matchupResult = run('INSERT INTO team_matchups (week_id, division_id) VALUES (?, ?)', [weekId, divisionId]);
      const matchupId = matchupResult.lastID;

      for (const playerId of round.byes) {
        run('INSERT INTO week_byes (week_id, player_id, division_id) VALUES (?, ?, ?)', [weekId, playerId, divisionId]);
      }
      for (const [p1Id, p2Id] of round.matches) {
        weekMatches.push({ matchupId, divId: divisionId, p1Id, p2Id });
      }
    }

    // Shuffle then assign courts/times
    for (let i = weekMatches.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weekMatches[i], weekMatches[j]] = [weekMatches[j], weekMatches[i]];
    }
    for (let i = 0; i < weekMatches.length; i++) {
      const time = addMinutes(matchStartTime, Math.floor(i / effectiveCourts) * slotMinutes);
      if (useNewCourts) {
        run(
          'INSERT INTO matches (matchup_id, division_id, player1_id, player2_id, court_id, match_time) VALUES (?, ?, ?, ?, ?, ?)',
          [weekMatches[i].matchupId, weekMatches[i].divId, weekMatches[i].p1Id, weekMatches[i].p2Id, courtIds[i % effectiveCourts], time]
        );
      } else {
        run(
          'INSERT INTO matches (matchup_id, division_id, player1_id, player2_id, court_number, match_time) VALUES (?, ?, ?, ?, ?, ?)',
          [weekMatches[i].matchupId, weekMatches[i].divId, weekMatches[i].p1Id, weekMatches[i].p2Id, (i % effectiveCourts) + 1, time]
        );
      }
    }
  }

  if (useNewCourts) leagueModel.setLeagueCourts(leagueId, courtIds);
  return leagueId;
}

function createLeague(data) {
  if (data.setup_type === 'modern') return createModernLeague(data);
  return createTraditionalLeague(data);
}

function createTraditionalLeague({ name, startDate, rankedPlayers, numTeams, numDivisions, numRounds = 1, blackoutDates = [], teamNames = [], matchStartTime = '19:00', numCourts = 2, matchDuration = 45, matchBuffer = 15, scheduleCourts = false, courtIds = [] }) {
  const total = numTeams * numDivisions;
  if (total !== rankedPlayers.length) {
    throw new Error(
      `${numTeams} teams × ${numDivisions} divisions = ${total} players needed, but ${rankedPlayers.length} were provided.`
    );
  }

  const useNewCourts = courtIds.length > 0;
  const effectiveCourts = useNewCourts ? courtIds.length : numCourts;
  const leagueId = leagueModel.createLeagueRecord({
    name, startDate, numTeams, numDivisions, numRounds, blackoutDates, matchStartTime,
    numCourts: effectiveCourts, matchDuration, matchBuffer,
    scheduleCourts: useNewCourts ? true : scheduleCourts,
  });

  // --- Teams ---
  const TEAM_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const teamIds = [];
  for (let i = 0; i < numTeams; i++) {
    const teamName = (teamNames[i] && teamNames[i].trim()) || `Team ${TEAM_LABELS[i]}`;
    const result = run(
      'INSERT INTO teams (league_id, name, team_order) VALUES (?, ?, ?)',
      [leagueId, teamName, i + 1]
    );
    teamIds.push(result.lastID);
  }

  // --- Divisions ---
  const divisionIds = [];
  for (let i = 0; i < numDivisions; i++) {
    const result = run(
      'INSERT INTO divisions (league_id, name, level) VALUES (?, ?, ?)',
      [leagueId, `Division ${i + 1}`, i + 1]
    );
    divisionIds.push(result.lastID);
  }

  // --- Assign players ---
  // rankedPlayers is sorted rank 1..N (best to worst).
  // Division d (0-indexed) = top slice of numTeams players within that skill band.
  // Within each division the j-th player (0-indexed) goes to team j.
  for (let i = 0; i < rankedPlayers.length; i++) {
    const divisionIndex = Math.floor(i / numTeams);
    const teamIndex = i % numTeams;
    const { playerId, rank } = rankedPlayers[i];

    run(
      'INSERT INTO league_players (league_id, player_id, skill_rank, team_id, division_id) VALUES (?, ?, ?, ?, ?)',
      [leagueId, playerId, rank, teamIds[teamIndex], divisionIds[divisionIndex]]
    );
  }

  // --- Generate schedule ---
  const oneRound = generateRoundRobin(teamIds);
  const allRounds = [];
  for (let rep = 0; rep < numRounds; rep++) {
    allRounds.push(...oneRound);
  }

  const blackoutSet = new Set(blackoutDates);
  const slotMinutes = matchDuration + matchBuffer;
  let currentDate = startDate;

  for (let r = 0; r < allRounds.length; r++) {
    while (blackoutSet.has(currentDate)) {
      currentDate = addDays(currentDate, 7);
    }
    const weekDate = currentDate;
    currentDate = addDays(currentDate, 7);

    const weekResult = run(
      'INSERT INTO weeks (league_id, week_number, date) VALUES (?, ?, ?)',
      [leagueId, r + 1, weekDate]
    );
    const weekId = weekResult.lastID;

    const weekMatches = [];

    for (const matchup of allRounds[r]) {
      if (matchup.bye) {
        run(
          'INSERT INTO team_matchups (week_id, bye_team_id) VALUES (?, ?)',
          [weekId, matchup.bye]
        );
      } else {
        const matchupResult = run(
          'INSERT INTO team_matchups (week_id, team1_id, team2_id) VALUES (?, ?, ?)',
          [weekId, matchup.team1, matchup.team2]
        );
        const matchupId = matchupResult.lastID;

        for (let d = 0; d < numDivisions; d++) {
          const divId = divisionIds[d];
          const p1 = get(
            'SELECT player_id FROM league_players WHERE league_id = ? AND team_id = ? AND division_id = ?',
            [leagueId, matchup.team1, divId]
          );
          const p2 = get(
            'SELECT player_id FROM league_players WHERE league_id = ? AND team_id = ? AND division_id = ?',
            [leagueId, matchup.team2, divId]
          );
          if (p1 && p2) {
            weekMatches.push({ matchupId, divId, p1Id: p1.player_id, p2Id: p2.player_id });
          }
        }
      }
    }

    // Shuffle matches randomly so no team/player always gets the same time slot
    for (let i = weekMatches.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weekMatches[i], weekMatches[j]] = [weekMatches[j], weekMatches[i]];
    }

    // Assign courts and times: stagger across courts
    for (let i = 0; i < weekMatches.length; i++) {
      const courtIdx = i % effectiveCourts;
      const slotIdx  = Math.floor(i / effectiveCourts);
      const time = addMinutes(matchStartTime, slotIdx * slotMinutes);

      if (useNewCourts) {
        run(
          'INSERT INTO matches (matchup_id, division_id, player1_id, player2_id, court_id, match_time) VALUES (?, ?, ?, ?, ?, ?)',
          [weekMatches[i].matchupId, weekMatches[i].divId, weekMatches[i].p1Id, weekMatches[i].p2Id, courtIds[courtIdx], time]
        );
      } else {
        run(
          'INSERT INTO matches (matchup_id, division_id, player1_id, player2_id, court_number, match_time) VALUES (?, ?, ?, ?, ?, ?)',
          [weekMatches[i].matchupId, weekMatches[i].divId, weekMatches[i].p1Id, weekMatches[i].p2Id, courtIdx + 1, time]
        );
      }
    }
  }

  if (useNewCourts) leagueModel.setLeagueCourts(leagueId, courtIds);
  return leagueId;
}

/**
 * Load a league with all related data (teams, divisions, players, full schedule).
 */
function getFullLeague(leagueId) {
  const league = leagueModel.getLeagueById(leagueId);
  if (!league) return null;

  const isModern = league.setup_type === 'modern';

  const teams     = leagueModel.getTeams(leagueId);
  const divisions = leagueModel.getDivisions(leagueId);
  const players   = leagueModel.getLeaguePlayers(leagueId);
  const weeks     = leagueModel.getWeeks(leagueId);
  const courts    = leagueModel.getLeagueCourts(leagueId);

  const weeksWithData = weeks.map((week) => {
    const matchups = leagueModel.getMatchups(week.id);
    const byes = isModern ? leagueModel.getWeekByes(week.id) : [];
    const matchupsWithMatches = matchups.map((matchup) => {
      const matches = matchup.bye_team_id ? [] : leagueModel.getMatches(matchup.id);
      return { ...matchup, matches };
    });
    return { ...week, matchups: matchupsWithMatches, byes };
  });

  return { ...league, teams, divisions, players, weeks: weeksWithData, courts };
}

module.exports = { createLeague, getFullLeague };
