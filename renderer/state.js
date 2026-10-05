// ===== STATE =====
export const state = {
  page: 'players',        // 'players' | 'ladder' | 'leagues' | 'leagueDetail' | 'createLeague' | 'playerProfile' | 'schedule' | 'tournaments' | 'tournamentDetail' | 'createTournament'
  navHistory: [],         // stack of { page, currentPlayer, currentLeague, currentTournamentId }
  players: [],
  ladder: [],             // [{ id, name, position }] in ladder order
  leagues: [],
  currentLeague: null,
  currentPlayer: null,    // { id, name, email, phone, wins, losses, history: [...] }
  currentUser: null,      // { role: 'admin'|'staff'|'player', playerId, staffId, permissions }
  settingsTab: null,      // the Settings tab to open on (club, ladder, courts, staff, log, account)
  currentStaffId: null,   // the staff member being edited; null on the invite page
  currentTournamentId: null,
  currentEventId: null,      // events page opens on this event, then clears it
  bookingPrefill: null,      // { courtId, date, startTime } the booking page opens on
  reportMatchId: null,       // report-a-score opens this match, then clears it
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
// The club side: the admin account and staff. Pages lay out their admin view
// for both; what each control may do is `can()`.
export const isAdmin = () => state.currentUser?.role === 'admin' || state.currentUser?.role === 'staff';
/** The admin account itself (blank email and the club password): everything, and staff. */
export const isAdminAccount = () => state.currentUser?.role === 'admin';
export const isStaff = () => state.currentUser?.role === 'staff';
/** May the signed-in person use `perm`? The admin account may use them all. */
export const can = (perm) => isAdminAccount() || (isStaff() && (state.currentUser.permissions || []).includes(perm));
export const isTester = () => !!state.currentUser?.is_tester;
// Members (and admins) can use the court booking feature.
export const isMember = () => isAdmin() || !!state.currentUser?.is_member;

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
