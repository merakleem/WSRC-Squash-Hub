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

  // ===== UNPROVEN PLAYERS =====
  // A Club Locker rating is an estimate; a ladder place is a result. Someone
  // who had played nothing when ratings began starts this far below their seed,
  // so a place is earned rather than assigned.
  elo_unproven_dock: 60,
  // ...and then plays it back. For their first few matches a win counts for
  // more and a loss for less, so a misplaced newcomer reaches their real level
  // in a couple of weeks instead of a season, without being buried by an early
  // loss to someone far above them.
  elo_provisional_matches: 5,
  elo_provisional_gain: 3,
  elo_provisional_loss: 0.34,
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

/**
 * Apply one match, returning both new ratings.
 *
 * `winnerGain` and `loserLoss` scale each side's move independently, which is
 * how the adjustment period works: a provisional player's win counts for more
 * and their loss for less, while the established player across the net is
 * unaffected either way. Scaling one side breaks the zero-sum exchange on
 * purpose - the alternative is charging someone for the privilege of playing a
 * newcomer. It is bounded, since a player is provisional only once.
 */
function applyMatch(winnerRating, loserRating, k, { winnerGain = 1, loserLoss = 1 } = {}) {
  const delta = ratingDelta(winnerRating, loserRating, k);
  return {
    winner: winnerRating + delta * winnerGain,
    loser: loserRating - delta * loserLoss,
    delta,
  };
}

/**
 * Starting rating for a player entering their first rated season.
 *
 * Prefers where they actually finished last season; falls back to their Club
 * Locker rating, and finally to the base rating.
 */
function seedRating({ previousPosition, previousRating, ladderSize, clubLockerRating }, cfg) {
  // A previous rated season carries over directly; ratings are continuous
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

module.exports = {
  DEFAULTS, config, expectedScore, ratingDelta, applyMatch, seedRating,
};
