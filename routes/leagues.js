const express = require('express');
const { getDB } = require('../database/db');
const leagueService = require('../services/leagueService');
const leagueModel = require('../models/leagueModel');
const { getValidConfigurations } = require('../utils/helpers');
const { wrap, requireAdmin } = require('../middleware');

const router = express.Router();

router.get('/leagues', wrap(async (req, res) => {
  const leagues = await leagueModel.getAllLeagues();
  const db = getDB();
  const memberships = db.prepare('SELECT league_id, player_id FROM league_players').all();
  const memberMap = {};
  for (const row of memberships) {
    if (!memberMap[row.league_id]) memberMap[row.league_id] = [];
    memberMap[row.league_id].push(row.player_id);
  }
  const matchCounts = db.prepare(`
    SELECT w.league_id,
      COUNT(*) AS total,
      SUM(CASE WHEN m.player1_score IS NOT NULL OR m.skipped = 1 THEN 1 ELSE 0 END) AS done
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w ON tm.week_id = w.id
    GROUP BY w.league_id
  `).all();
  const countMap = {};
  for (const row of matchCounts) countMap[row.league_id] = row;
  res.json(leagues.map((l) => {
    const counts = countMap[l.id];
    const status = counts && counts.total > 0 && counts.done === counts.total ? 'completed' : 'active';
    return { ...l, player_ids: memberMap[l.id] || [], status };
  }));
}));

router.get('/leagues/:id', wrap(async (req, res) => {
  const league = await leagueService.getFullLeague(Number(req.params.id));
  if (!league) return res.status(404).json({ error: 'League not found' });
  res.json(league);
}));

router.post('/leagues', requireAdmin, wrap(async (req, res) => {
  const leagueId = await leagueService.createLeague(req.body);
  res.json(leagueId);
}));

router.delete('/leagues/:id', requireAdmin, wrap(async (req, res) => {
  await leagueModel.deleteLeague(Number(req.params.id));
  res.json({ ok: true });
}));

router.post('/leagues/:id/replace-player', requireAdmin, wrap(async (req, res) => {
  const { oldPlayerId, newPlayerId } = req.body;
  if (!oldPlayerId || !newPlayerId) return res.status(400).json({ error: 'oldPlayerId and newPlayerId are required' });
  await leagueModel.replacePlayerInLeague(Number(req.params.id), Number(oldPlayerId), Number(newPlayerId));
  res.json({ ok: true });
}));

router.put('/leagues/:id/sub-remaining', requireAdmin, wrap(async (req, res) => {
  const { originalPlayerId, subPlayerId } = req.body;
  const count = await leagueModel.setSubForRemaining(Number(req.params.id), originalPlayerId, subPlayerId);
  res.json({ ok: true, count });
}));

router.post('/leagues/:id/message', requireAdmin, wrap(async (req, res) => {
  const { subject, body, attachments } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'Subject and body are required' });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });

  const players = await leagueModel.getLeaguePlayers(Number(req.params.id));
  const recipients = players.filter((p) => p.player_email);
  if (recipients.length === 0) return res.json({ sent: 0 });

  let sent = 0;
  for (const player of recipients) {
    const htmlBody = body
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Play WSRC <no-reply@playwsrc.ca>',
        to: [player.player_email],
        subject,
        html: `<p>${htmlBody}</p>`,
        ...(attachments && attachments.length ? { attachments } : {}),
      }),
    });
    if (response.ok) sent++;
  }
  res.json({ sent });
}));

router.get('/configs/:numPlayers', wrap(async (req, res) => {
  res.json(getValidConfigurations(Number(req.params.numPlayers)));
}));

module.exports = router;
