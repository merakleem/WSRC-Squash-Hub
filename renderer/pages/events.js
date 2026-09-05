import { state, isAdmin } from '../state.js';
import { esc, toast } from '../utils.js';

// ===== EVENTS =====
// Club happenings members sign up for. One list, one detail column: socials,
// open days, and registration events that point at a league or tournament so
// signing up for those starts in the same place as everything else.
//
// Vocabulary is fixed: Sign up / Signed up / Withdraw. Capacity counts members
// and their guests together; the server owns the arithmetic and this page
// mirrors it by disabling what would not fit.

let ev = {};
let _instance = 0;

const _MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function _d(dateStr) {
  return new Date(dateStr + 'T12:00:00');
}
function _todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// "7:00 pm" from "19:00".
function _time12(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
// "Fri 18 Sep · 7:00 pm" for cards.
function _when(e) {
  const d = _d(e.event_date);
  const base = `${_DAYS_SHORT[d.getDay()]} ${d.getDate()} ${_MONTHS_SHORT[d.getMonth()]}`;
  return e.start_time ? `${base} · ${_time12(e.start_time)}` : base;
}
// "Thu 15 Oct 2026 · 6:30 pm" for the hero.
function _whenLong(e) {
  const d = _d(e.event_date);
  const base = `${_DAYS_SHORT[d.getDay()]} ${d.getDate()} ${_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  return e.start_time ? `${base} · ${_time12(e.start_time)}` : base;
}
function _monthKey(e) {
  const d = _d(e.event_date);
  return `${_MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}
function _isPastEvent(e) {
  return e.event_date < _todayIso();
}

// One status pill per event, in priority order.
function _pill(e) {
  if (_isPastEvent(e) && e.my_signup) return { label: 'You went', cls: 'green' };
  if (_isPastEvent(e)) return { label: 'Past', cls: 'grey' };
  if (e.my_signup) return { label: 'Signed up', cls: 'green' };
  if (e.full) return { label: 'Full', cls: 'grey' };
  return { label: 'Open', cls: 'blue' };
}

function _attendWord(e) {
  if (e.link?.type === 'league') return 'registered';
  return _isPastEvent(e) ? 'attended' : 'attending';
}

const _TINTS = ['#e2e6ee', '#d8dff0', '#cdd6ec'];
function _avatarStack(e, cls) {
  const faces = [];
  if (e.my_signup) faces.push({ initials: 'ME', me: true });
  for (const p of e.preview || []) faces.push({ initials: p.initials, me: false });
  return faces.slice(0, 3).map((f, i) => `<span class="ev-av ${cls}${f.me ? ' ev-av--me' : ''}"
    style="${f.me ? '' : `background:${_TINTS[i % _TINTS.length]}`}">${esc(f.initials)}</span>`).join('');
}

function _typeChip(link, hero) {
  if (!link) return '';
  return `<span class="ev-chip${hero ? ' ev-chip--hero' : ` ev-chip--${link.type}`}">${esc(link.type)}</span>`;
}

function _spotsLine(e) {
  if (_isPastEvent(e)) return '';
  if (e.max_people == null) return 'No limit';
  if (e.full) return `${e.max_people} of ${e.max_people}`;
  return `${e.spots_left} spots left`;
}

// ── Entry ─────────────────────────────────────────────────────────────────────
export function renderEvents() {
  _instance++;
  ev = {
    tab: 'upcoming',
    events: [],
    selectedId: null,
    detail: null,
    rosterOpen: false,
    pendingGuests: 0,
    view: 'list',            // mobile: 'list' | 'detail'
    modal: null,             // null | {mode:'create'} | {mode:'edit', id}
    form: null,
    linkQuery: '',
    linkResults: [],
    confirmDelete: false,
    busy: false,
    status: 'loading',
  };

  document.getElementById('pageTitle').textContent = 'Events';
  const content = document.getElementById('mainContent');
  content.classList.add('content--flush');
  content.innerHTML = '<div class="ev-page"><div class="modal-loading">Loading events…</div></div>';

  _load(true);
}

async function _load(selectFirst = false) {
  const my = _instance;
  try {
    ev.events = await window.api.getEvents(ev.tab);
    ev.status = 'ready';
  } catch (e) {
    if (_instance !== my) return;
    ev.status = 'error';
    _paint();
    return;
  }
  if (_instance !== my) return;
  if (selectFirst || (ev.selectedId != null && !ev.events.some((e) => e.id === ev.selectedId))) {
    ev.selectedId = ev.events[0]?.id ?? null;
  }
  if (ev.selectedId != null) await _loadDetail();
  else ev.detail = null;
  if (_instance !== my) return;
  _paint();
}

async function _loadDetail() {
  const my = _instance;
  try {
    ev.detail = ev.selectedId != null ? await window.api.getEvent(ev.selectedId) : null;
  } catch (e) {
    if (_instance === my) ev.detail = null;
  }
}

async function _select(id) {
  ev.selectedId = id;
  ev.rosterOpen = false;
  ev.pendingGuests = 0;
  ev.view = 'detail';
  await _loadDetail();
  _paint();
}

// A write landed (or failed as 409): both columns re-read so counts, pills and
// the avatar stacks all agree with the server again.
async function _refresh() {
  const my = _instance;
  try { ev.events = await window.api.getEvents(ev.tab); } catch (_) {}
  await _loadDetail();
  if (_instance === my) _paint();
}

// ── Top bar ───────────────────────────────────────────────────────────────────
function _topbarHTML() {
  const n = ev.events.length;
  return `
    <span class="ev-count">${n} ${ev.tab === 'past' ? 'past' : 'upcoming'}</span>
    ${isAdmin() ? `
      <button class="ev-new-btn" id="evNew">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        New event
      </button>` : ''}`;
}

// ── List column ───────────────────────────────────────────────────────────────
function _cardHTML(e) {
  const d = _d(e.event_date);
  const p = _pill(e);
  const sel = e.id === ev.selectedId;
  return `
    <div class="ev-card${sel ? ' ev-card--sel' : ''}" data-ev="${e.id}">
      <div class="ev-date">
        <span class="ev-date-dow">${_DAYS_SHORT[d.getDay()].toUpperCase()}</span>
        <span class="ev-date-day">${d.getDate()}</span>
      </div>
      <div class="ev-card-mid">
        <span class="ev-card-name">${esc(e.name)}</span>
        <div class="ev-card-meta">${_typeChip(e.link, false)}<span class="ev-card-when">${esc(_when(e))}</span></div>
        <div class="ev-card-people">
          <div class="ev-avs">${_avatarStack(e, 'ev-av--card')}</div>
          <span class="ev-card-count">${e.total} ${_attendWord(e)}</span>
        </div>
      </div>
      <div class="ev-card-right">
        <span class="ev-pill ev-pill--${p.cls}">${p.label}</span>
        <span class="ev-card-spots">${_spotsLine(e)}</span>
      </div>
      <svg class="ev-card-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
    </div>`;
}

function _listHTML() {
  const groups = [];
  for (const e of ev.events) {
    const key = _monthKey(e);
    let g = groups[groups.length - 1];
    if (!g || g.month !== key) { g = { month: key, events: [] }; groups.push(g); }
    g.events.push(e);
  }
  const cards = groups.map((g) => `
    <span class="ev-month">${esc(g.month)}</span>
    ${g.events.map(_cardHTML).join('')}`).join('');
  return `
    <div class="ev-list-col">
      <div class="ev-tabs">
        <button class="ev-tab${ev.tab === 'upcoming' ? ' ev-tab--on' : ''}" data-tab="upcoming">Upcoming</button>
        <button class="ev-tab${ev.tab === 'past' ? ' ev-tab--on' : ''}" data-tab="past">Past</button>
      </div>
      ${ev.events.length ? cards : `<div class="ev-empty">No ${ev.tab === 'past' ? 'past' : 'upcoming'} events${isAdmin() && ev.tab === 'upcoming' ? ' — create one with New event.' : '.'}</div>`}
    </div>`;
}

// ── Detail column ─────────────────────────────────────────────────────────────
function _heroHTML(e) {
  const p = _pill(e);
  return `
    <div class="ev-hero">
      <div class="ev-hero-top">
        <span class="ev-pill ev-pill--hero-${p.cls}">${p.label}</span>
        ${_typeChip(e.link, true)}
        <span class="ev-spacer"></span>
        ${isAdmin() ? `
          <button class="ev-hero-edit" id="evEdit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 00-3-3L5 17v3zM13.5 6.5l3 3"/></svg>
            Edit
          </button>` : ''}
      </div>
      <span class="ev-hero-name">${esc(e.name)}</span>
      <span class="ev-hero-when">${esc(_whenLong(e))}</span>
      ${e.description?.trim() ? `<span class="ev-hero-desc">${esc(e.description)}</span>` : ''}
      ${e.link ? `
        <button class="ev-hero-link" id="evGoLink">
          <span>Go to ${esc(e.link.type)} · ${esc(e.link.name)}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>` : ''}
    </div>`;
}

function _factsHTML(e) {
  const pct = e.max_people == null ? 0 : Math.min(100, Math.round((e.total / e.max_people) * 100));
  const capacityLine = e.max_people == null ? 'No limit' : (e.full ? 'Full' : `${e.spots_left} spots left of ${e.max_people}`);
  const breakdown = `${e.members_count} member${e.members_count === 1 ? '' : 's'}`
    + (e.guests_count ? ` + ${e.guests_count} guest${e.guests_count === 1 ? '' : 's'}` : '');
  return `
    <div class="ev-facts">
      <div class="ev-facts-main">
        <div class="ev-facts-head">
          <span class="ev-label">Attending</span>
          <span class="ev-facts-cap">${esc(capacityLine)}</span>
        </div>
        <div class="ev-facts-nrow">
          <span class="ev-facts-n">${e.total}</span>
          <span class="ev-facts-breakdown">${esc(breakdown)}</span>
        </div>
        ${e.max_people != null && !_isPastEvent(e) ? `
          <div class="ev-bar"><span class="ev-bar-fill${e.full ? ' ev-bar-fill--full' : ''}" style="width:${pct}%"></span></div>` : ''}
      </div>
      <div class="ev-facts-rows">
        <div class="ev-facts-row"><span>Guests</span><b>${e.guests_allowed === 0 ? 'Not allowed' : `Up to ${e.guests_allowed} per member`}</b></div>
        <div class="ev-facts-row"><span>Capacity</span><b>${e.max_people == null ? 'No limit' : `${e.max_people} people`}</b></div>
      </div>
    </div>`;
}

function _actionHTML(e) {
  // Admins manage; only members sign up. Past events take no action at all.
  if (isAdmin() || _isPastEvent(e) || state.currentUser?.playerId == null) return '';
  const signedUp = !!e.my_signup;
  const myGuests = e.my_signup?.guests ?? 0;
  const shown = signedUp ? myGuests : ev.pendingGuests;
  const canJoin = !signedUp && !e.full && (e.spots_left == null || e.spots_left >= 1 + ev.pendingGuests);
  const canInc = shown < e.guests_allowed
    && (e.spots_left == null || (signedUp ? e.spots_left >= 1 : e.spots_left >= 2 + ev.pendingGuests));
  const showStepper = e.guests_allowed > 0 && (signedUp || !e.full);
  const btnLabel = e.full ? 'Event is full' : (ev.pendingGuests ? `Sign up · you + ${ev.pendingGuests}` : 'Sign up');
  return `
    <div class="ev-action${signedUp ? ' ev-action--in' : ''}">
      ${showStepper ? `
        <div class="ev-guestrow">
          <div class="ev-guestrow-text">
            <span class="ev-guestrow-q">Bringing guests?</span>
            <span class="ev-guestrow-hint">Up to ${e.guests_allowed} · counts toward capacity</span>
          </div>
          <div class="ev-stepper">
            <button class="ev-step" id="evGuestDown"${shown > 0 ? '' : ' disabled'}>−</button>
            <span class="ev-step-n">${shown}</span>
            <button class="ev-step" id="evGuestUp"${canInc ? '' : ' disabled'}>+</button>
          </div>
        </div>` : ''}
      ${signedUp ? `
        <div class="ev-signed">
          <span class="ev-signed-check"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg></span>
          <div class="ev-signed-text">
            <span class="ev-signed-title">You're signed up</span>
            <span class="ev-signed-sub">${myGuests ? `You + ${myGuests} guest${myGuests === 1 ? '' : 's'}` : 'Just you'}</span>
          </div>
          <button class="ev-withdraw" id="evWithdraw">Withdraw</button>
        </div>` : `
        <button class="ev-signup" id="evSignUp"${canJoin ? '' : ' disabled'}>${btnLabel}</button>`}
    </div>`;
}

function _rosterHTML(e) {
  const admin = isAdmin();
  const myId = state.currentUser?.playerId;
  const rows = [];
  const mine = (e.attendees || []).find((a) => a.player_id === myId);
  if (mine) rows.push({ ...mine, isMe: true });
  for (const a of e.attendees || []) if (a.player_id !== myId) rows.push({ ...a, isMe: false });

  const LIMIT = 6;
  const shown = ev.rosterOpen ? rows : rows.slice(0, LIMIT);
  const gLabel = (n) => (n === 0 ? '—' : `${n} guest${n === 1 ? '' : 's'}`);
  const rowsHTML = shown.map((a) => `
    <div class="ev-row${a.isMe ? ' ev-row--me' : ''}${admin ? ' ev-row--admin' : ''}">
      <span class="ev-av ev-av--row${a.isMe ? ' ev-av--me' : ''}">${esc(a.isMe ? 'ME' : a.initials)}</span>
      <span class="ev-row-name">${esc(a.isMe ? 'You' : a.name)}</span>
      ${admin ? `<span class="ev-row-no">${esc(a.member_number || '')}</span>` : ''}
      <span class="ev-row-guests${a.guests ? '' : ' ev-row-guests--none'}${a.isMe ? ' ev-row-guests--me' : ''}">${gLabel(a.guests)}</span>
      ${admin ? `<button class="ev-row-x" data-remove="${a.player_id}" title="Remove from event">×</button>` : ''}
    </div>`).join('');

  const countText = `${e.members_count} member${e.members_count === 1 ? '' : 's'}`
    + (e.guests_count ? ` · ${e.guests_count} guest${e.guests_count === 1 ? '' : 's'}` : '');

  return `
    <div class="ev-roster">
      <div class="ev-roster-head">
        <span class="ev-label">Who's going</span>
        <span class="ev-roster-count">${esc(countText)}</span>
      </div>
      ${admin && rows.length ? `
        <div class="ev-roster-cols">
          <span></span><span>MEMBER</span><span>NO.</span><span class="ev-roster-cols-g">GUESTS</span><span></span>
        </div>` : ''}
      ${rowsHTML || '<div class="ev-roster-none">No one yet.</div>'}
      ${rows.length > LIMIT ? `
        <button class="ev-roster-more" id="evRosterToggle">${ev.rosterOpen ? 'Show fewer' : `Show all ${rows.length}`}</button>` : ''}
      ${admin ? `
        <div class="ev-roster-foot">
          <span class="ev-chip ev-chip--league">ADMIN</span>
          <span class="ev-spacer"></span>
          <button class="ev-print" id="evPrintBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v7H6z"/></svg>
            Print
          </button>
          <button class="ev-export" id="evExportBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 3v12M7 10l5 5 5-5M4 19h16"/></svg>
            Export CSV
          </button>
        </div>` : ''}
    </div>`;
}

function _detailHTML() {
  const e = ev.detail;
  if (!e) return `<div class="ev-detail-col"><div class="ev-empty">Select an event.</div></div>`;
  return `
    <div class="ev-detail-col">
      <button class="ev-back" id="evBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 6l-6 6 6 6"/></svg>
        Events
      </button>
      ${_heroHTML(e)}
      ${_factsHTML(e)}
      ${_actionHTML(e)}
      ${_rosterHTML(e)}
    </div>`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function _modalHTML() {
  if (!ev.modal) return '';
  const f = ev.form;
  const editing = ev.modal.mode === 'edit';
  const valid = f.name.trim() && f.date;
  const linked = f.linked;
  return `
    <div class="ev-overlay" id="evOverlay">
      <div class="ev-modal" id="evModal">
        <div class="ev-modal-head">
          <span class="ev-modal-title">${editing ? 'Edit event' : 'New event'}</span>
          <button class="ev-modal-x" id="evModalClose">×</button>
        </div>
        <div class="ev-modal-body">
          <label class="ev-field">
            <span>Name</span>
            <input class="ev-input" id="evfName" type="text" placeholder="e.g. Back to the Bunker" value="${esc(f.name)}">
          </label>
          <label class="ev-field">
            <span>Description</span>
            <textarea class="ev-input ev-input--area" id="evfDesc" rows="3" placeholder="What is it, where to meet, what to bring…">${esc(f.description)}</textarea>
          </label>
          <div class="ev-field-cols">
            <label class="ev-field">
              <span>Date</span>
              <input class="ev-input" id="evfDate" type="date" value="${esc(f.date)}">
            </label>
            <label class="ev-field">
              <span>Start time <i class="ev-optional">(optional)</i></span>
              <input class="ev-input" id="evfTime" type="time" value="${esc(f.time)}">
            </label>
          </div>
          <div class="ev-field-cols">
            <label class="ev-field">
              <span>Guests allowed</span>
              <input class="ev-input${linked ? ' ev-input--off' : ''}" id="evfGuests" type="number" min="0" value="${esc(String(f.guests))}"${linked ? ' disabled' : ''}>
              <em>${linked ? 'No guests for a league or tournament.' : 'Per member. 0 = no guests.'}</em>
            </label>
            <label class="ev-field">
              <span>Max people</span>
              <input class="ev-input" id="evfMax" type="number" min="1" placeholder="No limit" value="${esc(f.max)}">
              <em>Members + guests. Blank = no limit.</em>
            </label>
          </div>
          <div class="ev-field">
            <span>Link to a league or tournament <i class="ev-optional">(optional)</i></span>
            ${linked ? `
              <div class="ev-linked">
                <span class="ev-chip ev-chip--${linked.type}">${esc(linked.type)}</span>
                <span class="ev-linked-name">${esc(linked.name)}</span>
                <button class="ev-linked-x" id="evLinkClear">×</button>
              </div>` : `
              <div class="ev-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
                <input class="ev-input ev-input--search" id="evfLink" type="text" placeholder="Search leagues and tournaments…" value="${esc(ev.linkQuery)}" autocomplete="off">
                ${ev.linkQuery.trim() ? `
                  <div class="ev-search-drop" id="evLinkDrop">
                    ${ev.linkResults.length ? ev.linkResults.map((l, i) => `
                      <button class="ev-search-row" data-link="${i}">
                        <span class="ev-chip ev-chip--${l.type}">${esc(l.type)}</span>
                        <span class="ev-search-name">${esc(l.name)}</span>
                        <span class="ev-search-meta">${esc(l.meta || '')}</span>
                      </button>`).join('') : '<span class="ev-search-none">No matches</span>'}
                  </div>` : ''}
              </div>`}
            <em>Players sign up here; the event detail gets a "Go to league / tournament" button.</em>
          </div>
        </div>
        <div class="ev-modal-foot">
          ${editing ? `<button class="ev-del${ev.confirmDelete ? ' ev-del--confirm' : ''}" id="evDelete">${ev.confirmDelete ? 'Confirm delete' : 'Delete event'}</button>` : ''}
          <span class="ev-spacer"></span>
          <button class="ev-cancel" id="evCancel">Cancel</button>
          <button class="ev-save" id="evSave"${valid && !ev.busy ? '' : ' disabled'}>${editing ? 'Save changes' : 'Create event'}</button>
        </div>
      </div>
    </div>`;
}

// ── Paint & wire ──────────────────────────────────────────────────────────────
function _paint() {
  const content = document.getElementById('mainContent');
  if (!content) return;

  document.getElementById('topbarActions').innerHTML = _topbarHTML();

  if (ev.status === 'error') {
    content.innerHTML = '<div class="ev-page"><div class="ev-empty">Couldn\'t load events. Please try again.</div></div>';
    return;
  }

  const listEl = content.querySelector('.ev-list-col');
  const listScroll = listEl ? listEl.scrollTop : 0;

  content.innerHTML = `
    <div class="ev-page${ev.view === 'detail' ? ' ev-page--detail' : ''}">
      <div class="ev-cols">
        ${_listHTML()}
        <div class="ev-detail-well">${_detailHTML()}</div>
      </div>
      ${_modalHTML()}
    </div>`;

  const newList = content.querySelector('.ev-list-col');
  if (newList) newList.scrollTop = listScroll;

  _wire(content);
}

function _wire(content) {
  document.getElementById('evNew')?.addEventListener('click', () => _openModal('create'));

  content.querySelectorAll('.ev-tab').forEach((b) => b.addEventListener('click', () => {
    if (ev.tab === b.dataset.tab) return;
    ev.tab = b.dataset.tab;
    ev.rosterOpen = false;
    ev.pendingGuests = 0;
    _load(true);
  }));

  content.querySelectorAll('[data-ev]').forEach((c) => c.addEventListener('click', () => _select(Number(c.dataset.ev))));
  document.getElementById('evBack')?.addEventListener('click', () => { ev.view = 'list'; _paint(); });

  document.getElementById('evEdit')?.addEventListener('click', () => _openModal('edit'));
  document.getElementById('evGoLink')?.addEventListener('click', () => {
    const link = ev.detail?.link;
    if (!link) return;
    if (link.type === 'league') window.navigate('leagueDetail', { league: { id: link.id, name: link.name } });
    else window.navigate('tournamentDetail', { tournamentId: link.id });
  });

  // ---- sign up / guests / withdraw ----
  const e = ev.detail;
  document.getElementById('evSignUp')?.addEventListener('click', async () => {
    if (ev.busy) return;
    ev.busy = true;
    try {
      await window.api.signUpForEvent(e.id, { guests: ev.pendingGuests });
      ev.pendingGuests = 0;
    } catch (err) {
      toast(err.message || 'Could not sign up.', 'error');
    }
    ev.busy = false;
    _refresh();
  });
  document.getElementById('evWithdraw')?.addEventListener('click', async () => {
    if (ev.busy) return;
    ev.busy = true;
    try { await window.api.withdrawFromEvent(e.id); }
    catch (err) { toast(err.message, 'error'); }
    ev.busy = false;
    _refresh();
  });
  const stepGuests = async (delta) => {
    if (ev.busy) return;
    if (e.my_signup) {
      ev.busy = true;
      try { await window.api.updateEventSignup(e.id, { guests: (e.my_signup.guests || 0) + delta }); }
      catch (err) { toast(err.message, 'error'); }
      ev.busy = false;
      _refresh();
    } else {
      ev.pendingGuests = Math.max(0, ev.pendingGuests + delta);
      _paint();
    }
  };
  document.getElementById('evGuestUp')?.addEventListener('click', () => stepGuests(1));
  document.getElementById('evGuestDown')?.addEventListener('click', () => stepGuests(-1));

  // ---- roster ----
  document.getElementById('evRosterToggle')?.addEventListener('click', () => {
    ev.rosterOpen = !ev.rosterOpen;
    _paint();
  });
  content.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async (evt) => {
    evt.stopPropagation();
    try { await window.api.removeEventAttendee(e.id, Number(b.dataset.remove)); }
    catch (err) { toast(err.message, 'error'); }
    _refresh();
  }));
  document.getElementById('evExportBtn')?.addEventListener('click', () => {
    window.open(`/api/events/${e.id}/export.csv`);
  });
  document.getElementById('evPrintBtn')?.addEventListener('click', () => _print(e));

  _wireModal(content);
}

// A print-friendly attendee list: a dedicated node on <body>, shown only by
// the @media print rules, removed as soon as the dialog closes.
function _print(e) {
  document.getElementById('evPrint')?.remove();
  const rows = (e.attendees || []).map((a) => `
    <tr><td>${esc(a.name)}</td><td>${esc(a.member_number || '')}</td><td>${a.guests || 0}</td></tr>`).join('');
  const el = document.createElement('div');
  el.id = 'evPrint';
  el.innerHTML = `
    <h1>${esc(e.name)}</h1>
    <p>${esc(_whenLong(e))} · ${e.total} attending (${e.members_count} members, ${e.guests_count} guests)</p>
    <table><thead><tr><th>Member</th><th>No.</th><th>Guests</th></tr></thead><tbody>${rows}</tbody></table>`;
  document.body.appendChild(el);
  document.body.classList.add('ev-printing');
  const cleanup = () => {
    document.body.classList.remove('ev-printing');
    el.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

// ---- modal ----
function _openModal(mode) {
  const e = ev.detail;
  ev.confirmDelete = false;
  ev.linkQuery = '';
  ev.linkResults = [];
  if (mode === 'edit' && e) {
    ev.modal = { mode: 'edit', id: e.id };
    ev.form = {
      name: e.name, description: e.description || '', date: e.event_date,
      time: e.start_time || '', guests: e.guests_allowed, max: e.max_people == null ? '' : String(e.max_people),
      linked: e.link ? { ...e.link } : null,
    };
  } else {
    ev.modal = { mode: 'create' };
    ev.form = { name: '', description: '', date: '', time: '', guests: 0, max: '', linked: null };
  }
  _paint();
  document.getElementById('evfName')?.focus();
}

function _closeModal() {
  ev.modal = null;
  ev.form = null;
  ev.confirmDelete = false;
  _paint();
}

function _wireModal(content) {
  if (!ev.modal) return;
  const f = ev.form;

  document.getElementById('evOverlay')?.addEventListener('click', (evt) => {
    if (evt.target.id === 'evOverlay') _closeModal();
  });
  document.getElementById('evModalClose')?.addEventListener('click', _closeModal);
  document.getElementById('evCancel')?.addEventListener('click', _closeModal);

  // Text inputs update state without repainting, so the caret stays put; the
  // save button's enabled state is the one thing that follows along.
  const bind = (id, key) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => {
      f[key] = el.value;
      const save = document.getElementById('evSave');
      if (save) save.disabled = !(f.name.trim() && f.date) || ev.busy;
    });
  };
  bind('evfName', 'name');
  bind('evfDesc', 'description');
  bind('evfDate', 'date');
  bind('evfTime', 'time');
  bind('evfGuests', 'guests');
  bind('evfMax', 'max');

  const linkInput = document.getElementById('evfLink');
  let searchSeq = 0;
  linkInput?.addEventListener('input', async () => {
    ev.linkQuery = linkInput.value;
    const my = ++searchSeq;
    if (!ev.linkQuery.trim()) { ev.linkResults = []; _paintModalOnly(); return; }
    try {
      const results = await window.api.searchLinkables(ev.linkQuery);
      if (my !== searchSeq) return;
      ev.linkResults = results;
    } catch (_) { ev.linkResults = []; }
    _paintModalOnly();
  });
  content.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', () => {
    const l = ev.linkResults[Number(b.dataset.link)];
    if (!l) return;
    f.linked = { type: l.type, id: l.id, name: l.name };
    f.guests = 0;
    ev.linkQuery = '';
    ev.linkResults = [];
    _paintModalOnly();
  }));
  document.getElementById('evLinkClear')?.addEventListener('click', () => {
    f.linked = null;
    _paintModalOnly();
  });

  document.getElementById('evDelete')?.addEventListener('click', async () => {
    if (!ev.confirmDelete) { ev.confirmDelete = true; _paintModalOnly(); return; }
    try { await window.api.deleteEvent(ev.modal.id); }
    catch (err) { toast(err.message, 'error'); return; }
    ev.modal = null;
    ev.form = null;
    _load(true);
  });

  document.getElementById('evSave')?.addEventListener('click', async () => {
    if (ev.busy || !(f.name.trim() && f.date)) return;
    ev.busy = true;
    const body = {
      name: f.name.trim(),
      description: f.description,
      event_date: f.date,
      start_time: f.time || null,
      guests_allowed: f.linked ? 0 : Math.max(0, parseInt(f.guests, 10) || 0),
      max_people: f.max === '' ? null : Math.max(1, parseInt(f.max, 10) || 1),
      league_id: f.linked?.type === 'league' ? f.linked.id : null,
      tournament_id: f.linked?.type === 'tournament' ? f.linked.id : null,
    };
    try {
      let saved;
      if (ev.modal.mode === 'edit') saved = await window.api.updateEvent(ev.modal.id, body);
      else saved = await window.api.createEvent(body);
      ev.busy = false;
      ev.modal = null;
      ev.form = null;
      // The list follows the event: the tab switches to whichever side of
      // today the date landed on, and the saved event is selected.
      ev.tab = body.event_date < _todayIso() ? 'past' : 'upcoming';
      ev.selectedId = saved?.id ?? ev.selectedId;
      ev.view = 'detail';
      await _load(false);
    } catch (err) {
      ev.busy = false;
      toast(err.message, 'error');
    }
  });
}

// The modal repaints alone on its internal changes, leaving the page (and any
// half-typed inputs elsewhere) untouched.
function _paintModalOnly() {
  const page = document.querySelector('.ev-page');
  if (!page) return;
  document.getElementById('evOverlay')?.remove();
  page.insertAdjacentHTML('beforeend', _modalHTML());
  _wireModal(page);
  if (ev.linkQuery) {
    const el = document.getElementById('evfLink');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
}
