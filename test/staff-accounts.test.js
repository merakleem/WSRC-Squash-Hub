// Staff accounts beside the unchanged admin login: invites, permissions on
// every admin route, the activity log, two-step sign-in with an
// authenticator app and backup codes, resets, disabling, and View as.
// Run: node --test test/staff-accounts.test.js
process.env.RESEND_API_KEY = 'test-key';
delete process.env.EMAIL_REDIRECT_TO;

const OTPAuth = require('otpauth');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const ADMIN_PW = process.env.SITE_PASSWORD;

const sent = [];
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  for (const m of Array.isArray(body) ? body : [body]) sent.push(m);
  return { ok: true, json: async () => ({}) };
};
const toOf = (m) => [].concat(m.to)[0];
const linkIn = (m) => new URL((m.text || m.html).match(/https?:\/\/[^\s"<]+/)[0]).pathname;

// The pending sign-in cookie is signed, not secret: the setup secret is the
// person's own, and reading it here stands in for scanning the QR code.
function pendingSecret(agent) {
  const cookie = agent.jar.getCookie('wsrc_pending', { domain: '127.0.0.1', path: '/', secure: false, script: false });
  return JSON.parse(Buffer.from(cookie.value.split('.')[0], 'base64url').toString()).secret;
}
const codeFor = (secret, offsetSteps = 0) => new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) })
  .generate({ timestamp: Date.now() + offsetSteps * 30000 });

suite('staff accounts', async ({ ok, t }) => {
  let db;
  const app = boot(scratchDb(t, 'staff-accounts'), (dbm) => {
    db = dbm.getDB();
    dbm.run("INSERT INTO players (name, email, is_member) VALUES ('Priya Nair', 'priya@x.invalid', 1)");
    dbm.run("INSERT INTO players (name, email, is_member) VALUES ('Marcus Chen', 'marcus@x.invalid', 1)");
    dbm.run("INSERT INTO courts (name, sort_order) VALUES ('Court 1', 1)");
  });
  const admin = client(app);
  ok('the admin login is unchanged', await admin.login('', ADMIN_PW) === '302' && (await admin.me()).role === 'admin');
  ok('and may do everything', (await admin.me()).permissions.length === 11);

  console.log('\nINVITING');
  let r = await admin.send('POST', '/api/staff', { name: 'Sam Patel', email: 'priya@x.invalid', permissions: ['leagues'] });
  ok('a player\'s email is refused, with the alias hint', r.status === 400 && r.body.field === 'email' && /Gmail alias such as jordan\+staff@gmail.com/.test(r.body.error), JSON.stringify(r.body));
  ok('no name', (await admin.send('POST', '/api/staff', { email: 'a@b.co' })).body.error === 'Enter their name.');
  r = await admin.send('POST', '/api/staff', { name: 'Sam Patel', email: 'sam+staff@x.invalid', permissions: ['leagues', 'scores', 'nonsense'] });
  ok('Sam is invited', r.status === 200 && r.body.staff.status === 'invited', JSON.stringify(r.body));
  ok('with only real permissions', JSON.stringify(r.body.staff.permissions) === '["leagues","scores"]');
  ok('the same email twice is refused', (await admin.send('POST', '/api/staff', { name: 'X', email: 'SAM+staff@x.invalid' })).body.error === 'A staff account already uses this email.');
  const invite = sent.find((m) => toOf(m) === 'sam+staff@x.invalid');
  ok('the invite email', invite?.subject === "You're invited to help run Play WSRC" && invite.text.includes('Hi Sam, you\'ve been invited to Play WSRC as staff.'), JSON.stringify(invite));
  const samId = r.body.staff.id;

  const sam = client(app);
  let page = await sam.text(linkIn(invite));
  ok('the landing page', page.includes('Set up your staff account') && page.includes('sam+staff@x.invalid') && page.includes('Activate account') && !page.includes('class="sa-steps"'));
  let post = await sam.agent.post(linkIn(invite)).type('form').send({ name: 'Sam Patel', password: 'short', confirm: 'short' });
  ok('a short password is refused', post.text.includes('Password must be at least 8 characters.'));
  post = await sam.agent.post(linkIn(invite)).type('form').send({ name: 'Sam Patel', password: 'staffpass1', confirm: 'staffpass1' });
  ok('setting a password signs Sam in', post.status === 302 && (await sam.me()).role === 'staff');
  const me = await sam.me();
  ok('as himself, with his permissions', me.name === 'Sam Patel' && JSON.stringify(me.permissions) === '["leagues","scores"]' && me.playerId === null, JSON.stringify(me));
  ok('the invite link works once', (await client(app).text(linkIn(invite))).includes('Link expired'));

  console.log('\nPERMISSIONS');
  ok('Sam may announce a league', (await sam.send('POST', '/api/leagues/upcoming', { name: 'Winter League', startDate: '2031-11-04' })).status === 200);
  ok('but not add a court', await sam.status('POST', '/api/courts', { name: 'Glass' }) === '403');
  ok('with the agreed message', (await sam.send('POST', '/api/courts', { name: 'Glass' })).body.error === "You don't have permission to do that.");
  ok('nor add a player', await sam.status('POST', '/api/players', { name: 'New Person' }) === '403');
  ok('nor see player contact details', !('email' in (await sam.get('/api/players'))[0]));
  ok('nor manage staff', await sam.getStatus('/api/staff') === '403');
  ok('nor read the activity log', await sam.getStatus('/api/activity-log') === '403');
  ok('nor change the time zone', await sam.status('PUT', '/api/settings', { club_timezone: 'UTC' }) === '403');
  ok('he may enter a ladder score for any two players', (await sam.send('POST', '/api/matches/pickup', { player1Id: 1, player2Id: 2, player1Score: 3, player2Score: 1 })).status === 200);
  ok('court booking is open to him as it is to the admin account', (await sam.getStatus('/api/my-bookings')) === '200');

  console.log('\nTHE ACTIVITY LOG');
  await admin.send('POST', '/api/courts', { name: 'Glass Court' });
  const logRes = await admin.get('/api/activity-log');
  const texts = logRes.entries.map((e) => `${e.actor} ${e.text}`);
  ok('staff actions carry their name', texts.includes('Sam Patel announced the league Winter League'), JSON.stringify(texts));
  ok('scores read as agreed', texts.includes('Sam Patel entered a ladder match, Priya Nair v Marcus Chen, as 3–1'), JSON.stringify(texts));
  ok('the admin account shows as Administrator', texts.includes('Administrator added the court Glass Court'));
  ok('and staff management is logged', texts.includes('Administrator invited Sam Patel as a staff member'));
  ok('refused actions are not logged', !texts.some((x) => x.includes('Glass') && x.startsWith('Sam')));
  ok('newest first', logRes.entries[0].text === 'added the court Glass Court');
  const onlySam = await admin.get(`/api/activity-log?person=${samId}`);
  ok('filtered to a person', onlySam.entries.length > 0 && onlySam.entries.every((e) => e.actor === 'Sam Patel'));
  ok('filtered to an area', (await admin.get('/api/activity-log?area=courts')).entries.every((e) => e.area === 'courts'));
  const filters = await admin.get('/api/activity-log/filters');
  ok('the person filter starts with Administrator', filters.people[0].name === 'Administrator' && filters.people.some((p) => p.name === 'Sam Patel'));

  console.log('\nCHANGING PERMISSIONS APPLIES AT ONCE');
  await admin.send('PUT', `/api/staff/${samId}`, { permissions: ['leagues', 'scores', 'courts', 'club', 'log'], require_two_step: false });
  ok('Sam can now add a court', (await sam.send('POST', '/api/courts', { name: 'Court 9' })).status === 200);
  ok('and change the time zone, but not the ladder rules in the same call', await sam.status('PUT', '/api/settings', { club_timezone: 'America/Winnipeg', elo_margin_weight: 0.2 }) === '403');
  ok('the time zone alone is fine', await sam.status('PUT', '/api/settings', { club_timezone: 'America/Winnipeg' }) === '200');
  ok('and he can read the log', (await sam.getStatus('/api/activity-log')) === '200');

  console.log('\nVIEW AS');
  ok('without Players and accounts he cannot view as', await sam.status('POST', '/api/players/1/view-as') === '403');
  await admin.send('PUT', `/api/staff/${samId}`, { permissions: ['players', 'leagues'], require_two_step: false });
  ok('with it he can', (await sam.send('POST', '/api/players/1/view-as')).status === 200 && (await sam.me()).viewing_as === 'Priya Nair');
  ok('and the way back returns Sam, not the admin account', (await sam.send('POST', '/api/return-to-admin')).status === 200 && (await sam.me()).role === 'staff' && (await sam.me()).name === 'Sam Patel');

  console.log('\nMY ACCOUNT');
  r = await sam.send('POST', '/api/account/password', { current: 'wrong', password: 'newpass12', confirm: 'newpass12' });
  ok('a wrong current password is refused', r.status === 400 && r.body.field === 'current');
  const samElsewhere = client(app);
  await samElsewhere.login('sam+staff@x.invalid', 'staffpass1');
  ok('Sam is signed in on a second device', (await samElsewhere.me()).role === 'staff');
  r = await sam.send('POST', '/api/account/password', { current: 'staffpass1', password: 'newpass12', confirm: 'newpass12' });
  ok('changing it works', r.status === 200);
  ok('this device stays signed in', (await sam.me()).role === 'staff');
  ok('the other is signed out', (await samElsewhere.getStatus('/api/me')) === '302');
  sent.length = 0;
  r = await sam.send('PUT', '/api/account', { name: 'Sam Patel', email: 'sam.p@x.invalid' });
  ok('an email change waits for its link', r.status === 200 && r.body.pending_email === 'sam.p@x.invalid' && r.body.email === 'sam+staff@x.invalid');
  ok('which goes to the new address', toOf(sent[0]) === 'sam.p@x.invalid' && sent[0].subject === 'Confirm your new Play WSRC email');
  page = await client(app).text(linkIn(sent[0]));
  ok('confirming changes the sign-in email', page.includes('You now sign in with sam.p@x.invalid.') && (await sam.get('/api/account')).email === 'sam.p@x.invalid');

  console.log('\nTWO-STEP SIGN-IN');
  sent.length = 0;
  r = await admin.send('POST', '/api/staff', { name: 'Jordan Lee', email: 'jordan@x.invalid', permissions: ['events'], require_two_step: true });
  const jordanId = r.body.staff.id;
  const jordan = client(app);
  const jInvite = linkIn(sent.find((m) => toOf(m) === 'jordan@x.invalid'));
  page = await jordan.text(jInvite);
  ok('the landing page shows the steps when two-step is required', page.includes('class="sa-steps"') && page.includes('Continue'));
  post = await jordan.agent.post(jInvite).type('form').send({ name: 'Jordan Lee', password: 'jordanpass', confirm: 'jordanpass' });
  ok('the password step leads to setup, not into the app', post.status === 302 && post.headers.location === '/staff/two-step/setup' && (await jordan.getStatus('/api/me')) === '302');
  page = await jordan.text('/staff/two-step/setup');
  ok('setup shows a QR code and the key', page.includes('data:image/png;base64') && page.includes("Can't scan? Enter this key instead"));
  const secret = pendingSecret(jordan.agent);
  post = await jordan.agent.post('/staff/two-step/setup').type('form').send({ code: '000000' });
  ok('a wrong first code is refused', post.status === 401 && post.text.includes("That code didn't match."));
  ok('and keeps the same key, so the app already scanned still works', pendingSecret(jordan.agent) === secret);
  post = await jordan.agent.post('/staff/two-step/setup').type('form').send({ code: codeFor(secret) });
  const codes = [...post.text.matchAll(/<span>([A-Z0-9]{4}-[A-Z0-9]{4})<\/span>/g)].map((m) => m[1]);
  ok('the right code shows ten backup codes', post.status === 200 && codes.length === 10 && post.text.includes('Finish and sign in'), String(codes.length));
  post = await jordan.agent.post('/staff/two-step/finish').type('form').send({});
  ok('finishing signs Jordan in', post.status === 302 && (await jordan.me()).name === 'Jordan Lee');
  ok('backup codes are stored hashed', db.prepare('SELECT code_hash FROM staff_backup_codes WHERE staff_id = ?').all(jordanId).every((c) => c.code_hash.startsWith('$2')));

  const j2 = client(app);
  post = await j2.agent.post('/login').type('form').send({ email: 'jordan@x.invalid', password: 'jordanpass' });
  ok('signing in again asks for a code', post.status === 302 && post.headers.location === '/login/code');
  page = await j2.text('/login/code');
  ok('the code page names the account', page.includes('Enter your code') && page.includes('Signing in as jordan@x.invalid') && page.includes('Use a backup code instead'));
  post = await j2.agent.post('/login/code').type('form').send({ code: '123456' });
  ok('a wrong code says how many tries are left', post.status === 401 && post.text.includes('4 attempts left.'), post.text.match(/class="error">([^<]*)/)?.[1]);
  ok('and does not sign in', (await j2.getStatus('/api/me')) === '302');
  post = await j2.agent.post('/login/backup').type('form').send({ code: codes[0].toLowerCase() });
  ok('a backup code works, in any case', post.status === 302 && (await j2.me()).name === 'Jordan Lee');
  const j3 = client(app);
  await j3.agent.post('/login').type('form').send({ email: 'jordan@x.invalid', password: 'jordanpass' });
  post = await j3.agent.post('/login/backup').type('form').send({ code: codes[0] });
  ok('but only once', post.status === 401 && post.text.includes('already used'));
  for (let i = 0; i < 4; i++) post = await j3.agent.post('/login/code').type('form').send({ code: '111111' });
  ok('five wrong tries lock the account for 15 minutes', post.status === 429 && post.text.includes('Too many wrong codes. Wait 15 minutes'));
  const j4 = client(app);
  await j4.agent.post('/login').type('form').send({ email: 'jordan@x.invalid', password: 'jordanpass' });
  post = await j4.agent.post('/login/code').type('form').send({ code: codeFor(secret, 1) });
  ok('even the right code waits out the lock', post.status === 429);

  console.log('\nA RESET');
  db.prepare('UPDATE staff_accounts SET two_step_locked_until = NULL WHERE id = ?').run(jordanId);
  sent.length = 0;
  ok('the admin account sends a reset', (await admin.send('POST', `/api/staff/${jordanId}/reset`)).status === 200);
  const reset = sent.find((m) => toOf(m) === 'jordan@x.invalid');
  ok('the reset email', reset.subject === 'Reset your Play WSRC staff password' && reset.text.includes('The club administrator sent you a password reset.'));
  const j5 = client(app);
  post = await j5.agent.post(linkIn(reset)).type('form').send({ password: 'brandnew99', confirm: 'brandnew99' });
  ok('a reset clears two-step, and a required one is set up again', post.status === 302 && post.headers.location === '/staff/two-step/setup');
  ok('the old pairing and codes are gone', !db.prepare('SELECT totp_secret FROM staff_accounts WHERE id = ?').get(jordanId).totp_secret
    && db.prepare('SELECT COUNT(*) AS n FROM staff_backup_codes WHERE staff_id = ?').get(jordanId).n === 0);
  ok('and Jordan\'s other sessions end', (await jordan.getStatus('/api/me')) === '302');

  console.log('\nDISABLING');
  ok('the admin account disables Sam', (await admin.send('POST', `/api/staff/${samId}/disable`)).body.staff.status === 'disabled');
  ok('he is signed out at once', (await sam.getStatus('/api/me')) === '302');
  const again = client(app);
  ok('and cannot sign in', (await again.agent.post('/login').type('form').send({ email: 'sam.p@x.invalid', password: 'newpass12' })).status === 401);
  ok('his name stays in the log', (await admin.get('/api/activity-log')).entries.some((e) => e.actor === 'Sam Patel'));
  ok('enabling brings him back as he was', (await admin.send('POST', `/api/staff/${samId}/enable`)).body.staff.status === 'active'
    && (await again.agent.post('/login').type('form').send({ email: 'sam.p@x.invalid', password: 'newpass12' })).status === 302);

  console.log('\nCANCELLING AN INVITE');
  r = await admin.send('POST', '/api/staff', { name: 'Chris Nguyen', email: 'chris@x.invalid' });
  ok('an invite can be cancelled', (await admin.send('DELETE', `/api/staff/${r.body.staff.id}`)).status === 200);
  ok('an active account cannot be deleted', (await admin.send('DELETE', `/api/staff/${samId}`)).status === 409);

  ok('link tokens are stored hashed', db.prepare('SELECT COUNT(*) AS n FROM staff_accounts WHERE invite_token_hash IS NOT NULL AND length(invite_token_hash) != 64').get().n === 0);
  ok('no em dash in any email', !sent.some((m) => /—/.test(m.subject + (m.text || '') + m.html)));
});
