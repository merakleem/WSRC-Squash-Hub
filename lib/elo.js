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
  // elo_seed_bottom, and their rating is worth up to this much on top.
  //
  // Spread across the club's own range rather than multiplied by the raw
  // number: the club's highest rating earns the whole bonus, the lowest earns
  // none, and everyone in between lands in proportion. That keeps the weakest
  // newcomer at the foot of the ladder where they belong, and it means the one
  // number here says exactly how far the strongest newcomer can reach.
  elo_unplayed_rating_bonus: 80,
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
 *   - nothing played at all, so they start at the foot of the ladder, with
 *     `ratingShare` (0 to 1, where their Club Locker rating sits in the club's
 *     range) worth a small bonus that orders them among each other.
 */
function seedRating({ previousPosition, previousRating, ladderSize, ratingShare, unplayed }, cfg) {
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

  // No results: the foot of the ladder, nudged by the Club Locker estimate.
  const share = Number.isFinite(Number(ratingShare)) ? Math.min(1, Math.max(0, Number(ratingShare))) : 0;
  return cfg.elo_seed_bottom + share * cfg.elo_unplayed_rating_bonus;
}

module.exports = {
  DEFAULTS, config, expectedScore, ratingDelta, applyMatch, seedRating,
};
