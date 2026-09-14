const express = require('express');
const path = require('path');
const { wrap, requireAdmin } = require('../middleware');
const backup = require('../lib/backup');

const router = express.Router();

// ===== BACKUPS (admin) =====
// The nightly job writes copies beside the database (lib/backup.js). These
// routes let the admin see them, take one now, and pull one off the volume
// from the browser or curl - the off-site copy that needs no bucket:
//
//   curl -b cookies -o wsrc.db https://playwsrc.ca/api/backups/latest

router.get('/backups', requireAdmin, wrap(async (req, res) => {
  res.json({ ...backup.status(), backups: backup.listBackups() });
}));

router.post('/backups', requireAdmin, wrap(async (req, res) => {
  const record = await backup.runBackup({ reason: 'manual' });
  res.status(record.ok ? 200 : 500).json(record);
}));

function _send(res, entry) {
  if (!entry) return res.status(404).json({ error: 'No backup yet.' });
  res.download(path.join(backup.backupDir(), entry.file), entry.file);
}

router.get('/backups/latest', requireAdmin, wrap(async (req, res) => {
  _send(res, backup.listBackups()[0]);
}));

// Only a name the listing knows is ever opened: no path can be built from it.
router.get('/backups/:file', requireAdmin, wrap(async (req, res) => {
  _send(res, backup.listBackups().find((b) => b.file === req.params.file));
}));

module.exports = router;
