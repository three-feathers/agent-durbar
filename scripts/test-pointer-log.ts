/**
 * Spec 097 delta 2026-11-11 (issue #1448, T302): the pointer-event log of the flaky drivers (`npm run test:pointer-log`). No Electron is started: a stand-in
 * page (a vm context with a window that dispatches fake events) runs the helper's own page code. The same cases run on the real helper (all must hold)
 * and on eight mutants of its source (each must make a case fail): print removed, events not printed, prints on a pass, ring unbounded, dom block not printed, dom ring unbounded,
 * dom block printed on a pass, another error thrown (spec 033 delta 2026-11-11, issue #1526: the DOM ring and the static case for shots-033.js).
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

type Helpers = { pointerLog: (ctx: unknown, out?: (l: string) => void) => { step: (d: string, n: string, fn: () => Promise<unknown>, o?: { dom?: string }) => Promise<unknown> }; POINTER_LOG_MAX: number; DOM_LOG_MAX: number };
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
  /* a MutationObserver stand-in: mutate() delivers records to the observer of the last arm; the element exists only for '#floorsPop' */
  let cb: ((rs: unknown[]) => void) | null = null, disconnected = 0;
  class MO { constructor(f: (rs: unknown[]) => void) { cb = f; } observe() { /* stand-in */ } disconnect() { disconnected++; } takeRecords() { return []; } }
  const doc = { querySelector: (sel: string) => (sel === '#floorsPop' ? {} : null) };
  const cx = vm.createContext({ window: win, document: doc, MutationObserver: MO, performance: { now: () => now }, JSON, Math, String });
  return {
    mutate: (type: string, tag: string, cls: string, added = 0, removed = 0) => { if (cb) cb([{ type, target: { tagName: tag.toUpperCase(), classList: [cls] }, addedNodes: { length: added }, removedNodes: { length: removed } }]); },
    disconnects: () => disconnected,
    ctx: { js: async (code: string) => vm.runInContext(code, cx) },
    fire: (type: string, x: number, y: number, buttons = 0, trusted = true) => { for (const f of listeners.get(type) || []) f({ type, clientX: x, clientY: y, buttons, isTrusted: trusted }); },
    tick: (ms: number) => { now += ms; },
    listenerCount: () => [...listeners.values()].reduce((a, l) => a + l.length, 0),
  };
}

/** the driver (static): shots-033 wraps the floors-drag step with the dom option and says 'did not start' before the transform text */
function driverCase(d: string) {
  assert.ok(/H\.pointerStep\('shots-033', 'floors-drag ' \+ w, async \(\) => \{/.test(d) && d.includes("{ dom: '#floorsPop' }"), 'shots-033 wraps the floors-drag step with the dom option');
  const i = d.indexOf("'the drag did not start (no lifted floor)'"), j = d.indexOf("'mid-drag the lifted floor only has a transform'");
  assert.ok(i > 0 && j > i, 'the no-lift text is asserted before the transform text');
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

  // the DOM ring (issue #1526): opted in by { dom }, printed before the pointer block, only on a failure, bounded, no text
  { const p = page(), out: string[] = [], L = h.pointerLog(p.ctx, (l) => out.push(l));
    await L.step('shots-033', 'floors-drag 1280', async () => { p.fire('pointermove', 1, 1); p.mutate('childList', 'div', 'fl-floor', 1, 1); }, { dom: '#floorsPop' });
    assert.deepStrictEqual(out, [], 'a clean pass prints neither block');
    const p2 = page(), o2: string[] = [], L2 = h.pointerLog(p2.ctx, (l) => o2.push(l)), boom = new assert.AssertionError({ message: 'the drag did not start (no lifted floor)' });
    await assert.rejects(L2.step('shots-033', 'floors-drag 1280', async () => {
      p2.tick(5); p2.fire('pointerdown', 9, 9, 1); p2.tick(10); p2.fire('pointermove', 10, 9, 0); p2.mutate('childList', 'div', 'fl-floor', 3, 3); p2.mutate('attributes', 'span', 'x'.repeat(40));
      throw boom; }, { dom: '#floorsPop' }), (e) => e === boom);
    assert.ok(o2[0].startsWith('[dom-log] shots-033 floors-drag 1280: 2 mutations'), 'the dom block comes first and counts');
    assert.strictEqual(o2[1], '  15 c div.fl-floor +3-3;15 a span.xxxxxxxxxxxxxxxx +0-0', 'tag, first class cut at 16, counts, no text');
    assert.ok(o2[2].startsWith('[pointer-log] shots-033 floors-drag 1280: 2 events'), 'the pointer block follows');
    assert.ok(o2[3].includes('pd 9,9 1T') && o2[3].includes('pm 10,9 0T'), 'the stray pm at buttons 0 after the pd shows');
    // a step without { dom } never arms the observer and prints no dom block
    const p3 = page(), o3: string[] = [], L3 = h.pointerLog(p3.ctx, (l) => o3.push(l));
    await assert.rejects(L3.step('d', 's', async () => { assert.fail('red'); })); assert.ok(!o3.some((l) => l.startsWith('[dom-log]')), 'no dom block without the option');
    // bounded: 1000 mutations keep the last 100, every line within 240 characters; a re-arm disconnects the previous observer
    const p4 = page(), o4: string[] = [], L4 = h.pointerLog(p4.ctx, (l) => o4.push(l)), dmax = h.DOM_LOG_MAX;
    assert.strictEqual(dmax, 100, 'the dom ring keeps 100');
    await assert.rejects(L4.step('d', 'many', async () => { for (let i = 0; i < 1000; i++) p4.mutate('attributes', 'div', 'c' + i); assert.fail('red'); }, { dom: '#floorsPop' }));
    assert.ok(o4[0].startsWith(`[dom-log] d many: ${dmax} mutations`), 'the dom ring holds 100');
    const dl = o4.filter((l) => l.startsWith('  ') && l.includes(' a div.')); assert.strictEqual(dl.length, Math.ceil(dmax / 8), '8 mutations a line');
    assert.ok(o4.join('\n').includes('div.c999 ') && !o4.join('\n').includes('div.c899 '), 'the last 100 are kept');
    assert.ok(o4.every((l) => l.length <= 240), 'every line fits what the suite shows');
    await L4.step('d', 'again', async () => 1, { dom: '#floorsPop' }); assert.ok(p4.disconnects() >= 1, 'the next arm disconnects the earlier observer');
    // a page without the element or the observer arms nothing and never hides the assertion
    const p5 = page(), o5: string[] = [], L5 = h.pointerLog(p5.ctx, (l) => o5.push(l)), e5 = new assert.AssertionError({ message: 'x' });
    await assert.rejects(L5.step('d', 's', async () => { throw e5; }, { dom: '#nothing' }), (e) => e === e5); assert.ok(o5.some((l) => l.startsWith('[dom-log] d s: 0 mutations')) || o5.length >= 1); }

  driverCase(lf(fs.readFileSync(path.join(ROOT, 'scripts', 'shots-033.js'), 'utf8')));

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

/** the hover-card driver (static, T306): the asleep-card block is a pointer step and its last assert is inside it, so the log prints on that assert */
function hoverCardCase(d: string) {
  const open = "await H.pointerStep('check-097-hover-card', `${tag} falls asleep`, async () => {";
  const i = d.indexOf(open), last = d.indexOf('the asleep card is still open 700 ms after the refill'), end = d.indexOf('\n    });\n', last);
  assert.ok(i > 0 && last > i && end > last, 'check-097-hover-card wraps the falls-asleep block in H.pointerStep, its last assert inside');
  assert.ok(!d.slice(i, last).includes('\n    });\n'), 'the step is not closed before that assert');
  assert.ok(d.indexOf('wk2 = await hoverWork', i) > i && d.slice(0, i).includes('let wk2;'), 'wk2 is declared outside the step for the later steps');
  const open2 = "await H.pointerStep('check-097-hover-card', `${tag} falls asleep, then leaves`, async () => {";
  const i2 = d.indexOf(open2), last2 = d.indexOf('the held card of the third agent is still open before the pointer leaves'), end2 = d.indexOf('\n    });\n', last2);
  assert.ok(i2 > i && last2 > i2 && end2 > last2, 'check-097-hover-card wraps the third-agent step in H.pointerStep, its held-card assert inside');
  assert.ok(!d.slice(i2, last2).includes('\n    });\n'), 'the third-agent step is not closed before that assert');
  assert.ok(d.slice(0, i2).includes('let wk4;') && d.indexOf('wk4 = await hoverWork', i2) > i2, 'wk4 is declared outside the third-agent step');
}

(async () => {
  assert.strictEqual(lf('a\r\nb'), 'a\nb', 'lf() turns CRLF into LF');
  hoverCardCase(lf(fs.readFileSync(path.join(ROOT, 'scripts', 'check-097-hover-card.js'), 'utf8')));
  await cases(load(SRC));
  await cases(load(lf(SRC.replace(/\n/g, '\r\n')))); // a CRLF checkout gives the same source after lf()
  const mutants: Array<[string, string, string]> = [
    ['print removed', "out(`[pointer-log] ${driver} ${name}: ${ev.length} events (", "void(`[pointer-log] ${driver} ${name}: ${ev.length} events ("],
    ['events not printed', "i += 11) out('  '", "i += 11) void('  '"],
    ['prints on a pass', 'const r = await fn();', "const r = await fn(); await print(driver, name);"],
    ['ring unbounded', 'if(E.length>${POINTER_LOG_MAX})E.splice(0,E.length-${POINTER_LOG_MAX});', ''],
    ['dom block not printed', "out(`[dom-log] ${driver} ${name}: ${ev.length} mutations (", "void(`[dom-log] ${driver} ${name}: ${ev.length} mutations ("],
    ['dom ring unbounded', 'if(D.ev.length>${DOM_LOG_MAX})D.ev.splice(0,D.ev.length-${DOM_LOG_MAX});', ''],
    ['dom block prints on a pass', 'const r = await fn();', "const r = await fn(); if (opts && opts.dom) await printDom(driver, name);"],
    ['another error thrown', "      throw e;\n    }\n  };\n  return { arm, step, print, printDom };", "      throw new Error(String(e && e.message));\n    }\n  };\n  return { arm, step, print, printDom };"],
  ];
  /* the driver's own text: a lift-less result must say 'did not start' (the scratch stray hook shows it live, see the PR); the mutant removes that assert */
  { const d = lf(fs.readFileSync(path.join(ROOT, 'scripts', 'shots-033.js'), 'utf8')), line = "      assert.ok(mid.lift, 'the drag did not start (no lifted floor)');\n";
    assert.ok(d.includes(line), 'mutant "assert text not switched" applies to shots-033.js');
    assert.throws(() => driverCase(d.replace(line, '')), 'mutant "assert text not switched" is killed'); console.log('test-pointer-log: mutant "assert text not switched" killed'); }
  for (const [name, from, to] of mutants) {
    assert.ok(SRC.includes(from), `mutant "${name}" applies to the source`);
    let killed = false;
    try { await cases(load(SRC.replace(from, to))); } catch { killed = true; }
    assert.ok(killed, `mutant "${name}" is killed by its own case`);
    console.log(`test-pointer-log: mutant "${name}" killed`);
  }
  console.log('test-pointer-log: ok');
})().catch((e) => { console.error(e); process.exit(1); });
