import { state, isAdmin } from '../state.js';
import { esc, formatDate, formatShortDate, toast, modal } from '../utils.js';

// ===== PLAYERS PAGE =====
export async function renderPlayers() {
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
      ${isAdmin() ? `<td class="text-muted player-col-email">${esc(p.email) || '—'}</td>` : ''}
      ${isAdmin() ? `<td class="text-muted player-col-phone">${esc(p.phone) || '—'}</td>` : ''}
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
            <th>Name</th>${isAdmin() ? '<th class="player-col-email">Email</th><th class="player-col-phone">Phone</th><th style="text-align:right">Actions</th>' : ''}
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
    window.navigate('players');
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
      window.navigate('players');
    } catch (e) {
      document.getElementById('fError').textContent = e.message || 'Failed to add players.';
      btn.disabled = false;
      btn.textContent = 'Add Players';
    }
  });
}

// ===== PLAYER PROFILE =====
export async function openPlayerProfile(id) {
  const backPage = state.page;   // capture before async — navigate may change state.page
  const player = await window.api.getPlayerHistory(id);
  window.navigate('playerProfile', { player });
  state.prevPage = backPage;     // override what navigate set, ensuring back goes to the right place
}

export function renderPlayerProfile() {
  const p = state.currentPlayer;
  if (!p) { window.navigate('players'); return; }

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
            <th>Details</th>
            <th>Opponent</th>
            <th style="text-align:center">Score</th>
            <th style="text-align:center">Result</th>
          </tr>
        </thead>
        <tbody>
          ${p.history.map((m) => {
            const isTr = m.source === 'tournament';
            const isPu = m.source === 'pickup';
            const details = isTr
              ? `${esc(m.league_name)} • ${esc(m.round_label || '')}`
              : isPu
              ? `<span class="pickup-history-badge">Pickup</span>`
              : [esc(m.league_name), `Wk ${m.week_number}`, m.division_name ? esc(m.division_name.replace(/^Division\s*/i, 'Div ')) : null].filter(Boolean).join(' • ');
            return `
            <tr>
              <td class="text-muted">${formatShortDate(m.week_date)}</td>
              <td class="text-muted">${details}</td>
              <td>${esc(m.opponent_name)}</td>
              <td style="text-align:center;font-weight:600">${m.my_score} – ${m.their_score}</td>
              <td style="text-align:center">
                <span class="result-badge ${m.result === 'W' ? 'result-win' : 'result-loss'}">${m.result}</span>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

  const upcomingHTML = (p.upcoming || []).length === 0
    ? `<div class="empty-state"><strong>No upcoming matches</strong></div>`
    : `<table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Details</th>
            <th>Opponent</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          ${p.upcoming.map((m) => {
            const isTr = m.source === 'tournament';
            const details = isTr
              ? `${esc(m.league_name)} • ${esc(m.round_label || '')}`
              : [esc(m.league_name), `Wk ${m.week_number}`, m.division_name ? esc(m.division_name.replace(/^Division\s*/i, 'Div ')) : null].filter(Boolean).join(' • ');
            const courtLabel = m.court_name || (m.schedule_courts && m.court_number ? `Court ${m.court_number}` : null);
            const timeInfo = courtLabel
              ? `${courtLabel}${m.match_time ? ' · ' + m.match_time : ''}`
              : (m.match_time || '—');
            return `
            <tr>
              <td class="text-muted">${formatShortDate(m.week_date)}</td>
              <td class="text-muted">${details}</td>
              <td>${esc(m.opponent_name)}</td>
              <td class="text-muted">${esc(timeInfo)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

  const tournamentResults = p.tournamentResults || [];
  const tournamentResultsHTML = tournamentResults.length === 0
    ? `<div class="empty-state"><strong>No tournaments played yet</strong></div>`
    : `<table>
        <thead>
          <tr>
            <th>Tournament</th>
            <th>Date</th>
            <th style="text-align:center">Finish</th>
          </tr>
        </thead>
        <tbody>
          ${tournamentResults.map(t => `
            <tr>
              <td>${esc(t.name)}</td>
              <td class="text-muted">${formatShortDate(t.championship_date)}</td>
              <td style="text-align:center">
                ${t.status === 'completed' && t.position
                  ? `<span class="tr-results-pos" style="display:inline">${esc(t.position)}</span>`
                  : `<span class="text-muted">In Progress</span>`}
              </td>
            </tr>`).join('')}
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
          ${adminMode && p.email ? `<div class="text-muted" style="font-size:13px">${esc(p.email)}</div>` : ''}
          ${adminMode && p.phone ? `<div class="text-muted" style="font-size:13px">${esc(p.phone)}</div>` : ''}
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

    <div class="section">
      <div class="section-title">Upcoming Matches <div class="divider"></div></div>
      <div class="table-card">${upcomingHTML}</div>
    </div>

    <div class="section">
      <div class="section-title">Match History <div class="divider"></div></div>
      <div class="table-card">${historyHTML}</div>
    </div>

    <div class="section">
      <div class="section-title">Tournament Results <div class="divider"></div></div>
      <div class="table-card">${tournamentResultsHTML}</div>
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

// ===== PICKUP GAME MODAL =====
export async function openPickupGameModal() {
  const adminMode = isAdmin();
  const myId = state.currentUser?.playerId;

  modal.open('Log Pickup Game', '<div class="modal-loading">Loading players…</div>', { medium: true });

  const allPlayers = state.players.length ? state.players : await window.api.getPlayers();
  const myName = adminMode ? '' : (allPlayers.find((p) => p.id === myId)?.name || 'Me');

  const presets = [
    { p1: 3, p2: 0 }, { p1: 3, p2: 1 }, { p1: 3, p2: 2 },
    { p1: 0, p2: 3 }, { p1: 1, p2: 3 }, { p1: 2, p2: 3 },
  ];
  let selected = null;

  function searchSelectorHTML(id, placeholder) {
    return `<div class="pu-search-wrap">
      <div class="pu-search-input-row">
        <input type="text" class="form-control pu-search-input" id="${id}Search" placeholder="${placeholder}" autocomplete="off">
        <button type="button" class="pu-search-clear" id="${id}Clear">×</button>
      </div>
      <div class="pu-search-list" id="${id}List"></div>
      <input type="hidden" id="${id}">
    </div>`;
  }

  function wireSearch(id, getExcludeId, onChange) {
    const searchEl = document.getElementById(id + 'Search');
    const listEl   = document.getElementById(id + 'List');
    const hiddenEl = document.getElementById(id);
    const clearEl  = document.getElementById(id + 'Clear');

    function showList() {
      const q = searchEl.value.trim().toLowerCase();
      const excludeId = typeof getExcludeId === 'function' ? getExcludeId() : getExcludeId;
      const filtered = allPlayers
        .filter((p) => p.id !== excludeId && (!q || p.name.toLowerCase().includes(q)))
        .slice(0, 10);
      listEl.innerHTML = filtered.map((p) =>
        `<div class="pu-search-option" data-id="${p.id}">${esc(p.name)}</div>`
      ).join('') || `<div class="pu-search-empty">No players found</div>`;
      listEl.style.display = 'block';
      listEl.querySelectorAll('.pu-search-option').forEach((opt) => {
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          hiddenEl.value = opt.dataset.id;
          searchEl.value = opt.textContent;
          clearEl.style.display = '';
          listEl.style.display = 'none';
          onChange();
        });
      });
    }

    clearEl.style.display = 'none';
    searchEl.addEventListener('focus', showList);
    searchEl.addEventListener('input', showList);
    searchEl.addEventListener('blur', () => setTimeout(() => { listEl.style.display = 'none'; }, 150));
    clearEl.addEventListener('click', () => {
      hiddenEl.value = '';
      searchEl.value = '';
      clearEl.style.display = 'none';
      listEl.style.display = 'none';
      onChange();
    });
  }

  function resolveNames() {
    const p1Name = adminMode
      ? (() => { const v = document.getElementById('puP1')?.value; return v ? allPlayers.find((p) => p.id === Number(v))?.name || 'Player 1' : 'Player 1'; })()
      : myName;
    const p2val = document.getElementById('puP2')?.value;
    const p2Name = p2val
      ? allPlayers.find((p) => p.id === Number(p2val))?.name || (adminMode ? 'Player 2' : 'Opponent')
      : (adminMode ? 'Player 2' : 'Opponent');
    return { p1Name, p2Name };
  }

  function canSelectPreset() {
    const hasP2 = !!document.getElementById('puP2')?.value;
    if (!adminMode) return hasP2;
    return !!(document.getElementById('puP1')?.value && hasP2);
  }

  function renderPresets() {
    const { p1Name, p2Name } = resolveNames();
    const can = canSelectPreset();

    document.getElementById('puP1Label').textContent = p1Name;
    const p2Label = document.getElementById('puP2Label');
    p2Label.textContent = p2Name;
    p2Label.classList.toggle('pu-player-name--muted', !can);

    const grid = document.getElementById('puPresetGrid');
    grid.innerHTML = presets.map((pr) => {
      const p1wins = pr.p1 > pr.p2;
      const winnerScore = Math.max(pr.p1, pr.p2);
      const loserScore  = Math.min(pr.p1, pr.p2);
      const isSel = selected && selected.p1 === pr.p1 && selected.p2 === pr.p2;
      const winnerFirst = (p1wins ? p1Name : p2Name).split(' ')[0];
      return `<button class="tr-preset-btn${isSel ? ' tr-preset-btn--selected' : ''}" data-p1="${pr.p1}" data-p2="${pr.p2}"${!can ? ' disabled' : ''}>
        <span class="tr-preset-score">${winnerScore}–${loserScore}</span>
        <span class="tr-preset-winner">${can ? `${esc(winnerFirst)} wins` : '—'}</span>
      </button>`;
    }).join('');

    grid.querySelectorAll('.tr-preset-btn:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected = { p1: Number(btn.dataset.p1), p2: Number(btn.dataset.p2) };
        grid.querySelectorAll('.tr-preset-btn').forEach((b) =>
          b.classList.toggle('tr-preset-btn--selected',
            Number(b.dataset.p1) === selected.p1 && Number(b.dataset.p2) === selected.p2));
        document.getElementById('puSubmit').disabled = false;
      });
    });
  }

  function onPlayerChange() {
    selected = null;
    document.getElementById('puSubmit').disabled = true;
    renderPresets();
  }

  const selectorsHTML = adminMode
    ? `<div class="pu-selectors-row">
        <div class="pu-selector-col">
          <label class="form-label">Player 1</label>
          ${searchSelectorHTML('puP1', 'Search player…')}
        </div>
        <div class="pu-vs-divider">vs</div>
        <div class="pu-selector-col">
          <label class="form-label">Player 2</label>
          ${searchSelectorHTML('puP2', 'Search player…')}
        </div>
      </div>`
    : `<div class="form-group" style="margin:0">
        <label class="form-label">Opponent</label>
        ${searchSelectorHTML('puP2', 'Search opponent…')}
      </div>`;

  document.getElementById('modalBody').innerHTML = `
    <div class="pu-modal">
      ${selectorsHTML}
      <div class="pu-matchup-display">
        <span class="pu-player-name" id="puP1Label">${esc(adminMode ? 'Player 1' : myName)}</span>
        <span class="pu-vs-badge">vs</span>
        <span class="pu-player-name pu-player-name--muted" id="puP2Label">${esc(adminMode ? 'Player 2' : 'Opponent')}</span>
      </div>
      <div class="tr-preset-grid" id="puPresetGrid"></div>
      <div class="tr-score-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="button" class="btn btn-primary" id="puSubmit" disabled>Log Game</button>
      </div>
    </div>`;

  renderPresets();

  if (adminMode) {
    wireSearch('puP1', () => Number(document.getElementById('puP2').value) || null, onPlayerChange);
    wireSearch('puP2', () => Number(document.getElementById('puP1').value) || null, onPlayerChange);
  } else {
    wireSearch('puP2', myId, onPlayerChange);
  }

  document.getElementById('puSubmit').addEventListener('click', async () => {
    const p1Id = adminMode ? Number(document.getElementById('puP1').value) : myId;
    const p2Id = Number(document.getElementById('puP2').value);
    if (!p1Id || !p2Id) { toast('Please select both players.', 'warning'); return; }
    if (p1Id === p2Id)  { toast('Players must be different.', 'warning'); return; }
    if (!selected)      { toast('Please select a score.', 'warning'); return; }
    const btn = document.getElementById('puSubmit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      await window.api.logPickupGame({ player1Id: p1Id, player2Id: p2Id, player1Score: selected.p1, player2Score: selected.p2 });
      toast('Pickup game logged!', 'success');
      modal.close();
      if (state.page === 'ladder') window.renderLadder();
      else if (state.page === 'dashboard') window.renderDashboard();
    } catch (err) {
      toast(err.message || 'Failed to log game', 'error');
      btn.disabled = false;
      btn.textContent = 'Log Game';
    }
  });
}

// ===== REPORT SCORE MODAL (player) =====
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
        toast('Invalid score — one player must win 3 games (e.g. 3–1, 3–2)', 'warning');
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

// Set window exports so onclick HTML attributes work as soon as this module loads
window.openPlayerProfile = openPlayerProfile;
window.openPickupGameModal = openPickupGameModal;
window.openReportScoreModal = openReportScoreModal;
