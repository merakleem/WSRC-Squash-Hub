const express = require('express');
const { getDB } = require('../database/db');
const leagueModel = require('../models/leagueModel');
const seasonModel = require('../models/seasonModel');
const { wrap, requireAdmin, requireAuth, emailLimiter } = require('../middleware');
const { sendEmail, isConfigured: emailConfigured } = require('../lib/email');

const router = express.Router();

router.put('/matches/:id/timing', requireAdmin, wrap(async (req, res) => {
  const matchId = Number(req.params.id);
  const { matchTime, courtNumber, courtId } = req.body;
  const db = getDB();

  const ctx = db.prepare(`
    SELECT l.schedule_courts, l.num_courts, tm.week_id
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w ON tm.week_id = w.id
    JOIN leagues l ON w.league_id = l.id
    WHERE m.id = ?
  `).get(matchId);

  if (!ctx) return res.status(404).json({ error: 'Match not found' });

  let warning = null;

  if (matchTime) {
    if (courtId) {
      const conflict = db.prepare(`
        SELECT COUNT(*) AS cnt FROM matches m
        WHERE m.week_id = ? AND m.court_id = ? AND m.scheduled_time = ? AND m.id != ?
      `).get(ctx.week_id, courtId, matchTime, matchId);
      if (conflict.cnt > 0) {
        const courtName = db.prepare('SELECT name FROM courts WHERE id = ?').get(courtId)?.name || `Court ${courtId}`;
        return res.status(409).json({ error: `${courtName} is already booked at ${matchTime} this week.` });
      }
    } else if (ctx.schedule_courts && courtNumber) {
      const conflict = db.prepare(`
        SELECT COUNT(*) AS cnt FROM matches m
        WHERE m.week_id = ? AND m.court_number = ? AND m.scheduled_time = ? AND m.id != ?
      `).get(ctx.week_id, courtNumber, matchTime, matchId);
      if (conflict.cnt > 0) {
        return res.status(409).json({ error: `Court ${courtNumber} is already booked at ${matchTime} this week.` });
      }
    }

    if (!courtId && ctx.num_courts > 0) {
      const atSameTime = db.prepare(`
        SELECT COUNT(*) AS cnt FROM matches m
        WHERE m.week_id = ? AND m.scheduled_time = ? AND m.id != ?
      `).get(ctx.week_id, matchTime, matchId);
      if (atSameTime.cnt >= ctx.num_courts) {
        warning = `All ${ctx.num_courts} court${ctx.num_courts !== 1 ? 's' : ''} are already booked at ${matchTime} this week.`;
      }
    }
  }

  await leagueModel.updateMatchTiming(matchId, matchTime || null, courtId ? null : (courtNumber || null), courtId || null);
  res.json({ ok: true, warning });
}));

router.put('/matches/:id/score', requireAdmin, wrap(async (req, res) => {
  await leagueModel.updateMatchScore({ matchId: Number(req.params.id), submittedByPlayerId: null, ...req.body });
  res.json({ ok: true });
}));

router.put('/matches/:id/player-score', requireAuth, wrap(async (req, res) => {
  const matchId  = Number(req.params.id);
  const playerId = req.session.playerId;
  const myScore    = Number(req.body.myScore);
  const theirScore = Number(req.body.theirScore);

  const db = getDB();
  const match = db.prepare(`
    SELECT m.id, m.player1_id, m.player2_id, m.player1_score,
           s1.sub_player_id AS p1_sub, s2.sub_player_id AS p2_sub,
           l.status AS league_status
    FROM matches m
    LEFT JOIN match_subs s1 ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
    LEFT JOIN match_subs s2 ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
    JOIN team_matchups tm ON tm.id = m.matchup_id
    JOIN weeks w ON w.id = tm.week_id
    JOIN leagues l ON l.id = w.league_id
    WHERE m.id = ?
  `).get(matchId);

  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.league_status === 'completed') return res.status(403).json({ error: 'This league has ended — scores can no longer be reported.' });
  if (match.player1_score !== null) return res.status(409).json({ error: 'Score has already been reported for this match' });

  const effP1 = match.p1_sub ?? match.player1_id;
  const effP2 = match.p2_sub ?? match.player2_id;
  const isP1  = effP1 === playerId;
  const isP2  = effP2 === playerId;

  if (!isP1 && !isP2) return res.status(403).json({ error: 'You are not a player in this match' });

  const p1Score = isP1 ? myScore : theirScore;
  const p2Score = isP2 ? myScore : theirScore;

  const valid = Number.isInteger(p1Score) && Number.isInteger(p2Score)
    && p1Score >= 0 && p1Score <= 3 && p2Score >= 0 && p2Score <= 3
    && (p1Score === 3 || p2Score === 3) && p1Score !== p2Score;

  if (!valid) return res.status(400).json({ error: 'Invalid score — one player must win 3 games (e.g. 3–1, 3–2)' });

  const winnerId = p1Score > p2Score ? match.player1_id : match.player2_id;
  await leagueModel.updateMatchScore({ matchId, player1Score: p1Score, player2Score: p2Score, winnerId, submittedByPlayerId: playerId });
  res.json({ ok: true });
}));

// /matches/pickup must come before /matches/:id/* to avoid "pickup" matching as :id
router.post('/matches/pickup', requireAuth, wrap(async (req, res) => {
  const db = getDB();
  const submitterId = req.session.playerId;
  const isAdminUser = req.session.role === 'admin';

  let { player1Id, player2Id, player1Score, player2Score, playedOn } = req.body;
  player1Id    = Number(player1Id);
  player2Id    = Number(player2Id);
  player1Score = Number(player1Score);
  player2Score = Number(player2Score);

  if (!player1Id || !player2Id || isNaN(player1Score) || isNaN(player2Score)) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (player1Id === player2Id) return res.status(400).json({ error: 'Players must be different.' });
  if (!isAdminUser && submitterId !== player1Id && submitterId !== player2Id) {
    return res.status(403).json({ error: 'You can only submit scores for matches you played in.' });
  }

  const valid = Number.isInteger(player1Score) && Number.isInteger(player2Score)
    && player1Score >= 0 && player1Score <= 3
    && player2Score >= 0 && player2Score <= 3
    && (player1Score === 3 || player2Score === 3)
    && player1Score !== player2Score;
  if (!valid) return res.status(400).json({ error: 'Invalid score — one player must win 3 games (e.g. 3-1, 2-3).' });

  // When the match was played, as opposed to when it was reported. Everything
  // downstream already reads matches.played_at: which season the match
  // belongs to, where it sits in the rating replay, the ladder history chart
  // and the activity feed. So a date here lands correctly without further
  // wiring, and omitting it keeps today's behaviour of stamping now.
  let playedAt = null;
  if (playedOn) {
    const day = String(playedOn).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(new Date(`${day}T00:00:00Z`).getTime())) {
      return res.status(400).json({ error: 'Invalid date.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (day > today) return res.status(400).json({ error: 'A match cannot be played in the future.' });

    // Not before the current season: an earlier date files the match into a
    // finished season, where it would quietly affect a different ladder than
    // the one the submitter is looking at.
    const season = seasonModel.getCurrentSeason();
    if (season && day < season.start_date) {
      return res.status(400).json({ error: `That date is before the ${season.name} season started.` });
    }
    // Keep the stored shape identical to CURRENT_TIMESTAMP's, since every
    // reader slices the first ten characters off it.
    playedAt = `${day} 12:00:00`;
  }

  const winnerId = player1Score > player2Score ? player1Id : player2Id;
  db.prepare(
    `INSERT INTO matches (type, status, player1_id, player2_id, player1_score, player2_score, winner_id, submitted_by_player_id, played_at, confirmed_at)
     VALUES ('ladder', 'played', ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`
  ).run(player1Id, player2Id, player1Score, player2Score, winnerId, submitterId, playedAt);

  res.json({ ok: true });
}));

router.delete('/matches/pickup/:id', requireAdmin, wrap(async (req, res) => {
  getDB().prepare(`DELETE FROM matches WHERE id = ? AND type = 'ladder'`).run(Number(req.params.id));
  res.json({ ok: true });
}));

router.put('/matches/:id/unskip', requireAdmin, wrap(async (req, res) => {
  await leagueModel.unskipMatch(Number(req.params.id));
  res.json({ ok: true });
}));

router.put('/matches/:id/sub', requireAdmin, wrap(async (req, res) => {
  const { originalPlayerId, subPlayerId } = req.body;
  await leagueModel.setMatchSub(Number(req.params.id), originalPlayerId, subPlayerId);
  res.json({ ok: true });
}));

router.delete('/matches/:id/sub', requireAdmin, wrap(async (req, res) => {
  const { originalPlayerId } = req.body;
  await leagueModel.removeMatchSub(Number(req.params.id), originalPlayerId);
  res.json({ ok: true });
}));

router.post('/matches/:id/message-opponent', requireAuth, emailLimiter, wrap(async (req, res) => {
  const playerId = req.session.playerId;
  if (!playerId) return res.status(403).json({ error: 'Admin accounts cannot use this feature.' });

  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required.' });

  if (!emailConfigured()) return res.status(500).json({ error: 'Email service is not configured.' });

  const db = getDB();
  const match = db.prepare(`
    SELECT m.player1_id, m.player2_id,
           p1.name AS p1_name, p1.email AS p1_email,
           p2.name AS p2_name, p2.email AS p2_email
    FROM matches m
    JOIN players p1 ON p1.id = m.player1_id
    JOIN players p2 ON p2.id = m.player2_id
    WHERE m.id = ?
  `).get(Number(req.params.id));

  if (!match) return res.status(404).json({ error: 'Match not found.' });

  const isP1 = playerId === match.player1_id;
  const isP2 = playerId === match.player2_id;
  if (!isP1 && !isP2) return res.status(403).json({ error: 'You are not a player in this match.' });

  const sender   = isP1 ? { name: match.p1_name, email: match.p1_email } : { name: match.p2_name, email: match.p2_email };
  const opponent = isP1 ? { name: match.p2_name, email: match.p2_email } : { name: match.p1_name, email: match.p1_email };

  if (!sender.email)   return res.status(400).json({ error: 'Your account does not have an email on file. Contact your administrator.' });
  if (!opponent.email) return res.status(400).json({ error: 'Your opponent does not have an email address on file.' });

  const htmlMessage = message.trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const result = await sendEmail({
    reply_to: sender.email,
    to: [opponent.email],
    subject: `Message from ${sender.name} via Play WSRC`,
    html: `<p>Hi ${opponent.name},</p>
<p>${sender.name} sent you a message through Play WSRC:</p>
<blockquote style="border-left:3px solid #dce3ed;margin:12px 0;padding:8px 16px;color:#444">${htmlMessage}</blockquote>
<p style="color:#6b7e93;font-size:12px">Reply to this email to respond directly to ${sender.name}. This message was sent through Play WSRC.</p>`,
  });

  if (!result.ok) return res.status(502).json({ error: result.error });

  res.json({ ok: true });
}));

module.exports = router;
