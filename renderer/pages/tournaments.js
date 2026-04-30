import { state, isAdmin } from '../state.js';
import { esc, toast, modal } from '../utils.js';

// ===== TOURNAMENTS =====

function _trFmtDate(dateStr) {
  if (!dateStr) return '';
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function _trFmtShort(dateStr) {
  if (!dateStr) return '';
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function _trFmtTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const suf = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suf}` : `${h12}:${String(m).padStart(2,'0')}${suf}`;
}
function _trRoundLabel(round) {
  return { group:'Group Stage', quarterfinal:'Quarterfinal', semifinal:'Semifinal', final:'Final' }[round] || round;
}
function _trStatusLabel(status) {
  if (status === 'group_stage') return { label: 'Group Stage', cls: 'tr-badge--active' };
  if (status === 'knockout')    return { label: 'Knockout', cls: 'tr-badge--active' };
  if (status === 'completed')   return { label: 'Completed', cls: 'tr-badge--done' };
  return { label: status, cls: '' };
}
function _trScObj(m) {
  return m.scores ? JSON.parse(m.scores) : null;
}
function _trSatDate(champDate) {
  if (!champDate) return '';
  const [y, mo, d] = champDate.split('-').map(Number);
  const sat = new Date(Date.UTC(y, mo - 1, d - 1));
  return `${sat.getUTCFullYear()}-${String(sat.getUTCMonth()+1).padStart(2,'0')}-${String(sat.getUTCDate()).padStart(2,'0')}`;
}

// ─── Tournament List ───────────────────────────────────────────────────────────

export async function renderTournaments() {
  document.getElementById('pageTitle').textContent = 'Tournaments';
  document.getElementById('topbarActions').innerHTML = isAdmin()
    ? `<button class="btn btn-primary" id="btnNewTournament">+ New Tournament</button>` : '';

  const content = document.getElementById('mainContent');
  content.innerHTML = `<div class="tr-page-loading">Loading…</div>`;

  const tournaments = await window.api.getTournaments();

  if (isAdmin()) {
    document.getElementById('btnNewTournament')?.addEventListener('click', () => window.navigate('createTournament'));
  }

  if (!tournaments.length) {
    content.innerHTML = `<div class="table-card"><div class="empty-state"><strong>No tournaments yet</strong><p>${isAdmin() ? 'Create your first tournament to get started.' : 'No tournaments have been created yet.'}</p></div></div>`;
    return;
  }

  const active = tournaments.filter(t => t.status !== 'completed');
  const past   = tournaments.filter(t => t.status === 'completed');

  function cardHTML(t) {
    const { label, cls } = _trStatusLabel(t.status);
    const badgeCls = cls === 'tr-badge--active' ? 'badge-active' : 'badge-completed';
    return `<div class="league-card" data-id="${t.id}">
      <div class="league-card-header">
        <h3>${esc(t.name)}</h3>
        <span class="badge ${badgeCls}">${label}</span>
      </div>
      <div class="league-card-meta">
        <div class="meta-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
          Championship: ${_trFmtDate(t.championship_date)}
        </div>
      </div>
      <div class="league-card-footer">
        <button class="btn btn-primary btn-sm" data-action="view" data-id="${t.id}">View Tournament</button>
      </div>
    </div>`;
  }

  let html = '';
  if (active.length) html += `<div class="leagues-section-label">Active</div><div class="league-grid">${active.map(cardHTML).join('')}</div>`;
  if (past.length)   html += `<div class="leagues-section-label${active.length ? ' leagues-section-label--gap' : ''}">Past</div><div class="league-grid">${past.map(cardHTML).join('')}</div>`;
  content.innerHTML = html;

  content.querySelectorAll('.league-card').forEach(el => {
    el.addEventListener('click', () => window.navigate('tournamentDetail', { tournamentId: Number(el.dataset.id) }));
  });
}

// ─── Tournament Detail ─────────────────────────────────────────────────────────

export async function renderTournamentDetail() {
  const id = state.currentTournamentId;
  document.getElementById('pageTitle').textContent = 'Tournament';
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.getElementById('mainContent');
  content.innerHTML = `<div class="tr-page-loading">Loading…</div>`;

  const t = await window.api.getTournament(id);
  document.getElementById('pageTitle').textContent = t.name;

  if (isAdmin()) {
    document.getElementById('topbarActions').innerHTML =
      `<button class="btn btn-danger" id="btnDeleteTourn">Delete</button>`;
    document.getElementById('btnDeleteTourn').addEventListener('click', async () => {
      if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
      await window.api.deleteTournament(id);
      toast('Tournament deleted.', 'success');
      window.navigate('tournaments');
    });
  }

  const playerMap = new Map(t.players.map(p => [p.player_id, p]));
  const groupMatchesByGroupId = {};
  const bracketMatches = {};
  for (const m of t.matches) {
    if (m.round === 'group') {
      if (!groupMatchesByGroupId[m.group_id]) groupMatchesByGroupId[m.group_id] = [];
      groupMatchesByGroupId[m.group_id].push(m);
    } else {
      bracketMatches[m.bracket_slot] = m;
    }
  }

  // Local standings calc (uses new {p1,p2} score format)
  function calcStandings(groupId) {
    const gPlayers = t.players.filter(p => p.group_id === groupId);
    const gMatches = groupMatchesByGroupId[groupId] || [];
    const stats = {};
    for (const p of gPlayers) stats[p.player_id] = { ...p, wins: 0, losses: 0, sw: 0, sl: 0, played: 0 };
    for (const m of gMatches) {
      if (!m.winner_id) continue;
      const sc = _trScObj(m);
      const p1s = sc ? (sc.p1 || 0) : 0, p2s = sc ? (sc.p2 || 0) : 0;
      if (stats[m.player1_id]) { stats[m.player1_id].sw += p1s; stats[m.player1_id].sl += p2s; stats[m.player1_id].played++; }
      if (stats[m.player2_id]) { stats[m.player2_id].sw += p2s; stats[m.player2_id].sl += p1s; stats[m.player2_id].played++; }
      if (m.winner_id === m.player1_id) { if (stats[m.player1_id]) stats[m.player1_id].wins++; if (stats[m.player2_id]) stats[m.player2_id].losses++; }
      else { if (stats[m.player2_id]) stats[m.player2_id].wins++; if (stats[m.player1_id]) stats[m.player1_id].losses++; }
    }
    return Object.values(stats).sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if ((b.sw - b.sl) !== (a.sw - a.sl)) return (b.sw - b.sl) - (a.sw - a.sl);
      return (a.ladder_position || 9999) - (b.ladder_position || 9999);
    }).map((s, i) => ({ ...s, rank: i + 1 }));
  }

  // Group tab HTML
  function groupCardHTML(g) {
    const standings = calcStandings(g.id);
    const gMatches = groupMatchesByGroupId[g.id] || [];
    const played = gMatches.filter(m => m.winner_id).length;
    const total = gMatches.length;

    const standingsHTML = standings.map((s, i) => {
      const isAdvancing = i < 2;
      return `<div class="tr-standing-row${isAdvancing ? ' tr-standing-advance' : ''}">
        <span class="tr-standing-pos">${i + 1}</span>
        <span class="tr-standing-name">${esc(s.player_name)}</span>
        <span class="tr-standing-wl">${s.wins}–${s.losses}</span>
        <span class="tr-standing-sets">${s.sw > 0 || s.sl > 0 ? `${s.sw}–${s.sl}` : '—'}</span>
        ${isAdvancing ? '<span class="tr-advance-dot" title="Advances to knockout"></span>' : '<span></span>'}
      </div>`;
    }).join('');

    const matchRowsHTML = gMatches.map(m => {
      const sc = _trScObj(m);
      const p1s = sc ? sc.p1 : null, p2s = sc ? sc.p2 : null;
      const hasScore = m.winner_id != null;
      const p1win = m.winner_id === m.player1_id;
      const scoreHTML = hasScore
        ? `<span class="tr-match-score-pill tr-score-p1">${p1s}–${p2s}</span>`
        : `<span class="tr-match-score-pill tr-score-pending">vs</span>`;
      const timeStr = m.match_date ? `${_trFmtShort(m.match_date)}${m.match_time ? ' · '+_trFmtTime(m.match_time) : ''}` : '';
      const myId = state.currentUser?.playerId;
      const isMyMatch = myId && (m.player1_id === myId || m.player2_id === myId);
      const canScore = m.player1_id && m.player2_id && (isAdmin() || (isMyMatch && !hasScore));
      const scoreBtn = canScore
        ? `<button class="tr-score-btn" data-match-id="${m.id}">${isAdmin() && hasScore ? 'Edit' : 'Score'}</button>` : '';
      return `<div class="tr-match-row">
        <div class="tr-match-names">
          <span class="${p1win && hasScore ? 'tr-match-winner' : ''}">${esc(m.p1_name || '?')}</span>
          ${scoreHTML}
          <span class="${!p1win && hasScore ? 'tr-match-winner' : ''}">${esc(m.p2_name || '?')}</span>
        </div>
        <div class="tr-match-row-right">
          ${timeStr ? `<span class="tr-match-time-info">${timeStr}</span>` : ''}
          ${scoreBtn}
        </div>
      </div>`;
    }).join('');

    return `<div class="tr-group-card">
      <div class="tr-group-header">
        <span class="tr-group-name">Group ${esc(g.name)}</span>
        <span class="tr-group-progress">${played}/${total} played</span>
      </div>
      <div class="tr-standings-table">
        <div class="tr-standings-head">
          <span class="tr-standing-pos"></span>
          <span class="tr-standing-name">Player</span>
          <span class="tr-standing-wl">W–L</span>
          <span class="tr-standing-sets">Sets</span>
          <span style="width:10px"></span>
        </div>
        ${standingsHTML}
      </div>
      <div class="tr-match-list">${matchRowsHTML}</div>
    </div>`;
  }

  // Bracket match card HTML
  function bracketCardHTML(slot, label) {
    const m = bracketMatches[slot];
    if (!m) return `<div class="tr-bracket-card tr-bracket-card--empty"><div class="tr-bc-label">${label}</div><div class="tr-bc-tbd">TBD</div></div>`;
    const sc = _trScObj(m);
    const p1s = sc ? sc.p1 : null, p2s = sc ? sc.p2 : null;
    const hasScore = m.winner_id != null;
    const p1win = m.winner_id === m.player1_id;
    const p1Name = m.p1_name || 'TBD', p2Name = m.p2_name || 'TBD';
    const known = !!(m.player1_id && m.player2_id);
    const myId2 = state.currentUser?.playerId;
    const isMyBracketMatch = myId2 && (m.player1_id === myId2 || m.player2_id === myId2);
    const canScoreBracket = known && (isAdmin() || (isMyBracketMatch && !hasScore));
    const scoreBtn = canScoreBracket
      ? `<button class="tr-score-btn" data-match-id="${m.id}">${isAdmin() && hasScore ? 'Edit' : 'Score'}</button>` : '';
    const timeStr = m.match_date ? `${_trFmtShort(m.match_date)}${m.match_time ? ' · ' + _trFmtTime(m.match_time) : ''}` : '';
    return `<div class="tr-bracket-card${hasScore ? ' tr-bracket-card--scored' : ''}">
      <div class="tr-bc-header">
        <span class="tr-bc-label">${label}</span>
        ${timeStr ? `<span class="tr-bc-time">${timeStr}</span>` : ''}
      </div>
      <div class="tr-bc-player ${p1win && hasScore ? 'tr-bc-winner' : ''}">
        ${esc(p1Name)}${hasScore ? ` <span class="tr-bc-sets">${p1s}</span>` : ''}
      </div>
      <div class="tr-bc-divider"></div>
      <div class="tr-bc-player ${!p1win && hasScore ? 'tr-bc-winner' : ''}">
        ${esc(p2Name)}${hasScore ? ` <span class="tr-bc-sets">${p2s}</span>` : ''}
      </div>
      ${scoreBtn ? `<div class="tr-bc-footer">${scoreBtn}</div>` : ''}
    </div>`;
  }

  const { label: statusLabel, cls: statusCls } = _trStatusLabel(t.status);
  const groupsHTML = t.groups.map(groupCardHTML).join('');

  // ── Results tab ──────────────────────────────────────────────────────────────
  function buildResultsTiers() {
    function ord(n) {
      const s = ['th','st','nd','rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    function matchWinner(m) { return m?.winner_id || null; }
    function matchLoser(m) {
      if (!m?.winner_id) return null;
      return m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
    }

    const placedIds = new Set();
    const tiers = [];

    function addBracketTier(label, ids) {
      const valid = ids.filter(Boolean);
      if (!valid.length) return;
      tiers.push({ label, players: valid.map(id => ({ id, name: (t.players.find(p => p.player_id === id) || {}).player_name || '?' })) });
      valid.forEach(id => placedIds.add(id));
    }

    addBracketTier('1st',    [matchWinner(bracketMatches['F'])]);
    addBracketTier('2nd',    [matchLoser(bracketMatches['F'])]);
    addBracketTier('3rd–4th', [matchLoser(bracketMatches['SF1']), matchLoser(bracketMatches['SF2'])]);
    addBracketTier('5th–8th', ['QF1','QF2','QF3','QF4'].map(s => matchLoser(bracketMatches[s])));

    // Group stage players who didn't reach the bracket
    const remaining = t.players.map(p => p.player_id).filter(id => !placedIds.has(id));
    const rec = {};
    for (const id of remaining) rec[id] = { wins: 0, losses: 0, sd: 0 };
    for (const m of t.matches) {
      if (m.round !== 'group' || !m.winner_id) continue;
      const sc = _trScObj(m);
      const p1s = sc?.p1 || 0, p2s = sc?.p2 || 0;
      if (rec[m.player1_id] !== undefined) { rec[m.player1_id].sd += p1s - p2s; if (m.winner_id === m.player1_id) rec[m.player1_id].wins++; else rec[m.player1_id].losses++; }
      if (rec[m.player2_id] !== undefined) { rec[m.player2_id].sd += p2s - p1s; if (m.winner_id === m.player2_id) rec[m.player2_id].wins++; else rec[m.player2_id].losses++; }
    }
    remaining.sort((a, b) => rec[b].wins - rec[a].wins || rec[b].sd - rec[a].sd);

    let pos = tiers.reduce((sum, tier) => sum + tier.players.length, 0) + 1;
    let i = 0;
    while (i < remaining.length) {
      const curr = rec[remaining[i]];
      let j = i + 1;
      while (j < remaining.length && rec[remaining[j]].wins === curr.wins && rec[remaining[j]].sd === curr.sd) j++;
      const group = remaining.slice(i, j);
      const end = pos + group.length - 1;
      const label = pos === end ? ord(pos) : `${ord(pos)}–${ord(end)}`;
      tiers.push({ label, players: group.map(id => ({ id, name: (t.players.find(p => p.player_id === id) || {}).player_name || '?' })) });
      pos += group.length;
      i = j;
    }
    return tiers;
  }

  const isCompleted = t.status === 'completed';
  const resultsHTML = isCompleted ? (() => {
    const tiers = buildResultsTiers();
    if (!tiers.length) return '<div class="tr-results-empty">No results yet.</div>';
    return `<div class="tr-results-list">${tiers.map(tier =>
      tier.players.map(p => `<div class="tr-results-row">
        <span class="tr-results-pos">${tier.label}</span>
        <span class="tr-results-name">${esc(p.name)}</span>
      </div>`).join('')
    ).join('')}</div>`;
  })() : '';

  const bracketHTML = `<div class="tr-bracket">
    <div class="tr-bracket-col">
      <div class="tr-bracket-round-hd">Quarterfinals <span class="tr-bracket-round-date">${_trFmtShort(_trSatDate(t.championship_date))}</span></div>
      <div class="tr-bracket-pair">
        ${bracketCardHTML('QF1','QF 1')}
        ${bracketCardHTML('QF3','QF 3')}
      </div>
      <div class="tr-bracket-pair-gap"></div>
      <div class="tr-bracket-pair">
        ${bracketCardHTML('QF2','QF 2')}
        ${bracketCardHTML('QF4','QF 4')}
      </div>
    </div>
    <div class="tr-bracket-col tr-bracket-col--sf">
      <div class="tr-bracket-round-hd">Semifinals <span class="tr-bracket-round-date">${_trFmtShort(t.championship_date)}</span></div>
      <div class="tr-bracket-sf-spacer"></div>
      ${bracketCardHTML('SF1','SF 1')}
      <div class="tr-bracket-sf-gap"></div>
      ${bracketCardHTML('SF2','SF 2')}
      <div class="tr-bracket-sf-spacer"></div>
    </div>
    <div class="tr-bracket-col tr-bracket-col--f">
      <div class="tr-bracket-round-hd">Final <span class="tr-bracket-round-date">${_trFmtShort(t.championship_date)}</span></div>
      <div class="tr-bracket-f-spacer"></div>
      ${bracketCardHTML('F','Final')}
      <div class="tr-bracket-f-spacer"></div>
    </div>
  </div>`;

  content.innerHTML = `<div class="tr-detail">
    <div class="tr-detail-meta">
      <span class="tr-badge ${statusCls}">${statusLabel}</span>
      <span class="tr-detail-champ-date">Championship: ${_trFmtDate(t.championship_date)}</span>
    </div>
    <div class="tr-tabs">
      <button class="tr-tab active" data-tab="groups">Groups</button>
      <button class="tr-tab" data-tab="bracket">Bracket</button>
      ${isCompleted ? `<button class="tr-tab" data-tab="results">Results</button>` : ''}
    </div>
    <div id="trPanelGroups" class="tr-groups-grid">${groupsHTML}</div>
    <div id="trPanelBracket" class="tr-bracket-panel" style="display:none">${bracketHTML}</div>
    ${isCompleted ? `<div id="trPanelResults" class="tr-results-panel" style="display:none">${resultsHTML}</div>` : ''}
  </div>`;

  content.querySelectorAll('.tr-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      content.querySelectorAll('.tr-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      document.getElementById('trPanelGroups').style.display = tab === 'groups' ? '' : 'none';
      document.getElementById('trPanelBracket').style.display = tab === 'bracket' ? '' : 'none';
      if (isCompleted) document.getElementById('trPanelResults').style.display = tab === 'results' ? '' : 'none';
    });
  });

  content.querySelectorAll('.tr-score-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const match = t.matches.find(m => m.id === Number(btn.dataset.matchId));
      if (match) openTournamentScoreModal(match, t);
    });
  });
}

// ─── Score Modal ───────────────────────────────────────────────────────────────

function openTournamentScoreModal(match, tournament) {
  const p1Name = match.p1_name || 'Player 1';
  const p2Name = match.p2_name || 'Player 2';
  const existingSc = match.scores ? JSON.parse(match.scores) : null;

  // Valid match scores: one side must win 3 sets
  const presets = [
    { p1: 3, p2: 0 }, { p1: 3, p2: 1 }, { p1: 3, p2: 2 },
    { p1: 0, p2: 3 }, { p1: 1, p2: 3 }, { p1: 2, p2: 3 },
  ];

  let selected = existingSc
    ? presets.find(pr => pr.p1 === existingSc.p1 && pr.p2 === existingSc.p2) || null
    : null;

  function renderModal() {
    const btnsHTML = presets.map(pr => {
      const isSel = selected && selected.p1 === pr.p1 && selected.p2 === pr.p2;
      const p1wins = pr.p1 > pr.p2;
      const scoreDisplay = p1wins ? `${pr.p1}–${pr.p2}` : `${pr.p2}–${pr.p1}`;
      return `<button class="tr-preset-btn${isSel ? ' tr-preset-btn--selected' : ''}" data-p1="${pr.p1}" data-p2="${pr.p2}">
        <span class="tr-preset-score">${scoreDisplay}</span>
        <span class="tr-preset-winner">${p1wins ? esc(p1Name.split(' ')[0]) : esc(p2Name.split(' ')[0])} wins</span>
      </button>`;
    }).join('');

    const clearBtn = existingSc && isAdmin()
      ? `<button type="button" class="btn btn-ghost" id="trClearScore">Clear Score</button>` : '';

    modal.open(`Score Entry`, `
      <div class="tr-score-modal">
        <div class="tr-score-matchup">
          <span class="tr-score-p1name">${esc(p1Name)}</span>
          <span class="tr-score-vs">vs</span>
          <span class="tr-score-p2name">${esc(p2Name)}</span>
        </div>
        <div class="tr-preset-grid">${btnsHTML}</div>
        <div class="tr-score-actions">
          ${clearBtn}
          <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
          <button type="button" class="btn btn-primary" id="trSaveScore" ${selected ? '' : 'disabled'}>Save Score</button>
        </div>
      </div>`, { medium: true });

    attachModalListeners();
  }

  function attachModalListeners() {
    document.querySelectorAll('.tr-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selected = { p1: Number(btn.dataset.p1), p2: Number(btn.dataset.p2) };
        document.querySelectorAll('.tr-preset-btn').forEach(b => b.classList.toggle('tr-preset-btn--selected',
          Number(b.dataset.p1) === selected.p1 && Number(b.dataset.p2) === selected.p2));
        document.getElementById('trSaveScore').disabled = false;
      });
    });

    document.getElementById('trClearScore')?.addEventListener('click', async () => {
      if (!confirm('Clear this match score?')) return;
      await window.api.clearTournamentScore(match.id);
      toast('Score cleared.', 'success');
      modal.close();
      window.navigate('tournamentDetail', { tournamentId: tournament.id });
    });

    document.getElementById('trSaveScore').addEventListener('click', async () => {
      if (!selected) return;
      try {
        if (isAdmin()) {
          const winnerId = selected.p1 > selected.p2 ? match.player1_id : match.player2_id;
          await window.api.updateTournamentScore(match.id, { scores: selected, winnerId });
        } else {
          const myId = state.currentUser?.playerId;
          const isP1 = match.player1_id === myId;
          await window.api.reportTournamentPlayerScore(match.id, {
            myScore:    isP1 ? selected.p1 : selected.p2,
            theirScore: isP1 ? selected.p2 : selected.p1,
          });
        }
        toast('Score saved!', 'success');
        modal.close();
        window.navigate('tournamentDetail', { tournamentId: tournament.id });
      } catch (e) { toast(e.message || 'Failed to save.', 'error'); }
    });
  }

  renderModal();
}

// ─── Create Tournament Wizard ──────────────────────────────────────────────────

export async function renderCreateTournament() {
  document.getElementById('pageTitle').textContent = 'New Tournament';
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.getElementById('mainContent');

  const wiz = { step: 1, selectedPlayers: [], groups: { A: [], B: [], C: [], D: [] }, swapTarget: null };
  const allPlayers = state.players || [];

  function render() {
    if (wiz.step === 1) renderStep1();
    else if (wiz.step === 2) renderStep2();
    else renderStep3();
  }

  function wizSteps(active) {
    const steps = ['Select Players', 'Arrange Groups', 'Settings'];
    return `<div class="wizard-steps">
      ${steps.map((label, i) => {
        const n = i + 1;
        const cls = n < active ? 'done' : n === active ? 'active' : '';
        const connCls = n < active ? 'done' : '';
        return `<div class="wizard-step ${cls}">
          <div class="step-num">${n < active ? '&#10003;' : n}</div>
          <span class="step-label">${label}</span>
        </div>${i < steps.length - 1 ? `<div class="step-connector ${connCls}"></div>` : ''}`;
      }).join('')}
    </div>`;
  }

  // ── Step 1: Select 16 players ──────────────────────────────────────────────
  function renderStep1() {
    const count = wiz.selectedPlayers.length;
    content.innerHTML = `<div class="wizard">
      ${wizSteps(1)}
      <div class="wizard-card">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:6px">
          Select Players
          <span id="trCount" style="font-size:13px;font-weight:600;margin-left:10px;color:${count===16?'var(--success)':'var(--text-muted)'}">${count}/16</span>
        </h3>
        <p class="text-muted" style="font-size:13px;margin-bottom:14px">Select exactly 16 players for the tournament.</p>
        <input type="text" class="form-control" id="trSearch" placeholder="Search players…" autocomplete="off" style="margin-bottom:8px">
        <div class="picker-list" id="trPlayerList" style="min-height:200px;max-height:380px"></div>
        <div id="wError" class="form-error"></div>
        <div class="wizard-footer">
          <button class="btn btn-outline" onclick="navigate('tournaments')">Cancel</button>
          <button class="btn btn-primary" id="trNext1" ${count!==16?'disabled':''}>Next &rarr;</button>
        </div>
      </div>
    </div>`;

    function renderList(filter='') {
      const lc = filter.toLowerCase();
      const filtered = allPlayers.filter(p => !filter || p.name.toLowerCase().includes(lc));
      const listEl = document.getElementById('trPlayerList');
      if (!listEl) return;
      const scrollTop = listEl.scrollTop;
      listEl.innerHTML = filtered.map(p => {
        const sel = wiz.selectedPlayers.includes(p.id);
        return `<div class="picker-item${sel?' tr-pl-row--sel':''}" data-pid="${p.id}" style="${sel?'background:#eef2ff':''}">
          <div class="tr-pl-check" style="width:18px;flex-shrink:0;color:var(--primary)">${sel?'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>':''}</div>
          <span style="flex:1">${esc(p.name)}</span>
        </div>`;
      }).join('') || `<div class="empty-state"><strong>No players found</strong></div>`;
      listEl.scrollTop = scrollTop;
    }

    function updateCountUI() {
      const c = wiz.selectedPlayers.length;
      const countEl = document.getElementById('trCount');
      if (countEl) { countEl.textContent = `${c}/16`; countEl.style.color = c === 16 ? 'var(--success)' : 'var(--text-muted)'; }
      const nextBtn = document.getElementById('trNext1');
      if (nextBtn) nextBtn.disabled = c !== 16;
    }

    renderList();
    document.getElementById('trSearch').addEventListener('input', e => renderList(e.target.value));
    document.getElementById('trPlayerList').addEventListener('click', e => {
      const row = e.target.closest('[data-pid]');
      if (!row) return;
      const pid = Number(row.dataset.pid);
      const idx = wiz.selectedPlayers.indexOf(pid);
      if (idx >= 0) wiz.selectedPlayers.splice(idx, 1);
      else if (wiz.selectedPlayers.length < 16) wiz.selectedPlayers.push(pid);
      renderList(document.getElementById('trSearch')?.value || '');
      updateCountUI();
    });
    document.getElementById('trNext1').addEventListener('click', async () => {
      wiz.groups = await window.api.suggestTournamentGroups({ playerIds: wiz.selectedPlayers });
      wiz.step = 2; render();
    });
  }

  // ── Step 2: Arrange groups ──────────────────────────────────────────────────
  function renderStep2() {
    function gCard(gName) {
      return `<div class="tr-group-card">
        <div class="tr-group-header"><span class="tr-group-name">Group ${gName}</span></div>
        <div class="tr-swap-list">
          ${(wiz.groups[gName]||[]).map(pid => {
            const p = allPlayers.find(pl => pl.id === pid) || { id: pid, name: 'Unknown' };
            const isSel = wiz.swapTarget?.pid === pid;
            return `<div class="tr-swap-row${isSel?' tr-swap-row--sel':''}" data-pid="${pid}" data-grp="${gName}">
              ${isSel?'<span class="tr-swap-sel-dot"></span>':''}${esc(p.name)}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }

    content.innerHTML = `<div class="wizard">
      ${wizSteps(2)}
      <div class="wizard-card">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:12px">
          Arrange Groups
          <button class="btn btn-outline btn-sm" id="trReset" style="font-size:12px">↺ Reset</button>
        </h3>
        <p class="text-muted" style="font-size:13px;margin-bottom:18px">Tap a player to select, then tap another to swap positions. Auto-balanced by ladder ranking.</p>
        <div class="tr-wiz-groups">${['A','B','C','D'].map(gCard).join('')}</div>
        <div class="wizard-footer">
          <button class="btn btn-outline" id="trBack2">&larr; Back</button>
          <button class="btn btn-primary" id="trNext2">Next &rarr;</button>
        </div>
      </div>
    </div>`;

    document.getElementById('trReset').addEventListener('click', async () => {
      wiz.groups = await window.api.suggestTournamentGroups({ playerIds: wiz.selectedPlayers });
      wiz.swapTarget = null; renderStep2();
    });
    document.getElementById('trBack2').addEventListener('click', () => { wiz.step = 1; render(); });
    document.getElementById('trNext2').addEventListener('click', () => { wiz.step = 3; render(); });
    content.querySelectorAll('.tr-swap-row').forEach(el => {
      el.addEventListener('click', () => {
        const pid = Number(el.dataset.pid), grp = el.dataset.grp;
        if (!wiz.swapTarget) { wiz.swapTarget = { pid, grp }; renderStep2(); }
        else if (wiz.swapTarget.pid === pid) { wiz.swapTarget = null; renderStep2(); }
        else {
          const a = wiz.swapTarget, b = { pid, grp };
          const ai = wiz.groups[a.grp].indexOf(a.pid), bi = wiz.groups[b.grp].indexOf(b.pid);
          wiz.groups[a.grp][ai] = b.pid; wiz.groups[b.grp][bi] = a.pid;
          wiz.swapTarget = null; renderStep2();
        }
      });
    });
  }

  // ── Step 3: Settings ────────────────────────────────────────────────────────
  function renderStep3() {
    const today = new Date();
    const nextSun = new Date(today);
    nextSun.setDate(today.getDate() + ((7 - today.getDay()) % 7 || 7));
    const defaultDate = nextSun.toISOString().slice(0, 10);

    content.innerHTML = `<div class="wizard">
      ${wizSteps(3)}
      <div class="wizard-card">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:20px">Tournament Settings</h3>
        <div class="form-group">
          <label>Tournament Name</label>
          <input type="text" class="form-control" id="trName" value="Tournament ${new Date().getFullYear()}">
        </div>
        <div class="form-group">
          <label>Championship Day <span class="form-hint">(Sunday — Semis &amp; Final)</span></label>
          <input type="date" class="form-control" id="trChampDate" value="${defaultDate}">
          <div id="trConflictWarn" class="tr-conflict-warn" style="display:none"></div>
        </div>
        <div class="form-group">
          <label>Courts</label>
          <div class="tr-court-checks" id="trCourtList">Loading…</div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Match Duration <span class="form-hint">(minutes)</span></label>
            <input type="number" class="form-control" id="trDuration" value="60" min="15" max="180">
          </div>
          <div class="form-group">
            <label>Buffer Between Matches <span class="form-hint">(minutes)</span></label>
            <input type="number" class="form-control" id="trBuffer" value="0" min="0" max="60">
          </div>
        </div>
        <div id="trError" class="form-error"></div>
        <div class="wizard-footer">
          <button class="btn btn-outline" id="trBack3">&larr; Back</button>
          <button class="btn btn-primary" id="trCreate">Create Tournament</button>
        </div>
      </div>
    </div>`;

    document.getElementById('trBack3').addEventListener('click', () => { wiz.step = 2; render(); });

    (async () => {
      const courts = (await window.api.getCourts()).filter(c => c.active);
      document.getElementById('trCourtList').innerHTML = courts.length
        ? courts.map(c => `<label class="tr-court-label"><input type="checkbox" value="${c.id}" checked> ${esc(c.name)}</label>`).join('')
        : `<span class="form-hint">No active courts configured.</span>`;
    })();

    let conflictTimer = null;
    async function checkConflicts() {
      const champDate = document.getElementById('trChampDate')?.value;
      const courtIds = [...document.querySelectorAll('#trCourtList input:checked')].map(el => Number(el.value));
      const duration = Number(document.getElementById('trDuration')?.value) || 60;
      const buffer = Number(document.getElementById('trBuffer')?.value) || 0;
      if (!champDate || !courtIds.length) return;
      try {
        const { conflicts } = await window.api.checkTournamentDate({ championshipDate: champDate, courtIds, matchDurationMinutes: duration, bufferMinutes: buffer });
        const warn = document.getElementById('trConflictWarn');
        if (!warn) return;
        if (conflicts.length) {
          warn.textContent = `League conflict on ${conflicts.map(d => _trFmtShort(d)).join(', ')}. Choose a different week.`;
          warn.style.display = '';
          document.getElementById('trCreate').disabled = true;
        } else {
          warn.style.display = 'none';
          document.getElementById('trCreate').disabled = false;
        }
      } catch (_) {}
    }

    function scheduleCheck() { clearTimeout(conflictTimer); conflictTimer = setTimeout(checkConflicts, 400); }
    document.getElementById('trChampDate').addEventListener('change', scheduleCheck);
    document.getElementById('trDuration').addEventListener('input', scheduleCheck);
    document.getElementById('trBuffer').addEventListener('input', scheduleCheck);
    document.getElementById('trCourtList').addEventListener('change', scheduleCheck);

    document.getElementById('trCreate').addEventListener('click', async () => {
      const name = document.getElementById('trName').value.trim();
      const championshipDate = document.getElementById('trChampDate').value;
      const courtIds = [...document.querySelectorAll('#trCourtList input:checked')].map(el => Number(el.value));
      const matchDurationMinutes = Number(document.getElementById('trDuration').value) || 60;
      const bufferMinutes = Number(document.getElementById('trBuffer').value) || 0;
      const errEl = document.getElementById('trError');
      if (!name) { errEl.textContent = 'Tournament name is required.'; return; }
      if (!championshipDate) { errEl.textContent = 'Championship date is required.'; return; }
      if (!courtIds.length) { errEl.textContent = 'Select at least one court.'; return; }
      errEl.textContent = '';
      const btn = document.getElementById('trCreate');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const { tournamentId } = await window.api.createTournament({ name, groups: wiz.groups, championshipDate, courtIds, matchDurationMinutes, bufferMinutes });
        toast(`"${name}" created!`, 'success');
        window.navigate('tournamentDetail', { tournamentId });
      } catch (e) {
        if (e.message?.includes('League match')) {
          const warn = document.getElementById('trConflictWarn');
          if (warn) { warn.textContent = e.message; warn.style.display = ''; }
        } else {
          errEl.textContent = e.message || 'Failed to create tournament.';
        }
        btn.disabled = false; btn.textContent = 'Create Tournament';
      }
    });
  }

  render();
}
