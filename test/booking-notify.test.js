// Booking a court with other players emails them: "Liam booked a court with
// you, ...". Only to players with an email who have not turned it off in
// their Settings, never to the booker, and a failed send never fails the
// booking.
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

suite('booking a court emails the players added to it', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'booking-notify'), ({ run }) => {
    run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 2', 1]);
    const hash = bcrypt.hashSync('pw123', 4);
    for (const [name, email] of [['Liam Gallagher', 'liam@x.invalid'], ['Priya Nair', 'priya@x.invalid'], ['Marcus Chen', 'marcus@x.invalid'], ['Sophie Tremblay', null]]) {
      run('INSERT INTO players (name, email, is_member) VALUES (?, ?, 1)', [name, email]);
    }
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (3, ?)', [hash]);
  });
  const liam = client(app);
  ok('Liam signs in', await liam.login('liam@x.invalid', 'pw123') === '302');

  const book = async (startTime, body) => {
    const rsv = (await liam.send('POST', '/api/reservations', { courtId: 1, date: '2031-10-11', startTime, durationMinutes: 60 })).body;
    return (await liam.send('POST', '/api/player-bookings', { reservationId: rsv.reservationId, durationMinutes: 60, ...body })).body;
  };

  console.log('ON BY DEFAULT');
  let r = await book('12:00', { playerIds: [2, 3, 4] });
  ok('the booking is made', Number.isInteger(r.id));
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
  await book('14:00', { playerIds: [2] });
  ok('with no one else it is just "with you"', sent.length === 1 && sent[0].text.includes('Liam Gallagher booked a court with you.'), sent[0]?.text);

  console.log('\nA PLAYER WHO TURNED IT OFF');
  const marcus = client(app);
  await marcus.login('marcus@x.invalid', 'pw123');
  const off = await marcus.send('PUT', '/api/me/notifications', { key: 'notify_booking_added', value: false });
  ok('Marcus turns it off in his Settings', off.status === 200, JSON.stringify(off.body));
  sent.length = 0;
  r = await book('15:00', { playerIds: [2, 3] });
  ok('he is not emailed', sent.length === 1 && sent[0].to[0] === 'priya@x.invalid' && r.notifiedCount === 1, JSON.stringify(sent.map((m) => m.to)));
  ok('but is still named to the others', sent[0]?.text.includes('with you and Marcus Chen.'), sent[0]?.text);

  console.log('\nA FAILED SEND');
  sent.length = 0;
  failNext = true;
  r = await book('16:00', { playerIds: [2] });
  ok('the booking still stands', Number.isInteger(r.id), JSON.stringify(r));
  ok('and no one is counted as notified', r.notifiedCount === 0);
});
