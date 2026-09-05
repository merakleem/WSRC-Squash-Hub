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
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email ON players (LOWER(email)) WHERE email IS NOT NULL AND email != ''`,
    `ALTER TABLE players ADD COLUMN is_tester INTEGER NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
    `ALTER TABLE players ADD COLUMN photo_path TEXT`,
    `CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    // Seasons are assigned explicitly rather than inferred from dates: a league
    // can straddle a boundary, and admin intent should win over inference.
    `ALTER TABLE leagues ADD COLUMN season_id INTEGER REFERENCES seasons(id)`,
    `ALTER TABLE tournaments ADD COLUMN season_id INTEGER REFERENCES seasons(id)`,
    // Which ranking system a season is played under. Held per season so past
    // ladders are always rendered by the rules they were actually played under,
    // and so switching systems never disturbs a season already in progress.
    `ALTER TABLE seasons ADD COLUMN ladder_system TEXT NOT NULL DEFAULT 'leapfrog'`,
    `ALTER TABLE seasons ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE seasons ADD COLUMN ended_at TEXT`,
    // Frozen final standings. Once a season is ended these are served verbatim,
    // so a late-reported score can never move a past ladder.
    `CREATE TABLE IF NOT EXISTS season_standings (
       season_id INTEGER NOT NULL,
       player_id INTEGER NOT NULL,
       position INTEGER NOT NULL,
       rating REAL,
       wins INTEGER NOT NULL DEFAULT 0,
       losses INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (season_id, player_id),
       FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
       FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
     )`,
    // Events: club happenings players sign up for, optionally pointing at a
    // league or tournament so registration has one front door.
    `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', event_date TEXT NOT NULL, start_time TEXT, guests_allowed INTEGER NOT NULL DEFAULT 0, max_people INTEGER, league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL, tournament_id INTEGER REFERENCES tournaments(id) ON DELETE SET NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS event_signups (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, guests INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(event_id, player_id))`,
  ];

  for (const sql of migrations) {
    try {
      db.prepare(sql).run();
    } catch (err) {
      // "duplicate column name" just means the migration already ran; expected.
      // Anything else is a real failure and must not pass silently, or the app
      // boots looking healthy and then throws at query time.
      if (!/duplicate column name/i.test(err.message)) {
        console.error(`[migration] FAILED: ${sql}\n           ${err.message}`);
      }
    }
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

  // ===== ONE MATCHES TABLE =====
  // League, ladder and tournament matches used to live in three tables with
  // three shapes, and every feature that asked "what matches exist?" unioned
  // them itself, with its own filters. Those hand-rolled unions disagreed:
  // a player's record and their match history could return different counts
  // for the same match. This folds all three into `matches`, which becomes the
  // single source of truth; a league now just produces rows in it.
  //
  // League ids are preserved exactly, because match_subs rows and the schedule
  // grid address them. Ladder and tournament rows are appended with new ids;
  // nothing stored refers to those.
  const hasTable = (name) =>
    !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);

  const matchCols = db.prepare(`PRAGMA table_info(matches)`).all().map((c) => c.name);
  if (!matchCols.includes('type')) {
    // Plain copies, no constraints, as a rollback path. Kept rather than
    // dropped: this is the club's whole competitive history.
    db.exec(`CREATE TABLE IF NOT EXISTS matches_legacy AS SELECT * FROM matches;`);
    if (hasTable('tournament_matches')) {
      db.exec(`CREATE TABLE IF NOT EXISTS tournament_matches_legacy AS SELECT * FROM tournament_matches;`);
    }
    if (hasTable('pickup_matches')) {
      db.exec(`CREATE TABLE IF NOT EXISTS pickup_matches_legacy AS SELECT * FROM pickup_matches;`);
    }

    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE matches_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        -- what kind of match, and where it is in its life
        type   TEXT NOT NULL DEFAULT 'league',      -- league | ladder | tournament
        status TEXT NOT NULL DEFAULT 'unscheduled', -- unscheduled | scheduled | played

        -- who played. Nullable: a tournament bracket holds slots before it
        -- knows who fills them.
        player1_id INTEGER,
        player2_id INTEGER,

        -- games won, plus the per-game detail tournaments record
        player1_score INTEGER,
        player2_score INTEGER,
        scores TEXT,
        winner_id INTEGER,

        -- when it is due to be played, and where
        scheduled_date TEXT,
        scheduled_time TEXT,
        court_id INTEGER,
        court_number INTEGER,

        -- when it was actually played, and who reported it. played_at is the
        -- editable truth; confirmed_at records when the score was entered.
        played_at TEXT,
        confirmed_at TEXT,
        submitted_by_player_id INTEGER,

        -- league context
        league_id INTEGER,
        week_id INTEGER,
        matchup_id INTEGER,
        division_id INTEGER,

        -- tournament context
        tournament_id INTEGER,
        round TEXT,
        bracket_slot TEXT,
        tournament_group_id INTEGER,

        skipped INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (player1_id)   REFERENCES players(id),
        FOREIGN KEY (player2_id)   REFERENCES players(id),
        FOREIGN KEY (winner_id)    REFERENCES players(id),
        FOREIGN KEY (court_id)     REFERENCES courts(id),
        FOREIGN KEY (matchup_id)   REFERENCES team_matchups(id) ON DELETE CASCADE,
        FOREIGN KEY (division_id)  REFERENCES divisions(id),
        FOREIGN KEY (week_id)      REFERENCES weeks(id) ON DELETE CASCADE,
        FOREIGN KEY (league_id)    REFERENCES leagues(id) ON DELETE CASCADE,
        FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
      );
    `);

    // --- league rows, ids preserved -------------------------------------
    // status: scored means played; otherwise it is scheduled only once it has
    // a court and a time, which is exactly what puts it on the live schedule.
    // played_at reproduces what every query already computed for a league
    // match's date: its confirmation time, falling back to the week's date.
    db.exec(`
      INSERT INTO matches_new (
        id, type, status, player1_id, player2_id, player1_score, player2_score, winner_id,
        scheduled_date, scheduled_time, court_id, court_number,
        played_at, confirmed_at, submitted_by_player_id,
        league_id, week_id, matchup_id, division_id, skipped
      )
      SELECT m.id, 'league',
        CASE WHEN m.player1_score IS NOT NULL THEN 'played'
             WHEN m.court_id IS NOT NULL AND m.match_time IS NOT NULL THEN 'scheduled'
             ELSE 'unscheduled' END,
        m.player1_id, m.player2_id, m.player1_score, m.player2_score, m.winner_id,
        w.date, m.match_time, m.court_id, m.court_number,
        CASE WHEN m.player1_score IS NOT NULL THEN COALESCE(m.confirmed_at, w.date) END,
        m.confirmed_at, m.submitted_by_player_id,
        w.league_id, tm.week_id, m.matchup_id, m.division_id, COALESCE(m.skipped, 0)
      FROM matches m
      JOIN team_matchups tm ON tm.id = m.matchup_id
      JOIN weeks w          ON w.id  = tm.week_id;
    `);

    // --- ladder rows ------------------------------------------------------
    // A ladder match is only ever recorded after it has been played.
    if (hasTable('pickup_matches')) db.exec(`
      INSERT INTO matches_new (
        type, status, player1_id, player2_id, player1_score, player2_score, winner_id,
        played_at, confirmed_at, submitted_by_player_id
      )
      SELECT 'ladder', 'played', player1_id, player2_id, player1_score, player2_score, winner_id,
        played_at, played_at, submitted_by_player_id
      FROM pickup_matches ORDER BY id;
    `);

    // --- tournament rows --------------------------------------------------
    // Tournaments keep their per-game text in `scores`; a winner is what marks
    // one as played.
    if (hasTable('tournament_matches')) db.exec(`
      INSERT INTO matches_new (
        type, status, player1_id, player2_id, scores, winner_id,
        scheduled_date, scheduled_time, court_id, played_at, confirmed_at,
        tournament_id, round, bracket_slot, tournament_group_id
      )
      SELECT 'tournament',
        CASE WHEN winner_id IS NOT NULL THEN 'played'
             WHEN court_id IS NOT NULL AND match_time IS NOT NULL THEN 'scheduled'
             ELSE 'unscheduled' END,
        player1_id, player2_id, scores, winner_id,
        match_date, match_time, court_id,
        CASE WHEN winner_id IS NOT NULL THEN COALESCE(confirmed_at, match_date) END,
        confirmed_at, tournament_id, round, bracket_slot, group_id
      FROM tournament_matches ORDER BY id;
    `);

    db.exec(`DROP TABLE matches; ALTER TABLE matches_new RENAME TO matches;`);
    if (hasTable('tournament_matches')) db.exec(`DROP TABLE tournament_matches;`);
    if (hasTable('pickup_matches'))     db.exec(`DROP TABLE pickup_matches;`);
    db.pragma('foreign_keys = ON');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_matches_type_status ON matches (type, status);
    CREATE INDEX IF NOT EXISTS idx_matches_p1          ON matches (player1_id);
    CREATE INDEX IF NOT EXISTS idx_matches_p2          ON matches (player2_id);
    CREATE INDEX IF NOT EXISTS idx_matches_played_at   ON matches (played_at);
    CREATE INDEX IF NOT EXISTS idx_matches_scheduled   ON matches (scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_matches_matchup     ON matches (matchup_id);
    CREATE INDEX IF NOT EXISTS idx_matches_week        ON matches (week_id);
    CREATE INDEX IF NOT EXISTS idx_matches_league      ON matches (league_id);
    CREATE INDEX IF NOT EXISTS idx_matches_tournament  ON matches (tournament_id);
  `);

  // Purge any tournament_matches whose parent tournament was deleted without cascade
  db.prepare(`DELETE FROM matches WHERE type = 'tournament' AND tournament_id NOT IN (SELECT id FROM tournaments)`).run();

  // Backfill/regenerate tokens to ensure they are 4-char hex
  const leaguesNeedingToken = db.prepare(`SELECT id FROM leagues WHERE public_token IS NULL OR length(public_token) != 4`).all();
  for (const league of leaguesNeedingToken) {
    db.prepare(`UPDATE leagues SET public_token = ? WHERE id = ?`).run(crypto.randomBytes(2).toString('hex'), league.id);
  }


  return Promise.resolve(db);
}

/**
 * One-time seed: create the first two seasons and file all pre-existing data
 * under the earlier one.
 *
 * Guarded on the seasons table being empty, so it runs once and is a no-op on
 * every subsequent boot. Dates are starting points only; an admin edits them
 * in Club Settings, and nothing here overwrites their changes.
 */

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
