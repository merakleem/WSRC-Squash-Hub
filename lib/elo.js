// ===== ELO =====
// Pure rating maths. No database access; everything here takes plain values so
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

  // ===== PLAYERS WITH NO MATCHES =====
  // A Club Locker rating is an estimate; a ladder place is a result. The two
  // are not the same currency, so they are not ranked on the same list: results
  // decide the ladder, and the estimate only orders the players who have no
  // results yet. Those players start at the foot of the ladder, on
  // elo_seed_bottom, plus their rating multiplied by this.
  //
  // A plain multiple of the rating, not a share of the club's spread: it means
  // the same thing every season, and one member joining cannot change where
  // another one starts. Note that Club Locker ratings run from about 2.5 rather
  // than from zero, so every newcomer clears the foot of the ladder by at least
  // 2.5x this - raising it lifts the whole intake, not only the top of it.
  elo_unplayed_rating_multiplier: 15,
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
 * Returns the points the winner gains, which the loser loses; the exchange is
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
 * Three cases, in order:
 *   - a rating carried from a previous rated season, used as is;
 *   - a finishing position from the positional season, spread across the seed
 *     range - this is the only way to be placed up the ladder, and it is only
 *     open to players who actually played;
 *   - nothing played at all, so they start at the foot of the ladder, lifted by
 *     their Club Locker rating times the multiplier, which is what orders them
 *     among each other.
 */
function seedRating({ previousPosition, previousRating, ladderSize, clubLockerRating, unplayed }, cfg) {
  // A previous rated season carries over directly; ratings are continuous
  // across seasons by design.
  if (previousRating != null) return previousRating;

  // Converting a positional season: spread final positions across the seed
  // range. Only players who played are ranked here, so finishing last still
  // beats having no result at all.
  if (!unplayed && previousPosition != null) {
    if (ladderSize <= 1) return cfg.elo_seed_top;
    const share = (ladderSize - previousPosition) / (ladderSize - 1);
    return cfg.elo_seed_bottom + share * (cfg.elo_seed_top - cfg.elo_seed_bottom);
  }

  // No results: the foot of the ladder, lifted by the Club Locker estimate.
  // A missing or unusable rating is worth nothing rather than something odd.
  const rating = Number(clubLockerRating);
  const lift = Number.isFinite(rating) && rating > 0 ? rating * cfg.elo_unplayed_rating_multiplier : 0;
  return cfg.elo_seed_bottom + lift;
}

module.exports = {
  DEFAULTS, config, expectedScore, ratingDelta, applyMatch, seedRating,
};
