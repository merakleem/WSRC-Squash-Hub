// Court booking is members-only, and membership is private. This spawns the
// real server against a scratch DB and checks both halves: the requireMember
// boundary on the booking routes, and that no non-admin response ever carries
// is_member (or is_tester, or contact details).
// Run: node test/membership.test.js
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const PORT = 8123;
const BASE = `http://localhost:${PORT}`;
const DB = '/tmp/membership-test.db';
const ADMIN_PW = 'testpw';

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const jar = (n) => `/tmp/mem-${n}.txt`;

const login = (n, email, pw) => {
  sh(`rm -f ${jar(n)}`);
  return sh(`curl -s -o /dev/null -w '%{http_code}' -c ${jar(n)} -X POST ${BASE}/login -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'email=${email}' --data-urlencode 'password=${pw}'`);
};
const get = (n, p) => JSON.parse(sh(`curl -s -b ${jar(n)} ${BASE}${p}`));
const me = (n) => get(n, '/api/me');
const send = (n, method, p, body) => {
  const csrf = me(n).csrf || '';
  const data = body ? `-H 'Content-Type: application/json' -d '${JSON.stringify(body)}'` : '';
  return sh(`curl -s -b ${jar(n)} -c ${jar(n)} -X ${method} ${BASE}${p} -H 'X-CSRF-Token: ${csrf}' ${data}`);
};
const sendStatus = (n, method, p, body) => {
  const csrf = me(n).csrf || '';
  const data = body ? `-H 'Content-Type: application/json' -d '${JSON.stringify(body)}'` : '';
  return sh(`curl -s -o /dev/null -w '%{http_code}' -b ${jar(n)} -c ${jar(n)} -X ${method} ${BASE}${p} -H 'X-CSRF-Token: ${csrf}' ${data}`);
};

async function main() {
  // --- scratch club: one member, one plain player, a court ---
  try { fs.unlinkSync(DB); } catch (_) {}
  const dbm = require('../database/db');
  dbm.initDB(DB);
  const { run } = dbm;
  run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 1', 1]);
  run('INSERT INTO players (name, email, phone, member_number, is_member) VALUES (?, ?, ?, ?, 1)',
    ['Member Mona', 'mona@x.invalid', '204-555-0001', 'M-100']);
  run('INSERT INTO players (name, email, phone, member_number, is_member) VALUES (?, ?, ?, ?, 0)',
    ['Plain Pat', 'pat@x.invalid', '204-555-0002', 'P-200']);
  const hash = bcrypt.hashSync('pw123', 4);
  run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
  run('INSERT INTO user_accounts (player_id, password_hash) VALUES (2, ?)', [hash]);

  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SESSION_SECRET: 'membership-test-secret', SITE_PASSWORD: ADMIN_PW, RESEND_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 8000);
    server.stdout.on('data', (d) => { if (String(d).match(/listening|started|running|port/i)) { clearTimeout(t); resolve(); } });
    setTimeout(resolve, 2500); // fallback: assume up
  });

  try {
    console.log('WHO AM I');
    ok('admin signs in', login('a', '', ADMIN_PW) === '302');
    ok('member signs in', login('m', 'mona@x.invalid', 'pw123') === '302');
    ok('plain player signs in', login('p', 'pat@x.invalid', 'pw123') === '302');
    ok('the member reads is_member on /api/me', me('m').is_member === 1);
    ok('the plain player reads 0', me('p').is_member === 0);

    console.log('THE BOOKING BOUNDARY');
    const resBody = { courtId: 1, date: '2030-01-01', startTime: '10:00', durationMinutes: 30 };
    ok('a non-member cannot hold a slot', sendStatus('p', 'POST', '/api/reservations', resBody) === '403');
    ok('with the members-only message', JSON.parse(send('p', 'POST', '/api/reservations', resBody)).error === 'Court booking is available to club members.');
    ok('nor read their bookings list', sh(`curl -s -o /dev/null -w '%{http_code}' -b ${jar('p')} ${BASE}/api/my-bookings`) === '403');
    ok('nor create a booking directly', sendStatus('p', 'POST', '/api/player-bookings', { courtId: 1, date: '2030-01-01', startTime: '10:00', durationMinutes: 30 }) === '403');
    ok('a member holds a slot fine', send('m', 'POST', '/api/reservations', resBody).includes('reservationId'), send('m', 'POST', '/api/reservations', { ...resBody, startTime: '11:00' }));
    ok('and reads their bookings', sh(`curl -s -o /dev/null -w '%{http_code}' -b ${jar('m')} ${BASE}/api/my-bookings`) === '200');
    ok('an admin passes without a member flag', sh(`curl -s -o /dev/null -w '%{http_code}' -b ${jar('a')} ${BASE}/api/my-bookings`) === '200');

    console.log('MEMBERSHIP IS PRIVATE');
    const adminList = get('a', '/api/players');
    ok('the admin list carries the flag', adminList.every((p) => 'is_member' in p));
    const playerList = get('p', '/api/players');
    ok('a player list never does', playerList.every((p) => !('is_member' in p)), JSON.stringify(Object.keys(playerList[0] || {})));
    ok('nor the tester flag', playerList.every((p) => !('is_tester' in p)));
    ok('nor emails, phones or member numbers', playerList.every((p) => !('email' in p) && !('phone' in p) && !('member_number' in p)));
    const rawAll = send('p', 'GET', '/api/players');
    ok('the word is_member appears nowhere in the payload', !rawAll.includes('is_member'));
    ok('a player cannot flip membership', sendStatus('p', 'POST', '/api/players/membership', { ids: [2], is_member: true }) === '403');
    ok('and is still not a member after trying', me('p').is_member === 0);

    console.log('ADMIN CONTROLS');
    const bulk = JSON.parse(send('a', 'POST', '/api/players/membership', { ids: [2], is_member: true }));
    ok('bulk grant reports its count', bulk.changed === 1, JSON.stringify(bulk));
    ok('the player is now a member on their next load', me('p').is_member === 1);
    ok('and can book', sendStatus('p', 'POST', '/api/reservations', { ...resBody, startTime: '12:00' }) === '200');
    JSON.parse(send('a', 'POST', '/api/players/membership', { ids: [2], is_member: false }));
    ok('revoking takes effect immediately', sendStatus('p', 'POST', '/api/reservations', { ...resBody, startTime: '13:00' }) === '403');

    console.log('EDITS NEVER WIPE FLAGS SILENTLY');
    // the bulk-edit modal sends no flags at all — membership must survive
    const r1 = JSON.parse(send('a', 'PUT', '/api/players/1', { name: 'Member Mona', email: 'mona@x.invalid', phone: '204-555-0001', club_locker_rating: null, exclude_from_ladder: false }));
    ok('an edit without flags keeps membership', r1.is_member === 1, JSON.stringify({ is_member: r1.is_member }));
    const r2 = JSON.parse(send('a', 'PUT', '/api/players/1', { name: 'Member Mona', email: 'mona@x.invalid', phone: '204-555-0001', club_locker_rating: null, exclude_from_ladder: false, is_member: false, is_tester: false }));
    ok('an edit that sends the flag updates it', r2.is_member === 0);
    JSON.parse(send('a', 'PUT', '/api/players/1', { name: 'Member Mona', email: 'mona@x.invalid', phone: '204-555-0001', club_locker_rating: null, exclude_from_ladder: false, is_member: true, is_tester: false }));

    console.log('VIEWING AS RESPECTS THE GATE');
    JSON.parse(send('a', 'POST', '/api/players/2/view-as'));
    ok('viewing a non-member, /api/me says not a member', me('a').is_member === 0);
    JSON.parse(send('a', 'POST', '/api/return-to-admin'));
    JSON.parse(send('a', 'POST', '/api/players/1/view-as'));
    ok('viewing a member, it says member', me('a').is_member === 1);
    JSON.parse(send('a', 'POST', '/api/return-to-admin'));
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch (_) {}
  }

  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
