// The extra numbers GET /api/leagues carries for the leagues list cards:
// week progress, the last week's date, and the signed-in player's own division.
// Run: node --test test/leagues-api.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

// Dates relative to today, so "elapsed" is exercised rather than hard-coded.
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

suite('the leagues list payload', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'leagues-api'), ({ run }) => {
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
    // A third whose first week is tonight: it has started, whatever the hour.
    run(`INSERT INTO leagues (id, name, start_date, num_teams, num_divisions, setup_type)
         VALUES (3, 'Tonight', '${day(0)}', 0, 1, 'modern')`);
    run("INSERT INTO divisions (id, league_id, name, level) VALUES (3, 3, 'Division 1', 1)");
    run(`INSERT INTO weeks (league_id, week_number, date) VALUES (3, 1, '${day(0)}')`);
    run(`INSERT INTO weeks (league_id, week_number, date) VALUES (3, 2, '${day(7)}')`);
  });
  const a = client(app), pat = client(app), olive = client(app);
  await a.login('', 'pw');
  await pat.login('pat@x.invalid', 'pw123');
  await olive.login('olive@x.invalid', 'pw123');

  console.log('WEEK PROGRESS');
  const asAdmin = await a.get('/api/leagues');
  const autumn = asAdmin.find((l) => l.name === 'Autumn');
  const unscheduled = asAdmin.find((l) => l.name === 'Unscheduled');
  ok('every week is counted', autumn.total_weeks === 6, String(autumn.total_weeks));
  ok('the weeks whose date has arrived count as started', autumn.weeks_started === 3, String(autumn.weeks_started));
  const tonight = asAdmin.find((l) => l.name === 'Tonight');
  ok('a week counts from its own date, so tonight\'s league is on week 1 of 2', tonight.weeks_started === 1 && tonight.total_weeks === 2, `${tonight.weeks_started}/${tonight.total_weeks}`);
  ok('the last week is the range end', autumn.last_week_date === day(21), autumn.last_week_date);
  ok('a league with no weeks reports zero', unscheduled.total_weeks === 0, String(unscheduled.total_weeks));
  ok('and no last week', unscheduled.last_week_date === null, String(unscheduled.last_week_date));

  console.log('OWN DIVISION');
  const asPat = (await pat.get('/api/leagues')).find((l) => l.name === 'Autumn');
  const asOlive = (await olive.get('/api/leagues')).find((l) => l.name === 'Autumn');
  ok('a player gets their own division level', asPat.my_division_level === 2, String(asPat.my_division_level));
  ok('and each player gets their own, not a shared one', asOlive.my_division_level === 1, String(asOlive.my_division_level));
  ok('a league they are not in has none', (await pat.get('/api/leagues'))
    .find((l) => l.name === 'Unscheduled').my_division_level === null);
  ok('an admin who is not a player gets none', autumn.my_division_level === null, String(autumn.my_division_level));

  console.log('PRIVACY');
  // The payload must not carry anybody else's placement. player_ids is the
  // roster the page already shipped; division is the requester's alone, so
  // the only division-ish keys allowed are the league's own count and the
  // single level belonging to whoever asked.
  const forPat = await pat.get('/api/leagues');
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
});
