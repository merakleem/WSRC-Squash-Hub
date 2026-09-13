// ===== REPORT SCORE MODAL (player) =====
// The quick modal for a player to report one of their unscored matches. The
// full-page version is pages/reportScore.js. Split from players.js.

import { state } from '../state.js';
import { esc, toast, modal } from '../utils.js';

export async function openReportScoreModal() {
  const playerId = state.currentUser?.playerId;
  if (!playerId) return;

  modal.open('Report a Score', '<div class="modal-loading">Loading matches…</div>');

  const playerData = await fetch(`/api/players/${playerId}/history`).then((r) => r.json());
  const upcoming = playerData.upcoming || [];

  function fmtDate(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function showMatchList() {
    if (upcoming.length === 0) {
      document.getElementById('modalBody').innerHTML =
        '<div class="rsc-empty">You have no unscored matches to report.</div>';
      return;
    }
    document.getElementById('modalBody').innerHTML = `
      <p class="rsc-instructions">Select the match you want to report a score for.</p>
      <div class="rsc-match-list">
        ${upcoming.map((m) => {
          const isTbd = m.opponent_name === 'TBD';
          return `
          <button class="rsc-match-item${isTbd ? ' rsc-match-item--tbd' : ''}" data-match-id="${m.id}" data-source="${m.source || 'league'}" data-opponent="${esc(m.opponent_name)}" ${isTbd ? 'disabled' : ''}>
            <div class="rsc-match-opp">vs ${esc(m.opponent_name)}${isTbd ? ' <span class="rsc-tbd-note">(opponent not yet determined)</span>' : ''}</div>
            <div class="rsc-match-meta">${esc(m.league_name)}${m.division_name ? ' · ' + esc(m.division_name) : ''} &nbsp;·&nbsp; ${fmtDate(m.week_date)}</div>
          </button>`;
        }).join('')}
      </div>`;
    document.getElementById('modalBody').querySelectorAll('.rsc-match-item').forEach((btn) => {
      btn.addEventListener('click', () => showScoreForm(btn.dataset.matchId, btn.dataset.opponent, btn.dataset.source));
    });
  }

  function showScoreForm(matchId, opponentName, source) {
    document.getElementById('modalBody').innerHTML = `
      <button class="rsc-back-btn" id="rscBack">← Back</button>
      <div class="rsc-matchup-header">
        <span class="rsc-you">${esc(playerData.name)}</span>
        <span class="rsc-vs">vs</span>
        <span class="rsc-opp">${esc(opponentName)}</span>
      </div>
      <div class="rsc-score-form">
        <div class="rsc-score-side">
          <div class="rsc-score-label">Your Score</div>
          <input id="rscMyScore" class="rsc-score-input" type="number" min="0" max="3" placeholder="0">
        </div>
        <div class="rsc-score-sep">–</div>
        <div class="rsc-score-side">
          <div class="rsc-score-label">Their Score</div>
          <input id="rscTheirScore" class="rsc-score-input" type="number" min="0" max="3" placeholder="0">
        </div>
      </div>
      <button class="btn btn-primary rsc-submit-btn" id="rscSubmit">Submit Score</button>`;

    document.getElementById('rscBack').addEventListener('click', showMatchList);

    document.getElementById('rscSubmit').addEventListener('click', async () => {
      const myScore    = Number(document.getElementById('rscMyScore').value);
      const theirScore = Number(document.getElementById('rscTheirScore').value);

      const valid = Number.isInteger(myScore) && Number.isInteger(theirScore)
        && myScore >= 0 && myScore <= 3 && theirScore >= 0 && theirScore <= 3
        && (myScore === 3 || theirScore === 3) && myScore !== theirScore;

      if (!valid) {
        toast('Invalid score. One player must win 3 games (e.g. 3–1, 3–2)', 'warning');
        return;
      }

      const submitBtn = document.getElementById('rscSubmit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
      try {
        if (source === 'tournament') {
          const rawId = Number(String(matchId).replace('t_', ''));
          await window.api.reportTournamentPlayerScore(rawId, { myScore, theirScore });
        } else {
          await window.api.reportPlayerScore({ matchId: Number(matchId), myScore, theirScore });
        }
        toast('Score submitted successfully!', 'success');
        modal.close();
        if (state.page === 'dashboard') window.renderDashboard();
      } catch (err) {
        toast(err.message || 'Failed to submit score', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Score';
      }
    });
  }

  showMatchList();
}

window.openReportScoreModal = openReportScoreModal;
