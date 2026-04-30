const express = require('express');
const { getDB } = require('../database/db');
const leagueService = require('../services/leagueService');

const router = express.Router();

// ===== PUBLIC LEAGUE PAGE =====

router.get('/:slug/:token', (req, res, next) => {
  if (!/^[0-9a-f]{4}$/i.test(req.params.token)) return next();
  res.send(buildPublicPage());
});

router.get('/api/public/league/:token', async (req, res) => {
  try {
    const db = getDB();
    const row = db.prepare('SELECT id FROM leagues WHERE public_token = ?').get(req.params.token);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const league = await leagueService.getFullLeague(row.id);
    if (!league) return res.status(404).json({ error: 'Not found' });
    res.json(league);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildPublicPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>League Schedule — Play WSRC</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="icon" type="image/png" href="/assets/logo-blue.png">
  <style>
    :root { --primary:#1e2758; --accent:#3a4db5; --border:#e2e8f0; --muted:#64748b; --bg:#f4f6fb; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:var(--bg); color:#1e293b; font-size:15px; line-height:1.5; }
    h1,h2,h3,h4,.header-title,.card-title { font-family:'Barlow',-apple-system,BlinkMacSystemFont,sans-serif; }

    .header { background:var(--primary); color:#fff; padding:28px 20px 24px; }
    .header-brand { display:flex; align-items:center; gap:8px; margin-bottom:14px; opacity:0.65; }
    .header-brand img { width:20px; height:20px; object-fit:contain; }
    .header-brand-text { font-size:12px; font-weight:500; letter-spacing:0.03em; }
    .header-title { font-size:28px; font-weight:800; line-height:1.15; }

    .content { max-width:660px; margin:0 auto; padding:28px 16px calc(56px + env(safe-area-inset-bottom)); }
    .section { margin-bottom:36px; }
    .section-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:12px; padding-left:2px; }

    .card { background:#fff; border-radius:12px; border:1px solid var(--border); margin-bottom:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.04); }
    .card-header { display:flex; justify-content:space-between; align-items:center; padding:16px 18px; cursor:pointer; user-select:none; gap:12px; }
    .card-header:active { background:#f8fafc; }
    .card-title { font-weight:700; font-size:15px; }
    .card-sub { font-size:13px; color:var(--muted); margin-top:2px; }
    .card-toggle { font-size:22px; font-weight:300; color:#94a3b8; line-height:1; flex-shrink:0; transition:transform 0.2s; }
    .card.open .card-toggle { transform:rotate(45deg); }
    .card-body { display:none; border-top:1px solid var(--border); }
    .card.open .card-body { display:block; }

    .roster-row { display:flex; align-items:center; gap:10px; padding:12px 18px; border-bottom:1px solid #f1f5f9; font-size:14px; }
    .roster-row:last-child { border-bottom:none; }
    .div-chip { font-size:10px; font-weight:700; background:var(--primary); color:#fff; border-radius:4px; padding:2px 7px; white-space:nowrap; flex-shrink:0; }

    .matchup-block { padding:16px 18px; border-bottom:1px solid var(--border); }
    .matchup-block:last-child { border-bottom:none; }
    .matchup-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); margin-bottom:10px; }

    .match-row { display:grid; grid-template-columns:auto 1fr auto; align-items:center; column-gap:12px; padding:9px 0; border-bottom:1px solid #f8fafc; font-size:14px; }
    .match-row:last-child { border-bottom:none; }
    .match-div { font-size:10px; font-weight:700; background:var(--accent); color:#fff; border-radius:4px; padding:2px 7px; white-space:nowrap; }
    .match-players { font-weight:500; }
    .match-vs { color:#94a3b8; font-size:12px; margin:0 4px; font-weight:400; }
    .match-win { color:var(--accent); font-weight:700; }
    .match-right { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
    .match-score { font-weight:700; font-size:14px; white-space:nowrap; }
    .match-meta { font-size:11px; color:var(--muted); white-space:nowrap; }
    .bye-label { font-size:13px; color:var(--muted); font-style:italic; padding:14px 18px; }

    .loading { text-align:center; padding:80px 16px; color:var(--muted); font-size:15px; }
    .error-msg { text-align:center; padding:80px 16px; color:#ef4444; }

    @media(max-width:480px) {
      .header { padding:22px 16px 20px; }
      .header-title { font-size:23px; }
      .content { padding:20px 12px 48px; }
      .card-header { padding:14px 14px; }
      .matchup-block { padding:14px 14px; }
      .roster-row { padding:11px 14px; }
      .match-row { column-gap:8px; }
    }
  </style>
</head>
<body>
  <div id="root"><div class="loading">Loading schedule…</div></div>
  <script>
    var parts = location.pathname.split('/').filter(Boolean);
    var token = parts[parts.length - 1] || '';
    fetch('/api/public/league/' + token)
      .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(render)
      .catch(function() {
        document.getElementById('root').innerHTML = '<div class="error-msg">League not found.</div>';
      });

    function toggleCard(el) {
      el.closest('.card').classList.toggle('open');
    }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function fmtDate(d) {
      if (!d) return '';
      var p = d.split('-').map(Number);
      return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
    }

    function fmtTime(t) {
      if (!t) return '';
      var p = t.split(':').map(Number);
      return (p[0]%12||12)+':'+(p[1]<10?'0':'')+p[1]+(p[0]>=12?'pm':'am');
    }

    function render(league) {
      var isModern = league.setup_type === 'modern';
      var playerDiv = {};
      (league.players||[]).forEach(function(p) {
        playerDiv[p.player_id] = { name: p.division_name, level: p.division_level };
      });

      var rostersHTML;
      if (isModern) {
        rostersHTML = (league.divisions||[]).map(function(div) {
          var members = (league.players||[])
            .filter(function(p){ return p.division_id === div.id; })
            .sort(function(a,b){ return a.skill_rank - b.skill_rank; });
          var rows = members.map(function(m) {
            return '<div class="roster-row"><span>'+esc(m.player_name)+'</span></div>';
          }).join('');
          return '<div class="card">'
            +'<div class="card-header" onclick="toggleCard(this)">'
            +'<div class="card-title">'+esc(div.name)+'</div>'
            +'<span class="card-toggle">+</span>'
            +'</div>'
            +'<div class="card-body">'+rows+'</div>'
            +'</div>';
        }).join('');
      } else {
        rostersHTML = (league.teams||[]).map(function(team) {
          var members = (league.players||[])
            .filter(function(p){ return p.team_id === team.id; })
            .sort(function(a,b){ return a.division_level - b.division_level; });
          var rows = members.map(function(m) {
            return '<div class="roster-row">'
              +'<span class="div-chip">'+esc(m.division_name.replace(/^Division\\s*/i,'D'))+'</span>'
              +'<span>'+esc(m.player_name)+'</span>'
              +'</div>';
          }).join('');
          return '<div class="card">'
            +'<div class="card-header" onclick="toggleCard(this)">'
            +'<div class="card-title">'+esc(team.name)+'</div>'
            +'<span class="card-toggle">+</span>'
            +'</div>'
            +'<div class="card-body">'+rows+'</div>'
            +'</div>';
        }).join('');
      }

      var scheduleHTML = (league.weeks||[]).map(function(week) {
        var muHTML = week.matchups.map(function(mu) {
          if (!isModern && mu.bye_team_id) {
            return '<div class="bye-label">'+esc(mu.bye_team_name)+' — Bye week</div>';
          }
          var matchesHTML = (mu.matches||[]).map(function(m) {
            var div = playerDiv[m.player1_id] || {};
            var p1 = m.sub1_name || m.player1_name;
            var p2 = m.sub2_name || m.player2_name;
            var p1win = m.winner_id && m.winner_id === m.player1_id;
            var p2win = m.winner_id && m.winner_id === m.player2_id;
            var hasScore = m.player1_score != null && m.player2_score != null;
            var scoreHTML = hasScore ? '<div class="match-score">'+m.player1_score+'&ndash;'+m.player2_score+'</div>' : '';
            var meta = '';
            if (league.schedule_courts && m.court_number) {
              meta = 'Court '+m.court_number+(m.match_time ? ' &middot; '+fmtTime(m.match_time) : '');
            } else if (m.match_time) {
              meta = fmtTime(m.match_time);
            }
            return '<div class="match-row">'
              +(!isModern ? '<span class="match-div">'+esc((div.name||'').replace(/^Division\\s*/i,'D'))+'</span>' : '')
              +'<div class="match-players">'
              +'<span class="'+(p1win?'match-win':'')+'">'+esc(p1)+'</span>'
              +' <span class="match-vs">vs</span> '
              +'<span class="'+(p2win?'match-win':'')+'">'+esc(p2)+'</span>'
              +'</div>'
              +'<div class="match-right">'
              +scoreHTML
              +(meta ? '<div class="match-meta">'+meta+'</div>' : '')
              +'</div>'
              +'</div>';
          }).join('');
          var muTitle = isModern
            ? esc(mu.division_name||'')
            : esc(mu.team1_name)+' vs '+esc(mu.team2_name);
          var byesHTML = '';
          if (isModern) {
            var divByes = (week.byes||[]).filter(function(b){ return b.division_id === mu.division_id; });
            if (divByes.length) {
              byesHTML = '<div class="bye-label" style="font-size:12px;padding:6px 0 2px">Bye: '
                +divByes.map(function(b){ return esc(b.player_name); }).join(', ')+'</div>';
            }
          }
          return '<div class="matchup-block">'
            +'<div class="matchup-title">'+muTitle+'</div>'
            +matchesHTML
            +byesHTML
            +'</div>';
        }).join('');
        return '<div class="card">'
          +'<div class="card-header" onclick="toggleCard(this)">'
          +'<div>'
          +'<div class="card-title">Week '+week.week_number+'</div>'
          +'<div class="card-sub">'+fmtDate(week.date)+'</div>'
          +'</div>'
          +'<span class="card-toggle">+</span>'
          +'</div>'
          +'<div class="card-body">'+muHTML+'</div>'
          +'</div>';
      }).join('');

      document.getElementById('root').innerHTML =
        '<div class="header">'
        +'<div class="header-brand"><img src="/assets/WSRC_Logo_Grey%203.png" alt="WSRC"><span class="header-brand-text">Play WSRC</span></div>'
        +'<div class="header-title">'+esc(league.name)+'</div>'
        +'</div>'
        +'<div class="content">'
        +'<div class="section"><div class="section-label">Rosters</div>'+rostersHTML+'</div>'
        +'<div class="section"><div class="section-label">Schedule</div>'+scheduleHTML+'</div>'
        +'</div>';
    }
  </script>
</body>
</html>`;
}

module.exports = router;
