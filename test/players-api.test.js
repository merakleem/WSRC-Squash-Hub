// The players-page backend surface: account_status derivation, writable
// member_number/flags on create, partial updates, bulk patch, bulk invites,
// and the privacy rules (testers and account_status hidden from players).
// Run: node test/players-api.test.js
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const PORT = 8127;
const BASE = `http://localhost:${PORT}`;
const DB = '/tmp/players-api-test.db';

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const jar = (n) => `/tmp/pa-${n}.txt`;
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

async function main() {
  try { fs.unlinkSync(DB); } catch (_) {}
  const dbm = require('../database/db');
  dbm.initDB(DB);
  const { run } = dbm;
  // verified, pending, none, tester
  run("INSERT INTO players (name, email, is_member) VALUES ('Vera Verified', 'vera@x.invalid', 1)");
  run("INSERT INTO players (name, email) VALUES ('Ivan Invited', 'ivan@x.invalid')");
  run("INSERT INTO players (name, email) VALUES ('Nora None', 'nora@x.invalid')");
  run("INSERT INTO players (name, is_tester) VALUES ('Test Tessa', 1)");
  const hash = bcrypt.hashSync('pw123', 4);
  run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [hash]);
  run("INSERT INTO user_accounts (player_id, invite_token, invite_expires) VALUES (2, 'tok', '2099-01-01')");

  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SESSION_SECRET: 's', SITE_PASSWORD: 'pw', RESEND_API_KEY: '' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 2500));

  try {
    console.log('ACCOUNT STATUS + PRIVACY');
    login('a', '', 'pw');
    login('p', 'vera@x.invalid', 'pw123');
    const adminList = get('a', '/api/players');
    const by = (n) => adminList.find((p) => p.name === n);
    ok('verified is derived', by('Vera Verified').account_status === 'verified');
    ok('an open invite reads pending', by('Ivan Invited').account_status === 'pending');
    ok('no account row reads none', by('Nora None').account_status === 'none');
    const playerList = get('p', '/api/players');
    ok('players never see account_status', playerList.every((p) => !('account_status' in p)));
    // A tester is a normal member of the club who gets features early, not a
    // hidden account: they appear in everyone's list. Only the flag is private.
    ok('but do see testers, who are ordinary players', playerList.some((p) => p.name === 'Test Tessa'), JSON.stringify(playerList.map((p) => p.name)));
    ok('without the tester flag on them', playerList.every((p) => !('is_tester' in p)));

    console.log('WRITABLE FIELDS');
    const created = JSON.parse(send('a', 'POST', '/api/players', { name: 'Full Fanny', email: 'fanny@x.invalid', phone: '1', member_number: 'M-9', club_locker_rating: 3.25, is_member: true, is_tester: true, exclude_from_ladder: true }));
    ok('create accepts member number and flags', created.member_number === 'M-9' && created.is_member === 1 && created.is_tester === 1 && created.exclude_from_ladder === 1, JSON.stringify(created));
    const partial = JSON.parse(send('a', 'PUT', `/api/players/${created.id}`, { club_locker_rating: 4.5 }));
    ok('a partial update changes only what it sends', partial.club_locker_rating === 4.5 && partial.member_number === 'M-9' && partial.email === 'fanny@x.invalid' && partial.is_member === 1, JSON.stringify(partial));
    const named = JSON.parse(send('a', 'PUT', `/api/players/${created.id}`, { name: 'Renamed Fanny', member_number: '' }));
    ok('a sent-empty field clears', named.name === 'Renamed Fanny' && named.member_number === null);

    console.log('BULK PATCH');
    const bulk = JSON.parse(send('a', 'POST', '/api/players/bulk', { ids: [1, 3], patch: { is_member: true, club_locker_rating: 2.5 } }));
    ok('bulk patch reports its count', bulk.changed === 2, JSON.stringify(bulk));
    const after = get('a', '/api/players');
    ok('and lands both fields', after.find((p) => p.id === 3).is_member === 1 && after.find((p) => p.id === 3).club_locker_rating === 2.5);
    const noname = JSON.parse(send('a', 'POST', '/api/players/bulk', { ids: [1], patch: { name: 'HACKED' } }));
    ok('bulk patch ignores non-patchable fields', noname.changed === 0 && get('a', '/api/players').find((p) => p.id === 1).name === 'Vera Verified');
    const legacy = JSON.parse(send('a', 'POST', '/api/players/membership', { ids: [3], is_member: false }));
    ok('the membership alias still works', legacy.changed === 1);
    ok('players cannot bulk patch', sh(`curl -s -o /dev/null -w '%{http_code}' -b ${jar('p')} -X POST ${BASE}/api/players/bulk -H 'X-CSRF-Token: ${me('p').csrf}' -H 'Content-Type: application/json' -d '{"ids":[1],"patch":{"is_member":true}}'`) === '403');

    console.log('BULK INVITES');
    const inv = send('a', 'POST', '/api/players/send-invite', { ids: [1, 2, 3] });
    ok('without email config the route refuses cleanly', /RESEND_API_KEY/.test(inv), inv);
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch (_) {}
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
