import { state } from '../state.js';
import { esc, toast, avatarHTML } from '../utils.js';
import * as K from '../knockout.js';
import {
  wizardShellHTML, wireStepper, summaryCellHTML, wizardFooterHTML, courtChipsHTML, minuteInputHTML, warnHTML, wizardHeroHTML,
} from '../wizardFrame.js';
import { bracketTreeHTML } from '../bracketTree.js';

// ===== BUILD A KNOCKOUT =====
// Four steps: Details → Players & seeding → Schedule → Preview. Nothing is
// saved until Create Tournament; the server then lays the draw out exactly as
// the preview shows it, because both read the same bracket module.
//
// The same schedule step, on its own, is how an admin reschedules a running
// tournament (Options → Edit schedule).

const STEP_LABELS = ['Details', 'Players & seeding', 'Schedule', 'Preview'];
const DRAG_GLYPH = '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>';
const DRAW_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h5v4H4zM4 14h5v4H4zM15 10h5v4h-5zM9 8h3v8H9M12 12h3"/></svg>';

const _w = () => state.koWizard;
const _iso = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const _addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return _iso(d); };
function _nextSaturday() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return _iso(d);
}

/**
 * A round a week, the semis and final sharing the last Saturday: the
 * handoff's defaults, from the first round's date.
 */
function _defaultRounds(first) {
  return {
    16: [{ date: first, time: '18:00' }, { date: _addDays(first, 7), time: '18:00' }, { date: _addDays(first, 21), time: '14:00' }, { date: _addDays(first, 21), time: '17:00' }],
    8: [{ date: first, time: '18:00' }, { date: _addDays(first, 7), time: '14:00' }, { date: _addDays(first, 7), time: '17:00' }],
  };
}

async function _ladderRanks() {
  if (!state.ladder.length) state.ladder = await window.api.getLadder();
  return Object.fromEntries(state.ladder.map((r, i) => [r.id, r.position ?? i + 1]));
}

/** Ladder order: ranked first by rank, unranked after in the order they came in. */
const _byLadder = (players) => players.map((p, k) => ({ p, k }))
  .sort((a, b) => (a.p.rank ?? Infinity) - (b.p.rank ?? Infinity) || a.k - b.k).map((x) => x.p);

/**
 * Open the wizard. `fromUpcoming` is an announced tournament: its name, cap,
 * first-round date and signups come in, and Create fills that same row.
 */
export async function startCreateTournament({ fromUpcoming = null } = {}) {
  const ranks = await _ladderRanks().catch(() => ({}));
  const entrants = (fromUpcoming?.signups || []).map((s) => ({ id: s.player_id, name: s.name, photo_path: s.photo_path || null, rank: ranks[s.player_id] ?? null }));
  const first = fromUpcoming?.first_round_date || _nextSaturday();
  state.koWizard = {
    mode: 'create',
    step: 1,
    tournamentId: fromUpcoming?.id ?? null,
    capLocked: !!fromUpcoming,
    name: fromUpcoming?.name || '',
    cap: fromUpcoming?.draw_cap || 16,
    seeding: 'ladder',
    entrants: _byLadder(entrants),
    search: '',
    rounds: _defaultRounds(first),
    len: 40,
    buffer: 10,
    courts: null,
    conflicts: [],
    error: '',
  };
  window.navigate('createTournament');
}

/** Reschedule a built tournament: the schedule step on its own. */
export function startEditSchedule(t) {
  const draw = t.draw_size;
  state.koWizard = {
    mode: 'schedule',
    step: 3,
    tournamentId: t.id,
    name: t.name,
    cap: t.draw_cap,
    draw,
    tournament: t,
    rounds: { [draw]: t.rounds.map((r) => ({ date: r.date, time: r.time })) },
    len: t.match_duration_minutes || 40,
    buffer: t.buffer_minutes ?? 10,
    courts: t.courts.map((c) => c.id),
    conflicts: [],
    error: '',
  };
  window.navigate('createTournament');
}

// ----- derived -----
function _draw() {
  const w = _w();
  return w.mode === 'schedule' ? w.draw : K.drawFor(w.entrants.length, w.cap);
}
const _rounds = () => _w().rounds[_draw()];
const _enough = () => _w().mode === 'schedule' || _w().entrants.length >= K.MIN_ENTRANTS;

/** The preview bracket, or the live one when rescheduling. */
function _bracket() {
  const w = _w();
  const rounds = _rounds().map((r) => ({ date: r.date, time: K.toMin(r.time) }));
  const courts = (w.allCourts || []).filter((c) => w.courts.includes(c.id));
  if (w.mode === 'schedule') {
    return K.buildBracket({ draw: w.draw, entrants: w.tournament.players.map((p) => ({ id: p.player_id, name: p.name })), rounds, courts, len: w.len, buffer: w.buffer });
  }
  return K.buildBracket({ draw: _draw(), entrants: w.entrants, rounds, courts, len: w.len, buffer: w.buffer });
}

const _counts = (b) => b.rounds.map((rd) => rd.filter((m) => !m.bye).length);

/** Each round's plan and warnings. */
function _plans() {
  const w = _w();
  const b = _bracket();
  const counts = _counts(b);
  const rounds = _rounds();
  const names = K.ROUND_KEYS[b.draw].map((k) => K.ROUND_NAMES[k]);
  return rounds.map((r, k) => {
    const start = K.toMin(r.time);
    const plan = K.roundPlan(counts[k], w.courts.length, start, w.len, w.buffer);
    const warnings = [];
    if (plan.ends > 21 * 60) warnings.push(`Late finish: the last match ends around ${K.fmtTime(plan.ends)}.`);
    if (k > 0) {
      const prev = rounds[k - 1];
      const prevPlan = K.roundPlan(counts[k - 1], w.courts.length, K.toMin(prev.time), w.len, w.buffer);
      if (r.date < prev.date) warnings.push(`Dated before the ${names[k - 1].toLowerCase()} (${K.fmtDate(prev.date)}).`);
      else if (r.date === prev.date && start < prevPlan.ends) warnings.push(`Starts before the ${names[k - 1].toLowerCase()} finish (~${K.fmtTime(prevPlan.ends)}).`);
    }
    const seen = new Set();
    for (const c of w.conflicts[k] || []) {
      const key = `${c.court}|${c.from}|${c.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push(`${esc(c.court)} is booked ${K.fmtTime(K.toMin(c.from))}–${K.fmtTime(K.toMin(c.to))} that day. Drop ${esc(c.court)} or move the start.`);
    }
    const byes = k === 0 ? b.byes : 0;
    const courtsTxt = `${plan.courts} court${plan.courts === 1 ? '' : 's'}`;
    const n = counts[k];
    const nTxt = `${n} match${n === 1 ? '' : 'es'}`;
    return {
      name: names[k], date: r.date, time: r.time, warnings,
      count: `${nTxt}${byes ? ` · ${byes} bye${byes === 1 ? '' : 's'}` : ''}`,
      readout: n <= plan.courts
        ? `${nTxt} · ${courtsTxt} · all at ${K.fmtTime(start)} · ends ~${K.fmtTime(plan.ends)}`
        : `${nTxt} · ${courtsTxt} · ${plan.waves} waves · ends ~${K.fmtTime(plan.ends)}`,
      previewLine: `${K.fmtDate(r.date)} · ${K.fmtTime(start)} · ${nTxt} on ${courtsTxt}${plan.waves > 1 ? ` in ${plan.waves} waves` : ''} · ends ~${K.fmtTime(plan.ends)}`,
    };
  });
}

function _summaryHTML() {
  const w = _w();
  const n = w.entrants.length;
  const draw = _draw();
  const byes = K.byesFor(draw, n);
  return [
    summaryCellHTML('Tournament', esc(w.name.trim()) || 'Untitled', { desk: true }),
    summaryCellHTML('Entrants', String(n)),
    summaryCellHTML('Draw', `${draw}-draw`),
    summaryCellHTML('Byes', byes && _enough() ? String(byes) : '—'),
    summaryCellHTML('First round', K.fmtMD(_rounds()[0].date)),
  ].join('');
}
const _refreshSummary = () => { const el = document.getElementById('wzSummary'); if (el) el.innerHTML = _summaryHTML(); };

function _setError(msg) {
  _w().error = msg;
  const el = document.getElementById('wError');
  if (el) el.textContent = msg;
}

function _goTo(target) {
  const w = _w();
  target = Math.max(1, Math.min(4, target));
  if (target === w.step) return;
  if (target > 1 && !w.name.trim()) { w.step = 1; w.error = 'Tournament name is required.'; renderCreateTournament(); return; }
  if (target > 2 && !_enough()) { w.step = 2; w.error = `A knockout needs at least ${K.MIN_ENTRANTS} players.`; renderCreateTournament(); return; }
  w.error = '';
  w.step = target;
  renderCreateTournament();
}

// ----- the page -----

export async function renderCreateTournament() {
  const w = _w();
  if (!w) { window.navigate('tournaments'); return; }
  if (!w.allCourts) {
    w.allCourts = (await window.api.getCourts()).filter((c) => c.active !== 0 && c.active !== false);
    if (!w.courts) w.courts = w.allCourts.map((c) => c.id);
  }
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.getElementById('mainContent');

  if (w.mode === 'schedule') {
    document.getElementById('pageTitle').textContent = `Edit schedule · ${w.name}`;
    content.innerHTML = '<div class="wz-page"><div id="wizardCard"></div></div>';
    _renderSchedule();
    return;
  }

  document.getElementById('pageTitle').textContent = 'New Tournament';
  content.innerHTML = wizardShellHTML({ labels: STEP_LABELS, step: w.step, summaryHTML: _summaryHTML() });
  wireStepper(content, _goTo);
  if (w.step === 1) _renderDetails();
  else if (w.step === 2) await _renderPlayers();
  else if (w.step === 3) _renderSchedule();
  else _renderPreview();
  const err = document.getElementById('wError');
  if (err) err.textContent = w.error || '';
}

// ----- step 1: details -----

function _renderDetails() {
  const w = _w();
  const seg = (n) => `<button type="button" class="lgl-seg-b${w.cap === n ? ' lgl-seg-b--on' : ''}" data-cap="${n}">${n} players</button>`;
  const formatLine = w.cap === 16
    ? 'Sixteen players play a round of 16, quarterfinals, semifinals and a final.'
    : 'Eight players play quarterfinals, semifinals and a final.';
  document.getElementById('wizardCard').innerHTML = `
    <div class="wz-card">
      <div class="wz-head">
        <div>
          <div class="wz-title">Tournament details</div>
          <div class="wz-sub">${w.capLocked ? 'Prefilled from the announcement. The draw size was fixed when it was announced.' : 'Name it and choose the largest draw it can have.'}</div>
        </div>
      </div>
      <div class="wz-body">
        <div class="wz-row1">
          <div class="wz-field">
            <span class="wz-label">Tournament name</span>
            <input class="wz-input" id="koName" value="${esc(w.name)}" placeholder="e.g. October C/D Knockout" autocomplete="off">
          </div>
          <div class="wz-field">
            <span class="wz-label">Draw size${w.capLocked ? ' <i class="wz-locked-note">set when announced</i>' : ''}</span>
            <div class="lgl-seg" id="koCap" role="radiogroup" aria-label="Draw size"${w.capLocked ? ' style="pointer-events:none;opacity:.7"' : ''}>${seg(8)}${seg(16)}</div>
          </div>
        </div>
        <div class="wz-field">
          <span class="wz-label">Format</span>
          <p class="wz-hintline" style="margin:0">Single elimination, singles only, best of five. ${formatLine} No losers' bracket and no third-place match.</p>
        </div>
      </div>
      ${wizardFooterHTML({ cancel: true })}
    </div>`;
  document.getElementById('koName').addEventListener('input', (e) => { w.name = e.target.value; _refreshSummary(); _setError(''); });
  document.getElementById('koCap').querySelectorAll('[data-cap]').forEach((b) => b.addEventListener('click', () => {
    if (w.capLocked) return;
    w.cap = Number(b.dataset.cap);
    // A smaller cap cannot hold more players than it has room for.
    if (w.entrants.length > w.cap) w.entrants = w.entrants.slice(0, w.cap);
    renderCreateTournament();
  }));
  document.getElementById('wCancel').addEventListener('click', () => (w.tournamentId
    ? window.navigate('tournamentDetail', { tournamentId: w.tournamentId })
    : window.navigate('tournaments')));
  document.getElementById('wNext').addEventListener('click', () => _goTo(2));
}

// ----- step 2: players & seeding -----

async function _renderPlayers() {
  const w = _w();
  const ranks = await _ladderRanks().catch(() => ({}));
  if (!state.players.length) state.players = await window.api.getPlayers();
  const club = _byLadder(state.players.map((p) => ({ id: p.id, name: p.name, photo_path: p.photo_path || null, rank: ranks[p.id] ?? null })));

  document.getElementById('wizardCard').innerHTML = `
    <div class="wz-card">
      <div class="wz-head">
        <div>
          <div class="wz-title">Players &amp; seeding</div>
          <div class="wz-sub">${w.tournamentId ? 'Everyone who signed up is already in. ' : ''}Add or remove players, then check the seeding.</div>
        </div>
        <span class="wz-selchip" id="koEntrantChip"></span>
      </div>
      <div id="koDrawLine"></div>
      <div class="wz-cols">
        <div class="wz-pickcol">
          <div class="wz-colhead">
            <div class="wz-colhead-row"><span class="wz-label">Club players</span><span class="wz-hint" id="koAvailN"></span></div>
            <input class="wz-input wz-search" id="koSearch" placeholder="Search players…" autocomplete="off" value="${esc(w.search)}">
          </div>
          <div class="wz-plist" id="koAvail"></div>
        </div>
        <div class="wz-pickcol">
          <div class="wz-colhead wz-colhead--sel ko-selhead">
            <div class="wz-colhead-row"><span class="wz-label">Entrants</span><span class="wz-hint" id="koSeedHint"></span><button class="wz-ghost" id="koClear">Clear</button></div>
            <div class="lgl-seg" id="koSeeding" role="radiogroup" aria-label="Seeding">
              <button type="button" class="lgl-seg-b" data-seeding="ladder">By ladder</button>
              <button type="button" class="lgl-seg-b" data-seeding="manual">Manual</button>
            </div>
          </div>
          <div class="wz-plist wz-plist--sel" id="koEntrants"></div>
        </div>
      </div>
      ${wizardFooterHTML()}
    </div>`;

  const paint = () => {
    const n = w.entrants.length;
    const draw = _draw();
    const byes = K.byesFor(draw, n);
    const low = n < K.MIN_ENTRANTS;
    const capReached = n >= w.cap;
    document.getElementById('koEntrantChip').textContent = `${n} entrant${n === 1 ? '' : 's'}`;
    const left = w.cap - n;
    document.getElementById('koDrawLine').innerHTML = `
      <div class="ko-drawline${low ? ' ko-drawline--low' : capReached ? ' ko-drawline--full' : ''}">
        ${DRAW_ICON}
        <span class="ko-drawline-text">
          <span class="ko-drawline-main">${low ? `${n} entrant${n === 1 ? '' : 's'} · not enough to build` : `${n} entrants · ${draw}-draw${byes ? ` · seeds 1–${byes} get byes` : ' · no byes'}`}</span>
          <span class="ko-drawline-sub">${low ? `A knockout needs at least ${K.MIN_ENTRANTS} players. Add ${K.MIN_ENTRANTS - n} more from the club list.`
    : capReached ? `The draw is full at ${w.cap}. Remove a player to add another.`
      : byes ? `${left} spot${left === 1 ? '' : 's'} left. Byes go to the top seeds and skip the ${K.ROUND_NAMES[K.ROUND_KEYS[draw][0]].toLowerCase()}.`
        : `${left} spot${left === 1 ? '' : 's'} left.`}</span>
        </span>
      </div>`;

    const inSet = new Set(w.entrants.map((p) => p.id));
    const q = w.search.trim().toLowerCase();
    const availAll = club.filter((p) => !inSet.has(p.id));
    const avail = availAll.filter((p) => !q || p.name.toLowerCase().includes(q));
    document.getElementById('koAvailN').textContent = `${availAll.length} available · ladder order`;
    document.getElementById('koAvail').innerHTML = avail.length ? avail.map((p) => `
      <div class="wz-prow${capReached ? ' wz-prow--dim' : ''}" data-add="${p.id}">
        ${avatarHTML(p, 'wz-avatar')}
        <span class="wz-pname">${esc(p.name)}</span>
        <span class="wz-prank">${p.rank ? `#${p.rank}` : ''}</span>
        <button class="wz-pbtn" type="button" tabindex="-1"${capReached ? ' disabled' : ''}>+</button>
      </div>`).join('') : '<div class="wz-lempty"><span class="wz-lempty-t">No players match</span></div>';

    document.getElementById('koSeedHint').textContent = w.seeding === 'ladder' ? 'ladder order · unranked last' : 'manual order';
    document.querySelectorAll('#koSeeding [data-seeding]').forEach((b) => b.classList.toggle('lgl-seg-b--on', b.dataset.seeding === w.seeding));
    document.getElementById('koClear').disabled = n === 0;
    document.getElementById('koEntrants').innerHTML = n ? w.entrants.map((p, i) => `
      <div class="wz-prow wz-prow--sel ko-erow" draggable="true" data-idx="${i}">
        <span class="ko-drag" aria-hidden="true" title="Drag to reorder">${DRAG_GLYPH}</span>
        <span class="wz-seed">${i + 1}</span>
        ${avatarHTML(p, 'wz-avatar wz-avatar--navy')}
        <span class="wz-pname">
          <span class="ko-erow-name">${esc(p.name)}</span>
          <span class="ko-erow-rank${p.rank ? '' : ' ko-erow-rank--none'}">${p.rank ? `Ladder #${p.rank}` : 'Unranked · seeds last'}</span>
        </span>
        ${i < byes && !low ? '<span class="pill pill--grey">Bye</span>' : ''}
        <span class="ko-moves">
          <button type="button" class="wz-pbtn" data-move="${i}" data-dir="-1" aria-label="Move ${esc(p.name)} up"${i === 0 ? ' disabled' : ''}>&#9650;</button>
          <button type="button" class="wz-pbtn" data-move="${i}" data-dir="1" aria-label="Move ${esc(p.name)} down"${i === n - 1 ? ' disabled' : ''}>&#9660;</button>
        </span>
        <button type="button" class="wz-pbtn" data-remove="${i}" aria-label="Remove ${esc(p.name)}">&times;</button>
      </div>`).join('') : '<div class="wz-lempty"><span class="wz-lempty-t">No entrants yet</span><span class="wz-lempty-s">Click a name on the left to add them.</span></div>';
    document.getElementById('wNext').disabled = low;
    _refreshSummary();
  };

  const setManual = (list) => { w.entrants = list; w.seeding = 'manual'; paint(); };
  document.getElementById('koSearch').addEventListener('input', (e) => { w.search = e.target.value; paint(); });
  document.getElementById('koAvail').addEventListener('click', (e) => {
    const row = e.target.closest('[data-add]');
    if (!row) return;
    if (w.entrants.length >= w.cap) { _setError(`The draw is full at ${w.cap}.`); return; }
    _setError('');
    const p = club.find((x) => x.id === Number(row.dataset.add));
    w.entrants = w.seeding === 'ladder' ? _byLadder([...w.entrants, p]) : [...w.entrants, p];
    paint();
  });
  document.getElementById('koSeeding').addEventListener('click', (e) => {
    const b = e.target.closest('[data-seeding]');
    if (!b) return;
    w.seeding = b.dataset.seeding;
    if (w.seeding === 'ladder') w.entrants = _byLadder(w.entrants);
    paint();
  });
  document.getElementById('koClear').addEventListener('click', () => { w.entrants = []; paint(); });

  const list = document.getElementById('koEntrants');
  list.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const i = Number(mv.dataset.move);
      const j = i + Number(mv.dataset.dir);
      if (j < 0 || j >= w.entrants.length) return;
      const next = [...w.entrants];
      [next[i], next[j]] = [next[j], next[i]];
      setManual(next);
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { w.entrants = w.entrants.filter((_, k) => k !== Number(rm.dataset.remove)); paint(); }
  });
  // Drag to reorder (desktop; the arrows do the same on a phone).
  let from = null;
  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-idx]');
    if (!row) return;
    from = Number(row.dataset.idx);
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', (e) => {
    const row = e.target.closest('[data-idx]');
    if (!row || from == null) return;
    e.preventDefault();
    list.querySelectorAll('.ko-prow--over').forEach((x) => x !== row && x.classList.remove('ko-prow--over'));
    row.classList.add('ko-prow--over');
  });
  list.addEventListener('drop', (e) => {
    const row = e.target.closest('[data-idx]');
    if (!row || from == null) return;
    e.preventDefault();
    const to = Number(row.dataset.idx);
    if (to !== from) {
      const next = [...w.entrants];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      from = null;
      setManual(next);
    }
  });
  list.addEventListener('dragend', () => { from = null; list.querySelectorAll('.ko-prow--over').forEach((x) => x.classList.remove('ko-prow--over')); });

  document.getElementById('wBack').addEventListener('click', () => _goTo(1));
  document.getElementById('wNext').addEventListener('click', () => _goTo(3));
  paint();
}

// ----- step 3: schedule -----

let _checkTimer = null;
/** Ask the server which rounds overlap something already on the courts. */
function _checkConflicts() {
  clearTimeout(_checkTimer);
  _checkTimer = setTimeout(async () => {
    const w = _w();
    if (!w || !w.courts.length) return;
    try {
      const r = await window.api.checkTournamentSchedule({
        tournamentId: w.mode === 'schedule' ? w.tournamentId : null,
        rounds: _rounds(), counts: _counts(_bracket()), courtIds: w.courts, len: w.len, buffer: w.buffer,
      });
      w.conflicts = r.conflicts || [];
      if (document.getElementById('koRounds')) _paintRounds();
    } catch (_) { /* the warnings are advice; a failed check just shows none */ }
  }, 250);
}

function _paintRounds() {
  const el = document.getElementById('koRounds');
  el.innerHTML = _plans().map((r, k) => `
    <div class="ko-roundcard${r.warnings.length ? ' ko-roundcard--warn' : ''}">
      <div class="ko-roundcard-head"><span class="ko-roundcard-name">${r.name}</span><span class="wz-hint">${r.count}</span></div>
      <div class="wz-grid2">
        <div class="wz-field"><span class="wz-label">Date</span><input class="wz-input" type="date" data-round="${k}" data-f="date" value="${r.date}"></div>
        <div class="wz-field"><span class="wz-label">Start time</span><input class="wz-input" type="time" step="300" data-round="${k}" data-f="time" value="${r.time}"></div>
      </div>
      <span class="ko-readout">${r.readout}</span>
      ${r.warnings.map(warnHTML).join('')}
    </div>`).join('');
}

function _renderSchedule() {
  const w = _w();
  const editing = w.mode === 'schedule';
  document.getElementById('wizardCard').innerHTML = `
    <div class="wz-card">
      <div class="wz-head">
        <div>
          <div class="wz-title">Schedule</div>
          <div class="wz-sub">One date and start time per round. Rounds can share a day as long as each starts after the one before it finishes.${editing ? ' Matches already played keep their slot.' : ''}</div>
        </div>
      </div>
      <div class="ko-schedcols">
        <div class="ko-schedcol" id="koRounds"></div>
        <div class="ko-schedcol">
          <span class="wz-label ko-shared-label">Shared by every round</span>
          <div class="wz-grid2">
            <div class="wz-field"><span class="wz-label">Match length</span>${minuteInputHTML('koLen', w.len, { min: 1 })}</div>
            <div class="wz-field" style="margin:0"><span class="wz-label">Buffer between</span>${minuteInputHTML('koBuffer', w.buffer)}</div>
          </div>
          <div class="wz-field">
            <div class="wz-colhead-row"><span class="wz-label">Courts</span><span class="wz-hint" id="koCourtN">${w.courts.length} selected</span></div>
            ${courtChipsHTML(w.allCourts, w.courts)}
          </div>
          <p class="wz-hintline" style="margin:0">Bookings, league matches and other tournaments already on the selected courts are checked, and any round that overlaps one is flagged.</p>
        </div>
      </div>
      ${editing ? `
      <div class="wz-foot">
        <span id="wError" class="wz-foot-err"></span>
        <span class="wz-foot-btns">
          <button class="btn btn-outline" id="wCancel">Cancel</button>
          <button class="btn btn-primary" id="wSave">Save schedule</button>
        </span>
      </div>` : wizardFooterHTML()}
    </div>`;
  _paintRounds();
  _checkConflicts();

  const changed = () => { _paintRounds(); _refreshSummary(); _checkConflicts(); };
  document.getElementById('koRounds').addEventListener('change', (e) => {
    const f = e.target.dataset.f;
    if (!f || !e.target.value) return;
    _rounds()[Number(e.target.dataset.round)][f] = e.target.value;
    changed();
  });
  document.getElementById('koLen').addEventListener('change', (e) => { w.len = Math.max(1, Number(e.target.value) || 1); changed(); });
  document.getElementById('koBuffer').addEventListener('change', (e) => { w.buffer = Math.max(0, Number(e.target.value) || 0); changed(); });
  document.querySelector('#wizardCard .wz-courts')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-court]');
    if (!b) return;
    const id = Number(b.dataset.court);
    const next = w.courts.includes(id) ? w.courts.filter((x) => x !== id) : [...w.courts, id];
    if (!next.length) return; // at least one court stays on
    w.courts = w.allCourts.map((c) => c.id).filter((x) => next.includes(x));
    b.classList.toggle('wz-court--on', w.courts.includes(id));
    document.getElementById('koCourtN').textContent = `${w.courts.length} selected`;
    changed();
  });

  if (editing) {
    document.getElementById('wCancel').addEventListener('click', () => window.navigate('tournamentDetail', { tournamentId: w.tournamentId }));
    document.getElementById('wSave').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await window.api.updateTournamentSchedule(w.tournamentId, { rounds: _rounds(), courtIds: w.courts, len: w.len, buffer: w.buffer });
        toast('Schedule updated', 'success');
        window.navigate('tournamentDetail', { tournamentId: w.tournamentId });
      } catch (err) {
        _setError(err.message || 'Could not save the schedule.');
        e.target.disabled = false;
      }
    });
    return;
  }
  document.getElementById('wBack').addEventListener('click', () => _goTo(2));
  document.getElementById('wNext').addEventListener('click', () => _goTo(4));
}

// ----- step 4: preview -----

function _renderPreview() {
  const w = _w();
  const b = _bracket();
  const rounds = _rounds();
  const courtNames = w.allCourts.filter((c) => w.courts.includes(c.id)).map((c) => c.name.replace(/^Court\s*/i, ''));
  document.getElementById('wizardCard').innerHTML = `
    <div class="wz-step5">
      ${wizardHeroHTML({
    name: w.name,
    meta: `${b.draw}-draw · single elimination · ${K.fmtMD(rounds[0].date)} – ${K.fmtMD(rounds[rounds.length - 1].date)} · Court${courtNames.length === 1 ? '' : 's'} ${esc(courtNames.join(', '))}`,
    stats: [[b.ent, 'Entrants'], [b.draw, 'Draw'], [b.byes, b.byes === 1 ? 'Bye' : 'Byes'], [b.R, 'Rounds']],
  })}
      <div class="wz-card">
        <div class="wz-card5head"><span class="wz-label">Bracket</span><button class="btn btn-outline btn-sm wz-editbtn" id="koEditSeeding">Edit seeding</button></div>
        <div class="ko-treepad">${bracketTreeHTML(b, { compact: true, plainHeads: true, short: true, live: false })}</div>
      </div>
      <div class="wz-card">
        <div class="wz-card5head"><span class="wz-label">Schedule</span><button class="btn btn-outline btn-sm wz-editbtn" id="koEditSchedule">Edit schedule</button></div>
        <div class="ko-schedbody">${_plans().map((r) => `
          <div class="ko-prevrow"><span class="ko-prevrow-name">${r.name}</span><span class="ko-prevrow-line">${r.previewLine}</span></div>`).join('')}
        </div>
      </div>
      <div class="wz-card wz-foot5">
        <span class="wz-foot-note">Matches, byes and court slots are created when you create the tournament. Players are told their first match.</span>
        <span id="wError" class="wz-foot-err"></span>
        <span class="wz-foot-btns">
          <button class="btn btn-outline" id="wBack">Back</button>
          <button class="btn btn-primary btn-lg" id="koCreate">Create Tournament</button>
        </span>
      </div>
    </div>`;
  document.getElementById('koEditSeeding').addEventListener('click', () => _goTo(2));
  document.getElementById('koEditSchedule').addEventListener('click', () => _goTo(3));
  document.getElementById('wBack').addEventListener('click', () => _goTo(3));
  document.getElementById('koCreate').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { id } = await window.api.createTournament({
        tournamentId: w.tournamentId,
        name: w.name.trim(),
        drawCap: w.cap,
        entrants: w.entrants.map((p) => p.id),
        seeding: w.seeding,
        rounds,
        courtIds: w.courts,
        len: w.len,
        buffer: w.buffer,
      });
      toast(`${w.name.trim()} created`, 'success');
      state.koWizard = null;
      window.navigate('tournamentDetail', { tournamentId: id });
    } catch (err) {
      _setError(err.message || 'Could not create the tournament.');
      e.target.disabled = false;
    }
  });
}
