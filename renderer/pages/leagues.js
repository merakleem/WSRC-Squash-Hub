import { state, isAdmin } from '../state.js';
import { esc, formatShortDate, toast, modal, avatarHTML, playDayNamesLong, playDatesFor, formatWeekRange, DAY_LONG } from '../utils.js';
import { startCreateLeague } from './createLeague.js';

// ===== LEAGUES PAGE =====

// The filter pills are page-local and deliberately not persisted: coming back
// to Leagues always starts on All, so nothing is ever hidden by a choice made
// in a previous visit.
let _filter = 'all';
// Singles / Doubles, alongside the status filter. Same rule: not persisted.
let _format = 'all';

const CAL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
const PEOPLE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

export async function renderLeagues() {
  document.getElementById('topbarActions').innerHTML = isAdmin() ? `
    <button class="btn btn-primary" id="btnCreateLeague">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
      <span class="lgl-new-long">New League</span><span class="lgl-new-short">New</span>
    </button>` : '';

  state.leagues = await window.api.getLeagues();
  const content = document.getElementById('mainContent');

  const upcomingCount = state.leagues.filter((l) => l.status === 'upcoming').length;
  const activeCount = state.leagues.filter((l) => l.status === 'active').length;
  const doneCount = state.leagues.filter((l) => l.status === 'completed').length;
  const counts = [
    upcomingCount ? `${upcomingCount} upcoming` : '',
    `${activeCount} active`,
    `${doneCount} completed`,
  ].filter(Boolean).join(' &middot; ');
  document.getElementById('pageTitle').innerHTML = state.leagues.length === 0
    ? 'Leagues'
    : `Leagues <span class="lgl-count">${counts}</span>`;

  if (state.leagues.length === 0) {
    // The club has no leagues at all, which is a different message from a
    // filter that happens to match nothing.
    content.innerHTML = `
      <div class="table-card">
        <div class="empty-state">
          <strong>No leagues yet</strong>
          <p>${isAdmin() ? 'Create your first league to get started.' : 'No leagues have been created yet.'}</p>
        </div>
      </div>`;
  } else {
    content.innerHTML = `
      <div class="lgl-page">
        <div class="lgl-filters" id="lglFilters">${_filtersHTML()}</div>
        <div class="lgl-groups" id="lglGroups">${_groupsHTML()}</div>
      </div>`;
    _wireFilters();
    _wireCards();
  }

  if (isAdmin()) {
    document.getElementById('btnCreateLeague')?.addEventListener('click', openNewLeagueChoice);
  }
}

const FILTERS = [['all', 'All'], ['upcoming', 'Upcoming'], ['active', 'Active'], ['completed', 'Completed']];
const FORMATS = [['all', 'All formats'], ['singles', 'Singles'], ['doubles', 'Doubles']];

// Status pills, a divider, then the format pills. On a phone the divider and
// "All formats" are dropped and Singles / Doubles act as toggles.
function _filtersHTML() {
  const status = FILTERS.map(([key, label]) =>
    `<button class="lgl-pill${key === _filter ? ' lgl-pill--on' : ''}" data-filter="${key}"
       aria-pressed="${key === _filter}">${label}</button>`).join('');
  const format = FORMATS.map(([key, label]) =>
    `<button class="lgl-pill${key === _format ? ' lgl-pill--on' : ''}" data-format="${key}"
       aria-pressed="${key === _format}">${label}</button>`).join('');
  return `${status}<span class="lgl-divider" aria-hidden="true"></span>${format}`;
}

const _isDoubles = (l) => l.setup_type === 'doubles';

/**
 * The grid, grouped and filtered.
 *
 * Admins see Active / Completed; a player sees My Leagues / Other Leagues, the
 * same split as before. Empty groups are dropped, so a filter narrows the page
 * to the headings that still have cards under them.
 */
function _groupsHTML() {
  const shown = state.leagues
    .filter((l) => _filter === 'all' || l.status === _filter)
    .filter((l) => _format === 'all' || (_format === 'doubles') === _isDoubles(l));

  const playerId = state.currentUser?.playerId;
  const upcoming = shown.filter((l) => l.status === 'upcoming');
  const built = shown.filter((l) => l.status !== 'upcoming');
  const mine = (l) => (l.player_ids || []).includes(playerId) || l.i_signed_up;
  const groups = isAdmin()
    ? [['Upcoming', upcoming],
      ['Active', built.filter((l) => l.status === 'active')],
      ['Completed', built.filter((l) => l.status === 'completed')]]
    // A member's own leagues come first whether they are running or only
    // signed up for; everything still open to join is the next thing they
    // want, and the rest is the archive.
    : [['My Leagues', shown.filter(mine)],
      ['Open for signup', upcoming.filter((l) => !mine(l))],
      ['Other Leagues', built.filter((l) => !mine(l))]];

  const withCards = groups.filter(([, items]) => items.length > 0);
  if (withCards.length === 0) {
    return `
      <div class="lgl-empty">
        <strong>No leagues here</strong>
        <span>Nothing matches this filter.</span>
      </div>`;
  }

  return withCards.map(([label, items]) => `
    <section class="lgl-group">
      <div class="lgl-group-head">
        <span class="lgl-group-label">${label}</span>
        <span class="lgl-group-count">${items.length}</span>
        <span class="lgl-group-rule"></span>
      </div>
      <div class="lgl-grid">${items.map(leagueCardHTML).join('')}</div>
    </section>`).join('');
}

// Dates are read at local noon so a date-only string can't slide into the
// previous day in a timezone behind UTC - the same trick formatShortDate uses.
function _atNoon(dateStr) {
  return dateStr ? new Date(`${String(dateStr).slice(0, 10)}T12:00:00`) : null;
}

/** "Wednesdays" - the day of the week a league is played on, from its start. */
function _weekdayName(dateStr) {
  const d = _atNoon(dateStr);
  return d ? `${d.toLocaleDateString('en-US', { weekday: 'long' })}s` : '';
}

/** "Sep 9" - month and day only, for the week range where the year is implied. */
function _monthDay(dateStr) {
  const d = _atNoon(dateStr);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

// ===== ANNOUNCING A LEAGUE =====
// New League no longer drops straight into the wizard: a league can be built
// now, or announced and left open for members to sign themselves up.

const ANNOUNCE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M16 9a3 3 0 0 1 0 6"/><path d="M19 6a7 7 0 0 1 0 12"/></svg>';
const BUILD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/></svg>';

export function openNewLeagueChoice() {
  modal.open('New league', `
    <div class="lgl-choice">
      <button class="lgl-choice-row" data-choice="announce">
        <span class="lgl-choice-ic lgl-choice-ic--blue">${ANNOUNCE_ICON}</span>
        <span class="lgl-choice-text">
          <b>Announce it for signups</b>
          <i>Members sign up themselves. You build the divisions and fixtures later, from whoever joined.</i>
        </span>
        <svg class="lgl-choice-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
      </button>
      <button class="lgl-choice-row" data-choice="build">
        <span class="lgl-choice-ic">${BUILD_ICON}</span>
        <span class="lgl-choice-text">
          <b>Build it now</b>
          <i>Pick the players yourself and set up divisions, weeks and fixtures in five steps.</i>
        </span>
        <svg class="lgl-choice-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>`);
  document.getElementById('modalBody').querySelectorAll('[data-choice]').forEach((b) => {
    b.addEventListener('click', () => {
      modal.close();
      if (b.dataset.choice === 'build') startCreateLeague();
      else openAnnounceModal();
    });
  });
}

const FORMAT_OPTIONS = [
  ['traditional', 'Teams', 'Players are put into teams when you build.'],
  ['modern', 'Box league', 'Everyone plays everyone in their division. Divisions are set when you build.'],
  ['doubles', 'Doubles', 'People sign up on their own. You pair them when you build.'],
];

function _nextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * The announcement form, for a new league or an edit of one.
 *
 * Six fields: everything a member needs to decide whether to join, and nothing
 * about the schedule, which is not decided until the league is built.
 */
export function openAnnounceModal(league = null) {
  const editing = !!league;
  const f = {
    name: league?.name || '',
    setupType: league?.setup_type || 'modern',
    startDate: league?.start_date || _nextMonday(),
    signupDeadline: league?.signup_deadline || '',
    signupCap: league?.signup_cap ?? '',
    description: league?.description || '',
  };

  modal.open(editing ? 'Edit announcement' : 'Announce a league', `
    <div class="lgl-form">
      <label class="lgl-field"><span>League name</span>
        <input id="anName" value="${esc(f.name)}" placeholder="Autumn Box League" autocomplete="off">
      </label>
      <div class="lgl-field"><span>Format</span>
        <div class="lgl-seg" id="anFormat">
          ${FORMAT_OPTIONS.map(([k, label]) => `<button type="button" class="lgl-seg-b${f.setupType === k ? ' lgl-seg-b--on' : ''}" data-fmt="${k}">${label}</button>`).join('')}
        </div>
        <span class="lgl-help" id="anFormatHelp"></span>
      </div>
      <div class="lgl-row2">
        <label class="lgl-field"><span>Starts</span>
          <input id="anStart" type="date" value="${esc(f.startDate)}">
        </label>
        <label class="lgl-field"><span>Sign up by <i>optional</i></span>
          <input id="anDeadline" type="date" value="${esc(f.signupDeadline)}">
        </label>
      </div>
      <label class="lgl-field"><span>Spots <i>optional</i></span>
        <input id="anCap" type="number" min="2" step="1" value="${esc(String(f.signupCap))}" placeholder="No limit" class="lgl-cap">
        <span class="lgl-help" id="anCapHelp">Leave empty for no limit. Signups close when it fills.</span>
      </label>
      <label class="lgl-field"><span>Description <i>optional</i></span>
        <textarea id="anDesc" rows="3" placeholder="When it runs, who it's for, anything else worth knowing.">${esc(f.description)}</textarea>
      </label>
      <div class="lgl-form-err" id="anErr"></div>
      <div class="lgl-form-foot">
        <span class="lgl-help">${editing ? '' : 'Listed under Upcoming as soon as you announce it.'}</span>
        <button class="btn btn-outline" id="anCancel">Cancel</button>
        <button class="btn btn-primary" id="anSave">${editing ? 'Save changes' : 'Announce league'}</button>
      </div>
    </div>`);

  const help = () => {
    document.getElementById('anFormatHelp').textContent = FORMAT_OPTIONS.find(([k]) => k === f.setupType)[2];
    document.getElementById('anCapHelp').textContent = f.setupType === 'doubles'
      ? 'Leave empty for no limit. Use an even number.'
      : 'Leave empty for no limit. Signups close when it fills.';
  };
  help();
  document.getElementById('anFormat').querySelectorAll('[data-fmt]').forEach((b) => {
    b.addEventListener('click', () => {
      f.setupType = b.dataset.fmt;
      document.getElementById('anFormat').querySelectorAll('[data-fmt]').forEach((x) => x.classList.toggle('lgl-seg-b--on', x === b));
      help();
    });
  });
  document.getElementById('anCancel').addEventListener('click', modal.close);
  document.getElementById('anSave').addEventListener('click', async () => {
    const body = {
      name: document.getElementById('anName').value.trim(),
      setupType: f.setupType,
      startDate: document.getElementById('anStart').value,
      signupDeadline: document.getElementById('anDeadline').value || null,
      signupCap: document.getElementById('anCap').value === '' ? null : Number(document.getElementById('anCap').value),
      description: document.getElementById('anDesc').value.trim(),
    };
    const err = document.getElementById('anErr');
    err.textContent = '';
    const btn = document.getElementById('anSave');
    btn.disabled = true;
    try {
      if (editing) {
        await window.api.editAnnouncement(league.id, body);
        modal.close();
        toast('Announcement updated', 'success');
        const fresh = await window.api.getLeague(league.id);
        window.navigate('leagueDetail', { league: fresh });
      } else {
        const { id } = await window.api.announceLeague(body);
        modal.close();
        toast(`${body.name} announced`, 'success');
        const fresh = await window.api.getLeague(id);
        window.navigate('leagueDetail', { league: fresh });
      }
    } catch (e) {
      err.textContent = e.message || 'Could not save.';
      btn.disabled = false;
    }
  });
}

// ===== UPCOMING LEAGUE CARD =====

const FORMAT_LABEL = { traditional: 'Teams', modern: 'Box league', doubles: 'Doubles' };

/** "Mon 5 Oct" */
function _shortDay(dateStr) {
  const d = _atNoon(dateStr);
  return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
}

/** What the format line says, which differs by who is reading it. */
function _upcomingStructure(league, admin) {
  const fmt = FORMAT_LABEL[league.setup_type] || 'Box league';
  const spots = league.signup_cap != null ? `${league.signup_cap} spots` : 'no limit';
  if (league.setup_type === 'doubles') {
    return admin ? `${fmt} &middot; ${spots} &middot; pairs set at build` : `${fmt} &middot; sign up alone, pairs set later`;
  }
  if (league.setup_type === 'traditional') {
    return admin ? `${fmt} &middot; ${spots}` : `${fmt} &middot; teams set when the league is built`;
  }
  return `${fmt} &middot; ${spots}`;
}

/** The status pill: what a reader most needs to know about this signup. */
function _upcomingPill(league, signedUp) {
  if (signedUp) return ['green', 'Signed up'];
  if (league.full) return ['grey', 'Full'];
  if (league.deadline_passed) return ['amber', 'Signups closed'];
  return ['blue', 'Signups open'];
}

const _fmtDeadline = (d) => `Sign up by ${_shortDay(d)}`;

function _upcomingCardHTML(league) {
  const admin = isAdmin();
  const signedUp = !!league.i_signed_up;
  const [pillCls, pillText] = _upcomingPill(league, signedUp);
  const n = league.signup_count || 0;
  const cap = league.signup_cap ?? null;

  const weekday = _weekdayName(league.start_date);
  // No time: an announced league has not chosen one, and the column's default
  // would tell every member seven in the evening.
  const dateLine = `Starts ${_shortDay(league.start_date)}${weekday ? ` &middot; ${weekday}` : ''}`;

  const faces = (league.signup_preview || []).slice(0, 4);
  const avatars = faces.length
    ? `<span class="lgl-faces">${faces.map((f) => avatarHTML(f, 'lgl-face')).join('')}</span>` : '';
  const countText = cap == null
    ? (n === 0 ? 'No one signed up yet' : `${n} signed up`)
    : (n === 0 ? `No one signed up yet` : `${n} of ${cap} signed up`);
  const rightText = league.deadline_passed ? 'Signups closed'
    : league.signup_deadline ? _fmtDeadline(league.signup_deadline)
    : 'No deadline';

  const bar = cap == null ? '' : `
    <span class="lgl-sbar"><span class="lgl-sbar-fill${league.full ? ' lgl-sbar-fill--full' : ''}" style="width:${Math.min(100, Math.round((n / cap) * 100))}%"></span></span>`;

  const action = admin ? '' : signedUp
    ? '<button class="lgl-act lgl-act--out" data-withdraw>Withdraw</button>'
    : league.full ? '<span class="lgl-act-note">No spots left</span>'
      : league.deadline_passed ? '<span class="lgl-act-note">Schedule coming soon</span>'
        : '<button class="lgl-act lgl-act--in" data-signup>Sign up</button>';

  const footLeft = admin
    ? (league.deadline_passed || league.full
      ? '<span class="lgl-chip lgl-chip--amber">Ready to build</span>'
      : `<span class="lgl-weeks">Announced ${formatShortDate(league.created_at)}</span>`)
    : '<span class="lgl-view lgl-view--left">Details <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></span>';
  const footRight = admin
    ? `<span class="lgl-view">${n < 2 ? 'View signups' : 'Build league'} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></span>`
    : action;

  return `
    <div class="lgl-card lgl-card--upcoming" data-id="${league.id}">
      <div class="lgl-body">
        <div class="lgl-card-head">
          <h3 class="lgl-name">${esc(league.name)}</h3>
          <span class="lgl-badges">
            ${_isDoubles(league) ? '<span class="lgl-fmt">Doubles</span>' : ''}
            <span class="lgl-status lgl-status--${pillCls}">${pillText}</span>
          </span>
        </div>
        <div class="lgl-meta">
          <span class="lgl-meta-row">${CAL_ICON}${dateLine}</span>
          <span class="lgl-meta-row">${PEOPLE_ICON}${_upcomingStructure(league, admin)}</span>
        </div>
        <div class="lgl-signup">
          ${avatars}
          <span class="lgl-signup-line">
            <span class="lgl-signup-n${n ? ' lgl-signup-n--on' : ''}">${countText}</span>
            <span class="lgl-signup-when${league.deadline_passed ? ' lgl-signup-when--closed' : ''}">${rightText}</span>
          </span>
          ${bar}
        </div>
        ${admin ? '' : `<div class="lgl-act-mobile">${action}</div>`}
      </div>
      <div class="lgl-foot">${footLeft}${footRight}</div>
    </div>`;
}

function leagueCardHTML(league) {
  if (league.status === 'upcoming') return _upcomingCardHTML(league);
  const done = league.status === 'completed';
  const playerId = state.currentUser?.playerId;
  const mine = !isAdmin() && playerId != null && (league.player_ids || []).includes(playerId);

  const playerCount = (league.player_ids || []).length;
  const pairCount = league.pair_count ?? Math.floor(playerCount / 2);
  const structure = _isDoubles(league)
    ? `${league.num_divisions} division${league.num_divisions !== 1 ? 's' : ''} &middot; ${pairCount} pair${pairCount !== 1 ? 's' : ''} &middot; ${playerCount} players`
    : league.setup_type === 'modern'
    ? `${league.num_divisions} division${league.num_divisions !== 1 ? 's' : ''} &middot; ${playerCount} players`
    : `${league.num_teams} teams &middot; ${league.num_divisions} divisions &middot; ${league.num_teams * league.num_divisions} players`;

  // "Mondays & Wednesdays" from the league's play days; the start date's
  // weekday for a league from before play days existed.
  const weekday = Array.isArray(league.play_days) && league.play_days.length
    ? playDayNamesLong(league.play_days)
    : _weekdayName(league.start_date);
  const dateLine = `${done ? 'Ran from' : 'Started'} ${formatShortDate(league.start_date)}${weekday ? ` &middot; ${weekday}` : ''}`;

  const totalWeeks = Number(league.total_weeks) || 0;
  const started = Number(league.weeks_started) || 0;

  // A league with no weeks scheduled yet has nothing to chart, so the block is
  // dropped and the body simply ends on the meta lines.
  let progressHTML = '';
  if (totalWeeks > 0) {
    // The current week is the latest one whose date has arrived; before the
    // first, week 1 is the one coming up. Same rule as the league page, so the
    // two never disagree. Clamped so a league past its last week reads
    // "Week 10 of 10" rather than "Week 11 of 10".
    const current = Math.max(0, Math.min(started, totalWeeks) - 1);
    const ticks = Array.from({ length: totalWeeks }, (_, i) => {
      const mod = done || i < current ? ' lgl-tick--past' : i === current ? ' lgl-tick--now' : '';
      return `<span class="lgl-tick${mod}"></span>`;
    }).join('');
    progressHTML = `
      <div class="lgl-progress">
        <div class="lgl-progress-head">
          <span class="lgl-week${done ? ' lgl-week--done' : ''}">${done ? 'Finished' : `Week ${current + 1} of ${totalWeeks}`}</span>
          <span class="lgl-progress-right">
            <span class="lgl-range">${_monthDay(league.start_date)} &ndash; ${_monthDay(league.last_night_date || league.last_week_date)}</span>
            <span class="lgl-foot-m">${_footNoteHTML(league, mine, totalWeeks)}</span>
          </span>
        </div>
        <div class="lgl-bar">${ticks}</div>
      </div>`;
  }

  return `
    <div class="lgl-card${done ? ' lgl-card--done' : ''}" data-id="${league.id}">
      <div class="lgl-body">
        <div class="lgl-card-head">
          <h3 class="lgl-name">${esc(league.name)}</h3>
          <span class="lgl-badges">
            ${_isDoubles(league) ? '<span class="lgl-fmt">Doubles</span>' : ''}
            <span class="lgl-status lgl-status--${done ? 'done' : 'active'}">${done ? 'Completed' : 'Active'}</span>
          </span>
        </div>
        <div class="lgl-meta">
          <span class="lgl-meta-row">${CAL_ICON}${dateLine}</span>
          <span class="lgl-meta-row">${PEOPLE_ICON}${structure}</span>
        </div>
        ${progressHTML}
      </div>
      <div class="lgl-foot">
        ${_footNoteHTML(league, mine, totalWeeks)}
        <span class="lgl-view">View league <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></span>
      </div>
    </div>`;
}

/**
 * The small note on the left of the footer: which division you are in on your
 * own leagues, otherwise how long the league runs.
 *
 * The division comes down with the list; when it doesn't, the chip still says
 * you are in the league rather than firing a request per card.
 */
function _footNoteHTML(league, mine, totalWeeks) {
  if (mine) {
    // In a doubles league the chip names your partner as well.
    const who = league.my_partner_name ? `You &amp; ${esc(String(league.my_partner_name).split(' ')[0])}` : 'You';
    return league.my_division_level != null
      ? `<span class="lgl-chip">${who} &middot; Division ${league.my_division_level}</span>`
      : `<span class="lgl-chip">You're in this league</span>`;
  }
  return totalWeeks > 0 ? `<span class="lgl-weeks">${totalWeeks} weeks</span>` : '<span></span>';
}

function _wireFilters() {
  const refresh = () => {
    // Only the pills and the grid depend on the filters, so the rest of the
    // page - and the scroll position - is left alone.
    document.getElementById('lglFilters').innerHTML = _filtersHTML();
    document.getElementById('lglGroups').innerHTML = _groupsHTML();
    _wireFilters();
    _wireCards();
  };
  const bar = document.getElementById('lglFilters');
  bar?.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.filter === _filter) return;
      _filter = btn.dataset.filter;
      refresh();
    });
  });
  bar?.querySelectorAll('[data-format]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Pressing the active Singles / Doubles pill again clears it: the phone
      // has no "All formats" pill, and it is harmless on a desktop.
      _format = btn.dataset.format === _format && btn.dataset.format !== 'all' ? 'all' : btn.dataset.format;
      refresh();
    });
  });
}

// The whole card is the click target; there are no buttons inside it.
function _wireCards() {
  const holder = document.getElementById('lglGroups');
  holder?.querySelectorAll('.lgl-card[data-id]').forEach((card) => {
    card.addEventListener('click', () => openLeague(Number(card.dataset.id)));
  });
  // The first buttons to live inside a league card: they act on the signup
  // rather than opening the league, so they stop the card's own click.
  holder?.querySelectorAll('[data-signup], [data-withdraw]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(btn.closest('.lgl-card').dataset.id);
      const league = state.leagues.find((l) => l.id === id);
      if (btn.hasAttribute('data-signup')) return signUp(id, league?.name);
      confirmWithdraw(id, league?.name);
    });
  });
}

/** Refresh the list in place after a signup changes, keeping the scroll. */
async function _reloadCards() {
  state.leagues = await window.api.getLeagues();
  const holder = document.getElementById('lglGroups');
  if (!holder) return;
  holder.innerHTML = _groupsHTML();
  _wireCards();
}

export async function signUp(id, name) {
  try {
    await window.api.signUpForLeague(id);
    await _reloadCards();
    toast(name ? `Signed up for ${name}` : 'Signed up', 'success');
  } catch (e) {
    toast(e.message || 'Could not sign up.', 'error');
  }
}

export function confirmWithdraw(id, name) {
  modal.open('Withdraw', `
    <p class="lgl-confirm-body">Withdraw from ${esc(name || 'this league')}? Your spot goes back to the club.</p>
    <div class="form-actions">
      <button class="btn btn-outline" id="wdKeep">Keep my spot</button>
      <button class="btn btn-danger" id="wdGo">Withdraw</button>
    </div>`);
  document.getElementById('wdKeep').addEventListener('click', modal.close);
  document.getElementById('wdGo').addEventListener('click', async () => {
    modal.close();
    try {
      await window.api.withdrawFromLeague(id);
      await _reloadCards();
      toast('Withdrawn', 'success');
    } catch (e) {
      toast(e.message || 'Could not withdraw.', 'error');
    }
  });
}

async function openLeague(id) {
  const league = await window.api.getLeague(id);
  window.navigate('leagueDetail', { league });
}

export function confirmDeleteLeague(id, name) {
  modal.open('Delete League', `
    <p>Delete <strong>${esc(name)}</strong>? This will remove all schedule data and cannot be undone.</p>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-danger" id="fConfirm">Delete League</button>
    </div>`);
  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fConfirm').addEventListener('click', async () => {
    await window.api.deleteLeague(id);
    modal.close();
    toast('League deleted');
    renderLeagues();
  });
}

// ===== PRINT BOXES =====
export function printBoxes(league) {
  const isModern = league.setup_type === 'modern';
  const numRounds = league.num_rounds || 1;
  const weeks = league.weeks || [];
  const weeksPerRound = Math.round(weeks.length / numRounds);

  // Group weeks into rounds
  const rounds = [];
  for (let r = 0; r < numRounds; r++) {
    rounds.push(weeks.slice(r * weeksPerRound, (r + 1) * weeksPerRound));
  }

  // Group players by division
  const divMap = {};
  (league.players || []).forEach((p) => {
    if (!divMap[p.division_level]) {
      divMap[p.division_level] = { name: p.division_name, level: p.division_level, players: [] };
    }
    divMap[p.division_level].players.push(p);
  });
  const divisions = Object.values(divMap)
    .sort((a, b) => a.level - b.level)
    .map((d) => ({
      ...d,
      players: d.players.slice().sort((a, b) =>
        isModern ? (a.skill_rank - b.skill_rank) : (a.team_order - b.team_order),
      ),
    }));

  let pagesHTML = '';

  rounds.forEach((roundWeeks, roundIdx) => {
    // Build pairIndex: sorted player-id pair -> match object
    const pairMatch = {};
    roundWeeks.forEach((week) => {
      (week.matchups || []).forEach((mu) => {
        (mu.matches || []).forEach((match) => {
          if (!match.skipped) {
            const key = [match.player1_id, match.player2_id].sort((a, b) => a - b).join('-');
            pairMatch[key] = match;
          }
        });
      });
    });

    divisions.forEach((div) => {
      const players = div.players;
      const roundLabel = numRounds > 1 ? ` &middot; Round ${roundIdx + 1}` : '';

      // Column headers
      const colHeaders = players.map((p) => `
        <th class="box-col-header">
          <div class="box-col-player">${esc(p.player_name)}</div>
          ${!isModern ? `<div class="box-col-team">${esc(p.team_name)}</div>` : ''}
        </th>`).join('');

      // Rows
      const rows = players.map((rowP) => {
        const cells = players.map((colP) => {
          if (rowP.player_id === colP.player_id) {
            return '<td class="box-cell box-cell-self"><div class="box-cell-x">✕</div></td>';
          }
          const key = [rowP.player_id, colP.player_id].sort((a, b) => a - b).join('-');
          const match = pairMatch[key];
          if (match && match.player1_score !== null && match.player2_score !== null) {
            const isP1 = match.player1_id === rowP.player_id;
            const myScore = isP1 ? match.player1_score : match.player2_score;
            const theirScore = isP1 ? match.player2_score : match.player1_score;
            return `<td class="box-cell box-cell-scored">
              <div class="box-score">${myScore}&ndash;${theirScore}</div>
            </td>`;
          }
          return '<td class="box-cell"></td>';
        }).join('');
        return `<tr>
          <td class="box-row-header">
            <div class="box-row-player">${esc(rowP.player_name)}</div>
            ${!isModern ? `<div class="box-row-team">${esc(rowP.team_name)}</div>` : ''}
          </td>${cells}</tr>`;
      }).join('');

      pagesHTML += `
        <div class="box-page">
          <div class="box-title-bar">
            <div class="box-league">${esc(league.name)}</div>
            <div class="box-division">${esc(div.name)}${roundLabel}</div>
          </div>
          <table class="box-grid">
            <thead>
              <tr>
                <th class="box-corner"></th>
                ${colHeaders}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    });
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Box Sheets &middot; ${esc(league.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; }

    .box-page {
      width: 100%;
      min-height: 100vh;
      padding: 18mm 16mm 14mm;
      display: flex;
      flex-direction: column;
      page-break-after: always;
      break-after: page;
    }

    .box-title-bar {
      margin-bottom: 10mm;
    }
    .box-league {
      font-size: 13pt;
      color: #555;
      font-weight: 500;
      margin-bottom: 2px;
    }
    .box-division {
      font-size: 22pt;
      font-weight: 800;
      color: #000;
      line-height: 1.1;
    }
    .box-grid {
      width: 100%;
      flex: 1;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .box-corner {
      width: 52mm;
    }

    .box-col-header {
      border: 2px solid #000;
      padding: 6px 4px;
      text-align: center;
      vertical-align: bottom;
      background: #fff;
      color: #000;
    }
    .box-col-player {
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.2;
    }
    .box-col-team {
      font-size: 8pt;
      opacity: 0.8;
      margin-top: 2px;
    }

    .box-row-header {
      border: 2px solid #000;
      padding: 6px 10px;
      background: #fff;
      color: #000;
      vertical-align: middle;
    }
    .box-row-player {
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.2;
    }
    .box-row-team {
      font-size: 8pt;
      opacity: 0.8;
      margin-top: 2px;
    }

    .box-cell {
      border: 2px solid #000;
      vertical-align: top;
      padding: 5px 6px;
      min-height: 30mm;
    }
    .box-cell-self {
      background: #ccc;
      text-align: center;
      vertical-align: middle;
    }
    .box-cell-x {
      font-size: 22pt;
      font-weight: 700;
      color: #000;
      line-height: 1;
    }
    .box-cell-scored {
      text-align: center;
      vertical-align: middle;
    }
    .box-score {
      font-size: 12pt;
      font-weight: 700;
      color: #000;
    }

    @page { size: A4 landscape; margin: 0; }
    @media print {
      body { background: #fff; }
      .box-page { min-height: 0; padding: 12mm 14mm 10mm; }
    }
  </style>
</head>
<body>${pagesHTML}</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win2 = window.open(url, '_blank');
  win2.addEventListener('load', () => {
    win2.print();
    URL.revokeObjectURL(url);
  });
}

export function openMessagePlayersModal(league) {
  const players = (league.players || []).filter((p) => p.player_email);
  const noEmailPlayers = (league.players || []).filter((p) => !p.player_email);
  const attachments = [];
  let quill = null;

  const fmtSize = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const hasDraft = () =>
    !!(document.getElementById('fMsgSubject')?.value.trim() || quill?.getText().trim() || attachments.length);

  // The confirmation is a layer inside the modal, not a second modal.open —
  // that would tear down the editor and lose the draft it is guarding.
  function showDiscardConfirm() {
    if (document.getElementById('mpDiscard')) return;
    const layer = document.createElement('div');
    layer.id = 'mpDiscard';
    layer.className = 'mp-discard';
    layer.innerHTML = `
      <div class="mp-discard-card">
        <div class="mp-discard-title">Discard this message?</div>
        <div class="mp-discard-body">Your subject, message and attachments will be lost.</div>
        <div class="mp-discard-btns">
          <button class="btn btn-outline" id="mpKeep">Keep editing</button>
          <button class="btn btn-danger" id="mpDiscardBtn">Discard</button>
        </div>
      </div>`;
    document.getElementById('modal').appendChild(layer);
    document.getElementById('mpKeep').addEventListener('click', () => layer.remove());
    document.getElementById('mpDiscardBtn').addEventListener('click', () => { layer.remove(); modal.close(); });
  }

  modal.open('Message players', `
    <p class="mp-recipients">
      Sending to <strong>${players.length} player${players.length !== 1 ? 's' : ''}</strong> with an email on file.
      ${noEmailPlayers.length ? `<span class="mp-skip">${noEmailPlayers.length} player${noEmailPlayers.length !== 1 ? 's have' : ' has'} no email and will be skipped.</span>` : ''}
    </p>
    <div class="form-group">
      <label class="mp-label">Subject</label>
      <input class="form-control mp-subject" id="fMsgSubject" type="text" placeholder="e.g. League night this week">
    </div>
    <div class="form-group">
      <label class="mp-label">Message</label>
      <div class="mp-editor">
        <div id="fMsgEditor"></div>
        <div class="mp-editor-foot">
          <span>Formatting is kept in the email.</span>
          <span id="mpWords" hidden></span>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="mp-label">Attachments <span class="mp-label-opt">(optional)</span></label>
      <div class="mp-attach" id="fAttachmentList"></div>
      <input id="fMsgFile" type="file" hidden>
    </div>
    <div class="mp-foot">
      <div class="mp-foot-left">
        <span id="fMsgError" class="form-error mp-err"></span>
        <span id="mpDraftNote" class="mp-draftnote" hidden>Draft in progress</span>
      </div>
      <div class="mp-foot-btns">
        <button class="btn btn-outline" id="fCancel">Cancel</button>
        <button class="btn btn-primary" id="fSend">Send email</button>
      </div>
    </div>`, {
    medium: true,
    sticky: true,
    onRequestClose: () => {
      if (!hasDraft()) return modal.close();
      showDiscardConfirm();
    },
  });

  quill = new Quill('#fMsgEditor', {
    theme: 'snow',
    placeholder: 'Write your message here…',
    modules: { toolbar: [
      [{ header: [false, 2, 3] }],
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link'],
      ['clean'],
    ] },
  });

  function updateDraftBits() {
    const words = quill.getText().trim().split(/\s+/).filter(Boolean).length;
    const wordsEl = document.getElementById('mpWords');
    if (wordsEl) {
      wordsEl.hidden = words === 0;
      wordsEl.textContent = `${words} word${words !== 1 ? 's' : ''}`;
    }
    const note = document.getElementById('mpDraftNote');
    if (note) note.hidden = !hasDraft() || !!document.getElementById('fMsgError')?.textContent;
  }
  quill.on('text-change', updateDraftBits);
  document.getElementById('fMsgSubject').addEventListener('input', updateDraftBits);

  function renderAttachmentList() {
    const list = document.getElementById('fAttachmentList');
    list.innerHTML = attachments.map((a, i) => `
      <span class="mp-chip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        <span class="mp-chip-name">${esc(a.filename)}</span>
        <span class="mp-chip-size">${fmtSize(a.size)}</span>
        <button class="mp-chip-x" data-remove="${i}" aria-label="Remove">&times;</button>
      </span>`).join('') + `
      <button class="mp-addfile" id="fAddFile" type="button">+ Add file</button>`;

    list.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        attachments.splice(Number(btn.dataset.remove), 1);
        renderAttachmentList();
        updateDraftBits();
      });
    });
    document.getElementById('fAddFile').addEventListener('click', () => {
      document.getElementById('fMsgFile').click();
    });
  }
  renderAttachmentList();

  document.getElementById('fMsgFile').addEventListener('change', async () => {
    const fileInput = document.getElementById('fMsgFile');
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    attachments.push({ filename: file.name, content: base64, size: file.size });
    fileInput.value = '';
    renderAttachmentList();
    updateDraftBits();
  });

  document.getElementById('fCancel').addEventListener('click', () => modal.requestClose());
  document.getElementById('fSend').addEventListener('click', async () => {
    const subject = document.getElementById('fMsgSubject').value.trim();
    const text = quill.getText().trim();
    const errEl = document.getElementById('fMsgError');
    if (!subject) { errEl.textContent = 'Subject is required.'; updateDraftBits(); return; }
    if (!text) { errEl.textContent = 'Message is required.'; updateDraftBits(); return; }
    errEl.textContent = '';
    document.getElementById('fSend').disabled = true;
    document.getElementById('fSend').textContent = 'Sending…';
    try {
      const data = await window.api.messageLeaguePlayers(league.id, {
        subject,
        body: text,
        bodyHtml: quill.getSemanticHTML(),
        attachments: attachments.map(({ filename, content }) => ({ filename, content })),
      });
      modal.close();
      toast(`Email sent to ${data.sent} player${data.sent !== 1 ? 's' : ''}`, 'success');
    } catch (e) {
      errEl.textContent = e.message;
      document.getElementById('fSend').disabled = false;
      document.getElementById('fSend').textContent = 'Send email';
    }
  });
}

// ===== BULK INVITE =====
export function openBulkInviteModal(league) {
  modal.open('Send Account Invites', `
    <p style="font-size:14px;color:var(--text-muted);margin-bottom:16px">
      This will send a personalized account activation email to every player in this league
      who has an email on file and has not yet activated their account.
    </p>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:20px">
      Players who already have an account will be skipped automatically.
    </p>
    <div id="fBulkError" style="color:var(--danger);font-size:13px;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-ghost" id="fBulkCancel">Cancel</button>
      <button class="btn btn-primary" id="fBulkSend">Send Invites</button>
    </div>
  `);
  document.getElementById('fBulkCancel').addEventListener('click', () => modal.close());
  document.getElementById('fBulkSend').addEventListener('click', async () => {
    const errEl = document.getElementById('fBulkError');
    const btn = document.getElementById('fBulkSend');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const data = await window.api.bulkInviteLeague(league.id);
      modal.close();
      if (data.sent === 0) {
        toast('All players already have accounts. No invites sent.', 'info');
      } else {
        toast(`Invites sent to ${data.sent} player${data.sent !== 1 ? 's' : ''}.`, 'success');
      }
    } catch (e) {
      errEl.textContent = e.message || 'Failed to send invites.';
      btn.disabled = false;
      btn.textContent = 'Send Invites';
    }
  });
}

// ===== PRINT SCHEDULE (Modern leagues) =====
export function printSchedule(league) {
  const weeks = league.weeks || [];
  const divisions = (league.divisions || []).slice().sort((a, b) => a.level - b.level);

  // Build player name lookup
  const playerName = {};
  (league.players || []).forEach((p) => { playerName[p.player_id] = p.player_name; });

  const fmtDate = (d) => {
    if (!d) return '';
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // A league that plays several days a week prints one week per page, one
  // column per day, divisions inside the day, the week's byes at the foot.
  const playDays = Array.isArray(league.play_days) ? league.play_days : [];
  const multiDay = playDays.length > 1;
  const byeLabel = (b) => (b.pair_player2_name ? `${b.pair_player1_name} & ${b.pair_player2_name}` : b.player_name);
  const matchLine = (m) => {
    const dbl = m.format === 'doubles';
    const p1 = dbl ? `${m.sub1_name || m.player1_name} & ${m.sub3_name || m.player1_partner_name}` : (m.sub1_name || m.player1_name);
    const p2 = dbl ? `${m.sub2_name || m.player2_name} & ${m.sub4_name || m.player2_partner_name}` : (m.sub2_name || m.player2_name);
    const score = (m.player1_score != null && m.player2_score != null)
      ? `<span class="sched-score">${m.player1_score}–${m.player2_score}</span>` : '';
    const courtLabel = m.court_name || (league.schedule_courts && m.court_number ? `Ct ${m.court_number}` : null);
    const meta = [courtLabel, m.match_time].filter(Boolean).join(' · ');
    return `<div class="sched-match"><span class="sched-court">${esc(meta)}</span>${esc(p1)} <span class="sched-vs">vs</span> ${esc(p2)}${score}</div>`;
  };
  const weeksByDayHTML = weeks.map((week, wi) => {
    const dates = playDatesFor(week.date, playDays);
    const known = new Set(dates.map((d) => d.date));
    const all = (week.matchups || []).flatMap((mu) => (mu.matches || []).filter((m) => !m.skipped).map((m) => ({ m, mu })));
    const daysHTML = dates.map((day, i) => {
      const mine = all.filter(({ m }) => m.scheduled_date === day.date || (i === 0 && !known.has(m.scheduled_date)));
      const divsHTML = divisions.map((div) => {
        const rows = mine.filter(({ mu }) => mu.division_id === div.id);
        if (!rows.length) return '';
        return `<div class="sched-div"><div class="sched-div-name">${esc(div.name)}</div>${rows.map(({ m }) => matchLine(m)).join('')}</div>`;
      }).join('');
      const md = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<div class="sched-night">
        <div class="sched-night-head"><span class="sched-night-day">${DAY_LONG[day.dow]}</span><span class="sched-night-date">${md}</span><span class="sched-night-count">${mine.length} match${mine.length === 1 ? '' : 'es'}</span></div>
        ${divsHTML || '<div class="sched-bye">No matches</div>'}
      </div>`;
    }).join('');
    const byes = (week.byes || []).map((b) => {
      const div = divisions.find((d) => d.id === b.division_id);
      return `${esc(byeLabel(b))}${div ? ` (${esc(div.name)})` : ''}`;
    });
    return `<div class="sched-week sched-week--nights"${wi === weeks.length - 1 ? ' style="break-after:auto"' : ''}>
      <div class="sched-week-header">
        <span class="sched-week-num">Week ${week.week_number}</span>
        <span class="sched-week-date">${formatWeekRange(week.date, dates)}</span>
        <span class="sched-page-no">Page ${wi + 1} of ${weeks.length}</span>
      </div>
      <div class="sched-nights" style="grid-template-columns:repeat(${dates.length}, minmax(0, 1fr))">${daysHTML}</div>
      ${byes.length ? `<div class="sched-bye">Bye: ${byes.join(', ')}</div>` : ''}
    </div>`;
  }).join('');

  const weeksHTML = multiDay ? weeksByDayHTML : weeks.map((week) => {
    // Build a map of division_id -> { matches, byes }
    const divData = {};
    divisions.forEach((d) => { divData[d.id] = { name: d.name, matches: [], byes: [] }; });

    (week.matchups || []).forEach((mu) => {
      if (!mu.division_id || !divData[mu.division_id]) return;
      (mu.matches || []).forEach((m) => {
        if (m.skipped) return;
        divData[mu.division_id].matches.push(m);
      });
    });
    (week.byes || []).forEach((b) => {
      if (divData[b.division_id]) divData[b.division_id].byes.push(b.pair_player2_name ? `${b.pair_player1_name} & ${b.pair_player2_name}` : b.player_name);
    });

    const divsHTML = divisions.map((div) => {
      const { matches, byes } = divData[div.id];
      if (matches.length === 0 && byes.length === 0) return '';

      const matchRows = matches.map((m) => {
        const dbl = m.format === 'doubles';
        const p1 = dbl ? `${m.sub1_name || m.player1_name} & ${m.sub3_name || m.player1_partner_name}` : (m.sub1_name || m.player1_name);
        const p2 = dbl ? `${m.sub2_name || m.player2_name} & ${m.sub4_name || m.player2_partner_name}` : (m.sub2_name || m.player2_name);
        const score = (m.player1_score != null && m.player2_score != null)
          ? `<span class="sched-score">${m.player1_score}–${m.player2_score}</span>` : '';
        const courtLabel = m.court_name || (league.schedule_courts && m.court_number ? `Ct ${m.court_number}` : null);
        const court = courtLabel ? `<span class="sched-meta">${esc(courtLabel)}</span>` : '';
        const time = m.match_time ? `<span class="sched-meta">${m.match_time}</span>` : '';
        return `<div class="sched-match">${esc(p1)} <span class="sched-vs">vs</span> ${esc(p2)}${score}${court}${time}</div>`;
      }).join('');

      const byeRow = byes.length
        ? `<div class="sched-bye">Bye: ${byes.map(esc).join(', ')}</div>` : '';

      return `<div class="sched-div">
        <div class="sched-div-name">${esc(div.name)}</div>
        ${matchRows}${byeRow}
      </div>`;
    }).join('');

    if (!divsHTML.trim()) return '';

    return `<div class="sched-week">
      <div class="sched-week-header">
        <span class="sched-week-num">Week ${week.week_number}</span>
        <span class="sched-week-date">${fmtDate(week.date)}</span>
      </div>
      <div class="sched-divs">${divsHTML}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Schedule &middot; ${esc(league.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #000; font-size: 10pt; }

    .page-header { padding: 8mm 12mm 4mm; border-bottom: 2px solid #000; margin-bottom: 6mm; }
    .page-title { font-size: 18pt; font-weight: 800; }
    .page-sub { font-size: 10pt; color: #555; margin-top: 2px; }

    .schedule { padding: 0 12mm 10mm; columns: 2; column-gap: 8mm; }

    .sched-week {
      break-inside: avoid;
      margin-bottom: 6mm;
    }
    .sched-week-header {
      display: flex;
      align-items: baseline;
      gap: 6px;
      border-bottom: 1.5px solid #000;
      padding-bottom: 2px;
      margin-bottom: 3px;
    }
    .sched-week-num { font-size: 11pt; font-weight: 800; }
    .sched-week-date { font-size: 9pt; color: #555; }

    .sched-divs { padding-left: 2mm; }
    .sched-div { margin-bottom: 9px; }
    .sched-div-name { font-size: 8.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #222; margin-bottom: 4px; }

    .sched-match { font-size: 9.5pt; padding: 4px 0; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; border-bottom: 0.5px solid #eee; }
    .sched-match:last-of-type { border-bottom: none; }
    .sched-vs { color: #888; font-size: 8.5pt; }
    .sched-score { font-weight: 700; font-size: 9pt; margin-left: 2px; }
    .sched-meta { font-size: 8pt; color: #777; }
    .sched-bye { font-size: 8.5pt; color: #777; font-style: italic; padding: 4px 0 1px; }

    /* Several play days: one week per page, a column per day. */
    .schedule--nights { columns: auto; }
    .sched-week--nights { break-after: page; }
    .sched-page-no { margin-left: auto; font-size: 9.5pt; color: #777; }
    .sched-nights { display: grid; gap: 6mm; padding-left: 0; }
    .sched-night-head { display: flex; align-items: baseline; gap: 5px; border-bottom: 1px solid #000; padding-bottom: 3px; margin-bottom: 4px; }
    .sched-night-day { font-size: 11pt; font-weight: 800; }
    .sched-night-date { font-size: 9.5pt; color: #555; }
    .sched-night-count { margin-left: auto; font-size: 9pt; color: #777; }
    .sched-court { font-size: 8pt; color: #777; min-width: 70px; }

    @page { size: A4 portrait; margin: 14mm 12mm; }
    @media print {
      body { background: #fff; }
      .page-header { padding: 0 0 4mm; }
      .schedule { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="page-header">
    <div class="page-title">${esc(league.name)}</div>
    <div class="page-sub">Schedule${multiDay ? ` &middot; ${esc(playDayNamesLong(playDays))}` : ''}</div>
  </div>
  <div class="schedule${multiDay ? ' schedule--nights' : ''}">${weeksHTML}</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win2 = window.open(url, '_blank');
  win2.addEventListener('load', () => { win2.print(); URL.revokeObjectURL(url); });
}
