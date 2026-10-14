// Adding an eighth pair to a seven-pair doubles league already under way.
// The new pair takes the bye seat: it plays each existing pair once, on the
// week that pair would have sat out, in the next free slot on the court.
// Every existing match, played or not, stays exactly as it was.
// Run: node --test test/doubles-add-pair.test.js
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ROW = `SELECT id, week_id, matchup_id, division_id, player1_id, player1_partner_id, player2_id, player2_partner_id,
  pair1_id, pair2_id, scheduled_date, scheduled_time, court_id, court_number, player1_score, player2_score, winner_id, status, skipped
  FROM matches ORDER BY id`;

suite('adding a pair to an odd doubles league', async ({ ok, t }) => {
  let db;
  const app = boot(scratchDb(t, 'doubles-add-pair'), (dbm) => {
    db = dbm.getDB();
    const NAMES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2', 'F1', 'F2', 'G1', 'G2', 'Jon Robert', 'Carter Franks', 'Spare', 'Spare Two'];
    NAMES.forEach((n) => dbm.run('INSERT INTO players (name, is_member) VALUES (?, 1)', [n]));
    dbm.run(`INSERT INTO settings (key,value) VALUES ('season_start_md','01-01')`);
    dbm.run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 1', 1]);
    dbm.run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 2', 2]);
  });
  const admin = client(app);
  await admin.login('', process.env.SITE_PASSWORD);

  // Seven pairs, one division, one court, started yesterday.
  const pairs = Array.from({ length: 7 }, (_, i) => ({ playerIds: [i * 2 + 1, i * 2 + 2], rank: i + 1 }));
  let r = await admin.send('POST', '/api/leagues', {
    name: 'Fall Doubles', startDate: day(-1), setup_type: 'doubles', numRounds: 1, blackoutDates: [],
    matchStartTime: '19:00', courtIds: [1], matchDuration: 45, matchBuffer: 15, divisions: [pairs],
  });
  const leagueId = r.body;
  ok('a seven-pair league is built', Number.isInteger(leagueId), JSON.stringify(r.body));
  ok('seven weeks of three matches and one bye', db.prepare('SELECT COUNT(*) n FROM weeks WHERE league_id = ?').get(leagueId).n === 7
    && db.prepare('SELECT COUNT(*) n FROM matches WHERE league_id = ?').get(leagueId).n === 21
    && db.prepare('SELECT COUNT(*) n FROM week_byes').get().n === 7);

  // Part of week 1 is played; a court booking sits where week 3's next slot would be.
  const w1 = db.prepare('SELECT id FROM matches WHERE league_id = ? ORDER BY scheduled_date, scheduled_time LIMIT 1').get(leagueId);
  await admin.send('PUT', `/api/matches/${w1.id}/score`, { player1Score: 3, player2Score: 1, winnerId: db.prepare('SELECT player1_id FROM matches WHERE id = ?').get(w1.id).player1_id });
  const week3 = db.prepare('SELECT MAX(scheduled_date) d FROM matches m JOIN weeks w ON w.id = m.week_id WHERE w.league_id = ? AND w.week_number = 3').get(leagueId).d;
  await admin.send('POST', '/api/bookings', { courtId: 1, date: week3, startTime: '22:00', durationMinutes: 60, name: 'Junior Training' });
  const before = db.prepare(ROW).all();
  const byePairs = db.prepare('SELECT w.week_number, wb.pair_id FROM week_byes wb JOIN weeks w ON w.id = wb.week_id ORDER BY w.week_number').all();

  console.log('\nTHE PREVIEW');
  r = await admin.send('POST', `/api/leagues/${leagueId}/pairs/preview`, { playerIds: [15, 15] });
  ok('the same player twice is refused', r.status === 400 && r.body.error === 'Choose two different players.');
  r = await admin.send('POST', `/api/leagues/${leagueId}/pairs/preview`, { playerIds: [1, 15] });
  ok('someone already in the league is refused', r.status === 400 && r.body.error === 'A1 is already playing in this league.', JSON.stringify(r.body));
  r = await admin.send('POST', `/api/leagues/${leagueId}/pairs/preview`, { playerIds: [15, 16] });
  const plan = r.body;
  ok('the preview names the pair and the division', r.status === 200 && plan.pair.names === 'Jon Robert & Carter Franks' && plan.division.name === 'Division 1', JSON.stringify(r.body).slice(0, 300));
  ok('one new match a week, seven in all', plan.matches.length === 7);
  ok('each against that week\'s bye pair', plan.matches.every((m, i) => m.opponent_pair_id === byePairs[i].pair_id && m.week_number === byePairs[i].week_number));
  ok('so the new pair meets every existing pair once', new Set(plan.matches.map((m) => m.opponent_pair_id)).size === 7);
  ok('in the next slot after the three matches, at 10:00 PM', plan.matches.filter((m) => m.week_number !== 3).every((m) => m.time === '22:00' && m.court_name === 'Court 1'), JSON.stringify(plan.matches.map((m) => m.time)));
  ok('except where a booking holds that slot: then the next one', plan.matches.find((m) => m.week_number === 3).time === '23:00');
  ok('the preview changes nothing', JSON.stringify(db.prepare(ROW).all()) === JSON.stringify(before) && db.prepare('SELECT COUNT(*) n FROM league_pairs').get().n === 7);

  console.log('\nADDING THE PAIR');
  r = await admin.send('POST', `/api/leagues/${leagueId}/pairs`, { playerIds: [15, 16] });
  ok('the pair is added', r.status === 200 && Number.isInteger(r.body.pair.id), JSON.stringify(r.body).slice(0, 200));
  const after = db.prepare(ROW).all();
  ok('every existing match is exactly as it was, the played one included', JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before));
  ok('seven new matches, each the bye pair against the new pair', after.length === 28
    && after.slice(21).every((m, i) => m.pair1_id === byePairs[i].pair_id && m.pair2_id === r.body.pair.id && m.player2_id === 15 && m.player2_partner_id === 16 && m.court_id === 1 && m.status === 'scheduled'));
  ok('each on its own week and that week\'s day', after.slice(21).every((m) => {
    const others = before.filter((b) => b.week_id === m.week_id);
    return others.length === 3 && others.every((o) => o.scheduled_date === m.scheduled_date);
  }));
  ok('no one sits out any more', db.prepare('SELECT COUNT(*) n FROM week_byes').get().n === 0);
  const L = await admin.get(`/api/leagues/${leagueId}`);
  ok('the league page shows eight pairs and sixteen players', L.pairs.length === 8 && L.players.length === 16, `${L.pairs.length} ${L.players.length}`);
  ok('every week has four matches and no bye', L.weeks.every((w) => w.matchups.flatMap((mu) => mu.matches).length === 4 && !w.byes.length));
  ok('the new pair ranks last', L.pairs.find((p) => p.player1_id === 15).skill_rank === 8);
  ok('it is in the activity log', (await admin.get('/api/activity-log')).entries.some((e) => e.text === 'added the pair Jon Robert & Carter Franks to Fall Doubles'));

  console.log('\nAND THEN');
  r = await admin.send('POST', `/api/leagues/${leagueId}/pairs/preview`, { playerIds: [17, 18] });
  ok('an even division has no bye to fill', r.status === 400 && /even number of pairs/.test(r.body.error), JSON.stringify(r.body));
  const staffless = client(app);
  ok('a signed-out visitor cannot add one', (await staffless.getStatus('/api/leagues')) === '302');
});
