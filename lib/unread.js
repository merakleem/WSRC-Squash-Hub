// "Something was posted here that you have not seen."
//
// One row per member per tab in member_tab_opens holds when they last opened
// it; anything created after that stamp is new to them. The stamp and
// created_at are both SQLite's 'YYYY-MM-DD HH:MM:SS' UTC, so the comparison is
// a plain string one and the client can make the same call on a card.
//
// The stamp carries milliseconds and created_at does not, so an item posted in
// the same second as the open compares as older - seen, not unseen - which is
// the right way round for a member who was looking at the page as it landed.
//
// A member with no row is up to date, not "everything is new": sessions are
// month-long cookies, so a deploy gives us no moment to stamp everyone, and a
// member who has been using the app since spring must not be told that every
// league the club has ever run is unread. The first read writes the row.
const { getDB } = require('../database/db');
const { clubToday } = require('./clock');

const TABS = ['leagues', 'events'];

function _stamps(playerId, { write }) {
  const db = getDB();
  const rows = db.prepare('SELECT tab, opened_at FROM member_tab_opens WHERE player_id = ?').all(playerId);
  const out = {};
  for (const r of rows) out[r.tab] = r.opened_at;
  const missing = TABS.filter((t) => !out[t]);
  if (missing.length && write) {
    const ins = db.prepare(`INSERT INTO member_tab_opens (player_id, tab, opened_at) VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
      ON CONFLICT(player_id, tab) DO NOTHING`);
    for (const t of missing) ins.run(playerId, t);
    for (const r of db.prepare('SELECT tab, opened_at FROM member_tab_opens WHERE player_id = ?').all(playerId)) out[r.tab] = r.opened_at;
  }
  return out;
}

// Every league in the list is visible to every member, so a league is new on
// the one rule the handoff asked for: created after the stamp. An announcement
// the admin later builds is the same row, so it is not marked twice.
function _newLeagues(since) {
  return getDB().prepare('SELECT COUNT(*) AS n FROM leagues WHERE created_at > ?').get(since).n > 0;
}

// Only what the Events page opens on - the upcoming list - counts, so the dot
// always points at something the member can see when they arrive. A
// members-only event does not exist for a non-member here either.
function _newEvents(playerId, since) {
  const db = getDB();
  const seesMembersOnly = !!db.prepare('SELECT is_member FROM players WHERE id = ?').get(playerId)?.is_member;
  return db.prepare(`
    SELECT COUNT(*) AS n FROM events
    WHERE created_at > ? AND event_date >= ? AND (members_only = 0 OR ?)
  `).get(since, clubToday(), seesMembersOnly ? 1 : 0).n > 0;
}

// { unread: { leagues, events }, opened: { leagues, events } } for a member,
// or nulls for anyone else. An admin posted the things, so they never carry a
// marker.
//
// Viewing as a member seeds their baseline like any other read - a member with
// no row is up to date whenever it is first read, so fixing that point sooner
// only means more of what is posted afterwards reaches them. Withholding it
// left members the admin had looked at with no row at all, which is a state in
// which no marker can ever appear. What a viewing-as session must not do is
// *spend* a marker (openTab): that would clear a dot the member never saw.
function unreadFor(session) {
  const blank = { unread: { leagues: false, events: false }, opened: {} };
  if (!session || session.role !== 'player' || !session.playerId) return blank;
  const opened = _stamps(session.playerId, { write: true });
  return {
    unread: {
      leagues: !!opened.leagues && _newLeagues(opened.leagues),
      events: !!opened.events && _newEvents(session.playerId, opened.events),
    },
    opened,
  };
}

// The member opened the tab: stamp now and hand back the stamp it replaced, so
// the list that is about to paint can mark what the dot pointed at.
function openTab(session, tab) {
  if (!TABS.includes(tab)) return null;
  const previous = _stamps(session.playerId, { write: false })[tab] || null;
  if (!session.viewingAs) {
    getDB().prepare(`INSERT INTO member_tab_opens (player_id, tab, opened_at) VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
      ON CONFLICT(player_id, tab) DO UPDATE SET opened_at = excluded.opened_at`).run(session.playerId, tab);
  }
  return { previous, opened_at: getDB().prepare('SELECT opened_at FROM member_tab_opens WHERE player_id = ? AND tab = ?').get(session.playerId, tab)?.opened_at || previous };
}

module.exports = { unreadFor, openTab, TABS };
