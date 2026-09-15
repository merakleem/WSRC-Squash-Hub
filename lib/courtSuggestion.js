const bookingModel = require('../models/bookingModel');
const { activeReservations } = require('./reservations');
const { getDB } = require('../database/db');

// ===== THE COURT THE DASHBOARD OFFERS =====
// One slot, so a member can book without thinking about it.
//
// The soonest start wins - today, then tomorrow - because the time is what a
// member is actually choosing between. Among the courts free at that same
// start, their usual one wins; failing that, the lowest-numbered. So someone
// who always books court 4 is offered court 4 when it is free at the soonest
// moment, and court 1 when it is not.
//
// "Free" means what the booking grid draws as free: no booking, no league or
// tournament match, no live hold. That is the whole schedule for the day, not
// just the bookings table, so the offer is never a slot the booking page would
// refuse to open.

// The booking page's grid, and therefore the only starts a member can pick.
const DAY_START = 6 * 60;
const DAY_END = 23 * 60;
const SLOT_MIN = 30;

const _toMin = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const _toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function _shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A day as this module reads it: the active courts in their own order, and
 * every span already taken, as `{ courtIds, start, end }`.
 *
 * A booking across several courts is one slot covering all of them, so its
 * `courtIds` is read rather than the single `courtId` its anchor sits on.
 */
function readDay(date) {
  const { courts, slots } = bookingModel.getScheduleForDate(date);
  const spans = slots.map((s) => ({
    courtIds: s.courtIds && s.courtIds.length ? s.courtIds : [s.courtId],
    start: _toMin(s.startTime),
    end: _toMin(s.startTime) + Number(s.durationMinutes || 0),
  }));
  for (const r of activeReservations(date)) {
    spans.push({ courtIds: [r.courtId], start: _toMin(r.startTime), end: _toMin(r.startTime) + Number(r.durationMinutes || 0) });
  }
  return { courts: courts.filter((c) => c.active), spans };
}

function _isFree(spans, courtId, startMin, durationMinutes) {
  const end = startMin + durationMinutes;
  return !spans.some((s) => s.courtIds.includes(courtId) && startMin < s.end && s.start < end);
}

/**
 * The court this member books more than any other, or null if they never have.
 *
 * Only a preference, never a constraint: it decides which of several equally
 * free courts to name, so one booking is signal enough and no threshold is
 * needed. Ties go to the court booked most recently, then the lowest - so the
 * same history always names the same court.
 */
function usualCourt(playerId, courts) {
  const rows = getDB().prepare(`
    SELECT b.court_id, MAX(b.date) AS last, COUNT(*) AS n
    FROM bookings b
    JOIN booking_players bp ON bp.booking_id = b.id
    WHERE bp.player_id = ?
    GROUP BY b.court_id
  `).all(playerId);

  const order = new Map(courts.map((c, i) => [c.id, i]));
  // A court the club has since retired is not somewhere to send anyone.
  const live = rows.filter((r) => order.has(r.court_id));
  if (!live.length) return null;
  live.sort((a, b) => b.n - a.n
    || String(b.last).localeCompare(String(a.last))
    || order.get(a.court_id) - order.get(b.court_id));
  return live[0].court_id;
}

/**
 * The slot to offer `playerId`, or null when the club is full for two days.
 * `mode` is 'usual' when the member's own court got it, 'open' otherwise -
 * for tests and logs, not for the card, which never says which.
 */
function suggestSlot(playerId, today, nowMin) {
  const preferred = usualCourt(playerId, readDay(today).courts);

  for (const [i, date] of [today, _shiftDate(today, 1)].entries()) {
    const { courts, spans } = readDay(date);
    const floor = i === 0 ? Math.max(DAY_START, Math.ceil(nowMin / SLOT_MIN) * SLOT_MIN) : DAY_START;
    for (let start = floor; start + SLOT_MIN <= DAY_END; start += SLOT_MIN) {
      const free = courts.filter((c) => _isFree(spans, c.id, start, SLOT_MIN));
      if (!free.length) continue;
      const court = free.find((c) => c.id === preferred) || free[0];
      return {
        mode: court.id === preferred ? 'usual' : 'open',
        courtId: court.id,
        courtName: court.name,
        date,
        startTime: _toTime(start),
        durationMinutes: SLOT_MIN,
      };
    }
  }
  return null;
}

module.exports = { DAY_START, DAY_END, SLOT_MIN, readDay, usualCourt, suggestSlot };
