// ===== THE BRACKET TREE =====
// A knockout drawn as a classic left-to-right tree: one column per round, each
// match centred between the two it follows from, elbow connectors between
// them, and a Champion column at the end. Absolutely positioned from the
// bracket's own arithmetic, so the lines always meet the cards.
//
// On a desktop, hovering traces: a match lights its feeders and where its
// winner goes; a player lights their path so far, the matches still ahead of
// them and, in amber, everyone they could meet there. The signed-in member's
// own path is traced in blue whenever nothing else is hovered.
import { esc } from './utils.js';
import {
  ROUND_NAMES, computeHighlights, feedersOf, emptySlotText, fmtDate, fmtDow, fmtTime, surname,
} from './knockout.js';

const NAVY = '#1e2758';
const YOU = '#5b7cf9';
const AMBER = '#d68910';
const AMBER_BG = '#fdf4e3';
const LINE = '#dce3ed';
const H = 90;
const GAP = 14;

/** Card and column sizes: full on a desktop, tighter on a phone or in the wizard's preview. */
export function treeGeometry({ compact }) {
  return compact ? { W: 150, pitch: 176, head: 30 } : { W: 200, pitch: 236, head: 38 };
}

const shortCourt = (c) => (c ? String(c.name).replace(/^Court\s*/i, 'Ct ') : '');

/** Where every card sits. */
function layout(b, g) {
  const pos = {};
  let maxY = 0;
  for (let r = 0; r < b.R; r++) {
    b.rounds[r].forEach((m, k) => {
      const y = r === 0 ? g.head + k * (H + GAP) : (pos[feedersOf(b, m)[0].key].y + pos[feedersOf(b, m)[1].key].y) / 2;
      pos[m.key] = { x: r * g.pitch, y };
      maxY = Math.max(maxY, y + H);
    });
  }
  return { pos, maxY };
}

/** The line under a round's name: "Sat Oct 10 · 6:00 PM · Courts 1, 2, 3 · 5 byes". */
function roundSub(b, r) {
  const ms = b.rounds[r].filter((m) => !m.bye);
  const byes = b.rounds[r].length - ms.length;
  const date = (ms[0] || b.rounds[r][0]).date;
  const times = ms.map((m) => m.time).filter((t) => t != null);
  const courts = [...new Set(ms.map((m) => m.court?.name).filter(Boolean))]
    .sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  const courtText = courts.length ? `${courts.length > 1 ? 'Courts' : 'Court'} ${courts.map((c) => c.replace(/^Court\s*/i, '')).join(', ')}` : '';
  return [date ? fmtDate(date) : '', times.length ? fmtTime(Math.min(...times)) : '', courtText, byes ? `${byes} bye${byes > 1 ? 's' : ''}` : '']
    .filter(Boolean).join(' · ');
}

/**
 * The tree's HTML. `opts`: compact (phone/preview geometry), plainHeads (no
 * sub-line under round names), short (surnames), live (cards open and can be
 * scored), canScore(m) (whether this viewer gets a Score / Edit link), me (the
 * signed-in player in this bracket, or null).
 */
export function bracketTreeHTML(b, opts = {}) {
  const g = treeGeometry(opts);
  const { pos, maxY } = layout(b, g);
  const fin = pos[b.final.key];
  const champX = fin.x + g.pitch;
  const width = champX + g.W;
  const height = maxY + 8;
  const path = (x1, y1, x2, y2) => `M${x1} ${y1}H${(x1 + x2) / 2}V${y2}H${x2}`;

  const lines = [];
  for (const m of b.rounds.flat()) {
    if (m.r === 0) continue;
    for (const f of feedersOf(b, m)) {
      lines.push(`<path data-from="${f.key}" d="${path(pos[f.key].x + g.W, pos[f.key].y + H / 2, pos[m.key].x, pos[m.key].y + H / 2)}" />`);
    }
  }
  lines.push(`<path data-from="${b.final.key}" d="${path(fin.x + g.W, fin.y + H / 2, champX, fin.y + H / 2)}" />`);

  const heads = b.rounds.map((_, r) => `
    <div class="ko-col-head" style="left:${r * g.pitch}px;width:${g.W}px">
      <span class="ko-col-name">${ROUND_NAMES[b.rounds[r][0].roundKey]}</span>
      ${opts.plainHeads ? '' : `<span class="ko-col-sub" title="${esc(roundSub(b, r))}">${esc(roundSub(b, r))}</span>`}
    </div>`).join('') + `
    <div class="ko-col-head" style="left:${champX}px;width:${g.W}px"><span class="ko-col-name">Champion</span></div>`;

  const c = b.champion;
  const runner = c ? (b.final.winner === b.final.p1 ? b.final.p2 : b.final.p1) : null;
  const finalScore = b.final.score ? (b.final.winner === b.final.p1 ? `${b.final.score.p1}–${b.final.score.p2}` : `${b.final.score.p2}–${b.final.score.p1}`) : '';
  const champ = `
    <div class="ko-champ${c ? ' ko-champ--won' : ''}" style="left:${champX}px;top:${fin.y + 14}px;width:${g.W}px">
      <span class="ko-champ-label">Champion</span>
      <span class="ko-champ-name">${c ? esc(c.name) : 'TBD'}</span>
      <span class="ko-champ-sub">${c
    ? (runner ? `def. ${esc(surname(runner.name))}${finalScore ? ` ${finalScore}` : ''} in the final` : 'Won the final')
    : `Final${b.final.date ? ` · ${fmtDate(b.final.date)}` : ''}${b.final.time != null ? ` · ${fmtTime(b.final.time)}` : ''}`}</span>
    </div>`;

  const cards = b.rounds.flat().map((m) => cardHTML(b, m, pos[m.key], g, opts)).join('');

  return `
    <div class="ko-tree" style="width:${width}px;height:${height}px">
      <svg class="ko-lines" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${lines.join('')}</svg>
      ${heads}${champ}${cards}
    </div>`;
}

function cardHTML(b, m, p, g, opts) {
  const me = opts.me || null;
  const meta = m.bye ? 'Bye'
    : m.walkover ? 'Walkover'
      : [m.date && m.time != null ? `${fmtDow(m.date)} ${fmtTime(m.time)}` : '', shortCourt(m.court)].filter(Boolean).join(' · ');
  const scorable = opts.live && !m.bye && m.id && m.p1 && m.p2 && opts.canScore?.(m);
  const slot = (pl, side) => {
    const won = !!pl && m.winner === pl && !m.bye;
    const lost = !!pl && !!m.winner && m.winner !== pl;
    const mine = !!me && pl === me;
    const cls = ['ko-slot', won ? 'ko-slot--won' : '', lost ? 'ko-slot--lost' : '', !pl ? 'ko-slot--empty' : '', mine ? 'ko-slot--me' : ''].filter(Boolean).join(' ');
    const name = pl ? (opts.short ? surname(pl.name) : pl.name) : emptySlotText(b, m, side);
    const games = m.score ? (side === 1 ? m.score.p1 : m.score.p2) : '';
    return `
      <div class="${cls}" data-slot="${m.key}:${side}"${pl ? ` data-player="${pl.id}"` : ''}>
        <span class="ko-seed">${pl?.seed ?? ''}</span>
        <span class="ko-name">${esc(name)}</span>
        ${mine ? '<span class="ko-you">YOU</span>' : ''}
        <span class="ko-games">${games}</span>
      </div>`;
  };
  return `
    <div class="ko-card${m.bye ? ' ko-card--bye' : ''}${opts.live && !m.bye && m.id ? ' ko-card--live' : ''}" data-key="${m.key}"${m.id ? ` data-match="${m.id}"` : ''} style="left:${p.x}px;top:${p.y}px;width:${g.W}px">
      <div class="ko-card-top">
        <span class="ko-card-label">${m.label}</span>
        <span class="ko-card-meta">
          <span class="ko-card-time">${esc(meta)}</span>
          ${scorable ? `<button type="button" class="ko-score-btn" data-score="${m.id}">${m.winner ? 'Edit' : 'Score'}</button>` : ''}
        </span>
      </div>
      ${slot(m.p1, 1)}${slot(m.p2, 2)}
    </div>`;
}

/**
 * Paint highlights onto a drawn tree. `focus` is { kind: 'match', m } or
 * { kind: 'player', p }; `active` dims everything not involved (a hover),
 * which the member's resting own-path trace does not.
 */
export function paintHighlights(root, b, focus, { me = null, active = false } = {}) {
  const hl = computeHighlights(b, focus);
  const accent = focus && focus.kind === 'player' && me && focus.p === me ? YOU : NAVY;
  root.querySelectorAll('.ko-card').forEach((el) => {
    const m = b.mById[el.dataset.key];
    const h = hl.m[m.key];
    el.style.borderColor = h === 'focus' || h === 'path' ? accent : h === 'opp' ? AMBER : '';
    el.style.boxShadow = h === 'focus' ? `0 0 0 1.5px ${accent}, 0 1px 4px rgba(0,0,0,.08)` : '';
    el.style.opacity = active && !h ? (m.bye ? '.35' : '.45') : '';
  });
  root.querySelectorAll('.ko-slot').forEach((el) => {
    const h = hl.s[el.dataset.slot];
    const mine = el.classList.contains('ko-slot--me');
    el.style.background = h === 'path' ? (mine ? '#eaf2fb' : 'rgba(30,39,88,.07)') : h === 'opp' ? AMBER_BG : '';
  });
  root.querySelectorAll('.ko-lines path').forEach((el) => {
    const t = hl.l[el.dataset.from];
    const [stroke, width, dash] = t === 'path' ? [accent, 2.2, 'none']
      : t === 'if' ? [accent, 1.8, '5 4']
        : t === 'opp' ? [AMBER, 1.5, '3 3'] : [LINE, 1.5, 'none'];
    el.setAttribute('stroke', stroke);
    el.setAttribute('stroke-width', width);
    el.setAttribute('stroke-dasharray', dash);
  });
}

/**
 * Hover tracing and clicks. `hover` turns tracing on (desktops); `onOpen(m)`
 * opens a match; `onScore(m)` its score entry. The member's own path is the
 * resting trace.
 */
export function wireBracketTree(root, b, { hover = true, me = null, onOpen, onScore } = {}) {
  const rest = me ? { kind: 'player', p: me } : null;
  const paint = (focus, active) => paintHighlights(root, b, focus, { me, active });
  paint(rest, false);
  if (hover) {
    root.querySelectorAll('.ko-card').forEach((el) => {
      const m = b.mById[el.dataset.key];
      el.addEventListener('mouseenter', () => paint({ kind: 'match', m }, true));
      el.addEventListener('mouseleave', () => paint(rest, false));
      el.querySelectorAll('.ko-slot[data-player]').forEach((s) => {
        const p = b.pById[Number(s.dataset.player)];
        if (!p) return;
        s.addEventListener('mouseenter', () => paint({ kind: 'player', p }, true));
        s.addEventListener('mouseleave', () => paint({ kind: 'match', m }, true));
      });
    });
  }
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-score]');
    if (btn) {
      e.stopPropagation();
      const m = b.rounds.flat().find((x) => String(x.id) === btn.dataset.score);
      if (m) onScore?.(m);
      return;
    }
    const card = e.target.closest('.ko-card--live');
    if (card) onOpen?.(b.mById[card.dataset.key]);
  });
}
