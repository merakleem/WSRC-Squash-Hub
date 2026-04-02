const { run, all, get } = require('../database/db');

/**
 * Return all players in ladder order.
 * Any players not yet in the ladder are appended alphabetically first.
 */
async function getLadder() {
  // Append any players missing from the ladder (e.g. pre-existing or just added)
  const unranked = await all(`
    SELECT p.id FROM players p
    LEFT JOIN ladder l ON p.id = l.player_id
    WHERE l.player_id IS NULL
    ORDER BY p.name ASC
  `);
  for (const p of unranked) {
    await appendToLadder(p.id);
  }
  return all(`
    SELECT l.position, p.id, p.name, p.email, p.phone, p.wsrc_member, p.club_locker_rating
    FROM ladder l
    JOIN players p ON l.player_id = p.id
    ORDER BY l.position ASC
  `);
}

/**
 * Replace the entire ladder with a new ordered list of player IDs.
 */
async function setLadder(playerIds) {
  await run('DELETE FROM ladder');
  for (let i = 0; i < playerIds.length; i++) {
    await run('INSERT INTO ladder (player_id, position) VALUES (?, ?)', [playerIds[i], i + 1]);
  }
}

/**
 * Append a single player to the bottom of the ladder.
 * Uses INSERT OR IGNORE so it's safe to call even if they're already present.
 */
async function appendToLadder(playerId) {
  const row = await get('SELECT MAX(position) AS maxPos FROM ladder');
  const newPos = (row?.maxPos || 0) + 1;
  await run('INSERT OR IGNORE INTO ladder (player_id, position) VALUES (?, ?)', [playerId, newPos]);
}

module.exports = { getLadder, setLadder, appendToLadder };
