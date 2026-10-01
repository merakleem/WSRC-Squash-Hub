// ===== KNOCKOUT TOURNAMENTS =====
// A tournament is announced ('upcoming'), members sign up, and the admin
// builds the draw ('active'); it is 'completed' once the final has a winner.
// The draw itself - who meets whom, where a winner goes next - is the shared
// bracket module's, so this file and the page that draws the bracket can never
// disagree about it.
//
// Matches live in the shared matches table (type 'tournament'), one row per
// match that will actually be played: a first-round bye has no row, its player
// is placed straight into their second-round match. bracket_slot is "r-i".
//
// A walkover - an opponent withdrew - is a match with a winner, no score and
// skipped = 1. Skipped keeps it out of records and the ladder, the same as a
// skipped league match.
const { getDB } = require('../database/db');
const { clubToday } = require('../lib/clock');
const K = require('../renderer/knockout.js');

const TOURNAMENT_COLUMNS = `t.*`;

function _courts(db, id) {
  return db.prepare(`
    SELECT c.id, c.name FROM tournament_courts tc
    JOIN courts c ON c.id = tc.court_id
    WHERE tc.tournament_id = ? ORDER BY c.sort_order, c.id
  `).all(id);
}

function _rounds(db, id) {
  return db.prepare('SELECT round_index, round_date, start_time FROM tournament_rounds WHERE tournament_id = ? ORDER BY round_index')
    .all(id).map((r) => ({ date: r.round_date, time: r.start_time }));
}

function _players(db, id) {
  return db.prepare(`
    SELECT tp.player_id, tp.seed, tp.ladder_rank, tp.withdrawn,
           p.name, p.photo_path, p.email, p.member_number
    FROM tournament_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.tournament_id = ? ORDER BY tp.seed ASC
  `).all(id);
}

function _matches(db, id) {
  return db.prepare(`
    SELECT m.id, m.round, m.bracket_slot, m.player1_id, m.player2_id, m.winner_id,
           m.player1_score, m.player2_score, m.skipped, m.status,
           m.scheduled_date, m.scheduled_time, m.court_id, c.name AS court_name, m.played_at
    FROM matches m
    LEFT JOIN courts c ON c.id = m.court_id
    WHERE m.type = 'tournament' AND m.tournament_id = ?
  `).all(id);
}

function getTournamentRow(id) {
  return getDB().prepare('SELECT * FROM tournaments WHERE id = ?').get(Number(id)) || null;
}

/** Everything about one tournament the page needs, as stored. */
function getTournament(id) {
  const db = getDB();
  const t = db.prepare(`SELECT ${TOURNAMENT_COLUMNS} FROM tournaments t WHERE t.id = ?`).get(Number(id));
  if (!t) return null;
  return {
    ...t,
    courts: _courts(db, t.id),
    rounds: _rounds(db, t.id),
    players: _players(db, t.id),
    matches: _matches(db, t.id),
  };
}

/** The tournament a match belongs to, in full. */
function getTournamentForMatch(matchId) {
  const row = getDB().prepare(`SELECT tournament_id FROM matches WHERE type = 'tournament' AND id = ?`).get(Number(matchId));
  return row ? getTournament(row.tournament_id) : null;
}

/** The live bracket for a stored tournament (null while it is only announced). */
function bracketOf(t) {
  if (!t || t.status === 'upcoming' || !t.draw_size) return null;
  const entrants = t.players.map((p) => ({
    id: p.player_id, name: p.name, photo_path: p.photo_path || null,
    rank: p.ladder_rank ?? null, withdrawn: !!p.withdrawn,
  }));
  return K.buildBracket({ draw: t.draw_size, entrants, rounds: t.rounds.map((r) => ({ date: r.date, time: K.toMin(r.time) })), rows: t.matches });
}

function getTournaments() {
  return getDB().prepare('SELECT * FROM tournaments ORDER BY COALESCE(first_round_date, championship_date) DESC, created_at DESC').all();
}

// ===== ANNOUNCING =====

function createAnnouncement({ name, drawCap, firstRoundDate, signupDeadline = null, description = '' }) {
  const r = getDB().prepare(`
    INSERT INTO tournaments (name, type, status, championship_date, first_round_date, draw_cap, signup_deadline, description)
    VALUES (?, 'knockout', 'upcoming', ?, ?, ?, ?, ?)
  `).run(name, firstRoundDate, firstRoundDate, drawCap, signupDeadline, description);
  return Number(r.lastInsertRowid);
}

function updateAnnouncement(id, { name, drawCap, firstRoundDate, signupDeadline = null, description = '' }) {
  getDB().prepare(`
    UPDATE tournaments SET name = ?, draw_cap = ?, first_round_date = ?, championship_date = ?,
      signup_deadline = ?, description = ?
    WHERE id = ? AND status = 'upcoming'
  `).run(name, drawCap, firstRoundDate, firstRoundDate, signupDeadline, description, Number(id));
  return getTournamentRow(id);
}

/** Everyone signed up, in the order they joined. */
function getSignups(tournamentId) {
  return getDB().prepare(`
    SELECT s.player_id, s.created_at, p.name, p.email, p.photo_path, p.member_number
    FROM tournament_signups s
    JOIN players p ON p.id = s.player_id
    WHERE s.tournament_id = ?
    ORDER BY s.created_at ASC, s.id ASC
  `).all(Number(tournamentId));
}

function getSignupCounts() {
  const out = {};
  for (const r of getDB().prepare('SELECT tournament_id, COUNT(*) AS n FROM tournament_signups GROUP BY tournament_id').all()) out[r.tournament_id] = r.n;
  return out;
}

function getSignupsForPlayer(playerId) {
  return getDB().prepare('SELECT tournament_id FROM tournament_signups WHERE player_id = ?').all(Number(playerId)).map((r) => r.tournament_id);
}

function addSignup(tournamentId, playerId) {
  return getDB().prepare('INSERT OR IGNORE INTO tournament_signups (tournament_id, player_id) VALUES (?, ?)').run(Number(tournamentId), Number(playerId)).changes > 0;
}

function removeSignup(tournamentId, playerId) {
  return getDB().prepare('DELETE FROM tournament_signups WHERE tournament_id = ? AND player_id = ?').run(Number(tournamentId), Number(playerId)).changes > 0;
}

// ===== BUILDING THE DRAW =====

/** Problems with a draw before it is built, or [] when it can be. */
function checkDraw({ name, drawCap, entrants, rounds, courtIds, len, buffer }) {
  const errs = [];
  if (!name || !String(name).trim()) errs.push('Tournament name is required.');
  if (!K.DRAW_SIZES.includes(drawCap)) errs.push('The draw must be 8 or 16 players.');
  if (!Array.isArray(entrants) || entrants.length < K.MIN_ENTRANTS) errs.push(`A knockout needs at least ${K.MIN_ENTRANTS} players.`);
  else if (entrants.length > drawCap) errs.push(`The draw is full at ${drawCap}.`);
  else if (new Set(entrants).size !== entrants.length) errs.push('A player is in the draw twice.');
  const draw = K.drawFor((entrants || []).length, drawCap);
  if (!Array.isArray(rounds) || rounds.length !== K.roundCount(draw)) errs.push(`A ${draw}-draw has ${K.roundCount(draw)} rounds to schedule.`);
  else if (rounds.some((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || !/^\d{2}:\d{2}$/.test(r.time || ''))) errs.push('Every round needs a date and a start time.');
  if (!Array.isArray(courtIds) || courtIds.length === 0) errs.push('Pick at least one court.');
  if (!(Number(len) > 0)) errs.push('Match length must be at least a minute.');
  if (!(Number(buffer) >= 0)) errs.push('Buffer cannot be negative.');
  return errs;
}

/**
 * Create the draw: the tournament row (inserted, or the announcement filled
 * in), its courts, rounds, seeded players and every match that will be played,
 * each with its date, time and court. First-round byes have no match; their
 * players go straight into the second round.
 */
function createKnockout({ tournamentId = null, name, drawCap, entrants, seeding, rounds, courtIds, len, buffer, ladderRanks = {} }) {
  const db = getDB();
  const draw = K.drawFor(entrants.length, drawCap);
  const courts = db.prepare(`SELECT id, name FROM courts WHERE id IN (${courtIds.map(() => '?').join(',')}) ORDER BY sort_order, id`).all(...courtIds.map(Number));
  if (!courts.length) throw Object.assign(new Error('Pick at least one court.'), { status: 400 });
  const finalDate = rounds[rounds.length - 1].date;

  return db.transaction(() => {
    let id = tournamentId ? Number(tournamentId) : null;
    if (id) {
      db.prepare(`
        UPDATE tournaments SET name = ?, type = 'knockout', status = 'active', draw_cap = ?, draw_size = ?,
          seeding = ?, championship_date = ?, first_round_date = ?, match_duration_minutes = ?, buffer_minutes = ?
        WHERE id = ? AND status = 'upcoming'
      `).run(name, drawCap, draw, seeding, finalDate, rounds[0].date, len, buffer, id);
    } else {
      id = Number(db.prepare(`
        INSERT INTO tournaments (name, type, status, draw_cap, draw_size, seeding, championship_date, first_round_date, match_duration_minutes, buffer_minutes)
        VALUES (?, 'knockout', 'active', ?, ?, ?, ?, ?, ?, ?)
      `).run(name, drawCap, draw, seeding, finalDate, rounds[0].date, len, buffer).lastInsertRowid);
    }

    for (const c of courts) db.prepare('INSERT OR IGNORE INTO tournament_courts (tournament_id, court_id) VALUES (?, ?)').run(id, c.id);
    rounds.forEach((r, k) => {
      db.prepare('INSERT OR REPLACE INTO tournament_rounds (tournament_id, round_index, round_date, start_time) VALUES (?, ?, ?, ?)').run(id, k, r.date, r.time);
    });
    entrants.forEach((pid, k) => {
      db.prepare('INSERT INTO tournament_players (tournament_id, player_id, seed, ladder_rank) VALUES (?, ?, ?, ?)')
        .run(id, Number(pid), k + 1, ladderRanks[pid] ?? null);
    });

    // The preview bracket decides every slot, time and court; the rows are a
    // copy of it.
    const b = K.buildBracket({
      draw,
      entrants: entrants.map((pid) => ({ id: Number(pid) })),
      rounds: rounds.map((r) => ({ date: r.date, time: K.toMin(r.time) })),
      courts, len: Number(len), buffer: Number(buffer),
    });
    const insert = db.prepare(`
      INSERT INTO matches (type, status, format, tournament_id, round, bracket_slot, player1_id, player2_id, court_id, scheduled_date, scheduled_time)
      VALUES ('tournament', 'scheduled', 'singles', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of b.rounds.flat()) {
      if (m.bye) continue;
      insert.run(id, m.roundKey, m.key, m.p1?.id ?? null, m.p2?.id ?? null, m.court?.id ?? null, m.date, K.toHHMM(m.time));
    }
    return id;
  })();
}

/**
 * Move every match that has not been played onto a new schedule: new round
 * dates and times, courts, match length and buffer. Played matches keep the
 * slot they were played in.
 */
function updateSchedule(id, { rounds, courtIds, len, buffer }) {
  const db = getDB();
  const t = getTournament(id);
  if (!t || t.status === 'upcoming') throw Object.assign(new Error('Tournament not found.'), { status: 404 });
  if (rounds.length !== K.roundCount(t.draw_size)) throw Object.assign(new Error('Every round needs a date and a start time.'), { status: 400 });
  const courts = db.prepare(`SELECT id, name FROM courts WHERE id IN (${courtIds.map(() => '?').join(',')}) ORDER BY sort_order, id`).all(...courtIds.map(Number));
  if (!courts.length) throw Object.assign(new Error('Pick at least one court.'), { status: 400 });

  db.transaction(() => {
    db.prepare('UPDATE tournaments SET match_duration_minutes = ?, buffer_minutes = ?, championship_date = ?, first_round_date = ? WHERE id = ?')
      .run(len, buffer, rounds[rounds.length - 1].date, rounds[0].date, t.id);
    db.prepare('DELETE FROM tournament_courts WHERE tournament_id = ?').run(t.id);
    for (const c of courts) db.prepare('INSERT INTO tournament_courts (tournament_id, court_id) VALUES (?, ?)').run(t.id, c.id);
    rounds.forEach((r, k) => {
      db.prepare('INSERT OR REPLACE INTO tournament_rounds (tournament_id, round_index, round_date, start_time) VALUES (?, ?, ?, ?)').run(t.id, k, r.date, r.time);
    });
    // Same slotting as creation: the k-th real match of a round, in bracket
    // order, takes the k-th place in that round's waves.
    const bySlot = new Map(t.matches.map((m) => [m.bracket_slot, m]));
    const upd = db.prepare('UPDATE matches SET scheduled_date = ?, scheduled_time = ?, court_id = ? WHERE id = ?');
    for (let r = 0; r < rounds.length; r++) {
      const inRound = [...bySlot.values()].filter((m) => K.parseSlot(m.bracket_slot)?.r === r)
        .sort((a, b) => K.parseSlot(a.bracket_slot).i - K.parseSlot(b.bracket_slot).i);
      inRound.forEach((m, k) => {
        if (m.winner_id != null) return;
        const s = K.slotTime(k, { start: K.toMin(rounds[r].time), courtCount: courts.length, len: Number(len), buffer: Number(buffer) });
        upd.run(rounds[r].date, K.toHHMM(s.time), courts[s.courtIndex].id, m.id);
      });
    }
  })();
  return getTournament(t.id);
}

// ===== RESULTS =====

function _row(db, tournamentId, slot) {
  return db.prepare(`SELECT * FROM matches WHERE type = 'tournament' AND tournament_id = ? AND bracket_slot = ?`).get(tournamentId, slot);
}

const _isWithdrawn = (db, tournamentId, playerId) => playerId != null
  && !!db.prepare('SELECT withdrawn FROM tournament_players WHERE tournament_id = ? AND player_id = ?').get(tournamentId, playerId)?.withdrawn;

function _unscore(db, id) {
  db.prepare(`UPDATE matches SET winner_id = NULL, player1_score = NULL, player2_score = NULL, scores = NULL,
    skipped = 0, played_at = NULL, confirmed_at = NULL, submitted_by_player_id = NULL,
    status = CASE WHEN court_id IS NOT NULL AND scheduled_time IS NOT NULL THEN 'scheduled' ELSE 'unscheduled' END
    WHERE id = ?`).run(id);
}

/**
 * Put `playerId` (or nobody) on one side of the match after `slot`, undoing
 * anything that match had already decided if the player there changes.
 */
function _setNext(db, t, slot, playerId) {
  const pos = K.parseSlot(slot);
  const nx = K.nextSlot(pos.r, pos.i, t.draw_size);
  if (!nx) return;
  const row = _row(db, t.id, K.slotKey(nx.r, nx.i));
  if (!row) return;
  const col = nx.side === 1 ? 'player1_id' : 'player2_id';
  if (row[col] === playerId) return;
  if (row.winner_id != null) {
    _unscore(db, row.id);
    _setNext(db, t, row.bracket_slot, null);
  }
  db.prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`).run(playerId, row.id);
  _walkoverIfDue(db, t, row.bracket_slot);
}

/** A match with one withdrawn player and one real one goes to the real one. */
function _walkoverIfDue(db, t, slot) {
  const row = _row(db, t.id, slot);
  if (!row || row.winner_id != null || row.player1_id == null || row.player2_id == null) return;
  const w1 = _isWithdrawn(db, t.id, row.player1_id);
  const w2 = _isWithdrawn(db, t.id, row.player2_id);
  if (w1 === w2) return; // both in, or (oddly) both out: nothing to decide
  const winner = w1 ? row.player2_id : row.player1_id;
  db.prepare(`UPDATE matches SET winner_id = ?, skipped = 1, status = 'played', played_at = COALESCE(scheduled_date, ?) WHERE id = ?`)
    .run(winner, clubToday(), row.id);
  _setNext(db, t, slot, winner);
  _settleStatus(db, t.id);
}

function _settleStatus(db, tournamentId) {
  const t = db.prepare('SELECT draw_size FROM tournaments WHERE id = ?').get(tournamentId);
  const final = _row(db, tournamentId, K.slotKey(K.roundCount(t.draw_size) - 1, 0));
  db.prepare(`UPDATE tournaments SET status = ? WHERE id = ? AND status != 'upcoming'`)
    .run(final && final.winner_id != null ? 'completed' : 'active', tournamentId);
}

/** Validate a best-of-five result: one side won three games, the other fewer. */
function validScore(p1, p2) {
  return Number.isInteger(p1) && Number.isInteger(p2) && p1 >= 0 && p2 >= 0 && p1 <= 3 && p2 <= 3
    && (p1 === 3 || p2 === 3) && p1 !== p2;
}

/**
 * Record (or correct) a result and carry the winner into their next match.
 * A correction that changes the winner undoes whatever the old winner had
 * already played further on.
 */
function recordScore(matchId, { p1, p2 }, { submittedBy = null } = {}) {
  const db = getDB();
  const row = db.prepare(`SELECT * FROM matches WHERE type = 'tournament' AND id = ?`).get(Number(matchId));
  if (!row) throw Object.assign(new Error('Match not found.'), { status: 404 });
  if (row.player1_id == null || row.player2_id == null) throw Object.assign(new Error('Both players need to be known before a score goes in.'), { status: 409 });
  if (!validScore(p1, p2)) throw Object.assign(new Error('One player must win three games, e.g. 3–1.'), { status: 400 });
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(row.tournament_id);
  const winner = p1 > p2 ? row.player1_id : row.player2_id;
  db.transaction(() => {
    db.prepare(`UPDATE matches SET player1_score = ?, player2_score = ?, scores = ?, winner_id = ?, skipped = 0,
        status = 'played', played_at = COALESCE(played_at, scheduled_date, ?), confirmed_at = datetime('now'),
        submitted_by_player_id = ?
      WHERE id = ?`).run(p1, p2, JSON.stringify({ p1, p2 }), winner, clubToday(), submittedBy, row.id);
    _setNext(db, t, row.bracket_slot, winner);
    _settleStatus(db, t.id);
  })();
  return db.prepare('SELECT * FROM matches WHERE id = ?').get(row.id);
}

/** Clear a result, and with it everything the winner went on to play. */
function clearScore(matchId) {
  const db = getDB();
  const row = db.prepare(`SELECT * FROM matches WHERE type = 'tournament' AND id = ?`).get(Number(matchId));
  if (!row || row.winner_id == null) return;
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(row.tournament_id);
  db.transaction(() => {
    _unscore(db, row.id);
    _setNext(db, t, row.bracket_slot, null);
    _settleStatus(db, t.id);
  })();
}

// ===== CHANGING THE ENTRANTS =====

/** Has this player played a real match in the tournament (a walkover does not count)? */
function hasPlayed(tournamentId, playerId) {
  return !!getDB().prepare(`
    SELECT 1 FROM matches WHERE type = 'tournament' AND tournament_id = ? AND winner_id IS NOT NULL
      AND (skipped = 0 OR skipped IS NULL) AND (player1_id = ? OR player2_id = ?)
  `).get(Number(tournamentId), Number(playerId), Number(playerId));
}

/**
 * Swap a player out before they have played: the new player takes their seed,
 * their line in the draw and every match still ahead of them.
 */
function replacePlayer(tournamentId, oldId, newId, { ladderRank = null } = {}) {
  const db = getDB();
  const tid = Number(tournamentId);
  if (hasPlayed(tid, oldId)) throw Object.assign(new Error('They have already played a match.'), { status: 409 });
  if (db.prepare('SELECT 1 FROM tournament_players WHERE tournament_id = ? AND player_id = ?').get(tid, Number(newId))) {
    throw Object.assign(new Error('That player is already in the draw.'), { status: 409 });
  }
  db.transaction(() => {
    db.prepare('UPDATE tournament_players SET player_id = ?, ladder_rank = ?, withdrawn = 0 WHERE tournament_id = ? AND player_id = ?')
      .run(Number(newId), ladderRank, tid, Number(oldId));
    db.prepare(`UPDATE matches SET player1_id = ? WHERE type = 'tournament' AND tournament_id = ? AND player1_id = ? AND winner_id IS NULL`).run(Number(newId), tid, Number(oldId));
    db.prepare(`UPDATE matches SET player2_id = ? WHERE type = 'tournament' AND tournament_id = ? AND player2_id = ? AND winner_id IS NULL`).run(Number(newId), tid, Number(oldId));
  })();
}

/**
 * Withdraw a player before they have played. They keep their line in the
 * draw; their next opponent gets a walkover as soon as there is one.
 */
function withdrawPlayer(tournamentId, playerId) {
  const db = getDB();
  const tid = Number(tournamentId);
  if (hasPlayed(tid, playerId)) throw Object.assign(new Error('They have already played a match.'), { status: 409 });
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tid);
  db.transaction(() => {
    db.prepare('UPDATE tournament_players SET withdrawn = 1 WHERE tournament_id = ? AND player_id = ?').run(tid, Number(playerId));
    const rows = db.prepare(`SELECT bracket_slot FROM matches WHERE type = 'tournament' AND tournament_id = ? AND winner_id IS NULL AND (player1_id = ? OR player2_id = ?)`).all(tid, Number(playerId), Number(playerId));
    for (const r of rows) _walkoverIfDue(db, t, r.bracket_slot);
  })();
}

function deleteTournament(id) {
  // ON DELETE CASCADE on every child table does the rest.
  getDB().prepare('DELETE FROM tournaments WHERE id = ?').run(Number(id));
}

// ===== FOR OTHER PAGES =====

const _roundLabel = (round) => K.ROUND_SINGULAR[round] || round;

/** Played tournament matches for a player, for their match history. Walkovers are left out. */
function getPlayerTournamentHistory(playerId) {
  const rows = getDB().prepare(`
    SELECT tm.id, tm.player1_id, tm.player2_id, tm.winner_id, tm.player1_score, tm.player2_score,
      COALESCE(tm.played_at, tm.scheduled_date) AS played_on,
      tm.round, t.id AS tournament_id, t.name AS tournament_name,
      p1.name AS p1_name, p2.name AS p2_name
    FROM matches tm
    JOIN tournaments t ON t.id = tm.tournament_id
    LEFT JOIN players p1 ON p1.id = tm.player1_id
    LEFT JOIN players p2 ON p2.id = tm.player2_id
    WHERE tm.type = 'tournament' AND tm.winner_id IS NOT NULL AND (tm.skipped = 0 OR tm.skipped IS NULL)
      AND (tm.player1_id = ? OR tm.player2_id = ?)
    ORDER BY played_on DESC, tm.scheduled_time DESC
  `).all(Number(playerId), Number(playerId));

  return rows.map((m) => {
    const isP1 = m.player1_id === Number(playerId);
    return {
      id: `t_${m.id}`,
      source: 'tournament',
      result: m.winner_id === Number(playerId) ? 'W' : 'L',
      opponent_name: isP1 ? m.p2_name : m.p1_name,
      opponent_id: isP1 ? m.player2_id : m.player1_id,
      week_date: String(m.played_on || '').slice(0, 10),
      league_name: m.tournament_name,
      my_score: isP1 ? m.player1_score : m.player2_score,
      their_score: isP1 ? m.player2_score : m.player1_score,
      tournament_id: m.tournament_id,
      round_label: _roundLabel(m.round),
    };
  });
}

/** A player's tournament matches still to play. */
function getPlayerTournamentUpcoming(playerId) {
  const rows = getDB().prepare(`
    SELECT tm.id, tm.player1_id, tm.player2_id, tm.scheduled_date, tm.scheduled_time,
      tm.round, t.id AS tournament_id, t.name AS tournament_name,
      c.name AS court_name, p1.name AS p1_name, p2.name AS p2_name
    FROM matches tm
    JOIN tournaments t ON t.id = tm.tournament_id
    LEFT JOIN courts c ON c.id = tm.court_id
    LEFT JOIN players p1 ON p1.id = tm.player1_id
    LEFT JOIN players p2 ON p2.id = tm.player2_id
    WHERE tm.type = 'tournament' AND tm.winner_id IS NULL
      AND (tm.player1_id = ? OR tm.player2_id = ?)
      AND tm.scheduled_date >= ?
    ORDER BY tm.scheduled_date ASC, tm.scheduled_time ASC
  `).all(Number(playerId), Number(playerId), clubToday());

  return rows.map((m) => {
    const isP1 = m.player1_id === Number(playerId);
    return {
      id: `t_${m.id}`,
      source: 'tournament',
      week_date: m.scheduled_date,
      league_name: m.tournament_name,
      opponent_name: isP1 ? (m.p2_name || 'TBD') : (m.p1_name || 'TBD'),
      opponent_id: isP1 ? m.player2_id : m.player1_id,
      match_time: m.scheduled_time,
      court_name: m.court_name,
      round_label: _roundLabel(m.round),
      tournament_id: m.tournament_id,
    };
  });
}

module.exports = {
  getTournaments,
  getTournament,
  getTournamentRow,
  getTournamentForMatch,
  bracketOf,
  createAnnouncement,
  updateAnnouncement,
  getSignups,
  getSignupCounts,
  getSignupsForPlayer,
  addSignup,
  removeSignup,
  checkDraw,
  createKnockout,
  updateSchedule,
  validScore,
  recordScore,
  clearScore,
  hasPlayed,
  replacePlayer,
  withdrawPlayer,
  deleteTournament,
  getPlayerTournamentHistory,
  getPlayerTournamentUpcoming,
};
