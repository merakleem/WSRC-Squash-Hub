// The doubles ladder over HTTP: recording a 2v2 match, who may record it,
// what is refused, the doubles ladder endpoint, and deletion.
// Run: node test/doubles-api.test.js
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const PORT = 8151;
const BASE = `http://localhost:${PORT}`;
const DB = '/tmp/doubles-api-test.db';

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const jar = (n) => `/tmp/dbl-${n}.txt`;
const login = (n, email, pw) => { sh(`rm -f ${jar(n)}`); return sh(`curl -s -o /dev/null -w '%{http_code}' -c ${jar(n)} -X POST ${BASE}/login -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'email=${email}' --data-urlencode 'password=${pw}'`); };
const get = (n, p) => JSON.parse(sh(`curl -s -b ${jar(n)} ${BASE}${p}`));
const me = (n) => get(n, '/api/me');
const send = (n, method, p, body) => {
  const csrf = me(n).csrf || '';
  const data = body ? `-H 'Content-Type: application/json' -d '${JSON.stringify(body)}'` : '';
  const out = sh(`curl -s -w '\\n%{http_code}' -b ${jar(n)} -c ${jar(n)} -X ${method} ${BASE}${p} -H 'X-CSRF-Token: ${csrf}' ${data}`);
  const i = out.lastIndexOf('\n');
  return { status: Number(out.slice(i + 1)), body: JSON.parse(out.slice(0, i) || 'null') };
};

async function main() {
  try { fs.unlinkSync(DB); } catch (_) {}
  const dbm = require('../database/db');
  dbm.initDB(DB);
  const { run } = dbm;
  const hash = bcrypt.hashSync('pw123', 4);
  for (const [i, n] of ['Ann', 'Bo', 'Cy', 'Di', 'Ed'].entries()) {
    run('INSERT INTO players (name, email, is_member) VALUES (?, ?, 1)', [`${n} Dbl`, `${n.toLowerCase()}@x.invalid`]);
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (?, ?)', [i + 1, hash]);
  }
  run(`INSERT INTO settings (key,value) VALUES ('season_start_md','01-01')`);
  // One singles match so a current season exists.
  run(`INSERT INTO matches (type, status, format, player1_id, player2_id, player1_score, player2_score, winner_id, played_at, confirmed_at)
       VALUES ('ladder','played','singles',1,2,3,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);

  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SESSION_SECRET: 's', SITE_PASSWORD: 'pw', RESEND_API_KEY: '' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 2500));

  try {
    ok('everyone signs in', login('a', '', 'pw') === '302' && login('ann', 'ann@x.invalid', 'pw123') === '302' && login('ed', 'ed@x.invalid', 'pw123') === '302');

    console.log('\nRECORDING A DOUBLES MATCH');
    let r = send('ann', 'POST', '/api/matches/doubles', { team1: [1, 2], team2: [3, 4], team1Score: 3, team2Score: 1 });
    ok('a player records a match they played in', r.status === 200 && Number.isInteger(r.body?.id), JSON.stringify(r));
    const matchId = r.body?.id;
    r = send('ed', 'POST', '/api/matches/doubles', { team1: [1, 2], team2: [3, 4], team1Score: 3, team2Score: 1 });
    ok('but not one they were not in', r.status === 403, String(r.status));
    r = send('a', 'POST', '/api/matches/doubles', { team1: [1, 2], team2: [3, 5], team1Score: 1, team2Score: 3 });
    ok('an admin may record any', r.status === 200, JSON.stringify(r));
    r = send('ann', 'POST', '/api/matches/doubles', { team1: [1, 2], team2: [2, 4], team1Score: 3, team2Score: 1 });
    ok('a player on both sides is refused', r.status === 400 && /different/.test(r.body?.error), JSON.stringify(r.body));
    r = send('ann', 'POST', '/api/matches/doubles', { team1: [1, 2], team2: [3, 4], team1Score: 3, team2Score: 3 });
    ok('an impossible score is refused', r.status === 400 && /3 games/.test(r.body?.error), JSON.stringify(r.body));
    r = send('ann', 'POST', '/api/matches/doubles', { team1: [1, 2], team2: [3, 4], team1Score: 3, team2Score: 0, playedOn: '2999-01-01' });
    ok('a future date is refused', r.status === 400 && /future/.test(r.body?.error), JSON.stringify(r.body));
    r = send('ann', 'POST', '/api/matches/doubles', { team1: [1, 2], team2: [3, 99], team1Score: 3, team2Score: 0 });
    ok('an unknown player is refused', r.status === 400, JSON.stringify(r.body));

    console.log('\nTHE LADDERS');
    const dbl = get('ann', '/api/ladder/doubles/season');
    ok('the doubles ladder carries the season envelope', dbl.system === 'elo' && dbl.frozen === false && !!dbl.season, JSON.stringify({ system: dbl.system, frozen: dbl.frozen }));
    ok('and ranks the five who have played', dbl.rows.length === 5 && dbl.rows.every((x) => Number.isInteger(x.position) && Number.isInteger(x.rating)), dbl.rows.map((x) => `${x.name}:${x.rating}`).join());
    ok('with season records', dbl.rows.find((x) => x.id === 1).season_wins === 1 && dbl.rows.find((x) => x.id === 1).season_losses === 1);
    const sgl = get('ann', '/api/ladder/season');
    ok('the singles ladder only knows the singles match', sgl.rows.length === 2, String(sgl.rows.length));
    const feed = get('ann', '/api/activity?days=7');
    ok('the singles feed shows only the singles match for now', feed.length === 1, String(feed.length));
    const hist = get('ann', '/api/players/1/history');
    ok('singles history and record ignore doubles', hist.history.length === 1 && hist.wins === 1 && hist.losses === 0, `${hist.history.length} rows, ${hist.wins}-${hist.losses}`);

    console.log('\nDELETING');
    r = send('ann', 'DELETE', `/api/matches/doubles/${matchId}`);
    ok('a player cannot delete', r.status === 403, String(r.status));
    r = send('a', 'DELETE', `/api/matches/doubles/${matchId}`);
    ok('an admin can', r.status === 200);
    ok('and the ladder shrinks to the remaining match', get('a', '/api/ladder/doubles/season').rows.length === 4);
  } finally {
    server.kill();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
}
main();
