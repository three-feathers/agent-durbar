/** The timing helpers of the redact suites (spec 041 T068, #684; moved here by spec 012 T137). */
import * as assert from 'assert';
import { Worker } from 'worker_threads';

// CPU time of f in ms (user + system of this process), not wall time: it does not grow when other processes take the CPU, so the
// timing checks below hold on a loaded machine or runner (spec 041 `## Changes` 2026-10-22, T068). It still counts every step the
// masking takes, so super-linear (ReDoS-style) growth fails as before. CPU time does not see a blocking wait (Atomics.wait, a sync
// sleep, execSync, sync I/O), so wall time gets a loose backstop of 10x the check's CPU limit `capMs`: load cannot reach it, a long
// wait does. A wait shorter than that still passes (the accepted limit; spec 041 `## Changes` 2026-10-22, review of PR #527).
export const cpuMs = (f: () => void, capMs: number): number => {
  const w = process.hrtime.bigint();
  const c = process.cpuUsage();
  f();
  const d = process.cpuUsage(c);
  const cpu = (d.user + d.system) / 1000;
  const wall = Number(process.hrtime.bigint() - w) / 1e6;
  assert.ok(wall < 10 * capMs, `wall-time backstop: ${wall.toFixed(1)} ms wall for ${cpu.toFixed(1)} ms CPU, limit ${10 * capMs} ms (a blocking wait in the timed code?)`);
  return cpu;
};

// Adversarial cases (sections 9 and 14e R12): no fixed millisecond limit, because a loaded machine pushes a linear rule past any one (#684, like
// #657 and #668). Each case runs on the full input and, in the same run, on a baseline of the same shape (1/16 of it: the shapes repeat, so a
// prefix has the same shape); the best CPU time of up to 3 tries each is compared. For 16x the input, linear growth is a ratio of about 16
// (13-20 seen on this code, also under load), n log n about 30, n^1.5 about 64, quadratic about 256 (65-88 measured, because of the floor
// and the fixed costs). The limit is 40: growth up to about n log n passes, n^1.5 and quadratic fail, with at least 60% between the limit and
// the nearest failing mutant (a 4x factor with a limit of 12 left only 5-12% and linear code under load reached 8.6 of it). The floor
// (`floorMs`) is far above timer steps and CI load but still under what a quadratic rule costs on these inputs. Two backstops for
// catastrophic slowness only: 10 s of CPU and 10 s of wall time (the original wall limit of section 9; a blocking wait in the timed code
// shows there, CPU time does not see it). A try that passes stops the loop, so the common case costs one pair of runs. `run` times one input
// in a worker and gives its CPU and wall time in ms.
const FACTOR = 16;
const MAX_RATIO = 40;
// CPU timers tick in about 15.6 ms on Windows (as in test-browserurl), so a fast 1/16 baseline can read 0: never divide by less than one tick there
const MIN_BASE_MS = process.platform === 'win32' ? 16 : 2;
export const worstGrowth = { ratio: 0, label: '' }; // the highest full/baseline ratio seen, printed at the end
// `reps` (default 1, so the other callers are unchanged): the baseline is timed as `run(small, reps)`, and `run` must then repeat the work `reps`
// times inside one timing and give the mean per run, so a baseline of a few ms is read well above the Windows timer tick (a tick-sized baseline
// caps the ratio near 15 and hides a quadratic rule that stays under the floor).
export const assertLinearGrowth = (label: string, run: (input: string, reps?: number) => { cpu: number; wall: number }, input: string, floorMs = 100, reps = 1): void => {
  const small = input.slice(0, Math.ceil(input.length / FACTOR));
  let full = Infinity;
  let base = Infinity;
  let wall = 0;
  for (let i = 0; i < 3; i++) {
    const f = run(input);
    wall = Math.max(wall, f.wall);
    full = Math.min(full, f.cpu);
    base = Math.min(base, run(small, reps).cpu);
    if (full < Math.max(floorMs, Math.max(base, MIN_BASE_MS) * MAX_RATIO)) break;
  }
  if (full / Math.max(base, MIN_BASE_MS) > worstGrowth.ratio && full >= floorMs) Object.assign(worstGrowth, { ratio: full / Math.max(base, MIN_BASE_MS), label });
  assert.ok(full < 10_000, `${label}: ${full.toFixed(1)} ms CPU, backstop 10000 ms (catastrophic)`);
  assert.ok(wall < 10_000, `${label}: wall-time backstop: ${wall.toFixed(1)} ms wall for ${full.toFixed(1)} ms CPU, limit 10000 ms (a blocking wait?)`);
  assert.ok(full < Math.max(floorMs, Math.max(base, MIN_BASE_MS) * MAX_RATIO), `${label}: ${full.toFixed(1)} ms CPU for ${input.length} chars, ${base.toFixed(1)} ms for ${small.length} chars (ratio ${(full / Math.max(base, MIN_BASE_MS)).toFixed(1)}, limit ${MAX_RATIO} for ${FACTOR}x input: linear is about ${FACTOR}, n log n about 30, quadratic over 65; floor ${floorMs} ms)`);
};
// One worker run of `code` (a worker script that writes CPU and wall ms into shared memory like the ones below): a worker that does not answer
// in `waitMs` is stopped and the case retried once. The test stays synchronous (Atomics).
export const workerRun = (label: string, code: string, data: Record<string, unknown>, waitMs: number): { cpu: number; wall: number } => {
  let why = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const sab = new SharedArrayBuffer(24);
    const flag = new Int32Array(sab, 0, 1);
    const worker = new Worker(code, { eval: true, workerData: { ...data, sab } });
    const waited = Atomics.wait(flag, 0, 0, waitMs);
    void worker.terminate();
    if (waited === 'timed-out') { why = `no answer in ${waitMs / 1000} s`; continue; }
    assert.strictEqual(Atomics.load(flag, 0), 1, `${label}: threw in the worker`);
    const [cpu, wall] = new Float64Array(sab, 8, 2);
    return { cpu, wall };
  }
  throw new assert.AssertionError({ message: `${label}: worker hung twice (${why})` });
};
