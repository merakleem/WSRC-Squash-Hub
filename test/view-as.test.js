// An admin can look through a member's eyes; nobody else can, and a member can
// never use the route back to become one.
// Run: node --test test/view-as.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const ADMIN_PW = process.env.SITE_PASSWORD;

suite('viewing as a player', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'view-as'), ({ run }) => {
    run("INSERT INTO players (name, email) VALUES ('Tara Target', 'tara@x.invalid')");
    run("INSERT INTO players (name, email) VALUES ('Pia Player', 'pia@x.invalid')");
    run('INSERT INTO user_accounts (player_id, password_hash) VALUES (2, ?)', [bcrypt.hashSync('pw123', 4)]);
  });
  const a = client(app), p = client(app), c = client(app);

  console.log('\nAN ADMIN CAN VIEW AS A PLAYER');
  ok('admin signs in', await a.login('', ADMIN_PW) === '302');
  ok('and is an admin', (await a.me()).role === 'admin');
  ok('with no impersonation showing', (await a.me()).viewing_as === null);

  const target = (await a.get('/api/players'))[0];
  const res = (await a.send('POST', `/api/players/${target.id}/view-as`)).body;
  ok('switching returns the player name', res.name === target.name, JSON.stringify(res));
  const asPlayer = await a.me();
  ok('the session becomes that player', asPlayer.role === 'player' && asPlayer.playerId === target.id);
  ok('and says who is being viewed', asPlayer.viewing_as === target.name, String(asPlayer.viewing_as));
  ok('admin-only routes are refused while impersonating', await a.status('POST', '/api/players/1/view-as') === '403');

  console.log('\nAND CAN GET BACK');
  ok('return-to-admin succeeds', (await a.send('POST', '/api/return-to-admin')).body.ok === true);
  ok('the session is an admin again', (await a.me()).role === 'admin');
  ok('with impersonation cleared', (await a.me()).viewing_as === null);

  console.log('\nA REAL PLAYER CANNOT');
  ok('player signs in', await p.login('pia@x.invalid', 'pw123') === '302');
  ok('and is a player', (await p.me()).role === 'player');
  ok('cannot view as anyone', await p.status('POST', '/api/players/1/view-as') === '403');
  ok('cannot return to admin', await p.status('POST', '/api/return-to-admin') === '403');
  ok('and is still just a player', (await p.me()).role === 'player');

  console.log('\nCSRF IS ENFORCED');
  await c.login('', ADMIN_PW);
  ok('a POST without a CSRF token is refused', await c.sendBare('POST', `/api/players/${target.id}/view-as`) === '403');
});
