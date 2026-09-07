// An admin can look through a member's eyes; nobody else can, and a member can
// never use the route back to become one.
const { execSync } = require('child_process');
const BASE = process.argv[2] || 'http://localhost:8099';
const ADMIN_PW = process.argv[3] || 'testpw';

let failed = 0;
const ok = (l, c, e = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${e ? '  ' + e : ''}`); if (!c) failed++; };
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const jar = (n) => `/tmp/va-${n}.txt`;

const login = (n, email, pw) => {
  sh(`rm -f ${jar(n)}`);
  return sh(`curl -s -o /dev/null -w '%{http_code}' -c ${jar(n)} -X POST ${BASE}/login -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'email=${email}' --data-urlencode 'password=${pw}'`);
};
const me = (n) => JSON.parse(sh(`curl -s -b ${jar(n)} ${BASE}/api/me`));
const post = (n, path) => {
  const csrf = me(n).csrf || '';
  return sh(`curl -s -b ${jar(n)} -c ${jar(n)} -X POST ${BASE}${path} -H 'X-CSRF-Token: ${csrf}'`);
};
const status = (n, path, csrf = true) => {
  const t = csrf ? `-H 'X-CSRF-Token: ${me(n).csrf || ''}'` : '';
  return sh(`curl -s -o /dev/null -w '%{http_code}' -b ${jar(n)} -X POST ${BASE}${path} ${t}`);
};

console.log('\nAN ADMIN CAN VIEW AS A PLAYER');
ok('admin signs in', login('a', '', ADMIN_PW) === '302');
ok('and is an admin', me('a').role === 'admin');
ok('with no impersonation showing', me('a').viewing_as === null);

const target = JSON.parse(sh(`curl -s -b ${jar('a')} ${BASE}/api/players`))[0];
const res = JSON.parse(post('a', `/api/players/${target.id}/view-as`));
ok('switching returns the player name', res.name === target.name, JSON.stringify(res));
const asPlayer = me('a');
ok('the session becomes that player', asPlayer.role === 'player' && asPlayer.playerId === target.id);
ok('and says who is being viewed', asPlayer.viewing_as === target.name, String(asPlayer.viewing_as));
ok('admin-only routes are refused while impersonating',
  status('a', '/api/players/1/view-as') === '403');

console.log('\nAND CAN GET BACK');
ok('return-to-admin succeeds', JSON.parse(post('a', '/api/return-to-admin')).ok === true);
ok('the session is an admin again', me('a').role === 'admin');
ok('with impersonation cleared', me('a').viewing_as === null);

console.log('\nA REAL PLAYER CANNOT');
// Requires a player account to exist; skipped cleanly if none is set up.
const pw = process.argv[4], em = process.argv[5];
if (!pw || !em) {
  console.log('  SKIP  no player credentials supplied');
} else {
  ok('player signs in', login('p', em, pw) === '302');
  ok('and is a player', me('p').role === 'player');
  ok('cannot view as anyone', status('p', '/api/players/1/view-as') === '403');
  ok('cannot return to admin', status('p', '/api/return-to-admin') === '403');
  ok('and is still just a player', me('p').role === 'player');
}

console.log('\nCSRF IS ENFORCED');
login('c', '', ADMIN_PW);
ok('a POST without a CSRF token is refused', status('c', `/api/players/${target.id}/view-as`, false) === '403');

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
process.exit(failed ? 1 : 0);
