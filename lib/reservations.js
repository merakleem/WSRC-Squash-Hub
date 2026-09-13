const { getDB } = require('../database/db');

// ===== COURT HOLDS =====
// A member picks a slot on the booking page and has five minutes to finish
// (choose a length, add a partner) before anyone else can take it. Holds are
// rows in `reservations` with an epoch-ms expiry, so they survive a deploy
// and would be seen by a second instance; expired rows are ignored by every
// query and swept on each new hold and once a minute.

const RESERVATION_TTL_MS = 5 * 60 * 1000;

function _toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function _overlaps(startMin, endMin, otherStart, otherDuration) {
  const os = _toMin(otherStart);
  return startMin < os + Number(otherDuration) && os < endMin;
}

function hasBookingConflict(courtId, date, startTime, durationMinutes) {
  const startMin = _toMin(startTime);
  const endMin = startMin + Number(durationMinutes);
  const rows = getDB().prepare('SELECT start_time, duration_minutes FROM bookings WHERE court_id=? AND date=?').all(courtId, date);
  return rows.some((b) => _overlaps(startMin, endMin, b.start_time, b.duration_minutes));
}

function hasReservationConflict(courtId, date, startTime, durationMinutes, excludeId = null) {
  const startMin = _toMin(startTime);
  const endMin = startMin + Number(durationMinutes);
  const rows = getDB().prepare(
    'SELECT id, start_time, duration_minutes FROM reservations WHERE court_id = ? AND date = ? AND expires_at > ?',
  ).all(courtId, date, Date.now());
  return rows.some((r) => r.id !== Number(excludeId) && _overlaps(startMin, endMin, r.start_time, r.duration_minutes));
}

function purgeExpired() {
  return getDB().prepare('DELETE FROM reservations WHERE expires_at <= ?').run(Date.now()).changes;
}

/**
 * Take a hold. Returns the row, or null when the slot is booked or held by
 * someone else. The check and the insert are one immediate transaction, so
 * two members reaching for the same slot at once cannot both get it.
 */
function createReservation({ courtId, date, startTime, durationMinutes, playerId }) {
  const db = getDB();
  const take = db.transaction(() => {
    purgeExpired();
    if (hasBookingConflict(courtId, date, startTime, durationMinutes)) return { conflict: 'booked' };
    if (hasReservationConflict(courtId, date, startTime, durationMinutes)) return { conflict: 'held' };
    const expiresAt = Date.now() + RESERVATION_TTL_MS;
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO reservations (court_id, date, start_time, duration_minutes, player_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(courtId, date, startTime, durationMinutes, playerId, expiresAt);
    return { reservation: getReservation(lastInsertRowid) };
  });
  return take.immediate();
}

/** One hold by id, in the shape the routes and the schedule use; null if unknown. */
function getReservation(id) {
  const r = getDB().prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
  return r ? _shape(r) : null;
}

function deleteReservation(id) {
  return getDB().prepare('DELETE FROM reservations WHERE id = ?').run(Number(id)).changes > 0;
}

/** Every unexpired hold on a day. */
function activeReservations(date) {
  return getDB().prepare('SELECT * FROM reservations WHERE date = ? AND expires_at > ? ORDER BY id').all(date, Date.now()).map(_shape);
}

function _shape(r) {
  return {
    id: r.id, courtId: r.court_id, date: r.date, startTime: r.start_time,
    durationMinutes: r.duration_minutes, playerId: r.player_id, expiresAt: r.expires_at,
  };
}

const _sweep = setInterval(() => { try { if (getDB()) purgeExpired(); } catch (_) { /* db closed */ } }, 60_000);
_sweep.unref();

module.exports = {
  RESERVATION_TTL_MS,
  hasBookingConflict,
  hasReservationConflict,
  createReservation,
  getReservation,
  deleteReservation,
  activeReservations,
  purgeExpired,
};
