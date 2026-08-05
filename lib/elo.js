// ===== ELO =====
// Pure rating maths. No database access — everything here takes plain values so
// it can be unit-tested and so the ladder stays reproducible by replay.

// Defaults are overridable per club via the settings table.
const DEFAULTS = {
  elo_k_factor: 24,
  elo_base_rating: 1000,
  // Position → rating when converting a leapfrog season's final standings.
  elo_seed_top: 1400,
  elo_seed_bottom: 800,
  // Club Locker rating → starting rating for players with no ladder history.
  // 3.5 sits at base, each full rating point is worth this many rating points.
  elo_club_locker_pivot: 3.5,
  elo_club_locker_scale: 160,
  // Inactivity: points shed per whole month without a match, floored so a long
  // absence can't drive a rating to nothing.
  elo_decay_per_month: 40,
  elo_decay_floor: 700,
  elo_hide_after_months: 6,
};

function config(settings = {}) {
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const raw = settings[key];
    const parsed = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
    out[key] = Number.isFinite(parsed) ? parsed : fallback;
  }
  return out;
}

/**
 * Probability that `rating` beats `opponentRating`.
 * The standard logistic curve: 400 points of gap ≈ a 10:1 expected win ratio.
 */
function expectedScore(rating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

/**
 * Rating change for a single completed match.
 * Returns the points the winner gains, which the loser loses — the exchange is
 * zero-sum, so the ladder's total rating never inflates.
 */
function ratingDelta(winnerRating, loserRating, k) {
  return k * (1 - expectedScore(winnerRating, loserRating));
}

/** Apply one match, returning both new ratings. */
function applyMatch(winnerRating, loserRating, k) {
  const delta = ratingDelta(winnerRating, loserRating, k);
  return { winner: winnerRating + delta, loser: loserRating - delta, delta };
}

/**
 * Starting rating for a player entering their first rated season.
 *
 * Prefers where they actually finished last season; falls back to their Club
 * Locker rating, and finally to the base rating.
 */
function seedRating({ previousPosition, previousRating, ladderSize, clubLockerRating }, cfg) {
  // A previous rated season carries over directly — ratings are continuous
  // across seasons by design.
  if (previousRating != null) return previousRating;

  // Converting a leapfrog season: spread final positions across the seed range.
  if (previousPosition != null && ladderSize > 1) {
    const share = (ladderSize - previousPosition) / (ladderSize - 1);
    return cfg.elo_seed_bottom + share * (cfg.elo_seed_top - cfg.elo_seed_bottom);
  }
  if (previousPosition != null) return cfg.elo_seed_top;

  if (clubLockerRating != null && Number.isFinite(Number(clubLockerRating))) {
    return cfg.elo_base_rating + (Number(clubLockerRating) - cfg.elo_club_locker_pivot) * cfg.elo_club_locker_scale;
  }
  return cfg.elo_base_rating;
}

/**
 * Whole months between two YYYY-MM-DD dates, floored at zero.
 * Used for inactivity, so partial months never count.
 */
function monthsBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const from = new Date(`${String(fromDate).slice(0, 10)}T00:00:00Z`);
  const to = new Date(`${String(toDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;

  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Inactivity penalty.
 *
 * Measured from the later of the player's last match and the season start, so a
 * new season never opens with everyone already penalised for the off-season.
 */
function inactivityPenalty({ lastMatchDate, seasonStartDate, asOfDate }, cfg) {
  const from = !lastMatchDate || (seasonStartDate && lastMatchDate < seasonStartDate)
    ? seasonStartDate
    : lastMatchDate;
  const months = monthsBetween(from, asOfDate);
  return { months, penalty: months * cfg.elo_decay_per_month };
}

/** Inactive long enough to drop off the ladder display entirely. */
function isHiddenForInactivity(months, cfg) {
  return months >= cfg.elo_hide_after_months;
}

module.exports = {
  DEFAULTS, config, expectedScore, ratingDelta, applyMatch,
  seedRating, monthsBetween, inactivityPenalty, isHiddenForInactivity,
};
