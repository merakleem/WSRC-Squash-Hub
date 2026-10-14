// ===== ANNOUNCED COMPETITIONS =====
// A league or a tournament can be announced before it is built: members sign
// themselves up, and the admin builds it from whoever joined. Both share one
// card on the list page, one page while it is open, and the same confirmations,
// so the two read as the same thing and are fixed in one place. Each caller
// decides the words; this file decides the markup.
import { state } from './state.js';
import { esc, modal, avatarHTML, avatarInner, clubTodayStr } from './utils.js';

export const CAL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
export const PEOPLE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
export const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>';
const ANNOUNCE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M16 9a3 3 0 0 1 0 6"/><path d="M19 6a7 7 0 0 1 0 12"/></svg>';
const BUILD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/></svg>';

// ----- dates -----
const _atNoon = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`) : null);
/** "Mon, Oct 5" */
export const shortDay = (d) => (d ? _atNoon(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '');
/** "Monday, October 5, 2026" */
export const longDay = (d) => (d ? _atNoon(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '');

/** Whole days from the club's today to `date`, negative once it is past. */
export function daysTo(date) {
  return Math.round((_atNoon(date) - _atNoon(clubTodayStr())) / 864e5);
}

// ----- the "new …" choice -----

/**
 * "Announce it for signups" or "Build it now". `announceText` and `buildText`
 * are the lines under each option.
 */
export function openBuildChoice({ title, announceText, buildText, onAnnounce, onBuild }) {
  modal.open(title, `
    <div class="lgl-choice">
      <button class="lgl-choice-row" data-choice="announce">
        <span class="lgl-choice-ic lgl-choice-ic--blue">${ANNOUNCE_ICON}</span>
        <span class="lgl-choice-text">
          <b>Announce it for signups</b>
          <i>${announceText}</i>
        </span>
        <svg class="lgl-choice-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
      </button>
      <button class="lgl-choice-row" data-choice="build">
        <span class="lgl-choice-ic">${BUILD_ICON}</span>
        <span class="lgl-choice-text">
          <b>Build it now</b>
          <i>${buildText}</i>
        </span>
        <svg class="lgl-choice-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>`);
  document.getElementById('modalBody').querySelectorAll('[data-choice]').forEach((b) => {
    b.addEventListener('click', () => {
      modal.close();
      if (b.dataset.choice === 'build') onBuild();
      else onAnnounce();
    });
  });
}

/**
 * A yes/no confirmation in the shared modal. `danger` makes the confirm red.
 * `bodyClass` is the paragraph's class, which differs by page.
 */
export function confirmModal({ title, body, cancel = 'Cancel', confirm, danger = true, bodyClass = 'lgu-confirm', onConfirm }) {
  modal.open(title, `
    <p class="${bodyClass}">${body}</p>
    <div class="form-actions">
      <button class="btn btn-outline" id="cfNo">${cancel}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cfYes">${confirm}</button>
    </div>`);
  document.getElementById('cfNo').addEventListener('click', modal.close);
  document.getElementById('cfYes').addEventListener('click', () => { modal.close(); onConfirm(); });
}

/** "Withdraw from X? Your spot goes back to the club." */
export function confirmWithdraw(name, onConfirm, { bodyClass = 'lgu-confirm' } = {}) {
  confirmModal({
    title: 'Withdraw', body: `Withdraw from ${esc(name)}? Your spot goes back to the club.`,
    cancel: 'Keep my spot', confirm: 'Withdraw', bodyClass, onConfirm,
  });
}

/** The status pill both the card and the page lead with. */
export function signupPill({ i_signed_up: signedUp, full, deadline_passed: closed }) {
  if (signedUp) return ['green', 'Signed up'];
  if (full) return ['grey', 'Full'];
  if (closed) return ['amber', 'Signups closed'];
  return ['blue', 'Signups open'];
}

// ----- the list card -----

/**
 * One announced competition on its list page.
 *
 * `badges` is extra badge HTML before the status pill; `meta` the icon rows;
 * `faces` up to four players; `cap` null for no limit. `action` is the
 * member's button (or note), shown in the footer on a desktop and in the body
 * on a phone; an admin gets `footLeft` / `footRight` instead.
 */
export function upcomingCardHTML(o) {
  const n = o.count || 0;
  const [pillCls, pillText] = signupPill(o);
  const avatars = o.faces?.length
    ? `<span class="lgl-faces">${o.faces.map((f) => avatarHTML(f, 'lgl-face')).join('')}</span>` : '';
  const bar = o.cap == null ? '' : `
    <span class="lgl-sbar"><span class="lgl-sbar-fill${o.full ? ' lgl-sbar-fill--full' : ''}" style="width:${Math.min(100, Math.round((n / o.cap) * 100))}%"></span></span>`;
  return `
    <div class="lgl-card lgl-card--upcoming${o.isNew ? ' um-new' : ''}" data-id="${o.id}">
      <div class="lgl-body">
        <div class="lgl-card-head">
          <h3 class="lgl-name">${o.isNew ? '<span class="um-mark" role="img" aria-label="New"></span>' : ''}${esc(o.name)}</h3>
          <span class="lgl-badges">
            ${o.badges || ''}
            <span class="lgl-status lgl-status--${pillCls}">${pillText}</span>
          </span>
        </div>
        <div class="lgl-meta">${o.meta.map((m) => `
          <span class="lgl-meta-row">${m}</span>`).join('')}
        </div>
        <div class="lgl-signup">
          ${avatars}
          <span class="lgl-signup-line">
            <span class="lgl-signup-n${n ? ' lgl-signup-n--on' : ''}">${o.countText}</span>
            <span class="lgl-signup-when${o.deadline_passed ? ' lgl-signup-when--closed' : ''}">${o.rightText}</span>
          </span>
          ${bar}
        </div>
        ${o.admin ? '' : `<div class="lgl-act-mobile">${o.action}</div>`}
      </div>
      <div class="lgl-foot">${o.admin ? `${o.footLeft}${o.footRight}` : `<span class="lgl-view lgl-view--left">Details ${CHEVRON}</span>${o.action}`}</div>
    </div>`;
}

/** The member's button or note on a card. */
export function cardActionHTML({ i_signed_up: signedUp, full, deadline_passed: closed }, closedNote) {
  if (signedUp) return '<button class="lgl-act lgl-act--out" data-withdraw>Withdraw</button>';
  if (full) return '<span class="lgl-act-note">No spots left</span>';
  if (closed) return `<span class="lgl-act-note">${closedNote}</span>`;
  return '<button class="lgl-act lgl-act--in" data-signup>Sign up</button>';
}

// ----- the page -----

/** The hero: status pill, format pill, name, when, and the description. */
export function lguHeroHTML({ entity, fmt, when }) {
  const [pillCls, pillText] = signupPill(entity);
  return `
    <section class="lgu-hero">
      <span class="lgu-hero-pills">
        <span class="lgu-pill lgu-pill--${pillCls}">${pillText}</span>
        <span class="lgu-pill lgu-pill--fmt">${fmt}</span>
      </span>
      <h2 class="lgu-hero-name">${esc(entity.name)}</h2>
      <p class="lgu-hero-when">${esc(when)}</p>
      ${entity.description ? `<p class="lgu-hero-desc">${esc(entity.description)}</p>` : ''}
    </section>`;
}

/** The facts card: the count, the bar and labelled rows (`rows` are [label, value-html]). */
export function lguFactsHTML({ count, caption, right, cap, done, rows }) {
  const row = ([label, value]) => `<div class="lgu-fact"><span>${label}</span><b>${value}</b></div>`;
  return `
    <section class="lgu-facts">
      <div class="lgu-facts-head"><span class="lgu-label">Signed up</span><span class="lgu-facts-right">${right}</span></div>
      <div class="lgu-facts-n"><b>${count}</b><span>${caption}</span></div>
      ${cap == null ? '' : `<span class="lgu-bar"><span class="lgu-bar-fill${done ? ' lgu-bar-fill--done' : ''}" style="width:${Math.min(100, Math.round((count / cap) * 100))}%"></span></span>`}
      <div class="lgu-facts-rows">
        ${rows.filter(Boolean).map(row).join('\n        ')}
      </div>
    </section>`;
}

/** What a member can do: the "You're signed up" card, Sign up, or nothing. */
export function lguActionHTML({ entity, signedUpSub, fullText }) {
  if (entity.i_signed_up) {
    return `
      <section class="lgu-in">
        <span class="lgu-in-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></span>
        <span class="lgu-in-text"><b>You're signed up</b><i>${signedUpSub}</i></span>
        ${entity.deadline_passed ? '' : '<button class="lgu-out" id="lguWithdraw">Withdraw</button>'}
      </section>`;
  }
  if (entity.full) return `<button class="lgu-join" disabled>${fullText}</button>`;
  if (entity.deadline_passed) return '';
  return '<button class="lgu-join" id="lguSignUp">Sign up</button>';
}

/**
 * The roster. `rows` are already in display order; `rowHTML(row, mine)` draws
 * one. The member's own row comes first. `cols` is the admin's column header
 * row, `sub` an optional line under the heading, `after` anything below the
 * list (the add-member search).
 */
export function lguRosterHTML({ rows, admin, head, sub = '', emptyNote = '', cols = '', after = '', rowHTML }) {
  const me = state.currentUser?.playerId;
  if (!rows.length) {
    return `
      <section class="lgu-roster">
        <div class="lgu-roster-head"><span class="lgu-label">Who's signed up</span></div>
        <div class="lgu-empty">
          <span class="lgu-empty-dots"><i></i><i></i><i></i></span>
          <b>No one has signed up yet</b>
          ${admin && emptyNote ? `<span>${emptyNote}</span>` : ''}
        </div>
        ${after}
      </section>`;
  }
  const sorted = [...rows].sort((a, b) => (a.player_id === me ? -1 : b.player_id === me ? 1 : 0));
  return `
    <section class="lgu-roster">
      <div class="lgu-roster-head"><span class="lgu-label">Who's signed up</span><span class="lgu-roster-n">${head}</span></div>
      ${sub}
      ${admin ? cols : ''}
      <div class="lgu-rows">${sorted.map((r) => rowHTML(r, r.player_id === me)).join('')}</div>
      ${after}
    </section>`;
}

/** A roster row's avatar: "ME" for your own, the photo or initials otherwise. */
export const lguAvatar = (r, mine) => `<span class="lgu-av${mine ? ' lgu-av--me' : ''}">${mine ? 'ME' : avatarInner({ name: r.name, photo_path: r.photo_path })}</span>`;

/** The admin's add-a-member search and export button. */
export function lguAddHTML({ disabled = false } = {}) {
  return `
    <div class="lgu-add">
      <div class="lgu-add-search">
        <input id="lguAdd" placeholder="Add a member by name or number" autocomplete="off"${disabled ? ' disabled' : ''}>
        <div class="lgu-add-drop" id="lguAddDrop" hidden></div>
      </div>
      <button class="btn btn-outline btn-sm" id="lguExport">Export CSV</button>
    </div>`;
}

/**
 * Wire the add-a-member search: the club list minus `exclude`, matched by
 * name or member number. `hitExtra(player)` is the grey text after a name.
 */
export function wireLguAdd({ exclude, hitExtra, onAdd }) {
  const input = document.getElementById('lguAdd');
  const drop = document.getElementById('lguAddDrop');
  if (!input || !drop) return;
  const already = new Set(exclude);
  const close = () => { drop.hidden = true; drop.innerHTML = ''; };
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return close();
    const hits = (state.players || [])
      .filter((p) => !already.has(p.id))
      .filter((p) => p.name.toLowerCase().includes(q) || String(p.member_number || '').toLowerCase().includes(q))
      .slice(0, 6);
    drop.innerHTML = hits.length
      ? hits.map((p) => `<button class="lgu-add-hit" data-add="${p.id}">${esc(p.name)}${hitExtra(p)}</button>`).join('')
      : '<span class="lgu-add-none">No one matches</span>';
    drop.hidden = false;
    drop.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      close();
      input.value = '';
      onAdd(Number(b.dataset.add));
    }));
  };
  if (!state.players?.length) window.api.getPlayers().then((list) => { state.players = list; });
  input.addEventListener('input', paint);
  input.addEventListener('blur', () => setTimeout(close, 120));
}

/** The admin's Building card. */
export function lguBuildHTML({ copy, label, enough, needNote, reopen }) {
  return `
    <section class="lgu-build">
      <span class="lgu-label">Building</span>
      <p>${copy} Signups stay open until you build, or until the deadline passes.</p>
      <button class="lgu-join" id="lguBuild"${enough ? '' : ' disabled'}>${label}</button>
      ${enough ? '' : `<span class="lgu-build-note">${needNote}</span>`}
      ${reopen ? '<button class="btn btn-outline btn-sm lgu-reopen" id="lguReopen">Reopen signups&hellip;</button>' : ''}
    </section>`;
}

/** The banner across the top once signups have closed. */
export function lguBannerHTML({ deadline, detail, label }) {
  return `
    <div class="lgu-banner">
      <span><b>Signups closed ${shortDay(deadline)}.</b> ${esc(detail)}</span>
      <button class="lgu-banner-btn" id="lguBannerBuild">${label}</button>
    </div>`;
}

/** The two-column page. */
export function lguPageHTML({ banner = '', main, side }) {
  return `
    <div class="lgu-page">
      ${banner}
      <div class="lgu-cols">
        <div class="lgu-main">
          ${main}
        </div>
        <div class="lgu-side">
          ${side}
        </div>
      </div>
    </div>`;
}

/** Download a roster as CSV. `rows` are arrays; the first is the header. */
export function exportCSV(name, rows) {
  const csv = rows.map((r) => r.map((v) => {
    const t = v == null ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-signups.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
