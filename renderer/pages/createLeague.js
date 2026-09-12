import { state, isAdmin } from '../state.js';
import { esc, formatDate, toast, modal, avatarHTML } from '../utils.js';

// ===== CREATE LEAGUE WIZARD =====
// Five steps: League info → Add players → Structure → Blackout dates → Preview.
// The wizard builds state.wizard as it goes and posts it once at the end via
// submitCreateLeague() — nothing is saved before Create league is pressed.
// Structure numbers recalculate live as fields change; there is no Apply step.
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
    // Doubles: [playerId|null, playerId|null] per pair, in the order made.
    pairs: [],
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

const STEP_LABELS = ['League info', 'Add players', 'Structure', 'Blackout dates', 'Preview'];

// An error queued by a step jump, shown once the target step has rendered
// (steps 2 and 3 render async, so it can't be written straight away).
let _pendingError = '';

function _err(msg) {
  const el = document.getElementById('wError');
  if (el) el.textContent = msg;
}

function _flushError() {
  if (!_pendingError) return;
  _err(_pendingError);
  _pendingError = '';
}

function _fmtShort(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _fmtLong(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

const _isDoubles = () => state.wizard.setupType === 'doubles';
const _surname = (name) => String(name || '').trim().split(/\s+/).pop() || '';
const _pairLabel = (pr) => `${_surname(pr.a?.name)} & ${_surname(pr.b?.name)}`;

/**
 * The doubles pairs as the structure steps see them: only complete pairs,
 * seeded by their best (lowest) ladder rank and numbered in that order.
 * Player objects come from state.players; the ladder decides the seed.
 */
function _seededPairs() {
  const w = state.wizard;
  const byId = (id) => state.players.find((p) => p.id === id) || null;
  const ladderOrder = state.ladder.map((p) => p.id);
  const rankOf = (id) => { const i = ladderOrder.indexOf(id); return i === -1 ? Infinity : i + 1; };
  return (w.pairs || [])
    .filter((pr) => pr[0] && pr[1])
    .map((pr) => {
      const a = byId(pr[0]) || { id: pr[0], name: '' };
      const b = byId(pr[1]) || { id: pr[1], name: '' };
      return { a, b, bestRank: Math.min(rankOf(a.id), rankOf(b.id)) };
    })
    .sort((x, y) => x.bestRank - y.bestRank)
    .map((pr, i) => ({ ...pr, seed: i + 1, name: _pairLabel(pr) }));
}

// The derived structure numbers every step shares: validity, divisions,
// weeks per round and total weeks. Same arithmetic the old steps 3 and 4
// each computed for themselves. For doubles the unit is the complete pair.
function _calc() {
  const w = state.wizard;
  if (_isDoubles()) {
    const pairs = _seededPairs().length;
    const incomplete = (w.pairs || []).filter((pr) => !(pr[0] && pr[1])).length;
    const maxDivs = Math.max(1, Math.floor(pairs / 2));
    const valid = incomplete === 0 && pairs >= 2 && w.modernNumDivisions >= 1 && w.modernNumDivisions <= Math.floor(pairs / 2);
    const maxSize = valid ? Math.ceil(pairs / w.modernNumDivisions) : null;
    const base = valid ? (maxSize % 2 === 0 ? maxSize - 1 : maxSize) : null;
    return { n: pairs, players: pairs * 2, incomplete, valid, divisions: w.modernNumDivisions, maxDivs, base, weeks: valid ? base * w.numRounds : null };
  }
  const n = w.rankedPlayers.length;
  if (w.setupType === 'traditional') {
    const valid = w.numTeams >= 2 && n > 0 && n % w.numTeams === 0;
    const divisions = valid ? n / w.numTeams : null;
    const base = valid ? (w.numTeams % 2 === 0 ? w.numTeams - 1 : w.numTeams) : null;
    return { n, valid, teams: w.numTeams, divisions, base, weeks: valid ? base * w.numRounds : null };
  }
  const maxDivs = Math.max(1, Math.floor(n / 2));
  const valid = n >= 2 && w.modernNumDivisions >= 1 && w.modernNumDivisions <= Math.floor(n / 2);
  const maxSize = valid ? Math.ceil(n / w.modernNumDivisions) : null;
  const base = valid ? (maxSize % 2 === 0 ? maxSize - 1 : maxSize) : null;
  return { n, valid, divisions: w.modernNumDivisions, maxDivs, base, weeks: valid ? base * w.numRounds : null };
}

// Even-split division sizes for a modern league (mirror of distributePlayersEvenly).
function _divSizes(n, numDivisions) {
  return Array.from({ length: numDivisions || 0 }, (_, i) =>
    Math.floor(n / numDivisions) + (i < n % numDivisions ? 1 : 0));
}

function _weekDates(count) {
  const skip = new Set(state.wizard.blackoutDates);
  const out = [];
  let cur = state.wizard.startDate;
  for (let i = 0; i < count; i++) {
    while (skip.has(cur)) cur = addDaysPreview(cur, 7);
    out.push(cur);
    cur = addDaysPreview(cur, 7);
  }
  return out;
}

function _summaryHTML() {
  const w = state.wizard;
  const c = _calc();
  const teams = w.setupType === 'traditional';
  const doubles = _isDoubles();
  const cell = (label, value, { desk = false } = {}) => `
    <div class="wz-sum-cell${desk ? ' wz-sum-cell--desk' : ''}">
      <span class="wz-sum-label">${label}</span>
      <span class="wz-sum-val${value === '—' ? ' wz-sum-val--dash' : ''}">${value}</span>
    </div>`;
  return [
    cell('League', esc(w.leagueName.trim()) || 'Untitled', { desk: true }),
    cell('Starts', _fmtShort(w.startDate), { desk: true }),
    cell('Format', doubles ? 'Doubles' : teams ? 'Teams' : 'Divisions only', { desk: true }),
    doubles ? cell('Players', `${c.players} · ${c.n} pairs`, { desk: true }) : cell('Players', String(c.n)),
    ...(doubles ? [cell('Pairs', String(c.n))] : []),
    cell(teams ? 'Teams × divs' : 'Divisions', c.valid ? (teams ? `${c.teams} × ${c.divisions}` : String(c.divisions)) : '—'),
    cell('Weeks', c.weeks ? String(c.weeks) : '—'),
  ].join('');
}

// Step navigation, used by the footer buttons and the clickable stepper.
// Forward jumps get the same guards Next applies: step 1 must have a name and
// date, past step 2 needs at least 2 players, past step 3 a valid structure.
function _goToStep(target) {
  const w = state.wizard;
  target = Math.max(1, Math.min(5, target));
  if (target === w.step) return;

  if (target > w.step) {
    if (w.step === 1) {
      const name = (document.getElementById('wName')?.value ?? w.leagueName).trim();
      const date = document.getElementById('wDate')?.value ?? w.startDate;
      if (!name) { _err('League name is required.'); return; }
      if (!date) { _err('Start date is required.'); return; }
      w.leagueName = name;
      w.startDate = date;
    }
    if (target > 2 && _isDoubles()) {
      const c = _calc();
      const guard = c.incomplete > 0 ? 'Every pair needs 2 players.' : c.n < 2 ? 'Add at least 2 pairs.' : '';
      if (guard) {
        _pendingError = guard;
        w.step = 2;
        renderCreateLeague();
        return;
      }
    } else if (target > 2 && w.rankedPlayers.length < 2) {
      _pendingError = 'Select at least 2 players.';
      w.step = 2;
      renderCreateLeague();
      return;
    }
    if (target > 3) {
      const c = _calc();
      if (!c.valid) {
        _pendingError = 'Fix the structure before continuing.';
        w.step = 3;
        renderCreateLeague();
        return;
      }
      if (w.step <= 3) {
        // Leaving step 3 forward commits the derived numbers, as Next always has.
        if (w.setupType === 'traditional') w.numDivisions = c.divisions;
        else w.modernDivisionPlayers = null;
      }
    }
  }

  w.step = target;
  renderCreateLeague();
}

export function renderCreateLeague() {
  document.getElementById('pageTitle').textContent = 'New League';
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.getElementById('mainContent');

  const s = state.wizard.step;
  const stepsHTML = STEP_LABELS.map((label, i) => {
    const num = i + 1;
    const done = num < s;
    const active = num === s;
    return `
      <div class="wz-step${done ? ' wz-step--done' : ''}${active ? ' wz-step--on' : ''}" data-step="${num}">
        <div class="wz-step-row">
          <span class="wz-line${i === 0 ? ' wz-line--none' : num <= s ? ' wz-line--fill' : ''}"></span>
          <button class="wz-dot" type="button">${done ? '&#10003;' : num}</button>
          <span class="wz-line${i === STEP_LABELS.length - 1 ? ' wz-line--none' : done ? ' wz-line--fill' : ''}"></span>
        </div>
        <span class="wz-step-label">${label}</span>
      </div>`;
  }).join('');

  content.innerHTML = `
    <div class="wz-page">
      <div class="wz-stepcard">
        <div class="wz-steps">${stepsHTML}</div>
        <div class="wz-mtitle">
          <span class="wz-mtitle-name">${STEP_LABELS[s - 1]}</span>
          <span class="wz-mtitle-n">Step ${s} of 5</span>
        </div>
        <div class="wz-summary" id="wzSummary">${_summaryHTML()}</div>
      </div>
      <div id="wizardCard"></div>
    </div>`;

  content.querySelector('.wz-steps').addEventListener('click', (e) => {
    const step = e.target.closest('.wz-step')?.dataset.step;
    if (step) _goToStep(Number(step));
  });

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

function _footerHTML({ cancel = false, nextDisabled = false } = {}) {
  return `
    <div class="wz-foot">
      <span id="wError" class="wz-foot-err"></span>
      <span class="wz-foot-btns">
        ${cancel
          ? '<button class="btn btn-outline" id="wCancel">Cancel</button>'
          : '<button class="btn btn-outline" id="wBack">Back</button>'}
        <button class="btn btn-primary" id="wNext"${nextDisabled ? ' disabled' : ''}>Next</button>
      </span>
    </div>`;
}

// Step 1 — League information + format
function renderStep1() {
  const w = state.wizard;

  const formatCard = (type, title, tag, desc, chips) => {
    const on = w.setupType === type;
    return `
      <div class="wz-format${on ? ' wz-format--on' : ''}" data-type="${type}">
        <div class="wz-format-top">
          <span class="wz-radio"><span></span></span>
          <span class="wz-format-title">${title}</span>
          ${tag ? `<span class="wz-format-tag">${tag}</span>` : ''}
        </div>
        <span class="wz-format-desc">${desc}</span>
        <div class="wz-format-chips">${chips.map((c) => `<span class="wz-chip">${c}</span>`).join('')}</div>
      </div>`;
  };

  document.getElementById('wizardCard').innerHTML = `
    <div class="wz-card">
      <div class="wz-head">
        <div>
          <div class="wz-title">League information</div>
          <div class="wz-sub">Name it, pick a start date, and choose how players are grouped.</div>
        </div>
      </div>
      <div class="wz-body">
        <div class="wz-row1">
          <div class="wz-field">
            <span class="wz-label">League name</span>
            <input class="wz-input" id="wName" value="${esc(w.leagueName)}" placeholder="e.g. Fall 2026 League" autofocus>
          </div>
          <div class="wz-field">
            <span class="wz-label">Start date</span>
            <input class="wz-input" id="wDate" type="date" value="${esc(w.startDate)}">
          </div>
        </div>
        <div class="wz-field">
          <span class="wz-label">Format</span>
          <div class="wz-formats wz-formats--3">
            ${formatCard('traditional', 'Teams', 'Current default',
              'Players are grouped into teams. Teams play each other each week, with one match per division.',
              ['Team standings', 'One night, one opponent'])}
            ${formatCard('modern', 'No teams', '',
              'No teams. Players are grouped into divisions and play everyone in their division (round robin).',
              ['Division standings', 'Round robin'])}
            ${formatCard('doubles', 'Doubles', 'New',
              'Players are paired up, then pairs are grouped into divisions and play 2v2 round robin on a doubles court.',
              ['2v2', 'Pair standings', 'Round robin'])}
          </div>
        </div>
      </div>
      ${_footerHTML({ cancel: true })}
    </div>`;

  // Name and date feed the summary strip live; Next still validates them.
  document.getElementById('wName').addEventListener('input', (e) => {
    state.wizard.leagueName = e.target.value;
    document.getElementById('wzSummary').innerHTML = _summaryHTML();
    _err('');
  });
  document.getElementById('wDate').addEventListener('input', (e) => {
    if (e.target.value) state.wizard.startDate = e.target.value;
    document.getElementById('wzSummary').innerHTML = _summaryHTML();
    _err('');
  });

  document.getElementById('wizardCard').querySelectorAll('.wz-format').forEach((card) => {
    card.addEventListener('click', () => {
      const next = card.dataset.type;
      // Doubles holds pairs where the other two hold a ranked list, so moving
      // between them starts the player step over.
      if ((next === 'doubles') !== (state.wizard.setupType === 'doubles')) {
        state.wizard.rankedPlayers = [];
        state.wizard.pairs = [];
        state.wizard.modernDivisionPlayers = null;
      }
      state.wizard.setupType = next;
      renderCreateLeague();
    });
  });

  document.getElementById('wCancel').addEventListener('click', () => window.navigate('leagues'));
  document.getElementById('wNext').addEventListener('click', () => _goToStep(2));
  _flushError();
}

// Step 2 — Add players (order is determined by the Ladder)
async function renderStep2() {
  // Load ladder (source of truth for skill ranking)
  if (!state.ladder.length) state.ladder = await window.api.getLadder();
  const ladderOrder = state.ladder.map((p) => p.id);

  const allPlayers = state.players.length ? state.players : await window.api.getPlayers();
  state.players = allPlayers;

  if (_isDoubles()) return renderStep2Doubles({ allPlayers, ladderOrder });

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

  const ladderSort = () => {
    state.wizard.rankedPlayers.sort((a, b) => {
      const ai = ladderOrder.indexOf(a.id);
      const bi = ladderOrder.indexOf(b.id);
      return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
    });
  };

  const query = () => document.getElementById('playerSearch')?.value || '';
  const filteredAvailable = () => {
    const q = query().trim().toLowerCase();
    return buildAvailable().filter((p) => !q || p.name.toLowerCase().includes(q));
  };

  function renderAvailableList() {
    const filtered = filteredAvailable();
    const el = document.getElementById('availableList');
    if (!el) return;
    el.innerHTML = filtered.length === 0
      ? `<div class="wz-lempty">
          <span class="wz-lempty-t">${buildAvailable().length === 0 ? 'Every club player is in' : 'No players match'}</span>
        </div>`
      : filtered.map((p) => {
          const li = ladderOrder.indexOf(p.id);
          return `
            <div class="wz-prow" data-action="add-player" data-id="${p.id}" data-name="${esc(p.name)}">
              ${avatarHTML(p, 'wz-avatar')}
              <span class="wz-pname">${esc(p.name)}</span>
              <span class="wz-prank">${li === -1 ? '' : `#${li + 1}`}</span>
              <button class="wz-pbtn" type="button" tabindex="-1">+</button>
            </div>`;
        }).join('');
  }

  function renderSelectedList() {
    const el = document.getElementById('rankedList');
    if (!el) return;
    el.innerHTML = state.wizard.rankedPlayers.length === 0
      ? `<div class="wz-lempty">
          <span class="wz-lempty-t">No players yet</span>
          <span class="wz-lempty-s">Click a name on the left to add them.</span>
        </div>`
      : state.wizard.rankedPlayers.map((p, i) => `
          <div class="wz-prow wz-prow--sel">
            <span class="wz-seed">${i + 1}</span>
            ${avatarHTML(p, 'wz-avatar wz-avatar--navy')}
            <span class="wz-pname">${esc(p.name)}</span>
            <button class="wz-pbtn" data-action="remove-player" data-idx="${i}" aria-label="Remove">&times;</button>
          </div>`).join('');
  }

  // One refresh for anything a pick changes: both lists, the counts, the
  // ghost-button states and the summary strip — the search box is left alone.
  function refresh() {
    renderAvailableList();
    renderSelectedList();
    document.getElementById('wzSelChip').textContent = `${state.wizard.rankedPlayers.length} selected`;
    document.getElementById('wzAvailN').textContent = `${buildAvailable().length} available`;
    document.getElementById('wzAddAll').disabled = filteredAvailable().length === 0;
    document.getElementById('wzClear').disabled = state.wizard.rankedPlayers.length === 0;
    document.getElementById('wzSummary').innerHTML = _summaryHTML();
    _err('');
  }

  document.getElementById('wizardCard').innerHTML = `
    <div class="wz-card">
      <div class="wz-head">
        <div>
          <div class="wz-title">Add players</div>
          <div class="wz-sub">Seeding follows the ladder automatically. No dragging needed.</div>
        </div>
        <span class="wz-selchip" id="wzSelChip">${state.wizard.rankedPlayers.length} selected</span>
      </div>

      <div class="wz-cols">
        <div class="wz-pickcol">
          <div class="wz-colhead">
            <div class="wz-colhead-row">
              <span class="wz-label">Club players</span>
              <span class="wz-hint" id="wzAvailN">${buildAvailable().length} available</span>
              <button class="wz-ghost" id="wzAddAll"${buildAvailable().length === 0 ? ' disabled' : ''}>Add all</button>
            </div>
            <input class="wz-input wz-search" id="playerSearch" placeholder="Search players…" autocomplete="off">
          </div>
          <div class="wz-plist" id="availableList"></div>
        </div>

        <div class="wz-pickcol">
          <div class="wz-colhead wz-colhead--sel">
            <span class="wz-label">In this league</span>
            <span class="wz-hint">ladder order</span>
            <button class="wz-ghost" id="wzClear"${state.wizard.rankedPlayers.length === 0 ? ' disabled' : ''}>Clear</button>
          </div>
          <div class="wz-plist wz-plist--sel" id="rankedList"></div>
        </div>
      </div>

      ${_footerHTML()}
    </div>`;

  renderAvailableList();
  renderSelectedList();

  document.getElementById('playerSearch').addEventListener('input', () => {
    renderAvailableList();
    document.getElementById('wzAddAll').disabled = filteredAvailable().length === 0;
  });

  document.getElementById('wzAddAll').addEventListener('click', () => {
    const remaining = buildAvailable();
    if (!remaining.length) return;
    remaining.forEach((p) => state.wizard.rankedPlayers.push({ id: p.id, name: p.name }));
    ladderSort();
    refresh();
  });

  document.getElementById('wzClear').addEventListener('click', () => {
    if (!state.wizard.rankedPlayers.length) return;
    state.wizard.rankedPlayers = [];
    refresh();
  });

  document.getElementById('wBack').addEventListener('click', () => _goToStep(1));
  document.getElementById('wNext').addEventListener('click', () => _goToStep(3));

  document.getElementById('wizardCard').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'add-player') {
      const el = e.target.closest('[data-action]');
      state.wizard.rankedPlayers.push({ id: Number(el.dataset.id), name: el.dataset.name });
      ladderSort();
      refresh();
    } else if (action === 'remove-player') {
      const idx = Number(e.target.closest('[data-action]').dataset.idx);
      state.wizard.rankedPlayers.splice(idx, 1);
      refresh();
    }
  });
  _flushError();
}

// Step 2, doubles — the pair builder. The left column is the same club list;
// the right column holds pair cards. A click fills the first open slot, or
// starts a new pair. Complete pairs seed by their best ladder rank; a pair
// still needing a partner sits at the bottom.
function renderStep2Doubles({ allPlayers, ladderOrder }) {
  const w = state.wizard;
  w.pairs = w.pairs || [];
  const byId = (id) => allPlayers.find((p) => p.id === id) || null;
  const rankOf = (id) => { const i = ladderOrder.indexOf(id); return i === -1 ? Infinity : i + 1; };

  const inPairs = () => new Set(w.pairs.flat().filter(Boolean));
  const buildAvailable = () => {
    const taken = inPairs();
    const list = ladderOrder.map(byId).filter((p) => p && !taken.has(p.id));
    allPlayers.forEach((p) => { if (!taken.has(p.id) && !ladderOrder.includes(p.id)) list.push(p); });
    return list;
  };
  const query = () => document.getElementById('playerSearch')?.value || '';
  const filteredAvailable = () => {
    const q = query().trim().toLowerCase();
    return buildAvailable().filter((p) => !q || p.name.toLowerCase().includes(q));
  };

  // Display order: complete pairs by best rank, numbered; incomplete last.
  const orderedPairs = () => {
    const complete = w.pairs.filter((pr) => pr[0] && pr[1])
      .map((pr) => ({ pr, best: Math.min(rankOf(pr[0]), rankOf(pr[1])) }))
      .sort((x, y) => x.best - y.best)
      .map((x) => x.pr);
    const open = w.pairs.filter((pr) => !(pr[0] && pr[1]));
    return [...complete, ...open];
  };
  const counts = () => {
    const complete = w.pairs.filter((pr) => pr[0] && pr[1]).length;
    const players = w.pairs.flat().filter(Boolean).length;
    return { complete, players };
  };

  const addPlayer = (id) => {
    const open = w.pairs.find((pr) => !(pr[0] && pr[1]));
    if (open) { if (!open[0]) open[0] = id; else open[1] = id; }
    else w.pairs.push([id, null]);
  };
  const removePlayer = (id) => {
    const pr = w.pairs.find((x) => x[0] === id || x[1] === id);
    if (!pr) return;
    if (pr[0] === id) pr[0] = null; else pr[1] = null;
    if (!pr[0] && !pr[1]) w.pairs.splice(w.pairs.indexOf(pr), 1);
    w.modernDivisionPlayers = null;
  };

  function renderAvailableList() {
    const filtered = filteredAvailable();
    const el = document.getElementById('availableList');
    if (!el) return;
    el.innerHTML = filtered.length === 0
      ? `<div class="wz-lempty">
          <span class="wz-lempty-t">${buildAvailable().length === 0 ? 'Every club player is in' : 'No players match'}</span>
        </div>`
      : filtered.map((p) => {
          const li = ladderOrder.indexOf(p.id);
          return `
            <div class="wz-prow" data-action="add-player" data-id="${p.id}" data-name="${esc(p.name)}">
              ${avatarHTML(p, 'wz-avatar')}
              <span class="wz-pname">${esc(p.name)}</span>
              <span class="wz-prank">${li === -1 ? '' : `#${li + 1}`}</span>
              <button class="wz-pbtn" type="button" tabindex="-1">+</button>
            </div>`;
        }).join('');
  }

  const slotHTML = (id) => (id ? `
      <div class="wz-pair-slot">
        ${avatarHTML(byId(id) || { name: '' }, 'wz-avatar wz-avatar--navy wz-avatar--sm')}
        <span class="wz-pname">${esc(byId(id)?.name || '')}</span>
        <button class="wz-pbtn wz-pair-x" data-action="remove-pair-player" data-id="${id}" aria-label="Remove">&times;</button>
      </div>` : `
      <div class="wz-pair-slot wz-pair-slot--open">
        <span class="wz-pair-add">+</span>
        <span class="wz-pair-ph">Add a partner</span>
      </div>`);

  function renderPairList() {
    const el = document.getElementById('rankedList');
    if (!el) return;
    const ordered = orderedPairs();
    let seed = 0;
    el.innerHTML = ordered.length === 0
      ? `<div class="wz-lempty">
          <span class="wz-lempty-t">No pairs yet</span>
          <span class="wz-lempty-s">Click two names on the left to form the first pair.</span>
        </div>`
      : ordered.map((pr) => {
          const complete = pr[0] && pr[1];
          if (complete) seed++;
          return `
            <div class="wz-pair${complete ? '' : ' wz-pair--open'}">
              <div class="wz-pair-head">
                <span class="wz-pair-seed">${complete ? seed : ''}</span>
                <span class="wz-pair-n">Pair ${complete ? seed : ordered.indexOf(pr) + 1}</span>
                ${complete ? '' : '<span class="wz-pair-need">Needs a partner</span>'}
              </div>
              ${slotHTML(pr[0])}${slotHTML(pr[1])}
            </div>`;
        }).join('');
  }

  function refresh() {
    renderAvailableList();
    renderPairList();
    const { complete, players } = counts();
    document.getElementById('wzSelChip').textContent = `${complete} pair${complete === 1 ? '' : 's'} · ${players} player${players === 1 ? '' : 's'}`;
    document.getElementById('wzAvailN').textContent = `${buildAvailable().length} available`;
    document.getElementById('wzAddAll').disabled = filteredAvailable().length === 0;
    document.getElementById('wzClear').disabled = w.pairs.length === 0;
    document.getElementById('wzSummary').innerHTML = _summaryHTML();
    // Next is shown but dimmed while a pair is incomplete; the guard explains.
    document.getElementById('wNext').classList.toggle('wz-next--dim', _calc().incomplete > 0);
    _err('');
  }

  const { complete, players } = counts();
  document.getElementById('wizardCard').innerHTML = `
    <div class="wz-card">
      <div class="wz-head">
        <div>
          <div class="wz-title">Add players</div>
          <div class="wz-sub">Tap two players to make a pair. Pairs seed by their best ladder rank.</div>
        </div>
        <span class="wz-selchip" id="wzSelChip">${complete} pair${complete === 1 ? '' : 's'} · ${players} player${players === 1 ? '' : 's'}</span>
      </div>

      <div class="wz-cols">
        <div class="wz-pickcol">
          <div class="wz-colhead">
            <div class="wz-colhead-row">
              <span class="wz-label">Club players</span>
              <span class="wz-hint" id="wzAvailN">${buildAvailable().length} available</span>
              <button class="wz-ghost" id="wzAddAll"${buildAvailable().length === 0 ? ' disabled' : ''}>Add all</button>
            </div>
            <input class="wz-input wz-search" id="playerSearch" placeholder="Search players…" autocomplete="off">
          </div>
          <div class="wz-plist" id="availableList"></div>
        </div>

        <div class="wz-pickcol">
          <div class="wz-colhead wz-colhead--sel">
            <span class="wz-label">In this league</span>
            <span class="wz-hint">pair order</span>
            <button class="wz-ghost" id="wzClear"${w.pairs.length === 0 ? ' disabled' : ''}>Clear</button>
          </div>
          <div class="wz-plist wz-plist--sel wz-plist--pairs" id="rankedList"></div>
        </div>
      </div>

      ${_footerHTML()}
    </div>`;

  renderAvailableList();
  renderPairList();
  document.getElementById('wNext').classList.toggle('wz-next--dim', _calc().incomplete > 0);

  document.getElementById('playerSearch').addEventListener('input', () => {
    renderAvailableList();
    document.getElementById('wzAddAll').disabled = filteredAvailable().length === 0;
  });
  // Add all pairs the remaining players in ladder order, two at a time; an odd
  // count leaves one pair waiting for a partner.
  document.getElementById('wzAddAll').addEventListener('click', () => {
    const remaining = buildAvailable();
    if (!remaining.length) return;
    remaining.forEach((p) => addPlayer(p.id));
    w.modernDivisionPlayers = null;
    refresh();
  });
  document.getElementById('wzClear').addEventListener('click', () => {
    if (!w.pairs.length) return;
    w.pairs = [];
    w.modernDivisionPlayers = null;
    refresh();
  });
  document.getElementById('wBack').addEventListener('click', () => _goToStep(1));
  document.getElementById('wNext').addEventListener('click', () => _goToStep(3));

  document.getElementById('wizardCard').addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'add-player') { addPlayer(Number(el.dataset.id)); w.modernDivisionPlayers = null; refresh(); }
    else if (el.dataset.action === 'remove-pair-player') { removePlayer(Number(el.dataset.id)); refresh(); }
  });
  _flushError();
}

// Step 3 — Structure (dispatches based on setupType)
async function renderStep3() {
  if (_isDoubles()) return renderStep3Doubles();
  if (state.wizard.setupType === 'modern') return renderStep3Modern();
  return renderStep3Traditional();
}

function _numCtlHTML(ctl, val) {
  return `
    <div class="wz-num">
      <button class="wz-num-btn" type="button" data-ctl="${ctl}-dec">&minus;</button>
      <span class="wz-num-val">${val}</span>
      <button class="wz-num-btn" type="button" data-ctl="${ctl}-inc">+</button>
    </div>`;
}

function _presetsHTML(values, current) {
  return `<div class="wz-presets">${values.map((v) => `
    <button class="wz-preset${v === current ? ' wz-preset--on' : ''}" type="button" data-preset="${v}">${v}</button>`).join('')}
  </div>`;
}

function _calcCardHTML(configs) {
  const w = state.wizard;
  const c = _calc();
  let label, text, chips = [];
  if (w.setupType === 'traditional') {
    if (c.valid) {
      label = 'Checks out';
      text = `${c.teams} teams &times; ${c.divisions} divisions = ${c.n} players`;
      chips = Array.from({ length: c.divisions }, (_, i) => `Div ${i + 1}: ${c.teams}`);
    } else {
      label = 'Doesn&rsquo;t divide evenly';
      text = nearestConfigWarning(c.n, configs, 'teams', w.numTeams);
    }
  } else if (_isDoubles()) {
    if (c.valid) {
      label = 'Distribution';
      text = `${c.divisions} divisions from ${c.n} pairs`;
      chips = _divSizes(c.n, c.divisions).map((sz, i) => `Div ${i + 1}: ${sz}`);
    } else {
      label = 'Too many divisions';
      text = `Max ${c.maxDivs} divisions with ${c.n} pairs &mdash; each needs at least 2.`;
    }
  } else if (c.valid) {
    label = 'Distribution';
    text = `${c.divisions} divisions from ${c.n} players`;
    chips = _divSizes(c.n, c.divisions).map((sz, i) => `Div ${i + 1}: ${sz}`);
  } else {
    label = 'Too many divisions';
    text = `Can't create ${w.modernNumDivisions} divisions with ${c.n} players. Each division needs at least 2 players.`;
  }
  return `
    <div class="wz-calc ${c.valid ? 'wz-calc--ok' : 'wz-calc--warn'}">
      <span class="wz-calc-label">${label}</span>
      <span class="wz-calc-text">${text}</span>
      ${chips.length ? `<div class="wz-distchips">${chips.map((t) => `<span class="wz-distchip">${t}</span>`).join('')}</div>` : ''}
    </div>`;
}

function _weeksLineText() {
  const c = _calc();
  return c.valid ? `${c.base} weeks &times; ${state.wizard.numRounds} = ${c.weeks} total weeks` : 'Set a valid structure first';
}

// Same late-finish arithmetic the old step 3 used: matches a week, stacked
// across the selected courts, flagged when the last one runs past 9 PM.
function _nightText(anyCourts) {
  const w = state.wizard;
  const c = _calc();
  const numCourts = w.selectedCourtIds.length;
  if (c.valid && numCourts >= 1 && w.matchStartTime) {
    const perWeek = w.setupType === 'traditional'
      ? Math.floor(c.teams / 2) * c.divisions
      : _divSizes(c.n, c.divisions).reduce((a, sz) => a + Math.floor(sz / 2), 0);
    const slots = Math.ceil(perWeek / numCourts);
    const totalMins = slots * (w.matchDuration + w.matchBuffer);
    const [sh, sm] = w.matchStartTime.split(':').map(Number);
    const end = sh * 60 + sm + totalMins;
    if (end > 21 * 60) {
      return `With ${numCourts} court${numCourts === 1 ? '' : 's'}, the last match could finish around ` +
        `${Math.floor(end / 60)}:${String(end % 60).padStart(2, '0')}, after 9:00 PM.`;
    }
    return '';
  }
  if (anyCourts && numCourts === 0) {
    return 'No courts selected. Matches will be scheduled without a court assigned.';
  }
  return '';
}

function _nightHTML(anyCourts) {
  const text = _nightText(anyCourts);
  return text ? `
    <div class="wz-night">
      <svg viewBox="0 0 24 24" fill="none" stroke="#a8710f" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
      <span>${text}</span>
    </div>` : '';
}

function _step3RightHTML(allCourts) {
  const w = state.wizard;
  return `
    <div class="wz-col">
      <div class="wz-grid2">
        <div class="wz-field">
          <span class="wz-label">Match start</span>
          <input class="wz-input" id="wStartTime" type="time" value="${esc(w.matchStartTime)}">
        </div>
        <div class="wz-field">
          <span class="wz-label">Match length</span>
          <div class="wz-mininput">
            <input id="wDuration" type="number" min="1" value="${w.matchDuration}">
            <span>min</span>
          </div>
        </div>
      </div>

      <div class="wz-field">
        <div class="wz-colhead-row">
          <span class="wz-label">Courts</span>
          <span class="wz-hint" id="wzCourtN">${w.selectedCourtIds.length ? `${w.selectedCourtIds.length} selected` : 'none selected'}</span>
        </div>
        ${allCourts.length === 0
          ? `<p class="wz-hintline">No courts set up. <a href="#" onclick="navigate('clubSettings');return false">Add courts in Club Settings</a> first.</p>`
          : `<div class="wz-courts">${allCourts.map((ct) => `
              <button class="wz-court${w.selectedCourtIds.includes(ct.id) ? ' wz-court--on' : ''}" type="button" data-court="${ct.id}">
                <span class="wz-court-tick">&#10003;</span>${esc(ct.name)}
              </button>`).join('')}
            </div>`}
      </div>

      <div class="wz-field wz-buffer">
        <span class="wz-label">Buffer between</span>
        <div class="wz-mininput">
          <input id="wBuffer" type="number" min="0" value="${w.matchBuffer}">
          <span>min</span>
        </div>
      </div>

      <div id="wzNight">${_nightHTML(allCourts.length > 0)}</div>
    </div>`;
}

// Live recalculation: typing patches only the derived nodes so the focused
// input never re-renders; the click controls (steppers, presets, pills)
// re-render the whole page, which they can afford since they hold no focus.
function _patchStep3Derived(configs, anyCourts) {
  const calcWrap = document.getElementById('wzCalc');
  if (calcWrap) calcWrap.innerHTML = _calcCardHTML(configs);
  const weeks = document.getElementById('wzWeeks');
  if (weeks) weeks.innerHTML = _weeksLineText();
  const night = document.getElementById('wzNight');
  if (night) night.innerHTML = _nightHTML(anyCourts);
  document.getElementById('wzSummary').innerHTML = _summaryHTML();
  const next = document.getElementById('wNext');
  if (next) next.disabled = !_calc().valid;
}

function _wireStep3({ configs, allCourts }) {
  const w = state.wizard;
  const modern = w.setupType === 'modern' || _isDoubles();
  const anyCourts = allCourts.length > 0;

  const setGroup = (v) => {
    if (modern) {
      w.modernNumDivisions = Math.max(1, v);
      w.modernDivisionPlayers = null;
    } else {
      w.numTeams = Math.max(1, v);
    }
    renderCreateLeague();
  };
  const group = () => (modern ? w.modernNumDivisions : w.numTeams);

  document.getElementById('wizardCard').addEventListener('click', (e) => {
    const ctl = e.target.closest('[data-ctl]')?.dataset.ctl;
    if (ctl === 'group-dec') return setGroup(group() - 1);
    if (ctl === 'group-inc') return setGroup(group() + 1);
    if (ctl === 'rounds-dec' || ctl === 'rounds-inc') {
      w.numRounds = Math.max(1, w.numRounds + (ctl === 'rounds-inc' ? 1 : -1));
      return renderCreateLeague();
    }
    const preset = e.target.closest('[data-preset]')?.dataset.preset;
    if (preset) return setGroup(Number(preset));
    const court = e.target.closest('[data-court]')?.dataset.court;
    if (court) {
      const id = Number(court);
      w.selectedCourtIds = w.selectedCourtIds.includes(id)
        ? w.selectedCourtIds.filter((c) => c !== id)
        : [...w.selectedCourtIds, id];
      return renderCreateLeague();
    }
  });

  document.getElementById('wStartTime').addEventListener('input', (e) => {
    if (e.target.value) w.matchStartTime = e.target.value;
    _patchStep3Derived(configs, anyCourts);
  });
  document.getElementById('wDuration').addEventListener('input', (e) => {
    w.matchDuration = Math.max(1, Number(e.target.value) || 1);
    _patchStep3Derived(configs, anyCourts);
  });
  document.getElementById('wBuffer').addEventListener('input', (e) => {
    w.matchBuffer = Math.max(0, Number(e.target.value) || 0);
    _patchStep3Derived(configs, anyCourts);
  });

  document.getElementById('wBack').addEventListener('click', () => _goToStep(2));
  document.getElementById('wNext').addEventListener('click', () => _goToStep(4));
  _flushError();
}

function _step3CardHTML({ subtitle, groupLabel, groupVal, presets, groupHint, configs, allCourts }) {
  const c = _calc();
  return `
    <div class="wz-card">
      <div class="wz-head">
        <div>
          <div class="wz-title">Structure</div>
          <div class="wz-sub">${subtitle}</div>
        </div>
      </div>

      <div class="wz-cols wz-cols--pad">
        <div class="wz-col">
          <div class="wz-field">
            <span class="wz-label">${groupLabel}</span>
            <div class="wz-numrow">
              ${_numCtlHTML('group', groupVal)}
              ${_presetsHTML(presets, groupVal)}
            </div>
            <span class="wz-hintline">${groupHint}</span>
          </div>

          <div id="wzCalc">${_calcCardHTML(configs)}</div>

          <div class="wz-field">
            <span class="wz-label">Rounds through the schedule</span>
            <div class="wz-numrow">
              ${_numCtlHTML('rounds', state.wizard.numRounds)}
              <span class="wz-weeksline" id="wzWeeks">${_weeksLineText()}</span>
            </div>
          </div>
        </div>

        ${_step3RightHTML(allCourts)}
      </div>

      ${_footerHTML({ nextDisabled: !c.valid })}
    </div>`;
}

async function renderStep3Modern() {
  const w = state.wizard;
  const allCourts = await window.api.getCourts();
  const c = _calc();

  document.getElementById('wizardCard').innerHTML = _step3CardHTML({
    subtitle: `${c.n} players selected. Set the division count. Every division needs at least 2 players.`,
    groupLabel: 'Number of divisions',
    groupVal: w.modernNumDivisions,
    presets: [2, 3, 4],
    groupHint: `Minimum 1, maximum ${c.maxDivs} with ${c.n} players.`,
    configs: [],
    allCourts,
  });

  _wireStep3({ configs: [], allCourts });
}

// Doubles reuses the division layout; every count is in pairs.
async function renderStep3Doubles() {
  const w = state.wizard;
  const allCourts = await window.api.getCourts();
  const c = _calc();

  document.getElementById('wizardCard').innerHTML = _step3CardHTML({
    subtitle: `${c.n} pair${c.n === 1 ? '' : 's'} (${c.players} players) selected. Set the division count &mdash; pairs are split by seed.`,
    groupLabel: 'Number of divisions',
    groupVal: w.modernNumDivisions,
    presets: [2, 3, 4],
    groupHint: `Minimum 1, maximum ${c.maxDivs} with ${c.n} pairs.`,
    configs: [],
    allCourts,
  });

  _wireStep3({ configs: [], allCourts });
}

async function renderStep3Traditional() {
  const w = state.wizard;
  const c = _calc();
  const [configs, allCourts] = await Promise.all([window.api.getValidConfigs(c.n), window.api.getCourts()]);

  document.getElementById('wizardCard').innerHTML = _step3CardHTML({
    subtitle: `${c.n} players selected. Set the team count. Divisions follow from it.`,
    groupLabel: 'Number of teams',
    groupVal: w.numTeams,
    presets: [2, 3, 4, 6, 8],
    groupHint: `Each team fields one player per division. ${c.n} players must divide evenly.`,
    configs,
    allCourts,
  });

  _wireStep3({ configs, allCourts });
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

// Step 4 — Blackout dates
function renderStep4() {
  const w = state.wizard;
  const c = _calc();
  const weeks = c.weeks || 0;
  const dates = _weekDates(weeks);

  document.getElementById('wizardCard').innerHTML = `
    <div class="wz-card">
      <div class="wz-head">
        <div>
          <div class="wz-title">Blackout dates</div>
          <div class="wz-sub">The league runs ${weeks} week${weeks !== 1 ? 's' : ''} from ${_fmtShort(w.startDate)}. Skipped weeks push every later date back.</div>
        </div>
      </div>
      <div class="wz-body">
        <div class="wz-addrow">
          <div class="wz-field wz-addrow-date">
            <span class="wz-label">Skip a week</span>
            <input class="wz-input" id="wBlackoutDate" type="date" min="${w.startDate}">
          </div>
          <button class="btn btn-outline" id="wAddBlackout">Add date</button>
        </div>

        <div class="wz-bolist">
          ${w.blackoutDates.length === 0
            ? `<div class="wz-boempty">No dates skipped. The league runs ${weeks} straight weeks.</div>`
            : w.blackoutDates.map((d, i) => `
                <div class="wz-borow">
                  <span class="wz-bodate">${_fmtLong(d)}</span>
                  <span class="wz-bonote">Schedule shifts a week later</span>
                  <button class="btn btn-outline btn-sm" data-action="remove-blackout" data-idx="${i}">Remove</button>
                </div>`).join('')}
        </div>

        <div class="wz-field">
          <span class="wz-label">Resulting week dates</span>
          <div class="wz-wkchips">
            ${dates.map((d, i) => `
              <span class="wz-wkchip">
                <span class="wz-wkchip-n">WK ${i + 1}</span>
                <span class="wz-wkchip-d">${_fmtShort(d)}</span>
              </span>`).join('')}
          </div>
        </div>
      </div>
      ${_footerHTML()}
    </div>`;

  document.getElementById('wBack').addEventListener('click', () => _goToStep(3));
  document.getElementById('wNext').addEventListener('click', () => _goToStep(5));

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
  _flushError();
}

// Step 5 — Preview & confirm
function renderStep5() {
  if (_isDoubles()) return renderStep5Doubles();
  if (state.wizard.setupType === 'modern') return renderStep5Modern();
  return renderStep5Traditional();
}

// Step 5, doubles: the modern preview with pairs as the unit. Rosters list
// pairs as "Surname & Surname"; fixtures pair them off the same way.
function renderStep5Doubles() {
  const { startDate, modernNumDivisions, numRounds, selectedCourtIds } = state.wizard;
  const seeded = _seededPairs();

  if (!state.wizard.modernDivisionPlayers ||
      state.wizard.modernDivisionPlayers.length !== modernNumDivisions ||
      state.wizard.modernDivisionPlayers.flat().length !== seeded.length) {
    state.wizard.modernDivisionPlayers = distributePlayersEvenly(seeded, modernNumDivisions);
  }
  const divPairs = state.wizard.modernDivisionPlayers;

  const divRounds = divPairs.map((div) => {
    const oneRound = previewModernRoundRobin(div);
    const all = [];
    for (let rep = 0; rep < numRounds; rep++) all.push(...oneRound);
    return all;
  });
  const totalWeeks = Math.max(...divRounds.map((d) => d.length), 0);
  const weekDates = _weekDates(totalWeeks);
  const previewCount = Math.min(3, totalWeeks);

  const weeksHTML = Array.from({ length: previewCount }, (_, w) => {
    const groups = divRounds.slice(0, 2).map((rounds, dIdx) => {
      if (w >= rounds.length) return '';
      const round = rounds[w];
      const lines = [
        ...round.matches.map(([p1, p2]) => `<span class="wz-fixline">${esc(p1.name)} &nbsp;vs&nbsp; ${esc(p2.name)}</span>`),
        ...round.byes.map((p) => `<span class="wz-fixline wz-fixline--bye">${esc(p.name)} &mdash; bye</span>`),
      ].join('');
      return `<div class="wz-fixgroup"><span class="wz-fixlabel">Division ${dIdx + 1}</span>${lines}</div>`;
    }).join('');
    return `
      <div class="wz-week">
        <div class="wz-week-top">
          <span class="wz-week-title">Week ${w + 1}</span>
          <span class="wz-week-date">${_fmtShort(weekDates[w])}</span>
        </div>
        ${groups}
      </div>`;
  }).join('');

  const rostersHTML = divPairs.map((div, i) => `
    <div class="wz-rosterrow">
      <div class="wz-rosterrow-top">
        <span class="wz-rostername">Division ${i + 1}</span>
        <span class="wz-countchip">${div.length} pair${div.length === 1 ? '' : 's'}</span>
      </div>
      <span class="wz-rosternames">${div.map((p) => esc(p.name)).join(' &nbsp;&middot;&nbsp; ')}</span>
    </div>`).join('');

  document.getElementById('wizardCard').innerHTML = _step5ShellHTML({
    meta: `Starts ${_fmtLong(startDate)} &middot; ${modernNumDivisions} division${modernNumDivisions !== 1 ? 's' : ''}${_blackoutMetaNote()}`,
    stats: [[seeded.length * 2, 'Players'], [seeded.length, 'Pairs'], [totalWeeks, 'Weeks'], [selectedCourtIds.length, 'Courts']],
    rosterLabel: 'Division rosters',
    editId: 'btnEditDivisions',
    editLabel: 'Edit divisions',
    rostersHTML,
    previewNote: totalWeeks > previewCount ? `First ${previewCount} of ${totalWeeks} weeks` : `All ${totalWeeks} weeks`,
    weeksHTML,
  });

  document.getElementById('wBack').addEventListener('click', () => _goToStep(4));
  document.getElementById('wCreate').addEventListener('click', submitCreateLeague);
  document.getElementById('btnEditDivisions').addEventListener('click', openEditDivisionsModal);
  _flushError();
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

function _step5ShellHTML({ meta, stats, rosterLabel, editId, editLabel, rostersHTML, previewNote, weeksHTML }) {
  return `
    <div class="wz-step5">
      <div class="wz-hero">
        <div class="wz-hero-left">
          <span class="wz-hero-name">${esc(state.wizard.leagueName)}</span>
          <span class="wz-hero-meta">${meta}</span>
        </div>
        <div class="wz-hero-stats">
          ${stats.map(([value, label]) => `
            <div class="wz-tile">
              <span class="wz-tile-val">${value}</span>
              <span class="wz-tile-label">${label}</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="wz-prev2">
        <div class="wz-card">
          <div class="wz-card5head">
            <span class="wz-label">${rosterLabel}</span>
            <button class="btn btn-outline btn-sm wz-editbtn" id="${editId}">${editLabel}</button>
          </div>
          <div class="wz-rosterbody">${rostersHTML}</div>
        </div>

        <div class="wz-card">
          <div class="wz-card5head">
            <span class="wz-label">Schedule preview</span>
            <span class="wz-hint wz-card5note">${previewNote}</span>
          </div>
          <div class="wz-schedbody">${weeksHTML}</div>
        </div>
      </div>

      <div class="wz-card wz-foot5">
        <span class="wz-foot-note">Fixtures, teams and dates are generated when you create the league.</span>
        <span id="wError" class="wz-foot-err"></span>
        <span class="wz-foot-btns">
          <button class="btn btn-outline" id="wBack">Back</button>
          <button class="btn btn-success btn-lg" id="wCreate">Create League</button>
        </span>
      </div>
    </div>`;
}

function _blackoutMetaNote() {
  const n = state.wizard.blackoutDates.length;
  return n > 0 ? ` &middot; ${n} blackout date${n !== 1 ? 's' : ''}` : '';
}

function renderStep5Modern() {
  const { startDate, rankedPlayers, modernNumDivisions, numRounds, selectedCourtIds } = state.wizard;

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
  const weekDates = _weekDates(totalWeeks);
  const previewCount = Math.min(3, totalWeeks);

  const weeksHTML = Array.from({ length: previewCount }, (_, w) => {
    const groups = divRounds.slice(0, 2).map((rounds, dIdx) => {
      if (w >= rounds.length) return '';
      const round = rounds[w];
      const lines = [
        ...round.matches.map(([p1, p2]) => `<span class="wz-fixline">${esc(p1.name)} vs ${esc(p2.name)}</span>`),
        ...round.byes.map((p) => `<span class="wz-fixline wz-fixline--bye">${esc(p.name)} &middot; bye</span>`),
      ].join('');
      return `<div class="wz-fixgroup"><span class="wz-fixlabel">Division ${dIdx + 1}</span>${lines}</div>`;
    }).join('');
    return `
      <div class="wz-week">
        <div class="wz-week-top">
          <span class="wz-week-title">Week ${w + 1}</span>
          <span class="wz-week-date">${_fmtShort(weekDates[w])}</span>
        </div>
        ${groups}
      </div>`;
  }).join('');

  const rostersHTML = divPlayers.map((div, i) => `
    <div class="wz-rosterrow">
      <div class="wz-rosterrow-top">
        <span class="wz-rostername">Division ${i + 1}</span>
        <span class="wz-countchip">${div.length} players</span>
      </div>
      <span class="wz-rosternames">${div.map((p) => esc(p.name)).join(', ')}</span>
    </div>`).join('');

  document.getElementById('wizardCard').innerHTML = _step5ShellHTML({
    meta: `Starts ${_fmtLong(startDate)} &middot; ${modernNumDivisions} division${modernNumDivisions !== 1 ? 's' : ''}${_blackoutMetaNote()}`,
    stats: [[rankedPlayers.length, 'Players'], [totalWeeks, 'Weeks'], [selectedCourtIds.length, 'Courts']],
    rosterLabel: 'Division rosters',
    editId: 'btnEditDivisions',
    editLabel: 'Edit divisions',
    rostersHTML,
    previewNote: totalWeeks > previewCount ? `First ${previewCount} of ${totalWeeks} weeks` : `All ${totalWeeks} weeks`,
    weeksHTML,
  });

  document.getElementById('wBack').addEventListener('click', () => _goToStep(4));
  document.getElementById('wCreate').addEventListener('click', submitCreateLeague);
  document.getElementById('btnEditDivisions').addEventListener('click', openEditDivisionsModal);
  _flushError();
}

function openEditDivisionsModal() {
  let workingDivs = state.wizard.modernDivisionPlayers.map((d) => [...d]);
  let dragSource = null;

  const unit = _isDoubles() ? 'pairs' : 'players';
  modal.open('Edit Divisions', `
    <p class="text-muted" style="font-size:13px;margin-bottom:16px">
      Drag ${unit} between divisions to reassign them. Each division needs at least 2 ${unit}.
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
            ${esc(p.name)}${p.bestRank && Number.isFinite(p.bestRank) ? `<span class="ed-rank">#${p.bestRank}</span>` : ''}
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
    const short = workingDivs.filter((d) => d.length < 2).length;
    if (short) {
      document.getElementById('edError').textContent = _isDoubles()
        ? `${short} group${short === 1 ? '' : 's'} ha${short === 1 ? 's' : 've'} fewer than 2 pairs`
        : 'Each division must have at least 2 players.';
      return;
    }
    state.wizard.modernDivisionPlayers = workingDivs;
    modal.close();
    renderStep5();
  });
}

function renderStep5Traditional() {
  const { startDate, rankedPlayers, numTeams, numDivisions, numRounds, selectedCourtIds } = state.wizard;
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
    teams[i % numTeams].players.push(p);
  });

  // Build full schedule with numRounds repetitions, skipping blackout dates
  const teamIndexes = Array.from({ length: numTeams }, (_, i) => i);
  const oneRoundRobin = previewRoundRobin(teamIndexes);
  const allRounds = [];
  for (let rep = 0; rep < numRounds; rep++) allRounds.push(...oneRoundRobin);

  const totalWeeks = allRounds.length;
  const weekDates = _weekDates(totalWeeks);
  const previewCount = Math.min(3, totalWeeks);

  const weeksHTML = allRounds.slice(0, previewCount).map((round, r) => `
    <div class="wz-week">
      <div class="wz-week-top">
        <span class="wz-week-title">Week ${r + 1}</span>
        <span class="wz-week-date">${_fmtShort(weekDates[r])}</span>
      </div>
      <div class="wz-fixgroup">
        <span class="wz-fixlabel">Fixtures</span>
        ${round.map((mu) => mu.bye != null
          ? `<span class="wz-fixline wz-fixline--bye">${esc(teams[mu.bye].name)} &middot; bye</span>`
          : `<span class="wz-fixline">${esc(teams[mu.team1].name)} vs ${esc(teams[mu.team2].name)}</span>`
        ).join('')}
      </div>
    </div>`).join('');

  const rostersHTML = teams.map((t) => `
    <div class="wz-rosterrow">
      <div class="wz-rosterrow-top">
        <span class="wz-rostername">${esc(t.name)}</span>
        <span class="wz-countchip">${t.players.length} players</span>
      </div>
      <span class="wz-rosternames">${t.players.map((p) => esc(p.name)).join(', ')}</span>
    </div>`).join('');

  document.getElementById('wizardCard').innerHTML = _step5ShellHTML({
    meta: `Starts ${_fmtLong(startDate)} &middot; ${numTeams} teams &times; ${numDivisions} divisions${_blackoutMetaNote()}`,
    stats: [[rankedPlayers.length, 'Players'], [totalWeeks, 'Weeks'], [selectedCourtIds.length, 'Courts']],
    rosterLabel: 'Team rosters',
    editId: 'btnEditTeams',
    editLabel: 'Edit teams',
    rostersHTML,
    previewNote: totalWeeks > previewCount ? `First ${previewCount} of ${totalWeeks} weeks` : `All ${totalWeeks} weeks`,
    weeksHTML,
  });

  document.getElementById('wBack').addEventListener('click', () => _goToStep(4));
  document.getElementById('wCreate').addEventListener('click', submitCreateLeague);
  document.getElementById('btnEditTeams').addEventListener('click', () => openEditTeamsModal(numTeams, numDivisions));
  _flushError();
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
  if (setupType === 'doubles') {
    payload = {
      name: leagueName, startDate, setup_type: 'doubles',
      numRounds, blackoutDates, matchStartTime, courtIds: selectedCourtIds, matchDuration, matchBuffer,
      divisions: state.wizard.modernDivisionPlayers.map((divPairs, dIdx) =>
        divPairs.map((pr, pIdx) => ({ playerIds: [pr.a.id, pr.b.id], rank: dIdx * 1000 + pIdx + 1 }))
      ),
    };
  } else if (setupType === 'modern') {
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
