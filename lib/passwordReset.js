const crypto = require('crypto');
const { getDB } = require('../database/db');
const { sendEmail, isConfigured, appUrl, passwordResetEmail } = require('./email');

// A fresh 24-hour reset link for a player with an activated account, emailed
// when email is set up. Used by an admin from the players page and by a
// member from their own Settings. Any earlier link stops working.
// Resolves to { emailSent, resetUrl } or { error, resetUrl }.
async function sendPasswordReset(req, player) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  getDB().prepare('UPDATE user_accounts SET reset_token = ?, reset_expires = ? WHERE player_id = ?').run(token, expires, player.id);

  const resetUrl = `${appUrl(req)}/reset-password/${token}`;
  if (!isConfigured() || !player.email) return { emailSent: false, resetUrl };
  const result = await sendEmail({ to: player.email, ...passwordResetEmail({ name: player.name, url: resetUrl }) });
  if (!result.ok) return { error: result.error, resetUrl };
  return { emailSent: true, resetUrl };
}

module.exports = { sendPasswordReset };
