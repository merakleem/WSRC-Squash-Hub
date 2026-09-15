const bookingModel = require('../models/bookingModel');
const { activeReservations } = require('./reservations');
const { getDB } = require('../database/db');

// ===== THE COURT THE DASHBOARD OFFERS =====
// One slot, so a member can book without thinking about it. Two ways of
// choosing it, in order:
//
//   1. Their usual slot. Most members play the same court at the same hour on
//      the same weekday; when the booking history says so, the next free
//      occurrence of that slot is the offer.
//   2. The next open court. Otherwise (or when the usual slot is taken for the
//      next two weeks), the soonest free start from now - today, then tomorrow -
//      taking the lowest-numbered court that is free at that start.
//
// The card never says which of the two it used.
//
// "Free" means what the booking grid draws as free: no booking, no league or
// tournament match, no live hold. That is the whole schedule for the day, not
// just the bookings table, so the offer is never a slot the booking page would
// refuse to open.

// The booking page's grid, and therefore the only starts a member can pick.
const DAY_START = 6 * 60;
const DAY_END = 23 * 60;
const SLOT_MIN = 30;

// How much history counts as a rhythm, and how far back to look for it.
const USUAL_LOOKBACK_DAYS = 120;
const USUAL_MIN_BOOKINGS = 3;
const USUAL_SEARCH_DAYS = 14;

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

const _weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

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
 * The member's usual court, weekday and time, or null when the history is too
 * thin to call one. Ties go to the group booked most recently, then the lowest
 * court, then the earliest time - so the same history always names the same
 * slot.
 */
function usualSlot(playerId, today, courts) {
  const rows = getDB().prepare(`
    SELECT b.court_id, b.date, b.start_time, b.duration_minutes
    FROM bookings b
    JOIN booking_players bp ON bp.booking_id = b.id
    WHERE bp.player_id = ? AND b.date < ? AND b.date >= ?
    ORDER BY b.date DESC
  `).all(playerId, today, _shiftDate(today, -USUAL_LOOKBACK_DAYS));
  if (rows.length < USUAL_MIN_BOOKINGS) return null;

  const groups = new Map();
  const order = new Map(courts.map((c, i) => [c.id, i]));
  for (const r of rows) {
    // A court the club has since retired is not somewhere to send anyone.
    if (!order.has(r.court_id)) continue;
    const weekday = _weekday(r.date);
    const key = `${r.court_id}|${weekday}|${r.start_time}`;
    if (!groups.has(key)) {
      groups.set(key, { courtId: r.court_id, weekday, startTime: r.start_time, count: 0, last: '', durations: new Map() });
    }
    const g = groups.get(key);
    g.count++;
    if (r.date > g.last) g.last = r.date;
    g.durations.set(r.duration_minutes, (g.durations.get(r.duration_minutes) || 0) + 1);
  }

  const best = [...groups.values()].sort((a, b) => b.count - a.count
    || b.last.localeCompare(a.last)
    || (order.get(a.courtId) ?? 999) - (order.get(b.courtId) ?? 999)
    || a.startTime.localeCompare(b.startTime))[0];
  if (!best || best.count < USUAL_MIN_BOOKINGS) return null;

  const duration = [...best.durations.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  return { ...best, durationMinutes: duration };
}

/** The next free occurrence of a usual slot, or null if it is taken throughout. */
function nextFreeOccurrence(slot, today, nowMin) {
  const start = _toMin(slot.startTime);
  for (let i = 0; i <= USUAL_SEARCH_DAYS; i++) {
    const date = _shiftDate(today, i);
    if (_weekday(date) !== slot.weekday) continue;
    if (i === 0 && start < nowMin) continue;
    if (_isFree(readDay(date).spans, slot.courtId, start, slot.durationMinutes)) {
      return { date, startTime: slot.startTime, courtId: slot.courtId, durationMinutes: slot.durationMinutes };
    }
  }
  return null;
}

/**
 * The soonest free start, today then tomorrow; where several courts are free at
 * that same start, the lowest-numbered one. Time is what a member is choosing
 * between - the court only breaks the tie.
 */
function nextOpenCourt(today, nowMin) {
  for (const [i, date] of [today, _shiftDate(today, 1)].entries()) {
    const { courts, spans } = readDay(date);
    const floor = i === 0 ? Math.max(DAY_START, Math.ceil(nowMin / SLOT_MIN) * SLOT_MIN) : DAY_START;
    for (let start = floor; start + SLOT_MIN <= DAY_END; start += SLOT_MIN) {
      const court = courts.find((c) => _isFree(spans, c.id, start, SLOT_MIN));
      if (court) return { date, startTime: _toTime(start), courtId: court.id, durationMinutes: SLOT_MIN };
    }
  }
  return null;
}

/**
 * The slot to offer `playerId`, or null when the club is full for two days.
 * `mode` is 'usual' or 'open' — for tests and logs, not for the card.
 */
function suggestSlot(playerId, today, nowMin) {
  const { courts } = readDay(today);
  if (!courts.length) return null;
  const names = new Map(courts.map((c) => [c.id, c.name]));

  const usual = usualSlot(playerId, today, courts);
  const hit = (usual && nextFreeOccurrence(usual, today, nowMin));
  const chosen = hit || nextOpenCourt(today, nowMin);
  if (!chosen) return null;
  return {
    mode: hit ? 'usual' : 'open',
    courtId: chosen.courtId,
    courtName: names.get(chosen.courtId) || 'Court',
    date: chosen.date,
    startTime: chosen.startTime,
    durationMinutes: chosen.durationMinutes,
  };
}

module.exports = {
  DAY_START, DAY_END, SLOT_MIN,
  USUAL_LOOKBACK_DAYS, USUAL_MIN_BOOKINGS, USUAL_SEARCH_DAYS,
  readDay, usualSlot, nextFreeOccurrence, nextOpenCourt, suggestSlot,
};
