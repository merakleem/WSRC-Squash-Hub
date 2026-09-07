// The ladder's inactivity rule: you drop off only after a full year with no
// activity, counted from your last match or, if you have never played, from the
// day you joined. Run: node test/ladder-inactivity.test.js
const fs = require('fs');
const path = '/tmp/ladder-inactivity-test.db';
try { fs.unlinkSync(path); } catch (_) {}
process.env.CLUB_TIMEZONE = 'America/Winnipeg';

const dbm = require('../database/db');
dbm.initDB(path);
const db = dbm.getDB();
const ladder = require('../models/ladderModel');
const seasonModel = require('../models/seasonModel');

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };

// Dates relative to today, so the rule is exercised against a real clock rather
// than a hard-coded year that would rot.
const day = (offsetDays) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
const YEAR = 365;

// Seed a player who joined on `created` and, optionally, last played on `last`.
let nextId = 0;
const addPlayer = (name, created, rating) => {
  nextId += 1;
  db.prepare('INSERT INTO players (id, name, club_locker_rating, created_at) VALUES (?,?,?,?)')
    .run(nextId, name, rating, `${created} 12:00:00`);
  return nextId;
};
const addMatch = (winner, loser, on) => {
  db.prepare(`INSERT INTO matches (type, status, player1_id, player2_id, player1_score, player2_score, winner_id, played_at)
              VALUES ('ladder','played',?,?,3,1,?,?)`).run(winner, loser, winner, `${on} 19:00:00`);
};

// An anchor pair keeps the club's first season well in the past, so the seasons
// the ladder derives are the same ones a real club would have by now.
const anchorA = addPlayer('Anchor A', day(-3 * YEAR), 4.0);
const anchorB = addPlayer('Anchor B', day(-3 * YEAR), 3.9);
addMatch(anchorA, anchorB, day(-3 * YEAR + 30));
addMatch(anchorB, anchorA, day(-30));

const recent      = addPlayer('Reggie Recent',   day(-2 * YEAR), 3.8);
const neverPlayed = addPlayer('Nora Newcomer',   day(-30),       3.7);
const lapsedNew   = addPlayer('Lenny Lapsed',    day(-2 * YEAR), 3.6); // joined long ago, never played
const returnee    = addPlayer('Rita Returned',   day(-3 * YEAR), 3.5);
const goneAway    = addPlayer('Gordon Gone',     day(-3 * YEAR), 3.4);
const exactlyYear = addPlayer('Edie Exact',      day(-3 * YEAR), 3.3);
const justUnder   = addPlayer('Una Under',       day(-3 * YEAR), 3.2);

addMatch(recent, anchorA, day(-60));                 // played two months ago
addMatch(returnee, anchorA, day(-2 * YEAR));         // long ago...
addMatch(returnee, anchorB, day(-10));               // ...but back last week
addMatch(goneAway, anchorA, day(-YEAR - 60));        // last seen 14 months ago
addMatch(exactlyYear, anchorA, day(-YEAR));          // exactly a year ago
addMatch(justUnder, anchorA, day(-YEAR + 2));        // a year less two days

const settings = seasonModel.getSettings();
const current = seasonModel.getCurrentSeasonKey();
const shown = ladder.computeEloLadder(current, settings);
const all = ladder.computeEloLadder(current, settings, null, { includeHidden: true });
const on = (id) => shown.some((r) => r.id === id);
const flagged = (id) => all.find((r) => r.id === id)?.hidden_for_inactivity;
const names = () => shown.map((r) => r.name).join(', ');

console.log('WHO STAYS ON THE LADDER');
ok('someone who played recently', on(recent), names());
ok('someone who joined recently and has never played', on(neverPlayed));
ok('someone back after two years away', on(returnee));
ok('someone whose last match was a year less two days ago', on(justUnder));

console.log('\nWHO DROPS OFF');
ok('nobody who is on the ladder is also flagged',
  shown.every((r) => !r.hidden_for_inactivity));
ok('a player last seen fourteen months ago', !on(goneAway) && flagged(goneAway) === true);
ok('a player who joined two years ago and never played', !on(lapsedNew) && flagged(lapsedNew) === true);
ok('a full year of inactivity is enough, to the day', !on(exactlyYear) && flagged(exactlyYear) === true);

console.log('\nWHAT THE DATE IS MEASURED FROM');
const gone = all.find((r) => r.id === goneAway);
const back = all.find((r) => r.id === returnee);
ok('last_active reports the last match played', gone.last_active === day(-YEAR - 60), gone.last_active);
ok('a returning player counts from their newest match, not their oldest',
  back.last_active === day(-10), back.last_active);
const newcomer = all.find((r) => r.id === neverPlayed);
ok('someone who has never played counts from the day they joined',
  newcomer.last_active === day(-30), newcomer.last_active);

console.log('\nA PAST SEASON IS JUDGED AS IT STOOD');
// Edie's last match was a year ago to the day, which drops her off the current
// ladder. It still falls inside the previous season, and within a year of that
// season's end, so that season's ladder must carry her: a finished ladder is
// not rewritten by time passing.
const seasons = seasonModel.getAllSeasons();
const older = seasons.find((s) => s.key !== current && s.ladder_system === 'elo');
if (older) {
  const then = ladder.computeEloLadder(older.key, settings);
  ok(`she is off the current ladder`, !on(exactlyYear));
  ok(`but still on the ${older.key} one she played in`,
    then.some((r) => r.id === exactlyYear), then.map((r) => r.name).join(', '));
  ok('and someone who had already been away a year by then is not',
    !then.some((r) => r.id === goneAway));
} else {
  ok('an earlier rated season exists to check', false, seasons.map((s) => s.key + '/' + s.ladder_system).join(' '));
}

console.log('\nTHE RULE ACTUALLY BITES');
ok('at least one player is hidden in this fixture',
  all.some((r) => r.hidden_for_inactivity), String(all.filter((r) => r.hidden_for_inactivity).length));
ok('and the hidden ones are absent from the default view',
  all.length > shown.length, `${all.length} with hidden, ${shown.length} without`);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
