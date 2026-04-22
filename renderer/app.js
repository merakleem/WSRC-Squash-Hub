// ===== WEB API SHIM (active when running in browser, not Electron) =====
if (typeof window !== 'undefined' && !window.api) {
  async function _apiFetch(method, url, body = null) {
    const opts = { method };
    if (body !== null) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  window.api = {
    getPlayers:       ()  => _apiFetch('GET',    '/api/players'),
    addPlayer:        (d) => _apiFetch('POST',   '/api/players', d),
    updatePlayer:     (d) => _apiFetch('PUT',    `/api/players/${d.id}`, d),
    deletePlayer:     (id)=> _apiFetch('DELETE', `/api/players/${id}`),

    getLeagues:       ()  => _apiFetch('GET',    '/api/leagues'),
    getLeague:        (id)=> _apiFetch('GET',    `/api/leagues/${id}`),
    createLeague:     (d) => _apiFetch('POST',   '/api/leagues', d),
    deleteLeague:     (id)=> _apiFetch('DELETE', `/api/leagues/${id}`),

    updateMatchScore: (d) => _apiFetch('PUT',    `/api/matches/${d.matchId}/score`, d),
    setMatchSub:      (d) => _apiFetch('PUT',    `/api/matches/${d.matchId}/sub`, d),
    removeMatchSub:   (d) => _apiFetch('DELETE', `/api/matches/${d.matchId}/sub`, d),
    setSubRemaining:  (d) => _apiFetch('PUT',    `/api/leagues/${d.leagueId}/sub-remaining`, d),
    getValidConfigs:  (n) => _apiFetch('GET',    `/api/configs/${n}`),

    getLadder:        ()    => _apiFetch('GET', '/api/ladder'),
    getPlayerHistory: (id)  => _apiFetch('GET', `/api/players/${id}/history`),
    getPlayerRecords: ()    => _apiFetch('GET', '/api/players/records'),
    replacePlayer:    (d)   => _apiFetch('POST', `/api/leagues/${d.leagueId}/replace-player`, d),
    updateMatchTiming:(d)   => _apiFetch('PUT',  `/api/matches/${d.matchId}/timing`, d),
    sendInvite:        (id) => _apiFetch('POST', `/api/players/${id}/send-invite`),
    sendReset:         (id) => _apiFetch('POST', `/api/players/${id}/send-reset`),
    reportPlayerScore: (d)  => _apiFetch('PUT',  `/api/matches/${d.matchId}/player-score`, d),
    getActivity:        (days) => _apiFetch('GET', `/api/activity${days ? `?days=${days}` : ''}`),
  };
}

// ===== STATE =====
const state = {
  page: 'players',        // 'players' | 'ladder' | 'leagues' | 'leagueDetail' | 'createLeague' | 'playerProfile'
  prevPage: null,
  players: [],
  ladder: [],             // [{ id, name, position }] in ladder order
  leagues: [],
  currentLeague: null,
  currentPlayer: null,    // { id, name, email, phone, wins, losses, history: [...] }
  currentUser: null,      // { role: 'admin'|'player', playerId: number|null }
  wizard: {
    step: 1,
    setupType: 'traditional',
    leagueName: '',
    startDate: '',
    rankedPlayers: [],    // [{ id, name }] ordered best → worst
    // Traditional
    numTeams: 3,
    numDivisions: 1,
    teamNames: [],        // custom names; index matches team slot
    // Modern
    modernNumDivisions: 2,
    modernDivisionPlayers: null,
    // Shared
    numRounds: 1,
    blackoutDates: [],
    matchStartTime: '19:00',
    numCourts: 2,
    matchDuration: 45,
    matchBuffer: 15,
    scheduleCourts: false,
  },
};

// ===== ROLE HELPERS =====
const isAdmin = () => state.currentUser?.role === 'admin';

let leagueEditMode = false;

// ===== UTILS =====
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ===== TOAST =====
function toast(msg, type = 'default') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }, 3000);
}

// ===== MODAL =====
const modal = {
  open(title, bodyHTML, { wide = false } = {}) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHTML;
    document.getElementById('modal').classList.toggle('modal-wide', wide);
    document.getElementById('modalOverlay').classList.add('open');
  },
  close() {
    document.getElementById('modal').classList.remove('modal-wide');
    document.getElementById('modalOverlay').classList.remove('open');
  },
};

document.getElementById('modalClose').addEventListener('click', () => modal.close());
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modalOverlay')) modal.close();
});

// ===== NAVIGATION =====
function navigate(page, params = {}) {
  if (page !== 'leagueDetail') leagueEditMode = false;
  state.prevPage = state.page;
  state.page = page;
  if (params.league) state.currentLeague = params.league;
  if (params.player) state.currentPlayer = params.player;

  // Sidebar active state
  const isOwnProfile = page === 'playerProfile' && state.currentPlayer?.id === state.currentUser?.playerId;
  const navPage = (page === 'leagueDetail' || page === 'createLeague') ? 'leagues'
    : isOwnProfile ? 'myProfile'
    : page === 'playerProfile' ? 'players'
    : page === 'myProfile' ? 'myProfile'
    : page;
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === navPage);
  });

  // Back button
  const btnBack = document.getElementById('btnBack');
  const showBack = !isOwnProfile && (page === 'leagueDetail' || page === 'createLeague' || page === 'playerProfile');
  btnBack.style.display = showBack ? 'inline-flex' : 'none';

  renderPage();
}

document.getElementById('btnBack').addEventListener('click', () => {
  if (state.page === 'leagueDetail' || state.page === 'createLeague') {
    navigate('leagues');
  } else if (state.page === 'playerProfile') {
    navigate(state.prevPage || 'players');
  }
});

document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', () => navigate(el.dataset.page));
});

function renderPage() {
  document.querySelector('.content').classList.remove('content--dashboard');
  switch (state.page) {
    case 'dashboard':     renderDashboard(); break;
    case 'players':       renderPlayers(); break;
    case 'ladder':        renderLadder(); break;
    case 'activity':      renderClubActivity(); break;
    case 'leagues':       renderLeagues(); break;
    case 'leagueDetail':  renderLeagueDetail(); break;
    case 'createLeague':  renderCreateLeague(); break;
    case 'playerProfile': renderPlayerProfile(); break;
  }
}

// ===== DASHBOARD =====
function abbrevName(name) {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length === 1) return name;
  return parts[0][0] + '. ' + parts[parts.length - 1];
}

function timeAgo(utcStr) {
  if (!utcStr) return '';
  const ms = Date.now() - new Date(utcStr.replace(' ', 'T') + 'Z').getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(utcStr.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildActivityHTML(activity, isAdmin = false) {
  if (!activity || activity.length === 0) {
    return `<div class="dp-activity-scroll"><div class="dp-right-empty">No activity in the past 7 days.</div></div>`;
  }
  const items = activity.map((m) => {
    const p1Won = m.winner_id === m.player1_id;
    const winnerName  = abbrevName(p1Won ? m.p1_name : m.p2_name);
    const loserName   = abbrevName(p1Won ? m.p2_name : m.p1_name);
    const winnerPos   = p1Won ? m.p1_pos : m.p2_pos;
    const loserPos    = p1Won ? m.p2_pos : m.p1_pos;
    const winnerScore = p1Won ? m.player1_score : m.player2_score;
    const loserScore  = p1Won ? m.player2_score : m.player1_score;
    const winnerLabel = winnerPos ? `(#${winnerPos}) ` : '';
    const loserLabel  = loserPos  ? `(#${loserPos}) ` : '';
    const submittedBy = isAdmin
      ? `<div class="dp-activity-by">Submitted by ${esc(m.submitted_by_name || 'Admin')}</div>`
      : '';
    const movesUp = m.places_moved > 0
      ? `<div class="dp-activity-moves">↑ ${esc(winnerName)} moves up ${m.places_moved} place${m.places_moved !== 1 ? 's' : ''}</div>`
      : '';
    return `<div class="dp-activity-item">
      <div class="dp-activity-text">
        <span class="dp-activity-winner">${esc(winnerLabel)}${esc(winnerName)}</span>
        <span class="dp-activity-verb"> beat </span>
        <span>${esc(loserLabel)}${esc(loserName)}</span>
        <span class="dp-activity-score"> ${winnerScore}–${loserScore}</span>
      </div>
      <div class="dp-activity-time">${esc(timeAgo(m.confirmed_at))}</div>
      ${movesUp}
      ${submittedBy}
    </div>`;
  }).join('');
  return `<div class="dp-activity-scroll">${items}</div>`;
}

// ===== CLUB ACTIVITY PAGE =====
async function renderClubActivity(days = 7) {
  document.getElementById('pageTitle').textContent = 'Club Activity';
  document.getElementById('topbarActions').innerHTML = '';

  const content = document.getElementById('mainContent');
  content.innerHTML = `<div class="ca-loading">Loading…</div>`;

  const activity = await window.api.getActivity(days);

  const itemsHTML = (activity && activity.length > 0) ? activity.map((m) => {
    const p1Won      = m.winner_id === m.player1_id;
    const winnerName = abbrevName(p1Won ? m.p1_name : m.p2_name);
    const loserName  = abbrevName(p1Won ? m.p2_name : m.p1_name);
    const winnerPos  = p1Won ? m.p1_pos : m.p2_pos;
    const loserPos   = p1Won ? m.p2_pos : m.p1_pos;
    const wScore     = p1Won ? m.player1_score : m.player2_score;
    const lScore     = p1Won ? m.player2_score : m.player1_score;
    const wLabel     = winnerPos ? `(#${winnerPos}) ` : '';
    const lLabel     = loserPos  ? `(#${loserPos}) ` : '';
    const movesUp    = m.places_moved > 0
      ? `<div class="ca-item-moves">↑ ${esc(winnerName)} moves up ${m.places_moved} place${m.places_moved !== 1 ? 's' : ''}</div>`
      : '';
    const submittedBy = isAdmin()
      ? `<div class="ca-item-by">Submitted by ${esc(m.submitted_by_name || 'Admin')}</div>`
      : '';
    return `
      <div class="ca-item">
        <div class="ca-item-main">
          <span class="ca-winner">${esc(wLabel)}${esc(winnerName)}</span>
          <span class="ca-verb"> beat </span>
          <span class="ca-loser">${esc(lLabel)}${esc(loserName)}</span>
          <span class="ca-score"> ${wScore}–${lScore}</span>
        </div>
        <div class="ca-item-meta">
          <span class="ca-time">${esc(timeAgo(m.confirmed_at))}</span>
          ${movesUp}${submittedBy}
        </div>
      </div>`;
  }).join('') : `<div class="ca-empty">No activity in the past ${days} day${days !== 1 ? 's' : ''}.</div>`;

  const loadMoreDays   = days === 7 ? 30 : days === 30 ? 90 : days === 90 ? 365 : null;
  const loadMoreLabel  = loadMoreDays === 30 ? 'Load last 30 days' : loadMoreDays === 90 ? 'Load last 90 days' : loadMoreDays === 365 ? 'Load last year' : null;
  const loadMoreHTML   = loadMoreLabel
    ? `<div class="ca-load-more"><button class="btn btn-secondary" id="btnLoadMore">${loadMoreLabel}</button></div>`
    : '';

  content.innerHTML = `
    <div class="ca-wrap">
      <div class="section-title">
        Last ${days} day${days !== 1 ? 's' : ''}
        <span class="divider"></span>
        <span class="ca-count">${activity.length} match${activity.length !== 1 ? 'es' : ''}</span>
      </div>
      <div class="ca-list">${itemsHTML}</div>
      ${loadMoreHTML}
    </div>`;

  if (loadMoreLabel) {
    document.getElementById('btnLoadMore').addEventListener('click', () => renderClubActivity(loadMoreDays));
  }
}

async function renderDashboard() {
  document.getElementById('pageTitle').textContent = 'Dashboard';
  document.getElementById('topbarActions').innerHTML = '';
  document.querySelector('.content').classList.add('content--dashboard');
  const content = document.getElementById('mainContent');
  content.innerHTML = `<div class="dashboard-loading">Loading…</div>`;

  const user = state.currentUser;

  if (!user || user.role === 'admin') {
    const activity = await window.api.getActivity();
    content.innerHTML = `
      <div class="dp-wrap">
        <div class="dp-columns">
          <div class="dp-main">
            <div class="dash-admin">
              <div class="dash-admin-hero">
                <div class="dash-greeting">Welcome Back.</div>
                <div class="dash-greeting-sub">Manage players, leagues, and schedules from here.</div>
              </div>
              <div class="dash-admin-grid">
                <button class="dash-admin-card" onclick="navigate('players')">
                  <div class="dash-admin-card-icon"><svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="#3b8fc8"><path d="M7 14s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1H7zm4-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path fill-rule="evenodd" d="M5.216 14A2.238 2.238 0 0 1 5 13c0-1.355.68-2.75 1.936-3.72A6.325 6.325 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1h4.216z"/><path d="M4.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></svg></div>
                  <div class="dash-admin-card-label">Manage Players</div>
                  <div class="dash-admin-card-sub">View, add, and edit players</div>
                </button>
                <button class="dash-admin-card" onclick="navigate('leagues')">
                  <div class="dash-admin-card-icon"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 9H21M7 3V5M17 3V5M6 13H8M6 17H8M11 13H13M11 17H13M16 13H18M16 17H18M6.2 21H17.8C18.9201 21 19.4802 21 19.908 20.782C20.2843 20.5903 20.5903 20.2843 20.782 19.908C21 19.4802 21 18.9201 21 17.8V8.2C21 7.07989 21 6.51984 20.782 6.09202C20.5903 5.71569 20.2843 5.40973 19.908 5.21799C19.4802 5 18.9201 5 17.8 5H6.2C5.0799 5 4.51984 5 4.09202 5.21799C3.71569 5.40973 3.40973 5.71569 3.21799 6.09202C3 6.51984 3 7.07989 3 8.2V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.07989 21 6.2 21Z" stroke="#3b8fc8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                  <div class="dash-admin-card-label">Manage Leagues</div>
                  <div class="dash-admin-card-sub">Create leagues and enter scores</div>
                </button>
                <button class="dash-admin-card" onclick="navigate('ladder')">
                  <div class="dash-admin-card-icon"><svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="#3b8fc8"><path fill-rule="evenodd" clip-rule="evenodd" d="M2 0V16H4V14H12V16H14V0H12V2H4V0H2ZM4 4V7H12V4H4ZM12 12H4V9H12V12Z"/></svg></div>
                  <div class="dash-admin-card-label">Player Rankings</div>
                  <div class="dash-admin-card-sub">View the club ladder</div>
                </button>
              </div>
            </div>
          </div>
          <div class="dp-right">
            <div class="dp-right-title">Club Activity</div>
            ${buildActivityHTML(activity, true)}
          </div>
        </div>
      </div>`;
    return;
  }

  // Player dashboard — fetch data in parallel
  const playerId = user.playerId;
  const [playerData, ladder, activity] = await Promise.all([
    fetch(`/api/players/${playerId}/history`).then((r) => r.json()),
    window.api.getLadder(),
    window.api.getActivity(),
  ]);

  const upcoming = playerData.upcoming || [];
  const history = (playerData.history || []).slice(0, 8);
  const ladderVisible = ladder.filter((p) => !p.exclude_from_ladder);
  const ladderPos = ladderVisible.findIndex((p) => p.id === playerId);
  const rank = ladderPos >= 0 ? ladderPos + 1 : null;
  const totalPlayers = ladderVisible.length;
  const todayStr = new Date().toISOString().slice(0, 10);
  const nextMatch = upcoming.find((m) => m.week_date >= todayStr) || null;
  const wins = playerData.wins || 0;
  const losses = playerData.losses || 0;
  const total = wins + losses;
  const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;
  const firstName = (playerData.name || '').split(' ')[0];

  const greeting = 'Welcome back';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // Update topbar with greeting + date
  document.getElementById('pageTitle').innerHTML =
    `<div class="dp-topbar-greeting">${esc(greeting)}, ${esc(firstName)}.</div>` +
    `<div class="dp-topbar-date">${esc(dateStr)}</div>`;

  function fmtMatchDate(d) {
    if (!d) return '';
    const parts = d.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2])
      .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function fmtShortDate(d) {
    if (!d) return '';
    const parts = d.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2])
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function countdownLabel(dStr, tStr) {
    if (!dStr) return null;
    const base = new Date(dStr + 'T' + (tStr || '12:00') + ':00');
    const diff = base - new Date();
    if (diff <= 0) return 'Today';
    const days = Math.floor(diff / 86400000);
    const hrs = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return `In ${days}d ${hrs}h`;
    const mins = Math.floor((diff % 3600000) / 60000);
    return `In ${hrs}h ${mins}m`;
  }

  // Hero card (full-width, card-styled, left/right layout)
  const heroHTML = (() => {
    const leagueLabel = ['NEXT MATCH', nextMatch?.league_name || null].filter(Boolean).join(' · ');
    const pills = nextMatch ? [
      `<span class="dh-pill">${fmtMatchDate(nextMatch.week_date)}</span>`,
      nextMatch.match_time ? `<span class="dh-pill">${esc(nextMatch.match_time)}</span>` : '',
      nextMatch.schedule_courts && nextMatch.court_number ? `<span class="dh-pill">Court ${nextMatch.court_number}</span>` : '',
      nextMatch.division_name ? `<span class="dh-pill">${esc(nextMatch.division_name)}</span>` : '',
    ].filter(Boolean).join('') : '';
    const countdownInnerHTML = (() => {
      if (!nextMatch?.week_date) return '';
      const base = new Date(nextMatch.week_date + 'T' + (nextMatch.match_time || '12:00') + ':00');
      const diff = base - new Date();
      if (diff <= 0) return '<span class="dh-time-now">Today</span>';
      const days = Math.floor(diff / 86400000);
      const hrs  = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      if (days > 0) return `<span class="dh-tn">${days}</span><span class="dh-tu">d</span>&nbsp;<span class="dh-tn">${hrs}</span><span class="dh-tu">h</span>`;
      return `<span class="dh-tn">${hrs}</span><span class="dh-tu">h</span>&nbsp;<span class="dh-tn">${mins}</span><span class="dh-tu">m</span>`;
    })();
    return `
      <div class="dh-hero">
        <div class="dh-hero-bg" style="background-image:url('/assets/WSRC-EXTERIOR-ANGLE.jpg')"></div>
        <div class="dh-hero-overlay">
          ${nextMatch ? `
            <div class="dh-hero-left">
              <div class="dh-match-label">${esc(leagueLabel)}</div>
              <div class="dh-matchup">${esc(playerData.name)} <span class="dh-vs">vs</span> ${esc(nextMatch.opponent_name)}</div>
              <div class="dh-pills">${pills}</div>
            </div>
            ${countdownInnerHTML ? `
              <div class="dh-hero-right">
                <div class="dh-time-box">
                  <div class="dh-time-label">TIME UNTIL MATCH</div>
                  <div class="dh-time-val">${countdownInnerHTML}</div>
                </div>
              </div>
            ` : ''}
          ` : `
            <div class="dh-hero-left">
              <div class="dh-match-label">NO UPCOMING MATCHES</div>
              <div class="dh-matchup-empty">Check back when the next season is scheduled.</div>
            </div>
          `}
        </div>
      </div>`;
  })();

  // Combined Ranking + Club Ladder bento card
  const circ = 2 * Math.PI * 44;
  const ringProgress = (rank !== null && totalPlayers > 1) ? (totalPlayers - rank) / (totalPlayers - 1) : 0;
  const dashOffset = circ * (1 - ringProgress);
  const ladderNearby = (() => {
    if (ladderPos < 0) return [];
    const start = Math.max(0, ladderPos - 2);
    const end = Math.min(ladderVisible.length, ladderPos + 3);
    return ladderVisible.slice(start, end);
  })();
  const rankLadderBento = `
    <div class="db-card db-rank-ladder-card">
      <div class="db-card-title">Ranking</div>
      ${rank !== null ? `
        <div class="db-rank-ring-wrap">
          <svg class="db-rank-svg" viewBox="0 0 100 100">
            <circle class="db-ring-track" cx="50" cy="50" r="44" fill="none" stroke-width="8"/>
            <circle class="db-ring-fill" cx="50" cy="50" r="44" fill="none" stroke-width="8"
              stroke-dasharray="${circ.toFixed(2)}"
              stroke-dashoffset="${dashOffset.toFixed(2)}"
              transform="rotate(-90 50 50)"/>
          </svg>
          <div class="db-rank-inner">
            <div class="db-rank-num">#${rank}</div>
            <div class="db-rank-of">of ${totalPlayers}</div>
          </div>
        </div>
        <div class="db-rank-stats">
          <div class="db-stat"><div class="db-stat-val">${wins}</div><div class="db-stat-lbl">Wins</div></div>
          <div class="db-stat"><div class="db-stat-val">${losses}</div><div class="db-stat-lbl">Losses</div></div>
          <div class="db-stat"><div class="db-stat-val">${winPct}%</div><div class="db-stat-lbl">Win Rate</div></div>
        </div>
      ` : `<div class="db-empty-msg">Not ranked yet</div>`}
      ${ladderNearby.length > 0 ? `
        <div class="db-card-divider"></div>
        <div class="db-card-subtitle">Club Ladder</div>
        <div class="db-ladder-list">
          ${ladderNearby.map((p) => {
            const pos = ladderVisible.indexOf(p) + 1;
            const isMe = p.id === playerId;
            return `<div class="db-ladder-row${isMe ? ' db-ladder-me' : ''}">
              <span class="db-ladder-pos">${pos}</span>
              <span class="db-ladder-name">${esc(p.name)}</span>
              ${isMe ? '<span class="db-ladder-you">YOU</span>' : ''}
            </div>`;
          }).join('')}
        </div>
      ` : ''}
      <button class="db-card-link" onclick="navigate('ladder')">Full ladder →</button>
    </div>`;

  // Upcoming bento card
  const upcomingBento = `
    <div class="db-card db-upcoming-card">
      <div class="db-card-title">Scheduled Matches</div>
      ${upcoming.length === 0
        ? '<div class="db-empty-msg">No matches scheduled</div>'
        : `<div class="db-upcoming-rows">
            ${upcoming.slice(0, 5).map((m) => `
              <div class="db-upcoming-row">
                <div class="db-upcoming-date">${fmtShortDate(m.week_date)}</div>
                <div class="db-upcoming-opp">${esc(m.opponent_name)}</div>
                <div class="db-upcoming-time">${m.match_time ? esc(m.match_time) : '—'}</div>
              </div>`).join('')}
          </div>
          <button class="db-card-link" onclick="openPlayerProfile(${playerId})">View all →</button>`
      }
    </div>`;

  // Quick actions bento card
  const quickBento = `
    <div class="db-card db-quick-card">
      <div class="db-card-title">Quick Actions</div>
      <div class="db-quick-list">
        <button class="db-quick-item" onclick="openPlayerProfile(${playerId})">
          <svg class="db-quick-icon" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" fill="#3b8fc8"><g transform="translate(-180,-2159)"><g transform="translate(56,160)"><path d="M134,2008.99998 C131.783496,2008.99998 129.980955,2007.20598 129.980955,2004.99998 C129.980955,2002.79398 131.783496,2000.99998 134,2000.99998 C136.216504,2000.99998 138.019045,2002.79398 138.019045,2004.99998 C138.019045,2007.20598 136.216504,2008.99998 134,2008.99998 M137.775893,2009.67298 C139.370449,2008.39598 140.299854,2006.33098 139.958235,2004.06998 C139.561354,2001.44698 137.368965,1999.34798 134.722423,1999.04198 C131.070116,1998.61898 127.971432,2001.44898 127.971432,2004.99998 C127.971432,2006.88998 128.851603,2008.57398 130.224107,2009.67298 C126.852128,2010.93398 124.390463,2013.89498 124.004634,2017.89098 C123.948368,2018.48198 124.411563,2018.99998 125.008391,2018.99998 C125.519814,2018.99998 125.955881,2018.61598 126.001095,2018.10898 C126.404004,2013.64598 129.837274,2010.99998 134,2010.99998 C138.162726,2010.99998 141.595996,2013.64598 141.998905,2018.10898 C142.044119,2018.61598 142.480186,2018.99998 142.991609,2018.99998 C143.588437,2018.99998 144.051632,2018.48198 143.995366,2017.89098 C143.609537,2013.89498 141.147872,2010.93398 137.775893,2009.67298"/></g></g></svg>
          My Profile
        </button>
        <button class="db-quick-item" onclick="openReportScoreModal()">
          <svg class="db-quick-icon" viewBox="0 0 98.374 98.374" xmlns="http://www.w3.org/2000/svg" fill="#2ec610"><path d="M97.789,23.118l-7.24-7.24c-0.781-0.781-2.047-0.781-2.828,0L50.464,53.133l-13.291-13.29c-0.781-0.781-2.047-0.781-2.828,0l-7.24,7.24c-0.375,0.375-0.586,0.884-0.586,1.414c0,0.53,0.211,1.039,0.586,1.414L49.05,71.854c0.391,0.391,0.902,0.586,1.414,0.586c0.513,0,1.022-0.195,1.414-0.586l45.91-45.908c0.375-0.375,0.586-0.884,0.586-1.414C98.374,24.002,98.164,23.493,97.789,23.118z"/><path d="M73.583,80.979H10V17.395h65.098l8.485-8c0-1.104-0.896-2-2-2H2c-1.104,0-2,0.896-2,2v79.584c0,1.104,0.896,2,2,2h79.584c1.105,0,2-0.896,2-2v-37.88l-10,10.5L73.583,80.979L73.583,80.979z"/></svg>
          Report Score
        </button>
        <div class="db-quick-item db-quick-soon">
          <svg class="db-quick-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="#ff7300"><path d="M23.5 13.187h-7.5v-12.187l-7.5 17.813h7.5v12.187l7.5-17.813z"/></svg>
          Challenge a Player
          <span class="db-soon-badge">Coming Soon</span>
        </div>
      </div>
    </div>`;

  // Recent results
  const recentResults = history.slice(0, 4);
  const resultsHTML = recentResults.length > 0 ? `
    <div class="db-results-section">
      <div class="db-section-heading">Recent Results</div>
      <div class="db-results-row">
        ${recentResults.map((m) => {
          const win = m.result === 'W';
          const scoreStr = m.player_score != null ? `${m.player_score}–${m.opp_score}` : '';
          return `
            <div class="db-result-card ${win ? 'db-result-win' : 'db-result-loss'}">
              <div class="db-result-badge">${win ? 'WIN' : 'LOSS'}</div>
              <div class="db-result-opp">${esc(m.opponent_name)}</div>
              ${scoreStr ? `<div class="db-result-score">${scoreStr}</div>` : ''}
              <div class="db-result-date">${fmtShortDate(m.week_date)}</div>
            </div>`;
        }).join('')}
      </div>
    </div>` : '';

  content.innerHTML = `
    <div class="dp-wrap">
      <div class="dp-columns">
        <div class="dp-main">
          ${heroHTML}
          <div class="dp-bento">
            ${rankLadderBento}
            ${upcomingBento}
            ${quickBento}
          </div>
          ${resultsHTML}
        </div>
        <div class="dp-right">
          <div class="dp-right-title">Club Activity</div>
          ${buildActivityHTML(activity, false)}
        </div>
      </div>
    </div>`;
}

// ===== PLAYERS PAGE =====
async function renderPlayers() {
  document.getElementById('pageTitle').textContent = 'Players';
  document.getElementById('topbarActions').innerHTML = isAdmin() ? `
    <button class="btn btn-outline" id="btnExport">Export CSV</button>
    <button class="btn btn-outline" id="btnImport">Import CSV</button>
    <button class="btn btn-outline" id="btnBulkAdd">Add Multiple</button>
    <button class="btn btn-primary" id="btnAddPlayer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
      Add Player
    </button>` : '';

  state.players = await window.api.getPlayers();
  renderPlayerTable(state.players);

  if (isAdmin()) {
    document.getElementById('btnAddPlayer').addEventListener('click', openAddPlayerModal);
    document.getElementById('btnBulkAdd').addEventListener('click', openBulkAddModal);
    document.getElementById('btnExport').addEventListener('click', exportPlayersCsv);
    document.getElementById('btnImport').addEventListener('click', openImportModal);
  }
}

function playerRowsHTML(players, filtered) {
  const cols = isAdmin() ? 4 : 3;
  if (filtered.length === 0) {
    return `<tr><td colspan="${cols}">
      <div class="empty-state">
        <strong>${players.length === 0 ? 'No players yet' : 'No results'}</strong>
        <p>${players.length === 0 ? 'Add your first player to get started.' : 'Try a different search term.'}</p>
      </div>
    </td></tr>`;
  }
  return filtered.map((p) => `
    <tr>
      <td><a class="player-link" data-action="view-profile" data-id="${p.id}">${esc(p.name)}</a></td>
      <td class="text-muted player-col-email">${esc(p.email) || '—'}</td>
      <td class="text-muted player-col-phone">${esc(p.phone) || '—'}</td>
      ${isAdmin() ? `<td><div class="td-actions"><button class="btn btn-outline btn-sm" data-action="edit" data-id="${p.id}">Edit</button></div></td>` : ''}
    </tr>`).join('');
}

function attachPlayerTableListeners(content) {
  content.querySelectorAll('[data-action="view-profile"]').forEach((a) => {
    a.addEventListener('click', () => openPlayerProfile(Number(a.dataset.id)));
  });
  content.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const player = state.players.find((p) => p.id == btn.dataset.id);
      openEditPlayerModal(player);
    });
  });
}

function renderPlayerTable(players) {
  const content = document.getElementById('mainContent');

  // Full render (first time or after a data change)
  const filtered = players; // show all on initial render; search will filter live
  content.innerHTML = `
    <div class="table-card">
      <div class="table-toolbar">
        <span class="text-muted" id="playerCount">${players.length} player${players.length !== 1 ? 's' : ''}</span>
        <input class="search-input" id="playerSearch" placeholder="Search players..." autocomplete="off">
      </div>
      <table class="players-table">
        <thead>
          <tr>
            <th>Name</th><th class="player-col-email">Email</th><th class="player-col-phone">Phone</th>${isAdmin() ? '<th style="text-align:right">Actions</th>' : ''}
          </tr>
        </thead>
        <tbody id="playerTbody">${playerRowsHTML(players, filtered)}</tbody>
      </table>
    </div>`;

  attachPlayerTableListeners(content);

  // On search: only replace tbody — never touch the input, preserving cursor/selection
  document.getElementById('playerSearch').addEventListener('input', (e) => {
    const input = e.target;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const val = input.value.toLowerCase();
    const f = val ? players.filter((p) => p.name.toLowerCase().includes(val)) : players;
    const tbody = document.getElementById('playerTbody');
    tbody.innerHTML = playerRowsHTML(players, f);
    attachPlayerTableListeners(tbody);
    input.setSelectionRange(start, end);
  });
}

function playerFormHTML(player = {}) {
  const excluded = player.id ? !!player.exclude_from_ladder : false;
  return `
    <div class="form-group">
      <label>Name *</label>
      <input class="form-control" id="fName" value="${esc(player.name || '')}" placeholder="Full name" autofocus>
    </div>
    <div class="form-group">
      <label>Email</label>
      <input class="form-control" id="fEmail" type="email" value="${esc(player.email || '')}" placeholder="email@example.com">
    </div>
    <div class="form-group">
      <label>Phone</label>
      <input class="form-control" id="fPhone" value="${esc(player.phone || '')}" placeholder="(optional)">
    </div>
    <div class="form-group">
      <label>Club Locker Rating</label>
      <input class="form-control" id="fRating" type="number" step="0.01" min="0" value="${esc(player.club_locker_rating != null ? player.club_locker_rating : '')}" placeholder="e.g. 3.50 (optional)">
    </div>
    <div class="form-group form-group-check">
      <label class="check-label">
        <input type="checkbox" id="fExclude" ${excluded ? 'checked' : ''}>
        Exclude from ladder
      </label>
    </div>
    <div id="fError" class="form-error"></div>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSubmit">${player.id ? 'Save Changes' : 'Add Player'}</button>
    </div>`;
}

function openAddPlayerModal() {
  modal.open('Add Player', playerFormHTML());
  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const name = document.getElementById('fName').value.trim();
    const email = document.getElementById('fEmail').value.trim();
    const phone = document.getElementById('fPhone').value.trim();
    const ratingRaw = document.getElementById('fRating').value.trim();
    const club_locker_rating = ratingRaw !== '' ? parseFloat(ratingRaw) : null;
    const exclude_from_ladder = document.getElementById('fExclude').checked;
    if (!name) { document.getElementById('fError').textContent = 'Name is required.'; return; }
    try {
      await window.api.addPlayer({ name, email, phone, club_locker_rating, exclude_from_ladder });
      modal.close();
      toast('Player added', 'success');
      state.players = await window.api.getPlayers();
      renderPlayerTable(state.players);
    } catch (e) {
      document.getElementById('fError').textContent = e.message || 'Failed to add player.';
    }
  });
}

function openEditPlayerModal(player) {
  modal.open('Edit Player', playerFormHTML(player));
  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const name = document.getElementById('fName').value.trim();
    const email = document.getElementById('fEmail').value.trim();
    const phone = document.getElementById('fPhone').value.trim();
    const ratingRaw = document.getElementById('fRating').value.trim();
    const club_locker_rating = ratingRaw !== '' ? parseFloat(ratingRaw) : null;
    const exclude_from_ladder = document.getElementById('fExclude').checked;
    if (!name) { document.getElementById('fError').textContent = 'Name is required.'; return; }
    try {
      await window.api.updatePlayer({ id: player.id, name, email, phone, club_locker_rating, exclude_from_ladder });
      modal.close();
      toast('Player updated', 'success');
      state.players = await window.api.getPlayers();
      // If we edited from a player profile, reload the profile with fresh data
      if (state.page === 'playerProfile') {
        const savedPrevPage = state.prevPage;
        await openPlayerProfile(player.id);
        state.prevPage = savedPrevPage;
      } else {
        renderPlayerTable(state.players);
      }
    } catch (e) {
      document.getElementById('fError').textContent = e.message || 'Failed to update player.';
    }
  });
}

function confirmDeletePlayer(id, name) {
  modal.open('Delete Player', `
    <p>Are you sure you want to delete <strong>${esc(name)}</strong>? This cannot be undone.</p>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-danger" id="fConfirm">Delete</button>
    </div>`);
  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fConfirm').addEventListener('click', async () => {
    await window.api.deletePlayer(id);
    modal.close();
    toast('Player deleted');
    navigate('players');
  });
}

function exportPlayersCsv() {
  const headers = ['name', 'email', 'phone'];
  const rows = state.players.map((p) => [
    p.name,
    p.email || '',
    p.phone || '',
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'wsrc-players.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function openImportModal() {
  modal.open('Import Players from CSV', `
    <p class="text-muted" style="font-size:13px;margin-bottom:4px">
      Upload a CSV exported from this app. Existing players with the same name will be skipped.
    </p>
    <p class="text-muted" style="font-size:12px;margin-bottom:16px">
      Expected columns: <code>name, email, phone</code>
    </p>
    <input type="file" accept=".csv" id="fCsvFile" class="form-control" style="margin-bottom:0">
    <div id="fError" class="form-error" style="margin-top:8px"></div>
    <div id="importPreview" style="margin-top:14px"></div>
    <div class="form-actions" style="margin-top:16px">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSubmit" disabled>Import</button>
    </div>`);

  document.getElementById('fCancel').addEventListener('click', modal.close);

  let parsed = [];

  document.getElementById('fCsvFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = ev.target.result.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        document.getElementById('fError').textContent = 'File appears to be empty.';
        return;
      }
      const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const nameIdx  = headers.indexOf('name');
      const emailIdx = headers.indexOf('email');
      const phoneIdx = headers.indexOf('phone');
      if (nameIdx === -1) {
        document.getElementById('fError').textContent = 'Missing required "name" column.';
        return;
      }
      const parseCell = (row, idx) => {
        if (idx === -1 || !row[idx]) return '';
        return row[idx].trim().replace(/^"|"$/g, '').replace(/""/g, '"');
      };
      parsed = [];
      const existingNames = new Set(state.players.map((p) => p.name.toLowerCase()));
      const skipped = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) || lines[i].split(',');
        const name = parseCell(row, nameIdx).trim();
        if (!name) continue;
        if (existingNames.has(name.toLowerCase())) { skipped.push(name); continue; }
        parsed.push({
          name,
          email: parseCell(row, emailIdx),
          phone: parseCell(row, phoneIdx),
        });
      }
      document.getElementById('fError').textContent = '';
      const preview = document.getElementById('importPreview');
      if (parsed.length === 0 && skipped.length === 0) {
        preview.innerHTML = `<p class="text-muted" style="font-size:13px">No new players found in file.</p>`;
        document.getElementById('fSubmit').disabled = true;
        return;
      }
      preview.innerHTML = `
        <p style="font-size:13px;margin-bottom:6px">
          <strong>${parsed.length}</strong> player${parsed.length !== 1 ? 's' : ''} will be imported
          ${skipped.length ? `<span class="text-muted"> &mdash; ${skipped.length} skipped (name already exists)</span>` : ''}
        </p>
        <div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;font-size:12px">
          ${parsed.map((p) => `<div style="padding:6px 10px;border-bottom:1px solid var(--border)">${esc(p.name)}${p.email ? ` &mdash; ${esc(p.email)}` : ''}</div>`).join('')}
        </div>`;
      document.getElementById('fSubmit').disabled = parsed.length === 0;
    };
    reader.readAsText(file);
  });

  document.getElementById('fSubmit').addEventListener('click', async () => {
    if (!parsed.length) return;
    document.getElementById('fSubmit').disabled = true;
    document.getElementById('fSubmit').textContent = 'Importing…';
    let added = 0;
    for (const p of parsed) {
      try { await window.api.addPlayer(p); added++; } catch (_) {}
    }
    modal.close();
    toast(`Imported ${added} player${added !== 1 ? 's' : ''}`, 'success');
    state.players = await window.api.getPlayers();
    renderPlayerTable(state.players);
  });
}

function openBulkAddModal() {
  const renderRows = (count) => Array.from({ length: count }, (_, i) => `
    <div class="bulk-row" data-row="${i}">
      <span class="bulk-row-num">${i + 1}</span>
      <input class="form-control bulk-name" placeholder="Name *" data-field="name" data-row="${i}">
      <input class="form-control bulk-email" placeholder="Email" data-field="email" data-row="${i}">
      <input class="form-control bulk-phone" placeholder="Phone" data-field="phone" data-row="${i}">
      <button class="btn btn-ghost btn-sm bulk-remove" data-row="${i}" title="Remove row">&times;</button>
    </div>`).join('');

  let rowCount = 5;

  const rebuild = () => {
    document.getElementById('bulkRows').innerHTML = renderRows(rowCount);
    document.querySelectorAll('.bulk-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.row);
        const names  = [...document.querySelectorAll('.bulk-name')].map(el => el.value);
        const emails = [...document.querySelectorAll('.bulk-email')].map(el => el.value);
        const phones = [...document.querySelectorAll('.bulk-phone')].map(el => el.value);
        names.splice(idx, 1); emails.splice(idx, 1); phones.splice(idx, 1);
        rowCount = Math.max(1, rowCount - 1);
        rebuild();
        document.querySelectorAll('.bulk-name').forEach((el, i)  => { el.value = names[i]  || ''; });
        document.querySelectorAll('.bulk-email').forEach((el, i) => { el.value = emails[i] || ''; });
        document.querySelectorAll('.bulk-phone').forEach((el, i) => { el.value = phones[i] || ''; });
      });
    });
  };

  modal.open('Add Multiple Players', `
    <p class="text-muted" style="font-size:13px;margin-bottom:16px">Fill in each player's details. Rows without a name will be skipped.</p>
    <div class="bulk-header">
      <span></span><span>Name *</span><span>Email</span><span>Phone</span><span></span>
    </div>
    <div id="bulkRows">${renderRows(rowCount)}</div>
    <button class="btn btn-outline btn-sm" id="bulkAddRow" style="margin-top:10px">+ Add Row</button>
    <div id="fError" class="form-error" style="margin-top:12px"></div>
    <div class="form-actions" style="margin-top:16px">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSubmit">Add Players</button>
    </div>`, { wide: true });

  rebuild();

  document.getElementById('bulkAddRow').addEventListener('click', () => {
    const names  = [...document.querySelectorAll('.bulk-name')].map(el => el.value);
    const emails = [...document.querySelectorAll('.bulk-email')].map(el => el.value);
    const phones = [...document.querySelectorAll('.bulk-phone')].map(el => el.value);
    rowCount++;
    rebuild();
    document.querySelectorAll('.bulk-name').forEach((el, i)  => { el.value = names[i]  || ''; });
    document.querySelectorAll('.bulk-email').forEach((el, i) => { el.value = emails[i] || ''; });
    document.querySelectorAll('.bulk-phone').forEach((el, i) => { el.value = phones[i] || ''; });
  });

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const rows = [];
    document.querySelectorAll('.bulk-row').forEach((row) => {
      const name  = row.querySelector('.bulk-name').value.trim();
      const email = row.querySelector('.bulk-email').value.trim();
      const phone = row.querySelector('.bulk-phone').value.trim();
      if (name) rows.push({ name, email, phone });
    });
    if (rows.length === 0) {
      document.getElementById('fError').textContent = 'Enter at least one player name.';
      return;
    }
    const btn = document.getElementById('fSubmit');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
      for (const r of rows) await window.api.addPlayer(r);
      modal.close();
      toast(`${rows.length} player${rows.length !== 1 ? 's' : ''} added`, 'success');
      navigate('players');
    } catch (e) {
      document.getElementById('fError').textContent = e.message || 'Failed to add players.';
      btn.disabled = false;
      btn.textContent = 'Add Players';
    }
  });
}

// ===== PLAYER PROFILE =====
async function openPlayerProfile(id) {
  const backPage = state.page;   // capture before async — navigate may change state.page
  const player = await window.api.getPlayerHistory(id);
  navigate('playerProfile', { player });
  state.prevPage = backPage;     // override what navigate set, ensuring back goes to the right place
}

function renderPlayerProfile() {
  const p = state.currentPlayer;
  if (!p) { navigate('players'); return; }

  const adminMode = isAdmin();
  document.getElementById('pageTitle').textContent = p.name;
  const acctStatus = p.accountStatus || 'none'; // 'verified' | 'pending' | 'none'
  const hasEmail = !!p.email;

  document.getElementById('topbarActions').innerHTML = adminMode ? `
    <div class="options-menu" id="optionsMenu">
      <button class="btn btn-outline" id="optionsBtn">Options <svg width="14" height="14" viewBox="0 0 4 14" fill="currentColor" style="vertical-align:middle;margin-left:2px"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/></svg></button>
      <div class="options-dropdown" id="optionsDropdown">
        <button class="options-item" data-action="edit-player" data-id="${p.id}">Edit Information</button>
        ${hasEmail && acctStatus !== 'verified' ? `<button class="options-item" data-action="send-invite">Send Invite</button>` : ''}
        ${hasEmail && acctStatus === 'verified' ? `<button class="options-item" data-action="send-reset">Send Password Reset</button>` : ''}
        <button class="options-item options-item-danger" data-action="delete-player" data-id="${p.id}" data-name="${esc(p.name)}">Delete Player</button>
      </div>
    </div>` : '';

  if (adminMode) {
    document.getElementById('optionsBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('optionsDropdown').classList.toggle('open');
    });
    document.getElementById('optionsDropdown').addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      document.getElementById('optionsDropdown').classList.remove('open');
      if (action === 'edit-player') {
        const player = state.players.find((pl) => pl.id === Number(e.target.dataset.id))
          || state.currentPlayer;
        openEditPlayerModal(player);
      } else if (action === 'delete-player') {
        confirmDeletePlayer(Number(e.target.dataset.id), e.target.dataset.name);
      } else if (action === 'send-invite') {
        try {
          const result = await window.api.sendInvite(p.id);
          if (result.emailSent) {
            toast('Invite email sent!', 'success');
          } else {
            showAuthLinkModal('Invite Link', result.inviteUrl);
          }
        } catch (err) {
          toast(err.message || 'Failed to send invite.', 'error');
        }
      } else if (action === 'send-reset') {
        try {
          const result = await window.api.sendReset(p.id);
          if (result.emailSent) {
            toast('Password reset email sent!', 'success');
          } else {
            showAuthLinkModal('Password Reset Link', result.resetUrl);
          }
        } catch (err) {
          toast(err.message || 'Failed to send reset email.', 'error');
        }
      }
    });
    document.addEventListener('click', function closeOptions() {
      document.getElementById('optionsDropdown')?.classList.remove('open');
      document.removeEventListener('click', closeOptions);
    }, { once: false });
  }

  const played = (p.wins || 0) + (p.losses || 0);
  const winPct = played > 0 ? Math.round((p.wins / played) * 100) : null;

  const historyHTML = (p.history || []).length === 0
    ? `<div class="empty-state"><strong>No matches played yet</strong></div>`
    : `<table>
        <thead>
          <tr>
            <th>Date</th>
            <th>League</th>
            <th>Week</th>
            <th>Division</th>
            <th>Opponent</th>
            <th style="text-align:center">Score</th>
            <th style="text-align:center">Result</th>
          </tr>
        </thead>
        <tbody>
          ${p.history.map((m) => `
            <tr>
              <td class="text-muted">${formatShortDate(m.week_date)}</td>
              <td>${esc(m.league_name)}</td>
              <td class="text-muted">Wk ${m.week_number}</td>
              <td class="text-muted">${esc(m.division_name.replace(/^Division\s*/i, 'D'))}</td>
              <td>${esc(m.opponent_name)}</td>
              <td style="text-align:center;font-weight:600">${m.my_score} – ${m.their_score}</td>
              <td style="text-align:center">
                <span class="result-badge ${m.result === 'W' ? 'result-win' : 'result-loss'}">${m.result}</span>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

  const upcomingHTML = (p.upcoming || []).length === 0
    ? `<div class="empty-state"><strong>No upcoming matches</strong></div>`
    : `<table>
        <thead>
          <tr>
            <th>Date</th>
            <th>League</th>
            <th>Week</th>
            <th>Division</th>
            <th>Opponent</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          ${p.upcoming.map((m) => {
            const showCourt = m.schedule_courts && m.court_number;
            const timeInfo = showCourt
              ? `Court ${m.court_number}${m.match_time ? ' · ' + m.match_time : ''}`
              : (m.match_time || '—');
            return `
            <tr>
              <td class="text-muted">${formatShortDate(m.week_date)}</td>
              <td>${esc(m.league_name)}</td>
              <td class="text-muted">Wk ${m.week_number}</td>
              <td class="text-muted">${esc(m.division_name.replace(/^Division\s*/i, 'D'))}</td>
              <td>${esc(m.opponent_name)}</td>
              <td class="text-muted">${esc(timeInfo)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

  const acctBadgeHTML = adminMode ? (() => {
    if (acctStatus === 'verified') return `<span class="acct-badge acct-badge-verified">Verified</span>`;
    if (!hasEmail) return `<span class="acct-badge acct-badge-none">No Email</span>`;
    return `<span class="acct-badge acct-badge-pending">Not Verified</span>`;
  })() : '';

  document.getElementById('mainContent').innerHTML = `
    <div class="profile-header-card">
      <div class="profile-info">
        <div class="profile-avatar">${esc(p.name.charAt(0).toUpperCase())}</div>
        <div>
          <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">${esc(p.name)}</h2>
          ${p.email ? `<div class="text-muted" style="font-size:13px">${esc(p.email)}</div>` : ''}
          ${p.phone ? `<div class="text-muted" style="font-size:13px">${esc(p.phone)}</div>` : ''}
          ${acctBadgeHTML}
        </div>
      </div>
      <div class="profile-stats">
        <div class="stat"><span class="stat-val">${p.wins || 0}</span><span class="stat-label">Wins</span></div>
        <div class="stat"><span class="stat-val">${p.losses || 0}</span><span class="stat-label">Losses</span></div>
        <div class="stat"><span class="stat-val">${played}</span><span class="stat-label">Played</span></div>
        ${winPct !== null ? `<div class="stat"><span class="stat-val">${winPct}%</span><span class="stat-label">Win Rate</span></div>` : ''}
      </div>
    </div>

    <div class="section-title">Upcoming Matches <div class="divider"></div></div>
    <div class="table-card">${upcomingHTML}</div>

    <div class="section-title" style="margin-top:32px">Match History <div class="divider"></div></div>
    <div class="table-card">${historyHTML}</div>`;
}

// ===== LADDER PAGE =====
async function renderLadder() {
  document.getElementById('pageTitle').textContent = 'Ladder';
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
  const top10 = ladder.slice(0, 10);
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

  const top10HTML = top10.map((p, i) => {
    const rec   = records[p.id] || { wins: 0, losses: 0 };
    const total = rec.wins + rec.losses;
    const pct   = total > 0 ? Math.round(rec.wins / total * 100) : 0;
    const isMe  = p.id === myId;
    const nameParts = (p.name || '').trim().split(/\s+/);
    const firstName = nameParts.slice(0, -1).join(' ') || nameParts[0];
    const lastName  = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    const posClass  = i < 3 ? ` ldr-card-pos-${i + 1}` : (isMe ? ' ldr-card-me' : '');
    return `
      <div class="ldr-card${posClass}" data-action="view-profile" data-id="${p.id}">
        <div class="ldr-card-avatar-wrap">
          <div class="ldr-avatar ldr-avatar-lg">${playerInitials(p.name)}</div>
        </div>
        <div class="ldr-card-rank-row">
          <span class="ldr-card-rank">#${i + 1}</span>
          ${rankChangeBadge(p.rank_change)}
          ${isMe ? '<span class="ldr-card-you">YOU</span>' : ''}
        </div>
        <div class="ldr-card-fname">${esc(firstName)}</div>
        ${lastName ? `<div class="ldr-card-lname">${esc(lastName)}</div>` : ''}
        <div class="ldr-card-stats">
          <div class="ldr-stat ldr-stat-w">
            <span class="ldr-stat-num">${rec.wins}</span>
            <span class="ldr-stat-label">WON</span>
          </div>
          <div class="ldr-stat ldr-stat-l">
            <span class="ldr-stat-num">${rec.losses}</span>
            <span class="ldr-stat-label">LOST</span>
          </div>
        </div>
        <div class="ldr-card-pct-row">
          <span class="ldr-pct-val">${total > 0 ? pct + '%' : '—'}</span>
          <div class="ldr-pct-bar"><div class="ldr-pct-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`;
  }).join('');

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
        <div class="section-title">TOP 10 <span class="divider"></span></div>
        <div class="ldr-top10-scroll">
          ${top10HTML}
        </div>
      </div>
      <div class="ldr-section-block">
        <div class="section-title">ALL MEMBERS <span class="divider"></span> <span class="ldr-total">${ladder.length} players</span></div>
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
    if (el) openPlayerProfile(Number(el.dataset.id));
  });
}

// ===== LEAGUES PAGE =====
async function renderLeagues() {
  document.getElementById('pageTitle').textContent = 'Leagues';
  document.getElementById('topbarActions').innerHTML = isAdmin() ? `
    <button class="btn btn-primary" id="btnCreateLeague">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
      New League
    </button>` : '';

  state.leagues = await window.api.getLeagues();
  const content = document.getElementById('mainContent');

  if (state.leagues.length === 0) {
    content.innerHTML = `
      <div class="table-card">
        <div class="empty-state">
          <strong>No leagues yet</strong>
          <p>${isAdmin() ? 'Create your first league to get started.' : 'No leagues have been created yet.'}</p>
        </div>
      </div>`;
  } else if (isAdmin()) {
    content.innerHTML = `<div class="league-grid">${state.leagues.map(leagueCardHTML).join('')}</div>`;
  } else {
    const playerId = state.currentUser?.playerId;
    const mine = state.leagues.filter((l) => (l.player_ids || []).includes(playerId));
    const other = state.leagues.filter((l) => !(l.player_ids || []).includes(playerId));
    let html = '';
    if (mine.length > 0) {
      html += `<div class="leagues-section-label">My Leagues</div><div class="league-grid">${mine.map(leagueCardHTML).join('')}</div>`;
    }
    if (other.length > 0) {
      html += `<div class="leagues-section-label${mine.length > 0 ? ' leagues-section-label--gap' : ''}">Other Leagues</div><div class="league-grid">${other.map(leagueCardHTML).join('')}</div>`;
    }
    content.innerHTML = html;
  }

  content.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openLeague(Number(btn.dataset.id)); });
  });
  content.querySelectorAll('.league-card').forEach((card) => {
    card.addEventListener('click', () => openLeague(Number(card.dataset.id)));
  });

  if (isAdmin()) {
    document.getElementById('btnCreateLeague')?.addEventListener('click', startCreateLeague);
  }
}

function leagueCardHTML(league) {
  return `
    <div class="league-card" data-id="${league.id}">
      <div class="league-card-header">
        <h3>${esc(league.name)}</h3>
        <span class="badge badge-${league.status}">${esc(league.status)}</span>
      </div>
      <div class="league-card-meta">
        <div class="meta-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
          Starts ${formatShortDate(league.start_date)}
        </div>
        <div class="meta-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          ${league.setup_type === 'modern'
            ? `${league.num_divisions} Division${league.num_divisions !== 1 ? 's' : ''}`
            : `${league.num_teams} teams &times; ${league.num_divisions} divisions &mdash; ${league.num_teams * league.num_divisions} players`}
        </div>
      </div>
      <div class="league-card-footer">
        <button class="btn btn-primary btn-sm" data-action="view" data-id="${league.id}">View League</button>
      </div>
    </div>`;
}

async function openLeague(id) {
  const league = await window.api.getLeague(id);
  navigate('leagueDetail', { league });
}

function confirmDeleteLeague(id, name) {
  modal.open('Delete League', `
    <p>Delete <strong>${esc(name)}</strong>? This will remove all schedule data and cannot be undone.</p>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-danger" id="fConfirm">Delete League</button>
    </div>`);
  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fConfirm').addEventListener('click', async () => {
    await window.api.deleteLeague(id);
    modal.close();
    toast('League deleted');
    renderLeagues();
  });
}

// ===== PRINT BOXES =====
function printBoxes(league) {
  const isModern = league.setup_type === 'modern';
  const numRounds = league.num_rounds || 1;
  const weeks = league.weeks || [];
  const weeksPerRound = Math.round(weeks.length / numRounds);

  // Group weeks into rounds
  const rounds = [];
  for (let r = 0; r < numRounds; r++) {
    rounds.push(weeks.slice(r * weeksPerRound, (r + 1) * weeksPerRound));
  }

  // Group players by division
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

  let pagesHTML = '';

  rounds.forEach((roundWeeks, roundIdx) => {
    // Build pairIndex: sorted player-id pair -> match object
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

    divisions.forEach((div) => {
      const players = div.players;
      const roundLabel = numRounds > 1 ? ` &mdash; Round ${roundIdx + 1}` : '';

      // Column headers
      const colHeaders = players.map((p) => `
        <th class="box-col-header">
          <div class="box-col-player">${esc(p.player_name)}</div>
          ${!isModern ? `<div class="box-col-team">${esc(p.team_name)}</div>` : ''}
        </th>`).join('');

      // Rows
      const rows = players.map((rowP) => {
        const cells = players.map((colP) => {
          if (rowP.player_id === colP.player_id) {
            return '<td class="box-cell box-cell-self"><div class="box-cell-x">✕</div></td>';
          }
          const key = [rowP.player_id, colP.player_id].sort((a, b) => a - b).join('-');
          const match = pairMatch[key];
          if (match && match.player1_score !== null && match.player2_score !== null) {
            const isP1 = match.player1_id === rowP.player_id;
            const myScore = isP1 ? match.player1_score : match.player2_score;
            const theirScore = isP1 ? match.player2_score : match.player1_score;
            const won = match.winner_id === rowP.player_id;
            return `<td class="box-cell box-cell-scored ${won ? 'box-cell-win' : 'box-cell-loss'}">
              <div class="box-score-result">${won ? 'W' : 'L'}</div>
              <div class="box-score">${myScore}&ndash;${theirScore}</div>
            </td>`;
          }
          return '<td class="box-cell"></td>';
        }).join('');
        return `<tr>
          <td class="box-row-header">
            <div class="box-row-player">${esc(rowP.player_name)}</div>
            ${!isModern ? `<div class="box-row-team">${esc(rowP.team_name)}</div>` : ''}
          </td>${cells}</tr>`;
      }).join('');

      pagesHTML += `
        <div class="box-page">
          <div class="box-title-bar">
            <div class="box-league">${esc(league.name)}</div>
            <div class="box-division">${esc(div.name)}${roundLabel}</div>
          </div>
          <table class="box-grid">
            <thead>
              <tr>
                <th class="box-corner"></th>
                ${colHeaders}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    });
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Box Sheets &mdash; ${esc(league.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; }

    .box-page {
      width: 100%;
      min-height: 100vh;
      padding: 18mm 16mm 14mm;
      display: flex;
      flex-direction: column;
      page-break-after: always;
      break-after: page;
    }

    .box-title-bar {
      margin-bottom: 10mm;
    }
    .box-league {
      font-size: 13pt;
      color: #555;
      font-weight: 500;
      margin-bottom: 2px;
    }
    .box-division {
      font-size: 22pt;
      font-weight: 800;
      color: #000;
      line-height: 1.1;
    }
    .box-grid {
      width: 100%;
      flex: 1;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .box-corner {
      width: 52mm;
    }

    .box-col-header {
      border: 2px solid #000;
      padding: 6px 4px;
      text-align: center;
      vertical-align: bottom;
      background: #fff;
      color: #000;
    }
    .box-col-player {
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.2;
    }
    .box-col-team {
      font-size: 8pt;
      opacity: 0.8;
      margin-top: 2px;
    }

    .box-row-header {
      border: 2px solid #000;
      padding: 6px 10px;
      background: #fff;
      color: #000;
      vertical-align: middle;
    }
    .box-row-player {
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.2;
    }
    .box-row-team {
      font-size: 8pt;
      opacity: 0.8;
      margin-top: 2px;
    }

    .box-cell {
      border: 2px solid #000;
      vertical-align: top;
      padding: 5px 6px;
      min-height: 30mm;
    }
    .box-cell-self {
      background: #ccc;
      text-align: center;
      vertical-align: middle;
    }
    .box-cell-x {
      font-size: 22pt;
      font-weight: 700;
      color: #000;
      line-height: 1;
    }
    .box-cell-scored {
      text-align: center;
      vertical-align: middle;
    }
    .box-cell-win { background: #e8f5e9; }
    .box-cell-loss { background: #fdecea; }
    .box-score-result {
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .box-cell-win .box-score-result { color: #1a6b35; }
    .box-cell-loss .box-score-result { color: #b71c1c; }
    .box-score {
      font-size: 12pt;
      font-weight: 700;
      color: #000;
    }

    @page { size: A4 landscape; margin: 0; }
    @media print {
      body { background: #fff; }
      .box-page { min-height: 0; padding: 12mm 14mm 10mm; }
    }
  </style>
</head>
<body>${pagesHTML}</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win2 = window.open(url, '_blank');
  win2.addEventListener('load', () => {
    win2.print();
    URL.revokeObjectURL(url);
  });
}

function copyPublicLink(league) {
  const slug = league.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const publicUrl = window.location.origin + '/' + slug + '/' + league.public_token;
  navigator.clipboard.writeText(publicUrl).then(function() {
    toast('Public link copied!', 'success');
  }).catch(function() {
    const ta = document.createElement('textarea');
    ta.value = publicUrl;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Public link copied!', 'success');
  });
}

function openMessagePlayersModal(league) {
  const players = (league.players || []).filter((p) => p.player_email);
  const noEmailPlayers = (league.players || []).filter((p) => !p.player_email);

  modal.open('Message Players', `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
      Sending to <strong>${players.length}</strong> player${players.length !== 1 ? 's' : ''} with an email address on file.
      ${noEmailPlayers.length ? `<span style="color:var(--warning)"> ${noEmailPlayers.length} player${noEmailPlayers.length !== 1 ? 's have' : ' has'} no email and will be skipped.</span>` : ''}
    </p>
    <div class="form-group">
      <label>Subject</label>
      <input class="form-control" id="fMsgSubject" type="text" placeholder="e.g. League night this week">
    </div>
    <div class="form-group">
      <label>Message</label>
      <textarea class="form-control" id="fMsgBody" rows="6" placeholder="Write your message here…" style="resize:vertical"></textarea>
    </div>
    <div class="form-group">
      <label>Attachments <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="form-control" id="fMsgFile" type="file" style="flex:1">
        <button class="btn btn-outline" id="fAddFile" type="button" style="white-space:nowrap;flex-shrink:0">Add</button>
      </div>
      <div id="fAttachmentList" style="margin-top:8px;display:flex;flex-direction:column;gap:6px"></div>
    </div>
    <div id="fMsgError" class="form-error"></div>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSend">Send Email</button>
    </div>`);

  const attachments = [];

  function renderAttachmentList() {
    const list = document.getElementById('fAttachmentList');
    list.innerHTML = attachments.map((a, i) => `
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg-subtle,#f4f6fb);border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:13px">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.filename)}</span>
        <button class="btn btn-ghost btn-sm" data-remove="${i}" style="flex-shrink:0;margin-left:8px;color:var(--danger,#e74c3c)">Remove</button>
      </div>`).join('');
    list.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        attachments.splice(Number(btn.dataset.remove), 1);
        renderAttachmentList();
      });
    });
  }

  document.getElementById('fAddFile').addEventListener('click', async () => {
    const fileInput = document.getElementById('fMsgFile');
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    attachments.push({ filename: file.name, content: base64 });
    fileInput.value = '';
    renderAttachmentList();
  });

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSend').addEventListener('click', async () => {
    const subject = document.getElementById('fMsgSubject').value.trim();
    const body = document.getElementById('fMsgBody').value.trim();
    const errEl = document.getElementById('fMsgError');
    if (!subject) { errEl.textContent = 'Subject is required.'; return; }
    if (!body) { errEl.textContent = 'Message is required.'; return; }
    errEl.textContent = '';
    document.getElementById('fSend').disabled = true;
    document.getElementById('fSend').textContent = 'Sending…';
    try {
      const res = await fetch(`/api/leagues/${league.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, attachments }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      modal.close();
      toast(`Email sent to ${data.sent} player${data.sent !== 1 ? 's' : ''}`, 'success');
    } catch (e) {
      errEl.textContent = e.message;
      document.getElementById('fSend').disabled = false;
      document.getElementById('fSend').textContent = 'Send Email';
    }
  });
}

// ===== PRINT SCHEDULE (Modern leagues) =====
function printSchedule(league) {
  const weeks = league.weeks || [];
  const divisions = (league.divisions || []).slice().sort((a, b) => a.level - b.level);

  // Build player name lookup
  const playerName = {};
  (league.players || []).forEach((p) => { playerName[p.player_id] = p.player_name; });

  const fmtDate = (d) => {
    if (!d) return '';
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const weeksHTML = weeks.map((week) => {
    // Build a map of division_id -> { matches, byes }
    const divData = {};
    divisions.forEach((d) => { divData[d.id] = { name: d.name, matches: [], byes: [] }; });

    (week.matchups || []).forEach((mu) => {
      if (!mu.division_id || !divData[mu.division_id]) return;
      (mu.matches || []).forEach((m) => {
        if (m.skipped) return;
        divData[mu.division_id].matches.push(m);
      });
    });
    (week.byes || []).forEach((b) => {
      if (divData[b.division_id]) divData[b.division_id].byes.push(b.player_name);
    });

    const divsHTML = divisions.map((div) => {
      const { matches, byes } = divData[div.id];
      if (matches.length === 0 && byes.length === 0) return '';

      const matchRows = matches.map((m) => {
        const p1 = m.sub1_name || m.player1_name;
        const p2 = m.sub2_name || m.player2_name;
        const score = (m.player1_score != null && m.player2_score != null)
          ? `<span class="sched-score">${m.player1_score}–${m.player2_score}</span>` : '';
        const court = league.schedule_courts && m.court_number ? `<span class="sched-meta">Ct ${m.court_number}</span>` : '';
        const time = m.match_time ? `<span class="sched-meta">${m.match_time}</span>` : '';
        return `<div class="sched-match">${esc(p1)} <span class="sched-vs">vs</span> ${esc(p2)}${score}${court}${time}</div>`;
      }).join('');

      const byeRow = byes.length
        ? `<div class="sched-bye">Bye: ${byes.map(esc).join(', ')}</div>` : '';

      return `<div class="sched-div">
        <div class="sched-div-name">${esc(div.name)}</div>
        ${matchRows}${byeRow}
      </div>`;
    }).join('');

    if (!divsHTML.trim()) return '';

    return `<div class="sched-week">
      <div class="sched-week-header">
        <span class="sched-week-num">Week ${week.week_number}</span>
        <span class="sched-week-date">${fmtDate(week.date)}</span>
      </div>
      <div class="sched-divs">${divsHTML}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Schedule — ${esc(league.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #000; font-size: 10pt; }

    .page-header { padding: 8mm 12mm 4mm; border-bottom: 2px solid #000; margin-bottom: 6mm; }
    .page-title { font-size: 18pt; font-weight: 800; }
    .page-sub { font-size: 10pt; color: #555; margin-top: 2px; }

    .schedule { padding: 0 12mm 10mm; columns: 2; column-gap: 8mm; }

    .sched-week {
      break-inside: avoid;
      margin-bottom: 6mm;
    }
    .sched-week-header {
      display: flex;
      align-items: baseline;
      gap: 6px;
      border-bottom: 1.5px solid #000;
      padding-bottom: 2px;
      margin-bottom: 3px;
    }
    .sched-week-num { font-size: 11pt; font-weight: 800; }
    .sched-week-date { font-size: 9pt; color: #555; }

    .sched-divs { padding-left: 2mm; }
    .sched-div { margin-bottom: 9px; }
    .sched-div-name { font-size: 8.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #222; margin-bottom: 4px; }

    .sched-match { font-size: 9.5pt; padding: 4px 0; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; border-bottom: 0.5px solid #eee; }
    .sched-match:last-of-type { border-bottom: none; }
    .sched-vs { color: #888; font-size: 8.5pt; }
    .sched-score { font-weight: 700; font-size: 9pt; margin-left: 2px; }
    .sched-meta { font-size: 8pt; color: #777; }
    .sched-bye { font-size: 8.5pt; color: #777; font-style: italic; padding: 4px 0 1px; }

    @page { size: A4 portrait; margin: 14mm 12mm; }
    @media print {
      body { background: #fff; }
      .page-header { padding: 0 0 4mm; }
      .schedule { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="page-header">
    <div class="page-title">${esc(league.name)}</div>
    <div class="page-sub">Schedule</div>
  </div>
  <div class="schedule">${weeksHTML}</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win2 = window.open(url, '_blank');
  win2.addEventListener('load', () => { win2.print(); URL.revokeObjectURL(url); });
}

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

async function reloadLeagueDetail() {
  const openIds = getOpenWeekIds();
  state.currentLeague = await window.api.getLeague(state.currentLeague.id);
  renderLeagueDetail();
  restoreOpenWeeks(openIds);
}

function renderLeagueDetail() {
  const league = state.currentLeague;
  if (!league) { navigate('leagues'); return; }

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

    <div class="section-title">${isModern ? 'Divisions' : 'Rosters'} <div class="divider"></div></div>
    ${isModern ? renderRostersModern(league, leagueEditMode) : renderRosters(league, leagueEditMode)}

    <div class="section-title">Schedule <div class="divider"></div></div>
    <div class="schedule-list" id="scheduleList">
      ${(league.weeks || []).map((w) => renderWeekCard(w, league, adminMode)).join('')}
    </div>`;

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
      openPlayerProfile(Number(a.dataset.playerId));
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

function showAuthLinkModal(title, url) {
  modal.open(title, `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
      No email service is configured. Copy this link and send it directly to the player.
    </p>
    <div style="display:flex;gap:8px;align-items:center">
      <input class="form-control" id="authLinkInput" value="${esc(url)}" readonly
        style="font-size:12px;font-family:monospace;flex:1">
      <button class="btn btn-primary" id="authLinkCopyBtn" style="flex-shrink:0">Copy</button>
    </div>
    <div style="margin-top:14px;text-align:right">
      <button class="btn btn-outline" id="authLinkCloseBtn">Close</button>
    </div>
  `);
  document.getElementById('authLinkInput').select();
  document.getElementById('authLinkCopyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(url).catch(() => {
      document.getElementById('authLinkInput').select();
      document.execCommand('copy');
    });
    document.getElementById('authLinkCopyBtn').textContent = 'Copied!';
  });
  document.getElementById('authLinkCloseBtn').addEventListener('click', modal.close);
}

function openTimingModal(btn) {
  const matchId = Number(btn.dataset.matchId);
  const scheduleCourts = btn.dataset.scheduleCourts === '1';
  const numCourts = Number(btn.dataset.numCourts) || 0;
  const currentTime = btn.dataset.matchTime || '';
  const currentCourt = btn.dataset.courtNumber || '';

  const courtField = scheduleCourts ? `
    <div class="form-group">
      <label>Court</label>
      <select class="form-control" id="timingCourt">
        <option value="">— No court —</option>
        ${Array.from({ length: numCourts }, (_, i) => i + 1).map((n) =>
          `<option value="${n}" ${Number(currentCourt) === n ? 'selected' : ''}>Court ${n}</option>`
        ).join('')}
      </select>
    </div>` : '';

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
    const courtVal = scheduleCourts ? (document.getElementById('timingCourt').value || null) : null;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const result = await window.api.updateMatchTiming({ matchId, matchTime: timeVal, courtNumber: courtVal ? Number(courtVal) : null });
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
      <div class="matchup-block">
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

  const showCourt = league && league.schedule_courts && match.court_number;
  const timingLabel = showCourt
    ? `Court ${match.court_number}${match.match_time ? ' · ' + match.match_time : ''}`
    : (match.match_time || '');
  const canEditTiming = adminMode && !match.skipped;
  const timingAttrs = canEditTiming ? `
    class="match-court-label timing-btn${timingLabel ? '' : ' timing-btn-empty'}"
    data-match-id="${match.id}"
    data-match-time="${match.match_time || ''}"
    data-court-number="${match.court_number || ''}"
    data-schedule-courts="${league && league.schedule_courts ? '1' : '0'}"
    data-num-courts="${league ? league.num_courts : 2}"` : `class="match-court-label"`;
  const courtInfo = (canEditTiming || timingLabel)
    ? `<span ${timingAttrs}>${timingLabel || 'Set time'}</span>` : '';

  const isSkipped = !!match.skipped;
  const leagueId = league ? league.id : '';

  if (isSkipped) {
    return `
      <div class="match-row match-row-skipped" data-match-id="${match.id}">
        <div class="match-meta">
          <span class="match-div-label">${esc(match.division_name.replace(/^Division\s*/i, 'D'))}</span>
        </div>
        <div class="match-players" style="opacity:0.4">
          <span class="match-player">${esc(eff1Name)}</span>
          <span class="text-muted" style="font-size:11px">vs</span>
          <span class="match-player">${esc(eff2Name)}</span>
        </div>
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
    <div class="match-row" data-match-id="${match.id}">
      <div class="match-meta">
        <span class="match-div-label">${esc(match.division_name.replace(/^Division\s*/i, 'D'))}</span>
        ${courtInfo}
      </div>
      <div class="match-players">
        <span class="match-player${p1Won ? ' winner' : ''}">${p1SubBadge}${esc(eff1Name)}</span>
        <span class="text-muted" style="font-size:11px">vs</span>
        <span class="match-player${p2Won ? ' winner' : ''}">${p2SubBadge}${esc(eff2Name)}</span>
      </div>
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

// ===== REPORT SCORE MODAL (player) =====
async function openReportScoreModal() {
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
        ${upcoming.map((m) => `
          <button class="rsc-match-item" data-match-id="${m.id}" data-opponent="${esc(m.opponent_name)}">
            <div class="rsc-match-opp">vs ${esc(m.opponent_name)}</div>
            <div class="rsc-match-meta">${esc(m.league_name)}${m.division_name ? ' · ' + esc(m.division_name) : ''} &nbsp;·&nbsp; ${fmtDate(m.week_date)}</div>
          </button>`).join('')}
      </div>`;
    document.getElementById('modalBody').querySelectorAll('.rsc-match-item').forEach((btn) => {
      btn.addEventListener('click', () => showScoreForm(Number(btn.dataset.matchId), btn.dataset.opponent));
    });
  }

  function showScoreForm(matchId, opponentName) {
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
        toast('Invalid score — one player must win 3 games (e.g. 3–1, 3–2)', 'warning');
        return;
      }

      const submitBtn = document.getElementById('rscSubmit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
      try {
        await window.api.reportPlayerScore({ matchId, myScore, theirScore });
        toast('Score submitted successfully!', 'success');
        modal.close();
        if (state.page === 'dashboard') renderDashboard();
      } catch (err) {
        toast(err.message || 'Failed to submit score', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Score';
      }
    });
  }

  showMatchList();
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

// ===== CREATE LEAGUE WIZARD =====
function startCreateLeague() {
  state.wizard = {
    step: 1,
    setupType: 'traditional',
    leagueName: '',
    startDate: defaultStartDate(),
    rankedPlayers: [],
    // Traditional
    numTeams: 3,
    numDivisions: 1,
    teamNames: [],
    // Modern
    modernNumDivisions: 2,
    modernDivisionPlayers: null,
    // Shared
    numRounds: 1,
    blackoutDates: [],
    matchStartTime: '19:00',
    numCourts: 2,
    matchDuration: 45,
    matchBuffer: 15,
    scheduleCourts: false,
  };
  navigate('createLeague');
}

function defaultStartDate() {
  const d = new Date();
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7)); // next Monday
  return d.toISOString().split('T')[0];
}

function renderCreateLeague() {
  document.getElementById('pageTitle').textContent = 'New League';
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.getElementById('mainContent');

  const steps = [
    { label: 'League Info' },
    { label: 'Add Players' },
    { label: 'Structure' },
    { label: 'Blackout Dates' },
    { label: 'Preview' },
  ];
  const s = state.wizard.step;

  const stepsHTML = steps.map((step, i) => {
    const num = i + 1;
    const cls = num < s ? 'done' : num === s ? 'active' : '';
    const connCls = num < s ? 'done' : '';
    return `
      <div class="wizard-step ${cls}">
        <div class="step-num">${num < s ? '&#10003;' : num}</div>
        <span class="step-label">${step.label}</span>
      </div>
      ${i < steps.length - 1 ? `<div class="step-connector ${connCls}"></div>` : ''}`;
  }).join('');

  content.innerHTML = `
    <div class="wizard">
      <div class="wizard-steps">${stepsHTML}</div>
      <div class="wizard-card" id="wizardCard"></div>
    </div>`;

  renderWizardStep();
}

function renderWizardStep() {
  switch (state.wizard.step) {
    case 1: renderStep1(); break;
    case 2: renderStep2(); break;
    case 3: renderStep3(); break;
    case 4: renderStep4(); break;
    case 5: renderStep5(); break;
  }
}

// Step 1 — League Info + Setup Type
function renderStep1() {
  const { setupType } = state.wizard;
  document.getElementById('wizardCard').innerHTML = `
    <h3 style="font-size:16px;font-weight:600;margin-bottom:20px">League Information</h3>
    <div class="form-group">
      <label>League Name *</label>
      <input class="form-control" id="wName" value="${esc(state.wizard.leagueName)}" placeholder="e.g. Fall 2024 League" autofocus>
    </div>
    <div class="form-group">
      <label>Start Date *</label>
      <input class="form-control" id="wDate" type="date" value="${esc(state.wizard.startDate)}">
    </div>
    <div class="form-group">
      <label>League Format</label>
      <div class="setup-type-grid">
        <div class="setup-type-card ${setupType === 'traditional' ? 'selected' : ''}" data-type="traditional">
          <div class="setup-type-title">Teams</div>
          <div class="setup-type-desc">Players are grouped into teams. Teams play each other each week, with one match per division.</div>
        </div>
        <div class="setup-type-card ${setupType === 'modern' ? 'selected' : ''}" data-type="modern">
          <div class="setup-type-title">No Teams</div>
          <div class="setup-type-desc">No teams. Players are grouped into divisions and play everyone in their division (round robin).</div>
        </div>
      </div>
    </div>
    <div id="wError" class="form-error"></div>
    <div class="wizard-footer">
      <button class="btn btn-outline" onclick="navigate('leagues')">Cancel</button>
      <button class="btn btn-primary" id="wNext">Next &rarr;</button>
    </div>`;

  document.getElementById('wizardCard').querySelectorAll('.setup-type-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.setup-type-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      state.wizard.setupType = card.dataset.type;
    });
  });

  document.getElementById('wNext').addEventListener('click', () => {
    const name = document.getElementById('wName').value.trim();
    const date = document.getElementById('wDate').value;
    if (!name) { document.getElementById('wError').textContent = 'League name is required.'; return; }
    if (!date) { document.getElementById('wError').textContent = 'Start date is required.'; return; }
    state.wizard.leagueName = name;
    state.wizard.startDate = date;
    state.wizard.step = 2;
    renderCreateLeague();
  });
}

// Step 2 — Select Players (order is determined by the Ladder)
async function renderStep2() {
  // Load ladder (source of truth for skill ranking)
  if (!state.ladder.length) state.ladder = await window.api.getLadder();
  const ladderOrder = state.ladder.map((p) => p.id);

  const allPlayers = state.players.length ? state.players : await window.api.getPlayers();
  state.players = allPlayers;

  // Build full available list in ladder order, unranked players appended alphabetically
  function buildAvailable() {
    const selectedIds = new Set(state.wizard.rankedPlayers.map((p) => p.id));
    const list = ladderOrder
      .map((id) => allPlayers.find((p) => p.id === id))
      .filter((p) => p && !selectedIds.has(p.id));
    allPlayers.forEach((p) => {
      if (!selectedIds.has(p.id) && !ladderOrder.includes(p.id)) list.push(p);
    });
    return list;
  }

  function renderAvailableList(query) {
    const q = query.trim().toLowerCase();
    const filtered = buildAvailable().filter((p) => !q || p.name.toLowerCase().includes(q));
    const el = document.getElementById('availableList');
    if (!el) return;
    el.innerHTML = filtered.length === 0
      ? `<div class="empty-state"><strong>${buildAvailable().length === 0 ? 'All players added' : 'No players match'}</strong></div>`
      : filtered.map((p) => `
          <div class="picker-item" data-action="add-player" data-id="${p.id}" data-name="${esc(p.name)}">
            <span style="flex:1">${esc(p.name)}</span>
            <span style="color:var(--accent);font-size:18px">+</span>
          </div>`).join('');
  }

  function renderSelectedList() {
    const el = document.getElementById('rankedList');
    const hdr = document.getElementById('selectedHeader');
    if (!el) return;
    if (hdr) hdr.textContent = `Selected (${state.wizard.rankedPlayers.length}) — ladder order`;
    el.innerHTML = state.wizard.rankedPlayers.length === 0
      ? '<div class="empty-state" style="padding:40px 20px"><strong>No players selected</strong><p>Click players on the left to add them.</p></div>'
      : state.wizard.rankedPlayers.map((p, i) => `
          <div class="picker-item">
            <div class="rank-badge">${i + 1}</div>
            <span style="flex:1">${esc(p.name)}</span>
            <button class="remove-btn" data-action="remove-player" data-idx="${i}">&times;</button>
          </div>`).join('');
  }

  document.getElementById('wizardCard').innerHTML = `
    <h3 style="font-size:16px;font-weight:600;margin-bottom:6px">Select Players</h3>
    <p class="text-muted" style="font-size:13px;margin-bottom:18px">
      Click a player to add them. Order is set by the <strong>Ladder</strong> ranking.
    </p>
    <div class="player-picker">
      <div class="picker-col">
        <h4>Club Players</h4>
        <input class="form-control" id="playerSearch" placeholder="Search players…" style="margin-bottom:8px" autocomplete="off">
        <div class="picker-list" id="availableList"></div>
      </div>
      <div class="picker-col">
        <h4 id="selectedHeader">Selected (${state.wizard.rankedPlayers.length}) &mdash; ladder order</h4>
        <div class="picker-list" id="rankedList"></div>
      </div>
    </div>
    <div id="wError" class="form-error mt-4"></div>
    <div class="wizard-footer">
      <button class="btn btn-outline" id="wBack">&larr; Back</button>
      <button class="btn btn-primary" id="wNext">Next &rarr;</button>
    </div>`;

  renderAvailableList('');
  renderSelectedList();

  document.getElementById('playerSearch').addEventListener('input', (e) => {
    renderAvailableList(e.target.value);
  });

  document.getElementById('wBack').addEventListener('click', () => { state.wizard.step = 1; renderCreateLeague(); });
  document.getElementById('wNext').addEventListener('click', () => {
    if (state.wizard.rankedPlayers.length < 2) {
      document.getElementById('wError').textContent = 'Select at least 2 players.';
      return;
    }
    state.wizard.step = 3;
    renderCreateLeague();
  });

  document.getElementById('wizardCard').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'add-player') {
      const el = e.target.closest('[data-action]');
      state.wizard.rankedPlayers.push({ id: Number(el.dataset.id), name: el.dataset.name });
      state.wizard.rankedPlayers.sort((a, b) => {
        const ai = ladderOrder.indexOf(a.id);
        const bi = ladderOrder.indexOf(b.id);
        return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
      });
      const query = document.getElementById('playerSearch')?.value || '';
      renderAvailableList(query);
      renderSelectedList();
    } else if (action === 'remove-player') {
      const idx = Number(e.target.closest('[data-action]').dataset.idx);
      state.wizard.rankedPlayers.splice(idx, 1);
      const query = document.getElementById('playerSearch')?.value || '';
      renderAvailableList(query);
      renderSelectedList();
    }
  });
}

// Step 3 — Structure (dispatches based on setupType)
async function renderStep3() {
  if (state.wizard.setupType === 'modern') return renderStep3Modern();
  return renderStep3Traditional();
}

async function renderStep3Modern() {
  const n = state.wizard.rankedPlayers.length;
  const { modernNumDivisions, numRounds, matchStartTime, numCourts, matchDuration, matchBuffer, scheduleCourts } = state.wizard;
  const maxDivs = Math.floor(n / 2);
  const isValid = modernNumDivisions >= 1 && modernNumDivisions <= maxDivs;

  // Compute estimated total weeks based on even distribution
  let totalWeeks = null;
  if (isValid) {
    const maxDivSize = Math.ceil(n / modernNumDivisions);
    const singleRound = maxDivSize % 2 === 0 ? maxDivSize - 1 : maxDivSize;
    totalWeeks = singleRound * numRounds;
  }

  // Preview distribution
  let distPreview = '';
  if (isValid) {
    const sizes = Array.from({ length: modernNumDivisions }, (_, i) =>
      Math.floor(n / modernNumDivisions) + (i < n % modernNumDivisions ? 1 : 0)
    );
    distPreview = sizes.map((s, i) => `Div ${i + 1}: ${s} player${s !== 1 ? 's' : ''}`).join(' &nbsp;&middot;&nbsp; ');
  }

  document.getElementById('wizardCard').innerHTML = `
    <h3 style="font-size:16px;font-weight:600;margin-bottom:6px">League Structure</h3>
    <p class="text-muted" style="font-size:13px;margin-bottom:20px">
      You have <strong>${n} players</strong>. Set the number of divisions (minimum 2 players per division).
    </p>

    <div class="step3-grid">
      <div>
        <div class="form-group">
          <label>Number of Divisions</label>
          <input class="form-control" id="wModernDivs" type="number" min="1" max="${maxDivs}" value="${modernNumDivisions}" style="font-size:16px;font-weight:600">
          <p class="text-muted" style="font-size:12px;margin-top:6px">Min 1 &nbsp;&middot;&nbsp; Max ${maxDivs} (at least 2 players per division)</p>
        </div>

        ${isValid ? `<div class="structure-calc" style="font-size:13px">${distPreview}</div>` : ''}
        ${!isValid && modernNumDivisions >= 1 ? `<div class="struct-warning">Can't create ${modernNumDivisions} divisions with ${n} players — each division needs at least 2 players.</div>` : ''}

        <div class="form-group" style="margin-top:20px">
          <label>Rounds through the schedule</label>
          <input class="form-control" id="wRounds" type="number" min="1" value="${numRounds}">
          ${isValid ? `<p class="text-muted" style="font-size:12px;margin-top:6px">~${totalWeeks} total weeks (based on largest division)</p>` : ''}
        </div>
      </div>

      <div>
        <div class="form-group">
          <label>Match Start Time</label>
          <input class="form-control" id="wStartTime" type="time" value="${matchStartTime}">
        </div>
        <div class="form-group">
          <label># of Courts</label>
          <input class="form-control" id="wCourts" type="number" min="1" value="${numCourts}">
        </div>
        <div class="form-group">
          <label>Match Duration <span class="form-hint">(minutes)</span></label>
          <input class="form-control" id="wDuration" type="number" min="1" value="${matchDuration}">
        </div>
        <div class="form-group">
          <label>Buffer Between Matches <span class="form-hint">(minutes)</span></label>
          <input class="form-control" id="wBuffer" type="number" min="0" value="${matchBuffer}">
        </div>
        <div class="form-group form-group-check">
          <label class="check-label">
            <input type="checkbox" id="wScheduleCourts" ${scheduleCourts ? 'checked' : ''}>
            Display court assignments on schedule
          </label>
        </div>
      </div>
    </div>

    <div id="wError" class="form-error mt-4"></div>
    <div class="wizard-footer">
      <button class="btn btn-outline" id="wBack">&larr; Back</button>
      <button class="btn btn-outline" id="wApply">Apply Settings</button>
      <button class="btn btn-primary" id="wNext" ${!isValid ? 'disabled' : ''}>Next &rarr;</button>
    </div>`;

  document.getElementById('wBack').addEventListener('click', () => { state.wizard.step = 2; renderCreateLeague(); });
  document.getElementById('wNext').addEventListener('click', () => {
    if (!isValid) return;
    state.wizard.modernNumDivisions = modernNumDivisions;
    state.wizard.modernDivisionPlayers = null; // reset so step 5 re-distributes
    state.wizard.step = 4;
    renderCreateLeague();
  });

  function applyModernSettings() {
    state.wizard.modernNumDivisions = Math.max(1, Number(document.getElementById('wModernDivs').value) || 1);
    state.wizard.numRounds = Math.max(1, Number(document.getElementById('wRounds').value) || 1);
    state.wizard.matchStartTime = document.getElementById('wStartTime').value;
    state.wizard.numCourts = Math.max(1, Number(document.getElementById('wCourts').value) || 1);
    state.wizard.matchDuration = Math.max(1, Number(document.getElementById('wDuration').value) || 1);
    state.wizard.matchBuffer = Math.max(0, Number(document.getElementById('wBuffer').value) || 0);
    state.wizard.scheduleCourts = document.getElementById('wScheduleCourts').checked;
    state.wizard.modernDivisionPlayers = null; // reset distribution
    renderCreateLeague();
  }

  document.getElementById('wApply').addEventListener('click', applyModernSettings);
}

async function renderStep3Traditional() {
  const n = state.wizard.rankedPlayers.length;
  const { numTeams, numRounds, matchStartTime, numCourts, matchDuration, matchBuffer, scheduleCourts } = state.wizard;
  const configs = await window.api.getValidConfigs(n);

  const isValid = numTeams >= 2 && n % numTeams === 0;
  const numDivisions = isValid ? n / numTeams : null;
  const baseWeeks = isValid ? (numTeams % 2 === 0 ? numTeams - 1 : numTeams) : null;
  const totalWeeks = isValid ? baseWeeks * numRounds : null;
  const calcClass = numTeams < 2 ? '' : isValid ? 'ok' : 'err';

  let warning = '';
  if (numTeams >= 2 && !isValid) {
    warning = nearestConfigWarning(n, configs, 'teams', numTeams);
  }

  // Late night warning: calculate latest possible end time on a league night
  let lateWarning = '';
  if (isValid && matchStartTime && numCourts >= 1) {
    const matchesPerWeek = Math.floor(numTeams / 2) * numDivisions;
    const slots = Math.ceil(matchesPerWeek / numCourts);
    const totalMins = slots * (matchDuration + matchBuffer);
    const [sh, sm] = matchStartTime.split(':').map(Number);
    const endMins = sh * 60 + sm + totalMins;
    if (endMins > 21 * 60) {
      const endH = Math.floor(endMins / 60);
      const endM = String(endMins % 60).padStart(2, '0');
      lateWarning = `Latest matches on a league night may finish around <strong>${endH}:${endM}</strong> — after 9:00 PM.`;
    }
  }

  document.getElementById('wizardCard').innerHTML = `
    <h3 style="font-size:16px;font-weight:600;margin-bottom:6px">League Structure</h3>
    <p class="text-muted" style="font-size:13px;margin-bottom:20px">
      You have <strong>${n} players</strong>. Set the number of teams and match scheduling options.
    </p>

    <div class="step3-grid">
      <div>
        <div class="form-group">
          <label>Number of Teams</label>
          <input class="form-control" id="wTeams" type="number" min="2" value="${numTeams}" style="font-size:16px;font-weight:600">
        </div>

        <div class="structure-calc">
          <div class="calc-row">
            <span><strong>${numTeams || '?'}</strong> teams</span>
            <span class="calc-eq">&times;</span>
            <span><strong>${isValid ? numDivisions : '?'}</strong> divisions</span>
            <span class="calc-eq">=</span>
            <span class="calc-val ${calcClass}">${isValid ? n : '?'} players ${isValid ? '&#10003;' : ''}</span>
          </div>
        </div>

        ${warning ? `<div class="struct-warning">${warning}</div>` : ''}

        <div class="form-group" style="margin-top:20px">
          <label>Rounds through the schedule</label>
          <input class="form-control" id="wRounds" type="number" min="1" value="${numRounds}">
          ${isValid ? `<p class="text-muted" style="font-size:12px;margin-top:6px">${baseWeeks} weeks &times; ${numRounds} round(s) = <strong>${totalWeeks} total weeks</strong></p>` : ''}
        </div>

        ${configs.length > 0 ? `
          <p style="font-size:12px;color:var(--text-muted);margin-top:4px">
            Valid team counts: ${configs.map((c) => `<strong>${c.teams}</strong>`).join(', ')}
          </p>` : ''}
      </div>

      <div>
        <div class="form-group">
          <label>Match Start Time</label>
          <input class="form-control" id="wStartTime" type="time" value="${matchStartTime}">
        </div>
        <div class="form-group">
          <label># of Courts</label>
          <input class="form-control" id="wCourts" type="number" min="1" value="${numCourts}">
        </div>
        <div class="form-group">
          <label>Match Duration <span class="form-hint">(minutes)</span></label>
          <input class="form-control" id="wDuration" type="number" min="1" value="${matchDuration}">
        </div>
        <div class="form-group">
          <label>Buffer Between Matches <span class="form-hint">(minutes)</span></label>
          <input class="form-control" id="wBuffer" type="number" min="0" value="${matchBuffer}">
        </div>
        <div class="form-group form-group-check">
          <label class="check-label">
            <input type="checkbox" id="wScheduleCourts" ${scheduleCourts ? 'checked' : ''}>
            Display court assignments on schedule
          </label>
        </div>
        ${lateWarning ? `<div class="struct-warning struct-warning-late">&#9888; ${lateWarning}</div>` : ''}
      </div>
    </div>

    <div id="wError" class="form-error mt-4"></div>
    <div class="wizard-footer">
      <button class="btn btn-outline" id="wBack">&larr; Back</button>
      <button class="btn btn-outline" id="wApply">Apply Settings</button>
      <button class="btn btn-primary" id="wNext" ${!isValid ? 'disabled' : ''}>Next &rarr;</button>
    </div>`;

  document.getElementById('wBack').addEventListener('click', () => { state.wizard.step = 2; renderCreateLeague(); });
  document.getElementById('wNext').addEventListener('click', () => {
    if (!isValid) return;
    state.wizard.numTeams = numTeams;
    state.wizard.numDivisions = numDivisions;
    state.wizard.step = 4;
    renderCreateLeague();
  });

  function applyStep3Settings() {
    state.wizard.numTeams = Number(document.getElementById('wTeams').value) || 0;
    state.wizard.numRounds = Math.max(1, Number(document.getElementById('wRounds').value) || 1);
    state.wizard.matchStartTime = document.getElementById('wStartTime').value;
    state.wizard.numCourts = Math.max(1, Number(document.getElementById('wCourts').value) || 1);
    state.wizard.matchDuration = Math.max(1, Number(document.getElementById('wDuration').value) || 1);
    state.wizard.matchBuffer = Math.max(0, Number(document.getElementById('wBuffer').value) || 0);
    state.wizard.scheduleCourts = document.getElementById('wScheduleCourts').checked;
    renderCreateLeague();
  }

  document.getElementById('wApply').addEventListener('click', applyStep3Settings);
}

function nearestConfigWarning(n, configs, mode, inputVal) {
  if (configs.length === 0) return `${n} players cannot be evenly divided. Add or remove players.`;
  const nearest = configs.reduce((best, c) => {
    const val = mode === 'teams' ? c.teams : c.divisions;
    const bestVal = mode === 'teams' ? best.teams : best.divisions;
    return Math.abs(val - inputVal) < Math.abs(bestVal - inputVal) ? c : best;
  });
  if (mode === 'teams') {
    return `${n} players can't be split into ${inputVal} teams evenly. Try <strong>${nearest.teams} teams</strong> (${nearest.divisions} divisions).`;
  }
  return `${n} players can't be split into ${inputVal} divisions evenly. Try <strong>${nearest.divisions} divisions</strong> (${nearest.teams} teams).`;
}

// Step 4 — Blackout Dates
function renderStep4() {
  const { blackoutDates, startDate, numTeams, numRounds, setupType, modernNumDivisions, rankedPlayers } = state.wizard;
  let totalWeeks;
  if (setupType === 'modern') {
    const maxDivSize = Math.ceil(rankedPlayers.length / modernNumDivisions);
    const singleRound = maxDivSize % 2 === 0 ? maxDivSize - 1 : maxDivSize;
    totalWeeks = singleRound * numRounds;
  } else {
    const baseWeeks = numTeams % 2 === 0 ? numTeams - 1 : numTeams;
    totalWeeks = baseWeeks * numRounds;
  }

  document.getElementById('wizardCard').innerHTML = `
    <h3 style="font-size:16px;font-weight:600;margin-bottom:6px">Blackout Dates</h3>
    <p class="text-muted" style="font-size:13px;margin-bottom:4px">
      Mark any weeks to skip. The schedule will extend past those dates automatically.
    </p>
    <p class="text-muted" style="font-size:12px;margin-bottom:20px">
      League runs <strong>${totalWeeks} week${totalWeeks !== 1 ? 's' : ''}</strong> starting ${formatDate(startDate)}.
    </p>

    <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:16px">
      <div class="form-group" style="flex:1;max-width:240px;margin-bottom:0">
        <label>Add a date to skip</label>
        <input class="form-control" id="wBlackoutDate" type="date" min="${startDate}">
      </div>
      <button class="btn btn-outline" id="wAddBlackout">Add</button>
    </div>

    ${blackoutDates.length === 0
      ? '<p class="text-muted" style="font-size:13px">No blackout dates added.</p>'
      : `<div class="blackout-list">
          ${blackoutDates.map((d, i) => `
            <div class="blackout-item">
              <span>${formatDate(d)}</span>
              <button class="btn btn-ghost btn-sm" data-action="remove-blackout" data-idx="${i}">&times; Remove</button>
            </div>`).join('')}
        </div>`}

    <div class="wizard-footer" style="margin-top:24px">
      <button class="btn btn-outline" id="wBack">&larr; Back</button>
      <button class="btn btn-primary" id="wNext">Next &rarr;</button>
    </div>`;

  document.getElementById('wBack').addEventListener('click', () => { state.wizard.step = 3; renderCreateLeague(); });
  document.getElementById('wNext').addEventListener('click', () => { state.wizard.step = 5; renderCreateLeague(); });

  document.getElementById('wAddBlackout').addEventListener('click', () => {
    const dateVal = document.getElementById('wBlackoutDate').value;
    if (!dateVal) return;
    if (!state.wizard.blackoutDates.includes(dateVal)) {
      state.wizard.blackoutDates.push(dateVal);
      state.wizard.blackoutDates.sort();
    }
    renderCreateLeague();
  });

  document.getElementById('wizardCard').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'remove-blackout') {
      const idx = Number(e.target.closest('[data-action]').dataset.idx);
      state.wizard.blackoutDates.splice(idx, 1);
      renderCreateLeague();
    }
  });
}

// Step 5 — Preview & Confirm
function renderStep5() {
  if (state.wizard.setupType === 'modern') return renderStep5Modern();
  return renderStep5Traditional();
}

function distributePlayersEvenly(players, numDivisions) {
  const n = players.length;
  const divs = [];
  let start = 0;
  for (let i = 0; i < numDivisions; i++) {
    const size = Math.floor(n / numDivisions) + (i < n % numDivisions ? 1 : 0);
    divs.push(players.slice(start, start + size));
    start += size;
  }
  return divs;
}

function previewModernRoundRobin(players) {
  const list = [...players];
  if (list.length % 2 === 1) list.push(null);
  const numRounds = list.length - 1;
  const half = list.length / 2;
  const fixed = list[0];
  let rotating = list.slice(1);
  const rounds = [];
  for (let r = 0; r < numRounds; r++) {
    const current = [fixed, ...rotating];
    const matches = [], byes = [];
    for (let i = 0; i < half; i++) {
      const p1 = current[i], p2 = current[current.length - 1 - i];
      if (!p1) byes.push(p2);
      else if (!p2) byes.push(p1);
      else matches.push([p1, p2]);
    }
    rounds.push({ matches, byes });
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

function renderStep5Modern() {
  const { leagueName, startDate, rankedPlayers, modernNumDivisions, numRounds, blackoutDates } = state.wizard;

  // Initialize or re-initialize division players if needed
  if (!state.wizard.modernDivisionPlayers ||
      state.wizard.modernDivisionPlayers.length !== modernNumDivisions ||
      state.wizard.modernDivisionPlayers.flat().length !== rankedPlayers.length) {
    state.wizard.modernDivisionPlayers = distributePlayersEvenly(rankedPlayers, modernNumDivisions);
  }
  const divPlayers = state.wizard.modernDivisionPlayers;

  // Compute actual total weeks from division sizes
  const divRounds = divPlayers.map((div) => {
    const oneRound = previewModernRoundRobin(div);
    const all = [];
    for (let rep = 0; rep < numRounds; rep++) all.push(...oneRound);
    return all;
  });
  const totalWeeks = Math.max(...divRounds.map((d) => d.length), 0);

  // Assign dates skipping blackouts
  const blackoutSet = new Set(blackoutDates);
  const weekDates = [];
  let cur = startDate;
  for (let i = 0; i < totalWeeks; i++) {
    while (blackoutSet.has(cur)) cur = addDaysPreview(cur, 7);
    weekDates.push(cur);
    cur = addDaysPreview(cur, 7);
  }

  const previewCount = Math.min(3, totalWeeks);
  const blackoutNote = blackoutDates.length > 0
    ? ` (${blackoutDates.length} blackout date${blackoutDates.length !== 1 ? 's' : ''} skipped)` : '';

  const weeksHTML = Array.from({ length: previewCount }, (_, w) => {
    const dateStr = new Date(weekDates[w] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const divsHTML = divRounds.map((rounds, dIdx) => {
      if (w >= rounds.length) return '';
      const round = rounds[w];
      const matchLines = round.matches.map(([p1, p2]) =>
        `<div style="font-size:12px;padding:2px 0">${esc(p1.name)} vs ${esc(p2.name)}</div>`
      ).join('');
      const byeLines = round.byes.length
        ? `<div style="font-size:12px;color:var(--text-muted);padding:2px 0">Bye: ${round.byes.map((p) => esc(p.name)).join(', ')}</div>` : '';
      return `<div style="margin-bottom:6px"><span style="font-size:11px;font-weight:700;color:var(--text-muted)">DIV ${dIdx + 1}</span>${matchLines}${byeLines}</div>`;
    }).join('');
    return `<div style="margin-bottom:14px">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px">Week ${w + 1}: ${dateStr}</div>
      ${divsHTML}
    </div>`;
  }).join('');

  const rostersHTML = divPlayers.map((div, i) =>
    `<div style="margin-bottom:6px"><strong>Division ${i + 1}</strong> (${div.length}): ${div.map((p) => esc(p.name)).join(', ')}</div>`
  ).join('');

  document.getElementById('wizardCard').innerHTML = `
    <h3 style="font-size:16px;font-weight:600;margin-bottom:20px">Preview &amp; Confirm</h3>

    <div class="info-banner">
      <strong>${esc(leagueName)}</strong> &mdash; starts ${formatDate(startDate)} &mdash;
      ${modernNumDivisions} division${modernNumDivisions !== 1 ? 's' : ''} &mdash; ${rankedPlayers.length} players &mdash; ${totalWeeks} weeks${blackoutNote}
    </div>

    <div class="preview-grid">
      <div class="preview-section">
        <h4 style="display:flex;align-items:center;justify-content:space-between">
          Division Rosters
          <button class="btn btn-outline btn-sm" id="btnEditDivisions">Edit Divisions</button>
        </h4>
        <div style="font-size:13px">${rostersHTML}</div>
      </div>
      <div class="preview-section">
        <h4>Schedule Preview (first ${previewCount} week${previewCount !== 1 ? 's' : ''})</h4>
        ${weeksHTML}
        ${totalWeeks > previewCount ? `<p class="text-muted" style="font-size:12px;margin-top:4px">+ ${totalWeeks - previewCount} more weeks…</p>` : ''}
      </div>
    </div>

    <div id="wError" class="form-error"></div>
    <div class="wizard-footer">
      <button class="btn btn-outline" id="wBack">&larr; Back</button>
      <button class="btn btn-success btn-lg" id="wCreate">Create League</button>
    </div>`;

  document.getElementById('wBack').addEventListener('click', () => { state.wizard.step = 4; renderCreateLeague(); });
  document.getElementById('wCreate').addEventListener('click', submitCreateLeague);
  document.getElementById('btnEditDivisions').addEventListener('click', openEditDivisionsModal);
}

function openEditDivisionsModal() {
  let workingDivs = state.wizard.modernDivisionPlayers.map((d) => [...d]);
  let dragSource = null;

  modal.open('Edit Divisions', `
    <p class="text-muted" style="font-size:13px;margin-bottom:16px">
      Drag players between divisions to reassign them. Each division needs at least 2 players.
    </p>
    <div id="edColumns" class="ed-columns"></div>
    <div id="edError" class="form-error" style="margin-top:8px"></div>
    <div class="form-actions" style="margin-top:20px">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSubmit">Save</button>
    </div>`, { wide: true });

  function renderColumns() {
    document.getElementById('edColumns').innerHTML = workingDivs.map((div, dIdx) => `
      <div class="ed-column" data-div="${dIdx}">
        <div class="ed-column-title">Division ${dIdx + 1} <span class="ed-count">(${div.length})</span></div>
        ${div.map((p, pIdx) => `
          <div class="ed-player" draggable="true" data-div="${dIdx}" data-idx="${pIdx}">
            ${esc(p.name)}
          </div>`).join('')}
      </div>`).join('');

    document.getElementById('edColumns').querySelectorAll('.ed-player').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        dragSource = { divIdx: Number(el.dataset.div), playerIdx: Number(el.dataset.idx) };
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });

    document.getElementById('edColumns').querySelectorAll('.ed-column').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (!dragSource) return;
        const targetDiv = Number(col.dataset.div);
        if (targetDiv === dragSource.divIdx) { dragSource = null; return; }
        const [player] = workingDivs[dragSource.divIdx].splice(dragSource.playerIdx, 1);
        workingDivs[targetDiv].push(player);
        dragSource = null;
        renderColumns();
      });
    });
  }

  renderColumns();

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', () => {
    const invalid = workingDivs.find((d) => d.length < 2);
    if (invalid) {
      document.getElementById('edError').textContent = 'Each division must have at least 2 players.';
      return;
    }
    state.wizard.modernDivisionPlayers = workingDivs;
    modal.close();
    renderStep5();
  });
}

function renderStep5Traditional() {
  const { leagueName, startDate, rankedPlayers, numTeams, numDivisions, numRounds, blackoutDates } = state.wizard;
  const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Initialise / resize teamNames, preserving any custom names already entered
  if (state.wizard.teamNames.length !== numTeams) {
    state.wizard.teamNames = Array.from({ length: numTeams }, (_, i) =>
      state.wizard.teamNames[i] || `Team ${LABELS[i]}`
    );
  }
  const teamNames = state.wizard.teamNames;

  // Build preview teams using current teamNames
  const teams = Array.from({ length: numTeams }, (_, i) => ({ name: teamNames[i], players: [] }));
  rankedPlayers.forEach((p, i) => {
    const teamIdx = i % numTeams;
    const divIdx = Math.floor(i / numTeams);
    teams[teamIdx].players.push({ name: p.name, div: `Div ${divIdx + 1}` });
  });

  // Build full schedule with numRounds repetitions, skipping blackout dates
  const teamIndexes = Array.from({ length: numTeams }, (_, i) => i);
  const oneRoundRobin = previewRoundRobin(teamIndexes);
  const allRounds = [];
  for (let rep = 0; rep < numRounds; rep++) allRounds.push(...oneRoundRobin);

  // Assign dates, skipping blackouts
  const blackoutSet = new Set(blackoutDates);
  const weekDates = [];
  let cur = startDate;
  for (let i = 0; i < allRounds.length; i++) {
    while (blackoutSet.has(cur)) cur = addDaysPreview(cur, 7);
    weekDates.push(cur);
    cur = addDaysPreview(cur, 7);
  }

  const totalWeeks = allRounds.length;
  const previewCount = Math.min(3, totalWeeks);
  const weeksHTML = allRounds.slice(0, previewCount).map((round, r) => {
    const dateStr = new Date(weekDates[r] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `
      <div style="margin-bottom:12px">
        <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text)">
          Week ${r + 1}: ${dateStr}
        </div>
        ${round.map((mu) => mu.bye != null
          ? `<div style="font-size:13px;color:var(--text-muted);padding:3px 0"><span class="sched-team" data-team-idx="${mu.bye}">${esc(teams[mu.bye].name)}</span> — <em>Bye</em></div>`
          : `<div style="font-size:13px;padding:3px 0"><span class="sched-team" data-team-idx="${mu.team1}">${esc(teams[mu.team1].name)}</span> vs <span class="sched-team" data-team-idx="${mu.team2}">${esc(teams[mu.team2].name)}</span></div>`
        ).join('')}
      </div>`;
  }).join('');

  const blackoutNote = blackoutDates.length > 0
    ? ` (${blackoutDates.length} blackout date${blackoutDates.length !== 1 ? 's' : ''} skipped)`
    : '';

  document.getElementById('wizardCard').innerHTML = `
    <h3 style="font-size:16px;font-weight:600;margin-bottom:20px">Preview &amp; Confirm</h3>

    <div class="info-banner">
      <strong>${esc(leagueName)}</strong> &mdash; starts ${formatDate(startDate)} &mdash;
      ${numTeams} teams &times; ${numDivisions} divisions &mdash; ${totalWeeks} weeks${blackoutNote}
    </div>

    <div class="preview-grid">
      <div class="preview-section">
        <h4 style="display:flex;align-items:center;justify-content:space-between">
          Team Rosters
          <button class="btn btn-outline btn-sm" id="btnEditTeams">Edit Teams</button>
        </h4>
        <div class="team-list" id="rosterPreview">
          ${teams.map((t) => `
            <div class="team-row">
              <div class="team-name-display">${esc(t.name)}</div>
              <div class="team-players">${t.players.map((p) => `${esc(p.name)} (${p.div})`).join(', ')}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="preview-section">
        <h4>Schedule Preview (first ${previewCount} weeks)</h4>
        ${weeksHTML}
        ${totalWeeks > previewCount ? `<p class="text-muted" style="font-size:12px;margin-top:4px">+ ${totalWeeks - previewCount} more weeks…</p>` : ''}
      </div>
    </div>

    <div id="wError" class="form-error"></div>
    <div class="wizard-footer">
      <button class="btn btn-outline" id="wBack">&larr; Back</button>
      <button class="btn btn-success btn-lg" id="wCreate">Create League</button>
    </div>`;

  document.getElementById('wBack').addEventListener('click', () => { state.wizard.step = 4; renderCreateLeague(); });
  document.getElementById('wCreate').addEventListener('click', submitCreateLeague);

  document.getElementById('btnEditTeams').addEventListener('click', () => openEditTeamsModal(numTeams, numDivisions));
}

function openEditTeamsModal(numTeams, numDivisions) {
  const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // Work on a mutable copy of rankedPlayers and teamNames
  let workingPlayers = [...state.wizard.rankedPlayers];
  let workingNames = [...state.wizard.teamNames];

  const getPlayer = (divIdx, teamIdx) => workingPlayers[divIdx * numTeams + teamIdx];

  const renderGrid = () => {
    // Team name inputs
    document.querySelectorAll('.et-team-name').forEach((inp) => {
      workingNames[Number(inp.dataset.teamIdx)] = inp.value;
    });

    const nameInputs = Array.from({ length: numTeams }, (_, i) => `
      <th style="padding:6px 8px;min-width:110px">
        <input class="form-control et-team-name" data-team-idx="${i}"
          value="${esc(workingNames[i])}" placeholder="Team ${LABELS[i]}"
          style="font-size:12px;padding:5px 8px;text-align:center">
      </th>`).join('');

    const divRows = Array.from({ length: numDivisions }, (_, divIdx) => {
      const cells = Array.from({ length: numTeams }, (_, teamIdx) => {
        const p = getPlayer(divIdx, teamIdx);
        return `<td style="padding:6px 8px;text-align:center">
          <button class="et-player-btn" data-div="${divIdx}" data-team="${teamIdx}"
            style="width:100%;padding:7px 10px;border:2px solid var(--border);border-radius:6px;
                   background:var(--surface);cursor:pointer;font-size:13px;white-space:nowrap">
            ${esc(p?.name || '—')}
          </button>
        </td>`;
      }).join('');
      return `<tr>
        <td style="padding:6px 10px;font-size:12px;font-weight:600;color:var(--text-muted);white-space:nowrap">Div ${divIdx + 1}</td>
        ${cells}
      </tr>`;
    }).join('');

    document.getElementById('etGrid').innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th></th>${nameInputs}</tr></thead>
        <tbody>${divRows}</tbody>
      </table>`;

    let selected = null; // { divIdx, teamIdx }

    document.querySelectorAll('.et-player-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        // Flush name inputs before any swap
        document.querySelectorAll('.et-team-name').forEach((inp) => {
          workingNames[Number(inp.dataset.teamIdx)] = inp.value;
        });

        const divIdx  = Number(btn.dataset.div);
        const teamIdx = Number(btn.dataset.team);

        if (!selected) {
          selected = { divIdx, teamIdx };
          btn.style.borderColor = 'var(--accent)';
          btn.style.background = 'rgba(58,77,181,0.08)';
        } else {
          if (selected.divIdx === divIdx && selected.teamIdx === teamIdx) {
            // Deselect
            selected = null;
            btn.style.borderColor = 'var(--border)';
            btn.style.background = 'var(--surface)';
            return;
          }
          // Swap the two players in workingPlayers
          const idxA = selected.divIdx * numTeams + selected.teamIdx;
          const idxB = divIdx * numTeams + teamIdx;
          [workingPlayers[idxA], workingPlayers[idxB]] = [workingPlayers[idxB], workingPlayers[idxA]];
          selected = null;
          renderGrid();
        }
      });
    });

    // Re-attach name input listeners to keep workingNames in sync
    document.querySelectorAll('.et-team-name').forEach((inp) => {
      inp.addEventListener('input', () => {
        workingNames[Number(inp.dataset.teamIdx)] = inp.value;
      });
    });
  };

  modal.open('Edit Teams', `
    <p class="text-muted" style="font-size:13px;margin-bottom:16px">
      Edit team names above. Click any two players in the same or different divisions to swap them.
    </p>
    <div id="etGrid"></div>
    <div id="fError" class="form-error" style="margin-top:8px"></div>
    <div class="form-actions" style="margin-top:20px">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSubmit">Save</button>
    </div>`, { wide: true });

  renderGrid();

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', () => {
    // Flush any unsaved name inputs
    document.querySelectorAll('.et-team-name').forEach((inp) => {
      workingNames[Number(inp.dataset.teamIdx)] = inp.value.trim() || `Team ${LABELS[Number(inp.dataset.teamIdx)]}`;
    });
    state.wizard.rankedPlayers = workingPlayers;
    state.wizard.teamNames = workingNames;
    modal.close();
    renderStep5(); // Re-render step 5 with updated data
  });
}

function addDaysPreview(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function previewRoundRobin(indexes) {
  if (indexes.length < 2) return [];
  let list = [...indexes];
  if (list.length % 2 === 1) list.push('BYE');
  const numRounds = list.length - 1;
  const half = list.length / 2;
  const fixed = list[0];
  let rotating = list.slice(1);
  const rounds = [];

  for (let r = 0; r < numRounds; r++) {
    const current = [fixed, ...rotating];
    const round = [];
    for (let i = 0; i < half; i++) {
      const t1 = current[i], t2 = current[current.length - 1 - i];
      if (t1 === 'BYE') round.push({ bye: t2 });
      else if (t2 === 'BYE') round.push({ bye: t1 });
      else round.push({ team1: t1, team2: t2 });
    }
    rounds.push(round);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

async function submitCreateLeague() {
  const btn = document.getElementById('wCreate');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating…';

  const { leagueName, startDate, setupType, numRounds, blackoutDates,
          matchStartTime, numCourts, matchDuration, matchBuffer, scheduleCourts } = state.wizard;

  let payload;
  if (setupType === 'modern') {
    payload = {
      name: leagueName, startDate, setup_type: 'modern',
      numRounds, blackoutDates, matchStartTime, numCourts, matchDuration, matchBuffer, scheduleCourts,
      divisions: state.wizard.modernDivisionPlayers.map((divPlayers, dIdx) =>
        divPlayers.map((p, pIdx) => ({ playerId: p.id, rank: dIdx * 1000 + pIdx + 1 }))
      ),
    };
  } else {
    const { rankedPlayers, numTeams, numDivisions, teamNames } = state.wizard;
    payload = {
      name: leagueName, startDate, setup_type: 'traditional',
      numTeams, numDivisions, numRounds, blackoutDates, teamNames,
      matchStartTime, numCourts, matchDuration, matchBuffer, scheduleCourts,
      rankedPlayers: rankedPlayers.map((p, i) => ({ playerId: p.id, rank: i + 1 })),
    };
  }

  try {
    const leagueId = await window.api.createLeague(payload);
    toast(`League "${leagueName}" created!`, 'success');
    const league = await window.api.getLeague(leagueId);
    navigate('leagueDetail', { league });
  } catch (e) {
    document.getElementById('wError').textContent = e.message || 'Failed to create league.';
    btn.disabled = false;
    btn.textContent = 'Create League';
  }
}

// ===== HAMBURGER MENU =====
(function() {
  const btn = document.getElementById('hamburgerBtn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!btn) return;
  function closeSidebar() {
    btn.classList.remove('open');
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('open');
  }
  btn.addEventListener('click', () => {
    const opening = !sidebar.classList.contains('mobile-open');
    btn.classList.toggle('open', opening);
    sidebar.classList.toggle('mobile-open', opening);
    overlay.classList.toggle('open', opening);
  });
  overlay.addEventListener('click', closeSidebar);
  // Close sidebar when a nav item is clicked (mobile UX)
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', closeSidebar);
  });
  document.getElementById('navMyProfile')?.addEventListener('click', closeSidebar);
})();

// ===== INIT =====
window.addEventListener('DOMContentLoaded', async () => {
  try {
    state.currentUser = await fetch('/api/me').then((r) => r.json());
  } catch (_) {}

  // Show "My Profile" nav item for players
  if (state.currentUser?.role === 'player' && state.currentUser?.playerId) {
    const navMyProfile = document.getElementById('navMyProfile');
    navMyProfile.style.display = '';
    navMyProfile.addEventListener('click', () => openPlayerProfile(state.currentUser.playerId));
  }

  state.players = await window.api.getPlayers();
  navigate('dashboard');
});
