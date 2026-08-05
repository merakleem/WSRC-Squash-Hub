const { getDB } = require('../database/db');
const elo = require('../lib/elo');

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
function getCompletedMatches(seasonId = null) {
  const db = getDB();
  const seasonFilter = seasonId == null ? '' : 'AND l.season_id = @seasonId';
  const tournFilter  = seasonId == null ? '' : 'AND t.season_id = @seasonId';
  const pickupFilter = seasonId == null ? '' : 'AND pm.season_id = @seasonId';
  const params = seasonId == null ? {} : { seasonId: Number(seasonId) };

  const leagueMatches = db.prepare(`
    SELECT
      m.winner_id, m.player1_id, m.player2_id,
      COALESCE(s1.sub_player_id, m.player1_id) AS eff_p1_id,
      COALESCE(s2.sub_player_id, m.player2_id) AS eff_p2_id,
      COALESCE(m.confirmed_at, w.date) AS sort_key
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w ON tm.week_id = w.id
    JOIN leagues l ON w.league_id = l.id
    LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
    LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
    WHERE m.winner_id IS NOT NULL
      AND (m.skipped = 0 OR m.skipped IS NULL)
      ${seasonFilter}
  `).all(params);

  const tournamentMatches = db.prepare(`
    SELECT
      tm.winner_id, tm.player1_id, tm.player2_id,
      tm.player1_id AS eff_p1_id, tm.player2_id AS eff_p2_id,
      COALESCE(tm.confirmed_at, tm.match_date) AS sort_key
    FROM tournament_matches tm
    JOIN tournaments t ON t.id = tm.tournament_id
    WHERE tm.winner_id IS NOT NULL
      AND tm.player1_id IS NOT NULL
      AND tm.player2_id IS NOT NULL
      ${tournFilter}
  `).all(params);

  const pickupMatches = db.prepare(`
    SELECT
      pm.winner_id, pm.player1_id, pm.player2_id,
      pm.player1_id AS eff_p1_id, pm.player2_id AS eff_p2_id,
      pm.played_at AS sort_key
    FROM pickup_matches pm
    WHERE 1 = 1 ${pickupFilter}
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

/**
 * Current and best-ever ladder position for one player.
 * Returns nulls when the player is excluded from the ladder.
 */
// ===== ELO LADDER =====

/**
 * Rating-based ladder for one season.
 *
 * Computed by replaying the season's matches from a seeded starting rating
 * rather than by storing running totals. Substitutions rewrite winners after
 * the fact, scores can be cleared, and voiding a tournament result cascades;
 * an incrementally-maintained rating would corrupt silently under any of those.
 * A replay is self-healing and cheap at club scale.
 */
function computeEloLadder(season, settings, asOfDate = null, { includeHidden = false } = {}) {
  const db = getDB();
  const cfg = elo.config(settings);
  const players = db.prepare(PLAYER_SELECT).all();
  const playerIds = new Set(players.map((p) => p.id));

  // Seed from the previous season's frozen standings where available.
  const previous = db.prepare(`
    SELECT * FROM seasons
    WHERE start_date < ? AND status = 'ended'
    ORDER BY start_date DESC LIMIT 1
  `).get(season.start_date);

  // Prefer a frozen snapshot. If the admin promoted this season without ending
  // the previous one, fall back to computing where that season stands right
  // now; otherwise everyone would seed from Club Locker ratings and the whole
  // ladder would lurch the day the previous season is finally ended.
  let priorStandings = previous
    ? db.prepare('SELECT * FROM season_standings WHERE season_id = ?').all(previous.id)
    : [];

  if (priorStandings.length === 0) {
    const unended = db.prepare(`
      SELECT * FROM seasons
      WHERE start_date < ? AND id != ?
      ORDER BY start_date DESC LIMIT 1
    `).get(season.start_date, season.id);
    if (unended) {
      const live = unended.ladder_system === 'elo'
        ? computeEloLadder(unended, settings, unended.end_date, { includeHidden: true })
        : getLadder(unended.end_date);
      priorStandings = live.map((r, i) => ({
        player_id: r.id,
        position: i + 1,
        rating: unended.ladder_system === 'elo' ? r.rating : null,
      }));
    }
  }
  const priorById = Object.fromEntries(priorStandings.map((s) => [s.player_id, s]));
  const priorSize = priorStandings.length;

  const ratings = {};
  const seeds = {};
  for (const p of players) {
    const prior = priorById[p.id];
    const seed = elo.seedRating({
      previousRating: prior?.rating ?? null,
      previousPosition: prior?.position ?? null,
      ladderSize: priorSize,
      clubLockerRating: p.club_locker_rating,
    }, cfg);
    ratings[p.id] = seed;
    seeds[p.id] = seed;
  }

  const matches = getCompletedMatches(season.id)
    .filter((m) => !asOfDate || String(m.sort_key || '').slice(0, 10) <= asOfDate);
  const played = {};
  const wins = {};
  const losses = {};

  for (const match of matches) {
    const winnerId = match.winner_id === match.player1_id ? match.eff_p1_id : match.eff_p2_id;
    const loserId  = match.winner_id === match.player1_id ? match.eff_p2_id : match.eff_p1_id;
    if (!playerIds.has(winnerId) || !playerIds.has(loserId)) continue;
    if (winnerId === loserId) continue;

    const result = elo.applyMatch(ratings[winnerId], ratings[loserId], cfg.elo_k_factor);
    ratings[winnerId] = result.winner;
    ratings[loserId] = result.loser;

    played[winnerId] = (played[winnerId] || 0) + 1;
    played[loserId] = (played[loserId] || 0) + 1;
    wins[winnerId] = (wins[winnerId] || 0) + 1;
    losses[loserId] = (losses[loserId] || 0) + 1;
  }

  // Inactivity is applied after the replay, as a pure function of the last
  // match date. Keeping it out of the replay means it never has to be "undone"
  // and the whole computation stays idempotent.
  const lastMatch = getLastMatchDates();
  // Decay is measured to the same date the matches are cut off at. Without
  // this, freezing a season months after it ended would apply months of
  // inactivity that never happened during the season, and the frozen result
  // would depend on when the admin happened to click End Season.
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);

  const rows = [];
  for (const p of players) {
    const { months, penalty } = elo.inactivityPenalty({
      lastMatchDate: lastMatch[p.id] || null,
      seasonStartDate: season.start_date,
      asOfDate: asOf,
    }, cfg);

    // Hiding is a display rule. When persisting a snapshot every player is kept,
    // otherwise a long-absent player loses the record that they were in the
    // season at all; and seeds from their Club Locker rating next season
    // instead of the rating they actually earned.
    const hidden = elo.isHiddenForInactivity(months, cfg);
    if (hidden && !includeHidden) continue;

    const base = ratings[p.id];
    // The floor bounds how far decay can push someone down; it must never lift
    // a rating that was legitimately earned below it, which would mint points
    // out of nothing and break the zero-sum property.
    const decayed = penalty > 0
      ? Math.max(Math.min(base, cfg.elo_decay_floor), base - penalty)
      : base;
    rows.push({
      hidden_for_inactivity: hidden,
      ...p,
      rating: Math.round(decayed),
      rating_undecayed: Math.round(base),
      seed_rating: Math.round(seeds[p.id]),
      rating_change: Math.round(decayed - seeds[p.id]),
      inactive_months: months,
      inactivity_penalty: Math.round(base - decayed),
      matches_played: played[p.id] || 0,
      season_wins: wins[p.id] || 0,
      season_losses: losses[p.id] || 0,
    });
  }

  rows.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));

  // Best position within this season needs a per-match replay of the ordering,
  // which is more work than it is worth; peak rating is the meaningful
  // equivalent under a rating system and is already implied by rating_change.
  return rows.map((r, i) => ({ ...r, position: i + 1, best_position: null, rank_change: 0 }));
}

/**
 * The ladder as it should be displayed for a season.
 *
 * Dispatches on the season's own ladder_system so a past season is always
 * rendered by the rules it was played under. An ended season is served from its
 * frozen snapshot and never recomputed.
 */
function getLadderForSeason(seasonId = null) {
  const db = getDB();
  const season = seasonId
    ? db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(seasonId))
    : db.prepare('SELECT * FROM seasons WHERE is_current = 1').get();

  // No seasons configured at all; fall back to the original all-time ladder.
  if (!season) return { season: null, system: 'leapfrog', frozen: false, rows: getLadder() };

  if (season.status === 'ended') {
    return { season, system: season.ladder_system, frozen: true, rows: getFrozenStandings(season.id) };
  }

  if (season.ladder_system === 'elo') {
    const settings = Object.fromEntries(
      db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])
    );
    return { season, system: 'elo', frozen: false, rows: computeEloLadder(season, settings) };
  }

  return { season, system: 'leapfrog', frozen: false, rows: getLadder() };
}

/** A frozen season's standings, rehydrated with current player details. */
function getFrozenStandings(seasonId) {
  const db = getDB();
  return db.prepare(`
    SELECT s.position, s.rating, s.wins AS season_wins, s.losses AS season_losses,
           p.id, p.name, p.email, p.phone, p.exclude_from_ladder, p.club_locker_rating, p.photo_path
    FROM season_standings s
    JOIN players p ON p.id = s.player_id
    WHERE s.season_id = ?
    ORDER BY s.position ASC
  `).all(Number(seasonId)).map((r) => ({ ...r, rank_change: 0, best_position: null }));
}

/**
 * Freeze a season's final standings.
 *
 * Safe to re-run: the previous snapshot is replaced, which is what makes the
 * "re-freeze" action work after a late-reported score arrives.
 */
function freezeSeason(seasonId) {
  const db = getDB();
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(Number(seasonId));
  if (!season) throw Object.assign(new Error('Season not found'), { status: 404 });

  // Compute against the live rules before marking it ended, so the snapshot
  // reflects the season exactly as it stood.
  // The snapshot is "the ladder as it stood at season end", so matches dated
  // after the season are excluded. Without this, re-freezing an old season
  // after the next one has started would pull the newer season's results in.
  // Freeze as of the season's end, not as of the moment the admin clicked;
  // otherwise the standings depend on how long they waited for late scores.
  // Never freeze past today, so ending a season early doesn't count the future.
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = season.end_date < today ? season.end_date : today;
  const live = { ...season, status: 'active' };
  let rows;
  if (season.ladder_system === 'elo') {
    const settings = Object.fromEntries(
      db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])
    );
    rows = computeEloLadder(live, settings, cutoff, { includeHidden: true });
  } else {
    rows = getLadder(cutoff);
  }

  const seasonWins = getSeasonRecords(seasonId, cutoff);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM season_standings WHERE season_id = ?').run(Number(seasonId));
    const insert = db.prepare(
      'INSERT INTO season_standings (season_id, player_id, position, rating, wins, losses) VALUES (?, ?, ?, ?, ?, ?)'
    );
    rows.forEach((r, i) => {
      const rec = seasonWins[r.id] || { wins: 0, losses: 0 };
      insert.run(Number(seasonId), r.id, i + 1, r.rating ?? null, rec.wins, rec.losses);
    });
    db.prepare(`UPDATE seasons SET status = 'ended', ended_at = datetime('now') WHERE id = ?`).run(Number(seasonId));
  });
  tx();

  return { frozen: rows.length };
}

/** Reopen an ended season so it computes live again. */
function reopenSeason(seasonId) {
  const db = getDB();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM season_standings WHERE season_id = ?').run(Number(seasonId));
    db.prepare(`UPDATE seasons SET status = 'active', ended_at = NULL WHERE id = ?`).run(Number(seasonId));
  });
  tx();
}

/**
 * Per-player W/L within one season, across all three match types.
 *
 * `asOfDate` bounds it to the same cutoff the standings use, so a league that
 * straddles a season boundary can't credit a result that hadn't happened yet.
 */
function getSeasonRecords(seasonId, asOfDate = null) {
  const db = getDB();
  const cut = asOfDate
    ? {
      league: `AND substr(COALESCE(m.confirmed_at, w.date), 1, 10) <= @asOf`,
      tourn:  `AND substr(COALESCE(tm.confirmed_at, tm.match_date), 1, 10) <= @asOf`,
      pickup: `AND substr(pm.played_at, 1, 10) <= @asOf`,
    }
    : { league: '', tourn: '', pickup: '' };
  const rows = db.prepare(`
    SELECT player_id,
           SUM(CASE WHEN won THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN won THEN 0 ELSE 1 END) AS losses
    FROM (
      SELECT COALESCE(s1.sub_player_id, m.player1_id) AS player_id,
             (m.winner_id = m.player1_id) AS won
        FROM matches m
        JOIN team_matchups tm ON m.matchup_id = tm.id
        JOIN weeks w ON tm.week_id = w.id
        JOIN leagues l ON w.league_id = l.id
        LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
        WHERE m.winner_id IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL) AND l.season_id = @seasonId ${cut.league}
      UNION ALL
      SELECT COALESCE(s2.sub_player_id, m.player2_id),
             (m.winner_id = m.player2_id)
        FROM matches m
        JOIN team_matchups tm ON m.matchup_id = tm.id
        JOIN weeks w ON tm.week_id = w.id
        JOIN leagues l ON w.league_id = l.id
        LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
        WHERE m.winner_id IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL) AND l.season_id = @seasonId ${cut.league}
      UNION ALL
      SELECT tm.player1_id, (tm.winner_id = tm.player1_id)
        FROM tournament_matches tm JOIN tournaments t ON t.id = tm.tournament_id
        WHERE tm.winner_id IS NOT NULL AND tm.player1_id IS NOT NULL AND tm.player2_id IS NOT NULL AND t.season_id = @seasonId ${cut.tourn}
      UNION ALL
      SELECT tm.player2_id, (tm.winner_id = tm.player2_id)
        FROM tournament_matches tm JOIN tournaments t ON t.id = tm.tournament_id
        WHERE tm.winner_id IS NOT NULL AND tm.player1_id IS NOT NULL AND tm.player2_id IS NOT NULL AND t.season_id = @seasonId ${cut.tourn}
      UNION ALL
      SELECT pm.player1_id, (pm.winner_id = pm.player1_id) FROM pickup_matches pm WHERE pm.season_id = @seasonId ${cut.pickup}
      UNION ALL
      SELECT pm.player2_id, (pm.winner_id = pm.player2_id) FROM pickup_matches pm WHERE pm.season_id = @seasonId ${cut.pickup}
    ) WHERE player_id IS NOT NULL
    GROUP BY player_id
  `).all(asOfDate ? { seasonId: Number(seasonId), asOf: asOfDate } : { seasonId: Number(seasonId) });
  return Object.fromEntries(rows.map((r) => [r.player_id, { wins: r.wins, losses: r.losses }]));
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

  // Always end at today's standing so the line reaches the right edge.
  const last = series[series.length - 1];
  const today = new Date().toISOString().slice(0, 10);
  if (!last || last.date !== today) series.push({ date: today, position, ladder_size: size });

  return series;
}

function getPlayerLadderStats(playerId) {
  const ladder = getLadder();
  const row = ladder.find((p) => p.id === Number(playerId));
  if (!row) return { position: null, best_position: null, ladder_size: ladder.length };
  return { position: row.position, best_position: row.best_position, ladder_size: ladder.length };
}

module.exports = {
  getLadder, getPlayerLadderStats, getPlayerLadderHistory, getLadderForSeason, computeEloLadder,
  freezeSeason, reopenSeason, getFrozenStandings, getSeasonRecords,
  getCompletedMatches, getLastMatchDates,
};
