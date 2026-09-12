// The shared shape of every node test. A suite is one node:test test; each
// ok() inside it is a subtest, so the runner reports every assertion by name,
// keeps going after a failure, and fails the file when any assertion failed.
//
//   const { suite, scratchDb } = require('./lib/suite');
//   suite('what this file proves', async ({ ok, t }) => {
//     const file = scratchDb(t, 'my-test');     // fresh SQLite file, removed after
//     ok('a thing holds', 1 + 1 === 2, 'extra detail shown on failure');
//   });
//
// Run one file with `node --test test/<name>.test.js`, all with `npm test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Set before anything under test is required: middleware.js and routes/auth.js
// read these at load time.
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.SITE_PASSWORD = process.env.SITE_PASSWORD || 'pw';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';   // LOG_LEVEL=info npm test to see requests
delete process.env.EMAIL_REDIRECT_TO;

function suite(name, fn) {
  test(name, async (t) => {
    const pending = [];
    // ok() decides pass/fail at the moment it is called; the subtest only
    // reports it. Queued rather than awaited so callers stay synchronous.
    const ok = (n, c, x = '') => {
      pending.push(t.test(n, () => assert.ok(c, x !== '' ? `${n} [${x}]` : n)));
    };
    try {
      await fn({ ok, t });
    } finally {
      await Promise.all(pending);
    }
  });
}

/** A fresh database file in a temp dir, deleted when the test ends. */
function scratchDb(t, label = 'test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wsrc-${label}-`));
  const file = path.join(dir, 'squash.db');
  t.after(() => {
    try { require('../../database/db').closeDB(); } catch (_) { /* not open */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return file;
}

module.exports = { suite, scratchDb };
