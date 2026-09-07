// Unproven players: a starting penalty they play back, and an adjustment period
// where a win counts for more and a loss for less. All four numbers are club
// settings. Run: node test/ladder-provisional.test.js
const fs = require('fs');
const path = '/tmp/ladder-provisional-test.db';
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

console.log('THE MATHS');
const K = 24;
ok('a plain match is still zero-sum', (() => {
  const r = elo.applyMatch(1000, 1000, K);
  return Math.abs((r.winner - 1000) - (1000 - r.loser)) < 1e-9;
})());
const amp = elo.applyMatch(1000, 1000, K, { winnerGain: 3, loserLoss: 0.34 });
ok('an amplified win pays three times', Math.abs((amp.winner - 1000) - 3 * amp.delta) < 1e-9,
  (amp.winner - 1000).toFixed(1));
ok('a damped loss costs a third', Math.abs((1000 - amp.loser) - 0.34 * amp.delta) < 1e-9,
  (1000 - amp.loser).toFixed(1));
ok('the other player is untouched by their opponent\'s multiplier', (() => {
  const a = elo.applyMatch(1000, 1000, K, { winnerGain: 3 });
  return Math.abs((1000 - a.loser) - a.delta) < 1e-9;
})());
ok('losing to someone far above still costs less than to an equal',
  elo.ratingDelta(1300, 1000, K) < elo.ratingDelta(1000, 1000, K),
  `${elo.ratingDelta(1300, 1000, K).toFixed(1)} vs ${elo.ratingDelta(1000, 1000, K).toFixed(1)}`);

console.log('\nDEFAULTS ARE SETTINGS, NOT CONSTANTS');
const d = elo.config({});
ok('a dock default exists', d.elo_unproven_dock === 60, String(d.elo_unproven_dock));
ok('an adjustment period default exists', d.elo_provisional_matches === 5, String(d.elo_provisional_matches));
ok('all four are overridable', (() => {
  const c = elo.config({ elo_unproven_dock: '100', elo_provisional_matches: '8',
    elo_provisional_gain: '4', elo_provisional_loss: '0.5' });
  return c.elo_unproven_dock === 100 && c.elo_provisional_matches === 8
    && c.elo_provisional_gain === 4 && c.elo_provisional_loss === 0.5;
})());
ok('a blank setting falls back to the default',
  elo.config({ elo_unproven_dock: '' }).elo_unproven_dock === 60);

console.log('\nON A LADDER');
// A club with a season of history, then two arrivals who have played nothing:
// one rated the same as an established player, one rated well above.
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
// A season of real matches, so these three are proven.
for (const day of ['10-02', '10-09', '10-16', '11-06', '11-13']) {
  match(1, 2, `2025-${day}`);
  match(3, 2, `2025-${day}`);
}
// Two newcomers arrive before the rating era opens on 2026-09-01.
add(4, 'Nia Newcomer', 4.2, '2026-08-20');
add(5, 'Hugh Highrated', 4.6, '2026-08-20');

const ladderNow = () => ladder.computeEloLadder(seasonModel.getCurrentSeasonKey(), seasonModel.getSettings());
const ratingOf = (name) => ladderNow().find((r) => r.name === name)?.rating;
const posOf = (name) => ladderNow().findIndex((r) => r.name === name) + 1;

set({ elo_unproven_dock: 0, elo_provisional_matches: 0 });
const niaOff = ratingOf('Nia Newcomer');
const posOff = { nia: posOf('Nia Newcomer'), ben: posOf('Ben Battler') };
set({ elo_unproven_dock: 60, elo_provisional_matches: 5, elo_provisional_gain: 3, elo_provisional_loss: 0.34 });
const niaOn = ratingOf('Nia Newcomer');
const posOn = { nia: posOf('Nia Newcomer'), ben: posOf('Ben Battler') };

ok('an unproven player is docked exactly the setting', niaOff - niaOn === 60, `${niaOff} -> ${niaOn}`);
ok('and a big enough penalty costs her places', (() => {
  set({ elo_unproven_dock: 300 });
  const deep = posOf('Nia Newcomer');
  set({ elo_unproven_dock: 60 });
  return deep > posOff.nia;
})(), `#${posOff.nia} undocked`);
ok('a player who has played is not docked', ratingOf('Ben Battler') === (() => {
  set({ elo_unproven_dock: 0 }); const r = ratingOf('Ben Battler');
  set({ elo_unproven_dock: 60 }); return r;
})(), String(ratingOf('Ben Battler')));
ok('and does not lose a place to the change', posOn.ben <= posOff.ben, `#${posOff.ben} -> #${posOn.ben}`);
ok('changing the dock changes the ladder, with nothing stored', (() => {
  set({ elo_unproven_dock: 200 });
  const deep = ratingOf('Nia Newcomer');
  set({ elo_unproven_dock: 60 });
  return deep === niaOff - 200 && ratingOf('Nia Newcomer') === niaOn;
})());

console.log('\nPLAYING IT BACK');
set({ elo_unproven_dock: 60, elo_provisional_matches: 5, elo_provisional_gain: 3, elo_provisional_loss: 0.34 });
const before = ratingOf('Nia Newcomer');
match(4, 3, '2026-09-10');                    // one win over an established player
const gained = ratingOf('Nia Newcomer') - before;
set({ elo_provisional_gain: 1 });
const gainedPlain = ratingOf('Nia Newcomer') - before;
set({ elo_provisional_gain: 3 });
ok('a win during the adjustment pays the multiple of a normal one',
  Math.abs(gained / gainedPlain - 3) < 0.05, `${gained.toFixed(1)} vs ${gainedPlain.toFixed(1)}`);

// How many wins it actually takes to climb back out, with and without help.
const winsToClear = (gain) => {
  set({ elo_provisional_gain: gain, elo_provisional_matches: 20 });
  let n = 0;
  db.prepare("DELETE FROM matches WHERE player1_id = 4 AND played_at > '2026-09-01'").run();
  while (ratingOf('Nia Newcomer') < niaOff && n < 30) {
    n += 1;
    match(4, 3, `2026-09-${String(10 + n).padStart(2, '0')}`);
  }
  db.prepare("DELETE FROM matches WHERE player1_id = 4 AND played_at > '2026-09-01'").run();
  set({ elo_provisional_gain: 3, elo_provisional_matches: 5 });
  return n;
};
const helped = winsToClear(3);
const unhelped = winsToClear(1);
ok('the adjustment is what makes the climb quick', helped < unhelped, `${helped} wins vs ${unhelped}`);
ok('and it is a handful of matches, not a season', helped <= 4, `${helped} wins`);

// winsToClear cleared her slate; give her two real wins back for the sections
// below, which need a player who has actually played during the adjustment.
match(4, 3, '2026-09-10');
match(4, 2, '2026-09-17');

console.log('\nAND LOSING SOFTLY');
const hughBefore = ratingOf('Hugh Highrated');
match(1, 5, '2026-09-10');                    // Hugh loses to the club's best
const lostDamped = hughBefore - ratingOf('Hugh Highrated');
set({ elo_provisional_loss: 1 });
const lostPlain = hughBefore - ratingOf('Hugh Highrated');
set({ elo_provisional_loss: 0.34 });
ok('an early loss is softened to the fraction set',
  Math.abs(lostDamped / lostPlain - 0.34) < 0.02, `-${lostDamped.toFixed(1)} vs -${lostPlain.toFixed(1)}`);
ok('and it is a small number of points either way', lostDamped < 6, `-${lostDamped.toFixed(1)}`);
ok('the established winner still gains normally', (() => {
  const deltas = ladder.getPlayerMatchRatingDeltas(1);
  return Object.values(deltas).some((v) => v > 0);
})());

console.log('\nTHE PERIOD RUNS OUT');
set({ elo_provisional_matches: 1 });
const oneOnly = ratingOf('Nia Newcomer');
set({ elo_provisional_matches: 5 });
ok('a shorter adjustment leaves her lower', oneOnly < ratingOf('Nia Newcomer'),
  `${oneOnly} vs ${ratingOf('Nia Newcomer')}`);
ok('with no adjustment at all she is lower still', (() => {
  set({ elo_provisional_matches: 0 });
  const none = ratingOf('Nia Newcomer');
  set({ elo_provisional_matches: 5 });
  return none < oneOnly;
})());

console.log('\nPROFILE NUMBERS RECONCILE WITH THE LADDER');
set({ elo_unproven_dock: 60, elo_provisional_matches: 5, elo_provisional_gain: 3, elo_provisional_loss: 0.34 });
const niaDeltas = Object.values(ladder.getPlayerMatchRatingDeltas(4));
const sumShown = niaDeltas.reduce((a, b) => a + b, 0);
const seeded = ladderNow().find((r) => r.name === 'Nia Newcomer');
ok('her match deltas add up to her rating change',
  Math.abs(sumShown - (seeded.rating - seeded.seed_rating)) <= 2,
  `shown ${sumShown}, actual ${seeded.rating - seeded.seed_rating}`);
ok('and an amplified win is reported at its amplified value',
  niaDeltas.some((v) => v > 25), JSON.stringify(niaDeltas));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
