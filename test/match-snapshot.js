// Dumps every match-derived output the app can produce into one JSON blob:
// the ladder, each season's standings, every player's record, history,
// upcoming matches and rating deltas, every league week, and the schedule for
// every date that has anything on it.
//
// It exists to prove that a change to how matches are stored or queried did not
// move any of it. Capture from the old code, apply the change, capture again,
// and diff:
//
//   git stash && node test/match-snapshot.js before.db > before.json && git stash pop
//   node test/match-snapshot.js after.db > after.json
//   diff <(jq -S . before.json) <(jq -S . after.json)
//
// Point it at a copy of a real database, never the live one - it opens the file
// read-write and will run pending migrations against it.

const ROOT = '/Users/meraklee/Desktop/Codebases/Squash Management System';
const dbPath = process.argv[2];
process.env.DB_PATH = dbPath;
process.env.CLUB_TIMEZONE = 'America/Winnipeg';

const { initDB, getDB } = require(`${ROOT}/database/db`);
initDB(dbPath);
const db = getDB();

const ladder   = require(`${ROOT}/models/ladderModel`);
const players  = require(`${ROOT}/models/playerModel`);
const leagues  = require(`${ROOT}/models/leagueModel`);
const seasons  = require(`${ROOT}/models/seasonModel`);
const bookings = require(`${ROOT}/models/bookingModel`);
const tourns   = require(`${ROOT}/models/tournamentModel`);

const out = {};
const ids = db.prepare('SELECT id FROM players ORDER BY id').all().map(r => r.id);

// --- ladder ---------------------------------------------------------------
out.ladder = ladder.getLadder();
out.ladderBySeason = {};
for (const s of seasons.getAllSeasons()) {
  out.ladderBySeason[s.key] = ladder.getLadderForSeason(s.key);
  out.seasonRecords = out.seasonRecords || {};
  out.seasonRecords[s.key] = ladder.getSeasonRecords(s.key);
}
out.completedMatches = ladder.getCompletedMatches();
out.lastMatchDates = ladder.getLastMatchDates();

// --- per player -----------------------------------------------------------
out.records = players.getAllPlayerRecords();
out.perPlayer = {};
for (const id of ids) {
  out.perPlayer[id] = {
    leagueHistory: players.getPlayerMatchHistory(id),
    pickupHistory: players.getPickupMatchHistory(id),
    upcoming: players.getPlayerUpcomingMatches(id),
    tournHistory: tourns.getPlayerTournamentHistory(id),
    tournUpcoming: tourns.getPlayerTournamentUpcoming(id),
    ladderStats: ladder.getPlayerLadderStats(id),
    ladderHistory: ladder.getPlayerLadderHistory(id),
    ratingDeltas: ladder.getPlayerMatchRatingDeltas(id),
  };
}

// --- leagues --------------------------------------------------------------
out.leagues = {};
for (const l of leagues.getAllLeagues()) {
  const weeks = leagues.getWeeks(l.id);
  const perWeek = {};
  for (const w of weeks) {
    const matchups = leagues.getMatchups(w.id);
    perWeek[w.id] = matchups.map(mu => ({ matchup: mu, matches: leagues.getMatches(mu.id) }));
  }
  out.leagues[l.id] = {
    league: leagues.getLeagueById(l.id),
    weeks, perWeek,
    byes: weeks.map(w => leagues.getWeekByes(w.id)),
    players: leagues.getLeaguePlayers(l.id),
    divisions: leagues.getDivisions(l.id),
  };
}

// --- schedule -------------------------------------------------------------
// Every date any match or booking touches.
// A fixed date set, so before and after are compared over the same days.
const dates = db.prepare(`
  SELECT DISTINCT d FROM (
    SELECT date AS d FROM bookings
    UNION SELECT date FROM weeks
  ) WHERE d IS NOT NULL ORDER BY d
`).all().map(r => r.d);
out.scheduleDates = dates;
out.schedule = {};
for (const d of dates) out.schedule[d] = bookings.getScheduleForDate(d);

// --- seasons --------------------------------------------------------------
out.seasonList = seasons.getAllSeasons();
out.activityBounds = seasons.getActivityBounds();

console.log(JSON.stringify(out, null, 1));
