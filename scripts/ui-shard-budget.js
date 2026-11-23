/*
 * Spec 008 delta 2026-11-23 (issue 2070, review of PR 2071): the ONE estimate of a macOS UI shard job of ui-platforms.yml. The macOS job limit
 * is derived from it (`macosLimitMin`) and the guards check against it (`macosBudget`: test:uisuite, test:electroncache), so the limit and the
 * guard cannot drift apart. Every term is measured on the six scheduled runs of 2026-11-18..23 (the spec 008 delta has the table):
 *
 *   job = (shard 1's head start + sum of driver weights x MAC_VS_TIMINGS) x SLOW_NIGHT + drivers x GAP_PER_DRIVER_SECS + JOB_FIXED_SECS
 *   need = job + npm ci's retry budget (the waits of .github/actions/npm-ci plus FAILED_TRY_SECS per try), allowed = limit x (1 - MARGIN)
 *
 * A driver's weight is its timing entry (label, then name: scripts/ui-suite.js); a driver with none weighs the heavier of the mean and the 75th
 * percentile of the timed ones (the split itself uses the median; this estimate errs on the heavy side). Pure: no I/O but the timing file default.
 */
const { shard, DRIVERS, SHARD1_HEAD_START_SECS } = require('./ui-suite');

/** macOS runs a driver in 0.90 of its Linux time and 0.94 of its Windows time (the timing file is their mean): the heavier, 0.94. */
const MAC_VS_TIMINGS = 0.94;
/** The slowest of the six runs, per driver, over the median: 1.10. */
const SLOW_NIGHT = 1.1;
/** Seconds between one driver's result line and the next driver's start: measured at most 0.13 s per driver; 1 s. */
const GAP_PER_DRIVER_SECS = 1;
/** Checkout, npm ci with the Electron cache hit and build (at most 56 s), theme geometry (at most 93 s), screenshot upload (at most 20 s). */
const JOB_FIXED_SECS = 170;
/** One failed npm ci try before each retry wait (test:electroncache's rule: 1.5 min). */
const FAILED_TRY_SECS = 90;
/** Room left under the limit after all of the above. */
const MARGIN = 0.05;

/** npm ci's worst case: every retry wait plus one failed try before each. */
const npmCiRetrySecs = (waits) => waits.reduce((a, b) => a + b, 0) + waits.length * FAILED_TRY_SECS;

/**
 * The `default:` of the `retry-waits` input in the text of .github/actions/npm-ci/action.yml, as numbers: `{ waits, steps }`, `steps` being the
 * lines looked at (linear in the text: one look per line, anchored patterns with no nested quantifier; review round 2 of PR 2071 found an
 * exponential regex here). Fails closed: no `  retry-waits:` line, or its block ends without a `    default: '<numbers>'` line, throws (the
 * error carries `steps` too); it never guesses.
 */
function parseRetryWaits(actionText) {
  const lines = String(actionText).split(/\r?\n/);
  let steps = 0, inBlock = false;
  const fail = (why) => { const e = new Error(`ui-shard-budget: ${why} in the npm-ci action`); e.steps = steps; throw e; };
  for (const line of lines) {
    steps++;
    if (!inBlock) { if (/^ {2}retry-waits:\s*$/.test(line)) inBlock = true; continue; }
    const m = /^ {4}default: '(\d+(?: \d+)*)'\s*$/.exec(line);
    if (m) return { waits: m[1].split(' ').map(Number), steps };
    if (line.trim() !== '' && !/^ {4}/.test(line)) break; // the input's block ended
  }
  return fail(inBlock ? 'retry-waits has no default line' : 'no retry-waits input');
}
const actionRetryWaits = (actionText) => parseRetryWaits(actionText).waits;

/** The weight of a driver with no timing entry: max(mean, 75th percentile) of the timed entries. */
function untimedWeight(times) {
  const v = Object.entries(times).filter(([k, x]) => !k.startsWith('_') && Number.isFinite(x)).map(([, x]) => x).sort((a, b) => a - b);
  if (!v.length) return 0;
  return Math.max(v.reduce((a, b) => a + b, 0) / v.length, v[Math.floor(v.length * 0.75)]);
}

/** Estimated seconds of each macOS shard job (shard i of n, as ui-suite.js splits it on darwin). */
function macosShardSecs({ n, times, drivers = DRIVERS }) {
  const none = untimedWeight(times);
  const w = (d) => { const v = [times[d.label], times[d.name]].find(Number.isFinite); return v === undefined ? none : v; };
  return Array.from({ length: n }, (_, k) => {
    const part = shard(drivers, `${k + 1}/${n}`, times, 'darwin');
    const work = part.reduce((a, d) => a + w(d), 0) * MAC_VS_TIMINGS + (k === 0 && n > 1 ? SHARD1_HEAD_START_SECS.darwin : 0);
    return Math.round(work * SLOW_NIGHT + part.length * GAP_PER_DRIVER_SECS + JOB_FIXED_SECS);
  });
}

/** The check: the slowest shard plus npm ci's retries must fit in the limit less the margin. */
function macosBudget({ n, times, limitMin, retrySecs, drivers = DRIVERS }) {
  const shards = macosShardSecs({ n, times, drivers });
  const worst = Math.max(...shards), need = worst + retrySecs, allowed = Math.floor(limitMin * 60 * (1 - MARGIN));
  return { shards, worst, need, allowed, ok: need <= allowed };
}

/** The limit the estimate asks for: the need over (1 - margin), rounded up to whole 5 minutes. */
const macosLimitMin = ({ n, times, retrySecs, drivers = DRIVERS }) => {
  const { need } = macosBudget({ n, times, limitMin: 1, retrySecs, drivers });
  return Math.ceil(need / (1 - MARGIN) / 60 / 5) * 5;
};

/** Coordinator decision 2026-11-23 (review round 2 of PR 2071): the workflow's macOS limit may sit up to LIMIT_SLACK_MIN above what the
 *  estimate asks for, never below; above CAP_MIN the answer is another macOS shard, not a longer job; under WARN_HEADROOM_SECS of room a
 *  warning (not a failure) tells the next author it is coming. */
const LIMIT_SLACK_MIN = 5;
const CAP_MIN = 80;
const WARN_HEADROOM_SECS = 120;

/** { ask, need, allowed, headroom, problems: string[], warning: string } for the workflow's macOS limit `limitMin`. */
function macosLimitCheck({ n, times, limitMin, retrySecs, drivers = DRIVERS }) {
  const ask = macosLimitMin({ n, times, retrySecs, drivers });
  const b = macosBudget({ n, times, limitMin, retrySecs, drivers });
  const headroom = b.allowed - b.need;
  const problems = [];
  if (ask > CAP_MIN) problems.push(`the macOS UI shards would need ${ask} minutes, above the ${CAP_MIN}-minute cap: add a macOS shard (shard list and UI_SUITE_SHARD in ui-platforms.yml)`);
  if (limitMin < ask) problems.push(`the macOS limit ${limitMin} is below the ${ask} minutes the estimate asks for (slowest shard ${b.worst} s + ${retrySecs} s npm ci = ${b.need} s): raise it to ${ask} or add a macOS shard`);
  if (limitMin > ask + LIMIT_SLACK_MIN) problems.push(`the macOS limit ${limitMin} is more than ${LIMIT_SLACK_MIN} minutes above the ${ask} the estimate asks for: lower it`);
  const warning = headroom < WARN_HEADROOM_SECS ? `warning: only ${headroom} s of room under the ${limitMin}-minute macOS limit (need ${b.need} s, allowed ${b.allowed} s): the next drivers will need a longer limit or another macOS shard` : '';
  return { ask, need: b.need, allowed: b.allowed, headroom, worst: b.worst, shards: b.shards, problems, warning };
}

module.exports = { MAC_VS_TIMINGS, SLOW_NIGHT, GAP_PER_DRIVER_SECS, JOB_FIXED_SECS, FAILED_TRY_SECS, MARGIN, LIMIT_SLACK_MIN, CAP_MIN, WARN_HEADROOM_SECS, npmCiRetrySecs, parseRetryWaits, actionRetryWaits, untimedWeight, macosShardSecs, macosBudget, macosLimitMin, macosLimitCheck };
