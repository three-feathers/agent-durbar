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
  readsPerLivePaint: 1, // review of #1138: one live paint reads its line's height once (measured 1 at 15 and 40 agents); the pencils' names only when it changed
  searchesAtStart: 1, // T157, FR-363: owner decision 2026-11-11 (issue #1238): one layout search at start (the simulator gate)
  /* the two @late rows equal `searchesAtStart` and are kept only to document that the forced-late loads (which fail every time without the gate) are held to the same one search */
  'searchesAtStart@late15': 1, // T303, FR-363: the replay's first states arrive 50 ms late (`simlate=50`): still one search
  'searchesAtStart@late40': 1,
  'probesAtStart@15': 20, // T157, owner decision 2026-11-11: measured 18
  'probesAtStart@40': 50, // measured 47
  rendersAtStart: 8,
  animationsRunning: 90, // T158: measured 78 at 15 agents
  'animationsRunning@40': 260, // measured 250
  animatedOtherProperties: 0, // FR-180: only transform and opacity animate
  tintNodesPerStatus: 0, // spec 097 FR-244 (T190): tinting or clearing a screen (FR-236) adds or removes no screen or New reply tag
  statusNodes: 0, // spec 102 T262 (FR-229): in a world (the arcade) a status update adds or removes no element under the office
  leakedPlaced: 0, // a `data-placed` mark on anything but a role or a pencil
  staleFits: 0, // header and usage-line classes that a full fit would change, after a status filter and a body-class change
};
const MINIMUMS = {
  'lateReplayDelay@late15': 50, // T303: `simlate=50` was honoured: the replay waited at least 50 ms (an ignored option reads 0 and the forced-late row would test nothing)
  'lateReplayDelay@late40': 50,
  handPositions: 2, // T158: a compact desk's tapping hand shows at least two positions over its cycle (it is alive)
};
/* A row over its limit today: `{ task, max }` names the open task that fixes it and the most it may reach meanwhile. The task's PR deletes the entry. */
const KNOWN_FAILURES = {}; // none now: the halo no longer animates (spec 001 FR-210), so the animations that animated fill-opacity (13 at 15 agents) are gone

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
