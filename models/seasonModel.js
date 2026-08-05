const { getDB } = require('../database/db');

function getAllSeasons() {
  return getDB().prepare('SELECT * FROM seasons ORDER BY start_date DESC').all();
}

function getSeasonById(id) {
  return getDB().prepare('SELECT * FROM seasons WHERE id = ?').get(Number(id));
}

/**
 * The season new leagues, tournaments and pickup matches are filed under.
 * Falls back to the most recent season if no flag is set, so records are never
 * orphaned just because an admin cleared the flag.
 */
function getCurrentSeason() {
  const db = getDB();
  return db.prepare('SELECT * FROM seasons WHERE is_current = 1').get()
    || db.prepare('SELECT * FROM seasons ORDER BY start_date DESC LIMIT 1').get()
    || null;
}

function getCurrentSeasonId() {
  return getCurrentSeason()?.id ?? null;
}

const LADDER_SYSTEMS = ['leapfrog', 'elo'];
const _system = (value) => (LADDER_SYSTEMS.includes(value) ? value : 'leapfrog');

function addSeason({ name, start_date, end_date, is_current, ladder_system }) {
  const db = getDB();
  const result = db.prepare(
    'INSERT INTO seasons (name, start_date, end_date, is_current, ladder_system) VALUES (?, ?, ?, 0, ?)'
  ).run(name, start_date, end_date, _system(ladder_system));
  if (is_current) setCurrentSeason(result.lastInsertRowid);
  return getSeasonById(result.lastInsertRowid);
}

function updateSeason({ id, name, start_date, end_date, is_current, ladder_system }) {
  const db = getDB();
  db.prepare('UPDATE seasons SET name = ?, start_date = ?, end_date = ?, ladder_system = ? WHERE id = ?')
    .run(name, start_date, end_date, _system(ladder_system), Number(id));
  // Promoting is supported; demoting is not, because "no current season" is not
  // a valid state. To move it, promote a different season instead.
  if (is_current) setCurrentSeason(id);
  return getSeasonById(id);
}

// Exactly one season is current — clearing the others is part of setting one.
function setCurrentSeason(id) {
  const db = getDB();
  const tx = db.transaction((seasonId) => {
    db.prepare('UPDATE seasons SET is_current = 0').run();
    db.prepare('UPDATE seasons SET is_current = 1 WHERE id = ?').run(seasonId);
  });
  tx(Number(id));
  return getSeasonById(id);
}

/**
 * How much data a season holds. Used to warn before deleting one and to hide
 * empty seasons from the player profile tab bar.
 */
function getSeasonUsage(id) {
  const db = getDB();
  const seasonId = Number(id);
  const count = (sql) => db.prepare(sql).get(seasonId).count;
  return {
    leagues:     count('SELECT COUNT(*) AS count FROM leagues WHERE season_id = ?'),
    tournaments: count('SELECT COUNT(*) AS count FROM tournaments WHERE season_id = ?'),
    pickups:     count('SELECT COUNT(*) AS count FROM pickup_matches WHERE season_id = ?'),
  };
}

/**
 * Delete a season, detaching anything filed under it rather than cascading.
 * Losing a season label must never destroy league or match history.
 */
function deleteSeason(id) {
  const db = getDB();
  const seasonId = Number(id);
  const tx = db.transaction(() => {
    const wasCurrent = db.prepare('SELECT is_current FROM seasons WHERE id = ?').get(seasonId)?.is_current;

    db.prepare('UPDATE leagues SET season_id = NULL WHERE season_id = ?').run(seasonId);
    db.prepare('UPDATE tournaments SET season_id = NULL WHERE season_id = ?').run(seasonId);
    db.prepare('UPDATE pickup_matches SET season_id = NULL WHERE season_id = ?').run(seasonId);
    db.prepare('DELETE FROM seasons WHERE id = ?').run(seasonId);

    // Deleting the current season must not leave the club with none — new
    // records would otherwise be filed under whichever season happens to sort
    // last, which can be one that has not started yet.
    if (wasCurrent) {
      const today = new Date().toISOString().slice(0, 10);
      const replacement =
        db.prepare('SELECT id FROM seasons WHERE start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1').get(today, today)
        || db.prepare('SELECT id FROM seasons WHERE start_date <= ? ORDER BY start_date DESC LIMIT 1').get(today)
        || db.prepare('SELECT id FROM seasons ORDER BY start_date ASC LIMIT 1').get();
      if (replacement) db.prepare('UPDATE seasons SET is_current = 1 WHERE id = ?').run(replacement.id);
    }
  });
  tx();
}

module.exports = {
  getAllSeasons, getSeasonById, getCurrentSeason, getCurrentSeasonId,
  addSeason, updateSeason, setCurrentSeason, deleteSeason, getSeasonUsage,
};
