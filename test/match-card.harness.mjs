// Drives the match card and the Report Score page in a real DOM (linkedom)
// against realistic API payloads. Run from a directory that has linkedom:
//   mkdir -p /tmp/h && cd /tmp/h && npm i linkedom && node <repo>/test/match-card.harness.mjs
import { readFileSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { parseHTML } from 'linkedom';

const REPO = '/Users/meraklee/Desktop/Codebases/Squash Management System';
const HERE = new URL('.', import.meta.url).pathname;

const { window } = parseHTML(`<!doctype html><html><body>
  <div id="pageTitle"></div><div id="topbarActions"></div>
  <main class="content" id="mainContent"></main>
  <div id="modalOverlay"><div id="modal"><div id="modalTitle"></div><div id="modalBody"></div><button id="modalClose"></button></div></div>
  <div id="toastContainer"></div>
</body></html>`);
globalThis.document = window.document;
globalThis.window = window;
window.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = (fn) => fn();
window.requestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
window.sessionStorage = globalThis.sessionStorage;
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

const ME = 7;
const calls = [];
const CARDS = {
  // played, with deltas and a history
  100: {
    id: 100, type: 'league', status: 'played', score: '3–1',
    players: [
      { id: 9, name: 'Sofia Duarte', position: 4, rating: 1512, won: true, is_viewer: false, rating_change: 7 },
      { id: ME, name: 'James Whitfield', position: 11, rating: 1391, won: false, is_viewer: true, rating_change: -7 },
    ],
    played_at: '2026-08-26 19:30:00', league_name: 'Autumn League', division_name: 'Division 2', week_number: 3,
    head_to_head: { aWins: 4, bWins: 2, total: 6, meetings: [
      { id: 100, played_at: '2026-08-26', winner_id: 9, score: '3–1' },
      { id: 91,  played_at: '2026-06-12', winner_id: ME, score: '3–2' },
    ] },
    can_submit_score: false,
  },
  // scheduled, mine → submit offered
  101: {
    id: 101, type: 'league', status: 'scheduled',
    players: [
      { id: ME, name: 'James Whitfield', position: 11, rating: 1391, is_viewer: true },
      { id: 11, name: 'Priya Raman', position: 6, rating: 1467, is_viewer: false },
    ],
    scheduled_date: '2026-09-02', scheduled_time: '19:00', court_name: 'Court 2',
    league_name: 'Autumn League', division_name: 'Division 2', week_number: 4,
    head_to_head: { aWins: 1, bWins: 1, total: 2, meetings: [{ id: 5, played_at: '2026-05-22', winner_id: 11, score: '3–2' }] },
    can_submit_score: true,
  },
  // unscheduled tournament, first meeting, null ladder position
  102: {
    id: 102, type: 'tournament', status: 'unscheduled',
    players: [
      { id: 11, name: 'Priya Raman', position: 6, rating: 1467, is_viewer: false },
      { id: 12, name: 'Callum Reid', position: null, rating: null, is_viewer: false },
    ],
    tournament_name: 'Club Championship', round: 'quarterfinal',
    head_to_head: { aWins: 0, bWins: 0, total: 0, meetings: [] },
    can_submit_score: false,
  },
  // ladder match, mine, not played
  103: {
    id: 103, type: 'ladder', status: 'unscheduled',
    players: [
      { id: ME, name: 'James Whitfield', position: 11, rating: 1391, is_viewer: true },
      { id: 9, name: 'Sofia Duarte', position: 4, rating: 1512, is_viewer: false },
    ],
    head_to_head: { aWins: 0, bWins: 1, total: 1, meetings: [{ id: 4, played_at: '2026-03-01', winner_id: 9, score: '3–0' }] },
    can_submit_score: true,
  },
};
const REPORTABLE = [
  { id: 101, type: 'league', status: 'scheduled', scheduled_date: '2026-09-02', scheduled_time: '19:00',
    opponent_id: 11, opponent_name: 'Priya Raman', league_name: 'Autumn League', division_name: 'Division 2', week_number: 4 },
  { id: 103, type: 'ladder', status: 'unscheduled', scheduled_date: null, scheduled_time: null,
    opponent_id: 9, opponent_name: 'Sofia Duarte' },
];
window.api = {
  getMatchCard: async (id) => { calls.push(['getMatchCard', String(id)]); return CARDS[Number(id)] || null; },
  getReportable: async () => { calls.push(['getReportable']); return REPORTABLE.filter(r => !r._done); },
  reportMatchScore: async (id, d) => { calls.push(['reportMatchScore', id, d]); REPORTABLE.find(r => r.id === Number(id))._done = true; return { ok: true }; },
  getPlayers: async () => [{ id: ME, name: 'James Whitfield' }],
};
window.openPlayerProfile = (id) => calls.push(['openPlayerProfile', id]);
window.navigate = (p, params) => calls.push(['navigate', p, params]);

for (const [src, dst] of [
  ['renderer/state.js', 'state.mjs'],
  ['renderer/utils.js', 'utils.mjs'],
  ['renderer/matchCard.js', 'matchCard.mjs'],
  ['renderer/pages/reportScore.js', 'reportScore.mjs'],
]) {
  let code = readFileSync(`${REPO}/${src}`, 'utf8');
  code = code.replace(/'\.\.?\/state\.js'/, "'./state.mjs'").replace(/'\.\.?\/utils\.js'/, "'./utils.mjs'")
             .replace("'./players.js'", "'./players-stub.mjs'");
  writeFileSync(`${HERE}${dst}`, code);
}
writeFileSync(`${HERE}players-stub.mjs`, 'export function openPickupGameModal(){ globalThis.__pickupOpened = true; }\n');

const { state } = await import(pathToFileURL(`${HERE}state.mjs`).href);
const card = await import(pathToFileURL(`${HERE}matchCard.mjs`).href);
const rs = await import(pathToFileURL(`${HERE}reportScore.mjs`).href);
window.openMatchCard = card.openMatchCard;

state.currentUser = { playerId: ME, role: 'player' };
state.players = [{ id: ME, name: 'James Whitfield' }];

let failed = 0;
const ok = (l, c, e = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${e ? '  ' + e : ''}`); if (!c) failed++; };
const $  = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const settle = () => new Promise(r => setTimeout(r, 10));

console.log('\nMATCH CARD — played');
await card.openMatchCard(100); await settle();
ok('the photo band carries the competition', $('.mc-kicker')?.textContent === 'Autumn League · Division 2 · Week 3');
ok('both players are shown', $$('.mc-name').map(e => e.textContent).join('|') === 'Sofia Duarte|James Whitfield');
ok('ladder position and rating in the meta', $('.mc-meta')?.textContent === '#4 on ladder · 1512');
ok('the score replaces VS', $('.mc-score')?.textContent === '3–1' && !$('.mc-vs'));
ok('and is marked final', $('.mc-final')?.textContent === 'Final');
ok('the winner is named', $$('.mc-winner').length === 1);
ok('rating changes show with sign', $$('.mc-delta').map(e => e.textContent).join(' ') === '+7 −7', $$('.mc-delta').map(e=>e.textContent).join(' '));
ok('the strip says when it was played', /^Played Wednesday, August 26$/.test($('.mc-strip-title')?.textContent || ''), $('.mc-strip-title')?.textContent);
ok('the signed-in player gets the you ring', $('.mc-avatar--you') !== null);
ok('head to head names the leader', $('.mc-h2h-lead')?.textContent === 'Sofia leads 4–2');
ok('the bar is proportioned to the record', $('.mc-bar-fill')?.getAttribute('style') === 'width:66.66666666666666%');
ok('past meetings are listed', $$('.mc-meeting').length === 2);
ok('a meeting names its winner', $('.mc-meeting-who')?.textContent === 'Sofia Duarte');
ok('no submit button on a played match', !$('#mcSubmit'));
ok('the band carries a close button', !!$('#mcClose'));
click($('#mcClose'));
ok('and closing it hides the overlay', !document.getElementById('modalOverlay').classList.contains('open'));

console.log('\nMATCH CARD — scheduled, and mine');
await card.openMatchCard(101); await settle();
ok('the strip shows date, time', $('.mc-strip-title')?.textContent === 'Wednesday, September 2 · 7:00 PM');
ok('and the court', $('.mc-strip-sub')?.textContent === 'Court 2');
ok('it uses the scheduled treatment', $('.mc-strip')?.classList.contains('mc-strip--scheduled'));
ok('VS replaces the score', $('.mc-vs')?.textContent === 'VS' && !$('.mc-score'));
ok('a level record reads as level', $('.mc-h2h-lead')?.textContent === 'Level 1–1');
ok('submit score is offered', !!$('#mcSubmit'));
calls.length = 0;
click($('#mcSubmit'));
ok('submit hands over to the report page with the match', 
  JSON.stringify(calls.find(c => c[0] === 'navigate')) === JSON.stringify(['navigate','reportScore',{matchId:101}]),
  JSON.stringify(calls));

console.log('\nMATCH CARD — unscheduled tournament, first meeting');
await card.openMatchCard(102); await settle();
ok('kicker names the round', $('.mc-kicker')?.textContent === 'Club Championship · Quarterfinal');
ok('the strip says it is not scheduled', $('.mc-strip-title')?.textContent === 'Not yet scheduled');
ok('with an explanation', $('.mc-strip-sub')?.textContent === 'No court or time set for this match.');
ok('a player off the ladder is stated plainly', $$('.mc-meta')[1]?.textContent === 'Not on ladder yet');
ok('first meeting replaces the bar and list', !$('.mc-bar') && !$('.mc-meetings') && !!$('.mc-h2h-empty'));
ok('and says so', /never played/.test($('.mc-h2h-empty')?.textContent || ''));
ok('a tournament never offers submit', !$('#mcSubmit'));

console.log('\nMATCH CARD — ladder');
await card.openMatchCard(103); await settle();
ok('kicker reads Ladder match', $('.mc-kicker')?.textContent === 'Ladder match');
ok('a ladder match of mine offers submit', !!$('#mcSubmit'));
calls.length = 0;
click($('.mc-name'));
ok('a name opens that profile', calls.some(c => c[0] === 'openPlayerProfile' && c[1] === ME));

console.log('\nMATCH CARD — prefixed ids');
calls.length = 0;
await card.openMatchCard('m_100'); await settle();
ok('a schedule-style id is stripped before fetching', calls.some(c => c[0] === 'getMatchCard' && c[1] === '100'));

console.log('\nREPORT SCORE — the page');
await rs.renderReportScore(); await settle();
ok('the page titles itself', document.getElementById('pageTitle').textContent === 'Report a score');
ok('one row per match awaiting a score', $$('.rs-row').length === 2);
ok('a row names the opponent', $('.rs-row-opp')?.textContent === 'vs Priya Raman');
ok('and its competition', $('.rs-row-context')?.textContent === 'Autumn League · Division 2 · Week 4');
ok('a scheduled match shows when', $('.rs-row-when')?.textContent === 'Wed Sep 2 · 7:00 PM');
ok('an undated one says so', $$('.rs-row-when')[1]?.textContent === 'No time set');
ok('and is marked as having no time', $$('.rs-row-when')[1]?.classList.contains('rs-row-when--none'));
ok('a ladder row reads Ladder match', $$('.rs-row-context')[1]?.textContent === 'Ladder match');
ok('the create-a-ladder-match button is present', !!$('#rsCreate'));
click($('#rsCreate'));
ok('it opens the enter-a-match modal', globalThis.__pickupOpened === true);

console.log('\nREPORT SCORE — the form');
click($$('.rs-row-btn')[0]); await settle();
ok('the form opens on that match', $$('.rs-winner').length === 2);
ok('games are disabled until a winner is picked', $$('.rs-game').every(b => b.disabled));
ok('and it says so', $('.rs-hint')?.textContent === 'Pick the winner first');
ok('submit is disabled', $('#rsSubmit')?.disabled === true);
click($$('.rs-winner')[0]);
ok('picking a winner marks that card', $$('.rs-winner')[0].classList.contains('rs-winner--on'));
ok('games become available', $$('.rs-game').every(b => !b.disabled));
ok('the hint names the loser', $('.rs-hint')?.textContent === 'How many did Priya take?', $('.rs-hint')?.textContent);
ok('3–0 is offered as a real option', $$('.rs-game-score').map(e => e.textContent).join(' ') === '3–0 3–1 3–2');
click($$('.rs-game')[0]);   // 3-0: the games count is 0, which must still count as chosen
ok('a clean sweep completes the form', $('#rsSubmit')?.disabled === false);
ok('the summary reads it back', /beat Priya Raman 3–0/.test($('.rs-summary')?.textContent || ''), $('.rs-summary')?.textContent.trim());
calls.length = 0;
click($('#rsSubmit')); await settle();
const sent = calls.find(c => c[0] === 'reportMatchScore');
ok('it sends my score and theirs', sent && sent[1] === 101 && sent[2].myScore === 3 && sent[2].theirScore === 0, JSON.stringify(sent));
ok('the list reloads afterwards', calls.filter(c => c[0] === 'getReportable').length >= 1);
ok('and the reported match is gone', $$('.rs-row').length === 1);

console.log('\nREPORT SCORE — arriving from a card');
state.reportMatchId = 103;
await rs.renderReportScore(); await settle();
ok('the named match opens straight into its form', $$('.rs-winner').length === 2);
ok('showing that opponent', /Sofia Duarte/.test($('#modalTitle')?.textContent || ''), $('#modalTitle')?.textContent);

console.log('\nREPORT SCORE — empty');
REPORTABLE.forEach(r => { r._done = true; });
state.reportMatchId = null;
await rs.renderReportScore(); await settle();
ok('the empty state replaces the list', !$('.rs-row') && !!$('.rs-empty'));
ok('with a heading', $('.rs-empty-title')?.textContent === 'Nothing waiting on you');
ok('the create button remains', !!$('#rsCreate'));

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
process.exit(failed ? 1 : 0);
