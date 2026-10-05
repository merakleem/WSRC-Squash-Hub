// The emails members choose in Settings: a new league, tournament or event,
// and a score someone else reported for their match. Each reaches only those
// who turned it on and have an address, and never fails what triggered it.
// Run: node --test test/notify-emails.test.js
process.env.RESEND_API_KEY = 'test-key';
delete process.env.EMAIL_REDIRECT_TO;

const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const ADMIN_PW = process.env.SITE_PASSWORD;

const sent = [];
const everything = [];
let failNext = false;
global.fetch = async (url, opts) => {
  if (failNext) { failNext = false; throw new Error('network down'); }
  const body = JSON.parse(opts.body);
  for (const m of Array.isArray(body) ? body : [body]) { sent.push(m); everything.push(m); }
  return { ok: true, json: async () => ({}) };
};
const toOf = (m) => [].concat(m.to)[0];

suite('notification emails', async ({ ok, t }) => {
  let db;
  const app = boot(scratchDb(t, 'notify-emails'), (dbm) => {
    db = dbm.getDB();
    const hash = bcrypt.hashSync('pw123', 4);
    // Priya wants everything; Marcus wants nothing; Sophie wants everything
    // but has no address; Liam is a non-member who wants events.
    dbm.run(`INSERT INTO players (name, email, is_member, notify_league_new, notify_tournament_new, notify_event_new, notify_score_reported)
      VALUES ('Priya Nair', 'priya@x.invalid', 1, 1, 1, 1, 1)`);
    dbm.run("INSERT INTO players (name, email, is_member) VALUES ('Marcus Chen', 'marcus@x.invalid', 1)");
    dbm.run(`INSERT INTO players (name, email, is_member, notify_league_new, notify_tournament_new, notify_event_new, notify_score_reported)
      VALUES ('Sophie Tremblay', NULL, 1, 1, 1, 1, 1)`);
    dbm.run(`INSERT INTO players (name, email, is_member, notify_event_new, notify_score_reported)
      VALUES ('Liam Gallagher', 'liam@x.invalid', 0, 1, 1)`);
    for (const id of [1, 2, 4]) dbm.run('INSERT INTO user_accounts (player_id, password_hash) VALUES (?, ?)', [id, hash]);
  });
  const admin = client(app);
  await admin.login('', ADMIN_PW);

  console.log('A NEW LEAGUE');
  let r = await admin.send('POST', '/api/leagues/upcoming', { name: 'Winter Singles League', startDate: '2031-11-04', signupDeadline: '2031-10-25' });
  ok('the league is announced', r.status === 200 && Number.isInteger(r.body.id), JSON.stringify(r.body));
  ok('only Priya is told', sent.length === 1 && toOf(sent[0]) === 'priya@x.invalid', JSON.stringify(sent.map(toOf)));
  ok('subject', sent[0].subject === 'New league: Winter Singles League');
  ok('body', sent[0].text.includes('A new league has been announced: Winter Singles League. It starts Tuesday, November 4. Sign up by October 25.'), sent[0].text);
  ok('greets by first name and says why it came', /^Hi Priya,/.test(sent[0].text)
    && sent[0].text.includes('You get this email because "A new league is announced" is on in your Settings. You can turn it off there at any time.'));

  console.log('\nA NEW TOURNAMENT');
  sent.length = 0;
  r = await admin.send('POST', '/api/tournaments/upcoming', { name: 'Fall Knockout', drawCap: 16, firstRoundDate: '2031-11-15' });
  ok('announced', r.status === 200, JSON.stringify(r.body));
  ok('Priya hears, with no deadline sentence when there is none', sent.length === 1
    && sent[0].subject === 'New tournament: Fall Knockout'
    && sent[0].text.includes('A new tournament has been announced: Fall Knockout, a singles knockout for up to 16 players. It starts Saturday, November 15.\n'), sent[0]?.text);

  console.log('\nA NEW EVENT');
  sent.length = 0;
  await admin.send('POST', '/api/events', { name: 'Club Social Night', event_date: '2031-10-24', start_time: '19:00', end_time: '22:00' });
  ok('everyone who asked, member or not', JSON.stringify(sent.map(toOf).sort()) === JSON.stringify(['liam@x.invalid', 'priya@x.invalid']), JSON.stringify(sent.map(toOf)));
  ok('with the day and time', sent[0].subject === 'New event: Club Social Night' && sent[0].text.includes('A new event has been posted: Club Social Night, Friday, October 24 at 7:00 PM.'), sent[0].text);
  sent.length = 0;
  await admin.send('POST', '/api/events', { name: 'Members Mixer', event_date: '2031-10-25', members_only: true });
  ok('a members-only event only reaches members', sent.length === 1 && toOf(sent[0]) === 'priya@x.invalid', JSON.stringify(sent.map(toOf)));
  ok('and with no time it gives just the day', sent[0].text.includes('Members Mixer, Saturday, October 25.'), sent[0].text);

  console.log('\nA REPORTED SCORE');
  const marcus = client(app);
  await marcus.login('marcus@x.invalid', 'pw123');
  sent.length = 0;
  r = await marcus.send('POST', '/api/matches/pickup', { player1Id: 2, player2Id: 1, player1Score: 1, player2Score: 3 });
  ok('Marcus reports a ladder match against Priya', r.status === 200, JSON.stringify(r.body));
  ok('Priya is told', sent.length === 1 && toOf(sent[0]) === 'priya@x.invalid' && sent[0].subject === 'Score reported: you v Marcus Chen', JSON.stringify(sent[0]));
  ok('from her side, with the way to correct it', sent[0].text.includes('Marcus Chen reported the score of your match: you won 3-1.\n\nIf the result is wrong, please email an admin and it will be corrected.'), sent[0].text);

  const priya = client(app);
  await priya.login('priya@x.invalid', 'pw123');
  sent.length = 0;
  await priya.send('POST', '/api/matches/pickup', { player1Id: 1, player2Id: 2, player1Score: 3, player2Score: 2 });
  ok('Marcus, who did not ask, is not told', sent.length === 0);

  sent.length = 0;
  await admin.send('POST', '/api/matches/pickup', { player1Id: 2, player2Id: 1, player1Score: 3, player2Score: 0 });
  ok('an admin entering a score is not a report', sent.length === 0);

  sent.length = 0;
  r = await marcus.send('POST', '/api/matches/doubles', { team1: [2, 3], team2: [1, 4], team1Score: 3, team2Score: 2 });
  ok('a doubles report', r.status === 200, JSON.stringify(r.body));
  ok('reaches the other pair, naming the reporting pair', JSON.stringify(sent.map(toOf).sort()) === JSON.stringify(['liam@x.invalid', 'priya@x.invalid'])
    && sent[0].subject === 'Score reported: you v Marcus Chen and Sophie Tremblay' && sent[0].text.includes('you lost 2-3.'), JSON.stringify(sent.map((m) => [toOf(m), m.subject])));

  console.log('\nA FAILED SEND');
  sent.length = 0;
  failNext = true;
  r = await admin.send('POST', '/api/leagues/upcoming', { name: 'Spring League', startDate: '2032-03-01' });
  ok('the announcement still stands', r.status === 200 && Number.isInteger(r.body.id), JSON.stringify(r.body));
  ok('no em dash in any of it', everything.length > 5 && !everything.some((m) => /—/.test(m.subject + m.text + m.html)));

  const all = db.prepare('SELECT COUNT(*) AS n FROM leagues').get().n;
  ok('both leagues exist', all === 2);
});
