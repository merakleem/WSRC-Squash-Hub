const express = require('express');
const crypto = require('crypto');
const { getDB } = require('../database/db');
const leagueService = require('../services/leagueService');
const leagueModel = require('../models/leagueModel');
const { getValidConfigurations } = require('../utils/helpers');
const { wrap, requireAdmin, emailLimiter } = require('../middleware');
const { sendBatch, isConfigured: emailConfigured, appUrl, sendMany, inviteEmail } = require('../lib/email');
const { clubToday } = require('../lib/clock');
const sanitizeHtml = require('sanitize-html');

const { playDates } = require('../services/leagueService');

const router = express.Router();

function lastPlayDate(weekDate, playDays) {
  const days = Array.isArray(playDays) && playDays.length ? playDays : [];
  const dates = days.length ? playDates(weekDate, days) : [weekDate];
  return dates.reduce((a, b) => (a > b ? a : b));
}

router.get('/leagues', wrap(async (req, res) => {
  const leagues = await leagueModel.getAllLeagues();
  const db = getDB();
  const memberships = db.prepare('SELECT league_id, player_id FROM league_players').all();
  const memberMap = {};
  for (const row of memberships) {
    if (!memberMap[row.league_id]) memberMap[row.league_id] = [];
    memberMap[row.league_id].push(row.player_id);
  }
  const matchCounts = db.prepare(`
    SELECT w.league_id,
      COUNT(*) AS total,
      SUM(CASE WHEN m.player1_score IS NOT NULL OR m.skipped = 1 THEN 1 ELSE 0 END) AS done
    FROM matches m
    JOIN team_matchups tm ON m.matchup_id = tm.id
    JOIN weeks w ON tm.week_id = w.id
    GROUP BY w.league_id
  `).all();
  const countMap = {};
  for (const row of matchCounts) countMap[row.league_id] = row;

  // Week progress, for the card's segmented bar. One grouped query rather than
  // one per league. A week starts on its own date and stays current until the
  // next week's date arrives - the same rule the league page uses - so
  // "weeks started" counts dates on or before the club's today (not SQLite's
  // UTC now, which is already tomorrow by a Winnipeg evening).
  const weekRows = db.prepare(`
    SELECT w.league_id,
           COUNT(*) AS total_weeks,
           SUM(CASE WHEN w.date <= @today THEN 1 ELSE 0 END) AS weeks_started,
           MAX(w.date) AS last_week_date
    FROM weeks w
    GROUP BY w.league_id
  `).all({ today: clubToday() });
  const weekMap = {};
  for (const row of weekRows) weekMap[row.league_id] = row;

  // The signed-in player's own division, for the "You · Division 2" chip. Only
  // ever their own row: nobody else's placement is sent to a client, and this
  // is the whole list in one query rather than a fetch per card.
  const myDivision = {};
  const playerId = req.session?.playerId;
  if (playerId) {
    const rows = db.prepare(`
      SELECT lp.league_id, d.level
      FROM league_players lp
      JOIN divisions d ON d.id = lp.division_id
      WHERE lp.player_id = ?
    `).all(playerId);
    for (const row of rows) myDivision[row.league_id] = row.level;
  }

  // Doubles: how many pairs, and who the signed-in player's partner is.
  const pairCount = {};
  for (const row of db.prepare('SELECT league_id, COUNT(*) AS n FROM league_pairs GROUP BY league_id').all()) pairCount[row.league_id] = row.n;
  const myPartner = {};
  if (playerId) {
    const rows = db.prepare(`
      SELECT lp.league_id, CASE WHEN lp.player1_id = @id THEN p2.name ELSE p1.name END AS partner
      FROM league_pairs lp
      JOIN players p1 ON p1.id = lp.player1_id
      JOIN players p2 ON p2.id = lp.player2_id
      WHERE lp.player1_id = @id OR lp.player2_id = @id
    `).all({ id: playerId });
    for (const row of rows) myPartner[row.league_id] = row.partner;
  }

  // Signups, for the upcoming leagues' cards: the count, a few faces, and
  // whether this viewer is on the list.
  const signupCounts = leagueModel.getSignupCounts();
  const mySignups = playerId ? leagueModel.getSignupsForPlayer(playerId) : [];
  const today = clubToday();
  const previews = {};
  for (const l of leagues) {
    if (l.status !== 'upcoming') continue;
    previews[l.id] = leagueModel.getSignups(l.id).slice(0, 4)
      .map((r) => ({ id: r.player_id, name: r.name, photo_path: r.photo_path || null }));
  }

  res.json(leagues.map((l) => {
    const counts = countMap[l.id];
    // An announced league has no matches to count, so the derived status would
    // call it active and it would never read as upcoming anywhere.
    const status = l.status === 'upcoming' ? 'upcoming'
      : counts && counts.total > 0 && counts.done === counts.total ? 'completed' : 'active';
    const weeks = weekMap[l.id];
    const upcoming = status === 'upcoming'
      ? { ...signupState(l, signupCounts[l.id] || 0, today), signup_preview: previews[l.id] || [], i_signed_up: mySignups.includes(l.id) }
      : {};
    return {
      ...l,
      player_ids: memberMap[l.id] || [],
      status,
      ...upcoming,
      total_weeks: weeks?.total_weeks || 0,
      weeks_started: weeks?.weeks_started || 0,
      last_week_date: weeks?.last_week_date || null,
      // The last day actually played: the last week's first day plus the
      // furthest play day. A player reads the range to know when it is over.
      last_night_date: weeks?.last_week_date ? lastPlayDate(weeks.last_week_date, l.play_days) : null,
      my_division_level: myDivision[l.id] ?? null,
      pair_count: l.setup_type === 'doubles' ? (pairCount[l.id] || 0) : null,
      my_partner_name: myPartner[l.id] ?? null,
    };
  }));
}));

router.get('/leagues/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const league = await leagueService.getFullLeague(id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  if (league.status !== 'upcoming') return res.json(league);

  // An announcement has no weeks to send; it has a roster. Member numbers and
  // ratings are the admin's to see, as everywhere else.
  const isAdminUser = req.session?.role === 'admin';
  const rows = leagueModel.getSignups(id);
  const signups = rows.map((r) => ({
    player_id: r.player_id,
    name: r.name,
    photo_path: r.photo_path || null,
    signed_up_at: r.created_at,
    ...(isAdminUser ? { member_number: r.member_number || null, club_locker_rating: r.club_locker_rating ?? null } : {}),
  }));
  res.json({
    ...league,
    signups,
    ...signupState(league, rows.length, clubToday()),
    i_signed_up: !!req.session?.playerId && rows.some((r) => r.player_id === req.session.playerId),
  });
}));

// ===== UPCOMING LEAGUES =====
// Announced, open for signups, not yet built. Everything a member does here is
// one row in league_signups; building the league fills in the same league row.

const SETUP_TYPES = ['traditional', 'modern', 'doubles'];

/** What a league's signups mean right now, for both the list and the page. */
function signupState(league, count, today) {
  const cap = league.signup_cap ?? null;
  const full = cap != null && count >= cap;
  const pastDeadline = !!league.signup_deadline && league.signup_deadline < today;
  return {
    signup_count: count,
    spots_left: cap == null ? null : Math.max(0, cap - count),
    full,
    signups_closed: full || pastDeadline,
    deadline_passed: pastDeadline,
  };
}

/** Validate the announced fields. Returns an error string, or ''. */
function checkAnnouncement({ name, startDate, setupType, signupCap, signupDeadline }) {
  if (!name || !String(name).trim()) return 'A name is required.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || ''))) return 'A start date is required.';
  if (setupType && !SETUP_TYPES.includes(setupType)) return 'Unknown format.';
  if (signupCap != null && (!Number.isInteger(signupCap) || signupCap < 2)) return 'Spots must be a whole number of at least 2.';
  if (signupDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(signupDeadline)) return 'Invalid deadline.';
  if (signupDeadline && signupDeadline > startDate) return 'Deadline must be on or before the start date.';
  return '';
}

function readAnnouncement(body) {
  const cap = body.signupCap === '' || body.signupCap == null ? null : Number(body.signupCap);
  return {
    name: String(body.name || '').trim(),
    startDate: String(body.startDate || '').slice(0, 10),
    setupType: body.setupType || 'modern',
    description: String(body.description || '').trim(),
    signupCap: cap,
    signupDeadline: body.signupDeadline ? String(body.signupDeadline).slice(0, 10) : null,
  };
}

router.post('/leagues/upcoming', requireAdmin, wrap(async (req, res) => {
  const fields = readAnnouncement(req.body || {});
  const bad = checkAnnouncement(fields);
  if (bad) return res.status(400).json({ error: bad });
  const id = leagueModel.createAnnouncement(fields);
  res.json({ id });
}));

router.put('/leagues/:id/announcement', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const league = leagueModel.getLeagueById(id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  if (league.status !== 'upcoming') return res.status(400).json({ error: 'This league has already been built.' });
  const fields = readAnnouncement(req.body || {});
  const bad = checkAnnouncement(fields);
  if (bad) return res.status(400).json({ error: bad });
  // Lowering the cap under the people already on the list would make the
  // number a lie, and there is no rule for who to drop.
  const count = leagueModel.getSignups(id).length;
  if (fields.signupCap != null && fields.signupCap < count) {
    return res.status(400).json({ error: `${count} ${count === 1 ? 'person has' : 'people have'} already signed up.` });
  }
  res.json(leagueModel.updateAnnouncement(id, fields));
}));

/** The member signing themselves up. */
router.post('/leagues/:id/signup', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const playerId = req.session?.playerId;
  if (!playerId) return res.status(403).json({ error: 'Only players can sign up.' });
  const league = leagueModel.getLeagueById(id);
  if (!league || league.status !== 'upcoming') return res.status(404).json({ error: 'League not found' });
  const count = leagueModel.getSignups(id).length;
  const st = signupState(league, count, clubToday());
  // Already on the list is not a failure: say yes and move on.
  if (!leagueModel.getSignupsForPlayer(playerId).includes(id)) {
    if (st.full) return res.status(409).json({ error: 'This league is full.' });
    if (st.deadline_passed) return res.status(409).json({ error: 'Signups have closed.' });
    leagueModel.addSignup(id, playerId);
  }
  res.json({ ok: true });
}));

router.delete('/leagues/:id/signup', wrap(async (req, res) => {
  const playerId = req.session?.playerId;
  if (!playerId) return res.status(403).json({ error: 'Only players can withdraw.' });
  leagueModel.removeSignup(Number(req.params.id), playerId);
  res.json({ ok: true });
}));

/** The admin adding someone by hand. The cap does not apply to them. */
router.post('/leagues/:id/signups', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const playerId = Number(req.body?.playerId);
  const league = leagueModel.getLeagueById(id);
  if (!league || league.status !== 'upcoming') return res.status(404).json({ error: 'League not found' });
  if (!playerId) return res.status(400).json({ error: 'A player is required.' });
  leagueModel.addSignup(id, playerId);
  const count = leagueModel.getSignups(id).length;
  res.json({ ok: true, ...signupState(league, count, clubToday()) });
}));

router.delete('/leagues/:id/signups/:playerId', requireAdmin, wrap(async (req, res) => {
  leagueModel.removeSignup(Number(req.params.id), Number(req.params.playerId));
  res.json({ ok: true });
}));

router.post('/leagues', requireAdmin, wrap(async (req, res) => {
  // `leagueId` means "build this announcement", which fills the row in rather
  // than inserting. Only ever an upcoming one: pointed at a running league it
  // would overwrite a live schedule.
  const into = req.body?.leagueId ? leagueModel.getLeagueById(Number(req.body.leagueId)) : null;
  if (req.body?.leagueId && (!into || into.status !== 'upcoming')) {
    return res.status(400).json({ error: 'That league is not waiting to be built.' });
  }
  const leagueId = await leagueService.createLeague(req.body);
  res.json(leagueId);
}));

router.delete('/leagues/:id', requireAdmin, wrap(async (req, res) => {
  await leagueModel.deleteLeague(Number(req.params.id));
  res.json({ ok: true });
}));

router.put('/leagues/:id/end', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const db = getDB();
  const league = db.prepare('SELECT id, status FROM leagues WHERE id = ?').get(id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  if (league.status === 'completed') return res.status(400).json({ error: 'League is already completed' });

  db.prepare('UPDATE leagues SET status = ? WHERE id = ?').run('completed', id);
  const skipped = db.prepare(`
    UPDATE matches SET skipped = 1
    WHERE (player1_score IS NULL) AND (skipped IS NULL OR skipped = 0)
      AND matchup_id IN (
        SELECT tm.id FROM team_matchups tm
        JOIN weeks w ON tm.week_id = w.id
        WHERE w.league_id = ?
      )
  `).run(id);

  res.json({ ok: true, matchesSkipped: skipped.changes });
}));

router.post('/leagues/:id/replace-player', requireAdmin, wrap(async (req, res) => {
  const { oldPlayerId, newPlayerId } = req.body;
  if (!oldPlayerId || !newPlayerId) return res.status(400).json({ error: 'oldPlayerId and newPlayerId are required' });
  await leagueModel.replacePlayerInLeague(Number(req.params.id), Number(oldPlayerId), Number(newPlayerId));
  res.json({ ok: true });
}));

router.post('/leagues/:id/replace-pair-player', requireAdmin, wrap(async (req, res) => {
  const { pairId, oldPlayerId, newPlayerId } = req.body;
  if (!pairId || !oldPlayerId || !newPlayerId) return res.status(400).json({ error: 'pairId, oldPlayerId and newPlayerId are required' });
  leagueModel.replacePairPlayer(Number(req.params.id), Number(pairId), Number(oldPlayerId), Number(newPlayerId));
  res.json({ ok: true });
}));

router.put('/leagues/:id/sub-remaining', requireAdmin, wrap(async (req, res) => {
  const { originalPlayerId, subPlayerId } = req.body;
  const count = await leagueModel.setSubForRemaining(Number(req.params.id), originalPlayerId, subPlayerId);
  res.json({ ok: true, count });
}));

// The body arrives as editor HTML (bodyHtml) with a plain-text copy (body).
// Admin-authored, but it lands in players' inboxes, so it goes through a
// strict allowlist matching exactly what the editor can produce.
function sanitizeMessageHtml(bodyHtml) {
  return sanitizeHtml(bodyHtml, {
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 'b', 'i', 'ol', 'ul', 'li', 'a', 'h2', 'h3'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener' }) },
  });
}
router.sanitizeMessageHtml = sanitizeMessageHtml;

router.post('/leagues/:id/message', requireAdmin, wrap(async (req, res) => {
  const { subject, body, bodyHtml, attachments } = req.body;
  if (!subject || !(bodyHtml || body)) return res.status(400).json({ error: 'Subject and body are required' });

  if (!emailConfigured()) return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });

  // An announced league has no league_players yet - the people to write to are
  // the ones who signed up.
  const leagueId = Number(req.params.id);
  const league = leagueModel.getLeagueById(leagueId);
  const players = league?.status === 'upcoming'
    ? leagueModel.getSignups(leagueId).map((r) => ({ ...r, player_email: r.email }))
    : await leagueModel.getLeaguePlayers(leagueId);
  const recipients = players.filter((p) => p.player_email);
  if (recipients.length === 0) return res.json({ sent: 0 });

  const html = bodyHtml
    ? sanitizeMessageHtml(bodyHtml)
    : `<p>${body
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')}</p>`;

  // Only the two fields Resend reads; anything else the client sent is dropped.
  const files = (Array.isArray(attachments) ? attachments : [])
    .filter((a) => a && typeof a.filename === 'string' && typeof a.content === 'string')
    .map((a) => ({ filename: a.filename, content: a.content }));

  const { sent, failed } = await sendMany(recipients.map((player) => ({
    to: [player.player_email],
    subject,
    html,
    ...(body ? { text: body } : {}),
    ...(files.length ? { attachments: files } : {}),
  })));

  res.json({ sent, failed });
}));

router.post('/leagues/:id/bulk-invite', requireAdmin, emailLimiter, wrap(async (req, res) => {
  if (!emailConfigured()) return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });

  const db = getDB();
  const players = await leagueModel.getLeaguePlayers(Number(req.params.id));

  const eligible = players.filter((p) => {
    if (!p.player_email) return false;
    const account = db.prepare('SELECT password_hash FROM user_accounts WHERE player_id = ?').get(p.player_id);
    return !account?.password_hash;
  });

  if (eligible.length === 0) return res.json({ sent: 0 });

  const baseUrl = appUrl(req);
  const expires = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  const batch = eligible.map((p) => {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(`
      INSERT INTO user_accounts (player_id, invite_token, invite_expires)
      VALUES (?, ?, ?)
      ON CONFLICT (player_id) DO UPDATE SET invite_token = excluded.invite_token, invite_expires = excluded.invite_expires
    `).run(p.player_id, token, expires);
    return {
      to: [p.player_email],
      ...inviteEmail(p.player_name, `${baseUrl}/invite/${token}`),
    };
  });

  const { sent, failed } = await sendBatch(batch);

  res.json({ sent, failed });
}));

router.get('/configs/:numPlayers', wrap(async (req, res) => {
  res.json(getValidConfigurations(Number(req.params.numPlayers)));
}));

module.exports = router;
