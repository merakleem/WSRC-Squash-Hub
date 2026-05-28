import { state, isAdmin } from '../state.js';
import { esc, toast, modal } from '../utils.js';

// ===== LADDER PAGE =====
export async function renderLadder() {
  document.getElementById('pageTitle').innerHTML = `Ladder <button class="info-bubble" id="btnLadderInfo" style="vertical-align:middle">i</button>`;
  document.getElementById('topbarActions').innerHTML = '';

  const [ladder, recordsArr] = await Promise.all([
    window.api.getLadder(),
    window.api.getPlayerRecords(),
  ]);
  state.ladder = ladder;
  const records = Array.isArray(recordsArr)
    ? Object.fromEntries(recordsArr.map((r) => [r.id, r]))
    : recordsArr;

  const content = document.getElementById('mainContent');

  if (ladder.length === 0) {
    content.innerHTML = `
      <div class="table-card">
        <div class="empty-state">
          <strong>No players yet</strong>
          <p>Add players on the Players page and they will appear here.</p>
        </div>
      </div>`;
    return;
  }

  const myId  = state.currentUser?.playerId;
  const playerInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const rankChangeBadge = (change) => {
    if (!change || change === 0) return '';
    if (change > 0) return `<span class="ldr-change ldr-change-up">↑${change}</span>`;
    return `<span class="ldr-change ldr-change-down">↓${Math.abs(change)}</span>`;
  };

  const allRowHTML = (p, rank) => {
    const rec   = records[p.id] || { wins: 0, losses: 0 };
    const total = rec.wins + rec.losses;
    const pct   = total > 0 ? Math.round(rec.wins / total * 100) : null;
    const isMe  = p.id === myId;
    return `
      <div class="ldr-all-row${isMe ? ' ldr-all-me' : ''}" data-action="view-profile" data-id="${p.id}">
        <span class="ldr-all-rank">${rank}</span>
        <div class="ldr-all-player">
          <div class="ldr-avatar ldr-avatar-sm">${playerInitials(p.name)}</div>
          <span class="ldr-all-name">${esc(p.name)}${isMe ? '<span class="ldr-you-chip">YOU</span>' : ''}</span>
          ${rankChangeBadge(p.rank_change)}
        </div>
        <span class="ldr-all-stat ldr-col-won">${rec.wins}</span>
        <span class="ldr-all-stat ldr-col-lost">${rec.losses}</span>
        <span class="ldr-all-stat ldr-col-played">${total}</span>
        <span class="ldr-all-stat ldr-col-winpct">${pct !== null ? pct + '%' : '—'}</span>
      </div>`;
  };

  content.innerHTML = `
    <div class="ldr-player-wrap" id="ladderList">
      <div class="ldr-section-block">
        <div class="ldr-all-table">
          <div class="ldr-all-header">
            <span class="ldr-all-rank">#</span>
            <span class="ldr-all-player">PLAYER</span>
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

  document.getElementById('btnLadderInfo')?.addEventListener('click', () => {
    modal.open('How the Ladder Works', `
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
