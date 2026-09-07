// How the rating ladder is seeded: results rank you, and a Club Locker rating
// only orders the players who have no results yet.
// Run: node test/ladder-seeding.test.js
const fs = require('fs');
const path = '/tmp/ladder-seeding-test.db';
try { fs.unlinkSync(path); } catch (_) {}
process.env.CLUB_TIMEZONE = 'America/Winnipeg';

const dbm = require('../database/db');
dbm.initDB(path);
const db = dbm.getDB();
const elo = require('../lib/elo');
const ladder = require('../models/ladderModel');
const seasonModel = require('../models/seasonModel');

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };
const set = (o) => {
  for (const [k, v] of Object.entries(o)) {
    db.prepare(`INSERT INTO settings (key,value) VALUES (?,?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, String(v));
  }
};

console.log('SEEDING RULES');
const cfg = elo.config({});
const seed = (o) => elo.seedRating({ previousRating: null, previousPosition: null, ladderSize: 0, ...o }, cfg);

ok('a rating carried from a rated season is used as is',
  seed({ previousRating: 1234, previousPosition: 3, ladderSize: 10 }) === 1234);
ok('a finisher is spread across the seed range: first gets the top',
  seed({ previousPosition: 1, ladderSize: 10 }) === cfg.elo_seed_top);
ok('and last gets the bottom',
  seed({ previousPosition: 10, ladderSize: 10 }) === cfg.elo_seed_bottom);
ok('a player with no matches starts at the unplayed base',
  seed({ unplayed: true, ratingShare: 0 }) === cfg.elo_unplayed_base, String(seed({ unplayed: true, ratingShare: 0 })));
ok('the club\'s highest rating earns the whole adjustment',
  seed({ unplayed: true, ratingShare: 1 }) === cfg.elo_unplayed_base + cfg.elo_unplayed_rating_bonus,
  String(seed({ unplayed: true, ratingShare: 1 })));
ok('and a middling rating earns half of it',
  seed({ unplayed: true, ratingShare: 0.5 }) === cfg.elo_unplayed_base + cfg.elo_unplayed_rating_bonus / 2);
ok('an unrated newcomer gets none of it',
  seed({ unplayed: true, ratingShare: null }) === cfg.elo_unplayed_base);
ok('having played always beats having a rating: the last finisher outranks the best newcomer',
  seed({ previousPosition: 10, ladderSize: 10 }) >= seed({ unplayed: true, ratingShare: 1 }) - cfg.elo_unplayed_rating_bonus,
  `${seed({ previousPosition: 10, ladderSize: 10 })} vs ${seed({ unplayed: true, ratingShare: 1 })}`);
ok('a position cannot lift someone who has not played',
  seed({ previousPosition: 1, ladderSize: 10, unplayed: true, ratingShare: 0 }) === cfg.elo_unplayed_base);

console.log('\nNO ADJUSTMENT PERIOD LEFT');
ok('a match is a plain zero-sum exchange', (() => {
  const r = elo.applyMatch(1000, 1000, cfg.elo_k_factor);
  return Math.abs((r.winner - 1000) - (1000 - r.loser)) < 1e-9;
})());
ok('beating someone far above you still pays more than beating an equal',
  elo.ratingDelta(1000, 1300, cfg.elo_k_factor) > elo.ratingDelta(1000, 1000, cfg.elo_k_factor),
  `${elo.ratingDelta(1000, 1300, cfg.elo_k_factor).toFixed(1)} vs ${elo.ratingDelta(1000, 1000, cfg.elo_k_factor).toFixed(1)}`);
ok('and losing to them still costs less',
  elo.ratingDelta(1300, 1000, cfg.elo_k_factor) < elo.ratingDelta(1000, 1000, cfg.elo_k_factor));

console.log('\nBOTH NUMBERS ARE SETTINGS');
ok('the base is overridable', elo.config({ elo_unplayed_base: '900' }).elo_unplayed_base === 900);
ok('the adjustment is overridable', elo.config({ elo_unplayed_rating_bonus: '120' }).elo_unplayed_rating_bonus === 120);
ok('a blank falls back to the default', elo.config({ elo_unplayed_base: '' }).elo_unplayed_base === 800);

console.log('\nON A LADDER');
set({ season_start_md: '09-01' });
const add = (id, name, rating, created) =>
  db.prepare('INSERT INTO players (id,name,club_locker_rating,created_at) VALUES (?,?,?,?)')
    .run(id, name, rating, `${created} 12:00:00`);
const match = (w, l, on) =>
  db.prepare(`INSERT INTO matches (type,status,player1_id,player2_id,player1_score,player2_score,winner_id,played_at)
              VALUES ('ladder','played',?,?,3,1,?,?)`).run(w, l, w, `${on} 19:00:00`);

// Three who play a season, and three who never have - including one rated well
// above everybody.
add(1, 'Ann Anchor', 4.5, '2025-09-02');
add(2, 'Ben Battler', 4.2, '2025-09-02');
add(3, 'Cal Climber', 4.0, '2025-09-02');
for (const day of ['10-02', '10-09', '10-16', '11-06', '11-13']) {
  match(1, 2, `2025-${day}`);
  match(3, 2, `2025-${day}`);
}
add(4, 'Nia Newcomer', 4.3, '2026-08-20');
add(5, 'Hugh Highrated', 5.2, '2026-08-20');
add(6, 'Una Unrated', null, '2026-08-20');

const board = () => ladder.computeEloLadder(seasonModel.getCurrentSeasonKey(), seasonModel.getSettings());
const ratingOf = (n) => board().find((r) => r.name === n)?.rating;
const posOf = (n) => board().findIndex((r) => r.name === n) + 1;
const names = () => board().map((r) => r.name).join(' > ');

ok('everyone who won a match is above everyone who has not played',
  Math.max(posOf('Ann Anchor'), posOf('Cal Climber'))
    < Math.min(...['Nia Newcomer', 'Hugh Highrated', 'Una Unrated'].map(posOf)), names());
ok('even the club\'s highest rating does not jump the queue',
  posOf('Hugh Highrated') > posOf('Cal Climber'), names());
// Worth stating out loud: the base and the bottom of the seed range are both
// 800 by default, so a player who lost every match finishes level with someone
// who never played, and the Club Locker adjustment then puts the newcomer
// ahead. Drop the base below the seed bottom for a clean split.
ok('a player who lost every match can fall below a rated newcomer',
  posOf('Ben Battler') > posOf('Hugh Highrated'), names());
ok('and dropping the base below the seed bottom separates them cleanly', (() => {
  set({ elo_unplayed_base: 700 });
  const clean = posOf('Ben Battler') < Math.min(...['Nia Newcomer', 'Hugh Highrated', 'Una Unrated'].map(posOf));
  set({ elo_unplayed_base: 800 });
  return clean;
})());
ok('among those who have not played, rating decides',
  posOf('Hugh Highrated') < posOf('Nia Newcomer'), names());
ok('and an unrated newcomer sits below a rated one',
  posOf('Una Unrated') > posOf('Nia Newcomer'), names());
ok('the unrated newcomer starts exactly at the base',
  ratingOf('Una Unrated') === cfg.elo_unplayed_base, String(ratingOf('Una Unrated')));
ok('the highest-rated newcomer starts at the base plus the whole adjustment',
  ratingOf('Hugh Highrated') === cfg.elo_unplayed_base + cfg.elo_unplayed_rating_bonus,
  String(ratingOf('Hugh Highrated')));

console.log('\nTHE SETTINGS MOVE THE LADDER');
set({ elo_unplayed_rating_bonus: 0 });
ok('with no adjustment every newcomer starts level',
  ratingOf('Hugh Highrated') === ratingOf('Nia Newcomer'), String(ratingOf('Hugh Highrated')));
set({ elo_unplayed_rating_bonus: 400, elo_unplayed_base: 800 });
ok('a large enough adjustment does lift them into the ranked players',
  posOf('Hugh Highrated') < Math.max(...['Ann Anchor', 'Ben Battler', 'Cal Climber'].map(posOf)), names());
set({ elo_unplayed_rating_bonus: 50 });
ok('and putting it back restores the split',
  posOf('Hugh Highrated') > Math.max(posOf('Ann Anchor'), posOf('Cal Climber')), names());
ok('nothing is stored: the ladder recomputes from the settings each time',
  ratingOf('Hugh Highrated') === cfg.elo_unplayed_base + 50);

console.log('\nONE WIN JOINS THE RANKED LADDER');
const beforeWin = ratingOf('Nia Newcomer');
match(4, 3, '2026-09-10');
const afterWin = ratingOf('Nia Newcomer');
ok('a first win is a plain rating gain, no multiplier', afterWin > beforeWin,
  `${beforeWin} -> ${afterWin}`);
ok('beating a much stronger player is worth more than beating an equal',
  afterWin - beforeWin > elo.ratingDelta(1000, 1000, cfg.elo_k_factor),
  `+${afterWin - beforeWin} vs +${elo.ratingDelta(1000, 1000, cfg.elo_k_factor).toFixed(0)} against an equal`);

console.log('\nPROFILE NUMBERS RECONCILE WITH THE LADDER');
const row = board().find((r) => r.name === 'Nia Newcomer');
const sum = Object.values(ladder.getPlayerMatchRatingDeltas(4)).reduce((a, b) => a + b, 0);
ok('her match deltas add up to her rating change', Math.abs(sum - (row.rating - row.seed_rating)) <= 2,
  `shown ${sum}, actual ${row.rating - row.seed_rating}`);

console.log('\nWHERE A NEWCOMER SLOTS IN');
// The positional ladder, which seeds the ratings. Once matches have been
// played, position no longer tracks rating, and that is where the old rule
// came apart: it inserted an arrival above the first member it met rated below
// them, which could be someone who had climbed - vaulting the arrival over a
// block of higher-rated members who happened to sit lower down.
db.prepare('DELETE FROM matches').run();
db.prepare('DELETE FROM players').run();
set({ elo_unproven_dock: 0, elo_provisional_matches: 0 });

add(10, 'Hank High', 4.6, '2025-09-02');
add(11, 'Wendy Winner', 3.9, '2025-09-02');   // low rating, will climb
add(12, 'Ursula Upper', 4.5, '2025-09-02');   // high rating, will not play
add(13, 'Vic Upper', 4.4, '2025-09-02');      // high rating, will not play
// Wendy beats the two above her and ends up over both.
match(11, 13, '2025-10-02');
match(11, 12, '2025-10-09');

const order = () => ladder.getLadder().map((r) => r.name);
const climbed = order();
ok('a lower-rated member can climb above higher-rated ones by winning',
  climbed.indexOf('Wendy Winner') < climbed.indexOf('Ursula Upper'), climbed.join(' > '));

// Now a 4.2 arrives, having played nobody.
add(14, 'Nate New', 4.2, '2026-01-05');
const after = order();
const at = (n) => after.indexOf(n);
ok('the newcomer lands below every member rated above them',
  at('Nate New') > at('Ursula Upper') && at('Nate New') > at('Vic Upper') && at('Nate New') > at('Hank High'),
  after.join(' > '));
ok('and below the lower-rated member who played their way up',
  at('Nate New') > at('Wendy Winner'), after.join(' > '));
ok('nobody already on the ladder is reordered by their arrival',
  after.filter((n) => n !== 'Nate New').join(' > ') === climbed.join(' > '),
  after.join(' > '));

// A newcomer rated above everyone still starts at the top: they are not being
// punished for a rating, only stopped from jumping people rated above them.
add(15, 'Tara Top', 4.9, '2026-01-06');
ok('a newcomer rated above everyone starts at the top',
  order()[0] === 'Tara Top', order().join(' > '));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
