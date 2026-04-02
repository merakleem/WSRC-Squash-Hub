const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

function initDB(dbPath) {
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Migrate existing databases: add columns if missing (errors are silently ignored)
  const migrations = [
    `ALTER TABLE leagues ADD COLUMN num_rounds INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE leagues ADD COLUMN blackout_dates TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE players ADD COLUMN wsrc_member INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE players ADD COLUMN club_locker_rating REAL`,
  ];
  for (const sql of migrations) {
    try { db.prepare(sql).run(); } catch (_) { /* column already exists */ }
  }

  // Backfill existing players: mark as WSRC members with rating 2.50
  db.prepare(`UPDATE players SET wsrc_member = 1, club_locker_rating = 2.50 WHERE club_locker_rating IS NULL`).run();

  return Promise.resolve(db);
}

function getDB() {
  return db;
}

function run(sql, params = []) {
  const result = db.prepare(sql).run(params);
  return Promise.resolve({ lastID: result.lastInsertRowid, changes: result.changes });
}

function all(sql, params = []) {
  return Promise.resolve(db.prepare(sql).all(params));
}

function get(sql, params = []) {
  return Promise.resolve(db.prepare(sql).get(params));
}

module.exports = { initDB, getDB, run, all, get };
