const express = require('express');
const settingsModel = require('../models/settingsModel');
const elo = require('../lib/elo');
const { wrap, hasPerm } = require('../middleware');
const { audit, describeSettings } = require('../lib/audit');

// Bounds for the ladder's tuning values. A number outside these does not break
// the maths so much as make the ladder nonsense, and it is easier to refuse
// here than to explain the standings afterwards.
const LADDER_LIMITS = {
  elo_club_locker_pivot: [0, 10],
  elo_club_locker_scale: [0, 600],
  elo_margin_weight: [0, 0.5],
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

// Which permission each setting needs. Anything not listed is the admin
// account's alone.
const SETTING_AREA = {
  club_timezone: 'club',
  elo_club_locker_pivot: 'ladder',
  elo_club_locker_scale: 'ladder',
  elo_margin_weight: 'ladder',
};
function requireSettingPerms(req, res, next) {
  const keys = Object.keys(req.body && typeof req.body === 'object' ? req.body : {});
  const ok = req.session?.role === 'admin' || (keys.length > 0 && keys.every((k) => SETTING_AREA[k] && hasPerm(req.session, SETTING_AREA[k])));
  if (!ok) return res.status(403).json({ error: "You don't have permission to do that." });
  next();
}
const settingsArea = (req) => SETTING_AREA[Object.keys(req.body || {})[0]] || 'club';

router.put('/settings', requireSettingPerms, (req, res, next) => audit(settingsArea(req), describeSettings(req.body))(req, res, next), wrap(async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'Expected an object of key/value pairs' });
  }
  for (const [key, [lo, hi]] of Object.entries(LADDER_LIMITS)) {
    if (!(key in updates)) continue;
    const n = Number(updates[key]);
    if (!Number.isFinite(n) || n < lo || n > hi) {
      const label = { elo_club_locker_pivot: 'Mid-ladder rating', elo_margin_weight: 'Weight per game' }[key] || 'Points per rating point';
      return res.status(400).json({ error: `${label} must be a number between ${lo} and ${hi}.` });
    }
    updates[key] = String(n);
  }
  if ('club_timezone' in updates) {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: String(updates.club_timezone) }); } catch (_) { return res.status(400).json({ error: 'That is not a valid time zone.' }); }
  }
  res.json(await settingsModel.setSettings(updates));
}));

module.exports = router;
