const express = require('express');
const eventModel = require('../models/eventModel');
const { wrap, requireAdmin, requireAuth } = require('../middleware');
const { clubToday } = require('../lib/clock');

const router = express.Router();

// The list, shaped for the cards: aggregates, the viewer's signup, the link
// and a three-face preview all come from the model in one place.
router.get('/events', requireAuth, wrap(async (req, res) => {
  const scope = req.query.scope === 'past' ? 'past' : 'upcoming';
  res.json(eventModel.listEvents({ scope, today: clubToday(), viewerId: req.session.playerId, isAdmin: req.session.role === 'admin' }));
}));

// The linkables search sits above /events/:id so "linkables" is never read as an id.
router.get('/events/linkables', requireAdmin, wrap(async (req, res) => {
  res.json(eventModel.searchLinkables(req.query.q || ''));
}));

router.get('/events/:id/export.csv', requireAdmin, wrap(async (req, res) => {
  const { event, rows } = eventModel.exportRows(Number(req.params.id));
  const csvField = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    ['Name', 'Member number', 'Guests', 'Signed up at'].join(','),
    ...rows.map((r) => [r.name, r.member_number || '', r.guests, r.created_at].map(csvField).join(',')),
  ];
  const safeName = event.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-attendees.csv"`);
  res.send(lines.join('\n') + '\n');
}));

router.get('/events/:id', requireAuth, wrap(async (req, res) => {
  const event = eventModel.getEvent(Number(req.params.id), {
    viewerId: req.session.playerId,
    isAdmin: req.session.role === 'admin',
  });
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  res.json(event);
}));

router.post('/events', requireAdmin, wrap(async (req, res) => {
  res.json(eventModel.createEvent(req.body || {}));
}));

router.put('/events/:id', requireAdmin, wrap(async (req, res) => {
  res.json(eventModel.updateEvent(Number(req.params.id), req.body || {}));
}));

router.delete('/events/:id', requireAdmin, wrap(async (req, res) => {
  eventModel.deleteEvent(Number(req.params.id));
  res.json({ ok: true });
}));

router.post('/events/:id/signup', requireAuth, wrap(async (req, res) => {
  if (req.session.playerId == null) return res.status(403).json({ error: 'Only members can sign up.' });
  eventModel.signUp(Number(req.params.id), req.session.playerId, req.body?.guests, clubToday());
  res.json({ ok: true });
}));

router.put('/events/:id/signup', requireAuth, wrap(async (req, res) => {
  if (req.session.playerId == null) return res.status(403).json({ error: 'Only members can sign up.' });
  eventModel.updateSignup(Number(req.params.id), req.session.playerId, req.body?.guests, clubToday());
  res.json({ ok: true });
}));

router.delete('/events/:id/signup', requireAuth, wrap(async (req, res) => {
  if (req.session.playerId == null) return res.status(403).json({ error: 'Only members can sign up.' });
  eventModel.withdraw(Number(req.params.id), req.session.playerId);
  res.json({ ok: true });
}));

// The admin adds a member. Mirrors POST /leagues/:id/signups, and leans on the
// same model write the member's own signup uses, so the cap and the
// members-only rule cannot drift apart between the two ways onto a list.
router.post('/events/:id/signups', requireAdmin, wrap(async (req, res) => {
  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(playerId)) return res.status(400).json({ error: 'A player is required.' });
  try {
    res.json(eventModel.addAttendee(Number(req.params.id), playerId, clubToday()));
  } catch (err) {
    // The only 409 an admin can still meet is the cap - they are allowed past
    // the date, not past the limit - and they are not the one being apologised
    // to for it.
    if (err.status === 409) throw Object.assign(new Error('This event just filled up.'), { status: 409 });
    throw err;
  }
}));

router.delete('/events/:id/signups/:playerId', requireAdmin, wrap(async (req, res) => {
  eventModel.removeAttendee(Number(req.params.id), Number(req.params.playerId));
  res.json({ ok: true });
}));

module.exports = router;
