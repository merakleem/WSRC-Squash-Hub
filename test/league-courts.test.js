// Divisions get courts in club order: within every time slot, the
// lowest-numbered courts go to the highest division playing in it
// (court 1 to Division 1), for both league setup types.
// Run: node --test test/league-courts.test.js
const { suite, scratchDb } = require('./lib/suite');

suite('league court assignment', async ({ ok, t }) => {
  const dbm = require('../database/db');
  dbm.initDB(scratchDb(t, 'league-courts'));
  const { all, run } = dbm;
  const leagueService = require('../services/leagueService');


  for (let i = 1; i <= 3; i++) run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', [`Court ${i}`, i]);
  const courts = all('SELECT id, name FROM courts ORDER BY sort_order');
  for (let i = 1; i <= 12; i++) run('INSERT INTO players (name) VALUES (?)', [`Player ${i}`]);
  const pids = all('SELECT id FROM players ORDER BY id').map((r) => r.id);

  // Groups a league's matches by time slot and checks the ordering rule.
  function check(leagueId) {
    const rows = all(`
      SELECT m.scheduled_date, m.scheduled_time, m.court_id, d.level
      FROM matches m JOIN divisions d ON d.id = m.division_id
      WHERE m.league_id = ? ORDER BY m.scheduled_date, m.scheduled_time`, [leagueId]);
    const courtRank = new Map(courts.map((c, i) => [c.id, i]));
    const slots = {};
    for (const r of rows) (slots[`${r.scheduled_date} ${r.scheduled_time}`] ||= []).push(r);
    let ordered = true;
    for (const key of Object.keys(slots)) {
      const inSlot = slots[key].slice().sort((a, b) => courtRank.get(a.court_id) - courtRank.get(b.court_id));
      for (let i = 1; i < inSlot.length; i++) if (inSlot[i].level < inSlot[i - 1].level) ordered = false;
    }
    return { rows, ordered, slots };
  }

  console.log('MODERN - 3 divisions of 4, 3 courts');
  const modernId = leagueService.createLeague({
    setup_type: 'modern', name: 'Court Order Test', startDate: '2026-10-05',
    divisions: [0, 1, 2].map((d) => pids.slice(d * 4, d * 4 + 4).map((playerId, i) => ({ playerId, rank: d * 4 + i + 1 }))),
    numRounds: 1, matchStartTime: '19:00', matchDuration: 45, matchBuffer: 15,
    courtIds: courts.map((c) => c.id),
  });
  {
    const { rows, ordered } = check(modernId);
    ok('matches were created', rows.length > 0, rows.length);
    ok('every court_id was assigned', rows.every((r) => r.court_id != null));
    ok('within every time slot, lower courts hold higher divisions', ordered);
    const first = rows.filter((r) => r.scheduled_date === rows[0].scheduled_date && r.scheduled_time === '19:00');
    ok('the first slot fills all 3 courts', first.length === 3, JSON.stringify(first.map((r) => [r.court_id, r.level])));
    ok('court 1 in the first slot is Division 1', first.find((r) => r.court_id === courts[0].id)?.level === 1);
  }

  console.log('TRADITIONAL - 2 teams x 3 divisions, 3 courts');
  const tradId = leagueService.createLeague({
    setup_type: 'traditional', name: 'Trad Court Order', startDate: '2026-10-06',
    rankedPlayers: pids.slice(0, 6).map((playerId, i) => ({ playerId, rank: i + 1 })),
    numTeams: 2, numDivisions: 3,
    numRounds: 1, matchStartTime: '19:00', matchDuration: 45, matchBuffer: 15,
    courtIds: courts.map((c) => c.id),
  });
  {
    const { rows, ordered } = check(tradId);
    ok('matches were created', rows.length > 0, rows.length);
    ok('within every time slot, lower courts hold higher divisions', ordered);
    const slot1 = rows.filter((r) => r.scheduled_time === '19:00' && r.scheduled_date === rows[0].scheduled_date);
    ok('division 1 sits on court 1', slot1.find((r) => r.level === 1)?.court_id === courts[0].id,
       JSON.stringify(slot1.map((r) => [r.court_id, r.level])));
  }

  console.log('MODERN - uneven: div 1 has 3 matches a week, div 2 has 1');
  const unevenId = leagueService.createLeague({
    setup_type: 'modern', name: 'Uneven Test', startDate: '2026-10-07',
    divisions: [
      pids.slice(0, 6).map((playerId, i) => ({ playerId, rank: i + 1 })),
      pids.slice(6, 8).map((playerId, i) => ({ playerId, rank: i + 7 })),
    ],
    numRounds: 1, matchStartTime: '19:00', matchDuration: 45, matchBuffer: 15,
    courtIds: courts.map((c) => c.id),
  });
  {
    const { ordered, slots } = check(unevenId);
    ok('within every time slot, lower courts hold higher divisions', ordered);
    const first = slots[Object.keys(slots).sort()[0]];
    ok('div 1 (3 matches) fills the whole first slot, div 2 waits',
       JSON.stringify(first.slice().sort((a, b) => a.court_id - b.court_id).map((r) => r.level)) === '[1,1,1]',
       JSON.stringify(first.map((r) => [r.court_id, r.level])));
  }
});
