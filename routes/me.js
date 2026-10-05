const express = require('express');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { getDB } = require('../database/db');
const { wrap } = require('../middleware');
const { sendEmail, isConfigured: emailConfigured, appUrl, emailChangeConfirmEmail } = require('../lib/email');
const { sendPasswordReset } = require('../lib/passwordReset');
const playerModel = require('../models/playerModel');

// A member's own Settings: profile, sign-in email, password reset and which
// emails they want. Every route reads and writes only the session's own
// player row.
const router = express.Router();

// The email preferences, in the order the Settings page lists them.
const NOTIFY_KEYS = ['notify_booking_added', 'notify_league_new', 'notify_tournament_new', 'notify_event_new', 'notify_score_reported'];

const EMAIL_CHANGE_HOURS = 24;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Links sent from Settings, counted per member rather than per address so a
// club on one wifi network does not share the allowance.
const settingsEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `player:${req.session.playerId}`,
  message: { error: 'Too many requests. Please try again later.' },
});

// Members only, and never through "View as": an admin looking through a
// member's eyes must not change their email or ask for their password.
function requireSelf(req, res, next) {
  if (req.session?.role !== 'player' || !req.session.playerId) return res.status(403).json({ error: 'Members only.' });
  if (req.method !== 'GET' && req.session.viewingAs) {
    return res.status(403).json({ error: 'You are viewing as this member. Settings can only be changed by the member.' });
  }
  next();
}

function _fieldError(res, field, error) {
  return res.status(400).json({ error, field });
}

function _pending(playerId) {
  return getDB().prepare('SELECT new_email, token, expires_at FROM email_changes WHERE player_id = ?').get(playerId) || null;
}

function _settings(playerId) {
  const db = getDB();
  const p = db.prepare(`SELECT id, name, email, phone, member_number, is_member, photo_path, ${NOTIFY_KEYS.join(', ')}
    FROM players WHERE id = ?`).get(playerId);
  if (!p) return null;
  const pending = _pending(playerId);
  const notifications = {};
  for (const k of NOTIFY_KEYS) notifications[k] = !!p[k];
  return {
    id: p.id, name: p.name, email: p.email || null, phone: p.phone || '',
    member_number: p.member_number || null, is_member: !!p.is_member, photo_path: p.photo_path || null,
    pending_email: pending && new Date(pending.expires_at) > new Date() ? pending.new_email : null,
    notifications,
  };
}

// A phone number is optional; when given it needs 7 to 15 digits and only
// the usual separators.
function _phoneLooksRight(phone) {
  if (!/^[0-9+().\-\s]*(\s*(x|ext\.?)\s*\d+)?$/i.test(phone)) return false;
  const digits = phone.replace(/(x|ext\.?)\s*\d+$/i, '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

async function _sendConfirm(req, player, newEmail) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + EMAIL_CHANGE_HOURS * 60 * 60 * 1000).toISOString();
  getDB().prepare(`INSERT INTO email_changes (player_id, new_email, token, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (player_id) DO UPDATE SET new_email = excluded.new_email, token = excluded.token,
      expires_at = excluded.expires_at, created_at = CURRENT_TIMESTAMP`).run(player.id, newEmail, token, expires);
  const url = `${appUrl(req)}/confirm-email/${token}`;
  if (!emailConfigured()) return { ok: true, emailSent: false };
  const result = await sendEmail({ to: newEmail, ...emailChangeConfirmEmail({ name: player.name, newEmail, url }) });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, emailSent: true };
}

router.use('/me', requireSelf);

router.get('/me/settings', (req, res) => {
  const settings = _settings(req.session.playerId);
  if (!settings) return res.status(404).json({ error: 'Player not found' });
  res.json(settings);
});

router.put('/me/profile', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const phone = String(req.body?.phone ?? '').trim();
  if (!name) return _fieldError(res, 'name', 'Name is required.');
  if (name.length > 80) return _fieldError(res, 'name', 'That name is too long.');
  if (phone && !_phoneLooksRight(phone)) return _fieldError(res, 'phone', 'That phone number does not look right.');
  playerModel.updatePlayer({ id: req.session.playerId, name, phone });
  res.json(_settings(req.session.playerId));
});

router.put('/me/notifications', (req, res) => {
  const { key, value } = req.body || {};
  if (!NOTIFY_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown setting.' });
  const db = getDB();
  const player = db.prepare('SELECT email FROM players WHERE id = ?').get(req.session.playerId);
  if (!player?.email) return res.status(400).json({ error: 'Add an email first.' });
  // `key` is one of NOTIFY_KEYS, never the client's own text.
  db.prepare(`UPDATE players SET ${key} = ? WHERE id = ?`).run(value ? 1 : 0, req.session.playerId);
  res.json({ key, value: !!value });
});

router.post('/me/email', settingsEmailLimiter, wrap(async (req, res) => {
  const email = String(req.body?.email ?? '').trim();
  if (!email) return _fieldError(res, 'email', 'Enter an email address.');
  if (email.length > 254 || !EMAIL_RE.test(email)) return _fieldError(res, 'email', 'That does not look like an email address.');
  const db = getDB();
  const player = db.prepare('SELECT id, name, email FROM players WHERE id = ?').get(req.session.playerId);
  if (player.email && player.email.toLowerCase() === email.toLowerCase()) return _fieldError(res, 'email', 'That is already your email.');
  const taken = db.prepare('SELECT 1 FROM players WHERE LOWER(email) = LOWER(?) AND id != ?').get(email, player.id);
  if (taken) return _fieldError(res, 'email', 'That email is already used by another member.');

  const result = await _sendConfirm(req, player, email);
  if (!result.ok) return res.status(502).json({ error: result.error });
  res.json({ ..._settings(player.id), emailSent: result.emailSent });
}));

router.post('/me/email/resend', settingsEmailLimiter, wrap(async (req, res) => {
  const pending = _pending(req.session.playerId);
  if (!pending) return res.status(400).json({ error: 'There is no email change waiting.' });
  const player = getDB().prepare('SELECT id, name FROM players WHERE id = ?').get(req.session.playerId);
  const result = await _sendConfirm(req, player, pending.new_email);
  if (!result.ok) return res.status(502).json({ error: result.error });
  res.json({ ..._settings(player.id), emailSent: result.emailSent });
}));

router.delete('/me/email', (req, res) => {
  getDB().prepare('DELETE FROM email_changes WHERE player_id = ?').run(req.session.playerId);
  res.json(_settings(req.session.playerId));
});

router.post('/me/password-reset', settingsEmailLimiter, wrap(async (req, res) => {
  const db = getDB();
  const player = db.prepare('SELECT id, name, email FROM players WHERE id = ?').get(req.session.playerId);
  if (!player.email) return res.status(400).json({ error: 'Add an email first.' });
  const account = db.prepare('SELECT password_hash FROM user_accounts WHERE player_id = ?').get(player.id);
  if (!account?.password_hash) return res.status(400).json({ error: 'Your account is not activated yet.' });
  const result = await sendPasswordReset(req, player);
  if (result.error) return res.status(502).json({ error: result.error });
  res.json({ ok: true, emailSent: result.emailSent });
}));

module.exports = router;
module.exports.NOTIFY_KEYS = NOTIFY_KEYS;
