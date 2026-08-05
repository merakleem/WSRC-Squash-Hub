const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Profile photos live next to the database so they land on the same Railway
// volume; anything written elsewhere in the container is lost on redeploy.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'squash.db');
const AVATAR_DIR = process.env.AVATAR_DIR || path.join(path.dirname(DB_PATH), 'avatars');

// Served under three path segments on purpose: routes/public.js has an
// unauthenticated `/:slug/:token` catch-all that swallows any two-segment path
// whose second segment is 4 hex characters.
const AVATAR_URL_BASE = '/uploads/avatars';

const MAX_BYTES = 5 * 1024 * 1024;
const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function ensureDir() {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

/**
 * Decode a browser `data:` URL into bytes.
 * Throws with a user-facing message when the payload is unusable.
 */
function _decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!match) throw new Error('Expected a base64 image data URL.');

  const [, mime, b64] = match;
  const ext = EXT_BY_MIME[mime.toLowerCase()];
  if (!ext) throw new Error('Unsupported image type. Use JPEG, PNG, WebP or GIF.');

  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) throw new Error('Image data was empty.');
  if (buffer.length > MAX_BYTES) throw new Error('Image is too large. Maximum size is 5 MB.');

  return { buffer, ext };
}

/**
 * Write a player's photo and return the public path to store on the row.
 *
 * The filename carries a content hash so replacing a photo produces a new URL;
 * without it, browsers keep showing the old image from cache.
 */
function savePlayerPhoto(playerId, dataUrl) {
  const { buffer, ext } = _decodeDataUrl(dataUrl);
  ensureDir();

  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 8);
  const filename = `${playerId}-${hash}.${ext}`;
  fs.writeFileSync(path.join(AVATAR_DIR, filename), buffer);

  return `${AVATAR_URL_BASE}/${filename}`;
}

/**
 * Remove a stored photo. Safe to call with null, a missing file, or a path from
 * a previous deploy; deleting an avatar must never break the request.
 */
function deletePlayerPhoto(photoPath) {
  if (!photoPath) return;
  const filename = path.basename(photoPath);
  // Guard against a traversal attempt reaching outside the avatar directory.
  if (filename !== photoPath.replace(`${AVATAR_URL_BASE}/`, '')) return;
  try {
    fs.unlinkSync(path.join(AVATAR_DIR, filename));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[photos] could not delete', filename, err.message);
  }
}

module.exports = { savePlayerPhoto, deletePlayerPhoto, ensureDir, AVATAR_DIR, AVATAR_URL_BASE };
