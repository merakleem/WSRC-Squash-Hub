require('dotenv').config({ quiet: true });
const path = require('path');
const log = require('./lib/log');
const errors = require('./lib/errors');
const { initDB, closeDB, getDB } = require('./database/db');
const { ensureDir: ensureAvatarDir } = require('./lib/photos');
const { startBackups, stopBackups } = require('./lib/backup');

const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'squash.db');

const missingVars = [
  !process.env.SITE_PASSWORD && 'SITE_PASSWORD',
  !process.env.SESSION_SECRET && 'SESSION_SECRET',
].filter(Boolean);

if (missingVars.length > 0) {
  log.fatal({ missing: missingVars }, `Missing required environment variable(s): ${missingVars.join(', ')}. ` +
    'Railway: set these in the service\'s Variables tab. Local: copy .env.example to .env and fill in the values.');
  process.exit(1);
}

errors.init();

// ===== START =====
async function start() {
  // A migration that fails throws here, and the process exits below: the
  // deploy fails its health check instead of serving against the wrong schema.
  await initDB(DB_PATH, { log: (m) => log.info(m, `migration ${m.id} applied: ${m.name}`) });
  ensureAvatarDir();

  const { createApp } = require('./app');
  const app = createApp();
  const server = app.listen(PORT, () => {
    log.info({
      port: Number(PORT),
      db: DB_PATH,
      environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development',
      version: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      node: process.version,
    }, `Play WSRC is running on http://localhost:${PORT}`);
  });
  startBackups();

  // ===== SHUTDOWN =====
  // Railway sends SIGTERM on every redeploy. Stop taking connections, fold the
  // WAL into the database file and close it, then leave. A hard cap so a
  // stuck connection cannot hold the old deploy open.
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down');
    stopBackups();
    const cap = setTimeout(() => { log.warn('shutdown timed out; exiting'); process.exit(0); }, 10000);
    cap.unref();
    await new Promise((resolve) => server.close(resolve));
    try { getDB()?.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) { /* best effort */ }
    closeDB();
    await errors.flush();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  errors.capture(reason instanceof Error ? reason : new Error(String(reason)), { source: 'unhandledRejection' });
});
process.on('uncaughtException', async (err) => {
  errors.capture(err, { source: 'uncaughtException' }, 'uncaught exception; exiting');
  await errors.flush();
  process.exit(1);
});

start().catch(async (err) => {
  errors.capture(err, { source: 'startup' }, 'failed to start');
  await errors.flush();
  process.exit(1);
});
