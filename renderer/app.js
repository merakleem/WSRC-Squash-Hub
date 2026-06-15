import './api.js';
import { state, _setConflictCursor } from './state.js';
import { modal } from './utils.js';
import { renderSchedule } from './schedule.js';

import { renderClubActivity, renderClubSettings, renderDashboard } from './pages/dashboard.js';
import { renderPlayers, renderPlayerProfile, openPlayerProfile, openPickupGameModal, openReportScoreModal } from './pages/players.js';
import { renderLadder } from './pages/ladder.js';
import { renderLeagues } from './pages/leagues.js';
import { renderLeagueDetail, resetLeagueEditMode } from './pages/leagueDetail.js';
import { renderCreateLeague } from './pages/createLeague.js';
import { renderTournaments, renderTournamentDetail, renderCreateTournament } from './pages/tournaments.js';
import { renderCourtBooking } from './pages/courtBooking.js';

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

  // Sidebar active state
  const isOwnProfile = page === 'playerProfile' && state.currentPlayer?.id === state.currentUser?.playerId;
  const navPage = (page === 'leagueDetail' || page === 'createLeague') ? 'leagues'
    : (page === 'tournamentDetail' || page === 'createTournament') ? 'tournaments'
    : isOwnProfile ? 'myProfile'
    : page === 'playerProfile' ? 'players'
    : page === 'myProfile' ? 'myProfile'
    : page;
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === navPage);
  });

  // Back button
  const btnBack = document.getElementById('btnBack');
  const showBack = !isOwnProfile && (page === 'leagueDetail' || page === 'createLeague' || page === 'playerProfile' || page === 'tournamentDetail' || page === 'createTournament');
  btnBack.style.display = showBack ? 'inline-flex' : 'none';

  // Persist for refresh
  const navSnap = { page };
  if (state.currentLeague?.id)       navSnap.leagueId     = state.currentLeague.id;
  if (state.currentPlayer?.id)       navSnap.playerId     = state.currentPlayer.id;
  if (state.currentTournamentId != null) navSnap.tournamentId = state.currentTournamentId;
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

function renderPage() {
  const contentEl = document.querySelector('.content');
  contentEl.classList.remove('content--dashboard', 'content--schedule', 'content--court-booking');
  _setConflictCursor(false); // clear any stuck drag cursor from the schedule page
  switch (state.page) {
    case 'dashboard':        renderDashboard(); break;
    case 'players':          renderPlayers(); break;
    case 'ladder':           renderLadder(); break;
    case 'activity':         renderClubActivity(); break;
    case 'schedule':         renderSchedule(); break;
    case 'clubSettings':     renderClubSettings(); break;
    case 'leagues':          renderLeagues(); break;
    case 'leagueDetail':     renderLeagueDetail(); break;
    case 'createLeague':     renderCreateLeague(); break;
    case 'playerProfile':    renderPlayerProfile(); break;
    case 'tournaments':      renderTournaments(); break;
    case 'tournamentDetail': renderTournamentDetail(); break;
    case 'createTournament': renderCreateTournament(); break;
    case 'courtBooking':     renderCourtBooking(); break;
  }
}

// ===== HAMBURGER MENU =====
(function() {
  const btn = document.getElementById('hamburgerBtn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!btn) return;
  function closeSidebar() {
    btn.classList.remove('open');
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('open');
  }
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
  document.getElementById('navMyProfile')?.addEventListener('click', closeSidebar);
})();

// Expose to window for onclick attributes in dynamically generated HTML
window.modal = modal;
window.navigate = navigate;
window.openPlayerProfile = openPlayerProfile;
window.openReportScoreModal = openReportScoreModal;
window.openPickupGameModal = openPickupGameModal;
// Needed by pages/players.js after recording games/scores
window.renderLadder = renderLadder;
window.renderDashboard = renderDashboard;

// ===== INIT =====
window.addEventListener('DOMContentLoaded', async () => {
  // Mark the initial browser history entry as the app base so that
  // swiping back past all in-app pages exits to the previous URL (login).
  history.replaceState({ inApp: false }, '');

  try {
    state.currentUser = await fetch('/api/me').then((r) => r.json());
  } catch (_) {}

  // Show "My Profile" nav item for players
  if (state.currentUser?.role === 'player' && state.currentUser?.playerId) {
    const navMyProfile = document.getElementById('navMyProfile');
    navMyProfile.style.display = '';
    navMyProfile.addEventListener('click', () => openPlayerProfile(state.currentUser.playerId));
  }

  // Show tester-only nav items
  if (state.currentUser?.is_tester) {
    document.getElementById('navCourtBooking').style.display = '';
  }

  // Show admin-only nav items
  if (state.currentUser?.role === 'admin') {
    document.getElementById('navTournaments').style.display = '';
    document.getElementById('navSchedule').style.display = '';
    document.getElementById('navClubSettings').style.display = '';
  }

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
        const player = state.players.find((p) => p.id === saved.playerId);
        if (player) { navigate('playerProfile', { player }); restored = true; }
      } else if (saved.page === 'tournamentDetail' && saved.tournamentId != null) {
        navigate('tournamentDetail', { tournamentId: saved.tournamentId });
        restored = true;
      } else if (saved.page !== 'createLeague' && saved.page !== 'createTournament') {
        navigate(saved.page);
        restored = true;
      }
    }
  } catch (_) {}

  if (!restored) navigate('dashboard');
});
