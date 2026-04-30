const { run, all, get, getDB } = require('../database/db');

// ===== BOOKING TYPES =====

function getAllBookingTypes() {
  return all('SELECT * FROM booking_types ORDER BY name ASC');
}

function addBookingType({ name, color }) {
  const result = run('INSERT INTO booking_types (name, color) VALUES (?, ?)', [name, color]);
  return get('SELECT * FROM booking_types WHERE id = ?', [result.lastID]);
}

function updateBookingType({ id, name, color }) {
  run('UPDATE booking_types SET name = ?, color = ? WHERE id = ?', [name, color, id]);
  return get('SELECT * FROM booking_types WHERE id = ?', [id]);
}

function deleteBookingType(id) {
  return run('DELETE FROM booking_types WHERE id = ?', [id]);
}

// ===== BOOKINGS =====

function _checkConflict(courtId, date, startTime, durationMinutes, excludeIds) {
  const db = getDB();
  const [h, m] = startTime.split(':').map(Number);
  const startMin = h * 60 + m;
  const endMin = startMin + durationMinutes;
  const ids = excludeIds || [];
  let rows;
  if (ids.length === 0) {
    rows = db.prepare('SELECT start_time, duration_minutes FROM bookings WHERE court_id=? AND date=?').all(courtId, date);
  } else if (ids.length === 1) {
    rows = db.prepare('SELECT start_time, duration_minutes FROM bookings WHERE court_id=? AND date=? AND id!=?').all(courtId, date, ids[0]);
  } else {
    const ph = ids.map(() => '?').join(',');
    rows = db.prepare(`SELECT start_time, duration_minutes FROM bookings WHERE court_id=? AND date=? AND id NOT IN (${ph})`).all(courtId, date, ...ids);
  }
  return rows.some((b) => {
    const [bh, bm] = b.start_time.split(':').map(Number);
    const bs = bh * 60 + bm;
    return startMin < bs + b.duration_minutes && bs < endMin;
  });
}

function _checkAdjacency(courtIds) {
  if (courtIds.length <= 1) return;
  const db = getDB();
  const courts = db.prepare('SELECT id FROM courts ORDER BY sort_order ASC, id ASC').all();
  const idxMap = new Map(courts.map((c, i) => [c.id, i]));
  const idxs = courtIds.map((cId) => idxMap.get(cId)).filter((x) => x !== undefined);
  if (idxs.length !== courtIds.length) throw new Error('One or more courts not found.');
  const sorted = [...idxs].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) throw new Error('Multi-court bookings must span adjacent courts.');
  }
}

function _checkLeagueConflict(db, courtId, date, startTime, durationMinutes) {
  const [h, m] = startTime.split(':').map(Number);
  const startMin = h * 60 + m;
  const endMin = startMin + durationMinutes;
  const matches = db.prepare(`
    SELECT m.match_time AS start_time, l.match_duration
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w          ON tm.week_id = w.id
    JOIN leagues l        ON w.league_id = l.id
    WHERE m.court_id = ? AND w.date = ? AND m.match_time IS NOT NULL AND (m.skipped = 0 OR m.skipped IS NULL)
  `).all(courtId, date);
  return matches.some((lm) => {
    const [bh, bm] = lm.start_time.split(':').map(Number);
    const bs = bh * 60 + bm;
    return startMin < bs + (lm.match_duration || 45) && bs < endMin;
  });
}

function _setBookingPlayers(db, bookingId, playerIds) {
  if (!Array.isArray(playerIds)) return;
  db.prepare('DELETE FROM booking_players WHERE booking_id = ?').run(bookingId);
  const stmt = db.prepare('INSERT INTO booking_players (booking_id, player_id) VALUES (?, ?)');
  for (const pid of playerIds.slice(0, 4)) stmt.run(bookingId, Number(pid));
}

function _addDays(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function _dayOfWeek(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function addBooking({ courtId, courtIds, date, startTime, durationMinutes, bookingTypeId, name, info, playerIds }) {
  const effectiveCourtIds = courtIds || [courtId];
  _checkAdjacency(effectiveCourtIds);
  for (const cId of effectiveCourtIds) {
    if (_checkConflict(cId, date, startTime, durationMinutes, [])) {
      throw new Error('This time slot is already booked on one or more of those courts.');
    }
  }
  const db = getDB();
  if (effectiveCourtIds.length === 1) {
    const result = run(
      'INSERT INTO bookings (court_id, date, start_time, duration_minutes, booking_type_id, name, info) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [effectiveCourtIds[0], date, startTime, durationMinutes, bookingTypeId || null, name || null, info || null]
    );
    _setBookingPlayers(db, result.lastID, playerIds);
    const booking = get(
      'SELECT b.*, bt.name AS type_name, bt.color AS type_color FROM bookings b LEFT JOIN booking_types bt ON bt.id = b.booking_type_id WHERE b.id = ?',
      [result.lastID]
    );
    booking.players = db.prepare('SELECT p.id, p.name FROM booking_players bp JOIN players p ON p.id = bp.player_id WHERE bp.booking_id = ? ORDER BY bp.id ASC').all(result.lastID);
    return booking;
  } else {
    const first = run(
      'INSERT INTO bookings (court_id, date, start_time, duration_minutes, booking_type_id, name, info) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [effectiveCourtIds[0], date, startTime, durationMinutes, bookingTypeId || null, name || null, info || null]
    );
    const groupId = first.lastID;
    run('UPDATE bookings SET group_id = ? WHERE id = ?', [groupId, groupId]);
    _setBookingPlayers(db, groupId, playerIds);
    const memberIds = [groupId];
    for (let i = 1; i < effectiveCourtIds.length; i++) {
      const r = run(
        'INSERT INTO bookings (court_id, date, start_time, duration_minutes, booking_type_id, name, info, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [effectiveCourtIds[i], date, startTime, durationMinutes, bookingTypeId || null, name || null, info || null, groupId]
      );
      memberIds.push(r.lastID);
    }
    return { id: groupId, groupId, courtIds: effectiveCourtIds, memberIds, date, startTime, durationMinutes, bookingTypeId: bookingTypeId || null, name: name || null, info: info || null };
  }
}

function updateBooking({ id, courtId, courtIds, date, startTime, durationMinutes, bookingTypeId, name, info, playerIds, excludeIds }) {
  const db = getDB();
  const existing = db.prepare('SELECT group_id FROM bookings WHERE id = ?').get(Number(id));
  const extraExclude = Array.isArray(excludeIds) ? excludeIds.map(Number) : [];

  let newCourtIds;
  if (Array.isArray(courtIds) && courtIds.length > 0) {
    newCourtIds = courtIds;
  } else if (courtId) {
    newCourtIds = [courtId];
  } else if (existing && existing.group_id) {
    const memberRows = db.prepare('SELECT court_id FROM bookings WHERE group_id = ?').all(existing.group_id);
    newCourtIds = memberRows.map((r) => r.court_id);
  } else {
    const row = db.prepare('SELECT court_id FROM bookings WHERE id = ?').get(Number(id));
    newCourtIds = row ? [row.court_id] : [courtId];
  }

  if (newCourtIds.length > 1) _checkAdjacency(newCourtIds);

  const anchorId = (existing && existing.group_id) ? existing.group_id : Number(id);
  const curRow = db.prepare('SELECT name, info FROM bookings WHERE id=?').get(anchorId) || {};
  const newName = name !== undefined ? (name || null) : (curRow.name || null);
  const newInfo = info !== undefined ? (info || null) : (curRow.info || null);

  const isCurrentlyGrouped = existing && existing.group_id != null;

  if (isCurrentlyGrouped) {
    const groupId = existing.group_id;
    const memberRows = db.prepare('SELECT id, court_id FROM bookings WHERE group_id = ?').all(groupId);
    const memberIdsList = [...memberRows.map((r) => r.id), ...extraExclude];

    for (const cId of newCourtIds) {
      if (_checkConflict(cId, date, startTime, durationMinutes, memberIdsList)) {
        throw new Error(newCourtIds.length === 1
          ? 'This time slot is already booked on that court.'
          : 'This time slot is already booked on one or more of those courts.');
      }
    }

    run(
      'UPDATE bookings SET court_id=?, date=?, start_time=?, duration_minutes=?, booking_type_id=?, name=?, info=?, group_id=? WHERE id=?',
      [newCourtIds[0], date, startTime, durationMinutes, bookingTypeId || null, newName, newInfo, newCourtIds.length > 1 ? groupId : null, groupId]
    );
    for (const row of memberRows) {
      if (row.id !== groupId) run('DELETE FROM bookings WHERE id = ?', [row.id]);
    }
    for (let i = 1; i < newCourtIds.length; i++) {
      run(
        'INSERT INTO bookings (court_id, date, start_time, duration_minutes, booking_type_id, name, info, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [newCourtIds[i], date, startTime, durationMinutes, bookingTypeId || null, newName, newInfo, groupId]
      );
    }
    _setBookingPlayers(db, groupId, playerIds);

    if (newCourtIds.length === 1) {
      return get(
        'SELECT b.*, bt.name AS type_name, bt.color AS type_color FROM bookings b LEFT JOIN booking_types bt ON bt.id = b.booking_type_id WHERE b.id = ?',
        [groupId]
      );
    }
    const newMembers = db.prepare('SELECT id, court_id FROM bookings WHERE group_id = ?').all(groupId);
    return { id: groupId, groupId, courtIds: newMembers.map((r) => r.court_id), memberIds: newMembers.map((r) => r.id), date, startTime, durationMinutes, bookingTypeId: bookingTypeId || null };
  } else {
    if (newCourtIds.length === 1) {
      if (_checkConflict(newCourtIds[0], date, startTime, durationMinutes, [Number(id), ...extraExclude])) {
        throw new Error('This time slot is already booked on that court.');
      }
      run(
        'UPDATE bookings SET court_id=?, date=?, start_time=?, duration_minutes=?, booking_type_id=?, name=?, info=? WHERE id=?',
        [newCourtIds[0], date, startTime, durationMinutes, bookingTypeId || null, newName, newInfo, id]
      );
      _setBookingPlayers(db, Number(id), playerIds);
      return get(
        'SELECT b.*, bt.name AS type_name, bt.color AS type_color FROM bookings b LEFT JOIN booking_types bt ON bt.id = b.booking_type_id WHERE b.id = ?',
        [id]
      );
    } else {
      for (const cId of newCourtIds) {
        if (_checkConflict(cId, date, startTime, durationMinutes, [Number(id), ...extraExclude])) {
          throw new Error('This time slot is already booked on one or more of those courts.');
        }
      }
      const groupId = Number(id);
      run(
        'UPDATE bookings SET court_id=?, date=?, start_time=?, duration_minutes=?, booking_type_id=?, name=?, info=?, group_id=? WHERE id=?',
        [newCourtIds[0], date, startTime, durationMinutes, bookingTypeId || null, newName, newInfo, groupId, id]
      );
      _setBookingPlayers(db, groupId, playerIds);
      const memberIds = [groupId];
      for (let i = 1; i < newCourtIds.length; i++) {
        const r = run(
          'INSERT INTO bookings (court_id, date, start_time, duration_minutes, booking_type_id, name, info, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [newCourtIds[i], date, startTime, durationMinutes, bookingTypeId || null, newName, newInfo, groupId]
        );
        memberIds.push(r.lastID);
      }
      return { id: groupId, groupId, courtIds: newCourtIds, memberIds, date, startTime, durationMinutes, bookingTypeId: bookingTypeId || null };
    }
  }
}

function deleteBooking(id) {
  const db = getDB();
  const booking = db.prepare('SELECT group_id FROM bookings WHERE id = ?').get(Number(id));
  if (booking && booking.group_id) {
    return run('DELETE FROM bookings WHERE group_id = ?', [booking.group_id]);
  }
  db.prepare('DELETE FROM bookings WHERE group_id = ?').run(Number(id));
  return run('DELETE FROM bookings WHERE id = ?', [id]);
}

function deleteRepeatGroup(repeatGroupId, scope, fromDate) {
  if (scope === 'future') {
    return run('DELETE FROM bookings WHERE repeat_group_id = ? AND date >= ?', [repeatGroupId, fromDate]);
  }
  return run('DELETE FROM bookings WHERE repeat_group_id = ?', [repeatGroupId]);
}

function createRepeatBookings(baseData, repeatOptions) {
  const { courtId, courtIds, startTime, durationMinutes, bookingTypeId, name, info, playerIds } = baseData;
  const { startDate, daysOfWeek, weeks, conflictMode } = repeatOptions;
  const effectiveCourtIds = (Array.isArray(courtIds) && courtIds.length > 0) ? courtIds : [courtId];
  _checkAdjacency(effectiveCourtIds);

  const daysSet = new Set(daysOfWeek.map(Number));
  const db = getDB();

  const maxDays = Math.min(weeks || 52, 52) * 7;
  const dates = [];
  for (let i = 0; i <= maxDays; i++) {
    const d = _addDays(startDate, i);
    if (daysSet.has(_dayOfWeek(d))) dates.push(d);
  }

  if (dates.length === 0) return { created: 0, skipped: 0, leagueConflicts: [] };

  let created = 0, skipped = 0;
  const leagueConflicts = [];
  let repeatGroupId = null;

  const txn = db.transaction(() => {
    for (const date of dates) {
      const hasLeagueConflict = effectiveCourtIds.some((cId) =>
        _checkLeagueConflict(db, cId, date, startTime, durationMinutes)
      );
      if (hasLeagueConflict) {
        leagueConflicts.push(date);
        skipped++;
        continue;
      }

      const hasBookingConflict = effectiveCourtIds.some((cId) =>
        _checkConflict(cId, date, startTime, durationMinutes, [])
      );

      if (hasBookingConflict) {
        if (conflictMode === 'skip') { skipped++; continue; }
        const groupsToDelete = new Set();
        const singlesToDelete = new Set();
        const [h, m] = startTime.split(':').map(Number);
        const startMin = h * 60 + m;
        const endMin = startMin + durationMinutes;
        for (const cId of effectiveCourtIds) {
          const rows = db.prepare('SELECT id, group_id, start_time, duration_minutes FROM bookings WHERE court_id=? AND date=?').all(cId, date);
          for (const row of rows) {
            const [bh, bm] = row.start_time.split(':').map(Number);
            const bs = bh * 60 + bm;
            if (startMin < bs + row.duration_minutes && bs < endMin) {
              if (row.group_id) groupsToDelete.add(row.group_id);
              else singlesToDelete.add(row.id);
            }
          }
        }
        groupsToDelete.forEach((gid) => db.prepare('DELETE FROM bookings WHERE group_id = ?').run(gid));
        singlesToDelete.forEach((bid) => db.prepare('DELETE FROM bookings WHERE id = ?').run(bid));
      }

      if (effectiveCourtIds.length === 1) {
        const r = db.prepare(
          'INSERT INTO bookings (court_id, date, start_time, duration_minutes, booking_type_id, name, info, repeat_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(effectiveCourtIds[0], date, startTime, durationMinutes, bookingTypeId || null, name || null, info || null, null);
        const newId = r.lastInsertRowid;
        if (repeatGroupId === null) repeatGroupId = newId;
        db.prepare('UPDATE bookings SET repeat_group_id = ? WHERE id = ?').run(repeatGroupId, newId);
        _setBookingPlayers(db, newId, playerIds);
      } else {
        const r = db.prepare(
          'INSERT INTO bookings (court_id, date, start_time, duration_minutes, booking_type_id, name, info, repeat_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(effectiveCourtIds[0], date, startTime, durationMinutes, bookingTypeId || null, name || null, info || null, null);
        const firstId = r.lastInsertRowid;
        db.prepare('UPDATE bookings SET group_id = ? WHERE id = ?').run(firstId, firstId);
        if (repeatGroupId === null) repeatGroupId = firstId;
        db.prepare('UPDATE bookings SET repeat_group_id = ? WHERE id = ?').run(repeatGroupId, firstId);
        _setBookingPlayers(db, firstId, playerIds);
        for (let i = 1; i < effectiveCourtIds.length; i++) {
          db.prepare(
            'INSERT INTO bookings (court_id, date, start_time, duration_minutes, booking_type_id, name, info, group_id, repeat_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(effectiveCourtIds[i], date, startTime, durationMinutes, bookingTypeId || null, name || null, info || null, firstId, repeatGroupId);
        }
      }
      created++;
    }
  });
  txn();

  return { created, skipped, leagueConflicts };
}

// ===== SCHEDULE =====

function getScheduleForDate(date) {
  const db = getDB();

  const courts = db.prepare('SELECT * FROM courts ORDER BY sort_order ASC, id ASC').all();
  const courtOrderById = new Map(courts.map((c, i) => [c.id, i]));

  const tournamentMatches = db.prepare(`
    SELECT tm.id, tm.match_time AS start_time, tm.court_id, tm.player1_id, tm.player2_id,
      t.match_duration_minutes, p1.name AS p1_name, p2.name AS p2_name,
      t.name AS tournament_name, tm.round
    FROM tournament_matches tm
    JOIN tournaments t ON t.id = tm.tournament_id
    LEFT JOIN players p1 ON p1.id = tm.player1_id
    LEFT JOIN players p2 ON p2.id = tm.player2_id
    WHERE tm.match_date = ? AND tm.court_id IS NOT NULL AND tm.match_time IS NOT NULL
  `).all(date);

  const leagueMatches = db.prepare(`
    SELECT
      m.id AS match_id,
      m.match_time AS start_time,
      m.court_id,
      l.match_duration,
      COALESCE(sp1.name, p1.name) AS eff_p1_name,
      COALESCE(sp2.name, p2.name) AS eff_p2_name,
      l.name AS league_name
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w          ON tm.week_id = w.id
    JOIN leagues l        ON w.league_id = l.id
    JOIN players p1       ON p1.id = m.player1_id
    JOIN players p2       ON p2.id = m.player2_id
    LEFT JOIN match_subs s1  ON s1.match_id = m.id AND s1.original_player_id = m.player1_id
    LEFT JOIN match_subs s2  ON s2.match_id = m.id AND s2.original_player_id = m.player2_id
    LEFT JOIN players sp1    ON sp1.id = s1.sub_player_id
    LEFT JOIN players sp2    ON sp2.id = s2.sub_player_id
    WHERE w.date = ?
      AND m.court_id IS NOT NULL
      AND m.match_time IS NOT NULL
      AND (m.skipped = 0 OR m.skipped IS NULL)
  `).all(date);

  const rawBookings = db.prepare(`
    SELECT b.*, bt.name AS type_name, bt.color AS type_color
    FROM bookings b
    LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
    WHERE b.date = ?
    ORDER BY b.start_time ASC
  `).all(date);

  const playerRows = db.prepare(`
    SELECT bp.booking_id, bp.player_id, p.name AS player_name
    FROM booking_players bp
    JOIN players p ON p.id = bp.player_id
    JOIN bookings b ON b.id = bp.booking_id
    WHERE b.date = ?
    ORDER BY bp.id ASC
  `).all(date);
  const playersByBookingId = new Map();
  for (const row of playerRows) {
    if (!playersByBookingId.has(row.booking_id)) playersByBookingId.set(row.booking_id, []);
    playersByBookingId.get(row.booking_id).push({ id: row.player_id, name: row.player_name });
  }

  const groupMap = new Map();
  const singleRows = [];
  for (const row of rawBookings) {
    if (row.group_id) {
      if (!groupMap.has(row.group_id)) groupMap.set(row.group_id, []);
      groupMap.get(row.group_id).push(row);
    } else {
      singleRows.push(row);
    }
  }

  const customBookings = [
    ...singleRows.map((b) => ({
      id: b.id,
      source: 'custom',
      courtId: b.court_id,
      date: b.date,
      startTime: b.start_time,
      durationMinutes: b.duration_minutes,
      bookingTypeId: b.booking_type_id || null,
      name: b.name || null,
      title: b.name || b.type_name || 'Booked',
      info: b.info || '',
      color: b.type_color || '#6b7589',
      repeatGroupId: b.repeat_group_id || null,
      players: playersByBookingId.get(b.id) || [],
    })),
    ...[...groupMap.values()].map((rows) => {
      const groupId = rows[0].group_id;
      const rep = rows.find((r) => r.id === groupId) || rows[0];
      const sorted = [...rows].sort(
        (a, b2) => (courtOrderById.get(a.court_id) ?? 999) - (courtOrderById.get(b2.court_id) ?? 999)
      );
      return {
        id: groupId,
        groupId,
        memberIds: rows.map((r) => r.id),
        source: 'custom',
        courtId: sorted[0].court_id,
        courtIds: sorted.map((r) => r.court_id),
        date: rep.date,
        startTime: rep.start_time,
        durationMinutes: rep.duration_minutes,
        bookingTypeId: rep.booking_type_id || null,
        name: rep.name || null,
        title: rep.name || rep.type_name || 'Booked',
        info: rep.info || '',
        color: rep.type_color || '#6b7589',
        repeatGroupId: rep.repeat_group_id || null,
        players: playersByBookingId.get(groupId) || [],
      };
    }),
  ];

  const slots = [
    ...tournamentMatches.map((m) => ({
      id: `t_${m.id}`,
      source: 'tournament',
      courtId: m.court_id,
      startTime: m.start_time,
      durationMinutes: m.match_duration_minutes || 60,
      title: 'Tournament',
      info: m.p1_name && m.p2_name ? `${m.p1_name} vs ${m.p2_name}` : 'TBD',
      color: '#7c3aed',
      players: [],
      repeatGroupId: null,
      name: null,
    })),
    ...leagueMatches.map((m) => ({
      id: `m_${m.match_id}`,
      source: 'league',
      courtId: m.court_id,
      startTime: m.start_time,
      durationMinutes: m.match_duration || 45,
      title: 'League Match',
      info: `${m.eff_p1_name} vs ${m.eff_p2_name}`,
      color: '#6b7589',
      players: [],
      repeatGroupId: null,
      name: null,
    })),
    ...customBookings,
  ];

  return { courts, slots };
}

module.exports = {
  getAllBookingTypes, addBookingType, updateBookingType, deleteBookingType,
  addBooking, updateBooking, deleteBooking, deleteRepeatGroup, createRepeatBookings,
  getScheduleForDate,
};
