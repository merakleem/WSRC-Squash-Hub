// Nightly backups: a verified copy beside the database, the newest few kept,
// the schedule on the club's clock, and the upload to a bucket when one is
// configured (proved against a local stand-in for S3).
// Run: node --test test/backup.test.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { suite, scratchDb } = require('./lib/suite');

process.env.BACKUP_KEEP = '3';

suite('database backups', async ({ ok, t }) => {
  const dbm = require('../database/db');
  const file = scratchDb(t, 'backup');
  dbm.initDB(file);
  dbm.run("INSERT INTO players (name) VALUES ('Backed Up')");
  const backup = require('../lib/backup');

  console.log('A COPY BESIDE THE DATABASE');
  const first = await backup.runBackup({ reason: 'test' });
  ok('the backup succeeds', first.ok === true && first.error === null, JSON.stringify(first));
  ok('into a backups folder next to the database', backup.backupDir() === path.join(path.dirname(file), 'backups'));
  ok('named by the moment it was taken', /^squash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.db$/.test(first.file), first.file);
  const Database = require('better-sqlite3');
  const copy = new Database(path.join(backup.backupDir(), first.file), { readonly: true });
  ok('the copy is a complete database with the data in it', copy.prepare('SELECT name FROM players').get().name === 'Backed Up');
  ok('that passes an integrity check', copy.pragma('integrity_check', { simple: true }) === 'ok');
  copy.close();
  ok('the listing shows it, with size and time', backup.listBackups().length === 1 && backup.listBackups()[0].bytes === first.bytes && /Z$/.test(backup.listBackups()[0].at));
  ok('status reports it as the last backup', backup.status().last.file === first.file && backup.status().newest_file.file === first.file);

  console.log('ONLY THE NEWEST FEW ARE KEPT');
  // Older copies with earlier stamps; the newest three of everything survive.
  for (const stamp of ['2020-01-01T00-00-00', '2020-01-02T00-00-00', '2020-01-03T00-00-00']) {
    fs.copyFileSync(path.join(backup.backupDir(), first.file), path.join(backup.backupDir(), `squash-${stamp}Z.db`));
  }
  fs.writeFileSync(path.join(backup.backupDir(), 'unrelated.txt'), 'x');
  ok('four copies before', backup.listBackups().length === 4);
  const second = await backup.runBackup({ reason: 'test' });
  const left = backup.listBackups();
  ok('three after, the newest ones', second.ok && left.length === 3 && left[0].file === second.file && left.every((b) => !b.file.startsWith('squash-2020-01-01')), left.map((b) => b.file).join());
  ok('newest first', left[0].file > left[1].file && left[1].file > left[2].file);
  ok('and a file that is not a backup is left alone', fs.existsSync(path.join(backup.backupDir(), 'unrelated.txt')));

  console.log('THE SCHEDULE');
  // msUntil is on the club clock; with no setting that is Winnipeg.
  const { clubNow } = require('../lib/clock');
  const now = new Date();
  const [h, m] = clubNow(now).time.split(':').map(Number);
  const inTwoMinutes = `${String((h + (m + 2 >= 60 ? 1 : 0)) % 24).padStart(2, '0')}:${String((m + 2) % 60).padStart(2, '0')}`;
  const wait = backup.msUntil(inTwoMinutes, now);
  ok('a time two minutes ahead is about two minutes away', wait > 60 * 1000 && wait <= 120 * 1000, String(wait));
  const justPassed = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const tomorrow = backup.msUntil(justPassed, now);
  ok('the current minute means tomorrow, not now', tomorrow > 23 * 60 * 60 * 1000 && tomorrow <= 24 * 60 * 60 * 1000, String(tomorrow));

  console.log('UPLOADING TO A BUCKET');
  // A stand-in for S3: records the PUT and answers like a bucket would.
  const puts = [];
  const fake = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      puts.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(200, { ETag: '"abc"' });
      res.end();
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  t.after(() => fake.close());
  Object.assign(process.env, {
    BACKUP_S3_BUCKET: 'club-backups', BACKUP_S3_ENDPOINT: `http://127.0.0.1:${fake.address().port}`,
    BACKUP_S3_PREFIX: 'wsrc/', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', AWS_REGION: 'auto',
  });
  ok('a bucket in the environment turns uploads on', backup.status().upload === true);
  const third = await backup.runBackup({ reason: 'test' });
  ok('the backup reports the upload', third.ok && third.uploaded === true && third.error === null, JSON.stringify(third));
  const put = puts.find((p) => p.method === 'PUT');
  ok('one PUT to the bucket, under the prefix, named like the file', put && put.url.split('?')[0] === `/club-backups/wsrc/${third.file}.gz`, put?.url);
  ok('signed with the credentials', /AWS4-HMAC-SHA256 Credential=test\//.test(put?.headers.authorization || ''));
  const uploaded = put ? zlib.gunzipSync(put.body) : null;
  ok('the body is the gzipped copy, byte for byte', uploaded && uploaded.equals(fs.readFileSync(path.join(backup.backupDir(), third.file))));
  delete process.env.BACKUP_S3_BUCKET;
});
