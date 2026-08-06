const express = require('express');
const seasonModel = require('../models/seasonModel');
const seasons = require('../lib/seasons');
const { wrap, requireAdmin } = require('../middleware');

const router = express.Router();

// Seasons are derived from settings, so there is nothing to create, assign or
// mark current. Only two knobs exist: where the year splits, and which season
// ratings took over from.

// Readable by any logged-in user; the profile and ladder pages need the list.
router.get('/seasons', wrap(async (req, res) => {
  const all = seasonModel.getAllSeasons();
  res.json(all.map((s) => ({ ...s, usage: seasonModel.getSeasonUsage(s.key) })));
}));

router.get('/seasons/settings', wrap(async (req, res) => {
  const settings = seasonModel.getSettings();
  res.json({
    season_start_md: seasons.startMonthDay(settings),
    elo_start_season: settings.elo_start_season || '',
    current_season: seasonModel.getCurrentSeasonKey(),
    // Includes the upcoming season, so the switchover can be scheduled before
    // the season it names has begun.
    selectable: seasonModel.getSelectableSeasons(),
  });
}));

router.put('/seasons/settings', requireAdmin, wrap(async (req, res) => {
  const { season_start_md, elo_start_season } = req.body || {};

  if (season_start_md !== undefined) {
    if (!/^\d{2}-\d{2}$/.test(String(season_start_md))) {
      return res.status(400).json({ error: 'Season start must be MM-DD' });
    }
    // Guard against 02-30 and friends, which would produce a season that never
    // starts. Any non-leap year works as a probe.
    const probe = new Date(`2001-${season_start_md}T00:00:00Z`);
    if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(5, 10) !== String(season_start_md)) {
      return res.status(400).json({ error: 'That is not a real date' });
    }
  }

  if (elo_start_season) {
    const known = seasonModel.getSelectableSeasons().some((s) => s.key === String(elo_start_season));
    if (!known) return res.status(400).json({ error: 'Unknown season' });
  }

  res.json(await seasonModel.updateSettings({ season_start_md, elo_start_season }));
}));

module.exports = router;
