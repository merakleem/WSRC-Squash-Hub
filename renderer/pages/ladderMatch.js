// ===== LADDER MATCH MODALS =====
// Entering a ladder result: the singles modal and the doubles one (2v2, any
// signed-in player who played in it). Split from players.js.

import { state, isAdmin } from '../state.js';
import { esc, toast, modal, avatarHTML } from '../utils.js';

// A singles or doubles chip in the modal header, beside the title.
function _setMatchModalTitle(title, mode) {
  document.getElementById('modalTitle').innerHTML =
    `${esc(title)} <span class="em-mode-chip">${mode === 'doubles' ? 'Doubles' : 'Singles'}</span>`;
}

export async function openPickupGameModal({ mode = 'singles' } = {}) {
  if (mode === 'doubles') return openDoublesMatchModal();
  const adminMode = isAdmin();
  const myId = state.currentUser?.playerId;

  modal.open('Enter a match', '<div class="modal-loading">Loading players…</div>', { medium: true });
  _setMatchModalTitle('Enter a match', 'singles');

  const allPlayers = state.players.length ? state.players : await window.api.getPlayers();
  // Your own row comes from the session when the list does not carry it, rather
  // than depending on finding yourself in a list someone may one day filter:
  // when that lookup failed, every name here fell back to a placeholder and the
  // hint below read it as a noun. /api/me always answers for its own player.
  const me = allPlayers.find((p) => p.id === myId)
    || (myId && state.currentUser?.name
      ? { id: myId, name: state.currentUser.name, photo_path: state.currentUser.photo_path }
      : null);
  // "You", like the report-score and court-booking sheets, so a name that never
  // arrives still reads as a person rather than as the word "Me".
  const myName = adminMode ? '' : (me?.name || 'You');

  // The scoreline is asked as two questions — who won, then how many games the
  // loser took — and folded back into the player1/player2 pair the API has
  // always taken. `games` is the LOSER's count, so 0 is a real answer: every
  // check on it must be `!== null`, never truthiness.
  let winner = null;   // 1 | 2 | null
  let games  = null;   // 0 | 1 | 2 | null

  const todayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  let playedOn = todayISO;
  // A date before the current season would file the match into a finished
  // ladder, so the picker stops there. The server enforces the same bound.
  let seasonStart = null;
  let seasonName = '';

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
        `<div class="pu-search-option" data-id="${p.id}" data-name="${esc(p.name)}">
          ${avatarHTML(p, 'em-opt-avatar')}
          <span class="em-opt-name">${esc(p.name)}</span>
        </div>`,
      ).join('') || `<div class="pu-search-empty">No players found</div>`;
      listEl.style.display = 'block';
      listEl.querySelectorAll('.pu-search-option').forEach((opt) => {
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          hiddenEl.value = opt.dataset.id;
          // dataset.name, not textContent: the row now carries an avatar, whose
          // initials would otherwise be pasted into the field alongside the name.
          searchEl.value = opt.dataset.name;
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

  const p1Id = () => (adminMode ? Number(document.getElementById('puP1')?.value) || null : myId || null);
  const p2Id = () => Number(document.getElementById('puP2')?.value) || null;
  const bothChosen = () => !!(p1Id() && p2Id());
  // Slot 1 is the player themselves whenever an admin is not filling both
  // sides. Declared above its first use, not beside the other helpers: a const
  // arrow is not hoisted, so a later declaration only survives because these
  // run at render time.
  const isSelf = (slot) => !adminMode && slot === 1;

  function playerFor(slot) {
    const id = slot === 1 ? p1Id() : p2Id();
    if (!id) return null;
    // Same reason as `me` above: your own row may not be in the list, and
    // without this the winner card falls back to initials over your photo.
    return allPlayers.find((p) => p.id === id) || (isSelf(slot) ? me : null);
  }
  function nameFor(slot) {
    const p = playerFor(slot);
    if (p) return p.name;
    if (slot === 1) return adminMode ? 'Player 1' : myName;
    return adminMode ? 'Player 2' : 'Opponent';
  }
  const firstName = (n) => String(n || '').split(' ')[0];
  // You take "Your", never a possessive name: a pronoun bent into one reads as
  // broken English however the name was resolved.
  const possessive = (slot) => (isSelf(slot) ? 'Your' : `${firstName(nameFor(slot))}'s`);

  const CHECK_SVG = `<svg class="em-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`;

  const GAME_OPTIONS = [
    { games: 0, caption: 'in three' },
    { games: 1, caption: 'in four' },
    { games: 2, caption: 'in five' },
  ];

  function renderWinner() {
    const can = bothChosen();
    document.getElementById('emWinnerHint').textContent =
      can ? '' : (adminMode ? 'Choose both players' : 'Pick an opponent first');

    document.getElementById('emWinnerGrid').innerHTML = [1, 2].map((slot) => {
      const p = playerFor(slot);
      const sel = winner === slot;
      return `<button type="button" class="em-winner-card${sel ? ' em-winner-card--selected' : ''}"
        data-slot="${slot}"${can ? '' : ' disabled'}>
        ${avatarHTML(p || { name: nameFor(slot) }, 'em-winner-avatar')}
        <span class="em-winner-name">${esc(nameFor(slot))}</span>
        ${sel ? CHECK_SVG : ''}
      </button>`;
    }).join('');
  }

  function renderGames() {
    const section = document.getElementById('emGamesSection');
    // Hidden rather than disabled until a winner exists: the question has no
    // meaning yet, so it should not be on screen.
    section.hidden = winner === null;
    if (winner === null) return;

    document.getElementById('emGamesHint').textContent = `${possessive(winner)} games first`;
    document.getElementById('emGamesGrid').innerHTML = GAME_OPTIONS.map((o) => {
      const sel = games === o.games;
      return `<button type="button" class="em-games-card${sel ? ' em-games-card--selected' : ''}" data-games="${o.games}">
        <span class="em-games-score">3–${o.games}</span>
        <span class="em-games-caption">${o.caption}</span>
      </button>`;
    }).join('');
  }

  const isComplete = () => bothChosen() && winner !== null && games !== null;

  function renderConfirm() {
    const box = document.getElementById('emConfirm');
    box.hidden = !isComplete();
    if (box.hidden) return;
    const loser = winner === 1 ? 2 : 1;
    box.innerHTML = `${CHECK_SVG}<span class="em-confirm-text">${esc(nameFor(winner))} beat ${esc(nameFor(loser))} 3–${games}</span>`;
  }

  function renderFooter() {
    let note = '';
    if (!bothChosen()) note = adminMode ? 'Choose both players' : 'Choose your opponent';
    else if (winner === null || games === null) note = 'Pick a winner and a scoreline';
    document.getElementById('emMissing').textContent = note;
    document.getElementById('puSubmit').disabled = !isComplete();
  }

  function update() {
    renderWinner();
    renderGames();
    renderConfirm();
    renderFooter();
  }

  function onPlayerChange() {
    // A different pairing invalidates both halves of the scoreline.
    winner = null;
    games = null;
    update();
  }

  const playersSectionHTML = adminMode
    ? `<div class="em-section">
        <div class="em-label">Players</div>
        <div class="em-players-row">
          <div class="em-player-col">${searchSelectorHTML('puP1', 'Search players…')}</div>
          <div class="em-vs">vs</div>
          <div class="em-player-col">${searchSelectorHTML('puP2', 'Search players…')}</div>
        </div>
      </div>`
    : `<div class="em-section">
        <div class="em-self-card">
          ${avatarHTML(me || { name: myName }, 'em-self-avatar')}
          <span class="em-self-name">${esc(myName)}</span>
          <span class="em-you-chip">YOU</span>
        </div>
        <div class="em-vs em-vs-stacked">vs</div>
        ${searchSelectorHTML('puP2', 'Search opponent…')}
      </div>`;

  document.getElementById('modalBody').innerHTML = `
    <div class="em-modal">
      ${playersSectionHTML}

      <div class="em-section">
        <div class="em-label-row">
          <span class="em-label">Who won?</span>
          <span class="em-hint" id="emWinnerHint"></span>
        </div>
        <div class="em-winner-grid" id="emWinnerGrid"></div>
      </div>

      <div class="em-section" id="emGamesSection" hidden>
        <div class="em-label-row">
          <span class="em-label">Games</span>
          <span class="em-hint" id="emGamesHint"></span>
        </div>
        <div class="em-games-grid" id="emGamesGrid"></div>
      </div>

      <div class="em-section em-date-section">
        <span class="em-label">Date played</span>
        <div class="em-date-controls">
          <button type="button" class="em-today-chip em-today-chip--active" id="emToday">Today</button>
          <input type="date" class="em-date-input" id="emDate" value="${todayISO}" max="${todayISO}">
        </div>
      </div>

      <div class="em-confirm" id="emConfirm" hidden></div>

      <div class="em-footer">
        <span class="em-missing" id="emMissing"></span>
        <div class="em-footer-btns">
          <button type="button" class="btn btn-ghost" id="emCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="puSubmit" disabled>Log match</button>
        </div>
      </div>
    </div>`;

  update();

  if (adminMode) {
    wireSearch('puP1', () => p2Id(), onPlayerChange);
    wireSearch('puP2', () => p1Id(), onPlayerChange);
  } else {
    wireSearch('puP2', myId, onPlayerChange);
  }

  document.getElementById('emWinnerGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.em-winner-card');
    if (!btn || btn.disabled) return;
    const slot = Number(btn.dataset.slot);
    // Switching winner keeps the games count: 3–1 means the same shape of match
    // either way round, and re-asking for it would be busywork.
    winner = winner === slot ? null : slot;
    update();
  });

  document.getElementById('emGamesGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.em-games-card');
    if (!btn) return;
    const g = Number(btn.dataset.games);
    games = games === g ? null : g;
    update();
  });

  const dateEl = document.getElementById('emDate');
  const todayChip = document.getElementById('emToday');
  function setDate(value) {
    playedOn = value || todayISO;
    dateEl.value = playedOn;
    todayChip.classList.toggle('em-today-chip--active', playedOn === todayISO);
  }
  dateEl.addEventListener('change', () => {
    let v = dateEl.value;
    if (!v) { setDate(todayISO); return; }
    if (v > todayISO) { toast('A match cannot be played in the future.', 'warning'); v = todayISO; } else if (seasonStart && v < seasonStart) {
      toast(`That date is before the ${seasonName} season started.`, 'warning');
      v = seasonStart;
    }
    setDate(v);
  });
  todayChip.addEventListener('click', () => setDate(todayISO));

  document.getElementById('emCancel').addEventListener('click', () => modal.close());

  // Bounding the picker needs the season boundary, which nothing else on this
  // screen knows. Fetched after the modal is usable so a slow reply never
  // blocks entry, and the server rejects an out-of-range date regardless.
  window.api.getSeasons().then((seasons) => {
    const current = (seasons || []).find((s) => s.is_current);
    if (!current || !document.getElementById('emDate')) return;
    seasonStart = current.start_date;
    seasonName = current.name;
    document.getElementById('emDate').setAttribute('min', seasonStart);
  }).catch(() => {});

  document.getElementById('puSubmit').addEventListener('click', async () => {
    const p1 = p1Id();
    const p2 = p2Id();
    if (!p1 || !p2)   { toast('Please select both players.', 'warning'); return; }
    if (p1 === p2)    { toast('Players must be different.', 'warning'); return; }
    if (winner === null || games === null) { toast('Please select a score.', 'warning'); return; }
    const winnerIsP1 = winner === 1;
    const btn = document.getElementById('puSubmit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      await window.api.logPickupGame({
        player1Id: p1,
        player2Id: p2,
        player1Score: winnerIsP1 ? 3 : games,
        player2Score: winnerIsP1 ? games : 3,
        // Left off for a match played today so the row keeps a real timestamp
        // rather than a flattened midday one, which is what orders same-day
        // matches in the rating replay.
        ...(playedOn !== todayISO ? { playedOn } : {}),
      });
      toast('Ladder match recorded!', 'success');
      modal.close();
      if (state.page === 'ladder') window.renderLadder();
      else if (state.page === 'dashboard') window.renderDashboard();
    } catch (err) {
      toast(err.message || 'Failed to log game', 'error');
      btn.disabled = false;
      btn.textContent = 'Log match';
    }
  });
}

// ===== DOUBLES LADDER MATCH MODAL =====
// The same shell as the singles modal, in two labelled groups: your team
// (you and a teammate) and the two opponents. An admin fills all four.
export async function openDoublesMatchModal() {
  const adminMode = isAdmin();
  const myId = state.currentUser?.playerId;

  modal.open('Enter a doubles match', '<div class="modal-loading">Loading players…</div>', { medium: true });
  _setMatchModalTitle('Enter a doubles match', 'doubles');

  const [allPlayers, dblLadder] = await Promise.all([
    state.players.length ? state.players : window.api.getPlayers(),
    window.api.getDoublesLadderForSeason().catch(() => ({ rows: [] })),
  ]);
  // Doubles rank beside each suggestion; unranked players simply show none.
  const rankOf = Object.fromEntries((dblLadder?.rows || []).map((r) => [r.id, r.position]));
  const rankText = (id) => (rankOf[id] ? `#${rankOf[id]}` : '');

  const me = allPlayers.find((p) => p.id === myId)
    || (myId && state.currentUser?.name
      ? { id: myId, name: state.currentUser.name, photo_path: state.currentUser.photo_path }
      : null);
  const myName = adminMode ? '' : (me?.name || 'You');

  let winner = null;   // 1 | 2 | null  (side)
  let games  = null;   // loser's games: 0 | 1 | 2 | null

  const todayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  let playedOn = todayISO;
  let seasonStart = null;
  let seasonName = '';

  // Slot ids: side 1 is you (or Player 1 for an admin) and your teammate; side
  // 2 is the two opponents.
  const SLOTS = adminMode
    ? [{ id: 'dmP1', label: 'Player 1', side: 1 }, { id: 'dmP1b', label: 'Teammate', side: 1 },
      { id: 'dmP2', label: 'Opponent 1', side: 2 }, { id: 'dmP2b', label: 'Opponent 2', side: 2 }]
    : [{ id: 'dmP1b', label: 'Teammate', side: 1 },
      { id: 'dmP2', label: 'Opponent 1', side: 2 }, { id: 'dmP2b', label: 'Opponent 2', side: 2 }];

  function fieldHTML(slot) {
    const placeholder = slot.side === 1 ? (slot.id === 'dmP1' ? 'Search players…' : 'Search teammate…') : 'Search opponent…';
    return `<div class="em-field">
      <label class="em-field-label" for="${slot.id}Search">${slot.label}</label>
      <div class="pu-search-wrap">
        <div class="pu-search-input-row">
          <input type="text" class="form-control pu-search-input" id="${slot.id}Search" placeholder="${placeholder}" autocomplete="off">
          <button type="button" class="pu-search-clear" id="${slot.id}Clear">×</button>
        </div>
        <div class="pu-search-list" id="${slot.id}List"></div>
        <input type="hidden" id="${slot.id}">
      </div>
    </div>`;
  }

  const idOf = (slotId) => Number(document.getElementById(slotId)?.value) || null;
  const sideIds = (side) => (side === 1
    ? [adminMode ? idOf('dmP1') : (myId || null), idOf('dmP1b')]
    : [idOf('dmP2'), idOf('dmP2b')]);
  const chosenIds = () => new Set([...sideIds(1), ...sideIds(2)].filter(Boolean));
  const allChosen = () => [...sideIds(1), ...sideIds(2)].every(Boolean);

  function wireSearch(slotId, onChange) {
    const searchEl = document.getElementById(slotId + 'Search');
    const listEl   = document.getElementById(slotId + 'List');
    const hiddenEl = document.getElementById(slotId);
    const clearEl  = document.getElementById(slotId + 'Clear');

    function showList() {
      const q = searchEl.value.trim().toLowerCase();
      // A player already chosen in another field is not offered again.
      const taken = chosenIds();
      const filtered = allPlayers
        .filter((p) => !taken.has(p.id) && (!q || p.name.toLowerCase().includes(q)))
        .slice(0, 5);
      listEl.innerHTML = filtered.map((p) =>
        `<div class="pu-search-option" data-id="${p.id}" data-name="${esc(p.name)}">
          ${avatarHTML(p, 'em-opt-avatar')}
          <span class="em-opt-name">${esc(p.name)}</span>
          <span class="em-opt-rank">${rankText(p.id)}</span>
        </div>`,
      ).join('') || `<div class="pu-search-empty">No players found</div>`;
      listEl.style.display = 'block';
      listEl.querySelectorAll('.pu-search-option').forEach((opt) => {
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          hiddenEl.value = opt.dataset.id;
          searchEl.value = opt.dataset.name;
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

  const playerById = (id) => (id ? (allPlayers.find((p) => p.id === id) || (id === myId ? me : null)) : null);
  const sidePlayers = (side) => sideIds(side).map(playerById);
  // "You & Sofia Duarte" vs "Tom Beckett & Priya Raman"; before every slot is
  // filled, a plain placeholder.
  function sideName(side) {
    const ps = sidePlayers(side);
    if (ps.every(Boolean)) {
      const names = ps.map((p, i) => (side === 1 && i === 0 && !adminMode ? 'You' : p.name));
      return names.join(' & ');
    }
    if (side === 1) return adminMode ? 'Your team' : `${myName} & teammate`;
    return 'Opponents';
  }
  const sideFullNames = (side) => sidePlayers(side).map((p) => p?.name || '?').join(' & ');

  const CHECK_SVG = `<svg class="em-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`;
  const GAME_OPTIONS = [{ games: 0, caption: 'in three' }, { games: 1, caption: 'in four' }, { games: 2, caption: 'in five' }];

  function renderWinner() {
    const can = allChosen();
    document.getElementById('emWinnerHint').textContent =
      can ? '' : (adminMode ? 'Choose all four players first' : 'Pick your teammate and both opponents first');
    document.getElementById('emWinnerGrid').innerHTML = [1, 2].map((side) => {
      const sel = winner === side;
      const avatars = sidePlayers(side).map((p) => avatarHTML(p || { name: '?' }, 'em-winner-avatar')).join('');
      return `<button type="button" class="em-winner-card em-winner-card--pair${sel ? ' em-winner-card--selected' : ''}"
        data-slot="${side}"${can ? '' : ' disabled'}>
        <span class="em-side-avs">${avatars}</span>
        <span class="em-winner-name">${esc(sideName(side))}</span>
        ${sel ? CHECK_SVG : ''}
      </button>`;
    }).join('');
  }

  function renderGames() {
    const section = document.getElementById('emGamesSection');
    section.hidden = winner === null;
    if (winner === null) return;
    document.getElementById('emGamesHint').textContent = 'Winning pair’s games first';
    document.getElementById('emGamesGrid').innerHTML = GAME_OPTIONS.map((o) => {
      const sel = games === o.games;
      return `<button type="button" class="em-games-card${sel ? ' em-games-card--selected' : ''}" data-games="${o.games}">
        <span class="em-games-score">3–${o.games}</span>
        <span class="em-games-caption">${o.caption}</span>
      </button>`;
    }).join('');
  }

  const isComplete = () => allChosen() && winner !== null && games !== null;

  function renderConfirm() {
    const box = document.getElementById('emConfirm');
    box.hidden = !isComplete();
    if (box.hidden) return;
    const loser = winner === 1 ? 2 : 1;
    box.innerHTML = `${CHECK_SVG}<span class="em-confirm-text">${esc(sideFullNames(winner))} beat ${esc(sideFullNames(loser))} 3–${games}</span>`;
  }

  function renderFooter() {
    let note = '';
    if (!allChosen()) note = adminMode ? 'Choose all four players' : 'Choose your teammate and both opponents';
    else if (winner === null || games === null) note = 'Pick a winner and a scoreline';
    document.getElementById('emMissing').textContent = note;
    document.getElementById('puSubmit').disabled = !isComplete();
  }

  function update() { renderWinner(); renderGames(); renderConfirm(); renderFooter(); }
  function onPlayerChange() { winner = null; games = null; update(); }

  const selfRowHTML = adminMode ? '' : `
    <div class="em-self-card">
      ${avatarHTML(me || { name: myName }, 'em-self-avatar')}
      <span class="em-self-name">${esc(myName)}</span>
      <span class="em-you-chip">YOU</span>
    </div>`;

  document.getElementById('modalBody').innerHTML = `
    <div class="em-modal">
      <div class="em-section">
        <div class="em-label">Your team</div>
        ${selfRowHTML}
        ${SLOTS.filter((sl) => sl.side === 1).map(fieldHTML).join('')}
      </div>
      <div class="em-section">
        <div class="em-label">Opponents</div>
        ${SLOTS.filter((sl) => sl.side === 2).map(fieldHTML).join('')}
      </div>

      <div class="em-section">
        <div class="em-label-row">
          <span class="em-label">Who won?</span>
          <span class="em-hint" id="emWinnerHint"></span>
        </div>
        <div class="em-winner-grid" id="emWinnerGrid"></div>
      </div>

      <div class="em-section" id="emGamesSection" hidden>
        <div class="em-label-row">
          <span class="em-label">Games</span>
          <span class="em-hint" id="emGamesHint"></span>
        </div>
        <div class="em-games-grid" id="emGamesGrid"></div>
      </div>

      <div class="em-section em-date-section">
        <span class="em-label">Date played</span>
        <div class="em-date-controls">
          <button type="button" class="em-today-chip em-today-chip--active" id="emToday">Today</button>
          <input type="date" class="em-date-input" id="emDate" value="${todayISO}" max="${todayISO}">
        </div>
      </div>

      <div class="em-confirm" id="emConfirm" hidden></div>

      <div class="em-footer">
        <span class="em-missing" id="emMissing"></span>
        <div class="em-footer-btns">
          <button type="button" class="btn btn-ghost" id="emCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="puSubmit" disabled>Log match</button>
        </div>
      </div>
    </div>`;

  update();
  SLOTS.forEach((sl) => wireSearch(sl.id, onPlayerChange));

  document.getElementById('emWinnerGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.em-winner-card');
    if (!btn || btn.disabled) return;
    const side = Number(btn.dataset.slot);
    winner = winner === side ? null : side;
    update();
  });
  document.getElementById('emGamesGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.em-games-card');
    if (!btn) return;
    const g = Number(btn.dataset.games);
    games = games === g ? null : g;
    update();
  });

  const dateEl = document.getElementById('emDate');
  const todayChip = document.getElementById('emToday');
  function setDate(value) {
    playedOn = value || todayISO;
    dateEl.value = playedOn;
    todayChip.classList.toggle('em-today-chip--active', playedOn === todayISO);
  }
  dateEl.addEventListener('change', () => {
    let v = dateEl.value;
    if (!v) { setDate(todayISO); return; }
    if (v > todayISO) { toast('A match cannot be played in the future.', 'warning'); v = todayISO; } else if (seasonStart && v < seasonStart) {
      toast(`That date is before the ${seasonName} season started.`, 'warning');
      v = seasonStart;
    }
    setDate(v);
  });
  todayChip.addEventListener('click', () => setDate(todayISO));
  document.getElementById('emCancel').addEventListener('click', () => modal.close());

  window.api.getSeasons().then((seasons) => {
    const current = (seasons || []).find((s) => s.is_current);
    if (!current || !document.getElementById('emDate')) return;
    seasonStart = current.start_date;
    seasonName = current.name;
    document.getElementById('emDate').setAttribute('min', seasonStart);
  }).catch(() => {});

  document.getElementById('puSubmit').addEventListener('click', async () => {
    const team1 = sideIds(1), team2 = sideIds(2);
    if (!allChosen()) { toast('Please choose all four players.', 'warning'); return; }
    if (new Set([...team1, ...team2]).size !== 4) { toast('All four players must be different.', 'warning'); return; }
    if (winner === null || games === null) { toast('Please select a score.', 'warning'); return; }
    const btn = document.getElementById('puSubmit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      await window.api.logDoublesMatch({
        team1, team2,
        team1Score: winner === 1 ? 3 : games,
        team2Score: winner === 1 ? games : 3,
        ...(playedOn !== todayISO ? { playedOn } : {}),
      });
      toast('Doubles match recorded', 'success');
      modal.close();
      if (state.page === 'ladder') window.renderLadder();
      else if (state.page === 'dashboard') window.renderDashboard();
    } catch (err) {
      toast(err.message || 'Failed to log match', 'error');
      btn.disabled = false;
      btn.textContent = 'Log match';
    }
  });
}

// onclick attributes in page markup reach these as globals.
window.openPickupGameModal = openPickupGameModal;
