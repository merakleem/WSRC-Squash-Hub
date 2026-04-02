const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

let db = null;

function initDB(dbPath) {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);

      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');

      db.serialize(() => {
        db.run('PRAGMA foreign_keys = ON');
        schema.split(';').forEach((stmt) => {
          const trimmed = stmt.trim();
          if (trimmed) {
            db.run(trimmed, (err) => {
              if (err) console.error('Schema error:', err);
            });
          }
        });
        // Migrate existing databases: add columns if missing (errors are silently ignored)
        db.run(`ALTER TABLE leagues ADD COLUMN num_rounds INTEGER NOT NULL DEFAULT 1`, () => {});
        db.run(`ALTER TABLE leagues ADD COLUMN blackout_dates TEXT NOT NULL DEFAULT '[]'`, () => {});
        db.run(`ALTER TABLE players ADD COLUMN wsrc_member INTEGER NOT NULL DEFAULT 1`, () => {});
        db.run(`ALTER TABLE players ADD COLUMN club_locker_rating REAL`, () => {});
        // Backfill existing players: mark as WSRC members with rating 2.50
        db.run(`UPDATE players SET wsrc_member = 1, club_locker_rating = 2.50 WHERE club_locker_rating IS NULL`, () => {});
        // Sentinel query to know all statements have been queued
        db.run('SELECT 1', () => resolve(db));
      });
    });
  });
}

function getDB() {
  return db;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

module.exports = { initDB, getDB, run, all, get };
