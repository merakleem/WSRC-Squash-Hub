const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../database/db');
const { wrap, requireAdmin, requirePerm, emailLimiter, setSessionCookie } = require('../middleware');
const { sendEmail, isConfigured: emailConfigured, appUrl, staffInviteEmail, staffResetEmail, staffEmailChangeEmail } = require('../lib/email');
const staff = require('../lib/staff');
const auditLog = require('../lib/audit');

// Staff accounts (managed by the admin account only), a staff member's own
// account, and the activity log.
const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fieldError = (res, field, error) => res.status(400).json({ error, field });
const later = (ms) => new Date(Date.now() + ms).toISOString();

function _sendInvite(req, s) {
  const { raw, hash } = staff.newToken();
  getDB().prepare('UPDATE staff_accounts SET invite_token_hash = ?, invite_expires = ?, invited_at = ? WHERE id = ?')
    .run(hash, later(staff.INVITE_DAYS * 86400000), new Date().toISOString(), s.id);
  if (!emailConfigured()) return Promise.resolve({ ok: true });
  return sendEmail({ to: s.email, ...staffInviteEmail({ name: s.name, url: `${appUrl(req)}/staff/invite/${raw}` }) });
}

function _view(id) {
  const s = staff.getById(id);
  return s ? { ...staff.publicView(s), backup_codes_left: staff.backupCodesLeft(s.id) } : null;
}

function _loadStaff(req, res, next) {
  const s = staff.getById(req.params.id);
  if (!s) return res.status(404).json({ error: 'Staff member not found.' });
  req.staffRow = s;
  next();
}

// ===== MANAGING STAFF (admin account only) =====

router.get('/staff', requireAdmin, (req, res) => {
  const rows = getDB().prepare('SELECT * FROM staff_accounts ORDER BY status = \'disabled\', name COLLATE NOCASE').all();
  res.json({ staff: rows.map((r) => staff.publicView(r)), permissions: staff.PERMISSIONS });
});

router.get('/staff/:id', requireAdmin, _loadStaff, (req, res) => {
  res.json({ staff: _view(req.staffRow.id), permissions: staff.PERMISSIONS });
});

router.post('/staff', requireAdmin, emailLimiter, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim();
  if (!name) return fieldError(res, 'name', 'Enter their name.');
  if (!email) return fieldError(res, 'email', 'Enter an email address.');
  if (!EMAIL_RE.test(email) || email.length > 254) return fieldError(res, 'email', 'That does not look like an email address.');
  const problem = staff.emailProblem(email);
  if (problem) return fieldError(res, 'email', problem);
  const perms = staff.cleanPermissions(req.body?.permissions);
  const id = Number(getDB().prepare(`INSERT INTO staff_accounts (name, email, permissions, require_two_step) VALUES (?, ?, ?, ?)`)
    .run(name, email, JSON.stringify(perms), req.body?.require_two_step ? 1 : 0).lastInsertRowid);
  const sent = await _sendInvite(req, staff.getById(id));
  auditLog.record({ area: 'staff', text: `invited ${name} as a staff member` });
  if (!sent.ok) return res.status(502).json({ error: "Couldn't send the invite. Try again.", staff: _view(id) });
  res.json({ staff: _view(id) });
}));

router.put('/staff/:id', requireAdmin, _loadStaff, (req, res) => {
  const s = req.staffRow;
  if (s.status === 'disabled') return res.status(409).json({ error: 'Enable the account to change it.' });
  const perms = staff.cleanPermissions(req.body?.permissions);
  const two = req.body?.require_two_step ? 1 : 0;
  getDB().prepare('UPDATE staff_accounts SET permissions = ?, require_two_step = ? WHERE id = ?').run(JSON.stringify(perms), two, s.id);
  const before = staff.parsePermissions(s);
  const changes = [];
  if (JSON.stringify(before) !== JSON.stringify(perms)) changes.push('permissions');
  if (!!s.require_two_step !== !!two) changes.push(two ? 'turned on required two-step sign-in' : 'turned off required two-step sign-in');
  if (changes.length) {
    const text = changes[0] === 'permissions'
      ? `changed the permissions of ${s.name}${changes[1] ? ` and ${changes[1]}` : ''}`
      : `${changes[0]} for ${s.name}`;
    auditLog.record({ area: 'staff', text });
  }
  res.json({ staff: _view(s.id) });
});

router.post('/staff/:id/resend-invite', requireAdmin, emailLimiter, _loadStaff, wrap(async (req, res) => {
  const s = req.staffRow;
  if (s.status !== 'invited') return res.status(409).json({ error: 'This person has already set up their account.' });
  const sent = await _sendInvite(req, s);
  if (!sent.ok) return res.status(502).json({ error: "Couldn't send the invite. Try again." });
  auditLog.record({ area: 'staff', text: `resent the staff invite to ${s.name}` });
  res.json({ staff: _view(s.id) });
}));

router.delete('/staff/:id', requireAdmin, _loadStaff, (req, res) => {
  const s = req.staffRow;
  if (s.status !== 'invited') return res.status(409).json({ error: 'Only an invite can be cancelled. Disable the account instead.' });
  getDB().prepare('DELETE FROM staff_accounts WHERE id = ?').run(s.id);
  auditLog.record({ area: 'staff', text: `cancelled the staff invite to ${s.name}` });
  res.json({ ok: true });
});

router.post('/staff/:id/disable', requireAdmin, _loadStaff, (req, res) => {
  const s = req.staffRow;
  if (s.status !== 'active') return res.status(409).json({ error: 'Only an active account can be disabled.' });
  // Raising session_version signs them out everywhere at once.
  getDB().prepare(`UPDATE staff_accounts SET status = 'disabled', disabled_at = ?, session_version = session_version + 1,
    reset_token_hash = NULL, reset_expires = NULL WHERE id = ?`).run(new Date().toISOString(), s.id);
  auditLog.record({ area: 'staff', text: `disabled the staff account of ${s.name}` });
  res.json({ staff: _view(s.id) });
});

router.post('/staff/:id/enable', requireAdmin, _loadStaff, (req, res) => {
  const s = req.staffRow;
  if (s.status !== 'disabled') return res.status(409).json({ error: 'This account is not disabled.' });
  getDB().prepare(`UPDATE staff_accounts SET status = 'active', disabled_at = NULL WHERE id = ?`).run(s.id);
  auditLog.record({ area: 'staff', text: `enabled the staff account of ${s.name}` });
  res.json({ staff: _view(s.id) });
});

router.post('/staff/:id/reset', requireAdmin, emailLimiter, _loadStaff, wrap(async (req, res) => {
  const s = req.staffRow;
  if (s.status !== 'active') return res.status(409).json({ error: 'Only an active account can be sent a password reset.' });
  const { raw, hash } = staff.newToken();
  getDB().prepare('UPDATE staff_accounts SET reset_token_hash = ?, reset_expires = ? WHERE id = ?')
    .run(hash, later(staff.RESET_MINUTES * 60000), s.id);
  if (emailConfigured()) {
    const sent = await sendEmail({ to: s.email, ...staffResetEmail({ url: `${appUrl(req)}/staff/reset/${raw}` }) });
    if (!sent.ok) return res.status(502).json({ error: "Couldn't send the password reset. Try again." });
  }
  auditLog.record({ area: 'staff', text: `sent a staff password reset to ${s.name}` });
  res.json({ ok: true });
}));

// ===== THE ACTIVITY LOG =====

router.get('/activity-log', requirePerm('log'), (req, res) => {
  const q = req.query;
  const iso = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : null);
  const area = staff.AREA_NAMES[q.area] ? q.area : null;
  res.json(auditLog.list({ person: q.person || null, area, from: iso(q.from), to: iso(q.to), before: q.before || null, limit: q.limit }));
});

router.get('/activity-log/filters', requirePerm('log'), (req, res) => {
  const people = getDB().prepare('SELECT id, name FROM staff_accounts WHERE status != \'invited\' ORDER BY name COLLATE NOCASE').all();
  res.json({
    people: [{ id: 'admin', name: 'Administrator' }, ...people],
    areas: Object.entries(staff.AREA_NAMES).map(([key, name]) => ({ key, name })),
  });
});

// ===== MY ACCOUNT (a staff member's own) =====

function requireStaffSelf(req, res, next) {
  if (req.session?.role !== 'staff') return res.status(403).json({ error: 'Staff accounts only.' });
  req.me = staff.getById(req.session.staffId);
  next();
}

function _account(id) {
  const v = _view(id);
  const pending = getDB().prepare('SELECT new_email, expires_at FROM staff_email_changes WHERE staff_id = ?').get(id);
  return { ...v, pending_email: pending && new Date(pending.expires_at) > new Date() ? pending.new_email : null };
}

router.get('/account', requireStaffSelf, (req, res) => res.json(_account(req.me.id)));

router.put('/account', requireStaffSelf, emailLimiter, wrap(async (req, res) => {
  const me = req.me;
  const name = String(req.body?.name ?? me.name).trim();
  const email = String(req.body?.email ?? me.email).trim();
  if (!name) return fieldError(res, 'name', 'Enter your name.');
  if (!email) return fieldError(res, 'email', 'Enter an email address.');
  if (!EMAIL_RE.test(email)) return fieldError(res, 'email', 'That does not look like an email address.');
  const db = getDB();
  if (name !== me.name) db.prepare('UPDATE staff_accounts SET name = ? WHERE id = ?').run(name, me.id);
  let emailSent = false;
  if (email.toLowerCase() !== me.email.toLowerCase()) {
    const problem = staff.emailProblem(email, me.id);
    if (problem) return fieldError(res, 'email', problem);
    const { raw, hash } = staff.newToken();
    db.prepare(`INSERT INTO staff_email_changes (staff_id, new_email, token_hash, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (staff_id) DO UPDATE SET new_email = excluded.new_email, token_hash = excluded.token_hash, expires_at = excluded.expires_at`)
      .run(me.id, email, hash, later(staff.EMAIL_CHANGE_MINUTES * 60000));
    if (emailConfigured()) {
      const sent = await sendEmail({ to: email, ...staffEmailChangeEmail({ newEmail: email, oldEmail: me.email, url: `${appUrl(req)}/staff/confirm-email/${raw}` }) });
      if (!sent.ok) return res.status(502).json({ error: "Couldn't send the confirmation link. Try again." });
    }
    emailSent = true;
  }
  res.json({ ..._account(me.id), emailSent });
}));

router.post('/account/password', requireStaffSelf, wrap(async (req, res) => {
  const me = req.me;
  const { current, password, confirm } = req.body || {};
  if (!(await bcrypt.compare(String(current || ''), me.password_hash || ''))) return fieldError(res, 'current', 'That is not your current password.');
  if (!password || String(password).length < 8) return fieldError(res, 'password', 'Password must be at least 8 characters.');
  if (password !== confirm) return fieldError(res, 'confirm', 'Passwords do not match.');
  const hash = await bcrypt.hash(String(password), 12);
  const db = getDB();
  db.prepare('UPDATE staff_accounts SET password_hash = ?, password_changed_at = ?, session_version = session_version + 1 WHERE id = ?')
    .run(hash, new Date().toISOString(), me.id);
  // Every other device is now signed out; this one gets a fresh session.
  setSessionCookie(res, { role: 'staff', staffId: me.id, sv: me.session_version + 1 });
  res.json({ ok: true });
}));

router.post('/account/sign-out-all', requireStaffSelf, (req, res) => {
  const me = req.me;
  getDB().prepare('UPDATE staff_accounts SET session_version = session_version + 1 WHERE id = ?').run(me.id);
  setSessionCookie(res, { role: 'staff', staffId: me.id, sv: me.session_version + 1 });
  res.json({ ok: true });
});

router.post('/account/backup-codes', requireStaffSelf, (req, res) => {
  if (!req.me.totp_enabled_at) return res.status(409).json({ error: 'Set up two-step sign-in first.' });
  res.json({ codes: staff.newBackupCodes(req.me.id) });
});

router.post('/account/two-step/off', requireStaffSelf, (req, res) => {
  if (req.me.require_two_step) return res.status(409).json({ error: 'Your account requires two-step sign-in.' });
  const db = getDB();
  db.prepare('UPDATE staff_accounts SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?').run(req.me.id);
  db.prepare('DELETE FROM staff_backup_codes WHERE staff_id = ?').run(req.me.id);
  res.json(_account(req.me.id));
});

module.exports = router;
