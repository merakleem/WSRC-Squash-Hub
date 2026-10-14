// A member's own Settings: profile, a sign-in email change that waits for a
// link sent to the new address, a reset link they can send themselves, and
// which emails they want. None of it can be changed through "View as".
// Run: node --test test/player-settings.test.js
process.env.RESEND_API_KEY = 'test-key';
delete process.env.EMAIL_REDIRECT_TO;

const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const ADMIN_PW = process.env.SITE_PASSWORD;

const sent = [];
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  for (const m of Array.isArray(body) ? body : [body]) sent.push(m);
  return { ok: true, json: async () => ({}) };
};

suite('player settings', async ({ ok, t }) => {
  let db;
  const app = boot(scratchDb(t, 'player-settings'), (dbm) => {
    db = dbm.getDB();
    const hash = bcrypt.hashSync('pw123', 4);
    dbm.run("INSERT INTO players (name, email, phone, member_number, is_member) VALUES ('Liam Gallagher', 'liam@x.invalid', '519 555 0101', '1068', 1)");
    dbm.run("INSERT INTO players (name, email) VALUES ('Priya Nair', 'priya@x.invalid')");
    dbm.run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
  });
  const liam = client(app);
  ok('Liam signs in', await liam.login('liam@x.invalid', 'pw123') === '302');
  const linkIn = (m) => (m.text || m.html).match(/https?:\/\/[^\s"<]+/)[0];
  const pathOf = (url) => new URL(url).pathname;
  const toOf = (m) => [].concat(m.to)[0];

  console.log('READING');
  const s = await liam.get('/api/me/settings');
  ok('his own details', s.name === 'Liam Gallagher' && s.email === 'liam@x.invalid' && s.phone === '519 555 0101' && s.member_number === '1068' && s.is_member === true, JSON.stringify(s));
  ok('booking emails on, the rest off', JSON.stringify(s.notifications) === JSON.stringify({
    notify_booking_added: true, notify_league_new: false, notify_tournament_new: false, notify_event_new: false, notify_score_reported: false,
  }), JSON.stringify(s.notifications));
  ok('no change waiting', s.pending_email === null);
  const row = (await liam.get('/api/players')).find((p) => p.id === 2);
  ok('another member\'s email choices are in the player list', row && !Object.keys(row).some((k) => k.startsWith('notify_')), JSON.stringify(row));

  console.log('\nPROFILE');
  let r = await liam.send('PUT', '/api/me/profile', { name: '  Liam G  ', phone: '' });
  ok('saves a trimmed name and clears the phone', r.status === 200 && r.body.name === 'Liam G' && r.body.phone === '', JSON.stringify(r.body));
  r = await liam.send('PUT', '/api/me/profile', { name: ' ', phone: '' });
  ok('a blank name is refused on the name field', r.status === 400 && r.body.field === 'name' && r.body.error === 'Name is required.');
  r = await liam.send('PUT', '/api/me/profile', { name: 'Liam', phone: 'call me' });
  ok('a phone that is not a number is refused', r.status === 400 && r.body.field === 'phone' && r.body.error === 'That phone number does not look right.');
  r = await liam.send('PUT', '/api/me/profile', { name: 'Liam Gallagher', phone: '+1 (519) 555-0101 ext. 4' });
  ok('a normal phone with an extension is fine', r.status === 200 && r.body.phone === '+1 (519) 555-0101 ext. 4', JSON.stringify(r.body));
  r = await liam.send('PUT', '/api/me/profile', { name: 'Liam Gallagher', phone: '', member_number: '1', is_member: 0, email: 'x@y.z' });
  ok('member number, membership and email cannot be set this way', r.body.member_number === '1068' && r.body.is_member === true && r.body.email === 'liam@x.invalid', JSON.stringify(r.body));

  console.log('\nNOTIFICATIONS');
  r = await liam.send('PUT', '/api/me/notifications', { key: 'notify_league_new', value: true });
  ok('a switch saves', r.status === 200 && (await liam.get('/api/me/settings')).notifications.notify_league_new === true);
  ok('an unknown key is refused', await liam.status('PUT', '/api/me/notifications', { key: 'is_member', value: true }) === '400');

  console.log('\nCHANGING EMAIL');
  const tryEmail = async (email) => (await liam.send('POST', '/api/me/email', { email })).body.error;
  ok('blank', await tryEmail('') === 'Enter an email address.');
  ok('not an address', await tryEmail('liam.gmail.com') === 'That does not look like an email address.');
  ok('taken, in any case', await tryEmail('PRIYA@x.invalid') === 'That email is already used by another member.');
  ok('the same as now', await tryEmail('Liam@X.invalid') === 'That is already your email.');
  ok('nothing sent for any of those', sent.length === 0);

  r = await liam.send('POST', '/api/me/email', { email: 'liam.g@gmail.invalid' });
  ok('a good address is accepted and shows as waiting', r.status === 200 && r.body.pending_email === 'liam.g@gmail.invalid' && r.body.email === 'liam@x.invalid', JSON.stringify(r.body));
  ok('one email, to the new address', sent.length === 1 && toOf(sent[0]) === 'liam.g@gmail.invalid', JSON.stringify(sent.map(toOf)));
  ok('with the agreed subject', sent[0].subject === 'Confirm your new email for Play WSRC');
  ok('and wording', sent[0].text.startsWith('Liam, click the link below to make liam.g@gmail.invalid your Play WSRC sign-in email. If you did not ask for this, ignore this message and nothing will change.'), sent[0].text);
  ok('he still signs in with the old one', (await liam.get('/api/me/settings')).email === 'liam@x.invalid');
  const firstLink = pathOf(linkIn(sent[0]));

  r = await liam.send('POST', '/api/me/email/resend');
  ok('resend sends a fresh link', r.status === 200 && sent.length === 2 && toOf(sent[1]) === 'liam.g@gmail.invalid');
  const secondLink = pathOf(linkIn(sent[1]));
  ok('and the first link stops working', (await liam.text(firstLink)).includes('Link expired'));

  r = await liam.send('DELETE', '/api/me/email');
  ok('cancelling clears the waiting change', r.status === 200 && r.body.pending_email === null);
  ok('and its link no longer works', (await liam.text(secondLink)).includes('This confirmation link has expired or was already used.'));

  console.log('\nCONFIRMING');
  db.prepare("UPDATE user_accounts SET reset_token = 'old', reset_expires = '2999-01-01' WHERE player_id = 1").run();
  sent.length = 0;
  await liam.send('POST', '/api/me/email', { email: 'liam.g@gmail.invalid' });
  const link = pathOf(linkIn(sent[0]));
  const stranger = client(app);
  const page = await stranger.text(link);
  ok('the link works without being signed in', page.includes('Email confirmed') && page.includes('You now sign in with liam.g@gmail.invalid.'), page.slice(0, 200));
  ok('and points home', page.includes('href="/"') && page.includes('Open Play WSRC'));
  ok('the email has changed', (await liam.get('/api/me/settings')).email === 'liam.g@gmail.invalid');
  ok('the old address is told', sent.length === 2 && toOf(sent[1]) === 'liam@x.invalid' && sent[1].subject === 'Your Play WSRC email was changed'
    && sent[1].text.trim() === 'Your sign-in email was changed to liam.g@gmail.invalid. If this was not you, contact the club.', JSON.stringify(sent[1]));
  ok('a reset link sent to the old address stops working', db.prepare('SELECT reset_token FROM user_accounts WHERE player_id = 1').get().reset_token === null);
  ok('the link works once', (await stranger.text(link)).includes('Link expired'));
  const again = client(app);
  ok('he signs in with the new address', await again.login('liam.g@gmail.invalid', 'pw123') === '302' && (await again.me()).playerId === 1);
  ok('no em dash in any of it', !sent.some((m) => /—/.test(m.subject + (m.text || '') + m.html)));

  console.log('\nTAKEN BEFORE CONFIRMING');
  sent.length = 0;
  await liam.send('POST', '/api/me/email', { email: 'shared@x.invalid' });
  db.prepare("UPDATE players SET email = 'shared@x.invalid' WHERE id = 2").run();
  ok('the link is refused', (await stranger.text(pathOf(linkIn(sent[0])))).includes('Link expired'));
  ok('and nothing changed', (await liam.get('/api/me/settings')).email === 'liam.g@gmail.invalid');

  console.log('\nRESET LINK');
  sent.length = 0;
  r = await liam.send('POST', '/api/me/password-reset');
  ok('he can send himself a reset link', r.status === 200 && r.body.emailSent === true && sent.length === 1 && toOf(sent[0]) === 'liam.g@gmail.invalid', JSON.stringify(r.body));
  ok('it is the usual reset email', sent[0].subject === 'Reset your Play WSRC password' && /\/reset-password\//.test(sent[0].html));
  ok('and the link is not handed back to the page', !('resetUrl' in r.body));

  console.log('\nVIEW AS');
  const admin = client(app);
  await admin.login('', ADMIN_PW);
  await admin.send('POST', '/api/players/1/view-as');
  ok('an admin viewing as Liam can read his settings', (await admin.get('/api/me/settings')).name === 'Liam Gallagher');
  r = await admin.send('PUT', '/api/me/profile', { name: 'Hacked', phone: '' });
  ok('but cannot change them', r.status === 403 && r.body.error === 'You are viewing as this member. Settings can only be changed by the member.', JSON.stringify(r.body));
  ok('nor his email', await admin.status('POST', '/api/me/email', { email: 'admin@x.invalid' }) === '403');
  ok('nor send a reset', await admin.status('POST', '/api/me/password-reset') === '403');
  await admin.send('POST', '/api/return-to-admin');
  ok('the admin account itself has no settings here', await admin.getStatus('/api/me/settings') === '403');
  const st = await client(app).getStatus('/api/me/settings');
  ok('and a stranger is turned away', st === '401' || st === '302', st);
});
