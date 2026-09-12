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
    return { divisionId: divisionIds[d], level: d + 1, rounds: allRounds };
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

    for (const { divisionId, level, rounds } of divSchedules) {
      if (w >= rounds.length) continue;
      const round = rounds[w];

      const matchupResult = run('INSERT INTO team_matchups (week_id, division_id) VALUES (?, ?)', [weekId, divisionId]);
      const matchupId = matchupResult.lastID;

      for (const playerId of round.byes) {
        run('INSERT INTO week_byes (week_id, player_id, division_id) VALUES (?, ?, ?)', [weekId, playerId, divisionId]);
      }
      for (const [p1Id, p2Id] of round.matches) {
        weekMatches.push({ matchupId, divId: divisionId, level, p1Id, p2Id });
      }
    }

    // Shuffle for fair time slots, then order by division: courts are dealt in
    // club order below, so each time slot hands its lowest-numbered courts to
    // the highest division playing in it (court 1 to Division 1). The sort is
    // stable, so the shuffle still decides who plays early or late within a
    // division.
    for (let i = weekMatches.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weekMatches[i], weekMatches[j]] = [weekMatches[j], weekMatches[i]];
    }
    weekMatches.sort((a, b) => a.level - b.level);
    for (let i = 0; i < weekMatches.length; i++) {
      const time = addMinutes(matchStartTime, Math.floor(i / effectiveCourts) * slotMinutes);
        // Creating a league is creating scheduled matches. Each row carries its
        // own league, week, date, court and time, so every later view finds it
        // by filtering matches rather than walking back up through the matchup.
        run(
          `INSERT INTO matches
             (type, status, league_id, week_id, matchup_id, division_id,
              player1_id, player2_id, scheduled_date, scheduled_time, court_id, court_number)
           VALUES ('league', 'scheduled', @leagueId, @weekId, @matchupId, @divisionId,
                   @p1Id, @p2Id, @date, @time, @courtId, @courtNumber)`,
          {
            leagueId, weekId,
            matchupId:  weekMatches[i].matchupId,
            divisionId: weekMatches[i].divId,
            p1Id:       weekMatches[i].p1Id,
            p2Id:       weekMatches[i].p2Id,
            date: weekDate,
            time,
            courtId:     useNewCourts ? courtIds[i % effectiveCourts] : null,
            courtNumber: useNewCourts ? null : (i % effectiveCourts) + 1,
          }
        );
    }
  }

  if (useNewCourts) leagueModel.setLeagueCourts(leagueId, courtIds);
  return leagueId;
}

/**
 * A doubles league: pairs are the unit. Each division entry is a pair
 * ({ playerIds: [a, b], rank }); both partners also join league_players so
 * every membership query works unchanged. Mirrors createModernLeague rather
 * than generalising it, so the singles paths stay byte-identical.
 */
function createDoublesLeague({ name, startDate, divisions, numRounds = 1, blackoutDates = [], matchStartTime = '19:00', numCourts = 2, matchDuration = 45, matchBuffer = 15, scheduleCourts = false, courtIds = [] }) {
  if (!Array.isArray(divisions) || divisions.length === 0) throw _validationError('Add at least one division.');
  const seen = new Set();
  divisions.forEach((div, i) => {
    if (!Array.isArray(div) || div.length < 2) throw _validationError(`Division ${i + 1} needs at least 2 pairs.`);
    for (const pr of div) {
      const ids = (pr?.playerIds || []).map(Number);
      if (ids.length !== 2 || ids[0] === ids[1] || ids.some((x) => !Number.isInteger(x) || x <= 0)) {
        throw _validationError('Every pair needs 2 different players.');
      }
      for (const id of ids) {
        if (seen.has(id)) throw _validationError('A player can only be in one pair.');
        seen.add(id);
      }
    }
  });

  const numDivisions = divisions.length;
  const useNewCourts = courtIds.length > 0;
  const effectiveCourts = useNewCourts ? courtIds.length : numCourts;
  const leagueId = leagueModel.createLeagueRecord({
    name, startDate, numTeams: 0, numDivisions, setup_type: 'doubles',
    numRounds, blackoutDates, matchStartTime,
    numCourts: effectiveCourts,
    matchDuration, matchBuffer,
    scheduleCourts: useNewCourts ? true : scheduleCourts,
  });

  const divisionIds = [];
  for (let i = 0; i < numDivisions; i++) {
    const result = run('INSERT INTO divisions (league_id, name, level) VALUES (?, ?, ?)', [leagueId, `Division ${i + 1}`, i + 1]);
    divisionIds.push(result.lastID);
  }

  // Pairs, and both partners as league players.
  const pairById = {};
  const divPairIds = divisions.map((div, d) => div.map(({ playerIds, rank }) => {
    const [a, b] = playerIds.map(Number);
    const result = run(
      'INSERT INTO league_pairs (league_id, division_id, player1_id, player2_id, skill_rank) VALUES (?, ?, ?, ?, ?)',
      [leagueId, divisionIds[d], a, b, rank]
    );
    for (const pid of [a, b]) {
      run('INSERT INTO league_players (league_id, player_id, skill_rank, team_id, division_id) VALUES (?, ?, ?, NULL, ?)',
        [leagueId, pid, rank, divisionIds[d]]);
    }
    pairById[result.lastID] = { id: result.lastID, a, b };
    return result.lastID;
  }));

  const divSchedules = divPairIds.map((pairIds, d) => {
    const oneRound = generateModernRoundRobin(pairIds);
    const allRounds = [];
    for (let rep = 0; rep < numRounds; rep++) allRounds.push(...oneRound);
    return { divisionId: divisionIds[d], level: d + 1, rounds: allRounds };
  });

  const totalWeeks = Math.max(...divSchedules.map((d) => d.rounds.length));
  const blackoutSet = new Set(blackoutDates);
  const slotMinutes = matchDuration + matchBuffer;
  let currentDate = startDate;

  for (let w = 0; w < totalWeeks; w++) {
    while (blackoutSet.has(currentDate)) currentDate = addDays(currentDate, 7);
    const weekDate = currentDate;
    currentDate = addDays(currentDate, 7);

    const weekId = run('INSERT INTO weeks (league_id, week_number, date) VALUES (?, ?, ?)', [leagueId, w + 1, weekDate]).lastID;
    const weekMatches = [];

    for (const { divisionId, level, rounds } of divSchedules) {
      if (w >= rounds.length) continue;
      const round = rounds[w];
      const matchupId = run('INSERT INTO team_matchups (week_id, division_id) VALUES (?, ?)', [weekId, divisionId]).lastID;
      for (const pairId of round.byes) {
        run('INSERT INTO week_byes (week_id, player_id, division_id, pair_id) VALUES (?, ?, ?, ?)',
          [weekId, pairById[pairId].a, divisionId, pairId]);
      }
      for (const [pairA, pairB] of round.matches) {
        weekMatches.push({ matchupId, divId: divisionId, level, pairA, pairB });
      }
    }

    // Same fairness shuffle and division ordering as the singles generator.
    for (let i = weekMatches.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weekMatches[i], weekMatches[j]] = [weekMatches[j], weekMatches[i]];
    }
    weekMatches.sort((a, b) => a.level - b.level);
    for (let i = 0; i < weekMatches.length; i++) {
      const time = addMinutes(matchStartTime, Math.floor(i / effectiveCourts) * slotMinutes);
      const A = pairById[weekMatches[i].pairA], B = pairById[weekMatches[i].pairB];
      run(
        `INSERT INTO matches
           (type, status, format, league_id, week_id, matchup_id, division_id,
            player1_id, player1_partner_id, player2_id, player2_partner_id, pair1_id, pair2_id,
            scheduled_date, scheduled_time, court_id, court_number)
         VALUES ('league', 'scheduled', 'doubles', @leagueId, @weekId, @matchupId, @divisionId,
                 @p1, @p1b, @p2, @p2b, @pair1, @pair2, @date, @time, @courtId, @courtNumber)`,
        {
          leagueId, weekId,
          matchupId: weekMatches[i].matchupId,
          divisionId: weekMatches[i].divId,
          p1: A.a, p1b: A.b, p2: B.a, p2b: B.b, pair1: A.id, pair2: B.id,
          date: weekDate, time,
          courtId: useNewCourts ? courtIds[i % effectiveCourts] : null,
          courtNumber: useNewCourts ? null : (i % effectiveCourts) + 1,
        }
      );
    }
  }

  if (useNewCourts) leagueModel.setLeagueCourts(leagueId, courtIds);
  return leagueId;
}

function _validationError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function createLeague(data) {
  if (data.setup_type === 'doubles') return createDoublesLeague(data);
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
            weekMatches.push({ matchupId, divId, level: d + 1, p1Id: p1.player_id, p2Id: p2.player_id });
          }
        }
      }
    }

    // Shuffle so no team/player always gets the same time slot, then order by
    // division: courts are dealt in club order below, so each time slot hands
    // its lowest-numbered courts to the highest division playing in it
    // (court 1 to Division 1). The sort is stable, so the shuffle still
    // decides who plays early or late within a division.
    for (let i = weekMatches.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weekMatches[i], weekMatches[j]] = [weekMatches[j], weekMatches[i]];
    }
    weekMatches.sort((a, b) => a.level - b.level);

    // Assign courts and times: stagger across courts
    for (let i = 0; i < weekMatches.length; i++) {
      const courtIdx = i % effectiveCourts;
      const slotIdx  = Math.floor(i / effectiveCourts);
      const time = addMinutes(matchStartTime, slotIdx * slotMinutes);

        // Creating a league is creating scheduled matches. Each row carries its
        // own league, week, date, court and time, so every later view finds it
        // by filtering matches rather than walking back up through the matchup.
        run(
          `INSERT INTO matches
             (type, status, league_id, week_id, matchup_id, division_id,
              player1_id, player2_id, scheduled_date, scheduled_time, court_id, court_number)
           VALUES ('league', 'scheduled', @leagueId, @weekId, @matchupId, @divisionId,
                   @p1Id, @p2Id, @date, @time, @courtId, @courtNumber)`,
          {
            leagueId, weekId,
            matchupId:  weekMatches[i].matchupId,
            divisionId: weekMatches[i].divId,
            p1Id:       weekMatches[i].p1Id,
            p2Id:       weekMatches[i].p2Id,
            date: weekDate,
            time,
            courtId:     useNewCourts ? courtIds[courtIdx] : null,
            courtNumber: useNewCourts ? null : courtIdx + 1,
          }
        );
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
  const isDoubles = league.setup_type === 'doubles';

  const teams     = leagueModel.getTeams(leagueId);
  const divisions = leagueModel.getDivisions(leagueId);
  const players   = leagueModel.getLeaguePlayers(leagueId);
  const pairs     = isDoubles ? leagueModel.getLeaguePairs(leagueId) : [];
  const weeks     = leagueModel.getWeeks(leagueId);
  const courts    = leagueModel.getLeagueCourts(leagueId);

  const weeksWithData = weeks.map((week) => {
    const matchups = leagueModel.getMatchups(week.id);
    const byes = isModern || isDoubles ? leagueModel.getWeekByes(week.id) : [];
    const matchupsWithMatches = matchups.map((matchup) => {
      const matches = matchup.bye_team_id ? [] : leagueModel.getMatches(matchup.id);
      return { ...matchup, matches };
    });
    return { ...week, matchups: matchupsWithMatches, byes };
  });

  return { ...league, teams, divisions, players, pairs, weeks: weeksWithData, courts };
}

module.exports = { createLeague, getFullLeague };
