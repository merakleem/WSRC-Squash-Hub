// The doubles ladder: everyone starts at the base rating, a 2v2 result moves
// all four players by their own expected score against the other pair's
// average, a rating carries across seasons, and none of it touches singles.
// Run: node test/doubles-ladder.test.js
const fs = require('fs');
const path = '/tmp/doubles-ladder-test.db';
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
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log('THE MATHS');
const cfg = elo.config({});
const K = cfg.elo_k_factor;
let d = elo.doublesDeltas([[1000, 1000], [1000, 1000]], 1, K);
ok('four equal players: winners gain half of K each, losers lose it', d[0].every((x) => near(x, K / 2)) && d[1].every((x) => near(x, -K / 2)), JSON.stringify(d));
d = elo.doublesDeltas([[1200, 800], [1000, 1000]], 1, K);
ok('the weaker partner gains more from the same win', d[0][1] > d[0][0], `${d[0][0].toFixed(2)} vs ${d[0][1].toFixed(2)}`);
ok('and the average of the pair moves as one 1000-rated player would', near((d[0][0] + d[0][1]) / 2, K * (1 - elo.expectedScore(1000, 1000)), 2), String((d[0][0] + d[0][1]) / 2));
d = elo.doublesDeltas([[1200, 800], [1000, 1000]], 2, K);
ok('when they lose, the weaker partner loses less', Math.abs(d[0][1]) < Math.abs(d[0][0]), `${d[0][0].toFixed(2)} vs ${d[0][1].toFixed(2)}`);
ok('both losers lose, both winners gain', d[0].every((x) => x < 0) && d[1].every((x) => x > 0));

console.log('\nTHE LADDER');
const NAMES = ['Ann Doubles', 'Bo Doubles', 'Cy Doubles', 'Di Doubles', 'Ed Doubles', 'Flo Doubles'];
NAMES.forEach((n, i) => db.prepare('INSERT INTO players (name, club_locker_rating) VALUES (?, ?)').run(n, 5 - i * 0.5));
const idOf = (n) => db.prepare('SELECT id FROM players WHERE name = ?').get(n).id;
const [A, B, C, D, E, F] = NAMES.map(idOf);
db.prepare(`INSERT INTO settings (key,value) VALUES ('season_start_md','01-01') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
const settings = seasonModel.getSettings();
const thisYear = new Date().getFullYear();
const singles = (w, l, when) => db.prepare(
  `INSERT INTO matches (type, status, format, player1_id, player2_id, player1_score, player2_score, winner_id, played_at, confirmed_at)
   VALUES ('ladder','played','singles',?,?,3,1,?,?,?)`).run(w, l, w, when, when);
const doubles = (s1, s2, s1Score, s2Score, when) => db.prepare(
  `INSERT INTO matches (type, status, format, player1_id, player1_partner_id, player2_id, player2_partner_id,
                        player1_score, player2_score, winner_id, played_at, confirmed_at)
   VALUES ('ladder','played','doubles',?,?,?,?,?,?,?,?,?)`).run(s1[0], s1[1], s2[0], s2[1], s1Score, s2Score, s1Score > s2Score ? s1[0] : s2[0], when, when);

// A singles history first, so the season list exists and singles has a ladder to protect.
singles(A, B, `${thisYear - 1}-03-01 12:00:00`);
singles(A, C, `${thisYear}-02-01 12:00:00`);
const season = seasonModel.getCurrentSeasonKey();
const singlesBefore = JSON.stringify(ladder.computeEloLadder(season, settings));

ok('before any doubles match the doubles ladder is empty', ladder.computeDoublesEloLadder(season, settings).length === 0);
ok('and everyone counts as unranked', ladder.getPlayerDoublesLadderStats(A).unranked === true);

doubles([A, B], [C, D], 3, 1, `${thisYear}-03-01 12:00:00`);
let rows = ladder.computeDoublesEloLadder(season, settings);
ok('one match puts exactly its four players on the ladder', rows.length === 4 && !rows.some((r) => r.id === E || r.id === F), rows.map((r) => r.name).join());
ok('winners above losers, from a base of 1000', rows[0].rating > 1000 && rows[3].rating < 1000 && [A, B].includes(rows[0].id) && [C, D].includes(rows[3].id));
ok('season record counts it', rows.find((r) => r.id === A).season_wins === 1 && rows.find((r) => r.id === C).season_losses === 1);
ok('the seed is the base rating, so movement is the whole gain', rows.find((r) => r.id === A).seed_rating === 1000 && rows.find((r) => r.id === A).rating_change === rows.find((r) => r.id === A).rating - 1000);
ok('the singles ladder is exactly as it was', JSON.stringify(ladder.computeEloLadder(season, settings)) === singlesBefore);
ok('singles records do not see the doubles match', ladder.getSeasonRecords(season)[B] === undefined);

// Now a mismatched pair beats two equals: partners move by different amounts.
doubles([A, E], [C, F], 3, 0, `${thisYear}-03-02 12:00:00`);
rows = ladder.computeDoublesEloLadder(season, settings);
const dA = ladder.getPlayerDoublesRatingDeltas(A), dE = ladder.getPlayerDoublesRatingDeltas(E);
const secondId = db.prepare("SELECT id FROM matches WHERE format = 'doubles' ORDER BY id DESC LIMIT 1").get().id;
ok('per-match deltas exist for both partners', dA[secondId] > 0 && dE[secondId] > 0, JSON.stringify([dA, dE]));
ok('the lower-rated partner (fresh at 1000) gained more than the one already above it', dE[secondId] > dA[secondId], `${dA[secondId]} vs ${dE[secondId]}`);
ok('deltas add up to the rating shown', Object.values(dA).reduce((s, x) => s + x, 0) === rows.find((r) => r.id === A).rating - 1000, `${Object.values(dA).reduce((s, x) => s + x, 0)} vs ${rows.find((r) => r.id === A).rating - 1000}`);

console.log('\nSEASONS');
const stats = ladder.getPlayerDoublesLadderStats(A);
ok('profile stats read from the same ladder', stats.position === rows.find((r) => r.id === A).position && stats.rating === rows.find((r) => r.id === A).rating && stats.ladder_size === rows.length, JSON.stringify(stats));
// Last season had a doubles match too: its rating carries into this one.
doubles([E, F], [A, B], 3, 2, `${thisYear - 1}-06-01 12:00:00`);
const lastSeason = String(thisYear - 1);
const lastRows = ladder.computeDoublesEloLadder(lastSeason, settings);
const thisRows = ladder.computeDoublesEloLadder(season, settings);
ok('last season ranks the four who played then', lastRows.length === 4 && (lastRows[0].id === E || lastRows[0].id === F), lastRows.map((r) => `${r.name}:${r.rating}`).join());
ok('this season starts from where last season ended', thisRows.find((r) => r.id === F).seed_rating === lastRows.find((r) => r.id === F).rating, `${thisRows.find((r) => r.id === F).seed_rating} vs ${lastRows.find((r) => r.id === F).rating}`);
ok('but the season record starts over', lastRows.find((r) => r.id === F).season_wins === 1 && thisRows.find((r) => r.id === F).season_wins === 0);
ok('a frozen past season is reported as such', ladder.getDoublesLadderForSeason(lastSeason).frozen === true && ladder.getDoublesLadderForSeason(lastSeason).system === 'elo');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
