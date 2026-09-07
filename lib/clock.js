// ===== CLOCK =====
// The club is in one place. The server is not necessarily in the same place:
// Railway containers run on UTC, which is five or six hours ahead of Winnipeg.
//
// Everything stored is club wall-clock time - a booking on 2026-08-11 at 19:00
// means seven in the evening at the club, with no offset attached. So any
// server-side comparison against "now" has to be made in the club's timezone,
// not the container's. Using the container's meant that from early evening the
// server already believed it was tomorrow, and every booking left in the day
// dropped out of My Bookings, including one being played at that moment.

const DEFAULT_TIMEZONE = process.env.CLUB_TIMEZONE || 'America/Winnipeg';

/**
 * The club's timezone: the admin's setting first, then the CLUB_TIMEZONE env
 * var, then Winnipeg. Anything unparseable falls back rather than throwing -
 * a bad setting must never take the clock down with it.
 */
function getClubTimezone() {
  let tz = null;
  try {
    tz = require('../models/settingsModel').getSetting('club_timezone', null);
  } catch (_) { /* settings not available yet (e.g. before init) */ }
  tz = tz || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch (_) {
    return 'America/Winnipeg';
  }
}

/**
 * The current date and time at the club, as the same strings the database
 * stores: { date: 'YYYY-MM-DD', time: 'HH:MM' }.
 *
 * Derived through Intl rather than by adding a fixed offset, so daylight saving
 * is handled without a table of dates to maintain.
 */
function clubNow(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: getClubTimezone(),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  // Some ICU builds still render midnight as "24" under h23; normalise it so
  // the string can be compared against a stored start_time.
  const hour = parts.hour === '24' ? '00' : parts.hour;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  };
}

/** Today's date at the club, 'YYYY-MM-DD'. */
function clubToday(at = new Date()) {
  return clubNow(at).date;
}

module.exports = { getClubTimezone, clubNow, clubToday };
