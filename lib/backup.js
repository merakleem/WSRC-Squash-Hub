// ===== BACKUPS =====
// The whole club's history is one SQLite file on one volume. Every night this
// writes a consistent copy of it beside the database (VACUUM INTO reads a
// snapshot even while members are booking), checks the copy opens and passes
// an integrity check, keeps the newest few, and - when a bucket is configured -
// gzips it to S3-compatible storage so a lost volume is not a lost club.
//
// Nothing here is on the request path. A backup that fails is logged and
// reported on /health; it never takes the app down.
//
// Configuration (all optional):
//   BACKUP_DIR        where copies go; default <db dir>/backups
//   BACKUP_KEEP       how many local copies to keep; default 14
//   BACKUP_TIME       club-time HH:MM to run; default 03:30
//   BACKUP_S3_BUCKET  set to upload each copy; also needs AWS_ACCESS_KEY_ID and
//                     AWS_SECRET_ACCESS_KEY. BACKUP_S3_ENDPOINT for R2/B2/MinIO,
//                     BACKUP_S3_REGION (default auto), BACKUP_S3_PREFIX (default backups/)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');
const { getDB, getDBPath } = require('../database/db');
const { clubNow } = require('./clock');
const log = require('./log');
const errors = require('./errors');

const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
const RUN_AT = /^\d\d:\d\d$/.test(process.env.BACKUP_TIME || '') ? process.env.BACKUP_TIME : '03:30';
const FILE_RE = /^squash-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})Z\.db$/;

let lastBackup = null;   // { at, file, bytes, ok, uploaded, error }
let timer = null;
let running = null;      // promise while a backup is in progress

function backupDir() {
  return process.env.BACKUP_DIR || path.join(path.dirname(getDBPath()), 'backups');
}

function _stamp(d = new Date()) {
  return d.toISOString().slice(0, 19).replace(/:/g, '-');
}

/** Local copies, newest first. */
function listBackups() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, bytes: st.size, at: f.match(FILE_RE)[1].replace(/-(\d\d)-(\d\d)$/, ':$1:$2') + 'Z' };
    })
    .sort((a, b) => (a.file < b.file ? 1 : -1));
}

function _verify(file) {
  const copy = new Database(file, { readonly: true });
  try {
    const result = copy.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`integrity_check: ${result}`);
    // A copy with no tables is not a backup of anything.
    const tables = copy.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get().n;
    if (tables === 0) throw new Error('the copy has no tables');
  } finally {
    copy.close();
  }
}

function _prune() {
  const extra = listBackups().slice(KEEP);
  for (const b of extra) {
    try { fs.unlinkSync(path.join(backupDir(), b.file)); } catch (_) { /* gone already */ }
  }
  return extra.length;
}

function s3Configured() {
  return !!process.env.BACKUP_S3_BUCKET;
}

async function _upload(file, name) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: process.env.BACKUP_S3_REGION || 'auto',
    endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.BACKUP_S3_ENDPOINT,
  });
  const prefix = process.env.BACKUP_S3_PREFIX ?? 'backups/';
  const key = `${prefix}${name}.gz`;
  const body = zlib.gzipSync(fs.readFileSync(file));
  await client.send(new PutObjectCommand({
    Bucket: process.env.BACKUP_S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/gzip',
    ContentEncoding: 'gzip',
  }));
  return { key, bytes: body.length };
}

/**
 * Take a backup now. Resolves to the record (never throws); the record's `ok`
 * says whether the local copy is good and `uploaded` whether it reached the
 * bucket. Concurrent calls share one run.
 */
function runBackup({ reason = 'scheduled' } = {}) {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    const name = `squash-${_stamp()}Z.db`;
    const dir = backupDir();
    const file = path.join(dir, name);
    const record = { at: new Date().toISOString(), file: name, bytes: 0, ok: false, uploaded: false, error: null, reason };
    try {
      fs.mkdirSync(dir, { recursive: true });
      const db = getDB();
      // VACUUM INTO refuses an existing target and cannot run in a transaction.
      if (fs.existsSync(file)) fs.unlinkSync(file);
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      _verify(file);
      record.bytes = fs.statSync(file).size;
      record.ok = true;
      // The copy is safe; fold the WAL back into the main file so a raw file
      // download (railway service files download) is complete too.
      try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (_) { /* readers hold it; next time */ }
      const pruned = _prune();
      log.info({ file: name, bytes: record.bytes, pruned, ms: Date.now() - started, reason }, 'database backed up');
    } catch (err) {
      record.error = err.message;
      errors.capture(err, { job: 'backup', file: name }, 'database backup failed');
      try { fs.unlinkSync(file); } catch (_) { /* nothing written */ }
    }
    if (record.ok && s3Configured()) {
      try {
        const up = await _upload(file, name);
        record.uploaded = true;
        log.info({ key: up.key, bytes: up.bytes, bucket: process.env.BACKUP_S3_BUCKET }, 'backup uploaded');
      } catch (err) {
        record.error = `upload: ${err.message}`;
        errors.capture(err, { job: 'backup-upload', file: name }, 'backup upload failed');
      }
    }
    lastBackup = record;
    return record;
  })().finally(() => { running = null; });
  return running;
}

/** Milliseconds until the next occurrence of HH:MM on the club's clock. */
function msUntil(hhmm, now = new Date()) {
  const [h, m] = hhmm.split(':').map(Number);
  const { time } = clubNow(now);
  const [ch, cm] = time.split(':').map(Number);
  let delta = (h * 60 + m) - (ch * 60 + cm);
  if (delta <= 0) delta += 24 * 60;
  return delta * 60 * 1000 - now.getSeconds() * 1000;
}

function _scheduleNext() {
  const wait = msUntil(RUN_AT);
  timer = setTimeout(async () => {
    await runBackup({ reason: 'nightly' });
    _scheduleNext();
  }, wait);
  timer.unref();
  return wait;
}

/**
 * Start the nightly job. Also takes a backup shortly after boot when the
 * newest copy is more than a day old (or there is none), so a fresh deploy
 * never goes a night without one.
 */
function startBackups() {
  const newest = listBackups()[0];
  const stale = !newest || Date.now() - Date.parse(newest.at) > 24 * 60 * 60 * 1000;
  if (stale) {
    const t = setTimeout(() => runBackup({ reason: newest ? 'stale' : 'first' }), 30 * 1000);
    t.unref();
  }
  const wait = _scheduleNext();
  log.info({ dir: backupDir(), at: RUN_AT, keep: KEEP, upload: s3Configured(), next_in_min: Math.round(wait / 60000) }, 'nightly backups scheduled');
}

function stopBackups() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function status() {
  const newest = listBackups()[0] || null;
  return {
    last: lastBackup,
    newest_file: newest,
    dir: backupDir(),
    upload: s3Configured(),
  };
}

module.exports = { runBackup, startBackups, stopBackups, listBackups, backupDir, status, msUntil, _upload };
