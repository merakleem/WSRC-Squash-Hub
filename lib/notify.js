// The emails members choose in Settings: a new league, tournament or event,
// and a score someone else reported for their match. Each goes only to those
// with the matching switch on and an address to send to. Nothing here ever
// fails the action that triggered it: a send that goes wrong is logged.
const { getDB } = require('../database/db');
const log = require('./log');
const email = require('./email');

function _optedIn(key, { membersOnly = false, ids = null } = {}) {
  const where = [`${key} = 1`, 'email IS NOT NULL', "TRIM(email) != ''"];
  if (membersOnly) where.push('is_member = 1');
  if (ids) where.push(`id IN (${ids.map(Number).join(',') || 'NULL'})`);
  return getDB().prepare(`SELECT id, name, email FROM players WHERE ${where.join(' AND ')}`).all();
}

async function _send(what, messages) {
  if (!messages.length || !email.isConfigured()) return 0;
  try {
    const { sent } = await email.sendBatch(messages);
    return sent;
  } catch (err) {
    log.error({ err, what }, 'notification emails failed');
    return 0;
  }
}

/** A league has just been announced. */
function leagueAnnounced(req, { name, startDate, signupDeadline }) {
  const url = email.appUrl(req);
  return _send('league', _optedIn('notify_league_new').map((p) => ({
    to: [p.email],
    ...email.leagueAnnouncedEmail({ recipientName: p.name, name, startDate, signupDeadline, url }),
  })));
}

/** A tournament has just been announced. */
function tournamentAnnounced(req, { name, drawCap, firstRoundDate, signupDeadline }) {
  const url = email.appUrl(req);
  return _send('tournament', _optedIn('notify_tournament_new').map((p) => ({
    to: [p.email],
    ...email.tournamentAnnouncedEmail({ recipientName: p.name, name, drawCap, firstRoundDate, signupDeadline, url }),
  })));
}

/** An event has just been posted. A members-only event only reaches members. */
function eventPosted(req, event) {
  const url = email.appUrl(req);
  return _send('event', _optedIn('notify_event_new', { membersOnly: !!event.members_only }).map((p) => ({
    to: [p.email],
    ...email.eventPostedEmail({ recipientName: p.name, name: event.name, date: event.event_date, startTime: event.start_time, url }),
  })));
}

/**
 * A player reported a score. The other side hears about it; the reporter's
 * own partner does not, since they were there. Scores are games won by each
 * side, with `reporterSide` the ids on the reporter's side.
 */
function scoreReported(req, { reporterId, reporterSide, otherSide, reporterGames, otherGames }) {
  const db = getDB();
  const nameOf = (id) => db.prepare('SELECT name FROM players WHERE id = ?').get(id)?.name || 'A player';
  const reporterName = nameOf(reporterId);
  const opponents = reporterSide.filter((id) => id != null).map(nameOf);
  const url = email.appUrl(req);
  const ids = otherSide.filter((id) => id != null && id !== reporterId);
  return _send('score', _optedIn('notify_score_reported', { ids }).map((p) => ({
    to: [p.email],
    ...email.scoreReportedEmail({ recipientName: p.name, reporterName, opponents, mine: otherGames, theirs: reporterGames, url }),
  })));
}

module.exports = { leagueAnnounced, tournamentAnnounced, eventPosted, scoreReported };
