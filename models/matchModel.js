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

// Singles or doubles. Every singles reader - the ladder replay, records,
// history, head to head, the feed - goes through COUNTS below, so this one
// clause is what keeps a doubles result out of all of them.
const SINGLES = `m.format = 'singles'`;
const DOUBLES = `m.format = 'doubles'`;

// A singles match counts towards records and the ladder once it has a winner,
// has two real players, and was not skipped.
const COUNTS = `
  m.winner_id IS NOT NULL
  AND m.player1_id IS NOT NULL AND m.player2_id IS NOT NULL
  AND (m.skipped = 0 OR m.skipped IS NULL)
  AND ${SINGLES}
`;

// The doubles equivalent: four real players and a winner.
const COUNTS_DOUBLES = `
  m.winner_id IS NOT NULL
  AND m.player1_id IS NOT NULL AND m.player2_id IS NOT NULL
  AND m.player1_partner_id IS NOT NULL AND m.player2_partner_id IS NOT NULL
  AND (m.skipped = 0 OR m.skipped IS NULL)
  AND ${DOUBLES}
`;

// Substitutes for the partner slots, on top of EFF_JOIN's s1/s2. A sub is
// keyed by the player they stand in for, so either partner can be replaced
// for a night the same way a singles player can.
const DBL_JOIN = `
  ${EFF_JOIN}
  LEFT JOIN match_subs s3 ON s3.match_id = m.id AND s3.original_player_id = m.player1_partner_id
  LEFT JOIN match_subs s4 ON s4.match_id = m.id AND s4.original_player_id = m.player2_partner_id
`;
const EFF_P1B = `COALESCE(s3.sub_player_id, m.player1_partner_id)`;
const EFF_P2B = `COALESCE(s4.sub_player_id, m.player2_partner_id)`;

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
      -- Games each side took, so the ladder can weigh a 3-0 differently from a
      -- 3-2. Follows the winning side rather than player1, and a substitution
      -- swaps who played, never what the score was.
      CASE WHEN ${WON_SIDE} = 1 THEN m.player1_score ELSE m.player2_score END AS winner_games,
      CASE WHEN ${WON_SIDE} = 1 THEN m.player2_score ELSE m.player1_score END AS loser_games,
      m.played_at AS sort_key
    FROM matches m
    ${EFF_JOIN}
    WHERE ${COUNTS}
      ${range ? 'AND substr(m.played_at, 1, 10) BETWEEN @start AND @end' : ''}
    ORDER BY CASE m.type WHEN 'league' THEN 0 WHEN 'tournament' THEN 1 ELSE 2 END, m.id
  `).all(range ? { start: range.start, end: range.end } : {});

  return rows.sort((a, b) => (a.sort_key || '').localeCompare(b.sort_key || '') || 0);
}

/**
 * Each player's most recent match day, which is how the ladder knows who has
 * played at all and so who is on it.
 *
 * `asOf` (YYYY-MM-DD) ignores anything played after that date, so a past
 * season's ladder is judged by what had happened at the time rather than by
 * what has happened since.
 */
function getLastMatchDates(asOf = null) {
  const rows = getDB().prepare(`
    SELECT player_id, MAX(d) AS last_date FROM (
      SELECT ${EFF_P1} AS player_id, m.played_at AS d FROM matches m ${EFF_JOIN} WHERE ${COUNTS}
      UNION ALL
      SELECT ${EFF_P2},               m.played_at    FROM matches m ${EFF_JOIN} WHERE ${COUNTS}
    ) WHERE player_id IS NOT NULL AND d IS NOT NULL
      ${asOf ? 'AND substr(d, 1, 10) <= @asOf' : ''}
    GROUP BY player_id
  `).all(asOf ? { asOf } : {});
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


// ===== DOUBLES =====

/**
 * Every completed doubles match, oldest first, for the doubles rating replay.
 * Substitutes are resolved on all four slots. Same ordering rule as singles.
 */
function getCompletedDoublesMatches(range = null) {
  const rows = getDB().prepare(`
    SELECT
      m.id AS match_id,
      ${SOURCE_OF_TYPE} AS source,
      m.type, m.league_id, m.pair1_id, m.pair2_id,
      ${EFF_P1}  AS s1a, ${EFF_P1B} AS s1b,
      ${EFF_P2}  AS s2a, ${EFF_P2B} AS s2b,
      ${WON_SIDE} AS won_side,
      CASE WHEN ${WON_SIDE} = 1 THEN m.player1_score ELSE m.player2_score END AS winner_games,
      CASE WHEN ${WON_SIDE} = 1 THEN m.player2_score ELSE m.player1_score END AS loser_games,
      m.played_at AS sort_key
    FROM matches m
    ${DBL_JOIN}
    WHERE ${COUNTS_DOUBLES}
      ${range ? 'AND substr(m.played_at, 1, 10) BETWEEN @start AND @end' : ''}
    ORDER BY m.id
  `).all(range ? { start: range.start, end: range.end } : {});
  return rows.sort((a, b) => (a.sort_key || '').localeCompare(b.sort_key || '') || 0);
}

const _DOUBLES_DAYS = `
  SELECT ${EFF_P1}  AS player_id, m.played_at AS d FROM matches m ${DBL_JOIN} WHERE ${COUNTS_DOUBLES}
  UNION ALL SELECT ${EFF_P1B}, m.played_at FROM matches m ${DBL_JOIN} WHERE ${COUNTS_DOUBLES}
  UNION ALL SELECT ${EFF_P2},  m.played_at FROM matches m ${DBL_JOIN} WHERE ${COUNTS_DOUBLES}
  UNION ALL SELECT ${EFF_P2B}, m.played_at FROM matches m ${DBL_JOIN} WHERE ${COUNTS_DOUBLES}
`;

/** Each player's most recent doubles match day - who is on the doubles ladder. */
function getLastDoublesMatchDates(asOf = null) {
  const rows = getDB().prepare(`
    SELECT player_id, MAX(d) AS last_date FROM (${_DOUBLES_DAYS})
    WHERE player_id IS NOT NULL AND d IS NOT NULL
      ${asOf ? 'AND substr(d, 1, 10) <= @asOf' : ''}
    GROUP BY player_id
  `).all(asOf ? { asOf } : {});
  return Object.fromEntries(rows.map((r) => [r.player_id, String(r.last_date).slice(0, 10)]));
}

/** Each player's first doubles match day, for the join-date rule. */
function getFirstDoublesMatchDates() {
  const rows = getDB().prepare(`
    SELECT player_id, MIN(d) AS first_date FROM (${_DOUBLES_DAYS})
    WHERE player_id IS NOT NULL AND d IS NOT NULL
    GROUP BY player_id
  `).all();
  return Object.fromEntries(rows.map((r) => [r.player_id, String(r.first_date).slice(0, 10)]));
}

// ladderModel already requires this module, so it is required back lazily -
// at load time it would hand us a half-built one.
function ladderStatsFor(ids) {
  const { getLadderForSeason } = require('./ladderModel');
  const { rows } = getLadderForSeason();
  const byId = Object.fromEntries(rows.map((r) => [r.id, { position: r.position, rating: r.rating ?? null }]));
  return Object.fromEntries(ids.filter(Boolean).map((id) => [id, byId[id] || null]));
}

function doublesLadderStatsFor(ids) {
  const { getDoublesLadderForSeason } = require('./ladderModel');
  const { rows } = getDoublesLadderForSeason();
  const byId = Object.fromEntries(rows.map((r) => [r.id, { position: r.position, rating: r.rating ?? null }]));
  return Object.fromEntries(ids.filter(Boolean).map((id) => [id, byId[id] || null]));
}

/**
 * Head to head between two exact pairs: the same four players in the same
 * partnerships, either side order. `winner_side` is 1 when side A won.
 */
function getDoublesHeadToHead(sideA, sideB, { limit = 5 } = {}) {
  const same = (x, y) => x.length === 2 && y.length === 2 && x[0] !== x[1] && ((x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]));
  const rows = getCompletedDoublesMatches()
    .filter((m) => (same([m.s1a, m.s1b], sideA) && same([m.s2a, m.s2b], sideB)) || (same([m.s1a, m.s1b], sideB) && same([m.s2a, m.s2b], sideA)))
    .sort((a, b) => (b.sort_key || '').localeCompare(a.sort_key || ''));
  let aWins = 0, bWins = 0;
  const meetings = rows.map((m) => {
    const aIsSide1 = same([m.s1a, m.s1b], sideA);
    const winnerSide = (m.won_side === 1) === aIsSide1 ? 1 : 2;
    if (winnerSide === 1) aWins++; else bWins++;
    const score = m.winner_games == null ? null : `${m.winner_games}\u2013${m.loser_games}`;
    return { id: m.match_id, type: m.type, played_at: m.sort_key, winner_side: winnerSide, score };
  });
  return { aWins, bWins, total: rows.length, meetings: meetings.slice(0, limit) };
}

// The rating map is keyed on the outward source name, not the type.
function _ratingKey(type, id) {
  return `${type === 'ladder' ? 'pickup' : type}:${id}`;
}

/**
 * Head to head between two players, across every kind of match.
 *
 * Compares the effective players, so a match someone played as a substitute
 * counts for them and not for the player they stood in for, and reads the
 * winner from the score - the same rules the ladder and the records use, so a
 * card can never disagree with the profile behind it.
 */
function getHeadToHead(playerA, playerB, { limit = 5 } = {}) {
  const rows = getDB().prepare(`
    SELECT m.id, m.type, m.played_at, m.player1_score, m.player2_score, m.scores,
           ${EFF_P1} AS eff_p1_id,
           ${EFF_P2} AS eff_p2_id,
           ${WON_SIDE} AS won_side
    FROM matches m ${EFF_JOIN}
    WHERE ${COUNTS}
      AND ((${EFF_P1} = @a AND ${EFF_P2} = @b) OR (${EFF_P1} = @b AND ${EFF_P2} = @a))
    ORDER BY m.played_at DESC
  `).all({ a: Number(playerA), b: Number(playerB) });

  let aWins = 0, bWins = 0;
  const meetings = rows.map((r) => {
    const winnerId = r.won_side === 1 ? r.eff_p1_id : r.eff_p2_id;
    if (winnerId === Number(playerA)) aWins++; else bWins++;
    // Games won by each side, oriented winner-first, which is how a squash
    // score is read aloud.
    let hi = r.player1_score, lo = r.player2_score;
    if (hi == null || lo == null) { hi = null; lo = null; }
    else if (r.won_side === 2) { [hi, lo] = [lo, hi]; }
    return {
      id: r.id,
      type: r.type,
      played_at: r.played_at,
      winner_id: winnerId,
      score: hi == null ? null : `${hi}\u2013${lo}`,
    };
  });

  return { aWins, bWins, total: rows.length, meetings: meetings.slice(0, limit) };
}

/**
 * Everything the match card shows, for one match.
 *
 * `viewerId` decides only two things: which player gets the "you" ring, and
 * whether a score can be submitted from the card. Anyone signed in may look at
 * any match.
 */
function getMatchCard(matchId, viewerId = null) {
  const db = getDB();
  const m = db.prepare(`
    SELECT m.*,
           ${EFF_P1} AS eff_p1_id,
           ${EFF_P2} AS eff_p2_id,
           ${EFF_P1B} AS eff_p1b_id,
           ${EFF_P2B} AS eff_p2b_id,
           ${WON_SIDE} AS won_side,
           p1.name AS p1_name, p1.photo_path AS p1_photo,
           p2.name AS p2_name, p2.photo_path AS p2_photo,
           p1b.name AS p1b_name, p1b.photo_path AS p1b_photo,
           p2b.name AS p2b_name, p2b.photo_path AS p2b_photo,
           c.name  AS court_name,
           l.name  AS league_name,
           d.name  AS division_name,
           w.week_number,
           t.name  AS tournament_name
    FROM matches m ${DBL_JOIN}
    LEFT JOIN players p1 ON p1.id = ${EFF_P1}
    LEFT JOIN players p2 ON p2.id = ${EFF_P2}
    LEFT JOIN players p1b ON p1b.id = ${EFF_P1B}
    LEFT JOIN players p2b ON p2b.id = ${EFF_P2B}
    LEFT JOIN courts c      ON c.id = m.court_id
    LEFT JOIN leagues l     ON l.id = m.league_id
    LEFT JOIN divisions d   ON d.id = m.division_id
    LEFT JOIN weeks w       ON w.id = m.week_id
    LEFT JOIN tournaments t ON t.id = m.tournament_id
    WHERE m.id = ?
  `).get(Number(matchId));
  if (!m) return null;

  const viewer = viewerId == null ? null : Number(viewerId);
  const isPlayed = m.status === 'played';

  // Games won, oriented to each player.
  const scoreFor = (side) => (side === 1 ? m.player1_score : m.player2_score);

  const players = [1, 2].map((side) => {
    const id = side === 1 ? m.eff_p1_id : m.eff_p2_id;
    return {
      id,
      name: side === 1 ? m.p1_name : m.p2_name,
      photo_path: side === 1 ? m.p1_photo : m.p2_photo,
      games: scoreFor(side),
      won: isPlayed && m.won_side === side,
      is_viewer: viewer != null && id === viewer,
    };
  });

  // A player may take part without being on the ladder, so a missing position
  // is expected rather than an error.
  const ladder = ladderStatsFor(players.map((p) => p.id));
  players.forEach((p) => { p.position = ladder[p.id]?.position ?? null; p.rating = ladder[p.id]?.rating ?? null; });

  // A rating only moves in a rated season, so a played match may legitimately
  // have no delta. It is symmetric: what one player gains the other loses.
  if (isPlayed) {
    const { getPlayerMatchRatingDeltas } = require('./ladderModel');
    const delta = getPlayerMatchRatingDeltas(players[0].id)[_ratingKey(m.type, m.id)];
    if (delta !== undefined) {
      players[0].rating_change = delta;
      players[1].rating_change = -delta;
    }
  }

  // A doubles match: two sides of two, each player with their own doubles
  // rank, rating and rating change, and a head to head between the exact
  // pairs. `players` keeps side 1's and side 2's first player for readers
  // that predate doubles; nothing in a doubles card should read it.
  let doubles = {};
  if (m.format === 'doubles') {
    const sideIds = [[m.eff_p1_id, m.eff_p1b_id], [m.eff_p2_id, m.eff_p2b_id]];
    const meta = {
      [m.eff_p1_id]: { name: m.p1_name, photo_path: m.p1_photo },
      [m.eff_p1b_id]: { name: m.p1b_name, photo_path: m.p1b_photo },
      [m.eff_p2_id]: { name: m.p2_name, photo_path: m.p2_photo },
      [m.eff_p2b_id]: { name: m.p2b_name, photo_path: m.p2b_photo },
    };
    const dl = doublesLadderStatsFor(sideIds.flat());
    const deltas = isPlayed ? require('./ladderModel').getDoublesMatchDeltas(m.id) : {};
    const sides = sideIds.map((ids, i) => ({
      players: ids.map((id) => ({
        id,
        name: meta[id]?.name || null,
        photo_path: meta[id]?.photo_path || null,
        position: dl[id]?.position ?? null,
        rating: dl[id]?.rating ?? null,
        ...(deltas[id] === undefined ? {} : { rating_change: deltas[id] }),
        is_viewer: viewer != null && id === viewer,
      })),
      games: scoreFor(i + 1),
      won: isPlayed && m.won_side === i + 1,
    }));
    const allFour = sideIds.flat().every(Boolean);
    doubles = {
      format: 'doubles',
      sides,
      head_to_head: allFour ? getDoublesHeadToHead(sideIds[0], sideIds[1]) : { aWins: 0, bWins: 0, total: 0, meetings: [] },
      can_submit_score: viewer != null && !isPlayed && m.type !== 'tournament' && !m.skipped && sideIds.flat().includes(viewer),
    };
  }

  const h2h = m.format !== 'doubles' && players[0].id && players[1].id
    ? getHeadToHead(players[0].id, players[1].id)
    : { aWins: 0, bWins: 0, total: 0, meetings: [] };

  return {
    id: m.id,
    type: m.type,
    status: m.status,
    format: m.format || 'singles',
    players,
    score: isPlayed && m.player1_score != null
      ? `${Math.max(m.player1_score, m.player2_score)}\u2013${Math.min(m.player1_score, m.player2_score)}`
      : null,
    scheduled_date: m.scheduled_date,
    scheduled_time: m.scheduled_time,
    court_name: m.court_name,
    played_at: m.played_at,
    league_name: m.league_name,
    division_name: m.division_name,
    week_number: m.week_number,
    tournament_name: m.tournament_name,
    round: m.round,
    head_to_head: h2h,
    // Tournament scores are entered by the club through the bracket, so a
    // participant is never offered the button for one.
    // A skipped match is one the club decided would not be played, so there is
    // nothing to report on it.
    can_submit_score: viewer != null && !isPlayed && m.type !== 'tournament' && !m.skipped
      && players.some((p) => p.id === viewer),
    skipped: !!m.skipped,
    ...doubles,
  };
}

/**
 * The signed-in player's matches that still need a score: everything of theirs
 * that is not played, soonest first, with undated ones last.
 */
function getReportableMatches(playerId) {
  const id = Number(playerId);
  const rows = getDB().prepare(`
    SELECT m.id, m.type, m.status, m.format, m.scheduled_date, m.scheduled_time,
           c.name AS court_name,
           l.name AS league_name, d.name AS division_name, w.week_number,
           ${EFF_P1} AS s1a, ${EFF_P1B} AS s1b, ${EFF_P2} AS s2a, ${EFF_P2B} AS s2b,
           p1.name AS s1a_name, p1.photo_path AS s1a_photo,
           p1b.name AS s1b_name, p1b.photo_path AS s1b_photo,
           p2.name AS s2a_name, p2.photo_path AS s2a_photo,
           p2b.name AS s2b_name, p2b.photo_path AS s2b_photo
    FROM matches m ${DBL_JOIN}
    LEFT JOIN players p1 ON p1.id = ${EFF_P1}
    LEFT JOIN players p2 ON p2.id = ${EFF_P2}
    LEFT JOIN players p1b ON p1b.id = ${EFF_P1B}
    LEFT JOIN players p2b ON p2b.id = ${EFF_P2B}
    LEFT JOIN courts c    ON c.id = m.court_id
    LEFT JOIN leagues l   ON l.id = m.league_id
    LEFT JOIN divisions d ON d.id = m.division_id
    LEFT JOIN weeks w     ON w.id = m.week_id
    WHERE m.status != 'played'
      AND m.type != 'tournament'
      AND (m.skipped = 0 OR m.skipped IS NULL)
      AND @id IN (${EFF_P1}, ${EFF_P2}, ${EFF_P1B}, ${EFF_P2B})
    ORDER BY m.scheduled_date IS NULL, m.scheduled_date, m.scheduled_time
  `).all({ id });

  return rows.map((r) => {
    const base = {
      id: r.id, type: r.type, status: r.status, scheduled_date: r.scheduled_date, scheduled_time: r.scheduled_time,
      court_name: r.court_name, league_name: r.league_name, division_name: r.division_name, week_number: r.week_number,
    };
    const person = (k) => ({ id: r[k], name: r[`${k}_name`], photo_path: r[`${k}_photo`] });
    if (r.format !== 'doubles') {
      const opp = r.s1a === id ? person('s2a') : person('s1a');
      return { ...base, format: 'singles', opponent_id: opp.id, opponent_name: opp.name, opponent_photo: opp.photo_path };
    }
    // A doubles row names the partner and both opponents; opponent_name is
    // the pair, for any reader that still expects one.
    const onSide1 = r.s1a === id || r.s1b === id;
    const mine = onSide1 ? ['s1a', 's1b'] : ['s2a', 's2b'];
    const theirs = onSide1 ? ['s2a', 's2b'] : ['s1a', 's1b'];
    const partner = person(mine.find((k) => r[k] !== id));
    const opponents = theirs.map(person);
    return {
      ...base,
      format: 'doubles',
      partner,
      opponents,
      opponent_id: opponents[0].id,
      opponent_name: opponents.map((o) => o.name).join(' & '),
      opponent_photo: opponents[0].photo_path,
    };
  });
}

module.exports = {
  TYPES, STATUSES,
  SOURCE_OF_TYPE, EFF_JOIN, EFF_P1, EFF_P2, COUNTS, WON_SIDE,
  SINGLES, DOUBLES, COUNTS_DOUBLES, DBL_JOIN, EFF_P1B, EFF_P2B,
  getCompletedMatches, getLastMatchDates, getParticipation,
  getHeadToHead, getMatchCard, getReportableMatches, getDoublesHeadToHead,
  getCompletedDoublesMatches, getLastDoublesMatchDates, getFirstDoublesMatchDates,
};
