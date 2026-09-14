// What the server tells the outside about itself: /health says whether the
// database answers and is at the schema this code expects, every response
// carries a request id, and a failure answers with a generic message rather
// than its stack.
// Run: node --test test/health.test.js
const request = require('supertest');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

suite('health, request ids and error answers', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'health'), ({ run }) => {
    run("INSERT INTO players (name, email) VALUES ('Invitee', 'inv@x.invalid')");
  });
  const dbm = require('../database/db');
  const { LATEST } = require('../database/migrations');

  console.log('HEALTH');
  let r = await request(app).get('/health');
  ok('answers 200 without signing in', r.status === 200);
  ok('as JSON that says ok', r.body.ok === true && r.headers['content-type'].includes('json'));
  ok('naming the schema version and that it is current', r.body.db.ok === true && r.body.db.schema_version === LATEST && r.body.db.schema_latest === LATEST, JSON.stringify(r.body.db));
  ok('and that the database is in WAL mode', r.body.db.journal_mode === 'wal');
  ok('with a backup section, empty until one has run', r.body.backup && r.body.backup.last_at === null && r.body.backup.last_ok === null, JSON.stringify(r.body.backup));
  ok('and whether email and error tracking are configured', r.body.email_configured === false && r.body.error_tracking === false);
  ok('uptime in whole seconds', Number.isInteger(r.body.uptime_s));

  // A database behind the code is the one thing a deploy must not serve.
  dbm.getDB().prepare('DELETE FROM schema_migrations WHERE id = ?').run(LATEST);
  r = await request(app).get('/health');
  ok('a database behind the code makes it 503', r.status === 503 && r.body.ok === false && r.body.db.ok === false, `${r.status} ${JSON.stringify(r.body.db)}`);
  dbm.getDB().prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(LATEST, 'restored');
  ok('and it recovers once the schema is current again', (await request(app).get('/health')).status === 200);

  console.log('REQUEST IDS');
  r = await request(app).get('/health');
  ok('every response carries X-Request-Id', /^[0-9a-f]{12}$/.test(r.headers['x-request-id']), r.headers['x-request-id']);
  r = await request(app).get('/health').set('X-Request-Id', 'from-the-proxy');
  ok('one sent by the proxy is kept', r.headers['x-request-id'] === 'from-the-proxy');
  ok('and nothing says what the server runs on', r.headers['x-powered-by'] === undefined);

  console.log('ERRORS');
  const a = client(app);
  await a.login('', 'pw');
  const bad = await a.agent.post('/api/players').set('X-CSRF-Token', (await a.me()).csrf).set('Content-Type', 'application/json').send('{not json');
  ok('a body that is not JSON is a 400 with the reason', bad.status === 400 && /JSON/.test(bad.body.error), `${bad.status} ${JSON.stringify(bad.body)}`);
  // Inviting with no email service is the one route that fails as a 500.
  const boom = await a.send('POST', '/api/players/send-invite', { ids: [1] });
  ok('a failure inside a route is a 500', boom.status === 500, String(boom.status));
  ok('with a message that names the cause the admin can fix, not a stack', /RESEND_API_KEY/.test(boom.body.error) && !/at .*\.js:\d+/.test(boom.text), boom.text);
  ok('an unknown API path is a JSON 404', (await a.send('GET', '/api/nothing-here')).status === 404 && (await a.send('GET', '/api/nothing-here')).body.error === 'Not found');
});
