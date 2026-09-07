const { getDB } = require('../database/db');

// ===== EVENTS =====
// Club happenings members sign up for - socials, open days, and registration
// events that point at a league or tournament. Capacity counts members and
// their guests together; every write that could breach it runs in a
// transaction so two sign-ups cannot both take the last spot.

function _validationError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function _initials(name) {
  return String(name || '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function _counts(db, eventId) {
  return db.prepare(`
    SELECT COUNT(*) AS members_count, COALESCE(SUM(guests), 0) AS guests_count
    FROM event_signups WHERE event_id = ?
  `).get(eventId);
}

function _link(db, e) {
  if (e.league_id) {
    const l = db.prepare('SELECT id, name FROM leagues WHERE id = ?').get(e.league_id);
    if (l) return { type: 'league', id: l.id, name: l.name };
  }
  if (e.tournament_id) {
    const t = db.prepare('SELECT id, name FROM tournaments WHERE id = ?').get(e.tournament_id);
    if (t) return { type: 'tournament', id: t.id, name: t.name };
  }
  return null;
}

// The shape every event goes out as: raw row + aggregates + the viewer's own
// signup + the linked competition, all resolved server-side so no two screens
// can do the capacity math differently.
function _shape(db, e, viewerId) {
  const { members_count, guests_count } = _counts(db, e.id);
  const total = members_count + guests_count;
  const spots_left = e.max_people == null ? null : Math.max(0, e.max_people - total);
  const full = e.max_people != null && total >= e.max_people;
  const mine = viewerId != null
    ? db.prepare('SELECT guests FROM event_signups WHERE event_id = ? AND player_id = ?').get(e.id, viewerId)
    : null;
  // The viewer is excluded here: the card prepends its own ME circle.
  const preview = db.prepare(`
    SELECT p.name FROM event_signups s JOIN players p ON p.id = s.player_id
    WHERE s.event_id = ? AND s.player_id != COALESCE(?, -1)
    ORDER BY s.created_at ASC, s.id ASC LIMIT 3
  `).all(e.id, viewerId).map((r) => ({ name: r.name, initials: _initials(r.name) }));
  return {
    id: e.id,
    name: e.name,
    description: e.description || '',
    event_date: e.event_date,
    start_time: e.start_time || null,
    guests_allowed: e.guests_allowed,
    max_people: e.max_people,
    members_count,
    guests_count,
    total,
    spots_left,
    full,
    my_signup: mine ? { guests: mine.guests } : null,
    link: _link(db, e),
    preview,
  };
}

function listEvents({ scope, today, viewerId }) {
  const db = getDB();
  const past = scope === 'past';
  const rows = db.prepare(
    past
      ? `SELECT * FROM events WHERE event_date < ? ORDER BY event_date DESC, start_time ASC, id ASC`
      : `SELECT * FROM events WHERE event_date >= ? ORDER BY event_date ASC, start_time ASC, id ASC`
  ).all(today);
  return rows.map((e) => _shape(db, e, viewerId));
}

function getEvent(id, { viewerId, isAdmin }) {
  const db = getDB();
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!e) return null;
  const shaped = _shape(db, e, viewerId);
  shaped.attendees = db.prepare(`
    SELECT s.player_id, p.name, p.member_number, s.guests, s.created_at
    FROM event_signups s JOIN players p ON p.id = s.player_id
    WHERE s.event_id = ?
    ORDER BY s.created_at ASC, s.id ASC
  `).all(id).map((a) => ({
    player_id: a.player_id,
    name: a.name,
    initials: _initials(a.name),
    member_number: isAdmin ? (a.member_number || null) : undefined,
    guests: a.guests,
  }));
  return shaped;
}

function _validateFields({ name, event_date, start_time, guests_allowed, max_people, league_id, tournament_id }) {
  if (!name || !String(name).trim()) throw _validationError('Name is required.');
  if (!event_date || !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) throw _validationError('A date is required.');
  if (start_time != null && start_time !== '' && !/^\d{2}:\d{2}$/.test(start_time)) throw _validationError('Start time must be HH:MM.');
  const guests = Number(guests_allowed) || 0;
  if (guests < 0) throw _validationError('Guests allowed cannot be negative.');
  const max = max_people == null || max_people === '' ? null : Number(max_people);
  if (max != null && (!Number.isInteger(max) || max < 1)) throw _validationError('Max people must be a whole number of at least 1.');
  if (league_id && tournament_id) throw _validationError('An event can link to a league or a tournament, not both.');
  return {
    name: String(name).trim(),
    event_date,
    start_time: start_time || null,
    // A linked event never takes guests: people register themselves.
    guests_allowed: (league_id || tournament_id) ? 0 : guests,
    max_people: max,
    league_id: league_id || null,
    tournament_id: tournament_id || null,
  };
}

function createEvent(fields) {
  const db = getDB();
  const f = _validateFields(fields);
  const r = db.prepare(`
    INSERT INTO events (name, description, event_date, start_time, guests_allowed, max_people, league_id, tournament_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(f.name, String(fields.description || ''), f.event_date, f.start_time, f.guests_allowed, f.max_people, f.league_id, f.tournament_id);
  return db.prepare('SELECT * FROM events WHERE id = ?').get(r.lastInsertRowid);
}

function updateEvent(id, fields) {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!existing) throw _validationError('Event not found.', 404);
  const f = _validateFields(fields);
  db.prepare(`
    UPDATE events SET name = ?, description = ?, event_date = ?, start_time = ?,
      guests_allowed = ?, max_people = ?, league_id = ?, tournament_id = ?
    WHERE id = ?
  `).run(f.name, String(fields.description || ''), f.event_date, f.start_time, f.guests_allowed, f.max_people, f.league_id, f.tournament_id, id);
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

function deleteEvent(id) {
  return getDB().prepare('DELETE FROM events WHERE id = ?').run(id);
}

// Sign up, or change a guest count. One transaction covers the read and the
// write, so the capacity check cannot race another member's.
function _writeSignup(eventId, playerId, guests, today, { mustExist }) {
  const db = getDB();
  const g = Number(guests) || 0;
  const txn = db.transaction(() => {
    const e = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!e) throw _validationError('Event not found.', 404);
    if (e.event_date < today) throw _validationError('This event has already happened.', 409);
    if (g < 0 || g > e.guests_allowed) {
      throw _validationError(e.guests_allowed === 0
        ? 'This event does not take guests.'
        : `Up to ${e.guests_allowed} guest${e.guests_allowed === 1 ? '' : 's'} per member.`);
    }
    const mine = db.prepare('SELECT guests FROM event_signups WHERE event_id = ? AND player_id = ?').get(eventId, playerId);
    if (mustExist && !mine) throw _validationError('You are not signed up for this event.', 409);
    const { members_count, guests_count } = _counts(db, eventId);
    const totalWithoutMe = members_count + guests_count - (mine ? 1 + mine.guests : 0);
    if (e.max_people != null && totalWithoutMe + 1 + g > e.max_people) {
      throw _validationError('Sorry, this event just filled up.', 409);
    }
    if (mine) {
      db.prepare('UPDATE event_signups SET guests = ? WHERE event_id = ? AND player_id = ?').run(g, eventId, playerId);
    } else {
      db.prepare('INSERT INTO event_signups (event_id, player_id, guests) VALUES (?, ?, ?)').run(eventId, playerId, g);
    }
  });
  txn();
}

function signUp(eventId, playerId, guests, today) {
  _writeSignup(eventId, playerId, guests, today, { mustExist: false });
}

function updateSignup(eventId, playerId, guests, today) {
  _writeSignup(eventId, playerId, guests, today, { mustExist: true });
}

function withdraw(eventId, playerId) {
  return getDB().prepare('DELETE FROM event_signups WHERE event_id = ? AND player_id = ?').run(eventId, playerId);
}

function removeAttendee(eventId, playerId) {
  return getDB().prepare('DELETE FROM event_signups WHERE event_id = ? AND player_id = ?').run(eventId, playerId);
}

function exportRows(eventId) {
  const db = getDB();
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!e) throw _validationError('Event not found.', 404);
  const rows = db.prepare(`
    SELECT p.name, p.member_number, s.guests, s.created_at
    FROM event_signups s JOIN players p ON p.id = s.player_id
    WHERE s.event_id = ?
    ORDER BY p.name COLLATE NOCASE ASC
  `).all(eventId);
  return { event: e, rows };
}

// Leagues and tournaments an event can point at, for the modal's search box.
function searchLinkables(q) {
  const db = getDB();
  const like = `%${String(q || '').trim()}%`;
  const leagues = db.prepare(`
    SELECT id, name, num_divisions, start_date FROM leagues
    WHERE name LIKE ? ORDER BY start_date DESC LIMIT 6
  `).all(like).map((l) => {
    const d = new Date(l.start_date + 'T12:00:00');
    const meta = [
      `${l.num_divisions} division${l.num_divisions === 1 ? '' : 's'}`,
      isNaN(d) ? null : `${_DAYS[d.getDay()]}s`,
    ].filter(Boolean).join(' · ');
    return { type: 'league', id: l.id, name: l.name, meta };
  });
  const tournaments = db.prepare(`
    SELECT id, name, championship_date FROM tournaments
    WHERE name LIKE ? ORDER BY championship_date DESC LIMIT 6
  `).all(like).map((t) => {
    const d = new Date(t.championship_date + 'T12:00:00');
    const meta = isNaN(d) ? '' : `${d.getDate()} ${_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    return { type: 'tournament', id: t.id, name: t.name, meta };
  });
  return [...leagues, ...tournaments];
}

module.exports = {
  listEvents, getEvent, createEvent, updateEvent, deleteEvent,
  signUp, updateSignup, withdraw, removeAttendee, exportRows, searchLinkables,
};
