const { getDB } = require('../database/db');
const seasons = require('../lib/seasons');

// Seasons are derived from two settings rather than stored as rows: a recurring
// month/day that splits history, and the season ratings took over from. Nothing
// is created, assigned or marked current, so none of it can be forgotten or
// drift out of step with the data.

function getSettings() {
  const rows = getDB().prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function getStartMonthDay(settings = null) {
  return seasons.startMonthDay(settings || getSettings());
}

/** Earliest and latest recorded activity, which bound the season list. */
function getActivityBounds() {
  const row = getDB().prepare(`
    SELECT MIN(d) AS earliest, MAX(d) AS latest FROM (
      SELECT substr(COALESCE(m.confirmed_at, w.date), 1, 10) AS d
        FROM matches m
        JOIN team_matchups tm ON m.matchup_id = tm.id
        JOIN weeks w ON tm.week_id = w.id
      UNION ALL SELECT substr(COALESCE(confirmed_at, match_date), 1, 10) FROM tournament_matches
      UNION ALL SELECT substr(played_at, 1, 10) FROM pickup_matches
      UNION ALL SELECT substr(start_date, 1, 10) FROM leagues
    ) WHERE d IS NOT NULL
  `).get();
  return { earliest: row?.earliest || null, latest: row?.latest || null };
}

function getEarliestActivityDate() {
  const row = getDB().prepare(`
    SELECT MIN(d) AS d FROM (
      SELECT MIN(substr(COALESCE(m.confirmed_at, w.date), 1, 10)) AS d
        FROM matches m
        JOIN team_matchups tm ON m.matchup_id = tm.id
        JOIN weeks w ON tm.week_id = w.id
      UNION ALL SELECT MIN(substr(COALESCE(confirmed_at, match_date), 1, 10)) FROM tournament_matches
      UNION ALL SELECT MIN(substr(played_at, 1, 10)) FROM pickup_matches
      UNION ALL SELECT MIN(start_date) FROM leagues
    ) WHERE d IS NOT NULL
  `).get();
  return row?.d || null;
}

/** Every season from the first recorded activity to today, newest first. */
function getAllSeasons() {
  const settings = getSettings();
  const monthDay = seasons.startMonthDay(settings);
  const bounds = getActivityBounds();
  const list = seasons.listSeasons({
    earliestDate: bounds.earliest,
    latestDate: bounds.latest,
    monthDay,
  });
  // The oldest season in the list is the club's first, and keeps the original
  // positional ladder; everything after it is rated.
  const firstKey = list.length ? list[list.length - 1].key : null;
  return list.map((s) => ({ ...s, ladder_system: seasons.ladderSystemFor(s.key, firstKey) }));
}

/**
 * Seasons offered in the settings dropdown: everything so far plus the one
 * coming next, so the rating ladder can be scheduled ahead of the switchover.
 */
function getSelectableSeasons() {
  const all = getAllSeasons();
  const monthDay = getStartMonthDay();
  const newest = all[0];
  if (!newest) return all;
  const nextYear = seasons.seasonStartYear(newest.key) + 1;
  const nextKey = monthDay === '01-01'
    ? String(nextYear)
    : `${nextYear}/${String((nextYear + 1) % 100).padStart(2, '0')}`;
  if (all.some((s) => s.key === nextKey)) return all;
  const range = seasons.seasonRange(nextKey, monthDay);
  return [{
    key: nextKey, id: nextKey, name: nextKey,
    start_date: range.start, end_date: range.end,
    is_current: false, status: 'upcoming',
    ladder_system: 'elo',
  }, ...all];
}

function getSeasonByKey(key) {
  return getAllSeasons().find((s) => s.key === String(key)) || null;
}

function getCurrentSeason() {
  const all = getAllSeasons();
  return all.find((s) => s.is_current) || all[0] || null;
}

function getCurrentSeasonKey() {
  return seasons.currentSeasonKey(getStartMonthDay());
}

/** The season a given match date falls in. */
function seasonKeyForDate(date, settings = null) {
  return seasons.seasonKeyForDate(date, seasons.startMonthDay(settings || getSettings()));
}

/**
 * How much data each season holds. Counted by date rather than by a stored
 * link, so it always reflects where the matches actually are.
 */
function getSeasonUsage(key) {
  const db = getDB();
  const range = seasons.seasonRange(key, getStartMonthDay());
  if (!range) return { leagues: 0, tournaments: 0, matches: 0 };
  const p = { start: range.start, end: range.end };
  const count = (sql) => db.prepare(sql).get(p).count;
  return {
    leagues: count(`SELECT COUNT(DISTINCT l.id) AS count FROM leagues l
                    WHERE substr(l.start_date, 1, 10) BETWEEN @start AND @end`),
    tournaments: count(`SELECT COUNT(*) AS count FROM tournaments
                        WHERE substr(championship_date, 1, 10) BETWEEN @start AND @end`),
    matches: count(`
      SELECT (
        (SELECT COUNT(*) FROM matches m
           JOIN team_matchups tm ON m.matchup_id = tm.id
           JOIN weeks w ON tm.week_id = w.id
          WHERE m.winner_id IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)
            AND substr(COALESCE(m.confirmed_at, w.date), 1, 10) BETWEEN @start AND @end)
      + (SELECT COUNT(*) FROM tournament_matches
          WHERE winner_id IS NOT NULL
            AND substr(COALESCE(confirmed_at, match_date), 1, 10) BETWEEN @start AND @end)
      + (SELECT COUNT(*) FROM pickup_matches
          WHERE substr(played_at, 1, 10) BETWEEN @start AND @end)
      ) AS count`),
  };
}

function updateSettings({ season_start_md }) {
  const db = getDB();
  if (season_start_md) {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    ).run('season_start_md', season_start_md);
  }
  return getAllSeasons();
}

/** The club's first season, which keeps the positional ladder. */
function getFirstSeasonKey() {
  const all = getAllSeasons();
  return all.length ? all[all.length - 1].key : null;
}

module.exports = {
  getSettings, getStartMonthDay, getAllSeasons, getSeasonByKey, getCurrentSeason,
  getCurrentSeasonKey, seasonKeyForDate, getSeasonUsage, updateSettings,
  getEarliestActivityDate, getActivityBounds, getSelectableSeasons, getFirstSeasonKey,
};
