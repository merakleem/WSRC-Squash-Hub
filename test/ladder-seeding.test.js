// How the rating ladder is seeded: you are on it once you have played, and a
// Club Locker rating only decides where you come in when you do.
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
const P = cfg.elo_club_locker_pivot;
const S = cfg.elo_club_locker_scale;

ok('a rating carried from a rated season is used as is',
  seed({ previousRating: 1234, previousPosition: 3, ladderSize: 10 }) === 1234);
ok('a finisher is spread across the seed range: first gets the top',
  seed({ previousPosition: 1, ladderSize: 10 }) === cfg.elo_seed_top);
ok('and last gets the bottom',
  seed({ previousPosition: 10, ladderSize: 10 }) === cfg.elo_seed_bottom);
ok('a player with no finish comes in on their Club Locker rating',
  seed({ unplayed: true, clubLockerRating: 4.5 }) === cfg.elo_base_rating + (4.5 - P) * S,
  String(seed({ unplayed: true, clubLockerRating: 4.5 })));
ok('the pivot rating comes in at the middle of the ladder',
  seed({ unplayed: true, clubLockerRating: P }) === cfg.elo_base_rating);
ok('a rating below the pivot comes in below the middle',
  seed({ unplayed: true, clubLockerRating: P - 1 }) === cfg.elo_base_rating - S);
// No rating is not the same as an average rating: it is no information, and the
// foot of the ladder is where that belongs.
ok('an unrated player comes in at the foot, not the middle',
  seed({ unplayed: true, clubLockerRating: null }) === cfg.elo_seed_bottom,
  String(seed({ unplayed: true, clubLockerRating: null })));
ok('which is below where the weakest rated newcomer would come in',
  seed({ unplayed: true, clubLockerRating: null }) < seed({ unplayed: true, clubLockerRating: 2.5 }),
  `${seed({ unplayed: true, clubLockerRating: null })} vs ${seed({ unplayed: true, clubLockerRating: 2.5 })}`);
ok('an empty rating counts as unrated, not as a zero',
  seed({ unplayed: true, clubLockerRating: '' }) === cfg.elo_seed_bottom);
ok('a nonsense rating is treated as unrated',
  seed({ unplayed: true, clubLockerRating: 'abc' }) === cfg.elo_seed_bottom);
ok('a position cannot seed someone who has not played',
  seed({ previousPosition: 1, ladderSize: 10, unplayed: true, clubLockerRating: null }) === cfg.elo_seed_bottom);

console.log('\nBOTH NUMBERS ARE SETTINGS');
ok('the pivot is overridable', elo.config({ elo_club_locker_pivot: '4' }).elo_club_locker_pivot === 4);
ok('the scale is overridable', elo.config({ elo_club_locker_scale: '200' }).elo_club_locker_scale === 200);
ok('a blank falls back to the default', elo.config({ elo_club_locker_scale: '' }).elo_club_locker_scale === 160);
ok('every setting the earlier attempts added is gone', (() => {
  const c = elo.config({});
  return ['elo_unplayed_base', 'elo_unplayed_rating_bonus', 'elo_unplayed_rating_floor',
    'elo_unplayed_rating_multiplier', 'elo_unproven_dock', 'elo_unproven_handicap',
    'elo_provisional_matches', 'elo_provisional_gain', 'elo_provisional_loss']
    .every((k) => !(k in c));
})());

console.log('\nNOBODY IS RANKED UNTIL THEY PLAY');
set({ season_start_md: '09-01' });
const add = (id, name, rating, created) =>
  db.prepare('INSERT INTO players (id,name,club_locker_rating,created_at) VALUES (?,?,?,?)')
    .run(id, name, rating, `${created} 12:00:00`);
const match = (w, l, on) =>
  db.prepare(`INSERT INTO matches (type,status,player1_id,player2_id,player1_score,player2_score,winner_id,played_at)
              VALUES ('ladder','played',?,?,3,1,?,?)`).run(w, l, w, `${on} 19:00:00`);

add(1, 'Ann Anchor', 4.5, '2025-09-02');
add(2, 'Ben Battler', 4.2, '2025-09-02');
add(3, 'Cal Climber', 4.0, '2025-09-02');
for (const day of ['10-02', '10-09', '10-16', '11-06', '11-13']) {
  match(1, 2, `2025-${day}`);
  match(3, 2, `2025-${day}`);
}
// Two members who have never hit a ball, one rated above the entire club.
add(4, 'Nia Newcomer', 4.3, '2026-08-20');
add(5, 'Hugh Highrated', 5.9, '2026-08-20');
add(6, 'Una Unrated', null, '2026-08-20');

const board = () => ladder.computeEloLadder(seasonModel.getCurrentSeasonKey(), seasonModel.getSettings());
const withHidden = () => ladder.computeEloLadder(
  seasonModel.getCurrentSeasonKey(), seasonModel.getSettings(), null, { includeHidden: true });
const on = (n) => board().some((r) => r.name === n);
const ratingOf = (n) => withHidden().find((r) => r.name === n)?.rating;
const posOf = (n) => board().findIndex((r) => r.name === n) + 1;
const names = () => board().map((r) => r.name).join(' > ');

ok('the ladder is exactly the players who have played', names() === 'Ann Anchor > Cal Climber > Ben Battler', names());
ok('a newcomer is not on it, however high their rating', !on('Hugh Highrated'), names());
ok('nor an unrated one', !on('Una Unrated'));
ok('and they are marked unranked rather than merely missing',
  withHidden().find((r) => r.name === 'Hugh Highrated').unranked === true);
ok('a player who has played is never marked unranked',
  withHidden().find((r) => r.name === 'Ann Anchor').unranked === false);

console.log('\nONE MATCH PUTS YOU ON IT');
ok('the club\'s best rating is worth nothing until then',
  ratingOf('Hugh Highrated') === cfg.elo_base_rating + (5.9 - P) * S && !on('Hugh Highrated'),
  String(ratingOf('Hugh Highrated')));
match(5, 3, '2026-09-10');
ok('after one match they are on the ladder', on('Hugh Highrated'), names());
ok('entering near where their rating said, adjusted by the result',
  ratingOf('Hugh Highrated') > cfg.elo_base_rating + (5.9 - P) * S,
  String(ratingOf('Hugh Highrated')));
ok('and a strong newcomer enters near the top, as the rating implied',
  posOf('Hugh Highrated') <= 2, names());

console.log('\nTHE SETTINGS MOVE THE ENTRY POINT');
set({ elo_club_locker_scale: 0 });
ok('with no scale every rated player enters at the middle',
  ratingOf('Nia Newcomer') === cfg.elo_base_rating, String(ratingOf('Nia Newcomer')));
set({ elo_club_locker_scale: 400 });
ok('a bigger scale spreads new players further apart',
  ratingOf('Nia Newcomer') === cfg.elo_base_rating + (4.3 - P) * 400, String(ratingOf('Nia Newcomer')));
set({ elo_club_locker_pivot: 4.3, elo_club_locker_scale: 160 });
ok('and moving the pivot moves who counts as mid-ladder',
  ratingOf('Nia Newcomer') === cfg.elo_base_rating, String(ratingOf('Nia Newcomer')));
set({ elo_club_locker_pivot: 3.5 });
ok('nothing is stored: the ladder recomputes from the settings each time',
  ratingOf('Nia Newcomer') === cfg.elo_base_rating + (4.3 - P) * S);

console.log('\nPROFILE NUMBERS');
const stats = ladder.getPlayerLadderStats(4);
ok('a member who has not played is reported unranked', stats.unranked === true && stats.position === null,
  JSON.stringify(stats));
ok('and one who has is not', (() => {
  const s2 = ladder.getPlayerLadderStats(1);
  return s2.unranked === false && s2.position != null;
})());
const row = withHidden().find((r) => r.name === 'Hugh Highrated');
const sum = Object.values(ladder.getPlayerMatchRatingDeltas(5)).reduce((a, b) => a + b, 0);
ok('match deltas add up to the rating change', Math.abs(sum - (row.rating - row.seed_rating)) <= 2,
  `shown ${sum}, actual ${row.rating - row.seed_rating}`);

console.log('\nRATINGS DECIDE THE POINTS, NOT LADDER POSITIONS');
// The gap that matters is in rating. Two players 200 apart trade the same
// points whether they sit at #2 and #12 or #40 and #55.
ok('the same rating gap pays the same wherever it sits on the ladder',
  elo.ratingDelta(1000, 1200, cfg.elo_k_factor) === elo.ratingDelta(1300, 1500, cfg.elo_k_factor),
  elo.ratingDelta(1000, 1200, cfg.elo_k_factor).toFixed(2));
ok('and a bigger rating gap pays more',
  elo.ratingDelta(1000, 1400, cfg.elo_k_factor) > elo.ratingDelta(1000, 1100, cfg.elo_k_factor));
ok('expected score is a function of the difference alone',
  elo.expectedScore(1000, 1200) === elo.expectedScore(1800, 2000));

console.log('\nTHE SCORELINE COUNTS');
const M0 = (w, l) => elo.marginMultiplier(w, l, cfg);
ok('a 3-1 is the middle result and scores at face value', M0(3, 1) === 1);
ok('a 3-0 is worth more than a 3-1', M0(3, 0) > M0(3, 1), `x${M0(3, 0).toFixed(2)}`);
ok('and a 3-2 is worth less', M0(3, 2) < M0(3, 1), `x${M0(3, 2).toFixed(2)}`);
ok('so a 3-0 beats a 3-2 by twice the weight',
  Math.abs((M0(3, 0) - M0(3, 2)) - 2 * cfg.elo_margin_weight) < 1e-9);
ok('a match with no games recorded still counts at face value',
  M0(null, null) === 1 && M0('', '') === 1 && M0(undefined, undefined) === 1);
ok('the weight is a setting', elo.config({ elo_margin_weight: '0.3' }).elo_margin_weight === 0.3);
ok('at zero the scoreline is ignored entirely', (() => {
  const flat = elo.config({ elo_margin_weight: 0 });
  return elo.marginMultiplier(3, 0, flat) === 1 && elo.marginMultiplier(3, 2, flat) === 1;
})());
ok('and a huge weight cannot make a win worth nothing',
  elo.marginMultiplier(3, 2, elo.config({ elo_margin_weight: 5 })) >= 0.2,
  String(elo.marginMultiplier(3, 2, elo.config({ elo_margin_weight: 5 }))));

// And the same, played out on a ladder: the loser gives up exactly what the
// winner takes, at every scoreline.
db.prepare('DELETE FROM matches').run();
db.prepare('DELETE FROM players').run();
// Seven players, so the seed range spreads them about 100 apart rather than the
// full 600 two players would be. Two evenly matched opponents are what makes a
// scoreline's worth visible; between a 1400 and an 800 every result rounds to
// the same point.
for (let i = 0; i < 7; i++) add(20 + i, `Rung ${i + 1}`, 4.6 - i * 0.1, '2025-09-02');
const seedSeason = () => {
  // One match each in the season before, won by the higher-rated player, so
  // everybody is ranked and nobody is reordered.
  for (let i = 0; i < 6; i += 2) {
    db.prepare(`INSERT INTO matches (type,status,player1_id,player2_id,player1_score,player2_score,winner_id,played_at)
                VALUES ('ladder','played',?,?,3,1,?,'2025-10-02 19:00:00')`).run(20 + i, 21 + i, 20 + i);
  }
};
const swing = (w, l) => {
  db.prepare('DELETE FROM matches').run();
  seedSeason();
  // Rung 4 beats Rung 5, its nearest neighbour on the ladder.
  db.prepare(`INSERT INTO matches (type,status,player1_id,player2_id,player1_score,player2_score,winner_id,played_at)
              VALUES ('ladder','played',23,24,?,?,23,'2026-09-05 19:00:00')`).run(w, l);
  const rows = ladder.computeEloLadder(seasonModel.getCurrentSeasonKey(), seasonModel.getSettings());
  const a = rows.find((r) => r.id === 23);
  const b = rows.find((r) => r.id === 24);
  return { won: a.rating - a.seed_rating, lost: b.seed_rating - b.rating };
};
const s30 = swing(3, 0);
const s31 = swing(3, 1);
const s32 = swing(3, 2);
ok('winning 3-0 pays more than 3-1, which pays more than 3-2',
  s30.won > s31.won && s31.won > s32.won, `${s30.won} > ${s31.won} > ${s32.won}`);
ok('losing 2-3 costs less than losing 0-3',
  s32.lost < s30.lost, `${s32.lost} vs ${s30.lost}`);
ok('and every scoreline is still an even exchange',
  s30.won === s30.lost && s31.won === s31.lost && s32.won === s32.lost);

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
