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
    `ALTER TABLE leagues ADD COLUMN setup_type TEXT NOT NULL DEFAULT 'traditional'`,
    `ALTER TABLE players ADD COLUMN exclude_from_ladder INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE team_matchups ADD COLUMN division_id INTEGER`,
    `CREATE TABLE IF NOT EXISTS week_byes (id INTEGER PRIMARY KEY AUTOINCREMENT, week_id INTEGER NOT NULL, player_id INTEGER NOT NULL, division_id INTEGER NOT NULL, FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE, FOREIGN KEY (player_id) REFERENCES players(id), FOREIGN KEY (division_id) REFERENCES divisions(id))`,
    `ALTER TABLE matches ADD COLUMN confirmed_at TEXT`,
    `ALTER TABLE matches ADD COLUMN submitted_by_player_id INTEGER`,
    `CREATE TABLE IF NOT EXISTS courts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)`,
  ];
  for (const sql of migrations) {
    try { db.prepare(sql).run(); } catch (_) { /* column already exists */ }
  }

  // Make league_players.team_id nullable for modern leagues (SQLite requires table recreation)
  const lpCols = db.prepare(`PRAGMA table_info(league_players)`).all();
  const teamIdCol = lpCols.find((c) => c.name === 'team_id');
  if (teamIdCol && teamIdCol.notnull === 1) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE league_players_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        league_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        skill_rank INTEGER NOT NULL,
        team_id INTEGER,
        division_id INTEGER NOT NULL,
        FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players(id),
        FOREIGN KEY (team_id) REFERENCES teams(id),
        FOREIGN KEY (division_id) REFERENCES divisions(id)
      );
      INSERT INTO league_players_new SELECT * FROM league_players;
      DROP TABLE league_players;
      ALTER TABLE league_players_new RENAME TO league_players;
    `);
    db.pragma('foreign_keys = ON');
  }

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
