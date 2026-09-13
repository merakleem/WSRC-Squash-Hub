// ===== MEMO =====
// Remembers the result of an expensive read for as long as the database has
// not changed. The ladder is derived by replaying every match ever played,
// and the activity feed asks for it once per day in its window; at club
// scale that is fine today and it is the first thing that will not be.
//
// The key to "has not changed" is db.writeStamp(): any write through this
// connection, any commit from another one, or a reopened connection gives a
// new stamp, and a new stamp empties the whole cache. Coarse - a booking
// invalidates the ladder - but nothing stale can ever be served, and reads
// vastly outnumber writes here.

const { writeStamp } = require('../database/db');

const cache = new Map();
let stampSeen = null;
let hits = 0;
let misses = 0;

/**
 * memo('elo:2026:', () => computeSomething()) - the key must name every input
 * of `fn` that is not the database itself. The value is cloned on the way out
 * so a caller cannot change what the next caller gets.
 */
function memo(key, fn) {
  const stamp = writeStamp();
  if (stamp !== stampSeen) {
    cache.clear();
    stampSeen = stamp;
  }
  if (cache.has(key)) {
    hits++;
    return structuredClone(cache.get(key));
  }
  misses++;
  const value = fn();
  cache.set(key, value);
  return structuredClone(value);
}

function stats() {
  return { entries: cache.size, hits, misses };
}

function clear() {
  cache.clear();
  stampSeen = null;
}

module.exports = { memo, stats, clear };
