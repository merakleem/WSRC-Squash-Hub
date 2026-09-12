// The schema migration runner: every change is numbered and recorded, runs
// once, is safe to replay against a database that already has it (which is
// what the first boot after this runner was added does), and a failure stops
// the boot with nothing half-applied.
// Run: node --test test/migrations.test.js
const { suite, scratchDb } = require('./lib/suite');
const { MIGRATIONS, LATEST, runMigrations, currentVersion } = require('../database/migrations');

const schemaOf = (db) => db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY type, name`).all()
  .map((r) => `${r.type} ${r.name}: ${(r.sql || '').replace(/\s+/g, ' ')}`).join('\n');

suite('schema migrations', async ({ ok, t }) => {
  const dbm = require('../database/db');
  const applied = [];
  dbm.initDB(scratchDb(t, 'migrations'), { log: (m) => applied.push(m.id) });
  const db = dbm.getDB();

  console.log('A FRESH DATABASE');
  ok('ids are 1..N with no gaps or repeats', MIGRATIONS.map((m) => m.id).join() === MIGRATIONS.map((_, i) => i + 1).join());
  ok('every migration has a name', MIGRATIONS.every((m) => typeof m.name === 'string' && m.name.length > 3));
  ok('a fresh database receives every migration, in order', applied.join() === MIGRATIONS.map((m) => m.id).join(), applied.join());
  ok('and records them', currentVersion(db) === LATEST && db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n === LATEST);
  ok('with a timestamp on each', db.prepare(`SELECT COUNT(*) AS n FROM schema_migrations WHERE applied_at LIKE '20__-__-__T%'`).get().n === LATEST);
  ok('the connection is in WAL mode', db.pragma('journal_mode', { simple: true }) === 'wal');
  ok('with a busy timeout, so a second writer waits instead of failing', db.pragma('busy_timeout', { simple: true }) === 5000, String(db.pragma('busy_timeout', { simple: true })));
  ok('and foreign keys on', db.pragma('foreign_keys', { simple: true }) === 1);
  ok('schemaStatus reports current', JSON.stringify(dbm.schemaStatus()) === JSON.stringify({ version: LATEST, latest: LATEST }));

  console.log('A SECOND BOOT');
  ok('applies nothing', runMigrations(db).length === 0);

  console.log('A DATABASE FROM BEFORE THE RUNNER EXISTED');
  // Production has every change but no record of them. Forgetting the record
  // and replaying must change nothing but the record.
  const before = schemaOf(db);
  db.prepare("INSERT INTO players (name) VALUES ('Kept Player')").run();
  db.prepare('DELETE FROM schema_migrations').run();
  const replayed = runMigrations(db);
  ok('every migration replays', replayed.length === LATEST, String(replayed.length));
  ok('and the schema is byte-for-byte what it was', schemaOf(db) === before);
  ok('with the data still there', db.prepare('SELECT COUNT(*) AS n FROM players').get().n === 1);
  ok('and the record rebuilt', currentVersion(db) === LATEST);

  console.log('A MIGRATION THAT FAILS');
  MIGRATIONS.push({ id: LATEST + 1, name: 'broken on purpose', up: (d) => { d.exec('CREATE TABLE half_done (x)'); d.exec('ALTER TABLE no_such_table ADD COLUMN y INTEGER'); } });
  let threw = null;
  try { runMigrations(db); } catch (err) { threw = err; }
  MIGRATIONS.pop();
  ok('throws, naming the migration', threw && /\[migration 27: broken on purpose\]/.test(threw.message), threw?.message);
  ok('its first statement is rolled back', !db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'half_done'").get());
  ok('and it is not recorded, so the next boot retries it', currentVersion(db) === LATEST);
  ok('foreign keys are back on afterwards', db.pragma('foreign_keys', { simple: true }) === 1);

  console.log('ONE-TIME DATA FIXES RUN ONCE');
  const booker = MIGRATIONS.find((m) => m.id === 20);
  ok('the booking backfill is a numbered migration', /booker/.test(booker.name));
  db.prepare("INSERT INTO courts (name, sort_order) VALUES ('C1', 1)").run();
  db.prepare("INSERT INTO bookings (court_id, date, start_time, name) VALUES (1, '2031-01-01', '10:00', 'Kept Player')").run();
  db.prepare('INSERT INTO booking_players (booking_id, player_id) VALUES (1, 1)').run();
  runMigrations(db);
  ok('so a matching row inserted afterwards is not touched by a later boot', db.prepare('SELECT booked_by FROM bookings WHERE id = 1').get().booked_by === null);
});
