import { state, isAdmin } from '../state.js';
import { esc, toast, modal } from '../utils.js';

// ===== DASHBOARD HELPERS =====
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

const _roundLabels = { group: 'Group Stage', quarterfinal: 'Quarterfinals', semifinal: 'Semifinals', final: 'Final' };

function _activityDetails(m, adminMode) {
  const p1Won = m.winner_id === m.player1_id;
  const winnerName  = abbrevName(p1Won ? m.p1_name : m.p2_name);
  const loserName   = abbrevName(p1Won ? m.p2_name : m.p1_name);
  const winnerPos   = p1Won ? m.p1_pos : m.p2_pos;
  const loserPos    = p1Won ? m.p2_pos : m.p1_pos;
  const winnerScore = p1Won ? m.player1_score : m.player2_score;
  const loserScore  = p1Won ? m.player2_score : m.player1_score;
  const winnerLabel = winnerPos ? `(#${winnerPos}) ` : '';
  const loserLabel  = loserPos  ? `(#${loserPos}) ` : '';
  const isTrMatch   = m.source === 'tournament';
  const submittedByText = isTrMatch
    ? `${m.tournament_name || ''} • ${_roundLabels[m.round] || m.round || ''}`
    : (adminMode ? `Submitted by ${m.submitted_by_name || 'Admin'}` : null);
  const placesMovedText = m.places_moved > 0
    ? `↑ ${winnerName} moves up ${m.places_moved} place${m.places_moved !== 1 ? 's' : ''}` : null;
  return { winnerName, loserName, winnerLabel, loserLabel, winnerScore, loserScore, submittedByText, placesMovedText };
}

function buildActivityHTML(activity, isAdmin = false) {
  if (!activity || activity.length === 0) {
    return `<div class="dp-activity-scroll"><div class="dp-right-empty">No activity in the past 7 days.</div></div>`;
  }
  const items = activity.map((m) => {
    const { winnerName, loserName, winnerLabel, loserLabel, winnerScore, loserScore, submittedByText, placesMovedText } = _activityDetails(m, isAdmin);
    const movesUp     = placesMovedText ? `<div class="dp-activity-moves">${esc(placesMovedText)}</div>` : '';
    const submittedBy = submittedByText ? `<div class="dp-activity-by">${esc(submittedByText)}</div>` : '';
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
export async function renderClubActivity(days = 7) {
  document.getElementById('pageTitle').textContent = 'Club Activity';
  document.getElementById('topbarActions').innerHTML = '';

  const content = document.getElementById('mainContent');
  content.innerHTML = `<div class="ca-loading">Loading…</div>`;

  const activity = await window.api.getActivity(days);

  const admin = isAdmin();
  const itemsHTML = (activity && activity.length > 0) ? activity.map((m) => {
    const { winnerName, loserName, winnerLabel, loserLabel, winnerScore, loserScore, submittedByText, placesMovedText } = _activityDetails(m, admin);
    const movesUp     = placesMovedText ? `<div class="ca-item-moves">${esc(placesMovedText)}</div>` : '';
    const submittedBy = submittedByText ? `<div class="ca-item-by">${esc(submittedByText)}</div>` : '';
    const deleteBtn   = (admin && m.source === 'pickup')
      ? `<button class="ca-delete-btn" data-id="${m.id}">Delete</button>` : '';
    return `
      <div class="ca-item">
        <div class="ca-item-main">
          <span class="ca-winner">${esc(winnerLabel)}${esc(winnerName)}</span>
          <span class="ca-verb"> beat </span>
          <span class="ca-loser">${esc(loserLabel)}${esc(loserName)}</span>
          <span class="ca-score"> ${winnerScore}–${loserScore}</span>
        </div>
        <div class="ca-item-meta">
          <span class="ca-time">${esc(timeAgo(m.confirmed_at))}</span>
          ${movesUp}${submittedBy}${deleteBtn}
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

  content.querySelectorAll('.ca-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this pickup game? This cannot be undone.')) return;
      try {
        await window.api.deletePickupMatch(Number(btn.dataset.id));
        toast('Pickup game deleted.', 'success');
        renderClubActivity(days);
      } catch (err) {
        toast(err.message || 'Failed to delete.', 'error');
      }
    });
  });
}

// ===== CLUB SETTINGS =====
export async function renderClubSettings() {
  document.getElementById('pageTitle').textContent = 'Club Settings';
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.getElementById('mainContent');
  content.innerHTML = `<div style="padding:20px;color:var(--text-muted)">Loading…</div>`;

  const [courts, bookingTypes] = await Promise.all([
    window.api.getCourts(),
    window.api.getBookingTypes(),
  ]);

  content.innerHTML = `
    <div class="settings-page">
      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title">Courts</h2>
          <button class="btn btn-primary btn-sm" id="btnAddCourt">+ Add Court</button>
        </div>
        <p class="settings-section-desc">Courts are used when scheduling matches in leagues.</p>
        ${courts.length === 0
          ? `<div class="settings-empty">No courts yet. Add your first court to get started.</div>`
          : `<div class="court-list">
              ${courts.map((c) => `
                <div class="court-item">
                  <span class="court-item-name">${esc(c.name)}</span>
                  <div class="court-item-actions">
                    <button class="btn btn-outline btn-sm" data-court-edit="${c.id}">Rename</button>
                    <button class="btn btn-danger btn-sm" data-court-delete="${c.id}">Delete</button>
                  </div>
                </div>
              `).join('')}
            </div>`
        }
      </div>

      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title">Booking Types</h2>
          <button class="btn btn-primary btn-sm" id="btnAddBookingType">+ Add Type</button>
        </div>
        <p class="settings-section-desc">Custom booking types appear in the court schedule. League matches are shown automatically.</p>
        ${bookingTypes.length === 0
          ? `<div class="settings-empty">No booking types yet.</div>`
          : `<div class="court-list">
              ${bookingTypes.map((bt) => `
                <div class="court-item">
                  <div class="court-item-name" style="display:flex;align-items:center;gap:10px">
                    <span class="btype-swatch" style="background:${esc(bt.color)}"></span>
                    ${esc(bt.name)}
                  </div>
                  <div class="court-item-actions">
                    <button class="btn btn-outline btn-sm" data-btype-edit="${bt.id}">Edit</button>
                    <button class="btn btn-danger btn-sm" data-btype-delete="${bt.id}">Delete</button>
                  </div>
                </div>
              `).join('')}
            </div>`
        }
      </div>
    </div>`;

  document.getElementById('btnAddCourt').addEventListener('click', openAddCourtModal);

  content.querySelectorAll('[data-court-edit]').forEach((btn) => {
    const id = Number(btn.dataset.courtEdit);
    const name = courts.find((c) => c.id === id)?.name || '';
    btn.addEventListener('click', () => openEditCourtModal(id, name));
  });

  content.querySelectorAll('[data-court-delete]').forEach((btn) => {
    const id = Number(btn.dataset.courtDelete);
    const name = courts.find((c) => c.id === id)?.name || '';
    btn.addEventListener('click', () => deleteCourtConfirm(id, name));
  });

  document.getElementById('btnAddBookingType').addEventListener('click', openAddBookingTypeModal);

  content.querySelectorAll('[data-btype-edit]').forEach((btn) => {
    const id = Number(btn.dataset.btypeEdit);
    const bt = bookingTypes.find((b) => b.id === id);
    btn.addEventListener('click', () => openEditBookingTypeModal(bt));
  });

  content.querySelectorAll('[data-btype-delete]').forEach((btn) => {
    const id = Number(btn.dataset.btypeDelete);
    const bt = bookingTypes.find((b) => b.id === id);
    btn.addEventListener('click', () => deleteBookingTypeConfirm(bt));
  });
}

function openAddCourtModal() {
  modal.open('Add Court', `
    <form id="courtForm">
      <div class="form-group">
        <label class="form-label">Court Name</label>
        <input class="form-control" type="text" id="fCourtName" placeholder="e.g. Court 1" maxlength="50" autofocus>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Court</button>
      </div>
    </form>
  `);
  document.getElementById('courtForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('fCourtName').value.trim();
    if (!name) return;
    try {
      await window.api.addCourt({ name });
      modal.close();
      toast('Court added');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openEditCourtModal(id, name) {
  modal.open('Rename Court', `
    <form id="courtForm">
      <div class="form-group">
        <label class="form-label">Court Name</label>
        <input class="form-control" type="text" id="fCourtName" value="${esc(name)}" maxlength="50">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);
  document.getElementById('courtForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = document.getElementById('fCourtName').value.trim();
    if (!newName) return;
    try {
      await window.api.updateCourt(id, { name: newName });
      modal.close();
      toast('Court renamed');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function deleteCourtConfirm(id, name) {
  modal.open('Delete Court', `
    <p style="margin:0 0 16px">Are you sure you want to delete <strong>${esc(name)}</strong>?</p>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
      <button type="button" class="btn btn-danger" id="btnConfirmDeleteCourt">Delete</button>
    </div>
  `);
  document.getElementById('btnConfirmDeleteCourt').addEventListener('click', async () => {
    try {
      await window.api.deleteCourt(id);
      modal.close();
      toast('Court deleted');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openAddBookingTypeModal() {
  modal.open('Add Booking Type', `
    <form id="btypeForm">
      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="form-control" type="text" id="fBtypeName" placeholder="e.g. Junior Training" maxlength="60" autofocus>
      </div>
      <div class="form-group">
        <label class="form-label">Colour</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="color" id="fBtypeColor" value="#3b82f6" style="width:44px;height:36px;padding:2px;border:1px solid var(--border);border-radius:6px;cursor:pointer">
          <span id="fBtypeColorHex" style="font-size:13px;color:var(--text-muted)">#3b82f6</span>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add</button>
      </div>
    </form>
  `);
  document.getElementById('fBtypeColor').addEventListener('input', (e) => {
    document.getElementById('fBtypeColorHex').textContent = e.target.value;
  });
  document.getElementById('btypeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('fBtypeName').value.trim();
    const color = document.getElementById('fBtypeColor').value;
    if (!name) return;
    try {
      await window.api.addBookingType({ name, color });
      modal.close();
      toast('Booking type added');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openEditBookingTypeModal(bt) {
  modal.open('Edit Booking Type', `
    <form id="btypeForm">
      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="form-control" type="text" id="fBtypeName" value="${esc(bt.name)}" maxlength="60">
      </div>
      <div class="form-group">
        <label class="form-label">Colour</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="color" id="fBtypeColor" value="${esc(bt.color)}" style="width:44px;height:36px;padding:2px;border:1px solid var(--border);border-radius:6px;cursor:pointer">
          <span id="fBtypeColorHex" style="font-size:13px;color:var(--text-muted)">${esc(bt.color)}</span>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);
  document.getElementById('fBtypeColor').addEventListener('input', (e) => {
    document.getElementById('fBtypeColorHex').textContent = e.target.value;
  });
  document.getElementById('btypeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('fBtypeName').value.trim();
    const color = document.getElementById('fBtypeColor').value;
    if (!name) return;
    try {
      await window.api.updateBookingType(bt.id, { name, color });
      modal.close();
      toast('Booking type updated');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function deleteBookingTypeConfirm(bt) {
  modal.open('Delete Booking Type', `
    <p style="margin:0 0 16px">Delete <strong>${esc(bt.name)}</strong>? Existing bookings with this type will keep their appearance but lose the type label.</p>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
      <button type="button" class="btn btn-danger" id="btnConfirmDeleteBtype">Delete</button>
    </div>
  `);
  document.getElementById('btnConfirmDeleteBtype').addEventListener('click', async () => {
    try {
      await window.api.deleteBookingType(bt.id);
      modal.close();
      toast('Booking type deleted');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ===== ADMIN DASHBOARD HELPERS =====
function _parseTimeMins(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function _fmtMins(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function _courtStatus(court, slots, nowMins) {
  const DAY_START = 6 * 60;
  const DAY_END = 23 * 60;

  if (!court.active || nowMins < DAY_START || nowMins >= DAY_END) {
    return { text: 'Unavailable', type: 'unavailable', endMins: null };
  }

  const courtSlots = slots.filter((s) =>
    s.courtId === court.id || (s.courtIds && s.courtIds.includes(court.id))
  ).map((s) => ({ ...s, _startMins: _parseTimeMins(s.startTime) }))
    .filter((s) => s._startMins !== null);

  const active = courtSlots.find((s) => nowMins >= s._startMins && nowMins < s._startMins + s.durationMinutes);

  if (active) {
    const endMins = active._startMins + active.durationMinutes;
    const endFmt = _fmtMins(endMins);
    if (active.players && active.players.length > 0) {
      const firstName = active.players[0].name.split(' ')[0];
      return { text: `Booked until ${endFmt} by ${firstName}`, type: 'booked', endMins };
    }
    if (active.source === 'league') return { text: `League Match until ${endFmt}`, type: 'booked', endMins };
    if (active.source === 'tournament') return { text: `Tournament until ${endFmt}`, type: 'booked', endMins };
    if (active.title && active.title !== 'Booked') return { text: `${active.title} until ${endFmt}`, type: 'booked', endMins };
    return { text: `Booked until ${endFmt}`, type: 'booked', endMins };
  }

  const next = courtSlots
    .filter((s) => s._startMins > nowMins)
    .sort((a, b) => a._startMins - b._startMins)[0];

  if (next) {
    const minsUntil = next._startMins - nowMins;
    return { text: `Available until ${_fmtMins(next._startMins)}`, type: minsUntil <= 120 ? 'available-soon' : 'available', endMins: next._startMins };
  }

  return { text: 'Available', type: 'available', endMins: null };
}

// ===== DASHBOARD =====
export async function renderDashboard() {
  document.getElementById('pageTitle').textContent = 'Dashboard';
  document.getElementById('topbarActions').innerHTML = '';
  document.querySelector('.content').classList.add('content--dashboard');
  const content = document.getElementById('mainContent');
  content.innerHTML = `<div class="dashboard-loading">Loading…</div>`;

  const user = state.currentUser;

  if (!user || user.role === 'admin') {
    const todayStr = new Date().toISOString().slice(0, 10);
    const [scheduleData, activity] = await Promise.all([
      window.api.getSchedule(todayStr),
      window.api.getActivity(1),
    ]);

    const { courts, slots } = scheduleData;
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    const totalPlayers = (state.players || []).length;
    const bookingsToday = slots.filter((s) => s.source === 'custom').length;
    const matchesToday = activity.length;

    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const DAY_END_MINS = 23 * 60;
    const courtCardsHTML = courts.map((court) => {
      const status = _courtStatus(court, slots, nowMins);

      let nextLine = '';
      const showNext = status.type !== 'unavailable'
        && status.endMins !== null
        && status.endMins < DAY_END_MINS;
      if (showNext) {
        const next = _courtStatus(court, slots, status.endMins);
        if (next.type !== 'unavailable') {
          nextLine = `<div class="adm-court-next">Next: ${esc(next.text)}</div>`;
        }
      }

      return `<div class="adm-court-card adm-court-${status.type}" onclick="navigate('schedule')" role="button" tabindex="0">
        <div class="adm-court-name">${esc(court.name)}</div>
        <div class="adm-court-indicator"></div>
        <div class="adm-court-status">${esc(status.text)}</div>
        ${nextLine}
      </div>`;
    }).join('');

    content.innerHTML = `
      <div class="dp-wrap">
        <div class="dp-columns">
          <div class="dp-main">
            <div class="adm-hero">
              <div class="adm-hero-bg" style="background-image:url('/assets/WSRC-EXTERIOR-ANGLE.jpg')"></div>
              <div class="adm-hero-overlay">
                <div class="adm-hero-top">
                  <div class="adm-hero-greeting">Welcome Back.</div>
                  <div class="adm-hero-date">${esc(dateStr)}</div>
                </div>
                <div class="adm-hero-divider"></div>
                <div class="league-stats">
                  <div class="stat"><span class="stat-val">${totalPlayers}</span><span class="stat-label">Total Players</span></div>
                  <div class="stat"><span class="stat-val">${bookingsToday}</span><span class="stat-label">Court Bookings Today</span></div>
                  <div class="stat"><span class="stat-val">${matchesToday}</span><span class="stat-label">Matches Recorded Today</span></div>
                </div>
              </div>
            </div>

            ${courts.length > 0 ? `
              <div class="section-title">Court Status <div class="divider"></div></div>
              <div class="adm-courts-grid">${courtCardsHTML}</div>
            ` : ''}
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
    const parts = d.slice(0, 10).split('-').map(Number);
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
      (nextMatch.court_name || (nextMatch.schedule_courts && nextMatch.court_number)) ? `<span class="dh-pill">${nextMatch.court_name || `Court ${nextMatch.court_number}`}</span>` : '',
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
          <svg class="db-quick-icon" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" fill="#5b7cf9"><g transform="translate(-180,-2159)"><g transform="translate(56,160)"><path d="M134,2008.99998 C131.783496,2008.99998 129.980955,2007.20598 129.980955,2004.99998 C129.980955,2002.79398 131.783496,2000.99998 134,2000.99998 C136.216504,2000.99998 138.019045,2002.79398 138.019045,2004.99998 C138.019045,2007.20598 136.216504,2008.99998 134,2008.99998 M137.775893,2009.67298 C139.370449,2008.39598 140.299854,2006.33098 139.958235,2004.06998 C139.561354,2001.44698 137.368965,1999.34798 134.722423,1999.04198 C131.070116,1998.61898 127.971432,2001.44898 127.971432,2004.99998 C127.971432,2006.88998 128.851603,2008.57398 130.224107,2009.67298 C126.852128,2010.93398 124.390463,2013.89498 124.004634,2017.89098 C123.948368,2018.48198 124.411563,2018.99998 125.008391,2018.99998 C125.519814,2018.99998 125.955881,2018.61598 126.001095,2018.10898 C126.404004,2013.64598 129.837274,2010.99998 134,2010.99998 C138.162726,2010.99998 141.595996,2013.64598 141.998905,2018.10898 C142.044119,2018.61598 142.480186,2018.99998 142.991609,2018.99998 C143.588437,2018.99998 144.051632,2018.48198 143.995366,2017.89098 C143.609537,2013.89498 141.147872,2010.93398 137.775893,2009.67298"/></g></g></svg>
          My Profile
        </button>
        <button class="db-quick-item" onclick="openReportScoreModal()">
          <svg class="db-quick-icon" viewBox="0 0 98.374 98.374" xmlns="http://www.w3.org/2000/svg" fill="#2ec610"><path d="M97.789,23.118l-7.24-7.24c-0.781-0.781-2.047-0.781-2.828,0L50.464,53.133l-13.291-13.29c-0.781-0.781-2.047-0.781-2.828,0l-7.24,7.24c-0.375,0.375-0.586,0.884-0.586,1.414c0,0.53,0.211,1.039,0.586,1.414L49.05,71.854c0.391,0.391,0.902,0.586,1.414,0.586c0.513,0,1.022-0.195,1.414-0.586l45.91-45.908c0.375-0.375,0.586-0.884,0.586-1.414C98.374,24.002,98.164,23.493,97.789,23.118z"/><path d="M73.583,80.979H10V17.395h65.098l8.485-8c0-1.104-0.896-2-2-2H2c-1.104,0-2,0.896-2,2v79.584c0,1.104,0.896,2,2,2h79.584c1.105,0,2-0.896,2-2v-37.88l-10,10.5L73.583,80.979L73.583,80.979z"/></svg>
          Report Score
        </button>
        <button class="db-quick-item" onclick="openPickupGameModal()">
          <svg class="db-quick-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="#ff7300"><path d="M23.5 13.187h-7.5v-12.187l-7.5 17.813h7.5v12.187l7.5-17.813z"/></svg>
          Log Pickup Game
        </button>
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
