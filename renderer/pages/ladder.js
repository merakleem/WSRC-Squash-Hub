import { state, isAdmin } from '../state.js';
import { esc, toast, modal, avatarHTML } from '../utils.js';

// Which season the ladder is showing. null = the current season.
let _ladderSeason = null;
// Search box contents. Filtering is client-side; the whole ladder is already here.
let _ladderQuery = '';
// Torn down and rebuilt on every row render, since the observed row is replaced.
let _selfObserver = null;

function _attachLadderSeasonTabs() {
  document.querySelectorAll('[data-ladder-season]').forEach((tab) => {
    tab.addEventListener('click', () => {
      // Selecting the current season returns to the live ladder rather than
      // pinning to its id; otherwise there is no way back to "today", and
      // state.ladder would stay frozen for the rest of the session.
      _ladderSeason = tab.dataset.ladderCurrent === '1' ? null : tab.dataset.ladderSeason;
      // A filter carried across seasons would silently hide most of the new one.
      _ladderQuery = '';
      renderLadder();
    });
  });
}

// Called when navigating to the Ladder from elsewhere, so a historical season
// left selected earlier doesn't silently persist across the session.
export function resetLadderSeason() {
  _ladderSeason = null;
  _ladderQuery = '';
}

// A fourth way into the existing "enter a match" modal, alongside the dashboard
// quick action, the empty state's button and the players page. Hidden on a
// finished season, and for a viewer who is neither a player nor an admin, since
// neither could produce a valid submission.
function _fabHTML(frozen) {
  if (frozen) return '';
  if (!state.currentUser?.playerId && !isAdmin()) return '';
  return `
    <button class="em-fab" id="ldrEnterMatch" aria-label="Enter a match">
      <svg class="em-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      <span class="em-fab-label">Enter a match</span>
    </button>`;
}

function _wireFab() {
  document.getElementById('ldrEnterMatch')?.addEventListener('click', () => window.openPickupGameModal());
}

// ===== LADDER PAGE =====
// The list scrolls inside .content, not the document, and Safari on iOS honours
// `behavior: 'smooth'` only on the document - on any other scroller it jumps.
// Animating the scroller directly gives every browser the same movement.
function _smoothScrollTo(el, reduceMotion) {
  let box = el.parentElement;
  while (box) {
    const style = getComputedStyle(box);
    if (/(auto|scroll)/.test(style.overflowY) && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }

  // Nothing between the row and the document scrolls, which the browser can
  // animate itself.
  if (!box) {
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    return;
  }

  const target = Math.max(0, Math.min(
    box.scrollHeight - box.clientHeight,
    el.offsetTop - box.offsetTop - (box.clientHeight - el.offsetHeight) / 2,
  ));
  if (reduceMotion) { box.scrollTop = target; return; }

  const from = box.scrollTop;
  const distance = target - from;
  if (Math.abs(distance) < 2) return;
  // Long jumps take a little longer, but never so long that the page feels
  // stuck: a ladder of 100 still lands inside half a second.
  const duration = Math.min(480, 180 + Math.abs(distance) * 0.25);
  const started = performance.now();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const step = (now) => {
    const t = Math.min(1, (now - started) / duration);
    box.scrollTop = from + distance * ease(t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export async function renderLadder() {
  document.getElementById('pageTitle').innerHTML = `Ladder <button class="info-bubble" id="btnLadderInfo" style="vertical-align:middle">i</button>`;
  document.getElementById('topbarActions').innerHTML = '';

  const [ladderResult, recordsArr, seasons] = await Promise.all([
    window.api.getLadderForSeason(_ladderSeason),
    window.api.getPlayerRecords(),
    window.api.getSeasons().catch(() => []),
  ]);

  const ladder = ladderResult.rows || [];
  const isElo = ladderResult.system === 'elo';
  const season = ladderResult.season;
  // Only cache the live current-season ladder; other pages read state.ladder
  // expecting today's standings, not a historical snapshot.
  const viewingCurrent = !_ladderSeason || (season && season.is_current);
  if (viewingCurrent) state.ladder = ladder;

  const records = Array.isArray(recordsArr)
    ? Object.fromEntries(recordsArr.map((r) => [r.id, r]))
    : recordsArr;

  const content = document.getElementById('mainContent');

  const seasonBarHTML = seasons.length < 2 ? '' : `
    <div class="season-tabs" id="ladderSeasonTabs">
      ${seasons.map((s) => `
        <button class="season-tab${season && s.id === season.id ? ' active' : ''}${s.is_current ? ' season-tab--current' : ''}" data-ladder-season="${s.id}" data-ladder-current="${s.is_current ? 1 : 0}">
          ${esc(s.name)}
        </button>`).join('')}
    </div>`;

  if (ladder.length === 0) {
    // An empty state that only explains is a dead end; the one thing a player
    // can do from here is record a game, so it offers that.
    content.innerHTML = `
      ${seasonBarHTML}
      <div class="table-card">
        <div class="empty-state">
          <strong>No standings yet</strong>
          <p>${season ? `No matches have been played in ${esc(season.name)} yet.` : 'Add players on the Players page and they will appear here.'}</p>
          ${ladderResult.frozen ? '' : `<button class="btn btn-primary" id="ldrEmptyReport">Report a ladder match</button>`}
        </div>
      </div>
      ${_fabHTML(ladderResult.frozen)}`;
    document.getElementById('ldrEmptyReport')?.addEventListener('click', () => window.openPickupGameModal());
    _wireFab();
    _attachLadderSeasonTabs();
    return;
  }

  const myId  = state.currentUser?.playerId;

  const rankChangeBadge = (change) => {
    if (!change || change === 0) return '';
    // A glyph arrow sits on the text baseline and never lines up with the
    // number beside it; an inline SVG in a flex-centred badge does.
    const tri = `<svg class="mv-tri" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 3 L10.2 8.6 L1.8 8.6 Z" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`;
    if (change > 0) return `<span class="ldr-change ldr-change-up">${tri}${change}</span>`;
    return `<span class="ldr-change ldr-change-down">${tri}${Math.abs(change)}</span>`;
  };

  // W/L belongs to the season being viewed under either system, so the numbers
  // agree with the standing beside them and with the player's profile. Career
  // totals are the fallback only when the club has no seasons configured at all,
  // where every row arrives without a season record.
  const recordFor = (p) => (p.season_wins == null
    ? (records[p.id] || { wins: 0, losses: 0 })
    : { wins: p.season_wins || 0, losses: p.season_losses || 0 });

  // Movement is shown as places gained or lost beside the name, the same as the
  // positional ladder. The rating column carries the number only.
  const ratingCell = (p) => {
    if (!isElo) return '';
    return `<span class="ldr-all-stat ldr-col-rating">${p.rating ?? '—'}</span>`;
  };

  // Rows are the page's main navigation, so they have to be reachable without a
  // mouse. role/tabindex rather than a real <button> because the row contains
  // the avatar div, which is not valid button content.
  const allRowHTML = (p, rank) => {
    const rec   = recordFor(p);
    const total = rec.wins + rec.losses;
    const pct   = total > 0 ? Math.round(rec.wins / total * 100) : null;
    const isMe  = p.id === myId;
    const podium = rank <= 3 ? ` ldr-pos-${rank}` : '';
    const label = `${p.name}, rank ${rank}${isMe ? ', you' : ''}, ${rec.wins} won ${rec.losses} lost`;
    return `
      <div class="ldr-all-row${isMe ? ' ldr-all-me' : ''}${isElo ? ' ldr-row-elo' : ''}${podium}"
        role="button" tabindex="0" aria-label="${esc(label)}"
        data-action="view-profile" data-id="${p.id}">
        <span class="ldr-all-rank">${rank}</span>
        <div class="ldr-all-player">
          ${avatarHTML(p, 'ldr-avatar ldr-avatar-sm')}
          <span class="ldr-all-name">${esc(p.name)}${isMe ? '<span class="ldr-you-chip">YOU</span>' : ''}</span>
          ${ladderResult.frozen ? '' : rankChangeBadge(p.rank_change)}
        </div>
        ${ratingCell(p)}
        <span class="ldr-all-stat ldr-col-won">${rec.wins}</span>
        <span class="ldr-all-stat ldr-col-lost">${rec.losses}</span>
        <span class="ldr-all-stat ldr-col-played">${total}</span>
        <span class="ldr-all-stat ldr-col-winpct">${pct !== null ? pct + '%' : '—'}</span>
      </div>`;
  };

  // Rank is the ladder position, never the position within a filtered list, so
  // searching cannot make someone look like they are 1st.
  const ranked = ladder.map((p, i) => ({ player: p, rank: i + 1 }));
  const myEntry = ranked.find((r) => r.player.id === myId) || null;

  const rowsHTML = (query) => {
    const q = query.trim().toLowerCase();
    const shown = q ? ranked.filter((r) => r.player.name.toLowerCase().includes(q)) : ranked;
    if (shown.length === 0) {
      return `<div class="ldr-no-match">
        <strong>No players match “${esc(query.trim())}”</strong>
        <button class="btn btn-outline btn-sm" data-action="clear-search">Clear search</button>
      </div>`;
    }
    return shown.map((r) => allRowHTML(r.player, r.rank)).join('');
  };

  const countText = (query) => {
    const q = query.trim().toLowerCase();
    const shown = q ? ranked.filter((r) => r.player.name.toLowerCase().includes(q)).length : ranked.length;
    return q ? `${shown} of ${ranked.length} players` : `${ranked.length} player${ranked.length === 1 ? '' : 's'}`;
  };

  const toolbarHTML = `
    <div class="ldr-toolbar">
      <div class="ldr-search">
        <svg class="ldr-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/>
        </svg>
        <input type="search" id="ldrSearch" class="ldr-search-input" placeholder="Search players"
          autocomplete="off" aria-label="Search players" value="${esc(_ladderQuery)}">
      </div>
      <span class="ldr-count" id="ldrCount" role="status">${countText(_ladderQuery)}</span>
      ${myEntry ? `<button class="btn btn-outline btn-sm ldr-jump" id="ldrJumpMe">Jump to my rank</button>` : ''}
    </div>`;

  // Someone who has not played yet has no row to scroll to, so the bar cannot
  // be about finding them - it tells them why they are not on the list and what
  // to do about it. Only on the live season, and never for a member the club has
  // taken off the ladder, who has nothing to gain by playing.
  const myPlayer = (state.players || []).find((p) => p.id === myId) || null;
  const showUnrankedBar = !!myId && !myEntry && viewingCurrent && !ladderResult.frozen
    && !(myPlayer && myPlayer.exclude_from_ladder);

  const unrankedBarHTML = !showUnrankedBar ? '' : `
    <div class="ldr-selfbar ldr-selfbar-unranked show" id="ldrSelfBar">
      <span class="ldr-selfbar-rank ldr-selfbar-unranked-tag">Unranked</span>
      <span class="ldr-selfbar-name">Play a match to join the ladder.</span>
    </div>`;

  const selfBarHTML = !myEntry ? unrankedBarHTML : (() => {
    const rec = recordFor(myEntry.player);
    const total = rec.wins + rec.losses;
    const pct = total > 0 ? Math.round(rec.wins / total * 100) : null;
    return `
      <div class="ldr-selfbar" id="ldrSelfBar" aria-hidden="true">
        <span class="ldr-selfbar-rank">#${myEntry.rank}</span>
        <span class="ldr-selfbar-name">${esc(myEntry.player.name)}</span>
        <span class="ldr-selfbar-rec">${rec.wins}–${rec.losses}${pct === null ? '' : ` · ${pct}%`}</span>
        <button class="ldr-selfbar-btn" id="ldrSelfBarJump">Jump to my rank</button>
      </div>`;
  })();

  content.innerHTML = `
    ${seasonBarHTML}
    <div class="ldr-player-wrap" id="ladderList">
      <div class="ldr-section-block">
        ${toolbarHTML}
        <div class="ldr-all-table">
          <div class="ldr-all-header${isElo ? ' ldr-row-elo' : ''}" role="presentation">
            <span class="ldr-all-rank">#</span>
            <span class="ldr-all-player">PLAYER</span>
            ${isElo ? '<span class="ldr-all-stat ldr-col-rating">RATING</span>' : ''}
            <span class="ldr-all-stat ldr-col-won"><span class="ldr-col-long">WON</span><span class="ldr-col-short">W</span></span>
            <span class="ldr-all-stat ldr-col-lost"><span class="ldr-col-long">LOST</span><span class="ldr-col-short">L</span></span>
            <span class="ldr-all-stat ldr-col-played">PLAYED</span>
            <span class="ldr-all-stat ldr-col-winpct">WIN %</span>
          </div>
          <div id="ldrRows">${rowsHTML(_ladderQuery)}</div>
        </div>
      </div>
      ${selfBarHTML}
    </div>
    ${_fabHTML(ladderResult.frozen)}`;

  const listEl = document.getElementById('ladderList');
  const rowsEl = document.getElementById('ldrRows');
  const searchEl = document.getElementById('ldrSearch');
  const selfBar = document.getElementById('ldrSelfBar');
  _wireFab();

  const openRow = (el) => window.openPlayerProfile(Number(el.dataset.id));

  listEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="clear-search"]')) {
      _ladderQuery = '';
      searchEl.value = '';
      refreshRows();
      searchEl.focus();
      return;
    }
    const el = e.target.closest('[data-action="view-profile"]');
    if (el) openRow(el);
  });

  // Enter and Space are what a button would do, so the row does the same.
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-action="view-profile"]');
    if (!el) return;
    e.preventDefault();
    openRow(el);
  });

  // The observed row is replaced on every filter, so the observer is rebuilt
  // alongside it rather than kept for the life of the page.
  function watchOwnRow() {
    _selfObserver?.disconnect();
    _selfObserver = null;
    if (!selfBar) return;

    // The unranked bar has no row to follow and is not about finding one: it
    // stays put. Without this the observer would hide it the moment it renders.
    if (selfBar.classList.contains('ldr-selfbar-unranked')) return;

    const meRow = rowsEl.querySelector('.ldr-all-me');
    if (!meRow) { selfBar.classList.remove('show'); return; }

    _selfObserver = new IntersectionObserver((entries) => {
      const visible = entries[0].isIntersecting;
      selfBar.classList.toggle('show', !visible);
      selfBar.setAttribute('aria-hidden', visible ? 'true' : 'false');
    }, { root: document.getElementById('mainContent'), threshold: 0.6 });
    _selfObserver.observe(meRow);
  }

  function refreshRows() {
    rowsEl.innerHTML = rowsHTML(_ladderQuery);
    document.getElementById('ldrCount').textContent = countText(_ladderQuery);
    watchOwnRow();
  }

  let searchTimer = null;
  searchEl.addEventListener('input', () => {
    // Debounced because every keystroke rebuilds the whole list.
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _ladderQuery = searchEl.value;
      refreshRows();
    }, 120);
  });

  function jumpToMe() {
    // Clear a filter that would otherwise be hiding the row we want to reveal.
    if (_ladderQuery.trim()) {
      _ladderQuery = '';
      searchEl.value = '';
      refreshRows();
    }
    const meRow = rowsEl.querySelector('.ldr-all-me');
    if (!meRow) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    _smoothScrollTo(meRow, reduceMotion);
    meRow.classList.remove('ldr-flash');
    // Reflow between remove and add so a second press replays the highlight.
    void meRow.offsetWidth;
    meRow.classList.add('ldr-flash');
    meRow.focus({ preventScroll: true });
  }

  document.getElementById('ldrJumpMe')?.addEventListener('click', jumpToMe);
  document.getElementById('ldrSelfBarJump')?.addEventListener('click', jumpToMe);

  watchOwnRow();
  _attachLadderSeasonTabs();

  document.getElementById('btnLadderInfo')?.addEventListener('click', () => {
    modal.open('How the Ladder Works', isElo ? `
      <div class="info-modal-section">
        <h4>Play a match to get ranked</h4>
        <p>Record your first match to join the ladder. Starting positions are carried over from last season's results. New members' starting positions are based on their Club Locker rating.</p>
      </div>
      <div class="info-modal-section">
        <h4>Who you beat matters</h4>
        <p>Beating someone rated well above you is worth a lot. Beating someone well below you is worth very little, and losing to them costs you a lot. Evenly matched games move both players by a moderate amount either way.</p>
      </div>` : `
      <div class="info-modal-section">
        <h4>Starting positions</h4>
        <p>The ladder is everyone who has played; play a match and you're on it. New arrivals slot in below every member rated at least as highly as they are, and members without a rating start at the bottom.</p>
      </div>
      <div class="info-modal-section">
        <h4>Moving up</h4>
        <p>Beat a player ranked above you and you jump straight to their position. They drop one spot, and everyone between you shifts down to fill the gap. Win an upset and you climb immediately.</p>
      </div>
      <div class="info-modal-section">
        <h4>No change</h4>
        <p>Beating someone already ranked below you doesn't move anyone. Positions only shift when a lower-ranked player wins.</p>
      </div>
      <div class="info-modal-section">
        <h4>What counts</h4>
        <p>All recorded matches count. League matches and ladder matches reported through Quick Actions.</p>
      </div>`);
  });
}
