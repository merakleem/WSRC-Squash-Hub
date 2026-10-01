// Emailing a group of players - a league's or a tournament's - and sending
// account invites to the ones without an account. One implementation, so the
// two competitions can never treat players differently.
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const { getDB } = require('../database/db');
const { sendBatch, sendMany, inviteEmail, appUrl } = require('./email');

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

/**
 * Send one message to every player with an email. `players` are
 * `{ player_email }`; anyone without one is skipped. Returns `{ sent, failed }`.
 */
async function messagePlayers(players, { subject, body, bodyHtml, attachments }) {
  const recipients = players.filter((p) => p.player_email);
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const html = bodyHtml
    ? sanitizeMessageHtml(bodyHtml)
    : `<p>${String(body)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')}</p>`;

  // Only the two fields Resend reads; anything else the client sent is dropped.
  const files = (Array.isArray(attachments) ? attachments : [])
    .filter((a) => a && typeof a.filename === 'string' && typeof a.content === 'string')
    .map((a) => ({ filename: a.filename, content: a.content }));

  return sendMany(recipients.map((player) => ({
    to: [player.player_email],
    subject,
    html,
    ...(body ? { text: body } : {}),
    ...(files.length ? { attachments: files } : {}),
  })));
}

/**
 * Invite every player who has an email but no account yet. `players` are
 * `{ player_id, player_name, player_email }`. Returns `{ sent, failed }`.
 */
async function invitePlayers(req, players) {
  const db = getDB();
  const eligible = players.filter((p) => {
    if (!p.player_email) return false;
    const account = db.prepare('SELECT password_hash FROM user_accounts WHERE player_id = ?').get(p.player_id);
    return !account?.password_hash;
  });
  if (eligible.length === 0) return { sent: 0, failed: 0 };

  const baseUrl = appUrl(req);
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const batch = eligible.map((p) => {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(`
      INSERT INTO user_accounts (player_id, invite_token, invite_expires)
      VALUES (?, ?, ?)
      ON CONFLICT (player_id) DO UPDATE SET invite_token = excluded.invite_token, invite_expires = excluded.invite_expires
    `).run(p.player_id, token, expires);
    return { to: [p.player_email], ...inviteEmail(p.player_name, `${baseUrl}/invite/${token}`) };
  });
  return sendBatch(batch);
}

module.exports = { sanitizeMessageHtml, messagePlayers, invitePlayers };
