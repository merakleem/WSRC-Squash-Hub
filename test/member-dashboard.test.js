// What the member dashboard asks the server for that nothing else did: the
// court it should offer, the bye weeks that tell "no match this week" from "no
// league", the fields a booking row needs to name who booked it, and the
// players a ladder move went past.
// Run: node --test test/member-dashboard.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const ADMIN_PW = process.env.SITE_PASSWORD;

// Dates are written relative to the club's today, since the routes read the
// club's clock and a fixed date would rot.
const iso = (n) => {
  const d = new Date(Date.now() + n * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

suite('the member dashboard\'s server side', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'member-dashboard'), ({ run }) => {
    run("INSERT INTO courts (name, sort_order, active) VALUES ('Court 1', 1, 1)");
    run("INSERT INTO courts (name, sort_order, active) VALUES ('Court 2', 2, 1)");
    run("INSERT INTO courts (name, sort_order, active) VALUES ('Court 3', 3, 1)");
    run("INSERT INTO courts (name, sort_order, active) VALUES ('Court 4', 4, 1)");
    run("INSERT INTO booking_types (name, color) VALUES ('Private lesson', '#e8a33d')");
    const hash = bcrypt.hashSync('pw123', 4);
    run("INSERT INTO players (name, email, is_member) VALUES ('Member Mona', 'mona@x.invalid', 1)");
    run("INSERT INTO players (name, email, is_member) VALUES ('Plain Pat', 'pat@x.invalid', 0)");
    run("INSERT INTO players (name, email, is_member) VALUES ('Anna Lindqvist', 'anna@x.invalid', 1)");
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (2, ?)', [hash]);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (3, ?)', [hash]);
  });
  const a = client(app), m = client(app), p = client(app);
  await a.login('', ADMIN_PW);
  await m.login('mona@x.invalid', 'pw123');
  await p.login('pat@x.invalid', 'pw123');

  console.log('THE COURT THE CARD OFFERS');
  ok('a non-member is never offered one', await p.getStatus('/api/bookings/suggest-slot') === '403');
  let slot = await m.get('/api/bookings/suggest-slot');
  ok('with nothing booked, the offer is the lowest court', slot && slot.courtName === 'Court 1' && slot.mode === 'open', JSON.stringify(slot));
  ok('and it is today or tomorrow', [iso(0), iso(1)].includes(slot.date), slot.date);
  const soonest = `${slot.date} ${slot.startTime}`;
  const [soonHour] = slot.startTime.split(':').map(Number);
  const at = (courtId, date, hour, hours = 1) => a.send('POST', '/api/bookings', {
    courtId, date, startTime: `${String(hour).padStart(2, '0')}:00`, durationMinutes: 60 * hours, name: 'Club',
  });
  const fill = async (courtId, date) => { for (let h = 6; h < 23; h++) await at(courtId, date, h); };

  // The time is what a member is choosing between; the court only breaks a tie.
  await fill(1, iso(0));
  await fill(1, iso(1));
  slot = await m.get('/api/bookings/suggest-slot');
  ok('a full court 1 hands the same start to court 2', slot.courtName === 'Court 2' && `${slot.date} ${slot.startTime}` === soonest, JSON.stringify(slot));
  await at(2, slot.date, soonHour);
  slot = await m.get('/api/bookings/suggest-slot');
  ok('a court free sooner wins over a lower-numbered one free later', slot.courtName === 'Court 3' && `${slot.date} ${slot.startTime}` === soonest, JSON.stringify(slot));

  console.log('\nAND IT LEARNS WHICH COURT THEY LIKE');
  // Court 3 is the one they book; with courts 2 and 3 both free at the soonest
  // start it should be named, even though court 2 is the lower number.
  const db = require('../database/db');
  db.run('DELETE FROM bookings WHERE court_id = 2 AND date = ? AND start_time = ?', [slot.date, `${String(soonHour).padStart(2, '0')}:00`]);
  slot = await m.get('/api/bookings/suggest-slot');
  ok('without a history, the lower-numbered of the two wins', slot.courtName === 'Court 2' && slot.mode === 'open', JSON.stringify(slot));
  for (const n of [-7, -14, -21]) {
    await a.send('POST', '/api/bookings', { courtId: 3, date: iso(n), startTime: '19:00', durationMinutes: 45, name: 'Mona', playerIds: [1] });
  }
  slot = await m.get('/api/bookings/suggest-slot');
  ok('their usual court takes it instead', slot.courtName === 'Court 3' && slot.mode === 'usual', JSON.stringify(slot));
  ok('at the same soonest start, not a later one of its own', `${slot.date} ${slot.startTime}` === soonest, JSON.stringify(slot));
  // Only the court is learned, not the hour or the weekday: those bookings were
  // at 19:00 on a day three weeks ago, and the offer ignores both.
  ok('the hour and weekday they used to book are nothing to do with it',
    [iso(0), iso(1)].includes(slot.date) && slot.startTime !== '19:00', `${slot.date} ${slot.startTime}`);
  // Taken at that moment, it falls back to the lowest free court rather than
  // waiting for their own to come free.
  await at(3, slot.date, soonHour);
  slot = await m.get('/api/bookings/suggest-slot');
  ok('when their court is taken, the lowest free one wins', slot.courtName === 'Court 2' && slot.mode === 'open' && `${slot.date} ${slot.startTime}` === soonest, JSON.stringify(slot));
  // Anna books court 4; the two members are offered different courts at the
  // same moment, each their own.
  const anna = client(app);
  await anna.login('anna@x.invalid', 'pw123');
  for (const n of [-3, -10]) {
    await a.send('POST', '/api/bookings', { courtId: 4, date: iso(n), startTime: '08:00', durationMinutes: 45, name: 'Anna', playerIds: [3] });
  }
  const hers = await anna.get('/api/bookings/suggest-slot');
  ok('each member is offered their own court, not the other\'s', hers.courtName === 'Court 4' && slot.courtName === 'Court 2', `${hers.courtName} vs ${slot.courtName}`);
  ok('at the same soonest start', `${hers.date} ${hers.startTime}` === soonest, JSON.stringify(hers));

  console.log('\nBOOKINGS NAME WHO BOOKED THEM');
  await a.send('POST', '/api/bookings', {
    courtId: 2, date: iso(2), startTime: '17:30', durationMinutes: 60,
    name: 'Lesson', bookingTypeId: 1, playerIds: [1],
  });
  const mine = await m.get('/api/my-bookings');
  const lesson = mine.find((b) => b.typeName === 'Private lesson');
  ok('a booking carries its type colour, so the row can tint its tag', lesson && lesson.typeColor === '#e8a33d', JSON.stringify(lesson && lesson.typeColor));
  ok('one the club made has no booker to name', lesson.bookedBy === null && lesson.bookerName === null, JSON.stringify({ by: lesson.bookedBy, name: lesson.bookerName }));

  console.log('\nBYE WEEKS');
  const before = await m.get('/api/players/1/history');
  ok('a player in no league has no byes', Array.isArray(before.byes) && before.byes.length === 0, JSON.stringify(before.byes));
  const { run } = require('../database/db');
  // Inside the current season: a start date in an earlier one would add a
  // second season, which switches the ladder to ratings and takes the places
  // out of the feed rows asserted below.
  run("INSERT INTO leagues (name, start_date, num_teams, num_divisions, setup_type) VALUES ('Box League', ?, 0, 1, 'modern')", [iso(-5)]);
  run("INSERT INTO divisions (league_id, name, level) VALUES (1, 'Division 1', 1)");
  run('INSERT INTO weeks (league_id, week_number, date) VALUES (1, 4, ?)', [iso(-1)]);
  run('INSERT INTO week_byes (week_id, player_id, division_id) VALUES (1, 1, 1)');
  const after = await m.get('/api/players/1/history');
  ok('a bye of theirs comes back with its league and week', after.byes.length === 1 && after.byes[0].league_name === 'Box League' && after.byes[0].week_date === iso(-1), JSON.stringify(after.byes));
  const other = await m.get('/api/players/2/history');
  ok("and never on somebody else's profile", other.byes.length === 0, JSON.stringify(other.byes));

  console.log('\nA LADDER MOVE NAMES WHO IT PASSED');
  // Pat is below Mona on the ladder to start with; beating her passes her.
  await a.send('POST', '/api/matches/pickup', { player1Id: 2, player2Id: 1, player1Score: 3, player2Score: 1 });
  const feed = await m.get('/api/activity');
  const row = feed.find((r) => r.places_moved > 0);
  ok('a rise reports how far', !!row && row.places_moved >= 1, JSON.stringify(feed.map((r) => r.places_moved)));
  ok('and names the players gone past', Array.isArray(row.passed) && row.passed.some((x) => x.name === 'Member Mona'), JSON.stringify(row.passed));
  ok('every row carries the field, so the feed never has to guess', feed.every((r) => Array.isArray(r.passed)));
});
