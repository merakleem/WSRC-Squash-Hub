import { state, isAdmin, isMember } from '../state.js';
import { esc, toast, modal, formatShortDate, abbrevName, avatarInner, clubNow, clubTodayStr } from '../utils.js';
import { openMessagePlayerModal } from './players.js';

// ===== DASHBOARD HELPERS =====
function timeAgo(utcStr) {
  if (!utcStr) return '';
  const ms = Date.now() - new Date(utcStr.replace(' ', 'T') + 'Z').getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(utcStr.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const _roundLabels = { group: 'Group Stage', quarterfinal: 'Quarterfinals', semifinal: 'Semifinals', final: 'Final' };

// A side of a result, shortened. A doubles side is two people, and the feed
// carries their names already joined - abbreviating that string as if it were
// one name turned "Anna Lindqvist & Jess Wu" into "A. Wu", so each name is
// shortened on its own and the pair is rejoined.
function _activitySide(m, one) {
  const team = one ? m.team1 : m.team2;
  if (Array.isArray(team) && team.length) return team.map((p) => abbrevName(p.name)).join(' & ');
  return String(one ? m.p1_name : m.p2_name || '').split(' & ').map(abbrevName).join(' & ');
}

function _activityDetails(m, adminMode) {
  // won_side, when the feed sends it, already accounts for a substitute having
  // played; winner_id is the row as it was written.
  const p1Won = m.won_side != null ? m.won_side === 1 : m.winner_id === m.player1_id;
  const winnerName  = _activitySide(m, p1Won);
  const loserName   = _activitySide(m, !p1Won);
  const winnerPos   = p1Won ? m.p1_pos : m.p2_pos;
  const loserPos    = p1Won ? m.p2_pos : m.p1_pos;
  const winnerScore = p1Won ? m.player1_score : m.player2_score;
  const loserScore  = p1Won ? m.player2_score : m.player1_score;
  const winnerLabel = winnerPos ? `(#${winnerPos}) ` : '';
  const loserLabel  = loserPos  ? `(#${loserPos}) ` : '';
  const isTrMatch   = m.source === 'tournament';
  const submittedByText = isTrMatch
    ? `${m.tournament_name || ''} • ${_roundLabels[m.round] || m.round || ''}`
    : (adminMode ? `Submitted by ${m.submitted_by_name || 'Admin'}` : null);
  const placesMovedText = m.places_moved > 0
    ? `↑ ${winnerName} moves up ${m.places_moved} place${m.places_moved !== 1 ? 's' : ''}` : null;
  return { winnerName, loserName, winnerLabel, loserLabel, winnerScore, loserScore, submittedByText, placesMovedText };
}

function buildActivityHTML(activity, isAdmin = false) {
  if (!activity || activity.length === 0) {
    return `<div class="dp-activity-scroll"><div class="dp-right-empty">No activity in the past 7 days.</div></div>`;
  }
  const items = activity.map((m) => {
    const { winnerName, loserName, winnerLabel, loserLabel, winnerScore, loserScore, submittedByText, placesMovedText } = _activityDetails(m, isAdmin);
    const movesUp     = placesMovedText ? `<div class="dp-activity-moves">${esc(placesMovedText)}</div>` : '';
    const submittedBy = submittedByText ? `<div class="dp-activity-by">${esc(submittedByText)}</div>` : '';
    return `<div class="dp-activity-item">
      <div class="dp-activity-text">
        <span class="dp-activity-winner">${esc(winnerLabel)}${esc(winnerName)}</span>
        <span class="dp-activity-verb"> beat </span>
        <span>${esc(loserLabel)}${esc(loserName)}</span>
        <span class="dp-activity-score"> ${winnerScore}–${loserScore}</span>
      </div>
      <div class="dp-activity-time">${esc(timeAgo(m.confirmed_at))}</div>
      ${movesUp}
      ${submittedBy}
    </div>`;
  }).join('');
  return `<div class="dp-activity-scroll">${items}</div>`;
}

// ===== CLUB ACTIVITY PAGE =====
// The feed of recorded matches, grouped by day. Players get the feed; admins
// also get a name search, match-type filters, who submitted each result, and
// delete on ladder matches. Built to the club-activity design handoff.
const CA_PAGE = 8;
const CA_AVATAR_COLORS = ['#1e2758', '#2f6f8f', '#7a4b9a', '#3d7a5a', '#a1543c', '#4a5b8c', '#8a6a1f', '#5c6b7a'];
const CA_FILTERS = [
  { key: 'all',        name: 'All',         what: 'match' },
  { key: 'pickup',     name: 'Ladder',      what: 'ladder match',     dot: '#5b7cf9' },
  { key: 'league',     name: 'Leagues',     what: 'league match',     dot: '#0f7b3f' },
  { key: 'tournament', name: 'Tournaments', what: 'tournament match', dot: '#c9a227' },
];
const CA_ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="#7e8c9a" stroke-width="2.2" class="ca-search-icon" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  up: '<svg viewBox="0 0 12 12" aria-hidden="true" class="ca-up"><path d="M6 3 L10.2 8.6 L1.8 8.6 Z" fill="currentColor"/></svg>',
};
const ca = { all: null, query: '', filter: 'all', limit: CA_PAGE, loading: false, confirmId: null, onScroll: null, toastTimer: null };

// When a match happened, at the club. A stored timestamp is UTC when it
// carries a time; a bare date is a bare date, with no time to show.
function _caWhen(str) {
  const s = String(str || '');
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    return clubNow(new Date(s.replace(' ', 'T').slice(0, 19) + 'Z'));
  }
  return { date: s.slice(0, 10), minutes: null };
}
function _caTime(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60), mi = minutes % 60;
  return `${h % 12 || 12}:${String(mi).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}
function _caShiftDay(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function _caDayLabel(date, today) {
  if (date === today) return 'Today';
  if (date === _caShiftDay(today, -1)) return 'Yesterday';
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
}
function _caDaySub(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _caShape(m) {
  const p1Won = m.won_side != null ? m.won_side === 1 : m.winner_id === m.player1_id;
  const { date, minutes } = _caWhen(m.confirmed_at);
  // A doubles result: two sides of two, no ladder places, tagged as the
  // doubles ladder or its league.
  if (m.format === 'doubles') {
    const t1 = (m.team1 || []).map((p) => ({ id: p.id, name: p.name, photo_path: p.photo_path || null, pos: null }));
    const t2 = (m.team2 || []).map((p) => ({ id: p.id, name: p.name, photo_path: p.photo_path || null, pos: null }));
    const wScore = p1Won ? m.player1_score : m.player2_score;
    const lScore = p1Won ? m.player2_score : m.player1_score;
    return {
      id: m.id, source: m.source, format: 'doubles',
      winners: p1Won ? t1 : t2, losers: p1Won ? t2 : t1,
      score: `${wScore}–${lScore}`, date, minutes,
      tag: m.source === 'league' ? (m.league_name || 'League') : 'Doubles ladder',
      moved: 0,
      by: m.submitted_by_name || '',
    };
  }
  const side = (one) => ({
    id: one ? (m.eff_p1_id ?? m.player1_id) : (m.eff_p2_id ?? m.player2_id),
    name: one ? m.p1_name : m.p2_name,
    photo_path: (one ? m.p1_photo : m.p2_photo) || null,
    pos: one ? m.p1_pos : m.p2_pos,
    score: one ? m.player1_score : m.player2_score,
  });
  const w = side(p1Won), l = side(!p1Won);
  const tag = m.source === 'league' ? (m.league_name || 'League')
    : m.source === 'tournament' ? [m.tournament_name || 'Tournament', _roundLabels[m.round] || m.round || ''].filter(Boolean).join(' · ')
    : 'Ladder';
  return {
    id: m.id, source: m.source, format: 'singles', winners: [w], losers: [l],
    score: `${w.score}–${l.score}`, date, minutes, tag,
    moved: m.places_moved > 0 ? m.places_moved : 0,
    by: m.submitted_by_name || '',
  };
}

const _caNameText = (p) => (p.pos ? `(#${p.pos}) ` : '') + abbrevName(p.name);
const _caSide = (list) => list.map(_caNameText).join(' & ');

function _caMatching() {
  const q = ca.query.trim().toLowerCase();
  const filter = isAdmin() ? ca.filter : 'all';
  return (ca.all || [])
    .filter((m) => filter === 'all' || m.source === filter)
    .filter((m) => !q || [...m.winners, ...m.losers].some((p) => String(p.name || '').toLowerCase().includes(q)));
}

function _caRowHTML(m, admin) {
  const avatars = [...m.winners.map((p) => ({ ...p, win: true })), ...m.losers.map((p) => ({ ...p, win: false }))]
    .map((p) => `<span class="ca-av${p.win ? '' : ' ca-av--lost'}" title="${esc(p.name)}"${p.photo_path ? '' : ` style="background:${CA_AVATAR_COLORS[Math.abs(Number(p.id) || 0) % CA_AVATAR_COLORS.length]}"`}>${avatarInner(p)}</span>`)
    .join('');
  const moved = m.moved
    ? `<span class="ca-moved">${CA_ICON.up}${esc(abbrevName(m.winners[0].name))} up ${m.moved} place${m.moved !== 1 ? 's' : ''}</span>` : '';
  const by = admin && m.source !== 'tournament'
    ? `<span class="ca-by">Submitted by ${esc(abbrevName(m.by) || 'Admin')}</span>` : '';
  const del = admin && m.source === 'pickup'
    ? `<button class="ca-del" data-del="${m.id}" data-format="${m.format || 'singles'}" aria-label="Delete this ladder match" title="Delete">${CA_ICON.trash}</button>` : '';
  return `
    <article class="ca-row" data-match="${m.id}">
      <div class="ca-avs">${avatars}</div>
      <div class="ca-text">
        <div class="ca-line1">
          <span class="ca-winner">${esc(_caSide(m.winners))}</span>
          <span class="ca-beat">beat</span>
          <span class="ca-loser">${esc(_caSide(m.losers))}</span>
          <span class="ca-score">${esc(m.score)}</span>
        </div>
        <div class="ca-line2">
          <span class="ca-tag ca-tag--${esc(m.source)}"><span class="ca-tag-dot"></span>${esc(m.tag)}</span>
          ${moved}${by}
        </div>
      </div>
      <div class="ca-right">
        <span class="ca-time">${esc(_caTime(m.minutes))}</span>
        ${del}
      </div>
    </article>`;
}

function _caFeedHTML() {
  const admin = isAdmin();
  const q = ca.query.trim();
  const filter = admin ? ca.filter : 'all';
  const matching = _caMatching();
  const shown = matching.slice(0, ca.limit);
  const hasMore = matching.length > ca.limit;
  const hasQuery = !!q || filter !== 'all';
  const f = CA_FILTERS.find((x) => x.key === filter);
  const n = matching.length;
  const countText = `${n} ${f.what}${n !== 1 ? 'es' : ''}${q ? ` for “${q}”` : ''}`;

  const today = clubTodayStr();
  const byDay = new Map();
  for (const m of shown) {
    if (!byDay.has(m.date)) byDay.set(m.date, []);
    byDay.get(m.date).push(m);
  }
  const sections = [...byDay.entries()].map(([date, items]) => {
    const label = _caDayLabel(date, today);
    const recent = label === 'Today' || label === 'Yesterday';
    const sub = recent ? _caDaySub(date) : `${_caDaySub(date)} · ${items.length} match${items.length !== 1 ? 'es' : ''}`;
    return `
      <section class="ca-day">
        <div class="ca-day-head"><span class="ca-day-label">${esc(label)}</span><span class="ca-day-sub">${esc(sub)}</span></div>
        <div class="ca-card">${items.map((m) => _caRowHTML(m, admin)).join('')}</div>
      </section>`;
  }).join('');

  const tail = hasMore
    ? `<div class="ca-more" role="status"><span class="ca-spinner"></span>Loading older matches…</div>`
    : (shown.length > CA_PAGE ? `<div class="ca-end">No more matches</div>` : '');

  const empty = shown.length === 0 ? `
    <div class="ca-card ca-empty">
      <strong class="ca-empty-title">${q ? `No matches for “${esc(q)}”` : `No ${filter === 'all' ? '' : f.name.toLowerCase() + ' '}matches yet`}</strong>
      <span class="ca-empty-sub">${hasQuery ? 'Try a different name or widen the filters.' : 'Matches will appear here as they are recorded.'}</span>
      ${hasQuery ? '<button class="ca-empty-clear" data-clear>Clear search and filters</button>' : ''}
    </div>` : '';

  return `
    <div class="ca-countline">
      <span class="ca-count" role="status">${esc(countText)}</span>
      ${hasQuery ? '<button class="ca-clear" data-clear>Clear</button>' : ''}
    </div>
    ${sections}${tail}${empty}`;
}

function _caToolbarHTML() {
  if (!isAdmin()) return '';
  const chips = CA_FILTERS.map((f) => {
    const on = f.key === ca.filter;
    return `<button class="ca-chip${on ? ' ca-chip--on' : ''}" data-filter="${f.key}" aria-pressed="${on}">
      <span class="ca-chip-dot" style="background:${f.dot || (on ? 'rgba(255,255,255,.6)' : '#b9c4d4')}"></span>${f.name}</button>`;
  }).join('');
  return `
    <div class="ca-toolbar">
      <div class="ca-search">
        ${CA_ICON.search}
        <input type="search" class="ca-search-input" id="caSearch" value="${esc(ca.query)}" placeholder="Search by player name" aria-label="Search by player name" autocomplete="off">
      </div>
      <div class="ca-chips" role="group" aria-label="Filter by match type">${chips}</div>
    </div>`;
}

function _caLoadMore() {
  if (ca.loading || _caMatching().length <= ca.limit) return;
  ca.loading = true;
  requestAnimationFrame(() => {
    ca.limit += CA_PAGE;
    ca.loading = false;
    _caRenderFeed();
  });
}

// Eight rows may not reach the bottom of a tall window, and a list that
// cannot scroll would never ask for more. So after each render, if the page
// still has room and there is more, the next page comes on its own.
function _caFillIfShort() {
  const content = document.getElementById('mainContent');
  if (!content || !content.querySelector('.ca-feed')) return;
  if (content.scrollHeight <= content.clientHeight + 160) _caLoadMore();
}

function _caRenderFeed() {
  const feed = document.getElementById('caFeed');
  if (!feed) return;
  feed.innerHTML = _caFeedHTML();
  _caWireFeed();
  _caFillIfShort();
}

function _caWireFeed() {
  const content = document.getElementById('mainContent');
  content.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
    ca.query = ''; ca.filter = 'all'; ca.limit = CA_PAGE;
    _caRender();
  }));
  content.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    ca.confirmId = Number(b.dataset.del);
    _caRenderDialog();
  }));
}

function _caRender() {
  const content = document.getElementById('mainContent');
  content.innerHTML = `${_caToolbarHTML()}<div class="ca-feed" id="caFeed">${_caFeedHTML()}</div>`;

  const search = document.getElementById('caSearch');
  search?.addEventListener('input', () => { ca.query = search.value; ca.limit = CA_PAGE; _caRenderFeed(); });
  content.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    ca.filter = b.dataset.filter; ca.limit = CA_PAGE;
    _caRender();
  }));
  _caWireFeed();
  _caFillIfShort();
}

function _caRenderDialog() {
  document.getElementById('caDialog')?.remove();
  const m = (ca.all || []).find((x) => x.id === ca.confirmId);
  if (!m) return;
  const label = _caDayLabel(m.date, clubTodayStr());
  const when = (label === 'Today' || label === 'Yesterday') ? label.toLowerCase() : label;
  const time = _caTime(m.minutes);
  const summary = `${m.winners.map((p) => abbrevName(p.name)).join(' & ')} beat ${m.losers.map((p) => abbrevName(p.name)).join(' & ')} ${m.score}, ${when}${time ? ` at ${time}` : ''}.`;
  const wrap = document.createElement('div');
  wrap.id = 'caDialog';
  wrap.innerHTML = `
    <div class="ca-backdrop" data-cancel></div>
    <div class="ca-dialog" role="dialog" aria-modal="true" aria-label="Delete ladder match">
      <div class="ca-dialog-body">
        <span class="ca-dialog-title">Delete this ladder match?</span>
        <span class="ca-dialog-text">${esc(summary)}</span>
        <span class="ca-dialog-note">This cannot be undone. Ladder positions will be recalculated.</span>
      </div>
      <div class="ca-dialog-foot">
        <button class="ca-dialog-cancel" data-cancel>Cancel</button>
        <button class="ca-dialog-confirm" id="caConfirmDelete">Delete match</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => { ca.confirmId = null; wrap.remove(); }));
  wrap.querySelector('#caConfirmDelete').addEventListener('click', async () => {
    const id = ca.confirmId;
    try {
      if (m.format === 'doubles') await window.api.deleteDoublesMatch(id);
      else await window.api.deletePickupMatch(id);
      ca.all = ca.all.filter((x) => x.id !== id);
      ca.confirmId = null;
      wrap.remove();
      _caRenderFeed();
      _caToast('Ladder match deleted');
    } catch (err) {
      toast(err.message || 'Failed to delete.', 'error');
    }
  });
}

function _caToast(text) {
  const host = document.querySelector('.main-wrapper') || document.body;
  host.querySelector('.ca-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'ca-toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  host.appendChild(el);
  clearTimeout(ca.toastTimer);
  ca.toastTimer = setTimeout(() => el.remove(), 2400);
}

export async function renderClubActivity() {
  document.getElementById('pageTitle').textContent = 'Club Activity';
  document.getElementById('topbarActions').innerHTML = '';

  const content = document.getElementById('mainContent');
  content.classList.add('ca-page');
  content.innerHTML = `<div class="ca-loading">Loading…</div>`;
  ca.query = ''; ca.filter = 'all'; ca.limit = CA_PAGE; ca.loading = false; ca.confirmId = null;
  document.getElementById('caDialog')?.remove();

  // The feed is paged here rather than by date: search and filters work over
  // every recorded match, not just the ones scrolled into view.
  const rows = await window.api.getActivity(3650);
  ca.all = (rows || []).map(_caShape);

  if (ca.onScroll) content.removeEventListener('scroll', ca.onScroll);
  ca.onScroll = () => {
    if (!content.querySelector('.ca-feed')) return;
    if (content.scrollTop + content.clientHeight >= content.scrollHeight - 160) _caLoadMore();
  };
  content.addEventListener('scroll', ca.onScroll, { passive: true });
  _caRender();
}

// ===== CLUB SETTINGS =====
// Every IANA zone the browser knows, with the chosen one selected. Older
// browsers without supportedValuesOf get a short list of plausible zones.
function _timezoneOptionsHTML(current) {
  let zones;
  try { zones = Intl.supportedValuesOf('timeZone'); } catch (_) {
    zones = ['America/Winnipeg', 'America/Toronto', 'America/Vancouver', 'America/Edmonton',
      'America/Regina', 'America/Halifax', 'America/St_Johns', 'UTC'];
  }
  if (!zones.includes(current)) zones = [current, ...zones];
  return zones.map((z) =>
    `<option value="${esc(z)}"${z === current ? ' selected' : ''}>${esc(z.replace(/_/g, ' '))}</option>`).join('');
}

export async function renderClubSettings() {
  document.getElementById('pageTitle').textContent = 'Club Settings';
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.getElementById('mainContent');
  content.innerHTML = `<div style="padding:20px;color:var(--text-muted)">Loading…</div>`;

  const [courts, bookingTypes, seasons, settings, clubSettings] = await Promise.all([
    window.api.getCourts(),
    window.api.getBookingTypes(),
    window.api.getSeasons(),
    window.api.getSeasonSettings(),
    window.api.getSettings(),
  ]);

  // The API resolves these through the ladder's own defaults, so a setting that
  // has never been saved still shows the value actually in force.
  const ladderCfg = clubSettings.ladder || {};

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const [startMonth, startDay] = String(settings.season_start_md || '09-01').split('-');

  content.innerHTML = `
    <div class="settings-page">
      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title">Seasons</h2>
        </div>
        <p class="settings-section-desc">
          Seasons group match history so profiles can show a season at a time. They are worked out
          from the date a match was played, so there is nothing to create or switch over: set the
          day the year rolls over and it repeats every year. The first season keeps the original
          position ladder; every season after it uses ratings.
        </p>
        <div class="season-settings">
          <div class="form-group">
            <label class="form-label" for="fSeasonStart">Season starts</label>
            <div class="season-md">
              <select class="form-control" id="fSeasonStartMonth">
                ${MONTHS.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${startMonth === String(i + 1).padStart(2, '0') ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
              <select class="form-control" id="fSeasonStartDay">
                ${Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))
                  .map((d) => `<option value="${d}" ${startDay === d ? 'selected' : ''}>${Number(d)}</option>`).join('')}
              </select>
            </div>
            <p class="form-hint">Every year on this day, a new season begins.</p>
          </div>
          <div class="form-actions" style="justify-content:flex-start">
            <button class="btn btn-primary" id="btnSaveSeasonSettings">Save</button>
          </div>
        </div>

        <div class="court-list" style="margin-top:6px">
          ${seasons.map((s) => `
            <div class="court-item">
              <div class="court-item-name">
                ${esc(s.name)}${s.is_current ? '<span class="season-current-chip">Current</span>' : ''}
                <div class="season-meta">
                  ${s.ladder_system === 'elo' ? 'Rating ladder' : 'Position ladder'} ·
                  ${formatShortDate(s.start_date)} – ${formatShortDate(s.end_date)}
                  · ${s.usage.matches === 0 ? 'no matches' : `${s.usage.matches} match${s.usage.matches === 1 ? '' : 'es'}`}
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title">Time zone</h2>
        </div>
        <p class="settings-section-desc">
          The club's clock. Everything time-related follows this time zone for everyone, no
          matter where their own device thinks it is: the schedule's Now line, what counts as
          today, and when a booking or event is in the past.
        </p>
        <div class="season-settings">
          <div class="form-group">
            <label class="form-label" for="fClubTimezone">Club time zone</label>
            <select class="form-control" id="fClubTimezone">${_timezoneOptionsHTML(clubSettings.club_timezone || 'America/Winnipeg')}</select>
            <p class="form-hint">Right now at the club: <span id="clubTzPreview"></span></p>
          </div>
          <div class="form-actions" style="justify-content:flex-start">
            <button class="btn btn-primary" id="btnSaveClubTimezone">Save</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title">Joining the ladder</h2>
        </div>
        <p class="settings-section-desc">
          A member joins the ladder by playing a match, and not before, so a Club Locker rating
          never holds a rank on its own. What it does decide is where they come in on the day they
          first play; the result of that match, and every one after it, moves them from there.
          Change these and the ladder recalculates: nothing is stored, so you can try a number, look
          at the ladder, and try another.
        </p>
        <div class="season-settings">
          <div class="form-group">
            <label class="form-label" for="fRatingFloor">Mid-ladder rating</label>
            <input class="form-control" id="fRatingFloor" type="number" min="0" max="10" step="0.1"
              value="${esc(String(ladderCfg.elo_club_locker_pivot))}">
            <p class="form-hint">
              The Club Locker rating that comes in at the middle of the ladder, on
              ${esc(String(ladderCfg.elo_base_rating))}. Ratings above it enter higher, below it
              lower.
            </p>
          </div>
          <div class="form-group">
            <label class="form-label" for="fUnplayedBonus">Points per rating point</label>
            <input class="form-control" id="fUnplayedBonus" type="number" min="0" max="600" step="10"
              value="${esc(String(ladderCfg.elo_club_locker_scale))}">
            <p class="form-hint">
              How far each point of Club Locker rating moves that entry point. Bigger spreads new
              players further apart; smaller brings them all closer to the middle.
              <span id="bonusHint"></span>
            </p>
          </div>
          <div class="form-actions" style="justify-content:flex-start">
            <button class="btn btn-primary" id="btnSaveLadderSettings">Save</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title">Winning margin</h2>
        </div>
        <p class="settings-section-desc">
          How much the scoreline counts. A 3-1 is the middle result and scores at face value; a 3-0
          pays more and a 3-2 pays less. The exchange stays even either way, so a narrow defeat costs
          exactly as much less as a narrow win pays less.
        </p>
        <div class="season-settings">
          <div class="form-group">
            <label class="form-label" for="fMarginWeight">Weight per game</label>
            <input class="form-control" id="fMarginWeight" type="number" min="0" max="0.5" step="0.05"
              value="${esc(String(ladderCfg.elo_margin_weight))}">
            <p class="form-hint">
              How much each game of margin is worth, either side of a 3-1. Zero ignores the
              scoreline: a win is a win. <span id="marginHint"></span>
            </p>
          </div>
          <div class="form-actions" style="justify-content:flex-start">
            <button class="btn btn-primary" id="btnSaveMargin">Save</button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title">Courts</h2>
          <button class="btn btn-primary btn-sm" id="btnAddCourt">+ Add Court</button>
        </div>
        ${courts.length === 0
          ? `<div class="settings-empty">No courts yet. Add your first court to get started.</div>`
          : `<div class="court-list">
              ${courts.map((c) => `
                <div class="court-item">
                  <span class="court-item-name">${esc(c.name)}</span>
                  <div class="court-item-actions">
                    <button class="btn btn-outline btn-sm" data-court-edit="${c.id}">Rename</button>
                    <button class="btn btn-danger btn-sm" data-court-delete="${c.id}">Delete</button>
                  </div>
                </div>
              `).join('')}
            </div>`
        }
      </div>

      <div class="settings-section">
        <div class="settings-section-header">
          <h2 class="settings-section-title">Booking Types</h2>
          <button class="btn btn-primary btn-sm" id="btnAddBookingType">+ Add Type</button>
        </div>
        <p class="settings-section-desc">Custom booking types appear in the court schedule.</p>
        ${bookingTypes.length === 0
          ? `<div class="settings-empty">No booking types yet.</div>`
          : `<div class="court-list">
              ${bookingTypes.map((bt) => `
                <div class="court-item">
                  <div class="court-item-name" style="display:flex;align-items:center;gap:10px">
                    <span class="btype-swatch" style="background:${esc(bt.color)}"></span>
                    ${esc(bt.name)}
                  </div>
                  <div class="court-item-actions">
                    <button class="btn btn-outline btn-sm" data-btype-edit="${bt.id}">Edit</button>
                    <button class="btn btn-danger btn-sm" data-btype-delete="${bt.id}">Delete</button>
                  </div>
                </div>
              `).join('')}
            </div>`
        }
      </div>
    </div>`;

  document.getElementById('btnSaveSeasonSettings').addEventListener('click', async () => {
    const md = `${document.getElementById('fSeasonStartMonth').value}-${document.getElementById('fSeasonStartDay').value}`;
    try {
      await window.api.updateSeasonSettings({ season_start_md: md });
      toast('Season settings saved');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const tzSelect = document.getElementById('fClubTimezone');
  const tzPreview = () => {
    const el = document.getElementById('clubTzPreview');
    if (!el || !tzSelect) return;
    try {
      el.textContent = new Intl.DateTimeFormat('en-US', {
        timeZone: tzSelect.value, weekday: 'short', hour: 'numeric', minute: '2-digit',
      }).format(new Date());
    } catch (_) { el.textContent = '—'; }
  };
  tzPreview();
  tzSelect?.addEventListener('change', tzPreview);
  document.getElementById('btnSaveClubTimezone')?.addEventListener('click', async () => {
    try {
      await window.api.updateSettings({ club_timezone: tzSelect.value });
      // The running session follows the new clock immediately.
      if (state.currentUser) state.currentUser.club_timezone = tzSelect.value;
      toast('Time zone saved');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Worked through on two real ratings, so neither number is abstract.
  const floorInput = document.getElementById('fRatingFloor');
  const bonusInput = document.getElementById('fUnplayedBonus');
  const bonusHint = document.getElementById('bonusHint');
  const showBonus = () => {
    const base = Number(ladderCfg.elo_base_rating);
    const pivot = Number(floorInput.value || 0);
    const scale = Number(bonusInput.value || 0);
    const at = (r) => Math.round(base + (r - pivot) * scale);
    bonusHint.textContent = `A 3.0 would come in on ${at(3)}, a 5.0 on ${at(5)}.`;
  };
  showBonus();
  bonusInput?.addEventListener('input', showBonus);
  floorInput?.addEventListener('input', showBonus);

  document.getElementById('btnSaveLadderSettings')?.addEventListener('click', async () => {
    try {
      await window.api.updateSettings({
        elo_club_locker_pivot: floorInput.value,
        elo_club_locker_scale: bonusInput.value,
      });
      toast('Ladder settings saved');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Worked through on an evenly matched game, where the difference is clearest.
  const marginInput = document.getElementById('fMarginWeight');
  const marginHint = document.getElementById('marginHint');
  const showMargin = () => {
    const k = Number(ladderCfg.elo_k_factor);
    const w = Number(marginInput.value || 0);
    const at = (games) => (k / 2 * Math.max(0.2, 1 + (games - 2) * w)).toFixed(1);
    marginHint.textContent =
      `Between evenly matched players: 3-0 pays ${at(3)}, 3-1 pays ${at(2)}, 3-2 pays ${at(1)}.`;
  };
  showMargin();
  marginInput?.addEventListener('input', showMargin);

  document.getElementById('btnSaveMargin')?.addEventListener('click', async () => {
    try {
      await window.api.updateSettings({ elo_margin_weight: marginInput.value });
      toast('Winning margin saved');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('btnAddCourt').addEventListener('click', openAddCourtModal);

  content.querySelectorAll('[data-court-edit]').forEach((btn) => {
    const id = Number(btn.dataset.courtEdit);
    const name = courts.find((c) => c.id === id)?.name || '';
    btn.addEventListener('click', () => openEditCourtModal(id, name));
  });

  content.querySelectorAll('[data-court-delete]').forEach((btn) => {
    const id = Number(btn.dataset.courtDelete);
    const name = courts.find((c) => c.id === id)?.name || '';
    btn.addEventListener('click', () => deleteCourtConfirm(id, name));
  });

  document.getElementById('btnAddBookingType').addEventListener('click', openAddBookingTypeModal);

  content.querySelectorAll('[data-btype-edit]').forEach((btn) => {
    const id = Number(btn.dataset.btypeEdit);
    const bt = bookingTypes.find((b) => b.id === id);
    btn.addEventListener('click', () => openEditBookingTypeModal(bt));
  });

  content.querySelectorAll('[data-btype-delete]').forEach((btn) => {
    const id = Number(btn.dataset.btypeDelete);
    const bt = bookingTypes.find((b) => b.id === id);
    btn.addEventListener('click', () => deleteBookingTypeConfirm(bt));
  });
}

function openAddCourtModal() {
  modal.open('Add Court', `
    <form id="courtForm">
      <div class="form-group">
        <label class="form-label">Court Name</label>
        <input class="form-control" type="text" id="fCourtName" placeholder="e.g. Court 1" maxlength="50" autofocus>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Court</button>
      </div>
    </form>
  `);
  document.getElementById('courtForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('fCourtName').value.trim();
    if (!name) return;
    try {
      await window.api.addCourt({ name });
      modal.close();
      toast('Court added');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openEditCourtModal(id, name) {
  modal.open('Rename Court', `
    <form id="courtForm">
      <div class="form-group">
        <label class="form-label">Court Name</label>
        <input class="form-control" type="text" id="fCourtName" value="${esc(name)}" maxlength="50">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);
  document.getElementById('courtForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = document.getElementById('fCourtName').value.trim();
    if (!newName) return;
    try {
      await window.api.updateCourt(id, { name: newName });
      modal.close();
      toast('Court renamed');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function deleteCourtConfirm(id, name) {
  modal.open('Delete Court', `
    <p style="margin:0 0 16px">Are you sure you want to delete <strong>${esc(name)}</strong>?</p>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
      <button type="button" class="btn btn-danger" id="btnConfirmDeleteCourt">Delete</button>
    </div>
  `);
  document.getElementById('btnConfirmDeleteCourt').addEventListener('click', async () => {
    try {
      await window.api.deleteCourt(id);
      modal.close();
      toast('Court deleted');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openAddBookingTypeModal() {
  modal.open('Add Booking Type', `
    <form id="btypeForm">
      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="form-control" type="text" id="fBtypeName" placeholder="e.g. Junior Training" maxlength="60" autofocus>
      </div>
      <div class="form-group">
        <label class="form-label">Colour</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="color" id="fBtypeColor" value="#3b82f6" style="width:44px;height:36px;padding:2px;border:1px solid var(--border);border-radius:6px;cursor:pointer">
          <span id="fBtypeColorHex" style="font-size:13px;color:var(--text-muted)">#3b82f6</span>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add</button>
      </div>
    </form>
  `);
  document.getElementById('fBtypeColor').addEventListener('input', (e) => {
    document.getElementById('fBtypeColorHex').textContent = e.target.value;
  });
  document.getElementById('btypeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('fBtypeName').value.trim();
    const color = document.getElementById('fBtypeColor').value;
    if (!name) return;
    try {
      await window.api.addBookingType({ name, color });
      modal.close();
      toast('Booking type added');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openEditBookingTypeModal(bt) {
  modal.open('Edit Booking Type', `
    <form id="btypeForm">
      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="form-control" type="text" id="fBtypeName" value="${esc(bt.name)}" maxlength="60">
      </div>
      <div class="form-group">
        <label class="form-label">Colour</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="color" id="fBtypeColor" value="${esc(bt.color)}" style="width:44px;height:36px;padding:2px;border:1px solid var(--border);border-radius:6px;cursor:pointer">
          <span id="fBtypeColorHex" style="font-size:13px;color:var(--text-muted)">${esc(bt.color)}</span>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);
  document.getElementById('fBtypeColor').addEventListener('input', (e) => {
    document.getElementById('fBtypeColorHex').textContent = e.target.value;
  });
  document.getElementById('btypeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('fBtypeName').value.trim();
    const color = document.getElementById('fBtypeColor').value;
    if (!name) return;
    try {
      await window.api.updateBookingType(bt.id, { name, color });
      modal.close();
      toast('Booking type updated');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function deleteBookingTypeConfirm(bt) {
  modal.open('Delete Booking Type', `
    <p style="margin:0 0 16px">Delete <strong>${esc(bt.name)}</strong>? Existing bookings with this type will keep their appearance but lose the type label.</p>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" onclick="modal.close()">Cancel</button>
      <button type="button" class="btn btn-danger" id="btnConfirmDeleteBtype">Delete</button>
    </div>
  `);
  document.getElementById('btnConfirmDeleteBtype').addEventListener('click', async () => {
    try {
      await window.api.deleteBookingType(bt.id);
      modal.close();
      toast('Booking type deleted');
      renderClubSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ===== ADMIN DASHBOARD HELPERS =====
function _localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _parseTimeMins(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function _fmtMins(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function _courtStatus(court, slots, nowMins) {
  const DAY_START = 6 * 60;
  const DAY_END = 23 * 60;

  if (!court.active || nowMins < DAY_START || nowMins >= DAY_END) {
    return { text: 'Unavailable', type: 'unavailable', endMins: null };
  }

  const courtSlots = slots.filter((s) =>
    s.courtId === court.id || (s.courtIds && s.courtIds.includes(court.id)),
  ).map((s) => ({ ...s, _startMins: _parseTimeMins(s.startTime) }))
    .filter((s) => s._startMins !== null);

  const active = courtSlots.find((s) => nowMins >= s._startMins && nowMins < s._startMins + s.durationMinutes);

  if (active) {
    const endMins = active._startMins + active.durationMinutes;
    const endFmt = _fmtMins(endMins);
    if (active.players && active.players.length > 0) {
      const firstName = active.players[0].name.split(' ')[0];
      return { text: `Booked until ${endFmt} by ${firstName}`, type: 'booked', endMins };
    }
    if (active.source === 'league') return { text: `League Match until ${endFmt}`, type: 'booked', endMins };
    if (active.source === 'tournament') return { text: `Tournament until ${endFmt}`, type: 'booked', endMins };
    if (active.title && active.title !== 'Booked') return { text: `${active.title} until ${endFmt}`, type: 'booked', endMins };
    return { text: `Booked until ${endFmt}`, type: 'booked', endMins };
  }

  const next = courtSlots
    .filter((s) => s._startMins > nowMins)
    .sort((a, b) => a._startMins - b._startMins)[0];

  if (next) {
    const minsUntil = next._startMins - nowMins;
    return { text: `Available until ${_fmtMins(next._startMins)}`, type: minsUntil <= 120 ? 'available-soon' : 'available', endMins: next._startMins };
  }

  return { text: 'Available', type: 'available', endMins: null };
}

// ===== DASHBOARD =====
export async function renderDashboard() {
  document.getElementById('pageTitle').textContent = 'Dashboard';
  document.getElementById('topbarActions').innerHTML = '';
  const content = document.getElementById('mainContent');
  content.innerHTML = `<div class="dashboard-loading">Loading…</div>`;

  const user = state.currentUser;

  if (!user || user.role === 'admin') {
    document.querySelector('.content').classList.add('content--dashboard');
    const todayStr = _localDateStr();
    const [scheduleData, activity, verifiedData] = await Promise.all([
      window.api.getSchedule(todayStr),
      window.api.getActivity(1),
      window.api.getVerifiedPlayerCount(),
    ]);

    const { courts, slots } = scheduleData;
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    const totalPlayers = (state.players || []).length;
    const verifiedPlayers = verifiedData?.count ?? 0;
    const bookingsToday = slots.filter((s) => s.source === 'custom').length;
    const matchesToday = activity.length;

    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const DAY_END_MINS = 23 * 60;
    const courtCardsHTML = courts.map((court) => {
      const status = _courtStatus(court, slots, nowMins);

      let nextLine = '';
      const showNext = status.type !== 'unavailable'
        && status.endMins !== null
        && status.endMins < DAY_END_MINS;
      if (showNext) {
        const next = _courtStatus(court, slots, status.endMins);
        if (next.type !== 'unavailable') {
          nextLine = `<div class="adm-court-next">Next: ${esc(next.text)}</div>`;
        }
      }

      return `<div class="adm-court-card adm-court-${status.type}" onclick="navigate('schedule')" role="button" tabindex="0">
        <div class="adm-court-name">${esc(court.name)}</div>
        <div class="adm-court-indicator"></div>
        <div class="adm-court-status">${esc(status.text)}</div>
        ${nextLine}
      </div>`;
    }).join('');

    content.innerHTML = `
      <div class="dp-wrap">
        <div class="dp-columns">
          <div class="dp-main">
            <div class="adm-hero">
              <div class="adm-hero-bg" style="background-image:url('/assets/WSRC-EXTERIOR-ANGLE.jpg')"></div>
              <div class="adm-hero-overlay">
                <div class="adm-hero-top">
                  <div class="adm-hero-greeting">Welcome Back.</div>
                  <div class="adm-hero-date">${esc(dateStr)}</div>
                </div>
                <div class="adm-hero-divider"></div>
                <div class="league-stats">
                  <div class="stat"><span class="stat-val">${totalPlayers}</span><span class="stat-label">Total Players</span></div>
                  <div class="stat"><span class="stat-val">${verifiedPlayers}</span><span class="stat-label">Verified Players</span></div>
                  <div class="stat"><span class="stat-val">${bookingsToday}</span><span class="stat-label">Court Bookings Today</span></div>
                  <div class="stat"><span class="stat-val">${matchesToday}</span><span class="stat-label">Matches Recorded Today</span></div>
                </div>
              </div>
            </div>

            ${courts.length > 0 ? `
              <div class="section">
                <div class="section-title">Court Status <div class="divider"></div></div>
                <div class="adm-courts-grid">${courtCardsHTML}</div>
              </div>
            ` : ''}
          </div>
          <div class="dp-right">
            <div class="dp-right-title">Club Activity</div>
            ${buildActivityHTML(activity, true)}
          </div>
        </div>
      </div>`;
    return;
  }


  // ===== MEMBER DASHBOARD =====
  // One column, mobile first. A greeting, one card that answers "what's next
  // for you", the two things a member does here (report a score, book a
  // court), their numbers, what is coming up, and what the club has been
  // doing. Every block reads an endpoint that already existed.
  await renderMemberDashboard(user, content);
}

// ===== MEMBER DASHBOARD =====

const MO_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const _dhDate = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00');
const _dhFirst = (name) => String(name || '').trim().split(/\s+/)[0] || '';
/** 'Thu 10 Sep' */
const _dhShort = (iso) => { const d = _dhDate(iso); return `${WD_SHORT[d.getDay()]} ${d.getDate()} ${MO_SHORT[d.getMonth()]}`; };
/** 'Wednesday' */
const _dhWeekday = (iso) => WD_LONG[_dhDate(iso).getDay()];
const _dhShiftDay = (iso, n) => {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// The club writes times in 24h everywhere it stores them, and the schedule,
// the booking grid and the league pages all show them that way; the dashboard
// does not become the one surface that reads them back differently.
const _dhTime = (t) => String(t || '').slice(0, 5);
const _dhList = (names) => {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
};

// ── The one card at the top ───────────────────────────────────────────────────

/**
 * Which of the six hero states to show, and what it needs. The first match
 * wins, so exactly one card is ever built.
 *
 * The order differs from a plain "score, then next match, then bye" in one
 * place: a bye in the week running now outranks a fixture in a later one,
 * because "no match this week" is the answer to what the member is asking.
 * A fixture *this* week always wins, whatever other leagues say.
 */
export function heroState({ reportable = [], upcoming = [], byes = [], ladder = null, ladderSize = 0, gap = '', feed = [], played = false, today }) {
  // Only a match that has already happened can be waiting on a score; the
  // reportable list is every unplayed match of theirs, future ones included.
  // A match with no date cannot be in the future either, so it counts, last.
  const owed = reportable
    .filter((m) => !m.scheduled_date || m.scheduled_date < today)
    .sort((a, b) => String(a.scheduled_date || '9999').localeCompare(String(b.scheduled_date || '9999')));
  if (owed.length) return { kind: 'report', match: owed[0] };

  const next = upcoming.find((m) => m.week_date && m.week_date >= today) || null;
  const weekEnd = _dhShiftDay(today, 6);
  const byeNow = byes.find((b) => b.week_date <= today && _dhShiftDay(b.week_date, 6) >= today) || null;
  const fixtureThisWeek = next && next.week_date <= weekEnd;
  if (byeNow && !fixtureThisWeek) return { kind: 'bye', bye: byeNow, next };
  if (next) return { kind: 'next', match: next };

  if (ladder?.position) return { kind: 'ladder', rank: ladder.position, total: ladderSize, gap };
  // Nobody has beaten them yet and nobody has: the club is the invitation.
  if (!played) return { kind: 'newcomer', total: ladderSize };
  // Everything else - excluded from the ladder, a season that has frozen -
  // gets the club rather than a blank.
  return feed.length ? { kind: 'club', result: feed[0] } : { kind: 'newcomer', total: ladderSize };
}

/**
 * The line under "Keep climbing": how far the next place is.
 *
 * A rated season can say it in points. A positional season has no rating to
 * subtract, so it says the thing that is true there instead - one win is a
 * place.
 */
export function ladderGapCopy(rows, rank, system) {
  if (!rank) return '';
  if (system !== 'elo') return 'One win moves you up.';
  const me = rows[rank - 1];
  const above = rows[rank - 2];
  const below = rows[rank];
  if (!me || me.rating == null) return 'One win moves you up.';
  if (rank === 1) {
    if (!below || below.rating == null) return 'Top of the club.';
    return `${me.rating - below.rating} points ahead of #2.`;
  }
  if (!above || above.rating == null) return 'One win moves you up.';
  const diff = above.rating - me.rating;
  if (diff <= 0) return `Level on points with #${rank - 1}.`;
  return `${diff} points away from #${rank - 1}.`;
}

// ── On the schedule ───────────────────────────────────────────────────────────

/**
 * The next six things with the member's name on them, in time order: their
 * court bookings, their fixtures, and the events they can still join.
 *
 * Bookings are only ever fetched for members, and the server already hides
 * members-only events from everyone else, so a row never has to mention
 * membership - it is simply not there.
 */
export function scheduleRows({ bookings = [], upcoming = [], events = [], today, meId, limit = 6 }) {
  const rows = [];

  for (const b of bookings) {
    const others = (b.players || []).filter((p) => p.id !== meId).map((p) => p.name);
    const mine = b.bookedBy === meId;
    const byClub = b.bookedBy == null;
    const sub = mine
      ? (others.length ? `with ${_dhList(others)}` : 'Solo booking')
      : byClub
        ? `Booked by the club${others.length ? ` · with ${_dhList(others)}` : ''}`
        : `${b.bookerName || 'Another member'} booked · with you`;
    rows.push({
      kind: 'booking', id: b.id, date: b.date, time: b.startTime,
      title: `${b.courtName} · ${_dhTime(b.startTime)} · ${b.durationMinutes} min`,
      sub,
      tag: b.typeName ? { name: b.typeName, color: b.typeColor || '#6b7e93' } : null,
      action: mine ? 'Manage' : 'Details',
      courtId: b.courtId,
    });
  }

  for (const m of upcoming) {
    if (!m.week_date || m.week_date < today) continue;
    rows.push({
      kind: 'match', id: m.id, date: m.week_date, time: m.match_time || '',
      title: `Your match · ${m.opponent_name || 'TBD'}${m.match_time ? ` · ${_dhTime(m.match_time)}` : ''}`,
      sub: [m.league_name, m.division_name].filter(Boolean).join(' '),
      action: 'Details',
    });
  }

  for (const e of events) {
    if (e.event_date < today) continue;
    const going = !!e.my_signup;
    const others = Math.max(0, (e.members_count || 0) - 1);
    rows.push({
      kind: 'event', id: e.id, date: e.event_date, time: e.start_time || '',
      title: `${e.name}${e.start_time ? ` · ${_dhTime(e.start_time)}` : ''}`,
      sub: going
        ? (others ? `You and ${others} other${others === 1 ? '' : 's'} are going` : "You're going")
        : e.full ? 'Event is full'
          : e.spots_left == null ? 'Open to everyone'
            : `${e.spots_left} spot${e.spots_left === 1 ? '' : 's'} open`,
      going,
      joinable: !going && !e.full,
    });
  }

  return rows
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)))
    .slice(0, limit);
}

// ── Around the club ───────────────────────────────────────────────────────────

/**
 * The club feed: results, each preceded by the ladder move it caused.
 *
 * The move is the newer fact, so it sits above its own match. Only rises are
 * shown - nobody is listed moving down. A rating season has no places to move,
 * so those rows simply do not arise.
 */
export function feedRows(activity, meId, limit = 7) {
  const out = [];
  for (const m of activity) {
    const shaped = _caShape(m);
    if (shaped.moved > 0) {
      out.push({ kind: 'move', id: `mv_${shaped.id}`, at: m.confirmed_at, winner: shaped.winners[0], moved: shaped.moved, passed: m.passed || [], meId });
    }
    out.push({ kind: 'result', id: shaped.id, at: m.confirmed_at, m: shaped, meId });
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/** The member's current run of wins or losses, newest match first. */
export function streakOf(history) {
  const played = history.filter((m) => m.result === 'W' || m.result === 'L');
  if (!played.length) return null;
  const result = played[0].result;
  let n = 0;
  while (n < played.length && played[n].result === result) n++;
  return { result, n, last: played[0].week_date };
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const DH_ICON = {
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
};

// The hero and the feed own their circles, and colour them by role rather than
// by name: on the hero the person you are playing, in the feed the winner navy
// and the loser pale, so a result reads before a single word of it does.
const _dhAv = (p, cls) => `<span class="${cls}${p?.photo_path ? ' has-photo' : ''}">${avatarInner(p)}</span>`;

// ── Render ────────────────────────────────────────────────────────────────────

async function renderMemberDashboard(user, content) {
  const playerId = user.playerId;
  const today = clubTodayStr();
  const nowMin = clubNow().minutes;
  const member = isMember();

  const [playerData, ladderData, activity, doubles, reportable, bookings, events, slot] = await Promise.all([
    fetch(`/api/players/${playerId}/history`).then((r) => r.json()),
    window.api.getLadderForSeason().catch(() => null),
    window.api.getActivity().catch(() => []),
    Promise.resolve().then(() => (window.api.getPlayerDoubles ? window.api.getPlayerDoubles(playerId) : null)).catch(() => null),
    window.api.getReportable().catch(() => []),
    member ? window.api.getMyBookings().catch(() => []) : Promise.resolve([]),
    window.api.getEvents('upcoming').catch(() => []),
    member ? window.api.getSuggestedSlot().catch(() => null) : Promise.resolve(null),
  ]);

  // Doubles fixtures and results sit beside the singles ones, as they do on the
  // profile: the next match is the next match whatever the format. The ladder
  // ring and the singles record stay singles.
  const pairName = (list) => (list || []).map((o) => o.name).join(' & ');
  const dblUpcoming = (doubles?.upcoming || []).map((m) => ({
    id: m.id, week_date: m.week_date, match_time: m.match_time, court_name: m.court_name,
    league_name: m.league_name, division_name: m.division_name, week_number: m.week_number,
    opponent_id: null, opponent_name: pairName(m.opponents), partner_name: m.partner?.name || '', format: 'doubles',
  }));
  const upcoming = [...(playerData.upcoming || []), ...dblUpcoming]
    .sort((a, b) => (a.week_date || '').localeCompare(b.week_date || '') || String(a.match_time || '').localeCompare(String(b.match_time || '')));

  const rows = ladderData?.rows || [];
  const system = ladderData?.system || 'leapfrog';
  const ladder = playerData.ladder || null;
  const rank = ladder?.position ?? null;
  const ladderSize = rows.length || ladder?.ladder_size || 0;
  const gap = ladderGapCopy(rows, rank, system);

  const season = (playerData.seasons || []).find((s) => s.is_current) || null;
  const inSeason = (key) => !season || key === season.key;
  const singles = (playerData.history || []).filter((m) => inSeason(m.season_key));
  const dbl = (doubles?.history || []).filter((m) => inSeason(m.season_key));
  const sW = singles.filter((m) => m.result === 'W').length;
  const sL = singles.filter((m) => m.result === 'L').length;
  const dW = dbl.filter((m) => m.result === 'W').length;
  const dL = dbl.filter((m) => m.result === 'L').length;
  // The two records are the season's, as the profile and the ladder report
  // them. A streak is not a total but a run of form, so it reads the whole
  // history - a season boundary does not end a run of wins.
  const streak = streakOf([
    ...(playerData.history || []).map((m) => ({ result: m.result, week_date: m.week_date })),
    ...(doubles?.history || []).map((m) => ({ result: m.result, week_date: String(m.played_at || '').slice(0, 10) })),
  ].sort((a, b) => String(b.week_date).localeCompare(String(a.week_date))));

  const played = !!(playerData.history || []).length || !!(doubles?.history || []).length;
  const feed = feedRows(activity, playerId);
  const hero = heroState({
    reportable, upcoming, byes: playerData.byes || [], ladder, ladderSize, gap,
    feed: feed.filter((r) => r.kind === 'result'), played, today,
  });

  const sched = scheduleRows({ bookings, upcoming, events, today, meId: playerId });
  const firstName = _dhFirst(playerData.name || user.name);
  const fresh = playerData.created_at
    && (Date.now() - new Date(String(playerData.created_at).replace(' ', 'T') + 'Z').getTime()) < 7 * 864e5;
  const hourNow = Math.floor(nowMin / 60);
  const greeting = fresh ? `Welcome, ${firstName}`
    : `Good ${hourNow < 12 ? 'morning' : hourNow < 17 ? 'afternoon' : 'evening'}, ${firstName}`;
  // "Tuesday 15 September" - the club writes dates day-first, as the league
  // pages and the print schedules do.
  const now = new Date();
  const longDate = `${WD_LONG[now.getDay()]} ${now.getDate()} ${now.toLocaleDateString('en-US', { month: 'long' })}`;

  // The app's own header and hamburger stay exactly as they are on every other
  // page; this page only owns what is inside .content.
  document.getElementById('pageTitle').textContent = 'Dashboard';
  document.querySelector('.content').classList.add('content--member-dash');

  content.innerHTML = `
    <div class="dh-page">
      <div class="dh-greet">
        <h2 class="dh-greet-line">${esc(greeting)}</h2>
        <span class="dh-greet-date">${esc(longDate)}</span>
      </div>
      ${_dhHeroHTML(hero)}
      <div class="dh-cta-row">
        ${played || upcoming.length ? _dhReportHTML() : ''}
        ${member ? _dhCourtHTML(slot, today) : ''}
      </div>
      ${played
    ? _dhStatsHTML({ rank, change: ladder?.rank_change || 0, sW, sL, dW, dL, streak })
    : '<div class="dh-stats-empty"><span class="dh-stats-empty-tiles"><i></i><i></i><i></i></span>Your ladder spot, record and streak appear here after your first match.</div>'}
      ${_dhSchedHTML(sched, today)}
      ${_dhFeedHTML(feed, playerId)}
    </div>`;

  _dhWire(content);
}

// ── Hero ──────────────────────────────────────────────────────────────────────

// Every action on the page is one `data-dh` string, read by the single
// delegated handler at the bottom of this file. Pipe-separated, because a start
// time carries a colon of its own; a name never goes in it, since a name can
// carry anything - it travels in `data-dh-name` beside it.
const _dhBtn = (label, act, primary, name) =>
  `<button class="dh-btn${primary ? ' dh-btn--primary' : ''}" data-dh="${esc(act)}"${name ? ` data-dh-name="${esc(name)}"` : ''}>${esc(label)}</button>`;

/** The countdown's inside, so the 60-second tick can rewrite just this much. */
function _dhCountdownHTML(iso, time) {
  const target = new Date(String(iso).slice(0, 10) + 'T' + (time || '12:00') + ':00');
  const diff = target - new Date();
  if (diff <= 0) return { value: '<span class="dh-cd-now">Today</span>', caption: 'MATCH DAY' };
  const d = Math.floor(diff / 864e5);
  const h = Math.floor((diff % 864e5) / 36e5);
  const m = Math.floor((diff % 36e5) / 6e4);
  const part = (n, u) => `<span class="dh-cd-n">${n}</span><span class="dh-cd-u">${u}</span>`;
  return {
    value: d > 0 ? `${part(d, 'd')} ${part(h, 'h')}` : `${part(h, 'h')} ${part(m, 'm')}`,
    caption: 'TIME UNTIL MATCH',
  };
}

function _dhRingHTML(rank, total) {
  const C = 2 * Math.PI * 42;
  const progress = total > 1 ? (total - rank) / (total - 1) : 1;
  return `<span class="dh-ring">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="dh-ring-track" cx="50" cy="50" r="42" fill="none" stroke-width="8"/>
      <circle class="dh-ring-fill" cx="50" cy="50" r="42" fill="none" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - progress)).toFixed(1)}"
        transform="rotate(-90 50 50)"/>
    </svg>
    <span class="dh-ring-in"><b>#${rank}</b><i>OF ${total}</i></span>
  </span>`;
}

function _dhHeroHTML(hero) {
  const card = (cls, inner, lead = '') => `<section class="dh-card${cls}"><div class="dh-card-in">${lead}${inner}</div></section>`;
  const head = (label, title, sub) => `
    <span class="dh-card-label">${esc(label)}</span>
    <h3 class="dh-card-title">${title}</h3>
    ${sub ? `<p class="dh-card-sub">${sub}</p>` : ''}`;

  if (hero.kind === 'report') {
    const m = hero.match;
    const opp = { name: m.opponent_name || (m.opponents || []).map((o) => o.name).join(' & '), photo_path: m.opponent_photo };
    const where = m.type === 'ladder'
      ? (m.format === 'doubles' ? 'Doubles ladder match' : 'Ladder match')
      : [m.league_name, m.division_name].filter(Boolean).join(' ');
    return card(' dh-card--person', `
      ${head(m.scheduled_date ? `Score to report · ${_dhShort(m.scheduled_date)}` : 'Score to report', esc(opp.name || 'Your match'),
    `${esc(where || 'Your match')} · no score entered yet`)}
      <div class="dh-card-btns">
        ${_dhBtn('Report score', `report|${m.id}`, true)}
        ${_dhBtn('Match details', `match|${m.id}`)}
      </div>`, _dhAv(opp, 'dh-face'));
  }

  if (hero.kind === 'next') {
    const m = hero.match;
    const cd = _dhCountdownHTML(m.week_date, m.match_time);
    const sub = [
      _dhShort(m.week_date),
      m.match_time ? _dhTime(m.match_time) : null,
      [m.league_name, m.division_name].filter(Boolean).join(' ') || null,
      m.partner_name ? `with ${m.partner_name}` : null,
    ].filter(Boolean).map(esc).join(' · ');
    return card('', `
      ${head(`Next match · ${_dhWeekday(m.week_date)}`, esc(m.opponent_name || 'TBD'), sub)}
      <div class="dh-countdown" id="dhCountdown" data-date="${esc(m.week_date)}" data-time="${esc(m.match_time || '')}">
        <span class="dh-cd-val">${cd.value}</span>
        <span class="dh-cd-cap">${cd.caption}</span>
      </div>
      <div class="dh-card-btns">
        ${_dhBtn('Match details', `match|${m.id}`, true)}
        ${m.opponent_id ? _dhBtn(`Message ${_dhFirst(m.opponent_name)}`, `msg|${m.opponent_id}`, false, m.opponent_name) : ''}
      </div>`);
  }

  if (hero.kind === 'bye') {
    const n = hero.next;
    const sub = n
      ? `Next up · ${esc(n.opponent_name || 'TBD')} · ${esc(_dhShort(n.week_date))}${n.match_time ? ` · ${esc(_dhTime(n.match_time))}` : ''}`
      : 'Your league picks up again next week.';
    return card('', `
      ${head(`Bye this week · ${hero.bye.league_name}`, 'No match this week', sub)}
      <div class="dh-card-btns">
        ${_dhBtn('League schedule', `league|${hero.bye.league_id}`, true, hero.bye.league_name)}
      </div>`);
  }

  if (hero.kind === 'ladder') {
    const top = hero.rank === 1;
    return card(' dh-card--ring', `
      ${_dhRingHTML(hero.rank, hero.total)}
      <div class="dh-ring-text">
        ${head('Ladder', top ? 'Top of the ladder' : 'Keep climbing', esc(hero.gap))}
      </div>
      <div class="dh-card-btns">
        ${_dhBtn('Enter a match', 'pickup', true)}
        ${_dhBtn('Find a player', 'players')}
      </div>`);
  }

  if (hero.kind === 'club') {
    const r = hero.result.m;
    const line = `${_dhList(r.winners.map((p) => p.name))} beat ${_dhList(r.losers.map((p) => p.name))} ${r.score}`;
    return card(' dh-card--club', `
      ${head(`Around the club · ${timeAgo(hero.result.at)}`, esc(line), esc(r.tag))}
      <div class="dh-card-btns">${_dhBtn('All activity', 'activity', true)}</div>`);
  }

  return card(' dh-card--big', `
    ${head(hero.total ? `Ladder · ${hero.total} members` : 'Ladder', 'Start your climb',
    'One match is all it takes to get your spot.')}
    <div class="dh-card-btns">
      ${_dhBtn('Enter a match', 'pickup', true)}
      ${_dhBtn('Find a player', 'players')}
    </div>`);
}

// ── Report a score, Book a court ──────────────────────────────────────────────

function _dhReportHTML() {
  return `
    <button class="dh-report" data-dh="reportScore">
      <span class="dh-cta-icon">${DH_ICON.pencil}</span>
      <span class="dh-cta-text">
        <b>Report a score</b>
        <i>Ladder or league</i>
      </span>
      <span class="dh-cta-go"><span class="dh-go-short">Enter</span><span class="dh-go-long">Enter score</span></span>
    </button>`;
}

function _dhCourtHTML(slot, today) {
  const line = slot
    ? `${slot.courtName} · ${_dhWhenWord(slot.date, today)}${_dhTime(slot.startTime)}`
    : 'No open courts today';
  return `
    <div class="dh-court">
      <span class="dh-cta-icon">${DH_ICON.cal}</span>
      <span class="dh-cta-text">
        <i class="dh-court-label">Book a court</i>
        <b>${esc(line)}</b>
      </span>
      <button class="dh-cta-go dh-cta-go--navy" data-dh="${esc(slot ? `book|${slot.courtId}|${slot.date}|${slot.startTime}` : 'book')}">${slot
    ? '<span class="dh-go-short">Book</span><span class="dh-go-long">Book it</span>'
    : 'Schedule'}</button>
    </div>`;
}

/** 'today ' / 'tomorrow ' / 'Thu ' — the word that goes before a time. */
function _dhWhenWord(date, today) {
  if (date === today) return 'today ';
  if (date === _dhShiftDay(today, 1)) return 'tomorrow ';
  return `${WD_SHORT[_dhDate(date).getDay()]} `;
}

// ── Numbers ───────────────────────────────────────────────────────────────────

function _dhStatsHTML({ rank, change, sW, sL, dW, dL, streak }) {
  const move = change > 0 ? `<em class="dh-up">▲ ${change}</em>`
    : change < 0 ? `<em class="dh-down">▼ ${Math.abs(change)}</em>`
      : '<em>no change</em>';
  const played = dW + dL;
  const streakCap = !streak ? 'none yet'
    : streak.n > 1 ? `${streak.n} ${streak.result === 'W' ? 'wins' : 'losses'}`
      : `last ${WD_SHORT[_dhDate(streak.last).getDay()]}`;
  const tile = (value, caption, label) =>
    `<div class="dh-stat"><b>${value}</b><span class="dh-stat-cap">${caption}</span><span class="dh-stat-lbl">${esc(label)}</span></div>`;
  return `<div class="dh-stats">
    ${tile(rank ? `#${rank}` : '—', rank ? move : '<em>not yet</em>', 'Ladder')}
    ${tile(`${sW}–${sL}`, '<em>season</em>', 'Singles')}
    ${tile(played ? `${dW}–${dL}` : '—', played ? '<em>season</em>' : '<em>none yet</em>', 'Doubles')}
    ${tile(streak ? `${streak.result}${streak.n}` : '—', `<em>${esc(streakCap)}</em>`, 'Streak')}
  </div>`;
}

// ── On the schedule ───────────────────────────────────────────────────────────

/** A 15%-alpha fill and a darkened ink from one booking-type colour. */
function _dhTint(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return { bg: '#eef2ff', fg: '#1e2758' };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const dark = [r, g, b].map((c) => Math.round(c * 0.55));
  return { bg: `rgba(${r},${g},${b},.15)`, fg: `rgb(${dark[0]},${dark[1]},${dark[2]})` };
}

function _dhSchedHTML(rows, today) {
  const body = rows.length
    ? rows.map((r) => {
      const d = _dhDate(r.date);
      const tint = r.tag ? _dhTint(r.tag.color) : null;
      const tag = r.tag
        ? `<span class="dh-sched-tag" style="background:${tint.bg};color:${tint.fg}">${esc(r.tag.name)}</span>` : '';
      const right = r.kind === 'event'
        ? (r.going
          ? '<span class="dh-sched-going">✓ Going</span>'
          : r.joinable ? `<button class="dh-sched-join" data-dh="event|${r.id}">Join</button>` : '')
        : `<button class="dh-sched-act" data-dh="${esc(_dhRowAction(r))}">${esc(r.action)}</button>`;
      return `<div class="dh-sched-row">
          <span class="dh-sched-day${r.date === today ? ' dh-sched-day--now' : ''}">
            <i>${WD_SHORT[d.getDay()].toUpperCase()}</i><b>${d.getDate()}</b>
          </span>
          <span class="dh-sched-text">
            <span class="dh-sched-title">${esc(r.title)}${tag}</span>
            <span class="dh-sched-sub">${esc(r.sub)}</span>
          </span>
          ${right}
        </div>`;
    }).join('')
    : '<p class="dh-sched-empty">Nothing coming up. Events and your matches show here.</p>';
  return `<section class="dh-sched">
    <div class="dh-block-head"><h3>On the schedule</h3></div>
    ${body}
  </section>`;
}

const _dhRowAction = (r) => (r.kind === 'match' ? `match|${r.id}` : `book|${r.courtId}|${r.date}|`);

// ── Around the club ───────────────────────────────────────────────────────────

function _dhFeedHTML(rows, meId) {
  const head = `<div class="dh-block-head">
      <h3>Around the club</h3>
      <button class="dh-block-link" data-dh="activity">All activity</button>
    </div>`;
  if (!rows.length) {
    return `<section class="dh-feed">${head}
      <p class="dh-sched-empty">No results yet this week.</p>
    </section>`;
  }
  const body = rows.map((r) => {
    if (r.kind === 'move') {
      // Full names, because that is who the club knows; a pair is abbreviated
      // only because two of them plus two more never fit on a phone.
      const names = r.passed.length
        ? _dhList(r.passed.map((p) => (p.id === meId ? 'you' : p.name)))
        : `${r.moved} player${r.moved === 1 ? '' : 's'}`;
      return `<div class="dh-feed-row dh-feed-row--move">
          <span class="dh-move-icon">${DH_ICON.up}</span>
          <span class="dh-feed-text"><b>${esc(r.winner.name)}</b> passes ${esc(names)}</span>
          <span class="dh-feed-when">${esc(timeAgo(r.at))}</span>
          <span class="dh-move-n">▲ ${r.moved}</span>
        </div>`;
    }
    const m = r.m;
    const iLost = m.losers.some((p) => p.id === meId);
    const pair = m.format === 'doubles';
    const avs = `<span class="dh-avs${pair ? ' dh-avs--pair' : ''}">${
      m.winners.map((p) => _dhAv(p, 'dh-av')).join('')
    }<span class="dh-avs-gap"></span>${
      m.losers.map((p) => _dhAv(p, 'dh-av dh-av--lost')).join('')
    }</span>`;
    const who = (p) => (pair ? abbrevName(p.name) : p.name);
    const loserText = iLost ? 'you' : _dhList(m.losers.map(who));
    return `<div class="dh-feed-row" data-match="${m.id}">
        ${avs}
        <span class="dh-feed-text">
          <b>${esc(_dhList(m.winners.map(who)))}</b> beat ${esc(loserText)}${pair ? '<i class="dh-feed-dbl"> · doubles</i>' : ''}
        </span>
        <span class="dh-feed-when">${esc(timeAgo(r.at))}</span>
        <span class="dh-feed-score${iLost ? ' dh-feed-score--lost' : ''}">${esc(m.score)}</span>
      </div>`;
  }).join('');
  return `<section class="dh-feed">${head}${body}</section>`;
}

// ── Wiring ────────────────────────────────────────────────────────────────────

// One timer for the whole page. Cleared when the dashboard is rebuilt or the
// element leaves, so navigating away never leaves it running.
let _dhTick = null;

function _dhWire(content) {
  if (_dhTick) clearInterval(_dhTick);

  content.addEventListener('click', (e) => {
    const el = e.target.closest('[data-dh]');
    if (!el) return;
    const [verb, a, b, c] = el.dataset.dh.split('|');
    const name = el.dataset.dhName || '';
    switch (verb) {
      case 'report': window.navigate('reportScore', { matchId: Number(a) }); break;
      case 'reportScore': window.navigate('reportScore'); break;
      case 'match': window.openMatchCard(a); break;
      case 'msg': openMessagePlayerModal(Number(a), name); break;
      case 'league': window.navigate('leagueDetail', { league: { id: Number(a), name } }); break;
      case 'pickup': window.openPickupGameModal(); break;
      case 'players': window.navigate('players'); break;
      case 'activity': window.navigate('activity'); break;
      case 'event': window.navigate('events', { eventId: Number(a) }); break;
      case 'book':
        window.navigate('courtBooking', a
          ? { booking: { courtId: Number(a), date: b, startTime: c || null } }
          : {});
        break;
      default: break;
    }
  });

  const cd = document.getElementById('dhCountdown');
  if (!cd) return;
  _dhTick = setInterval(() => {
    if (!cd.isConnected) { clearInterval(_dhTick); _dhTick = null; return; }
    const next = _dhCountdownHTML(cd.dataset.date, cd.dataset.time);
    cd.querySelector('.dh-cd-val').innerHTML = next.value;
    cd.querySelector('.dh-cd-cap').textContent = next.caption;
  }, 60000);
}
