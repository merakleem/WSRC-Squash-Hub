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
    ok('the feed carries the singles match and both doubles matches', feed.length === 3 && feed.filter((x) => x.format === 'doubles').length === 2 && feed.filter((x) => x.format === 'singles').length === 1, JSON.stringify(feed.map((x) => [x.format, x.source])));
    const dRow = feed.find((x) => x.format === 'doubles' && x.id === matchId);
    ok('a doubles row names both sides', dRow.team1.map((p) => p.id).join() === '1,2' && dRow.team2.map((p) => p.id).join() === '3,4' && dRow.p1_name === 'Ann Dbl & Bo Dbl', JSON.stringify(dRow));
    ok('with the winning side and no ladder places', dRow.won_side === 1 && dRow.winner_id === 1 && dRow.p1_pos === null && dRow.places_moved === 0 && dRow.submitted_by_name === 'Ann Dbl');
    ok('newest first across both formats', feed.every((x, i) => i === 0 || (feed[i - 1].confirmed_at || '') >= (x.confirmed_at || '')));
    const hist = get('ann', '/api/players/1/history');
    ok('singles history and record ignore doubles', hist.history.length === 1 && hist.wins === 1 && hist.losses === 0, `${hist.history.length} rows, ${hist.wins}-${hist.losses}`);

    console.log('\nTHE PROFILE PAYLOAD');
    const prof = get('ann', '/api/players/1/doubles');
    ok('two doubles matches in Ann\'s history, newest first', prof.history.length === 2 && prof.history[0].id > prof.history[1].id, JSON.stringify(prof.history.map((h) => h.id)));
    const first = prof.history.find((h) => h.id === matchId);
    ok('a row says who she played with and against', first.partner.id === 2 && first.opponents.map((o) => o.id).sort().join() === '3,4', JSON.stringify(first));
    ok('with her result and score from her side', first.result === 'W' && first.my_score === 3 && first.their_score === 1);
    const lost = prof.history.find((h) => h.id !== matchId);
    ok('a loss reads as one', lost.result === 'L' && lost.my_score === 1 && lost.their_score === 3, JSON.stringify(lost));
    ok('each row carries its season and her own rating change', prof.history.every((h) => h.season_key && Number.isInteger(h.rating_change)) && first.rating_change > 0 && lost.rating_change < 0, JSON.stringify(prof.history.map((h) => [h.season_key, h.rating_change])));
    ok('it is a ladder row, not a league one', first.source === 'pickup' && first.league_name === null);
    ok('partners are summed per season', prof.partners.length === 1 && prof.partners[0].id === 2 && prof.partners[0].wins === 1 && prof.partners[0].losses === 1 && prof.partners[0].context === 'Doubles ladder', JSON.stringify(prof.partners));
    ok('the ladder block matches the ladder', prof.ladder.position === dbl.rows.find((x) => x.id === 1).position && prof.ladder.rating === dbl.rows.find((x) => x.id === 1).rating && prof.ladder.size === 5, JSON.stringify(prof.ladder));
    ok('no doubles fixtures upcoming', Array.isArray(prof.upcoming) && prof.upcoming.length === 0);
    const bystander = get('ann', '/api/players/5/doubles');
    ok('a player with one match has one row and one partner', bystander.history.length === 1 && bystander.partners.length === 1 && bystander.partners[0].id === 3, JSON.stringify(bystander.partners));

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
