import * as assert from 'assert';
import { cpuMs } from './redact-growth-lib';

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
 * For a guard that stands for "linear or bounded work" where the code gives no property to count: the CPU time of this process while the SYNCHRONOUS `fn` runs, never wall time, so a loaded
 * machine does not move it (agent-notes: timing checks measure CPU). It is `cpuMs` (scripts/redact-growth-lib.ts), so a wall backstop of at least 20 s also stays and a blocking wait
 * (a sync sleep) fails it; `capMs` is about 20 times the cost measured at the site, never a round 10 s. An async `fn` is refused: only its synchronous part would be measured. `probe` is for the self-test (fake reading and clock).
 */
export const assertCpuUnder = (label: string, capMs: number, fn: () => unknown, probe?: Parameters<typeof cpuMs>[2]): number => {
  const backstopCap = Math.max(capMs, 2000); // cpuMs fails at 10 x this in wall time: 20 s at least, so load alone never reaches it
  const ms = cpuMs(() => {
    const r = fn();
    if (r && typeof (r as { then?: unknown }).then === 'function') throw new TypeError(`${label}: assertCpuUnder takes a synchronous function (a promise was returned: only its synchronous part would be measured)`);
  }, backstopCap, probe);
  assert.ok(ms < capMs, `${label}: ${ms.toFixed(0)} ms CPU, limit ${capMs} ms`);
  return ms;
};

const SPIED = ['replace', 'replaceAll', 'split', 'trim', 'trimStart', 'trimEnd', 'normalize', 'match', 'matchAll', 'search', 'indexOf', 'lastIndexOf', 'includes', 'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'padStart', 'localeCompare'] as const;

/**
 * The longest string any scanning String method (replace, split, trim, normalize, match, search, indexOf, ...) or RegExp `test`/`exec` saw while `fn` ran, counted, not timed: the property behind "the cut comes before the
 * work" (a hostile 1 MB input is cut first, nothing scans it whole). `slice` is not counted: it is the cut. The hooks are restored before this returns, so assert on the result afterwards.
 */
export const longestStringSeen = <T>(fn: () => T): { longest: number; result: T } => {
  let longest = 0;
  const saved: Array<[object, string, unknown]> = [];
  const hook = (proto: object, name: string, lenOf: (self: unknown, args: unknown[]) => number): void => {
    const orig = (proto as Record<string, unknown>)[name] as (...a: unknown[]) => unknown;
    saved.push([proto, name, orig]);
    (proto as Record<string, unknown>)[name] = function (this: unknown, ...a: unknown[]) { const n = lenOf(this, a); if (n > longest) longest = n; return orig.apply(this, a); };
  };
  for (const n of SPIED) hook(String.prototype, n, (self) => (typeof self === 'string' ? self.length : String(self).length));
  for (const n of ['test', 'exec']) hook(RegExp.prototype, n, (_self, a) => (typeof a[0] === 'string' ? a[0].length : 0));
  try { const result = fn(); return { longest, result }; } finally { for (const [p, n, o] of saved) (p as Record<string, unknown>)[n] = o; }
};

/**
 * The delays given to `setTimeout` between this call and `stop()`: what a "cut off after N ms" test pins instead of how long the cut took. Assert the production delay is among them
 * (`delays.includes(30)`), so a timeout changed to 15 s fails with its own text, and keep `withBackstop` as the hang guard only (its own 20 s timer is in the list too).
 */
export const logTimerDelays = (): { delays: number[]; stop: () => void } => {
  const real = globalThis.setTimeout;
  const delays: number[] = [];
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => { delays.push(Number(ms ?? 0)); return real(fn, ms, ...rest); }) as typeof setTimeout;
  return { delays, stop: () => { (globalThis as { setTimeout: unknown }).setTimeout = real; } };
};

/** "The cut comes first": no scanning string method or regexp saw a string longer than `limit` (the cut size) while `fn` ran. Counted, not timed; `label` names what was cut. */
export const assertCutFirst = <T>(label: string, limit: number, fn: () => T): T => {
  const { longest, result } = longestStringSeen(fn);
  assert.ok(longest <= limit, `${label}: the longest string a scan saw was ${longest} characters, the cut is ${limit} (is the cut after the work?)`);
  return result;
};
