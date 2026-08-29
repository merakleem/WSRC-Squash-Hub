const express = require('express');
const { getDB } = require('../database/db');
const { wrap, requireAdmin, setSessionCookie } = require('../middleware');

const router = express.Router();

// ===== VIEWING AS A PLAYER =====
// An admin can look at the app exactly as a member sees it. It is the honest
// answer to "what is this member looking at?", and on staging it removes the
// invite-and-password dance entirely: click a player, be them.
//
// Mounted with the other API routes rather than in auth.js, so it sits behind
// the session guard and the CSRF check like everything else that mutates.

router.post('/players/:id/view-as', requireAdmin, wrap(async (req, res) => {
  const player = getDB().prepare('SELECT id, name FROM players WHERE id = ?').get(Number(req.params.id));
  if (!player) return res.status(404).json({ error: 'Player not found.' });

  // viewingAs is part of the signed session, so a real player can never carry
  // it and can never use the route back.
  setSessionCookie(res, { role: 'player', playerId: player.id, viewingAs: true });
  res.json({ ok: true, name: player.name });
}));

router.post('/return-to-admin', wrap(async (req, res) => {
  if (!req.session?.viewingAs) return res.status(403).json({ error: 'Not viewing as a player.' });
  setSessionCookie(res, { role: 'admin' });
  res.json({ ok: true });
}));

module.exports = router;
