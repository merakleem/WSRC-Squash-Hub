// The service worker's rules, run outside a browser: network first, cache
// only what came back clean, serve the cache only when the network is gone,
// and leave everything with side effects or outside the app alone.
// Run: node --test test/sw.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite } = require('./lib/suite');

// A minimal service-worker world: listeners, a cache, a fetch we control.
function world() {
  const listeners = {};
  const store = new Map();
  const cache = {
    async put(req, res) { store.set(typeof req === 'string' ? req : req.url, res); },
    async match(req) { return store.get(typeof req === 'string' ? new URL(req, 'https://app.test').href : req.url) || undefined; },
  };
  const caches = { async open() { return cache; }, async keys() { return ['wsrc-v0', 'wsrc-v1']; }, deleted: [], async delete(k) { this.deleted.push(k); } };
  const ctx = {
    self: { location: { origin: 'https://app.test' }, addEventListener: (n, f) => { listeners[n] = f; }, skipWaiting() {}, clients: { async claim() {} } },
    caches, URL, console,
    fetch: null,
  };
  ctx.self.caches = caches;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8'), ctx);
  const respond = (req) => new Promise((resolve) => {
    let handled = false;
    listeners.fetch({ request: req, respondWith: (p) => { handled = true; resolve(p.then((r) => ({ handled, r }), (e) => ({ handled, error: e }))); } });
    if (!handled) resolve({ handled });
  });
  return { ctx, listeners, store, caches, respond };
}

const req = (url, { method = 'GET', mode = 'cors' } = {}) => ({ url: new URL(url, 'https://app.test').href, method, mode });
const res = (body, { status = 200, redirected = false, type = 'basic' } = {}) => ({ ok: status >= 200 && status < 300, status, redirected, type, body, clone() { return { ...this }; } });

suite('the offline shell', async ({ ok }) => {
  const w = world();

  console.log('WHAT IT TOUCHES');
  ok('a POST is left to the browser', !(await w.respond(req('/api/reservations', { method: 'POST' }))).handled);
  ok('the login page is left alone', !(await w.respond(req('/login'))).handled);
  ok('so is the health probe', !(await w.respond(req('/health'))).handled);
  ok('and an API call that is not on the offline list', !(await w.respond(req('/api/leagues'))).handled);
  ok('and anything cross-origin', !(await w.respond(req('https://fonts.googleapis.com/css2'))).handled);
  w.ctx.fetch = async () => res('shell');
  ok('the app shell is handled', (await w.respond(req('/'))).handled);
  ok('a module is handled', (await w.respond(req('/pages/players.js'))).handled);
  ok('today\'s schedule is handled', (await w.respond(req('/api/schedule?date=2026-09-12'))).handled);

  console.log('NETWORK FIRST');
  let calls = 0;
  w.ctx.fetch = async () => { calls++; return res('fresh'); };
  const online = await w.respond(req('/api/my-bookings'));
  ok('online, the network answers', online.r.body === 'fresh' && calls === 1);
  ok('and the answer is kept', w.store.has('https://app.test/api/my-bookings'));
  w.ctx.fetch = async () => { throw new Error('offline'); };
  const offline = await w.respond(req('/api/my-bookings'));
  ok('offline, the kept answer is served', offline.r?.body === 'fresh', JSON.stringify(offline));
  ok('nothing kept means the failure shows', !!(await w.respond(req('/api/courts'))).error);

  console.log('WHAT IS NOT KEPT');
  w.ctx.fetch = async () => res('sign in', { redirected: true });
  await w.respond(req('/api/players'));
  ok('a redirect (the sign-in page for a signed-out call) is never kept', !w.store.has('https://app.test/api/players'));
  w.ctx.fetch = async () => res('nope', { status: 500 });
  await w.respond(req('/api/courts'));
  ok('nor an error', !w.store.has('https://app.test/api/courts'));
  w.ctx.fetch = async () => res('opaque', { type: 'opaque' });
  await w.respond(req('/styles.css'));
  ok('nor an opaque response', !w.store.has('https://app.test/styles.css'));

  console.log('NAVIGATION');
  w.ctx.fetch = async () => res('shell');
  await w.respond(req('/'));
  w.ctx.fetch = async () => { throw new Error('offline'); };
  const nav = await w.respond(req('/some/deep/link', { mode: 'navigate' }));
  ok('an offline navigation gets the shell', nav.r?.body === 'shell');

  console.log('ACTIVATION');
  await new Promise((resolve) => w.listeners.activate({ waitUntil: (p) => p.then(resolve) }));
  ok('old caches are dropped on activate, the current one kept', w.caches.deleted.join() === 'wsrc-v0');
});
