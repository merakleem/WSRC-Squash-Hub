// Staff accounts: who they are, what they may do, and the pieces of signing
// in that are theirs alone (invite and reset links, two-step sign-in, backup
// codes). The admin account (blank email and the club password) is not a row
// here; it may do everything, and only it manages staff.
//
// Nothing here is home-made cryptography: passwords and backup codes are
// bcrypt, link tokens are random bytes stored as SHA-256 hashes, and the
// authenticator codes are standard TOTP checked by the otpauth library.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const OTPAuth = require('otpauth');
const QRCode = require('qrcode');
const { getDB } = require('../database/db');

/** The permissions, in the order the editor lists them. */
const PERMISSIONS = [
  { key: 'players', name: 'Players and accounts', desc: 'Add and edit players, membership, account invites, password resets, and "View as" a member.' },
  { key: 'leagues', name: 'Leagues', desc: 'Create, edit and run leagues.' },
  { key: 'tournaments', name: 'Tournaments', desc: 'Create, edit and run tournaments.' },
  { key: 'events', name: 'Events', desc: 'Create and edit events and their signups.' },
  { key: 'schedule', name: 'Court schedule and bookings', desc: 'The admin court schedule and admin bookings.' },
  { key: 'scores', name: 'Scores', desc: 'Enter or correct any match result.' },
  { key: 'message', name: 'Message players', desc: 'Group emails and account invites to players.' },
  { key: 'ladder', name: 'Ladder and seasons', desc: 'Seasons, joining the ladder and winning margin: the game rules.' },
  { key: 'courts', name: 'Courts and booking types', desc: 'Courts and booking types.' },
  { key: 'club', name: 'Club settings', desc: 'Club-wide settings such as the time zone.' },
  { key: 'log', name: 'Activity log', desc: 'Read the activity log.' },
];
const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
/** Log areas: the permissions that change things, plus staff accounts. */
const AREA_NAMES = Object.fromEntries([...PERMISSIONS.filter((p) => p.key !== 'log').map((p) => [p.key, p.name]), ['staff', 'Staff accounts']]);

const INVITE_DAYS = 7;
const RESET_MINUTES = 60;
const EMAIL_CHANGE_MINUTES = 60;
const MAX_CODE_FAILURES = 5;
const LOCK_MINUTES = 15;
const BACKUP_CODE_COUNT = 10;

const now = () => new Date();
const iso = (d) => d.toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** A fresh link token: the raw value for the email, its hash for the database. */
function newToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: sha256(raw) };
}

function cleanPermissions(list) {
  const set = new Set(Array.isArray(list) ? list : []);
  return PERMISSION_KEYS.filter((k) => set.has(k));
}

function parsePermissions(row) {
  try { return cleanPermissions(JSON.parse(row?.permissions || '[]')); } catch { return []; }
}

function getById(id) {
  return getDB().prepare('SELECT * FROM staff_accounts WHERE id = ?').get(Number(id)) || null;
}

function getByEmail(email) {
  return getDB().prepare('SELECT * FROM staff_accounts WHERE email = ? COLLATE NOCASE').get(String(email || '').trim()) || null;
}

function byTokenHash(column, raw) {
  if (!raw) return null;
  return getDB().prepare(`SELECT * FROM staff_accounts WHERE ${column} = ?`).get(sha256(raw)) || null;
}

/** The staff member an invite link belongs to, while it still works. */
function byInviteToken(raw) {
  const s = byTokenHash('invite_token_hash', raw);
  return s && s.status === 'invited' && s.invite_expires && new Date(s.invite_expires) > now() ? s : null;
}

/** The staff member a reset link belongs to, while it still works. */
function byResetToken(raw) {
  const s = byTokenHash('reset_token_hash', raw);
  return s && s.status === 'active' && s.reset_expires && new Date(s.reset_expires) > now() ? s : null;
}

/** Why an email cannot be a staff account's, or '' if it can. */
function emailProblem(email, exceptStaffId = null) {
  const db = getDB();
  if (db.prepare('SELECT 1 FROM players WHERE LOWER(email) = LOWER(?)').get(email)) {
    return 'That email belongs to a player account. Staff accounts need a different one; a Gmail alias such as jordan+staff@gmail.com works.';
  }
  const other = db.prepare('SELECT id FROM staff_accounts WHERE email = ? COLLATE NOCASE').get(email);
  if (other && other.id !== exceptStaffId) return 'A staff account already uses this email.';
  return '';
}

// ===== TWO-STEP SIGN-IN =====

function _totp(secretBase32, label) {
  return new OTPAuth.TOTP({
    issuer: 'Play WSRC', label, algorithm: 'SHA1', digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** A new authenticator secret (or `existing`) and what the setup page shows for it. */
async function newTotpSetup(email, existing = null) {
  const secret = existing || new OTPAuth.Secret({ size: 20 }).base32;
  const uri = _totp(secret, email).toString();
  return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 0, width: 232 }), key: secret.match(/.{1,4}/g).join(' ') };
}

/**
 * Check a 6-digit code against a secret, one step either side. Returns the
 * time step it matched, or null. `lastStep` refuses a code already used.
 */
function checkTotp(secretBase32, email, code, lastStep = null) {
  const token = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(token)) return null;
  const totp = _totp(secretBase32, email);
  const delta = totp.validate({ token, window: 1 });
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 1000 / 30) + delta;
  if (lastStep != null && step <= lastStep) return null;
  return step;
}

/** Ten fresh backup codes, XXXX-XXXX, replacing any the person had. */
function newBackupCodes(staffId) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () => Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => { const c = pick(); return `${c.slice(0, 4)}-${c.slice(4)}`; });
  const db = getDB();
  db.transaction(() => {
    db.prepare('DELETE FROM staff_backup_codes WHERE staff_id = ?').run(staffId);
    const ins = db.prepare('INSERT INTO staff_backup_codes (staff_id, code_hash) VALUES (?, ?)');
    for (const c of codes) ins.run(staffId, bcrypt.hashSync(c, 10));
  })();
  return codes;
}

/** Use a backup code. True if it matched an unused one, which is now spent. */
function useBackupCode(staffId, code) {
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 8) return false;
  const formatted = `${clean.slice(0, 4)}-${clean.slice(4)}`;
  const db = getDB();
  const rows = db.prepare('SELECT id, code_hash FROM staff_backup_codes WHERE staff_id = ? AND used_at IS NULL').all(staffId);
  const hit = rows.find((r) => bcrypt.compareSync(formatted, r.code_hash));
  if (!hit) return false;
  db.prepare('UPDATE staff_backup_codes SET used_at = ? WHERE id = ?').run(iso(now()), hit.id);
  return true;
}

function backupCodesLeft(staffId) {
  return getDB().prepare('SELECT COUNT(*) AS n FROM staff_backup_codes WHERE staff_id = ? AND used_at IS NULL').get(staffId).n;
}

/** Whether repeated wrong codes have locked this person out for now. */
function isLocked(staff) {
  return !!(staff.two_step_locked_until && new Date(staff.two_step_locked_until) > now());
}

/** Count a wrong code. Returns the attempts left before the lock (0 = locked). */
function recordCodeFailure(staffId) {
  const db = getDB();
  const s = getById(staffId);
  const failures = (s.two_step_failures || 0) + 1;
  if (failures >= MAX_CODE_FAILURES) {
    db.prepare('UPDATE staff_accounts SET two_step_failures = 0, two_step_locked_until = ? WHERE id = ?')
      .run(iso(new Date(Date.now() + LOCK_MINUTES * 60000)), staffId);
    return 0;
  }
  db.prepare('UPDATE staff_accounts SET two_step_failures = ? WHERE id = ?').run(failures, staffId);
  return MAX_CODE_FAILURES - failures;
}

function clearCodeFailures(staffId) {
  getDB().prepare('UPDATE staff_accounts SET two_step_failures = 0, two_step_locked_until = NULL WHERE id = ?').run(staffId);
}

/** What a staff member's own session and app need to know about them. */
function publicView(s) {
  return {
    id: s.id, name: s.name, email: s.email, status: s.status,
    permissions: parsePermissions(s),
    require_two_step: !!s.require_two_step,
    two_step_on: !!s.totp_enabled_at,
    totp_enabled_at: s.totp_enabled_at || null,
    invited_at: s.invited_at || null,
    invite_expires: s.status === 'invited' ? s.invite_expires : null,
    last_signed_in_at: s.last_signed_in_at || null,
    password_changed_at: s.password_changed_at || null,
    disabled_at: s.disabled_at || null,
  };
}

module.exports = {
  PERMISSIONS, PERMISSION_KEYS, AREA_NAMES, INVITE_DAYS, RESET_MINUTES, EMAIL_CHANGE_MINUTES, MAX_CODE_FAILURES, LOCK_MINUTES,
  sha256, newToken, cleanPermissions, parsePermissions, getById, getByEmail, byInviteToken, byResetToken, emailProblem,
  newTotpSetup, checkTotp, newBackupCodes, useBackupCode, backupCodesLeft, isLocked, recordCodeFailure, clearCodeFailures,
  publicView,
};
