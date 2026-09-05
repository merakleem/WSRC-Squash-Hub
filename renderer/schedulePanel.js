import { state } from './state.js';
import { esc, toast } from './utils.js';

// ===== BOOKING PANEL =====
// One right-hand panel for every booking an admin creates or edits, replacing
// the three modals the schedule used to open (new / grid-drag / edit). The
// modals differed only in which fields they hid, which meant three places to
// keep in step; this is one surface whose mode decides what it shows.
//
// New bookings get two steps - Details, then Repeat - because repeating is the
// less common half and pushing it behind a step keeps the first screen short.
// Editing has no steps: an existing booking's repeat rules are not editable
// here, only its details and whether it lives.

const DAY_START = 6 * 60;
const DAY_END   = 23 * 60;
const STEP      = 15;          // admins book to the quarter hour
const MAX_PLAYERS = 4;

const DOW_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DOW_INDEX  = [1, 2, 3, 4, 5, 6, 0];   // JS getDay() for each label above

// ── Formatting ────────────────────────────────────────────────────────────────
function fmt(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, '0')}`;
}
function fmtAp(m) {
  return `${fmt(m)} ${Math.floor(m / 60) < 12 ? 'AM' : 'PM'}`;
}
// "7:00–8:30 PM" - the meridiem rides on the end, where it is unambiguous.
function fmtRange(s, d) {
  return `${fmt(s)}–${fmtAp(s + d)}`;
}
function durLabel(d) {
  const h = Math.floor(d / 60), m = d % 60;
  return (h ? `${h}h` : '') + (h && m ? ' ' : '') + (m ? `${m}m` : '');
}
function minToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function timeToMin(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}
function initials(n) {
  return String(n || '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}
function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Panel state ───────────────────────────────────────────────────────────────
let p = null;    // null when closed
let root = null; // the DOM the panel owns

export function isBookingPanelOpen() { return !!p; }

export function closeBookingPanel() {
  if (!p) return;
  const onClose = p.onClose;
  p = null;
  root?.remove();
  root = null;
  document.removeEventListener('keydown', _onKey, true);
  onClose?.();
}

function _onKey(e) {
  if (e.key !== 'Escape' || !p) return;
  e.stopPropagation();
  closeBookingPanel();
}

/**
 * Open the panel.
 *
 * mode      'new' | 'edit'
 * host      element to mount into (the panel positions itself absolutely in it)
 * courts    [{id,name}]           all active courts, in grid order
 * slots     the day's slots        for the overlap warning
 * types     booking types          for the type chips
 * players   every club player      for the search
 * courtIds  pre-selected courts    (new)
 * start/dur pre-filled range       (new)
 * slot      the booking being edited (edit)
 * onRange   (courtIds,start,dur) => void — lets the grid draw the pending range
 * onDone    (selectId) => void — a write landed; re-render and select that block
 * notify    (text, undoable) => void — the page's toast
 * onClose   () => void
 * pushUndo  (op) => void
 */
export async function openBookingPanel(opts) {
  const { mode, host, courts, slots, types, players } = opts;

  if (p) closeBookingPanel();

  const editSlot = mode === 'edit' ? opts.slot : null;
  const editStart = editSlot ? timeToMin(editSlot.startTime) : null;

  const courtIds = mode === 'edit'
    ? (editSlot.courtIds?.length ? [...editSlot.courtIds] : [editSlot.courtId])
    : (opts.courtIds?.length ? [...opts.courtIds] : [courts[0]?.id].filter(Boolean));

  const start = mode === 'edit' ? editStart : opts.start;
  const dur   = mode === 'edit' ? editSlot.durationMinutes : (opts.dur || 60);

  const [dy, dm, dd] = state.scheduleDate.split('-').map(Number);

  p = {
    mode,
    step: 1,
    courts, slots, types, players,
    editSlot,
    // The rows this booking already owns, so it never warns about itself.
    ownIds: editSlot ? new Set(editSlot.memberIds || [editSlot.id]) : new Set(),
    courtIds,
    start: Math.max(DAY_START, Math.min(start ?? DAY_START, DAY_END - STEP)),
    dur: Math.max(STEP, dur),
    typeId: editSlot ? (editSlot.bookingTypeId || null) : null,
    name: editSlot ? (editSlot.name || '') : '',
    chosen: editSlot ? (editSlot.players || []).map((x) => ({ id: x.id, name: x.name })) : [],
    search: '',
    dows: [new Date(dy, dm - 1, dd).getDay()],
    weeks: 4,
    indefinite: false,
    conflict: 'skip',
    askingDelete: false,
    busy: false,
    onRange: opts.onRange || null,
    onDone: opts.onDone || null,
    notify: opts.notify || null,
    onClose: opts.onClose || null,
    pushUndo: opts.pushUndo || (() => {}),
  };

  root = document.createElement('div');
  root.className = 'sch-panel-root';
  root.innerHTML = `<div class="sch-panel-scrim"></div><aside class="sch-panel"></aside>`;
  host.appendChild(root);
  root.querySelector('.sch-panel-scrim').addEventListener('click', () => closeBookingPanel());
  document.addEventListener('keydown', _onKey, true);

  paint();
}

// The pending range, echoed onto the grid so the panel and the grid never
// disagree about what is about to be booked.
function pushRange() {
  if (!p?.onRange) return;
  p.onRange(p.mode === 'new' ? p.courtIds : [], p.start, p.dur);
}

// ── Derived ───────────────────────────────────────────────────────────────────
function typeOf(id) {
  return p.types.find((t) => t.id === id) || null;
}
function typeColor(id) {
  return typeOf(id)?.color || '#3550c8';
}
function courtName(id) {
  return p.courts.find((c) => c.id === id)?.name || '';
}

// How many existing bookings the pending range runs into, on any chosen court.
function clashCount() {
  let n = 0;
  for (const s of p.slots) {
    const ids = s.courtIds?.length ? s.courtIds : [s.courtId];
    if (!ids.some((id) => p.courtIds.includes(id))) continue;
    if (p.ownIds.has(s.id)) continue;
    const sm = timeToMin(s.startTime);
    if (sm === null) continue;
    if (p.start < sm + s.durationMinutes && sm < p.start + p.dur) n++;
  }
  return n;
}

// Court picks are read as contiguous runs. Adjacent courts make one wide
// booking; a scattered pick makes one booking per run when creating, and is
// not saveable when editing - an existing booking is a single block of court.
function courtIdx(id) {
  return p.courts.findIndex((c) => c.id === id);
}
function sortedCourtIds() {
  return [...p.courtIds].sort((a, b) => courtIdx(a) - courtIdx(b));
}
function contiguousRuns() {
  const runs = [];
  sortedCourtIds().forEach((id) => {
    const last = runs[runs.length - 1];
    if (last && courtIdx(last[last.length - 1]) + 1 === courtIdx(id)) last.push(id);
    else runs.push([id]);
  });
  return runs;
}
function isContiguous() {
  return contiguousRuns().length <= 1;
}
function canSave() {
  return p.courtIds.length > 0 && !(p.mode === 'edit' && !isContiguous());
}
function courtsHint() {
  if (!p.courtIds.length) return 'Pick at least one';
  if (p.courtIds.length === 1) return '';
  if (isContiguous()) return `One booking across ${p.courtIds.length} courts`;
  return p.mode === 'edit' ? 'Courts must sit side by side' : 'Separate bookings for non-adjacent courts';
}
// What the block will be called: the label, else the first player, else the type.
function savedTitle() {
  return p.name.trim() || p.chosen[0]?.name || typeOf(p.typeId)?.name || 'Standard';
}

function searchResults() {
  const q = p.search.trim().toLowerCase();
  if (!q) return [];
  return p.players
    .filter((x) => x.name?.toLowerCase().includes(q) && !p.chosen.some((c) => c.id === x.id))
    .slice(0, 5);
}

function summaryLine() {
  const names = p.courtIds.map(courtName).filter(Boolean);
  const parts = [
    names.length ? names.join(', ') : 'No court selected',
    shortDate(state.scheduleDate),
    fmtRange(p.start, p.dur),
  ];
  if (p.mode === 'new' && p.step === 2 && p.dows.length) {
    parts.push(p.indefinite ? 'repeats indefinitely' : `repeats for ${p.weeks} week${p.weeks === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

// ── Markup ────────────────────────────────────────────────────────────────────
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

function headHTML() {
  const isEdit = p.mode === 'edit';
  const names = p.courtIds.map(courtName).filter(Boolean);
  const title = isEdit
    ? (p.name || p.editSlot?.title || 'Booking')
    : (names.length > 1 ? `${names.length} courts` : names[0] || 'Pick a court');

  return `
    <div class="sch-panel-head">
      <div class="sch-panel-headrow">
        <div class="sch-panel-titles">
          <span class="sch-panel-kicker">${isEdit ? 'Edit booking' : 'New booking'}</span>
          <span class="sch-panel-title">${esc(title)}</span>
          <span class="sch-panel-when">${esc(longDate(state.scheduleDate))} · ${esc(fmtAp(p.start))}</span>
        </div>
        <button class="sch-panel-x" id="schPanelClose" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      ${isEdit ? '' : `
        <div class="sch-panel-steps">
          <button class="sch-panel-step${p.step === 1 ? ' is-on' : ''}" data-step="1">1 · Details</button>
          <span class="sch-panel-steprule"></span>
          <button class="sch-panel-step${p.step === 2 ? ' is-on' : ''}" data-step="2">2 · Repeat</button>
        </div>`}
    </div>`;
}

function detailsHTML() {
  const clashes = clashCount();
  const startCanDown = p.start - STEP >= DAY_START;
  const startCanUp   = p.start + STEP + p.dur <= DAY_END;
  const durCanDown   = p.dur > STEP;
  const durCanUp     = p.start + p.dur + STEP <= DAY_END;

  const courtChips = p.courts.map((c) => {
    const on = p.courtIds.includes(c.id);
    return `<button class="sch-chip${on ? ' is-on' : ''}" data-court="${c.id}">${esc(c.name)}</button>`;
  }).join('');

  // Standard is the absence of a type, so it leads the row as its own chip
  // rather than hiding behind "no selection".
  const typeChips = [{ id: null, name: 'Standard', color: '#3550c8' }, ...p.types].map((t) => {
    const on = (t.id ?? null) === (p.typeId ?? null);
    return `<button class="sch-tchip${on ? ' is-on' : ''}" data-type="${t.id ?? ''}">
      <span class="sch-tchip-dot" style="background:${esc(t.color || '#3550c8')}"></span>${esc(t.name)}
    </button>`;
  }).join('');

  const chips = p.chosen.map((x) => `
    <span class="sch-pchip">${esc(x.name)}
      <button class="sch-pchip-x" data-drop="${x.id}" aria-label="Remove">×</button>
    </span>`).join('');

  return `
    <div class="sch-panel-section">
      <div class="sch-panel-labelrow">
        <span class="sch-panel-label">Courts</span>
        ${courtsHint() ? `<span class="sch-panel-courtshint">${esc(courtsHint())}</span>` : ''}
      </div>
      <div class="sch-chiprow">${courtChips}</div>
    </div>

    <div class="sch-panel-section">
      <div class="sch-panel-labelrow">
        <span class="sch-panel-label">Time</span>
        <span class="sch-panel-range">${esc(fmtRange(p.start, p.dur))}</span>
      </div>
      <div class="sch-stepper-row">
        <div class="sch-stepper">
          <button class="sch-step-btn"${startCanDown ? '' : ' disabled'} data-act="start-">−</button>
          <span class="sch-step-val">${esc(fmtAp(p.start))}</span>
          <button class="sch-step-btn"${startCanUp ? '' : ' disabled'} data-act="start+">+</button>
        </div>
        <div class="sch-stepper">
          <button class="sch-step-btn"${durCanDown ? '' : ' disabled'} data-act="dur-">−</button>
          <span class="sch-step-val">${esc(durLabel(p.dur))}</span>
          <button class="sch-step-btn"${durCanUp ? '' : ' disabled'} data-act="dur+">+</button>
        </div>
      </div>
      ${clashes ? `<div class="sch-panel-warn">Overlaps ${clashes} existing booking${clashes === 1 ? '' : 's'}</div>` : ''}
    </div>

    <div class="sch-panel-section">
      <span class="sch-panel-label">Booking type</span>
      <div class="sch-chiprow">${typeChips}</div>
    </div>

    <div class="sch-panel-section">
      <div class="sch-panel-labelrow">
        <span class="sch-panel-label">Label</span>
        <span class="sch-panel-optional">Optional</span>
      </div>
      <input class="sch-panel-input" id="schPanelName" value="${esc(p.name)}" placeholder="e.g. Junior training" autocomplete="off">
    </div>

    <div class="sch-panel-section">
      <div class="sch-panel-labelrow">
        <span class="sch-panel-label">Players</span>
        <span class="sch-panel-room">${MAX_PLAYERS - p.chosen.length} of ${MAX_PLAYERS} free</span>
      </div>
      ${p.chosen.length ? `<div class="sch-pchips">${chips}</div>` : ''}
      ${p.chosen.length < MAX_PLAYERS ? `
        <div class="sch-search-wrap">
          <input class="sch-panel-input" id="schPanelSearch" value="${esc(p.search)}" placeholder="Search club players…" autocomplete="off">
          <div class="sch-search-drop" id="schPanelResults"></div>
        </div>` : ''}
    </div>`;
}

function resultsHTML() {
  const q = p.search.trim();
  if (!q) return '';
  const rows = searchResults();
  if (!rows.length) return `<div class="sch-search-empty">No players found</div>`;
  return rows.map((x) => `
    <button class="sch-search-row" data-add="${x.id}">
      <span class="sch-search-av">${esc(initials(x.name))}</span>
      <span class="sch-search-name">${esc(x.name)}</span>
    </button>`).join('');
}

function repeatHTML() {
  const dows = DOW_LABELS.map((label, i) => {
    const idx = DOW_INDEX[i];
    const on = p.dows.includes(idx);
    return `<button class="sch-dow${on ? ' is-on' : ''}" data-dow="${idx}">${label}</button>`;
  }).join('');

  const hint = p.indefinite
    ? 'Creates a year of events and keeps going.'
    : `Creates ${p.dows.length * p.weeks} event${p.dows.length * p.weeks === 1 ? '' : 's'}.`;

  return `
    <div class="sch-panel-section">
      <span class="sch-panel-label">Repeat on</span>
      <div class="sch-dowrow">${dows}</div>
    </div>

    <div class="sch-panel-section">
      <span class="sch-panel-label">Repeat for</span>
      <div class="sch-weeks-row">
        <div class="sch-stepper sch-stepper--weeks${p.indefinite ? ' is-off' : ''}">
          <button class="sch-step-btn"${!p.indefinite && p.weeks > 1 ? '' : ' disabled'} data-act="weeks-">−</button>
          <span class="sch-step-val">${p.weeks} week${p.weeks === 1 ? '' : 's'}</span>
          <button class="sch-step-btn"${!p.indefinite && p.weeks < 52 ? '' : ' disabled'} data-act="weeks+">+</button>
        </div>
        <button class="sch-indef${p.indefinite ? ' is-on' : ''}" data-act="indef">
          <span class="sch-indef-box">${CHECK_SVG}</span>Indefinitely
        </button>
      </div>
      <span class="sch-panel-hint">${hint}</span>
    </div>

    <div class="sch-panel-section">
      <span class="sch-panel-label">If a slot is taken</span>
      <div class="sch-segment">
        <button class="sch-seg${p.conflict === 'skip' ? ' is-on' : ''}" data-act="skip">Skip it</button>
        <button class="sch-seg${p.conflict === 'overwrite' ? ' is-on' : ''}" data-act="overwrite">Overwrite it</button>
      </div>
    </div>`;
}

function deleteHTML() {
  if (!p.askingDelete) return '';
  const repeats = !!p.editSlot?.repeatGroupId;
  return `
    <div class="sch-del">
      <span class="sch-del-prompt">${repeats
        ? 'This is a repeating booking. Which events should be deleted?'
        : 'Delete this booking and release the court? You can undo right after.'}</span>
      ${repeats ? `
        <div class="sch-del-scopes">
          <button class="sch-del-btn" data-del="this">This event</button>
          <button class="sch-del-btn" data-del="future">This &amp; all future</button>
          <button class="sch-del-btn" data-del="all">All events</button>
        </div>
        <button class="sch-del-keeplink" data-del="keep">Keep the booking</button>
      ` : `
        <div class="sch-del-simple">
          <button class="sch-del-keep" data-del="keep">Keep it</button>
          <button class="sch-del-btn" data-del="this">Delete booking</button>
        </div>`}
    </div>`;
}

function footHTML() {
  const isEdit = p.mode === 'edit';
  const onRepeat = p.mode === 'new' && p.step === 2;
  const primary   = isEdit ? 'Save changes' : onRepeat ? 'Add bookings' : 'Add booking';
  const secondary = isEdit ? 'Close' : onRepeat ? 'Back' : 'Make it repeat';

  return `
    <div class="sch-panel-foot">
      <div class="sch-panel-summary">
        <span class="sch-panel-sumdot" style="background:${esc(typeColor(p.typeId))}"></span>
        <span>${esc(summaryLine())}</span>
      </div>
      <div class="sch-panel-btns">
        <button class="sch-panel-secondary" id="schPanelSecondary">${secondary}</button>
        <button class="sch-panel-primary" id="schPanelPrimary"${p.busy || !canSave() ? ' disabled' : ''}>${p.busy ? 'Saving…' : primary}</button>
      </div>
      ${isEdit && !p.askingDelete ? `<button class="sch-panel-del" id="schPanelDelete">Delete booking</button>` : ''}
    </div>`;
}

// ── Paint ─────────────────────────────────────────────────────────────────────
// The whole panel repaints on any change except typing, which updates only the
// pieces that depend on it - a repaint under the caret would lose it.
function paint() {
  if (!p || !root) return;
  const aside = root.querySelector('.sch-panel');
  const scrollTop = aside.querySelector('.sch-panel-body')?.scrollTop ?? 0;
  const onRepeat = p.mode === 'new' && p.step === 2;

  aside.innerHTML = `
    ${headHTML()}
    <div class="sch-panel-body">
      ${onRepeat ? repeatHTML() : detailsHTML()}
      ${deleteHTML()}
    </div>
    ${footHTML()}`;

  const body = aside.querySelector('.sch-panel-body');
  if (body) body.scrollTop = scrollTop;
  const res = aside.querySelector('#schPanelResults');
  if (res) res.innerHTML = resultsHTML();

  wire(aside);
  pushRange();
}

function repaintFoot() {
  const aside = root?.querySelector('.sch-panel');
  if (!aside) return;
  aside.querySelector('.sch-panel-foot')?.remove();
  aside.insertAdjacentHTML('beforeend', footHTML());
  wireFoot(aside);
}

function wire(aside) {
  aside.querySelector('#schPanelClose')?.addEventListener('click', () => closeBookingPanel());

  aside.querySelectorAll('.sch-panel-step').forEach((b) => b.addEventListener('click', () => {
    p.step = Number(b.dataset.step);
    paint();
  }));

  aside.querySelectorAll('[data-court]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.court);
    p.courtIds = p.courtIds.includes(id) ? p.courtIds.filter((x) => x !== id) : [...p.courtIds, id];
    paint();
  }));

  aside.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    p.typeId = b.dataset.type === '' ? null : Number(b.dataset.type);
    paint();
  }));

  aside.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'start-' && p.start - STEP >= DAY_START) p.start -= STEP;
    else if (a === 'start+' && p.start + STEP + p.dur <= DAY_END) p.start += STEP;
    else if (a === 'dur-' && p.dur > STEP) p.dur -= STEP;
    else if (a === 'dur+' && p.start + p.dur + STEP <= DAY_END) p.dur += STEP;
    else if (a === 'weeks-' && !p.indefinite && p.weeks > 1) p.weeks--;
    else if (a === 'weeks+' && !p.indefinite && p.weeks < 52) p.weeks++;
    else if (a === 'indef') p.indefinite = !p.indefinite;
    else if (a === 'skip') p.conflict = 'skip';
    else if (a === 'overwrite') p.conflict = 'overwrite';
    else return;
    paint();
  }));

  aside.querySelectorAll('[data-dow]').forEach((b) => b.addEventListener('click', () => {
    const idx = Number(b.dataset.dow);
    p.dows = p.dows.includes(idx) ? p.dows.filter((x) => x !== idx) : [...p.dows, idx];
    paint();
  }));

  aside.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', () => {
    p.chosen = p.chosen.filter((x) => x.id !== Number(b.dataset.drop));
    paint();
  }));

  // Typing never repaints the panel; only what depends on it.
  const nameEl = aside.querySelector('#schPanelName');
  nameEl?.addEventListener('input', () => { p.name = nameEl.value; repaintFoot(); });

  const searchEl = aside.querySelector('#schPanelSearch');
  searchEl?.addEventListener('input', () => {
    p.search = searchEl.value;
    const res = aside.querySelector('#schPanelResults');
    if (res) { res.innerHTML = resultsHTML(); wireResults(aside); }
  });
  wireResults(aside);

  aside.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const what = b.dataset.del;
    if (what === 'keep') { p.askingDelete = false; paint(); return; }
    doDelete(what);
  }));

  wireFoot(aside);
}

function wireResults(aside) {
  aside.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const id = Number(b.dataset.add);
    const found = p.players.find((x) => x.id === id);
    if (found && p.chosen.length < MAX_PLAYERS) p.chosen.push({ id: found.id, name: found.name });
    p.search = '';
    paint();
  }));
}

function wireFoot(aside) {
  aside.querySelector('#schPanelDelete')?.addEventListener('click', () => { p.askingDelete = true; paint(); });
  aside.querySelector('#schPanelPrimary')?.addEventListener('click', submit);
  aside.querySelector('#schPanelSecondary')?.addEventListener('click', () => {
    if (p.mode === 'edit') { closeBookingPanel(); return; }
    p.step = p.step === 2 ? 1 : 2;
    paint();
  });
}

// ── Writes ────────────────────────────────────────────────────────────────────
function bookingData() {
  return {
    courtId: p.courtIds[0] ?? null,
    courtIds: p.courtIds.length > 1 ? [...p.courtIds] : null,
    date: state.scheduleDate,
    startTime: minToTime(p.start),
    durationMinutes: p.dur,
    bookingTypeId: p.typeId,
    name: p.name.trim() || null,
    info: null,
    playerIds: p.chosen.map((x) => x.id),
  };
}

async function submit() {
  if (!p || p.busy || !canSave()) return;

  // Everything this needs is read before the first await. closeBookingPanel()
  // drops the panel state, so anything read after it would be reading null.
  const mode = p.mode;
  const repeating = mode === 'new' && p.step === 2;
  if (repeating && !p.dows.length) {
    toast('Pick at least one day to repeat on', 'error');
    return;
  }

  const base = bookingData();
  const runs = contiguousRuns();
  const title = savedTitle();
  const editSlot = p.editSlot;
  const repeat = {
    startDate: state.scheduleDate,
    daysOfWeek: [...p.dows],
    weeks: p.indefinite ? 52 : p.weeks,
    conflictMode: p.conflict,
  };
  const onDone = p.onDone;
  const notify = p.notify || ((text) => toast(text));
  const pushUndo = p.pushUndo;
  const runData = (run) => ({ ...base, courtId: run[0], courtIds: run.length > 1 ? run : null });

  p.busy = true;
  repaintFoot();

  try {
    if (mode === 'edit') {
      // An edit is contiguous by canSave(), so runs[0] is the whole selection.
      pushUndo({ type: 'update', id: editSlot.id, oldData: {
        courtId: editSlot.courtId, courtIds: editSlot.courtIds || null,
        date: editSlot.date || state.scheduleDate, startTime: editSlot.startTime,
        durationMinutes: editSlot.durationMinutes, bookingTypeId: editSlot.bookingTypeId || null,
        name: editSlot.name || null, info: editSlot.info || null,
        playerIds: (editSlot.players || []).map((x) => x.id),
      } });
      await window.api.updateBooking(editSlot.id, runData(runs[0]));
      closeBookingPanel();
      notify(`Saved ${title}`, false);
      onDone?.(editSlot.id);
    } else if (repeating) {
      let created = 0, skipped = 0;
      const ids = [];
      for (const run of runs) {
        const r = await window.api.addRepeatBookings({ ...runData(run), repeat });
        created += r.created;
        skipped += r.skipped;
        if (Array.isArray(r.ids)) ids.push(...r.ids);
      }
      if (ids.length) pushUndo({ type: 'delete-ids', ids });
      closeBookingPanel();
      let msg = `Added ${created} booking${created === 1 ? '' : 's'}`;
      if (skipped) msg += ` · ${skipped} skipped`;
      notify(msg, ids.length > 0);
      onDone?.(ids[0] ?? null);
    } else {
      // One booking per contiguous run of courts.
      const madeIds = [];
      for (const run of runs) {
        const made = await window.api.addBooking(runData(run));
        if (made?.id) madeIds.push(made.id);
      }
      if (madeIds.length) pushUndo({ type: 'delete-ids', ids: madeIds });
      closeBookingPanel();
      notify(runs.length > 1 ? `Added ${runs.length} bookings` : `Added ${title}`, madeIds.length > 0);
      onDone?.(madeIds[0] ?? null);
    }
  } catch (err) {
    toast(err.message, 'error');
    if (p) { p.busy = false; repaintFoot(); }
  }
}

async function doDelete(scope) {
  if (!p || p.busy) return;
  const slot = p.editSlot;
  const onDone = p.onDone;
  const notify = p.notify || ((text) => toast(text));
  const pushUndo = p.pushUndo;
  const title = slot.title || savedTitle();
  let opts;
  if (scope === 'future') opts = { scope: 'future', groupId: slot.repeatGroupId, date: slot.date || state.scheduleDate };
  else if (scope === 'all') opts = { scope: 'all', groupId: slot.repeatGroupId };

  try {
    await window.api.deleteBooking(slot.id, opts);
    if (!opts) {
      // A single event can be undone; a scope delete removes rows this page
      // has never seen, so its toast makes no promise it cannot keep.
      pushUndo({ type: 'recreate', bookings: [{
        courtId: slot.courtId, courtIds: slot.courtIds || null,
        date: slot.date || state.scheduleDate, startTime: slot.startTime,
        durationMinutes: slot.durationMinutes, bookingTypeId: slot.bookingTypeId || null,
        name: slot.name || null, info: slot.info || null,
        players: slot.players || [],
      }] });
    }
    closeBookingPanel();
    notify(
      scope === 'future' ? 'Deleted this and all future events'
        : scope === 'all' ? 'Deleted all events'
        : `Deleted ${title}`,
      !opts
    );
    onDone?.(null);
  } catch (err) {
    toast(err.message, 'error');
  }
}
