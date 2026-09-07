const express = require('express');
const crypto = require('crypto');
const { getDB } = require('../database/db');
const leagueService = require('../services/leagueService');
const leagueModel = require('../models/leagueModel');
const { getValidConfigurations } = require('../utils/helpers');
const { wrap, requireAdmin, emailLimiter } = require('../middleware');
const { sendBatch, isConfigured: emailConfigured, appUrl } = require('../lib/email');
const { clubToday } = require('../lib/clock');
const sanitizeHtml = require('sanitize-html');

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

  // Week progress, for the card's segmented bar. One grouped query rather than
  // one per league. "Elapsed" is measured against the club's today, not SQLite's
  // UTC now, so an evening viewer in Winnipeg doesn't see the week tick over a
  // day early.
  const weekRows = db.prepare(`
    SELECT w.league_id,
           COUNT(*) AS total_weeks,
           SUM(CASE WHEN w.date < @today THEN 1 ELSE 0 END) AS weeks_elapsed,
           MAX(w.date) AS last_week_date
    FROM weeks w
    GROUP BY w.league_id
  `).all({ today: clubToday() });
  const weekMap = {};
  for (const row of weekRows) weekMap[row.league_id] = row;

  // The signed-in player's own division, for the "You · Division 2" chip. Only
  // ever their own row: nobody else's placement is sent to a client, and this
  // is the whole list in one query rather than a fetch per card.
  const myDivision = {};
  const playerId = req.session?.playerId;
  if (playerId) {
    const rows = db.prepare(`
      SELECT lp.league_id, d.level
      FROM league_players lp
      JOIN divisions d ON d.id = lp.division_id
      WHERE lp.player_id = ?
    `).all(playerId);
    for (const row of rows) myDivision[row.league_id] = row.level;
  }

  res.json(leagues.map((l) => {
    const counts = countMap[l.id];
    const status = counts && counts.total > 0 && counts.done === counts.total ? 'completed' : 'active';
    const weeks = weekMap[l.id];
    return {
      ...l,
      player_ids: memberMap[l.id] || [],
      status,
      total_weeks: weeks?.total_weeks || 0,
      weeks_elapsed: weeks?.weeks_elapsed || 0,
      last_week_date: weeks?.last_week_date || null,
      my_division_level: myDivision[l.id] ?? null,
    };
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

router.put('/leagues/:id/end', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const db = getDB();
  const league = db.prepare('SELECT id, status FROM leagues WHERE id = ?').get(id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  if (league.status === 'completed') return res.status(400).json({ error: 'League is already completed' });

  db.prepare('UPDATE leagues SET status = ? WHERE id = ?').run('completed', id);
  const skipped = db.prepare(`
    UPDATE matches SET skipped = 1
    WHERE (player1_score IS NULL) AND (skipped IS NULL OR skipped = 0)
      AND matchup_id IN (
        SELECT tm.id FROM team_matchups tm
        JOIN weeks w ON tm.week_id = w.id
        WHERE w.league_id = ?
      )
  `).run(id);

  res.json({ ok: true, matchesSkipped: skipped.changes });
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

// The body arrives as editor HTML (bodyHtml) with a plain-text copy (body).
// Admin-authored, but it lands in players' inboxes, so it goes through a
// strict allowlist matching exactly what the editor can produce.
function sanitizeMessageHtml(bodyHtml) {
  return sanitizeHtml(bodyHtml, {
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 'b', 'i', 'ol', 'ul', 'li', 'a', 'h2', 'h3'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener' }) },
  });
}
router.sanitizeMessageHtml = sanitizeMessageHtml;

router.post('/leagues/:id/message', requireAdmin, wrap(async (req, res) => {
  const { subject, body, bodyHtml, attachments } = req.body;
  if (!subject || !(bodyHtml || body)) return res.status(400).json({ error: 'Subject and body are required' });

  if (!emailConfigured()) return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });

  const players = await leagueModel.getLeaguePlayers(Number(req.params.id));
  const recipients = players.filter((p) => p.player_email);
  if (recipients.length === 0) return res.json({ sent: 0 });

  const html = bodyHtml
    ? sanitizeMessageHtml(bodyHtml)
    : `<p>${body
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')}</p>`;

  const { sent, failed } = await sendBatch(recipients.map((player) => ({
    to: [player.player_email],
    subject,
    html,
    ...(body ? { text: body } : {}),
    ...(attachments && attachments.length ? { attachments } : {}),
  })));

  res.json({ sent, failed });
}));

router.post('/leagues/:id/bulk-invite', requireAdmin, emailLimiter, wrap(async (req, res) => {
  if (!emailConfigured()) return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });

  const db = getDB();
  const players = await leagueModel.getLeaguePlayers(Number(req.params.id));

  const eligible = players.filter((p) => {
    if (!p.player_email) return false;
    const account = db.prepare('SELECT password_hash FROM user_accounts WHERE player_id = ?').get(p.player_id);
    return !account?.password_hash;
  });

  if (eligible.length === 0) return res.json({ sent: 0 });

  const baseUrl = appUrl(req);
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  const batch = eligible.map((p) => {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(`
      INSERT INTO user_accounts (player_id, invite_token, invite_expires)
      VALUES (?, ?, ?)
      ON CONFLICT (player_id) DO UPDATE SET invite_token = excluded.invite_token, invite_expires = excluded.invite_expires
    `).run(p.player_id, token, expires);
    return {
      to: [p.player_email],
      subject: 'Activate your Play WSRC account',
      html: `<p>Hi ${p.player_name},</p>
<p>You've been invited to create an account on Play WSRC.</p>
<p><a href="${baseUrl}/invite/${token}">Click here to activate your account</a></p>
<p>This link expires in 72 hours.</p>`,
    };
  });

  const { sent, failed } = await sendBatch(batch);

  res.json({ sent, failed });
}));

router.get('/configs/:numPlayers', wrap(async (req, res) => {
  res.json(getValidConfigurations(Number(req.params.numPlayers)));
}));

module.exports = router;
