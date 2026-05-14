import { state, isAdmin } from '../state.js';
import { esc, formatShortDate, toast, modal } from '../utils.js';
import { startCreateLeague } from './createLeague.js';

// ===== LEAGUES PAGE =====
export async function renderLeagues() {
  document.getElementById('pageTitle').textContent = 'Leagues';
  document.getElementById('topbarActions').innerHTML = isAdmin() ? `
    <button class="btn btn-primary" id="btnCreateLeague">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
      New League
    </button>` : '';

  state.leagues = await window.api.getLeagues();
  const content = document.getElementById('mainContent');

  if (state.leagues.length === 0) {
    content.innerHTML = `
      <div class="table-card">
        <div class="empty-state">
          <strong>No leagues yet</strong>
          <p>${isAdmin() ? 'Create your first league to get started.' : 'No leagues have been created yet.'}</p>
        </div>
      </div>`;
  } else if (isAdmin()) {
    content.innerHTML = `<div class="league-grid">${state.leagues.map(leagueCardHTML).join('')}</div>`;
  } else {
    const playerId = state.currentUser?.playerId;
    const mine = state.leagues.filter((l) => (l.player_ids || []).includes(playerId));
    const other = state.leagues.filter((l) => !(l.player_ids || []).includes(playerId));
    let html = '';
    if (mine.length > 0) {
      html += `<div class="leagues-section-label">My Leagues</div><div class="league-grid">${mine.map(leagueCardHTML).join('')}</div>`;
    }
    if (other.length > 0) {
      html += `<div class="leagues-section-label${mine.length > 0 ? ' leagues-section-label--gap' : ''}">Other Leagues</div><div class="league-grid">${other.map(leagueCardHTML).join('')}</div>`;
    }
    content.innerHTML = html;
  }

  content.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openLeague(Number(btn.dataset.id)); });
  });
  content.querySelectorAll('.league-card').forEach((card) => {
    card.addEventListener('click', () => openLeague(Number(card.dataset.id)));
  });

  if (isAdmin()) {
    document.getElementById('btnCreateLeague')?.addEventListener('click', startCreateLeague);
  }
}

function leagueCardHTML(league) {
  return `
    <div class="league-card" data-id="${league.id}">
      <div class="league-card-header">
        <h3>${esc(league.name)}</h3>
        <span class="badge badge-${league.status}">${esc(league.status)}</span>
      </div>
      <div class="league-card-meta">
        <div class="meta-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
          Starts ${formatShortDate(league.start_date)}
        </div>
        <div class="meta-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          ${league.setup_type === 'modern'
            ? `${league.num_divisions} Division${league.num_divisions !== 1 ? 's' : ''}`
            : `${league.num_teams} teams &times; ${league.num_divisions} divisions &mdash; ${league.num_teams * league.num_divisions} players`}
        </div>
      </div>
      <div class="league-card-footer">
        <button class="btn btn-primary btn-sm" data-action="view" data-id="${league.id}">View League</button>
      </div>
    </div>`;
}

async function openLeague(id) {
  const league = await window.api.getLeague(id);
  window.navigate('leagueDetail', { league });
}

export function confirmDeleteLeague(id, name) {
  modal.open('Delete League', `
    <p>Delete <strong>${esc(name)}</strong>? This will remove all schedule data and cannot be undone.</p>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-danger" id="fConfirm">Delete League</button>
    </div>`);
  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fConfirm').addEventListener('click', async () => {
    await window.api.deleteLeague(id);
    modal.close();
    toast('League deleted');
    renderLeagues();
  });
}

// ===== PRINT BOXES =====
export function printBoxes(league) {
  const isModern = league.setup_type === 'modern';
  const numRounds = league.num_rounds || 1;
  const weeks = league.weeks || [];
  const weeksPerRound = Math.round(weeks.length / numRounds);

  // Group weeks into rounds
  const rounds = [];
  for (let r = 0; r < numRounds; r++) {
    rounds.push(weeks.slice(r * weeksPerRound, (r + 1) * weeksPerRound));
  }

  // Group players by division
  const divMap = {};
  (league.players || []).forEach((p) => {
    if (!divMap[p.division_level]) {
      divMap[p.division_level] = { name: p.division_name, level: p.division_level, players: [] };
    }
    divMap[p.division_level].players.push(p);
  });
  const divisions = Object.values(divMap)
    .sort((a, b) => a.level - b.level)
    .map((d) => ({
      ...d,
      players: d.players.slice().sort((a, b) =>
        isModern ? (a.skill_rank - b.skill_rank) : (a.team_order - b.team_order)
      ),
    }));

  let pagesHTML = '';

  rounds.forEach((roundWeeks, roundIdx) => {
    // Build pairIndex: sorted player-id pair -> match object
    const pairMatch = {};
    roundWeeks.forEach((week) => {
      (week.matchups || []).forEach((mu) => {
        (mu.matches || []).forEach((match) => {
          if (!match.skipped) {
            const key = [match.player1_id, match.player2_id].sort((a, b) => a - b).join('-');
            pairMatch[key] = match;
          }
        });
      });
    });

    divisions.forEach((div) => {
      const players = div.players;
      const roundLabel = numRounds > 1 ? ` &mdash; Round ${roundIdx + 1}` : '';

      // Column headers
      const colHeaders = players.map((p) => `
        <th class="box-col-header">
          <div class="box-col-player">${esc(p.player_name)}</div>
          ${!isModern ? `<div class="box-col-team">${esc(p.team_name)}</div>` : ''}
        </th>`).join('');

      // Rows
      const rows = players.map((rowP) => {
        const cells = players.map((colP) => {
          if (rowP.player_id === colP.player_id) {
            return '<td class="box-cell box-cell-self"><div class="box-cell-x">✕</div></td>';
          }
          const key = [rowP.player_id, colP.player_id].sort((a, b) => a - b).join('-');
          const match = pairMatch[key];
          if (match && match.player1_score !== null && match.player2_score !== null) {
            const isP1 = match.player1_id === rowP.player_id;
            const myScore = isP1 ? match.player1_score : match.player2_score;
            const theirScore = isP1 ? match.player2_score : match.player1_score;
            return `<td class="box-cell box-cell-scored">
              <div class="box-score">${myScore}&ndash;${theirScore}</div>
            </td>`;
          }
          return '<td class="box-cell"></td>';
        }).join('');
        return `<tr>
          <td class="box-row-header">
            <div class="box-row-player">${esc(rowP.player_name)}</div>
            ${!isModern ? `<div class="box-row-team">${esc(rowP.team_name)}</div>` : ''}
          </td>${cells}</tr>`;
      }).join('');

      pagesHTML += `
        <div class="box-page">
          <div class="box-title-bar">
            <div class="box-league">${esc(league.name)}</div>
            <div class="box-division">${esc(div.name)}${roundLabel}</div>
          </div>
          <table class="box-grid">
            <thead>
              <tr>
                <th class="box-corner"></th>
                ${colHeaders}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    });
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Box Sheets &mdash; ${esc(league.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; }

    .box-page {
      width: 100%;
      min-height: 100vh;
      padding: 18mm 16mm 14mm;
      display: flex;
      flex-direction: column;
      page-break-after: always;
      break-after: page;
    }

    .box-title-bar {
      margin-bottom: 10mm;
    }
    .box-league {
      font-size: 13pt;
      color: #555;
      font-weight: 500;
      margin-bottom: 2px;
    }
    .box-division {
      font-size: 22pt;
      font-weight: 800;
      color: #000;
      line-height: 1.1;
    }
    .box-grid {
      width: 100%;
      flex: 1;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .box-corner {
      width: 52mm;
    }

    .box-col-header {
      border: 2px solid #000;
      padding: 6px 4px;
      text-align: center;
      vertical-align: bottom;
      background: #fff;
      color: #000;
    }
    .box-col-player {
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.2;
    }
    .box-col-team {
      font-size: 8pt;
      opacity: 0.8;
      margin-top: 2px;
    }

    .box-row-header {
      border: 2px solid #000;
      padding: 6px 10px;
      background: #fff;
      color: #000;
      vertical-align: middle;
    }
    .box-row-player {
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.2;
    }
    .box-row-team {
      font-size: 8pt;
      opacity: 0.8;
      margin-top: 2px;
    }

    .box-cell {
      border: 2px solid #000;
      vertical-align: top;
      padding: 5px 6px;
      min-height: 30mm;
    }
    .box-cell-self {
      background: #ccc;
      text-align: center;
      vertical-align: middle;
    }
    .box-cell-x {
      font-size: 22pt;
      font-weight: 700;
      color: #000;
      line-height: 1;
    }
    .box-cell-scored {
      text-align: center;
      vertical-align: middle;
    }
    .box-score {
      font-size: 12pt;
      font-weight: 700;
      color: #000;
    }

    @page { size: A4 landscape; margin: 0; }
    @media print {
      body { background: #fff; }
      .box-page { min-height: 0; padding: 12mm 14mm 10mm; }
    }
  </style>
</head>
<body>${pagesHTML}</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win2 = window.open(url, '_blank');
  win2.addEventListener('load', () => {
    win2.print();
    URL.revokeObjectURL(url);
  });
}

export function copyPublicLink(league) {
  const slug = league.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const publicUrl = window.location.origin + '/' + slug + '/' + league.public_token;
  navigator.clipboard.writeText(publicUrl).then(function() {
    toast('Public link copied!', 'success');
  }).catch(function() {
    const ta = document.createElement('textarea');
    ta.value = publicUrl;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Public link copied!', 'success');
  });
}

export function openMessagePlayersModal(league) {
  const players = (league.players || []).filter((p) => p.player_email);
  const noEmailPlayers = (league.players || []).filter((p) => !p.player_email);

  modal.open('Message Players', `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
      Sending to <strong>${players.length}</strong> player${players.length !== 1 ? 's' : ''} with an email address on file.
      ${noEmailPlayers.length ? `<span style="color:var(--warning)"> ${noEmailPlayers.length} player${noEmailPlayers.length !== 1 ? 's have' : ' has'} no email and will be skipped.</span>` : ''}
    </p>
    <div class="form-group">
      <label>Subject</label>
      <input class="form-control" id="fMsgSubject" type="text" placeholder="e.g. League night this week">
    </div>
    <div class="form-group">
      <label>Message</label>
      <textarea class="form-control" id="fMsgBody" rows="6" placeholder="Write your message here…" style="resize:vertical"></textarea>
    </div>
    <div class="form-group">
      <label>Attachments <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="form-control" id="fMsgFile" type="file" style="flex:1">
        <button class="btn btn-outline" id="fAddFile" type="button" style="white-space:nowrap;flex-shrink:0">Add</button>
      </div>
      <div id="fAttachmentList" style="margin-top:8px;display:flex;flex-direction:column;gap:6px"></div>
    </div>
    <div id="fMsgError" class="form-error"></div>
    <div class="form-actions">
      <button class="btn btn-outline" id="fCancel">Cancel</button>
      <button class="btn btn-primary" id="fSend">Send Email</button>
    </div>`);

  const attachments = [];

  function renderAttachmentList() {
    const list = document.getElementById('fAttachmentList');
    list.innerHTML = attachments.map((a, i) => `
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg-subtle,#f4f6fb);border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:13px">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.filename)}</span>
        <button class="btn btn-ghost btn-sm" data-remove="${i}" style="flex-shrink:0;margin-left:8px;color:var(--danger,#e74c3c)">Remove</button>
      </div>`).join('');
    list.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        attachments.splice(Number(btn.dataset.remove), 1);
        renderAttachmentList();
      });
    });
  }

  document.getElementById('fAddFile').addEventListener('click', async () => {
    const fileInput = document.getElementById('fMsgFile');
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    attachments.push({ filename: file.name, content: base64 });
    fileInput.value = '';
    renderAttachmentList();
  });

  document.getElementById('fCancel').addEventListener('click', modal.close);
  document.getElementById('fSend').addEventListener('click', async () => {
    const subject = document.getElementById('fMsgSubject').value.trim();
    const body = document.getElementById('fMsgBody').value.trim();
    const errEl = document.getElementById('fMsgError');
    if (!subject) { errEl.textContent = 'Subject is required.'; return; }
    if (!body) { errEl.textContent = 'Message is required.'; return; }
    errEl.textContent = '';
    document.getElementById('fSend').disabled = true;
    document.getElementById('fSend').textContent = 'Sending…';
    try {
      const data = await window.api.messageLeaguePlayers(league.id, { subject, body, attachments });
      modal.close();
      toast(`Email sent to ${data.sent} player${data.sent !== 1 ? 's' : ''}`, 'success');
    } catch (e) {
      errEl.textContent = e.message;
      document.getElementById('fSend').disabled = false;
      document.getElementById('fSend').textContent = 'Send Email';
    }
  });
}

// ===== PRINT SCHEDULE (Modern leagues) =====
export function printSchedule(league) {
  const weeks = league.weeks || [];
  const divisions = (league.divisions || []).slice().sort((a, b) => a.level - b.level);

  // Build player name lookup
  const playerName = {};
  (league.players || []).forEach((p) => { playerName[p.player_id] = p.player_name; });

  const fmtDate = (d) => {
    if (!d) return '';
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const weeksHTML = weeks.map((week) => {
    // Build a map of division_id -> { matches, byes }
    const divData = {};
    divisions.forEach((d) => { divData[d.id] = { name: d.name, matches: [], byes: [] }; });

    (week.matchups || []).forEach((mu) => {
      if (!mu.division_id || !divData[mu.division_id]) return;
      (mu.matches || []).forEach((m) => {
        if (m.skipped) return;
        divData[mu.division_id].matches.push(m);
      });
    });
    (week.byes || []).forEach((b) => {
      if (divData[b.division_id]) divData[b.division_id].byes.push(b.player_name);
    });

    const divsHTML = divisions.map((div) => {
      const { matches, byes } = divData[div.id];
      if (matches.length === 0 && byes.length === 0) return '';

      const matchRows = matches.map((m) => {
        const p1 = m.sub1_name || m.player1_name;
        const p2 = m.sub2_name || m.player2_name;
        const score = (m.player1_score != null && m.player2_score != null)
          ? `<span class="sched-score">${m.player1_score}–${m.player2_score}</span>` : '';
        const courtLabel = m.court_name || (league.schedule_courts && m.court_number ? `Ct ${m.court_number}` : null);
        const court = courtLabel ? `<span class="sched-meta">${esc(courtLabel)}</span>` : '';
        const time = m.match_time ? `<span class="sched-meta">${m.match_time}</span>` : '';
        return `<div class="sched-match">${esc(p1)} <span class="sched-vs">vs</span> ${esc(p2)}${score}${court}${time}</div>`;
      }).join('');

      const byeRow = byes.length
        ? `<div class="sched-bye">Bye: ${byes.map(esc).join(', ')}</div>` : '';

      return `<div class="sched-div">
        <div class="sched-div-name">${esc(div.name)}</div>
        ${matchRows}${byeRow}
      </div>`;
    }).join('');

    if (!divsHTML.trim()) return '';

    return `<div class="sched-week">
      <div class="sched-week-header">
        <span class="sched-week-num">Week ${week.week_number}</span>
        <span class="sched-week-date">${fmtDate(week.date)}</span>
      </div>
      <div class="sched-divs">${divsHTML}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Schedule — ${esc(league.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #000; font-size: 10pt; }

    .page-header { padding: 8mm 12mm 4mm; border-bottom: 2px solid #000; margin-bottom: 6mm; }
    .page-title { font-size: 18pt; font-weight: 800; }
    .page-sub { font-size: 10pt; color: #555; margin-top: 2px; }

    .schedule { padding: 0 12mm 10mm; columns: 2; column-gap: 8mm; }

    .sched-week {
      break-inside: avoid;
      margin-bottom: 6mm;
    }
    .sched-week-header {
      display: flex;
      align-items: baseline;
      gap: 6px;
      border-bottom: 1.5px solid #000;
      padding-bottom: 2px;
      margin-bottom: 3px;
    }
    .sched-week-num { font-size: 11pt; font-weight: 800; }
    .sched-week-date { font-size: 9pt; color: #555; }

    .sched-divs { padding-left: 2mm; }
    .sched-div { margin-bottom: 9px; }
    .sched-div-name { font-size: 8.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #222; margin-bottom: 4px; }

    .sched-match { font-size: 9.5pt; padding: 4px 0; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; border-bottom: 0.5px solid #eee; }
    .sched-match:last-of-type { border-bottom: none; }
    .sched-vs { color: #888; font-size: 8.5pt; }
    .sched-score { font-weight: 700; font-size: 9pt; margin-left: 2px; }
    .sched-meta { font-size: 8pt; color: #777; }
    .sched-bye { font-size: 8.5pt; color: #777; font-style: italic; padding: 4px 0 1px; }

    @page { size: A4 portrait; margin: 14mm 12mm; }
    @media print {
      body { background: #fff; }
      .page-header { padding: 0 0 4mm; }
      .schedule { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="page-header">
    <div class="page-title">${esc(league.name)}</div>
    <div class="page-sub">Schedule</div>
  </div>
  <div class="schedule">${weeksHTML}</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win2 = window.open(url, '_blank');
  win2.addEventListener('load', () => { win2.print(); URL.revokeObjectURL(url); });
}
