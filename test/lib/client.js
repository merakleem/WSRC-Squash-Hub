// The app under test, mounted in-process with supertest: no port, no child
// process, no waiting for a server to come up. boot() opens a scratch
// database and builds the Express app; client() is one signed-in browser.
//
//   const app = boot(file, ({ run }) => { run("INSERT INTO players ..."); });
//   const admin = client(app);
//   await admin.login('', 'pw');                  // '302' on success
//   const list = await admin.get('/api/players'); // parsed JSON
//   const r = await admin.send('POST', '/api/players', { name: 'X' });
//   r.status, r.body (parsed), r.text (raw)

const request = require('supertest');

function boot(dbFile, seed) {
  // The spawned servers these tests replaced all ran without email configured.
  if (process.env.RESEND_API_KEY === undefined) process.env.RESEND_API_KEY = '';
  const dbm = require('../../database/db');
  dbm.initDB(dbFile);
  if (seed) seed(dbm);
  const { createApp } = require('../../app');
  return createApp();
}

function client(app) {
  const agent = request.agent(app);
  const me = async () => (await agent.get('/api/me')).body;
  const send = async (method, p, body) => {
    const csrf = (await me()).csrf || '';
    let req = agent[method.toLowerCase() === 'delete' ? 'delete' : method.toLowerCase()](p).set('X-CSRF-Token', csrf);
    if (body !== undefined) req = req.set('Content-Type', 'application/json').send(JSON.stringify(body));
    const r = await req;
    return { status: r.status, body: r.body, text: r.text };
  };
  return {
    agent,
    /** Sign in like the form does. Resolves to the status as a string ('302' = in). */
    login: async (email, password) => String((await agent.post('/login').type('form').send({ email, password })).status),
    me,
    /** GET, parsed JSON body. */
    get: async (p) => (await agent.get(p)).body,
    /** GET, raw text (HTML pages). */
    text: async (p) => (await agent.get(p)).text,
    /** GET, status as a string. */
    getStatus: async (p) => String((await agent.get(p)).status),
    /** A mutating call with the session's CSRF token. */
    send,
    /** Same, status only, as a string. */
    status: async (method, p, body) => String((await send(method, p, body)).status),
    /** A mutating call with no CSRF token at all. */
    sendBare: async (method, p) => String((await agent[method.toLowerCase()](p)).status),
  };
}

module.exports = { boot, client };
