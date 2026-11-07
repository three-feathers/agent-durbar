/** Brain view renderer (spec 106 T005, FR-013, FR-040, FR-051, FR-060, FR-100..FR-104, SC-004): `npm run test:braindraw`.
 *  Op counts only, no timing asserts (AGENTS.md Timing): the renderer runs in Node on a recording context and a fake clock. No credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { TRAIL_MAX } from '../src/shared/brainstate';

const DIR = path.join(__dirname, '..', '..', 'src', 'renderer', 'brainview');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = require as (f: string) => any;
const D = load(path.join(DIR, 'draw.js'));
const P = load(path.join(DIR, 'points.js'));

type Ops = Record<string, number>;
interface Rec { ops: Ops; log: { op: string; alpha: number; arg?: unknown }[]; forbidden: string[]; fillStyles: string[]; strokeStyles: string[] }
const FORBIDDEN = ['filter', 'shadowBlur', 'shadowColor', 'globalCompositeOperation', 'backdropFilter', 'mixBlendMode'];

function fakeCtx(rec: Rec) {
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        rec.ops[k] = (rec.ops[k] || 0) + 1;
        rec.log.push({ op: k, alpha: state.globalAlpha as number, arg: args[0] });
        if (k === 'createRadialGradient') return { addColorStop() { /* nothing */ } };
        return undefined;
      };
    },
    set(t, k: string, v) {
      if (FORBIDDEN.includes(k)) rec.forbidden.push(k);
      if (k === 'fillStyle') rec.fillStyles.push(String(v));
      if (k === 'strokeStyle') rec.strokeStyles.push(String(v));
      t[k] = v; return true;
    },
  };
  return new Proxy(state, handler);
}
const newRec = (): Rec => ({ ops: {}, log: [], forbidden: [], fillStyles: [], strokeStyles: [] });

function rig(over: { size?: string; motion?: string; forced?: boolean; visible?: boolean; focused?: boolean } = {}) {
  const main = newRec(), offs: Rec[] = [], sprites: unknown[] = [];
  let clock = 1000, nextId = 1, makeCalls = 0; const queue = new Map<number, () => void>(); let rafCalls = 0;
  const mkCanvas = (rec: Rec, isMain: boolean) => {
    const ctx = fakeCtx(rec);
    return { width: 0, height: 0, style: {} as Record<string, string>, getContext: () => ctx };
  };
  const canvas = mkCanvas(main, true);
  const host = {
    now: () => clock, dpr: () => 1,
    raf: (fn: () => void) => { rafCalls++; const id = nextId++; queue.set(id, fn); return id; },
    caf: (id: number) => { queue.delete(id); },
    makeCanvas: (w: number, h: number) => { makeCalls++; const r = newRec(); offs.push(r); const c = mkCanvas(r, false); c.width = w; c.height = h; sprites.push(c); return c; },
  };
  const d = D.create({ canvas, host, size: over.size || 'dock', motion: over.motion || 'full', forced: over.forced, visible: over.visible, focused: over.focused });
  const tick = (ms: number): number => { clock += ms; const fns = [...queue.entries()]; queue.clear(); fns.forEach(([, f]) => f()); return fns.length; };
  const settle = (): number => { let n = 0; for (let i = 0; i < 200 && queue.size; i++) { tick(17); n++; } return n; };
  return { d, main, offs, sprites, host, tick, settle, pending: () => queue.size, rafCalls: () => rafCalls, makeCalls: () => makeCalls, advance: (ms: number) => { clock += ms; } };
}
const total = (r: Rec): number => Object.values(r.ops).reduce((a, b) => a + b, 0);
const view = (lobe: string | null, state = 'running', rev = 1, extra: Record<string, unknown> = {}) => ({ lobe, state, rev, trail: [], bloom: [], ...extra });

// ---- the constants are the spec's and brainstate's
assert.strictEqual(D.TRAIL_MAX, TRAIL_MAX, 'FR-040: the trail cap is brainstate.ts TRAIL_MAX');
assert.deepStrictEqual(Object.keys(D.LOBE_COLORS).sort(), [...P.LOBES].sort(), 'each lobe has its own colour (FR-016)');
assert.strictEqual(new Set(Object.values(D.LOBE_COLORS)).size, 7, 'seven different colours');
assert.deepStrictEqual(D.BUDGET_MS, { office: 2, dock: 3, front: 6, still: 0.5 }, 'FR-101: the frame budgets');
assert.ok(D.BLOOM_ALPHA_MAX <= 0.35, 'FR-051: the bloom brightness is capped');

// ---- FR-100: no filter, shadow or blend mode, in the code and at run time
{
  const src = fs.readFileSync(path.join(DIR, 'draw.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/shadowBlur|shadowColor|globalCompositeOperation|\.filter\s*=|backdrop-filter|mix-blend-mode|ctx\.filter/.test(src), 'FR-100: draw.js never names a filter, shadow or blend mode');
  const r = rig();
  r.d.set(view('frontal', 'running', 1, { trail: [{ lobe: 'read' }, { lobe: 'frontal' }], bloom: ['frontal', 'parietal'] }));
  r.settle();
  r.d.set(view('parietal', 'failed', 2)); r.settle();
  assert.deepStrictEqual([...r.main.forbidden, ...r.offs.flatMap((o) => o.forbidden)], [], 'FR-102: 0 filter, shadowBlur or blend-mode writes in Full');
}

// ---- FR-102: points per frame never above the FR-010 size, one canvas per placement
for (const size of ['office', 'dock', 'front']) {
  const r = rig({ size });
  assert.strictEqual(r.d.pointCount(), P.SIZES[size], `${size}: the brain has the FR-010 points`);
  P.LOBES.forEach((l: string, i: number) => { r.d.set(view(l, 'running', i + 1)); r.settle(); });
  assert.ok(r.d.stats.pointsMax > 0 && r.d.stats.pointsMax <= P.SIZES[size], `${size}: a frame draws at most ${P.SIZES[size]} points (${r.d.stats.pointsMax})`);
  const lit = P.build(size).byLobe.reduce((m: number, l: Uint32Array) => Math.max(m, l.length), 0);
  assert.ok(r.d.stats.pointsMax <= lit, `${size}: a frame draws only the lit lobe's points, the rest is the base layer`);
  assert.strictEqual(r.d.stats.canvases, 1, `${size}: one canvas`);
  assert.strictEqual(r.d.stats.baseBuilds, 1, `${size}: the base layer is built once, not per frame`);
  assert.strictEqual(r.makeCalls(), 1 + 7, `${size}: one base layer and seven glow sprites, made once`);
}

// ---- FR-103: idle is free (no loop left, no frame while nothing happens)
{
  const r = rig();
  r.d.set(view('cerebellum'));
  assert.strictEqual(r.pending(), 1, 'a burst runs a loop');
  assert.strictEqual(r.d.stats.loopRunning, true);
  r.settle();
  assert.strictEqual(r.pending(), 0, 'FR-103: when the burst ends no requestAnimationFrame is pending');
  assert.strictEqual(r.d.stats.loopRunning, false);
  const frames = r.d.stats.frames, ops = total(r.main), raf = r.rafCalls();
  r.advance(60000); assert.strictEqual(r.tick(1000), 0, 'nothing is queued');
  assert.deepStrictEqual([r.d.stats.frames, total(r.main), r.rafCalls()], [frames, ops, raf], 'a minute with no event: 0 frames, 0 draw ops, 0 loop requests');
  r.d.set(view('cerebellum')); // the same view again changes nothing
  assert.deepStrictEqual([r.d.stats.frames, r.pending()], [frames, 0], 'the same state again draws nothing');
}

// ---- FR-060, SC-004: Still gives one frame per change, never a loop
for (const [name, mk] of [['Still', () => rig({ motion: 'still' })], ['forced colours', () => rig({ forced: true })]] as const) {
  const r = mk();
  const f0 = r.d.stats.frames;
  r.d.set(view('frontal', 'running', 1)); r.d.set(view('occipital', 'done', 2, { bloom: ['frontal'] })); r.d.set(view('stem', 'failed', 3));
  assert.strictEqual(r.d.stats.frames - f0, 3, `${name}: one frame per change`);
  assert.strictEqual(r.rafCalls(), 0, `${name}: 0 animation frames requested`);
  assert.strictEqual(r.pending(), 0);
  assert.strictEqual(r.d.stats.spriteBuilds, 0, `${name}: no glow sprites`);
  assert.strictEqual(r.d.mode(), 'still');
}
{
  const r = rig({ motion: 'full' });
  r.d.set(view('frontal')); r.d.setMotion('still');
  assert.strictEqual(r.pending(), 0, 'switching to Still cancels a running loop');
  const n = r.rafCalls(); r.d.set(view('parietal', 'done', 2)); assert.strictEqual(r.rafCalls(), n, 'Still: no more loops');
}

// ---- FR-104: hidden draws nothing; shown again draws the latest state once; unfocused is Still
{
  const r = rig();
  r.d.set(view('frontal')); // a burst is running
  r.d.setVisible(false);
  assert.strictEqual(r.pending(), 0, 'hiding cancels the loop');
  const frames = r.d.stats.frames, ops = total(r.main);
  r.d.set(view('occipital', 'done', 2)); r.d.set(view('stem', 'failed', 3, { bloom: ['stem'] })); r.tick(500);
  assert.deepStrictEqual([r.d.stats.frames, total(r.main), r.pending()], [frames, ops, 0], 'hidden: 0 frames, 0 draw ops, no loop');
  assert.strictEqual(r.d.stats.framesHidden, 0);
  r.d.setVisible(true);
  assert.strictEqual(r.d.stats.frames, frames + 1, 'shown again: exactly one frame');
  assert.strictEqual(r.pending(), 0, 'and no loop');
  assert.ok(r.main.fillStyles.includes(D.LOBE_COLORS.stem) && !r.main.fillStyles.includes(D.LOBE_COLORS.occipital), 'the latest state (the stem) is what the one frame drew, not the one before');
  assert.strictEqual(r.main.ops.lineTo, 2, 'and it is the failed cross');
  r.d.setVisible(true); assert.strictEqual(r.d.stats.frames, frames + 1, 'shown twice: nothing more');
}
{
  const r = rig({ visible: false });
  r.d.set(view('frontal'));
  assert.strictEqual(r.d.stats.frames, 0, 'born hidden: nothing drawn');
}
{
  const r = rig();
  r.d.set(view('frontal')); r.d.setFocused(false);
  assert.strictEqual(r.pending(), 0, 'unfocused: the animation stops');
  assert.strictEqual(r.d.mode(), 'still');
  const n = r.rafCalls(); r.d.set(view('parietal', 'done', 2)); assert.strictEqual(r.rafCalls(), n, 'unfocused: a change is drawn as Still, with no loop');
  r.d.setFocused(true); assert.strictEqual(r.d.mode(), 'full', 'focused again: the user\'s setting');
}

// ---- Calm: thin burst, no glow, no bloom; Full has both
{
  const full = rig(), calm = rig({ motion: 'calm' });
  const bloom = { bloom: ['frontal', 'parietal'] };
  full.d.set(view('frontal', 'running', 1, bloom)); full.settle();
  calm.d.set(view('frontal', 'running', 1, bloom)); calm.settle();
  const di = (r: Rec): number => r.ops.drawImage || 0;
  assert.ok(di(full.main) > full.d.stats.frames, 'Full stamps glow sprites over the base layer');
  assert.strictEqual(di(calm.main), calm.d.stats.frames, 'Calm: only the base layer is stamped, no glow and no bloom');
  assert.strictEqual(calm.d.stats.spriteBuilds, 7, 'sprites exist but are not used'); // built with the loop; Calm never stamps them
  assert.ok(calm.d.stats.pointsMax <= full.d.stats.pointsMax, 'Calm draws no more points than Full');
}

// ---- FR-051: the honest bloom: only used lobes, one swell, capped, none in Calm or Still
{
  const r = rig();
  r.d.set(view(null, 'done', 1, { bloom: ['frontal', 'cerebellum'] }));
  const alphas: number[] = [];
  const stampsBefore = r.sprites.length;
  assert.strictEqual(stampsBefore, 7, 'the seven sprites exist before the first frame; the base layer is made by it');
  for (let i = 0; i < 120 && r.pending(); i++) {
    const n = r.main.log.length; r.tick(17);
    const stamps = r.main.log.slice(n).filter((l) => l.op === 'drawImage' && r.sprites.slice(0, 7).includes(l.arg));
    const used = new Set(stamps.map((s) => r.sprites.indexOf(s.arg)));
    used.forEach((u) => assert.ok([P.LOBES.indexOf('frontal'), P.LOBES.indexOf('cerebellum')].includes(u), 'only the lobes the turn used swell'));
    if (stamps.length) alphas.push(Math.max(...stamps.map((s) => s.alpha)));
  }
  assert.ok(alphas.length > 10, 'the swell is drawn over several frames');
  assert.ok(Math.max(...alphas) <= D.BLOOM_ALPHA_MAX + 1e-9, 'brightness capped');
  let turns = 0; for (let i = 2; i < alphas.length; i++) if ((alphas[i] - alphas[i - 1]) * (alphas[i - 1] - alphas[i - 2]) < 0) turns++;
  assert.ok(turns <= 1, `one swell: the brightness rises once and falls once (${turns} turning points)`);
  assert.ok(alphas.length * 17 >= 800 && alphas.length * 17 <= 1100, 'spread over about 0.9 s, so under 3 luminance changes a second');
  assert.strictEqual(r.pending(), 0);
}

// ---- FR-040: the trail is at most 24 steps
{
  const r = rig({ motion: 'still' });
  const trail = Array.from({ length: 60 }, (_, i) => ({ lobe: P.LOBES[i % 4], state: 'done' }));
  r.d.set(view(null, 'done', 1, { trail }));
  assert.strictEqual(r.main.ops.lineTo, TRAIL_MAX - 1, `a trail of 60 draws the last ${TRAIL_MAX} steps: ${TRAIL_MAX - 1} lines`);
}

// ---- FR-016: the marker says the state by shape
{
  const shape = (state: string): Ops => { const r = rig({ motion: 'still' }); r.d.set(view('frontal', state)); return r.main.ops; };
  const running = shape('running'), done = shape('done'), failed = shape('failed');
  assert.strictEqual(running.arc, 1); assert.ok(!running.fill, 'running: a ring (stroke, no fill)');
  assert.strictEqual(done.arc, 1); assert.strictEqual(done.fill, 1, 'done: a filled disc');
  assert.ok(!failed.arc && failed.lineTo === 2, 'failed: a cross (two lines, no disc)');
}

// ---- forced colours: system colours, no gradient
{
  const r = rig({ forced: true });
  r.d.set(view('frontal', 'running', 1, { trail: [{ lobe: 'read' }, { lobe: 'frontal' }] }));
  const all = [...r.main.fillStyles, ...r.main.strokeStyles, ...r.offs.flatMap((o) => o.fillStyles)];
  assert.ok(all.length > 0 && all.every((c) => ['CanvasText', 'Highlight'].includes(c)), 'FR-096: only CanvasText and Highlight: ' + [...new Set(all)].join(','));
  assert.ok(!r.offs.some((o) => o.ops.createRadialGradient), 'no gradient');
}

// ---- constitution V: the frame budget (a fake clock; 3 frames in a row over budget drop the canvas to Calm)
{
  const r = rig({ size: 'dock' });
  // every read of the clock advances it 5 ms, so each frame measures 5 ms
  let slow = true;
  let t = 1000; (r.host as { now: () => number }).now = () => { t += slow ? 5 : 0.1; return t; };
  r.d.set(view('frontal', 'running', 1));
  r.settle();
  assert.strictEqual(r.d.stats.degraded, true, 'three frames over the dock budget: this canvas drops to Calm');
  assert.strictEqual(r.d.mode(), 'calm');
  assert.ok(r.d.stats.overBudget >= D.OVER_LIMIT);
  slow = false;
  const fast = rig({ size: 'dock' }); let t2 = 1000; (fast.host as { now: () => number }).now = () => { t2 += 0.1; return t2; };
  fast.d.set(view('frontal', 'running', 1)); fast.settle();
  assert.strictEqual(fast.d.stats.degraded, false, 'frames inside the budget never degrade');
  assert.strictEqual(fast.d.stats.overBudget, 0);
}
console.log('braindraw: ok');

// ---- the page loads brainstate.js and brainsurface.js as plain scripts (one global scope): they must not redeclare or overwrite what
// the scripts before them defined (a top-level `function maskText` once replaced redact.js's own and a `const oneLine` made the load fail)
{
  const vm = require('vm') as typeof import('vm');
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const shared = [...html.matchAll(/<script src="(\.\.\/shared\/[a-z-]+\.js)"/g)].map((m) => m[1]);
  assert.ok(shared.includes('../shared/redact.js') && shared.length >= 4, 'the page scripts of src/shared are found in index.html: ' + shared.join(','));
  const win = vm.createContext({}) as Record<string, unknown>; win.self = win;
  const run = (f: string): void => { vm.runInContext(fs.readFileSync(f, 'utf8'), win, { filename: f }); };
  run(path.join(root, 'src', 'renderer', 'exports-shim.js'));
  for (const s of [...shared, '../shared/lights.js', '../shared/realoffice-layout.js', '../shared/realoffice-arrangements.js']) run(path.join(root, 'dist', 'renderer', s));
  const names = (): Map<string, unknown> => new Map(Object.getOwnPropertyNames(win).map((k) => [k, win[k]]));
  const lexical = (code: string): string[] => { const o: string[] = []; for (const m of code.matchAll(/^(?:const|let|function|var|class) ([A-Za-z_$][\w$]*)/gm)) o.push(m[1]); return o; };
  const before = names();
  const files = ['brainstate.js', 'brainsurface.js'].map((f) => path.join(root, 'dist', 'shared', f));
  const declared = files.flatMap((f) => lexical(fs.readFileSync(f, 'utf8')));
  assert.ok(declared.length > 20);
  // a global `function name` replaces a former one silently; a `const` over a former one throws: both are forbidden, so no declared name was there before
  for (const n of declared) assert.ok(!before.has(n), `brainstate.js and brainsurface.js declare a global "${n}" that an earlier page script already has (it would be overwritten or the load would throw)`);
  files.forEach(run);
  const rd = win.exports as Record<string, unknown>;
  assert.strictEqual(typeof rd.cardLines, 'function', 'the page gets brainsurface\'s functions');
  assert.strictEqual(typeof rd.brainState, 'function', 'and brainstate\'s');
  for (const [k, v] of before) if (k !== 'exports') assert.strictEqual(win[k], v, `loading the brain files left the global "${k}" as it was`);
}
console.log('braindraw: page load ok');
