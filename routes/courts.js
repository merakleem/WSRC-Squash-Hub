const express = require('express');
const courtModel = require('../models/courtModel');
const { wrap, requireAdmin } = require('../middleware');

const router = express.Router();

router.get('/courts', wrap(async (req, res) => {
  res.json(await courtModel.getAllCourts());
}));

router.post('/courts', requireAdmin, wrap(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Court name is required' });
  res.json(await courtModel.addCourt({ name: name.trim() }));
}));

router.put('/courts/:id', requireAdmin, wrap(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Court name is required' });
  res.json(await courtModel.updateCourt({ id: req.params.id, name: name.trim() }));
}));

router.delete('/courts/:id', requireAdmin, wrap(async (req, res) => {
  await courtModel.deleteCourt(req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
