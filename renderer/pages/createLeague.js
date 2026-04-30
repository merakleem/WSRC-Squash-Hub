import { state, isAdmin } from '../state.js';
import { esc, formatDate, toast, modal } from '../utils.js';

// ===== CREATE LEAGUE WIZARD =====
export function startCreateLeague() {
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
    selectedCourtIds: [],
    matchDuration: 45,
    matchBuffer: 15,
  };
  window.navigate('createLeague');
}

function defaultStartDate() {
  const d = new Date();
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7)); // next Monday
  return d.toISOString().split('T')[0];
}

export function renderCreateLeague() {
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
  const { modernNumDivisions, numRounds, matchStartTime, selectedCourtIds, matchDuration, matchBuffer } = state.wizard;
  const allCourts = await window.api.getCourts();
  const maxDivs = Math.floor(n / 2);
  const isValid = modernNumDivisions >= 1 && modernNumDivisions <= maxDivs;

  const numCourts = selectedCourtIds.length;

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
          <label>Courts</label>
          ${allCourts.length === 0
            ? `<p class="text-muted" style="font-size:12px;margin-top:4px">No courts set up. <a href="#" onclick="navigate('clubSettings');return false">Add courts in Club Settings</a> first.</p>`
            : `<div class="court-picker">${allCourts.map((c) => `
                <label class="court-pick-item">
                  <input type="checkbox" class="wCourtCheck" value="${c.id}" ${selectedCourtIds.includes(c.id) ? 'checked' : ''}>
                  ${esc(c.name)}
                </label>`).join('')}
              </div>`
          }
        </div>
        <div class="form-group">
          <label>Match Duration <span class="form-hint">(minutes)</span></label>
          <input class="form-control" id="wDuration" type="number" min="1" value="${matchDuration}">
        </div>
        <div class="form-group">
          <label>Buffer Between Matches <span class="form-hint">(minutes)</span></label>
          <input class="form-control" id="wBuffer" type="number" min="0" value="${matchBuffer}">
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
    state.wizard.modernDivisionPlayers = null;
    state.wizard.step = 4;
    renderCreateLeague();
  });

  function applyModernSettings() {
    state.wizard.modernNumDivisions = Math.max(1, Number(document.getElementById('wModernDivs').value) || 1);
    state.wizard.numRounds = Math.max(1, Number(document.getElementById('wRounds').value) || 1);
    state.wizard.matchStartTime = document.getElementById('wStartTime').value;
    state.wizard.selectedCourtIds = [...document.querySelectorAll('.wCourtCheck:checked')].map((el) => Number(el.value));
    state.wizard.matchDuration = Math.max(1, Number(document.getElementById('wDuration').value) || 1);
    state.wizard.matchBuffer = Math.max(0, Number(document.getElementById('wBuffer').value) || 0);
    state.wizard.modernDivisionPlayers = null;
    renderCreateLeague();
  }

  document.getElementById('wApply').addEventListener('click', applyModernSettings);
}

async function renderStep3Traditional() {
  const n = state.wizard.rankedPlayers.length;
  const { numTeams, numRounds, matchStartTime, selectedCourtIds, matchDuration, matchBuffer } = state.wizard;
  const [configs, allCourts] = await Promise.all([window.api.getValidConfigs(n), window.api.getCourts()]);
  const numCourts = selectedCourtIds.length;

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
          <label>Courts</label>
          ${allCourts.length === 0
            ? `<p class="text-muted" style="font-size:12px;margin-top:4px">No courts set up. <a href="#" onclick="navigate('clubSettings');return false">Add courts in Club Settings</a> first.</p>`
            : `<div class="court-picker">${allCourts.map((c) => `
                <label class="court-pick-item">
                  <input type="checkbox" class="wCourtCheck" value="${c.id}" ${selectedCourtIds.includes(c.id) ? 'checked' : ''}>
                  ${esc(c.name)}
                </label>`).join('')}
              </div>`
          }
        </div>
        <div class="form-group">
          <label>Match Duration <span class="form-hint">(minutes)</span></label>
          <input class="form-control" id="wDuration" type="number" min="1" value="${matchDuration}">
        </div>
        <div class="form-group">
          <label>Buffer Between Matches <span class="form-hint">(minutes)</span></label>
          <input class="form-control" id="wBuffer" type="number" min="0" value="${matchBuffer}">
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
    state.wizard.selectedCourtIds = [...document.querySelectorAll('.wCourtCheck:checked')].map((el) => Number(el.value));
    state.wizard.matchDuration = Math.max(1, Number(document.getElementById('wDuration').value) || 1);
    state.wizard.matchBuffer = Math.max(0, Number(document.getElementById('wBuffer').value) || 0);
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
          matchStartTime, selectedCourtIds, matchDuration, matchBuffer } = state.wizard;

  let payload;
  if (setupType === 'modern') {
    payload = {
      name: leagueName, startDate, setup_type: 'modern',
      numRounds, blackoutDates, matchStartTime, courtIds: selectedCourtIds, matchDuration, matchBuffer,
      divisions: state.wizard.modernDivisionPlayers.map((divPlayers, dIdx) =>
        divPlayers.map((p, pIdx) => ({ playerId: p.id, rank: dIdx * 1000 + pIdx + 1 }))
      ),
    };
  } else {
    const { rankedPlayers, numTeams, numDivisions, teamNames } = state.wizard;
    payload = {
      name: leagueName, startDate, setup_type: 'traditional',
      numTeams, numDivisions, numRounds, blackoutDates, teamNames,
      matchStartTime, courtIds: selectedCourtIds, matchDuration, matchBuffer,
      rankedPlayers: rankedPlayers.map((p, i) => ({ playerId: p.id, rank: i + 1 })),
    };
  }

  try {
    const leagueId = await window.api.createLeague(payload);
    toast(`League "${leagueName}" created!`, 'success');
    const league = await window.api.getLeague(leagueId);
    window.navigate('leagueDetail', { league });
  } catch (e) {
    document.getElementById('wError').textContent = e.message || 'Failed to create league.';
    btn.disabled = false;
    btn.textContent = 'Create League';
  }
}
