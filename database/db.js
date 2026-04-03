const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
    `ALTER TABLE leagues ADD COLUMN match_start_time TEXT NOT NULL DEFAULT '19:00'`,
    `ALTER TABLE leagues ADD COLUMN num_courts INTEGER NOT NULL DEFAULT 2`,
    `ALTER TABLE leagues ADD COLUMN match_duration INTEGER NOT NULL DEFAULT 45`,
    `ALTER TABLE leagues ADD COLUMN match_buffer INTEGER NOT NULL DEFAULT 15`,
    `ALTER TABLE leagues ADD COLUMN schedule_courts INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE players ADD COLUMN wsrc_member INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE players ADD COLUMN club_locker_rating REAL`,
    `ALTER TABLE players ADD COLUMN member_number TEXT`,
    `ALTER TABLE matches ADD COLUMN court_number INTEGER`,
    `ALTER TABLE matches ADD COLUMN match_time TEXT`,
    `ALTER TABLE leagues ADD COLUMN schedule_grouped INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE leagues ADD COLUMN public_token TEXT`,
    `ALTER TABLE matches ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS user_accounts (player_id INTEGER PRIMARY KEY, password_hash TEXT, invite_token TEXT, invite_expires TEXT, reset_token TEXT, reset_expires TEXT, FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE)`,
  ];
  for (const sql of migrations) {
    try { db.prepare(sql).run(); } catch (_) { /* column already exists */ }
  }

  // Backfill existing players: mark as WSRC members with rating 2.50
  db.prepare(`UPDATE players SET wsrc_member = 1, club_locker_rating = 2.50 WHERE club_locker_rating IS NULL`).run();

  // Backfill/regenerate tokens to ensure they are 4-char hex
  const leaguesNeedingToken = db.prepare(`SELECT id FROM leagues WHERE public_token IS NULL OR length(public_token) != 4`).all();
  for (const league of leaguesNeedingToken) {
    db.prepare(`UPDATE leagues SET public_token = ? WHERE id = ?`).run(crypto.randomBytes(2).toString('hex'), league.id);
  }

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
