// ===== SEASONS =====
// Seasons are derived, not stored. A single recurring month/day splits all
// history into named periods forever, so nothing has to be created, assigned or
// marked current. Which season a match belongs to is decided purely by when it
// was played, which is what makes the whole thing self-correcting: fix a date
// and the match moves to the right season on its own.
//
// Pure functions only, no database access, so the rules can be unit-tested.

const DEFAULT_START_MD = '09-01';

/** Normalise a stored setting to MM-DD, falling back to the default. */
function startMonthDay(settings = {}) {
  const raw = String(settings.season_start_md || '').trim();
  return /^\d{2}-\d{2}$/.test(raw) ? raw : DEFAULT_START_MD;
}

function _dateOnly(value) {
  return String(value || '').slice(0, 10);
}

/**
 * Label for the season a date falls in.
 *
 * A season starting on 1 January is a single calendar year and is named for it;
 * anything else spans a year boundary and is named for the pair, e.g. "2026/27".
 */
function seasonKeyForDate(date, monthDay = DEFAULT_START_MD) {
  const iso = _dateOnly(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;

  const year = Number(iso.slice(0, 4));
  // Before the rollover day, the date still belongs to the season that opened
  // in the previous calendar year.
  const startYear = iso.slice(5) >= monthDay ? year : year - 1;

  if (monthDay === '01-01') return String(startYear);
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** First calendar year of a season key ("2026/27" and "2026" both give 2026). */
function seasonStartYear(key) {
  // Must be four digits: Number('') is 0, which would otherwise read as year
  // zero and make every real season look later than it.
  const head = String(key ?? '').slice(0, 4);
  return /^\d{4}$/.test(head) ? Number(head) : null;
}

/** Inclusive date range a season key covers. */
function seasonRange(key, monthDay = DEFAULT_START_MD) {
  const startYear = seasonStartYear(key);
  if (startYear == null) return null;

  const start = `${startYear}-${monthDay}`;
  // The day before the next season opens. Built by stepping back one day from
  // the next start so leap years and month lengths look after themselves.
  const nextStart = new Date(`${startYear + 1}-${monthDay}T00:00:00Z`);
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);
  return { start, end: nextStart.toISOString().slice(0, 10) };
}

/** The season containing today. */
function currentSeasonKey(monthDay = DEFAULT_START_MD, today = null) {
  return seasonKeyForDate(today || new Date().toISOString().slice(0, 10), monthDay);
}

/**
 * Every season from the earliest recorded activity through to today, newest
 * first. Seasons with no matches in them are still listed, so a gap year
 * doesn't silently vanish from the history.
 *
 * `latestDate` extends the range past today when a match is dated in the
 * future, so a scheduled or post-dated result still lands in a listed season
 * rather than appearing unassigned.
 */
function listSeasons({ earliestDate, latestDate, monthDay = DEFAULT_START_MD, today = null } = {}) {
  const todayIso = today || new Date().toISOString().slice(0, 10);
  const lastIso = latestDate && latestDate > todayIso ? latestDate : todayIso;
  const currentKey = seasonKeyForDate(todayIso, monthDay);
  const lastKey = seasonKeyForDate(lastIso, monthDay);
  const firstKey = earliestDate ? seasonKeyForDate(earliestDate, monthDay) : currentKey;
  if (!currentKey || !firstKey || !lastKey) return [];

  const from = seasonStartYear(firstKey);
  const to = seasonStartYear(lastKey);
  const keys = [];
  for (let y = from; y <= to; y++) {
    keys.push(monthDay === '01-01' ? String(y) : `${y}/${String((y + 1) % 100).padStart(2, '0')}`);
  }

  return keys.reverse().map((key) => {
    const range = seasonRange(key, monthDay);
    return {
      key,
      id: key,          // the frontend keys tabs and lookups off `id`
      name: key,
      start_date: range.start,
      end_date: range.end,
      is_current: key === currentKey,
      // A season that hasn't begun is not the same as one that has finished;
      // future-dated matches can pull an upcoming season into the list.
      status: key === currentKey ? 'active' : (range.start > todayIso ? 'upcoming' : 'ended'),
    };
  });
}

/**
 * Which ranking system a season is played under.
 *
 * The club's first season keeps the original positional ladder so its history
 * is never rewritten; every season after it is rated. Derived rather than
 * configured, so a new season can never come up under the wrong system.
 */
function ladderSystemFor(key, firstSeasonKey) {
  const seasonYear = seasonStartYear(key);
  const firstYear = seasonStartYear(firstSeasonKey);
  if (seasonYear == null || firstYear == null) return 'leapfrog';
  return seasonYear > firstYear ? 'elo' : 'leapfrog';
}

module.exports = {
  DEFAULT_START_MD, startMonthDay, seasonKeyForDate, seasonStartYear,
  seasonRange, currentSeasonKey, listSeasons, ladderSystemFor,
};
