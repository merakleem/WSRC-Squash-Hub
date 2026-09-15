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
    run("INSERT INTO booking_types (name, color) VALUES ('Private lesson', '#e8a33d')");
    const hash = bcrypt.hashSync('pw123', 4);
    run("INSERT INTO players (name, email, is_member) VALUES ('Member Mona', 'mona@x.invalid', 1)");
    run("INSERT INTO players (name, email, is_member) VALUES ('Plain Pat', 'pat@x.invalid', 0)");
    run("INSERT INTO players (name, email, is_member) VALUES ('Anna Lindqvist', 'anna@x.invalid', 1)");
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (2, ?)', [hash]);
  });
  const a = client(app), m = client(app), p = client(app);
  await a.login('', ADMIN_PW);
  await m.login('mona@x.invalid', 'pw123');
  await p.login('pat@x.invalid', 'pw123');

  console.log('THE COURT THE CARD OFFERS');
  ok('a non-member is never offered one', await p.getStatus('/api/bookings/suggest-slot') === '403');
  let slot = await m.get('/api/bookings/suggest-slot');
  ok('with no history, the lowest free court wins', slot && slot.courtName === 'Court 1' && slot.mode === 'open', JSON.stringify(slot));
  ok('and it is today or tomorrow', [iso(0), iso(1)].includes(slot.date), slot.date);

  // Fill court 1 for both days; the offer should walk up, not sideways in time.
  const fill = async (courtId, date) => {
    for (let h = 6; h < 23; h++) {
      await a.send('POST', '/api/bookings', { courtId, date, startTime: `${String(h).padStart(2, '0')}:00`, durationMinutes: 60, name: 'Club' });
    }
  };
  await fill(1, iso(0));
  await fill(1, iso(1));
  slot = await m.get('/api/bookings/suggest-slot');
  ok('a full court 1 passes the offer to court 2, not to a later hour', slot.courtName === 'Court 2', JSON.stringify(slot));

  // Three past bookings on the same court, weekday and hour is a rhythm.
  for (const n of [-7, -14, -21]) {
    const r = await a.send('POST', '/api/bookings', { courtId: 3, date: iso(n), startTime: '19:00', durationMinutes: 45, name: 'Mona', playerIds: [1] });
    ok(`a past booking ${n} days ago is recorded`, r.status === 200, r.text.slice(0, 120));
  }
  slot = await m.get('/api/bookings/suggest-slot');
  ok('a usual court, weekday and hour is offered back', slot.mode === 'usual' && slot.courtName === 'Court 3' && slot.startTime === '19:00', JSON.stringify(slot));
  ok('on the next occurrence of that weekday', new Date(`${slot.date}T00:00:00Z`).getUTCDay() === new Date(`${iso(-7)}T00:00:00Z`).getUTCDay(), slot.date);
  ok('for the length they usually book', slot.durationMinutes === 45, String(slot.durationMinutes));
  ok("the other member's history is not theirs", (await a.send('POST', '/api/players/membership', { ids: [3], is_member: true })).status === 200);

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
