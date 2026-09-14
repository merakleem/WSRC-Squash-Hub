// A doubles league: pairs are the unit. Creation from the wizard payload,
// the schedule it produces, what the league page and the list get back,
// swapping a partner out, and a scored fixture reaching the doubles ladder
// while singles sees nothing.
// Run: node --test test/doubles-league.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');

const day = (back) => new Date(Date.now() + back * 864e5).toISOString().slice(0, 10);

suite('a doubles league', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'doubles-league'), ({ run }) => {
    const hash = bcrypt.hashSync('pw123', 4);
    const NAMES = ['Ann Pair', 'Bo Pair', 'Cy Pair', 'Di Pair', 'Ed Pair', 'Flo Pair', 'Gus Pair', 'Hal Pair', 'Ivy Pair', 'Jo Pair', 'Kim Spare', 'Lou Spare'];
    NAMES.forEach((n, i) => {
      run('INSERT INTO players (name, email, is_member) VALUES (?, ?, 1)', [n, `${n.split(' ')[0].toLowerCase()}@x.invalid`]);
      run('INSERT INTO user_accounts (player_id, password_hash) VALUES (?, ?)', [i + 1, hash]);
    });
    run(`INSERT INTO settings (key,value) VALUES ('season_start_md','01-01')`);
    run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Doubles Court', 1]);
    // Ann has a profile photo; pairs and fixtures both have to carry it.
    run(`UPDATE players SET photo_path = '/uploads/avatars/1-ann.jpg' WHERE id = 1`);
  });
  const dbm = require('../database/db');
  const a = client(app), ann = client(app), gus = client(app), bo = client(app);

  ok('everyone signs in', await a.login('', 'pw') === '302' && await ann.login('ann@x.invalid', 'pw123') === '302' && await gus.login('gus@x.invalid', 'pw123') === '302');
  const payload = (divisions) => ({
    name: 'Autumn Doubles', startDate: day(-7), setup_type: 'doubles', numRounds: 1, blackoutDates: [],
    matchStartTime: '19:00', courtIds: [1], matchDuration: 45, matchBuffer: 15, divisions,
  });

  console.log('\nVALIDATION');
  let r = await a.send('POST', '/api/leagues', payload([[{ playerIds: [1, 1], rank: 1 }, { playerIds: [3, 4], rank: 2 }]]));
  ok('a pair of one player is refused', r.status === 400 && /2 different players/.test(r.body?.error), JSON.stringify(r.body));
  r = await a.send('POST', '/api/leagues', payload([[{ playerIds: [1, 2], rank: 1 }, { playerIds: [2, 3], rank: 2 }]]));
  ok('a player in two pairs is refused', r.status === 400 && /one pair/.test(r.body?.error), JSON.stringify(r.body));
  r = await a.send('POST', '/api/leagues', payload([[{ playerIds: [1, 2], rank: 1 }], [{ playerIds: [3, 4], rank: 1001 }, { playerIds: [5, 6], rank: 1002 }]]));
  ok('a division of one pair is refused', r.status === 400 && /Division 1 needs at least 2 pairs/.test(r.body?.error), JSON.stringify(r.body));

  console.log('\nCREATION');
  // Division 1: three pairs (odd, so byes). Division 2: two pairs.
  r = await a.send('POST', '/api/leagues', payload([
    [{ playerIds: [1, 2], rank: 1 }, { playerIds: [3, 4], rank: 2 }, { playerIds: [5, 6], rank: 3 }],
    [{ playerIds: [7, 8], rank: 1001 }, { playerIds: [9, 10], rank: 1002 }],
  ]));
  ok('the league is created', r.status === 200 && Number.isInteger(r.body), JSON.stringify(r.body));
  const leagueId = r.body;
  const L = await a.get(`/api/leagues/${leagueId}`);
  ok('it is a doubles league with five pairs and ten players', L.setup_type === 'doubles' && L.pairs.length === 5 && L.players.length === 10, `${L.setup_type} ${L.pairs?.length} ${L.players?.length}`);
  ok('pairs carry both names and their division', L.pairs[0].player1_name === 'Ann Pair' && L.pairs[0].player2_name === 'Bo Pair' && L.pairs[0].division_level === 1 && L.pairs[0].skill_rank === 1, JSON.stringify(L.pairs[0]));
  ok('three weeks: the odd division sets the length', L.weeks.length === 3, String(L.weeks.length));
  const w1 = L.weeks[0];
  const fixtures = w1.matchups.flatMap((mu) => mu.matches);
  ok('week 1 has one fixture per division', fixtures.length === 2, String(fixtures.length));
  ok('a fixture is a doubles row with four players and two pair ids', fixtures.every((m) => m.format === 'doubles' && m.player1_id && m.player1_partner_id && m.player2_id && m.player2_partner_id && m.pair1_id && m.pair2_id), JSON.stringify(fixtures[0]));
  ok('and names both partners', fixtures.every((m) => m.player1_name && m.player1_partner_name && m.player2_name && m.player2_partner_name));
  const annPair = L.pairs.find((p) => p.player1_id === 1);
  ok('a pair carries its players\' photos', annPair.player1_photo === '/uploads/avatars/1-ann.jpg' && annPair.player2_photo === null, JSON.stringify([annPair.player1_photo, annPair.player2_photo]));
  // Ann's pair may have the bye in week 1, so look across the season.
  const annFx = L.weeks.flatMap((w) => w.matchups.flatMap((mu) => mu.matches))
    .find((m) => m.player1_id === 1);
  ok('and so does the fixture she plays in', annFx.player1_photo === '/uploads/avatars/1-ann.jpg' && annFx.player1_partner_photo === null, JSON.stringify([annFx.player1_photo, annFx.player1_partner_photo]));
  ok('the odd division sits one pair out, as a pair', w1.byes.length === 1 && w1.byes[0].pair_id && w1.byes[0].pair_player2_name, JSON.stringify(w1.byes));
  ok('every fixture is on the doubles court at a time', fixtures.every((m) => m.court_id === 1 && /^\d\d:\d\d$/.test(m.match_time)));
  const allFixtures = L.weeks.flatMap((w) => w.matchups.flatMap((mu) => mu.matches));
  ok('over the season each division 1 pair meets each other once', allFixtures.filter((m) => m.division_level === 1).length === 3 && allFixtures.filter((m) => m.division_level === 2).length === 1, String(allFixtures.length));

  console.log('\nTHE COURT SCHEDULE');
  const sched = await a.get(`/api/schedule?date=${w1.date}`);
  const slot = sched.slots.find((x) => x.id === `m_${fixtures[0].id}`);
  ok('a doubles fixture on the grid names both pairs', slot && slot.format === 'doubles' && / & .* vs .* & /.test(slot.info), JSON.stringify(slot?.info));

  console.log('\nTHE LIST');
  const list = await ann.get('/api/leagues');
  const card = list.find((l) => l.id === leagueId);
  ok('the list counts pairs', card.pair_count === 5 && card.player_ids.length === 10, JSON.stringify([card.pair_count, card.player_ids.length]));
  ok('and names the signed-in player\'s partner and division', card.my_partner_name === 'Bo Pair' && card.my_division_level === 1, JSON.stringify([card.my_partner_name, card.my_division_level]));
  const gusCard = (await gus.get('/api/leagues')).find((l) => l.id === leagueId);
  ok('for a division 2 player too', gusCard.my_partner_name === 'Hal Pair' && gusCard.my_division_level === 2);
  ok('a player outside it gets neither', (await a.get('/api/leagues')).find((l) => l.id === leagueId).my_partner_name === null);

  console.log('\nREPLACING A PARTNER');
  const pair2 = L.pairs.find((p) => p.player1_id === 3);
  r = await a.send('POST', `/api/leagues/${leagueId}/replace-pair-player`, { pairId: pair2.id, oldPlayerId: 4, newPlayerId: 1 });
  ok('a player already in a pair cannot be the replacement', r.status === 400 && /already in a pair/.test(r.body?.error), JSON.stringify(r.body));
  r = await a.send('POST', `/api/leagues/${leagueId}/replace-pair-player`, { pairId: pair2.id, oldPlayerId: 4, newPlayerId: 11 });
  ok('a spare player can', r.status === 200, JSON.stringify(r.body));
  const L2 = await a.get(`/api/leagues/${leagueId}`);
  const pair2After = L2.pairs.find((p) => p.id === pair2.id);
  ok('the pair keeps its id and seed with the new partner', pair2After.player2_id === 11 && pair2After.player2_name === 'Kim Spare' && pair2After.skill_rank === 2, JSON.stringify(pair2After));
  ok('the roster swapped too', L2.players.some((p) => p.player_id === 11) && !L2.players.some((p) => p.player_id === 4));
  const pair2Fixtures = L2.weeks.flatMap((w) => w.matchups.flatMap((mu) => mu.matches)).filter((m) => m.pair1_id === pair2.id || m.pair2_id === pair2.id);
  ok('and every fixture of that pair now names Kim, never Di', pair2Fixtures.length === 2 && pair2Fixtures.every((m) => [m.player1_id, m.player1_partner_id, m.player2_id, m.player2_partner_id].includes(11) && ![m.player1_id, m.player1_partner_id, m.player2_id, m.player2_partner_id].includes(4)), JSON.stringify(pair2Fixtures.map((m) => [m.player1_id, m.player1_partner_id, m.player2_id, m.player2_partner_id])));
  const kim = await a.get('/api/players/11/doubles');
  ok('Kim sees those fixtures as upcoming doubles, with her partner', kim.upcoming.length === 2 && kim.upcoming[0].partner.id === 3);
  ok('and Di no longer does', (await a.get('/api/players/4/doubles')).upcoming.length === 0);

  console.log('\nA SCORED FIXTURE');
  // Re-read after the replacement: Kim now plays where Di did.
  const fx = L2.weeks[0].matchups.flatMap((mu) => mu.matches).find((m) => m.division_level === 1);
  r = await a.send('PUT', `/api/matches/${fx.id}/score`, { player1Score: 3, player2Score: 1, winnerId: fx.player1_id });
  ok('the admin scores a doubles fixture', r.status === 200, JSON.stringify(r.body));
  const dbl = await a.get('/api/ladder/doubles/season');
  ok('all four players land on the doubles ladder', dbl.rows.length === 4 && dbl.rows.every((x) => [fx.player1_id, fx.player1_partner_id, fx.player2_id, fx.player2_partner_id].includes(x.id)), dbl.rows.map((x) => x.name).join());
  ok('winners above losers', [fx.player1_id, fx.player1_partner_id].includes(dbl.rows[0].id) && [fx.player2_id, fx.player2_partner_id].includes(dbl.rows[3].id));
  ok('the singles ladder is untouched', (await a.get('/api/ladder/season')).rows.length === 0);
  const hist = (await a.get(`/api/players/${fx.player1_id}/doubles`)).history;
  ok('the profile shows it as a league doubles result', hist.length === 1 && hist[0].source === 'league' && hist[0].league_name === 'Autumn Doubles' && hist[0].week_number === 1 && hist[0].division_name === 'Division 1' && hist[0].result === 'W', JSON.stringify(hist[0]));
  const singlesHist = await a.get(`/api/players/${fx.player1_id}/history`);
  ok('singles history and record stay empty', singlesHist.history.length === 0 && singlesHist.wins === 0);

  console.log('\nREPORTING A SCORE AS A PARTNER');
  // Ann's next unscored fixture: Bo, her partner, reports it.
  const annFixture = L2.weeks.flatMap((w) => w.matchups.flatMap((mu) => mu.matches))
    .find((m) => m.id !== fx.id && [m.player1_id, m.player1_partner_id, m.player2_id, m.player2_partner_id].includes(1));
  await bo.login('bo@x.invalid', 'pw123');
  const rep = await bo.get('/api/my-matches/reportable');
  const row = rep.find((x) => x.id === annFixture.id);
  ok('the fixture is in Bo\'s reportable list as doubles', row && row.format === 'doubles', JSON.stringify(row));
  ok('naming his partner and both opponents', row?.partner?.id === 1 && row?.opponents?.length === 2 && /&/.test(row?.opponent_name || ''), JSON.stringify(row));
  let mc = await bo.get(`/api/matches/${annFixture.id}/card`);
  ok('the card is a doubles card with two sides of two', mc.format === 'doubles' && mc.sides?.length === 2 && mc.sides.every((sd) => sd.players.length === 2), JSON.stringify(mc.sides?.map((sd) => sd.players.map((p) => p.name))));
  ok('Bo is marked as the viewer, and may submit', mc.sides.flatMap((sd) => sd.players).find((p) => p.id === 2)?.is_viewer === true && mc.can_submit_score === true);
  ok('these pairs have never met', mc.head_to_head.total === 0 && mc.head_to_head.meetings.length === 0);
  r = await gus.send('PUT', `/api/matches/${annFixture.id}/player-score`, { mySideScore: 3, theirSideScore: 2 });
  ok('someone outside the four cannot report it', r.status === 403, String(r.status));
  r = await bo.send('PUT', `/api/matches/${annFixture.id}/player-score`, { mySideScore: 3, theirSideScore: 2 });
  ok('a partner reports for the pair', r.status === 200, JSON.stringify(r.body));
  mc = await bo.get(`/api/matches/${annFixture.id}/card`);
  const bosSide = mc.sides.find((sd) => sd.players.some((p) => p.id === 2));
  ok('the card shows the pair as winners with the score', bosSide.won === true && bosSide.games === 3 && mc.score === '3\u20132', JSON.stringify([bosSide.won, bosSide.games, mc.score]));
  ok('all four carry their own doubles rating change', mc.sides.flatMap((sd) => sd.players).every((p) => Number.isInteger(p.rating_change)) && bosSide.players.every((p) => p.rating_change > 0), JSON.stringify(mc.sides.map((sd) => sd.players.map((p) => p.rating_change))));
  ok('and a doubles rank and rating now', mc.sides.flatMap((sd) => sd.players).every((p) => Number.isInteger(p.position) && Number.isInteger(p.rating)));
  ok('it can no longer be submitted', mc.can_submit_score === false);
  ok('and it left Bo\'s reportable list', !(await bo.get('/api/my-matches/reportable')).some((x) => x.id === annFixture.id));
  const loserId = mc.sides.find((sd) => !sd.won).players[0].id;
  ok('the opponents lost, from their side', (await a.get(`/api/players/${loserId}/doubles`)).history.find((h) => h.id === annFixture.id)?.result === 'L');

  console.log('\nDELETION');
  r = await a.send('DELETE', `/api/leagues/${leagueId}`);
  ok('deleting the league takes its pairs with it', r.status === 200 && dbm.getDB().prepare('SELECT COUNT(*) AS n FROM league_pairs').get().n === 0);
});
