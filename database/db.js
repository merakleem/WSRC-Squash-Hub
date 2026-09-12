const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { runMigrations, currentVersion, LATEST } = require('./migrations');

let db = null;
let dbPathInUse = null;

/**
 * Open (or create) the database at `dbPath`, bring its schema up to date, and
 * make it the connection every model uses.
 *
 * Throws if a migration fails: the caller (server.js) exits, so a deploy whose
 * schema change cannot be applied never serves traffic against the old shape.
 * Reopening replaces any earlier connection, which is what the tests rely on.
 */
function initDB(dbPath, { log } = {}) {
  closeDB();
  db = new Database(dbPath);
  dbPathInUse = dbPath;

  // WAL lets readers run while a write is in progress and survives a crash
  // mid-write without a rollback journal; busy_timeout makes a second writer
  // wait its turn instead of failing at once with SQLITE_BUSY. Both matter
  // once the nightly backup reads the file while members are booking courts.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  runMigrations(db, { log });

  return Promise.resolve(db);
}

function closeDB() {
  if (!db) return;
  try { db.close(); } catch (_) { /* already closed */ }
  db = null;
  dbPathInUse = null;
}

function getDB() {
  return db;
}

/** Where the open database lives on disk; the backup job needs it. */
function getDBPath() {
  return dbPathInUse;
}

/** Schema version of the open database and the version this code expects. */
function schemaStatus() {
  return { version: db ? currentVersion(db) : 0, latest: LATEST };
}

function run(sql, params = []) {
  const result = db.prepare(sql).run(params);
  return { lastID: result.lastInsertRowid, changes: result.changes };
}

function all(sql, params = []) {
  return db.prepare(sql).all(params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(params);
}

module.exports = { initDB, closeDB, getDB, getDBPath, schemaStatus, run, all, get };
