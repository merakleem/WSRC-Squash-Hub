const express = require('express');
const settingsModel = require('../models/settingsModel');
const elo = require('../lib/elo');
const { wrap, requireAdmin } = require('../middleware');

// Bounds for the ladder's tuning values. A number outside these does not break
// the maths so much as make the ladder nonsense, and it is easier to refuse
// here than to explain the standings afterwards.
const LADDER_LIMITS = {
  elo_unproven_dock: [0, 400],
  elo_provisional_matches: [0, 30],
  elo_provisional_gain: [1, 10],
  elo_provisional_loss: [0, 1],
};

const router = express.Router();

// Settings are readable by any logged-in user (the ladder needs its tuning
// values to explain itself); only admins can change them.
router.get('/settings', wrap(async (req, res) => {
  const settings = await settingsModel.getAllSettings();
  // `ladder` carries the values actually in force, defaults filled in, so the
  // settings page never has to keep its own copy of them.
  res.json({ ...settings, ladder: elo.config(settings) });
}));

router.put('/settings', requireAdmin, wrap(async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'Expected an object of key/value pairs' });
  }
  for (const [key, [lo, hi]] of Object.entries(LADDER_LIMITS)) {
    if (!(key in updates)) continue;
    const n = Number(updates[key]);
    if (!Number.isFinite(n) || n < lo || n > hi) {
      return res.status(400).json({ error: `${key.replace(/^elo_/, '').replace(/_/g, ' ')} must be a number between ${lo} and ${hi}.` });
    }
    updates[key] = String(n);
  }
  if ('club_timezone' in updates) {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: String(updates.club_timezone) }); }
    catch (_) { return res.status(400).json({ error: 'That is not a valid time zone.' }); }
  }
  res.json(await settingsModel.setSettings(updates));
}));

module.exports = router;
