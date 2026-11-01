/*
 * Spec 097 FR-186 (T142): the limits of `check-office-ops.js` and the judge that applies them, apart from the driver so that a unit test (test-office-ops.ts)
 * can show the judge fails where it must. No Electron here.
 *
 * Every limit is a count. `LIMITS['row@n']` overrides `LIMITS.row`; `MINIMUMS` are counts a row must reach (a row below its minimum fails). Budgets marked
 * PROPOSED in spec 097 (the layout reads, the animation counts, the start counts) are proposals until the owner answers; they are asserted here as regression
 * guards at the measured floors, not as decisions.
 */
const LIMITS = {
  elementsRecalculated: 50, // T148, FR-185
  rendersPerStatus: 1, // T159, FR-184
  searchesPerStatus: 0, // a status change of one agent runs no layout search
  floorStyleReadsPerStatus: 1, // T159: `getComputedStyle(#floor)` once per render (it was twice)
  readsPerStatus: 110, // T156, PROPOSED: measured 98 at 15 agents and 86 at 40 (650 and 998 before); the floor is the checks a status change needs
  searchesAtStart: 2, // T157: measured 2 at 15 agents, 1 to 2 at 40
  probesAtStart: 90, // T157: measured 30 at 15, 47 to 85 at 40
  rendersAtStart: 8,
  animationsRunning: 90, // T158: measured 78 at 15 agents
  'animationsRunning@40': 260, // measured 250
  animatedOtherProperties: 0, // FR-180: only transform and opacity animate
  leakedPlaced: 0, // a `data-placed` mark on anything but a role or a pencil
  staleFits: 0, // header and usage-line classes that a full fit would change, after a status filter and after Simple to Expert
};
const MINIMUMS = {
  handPositions: 2, // T158: a compact desk's tapping hand shows at least two positions over its cycle (it is alive)
};
/* A row over its limit today: `{ task, max }` names the open task that fixes it and the most it may reach meanwhile. The task's PR deletes the entry. */
const KNOWN_FAILURES = {
  'animatedOtherProperties@15': { task: 'T158', max: 13 }, // the 13 halos animate fill-opacity; opacity would be on the compositor, but is the thing #554 turned down: needs a real-GPU look
  'animatedOtherProperties@40': { task: 'T158', max: 40 },
};

const rowOf = (key) => key.split('@')[0];
const limitOf = (key, limits = LIMITS) => (key in limits ? limits[key] : limits[rowOf(key)]);
const minimumOf = (key, minimums = MINIMUMS) => (key in minimums ? minimums[key] : minimums[rowOf(key)]);

/** `rows`: { 'row@n': number }. Returns { failed: string[], notes: string[] }; a row with neither a limit nor a minimum fails (it would assert nothing). */
function judge(rows, limits = LIMITS, known = KNOWN_FAILURES, minimums = MINIMUMS) {
  const failed = [], notes = [];
  for (const [key, value] of Object.entries(rows)) {
    const limit = limitOf(key, limits), minimum = minimumOf(key, minimums), k = known[key];
    if (typeof value !== 'number' || Number.isNaN(value)) { failed.push(`${key} = ${value} is not a count`); continue; }
    if (limit === undefined && minimum === undefined) { failed.push(`${key} has no limit and no minimum: it asserts nothing`); continue; }
    if (minimum !== undefined) {
      if (value < minimum) {
        if (k && value >= (k.min === undefined ? -Infinity : k.min)) notes.push(`${key} = ${value} under ${minimum} (known failure, ${k.task})`);
        else failed.push(`${key} = ${value}, minimum ${minimum}`);
      }
      continue;
    }
    if (value > limit) {
      if (k && value <= k.max) notes.push(`${key} = ${value} over ${limit} (known failure, ${k.task}; may not pass ${k.max})`);
      else failed.push(`${key} = ${value}, limit ${k ? k.max : limit}`);
    } else if (k) failed.push(`${key} = ${value} is within its limit ${limit}: delete its KNOWN_FAILURES entry (${k.task})`);
  }
  return { failed, notes };
}

module.exports = { LIMITS, MINIMUMS, KNOWN_FAILURES, judge, limitOf };
