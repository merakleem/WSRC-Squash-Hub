const express = require('express');
const crypto = require('crypto');
const { getDB } = require('../database/db');
const { wrap, requireAdmin, requireAuth, emailLimiter } = require('../middleware');
const { sendEmail, isConfigured: emailConfigured, appUrl } = require('../lib/email');
const playerService = require('../services/playerService');
const playerModel = require('../models/playerModel');
const seasonModel = require('../models/seasonModel');
const ladderModel = require('../models/ladderModel');
const { savePlayerPhoto, deletePlayerPhoto } = require('../lib/photos');
const tournamentModel = require('../models/tournamentModel');
const { buildTournamentTiers } = require('../utils/tournamentHelpers');

const router = express.Router();

function _stripContact(player) {
  const { email, phone, member_number, ...rest } = player;
  return rest;
}

router.get('/players', wrap(async (req, res) => {
  const players = await playerService.getAllPlayers();
  const isAdmin = req.session?.role === 'admin';
  res.json(isAdmin ? players : players.map(_stripContact));
}));

// /records and /verified-count must be registered before /:id to avoid Express matching them as an id
router.get('/players/verified-count', requireAdmin, wrap(async (req, res) => {
  const db = getDB();
  const row = db.prepare('SELECT COUNT(*) AS count FROM user_accounts WHERE password_hash IS NOT NULL').get();
  res.json({ count: row.count });
}));

router.get('/players/records', wrap(async (req, res) => {
  const rows = await playerService.getAllPlayerRecords();
  const map = {};
  rows.forEach((r) => { map[r.id] = { wins: r.wins || 0, losses: r.losses || 0 }; });
  res.json(map);
}));

router.get('/players/:id/history', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [player, leagueHistory, leagueUpcoming, records] = await Promise.all([
    playerService.getPlayerById(id),
    playerService.getPlayerMatchHistory(id),
    playerService.getPlayerUpcomingMatches(id),
    playerService.getAllPlayerRecords(),
  ]);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const rec = records.find((r) => r.id === id) || { wins: 0, losses: 0 };
  const db = getDB();
  const account = db.prepare('SELECT password_hash FROM user_accounts WHERE player_id = ?').get(id);
  const accountStatus = account?.password_hash ? 'verified' : (account ? 'pending' : 'none');

  const tournHistory = tournamentModel.getPlayerTournamentHistory(id);
  const tournUpcoming = tournamentModel.getPlayerTournamentUpcoming(id);

  const pickupHistory = playerService.getPickupMatchHistory(id);

  // Rating movement per match, present only for matches in a rated season.
  const ratingDeltas = ladderModel.getPlayerMatchRatingDeltas(id);
  const withDelta = (m) => {
    // Tournament rows carry a prefixed id ("t_12") to keep them unique in the
    // merged list; the delta map is keyed on the raw table id.
    const rawId = m.source === 'tournament' ? String(m.id).replace(/^t_/, '') : m.id;
    const delta = ratingDeltas[`${m.source}:${rawId}`];
    return delta === undefined ? m : { ...m, rating_change: delta };
  };

  const history = [
    ...leagueHistory.map((m) => ({ ...m, source: 'league' })),
    ...tournHistory,
    ...pickupHistory,
  ].map(withDelta).sort((a, b) => (b.week_date || '').localeCompare(a.week_date || ''));
  const upcoming = [...leagueUpcoming.map((m) => ({ ...m, source: 'league' })), ...tournUpcoming]
    .sort((a, b) => (a.week_date || '').localeCompare(b.week_date || ''));

  // Tournament results: one entry per tournament, with the player's finishing position
  const playerTournaments = db.prepare(`
    SELECT DISTINCT t.id, t.name, t.championship_date, t.status, t.season_id
    FROM tournaments t
    WHERE t.id IN (
      SELECT tournament_id FROM tournament_players WHERE player_id = ?
      UNION
      SELECT tournament_id FROM tournament_matches WHERE player1_id = ? OR player2_id = ?
    )
    ORDER BY t.championship_date DESC
  `).all(id, id, id);

  const tournamentResults = [];
  for (const tourn of playerTournaments) {
    const full = await tournamentModel.getTournament(tourn.id);
    if (!full) continue;
    const tiers = buildTournamentTiers(full);
    const tier = tiers.find((tr) => tr.players.some((p) => p.id === id));
    tournamentResults.push({
      tournament_id: tourn.id,
      name: tourn.name,
      championship_date: tourn.championship_date,
      status: tourn.status,
      season_id: tourn.season_id,
      position: tier ? tier.position : null,
    });
  }

  const isAdmin = req.session?.role === 'admin';
  const playerData = isAdmin ? player : _stripContact(player);
  // Seasons ship with the profile so the tab bar can be built without a second
  // round trip; per-season records are derived client-side from history rows,
  // which already carry season_id.
  const seasons = seasonModel.getAllSeasons();
  const ladderStats = ladderModel.getPlayerLadderStats(id);

  // Division comes from the most recent league the player was entered in; the
  // profile header shows it as part of their identity.
  const division = db.prepare(`
    SELECT d.name
    FROM league_players lp
    JOIN divisions d ON d.id = lp.division_id
    JOIN leagues l ON l.id = lp.league_id
    WHERE lp.player_id = ?
    ORDER BY l.start_date DESC
    LIMIT 1
  `).get(id);

  res.json({
    ...playerData,
    wins: rec.wins || 0, losses: rec.losses || 0,
    history, upcoming, accountStatus, tournamentResults, seasons,
    ladder: ladderStats,
    ladder_history: ladderModel.getPlayerLadderHistory(id),
    division_name: division?.name || null,
  });
}));

router.post('/players', requireAdmin, wrap(async (req, res) => {
  const player = await playerService.addPlayer(req.body);
  res.json(player);
}));

router.put('/players/:id', requireAdmin, wrap(async (req, res) => {
  const player = await playerService.updatePlayer({ ...req.body, id: Number(req.params.id) });
  res.json(player);
}));

router.delete('/players/:id', requireAdmin, wrap(async (req, res) => {
  await playerService.deletePlayer(Number(req.params.id));
  res.json({ ok: true });
}));

router.post('/players/:id/send-invite', requireAdmin, emailLimiter, wrap(async (req, res) => {
  const playerId = Number(req.params.id);
  const db = getDB();
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  db.prepare(`INSERT INTO user_accounts (player_id, invite_token, invite_expires)
    VALUES (?, ?, ?)
    ON CONFLICT (player_id) DO UPDATE SET invite_token = excluded.invite_token, invite_expires = excluded.invite_expires`
  ).run(playerId, token, expires);

  const inviteUrl = `${appUrl(req)}/invite/${token}`;

  if (emailConfigured() && player.email) {
    const result = await sendEmail({
      to: player.email,
      subject: 'Activate your Play WSRC account',
      html: `<p>Hi ${player.name},</p>
<p>You've been invited to create an account on Play WSRC.</p>
<p><a href="${inviteUrl}">Click here to activate your account</a></p>
<p>This link expires in 72 hours.</p>`,
    });
    if (!result.ok) return res.status(502).json({ error: result.error, inviteUrl });
    return res.json({ ok: true, emailSent: true, inviteUrl });
  }

  res.json({ ok: true, emailSent: false, inviteUrl });
}));

router.post('/players/:id/send-reset', requireAdmin, emailLimiter, wrap(async (req, res) => {
  const playerId = Number(req.params.id);
  const db = getDB();
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const account = db.prepare('SELECT * FROM user_accounts WHERE player_id = ?').get(playerId);
  if (!account || !account.password_hash) return res.status(400).json({ error: 'This player has not activated their account yet. Send an invite instead.' });

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare('UPDATE user_accounts SET reset_token = ?, reset_expires = ? WHERE player_id = ?').run(token, expires, playerId);

  const resetUrl = `${appUrl(req)}/reset-password/${token}`;

  if (emailConfigured() && player.email) {
    const result = await sendEmail({
      to: player.email,
      subject: 'Reset your Play WSRC password',
      html: `<p>Hi ${player.name},</p>
<p>A password reset was requested for your Play WSRC account.</p>
<p><a href="${resetUrl}">Click here to reset your password</a></p>
<p>This link expires in 24 hours. If you did not request this, you can ignore this email.</p>`,
    });
    if (!result.ok) return res.status(502).json({ error: result.error, resetUrl });
    return res.json({ ok: true, emailSent: true, resetUrl });
  }

  res.json({ ok: true, emailSent: false, resetUrl });
}));

router.post('/players/:id/message', requireAuth, emailLimiter, wrap(async (req, res) => {
  const senderId = req.session.playerId;
  if (!senderId) return res.status(403).json({ error: 'Admin accounts cannot use this feature.' });

  const recipientId = Number(req.params.id);
  if (senderId === recipientId) return res.status(400).json({ error: 'You cannot message yourself.' });

  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required.' });

  if (!emailConfigured()) return res.status(500).json({ error: 'Email service is not configured.' });

  const db = getDB();
  const sender    = db.prepare('SELECT name, email FROM players WHERE id = ?').get(senderId);
  const recipient = db.prepare('SELECT name, email FROM players WHERE id = ?').get(recipientId);

  if (!sender)    return res.status(404).json({ error: 'Sender not found.' });
  if (!recipient) return res.status(404).json({ error: 'Player not found.' });
  if (!sender.email)    return res.status(400).json({ error: 'Your account does not have an email on file. Contact your administrator.' });
  if (!recipient.email) return res.status(400).json({ error: 'This player does not have an email address on file.' });

  const htmlMessage = message.trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const result = await sendEmail({
    reply_to: sender.email,
    to: [recipient.email],
    subject: `Message from ${sender.name} via Play WSRC`,
    html: `<p>Hi ${recipient.name},</p>
<p>${sender.name} sent you a message through Play WSRC:</p>
<blockquote style="border-left:3px solid #dce3ed;margin:12px 0;padding:8px 16px;color:#444">${htmlMessage}</blockquote>
<p style="color:#6b7e93;font-size:12px">Reply to this email to respond directly to ${sender.name}. This message was sent through Play WSRC.</p>`,
  });

  if (!result.ok) return res.status(502).json({ error: result.error });

  res.json({ ok: true });
}));

// ===== PROFILE PHOTOS =====
// A player may set their own photo; an admin may set anyone's.
function _canEditPhoto(req, playerId) {
  return req.session?.role === 'admin' || req.session?.playerId === playerId;
}

router.put('/players/:id/photo', requireAuth, wrap(async (req, res) => {
  const playerId = Number(req.params.id);
  if (!_canEditPhoto(req, playerId)) return res.status(403).json({ error: 'You can only change your own photo.' });

  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'No image supplied.' });

  const player = await playerService.getPlayerById(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  let photoPath;
  try {
    photoPath = savePlayerPhoto(playerId, image);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Only remove the previous file once the new one is safely written.
  const previous = player.photo_path;
  const updated = await playerModel.setPlayerPhoto(playerId, photoPath);
  if (previous && previous !== photoPath) deletePlayerPhoto(previous);

  res.json({ ok: true, photo_path: updated.photo_path });
}));

router.delete('/players/:id/photo', requireAuth, wrap(async (req, res) => {
  const playerId = Number(req.params.id);
  if (!_canEditPhoto(req, playerId)) return res.status(403).json({ error: 'You can only change your own photo.' });

  const player = await playerService.getPlayerById(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  await playerModel.setPlayerPhoto(playerId, null);
  deletePlayerPhoto(player.photo_path);

  res.json({ ok: true, photo_path: null });
}));

module.exports = router;
