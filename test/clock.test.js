// The club clock follows the admin's timezone setting, wherever the server
// runs. Run: node test/clock.test.js
const fs = require('fs');
const path = '/tmp/clock-test.db';
try { fs.unlinkSync(path); } catch (_) {}
const dbm = require('../database/db');
dbm.initDB(path);
const settings = require('../models/settingsModel');
const { getClubTimezone, clubNow, clubToday } = require('../lib/clock');
let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };

// A fixed instant: half past midnight UTC on New Year's Day 2026.
const AT = new Date('2026-01-01T00:30:00Z');

ok('defaults to Winnipeg', getClubTimezone() === (process.env.CLUB_TIMEZONE || 'America/Winnipeg'));
ok('Winnipeg is still on New Year\'s Eve', clubToday(AT) === '2025-12-31', clubToday(AT));

settings.setSetting('club_timezone', 'Pacific/Kiritimati');   // UTC+14
ok('the setting takes over', getClubTimezone() === 'Pacific/Kiritimati');
ok('Kiritimati is already in the new year', clubToday(AT) === '2026-01-01', clubToday(AT));
ok('and mid-afternoon', clubNow(AT).time === '14:30', clubNow(AT).time);

settings.setSetting('club_timezone', 'Not/AZone');
ok('an invalid zone falls back safely', getClubTimezone() === 'America/Winnipeg', getClubTimezone());

settings.setSetting('club_timezone', 'Europe/London');
ok('a change applies without a restart', clubNow(AT).time === '00:30' && clubToday(AT) === '2026-01-01');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
