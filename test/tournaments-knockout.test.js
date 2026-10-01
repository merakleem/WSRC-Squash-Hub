// Knockout tournaments end to end through the API: announcing one, members
// signing up against the draw cap, building the draw (seeds, byes to the top
// seeds, every match on a court and a time), results carrying winners through
// the bracket, corrections undoing what they invalidated, and the entrant
// changes an admin can make before a player has played.
// Run: node --test test/tournaments-knockout.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb, clubDay: iso } = require('./lib/suite');
const { boot, client } = require('./lib/client');
const K = require('../renderer/knockout.js');

const ADMIN_PW = process.env.SITE_PASSWORD;
const NAMES = ['Ana Ruiz', 'Ben Cole', 'Cara Diaz', 'Dev Shah', 'Eli Moss', 'Fay Oduya', 'Gus Park', 'Hana Ito',
  'Ivo Bell', 'Jo Kerr', 'Kai Lund', 'Lea Voss', 'Max Orr'];

suite('knockout tournaments', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'knockout'), ({ run }) => {
    const hash = bcrypt.hashSync('pw123', 4);
    NAMES.forEach((name, i) => {
      run('INSERT INTO players (name, email) VALUES (?, ?)', [name, `p${i + 1}@x.invalid`]);
      run('INSERT INTO user_accounts (player_id, password_hash) VALUES (?, ?)', [i + 1, hash]);
    });
    for (let i = 1; i <= 3; i++) run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', [`Court ${i}`, i]);
  });
  const a = client(app);
  const p = NAMES.map(() => client(app));
  await a.login('', ADMIN_PW);
  for (let i = 0; i < 4; i++) await p[i].login(`p${i + 1}@x.invalid`, 'pw123');

  console.log('THE SHARED BRACKET MODULE');
  ok('7 entrants make an 8-draw, 11 a 16-draw', K.drawFor(7, 16) === 8 && K.drawFor(11, 16) === 16);
  ok('an 8 cap never grows past 8', K.drawFor(8, 8) === 8);
  ok('round counts follow the byes', JSON.stringify(K.matchCounts(16, 11)) === '[3,4,2,1]', JSON.stringify(K.matchCounts(16, 11)));
  ok('the winner of QF 3 goes to SF 2, top side', JSON.stringify(K.nextSlot(1, 2, 16)) === '{"r":2,"i":1,"side":1}');
  const plan = K.roundPlan(8, 3, 18 * 60, 40, 10);
  ok('8 matches on 3 courts are 3 waves ending 8:20 PM', plan.waves === 3 && K.fmtTime(plan.ends) === '8:20 PM');

  console.log('\nANNOUNCING');
  const announce = (body) => a.send('POST', '/api/tournaments/upcoming', body);
  ok('a name is required', (await announce({ drawCap: 16, firstRoundDate: iso(30) })).body.error === 'Tournament name is required.');
  ok('the draw is 8 or 16', (await announce({ name: 'X', drawCap: 12, firstRoundDate: iso(30) })).body.error === 'Choose an 8- or 16-player draw.');
  ok('a sign-up date after the first round is refused', (await announce({ name: 'X', drawCap: 8, firstRoundDate: iso(30), signupDeadline: iso(31) })).status === 400);
  ok('a player cannot announce one', (await p[0].send('POST', '/api/tournaments/upcoming', { name: 'X', drawCap: 8, firstRoundDate: iso(30) })).status === 403);
  const made = await announce({ name: 'Autumn Knockout', drawCap: 8, firstRoundDate: iso(30), signupDeadline: iso(20), description: 'Best of five.' });
  const tid = made.body.id;
  ok('an announcement is created', made.status === 200 && Number.isInteger(tid));
  let row = (await p[0].get('/api/tournaments')).find((x) => x.id === tid);
  ok('members see it as upcoming with its cap', row.status === 'upcoming' && row.draw_cap === 8 && row.spots_left === 8 && row.i_signed_up === false);

  console.log('\nSIGNING UP');
  ok('a member signs up', (await p[0].send('POST', `/api/tournaments/${tid}/signup`)).status === 200);
  ok('twice is not an error', (await p[0].send('POST', `/api/tournaments/${tid}/signup`)).status === 200);
  row = (await p[0].get('/api/tournaments')).find((x) => x.id === tid);
  ok('counted once, and they are told it is them', row.signup_count === 1 && row.i_signed_up === true);
  for (const pid of [5, 6, 7, 8, 9, 10, 11]) await a.send('POST', `/api/tournaments/${tid}/signups`, { playerId: pid });
  row = (await a.get('/api/tournaments')).find((x) => x.id === tid);
  ok('eight fills an 8 cap', row.full === true && row.spots_left === 0);
  ok('a ninth member is turned away', (await p[1].send('POST', `/api/tournaments/${tid}/signup`)).status === 409);
  ok('and the admin cannot squeeze one in either', (await a.send('POST', `/api/tournaments/${tid}/signups`, { playerId: 12 })).status === 409);
  ok('the cap cannot drop below the list', (await a.send('PUT', `/api/tournaments/${tid}/announcement`, { name: 'Autumn Knockout', drawCap: 8, firstRoundDate: iso(30) })).status === 200
    && (await a.send('POST', `/api/tournaments/${tid}/signups`, { playerId: 12 })).status === 409);
  await a.send('DELETE', `/api/tournaments/${tid}/signups/11`);
  await a.send('DELETE', `/api/tournaments/${tid}/signups/10`);
  await a.send('DELETE', `/api/tournaments/${tid}/signups/9`);
  const page = await p[0].get(`/api/tournaments/${tid}`);
  ok('the page carries the roster without emails', page.signups.length === 5 && !JSON.stringify(page).includes('x.invalid'));

  console.log('\nBUILDING THE DRAW');
  const rounds8 = [{ date: iso(30), time: '18:00' }, { date: iso(37), time: '14:00' }, { date: iso(37), time: '17:00' }];
  const build = (body) => a.send('POST', '/api/tournaments', { tournamentId: tid, name: 'Autumn Knockout', drawCap: 8, seeding: 'manual', rounds: rounds8, courtIds: [1, 2], len: 40, buffer: 10, ...body });
  ok('four players are not enough', (await build({ entrants: [1, 5, 6, 7] })).body.error === 'A knockout needs at least 5 players.');
  ok('an 8-draw has three rounds to schedule', (await build({ entrants: [1, 5, 6, 7, 8], rounds: rounds8.slice(0, 2) })).status === 400);
  ok('a player cannot build one', (await p[0].send('POST', '/api/tournaments', { name: 'X' })).status === 403);
  const conflicts = await a.send('POST', '/api/tournaments/check-schedule', { rounds: rounds8, counts: [1, 2, 1], courtIds: [1, 2], len: 40, buffer: 10 });
  ok('an empty grid has no conflicts', conflicts.status === 200 && conflicts.body.conflicts.every((c) => c.length === 0));
  // A clinic on Court 2 at 14:30 on the semis' day: the two semis start at
  // 14:00 on Courts 1 and 2, so only Court 2's overlaps; the final at 17:00 is clear.
  require('../database/db').getDB().prepare("INSERT INTO bookings (court_id, date, start_time, duration_minutes, name) VALUES (2, ?, '14:30', 60, 'Clinic')").run(iso(37));
  const clash = await a.send('POST', '/api/tournaments/check-schedule', { rounds: rounds8, counts: [1, 2, 1], courtIds: [1, 2], len: 40, buffer: 10 });
  ok('a booking under a semifinal is flagged on that round and court only',
    clash.body.conflicts[0].length === 0 && clash.body.conflicts[1].length === 1 && clash.body.conflicts[1][0].court === 'Court 2'
      && clash.body.conflicts[1][0].from === '14:30' && clash.body.conflicts[2].length === 0, JSON.stringify(clash.body.conflicts));
  // Seeds in this order: Ana (1), Eli (2), Fay (3), Gus (4), Hana (5).
  const built = await build({ entrants: [1, 5, 6, 7, 8] });
  ok('the draw is built into the same row', built.status === 200 && built.body.id === tid, JSON.stringify(built.body));
  let tour = await a.get(`/api/tournaments/${tid}`);
  ok('it is active with a 5-in-8 draw', tour.status === 'active' && tour.draw_size === 8 && tour.players.length === 5);
  ok('one first-round match: seed 4 v seed 5 (three byes)', tour.matches.filter((m) => m.round === 'quarterfinal').length === 1);
  ok('every later match exists already', tour.matches.filter((m) => m.round === 'semifinal').length === 2 && tour.matches.filter((m) => m.round === 'final').length === 1);
  const bySlot = (s) => tour.matches.find((m) => m.bracket_slot === s);
  ok('the bye players wait in the semifinals', bySlot('1-0').player1_id === 1 && bySlot('1-1').player1_id === 6 && bySlot('1-1').player2_id === 5,
    JSON.stringify([bySlot('1-0'), bySlot('1-1')].map((m) => [m.player1_id, m.player2_id])));
  ok('the first round is on the first court at the round start', bySlot('0-1').court_id === 1 && bySlot('0-1').scheduled_time === '18:00' && bySlot('0-1').scheduled_date === iso(30));
  ok('the semis share the start on two courts', bySlot('1-0').scheduled_time === '14:00' && bySlot('1-1').scheduled_time === '14:00' && bySlot('1-0').court_id === 1 && bySlot('1-1').court_id === 2);
  ok('the signups are gone from the page once built', !tour.signups);
  row = (await p[0].get('/api/tournaments')).find((x) => x.id === tid);
  ok('the list says quarterfinals, and Ana waits for her semifinal', row.current_round === 'quarterfinal' && row.my_next.label === 'SF 1' && row.my_next.opponent === 'winner of QF 2',
    JSON.stringify(row.my_next));

  console.log('\nRESULTS CARRY THROUGH');
  const qf = bySlot('0-1');
  ok('a non-player cannot report it', (await p[1].send('PUT', `/api/tournament-matches/${qf.id}/player-score`, { p1: 3, p2: 1 })).status === 403);
  ok('a nonsense score is refused', (await a.send('PUT', `/api/tournament-matches/${qf.id}/score`, { p1: 3, p2: 3 })).status === 400);
  ok('a match without both players cannot be scored', (await a.send('PUT', `/api/tournament-matches/${bySlot('1-0').id}/score`, { p1: 3, p2: 0 })).status === 409);
  ok('the admin scores QF 2: Gus beats Hana 3-1', (await a.send('PUT', `/api/tournament-matches/${qf.id}/score`, { p1: 3, p2: 1 })).status === 200);
  tour = await a.get(`/api/tournaments/${tid}`);
  ok('Gus moves into SF 1', bySlot('1-0').player2_id === 7);
  ok('the result counts as played with games', bySlot('0-1').status === 'played' && bySlot('0-1').player1_score === 3 && bySlot('0-1').played_at === iso(30));
  ok('Ana reports her own semifinal', (await p[0].send('PUT', `/api/tournament-matches/${bySlot('1-0').id}/player-score`, { myScore: 3, theirScore: 2 })).status === 200);
  ok('but not twice', (await p[0].send('PUT', `/api/tournament-matches/${bySlot('1-0').id}/player-score`, { myScore: 3, theirScore: 0 })).status === 409);
  tour = await a.get(`/api/tournaments/${tid}`);
  ok('Ana is in the final', bySlot('2-0').player1_id === 1);
  await a.send('PUT', `/api/tournament-matches/${bySlot('1-1').id}/score`, { p1: 1, p2: 3 });
  tour = await a.get(`/api/tournaments/${tid}`);
  ok('Eli beats Fay and joins her', bySlot('2-0').player2_id === 5);
  await a.send('PUT', `/api/tournament-matches/${bySlot('2-0').id}/score`, { p1: 3, p2: 1 });
  tour = await a.get(`/api/tournaments/${tid}`);
  ok('the final completes the tournament', tour.status === 'completed');
  row = (await a.get('/api/tournaments')).find((x) => x.id === tid);
  ok('the list names the champion and the final score', row.champion.name === 'Ana Ruiz' && row.runner_up.name === 'Eli Moss' && row.final_score === '3–1', JSON.stringify(row.champion));

  console.log('\nCORRECTIONS UNDO WHAT THEY INVALIDATE');
  // Hana actually won QF 2: Gus must leave SF 1, taking SF 1's and the final's results with him.
  await a.send('PUT', `/api/tournament-matches/${qf.id}/score`, { p1: 1, p2: 3 });
  tour = await a.get(`/api/tournaments/${tid}`);
  ok('Hana replaces Gus in SF 1', bySlot('1-0').player2_id === 8);
  ok('SF 1 loses its result', bySlot('1-0').winner_id === null && bySlot('1-0').player1_score === null);
  ok('Ana leaves the final, and the final its result', bySlot('2-0').player1_id === null && bySlot('2-0').winner_id === null);
  ok('the tournament is running again', tour.status === 'active');
  ok('SF 2, untouched, keeps its result', bySlot('1-1').winner_id === 5 && bySlot('2-0').player2_id === 5);
  ok('a correction that keeps the winner changes nothing downstream',
    (await a.send('PUT', `/api/tournament-matches/${bySlot('1-1').id}/score`, { p1: 0, p2: 3 })).status === 200
    && (await a.get(`/api/tournaments/${tid}`)).matches.find((m) => m.bracket_slot === '2-0').player2_id === 5);
  await a.send('DELETE', `/api/tournament-matches/${bySlot('1-1').id}/score`);
  tour = await a.get(`/api/tournaments/${tid}`);
  ok('clearing SF 2 takes Eli out of the final', bySlot('1-1').winner_id === null && bySlot('2-0').player2_id === null);

  console.log('\nA 16-DRAW, REPLACING AND WITHDRAWING');
  const rounds16 = [{ date: iso(40), time: '18:00' }, { date: iso(47), time: '18:00' }, { date: iso(54), time: '14:00' }, { date: iso(54), time: '17:00' }];
  // 11 entrants in seed order 1..11 = players 1..11.
  const big = await a.send('POST', '/api/tournaments', { name: 'Club Open', drawCap: 16, seeding: 'ladder', entrants: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], rounds: rounds16, courtIds: [1, 2, 3], len: 40, buffer: 10 });
  const bid = big.body.id;
  let open = await a.get(`/api/tournaments/${bid}`);
  const at16 = (s) => open.matches.find((m) => m.bracket_slot === s);
  ok('11 players: 3 round-of-16 matches and 5 byes', open.matches.filter((m) => m.round === 'round_of_16').length === 3);
  ok('seed 1 waits in QF 1', at16('1-0').player1_id === 1 && at16('1-0').player2_id === null);
  ok('R16: 8 v 9, 6 v 11, 7 v 10', [at16('0-1'), at16('0-4'), at16('0-6')].map((m) => `${m.player1_id}v${m.player2_id}`).join(',') === '8v9,6v11,7v10',
    JSON.stringify(open.matches.filter((m) => m.round === 'round_of_16').map((m) => [m.bracket_slot, m.player1_id, m.player2_id])));
  ok('three R16 matches on three courts at once', ['0-1', '0-4', '0-6'].every((s) => at16(s).scheduled_time === '18:00') && new Set(['0-1', '0-4', '0-6'].map((s) => at16(s).court_id)).size === 3);

  ok('a replacement cannot already be in the draw', (await a.send('POST', `/api/tournaments/${bid}/replace`, { oldPlayerId: 9, newPlayerId: 2 })).status === 409);
  ok('Ivo (9) is replaced by Lea (12)', (await a.send('POST', `/api/tournaments/${bid}/replace`, { oldPlayerId: 9, newPlayerId: 12 })).status === 200);
  open = await a.get(`/api/tournaments/${bid}`);
  ok('Lea takes seed 9 and his match', open.players.find((x) => x.seed === 9).player_id === 12 && at16('0-1').player2_id === 12);

  ok('Kai (11) withdraws before playing', (await a.send('POST', `/api/tournaments/${bid}/withdraw`, { playerId: 11 })).status === 200);
  open = await a.get(`/api/tournaments/${bid}`);
  ok('Fay (6) gets a walkover', at16('0-4').winner_id === 6 && at16('0-4').skipped === 1 && at16('0-4').player1_score === null);
  ok('and moves on to QF 3', at16('1-2').player1_id === 6, JSON.stringify(at16('1-2')));
  ok('Kai stays in the draw, marked withdrawn', open.players.find((x) => x.player_id === 11).withdrawn === 1);

  // Seed 2 (Ben) had a bye; withdrawing him leaves QF 4 waiting for 7 v 10's winner.
  await a.send('POST', `/api/tournaments/${bid}/withdraw`, { playerId: 2 });
  await a.send('PUT', `/api/tournament-matches/${at16('0-6').id}/score`, { p1: 3, p2: 0 });
  open = await a.get(`/api/tournaments/${bid}`);
  ok('the winner of R16 7 walks over the withdrawn bye player', at16('1-3').winner_id === 7 && at16('1-3').skipped === 1 && at16('2-1').player2_id === 7,
    JSON.stringify([at16('1-3'), at16('2-1')].map((m) => [m.player1_id, m.player2_id, m.winner_id])));
  ok('a player who has played cannot be withdrawn', (await a.send('POST', `/api/tournaments/${bid}/withdraw`, { playerId: 7 })).status === 409);

  console.log('\nTHE REST OF THE APP');
  const history = await a.get('/api/players/6/history');
  ok('a walkover is not in anyone\'s match history', !(history.history || []).some((m) => m.source === 'tournament'), JSON.stringify((history.history || []).filter((m) => m.source === 'tournament')));
  const anaHistory = await a.get('/api/players/1/history');
  ok('Ana\'s finishing place in the completed 8-draw... is pending again after the correction', anaHistory.tournamentResults.some((r) => r.tournament_id === tid));
  const card = await p[0].get(`/api/matches/${open.matches.find((m) => m.bracket_slot === '1-0').id}/card`);
  ok('a match card for a slot without both players offers no score', card && card.can_submit_score === false);

  console.log('\nRESCHEDULING');
  const moved = await a.send('PUT', `/api/tournaments/${bid}/schedule`, { rounds: rounds16.map((r, k) => (k === 1 ? { date: iso(48), time: '19:00' } : r)), courtIds: [2, 3], len: 45, buffer: 15 });
  open = await a.get(`/api/tournaments/${bid}`);
  ok('unplayed quarterfinals move to the new date and courts', moved.status === 200 && at16('1-0').scheduled_date === iso(48) && at16('1-0').scheduled_time === '19:00' && [2, 3].includes(at16('1-0').court_id));
  ok('a decided match keeps its slot', at16('0-6').scheduled_date === iso(40));

  console.log('\nDELETING');
  ok('the admin deletes a tournament', (await a.send('DELETE', `/api/tournaments/${bid}`)).status === 200 && !(await a.get('/api/tournaments')).some((x) => x.id === bid));
});
