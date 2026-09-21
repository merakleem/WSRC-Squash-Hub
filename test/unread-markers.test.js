// Unread markers: which tabs have something a member has not seen, the stamp
// each visit replaces, and who is told nothing at all.
// Run: node --test test/unread-markers.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const ADMIN_PW = process.env.SITE_PASSWORD;
const iso = (n) => {
  const d = new Date(Date.now() + n * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

suite('a member is told which tabs have something new', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'unread-markers'), ({ run }) => {
    const hash = bcrypt.hashSync('pw123', 4);
    for (const [i, name] of ['Ana Ruiz', 'Ben Cole', 'Cara Diaz', 'Dev Shah'].entries()) {
      run('INSERT INTO players (name, email, is_member) VALUES (?, ?, ?)', [name, `p${i + 1}@x.invalid`, i === 2 ? 0 : 1]);
      run('INSERT INTO user_accounts (player_id, password_hash) VALUES (?, ?)', [i + 1, hash]);
    }
  });
  const { getDB } = require('../database/db');
  // The whole file runs inside one second, and created_at counts only seconds,
  // so nothing here can be ordered by waiting. Instead: everything posted so
  // far happened two minutes ago, and these members last looked one minute
  // ago - they have seen all of it. Whatever is posted next is new to them.
  const caughtUp = (...playerIds) => {
    const db = getDB();
    db.prepare(`UPDATE leagues SET created_at = datetime('now', '-120 seconds')`).run();
    db.prepare(`UPDATE events SET created_at = datetime('now', '-120 seconds')`).run();
    const stamp = db.prepare(`UPDATE member_tab_opens SET opened_at = strftime('%Y-%m-%d %H:%M:%f', 'now', '-60 seconds') WHERE player_id = ?`);
    for (const id of playerIds) stamp.run(id);
  };
  const stampOf = (playerId, tab) => getDB().prepare('SELECT opened_at FROM member_tab_opens WHERE player_id = ? AND tab = ?').get(playerId, tab)?.opened_at || null;

  const a = client(app), member = client(app), other = client(app), nonMember = client(app);
  await a.login('', ADMIN_PW);
  await member.login('p1@x.invalid', 'pw123');
  await other.login('p2@x.invalid', 'pw123');
  await nonMember.login('p3@x.invalid', 'pw123');

  console.log('A MEMBER WHO HAS NEVER LOOKED IS UP TO DATE');
  // Sessions are month-long cookies, so a deploy gives no moment to stamp
  // everyone. Without this rule every existing member would come back to two
  // dots and a list where everything is marked.
  const old = (await a.send('POST', '/api/leagues/upcoming', { name: 'Before They Looked', startDate: iso(30), setupType: 'modern' })).body;
  getDB().prepare(`UPDATE leagues SET created_at = datetime('now', '-120 seconds')`).run();
  let me = await member.me();
  ok('nothing is marked on the first read', me.unread.leagues === false && me.unread.events === false, JSON.stringify(me.unread));
  ok('and both tabs were stamped', !!me.opened.leagues && !!me.opened.events, JSON.stringify(me.opened));
  ok('the stamp is on the row, not just the answer', stampOf(1, 'leagues') === me.opened.leagues);
  await other.me();
  await nonMember.me();

  console.log('\nSOMETHING POSTED SINCE');
  caughtUp(1, 2, 3);
  const firstStamp = stampOf(1, 'leagues');
  const league = (await a.send('POST', '/api/leagues/upcoming', { name: 'Autumn Box League', startDate: iso(30), setupType: 'modern' })).body;
  me = await member.me();
  ok('the leagues tab is marked', me.unread.leagues === true);
  ok('the events tab is not', me.unread.events === false);
  ok('the stamp did not move on its own', stampOf(1, 'leagues') === firstStamp);
  ok('every member sees it, not just one', (await other.me()).unread.leagues === true);
  ok('the league they had already seen is not what marked it', league.id !== old.id);

  console.log('\nOPENING THE TAB');
  const patched = (await member.send('PATCH', '/api/me/opened/leagues')).body;
  ok('the visit is handed the stamp it replaced', patched.previous === firstStamp, JSON.stringify(patched));
  ok('and the new one, which is later', patched.opened_at > patched.previous);
  me = await member.me();
  ok('the tab is clear afterwards', me.unread.leagues === false);
  ok('the other member is still marked', (await other.me()).unread.leagues === true);
  ok('an unknown tab is refused', (await member.send('PATCH', '/api/me/opened/ladder')).status === 400);

  console.log('\nEVENTS FOLLOW THE SAME RULE, AND ITS VISIBILITY');
  await a.send('POST', '/api/events', { name: 'Club Social', event_date: iso(10) });
  ok('a member is marked', (await member.me()).unread.events === true);
  ok('so is a non-member, by the open one', (await nonMember.me()).unread.events === true);
  await member.send('PATCH', '/api/me/opened/events');
  await nonMember.send('PATCH', '/api/me/opened/events');
  ok('both are clear again', (await member.me()).unread.events === false && (await nonMember.me()).unread.events === false);

  caughtUp(1, 3);
  await a.send('POST', '/api/events', { name: 'Members Mixer', event_date: iso(12), members_only: true });
  ok('a members-only event marks a member', (await member.me()).unread.events === true);
  ok('and does not exist for anyone else', (await nonMember.me()).unread.events === false);

  caughtUp(1);
  await a.send('POST', '/api/events', { name: 'Long Gone', event_date: iso(-1) });
  ok('a past event never marks: the dot would point at an empty list', (await member.me()).unread.events === false);

  console.log('\nTHE LIST CARRIES WHAT THE CARDS NEED');
  const events = await member.get('/api/events');
  ok('every event says when it was posted', events.length > 0 && events.every((e) => typeof e.created_at === 'string'), JSON.stringify(events[0]));
  const leagues = await member.get('/api/leagues');
  ok('so does every league', leagues.length > 0 && leagues.every((l) => typeof l.created_at === 'string'));

  console.log('\nADMINS POSTED THE THINGS');
  const adminMe = await a.me();
  ok('an admin is never marked', adminMe.unread.leagues === false && adminMe.unread.events === false);
  ok('and has no stamps to spend', Object.keys(adminMe.opened).length === 0, JSON.stringify(adminMe.opened));
  ok('the admin account cannot stamp a tab', await a.status('PATCH', '/api/me/opened/leagues') === '403');

  console.log('\nVIEWING AS A MEMBER SHOWS THEIRS WITHOUT SPENDING IT');
  caughtUp(2);
  const beforeLook = stampOf(2, 'leagues');
  await a.send('POST', '/api/leagues/upcoming', { name: 'Winter Doubles', startDate: iso(60), setupType: 'doubles' });
  ok('the member is marked', (await other.me()).unread.leagues === true);
  await a.send('POST', '/api/players/2/view-as');
  ok('the admin sees exactly what they see', (await a.me()).unread.leagues === true);
  await a.send('PATCH', '/api/me/opened/leagues');
  ok('but looking does not clear it for them', stampOf(2, 'leagues') === beforeLook);
  ok('so the member still has their dot', (await other.me()).unread.leagues === true);

  console.log('\nA MEMBER WHO HAS NEVER OPENED THE APP, WHILE AN ADMIN IS WEARING THEM');
  // Dev Shah has never signed in, so nothing has ever been stamped for them.
  // The look seeds their baseline - a member with no row is up to date at
  // whatever moment it is first read, so setting it now only means more of
  // what comes next reaches them. Leaving no row behind is the state in which
  // no marker can ever appear, which is how this was found.
  await a.send('POST', '/api/return-to-admin');
  // Everything the club has posted predates the look, so "up to date" here is
  // about having no row rather than about when the last league landed.
  caughtUp();
  await a.send('POST', '/api/players/4/view-as');
  ok('they read as up to date', (await a.me()).unread.leagues === false);
  ok('and the look left them a baseline', getDB().prepare('SELECT COUNT(*) AS n FROM member_tab_opens WHERE player_id = 4').get().n === 2);

  console.log('\nAND SOMETHING POSTED AFTER THAT LOOK REACHES THEM');
  caughtUp(4);
  await a.send('POST', '/api/return-to-admin');
  await a.send('POST', '/api/leagues/upcoming', { name: 'Spring Singles', startDate: iso(90), setupType: 'modern' });
  await a.send('POST', '/api/players/4/view-as');
  ok('the admin sees the dot they would see', (await a.me()).unread.leagues === true,
    `stamp ${stampOf(4, 'leagues')} vs ${JSON.stringify(getDB().prepare('SELECT name, created_at FROM leagues ORDER BY id DESC LIMIT 2').all())}`);
  const theirStamp = stampOf(4, 'leagues');
  await a.send('PATCH', '/api/me/opened/leagues');
  ok('and opening the tab in their name does not spend it', stampOf(4, 'leagues') === theirStamp);

  console.log('\nAND THEN THEY SIGN IN FOR THEMSELVES');
  await a.send('POST', '/api/return-to-admin');
  const fresh = client(app);
  await fresh.login('p4@x.invalid', 'pw123');
  const freshMe = await fresh.me();
  ok('both tabs are stamped', !!freshMe.opened.leagues && !!freshMe.opened.events);
  ok('and the league announced since the look is still theirs to see', freshMe.unread.leagues === true);
  await fresh.send('PATCH', '/api/me/opened/leagues');
  ok('opening it themselves does clear it', (await fresh.me()).unread.leagues === false);

  console.log('\nPOSTED AFTER THE DEPLOY, READ BY SOMEONE WHO HAS NOT BEEN BACK YET');
  // The launch case: this ships, an event goes up, and only then does a member
  // open the app. Starting them at the moment they happen to load it would
  // swallow that event - and on the day it ships, that is every member.
  await a.send('POST', '/api/return-to-admin');
  const db = getDB();
  db.prepare(`UPDATE schema_migrations SET applied_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-120 seconds') WHERE id = 30`).run();
  db.prepare(`UPDATE players SET created_at = datetime('now', '-400 seconds')`).run();
  db.prepare('DELETE FROM member_tab_opens WHERE player_id = 4').run();
  await a.send('POST', '/api/events', { name: 'Posted At Launch', event_date: iso(14) });
  const returning = client(app);
  await returning.login('p4@x.invalid', 'pw123');
  const first = await returning.me();
  ok('their very first look carries the dot', first.unread.events === true, JSON.stringify(first));
  ok('and they start from the deploy, not from now', first.opened.events < db.prepare(`SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t`).get().t);

  console.log('\nBUT NOT THE CLUB\'S WHOLE HISTORY');
  db.prepare('DELETE FROM member_tab_opens WHERE player_id = 4').run();
  db.prepare(`UPDATE leagues SET created_at = datetime('now', '-400 seconds')`).run();
  const afresh = await client(app);
  await afresh.login('p4@x.invalid', 'pw123');
  ok('what was posted before it arrived is taken as seen', (await afresh.me()).unread.leagues === false);

  console.log('\nA MEMBER ADDED AFTER IT ARRIVED STARTS FROM WHEN THEY JOINED');
  // Otherwise someone who joins next year opens the app to a dot for every
  // league and event the club has run since this shipped.
  db.prepare("INSERT INTO players (name, email, is_member) VALUES ('Gus Hall', 'p5@x.invalid', 1)").run();
  const gus = getDB().prepare('SELECT id FROM players WHERE email = ?').get('p5@x.invalid').id;
  db.prepare('INSERT INTO user_accounts (player_id, password_hash) VALUES (?, (SELECT password_hash FROM user_accounts WHERE player_id = 1))').run(gus);
  const newcomer = client(app);
  await newcomer.login('p5@x.invalid', 'pw123');
  ok('the event posted before they existed is not theirs to catch up on', (await newcomer.me()).unread.events === false);
  ok('and they were stamped from their own joining', stampOf(gus, 'events') > first.opened.events, `${stampOf(gus, 'events')} vs ${first.opened.events}`);

});
