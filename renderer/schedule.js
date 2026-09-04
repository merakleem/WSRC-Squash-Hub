import { state, isAdmin, _setConflictCursor } from './state.js';
import { esc, toast } from './utils.js';
import { openBookingPanel, closeBookingPanel, isBookingPanelOpen } from './schedulePanel.js';

// AbortController for document-level drag/click listeners — aborted and recreated on each renderSchedule() call
let _scheduleListenerAC = null;

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

function _scheduleDayLabel(isoDate) {
  const parts = isoDate.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
function _durLabel(d) {
  const h = Math.floor(d / 60), m = d % 60;
  return (h ? `${h}h` : '') + (h && m ? ' ' : '') + (m ? `${m}m` : '');
}

// ===== UNDO =====
function _pushUndo(op) {
  if (!state.scheduleUndoStack) state.scheduleUndoStack = [];
  state.scheduleUndoStack.push(op);
  if (state.scheduleUndoStack.length > 50) state.scheduleUndoStack.shift();
}

async function _executeUndo() {
  if (!state.scheduleUndoStack?.length) { toast('Nothing to undo', 'error'); return; }
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
    } else if (op.type === 'update-group') {
      for (const item of op.items) await window.api.updateBooking(item.id, item.oldData);
    }
    toast('Undone');
    renderSchedule();
  } catch (err) { toast('Undo failed: ' + err.message, 'error'); }
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

  const actionsEl = document.getElementById('topbarActions');
  // The helper line and the button live in the app's own top bar, as on every
  // other page, rather than the page growing a second bar of its own.
  actionsEl.innerHTML = isAdmin()
    ? `<span class="sch-topbar-help">Drag on the grid to book · snaps to 15 minutes</span>
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

  // Validate stored booking type ID still exists
  if (state.scheduleBookingTypeId !== null && !bookingTypes.find((bt) => bt.id === state.scheduleBookingTypeId)) {
    state.scheduleBookingTypeId = null;
  }

  const { courts, slots } = scheduleData;

  // Column widths matched between sticky header grid and body flex
  const isMobile = window.innerWidth < 640;
  const TIME_COL_W = isMobile ? 44 : 64;
  const COURT_COL_W = isMobile ? 140 : 200;

  // Date display info
  const [dpY, dpM, dpD] = state.scheduleDate.split('-').map(Number);
  const dateObj = new Date(dpY, dpM - 1, dpD);
  const weekdayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  const dateLong = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const isToday = state.scheduleDate === today;

  // 7-day strip centred on selected date
  // Seven days centred on the day being viewed - admins navigate to arbitrary
  // dates, so a strip anchored to today would often not contain it. Drawn with
  // the player page's cells so the two pages cannot drift apart.
  const monthDayLabel = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const dayStripHTML = Array.from({ length: 7 }, (_, i) => {
    const d = _addDaysLocal(_addDaysLocal(state.scheduleDate, -3), i);
    const dObj = new Date(d + 'T12:00:00');
    const sel = d === state.scheduleDate;
    const isDayToday = d === today;
    return `<button class="cb-day${sel ? ' cb-day--sel' : ''}" data-date="${d}">
      <span class="cb-day-wd">${WD1[dObj.getDay()]}</span>
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
  // Fixed density, matching the player grid. Zoom is gone: it existed to make a
  // 44px row readable, and 38px with hour bands reads without it.
  const SLOT_H      = 38;
  const SLOT_MIN    = 30;
  const totalSlots  = (DAY_END - DAY_START) / SLOT_MIN;
  const BASE_GRID_H = totalSlots * SLOT_H;

  // "6 AM", matching the player grid's gutter.
  function fmtHour(h) {
    return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
  }

  const timeAxisHTML = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) {
    const h = Math.floor(m / 60);
    const top = ((m - DAY_START) / SLOT_MIN) * SLOT_H;
    const transform = top === 0 ? ';transform:none' : ';transform:translateY(-50%)';
    timeAxisHTML.push(`<div class="sch-time-label" style="top:${top}px${transform}">${fmtHour(h)}</div>`);
  }

  // "Now" indicator — only on today, within operating hours
  const _nowDate = new Date();
  const nowMins = _nowDate.getHours() * 60 + _nowDate.getMinutes();
  const showNow = isToday && nowMins >= DAY_START && nowMins < DAY_END;
  const nowTop = ((nowMins - DAY_START) / SLOT_MIN) * SLOT_H;
  if (showNow) {
    timeAxisHTML.push(`<div class="sch-now-label" style="top:${nowTop}px;transform:translateY(-50%)">Now</div>`);
  }

  // Every other hour is filled rather than ruled, so the eye tracks rows
  // without a line every thirty minutes.
  const gridLinesHTML = Array.from({ length: Math.ceil(totalSlots / 4) }, (_, i) =>
    `<div class="sch-band" style="top:${i * SLOT_H * 4}px"></div>`).join('');

  function timeToMinutes(t) {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  const courtIdxById = new Map(courts.map((c, i) => [c.id, i]));

  // Colour to type, for the types actually on this day. An empty day gets no
  // legend rather than an empty rail.
  const legendHTML = (() => {
    const custom = slots.filter((s) => s.source === 'custom');
    if (!custom.length) return '';
    const seen = new Map();
    for (const s of custom) {
      const name = s.bookingTypeId
        ? (bookingTypes.find((b) => b.id === s.bookingTypeId)?.name || 'Booking')
        : 'Standard';
      if (!seen.has(name)) seen.set(name, s.color || '#3550c8');
    }
    const items = [...seen].map(([name, color]) =>
      `<span class="sch-legend-item"><span class="sch-legend-dot" style="background:${esc(color)}"></span>${esc(name)}</span>`).join('');
    return `<div class="sch-legend">
      <span class="sch-legend-label">On this day</span>
      ${items}
    </div>`;
  })();
  
  // Court columns (body only, no header inside)
  const courtColumnsHTML = courts.map((court) => {
    // Multi-court group slots are rendered as overlays on .sch-courts-row after innerHTML; skip here
    const blocksHTML = slots.filter((s) => !s.courtIds && s.courtId === court.id).map((s) => {
      const startMin = timeToMinutes(s.startTime);
      if (startMin === null) return '';
      const top = ((startMin - DAY_START) / SLOT_MIN) * SLOT_H;
      const h = (s.durationMinutes / SLOT_MIN) * SLOT_H;
      if (top < 0 || top >= BASE_GRID_H) return '';
      const safeH = Math.min(h, BASE_GRID_H - top);
      const isLeague = s.source === 'league';
      const isTournament = s.source === 'tournament';
      const editAttr = isAdmin() ? ` data-booking-id="${s.id}"` : '';
      const cursorStyle = isAdmin() ? (isLeague ? ';cursor:grab' : isTournament ? ';cursor:default' : ';cursor:pointer') : '';
      const endMin2 = startMin + s.durationMinutes;
      const timeRange = `${_fmtNoAp(startMin)}–${_fmt12(endMin2)}`;
      const playerText = s.players && s.players.length > 0
        ? s.players.map((p) => { const parts = (p.name || '').trim().split(/\s+/); return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : parts[0]; }).join(' · ')
        : null;
      const subLine = playerText || s.info || null;
      const editBtn = isAdmin() && !isLeague && !isTournament
        ? `<button class="sch-booking-edit-btn" data-edit-booking-id="${s.id}" title="Edit booking">Edit</button>`
        : '';
      // A quarter-hour block has no room for two stacked lines, so it lays its
      // title and time side by side instead; the sub-line needs a tall block.
      const blockH = safeH - 3;
      const short = blockH < 34;
      const repeatGlyph = s.repeatGroupId
        ? `<span class="sch-booking-repeat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg></span>`
        : '';
      return `<div class="sch-booking${short ? ' sch-booking--short' : ''}${isLeague ? ' sch-booking-league' : ''}${isTournament ? ' sch-booking-tournament' : ''}"${editAttr} style="--type-color:${esc(s.color)};top:${top}px;height:${blockH}px${cursorStyle}">
        ${editBtn}
        ${repeatGlyph}
        <div class="sch-booking-time">${timeRange}</div>
        <div class="sch-booking-title">${esc(s.title)}</div>
        ${subLine && blockH > 52 ? `<div class="sch-booking-info">${esc(subLine)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="sch-court-col" style="height:${BASE_GRID_H}px" data-court-id="${court.id}">
      ${gridLinesHTML}${blocksHTML}
    </div>`;
  }).join('');

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
                  <div class="sch-courts-row" style="--court-w:${COURT_COL_W}px">${courtColumnsHTML}</div>
                </div>
              </div>
            </div>
          </div>`
      }
    </div>`;

  // "Now" line spanning all court columns
  if (showNow) {
    const courtsRowEl = content.querySelector('.sch-courts-row');
    if (courtsRowEl) {
      const nowLineEl = document.createElement('div');
      nowLineEl.className = 'sch-now-line';
      nowLineEl.style.top = `${nowTop}px`;
      courtsRowEl.appendChild(nowLineEl);
    }
  }

  // Render multi-court group slots as spanning overlays on .sch-courts-row
  const multiSlots = slots.filter((s) => s.courtIds && s.courtIds.length > 1 && s.source === 'custom');
  if (multiSlots.length) {
    const courtsRowEl = content.querySelector('.sch-courts-row');
    if (courtsRowEl) {
      const rowRect = courtsRowEl.getBoundingClientRect();
      multiSlots.forEach((s) => {
        const sortedIdxs = s.courtIds.map((cId) => courtIdxById.get(cId)).filter((x) => x !== undefined);
        if (!sortedIdxs.length) return;
        const minIdx = Math.min(...sortedIdxs);
        const maxIdx = Math.max(...sortedIdxs);
        const cols = courtsRowEl.querySelectorAll('.sch-court-col');
        const leftCol = cols[minIdx], rightCol = cols[maxIdx];
        if (!leftCol || !rightCol) return;
        const leftRect = leftCol.getBoundingClientRect();
        const rightRect = rightCol.getBoundingClientRect();
        const startMin = timeToMinutes(s.startTime);
        if (startMin === null) return;
        const top = ((startMin - DAY_START) / SLOT_MIN) * SLOT_H;
        const h = (s.durationMinutes / SLOT_MIN) * SLOT_H;
        if (top < 0 || top >= BASE_GRID_H) return;
        const safeH = Math.min(h, BASE_GRID_H - top);
        const endMin2 = startMin + s.durationMinutes;
        const timeRange = `${_fmtNoAp(startMin)}–${_fmt12(endMin2)}`;
        const leftPx = leftRect.left - rowRect.left + 6;
        const widthPx = rightRect.right - leftRect.left - 12;
        const el = document.createElement('div');
        const blockH = safeH - 3;
        el.className = `sch-booking${blockH < 34 ? ' sch-booking--short' : ''}`;
        el.style.cssText = `--type-color:${s.color};position:absolute;left:${leftPx}px;width:${widthPx}px;top:${top}px;height:${blockH}px;z-index:2${isAdmin() ? ';cursor:pointer' : ''}`;
        if (isAdmin()) el.dataset.bookingId = String(s.id);
        const _playerText = s.players && s.players.length > 0
          ? s.players.map((p) => { const pts = (p.name || '').trim().split(/\s+/); return pts.length > 1 ? `${pts[0][0]}. ${pts[pts.length - 1]}` : pts[0]; }).join(' · ')
          : null;
        el.innerHTML = `<button class="sch-booking-edit-btn" data-edit-booking-id="${s.id}" title="Edit booking">Edit</button>
          ${s.repeatGroupId ? `<span class="sch-booking-repeat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg></span>` : ''}
          <div class="sch-booking-time">${timeRange}</div>
          <div class="sch-booking-title">${esc(s.title)}</div>
          ${(_playerText || s.info) && blockH > 52 ? `<div class="sch-booking-info">${esc(_playerText || s.info)}</div>` : ''}`;
        courtsRowEl.appendChild(el);
      });
    }
  }

  // Date controls. Changing the day closes the calendar, as on the player page.
  const goToDate = (d) => { state.scheduleDate = d; state.scheduleCalOpen = false; renderSchedule(); };
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





  // Admin toolbar + all grid interaction
  if (isAdmin()) {
    const courtsRow = content.querySelector('.sch-courts-row');
    if (courtsRow) {
      courtsRow.classList.add('sch-courts-row--admin');

      function minutesToTimeStr(m) {
        return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      }
      function getCourtIdxAtX(clientX) {
        const cols = [...courtsRow.querySelectorAll('.sch-court-col')];
        return cols.findIndex((col) => { const r = col.getBoundingClientRect(); return clientX >= r.left && clientX < r.right; });
      }
      function getTimeAtY(clientY) {
        const effectiveSlotH = SLOT_H;
        const y = Math.max(0, Math.min(clientY - courtsRow.getBoundingClientRect().top, BASE_GRID_H - 1));
        return Math.round((DAY_START + (y / effectiveSlotH) * SLOT_MIN) / 15) * 15;
      }
      function getColRect(idx) {
        return [...courtsRow.querySelectorAll('.sch-court-col')][idx]?.getBoundingClientRect();
      }
      function positionOverlay(el, minTime, maxTime, minIdx, maxIdx) {
        const rowRect = courtsRow.getBoundingClientRect();
        const s = getColRect(minIdx), e2 = getColRect(maxIdx);
        if (!s || !e2) return;
        const effectiveSlotH = SLOT_H;
        const top = ((minTime - DAY_START) / SLOT_MIN) * effectiveSlotH;
        const height = Math.max((maxTime - minTime) / SLOT_MIN, 15 / SLOT_MIN) * effectiveSlotH;
        el.style.cssText = `top:${top}px;height:${height}px;left:${s.left - rowRect.left}px;width:${e2.right - s.left}px`;
      }
      function getBookingEdge(el, clientX, clientY) {
        const r = el.getBoundingClientRect();
        const EDGE = 12;
        if (r.bottom - clientY <= EDGE && clientY <= r.bottom) return 'bottom';
        if (r.right - clientX <= EDGE && clientX <= r.right) return 'right';
        if (clientX - r.left <= EDGE && clientX >= r.left) return 'left';
        return null;
      }

      function makePreview(slot, courtIdx) {
        const el = document.createElement('div');
        el.className = 'sch-move-preview';
        el.dataset.color = slot.color || '#6b7589';
        courtsRow.appendChild(el);
        const numCourts = slot.courtIds?.length || 1;
        positionPreview(el, timeToMinutes(slot.startTime), slot.durationMinutes, courtIdx, numCourts);
        return el;
      }
      function positionPreview(el, startMin, durMin, courtIdx, numCourts) {
        const rowRect = courtsRow.getBoundingClientRect();
        const cr = getColRect(courtIdx);
        if (!cr) return;
        const effectiveSlotH = SLOT_H;
        const top = ((startMin - DAY_START) / SLOT_MIN) * effectiveSlotH;
        const height = (durMin / SLOT_MIN) * effectiveSlotH;
        let left, width;
        if (numCourts > 1) {
          const endCr = getColRect(Math.min(courtIdx + numCourts - 1, courts.length - 1));
          left = cr.left - rowRect.left + 6;
          width = endCr ? endCr.right - cr.left - 12 : cr.width - 12;
        } else {
          left = cr.left - rowRect.left + 6;
          width = cr.width - 12;
        }
        el.style.cssText = `background:${el.dataset.color};top:${top}px;height:${height}px;left:${left}px;width:${width}px`;
      }
      function getBookingsInRect(minTime, maxTime, minCourtIdx, maxCourtIdx) {
        return slots.filter((s) => {
          if (s.source !== 'custom') return false;
          const idxs = s.courtIds ? s.courtIds.map((id) => courtIdxById.get(id)) : [courtIdxById.get(s.courtId)];
          if (!idxs.some((ci) => ci !== undefined && ci >= minCourtIdx && ci <= maxCourtIdx)) return false;
          const sm = timeToMinutes(s.startTime);
          return sm < maxTime && sm + s.durationMinutes > minTime;
        }).map((s) => s.id);
      }
      function clampCourtIdx(clientX) {
        const ci = getCourtIdxAtX(clientX);
        if (ci !== -1) return ci;
        return clientX < courtsRow.getBoundingClientRect().left ? 0 : courts.length - 1;
      }

      if (_scheduleListenerAC) _scheduleListenerAC.abort();
      _scheduleListenerAC = new AbortController();
      const { signal } = _scheduleListenerAC;

      let selectedIds = new Set(state.scheduleSelectedIds || []);
      let drag = null;
      let pasteMode = null; // { ghosts, anchorTimeMin, anchorCourtIdx, hasConflict }

      // The snap line is the only hover affordance on the grid. It draws in the
      // hovered column at the quarter hour under the cursor, and its pill names
      // that time, so a click lands exactly where the eye already is.
      const hoverLine = document.createElement('div');
      hoverLine.className = 'sch-hover-line';
      hoverLine.innerHTML = '<span class="sch-hover-pill"></span>';
      hoverLine.style.display = 'none';
      courtsRow.appendChild(hoverLine);
      const hoverPill = hoverLine.firstElementChild;

      // Floor rather than round: the cursor should land in the quarter hour it
      // is pointing at, never the one above it.
      function snapFloor(clientY) {
        const y = Math.max(0, Math.min(clientY - courtsRow.getBoundingClientRect().top, BASE_GRID_H - 1));
        const m = Math.floor((DAY_START + (y / SLOT_H) * SLOT_MIN) / 15) * 15;
        return Math.max(DAY_START, Math.min(DAY_END - 15, m));
      }

      // The ghost of the booking about to be made: one rounded rect per court,
      // geometrically identical to a real block so a drag reads as "this is
      // what you will get". The same ghosts show the panel's pending range.
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
        const top = ((minTime - DAY_START) / SLOT_MIN) * SLOT_H;
        const height = Math.max(((maxTime - minTime) / SLOT_MIN) * SLOT_H - 3, 9);
        // The label is written once, in the leftmost column of the sweep.
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

      // Every booking surface is this one panel; the grid only decides which
      // mode it opens in and what it opens pre-filled with.
      let _playersCache = null;
      async function openPanel(mode, extra) {
        if (!_playersCache) {
          try { _playersCache = await window.api.getPlayers(); }
          catch (err) { toast(err.message, 'error'); return; }
        }
        clearSelection();
        openBookingPanel({
          mode,
          host: content.querySelector('.sch-page'),
          courts, slots, types: bookingTypes, players: _playersCache,
          ...extra,
          onRange: (courtIds, start, dur) => {
            const idxs = courtIds.map((id) => courtIdxById.get(id))
              .filter((x) => x !== undefined).sort((a, b) => a - b);
            if (!idxs.length) { clearGhosts(); return; }
            drawGhosts(idxs, start, start + dur);
          },
          onDone: () => { state.scheduleSelectedIds = []; renderSchedule(); },
          onClose: () => { clearGhosts(); hoverLine.style.display = 'none'; },
          pushUndo: _pushUndo,
        });
      }

      function enterPasteMode() {
        if (!state.scheduleClipboard?.items?.length) return;
        clearSelection();
        pasteMode = { ghosts: [], anchorTimeMin: null, anchorCourtIdx: null, hasConflict: false };
        state.scheduleClipboard.items.forEach((item) => {
          const ghost = document.createElement('div');
          ghost.className = 'sch-paste-ghost';
          ghost.dataset.color = item.slot.color || '#6b7589';
          ghost.style.display = 'none';
          courtsRow.appendChild(ghost);
          pasteMode.ghosts.push(ghost);
        });
      }

      function exitPasteMode() {
        if (!pasteMode) return;
        pasteMode.ghosts.forEach((g) => g.remove());
        pasteMode = null;
        _setConflictCursor(false);
      }

      function updatePasteGhosts(clientX, clientY) {
        if (!pasteMode || !state.scheduleClipboard) return;
        const courtIdx = getCourtIdxAtX(clientX);
        if (courtIdx === -1) {
          pasteMode.ghosts.forEach((g) => { g.style.display = 'none'; });
          pasteMode.anchorTimeMin = null;
          _setConflictCursor(false);
          return;
        }
        const anchorTimeMin = getTimeAtY(clientY);
        pasteMode.anchorTimeMin = anchorTimeMin;
        pasteMode.anchorCourtIdx = courtIdx;
        pasteMode.hasConflict = state.scheduleClipboard.items.some((item) => {
          const newTime = anchorTimeMin + item.relTimeMin;
          const newCI = courtIdx + item.relCourtIdx;
          const numCourts = item.slot.courtIds?.length || 1;
          if (newTime < DAY_START || newTime + item.slot.durationMinutes > DAY_END) return true;
          if (newCI < 0 || newCI + numCourts - 1 >= courts.length) return true;
          const targetCourtIds = Array.from({ length: numCourts }, (_, k) => courts[newCI + k]?.id).filter(Boolean);
          return targetCourtIds.some((tcId) =>
            slots.some((s) => {
              const sCourts = s.courtIds || [s.courtId];
              return sCourts.includes(tcId) && _overlaps(newTime, item.slot.durationMinutes, _tToMin(s.startTime), s.durationMinutes);
            })
          );
        });
        const rowRect = courtsRow.getBoundingClientRect();
        state.scheduleClipboard.items.forEach((item, i) => {
          const ghost = pasteMode.ghosts[i];
          const newTime = anchorTimeMin + item.relTimeMin;
          const newCI = courtIdx + item.relCourtIdx;
          const numCourts = item.slot.courtIds?.length || 1;
          const cr = getColRect(newCI);
          if (!cr || newCI < 0 || newCI + numCourts - 1 >= courts.length) { ghost.style.display = 'none'; return; }
          const effectiveSlotH = SLOT_H;
          const top = ((newTime - DAY_START) / SLOT_MIN) * effectiveSlotH;
          const height = (item.slot.durationMinutes / SLOT_MIN) * effectiveSlotH;
          const endCr = numCourts > 1 ? getColRect(newCI + numCourts - 1) : null;
          const left = cr.left - rowRect.left + 6;
          const width = endCr ? endCr.right - cr.left - 12 : cr.width - 12;
          ghost.style.cssText = `background:${pasteMode.hasConflict ? 'rgba(220,38,38,0.55)' : ghost.dataset.color};top:${top}px;height:${height}px;left:${left}px;width:${width}px;display:block`;
        });
        _setConflictCursor(pasteMode.hasConflict);
      }

      async function placePasteBookings() {
        if (!pasteMode || !state.scheduleClipboard || pasteMode.anchorTimeMin === null || pasteMode.hasConflict) return;
        const { anchorTimeMin, anchorCourtIdx } = pasteMode;
        const items = state.scheduleClipboard.items;
        exitPasteMode();
        try {
          const newIds = [];
          for (const item of items) {
            const newTime = anchorTimeMin + item.relTimeMin;
            const newCI = anchorCourtIdx + item.relCourtIdx;
            const numCourts = item.slot.courtIds?.length || 1;
            const courtId = courts[newCI]?.id;
            if (!courtId) continue;
            const courtIds = numCourts > 1 ? Array.from({ length: numCourts }, (_, k) => courts[newCI + k]?.id).filter(Boolean) : null;
            const result = await window.api.addBooking({
              courtId, courtIds, date: state.scheduleDate,
              startTime: minutesToTimeStr(newTime), durationMinutes: item.slot.durationMinutes,
              bookingTypeId: item.slot.bookingTypeId || null,
              name: item.slot.name || null, info: item.slot.info || null,
              playerIds: (item.slot.players || []).map((p) => p.id),
            });
            if (result?.id) newIds.push(result.id);
          }
          _pushUndo({ type: 'delete-ids', ids: newIds });
          state.scheduleSelectedIds = newIds;
          toast(`${newIds.length} booking${newIds.length > 1 ? 's' : ''} pasted`);
          renderSchedule();
        } catch (err) { toast(err.message, 'error'); }
      }

      function updateHoverLine(e) {
        if (drag || pasteMode || isBookingPanelOpen() || e.target.closest('.sch-booking')) {
          hoverLine.style.display = 'none';
          return;
        }
        const courtIdx = getCourtIdxAtX(e.clientX);
        if (courtIdx === -1) { hoverLine.style.display = 'none'; return; }
        const cr = getColRect(courtIdx);
        if (!cr) { hoverLine.style.display = 'none'; return; }
        const rowRect = courtsRow.getBoundingClientRect();
        const snappedTime = snapFloor(e.clientY);
        hoverLine.style.top = `${((snappedTime - DAY_START) / SLOT_MIN) * SLOT_H}px`;
        hoverLine.style.left = `${cr.left - rowRect.left + 6}px`;
        hoverLine.style.width = `${Math.max(cr.width - 13, 0)}px`;
        hoverPill.textContent = _fmt12(snappedTime);
        hoverLine.style.display = 'block';
      }
      courtsRow.addEventListener('mousemove', (e) => updateHoverLine(e), { signal });
      courtsRow.addEventListener('mouseleave', () => {
        hoverLine.style.display = 'none';
        if (pasteMode) {
          pasteMode.ghosts.forEach((g) => { g.style.display = 'none'; });
          pasteMode.anchorTimeMin = null;
          _setConflictCursor(false);
        }
      }, { signal });

      // Edge-resize cursor on sole-selected booking
      let _hoverBookingEl = null;
      let _hoverEdge = null;
      function _clearHoverEdge() {
        if (_hoverBookingEl) { _hoverBookingEl.style.cursor = ''; _hoverBookingEl = null; }
        _hoverEdge = null;
      }
      courtsRow.addEventListener('mousemove', (e) => {
        if (drag) { _clearHoverEdge(); return; }
        const bEl = e.target.closest('[data-booking-id]');
        if (!bEl) { _clearHoverEdge(); return; }
        if (_hoverBookingEl && _hoverBookingEl !== bEl) _hoverBookingEl.style.cursor = '';
        _hoverBookingEl = bEl;
        const bid = Number(bEl.dataset.bookingId);
        const isSole = selectedIds.size === 1 && selectedIds.has(bid);
        _hoverEdge = isSole ? getBookingEdge(bEl, e.clientX, e.clientY) : null;
        bEl.style.cursor = _hoverEdge === 'bottom' ? 's-resize' : _hoverEdge === 'right' ? 'e-resize' : _hoverEdge === 'left' ? 'w-resize' : '';
      }, { signal });
      courtsRow.addEventListener('mouseleave', () => { _clearHoverEdge(); }, { signal });

      function clearSelection() {
        selectedIds.clear();
        state.scheduleSelectedIds = [];
        content.querySelectorAll('.sch-booking--selected').forEach((el) => el.classList.remove('sch-booking--selected'));
      }
      function setSelection(ids) {
        selectedIds = new Set(ids);
        state.scheduleSelectedIds = [...selectedIds];
        content.querySelectorAll('[data-booking-id]').forEach((el) =>
          el.classList.toggle('sch-booking--selected', selectedIds.has(Number(el.dataset.bookingId))));
      }
      // Open on the first free half hour from now, scanning courts in order, so
      // the panel never opens already in conflict.
      document.getElementById('btnNewBooking')?.addEventListener('click', () => {
        const from = isToday ? Math.ceil(Math.max(nowMins, DAY_START) / SLOT_MIN) * SLOT_MIN : DAY_START;
        for (let m = from; m + SLOT_MIN <= DAY_END; m += SLOT_MIN) {
          const free = courts.find((c) => !slots.some((sl) => {
            const ids = sl.courtIds?.length ? sl.courtIds : [sl.courtId];
            return ids.includes(c.id) && _overlaps(m, SLOT_MIN, _tToMin(sl.startTime), sl.durationMinutes);
          }));
          if (free) { openPanel('new', { courtIds: [free.id], start: m, dur: 60 }); return; }
        }
        openPanel('new', { courtIds: [courts[0].id], start: Math.min(from, DAY_END - 60), dur: 60 });
      }, { signal });

      // Restore visual selection from previous render
      if (selectedIds.size) {
        content.querySelectorAll('[data-booking-id]').forEach((el) =>
          el.classList.toggle('sch-booking--selected', selectedIds.has(Number(el.dataset.bookingId))));
      }

      // A league or tournament block opens its match card. Bound here rather than
      // through the app-wide delegate because this grid drags: a drag that ends
      // over a block still fires a click, and `moved` is the only thing that
      // tells the two apart.
      courtsRow.addEventListener('click', (e) => {
        if (e.target.closest('.sch-booking-edit-btn')) return;
        const block = e.target.closest('[data-booking-id]');
        const raw = block?.dataset.bookingId;
        if (!raw || !/^[mt]_/.test(String(raw))) return;
        if (window.__schDragMoved) return;
        window.openMatchCard(raw);
      }, { signal });
      
      // Edit icon click → open edit modal
      courtsRow.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.sch-booking-edit-btn');
        if (!editBtn) return;
        e.stopPropagation();
        const id = Number(editBtn.dataset.editBookingId);
        const slot = slots.find((s) => s.id === id);
        if (slot) openPanel('edit', { slot });
      }, { signal });

      // Right-click context menu on selected bookings
      let contextMenu = null;
      function closeContextMenu() {
        if (contextMenu) { contextMenu.remove(); contextMenu = null; }
      }
      courtsRow.addEventListener('contextmenu', (e) => {
        if (pasteMode) { e.preventDefault(); exitPasteMode(); return; }
        if (!selectedIds.size) return;
        if (!e.target.closest('.sch-booking--selected')) return;
        e.preventDefault();
        closeContextMenu();
        const n = selectedIds.size;
        const selSlots = slots.filter((s) => s.source === 'custom' && selectedIds.has(s.id));
        const menu = document.createElement('div');
        menu.className = 'sch-context-menu';
        menu.style.cssText = `left:${e.clientX}px;top:${e.clientY}px`;
        menu.innerHTML = `${selSlots.length ? `<button class="sch-context-item sch-context-item--neutral" data-action="copy">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copy ${selSlots.length} Booking${selSlots.length > 1 ? 's' : ''}
        </button>` : ''}<button class="sch-context-item" data-action="delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          Delete ${n} Booking${n > 1 ? 's' : ''}
        </button>`;
        document.body.appendChild(menu);
        contextMenu = menu;
        menu.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
          closeContextMenu();
          const minTime = Math.min(...selSlots.map((s) => timeToMinutes(s.startTime)));
          const minCI = Math.min(...selSlots.map((s) => s.courtIds ? Math.min(...s.courtIds.map((id) => courtIdxById.get(id) ?? 0)) : (courtIdxById.get(s.courtId) ?? 0)));
          state.scheduleClipboard = {
            items: selSlots.map((s) => {
              const sCI = s.courtIds ? Math.min(...s.courtIds.map((id) => courtIdxById.get(id) ?? 0)) : (courtIdxById.get(s.courtId) ?? 0);
              return { slot: s, relTimeMin: timeToMinutes(s.startTime) - minTime, relCourtIdx: sCI - minCI };
            }),
          };
          toast(`${selSlots.length} booking${selSlots.length > 1 ? 's' : ''} copied — Ctrl+V to paste`);
          enterPasteMode();
        });
        menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
          closeContextMenu();
          const ids = [...selectedIds];
          const deletedBookings = ids.map((id) => slots.find((s) => s.id === id)).filter(Boolean);
          try {
            for (const id of ids) await window.api.deleteBooking(id);
            _pushUndo({ type: 'recreate', bookings: deletedBookings });
            state.scheduleSelectedIds = [];
            clearSelection();
            toast(`${ids.length} booking${ids.length > 1 ? 's' : ''} deleted`);
            renderSchedule();
          } catch (err) { toast(err.message, 'error'); }
        });
      }, { signal });
      document.addEventListener('click', (e) => {
        if (contextMenu && !contextMenu.contains(e.target)) closeContextMenu();
      }, { signal });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeContextMenu(); if (pasteMode) exitPasteMode(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); _executeUndo(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          const selSlots = slots.filter((s) => s.source === 'custom' && selectedIds.has(s.id));
          if (!selSlots.length) return;
          const minTime = Math.min(...selSlots.map((s) => timeToMinutes(s.startTime)));
          const minCI = Math.min(...selSlots.map((s) => s.courtIds ? Math.min(...s.courtIds.map((id) => courtIdxById.get(id) ?? 0)) : (courtIdxById.get(s.courtId) ?? 0)));
          state.scheduleClipboard = {
            items: selSlots.map((s) => {
              const sCI = s.courtIds ? Math.min(...s.courtIds.map((id) => courtIdxById.get(id) ?? 0)) : (courtIdxById.get(s.courtId) ?? 0);
              return { slot: s, relTimeMin: timeToMinutes(s.startTime) - minTime, relCourtIdx: sCI - minCI };
            }),
          };
          toast(`${selSlots.length} booking${selSlots.length > 1 ? 's' : ''} copied`);
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
          if (state.scheduleClipboard?.items?.length && !pasteMode) enterPasteMode();
        }
      }, { signal });

      // Mousedown
      courtsRow.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.sch-booking-edit-btn')) return;
        e.preventDefault();
        if (pasteMode) { placePasteBookings(); return; }
        const bookingEl = e.target.closest('[data-booking-id]');
        const anyBooking = e.target.closest('.sch-booking');

        if (!bookingEl && !anyBooking) {
          // Empty space — create booking
          clearSelection();
          const si = getCourtIdxAtX(e.clientX);
          if (si === -1) return;
          const t = snapFloor(e.clientY);
          drag = { mode: 'add', startX: e.clientX, startY: e.clientY, startIdx: si, startTime: t, moved: false,
            minIdx: si, maxIdx: si, minTime: t, maxTime: t + 60 };

        } else if (bookingEl) {
          // A fresh gesture: until the pointer moves, this is a click.
          window.__schDragMoved = false;
          const rawBid = bookingEl.dataset.bookingId;
          const isLeagueSlot = rawBid.startsWith('m_');
          const isTournamentSlot = rawBid.startsWith('t_');
          if (isTournamentSlot) return;
          const bid = isLeagueSlot ? rawBid : Number(rawBid);
          const slot = slots.find((s) => s.id === bid);
          if (!slot) return;
          const courtIdx = courtIdxById.get(slot.courtId);

          if (isLeagueSlot) {
            // League match: drag moves time/court only
            const offsetTimeMin = Math.max(0, Math.min(getTimeAtY(e.clientY) - timeToMinutes(slot.startTime), slot.durationMinutes - 15));
            bookingEl.classList.add('sch-booking--moving');
            const preview = makePreview(slot, courtIdx);
            drag = { mode: 'move-single', isLeague: true, slot, courtIdx, numCourts: 1, offsetTimeMin, el: bookingEl, preview,
              startX: e.clientX, startY: e.clientY, moved: false,
              targetTime: timeToMinutes(slot.startTime), targetCourtIdx: courtIdx };
          } else {
            if (slot.source !== 'custom') return;
            const numCourts = slot.courtIds?.length || 1;
            const isSoleSelection = selectedIds.size === 1 && selectedIds.has(bid);
            const edge = isSoleSelection ? (_hoverBookingEl === bookingEl ? _hoverEdge : getBookingEdge(bookingEl, e.clientX, e.clientY)) : null;

            if (edge === 'bottom') {
              bookingEl.classList.add('sch-booking--moving');
              const preview = makePreview(slot, courtIdx);
              drag = { mode: 'resize-duration', slot, el: bookingEl, preview,
                courtIdx, numCourts, startX: e.clientX, startY: e.clientY, moved: false,
                targetDuration: slot.durationMinutes };
            } else if (edge === 'right' || edge === 'left') {
              bookingEl.classList.add('sch-booking--moving');
              const preview = makePreview(slot, courtIdx);
              drag = { mode: 'resize-courts', slot, el: bookingEl, preview, edge,
                origCourtIdx: courtIdx, origNumCourts: numCourts, startX: e.clientX, startY: e.clientY, moved: false,
                targetCourtIdx: courtIdx, targetNumCourts: numCourts };
            } else if (selectedIds.has(bid)) {
              // Already selected: drag=move, no-drag=deselect
              if (selectedIds.size > 1) {
                const dragSlots = slots.filter((s) => s.source === 'custom' && selectedIds.has(s.id)).map((s) => ({
                  ...s, _el: content.querySelector(`[data-booking-id="${s.id}"]`),
                  _origCourtIdx: courtIdxById.get(s.courtId), _origStartMin: timeToMinutes(s.startTime),
                  _numCourts: s.courtIds?.length || 1,
                }));
                dragSlots.forEach((s) => s._el?.classList.add('sch-booking--moving'));
                const previews = dragSlots.map((s) => makePreview(s, s._origCourtIdx));
                drag = { mode: 'move-group', dragSlots, previews, anchorClickTimeMin: getTimeAtY(e.clientY),
                  anchorBookingStartMin: timeToMinutes(slot.startTime),
                  anchorCourtIdx: courtIdx, startX: e.clientX, startY: e.clientY,
                  moved: false, deltaTime: 0, deltaCourtIdx: 0 };
              } else {
                const offsetTimeMin = Math.max(0, Math.min(getTimeAtY(e.clientY) - timeToMinutes(slot.startTime), slot.durationMinutes - 15));
                bookingEl.classList.add('sch-booking--moving');
                const preview = makePreview(slot, courtIdx);
                drag = { mode: 'move-single', slot, courtIdx, numCourts, offsetTimeMin, el: bookingEl, preview,
                  startX: e.clientX, startY: e.clientY, moved: false,
                  targetTime: timeToMinutes(slot.startTime), targetCourtIdx: courtIdx };
              }
            } else {
              // Unselected booking: no-drag=select, drag=area-select
              const si = getCourtIdxAtX(e.clientX);
              if (si === -1) return;
              const overlay = document.createElement('div');
              overlay.className = 'sch-drag-overlay';
              courtsRow.appendChild(overlay);
              const t = getTimeAtY(e.clientY);
              drag = { mode: 'move-area', startX: e.clientX, startY: e.clientY, startIdx: si, startTime: t, overlay, moved: false,
                minIdx: si, maxIdx: si, minTime: t, maxTime: t,
                pendingSelectBid: bid, pendingSelectEl: bookingEl };
            }
          }
        }
      });

      // Mousemove
      document.addEventListener('mousemove', (e) => {
        if (pasteMode) { updatePasteGhosts(e.clientX, e.clientY); return; }
        if (!drag) return;
        const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
        if (!drag.moved && Math.sqrt(dx * dx + dy * dy) > 6) { drag.moved = true; window.__schDragMoved = true; }
        if (!drag.moved) return;
        const ci = clampCourtIdx(e.clientX);

        if (drag.mode === 'add' || drag.mode === 'move-area') {
          drag.minIdx = Math.min(drag.startIdx, ci);
          drag.maxIdx = Math.max(drag.startIdx, ci);
          const t = snapFloor(e.clientY);
          drag.minTime = Math.min(drag.startTime, t);
          drag.maxTime = Math.max(drag.startTime, t);
          if (drag.maxTime === drag.minTime) drag.maxTime = drag.minTime + 15;
          if (drag.mode === 'add') {
            const idxs = [];
            for (let i = drag.minIdx; i <= drag.maxIdx; i++) idxs.push(i);
            drawGhosts(idxs, drag.minTime, drag.maxTime);
          } else {
            positionOverlay(drag.overlay, drag.minTime, drag.maxTime, drag.minIdx, drag.maxIdx);
          }

        } else if (drag.mode === 'move-single') {
          const newStart = Math.round((getTimeAtY(e.clientY) - drag.offsetTimeMin) / 15) * 15;
          drag.targetTime = Math.max(DAY_START, Math.min(newStart, DAY_END - drag.slot.durationMinutes));
          drag.targetCourtIdx = Math.max(0, Math.min(ci, courts.length - drag.numCourts));
          positionPreview(drag.preview, drag.targetTime, drag.slot.durationMinutes, drag.targetCourtIdx, drag.numCourts);
          const targetCourtIds = Array.from({ length: drag.numCourts }, (_, k) => courts[drag.targetCourtIdx + k]?.id).filter(Boolean);
          drag.hasConflict = targetCourtIds.some((tcId) =>
            slots.some((s) => {
              const sCourts = s.courtIds || [s.courtId];
              return sCourts.includes(tcId) && s.id !== drag.slot.id && _overlaps(drag.targetTime, drag.slot.durationMinutes, _tToMin(s.startTime), s.durationMinutes);
            })
          );
          drag.preview.style.background = drag.hasConflict ? 'rgba(220,38,38,0.55)' : drag.preview.dataset.color;
          _setConflictCursor(drag.hasConflict);

        } else if (drag.mode === 'move-group') {
          drag.deltaTime = getTimeAtY(e.clientY) - drag.anchorClickTimeMin;
          drag.deltaCourtIdx = ci - drag.anchorCourtIdx;
          const excludeIds = new Set(drag.dragSlots.map((s) => s.id));
          const outOfBounds = drag.dragSlots.some((s) => {
            const rawStart = Math.round((s._origStartMin + drag.deltaTime) / 15) * 15;
            const rawCI = s._origCourtIdx + drag.deltaCourtIdx;
            return rawStart < DAY_START || rawStart > DAY_END - s.durationMinutes
                || rawCI < 0 || rawCI + s._numCourts - 1 >= courts.length;
          });
          drag.hasConflict = outOfBounds || drag.dragSlots.some((s) => {
            const newStart = Math.max(DAY_START, Math.min(Math.round((s._origStartMin + drag.deltaTime) / 15) * 15, DAY_END - s.durationMinutes));
            const newCI = Math.max(0, Math.min(s._origCourtIdx + drag.deltaCourtIdx, courts.length - s._numCourts));
            const targetCourtIds = Array.from({ length: s._numCourts }, (_, k) => courts[newCI + k]?.id).filter(Boolean);
            return targetCourtIds.some((tcId) => slots.some((o) => {
              const oCourts = o.courtIds || [o.courtId];
              return !excludeIds.has(o.id) && oCourts.includes(tcId) && _overlaps(newStart, s.durationMinutes, _tToMin(o.startTime), o.durationMinutes);
            }));
          });
          drag.dragSlots.forEach((s, i) => {
            const newStart = Math.max(DAY_START, Math.min(Math.round((s._origStartMin + drag.deltaTime) / 15) * 15, DAY_END - s.durationMinutes));
            const newCI = Math.max(0, Math.min(s._origCourtIdx + drag.deltaCourtIdx, courts.length - s._numCourts));
            positionPreview(drag.previews[i], newStart, s.durationMinutes, newCI, s._numCourts);
            drag.previews[i].style.background = drag.hasConflict ? 'rgba(220,38,38,0.55)' : drag.previews[i].dataset.color;
          });
          _setConflictCursor(drag.hasConflict);

        } else if (drag.mode === 'resize-duration') {
          const startMin = timeToMinutes(drag.slot.startTime);
          const mouseMin = getTimeAtY(e.clientY);
          drag.targetDuration = Math.max(15, Math.min(Math.round((mouseMin - startMin) / 15) * 15, DAY_END - startMin));
          positionPreview(drag.preview, startMin, drag.targetDuration, drag.courtIdx, drag.numCourts);
          const memberIds = drag.slot.memberIds || [drag.slot.id];
          drag.hasConflict = slots.some((s) => {
            if (memberIds.includes(s.id)) return false;
            const sCourts = s.courtIds || [s.courtId];
            const myCourts = drag.slot.courtIds || [drag.slot.courtId];
            return myCourts.some((cId) => sCourts.includes(cId)) && _overlaps(startMin, drag.targetDuration, _tToMin(s.startTime), s.durationMinutes);
          });
          drag.preview.style.background = drag.hasConflict ? 'rgba(220,38,38,0.55)' : drag.preview.dataset.color;
          _setConflictCursor(drag.hasConflict);

        } else if (drag.mode === 'resize-courts') {
          const rightFixed = drag.origCourtIdx + drag.origNumCourts - 1;
          if (drag.edge === 'right') {
            drag.targetCourtIdx = drag.origCourtIdx;
            drag.targetNumCourts = Math.max(1, Math.min(ci - drag.origCourtIdx + 1, courts.length - drag.origCourtIdx));
          } else {
            drag.targetCourtIdx = Math.max(0, Math.min(ci, rightFixed));
            drag.targetNumCourts = rightFixed - drag.targetCourtIdx + 1;
          }
          positionPreview(drag.preview, timeToMinutes(drag.slot.startTime), drag.slot.durationMinutes, drag.targetCourtIdx, drag.targetNumCourts);
          const memberIds = drag.slot.memberIds || [drag.slot.id];
          const targetCourtIds = Array.from({ length: drag.targetNumCourts }, (_, k) => courts[drag.targetCourtIdx + k]?.id).filter(Boolean);
          drag.hasConflict = targetCourtIds.some((tcId) => slots.some((s) => {
            if (memberIds.includes(s.id)) return false;
            const sCourts = s.courtIds || [s.courtId];
            return sCourts.includes(tcId) && _overlaps(timeToMinutes(drag.slot.startTime), drag.slot.durationMinutes, _tToMin(s.startTime), s.durationMinutes);
          }));
          drag.preview.style.background = drag.hasConflict ? 'rgba(220,38,38,0.55)' : drag.preview.dataset.color;
          _setConflictCursor(drag.hasConflict);
        }
      }, { signal });

      // Mouseup
      document.addEventListener('mouseup', async (e) => {
        if (!drag) return;
        const d = drag;
        drag = null;

        _setConflictCursor(false);
        if (d.mode === 'add') {
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
              courtIds: courts.slice(d.minIdx, d.maxIdx + 1).map((c) => c.id),
              start: d.minTime,
              dur: d.maxTime - d.minTime,
            });
          }

        } else if (d.mode === 'move-single') {
          d.el.classList.remove('sch-booking--moving');
          d.preview.remove();
          if (!d.moved) {
            if (!d.isLeague) {
              const bid = d.slot.id;
              if (e.shiftKey) {
                if (selectedIds.has(bid)) {
                  selectedIds.delete(bid); state.scheduleSelectedIds = [...selectedIds];
                  d.el.classList.remove('sch-booking--selected');
                } else {
                  selectedIds.add(bid); state.scheduleSelectedIds = [...selectedIds];
                  d.el.classList.add('sch-booking--selected');
                }
              } else {
                clearSelection();
                selectedIds.add(bid); state.scheduleSelectedIds = [...selectedIds];
                d.el.classList.add('sch-booking--selected');
              }
            }
          } else if (!d.hasConflict) {
            try {
              if (d.isLeague) {
                const matchId = Number(d.slot.id.replace('m_', ''));
                await window.api.updateMatchTiming({
                  matchId,
                  matchTime: minutesToTimeStr(d.targetTime),
                  courtId: courts[d.targetCourtIdx].id,
                });
              } else {
                const newCourtIds = d.numCourts > 1
                  ? Array.from({ length: d.numCourts }, (_, k) => courts[d.targetCourtIdx + k].id)
                  : null;
                _pushUndo({ type: 'update', id: d.slot.id, oldData: {
                  courtId: d.slot.courtId, courtIds: d.slot.courtIds || null,
                  date: d.slot.date || state.scheduleDate, startTime: d.slot.startTime,
                  durationMinutes: d.slot.durationMinutes, bookingTypeId: d.slot.bookingTypeId || null,
                  name: d.slot.name || null, info: d.slot.info || null,
                  playerIds: (d.slot.players || []).map((p) => p.id),
                } });
                await window.api.updateBooking(d.slot.id, {
                  courtId: courts[d.targetCourtIdx].id,
                  courtIds: newCourtIds,
                  date: d.slot.date || state.scheduleDate,
                  startTime: minutesToTimeStr(d.targetTime),
                  durationMinutes: d.slot.durationMinutes,
                  bookingTypeId: d.slot.bookingTypeId || null,
                  name: d.slot.name || null,
                  info: d.slot.info || null,
                  playerIds: (d.slot.players || []).map((p) => p.id),
                });
              }
              state.scheduleSelectedIds = [];
              renderSchedule();
            } catch (err) { toast(err.message, 'error'); }
          }

        } else if (d.mode === 'move-area') {
          d.overlay.remove();
          if (!d.moved && d.pendingSelectBid != null) {
            if (e.shiftKey) {
              selectedIds.add(d.pendingSelectBid); state.scheduleSelectedIds = [...selectedIds];
              d.pendingSelectEl.classList.add('sch-booking--selected');
            } else {
              clearSelection();
              selectedIds.add(d.pendingSelectBid); state.scheduleSelectedIds = [...selectedIds];
              d.pendingSelectEl.classList.add('sch-booking--selected');
            }
          } else if (d.moved) {
            const ids = getBookingsInRect(d.minTime, d.maxTime, d.minIdx, d.maxIdx);
            if (ids.length) setSelection(ids);
          }

        } else if (d.mode === 'move-group') {
          d.dragSlots.forEach((s) => s._el?.classList.remove('sch-booking--moving'));
          d.previews.forEach((p) => p.remove());
          if (!d.moved) {
            const anchorSlot = d.dragSlots.find((s) => courtIdxById.get(s.courtId) === d.anchorCourtIdx && s._origStartMin === d.anchorBookingStartMin);
            if (anchorSlot) {
              if (e.shiftKey) {
                // Shift+click: remove this booking from selection
                selectedIds.delete(anchorSlot.id); state.scheduleSelectedIds = [...selectedIds];
                content.querySelector(`[data-booking-id="${anchorSlot.id}"]`)?.classList.remove('sch-booking--selected');
              } else if (selectedIds.size === 1) {
                // Plain click on the sole selected booking: deselect it
                clearSelection();
              } else {
                // Plain click on one of many selected: select only this one
                clearSelection();
                selectedIds.add(anchorSlot.id); state.scheduleSelectedIds = [...selectedIds];
                content.querySelector(`[data-booking-id="${anchorSlot.id}"]`)?.classList.add('sch-booking--selected');
              }
            }
          } else if (!d.hasConflict) {
            try {
              _pushUndo({ type: 'update-group', items: d.dragSlots.map((s) => ({ id: s.id, oldData: {
                courtId: s.courtId, courtIds: s.courtIds || null,
                date: s.date || state.scheduleDate, startTime: s.startTime,
                durationMinutes: s.durationMinutes, bookingTypeId: s.bookingTypeId || null,
                name: s.name || null, info: s.info || null,
                playerIds: (s.players || []).map((p) => p.id),
              } })) });
              // Collect all row IDs being moved so each update can exclude the others from conflict checks
              const allMovingRowIds = d.dragSlots.flatMap((s) => s.memberIds || [s.id]);
              for (const s of d.dragSlots) {
                const newStart = Math.max(DAY_START, Math.min(Math.round((s._origStartMin + d.deltaTime) / 15) * 15, DAY_END - s.durationMinutes));
                const newCI = Math.max(0, Math.min(s._origCourtIdx + d.deltaCourtIdx, courts.length - s._numCourts));
                const newCourtIds = s._numCourts > 1 ? Array.from({ length: s._numCourts }, (_, k) => courts[newCI + k].id) : null;
                const ownIds = new Set(s.memberIds || [s.id]);
                const excludeIds = allMovingRowIds.filter((rid) => !ownIds.has(rid));
                await window.api.updateBooking(s.id, {
                  courtId: courts[newCI].id, courtIds: newCourtIds,
                  date: s.date || state.scheduleDate, startTime: minutesToTimeStr(newStart),
                  durationMinutes: s.durationMinutes, bookingTypeId: s.bookingTypeId || null,
                  name: s.name || null, info: s.info || null,
                  playerIds: (s.players || []).map((p) => p.id),
                  excludeIds,
                });
              }
              state.scheduleSelectedIds = d.dragSlots.map((s) => s.id);
              renderSchedule();
            } catch (err) { toast(err.message, 'error'); }
          }

        } else if (d.mode === 'resize-duration') {
          d.el.classList.remove('sch-booking--moving');
          d.preview.remove();
          if (d.moved && !d.hasConflict && d.targetDuration !== d.slot.durationMinutes) {
            try {
              _pushUndo({ type: 'update', id: d.slot.id, oldData: {
                courtId: d.slot.courtId, courtIds: d.slot.courtIds || null,
                date: d.slot.date || state.scheduleDate, startTime: d.slot.startTime,
                durationMinutes: d.slot.durationMinutes, bookingTypeId: d.slot.bookingTypeId || null,
                name: d.slot.name || null, info: d.slot.info || null,
                playerIds: (d.slot.players || []).map((p) => p.id),
              } });
              await window.api.updateBooking(d.slot.id, {
                date: d.slot.date || state.scheduleDate, startTime: d.slot.startTime,
                durationMinutes: d.targetDuration, bookingTypeId: d.slot.bookingTypeId || null,
                name: d.slot.name || null, info: d.slot.info || null,
                playerIds: (d.slot.players || []).map((p) => p.id),
              });
              state.scheduleSelectedIds = [];
              renderSchedule();
            } catch (err) { toast(err.message, 'error'); }
          }

        } else if (d.mode === 'resize-courts') {
          d.el.classList.remove('sch-booking--moving');
          d.preview.remove();
          if (d.moved && !d.hasConflict && (d.targetCourtIdx !== d.origCourtIdx || d.targetNumCourts !== d.origNumCourts)) {
            try {
              _pushUndo({ type: 'update', id: d.slot.id, oldData: {
                courtId: d.slot.courtId, courtIds: d.slot.courtIds || null,
                date: d.slot.date || state.scheduleDate, startTime: d.slot.startTime,
                durationMinutes: d.slot.durationMinutes, bookingTypeId: d.slot.bookingTypeId || null,
                name: d.slot.name || null, info: d.slot.info || null,
                playerIds: (d.slot.players || []).map((p) => p.id),
              } });
              const newCourtIds = Array.from({ length: d.targetNumCourts }, (_, k) => courts[d.targetCourtIdx + k].id);
              await window.api.updateBooking(d.slot.id, {
                courtIds: newCourtIds, date: d.slot.date || state.scheduleDate,
                startTime: d.slot.startTime, durationMinutes: d.slot.durationMinutes,
                bookingTypeId: d.slot.bookingTypeId || null,
                name: d.slot.name || null, info: d.slot.info || null,
                playerIds: (d.slot.players || []).map((p) => p.id),
              });
              state.scheduleSelectedIds = [];
              renderSchedule();
            } catch (err) { toast(err.message, 'error'); }
          }
        }
      }, { signal });
    }
  }

  if (savedScrollTop) {
    const scrollEl = content.querySelector('.sch-grid-scroll');
    if (scrollEl) scrollEl.scrollTop = savedScrollTop;
  }
}

