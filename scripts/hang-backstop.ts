import * as assert from 'assert';

/**
 * Spec 008 FR-087 delta 2026-11-17 (issue #1853): a test whose property is "this call ends although something it waits on never answers" asserts the result (the answer that
 * came back, the calls made), never how long it took: a fixed millisecond limit fails on a loaded machine (#1850). This is only the hang guard: a promise still pending after
 * `ms` (20 s by default, hundreds of times what any of these waits needs) fails with `label`, so a code change that loses the cut fails here with its own text, not at the runner's
 * time limit. A wait uses no CPU, so this is the one wall-clock limit that stays; it is a backstop for a hang, not a latency requirement. `schedule` is for the self-test of the guard (it fires at once, no real wait).
 */
export const withBackstop = <T>(p: Promise<T>, label: string, ms = 20_000, schedule: (cb: () => void, ms: number) => unknown = setTimeout): Promise<T> => new Promise<T>((resolve, reject) => {
  let done = false;
  const handle = schedule(() => { if (!done) { done = true; reject(new assert.AssertionError({ message: `${label}: still pending after ${ms} ms (it hangs)` })); } }, ms);
  const stop = (): void => { done = true; (handle as { unref?: () => void; hasRef?: () => boolean } | undefined)?.unref?.(); if (typeof handle === 'object' && handle) clearTimeout(handle as NodeJS.Timeout); };
  p.then((v) => { if (!done) { stop(); resolve(v); } }, (e) => { if (!done) { stop(); reject(e); } });
});

/**
 * For a guard that stands for "the work is bounded or linear" (a hostile 1 MB input, a cut that must come first): the CPU time of this process while `fn` runs, never wall time, so a loaded
 * machine does not move it (agent-notes: timing checks measure CPU, not wall). `capMs` is a generous backstop, tens to hundreds of times the measured cost: a quadratic or uncut pass
 * on these inputs costs minutes, so it fails here with `label`. What the guard stands for is also asserted directly where the code gives a property to assert (a result, a call count). `usage` is for the self-test (a fake reading, no real work or wait).
 */
export const assertCpuUnder = (label: string, capMs: number, fn: () => void, usage: (prev?: NodeJS.CpuUsage) => NodeJS.CpuUsage = process.cpuUsage): number => {
  const start = usage();
  fn();
  const d = usage(start);
  const ms = (d.user + d.system) / 1000;
  assert.ok(ms < capMs, `${label}: ${ms.toFixed(0)} ms CPU, limit ${capMs} ms`);
  return ms;
};
