// ===== KNOCKOUT TOURNAMENTS: THE BRACKET =====
// Single elimination, singles, an 8- or 16-player draw. Pure data and
// arithmetic, no DOM and no database: the server requires this same file to
// create and advance a draw, and the browser imports it to preview and draw
// one, so the two can never disagree about who meets whom.
//
// Positions are 0-based throughout: round r (0 = first round), match i within
// it. A match's slot in the matches table is `${r}-${i}`.

/** The fewest players a draw can be built with. */
export const MIN_ENTRANTS = 5;
export const DRAW_SIZES = [8, 16];

// Seed in each first-round line, top to bottom. Adjacent pairs meet, and the
// seeds past the entrant count are empty - which is how byes fall to the top
// seeds without any special case.
export const SEED_ORDER = {
  8: [1, 8, 4, 5, 3, 6, 2, 7],
  16: [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15],
};

// What matches.round holds for each round, by draw.
export const ROUND_KEYS = {
  8: ['quarterfinal', 'semifinal', 'final'],
  16: ['round_of_16', 'quarterfinal', 'semifinal', 'final'],
};
export const ROUND_NAMES = { round_of_16: 'Round of 16', quarterfinal: 'Quarterfinals', semifinal: 'Semifinals', final: 'Final' };
export const ROUND_SINGULAR = { round_of_16: 'Round of 16', quarterfinal: 'Quarterfinal', semifinal: 'Semifinal', final: 'Final' };
export const ROUND_ABBR = { round_of_16: 'R16', quarterfinal: 'QF', semifinal: 'SF', final: 'F' };

/** The smallest draw that fits `n` entrants, never above the announced cap. */
export function drawFor(n, cap = 16) {
  const d = n <= 8 ? 8 : 16;
  return cap && d > cap ? cap : d;
}

export const roundCount = (draw) => Math.log2(draw);
export const byesFor = (draw, n) => Math.max(0, draw - n);
export const slotKey = (r, i) => `${r}-${i}`;

export function parseSlot(slot) {
  const m = /^(\d+)-(\d+)$/.exec(String(slot || ''));
  return m ? { r: Number(m[1]), i: Number(m[2]) } : null;
}

/** Where the winner of (r, i) goes next: the match and which side. Null after the final. */
export function nextSlot(r, i, draw) {
  if (r >= roundCount(draw) - 1) return null;
  return { r: r + 1, i: i >> 1, side: i % 2 === 0 ? 1 : 2 };
}

/** "QF 2", "R16 5", "Final". */
export function matchLabel(draw, r, i) {
  if (r === roundCount(draw) - 1) return 'Final';
  return `${ROUND_ABBR[ROUND_KEYS[draw][r]]} ${i + 1}`;
}

/** [[seedA, seedB], ...] for the first round, top to bottom. */
export function firstRoundSeeds(draw) {
  const order = SEED_ORDER[draw];
  const out = [];
  for (let k = 0; k < order.length; k += 2) out.push([order[k], order[k + 1]]);
  return out;
}

// ----- time -----
export const toMin = (hhmm) => {
  if (hhmm == null || hhmm === '') return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const fmtTime = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/**
 * A round's matches spread over the courts: everyone starts in waves, one
 * match per court per wave. `ends` is when the last match should finish.
 */
export function roundPlan(matchCount, courtCount, start, len, buffer) {
  const c = Math.max(1, courtCount);
  const waves = Math.max(1, Math.ceil(matchCount / c));
  return { waves, ends: start + (waves - 1) * (len + buffer) + len, courts: c };
}

/** The k-th match of a round (byes not counted): its start and which court. */
export function slotTime(k, { start, courtCount, len, buffer }) {
  const c = Math.max(1, courtCount);
  return { time: start + Math.floor(k / c) * (len + buffer), courtIndex: k % c };
}

/** How many real (non-bye) matches each round holds. */
export function matchCounts(draw, n) {
  const R = roundCount(draw);
  const byes = byesFor(draw, n);
  return Array.from({ length: R }, (_, r) => (r === 0 ? (draw >> 1) - byes : draw >> (r + 1)));
}

// ----- the bracket -----

/**
 * The whole draw as one structure both pages read.
 *
 * `entrants` are in seed order. With `rows` (the tournament's matches from the
 * database) the bracket is the live one - players, results and slots come from
 * the rows, since a replacement or a walkover can make them differ from the
 * seeding. Without rows it is a preview: byes carried through and every match
 * given its time and court from the schedule.
 *
 * A first-round bye has no row; it is recognised from the seeding alone.
 */
export function buildBracket({ draw, entrants, rounds = [], courts = [], len = 40, buffer = 10, rows = null }) {
  const R = roundCount(draw);
  const players = entrants.map((p, k) => ({ ...p, seed: k + 1 }));
  const byId = new Map(players.map((p) => [p.id, p]));
  const P = (id) => {
    if (id == null) return null;
    if (!byId.has(id)) byId.set(id, { id, name: 'Unknown player', seed: null });
    return byId.get(id);
  };

  const out = [];
  for (let r = 0; r < R; r++) {
    const arr = [];
    for (let i = 0; i < draw >> (r + 1); i++) {
      arr.push({
        r, i, key: slotKey(r, i), label: matchLabel(draw, r, i), roundKey: ROUND_KEYS[draw][r],
        id: null, p1: null, p2: null, score: null, winner: null, bye: false, walkover: false,
        date: rounds[r]?.date || null, time: null, court: null,
      });
    }
    out.push(arr);
  }

  firstRoundSeeds(draw).forEach(([a, b], i) => {
    const m = out[0][i];
    m.p1 = players[a - 1] || null;
    m.p2 = players[b - 1] || null;
    if (!m.p1 || !m.p2) { m.bye = true; m.winner = m.p1 || m.p2; }
  });

  if (rows) {
    const rowAt = new Map(rows.map((x) => [x.bracket_slot, x]));
    for (const rd of out) {
      for (const m of rd) {
        const row = rowAt.get(m.key);
        if (!row) continue;
        m.bye = false;
        m.id = row.id;
        m.p1 = P(row.player1_id);
        m.p2 = P(row.player2_id);
        m.date = row.scheduled_date || m.date;
        m.time = toMin(row.scheduled_time);
        m.court = row.court_id ? { id: row.court_id, name: row.court_name || `Court ${row.court_id}` } : null;
        if (row.winner_id != null) {
          m.winner = P(row.winner_id);
          m.walkover = !!row.skipped;
          m.score = row.player1_score != null && row.player2_score != null ? { p1: row.player1_score, p2: row.player2_score } : null;
        }
      }
    }
  } else {
    const c = courts.length || 1;
    for (let r = 0; r < R; r++) {
      let k = 0;
      for (const m of out[r]) {
        if (r > 0) {
          m.p1 = out[r - 1][2 * m.i].bye ? out[r - 1][2 * m.i].winner : null;
          m.p2 = out[r - 1][2 * m.i + 1].bye ? out[r - 1][2 * m.i + 1].winner : null;
        }
        if (m.bye) continue;
        const start = rounds[r]?.time ?? 0;
        const t = slotTime(k, { start, courtCount: c, len, buffer });
        m.time = t.time;
        m.court = courts[t.courtIndex] || null;
        k++;
      }
    }
  }

  const final = out[R - 1][0];
  const real = out.flat().filter((m) => !m.bye);
  const decided = real.filter((m) => m.winner);
  let cur = R - 1;
  for (let r = 0; r < R; r++) { if (out[r].some((m) => !m.bye && !m.winner)) { cur = r; break; } }
  const stage = final.winner ? 'done' : decided.length ? 'mid' : 'notStarted';
  const b = {
    draw, R, ent: players.length, byes: out[0].filter((m) => m.bye).length,
    players, rounds: out, final, cur, stage, champion: final.winner || null,
    played: decided.length, total: real.length, mById: {}, pById: {},
  };
  for (const m of out.flat()) b.mById[m.key] = m;
  for (const p of players) b.pById[p.id] = p;
  return b;
}

/** The match the winner of `m` plays next, or null after the final. */
export const destOf = (b, m) => (m.r < b.R - 1 ? b.rounds[m.r + 1][m.i >> 1] : null);

/** The two matches that feed `m`, top first. Empty for the first round. */
export const feedersOf = (b, m) => (m.r > 0 ? [b.rounds[m.r - 1][2 * m.i], b.rounds[m.r - 1][2 * m.i + 1]] : []);

/** The loser of a decided match (null for a bye or an undecided one). */
export const loserOf = (m) => (m.winner && m.p1 && m.p2 ? (m.winner === m.p1 ? m.p2 : m.p1) : null);

/** What an empty slot says: "Bye" in the first round, else "Winner of QF 2". */
export function emptySlotText(b, m, side) {
  if (m.r === 0) return 'Bye';
  const f = feedersOf(b, m)[side - 1];
  return `Winner of ${f.label}`;
}

/**
 * Highlights for a focused player or match, for the bracket's hover tracing.
 * `m` maps match keys to 'focus' | 'path' | 'opp'; `s` maps "key:side" to
 * 'path' | 'opp'; `l` maps the key of the match a connector leaves from to
 * 'path' (decided), 'if' (pending) or 'opp' (a possible opponent's route).
 */
export function computeHighlights(b, focus) {
  const hl = { m: {}, s: {}, l: {} };
  if (!focus) return hl;
  if (focus.kind === 'match') {
    const m = focus.m;
    hl.m[m.key] = 'focus';
    for (const f of feedersOf(b, m)) { hl.m[f.key] = 'path'; hl.l[f.key] = 'path'; }
    const d = destOf(b, m);
    if (d) { hl.m[d.key] = 'path'; hl.l[m.key] = 'if'; }
    return hl;
  }
  const P = focus.p;
  const sideOf = (m) => (m.p1 === P ? 1 : 2);
  let last = null;
  for (const m of b.rounds.flat()) {
    if (m.p1 !== P && m.p2 !== P) continue;
    hl.m[m.key] = 'path';
    hl.s[`${m.key}:${sideOf(m)}`] = 'path';
    if (last) hl.l[last.key] = 'path';
    last = m;
  }
  if (!last || (last.winner && last.winner !== P)) return hl;
  const markOpp = (m) => {
    if (hl.m[m.key] === 'path') return;
    hl.m[m.key] = 'opp';
    [m.p1, m.p2].forEach((p, j) => { if (p && (!m.winner || m.winner === p)) hl.s[`${m.key}:${j + 1}`] = 'opp'; });
    if (!m.winner) for (const f of feedersOf(b, m)) { if (!hl.l[f.key]) hl.l[f.key] = 'opp'; markOpp(f); }
  };
  let c = last;
  for (;;) {
    const d = destOf(b, c);
    if (!d) break;
    hl.l[c.key] = c.winner === P ? 'path' : 'if';
    hl.m[d.key] = 'path';
    const mySide = c.i % 2 === 0 ? 1 : 2;
    hl.s[`${d.key}:${mySide}`] = 'path';
    const other = b.rounds[c.r][c.i ^ 1];
    const otherP = mySide === 1 ? d.p2 : d.p1;
    if (otherP) hl.s[`${d.key}:${mySide === 1 ? 2 : 1}`] = 'opp';
    else markOpp(other);
    c = d;
  }
  return hl;
}

/**
 * Where a player stands, for the Entrants tab and the list card.
 * kind: champion | runner | out | in | withdrawn.
 */
export function standing(b, p) {
  let last = null;
  let bye = false;
  for (const m of b.rounds.flat()) {
    if (m.p1 !== p && m.p2 !== p) continue;
    if (m.bye) bye = true; else last = m;
  }
  const base = { bye, kind: 'in', text: b.stage === 'notStarted' ? 'Not started' : 'Still in', sub: '', match: null };
  if (p.withdrawn) return { ...base, kind: 'withdrawn', text: 'Withdrawn' };
  if (b.champion === p) return { ...base, kind: 'champion', text: 'Champion' };
  if (b.stage === 'done' && (b.final.p1 === p || b.final.p2 === p)) return { ...base, kind: 'runner', text: 'Runner-up' };
  if (last && last.winner && last.winner !== p) {
    const abbr = ROUND_ABBR[last.roundKey];
    if (last.walkover || !last.score) return { ...base, kind: 'out', text: `Out in ${abbr}`, sub: 'Walkover', match: last };
    const mine = last.p1 === p ? last.score.p1 : last.score.p2;
    const theirs = last.p1 === p ? last.score.p2 : last.score.p1;
    return { ...base, kind: 'out', text: `Out in ${abbr}`, sub: `${mine}–${theirs} v ${surname(last.winner.name)}`, match: last };
  }
  const next = b.rounds.flat().find((m) => (m.p1 === p || m.p2 === p) && !m.bye && !m.winner) || null;
  return { ...base, sub: next ? `Next: ${next.label}${next.date ? ` · ${fmtDate(next.date)}` : ''}` : '', match: next };
}

/** Has this player played a match yet? A walkover does not count. */
export function hasPlayed(b, p) {
  return b.rounds.flat().some((m) => (m.p1 === p || m.p2 === p) && m.winner && !m.walkover && !m.bye);
}

// ----- names and dates -----
export const surname = (name) => String(name || '').trim().split(/\s+/).pop() || '';
export const initials = (name) => String(name || '').trim().split(/\s+/).filter(Boolean)
  .map((w) => w[0]).join('').slice(0, 2).toUpperCase();

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Read at noon so a date-only string never slides into the day before.
const at = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`);
/** "Sat Oct 3" */
export const fmtDate = (iso) => { const d = at(iso); return `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`; };
/** "Saturday, October 3" */
export const fmtLong = (iso) => { const d = at(iso); return `${DOWL[d.getDay()]}, ${MONL[d.getMonth()]} ${d.getDate()}`; };
/** "Saturday, October 3, 2026" */
export const fmtLongY = (iso) => `${fmtLong(iso)}, ${at(iso).getFullYear()}`;
/** "Oct 3" */
export const fmtMD = (iso) => { const d = at(iso); return `${MON[d.getMonth()]} ${d.getDate()}`; };
/** "Sat" */
export const fmtDow = (iso) => DOW[at(iso).getDay()];
