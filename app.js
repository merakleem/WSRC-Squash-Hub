// ===== THE EXPRESS APP =====
// Everything about how requests are handled, with nothing about how the
// process is started: no env checks, no listen, no database opening. server.js
// does those, and the tests mount this app directly (supertest) against a
// scratch database - no port, no child process.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { getDB, schemaStatus } = require('./database/db');
const { getSession, requireCsrf } = require('./middleware');
const { AVATAR_DIR, AVATAR_URL_BASE } = require('./lib/photos');
const log = require('./lib/log');
const errors = require('./lib/errors');
const backup = require('./lib/backup');

const VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null;
const ENVIRONMENT = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development';

// Which requests are worth a log line. API calls, sign-ins and anything that
// went wrong, yes; a 200 for a stylesheet or the health check, no.
function _worthLogging(url, req, res) {
  if (res.statusCode >= 400) return true;
  if (url === '/health') return false;
  return url.startsWith('/api/') || req.method !== 'GET';
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ===== REQUEST ID + LOG =====
  // Every response carries X-Request-Id, and every logged line from handling
  // it carries the same id, so a member's "it said error" can be matched to
  // exactly one request in the logs (search @requestId:<id>).
  app.use((req, res, next) => {
    const id = req.get('x-request-id') || crypto.randomBytes(6).toString('hex');
    req.id = id;
    res.setHeader('X-Request-Id', id);
    req.log = log.child({ requestId: id });
    const startedAt = process.hrtime.bigint();
    // originalUrl, not path: by the time the response finishes a mounted
    // router has trimmed its prefix off req.path.
    const url = req.originalUrl.split('?')[0];
    res.on('finish', () => {
      if (!_worthLogging(url, req, res)) return;
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      req.log[level]({
        method: req.method,
        path: url,
        status: res.statusCode,
        ms: Math.round(ms * 10) / 10,
        role: req.session?.role,
        playerId: req.session?.playerId,
        ip: req.ip,
      }, `${req.method} ${url} ${res.statusCode}`);
    });
    next();
  });

  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Public assets (served before auth — login page needs the logo)
  app.use(express.static(path.join(__dirname, 'public')));

  // Auth pages + mobile token endpoint
  app.use(require('./routes/auth'));

  // ===== HEALTH =====
  // Unauthenticated, and what Railway polls before it sends traffic to a new
  // deploy. Says whether the database answers and is at the schema this code
  // expects, and when the last backup was. 503 when either is wrong.
  app.get('/health', (req, res) => {
    const out = {
      ok: true,
      version: VERSION,
      environment: ENVIRONMENT,
      uptime_s: Math.round(process.uptime()),
      db: null,
      backup: null,
      email_configured: !!process.env.RESEND_API_KEY,
      error_tracking: errors.isOn(),
    };
    try {
      const db = getDB();
      db.prepare('SELECT 1').get();
      const schema = schemaStatus();
      out.db = {
        ok: schema.version === schema.latest,
        schema_version: schema.version,
        schema_latest: schema.latest,
        journal_mode: db.pragma('journal_mode', { simple: true }),
      };
      if (!out.db.ok) out.ok = false;
    } catch (err) {
      out.ok = false;
      out.db = { ok: false, error: err.message };
    }
    const b = backup.status();
    out.backup = {
      last_at: b.last?.at || b.newest_file?.at || null,
      last_ok: b.last ? b.last.ok : (b.newest_file ? true : null),
      uploads: b.upload,
    };
    res.status(out.ok ? 200 : 503).json(out);
  });

  // ===== GLOBAL AUTH GUARD =====
  app.use((req, res, next) => {
    if (req.path === '/api/auth/token') return next();
    const session = getSession(req);
    if (!session) return res.redirect('/login');
    req.session = session;
    next();
  });

  // CSRF validation on all mutating API calls
  app.use('/api', requireCsrf);

  // Profile photos (behind the auth guard — member photos are not public).
  // Filenames are content-hashed, so these are safe to cache aggressively.
  app.use(AVATAR_URL_BASE, express.static(AVATAR_DIR, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
  }));

  // Renderer SPA (no caching — auth check must run before this)
  app.use(express.static(path.join(__dirname, 'renderer'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  }));

  // ===== API: WHO AM I =====
  app.get('/api/me', (req, res) => {
    let is_tester = 0;
    let is_member = 0;
    let viewing_as = null;
    // Name and photo are the requester's own, for the sidebar's profile card;
    // this route only ever reads the session's own player row.
    let name = null;
    let photo_path = null;
    if (req.session.playerId) {
      const player = getDB().prepare('SELECT is_tester, is_member, name, photo_path FROM players WHERE id = ?').get(req.session.playerId);
      is_tester = player?.is_tester || 0;
      is_member = player?.is_member || 0;
      name = player?.name || null;
      photo_path = player?.photo_path || null;
      // Set only when an admin is looking through a member's eyes, so the app can
      // say so and offer the way back.
      if (req.session.viewingAs) viewing_as = player?.name || 'this player';
    }
    res.json({ role: req.session.role, playerId: req.session.playerId || null, csrf: req.session.csrf || null, is_tester, is_member, name, photo_path, viewing_as, club_timezone: require('./lib/clock').getClubTimezone() });
  });

  // ===== API ROUTES =====
  app.use('/api', require('./routes/players'));
  app.use('/api', require('./routes/leagues'));
  app.use('/api', require('./routes/matches'));
  app.use('/api', require('./routes/ladder'));
  app.use('/api', require('./routes/activity'));
  app.use('/api', require('./routes/schedule'));
  app.use('/api', require('./routes/bookings'));
  app.use('/api', require('./routes/courts'));
  app.use('/api', require('./routes/tournaments'));
  app.use('/api', require('./routes/settings'));
  app.use('/api', require('./routes/session'));
  app.use('/api', require('./routes/seasons'));
  app.use('/api', require('./routes/events'));
  app.use('/api', require('./routes/backups'));

  // ===== 404 =====
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ===== ERRORS =====
  // Every route's wrap() sends its rejection here, as does a body the JSON
  // parser could not read. A 4xx carries the message it was thrown with; a
  // 5xx is logged with the request's context, reported to error tracking,
  // and answered with a generic message so nothing internal leaks.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = Number(err.status || err.statusCode) || 500;
    if (status >= 500) {
      errors.capture(err, {
        requestId: req.id, method: req.method, path: req.originalUrl.split('?')[0],
        role: req.session?.role, playerId: req.session?.playerId,
      }, 'request failed');
    } else if (req.log) {
      req.log.debug({ status, reason: err.message }, 'request refused');
    }
    if (res.headersSent) return res.end();
    const message = status < 500 ? (err.message || 'Bad request') : 'An internal error occurred';
    if (req.originalUrl.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') {
      return res.status(status).json({ error: message });
    }
    res.status(status).type('text').send(message);
  });

  return app;
}

module.exports = { createApp };
