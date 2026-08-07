const { getDB } = require('../database/db');
const elo = require('../lib/elo');
const seasonsLib = require('../lib/seasons');
const seasonModel = require('./seasonModel');

// ===== SHARED QUERIES =====

const PLAYER_SELECT = `
  SELECT id, name, email, phone, exclude_from_ladder, club_locker_rating, photo_path
  FROM players
  WHERE exclude_from_ladder = 0 OR exclude_from_ladder IS NULL
  ORDER BY
    CASE WHEN club_locker_rating IS NULL THEN 1 ELSE 0 END ASC,
    club_locker_rating DESC,
    name ASC
`;

/**
 * Every completed match, newest last, with substitutions resolved.
 *
 * `seasonId` restricts to matches belonging to that season; omit it for the
 * all-time set the leapfrog ladder replays.
 */
function getCompletedMatches(range = null) {
  const db = getDB();
  // Season membership is decided by when a match was played, so the filter is a
  // date window rather than a stored link. `range` is { start, end } or null for
  // everything ever.
  const where = range ? 'AND substr(@dateExpr, 1, 10) BETWEEN @start AND @end' : '';
  const params = range ? { start: range.start, end: range.end } : {};

  const leagueMatches = db.prepare(`
    SELECT
      m.id AS match_id, 'league' AS source,
      m.winner_id, m.player1_id, m.player2_id,
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
      ${where.replace('@dateExpr', 'COALESCE(m.confirmed_at, w.date)')}
  `).all(params);

  const tournamentMatches = db.prepare(`
    SELECT
      tm.id AS match_id, 'tournament' AS source,
      tm.winner_id, tm.player1_id, tm.player2_id,
      tm.player1_id AS eff_p1_id, tm.player2_id AS eff_p2_id,
      COALESCE(tm.confirmed_at, tm.match_date) AS sort_key
    FROM tournament_matches tm
    WHERE tm.winner_id IS NOT NULL
      AND tm.player1_id IS NOT NULL
      AND tm.player2_id IS NOT NULL
      ${where.replace('@dateExpr', 'COALESCE(tm.confirmed_at, tm.match_date)')}
  `).all(params);

  const pickupMatches = db.prepare(`
    SELECT
      pm.id AS match_id, 'pickup' AS source,
      pm.winner_id, pm.player1_id, pm.player2_id,
      pm.player1_id AS eff_p1_id, pm.player2_id AS eff_p2_id,
      pm.played_at AS sort_key
    FROM pickup_matches pm
    WHERE 1 = 1 ${where.replace('@dateExpr', 'pm.played_at')}
  `).all(params);

  return [...leagueMatches, ...tournamentMatches, ...pickupMatches]
    .sort((a, b) => (a.sort_key || '').localeCompare(b.sort_key || '') || 0);
}

/** Most recent match date per player, across every match type and season. */
function getLastMatchDates() {
  const db = getDB();
  const rows = db.prepare(`
    SELECT player_id, MAX(d) AS last_date FROM (
      SELECT m.player1_id AS player_id, COALESCE(m.confirmed_at, w.date) AS d
        FROM matches m JOIN team_matchups tm ON m.matchup_id = tm.id JOIN weeks w ON tm.week_id = w.id
        WHERE m.winner_id IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)
      UNION ALL
      SELECT m.player2_id, COALESCE(m.confirmed_at, w.date)
        FROM matches m JOIN team_matchups tm ON m.matchup_id = tm.id JOIN weeks w ON tm.week_id = w.id
        WHERE m.winner_id IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)
      UNION ALL
      SELECT s.sub_player_id, COALESCE(m.confirmed_at, w.date)
        FROM match_subs s JOIN matches m ON m.id = s.match_id
        JOIN team_matchups tm ON m.matchup_id = tm.id JOIN weeks w ON tm.week_id = w.id
        WHERE m.winner_id IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)
      UNION ALL
      SELECT tm.player1_id, COALESCE(tm.confirmed_at, tm.match_date) FROM tournament_matches tm WHERE tm.winner_id IS NOT NULL
      UNION ALL
      SELECT tm.player2_id, COALESCE(tm.confirmed_at, tm.match_date) FROM tournament_matches tm WHERE tm.winner_id IS NOT NULL
      UNION ALL
      SELECT pm.player1_id, pm.played_at FROM pickup_matches pm
      UNION ALL
      SELECT pm.player2_id, pm.played_at FROM pickup_matches pm
    ) WHERE player_id IS NOT NULL AND d IS NOT NULL
    GROUP BY player_id
  `).all();
  return Object.fromEntries(rows.map((r) => [r.player_id, String(r.last_date).slice(0, 10)]));
}

/**
 * Compute the current ladder ranking.
 *
 * Initial order: club_locker_rating DESC (NULLs last, then alphabetical).
 * Then each confirmed match is replayed chronologically:
 *   - If the lower-ranked player wins, they jump up to the loser's position
 *     and everyone between shifts down one.
 *   - If the higher-ranked player wins, no change.
 *
 * `asOfDate` (YYYY-MM-DD) reconstructs the ladder as it stood on that date by
 * ignoring later matches. Omit it for the live ladder.
 */
function getLadder(asOfDate = null) {
  const db = getDB();

  const players = db.prepare(`
    SELECT id, name, email, phone, exclude_from_ladder, club_locker_rating, photo_path
    FROM players
    WHERE exclude_from_ladder = 0 OR exclude_from_ladder IS NULL
    ORDER BY
      CASE WHEN club_locker_rating IS NULL THEN 1 ELSE 0 END ASC,
      club_locker_rating DESC,
      name ASC
  `).all();

  const leagueMatches = db.prepare(`
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
  `).all();

  const tournamentMatches = db.prepare(`
    SELECT
      winner_id,
      player1_id,
      player2_id,
      player1_id AS eff_p1_id,
      player2_id AS eff_p2_id,
      COALESCE(confirmed_at, match_date) AS sort_key
    FROM tournament_matches
    WHERE winner_id IS NOT NULL
      AND player1_id IS NOT NULL
      AND player2_id IS NOT NULL
  `).all();

  const pickupMatches = db.prepare(`
    SELECT
      winner_id,
      player1_id,
      player2_id,
      player1_id AS eff_p1_id,
      player2_id AS eff_p2_id,
      played_at AS sort_key
    FROM pickup_matches
  `).all();

  const matches = [...leagueMatches, ...tournamentMatches, ...pickupMatches]
    // A cutoff reconstructs the ladder as it stood on a given date. Used when
    // freezing a season, so matches belonging to the following season can't
    // leak into a snapshot of the one that just ended.
    .filter((m) => !asOfDate || String(m.sort_key || '').slice(0, 10) <= asOfDate)
    .sort((a, b) => (a.sort_key || '').localeCompare(b.sort_key || '') || 0);

  const playerIds = new Set(players.map((p) => p.id));
  let ranking = players.map((p) => p.id);

  // Best position ever held. Nothing persists historical standings, so it is
  // derived from the same replay that produces the current ranking.
  const bestPosition = {};
  ranking.forEach((id, i) => { bestPosition[id] = i + 1; });

  for (const match of matches) {
    const effWinnerId = match.winner_id === match.player1_id ? match.eff_p1_id : match.eff_p2_id;
    const effLoserId  = match.winner_id === match.player1_id ? match.eff_p2_id : match.eff_p1_id;

    if (!playerIds.has(effWinnerId) || !playerIds.has(effLoserId)) continue;

    const winnerIdx = ranking.indexOf(effWinnerId);
    const loserIdx  = ranking.indexOf(effLoserId);

    if (winnerIdx === -1 || loserIdx === -1) continue;
    if (winnerIdx <= loserIdx) continue;

    ranking.splice(winnerIdx, 1);
    ranking.splice(loserIdx, 0, effWinnerId);

    // Only the winner and the players it leapfrogged changed position.
    for (let i = loserIdx; i <= winnerIdx; i++) {
      const id = ranking[i];
      if (i + 1 < bestPosition[id]) bestPosition[id] = i + 1;
    }
  }

  // Snapshot the ranking before any match from the past 7 days was applied,
  // so we can compute how many spots each player has moved recently.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let rankingSevenDaysAgo = null;

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
    const rankChange = oldIdx !== -1 ? (oldIdx + 1) - (i + 1) : 0;
    return { ...playerMap[id], position: i + 1, rank_change: rankChange, best_position: bestPosition[id] };
  });
}

// ===== ELO LADDER =====

/**
 * Rating-based ladder for one season.
 *
 * Computed by replaying matches from a seeded starting rating rather than by
 * storing running totals. Substitutions rewrite winners after the fact, scores
 * can be cleared, and voiding a tournament result cascades; an incrementally
 * maintained rating would corrupt silently under any of those. A replay is
 * self-healing and cheap at club scale.
 *
 * Ratings carry across seasons, so a rated season is seeded by replaying every
 * rated season before it in order. The first one converts the preceding
 * positional season's final order into ratings, which is what makes the
 * switchover seamless: day one of the rating ladder shows the order the
 * positional ladder ended on.
 */
function computeEloLadder(seasonKey, settings, asOfDate = null, { includeHidden = false, withRankChange = true } = {}) {
  const db = getDB();
  const cfg = elo.config(settings);
  const monthDay = seasonsLib.startMonthDay(settings);
  const players = db.prepare(PLAYER_SELECT).all();
  const playerIds = new Set(players.map((p) => p.id));

  const targetYear = seasonsLib.seasonStartYear(seasonKey);
  const cutoverYear = seasonsLib.seasonStartYear(seasonModel.getFirstSeasonKey()) + 1;

  // Seed from where players finished the season before ratings began.
  const firstRatedRange = seasonsLib.seasonRange(
    seasonsLib.seasonKeyForDate(`${cutoverYear}-${monthDay}`, monthDay), monthDay
  );
  const priorOrder = getLadder(_dayBefore(firstRatedRange.start));
  const priorSize = priorOrder.length;
  const priorByIdMap = Object.fromEntries(priorOrder.map((r) => [r.id, r]));

  const ratings = {};
  for (const p of players) {
    ratings[p.id] = elo.seedRating({
      previousRating: null,
      previousPosition: priorByIdMap[p.id]?.position ?? null,
      ladderSize: priorSize,
      clubLockerRating: p.club_locker_rating,
    }, cfg);
  }

  // Replay each rated season up to and including the requested one.
  let played = {}, wins = {}, losses = {}, seedsForTarget = { ...ratings };
  for (let year = cutoverYear; year <= targetYear; year++) {
    const key = monthDay === '01-01'
      ? String(year)
      : `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
    const range = seasonsLib.seasonRange(key, monthDay);
    const isTarget = year === targetYear;
    if (isTarget) seedsForTarget = { ...ratings };

    const end = isTarget && asOfDate && asOfDate < range.end ? asOfDate : range.end;
    const matches = getCompletedMatches({ start: range.start, end });

    if (isTarget) { played = {}; wins = {}; losses = {}; }

    for (const match of matches) {
      const winnerId = match.winner_id === match.player1_id ? match.eff_p1_id : match.eff_p2_id;
      const loserId  = match.winner_id === match.player1_id ? match.eff_p2_id : match.eff_p1_id;
      if (!playerIds.has(winnerId) || !playerIds.has(loserId) || winnerId === loserId) continue;

      const r = elo.applyMatch(ratings[winnerId], ratings[loserId], cfg.elo_k_factor);
      ratings[winnerId] = r.winner;
      ratings[loserId] = r.loser;

      if (isTarget) {
        played[winnerId] = (played[winnerId] || 0) + 1;
        played[loserId] = (played[loserId] || 0) + 1;
        wins[winnerId] = (wins[winnerId] || 0) + 1;
        losses[loserId] = (losses[loserId] || 0) + 1;
      }
    }
  }

  const targetRange = seasonsLib.seasonRange(seasonKey, monthDay);

  // Who appears at all: you need a match in the previous season, or one in this
  // season. Sit out a whole season and you drop off the ladder; play a single
  // game and you are back on it, at the rating you left with. Nothing decays,
  // so a return is never punished beyond the time already missed.
  const prevKey = monthDay === '01-01'
    ? String(targetYear - 1)
    : `${targetYear - 1}/${String(targetYear % 100).padStart(2, '0')}`;
  const prevRange = seasonsLib.seasonRange(prevKey, monthDay);
  const firstYear = seasonsLib.seasonStartYear(seasonModel.getFirstSeasonKey());
  // The club's first rated season has no season before it to have played in, so
  // nobody is hidden on the strength of a season that never existed.
  const hasPreviousSeason = firstYear != null && targetYear - 1 >= firstYear;

  const playedPrev = new Set();
  if (hasPreviousSeason) {
    for (const m of getCompletedMatches(prevRange)) {
      playedPrev.add(m.eff_p1_id);
      playedPrev.add(m.eff_p2_id);
    }
  }

  const rows = [];
  for (const p of players) {
    const activeThisSeason = (played[p.id] || 0) > 0;
    const hidden = hasPreviousSeason && !activeThisSeason && !playedPrev.has(p.id);
    if (hidden && !includeHidden) continue;

    rows.push({
      ...p,
      hidden_for_inactivity: hidden,
      rating: Math.round(ratings[p.id]),
      seed_rating: Math.round(seedsForTarget[p.id]),
      rating_change: Math.round(ratings[p.id] - seedsForTarget[p.id]),
      returning: hasPreviousSeason && activeThisSeason && !playedPrev.has(p.id),
      matches_played: played[p.id] || 0,
      season_wins: wins[p.id] || 0,
      season_losses: losses[p.id] || 0,
    });
  }

  rows.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));

  // Movement is reported as places gained or lost, not points, matching how the
  // ladder has always read. The comparison run must not ask for movement itself,
  // or it would recurse forever.
  const weekAgo = _daysAgo(7);
  const priorPos = {};
  if (withRankChange && weekAgo > targetRange.start) {
    const before = computeEloLadder(seasonKey, settings, weekAgo, {
      includeHidden: true, withRankChange: false,
    });
    before.forEach((r, i) => { priorPos[r.id] = i + 1; });
  }

  return rows.map((r, i) => ({
    ...r,
    position: i + 1,
    best_position: null,
    rank_change: priorPos[r.id] ? priorPos[r.id] - (i + 1) : 0,
  }));
}

function _dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function _daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/**
 * The ladder as it should be displayed for a season.
 *
 * Dispatches on the system that season is played under, so a past season is
 * always rendered by the rules it was actually played by. A finished season is
 * recomputed with its own end date as the cutoff, which makes it stable without
 * anything being frozen.
 */
function getLadderForSeason(seasonKey = null) {
  const settings = seasonModel.getSettings();
  const monthDay = seasonsLib.startMonthDay(settings);
  const all = seasonModel.getAllSeasons();
  const season = seasonKey
    ? all.find((s) => s.key === String(seasonKey)) || null
    : all.find((s) => s.is_current) || all[0] || null;

  if (!season) return { season: null, system: 'leapfrog', frozen: false, rows: getLadder() };

  const range = seasonsLib.seasonRange(season.key, monthDay);
  const today = new Date().toISOString().slice(0, 10);
  const isPast = range.end < today;

  if (season.ladder_system === 'elo') {
    return { season, system: 'elo', frozen: isPast, rows: computeEloLadder(season.key, settings) };
  }

  // The positional ranking is an all-time replay by construction, but it is
  // always cut off at the season's end so a match belonging to a later season
  // can't leak in. For the current season that only excludes future-dated
  // results, which is what you want anyway.
  const rows = getLadder(range.end);
  const seasonRecords = getSeasonRecords(season.key);
  return {
    season,
    system: 'leapfrog',
    frozen: isPast,
    rows: rows.map((r) => ({
      ...r,
      season_wins: seasonRecords[r.id]?.wins || 0,
      season_losses: seasonRecords[r.id]?.losses || 0,
    })),
  };
}

/** Per-player W/L within one season, across all three match types. */
function getSeasonRecords(seasonKey) {
  const range = seasonsLib.seasonRange(seasonKey, seasonModel.getStartMonthDay());
  if (!range) return {};

  const out = {};
  const bump = (id, won) => {
    if (id == null) return;
    if (!out[id]) out[id] = { wins: 0, losses: 0 };
    out[id][won ? 'wins' : 'losses'] += 1;
  };

  for (const m of getCompletedMatches(range)) {
    const winnerId = m.winner_id === m.player1_id ? m.eff_p1_id : m.eff_p2_id;
    const loserId  = m.winner_id === m.player1_id ? m.eff_p2_id : m.eff_p1_id;
    bump(winnerId, true);
    bump(loserId, false);
  }
  return out;
}

/**
 * A player's ladder position over time, for the profile's history chart.
 *
 * Nothing persists historical standings, so the series is reconstructed from
 * the same chronological replay that produces the live ladder; one pass,
 * recording the player's position whenever it changes. Deliberately all-time
 * and leapfrog-based: the chart shows a career arc, not a season's ratings.
 */
function getPlayerLadderHistory(playerId) {
  const db = getDB();
  const id = Number(playerId);

  const players = db.prepare(PLAYER_SELECT).all();
  const playerIds = new Set(players.map((p) => p.id));
  if (!playerIds.has(id)) return [];

  const ranking = players.map((p) => p.id);
  const matches = getCompletedMatches();
  const size = ranking.length;

  const series = [];
  let position = ranking.indexOf(id) + 1;
  const firstDate = matches.length ? String(matches[0].sort_key || '').slice(0, 10) : null;
  if (firstDate) series.push({ date: firstDate, position, ladder_size: size });

  for (const match of matches) {
    const winnerId = match.winner_id === match.player1_id ? match.eff_p1_id : match.eff_p2_id;
    const loserId  = match.winner_id === match.player1_id ? match.eff_p2_id : match.eff_p1_id;
    if (!playerIds.has(winnerId) || !playerIds.has(loserId)) continue;

    const wi = ranking.indexOf(winnerId);
    const li = ranking.indexOf(loserId);
    if (wi === -1 || li === -1 || wi <= li) continue;

    ranking.splice(wi, 1);
    ranking.splice(li, 0, winnerId);

    // Record only when this player actually moved. A full indexOf per match is
    // a few thousand operations over the club's whole history; not worth
    // optimising into range arithmetic that would be easy to get subtly wrong.
    const next = ranking.indexOf(id) + 1;
    if (next === position) continue;
    position = next;
    series.push({ date: String(match.sort_key || '').slice(0, 10), position, ladder_size: size });
  }

  // One point per day: several matches can land on the same date, and plotting
  // each of them stacks dots vertically on the same x. Matches are replayed in
  // order, so the last entry for a date is where the player finished that day,
  // which is the only one worth charting.
  const byDay = new Map();
  for (const point of series) byDay.set(point.date, point);
  const daily = [...byDay.values()];

  // Always end at today's standing so the line reaches the right edge.
  const today = new Date().toISOString().slice(0, 10);
  const last = daily[daily.length - 1];
  if (!last || last.date !== today) daily.push({ date: today, position, ladder_size: size });

  return daily;
}

/**
 * Rating change per match for one player, keyed `source:matchId`.
 *
 * Only rated seasons produce deltas; a positional season has no rating to
 * change. Uses the same replay that produces the ladder, so the number shown on
 * a match always reconciles with the standings.
 */
function getPlayerMatchRatingDeltas(playerId) {
  const db = getDB();
  const id = Number(playerId);
  const deltas = {};

  const settings = seasonModel.getSettings();
  const monthDay = seasonsLib.startMonthDay(settings);
  const cfg = elo.config(settings);
  const players = db.prepare(PLAYER_SELECT).all();
  const playerIds = new Set(players.map((p) => p.id));
  if (!playerIds.has(id)) return deltas;

  const cutoverYear = seasonsLib.seasonStartYear(seasonModel.getFirstSeasonKey()) + 1;
  // Walk to the newest season that has activity, not merely to today's; a match
  // can be dated ahead of the current season and still needs its delta.
  const all = seasonModel.getAllSeasons();
  const latestYear = seasonsLib.seasonStartYear(all[0]?.key || seasonModel.getCurrentSeasonKey());
  if (cutoverYear == null || latestYear == null || latestYear < cutoverYear) return deltas;

  const firstRange = seasonsLib.seasonRange(
    seasonsLib.seasonKeyForDate(`${cutoverYear}-${monthDay}`, monthDay), monthDay
  );
  const priorOrder = getLadder(_dayBefore(firstRange.start));
  const priorById = Object.fromEntries(priorOrder.map((r) => [r.id, r]));

  const ratings = {};
  for (const p of players) {
    ratings[p.id] = elo.seedRating({
      previousRating: null,
      previousPosition: priorById[p.id]?.position ?? null,
      ladderSize: priorOrder.length,
      clubLockerRating: p.club_locker_rating,
    }, cfg);
  }

  for (let year = cutoverYear; year <= latestYear; year++) {
    const key = monthDay === '01-01'
      ? String(year)
      : `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
    for (const match of getCompletedMatches(seasonsLib.seasonRange(key, monthDay))) {
      const winnerId = match.winner_id === match.player1_id ? match.eff_p1_id : match.eff_p2_id;
      const loserId  = match.winner_id === match.player1_id ? match.eff_p2_id : match.eff_p1_id;
      if (!playerIds.has(winnerId) || !playerIds.has(loserId) || winnerId === loserId) continue;

      const r = elo.applyMatch(ratings[winnerId], ratings[loserId], cfg.elo_k_factor);
      ratings[winnerId] = r.winner;
      ratings[loserId] = r.loser;

      if (winnerId === id || loserId === id) {
        deltas[`${match.source}:${match.match_id}`] = Math.round(winnerId === id ? r.delta : -r.delta);
      }
    }
  }

  return deltas;
}

function getPlayerLadderStats(playerId) {
  const { season, system, frozen, rows } = getLadderForSeason();
  const row = rows.find((p) => p.id === Number(playerId)) || null;
  return {
    system,
    frozen,
    season_name: season?.name || null,
    ladder_size: rows.length,
    position: row?.position ?? null,
    rank_change: frozen ? 0 : (row?.rank_change ?? 0),
    rating: row?.rating ?? null,
    best_position: row?.best_position ?? null,
  };
}

module.exports = {
  getLadder, getPlayerLadderStats, getPlayerLadderHistory, getPlayerMatchRatingDeltas,
  getLadderForSeason, computeEloLadder, getSeasonRecords,
  getCompletedMatches, getLastMatchDates,
};
