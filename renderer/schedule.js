import { state, isAdmin, _setConflictCursor } from './state.js';
import { esc, toast, modal } from './utils.js';

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
function _fmtTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
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

  if (!state.scheduleDate) state.scheduleDate = _isoDate(new Date());
  const today = _isoDate(new Date());

  const savedScrollTop = content.querySelector('.sch-grid-scroll')?.scrollTop ?? 0;

  const actionsEl = document.getElementById('topbarActions');
  actionsEl.innerHTML = isAdmin() ? `<button class="btn btn-primary" id="btnNewBooking">+ New Booking</button>` : '';

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
  const stripStart = _addDaysLocal(state.scheduleDate, -3);
  const dayStripHTML = Array.from({ length: 7 }, (_, i) => {
    const d = _addDaysLocal(stripStart, i);
    const [, , dd] = d.split('-').map(Number);
    const dObj = new Date(d.split('-').map(Number)[0], d.split('-').map(Number)[1] - 1, dd);
    const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const isActive = d === state.scheduleDate;
    const isDayToday = d === today;
    return `<button class="sch-day-btn${isActive ? ' active' : ''}${isDayToday ? ' today' : ''}" data-date="${d}">
      <span class="sch-day-name">${dayName}</span>
      <span class="sch-day-num">${dd}</span>
    </button>`;
  }).join('');

  // Time axis
  const DAY_START = 6 * 60;
  const DAY_END   = 23 * 60;
  const SLOT_H      = 44;
  const SLOT_MIN    = 30;
  const totalSlots  = (DAY_END - DAY_START) / SLOT_MIN;
  const BASE_GRID_H = totalSlots * SLOT_H;

  function fmtHour(h) {
    if (h === 0 || h === 24) return '12am';
    if (h === 12) return '12pm';
    const ampm = h >= 12 ? 'pm' : 'am';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}${ampm}`;
  }

  const timeAxisHTML = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) {
    const h = Math.floor(m / 60);
    const top = ((m - DAY_START) / SLOT_MIN) * SLOT_H;
    const transform = top === 0 ? ';transform:none' : ';transform:translateY(-50%)';
    timeAxisHTML.push(`<div class="sch-time-label" style="top:calc(${top}px * var(--zh))${transform}">${fmtHour(h)}</div>`);
  }

  // "Now" indicator — only on today, within operating hours
  const _nowDate = new Date();
  const nowMins = _nowDate.getHours() * 60 + _nowDate.getMinutes();
  const showNow = isToday && nowMins >= DAY_START && nowMins < DAY_END;
  const nowTop = ((nowMins - DAY_START) / SLOT_MIN) * SLOT_H;
  if (showNow) {
    timeAxisHTML.push(`<div class="sch-now-label" style="top:calc(${nowTop}px * var(--zh));transform:translateY(-50%)">Now</div>`);
  }

  // Grid lines
  const gridLinesHTML = Array.from({ length: totalSlots + 1 }, (_, i) => {
    const top = i * SLOT_H;
    return `<div class="sch-grid-line${i % 2 === 0 ? ' major' : ''}" style="top:calc(${top}px * var(--zh))"></div>`;
  }).join('');

  function timeToMinutes(t) {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  const courtIdxById = new Map(courts.map((c, i) => [c.id, i]));

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
      const endStr = `${String(Math.floor(endMin2 / 60)).padStart(2, '0')}:${String(endMin2 % 60).padStart(2, '0')}`;
      const timeRange = `${_fmtTime(s.startTime)} – ${_fmtTime(endStr)}`;
      const playerText = s.players && s.players.length > 0
        ? s.players.map((p) => { const parts = (p.name || '').trim().split(/\s+/); return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : parts[0]; }).join(' · ')
        : null;
      const subLine = playerText || s.info || null;
      const editBtn = isAdmin() && !isLeague && !isTournament
        ? `<button class="sch-booking-edit-btn" data-edit-booking-id="${s.id}" title="Edit booking"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
        : '';
      return `<div class="sch-booking${isLeague ? ' sch-booking-league' : ''}${isTournament ? ' sch-booking-tournament' : ''}"${editAttr} style="background:${esc(s.color)};top:calc(${top}px * var(--zh));height:calc(${safeH}px * var(--zh) - 3px)${cursorStyle}">
        ${editBtn}
        <div class="sch-booking-time">${timeRange}</div>
        <div class="sch-booking-title">${esc(s.title)}</div>
        ${subLine ? `<div class="sch-booking-info">${esc(subLine)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="sch-court-col" style="height:calc(${BASE_GRID_H}px * var(--zh))" data-court-id="${court.id}">
      ${gridLinesHTML}${blocksHTML}
    </div>`;
  }).join('');

  content.innerHTML = `
    <div class="sch-page">
      <div class="sch-daybar">
        <div class="sch-daybar-left">
          <button class="sch-nav-btn" id="schPrev">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="sch-daybar-date">
            <div class="sch-daybar-weekday">${weekdayName}</div>
            <div class="sch-daybar-subdate">${dateLong}${isToday ? ' · Today' : ''}</div>
          </div>
          <button class="sch-nav-btn" id="schNext">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="sch-jump-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>
            <span>Jump to date</span>
            <input type="date" id="schDatePicker" class="sch-jump-input" value="${state.scheduleDate}">
          </div>
        </div>
        <div class="sch-day-strip">${dayStripHTML}</div>
      </div>

      ${isAdmin() && courts.length > 0 ? `<div class="sch-toolbar">
        <div class="sch-type-pills">
          <button class="sch-type-pill${state.scheduleBookingTypeId === null ? ' active' : ''}" data-type-id="" style="--pill-color:var(--accent)">Standard</button>
          ${bookingTypes.map((bt) => `<button class="sch-type-pill${state.scheduleBookingTypeId === bt.id ? ' active' : ''}" data-type-id="${bt.id}" style="--pill-color:${esc(bt.color)}"><span class="sch-type-pill-dot" style="background:${esc(bt.color)}"></span>${esc(bt.name)}</button>`).join('')}
        </div>
        <div class="sch-toolbar-spacer"></div>
        <div class="sch-zoom-group">
          <button class="sch-zoom-btn" id="schZoomOut" title="Zoom out"${state.scheduleZoom <= 0.5 ? ' disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <span class="sch-zoom-pct">${Math.round(state.scheduleZoom * 100)}%</span>
          <button class="sch-zoom-btn" id="schZoomIn" title="Zoom in"${state.scheduleZoom >= 2.0 ? ' disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>` : ''}

      ${courts.length === 0
        ? `<div class="sch-no-courts">No courts configured.${isAdmin() ? ` <a href="#" id="schGoSettings">Add courts in Club Settings.</a>` : ''}</div>`
        : `<div class="sch-grid-area">
            <div class="sch-grid-card">
              <div class="sch-grid-scroll">
                <div class="sch-grid-header">
                  <div class="sch-time-spacer" style="width:${TIME_COL_W}px"></div>
                  ${courts.map((c) => `<div class="sch-court-hd" style="min-width:${COURT_COL_W}px">${esc(c.name)}</div>`).join('')}
                </div>
                <div class="sch-grid-body" style="--zh:${state.scheduleZoom}">
                  <div class="sch-time-col" style="width:${TIME_COL_W}px;height:calc(${BASE_GRID_H}px * var(--zh))">${timeAxisHTML.join('')}</div>
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
      nowLineEl.style.top = `calc(${nowTop}px * var(--zh))`;
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
        const endStr = `${String(Math.floor(endMin2 / 60)).padStart(2, '0')}:${String(endMin2 % 60).padStart(2, '0')}`;
        const timeRange = `${_fmtTime(s.startTime)} – ${_fmtTime(endStr)}`;
        const leftPx = leftRect.left - rowRect.left + 6;
        const widthPx = rightRect.right - leftRect.left - 12;
        const el = document.createElement('div');
        el.className = 'sch-booking';
        el.style.cssText = `background:${s.color};position:absolute;left:${leftPx}px;width:${widthPx}px;top:calc(${top}px * var(--zh));height:calc(${safeH}px * var(--zh) - 3px);z-index:2${isAdmin() ? ';cursor:pointer' : ''}`;
        if (isAdmin()) el.dataset.bookingId = String(s.id);
        const _playerText = s.players && s.players.length > 0
          ? s.players.map((p) => { const pts = (p.name || '').trim().split(/\s+/); return pts.length > 1 ? `${pts[0][0]}. ${pts[pts.length - 1]}` : pts[0]; }).join(' · ')
          : null;
        el.innerHTML = `<button class="sch-booking-edit-btn" data-edit-booking-id="${s.id}" title="Edit booking"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <div class="sch-booking-time">${timeRange}</div>
          <div class="sch-booking-title">${esc(s.title)}</div>
          ${(_playerText || s.info) ? `<div class="sch-booking-info">${esc(_playerText || s.info)}</div>` : ''}`;
        courtsRowEl.appendChild(el);
      });
    }
  }

  content.querySelectorAll('.sch-day-btn').forEach((btn) => {
    btn.addEventListener('click', () => { state.scheduleDate = btn.dataset.date; renderSchedule(); });
  });
  document.getElementById('schPrev')?.addEventListener('click', () => {
    state.scheduleDate = _addDaysLocal(state.scheduleDate, -1); renderSchedule();
  });
  document.getElementById('schNext')?.addEventListener('click', () => {
    state.scheduleDate = _addDaysLocal(state.scheduleDate, 1); renderSchedule();
  });
  document.getElementById('schDatePicker')?.addEventListener('change', (e) => {
    if (e.target.value) { state.scheduleDate = e.target.value; renderSchedule(); }
  });
  document.getElementById('schGoSettings')?.addEventListener('click', (e) => {
    e.preventDefault(); window.navigate('clubSettings');
  });
  function applyZoom(newRatio, anchorClientY) {
    const scrollEl = content.querySelector('.sch-grid-scroll');
    const oldZoom = state.scheduleZoom;
    const clamped = Math.max(0.5, Math.min(2.0, newRatio));

    // Record unscaled grid position under the anchor point before zoom
    let unscaledPos = null;
    let cursorOffset = null;
    if (scrollEl && anchorClientY !== undefined) {
      const rect = scrollEl.getBoundingClientRect();
      cursorOffset = anchorClientY - rect.top;
      unscaledPos = (scrollEl.scrollTop + cursorOffset) / oldZoom;
    }

    state.scheduleZoom = clamped;
    const gridBody = content.querySelector('.sch-grid-body');
    if (gridBody) gridBody.style.setProperty('--zh', clamped);
    const pctEl = content.querySelector('.sch-zoom-pct');
    if (pctEl) pctEl.textContent = `${Math.round(clamped * 100)}%`;
    const btnOut = document.getElementById('schZoomOut');
    const btnIn  = document.getElementById('schZoomIn');
    if (btnOut) btnOut.disabled = clamped <= 0.5;
    if (btnIn)  btnIn.disabled  = clamped >= 2.0;

    // Restore scroll so the anchor time stays under the same screen position
    if (scrollEl && unscaledPos !== null) {
      scrollEl.scrollTop = unscaledPos * clamped - cursorOffset;
    }

  }

  document.getElementById('schZoomOut')?.addEventListener('click', () => {
    const scrollEl = content.querySelector('.sch-grid-scroll');
    const centerY = scrollEl ? scrollEl.getBoundingClientRect().top + scrollEl.clientHeight / 2 : undefined;
    applyZoom(state.scheduleZoom / 1.25, centerY);
  });
  document.getElementById('schZoomIn')?.addEventListener('click', () => {
    const scrollEl = content.querySelector('.sch-grid-scroll');
    const centerY = scrollEl ? scrollEl.getBoundingClientRect().top + scrollEl.clientHeight / 2 : undefined;
    applyZoom(state.scheduleZoom * 1.25, centerY);
  });
  document.getElementById('btnNewBooking')?.addEventListener('click', () => openNewBookingModal(courts, slots));

  // Booking type pill selection
  content.querySelectorAll('.sch-type-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const rawId = pill.dataset.typeId;
      state.scheduleBookingTypeId = rawId ? Number(rawId) : null;
      content.querySelectorAll('.sch-type-pill').forEach((p) => p.classList.toggle('active', p === pill));
    });
  });

  // Ctrl+scroll (or trackpad pinch) on the grid = smooth zoom
  content.querySelector('.sch-grid-scroll')?.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    applyZoom(state.scheduleZoom * (e.deltaY < 0 ? 1.05 : 1 / 1.05), e.clientY);
  }, { passive: false });

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
        const effectiveSlotH = SLOT_H * state.scheduleZoom;
        const y = Math.max(0, Math.min(clientY - courtsRow.getBoundingClientRect().top, BASE_GRID_H * state.scheduleZoom - 1));
        return Math.round((DAY_START + (y / effectiveSlotH) * SLOT_MIN) / 15) * 15;
      }
      function getColRect(idx) {
        return [...courtsRow.querySelectorAll('.sch-court-col')][idx]?.getBoundingClientRect();
      }
      function positionOverlay(el, minTime, maxTime, minIdx, maxIdx) {
        const rowRect = courtsRow.getBoundingClientRect();
        const s = getColRect(minIdx), e2 = getColRect(maxIdx);
        if (!s || !e2) return;
        const effectiveSlotH = SLOT_H * state.scheduleZoom;
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
        const effectiveSlotH = SLOT_H * state.scheduleZoom;
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

      // Grey tracking line — follows cursor while hovering
      const hoverLine = document.createElement('div');
      hoverLine.className = 'sch-hover-line';
      hoverLine.style.display = 'none';
      courtsRow.appendChild(hoverLine);

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
          const effectiveSlotH = SLOT_H * state.scheduleZoom;
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
        if (drag || pasteMode || e.target.closest('.sch-booking')) { hoverLine.style.display = 'none'; return; }
        const courtIdx = getCourtIdxAtX(e.clientX);
        if (courtIdx === -1) { hoverLine.style.display = 'none'; return; }
        const cr = getColRect(courtIdx);
        if (!cr) { hoverLine.style.display = 'none'; return; }
        const rowRect = courtsRow.getBoundingClientRect();
        const snappedTime = getTimeAtY(e.clientY);
        const top = ((snappedTime - DAY_START) / SLOT_MIN) * SLOT_H * state.scheduleZoom;
        hoverLine.style.top = `${top}px`;
        hoverLine.style.left = `${cr.left - rowRect.left}px`;
        hoverLine.style.width = `${cr.width}px`;
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
      // Restore visual selection from previous render
      if (selectedIds.size) {
        content.querySelectorAll('[data-booking-id]').forEach((el) =>
          el.classList.toggle('sch-booking--selected', selectedIds.has(Number(el.dataset.bookingId))));
      }

      // Edit icon click → open edit modal
      courtsRow.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.sch-booking-edit-btn');
        if (!editBtn) return;
        e.stopPropagation();
        const id = Number(editBtn.dataset.editBookingId);
        const slot = slots.find((s) => s.id === id);
        if (slot) openEditBookingModal(slot, courts, slots);
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
          const overlay = document.createElement('div');
          overlay.className = 'sch-drag-overlay';
          courtsRow.appendChild(overlay);
          const t = getTimeAtY(e.clientY);
          drag = { mode: 'add', startX: e.clientX, startY: e.clientY, startIdx: si, startTime: t, overlay, moved: false,
            minIdx: si, maxIdx: si, minTime: t, maxTime: t + 60 };

        } else if (bookingEl) {
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
              overlay.className = 'sch-drag-overlay sch-drag-overlay--select';
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
        if (!drag.moved && Math.sqrt(dx * dx + dy * dy) > 6) drag.moved = true;
        if (!drag.moved) return;
        const ci = clampCourtIdx(e.clientX);

        if (drag.mode === 'add' || drag.mode === 'move-area') {
          drag.minIdx = Math.min(drag.startIdx, ci);
          drag.maxIdx = Math.max(drag.startIdx, ci);
          const t = getTimeAtY(e.clientY);
          drag.minTime = Math.min(drag.startTime, t);
          drag.maxTime = Math.max(drag.startTime, t);
          if (drag.maxTime === drag.minTime) drag.maxTime = drag.minTime + 15;
          positionOverlay(drag.overlay, drag.minTime, drag.maxTime, drag.minIdx, drag.maxIdx);
          if (drag.mode === 'add') {
            const affectedIds = new Set(courts.slice(drag.minIdx, drag.maxIdx + 1).map((c) => c.id));
            drag.hasBookingsInRect = slots.some((s) => {
              const sCourts = s.courtIds || [s.courtId];
              return sCourts.some((id) => affectedIds.has(id)) && _overlaps(drag.minTime, drag.maxTime - drag.minTime, _tToMin(s.startTime), s.durationMinutes);
            });
            drag.overlay.classList.toggle('sch-drag-overlay--select', drag.hasBookingsInRect);
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
          d.overlay.remove();
          if (d.moved && d.hasBookingsInRect) {
            // Dragged over bookings — select them
            const ids = getBookingsInRect(d.minTime, d.maxTime, d.minIdx, d.maxIdx);
            if (ids.length) setSelection(ids);
          } else if (!d.moved) {
            clearSelection();
          } else {
            const selCourts = courts.slice(d.minIdx, d.maxIdx + 1);
            const dur = d.maxTime - d.minTime;
            openGridBookingModal(courts, slots, { courtId: selCourts[0]?.id, courtIds: selCourts.length > 1 ? selCourts.map((c) => c.id) : null, startTime: minutesToTimeStr(d.minTime), durationMinutes: dur }, bookingTypes);
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

// ===== GRID BOOKING MODAL (players only — type/time/court from grid) =====
async function openGridBookingModal(courts, slots, prefill, bookingTypes) {
  const allPlayers = await window.api.getPlayers();
  const activeType = bookingTypes.find((bt) => bt.id === state.scheduleBookingTypeId) || null;
  const typeLabel = activeType ? activeType.name : 'Standard';
  const dotHtml = activeType ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(activeType.color)};margin-right:5px;vertical-align:middle"></span>` : '';

  modal.open('New Booking', `
    <div class="grid-bk-meta">${dotHtml}<strong>${typeLabel}</strong></div>
    <form id="gridBookingForm">
      <div class="form-group">
        <label class="form-label">Players <span class="form-hint">(optional, up to 4)</span></label>
        <div class="bk-player-wrap">
          <input type="text" class="form-control" id="fGridPlayerSearch" placeholder="Search players…" autocomplete="off">
          <ul id="fGridPlayerSuggestions" class="bk-player-drop" style="display:none"></ul>
          <div id="fGridPlayerChips" class="bk-player-chips"></div>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Book</button>
      </div>
    </form>
  `);

  let selectedPlayers = [];

  function renderChips() {
    const container = document.getElementById('fGridPlayerChips');
    if (!container) return;
    container.innerHTML = selectedPlayers.map((p) =>
      `<div class="bk-chip">${esc(p.name)}<button type="button" class="bk-chip-remove" data-pid="${p.id}" aria-label="Remove">×</button></div>`
    ).join('');
    container.querySelectorAll('.bk-chip-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedPlayers = selectedPlayers.filter((p) => p.id !== Number(btn.dataset.pid));
        renderChips();
        const searchEl = document.getElementById('fGridPlayerSearch');
        if (searchEl) searchEl.disabled = false;
      });
    });
    const searchEl = document.getElementById('fGridPlayerSearch');
    if (searchEl) searchEl.disabled = selectedPlayers.length >= 4;
  }

  function showSuggestions(query) {
    const suggestEl = document.getElementById('fGridPlayerSuggestions');
    if (!suggestEl) return;
    if (!query.trim() || selectedPlayers.length >= 4) { suggestEl.style.display = 'none'; return; }
    const q = query.toLowerCase();
    const matches = allPlayers.filter((p) =>
      p.name.toLowerCase().includes(q) && !selectedPlayers.some((sp) => sp.id === p.id)
    ).slice(0, 8);
    if (!matches.length) { suggestEl.style.display = 'none'; return; }
    suggestEl.innerHTML = matches.map((p) =>
      `<li class="bk-player-opt" data-pid="${p.id}" data-pname="${esc(p.name)}">${esc(p.name)}</li>`
    ).join('');
    suggestEl.style.display = 'block';
    suggestEl.querySelectorAll('.bk-player-opt').forEach((li) => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (selectedPlayers.length < 4 && !selectedPlayers.some((sp) => sp.id === Number(li.dataset.pid))) {
          selectedPlayers.push({ id: Number(li.dataset.pid), name: li.dataset.pname });
          renderChips();
        }
        const searchEl = document.getElementById('fGridPlayerSearch');
        if (searchEl) { searchEl.value = ''; }
        suggestEl.style.display = 'none';
      });
    });
  }

  const searchEl = document.getElementById('fGridPlayerSearch');
  searchEl?.addEventListener('input', (e) => showSuggestions(e.target.value));
  searchEl?.addEventListener('focus', (e) => showSuggestions(e.target.value));
  searchEl?.addEventListener('blur', () => setTimeout(() => {
    const suggestEl = document.getElementById('fGridPlayerSuggestions');
    if (suggestEl) suggestEl.style.display = 'none';
  }, 150));

  document.getElementById('gridBookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { courtId, courtIds, startTime, durationMinutes } = prefill;
    try {
      const newBooking = await window.api.addBooking({
        courtId: courtId || null,
        courtIds: courtIds || null,
        date: state.scheduleDate,
        startTime,
        durationMinutes,
        bookingTypeId: state.scheduleBookingTypeId,
        name: null,
        info: null,
        playerIds: selectedPlayers.map((p) => p.id),
      });
      if (newBooking?.id) _pushUndo({ type: 'delete-ids', ids: [newBooking.id] });
      modal.close();
      renderSchedule();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function durationOptions(selected = 60, startTimeStr = '19:00') {
  const parts = (startTimeStr || '19:00').split(':').map(Number);
  const startMin = (parts[0] || 0) * 60 + (parts[1] || 0);
  const maxDuration = Math.max(15, 1440 - startMin);
  const opts = [];
  for (let v = 15; v <= maxDuration; v += 15) opts.push(v);
  const snapped = Math.max(15, Math.min(Math.round(selected / 15) * 15, maxDuration));
  return opts.map((v) => {
    const h = Math.floor(v / 60), m = v % 60;
    const label = h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`;
    return `<option value="${v}"${v === snapped ? ' selected' : ''}>${label}</option>`;
  }).join('');
}

// ===== NEW BOOKING MODAL =====
async function openNewBookingModal(courts, slots, prefill = {}) {
  const { courtId: prefillCourtId, startTime: prefillTime, durationMinutes: prefillDuration, selectedCourts } = prefill;
  const isMulti = Array.isArray(selectedCourts) && selectedCourts.length > 1;

  const [bookingTypes, allPlayers] = await Promise.all([
    window.api.getBookingTypes(),
    window.api.getPlayers(),
  ]);

  const startTimeVal = prefillTime || '19:00';
  const durationVal = prefillDuration || 60;
  const defaultDate = state.scheduleDate || _isoDate(new Date());
  const defaultDow = new Date(defaultDate + 'T12:00:00').getDay();

  const courtField = isMulti
    ? `<div class="form-group">
        <label class="form-label">Courts</label>
        <div class="sch-court-checks">
          ${courts.map((c) => `<label class="check-label"><input type="checkbox" class="fBookingCourtChk" value="${c.id}"${selectedCourts.some((sc) => sc.id === c.id) ? ' checked' : ''}> ${esc(c.name)}</label>`).join('')}
        </div>
      </div>`
    : `<div class="form-group">
        <label class="form-label">Court</label>
        <select class="form-control" id="fBookingCourt" required>
          <option value="">— Select court —</option>
          ${courts.map((c) => `<option value="${c.id}"${c.id === prefillCourtId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>`;

  const dowLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  modal.open('New Booking', `
    <form id="bookingForm">
      ${courtField}
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Date</label>
          <input type="date" class="form-control" id="fBookingDate" value="${defaultDate}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Start Time</label>
          <input type="time" class="form-control" id="fBookingTime" value="${startTimeVal}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Duration</label>
          <select class="form-control" id="fBookingDuration">${durationOptions(durationVal, startTimeVal)}</select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Name</label>
        <input type="text" class="form-control" id="fBookingName" placeholder="e.g. Training, Open Play…" maxlength="80">
      </div>

      <div class="form-group">
        <label class="form-label">Booking Type</label>
        <select class="form-control" id="fBookingType">
          <option value="">— None —</option>
          ${bookingTypes.map((bt) => `<option value="${bt.id}">${esc(bt.name)}</option>`).join('')}
          <option value="__custom__">+ Create custom type…</option>
        </select>
      </div>

      <div id="customTypeSection" style="display:none">
        <div class="form-row">
          <div class="form-group" style="flex:3">
            <label class="form-label">Type Name</label>
            <input type="text" class="form-control" id="fCustomTypeName" placeholder="e.g. Members Training" maxlength="40">
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">Colour</label>
            <input type="color" class="form-control bk-color-input" id="fCustomTypeColor" value="#4f87f0">
          </div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Players <span class="form-hint">(up to 4)</span></label>
        <div class="bk-player-wrap">
          <input type="text" class="form-control" id="fPlayerSearch" placeholder="Search players…" autocomplete="off">
          <ul id="fPlayerSuggestions" class="bk-player-drop" style="display:none"></ul>
          <div id="fPlayerChips" class="bk-player-chips"></div>
        </div>
      </div>

      <div class="form-group">
        <div class="bk-toggle-group">
          <button type="button" class="bk-toggle bk-toggle--on" id="btnNoRepeat">No Repeat</button>
          <button type="button" class="bk-toggle" id="btnRepeat">Repeated Event</button>
        </div>
      </div>

      <div id="repeatSection" style="display:none">
        <div class="form-group">
          <label class="form-label">Repeat on</label>
          <div class="bk-dow-row">
            ${dowLabels.map((lbl, i) => `<label class="bk-dow-pill"><input type="checkbox" class="fDowChk" value="${i}"${i === defaultDow ? ' checked' : ''}><span>${lbl}</span></label>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Conflicts</label>
          <div class="bk-toggle-group">
            <button type="button" class="bk-toggle bk-toggle--on" id="btnSkipConflicts">Skip conflicts</button>
            <button type="button" class="bk-toggle" id="btnOverwriteConflicts">Overwrite conflicts</button>
          </div>
        </div>
        <div class="form-row" style="align-items:flex-end">
          <div class="form-group" style="flex:1">
            <label class="form-label">Repeat for</label>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="number" class="form-control" id="fRepeatWeeks" min="1" max="52" value="4" style="width:80px;flex-shrink:0">
              <span style="color:var(--text-muted);font-size:13px;white-space:nowrap">weeks</span>
            </div>
          </div>
          <div class="form-group" style="flex:1;padding-bottom:18px">
            <label class="check-label">
              <input type="checkbox" id="fIndefinitely">
              Indefinitely <span class="form-hint">(max 1 year)</span>
            </label>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="submit" class="btn btn-primary">${isMulti ? 'Add Bookings' : 'Add Booking'}</button>
      </div>
    </form>
  `, { medium: true });

  // ---- Player search state ----
  let selectedPlayers = [];
  let isRepeat = false;
  let conflictMode = 'skip';

  function renderChips() {
    const container = document.getElementById('fPlayerChips');
    if (!container) return;
    container.innerHTML = selectedPlayers.map((p) =>
      `<div class="bk-chip">${esc(p.name)}<button type="button" class="bk-chip-remove" data-pid="${p.id}" aria-label="Remove">×</button></div>`
    ).join('');
    container.querySelectorAll('.bk-chip-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedPlayers = selectedPlayers.filter((p) => p.id !== Number(btn.dataset.pid));
        renderChips();
        const searchEl = document.getElementById('fPlayerSearch');
        if (searchEl) searchEl.disabled = false;
      });
    });
    const searchEl = document.getElementById('fPlayerSearch');
    if (searchEl) searchEl.disabled = selectedPlayers.length >= 4;
  }

  function showSuggestions(query) {
    const suggestEl = document.getElementById('fPlayerSuggestions');
    if (!suggestEl) return;
    if (!query.trim() || selectedPlayers.length >= 4) { suggestEl.style.display = 'none'; return; }
    const q = query.toLowerCase();
    const matches = allPlayers.filter((p) =>
      p.name.toLowerCase().includes(q) && !selectedPlayers.some((sp) => sp.id === p.id)
    ).slice(0, 8);
    if (!matches.length) { suggestEl.style.display = 'none'; return; }
    suggestEl.innerHTML = matches.map((p) =>
      `<li class="bk-player-opt" data-pid="${p.id}" data-pname="${esc(p.name)}">${esc(p.name)}</li>`
    ).join('');
    suggestEl.style.display = 'block';
    suggestEl.querySelectorAll('.bk-player-opt').forEach((li) => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (selectedPlayers.length < 4 && !selectedPlayers.some((sp) => sp.id === Number(li.dataset.pid))) {
          selectedPlayers.push({ id: Number(li.dataset.pid), name: li.dataset.pname });
          renderChips();
        }
        const searchEl = document.getElementById('fPlayerSearch');
        if (searchEl) { searchEl.value = ''; }
        suggestEl.style.display = 'none';
      });
    });
  }

  const searchEl = document.getElementById('fPlayerSearch');
  searchEl?.addEventListener('input', (e) => showSuggestions(e.target.value));
  searchEl?.addEventListener('focus', (e) => showSuggestions(e.target.value));
  searchEl?.addEventListener('blur', () => setTimeout(() => {
    const suggestEl = document.getElementById('fPlayerSuggestions');
    if (suggestEl) suggestEl.style.display = 'none';
  }, 150));

  // ---- Booking type toggle ----
  document.getElementById('fBookingType')?.addEventListener('change', (e) => {
    const sec = document.getElementById('customTypeSection');
    if (sec) sec.style.display = e.target.value === '__custom__' ? 'block' : 'none';
  });

  // ---- Repeat toggle ----
  document.getElementById('btnNoRepeat')?.addEventListener('click', () => {
    isRepeat = false;
    document.getElementById('btnNoRepeat').classList.add('bk-toggle--on');
    document.getElementById('btnRepeat').classList.remove('bk-toggle--on');
    document.getElementById('repeatSection').style.display = 'none';
  });
  document.getElementById('btnRepeat')?.addEventListener('click', () => {
    isRepeat = true;
    document.getElementById('btnRepeat').classList.add('bk-toggle--on');
    document.getElementById('btnNoRepeat').classList.remove('bk-toggle--on');
    document.getElementById('repeatSection').style.display = 'block';
  });

  // ---- Conflict mode toggle ----
  document.getElementById('btnSkipConflicts')?.addEventListener('click', () => {
    conflictMode = 'skip';
    document.getElementById('btnSkipConflicts').classList.add('bk-toggle--on');
    document.getElementById('btnOverwriteConflicts').classList.remove('bk-toggle--on');
  });
  document.getElementById('btnOverwriteConflicts')?.addEventListener('click', () => {
    conflictMode = 'overwrite';
    document.getElementById('btnOverwriteConflicts').classList.add('bk-toggle--on');
    document.getElementById('btnSkipConflicts').classList.remove('bk-toggle--on');
  });

  // ---- Indefinitely checkbox ----
  document.getElementById('fIndefinitely')?.addEventListener('change', (e) => {
    const weeksEl = document.getElementById('fRepeatWeeks');
    if (weeksEl) weeksEl.disabled = e.target.checked;
  });

  // ---- Duration / court conflict helpers (same as before) ----
  function refreshNewDurations() {
    const durEl = document.getElementById('fBookingDuration');
    const timeStr = document.getElementById('fBookingTime')?.value || '19:00';
    const dateVal = document.getElementById('fBookingDate')?.value;
    durEl.innerHTML = durationOptions(Number(durEl.value), timeStr);
    if (dateVal === state.scheduleDate && slots) {
      const startMin = _tToMin(timeStr);
      if (isMulti) {
        const checkedIds = new Set([...document.querySelectorAll('.fBookingCourtChk:checked')].map((el) => Number(el.value)));
        if (checkedIds.size) {
          Array.from(durEl.options).forEach((opt) => {
            opt.disabled = slots.some((s) => {
              const sCourts = s.courtIds || [s.courtId];
              return sCourts.some((id) => checkedIds.has(id)) && _overlaps(startMin, Number(opt.value), _tToMin(s.startTime), s.durationMinutes);
            });
          });
        }
      } else {
        const courtId = Number(document.getElementById('fBookingCourt')?.value) || null;
        if (courtId) {
          Array.from(durEl.options).forEach((opt) => {
            opt.disabled = slots.some((s) => {
              const sCourts = s.courtIds || [s.courtId];
              return sCourts.includes(courtId) && _overlaps(startMin, Number(opt.value), _tToMin(s.startTime), s.durationMinutes);
            });
          });
        }
      }
    }
  }

  function refreshNewCourtAvailability() {
    if (!isMulti) return;
    const timeStr = document.getElementById('fBookingTime')?.value;
    const dateVal = document.getElementById('fBookingDate')?.value;
    const durVal = Number(document.getElementById('fBookingDuration')?.value) || 60;
    const startMin = _tToMin(timeStr);
    const checkedIds = new Set([...document.querySelectorAll('.fBookingCourtChk:checked')].map((el) => Number(el.value)));
    const checkedIdxs = courts.reduce((acc, c, i) => { if (checkedIds.has(c.id)) acc.push(i); return acc; }, []);
    const minIdx = checkedIdxs.length ? checkedIdxs[0] : -1;
    const maxIdx = checkedIdxs.length ? checkedIdxs[checkedIdxs.length - 1] : -1;
    courts.forEach((court, idx) => {
      const chk = document.querySelector(`.fBookingCourtChk[value="${court.id}"]`);
      if (!chk) return;
      const label = chk.closest('label') || chk.parentElement;
      const hasConflict = startMin !== null && dateVal === state.scheduleDate && slots.some((s) => {
        const sCourts = s.courtIds || [s.courtId];
        return sCourts.includes(court.id) && _overlaps(startMin, durVal, _tToMin(s.startTime), s.durationMinutes);
      });
      const isChecked = checkedIds.has(court.id);
      let adjacencyLocked = false;
      if (checkedIdxs.length > 0) {
        if (!isChecked) adjacencyLocked = idx !== minIdx - 1 && idx !== maxIdx + 1;
        else adjacencyLocked = idx > minIdx && idx < maxIdx;
      }
      const disable = hasConflict || adjacencyLocked;
      chk.disabled = disable;
      label.style.opacity = disable ? '0.45' : '';
      label.title = hasConflict ? 'Already booked at this time' : adjacencyLocked ? 'Must select adjacent courts' : '';
    });
  }

  document.getElementById('fBookingTime')?.addEventListener('change', () => { refreshNewDurations(); refreshNewCourtAvailability(); });
  document.getElementById('fBookingCourt')?.addEventListener('change', refreshNewDurations);
  document.getElementById('fBookingDate')?.addEventListener('change', () => { refreshNewDurations(); refreshNewCourtAvailability(); });
  document.getElementById('fBookingDuration')?.addEventListener('change', refreshNewCourtAvailability);
  document.querySelectorAll('.fBookingCourtChk').forEach((chk) => chk.addEventListener('change', () => { refreshNewCourtAvailability(); refreshNewDurations(); }));
  refreshNewDurations();
  refreshNewCourtAvailability();

  // ---- Submit ----
  document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const date = document.getElementById('fBookingDate').value;
    const startTime = document.getElementById('fBookingTime').value;
    const durationMinutes = Number(document.getElementById('fBookingDuration').value);
    const name = document.getElementById('fBookingName').value.trim() || null;
    const playerIds = selectedPlayers.map((p) => p.id);

    // Resolve booking type (create custom if needed)
    let bookingTypeId = document.getElementById('fBookingType').value;
    if (bookingTypeId === '__custom__') {
      const typeName = document.getElementById('fCustomTypeName').value.trim();
      const typeColor = document.getElementById('fCustomTypeColor').value;
      if (!typeName) { toast('Type name is required', 'error'); return; }
      try {
        const newType = await window.api.addBookingType({ name: typeName, color: typeColor });
        bookingTypeId = newType.id;
      } catch (err) { toast(err.message, 'error'); return; }
    } else {
      bookingTypeId = bookingTypeId ? Number(bookingTypeId) : null;
    }

    // Resolve courts
    let courtId, courtIds;
    if (isMulti) {
      courtIds = [...document.querySelectorAll('.fBookingCourtChk:checked')].map((el) => Number(el.value));
      if (!courtIds.length || !date || !startTime) return;
    } else {
      courtId = Number(document.getElementById('fBookingCourt').value);
      if (!courtId || !date || !startTime) return;
    }

    const bookingData = { courtId, courtIds, date, startTime, durationMinutes, bookingTypeId, name, info: null, playerIds };

    if (isRepeat) {
      const daysOfWeek = [...document.querySelectorAll('.fDowChk:checked')].map((el) => Number(el.value));
      if (!daysOfWeek.length) { toast('Select at least one day of week', 'error'); return; }
      const indefinitely = document.getElementById('fIndefinitely').checked;
      const weeks = indefinitely ? 52 : Math.min(52, Math.max(1, Number(document.getElementById('fRepeatWeeks').value) || 4));
      try {
        const result = await window.api.addRepeatBookings({
          ...bookingData,
          repeat: { startDate: date, daysOfWeek, weeks, conflictMode },
        });
        modal.close();
        state.scheduleDate = date;
        let msg = `${result.created} booking${result.created !== 1 ? 's' : ''} created`;
        if (result.skipped > 0) msg += `, ${result.skipped} skipped`;
        toast(msg);
        if (result.leagueConflicts && result.leagueConflicts.length > 0) {
          toast(`${result.leagueConflicts.length} date(s) skipped — league match conflict`, 'error');
        }
        renderSchedule();
      } catch (err) { toast(err.message, 'error'); }
    } else {
      try {
        const newBooking = await window.api.addBooking(bookingData);
        if (newBooking?.id) _pushUndo({ type: 'delete-ids', ids: [newBooking.id] });
        modal.close();
        state.scheduleDate = date;
        toast(isMulti && courtIds?.length > 1 ? `${courtIds.length} courts booked` : 'Booking added');
        renderSchedule();
      } catch (err) { toast(err.message, 'error'); }
    }
  });
}

// ===== EDIT BOOKING MODAL =====
async function openEditBookingModal(slot, courts, slots) {
  const [bookingTypes, allPlayers] = await Promise.all([
    window.api.getBookingTypes(),
    window.api.getPlayers(),
  ]);

  const slotCourts = slot.courtIds
    ? slot.courtIds.map((id) => courts.find((c) => c.id === id)).filter(Boolean)
    : [courts.find((c) => c.id === slot.courtId)].filter(Boolean);
  const courtLabel = slotCourts.length > 1 ? 'Courts' : 'Court';
  const courtNames = slotCourts.map((c) => c.name).join(', ');
  const courtIdSet = new Set(slotCourts.map((c) => c.id));

  const repeatDeleteHTML = slot.repeatGroupId
    ? `<div id="deleteScope" class="bk-delete-scope" style="display:none">
        <p class="bk-delete-scope-label">Delete which events?</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-danger btn-sm" id="btnDelThis">This event</button>
          <button type="button" class="btn btn-danger btn-sm" id="btnDelFuture">This &amp; all future</button>
          <button type="button" class="btn btn-danger btn-sm" id="btnDelAll">All events</button>
          <button type="button" class="btn btn-ghost btn-sm" id="btnDelCancel">Cancel</button>
        </div>
      </div>`
    : '';

  modal.open('Edit Booking', `
    <form id="bookingForm">
      <div class="form-group">
        <label class="form-label">${courtLabel}</label>
        <div class="form-control-static">${esc(courtNames)}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Date</label>
        <input type="date" class="form-control" id="fBookingDate" value="${esc(slot.date || state.scheduleDate)}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Start Time</label>
          <input type="time" class="form-control" id="fBookingTime" value="${esc(slot.startTime)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Duration</label>
          <select class="form-control" id="fBookingDuration">${durationOptions(slot.durationMinutes, slot.startTime)}</select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Name</label>
        <input type="text" class="form-control" id="fBookingName" value="${esc(slot.name || '')}" placeholder="e.g. Training, Open Play…" maxlength="80">
      </div>
      <div class="form-group">
        <label class="form-label">Booking Type</label>
        <select class="form-control" id="fBookingType">
          <option value="">— None —</option>
          ${bookingTypes.map((bt) => `<option value="${bt.id}"${slot.bookingTypeId === bt.id ? ' selected' : ''}>${esc(bt.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Players <span class="form-hint">(up to 4)</span></label>
        <div class="bk-player-wrap">
          <input type="text" class="form-control" id="fPlayerSearch" placeholder="Search players…" autocomplete="off">
          <ul id="fPlayerSuggestions" class="bk-player-drop" style="display:none"></ul>
          <div id="fPlayerChips" class="bk-player-chips"></div>
        </div>
      </div>
      <div class="form-actions">
        <div>
          <button type="button" class="btn btn-danger" id="btnDeleteBooking">Delete</button>
          ${repeatDeleteHTML}
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </div>
    </form>
  `, { medium: true });

  // ---- Player state (pre-populate from slot) ----
  let selectedPlayers = (slot.players || []).map((p) => ({ id: p.id, name: p.name }));

  function renderChips() {
    const container = document.getElementById('fPlayerChips');
    if (!container) return;
    container.innerHTML = selectedPlayers.map((p) =>
      `<div class="bk-chip">${esc(p.name)}<button type="button" class="bk-chip-remove" data-pid="${p.id}" aria-label="Remove">×</button></div>`
    ).join('');
    container.querySelectorAll('.bk-chip-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedPlayers = selectedPlayers.filter((p) => p.id !== Number(btn.dataset.pid));
        renderChips();
        const searchEl = document.getElementById('fPlayerSearch');
        if (searchEl) searchEl.disabled = false;
      });
    });
    const searchEl = document.getElementById('fPlayerSearch');
    if (searchEl) searchEl.disabled = selectedPlayers.length >= 4;
  }
  renderChips();

  function showSuggestions(query) {
    const suggestEl = document.getElementById('fPlayerSuggestions');
    if (!suggestEl) return;
    if (!query.trim() || selectedPlayers.length >= 4) { suggestEl.style.display = 'none'; return; }
    const q = query.toLowerCase();
    const matches = allPlayers.filter((p) =>
      p.name.toLowerCase().includes(q) && !selectedPlayers.some((sp) => sp.id === p.id)
    ).slice(0, 8);
    if (!matches.length) { suggestEl.style.display = 'none'; return; }
    suggestEl.innerHTML = matches.map((p) =>
      `<li class="bk-player-opt" data-pid="${p.id}" data-pname="${esc(p.name)}">${esc(p.name)}</li>`
    ).join('');
    suggestEl.style.display = 'block';
    suggestEl.querySelectorAll('.bk-player-opt').forEach((li) => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (selectedPlayers.length < 4 && !selectedPlayers.some((sp) => sp.id === Number(li.dataset.pid))) {
          selectedPlayers.push({ id: Number(li.dataset.pid), name: li.dataset.pname });
          renderChips();
        }
        const searchEl = document.getElementById('fPlayerSearch');
        if (searchEl) searchEl.value = '';
        suggestEl.style.display = 'none';
      });
    });
  }

  const searchEl = document.getElementById('fPlayerSearch');
  searchEl?.addEventListener('input', (e) => showSuggestions(e.target.value));
  searchEl?.addEventListener('focus', (e) => showSuggestions(e.target.value));
  searchEl?.addEventListener('blur', () => setTimeout(() => {
    const suggestEl = document.getElementById('fPlayerSuggestions');
    if (suggestEl) suggestEl.style.display = 'none';
  }, 150));

  // ---- Duration refresh ----
  function refreshEditDurations() {
    const durEl = document.getElementById('fBookingDuration');
    const timeStr = document.getElementById('fBookingTime')?.value || slot.startTime;
    const dateVal = document.getElementById('fBookingDate')?.value;
    durEl.innerHTML = durationOptions(Number(durEl.value), timeStr);
    if (dateVal === state.scheduleDate && slots) {
      const startMin = _tToMin(timeStr);
      Array.from(durEl.options).forEach((opt) => {
        opt.disabled = slots.some((s) => {
          if (s.id === slot.id) return false;
          const sCourts = s.courtIds || [s.courtId];
          return sCourts.some((id) => courtIdSet.has(id)) && _overlaps(startMin, Number(opt.value), _tToMin(s.startTime), s.durationMinutes);
        });
      });
    }
  }
  document.getElementById('fBookingTime')?.addEventListener('change', refreshEditDurations);
  document.getElementById('fBookingDate')?.addEventListener('change', refreshEditDurations);
  refreshEditDurations();

  // ---- Delete ----
  document.getElementById('btnDeleteBooking').addEventListener('click', () => {
    if (slot.repeatGroupId) {
      const scopeEl = document.getElementById('deleteScope');
      if (scopeEl) scopeEl.style.display = scopeEl.style.display === 'none' ? 'block' : 'none';
    } else {
      if (!confirm('Delete this booking?')) return;
      _doDelete();
    }
  });

  async function _doDelete(opts) {
    try {
      await window.api.deleteBooking(slot.id, opts);
      modal.close();
      toast('Booking deleted');
      renderSchedule();
    } catch (err) { toast(err.message, 'error'); }
  }

  if (slot.repeatGroupId) {
    document.getElementById('btnDelThis')?.addEventListener('click', () => _doDelete());
    document.getElementById('btnDelFuture')?.addEventListener('click', () =>
      _doDelete({ scope: 'future', groupId: slot.repeatGroupId, date: slot.date || state.scheduleDate })
    );
    document.getElementById('btnDelAll')?.addEventListener('click', () =>
      _doDelete({ scope: 'all', groupId: slot.repeatGroupId })
    );
    document.getElementById('btnDelCancel')?.addEventListener('click', () => {
      const scopeEl = document.getElementById('deleteScope');
      if (scopeEl) scopeEl.style.display = 'none';
    });
  }

  // ---- Save ----
  document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = document.getElementById('fBookingDate').value;
    const startTime = document.getElementById('fBookingTime').value;
    const durationMinutes = Number(document.getElementById('fBookingDuration').value);
    const bookingTypeId = document.getElementById('fBookingType').value ? Number(document.getElementById('fBookingType').value) : null;
    const name = document.getElementById('fBookingName').value.trim() || null;
    const playerIds = selectedPlayers.map((p) => p.id);
    try {
      await window.api.updateBooking(slot.id, { date, startTime, durationMinutes, bookingTypeId, name, info: slot.info || null, playerIds });
      modal.close();
      state.scheduleDate = date;
      toast('Booking updated');
      renderSchedule();
    } catch (err) { toast(err.message, 'error'); }
  });
}
