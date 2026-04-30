const { getDB } = require('../database/db');

// ===== IN-MEMORY RESERVATION STORE (player court holds, 5-min TTL) =====

const reservations = new Map();
let _nextResId = 1;
const RESERVATION_TTL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, r] of reservations) {
    if (r.expiresAt <= now) reservations.delete(id);
  }
}, 60_000).unref();

function _toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function hasBookingConflict(courtId, date, startTime, durationMinutes) {
  const db = getDB();
  const startMin = _toMin(startTime);
  const endMin = startMin + Number(durationMinutes);
  const rows = db.prepare('SELECT start_time, duration_minutes FROM bookings WHERE court_id=? AND date=?').all(courtId, date);
  return rows.some((b) => {
    const bs = _toMin(b.start_time);
    return startMin < bs + b.duration_minutes && bs < endMin;
  });
}

function hasReservationConflict(courtId, date, startTime, durationMinutes, excludeId) {
  const startMin = _toMin(startTime);
  const endMin = startMin + Number(durationMinutes);
  const now = Date.now();
  for (const [id, r] of reservations) {
    if (id === excludeId || r.courtId !== courtId || r.date !== date || r.expiresAt <= now) continue;
    const rs = _toMin(r.startTime);
    if (startMin < rs + r.durationMinutes && rs < endMin) return true;
  }
  return false;
}

function nextReservationId() {
  return String(_nextResId++);
}

module.exports = {
  reservations,
  RESERVATION_TTL_MS,
  hasBookingConflict,
  hasReservationConflict,
  nextReservationId,
};
