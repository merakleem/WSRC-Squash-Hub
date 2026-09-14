// ===== PLAYER PROFILE =====
// The profile page: header, ladder standing, season tabs, results, upcoming,
// tournaments and the doubles tab. Split from players.js (the list page),
// which keeps the admin entry points this page reuses.

import { state, isAdmin } from '../state.js';
import { esc, formatShortDate, toast, avatarHTML, formatShortDateWeekday } from '../utils.js';
import { openEditPlayerModal, confirmDeletePlayer, openMessagePlayerModal, showAuthLinkModal } from './players.js';
import { openPhotoModal } from './playerPhoto.js';
import { openPickupGameModal } from './ladderMatch.js';


// Selected season tab: null = All Time, 'none' = matches with no season, or a
// season id. Tracked alongside the player it was chosen for; back-navigation
// swaps state.currentPlayer without going through openPlayerProfile, so a
// selection must never be trusted for a different player.
let _profileSeason = null;
let _profileSeasonFor = null;
// The one player id the profile has already re-fetched for; see renderPlayerProfile.
let _profileRefetchedFor = null;
// Desktop panel and the Results source filter. Reset with the season selection
// so a stale tab never opens on a different player.
let _profileTab = 'results';
let _profileResultFilter = 'all';
// Mobile has no tab bar, so a quick link opens the panel as a sub-view over the
// column. null means the column itself is showing.
let _profileMobileView = null;

export async function openPlayerProfile(id, { pushHistory = true } = {}) {
  // The doubles record travels beside the singles payload, never inside it,
  // so renderPlayerProfile stays synchronous and the two are never merged.
  const [player, doubles] = await Promise.all([
    window.api.getPlayerHistory(id),
    Promise.resolve().then(() => (window.api.getPlayerDoubles ? window.api.getPlayerDoubles(id) : null)).catch(() => null),
  ]);
  if (player && typeof player === 'object') player.doubles = doubles;
  window.navigate('playerProfile', { player }, { pushHistory });
}

export function renderPlayerProfile() {
  const p = state.currentPlayer;
  if (!p) { window.navigate('players'); return; }

  // A players-list row can reach here in place of the profile payload, and it
  // renders as a player with no matches, no rank and no seasons. The payload
  // always carries a history array, so its absence means the page was given
  // the wrong object: fetch the right one rather than draw a blank. Once only -
  // if what comes back has no history either, that is what the server has, and
  // asking again would spin: the first version of this looped a test page's
  // stubbed API forever and wedged the tab.
  if (!Array.isArray(p.history) && _profileRefetchedFor !== p.id) {
    _profileRefetchedFor = p.id;
    openPlayerProfile(p.id, { pushHistory: false });
    return;
  }
  if (Array.isArray(p.history)) _profileRefetchedFor = null;

  const adminMode = isAdmin();
  document.getElementById('pageTitle').textContent = p.name;
  const acctStatus = p.accountStatus || 'none'; // 'verified' | 'pending' | 'none'
  const hasEmail = !!p.email;

  const isOwnProfile = !adminMode && state.currentUser?.playerId === p.id;
  document.getElementById('topbarActions').innerHTML = adminMode ? `
    <div class="options-menu" id="optionsMenu">
      <button class="btn btn-outline" id="optionsBtn">Options <svg width="14" height="14" viewBox="0 0 4 14" fill="currentColor" style="vertical-align:middle;margin-left:2px"><circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="7" r="1.5"/><circle cx="2" cy="12" r="1.5"/></svg></button>
      <div class="options-dropdown" id="optionsDropdown">
        <button class="options-item" data-action="edit-player" data-id="${p.id}">Edit Information</button>
        <button class="options-item" data-action="view-as" data-id="${p.id}">View as this player</button>
        ${hasEmail && acctStatus !== 'verified' ? `<button class="options-item" data-action="send-invite">Send Invite</button>` : ''}
        ${hasEmail && acctStatus === 'verified' ? `<button class="options-item" data-action="send-reset">Send Password Reset</button>` : ''}
        <button class="options-item options-item-danger" data-action="delete-player" data-id="${p.id}" data-name="${esc(p.name)}">Delete Player</button>
      </div>
    </div>`
  : !isOwnProfile ? `<button class="btn btn-outline" id="btnMessagePlayer">Message</button>` : '';

  if (adminMode) {
    document.getElementById('optionsBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('optionsDropdown').classList.toggle('open');
    });
    document.getElementById('optionsDropdown').addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      document.getElementById('optionsDropdown').classList.remove('open');
      if (action === 'view-as') {
        // Swaps the session for this player's. The server records that an admin
        // did it, which is what makes the way back possible.
        try {
          await window.api.viewAsPlayer(p.id);
          location.href = '/';
        } catch (err) {
          toast(err.message || 'Could not view as that player.', 'error');
        }
        return;
      }
      if (action === 'edit-player') {
        const player = state.players.find((pl) => pl.id === Number(e.target.dataset.id))
          || state.currentPlayer;
        openEditPlayerModal(player);
      } else if (action === 'delete-player') {
        confirmDeletePlayer(Number(e.target.dataset.id), e.target.dataset.name);
      } else if (action === 'send-invite') {
        try {
          const result = await window.api.sendInvite(p.id);
          if (result.emailSent) {
            toast('Invite email sent!', 'success');
          } else {
            showAuthLinkModal('Invite Link', result.inviteUrl);
          }
        } catch (err) {
          toast(err.message || 'Failed to send invite.', 'error');
        }
      } else if (action === 'send-reset') {
        try {
          const result = await window.api.sendReset(p.id);
          if (result.emailSent) {
            toast('Password reset email sent!', 'success');
          } else {
            showAuthLinkModal('Password Reset Link', result.resetUrl);
          }
        } catch (err) {
          toast(err.message || 'Failed to send reset email.', 'error');
        }
      }
    });
    document.addEventListener('click', function closeOptions() {
      document.getElementById('optionsDropdown')?.classList.remove('open');
      document.removeEventListener('click', closeOptions);
    }, { once: false });
  } else if (!isOwnProfile) {
    document.getElementById('btnMessagePlayer')?.addEventListener('click', () => {
      openMessagePlayerModal(p.id, p.name);
    });
  }

  // ===== DATA =====
  // Everything below derives from the single getPlayerHistory payload. Season
  // scoping is applied to history-derived blocks only; the ladder chart and
  // upcoming matches are deliberately all-time.
  const allHistory = p.history || [];
  const seasons = p.seasons || [];
  const seasonsById = Object.fromEntries(seasons.map((s) => [s.id, s]));

  // Every season the club has had is offered, not only the ones this player
  // appeared in. A season they sat out still shows the same page with an empty
  // record, which reads as "you played none" rather than the season vanishing.
  const seasonKeys = seasons.map((sn) => sn.key);
  // Which season to open on is decided over everything they played, doubles
  // included: a player whose only matches this season are doubles used to be
  // opened on last season, with this season's doubles filtered out of sight.
  const anyHistory = [...allHistory, ...((p.doubles?.history) || []).map((m) => ({ ...m, week_date: m.played_at }))]
    .sort((a, b) => (b.week_date || '').localeCompare(a.week_date || ''));
  const hasUnassigned = anyHistory.some((m) => m.season_key == null);

  // The current season is the default while there is something of theirs in
  // it. Otherwise the page opens on the last season they played - history is
  // newest first, so that is the first key in it - because a new season begins
  // on a fixed day whether or not anyone has played yet, and on that day every
  // profile opening blank read as the history being gone.
  const currentKey = seasons.find((sn) => sn.is_current)?.key ?? null;
  const playedIn = (key) => key != null && anyHistory.some((m) => m.season_key === key);
  const lastPlayedKey = anyHistory.map((m) => m.season_key).find((k) => seasonKeys.includes(k)) ?? null;
  const defaultSeason = playedIn(currentKey) ? currentKey
    : lastPlayedKey
    ?? currentKey
    ?? seasonKeys[0]
    ?? (hasUnassigned ? 'none' : null);

  // A remembered selection is only trusted when it belongs to this player;
  // back navigation swaps the player without going through openPlayerProfile.
  const selectionValid = _profileSeasonFor === p.id && (
    _profileSeason === null
    || seasonKeys.includes(_profileSeason)
    || (_profileSeason === 'none' && hasUnassigned)
  );
  const activeSeason = selectionValid ? _profileSeason : defaultSeason;

  // Opening a different player resets the view; a Results filter that matched
  // nothing for them would otherwise render an empty panel with no explanation.
  if (_profileSeasonFor !== p.id) {
    // 'season' was a tab that no longer exists; it only ever fell through to
    // the Results default, so it now says so.
    _profileTab = 'results';
    _profileResultFilter = 'all';
    _profileMobileView = null;
    _profileSeasonFor = p.id;
    _profileSeason = defaultSeason;
  }

  const inSeason = (row) => activeSeason === null
    || (activeSeason === 'none' ? row.season_key == null : row.season_key === activeSeason);

  const history = allHistory.filter(inSeason);
  const tournamentResults = (p.tournamentResults || []).filter(inSeason);
  const upcoming = p.upcoming || [];

  const seasonLabel = activeSeason === null
    ? 'All time'
    : activeSeason === 'none' ? 'Unassigned' : (seasonsById[activeSeason]?.name || 'Season');

  // Empty-state copy naming the selected period, so a profile filtered to
  // "All time" doesn't report that nothing happened "this season".
  const periodPhrase = activeSeason === null
    ? 'recorded'
    : activeSeason === 'none' ? 'outside a season' : `in ${seasonLabel}`;

  const stats = _profileStats(history);

  const ladder = p.ladder || {};
  const isSelf = state.currentUser?.playerId === p.id;

  // ===== DOUBLES DATA =====
  // A separate payload, scoped to the same season, and never folded into the
  // singles numbers: the header, the singles record and the detail strip stay
  // singles-only by design.
  const dbl = p.doubles || {};
  const dblAll = (dbl.history || []).map((m) => ({ ...m, week_date: m.played_at }));
  const doublesHistory = dblAll.filter(inSeason);
  const dblStats = _profileStats(doublesHistory);
  const dblLadder = dbl.ladder || {};
  const dblUpcoming = dbl.upcoming || [];
  const inSeasonPartner = (pt) => activeSeason === null
    || (activeSeason === 'none' ? pt.season_key == null : pt.season_key === activeSeason);
  // Partners arrive per season; "All time" sums them per partner.
  const dblPartners = (() => {
    const by = new Map();
    for (const pt of (dbl.partners || []).filter(inSeasonPartner)) {
      const e = by.get(pt.id) || { ...pt, wins: 0, losses: 0, matches: 0 };
      e.wins += pt.wins; e.losses += pt.losses; e.matches += pt.matches;
      by.set(pt.id, e);
    }
    return [...by.values()].sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
  })();
  const firstName = (n) => String(n || '').split(' ')[0];
  const playerLink = (pl) => (pl?.id
    ? `<span class="nav-player-link" data-player-id="${pl.id}">${esc(pl.name)}</span>`
    : esc(pl?.name || ''));

  // ===== HEADER =====
  const canEditPhoto = adminMode || isSelf;
  const metaBits = [
    adminMode ? p.division_name : null,
    p.member_number ? `Member #${esc(p.member_number)}` : null,
    adminMode && p.email ? esc(p.email) : null,
  ].filter(Boolean);

  const acctBadge = adminMode && acctStatus === 'verified'
    ? `<span class="pp-badge">Verified</span>` : '';

  // The rank block names the system it came from. It reports the current season's
  // standing, the same number the Ladder page and the dashboard ring show, while
  // the career chart further down is a different scale entirely.
  // The rating is dropped on narrow screens, where it would wrap the label onto
  // a third line; the Ladder page carries it prominently either way.
  const rankLabelHTML = [ladder.frozen ? 'Final' : null, ladder.system === 'elo' ? 'Rating ladder' : 'Ladder']
    .filter(Boolean).join(' · ')
    + (ladder.rating == null ? '' : `<span class="pp-hstat-label-extra"> · ${Number(ladder.rating)}</span>`);

  const rankMoveHTML = !ladder.rank_change ? ''
    : `<span class="pp-hstat-move ${ladder.rank_change > 0 ? 'pp-pos' : 'pp-neg'}" title="Places moved in the last 7 days"><svg class="mv-tri" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 3 L10.2 8.6 L1.8 8.6 Z" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>${Math.abs(ladder.rank_change)}</span>`;

  // Nobody is on the ladder until they have played, so a member with no matches
  // gets told what to do about it rather than a gap where a rank would be.
  const rankBlockHTML = ladder.position != null ? `
      <div class="pp-hstat">
        <div class="pp-hstat-val">#${ladder.position}<span class="pp-hstat-sub">of ${ladder.ladder_size}</span>${rankMoveHTML}</div>
        <div class="pp-hstat-label">${rankLabelHTML}</div>
      </div>`
    : ladder.unranked ? `
      <div class="pp-hstat pp-hstat-unranked">
        <div class="pp-hstat-val">Unranked</div>
        <div class="pp-hstat-label">${isSelf ? 'Play a match to join the ladder' : 'No matches played yet'}</div>
      </div>`
    : '';

  const headerStatsHTML = `
    ${rankBlockHTML}
    <div class="pp-hstat pp-hstat-wide">
      <div class="pp-hstat-val">${stats.wins}–${stats.losses}<span class="pp-hstat-sub">${stats.winPct === null ? '' : `${stats.winPct}%`}</span></div>
      <div class="pp-hbar"><span style="width:${stats.winPct || 0}%"></span></div>
      <div class="pp-hstat-label">${esc(seasonLabel)} record</div>
    </div>
    ${stats.currentStreak === 0 ? '' : `
      <div class="pp-hstat">
        <div class="pp-hstat-val ${stats.streakType === 'W' ? 'pp-pos' : 'pp-neg'}">${stats.currentStreak}${stats.streakType}</div>
        <div class="pp-hstat-label">Current streak</div>
      </div>`}`;

  const seasonOptions = [
    ...seasonKeys.map((key) => ({ value: key, label: seasonsById[key]?.name || 'Season' })),
    ...(hasUnassigned ? [{ value: 'none', label: 'Unassigned' }] : []),
    { value: 'all', label: 'All time' },
  ];
  const seasonPillHTML = seasonOptions.length < 2 ? '' : `
    <div class="pp-season-pick">
      <select class="pp-season-select" aria-label="Season">
        ${seasonOptions.map((o) => `<option value="${o.value}" ${String(activeSeason ?? 'all') === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
    </div>`;

  const headerHTML = `
    <div class="pp-header">
      <div class="pp-identity">
        ${canEditPhoto ? `
          <button class="pp-avatar-btn" id="btnEditPhoto" title="Change photo">
            ${avatarHTML(p, 'pp-avatar')}
            <span class="pp-avatar-edit">Edit</span>
          </button>` : avatarHTML(p, 'pp-avatar')}
        <div class="pp-identity-text">
          <h2 class="pp-name">${esc(p.name)}</h2>
          ${metaBits.length ? `<div class="pp-meta">${metaBits.join(' · ')}</div>` : ''}
          ${acctBadge}
        </div>
      </div>
      <div class="pp-header-right">
        ${seasonPillHTML}
        <div class="pp-hstats">${headerStatsHTML}</div>
      </div>
    </div>`;

  // ===== PANELS =====
  // Season and Past seasons are gone: the season pill in the header already
  // controls the period, so both were a second way to do the same thing.
  const TABS = [
    { key: 'results', label: 'Results' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'tournaments', label: 'Tournaments' },
    { key: 'doubles', label: 'Doubles' },
  ];
  // Normalised back onto the module state so the arrow-key handler and the
  // filter rebuild can't read a tab key the DOM never rendered.
  const activeTab = TABS.some((t) => t.key === _profileTab) ? _profileTab : 'results';
  _profileTab = activeTab;

  // A tablist needs aria-selected, a link to its panel, and one stop in the tab
  // order rather than four; arrow keys move between tabs from there.
  const tabBarHTML = `
    <div class="pp-tabs" role="tablist" aria-label="Profile sections">
      ${TABS.map((t) => `
        <button class="pp-tab${t.key === activeTab ? ' active' : ''}" data-pp-tab="${t.key}"
          role="tab" id="ppTab-${t.key}" aria-controls="ppPanel"
          aria-selected="${t.key === activeTab}" tabindex="${t.key === activeTab ? '0' : '-1'}">${t.label}</button>`).join('')}
    </div>`;

  const resultRow = (m, { compact = false } = {}) => {
    const won = m.result === 'W';
    const context = m.source === 'tournament'
      ? [esc(m.league_name), esc(m.round_label || '')].filter(Boolean).join(' · ')
      : m.source === 'pickup'
        ? 'Ladder match'
        : [esc(m.league_name), m.week_number ? `Wk ${m.week_number}` : null,
           m.division_name ? esc(m.division_name.replace(/^Division\s*/i, 'Div ')) : null].filter(Boolean).join(' · ');
    const opponent = m.opponent_id
      ? `<span class="nav-player-link" data-player-id="${m.opponent_id}">${esc(m.opponent_name)}</span>`
      : esc(m.opponent_name);
    // Only matches in a rated season carry a rating change.
    const delta = m.rating_change;
    const deltaHTML = delta === undefined || delta === null ? '' : `
      <span class="pp-row-delta ${delta >= 0 ? 'pp-delta-up' : 'pp-delta-down'}">${delta >= 0 ? '+' : ''}${delta}</span>`;
    return `
      <div class="pp-row" data-match="${m.id}">
        <span class="pp-chip ${won ? 'pp-chip-w' : 'pp-chip-l'}">${won ? 'W' : 'L'}</span>
        <div class="pp-row-main">
          <span class="pp-row-title">${opponent}</span>
          <span class="pp-row-sub">${context}</span>
        </div>
        ${deltaHTML}
        <span class="pp-row-score">${m.my_score}–${m.their_score}</span>
        ${compact ? '' : `<span class="pp-row-date">${formatShortDate(m.week_date)}</span>`}
      </div>`;
  };

  // A doubles result: the two opponents as the title, tagged, and "with
  // {partner}" leading the context line. `short` uses first names, for the
  // phone's Last 3 card.
  const doublesContext = (m, short) => (m.source === 'league'
    ? [esc(m.league_name), m.week_number ? `Wk ${m.week_number}` : null,
       !short && m.division_name ? esc(m.division_name.replace(/^Division\s*/i, 'Div ')) : null].filter(Boolean).join(' · ')
    : 'Doubles ladder');
  const doublesRow = (m, { compact = false, short = false } = {}) => {
    const won = m.result === 'W';
    const opps = m.opponents || [];
    const title = short ? esc(opps.map((o) => firstName(o.name)).join(' & ')) : opps.map(playerLink).join(' & ');
    const partner = short ? esc(firstName(m.partner?.name)) : playerLink(m.partner);
    const delta = m.rating_change;
    const deltaHTML = delta === undefined || delta === null ? '' : `
      <span class="pp-row-delta ${delta >= 0 ? 'pp-delta-up' : 'pp-delta-down'}">${delta >= 0 ? '+' : ''}${delta}</span>`;
    return `
      <div class="pp-row pp-row-dbl" data-match="${m.id}">
        <span class="pp-chip ${won ? 'pp-chip-w' : 'pp-chip-l'}">${won ? 'W' : 'L'}</span>
        <div class="pp-row-main">
          <span class="pp-row-title"><span class="pp-row-title-text">${title}</span><span class="pp-dbl-chip">Doubles</span></span>
          <span class="pp-row-sub"><span class="pp-with">with ${partner} · </span>${doublesContext(m, short)}</span>
        </div>
        ${deltaHTML}
        <span class="pp-row-score">${m.my_score}–${m.their_score}</span>
        ${compact ? '' : `<span class="pp-row-date">${formatShortDate(m.week_date)}</span>`}
      </div>`;
  };
  // Singles and doubles rows in one list, newest first.
  const mergedResults = [...history.map((m) => ({ m, dbl: false })), ...doublesHistory.map((m) => ({ m, dbl: true }))]
    .sort((a, b) => (b.m.week_date || '').localeCompare(a.m.week_date || ''));
  const anyRow = (x, opts) => (x.dbl ? doublesRow(x.m, opts) : resultRow(x.m, opts));

  // `action` is optional: only the states where there is a genuinely available
  // next step get a button, rather than every empty panel growing one.
  const emptyBlock = (msg, action) => `
    <div class="empty-state">
      <strong>${esc(msg)}</strong>
      ${action ? `<button class="btn btn-outline btn-sm" data-pp-action="${action.id}">${esc(action.label)}</button>` : ''}
    </div>`;

  const reportMatchAction = isSelf ? { id: 'report-ladder', label: 'Report a ladder match' } : null;

  // -- Results panel --
  // Carries the season-detail figures that used to live on the Season tab, so
  // removing that tab doesn't lose them from the desktop view.
  const detailStripHTML = stats.played === 0 ? '' : `
    <div class="pp-detail-strip">
      <div><span class="pp-fig">${stats.gamesWon}–${stats.gamesLost}</span><span class="pp-fig-label">Games</span></div>
      <div><span class="pp-fig">${stats.gameWinPct === null ? '—' : `${stats.gameWinPct}%`}</span><span class="pp-fig-label">Game win rate</span></div>
    </div>`;

  const sourceFilters = [
    { key: 'all', label: 'All' },
    { key: 'league', label: 'League' },
    { key: 'pickup', label: 'Ladder' },
    { key: 'tournament', label: 'Tournament' },
    { key: 'doubles', label: 'Doubles' },
  ];
  const dblDetailStripHTML = dblStats.played === 0 ? '' : `
    <div class="pp-detail-strip">
      <div><span class="pp-fig">${dblStats.gamesWon}–${dblStats.gamesLost}</span><span class="pp-fig-label">Doubles games</span></div>
      <div><span class="pp-fig">${dblStats.gameWinPct === null ? '—' : `${dblStats.gameWinPct}%`}</span><span class="pp-fig-label">Game win rate</span></div>
    </div>`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // Takes the filter as an argument so changing it can rebuild this panel alone
  // instead of re-rendering the whole profile.
  const buildResultsPanel = (filterKey) => {
    const filtered = filterKey === 'all' ? mergedResults
      : filterKey === 'doubles' ? mergedResults.filter((x) => x.dbl)
      : mergedResults.filter((x) => !x.dbl && (x.m.source || 'league') === filterKey);
    // The sub-line always states singles; it only mentions doubles when both are shown.
    const subLine = filterKey === 'doubles'
      ? `${plural(dblStats.wins, 'win', 'wins')} · ${plural(dblStats.losses, 'loss', 'losses')} · doubles`
      : filterKey === 'all' && doublesHistory.length
        ? `${plural(stats.wins, 'win', 'wins')} · ${plural(stats.losses, 'loss', 'losses')} · singles, plus ${doublesHistory.length} doubles`
        : `${plural(stats.wins, 'win', 'wins')} · ${plural(stats.losses, 'loss', 'losses')}`;
    return `
    <div class="pp-card">
      <div class="pp-card-head pp-card-head-wrap">
        <div class="pp-card-head-text">
          <span class="pp-card-label">Results · ${esc(seasonLabel)}</span>
          <span class="pp-card-sub">${subLine}</span>
        </div>
        <div class="pp-filters" role="group" aria-label="Filter results by competition">
          ${sourceFilters.map((f) => `
            <button class="pp-filter${filterKey === f.key ? ' active' : ''}" data-pp-filter="${f.key}"
              aria-pressed="${filterKey === f.key}">${f.label}</button>`).join('')}
        </div>
      </div>
      ${filterKey === 'doubles' ? dblDetailStripHTML : detailStripHTML}
      ${filtered.length
        ? filtered.map((x) => anyRow(x)).join('')
        : filterKey === 'all'
          ? emptyBlock(`No matches ${periodPhrase} yet`, reportMatchAction)
          : emptyBlock(`No ${sourceFilters.find((f) => f.key === filterKey)?.label.toLowerCase()} matches ${periodPhrase}`)}
    </div>`;
  };

  // -- Upcoming panel --
  // Singles and doubles fixtures in date order; Next up goes on the first overall.
  const upcomingAll = [...upcoming.map((m) => ({ m, dbl: false })), ...dblUpcoming.map((m) => ({ m, dbl: true }))]
    .sort((a, b) => (a.m.week_date || '').localeCompare(b.m.week_date || ''));
  const upcomingPanelHTML = `
    <div class="pp-card">
      <div class="pp-card-head">
        <span class="pp-card-label">Upcoming matches</span>
        <span class="pp-card-sub">all seasons · ${upcomingAll.length} scheduled</span>
      </div>
      ${upcomingAll.length ? upcomingAll.map(({ m, dbl: isDbl }, i) => {
        const courtLabel = isAdmin() && (m.court_name || (m.schedule_courts && m.court_number ? `Court ${m.court_number}` : null));
        const timing = [m.match_time, courtLabel].filter(Boolean).join(' · ');
        const context = [esc(m.league_name), m.week_number ? `Wk ${m.week_number}` : null].filter(Boolean).join(' · ');
        const opponent = isDbl
          ? `<span class="pp-row-title-text">${(m.opponents || []).map(playerLink).join(' & ') || 'TBD'}</span><span class="pp-dbl-chip">Doubles</span>`
          : m.opponent_id
            ? `<span class="nav-player-link" data-player-id="${m.opponent_id}">${esc(m.opponent_name)}</span>`
            : esc(m.opponent_name || 'TBD');
        return `
          <div class="pp-row pp-row-lg${i === 0 ? ' pp-row-next' : ''}${isDbl ? ' pp-row-dbl' : ''}" data-match="${m.id}">
            <div class="pp-date-block">
              <span class="pp-date-main">${formatShortDateWeekday(m.week_date)}</span>
              ${timing ? `<span class="pp-date-sub">${esc(timing)}</span>` : ''}
            </div>
            <div class="pp-row-main">
              <span class="pp-row-title">${opponent}${i === 0 ? '<span class="pp-next-chip">Next up</span>' : ''}</span>
              <span class="pp-row-sub">${isDbl ? `<span class="pp-with">with ${playerLink(m.partner)} · </span>` : ''}${context}</span>
            </div>
          </div>`;
      }).join('') : emptyBlock('No upcoming matches')}
    </div>`;

  // -- Doubles panel --
  // Doubles stats only: ladder rank and rating, the season record, the streak,
  // and partners. Nothing here reads the singles history.
  const dblRankMoveHTML = !dblLadder.rank_change || dblLadder.frozen ? ''
    : `<span class="pp-hstat-move ${dblLadder.rank_change > 0 ? 'pp-pos' : 'pp-neg'}" title="Places moved in the last 7 days"><svg class="mv-tri" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 3 L10.2 8.6 L1.8 8.6 Z" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>${Math.abs(dblLadder.rank_change)}</span>`;
  const dblRankTileHTML = dblLadder.position != null ? `
      <div class="pp-dbl-tile pp-dbl-tile--navy">
        <div class="pp-dbl-tile-val">#${dblLadder.position}<span class="pp-hstat-sub">of ${dblLadder.size}</span>${dblRankMoveHTML}</div>
        <div class="pp-dbl-tile-label">Doubles ladder${dblLadder.rating == null ? '' : ` · ${Number(dblLadder.rating)}`}</div>
      </div>` : `
      <div class="pp-dbl-tile pp-dbl-tile--navy">
        <div class="pp-dbl-tile-val pp-dbl-tile-val--unranked">Unranked</div>
        <div class="pp-dbl-tile-label">${isSelf ? 'Play a doubles match to join' : 'No doubles matches yet'}</div>
      </div>`;
  const dblStreakTileHTML = `
      <div class="pp-dbl-tile pp-card">
        <div class="pp-dbl-tile-val ${dblStats.streakType === 'W' ? 'pp-delta-up' : dblStats.streakType === 'L' ? 'pp-delta-down' : ''}">${dblStats.currentStreak ? `${dblStats.currentStreak}${dblStats.streakType}` : '—'}</div>
        <div class="pp-dbl-tile-label pp-dbl-tile-label--dark">Doubles streak</div>
      </div>`;
  const dblRecordTileHTML = `
      <div class="pp-dbl-tile pp-card">
        <div class="pp-dbl-tile-val">${dblStats.wins}–${dblStats.losses}<span class="pp-dbl-tile-pct">${dblStats.winPct === null ? '' : `${dblStats.winPct}%`}</span></div>
        <div class="pp-bar"><span style="width:${dblStats.winPct || 0}%"></span></div>
        <div class="pp-dbl-tile-label pp-dbl-tile-label--dark">${esc(seasonLabel)} doubles record</div>
      </div>`;
  const partnersCardHTML = (mobile) => `
    <div class="pp-card">
      <div class="pp-card-head">
        <span class="pp-card-label">Partners · ${esc(seasonLabel)}</span>
      </div>
      ${dblPartners.length ? dblPartners.map((pt) => {
        const played = pt.wins + pt.losses;
        const pct = played ? Math.round(pt.wins / played * 100) : 0;
        return `
        <div class="pp-row pp-partner-row">
          ${avatarHTML(pt, `pp-partner-av${mobile ? ' pp-partner-av--sm' : ''}`)}
          <div class="pp-row-main">
            <span class="pp-row-title">${playerLink(pt)}</span>
            <span class="pp-row-sub">${esc(pt.context || '')}</span>
          </div>
          ${mobile
            ? `<span class="pp-partner-rec-m">${pt.wins}–${pt.losses}</span>`
            : `<div class="pp-partner-rec">
                <span class="pp-partner-rec-val">${pt.wins}–${pt.losses} <span class="pp-partner-pct">${pct}%</span></span>
                <div class="pp-bar pp-partner-bar"><span style="width:${pct}%"></span></div>
              </div>`}
        </div>`;
      }).join('') : emptyBlock(`No doubles matches ${periodPhrase}`)}
    </div>`;
  const doublesPanelHTML = dblAll.length === 0
    ? emptyBlock(`No doubles matches ${periodPhrase} yet`)
    : `<div class="pp-col">
        <div class="pp-dbl-tiles">${dblRankTileHTML}${dblRecordTileHTML}${dblStreakTileHTML}</div>
        ${partnersCardHTML(false)}
      </div>`;
  const doublesMobileHTML = dblAll.length === 0
    ? emptyBlock(`No doubles matches ${periodPhrase} yet`)
    : `
      <div class="pp-dbl-mtiles">${dblRankTileHTML}${dblStreakTileHTML}</div>
      <div class="pp-card pp-card-pad">
        <div class="pp-card-head pp-card-head-bare">
          <span class="pp-card-label">${esc(seasonLabel)} doubles record</span>
        </div>
        ${dblStats.played === 0 ? emptyBlock(`No doubles matches ${periodPhrase}`) : `
          <div class="pp-big">
            <span class="pp-big-w">${dblStats.wins}</span>
            <span class="pp-big-sep">/</span>
            <span class="pp-big-l">${dblStats.losses}</span>
            <span class="pp-big-pct">${dblStats.winPct === null ? '—' : `${dblStats.winPct}%`}</span>
          </div>
          <div class="pp-bar pp-bar-lg"><span style="width:${dblStats.winPct || 0}%"></span></div>
          <div class="pp-figures">
            <div><span class="pp-fig">${dblStats.gamesWon}–${dblStats.gamesLost}</span><span class="pp-fig-label">Games</span></div>
            <div><span class="pp-fig">${dblStats.gameWinPct === null ? '—' : `${dblStats.gameWinPct}%`}</span><span class="pp-fig-label">Game win rate</span></div>
          </div>`}
      </div>
      ${partnersCardHTML(true)}`;

  // -- Tournaments panel --
  const tournPanelHTML = `
    <div class="pp-card">
      <div class="pp-card-head"><span class="pp-card-label">Tournaments · ${esc(seasonLabel)}</span></div>
      ${tournamentResults.length ? tournamentResults.map((t) => `
        <div class="pp-row pp-row-lg${t.status !== 'completed' ? ' pp-row-next' : ''}">
          <div class="pp-row-main">
            <span class="pp-row-title">${esc(t.name)}</span>
            <span class="pp-row-sub">${formatShortDate(t.championship_date)}</span>
          </div>
          ${t.status === 'completed'
            ? `<span class="pp-finish${t.position === 2 ? ' pp-finish-runner' : ''}">${t.position ? `Finished #${t.position}` : '—'}</span>`
            : `<span class="pp-next-chip">In progress</span>`}
        </div>`).join('') : emptyBlock('No tournaments played yet')}
    </div>`;

  // The career ladder chart lived here. It plotted an all-time positional
  // replay while the header reported the season's own standing, so the two
  // numbers on one page disagreed by design. Pulled until ladder history is
  // stored rather than re-simulated; the header rank is the reliable one.
  const panelFor = (tabKey, mobile = false) => {
    switch (tabKey) {
      case 'upcoming':    return upcomingPanelHTML;
      case 'tournaments': return tournPanelHTML;
      case 'doubles':     return mobile ? doublesMobileHTML : doublesPanelHTML;
      default:            return buildResultsPanel(_profileResultFilter);
    }
  };

  // ===== MOBILE =====
  // A single scrolling column rather than tabs: record, then recent results.
  // Tapping a quick link opens that panel over the column, with a way back.
  // Without this the link set a desktop tab that mobile never renders, so
  // nothing happened.
  const MOBILE_TITLES = { results: 'Results', upcoming: 'Upcoming matches', tournaments: 'Tournaments', doubles: 'Doubles' };
  const mobileHTML = _profileMobileView ? `
    <div class="pp-mobile">
      <button class="pp-back" id="ppMobileBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        Back
      </button>
      <h3 class="pp-subview-title">${esc(MOBILE_TITLES[_profileMobileView] || '')}</h3>
      ${panelFor(_profileMobileView, true)}
    </div>` : `
    <div class="pp-mobile">
      <div class="pp-season-row">
        ${seasonPillHTML}
        <span class="pp-season-count">${history.length} match${history.length === 1 ? '' : 'es'} played</span>
      </div>

      <div class="pp-card pp-card-pad">
        <div class="pp-card-head pp-card-head-bare">
          <span class="pp-card-label">${esc(seasonLabel)} record</span>
          ${stats.currentStreak > 1 && stats.streakType === 'W'
            ? `<span class="pp-streak">${stats.currentStreak}-match win streak</span>` : ''}
        </div>
        ${stats.played === 0 ? emptyBlock('No matches played this season') : `
          <div class="pp-big">
            <span class="pp-big-w">${stats.wins}</span>
            <span class="pp-big-sep">/</span>
            <span class="pp-big-l">${stats.losses}</span>
            <span class="pp-big-pct">${stats.winPct === null ? '—' : `${stats.winPct}%`}</span>
          </div>
          <div class="pp-bar pp-bar-lg"><span style="width:${stats.winPct || 0}%"></span></div>
          <div class="pp-figures">
            <div><span class="pp-fig">${stats.gamesWon}–${stats.gamesLost}</span><span class="pp-fig-label">Games</span></div>
            <div><span class="pp-fig">${stats.gameWinPct === null ? '—' : `${stats.gameWinPct}%`}</span><span class="pp-fig-label">Game win rate</span></div>
          </div>`}
      </div>

      ${mergedResults.length ? `
        <div class="pp-card">
          <div class="pp-card-head">
            <span class="pp-card-label">Last ${Math.min(3, mergedResults.length)} result${mergedResults.length === 1 ? '' : 's'}</span>
            ${mergedResults.length > 3 ? `<button class="pp-link" data-pp-tab="results">All ${mergedResults.length}</button>` : ''}
          </div>
          ${mergedResults.slice(0, 3).map((x) => anyRow(x, { compact: true, short: true })).join('')}
        </div>` : ''}

      ${_quickLinksHTML(upcomingAll.length, tournamentResults.length,
        dblLadder.position != null ? `#${dblLadder.position} · ${dblStats.wins}–${dblStats.losses}` : 'Unranked')}
    </div>`;

  document.getElementById('mainContent').innerHTML = `
    ${headerHTML}
    <div class="pp-desktop">
      ${tabBarHTML}
      <div class="pp-panel" id="ppPanel" role="tabpanel" aria-labelledby="ppTab-${activeTab}" tabindex="0">${panelFor(activeTab)}</div>
    </div>
    ${mobileHTML}`;

  // ===== EVENTS =====
  const content = document.getElementById('mainContent');

  const wireOpponentLinks = (root) => {
    root.querySelectorAll('.nav-player-link').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        window.openPlayerProfile(Number(el.dataset.playerId));
      });
    });
  };
  wireOpponentLinks(content);

  document.getElementById('btnEditPhoto')?.addEventListener('click', () => openPhotoModal(p));

  const panelEl = document.getElementById('ppPanel');
  const tabEls = [...content.querySelectorAll('.pp-tab[data-pp-tab]')];

  // Only the panel's contents depend on the tab and the filter, so only they are
  // rebuilt. A full renderPlayerProfile() re-fetched the profile, replayed the
  // ladder and replaced the header, which lost the scroll position.
  const wirePanel = () => {
    wireOpponentLinks(panelEl);
    panelEl.querySelectorAll('[data-pp-action="report-ladder"]').forEach((el) => {
      el.addEventListener('click', () => openPickupGameModal());
    });
    panelEl.querySelectorAll('[data-pp-filter]').forEach((el) => {
      el.addEventListener('click', () => {
        _profileResultFilter = el.dataset.ppFilter;
        panelEl.innerHTML = panelFor(_profileTab);
        wirePanel();
      });
    });
  };

  const showTab = (key) => {
    _profileTab = key;
    panelEl.innerHTML = panelFor(key);
    panelEl.setAttribute('aria-labelledby', `ppTab-${key}`);
    tabEls.forEach((t) => {
      const on = t.dataset.ppTab === key;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    wirePanel();
  };

  if (panelEl) {
    wirePanel();
    tabEls.forEach((el) => el.addEventListener('click', () => showTab(el.dataset.ppTab)));
    content.querySelector('.pp-tabs')?.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const i = tabEls.findIndex((t) => t.dataset.ppTab === _profileTab);
      const next = tabEls[(i + step + tabEls.length) % tabEls.length];
      showTab(next.dataset.ppTab);
      next.focus();
    });
  }

  // Quick links and the "show all results" link open the panel. On desktop that
  // is the tab; on mobile it opens as a sub-view, since there is no tab bar to
  // switch. Both go through a full re-render.
  content.querySelectorAll('.pp-quick-row[data-pp-tab], .pp-link[data-pp-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.ppTab;
      _profileTab = key;
      // Only the mobile column renders these controls, so opening the sub-view
      // here is safe; the desktop tab bar is unaffected by the flag.
      if (window.matchMedia('(max-width: 768px)').matches) _profileMobileView = key;
      renderPlayerProfile();
    });
  });

  document.getElementById('ppMobileBack')?.addEventListener('click', () => {
    _profileMobileView = null;
    renderPlayerProfile();
  });

  // The picker is in the page twice - the desktop header and the mobile block,
  // one of them hidden by CSS - so the handler goes on every copy. It used to
  // find one by id, which was always the desktop copy: on a phone the picker
  // you could see did nothing.
  document.querySelectorAll('.pp-season-select').forEach((sel) => sel.addEventListener('change', (e) => {
    const raw = e.target.value;
    _profileSeason = raw === 'all' ? null : raw === 'none' ? 'none' : raw;
    _profileSeasonFor = p.id;
    renderPlayerProfile();
  }));
}

// ===== PROFILE HELPERS =====

/** Match/game/streak totals for a set of history rows (newest first). */
function _profileStats(rows) {
  const wins = rows.filter((m) => m.result === 'W').length;
  const losses = rows.filter((m) => m.result === 'L').length;
  const played = wins + losses;
  const gamesWon = rows.reduce((s, m) => s + (Number(m.my_score) || 0), 0);
  const gamesLost = rows.reduce((s, m) => s + (Number(m.their_score) || 0), 0);
  const gamesTotal = gamesWon + gamesLost;

  let currentStreak = 0;
  let streakType = null;
  for (const m of rows) {
    if (streakType === null) streakType = m.result;
    if (m.result !== streakType) break;
    currentStreak++;
  }

  return {
    wins, losses, played,
    winPct: played > 0 ? Math.round((wins / played) * 100) : null,
    gamesWon, gamesLost, gamesTotal,
    gameWinPct: gamesTotal > 0 ? Math.round((gamesWon / gamesTotal) * 100) : null,
    currentStreak, streakType: currentStreak ? streakType : null,
  };
}

function _quickLinksHTML(upcomingCount, tournCount, doublesMeta) {
  const chev = `<svg class="pp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>`;
  return `
    <div class="pp-card pp-quick">
      <button class="pp-quick-row" data-pp-tab="upcoming">
        <span class="pp-quick-label">Upcoming matches</span>
        <span class="pp-quick-meta">${upcomingCount}</span>${chev}
      </button>
      <button class="pp-quick-row" data-pp-tab="tournaments">
        <span class="pp-quick-label">Tournaments</span>
        <span class="pp-quick-meta">${tournCount}</span>${chev}
      </button>
      <button class="pp-quick-row" data-pp-tab="doubles">
        <span class="pp-quick-label">Doubles</span>
        <span class="pp-quick-meta">${esc(doublesMeta || '')}</span>${chev}
      </button>
    </div>`;
}

// Other pages open profiles through this global (e.g. a roster name on the league page).
window.openPlayerProfile = openPlayerProfile;
