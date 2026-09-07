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
  // ===== WHERE A NEW PLAYER COMES IN =====
  // A Club Locker rating is an estimate; a ladder place is a result. They are
  // not ranked on the same list: nobody is on the ladder until they have played
  // a match, so an estimate never holds a rank on its own. What it does decide
  // is where a player enters on the day they first play - the pivot rating maps
  // to the base rating, and every rating point either side of it is worth the
  // scale. Their result moves them from there like anyone else's.
  elo_club_locker_pivot: 3.5,
  elo_club_locker_scale: 160,
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
 *   - no positional finish, so their Club Locker rating gives an opening
 *     estimate. It only ever decides where a player enters; the matches they
 *     then play decide where they stay.
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

  // No finish to convert: the Club Locker rating is the opening estimate. An
  // unrated player has nothing to estimate from, so they come in at the base.
  // Checked for null before Number(), which turns both null and '' into 0 and
  // would otherwise seed an unrated member as if they were rated zero.
  if (clubLockerRating == null || clubLockerRating === '') return cfg.elo_base_rating;
  const rating = Number(clubLockerRating);
  if (!Number.isFinite(rating)) return cfg.elo_base_rating;
  return cfg.elo_base_rating + (rating - cfg.elo_club_locker_pivot) * cfg.elo_club_locker_scale;
}

module.exports = {
  DEFAULTS, config, expectedScore, ratingDelta, applyMatch, seedRating,
};
