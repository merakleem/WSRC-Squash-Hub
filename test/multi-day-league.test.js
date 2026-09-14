// A league that plays on several days a week. The week structure is untouched
// (same round robin, everyone once a week); each week's matches are split
// evenly across its play days, every match carries its own day, and every
// read takes the day from the match. One play day is exactly the old schedule.
// Run: node --test test/multi-day-league.test.js
const bcrypt = require('bcryptjs');
const { suite, scratchDb } = require('./lib/suite');
const { boot, client } = require('./lib/client');
const { normalizePlayDays, playDates, splitAcrossDays } = require('../services/leagueService');

// A Monday well in the past, so nothing depends on today's date.
const MON = '2030-03-04';
const WED = '2030-03-06';
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); };
const dow = (iso) => new Date(iso + 'T12:00:00').getDay();

suite('multi-day leagues', async ({ ok, t }) => {
  const app = boot(scratchDb(t, 'multi-day'), ({ run }) => {
    const hash = bcrypt.hashSync('pw123', 4);
    for (let i = 1; i <= 14; i++) {
      run('INSERT INTO players (name, email, is_member) VALUES (?, ?, 1)', [`Player ${String(i).padStart(2, '0')}`, `p${i}@x.invalid`]);
      run('INSERT INTO user_accounts (player_id, password_hash) VALUES (?, ?)', [i, hash]);
    }
    run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 1', 1]);
    run('INSERT INTO courts (name, sort_order) VALUES (?, ?)', ['Court 2', 2]);
  });
  const dbm = require('../database/db');
  const db = dbm.getDB();
  const a = client(app);
  await a.login('', 'pw');
  const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const division = (playerIds, base = 0) => playerIds.map((id, i) => ({ playerId: id, rank: base + i + 1 }));
  const payload = (extra) => ({
    name: 'Two-day League', startDate: MON, setup_type: 'modern', numRounds: 1, blackoutDates: [],
    matchStartTime: '19:00', courtIds: [1, 2], matchDuration: 45, matchBuffer: 15,
    // 8 players (4 matches) + 6 players (3 matches) = 7 matches a week.
    divisions: [division(ids(1, 8)), division(ids(9, 14), 1000)],
    ...extra,
  });
  const matchesOf = (leagueId) => db.prepare(`SELECT m.*, w.week_number, w.date AS week_date, d.level FROM matches m JOIN weeks w ON w.id = m.week_id JOIN divisions d ON d.id = m.division_id WHERE m.league_id = ? ORDER BY w.week_number, m.scheduled_date, m.scheduled_time, m.court_id`).all(leagueId);

  console.log('THE HELPERS');
  ok('the start weekday is always first', normalizePlayDays(WED, [1, 3, 5], 'modern').join() === '3,5,1');
  ok('the anchor is added when missing, and days are unique', normalizePlayDays(MON, [3, 3], 'modern').join() === '1,3');
  ok('a Teams league plays the start day alone', normalizePlayDays(MON, [3, 5], 'traditional').join() === '1');
  ok('play dates follow the week', playDates(WED, [3, 5, 1]).join() === `${WED},${addDays(WED, 2)},${addDays(WED, 5)}`);
  const split = splitAcrossDays([1, 2, 3, 4, 5, 6, 7], MON, [1, 3]);
  ok('seven matches over two days: four then three', split.map((d) => d.matches.length).join() === '4,3' && split[1].date === WED);
  ok('two matches over three days leaves one day empty', splitAcrossDays([1, 2], MON, [1, 3, 5]).map((d) => d.matches.length).join() === '1,1,0');
  let threw = null;
  try { normalizePlayDays(MON, [7], 'modern'); } catch (e) { threw = e; }
  ok('a weekday outside 0-6 is refused', threw?.status === 400);

  console.log('MONDAY AND WEDNESDAY');
  let r = await a.send('POST', '/api/leagues', payload({ playDays: [1, 3] }));
  ok('the league is created', r.status === 200 && Number.isInteger(r.body), JSON.stringify(r.body));
  const twoDay = r.body;
  const L = await a.get(`/api/leagues/${twoDay}`);
  ok('it carries its play days, start day first', JSON.stringify(L.play_days) === '[1,3]', JSON.stringify(L.play_days));
  const rows = matchesOf(twoDay);
  const byWeek = {};
  rows.forEach((m) => { (byWeek[m.week_number] ||= []).push(m); });
  const weeks = Object.values(byWeek);
  // The six-player division finishes after five weeks; the eight-player one
  // plays seven. So five weeks of seven matches, then two of four.
  ok('seven matches a week while both divisions play, then four', weeks.map((w) => w.length).join() === '7,7,7,7,7,4,4', weeks.map((w) => w.length).join());
  const onDay = (w, off) => w.filter((m) => m.scheduled_date === addDays(m.week_date, off)).length;
  ok('four on the Monday and three on the Wednesday, then two and two', weeks.map((w) => `${onDay(w, 0)}/${onDay(w, 2)}`).join() === '4/3,4/3,4/3,4/3,4/3,2/2,2/2', weeks.map((w) => `${onDay(w, 0)}/${onDay(w, 2)}`).join());
  ok('every match is on one of the week\'s play days', rows.every((m) => [1, 3].includes(dow(m.scheduled_date)) && m.scheduled_date >= m.week_date && m.scheduled_date <= addDays(m.week_date, 6)));
  ok('the week\'s date is still its first day', L.weeks.every((w) => dow(w.date) === 1));
  ok('everyone plays exactly once a week', weeks.every((w) => { const seen = new Set(); return w.every((m) => !seen.has(m.player1_id) && !seen.has(m.player2_id) && seen.add(m.player1_id) && seen.add(m.player2_id)); }));
  ok('Division 1 is dealt first, so it fills the Monday', weeks.every((w) => w.filter((m) => m.scheduled_date === m.week_date).every((m) => m.level === 1)));
  ok('times and courts start again on each day', weeks.every((w) => ['19:00', '19:00'].join() === w.filter((m) => m.scheduled_date === addDays(m.week_date, 2)).slice(0, 2).map((m) => m.scheduled_time).join()));
  ok('the league page payload carries each match\'s day', L.weeks[0].matchups.flatMap((mu) => mu.matches).every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.scheduled_date)));

  console.log('EVERY READ TAKES THE DAY FROM THE MATCH');
  const wedMatch = rows.find((m) => m.week_number === 1 && m.scheduled_date === WED);
  const wedPlayer = client(app);
  await wedPlayer.login(`p${wedMatch.player1_id}@x.invalid`, 'pw123');
  const hist = await wedPlayer.get(`/api/players/${wedMatch.player1_id}/history`);
  const up = hist.upcoming.find((m) => m.id === wedMatch.id);
  ok('a player\'s upcoming match names its own day, not the week\'s', up && up.week_date === WED, JSON.stringify(up && [up.week_date, up.match_time]));
  const reportable = await wedPlayer.get('/api/my-matches/reportable');
  ok('so does the reportable list', reportable.find((m) => m.id === wedMatch.id)?.scheduled_date === WED);
  const card = await wedPlayer.get(`/api/matches/${wedMatch.id}/card`);
  ok('and the match card', card.scheduled_date === WED, JSON.stringify(card.scheduled_date));
  const list = await a.get('/api/leagues');
  const card2 = list.find((l) => l.id === twoDay);
  ok('the list carries the play days and the last day played', JSON.stringify(card2.play_days) === '[1,3]' && card2.last_night_date === addDays(card2.last_week_date, 2), JSON.stringify([card2.play_days, card2.last_week_date, card2.last_night_date]));
  const sched = await a.get(`/api/schedule?date=${WED}`);
  ok('the court grid shows the Wednesday matches on the Wednesday', sched.slots.filter((s) => String(s.id).startsWith('m_')).length === 3, String(sched.slots.length));

  console.log('THE ADMIN MOVES A MATCH');
  const monMatch = rows.find((m) => m.week_number === 1 && m.scheduled_date === MON && m.court_id === 1 && m.scheduled_time === '19:00');
  r = await a.send('PUT', `/api/matches/${wedMatch.id}/timing`, { matchTime: '19:00', courtId: 1 });
  ok('Wednesday 7pm on court 1 is fine even though Monday 7pm on court 1 is taken', r.status === 200, JSON.stringify(r.body));
  const other = rows.find((m) => m.week_number === 1 && m.scheduled_date === WED && m.id !== wedMatch.id);
  r = await a.send('PUT', `/api/matches/${other.id}/timing`, { matchTime: '19:00', courtId: 1 });
  ok('but a second match on the same day, court and time is refused', r.status === 409 && /that day/.test(r.body.error), JSON.stringify(r.body));
  ok('the Monday match was never in the way', !!monMatch);

  console.log('BLACKOUTS');
  const tue = addDays(MON, 8);
  r = await a.send('POST', '/api/leagues', payload({ name: 'Tuesday off', playDays: [1, 3], blackoutDates: [tue] }));
  ok('a blackout on a day the league does not play changes nothing', matchesOf(r.body).filter((m) => m.week_number === 2)[0].week_date === addDays(MON, 7));
  const wed2 = addDays(WED, 7);
  r = await a.send('POST', '/api/leagues', payload({ name: 'Wednesday off', playDays: [1, 3], blackoutDates: [wed2] }));
  const w2 = matchesOf(r.body).filter((m) => m.week_number === 2);
  ok('a blackout on the Wednesday skips the whole week, Monday included', w2.every((m) => m.week_date === addDays(MON, 14)) && w2.some((m) => m.scheduled_date === addDays(MON, 14)), w2[0]?.week_date);

  console.log('ORDER FOLLOWS THE START DAY');
  r = await a.send('POST', '/api/leagues', payload({ name: 'Wednesday start', startDate: WED, playDays: [1, 3, 5] }));
  const wl = await a.get(`/api/leagues/${r.body}`);
  ok('a Wednesday start with Mon, Wed and Fri plays Wed, Fri, then Mon', JSON.stringify(wl.play_days) === '[3,5,1]', JSON.stringify(wl.play_days));
  const wrows = matchesOf(r.body).filter((m) => m.week_number === 1);
  ok('and the week\'s Monday is the one after its Wednesday', wrows.some((m) => m.scheduled_date === addDays(WED, 5)) && wrows.every((m) => m.scheduled_date >= WED));

  console.log('WHAT IS REFUSED');
  r = await a.send('POST', '/api/leagues', payload({ name: 'Too many', playDays: [1, 2, 3, 4, 5] }));
  ok('more play days than the smallest week has matches is refused', r.status === 400 && /Too many play days/.test(r.body.error), JSON.stringify(r.body));
  r = await a.send('POST', '/api/leagues', payload({ name: 'Just enough', playDays: [1, 2, 3, 4] }));
  ok('as many days as the smallest week has matches is allowed', r.status === 200, JSON.stringify(r.body));
  ok('so no day is ever empty', matchesOf(r.body).length > 0 && (() => { const byDay = {}; matchesOf(r.body).forEach((m) => { byDay[m.scheduled_date] = (byDay[m.scheduled_date] || 0) + 1; }); return Object.values(byDay).every((n) => n >= 1) && Object.keys(byDay).length === 7 * 4; })());
  const { minWeeklyMatches } = require('../services/leagueService');
  ok('the rule counts the smallest week', minWeeklyMatches([8, 6]) === 4 && minWeeklyMatches([4, 4]) === 4 && minWeeklyMatches([5]) === 2);
  r = await a.send('POST', '/api/leagues', payload({ name: 'Bad day', playDays: [1, 9] }));
  ok('a weekday that is not one is refused', r.status === 400, JSON.stringify(r.body));
  r = await a.send('POST', '/api/leagues', {
    name: 'Teams', startDate: MON, setup_type: 'traditional', numTeams: 2, numDivisions: 3, numRounds: 1, blackoutDates: [], playDays: [1, 3],
    matchStartTime: '19:00', courtIds: [1, 2], matchDuration: 45, matchBuffer: 15, teamNames: [],
    rankedPlayers: ids(1, 6).map((id, i) => ({ playerId: id, rank: i + 1 })),
  });
  const teams = await a.get(`/api/leagues/${r.body}`);
  ok('a Teams league keeps one play day whatever it was sent', r.status === 200 && JSON.stringify(teams.play_days) === '[1]' && matchesOf(r.body).every((m) => m.scheduled_date === m.week_date), JSON.stringify(teams.play_days));

  console.log('ONE PLAY DAY IS TODAY\'S SCHEDULE');
  r = await a.send('POST', '/api/leagues', payload({ name: 'One day', playDays: [1] }));
  const one = matchesOf(r.body);
  r = await a.send('POST', '/api/leagues', payload({ name: 'No play days sent' }));
  const none = matchesOf(r.body);
  const shape = (ms) => ms.map((m) => `${m.week_number}:${m.scheduled_date === m.week_date ? 'W' : 'X'}:${m.scheduled_time}:${m.court_id}:${m.level}`).sort().join('|');
  ok('every match is on the week\'s date', one.every((m) => m.scheduled_date === m.week_date) && none.every((m) => m.scheduled_date === m.week_date));
  ok('with the same times, courts and divisions as a league that sent none', shape(one) === shape(none));
  const oneL = await a.get(`/api/leagues/${r.body}`);
  ok('and it reads as a one-day league', JSON.stringify(oneL.play_days) === '[1]');
  ok('a league from before play days existed reads as its start weekday', (() => {
    db.prepare("UPDATE leagues SET play_days = '[]' WHERE id = ?").run(r.body);
    return JSON.stringify(db.prepare('SELECT play_days FROM leagues WHERE id = ?').get(r.body).play_days) === '"[]"';
  })() && JSON.stringify((await a.get(`/api/leagues/${r.body}`)).play_days) === '[]');
});
