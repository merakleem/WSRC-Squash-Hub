// The players-page backend surface: account_status derivation, writable
// member_number/flags on create, partial updates, bulk patch, bulk invites,
// and the privacy rules (testers and account_status hidden from players).
// Run: node --test test/players-api.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

suite('players API', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'players-api'), ({ run }) => {
    // verified, pending, none, tester
    run("INSERT INTO players (name, email, is_member) VALUES ('Vera Verified', 'vera@x.invalid', 1)");
    run("INSERT INTO players (name, email) VALUES ('Ivan Invited', 'ivan@x.invalid')");
    run("INSERT INTO players (name, email) VALUES ('Nora None', 'nora@x.invalid')");
    run("INSERT INTO players (name, is_tester) VALUES ('Test Tessa', 1)");
    const hash = bcrypt.hashSync('pw123', 4);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
    run("INSERT INTO user_accounts (player_id, invite_token, invite_expires) VALUES (2, 'tok', '2099-01-01')");
  });
  const a = client(app);
  const p = client(app);

  console.log('ACCOUNT STATUS + PRIVACY');
  await a.login('', 'pw');
  await p.login('vera@x.invalid', 'pw123');
  const adminList = await a.get('/api/players');
  const by = (n) => adminList.find((x) => x.name === n);
  ok('verified is derived', by('Vera Verified').account_status === 'verified');
  ok('an open invite reads pending', by('Ivan Invited').account_status === 'pending');
  ok('no account row reads none', by('Nora None').account_status === 'none');
  const playerList = await p.get('/api/players');
  ok('players never see account_status', playerList.every((x) => !('account_status' in x)));
  // A tester is a normal member of the club who gets features early, not a
  // hidden account: they appear in everyone's list. Only the flag is private.
  ok('but do see testers, who are ordinary players', playerList.some((x) => x.name === 'Test Tessa'), JSON.stringify(playerList.map((x) => x.name)));
  ok('without the tester flag on them', playerList.every((x) => !('is_tester' in x)));

  console.log('WRITABLE FIELDS');
  const created = (await a.send('POST', '/api/players', { name: 'Full Fanny', email: 'fanny@x.invalid', phone: '1', member_number: 'M-9', club_locker_rating: 3.25, is_member: true, is_tester: true, exclude_from_ladder: true })).body;
  ok('create accepts member number and flags', created.member_number === 'M-9' && created.is_member === 1 && created.is_tester === 1 && created.exclude_from_ladder === 1, JSON.stringify(created));
  const partial = (await a.send('PUT', `/api/players/${created.id}`, { club_locker_rating: 4.5 })).body;
  ok('a partial update changes only what it sends', partial.club_locker_rating === 4.5 && partial.member_number === 'M-9' && partial.email === 'fanny@x.invalid' && partial.is_member === 1, JSON.stringify(partial));
  const named = (await a.send('PUT', `/api/players/${created.id}`, { name: 'Renamed Fanny', member_number: '' })).body;
  ok('a sent-empty field clears', named.name === 'Renamed Fanny' && named.member_number === null);

  console.log('BULK PATCH');
  const bulk = (await a.send('POST', '/api/players/bulk', { ids: [1, 3], patch: { is_member: true, club_locker_rating: 2.5 } })).body;
  ok('bulk patch reports its count', bulk.changed === 2, JSON.stringify(bulk));
  const after = await a.get('/api/players');
  ok('and lands both fields', after.find((x) => x.id === 3).is_member === 1 && after.find((x) => x.id === 3).club_locker_rating === 2.5);
  const noname = (await a.send('POST', '/api/players/bulk', { ids: [1], patch: { name: 'HACKED' } })).body;
  ok('bulk patch ignores non-patchable fields', noname.changed === 0 && (await a.get('/api/players')).find((x) => x.id === 1).name === 'Vera Verified');
  const legacy = (await a.send('POST', '/api/players/membership', { ids: [3], is_member: false })).body;
  ok('the membership alias still works', legacy.changed === 1);
  ok('players cannot bulk patch', await p.status('POST', '/api/players/bulk', { ids: [1], patch: { is_member: true } }) === '403');

  console.log('BULK INVITES');
  const inv = (await a.send('POST', '/api/players/send-invite', { ids: [1, 2, 3] })).text;
  ok('without email config the route refuses cleanly', /RESEND_API_KEY/.test(inv), inv);
});
