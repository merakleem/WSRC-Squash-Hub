// Only the person who booked a court may change or cancel it. Being on the
// booking is not enough: a friend added to it, or a player the club put into
// a lesson, sees it in My Bookings but cannot touch it. And every booking is
// called the same thing for everyone: its type if it has one, else its booker.
// Run: node --test test/booking-owner.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

suite('a booking belongs to whoever made it', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'booking-owner'), ({ run }) => {
    run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 1', 1]);
    run("INSERT INTO players (name, email, is_member) VALUES ('Member Mona', 'mona@x.invalid', 1)");
    run("INSERT INTO players (name, email, is_member) VALUES ('Partner Pat', 'pat@x.invalid', 1)");
    const hash = bcrypt.hashSync('pw123', 4);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (2, ?)', [hash]);
    run("INSERT INTO booking_types (name, color) VALUES ('Private Lesson', '#8a6d1f')");

    // Bookings from before the booker was recorded. The player page wrote the
    // booker's name as the booking's name; the admin's form wrote a free label.
    // The migration that sorts these out has already run by now, so they are
    // inserted the way it left them: a booker on the one named for a player.
    run("INSERT INTO bookings (court_id, date, start_time, duration_minutes, name, info) VALUES (1, '2031-01-01', '10:00', 60, 'Member Mona', 'Member Mona, Partner Pat')");
    run('INSERT INTO booking_players (booking_id, player_id) VALUES (1, 1), (1, 2)');
    run("INSERT INTO bookings (court_id, date, start_time, duration_minutes, name) VALUES (1, '2031-01-01', '12:00', 60, 'Junior training')");
    run('INSERT INTO booking_players (booking_id, player_id) VALUES (2, 1)');
  });
  const a = client(app), m = client(app), p = client(app);

  ok('everyone signs in', await a.login('', 'pw') === '302' && await m.login('mona@x.invalid', 'pw123') === '302' && await p.login('pat@x.invalid', 'pw123') === '302');

  console.log('\nA PLAYER BOOKING BELONGS TO ITS BOOKER');
  const rsv = (await m.send('POST', '/api/reservations', { courtId: 1, date: '2031-01-02', startTime: '10:00', durationMinutes: 60 })).body;
  const booked = (await m.send('POST', '/api/player-bookings', { reservationId: rsv.reservationId, durationMinutes: 60, playerIds: [2] })).body;
  ok('Mona books a court with Pat', Number.isInteger(booked?.id), JSON.stringify(booked));
  ok('and is recorded as its booker', booked?.booked_by === 1, String(booked?.booked_by));

  const slot = (await p.get('/api/schedule?date=2031-01-02')).slots.find((s) => s.id === booked.id);
  ok('on the schedule it is titled by Mona, for Pat as for anyone', slot?.title === 'Member Mona', slot?.title);
  ok('and says who booked it', slot?.bookedBy === 1 && slot.players.length === 2, JSON.stringify(slot));

  const patRow = (await p.get('/api/my-bookings')).find((b) => b.id === booked.id);
  ok('Pat sees it in My Bookings', !!patRow && patRow.title === 'Member Mona' && patRow.bookedBy === 1, JSON.stringify(patRow));
  ok('but cannot change it', await p.status('PUT', `/api/player-bookings/${booked.id}`, { durationMinutes: 30 }) === '403');
  ok('with a reason that names the rule', /person who booked/.test((await p.send('PUT', `/api/player-bookings/${booked.id}`, { durationMinutes: 30 })).body?.error || ''));
  ok('nor cancel it', await p.status('DELETE', `/api/player-bookings/${booked.id}`) === '403');
  ok('it is still there', (await m.get('/api/schedule?date=2031-01-02')).slots.some((s) => s.id === booked.id && s.durationMinutes === 60));
  ok('Mona can change it', await m.status('PUT', `/api/player-bookings/${booked.id}`, { durationMinutes: 30 }) === '200');
  ok('and cancel it', await m.status('DELETE', `/api/player-bookings/${booked.id}`) === '200');

  console.log('\nA CLUB BOOKING BELONGS TO THE CLUB');
  const lesson = (await a.send('POST', '/api/bookings', { courtId: 1, date: '2031-01-03', startTime: '10:00', durationMinutes: 60, bookingTypeId: 1, playerIds: [1] })).body;
  ok('the admin books Mona a private lesson', Number.isInteger(lesson?.id), JSON.stringify(lesson));
  ok('it has no booker', lesson?.booked_by == null);
  const monaLesson = (await m.get('/api/my-bookings')).find((b) => b.id === lesson.id);
  ok('Mona sees it in My Bookings, titled by its type', monaLesson?.title === 'Private Lesson' && monaLesson.typeName === 'Private Lesson' && monaLesson.bookedBy === null, JSON.stringify(monaLesson));
  const lessonSlot = (await p.get('/api/schedule?date=2031-01-03')).slots.find((s) => s.id === lesson.id);
  ok('and so does the schedule', lessonSlot?.title === 'Private Lesson' && lessonSlot.bookedBy === null, JSON.stringify(lessonSlot));
  ok('Mona cannot change the lesson', await m.status('PUT', `/api/player-bookings/${lesson.id}`, { durationMinutes: 30 }) === '403');
  ok('and is told it is the club\'s', /made by the club/.test((await m.send('PUT', `/api/player-bookings/${lesson.id}`, { durationMinutes: 30 })).body?.error || ''));
  ok('nor cancel it', await m.status('DELETE', `/api/player-bookings/${lesson.id}`) === '403');

  console.log('\nOLDER BOOKINGS ARE SORTED OUT BY THE MIGRATION');
  // The rows above were inserted after the migration ran, so run its statement
  // the way the migration does, then check the result reads the same way.
  const { runMigrations, MIGRATIONS } = require('../database/migrations');
  const db = require('../database/db').getDB();
  db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(20);
  ok('the booker backfill migration re-applies cleanly', runMigrations(db).join() === '20');
  const old = (await m.get('/api/schedule?date=2031-01-01')).slots;
  const oldMona = old.find((s) => s.id === 1), oldClub = old.find((s) => s.id === 2);
  ok('a booking named for a player on it is that player\'s', oldMona?.bookedBy === 1 && oldMona.title === 'Member Mona', JSON.stringify(oldMona));
  ok('an old admin label stays as the title, with no booker', oldClub?.bookedBy === null && oldClub.title === 'Junior training', JSON.stringify(oldClub));
  ok('so Mona can still change her old booking', await m.status('PUT', '/api/player-bookings/1', { durationMinutes: 30 }) === '200');
  ok('but not the club\'s', await m.status('PUT', '/api/player-bookings/2', { durationMinutes: 30 }) === '403');
  ok('and Pat, on Mona\'s old booking, cannot either', await p.status('PUT', '/api/player-bookings/1', { durationMinutes: 60 }) === '403');
  ok('and the migration is the one that names bookers', MIGRATIONS.find((m2) => m2.id === 20).name === 'record the booker of older player bookings');
});
