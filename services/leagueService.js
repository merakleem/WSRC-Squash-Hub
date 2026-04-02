const { run, get } = require('../database/db');
const leagueModel = require('../models/leagueModel');
const { generateRoundRobin, addDays } = require('../utils/helpers');

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
async function createLeague({ name, startDate, rankedPlayers, numTeams, numDivisions, numRounds = 1, blackoutDates = [], teamNames = [] }) {
  const total = numTeams * numDivisions;
  if (total !== rankedPlayers.length) {
    throw new Error(
      `${numTeams} teams × ${numDivisions} divisions = ${total} players needed, but ${rankedPlayers.length} were provided.`
    );
  }

  // --- League record ---
  const leagueId = await leagueModel.createLeagueRecord({ name, startDate, numTeams, numDivisions, numRounds, blackoutDates });

  // --- Teams ---
  const TEAM_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const teamIds = [];
  for (let i = 0; i < numTeams; i++) {
    const teamName = (teamNames[i] && teamNames[i].trim()) || `Team ${TEAM_LABELS[i]}`;
    const result = await run(
      'INSERT INTO teams (league_id, name, team_order) VALUES (?, ?, ?)',
      [leagueId, teamName, i + 1]
    );
    teamIds.push(result.lastID);
  }

  // --- Divisions ---
  const divisionIds = [];
  for (let i = 0; i < numDivisions; i++) {
    const result = await run(
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
    const divisionIndex = Math.floor(i / numTeams); // which division
    const teamIndex = i % numTeams;                  // which team within that division
    const { playerId, rank } = rankedPlayers[i];

    await run(
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
  let currentDate = startDate;

  for (let r = 0; r < allRounds.length; r++) {
    // Skip any blackout dates
    while (blackoutSet.has(currentDate)) {
      currentDate = addDays(currentDate, 7);
    }
    const weekDate = currentDate;
    currentDate = addDays(currentDate, 7);

    const weekResult = await run(
      'INSERT INTO weeks (league_id, week_number, date) VALUES (?, ?, ?)',
      [leagueId, r + 1, weekDate]
    );
    const weekId = weekResult.lastID;

    for (const matchup of allRounds[r]) {
      if (matchup.bye) {
        await run(
          'INSERT INTO team_matchups (week_id, bye_team_id) VALUES (?, ?)',
          [weekId, matchup.bye]
        );
      } else {
        const matchupResult = await run(
          'INSERT INTO team_matchups (week_id, team1_id, team2_id) VALUES (?, ?, ?)',
          [weekId, matchup.team1, matchup.team2]
        );
        const matchupId = matchupResult.lastID;

        // One match per division between the two teams
        for (let d = 0; d < numDivisions; d++) {
          const divId = divisionIds[d];
          const p1 = await get(
            'SELECT player_id FROM league_players WHERE league_id = ? AND team_id = ? AND division_id = ?',
            [leagueId, matchup.team1, divId]
          );
          const p2 = await get(
            'SELECT player_id FROM league_players WHERE league_id = ? AND team_id = ? AND division_id = ?',
            [leagueId, matchup.team2, divId]
          );

          if (p1 && p2) {
            await run(
              'INSERT INTO matches (matchup_id, division_id, player1_id, player2_id) VALUES (?, ?, ?, ?)',
              [matchupId, divId, p1.player_id, p2.player_id]
            );
          }
        }
      }
    }
  }

  return leagueId;
}

/**
 * Load a league with all related data (teams, divisions, players, full schedule).
 */
async function getFullLeague(leagueId) {
  const league = await leagueModel.getLeagueById(leagueId);
  if (!league) return null;

  const [teams, divisions, players, weeks] = await Promise.all([
    leagueModel.getTeams(leagueId),
    leagueModel.getDivisions(leagueId),
    leagueModel.getLeaguePlayers(leagueId),
    leagueModel.getWeeks(leagueId),
  ]);

  const weeksWithData = await Promise.all(
    weeks.map(async (week) => {
      const matchups = await leagueModel.getMatchups(week.id);
      const matchupsWithMatches = await Promise.all(
        matchups.map(async (matchup) => {
          const matches = matchup.bye_team_id
            ? []
            : await leagueModel.getMatches(matchup.id);
          return { ...matchup, matches };
        })
      );
      return { ...week, matchups: matchupsWithMatches };
    })
  );

  return { ...league, teams, divisions, players, weeks: weeksWithData };
}

module.exports = { createLeague, getFullLeague };
