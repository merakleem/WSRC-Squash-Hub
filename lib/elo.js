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

  // ===== WINNING MARGIN =====
  // How much the scoreline counts. A 3-1 is the middle of the three squash
  // results and scores at face value; each game further apart is worth this
  // much more, each game closer this much less. So at 0.15 a 3-0 pays 15% over
  // a 3-1 and a 3-2 pays 15% under it, and because the exchange stays symmetric
  // a narrow defeat costs less by exactly as much as a narrow win pays less.
  // Zero ignores the scoreline: a win is a win.
  elo_margin_weight: 0.15,
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
 * How much a scoreline is worth, relative to a 3-1.
 *
 * Centred on a two-game margin rather than anchored at the closest result, so
 * turning the weight up sharpens the difference between scorelines without
 * quietly making every rating move bigger.
 *
 * Floored well above zero: a weight high enough to make a narrow win worth
 * nothing would mean a player could win and not move, which reads as a bug
 * however it was configured.
 */
function marginMultiplier(winnerGames, loserGames, cfg) {
  // No games recorded - a tournament match keeps its detail elsewhere - so the
  // scoreline cannot be weighed and the match counts at face value. Checked
  // before Number(), which turns null into 0 and would read a missing score as
  // a 0-0 thrashing in the loser's favour.
  if (winnerGames == null || loserGames == null || winnerGames === '' || loserGames === '') return 1;
  const w = Number(winnerGames);
  const l = Number(loserGames);
  if (!Number.isFinite(w) || !Number.isFinite(l)) return 1;
  return Math.max(0.2, 1 + (w - l - 2) * cfg.elo_margin_weight);
}

/**
 * Rating changes for one doubles match, one per player.
 *
 * Each side's strength is the mean of its two ratings. A player's expected
 * result is their own rating against the other side's mean, so partners with
 * different ratings move by different amounts: the weaker partner gains more
 * from a win and loses less from a defeat. The exchange is therefore not
 * exactly zero-sum, which is accepted - it is what makes every rating count.
 *
 * `sides` is [[r1, r2], [r3, r4]]; returns [[d1, d2], [d3, d4]].
 */
function doublesDeltas(sides, winnerSide, k) {
  const mean = (pair) => (pair[0] + pair[1]) / 2;
  return sides.map((pair, i) => {
    const oppMean = mean(sides[1 - i]);
    const actual = winnerSide === i + 1 ? 1 : 0;
    return pair.map((r) => k * (actual - expectedScore(r, oppMean)));
  });
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

  // No finish to convert: the Club Locker rating is the opening estimate.
  //
  // Without one there is nothing to estimate from, and the foot of the ladder is
  // the honest place for that - not the base, which is mid-table and would read
  // as "assumed average" rather than "unproven". They climb from there on
  // results, and beating someone well above them is worth more from down there,
  // so the climb is quick for anyone who deserves it.
  //
  // Checked for null before Number(), which turns both null and '' into 0 and
  // would otherwise seed an unrated member as if they were rated zero.
  if (clubLockerRating == null || clubLockerRating === '') return cfg.elo_seed_bottom;
  const rating = Number(clubLockerRating);
  if (!Number.isFinite(rating)) return cfg.elo_seed_bottom;
  return cfg.elo_base_rating + (rating - cfg.elo_club_locker_pivot) * cfg.elo_club_locker_scale;
}

module.exports = {
  DEFAULTS, config, expectedScore, ratingDelta, applyMatch, seedRating, marginMultiplier, doublesDeltas,
};
