// ===== SERVICE WORKER =====
// What it does: after one online visit, the app shell (index, styles, every
// module, vendored Quill, assets) and a few read-only API answers are kept in
// a cache, so that with no signal at the club the app still opens and shows
// today's bookings and your own. Nothing here changes what an online visit
// sees: every request goes to the network first, and the cache is only read
// when the network fails.
//
// What it does not do: cache anything that was a redirect (a signed-out /api
// call redirects to /login), anything but GET, anything cross-origin, or any
// page outside the app (login, invite, reset, health). No push, no background
// sync - those need a backend the club does not have yet.
//
// Bump VERSION when the caching rules change; the old cache is dropped on
// activate. Cached files themselves need no bump: they are refreshed on every
// successful online fetch.

const VERSION = 'wsrc-v1';

// API answers worth having when the network is gone: what the booking page
// and the dashboard read. Matched on the path, query string ignored.
const OFFLINE_API = ['/api/me', '/api/schedule', '/api/my-bookings', '/api/players', '/api/courts', '/api/booking-types'];

// Never cached: the auth pages, the health probe, and anything with side effects.
const NEVER = ['/login', '/logout', '/health', '/invite/', '/reset-password/', '/forgot-password', '/api/backups', '/sw.js'];

function classify(url) {
  if (url.origin !== self.location.origin) return 'ignore';
  const p = url.pathname;
  if (NEVER.some((n) => p === n || p.startsWith(n))) return 'ignore';
  if (p.startsWith('/api/')) return OFFLINE_API.includes(p) ? 'api' : 'ignore';
  if (p.startsWith('/uploads/')) return 'asset';
  return 'shell';
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const kind = classify(new URL(request.url));
  if (kind === 'ignore') return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    // Only a real, direct 200 is worth keeping: a redirect is the sign-in
    // page, an error is not the thing asked for.
    if (response.ok && response.status === 200 && !response.redirected && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    // An app navigation with nothing cached: the shell, if we have it.
    if (request.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}
