// ===== LOGGING =====
// One logger for the whole server. Every line is a JSON object with `level`
// (as a word) and `message`, which is the shape Railway's log explorer parses:
// lines are coloured by level and any other field can be searched with
// @field:value - so "@requestId:abc" or "@playerId:42" finds one member's
// requests. On a terminal the same lines are printed readably instead.
//
// Usage: const log = require('./lib/log');
//        log.info({ playerId: 3 }, 'booking made');   // fields first, then message
//        log.child({ requestId }) for a logger that stamps every line.

const pino = require('pino');

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'warn' : 'info');

// Human output for a terminal: time, level, message, then any extra fields.
// Avoids a second package (pino-pretty) for what is a dozen lines.
function prettyDestination() {
  const COLORS = { fatal: 31, error: 31, warn: 33, info: 32, debug: 36, trace: 90 };
  return {
    write(chunk) {
      let line;
      try {
        const o = JSON.parse(chunk);
        const { level: lvl, time, message, ...rest } = o;
        const at = new Date(time).toTimeString().slice(0, 8);
        const c = COLORS[lvl] || 0;
        const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
        line = `${at} \x1b[${c}m${String(lvl).toUpperCase().padEnd(5)}\x1b[0m ${message || ''}${extra}\n`;
      } catch (_) {
        line = chunk;
      }
      process.stdout.write(line);
    },
  };
}

const usePretty = process.stdout.isTTY && process.env.NODE_ENV !== 'production' && process.env.LOG_FORMAT !== 'json';

const log = pino({
  level,
  messageKey: 'message',
  base: null, // no pid/hostname on every line; Railway already knows the instance
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Errors serialise to { type, message, stack } under `err`.
  serializers: { err: pino.stdSerializers.err },
}, usePretty ? prettyDestination() : pino.destination({ fd: 1, sync: process.env.NODE_ENV === 'test' }));

module.exports = log;
