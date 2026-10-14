import { state, can } from '../state.js';
import { esc, toast, modal, avatarHTML, avatarInner } from '../utils.js';
import * as K from '../knockout.js';
import {
  CAL_ICON, PEOPLE_ICON, CHEVRON, openBuildChoice, confirmModal, confirmWithdraw, upcomingCardHTML, cardActionHTML,
  daysTo, lguHeroHTML, lguFactsHTML, lguActionHTML, lguRosterHTML, lguAvatar, lguAddHTML, wireLguAdd,
  lguBuildHTML, lguBannerHTML, lguPageHTML, exportCSV,
} from '../upcoming.js';
import { heroHTML, progressHTML, optionsMenuHTML, wireOptionsMenu } from '../competitionPage.js';
import { openMessagePlayersModal, openBulkInviteModal } from '../playerMail.js';
import { bracketTreeHTML, wireBracketTree } from '../bracketTree.js';
import { startCreateTournament, startEditSchedule } from './createTournament.js';
import { openMatchCard } from '../matchCard.js';
import { isNew, visitPainted } from '../unread.js';

// ===== KNOCKOUT TOURNAMENTS =====
// The list, an announced tournament's page, and a built tournament's page with
// its Bracket and Entrants tabs. Announcing and signing up are the league
// flow's own pieces (upcoming.js); the bracket is bracketTree.js; the draw's
// arithmetic is knockout.js, shared with the server.

const _phone = () => window.matchMedia('(max-width: 768px)').matches;
const _plural = (n, word) => `${n} ${word}${n === 1 ? '' : word.endsWith('ch') ? 'es' : 's'}`;
const _courtList = (courts) => courts.map((c) => String(c.name).replace(/^Court\s*/i, '')).join(', ');

// ----- the list -----

let _list = [];

export async function renderTournaments() {
  const admin = can('tournaments');
  document.getElementById('pageTitle').textContent = 'Tournaments';
  document.getElementById('topbarActions').innerHTML = admin ? `
    <button class="btn btn-primary" id="btnNewTournament">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
      <span class="lgl-new-long">New Tournament</span><span class="lgl-new-short">New</span>
    </button>` : '';
  document.getElementById('btnNewTournament')?.addEventListener('click', openNewTournamentChoice);

  const content = document.getElementById('mainContent');
  _list = await window.api.getTournaments();
  if (!_list.length) {
    content.innerHTML = `
      <div class="table-card"><div class="empty-state">
        <strong>No tournaments yet</strong>
        <p>${admin ? 'Announce one for signups or build it now with New Tournament.' : 'No tournaments have been announced yet.'}</p>
      </div></div>`;
    visitPainted('tournaments');
    return;
  }
  content.innerHTML = `<div class="lgl-page"><div class="lgl-groups" id="koGroups">${_groupsHTML()}</div></div>`;
  _wireCards();
  visitPainted('tournaments');
}

function _groupsHTML() {
  const groups = [
    ['Open for signups', _list.filter((t) => t.status === 'upcoming'), _upcomingCard],
    ['In progress', _list.filter((t) => t.status === 'active'), _activeCard],
    ['Completed', _list.filter((t) => t.status === 'completed'), _doneCard],
  ].filter(([, items]) => items.length);
  return groups.map(([label, items, card]) => `
    <section class="lgl-group">
      <div class="lgl-group-head">
        <span class="lgl-group-label">${label}</span>
        <span class="lgl-group-count">${items.length}</span>
        <span class="lgl-group-rule"></span>
      </div>
      <div class="lgl-grid">${items.map(card).join('')}</div>
    </section>`).join('');
}

const _fmtBadge = '<span class="lgl-fmt">Knockout</span>';

function _upcomingCard(t) {
  const admin = can('tournaments');
  const n = t.signup_count || 0;
  const cap = t.draw_cap;
  return upcomingCardHTML({
    ...t,
    admin,
    count: n,
    cap,
    isNew: isNew('tournaments', t.created_at),
    badges: _fmtBadge,
    meta: [`${CAL_ICON}First round ${K.fmtDate(t.first_round_date)}`, `${PEOPLE_ICON}${cap}-draw · single elimination · best of five`],
    faces: t.signup_preview || [],
    countText: n === 0 ? 'No one signed up yet' : `${n} of ${cap} signed up`,
    rightText: t.deadline_passed ? 'Signups closed' : t.signup_deadline ? `Sign up by ${K.fmtDate(t.signup_deadline)}` : 'No deadline',
    action: cardActionHTML(t, 'Draw coming soon'),
    footLeft: t.deadline_passed || t.full
      ? '<span class="lgl-chip lgl-chip--amber">Ready to build</span>'
      : `<span class="lgl-weeks">Announced ${K.fmtMD(t.created_at)}</span>`,
    footRight: `<span class="lgl-view">Build tournament ${CHEVRON}</span>`,
  });
}

function _stripHTML(kind, av, label, line) {
  return `
    <div class="ko-strip${kind ? ` ko-strip--${kind}` : ''}">
      <span class="ko-strip-av">${esc(av)}</span>
      <span class="ko-strip-text"><span class="ko-strip-label">${label}</span><span class="ko-strip-line">${esc(line)}</span></span>
    </div>`;
}

function _builtCard(t, { done, badge, meta, strip, footLeft }) {
  const fresh = isNew('tournaments', t.created_at);
  return `
    <div class="lgl-card${done ? ' lgl-card--done' : ''}${fresh ? ' um-new' : ''}" data-id="${t.id}">
      <div class="lgl-body">
        <div class="lgl-card-head">
          <h3 class="lgl-name">${fresh ? '<span class="um-mark" role="img" aria-label="New"></span>' : ''}${esc(t.name)}</h3>
          <span class="lgl-badges">${_fmtBadge}${badge}</span>
        </div>
        <div class="lgl-meta">
          <span class="lgl-meta-row">${CAL_ICON}${meta[0]}</span>
          <span class="lgl-meta-row">${PEOPLE_ICON}${meta[1]}</span>
        </div>
        ${strip}
      </div>
      <div class="lgl-foot"><span class="lgl-weeks">${footLeft}</span><span class="lgl-view">Bracket ${CHEVRON}</span></div>
    </div>`;
}

function _activeCard(t) {
  const round = K.ROUND_NAMES[t.current_round] || '';
  let strip;
  if (t.my_next) {
    const n = t.my_next;
    const line = [`${n.label} · vs ${n.opponent}`, n.date ? K.fmtDate(n.date) : '', n.time ? K.fmtTime(K.toMin(n.time)) : '', n.court || ''].filter(Boolean).join(' · ');
    strip = _stripHTML('next', /^winner of/.test(n.opponent) ? '?' : K.initials(n.opponent), 'Your next match', line);
  } else if (t.my_out) {
    strip = _stripHTML('', K.initials(t.my_out.winner), "You're out", `Lost ${t.my_out.label} to ${t.my_out.winner}${t.my_out.sub && t.my_out.sub !== 'Walkover' ? ` ${t.my_out.sub.split(' v ')[0]}` : ''}`);
  } else {
    strip = _stripHTML('', K.ROUND_ABBR[t.current_round] || '', 'Up next', `${_plural(t.left_in_round, 'match')} still to play · ${K.fmtDate(t.current_round_date)}`);
  }
  return _builtCard(t, {
    done: false,
    badge: `<span class="lgl-status lgl-status--blue">${round}</span>`,
    meta: [`${round} · ${K.fmtDate(t.current_round_date)}`, `${t.draw_size}-draw · ${_plural(t.entrant_count, 'player')}`],
    strip,
    footLeft: `${t.played} of ${t.total} matches played`,
  });
}

function _doneCard(t) {
  const c = t.champion;
  return _builtCard(t, {
    done: true,
    badge: '<span class="lgl-status lgl-status--grey">Completed</span>',
    meta: [`${K.fmtMD(t.first_round_date)} – ${K.fmtMD(t.final_date)}`, `${t.draw_size}-draw · ${_plural(t.entrant_count, 'player')}`],
    strip: c ? _stripHTML('champ', K.initials(c.name), 'Champion', `${c.name}${t.runner_up ? ` · def. ${t.runner_up.name}${t.final_score ? ` ${t.final_score}` : ''}` : ''}`) : '',
    footLeft: `Final played ${K.fmtMD(t.final_date)}`,
  });
}

function _wireCards() {
  const holder = document.getElementById('koGroups');
  holder.querySelectorAll('.lgl-card[data-id]').forEach((card) => {
    card.addEventListener('click', () => window.navigate('tournamentDetail', { tournamentId: Number(card.dataset.id) }));
  });
  holder.querySelectorAll('[data-signup], [data-withdraw]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = _list.find((x) => x.id === Number(btn.closest('.lgl-card').dataset.id));
      if (btn.hasAttribute('data-signup')) _signUp(t, _reloadCards);
      else _withdraw(t, _reloadCards);
    });
  });
}

async function _reloadCards() {
  _list = await window.api.getTournaments();
  const holder = document.getElementById('koGroups');
  if (!holder) return;
  holder.innerHTML = _groupsHTML();
  _wireCards();
}

async function _signUp(t, then) {
  try {
    await window.api.signUpForTournament(t.id);
    await then();
    toast(`Signed up for ${t.name}`, 'success');
  } catch (e) { toast(e.message || 'Could not sign up.', 'error'); }
}

function _withdraw(t, then) {
  confirmWithdraw(t.name, async () => {
    try {
      await window.api.withdrawFromTournament(t.id);
      await then();
      toast('Withdrawn', 'success');
    } catch (e) { toast(e.message || 'Could not withdraw.', 'error'); }
  });
}

// ----- announcing -----

export function openNewTournamentChoice() {
  openBuildChoice({
    title: 'New tournament',
    announceText: 'Members sign up themselves. You seed the draw and set the rounds later, from whoever joined.',
    buildText: 'Pick the players yourself, then seed, schedule and preview the bracket in four steps.',
    onAnnounce: () => openTournamentAnnounceModal(),
    onBuild: () => startCreateTournament(),
  });
}

function _nextSaturday() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const DRAW_HELP = {
  8: 'Quarterfinals, semifinals and a final. Signups close at 8.',
  16: 'A round of 16, then quarterfinals, semifinals and a final. Signups close at 16.',
};

/** The announcement form, for a new tournament or an edit of one. */
export function openTournamentAnnounceModal(t = null) {
  const editing = !!t;
  const f = { draw: t?.draw_cap || 16 };
  modal.open(editing ? 'Edit announcement' : 'Announce a tournament', `
    <div class="lgl-form">
      <label class="lgl-field"><span>Tournament name</span>
        <input id="anName" value="${esc(t?.name || '')}" placeholder="October C/D Knockout" autocomplete="off">
      </label>
      <div class="lgl-field"><span>Draw size</span>
        <div class="lgl-seg" id="anDraw" role="radiogroup" aria-label="Draw size">
          <button type="button" class="lgl-seg-b" data-draw="8">8 players</button>
          <button type="button" class="lgl-seg-b" data-draw="16">16 players</button>
        </div>
        <span class="lgl-help" id="anDrawHelp"></span>
      </div>
      <div class="lgl-row2">
        <label class="lgl-field"><span>First round <i>tentative</i></span>
          <input id="anStart" type="date" value="${esc(t?.first_round_date || _nextSaturday())}">
        </label>
        <label class="lgl-field"><span>Sign up by <i>optional</i></span>
          <input id="anDeadline" type="date" value="${esc(t?.signup_deadline || '')}">
        </label>
      </div>
      <label class="lgl-field"><span>Description <i>optional</i></span>
        <textarea id="anDesc" rows="3" placeholder="Who it's for, how the rounds run, anything else worth knowing.">${esc(t?.description || '')}</textarea>
      </label>
      <div class="lgl-form-err" id="anErr"></div>
      <div class="lgl-form-foot">
        <span class="lgl-help">${editing ? '' : 'Listed under Open for signups as soon as you announce it.'}</span>
        <button class="btn btn-outline" id="anCancel">Cancel</button>
        <button class="btn btn-primary" id="anSave">${editing ? 'Save changes' : 'Announce tournament'}</button>
      </div>
    </div>`);
  const paint = () => {
    document.querySelectorAll('#anDraw [data-draw]').forEach((b) => b.classList.toggle('lgl-seg-b--on', Number(b.dataset.draw) === f.draw));
    document.getElementById('anDrawHelp').textContent = DRAW_HELP[f.draw];
  };
  paint();
  document.getElementById('anDraw').addEventListener('click', (e) => {
    const b = e.target.closest('[data-draw]');
    if (b) { f.draw = Number(b.dataset.draw); paint(); }
  });
  document.getElementById('anCancel').addEventListener('click', modal.close);
  document.getElementById('anSave').addEventListener('click', async () => {
    const err = document.getElementById('anErr');
    const body = {
      name: document.getElementById('anName').value.trim(),
      drawCap: f.draw,
      firstRoundDate: document.getElementById('anStart').value,
      signupDeadline: document.getElementById('anDeadline').value || null,
      description: document.getElementById('anDesc').value.trim(),
    };
    if (!body.name) { err.textContent = 'Tournament name is required.'; return; }
    err.textContent = '';
    const btn = document.getElementById('anSave');
    btn.disabled = true;
    try {
      if (editing) {
        await window.api.editTournamentAnnouncement(t.id, body);
        modal.close();
        toast('Announcement updated', 'success');
        window.navigate('tournamentDetail', { tournamentId: t.id });
      } else {
        const { id } = await window.api.announceTournament(body);
        modal.close();
        toast(`${body.name} announced`, 'success');
        window.navigate('tournamentDetail', { tournamentId: id });
      }
    } catch (e) {
      err.textContent = e.message || 'Could not save.';
      btn.disabled = false;
    }
  });
}

// ----- a tournament's page -----

let _t = null;       // the tournament as the API sent it
let _b = null;       // its bracket, once built
let _tab = 'bracket';
let _tabFor = null;

export async function renderTournamentDetail() {
  const id = state.currentTournamentId;
  if (id == null) { window.navigate('tournaments'); return; }
  try {
    _t = await window.api.getTournament(id);
  } catch (_) {
    window.navigate('tournaments');
    return;
  }
  if (_tabFor !== id) { _tabFor = id; _tab = 'bracket'; }
  if (_t.status === 'upcoming') _renderUpcoming(_t);
  else _renderBuilt(_t);
}

const _reload = () => renderTournamentDetail();

// ----- announced -----

function _ranks() {
  return Object.fromEntries((state.ladder || []).map((r, i) => [r.id, r.position ?? i + 1]));
}

function _renderUpcoming(t) {
  const admin = can('tournaments');
  const n = t.signup_count || 0;
  const cap = t.draw_cap;
  const closed = !!t.deadline_passed;
  const draw = K.drawFor(n, cap);
  const byes = K.byesFor(draw, n);
  const left = cap - n;
  document.getElementById('pageTitle').textContent = t.name;
  document.getElementById('topbarActions').innerHTML = admin ? `
    <button class="btn btn-outline" id="lguEdit">Edit announcement</button>
    <button class="btn btn-primary" id="lguBuildTop"${n >= K.MIN_ENTRANTS ? '' : ' disabled'}>Build this tournament</button>` : '';

  const when = `First round ${K.fmtLongY(t.first_round_date)} · ${closed ? `signups closed ${K.fmtDate(t.signup_deadline)}`
    : t.signup_deadline ? `sign up by ${K.fmtDate(t.signup_deadline)}` : 'no deadline'}`;
  const rankCell = (r) => (r.rank ? `#${r.rank}` : 'Unranked');
  const roster = lguRosterHTML({
    rows: t.signups || [],
    admin,
    head: admin ? `${n} of ${cap}` : `${_plural(n, 'player')}${!t.full ? ` · ${_plural(left, 'spot')} left` : ''}`,
    sub: '<p class="ko-roster-sub">Listed by ladder rank, which is roughly how the draw will be seeded. Unranked players seed last.</p>',
    emptyNote: 'Members see it on the Tournaments page. You can add people yourself below.',
    cols: '<div class="lgu-row lgu-row--cols"><span></span><span>Member</span><span>No.</span><span>Ladder</span><span>Signed up</span><span></span></div>',
    after: admin ? `${lguAddHTML({ disabled: t.full })}${t.full ? `<p class="lgu-full-note">The draw is full at ${cap}. Remove someone to add another player.</p>` : ''}` : '',
    rowHTML: (r, mine) => (admin
      ? `<div class="lgu-row lgu-row--admin" data-player="${r.player_id}">${lguAvatar(r, false)}
          <span class="lgu-row-name">${esc(r.name)}</span>
          <span class="lgu-row-num">${r.member_number ? esc(r.member_number) : '—'}</span>
          <span class="lgu-row-rating ko-rank${r.rank ? '' : ' ko-rank--none'}">${rankCell(r)}</span>
          <span class="lgu-row-when">${K.fmtMD(r.signed_up_at)}</span>
          <button class="lgu-row-x" data-remove="${r.player_id}" aria-label="Remove ${esc(r.name)}">&#10005;</button>
        </div>`
      : `<div class="lgu-row ko-lgu-row${mine ? ' lgu-row--me' : ''}">${lguAvatar(r, mine)}
          <span class="lgu-row-name">${mine ? 'You' : esc(r.name)}</span>
          <span class="ko-rank ko-desk${r.rank ? '' : ' ko-rank--none'}">${rankCell(r)}</span>
          <span class="lgu-row-when${mine ? ' lgu-row-when--me' : ''}">Signed up ${K.fmtMD(r.signed_up_at)}</span>
        </div>`),
  });

  const dl = t.signup_deadline;
  const dlLeft = dl && !closed ? daysTo(dl) : null;
  const facts = lguFactsHTML({
    count: n,
    caption: t.i_signed_up ? 'players, including you' : n === 1 ? 'player' : 'players',
    right: closed ? '<span class="lgu-facts-closed">Closed</span>' : t.full ? 'Full' : `${_plural(left, 'spot')} left of ${cap}`,
    cap,
    done: t.full || closed,
    rows: [
      ['First round', K.fmtDate(t.first_round_date)],
      ['Draw', `${cap} players · single elimination`],
      dl ? [closed ? 'Signups closed' : 'Sign up by', `${K.fmtDate(dl)}${dlLeft != null && dlLeft <= 14 ? ` · ${_plural(dlLeft, 'day')} left` : ''}`] : ['Sign up by', 'No deadline'],
      ['Spots left', t.full ? `None · ${cap} of ${cap}` : `${left} of ${cap}`],
      admin ? ['Announced', K.fmtMD(t.created_at)] : null,
    ],
  });

  const side = admin
    ? `${lguBuildHTML({
      copy: `Opens the wizard with all ${n} entrants seeded by ladder rank. ${n} players make a ${draw}-draw${byes ? ` with ${_plural(byes, 'bye')}` : ''}.`,
      label: 'Build this tournament',
      enough: n >= K.MIN_ENTRANTS,
      needNote: `Needs ${K.MIN_ENTRANTS - n} more player${K.MIN_ENTRANTS - n === 1 ? '' : 's'} for an 8-draw`,
      reopen: closed,
    })}
      <button class="lgu-cancel" id="lguCancel">Cancel this tournament&hellip;</button>`
    : lguActionHTML({
      entity: t,
      signedUpSub: closed ? 'Signups have closed — the draw is coming soon.' : "We'll tell you your seed and first match when the draw is built.",
      fullText: 'Draw is full',
    });

  document.getElementById('mainContent').innerHTML = lguPageHTML({
    banner: admin && closed ? lguBannerHTML({
      deadline: dl,
      detail: `${n} players signed up — that's a ${draw}-draw with ${_plural(byes, 'bye')} for the top seeds. Build the tournament to seed the draw.`,
      label: 'Build this tournament',
    }) : '',
    main: `${lguHeroHTML({ entity: t, fmt: `Knockout · ${cap}-draw`, when })}${roster}`,
    side: `${facts}${side}`,
  });

  document.getElementById('lguSignUp')?.addEventListener('click', () => _signUp(t, _reload));
  document.getElementById('lguWithdraw')?.addEventListener('click', () => _withdraw(t, _reload));
  if (!admin) return;

  document.getElementById('lguEdit').addEventListener('click', () => openTournamentAnnounceModal(t));
  document.getElementById('lguReopen')?.addEventListener('click', () => openTournamentAnnounceModal(t));
  const build = () => startCreateTournament({ fromUpcoming: t });
  ['lguBuild', 'lguBuildTop', 'lguBannerBuild'].forEach((id) => document.getElementById(id)?.addEventListener('click', build));
  document.getElementById('lguExport')?.addEventListener('click', () => exportCSV(t.name, [
    ['Name', 'Member number', 'Ladder rank', 'Signed up'],
    ...(t.signups || []).map((r) => [r.name, r.member_number || '', r.rank ?? '', String(r.signed_up_at || '').slice(0, 10)]),
  ]));
  document.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
    const who = (t.signups || []).find((r) => r.player_id === Number(btn.dataset.remove));
    confirmModal({
      title: 'Remove', body: `Remove ${esc(who?.name || 'this player')} from ${esc(t.name)}?`, confirm: 'Remove',
      onConfirm: async () => {
        await window.api.removeTournamentSignup(t.id, who.player_id);
        await _reload();
        toast(`${who.name} removed`, 'success');
      },
    });
  }));
  document.getElementById('lguCancel').addEventListener('click', () => confirmModal({
    title: 'Cancel tournament',
    body: `Cancel ${esc(t.name)}? The announcement is removed and everyone signed up comes off the list.`,
    cancel: 'Keep it', confirm: 'Cancel tournament',
    onConfirm: async () => {
      await window.api.deleteTournament(t.id);
      toast(`${t.name} cancelled`, 'success');
      window.navigate('tournaments');
    },
  }));
  if (!state.ladder.length) window.api.getLadder().then((l) => { state.ladder = l; }).catch(() => {});
  wireLguAdd({
    exclude: (t.signups || []).map((r) => r.player_id),
    hitExtra: (p) => {
      const rank = _ranks()[p.id];
      return `<i>${p.member_number ? `#${esc(p.member_number)} · ` : ''}${rank ? `#${rank}` : 'Unranked'}</i>`;
    },
    onAdd: async (pid) => {
      try {
        const r = await window.api.addTournamentSignup(t.id, pid);
        await _reload();
        const who = state.players.find((p) => p.id === pid);
        toast(r?.full ? 'That fills the draw' : `${who?.name || 'Player'} added`, 'success');
      } catch (e) { toast(e.message || 'Could not add them.', 'error'); }
    },
  });
}

// ----- built -----

function _bracketOf(t) {
  const entrants = t.players.map((p) => ({ id: p.player_id, name: p.name, photo_path: p.photo_path || null, rank: p.ladder_rank ?? null, withdrawn: !!p.withdrawn }));
  return K.buildBracket({ draw: t.draw_size, entrants, rounds: t.rounds.map((r) => ({ date: r.date, time: K.toMin(r.time) })), rows: t.matches });
}

function _renderBuilt(t) {
  const admin = can('tournaments');
  const b = _b = _bracketOf(t);
  const me = b.pById[state.currentUser?.playerId] || null;
  document.getElementById('pageTitle').textContent = t.name;
  document.getElementById('topbarActions').innerHTML = optionsMenuHTML([
    can('message') ? { action: 'message', label: 'Message players' } : null,
    can('message') && can('players') ? { action: 'invite', label: 'Send account invites' } : null,
    admin && t.status !== 'completed' ? { action: 'schedule', label: 'Edit schedule' } : null,
    admin ? { action: 'delete', label: 'Delete tournament', danger: true } : null,
  ], { label: 'Tournament options' });
  wireOptionsMenu((action) => _onOption(action, t));

  const roundName = K.ROUND_NAMES[K.ROUND_KEYS[b.draw][b.cur]];
  const first = t.rounds[0]?.date;
  const last = b.final.date;
  const dates = `${K.fmtMD(first)} – ${K.fmtMD(last)}`;
  const status = b.stage === 'notStarted' ? 'Not started' : b.stage === 'done' ? 'Completed' : roundName;
  let right;
  if (b.stage === 'done') {
    const loser = K.loserOf(b.final);
    const score = b.final.score ? (b.final.winner === b.final.p1 ? `${b.final.score.p1}–${b.final.score.p2}` : `${b.final.score.p2}–${b.final.score.p1}`) : '';
    right = `
      <div class="ko-champion">
        <span class="ko-champion-av">${esc(K.initials(b.champion.name))}</span>
        <span class="ko-champion-text">
          <span class="ko-champion-label">Champion</span>
          <span class="ko-champion-name">${esc(b.champion.name)}</span>
          <span class="ko-champion-sub">${loser ? `def. ${esc(loser.name)}${score ? ` ${score}` : ''} in the final` : 'Won the final'}</span>
        </span>
      </div>`;
  } else {
    right = progressHTML({
      label: b.stage === 'notStarted' ? `Starts ${K.fmtDate(first)}` : roundName,
      dates,
      segs: b.rounds.map((_, r) => (r < b.cur ? 'done' : r === b.cur && b.stage !== 'notStarted' ? 'now' : '')),
    });
  }
  const hero = heroHTML({
    name: t.name,
    status: status.toUpperCase(),
    statusCls: b.stage === 'done' ? 'ko-status--done' : '',
    meta: `${b.draw}-draw · ${_plural(b.ent, 'entrant')}${b.byes ? ` · ${_plural(b.byes, 'bye')}` : ''} · ${dates} · Court${t.courts.length === 1 ? '' : 's'} ${esc(_courtList(t.courts))}`,
    right,
  });

  document.getElementById('mainContent').innerHTML = `
    <div class="lg-page ko-page">
      ${hero}
      <div class="lg-tabbar">
        <div class="lg-tabs" id="koTabs" role="tablist" aria-label="Tournament sections">
          <button class="lg-tab${_tab === 'bracket' ? ' active' : ''}" role="tab" aria-selected="${_tab === 'bracket'}" data-ko-tab="bracket">Bracket</button>
          <button class="lg-tab${_tab === 'entrants' ? ' active' : ''}" role="tab" aria-selected="${_tab === 'entrants'}" data-ko-tab="entrants">Entrants</button>
        </div>
      </div>
      <div id="koPanel"></div>
    </div>`;
  document.getElementById('koTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-ko-tab]')?.dataset.koTab;
    if (!tab || tab === _tab) return;
    _tab = tab;
    _renderBuilt(t);
  });

  const panel = document.getElementById('koPanel');
  if (_tab === 'bracket') {
    const phone = _phone();
    const canScore = (m) => can('scores') || (!!me && (m.p1 === me || m.p2 === me) && !m.winner);
    panel.innerHTML = `<div class="ko-tree-scroll ko-tree-scroll--bleed">${bracketTreeHTML(b, { compact: phone, plainHeads: phone, live: true, me, canScore })}</div>`;
    wireBracketTree(panel.querySelector('.ko-tree'), b, {
      hover: !phone,
      me,
      onOpen: (m) => openMatchCard(m.id),
      onScore: (m) => openScoreModal(m),
    });
  } else {
    panel.innerHTML = _entrantsHTML(t, b, me, admin);
    panel.querySelectorAll('[data-replace]').forEach((el) => el.addEventListener('click', () => _openReplace(t, b.pById[Number(el.dataset.replace)])));
    panel.querySelectorAll('[data-withdraw-player]').forEach((el) => el.addEventListener('click', () => _openWithdraw(t, b.pById[Number(el.dataset.withdrawPlayer)])));
  }
}

const STATUS_PILL = { in: 'green', out: 'grey', runner: 'blue', champion: 'amber', withdrawn: 'grey' };

function _entrantsHTML(t, b, me, admin) {
  const rows = b.players.map((p) => {
    const st = K.standing(b, p);
    const mine = me === p;
    const editable = admin && b.stage !== 'done' && !p.withdrawn && !K.hasPlayed(b, p);
    const av = `<span class="ko-eav${st.kind === 'champion' ? ' ko-eav--champ' : mine ? ' ko-eav--me' : ''}">${p.photo_path ? avatarInner(p) : esc(K.initials(p.name))}</span>`;
    return `
      <div class="lg-std-row${mine ? ' lg-me' : ''}">
        <span class="lg-std-rank${p.seed === 1 ? ' lg-rank-first' : mine ? ' lg-rank-me' : ''}">${p.seed}</span>
        <span class="lg-std-name">${av}<span class="nav-player-link${mine ? ' lg-name-me' : ''}" data-player-id="${p.id}">${esc(p.name)}</span>${mine ? '<span class="lg-you">YOU</span>' : ''}${st.bye ? '<span class="pill pill--grey">Bye</span>' : ''}</span>
        <span class="ko-erank ko-desk-col">${p.rank ? `#${p.rank} at seeding` : 'Unranked'}</span>
        <span class="ko-estatus"><span class="pill pill--${st.kind === 'in' && b.stage === 'notStarted' ? 'grey' : STATUS_PILL[st.kind]}">${st.text}</span>${st.sub ? `<span class="ko-estatus-sub">${esc(st.sub)}</span>` : ''}</span>
        ${admin ? `<span class="ko-eacts">${editable ? `<button type="button" class="btn btn-outline btn-sm" data-replace="${p.id}">Replace</button><button type="button" class="btn btn-outline btn-sm" data-withdraw-player="${p.id}">Withdraw</button>` : ''}</span>` : ''}
      </div>`;
  }).join('');
  return `
    ${admin ? '<div class="lg-roster-hint"><span class="lg-roster-hint-text">Entrants in seed order. <strong>Replace</strong> or <strong>Withdraw</strong> is available until a player\'s first match is played.</span></div>' : ''}
    <div class="lg-page ko-entrants${admin ? ' ko-entrants--admin' : ''}" style="gap:0"><div class="lg-std-card">
      <div class="lg-std-cols"><span>Seed</span><span>Player</span><span class="ko-desk-col">Ladder</span><span>Status</span>${admin ? '<span></span>' : ''}</div>
      ${rows}
    </div></div>`;
}

function _onOption(action, t) {
  if (action === 'message') {
    openMessagePlayersModal({
      recipients: t.players.filter((p) => !p.withdrawn).map((p) => ({ player_email: p.email })),
      send: (payload) => window.api.messageTournamentPlayers(t.id, payload),
    });
  } else if (action === 'invite') {
    openBulkInviteModal({ what: 'this tournament', send: () => window.api.bulkInviteTournament(t.id) });
  } else if (action === 'schedule') {
    startEditSchedule(t);
  } else if (action === 'delete') {
    confirmModal({
      title: 'Delete tournament',
      body: `Delete <strong>${esc(t.name)}</strong>? Its draw, schedule and results are removed and cannot be brought back.`,
      confirm: 'Delete tournament',
      bodyClass: '',
      onConfirm: async () => {
        await window.api.deleteTournament(t.id);
        toast(`${t.name} deleted`);
        window.navigate('tournaments');
      },
    });
  }
}

function _openReplace(t, p) {
  if (!p) return;
  const inDraw = new Set(t.players.map((x) => x.player_id));
  const ranks = _ranks();
  let pick = null;
  modal.open('Replace player', `
    <p class="ko-modal-copy">The player you pick takes ${esc(p.name)}'s place as seed ${p.seed}, and their matches.</p>
    <input class="form-control" id="koReplaceQ" placeholder="Search club members…" autocomplete="off">
    <div class="ko-pick-list" id="koReplaceList"></div>
    <div class="form-actions">
      <button class="btn btn-outline" id="koReplaceNo">Cancel</button>
      <button class="btn btn-primary" id="koReplaceYes" disabled>Replace</button>
    </div>`);
  const club = (state.players || []).filter((x) => !inDraw.has(x.id))
    .map((x, k) => ({ ...x, rank: ranks[x.id] ?? null, k }))
    .sort((a, c) => (a.rank ?? Infinity) - (c.rank ?? Infinity) || a.k - c.k);
  const paint = () => {
    const q = document.getElementById('koReplaceQ').value.trim().toLowerCase();
    document.getElementById('koReplaceList').innerHTML = club.filter((x) => !q || x.name.toLowerCase().includes(q)).slice(0, 8).map((x) => `
      <button type="button" class="wz-prow${pick === x.id ? ' wz-prow--picked' : ''}" data-pick="${x.id}">
        ${avatarHTML(x, 'wz-avatar')}<span class="wz-pname">${esc(x.name)}</span><span class="wz-prank">${x.rank ? `#${x.rank}` : ''}</span>
      </button>`).join('') || '<div class="wz-lempty"><span class="wz-lempty-t">No one matches</span></div>';
  };
  paint();
  document.getElementById('koReplaceQ').addEventListener('input', paint);
  document.getElementById('koReplaceList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    pick = Number(b.dataset.pick);
    document.getElementById('koReplaceYes').disabled = false;
    paint();
  });
  document.getElementById('koReplaceNo').addEventListener('click', modal.close);
  document.getElementById('koReplaceYes').addEventListener('click', async () => {
    try {
      await window.api.replaceTournamentPlayer(t.id, { oldPlayerId: p.id, newPlayerId: pick });
      modal.close();
      toast(`${club.find((x) => x.id === pick)?.name} replaces ${p.name}`, 'success');
      await _reload();
    } catch (e) { toast(e.message || 'Could not replace them.', 'error'); }
  });
  if (!state.ladder.length) window.api.getLadder().then((l) => { state.ladder = l; }).catch(() => {});
}

function _openWithdraw(t, p) {
  if (!p) return;
  confirmModal({
    title: 'Withdraw player',
    body: `Withdraw ${esc(p.name)} from ${esc(t.name)}? Their next opponent gets a walkover unless you replace them.`,
    confirm: 'Withdraw',
    onConfirm: async () => {
      try {
        await window.api.withdrawTournamentPlayer(t.id, p.id);
        toast(`${p.name} withdrawn`, 'success');
        await _reload();
      } catch (e) { toast(e.message || 'Could not withdraw them.', 'error'); }
    },
  });
}

// ----- score entry -----

const PRESETS = [{ p1: 3, p2: 0 }, { p1: 3, p2: 1 }, { p1: 3, p2: 2 }, { p1: 0, p2: 3 }, { p1: 1, p2: 3 }, { p1: 2, p2: 3 }];

/**
 * The best-of-five pick for one match. `m` needs id, p1/p2 names, the current
 * score if any. Admins can correct or clear any result; a player enters their
 * own, once.
 */
function _scoreModal({ id, p1Name, p2Name, value, onDone }) {
  const admin = can('scores');
  let sel = value || null;
  const first = (n) => String(n || '').split(' ')[0];
  const paint = () => {
    document.getElementById('koPresets').innerHTML = PRESETS.map((pr) => {
      const on = sel && sel.p1 === pr.p1 && sel.p2 === pr.p2;
      const p1wins = pr.p1 > pr.p2;
      return `<button type="button" class="tr-preset-btn${on ? ' tr-preset-btn--selected' : ''}" data-p1="${pr.p1}" data-p2="${pr.p2}">
        <span class="tr-preset-score">${p1wins ? `${pr.p1}–${pr.p2}` : `${pr.p2}–${pr.p1}`}</span>
        <span class="tr-preset-winner">${esc(first(p1wins ? p1Name : p2Name))} wins</span>
      </button>`;
    }).join('');
    document.getElementById('koSave').disabled = !sel;
  };
  modal.open('Score Entry', `
    <div class="tr-score-modal">
      <div class="tr-score-matchup">
        <span class="tr-score-p1name">${esc(p1Name)}</span>
        <span class="tr-score-vs">vs</span>
        <span class="tr-score-p2name">${esc(p2Name)}</span>
      </div>
      <div class="tr-preset-grid" id="koPresets"></div>
      <div class="tr-score-actions">
        <span class="form-error" id="koScoreErr" style="margin-right:auto"></span>
        ${admin && value ? '<button type="button" class="btn btn-ghost" id="koClear">Clear Score</button>' : ''}
        <button type="button" class="btn btn-ghost" id="koCancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="koSave" disabled>Save Score</button>
      </div>
    </div>`, { medium: true });
  paint();
  document.getElementById('koPresets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p1]');
    if (!b) return;
    sel = { p1: Number(b.dataset.p1), p2: Number(b.dataset.p2) };
    paint();
  });
  document.getElementById('koCancel').addEventListener('click', modal.close);
  document.getElementById('koClear')?.addEventListener('click', async () => {
    await window.api.clearTournamentScore(id);
    modal.close();
    toast('Score cleared');
    onDone?.();
  });
  document.getElementById('koSave').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      if (admin) await window.api.updateTournamentScore(id, sel);
      else await window.api.reportTournamentPlayerScore(id, sel);
      modal.close();
      toast('Score saved', 'success');
      onDone?.();
    } catch (err) {
      document.getElementById('koScoreErr').textContent = err.message || 'Could not save.';
      e.target.disabled = false;
    }
  });
}

export function openScoreModal(m) {
  _scoreModal({ id: m.id, p1Name: m.p1?.name, p2Name: m.p2?.name, value: m.score, onDone: _reload });
}

/**
 * From the match card's "Submit score": the match may be on the bracket being
 * shown, or anywhere else in the app (the dashboard, a profile).
 */
window.openTournamentScore = async (matchId) => {
  const m = _b && state.page === 'tournamentDetail' ? _b.rounds.flat().find((x) => x.id === Number(matchId)) : null;
  if (m) { openScoreModal(m); return; }
  const card = await window.api.getMatchCard(matchId);
  if (!card) return;
  _scoreModal({
    id: card.id,
    p1Name: card.players[0]?.name,
    p2Name: card.players[1]?.name,
    value: null,
    onDone: () => { if (state.page === 'tournamentDetail') _reload(); },
  });
};
