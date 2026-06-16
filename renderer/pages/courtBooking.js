import { state } from '../state.js';
import { esc, toast } from '../utils.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const ACC  = '#5b7cf9', NAVY = '#1a2150', INK = '#1c2440', MUT = '#6b7790';
const LINE = '#e7ebf2';
const DAY_START = 6 * 60, DAY_END = 23 * 60, SLOT_MIN = 30, ROW_H = 56, TIME_W = 72;
const GRID_H = (DAY_END - DAY_START) / SLOT_MIN * ROW_H;

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
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2,'0')} ${ap}`;
}

function fmtRange(startMin, durMin) {
  return `${fmtTime(startMin)} – ${fmtTime(startMin + durMin)}`;
}

function topFor(min) {
  return (min - DAY_START) / SLOT_MIN * ROW_H;
}

function nowMin() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function durLabel(d) {
  const h = Math.floor(d / 60), m = d % 60;
  return (h ? h + 'h' : '') + (h && m ? ' ' : '') + (m ? m + 'm' : '');
}

function isMobile() {
  return window.innerWidth <= 768;
}

function fmtDateDisplay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MO = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return { weekday: WD[d.getDay()], monthDay: `${MO[d.getMonth()]} ${d.getDate()}` };
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

// ── Entry ─────────────────────────────────────────────────────────────────────
export function renderCourtBooking() {
  document.getElementById('pageTitle').textContent = 'Court Booking';
  _instance++;

  if (cb.refreshInterval) clearInterval(cb.refreshInterval);
  if (cb.reservation?.timerId) clearInterval(cb.reservation.timerId);

  cb = {
    date: todayStr(),
    courtId: null,
    courts: [],
    scheduleCache: {},
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
    mobileCourtIdx: 0,
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
    _render();
    _scrollToNow();

    cb.refreshInterval = setInterval(async () => {
      if (_instance !== myInstance) { clearInterval(cb.refreshInterval); return; }
      try {
        const data = await window.api.getSchedule(cb.date);
        if (_instance !== myInstance) return;
        cb.scheduleCache[cb.date] = data;
        _renderGrid();
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
  _renderGrid();
  try {
    const data = await window.api.getSchedule(dateStr);
    cb.scheduleCache[dateStr] = data;
    cb.status = 'ok';
  } catch (_) {
    cb.status = 'error';
  }
  _renderGrid();
}

function _scrollToNow() {
  const wrap = document.getElementById('cbGridWrap');
  if (!wrap) return;
  const isToday = cb.date === todayStr();
  wrap.scrollTop = Math.max(0, topFor(isToday ? nowMin() : 9 * 60) - 64);
}

// ── Full Render ───────────────────────────────────────────────────────────────
function _render() {
  const page = document.getElementById('cbPage');
  if (!page) return;
  const isToday = cb.date === todayStr();
  const { weekday, monthDay } = fmtDateDisplay(cb.date);

  page.innerHTML = `
    <div class="cb-date-bar">
      <div class="cb-date-side">
        <button class="cb-circ-btn" id="cbPrevDay" aria-label="Previous day">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
      </div>
      <div class="cb-date-center">
        <div class="cb-weekday">
          ${esc(weekday.toUpperCase())}
          ${isToday ? '<span class="cb-today-pill">Today</span>' : ''}
        </div>
        <div class="cb-monthday">${esc(monthDay)}</div>
      </div>
      <div class="cb-date-side cb-date-side--right">
        ${!isToday ? `<button class="cb-today-btn" id="cbGoToday">Today</button>` : ''}
        <button class="cb-circ-btn" id="cbNextDay" aria-label="Next day">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
    </div>

    <div class="cb-court-bar" id="cbCourtBar">${_buildCourtBar()}</div>

    <div class="cb-grid-wrap" id="cbGridWrap">
      ${!isMobile() && cb.courts.length > 0 ? `
      <div class="cb-col-header-row">
        <div style="width:${TIME_W}px;flex-shrink:0"></div>
        ${cb.courts.map(c => `<div class="cb-col-header-cell">${esc(c.name)}</div>`).join('')}
      </div>` : ''}
      <div id="cbGrid">${_buildGrid()}</div>
    </div>
  `;

  _attachEventListeners();
}

// ── Court Bar ─────────────────────────────────────────────────────────────────
function _buildCourtBar() {
  if (!cb.courts.length || !isMobile()) return '';

  return cb.courts.map(c => `
    <button class="cb-court-tab${c.id === cb.courtId ? ' cb-court-tab--active' : ''}" data-court="${c.id}">
      ${esc(c.name)}
    </button>
  `).join('');
}


function _refreshCourtBar() {
  const bar = document.getElementById('cbCourtBar');
  if (bar) {
    bar.innerHTML = _buildCourtBar();
    _attachCourtBarListeners();
  }
}

// ── Grid ──────────────────────────────────────────────────────────────────────
function _buildCourtGrid(courtId, isToday, isPast, nm) {
  const slots = getCourtSlots(cb.date, courtId);

  const gridLines = Array.from({length: 35}, (_, i) => i).map(i => {
    const m = DAY_START + i * SLOT_MIN;
    return `<div style="position:absolute;left:0;right:0;top:${topFor(m)}px;height:1px;background:${m % 60 === 0 ? '#dde3ec' : '#eef1f5'}"></div>`;
  }).join('');

  const nowLine = isToday ? `
    <div style="position:absolute;left:0;right:0;top:${topFor(nm)}px;border-top:2px solid ${ACC};z-index:3">
      <div style="position:absolute;left:-4px;top:-5px;width:8px;height:8px;border-radius:50%;background:${ACC}"></div>
    </div>
  ` : '';

  const blocks = slots.map(s => {
    const h = topFor(s.startMin + s.durationMinutes) - topFor(s.startMin);
    const mine = isMine(s);
    const barColor  = mine ? ACC : (s.color || '#8793ab');
    const bgColor   = mine ? '#eaeefe' : (s.color ? s.color + '18' : '#eef1f6');
    const textColor = mine ? '#23306b' : INK;
    const subColor  = mine ? '#5566b0' : MUT;
    const canEdit   = mine && !isPast;
    const editSvg   = canEdit
      ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${barColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`
      : '';
    return `
      <div class="cb-block${canEdit ? ' cb-block--mine' : ''}" data-bid="${s.id}" data-court="${courtId}"
        style="position:absolute;left:8px;right:10px;top:${topFor(s.startMin)}px;height:${h-4}px;background:${bgColor};border-radius:9px;border-left:3px solid ${barColor};padding:8px 12px;overflow:hidden;cursor:${canEdit?'pointer':'default'};${mine?`outline:1px solid ${barColor}55`:''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="font-size:13px;font-weight:700;color:${textColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</div>
          ${editSvg}
        </div>
        <div style="font-size:11.5px;color:${subColor};margin-top:2px">${fmtRange(s.startMin, s.durationMinutes)}</div>
        ${h > 64 && s.info ? `<div style="font-size:11px;color:${subColor};margin-top:3px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.info)}</div>` : ''}
      </div>
    `;
  }).join('');

  let openSlots = '';
  if (!isPast) {
    for (let m = DAY_START; m < DAY_END; m += SLOT_MIN) {
      const covered = slots.some(s => m < s.startMin + s.durationMinutes && (m + SLOT_MIN) > s.startMin);
      if (covered) continue;
      const slotPast = isToday && m < nm;
      openSlots += `
        <div class="${slotPast ? 'cb-slot-past' : 'cb-slot-open'}" data-start="${m}" data-court="${courtId}"
          style="position:absolute;left:8px;right:10px;top:${topFor(m)}px;height:${ROW_H-4}px;border-radius:8px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;cursor:${slotPast?'default':'pointer'};border:${slotPast?'1px dashed '+LINE:'1px solid transparent'}">
          ${slotPast
            ? `<span style="font-size:11.5px;color:#aab4c5;font-style:italic">No longer available</span>`
            : `<span style="font-size:12.5px;color:${MUT};font-weight:500">${fmtTime(m)}</span><span class="cb-slot-plus">+</span>`}
        </div>
      `;
    }
  }

  return `${gridLines}${nowLine}${openSlots}${blocks}`;
}

function _buildGrid() {
  const isToday = cb.date === todayStr();
  const isPast  = cb.date < todayStr();
  const nm = nowMin();

  if (cb.status === 'loading') {
    return `<div class="cb-centered"><div class="cb-spinner"></div></div>`;
  }
  if (cb.status === 'error') {
    return `<div class="cb-centered"><div style="color:#cf4444;font-size:14px">Couldn't load the schedule. Please try again.</div></div>`;
  }
  if (!cb.courts.length) {
    return `<div class="cb-centered"><div style="font-size:17px;color:${NAVY}">No courts available.</div></div>`;
  }

  // Barlow kept for grid time labels — matches schedule page uppercase time marker pattern
  const nowLabel = isToday ? `<div style="position:absolute;top:${topFor(nm)}px;right:8px;transform:translateY(-50%);font-family:'Barlow',sans-serif;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${ACC};background:#fff;border:1px solid ${ACC};border-radius:3px;padding:1px 5px;white-space:nowrap;line-height:1.5;pointer-events:none;z-index:4">Now</div>` : '';
  const hourLabels = Array.from({length: 18}, (_, i) => i + 6).map(hr => {
    const label = `${hr % 12 || 12} ${hr < 12 ? 'AM' : 'PM'}`;
    return `<div style="position:absolute;top:${topFor(hr*60)-7}px;right:10px;font-family:'Barlow',sans-serif;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9aa4b8">${label}</div>`;
  }).join('') + nowLabel;

  const pastBanner = isPast ? `<div class="cb-past-banner">Past date · View only</div>` : '';

  if (isMobile()) {
    const slots = getCourtSlots(cb.date, cb.courtId);
    if (isPast && slots.length === 0) {
      return `<div class="cb-centered"><div style="font-size:17px;color:${NAVY}">No bookings on this date.</div></div>`;
    }
    return `
      ${pastBanner}
      <div style="display:flex;position:relative;min-height:${GRID_H}px">
        <div style="width:${TIME_W}px;flex-shrink:0;position:relative;height:${GRID_H}px">${hourLabels}</div>
        <div style="flex:1;position:relative;height:${GRID_H}px;border-left:1px solid ${LINE}">
          ${_buildCourtGrid(cb.courtId, isToday, isPast, nm)}
        </div>
      </div>
    `;
  }

  // Desktop: all courts side-by-side
  const courtCols = cb.courts.map(c => `
    <div style="flex:1;position:relative;height:${GRID_H}px;border-left:1px solid ${LINE};min-width:160px">
      ${_buildCourtGrid(c.id, isToday, isPast, nm)}
    </div>
  `).join('');

  return `
    ${pastBanner}
    <div style="display:flex;position:relative;min-height:${GRID_H}px">
      <div style="width:${TIME_W}px;flex-shrink:0;position:relative;height:${GRID_H}px">${hourLabels}</div>
      ${courtCols}
    </div>
  `;
}

function _renderGrid() {
  const grid = document.getElementById('cbGrid');
  if (!grid) return;
  const scrollWrap = document.getElementById('cbGridWrap');
  const savedScroll = scrollWrap?.scrollTop || 0;
  grid.innerHTML = _buildGrid();
  if (scrollWrap) scrollWrap.scrollTop = savedScroll;
  _attachGridListeners();
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
}

function _closePanel(reason) {
  if (cb.reservation?.timerId) clearInterval(cb.reservation.timerId);
  if (reason !== 'confirmed' && cb.reservation?.id) {
    window.api.releaseReservation(cb.reservation.id).catch(() => {});
  }
  cb.reservation = null;
  cb.panel = null;

  const overlay = document.getElementById('cbPanelOverlay');
  if (overlay) {
    overlay.querySelector('.cb-panel')?.classList.remove('cb-panel--visible');
    overlay.querySelector('.cb-panel-backdrop')?.classList.remove('cb-panel-backdrop--visible');
    setTimeout(() => overlay.remove(), 320);
  }

  if (reason === 'expired') toast('Your 5-minute hold expired', 'warn');
}

// ── Panel HTML builders ───────────────────────────────────────────────────────
function _buildPanelHeader() {
  const isEdit   = cb.panel === 'edit';
  const booking  = cb.panelBooking;
  const startMin = _panelStartMin();
  const rsv  = cb.reservation;
  const secs = rsv?.secs ?? 300;
  const warn = !isEdit && secs < 60;
  const court = cb.courts.find(c => c.id === cb.courtId);

  const timerHTML = `
    <div class="cb-hold-timer${warn ? ' cb-hold-timer--warn' : ''}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3 2"/></svg>
      <span id="cbTimerDisplay">${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}</span>
    </div>`;

  return `
    <div class="cb-panel-title-group">
      <div class="cb-panel-title">${isEdit ? 'Edit Booking' : 'Reserve a Court'}</div>
      <div class="cb-panel-sub">${isEdit
        ? `${fmtTime(startMin)} · ${esc(booking?.title || '')}`
        : `${esc(court?.name || '')} · ${fmtTime(startMin)}`}</div>
    </div>
    ${isEdit
      ? `<button class="cb-cancel-booking-btn" id="cbCancelBooking">Cancel Booking</button>`
      : timerHTML}
  `;
}

function _buildPanelInner() {
  const isEdit   = cb.panel === 'edit';
  const booking  = cb.panelBooking;
  const startMin = _panelStartMin();
  const rsv = cb.reservation;

  if (rsv?.expired) {
    return `
      <div class="cb-expired">
        <div class="cb-expired-icon">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3 2"/></svg>
        </div>
        <div class="cb-expired-title">Your hold expired</div>
        <div class="cb-expired-msg">The 5-minute hold on this slot has ended. Tap the slot again to reserve it.</div>
      </div>
    `;
  }

  const slots  = getCourtSlots(cb.date, cb.courtId);
  const maxEnd = getMaxEnd(slots, startMin, isEdit ? booking?.id : null);

  const pills = [30, 60, 90, 120, 150, 180, 210, 240].map(d => {
    const disabled = startMin + d > maxEnd;
    const active   = d === cb.panelDuration;
    return `<button class="cb-pill${active?' cb-pill--active':''}${disabled?' cb-pill--disabled':''}" data-dur="${d}"${disabled?' disabled':''}>${durLabel(d)}</button>`;
  }).join('');

  const taken = new Set([state.currentUser?.playerId, ...cb.panelPlayers].filter(Boolean));

  const playerChips = cb.panelPlayers.map(pid => {
    const p = state.players?.find(pl => pl.id === pid);
    return `<span class="cb-player-chip">${esc(p?.name || 'Player')}<button class="cb-chip-x" data-remove="${pid}">×</button></span>`;
  }).join('');

  const results = cb.panelSearch.trim()
    ? (state.players || []).filter(p => !taken.has(p.id) && p.name.toLowerCase().includes(cb.panelSearch.trim().toLowerCase())).slice(0, 8)
    : [];

  const searchDropdown = (results.length || cb.panelSearch.trim()) ? `
    <div class="cb-search-results" id="cbSearchDropdown">
      ${results.length
        ? results.map(p => `<div class="cb-search-result" data-pid="${p.id}">${esc(p.name)}</div>`).join('')
        : '<div class="cb-search-empty">No players found</div>'}
    </div>
  ` : '';

  return `
    <div class="cb-panel-body">
      <div class="cb-panel-section">
        <div class="cb-panel-section-head">
          <span class="cb-kicker">Duration</span>
          <span class="cb-time-range">${fmtRange(startMin, cb.panelDuration)}</span>
        </div>
        <div class="cb-pills">${pills}</div>
      </div>
      <div class="cb-panel-section">
        <div class="cb-kicker">Add Players <span class="cb-kicker-note">· optional · up to 3</span></div>
        <div class="cb-players-list">
          <span class="cb-player-chip cb-player-chip--me"><span class="cb-me-dot"></span>${esc(myName())} <span class="cb-me-label">you</span></span>
          ${playerChips}
        </div>
        ${cb.panelPlayers.length < 3 ? `
          <div class="cb-search-wrap">
            <svg class="cb-search-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input class="cb-search-input" id="cbPlayerSearch" type="text" placeholder="Search club players…" value="${esc(cb.panelSearch)}" autocomplete="off">
          </div>
          ${searchDropdown}
        ` : ''}
      </div>
    </div>
    <div class="cb-panel-footer">
      <button class="cb-btn cb-btn--outline" id="cbPanelCancel">${isEdit ? 'Discard' : 'Cancel'}</button>
      <button class="cb-btn cb-btn--primary" id="cbPanelConfirm"${cb.panelBusy ? ' disabled' : ''}>
        ${cb.panelBusy ? (isEdit ? 'Saving…' : 'Booking…') : (isEdit ? 'Save Changes' : 'Confirm Booking')}
      </button>
    </div>
    ${cb.panelAskCancel ? `
    <div class="cb-ask-cancel">
      <div class="cb-ask-cancel-dialog">
        <div class="cb-ask-cancel-title">Cancel this booking?</div>
        <div class="cb-ask-cancel-msg">Are you sure you want to cancel "${esc(booking?.title || '')}" at ${fmtTime(startMin)}? This frees the slot for other players.</div>
        <div class="cb-ask-cancel-btns">
          <button class="cb-btn cb-btn--outline" id="cbKeepBooking">Keep it</button>
          <button class="cb-btn cb-btn--danger" id="cbConfirmCancel">Cancel Booking</button>
        </div>
      </div>
    </div>
    ` : ''}
  `;
}

function _renderPanel() {
  const existing = document.getElementById('cbPanelOverlay');

  if (existing) {
    // Panel already open — update content in-place, no slide animation or flash
    const headerEl = document.getElementById('cbPanelInnerHeader');
    const innerEl  = document.getElementById('cbPanelInner');
    if (headerEl) headerEl.innerHTML = _buildPanelHeader();
    if (innerEl)  innerEl.innerHTML  = _buildPanelInner();
    _attachPanelListeners();
    return;
  }

  // First open — create full overlay and trigger slide-in animation
  const mobile = isMobile();
  const overlay = document.createElement('div');
  overlay.id = 'cbPanelOverlay';
  overlay.className = 'cb-panel-overlay';
  overlay.innerHTML = `
    <div class="cb-panel-backdrop" id="cbPanelBackdrop"></div>
    <div class="cb-panel${mobile ? ' cb-panel--mobile' : ''}">
      ${mobile ? '<div class="cb-panel-handle" id="cbPanelHandle"><div class="cb-handle-bar"></div></div>' : ''}
      <div class="cb-panel-header" id="cbPanelInnerHeader">${_buildPanelHeader()}</div>
      <div id="cbPanelInner">${_buildPanelInner()}</div>
    </div>
  `;

  document.getElementById('cbPage').appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.querySelector('.cb-panel')?.classList.add('cb-panel--visible');
    overlay.querySelector('.cb-panel-backdrop')?.classList.add('cb-panel-backdrop--visible');
  });
  _attachPanelListeners();
}

// ── Listeners ─────────────────────────────────────────────────────────────────
function _attachEventListeners() {
  document.getElementById('cbPrevDay')?.addEventListener('click', () => {
    cb.date = addDays(cb.date, -1);
    _render();
    _loadSchedule(cb.date);
  });

  document.getElementById('cbNextDay')?.addEventListener('click', () => {
    cb.date = addDays(cb.date, 1);
    _render();
    _loadSchedule(cb.date);
  });

  document.getElementById('cbGoToday')?.addEventListener('click', () => {
    cb.date = todayStr();
    _render();
    _loadSchedule(cb.date).then(() => _scrollToNow());
  });

  _attachCourtBarListeners();
  _attachGridListeners();
}

function _attachCourtBarListeners() {
  document.querySelectorAll('.cb-court-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      cb.courtId = Number(tab.dataset.court);
      _refreshCourtBar();
      _renderGrid();
      _scrollToNow();
    });
  });
}

function _attachGridListeners() {
  const isPast = cb.date < todayStr();
  if (isPast) return;

  document.querySelectorAll('.cb-slot-open').forEach(slot => {
    slot.addEventListener('click', () => {
      if (slot.dataset.court) cb.courtId = Number(slot.dataset.court);
      _startReservation(Number(slot.dataset.start));
    });
  });

  document.querySelectorAll('.cb-block--mine').forEach(block => {
    block.addEventListener('click', () => {
      if (block.dataset.court) cb.courtId = Number(block.dataset.court);
      const slots   = getCourtSlots(cb.date, cb.courtId);
      const booking = slots.find(s => String(s.id) === String(block.dataset.bid));
      if (booking) _openPanel('edit', { booking });
    });
  });
}

function _attachPanelListeners() {
  const startMin = _panelStartMin();

  document.getElementById('cbPanelBackdrop')?.addEventListener('click', () => {
    if (!cb.panelBusy) _closePanel();
  });

  document.getElementById('cbPanelCancel')?.addEventListener('click', () => {
    if (!cb.panelBusy) _closePanel();
  });

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

  // Pill click — micro-update only, no re-render
  document.querySelectorAll('.cb-pill:not(.cb-pill--disabled)').forEach(pill => {
    pill.addEventListener('click', () => {
      cb.panelDuration = Number(pill.dataset.dur);
      document.querySelectorAll('.cb-pill').forEach(p => {
        p.classList.toggle('cb-pill--active', Number(p.dataset.dur) === cb.panelDuration);
      });
      const tr = document.querySelector('.cb-time-range');
      if (tr) tr.textContent = fmtRange(startMin, cb.panelDuration);
    });
  });

  // Player chip removal — inner update only (panel stays in place, no flash)
  document.querySelectorAll('.cb-chip-x').forEach(btn => {
    btn.addEventListener('click', () => {
      cb.panelPlayers = cb.panelPlayers.filter(id => id !== Number(btn.dataset.remove));
      _renderPanel();
    });
  });

  // Search input — only update dropdown, never full re-render (preserves focus)
  const searchInput = document.getElementById('cbPlayerSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      cb.panelSearch = e.target.value;
      _updateSearchDropdown();
    });
  }

  // Search result click — inner update to add player chip
  document.querySelectorAll('#cbSearchDropdown .cb-search-result').forEach(result => {
    result.addEventListener('click', () => {
      const pid = Number(result.dataset.pid);
      if (!cb.panelPlayers.includes(pid)) {
        cb.panelPlayers.push(pid);
        cb.panelSearch = '';
        _renderPanel();
      }
    });
  });

  // Mobile drag-to-dismiss
  const handle = document.getElementById('cbPanelHandle');
  if (handle) {
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
      drag = { y0: e.clientY, t0: Date.now() };
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = Math.max(0, e.clientY - drag.y0);
      const panel = document.querySelector('.cb-panel--mobile');
      if (panel) panel.style.transform = `translateY(${dy}px)`;
    });
    handle.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const dy = Math.max(0, e.clientY - drag.y0);
      const dt = Date.now() - drag.t0;
      drag = null;
      const panel = document.querySelector('.cb-panel--mobile');
      if (panel) panel.style.transform = '';
      if (dy > 130 || (dy > 50 && dt < 200)) _closePanel();
    });
  }
}

// Updates only the search dropdown without touching the rest of the panel
function _updateSearchDropdown() {
  document.getElementById('cbSearchDropdown')?.remove();

  const taken = new Set([state.currentUser?.playerId, ...cb.panelPlayers].filter(Boolean));
  const results = cb.panelSearch.trim()
    ? (state.players || []).filter(p =>
        !taken.has(p.id) &&
        p.name.toLowerCase().includes(cb.panelSearch.trim().toLowerCase())
      ).slice(0, 8)
    : [];

  if (!results.length && !cb.panelSearch.trim()) return;

  const wrap = document.querySelector('.cb-search-wrap');
  if (!wrap) return;

  const div = document.createElement('div');
  div.className = 'cb-search-results';
  div.id = 'cbSearchDropdown';
  div.innerHTML = results.length
    ? results.map(p => `<div class="cb-search-result" data-pid="${p.id}">${esc(p.name)}</div>`).join('')
    : '<div class="cb-search-empty">No players found</div>';

  wrap.insertAdjacentElement('afterend', div);

  div.querySelectorAll('.cb-search-result').forEach(result => {
    result.addEventListener('click', () => {
      const pid = Number(result.dataset.pid);
      if (!cb.panelPlayers.includes(pid)) {
        cb.panelPlayers.push(pid);
        cb.panelSearch = '';
        _renderPanel();
      }
    });
  });
}

// ── API Actions ───────────────────────────────────────────────────────────────
async function _startReservation(startMin) {
  try {
    const rsv = await window.api.createReservation({
      courtId: cb.courtId,
      date: cb.date,
      startTime: minToTime(startMin),
      durationMinutes: 30,
    });

    if (cb.reservation?.timerId) clearInterval(cb.reservation.timerId);

    cb.reservation = {
      id: rsv.reservationId,
      expiresAt: rsv.expiresAt,
      secs: 300,
      expired: false,
      timerId: null,
    };

    cb.reservation.timerId = setInterval(() => {
      cb.reservation.secs--;
      if (cb.reservation.secs <= 0) {
        clearInterval(cb.reservation.timerId);
        cb.reservation.expired = true;
        _renderPanel();
        setTimeout(() => _closePanel('expired'), 1400);
        return;
      }
      const s = cb.reservation.secs;
      const display = document.getElementById('cbTimerDisplay');
      if (display) display.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
      const timerEl = document.querySelector('.cb-hold-timer');
      if (timerEl) timerEl.classList.toggle('cb-hold-timer--warn', s < 60);
    }, 1000);

    _openPanel('book', { startMin });
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
    await _loadSchedule(cb.date);
    _renderGrid();
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
    delete cb.scheduleCache[cb.date];
    await _loadSchedule(cb.date);
    _renderGrid();
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
    await _loadSchedule(cb.date);
    _renderGrid();
  } catch (e) {
    toast(e.message || 'Cancel failed.', 'error');
  }
}
