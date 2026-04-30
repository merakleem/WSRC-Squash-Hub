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
    `CREATE TABLE IF NOT EXISTS booking_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6b7589')`,
    `CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, court_id INTEGER NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 60, booking_type_id INTEGER, info TEXT, FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE, FOREIGN KEY (booking_type_id) REFERENCES booking_types(id) ON DELETE SET NULL)`,
    `CREATE TABLE IF NOT EXISTS league_courts (league_id INTEGER NOT NULL, court_id INTEGER NOT NULL, PRIMARY KEY (league_id, court_id), FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE, FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE)`,
    `ALTER TABLE matches ADD COLUMN court_id INTEGER`,
    `ALTER TABLE bookings ADD COLUMN group_id INTEGER`,
    `ALTER TABLE bookings ADD COLUMN name TEXT`,
    `ALTER TABLE bookings ADD COLUMN repeat_group_id INTEGER`,
    `CREATE TABLE IF NOT EXISTS booking_players (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, player_id INTEGER NOT NULL, FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE, FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'groups_16', status TEXT NOT NULL DEFAULT 'group_stage', championship_date TEXT NOT NULL, match_duration_minutes INTEGER NOT NULL DEFAULT 60, buffer_minutes INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS tournament_courts (tournament_id INTEGER NOT NULL, court_id INTEGER NOT NULL, PRIMARY KEY (tournament_id, court_id), FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE, FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS tournament_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id INTEGER NOT NULL, name TEXT NOT NULL, FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS tournament_players (id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id INTEGER NOT NULL, player_id INTEGER NOT NULL, group_id INTEGER, seed INTEGER, FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE, FOREIGN KEY (player_id) REFERENCES players(id), FOREIGN KEY (group_id) REFERENCES tournament_groups(id))`,
    `CREATE TABLE IF NOT EXISTS tournament_matches (id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id INTEGER NOT NULL, round TEXT NOT NULL, group_id INTEGER, bracket_slot TEXT, player1_id INTEGER, player2_id INTEGER, court_id INTEGER, match_date TEXT, match_time TEXT, scores TEXT, winner_id INTEGER, FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE, FOREIGN KEY (group_id) REFERENCES tournament_groups(id), FOREIGN KEY (player1_id) REFERENCES players(id), FOREIGN KEY (player2_id) REFERENCES players(id), FOREIGN KEY (court_id) REFERENCES courts(id), FOREIGN KEY (winner_id) REFERENCES players(id))`,
    `ALTER TABLE tournament_matches ADD COLUMN confirmed_at TEXT`,
    `CREATE TABLE IF NOT EXISTS pickup_matches (id INTEGER PRIMARY KEY AUTOINCREMENT, player1_id INTEGER NOT NULL, player2_id INTEGER NOT NULL, player1_score INTEGER NOT NULL, player2_score INTEGER NOT NULL, winner_id INTEGER NOT NULL, submitted_by_player_id INTEGER, played_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (player1_id) REFERENCES players(id), FOREIGN KEY (player2_id) REFERENCES players(id), FOREIGN KEY (winner_id) REFERENCES players(id), FOREIGN KEY (submitted_by_player_id) REFERENCES players(id))`,
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

  // Purge any tournament_matches whose parent tournament was deleted without cascade
  db.prepare('DELETE FROM tournament_matches WHERE tournament_id NOT IN (SELECT id FROM tournaments)').run();

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
  return { lastID: result.lastInsertRowid, changes: result.changes };
}

function all(sql, params = []) {
  return db.prepare(sql).all(params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(params);
}

module.exports = { initDB, getDB, run, all, get };
