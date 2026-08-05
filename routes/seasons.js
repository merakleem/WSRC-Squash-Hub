const express = require('express');
const seasonModel = require('../models/seasonModel');
const ladderModel = require('../models/ladderModel');
const { wrap, requireAdmin } = require('../middleware');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function _validate({ name, start_date, end_date }) {
  if (!name?.trim()) return 'Season name is required';
  if (!DATE_RE.test(start_date || '')) return 'Start date must be YYYY-MM-DD';
  if (!DATE_RE.test(end_date || '')) return 'End date must be YYYY-MM-DD';
  if (end_date < start_date) return 'End date must be on or after the start date';
  return null;
}

// Readable by any logged-in user; the profile page needs the season list to
// build its tabs.
router.get('/seasons', wrap(async (req, res) => {
  const seasons = await seasonModel.getAllSeasons();
  res.json(seasons.map((s) => ({ ...s, usage: seasonModel.getSeasonUsage(s.id) })));
}));

router.post('/seasons', requireAdmin, wrap(async (req, res) => {
  const error = _validate(req.body);
  if (error) return res.status(400).json({ error });
  const { name, start_date, end_date, is_current, ladder_system } = req.body;
  res.json(await seasonModel.addSeason({ name: name.trim(), start_date, end_date, is_current, ladder_system }));
}));

router.put('/seasons/:id', requireAdmin, wrap(async (req, res) => {
  const season = await seasonModel.getSeasonById(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const error = _validate(req.body);
  if (error) return res.status(400).json({ error });
  const { name, start_date, end_date, is_current, ladder_system } = req.body;
  // Absent ladder_system means "leave it alone"; an edit that only changes a
  // date must never silently downgrade a rating season to the positional one.
  res.json(await seasonModel.updateSeason({
    id: req.params.id, name: name.trim(), start_date, end_date, is_current,
    ladder_system: ladder_system ?? season.ladder_system,
  }));
}));

router.put('/seasons/:id/current', requireAdmin, wrap(async (req, res) => {
  const season = await seasonModel.getSeasonById(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  res.json(await seasonModel.setCurrentSeason(req.params.id));
}));

// Freezing is an explicit action rather than something that happens on the end
// date, so an admin can wait until every late-reported score is in.
router.put('/seasons/:id/end', requireAdmin, wrap(async (req, res) => {
  const season = await seasonModel.getSeasonById(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const result = ladderModel.freezeSeason(req.params.id);
  res.json({ ok: true, ...result, season: await seasonModel.getSeasonById(req.params.id) });
}));

// Re-freeze after a late score: reopen, then end again.
router.put('/seasons/:id/reopen', requireAdmin, wrap(async (req, res) => {
  const season = await seasonModel.getSeasonById(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  ladderModel.reopenSeason(req.params.id);
  res.json({ ok: true, season: await seasonModel.getSeasonById(req.params.id) });
}));

router.delete('/seasons/:id', requireAdmin, wrap(async (req, res) => {
  const season = await seasonModel.getSeasonById(req.params.id);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  await seasonModel.deleteSeason(req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
