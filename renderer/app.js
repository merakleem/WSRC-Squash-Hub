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
    updateLadder:     (ids) => _apiFetch('PUT', '/api/ladder', { playerIds: ids }),
    getPlayerHistory: (id)  => _apiFetch('GET', `/api/players/${id}/history`),
    getPlayerRecords: ()    => _apiFetch('GET', '/api/players/records'),

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
    leagueName: '',
    startDate: '',
    rankedPlayers: [],    // [{ id, name }] ordered best → worst
    numTeams: 3,
    numDivisions: 1,
    numRounds: 1,
    blackoutDates: [],
    teamNames: [],        // custom names; index matches team slot
    matchStartTime: '19:00',
    numCourts: 2,
    matchDuration: 45,
    matchBuffer: 15,
    scheduleCourts: false,
  },
};

// ===== ROLE HELPERS =====
const isAdmin = () => state.currentUser?.role === 'admin';

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
  switch (state.page) {
    case 'dashboard':     renderDashboard(); break;
    case 'players':       renderPlayers(); break;
    case 'ladder':        renderLadder(); break;
    case 'leagues':       renderLeagues(); break;
    case 'leagueDetail':  renderLeagueDetail(); break;
    case 'createLeague':  renderCreateLeague(); break;
    case 'playerProfile': renderPlayerProfile(); break;
  }
}

// ===== DASHBOARD =====
async function renderDashboard() {
  document.getElementById('pageTitle').textContent = 'Dashboard';
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.getElementById('mainContent');
  content.innerHTML = `<div class="dashboard-loading">Loading…</div>`;

  const user = state.currentUser;

  if (!user || user.role === 'admin') {
    content.innerHTML = `
      <div class="dash-admin">
        <div class="dash-admin-hero">
          <div class="dash-greeting">Welcome Back.</div>
          <div class="dash-greeting-sub">Manage players, leagues, and schedules from here.</div>
        </div>
        <div class="dash-admin-grid">
          <button class="dash-admin-card" onclick="navigate('players')">
            <div class="dash-admin-card-icon"><img src="/assets/players-icon-blue.png" alt=""></div>
            <div class="dash-admin-card-label">Manage Players</div>
            <div class="dash-admin-card-sub">View, add, and edit players</div>
          </button>
          <button class="dash-admin-card" onclick="navigate('leagues')">
            <div class="dash-admin-card-icon"><img src="/assets/leagues-icon-blue.png" alt=""></div>
            <div class="dash-admin-card-label">Manage Leagues</div>
            <div class="dash-admin-card-sub">Create leagues and enter scores</div>
          </button>
          <button class="dash-admin-card" onclick="navigate('ladder')">
            <div class="dash-admin-card-icon"><img src="/assets/ladder-icon-blue.png" alt=""></div>
            <div class="dash-admin-card-label">Player Rankings</div>
            <div class="dash-admin-card-sub">Manage the club ladder</div>
          </button>
        </div>
      </div>`;
    return;
  }

  // Player dashboard — fetch data in parallel
  const playerId = user.playerId;
  const [playerData, ladder] = await Promise.all([
    fetch(`/api/players/${playerId}/history`).then((r) => r.json()),
    window.api.getLadder(),
  ]);

  const upcoming = playerData.upcoming || [];
  const membersOnly = ladder.filter((p) => p.wsrc_member);
  const ladderPos = membersOnly.findIndex((p) => p.id === playerId);
  const rank = ladderPos >= 0 ? ladderPos + 1 : null;
  const totalPlayers = membersOnly.length;

  const nextMatch = upcoming[0] || null;
  const restUpcoming = upcoming.slice(1, 5);

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

  const nextMatchHTML = nextMatch ? (() => {
    const showCourt = nextMatch.schedule_courts && nextMatch.court_number;
    const timeStr = showCourt
      ? `Court ${nextMatch.court_number}${nextMatch.match_time ? ' · ' + nextMatch.match_time : ''}`
      : (nextMatch.match_time || null);
    const divLabel = nextMatch.division_name ? nextMatch.division_name.replace(/^Division\s*/i, 'D') : '';
    return `
      <div class="dash-next-card">
        <div class="dash-next-eyebrow">Next Match</div>
        <div class="dash-next-date">${fmtMatchDate(nextMatch.week_date)}</div>
        <div class="dash-next-matchup">
          <div class="dash-next-you">${esc(playerData.name)}</div>
          <div class="dash-next-vs">vs</div>
          <div class="dash-next-opp">${esc(nextMatch.opponent_name)}</div>
        </div>
        <div class="dash-next-meta">
          ${divLabel ? `<span class="dash-next-chip">${esc(divLabel)}</span>` : ''}
          ${nextMatch.league_name ? `<span class="dash-next-league">${esc(nextMatch.league_name)}</span>` : ''}
          ${timeStr ? `<span class="dash-next-time">${esc(timeStr)}</span>` : ''}
        </div>
      </div>`;
  })() : `
      <div class="dash-next-card dash-next-empty">
        <div class="dash-next-eyebrow">Next Match</div>
        <div class="dash-empty-msg">No upcoming matches scheduled</div>
      </div>`;

  const upcomingHTML = restUpcoming.length === 0 ? '' : `
    <div class="dash-section">
      <div class="dash-section-label">Upcoming</div>
      <div class="dash-upcoming-list">
        ${restUpcoming.map((m) => `
          <div class="dash-upcoming-row">
            <div class="dash-upcoming-opp">${esc(m.opponent_name)}</div>
            <div class="dash-upcoming-date">${fmtShortDate(m.week_date)}</div>
          </div>`).join('')}
        <div class="dash-upcoming-footer">
          <button class="dash-more-link" onclick="openPlayerProfile(${playerId})">More details</button>
        </div>
      </div>
    </div>`;

  const rankHTML = rank !== null ? `
    <div class="dash-section">
      <div class="dash-section-label">Your Ranking</div>
      <div class="dash-rank-card">
        <div class="dash-rank-num">#${rank}</div>
        <div class="dash-rank-sub">of ${totalPlayers} players</div>
        <button class="dash-rank-link" onclick="navigate('ladder')">See full ladder</button>
      </div>
    </div>` : '';

  const quickHTML = `
    <div class="dash-section">
      <div class="dash-section-label">Quick Actions</div>
      <div class="dash-quick-grid">
        <button class="dash-quick-btn" onclick="navigate('players')">
          <img src="/assets/players-icon-blue.png" alt="">Player List
        </button>
        <button class="dash-quick-btn" onclick="navigate('leagues')">
          <img src="/assets/leagues-icon-blue.png" alt="">Leagues
        </button>
        <button class="dash-quick-btn" onclick="openPlayerProfile(${playerId})">
          <img src="/assets/profile-icon-blue.png" alt="">My Profile
        </button>
      </div>
    </div>`;

  content.innerHTML = `
    <div class="dash-player">
      <div class="dash-col dash-col-left">
        ${nextMatchHTML}
        ${rankHTML}
      </div>
      <div class="dash-col dash-col-right">
        ${upcomingHTML}
        ${quickHTML}
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
  const isMember = player.id ? player.wsrc_member : true;
  const rating = player.club_locker_rating != null ? Number(player.club_locker_rating).toFixed(2) : '';
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
      <label>Member Number <span class="form-hint">(used as login password)</span></label>
      <input class="form-control" id="fMemberNumber" value="${esc(player.member_number || '')}" placeholder="Member number" ${!isMember ? 'disabled' : ''}>
    </div>
    <div class="form-group">
      <label>Club Locker Rating <span class="form-hint">(1.0 – 7.0, optional)</span></label>
      <input class="form-control" id="fRating" type="number" min="1" max="7" step="0.01" value="${esc(rating)}" placeholder="e.g. 3.50">
    </div>
    <div class="form-group form-group-check">
      <label class="check-label">
        <input type="checkbox" id="fMember" ${isMember ? 'checked' : ''}>
        WSRC Member
      </label>
    </div>
    <div id="fError" class="form-error"></div>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSubmit">${player.id ? 'Save Changes' : 'Add Player'}</button>
    </div>`;
}

function attachMemberNumberToggle() {
  const cb = document.getElementById('fMember');
  const inp = document.getElementById('fMemberNumber');
  cb.addEventListener('change', () => {
    inp.disabled = !cb.checked;
    if (!cb.checked) inp.value = '';
  });
}

function openAddPlayerModal() {
  modal.open('Add Player', playerFormHTML());
  attachMemberNumberToggle();
  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const name = document.getElementById('fName').value.trim();
    const email = document.getElementById('fEmail').value.trim();
    const phone = document.getElementById('fPhone').value.trim();
    const member_number = document.getElementById('fMemberNumber').value.trim();
    const club_locker_rating = document.getElementById('fRating').value.trim();
    const wsrc_member = document.getElementById('fMember').checked;
    if (!name) { document.getElementById('fError').textContent = 'Name is required.'; return; }
    try {
      await window.api.addPlayer({ name, email, phone, member_number, wsrc_member, club_locker_rating });
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
  attachMemberNumberToggle();
  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const name = document.getElementById('fName').value.trim();
    const email = document.getElementById('fEmail').value.trim();
    const phone = document.getElementById('fPhone').value.trim();
    const member_number = document.getElementById('fMemberNumber').value.trim();
    const club_locker_rating = document.getElementById('fRating').value.trim();
    const wsrc_member = document.getElementById('fMember').checked;
    if (!name) { document.getElementById('fError').textContent = 'Name is required.'; return; }
    try {
      await window.api.updatePlayer({ id: player.id, name, email, phone, member_number, wsrc_member, club_locker_rating });
      modal.close();
      toast('Player updated', 'success');
      state.players = await window.api.getPlayers();
      // If we edited from a player profile, reload the profile with fresh data
      if (state.page === 'playerProfile') {
        await openPlayerProfile(player.id);
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
  const headers = ['name', 'email', 'phone', 'member_number', 'wsrc_member', 'club_locker_rating'];
  const rows = state.players.map((p) => [
    p.name,
    p.email || '',
    p.phone || '',
    p.member_number || '',
    p.wsrc_member ? '1' : '0',
    p.club_locker_rating != null ? Number(p.club_locker_rating).toFixed(2) : '',
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
      Expected columns: <code>name, email, phone, member_number, wsrc_member, club_locker_rating</code>
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
      const nameIdx       = headers.indexOf('name');
      const emailIdx      = headers.indexOf('email');
      const phoneIdx      = headers.indexOf('phone');
      const memberNumIdx  = headers.indexOf('member_number');
      const memberIdx     = headers.indexOf('wsrc_member');
      const ratingIdx     = headers.indexOf('club_locker_rating');
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
      const conflicted = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) || lines[i].split(',');
        const name = parseCell(row, nameIdx).trim();
        if (!name) continue;
        if (existingNames.has(name.toLowerCase())) { skipped.push(name); continue; }
        const wsrc_member = parseCell(row, memberIdx) === '1';
        const member_number = parseCell(row, memberNumIdx);
        if (member_number && !wsrc_member) { conflicted.push(name); continue; }
        parsed.push({
          name,
          email: parseCell(row, emailIdx),
          phone: parseCell(row, phoneIdx),
          member_number,
          wsrc_member,
          club_locker_rating: parseCell(row, ratingIdx) || '',
        });
      }
      if (conflicted.length) {
        document.getElementById('fError').textContent =
          `Fix CSV before importing — these players have a member number but wsrc_member is not 1: ${conflicted.join(', ')}`;
        document.getElementById('fSubmit').disabled = true;
        return;
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
      <label style="display:flex;align-items:center;justify-content:center;cursor:pointer;gap:4px;font-size:11px;color:var(--text-muted)">
        <input type="checkbox" class="bulk-member-cb" data-row="${i}" checked>
        Member
      </label>
      <input class="form-control bulk-member-number" placeholder="Member #" data-field="member_number" data-row="${i}">
      <button class="btn btn-ghost btn-sm bulk-remove" data-row="${i}" title="Remove row">&times;</button>
    </div>`).join('');

  let rowCount = 5;

  const rebuild = () => {
    document.getElementById('bulkRows').innerHTML = renderRows(rowCount);
    document.querySelectorAll('.bulk-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.row);
        const names    = [...document.querySelectorAll('.bulk-name')].map(el => el.value);
        const emails   = [...document.querySelectorAll('.bulk-email')].map(el => el.value);
        const phones   = [...document.querySelectorAll('.bulk-phone')].map(el => el.value);
        const cbs      = [...document.querySelectorAll('.bulk-member-cb')].map(el => el.checked);
        const members  = [...document.querySelectorAll('.bulk-member-number')].map(el => el.value);
        names.splice(idx, 1); emails.splice(idx, 1); phones.splice(idx, 1); cbs.splice(idx, 1); members.splice(idx, 1);
        rowCount = Math.max(1, rowCount - 1);
        rebuild();
        document.querySelectorAll('.bulk-name').forEach((el, i)          => { el.value   = names[i]   || ''; });
        document.querySelectorAll('.bulk-email').forEach((el, i)         => { el.value   = emails[i]  || ''; });
        document.querySelectorAll('.bulk-phone').forEach((el, i)         => { el.value   = phones[i]  || ''; });
        document.querySelectorAll('.bulk-member-cb').forEach((el, i)     => { el.checked = cbs[i] !== undefined ? cbs[i] : true; });
        document.querySelectorAll('.bulk-member-number').forEach((el, i) => { el.value   = members[i] || ''; });
        // Re-run toggle for each row after restore
        document.querySelectorAll('.bulk-member-cb').forEach((cb) => cb.dispatchEvent(new Event('change')));
      });
    });

    // Toggle member # based on WSRC member checkbox
    document.querySelectorAll('.bulk-member-cb').forEach((cb) => {
      const row = cb.closest('.bulk-row');
      const inp = row.querySelector('.bulk-member-number');
      const toggle = () => { inp.disabled = !cb.checked; if (!cb.checked) inp.value = ''; };
      toggle();
      cb.addEventListener('change', toggle);
    });
  };

  modal.open('Add Multiple Players', `
    <p class="text-muted" style="font-size:13px;margin-bottom:16px">Fill in each player's details. Rows without a name will be skipped.</p>
    <div class="bulk-header">
      <span></span><span>Name *</span><span>Email</span><span>Phone</span><span style="text-align:center">WSRC<br>Member</span><span>Member #</span><span></span>
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
    const names   = [...document.querySelectorAll('.bulk-name')].map(el => el.value);
    const emails  = [...document.querySelectorAll('.bulk-email')].map(el => el.value);
    const phones  = [...document.querySelectorAll('.bulk-phone')].map(el => el.value);
    const cbs     = [...document.querySelectorAll('.bulk-member-cb')].map(el => el.checked);
    const members = [...document.querySelectorAll('.bulk-member-number')].map(el => el.value);
    rowCount++;
    rebuild();
    document.querySelectorAll('.bulk-name').forEach((el, i)          => { el.value   = names[i]   || ''; });
    document.querySelectorAll('.bulk-email').forEach((el, i)         => { el.value   = emails[i]  || ''; });
    document.querySelectorAll('.bulk-phone').forEach((el, i)         => { el.value   = phones[i]  || ''; });
    document.querySelectorAll('.bulk-member-cb').forEach((el, i)     => { el.checked = cbs[i] !== undefined ? cbs[i] : true; });
    document.querySelectorAll('.bulk-member-number').forEach((el, i) => { el.value   = members[i] || ''; });
    document.querySelectorAll('.bulk-member-cb').forEach((cb) => cb.dispatchEvent(new Event('change')));
  });

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const rows = [];
    document.querySelectorAll('.bulk-row').forEach((row) => {
      const name          = row.querySelector('.bulk-name').value.trim();
      const email         = row.querySelector('.bulk-email').value.trim();
      const phone         = row.querySelector('.bulk-phone').value.trim();
      const wsrc_member   = row.querySelector('.bulk-member-cb').checked;
      const member_number = wsrc_member ? row.querySelector('.bulk-member-number').value.trim() : '';
      if (name) rows.push({ name, email, phone, wsrc_member, member_number });
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
  document.getElementById('topbarActions').innerHTML = adminMode ? `
    <div class="options-menu" id="optionsMenu">
      <button class="btn btn-outline" id="optionsBtn">Options <svg width="14" height="14" viewBox="0 0 4 14" fill="currentColor" style="vertical-align:middle;margin-left:2px"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/></svg></button>
      <div class="options-dropdown" id="optionsDropdown">
        <button class="options-item" data-action="edit-player" data-id="${p.id}">Edit Information</button>
        <button class="options-item options-item-danger" data-action="delete-player" data-id="${p.id}" data-name="${esc(p.name)}">Delete Player</button>
      </div>
    </div>` : '';

  if (adminMode) {
    document.getElementById('optionsBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('optionsDropdown').classList.toggle('open');
    });
    document.getElementById('optionsDropdown').addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      document.getElementById('optionsDropdown').classList.remove('open');
      if (action === 'edit-player') {
        const player = state.players.find((pl) => pl.id === Number(e.target.dataset.id))
          || state.currentPlayer;
        openEditPlayerModal(player);
      } else if (action === 'delete-player') {
        confirmDeletePlayer(Number(e.target.dataset.id), e.target.dataset.name);
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

  document.getElementById('mainContent').innerHTML = `
    <div class="profile-header-card">
      <div class="profile-info">
        <div class="profile-avatar">${esc(p.name.charAt(0).toUpperCase())}</div>
        <div>
          <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">${esc(p.name)}</h2>
          ${p.email ? `<div class="text-muted" style="font-size:13px">${esc(p.email)}</div>` : ''}
          ${p.phone ? `<div class="text-muted" style="font-size:13px">${esc(p.phone)}</div>` : ''}
          ${adminMode && p.member_number ? `<div class="text-muted" style="font-size:13px">Member #: <strong>${esc(p.member_number)}</strong></div>` : ''}
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
async function renderLadder(showNonMembers = false) {
  document.getElementById('pageTitle').textContent = 'Ladder';
  document.getElementById('topbarActions').innerHTML = '';

  [state.ladder] = await Promise.all([window.api.getLadder()]);
  const recordsArr = await window.api.getPlayerRecords();
  const records = Array.isArray(recordsArr)
    ? Object.fromEntries(recordsArr.map((r) => [r.id, r]))
    : recordsArr;

  const content = document.getElementById('mainContent');

  if (state.ladder.length === 0) {
    content.innerHTML = `
      <div class="table-card">
        <div class="empty-state">
          <strong>No players yet</strong>
          <p>Add players on the Players page and they will appear here.</p>
        </div>
      </div>`;
    return;
  }

  const visible = showNonMembers ? state.ladder : state.ladder.filter((p) => p.wsrc_member);

  const adminMode = isAdmin();

  if (adminMode) {
    content.innerHTML = `
      <div class="table-card">
        <div class="table-toolbar">
          <span class="text-muted">${visible.length} player${visible.length !== 1 ? 's' : ''} &mdash; drag rows or use arrows to reorder</span>
          <label class="check-label check-label-inline">
            <input type="checkbox" id="showNonMembers" ${showNonMembers ? 'checked' : ''}>
            Show non-members
          </label>
        </div>
        <div class="ladder-list" id="ladderList">
          ${visible.map((p, i) => {
            const rec = records[p.id] || { wins: 0, losses: 0 };
            const rating = p.club_locker_rating != null ? Number(p.club_locker_rating).toFixed(2) : null;
            const nonMemberBadge = !p.wsrc_member ? `<span class="non-member-badge">Non-member</span>` : '';
            const ratingBadge = rating ? `<span class="ladder-rating">${rating}</span>` : '';
            return `
            <div class="ladder-row${!p.wsrc_member ? ' ladder-row-nonmember' : ''}" draggable="true" data-id="${p.id}" data-idx="${i}">
              <span class="ladder-drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
              <span class="ladder-rank">${i + 1}</span>
              <a class="ladder-name player-link" data-action="view-profile" data-id="${p.id}">${esc(p.name)}</a>
              ${ratingBadge}
              ${nonMemberBadge}
              <span class="ladder-record">${rec.wins}W – ${rec.losses}L</span>
              <div class="ladder-controls">
                <button class="rank-btn" data-action="ladder-up" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>&#9650;</button>
                <button class="rank-btn" data-action="ladder-down" data-idx="${i}" ${i === visible.length - 1 ? 'disabled' : ''}>&#9660;</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  } else {
    const top10 = visible.slice(0, 10);
    const rest  = visible.slice(10);
    const rowHTML = (p, i) => {
      const rec = records[p.id] || { wins: 0, losses: 0 };
      return `
      <div class="ladder-row${!p.wsrc_member ? ' ladder-row-nonmember' : ''}" data-id="${p.id}" data-idx="${i}">
        <span class="ladder-rank ladder-rank-top10">${i + 1}</span>
        <a class="ladder-name player-link" data-action="view-profile" data-id="${p.id}">${esc(p.name)}</a>
        ${!p.wsrc_member ? `<span class="non-member-badge">Non-member</span>` : ''}
        <span class="ladder-record">${rec.wins}W – ${rec.losses}L</span>
      </div>`;
    };
    const restRowHTML = (p, i) => {
      const rec = records[p.id] || { wins: 0, losses: 0 };
      return `
      <div class="ladder-row${!p.wsrc_member ? ' ladder-row-nonmember' : ''}" data-id="${p.id}" data-idx="${i}">
        <span class="ladder-rank">${i + 1}</span>
        <a class="ladder-name player-link" data-action="view-profile" data-id="${p.id}">${esc(p.name)}</a>
        ${!p.wsrc_member ? `<span class="non-member-badge">Non-member</span>` : ''}
        <span class="ladder-record">${rec.wins}W – ${rec.losses}L</span>
      </div>`;
    };
    content.innerHTML = `
      <div class="table-toolbar" style="background:var(--surface);border-radius:var(--radius-lg);box-shadow:var(--shadow);padding:14px 18px;margin-bottom:12px">
        <span class="text-muted">${visible.length} player${visible.length !== 1 ? 's' : ''}</span>
        <label class="check-label check-label-inline">
          <input type="checkbox" id="showNonMembers" ${showNonMembers ? 'checked' : ''}>
          Show non-members
        </label>
      </div>
      <div class="ladder-list ladder-list-readonly" id="ladderList">
        <div class="ladder-top10-section">
          <div class="ladder-top10-header">&#9733; Top 10</div>
          ${top10.map((p, i) => rowHTML(p, i)).join('')}
        </div>
        ${rest.length > 0 ? `
        <div style="margin-top:10px">
          <div class="ladder-rest-section">
            <div class="ladder-rest-header">All Members</div>
            ${rest.map((p, i) => restRowHTML(p, i + 10)).join('')}
          </div>
        </div>` : ''}
      </div>`;
  }

  document.getElementById('showNonMembers').addEventListener('change', (e) => {
    renderLadder(e.target.checked);
  });

  // Arrow buttons + player profile links
  // data-idx is the index within `visible`; map back to state.ladder via player id
  const list = document.getElementById('ladderList');
  list.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'view-profile') {
      openPlayerProfile(Number(e.target.closest('[data-action]').dataset.id));
      return;
    }
    const visIdx = Number(e.target.closest('[data-action]').dataset.idx);
    const playerId = visible[visIdx]?.id;
    const fullIdx = state.ladder.findIndex((p) => p.id === playerId);
    if (fullIdx === -1) return;
    if (action === 'ladder-up' && fullIdx > 0) {
      [state.ladder[fullIdx - 1], state.ladder[fullIdx]] = [state.ladder[fullIdx], state.ladder[fullIdx - 1]];
    } else if (action === 'ladder-down' && fullIdx < state.ladder.length - 1) {
      [state.ladder[fullIdx], state.ladder[fullIdx + 1]] = [state.ladder[fullIdx + 1], state.ladder[fullIdx]];
    } else {
      return;
    }
    await saveLadder();
    renderLadder(showNonMembers);
  });

  // Drag-and-drop (admin only)
  let dragIdx = null;

  if (adminMode) list.querySelectorAll('.ladder-row').forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      dragIdx = Number(row.dataset.idx);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      list.querySelectorAll('.ladder-row').forEach((r) => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.ladder-row').forEach((r) => r.classList.remove('drag-over'));
      row.classList.add('drag-over');

      // Auto-scroll while dragging near viewport edges
      const zone = 80, speed = 10;
      const scrollEl = document.querySelector('.content');
      if (scrollEl) {
        const { top, bottom } = scrollEl.getBoundingClientRect();
        if (e.clientY < top + zone) scrollEl.scrollBy(0, -speed);
        else if (e.clientY > bottom - zone) scrollEl.scrollBy(0, speed);
      }
    });
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      const dropVisIdx = Number(row.dataset.idx);
      if (dragIdx === null || dragIdx === dropVisIdx) return;
      const fromId = visible[dragIdx]?.id;
      const toId = visible[dropVisIdx]?.id;
      const fromFull = state.ladder.findIndex((p) => p.id === fromId);
      const toFull = state.ladder.findIndex((p) => p.id === toId);
      if (fromFull === -1 || toFull === -1) return;
      const [moved] = state.ladder.splice(fromFull, 1);
      state.ladder.splice(toFull, 0, moved);
      await saveLadder();
      renderLadder(showNonMembers);
    });
  });
}

async function saveLadder() {
  await window.api.updateLadder(state.ladder.map((p) => p.id));
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
          ${league.num_teams} teams &times; ${league.num_divisions} divisions &mdash; ${league.num_teams * league.num_divisions} players
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
  const numRounds = league.num_rounds || 1;
  const weeks = league.weeks || [];
  const weeksPerRound = Math.round(weeks.length / numRounds);

  // Group weeks into rounds
  const rounds = [];
  for (let r = 0; r < numRounds; r++) {
    rounds.push(weeks.slice(r * weeksPerRound, (r + 1) * weeksPerRound));
  }

  // Group players by division (sorted by team_order within each division)
  const divMap = {};
  (league.players || []).forEach((p) => {
    if (!divMap[p.division_level]) {
      divMap[p.division_level] = { name: p.division_name, level: p.division_level, players: [] };
    }
    divMap[p.division_level].players.push(p);
  });
  const divisions = Object.values(divMap)
    .sort((a, b) => a.level - b.level)
    .map((d) => ({ ...d, players: d.players.slice().sort((a, b) => a.team_order - b.team_order) }));

  let pagesHTML = '';

  rounds.forEach((roundWeeks, roundIdx) => {
    // Build pairIndex: sorted player-id pair -> week
    const pairWeek = {};
    roundWeeks.forEach((week) => {
      (week.matchups || []).forEach((mu) => {
        (mu.matches || []).forEach((match) => {
          const key = [match.player1_id, match.player2_id].sort((a, b) => a - b).join('-');
          pairWeek[key] = week;
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
          <div class="box-col-team">${esc(p.team_name)}</div>
        </th>`).join('');

      // Rows
      const rows = players.map((rowP) => {
        const cells = players.map((colP) => {
          if (rowP.player_id === colP.player_id) {
            return '<td class="box-cell box-cell-self"><div class="box-cell-x">✕</div></td>';
          }
          return '<td class="box-cell"></td>';
        }).join('');
        return `<tr>
          <td class="box-row-header">
            <div class="box-row-player">${esc(rowP.player_name)}</div>
            <div class="box-row-team">${esc(rowP.team_name)}</div>
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
    <div class="options-menu" id="optionsMenu">
      <button class="btn btn-outline" id="optionsBtn">Options <svg width="14" height="14" viewBox="0 0 4 14" fill="currentColor" style="vertical-align:middle;margin-left:2px"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/></svg></button>
      <div class="options-dropdown" id="optionsDropdown">
        <button class="options-item" data-action="print-boxes">Print Boxes</button>
        <button class="options-item" data-action="copy-link">Get Public Link</button>
        <button class="options-item options-item-danger" data-action="delete-league" data-id="${league.id}" data-name="${esc(league.name)}">Delete League</button>
      </div>
    </div>` : '';

  if (adminMode) {
    document.getElementById('optionsBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('optionsDropdown').classList.toggle('open');
    });
    document.getElementById('optionsDropdown').addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'print-boxes') {
        document.getElementById('optionsDropdown').classList.remove('open');
        printBoxes(league);
      } else if (action === 'copy-link') {
        document.getElementById('optionsDropdown').classList.remove('open');
        copyPublicLink(league);
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
  const numPlayers = league.num_teams * league.num_divisions;

  content.innerHTML = `
    <div class="league-header-card">
      <h2>${esc(league.name)}</h2>
      <div class="league-stats">
        <div class="stat"><span class="stat-val">${league.num_teams}</span><span class="stat-label">Teams</span></div>
        <div class="stat"><span class="stat-val">${league.num_divisions}</span><span class="stat-label">Divisions</span></div>
        <div class="stat"><span class="stat-val">${numPlayers}</span><span class="stat-label">Players</span></div>
        <div class="stat"><span class="stat-val">${league.weeks ? league.weeks.length : 0}</span><span class="stat-label">Weeks</span></div>
        <div class="stat"><span class="stat-val">${formatShortDate(league.start_date)}</span><span class="stat-label">Start Date</span></div>
      </div>
    </div>

    <div class="section-title">Rosters <div class="divider"></div></div>
    ${renderRosters(league)}

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

  // Score forms (admin only)
  if (adminMode) {
    content.querySelectorAll('.score-save-btn').forEach((btn) => {
      btn.addEventListener('click', () => saveMatchScore(btn));
    });

    // Sub buttons
    content.querySelectorAll('.sub-btn').forEach((btn) => {
      btn.addEventListener('click', () => openSubModal(btn));
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

function renderRosters(league) {
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
            </div>`).join('')}
        </div>`;
    }).join('')}
  </div>`;
}

function renderWeekCard(week, league, adminMode = true) {
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
  const courtInfo = showCourt
    ? `<span class="match-court-label">Court ${match.court_number}${match.match_time ? ' · ' + match.match_time : ''}</span>`
    : (match.match_time ? `<span class="match-court-label">${match.match_time}</span>` : '');

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
    leagueName: '',
    startDate: defaultStartDate(),
    rankedPlayers: [],
    numTeams: 3,
    numDivisions: 1,
    numRounds: 1,
    blackoutDates: [],
    teamNames: [],
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

// Step 1 — League Info
function renderStep1() {
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
    <div id="wError" class="form-error"></div>
    <div class="wizard-footer">
      <button class="btn btn-outline" onclick="navigate('leagues')">Cancel</button>
      <button class="btn btn-primary" id="wNext">Next &rarr;</button>
    </div>`;

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

  const selectedIds = new Set(state.wizard.rankedPlayers.map((p) => p.id));

  // Available list shown in ladder order (unranked players appended alphabetically)
  const available = ladderOrder
    .map((id) => allPlayers.find((p) => p.id === id))
    .filter((p) => p && !selectedIds.has(p.id));
  // Also include any players not on the ladder yet
  allPlayers.forEach((p) => {
    if (!selectedIds.has(p.id) && !ladderOrder.includes(p.id)) available.push(p);
  });

  document.getElementById('wizardCard').innerHTML = `
    <h3 style="font-size:16px;font-weight:600;margin-bottom:6px">Select Players</h3>
    <p class="text-muted" style="font-size:13px;margin-bottom:18px">
      Click a player to add them. Order is set by the <strong>Ladder</strong> ranking.
    </p>
    <div class="player-picker">
      <div class="picker-col">
        <h4>Club Players</h4>
        <div class="picker-list" id="availableList">
          ${available.length === 0
            ? '<div class="empty-state"><strong>All players added</strong></div>'
            : available.map((p) => `
                <div class="picker-item" data-action="add-player" data-id="${p.id}" data-name="${esc(p.name)}">
                  <span style="flex:1">${esc(p.name)}</span>
                  <span style="color:var(--accent);font-size:18px">+</span>
                </div>`).join('')}
        </div>
      </div>
      <div class="picker-col">
        <h4>Selected (${state.wizard.rankedPlayers.length}) &mdash; ladder order</h4>
        <div class="picker-list" id="rankedList">
          ${state.wizard.rankedPlayers.length === 0
            ? '<div class="empty-state" style="padding:40px 20px"><strong>No players selected</strong><p>Click players on the left to add them.</p></div>'
            : state.wizard.rankedPlayers.map((p, i) => `
                <div class="picker-item">
                  <div class="rank-badge">${i + 1}</div>
                  <span style="flex:1">${esc(p.name)}</span>
                  <button class="remove-btn" data-action="remove-player" data-idx="${i}">&times;</button>
                </div>`).join('')}
        </div>
      </div>
    </div>
    <div id="wError" class="form-error mt-4"></div>
    <div class="wizard-footer">
      <button class="btn btn-outline" id="wBack">&larr; Back</button>
      <button class="btn btn-primary" id="wNext">Next &rarr;</button>
    </div>`;

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
      // Re-sort by ladder order
      state.wizard.rankedPlayers.sort((a, b) => {
        const ai = ladderOrder.indexOf(a.id);
        const bi = ladderOrder.indexOf(b.id);
        return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
      });
      renderCreateLeague();
    } else if (action === 'remove-player') {
      const idx = Number(e.target.closest('[data-action]').dataset.idx);
      state.wizard.rankedPlayers.splice(idx, 1);
      renderCreateLeague();
    }
  });
}

// Step 3 — Structure
async function renderStep3() {
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
  const { blackoutDates, startDate, numTeams, numRounds } = state.wizard;
  const baseWeeks = numTeams % 2 === 0 ? numTeams - 1 : numTeams;
  const totalWeeks = baseWeeks * numRounds;

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

  const { leagueName, startDate, rankedPlayers, numTeams, numDivisions, numRounds, blackoutDates, teamNames,
          matchStartTime, numCourts, matchDuration, matchBuffer, scheduleCourts } = state.wizard;
  const payload = {
    name: leagueName,
    startDate,
    numTeams,
    numDivisions,
    numRounds,
    blackoutDates,
    teamNames,
    matchStartTime,
    numCourts,
    matchDuration,
    matchBuffer,
    scheduleCourts,
    rankedPlayers: rankedPlayers.map((p, i) => ({ playerId: p.id, rank: i + 1 })),
  };

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
