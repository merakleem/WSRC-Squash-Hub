import { state, isAdmin } from '../state.js';
import { esc, formatDate, formatShortDate, toast, modal } from '../utils.js';
import { printBoxes, copyPublicLink, openMessagePlayersModal, printSchedule, confirmDeleteLeague } from './leagues.js';

let leagueEditMode = false;
export function resetLeagueEditMode() { leagueEditMode = false; }

// Cache of court lists by league ID, populated when a league is loaded
const _leagueCourtsCache = new Map();

// ===== LEAGUE DETAIL =====
function getOpenWeekIds() {
  return Array.from(document.querySelectorAll('.week-card.open'))
    .map((el) => Number(el.dataset.weekId))
    .filter(Boolean);
}

function restoreOpenWeeks(openIds) {
  if (!openIds.length) return;
  document.querySelectorAll('.week-card').forEach((el) => {
    if (openIds.includes(Number(el.dataset.weekId))) el.classList.add('open');
  });
}

export async function reloadLeagueDetail() {
  const openIds = getOpenWeekIds();
  state.currentLeague = await window.api.getLeague(state.currentLeague.id);
  renderLeagueDetail();
  restoreOpenWeeks(openIds);
}

export function renderLeagueDetail() {
  const league = state.currentLeague;
  if (!league) { window.navigate('leagues'); return; }

  const adminMode = isAdmin();
  document.getElementById('pageTitle').textContent = league.name;
  document.getElementById('topbarActions').innerHTML = adminMode ? `
    <button class="btn ${leagueEditMode ? 'btn-primary' : 'btn-outline'}" id="editRosterBtn">
      ${leagueEditMode ? 'Done Editing' : 'Edit Players'}
    </button>
    <div class="options-menu" id="optionsMenu">
      <button class="btn btn-outline" id="optionsBtn">Options <svg width="14" height="14" viewBox="0 0 4 14" fill="currentColor" style="vertical-align:middle;margin-left:2px"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/></svg></button>
      <div class="options-dropdown" id="optionsDropdown">
        <button class="options-item" data-action="print-boxes">Print Boxes</button>
        <button class="options-item" data-action="box-scores">Submit scores by box view</button>
        ${league.setup_type === 'modern' ? `<button class="options-item" data-action="print-schedule">Print Schedule</button>` : ''}
        <button class="options-item" data-action="copy-link">Get Public Link</button>
        <button class="options-item" data-action="message-players">Message Players</button>
        <button class="options-item options-item-danger" data-action="delete-league" data-id="${league.id}" data-name="${esc(league.name)}">Delete League</button>
      </div>
    </div>` : '';

  if (adminMode) {
    document.getElementById('editRosterBtn').addEventListener('click', () => {
      leagueEditMode = !leagueEditMode;
      renderLeagueDetail();
    });

    document.getElementById('optionsBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('optionsDropdown').classList.toggle('open');
    });
    document.getElementById('optionsDropdown').addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'print-boxes') {
        document.getElementById('optionsDropdown').classList.remove('open');
        printBoxes(league);
      } else if (action === 'box-scores') {
        document.getElementById('optionsDropdown').classList.remove('open');
        openBoxScoreModal(league);
      } else if (action === 'print-schedule') {
        document.getElementById('optionsDropdown').classList.remove('open');
        printSchedule(league);
      } else if (action === 'copy-link') {
        document.getElementById('optionsDropdown').classList.remove('open');
        copyPublicLink(league);
      } else if (action === 'message-players') {
        document.getElementById('optionsDropdown').classList.remove('open');
        openMessagePlayersModal(league);
      } else if (action === 'delete-league') {
        document.getElementById('optionsDropdown').classList.remove('open');
        confirmDeleteLeague(Number(e.target.dataset.id), e.target.dataset.name);
      }
    });
    document.addEventListener('click', function closeOptions() {
      document.getElementById('optionsDropdown')?.classList.remove('open');
      document.removeEventListener('click', closeOptions);
    }, { once: false });
  }

  const content = document.getElementById('mainContent');
  const isModern = league.setup_type === 'modern';
  const numPlayers = isModern ? (league.players || []).length : league.num_teams * league.num_divisions;

  const weeks = league.weeks || [];
  const endDate = weeks.length > 0 ? weeks[weeks.length - 1].date : null;
  const dateRange = endDate
    ? `${formatShortDate(league.start_date)} – ${formatShortDate(endDate)}`
    : formatShortDate(league.start_date);

  const statsHTML = isModern ? `
    <div class="stat"><span class="stat-val">${league.num_divisions}</span><span class="stat-label">Divisions</span></div>
    <div class="stat"><span class="stat-val">${numPlayers}</span><span class="stat-label">Players</span></div>
    <div class="stat"><span class="stat-val">${weeks.length}</span><span class="stat-label">Weeks</span></div>
    <div class="stat"><span class="stat-val">${dateRange}</span><span class="stat-label">Dates</span></div>` : `
    <div class="stat"><span class="stat-val">${league.num_teams}</span><span class="stat-label">Teams</span></div>
    <div class="stat"><span class="stat-val">${league.num_divisions}</span><span class="stat-label">Divisions</span></div>
    <div class="stat"><span class="stat-val">${numPlayers}</span><span class="stat-label">Players</span></div>
    <div class="stat"><span class="stat-val">${weeks.length}</span><span class="stat-label">Weeks</span></div>
    <div class="stat"><span class="stat-val">${dateRange}</span><span class="stat-label">Dates</span></div>`;

  content.innerHTML = `
    <div class="league-header-card">
      <div class="league-header-inner">
        <h2>${esc(league.name)}</h2>
        <div class="league-header-divider"></div>
        <div class="league-stats">${statsHTML}</div>
      </div>
    </div>

    ${adminMode ? `
    <div class="section">
      <div class="section-title">${isModern ? 'Divisions' : 'Rosters'} <div class="divider"></div></div>
      ${isModern ? renderRostersModern(league, leagueEditMode) : renderRosters(league, leagueEditMode)}
    </div>
    ` : ''}

    <div class="section">
      <div class="section-title">Schedule <div class="divider"></div></div>
      ${renderScheduleFilter(league)}
      <div class="schedule-list${adminMode ? ' is-admin' : ''}" id="scheduleList">
        ${(league.weeks || []).map((w) => renderWeekCard(w, league, adminMode)).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Standings <div class="divider"></div></div>
      ${renderStandings(league)}
    </div>`;

  // Schedule division filter
  const schFilter = content.querySelector('#schFilter');
  if (schFilter) {
    schFilter.addEventListener('click', (e) => {
      const pill = e.target.closest('.std-tab');
      if (!pill) return;
      const divId = pill.dataset.divId;
      schFilter.querySelectorAll('.std-tab').forEach((p) => p.classList.toggle('active', p === pill));
      const isAll = divId === 'all';
      if (isModern) {
        content.querySelectorAll('#scheduleList .matchup-block[data-division-id]').forEach((block) => {
          block.hidden = !isAll && block.dataset.divisionId !== divId;
        });
      } else {
        content.querySelectorAll('#scheduleList .match-row').forEach((row) => {
          row.hidden = !isAll && row.dataset.divisionId !== divId;
        });
        content.querySelectorAll('#scheduleList .matchup-block').forEach((block) => {
          block.hidden = !isAll && !block.querySelector('.match-row:not([hidden])');
        });
      }
    });
  }

  // Standings tab switching (scoped to .std-container to avoid colliding with schedule filter pills)
  content.querySelectorAll('.std-container .std-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const divId = tab.dataset.divId;
      content.querySelectorAll('.std-container .std-tab').forEach((t) => t.classList.toggle('active', t === tab));
      content.querySelectorAll('.std-panel').forEach((p) => p.classList.toggle('active', p.dataset.divId === divId));
    });
  });

  // Week toggle
  content.querySelectorAll('.week-header').forEach((header) => {
    header.addEventListener('click', () => {
      header.closest('.week-card').classList.toggle('open');
    });
  });

  // Roster player links
  content.querySelectorAll('.player-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.openPlayerProfile(Number(a.dataset.playerId));
    });
  });

  // Replace player buttons (admin, edit mode only)
  if (adminMode && leagueEditMode) {
    content.querySelectorAll('.replace-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        openReplacePlayerModal(league.id, Number(btn.dataset.playerId), btn.dataset.playerName);
      });
    });
  }

  // Score forms (admin only)
  if (adminMode) {
    content.querySelectorAll('.score-save-btn').forEach((btn) => {
      btn.addEventListener('click', () => saveMatchScore(btn));
    });

    // Sub buttons
    content.querySelectorAll('.sub-btn').forEach((btn) => {
      btn.addEventListener('click', () => openSubModal(btn));
    });

    // Timing buttons
    content.querySelectorAll('.timing-btn').forEach((btn) => {
      btn.addEventListener('click', () => openTimingModal(btn));
    });

    // Skip buttons
    content.querySelectorAll('.skip-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const matchId = Number(btn.dataset.matchId);
        await fetch(`/api/matches/${matchId}/skip`, { method: 'PUT' });
        reloadLeagueDetail();
      });
    });

    // Unskip buttons
    content.querySelectorAll('.unskip-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const matchId = Number(btn.dataset.matchId);
        await fetch(`/api/matches/${matchId}/unskip`, { method: 'PUT' });
        reloadLeagueDetail();
      });
    });
  }
}

function renderRosters(league, editMode = false) {
  if (!league.teams || league.teams.length === 0) return '';
  return `<div class="roster-grid">
    ${league.teams.map((team) => {
      const members = (league.players || [])
        .filter((p) => p.team_id === team.id)
        .sort((a, b) => a.division_level - b.division_level);
      return `
        <div class="roster-team-card">
          <div class="roster-team-title">${esc(team.name)}</div>
          ${members.map((m) => `
            <div class="roster-player">
              <span class="div-chip">${esc(m.division_name.replace(/^Division\s*/i, 'D'))}</span>
              <a class="player-link" data-player-id="${m.player_id}" href="#">${esc(m.player_name)}</a>
              ${editMode ? `<button class="replace-btn" data-player-id="${m.player_id}" data-player-name="${esc(m.player_name)}">Replace</button>` : ''}
            </div>`).join('')}
        </div>`;
    }).join('')}
  </div>`;
}

function renderRostersModern(league, editMode = false) {
  if (!league.divisions || league.divisions.length === 0) return '';
  return `<div class="roster-grid">
    ${league.divisions.map((div) => {
      const members = (league.players || [])
        .filter((p) => p.division_id === div.id)
        .sort((a, b) => a.skill_rank - b.skill_rank);
      return `
        <div class="roster-team-card">
          <div class="roster-team-title">${esc(div.name)}</div>
          ${members.map((m) => `
            <div class="roster-player">
              <a class="player-link" data-player-id="${m.player_id}" href="#">${esc(m.player_name)}</a>
              ${editMode ? `<button class="replace-btn" data-player-id="${m.player_id}" data-player-name="${esc(m.player_name)}">Replace</button>` : ''}
            </div>`).join('')}
        </div>`;
    }).join('')}
  </div>`;
}

// ===== STANDINGS =====
export function computeStandings(league) {
  const stats = {};
  for (const p of (league.players || [])) {
    stats[p.player_id] = {
      playerId: p.player_id,
      name: p.player_name,
      divisionId: p.division_id,
      skillRank: p.skill_rank,
      wins: 0, losses: 0, gamesWon: 0, gamesLost: 0,
    };
  }

  for (const week of (league.weeks || [])) {
    for (const mu of (week.matchups || [])) {
      for (const match of (mu.matches || [])) {
        if (match.skipped) continue;
        if (match.player1_score == null || match.player2_score == null) continue;
        const p1 = stats[match.player1_id];
        const p2 = stats[match.player2_id];
        if (!p1 || !p2) continue;
        p1.gamesWon  += match.player1_score;
        p1.gamesLost += match.player2_score;
        p2.gamesWon  += match.player2_score;
        p2.gamesLost += match.player1_score;
        if (match.winner_id === match.player1_id) { p1.wins++; p2.losses++; }
        else if (match.winner_id === match.player2_id) { p2.wins++; p1.losses++; }
      }
    }
  }

  const divMap = {};
  for (const d of (league.divisions || [])) divMap[d.id] = d;

  const result = {};
  for (const s of Object.values(stats)) {
    const div = divMap[s.divisionId];
    if (!div) continue;
    if (!result[s.divisionId]) result[s.divisionId] = { division: div, players: [] };
    result[s.divisionId].players.push({
      ...s,
      gameDiff: s.gamesWon - s.gamesLost,
      played: s.wins + s.losses,
    });
  }

  for (const divData of Object.values(result)) {
    divData.players.sort((a, b) =>
      b.wins !== a.wins ? b.wins - a.wins :
      b.gameDiff !== a.gameDiff ? b.gameDiff - a.gameDiff :
      a.skillRank - b.skillRank
    );
  }

  return result;
}

function renderStandings(league) {
  const standings = computeStandings(league);
  const divIds = Object.keys(standings).sort(
    (a, b) => standings[a].division.level - standings[b].division.level
  );

  if (divIds.length === 0) {
    return '<p style="color:var(--text-muted);padding:8px 0 24px">No standings available.</p>';
  }

  const tabsHTML = divIds.map((id, i) => `
    <button class="std-tab${i === 0 ? ' active' : ''}" data-div-id="${id}">
      ${esc(standings[id].division.name)}
    </button>`).join('');

  const panelsHTML = divIds.map((id, i) => {
    const players = standings[id].players;
    const rows = players.map((p, idx) => {
      const sign = p.gameDiff > 0 ? '+' : '';
      const gdClass = p.gameDiff > 0 ? ' std-gd-pos' : p.gameDiff < 0 ? ' std-gd-neg' : '';
      return `
        <tr>
          <td class="std-rank">${idx + 1}</td>
          <td class="std-player">${esc(p.name)}</td>
          <td class="std-stat">${p.wins}</td>
          <td class="std-stat">${p.losses}</td>
          <td class="std-stat${gdClass}">${sign}${p.gameDiff}</td>
          <td class="std-stat">${p.played}</td>
        </tr>`;
    }).join('');
    return `
      <div class="std-panel${i === 0 ? ' active' : ''}" data-div-id="${id}">
        <table class="std-table">
          <thead><tr>
            <th class="std-rank">#</th>
            <th class="std-player">Player</th>
            <th class="std-stat">W</th>
            <th class="std-stat">L</th>
            <th class="std-stat">GD</th>
            <th class="std-stat">GP</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  return `
    <div class="std-container">
      <div class="std-tabs">${tabsHTML}</div>
      ${panelsHTML}
    </div>`;
}

function openTimingModal(btn) {
  const matchId = Number(btn.dataset.matchId);
  const leagueId = Number(btn.dataset.leagueId) || null;
  const currentTime = btn.dataset.matchTime || '';
  const currentCourtId = btn.dataset.courtId ? Number(btn.dataset.courtId) : null;
  const currentCourtNumber = btn.dataset.courtNumber || '';
  const scheduleCourts = btn.dataset.scheduleCourts === '1';
  const numCourts = Number(btn.dataset.numCourts) || 0;

  // Determine which court system to use
  const leagueCourts = leagueId ? (_leagueCourtsCache.get(leagueId) || []) : [];
  const useNewCourts = leagueCourts.length > 0;

  let courtField = '';
  if (useNewCourts) {
    courtField = `
      <div class="form-group">
        <label>Court</label>
        <select class="form-control" id="timingCourt">
          <option value="">— No court —</option>
          ${leagueCourts.map((c) =>
            `<option value="${c.id}" ${currentCourtId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`
          ).join('')}
        </select>
      </div>`;
  } else if (scheduleCourts && numCourts > 0) {
    courtField = `
      <div class="form-group">
        <label>Court</label>
        <select class="form-control" id="timingCourt">
          <option value="">— No court —</option>
          ${Array.from({ length: numCourts }, (_, i) => i + 1).map((n) =>
            `<option value="${n}" ${Number(currentCourtNumber) === n ? 'selected' : ''}>Court ${n}</option>`
          ).join('')}
        </select>
      </div>`;
  }

  modal.open('Edit Match Time', `
    <div class="form-group">
      <label>Time</label>
      <input type="time" class="form-control" id="timingTime" value="${esc(currentTime)}">
    </div>
    ${courtField}
    <div id="timingWarning" style="display:none;margin-top:8px;padding:10px 12px;background:#fef9e7;border:1px solid #f0c040;border-radius:6px;font-size:13px;color:#7d5800"></div>
    <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-outline" id="timingCancelBtn">Cancel</button>
      <button class="btn btn-primary" id="timingSaveBtn">Save</button>
    </div>
  `);

  document.getElementById('timingCancelBtn').addEventListener('click', modal.close);

  document.getElementById('timingSaveBtn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('timingSaveBtn');
    const timeVal = document.getElementById('timingTime').value || null;
    const rawCourtVal = (useNewCourts || scheduleCourts) ? (document.getElementById('timingCourt')?.value || null) : null;
    const courtVal = useNewCourts
      ? null
      : (rawCourtVal ? Number(rawCourtVal) : null);
    const courtId = useNewCourts && rawCourtVal ? Number(rawCourtVal) : null;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const result = await window.api.updateMatchTiming({ matchId, matchTime: timeVal, courtNumber: courtVal, courtId });
      if (result.warning) {
        const warnEl = document.getElementById('timingWarning');
        if (warnEl) { warnEl.style.display = ''; warnEl.textContent = result.warning; }
        saveBtn.disabled = false;
        saveBtn.textContent = 'Confirm Anyway';
        saveBtn.onclick = null;
        saveBtn.addEventListener('click', async () => {
          modal.close();
          const league = await window.api.getLeague(state.currentLeague.id);
          state.currentLeague = league;
          renderLeagueDetail();
        });
        return;
      }
      modal.close();
      const league = await window.api.getLeague(state.currentLeague.id);
      state.currentLeague = league;
      renderLeagueDetail();
    } catch (e) {
      const warnEl = document.getElementById('timingWarning');
      if (warnEl) {
        warnEl.style.display = '';
        warnEl.style.background = '#fdecea';
        warnEl.style.borderColor = '#e57373';
        warnEl.style.color = '#b71c1c';
        warnEl.textContent = e.message || 'Failed to save timing.';
      }
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
}

function openReplacePlayerModal(leagueId, oldPlayerId, oldPlayerName) {
  const leaguePlayerIds = new Set((state.currentLeague.players || []).map((p) => p.player_id));
  const available = state.players.filter((p) => !leaguePlayerIds.has(p.id));

  modal.open(`Replace ${esc(oldPlayerName)}`, `
    <p style="margin:0 0 12px;color:var(--text-muted);font-size:13px">
      Choose a replacement for <strong>${esc(oldPlayerName)}</strong>.
      The new player will take over all scheduled matches and history in this league.
    </p>
    <input class="form-control" id="replaceSearch" placeholder="Search players…" style="margin-bottom:10px" autofocus>
    <div id="replaceList" style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:8px"></div>
    <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-outline" id="replaceCancelBtn">Cancel</button>
      <button class="btn btn-primary" id="replaceConfirmBtn" disabled>Select a player</button>
    </div>
  `, { wide: true });

  let selectedId = null;

  function renderList(query = '') {
    const q = query.toLowerCase();
    const filtered = q ? available.filter((p) => p.name.toLowerCase().includes(q)) : available;
    const list = document.getElementById('replaceList');
    if (!list) return;
    if (filtered.length === 0) {
      list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">No players available</div>`;
      return;
    }
    list.innerHTML = filtered.map((p) => `
      <div class="replace-option ${p.id === selectedId ? 'replace-option-selected' : ''}" data-pid="${p.id}" data-name="${esc(p.name)}"
           style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;border-bottom:1px solid var(--border)">
        ${esc(p.name)}
      </div>`).join('');
    list.querySelectorAll('.replace-option').forEach((row) => {
      row.addEventListener('click', () => {
        selectedId = Number(row.dataset.pid);
        list.querySelectorAll('.replace-option').forEach((r) => r.classList.remove('replace-option-selected'));
        row.classList.add('replace-option-selected');
        const confirmBtn = document.getElementById('replaceConfirmBtn');
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = `Replace with ${row.dataset.name}`; }
      });
    });
  }

  renderList();
  document.getElementById('replaceSearch').addEventListener('input', (e) => renderList(e.target.value));
  document.getElementById('replaceCancelBtn').addEventListener('click', modal.close);
  document.getElementById('replaceConfirmBtn').addEventListener('click', async () => {
    if (!selectedId) return;
    const btn = document.getElementById('replaceConfirmBtn');
    btn.disabled = true;
    btn.textContent = 'Replacing…';
    try {
      await window.api.replacePlayer({ leagueId, oldPlayerId, newPlayerId: selectedId });
      modal.close();
      leagueEditMode = false;
      const league = await window.api.getLeague(leagueId);
      state.currentLeague = league;
      renderLeagueDetail();
      toast('Player replaced successfully', 'success');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Replace Player';
      toast(e.message || 'Failed to replace player', 'error');
    }
  });
}

function renderScheduleFilter(league) {
  const divs = (league.divisions || []).slice().sort((a, b) => a.level - b.level);
  if (divs.length <= 1) return '';
  const pills = divs.map((d) => `<button class="std-tab" data-div-id="${d.id}">${esc(d.name)}</button>`).join('');
  return `<div class="sch-filter" id="schFilter">
    <button class="std-tab active" data-div-id="all">All</button>
    ${pills}
  </div>`;
}

function renderWeekCard(week, league, adminMode = true) {
  if (league.setup_type === 'modern') return renderWeekCardModern(week, league, adminMode);

  const matchupsHTML = week.matchups.map((mu) => {
    if (mu.bye_team_id) {
      return `
        <div class="matchup-block">
          <div class="matchup-title">${esc(mu.bye_team_name)} <span class="bye-badge">BYE</span></div>
        </div>`;
    }
    return `
      <div class="matchup-block">
        <div class="matchup-title">
          ${esc(mu.team1_name)} <span class="vs-badge">VS</span> ${esc(mu.team2_name)}
        </div>
        ${mu.matches.map((m) => renderMatchRow(m, league, adminMode)).join('')}
      </div>`;
  }).join('');

  return `
    <div class="week-card" data-week-id="${week.id}">
      <div class="week-header">
        <div class="week-title">
          <span class="week-num">Week ${week.week_number}</span>
          <span class="week-date">${formatDate(week.date)}</span>
        </div>
        <svg class="week-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      <div class="week-body">${matchupsHTML}</div>
    </div>`;
}

function renderWeekCardModern(week, league, adminMode = true) {
  const byes = week.byes || [];
  const matchupsHTML = week.matchups.map((mu) => {
    const divByes = byes.filter((b) => b.division_id === mu.division_id);
    const byesHTML = divByes.length
      ? `<div class="matchup-byes">Bye: ${divByes.map((b) => esc(b.player_name)).join(', ')}</div>` : '';
    return `
      <div class="matchup-block" data-division-id="${mu.division_id}">
        <div class="matchup-title">${esc(mu.division_name)}</div>
        ${mu.matches.map((m) => renderMatchRow(m, league, adminMode)).join('')}
        ${byesHTML}
      </div>`;
  }).join('');

  return `
    <div class="week-card" data-week-id="${week.id}">
      <div class="week-header">
        <div class="week-title">
          <span class="week-num">Week ${week.week_number}</span>
          <span class="week-date">${formatDate(week.date)}</span>
        </div>
        <svg class="week-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      <div class="week-body">${matchupsHTML}</div>
    </div>`;
}

function bo5ScoreInputHTML(s1 = '', s2 = '') {
  return `
    <div class="score-input-form">
      <input class="score-input" data-score="p1" type="number" min="0" max="3" placeholder="0" value="${esc(String(s1))}">
      <span class="score-sep">–</span>
      <input class="score-input" data-score="p2" type="number" min="0" max="3" placeholder="0" value="${esc(String(s2))}">
    </div>
    <span class="score-hint">Bo5</span>`;
}

function renderMatchRow(match, league, adminMode = true) {
  const p1Won = match.winner_id != null && match.winner_id === match.player1_id;
  const p2Won = match.winner_id != null && match.winner_id === match.player2_id;
  const hasScore = match.player1_score != null && match.player2_score != null;

  // Effective players (sub overrides original)
  const eff1Name = match.sub1_name || match.player1_name;
  const eff2Name = match.sub2_name || match.player2_name;
  const p1SubBadge = match.sub1_name
    ? `<span class="sub-badge" title="Subbing for ${esc(match.player1_name)}">SUB</span>` : '';
  const p2SubBadge = match.sub2_name
    ? `<span class="sub-badge" title="Subbing for ${esc(match.player2_name)}">SUB</span>` : '';

  // Populate courts cache for this league
  if (league?.courts?.length) _leagueCourtsCache.set(league.id, league.courts);

  // Determine court display: new system (court_id) takes priority over old (court_number)
  const leagueCourts = league?.courts || [];
  const newCourtName = leagueCourts.length > 0 && match.court_id
    ? leagueCourts.find((c) => c.id === match.court_id)?.name
    : null;
  const showCourt = newCourtName != null || (league?.schedule_courts && match.court_number);
  const timingLabel = newCourtName
    ? `${newCourtName}${match.match_time ? ' · ' + match.match_time : ''}`
    : (league?.schedule_courts && match.court_number
        ? `Court ${match.court_number}${match.match_time ? ' · ' + match.match_time : ''}`
        : (match.match_time || ''));
  const canEditTiming = adminMode && !match.skipped;
  const timingAttrs = canEditTiming ? `
    class="match-court-label timing-btn${timingLabel ? '' : ' timing-btn-empty'}"
    data-match-id="${match.id}"
    data-league-id="${league ? league.id : ''}"
    data-match-time="${match.match_time || ''}"
    data-court-number="${match.court_number || ''}"
    data-court-id="${match.court_id || ''}"
    data-schedule-courts="${league && league.schedule_courts ? '1' : '0'}"
    data-num-courts="${league ? league.num_courts : 2}"` : `class="match-court-label"`;
  const courtInfo = (canEditTiming || timingLabel)
    ? `<span ${timingAttrs}>${timingLabel || 'Set time'}</span>` : '';

  const isSkipped = !!match.skipped;
  const leagueId = league ? league.id : '';

  if (isSkipped) {
    return `
      <div class="match-row match-row-skipped" data-match-id="${match.id}" data-division-id="${match.division_id}">
        <div class="match-meta">
          <span class="match-div-label">${esc(match.division_name.replace(/^Division\s*/i, 'D'))}</span>
        </div>
        <span class="match-p1 match-player" style="opacity:0.4">${esc(eff1Name)}</span>
        <span class="match-vs" style="opacity:0.4">vs</span>
        <span class="match-p2 match-player" style="opacity:0.4">${esc(eff2Name)}</span>
        <div class="match-actions">
          <span class="match-skipped-label">Skipped</span>
          ${adminMode ? `<button class="btn btn-ghost btn-sm unskip-btn" style="font-size:11px" data-match-id="${match.id}">Undo</button>` : ''}
        </div>
      </div>`;
  }

  let scoreSection;
  if (hasScore) {
    scoreSection = `<div class="match-score">
         <span class="score-display">${match.player1_score} – ${match.player2_score}</span>
         ${adminMode ? `<button class="btn btn-ghost btn-sm score-save-btn" style="font-size:11px;padding:4px 8px"
           data-match-id="${match.id}" data-p1-id="${match.player1_id}" data-p2-id="${match.player2_id}" data-editing="false">Edit</button>` : ''}
       </div>`;
  } else if (adminMode) {
    scoreSection = `<div class="match-score">
         ${bo5ScoreInputHTML()}
         <button class="btn btn-success btn-sm score-save-btn" style="font-size:11px"
           data-match-id="${match.id}" data-p1-id="${match.player1_id}" data-p2-id="${match.player2_id}" data-editing="true">Save</button>
       </div>`;
  } else {
    scoreSection = `<div class="match-score"><span class="text-muted" style="font-size:13px">—</span></div>`;
  }

  return `
    <div class="match-row" data-match-id="${match.id}" data-division-id="${match.division_id}">
      <div class="match-meta">
        <span class="match-div-label">${esc(match.division_name.replace(/^Division\s*/i, 'D'))}</span>
        ${courtInfo}
      </div>
      <span class="match-p1 match-player${p1Won ? ' winner' : ''}">${p1SubBadge}${esc(eff1Name)}</span>
      <span class="match-vs">vs</span>
      <span class="match-p2 match-player${p2Won ? ' winner' : ''}">${p2SubBadge}${esc(eff2Name)}</span>
      <div class="match-actions">
        ${scoreSection}
        ${adminMode ? `<button class="btn btn-ghost btn-sm sub-btn" style="font-size:11px"
          data-match-id="${match.id}"
          data-league-id="${leagueId}"
          data-p1-id="${match.player1_id}" data-p1-name="${esc(match.player1_name)}"
          data-p2-id="${match.player2_id}" data-p2-name="${esc(match.player2_name)}"
          data-sub1-id="${match.sub1_id || ''}" data-sub1-name="${esc(match.sub1_name || '')}"
          data-sub2-id="${match.sub2_id || ''}" data-sub2-name="${esc(match.sub2_name || '')}">Sub</button>` : ''}
${adminMode ? `<button class="btn btn-ghost btn-sm skip-btn" style="font-size:11px;color:var(--text-muted)" data-match-id="${match.id}">Skip</button>` : ''}
      </div>
    </div>`;
}

async function saveMatchScore(btn) {
  const matchId = Number(btn.dataset.matchId);
  const p1Id = Number(btn.dataset.p1Id);
  const p2Id = Number(btn.dataset.p2Id);
  const isEditing = btn.dataset.editing === 'true';

  const row = btn.closest('.match-row');

  // If showing saved score and clicking "Edit", switch to edit mode
  if (!isEditing) {
    const scoreDisplay = row.querySelector('.score-display');
    const parts = scoreDisplay.textContent.split('–').map((s) => s.trim());
    row.querySelector('.match-score').innerHTML = `
      ${bo5ScoreInputHTML(parts[0], parts[1])}
      <button class="btn btn-success btn-sm score-save-btn" style="font-size:11px"
        data-match-id="${matchId}" data-p1-id="${p1Id}" data-p2-id="${p2Id}" data-editing="true">Save</button>`;
    row.querySelector('.score-save-btn').addEventListener('click', () =>
      saveMatchScore(row.querySelector('.score-save-btn'))
    );
    return;
  }

  const s1 = Number(row.querySelector('[data-score="p1"]').value);
  const s2 = Number(row.querySelector('[data-score="p2"]').value);

  // 0–0 clears the score back to unscored
  if (s1 === 0 && s2 === 0) {
    await window.api.updateMatchScore({ matchId, player1Score: null, player2Score: null, winnerId: null });
    toast('Score cleared', 'success');
    const playerSpans = row.querySelectorAll('.match-player');
    playerSpans[0].className = 'match-player';
    playerSpans[1].className = 'match-player';
    row.querySelector('.match-score').innerHTML = `
      ${bo5ScoreInputHTML()}
      <button class="btn btn-success btn-sm score-save-btn" style="font-size:11px"
        data-match-id="${matchId}" data-p1-id="${p1Id}" data-p2-id="${p2Id}" data-editing="true">Save</button>`;
    row.querySelector('.score-save-btn').addEventListener('click', () =>
      saveMatchScore(row.querySelector('.score-save-btn'))
    );
    return;
  }

  // Validate Bo5: one player must win exactly 3, the other 0–2
  const valid = Number.isInteger(s1) && Number.isInteger(s2)
    && s1 >= 0 && s1 <= 3 && s2 >= 0 && s2 <= 3
    && (s1 === 3 || s2 === 3)
    && s1 !== s2;
  if (!valid) {
    toast('Invalid score — one player must win 3 games (e.g. 3-1, 2-3)', 'warning');
    return;
  }

  const winnerId = s1 > s2 ? p1Id : p2Id;
  await window.api.updateMatchScore({ matchId, player1Score: s1, player2Score: s2, winnerId });
  toast('Score saved', 'success');

  // Update winner highlight — use index-based querySelectorAll to avoid matching div.match-players
  const playerSpans = row.querySelectorAll('.match-player');
  playerSpans[0].className = `match-player${winnerId === p1Id ? ' winner' : ''}`;
  playerSpans[1].className = `match-player${winnerId === p2Id ? ' winner' : ''}`;

  row.querySelector('.match-score').innerHTML = `
    <span class="score-display">${s1} – ${s2}</span>
    <button class="btn btn-ghost btn-sm score-save-btn" style="font-size:11px;padding:4px 8px"
      data-match-id="${matchId}" data-p1-id="${p1Id}" data-p2-id="${p2Id}" data-editing="false">Edit</button>`;
  row.querySelector('.score-save-btn').addEventListener('click', () =>
    saveMatchScore(row.querySelector('.score-save-btn'))
  );
}

// ===== BOX SCORE MODAL =====
async function openBoxScoreModal(league) {
  const isModern = league.setup_type === 'modern';
  const numRounds = league.num_rounds || 1;
  const weeks = league.weeks || [];
  const weeksPerRound = Math.ceil(weeks.length / numRounds);

  const rounds = [];
  for (let r = 0; r < numRounds; r++) {
    rounds.push(weeks.slice(r * weeksPerRound, (r + 1) * weeksPerRound));
  }

  // Group players by division, same logic as printBoxes
  const divMap = {};
  (league.players || []).forEach((p) => {
    if (!divMap[p.division_level]) {
      divMap[p.division_level] = { name: p.division_name, level: p.division_level, players: [] };
    }
    divMap[p.division_level].players.push(p);
  });
  const divisions = Object.values(divMap)
    .sort((a, b) => a.level - b.level)
    .map((d) => ({
      ...d,
      players: d.players.slice().sort((a, b) =>
        isModern ? (a.skill_rank - b.skill_rank) : (a.team_order - b.team_order)
      ),
    }));

  if (divisions.length === 0) { toast('No divisions found', 'error'); return; }

  const pending = new Map(); // matchId → { player1Score, player2Score, player1Id, player2Id }
  let divIdx = 0;

  function buildRoundsHTML(div) {
    const players = div.players;
    return rounds.map((roundWeeks, roundIdx) => {
      const pairMatch = {};
      roundWeeks.forEach((week) => {
        (week.matchups || []).forEach((mu) => {
          (mu.matches || []).forEach((match) => {
            if (!match.skipped) {
              const key = [match.player1_id, match.player2_id].sort((a, b) => a - b).join('-');
              pairMatch[key] = match;
            }
          });
        });
      });

      const colHeaders = players.map((p) =>
        `<th class="bsm-col-header"><div class="bsm-col-name">${esc(p.player_name)}</div></th>`
      ).join('');

      const rows = players.map((rowP) => {
        const cells = players.map((colP) => {
          if (rowP.player_id === colP.player_id) {
            return '<td class="bsm-cell bsm-cell-self"></td>';
          }
          const key = [rowP.player_id, colP.player_id].sort((a, b) => a - b).join('-');
          const match = pairMatch[key];
          if (!match) {
            return '<td class="bsm-cell bsm-cell-empty"><span class="bsm-empty-dash">–</span></td>';
          }
          const pend = pending.get(match.id);
          const p1s = pend !== undefined ? pend.player1Score : match.player1_score;
          const p2s = pend !== undefined ? pend.player2Score : match.player2_score;
          const isP1 = match.player1_id === rowP.player_id;
          const myScore = (p1s != null && p2s != null) ? (isP1 ? p1s : p2s) : '';
          const theirScore = (p1s != null && p2s != null) ? (isP1 ? p2s : p1s) : '';
          return `<td class="bsm-cell bsm-cell-match"
            data-match-id="${match.id}"
            data-row-player-id="${rowP.player_id}"
            data-col-player-id="${colP.player_id}"
            data-is-p1="${isP1 ? '1' : '0'}"
            data-p1-id="${match.player1_id}"
            data-p2-id="${match.player2_id}">
            <div class="bsm-score-pair">
              <input class="bsm-score-input bsm-input-mine" type="number" min="0" max="3" value="${myScore}" placeholder="–">
              <span class="bsm-score-sep">–</span>
              <input class="bsm-score-input bsm-input-theirs" type="number" min="0" max="3" value="${theirScore}" placeholder="–">
            </div>
          </td>`;
        }).join('');
        return `<tr>
          <td class="bsm-row-header"><div class="bsm-row-name">${esc(rowP.player_name)}</div></td>
          ${cells}
        </tr>`;
      }).join('');

      const roundLabel = numRounds > 1 ? `<div class="bsm-round-label">Round ${roundIdx + 1}</div>` : '';
      return `<div class="bsm-round-block">
        ${roundLabel}
        <div class="bsm-table-wrap">
          <table class="bsm-table">
            <thead><tr><th class="bsm-corner"></th>${colHeaders}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    }).join('');
  }

  function renderBody() {
    const div = divisions[divIdx];
    const divNavHTML = divisions.length > 1 ? `
      <div class="bsm-div-nav">
        <button class="btn btn-ghost btn-sm bsm-nav-prev"${divIdx === 0 ? ' disabled' : ''}>← Prev</button>
        <span class="bsm-div-label">${esc(div.name)}<span class="bsm-div-count">${divIdx + 1} / ${divisions.length}</span></span>
        <button class="btn btn-ghost btn-sm bsm-nav-next"${divIdx === divisions.length - 1 ? ' disabled' : ''}>Next →</button>
      </div>` : `<div class="bsm-div-solo">${esc(div.name)}</div>`;
    return `<div class="bsm-modal">
      ${divNavHTML}
      <div class="bsm-rounds">${buildRoundsHTML(div)}</div>
      <div class="bsm-footer">
        <button class="btn btn-outline" id="bsmDiscard">Discard</button>
        <button class="btn btn-primary" id="bsmSave">Save Changes</button>
      </div>
    </div>`;
  }

  function rerender() {
    document.getElementById('modalBody').innerHTML = renderBody();
    attachHandlers();
  }

  function attachHandlers() {
    document.querySelector('.bsm-nav-prev')?.addEventListener('click', () => {
      if (divIdx > 0) { divIdx--; rerender(); }
    });
    document.querySelector('.bsm-nav-next')?.addEventListener('click', () => {
      if (divIdx < divisions.length - 1) { divIdx++; rerender(); }
    });

    document.querySelectorAll('.bsm-cell-match').forEach((cell) => {
      const matchId = Number(cell.dataset.matchId);
      const isP1 = cell.dataset.isP1 === '1';
      const p1Id = Number(cell.dataset.p1Id);
      const p2Id = Number(cell.dataset.p2Id);
      const rowPlayerId = Number(cell.dataset.rowPlayerId);
      const colPlayerId = Number(cell.dataset.colPlayerId);
      const mineInput = cell.querySelector('.bsm-input-mine');
      const theirsInput = cell.querySelector('.bsm-input-theirs');

      function onInput() {
        const mine = mineInput.value !== '' ? Number(mineInput.value) : null;
        const theirs = theirsInput.value !== '' ? Number(theirsInput.value) : null;
        if (mine !== null || theirs !== null) {
          pending.set(matchId, {
            player1Score: isP1 ? mine : theirs,
            player2Score: isP1 ? theirs : mine,
            player1Id: p1Id,
            player2Id: p2Id,
          });
        } else {
          pending.delete(matchId);
        }
        // Mirror cell
        const mirror = document.querySelector(
          `.bsm-cell-match[data-match-id="${matchId}"][data-row-player-id="${colPlayerId}"][data-col-player-id="${rowPlayerId}"]`
        );
        if (mirror) {
          mirror.querySelector('.bsm-input-mine').value = theirs != null ? String(theirs) : '';
          mirror.querySelector('.bsm-input-theirs').value = mine != null ? String(mine) : '';
        }
      }

      mineInput.addEventListener('input', onInput);
      theirsInput.addEventListener('input', onInput);
    });

    document.getElementById('bsmSave').addEventListener('click', async () => {
      const btn = document.getElementById('bsmSave');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      let saved = 0;
      let skipped = 0;
      try {
        for (const [matchId, data] of pending) {
          const { player1Score, player2Score, player1Id, player2Id } = data;
          if (player1Score == null || player2Score == null) { skipped++; continue; }
          const valid = Number.isInteger(player1Score) && Number.isInteger(player2Score)
            && player1Score >= 0 && player1Score <= 3
            && player2Score >= 0 && player2Score <= 3
            && (player1Score === 3 || player2Score === 3)
            && player1Score !== player2Score;
          if (!valid) { skipped++; continue; }
          const winnerId = player1Score > player2Score ? player1Id : player2Id;
          await window.api.updateMatchScore({ matchId, player1Score, player2Score, winnerId });
          saved++;
        }
        pending.clear();
        if (skipped > 0) toast(`Saved ${saved} score(s); ${skipped} invalid score(s) skipped`, 'warning');
        else toast(`${saved} score(s) saved`, 'success');
        modal.close();
        state.currentLeague = await window.api.getLeague(league.id);
        renderLeagueDetail();
      } catch (e) {
        toast(e.message || 'Failed to save', 'error');
        btn.disabled = false;
        btn.textContent = 'Save Changes';
      }
    });

    document.getElementById('bsmDiscard').addEventListener('click', () => {
      pending.clear();
      modal.close();
    });
  }

  modal.open('Submit Scores — Box View', renderBody(), { wide: true });
  attachHandlers();
}

// ===== SUB MODAL =====
async function openSubModal(btn) {
  const matchId   = Number(btn.dataset.matchId);
  const leagueId  = Number(btn.dataset.leagueId);
  const p1Id      = Number(btn.dataset.p1Id);
  const p1Name    = btn.dataset.p1Name;
  const p2Id      = Number(btn.dataset.p2Id);
  const p2Name    = btn.dataset.p2Name;
  const sub1Id    = btn.dataset.sub1Id ? Number(btn.dataset.sub1Id) : null;
  const sub1Name  = btn.dataset.sub1Name || '';
  const sub2Id    = btn.dataset.sub2Id ? Number(btn.dataset.sub2Id) : null;
  const sub2Name  = btn.dataset.sub2Name || '';

  // Load all players for the picker
  const allPlayers = state.players.length ? state.players : await window.api.getPlayers();

  const playerOptions = (excludeIds) => allPlayers
    .filter((p) => !excludeIds.includes(p.id))
    .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
    .join('');

  const subRowHTML = (slot, origId, origName, _subId, subName) => `
    <div class="sub-slot" style="margin-bottom:18px">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px">
        ${esc(origName)}
        ${subName ? `<span class="sub-badge" style="margin-left:6px">SUB: ${esc(subName)}</span>` : ''}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="form-control sub-select" data-slot="${slot}" data-orig-id="${origId}" style="flex:1">
          <option value="">— No sub (play original player) —</option>
          ${playerOptions([origId])}
        </select>
      </div>
    </div>`;

  modal.open('Manage Subs', `
    <p class="text-muted" style="font-size:13px;margin-bottom:20px">
      Select a substitute for either player. Choose "No sub" to remove an existing sub.
    </p>
    ${subRowHTML(1, p1Id, p1Name, sub1Id, sub1Name)}
    ${subRowHTML(2, p2Id, p2Name, sub2Id, sub2Name)}
    <div class="form-group form-group-check" id="subRemainingGroup">
      <label class="check-label">
        <input type="checkbox" id="subRemaining" checked>
        Apply to all remaining unscored matches for this player
      </label>
    </div>
    <div id="fError" class="form-error"></div>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSubmit">Save</button>
    </div>`);

  // Pre-select existing subs
  const sel1 = document.querySelector('.sub-select[data-slot="1"]');
  const sel2 = document.querySelector('.sub-select[data-slot="2"]');
  if (sub1Id) sel1.value = sub1Id;
  if (sub2Id) sel2.value = sub2Id;

  // Show "apply remaining" only when a sub is actually selected
  const updateRemainingVisibility = () => {
    const anySubSelected = sel1.value !== '' || sel2.value !== '';
    document.getElementById('subRemainingGroup').style.display = anySubSelected ? '' : 'none';
  };
  updateRemainingVisibility();
  sel1.addEventListener('change', updateRemainingVisibility);
  sel2.addEventListener('change', updateRemainingVisibility);

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const applyRemaining = document.getElementById('subRemaining').checked;
    const saves = [];

    for (const sel of [sel1, sel2]) {
      const origId = Number(sel.dataset.origId);
      const subVal = sel.value ? Number(sel.value) : null;

      if (subVal) {
        saves.push(window.api.setMatchSub({ matchId, originalPlayerId: origId, subPlayerId: subVal }));
        if (applyRemaining) {
          saves.push(window.api.setSubRemaining({ leagueId, originalPlayerId: origId, subPlayerId: subVal }));
        }
      } else {
        // No sub selected — remove if there was one
        saves.push(window.api.removeMatchSub({ matchId, originalPlayerId: origId }));
      }
    }

    try {
      await Promise.all(saves);
      modal.close();
      toast('Subs updated', 'success');
      reloadLeagueDetail();
    } catch (e) {
      document.getElementById('fError').textContent = e.message || 'Failed to save subs.';
    }
  });
}
