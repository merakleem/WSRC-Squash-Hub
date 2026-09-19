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

// Roughly one request in sixteen thousand comes back from supertest's agent as
// a 404 with no body and no content-type, having never reached the app at all
// - reproducible against a bare Express app with none of our code, so it is
// the harness, not the server. It is rare per request and common per suite,
// and it cascades: a lost GET /api/me yields no CSRF token, so the call after
// it is rejected and the assertion fails somewhere else entirely.
//
// Nothing of ours answers that way (our /api 404 is JSON, Express's own is
// HTML), and the server never saw the request, so there is nothing to
// double-apply. One retry, and only for that exact shape.
const phantom = (r) => r.status === 404 && !r.headers['content-type'] && !r.text;
async function once(make) {
  const r = await make();
  return phantom(r) ? make() : r;
}

function client(app) {
  const agent = request.agent(app);
  const me = async () => (await once(() => agent.get('/api/me'))).body;
  const send = async (method, p, body) => {
    const csrf = (await me()).csrf || '';
    const build = () => {
      const req = agent[method.toLowerCase() === 'delete' ? 'delete' : method.toLowerCase()](p).set('X-CSRF-Token', csrf);
      return body !== undefined ? req.set('Content-Type', 'application/json').send(JSON.stringify(body)) : req;
    };
    const r = await once(build);
    return { status: r.status, body: r.body, text: r.text };
  };
  return {
    agent,
    /** Sign in like the form does. Resolves to the status as a string ('302' = in). */
    login: async (email, password) => String((await once(() => agent.post('/login').type('form').send({ email, password }))).status),
    me,
    /** GET, parsed JSON body. */
    get: async (p) => (await once(() => agent.get(p))).body,
    /** GET, raw text (HTML pages). */
    text: async (p) => (await once(() => agent.get(p))).text,
    /** GET, status as a string. */
    getStatus: async (p) => String((await once(() => agent.get(p))).status),
    /** A mutating call with the session's CSRF token. */
    send,
    /** Same, status only, as a string. */
    status: async (method, p, body) => String((await send(method, p, body)).status),
    /** A mutating call with no CSRF token at all. */
    sendBare: async (method, p) => String((await agent[method.toLowerCase()](p)).status),
  };
}

module.exports = { boot, client };
