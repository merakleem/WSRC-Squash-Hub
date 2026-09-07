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
const M = cfg.elo_unplayed_rating_multiplier;
const F = cfg.elo_unplayed_rating_floor;
ok('an unrated newcomer starts at the foot of the ladder',
  seed({ unplayed: true, clubLockerRating: null }) === cfg.elo_seed_bottom,
  String(seed({ unplayed: true, clubLockerRating: null })));
ok('only the rating above the floor is worth anything',
  seed({ unplayed: true, clubLockerRating: 4 }) === cfg.elo_seed_bottom + (4 - F) * M,
  String(seed({ unplayed: true, clubLockerRating: 4 })));
ok('a rating at the floor is worth nothing',
  seed({ unplayed: true, clubLockerRating: F }) === cfg.elo_seed_bottom);
ok('and one below it is worth nothing rather than a penalty',
  seed({ unplayed: true, clubLockerRating: F - 2 }) === cfg.elo_seed_bottom,
  String(seed({ unplayed: true, clubLockerRating: F - 2 })));
ok('twice as far above the floor is twice the lift',
  seed({ unplayed: true, clubLockerRating: F + 2 }) - cfg.elo_seed_bottom
    === 2 * (seed({ unplayed: true, clubLockerRating: F + 1 }) - cfg.elo_seed_bottom));
// The point of the floor: the multiplier can be turned up for the strong
// players without dragging the weak ones off the bottom with it.
ok('raising the multiplier cannot move anyone at or below the floor', (() => {
  const steep = elo.config({ elo_unplayed_rating_multiplier: '600' });
  return elo.seedRating({ unplayed: true, clubLockerRating: F - 1 }, steep) === steep.elo_seed_bottom
    && elo.seedRating({ unplayed: true, clubLockerRating: F + 2 }, steep) > cfg.elo_seed_bottom + 1000;
})());
ok('a nonsense rating is worth nothing',
  seed({ unplayed: true, clubLockerRating: 'abc' }) === cfg.elo_seed_bottom);
ok('and a negative one cannot push anyone below the foot',
  seed({ unplayed: true, clubLockerRating: -3 }) === cfg.elo_seed_bottom,
  String(seed({ unplayed: true, clubLockerRating: -3 })));
ok('a position cannot lift someone who has not played',
  seed({ previousPosition: 1, ladderSize: 10, unplayed: true, clubLockerRating: null }) === cfg.elo_seed_bottom);
// The foot of the ladder is one number used by both: a player who finished last
// and an unrated player who never played start level.
ok('finishing last and never playing both start at the foot',
  seed({ previousPosition: 10, ladderSize: 10 }) === seed({ unplayed: true, clubLockerRating: null }),
  `${seed({ previousPosition: 10, ladderSize: 10 })} vs ${seed({ unplayed: true, clubLockerRating: null })}`);
// Ratings start around 2.5, not 0, so every rated newcomer clears the foot.
ok('so the weakest newcomers sit at the foot however steep the curve gets',
  seed({ unplayed: true, clubLockerRating: 2.5 }) === cfg.elo_seed_bottom,
  String(seed({ unplayed: true, clubLockerRating: 2.5 })));

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

console.log('\nONE NUMBER, AND IT IS A SETTING');
ok('the multiplier is overridable',
  elo.config({ elo_unplayed_rating_multiplier: '30' }).elo_unplayed_rating_multiplier === 30);
ok('the floor is overridable',
  elo.config({ elo_unplayed_rating_floor: '4' }).elo_unplayed_rating_floor === 4);
ok('a blank falls back to the default',
  elo.config({ elo_unplayed_rating_multiplier: '' }).elo_unplayed_rating_multiplier === 150);
ok('every setting this replaced is gone', (() => {
  const c = elo.config({});
  return ['elo_unplayed_base', 'elo_unplayed_rating_bonus', 'elo_unproven_dock', 'elo_unproven_handicap',
    'elo_provisional_matches', 'elo_provisional_gain', 'elo_provisional_loss']
    .every((k) => !(k in c));
})());

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

// With the multiplier off, results are the only thing on the list and the
// separation is absolute. Turning it up is what buys a strong newcomer a
// starting place among the ranked players - that is the knob's whole job.
ok('with no head start, everyone who played is above everyone who has not', (() => {
  set({ elo_unplayed_rating_multiplier: 0 });
  const clean = Math.max(posOf('Ann Anchor'), posOf('Cal Climber'))
    < Math.min(...['Nia Newcomer', 'Hugh Highrated', 'Una Unrated'].map(posOf));
  set({ elo_unplayed_rating_multiplier: 150 });
  return clean;
})());
ok('at the default a strong newcomer does start among them',
  posOf('Hugh Highrated') < posOf('Cal Climber'), names());
ok('but a newcomer at the floor never does, however steep it gets', (() => {
  set({ elo_unplayed_rating_multiplier: 600 });
  const stuck = posOf('Una Unrated') > Math.max(posOf('Ann Anchor'), posOf('Cal Climber'));
  set({ elo_unplayed_rating_multiplier: 150 });
  return stuck;
})());
// Worth stating out loud: a player who lost every match finishes last and so
// starts at the foot, level with someone who never played - and the head start
// then puts the rated newcomer ahead of them. Turning it off levels them again.
ok('a player who lost every match can fall below a rated newcomer',
  posOf('Ben Battler') > posOf('Hugh Highrated'), names());
ok('with the multiplier at zero they start on the same rating', (() => {
  set({ elo_unplayed_rating_multiplier: 0 });
  const level = ratingOf('Ben Battler') === ratingOf('Hugh Highrated');
  set({ elo_unplayed_rating_multiplier: 150 });
  return level;
})());
ok('among those who have not played, rating decides',
  posOf('Hugh Highrated') < posOf('Nia Newcomer'), names());
ok('and an unrated newcomer sits below a rated one',
  posOf('Una Unrated') > posOf('Nia Newcomer'), names());
ok('the unrated newcomer starts exactly at the foot',
  ratingOf('Una Unrated') === cfg.elo_seed_bottom, String(ratingOf('Una Unrated')));
ok('a rated newcomer starts at the foot plus what they clear the floor by',
  ratingOf('Hugh Highrated') === Math.round(cfg.elo_seed_bottom + (5.2 - F) * M),
  String(ratingOf('Hugh Highrated')));

console.log('\nTHE SETTINGS MOVE THE LADDER');
set({ elo_unplayed_rating_multiplier: 0 });
ok('at zero every newcomer starts level, rating or not',
  ratingOf('Hugh Highrated') === ratingOf('Nia Newcomer')
    && ratingOf('Hugh Highrated') === ratingOf('Una Unrated'), String(ratingOf('Hugh Highrated')));
set({ elo_unplayed_rating_multiplier: 400 });
ok('a steep enough curve lifts the strong newcomer among the ranked players',
  posOf('Hugh Highrated') < Math.max(...['Ann Anchor', 'Ben Battler', 'Cal Climber'].map(posOf)), names());
ok('and the unrated one stays at the foot while it does',
  ratingOf('Una Unrated') === cfg.elo_seed_bottom, String(ratingOf('Una Unrated')));
ok('raising the floor pulls the newcomers back down', (() => {
  const before = posOf('Hugh Highrated');
  set({ elo_unplayed_rating_floor: 5 });
  const after = posOf('Hugh Highrated');
  set({ elo_unplayed_rating_floor: 3, elo_unplayed_rating_multiplier: 150 });
  return after > before;
})());
ok('nothing is stored: the ladder recomputes from the settings each time',
  ratingOf('Hugh Highrated') === Math.round(cfg.elo_seed_bottom + (5.2 - 3) * 150));

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
