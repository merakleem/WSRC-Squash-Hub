const { run, all, get, getDB } = require('../database/db');

// ===== BOOKING TYPES =====

async function getAllBookingTypes() {
  return all('SELECT * FROM booking_types ORDER BY name ASC');
}

async function addBookingType({ name, color }) {
  const result = await run('INSERT INTO booking_types (name, color) VALUES (?, ?)', [name, color]);
  return get('SELECT * FROM booking_types WHERE id = ?', [result.lastID]);
}

async function updateBookingType({ id, name, color }) {
  await run('UPDATE booking_types SET name = ?, color = ? WHERE id = ?', [name, color, id]);
  return get('SELECT * FROM booking_types WHERE id = ?', [id]);
}

async function deleteBookingType(id) {
  return run('DELETE FROM booking_types WHERE id = ?', [id]);
}

// ===== BOOKINGS =====

async function addBooking({ courtId, date, startTime, durationMinutes, bookingTypeId, info }) {
  const result = await run(
    'INSERT INTO bookings (court_id, date, start_time, duration_minutes, booking_type_id, info) VALUES (?, ?, ?, ?, ?, ?)',
    [courtId, date, startTime, durationMinutes, bookingTypeId || null, info || null]
  );
  return get(
    'SELECT b.*, bt.name AS type_name, bt.color AS type_color FROM bookings b LEFT JOIN booking_types bt ON bt.id = b.booking_type_id WHERE b.id = ?',
    [result.lastID]
  );
}

async function updateBooking({ id, courtId, date, startTime, durationMinutes, bookingTypeId, info }) {
  await run(
    'UPDATE bookings SET court_id = ?, date = ?, start_time = ?, duration_minutes = ?, booking_type_id = ?, info = ? WHERE id = ?',
    [courtId, date, startTime, durationMinutes, bookingTypeId || null, info || null, id]
  );
  return get(
    'SELECT b.*, bt.name AS type_name, bt.color AS type_color FROM bookings b LEFT JOIN booking_types bt ON bt.id = b.booking_type_id WHERE b.id = ?',
    [id]
  );
}

async function deleteBooking(id) {
  return run('DELETE FROM bookings WHERE id = ?', [id]);
}

// ===== SCHEDULE =====

function getScheduleForDate(date) {
  const db = getDB();

  const courts = db.prepare('SELECT * FROM courts ORDER BY sort_order ASC, id ASC').all();

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

  const customBookings = db.prepare(`
    SELECT b.*, bt.name AS type_name, bt.color AS type_color
    FROM bookings b
    LEFT JOIN booking_types bt ON bt.id = b.booking_type_id
    WHERE b.date = ?
    ORDER BY b.start_time ASC
  `).all(date);

  const slots = [
    ...leagueMatches.map((m) => ({
      id: `m_${m.match_id}`,
      source: 'league',
      courtId: m.court_id,
      startTime: m.start_time,
      durationMinutes: m.match_duration || 45,
      title: 'League Match',
      info: `${m.eff_p1_name} vs ${m.eff_p2_name}`,
      color: '#6b7589',
    })),
    ...customBookings.map((b) => ({
      id: b.id,
      source: 'custom',
      courtId: b.court_id,
      date: b.date,
      startTime: b.start_time,
      durationMinutes: b.duration_minutes,
      bookingTypeId: b.booking_type_id || null,
      title: b.type_name || 'Booking',
      info: b.info || '',
      color: b.type_color || '#6b7589',
    })),
  ];

  return { courts, slots };
}

module.exports = {
  getAllBookingTypes, addBookingType, updateBookingType, deleteBookingType,
  addBooking, updateBooking, deleteBooking,
  getScheduleForDate,
};
