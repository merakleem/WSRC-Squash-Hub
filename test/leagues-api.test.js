// The extra numbers GET /api/leagues carries for the leagues list cards:
// week progress, the last week's date, and the signed-in player's own division.
// Run: node test/leagues-api.test.js
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const PORT = 8129;
const BASE = `http://localhost:${PORT}`;
const DB = '/tmp/leagues-api-test.db';

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const jar = (n) => `/tmp/la-${n}.txt`;
const login = (n, email, pw) => {
  sh(`rm -f ${jar(n)}`);
  return sh(`curl -s -o /dev/null -w '%{http_code}' -c ${jar(n)} -X POST ${BASE}/login -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'email=${email}' --data-urlencode 'password=${pw}'`);
};
const get = (n, p) => JSON.parse(sh(`curl -s -b ${jar(n)} ${BASE}${p}`));

// Dates relative to today, so "elapsed" is exercised rather than hard-coded.
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function main() {
  try { fs.unlinkSync(DB); } catch (_) {}
  const dbm = require('../database/db');
  dbm.initDB(DB);
  const { run } = dbm;

  run("INSERT INTO players (name, email, is_member) VALUES ('Pat Player', 'pat@x.invalid', 1)");
  run("INSERT INTO players (name, email, is_member) VALUES ('Other Olive', 'olive@x.invalid', 1)");
  const hash = bcrypt.hashSync('pw123', 4);
  run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
  run('INSERT INTO user_accounts (player_id, password_hash) VALUES (2, ?)', [hash]);

  // A league with six weeks: three already played, three still to come.
  run(`INSERT INTO leagues (id, name, start_date, num_teams, num_divisions, setup_type)
       VALUES (1, 'Autumn', '${day(-21)}', 0, 3, 'modern')`);
  run("INSERT INTO divisions (id, league_id, name, level) VALUES (1, 1, 'Division 1', 1)");
  run("INSERT INTO divisions (id, league_id, name, level) VALUES (2, 1, 'Division 2', 2)");
  for (const [i, off] of [-21, -14, -7, 7, 14, 21].entries()) {
    run(`INSERT INTO weeks (league_id, week_number, date) VALUES (1, ${i + 1}, '${day(off)}')`);
  }
  // Pat is in Division 2; Olive is in Division 1.
  run('INSERT INTO league_players (league_id, player_id, skill_rank, division_id) VALUES (1, 1, 1, 2)');
  run('INSERT INTO league_players (league_id, player_id, skill_rank, division_id) VALUES (1, 2, 2, 1)');

  // A second league that has been created but never scheduled.
  run(`INSERT INTO leagues (id, name, start_date, num_teams, num_divisions, setup_type)
       VALUES (2, 'Unscheduled', '${day(30)}', 0, 2, 'modern')`);

  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SESSION_SECRET: 's', SITE_PASSWORD: 'pw', RESEND_API_KEY: '' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 2500));

  try {
    login('a', '', 'pw');
    login('pat', 'pat@x.invalid', 'pw123');
    login('olive', 'olive@x.invalid', 'pw123');

    console.log('WEEK PROGRESS');
    const asAdmin = get('a', '/api/leagues');
    const autumn = asAdmin.find((l) => l.name === 'Autumn');
    const unscheduled = asAdmin.find((l) => l.name === 'Unscheduled');
    ok('every week is counted', autumn.total_weeks === 6, String(autumn.total_weeks));
    ok('only the past ones count as elapsed', autumn.weeks_elapsed === 3, String(autumn.weeks_elapsed));
    ok('the last week is the range end', autumn.last_week_date === day(21), autumn.last_week_date);
    ok('a league with no weeks reports zero', unscheduled.total_weeks === 0, String(unscheduled.total_weeks));
    ok('and no last week', unscheduled.last_week_date === null, String(unscheduled.last_week_date));

    console.log('OWN DIVISION');
    const asPat = get('pat', '/api/leagues').find((l) => l.name === 'Autumn');
    const asOlive = get('olive', '/api/leagues').find((l) => l.name === 'Autumn');
    ok('a player gets their own division level', asPat.my_division_level === 2, String(asPat.my_division_level));
    ok('and each player gets their own, not a shared one', asOlive.my_division_level === 1, String(asOlive.my_division_level));
    ok('a league they are not in has none', get('pat', '/api/leagues')
      .find((l) => l.name === 'Unscheduled').my_division_level === null);
    ok('an admin who is not a player gets none', autumn.my_division_level === null, String(autumn.my_division_level));

    console.log('PRIVACY');
    // The payload must not carry anybody else's placement. player_ids is the
    // roster the page already shipped; division is the requester's alone, so
    // the only division-ish keys allowed are the league's own count and the
    // single level belonging to whoever asked.
    const forPat = get('pat', '/api/leagues');
    const keys = [...new Set(forPat.flatMap((l) => Object.keys(l)))];
    const divisionKeys = keys.filter((k) => /division/i.test(k)).sort();
    ok('the only division keys are the count and your own level',
      divisionKeys.join(',') === 'my_division_level,num_divisions', divisionKeys.join(','));
    ok('and each is a plain number, never a per-player map',
      forPat.every((l) => l.my_division_level === null || typeof l.my_division_level === 'number'),
      JSON.stringify(forPat.map((l) => l.my_division_level)));
    // Olive is in Division 1; nothing in Pat's copy may say so.
    ok('another member\'s division is nowhere in the payload',
      JSON.stringify(forPat.find((l) => l.name === 'Autumn').my_division_level) === '2');

    console.log('UNCHANGED FIELDS');
    ok('the roster still ships', Array.isArray(asPat.player_ids) && asPat.player_ids.length === 2);
    ok('status is still derived', autumn.status === 'active', autumn.status);
  } finally {
    server.kill();
  }

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
}

main();
