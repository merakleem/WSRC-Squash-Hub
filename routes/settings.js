const express = require('express');
const settingsModel = require('../models/settingsModel');
const { wrap, requireAdmin } = require('../middleware');

const router = express.Router();

// Settings are readable by any logged-in user (the ladder needs its tuning
// values to explain itself); only admins can change them.
router.get('/settings', wrap(async (req, res) => {
  res.json(await settingsModel.getAllSettings());
}));

router.put('/settings', requireAdmin, wrap(async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'Expected an object of key/value pairs' });
  }
  res.json(await settingsModel.setSettings(updates));
}));

module.exports = router;
