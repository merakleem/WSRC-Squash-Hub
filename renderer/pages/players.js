import { state, isAdmin, isTester } from '../state.js';
import { esc, formatDate, formatShortDate, toast, modal, avatarHTML, playerInitials } from '../utils.js';

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

function playerRowsHTML(players, filtered, selectedIds = new Set()) {
  const cols = isAdmin() ? 5 : 1;
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
      ${isAdmin() ? `<td style="width:36px;text-align:center"><input type="checkbox" class="player-checkbox" data-id="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''}></td>` : ''}
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

function updateBulkBar(selectedPlayerIds) {
  const bar = document.getElementById('bulkActionsBar');
  if (!bar) return;
  bar.style.display = selectedPlayerIds.size > 0 ? 'flex' : 'none';
  const countEl = document.getElementById('bulkSelCount');
  if (countEl) countEl.textContent = `${selectedPlayerIds.size} selected`;
}

function updateSelectAllState() {
  const selectAll = document.getElementById('selectAllPlayers');
  if (!selectAll) return;
  const allCbs = document.querySelectorAll('.player-checkbox');
  const checkedCount = document.querySelectorAll('.player-checkbox:checked').length;
  selectAll.checked = allCbs.length > 0 && checkedCount === allCbs.length;
  selectAll.indeterminate = checkedCount > 0 && checkedCount < allCbs.length;
}

function attachCheckboxListeners(scope, selectedPlayerIds) {
  scope.querySelectorAll('.player-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedPlayerIds.add(Number(cb.dataset.id));
      else selectedPlayerIds.delete(Number(cb.dataset.id));
      updateBulkBar(selectedPlayerIds);
      updateSelectAllState();
    });
  });
}

function renderPlayerTable(players) {
  const content = document.getElementById('mainContent');
  const selectedPlayerIds = new Set();

  content.innerHTML = `
    <div class="table-card">
      <div class="table-toolbar">
        <span class="text-muted" id="playerCount">${players.length} player${players.length !== 1 ? 's' : ''}</span>
        ${isAdmin() ? `
        <div id="bulkActionsBar" style="display:none;align-items:center;gap:8px">
          <span class="text-muted" id="bulkSelCount" style="font-size:13px"></span>
          <div class="options-menu" id="bulkMenu">
            <button class="btn btn-outline btn-sm" id="bulkMenuBtn">Bulk Actions <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" style="vertical-align:middle;margin-left:2px"><path d="M0 0l5 6 5-6z"/></svg></button>
            <div class="options-dropdown" id="bulkMenuDropdown">
              <button class="options-item" data-bulk-action="edit">Edit</button>
            </div>
          </div>
        </div>` : ''}
        <input class="search-input" id="playerSearch" placeholder="Search players..." autocomplete="off">
      </div>
      <table class="players-table">
        <thead>
          <tr>
            ${isAdmin() ? '<th style="width:36px"><input type="checkbox" id="selectAllPlayers" title="Select all"></th>' : ''}
            <th>Name</th>${isAdmin() ? '<th class="player-col-email">Email</th><th class="player-col-phone">Phone</th><th style="text-align:right">Actions</th>' : ''}
          </tr>
        </thead>
        <tbody id="playerTbody">${playerRowsHTML(players, players, selectedPlayerIds)}</tbody>
      </table>
    </div>`;

  attachPlayerTableListeners(content);

  if (isAdmin()) {
    attachCheckboxListeners(content, selectedPlayerIds);

    document.getElementById('selectAllPlayers').addEventListener('change', (e) => {
      document.querySelectorAll('.player-checkbox').forEach((cb) => {
        cb.checked = e.target.checked;
        if (e.target.checked) selectedPlayerIds.add(Number(cb.dataset.id));
        else selectedPlayerIds.delete(Number(cb.dataset.id));
      });
      updateBulkBar(selectedPlayerIds);
    });

    document.getElementById('bulkMenuBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('bulkMenuDropdown').classList.toggle('open');
    });
    document.getElementById('bulkMenuDropdown').addEventListener('click', (e) => {
      const action = e.target.dataset.bulkAction;
      if (!action) return;
      document.getElementById('bulkMenuDropdown').classList.remove('open');
      if (action === 'edit') openBulkEditModal(new Set(selectedPlayerIds));
    });
    document.addEventListener('click', () => document.getElementById('bulkMenuDropdown')?.classList.remove('open'));
  }

  document.getElementById('playerSearch').addEventListener('input', (e) => {
    const input = e.target;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const val = input.value.toLowerCase();
    const f = val ? players.filter((p) => p.name.toLowerCase().includes(val)) : players;
    const tbody = document.getElementById('playerTbody');
    tbody.innerHTML = playerRowsHTML(players, f, selectedPlayerIds);
    attachPlayerTableListeners(tbody);
    if (isAdmin()) attachCheckboxListeners(tbody, selectedPlayerIds);
    updateSelectAllState();
    input.setSelectionRange(start, end);
  });
}

function playerFormHTML(player = {}) {
  const excluded = player.id ? !!player.exclude_from_ladder : false;
  const testerCheck = (player.id && isAdmin()) ? `
    <div class="form-group form-group-check">
      <label class="check-label">
        <input type="checkbox" id="fTester" ${player.is_tester ? 'checked' : ''}>
        Is Tester
      </label>
    </div>` : '';
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
    </div>${testerCheck}
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
    const is_tester = document.getElementById('fTester')?.checked ?? false;
    if (!name) { document.getElementById('fError').textContent = 'Name is required.'; return; }
    try {
      await window.api.updatePlayer({ id: player.id, name, email, phone, club_locker_rating, exclude_from_ladder, is_tester });
      modal.close();
      toast('Player updated', 'success');
      state.players = await window.api.getPlayers();
      // If we edited from a player profile, reload the profile with fresh data
      if (state.page === 'playerProfile') {
        await openPlayerProfile(player.id, { pushHistory: false });
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
      <input class="form-control bulk-name" placeholder="Name *" data-row="${i}">
      <input class="form-control bulk-email" type="email" placeholder="Email" data-row="${i}">
      <input class="form-control bulk-phone" placeholder="Phone" data-row="${i}">
      <input class="form-control bulk-rating" type="number" step="0.01" min="0" placeholder="Rating" data-row="${i}">
      <label class="bulk-excl-label"><input type="checkbox" class="bulk-exclude" data-row="${i}"> Excl.</label>
      <button class="btn btn-ghost btn-sm bulk-remove" data-row="${i}" title="Remove row">&times;</button>
    </div>`).join('');

  let rowCount = 5;

  const getValues = () => ({
    names:   [...document.querySelectorAll('.bulk-name')].map(el => el.value),
    emails:  [...document.querySelectorAll('.bulk-email')].map(el => el.value),
    phones:  [...document.querySelectorAll('.bulk-phone')].map(el => el.value),
    ratings: [...document.querySelectorAll('.bulk-rating')].map(el => el.value),
    excls:   [...document.querySelectorAll('.bulk-exclude')].map(el => el.checked),
  });

  const restoreValues = ({ names, emails, phones, ratings, excls }) => {
    document.querySelectorAll('.bulk-name').forEach((el, i)   => { el.value = names[i]   || ''; });
    document.querySelectorAll('.bulk-email').forEach((el, i)  => { el.value = emails[i]  || ''; });
    document.querySelectorAll('.bulk-phone').forEach((el, i)  => { el.value = phones[i]  || ''; });
    document.querySelectorAll('.bulk-rating').forEach((el, i) => { el.value = ratings[i] || ''; });
    document.querySelectorAll('.bulk-exclude').forEach((el, i) => { el.checked = excls[i] || false; });
  };

  const rebuild = () => {
    document.getElementById('bulkRows').innerHTML = renderRows(rowCount);
    document.querySelectorAll('.bulk-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.row);
        const vals = getValues();
        vals.names.splice(idx, 1); vals.emails.splice(idx, 1); vals.phones.splice(idx, 1);
        vals.ratings.splice(idx, 1); vals.excls.splice(idx, 1);
        rowCount = Math.max(1, rowCount - 1);
        rebuild();
        restoreValues(vals);
      });
    });
  };

  modal.open('Add Multiple Players', `
    <p class="text-muted" style="font-size:13px;margin-bottom:16px">Fill in each player's details. Rows without a name will be skipped.</p>
    <div class="bulk-header">
      <span></span><span>Name *</span><span>Email</span><span>Phone</span><span>Rating</span><span>Excl.</span><span></span>
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
    const vals = getValues();
    rowCount++;
    rebuild();
    restoreValues(vals);
  });

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const rows = [];
    document.querySelectorAll('.bulk-row').forEach((row) => {
      const name = row.querySelector('.bulk-name').value.trim();
      if (!name) return;
      const ratingRaw = row.querySelector('.bulk-rating').value.trim();
      rows.push({
        name,
        email: row.querySelector('.bulk-email').value.trim(),
        phone: row.querySelector('.bulk-phone').value.trim(),
        club_locker_rating: ratingRaw !== '' ? parseFloat(ratingRaw) : null,
        exclude_from_ladder: row.querySelector('.bulk-exclude').checked,
      });
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

function openBulkEditModal(playerIds) {
  const players = state.players.filter((p) => playerIds.has(p.id));
  if (players.length === 0) return;

  const renderRows = () => players.map((p, i) => `
    <div class="bulk-row bulk-edit-row" data-row="${i}" data-id="${p.id}">
      <span class="bulk-row-num">${i + 1}</span>
      <input class="form-control bulk-name" placeholder="Name *" value="${esc(p.name)}" data-row="${i}">
      <input class="form-control bulk-email" type="email" placeholder="Email" value="${esc(p.email || '')}" data-row="${i}">
      <input class="form-control bulk-phone" placeholder="Phone" value="${esc(p.phone || '')}" data-row="${i}">
      <input class="form-control bulk-rating" type="number" step="0.01" min="0" placeholder="Rating" value="${esc(p.club_locker_rating != null ? p.club_locker_rating : '')}" data-row="${i}">
      <label class="bulk-excl-label">
        <input type="checkbox" class="bulk-exclude" data-row="${i}" ${p.exclude_from_ladder ? 'checked' : ''}> Excl. ladder
      </label>
    </div>`).join('');

  modal.open(`Edit ${players.length} Player${players.length !== 1 ? 's' : ''}`, `
    <p class="text-muted" style="font-size:13px;margin-bottom:16px">Edit details for the selected players. All changes will be saved when you click Save.</p>
    <div class="bulk-header bulk-edit-header">
      <span></span><span>Name *</span><span>Email</span><span>Phone</span><span>Rating</span><span>Excl.</span>
    </div>
    <div id="bulkRows">${renderRows()}</div>
    <div id="fError" class="form-error" style="margin-top:12px"></div>
    <div class="form-actions" style="margin-top:16px">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSubmit">Save Changes</button>
    </div>`, { wide: true });

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const updates = [];
    let valid = true;
    document.querySelectorAll('#bulkRows .bulk-row').forEach((row) => {
      const name = row.querySelector('.bulk-name').value.trim();
      if (!name) { valid = false; return; }
      const ratingRaw = row.querySelector('.bulk-rating').value.trim();
      updates.push({
        id: Number(row.dataset.id),
        name,
        email: row.querySelector('.bulk-email').value.trim(),
        phone: row.querySelector('.bulk-phone').value.trim(),
        club_locker_rating: ratingRaw !== '' ? parseFloat(ratingRaw) : null,
        exclude_from_ladder: row.querySelector('.bulk-exclude').checked,
      });
    });
    if (!valid) { document.getElementById('fError').textContent = 'All players must have a name.'; return; }
    const btn = document.getElementById('fSubmit');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const errors = [];
    for (const u of updates) {
      try { await window.api.updatePlayer(u); }
      catch (e) { errors.push(e.message || `Failed to update ${u.name}`); }
    }
    modal.close();
    if (errors.length) toast(`Some updates failed: ${errors[0]}`, 'error');
    else toast(`${updates.length} player${updates.length !== 1 ? 's' : ''} updated`, 'success');
    state.players = await window.api.getPlayers();
    renderPlayerTable(state.players);
  });
}

function openMessagePlayerModal(playerId, playerName) {
  modal.open(`Message ${playerName}`, `
    <p class="text-muted" style="font-size:13px;margin-bottom:12px">
      Your message will be sent to ${esc(playerName)} by email. They can reply directly to your email address.
    </p>
    <div class="form-group">
      <textarea class="form-control" id="msgBody" rows="5" placeholder="Write your message…" style="resize:vertical"></textarea>
    </div>
    <div id="fError" class="form-error"></div>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSubmit">Send Message</button>
    </div>`);

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('msgBody').focus();
  document.getElementById('fSubmit').addEventListener('click', async () => {
    const message = document.getElementById('msgBody').value.trim();
    if (!message) { document.getElementById('fError').textContent = 'Message is required.'; return; }
    const btn = document.getElementById('fSubmit');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await window.api.messagePlayer(playerId, { message });
      modal.close();
      toast('Message sent!', 'success');
    } catch (e) {
      document.getElementById('fError').textContent = e.message || 'Failed to send message.';
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }
  });
}

// ===== PLAYER PROFILE =====

// Selected season tab: null = All Time, 'none' = matches with no season, or a
// season id. Tracked alongside the player it was chosen for; back-navigation
// swaps state.currentPlayer without going through openPlayerProfile, so a
// selection must never be trusted for a different player.
let _profileSeason = null;
let _profileSeasonFor = null;
// Desktop panel and the Results source filter. Reset with the season selection
// so a stale tab never opens on a different player.
let _profileTab = 'season';
let _profileResultFilter = 'all';

export async function openPlayerProfile(id, { pushHistory = true } = {}) {
  const player = await window.api.getPlayerHistory(id);
  window.navigate('playerProfile', { player }, { pushHistory });
}

export function renderPlayerProfile() {
  const p = state.currentPlayer;
  if (!p) { window.navigate('players'); return; }

  const adminMode = isAdmin();
  document.getElementById('pageTitle').textContent = p.name;
  const acctStatus = p.accountStatus || 'none'; // 'verified' | 'pending' | 'none'
  const hasEmail = !!p.email;

  const isOwnProfile = !adminMode && state.currentUser?.playerId === p.id;
  document.getElementById('topbarActions').innerHTML = adminMode ? `
    <div class="options-menu" id="optionsMenu">
      <button class="btn btn-outline" id="optionsBtn">Options <svg width="14" height="14" viewBox="0 0 4 14" fill="currentColor" style="vertical-align:middle;margin-left:2px"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/></svg></button>
      <div class="options-dropdown" id="optionsDropdown">
        <button class="options-item" data-action="edit-player" data-id="${p.id}">Edit Information</button>
        ${hasEmail && acctStatus !== 'verified' ? `<button class="options-item" data-action="send-invite">Send Invite</button>` : ''}
        ${hasEmail && acctStatus === 'verified' ? `<button class="options-item" data-action="send-reset">Send Password Reset</button>` : ''}
        <button class="options-item options-item-danger" data-action="delete-player" data-id="${p.id}" data-name="${esc(p.name)}">Delete Player</button>
      </div>
    </div>`
  : !isOwnProfile ? `<button class="btn btn-outline" id="btnMessagePlayer">Message</button>` : '';

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
  } else if (!isOwnProfile) {
    document.getElementById('btnMessagePlayer')?.addEventListener('click', () => {
      openMessagePlayerModal(p.id, p.name);
    });
  }

  // ===== DATA =====
  // Everything below derives from the single getPlayerHistory payload. Season
  // scoping is applied to history-derived blocks only; the ladder chart and
  // upcoming matches are deliberately all-time.
  const allHistory = p.history || [];
  const seasons = p.seasons || [];
  const seasonsById = Object.fromEntries(seasons.map((s) => [s.id, s]));

  const playedSeasonIds = [...new Set(allHistory.map((m) => m.season_key).filter((k) => k != null))]
    .sort((a, b) => (seasonsById[b]?.start_date || '').localeCompare(seasonsById[a]?.start_date || ''));
  const hasUnassigned = allHistory.some((m) => m.season_key == null);

  // Default to the current season rather than all-time: the page is a season
  // view now, and an unbounded history is what the redesign set out to remove.
  const defaultSeason = seasons.find((s) => s.is_current && playedSeasonIds.includes(s.id))?.id
    ?? playedSeasonIds[0]
    ?? (hasUnassigned ? 'none' : null);

  // A remembered selection is only trusted when it belongs to this player and
  // still resolves to rows; back navigation swaps the player without going
  // through openPlayerProfile.
  const selectionValid = _profileSeasonFor === p.id && (
    _profileSeason === null
    || playedSeasonIds.includes(_profileSeason)
    || (_profileSeason === 'none' && hasUnassigned)
  );
  const activeSeason = selectionValid ? _profileSeason : defaultSeason;

  // Opening a different player resets the view; a Results filter that matched
  // nothing for them would otherwise render an empty panel with no explanation.
  if (_profileSeasonFor !== p.id) {
    // 'season' was a tab that no longer exists; it only ever fell through to
    // the Results default, so it now says so.
    _profileTab = 'results';
    _profileResultFilter = 'all';
    _profileSeasonFor = p.id;
    _profileSeason = defaultSeason;
  }

  const inSeason = (row) => activeSeason === null
    || (activeSeason === 'none' ? row.season_key == null : row.season_key === activeSeason);

  const history = allHistory.filter(inSeason);
  const tournamentResults = (p.tournamentResults || []).filter(inSeason);
  const upcoming = p.upcoming || [];

  const seasonLabel = activeSeason === null
    ? 'All time'
    : activeSeason === 'none' ? 'Unassigned' : (seasonsById[activeSeason]?.name || 'Season');

  // Empty-state copy naming the selected period, so a profile filtered to
  // "All time" doesn't report that nothing happened "this season".
  const periodPhrase = activeSeason === null
    ? 'recorded'
    : activeSeason === 'none' ? 'outside a season' : `in ${seasonLabel}`;

  const stats = _profileStats(history);

  const ladder = p.ladder || {};
  const ladderSeries = p.ladder_history || [];
  const bestRankInSeason = _bestRankInWindow(ladderSeries, seasonsById[activeSeason]);

  // ===== HEADER =====
  const canEditPhoto = adminMode || state.currentUser?.playerId === p.id;
  const metaBits = [
    p.division_name,
    p.member_number ? `Member #${esc(p.member_number)}` : null,
    adminMode && p.email ? esc(p.email) : null,
  ].filter(Boolean);

  const acctBadge = adminMode && acctStatus === 'verified'
    ? `<span class="pp-badge">Verified</span>` : '';

  // The rank block names the system it came from. It reports the current season's
  // standing, the same number the Ladder page and the dashboard ring show, while
  // the career chart further down is a different scale entirely.
  // The rating is dropped on narrow screens, where it would wrap the label onto
  // a third line; the Ladder page carries it prominently either way.
  const rankLabelHTML = [ladder.frozen ? 'Final' : null, ladder.system === 'elo' ? 'Rating ladder' : 'Ladder']
    .filter(Boolean).join(' · ')
    + (ladder.rating == null ? '' : `<span class="pp-hstat-label-extra"> · ${Number(ladder.rating)}</span>`);

  const rankMoveHTML = !ladder.rank_change ? ''
    : `<span class="pp-hstat-move ${ladder.rank_change > 0 ? 'pp-pos' : 'pp-neg'}" title="Places moved in the last 7 days">${ladder.rank_change > 0 ? '↑' : '↓'}${Math.abs(ladder.rank_change)}</span>`;

  const headerStatsHTML = `
    ${ladder.position == null ? '' : `
      <div class="pp-hstat">
        <div class="pp-hstat-val">#${ladder.position}<span class="pp-hstat-sub">of ${ladder.ladder_size}</span>${rankMoveHTML}</div>
        <div class="pp-hstat-label">${rankLabelHTML}</div>
      </div>`}
    <div class="pp-hstat pp-hstat-wide">
      <div class="pp-hstat-val">${stats.wins}–${stats.losses}<span class="pp-hstat-sub">${stats.winPct === null ? '' : `${stats.winPct}%`}</span></div>
      <div class="pp-hbar"><span style="width:${stats.winPct || 0}%"></span></div>
      <div class="pp-hstat-label">${esc(seasonLabel)} record</div>
    </div>
    ${stats.currentStreak === 0 ? '' : `
      <div class="pp-hstat">
        <div class="pp-hstat-val ${stats.streakType === 'W' ? 'pp-pos' : 'pp-neg'}">${stats.currentStreak}${stats.streakType}</div>
        <div class="pp-hstat-label">Current streak</div>
      </div>`}`;

  const seasonOptions = [
    ...playedSeasonIds.map((id) => ({ value: String(id), label: seasonsById[id]?.name || 'Season' })),
    ...(hasUnassigned ? [{ value: 'none', label: 'Unassigned' }] : []),
    { value: 'all', label: 'All time' },
  ];
  const seasonPillHTML = seasonOptions.length < 2 ? '' : `
    <div class="pp-season-pick">
      <select id="ppSeasonSelect" aria-label="Season">
        ${seasonOptions.map((o) => `<option value="${o.value}" ${String(activeSeason ?? 'all') === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
    </div>`;

  const headerHTML = `
    <div class="pp-header">
      <div class="pp-identity">
        ${canEditPhoto ? `
          <button class="pp-avatar-btn" id="btnEditPhoto" title="Change photo">
            ${avatarHTML(p, 'pp-avatar')}
            <span class="pp-avatar-edit">Edit</span>
          </button>` : avatarHTML(p, 'pp-avatar')}
        <div class="pp-identity-text">
          <h2 class="pp-name">${esc(p.name)}</h2>
          ${metaBits.length ? `<div class="pp-meta">${metaBits.join(' · ')}</div>` : ''}
          ${acctBadge}
        </div>
      </div>
      <div class="pp-header-right">
        ${seasonPillHTML}
        <div class="pp-hstats">${headerStatsHTML}</div>
      </div>
    </div>`;

  // ===== PANELS =====
  // Season and Past seasons are gone: the season pill in the header already
  // controls the period, so both were a second way to do the same thing.
  const TABS = [
    { key: 'results', label: 'Results' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'tournaments', label: 'Tournaments' },
    { key: 'ladder', label: 'Ladder history' },
  ];
  // Normalised back onto the module state so the arrow-key handler and the
  // filter rebuild can't read a tab key the DOM never rendered.
  const activeTab = TABS.some((t) => t.key === _profileTab) ? _profileTab : 'results';
  _profileTab = activeTab;

  // A tablist needs aria-selected, a link to its panel, and one stop in the tab
  // order rather than four; arrow keys move between tabs from there.
  const tabBarHTML = `
    <div class="pp-tabs" role="tablist" aria-label="Profile sections">
      ${TABS.map((t) => `
        <button class="pp-tab${t.key === activeTab ? ' active' : ''}" data-pp-tab="${t.key}"
          role="tab" id="ppTab-${t.key}" aria-controls="ppPanel"
          aria-selected="${t.key === activeTab}" tabindex="${t.key === activeTab ? '0' : '-1'}">${t.label}</button>`).join('')}
    </div>`;

  const resultRow = (m, { compact = false } = {}) => {
    const won = m.result === 'W';
    const context = m.source === 'tournament'
      ? [esc(m.league_name), esc(m.round_label || '')].filter(Boolean).join(' · ')
      : m.source === 'pickup'
        ? 'Ladder match'
        : [esc(m.league_name), m.week_number ? `Wk ${m.week_number}` : null,
           m.division_name ? esc(m.division_name.replace(/^Division\s*/i, 'Div ')) : null].filter(Boolean).join(' · ');
    const opponent = m.opponent_id
      ? `<span class="nav-player-link" data-player-id="${m.opponent_id}">${esc(m.opponent_name)}</span>`
      : esc(m.opponent_name);
    // Only matches in a rated season carry a rating change.
    const delta = m.rating_change;
    const deltaHTML = delta === undefined || delta === null ? '' : `
      <span class="pp-row-delta ${delta >= 0 ? 'pp-delta-up' : 'pp-delta-down'}">${delta >= 0 ? '+' : ''}${delta}</span>`;
    return `
      <div class="pp-row">
        <span class="pp-chip ${won ? 'pp-chip-w' : 'pp-chip-l'}">${won ? 'W' : 'L'}</span>
        <div class="pp-row-main">
          <span class="pp-row-title">${opponent}</span>
          <span class="pp-row-sub">${context}</span>
        </div>
        ${deltaHTML}
        <span class="pp-row-score">${m.my_score}–${m.their_score}</span>
        ${compact ? '' : `<span class="pp-row-date">${formatShortDate(m.week_date)}</span>`}
      </div>`;
  };

  // `action` is optional: only the states where there is a genuinely available
  // next step get a button, rather than every empty panel growing one.
  const emptyBlock = (msg, action) => `
    <div class="empty-state">
      <strong>${esc(msg)}</strong>
      ${action ? `<button class="btn btn-outline btn-sm" data-pp-action="${action.id}">${esc(action.label)}</button>` : ''}
    </div>`;

  const reportMatchAction = { id: 'report-ladder', label: 'Report a ladder match' };

  // -- Results panel --
  // Carries the season-detail figures that used to live on the Season tab, so
  // removing that tab doesn't lose them from the desktop view.
  const detailStripHTML = stats.played === 0 ? '' : `
    <div class="pp-detail-strip">
      <div><span class="pp-fig">${stats.gamesWon}–${stats.gamesLost}</span><span class="pp-fig-label">Games</span></div>
      <div><span class="pp-fig">${stats.gameWinPct === null ? '—' : `${stats.gameWinPct}%`}</span><span class="pp-fig-label">Game win rate</span></div>
      <div><span class="pp-fig">${bestRankInSeason ? `#${bestRankInSeason}` : '—'}</span><span class="pp-fig-label">Best rank</span></div>
      <div><span class="pp-fig">${tournamentResults.length}</span><span class="pp-fig-label">Tournaments</span></div>
    </div>`;

  const sourceFilters = [
    { key: 'all', label: 'All' },
    { key: 'league', label: 'League' },
    { key: 'pickup', label: 'Ladder' },
    { key: 'tournament', label: 'Tournament' },
  ];
  // Takes the filter as an argument so changing it can rebuild this panel alone
  // instead of re-rendering the whole profile.
  const buildResultsPanel = (filterKey) => {
    const filtered = filterKey === 'all'
      ? history
      : history.filter((m) => (m.source || 'league') === filterKey);
    return `
    <div class="pp-card">
      <div class="pp-card-head pp-card-head-wrap">
        <div class="pp-card-head-text">
          <span class="pp-card-label">Results · ${esc(seasonLabel)}</span>
          <span class="pp-card-sub">${stats.wins} win${stats.wins === 1 ? '' : 's'} · ${stats.losses} loss${stats.losses === 1 ? '' : 'es'}</span>
        </div>
        <div class="pp-filters" role="group" aria-label="Filter results by competition">
          ${sourceFilters.map((f) => `
            <button class="pp-filter${filterKey === f.key ? ' active' : ''}" data-pp-filter="${f.key}"
              aria-pressed="${filterKey === f.key}">${f.label}</button>`).join('')}
        </div>
      </div>
      ${detailStripHTML}
      ${filtered.length
        ? filtered.map((m) => resultRow(m)).join('')
        : filterKey === 'all'
          ? emptyBlock(`No matches ${periodPhrase} yet`, reportMatchAction)
          : emptyBlock(`No ${sourceFilters.find((f) => f.key === filterKey)?.label.toLowerCase()} matches ${periodPhrase}`)}
    </div>`;
  };

  // -- Upcoming panel --
  const upcomingPanelHTML = `
    <div class="pp-card">
      <div class="pp-card-head">
        <span class="pp-card-label">Upcoming matches</span>
        <span class="pp-card-sub">all seasons · ${upcoming.length} scheduled</span>
      </div>
      ${upcoming.length ? upcoming.map((m, i) => {
        const courtLabel = isAdmin() && (m.court_name || (m.schedule_courts && m.court_number ? `Court ${m.court_number}` : null));
        const timing = [m.match_time, courtLabel].filter(Boolean).join(' · ');
        const context = [esc(m.league_name), m.week_number ? `Wk ${m.week_number}` : null].filter(Boolean).join(' · ');
        const opponent = m.opponent_id
          ? `<span class="nav-player-link" data-player-id="${m.opponent_id}">${esc(m.opponent_name)}</span>`
          : esc(m.opponent_name || 'TBD');
        return `
          <div class="pp-row pp-row-lg${i === 0 ? ' pp-row-next' : ''}">
            <div class="pp-date-block">
              <span class="pp-date-main">${formatShortDate(m.week_date)}</span>
              ${timing ? `<span class="pp-date-sub">${esc(timing)}</span>` : ''}
            </div>
            <div class="pp-row-main">
              <span class="pp-row-title">${opponent}${i === 0 ? '<span class="pp-next-chip">Next up</span>' : ''}</span>
              <span class="pp-row-sub">${context}</span>
            </div>
          </div>`;
      }).join('') : emptyBlock('No upcoming matches')}
    </div>`;

  // -- Tournaments panel --
  const tournPanelHTML = `
    <div class="pp-card">
      <div class="pp-card-head"><span class="pp-card-label">Tournaments · ${esc(seasonLabel)}</span></div>
      ${tournamentResults.length ? tournamentResults.map((t) => `
        <div class="pp-row pp-row-lg${t.status !== 'completed' ? ' pp-row-next' : ''}">
          <div class="pp-row-main">
            <span class="pp-row-title">${esc(t.name)}</span>
            <span class="pp-row-sub">${formatShortDate(t.championship_date)}</span>
          </div>
          ${t.status === 'completed'
            ? `<span class="pp-finish${t.position === 2 ? ' pp-finish-runner' : ''}">${t.position ? `Finished #${t.position}` : '—'}</span>`
            : `<span class="pp-next-chip">In progress</span>`}
        </div>`).join('') : emptyBlock('No tournaments played yet')}
    </div>`;

  // -- Career ladder panel (all-time, independent of the season selector) --
  // The chart is an all-time positional replay, so the overlay reads the same
  // series rather than the header's season rank. Pairing the two put a rating
  // rank above a positional chart that legitimately disagreed with it.
  const careerLast = ladderSeries[ladderSeries.length - 1] || null;
  const careerBest = _bestRankInWindow(ladderSeries, null);

  const ladderPanelHTML = careerLast == null ? '' : `
    <div class="pp-ladder-card">
      <span class="pp-card-label pp-on-navy">Career ladder position · all seasons</span>
      ${_ladderChartHTML(ladderSeries, seasons, 'desktop')}
      <div class="pp-ladder-overlay">
        <div class="pp-ladder-now">#${careerLast.position}</div>
        <div class="pp-ladder-of">of ${careerLast.ladder_size} players</div>
        <div class="pp-ladder-rule"></div>
        <div class="pp-ladder-best">#${careerBest}<span>Best ever</span></div>
      </div>
    </div>`;

  const panelFor = (tabKey) => {
    switch (tabKey) {
      case 'upcoming':    return upcomingPanelHTML;
      case 'tournaments': return tournPanelHTML;
      case 'ladder':      return ladderPanelHTML || emptyBlock('Not on the ladder yet', reportMatchAction);
      default:            return buildResultsPanel(_profileResultFilter);
    }
  };

  // ===== MOBILE =====
  // A single scrolling column rather than tabs: record, recent results, then an
  // "all time" divider that signals the ladder card ignores the season filter.
  const mobileHTML = `
    <div class="pp-mobile">
      <div class="pp-season-row">
        ${seasonPillHTML}
        <span class="pp-season-count">${history.length} match${history.length === 1 ? '' : 'es'} played</span>
      </div>

      <div class="pp-card pp-card-pad">
        <div class="pp-card-head pp-card-head-bare">
          <span class="pp-card-label">${esc(seasonLabel)} record</span>
          ${stats.currentStreak > 1 && stats.streakType === 'W'
            ? `<span class="pp-streak">${stats.currentStreak}-match win streak</span>` : ''}
        </div>
        ${stats.played === 0 ? emptyBlock('No matches played this season') : `
          <div class="pp-big">
            <span class="pp-big-w">${stats.wins}</span>
            <span class="pp-big-sep">/</span>
            <span class="pp-big-l">${stats.losses}</span>
            <span class="pp-big-pct">${stats.winPct === null ? '—' : `${stats.winPct}%`}</span>
          </div>
          <div class="pp-bar pp-bar-lg"><span style="width:${stats.winPct || 0}%"></span></div>
          <div class="pp-figures">
            <div><span class="pp-fig">${stats.gamesWon}–${stats.gamesLost}</span><span class="pp-fig-label">Games</span></div>
                  <div><span class="pp-fig">${bestRankInSeason ? `#${bestRankInSeason}` : '—'}</span><span class="pp-fig-label">Best rank</span></div>
          </div>`}
      </div>

      ${history.length ? `
        <div class="pp-card">
          <div class="pp-card-head">
            <span class="pp-card-label">Last ${Math.min(3, history.length)} result${history.length === 1 ? '' : 's'}</span>
            ${history.length > 3 ? `<button class="pp-link" data-pp-tab="results">All ${history.length}</button>` : ''}
          </div>
          ${history.slice(0, 3).map((m) => resultRow(m)).join('')}
        </div>` : ''}

      ${careerLast == null ? '' : `
        <div class="pp-divider"><span>All time</span></div>
        <div class="pp-ladder-card pp-ladder-card-sm">
          <span class="pp-card-label pp-on-navy">Career ladder position</span>
          ${_ladderChartHTML(ladderSeries, seasons, 'mobile')}
        </div>`}

      ${_quickLinksHTML(upcoming.length, tournamentResults.length)}
    </div>`;

  document.getElementById('mainContent').innerHTML = `
    ${headerHTML}
    <div class="pp-desktop">
      ${tabBarHTML}
      <div class="pp-panel" id="ppPanel" role="tabpanel" aria-labelledby="ppTab-${activeTab}" tabindex="0">${panelFor(activeTab)}</div>
    </div>
    ${mobileHTML}`;

  // ===== EVENTS =====
  const content = document.getElementById('mainContent');

  const wireOpponentLinks = (root) => {
    root.querySelectorAll('.nav-player-link').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        window.openPlayerProfile(Number(el.dataset.playerId));
      });
    });
  };
  wireOpponentLinks(content);

  document.getElementById('btnEditPhoto')?.addEventListener('click', () => openPhotoModal(p));

  // Chart points: hover shows the label on a pointer device via CSS. Touch has
  // no hover, so a tap opens one and closes any other, and a tap anywhere else
  // dismisses it.
  content.querySelectorAll('.pp-chart').forEach((chart) => {
    chart.addEventListener('click', (e) => {
      const pt = e.target.closest('.pp-chart-pt');
      chart.querySelectorAll('.pp-chart-pt.is-open').forEach((el) => {
        if (el !== pt) el.classList.remove('is-open');
      });
      if (pt) {
        pt.classList.toggle('is-open');
        e.stopPropagation();
      }
    });
  });

  content.addEventListener('click', (e) => {
    if (e.target.closest('.pp-chart-pt')) return;
    content.querySelectorAll('.pp-chart-pt.is-open').forEach((el) => el.classList.remove('is-open'));
  });

  const panelEl = document.getElementById('ppPanel');
  const tabEls = [...content.querySelectorAll('.pp-tab[data-pp-tab]')];

  // Only the panel's contents depend on the tab and the filter, so only they are
  // rebuilt. A full renderPlayerProfile() re-fetched the profile, replayed the
  // ladder and replaced the header and chart, which lost the scroll position.
  const wirePanel = () => {
    wireOpponentLinks(panelEl);
    panelEl.querySelectorAll('[data-pp-action="report-ladder"]').forEach((el) => {
      el.addEventListener('click', () => openPickupGameModal());
    });
    panelEl.querySelectorAll('[data-pp-filter]').forEach((el) => {
      el.addEventListener('click', () => {
        _profileResultFilter = el.dataset.ppFilter;
        panelEl.innerHTML = panelFor(_profileTab);
        wirePanel();
      });
    });
  };

  const showTab = (key) => {
    _profileTab = key;
    panelEl.innerHTML = panelFor(key);
    panelEl.setAttribute('aria-labelledby', `ppTab-${key}`);
    tabEls.forEach((t) => {
      const on = t.dataset.ppTab === key;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    wirePanel();
  };

  if (panelEl) {
    wirePanel();
    tabEls.forEach((el) => el.addEventListener('click', () => showTab(el.dataset.ppTab)));
    content.querySelector('.pp-tabs')?.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const i = tabEls.findIndex((t) => t.dataset.ppTab === _profileTab);
      const next = tabEls[(i + step + tabEls.length) % tabEls.length];
      showTab(next.dataset.ppTab);
      next.focus();
    });
  }

  // The mobile quick links point at desktop tabs, which aren't rendered there;
  // they still need the full re-render they have always done.
  content.querySelectorAll('.pp-quick-row[data-pp-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      _profileTab = el.dataset.ppTab;
      renderPlayerProfile();
    });
  });

  document.getElementById('ppSeasonSelect')?.addEventListener('change', (e) => {
    const raw = e.target.value;
    _profileSeason = raw === 'all' ? null : raw === 'none' ? 'none' : raw;
    _profileSeasonFor = p.id;
    renderPlayerProfile();
  });
}

// ===== PROFILE HELPERS =====

/** Match/game/streak totals for a set of history rows (newest first). */
function _profileStats(rows) {
  const wins = rows.filter((m) => m.result === 'W').length;
  const losses = rows.filter((m) => m.result === 'L').length;
  const played = wins + losses;
  const gamesWon = rows.reduce((s, m) => s + (Number(m.my_score) || 0), 0);
  const gamesLost = rows.reduce((s, m) => s + (Number(m.their_score) || 0), 0);
  const gamesTotal = gamesWon + gamesLost;

  let currentStreak = 0;
  let streakType = null;
  for (const m of rows) {
    if (streakType === null) streakType = m.result;
    if (m.result !== streakType) break;
    currentStreak++;
  }

  return {
    wins, losses, played,
    winPct: played > 0 ? Math.round((wins / played) * 100) : null,
    gamesWon, gamesLost, gamesTotal,
    gameWinPct: gamesTotal > 0 ? Math.round((gamesWon / gamesTotal) * 100) : null,
    currentStreak, streakType: currentStreak ? streakType : null,
  };
}

/** Best (lowest) ladder position reached inside a season's date window. */
function _bestRankInWindow(series, season) {
  if (!series?.length) return null;
  const within = season
    ? series.filter((pt) => pt.date >= season.start_date && pt.date <= season.end_date)
    : series;
  if (!within.length) return null;
  return Math.min(...within.map((pt) => pt.position));
}

function _quickLinksHTML(upcomingCount, tournCount) {
  const chev = `<svg class="pp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>`;
  return `
    <div class="pp-card pp-quick">
      <button class="pp-quick-row" data-pp-tab="upcoming">
        <span class="pp-quick-label">Upcoming matches</span>
        <span class="pp-quick-meta">${upcomingCount}</span>${chev}
      </button>
      <button class="pp-quick-row" data-pp-tab="tournaments">
        <span class="pp-quick-label">Tournaments</span>
        <span class="pp-quick-meta">${tournCount}</span>${chev}
      </button>
    </div>`;
}

/**
 * Ladder position over time as inline SVG.
 *
 * The viewBox aspect is kept equal to the rendered box aspect (2:1) so the
 * default preserveAspectRatio doesn't letterbox the plot inside the card.
 * The rank axis is inverted; a better rank sits higher.
 */
function _ladderChartHTML(series, seasons, variant) {
  if (!series || series.length < 2) {
    return `<div class="pp-chart-empty">Not enough history to chart yet</div>`;
  }

  // A wide viewBox with width:100%/height:auto fills the card edge to edge; the
  // default preserveAspectRatio would otherwise letterbox a fixed-height chart.
  const W = variant === 'mobile' ? 640 : 1000;
  const H = variant === 'mobile' ? 300 : 340;
  const X0 = 40, X1 = W - 16, Y0 = 30, Y1 = H - 56;

  const positions = series.map((pt) => pt.position);
  let best = Math.min(...positions);
  let worst = Math.max(...positions);
  if (best === worst) { best = Math.max(1, best - 1); worst = worst + 1; }

  const ms = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime();
  const t0 = ms(series[0].date);
  const t1 = ms(series[series.length - 1].date);
  const span = t1 - t0 || 1;

  const x = (d) => X0 + ((ms(d) - t0) / span) * (X1 - X0);
  const y = (pos) => Y0 + ((pos - best) / (worst - best)) * (Y1 - Y0);

  const pts = series.map((pt) => `${x(pt.date).toFixed(1)},${y(pt.position).toFixed(1)}`);
  const area = `M${pts.join(' L')} L${X1.toFixed(1)},${Y1} L${X0},${Y1} Z`;

  // Y gridlines at the best, middle and worst rank reached.
  const mid = Math.round((best + worst) / 2);
  const gridRows = [best, mid, worst].map((pos, i) => {
    const gy = Y0 + (i / 2) * (Y1 - Y0);
    return `<line x1="${X0}" y1="${gy}" x2="${X1}" y2="${gy}" stroke="rgba(255,255,255,.12)" stroke-width="1"/>
            <text x="${X0 - 10}" y="${gy + 4}" text-anchor="end" font-size="12" fill="rgba(255,255,255,.5)">#${pos}</text>`;
  }).join('');

  // X axis is dated rather than labelled by season: evenly spaced ticks across
  // the range, showing the year only when the span crosses one.
  const tickCount = variant === 'mobile' ? 4 : 7;
  const multiYear = new Date(t0).getUTCFullYear() !== new Date(t1).getUTCFullYear();
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const xTicks = Array.from({ length: tickCount }, (_, i) => {
    const t = t0 + (span * i) / (tickCount - 1);
    const d = new Date(t);
    const px = X0 + ((t - t0) / span) * (X1 - X0);
    const label = multiYear
      ? `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`
      : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    const anchor = i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle';
    return `<line x1="${px.toFixed(1)}" y1="${Y1}" x2="${px.toFixed(1)}" y2="${Y1 + 6}" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
            <text x="${px.toFixed(1)}" y="${Y1 + 24}" text-anchor="${anchor}" font-size="12" fill="rgba(255,255,255,.55)">${label}</text>`;
  }).join('');

  // Season boundaries, so the dated axis still shows where one season ends.
  const boundaries = (seasons || [])
    .map((sn) => sn.start_date)
    .filter((d) => d && ms(d) > t0 && ms(d) < t1)
    .map((d) => {
      const px = x(d).toFixed(1);
      const label = (seasons.find((sn) => sn.start_date === d) || {}).name || '';
      return `<line x1="${px}" y1="${Y0 - 10}" x2="${px}" y2="${Y1}" stroke="rgba(255,255,255,.22)" stroke-width="1" stroke-dasharray="3 3"/>
              <text x="${px}" y="${Y0 - 14}" text-anchor="middle" font-size="11" fill="rgba(255,255,255,.55)">${esc(label)}</text>`;
    }).join('');

  const fmt = (d) => {
    const dt = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
    return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
  };

  // Every point in the series is a real position change, so every one gets a
  // marker. The label sits in the markup rather than in a <title>, so it shows
  // the instant the pointer arrives instead of after the browser's tooltip
  // delay, and so it can be opened by tapping on a touch screen.
  const last = series.length - 1;
  const shortDate = (d) => {
    const dt = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
    return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  };
  const markers = series.map((pt, i) => {
    const cx = x(pt.date);
    const cy = y(pt.position);
    const dot = i === last
      ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6" fill="#fff"/>`
      : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="#1a2150" stroke="#8fa8ff" stroke-width="2.5"/>`;

    const label = `#${pt.position} · ${shortDate(pt.date)}`;
    // SVG can't measure text before paint, so the pill is sized from the label
    // length and then kept inside the plot so it can't run off an edge.
    const w = label.length * 7 + 18;
    const cxClamped = Math.min(X1 - w / 2, Math.max(X0 + w / 2, cx));
    // Flip below the dot near the top, where there is no room above it.
    const above = cy > Y0 + 40;
    const ty = above ? cy - 14 : cy + 14;

    return `
      <g class="pp-chart-pt" data-pt="${i}">
        ${dot}
        <circle class="pp-chart-hit" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="16" fill="transparent"/>
        <g class="pp-chart-tip" transform="translate(${cxClamped.toFixed(1)}, ${ty.toFixed(1)})">
          <rect x="${(-w / 2).toFixed(1)}" y="${above ? -22 : 0}" width="${w}" height="22" rx="6"
            fill="#0d1330" stroke="rgba(255,255,255,.25)" stroke-width="1"/>
          <text x="0" y="${above ? -7 : 15}" text-anchor="middle" font-family="Barlow, sans-serif"
            font-size="12.5" font-weight="700" fill="#fff">${label}</text>
        </g>
      </g>`;
  }).join('');

  const lastPt = series[last];
  const lastX = x(lastPt.date);
  const lastY = y(lastPt.position);

  return `
    <svg class="pp-chart pp-chart-${variant}" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Ladder position over time, currently ranked ${lastPt.position} of ${lastPt.ladder_size}">
      ${gridRows}
      ${boundaries}
      <path d="${area}" fill="#8fa8ff" fill-opacity="0.14"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="#8fa8ff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${xTicks}
      ${markers}
      <text x="${Math.min(X1 - 10, Math.max(X0 + 10, lastX)).toFixed(1)}" y="${(lastY - 16).toFixed(1)}"
        text-anchor="middle" font-family="Barlow, sans-serif" font-size="17" font-weight="700" fill="#fff">#${lastPt.position}</text>
    </svg>`;
}
// ===== PROFILE PHOTO =====
function openPhotoModal(player) {
  modal.open('Profile Photo', `
    <div class="photo-modal">
      <div class="photo-preview" id="photoPreview">
        ${player.photo_path
          ? `<img src="${esc(player.photo_path)}" alt="">`
          : `<span>${esc(playerInitials(player.name))}</span>`}
      </div>
      <p class="form-hint">JPEG, PNG, WebP or GIF. Maximum 5 MB.</p>
      <input type="file" id="fPhotoFile" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
      <div class="form-actions">
        ${player.photo_path ? `<button class="btn btn-danger" id="fPhotoRemove">Remove</button>` : ''}
        <button class="btn btn-outline" id="fPhotoCancel">Cancel</button>
        <button class="btn btn-primary" id="fPhotoChoose">Choose Image</button>
      </div>
    </div>`);

  const fileInput = document.getElementById('fPhotoFile');

  document.getElementById('fPhotoCancel').addEventListener('click', modal.close);
  document.getElementById('fPhotoChoose').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Image is too large. Maximum size is 5 MB.', 'error');

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    }).catch((err) => { toast(err.message, 'error'); return null; });
    if (!dataUrl) return;

    try {
      await window.api.setPlayerPhoto(player.id, dataUrl);
      modal.close();
      toast('Photo updated');
      await window.openPlayerProfile(player.id);
    } catch (err) {
      toast(err.message || 'Could not save photo', 'error');
    }
  });

  document.getElementById('fPhotoRemove')?.addEventListener('click', async () => {
    try {
      await window.api.deletePlayerPhoto(player.id);
      modal.close();
      toast('Photo removed');
      await window.openPlayerProfile(player.id);
    } catch (err) {
      toast(err.message || 'Could not remove photo', 'error');
    }
  });
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

// ===== LADDER MATCH MODAL =====
export async function openPickupGameModal() {
  const adminMode = isAdmin();
  const myId = state.currentUser?.playerId;

  modal.open('Report Ladder Match Score', '<div class="modal-loading">Loading players…</div>', { medium: true });

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
      toast('Ladder match recorded!', 'success');
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
