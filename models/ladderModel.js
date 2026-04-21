const { all } = require('../database/db');

/**
 * Compute the current ladder ranking.
 *
 * Initial order: club_locker_rating DESC (NULLs last, then alphabetical).
 * Then each confirmed match is replayed chronologically:
 *   - If the lower-ranked player wins, they jump up to the loser's position
 *     and everyone between shifts down one.
 *   - If the higher-ranked player wins, no change.
 */
async function getLadder() {
  const players = await all(`
    SELECT id, name, email, phone, exclude_from_ladder, club_locker_rating
    FROM players
    WHERE exclude_from_ladder = 0 OR exclude_from_ladder IS NULL
    ORDER BY
      CASE WHEN club_locker_rating IS NULL THEN 1 ELSE 0 END ASC,
      club_locker_rating DESC,
      name ASC
  `);

  const matches = await all(`
    SELECT
      m.winner_id,
      m.player1_id,
      m.player2_id,
      COALESCE(s1.sub_player_id, m.player1_id) AS eff_p1_id,
      COALESCE(s2.sub_player_id, m.player2_id) AS eff_p2_id,
      COALESCE(m.confirmed_at, w.date) AS sort_key
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w ON tm.week_id = w.id
    LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
    LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
    WHERE m.winner_id IS NOT NULL
      AND (m.skipped = 0 OR m.skipped IS NULL)
    ORDER BY sort_key ASC, m.id ASC
  `);

  const playerIds = new Set(players.map((p) => p.id));
  let ranking = players.map((p) => p.id);

  for (const match of matches) {
    const effWinnerId = match.winner_id === match.player1_id ? match.eff_p1_id : match.eff_p2_id;
    const effLoserId  = match.winner_id === match.player1_id ? match.eff_p2_id : match.eff_p1_id;

    // Skip if either player is excluded from ladder
    if (!playerIds.has(effWinnerId) || !playerIds.has(effLoserId)) continue;

    const winnerIdx = ranking.indexOf(effWinnerId);
    const loserIdx  = ranking.indexOf(effLoserId);

    if (winnerIdx === -1 || loserIdx === -1) continue;
    if (winnerIdx <= loserIdx) continue; // winner already ranked higher — no change

    // Lower-ranked player won: move them up to the loser's position
    ranking.splice(winnerIdx, 1);
    ranking.splice(loserIdx, 0, effWinnerId);
  }

  // Snapshot the ranking before any match from the past 7 days was applied,
  // so we can compute how many spots each player has moved recently.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let rankingSevenDaysAgo = null;

  // Replay again from the top, this time stopping at the cutoff
  let replayRanking = players.map((p) => p.id);
  for (const match of matches) {
    if (rankingSevenDaysAgo === null && (match.sort_key || '') >= cutoff) {
      rankingSevenDaysAgo = [...replayRanking];
    }
    const effWinnerId = match.winner_id === match.player1_id ? match.eff_p1_id : match.eff_p2_id;
    const effLoserId  = match.winner_id === match.player1_id ? match.eff_p2_id : match.eff_p1_id;
    if (!playerIds.has(effWinnerId) || !playerIds.has(effLoserId)) continue;
    const wi = replayRanking.indexOf(effWinnerId);
    const li = replayRanking.indexOf(effLoserId);
    if (wi === -1 || li === -1 || wi <= li) continue;
    replayRanking.splice(wi, 1);
    replayRanking.splice(li, 0, effWinnerId);
  }
  if (rankingSevenDaysAgo === null) rankingSevenDaysAgo = [...ranking];

  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));
  return ranking.map((id, i) => {
    const oldIdx = rankingSevenDaysAgo.indexOf(id);
    const rankChange = oldIdx !== -1 ? (oldIdx + 1) - (i + 1) : 0; // positive = moved up
    return { ...playerMap[id], position: i + 1, rank_change: rankChange };
  });
}

module.exports = { getLadder };
