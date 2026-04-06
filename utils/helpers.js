/**
 * Generate a round-robin schedule for the given array of team IDs.
 * Returns an array of rounds; each round is an array of matchup objects:
 *   { team1, team2 }  — regular match
 *   { bye: teamId }   — bye week
 */
function generateRoundRobin(teams) {
  if (teams.length < 2) return [];

  let list = [...teams];

  if (list.length % 2 === 1) {
    list.push('BYE');
  }

  const numRounds = list.length - 1;
  const half = list.length / 2;
  const fixed = list[0];
  let rotating = list.slice(1);
  const rounds = [];

  for (let r = 0; r < numRounds; r++) {
    const current = [fixed, ...rotating];
    const round = [];

    for (let i = 0; i < half; i++) {
      const t1 = current[i];
      const t2 = current[current.length - 1 - i];

      if (t1 === 'BYE') {
        round.push({ bye: t2 });
      } else if (t2 === 'BYE') {
        round.push({ bye: t1 });
      } else {
        round.push({ team1: t1, team2: t2 });
      }
    }

    rounds.push(round);
    // Rotate: last element moves to front of rotating list
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }

  return rounds;
}

/**
 * Return all valid (teams, divisions) configurations for a given player count.
 * Valid = teams * divisions === numPlayers, teams >= 2, divisions >= 1.
 */
function getValidConfigurations(numPlayers) {
  const configs = [];
  for (let t = 2; t <= numPlayers; t++) {
    if (numPlayers % t === 0) {
      configs.push({ teams: t, divisions: numPlayers / t });
    }
  }
  return configs;
}

/**
 * Add `days` days to a YYYY-MM-DD date string and return a new YYYY-MM-DD string.
 */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Format a YYYY-MM-DD string into a readable display date.
 */
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Generate a round-robin schedule for an array of player IDs (modern leagues).
 * Returns an array of rounds; each round is { matches: [[p1Id, p2Id], ...], byes: [playerId] }.
 */
function generateModernRoundRobin(playerIds) {
  const list = [...playerIds];
  if (list.length % 2 === 1) list.push(null); // null = bye slot
  const numRounds = list.length - 1;
  const half = list.length / 2;
  const fixed = list[0];
  let rotating = list.slice(1);
  const rounds = [];
  for (let r = 0; r < numRounds; r++) {
    const current = [fixed, ...rotating];
    const matches = [], byes = [];
    for (let i = 0; i < half; i++) {
      const p1 = current[i], p2 = current[current.length - 1 - i];
      if (p1 === null) byes.push(p2);
      else if (p2 === null) byes.push(p1);
      else matches.push([p1, p2]);
    }
    rounds.push({ matches, byes });
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

module.exports = { generateRoundRobin, generateModernRoundRobin, getValidConfigurations, addDays, formatDate };
