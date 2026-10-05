const express = require('express');
const notify = require('../lib/notify');
const tournamentModel = require('../models/tournamentModel');
const bookingModel = require('../models/bookingModel');
const { getLadderForSeason } = require('../models/ladderModel');
const { wrap, requireAuth, emailLimiter, requirePerm, hasPerm } = require('../middleware');
const { audit } = require('../lib/audit');
const { isConfigured: emailConfigured } = require('../lib/email');
const { clubToday } = require('../lib/clock');
const { signupState, ISO_DATE } = require('../lib/signups');
const { messagePlayers, invitePlayers } = require('../lib/playerMail');
const K = require('../renderer/knockout.js');

const router = express.Router();

// ===== HELPERS =====

/** Current singles ladder position by player id. */
function ladderRanks() {
  const out = {};
  for (const r of getLadderForSeason().rows) out[r.id] = r.position;
  return out;
}

/** An announced tournament's signups: the draw cap is the cap. */
const signupsOf = (t, count) => signupState({ cap: t.draw_cap, deadline: t.signup_deadline || null }, count, clubToday());

/** Signups ordered as the draw would seed them: ladder rank, unranked last in the order they joined. */
function rankedSignups(rows, ranks) {
  return rows
    .map((r, k) => ({ ...r, rank: ranks[r.player_id] ?? null, k }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.k - b.k);
}

const errorStatus = (res, err) => res.status(err.status || 500).json({ error: err.message });

/**
 * What a list card needs about a built tournament, for this viewer: where it
 * is, its champion when it has one, and the viewer's own next match or exit.
 */
function cardSummary(t, viewerId) {
  const full = tournamentModel.getTournament(t.id);
  const b = tournamentModel.bracketOf(full);
  if (!b) return {};
  const cur = b.rounds[b.cur];
  const curDate = cur.find((m) => !m.bye && !m.winner)?.date || cur[0].date;
  const out = {
    entrant_count: b.ent,
    draw_size: b.draw,
    current_round: K.ROUND_KEYS[b.draw][b.cur],
    current_round_date: curDate,
    played: b.played,
    total: b.total,
    left_in_round: cur.filter((m) => !m.bye && !m.winner).length,
    first_round_date: full.rounds[0]?.date || null,
    final_date: b.final.date,
  };
  if (b.champion) {
    const loser = K.loserOf(b.final);
    out.champion = { id: b.champion.id, name: b.champion.name };
    out.runner_up = loser ? { id: loser.id, name: loser.name } : null;
    out.final_score = b.final.score && loser ? (b.final.winner === b.final.p1 ? `${b.final.score.p1}–${b.final.score.p2}` : `${b.final.score.p2}–${b.final.score.p1}`) : null;
  }
  const me = viewerId != null ? b.pById[viewerId] : null;
  if (me) {
    const next = b.rounds.flat().find((m) => (m.p1 === me || m.p2 === me) && !m.bye && !m.winner);
    if (next) {
      const opp = next.p1 === me ? next.p2 : next.p1;
      const feeder = K.feedersOf(b, next)[next.p1 === me ? 1 : 0];
      out.my_next = {
        label: next.label, date: next.date, time: next.time == null ? null : K.toHHMM(next.time),
        court: next.court?.name || null,
        opponent: opp ? opp.name : feeder ? `winner of ${feeder.label}` : 'TBD',
      };
    } else {
      const st = K.standing(b, me);
      if (st.kind === 'out' && st.match) {
        const m = st.match;
        out.my_out = { label: m.label, winner: m.winner.name, sub: st.sub };
      }
    }
  }
  return out;
}

// ===== READING =====

router.get('/tournaments', wrap(async (req, res) => {
  const viewerId = req.session?.playerId ?? null;
  const counts = tournamentModel.getSignupCounts();
  const mine = viewerId ? tournamentModel.getSignupsForPlayer(viewerId) : [];
  const ranks = ladderRanks();
  res.json(tournamentModel.getTournaments().map((t) => {
    if (t.status === 'upcoming') {
      const roster = rankedSignups(tournamentModel.getSignups(t.id), ranks);
      return {
        ...t,
        ...signupsOf(t, counts[t.id] || 0),
        signup_preview: roster.slice(0, 4).map((r) => ({ id: r.player_id, name: r.name, photo_path: r.photo_path || null })),
        i_signed_up: mine.includes(t.id),
      };
    }
    return { ...t, ...cardSummary(t, viewerId) };
  }));
}));

router.get('/tournaments/:id', wrap(async (req, res) => {
  const t = tournamentModel.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournament not found.' });
  const isAdminUser = hasPerm(req.session, 'tournaments');
  const viewerId = req.session?.playerId ?? null;
  const strip = (p) => {
    const { email, member_number: num, ...rest } = p;
    return isAdminUser ? { ...rest, email: email || null, member_number: num || null } : rest;
  };
  if (t.status !== 'upcoming') {
    return res.json({ ...t, players: t.players.map(strip) });
  }
  // An announcement has no draw yet; it has a roster, in the order the draw
  // would seed it, with each player's ladder rank as it stands today.
  const ranks = ladderRanks();
  const rows = rankedSignups(tournamentModel.getSignups(t.id), ranks);
  res.json({
    ...t,
    players: [],
    signups: rows.map((r) => strip({
      player_id: r.player_id, name: r.name, photo_path: r.photo_path || null,
      signed_up_at: r.created_at, rank: r.rank, email: r.email, member_number: r.member_number,
    })),
    ...signupsOf(t, rows.length),
    i_signed_up: viewerId != null && rows.some((r) => r.player_id === viewerId),
  });
}));

// ===== ANNOUNCING =====

function readAnnouncement(body) {
  return {
    name: String(body.name || '').trim(),
    drawCap: Number(body.drawCap),
    firstRoundDate: String(body.firstRoundDate || '').slice(0, 10),
    signupDeadline: body.signupDeadline ? String(body.signupDeadline).slice(0, 10) : null,
    description: String(body.description || '').trim(),
  };
}

function checkAnnouncement(f) {
  if (!f.name) return 'Tournament name is required.';
  if (!K.DRAW_SIZES.includes(f.drawCap)) return 'Choose an 8- or 16-player draw.';
  if (!ISO_DATE.test(f.firstRoundDate)) return 'A first-round date is required.';
  if (f.signupDeadline && !ISO_DATE.test(f.signupDeadline)) return 'Invalid sign-up date.';
  if (f.signupDeadline && f.signupDeadline > f.firstRoundDate) return 'Sign up by must be on or before the first round.';
  return '';
}

router.post('/tournaments/upcoming', requirePerm('tournaments'), audit('tournaments'), wrap(async (req, res) => {
  const f = readAnnouncement(req.body || {});
  const bad = checkAnnouncement(f);
  if (bad) return res.status(400).json({ error: bad });
  const id = tournamentModel.createAnnouncement(f);
  await notify.tournamentAnnounced(req, f);
  res.json({ id });
}));

router.put('/tournaments/:id/announcement', requirePerm('tournaments'), audit('tournaments'), wrap(async (req, res) => {
  const t = tournamentModel.getTournamentRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournament not found.' });
  if (t.status !== 'upcoming') return res.status(400).json({ error: 'This tournament has already been built.' });
  const f = readAnnouncement(req.body || {});
  const bad = checkAnnouncement(f);
  if (bad) return res.status(400).json({ error: bad });
  const count = tournamentModel.getSignups(t.id).length;
  if (count > f.drawCap) return res.status(400).json({ error: `${count} players have already signed up.` });
  res.json(tournamentModel.updateAnnouncement(t.id, f));
}));

/** The member signing themselves up. */
router.post('/tournaments/:id/signup', wrap(async (req, res) => {
  const playerId = req.session?.playerId;
  if (!playerId) return res.status(403).json({ error: 'Only players can sign up.' });
  const t = tournamentModel.getTournamentRow(req.params.id);
  if (!t || t.status !== 'upcoming') return res.status(404).json({ error: 'Tournament not found.' });
  // Already on the list is not a failure: say yes and move on.
  if (!tournamentModel.getSignupsForPlayer(playerId).includes(t.id)) {
    const st = signupsOf(t, tournamentModel.getSignups(t.id).length);
    if (st.full) return res.status(409).json({ error: 'The draw is full.' });
    if (st.deadline_passed) return res.status(409).json({ error: 'Signups have closed.' });
    tournamentModel.addSignup(t.id, playerId);
  }
  res.json({ ok: true });
}));

router.delete('/tournaments/:id/signup', wrap(async (req, res) => {
  const playerId = req.session?.playerId;
  if (!playerId) return res.status(403).json({ error: 'Only players can withdraw.' });
  const t = tournamentModel.getTournamentRow(req.params.id);
  if (t && t.status === 'upcoming') tournamentModel.removeSignup(t.id, playerId);
  res.json({ ok: true });
}));

/** The admin adding someone by hand. A draw has no room past its cap. */
router.post('/tournaments/:id/signups', requirePerm('tournaments'), audit('tournaments'), wrap(async (req, res) => {
  const t = tournamentModel.getTournamentRow(req.params.id);
  if (!t || t.status !== 'upcoming') return res.status(404).json({ error: 'Tournament not found.' });
  const playerId = Number(req.body?.playerId);
  if (!playerId) return res.status(400).json({ error: 'A player is required.' });
  if (tournamentModel.getSignups(t.id).length >= t.draw_cap) return res.status(409).json({ error: `The draw is full at ${t.draw_cap}.` });
  tournamentModel.addSignup(t.id, playerId);
  res.json({ ok: true, ...signupsOf(t, tournamentModel.getSignups(t.id).length) });
}));

router.delete('/tournaments/:id/signups/:playerId', requirePerm('tournaments'), audit('tournaments'), wrap(async (req, res) => {
  tournamentModel.removeSignup(Number(req.params.id), Number(req.params.playerId));
  res.json({ ok: true });
}));

// ===== BUILDING =====

function readRounds(rounds) {
  return (Array.isArray(rounds) ? rounds : []).map((r) => ({ date: String(r?.date || '').slice(0, 10), time: String(r?.time || '').slice(0, 5) }));
}

/**
 * Court conflicts for a proposed schedule, round by round: anything already on
 * the grid (bookings, league matches, other tournaments, holds) that overlaps
 * a match on one of its courts. A tournament being rescheduled is not in its
 * own way.
 */
router.post('/tournaments/check-schedule', requirePerm('tournaments'), wrap(async (req, res) => {
  const rounds = readRounds(req.body?.rounds);
  const counts = Array.isArray(req.body?.counts) ? req.body.counts.map(Number) : [];
  const courtIds = (req.body?.courtIds || []).map(Number);
  const len = Number(req.body?.len) || 0;
  const buffer = Number(req.body?.buffer) || 0;
  const own = new Set();
  if (req.body?.tournamentId) {
    const t = tournamentModel.getTournament(req.body.tournamentId);
    for (const m of t?.matches || []) own.add(`t_${m.id}`);
  }
  const days = {};
  const dayOf = (date) => {
    if (!days[date]) days[date] = bookingModel.getScheduleForDate(date);
    return days[date];
  };
  const out = rounds.map((r, k) => {
    if (!ISO_DATE.test(r.date) || !/^\d{2}:\d{2}$/.test(r.time) || !courtIds.length || !len) return [];
    const { courts, slots } = dayOf(r.date);
    const courtName = (id) => courts.find((c) => c.id === id)?.name || `Court ${id}`;
    const found = [];
    for (let j = 0; j < (counts[k] || 0); j++) {
      const s = K.slotTime(j, { start: K.toMin(r.time), courtCount: courtIds.length, len, buffer });
      const courtId = courtIds[s.courtIndex];
      for (const slot of slots) {
        if (own.has(String(slot.id))) continue;
        const ids = slot.courtIds?.length ? slot.courtIds : [slot.courtId];
        if (!ids.includes(courtId)) continue;
        const a = K.toMin(slot.startTime);
        const b = a + Number(slot.durationMinutes || 0);
        if (s.time < b && a < s.time + len && !found.some((f) => f.key === `${slot.id}:${courtId}`)) {
          found.push({ key: `${slot.id}:${courtId}`, courtId, court: courtName(courtId), from: slot.startTime, to: K.toHHMM(b), what: slot.title || 'Booking' });
        }
      }
    }
    return found.map(({ key: _key, ...f }) => f);
  });
  res.json({ conflicts: out });
}));

/** Build the draw - a new tournament, or (with tournamentId) an announced one. */
router.post('/tournaments', requirePerm('tournaments'), audit('tournaments'), wrap(async (req, res) => {
  const body = req.body || {};
  const fields = {
    tournamentId: body.tournamentId ? Number(body.tournamentId) : null,
    name: String(body.name || '').trim(),
    drawCap: Number(body.drawCap),
    entrants: (body.entrants || []).map(Number),
    seeding: body.seeding === 'manual' ? 'manual' : 'ladder',
    rounds: readRounds(body.rounds),
    courtIds: (body.courtIds || []).map(Number),
    len: Number(body.len),
    buffer: Number(body.buffer),
  };
  if (fields.tournamentId) {
    const t = tournamentModel.getTournamentRow(fields.tournamentId);
    if (!t || t.status !== 'upcoming') return res.status(400).json({ error: 'That tournament is not waiting to be built.' });
  }
  const errs = tournamentModel.checkDraw(fields);
  if (errs.length) return res.status(400).json({ error: errs[0] });
  try {
    const id = tournamentModel.createKnockout({ ...fields, ladderRanks: ladderRanks() });
    res.json({ id });
  } catch (err) { return errorStatus(res, err); }
}));

router.put('/tournaments/:id/schedule', requirePerm('tournaments'), audit('tournaments'), wrap(async (req, res) => {
  try {
    res.json(tournamentModel.updateSchedule(Number(req.params.id), {
      rounds: readRounds(req.body?.rounds),
      courtIds: (req.body?.courtIds || []).map(Number),
      len: Number(req.body?.len) || 40,
      buffer: Math.max(0, Number(req.body?.buffer) || 0),
    }));
  } catch (err) { return errorStatus(res, err); }
}));

router.delete('/tournaments/:id', requirePerm('tournaments'), audit('tournaments'), wrap(async (req, res) => {
  tournamentModel.deleteTournament(req.params.id);
  res.json({ ok: true });
}));

// ===== THE DRAW'S PLAYERS =====

router.post('/tournaments/:id/replace', requirePerm('tournaments'), audit('tournaments'), wrap(async (req, res) => {
  const oldId = Number(req.body?.oldPlayerId);
  const newId = Number(req.body?.newPlayerId);
  if (!oldId || !newId) return res.status(400).json({ error: 'Pick the player to bring in.' });
  try {
    tournamentModel.replacePlayer(Number(req.params.id), oldId, newId, { ladderRank: ladderRanks()[newId] ?? null });
    res.json({ ok: true });
  } catch (err) { return errorStatus(res, err); }
}));

router.post('/tournaments/:id/withdraw', requirePerm('tournaments'), audit('tournaments'), wrap(async (req, res) => {
  const playerId = Number(req.body?.playerId);
  if (!playerId) return res.status(400).json({ error: 'A player is required.' });
  try {
    tournamentModel.withdrawPlayer(Number(req.params.id), playerId);
    res.json({ ok: true });
  } catch (err) { return errorStatus(res, err); }
}));

/** Who an email or an invite goes to: the draw once built, the signups before. */
function recipientsOf(t) {
  if (t.status === 'upcoming') {
    return tournamentModel.getSignups(t.id).map((r) => ({ player_id: r.player_id, player_name: r.name, player_email: r.email }));
  }
  return t.players.filter((p) => !p.withdrawn).map((p) => ({ player_id: p.player_id, player_name: p.name, player_email: p.email }));
}

router.post('/tournaments/:id/message', requirePerm('message'), audit('message'), wrap(async (req, res) => {
  const { subject, body, bodyHtml, attachments } = req.body || {};
  if (!subject || !(bodyHtml || body)) return res.status(400).json({ error: 'Subject and body are required' });
  if (!emailConfigured()) return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });
  const t = tournamentModel.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournament not found.' });
  res.json(await messagePlayers(recipientsOf(t), { subject, body, bodyHtml, attachments }));
}));

router.post('/tournaments/:id/bulk-invite', requirePerm('message'), audit('message'), emailLimiter, wrap(async (req, res) => {
  if (!emailConfigured()) return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });
  const t = tournamentModel.getTournament(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournament not found.' });
  res.json(await invitePlayers(req, recipientsOf(t)));
}));

// ===== RESULTS =====

/** The admin entering or correcting any result. */
router.put('/tournament-matches/:id/score', requirePerm('scores'), audit('scores'), wrap(async (req, res) => {
  const p1 = Number(req.body?.p1);
  const p2 = Number(req.body?.p2);
  try {
    res.json(tournamentModel.recordScore(Number(req.params.id), { p1, p2 }));
  } catch (err) { return errorStatus(res, err); }
}));

/** A player entering the result of their own match, once. */
router.put('/tournament-matches/:id/player-score', requireAuth, wrap(async (req, res) => {
  const playerId = Number(req.session.playerId);
  const t = tournamentModel.getTournamentForMatch(Number(req.params.id));
  const m = t?.matches.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Match not found' });
  if (m.player1_id == null || m.player2_id == null) return res.status(409).json({ error: 'Both players need to be known before a score goes in.' });
  if (m.winner_id != null) return res.status(409).json({ error: 'A score has already been reported for this match.' });
  const isP1 = m.player1_id === playerId;
  if (!isP1 && m.player2_id !== playerId) return res.status(403).json({ error: 'You are not a player in this match' });
  // Both shapes are accepted: {p1, p2} from the bracket, {myScore, theirScore}
  // from the report-a-score form.
  const mine = req.body?.myScore != null ? Number(req.body.myScore) : null;
  const theirs = req.body?.theirScore != null ? Number(req.body.theirScore) : null;
  const p1 = mine != null ? (isP1 ? mine : theirs) : Number(req.body?.p1);
  const p2 = mine != null ? (isP1 ? theirs : mine) : Number(req.body?.p2);
  try {
    const result = tournamentModel.recordScore(m.id, { p1, p2 }, { submittedBy: playerId });
    await notify.scoreReported(req, {
      reporterId: playerId, reporterSide: [playerId], otherSide: [isP1 ? m.player2_id : m.player1_id],
      reporterGames: isP1 ? p1 : p2, otherGames: isP1 ? p2 : p1,
    });
    res.json(result);
  } catch (err) { return errorStatus(res, err); }
}));

router.delete('/tournament-matches/:id/score', requirePerm('scores'), audit('scores'), wrap(async (req, res) => {
  tournamentModel.clearScore(Number(req.params.id));
  res.json({ ok: true });
}));

module.exports = router;
