const express = require('express');
const ladderModel = require('../models/ladderModel');
const { wrap } = require('../middleware');

const router = express.Router();

router.get('/ladder', wrap(async (req, res) => {
  res.json(await ladderModel.getLadder());
}));

module.exports = router;
