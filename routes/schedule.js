const express = require('express');
const bookingModel = require('../models/bookingModel');
const { reservations } = require('../lib/reservations');
const { wrap } = require('../middleware');

const router = express.Router();

router.get('/schedule', wrap(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const data = bookingModel.getScheduleForDate(date);
  const now = Date.now();
  const rsvSlots = [...reservations.values()]
    .filter((r) => r.date === date && r.expiresAt > now)
    .map((r) => ({
      id: `rsv_${r.id}`,
      source: 'reservation',
      courtId: r.courtId,
      startTime: r.startTime,
      durationMinutes: r.durationMinutes,
      title: 'Reserved',
      info: '',
      color: '#9e9e9e',
      players: [],
    }));
  res.json({ ...data, slots: [...data.slots, ...rsvSlots] });
}));

module.exports = router;
