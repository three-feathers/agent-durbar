/**
 * Unit test (spec 097 FR-186, T142): the judge of `check-office-ops.js` fails where it must and passes where it must. A check that cannot fail asserts nothing
 * (the first version compared `value > LIMITS[key] || LIMITS[row]` and never failed a row whose limit was 0). No Electron is started.
 */
import * as assert from 'assert';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require(path.join(ROOT, 'scripts', 'office-ops-rules.js')) as {
  LIMITS: Record<string, number>; MINIMUMS: Record<string, number>; KNOWN_FAILURES: Record<string, { task: string; max: number }>;
  judge: (rows: Record<string, number>, limits?: Record<string, number>, known?: Record<string, { task: string; max: number }>, minimums?: Record<string, number>) => { failed: string[]; notes: string[] };
  statusDraws: (state: string | undefined, status: string) => boolean;
  toStatus: (js: (code: string) => Promise<unknown>, drawn: (code: string) => Promise<void>, id: string, status: string) => Promise<boolean>;
};
const L = { a: 50, z: 0, 'a@40': 100, w: 3 }, M = { m: 2 }, K = { 'w@15': { task: 'T9', max: 13 } };
const j = (rows: Record<string, number>) => R.judge(rows, L, K, M);

// passes
assert.deepStrictEqual(j({ 'a@15': 16, 'z@15': 0, 'a@40': 99 }).failed, [], 'values within their limits pass (also a per-agents override)');
// fails: over a limit, also a limit of 0, and an override tighter or looser than the row
assert.strictEqual(j({ 'a@15': 51 }).failed.length, 1, 'over the limit fails');
assert.strictEqual(j({ 'z@15': 1 }).failed.length, 1, 'a limit of 0 fails at 1 (the first version never did)');
assert.strictEqual(j({ 'a@40': 101 }).failed.length, 1, 'the override applies at 40');
assert.strictEqual(j({ 'a@40': 60 }).failed.length, 0, 'the row limit of 50 does not apply where an override of 100 does');
// a row that asserts nothing, and a value that is not a count
assert.strictEqual(j({ 'q@15': 1 }).failed.length, 1, 'a row with no limit and no minimum fails');
assert.strictEqual(j({ 'a@15': NaN }).failed.length, 1, 'NaN fails');
// minimums
assert.strictEqual(j({ 'm@15': 1 }).failed.length, 1, 'under a minimum fails');
assert.strictEqual(j({ 'm@15': 2 }).failed.length, 0, 'at the minimum passes');
// known failures: tolerated up to their max, failing over it, and flagged when no longer needed
assert.deepStrictEqual(j({ 'w@15': 13 }).failed, [], 'a known failure within its max passes, with a note');
assert.strictEqual(j({ 'w@15': 13 }).notes.length, 1, 'and says so');
assert.strictEqual(j({ 'w@15': 14 }).failed.length, 1, 'a known failure over its max fails');
assert.strictEqual(j({ 'w@15': 3 }).failed.length, 1, 'a known failure within its limit must lose its entry');

// the real tables: every limit row is sane and a mutant (a halo that animates fill-opacity again) fails today's table
for (const [k, v] of Object.entries(R.LIMITS)) assert.ok(Number.isInteger(v) && v >= 0, `limit ${k} is a count`);
assert.ok(R.judge({ 'animatedOtherProperties@15': 1 }).failed.length === 1, 'one animation of a property other than transform and opacity fails (the halos no longer animate, so there is no known failure)');
assert.ok(R.judge({ 'animatedOtherProperties@15': 0 }).failed.length === 0, 'none passes');
assert.ok(R.judge({ 'searchesPerStatus@15': 1 }).failed.length === 1, 'a layout search per status change fails');
assert.ok(R.judge({ 'elementsRecalculated@15': 1401 }).failed.length === 1, 'the :has() rule (1401 elements) fails');
assert.ok(R.judge({ 'searchesAtStart@late40': 2 }).failed.length === 1 && R.judge({ 'searchesAtStart@late40': 1 }).failed.length === 0, 'a second layout search at a late start fails (limit 1)');
assert.ok(R.judge({ 'searchesAtStart@40': 2 }).failed.length === 1 && R.judge({ 'searchesAtStart@15': 1 }).failed.length === 0, 'the plain start row allows 1 search (owner decision 2026-11-11)');
assert.ok(R.judge({ 'probesAtStart@40': 51 }).failed.length === 1 && R.judge({ 'probesAtStart@40': 50 }).failed.length === 0 && R.judge({ 'probesAtStart@15': 21 }).failed.length === 1 && R.judge({ 'probesAtStart@15': 20 }).failed.length === 0, 'start probes: at most 50 at 40 agents and 20 at 15');
assert.ok(R.judge({ 'lateReplayDelay@late15': 0 }).failed.length === 1 && R.judge({ 'lateReplayDelay@late15': 50 }).failed.length === 0, 'a simlate that was ignored (delay 0) fails');
assert.ok(R.judge({ 'searchesAtRealStart@40': 2 }).failed.length === 1 && R.judge({ 'searchesAtRealStart@15': 1 }).failed.length === 0 && R.judge({ 'probesAtRealStart@15': 21 }).failed.length === 1 && R.judge({ 'probesAtRealStart@40': 51 }).failed.length === 1 && R.judge({ 'probesAtRealStart@40': 50 }).failed.length === 0, 'the real start: 1 search, at most 20 probes at 15 agents and 50 at 40 (FR-378)');
assert.ok(R.judge({ 'realStartIdle@15': 0 }).failed.length === 1 && R.judge({ 'realStartIdle@15': 1 }).failed.length === 0, 'a simreal that was ignored fails (FR-378)');
assert.ok(R.judge({ 'handPositions@15': 1 }).failed.length === 1, 'a hand that never moves fails');
// T156 (issue 1401): the reads of a status update are held at both sizes and both agent counts; the numbers before the lobby figures read the scroll once fail
for (const [row, before] of [['readsPerStatus@15', 97], ['readsPerStatus@40', 85], ['readsPerStatus1280@15', 89], ['readsPerStatus1280@40', 72]] as const) {
  assert.ok(R.judge({ [row]: before }).failed.length === 1, `${row} = ${before} (the count before the scroll was read once) fails`);
}
assert.ok(R.judge({ 'readsPerStatus@15': 81, 'readsPerStatus@40': 73, 'readsPerStatus1280@15': 77, 'readsPerStatus1280@40': 60 }).failed.length === 0, 'the measured numbers pass');

/* spec 001 delta 2026-11-22 (issue 2043, T456): the driver's "make it work first" step. A fake page that draws as app.js's setState does (only a change of state renders)
   and a `drawn` that, like the driver's, fails when no render follows; no timer renders here, so a wait for a draw that never comes fails every time, never by luck. */
function page(states: Record<string, string>) {
  let renders = 0;
  const STAY: Record<string, string[]> = { working: ['working', 'thinking'], 'needs-permission': ['waiting'] };
  const NEXT: Record<string, string> = { working: 'working', 'needs-permission': 'waiting', idle: 'idle', error: 'error' };
  const js = async (code: string): Promise<unknown> => {
    const st = /sessionId:"([^"]+)",timestamp:Date\.now\(\),status:"([^"]+)"/.exec(code);
    if (st) { const [, id, status] = st; if (!(STAY[status] || []).includes(states[id])) { states[id] = NEXT[status]; renders++; } return undefined; }
    const q = /a\.id==="([^"]+)"/.exec(code);
    if (q) return states[q[1]];
    throw new Error('the fake page does not know: ' + code);
  };
  const drawn = async (code: string) => { const before = renders; await js(code); assert.ok(renders > before, `the office drew after: ${code.slice(0, 80)}`); };
  return { js, drawn, renders: () => renders };
}
(async () => {
  for (const [state, status] of [['working', 'working'], ['thinking', 'working'], ['waiting', 'needs-permission']] as const) {
    assert.strictEqual(R.statusDraws(state, status), false, `${status} leaves ${state} as it is: no draw`);
    const p = page({ 'sim-4': state });
    let waited: boolean | Error;
    try { waited = await R.toStatus(p.js, p.drawn, 'sim-4', status); } catch (e) { waited = e as Error; }
    assert.strictEqual(waited, false, `toStatus(${status}) on an agent already ${state} sends the event and waits for no draw (issue 2043: it waited 8 s for a timer's render): ${waited}`);
    assert.strictEqual(p.renders(), 0, 'and nothing drew');
  }
  for (const [state, status] of [['idle', 'working'], ['done', 'working'], ['error', 'working'], ['working', 'needs-permission'], [undefined, 'working']] as const) {
    assert.strictEqual(R.statusDraws(state, status), true, `${status} changes ${state}: a draw`);
  }
  const p = page({ 'sim-4': 'idle' });
  assert.strictEqual(await R.toStatus(p.js, p.drawn, 'sim-4', 'working'), true, 'a real change waits for its draw');
  assert.strictEqual(p.renders(), 1, 'and it drew once');
  /* today's step before the fix (a draw awaited whatever the state) fails on an agent that already works: the bug, shown without a timer */
  const old = page({ 'sim-4': 'working' });
  await assert.rejects(old.drawn(`window.__durbarSimEmit({type:'status',sessionId:"sim-4",timestamp:Date.now(),status:"working"})`), /the office drew after/, 'the old step waits for a draw that never comes');
  console.log('test-office-ops: ok');
})().catch((e) => { console.error(e); process.exit(1); });

// a read through a Range is a layout read too (Paco on #2017: dropping scrollWidth for a Range rect hid a read from the counter): both counters wrap Range.prototype
// beside Element.prototype. Mutant: take Range.prototype out of either file and this fails.
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  for (const f of ['check-office-ops.js', 'check-office-ops-real.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
    const line = src.split('\n').find((l) => l.includes("'getBoundingClientRect','getClientRects'")) || '';
    assert.ok(/\[Element\.prototype,Range\.prototype\]/.test(line), f + ': the counter wraps getBoundingClientRect and getClientRects of Range too');
    // run the wrapped loop on fake prototypes: a Range read counts
    const body = line.trim();
    const O = { on: true, reads: 0 }; const bump = () => { if (O.on) O.reads++; };
    class FakeElement { getBoundingClientRect() { return 1; } getClientRects() { return 1; } }
    class FakeRange { getBoundingClientRect() { return 1; } getClientRects() { return 1; } }
    new Function('bump', 'Element', 'Range', body.replace(/Element\.prototype,Range\.prototype/, 'Element.prototype,Range.prototype'))(bump, FakeElement, FakeRange);
    new FakeRange().getBoundingClientRect(); new FakeRange().getClientRects(); new FakeElement().getBoundingClientRect();
    assert.strictEqual(O.reads, 3, f + ': a Range read and an Element read are counted (3), got ' + O.reads);
  }
}
