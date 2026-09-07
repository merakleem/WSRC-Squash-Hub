// The club activity feed labels each player with the ladder rank they held on
// the day of the match. Those labels vanished when the ladder became a rating
// ladder: the feed only knew how to replay leapfrog positions, and correctly
// refused to invent them. A rating ladder has real positions, so the labels now
// come from it.
// Run: node test/activity-ranks.test.js
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8131;
const BASE = `http://localhost:${PORT}`;
const DB = '/tmp/activity-ranks-test.db';
const PORT2 = 8132;
const BASE2 = `http://localhost:${PORT2}`;
const DB2 = '/tmp/activity-ranks-leapfrog.db';

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const JAR = '/tmp/ar-admin.txt';
const login = () => {
  sh(`rm -f ${JAR}`);
  return sh(`curl -s -o /dev/null -w '%{http_code}' -c ${JAR} -X POST ${BASE}/login -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'email=' --data-urlencode 'password=pw'`);
};
const get = (p) => JSON.parse(sh(`curl -s -b ${JAR} ${BASE}${p}`));
const JAR2 = '/tmp/ar-admin2.txt';
const get2 = (p) => JSON.parse(sh(`curl -s -b ${JAR2} ${BASE2}${p}`));
// database/db.js holds one connection in a module-level variable, so the second
// club needs its own copy of the module rather than re-pointing the first.
const requireFresh = (m) => { delete require.cache[require.resolve(m)]; return require(m); };

// Yesterday and today, so every match lands inside the feed's 7-day window
// wherever the clock happens to be when this runs.
const day = (back) => new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);

async function main() {
  try { fs.unlinkSync(DB); } catch (_) {}
  const dbm = require('../database/db');
  dbm.initDB(DB);
  const { run } = dbm;
  const db = dbm.getDB();

  // Four players a clear step apart, so the ladder order is unambiguous.
  const NAMES = ['Aria Vance', 'Bo Salter', 'Cass Nkemdi', 'Dev Oyelaran'];
  NAMES.forEach((n, i) => run('INSERT INTO players (name, club_locker_rating) VALUES (?, ?)', [n, 4.6 - i * 0.3]));
  const idOf = (n) => db.prepare('SELECT id FROM players WHERE name = ?').get(n).id;

  // A rated season starting well before these matches: the feed's old code path
  // only suppressed positions under a rating ladder, so this is the case that
  // regressed.
  run(`INSERT INTO settings (key,value) VALUES ('season_start_md','01-01')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

  const played = (winner, loser, when, w = 3, l = 1) => run(
    `INSERT INTO matches (type, status, player1_id, player2_id, player1_score, player2_score,
                          winner_id, played_at, confirmed_at)
     VALUES ('ladder', 'played', ?, ?, ?, ?, ?, ?, ?)`,
    [idOf(winner), idOf(loser), w, l, idOf(winner), when, when],
  );
  // The club's first season is positional by design; the rating ladder starts
  // with the second. One old result puts this year into that second season.
  played('Aria Vance', 'Bo Salter', '2025-06-01');

  played('Aria Vance', 'Bo Salter', day(2));
  played('Cass Nkemdi', 'Dev Oyelaran', day(1));
  played('Dev Oyelaran', 'Aria Vance', day(0));

  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SESSION_SECRET: 's', SITE_PASSWORD: 'pw', RESEND_API_KEY: '' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 2500));

  try {
    console.log('THE FEED CARRIES A LADDER RANK');
    ok('admin signs in', login() === '302');

    const seasonInfo = get('/api/ladder/season');
    ok('the season really is a rating ladder', seasonInfo.system === 'elo', seasonInfo.system);

    const feed = get('/api/activity?days=7');
    ok('the week\'s matches are in the feed, and last year\'s is not',
      feed.length === 3, String(feed.length));
    ok('both players on every row carry a rank',
      feed.every((m) => Number.isInteger(m.p1_pos) && Number.isInteger(m.p2_pos)),
      JSON.stringify(feed.map((m) => [m.p1_pos, m.p2_pos])));
    ok('and the ranks are real positions, not zeroes or placeholders',
      feed.every((m) => m.p1_pos >= 1 && m.p2_pos >= 1 && m.p1_pos !== m.p2_pos));

    // The rank shown is the one the ladder page would have given that day, so
    // the feed and the ladder cannot disagree about the same moment.
    const ladderNow = get('/api/ladder').map((r) => r.id);
    const todays = feed.find((m) => (m.confirmed_at || '').slice(0, 10) === day(0));
    const expected = (id) => ladderNow.indexOf(id) + 1;
    ok('today\'s row matches the ladder as it stands',
      todays && todays.p1_pos === expected(todays.player1_id) && todays.p2_pos === expected(todays.player2_id),
      todays ? `feed ${todays.p1_pos}/${todays.p2_pos} vs ladder ${expected(todays.player1_id)}/${expected(todays.player2_id)}` : 'no row for today');

    // A rank belongs to the day it was earned. The first match happened before
    // two of these players were on the ladder at all, so its labels must not be
    // today's.
    const oldest = feed.find((m) => (m.confirmed_at || '').slice(0, 10) === day(2));
    ok('an older row is labelled from that day, not from today',
      oldest && oldest.p1_pos === 1 && oldest.p2_pos === 2,
      oldest ? `${oldest.p1_pos}/${oldest.p2_pos}` : 'no oldest row');

  } finally {
    server.kill();
  }

  // The positional ladder's own labels were never wrong, so that path has to
  // survive the change. It cannot be switched on by editing the seasons table -
  // seasons are derived from the matches themselves - so it needs a club whose
  // current season is its first, which is the one season played positionally.
  console.log('\nA LEAPFROG SEASON STILL USES ITS OWN POSITIONS');
  try { fs.unlinkSync(DB2); } catch (_) {}
  const dbm2 = requireFresh('../database/db');
  dbm2.initDB(DB2);
  const db2 = dbm2.getDB();
  NAMES.forEach((n, i) => dbm2.run('INSERT INTO players (name, club_locker_rating) VALUES (?, ?)', [n, 4.6 - i * 0.3]));
  dbm2.run(`INSERT INTO settings (key,value) VALUES ('season_start_md','01-01')
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  const id2 = (n) => db2.prepare('SELECT id FROM players WHERE name = ?').get(n).id;
  for (const [w, l, when] of [['Aria Vance', 'Bo Salter', day(2)], ['Dev Oyelaran', 'Aria Vance', day(0)]]) {
    dbm2.run(
      `INSERT INTO matches (type, status, player1_id, player2_id, player1_score, player2_score,
                            winner_id, played_at, confirmed_at)
       VALUES ('ladder', 'played', ?, ?, 3, 1, ?, ?, ?)`,
      [id2(w), id2(l), id2(w), when, when],
    );
  }

  const server2 = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT2), DB_PATH: DB2, SESSION_SECRET: 's', SITE_PASSWORD: 'pw', RESEND_API_KEY: '' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 2500));
  try {
    sh(`rm -f ${JAR2}`);
    sh(`curl -s -o /dev/null -c ${JAR2} -X POST ${BASE2}/login -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'email=' --data-urlencode 'password=pw'`);
    ok('this club is still on its first, positional season', get2('/api/ladder/season').system === 'leapfrog',
      get2('/api/ladder/season').system);
    const legacy = get2('/api/activity?days=7');
    ok('its rows are labelled from the positional replay',
      legacy.length > 0 && legacy.every((m) => Number.isInteger(m.p1_pos) && Number.isInteger(m.p2_pos)),
      JSON.stringify(legacy.map((m) => [m.p1_pos, m.p2_pos])));
    ok('and it still reports moving up, which only leapfrog can mean',
      legacy.some((m) => m.places_moved > 0), JSON.stringify(legacy.map((m) => m.places_moved)));
  } finally {
    server2.kill();
  }

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
}

main();
