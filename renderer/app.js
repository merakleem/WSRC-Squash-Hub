import './api.js';
import { state, isAdmin, isMember, isStaff, can, _setConflictCursor } from './state.js';
import { modal, toast, avatarHTML, playerInitials } from './utils.js';
import { renderSchedule } from './schedule.js';

import { renderClubActivity, renderClubSettings, renderDashboard } from './pages/dashboard.js';
import { openMatchCard } from './matchCard.js';
import { renderReportScore } from './pages/reportScore.js';
import { renderPlayers } from './pages/players.js';
import { renderPlayerProfile, openPlayerProfile } from './pages/playerProfile.js';
import { openPickupGameModal } from './pages/ladderMatch.js';
import { openReportScoreModal } from './pages/reportScoreModal.js';
import { renderLadder, resetLadderSeason } from './pages/ladder.js';
import { renderLeagues } from './pages/leagues.js';
import { renderLeagueDetail, resetLeagueEditMode } from './pages/leagueDetail.js';
import { renderCreateLeague } from './pages/createLeague.js';
import { renderTournaments, renderTournamentDetail } from './pages/tournaments.js';
import { renderCreateTournament } from './pages/createTournament.js';
import { renderEvents } from './pages/events.js';
import { renderCourtBooking } from './pages/courtBooking.js';
import { renderSettings } from './pages/settings.js';
import { renderStaffMember, renderDenied } from './pages/staffSettings.js';
import { beginVisit, paintNav } from './unread.js';

// ===== NAVIGATION =====
function navigate(page, params = {}, { pushHistory = true } = {}) {
  if (page !== 'leagueDetail') resetLeagueEditMode();
  if (pushHistory) {
    state.navHistory.push({ page: state.page, currentPlayer: state.currentPlayer, currentLeague: state.currentLeague, currentTournamentId: state.currentTournamentId });
    history.pushState({ inApp: true }, '');
  }
  state.page = page;
  if (params.league) state.currentLeague = params.league;
  if (params.player) state.currentPlayer = params.player;
  if (params.tournamentId != null) state.currentTournamentId = params.tournamentId;
  // Which match the Report Score page should open on arrival, which event the
  // Events page should select, and which slot the booking page should offer.
  // Each is consumed and cleared by the page that receives it.
  state.reportMatchId = params.matchId ?? null;
  state.currentEventId = params.eventId ?? null;
  state.bookingPrefill = params.booking ?? null;
  // Which Settings tab, and which staff member's page (none: the invite page).
  if (page === 'clubSettings') state.settingsTab = params.settingsTab ?? null;
  if (page === 'staffMember') state.currentStaffId = params.staffId ?? null;

  // Sidebar active state
  const isOwnProfile = page === 'playerProfile' && state.currentPlayer?.id === state.currentUser?.playerId;
  const navPage = (page === 'leagueDetail' || page === 'createLeague') ? 'leagues'
    : (page === 'tournamentDetail' || page === 'createTournament') ? 'tournaments'
    : page === 'eventDetail' ? 'events'
    : page === 'staffMember' ? 'clubSettings'
    : isOwnProfile ? 'myProfile'
    : page === 'playerProfile' ? 'players'
    : page === 'myProfile' ? 'myProfile'
    : page;
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === navPage);
  });

  // Opening the Leagues, Events or Tournaments list is what clears its unread marker, and
  // any navigation ends the visit that marks the cards.
  beginVisit(page);

  // Back button
  const btnBack = document.getElementById('btnBack');
  const showBack = !isOwnProfile && (page === 'leagueDetail' || page === 'createLeague' || page === 'playerProfile' || page === 'tournamentDetail' || page === 'createTournament' || page === 'staffMember');
  btnBack.style.display = showBack ? 'inline-flex' : 'none';

  // Persist for refresh
  const navSnap = { page };
  if (state.currentLeague?.id)       navSnap.leagueId     = state.currentLeague.id;
  if (state.currentPlayer?.id)       navSnap.playerId     = state.currentPlayer.id;
  if (state.currentTournamentId != null) navSnap.tournamentId = state.currentTournamentId;
  if (page === 'clubSettings' && state.settingsTab) navSnap.settingsTab = state.settingsTab;
  if (page === 'staffMember' && state.currentStaffId != null) navSnap.staffId = state.currentStaffId;
  sessionStorage.setItem('navState', JSON.stringify(navSnap));

  renderPage();
}

function _goBack() {
  const prev = state.navHistory.pop();
  if (prev) {
    state.currentPlayer       = prev.currentPlayer;
    state.currentLeague       = prev.currentLeague;
    state.currentTournamentId = prev.currentTournamentId;
    navigate(prev.page, {}, { pushHistory: false });
  } else {
    navigate('players', {}, { pushHistory: false });
  }
}

// In-app back button
document.getElementById('btnBack').addEventListener('click', () => {
  if (state.navHistory.length > 0) {
    history.back(); // moves browser history back, which fires popstate → _goBack()
  }
});

// Native back gesture (iOS swipe, Android back button)
window.addEventListener('popstate', () => {
  if (state.navHistory.length > 0) {
    _goBack();
  }
  // If navHistory is empty the browser has navigated past our app — let it proceed
});

document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', () => {
    state.navHistory = [];
    history.replaceState({ inApp: false }, ''); // reset browser history anchor; swipe-back from here exits the app
    navigate(el.dataset.page, {}, { pushHistory: false });
  });
});

// A page someone may not use (a followed link, a restored tab) renders Not
// allowed in place, under its own title.
const PAGE_TITLES = { schedule: 'Court Schedule', createLeague: 'New League', createTournament: 'New Tournament' };
function _allowed(perm, sentence) {
  if (can(perm)) return true;
  document.getElementById('pageTitle').textContent = PAGE_TITLES[state.page] || '';
  renderDenied(sentence);
  return false;
}

function renderPage() {
  const contentEl = document.querySelector('.content');
  contentEl.classList.remove('content--flush', 'content--dashboard', 'content--member-dash', 'content--schedule', 'content--court-booking', 'ca-page');
  _setConflictCursor(false); // clear any stuck drag cursor from the schedule page
  switch (state.page) {
    case 'dashboard':        renderDashboard(); break;
    case 'players':          renderPlayers(); break;
    case 'ladder':           resetLadderSeason(); renderLadder(); break;
    case 'activity':         renderClubActivity(); break;
    case 'schedule':         if (!_allowed('schedule', 'The court schedule is managed by staff with the Court schedule and bookings permission.')) return; renderSchedule(); break;
    case 'clubSettings':     renderClubSettings(); break;
    case 'leagues':          renderLeagues(); break;
    case 'leagueDetail':     renderLeagueDetail(); break;
    case 'createLeague':     if (!_allowed('leagues', 'Creating a league needs the Leagues permission.')) return; renderCreateLeague(); break;
    case 'playerProfile':    renderPlayerProfile(); break;
    case 'reportScore':      renderReportScore(); break;
    case 'events':           renderEvents(); break;
    case 'eventDetail':      renderEvents(); break;
    case 'tournaments':      renderTournaments(); break;
    case 'tournamentDetail': renderTournamentDetail(); break;
    case 'createTournament': if (!_allowed('tournaments', 'Creating a tournament needs the Tournaments permission.')) return; renderCreateTournament(); break;
    case 'staffMember':      renderStaffMember(); break;
    // Members only, and admins are not players: the tab is hidden for them, so
    // a stale restored page must not be a way back onto it either.
    case 'courtBooking':     if (isAdmin() || !isMember()) { navigate('dashboard'); return; } renderCourtBooking(); break;
    // A member's own settings; an admin account is not a player and has none.
    case 'settings':         if (isAdmin()) { navigate('dashboard'); return; } renderSettings(); break;
  }
}

// ===== HAMBURGER MENU =====
// Module-scoped so the account popover and the drawer's profile header can
// close the drawer after they navigate.
function closeSidebar() {
  document.getElementById('hamburgerBtn')?.classList.remove('open');
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebarOverlay')?.classList.remove('open');
}

(function() {
  const btn = document.getElementById('hamburgerBtn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const opening = !sidebar.classList.contains('mobile-open');
    btn.classList.toggle('open', opening);
    sidebar.classList.toggle('mobile-open', opening);
    overlay.classList.toggle('open', opening);
  });
  overlay.addEventListener('click', closeSidebar);
  // Close sidebar when a nav item is clicked (mobile UX)
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', closeSidebar);
  });
})();

// ===== ACCOUNT POPOVER =====
// The profile card at the foot of the sidebar opens My Profile / Logout. It is
// a desktop affordance only: the mobile drawer puts both actions on the surface
// (its header opens the profile, its footer logs out), so nothing here runs
// there - the card itself is display:none below 768px.
(function() {
  const card = document.getElementById('sbProfile');
  const menu = document.getElementById('sbMenu');
  if (!card || !menu) return;

  const setOpen = (open) => {
    menu.hidden = !open;
    card.setAttribute('aria-expanded', String(open));
  };

  card.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) setOpen(false);
  });

  const openMine = (e) => {
    e?.preventDefault();
    setOpen(false);
    closeSidebar();
    // A staff member's account lives in Settings; a member's is their profile.
    if (isStaff()) navigate('clubSettings', { settingsTab: 'account' });
    else if (state.currentUser?.playerId) openPlayerProfile(state.currentUser.playerId);
  };
  document.getElementById('sbMenuProfile')?.addEventListener('click', openMine);
  // The drawer header is the same action, without a popover in the way.
  document.getElementById('sbDrawerProfile')?.addEventListener('click', openMine);
  document.getElementById('saDrawerAccount')?.addEventListener('click', openMine);

  const openSettings = (e) => {
    e.preventDefault();
    setOpen(false);
    closeSidebar();
    navigate('settings');
  };
  document.getElementById('sbMenuSettings')?.addEventListener('click', openSettings);
  document.getElementById('sbDrawerSettings')?.addEventListener('click', openSettings);
})();

// The member's name and photo on the sidebar card and the drawer header.
// Painted at start-up, and again when Settings saves either.
function paintAccountCard() {
  if (isStaff()) {
    // Staff get the members' card with their initials and the word Staff.
    const name = state.currentUser.name || 'Staff';
    const av = document.getElementById('sbProfileAvatar');
    av.className = 'sb-profile-avatar sb-profile-avatar--staff';
    av.textContent = playerInitials(name);
    av.removeAttribute('style');
    document.getElementById('sbProfileName').textContent = name;
    document.getElementById('sbProfileRole').textContent = 'Staff';
    document.getElementById('saDrawerAccountName').textContent = name;
    return;
  }
  if (isAdmin() || !state.currentUser?.playerId) return;
  const who = { name: state.currentUser.name, photo_path: state.currentUser.photo_path };
  // avatarHTML has no id of its own; the card keeps its id so it can be painted again.
  const withId = (id, cls) => avatarHTML(who, cls).replace('<div ', `<div id="${id}" `);
  document.getElementById('sbProfileAvatar').outerHTML = withId('sbProfileAvatar', 'sb-profile-avatar');
  document.getElementById('sbDrawerAvatar').outerHTML = withId('sbDrawerAvatar', 'sb-drawer-avatar');
  document.getElementById('sbProfileName').textContent = who.name || 'My account';
  document.getElementById('sbDrawerName').textContent = who.name || 'My account';
}

// Expose to window for onclick attributes in dynamically generated HTML
window.paintAccountCard = paintAccountCard;
window.modal = modal;
window.navigate = navigate;
window.openPlayerProfile = openPlayerProfile;
window.openReportScoreModal = openReportScoreModal;
window.openPickupGameModal = openPickupGameModal;
window.openMatchCard = openMatchCard;

// Any element carrying data-match opens that match's card. Delegated once here
// rather than bound per page, so a new surface only has to render the
// attribute. A click on a player link, a button or a link inside the row keeps
// its own meaning.
document.addEventListener('click', (e) => {
  if (e.target.closest('.nav-player-link, button, a, input, select')) return;
  const el = e.target.closest('[data-match], [data-match-id]');
  const id = el?.dataset.match || el?.dataset.matchId;
  if (!id) return;
  openMatchCard(id);
});
window.renderReportScore = renderReportScore;
// Needed by pages/players.js after recording games/scores
window.renderLadder = renderLadder;
window.renderDashboard = renderDashboard;

// ===== INIT =====
window.addEventListener('DOMContentLoaded', async () => {
  // The offline shell (public/sw.js). Registration is best effort: a browser
  // without service workers, or a file:// test page, simply goes without.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker?.register('/sw.js').catch(() => {});
  }

  // Mark the initial browser history entry as the app base so that
  // swiping back past all in-app pages exits to the previous URL (login).
  history.replaceState({ inApp: false }, '');

  try {
    state.currentUser = await fetch('/api/me').then((r) => r.json());
  } catch (_) {}

  // An admin looking through a member's eyes gets a bar they cannot miss and a
  // one-click way back. Everything else on the page behaves exactly as it does
  // for that member, which is the point.
  if (state.currentUser?.viewing_as) {
    const bar = document.getElementById('viewAsBar');
    document.getElementById('viewAsName').textContent = state.currentUser.viewing_as;
    bar.hidden = false;
    document.body.classList.add('is-viewing-as');
    document.getElementById('viewAsExit').addEventListener('click', async () => {
      try {
        await window.api.returnToAdmin();
        location.href = '/';
      } catch (e) {
        toast(e.message || 'Could not switch back.', 'error');
      }
    });
  }

  // The sidebar's footer card and its mobile drawer header are chosen by this
  // class, so a role only has to be decided once.
  const sidebar = document.querySelector('.sidebar');
  sidebar.classList.toggle('sb-role-admin', isAdmin() && !isStaff());
  sidebar.classList.toggle('sb-role-staff', isStaff());
  sidebar.classList.toggle('sb-role-player', !isAdmin());
  if (isStaff()) {
    // The account menu reads My account, Logout; members' Settings is not theirs.
    document.getElementById('sbMenuProfile').lastChild.textContent = ' My account ';
    document.getElementById('sbMenuSettings').hidden = true;
    document.getElementById('sbDrawerSettings').hidden = true;
    document.getElementById('saDrawerAccount').hidden = false;
  }

  paintAccountCard();

  // Court booking is for members, and only for them: an admin account is not a
  // player, so it never gets the tab even though requireMember lets admins
  // through the API.
  if (!isAdmin() && isMember()) {
    document.getElementById('navCourtBooking').style.display = '';
  }

  // Tournaments are for everyone: members sign up from there.
  document.getElementById('navTournaments').style.display = '';

  // Show admin-only nav items, and the group heading that labels them.
  if (isAdmin()) {
    if (can('schedule')) document.getElementById('navSchedule').style.display = '';
    document.getElementById('navClubSettings').style.display = '';
    document.getElementById('sbGroupAdmin').style.display = '';
  }

  // Dots for whatever has been posted since this member last looked.
  paintNav();

  state.players = await window.api.getPlayers();

  // Restore last page on refresh
  let restored = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem('navState') || 'null');
    if (saved?.page && saved.page !== 'dashboard') {
      if (saved.page === 'leagueDetail' && saved.leagueId) {
        const league = await window.api.getLeague(saved.leagueId);
        navigate('leagueDetail', { league });
        restored = true;
      } else if (saved.page === 'playerProfile' && saved.playerId) {
        // The list row is a name and an id; the profile is its history, its
        // ladder standing and the club's seasons. Handing over the row rendered
        // a page with none of that, and a phone reloads the tab every time it
        // comes back to the app - so on a phone this was the usual way in.
        await openPlayerProfile(saved.playerId, { pushHistory: false });
        restored = true;
      } else if (saved.page === 'tournamentDetail' && saved.tournamentId != null) {
        navigate('tournamentDetail', { tournamentId: saved.tournamentId });
        restored = true;
      } else if (saved.page !== 'createLeague' && saved.page !== 'createTournament') {
        navigate(saved.page, { settingsTab: saved.settingsTab, staffId: saved.staffId });
        restored = true;
      }
    }
  } catch (_) {}

  if (!restored) navigate('dashboard');
});
