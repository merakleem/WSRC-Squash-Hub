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
// Ann and Bob are members; Cy and Dee are not.
db.prepare('UPDATE players SET is_member = 1 WHERE id IN (1, 2)').run();
db.prepare("INSERT INTO leagues (name, start_date, num_teams, num_divisions) VALUES ('Autumn League', '2026-10-01', 8, 2)").run();
const TODAY = '2026-09-04';

const e1 = M.createEvent({ name: 'Social', event_date: '2026-09-20', start_time: '19:00', end_time: '22:00', guests_allowed: 1, max_people: 4 });
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


console.log('A TIME IS A SPAN OR NOTHING');
const refuse = (label, fields, re) => { try { M.createEvent(fields); ok(label, false, 'accepted'); } catch (err) { ok(label, re.test(err.message), err.message); } };
refuse('an end time with no start is refused', { name: 'X', event_date: '2026-11-01', end_time: '21:00' }, /both a start and an end/);
refuse('a start with no end is refused', { name: 'X', event_date: '2026-11-01', start_time: '19:00' }, /both a start and an end/);
refuse('an end before the start is refused', { name: 'X', event_date: '2026-11-01', start_time: '19:00', end_time: '18:00' }, /after the start/);
const span = M.createEvent({ name: 'Span', event_date: '2026-11-01', start_time: '19:00', end_time: '21:00' });
ok('a proper span is stored and shaped', span.start_time === '19:00' && span.end_time === '21:00');
ok('no time at all is still fine', M.createEvent({ name: 'Untimed', event_date: '2026-11-02' }).end_time === null);

console.log('MEMBERS ONLY IS ENFORCED ON THE SERVER');
const mo = M.createEvent({ name: 'Members Social', event_date: '2026-11-05', members_only: true, guests_allowed: 1 });
ok('the flag is stored', !!mo.members_only);
const names = (list) => list.map((e) => e.name);
ok('a non-member does not see it in the list', !names(M.listEvents({ scope: 'upcoming', today: TODAY, viewerId: 3 })).includes('Members Social'));
ok('a member does', names(M.listEvents({ scope: 'upcoming', today: TODAY, viewerId: 1 })).includes('Members Social'));
ok('an admin does', names(M.listEvents({ scope: 'upcoming', today: TODAY, viewerId: null, isAdmin: true })).includes('Members Social'));
ok('a non-member cannot fetch it by id either', M.getEvent(mo.id, { viewerId: 3, isAdmin: false }) === null);
ok('a member can', M.getEvent(mo.id, { viewerId: 1, isAdmin: false })?.name === 'Members Social');
try { M.signUp(mo.id, 3, 0, TODAY); ok('a non-member cannot sign up', false, 'accepted'); }
catch (err) { ok('a non-member cannot sign up', err.status === 403 && /club members/.test(err.message), err.message); }
M.signUp(mo.id, 1, 0, TODAY);
ok('a member can sign up', M.getEvent(mo.id, { viewerId: 1, isAdmin: false }).my_signup !== null);
ok('an open event is unchanged for everyone', names(M.listEvents({ scope: 'upcoming', today: TODAY, viewerId: 3 })).includes('Span'));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
