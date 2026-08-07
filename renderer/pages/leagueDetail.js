import { state, isAdmin } from '../state.js';
import { esc, formatDate, formatShortDate, toast, modal } from '../utils.js';
import { printBoxes, copyPublicLink, openMessagePlayersModal, openBulkInviteModal, printSchedule, confirmDeleteLeague } from './leagues.js';

let leagueEditMode = false;
export function resetLeagueEditMode() { leagueEditMode = false; }

// View state for the league page: which tab is showing and which division is
// selected. One division selection serves both Standings and Schedule;
// Standings has no all-divisions table, so it falls back to a concrete
// division there. Keyed to the league id so state never leaks between leagues.
let _leagueTab = 'standings';
let _leagueDivision = 'all';
let _leagueViewFor = null;

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

// Played/total for a week, counting only matches that can still be played.
function _weekCounts(week) {
  let total = 0;
  let played = 0;
  for (const mu of (week.matchups || [])) {
    for (const m of (mu.matches || [])) {
      if (m.skipped) continue;
      total++;
      if (m.player1_score != null && m.player2_score != null) played++;
    }
  }
  return { total, played };
}

function _weekSummary({ total, played }) {
  if (total === 0) return 'No matches';
  if (played === 0) return 'Not played yet';
  if (played === total) return `All ${total} played`;
  return `${played} of ${total} played`;
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
        <button class="options-item" data-action="bulk-invite">Send Account Invites</button>
        ${league.status !== 'completed' ? `<button class="options-item options-item-danger" data-action="end-league">End League</button>` : ''}
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
      } else if (action === 'bulk-invite') {
        document.getElementById('optionsDropdown').classList.remove('open');
        openBulkInviteModal(league);
      } else if (action === 'end-league') {
        document.getElementById('optionsDropdown').classList.remove('open');
        modal.open('End League', `
          <p>End <strong>${esc(league.name)}</strong>? All unreported matches will be skipped, and players will no longer be able to report scores. Reported scores will not be affected.</p>
          <div class="form-actions">
            <button class="btn btn-outline" id="fCancel">Cancel</button>
            <button class="btn btn-danger" id="fConfirm">End League</button>
          </div>`);
        document.getElementById('fCancel').addEventListener('click', modal.close);
        document.getElementById('fConfirm').addEventListener('click', async () => {
          try {
            await window.api.endLeague(league.id);
            modal.close();
            toast('League ended');
            await reloadLeagueDetail();
          } catch (err) {
            toast(err.message || 'Failed to end league', 'error');
          }
        });
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

  // Arriving at a different league resets the view to its defaults.
  if (_leagueViewFor !== league.id) {
    _leagueViewFor = league.id;
    _leagueTab = 'standings';
    _leagueDivision = 'all';
  }
  if (_leagueTab === 'players' && !adminMode) _leagueTab = 'standings';

  const weeks = league.weeks || [];
  const divisions = (league.divisions || []).slice().sort((a, b) => a.level - b.level);

  const myId = state.currentUser?.playerId;
  const myDivision = (league.players || []).find((p) => p.player_id === myId)?.division_id ?? null;
  const fallbackDivision = String(myDivision ?? divisions[0]?.id ?? 'all');
  // With no All option the selection is always a concrete division.
  if (_leagueDivision === 'all') _leagueDivision = fallbackDivision;

  // ----- hero -----
  // The current week is decided by the calendar: a week becomes current on its
  // own date and stays current until the next week's date arrives, regardless
  // of how many of its matches have been reported. Before the first week's
  // date, week 1 is the one coming up.
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let currentIdx = -1;
  weeks.forEach((w, i) => { if (String(w.date).slice(0, 10) <= todayIso) currentIdx = i; });
  if (currentIdx === -1 && weeks.length > 0) currentIdx = 0;
  const leagueDone = league.status === 'completed';
  const currentWeekId = !leagueDone && currentIdx >= 0 ? weeks[currentIdx].id : null;

  const endDate = weeks.length > 0 ? weeks[weeks.length - 1].date : null;
  const dateRange = endDate
    ? `${formatShortDate(league.start_date)} – ${formatShortDate(endDate)}`
    : formatShortDate(league.start_date);
  const weekday = weeks.length
    ? new Date(String(weeks[0].date).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }) + 's'
    : null;

  const metaBits = (isModern
    ? [`${league.num_divisions} division${league.num_divisions === 1 ? '' : 's'}`, `${numPlayers} players`, weekday]
    : [`${league.num_teams} teams`, `${league.num_divisions} division${league.num_divisions === 1 ? '' : 's'}`, `${numPlayers} players`, weekday]
  ).filter(Boolean).join(' · ');

  const segsHTML = weeks.map((w, i) => {
    const cls = leagueDone || i < currentIdx ? ' lg-seg-done' : i === currentIdx ? ' lg-seg-now' : '';
    return `<span class="lg-seg${cls}"></span>`;
  }).join('');

  const weekLabel = weeks.length
    ? `Week ${leagueDone ? weeks.length : currentIdx + 1} of ${weeks.length}`
    : '';

  const heroHTML = `
    <div class="lg-hero">
      <div class="lg-hero-left">
        <div class="lg-hero-title">
          <h2>${esc(league.name)}</h2>
          <span class="lg-status">${esc(String(league.status || 'active').toUpperCase())}</span>
        </div>
        ${metaBits ? `<span class="lg-hero-meta">${metaBits}</span>` : ''}
      </div>
      ${weeks.length ? `
      <div class="lg-progress">
        <div class="lg-progress-top">
          <span class="lg-progress-week">${weekLabel}</span>
          <span class="lg-progress-dates">${dateRange}</span>
        </div>
        <div class="lg-segs">${segsHTML}</div>
      </div>` : ''}
    </div>`;

  // ----- tab bar + division pills -----
  // The pills keep #schFilter and .std-tab[data-div-id]: they are the same
  // control the schedule filter has always been, now shared with Standings.
  const pillsHTML = divisions.length > 1 ? `
    <div class="sch-filter lg-pills" id="schFilter">
      ${divisions.map((d) => `<button class="std-tab lg-pill" data-div-id="${d.id}">${esc(d.name)}</button>`).join('')}
    </div>` : '';

  const tabsHTML = `
    <div class="lg-tabbar">
      <div class="lg-tabs" id="lgTabs">
        <button class="lg-tab" data-lg-tab="standings">Standings</button>
        <button class="lg-tab" data-lg-tab="schedule">Schedule</button>
        ${adminMode ? `<button class="lg-tab" data-lg-tab="players">Players</button>` : ''}
      </div>
      ${pillsHTML}
    </div>`;

  const rosterHint = leagueEditMode
    ? 'Edit mode on. Replace swaps a player out and hands their fixtures and history to the new player.'
    : 'Division rosters in seeded order. Use <strong>Edit Players</strong> in the top bar to swap a player out.';

  content.innerHTML = `
    <div class="lg-page">
      ${heroHTML}
      ${tabsHTML}
      <div class="lg-panel" id="lgPanelStandings">
        ${renderStandings(league)}
      </div>
      <div class="lg-panel" id="lgPanelSchedule" hidden>
        <div class="schedule-list${adminMode ? ' is-admin' : ''}" id="scheduleList">
          ${weeks.map((w) => renderWeekCard(w, league, adminMode, w.id === currentWeekId)).join('')}
        </div>
      </div>
      ${adminMode ? `
      <div class="lg-panel" id="lgPanelPlayers" hidden>
        <div class="lg-roster-hint">
          <span class="lg-roster-hint-text">${rosterHint}</span>
        </div>
        ${isModern ? renderRostersModern(league, leagueEditMode) : renderRosters(league, leagueEditMode)}
      </div>` : ''}
    </div>`;

  // ----- view state application: tabs + the shared division selector -----
  const tabsEl = content.querySelector('#lgTabs');
  const pillsEl = content.querySelector('#schFilter');
  const panels = {
    standings: content.querySelector('#lgPanelStandings'),
    schedule: content.querySelector('#lgPanelSchedule'),
    players: content.querySelector('#lgPanelPlayers'),
  };

  const applyDivision = () => {
    const divId = _leagueDivision;
    if (pillsEl) {
      pillsEl.querySelectorAll('.std-tab').forEach((p) => p.classList.toggle('active', p.dataset.divId === divId));
    }
    // Schedule rows: the filtering behaviour #schFilter has always had, now
    // always scoped to one division.
    if (isModern) {
      content.querySelectorAll('#scheduleList .matchup-block[data-division-id]').forEach((block) => {
        block.hidden = block.dataset.divisionId !== divId;
      });
    } else {
      content.querySelectorAll('#scheduleList .match-row').forEach((row) => {
        row.hidden = row.dataset.divisionId !== divId;
      });
      content.querySelectorAll('#scheduleList .matchup-block').forEach((block) => {
        block.hidden = !block.querySelector('.match-row:not([hidden])');
      });
    }
    // Standings panels: the .std-panel.active toggle, as before.
    content.querySelectorAll('.std-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.divId === divId);
    });
  };

  const applyTab = () => {
    tabsEl.querySelectorAll('.lg-tab').forEach((t) => t.classList.toggle('active', t.dataset.lgTab === _leagueTab));
    for (const [key, el] of Object.entries(panels)) {
      if (el) el.hidden = key !== _leagueTab;
    }
    // The pills stay in the layout on Players (visibility, not display), so
    // the bar keeps the same height on every tab.
    if (pillsEl) pillsEl.classList.toggle('lg-pills-off', _leagueTab === 'players');
    applyDivision();
  };

  tabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.lg-tab');
    if (!tab) return;
    _leagueTab = tab.dataset.lgTab;
    applyTab();
  });

  if (pillsEl) {
    pillsEl.addEventListener('click', (e) => {
      const pill = e.target.closest('.std-tab');
      if (!pill) return;
      _leagueDivision = pill.dataset.divId;
      applyDivision();
    });
  }

  applyTab();

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

  // Standings + schedule player name links
  content.querySelectorAll('.nav-player-link').forEach((el) => {
    el.addEventListener('click', () => window.openPlayerProfile(Number(el.dataset.playerId)));
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
  const myId = state.currentUser?.playerId;
  return `<div class="roster-grid lg-rosters">
    ${league.teams.map((team) => {
      const members = (league.players || [])
        .filter((p) => p.team_id === team.id)
        .sort((a, b) => a.division_level - b.division_level);
      return `
        <div class="roster-team-card lg-roster-card">
          <div class="lg-card-head">
            <span class="lg-card-label">${esc(team.name)}</span>
            <span class="lg-card-meta">${members.length} player${members.length === 1 ? '' : 's'}</span>
          </div>
          ${members.map((m) => {
            const isMe = myId != null && m.player_id === myId;
            return `
            <div class="roster-player lg-roster-row${isMe ? ' lg-me' : ''}">
              <span class="div-chip">${esc(m.division_name.replace(/^Division\s*/i, 'D'))}</span>
              <a class="player-link" data-player-id="${m.player_id}" href="#">${esc(m.player_name)}</a>
              ${isMe ? '<span class="lg-you">YOU</span>' : ''}
              ${editMode ? `<button class="replace-btn lg-replace" data-player-id="${m.player_id}" data-player-name="${esc(m.player_name)}">Replace</button>` : ''}
            </div>`;
          }).join('')}
        </div>`;
    }).join('')}
  </div>`;
}

function renderRostersModern(league, editMode = false) {
  if (!league.divisions || league.divisions.length === 0) return '';
  const myId = state.currentUser?.playerId;
  return `<div class="roster-grid lg-rosters">
    ${league.divisions.map((div) => {
      const members = (league.players || [])
        .filter((p) => p.division_id === div.id)
        .sort((a, b) => a.skill_rank - b.skill_rank);
      return `
        <div class="roster-team-card lg-roster-card">
          <div class="lg-card-head">
            <span class="lg-card-label">${esc(div.name)}</span>
            <span class="lg-card-meta">${members.length} player${members.length === 1 ? '' : 's'}</span>
          </div>
          ${members.map((m, i) => {
            const isMe = myId != null && m.player_id === myId;
            return `
            <div class="roster-player lg-roster-row${isMe ? ' lg-me' : ''}">
              <span class="lg-seed">${i + 1}</span>
              <a class="player-link" data-player-id="${m.player_id}" href="#">${esc(m.player_name)}</a>
              ${isMe ? '<span class="lg-you">YOU</span>' : ''}
              ${editMode ? `<button class="replace-btn lg-replace" data-player-id="${m.player_id}" data-player-name="${esc(m.player_name)}">Replace</button>` : ''}
            </div>`;
          }).join('')}
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

  const myId = state.currentUser?.playerId;

  // One card per division; the shared division selector decides which panel is
  // .active, so every panel stays in the DOM as before.
  const panelsHTML = divIds.map((id) => {
    const { division, players } = standings[id];
    const matchesPlayed = Math.round(players.reduce((sum, p) => sum + p.played, 0) / 2);
    const rows = players.map((p, idx) => {
      const isMe = myId != null && p.playerId === myId;
      const gdText = p.gameDiff > 0 ? `+${p.gameDiff}` : p.gameDiff < 0 ? `−${Math.abs(p.gameDiff)}` : '0';
      const gdClass = p.gameDiff > 0 ? ' lg-gd-pos' : p.gameDiff < 0 ? ' lg-gd-neg' : '';
      const rankClass = isMe ? ' lg-rank-me' : idx === 0 ? ' lg-rank-first' : '';
      return `
        <div class="lg-std-row${isMe ? ' lg-me' : ''}">
          <span class="lg-std-rank${rankClass}">${idx + 1}</span>
          <span class="lg-std-name">
            <span class="nav-player-link${isMe ? ' lg-name-me' : ''}" data-player-id="${p.playerId}">${esc(p.name)}</span>
            ${isMe ? '<span class="lg-you">YOU</span>' : ''}
          </span>
          <span class="lg-std-w">${p.wins}</span>
          <span class="lg-std-l">${p.losses}</span>
          <span class="lg-std-gd${gdClass}">${gdText}</span>
          <span class="lg-std-gp">${p.played}</span>
        </div>`;
    }).join('');
    return `
      <div class="std-panel lg-std-card" data-div-id="${id}">
        <div class="lg-card-head">
          <span class="lg-card-label">${esc(division.name)} standings</span>
          <span class="lg-card-meta">${players.length} player${players.length === 1 ? '' : 's'} · ${matchesPlayed} match${matchesPlayed === 1 ? '' : 'es'} played</span>
        </div>
        <div class="lg-std-cols">
          <span>#</span><span>Player</span><span>W</span><span>L</span><span>GD</span><span>GP</span>
        </div>
        ${rows}
      </div>`;
  }).join('');

  return `<div class="std-container lg-std">${panelsHTML}</div>`;
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

function renderWeekCard(week, league, adminMode = true, isCurrent = false) {
  if (league.setup_type === 'modern') return renderWeekCardModern(week, league, adminMode, isCurrent);

  const summary = _weekSummary(_weekCounts(week));
  const matchupsHTML = week.matchups.map((mu) => {
    if (mu.bye_team_id) {
      return `
        <div class="matchup-block lg-group">
          <div class="matchup-title lg-group-title">${esc(mu.bye_team_name)} <span class="bye-badge">BYE</span></div>
        </div>`;
    }
    return `
      <div class="matchup-block lg-group">
        <div class="matchup-title lg-group-title">
          ${esc(mu.team1_name)} <span class="vs-badge">VS</span> ${esc(mu.team2_name)}
        </div>
        <div class="lg-matches">
          ${mu.matches.map((m) => renderMatchRow(m, league, adminMode)).join('')}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="week-card lg-week${isCurrent ? ' lg-week-current' : ''}" data-week-id="${week.id}">
      <div class="week-header lg-week-header">
        <div class="lg-week-lead">
          <span class="lg-week-num">Week ${week.week_number}</span>
          ${isCurrent ? '<span class="lg-thisweek">THIS WEEK</span>' : ''}
        </div>
        <span class="lg-week-date">${formatDate(week.date)}</span>
        <span class="lg-week-summary">${summary}</span>
        <svg class="week-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      <div class="week-body lg-week-body">${matchupsHTML}</div>
    </div>`;
}

function renderWeekCardModern(week, league, adminMode = true, isCurrent = false) {
  const summary = _weekSummary(_weekCounts(week));
  const byes = week.byes || [];
  const matchupsHTML = week.matchups.map((mu) => {
    const divByes = byes.filter((b) => b.division_id === mu.division_id);
    const byesHTML = divByes.length
      ? `<div class="matchup-byes">Bye: ${divByes.map((b) => esc(b.player_name)).join(', ')}</div>` : '';
    return `
      <div class="matchup-block lg-group" data-division-id="${mu.division_id}">
        <div class="matchup-title lg-group-title">${esc(mu.division_name)}</div>
        <div class="lg-matches">
          ${mu.matches.map((m) => renderMatchRow(m, league, adminMode)).join('')}
        </div>
        ${byesHTML}
      </div>`;
  }).join('');

  return `
    <div class="week-card lg-week${isCurrent ? ' lg-week-current' : ''}" data-week-id="${week.id}">
      <div class="week-header lg-week-header">
        <div class="lg-week-lead">
          <span class="lg-week-num">Week ${week.week_number}</span>
          ${isCurrent ? '<span class="lg-thisweek">THIS WEEK</span>' : ''}
        </div>
        <span class="lg-week-date">${formatDate(week.date)}</span>
        <span class="lg-week-summary">${summary}</span>
        <svg class="week-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
      <div class="week-body lg-week-body">${matchupsHTML}</div>
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
  const timingLabel = adminMode && newCourtName
    ? `${newCourtName}${match.match_time ? ' · ' + match.match_time : ''}`
    : (adminMode && league?.schedule_courts && match.court_number
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
    ? `<span ${timingAttrs}>${timingLabel || 'Set time'}</span>`
    : `<span class="match-court-label"></span>`;

  // The row-level division chip only earns its place in box leagues, where a
  // group holds matches from several divisions; modern groups are the division.
  const divChip = league.setup_type !== 'modern'
    ? `<span class="match-div-label">${esc(match.division_name.replace(/^Division\s*/i, 'D'))}</span>` : '';

  const isSkipped = !!match.skipped;
  const leagueId = league ? league.id : '';

  if (isSkipped) {
    return `
      <div class="match-row lg-match lg-match-skipped" data-match-id="${match.id}" data-division-id="${match.division_id}">
        ${divChip}
        <span class="match-court-label"></span>
        <span class="lg-players">
          <span class="match-p1 match-player nav-player-link" data-player-id="${match.sub1_id || match.player1_id}">${esc(eff1Name)}</span>
          <span class="match-vs">vs</span>
          <span class="match-p2 match-player nav-player-link" data-player-id="${match.sub2_id || match.player2_id}">${esc(eff2Name)}</span>
        </span>
        <div class="match-actions">
          <span class="match-skipped-label">Skipped</span>
          ${adminMode ? `<button class="btn btn-ghost btn-sm unskip-btn lg-ghost" data-match-id="${match.id}">Undo</button>` : ''}
        </div>
      </div>`;
  }

  let scoreSection;
  if (hasScore) {
    scoreSection = `<div class="match-score">
         <span class="score-display">${match.player1_score} – ${match.player2_score}</span>
         ${adminMode ? `<button class="btn btn-ghost btn-sm score-save-btn lg-ghost"
           data-match-id="${match.id}" data-p1-id="${match.player1_id}" data-p2-id="${match.player2_id}" data-editing="false">Edit</button>` : ''}
       </div>`;
  } else if (adminMode) {
    scoreSection = `<div class="match-score">
         ${bo5ScoreInputHTML()}
         <button class="btn btn-success btn-sm score-save-btn lg-save"
           data-match-id="${match.id}" data-p1-id="${match.player1_id}" data-p2-id="${match.player2_id}" data-editing="true">Save</button>
       </div>`;
  } else {
    scoreSection = `<div class="match-score">
      <span class="lg-notplayed">Not played</span>
    </div>`;
  }

  return `
    <div class="match-row lg-match${hasScore ? ' lg-match-scored' : ''}" data-match-id="${match.id}" data-division-id="${match.division_id}">
      ${divChip}
      ${courtInfo}
      <span class="lg-players">
        <span class="match-p1 match-player nav-player-link${p1Won ? ' winner' : ''}" data-player-id="${match.sub1_id || match.player1_id}">${p1SubBadge}${esc(eff1Name)}</span>
        <span class="match-vs">vs</span>
        <span class="match-p2 match-player nav-player-link${p2Won ? ' winner' : ''}" data-player-id="${match.sub2_id || match.player2_id}">${p2SubBadge}${esc(eff2Name)}</span>
      </span>
      <div class="match-actions">
        ${scoreSection}
        ${adminMode ? `<button class="btn btn-ghost btn-sm sub-btn lg-ghost"
          data-match-id="${match.id}"
          data-league-id="${leagueId}"
          data-p1-id="${match.player1_id}" data-p1-name="${esc(match.player1_name)}"
          data-p2-id="${match.player2_id}" data-p2-name="${esc(match.player2_name)}"
          data-sub1-id="${match.sub1_id || ''}" data-sub1-name="${esc(match.sub1_name || '')}"
          data-sub2-id="${match.sub2_id || ''}" data-sub2-name="${esc(match.sub2_name || '')}">Sub</button>` : ''}
        ${adminMode ? `<button class="btn btn-ghost btn-sm skip-btn lg-ghost lg-ghost-muted" data-match-id="${match.id}">Skip</button>` : ''}
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
