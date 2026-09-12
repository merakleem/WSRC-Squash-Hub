// ===== SCHEMA MIGRATIONS =====
// Every change to an existing database, in the order it was made. Each entry
// runs at most once: the `schema_migrations` table records which ids have been
// applied, and the runner skips those. A migration that throws stops the boot
// - the server refuses to start rather than run against a schema it does not
// understand. That is the whole point: a deploy either brings the database
// with it or fails loudly, never "boots fine, throws at query time".
//
// Rules for adding one:
//   - append to the end with the next id; never renumber or edit an applied one
//   - use the helpers (addColumn, createTable, ...) so a migration is safe to
//     run against a database that already has the change. Databases from before
//     this file existed carry every change below but no record of it, and
//     their first boot replays the whole list to build that record.
//   - a migration that needs foreign keys off (table rebuilds) says so; the
//     runner toggles the pragma around the transaction, since SQLite ignores a
//     foreign_keys change while a transaction is open.
//   - schema.sql is the shape of a brand-new database and is never edited for
//     a change to an existing one. Fresh installs run schema.sql, then every
//     migration here (each a no-op where schema.sql already agrees).

const crypto = require('crypto');

function helpers(db) {
  const hasTable = (name) =>
    !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
  const columns = (table) => db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
  const hasColumn = (table, column) => columns(table).includes(column);
  const addColumn = (table, column, definition) => {
    if (hasColumn(table, column)) return false;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  };
  const createTable = (sql) => db.exec(sql.replace(/^\s*CREATE TABLE (?!IF NOT EXISTS)/i, 'CREATE TABLE IF NOT EXISTS '));
  const createIndex = (sql) => db.exec(sql.replace(/^\s*CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i, 'CREATE $1INDEX IF NOT EXISTS '));
  return { hasTable, columns, hasColumn, addColumn, createTable, createIndex };
}

const MIGRATIONS = [
  {
    id: 1, name: 'league scheduling columns',
    up: (db, h) => {
      h.addColumn('leagues', 'num_rounds', `INTEGER NOT NULL DEFAULT 1`);
      h.addColumn('leagues', 'blackout_dates', `TEXT NOT NULL DEFAULT '[]'`);
      h.addColumn('leagues', 'match_start_time', `TEXT NOT NULL DEFAULT '19:00'`);
      h.addColumn('leagues', 'num_courts', `INTEGER NOT NULL DEFAULT 2`);
      h.addColumn('leagues', 'match_duration', `INTEGER NOT NULL DEFAULT 45`);
      h.addColumn('leagues', 'match_buffer', `INTEGER NOT NULL DEFAULT 15`);
      h.addColumn('leagues', 'schedule_courts', `INTEGER NOT NULL DEFAULT 0`);
    },
  },
  {
    id: 2, name: 'player membership and rating columns',
    up: (db, h) => {
      // wsrc_member is a legacy column nothing reads; kept so old rows stay valid.
      h.addColumn('players', 'wsrc_member', `INTEGER NOT NULL DEFAULT 1`);
      h.addColumn('players', 'club_locker_rating', `REAL`);
      h.addColumn('players', 'member_number', `TEXT`);
    },
  },
  {
    id: 3, name: 'match court and time',
    // Only the original matches table (no `type` column) takes these. The
    // consolidated table of migration 22 carries court_number itself and
    // schedules with scheduled_time; the boot loop this runner replaced used
    // to add a stray match_time to it on every start, which is why a database
    // from before this runner has one and a fresh one does not. Nothing reads
    // it there, and it is left alone where it already exists.
    up: (db, h) => {
      if (h.hasColumn('matches', 'type')) return;
      h.addColumn('matches', 'court_number', `INTEGER`);
      h.addColumn('matches', 'match_time', `TEXT`);
    },
  },
  {
    id: 4, name: 'league grouped schedule and public token',
    up: (db, h) => {
      h.addColumn('leagues', 'schedule_grouped', `INTEGER NOT NULL DEFAULT 0`);
      h.addColumn('leagues', 'public_token', `TEXT`);
    },
  },
  {
    id: 5, name: 'skipped matches',
    up: (db, h) => { h.addColumn('matches', 'skipped', `INTEGER NOT NULL DEFAULT 0`); },
  },
  {
    id: 6, name: 'user accounts',
    up: (db, h) => {
      h.createTable(`CREATE TABLE user_accounts (player_id INTEGER PRIMARY KEY, password_hash TEXT, invite_token TEXT, invite_expires TEXT, reset_token TEXT, reset_expires TEXT, FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE)`);
    },
  },
  {
    id: 7, name: 'league setup type',
    up: (db, h) => { h.addColumn('leagues', 'setup_type', `TEXT NOT NULL DEFAULT 'traditional'`); },
  },
  {
    id: 8, name: 'players excluded from the ladder',
    up: (db, h) => { h.addColumn('players', 'exclude_from_ladder', `INTEGER NOT NULL DEFAULT 0`); },
  },
  {
    id: 9, name: 'matchups know their division',
    up: (db, h) => { h.addColumn('team_matchups', 'division_id', `INTEGER`); },
  },
  {
    id: 10, name: 'week byes',
    up: (db, h) => {
      h.createTable(`CREATE TABLE week_byes (id INTEGER PRIMARY KEY AUTOINCREMENT, week_id INTEGER NOT NULL, player_id INTEGER NOT NULL, division_id INTEGER NOT NULL, FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE, FOREIGN KEY (player_id) REFERENCES players(id), FOREIGN KEY (division_id) REFERENCES divisions(id))`);
    },
  },
  {
    id: 11, name: 'who confirmed a match and when',
    up: (db, h) => {
      h.addColumn('matches', 'confirmed_at', `TEXT`);
      h.addColumn('matches', 'submitted_by_player_id', `INTEGER`);
    },
  },
  {
    id: 12, name: 'courts, booking types and bookings',
    up: (db, h) => {
      h.createTable(`CREATE TABLE courts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)`);
      h.createTable(`CREATE TABLE booking_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6b7589')`);
      h.createTable(`CREATE TABLE bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, court_id INTEGER NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 60, booking_type_id INTEGER, info TEXT, FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE, FOREIGN KEY (booking_type_id) REFERENCES booking_types(id) ON DELETE SET NULL)`);
      h.createTable(`CREATE TABLE league_courts (league_id INTEGER NOT NULL, court_id INTEGER NOT NULL, PRIMARY KEY (league_id, court_id), FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE, FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE)`);
      h.addColumn('matches', 'court_id', `INTEGER`);
      h.addColumn('bookings', 'group_id', `INTEGER`);
      h.addColumn('bookings', 'name', `TEXT`);
      h.addColumn('bookings', 'repeat_group_id', `INTEGER`);
      // Who made a booking decides who may change it. NULL is the club (admin).
      h.addColumn('bookings', 'booked_by', `INTEGER`);
      h.createTable(`CREATE TABLE booking_players (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, player_id INTEGER NOT NULL, FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE, FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE)`);
    },
  },
  {
    id: 13, name: 'tournaments',
    up: (db, h) => {
      h.createTable(`CREATE TABLE tournaments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'groups_16', status TEXT NOT NULL DEFAULT 'group_stage', championship_date TEXT NOT NULL, match_duration_minutes INTEGER NOT NULL DEFAULT 60, buffer_minutes INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      h.createTable(`CREATE TABLE tournament_courts (tournament_id INTEGER NOT NULL, court_id INTEGER NOT NULL, PRIMARY KEY (tournament_id, court_id), FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE, FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE)`);
      h.createTable(`CREATE TABLE tournament_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id INTEGER NOT NULL, name TEXT NOT NULL, FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE)`);
      h.createTable(`CREATE TABLE tournament_players (id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id INTEGER NOT NULL, player_id INTEGER NOT NULL, group_id INTEGER, seed INTEGER, FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE, FOREIGN KEY (player_id) REFERENCES players(id), FOREIGN KEY (group_id) REFERENCES tournament_groups(id))`);
    },
  },
  {
    id: 14, name: 'one account per email',
    up: (db, h) => {
      h.createIndex(`CREATE UNIQUE INDEX idx_players_email ON players (LOWER(email)) WHERE email IS NOT NULL AND email != ''`);
    },
  },
  {
    id: 15, name: 'tester and member flags',
    up: (db, h) => {
      h.addColumn('players', 'is_tester', `INTEGER NOT NULL DEFAULT 0`);
      h.addColumn('players', 'is_member', `INTEGER NOT NULL DEFAULT 0`);
    },
  },
  {
    id: 16, name: 'settings',
    up: (db, h) => { h.createTable(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`); },
  },
  {
    id: 17, name: 'player photos',
    up: (db, h) => { h.addColumn('players', 'photo_path', `TEXT`); },
  },
  {
    id: 18, name: 'seasons',
    up: (db, h) => {
      h.createTable(`CREATE TABLE seasons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      // Seasons are assigned explicitly rather than inferred from dates: a league
      // can straddle a boundary, and admin intent should win over inference.
      h.addColumn('leagues', 'season_id', `INTEGER REFERENCES seasons(id)`);
      h.addColumn('tournaments', 'season_id', `INTEGER REFERENCES seasons(id)`);
      // Which ranking system a season is played under. Held per season so past
      // ladders are always rendered by the rules they were actually played under,
      // and so switching systems never disturbs a season already in progress.
      h.addColumn('seasons', 'ladder_system', `TEXT NOT NULL DEFAULT 'leapfrog'`);
      h.addColumn('seasons', 'status', `TEXT NOT NULL DEFAULT 'active'`);
      h.addColumn('seasons', 'ended_at', `TEXT`);
      // Frozen final standings. Once a season is ended these are served verbatim,
      // so a late-reported score can never move a past ladder.
      h.createTable(`CREATE TABLE season_standings (
         season_id INTEGER NOT NULL,
         player_id INTEGER NOT NULL,
         position INTEGER NOT NULL,
         rating REAL,
         wins INTEGER NOT NULL DEFAULT 0,
         losses INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (season_id, player_id),
         FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
         FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
       )`);
    },
  },
  {
    id: 19, name: 'events and signups',
    up: (db, h) => {
      // Events: club happenings players sign up for, optionally pointing at a
      // league or tournament so registration has one front door.
      h.createTable(`CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', event_date TEXT NOT NULL, start_time TEXT, guests_allowed INTEGER NOT NULL DEFAULT 0, max_people INTEGER, league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL, tournament_id INTEGER REFERENCES tournaments(id) ON DELETE SET NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      h.addColumn('events', 'end_time', `TEXT`);
      h.addColumn('events', 'members_only', `INTEGER NOT NULL DEFAULT 0`);
      h.createTable(`CREATE TABLE event_signups (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, guests INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(event_id, player_id))`);
    },
  },
  {
    id: 20, name: 'record the booker of older player bookings',
    // Player bookings made before booked_by existed carry no record of who made
    // them, but they are the only bookings with no type whose name is one of
    // the players on them - the player page wrote its booker's name there. The
    // admin's form never writes a name, so nothing newer can match.
    up: (db) => {
      db.prepare(`
        UPDATE bookings SET booked_by = (
          SELECT bp.player_id FROM booking_players bp JOIN players p ON p.id = bp.player_id
          WHERE bp.booking_id = bookings.id AND p.name = bookings.name
          ORDER BY bp.id ASC LIMIT 1)
        WHERE booked_by IS NULL AND booking_type_id IS NULL AND name IS NOT NULL
      `).run();
    },
  },
  {
    id: 21, name: 'league players may have no team',
    // Modern leagues have divisions but no teams. SQLite cannot drop NOT NULL,
    // so the table is rebuilt; SELECT * relies on the column order matching.
    foreignKeysOff: true,
    up: (db) => {
      const teamIdCol = db.prepare(`PRAGMA table_info(league_players)`).all().find((c) => c.name === 'team_id');
      if (!teamIdCol || teamIdCol.notnull !== 1) return;
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
    },
  },
  {
    id: 22, name: 'one matches table',
    // League, ladder and tournament matches used to live in three tables with
    // three shapes, and every feature that asked "what matches exist?" unioned
    // them itself, with its own filters. Those hand-rolled unions disagreed:
    // a player's record and their match history could return different counts
    // for the same match. This folds all three into `matches`, which becomes the
    // single source of truth; a league now just produces rows in it.
    //
    // League ids are preserved exactly, because match_subs rows and the schedule
    // grid address them. Ladder and tournament rows are appended with new ids;
    // nothing stored refers to those. Plain copies of the old tables are kept
    // as *_legacy rather than dropped: this is the club's whole history.
    foreignKeysOff: true,
    up: (db, h) => {
      if (h.hasColumn('matches', 'type')) return;
      db.exec(`CREATE TABLE IF NOT EXISTS matches_legacy AS SELECT * FROM matches;`);
      if (h.hasTable('tournament_matches')) {
        db.exec(`CREATE TABLE IF NOT EXISTS tournament_matches_legacy AS SELECT * FROM tournament_matches;`);
      }
      if (h.hasTable('pickup_matches')) {
        db.exec(`CREATE TABLE IF NOT EXISTS pickup_matches_legacy AS SELECT * FROM pickup_matches;`);
      }
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
      if (h.hasTable('pickup_matches')) db.exec(`
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
      if (h.hasTable('tournament_matches')) db.exec(`
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
      if (h.hasTable('tournament_matches')) db.exec(`DROP TABLE tournament_matches;`);
      if (h.hasTable('pickup_matches'))     db.exec(`DROP TABLE pickup_matches;`);
    },
  },
  {
    id: 23, name: 'doubles',
    // A doubles match is a row in the same table: `format` says so, and the two
    // partner columns complete the sides (side 1 is player1 + player1_partner,
    // side 2 is player2 + player2_partner). One column is what keeps every
    // singles reader honest - the shared "counts" predicate excludes doubles -
    // where a second table would have let a doubles league night move the
    // singles ratings of the two pair leaders.
    up: (db, h) => {
      h.addColumn('matches', 'format', `TEXT NOT NULL DEFAULT 'singles'`);
      h.addColumn('matches', 'player1_partner_id', `INTEGER`);
      h.addColumn('matches', 'player2_partner_id', `INTEGER`);
      h.addColumn('matches', 'pair1_id', `INTEGER`);
      h.addColumn('matches', 'pair2_id', `INTEGER`);
      h.addColumn('week_byes', 'pair_id', `INTEGER`);
      h.createTable(`CREATE TABLE league_pairs (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         league_id INTEGER NOT NULL,
         division_id INTEGER NOT NULL,
         player1_id INTEGER NOT NULL,
         player2_id INTEGER NOT NULL,
         skill_rank INTEGER NOT NULL,
         FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
         FOREIGN KEY (division_id) REFERENCES divisions(id),
         FOREIGN KEY (player1_id) REFERENCES players(id),
         FOREIGN KEY (player2_id) REFERENCES players(id)
       )`);
    },
  },
  {
    id: 24, name: 'match indexes',
    up: (db) => {
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
        CREATE INDEX IF NOT EXISTS idx_matches_format      ON matches (format);
        CREATE INDEX IF NOT EXISTS idx_league_pairs_league ON league_pairs (league_id);
      `);
    },
  },
  {
    id: 25, name: 'drop tournament matches whose tournament is gone',
    // From before the tournament foreign key cascaded.
    up: (db) => {
      db.prepare(`DELETE FROM matches WHERE type = 'tournament' AND tournament_id NOT IN (SELECT id FROM tournaments)`).run();
    },
  },
  {
    id: 26, name: 'every league has a 4-character public token',
    // New leagues get one at creation (leagueModel.createLeagueRecord); this
    // fills in the ones from before.
    up: (db) => {
      const leaguesNeedingToken = db.prepare(`SELECT id FROM leagues WHERE public_token IS NULL OR length(public_token) != 4`).all();
      for (const league of leaguesNeedingToken) {
        db.prepare(`UPDATE leagues SET public_token = ? WHERE id = ?`).run(crypto.randomBytes(2).toString('hex'), league.id);
      }
    },
  },
];

/**
 * Bring `db` up to date. Returns the ids applied on this run (empty when the
 * database was already current). Throws on the first failure, leaving that
 * migration rolled back and unrecorded, so the next boot retries it.
 */
function runMigrations(db, { log = () => {} } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const seen = new Set();
  for (const m of MIGRATIONS) {
    if (!Number.isInteger(m.id) || m.id < 1 || seen.has(m.id)) throw new Error(`[migration] bad id ${m.id} (${m.name})`);
    seen.add(m.id);
  }
  const applied = new Set(db.prepare(`SELECT id FROM schema_migrations`).all().map((r) => r.id));
  const h = helpers(db);
  const record = db.prepare(`INSERT INTO schema_migrations (id, name) VALUES (?, ?)`);
  const done = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const started = Date.now();
    if (m.foreignKeysOff) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        m.up(db, h);
        record.run(m.id, m.name);
      })();
    } catch (err) {
      err.message = `[migration ${m.id}: ${m.name}] ${err.message}`;
      throw err;
    } finally {
      if (m.foreignKeysOff) db.pragma('foreign_keys = ON');
    }
    done.push(m.id);
    log({ id: m.id, name: m.name, ms: Date.now() - started });
  }
  return done;
}

/** The highest migration id this code knows about. */
const LATEST = MIGRATIONS[MIGRATIONS.length - 1].id;

/** The highest migration id recorded in `db`, or 0. */
function currentVersion(db) {
  try {
    return db.prepare(`SELECT COALESCE(MAX(id), 0) AS v FROM schema_migrations`).get().v;
  } catch (_) {
    return 0;
  }
}

module.exports = { MIGRATIONS, LATEST, runMigrations, currentVersion };
