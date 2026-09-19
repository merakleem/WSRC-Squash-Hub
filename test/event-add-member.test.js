// The admin puts a member on an event: the same rules a member's own signup
// meets, except that the date no longer closes the list.
// Run: node --test test/event-add-member.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const ADMIN_PW = process.env.SITE_PASSWORD;
const iso = (n) => {
  const d = new Date(Date.now() + n * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

suite('the admin adds a member to an event', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'event-add-member'), ({ run }) => {
    const hash = bcrypt.hashSync('pw123', 4);
    // Ana and Ben are members; Cara is not.
    for (const [i, name] of ['Ana Ruiz', 'Ben Cole', 'Cara Diaz'].entries()) {
      run('INSERT INTO players (name, email, member_number, is_member) VALUES (?, ?, ?, ?)',
        [name, `p${i + 1}@x.invalid`, `10${i + 1}`, i === 2 ? 0 : 1]);
      run('INSERT INTO user_accounts (player_id, password_hash) VALUES (?, ?)', [i + 1, hash]);
    }
  });
  const a = client(app), ana = client(app);
  await a.login('', ADMIN_PW);
  await ana.login('p1@x.invalid', 'pw123');
  const make = async (body) => (await a.send('POST', '/api/events', body)).body;
  const add = (eventId, playerId) => a.send('POST', `/api/events/${eventId}/signups`, { playerId });
  const roster = async (id) => (await a.get(`/api/events/${id}`)).attendees;

  console.log('THE PLAIN CASE');
  const social = await make({ name: 'Club Social', event_date: iso(10), guests_allowed: 2 });
  const added = await add(social.id, 1);
  ok('the admin adds a member', added.status === 200 && added.body.ok === true, JSON.stringify(added.body));
  let rows = await roster(social.id);
  ok('they are on the roster', rows.length === 1 && rows[0].player_id === 1);
  ok('with no guests: those are the member\'s own call', rows[0].guests === 0);
  ok('a player cannot do it', await ana.status('POST', `/api/events/${social.id}/signups`, { playerId: 2 }) === '403');
  ok('and a player is required', (await a.send('POST', `/api/events/${social.id}/signups`, {})).status === 400);

  console.log('\nTHE MEMBER STILL OWNS THEIR GUESTS');
  ok('they can add their own afterwards', (await ana.send('PUT', `/api/events/${social.id}/signup`, { guests: 2 })).status === 200);
  rows = await roster(social.id);
  ok('and it sticks', rows[0].guests === 2);
  // The search never offers someone already going, but the route must not undo
  // their guests if it is asked twice anyway.
  ok('adding them again is not an error', (await add(social.id, 1)).status === 200);
  rows = await roster(social.id);
  ok('and does not reset their guests', rows.length === 1 && rows[0].guests === 2, JSON.stringify(rows));

  console.log('\nFULL IS FULL, FOR THE ADMIN TOO');
  const small = await make({ name: 'Dinner', event_date: iso(12), max_people: 2 });
  ok('first add lands', (await add(small.id, 1)).status === 200);
  const fills = await add(small.id, 2);
  ok('the one that fills it says so', fills.status === 200 && fills.body.full === true && fills.body.total === 2, JSON.stringify(fills.body));
  const over = await add(small.id, 3);
  ok('the next is refused', over.status === 409, JSON.stringify(over.body));
  ok('and the admin is not apologised to', over.body.error === 'This event just filled up.', over.body.error);
  ok('nobody was added', (await roster(small.id)).length === 2);
  // A member meets the same wall, in the member's words. A different event, so
  // that Ana is not already on it - signing up twice is an edit, not a refusal.
  const oneSeat = await make({ name: 'Tasting Table', event_date: iso(12), max_people: 1 });
  await add(oneSeat.id, 2);
  const membersWall = await ana.send('POST', `/api/events/${oneSeat.id}/signup`, { guests: 0 });
  ok('a member is told the same thing, more gently', membersWall.status === 409 && membersWall.body.error === 'Sorry, this event just filled up.', membersWall.body.error);
  // Guests count towards the limit, so one member with a guest fills a two.
  const two = await make({ name: 'Tasting', event_date: iso(13), max_people: 2, guests_allowed: 1 });
  await add(two.id, 1);
  await ana.send('PUT', `/api/events/${two.id}/signup`, { guests: 1 });
  ok('a guest fills the room as surely as a member', (await add(two.id, 2)).status === 409);

  console.log('\nMEMBERS-ONLY MEANS MEMBERS');
  const mixer = await make({ name: 'Members Mixer', event_date: iso(14), members_only: true });
  ok('a member goes on', (await add(mixer.id, 1)).status === 200);
  const nonMember = await add(mixer.id, 3);
  ok('a non-member does not', nonMember.status === 403, JSON.stringify(nonMember.body));
  ok('and is told why', nonMember.body.error === 'This event is for club members.', nonMember.body.error);
  ok('they are not on it', (await roster(mixer.id)).every((r) => r.player_id !== 3));
  // Not members-only: anyone the admin picks may go.
  const open = await make({ name: 'Open Morning', event_date: iso(15) });
  ok('an open event takes a non-member', (await add(open.id, 3)).status === 200);

  console.log('\nA PAST EVENT IS STILL THE CLUB\'S RECORD');
  const gone = await make({ name: 'Season Opener', event_date: iso(-7) });
  ok('a member can no longer sign themselves up', (await ana.send('POST', `/api/events/${gone.id}/signup`, { guests: 0 })).status === 409);
  const late = await add(gone.id, 2);
  ok('but the admin can record who came', late.status === 200, JSON.stringify(late.body));
  ok('and they are on it', (await roster(gone.id)).some((r) => r.player_id === 2));
  // The date is the only rule the admin is let past.
  const goneFull = await make({ name: 'Old Dinner', event_date: iso(-8), max_people: 1 });
  await add(goneFull.id, 1);
  ok('a past event that is full is still full', (await add(goneFull.id, 2)).status === 409);
  const goneMembers = await make({ name: 'Old Mixer', event_date: iso(-9), members_only: true });
  ok('and a past members-only event still takes members only', (await add(goneMembers.id, 3)).status === 403);

  console.log('\nTHE LIST THE SEARCH IS BUILT FROM');
  const players = await a.get('/api/players');
  ok('the admin is told who is a member, so the search can filter', players.every((p) => 'is_member' in p));
  const theirs = await ana.get('/api/players');
  ok('a member never is', theirs.every((p) => !('is_member' in p)));
});
