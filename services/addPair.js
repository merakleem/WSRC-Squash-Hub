// Adding a pair to a doubles division with an odd number of pairs, mid-league.
//
// An odd division's schedule is the round-robin of one more seat than it has
// pairs: the empty seat is the bye. Each week one pair meets the empty seat
// and sits out, and over a round every pair does so exactly once. Seating a
// new pair in that seat makes the schedule exactly the round-robin of the
// even number: the new pair plays each existing pair once, on the week that
// pair would have sat out.
//
// So nothing that exists changes. Every existing match keeps its opponents,
// date, time, court and result. Each week gains one match (the new pair
// against that week's bye pair) in the next free slot on the league's
// courts, and loses its bye.
const { getDB } = require('../database/db');
const bookingModel = require('../models/bookingModel');
const leagueModel = require('../models/leagueModel');

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function _error(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/**
 * What adding the pair would do, without doing it: the division and, for each
 * week with a bye, the match it would gain. Throws a 400 for anything that
 * makes the addition impossible.
 */
function planAddPair(leagueId, { playerIds, divisionId = null }) {
  const db = getDB();
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(Number(leagueId));
  if (!league) throw _error('League not found.', 404);
  if (league.setup_type !== 'doubles') throw _error('Only a doubles league can take a new pair this way.');
  if (league.status === 'completed') throw _error('This league has ended.');
  if (league.status === 'upcoming') throw _error('This league has not been built yet. Add the pair to its signups instead.');

  const [a, b] = (Array.isArray(playerIds) ? playerIds : []).map(Number);
  if (!a || !b || a === b) throw _error('Choose two different players.');
  const players = db.prepare('SELECT id, name FROM players WHERE id IN (?, ?)').all(a, b);
  if (players.length !== 2) throw _error('One of those players does not exist.');
  const taken = db.prepare('SELECT player_id FROM league_players WHERE league_id = ? AND player_id IN (?, ?)').all(league.id, a, b);
  if (taken.length) {
    const who = players.find((p) => p.id === taken[0].player_id).name;
    throw _error(`${who} is already playing in this league.`);
  }

  // The division with the odd count: the one asked for, or the only one.
  const divisions = db.prepare(`SELECT d.id, d.name, COUNT(lp.id) AS pairs FROM divisions d
    LEFT JOIN league_pairs lp ON lp.division_id = d.id WHERE d.league_id = ? GROUP BY d.id ORDER BY d.level`).all(league.id);
  const odd = divisions.filter((d) => d.pairs % 2 === 1);
  const division = divisionId ? divisions.find((d) => d.id === Number(divisionId)) : (odd.length === 1 ? odd[0] : null);
  if (!division) throw _error(odd.length ? 'Choose the division the pair joins.' : 'Every division has an even number of pairs, so there is no bye to fill.');
  if (division.pairs % 2 === 0) throw _error(`${division.name} has an even number of pairs, so there is no bye to fill.`);

  const byes = db.prepare(`SELECT wb.id AS bye_id, wb.pair_id, w.id AS week_id, w.week_number, w.date
    FROM week_byes wb JOIN weeks w ON w.id = wb.week_id
    WHERE w.league_id = ? AND wb.division_id = ? AND wb.pair_id IS NOT NULL ORDER BY w.week_number`).all(league.id, division.id);
  if (!byes.length) throw _error('There are no byes left to fill in this league.');

  // Where matches go: the league's own courts, or its numbered courts.
  const courtIds = leagueModel.getLeagueCourts(league.id).map((c) => c.id);
  const useCourtIds = courtIds.length > 0;
  const courtSlots = useCourtIds ? courtIds : Array.from({ length: Math.max(1, league.num_courts || 1) }, (_, i) => i + 1);
  const courtName = (c) => (useCourtIds ? db.prepare('SELECT name FROM courts WHERE id = ?').get(c)?.name : `Court ${c}`);
  const len = Number(league.match_duration) || 45;
  const step = len + (Number(league.match_buffer) || 0);
  const start = toMin(league.match_start_time || '19:00');

  // What is already on a court that day: every booking, league and tournament
  // match on the schedule, plus this plan's own earlier picks.
  const busyByDate = {};
  function busy(date) {
    if (!busyByDate[date]) {
      busyByDate[date] = [];
      if (useCourtIds) {
        for (const s of bookingModel.getScheduleForDate(date).slots) {
          const ids = s.courtIds?.length ? s.courtIds : [s.courtId];
          for (const c of ids) busyByDate[date].push({ court: c, from: toMin(s.startTime), to: toMin(s.startTime) + Number(s.durationMinutes || 0) });
        }
      } else {
        for (const m of db.prepare(`SELECT scheduled_time, court_number FROM matches WHERE league_id = ? AND scheduled_date = ? AND scheduled_time IS NOT NULL`).all(league.id, date)) {
          busyByDate[date].push({ court: m.court_number, from: toMin(m.scheduled_time), to: toMin(m.scheduled_time) + len });
        }
      }
    }
    return busyByDate[date];
  }
  function nextSlot(date) {
    for (let t = start; t + len <= 24 * 60; t += step) {
      for (const c of courtSlots) {
        if (!busy(date).some((x) => x.court === c && t < x.to && x.from < t + len)) {
          busy(date).push({ court: c, from: t, to: t + len });
          return { time: toHHMM(t), court: c };
        }
      }
    }
    throw _error(`There is no free court slot left on ${date} for the new pair's match.`);
  }

  const pairNames = (pairId) => {
    const p = db.prepare(`SELECT p1.name AS n1, p2.name AS n2 FROM league_pairs lp
      JOIN players p1 ON p1.id = lp.player1_id JOIN players p2 ON p2.id = lp.player2_id WHERE lp.id = ?`).get(pairId);
    return p ? `${p.n1} & ${p.n2}` : 'a pair';
  };

  const matches = byes.map((bye) => {
    // The week's last play day (its only one, for a one-night league).
    const date = db.prepare('SELECT MAX(scheduled_date) AS d FROM matches WHERE week_id = ?').get(bye.week_id)?.d || bye.date;
    const slot = nextSlot(date);
    const matchup = db.prepare('SELECT id FROM team_matchups WHERE week_id = ? AND division_id = ?').get(bye.week_id, division.id);
    return {
      week_number: bye.week_number, week_id: bye.week_id, bye_id: bye.bye_id, matchup_id: matchup?.id || null,
      opponent_pair_id: bye.pair_id, opponent: pairNames(bye.pair_id),
      date, time: slot.time, court: slot.court, court_name: courtName(slot.court), use_court_id: useCourtIds,
    };
  });

  return {
    league: { id: league.id, name: league.name },
    division: { id: division.id, name: division.name },
    pair: { player1_id: a, player2_id: b, names: `${players.find((p) => p.id === a).name} & ${players.find((p) => p.id === b).name}` },
    matches,
  };
}

/**
 * Add the pair: the plan above, written in one transaction. Existing rows
 * are never updated, only byes deleted and new rows inserted.
 */
function addPair(leagueId, input) {
  const db = getDB();
  return db.transaction(() => {
    const plan = planAddPair(leagueId, input);
    const { a, b } = { a: plan.pair.player1_id, b: plan.pair.player2_id };
    const rank = (db.prepare('SELECT MAX(skill_rank) AS r FROM league_pairs WHERE league_id = ?').get(plan.league.id).r || 0) + 1;
    const pairId = Number(db.prepare('INSERT INTO league_pairs (league_id, division_id, player1_id, player2_id, skill_rank) VALUES (?, ?, ?, ?, ?)')
      .run(plan.league.id, plan.division.id, a, b, rank).lastInsertRowid);
    for (const pid of [a, b]) {
      db.prepare('INSERT INTO league_players (league_id, player_id, skill_rank, team_id, division_id) VALUES (?, ?, ?, NULL, ?)')
        .run(plan.league.id, pid, rank, plan.division.id);
    }
    const insert = db.prepare(`INSERT INTO matches
      (type, status, format, league_id, week_id, matchup_id, division_id,
       player1_id, player1_partner_id, player2_id, player2_partner_id, pair1_id, pair2_id,
       scheduled_date, scheduled_time, court_id, court_number)
      VALUES ('league', 'scheduled', 'doubles', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const m of plan.matches) {
      const opp = db.prepare('SELECT player1_id, player2_id FROM league_pairs WHERE id = ?').get(m.opponent_pair_id);
      let matchupId = m.matchup_id;
      if (!matchupId) {
        matchupId = Number(db.prepare('INSERT INTO team_matchups (week_id, division_id) VALUES (?, ?)').run(m.week_id, plan.division.id).lastInsertRowid);
      }
      insert.run(plan.league.id, m.week_id, matchupId, plan.division.id,
        opp.player1_id, opp.player2_id, a, b, m.opponent_pair_id, pairId,
        m.date, m.time, m.use_court_id ? m.court : null, m.use_court_id ? null : m.court);
      db.prepare('DELETE FROM week_byes WHERE id = ?').run(m.bye_id);
    }
    return { ...plan, pair: { ...plan.pair, id: pairId } };
  })();
}

module.exports = { planAddPair, addPair };
