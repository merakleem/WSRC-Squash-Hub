// The ladder replay is remembered until the database changes: a second ask
// for the same ladder does no work, any write forgets everything, a reopened
// connection is never mistaken for the old one, and a caller cannot change
// what the next caller gets.
// Run: node --test test/memo.test.js
const { suite, scratchDb } = require('./lib/suite');

suite('memoised reads', async ({ ok, t }) => {
  const dbm = require('../database/db');
  const file = scratchDb(t, 'memo');
  dbm.initDB(file);
  const { memo, stats, clear } = require('../lib/memo');
  clear();

  console.log('THE CACHE');
  let calls = 0;
  const work = () => { calls++; return [{ id: 1, rating: 1000 }]; };
  const first = memo('k', work);
  const second = memo('k', work);
  ok('the second ask does no work', calls === 1 && JSON.stringify(first) === JSON.stringify(second));
  ok('and is counted as a hit', stats().hits === 1 && stats().misses === 1, JSON.stringify(stats()));
  first[0].rating = 1;
  ok('changing what you got does not change what the next caller gets', memo('k', work)[0].rating === 1000);
  ok('a different key is different work', memo('k2', work).length === 1 && calls === 2);

  console.log('ANY WRITE FORGETS');
  dbm.run("INSERT INTO players (name) VALUES ('Writer')");
  memo('k', work);
  ok('after a write the work runs again', calls === 3, String(calls));
  ok('and the old entries are gone', stats().entries === 1, JSON.stringify(stats()));
  memo('k', work);
  ok('until the next write', calls === 3);
  dbm.run("UPDATE players SET name = 'Rewriter' WHERE name = 'Writer'");
  memo('k', work);
  ok('an update forgets too', calls === 4);
  dbm.run("DELETE FROM players WHERE name = 'Rewriter'");
  memo('k', work);
  ok('so does a delete', calls === 5);

  console.log('A REOPENED DATABASE');
  dbm.initDB(file);
  memo('k', work);
  ok('a reopened connection starts cold, never serving the old connection\'s answer', calls === 6);

  console.log('THE LADDER USES IT');
  const ladder = require('../models/ladderModel');
  const seasons = require('../models/seasonModel');
  dbm.run("INSERT INTO settings (key, value) VALUES ('season_start_md', '01-01')");
  const ids = ['Ann', 'Bo', 'Cy'].map((n) => dbm.run('INSERT INTO players (name, club_locker_rating) VALUES (?, 4)', [n]).lastID);
  const [ann, bo, cy] = ids;
  dbm.run(`INSERT INTO matches (type, status, player1_id, player2_id, player1_score, player2_score, winner_id, played_at, confirmed_at)
           VALUES ('ladder','played',?,?,3,1,?,'2025-06-01','2025-06-01'),('ladder','played',?,?,3,0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [ann, bo, ann, bo, cy, bo]);
  const season = seasons.getCurrentSeason();
  const settings = seasons.getSettings();
  const before = stats();
  const rows1 = ladder.computeEloLadder(season.key, settings);
  const rows2 = ladder.computeEloLadder(season.key, settings);
  ok('the second ladder ask is a hit', stats().hits === before.hits + 1 && JSON.stringify(rows1) === JSON.stringify(rows2), JSON.stringify(stats()));
  rows1[0].rating = -1;
  ok('and the cached ladder is untouched by a caller', ladder.computeEloLadder(season.key, settings)[0].rating > 0);
  dbm.run(`INSERT INTO matches (type, status, player1_id, player2_id, player1_score, player2_score, winner_id, played_at, confirmed_at)
           VALUES ('ladder','played',?,?,3,2,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [cy, ann, cy]);
  const after = ladder.computeEloLadder(season.key, settings);
  ok('a new match shows at once', JSON.stringify(after.map((r) => r.id)) !== JSON.stringify(rows2.map((r) => r.id)) || after.some((r, i) => r.rating !== rows2[i].rating));
});
