import { state, isAdmin } from './state.js';
import { esc, toast } from './utils.js';
import { openBookingPanel, closeBookingPanel, isBookingPanelOpen } from './schedulePanel.js';

// AbortController for document-level drag/click listeners — aborted and recreated on each renderSchedule() call
let _scheduleListenerAC = null;

// A single click may open the panel instead of selecting, if the club ever
// prefers that; the design defaults to select.
const CLICK_OPENS = 'select';

// Soft tint: block backgrounds are white mixed 9% toward the type colour.
const TINT = 0.09;

// ===== SCHEDULE PAGE =====
function _isoDate(d) {
  // Returns YYYY-MM-DD for a Date object using local time
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _addDaysLocal(isoDate, n) {
  const parts = isoDate.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + n);
  return _isoDate(d);
}

function _tToMin(t) {
  if (!t) return null;
  const p = t.split(':').map(Number);
  return p[0] * 60 + (p[1] || 0);
}
function _overlaps(aStart, aDur, bStart, bDur) {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}
// "2:15" - no meridiem, for the left half of a range that ends with one.
function _fmtNoAp(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, '0')}`;
}
function _fmt12(m) {
  return `${_fmtNoAp(m)} ${Math.floor(m / 60) < 12 ? 'AM' : 'PM'}`;
}
function _fmtRange(s, d) {
  return `${_fmtNoAp(s)}–${_fmt12(s + d)}`;
}
function _durLabel(d) {
  const h = Math.floor(d / 60), m = d % 60;
  return (h ? `${h}h` : '') + (h && m ? ' ' : '') + (m ? `${m}m` : '');
}
// Linear RGB mix of two hex colours: mix('#ffffff', type, .09) is the tint.
function _mix(a, b, t) {
  const p = (hx) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function _isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || '');
}

// ===== UNDO =====
function _pushUndo(op) {
  if (!state.scheduleUndoStack) state.scheduleUndoStack = [];
  state.scheduleUndoStack.push(op);
  if (state.scheduleUndoStack.length > 50) state.scheduleUndoStack.shift();
}

async function _executeUndo() {
  if (!state.scheduleUndoStack?.length) return;
  const op = state.scheduleUndoStack.pop();
  try {
    if (op.type === 'delete-ids') {
      for (const id of op.ids) await window.api.deleteBooking(id);
    } else if (op.type === 'recreate') {
      for (const b of op.bookings) {
        await window.api.addBooking({
          courtId: b.courtId, courtIds: b.courtIds || null, date: b.date,
          startTime: b.startTime, durationMinutes: b.durationMinutes,
          bookingTypeId: b.bookingTypeId || null,
          name: b.name || null, info: b.info || null,
          playerIds: (b.players || []).map((p) => p.id),
        });
      }
    } else if (op.type === 'update') {
      await window.api.updateBooking(op.id, op.oldData);
    }
    // Undo reverts quietly: the change disappearing is its own confirmation.
    _clearToast();
    state.scheduleSel = null;
    renderSchedule();
  } catch (err) { _schToast('Undo failed: ' + err.message); }
}

// ===== TOAST =====
// The page's own toast: bottom-centre of the main column, dark, with an Undo
// link when the action can be taken back. It lives in module state so a
// re-render redraws it rather than losing it.
let _toastState = null;
let _toastTimer = null;

function _clearToast() {
  clearTimeout(_toastTimer);
  _toastTimer = null;
  _toastState = null;
  document.getElementById('schToast')?.remove();
}

function _schToast(text, undoable = false) {
  clearTimeout(_toastTimer);
  _toastState = { text, undoable };
  _renderToast();
  _toastTimer = setTimeout(() => _clearToast(), 4200);
}

function _renderToast() {
  document.getElementById('schToast')?.remove();
  if (!_toastState) return;
  const page = document.querySelector('.sch-page');
  if (!page) return;
  const el = document.createElement('div');
  el.className = 'sch-toast';
  el.id = 'schToast';
  el.innerHTML = `<span>${esc(_toastState.text)}</span>${_toastState.undoable ? '<button class="sch-toast-undo" id="schToastUndo">Undo</button>' : ''}`;
  page.appendChild(el);
  el.querySelector('#schToastUndo')?.addEventListener('click', () => _executeUndo());
}

export async function renderSchedule() {
  document.getElementById('pageTitle').textContent = 'Schedule';
  const content = document.getElementById('mainContent');
  content.classList.add('content--schedule');

  // Any re-render replaces the grid the panel is anchored to, so it closes
  // first rather than being orphaned in the DOM.
  closeBookingPanel();

  if (!state.scheduleDate) state.scheduleDate = _isoDate(new Date());
  const today = _isoDate(new Date());

  const savedScrollTop = content.querySelector('.sch-grid-scroll')?.scrollTop ?? 0;

  const isMac = _isMac();
  const K = { mod: isMac ? '⌘' : 'Ctrl+', del: isMac ? '⌫' : 'Del', enter: isMac ? '↵' : 'Enter' };

  const actionsEl = document.getElementById('topbarActions');
  // The helper line and the button live in the app's own top bar, as on every
  // other page, rather than the page growing a second bar of its own.
  actionsEl.innerHTML = isAdmin()
    ? `<span class="sch-topbar-help">Drag empty space to book · drag a booking to move it · pull its edges to resize · ${K.mod}C ${K.mod}V ${K.mod}D ${K.del} ${K.mod}Z</span>
       <button class="sch-new-btn" id="btnNewBooking">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
         New booking
       </button>`
    : '';

  content.innerHTML = `<div style="padding:20px;color:var(--text-muted)">Loading…</div>`;

  let scheduleData, bookingTypes;
  try {
    [scheduleData, bookingTypes] = await Promise.all([
      window.api.getSchedule(state.scheduleDate),
      window.api.getBookingTypes(),
    ]);
  } catch (e) {
    content.innerHTML = `<div style="padding:20px;color:var(--text-danger)">Failed to load schedule: ${esc(e.message)}</div>`;
    return;
  }

  const { courts, slots } = scheduleData;
  const N = courts.length;

  // Column widths matched between sticky header grid and body flex
  const isMobile = window.innerWidth < 640;
  const TIME_COL_W = isMobile ? 44 : 64;
  const COURT_COL_W = isMobile ? 140 : 200;

  // Date display info
  const [dpY, dpM, dpD] = state.scheduleDate.split('-').map(Number);
  const dateObj = new Date(dpY, dpM - 1, dpD);
  const weekdayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  const isToday = state.scheduleDate === today;

  // Monday-to-Sunday strip for the week that holds the selected date.
  const monthDayLabel = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const WD1 = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const mondayIso = _addDaysLocal(state.scheduleDate, -((dateObj.getDay() + 6) % 7));
  const dayStripHTML = Array.from({ length: 7 }, (_, i) => {
    const d = _addDaysLocal(mondayIso, i);
    const dObj = new Date(d + 'T12:00:00');
    const sel = d === state.scheduleDate;
    const isDayToday = d === today;
    return `<button class="cb-day${sel ? ' cb-day--sel' : ''}" data-date="${d}">
      <span class="cb-day-wd">${WD1[i]}</span>
      <span class="cb-day-n">${dObj.getDate()}</span>
      <span class="cb-day-dot${!sel && isDayToday ? ' cb-day-dot--on' : ''}"></span>
    </button>`;
  }).join('');

  // The calendar popover, same markup and behaviour as the player page.
  const schCalOpen = !!state.scheduleCalOpen;
  const schCalMonth = state.scheduleCalMonth || state.scheduleDate.slice(0, 7);
  const schCalendarHTML = (() => {
    if (!schCalOpen) return '';
    const [cy, cm] = schCalMonth.split('-').map(Number);
    const lead = new Date(cy, cm - 1, 1).getDay();
    const days = new Date(cy, cm, 0).getDate();
    const MOx = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="cb-cal-cell cb-cal-cell--blank"></span>');
    for (let d = 1; d <= days; d++) {
      const iso = `${cy}-${String(cm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const sel = iso === state.scheduleDate;
      const isDayToday = iso === today;
      // Admins may look at, and book, any date - including past ones.
      cells.push(`<button class="cb-cal-cell${sel ? ' cb-cal-cell--sel' : ''}${!sel && isDayToday ? ' cb-cal-cell--today' : ''}" data-caldate="${iso}">${d}</button>`);
    }
    return `<div class="cb-cal" id="schCal">
      <div class="cb-cal-head">
        <span class="cb-cal-month">${MOx[cm - 1]} ${cy}</span>
        <div class="cb-cal-navs">
          <button class="cb-cal-nav" id="schCalPrev" aria-label="Previous month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
          <button class="cb-cal-nav" id="schCalNext" aria-label="Next month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
        </div>
      </div>
      <div class="cb-cal-wd">${['S','M','T','W','T','F','S'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cb-cal-grid">${cells.join('')}</div>
    </div>`;
  })();

  // Time axis
  const DAY_START = 6 * 60;
  const DAY_END   = 23 * 60;
  const SLOT_H      = 38;
  const SLOT_MIN    = 30;
  const totalSlots  = (DAY_END - DAY_START) / SLOT_MIN;
  const BASE_GRID_H = totalSlots * SLOT_H;
  const pxm = SLOT_H / SLOT_MIN;

  function topFor(m) {
    return ((m - DAY_START) / SLOT_MIN) * SLOT_H;
  }

  // "6 AM", matching the player grid's gutter.
  function fmtHour(h) {
    return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
  }

  const timeAxisHTML = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) {
    const h = Math.floor(m / 60);
    const top = topFor(m);
    const transform = top === 0 ? ';transform:none' : ';transform:translateY(-50%)';
    timeAxisHTML.push(`<div class="sch-time-label" style="top:${top}px${transform}">${fmtHour(h)}</div>`);
  }

  // "Now" indicator — only on today, within operating hours
  const _nowDate = new Date();
  const nowMins = _nowDate.getHours() * 60 + _nowDate.getMinutes();
  const showNow = isToday && nowMins >= DAY_START && nowMins < DAY_END;
  const nowTop = topFor(nowMins);
  if (showNow) {
    timeAxisHTML.push(`<div class="sch-now-label" style="top:${nowTop}px;transform:translateY(-50%)">Now</div>`);
  }

  // Every other hour is filled rather than ruled, so the eye tracks rows
  // without a line every thirty minutes.
  const gridLinesHTML = Array.from({ length: Math.ceil(totalSlots / 4) }, (_, i) =>
    `<div class="sch-band" style="top:${i * SLOT_H * 4}px"></div>`).join('');

  const courtIdxById = new Map(courts.map((c, i) => [c.id, i]));
  const typeById = new Map(bookingTypes.map((t) => [t.id, t]));

  // ── The day's slots, enriched for the grid ──────────────────────────────────
  // Every slot gets its minute range, its contiguous span of column indices,
  // and the derived display text: title is the label, else the first player,
  // else the type; the remaining players are the info line.
  const enriched = slots.map((s) => {
    const startMin = _tToMin(s.startTime);
    if (startMin === null) return null;
    const idxs = (s.courtIds?.length ? s.courtIds : [s.courtId])
      .map((id) => courtIdxById.get(id)).filter((x) => x !== undefined);
    if (!idxs.length) return null;
    const lo = Math.min(...idxs), hi = Math.max(...idxs);
    const isCustom = s.source === 'custom';
    const playerNames = (s.players || []).map((p) => p.name).filter(Boolean);
    const typeName = s.bookingTypeId ? (typeById.get(s.bookingTypeId)?.name || 'Booking') : 'Standard';
    const color = isCustom ? (s.bookingTypeId ? (s.color || '#3550c8') : '#3550c8') : (s.color || '#3550c8');
    const title = isCustom ? (s.name || playerNames[0] || typeName) : s.title;
    const info = isCustom
      ? ((s.name ? playerNames.join(', ') : playerNames.slice(1).join(', ')) || s.info || '')
      : (s.info || '');
    return { ...s, startMin, endMin: startMin + s.durationMinutes, lo, hi, color, title, info, isCustom };
  }).filter((s) => s && s.startMin >= DAY_START - 24 * 60 && topFor(s.startMin) < BASE_GRID_H && topFor(s.endMin) > 0);

  const slotById = new Map(enriched.map((s) => [String(s.id), s]));

  // Colour to type, for the types actually on this day. An empty day gets no
  // legend rather than an empty rail.
  const legendHTML = (() => {
    const custom = enriched.filter((s) => s.isCustom);
    if (!custom.length) return '';
    const seen = new Map();
    for (const s of custom) {
      const name = s.bookingTypeId ? (typeById.get(s.bookingTypeId)?.name || 'Booking') : 'Standard';
      if (!seen.has(name)) seen.set(name, s.color);
    }
    const items = [...seen].map(([name, color]) =>
      `<span class="sch-legend-item"><span class="sch-legend-dot" style="background:${esc(color)}"></span>${esc(name)}</span>`).join('');
    return `<div class="sch-legend">
      <span class="sch-legend-label">On this day</span>
      ${items}
    </div>`;
  })();

  // ── Blocks ──────────────────────────────────────────────────────────────────
  // All blocks live in one overlay spanning the court columns, so a booking
  // across several courts is one wide block rather than a row per court.
  const admin = isAdmin();

  function blockGeometry(s0, d0, lo, hi) {
    const top = topFor(s0) + 1;
    const height = Math.min(topFor(s0 + d0), BASE_GRID_H) - topFor(s0) - 3;
    const span = hi - lo + 1;
    return {
      left: `calc(${(lo / N) * 100}% + 6px)`,
      width: `calc(${(span / N) * 100}% - 13px)`,
      top: `${top}px`,
      height: `${Math.max(height, 9)}px`,
    };
  }

  // "Court 3–4"; a court whose name doesn't start with "Court" prints in full.
  function courtSpanText(lo, hi) {
    if (lo === hi) return '';
    return ` · ${courts[lo].name}–${courts[hi].name.replace(/^Court /, '')}`;
  }

  function blockTimeText(s0, d0, lo, hi, short) {
    return _fmtRange(s0, d0) + (short ? '' : courtSpanText(lo, hi));
  }

  function blockHTML(b) {
    const g = blockGeometry(b.startMin, b.durationMinutes, b.lo, b.hi);
    const h = parseFloat(g.height);
    const short = h < 34;
    const selNow = admin && state.scheduleSel != null && String(state.scheduleSel) === String(b.id);
    const bg = _mix('#ffffff', b.color, TINT);
    const timeInk = _mix(b.color, '#1c2b3a', 0.2);
    const repInk = _mix(b.color, '#ffffff', 0.35);
    const grab = admin && (b.isCustom || b.source === 'league');
    // Edge hit zones, on editable bookings only. No visible grips - the cursor
    // change is the affordance.
    const handles = admin && b.isCustom ? `
      <span class="sch-h sch-h--top" data-h="top"></span>
      <span class="sch-h sch-h--bottom" data-h="bottom"></span>
      <span class="sch-h sch-h--left" data-h="left"></span>
      <span class="sch-h sch-h--right" data-h="right"></span>` : '';
    return `<div class="sch-block${short ? ' sch-block--short' : ''}${selNow ? ' sch-block--sel' : ''}" data-slot="${esc(String(b.id))}"
      style="left:${g.left};width:${g.width};top:${g.top};height:${g.height};background:${bg};border-left-color:${esc(b.color)};${grab ? '' : 'cursor:default;'}">
      <span class="sch-block-time" style="color:${timeInk}">${esc(blockTimeText(b.startMin, b.durationMinutes, b.lo, b.hi, short))}</span>
      <span class="sch-block-title">${esc(b.title)}</span>
      ${b.info && h > 52 ? `<span class="sch-block-info">${esc(b.info)}</span>` : ''}
      ${b.repeatGroupId ? `<span class="sch-block-rep" style="color:${repInk}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg></span>` : ''}
      ${handles}
    </div>`;
  }

  const blocksHTML = enriched.map(blockHTML).join('');

  // The floating toolbar for the selected booking.
  const tbBtn = (id, title, danger, svg) =>
    `<button class="sch-tb-btn${danger ? ' sch-tb-btn--danger' : ''}" id="${id}" title="${esc(title)}">${svg}</button>`;
  const toolbarHTML = admin ? `
    <div class="sch-tb" id="schToolbar" hidden>
      ${tbBtn('schTbEdit', `Edit (${K.enter})`, false, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>')}
      ${tbBtn('schTbDup', `Duplicate (${K.mod}D)`, false, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>')}
      ${tbBtn('schTbCopy', `Copy (${K.mod}C)`, false, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>')}
      <span class="sch-tb-rule"></span>
      ${tbBtn('schTbDel', `Delete (${K.del})`, true, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>')}
    </div>` : '';

  const courtColumnsHTML = courts.map((court) =>
    `<div class="sch-court-col" style="height:${BASE_GRID_H}px" data-court-id="${court.id}">${gridLinesHTML}</div>`
  ).join('');

  // The veil dims everything already gone; the now line marks the moment.
  const veilHTML = showNow ? `<div class="sch-veil" style="height:${Math.min(nowTop, BASE_GRID_H)}px"></div>` : '';
  const nowLineHTML = showNow ? `<div class="sch-now-line" style="top:${nowTop}px"></div>` : '';

  content.innerHTML = `
    <div class="sch-page">

      <div class="cb-date-bar sch-date-bar">
        <div class="cb-date-row cb-date-row--desktop">
          <button class="cb-icon-btn" id="schPrev" aria-label="Previous day">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
          </button>
          <div class="cb-date-block">
            <div class="cb-date-wd">${weekdayName.toUpperCase()}${isToday ? '<span class="cb-today-pill">Today</span>' : ''}</div>
            <div class="cb-date-md">${monthDayLabel}</div>
          </div>
          <button class="cb-icon-btn" id="schNext" aria-label="Next day">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
          </button>
          <div class="cb-week">${dayStripHTML}</div>
          <div class="cb-cal-anchor">
            <button class="cb-icon-btn${schCalOpen ? ' cb-icon-btn--on' : ''}" id="schCalBtn" aria-label="Choose a date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>
            </button>
            ${schCalendarHTML}
          </div>
        </div>
      </div>


      ${courts.length === 0
        ? `<div class="sch-no-courts">No courts configured.${isAdmin() ? ` <a href="#" id="schGoSettings">Add courts in Club Settings.</a>` : ''}</div>`
        : `<div class="sch-grid-area">
            <div class="sch-grid-card">
              <div class="sch-grid-scroll">
                <div class="sch-grid-sticky">
                  <div class="sch-grid-header">
                    <div class="sch-time-spacer" style="width:${TIME_COL_W}px"></div>
                    ${courts.map((c) => `<div class="sch-court-hd" style="min-width:${COURT_COL_W}px">${esc(c.name)}</div>`).join('')}
                  </div>
                  ${legendHTML}
                </div>
                <div class="sch-grid-body">
                  <div class="sch-time-col" style="width:${TIME_COL_W}px;height:${BASE_GRID_H}px">${timeAxisHTML.join('')}</div>
                  <div class="sch-courts-row" style="--court-w:${COURT_COL_W}px">
                    ${courtColumnsHTML}
                    ${veilHTML}
                    ${nowLineHTML}
                    <div class="sch-overlay" id="schOverlay">${blocksHTML}${toolbarHTML}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>`
      }
    </div>`;

  _renderToast();

  // Date controls. Changing the day closes the calendar and drops the
  // selection, as picking a different day always has.
  const goToDate = (d) => {
    state.scheduleDate = d;
    state.scheduleCalOpen = false;
    state.scheduleSel = null;
    renderSchedule();
  };
  content.querySelectorAll('.cb-day').forEach((btn) => {
    btn.addEventListener('click', () => goToDate(btn.dataset.date));
  });
  document.getElementById('schPrev')?.addEventListener('click', () => goToDate(_addDaysLocal(state.scheduleDate, -1)));
  document.getElementById('schNext')?.addEventListener('click', () => goToDate(_addDaysLocal(state.scheduleDate, 1)));

  document.getElementById('schCalBtn')?.addEventListener('click', () => {
    state.scheduleCalOpen = !state.scheduleCalOpen;
    if (state.scheduleCalOpen) state.scheduleCalMonth = state.scheduleDate.slice(0, 7);
    renderSchedule();
  });
  const shiftMonth = (delta) => {
    const [y, m] = (state.scheduleCalMonth || state.scheduleDate.slice(0, 7)).split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    state.scheduleCalMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    renderSchedule();
  };
  document.getElementById('schCalPrev')?.addEventListener('click', () => shiftMonth(-1));
  document.getElementById('schCalNext')?.addEventListener('click', () => shiftMonth(1));
  content.querySelectorAll('[data-caldate]').forEach((el) => {
    el.addEventListener('click', () => goToDate(el.dataset.caldate));
  });
  document.getElementById('schGoSettings')?.addEventListener('click', (e) => {
    e.preventDefault(); window.navigate('clubSettings');
  });

  // ── Admin interactions ──────────────────────────────────────────────────────
  if (admin) {
    const courtsRow = content.querySelector('.sch-courts-row');
    if (courtsRow) {
      courtsRow.classList.add('sch-courts-row--admin');
      const overlay = document.getElementById('schOverlay');
      const tbEl = document.getElementById('schToolbar');

      if (_scheduleListenerAC) _scheduleListenerAC.abort();
      _scheduleListenerAC = new AbortController();
      const { signal } = _scheduleListenerAC;

      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      let bdrag = null;   // block move/resize in progress
      let drag = null;    // create-drag on empty space

      function minutesToTimeStr(m) {
        return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      }
      function getCourtIdxAtX(clientX) {
        const cols = [...courtsRow.querySelectorAll('.sch-court-col')];
        return cols.findIndex((col) => { const r = col.getBoundingClientRect(); return clientX >= r.left && clientX < r.right; });
      }
      function getColRect(idx) {
        return [...courtsRow.querySelectorAll('.sch-court-col')][idx]?.getBoundingClientRect();
      }
      // Floor rather than round: the cursor should land in the quarter hour it
      // is pointing at, never the one above it.
      function snapFloor(clientY) {
        const y = Math.max(0, Math.min(clientY - courtsRow.getBoundingClientRect().top, BASE_GRID_H - 1));
        const m = Math.floor((DAY_START + y / pxm) / 15) * 15;
        return clamp(m, DAY_START, DAY_END - 15);
      }

      // The rows a booking owns, so a check never conflicts it with itself.
      function memberSet(b) {
        return new Set((b.memberIds || [b.id]).map(String).concat(String(b.id)));
      }
      // Does {lo..hi, s, d} overlap anything on the day, other than exclude?
      function clash(cand, excludeIds) {
        return enriched.some((b) => {
          if (excludeIds && excludeIds.has(String(b.id))) return false;
          return b.lo <= cand.hi && b.hi >= cand.lo && _overlaps(cand.s, cand.d, b.startMin, b.durationMinutes);
        });
      }
      function placeLabel(cand) {
        const c = cand.lo === cand.hi
          ? courts[cand.lo].name
          : `${courts[cand.lo].name}–${courts[cand.hi].name.replace(/^Court /, '')}`;
        return `${c} · ${_fmt12(cand.s)}`;
      }

      // ── Selection ─────────────────────────────────────────────────────────
      function applySel() {
        overlay.querySelectorAll('.sch-block').forEach((el) =>
          el.classList.toggle('sch-block--sel', state.scheduleSel != null && el.dataset.slot === String(state.scheduleSel)));
        positionToolbar();
      }
      function positionToolbar() {
        const b = state.scheduleSel != null ? slotById.get(String(state.scheduleSel)) : null;
        if (!b || !b.isCustom || bdrag) { tbEl.hidden = true; return; }
        const top = topFor(b.startMin);
        const above = top > 40;
        tbEl.style.left = `calc(${(b.lo / N) * 100}% + 6px)`;
        tbEl.style.top = `${above ? top - 37 : topFor(b.endMin) + 2}px`;
        tbEl.hidden = false;
      }
      function select(id) {
        state.scheduleSel = id;
        applySel();
      }
      applySel();

      // ── Data actions ──────────────────────────────────────────────────────
      function bookingFields(b) {
        return {
          courtId: b.courtId, courtIds: b.courtIds || null,
          date: b.date || state.scheduleDate, startTime: b.startTime,
          durationMinutes: b.durationMinutes, bookingTypeId: b.bookingTypeId || null,
          name: b.name || null, info: b.info || null,
          playerIds: (b.players || []).map((p) => p.id),
        };
      }

      function copySlot(b) {
        state.scheduleClipboard = {
          lo: b.lo, hi: b.hi, startMin: b.startMin, durationMinutes: b.durationMinutes,
          bookingTypeId: b.bookingTypeId || null, name: b.name || null, info: b.info || null,
          players: (b.players || []).map((p) => ({ id: p.id, name: p.name })),
          title: b.title,
        };
        _schToast(`Copied ${b.title} · ${K.mod}V to paste, or right-click a slot`);
      }

      // Place a copy of src at target {ci, m}, or at the next free slot on the
      // same courts after the source's end when there is no target.
      async function place(src, target, verb, undoableToast = true) {
        const span = src.hi - src.lo;
        let cand = null;
        if (target) {
          const l = clamp(target.ci, 0, N - 1 - span);
          const s0 = clamp(target.m, DAY_START, DAY_END - src.durationMinutes);
          cand = { lo: l, hi: l + span, s: s0, d: src.durationMinutes };
          if (clash(cand, null)) { _schToast('That slot overlaps an existing booking'); return; }
        } else {
          for (let m = src.startMin + src.durationMinutes; m + src.durationMinutes <= DAY_END; m += 15) {
            const c = { lo: src.lo, hi: src.hi, s: m, d: src.durationMinutes };
            if (!clash(c, null)) { cand = c; break; }
          }
          if (!cand) { _schToast('No free slot left on that court today'); return; }
        }
        const runCourts = courts.slice(cand.lo, cand.hi + 1).map((c) => c.id);
        try {
          const made = await window.api.addBooking({
            courtId: runCourts[0], courtIds: runCourts.length > 1 ? runCourts : null,
            date: state.scheduleDate, startTime: minutesToTimeStr(cand.s), durationMinutes: cand.d,
            bookingTypeId: src.bookingTypeId || null, name: src.name || null, info: src.info || null,
            playerIds: (src.players || []).map((p) => p.id),
          });
          if (made?.id) _pushUndo({ type: 'delete-ids', ids: [made.id] });
          state.scheduleSel = made?.id ?? null;
          _schToast(`${verb} to ${placeLabel(cand)}`, undoableToast);
          renderSchedule();
        } catch (err) { _schToast(err.message); }
      }

      function duplicateSlot(b) { place(b, null, 'Duplicated'); }
      function pasteAt(target) {
        if (state.scheduleClipboard) place(state.scheduleClipboard, target, 'Pasted');
      }

      async function removeSlot(b) {
        try {
          await window.api.deleteBooking(b.id);
          _pushUndo({ type: 'recreate', bookings: [bookingFields(b)].map((f) => ({ ...f, players: b.players || [] })) });
          state.scheduleSel = null;
          _schToast(`Deleted ${b.title}`, true);
          renderSchedule();
        } catch (err) { _schToast(err.message); }
      }

      // ── Panel ─────────────────────────────────────────────────────────────
      let _playersCache = null;
      async function openPanel(mode, extra) {
        if (!_playersCache) {
          try { _playersCache = await window.api.getPlayers(); }
          catch (err) { toast(err.message, 'error'); return; }
        }
        openBookingPanel({
          mode,
          // The panel covers the whole main column, top bar included, so its
          // scrim leaves no live buttons above the tint.
          host: content.closest('.main-wrapper') || content.querySelector('.sch-page'),
          courts, slots: enriched, types: bookingTypes, players: _playersCache,
          ...extra,
          onRange: (courtIds, start, dur) => {
            const idxs = courtIds.map((id) => courtIdxById.get(id))
              .filter((x) => x !== undefined).sort((a, b) => a - b);
            if (!idxs.length) { clearGhosts(); return; }
            drawGhosts(idxs, start, start + dur);
          },
          onDone: (selectId) => { state.scheduleSel = selectId ?? null; renderSchedule(); },
          onClose: () => { clearGhosts(); hoverLine.style.display = 'none'; },
          notify: (text, undoable) => _schToast(text, undoable),
          pushUndo: _pushUndo,
        });
      }
      function openEditFor(b) {
        select(b.id);
        openPanel('edit', { slot: b });
      }

      // ── Snap line & create-ghosts ─────────────────────────────────────────
      const hoverLine = document.createElement('div');
      hoverLine.className = 'sch-hover-line';
      hoverLine.innerHTML = '<span class="sch-hover-pill"></span>';
      hoverLine.style.display = 'none';
      courtsRow.appendChild(hoverLine);
      const hoverPill = hoverLine.firstElementChild;

      let hover = null; // { ci, m } - also the paste target under the cursor

      let ghostEls = [];
      function clearGhosts() {
        ghostEls.forEach((g) => g.remove());
        ghostEls = [];
      }
      function drawGhosts(idxs, minTime, maxTime) {
        const n = idxs.length;
        while (ghostEls.length > n) ghostEls.pop().remove();
        while (ghostEls.length < n) {
          const g = document.createElement('div');
          g.className = 'sch-ghost';
          g.innerHTML = '<span class="sch-ghost-label"></span>';
          courtsRow.appendChild(g);
          ghostEls.push(g);
        }
        if (!n) return;
        const rowRect = courtsRow.getBoundingClientRect();
        const top = topFor(minTime);
        const height = Math.max(topFor(maxTime) - top - 3, 9);
        const label = `${_fmtNoAp(minTime)}–${_fmt12(maxTime)} · ${_durLabel(maxTime - minTime)}`;
        const leftmost = Math.min(...idxs);
        idxs.forEach((ci, i) => {
          const g = ghostEls[i];
          const cr = getColRect(ci);
          if (!cr) { g.style.display = 'none'; return; }
          g.style.display = '';
          g.style.top = `${top + 1}px`;
          g.style.height = `${height}px`;
          g.style.left = `${cr.left - rowRect.left + 6}px`;
          g.style.width = `${Math.max(cr.width - 13, 0)}px`;
          g.firstElementChild.textContent = ci === leftmost ? label : '';
        });
      }

      function updateHoverLine(e) {
        if (drag || bdrag || isBookingPanelOpen() || e.target.closest('.sch-block, .sch-tb')) {
          hoverLine.style.display = 'none';
          hover = null;
          return;
        }
        const courtIdx = getCourtIdxAtX(e.clientX);
        if (courtIdx === -1) { hoverLine.style.display = 'none'; hover = null; return; }
        const cr = getColRect(courtIdx);
        if (!cr) { hoverLine.style.display = 'none'; hover = null; return; }
        const rowRect = courtsRow.getBoundingClientRect();
        const snappedTime = snapFloor(e.clientY);
        hover = { ci: courtIdx, m: snappedTime };
        hoverLine.style.top = `${topFor(snappedTime)}px`;
        hoverLine.style.left = `${cr.left - rowRect.left + 6}px`;
        hoverLine.style.width = `${Math.max(cr.width - 13, 0)}px`;
        hoverPill.textContent = _fmt12(snappedTime);
        hoverLine.style.display = 'block';
      }
      courtsRow.addEventListener('mousemove', (e) => updateHoverLine(e), { signal });
      courtsRow.addEventListener('mouseleave', () => { hoverLine.style.display = 'none'; hover = null; }, { signal });

      // ── Context menu ──────────────────────────────────────────────────────
      let menuEl = null;
      function closeMenu() {
        menuEl?.remove(); menuEl = null;
        document.getElementById('schMenuBack')?.remove();
      }
      function openMenu(x, y, head, items) {
        closeMenu();
        const back = document.createElement('div');
        back.id = 'schMenuBack';
        back.className = 'sch-menu-back';
        back.addEventListener('mousedown', () => closeMenu());
        back.addEventListener('contextmenu', (e) => { e.preventDefault(); closeMenu(); });
        document.body.appendChild(back);
        menuEl = document.createElement('div');
        menuEl.className = 'sch-menu';
        menuEl.style.left = `${x}px`;
        menuEl.style.top = `${y}px`;
        menuEl.innerHTML = `<span class="sch-menu-head">${esc(head)}</span>` + items.map((it, i) =>
          `<button class="sch-menu-item${it.danger ? ' sch-menu-item--danger' : ''}"${it.disabled ? ' disabled' : ''} data-mi="${i}">
            ${esc(it.label)}<span class="sch-menu-key">${esc(it.key || '')}</span>
          </button>`).join('');
        document.body.appendChild(menuEl);
        menuEl.querySelectorAll('[data-mi]').forEach((el) => el.addEventListener('click', () => {
          const it = items[Number(el.dataset.mi)];
          closeMenu();
          if (!it.disabled) it.act();
        }));
      }

      courtsRow.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const blockEl = e.target.closest('.sch-block');
        if (blockEl) {
          const b = slotById.get(blockEl.dataset.slot);
          if (!b || !b.isCustom) return;   // match blocks keep their own doors
          select(b.id);
          openMenu(e.clientX, e.clientY, `${b.title} · ${_fmtRange(b.startMin, b.durationMinutes)}`, [
            { label: 'Edit', key: K.enter, act: () => openEditFor(b) },
            { label: 'Duplicate', key: `${K.mod}D`, act: () => duplicateSlot(b) },
            { label: 'Copy', key: `${K.mod}C`, act: () => copySlot(b) },
            { label: 'Delete', key: K.del, act: () => removeSlot(b), danger: true },
          ]);
          return;
        }
        const ci = getCourtIdxAtX(e.clientX);
        if (ci === -1) return;
        const m = snapFloor(e.clientY);
        select(null);
        const clip = state.scheduleClipboard;
        openMenu(e.clientX, e.clientY, `${courts[ci].name} · ${_fmt12(m)}`, [
          { label: 'New booking here', act: () => openPanel('new', { courtIds: [courts[ci].id], start: m, dur: 60 }) },
          { label: clip ? `Paste "${clip.title}"` : 'Paste', key: `${K.mod}V`, act: () => pasteAt({ ci, m }), disabled: !clip },
        ]);
      }, { signal });

      // ── Block drag: move, resize, alt-duplicate ───────────────────────────
      function paintLive(el, cur, b, bad) {
        const g = blockGeometry(cur.s, cur.d, cur.lo, cur.hi);
        el.style.left = g.left;
        el.style.width = g.width;
        el.style.top = g.top;
        el.style.height = g.height;
        el.classList.add('sch-block--live');
        el.classList.toggle('sch-block--bad', bad);
        const short = parseFloat(g.height) < 34;
        el.classList.toggle('sch-block--short', short);
        const timeEl = el.querySelector('.sch-block-time');
        if (timeEl) timeEl.textContent = blockTimeText(cur.s, cur.d, cur.lo, cur.hi, short);
      }

      courtsRow.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.sch-tb')) return;
        const blockEl = e.target.closest('.sch-block');

        if (blockEl) {
          const b = slotById.get(blockEl.dataset.slot);
          if (!b) return;
          e.preventDefault();
          const isLeague = b.source === 'league';
          if (!b.isCustom && !isLeague) {
            // Tournament matches: click opens the card, nothing drags.
            bdrag = { b, clickOnly: true, moved: false };
            return;
          }
          const handle = e.target.closest('.sch-h');
          const mode = b.isCustom && handle ? handle.dataset.h : 'move';
          const rowRect = courtsRow.getBoundingClientRect();
          const colW = rowRect.width / N;
          const ci0 = clamp(Math.floor((e.clientX - rowRect.left) / colW), 0, N - 1);
          bdrag = {
            b, mode, isLeague,
            y0: e.clientY, ci0,
            alt: e.altKey && b.isCustom,
            moved: false,
            orig: { s: b.startMin, d: b.durationMinutes, lo: b.lo, hi: b.hi },
            cur:  { s: b.startMin, d: b.durationMinutes, lo: b.lo, hi: b.hi },
            el: blockEl,
            liveEl: null,
          };
          closeMenu();
          state.scheduleCalOpen = false;
          hoverLine.style.display = 'none';
          hover = null;
          return;
        }

        // Empty space: create-drag. Any create gesture clears the selection.
        select(null);
        closeMenu();
        const si = getCourtIdxAtX(e.clientX);
        if (si === -1) return;
        e.preventDefault();
        const t = snapFloor(e.clientY);
        drag = { startX: e.clientX, startY: e.clientY, startIdx: si, startTime: t, moved: false,
          minIdx: si, maxIdx: si, minTime: t, maxTime: t + 60 };
      }, { signal });

      document.addEventListener('mousemove', (e) => {
        if (bdrag) {
          if (bdrag.clickOnly) return;
          const rowRect = courtsRow.getBoundingClientRect();
          const dy = e.clientY - bdrag.y0;
          const dm = Math.round(dy / pxm / 15) * 15;
          const colW = rowRect.width / N;
          const ci = clamp(Math.floor((e.clientX - rowRect.left) / colW), 0, N - 1);
          const dc = ci - bdrag.ci0;
          if (!bdrag.moved && Math.abs(dy) < 4 && dc === 0) return;
          const o = bdrag.orig;
          let s = o.s, d = o.d, lo = o.lo, hi = o.hi;
          if (bdrag.mode === 'move') {
            s = clamp(o.s + dm, DAY_START, DAY_END - o.d);
            const sh = clamp(dc, -o.lo, N - 1 - o.hi);
            lo = o.lo + sh; hi = o.hi + sh;
          } else if (bdrag.mode === 'top') {
            s = clamp(o.s + dm, DAY_START, o.s + o.d - 15);
            d = o.s + o.d - s;
          } else if (bdrag.mode === 'bottom') {
            d = clamp(o.d + dm, 15, DAY_END - o.s);
          } else if (bdrag.mode === 'left') {
            lo = clamp(o.lo + dc, 0, o.hi);
          } else if (bdrag.mode === 'right') {
            hi = clamp(o.hi + dc, o.lo, N - 1);
          }
          if (!bdrag.moved) {
            bdrag.moved = true;
            tbEl.hidden = true;
            if (bdrag.alt && bdrag.mode === 'move') {
              // Alt-drag duplicates: the original stays put; the copy moves.
              bdrag.liveEl = bdrag.el.cloneNode(true);
              bdrag.liveEl.classList.add('sch-block--ghostcopy');
              overlay.appendChild(bdrag.liveEl);
            } else {
              bdrag.liveEl = bdrag.el;
            }
          }
          const c = bdrag.cur;
          if (c.s !== s || c.d !== d || c.lo !== lo || c.hi !== hi || !bdrag.painted) {
            bdrag.cur = { s, d, lo, hi };
            bdrag.painted = true;
            const cand = { lo, hi, s, d };
            const dup = bdrag.alt && bdrag.mode === 'move';
            const bad = clash(cand, dup ? null : memberSet(bdrag.b));
            paintLive(bdrag.liveEl, bdrag.cur, bdrag.b, bad);
          }
          return;
        }

        if (!drag) return;
        const dx = e.clientX - drag.startX, dyv = e.clientY - drag.startY;
        if (!drag.moved && Math.sqrt(dx * dx + dyv * dyv) > 6) drag.moved = true;
        if (!drag.moved) return;
        const ci = (() => {
          const i = getCourtIdxAtX(e.clientX);
          if (i !== -1) return i;
          return e.clientX < courtsRow.getBoundingClientRect().left ? 0 : N - 1;
        })();
        drag.minIdx = Math.min(drag.startIdx, ci);
        drag.maxIdx = Math.max(drag.startIdx, ci);
        const t = snapFloor(e.clientY);
        drag.minTime = Math.min(drag.startTime, t);
        drag.maxTime = Math.max(drag.startTime, t);
        if (drag.maxTime === drag.minTime) drag.maxTime = drag.minTime + 15;
        const idxs = [];
        for (let i = drag.minIdx; i <= drag.maxIdx; i++) idxs.push(i);
        drawGhosts(idxs, drag.minTime, drag.maxTime);
      }, { signal });

      document.addEventListener('mouseup', async (e) => {
        if (bdrag) {
          const bd = bdrag;
          bdrag = null;

          if (bd.clickOnly || !bd.moved) {
            if (!bd.b.isCustom) { window.openMatchCard(bd.b.id); return; }
            select(bd.b.id);
            if (CLICK_OPENS === 'edit') openEditFor(bd.b);
            return;
          }

          const restore = () => {
            if (bd.alt && bd.mode === 'move') bd.liveEl?.remove();
            else {
              bd.el.classList.remove('sch-block--live', 'sch-block--bad');
              const g = blockGeometry(bd.orig.s, bd.orig.d, bd.orig.lo, bd.orig.hi);
              bd.el.style.left = g.left; bd.el.style.width = g.width;
              bd.el.style.top = g.top; bd.el.style.height = g.height;
              const short = parseFloat(g.height) < 34;
              bd.el.classList.toggle('sch-block--short', short);
              const timeEl = bd.el.querySelector('.sch-block-time');
              if (timeEl) timeEl.textContent = blockTimeText(bd.orig.s, bd.orig.d, bd.orig.lo, bd.orig.hi, short);
            }
          };

          const c = bd.cur;
          const dup = bd.b.isCustom && bd.mode === 'move' && (e.altKey || bd.alt);
          if (clash({ lo: c.lo, hi: c.hi, s: c.s, d: c.d }, dup ? null : memberSet(bd.b))) {
            // Refuse: snap back, keep it selected, say why.
            restore();
            _schToast('That spot overlaps an existing booking');
            if (bd.b.isCustom) select(bd.b.id);
            return;
          }

          const runCourts = courts.slice(c.lo, c.hi + 1).map((x) => x.id);
          try {
            if (bd.isLeague) {
              await window.api.updateMatchTiming({
                matchId: Number(String(bd.b.id).replace('m_', '')),
                matchTime: minutesToTimeStr(c.s),
                courtId: runCourts[0],
              });
              renderSchedule();
            } else if (dup) {
              const made = await window.api.addBooking({
                courtId: runCourts[0], courtIds: runCourts.length > 1 ? runCourts : null,
                date: state.scheduleDate, startTime: minutesToTimeStr(c.s), durationMinutes: c.d,
                bookingTypeId: bd.b.bookingTypeId || null, name: bd.b.name || null, info: bd.b.info || null,
                playerIds: (bd.b.players || []).map((p) => p.id),
              });
              if (made?.id) _pushUndo({ type: 'delete-ids', ids: [made.id] });
              bd.liveEl?.remove();
              state.scheduleSel = made?.id ?? null;
              _schToast(`Duplicated to ${placeLabel(c)}`);
              renderSchedule();
            } else {
              _pushUndo({ type: 'update', id: bd.b.id, oldData: bookingFields(bd.b) });
              await window.api.updateBooking(bd.b.id, {
                courtId: runCourts[0], courtIds: runCourts.length > 1 ? runCourts : null,
                date: bd.b.date || state.scheduleDate,
                startTime: minutesToTimeStr(c.s), durationMinutes: c.d,
                bookingTypeId: bd.b.bookingTypeId || null, name: bd.b.name || null, info: bd.b.info || null,
                playerIds: (bd.b.players || []).map((p) => p.id),
              });
              state.scheduleSel = bd.b.id;
              renderSchedule();
            }
          } catch (err) {
            restore();
            _schToast(err.message);
            if (bd.b.isCustom) select(bd.b.id);
          }
          return;
        }

        if (!drag) return;
        const d = drag;
        drag = null;
        clearGhosts();
        if (!d.moved) {
          // A plain click books the hour beginning at the snap line.
          const start = Math.min(d.startTime, DAY_END - 15);
          openPanel('new', {
            courtIds: [courts[d.startIdx].id],
            start,
            dur: Math.min(60, DAY_END - start),
          });
        } else {
          openPanel('new', {
            courtIds: courts.slice(d.minIdx, d.maxIdx + 1).map((cc) => cc.id),
            start: d.minTime,
            dur: Math.max(15, d.maxTime - d.minTime),
          });
        }
      }, { signal });

      // ── Toolbar ───────────────────────────────────────────────────────────
      tbEl?.addEventListener('mousedown', (e) => e.stopPropagation(), { signal });
      const selSlot = () => (state.scheduleSel != null ? slotById.get(String(state.scheduleSel)) : null);
      document.getElementById('schTbEdit')?.addEventListener('click', () => { const b = selSlot(); if (b) openEditFor(b); }, { signal });
      document.getElementById('schTbDup')?.addEventListener('click', () => { const b = selSlot(); if (b) duplicateSlot(b); }, { signal });
      document.getElementById('schTbCopy')?.addEventListener('click', () => { const b = selSlot(); if (b) copySlot(b); }, { signal });
      document.getElementById('schTbDel')?.addEventListener('click', () => { const b = selSlot(); if (b) removeSlot(b); }, { signal });

      // Double-click opens the panel, as Enter does.
      overlay.addEventListener('dblclick', (e) => {
        const blockEl = e.target.closest('.sch-block');
        const b = blockEl && slotById.get(blockEl.dataset.slot);
        if (b?.isCustom) openEditFor(b);
      }, { signal });

      // ── Keyboard ──────────────────────────────────────────────────────────
      document.addEventListener('keydown', (e) => {
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        const meta = e.metaKey || e.ctrlKey;
        if (e.key === 'Escape') {
          if (menuEl) { closeMenu(); return; }
          if (isBookingPanelOpen()) return; // the panel closes itself
          if (state.scheduleSel != null) select(null);
          return;
        }
        if (isBookingPanelOpen()) return;
        if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); _executeUndo(); return; }
        const b = selSlot();
        if ((e.key === 'Delete' || e.key === 'Backspace') && b) { e.preventDefault(); removeSlot(b); return; }
        if (e.key === 'Enter' && b) { openEditFor(b); return; }
        if (meta && e.key.toLowerCase() === 'c' && b) { e.preventDefault(); copySlot(b); return; }
        if (meta && e.key.toLowerCase() === 'd' && b) { e.preventDefault(); duplicateSlot(b); return; }
        if (meta && e.key.toLowerCase() === 'v' && state.scheduleClipboard) {
          e.preventDefault();
          pasteAt(hover ? { ci: hover.ci, m: hover.m } : null);
        }
      }, { signal });

      // Open on the first free half hour from now, scanning courts in order, so
      // the panel never opens already in conflict.
      document.getElementById('btnNewBooking')?.addEventListener('click', () => {
        const from = isToday ? Math.ceil(Math.max(nowMins, DAY_START) / SLOT_MIN) * SLOT_MIN : DAY_START;
        for (let m = from; m + SLOT_MIN <= DAY_END; m += SLOT_MIN) {
          const free = courts.find((cc) => !enriched.some((sl) =>
            sl.lo <= courtIdxById.get(cc.id) && sl.hi >= courtIdxById.get(cc.id)
            && _overlaps(m, SLOT_MIN, sl.startMin, sl.durationMinutes)));
          if (free) { openPanel('new', { courtIds: [free.id], start: m, dur: 60 }); return; }
        }
        openPanel('new', { courtIds: [courts[0].id], start: Math.min(from, DAY_END - 60), dur: 60 });
      }, { signal });
    }
  }

  const scrollEl = content.querySelector('.sch-grid-scroll');
  if (scrollEl) {
    if (savedScrollTop) scrollEl.scrollTop = savedScrollTop;
    else if (showNow) scrollEl.scrollTop = Math.max(0, nowTop - SLOT_H * 1.5);
  }
}
