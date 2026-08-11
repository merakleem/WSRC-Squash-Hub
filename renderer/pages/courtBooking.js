import { state } from '../state.js';
import { esc, toast } from '../utils.js';

// ── Constants ─────────────────────────────────────────────────────────────────
// The grid stops at 11pm to match the admin schedule page, which uses the same
// bound. Letting players book later than the schedule renders would produce
// bookings staff could not see.
const DAY_START = 6 * 60, DAY_END = 23 * 60, SLOT_MIN = 30;
const DROW = 38;                      // pixel height of one 30-minute step
const GRID_H = (DAY_END - DAY_START) / SLOT_MIN * DROW;

// ── Page state ────────────────────────────────────────────────────────────────
let cb = {};
let _instance = 0;

// ── Time helpers ──────────────────────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(min) {
  return `${String(Math.floor(min / 60)).padStart(2,'0')}:${String(min % 60).padStart(2,'0')}`;
}

function fmtTime(min) {
  let h = Math.floor(min / 60), m = min % 60;
  const ap = (h < 12 || h === 24) ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2,'0')} ${ap}`;
}

// Grid slot labels carry no meridiem: the hour is already on the gutter beside
// them, and the column is only ~150px wide.
function fmtShort(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2,'0')}`;
}

// Rail labels carry the meridiem on the hour and bare minutes in between, so a
// time is never ambiguous while staying short enough for a 62px pill.
function fmtPill(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${h >= 12 ? 'PM' : 'AM'}` : `${h12}:${String(m).padStart(2,'0')}`;
}

// "5:00–6:00 PM" when both ends share a meridiem, "11:00 AM – 1:00 PM" when
// they do not.
function fmtRange(startMin, durMin) {
  const a = fmtTime(startMin), b = fmtTime(startMin + durMin);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a} – ${b}`;
}

function topFor(min) {
  return (min - DAY_START) / SLOT_MIN * DROW;
}

function nowMin() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function durLabel(d) {
  if (d < 60) return `${d} min`;
  const h = Math.floor(d / 60), m = d % 60;
  return `${h}${m ? '.5' : ''} hr${(h > 1 || m) ? 's' : ''}`;
}

function isMobile() {
  return window.innerWidth <= 768;
}

const WD_LONG  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WD_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MO_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtDateDisplay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return { weekday: WD_LONG[d.getDay()], monthDay: `${MO_LONG[d.getMonth()]} ${d.getDate()}` };
}

// "Wed, Aug 12" for the summary line.
function fmtShortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${WD_SHORT[d.getDay()]}, ${MO_LONG[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

function fmtLongDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${WD_LONG[d.getDay()]}, ${MO_LONG[d.getMonth()]} ${d.getDate()}`;
}

function isMine(slot) {
  const pid = state.currentUser?.playerId;
  return pid != null && Array.isArray(slot.players) && slot.players.some(p => p.id === pid);
}

function getCourtSlots(dateStr, courtId) {
  const data = cb.scheduleCache?.[dateStr];
  if (!data) return [];
  return (data.slots || [])
    .filter(s => s.courtId === courtId)
    .map(s => ({ ...s, startMin: timeToMin(s.startTime) }))
    .sort((a, b) => a.startMin - b.startMin);
}

function getMaxEnd(slots, startMin, editId = null) {
  let end = DAY_END;
  for (const s of slots) {
    if (editId != null && String(s.id) === String(editId)) continue;
    if (s.startMin >= startMin && s.startMin < end) end = s.startMin;
  }
  return end;
}

function _initials(n) {
  return String(n || '').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function myName() {
  const me = state.players?.find(p => p.id === state.currentUser?.playerId);
  return me?.name || 'You';
}

function _panelStartMin() {
  const isEdit = cb.panel === 'edit';
  return isEdit
    ? (cb.panelBooking?.startMin ?? timeToMin(cb.panelBooking?.startTime || '00:00'))
    : cb.panelStartMin;
}

function _panelDate() {
  return cb.panel === 'edit' ? (cb.panelBooking?.date || cb.date) : cb.date;
}

// ── Entry ─────────────────────────────────────────────────────────────────────
export function renderCourtBooking() {
  _instance++;

  if (cb.refreshInterval) clearInterval(cb.refreshInterval);
  if (cb.reservation?.timerId) clearInterval(cb.reservation.timerId);

  const today = todayStr();
  cb = {
    date: today,
    calMonth: today.slice(0, 7),
    calOpen: false,
    tab: 'book',
    courtId: null,
    courts: [],
    scheduleCache: {},
    myBookings: [],
    listConfirm: null,
    status: 'loading',
    panel: null,
    panelBooking: null,
    panelStartMin: null,
    panelDuration: 30,
    panelPlayers: [],
    panelSearch: '',
    panelBusy: false,
    panelAskCancel: false,
    reservation: null,
    refreshInterval: null,
  };

  const content = document.querySelector('.content');
  content.classList.add('content--court-booking');
  content.innerHTML = '<div id="cbPage" class="cb-page"></div>';

  _init();
}

async function _init() {
  const myInstance = _instance;
  try {
    const courts = await window.api.getCourts();
    if (_instance !== myInstance) return;
    cb.courts = courts.filter(c => c.active);
    if (cb.courts.length > 0) cb.courtId = cb.courts[0].id;
    await _loadSchedule(cb.date);
    if (_instance !== myInstance) return;
    _loadMyBookings();
    _render();
    _scrollToNow();

    cb.refreshInterval = setInterval(async () => {
      if (_instance !== myInstance) { clearInterval(cb.refreshInterval); return; }
      try {
        const data = await window.api.getSchedule(cb.date);
        if (_instance !== myInstance) return;
        cb.scheduleCache[cb.date] = data;
        _renderBody();
      } catch (_) {}
    }, 30000);
  } catch (e) {
    if (_instance !== myInstance) return;
    cb.status = 'error';
    _render();
  }
}

async function _loadSchedule(dateStr) {
  if (cb.scheduleCache[dateStr]) { cb.status = 'ok'; return; }
  cb.status = 'loading';
  _renderBody();
  try {
    const data = await window.api.getSchedule(dateStr);
    cb.scheduleCache[dateStr] = data;
    cb.status = 'ok';
  } catch (_) {
    cb.status = 'error';
  }
  _renderBody();
}

// The list spans dates, so it is its own read rather than a stitch of day
// fetches. Failure is silent: an empty My Bookings is a worse outcome than a
// missing count, but neither should stop someone booking a court.
async function _loadMyBookings() {
  const myInstance = _instance;
  try {
    const rows = await window.api.getMyBookings();
    if (_instance !== myInstance) return;
    cb.myBookings = (rows || []).map(b => ({ ...b, startMin: timeToMin(b.startTime) }));
    _refreshTabs();
    if (cb.tab === 'mine' || isMobile()) _renderBody();
  } catch (_) {}
}

function _scrollToNow() {
  const wrap = document.getElementById('cbGridWrap');
  if (!wrap) return;
  const isToday = cb.date === todayStr();
  wrap.scrollTop = Math.max(0, topFor(isToday ? nowMin() : 16 * 60) - 90);
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const ICON = {
  chevL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  cal:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  pencil:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
};

// ── Tabs ──────────────────────────────────────────────────────────────────────
function _buildTabs() {
  const n = cb.myBookings.length;
  return `
    <div class="cb-tabs" role="tablist">
      <button class="cb-tab${cb.tab === 'book' ? ' cb-tab--active' : ''}" data-tab="book" role="tab"
        aria-selected="${cb.tab === 'book'}">Book a Court</button>
      <button class="cb-tab${cb.tab === 'mine' ? ' cb-tab--active' : ''}" data-tab="mine" role="tab"
        aria-selected="${cb.tab === 'mine'}">My Bookings${n ? `<span class="cb-tab-count">${n}</span>` : ''}</button>
    </div>`;
}

function _refreshTabs() {
  const host = document.getElementById('pageTitle');
  if (!host || isMobile()) return;
  host.innerHTML = _buildTabs();
  _attachTabListeners();
}

function _attachTabListeners() {
  document.querySelectorAll('.cb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const next = tab.dataset.tab;
      if (next === cb.tab) return;
      cb.tab = next;
      // Switching away abandons anything half-started: an open panel would be
      // describing a slot the player can no longer see.
      if (cb.panel) _closePanel();
      cb.listConfirm = null;
      _refreshTabs();
      _renderBody();
      if (cb.tab === 'book') _scrollToNow();
    });
  });
}

// ── Date row ──────────────────────────────────────────────────────────────────
function _weekStrip() {
  // Seven days from today, not a calendar week: the strip is for "the next few
  // days", and a Sunday start would waste most of it on days already gone.
  const today = todayStr();
  return Array.from({ length: 7 }, (_, i) => addDays(today, i)).map(d => {
    const dt = new Date(d + 'T12:00:00');
    const sel = d === cb.date;
    const isToday = d === today;
    return `<button class="cb-day${sel ? ' cb-day--sel' : ''}" data-date="${d}">
      <span class="cb-day-wd">${WD_SHORT[dt.getDay()][0]}</span>
      <span class="cb-day-n">${dt.getDate()}</span>
      <span class="cb-day-dot${!sel && isToday ? ' cb-day-dot--on' : ''}"></span>
    </button>`;
  }).join('');
}

function _calendarHTML() {
  if (!cb.calOpen) return '';
  const [y, m] = cb.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = first.getDay();
  const today = todayStr();

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cb-cal-cell cb-cal-cell--blank"></span>');
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const past = iso < today;
    const sel = iso === cb.date;
    const isToday = iso === today;
    cells.push(`<button class="cb-cal-cell${sel ? ' cb-cal-cell--sel' : ''}${!sel && isToday ? ' cb-cal-cell--today' : ''}${past ? ' cb-cal-cell--past' : ''}"
      data-caldate="${iso}"${past ? ' disabled' : ''}>${d}</button>`);
  }

  return `
    <div class="cb-cal" id="cbCal">
      <div class="cb-cal-head">
        <span class="cb-cal-month">${MO_LONG[m - 1]} ${y}</span>
        <div class="cb-cal-navs">
          <button class="cb-cal-nav" id="cbCalPrev" aria-label="Previous month">${ICON.chevL}</button>
          <button class="cb-cal-nav" id="cbCalNext" aria-label="Next month">${ICON.chevR}</button>
        </div>
      </div>
      <div class="cb-cal-wd">${['S','M','T','W','T','F','S'].map(w => `<span>${w}</span>`).join('')}</div>
      <div class="cb-cal-grid">${cells.join('')}</div>
    </div>`;
}

function _dateRowHTML() {
  const isToday = cb.date === todayStr();
  const { weekday, monthDay } = fmtDateDisplay(cb.date);
  const mobile = isMobile();

  const prev = `<button class="cb-icon-btn" id="cbPrevDay" aria-label="Previous day">${ICON.chevL}</button>`;
  const next = `<button class="cb-icon-btn" id="cbNextDay" aria-label="Next day">${ICON.chevR}</button>`;
  const cal  = `<button class="cb-icon-btn${cb.calOpen ? ' cb-icon-btn--on' : ''}" id="cbCalBtn" aria-label="Choose a date">${ICON.cal}</button>`;
  const dateBlock = `
    <div class="cb-date-block">
      <div class="cb-date-wd">${esc(weekday.toUpperCase())}${isToday ? '<span class="cb-today-pill">Today</span>' : ''}</div>
      <div class="cb-date-md">${esc(monthDay)}</div>
    </div>`;

  if (mobile) {
    return `
      <div class="cb-date-card">
        <div class="cb-date-row">
          ${prev}${dateBlock}${next}${cal}
        </div>
        <div class="cb-week">${_weekStrip()}</div>
        ${_calendarHTML()}
      </div>`;
  }

  // Order matters: the week strip sits directly after the day arrows, not
  // pushed to the far edge, so the whole control reads as one cluster.
  return `
    <div class="cb-date-bar">
      <div class="cb-date-row cb-date-row--desktop">
        ${prev}${dateBlock}${next}
        <div class="cb-week">${_weekStrip()}</div>
        ${cal}
      </div>
      ${_calendarHTML()}
    </div>`;
}

// ── Desktop grid ──────────────────────────────────────────────────────────────
function _buildCourtColumn(courtId, isToday, isPast, nm) {
  const slots = getCourtSlots(cb.date, courtId);

  const blocks = slots.map(s => {
    const h = topFor(s.startMin + s.durationMinutes) - topFor(s.startMin);
    const mine = isMine(s);
    const league = !mine && s.source && s.source !== 'custom';
    const kind = mine ? 'mine' : league ? 'league' : 'other';
    const canEdit = mine && !isPast;
    const editing = cb.panel === 'edit' && String(cb.panelBooking?.id) === String(s.id);
    return `
      <div class="cb-block cb-block--${kind}${canEdit ? ' cb-block--editable' : ''}${editing ? ' cb-block--editing' : ''}"
        data-bid="${s.id}" data-court="${courtId}"
        style="top:${topFor(s.startMin) + 1}px;height:${Math.max(h - 3, 16)}px">
        <span class="cb-block-title">${esc(mine ? 'You' : s.title)}</span>
        <span class="cb-block-time">${fmtRange(s.startMin, s.durationMinutes)}</span>
        ${mine ? '<span class="cb-block-edit">Edit</span>' : ''}
      </div>`;
  }).join('');

  let openSlots = '';
  if (!isPast) {
    for (let m = DAY_START; m < DAY_END; m += SLOT_MIN) {
      const covered = slots.some(s => m < s.startMin + s.durationMinutes && (m + SLOT_MIN) > s.startMin);
      if (covered) continue;
      // A slot that has been and gone is simply not drawn. The whole morning is
      // veiled instead, rather than repeating "no longer available" down the
      // column.
      if (isToday && m < nm) continue;
      const selected = cb.panel === 'book' && cb.courtId === courtId && cb.panelStartMin === m;
      openSlots += `<div class="cb-slot cb-slot--open${selected ? ' cb-slot--sel' : ''}" data-start="${m}" data-court="${courtId}"
        style="top:${topFor(m) + 1}px">
        <span class="cb-slot-time">${fmtShort(m)}</span><span class="cb-slot-plus">+</span>
      </div>`;
    }
  }

  const veil = isToday && nm > DAY_START
    ? `<div class="cb-veil" style="height:${topFor(Math.min(nm, DAY_END))}px"></div>`
    : '';
  const nowLine = isToday ? `<div class="cb-now" style="top:${topFor(nm)}px"></div>` : '';

  return `${openSlots}${blocks}${veil}${nowLine}`;
}

function _buildGrid() {
  const isToday = cb.date === todayStr();
  const isPast  = cb.date < todayStr();
  const nm = nowMin();

  if (cb.status === 'loading') return `<div class="cb-centered"><div class="cb-spinner"></div></div>`;
  if (cb.status === 'error')   return `<div class="cb-centered cb-error">Couldn't load the schedule. Please try again.</div>`;
  if (!cb.courts.length)       return `<div class="cb-centered">No courts available.</div>`;

  // Every other hour gets a filled band instead of a rule every 30 minutes.
  const bands = [];
  for (let h = 6; h < DAY_END / 60; h += 2) {
    bands.push(`<div class="cb-band" style="top:${topFor(h * 60)}px"></div>`);
  }

  const hours = [];
  for (let h = 6; h < DAY_END / 60; h++) {
    hours.push(`<div class="cb-hour" style="top:${Math.max(0, topFor(h * 60) - 7)}px">${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}</div>`);
  }
  const nowChip = isToday ? `<span class="cb-now-chip" style="top:${topFor(nm) + 1}px">Now</span>` : '';

  return `
    ${isPast ? '<div class="cb-past-banner">Past date · view only</div>' : ''}
    <div class="cb-court-header">
      <div class="cb-court-header-spacer"></div>
      ${cb.courts.map(c => `<div class="cb-court-header-cell">${esc(c.name)}</div>`).join('')}
    </div>
    <div class="cb-grid" style="height:${GRID_H}px">
      <div class="cb-bands">${bands.join('')}</div>
      <div class="cb-gutter">${hours.join('')}${nowChip}</div>
      ${cb.courts.map(c => `<div class="cb-col">${_buildCourtColumn(c.id, isToday, isPast, nm)}</div>`).join('')}
    </div>`;
}

// ── Mobile court cards ────────────────────────────────────────────────────────
function _buildCourtCards() {
  const isToday = cb.date === todayStr();
  const isPast  = cb.date < todayStr();
  const nm = nowMin();

  if (cb.status === 'loading') return `<div class="cb-centered"><div class="cb-spinner"></div></div>`;
  if (cb.status === 'error')   return `<div class="cb-centered cb-error">Couldn't load the schedule. Please try again.</div>`;
  if (!cb.courts.length)       return `<div class="cb-centered">No courts available.</div>`;

  // On today the rail starts at the next 30-minute boundary; nothing already
  // gone is offered.
  const from = isToday ? Math.ceil(nm / SLOT_MIN) * SLOT_MIN : DAY_START;

  return cb.courts.map(c => {
    const slots = getCourtSlots(cb.date, c.id);
    const mine = isPast ? [] : slots.filter(s => isMine(s) && s.startMin + s.durationMinutes > (isToday ? nm : 0));

    const open = [];
    if (!isPast) {
      for (let m = Math.max(DAY_START, from); m < DAY_END; m += SLOT_MIN) {
        const covered = slots.some(s => m < s.startMin + s.durationMinutes && (m + SLOT_MIN) > s.startMin);
        if (!covered) open.push(m);
      }
    }

    const minePills = mine.map(s => `
      <button class="cb-pill-mine" data-bid="${s.id}" data-court="${c.id}">
        <span class="cb-pill-mine-t">${fmtPill(s.startMin)}</span>
        <span class="cb-pill-mine-l">Yours</span>
      </button>`).join('');

    const openPills = open.map(m => {
      const sel = cb.panel === 'book' && cb.courtId === c.id && cb.panelStartMin === m;
      return `<button class="cb-pill-open${sel ? ' cb-pill-open--sel' : ''}" data-start="${m}" data-court="${c.id}">${fmtPill(m)}</button>`;
    }).join('');

    const rail = (minePills || openPills)
      ? `<div class="cb-rail">${minePills}${openPills}</div>`
      : `<div class="cb-rail-empty">${isPast ? 'No openings on this date' : 'Fully booked today'}</div>`;

    return `
      <div class="cb-court-card">
        <div class="cb-court-head">
          <span class="cb-court-name">${esc(c.name)}</span>
          <span class="cb-count-pill${open.length ? '' : ' cb-count-pill--none'}">${open.length ? `${open.length} open` : 'Full'}</span>
        </div>
        ${rail}
      </div>`;
  }).join('');
}

// ── My Bookings ───────────────────────────────────────────────────────────────
function _otherNames(b) {
  const me = state.currentUser?.playerId;
  return (b.players || []).filter(p => p.id !== me).map(p => p.name);
}

function _buildMyBookingsDesktop() {
  const n = cb.myBookings.length;
  if (!n) {
    return `
      <div class="cb-mine-wrap">
        <div class="cb-mine-head"><h2 class="cb-mine-title">My Bookings</h2></div>
        <div class="cb-mine-empty">
          <p>You have no upcoming bookings.</p>
          <button class="cb-mine-empty-btn" id="cbGoBook">Book a court</button>
        </div>
      </div>`;
  }

  const cards = cb.myBookings.map(b => {
    const d = new Date(b.date + 'T12:00:00');
    const others = _otherNames(b);
    const editing = cb.panel === 'edit' && String(cb.panelBooking?.id) === String(b.id);
    const confirming = String(cb.listConfirm) === String(b.id);
    return `
      <div class="cb-mine-card${editing ? ' cb-mine-card--editing' : ''}" data-bid="${b.id}">
        <div class="cb-mine-row">
          <div class="cb-date-tile">
            <span class="cb-date-tile-wd">${WD_SHORT[d.getDay()].toUpperCase()}</span>
            <span class="cb-date-tile-n">${d.getDate()}</span>
          </div>
          <div class="cb-mine-detail">
            <div class="cb-mine-court">${esc(b.courtName)}${b.date === todayStr() ? '<span class="cb-today-pill">Today</span>' : ''}</div>
            <div class="cb-mine-when">${esc(fmtLongDate(b.date))} · ${fmtRange(b.startMin, b.durationMinutes)}</div>
            <div class="cb-mine-with">${others.length ? `With ${esc(others.join(', '))}` : 'Just you'}</div>
          </div>
          <div class="cb-mine-actions">
            <button class="cb-mine-edit" data-edit="${b.id}">Edit</button>
            <button class="cb-mine-del" data-del="${b.id}" aria-label="Cancel booking">${ICON.trash}</button>
          </div>
        </div>
        ${confirming ? `
        <div class="cb-inline-confirm">
          <span class="cb-inline-confirm-text">Cancel this booking and release the court? This cannot be undone.</span>
          <div class="cb-inline-confirm-btns">
            <button class="cb-btn cb-btn--outline" data-keep="${b.id}">Keep it</button>
            <button class="cb-btn cb-btn--danger" data-confirmdel="${b.id}">Cancel booking</button>
          </div>
        </div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="cb-mine-wrap">
      <div class="cb-mine-head">
        <h2 class="cb-mine-title">My Bookings</h2>
        <span class="cb-mine-count">${n} booking${n === 1 ? '' : 's'}</span>
      </div>
      <div class="cb-mine-list">${cards}</div>
    </div>`;
}

function _buildMyBookingsMobile() {
  const n = cb.myBookings.length;
  const rows = cb.myBookings.map(b => {
    const d = new Date(b.date + 'T12:00:00');
    return `
      <div class="cb-mmine-row" data-bid="${b.id}">
        <div class="cb-mmine-date">
          <span class="cb-mmine-wd">${WD_SHORT[d.getDay()].toUpperCase()}</span>
          <span class="cb-mmine-n">${d.getDate()}</span>
        </div>
        <div class="cb-mmine-detail">
          <div class="cb-mmine-court">${esc(b.courtName)}</div>
          <div class="cb-mmine-when">${fmtRange(b.startMin, b.durationMinutes)}${b.date === todayStr() ? ' · Today' : ''}</div>
        </div>
        <button class="cb-mine-edit" data-edit="${b.id}">Edit</button>
      </div>`;
  }).join('');

  return `
    <div class="cb-court-card cb-mmine-card">
      <div class="cb-court-head">
        <span class="cb-court-name cb-mmine-title">My Bookings</span>
        ${n ? `<span class="cb-count-pill cb-count-pill--grey">${n}</span>` : ''}
      </div>
      ${n ? `<div class="cb-mmine-list">${rows}</div>` : '<div class="cb-rail-empty">No upcoming bookings.</div>'}
    </div>`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function _buildBody() {
  const mobile = isMobile();

  if (!mobile && cb.tab === 'mine') return _buildMyBookingsDesktop();

  if (mobile) {
    return `
      ${_dateRowHTML()}
      <div class="cb-cards">
        ${_buildCourtCards()}
        ${_buildMyBookingsMobile()}
      </div>`;
  }

  return `
    ${_dateRowHTML()}
    <div class="cb-grid-wrap" id="cbGridWrap">${_buildGrid()}</div>`;
}

function _renderBody() {
  const body = document.getElementById('cbBody');
  if (!body) return;
  const wrap = document.getElementById('cbGridWrap');
  const saved = wrap?.scrollTop || 0;
  body.innerHTML = _buildBody();
  const next = document.getElementById('cbGridWrap');
  if (next && saved) next.scrollTop = saved;
  _attachBodyListeners();
}

function _render() {
  const page = document.getElementById('cbPage');
  if (!page) return;

  const title = document.getElementById('pageTitle');
  if (title) {
    if (isMobile()) title.textContent = 'Court Booking';
    else title.innerHTML = _buildTabs();
  }

  page.innerHTML = `<div id="cbBody" class="cb-body">${_buildBody()}</div>`;
  if (!isMobile()) _attachTabListeners();
  _attachBodyListeners();
}

// ── Listeners ─────────────────────────────────────────────────────────────────
function _setDate(next, { closeCal = true } = {}) {
  cb.date = next;
  if (closeCal) cb.calOpen = false;
  if (cb.panel === 'book') _closePanel();
  _renderBody();
  _loadSchedule(cb.date);
}

function _attachBodyListeners() {
  document.getElementById('cbPrevDay')?.addEventListener('click', () => _setDate(addDays(cb.date, -1)));
  document.getElementById('cbNextDay')?.addEventListener('click', () => _setDate(addDays(cb.date, 1)));
  document.getElementById('cbCalBtn')?.addEventListener('click', () => {
    cb.calOpen = !cb.calOpen;
    if (cb.calOpen) cb.calMonth = cb.date.slice(0, 7);
    _renderBody();
  });
  document.getElementById('cbCalPrev')?.addEventListener('click', () => { cb.calMonth = _shiftMonth(cb.calMonth, -1); _renderBody(); });
  document.getElementById('cbCalNext')?.addEventListener('click', () => { cb.calMonth = _shiftMonth(cb.calMonth, 1); _renderBody(); });
  document.querySelectorAll('[data-caldate]').forEach(el => {
    el.addEventListener('click', () => _setDate(el.dataset.caldate));
  });
  document.querySelectorAll('.cb-day').forEach(el => {
    el.addEventListener('click', () => _setDate(el.dataset.date));
  });

  document.getElementById('cbGoBook')?.addEventListener('click', () => {
    cb.tab = 'book';
    _refreshTabs();
    _renderBody();
    _scrollToNow();
  });

  _attachGridListeners();
  _attachMineListeners();
}

function _shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _attachGridListeners() {
  const isPast = cb.date < todayStr();
  if (isPast) return;

  document.querySelectorAll('.cb-slot--open, .cb-pill-open').forEach(slot => {
    slot.addEventListener('click', () => {
      if (slot.dataset.court) cb.courtId = Number(slot.dataset.court);
      _startReservation(Number(slot.dataset.start));
    });
  });

  document.querySelectorAll('.cb-block--editable, .cb-pill-mine').forEach(block => {
    block.addEventListener('click', () => {
      if (block.dataset.court) cb.courtId = Number(block.dataset.court);
      const slots   = getCourtSlots(cb.date, cb.courtId);
      const booking = slots.find(s => String(s.id) === String(block.dataset.bid));
      if (booking) _openPanel('edit', { booking });
    });
  });
}

function _attachMineListeners() {
  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _editFromList(Number(btn.dataset.edit));
    });
  });
  document.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cb.listConfirm = Number(btn.dataset.del);
      _renderBody();
    });
  });
  document.querySelectorAll('[data-keep]').forEach(btn => {
    btn.addEventListener('click', () => { cb.listConfirm = null; _renderBody(); });
  });
  document.querySelectorAll('[data-confirmdel]').forEach(btn => {
    btn.addEventListener('click', () => _cancelFromList(Number(btn.dataset.confirmdel)));
  });
}

// Editing from the list moves the grid to that booking's day and switches back
// to Book a Court, so the panel opens with its slot visible behind it.
async function _editFromList(id) {
  const b = cb.myBookings.find(x => String(x.id) === String(id));
  if (!b) return;
  cb.listConfirm = null;
  cb.tab = 'book';
  cb.date = b.date;
  cb.courtId = b.courtId;
  _refreshTabs();
  _renderBody();
  await _loadSchedule(cb.date);
  const slots = getCourtSlots(cb.date, b.courtId);
  const booking = slots.find(s => String(s.id) === String(id)) || b;
  _openPanel('edit', { booking });
}

async function _cancelFromList(id) {
  try {
    await window.api.cancelMyBooking(id);
    cb.listConfirm = null;
    toast('Booking cancelled', 'warn');
    // The grid and the list read from different caches, so both are refreshed.
    delete cb.scheduleCache[cb.date];
    await Promise.all([_loadSchedule(cb.date), _loadMyBookings()]);
    _renderBody();
  } catch (e) {
    toast(e.message || 'Cancel failed.', 'error');
  }
}

// ── Panel ─────────────────────────────────────────────────────────────────────
function _openPanel(mode, opts = {}) {
  cb.panel = mode;
  cb.panelStartMin  = opts.startMin ?? null;
  cb.panelBooking   = opts.booking  ?? null;
  cb.panelDuration  = mode === 'edit' ? (opts.booking?.durationMinutes || 30) : 30;
  cb.panelPlayers   = mode === 'edit'
    ? (opts.booking?.players || []).filter(p => p.id !== state.currentUser?.playerId).map(p => p.id)
    : [];
  cb.panelSearch    = '';
  cb.panelBusy      = false;
  cb.panelAskCancel = false;
  _renderPanel();
  _renderBody();
}

function _closePanel(reason) {
  if (cb.reservation?.timerId) clearInterval(cb.reservation.timerId);
  if (reason !== 'confirmed' && cb.reservation?.id) {
    window.api.releaseReservation(cb.reservation.id).catch(() => {});
  }
  cb.reservation = null;
  cb.panel = null;
  cb.panelAskCancel = false;

  const overlay = document.getElementById('cbPanelOverlay');
  if (overlay) {
    overlay.querySelector('.cb-panel')?.classList.remove('cb-panel--visible');
    overlay.querySelector('.cb-panel-backdrop')?.classList.remove('cb-panel-backdrop--visible');
    setTimeout(() => overlay.remove(), 320);
  }

  if (reason === 'expired') toast('Your 5-minute hold expired', 'warn');
}

function _buildPanelInner() {
  const isEdit   = cb.panel === 'edit';
  const booking  = cb.panelBooking;
  const startMin = _panelStartMin();
  const date     = _panelDate();
  const rsv  = cb.reservation;
  const court = cb.courts.find(c => c.id === cb.courtId);
  const courtName = isEdit ? (booking?.courtName || court?.name || 'Court') : (court?.name || 'Court');

  if (rsv?.expired) {
    return `
      <div class="cb-expired">
        <div class="cb-expired-icon">${ICON.clock}</div>
        <div class="cb-expired-title">Your hold expired</div>
        <div class="cb-expired-msg">The 5-minute hold on this slot has ended. Tap the slot again to reserve it.</div>
      </div>`;
  }

  const secs = rsv?.secs ?? 300;
  const warn = !isEdit && secs < 60;
  const slots  = getCourtSlots(date, cb.courtId);
  const maxEnd = getMaxEnd(slots, startMin, isEdit ? booking?.id : null);
  const nextStart = maxEnd < DAY_END ? maxEnd : null;

  const canGrow = startMin + cb.panelDuration + SLOT_MIN <= maxEnd;
  const canShrink = cb.panelDuration > SLOT_MIN;

  const taken = new Set([state.currentUser?.playerId, ...cb.panelPlayers].filter(Boolean));
  const playerChips = cb.panelPlayers.map(pid => {
    const p = state.players?.find(pl => pl.id === pid);
    return `<span class="cb-chip cb-chip--other">${esc(p?.name || 'Player')}<button class="cb-chip-x" data-remove="${pid}" aria-label="Remove">×</button></span>`;
  }).join('');

  const results = cb.panelSearch.trim()
    ? (state.players || []).filter(p => !taken.has(p.id) && p.name.toLowerCase().includes(cb.panelSearch.trim().toLowerCase())).slice(0, 8)
    : [];
  const searchDropdown = (results.length || cb.panelSearch.trim()) ? `
    <div class="cb-search-results" id="cbSearchDropdown">
      ${results.length
        ? results.map(p => `<div class="cb-search-result" data-pid="${p.id}"><span class="cb-res-av">${esc(_initials(p.name))}</span><span>${esc(p.name)}</span></div>`).join('')
        : '<div class="cb-search-empty">No players found</div>'}
    </div>` : '';

  const others = isEdit ? _otherNames(booking || {}) : [];
  const playerCount = 1 + cb.panelPlayers.length;

  const room = 3 - cb.panelPlayers.length;
  const holdWarn = warn;

  return `
    <div class="cb-panel-head">
      <div class="cb-panel-head-row">
        <div class="cb-panel-headings">
          <span class="cb-panel-kicker">${isEdit ? 'Your booking' : 'Reserve a court'}</span>
          <span class="cb-panel-court">${esc(courtName)}</span>
          <span class="cb-panel-when">${esc(fmtLongDate(date))} · ${fmtTime(startMin)}</span>
        </div>
        <button class="cb-panel-close" id="cbPanelClose" aria-label="Close">${ICON.close}</button>
      </div>
      ${isEdit ? `
        <div class="cb-note">
          ${ICON.pencil}
          <span>Booked by you${others.length ? ` with ${esc(others.join(', '))}` : ''}</span>
        </div>`
      : `
        <div class="cb-hold${holdWarn ? ' cb-hold--warn' : ''}">
          ${ICON.clock}
          <span class="cb-hold-text">${holdWarn ? 'Hold expiring' : 'Slot held for you'}</span>
          <span class="cb-hold-count" id="cbTimerDisplay">${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}</span>
        </div>`}
    </div>

    <div class="cb-panel-scroll">
      <div class="cb-section">
        <div class="cb-section-head">
          <span class="cb-label">Duration</span>
          <span class="cb-range">${fmtRange(startMin, cb.panelDuration)}</span>
        </div>
        <div class="cb-stepper">
          <button class="cb-step" id="cbDurMinus"${canShrink ? '' : ' disabled'} aria-label="Shorter">−</button>
          <span class="cb-step-val" id="cbDurValue">${durLabel(cb.panelDuration)}</span>
          <button class="cb-step" id="cbDurPlus"${canGrow ? '' : ' disabled'} aria-label="Longer">+</button>
        </div>
        ${canGrow ? '' : `<span class="cb-hint">${nextStart ? `The next booking starts at ${fmtTime(nextStart)}.` : 'That is the end of the day.'}</span>`}
      </div>

      <div class="cb-section">
        <div class="cb-section-head">
          <span class="cb-label">Playing with</span>
          <span class="cb-optional">Optional</span>
          <span class="cb-room">${room} more</span>
        </div>
        <div class="cb-chips">
          <span class="cb-chip cb-chip--me"><span class="cb-chip-dot"></span>${esc(myName())}<span class="cb-chip-you">you</span></span>
          ${playerChips}
        </div>
        ${cb.panelPlayers.length < 3 ? `
          <div class="cb-search-wrap">
            <input class="cb-search-input" id="cbPlayerSearch" type="text" placeholder="Search club players…" value="${esc(cb.panelSearch)}" autocomplete="off">
            ${searchDropdown}
          </div>` : ''}
      </div>
    </div>

    <div class="cb-panel-footer">
      <div class="cb-summary">
        ${ICON.check}
        <span>${esc(courtName)} · ${esc(fmtShortDate(date))} · ${fmtRange(startMin, cb.panelDuration)} · ${playerCount} player${playerCount === 1 ? '' : 's'}</span>
      </div>
      ${cb.panelAskCancel ? `
      <div class="cb-confirm-row">
        <span class="cb-confirm-text">Cancel this booking and release the court? This cannot be undone.</span>
        <div class="cb-confirm-btns">
          <button class="cb-btn cb-btn--outline" id="cbKeepBooking">Keep it</button>
          <button class="cb-btn cb-btn--danger" id="cbConfirmCancel">Cancel booking</button>
        </div>
      </div>` : ''}
      <div class="cb-actions">
        <button class="cb-btn cb-btn--ghost" id="cbPanelCancel">${isEdit ? 'Close' : 'Cancel'}</button>
        <button class="cb-btn cb-btn--primary" id="cbPanelConfirm"${cb.panelBusy ? ' disabled' : ''}>
          ${cb.panelBusy ? (isEdit ? 'Saving…' : 'Booking…') : (isEdit ? 'Save changes' : 'Confirm booking')}
        </button>
      </div>
      ${isEdit && !cb.panelAskCancel ? `<button class="cb-cancel-booking" id="cbCancelBooking">Cancel booking</button>` : ''}
    </div>`;
}

function _renderPanel() {
  const existing = document.getElementById('cbPanelOverlay');

  if (existing) {
    const innerEl = document.getElementById('cbPanelInner');
    if (innerEl) innerEl.innerHTML = _buildPanelInner();
    _attachPanelListeners();
    return;
  }

  const mobile = isMobile();
  const overlay = document.createElement('div');
  overlay.id = 'cbPanelOverlay';
  overlay.className = 'cb-panel-overlay';
  overlay.innerHTML = `
    <div class="cb-panel-backdrop" id="cbPanelBackdrop"></div>
    <div class="cb-panel${mobile ? ' cb-panel--mobile' : ''}">
      <div id="cbPanelInner">${_buildPanelInner()}</div>
    </div>`;

  document.getElementById('cbPage').appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.querySelector('.cb-panel')?.classList.add('cb-panel--visible');
    overlay.querySelector('.cb-panel-backdrop')?.classList.add('cb-panel-backdrop--visible');
  });
  _attachPanelListeners();
}

function _attachPanelListeners() {
  document.getElementById('cbPanelBackdrop')?.addEventListener('click', () => { if (!cb.panelBusy) _closePanelAndRefresh(); });
  document.getElementById('cbPanelClose')?.addEventListener('click', () => { if (!cb.panelBusy) _closePanelAndRefresh(); });
  document.getElementById('cbPanelCancel')?.addEventListener('click', () => { if (!cb.panelBusy) _closePanelAndRefresh(); });

  document.getElementById('cbPanelConfirm')?.addEventListener('click', () => {
    if (cb.panel === 'edit') _saveEdit();
    else _confirmBooking();
  });

  document.getElementById('cbCancelBooking')?.addEventListener('click', () => {
    cb.panelAskCancel = true;
    _renderPanel();
  });
  document.getElementById('cbKeepBooking')?.addEventListener('click', () => {
    cb.panelAskCancel = false;
    _renderPanel();
  });
  document.getElementById('cbConfirmCancel')?.addEventListener('click', _cancelBooking);

  document.getElementById('cbDurMinus')?.addEventListener('click', () => _stepDuration(-SLOT_MIN));
  document.getElementById('cbDurPlus')?.addEventListener('click', () => _stepDuration(SLOT_MIN));

  document.querySelectorAll('.cb-chip-x').forEach(btn => {
    btn.addEventListener('click', () => {
      cb.panelPlayers = cb.panelPlayers.filter(id => id !== Number(btn.dataset.remove));
      _renderPanel();
    });
  });

  const searchInput = document.getElementById('cbPlayerSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      cb.panelSearch = e.target.value;
      _updateSearchDropdown();
    });
  }

  document.querySelectorAll('#cbSearchDropdown .cb-search-result').forEach(result => {
    result.addEventListener('click', () => _addPlayer(Number(result.dataset.pid)));
  });
}

function _closePanelAndRefresh() {
  _closePanel();
  _renderBody();
}

function _stepDuration(delta) {
  const startMin = _panelStartMin();
  const slots = getCourtSlots(_panelDate(), cb.courtId);
  const maxEnd = getMaxEnd(slots, startMin, cb.panel === 'edit' ? cb.panelBooking?.id : null);
  const next = cb.panelDuration + delta;
  if (next < SLOT_MIN || startMin + next > maxEnd) return;
  cb.panelDuration = next;
  _renderPanel();
}

function _addPlayer(pid) {
  if (!cb.panelPlayers.includes(pid)) {
    cb.panelPlayers.push(pid);
    cb.panelSearch = '';
    _renderPanel();
  }
}

// Updates only the dropdown, so typing never loses focus.
function _updateSearchDropdown() {
  document.getElementById('cbSearchDropdown')?.remove();

  const taken = new Set([state.currentUser?.playerId, ...cb.panelPlayers].filter(Boolean));
  const results = cb.panelSearch.trim()
    ? (state.players || []).filter(p =>
        !taken.has(p.id) && p.name.toLowerCase().includes(cb.panelSearch.trim().toLowerCase())
      ).slice(0, 8)
    : [];

  if (!results.length && !cb.panelSearch.trim()) return;

  const wrap = document.querySelector('.cb-search-wrap');
  if (!wrap) return;

  const div = document.createElement('div');
  div.className = 'cb-search-results';
  div.id = 'cbSearchDropdown';
  div.innerHTML = results.length
    ? results.map(p => `<div class="cb-search-result" data-pid="${p.id}"><span class="cb-res-av">${esc(_initials(p.name))}</span><span>${esc(p.name)}</span></div>`).join('')
    : '<div class="cb-search-empty">No players found</div>';

  wrap.appendChild(div);
  div.querySelectorAll('.cb-search-result').forEach(result => {
    result.addEventListener('click', () => _addPlayer(Number(result.dataset.pid)));
  });
}

// ── API actions ───────────────────────────────────────────────────────────────
async function _startReservation(startMin) {
  try {
    const rsv = await window.api.createReservation({
      courtId: cb.courtId,
      date: cb.date,
      startTime: minToTime(startMin),
      durationMinutes: 30,
    });

    if (cb.reservation?.timerId) clearInterval(cb.reservation.timerId);

    cb.reservation = { id: rsv.reservationId, expiresAt: rsv.expiresAt, secs: 300, expired: false, timerId: null };

    cb.reservation.timerId = setInterval(() => {
      cb.reservation.secs--;
      if (cb.reservation.secs <= 0) {
        clearInterval(cb.reservation.timerId);
        cb.reservation.expired = true;
        _renderPanel();
        setTimeout(() => { _closePanel('expired'); _renderBody(); }, 1400);
        return;
      }
      const s = cb.reservation.secs;
      const display = document.getElementById('cbTimerDisplay');
      if (display) display.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
      document.querySelector('.cb-hold')?.classList.toggle('cb-hold--warn', s < 60);
    }, 1000);

    // Default to an hour, or less when the next booking is sooner.
    const slots = getCourtSlots(cb.date, cb.courtId);
    const maxEnd = getMaxEnd(slots, startMin);
    _openPanel('book', { startMin });
    cb.panelDuration = Math.min(60, Math.max(SLOT_MIN, maxEnd - startMin));
    _renderPanel();
  } catch (e) {
    toast(e.message || 'This slot is not available.', 'error');
  }
}

async function _confirmBooking() {
  if (cb.panelBusy || !cb.reservation) return;
  cb.panelBusy = true;
  _renderPanel();
  try {
    await window.api.confirmBooking({
      reservationId: cb.reservation.id,
      durationMinutes: cb.panelDuration,
      playerIds: cb.panelPlayers,
    });
    if (cb.reservation?.timerId) clearInterval(cb.reservation.timerId);
    cb.reservation = null;
    const bookedStart = cb.panelStartMin;
    const bookedDur   = cb.panelDuration;
    _closePanel('confirmed');
    toast(`Court booked · ${fmtRange(bookedStart, bookedDur)}`, 'success');
    delete cb.scheduleCache[cb.date];
    await Promise.all([_loadSchedule(cb.date), _loadMyBookings()]);
    _renderBody();
  } catch (e) {
    cb.panelBusy = false;
    toast(e.message || 'Booking failed. Please try again.', 'error');
    _renderPanel();
  }
}

async function _saveEdit() {
  if (cb.panelBusy) return;
  cb.panelBusy = true;
  _renderPanel();
  try {
    await window.api.updateMyBooking(cb.panelBooking.id, {
      durationMinutes: cb.panelDuration,
      playerIds: cb.panelPlayers,
    });
    _closePanel('confirmed');
    toast('Booking updated', 'success');
    delete cb.scheduleCache[_panelDate()];
    await Promise.all([_loadSchedule(cb.date), _loadMyBookings()]);
    _renderBody();
  } catch (e) {
    cb.panelBusy = false;
    toast(e.message || 'Update failed.', 'error');
    _renderPanel();
  }
}

async function _cancelBooking() {
  if (!cb.panelBooking) return;
  try {
    await window.api.cancelMyBooking(cb.panelBooking.id);
    _closePanel('confirmed');
    toast('Booking cancelled', 'warn');
    delete cb.scheduleCache[cb.date];
    await Promise.all([_loadSchedule(cb.date), _loadMyBookings()]);
    _renderBody();
  } catch (e) {
    toast(e.message || 'Cancel failed.', 'error');
  }
}
