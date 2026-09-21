// A league announced before it is built: signing up, the caps and deadlines
// that close it, and building it into the same league row so the people who
// joined stay joined.
// Run: node --test test/leagues-upcoming.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const ADMIN_PW = process.env.SITE_PASSWORD;
const iso = (n) => {
  const d = new Date(Date.now() + n * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

suite('leagues can be announced before they are built', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'leagues-upcoming'), ({ run }) => {
    const hash = bcrypt.hashSync('pw123', 4);
    for (const [i, name] of ['Ana Ruiz', 'Ben Cole', 'Cara Diaz', 'Dev Shah', 'Eli Moss', 'Fay Oduya'].entries()) {
      run('INSERT INTO players (name, email) VALUES (?, ?)', [name, `p${i + 1}@x.invalid`]);
      run('INSERT INTO user_accounts (player_id, password_hash) VALUES (?, ?)', [i + 1, hash]);
    }
  });
  const a = client(app), p1 = client(app), p2 = client(app);
  await a.login('', ADMIN_PW);
  await p1.login('p1@x.invalid', 'pw123');
  await p2.login('p2@x.invalid', 'pw123');

  console.log('ANNOUNCING ONE');
  const announce = (body) => a.send('POST', '/api/leagues/upcoming', body);
  ok('a name is required', (await announce({ startDate: iso(30) })).body.error === 'A name is required.');
  ok('so is a start date', (await announce({ name: 'Autumn Box' })).body.error === 'A start date is required.');
  ok('a deadline after the start is refused', (await announce({ name: 'X', startDate: iso(30), signupDeadline: iso(31) })).body.error === 'Deadline must be on or before the start date.');
  ok('a cap of one is refused', (await announce({ name: 'X', startDate: iso(30), signupCap: 1 })).body.error === 'Spots must be a whole number of at least 2.');
  ok('a player cannot announce one', await p1.status('POST', '/api/leagues/upcoming', { name: 'X', startDate: iso(30) }) === '403');

  const made = await announce({ name: 'Autumn Box League', startDate: iso(30), setupType: 'modern', description: 'Six weeks, one match a week.', signupCap: 4, signupDeadline: iso(20) });
  const id = made.body.id;
  ok('an announcement is created', made.status === 200 && Number.isInteger(id), JSON.stringify(made.body));

  console.log('\nIT READS AS UPCOMING, NOT ACTIVE');
  // The list derives status from match counts; an announcement has no matches,
  // so without care it would read as a running league.
  let list = await a.get('/api/leagues');
  let row = list.find((l) => l.id === id);
  ok('the list says upcoming', row.status === 'upcoming', row.status);
  ok('with its description and cap', row.description === 'Six weeks, one match a week.' && row.signup_cap === 4);
  ok('nobody has signed up yet', row.signup_count === 0 && row.spots_left === 4 && row.full === false);
  ok('and it is not closed', row.signups_closed === false);

  console.log('\nSIGNING UP');
  ok('a player signs up', (await p1.send('POST', `/api/leagues/${id}/signup`)).status === 200);
  ok('signing up twice is not an error', (await p1.send('POST', `/api/leagues/${id}/signup`)).status === 200);
  row = (await p1.get('/api/leagues')).find((l) => l.id === id);
  ok('counted once', row.signup_count === 1 && row.spots_left === 3, JSON.stringify({ n: row.signup_count }));
  ok('and they are told it is them', row.i_signed_up === true);
  ok('someone else is not', (await p2.get('/api/leagues')).find((l) => l.id === id).i_signed_up === false);
  ok('they can withdraw', (await p1.send('DELETE', `/api/leagues/${id}/signup`)).status === 200
    && (await p1.get('/api/leagues')).find((l) => l.id === id).signup_count === 0);
  await p1.send('POST', `/api/leagues/${id}/signup`);
  await p2.send('POST', `/api/leagues/${id}/signup`);

  console.log('\nTHE ROSTER');
  const asAdmin = await a.get(`/api/leagues/${id}`);
  ok('the page carries the signups, newest first', asAdmin.signups.length === 2 && asAdmin.signups[0].name === 'Ben Cole', JSON.stringify(asAdmin.signups.map((s) => s.name)));
  ok('an admin sees member numbers and ratings', 'member_number' in asAdmin.signups[0] && 'club_locker_rating' in asAdmin.signups[0]);
  const asPlayer = await p1.get(`/api/leagues/${id}`);
  ok('a player does not', !('member_number' in asPlayer.signups[0]) && !('club_locker_rating' in asPlayer.signups[0]), JSON.stringify(Object.keys(asPlayer.signups[0])));
  ok('and no email ever goes out with it', !(await p1.text(`/api/leagues/${id}`)).includes('x.invalid'));
  ok('the player is told they are on the list', asPlayer.i_signed_up === true);

  console.log('\nTHE CAP');
  // Three on the list, so a cap of two is both a legal number and fewer than
  // the people already signed up.
  await a.send('POST', `/api/leagues/${id}/signups`, { playerId: 5 });
  ok('the cap cannot be cut below the people already on the list',
    (await a.send('PUT', `/api/leagues/${id}/announcement`, { name: 'Autumn Box League', startDate: iso(30), signupCap: 2 })).body.error === '3 people have already signed up.');
  await a.send('DELETE', `/api/leagues/${id}/signups/5`);
  await a.send('PUT', `/api/leagues/${id}/announcement`, { name: 'Autumn Box League', startDate: iso(30), setupType: 'modern', signupCap: 2 });
  row = (await a.get('/api/leagues')).find((l) => l.id === id);
  ok('at the cap it reads full and closed', row.full === true && row.signups_closed === true && row.spots_left === 0);
  const p3 = client(app);
  await p3.login('p3@x.invalid', 'pw123');
  ok('and a third player is turned away', (await p3.send('POST', `/api/leagues/${id}/signup`)).status === 409);
  ok('but the admin can still add someone by hand', (await a.send('POST', `/api/leagues/${id}/signups`, { playerId: 3 })).status === 200);
  ok('going over the cap, which is the admin\'s to decide', (await a.get('/api/leagues')).find((l) => l.id === id).signup_count === 3);
  ok('and can take someone off again', (await a.send('DELETE', `/api/leagues/${id}/signups/3`)).status === 200
    && (await a.get('/api/leagues')).find((l) => l.id === id).signup_count === 2);
  ok('a player cannot remove anyone', await p1.status('DELETE', `/api/leagues/${id}/signups/2`) === '403');

  console.log('\nTHE DEADLINE');
  const past = (await announce({ name: 'Closed League', startDate: iso(10), signupDeadline: iso(-1) })).body.id;
  row = (await a.get('/api/leagues')).find((l) => l.id === past);
  ok('a deadline gone by closes signups', row.signups_closed === true && row.deadline_passed === true);
  ok('and nobody new can join', (await p1.send('POST', `/api/leagues/${past}/signup`)).status === 409);
  ok('but it is still listed as upcoming', row.status === 'upcoming');

  console.log('\nBUILDING IT');
  await a.send('PUT', `/api/leagues/${id}/announcement`, { name: 'Autumn Box League', startDate: iso(30), setupType: 'modern', signupCap: 6 });
  await a.send('POST', `/api/leagues/${id}/signups`, { playerId: 3 });
  await a.send('POST', `/api/leagues/${id}/signups`, { playerId: 4 });
  const built = await a.send('POST', '/api/leagues', {
    leagueId: id, name: 'Autumn Box League', startDate: iso(30), setup_type: 'modern',
    numRounds: 1, blackoutDates: [], playDays: [], matchStartTime: '18:00', courtIds: [], matchDuration: 45, matchBuffer: 15,
    divisions: [[{ playerId: 1, rank: 1 }, { playerId: 2, rank: 2 }, { playerId: 3, rank: 3 }, { playerId: 4, rank: 4 }]],
  });
  ok('building returns the same league id, not a new one', built.body === id, `${built.body} vs ${id} (${built.text.slice(0, 80)})`);
  const after = await a.get(`/api/leagues/${id}`);
  ok('it is active now', after.status === 'active', after.status);
  ok('with the players, divisions and weeks the wizard made', after.players.length === 4 && after.divisions.length === 1 && after.weeks.length > 0);
  ok('and the settings it chose', after.match_start_time === '18:00');
  list = await a.get('/api/leagues');
  ok('the list agrees it is no longer upcoming', list.find((l) => l.id === id).status === 'active');

  console.log('\nGUARDS');
  ok('a built league cannot be edited as an announcement',
    (await a.send('PUT', `/api/leagues/${id}/announcement`, { name: 'X', startDate: iso(30) })).body.error === 'This league has already been built.');
  ok('and cannot be overwritten by building something else into it',
    (await a.send('POST', '/api/leagues', { leagueId: id, name: 'Hijack', startDate: iso(30), setup_type: 'modern', divisions: [[{ playerId: 1, rank: 1 }, { playerId: 2, rank: 2 }]] })).body.error === 'That league is not waiting to be built.');
  ok('signing up for a built league is not offered', (await p3.send('POST', `/api/leagues/${id}/signup`)).status === 404);

  console.log('\nCANCELLING');
  const doomed = (await announce({ name: 'Cancelled League', startDate: iso(40) })).body.id;
  await p1.send('POST', `/api/leagues/${doomed}/signup`);
  ok('deleting it takes the signups with it', (await a.send('DELETE', `/api/leagues/${doomed}`)).status === 200
    && !(await a.get('/api/leagues')).some((l) => l.id === doomed));
  const { getDB } = require('../database/db');
  ok('no orphaned rows are left behind', getDB().prepare('SELECT COUNT(*) c FROM league_signups WHERE league_id = ?').get(doomed).c === 0);
});
