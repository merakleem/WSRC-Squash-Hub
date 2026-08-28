import { state } from '../state.js';
import { esc, toast, modal, avatarHTML } from '../utils.js';
import { openPickupGameModal } from './players.js';

// ===== REPORT A SCORE =====
// One page for every score a player might report. It replaces the two separate
// modals the dashboard used to offer - one for league matches, one for ladder
// matches - because from a player's point of view there was never a difference
// worth choosing between: they played someone, and the score needs recording.
//
// The list is every match of theirs that is not played yet. Below it sits the
// other case: a match that was played but does not exist in the system, which
// is what the Enter a Match modal already handles.

const _first = (n) => String(n || '').split(/\s+/)[0];

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let _rows = [];
let _busy = false;

function _when(m) {
  if (!m.scheduled_date) return null;
  const d = new Date(m.scheduled_date + 'T12:00:00');
  const date = `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}`;
  if (!m.scheduled_time) return date;
  const [h, mm] = m.scheduled_time.split(':').map(Number);
  return `${date} · ${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function _context(m) {
  if (m.type === 'ladder') return 'Ladder match';
  return [m.league_name, m.division_name, m.week_number ? `Week ${m.week_number}` : null]
    .filter(Boolean).join(' · ');
}

function _rowHTML(m) {
  const when = _when(m);
  return `
    <div class="rs-row" data-match="${m.id}">
      ${avatarHTML({ name: m.opponent_name, photo_path: m.opponent_photo }, 'rs-avatar')}
      <div class="rs-row-text">
        <span class="rs-row-opp">vs ${esc(m.opponent_name || 'TBD')}</span>
        <span class="rs-row-context">${esc(_context(m))}</span>
      </div>
      <span class="rs-row-when${when ? '' : ' rs-row-when--none'}">${when ? esc(when) : 'No time set'}</span>
      <button class="rs-row-btn" data-report="${m.id}">Report score</button>
    </div>`;
}

function _pageHTML() {
  const list = _rows.length
    ? `<div class="rs-list">${_rows.map(_rowHTML).join('')}</div>`
    : `<div class="rs-empty">
         <span class="rs-empty-title">Nothing waiting on you</span>
         <span class="rs-empty-sub">When a league or ladder match of yours needs a score, it will appear here.</span>
       </div>`;

  return `
    <div class="rs-page">
      <div class="rs-head">
        <h2 class="rs-title">Your matches awaiting a score</h2>
        <span class="rs-sub">League and ladder matches you are part of. Tournament scores are entered by the club.</span>
      </div>
      ${list}
      <div class="rs-divider">
        <span class="rs-rule"></span>
        <span class="rs-divider-text">Played a match that isn't listed?</span>
        <span class="rs-rule"></span>
      </div>
      <button class="rs-create" id="rsCreate">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        Create ladder match &amp; report score
      </button>
    </div>`;
}

// ── The score form ────────────────────────────────────────────────────────────
// Winner first, then how many games the loser took - the same two questions the
// Enter a Match modal asks, so the two flows read as one thing. There is no
// date field here: unlike Enter a Match, these matches already exist.
function _openForm(m) {
  let winner = null;   // 1 = me, 2 = opponent
  let games = null;    // games the loser took: 0 | 1 | 2

  const me = state.players?.find((p) => p.id === state.currentUser?.playerId);
  const meName = me?.name || 'You';
  const oppName = m.opponent_name || 'Opponent';

  const GAMES = [
    { g: 0, label: '3–0', sub: 'swept' },
    { g: 1, label: '3–1', sub: 'took one' },
    { g: 2, label: '3–2', sub: 'took two' },
  ];

  const render = () => {
    const complete = winner !== null && games !== null;
    const loserName = winner === 1 ? oppName : meName;
    const winnerName = winner === 1 ? meName : oppName;

    document.getElementById('modalBody').innerHTML = `
      <div class="rs-form">
        <div class="rs-form-section">
          <span class="rs-label">Who won?</span>
          <div class="rs-winners">
            ${[{ n: meName, side: 1, p: me }, { n: oppName, side: 2, p: { name: oppName, photo_path: m.opponent_photo } }].map((x) => `
              <button class="rs-winner${winner === x.side ? ' rs-winner--on' : ''}" data-side="${x.side}">
                ${avatarHTML(x.p || { name: x.n }, 'rs-winner-av')}
                <span class="rs-winner-name">${esc(x.n)}</span>
                ${winner === x.side ? '<svg class="rs-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
              </button>`).join('')}
          </div>
        </div>

        <div class="rs-form-section">
          <div class="rs-label-row">
            <span class="rs-label">Games</span>
            <span class="rs-hint">${winner === null ? 'Pick the winner first' : `How many did ${esc(_first(loserName))} take?`}</span>
          </div>
          <div class="rs-games${winner === null ? ' rs-games--off' : ''}">
            ${GAMES.map((x) => `
              <button class="rs-game${games === x.g ? ' rs-game--on' : ''}" data-games="${x.g}"${winner === null ? ' disabled' : ''}>
                <span class="rs-game-score">${x.label}</span>
                <span class="rs-game-sub">${x.sub}</span>
              </button>`).join('')}
          </div>
        </div>

        ${complete ? `
          <div class="rs-summary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            <span>${esc(winnerName)} beat ${esc(loserName)} 3–${games}</span>
          </div>` : ''}
      </div>
      <div class="rs-form-foot">
        <button class="rs-btn rs-btn--ghost" id="rsCancel">Cancel</button>
        <button class="rs-btn rs-btn--primary" id="rsSubmit"${complete && !_busy ? '' : ' disabled'}>${_busy ? 'Submitting…' : 'Submit score'}</button>
      </div>`;

    document.querySelectorAll('.rs-winner').forEach((b) => b.addEventListener('click', () => {
      winner = winner === Number(b.dataset.side) ? null : Number(b.dataset.side);
      render();
    }));
    document.querySelectorAll('.rs-game:not([disabled])').forEach((b) => b.addEventListener('click', () => {
      games = games === Number(b.dataset.games) ? null : Number(b.dataset.games);
      render();
    }));
    document.getElementById('rsCancel')?.addEventListener('click', () => modal.close());
    document.getElementById('rsSubmit')?.addEventListener('click', submit);
  };

  const submit = async () => {
    if (_busy || winner === null || games === null) return;
    _busy = true;
    render();
    try {
      const myScore  = winner === 1 ? 3 : games;
      const oppScore = winner === 1 ? games : 3;
      await window.api.reportMatchScore(m.id, { myScore, theirScore: oppScore });
      modal.close();
      toast('Score reported', 'success');
      await _load();
      _paint();
    } catch (e) {
      toast(e.message || 'Could not report that score.', 'error');
    } finally {
      _busy = false;
    }
  };

  modal.open('Report score', '', { medium: true });
  document.getElementById('modalTitle').innerHTML =
    `Report score<span class="rs-modal-sub">vs ${esc(oppName)} · ${esc(_context(m))}</span>`;
  render();
}

// ── Page ──────────────────────────────────────────────────────────────────────
async function _load() {
  try {
    _rows = await window.api.getReportable();
  } catch (_) {
    _rows = [];
  }
}

function _paint() {
  const content = document.querySelector('.content');
  if (!content) return;
  content.innerHTML = _pageHTML();

  content.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const m = _rows.find((r) => String(r.id) === b.dataset.report);
    if (m) _openForm(m);
  }));
  // The row itself opens the match card, so the page behaves like every other
  // list of matches in the app.
  content.querySelectorAll('.rs-row').forEach((row) => row.addEventListener('click', () => {
    window.openMatchCard(row.dataset.match);
  }));
  document.getElementById('rsCreate')?.addEventListener('click', () => openPickupGameModal());
}

export async function renderReportScore() {
  document.getElementById('pageTitle').textContent = 'Report a score';
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.querySelector('.content');
  content.classList.remove('content--dashboard', 'content--schedule', 'content--court-booking');
  content.innerHTML = '<div class="rs-page"><div class="modal-loading">Loading your matches…</div></div>';

  await _load();
  _paint();

  // Arriving from a match card's Submit score button opens that match directly.
  const target = state.reportMatchId;
  if (target != null) {
    state.reportMatchId = null;
    const m = _rows.find((r) => String(r.id) === String(target));
    if (m) _openForm(m);
    else toast('That match is no longer waiting on a score.', 'warning');
  }
}
