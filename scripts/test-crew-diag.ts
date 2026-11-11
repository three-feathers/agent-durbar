/**
 * Spec 097 delta 2026-11-11 (issue #1460): the check-crew timeout diagnostics (`npm run test:crew-diag`). No Electron: a stand-in page (`ctx.js` answers the
 * helper's two page reads). The same cases run on the real helper and on mutants of its source (each must make a case fail): a long line not split (the
 * signatures on one line), a probe that changes the verdict (no throw), fields missing (drag), errors not bounded to 3. A forced render happens once, in the timeout path only. The source is read CRLF-safe as in test-pointer-log.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module');

const FILE = path.join(__dirname, '..', '..', 'scripts', 'driver-helpers.js');
const lf = (t: string) => t.replace(/\r\n/g, '\n');
const SRC = lf(fs.readFileSync(FILE, 'utf8'));
type Page = Record<string, unknown>;
type H = { crewDiagLines: (t: string, n: number, s: number, d: Page, a: Page | null) => string[]; crewTimeout: (ctx: { js: (c: string) => Promise<unknown> }, t: string, n: number, s: number, out: (l: string) => void, sleep: () => Promise<void>) => Promise<void> };
function load(src: string): H {
  const m = new Module(FILE, null); m.filename = FILE; m.paths = Module._nodeModulePaths(path.dirname(FILE)); m._compile(src, FILE); return m.exports;
}
const LONG = 'x'.repeat(900);
const worst = (): Page => ({ chars: LONG, kit: LONG, theme: LONG, tk: LONG, scenes: 2, visible: 2, crew: 0, drag: true, busy: true, view: LONG, floorW: 1234, hidden: true, vis: 'hidden', focus: false, renders: 7,
  errs: [LONG, LONG, LONG, LONG], sigs: [LONG, LONG, LONG, LONG, LONG, LONG], bad: { a: LONG, b: [LONG] } });
const SHORT = (): Page => ({ chars: 'rebels', kit: 'crew', theme: 'check-dark', tk: 'check-dark.1', scenes: 2, visible: 2, crew: 0, drag: true, busy: false, view: 'office', floorW: 1500, hidden: false, vis: 'visible', focus: true, renders: 3, errs: ['boom'], sigs: ['a|b', 'c|d'], bad: [] });

async function cases(h: H) {
  // every line, for the worst case page, fits the suite's cap; signatures and bad marks on their own lines
  { const L = h.crewDiagLines('check-dark', 2, 5, worst(), { renders: 9, crew: 2, scenes: 2 });
    assert.ok(L.every((l) => l.length <= 240), 'every diagnostic line is at most 240 characters: ' + L.map((l) => l.length));
    assert.strictEqual(L.filter((l) => /\[crew\] sig\d/.test(l)).length, 4, 'the first 4 signatures, one a line');
    assert.ok(L.some((l) => /\[crew\] errs\(3\)/.test(l)), 'at most the last 3 errors');
    assert.ok(L.some((l) => l.startsWith('  [crew] bad ')), 'bad marks on their own line'); }
  // the short fields come first on one line, with the ones that matter
  { const L = h.crewDiagLines('check-dark', 2, 5, SHORT(), { renders: 4, crew: 2, scenes: 2 });
    for (const f of ['chars=rebels', 'kit=crew', 'theme=check-dark', 'tk=check-dark.1', 'scenes=2', 'visible=2', 'drag=1', 'busy=0', 'view=office', 'floorW=1500', 'hidden=0', 'vis=visible', 'focus=1']) assert.ok(L[0].includes(f), 'line 1 has ' + f);
    assert.ok(L[1].includes('renders=3') && L[1].includes('renders=4') && L[1].includes('crewScenes=2'), 'counters before and after the probe'); assert.ok(L[2].includes('boom')); }
  // the timeout path: prints, probes once, and FAILS even when the probe's redraw drew the crew scenes
  { const calls: string[] = [], out: string[] = []; let reads = 0;
    const ctx = { js: async (c: string) => { calls.push(c); if (c.includes('U.render()')) return 1; reads++; return reads === 1 ? SHORT() : { ...SHORT(), crew: 2, renders: 4 }; } };
    await assert.rejects(h.crewTimeout(ctx, 'check-dark', 2, 5, (l) => out.push(l), async () => undefined), assert.AssertionError);
    assert.strictEqual(calls.filter((c) => c.includes('U.render()')).length, 1, 'one forced render, the probe'); assert.ok(out.length >= 6 && out.every((l) => l.length <= 240)); assert.ok(out[0].includes('drag=1')); }
  // a dead page: the failure is still the assertion, nothing else
  { const out: string[] = [];
    await assert.rejects(h.crewTimeout({ js: async () => { throw new Error('gone'); } }, 'check-dark', 2, 5, (l) => out.push(l), async () => undefined), assert.AssertionError); }
}

(async () => {
  await cases(load(SRC));
  await cases(load(lf(SRC).replace(/\n/g, '\r\n').replace(/\r\n/g, '\n')));
  const mutants: Array<[string, string, string]> = [
    ['long line not split', "(d.sigs || []).slice(0, 4).forEach((s, i) => o.push(cut(`  [crew] sig${i} ${cut(s, 200)}`, CREW_LINE_MAX)));", "o[0] += (d.sigs || []).slice(0, 4).map((s) => cut(s, 200)).join(' ');"],
    ['line not cut', "const cut = (s, m) => String(s == null ? '' : s).replace(/[\\r\\n]+/g, ' ').slice(0, m);", "const cut = (s, m) => String(s == null ? '' : s).replace(/[\\r\\n]+/g, ' ');"],
    ['probe changes the verdict', "  throw new (require('assert').AssertionError)({ message: `${tag}: ${n} crew scenes not drawn within", "  if (after && after.crew >= n) return;\n  throw new (require('assert').AssertionError)({ message: `${tag}: ${n} crew scenes not drawn within"],
    ['fields missing', ' drag=${b(d.drag)} busy=${b(d.busy)}', ''],
    ['errors unbounded', "const E = (d.errs || []).slice(-3);", "const E = (d.errs || []);"],
  ];
  for (const [name, from, to] of mutants) {
    assert.ok(SRC.includes(from), `mutant "${name}" applies to the source`);
    let killed = false;
    try { await cases(load(SRC.replace(from, to))); } catch { killed = true; }
    assert.ok(killed, `mutant "${name}" is killed by its own case`);
    console.log(`test-crew-diag: mutant "${name}" killed`);
  }
  console.log('test-crew-diag: ok');
})().catch((e) => { console.error(e); process.exit(1); });
