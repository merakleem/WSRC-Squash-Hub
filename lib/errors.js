// ===== ERROR TRACKING =====
// Anything that gets as far as a 500, an unhandled rejection, or a crash goes
// through here. It is always logged (lib/log) with whatever context the caller
// has - request id, route, who was signed in - and, when SENTRY_DSN is set, it
// is also sent to Sentry, which groups repeats and alerts. Without a DSN this
// is just the log, which is what local and test runs want.

const log = require('./log');

let sentry = null;

function init() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  try {
    sentry = require('@sentry/node');
    sentry.init({
      dsn,
      environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development',
      release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
      // Errors only. Tracing would sample every request; not worth it at club scale.
      tracesSampleRate: 0,
      sendDefaultPii: false,
    });
    log.info({ environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development' }, 'error tracking on');
    return true;
  } catch (err) {
    sentry = null;
    log.warn({ err }, 'error tracking could not start; errors will only be logged');
    return false;
  }
}

/**
 * Record an error. `context` is flat and small: requestId, method, path,
 * role, playerId, and anything else that helps find the request again.
 */
function capture(err, context = {}, message = 'unhandled error') {
  log.error({ err, ...context }, message);
  if (!sentry) return;
  try {
    sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(context)) scope.setTag(k, String(v));
      if (context.playerId) scope.setUser({ id: String(context.playerId) });
      sentry.captureException(err);
    });
  } catch (_) { /* never let reporting throw */ }
}

/** Give Sentry a moment to send before the process exits. */
async function flush(timeoutMs = 2000) {
  if (!sentry) return;
  try { await sentry.flush(timeoutMs); } catch (_) { /* best effort */ }
}

module.exports = { init, capture, flush, isOn: () => !!sentry };
