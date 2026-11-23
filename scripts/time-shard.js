/*
 * One greedy split by recorded time, shared by the UI suite (`ui-suite.js --shard i/n`, spec 008 FR-182, FR-183) and `npm test`
 * (`run-tests.js --shard i/n`, spec 117 FR-018): items from the slowest down, each to the part with the least time so far (ties: the lower
 * part, then the list order); every part keeps the list order. The n parts are disjoint and together hold every item; the result depends
 * only on the list, the weights and the head starts, so every job of a CI run computes the same parts.
 */

/** `i/n` (1-based) to { i, n }; throws `${who}: --shard wants i/n with 1 <= i <= n, got "<spec>"` on anything else. */
function parseShardSpec(spec, who) {
  const m = String(spec).match(/^(\d+)\/(\d+)$/);
  const i = m ? Number(m[1]) : 0, n = m ? Number(m[2]) : 0;
  if (!m || n < 1 || i < 1 || i > n) throw new Error(`${who}: --shard wants i/n with 1 <= i <= n, got "${spec}"`);
  return { i, n };
}

/** The median of a `{ name: seconds }` table (keys starting with `_` are notes); `fallback` when it has no number. */
function medianOf(times, fallback = 1) {
  const known = Object.entries(times || {}).filter(([k, v]) => !k.startsWith('_') && Number.isFinite(v)).map(([, v]) => v).sort((x, y) => x - y);
  return known.length ? known[Math.floor(known.length / 2)] : fallback;
}

/** Every part of `list` split `n` ways: an array of n arrays, each in list order. `weight(item)` is its recorded seconds; `headStart[k]` the
 *  seconds part k (0-based) is assumed to have before any item (work that job does besides the items). */
function timeParts(list, n, weight, headStart = []) {
  const load = Array.from({ length: n }, (_, k) => Number(headStart[k]) || 0);
  const owner = new Map();
  list.map((d, k) => ({ d, k })).sort((x, y) => weight(y.d) - weight(x.d) || x.k - y.k).forEach(({ d }) => {
    let best = 0;
    for (let b = 1; b < n; b++) if (load[b] < load[best]) best = b;
    load[best] += weight(d);
    owner.set(d, best);
  });
  return Array.from({ length: n }, (_, k) => list.filter((d) => owner.get(d) === k));
}

module.exports = { parseShardSpec, medianOf, timeParts };
