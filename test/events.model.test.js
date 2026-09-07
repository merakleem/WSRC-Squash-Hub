// Server-side behaviour of the events model: capacity in a transaction, guest
// limits, past refusal, link rules, role-gated fields, export, linkables.
// Run: node test/events.model.test.js
const fs = require('fs');
const path = '/tmp/events-model-test.db';
try { fs.unlinkSync(path); } catch (_) {}
const dbm = require('../database/db');
dbm.initDB(path);
const db = dbm.getDB();
const M = require('../models/eventModel');
let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };

db.prepare("INSERT INTO players (name, member_number) VALUES ('Ann A','M-1'),('Bob B','M-2'),('Cy C','M-3'),('Dee D','M-4')").run();
db.prepare("INSERT INTO leagues (name, start_date, num_teams, num_divisions) VALUES ('Autumn League', '2026-10-01', 8, 2)").run();
const TODAY = '2026-09-04';

const e1 = M.createEvent({ name: 'Social', event_date: '2026-09-20', start_time: '19:00', guests_allowed: 1, max_people: 4 });
M.signUp(e1.id, 1, 1, TODAY);
M.signUp(e1.id, 2, 0, TODAY);
try { M.signUp(e1.id, 3, 1, TODAY); ok('over-capacity refused', false); }
catch (err) { ok('over-capacity refused', err.status === 409 && err.message === 'Sorry, this event just filled up.'); }
M.signUp(e1.id, 3, 0, TODAY);
try { M.signUp(e1.id, 4, 0, TODAY); ok('full refused', false); }
catch (err) { ok('full refused', err.status === 409); }
try { M.updateSignup(e1.id, 1, 2, TODAY); ok('guest cap respected', false); }
catch (err) { ok('guest cap respected', /Up to 1 guest/.test(err.message)); }
try { M.updateSignup(e1.id, 2, 1, TODAY); ok('guest change beyond capacity refused', false); }
catch (err) { ok('guest change beyond capacity refused', err.status === 409); }
M.updateSignup(e1.id, 1, 0, TODAY);
M.updateSignup(e1.id, 2, 1, TODAY);
const shaped = M.getEvent(e1.id, { viewerId: 2, isAdmin: true });
ok('aggregates agree', shaped.total === 4 && shaped.members_count === 3 && shaped.guests_count === 1 && shaped.full === true);
ok('my_signup carried', shaped.my_signup?.guests === 1);
ok('member numbers for admins', shaped.attendees[0].member_number === 'M-1');
const asPlayer = M.getEvent(e1.id, { viewerId: 2, isAdmin: false });
ok('member numbers hidden from players', asPlayer.attendees[0].member_number === undefined);
ok('preview excludes the viewer', !asPlayer.preview.some((p) => p.name === 'Bob B') && asPlayer.preview.length === 2);

const e2 = M.createEvent({ name: 'BBQ', event_date: '2026-08-28', guests_allowed: 2 });
try { M.signUp(e2.id, 1, 0, TODAY); ok('past refused', false); }
catch (err) { ok('past refused', err.status === 409); }
ok('scopes split', M.listEvents({ scope: 'past', today: TODAY, viewerId: 1 }).length === 1
  && M.listEvents({ scope: 'upcoming', today: TODAY, viewerId: 1 }).length === 1);

const e3 = M.createEvent({ name: 'League reg', event_date: '2026-12-01', guests_allowed: 3, league_id: 1 });
ok('link forces guests to 0', e3.guests_allowed === 0 && e3.league_id === 1);
ok('link resolves', M.getEvent(e3.id, { viewerId: 1, isAdmin: false }).link?.type === 'league');
try { M.createEvent({ name: 'X', event_date: '2026-12-01', league_id: 1, tournament_id: 1 }); ok('both links refused', false); }
catch (err) { ok('both links refused', err.status === 400); }

M.withdraw(e1.id, 3);
ok('withdraw frees a spot', M.getEvent(e1.id, { viewerId: 1, isAdmin: true }).total === 3);
M.removeAttendee(e1.id, 2);
ok('admin remove drops member and guests', M.getEvent(e1.id, { viewerId: 1, isAdmin: true }).total === 1);
const ex = M.exportRows(e1.id);
ok('export rows', ex.rows.length === 1 && ex.rows[0].name === 'Ann A');
const links = M.searchLinkables('aut');
ok('linkables search', links.length === 1 && links[0].meta.includes('2 divisions'));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
