const { run, all, get, getDB } = require('../database/db');

// ===== HELPERS =====

function _addDays(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function _minutesToTime(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// Round-robin pairs for 4-player group → 3 rounds of 2 pairs
function _rrPairs() {
  return [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
}

// Snake-seed 16 players (sorted best→worst by ladder rank) into groups A,B,C,D.
// Seed 1 (best) gets group A with seeds 8,9,16 — weakest possible opponents.
function _snakeSeed(players) {
  const order = ['A','B','C','D','D','C','B','A','A','B','C','D','D','C','B','A'];
  const groups = { A: [], B: [], C: [], D: [] };
  players.forEach((p, i) => groups[order[i]].push(p));
  return groups;
}

function _hasLeagueConflict(db, courtId, date, startTime, durationMinutes) {
  const [h, m] = startTime.split(':').map(Number);
  const startMin = h * 60 + m;
  const endMin = startMin + durationMinutes;
  const matches = db.prepare(`
    SELECT m.match_time AS start_time, l.match_duration
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w ON tm.week_id = w.id
    JOIN leagues l ON w.league_id = l.id
    WHERE m.court_id = ? AND w.date = ? AND m.match_time IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)
  `).all(courtId, date);
  return matches.some(lm => {
    const [bh, bm] = lm.start_time.split(':').map(Number);
    const bs = bh * 60 + bm;
    return startMin < bs + (lm.match_duration || 45) && bs < endMin;
  });
}

// Assign time slots to a list of match shells, filling courts greedily.
// Returns array of { ...match, match_date, match_time, court_id }.
// maxParallel caps how many matches share the same time slot (default: all courts).
// Court index resets each slot so perSlot=1 always uses court[0].
function _scheduleMatches(matches, courts, duration, buffer, date, startHour, maxParallel) {
  const perSlot = Math.min(courts.length, maxParallel || courts.length);
  let slotMinutes = startHour * 60;
  let inSlot = 0;
  return matches.map(match => {
    const scheduled = { ...match, match_date: date, match_time: _minutesToTime(slotMinutes), court_id: courts[inSlot].id };
    inSlot++;
    if (inSlot >= perSlot) { inSlot = 0; slotMinutes += duration + buffer; }
    return scheduled;
  });
}

// Check all proposed time slots for a given day for league conflicts.
// Returns the date string if any conflict found, null otherwise.
function _checkDayConflicts(db, date, numMatches, courts, duration, buffer, startHour, maxParallel) {
  const perSlot = Math.min(courts.length, maxParallel || courts.length);
  let slotMinutes = startHour * 60;
  let inSlot = 0;
  for (let i = 0; i < numMatches; i++) {
    if (_hasLeagueConflict(db, courts[inSlot].id, date, _minutesToTime(slotMinutes), duration)) return date;
    inSlot++;
    if (inSlot >= perSlot) { inSlot = 0; slotMinutes += duration + buffer; }
  }
  return null;
}

// Delete regular bookings that overlap with a tournament time slot.
function _deleteConflictingBookings(db, courtId, date, startTime, durationMinutes) {
  const [h, m] = startTime.split(':').map(Number);
  const startMin = h * 60 + m;
  const endMin = startMin + durationMinutes;
  const rows = db.prepare('SELECT id, group_id, start_time, duration_minutes FROM bookings WHERE court_id = ? AND date = ?').all(courtId, date);
  const groupsToDelete = new Set();
  const singlesToDelete = new Set();
  for (const row of rows) {
    const [bh, bm] = row.start_time.split(':').map(Number);
    const bs = bh * 60 + bm;
    if (startMin < bs + row.duration_minutes && bs < endMin) {
      if (row.group_id) groupsToDelete.add(row.group_id);
      else singlesToDelete.add(row.id);
    }
  }
  groupsToDelete.forEach(gid => db.prepare('DELETE FROM bookings WHERE group_id = ?').run(gid));
  singlesToDelete.forEach(bid => db.prepare('DELETE FROM bookings WHERE id = ?').run(bid));
}

// ===== PUBLIC API =====

function getTournaments() {
  return all('SELECT * FROM tournaments ORDER BY championship_date DESC, created_at DESC');
}

function getTournament(id) {
  const db = getDB();
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(Number(id));
  if (!tournament) return null;

  const courts = db.prepare(`
    SELECT c.* FROM tournament_courts tc
    JOIN courts c ON c.id = tc.court_id
    WHERE tc.tournament_id = ? ORDER BY c.sort_order, c.id
  `).all(Number(id));

  const groups = db.prepare('SELECT * FROM tournament_groups WHERE tournament_id = ? ORDER BY name').all(Number(id));

  const players = db.prepare(`
    SELECT tp.*, p.name AS player_name, l.position AS ladder_position
    FROM tournament_players tp
    JOIN players p ON p.id = tp.player_id
    LEFT JOIN ladder l ON l.player_id = tp.player_id
    WHERE tp.tournament_id = ? ORDER BY tp.seed ASC
  `).all(Number(id));

  const matches = db.prepare(`
    SELECT tm.*, p1.name AS p1_name, p2.name AS p2_name, c.name AS court_name
    FROM tournament_matches tm
    LEFT JOIN players p1 ON p1.id = tm.player1_id
    LEFT JOIN players p2 ON p2.id = tm.player2_id
    LEFT JOIN courts c ON c.id = tm.court_id
    WHERE tm.tournament_id = ? ORDER BY tm.match_date, tm.match_time
  `).all(Number(id));

  return { ...tournament, courts, groups, players, matches };
}

// Returns { conflicts: [dateStr, ...] } — league match conflicts for proposed week.
function checkTournamentDate({ championshipDate, courtIds, matchDurationMinutes, bufferMinutes }) {
  const db = getDB();
  const duration = Number(matchDurationMinutes) || 60;
  const buffer = Number(bufferMinutes) || 0;

  const courts = db.prepare(
    `SELECT * FROM courts WHERE id IN (${courtIds.map(() => '?').join(',')}) ORDER BY sort_order, id`
  ).all(...courtIds.map(Number));
  if (courts.length === 0) return { conflicts: [] };

  const conflicts = [];
  const groupDays = [
    _addDays(championshipDate, -6), // Mon
    _addDays(championshipDate, -5), // Tue
    _addDays(championshipDate, -4), // Wed
    _addDays(championshipDate, -3), // Thu
  ];

  for (const day of groupDays) {
    const c = _checkDayConflicts(db, day, 6, courts, duration, buffer, 17);
    if (c) conflicts.push(c);
  }
  const qfConflict = _checkDayConflicts(db, _addDays(championshipDate, -1), 4, courts, duration, buffer, 12, 1);
  if (qfConflict) conflicts.push(qfConflict);
  const sfConflict = _checkDayConflicts(db, championshipDate, 3, courts, duration, buffer, 12, 1);
  if (sfConflict) conflicts.push(sfConflict);

  return { conflicts };
}

// Create tournament with auto-generated schedule. groups: { A:[pid,...], B:[...], C:[...], D:[...] }
function createTournament({ name, groups: groupAssignments, championshipDate, courtIds, matchDurationMinutes, bufferMinutes }) {
  const db = getDB();
  const duration = Number(matchDurationMinutes) || 60;
  const buffer = Number(bufferMinutes) || 0;

  const courts = db.prepare(
    `SELECT * FROM courts WHERE id IN (${courtIds.map(() => '?').join(',')}) ORDER BY sort_order, id`
  ).all(...courtIds.map(Number));
  if (courts.length === 0) throw new Error('No valid courts selected.');

  const groupDays = [
    _addDays(championshipDate, -6),
    _addDays(championshipDate, -5),
    _addDays(championshipDate, -4),
    _addDays(championshipDate, -3),
  ];
  const satDate = _addDays(championshipDate, -1);

  // Check league conflicts
  const conflicts = [];
  for (const day of groupDays) {
    const c = _checkDayConflicts(db, day, 6, courts, duration, buffer, 17);
    if (c) conflicts.push(c);
  }
  if (_checkDayConflicts(db, satDate, 4, courts, duration, buffer, 12, 1)) conflicts.push(satDate);
  if (_checkDayConflicts(db, championshipDate, 3, courts, duration, buffer, 12, 1)) conflicts.push(championshipDate);
  if (conflicts.length > 0) throw Object.assign(new Error('League match conflicts detected.'), { leagueConflicts: conflicts });

  const txn = db.transaction(() => {
    const tr = db.prepare(
      `INSERT INTO tournaments (name, type, status, championship_date, match_duration_minutes, buffer_minutes) VALUES (?, 'groups_16', 'group_stage', ?, ?, ?)`
    ).run(name, championshipDate, duration, buffer);
    const tournamentId = tr.lastInsertRowid;

    for (const courtId of courtIds.map(Number)) {
      db.prepare('INSERT OR IGNORE INTO tournament_courts (tournament_id, court_id) VALUES (?, ?)').run(tournamentId, courtId);
    }

    const groupNames = ['A', 'B', 'C', 'D'];
    const groupIdMap = {};
    for (const gName of groupNames) {
      const gr = db.prepare('INSERT INTO tournament_groups (tournament_id, name) VALUES (?, ?)').run(tournamentId, gName);
      groupIdMap[gName] = gr.lastInsertRowid;
    }

    let seed = 1;
    for (const gName of groupNames) {
      for (const playerId of (groupAssignments[gName] || [])) {
        db.prepare('INSERT INTO tournament_players (tournament_id, player_id, group_id, seed) VALUES (?, ?, ?, ?)').run(tournamentId, Number(playerId), groupIdMap[gName], seed++);
      }
    }

    // Generate group stage matches: 3 rounds × 4 groups × 2 matches = 24 total
    const allGroupMatches = [];
    for (const [pair1, pair2] of _rrPairs()) {
      for (const gName of groupNames) {
        const gPlayers = groupAssignments[gName] || [];
        const gId = groupIdMap[gName];
        for (const [i, j] of [pair1, pair2]) {
          allGroupMatches.push({ tournament_id: tournamentId, round: 'group', group_id: gId, player1_id: Number(gPlayers[i]), player2_id: Number(gPlayers[j]) });
        }
      }
    }

    // Assign group matches across Mon–Thu (6 per day)
    for (let dayIdx = 0; dayIdx < 4; dayIdx++) {
      const dayMatches = allGroupMatches.slice(dayIdx * 6, (dayIdx + 1) * 6);
      const scheduled = _scheduleMatches(dayMatches, courts, duration, buffer, groupDays[dayIdx], 17);
      for (const m of scheduled) {
        _deleteConflictingBookings(db, m.court_id, m.match_date, m.match_time, duration);
        db.prepare('INSERT INTO tournament_matches (tournament_id, round, group_id, player1_id, player2_id, court_id, match_date, match_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(m.tournament_id, m.round, m.group_id, m.player1_id, m.player2_id, m.court_id, m.match_date, m.match_time);
      }
    }

    // Quarterfinals (players TBD until group stage complete)
    const qfShells = ['QF1','QF2','QF3','QF4'].map(slot => ({ tournament_id: tournamentId, round: 'quarterfinal', bracket_slot: slot }));
    for (const m of _scheduleMatches(qfShells, courts, duration, buffer, satDate, 12, 1)) {
      _deleteConflictingBookings(db, m.court_id, m.match_date, m.match_time, duration);
      db.prepare('INSERT INTO tournament_matches (tournament_id, round, bracket_slot, court_id, match_date, match_time) VALUES (?, ?, ?, ?, ?, ?)').run(m.tournament_id, m.round, m.bracket_slot, m.court_id, m.match_date, m.match_time);
    }

    // Semifinals + Final (players TBD)
    const koShells = [
      { tournament_id: tournamentId, round: 'semifinal', bracket_slot: 'SF1' },
      { tournament_id: tournamentId, round: 'semifinal', bracket_slot: 'SF2' },
      { tournament_id: tournamentId, round: 'final', bracket_slot: 'F' },
    ];
    for (const m of _scheduleMatches(koShells, courts, duration, buffer, championshipDate, 12, 1)) {
      _deleteConflictingBookings(db, m.court_id, m.match_date, m.match_time, duration);
      db.prepare('INSERT INTO tournament_matches (tournament_id, round, bracket_slot, court_id, match_date, match_time) VALUES (?, ?, ?, ?, ?, ?)').run(m.tournament_id, m.round, m.bracket_slot, m.court_id, m.match_date, m.match_time);
    }

    return tournamentId;
  });

  return txn();
}

// Auto-seed players by ladder rank and return proposed group assignments.
function getSuggestedGroups(playerIds) {
  const db = getDB();
  const players = playerIds.map(id => {
    const row = db.prepare('SELECT p.id, p.name, l.position FROM players p LEFT JOIN ladder l ON l.player_id = p.id WHERE p.id = ?').get(Number(id));
    return row || { id: Number(id), name: 'Unknown', position: null };
  });
  // Sort: ladder players first (by position asc), then unranked alphabetically
  players.sort((a, b) => {
    if (a.position && b.position) return a.position - b.position;
    if (a.position) return -1;
    if (b.position) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  return _snakeSeed(players.map(p => p.id));
}

// Calculate current group standings for a tournament.
function getGroupStandings(tournamentId) {
  const db = getDB();
  const groups = db.prepare('SELECT * FROM tournament_groups WHERE tournament_id = ? ORDER BY name').all(Number(tournamentId));
  const players = db.prepare(`
    SELECT tp.*, p.name AS player_name, l.position AS ladder_position
    FROM tournament_players tp JOIN players p ON p.id = tp.player_id
    LEFT JOIN ladder l ON l.player_id = tp.player_id
    WHERE tp.tournament_id = ?
  `).all(Number(tournamentId));
  const matches = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = ?').all(Number(tournamentId), 'group');

  const standings = {};
  for (const g of groups) {
    const gPlayers = players.filter(p => p.group_id === g.id);
    const gMatches = matches.filter(m => m.group_id === g.id);
    const stats = {};
    for (const p of gPlayers) {
      stats[p.player_id] = { player_id: p.player_id, player_name: p.player_name, ladder_position: p.ladder_position, wins: 0, losses: 0, games_won: 0, games_lost: 0 };
    }
    for (const m of gMatches) {
      if (!m.winner_id || !stats[m.player1_id] || !stats[m.player2_id]) continue;
      const sc = m.scores ? JSON.parse(m.scores) : null;
      const p1g = sc ? (sc.p1 || 0) : 0;
      const p2g = sc ? (sc.p2 || 0) : 0;
      stats[m.player1_id].games_won += p1g; stats[m.player1_id].games_lost += p2g;
      stats[m.player2_id].games_won += p2g; stats[m.player2_id].games_lost += p1g;
      if (m.winner_id === m.player1_id) { stats[m.player1_id].wins++; stats[m.player2_id].losses++; }
      else { stats[m.player2_id].wins++; stats[m.player1_id].losses++; }
    }
    standings[g.name] = Object.values(stats).sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const aDiff = a.games_won - a.games_lost, bDiff = b.games_won - b.games_lost;
      if (bDiff !== aDiff) return bDiff - aDiff;
      return (a.ladder_position || 9999) - (b.ladder_position || 9999);
    }).map((s, i) => ({ ...s, rank: i + 1 }));
  }
  return standings;
}

// Populate QF matchups from group standings and advance tournament to knockout.
function advanceToKnockout(db, tournamentId) {
  const standings = getGroupStandings(tournamentId);
  // QF1: 1A vs 2B, QF2: 1B vs 2A, QF3: 1C vs 2D, QF4: 1D vs 2C
  const qfPairs = {
    QF1: [standings.A?.[0], standings.B?.[1]],
    QF2: [standings.B?.[0], standings.A?.[1]],
    QF3: [standings.C?.[0], standings.D?.[1]],
    QF4: [standings.D?.[0], standings.C?.[1]],
  };
  for (const [slot, [p1, p2]] of Object.entries(qfPairs)) {
    if (p1 && p2) {
      db.prepare('UPDATE tournament_matches SET player1_id = ?, player2_id = ? WHERE tournament_id = ? AND bracket_slot = ?').run(p1.player_id, p2.player_id, tournamentId, slot);
    }
  }
  db.prepare("UPDATE tournaments SET status = 'knockout' WHERE id = ?").run(tournamentId);
}

// Record match score and auto-advance bracket.
function updateTournamentMatchScore(matchId, scores, winnerId) {
  const db = getDB();
  const match = db.prepare('SELECT * FROM tournament_matches WHERE id = ?').get(Number(matchId));
  if (!match) throw new Error('Match not found');

  db.prepare('UPDATE tournament_matches SET scores = ?, winner_id = ?, confirmed_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify(scores), Number(winnerId), Number(matchId));

  const tid = match.tournament_id;

  if (match.round === 'group') {
    const allGroup = db.prepare("SELECT winner_id FROM tournament_matches WHERE tournament_id = ? AND round = 'group'").all(tid);
    if (allGroup.every(m => m.winner_id !== null)) advanceToKnockout(db, tid);
  } else if (match.round === 'quarterfinal') {
    // QF1→SF1 player1, QF2→SF2 player1, QF3→SF1 player2, QF4→SF2 player2
    const sfMap = { QF1: ['SF1', 'player1_id'], QF2: ['SF2', 'player1_id'], QF3: ['SF1', 'player2_id'], QF4: ['SF2', 'player2_id'] };
    const [sfSlot, col] = sfMap[match.bracket_slot] || [];
    if (sfSlot) db.prepare(`UPDATE tournament_matches SET ${col} = ? WHERE tournament_id = ? AND bracket_slot = ?`).run(Number(winnerId), tid, sfSlot);
  } else if (match.round === 'semifinal') {
    const col = match.bracket_slot === 'SF1' ? 'player1_id' : 'player2_id';
    db.prepare(`UPDATE tournament_matches SET ${col} = ? WHERE tournament_id = ? AND bracket_slot = 'F'`).run(Number(winnerId), tid);
  } else if (match.round === 'final') {
    db.prepare("UPDATE tournaments SET status = 'completed' WHERE id = ?").run(tid);
  }

  return db.prepare('SELECT * FROM tournament_matches WHERE id = ?').get(Number(matchId));
}

// Clear a match score and undo any bracket advancement it caused.
function clearTournamentMatchScore(matchId) {
  const db = getDB();
  const match = db.prepare('SELECT * FROM tournament_matches WHERE id = ?').get(Number(matchId));
  if (!match || !match.winner_id) return;

  const tid = match.tournament_id;
  const prevWinnerId = match.winner_id;

  db.prepare('UPDATE tournament_matches SET scores = NULL, winner_id = NULL, confirmed_at = NULL WHERE id = ?').run(Number(matchId));

  if (match.round === 'group') {
    // Revert to group_stage status if it was knockout
    db.prepare("UPDATE tournaments SET status = 'group_stage' WHERE id = ? AND status = 'knockout'").run(tid);
    // Clear all QF player slots (group result is now uncertain)
    db.prepare("UPDATE tournament_matches SET player1_id = NULL, player2_id = NULL WHERE tournament_id = ? AND round = 'quarterfinal'").run(tid);
  } else if (match.round === 'quarterfinal') {
    const sfMap = { QF1: ['SF1', 'player1_id'], QF2: ['SF2', 'player1_id'], QF3: ['SF1', 'player2_id'], QF4: ['SF2', 'player2_id'] };
    const [sfSlot, col] = sfMap[match.bracket_slot] || [];
    if (sfSlot) {
      db.prepare(`UPDATE tournament_matches SET ${col} = NULL WHERE tournament_id = ? AND bracket_slot = ?`).run(tid, sfSlot);
      // Also clear that SF's result and cascade to Final
      const sfMatch = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND bracket_slot = ?').get(tid, sfSlot);
      if (sfMatch && sfMatch.winner_id) {
        db.prepare('UPDATE tournament_matches SET scores = NULL, winner_id = NULL WHERE id = ?').run(sfMatch.id);
        const fCol = sfSlot === 'SF1' ? 'player1_id' : 'player2_id';
        db.prepare(`UPDATE tournament_matches SET ${fCol} = NULL, scores = NULL, winner_id = NULL WHERE tournament_id = ? AND bracket_slot = 'F'`).run(tid);
        db.prepare("UPDATE tournaments SET status = 'knockout' WHERE id = ? AND status = 'completed'").run(tid);
      }
    }
  } else if (match.round === 'semifinal') {
    const fCol = match.bracket_slot === 'SF1' ? 'player1_id' : 'player2_id';
    db.prepare(`UPDATE tournament_matches SET ${fCol} = NULL, scores = NULL, winner_id = NULL WHERE tournament_id = ? AND bracket_slot = 'F'`).run(tid);
    db.prepare("UPDATE tournaments SET status = 'knockout' WHERE id = ? AND status = 'completed'").run(tid);
  } else if (match.round === 'final') {
    db.prepare("UPDATE tournaments SET status = 'knockout' WHERE id = ?").run(tid);
  }
}

// Scored tournament matches for a player (for match history display).
function getPlayerTournamentHistory(playerId) {
  const db = getDB();
  const rows = db.prepare(`
    SELECT tm.id, tm.player1_id, tm.player2_id, tm.winner_id, tm.scores,
      COALESCE(tm.confirmed_at, tm.match_date) AS confirmed_at,
      tm.round, tm.bracket_slot,
      t.id AS tournament_id, t.name AS tournament_name,
      p1.name AS p1_name, p2.name AS p2_name
    FROM tournament_matches tm
    JOIN tournaments t ON t.id = tm.tournament_id
    LEFT JOIN players p1 ON p1.id = tm.player1_id
    LEFT JOIN players p2 ON p2.id = tm.player2_id
    WHERE tm.winner_id IS NOT NULL
      AND (tm.player1_id = ? OR tm.player2_id = ?)
    ORDER BY confirmed_at DESC, tm.match_time DESC
  `).all(Number(playerId), Number(playerId));

  return rows.map(m => {
    const isP1 = m.player1_id === Number(playerId);
    const sc = m.scores ? JSON.parse(m.scores) : null;
    const mySets   = sc ? (isP1 ? sc.p1 : sc.p2) : 0;
    const theirSets= sc ? (isP1 ? sc.p2 : sc.p1) : 0;
    const roundLabel = { group:'Group Stage', quarterfinal:'Quarterfinal', semifinal:'Semifinal', final:'Final' }[m.round] || m.round;
    return {
      id: `t_${m.id}`,
      source: 'tournament',
      result: m.winner_id === Number(playerId) ? 'W' : 'L',
      opponent_name: isP1 ? m.p2_name : m.p1_name,
      opponent_id: isP1 ? m.player2_id : m.player1_id,
      week_date: (m.confirmed_at || '').slice(0, 10),
      league_name: m.tournament_name,
      my_score: mySets,
      their_score: theirSets,
      tournament_id: m.tournament_id,
      round_label: roundLabel,
    };
  });
}

// Upcoming unscored tournament matches for a player.
function getPlayerTournamentUpcoming(playerId) {
  const db = getDB();
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT tm.id, tm.player1_id, tm.player2_id, tm.match_date, tm.match_time,
      tm.round, t.id AS tournament_id, t.name AS tournament_name,
      c.name AS court_name,
      p1.name AS p1_name, p2.name AS p2_name
    FROM tournament_matches tm
    JOIN tournaments t ON t.id = tm.tournament_id
    LEFT JOIN courts c ON c.id = tm.court_id
    LEFT JOIN players p1 ON p1.id = tm.player1_id
    LEFT JOIN players p2 ON p2.id = tm.player2_id
    WHERE tm.winner_id IS NULL
      AND (tm.player1_id = ? OR tm.player2_id = ?)
      AND tm.match_date >= ?
    ORDER BY tm.match_date ASC, tm.match_time ASC
  `).all(Number(playerId), Number(playerId), today);

  return rows.map(m => {
    const isP1 = m.player1_id === Number(playerId);
    const roundLabel = { group:'Group Stage', quarterfinal:'Quarterfinal', semifinal:'Semifinal', final:'Final' }[m.round] || m.round;
    return {
      id: `t_${m.id}`,
      source: 'tournament',
      week_date: m.match_date,
      league_name: m.tournament_name,
      opponent_name: isP1 ? (m.p2_name || 'TBD') : (m.p1_name || 'TBD'),
      match_time: m.match_time,
      court_name: m.court_name,
      round_label: roundLabel,
      tournament_id: m.tournament_id,
    };
  });
}

function deleteTournament(id) {
  const db = getDB();
  // ON DELETE CASCADE on all child tables handles the rest
  db.prepare('DELETE FROM tournaments WHERE id = ?').run(Number(id));
}

module.exports = {
  getTournaments,
  getTournament,
  checkTournamentDate,
  createTournament,
  getSuggestedGroups,
  getGroupStandings,
  updateTournamentMatchScore,
  clearTournamentMatchScore,
  getPlayerTournamentHistory,
  getPlayerTournamentUpcoming,
  deleteTournament,
};
