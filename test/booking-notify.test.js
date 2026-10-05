// Booking a court with other players can email them: "Liam booked a court
// with you, ...". Only when the booker asks, only to players with an email,
// never to the booker, and a failed send never fails the booking.
// Run: node --test test/booking-notify.test.js
process.env.RESEND_API_KEY = 'test-key';
delete process.env.EMAIL_REDIRECT_TO;

const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

// Every email the app tries to send, by the batch endpoint or one at a time.
const sent = [];
let failNext = false;
global.fetch = async (url, opts) => {
  if (failNext) { failNext = false; throw new Error('network down'); }
  const body = JSON.parse(opts.body);
  for (const m of Array.isArray(body) ? body : [body]) sent.push(m);
  return { ok: true, json: async () => ({}) };
};

suite('booking a court can email the players added to it', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'booking-notify'), ({ run }) => {
    run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 2', 1]);
    const hash = bcrypt.hashSync('pw123', 4);
    for (const [name, email] of [['Liam Gallagher', 'liam@x.invalid'], ['Priya Nair', 'priya@x.invalid'], ['Marcus Chen', 'marcus@x.invalid'], ['Sophie Tremblay', null]]) {
      run('INSERT INTO players (name, email, is_member) VALUES (?, ?, 1)', [name, email]);
    }
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
  });
  const liam = client(app);
  ok('Liam signs in', await liam.login('liam@x.invalid', 'pw123') === '302');

  const book = async (startTime, body) => {
    const rsv = (await liam.send('POST', '/api/reservations', { courtId: 1, date: '2031-10-11', startTime, durationMinutes: 60 })).body;
    return (await liam.send('POST', '/api/player-bookings', { reservationId: rsv.reservationId, durationMinutes: 60, ...body })).body;
  };

  console.log('THE PLAYER LIST SAYS WHO CAN BE EMAILED');
  const list = await liam.get('/api/players');
  ok('a member sees has_email, not the address', list.find((p) => p.name === 'Priya Nair').has_email === true && !('email' in list[1]), JSON.stringify(list[1]));
  ok('and false for a player with none', list.find((p) => p.name === 'Sophie Tremblay').has_email === false);

  console.log('\nNOT ASKED, NOTHING SENT');
  let r = await book('10:00', { playerIds: [2, 3] });
  ok('the booking is made', Number.isInteger(r.id));
  ok('no one is emailed, and it says so', sent.length === 0 && r.notifiedCount === 0, JSON.stringify(r.notifiedCount));

  console.log('\nASKED');
  r = await book('12:00', { playerIds: [2, 3, 4], notifyPlayers: true });
  ok('two emails: Sophie has no address and Liam is the booker', sent.length === 2 && r.notifiedCount === 2, `${sent.length} ${r.notifiedCount}`);
  const toPriya = sent.find((m) => m.to[0] === 'priya@x.invalid');
  ok('the subject names the booker', toPriya.subject === 'Liam Gallagher booked a court with you', toPriya.subject);
  ok('the body greets by first name', /^Hi Priya,/.test(toPriya.text));
  ok('and names everyone else in the booking', toPriya.text.includes('Liam Gallagher booked a court with you, Marcus Chen and Sophie Tremblay.'), toPriya.text);
  ok('with the court, the day and the time', toPriya.text.includes('Court 2\nSaturday, October 11\n12:00 PM to 1:00 PM'), toPriya.text);
  ok('and a way back to the app', /See your bookings on Play WSRC: http/.test(toPriya.text));
  ok('Marcus is told about Priya, not himself', sent.find((m) => m.to[0] === 'marcus@x.invalid').text.includes('with you, Priya Nair and Sophie Tremblay.'));
  ok('no em dash anywhere', !sent.some((m) => /—/.test(m.subject + m.text + m.html)));

  console.log('\nONE OTHER PLAYER');
  sent.length = 0;
  await book('14:00', { playerIds: [2], notifyPlayers: true });
  ok('with no one else it is just "with you"', sent.length === 1 && sent[0].text.includes('Liam Gallagher booked a court with you.'), sent[0]?.text);

  console.log('\nA FAILED SEND');
  sent.length = 0;
  failNext = true;
  r = await book('16:00', { playerIds: [2], notifyPlayers: true });
  ok('the booking still stands', Number.isInteger(r.id), JSON.stringify(r));
  ok('and no one is counted as notified', r.notifiedCount === 0);
});
