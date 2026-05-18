// ===== WEB API SHIM =====
// Active when running in browser (not Electron). Sets window.api as a side effect.
if (typeof window !== 'undefined' && !window.api) {
  let _csrfToken = null;

  async function _ensureCsrf() {
    if (_csrfToken) return;
    const r = await fetch('/api/me');
    if (r.ok) {
      const data = await r.json();
      _csrfToken = data.csrf || null;
    }
  }

  async function _apiFetch(method, url, body = null) {
    if (method !== 'GET' && method !== 'HEAD') await _ensureCsrf();
    const opts = { method, headers: {} };
    if (body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (method !== 'GET' && method !== 'HEAD' && _csrfToken) {
      opts.headers['X-CSRF-Token'] = _csrfToken;
    }
    const r = await fetch(url, opts);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  window.api = {
    getPlayers:       ()  => _apiFetch('GET',    '/api/players'),
    addPlayer:        (d) => _apiFetch('POST',   '/api/players', d),
    updatePlayer:     (d) => _apiFetch('PUT',    `/api/players/${d.id}`, d),
    deletePlayer:     (id)=> _apiFetch('DELETE', `/api/players/${id}`),

    getLeagues:       ()  => _apiFetch('GET',    '/api/leagues'),
    getLeague:        (id)=> _apiFetch('GET',    `/api/leagues/${id}`),
    createLeague:     (d) => _apiFetch('POST',   '/api/leagues', d),
    deleteLeague:     (id)=> _apiFetch('DELETE', `/api/leagues/${id}`),

    updateMatchScore: (d) => _apiFetch('PUT',    `/api/matches/${d.matchId}/score`, d),
    setMatchSub:      (d) => _apiFetch('PUT',    `/api/matches/${d.matchId}/sub`, d),
    removeMatchSub:   (d) => _apiFetch('DELETE', `/api/matches/${d.matchId}/sub`, d),
    setSubRemaining:  (d) => _apiFetch('PUT',    `/api/leagues/${d.leagueId}/sub-remaining`, d),
    getValidConfigs:  (n) => _apiFetch('GET',    `/api/configs/${n}`),

    getLadder:        ()    => _apiFetch('GET', '/api/ladder'),
    getPlayerHistory: (id)  => _apiFetch('GET', `/api/players/${id}/history`),
    getPlayerRecords: ()    => _apiFetch('GET', '/api/players/records'),
    replacePlayer:    (d)   => _apiFetch('POST', `/api/leagues/${d.leagueId}/replace-player`, d),
    updateMatchTiming:(d)   => _apiFetch('PUT',  `/api/matches/${d.matchId}/timing`, d),
    sendInvite:        (id) => _apiFetch('POST', `/api/players/${id}/send-invite`),
    sendReset:         (id) => _apiFetch('POST', `/api/players/${id}/send-reset`),
    reportPlayerScore: (d)  => _apiFetch('PUT',  `/api/matches/${d.matchId}/player-score`, d),
    logPickupGame:     (d)  => _apiFetch('POST',   '/api/matches/pickup', d),
    deletePickupMatch: (id) => _apiFetch('DELETE', `/api/matches/pickup/${id}`),
    getActivity:        (days) => _apiFetch('GET', `/api/activity${days ? `?days=${days}` : ''}`),
    getCourts:          ()        => _apiFetch('GET',    '/api/courts'),
    addCourt:           (d)       => _apiFetch('POST',   '/api/courts', d),
    updateCourt:        (id, d)   => _apiFetch('PUT',    `/api/courts/${id}`, d),
    deleteCourt:        (id)      => _apiFetch('DELETE', `/api/courts/${id}`),
    getSchedule:        (date)    => _apiFetch('GET',    `/api/schedule?date=${date}`),
    getBookingTypes:    ()        => _apiFetch('GET',    '/api/booking-types'),
    addBookingType:     (d)       => _apiFetch('POST',   '/api/booking-types', d),
    updateBookingType:  (id, d)   => _apiFetch('PUT',    `/api/booking-types/${id}`, d),
    deleteBookingType:  (id)      => _apiFetch('DELETE', `/api/booking-types/${id}`),
    getTournaments:          ()        => _apiFetch('GET',    '/api/tournaments'),
    getTournament:           (id)      => _apiFetch('GET',    `/api/tournaments/${id}`),
    createTournament:        (d)       => _apiFetch('POST',   '/api/tournaments', d),
    deleteTournament:        (id)      => _apiFetch('DELETE', `/api/tournaments/${id}`),
    checkTournamentDate:     (d)       => _apiFetch('POST',   '/api/tournaments/check-date', d),
    suggestTournamentGroups: (d)       => _apiFetch('POST',   '/api/tournaments/suggest-groups', d),
    updateTournamentScore:         (id, d) => _apiFetch('PUT',    `/api/tournament-matches/${id}/score`, d),
    reportTournamentPlayerScore:   (id, d) => _apiFetch('PUT',    `/api/tournament-matches/${id}/player-score`, d),
    clearTournamentScore:          (id)    => _apiFetch('DELETE', `/api/tournament-matches/${id}/score`),
    messageLeaguePlayers: (id, d) => _apiFetch('POST',   `/api/leagues/${id}/message`, d),
    messageOpponent:      (id, d) => _apiFetch('POST',   `/api/matches/${id}/message-opponent`, d),
    bulkInviteLeague:     (id)    => _apiFetch('POST',   `/api/leagues/${id}/bulk-invite`),
    addBooking:         (d)       => _apiFetch('POST',   '/api/bookings', d),
    addRepeatBookings:  (d)       => _apiFetch('POST',   '/api/bookings/repeat', d),
    updateBooking:      (id, d)   => _apiFetch('PUT',    `/api/bookings/${id}`, d),
    deleteBooking:      (id, opts) => {
      const qs = opts ? '?' + new URLSearchParams(opts).toString() : '';
      return _apiFetch('DELETE', `/api/bookings/${id}${qs}`);
    },
  };
}
