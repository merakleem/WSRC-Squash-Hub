const express = require('express');
const ladderModel = require('../models/ladderModel');
const { wrap } = require('../middleware');

const router = express.Router();

/**
 * The ladder for a season (defaults to the current one).
 *
 * Returns an array for backwards compatibility with existing callers that
 * expect a bare list; season metadata rides alongside on /ladder/season.
 */
router.get('/ladder', wrap(async (req, res) => {
  const result = ladderModel.getLadderForSeason(req.query.season || null);
  res.json(result.rows);
}));

// Ladder plus the context needed to render it: which season, which system, and
// whether it is frozen.
router.get('/ladder/season', wrap(async (req, res) => {
  const result = ladderModel.getLadderForSeason(req.query.season || null);
  res.json({
    season: result.season,
    system: result.system,
    frozen: result.frozen,
    rows: result.rows,
  });
}));

module.exports = router;
