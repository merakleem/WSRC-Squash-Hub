// ===== MATCHES =====
// The single source of truth for every match the club has played or will play.
//
// League, ladder and tournament matches share one table. What differs between
// them is context, not identity: a league match carries a week and a matchup, a
// tournament match a round and a bracket slot, a ladder match neither. Callers
// filter this table rather than assembling their own union of three, which is
// what used to let a player's record and their match history disagree about the
// same match.
//
// `type`   league | ladder | tournament
// `status` unscheduled | scheduled | played
//   unscheduled - exists and can be scored, but is not on the live schedule
//   scheduled   - has a court and a time, so it appears on the schedule grid
//   played      - a score has been reported
//
// Dates: `scheduled_date`/`scheduled_time` are when it is meant to happen,
// `played_at` when it actually did. They are separate on purpose - the second
// is editable after the fact, the first is what the schedule draws.

const { getDB } = require('../database/db');

const TYPES = ['league', 'ladder', 'tournament'];
const STATUSES = ['unscheduled', 'scheduled', 'played'];

// The API has always called a ladder match "pickup". Kept as the outward name
// so this change is structural only; renaming it is a separate, visible step.
const SOURCE_OF_TYPE = `CASE m.type WHEN 'ladder' THEN 'pickup' ELSE m.type END`;

// League matches can be played by a substitute. Everything that counts results
// must credit whoever actually played, so the effective player is resolved
// here, once, rather than in each caller.
const EFF_JOIN = `
  LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
  LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
`;
const EFF_P1 = `COALESCE(s1.sub_player_id, m.player1_id)`;
const EFF_P2 = `COALESCE(s2.sub_player_id, m.player2_id)`;

// A match counts towards records and the ladder once it has a winner, has two
// real players, and was not skipped.
const COUNTS = `
  m.winner_id IS NOT NULL
  AND m.player1_id IS NOT NULL AND m.player2_id IS NOT NULL
  AND (m.skipped = 0 OR m.skipped IS NULL)
`;

// Which side won: 1 or 2.
//
// Taken from the score, not from winner_id. When a substitute plays, winner_id
// has been written inconsistently - sometimes naming the substitute, sometimes
// the player they stood in for - so comparing it against either one gets some
// matches backwards. The scores have no such ambiguity: across every scored
// match in the club's history they agree on which side won. Tournament matches
// keep their detail in `scores` rather than as game counts, so they fall back
// to winner_id, which is unambiguous there because tournaments have no subs.
const WON_SIDE = `
  CASE
    WHEN m.player1_score IS NOT NULL AND m.player2_score IS NOT NULL
      THEN CASE WHEN m.player1_score > m.player2_score THEN 1 ELSE 2 END
    WHEN m.winner_id = m.player1_id THEN 1
    WHEN m.winner_id = m.player2_id THEN 2
  END
`;

/**
 * Every completed match, oldest first, for the ladder replay.
 *
 * `range` is { start, end } as YYYY-MM-DD, or null for all time: which season a
 * match belongs to is decided by when it was played, not by a stored link.
 *
 * Ordering matters more than it looks. Ratings are replayed in this order, so
 * two matches sharing a date must always resolve the same way. The sort is done
 * in JS and is stable, over rows read in a fixed type-then-id order, which is
 * the order the three separate queries used to produce.
 */
function getCompletedMatches(range = null) {
  const rows = getDB().prepare(`
    SELECT
      m.id AS match_id,
      ${SOURCE_OF_TYPE} AS source,
      m.winner_id, m.player1_id, m.player2_id,
      ${EFF_P1} AS eff_p1_id,
      ${EFF_P2} AS eff_p2_id,
      ${WON_SIDE} AS won_side,
      CASE WHEN ${WON_SIDE} = 1 THEN ${EFF_P1} ELSE ${EFF_P2} END AS eff_winner_id,
      CASE WHEN ${WON_SIDE} = 1 THEN ${EFF_P2} ELSE ${EFF_P1} END AS eff_loser_id,
      m.played_at AS sort_key
    FROM matches m
    ${EFF_JOIN}
    WHERE ${COUNTS}
      ${range ? 'AND substr(m.played_at, 1, 10) BETWEEN @start AND @end' : ''}
    ORDER BY CASE m.type WHEN 'league' THEN 0 WHEN 'tournament' THEN 1 ELSE 2 END, m.id
  `).all(range ? { start: range.start, end: range.end } : {});

  return rows.sort((a, b) => (a.sort_key || '').localeCompare(b.sort_key || '') || 0);
}

/** Each player's most recent match day, for the ladder's inactivity rules. */
function getLastMatchDates() {
  const rows = getDB().prepare(`
    SELECT player_id, MAX(d) AS last_date FROM (
      SELECT ${EFF_P1} AS player_id, m.played_at AS d FROM matches m ${EFF_JOIN} WHERE ${COUNTS}
      UNION ALL
      SELECT ${EFF_P2},               m.played_at    FROM matches m ${EFF_JOIN} WHERE ${COUNTS}
    ) WHERE player_id IS NOT NULL AND d IS NOT NULL
    GROUP BY player_id
  `).all();
  return Object.fromEntries(rows.map((r) => [r.player_id, String(r.last_date).slice(0, 10)]));
}

/**
 * One row per player per completed match, with whether they won.
 *
 * The basis for every win/loss count. A substitute is credited with the result;
 * the player they stood in for is not counted, since they did not play.
 */
function getParticipation() {
  return getDB().prepare(`
    SELECT ${EFF_P1} AS player_id, (${WON_SIDE} = 1) AS won, m.id AS match_id
    FROM matches m ${EFF_JOIN} WHERE ${COUNTS}
    UNION ALL
    SELECT ${EFF_P2},              (${WON_SIDE} = 2),      m.id
    FROM matches m ${EFF_JOIN} WHERE ${COUNTS}
  `).all();
}

module.exports = {
  TYPES, STATUSES,
  SOURCE_OF_TYPE, EFF_JOIN, EFF_P1, EFF_P2, COUNTS, WON_SIDE,
  getCompletedMatches, getLastMatchDates, getParticipation,
};
