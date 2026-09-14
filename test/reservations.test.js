// A member's five-minute hold on a court slot is a row, not a variable: it
// survives a restart, it is refused to a second member, it expires, and
// booking consumes it.
// Run: node --test test/reservations.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

suite('court holds', async ({ ok, t }) => {
  const file = scratchDb(t, 'reservations');
  const seed = ({ run }) => {
    run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 1', 1]);
    run("INSERT INTO players (name, email, is_member) VALUES ('Member Mona', 'mona@x.invalid', 1)");
    run("INSERT INTO players (name, email, is_member) VALUES ('Member Max', 'max@x.invalid', 1)");
    const hash = bcrypt.hashSync('pw123', 4);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (2, ?)', [hash]);
  };
  let app = boot(file, seed);
  const dbm = require('../database/db');
  const rsvLib = require('../lib/reservations');
  let mona = client(app), max = client(app);
  await mona.login('mona@x.invalid', 'pw123');
  await max.login('max@x.invalid', 'pw123');
  const slot = { courtId: 1, date: '2031-03-01', startTime: '18:00', durationMinutes: 60 };

  console.log('TAKING A HOLD');
  const held = await mona.send('POST', '/api/reservations', slot);
  ok('a member holds a slot', held.status === 200 && /^\d+$/.test(held.body.reservationId), JSON.stringify(held.body));
  ok('for about five minutes', held.body.expiresAt > Date.now() + 4 * 60 * 1000 && held.body.expiresAt <= Date.now() + 5 * 60 * 1000);
  ok('and it is a row in the database', dbm.getDB().prepare('SELECT COUNT(*) AS n FROM reservations').get().n === 1);
  const overlapping = await max.send('POST', '/api/reservations', { ...slot, startTime: '18:30' });
  ok('an overlapping hold by someone else is refused', overlapping.status === 409 && /reserved by another/.test(overlapping.body.error), JSON.stringify(overlapping.body));
  ok('a hold on another slot is fine', (await max.send('POST', '/api/reservations', { ...slot, startTime: '19:00' })).status === 200);
  const sched = await max.get('/api/schedule?date=2031-03-01');
  const holds = sched.slots.filter((s) => s.source === 'reservation');
  ok('the schedule shows both holds as Reserved, with no names', holds.length === 2 && holds.every((s) => s.title === 'Reserved' && s.players.length === 0 && /^rsv_\d+$/.test(s.id)), JSON.stringify(holds));
  ok('Max cannot cancel Mona\'s hold', await max.status('DELETE', `/api/reservations/${held.body.reservationId}`) === '403');
  ok('nor book against it', (await max.send('POST', '/api/player-bookings', { reservationId: held.body.reservationId, durationMinutes: 60 })).status === 403);

  console.log('A RESTART CHANGES NOTHING');
  // The old store was a Map in the process. Reopen the database as a fresh
  // process would and the hold is still there.
  app = boot(file);
  mona = client(app); max = client(app);
  await mona.login('mona@x.invalid', 'pw123');
  await max.login('max@x.invalid', 'pw123');
  ok('the hold is still on the schedule', (await max.get('/api/schedule?date=2031-03-01')).slots.filter((s) => s.source === 'reservation').length === 2);
  ok('and still blocks the other member', (await max.send('POST', '/api/reservations', slot)).status === 409);

  console.log('BOOKING CONSUMES IT');
  const booked = await mona.send('POST', '/api/player-bookings', { reservationId: held.body.reservationId, durationMinutes: 60, playerIds: [2] });
  ok('Mona books on her hold', booked.status === 200 && Number.isInteger(booked.body.id), JSON.stringify(booked.body));
  ok('the hold is gone', !rsvLib.getReservation(held.body.reservationId));
  ok('and only the booking is on the schedule for that slot', (await max.get('/api/schedule?date=2031-03-01')).slots.filter((s) => s.startTime === '18:00').length === 1);
  ok('booking on a used hold is refused', (await mona.send('POST', '/api/player-bookings', { reservationId: held.body.reservationId, durationMinutes: 60 })).status === 400);
  ok('and a hold cannot be taken on a booked slot', (await max.send('POST', '/api/reservations', slot)).status === 409 && /already booked/.test((await max.send('POST', '/api/reservations', slot)).body.error));

  console.log('EXPIRY');
  const late = rsvLib.createReservation({ courtId: 1, date: '2031-03-02', startTime: '10:00', durationMinutes: 30, playerId: 2 }).reservation;
  dbm.getDB().prepare('UPDATE reservations SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, late.id);
  ok('an expired hold is invisible on the schedule', !(await max.get('/api/schedule?date=2031-03-02')).slots.some((s) => s.source === 'reservation'));
  ok('cannot be booked on', (await max.send('POST', '/api/player-bookings', { reservationId: late.id, durationMinutes: 30 })).status === 410);
  ok('is swept', rsvLib.purgeExpired() >= 0 && !rsvLib.getReservation(late.id));
  ok('and does not block anyone', (await mona.send('POST', '/api/reservations', { courtId: 1, date: '2031-03-02', startTime: '10:00', durationMinutes: 30 })).status === 200);
  ok('the owner can let a hold go', await mona.status('DELETE', `/api/reservations/${(await mona.send('POST', '/api/reservations', { courtId: 1, date: '2031-03-03', startTime: '10:00', durationMinutes: 30 })).body.reservationId}`) === '200');
});
