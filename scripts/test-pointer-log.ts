/**
 * Spec 097 delta 2026-11-11 (issue #1448, T302): the pointer-event log of the flaky drivers (`npm run test:pointer-log`). No Electron is started: a stand-in
 * page (a vm context with a window that dispatches fake events) runs the helper's own page code. The same cases run on the real helper (all must hold)
 * and on five mutants of its source (each must make a case fail): print removed, events not printed, prints on a pass, ring unbounded, another error thrown.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'scripts', 'driver-helpers.js');
const lf = (t: string) => t.replace(/\r\n/g, '\n'); // a Windows checkout may have CRLF: the mutant anchors below are LF text (as test-subretire's lf)
const SRC = lf(fs.readFileSync(FILE, 'utf8'));

type Helpers = { pointerLog: (ctx: unknown, out?: (l: string) => void) => { step: (d: string, n: string, fn: () => Promise<unknown>) => Promise<unknown> }; POINTER_LOG_MAX: number };
function load(src: string): Helpers {
  const m = new Module(FILE, null);
  m.filename = FILE;
  m.paths = Module._nodeModulePaths(path.dirname(FILE));
  m._compile(src, FILE);
  return m.exports;
}

/** A page: window.addEventListener keeps the listeners, fire() dispatches to those of the type; performance.now() is a settable clock. */
function page() {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  let now = 1000;
  const win: Record<string, unknown> = { addEventListener: (t: string, f: (e: unknown) => void) => { listeners.set(t, [...(listeners.get(t) || []), f]); } };
  const cx = vm.createContext({ window: win, performance: { now: () => now }, JSON, Math });
  return {
    ctx: { js: async (code: string) => vm.runInContext(code, cx) },
    fire: (type: string, x: number, y: number, buttons = 0, trusted = true) => { for (const f of listeners.get(type) || []) f({ type, clientX: x, clientY: y, buttons, isTrusted: trusted }); },
    tick: (ms: number) => { now += ms; },
    listenerCount: () => [...listeners.values()].reduce((a, l) => a + l.length, 0),
  };
}

async function cases(h: Helpers) {
  const max = h.POINTER_LOG_MAX;
  assert.strictEqual(max, 200, 'the ring keeps 200 events');
  delete process.env.DIAG_FORCE_FAIL;

  // a pass prints nothing and returns the step's value
  { const p = page(), out: string[] = [], L = h.pointerLog(p.ctx, (l) => out.push(l));
    const r = await L.step('drv', 'ok step', async () => { p.fire('pointermove', 5, 6); return 42; });
    assert.strictEqual(r, 42, 'a pass returns the step value'); assert.deepStrictEqual(out, [], 'a pass prints nothing'); }

  // a failing assert prints the header and the events (relative time, no page content) and throws the SAME error
  { const p = page(), out: string[] = [], L = h.pointerLog(p.ctx, (l) => out.push(l)), boom = new assert.AssertionError({ message: 'the drag is on mid-way' });
    await assert.rejects(L.step('check-x', 'photo 1440x900 drag', async () => { p.fire('pointermove', 10, 20, 0, false); p.tick(30); p.fire('pointerdown', 11, 21, 1); throw boom; }), (e) => e === boom);
    assert.ok(out[0].startsWith('[pointer-log] check-x photo 1440x900 drag: 2 events'), 'the header names driver, step and count');
    assert.ok(out[0].includes('pm=p.move'), 'the header carries the legend');
    assert.strictEqual(out[1], '  0 pm 10,20 0S;30 pd 11,21 1T'); assert.strictEqual(out.length, 2); }

  // events before the step began are not in its log (each step arms again and empties the ring); the listeners are installed once
  { const p = page(), out: string[] = [], L = h.pointerLog(p.ctx, (l) => out.push(l));
    p.fire('pointermove', 1, 1); // before any step: not recorded
    await L.step('d', 's1', async () => { p.fire('pointermove', 2, 2); });
    const n = p.listenerCount();
    await assert.rejects(L.step('d', 's2', async () => { p.fire('mousemove', 3, 3); assert.fail('red'); }));
    assert.strictEqual(p.listenerCount(), n, 'the listeners are installed once'); assert.ok(out[0].startsWith('[pointer-log] d s2: 1 events'), 'only the failing step\'s events'); }

  // bounded: 1000 events keep the last 200
  { const p = page(), out: string[] = [], L = h.pointerLog(p.ctx, (l) => out.push(l));
    await assert.rejects(L.step('d', 'many', async () => { for (let i = 0; i < 1000; i++) p.fire('pointermove', i, 0); assert.fail('red'); }));
    assert.ok(out[0].startsWith(`[pointer-log] d many: ${max} events`), 'the ring holds 200');
    assert.strictEqual(out.length, 1 + Math.ceil(max / 11), '11 events a line');
    assert.ok(out[1].includes(' 800,0 ') && !out[1].includes(' 799,0 ') && out[out.length - 1].includes(' 999,0 '), 'the last 200 are kept, the first 800 dropped');
    assert.ok(out.every((l) => l.length <= 240), 'every line fits what the suite shows (240 characters)'); }

  // a non-assertion error is rethrown unchanged and prints nothing; a failed read never hides the assertion
  { const p = page(), out: string[] = [], L = h.pointerLog(p.ctx, (l) => out.push(l)), e1 = new Error('plain');
    await assert.rejects(L.step('d', 's', async () => { throw e1; }), (e) => e === e1); assert.deepStrictEqual(out, []);
    const dead = { js: async () => { throw new Error('page gone'); } }, o2: string[] = [], L2 = h.pointerLog(dead, (l) => o2.push(l)), e2 = new assert.AssertionError({ message: 'x' });
    await assert.rejects(L2.step('d', 's', async () => { throw e2; }), (e) => e === e2); assert.deepStrictEqual(o2, [], 'no page, no log, the assertion still the one thrown');
    assert.strictEqual(await L2.step('d', 's', async () => 7), 7, 'a page that cannot arm still lets a passing step pass'); }

  // DIAG_FORCE_FAIL=1: the first step fails once after it ran, with the log; the next passes silently
  { process.env.DIAG_FORCE_FAIL = '1';
    try {
      const p = page(), out: string[] = [], L = h.pointerLog(p.ctx, (l) => out.push(l));
      await assert.rejects(L.step('drv', 'first', async () => { p.fire('pointermove', 7, 8); }), /forced failure of first/);
      assert.ok(out[0].startsWith('[pointer-log] drv first: 1 events')); assert.strictEqual(out.length, 2);
      out.length = 0; await L.step('drv', 'second', async () => 1); assert.deepStrictEqual(out, [], 'forced once only');
      process.env.DIAG_FORCE_FAIL = 'second-only'; const p2 = page(), L2 = h.pointerLog(p2.ctx, () => undefined);
      await L2.step('drv', 'first', async () => 1); await assert.rejects(L2.step('drv', 'the second-only step', async () => 1), /forced failure/);
    } finally { delete process.env.DIAG_FORCE_FAIL; } }
}

(async () => {
  assert.strictEqual(lf('a\r\nb'), 'a\nb', 'lf() turns CRLF into LF');
  await cases(load(SRC));
  await cases(load(lf(SRC.replace(/\n/g, '\r\n')))); // a CRLF checkout gives the same source after lf()
  const mutants: Array<[string, string, string]> = [
    ['print removed', "out(`[pointer-log] ${driver} ${name}: ${ev.length} events (", "void(`[pointer-log] ${driver} ${name}: ${ev.length} events ("],
    ['events not printed', "i += 11) out('  '", "i += 11) void('  '"],
    ['prints on a pass', 'const r = await fn();', "const r = await fn(); await print(driver, name);"],
    ['ring unbounded', 'if(E.length>${POINTER_LOG_MAX})E.splice(0,E.length-${POINTER_LOG_MAX});', ''],
    ['another error thrown', "      throw e;\n    }\n  };\n  return { arm, step, print };", "      throw new Error(String(e && e.message));\n    }\n  };\n  return { arm, step, print };"],
  ];
  for (const [name, from, to] of mutants) {
    assert.ok(SRC.includes(from), `mutant "${name}" applies to the source`);
    let killed = false;
    try { await cases(load(SRC.replace(from, to))); } catch { killed = true; }
    assert.ok(killed, `mutant "${name}" is killed by its own case`);
    console.log(`test-pointer-log: mutant "${name}" killed`);
  }
  console.log('test-pointer-log: ok');
})().catch((e) => { console.error(e); process.exit(1); });
