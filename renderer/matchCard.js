import { state } from './state.js';
import { esc, toast, modal, avatarHTML } from './utils.js';

// ===== MATCH CARD =====
// One modal, opened from anywhere a match is drawn - the dashboard, a profile,
// a league page, the schedule, the court grid, the activity feed. Everything it
// shows comes from a single call, so no two surfaces can describe the same
// match differently.
//
// Any signed-in member can open any match. Being one of the two players changes
// only two things: your avatar gets the "you" ring, and if the match has not
// been played you are offered the score form.

const WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MO = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function _long(dateStr) {
  if (!dateStr) return '';
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
  return `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}`;
}

function _short(dateStr) {
  if (!dateStr) return '';
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
  return `${MO[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
}

function _time(hhmm) {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const _first = (name) => String(name || '').split(/\s+/)[0];

// What competition this is, in the band across the top.
function _kicker(c) {
  if (c.type === 'tournament') {
    const round = { group: 'Group Stage', quarterfinal: 'Quarterfinal', semifinal: 'Semifinal', final: 'Final' }[c.round] || c.round;
    return [c.tournament_name, round].filter(Boolean).join(' · ');
  }
  if (c.type === 'ladder') return 'Ladder match';
  return [c.league_name, c.division_name, c.week_number ? `Week ${c.week_number}` : null]
    .filter(Boolean).join(' · ');
}

// The middle block: where this match is in its life.
function _strip(c) {
  if (c.status === 'played') {
    return { kind: 'played', title: `Played ${_long(c.played_at)}`, sub: '' };
  }
  if (c.skipped) {
    return { kind: 'unscheduled', title: 'Not played', sub: 'This match was skipped.' };
  }
  if (c.status === 'scheduled' && c.scheduled_date) {
    return {
      kind: 'scheduled',
      title: [_long(c.scheduled_date), _time(c.scheduled_time)].filter(Boolean).join(' · '),
      sub: c.court_name || '',
    };
  }
  return { kind: 'unscheduled', title: 'Not yet scheduled', sub: 'No court or time set for this match.' };
}

function _playerHTML(p, c) {
  const meta = [
    p.position ? `#${p.position} on ladder` : 'Not on ladder yet',
    p.rating != null ? Math.round(p.rating) : null,
  ].filter((x) => x != null && x !== '').join(' · ');

  const delta = p.rating_change;
  const deltaHTML = delta === undefined || delta === null || delta === 0
    ? ''
    : `<span class="mc-delta ${delta > 0 ? 'mc-delta--up' : 'mc-delta--down'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</span>`;

  return `
    <div class="mc-player">
      ${avatarHTML(p, `mc-avatar${p.is_viewer ? ' mc-avatar--you' : ''}`)}
      <button class="mc-name nav-player-link" data-player-id="${p.id}">${esc(p.name || 'TBD')}</button>
      <span class="mc-meta">${esc(meta)}</span>
      ${deltaHTML}
      ${p.won ? '<span class="mc-winner">Winner</span>' : ''}
    </div>`;
}

function _cardHTML(c) {
  const played = c.status === 'played';
  const strip = _strip(c);
  const h = c.head_to_head || { aWins: 0, bWins: 0, total: 0, meetings: [] };
  const [a, b] = c.players;

  // Whoever is ahead is named; level is stated as level rather than implied.
  let lead = '';
  if (h.total) {
    lead = h.aWins === h.bWins
      ? `Level ${h.aWins}–${h.bWins}`
      : `${_first(h.aWins > h.bWins ? a.name : b.name)} leads ${Math.max(h.aWins, h.bWins)}–${Math.min(h.aWins, h.bWins)}`;
  }
  const barPct = h.total ? (h.aWins / h.total) * 100 : 0;

  const meetings = (h.meetings || []).map((m) => {
    const winner = m.winner_id === a.id ? a.name : b.name;
    return `
      <div class="mc-meeting">
        <span class="mc-meeting-date">${esc(_short(m.played_at))}</span>
        <span class="mc-meeting-who">${esc(winner)}</span>
        <span class="mc-meeting-score">${esc(m.score || '')}</span>
      </div>`;
  }).join('');

  return `
    <div class="mc-card">
      <div class="mc-band">
        <span class="mc-kicker">${esc(_kicker(c))}</span>
      </div>

      <div class="mc-players">
        ${_playerHTML(a, c)}
        <div class="mc-centre">
          <span class="${played ? 'mc-score' : 'mc-vs'}">${played ? esc(c.score || '') : 'VS'}</span>
          ${played ? '<span class="mc-final">Final</span>' : ''}
        </div>
        ${_playerHTML(b, c)}
      </div>

      <div class="mc-strip mc-strip--${strip.kind}">
        <span class="mc-strip-title">${esc(strip.title)}</span>
        ${strip.sub ? `<span class="mc-strip-sub">${esc(strip.sub)}</span>` : ''}
      </div>

      <div class="mc-h2h">
        <div class="mc-h2h-head">
          <span class="mc-h2h-label">Head to head</span>
          ${lead ? `<span class="mc-h2h-lead">${esc(lead)}</span>` : ''}
        </div>
        ${h.total ? `
          <div class="mc-bar"><span class="mc-bar-fill" style="width:${barPct}%"></span></div>
          <div class="mc-meetings">${meetings}</div>
        ` : '<div class="mc-h2h-empty">First meeting — these two have never played.</div>'}
      </div>

      ${c.can_submit_score ? `
        <div class="mc-foot">
          <button class="mc-submit" id="mcSubmit">Submit score</button>
        </div>` : ''}
    </div>`;
}

/**
 * Open the card for one match. Safe to call from anywhere; it fetches its own
 * data and reports its own failure.
 */
export async function openMatchCard(matchId) {
  if (matchId == null) return;
  // League matches are addressed as "m_123" on the schedule grid, tournaments
  // as "t_12"; both are the same row now, so the prefix is just dropped.
  const id = String(matchId).replace(/^[a-z]_/, '');

  modal.open('Match', '<div class="modal-loading">Loading match…</div>', { medium: true });
  let card;
  try {
    card = await window.api.getMatchCard(id);
  } catch (e) {
    modal.close();
    toast(e.message || 'Could not load that match.', 'error');
    return;
  }
  if (!card) { modal.close(); return; }

  document.getElementById('modalBody').innerHTML = _cardHTML(card);
  document.getElementById('modal')?.classList.add('modal-matchcard');

  document.querySelectorAll('#modalBody .mc-name').forEach((el) => {
    el.addEventListener('click', () => {
      const pid = Number(el.dataset.playerId);
      if (!pid) return;
      modal.close();
      window.openPlayerProfile(pid);
    });
  });

  document.getElementById('mcSubmit')?.addEventListener('click', () => {
    modal.close();
    // The score form lives on the Report Score page, so the card hands over
    // rather than carrying a second copy of it.
    window.navigate('reportScore', { matchId: card.id });
  });
}
