// Shared ranking helper used by tournaments route (results endpoint)
// and players route (player history endpoint).
function buildTournamentTiers(t) {
  const nameMap = {};
  for (const p of t.players) nameMap[p.player_id] = p.player_name;
  for (const m of t.matches) {
    if (m.player1_id && !nameMap[m.player1_id]) nameMap[m.player1_id] = m.p1_name;
    if (m.player2_id && !nameMap[m.player2_id]) nameMap[m.player2_id] = m.p2_name;
  }
  const bracketMatches = {};
  for (const m of t.matches) { if (m.bracket_slot) bracketMatches[m.bracket_slot] = m; }

  const mWinner = (m) => m?.winner_id || null;
  const mLoser  = (m) => {
    if (!m?.winner_id) return null;
    return m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
  };

  const placedIds = new Set();
  const tiers = [];

  function addBracketTier(position, ids) {
    const valid = ids.filter(Boolean);
    if (!valid.length) return;
    tiers.push({ position, players: valid.map((id) => ({ id, name: nameMap[id] || null })) });
    valid.forEach((id) => placedIds.add(id));
  }

  addBracketTier('1st',     [mWinner(bracketMatches['F'])]);
  addBracketTier('2nd',     [mLoser(bracketMatches['F'])]);
  addBracketTier('3rd–4th', [mLoser(bracketMatches['SF1']), mLoser(bracketMatches['SF2'])]);
  addBracketTier('5th–8th', ['QF1', 'QF2', 'QF3', 'QF4'].map((s) => mLoser(bracketMatches[s])));

  const allIds = new Set([...t.players.map((p) => p.player_id), ...Object.keys(nameMap).map(Number)]);
  const remaining = [...allIds].filter((id) => !placedIds.has(id));
  const rec = {};
  for (const id of remaining) rec[id] = { wins: 0, losses: 0, sd: 0 };

  for (const m of t.matches) {
    if (m.round !== 'group' || !m.winner_id) continue;
    let sc = null;
    try { sc = m.scores ? JSON.parse(m.scores) : null; } catch (_) {}
    const p1s = sc?.p1 || 0, p2s = sc?.p2 || 0;
    if (rec[m.player1_id] !== undefined) {
      rec[m.player1_id].sd += p1s - p2s;
      if (m.winner_id === m.player1_id) rec[m.player1_id].wins++; else rec[m.player1_id].losses++;
    }
    if (rec[m.player2_id] !== undefined) {
      rec[m.player2_id].sd += p2s - p1s;
      if (m.winner_id === m.player2_id) rec[m.player2_id].wins++; else rec[m.player2_id].losses++;
    }
  }

  remaining.sort((a, b) => rec[b].wins - rec[a].wins || rec[b].sd - rec[a].sd);

  function ord(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  let pos = tiers.reduce((sum, tier) => sum + tier.players.length, 0) + 1;
  let i = 0;
  while (i < remaining.length) {
    const curr = rec[remaining[i]];
    let j = i + 1;
    while (j < remaining.length && rec[remaining[j]].wins === curr.wins && rec[remaining[j]].sd === curr.sd) j++;
    const group = remaining.slice(i, j);
    const end = pos + group.length - 1;
    tiers.push({
      position: pos === end ? ord(pos) : `${ord(pos)}–${ord(end)}`,
      players: group.map((id) => ({ id, name: nameMap[id] || null })),
    });
    pos += group.length;
    i = j;
  }

  return tiers;
}

module.exports = { buildTournamentTiers };
