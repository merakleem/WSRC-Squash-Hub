// ===== STATE =====
export const state = {
  page: 'players',        // 'players' | 'ladder' | 'leagues' | 'leagueDetail' | 'createLeague' | 'playerProfile' | 'schedule' | 'tournaments' | 'tournamentDetail' | 'createTournament'
  navHistory: [],         // stack of { page, currentPlayer, currentLeague, currentTournamentId }
  players: [],
  ladder: [],             // [{ id, name, position }] in ladder order
  leagues: [],
  currentLeague: null,
  currentPlayer: null,    // { id, name, email, phone, wins, losses, history: [...] }
  currentUser: null,      // { role: 'admin'|'player', playerId: number|null }
  currentTournamentId: null,
  scheduleDate: null,     // YYYY-MM-DD, null = today
  scheduleBookingTypeId: null, // active type pill (null = Standard / no type)
  scheduleZoom: 1.0,          // zoom ratio; range 0.5–2.0
  scheduleSelectedIds: [],    // booking IDs to restore selection after re-render
  scheduleClipboard: null,     // { items: [{ slot, relTimeMin, relCourtIdx }] }
  scheduleUndoStack: [],       // [{ type, ... }] — max 50 entries
  wizard: {
    step: 1,
    setupType: 'traditional',
    leagueName: '',
    startDate: '',
    rankedPlayers: [],    // [{ id, name }] ordered best → worst
    // Traditional
    numTeams: 3,
    numDivisions: 1,
    teamNames: [],        // custom names; index matches team slot
    // Modern
    modernNumDivisions: 2,
    modernDivisionPlayers: null,
    // Shared
    numRounds: 1,
    blackoutDates: [],
    matchStartTime: '19:00',
    selectedCourtIds: [],
    matchDuration: 45,
    matchBuffer: 15,
  },
};

// ===== ROLE HELPERS =====
export const isAdmin = () => state.currentUser?.role === 'admin';
export const isTester = () => !!state.currentUser?.is_tester;

// ===== CONFLICT CURSOR =====
// Injects a <style> override to show not-allowed cursor during conflicting drags.
let _schConflictStyle = null;
export function _setConflictCursor(on) {
  if (on) {
    if (!_schConflictStyle) {
      _schConflictStyle = document.createElement('style');
      document.head.appendChild(_schConflictStyle);
    }
    _schConflictStyle.textContent = '*{cursor:not-allowed!important}';
  } else if (_schConflictStyle) {
    _schConflictStyle.textContent = '';
  }
}
