// The activity log: what the admin account and staff changed, in a sentence
// each, written in the past tense from the actor's side ("changed the score
// of Priya Nair v Marcus Chen to 3–1"). Shown in Settings, Activity log.
//
// Routes opt in with `audit(area)` after their permission check. The
// sentence is worked out before the route runs, so it can still name what a
// delete removes, and written only if the route succeeded.
const { getDB } = require('../database/db');
const log = require('./log');

const _get = (sql, ...args) => getDB().prepare(sql).get(...args);
const name = {
  player: (id) => _get('SELECT name FROM players WHERE id = ?', Number(id))?.name || 'a player',
  league: (id) => _get('SELECT name FROM leagues WHERE id = ?', Number(id))?.name || 'a league',
  tournament: (id) => _get('SELECT name FROM tournaments WHERE id = ?', Number(id))?.name || 'a tournament',
  event: (id) => _get('SELECT name FROM events WHERE id = ?', Number(id))?.name || 'an event',
  court: (id) => _get('SELECT name FROM courts WHERE id = ?', Number(id))?.name || 'a court',
  bookingType: (id) => _get('SELECT name FROM booking_types WHERE id = ?', Number(id))?.name || 'a booking type',
  match(id) {
    const m = _get('SELECT player1_id, player2_id, player1_partner_id, player2_partner_id FROM matches WHERE id = ?', Number(id));
    if (!m) return 'a match';
    const side = (a, b) => (b ? `${name.player(a)} and ${name.player(b)}` : name.player(a));
    return `${side(m.player1_id, m.player1_partner_id)} v ${side(m.player2_id, m.player2_partner_id)}`;
  },
  booking(id) {
    const b = _get('SELECT name, court_id, date, start_time FROM bookings WHERE id = ?', Number(id));
    return b ? `${b.name || 'a booking'} on ${name.court(b.court_id)}, ${b.date} ${b.start_time}` : 'a booking';
  },
};
const count = (ids, one) => {
  const n = Array.isArray(ids) ? ids.length : 0;
  return `${n} ${one}${n === 1 ? '' : 's'}`;
};
const score = (a, b) => `${Number(a)}–${Number(b)}`;
const quoted = (s) => `"${String(s || '').trim()}"`;

// METHOD + the route's path as written in routes/*.js -> the sentence.
const DESCRIBE = {
  // Players and accounts
  'POST /players': (r) => `added ${r.body?.name || 'a player'} as a player`,
  'PUT /players/:id': (r) => `edited ${name.player(r.params.id)}`,
  'DELETE /players/:id': (r) => `deleted the player ${name.player(r.params.id)}`,
  'POST /players/bulk': (r) => `changed ${Object.keys(r.body?.patch || {}).join(', ') || 'details'} for ${count(r.body?.ids, 'player')}`,
  'POST /players/membership': (r) => `set membership ${r.body?.is_member ? 'on' : 'off'} for ${count(r.body?.ids, 'player')}`,
  'POST /players/send-invite': (r) => `sent account invites to ${count(r.body?.ids, 'player')}`,
  'POST /players/:id/send-invite': (r) => `sent an account invite to ${name.player(r.params.id)}`,
  'POST /players/:id/send-reset': (r) => `sent a password reset to ${name.player(r.params.id)}`,
  'PUT /players/:id/photo': (r) => `changed the photo of ${name.player(r.params.id)}`,
  'DELETE /players/:id/photo': (r) => `removed the photo of ${name.player(r.params.id)}`,
  'POST /players/:id/view-as': (r) => `viewed the app as ${name.player(r.params.id)}`,

  // Leagues
  'POST /leagues/upcoming': (r) => `announced the league ${r.body?.name || ''}`.trim(),
  'PUT /leagues/:id/announcement': (r) => `edited the announcement for ${name.league(r.params.id)}`,
  'POST /leagues/:id/signups': (r) => `signed up ${name.player(r.body?.playerId)} for ${name.league(r.params.id)}`,
  'DELETE /leagues/:id/signups/:playerId': (r) => `removed ${name.player(r.params.playerId)} from the signups for ${name.league(r.params.id)}`,
  'POST /leagues': (r) => `built the league ${r.body?.name || (r.body?.leagueId ? name.league(r.body.leagueId) : '')}`.trim(),
  'DELETE /leagues/:id': (r) => `deleted ${name.league(r.params.id)}`,
  'PUT /leagues/:id/end': (r) => `ended ${name.league(r.params.id)}`,
  'POST /leagues/:id/replace-player': (r) => `replaced ${name.player(r.body?.oldPlayerId)} with ${name.player(r.body?.newPlayerId)} in ${name.league(r.params.id)}`,
  'POST /leagues/:id/replace-pair-player': (r) => `replaced ${name.player(r.body?.oldPlayerId)} with ${name.player(r.body?.newPlayerId)} in ${name.league(r.params.id)}`,
  'PUT /leagues/:id/sub-remaining': (r) => `put ${name.player(r.body?.subPlayerId)} in for ${name.player(r.body?.originalPlayerId)} for the rest of ${name.league(r.params.id)}`,
  'PUT /matches/:id/timing': (r) => `changed the time or court of ${name.match(r.params.id)}`,
  'PUT /matches/:id/sub': (r) => `put ${name.player(r.body?.subPlayerId)} in for ${name.player(r.body?.originalPlayerId)} in ${name.match(r.params.id)}`,
  'DELETE /matches/:id/sub': (r) => `removed the sub for ${name.player(r.body?.originalPlayerId)} in ${name.match(r.params.id)}`,

  // Tournaments
  'POST /tournaments/upcoming': (r) => `announced the tournament ${r.body?.name || ''}`.trim(),
  'PUT /tournaments/:id/announcement': (r) => `edited the announcement for ${name.tournament(r.params.id)}`,
  'POST /tournaments/:id/signups': (r) => `signed up ${name.player(r.body?.playerId)} for ${name.tournament(r.params.id)}`,
  'DELETE /tournaments/:id/signups/:playerId': (r) => `removed ${name.player(r.params.playerId)} from the signups for ${name.tournament(r.params.id)}`,
  'POST /tournaments': (r) => `built the draw for ${r.body?.name || (r.body?.tournamentId ? name.tournament(r.body.tournamentId) : 'a tournament')}`,
  'PUT /tournaments/:id/schedule': (r) => `changed the schedule of ${name.tournament(r.params.id)}`,
  'DELETE /tournaments/:id': (r) => `deleted ${name.tournament(r.params.id)}`,
  'POST /tournaments/:id/replace': (r) => `replaced ${name.player(r.body?.oldPlayerId)} with ${name.player(r.body?.newPlayerId)} in ${name.tournament(r.params.id)}`,
  'POST /tournaments/:id/withdraw': (r) => `withdrew ${name.player(r.body?.playerId)} from ${name.tournament(r.params.id)}`,

  // Events
  'POST /events': (r) => `posted the event ${r.body?.name || ''}`.trim(),
  'PUT /events/:id': (r) => `edited ${name.event(r.params.id)}`,
  'DELETE /events/:id': (r) => `deleted ${name.event(r.params.id)}`,
  'POST /events/:id/signups': (r) => `added ${name.player(r.body?.playerId)} to ${name.event(r.params.id)}`,
  'DELETE /events/:id/signups/:playerId': (r) => `removed ${name.player(r.params.playerId)} from ${name.event(r.params.id)}`,

  // Court schedule and bookings
  'POST /bookings': (r) => `booked ${r.body?.name ? quoted(r.body.name) : 'a court'} on ${r.body?.date || ''} at ${r.body?.startTime || ''}`.trim(),
  'POST /bookings/repeat': (r) => `added repeating bookings ${r.body?.name ? quoted(r.body.name) : ''}`.trim(),
  'PUT /bookings/:id': (r) => `changed the booking ${name.booking(r.params.id)}`,
  'DELETE /bookings/:id': (r) => `removed the booking ${name.booking(r.params.id)}`,

  // Scores
  'PUT /matches/:id/score': (r) => `entered the score of ${name.match(r.params.id)} as ${score(r.body?.player1Score, r.body?.player2Score)}`,
  'PUT /tournament-matches/:id/score': (r) => `entered the score of ${name.match(r.params.id)} as ${score(r.body?.p1, r.body?.p2)}`,
  'DELETE /tournament-matches/:id/score': (r) => `cleared the score of ${name.match(r.params.id)}`,
  'PUT /matches/:id/unskip': (r) => `undid the skip of ${name.match(r.params.id)}`,
  'DELETE /matches/pickup/:id': (r) => `deleted the match ${name.match(r.params.id)}`,
  'DELETE /matches/doubles/:id': (r) => `deleted the match ${name.match(r.params.id)}`,
  'POST /matches/pickup': (r) => `entered a ladder match, ${name.player(r.body?.player1Id)} v ${name.player(r.body?.player2Id)}, as ${score(r.body?.player1Score, r.body?.player2Score)}`,
  'POST /matches/doubles': (r) => {
    const [a, b] = r.body?.team1 || [], [c, d] = r.body?.team2 || [];
    return `entered a doubles ladder match, ${name.player(a)} and ${name.player(b)} v ${name.player(c)} and ${name.player(d)}, as ${score(r.body?.team1Score, r.body?.team2Score)}`;
  },

  // Message players
  'POST /leagues/:id/message': (r) => `sent a group email to ${name.league(r.params.id)}: ${quoted(r.body?.subject)}`,
  'POST /leagues/:id/bulk-invite': (r) => `sent account invites to the players in ${name.league(r.params.id)}`,
  'POST /tournaments/:id/message': (r) => `sent a group email to ${name.tournament(r.params.id)}: ${quoted(r.body?.subject)}`,
  'POST /tournaments/:id/bulk-invite': (r) => `sent account invites to the players in ${name.tournament(r.params.id)}`,

  // Ladder and seasons, courts, club
  'PUT /seasons/settings': (r) => `set the season to start on ${r.body?.season_start_md || ''}`.trim(),
  'POST /courts': (r) => `added the court ${r.body?.name || ''}`.trim(),
  'PUT /courts/:id': (r) => `renamed ${name.court(r.params.id)} to ${r.body?.name || ''}`.trim(),
  'DELETE /courts/:id': (r) => `deleted ${name.court(r.params.id)}`,
  'POST /booking-types': (r) => `added the booking type ${r.body?.name || ''}`.trim(),
  'PUT /booking-types/:id': (r) => `edited the booking type ${name.bookingType(r.params.id)}`,
  'DELETE /booking-types/:id': (r) => `deleted the booking type ${name.bookingType(r.params.id)}`,
};

// PUT /settings carries several keys; each says what it was set to.
const SETTING_WORDS = {
  club_timezone: (v) => `changed the club time zone to ${v}`,
  elo_club_locker_pivot: (v) => `set the mid-ladder rating to ${v}`,
  elo_club_locker_scale: (v) => `set the points per rating point to ${v}`,
  elo_margin_weight: (v) => `set the winning margin weight per game to ${v}`,
};
function describeSettings(body) {
  return Object.entries(body || {}).map(([k, v]) => SETTING_WORDS[k]?.(v) || `changed the setting ${k}`).join(', ');
}

/** Write one entry. `staffId` null is the admin account. */
function record({ staffId = null, area, text }) {
  try {
    getDB().prepare('INSERT INTO activity_log (staff_id, area, text) VALUES (?, ?, ?)').run(staffId, area, text);
  } catch (err) {
    log.error({ err, area }, 'activity log write failed');
  }
}

/** Who did it, from the session: a staff member's id, or null for the admin account. */
function actorOf(session) {
  return session?.role === 'staff' ? session.staff.id : null;
}

/**
 * Route middleware: log this request in `area` if it succeeds and was made
 * from the club side (the admin account or staff, not a player). `text`
 * overrides the table above.
 */
function audit(area, text = null) {
  return (req, res, next) => {
    const role = req.session?.role;
    if (role !== 'admin' && role !== 'staff') return next();
    let sentence = null;
    try {
      const key = `${req.method} ${req.route?.path}`;
      sentence = typeof text === 'function' ? text(req) : (text || DESCRIBE[key]?.(req) || null);
    } catch (err) {
      log.warn({ err }, 'activity log description failed');
    }
    if (sentence) {
      const staffId = actorOf(req.session);
      res.on('finish', () => {
        if (res.statusCode < 400) record({ staffId, area, text: sentence });
      });
    }
    next();
  };
}

/**
 * A page of the log, newest first, with the actor's name. Filters: person
 * ('admin' or a staff id), area, from and to (YYYY-MM-DD, inclusive, UTC).
 */
function list({ person = null, area = null, from = null, to = null, before = null, limit = 50 } = {}) {
  const where = [];
  const args = [];
  if (person === 'admin') where.push('l.staff_id IS NULL');
  else if (person) { where.push('l.staff_id = ?'); args.push(Number(person)); }
  if (area) { where.push('l.area = ?'); args.push(area); }
  if (from) { where.push('l.at >= ?'); args.push(`${from}T00:00:00`); }
  if (to) { where.push('l.at <= ?'); args.push(`${to}T23:59:59.999Z`); }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = getDB().prepare(`SELECT COUNT(*) AS n FROM activity_log l ${filter}`).get(...args).n;
  const page = before ? [...where, 'l.id < ?'] : where;
  const rows = getDB().prepare(`
    SELECT l.id, l.at, l.area, l.text, l.staff_id, s.name AS staff_name
    FROM activity_log l LEFT JOIN staff_accounts s ON s.id = l.staff_id
    ${page.length ? `WHERE ${page.join(' AND ')}` : ''}
    ORDER BY l.id DESC LIMIT ?`).all(...args, ...(before ? [Number(before)] : []), Math.min(Number(limit) || 50, 200));
  return {
    total,
    entries: rows.map((r) => ({ id: r.id, at: r.at, area: r.area, text: r.text, actor: r.staff_id ? r.staff_name : 'Administrator', staff_id: r.staff_id })),
  };
}

module.exports = { audit, record, actorOf, list, describeSettings, DESCRIBE };
