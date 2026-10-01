// Finishing positions in a knockout, for the player profile: the champion,
// the runner-up, then everyone knocked out in the same round sharing a band
// ("3rd–4th", "5th–8th", "9th–16th"). Read from the shared bracket.
const { bracketOf } = require('../models/tournamentModel');
const K = require('../renderer/knockout.js');

function _ord(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** `t` is a tournament as getTournament returns it. */
function buildTournamentTiers(t) {
  const b = bracketOf(t);
  if (!b) return [];
  const tiers = [];
  const tier = (position, players) => {
    const list = players.filter(Boolean);
    if (list.length) tiers.push({ position, players: list.map((p) => ({ id: p.id, name: p.name })) });
  };
  tier('1st', [b.champion]);
  tier('2nd', [b.champion ? K.loserOf(b.final) : null]);
  // Losers of each earlier round, latest round first: a semifinal loser is
  // joint 3rd, a quarterfinal loser joint 5th, and so on.
  for (let r = b.R - 2; r >= 0; r--) {
    const from = (b.draw >> (r + 1)) + 1;
    const to = b.draw >> r;
    tier(`${_ord(from)}–${_ord(to)}`, b.rounds[r].map((m) => K.loserOf(m)));
  }
  return tiers;
}

module.exports = { buildTournamentTiers };
