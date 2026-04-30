const express = require('express');
const { getDB } = require('../database/db');
const bookingModel = require('../models/bookingModel');
const { reservations, RESERVATION_TTL_MS, hasBookingConflict, hasReservationConflict, nextReservationId } = require('../lib/reservations');
const { wrap, requireAdmin, requireAuth } = require('../middleware');

const router = express.Router();

// ===== RESERVATIONS =====

router.post('/reservations', requireAuth, wrap(async (req, res) => {
  const { courtId, date, startTime, durationMinutes } = req.body;
  if (!courtId || !date || !startTime || !durationMinutes) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (hasBookingConflict(Number(courtId), date, startTime, Number(durationMinutes))) {
    return res.status(409).json({ error: 'This slot is already booked.' });
  }
  if (hasReservationConflict(Number(courtId), date, startTime, Number(durationMinutes), null)) {
    return res.status(409).json({ error: 'This slot is currently reserved by another player.' });
  }
  const id = nextReservationId();
  const expiresAt = Date.now() + RESERVATION_TTL_MS;
  reservations.set(id, {
    id, courtId: Number(courtId), date, startTime,
    durationMinutes: Number(durationMinutes),
    playerId: req.session.playerId, expiresAt,
  });
  res.json({ reservationId: id, expiresAt });
}));

router.delete('/reservations/:id', requireAuth, wrap(async (req, res) => {
  const r = reservations.get(req.params.id);
  if (r && r.playerId !== req.session.playerId) {
    return res.status(403).json({ error: 'Not your reservation.' });
  }
  reservations.delete(req.params.id);
  res.json({ ok: true });
}));

// ===== PLAYER BOOKINGS =====

router.post('/player-bookings', requireAuth, wrap(async (req, res) => {
  const { reservationId, durationMinutes, playerIds } = req.body;
  const rsv = reservationId ? reservations.get(String(reservationId)) : null;
  if (!rsv) return res.status(400).json({ error: 'Reservation not found or expired. Please try again.' });
  if (rsv.playerId !== req.session.playerId) return res.status(403).json({ error: 'Not your reservation.' });
  if (rsv.expiresAt <= Date.now()) {
    reservations.delete(String(reservationId));
    return res.status(410).json({ error: 'Reservation has expired.' });
  }
  const finalDuration = Number(durationMinutes) || rsv.durationMinutes;
  const db = getDB();
  if (hasBookingConflict(rsv.courtId, rsv.date, rsv.startTime, finalDuration)) {
    reservations.delete(String(reservationId));
    return res.status(409).json({ error: 'This slot was booked by someone else. Please try again.' });
  }
  const player = db.prepare('SELECT name FROM players WHERE id = ?').get(req.session.playerId);
  const guestIds = Array.isArray(playerIds) ? playerIds.map(Number).filter((id) => id !== req.session.playerId) : [];
  const allIds = [req.session.playerId, ...guestIds];
  const names = allIds.map((id) => db.prepare('SELECT name FROM players WHERE id = ?').get(id)?.name).filter(Boolean);
  const booking = await bookingModel.addBooking({
    courtId: rsv.courtId, date: rsv.date, startTime: rsv.startTime,
    durationMinutes: finalDuration,
    name: player?.name || 'Court Booking',
    info: names.join(', '),
    playerIds: allIds,
  });
  reservations.delete(String(reservationId));
  res.json(booking);
}));

router.delete('/player-bookings/:id', requireAuth, wrap(async (req, res) => {
  const db = getDB();
  const isMember = db.prepare('SELECT 1 FROM booking_players WHERE booking_id = ? AND player_id = ?')
    .get(Number(req.params.id), req.session.playerId);
  if (!isMember) return res.status(403).json({ error: 'You are not part of this booking.' });
  await bookingModel.deleteBooking(req.params.id);
  res.json({ ok: true });
}));

router.put('/player-bookings/:id', requireAuth, wrap(async (req, res) => {
  const db = getDB();
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(req.params.id));
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  const isMember = db.prepare('SELECT 1 FROM booking_players WHERE booking_id = ? AND player_id = ?')
    .get(Number(req.params.id), req.session.playerId);
  if (!isMember) return res.status(403).json({ error: 'You are not part of this booking.' });
  const { durationMinutes, playerIds } = req.body;
  if (durationMinutes) {
    db.prepare('UPDATE bookings SET duration_minutes = ? WHERE id = ?')
      .run(Number(durationMinutes), Number(req.params.id));
  }
  if (Array.isArray(playerIds)) {
    const allIds = [...new Set([req.session.playerId, ...playerIds.map(Number)])].slice(0, 4);
    db.prepare('DELETE FROM booking_players WHERE booking_id = ?').run(Number(req.params.id));
    const stmt = db.prepare('INSERT INTO booking_players (booking_id, player_id) VALUES (?, ?)');
    for (const pid of allIds) stmt.run(Number(req.params.id), pid);
    const names = allIds.map((id) => db.prepare('SELECT name FROM players WHERE id = ?').get(id)?.name).filter(Boolean);
    db.prepare('UPDATE bookings SET info = ? WHERE id = ?').run(names.join(', '), Number(req.params.id));
  }
  res.json({ ok: true });
}));

// ===== BOOKING TYPES =====

router.get('/booking-types', wrap(async (req, res) => {
  res.json(await bookingModel.getAllBookingTypes());
}));

router.post('/booking-types', requireAdmin, wrap(async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!color?.trim()) return res.status(400).json({ error: 'Color is required' });
  res.json(await bookingModel.addBookingType({ name: name.trim(), color: color.trim() }));
}));

router.put('/booking-types/:id', requireAdmin, wrap(async (req, res) => {
  const { name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!color?.trim()) return res.status(400).json({ error: 'Color is required' });
  res.json(await bookingModel.updateBookingType({ id: req.params.id, name: name.trim(), color: color.trim() }));
}));

router.delete('/booking-types/:id', requireAdmin, wrap(async (req, res) => {
  await bookingModel.deleteBookingType(req.params.id);
  res.json({ ok: true });
}));

// ===== BOOKINGS =====

router.post('/bookings', requireAdmin, wrap(async (req, res) => {
  const { courtId, courtIds, date, startTime, durationMinutes, bookingTypeId, name, info, playerIds } = req.body;
  const hasCourtId = courtId || (Array.isArray(courtIds) && courtIds.length > 0);
  if (!hasCourtId) return res.status(400).json({ error: 'Court is required' });
  if (!date) return res.status(400).json({ error: 'Date is required' });
  if (!startTime) return res.status(400).json({ error: 'Start time is required' });
  if (!durationMinutes) return res.status(400).json({ error: 'Duration is required' });
  res.json(await bookingModel.addBooking({ courtId, courtIds, date, startTime, durationMinutes, bookingTypeId, name, info, playerIds }));
}));

router.post('/bookings/repeat', requireAdmin, wrap(async (req, res) => {
  const { courtId, courtIds, startTime, durationMinutes, bookingTypeId, name, info, playerIds, repeat } = req.body;
  const { startDate, daysOfWeek, weeks, conflictMode } = repeat || {};
  const hasCourtId = courtId || (Array.isArray(courtIds) && courtIds.length > 0);
  if (!hasCourtId) return res.status(400).json({ error: 'Court is required' });
  if (!startDate) return res.status(400).json({ error: 'Start date is required' });
  if (!startTime) return res.status(400).json({ error: 'Start time is required' });
  if (!durationMinutes) return res.status(400).json({ error: 'Duration is required' });
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) return res.status(400).json({ error: 'Select at least one day of week' });
  const result = bookingModel.createRepeatBookings(
    { courtId, courtIds, startTime, durationMinutes, bookingTypeId, name, info, playerIds },
    { startDate, daysOfWeek, weeks: weeks || 52, conflictMode: conflictMode || 'skip' }
  );
  res.json(result);
}));

router.put('/bookings/:id', requireAdmin, wrap(async (req, res) => {
  const { courtId, courtIds, date, startTime, durationMinutes, bookingTypeId, name, info, playerIds, excludeIds } = req.body;
  res.json(await bookingModel.updateBooking({ id: req.params.id, courtId, courtIds, date, startTime, durationMinutes, bookingTypeId, name, info, playerIds, excludeIds }));
}));

router.delete('/bookings/:id', requireAdmin, wrap(async (req, res) => {
  const { scope, groupId, date } = req.query;
  if ((scope === 'future' || scope === 'all') && groupId) {
    await bookingModel.deleteRepeatGroup(Number(groupId), scope, date);
  } else {
    await bookingModel.deleteBooking(req.params.id);
  }
  res.json({ ok: true });
}));

module.exports = router;
