import { state, isAdmin } from '../state.js';
import { esc, toast, modal, avatarHTML } from '../utils.js';

// Which season the ladder is showing. null = the current season.
let _ladderSeason = null;

function _attachLadderSeasonTabs() {
  document.querySelectorAll('[data-ladder-season]').forEach((tab) => {
    tab.addEventListener('click', () => {
      // Selecting the current season returns to the live ladder rather than
      // pinning to its id; otherwise there is no way back to "today", and
      // state.ladder would stay frozen for the rest of the session.
      _ladderSeason = tab.dataset.ladderCurrent === '1' ? null : Number(tab.dataset.ladderSeason);
      renderLadder();
    });
  });
}

// Called when navigating to the Ladder from elsewhere, so a historical season
// left selected earlier doesn't silently persist across the session.
export function resetLadderSeason() {
  _ladderSeason = null;
}

// ===== LADDER PAGE =====
export async function renderLadder() {
  document.getElementById('pageTitle').innerHTML = `Ladder <button class="info-bubble" id="btnLadderInfo" style="vertical-align:middle">i</button>`;
  document.getElementById('topbarActions').innerHTML = '';

  const [ladderResult, recordsArr, seasons] = await Promise.all([
    window.api.getLadderForSeason(_ladderSeason),
    window.api.getPlayerRecords(),
    window.api.getSeasons().catch(() => []),
  ]);

  const ladder = ladderResult.rows || [];
  const isElo = ladderResult.system === 'elo';
  const season = ladderResult.season;
  // Only cache the live current-season ladder; other pages read state.ladder
  // expecting today's standings, not a historical snapshot.
  const viewingCurrent = !_ladderSeason || (season && season.is_current);
  if (viewingCurrent) state.ladder = ladder;

  const records = Array.isArray(recordsArr)
    ? Object.fromEntries(recordsArr.map((r) => [r.id, r]))
    : recordsArr;

  const content = document.getElementById('mainContent');

  const seasonBarHTML = seasons.length < 2 ? '' : `
    <div class="season-tabs" id="ladderSeasonTabs">
      ${seasons.map((s) => `
        <button class="season-tab${season && s.id === season.id ? ' active' : ''}" data-ladder-season="${s.id}" data-ladder-current="${s.is_current ? 1 : 0}">
          ${esc(s.name)}${s.is_current ? '' : s.status === 'ended' ? ' <span class="ldr-frozen-dot" title="Final standings">●</span>' : ''}
        </button>`).join('')}
    </div>`;

  const contextHTML = !season ? '' : `
    <div class="ldr-context">
      <span class="ldr-context-system">${isElo ? 'Rating ladder' : 'Position ladder'}</span>
      ${ladderResult.frozen
        ? `<span class="ldr-context-frozen">Final standings. This season has ended and no longer changes</span>`
        : `<span class="ldr-context-live">Updates as matches are reported</span>`}
    </div>`;

  if (ladder.length === 0) {
    content.innerHTML = `
      ${seasonBarHTML}
      ${contextHTML}
      <div class="table-card">
        <div class="empty-state">
          <strong>No standings yet</strong>
          <p>${season ? `No matches have been played in ${esc(season.name)} yet.` : 'Add players on the Players page and they will appear here.'}</p>
        </div>
      </div>`;
    _attachLadderSeasonTabs();
    return;
  }

  const myId  = state.currentUser?.playerId;

  const rankChangeBadge = (change) => {
    if (!change || change === 0) return '';
    if (change > 0) return `<span class="ldr-change ldr-change-up">↑${change}</span>`;
    return `<span class="ldr-change ldr-change-down">↓${Math.abs(change)}</span>`;
  };

  // In a rating season the W/L shown are that season's, not career totals, so
  // the numbers agree with the rating beside them.
  const recordFor = (p) => (isElo
    ? { wins: p.season_wins || 0, losses: p.season_losses || 0 }
    : (records[p.id] || { wins: 0, losses: 0 }));

  // Movement is shown as places gained or lost beside the name, the same as the
  // positional ladder. The rating column carries the number only.
  const ratingCell = (p) => {
    if (!isElo) return '';
    const idle = p.inactive_months > 0
      ? `<span class="ldr-idle" title="${p.inactive_months} month${p.inactive_months === 1 ? '' : 's'} without a match: −${p.inactivity_penalty}">idle</span>`
      : '';
    return `<span class="ldr-all-stat ldr-col-rating">${p.rating ?? '—'}${idle}</span>`;
  };

  const allRowHTML = (p, rank) => {
    const rec   = recordFor(p);
    const total = rec.wins + rec.losses;
    const pct   = total > 0 ? Math.round(rec.wins / total * 100) : null;
    const isMe  = p.id === myId;
    return `
      <div class="ldr-all-row${isMe ? ' ldr-all-me' : ''}${isElo ? ' ldr-row-elo' : ''}" data-action="view-profile" data-id="${p.id}">
        <span class="ldr-all-rank">${rank}</span>
        <div class="ldr-all-player">
          ${avatarHTML(p, 'ldr-avatar ldr-avatar-sm')}
          <span class="ldr-all-name">${esc(p.name)}${isMe ? '<span class="ldr-you-chip">YOU</span>' : ''}</span>
          ${ladderResult.frozen ? '' : rankChangeBadge(p.rank_change)}
        </div>
        ${ratingCell(p)}
        <span class="ldr-all-stat ldr-col-won">${rec.wins}</span>
        <span class="ldr-all-stat ldr-col-lost">${rec.losses}</span>
        <span class="ldr-all-stat ldr-col-played">${total}</span>
        <span class="ldr-all-stat ldr-col-winpct">${pct !== null ? pct + '%' : '—'}</span>
      </div>`;
  };

  content.innerHTML = `
    ${seasonBarHTML}
    ${contextHTML}
    <div class="ldr-player-wrap" id="ladderList">
      <div class="ldr-section-block">
        <div class="ldr-all-table">
          <div class="ldr-all-header${isElo ? ' ldr-row-elo' : ''}">
            <span class="ldr-all-rank">#</span>
            <span class="ldr-all-player">PLAYER</span>
            ${isElo ? '<span class="ldr-all-stat ldr-col-rating">RATING</span>' : ''}
            <span class="ldr-all-stat ldr-col-won"><span class="ldr-col-long">WON</span><span class="ldr-col-short">W</span></span>
            <span class="ldr-all-stat ldr-col-lost"><span class="ldr-col-long">LOST</span><span class="ldr-col-short">L</span></span>
            <span class="ldr-all-stat ldr-col-played">PLAYED</span>
            <span class="ldr-all-stat ldr-col-winpct">WIN %</span>
          </div>
          ${ladder.map((p, i) => allRowHTML(p, i + 1)).join('')}
        </div>
      </div>
    </div>`;

  document.getElementById('ladderList').addEventListener('click', (e) => {
    const el = e.target.closest('[data-action="view-profile"]');
    if (el) window.openPlayerProfile(Number(el.dataset.id));
  });

  _attachLadderSeasonTabs();

  document.getElementById('btnLadderInfo')?.addEventListener('click', () => {
    modal.open('How the Ladder Works', isElo ? `
      <div class="info-modal-section">
        <h4>Every match moves your rating</h4>
        <p>You gain rating points for a win and lose them for a defeat. The winner gains exactly what the loser gives up, so the ladder never inflates.</p>
      </div>
      <div class="info-modal-section">
        <h4>Who you beat matters</h4>
        <p>Beating someone rated well above you is worth a lot. Beating someone well below you is worth very little, and losing to them costs you a lot. Evenly matched games move both players by a moderate amount either way.</p>
      </div>
      <div class="info-modal-section">
        <h4>Playing more helps</h4>
        <p>Unlike the old ladder, every match counts, not just wins against players above you. The more you play, the more your rating reflects your real standing.</p>
      </div>
      <div class="info-modal-section">
        <h4>Inactivity</h4>
        <p>After a full month without a match your rating starts to ease down, and continues each month you don't play. Play a match and it stops immediately. After six months without playing you're hidden from the ladder until you return.</p>
      </div>
      <div class="info-modal-section">
        <h4>Starting rating</h4>
        <p>Players carried over from the previous season started at a rating based on where they finished it. New members start from their Club Locker rating.</p>
      </div>` : `
      <div class="info-modal-section">
        <h4>Starting positions</h4>
        <p>Players are initially ranked based on their Club Locker rating. Players without a rating are placed at the bottom.</p>
      </div>
      <div class="info-modal-section">
        <h4>Moving up</h4>
        <p>Beat a player ranked above you and you jump straight to their position. They drop one spot, and everyone between you shifts down to fill the gap. Win an upset and you climb immediately.</p>
      </div>
      <div class="info-modal-section">
        <h4>No change</h4>
        <p>Beating someone already ranked below you doesn't move anyone. Positions only shift when a lower-ranked player wins.</p>
      </div>
      <div class="info-modal-section">
        <h4>What counts</h4>
        <p>All recorded matches count. League matches and ladder matches reported through Quick Actions.</p>
      </div>`);
  });
}
