// Court booking is members-only, and membership is private. This mounts the
// real app against a scratch DB and checks both halves: the requireMember
// boundary on the booking routes, and that no non-admin response ever carries
// is_member (or is_tester, or contact details).
// Run: node --test test/membership.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const ADMIN_PW = process.env.SITE_PASSWORD;

suite('membership gates court booking and stays private', async ({ ok, t }) => {
  // --- scratch club: one member, one plain player, a court ---
  const app = boot(scratchDb(t, 'membership'), ({ run }) => {
    run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 1', 1]);
    run('INSERT INTO players (name, email, phone, member_number, is_member) VALUES (?, ?, ?, ?, 1)',
      ['Member Mona', 'mona@x.invalid', '204-555-0001', 'M-100']);
    run('INSERT INTO players (name, email, phone, member_number, is_member) VALUES (?, ?, ?, ?, 0)',
      ['Plain Pat', 'pat@x.invalid', '204-555-0002', 'P-200']);
    const hash = bcrypt.hashSync('pw123', 4);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (2, ?)', [hash]);
  });
  const a = client(app), m = client(app), p = client(app);

  console.log('WHO AM I');
  ok('admin signs in', await a.login('', ADMIN_PW) === '302');
  ok('member signs in', await m.login('mona@x.invalid', 'pw123') === '302');
  ok('plain player signs in', await p.login('pat@x.invalid', 'pw123') === '302');
  ok('the member reads is_member on /api/me', (await m.me()).is_member === 1);
  ok('the plain player reads 0', (await p.me()).is_member === 0);

  console.log('THE BOOKING BOUNDARY');
  const resBody = { courtId: 1, date: '2030-01-01', startTime: '10:00', durationMinutes: 30 };
  ok('a non-member cannot hold a slot', await p.status('POST', '/api/reservations', resBody) === '403');
  ok('with the members-only message', (await p.send('POST', '/api/reservations', resBody)).body.error === 'Court booking is available to club members.');
  ok('nor read their bookings list', await p.getStatus('/api/my-bookings') === '403');
  ok('nor create a booking directly', await p.status('POST', '/api/player-bookings', { courtId: 1, date: '2030-01-01', startTime: '10:00', durationMinutes: 30 }) === '403');
  const held = await m.send('POST', '/api/reservations', resBody);
  ok('a member holds a slot fine', held.text.includes('reservationId'), (await m.send('POST', '/api/reservations', { ...resBody, startTime: '11:00' })).text);
  ok('and reads their bookings', await m.getStatus('/api/my-bookings') === '200');
  ok('an admin passes without a member flag', await a.getStatus('/api/my-bookings') === '200');

  console.log('MEMBERSHIP IS PRIVATE');
  const adminList = await a.get('/api/players');
  ok('the admin list carries the flag', adminList.every((x) => 'is_member' in x));
  const playerList = await p.get('/api/players');
  ok('a player list never does', playerList.every((x) => !('is_member' in x)), JSON.stringify(Object.keys(playerList[0] || {})));
  ok('nor the tester flag', playerList.every((x) => !('is_tester' in x)));
  ok('nor emails, phones or member numbers', playerList.every((x) => !('email' in x) && !('phone' in x) && !('member_number' in x)));
  const rawAll = await p.text('/api/players');
  ok('the word is_member appears nowhere in the payload', !rawAll.includes('is_member'));
  ok('a player cannot flip membership', await p.status('POST', '/api/players/membership', { ids: [2], is_member: true }) === '403');
  ok('and is still not a member after trying', (await p.me()).is_member === 0);

  console.log('ADMIN CONTROLS');
  const bulk = (await a.send('POST', '/api/players/membership', { ids: [2], is_member: true })).body;
  ok('bulk grant reports its count', bulk.changed === 1, JSON.stringify(bulk));
  ok('the player is now a member on their next load', (await p.me()).is_member === 1);
  ok('and can book', await p.status('POST', '/api/reservations', { ...resBody, startTime: '12:00' }) === '200');
  await a.send('POST', '/api/players/membership', { ids: [2], is_member: false });
  ok('revoking takes effect immediately', await p.status('POST', '/api/reservations', { ...resBody, startTime: '13:00' }) === '403');

  console.log('EDITS NEVER WIPE FLAGS SILENTLY');
  // the bulk-edit modal sends no flags at all — membership must survive
  const r1 = (await a.send('PUT', '/api/players/1', { name: 'Member Mona', email: 'mona@x.invalid', phone: '204-555-0001', club_locker_rating: null, exclude_from_ladder: false })).body;
  ok('an edit without flags keeps membership', r1.is_member === 1, JSON.stringify({ is_member: r1.is_member }));
  const r2 = (await a.send('PUT', '/api/players/1', { name: 'Member Mona', email: 'mona@x.invalid', phone: '204-555-0001', club_locker_rating: null, exclude_from_ladder: false, is_member: false, is_tester: false })).body;
  ok('an edit that sends the flag updates it', r2.is_member === 0);
  await a.send('PUT', '/api/players/1', { name: 'Member Mona', email: 'mona@x.invalid', phone: '204-555-0001', club_locker_rating: null, exclude_from_ladder: false, is_member: true, is_tester: false });

  console.log('VIEWING AS RESPECTS THE GATE');
  await a.send('POST', '/api/players/2/view-as');
  ok('viewing a non-member, /api/me says not a member', (await a.me()).is_member === 0);
  await a.send('POST', '/api/return-to-admin');
  await a.send('POST', '/api/players/1/view-as');
  ok('viewing a member, it says member', (await a.me()).is_member === 1);
  await a.send('POST', '/api/return-to-admin');
});
