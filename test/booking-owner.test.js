// Only the person who booked a court may change or cancel it. Being on the
// booking is not enough: a friend added to it, or a player the club put into
// a lesson, sees it in My Bookings but cannot touch it. And every booking is
// called the same thing for everyone: its type if it has one, else its booker.
// Run: node test/booking-owner.test.js
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const PORT = 8141;
const BASE = `http://localhost:${PORT}`;
const DB = '/tmp/booking-owner-test.db';

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const jar = (n) => `/tmp/bo-${n}.txt`;
const login = (n, email, pw) => {
  sh(`rm -f ${jar(n)}`);
  return sh(`curl -s -o /dev/null -w '%{http_code}' -c ${jar(n)} -X POST ${BASE}/login -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'email=${email}' --data-urlencode 'password=${pw}'`);
};
const get = (n, p) => JSON.parse(sh(`curl -s -b ${jar(n)} ${BASE}${p}`));
const me = (n) => get(n, '/api/me');
const send = (n, method, p, body) => {
  const csrf = me(n).csrf || '';
  const data = body ? `-H 'Content-Type: application/json' -d '${JSON.stringify(body)}'` : '';
  return JSON.parse(sh(`curl -s -b ${jar(n)} -c ${jar(n)} -X ${method} ${BASE}${p} -H 'X-CSRF-Token: ${csrf}' ${data}`) || 'null');
};
const sendStatus = (n, method, p, body) => {
  const csrf = me(n).csrf || '';
  const data = body ? `-H 'Content-Type: application/json' -d '${JSON.stringify(body)}'` : '';
  return sh(`curl -s -o /dev/null -w '%{http_code}' -b ${jar(n)} -c ${jar(n)} -X ${method} ${BASE}${p} -H 'X-CSRF-Token: ${csrf}' ${data}`);
};

async function main() {
  try { fs.unlinkSync(DB); } catch (_) {}
  const dbm = require('../database/db');
  dbm.initDB(DB);
  const { run } = dbm;
  run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 1', 1]);
  run("INSERT INTO players (name, email, is_member) VALUES ('Member Mona', 'mona@x.invalid', 1)");
  run("INSERT INTO players (name, email, is_member) VALUES ('Partner Pat', 'pat@x.invalid', 1)");
  const hash = bcrypt.hashSync('pw123', 4);
  run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
  run('INSERT INTO user_accounts (player_id, password_hash) VALUES (2, ?)', [hash]);
  run("INSERT INTO booking_types (name, color) VALUES ('Private Lesson', '#8a6d1f')");

  // Bookings from before the booker was recorded. The player page wrote the
  // booker's name as the booking's name; the admin's form wrote a free label.
  run("INSERT INTO bookings (court_id, date, start_time, duration_minutes, name, info) VALUES (1, '2031-01-01', '10:00', 60, 'Member Mona', 'Member Mona, Partner Pat')");
  run('INSERT INTO booking_players (booking_id, player_id) VALUES (1, 1), (1, 2)');
  run("INSERT INTO bookings (court_id, date, start_time, duration_minutes, name) VALUES (1, '2031-01-01', '12:00', 60, 'Junior training')");
  run('INSERT INTO booking_players (booking_id, player_id) VALUES (2, 1)');

  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SESSION_SECRET: 's', SITE_PASSWORD: 'pw', RESEND_API_KEY: '' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 2500));

  try {
    ok('everyone signs in', login('a', '', 'pw') === '302' && login('m', 'mona@x.invalid', 'pw123') === '302' && login('p', 'pat@x.invalid', 'pw123') === '302');

    console.log('\nA PLAYER BOOKING BELONGS TO ITS BOOKER');
    const rsv = send('m', 'POST', '/api/reservations', { courtId: 1, date: '2031-01-02', startTime: '10:00', durationMinutes: 60 });
    const booked = send('m', 'POST', '/api/player-bookings', { reservationId: rsv.reservationId, durationMinutes: 60, playerIds: [2] });
    ok('Mona books a court with Pat', Number.isInteger(booked?.id), JSON.stringify(booked));
    ok('and is recorded as its booker', booked?.booked_by === 1, String(booked?.booked_by));

    const slot = get('p', '/api/schedule?date=2031-01-02').slots.find((s) => s.id === booked.id);
    ok('on the schedule it is titled by Mona, for Pat as for anyone', slot?.title === 'Member Mona', slot?.title);
    ok('and says who booked it', slot?.bookedBy === 1 && slot.players.length === 2, JSON.stringify(slot));

    const patRow = get('p', '/api/my-bookings').find((b) => b.id === booked.id);
    ok('Pat sees it in My Bookings', !!patRow && patRow.title === 'Member Mona' && patRow.bookedBy === 1, JSON.stringify(patRow));
    ok('but cannot change it', sendStatus('p', 'PUT', `/api/player-bookings/${booked.id}`, { durationMinutes: 30 }) === '403');
    ok('with a reason that names the rule', /person who booked/.test(send('p', 'PUT', `/api/player-bookings/${booked.id}`, { durationMinutes: 30 })?.error || ''));
    ok('nor cancel it', sendStatus('p', 'DELETE', `/api/player-bookings/${booked.id}`) === '403');
    ok('it is still there', get('m', '/api/schedule?date=2031-01-02').slots.some((s) => s.id === booked.id && s.durationMinutes === 60));
    ok('Mona can change it', sendStatus('m', 'PUT', `/api/player-bookings/${booked.id}`, { durationMinutes: 30 }) === '200');
    ok('and cancel it', sendStatus('m', 'DELETE', `/api/player-bookings/${booked.id}`) === '200');

    console.log('\nA CLUB BOOKING BELONGS TO THE CLUB');
    const lesson = send('a', 'POST', '/api/bookings', { courtId: 1, date: '2031-01-03', startTime: '10:00', durationMinutes: 60, bookingTypeId: 1, playerIds: [1] });
    ok('the admin books Mona a private lesson', Number.isInteger(lesson?.id), JSON.stringify(lesson));
    ok('it has no booker', lesson?.booked_by == null);
    const monaLesson = get('m', '/api/my-bookings').find((b) => b.id === lesson.id);
    ok('Mona sees it in My Bookings, titled by its type', monaLesson?.title === 'Private Lesson' && monaLesson.typeName === 'Private Lesson' && monaLesson.bookedBy === null, JSON.stringify(monaLesson));
    const lessonSlot = get('p', '/api/schedule?date=2031-01-03').slots.find((s) => s.id === lesson.id);
    ok('and so does the schedule', lessonSlot?.title === 'Private Lesson' && lessonSlot.bookedBy === null, JSON.stringify(lessonSlot));
    ok('Mona cannot change the lesson', sendStatus('m', 'PUT', `/api/player-bookings/${lesson.id}`, { durationMinutes: 30 }) === '403');
    ok('and is told it is the club\'s', /made by the club/.test(send('m', 'PUT', `/api/player-bookings/${lesson.id}`, { durationMinutes: 30 })?.error || ''));
    ok('nor cancel it', sendStatus('m', 'DELETE', `/api/player-bookings/${lesson.id}`) === '403');

    console.log('\nOLDER BOOKINGS ARE SORTED OUT ON START');
    const old = get('m', '/api/schedule?date=2031-01-01').slots;
    const oldMona = old.find((s) => s.id === 1), oldClub = old.find((s) => s.id === 2);
    ok('a booking named for a player on it is that player\'s', oldMona?.bookedBy === 1 && oldMona.title === 'Member Mona', JSON.stringify(oldMona));
    ok('an old admin label stays as the title, with no booker', oldClub?.bookedBy === null && oldClub.title === 'Junior training', JSON.stringify(oldClub));
    ok('so Mona can still change her old booking', sendStatus('m', 'PUT', '/api/player-bookings/1', { durationMinutes: 30 }) === '200');
    ok('but not the club\'s', sendStatus('m', 'PUT', '/api/player-bookings/2', { durationMinutes: 30 }) === '403');
    ok('and Pat, on Mona\'s old booking, cannot either', sendStatus('p', 'PUT', '/api/player-bookings/1', { durationMinutes: 60 }) === '403');
  } finally {
    server.kill();
  }

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
}

main();
