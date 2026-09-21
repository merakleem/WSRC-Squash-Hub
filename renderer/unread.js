// Unread markers for Leagues and Events.
//
// A dot on the nav item says only "something is posted here you have not
// seen"; the marked cards do the pointing once the member arrives. Opening the
// tab is the whole interaction - there is nothing to dismiss.
//
// The visit renders its list against the stamp it *replaced*, so the cards can
// be marked, and stamps the new one on the way in. The nav dot then holds for
// a beat so the eye can land on it before it goes.
import { state } from './state.js';

const TABS = ['leagues', 'events'];
const HOLD_MS = 600;
const FADE_MS = 240;

// The tab being visited and the stamp its cards are marked against. Cleared on
// navigation, which is what makes the card markers last exactly one visit.
let _visit = null;

const _reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const _unread = () => state.currentUser?.unread || {};
const _isPlayer = () => state.currentUser?.role === 'player';

function _dotHTML() {
  const el = document.createElement('span');
  el.className = 'um-dot';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'New');
  return el;
}

// Paints the nav items and the hamburger from what the shell currently knows.
// Called at boot; the clearing beat takes the dots off itself so it can animate.
export function paintNav() {
  const unread = _unread();
  for (const tab of TABS) {
    const item = document.querySelector(`.nav-item[data-page="${tab}"]`);
    if (!item) continue;
    const has = !!item.querySelector('.um-dot');
    if (unread[tab] && !has) item.appendChild(_dotHTML());
    if (!unread[tab] && has) item.querySelector('.um-dot').remove();
  }
  _paintHamburger();
}

function _paintHamburger() {
  const btn = document.getElementById('hamburgerBtn');
  if (!btn) return;
  const any = TABS.some((t) => _unread()[t]);
  const has = !!btn.querySelector('.um-dot');
  if (any && !has) btn.appendChild(_dotHTML());
  if (!any && has) btn.querySelector('.um-dot').remove();
  btn.setAttribute('aria-label', any ? 'Menu, something new' : 'Menu');
}

// The member is on their way to a list page. Records what this visit marks its
// cards against; nothing is spent until the list actually paints.
export function beginVisit(page) {
  if (!TABS.includes(page) || !_isPlayer()) { _visit = null; return; }
  const since = _unread()[page] ? (state.currentUser?.opened?.[page] || null) : null;
  _visit = { tab: page, since, painted: false };
}

// Is this league or event one the member has not seen? Only ever true during
// the visit that clears the tab, and only for items posted since its last one.
export function isNew(tab, createdAt) {
  return !!(_visit && _visit.tab === tab && _visit.since && createdAt && createdAt > _visit.since);
}

// The list has painted. Hold the nav dot for a beat, then fade it out - the
// cards keep their markers until the member leaves the page.
export function visitPainted(tab) {
  if (!_visit || _visit.tab !== tab || _visit.painted || !_visit.since) return;
  _visit.painted = true;
  if (state.currentUser?.unread) state.currentUser.unread[tab] = false;
  // The member has seen the list, so the tab is theirs as of now. A visit that
  // never painted - the list failed to load - leaves the marker alone.
  window.api.markTabOpened(tab)
    .then((r) => {
      if (state.currentUser?.opened) state.currentUser.opened[tab] = r.opened_at || r.previous;
    })
    .catch(() => {});
  setTimeout(() => {
    const dot = document.querySelector(`.nav-item[data-page="${tab}"] .um-dot`);
    _fadeOut(dot);
    // The hamburger speaks for every tab at once, so it only goes when the
    // last unseen one has been opened.
    if (!TABS.some((t) => _unread()[t])) {
      const btn = document.getElementById('hamburgerBtn');
      btn?.setAttribute('aria-label', 'Menu');
      _fadeOut(btn?.querySelector('.um-dot'));
    }
  }, HOLD_MS);
}

function _fadeOut(dot) {
  if (!dot) return;
  if (_reduced()) { dot.remove(); return; }
  dot.addEventListener('transitionend', () => dot.remove(), { once: true });
  dot.classList.add('um-dot--out');
  // A dot inside a drawer that is closed never transitions, so it would stay
  // in the DOM waiting for an event that does not come.
  setTimeout(() => dot.remove(), FADE_MS + 60);
}

export const _test = { TABS, HOLD_MS, FADE_MS };
