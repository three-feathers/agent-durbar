/** Brain view renderer (spec 106 T005, FR-013, FR-040, FR-051, FR-060, FR-100..FR-104, SC-004): `npm run test:braindraw`.
 *  Op counts only, no timing asserts (AGENTS.md Timing): the renderer runs in Node on a recording context and a fake clock. No credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { TRAIL_MAX } from '../src/shared/brainstate';

const DIR = path.join(__dirname, '..', '..', 'src', 'renderer', 'brainview');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = require as (f: string) => any;
/** a source read as text: a Windows checkout may hold CRLF, and an indexOf or regex with a newline in it must see LF (as check-inbox-text.js does) */
const lf = (t: string): string => t.replace(/\r\n/g, '\n');
const readSrc = (f: string): string => lf(fs.readFileSync(f, 'utf8'));
const D = load(path.join(DIR, 'draw.js'));
const P = load(path.join(DIR, 'points.js'));

type Ops = Record<string, number>;
interface Rec { onOp?: (k: string) => void; ops: Ops; log: { op: string; alpha: number; arg?: unknown }[]; forbidden: string[]; fillStyles: string[]; strokeStyles: string[] }
const FORBIDDEN = ['filter', 'shadowBlur', 'shadowColor', 'globalCompositeOperation', 'backdropFilter', 'mixBlendMode'];

function fakeCtx(rec: Rec) {
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        rec.ops[k] = (rec.ops[k] || 0) + 1; if (rec.onOp) rec.onOp(k);
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

function rig(over: { size?: string; motion?: string; forced?: boolean; visible?: boolean; focused?: boolean; skin?: unknown } = {}) {
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
  const d = D.create({ canvas, host, size: over.size || 'dock', motion: over.motion || 'full', forced: over.forced, visible: over.visible, focused: over.focused, skin: over.skin });
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
  const src = readSrc(path.join(DIR, 'draw.js')).replace(/\/\*[\s\S]*?\*\//g, '');
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
  assert.strictEqual(stampsBefore, 8, 'the base layer (made at once) and the seven sprites exist before the first frame');
  for (let i = 0; i < 120 && r.pending(); i++) {
    const n = r.main.log.length; r.tick(17);
    const stamps = r.main.log.slice(n).filter((l) => l.op === 'drawImage' && r.sprites.slice(1, 8).includes(l.arg));
    const used = new Set(stamps.map((s) => r.sprites.indexOf(s.arg) - 1)); // sprite 0 is the base layer
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

// ---- FR-104 (hidden mid-burst): a burst cut short by hiding leaves a part frame; shown again, the settled state is drawn once with no new event
{
  const r = rig();
  r.d.set(view('frontal')); r.tick(17); // t is about 0.07: the lobe is part lit
  const part = r.d.stats.pointsLast;
  r.d.setVisible(false); r.tick(500);
  const frames = r.d.stats.frames;
  r.d.setVisible(true);
  assert.strictEqual(r.d.stats.frames, frames + 1, 'hidden mid-burst, then shown: one frame, with no event in between');
  assert.ok(r.d.stats.pointsLast > part, `the one frame draws the whole lobe, not the part frame (${part} then ${r.d.stats.pointsLast})`);
  assert.strictEqual(r.pending(), 0, 'and no loop');
}

// ---- the picture is never "the same" across agents: rev counts per agent, so the view carries the agent
{
  const r = rig();
  r.d.set({ ...view('frontal', 'done', 3, { trail: [{ lobe: 'frontal', state: 'done' }] }), id: 'agent-a' }); r.settle();
  const f = r.d.stats.frames;
  r.d.set({ ...view('frontal', 'done', 3, { trail: [{ lobe: 'frontal', state: 'done' }] }), id: 'agent-b' }); r.settle();
  assert.ok(r.d.stats.frames > f, 'another agent with the same lobe, state, rev and trail length is drawn again');
  const g = r.d.stats.frames; r.d.set({ ...view('frontal', 'done', 3, { trail: [{ lobe: 'frontal', state: 'done' }] }), id: 'agent-b' });
  assert.strictEqual(r.d.stats.frames, g, 'the same agent with nothing changed is not drawn again');
}

// ---- FR-102: the base layer (all the points) is built outside any frame; a frame draws only the lit lobe
{
  const r = rig({ size: 'dock' });
  assert.strictEqual(r.d.stats.frames, 0);
  assert.deepStrictEqual([r.d.stats.baseBuilds, r.d.stats.basePoints], [1, P.SIZES.dock], 'the base layer is built at once, before any frame, and holds the dock set');
  const fills = (): number => r.main.ops.fillRect || 0;
  r.d.set(view('frontal')); r.tick(17);
  const lit = P.build('dock').byLobe[P.LOBES.indexOf('frontal')].length;
  assert.ok(fills() > 0 && fills() <= lit, `the first frame draws at most the lit lobe's ${lit} points, never the whole set (${fills()})`);
}

// ---- Calm: a thin burst (half the points, 150 ms) and Full's burst are not the same
{
  assert.strictEqual(D.BURST_MS.calm, 150); assert.strictEqual(D.BURST_MS.full, 250);
  const idx = P.build('dock').byLobe[P.LOBES.indexOf('frontal')].length;
  const calm = rig({ motion: 'calm' }), full = rig({ motion: 'full' });
  calm.d.set(view('frontal')); calm.tick(30); full.d.set(view('frontal')); full.tick(30);
  assert.strictEqual(calm.d.stats.pointsLast, Math.ceil(idx * (30 / 150) * 0.5), 'Calm: half the points of its own burst progress');
  assert.strictEqual(full.d.stats.pointsLast, Math.ceil(idx * (30 / 250)), 'Full: all the points of its burst progress');
}

// ---- constitution V: "3 frames in a row": a fast frame between slow ones starts the count again
{
  const r = rig({ size: 'dock' });
  const pattern = [5, 5, 0.1, 5, 5, 0.1]; let i = 0, t = 1000;
  (r.host as { now: () => number }).now = () => t;
  r.main.onOp = (k) => { if (k === 'clearRect') t += pattern[(i++) % pattern.length]; }; // each frame's painted time is the next value
  r.d.set(view('frontal')); r.settle();
  assert.strictEqual(r.d.stats.degraded, false, 'slow, slow, fast, slow, slow: never three in a row, so the canvas stays in Full');
  assert.ok(r.d.stats.overBudget >= 4, 'the slow frames were counted (' + r.d.stats.overBudget + ')');
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
// ---- skins (FR-110..FR-112): only the arcade has one; its colours come from the page's tokens, with a fallback; a skin carries no size
{
  const K = load(path.join(DIR, 'skins.js'));
  assert.strictEqual(K.forWorld('', null).id, 'neutral'); assert.strictEqual(K.forWorld('photo', null).id, 'neutral'); assert.strictEqual(K.forWorld('cave', null).id, 'cave', 'the cave has its own skin (T027)');
  const a = K.forWorld('retro', (n: string) => (n === '--tone-warn-ink' ? ' #123456 ' : ''));
  assert.strictEqual(a.id, 'arcade'); assert.strictEqual(a.shape, 'square'); assert.strictEqual(a.colors.frontal, '#123456', 'a token the page has is read'); assert.strictEqual(a.colors.stem, '#ffec27', 'a missing token falls back');
  assert.deepStrictEqual(Object.keys(a.colors).sort(), [...P.LOBES].sort(), 'one colour per lobe');
  assert.deepStrictEqual(Object.keys(a).sort(), ['baseAlpha', 'colors', 'id', 'marker', 'shape', 'trail'], 'a skin has colours, a shape and inks, no size or position');
  assert.strictEqual(K.forWorld('retro', () => { throw new Error('x'); }).colors.frontal, '#ffc35c', 'a failing read falls back');
  // the arcade's fallback colours are theme.js's own retro values (a drift would go unseen: the page reads tokens, a test page does not)
  const themeSrc = readSrc(path.join(__dirname, '..', '..', 'src', 'renderer', 'theme.js'));
  const retroOf = (src: string): string => { const t = lf(src); return t.slice(t.indexOf("retro:{\n      name:'Retro arcade'"), t.indexOf("shadow:{'--shadow-card':'0 2px 0 rgba(0,0,0,.5)'")); };
  const retro = retroOf(themeSrc);
  assert.ok(retro.length > 500, 'the retro world block of theme.js was found');
  // a Windows checkout may hold CRLF: the same source converted to CRLF finds the same block (raw indexOf with a newline gives -1 there)
  const crlf = themeSrc.replace(/\n/g, '\r\n');
  assert.strictEqual(crlf.indexOf("retro:{\n      name:'Retro arcade'"), -1, 'CRLF mutant: the raw CRLF text really cannot be searched with a newline');
  assert.strictEqual(retroOf(crlf), retro, 'CRLF: the retro world block of a CRLF theme.js is found and equals the LF one');
  for (const [lobe, [tok]] of Object.entries(K.ARCADE_TOKENS as Record<string, [string, string]>)) {
    const m = retro.match(new RegExp("'" + tok + "':'(#[0-9a-fA-F]+)'"));
    assert.ok(m, `theme.js retro sets ${tok}`);
    assert.strictEqual(K.forWorld('retro', null).colors[lobe], m![1], `skin fallback for ${lobe} equals theme.js retro ${tok}`);
  }
  for (const [tok, got] of [['--ink', K.forWorld('retro', null).marker], ['--ink-2', K.forWorld('retro', null).trail]]) {
    assert.strictEqual(got, (retro.match(new RegExp("'" + tok + "':'(#[0-9a-fA-F]+)'")) || [])[1], `skin fallback for ${tok} equals theme.js retro`);
  }
  // squares, never discs (FR-110): counted on the drawing context itself, not on the renderer's own counters (G2): an arc on the base layer fails here
  const baseOf = (r: ReturnType<typeof rig>) => [...r.offs].reverse().sort((a, b) => total(b) - total(a))[0] as Rec; // the base layer: the offscreen canvas with the most calls (a glow sprite has a handful)
  for (const [name, skin] of [['neutral', K.NEUTRAL], ['arcade', K.forWorld('retro', null)]] as const) {
    const r = rig({ skin }); const b = baseOf(r);
    assert.ok(b, `${name}: the base layer was drawn`);
    assert.strictEqual(b.ops.arc || 0, 0, `${name} skin: no point is drawn as a disc (arc calls on the base layer)`);
    assert.strictEqual(b.ops.fillRect, r.d.stats.basePoints, `${name} skin: one filled square per point on the base layer`);
    assert.strictEqual(r.d.stats.pointRects, b.ops.fillRect, `${name} skin: the renderer's own square count matches the drawing calls`);
  }
  // the cave skin (T027, #1219): its colours are read from the page's tokens and NONE is written in skins.js (no literal colour); a missing token leaves that lobe to draw.js's own colour
  {
    const toks: Record<string, string> = { '--tone-warn-ink': ' #111111 ', '--focus': '#222222', '--sel-border': '#333333', '--ink-2': '#444444', '--ink': '#555555' };
    const c = K.forWorld('cave', (n: string) => toks[n] || '');
    assert.strictEqual(c.id, 'cave'); assert.strictEqual(c.shape, 'pebble', 'cave skin: pebble points');
    assert.strictEqual(c.colors.frontal, '#111111', 'cave skin: the frontal lobe reads --tone-warn-ink'); assert.strictEqual(c.colors.stem, '#222222', 'cave skin: the stem reads the cave --focus');
    assert.strictEqual(c.colors.port, '#333333', 'cave skin: the port reads --sel-border'); assert.strictEqual(c.trail, '#444444'); assert.strictEqual(c.marker, '#555555');
    assert.strictEqual(c.colors.occipital, undefined, 'cave skin: a token the page lacks leaves the lobe to draw.js, no colour of its own in the skin');
    assert.deepStrictEqual(Object.keys(c).sort(), ['baseAlpha', 'colors', 'id', 'marker', 'shape', 'trail'], 'cave skin: colours, a shape and inks, no size or position');
    assert.deepStrictEqual(Object.keys(K.CAVE_TOKENS).sort(), Object.keys(K.ARCADE_TOKENS).sort(), 'cave skin: one token per lobe');
    const src = fs.readFileSync(path.join(DIR, 'skins.js'), 'utf8'), caveSrc = src.slice(src.indexOf('const CAVE_TOKENS'), src.indexOf('/* world: the shown'));
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(caveSrc), 'cave skin: no literal colour in the cave part of skins.js');
    assert.strictEqual(K.forWorld('cave', () => { throw new Error('x'); }).id, 'cave'); assert.deepStrictEqual(K.forWorld('cave', null).colors, {}, 'cave skin: no page, no colours of its own');
    const r = rig({ skin: c }); const b = baseOf(r);
    assert.strictEqual(b.ops.arc, r.d.stats.basePoints, 'cave skin: one disc (arc) per point on the base layer');
    assert.strictEqual(b.ops.fillRect || 0, 0, 'cave skin: no square on the base layer');
    const n = rig({ skin: K.NEUTRAL });
    assert.strictEqual(r.d.stats.basePoints, n.d.stats.basePoints, 'cave skin: the same number of points as neutral'); assert.deepStrictEqual(r.d.geometry(), n.d.geometry(), 'cave skin: the same positions and size as neutral');
    assert.ok(baseOf(r).fillStyles.includes('#111111'), 'cave skin: drawn in the page-token colour');
  }
  // a world switch repaints with the new colours (G1): setSkin rebuilds the base layer in the new lobe colours and drops the old ones
  {
    const r = rig(); const A = K.forWorld('retro', null);
    assert.ok(baseOf(r).fillStyles.includes(D.LOBE_COLORS ? D.LOBE_COLORS.frontal : '#e0a458'), 'neutral base uses the neutral frontal colour');
    r.d.setSkin(A); const b = baseOf(r);
    assert.ok(b.fillStyles.includes(A.colors.frontal), 'setSkin: the rebuilt base layer is drawn in the arcade colours');
    assert.ok(!b.fillStyles.includes('#e0a458'), 'setSkin: the rebuilt base layer keeps none of the old colours');
    assert.strictEqual(r.d.skin(), 'arcade'); assert.strictEqual(r.d.colors().frontal, A.colors.frontal, 'setSkin: the colours() are the arcade ones');
    r.d.setSkin(K.NEUTRAL); assert.ok(baseOf(r).fillStyles.includes('#e0a458') && !baseOf(r).fillStyles.includes(A.colors.frontal), 'setSkin back: neutral colours again');
  }
}
console.log('braindraw: ok');

// ---- the page loads brainstate.js and brainsurface.js as plain scripts (one global scope): they must not redeclare or overwrite what
// the scripts before them defined (a top-level `function maskText` once replaced redact.js's own and a `const oneLine` made the load fail)
{
  const vm = require('vm') as typeof import('vm');
  const root = path.join(__dirname, '..', '..');
  const html = readSrc(path.join(root, 'src', 'renderer', 'index.html'));
  const shared = [...html.matchAll(/<script src="(\.\.\/shared\/[a-z-]+\.js)"/g)].map((m) => m[1]);
  assert.ok(shared.includes('../shared/redact.js') && shared.length >= 4, 'the page scripts of src/shared are found in index.html: ' + shared.join(','));
  const win = vm.createContext({}) as Record<string, unknown>; win.self = win;
  const run = (f: string): void => { vm.runInContext(fs.readFileSync(f, 'utf8'), win, { filename: f }); };
  run(path.join(root, 'src', 'renderer', 'exports-shim.js'));
  for (const s of [...shared, '../shared/lights.js', '../shared/realoffice-layout.js', '../shared/realoffice-arrangements.js']) run(path.join(root, 'dist', 'renderer', s));
  const names = (): Map<string, unknown> => new Map(Object.getOwnPropertyNames(win).map((k) => [k, win[k]]));
  const lexical = (code: string): string[] => { const o: string[] = []; for (const m of code.matchAll(/^(?:const|let|function|var|class) ([A-Za-z_$][\w$]*)/gm)) o.push(m[1]); return o; };
  const before = names();
  const exportsBefore = new Map(Object.entries(win.exports as Record<string, unknown>));
  const files = ['brainstate.js', 'brainsurface.js'].map((f) => path.join(root, 'dist', 'shared', f));
  const declared = files.flatMap((f) => lexical(readSrc(f)));
  assert.ok(declared.length > 20);
  // a global `function name` replaces a former one silently; a `const` over a former one throws: both are forbidden, so no declared name was there before
  for (const n of declared) assert.ok(!before.has(n), `brainstate.js and brainsurface.js declare a global "${n}" that an earlier page script already has (it would be overwritten or the load would throw)`);
  files.forEach(run);
  const rd = win.exports as Record<string, unknown>;
  assert.strictEqual(typeof rd.cardLines, 'function', 'the page gets brainsurface\'s functions');
  assert.strictEqual(typeof rd.brainState, 'function', 'and brainstate\'s');
  for (const [k, v] of before) if (k !== 'exports') assert.strictEqual(win[k], v, `loading the brain files left the global "${k}" as it was`);
  // `window.exports` is the object redact.js, quota and cost code export into (window.DurbarRedact is the same object): the brain files add names to it and must replace none
  for (const [k, v] of exportsBefore) assert.strictEqual(rd[k], v, `loading the brain files left window.exports.${k} (a function or constant of another shared module) as it was`);
  assert.ok(exportsBefore.size > 20 && Object.keys(rd).length > exportsBefore.size, 'the guard compared a real set of exports, and the brain files did add theirs');
  // the plain page scripts that are not in the load above (sim.js, demo.js, dialog.js) share the global scope too: no top-level name of the brain files is theirs
  const others = ['sim.js', 'demo.js', 'dialog.js'].flatMap((f) => lexical(readSrc(path.join(root, 'dist', 'renderer', f))));
  assert.ok(others.length > 50, 'the other page scripts were read');
  for (const n of declared) assert.ok(!others.includes(n), `brainstate.js or brainsurface.js declares the global "${n}", which sim.js, demo.js or dialog.js also declares`);
}
console.log('braindraw: page load ok');

// ---- the dock (dock.js, T006) on a minimal fake page: name masking, the open chat only, legend, roomy, hidden contexts, blur, forgetting, the cap, the Motion button's focus, FR-086's inputs on every text
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const H = load(path.join(DIR, 'dock.js'));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const R = require('../src/shared/redact'); const BS = require('../src/shared/brainstate'); const SF = require('../src/shared/brainsurface');
  const root = path.join(__dirname, '..', '..', 'src', 'renderer');
  const USAGE = load(path.join(root, 'usagetotals.js')), COST = load(path.join(root, 'costtable.js'));
  const mask = { ...R, units: { validNano: USAGE.validNano, AIU_USD: COST.AIU_USD, money: COST.money, creditsWord: 'AIU', estimateWord: 'Claude (est.)' } };
  const GH = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const SK = 'sk-live-' + 'a1B2c3D4e5F6g7H8i9J0k1L2', SESS = 'SESS_' + 'q9W8e7R6t5Y4u3I2o1P0aSdFg';
  type Fn = (...a: unknown[]) => void;
  function fakeEl(): Record<string, unknown> {
    const kids = new Map<string, Record<string, unknown>>(), classes = new Set<string>(), attrs: Record<string, string> = {}, listeners: Record<string, Fn[]> = {};
    const e: Record<string, unknown> = {
      className: '', textContent: '', innerHTML: '', style: {}, width: 0, height: 0, attrs, listeners, classes,
      setAttribute: (k: string, v: unknown) => { attrs[k] = String(v); }, getAttribute: (k: string) => attrs[k],
      addEventListener: (k: string, f: Fn) => { (listeners[k] = listeners[k] || []).push(f); }, appendChild: () => undefined,
      classList: { toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); }, add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) },
      querySelector: (sel: string) => { if (!kids.has(sel)) kids.set(sel, fakeEl()); return kids.get(sel); },
      getContext: () => fakeCtx(newRec()),
    };
    return e;
  }
  function page(nameOf: (id: string) => string) {
    let clock = 5000; const timers: Fn[] = [], rafs: Fn[] = [];
    const docL: Record<string, Fn[]> = {}, winL: Record<string, Fn[]> = {};
    const mqReduce = { matches: false, listeners: [] as Fn[], addEventListener: (_: string, f: Fn) => { mqReduce.listeners.push(f); } };
    const mqForced = { matches: false, listeners: [] as Fn[], addEventListener: (_: string, f: Fn) => { mqForced.listeners.push(f); } };
    const doc: { hidden: boolean; body: { classes: Set<string>; [k: string]: unknown }; [k: string]: unknown } = { hidden: false, hasFocus: () => true, body: { appendChild: () => undefined, classes: new Set<string>(), classList: { contains(c: string) { return (doc.body.classes as Set<string>).has(c); } } }, createElement: () => fakeEl(), addEventListener: (k: string, f: Fn) => { (docL[k] = docL[k] || []).push(f); } };
    const observers: { cb: Fn; target: unknown }[] = [];
    const rootEl = { nodeType: 1, dataset: {} as Record<string, string> };
    doc.documentElement = rootEl;
    const win = {
      DurbarBrainSkins: load(path.join(DIR, 'skins.js')), getComputedStyle: () => ({ getPropertyValue: () => '' }),
      MutationObserver: class { constructor(public cb: Fn) { /* nothing */ } observe(target: unknown): void { observers.push({ cb: this.cb, target }); } },
      exports: { ...BS, ...SF }, DurbarBrainDraw: D, performance: { now: () => clock }, devicePixelRatio: 1,
      matchMedia: (q: string) => (q.includes('reduced') ? mqReduce : q.includes('forced') ? mqForced : { matches: false, addEventListener: () => undefined }),
      requestAnimationFrame: (f: Fn) => rafs.push(f), cancelAnimationFrame: () => undefined,
      setTimeout: (f: Fn) => timers.push(f), clearTimeout: () => undefined, addEventListener: (k: string, f: Fn) => { (winL[k] = winL[k] || []).push(f); },
    };
    doc.body.classes.add('panel-open'); /* a chat is open: the dock lives in its right rail */
    const host = H.start({ doc, win, mask, now: () => clock, name: nameOf, folder: () => '/home/ana/work/x' });
    host.mount({ appendChild: () => undefined }); host.show('a');
    const flush = (): void => { for (let i = 0; i < 50 && timers.length; i++) timers.splice(0).forEach((f) => f()); };
    const ev = (n: number, tool = 'bash'): unknown => ({ type: 'toolCall', sessionId: 'x', callId: 'c' + n, tool, phase: 'start', args: { command: 'ls' }, timestamp: clock });
    return { host, doc, win, docL, winL, rootEl, observers, mqReduce, mqForced, flush, ev, tick: (ms: number) => { clock += ms; }, rafs };
  }
  const q = (h: { el: Record<string, unknown> }, s: string): { attrs: Record<string, string>; listeners: Record<string, Fn[]> } => (h.el.querySelector as (s: string) => never)(s);

  const txt = (h: { el: Record<string, unknown> }, sel: string): string => String((h.el.querySelector as (s: string) => Record<string, unknown>)(sel).textContent);
  const html = (h: { el: Record<string, unknown> }, sel: string): string => String((h.el.querySelector as (s: string) => Record<string, unknown>)(sel).innerHTML);
  const drain = (p: { rafs: Fn[]; tick: (ms: number) => void }): void => { for (let i = 0; i < 40 && p.rafs.length; i++) { p.tick(17); p.rafs.splice(0).forEach((f) => f()); } };

  // the region's name is masked like every other surface (FR-021, FR-085)
  {
    const p = page(() => 'Ada ' + GH + ' ‮\nx'); p.host.feed('a', 'x', p.ev(1)); p.flush();
    const label = (p.host.el.attrs as Record<string, string>)['aria-label'];
    assert.ok(label.startsWith('Brain view, Ada') && !/ghp_|[‪-‮⁦-⁩\n]/.test(label), 'the region label holds no token, bidi control or line break: ' + label);
    assert.ok(!/ghp_/.test(txt(p.host, '.bv-title')), 'the title holds no token');
  }
  // FR-030: the dock shows the OPEN chat's agent; another agent's events wait for its chat
  {
    const p = page((id) => (id === 'b' ? 'Bo' : 'Ada'));
    p.host.feed('a', 'Ada', p.ev(1)); p.flush(); drain(p);
    assert.ok(/Shell/.test(txt(p.host, '.bv-c1')), 'the open chat\'s step is on the card');
    const f = p.host.draw.stats.frames;
    p.host.feed('b', 'Bo', { type: 'toolCall', sessionId: 'b', callId: 'b1', tool: 'view', phase: 'start', args: { path: 'src/b.ts' }, timestamp: 1 }); p.flush(); drain(p);
    assert.strictEqual(p.host.shown(), 'a', 'open chat only: another agent\'s event does not take the dock (the floating host showed the most recent agent)');
    assert.ok(/Shell/.test(txt(p.host, '.bv-c1')) && p.host.draw.stats.frames === f, 'open chat only: nothing of the other agent is painted');
    p.host.show('b');
    assert.ok(/Read/.test(txt(p.host, '.bv-c1')) && /b\.ts/.test(txt(p.host, '.bv-c2')) && txt(p.host, '.bv-title') === 'Brain · Bo', 'a switch of chat paints that agent\'s kept state at once');
    p.host.show('c');
    assert.strictEqual(txt(p.host, '.bv-c1'), 'Waiting for the first step', 'an agent with no event yet: the waiting card (edge case)');
    assert.strictEqual(txt(p.host, '.bv-sum'), 'No steps this turn', 'and no steps');
  }
  // FR-025: Latest steps: "N steps this turn · M earlier" and the newest 24 as text, from turnMapLine (paths relative to the folder)
  {
    const p = page(() => 'Ada');
    for (let i = 1; i <= 30; i++) { p.host.feed('a', 'Ada', { type: 'toolCall', sessionId: 'a', callId: 'r' + i, tool: 'view', phase: 'start', args: { path: '/home/ana/work/x/src/f' + i + '.ts' }, timestamp: i }); p.host.feed('a', 'Ada', { type: 'toolCall', sessionId: 'a', callId: 'r' + i, tool: 'view', phase: 'complete', output: 'x', timestamp: i }); p.tick(300); p.flush(); }
    assert.strictEqual(txt(p.host, '.bv-sum'), '24 steps this turn · 6 earlier', 'the summary counts the shown and the earlier steps');
    const list = html(p.host, '.bv-list');
    assert.strictEqual((list.match(/<li>/g) || []).length, 24, 'the list holds the 24 newest steps');
    assert.ok(list.includes('<li>30 Read · src/f30.ts · done</li>') && !list.includes('f6.ts'), 'newest last, folder-relative, the oldest left out: ' + list.slice(-80));
    assert.ok(!/\/home\/ana/.test(list), 'no home path in the list');
  }
  // FR-014: the legend takes the brain area; the picture is not drawn behind it; one frame when it closes
  {
    const p = page(() => 'Ada'); p.host.feed('a', 'Ada', p.ev(1)); p.flush(); drain(p);
    const b = q(p.host, '[data-bv=legend]');
    assert.strictEqual(b.attrs['aria-expanded'], 'false', 'legend: closed at start');
    b.listeners.click[0]();
    const lg = html(p.host, '.bv-legend');
    assert.ok(String(b.attrs['aria-expanded']) === 'true' && lg.includes('A picture of tools, not a real brain'), 'legend: open, with its title');
    for (const w of ['Think', 'Read', 'Edit', 'Shell', 'Web', 'MCP', 'You', 'Reply', 'looping?', 'bloom']) assert.ok(lg.includes(w), 'legend names ' + w);
    assert.strictEqual(((p.host.el.querySelector as (s: string) => Record<string, unknown>)('.bv-pic')).hidden, true, 'legend: the picture gives way');
    const f = p.host.draw.stats.frames; p.host.feed('a', 'Ada', p.ev(2, 'view')); p.flush(); drain(p);
    assert.strictEqual(p.host.draw.stats.frames, f, 'legend open: no frame is drawn behind it');
    b.listeners.click[0]();
    assert.strictEqual(p.host.draw.stats.frames, f + 1, 'legend closed: the settled state is drawn once');
    assert.ok(p.host.legend() === false && String(b.attrs['aria-expanded']) === 'false', 'legend: closed again');
  }
  // FR-031: roomy when Your door is empty (the brain at the rail's width), compact otherwise
  {
    const p = page(() => 'Ada');
    assert.strictEqual(p.host.draw.size().w, H.W_COMPACT, 'compact at start');
    p.host.setRoomy(true, 326);
    assert.ok(p.host.roomy() && p.host.draw.size().w === 326 && (p.host.el.classes as Set<string>).has('is-roomy'), 'roomy: the brain takes the given width');
    p.host.setRoomy(false);
    assert.ok(!p.host.roomy() && p.host.draw.size().w === H.W_COMPACT && !(p.host.el.classes as Set<string>).has('is-roomy'), 'compact again');
  }
  // focus and blur are wired: an unfocused window draws Still (FR-104)
  {
    const p = page(() => 'Ada'); assert.strictEqual(p.host.draw.mode(), 'full');
    assert.ok(p.winL.blur && p.winL.focus && p.docL.visibilitychange, 'the dock listens for blur, focus and visibilitychange');
    p.winL.blur[0](); assert.strictEqual(p.host.draw.mode(), 'still', 'blur: Still');
    p.winL.focus[0](); assert.strictEqual(p.host.draw.mode(), 'full', 'focus: the user\'s setting again');
    p.doc.hidden = true; p.docL.visibilitychange[0]();
    const f = p.host.draw.stats.frames; p.host.feed('a', 'Ada', p.ev(1)); p.flush();
    assert.strictEqual(p.host.draw.stats.frames, f, 'a hidden window: no frame');
  }
  // a page that gains the focus with no focus event (an emulated focus, a window shown already focused) is Full at the next event (the Windows CI failure of check-brain-draw)
  {
    const p = page(() => 'Ada'); let has = false; (p.doc as unknown as { hasFocus: () => boolean }).hasFocus = () => has;
    p.winL.blur[0](); assert.strictEqual(p.host.draw.mode(), 'still', 'no focus: Still');
    has = true; p.host.feed('a', 'Ada', p.ev(1)); p.flush();
    assert.strictEqual(p.host.draw.mode(), 'full', 'the page has the focus and sent no focus event: the next event reads hasFocus() and draws Full');
    has = false; p.host.feed('a', 'Ada', p.ev(2)); p.flush();
    assert.strictEqual(p.host.draw.mode(), 'still', 'the focus went with no blur event: the next event draws Still');
  }
  // no chat, Settings or List view over it, or the rail collapsed: the dock draws nothing (FR-104); back in the chat it draws again
  for (const [cls, add] of [['panel-open', false], ['screen-open', true], ['list-mode', true], ['brain-rail-off', true]] as [string, boolean][]) {
    const p = page(() => 'Ada'); if (add) p.doc.body.classes.add(cls); else p.doc.body.classes.delete(cls);
    const f = p.host.draw.stats.frames; p.host.feed('a', 'Ada', p.ev(1)); p.flush(); p.tick(300); p.rafs.splice(0).forEach((fn) => fn());
    assert.strictEqual(p.host.draw.stats.frames, f, `body ${add ? 'with' : 'without'} ${cls}: no frame`);
    if (add) p.doc.body.classes.delete(cls); else p.doc.body.classes.add(cls);
    p.host.feed('a', 'Ada', p.ev(2, 'view')); p.flush();
    assert.ok(p.host.draw.stats.frames > f, `body ${add ? 'without' : 'with'} ${cls} again: it draws`);
  }
  // unmounted (the chat closed): nothing is drawn
  {
    const p = page(() => 'Ada'); p.host.unmount();
    const f = p.host.draw.stats.frames; p.host.feed('a', 'Ada', p.ev(1)); p.flush(); drain(p);
    assert.strictEqual(p.host.draw.stats.frames, f, 'unmounted: no frame');
  }
  {
    const css = readSrc(path.join(DIR, 'brain.css'));
    assert.ok(/#panel>\.brail\{flex:0 0 360px;width:360px/.test(css), 'brain.css: the right rail is 360 px beside the chat (FR-030)');
    assert.ok(/body\.brain-rail-off #panel>\.brail\{display:none\}/.test(css), 'brain.css: a collapsed rail is hidden (FR-031)');
    assert.ok(/\.bv-pic\[hidden\]\{display:none\}/.test(css), 'brain.css: the picture gives way to the legend (its display:flex would beat [hidden])');
  }
  // a removed agent's brain is forgotten; the dock is empty if it was the one shown
  {
    const p = page(() => 'Ada'); p.host.feed('a', 'Ada', p.ev(1)); p.flush();
    assert.strictEqual(p.host.shown(), 'a');
    p.host.forget('a');
    assert.strictEqual(p.host.shown(), null, 'the removed agent is no longer shown');
    assert.ok((p.host.el.classes as Set<string>).has('is-empty'), 'and the dock is empty');
    assert.strictEqual(p.host.count(), 0, 'its state is gone');
    p.host.show('b');
    assert.ok(!(p.host.el.classes as Set<string>).has('is-empty'), 'the next open chat brings the dock back');
  }
  // FR-086's inputs on every text of the dock (FR-085's Docked card and Turn map rows): card, sentence, title, cost, lobe, Latest steps, labels and tooltips
  {
    const INPUTS: [string, unknown][] = [
      ['bash', { command: `npm run deploy -- --token=${GH}` }], ['bash', { command: `curl -H "Authorization: Bearer ${SK}" https://api.example.com/v1/users?key=XYZ` }],
      ['bash', { command: 'psql postgres://admin:hunter2@db.internal/prod' }], ['view', { path: '/home/ana/work/x/registry.ts' }], ['view', { path: 'C:\\Users\\ana\\work\\x\\registry.ts' }],
      ['bash', { command: `git push https://ana:${GH}@github.com/acme/app.git` }], ['bash', { command: `teams-mcp list_channels --cookie=${SESS}` }],
      ['web_fetch', { url: `https://ana:hunter2@api.example.com/v1/users?key=XYZ&token=${GH}` }],
    ];
    const LEAK: [string, RegExp][] = [['ghp_', /ghp_[A-Za-z0-9]{6,}/], ['sk-', /sk-[A-Za-z0-9-]{8,}/], ['Bearer value', /Bearer\s+(?!\[redacted)\S/], ['URL password', /:\/\/[^/\s@]*:[^/\s@]+@/], ['hunter2', /hunter2/],
      ['--token=', /--token=(?!\[)\S/], ['--cookie=', /--cookie=(?!\[)\S/], ['SESS_', /SESS_[A-Za-z0-9]/], ['?key=', /[?&]key=(?!\[)[^&\s]/i], ['home', /\/home\/ana|C:\\Users\\ana|C:\/Users\/ana/i]];
    const SELS = ['.bv-title', '.bv-cost', '.bv-sentence', '.bv-lobe', '.bv-c1', '.bv-c2', '.bv-c3', '.bv-sum', '.bv-list'];
    const all = (p: ReturnType<typeof page>): string => SELS.map((sl) => { const e = (p.host.el.querySelector as (s: string) => Record<string, unknown>)(sl); return [e.textContent, e.innerHTML, ...Object.values(e.attrs as Record<string, string>)].join('\n'); }).join('\n') + '\n' + Object.values(p.host.el.attrs as Record<string, string>).join('\n');
    for (const [tool, args] of INPUTS) {
      const p = page(() => 'Ada');
      p.host.feed('a', 'Ada', { type: 'thinking', delta: `I will try this. My key is ${GH}, then run it.`, timestamp: 1 });
      p.host.feed('a', 'Ada', { type: 'toolCall', sessionId: 'a', callId: 'm1', tool, args, phase: 'start', timestamp: 2 }); p.flush();
      p.host.feed('a', 'Ada', { type: 'toolCall', sessionId: 'a', callId: 'm1', tool, phase: 'complete', output: 'ok', timestamp: 3 });
      p.host.feed('a', 'Ada', { type: 'toolCall', sessionId: 'a', callId: 'm2', tool, args, phase: 'start', timestamp: 4 }); p.tick(300); p.flush();
      const t = all(p), bad = LEAK.filter(([, re]) => re.test(t)).map(([n]) => n);
      assert.deepStrictEqual(bad, [], `FR-086 on the dock, ${tool} ${JSON.stringify(args).slice(0, 60)}: ${bad.join(', ')}`);
      assert.ok(txt(p.host, '.bv-c1').length > 0 && (html(p.host, '.bv-list').match(/<li>/g) || []).length === 2, 'the dock did paint the steps');
    }
    // the planted mutation: a dock that writes the raw command is caught by the same check
    const raw = `npm run deploy -- --token=${GH}`;
    assert.ok(LEAK.some(([, re]) => re.test(raw)), 'the leak check sees a raw token (planted mutation)');
  }
  // the 60-state cap holds even when the oldest agent is the one shown and keeps feeding
  {
    const p = page(() => 'Ada');
    for (let i = 1; i <= 150; i++) { p.host.feed('0', 'Zero', p.ev(i * 2)); p.host.feed('id' + i, 'A' + i, p.ev(i * 2 + 1)); p.flush(); }
    assert.ok(p.host.count() <= 60, `at most 60 brains are kept (${p.host.count()})`);
  }
  // reduced motion disables nothing the user is standing on: the Motion button keeps focus (aria-disabled) and ignores a click
  {
    const p = page(() => 'Ada'); const b = q(p.host, '[data-bv=motion]');
    p.mqReduce.matches = true; p.mqReduce.listeners.forEach((f) => f());
    assert.strictEqual(b.attrs['aria-disabled'], 'true', 'set by the system: aria-disabled');
    assert.strictEqual((b as unknown as { disabled?: boolean }).disabled, undefined, 'not the disabled attribute, which would drop the keyboard focus');
    const text = (p.host.el.querySelector as (s: string) => Record<string, unknown>)('[data-bv=motion]').textContent;
    b.listeners.click[0](); assert.strictEqual((p.host.el.querySelector as (s: string) => Record<string, unknown>)('[data-bv=motion]').textContent, text, 'a click does nothing while the system decides');
  }
  // forced colours decide like reduced motion (PR 1282 review F1): the button says Still, (system), aria-disabled; a click does nothing
  {
    const p = page(() => 'Ada'); const el = p.host.el.querySelector as (s: string) => Record<string, unknown>; const b = q(p.host, '[data-bv=motion]');
    assert.strictEqual(b.attrs['aria-disabled'], 'false', 'forced colours F1: free before forced colours');
    p.mqForced.matches = true; p.mqForced.listeners.forEach((f) => f());
    assert.strictEqual(b.attrs['aria-disabled'], 'true', 'forced colours F1: the Motion button is aria-disabled');
    const text = String(el('[data-bv=motion]').textContent);
    assert.ok(/Still/.test(text) && /\(system\)/.test(text), `forced colours F1: the button says Still (system), not Full (${text})`);
    assert.ok(/Still/.test(b.attrs['aria-label']) && /system/.test(b.attrs['aria-label']), 'forced colours F1: the spoken label says Still and the system');
    b.listeners.click[0](); assert.strictEqual(el('[data-bv=motion]').textContent, text, 'forced colours F1: a click does nothing while the system decides');
    p.mqForced.matches = false; p.mqForced.listeners.forEach((f) => f());
    assert.ok(/Full/.test(String(el('[data-bv=motion]').textContent)) && b.attrs['aria-disabled'] === 'false', 'forced colours F1: back to the chosen motion when forced colours end');
  }
  // the live world switch (G1): flipping html[data-world] repaints the brain with no reload; the data-world observer is what does it
  {
    const p = page(() => 'Ada'); const attr = (): string => String(p.host.el.attrs ? (p.host.el.attrs as Record<string, string>)['data-skin'] : '');
    assert.strictEqual(p.host.draw.skin(), 'neutral', 'live world: neutral at start');
    const mine = p.observers.filter((o) => o.target === p.rootEl);
    assert.strictEqual(mine.length, 1, 'live world: the host observes html for a data-world change (no observer, no live switch)');
    p.rootEl.dataset.world = 'retro'; mine.forEach((o) => o.cb());
    assert.strictEqual(p.host.draw.skin(), 'arcade', 'live world: switching to the arcade repaints in the arcade skin without a reload');
    assert.strictEqual(p.host.draw.colors().frontal, '#ffc35c', 'live world: the colours are the arcade ones after the switch');
    assert.strictEqual(attr(), 'arcade', 'live world: the box says which skin it wears');
    p.rootEl.dataset.world = 'photo'; mine.forEach((o) => o.cb());
    assert.strictEqual(p.host.draw.skin(), 'neutral', 'live world: leaving the arcade goes back to neutral');
    assert.strictEqual(p.host.draw.colors().frontal, '#e0a458', 'live world: the neutral colours are back');
  }
}
console.log('braindraw: dock ok');
