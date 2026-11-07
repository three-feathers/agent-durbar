/** Brain view point sets (spec 106 T005, FR-010): `npm run test:brainpoints`. No credits, no DOM. */
import * as assert from 'assert';
import * as path from 'path';
import { GLYPHS } from '../src/shared/brainstate';

const FILE = path.join(__dirname, '..', '..', 'src', 'renderer', 'brainview', 'points.js');
type Set = { n: number; xs: Float32Array; ys: Float32Array; w: Float32Array; lobe: Uint8Array; byLobe: Uint32Array[] };
type Api = { ASPECT: number; SIZES: Record<string, number>; LOBES: string[]; ANCHORS: Record<string, { x: number; y: number }>; BAND: number; build(s: string): Set; depthAt(x: number, y: number): number | null; lobeAt(x: number, y: number): string | null };
const P = (require as (f: string) => unknown)(FILE) as Api;

// FR-010: the sizes
assert.deepStrictEqual({ ...P.SIZES }, { office: 2500, dock: 6000, front: 10000 }, 'FR-010: 2,500 office, 6,000 dock, 10,000 In front');
for (const s of Object.keys(P.SIZES)) {
  const b = P.build(s);
  assert.strictEqual(b.n, P.SIZES[s], `${s}: the point count is the FR-010 size`);
  assert.strictEqual(b.xs.length, b.n); assert.strictEqual(b.ys.length, b.n); assert.strictEqual(b.lobe.length, b.n);
  for (let i = 0; i < b.n; i++) {
    assert.ok(b.xs[i] >= 0 && b.xs[i] <= 1 && b.ys[i] >= 0 && b.ys[i] <= 1, `${s}: point ${i} inside the box`);
    assert.ok(b.w[i] > 0 && b.w[i] <= 1, `${s}: weight in (0, 1]`);
  }
  assert.strictEqual(b.byLobe.reduce((a, l) => a + l.length, 0), b.n, `${s}: every point belongs to exactly one lobe list`);
  P.LOBES.forEach((l, k) => assert.ok(b.byLobe[k].length >= (s === 'office' ? 40 : 80), `${s}: lobe ${l} has points to light`));
  assert.strictEqual(P.build(s), b, `${s}: built once, then cached`);
}
assert.throws(() => P.build('huge'), /unknown size/, 'an unknown size is refused');

// the lobes are brainstate's seven lobes
assert.deepStrictEqual([...P.LOBES].sort(), Object.values(GLYPHS).map((g) => g.lobe).sort(), 'the lobe ids are brainstate.ts GLYPHS\' lobes');
for (const l of P.LOBES) assert.strictEqual(P.lobeAt(P.ANCHORS[l].x, P.ANCHORS[l].y), l, `the anchor of ${l} lies in ${l}`);
assert.strictEqual(P.lobeAt(0.02, 0.02), null, 'outside the brain there is no lobe');

// the same points on every run and OS: a fresh module gives byte-identical sets
delete require.cache[require.resolve(FILE)];
const P2 = (require as (f: string) => unknown)(FILE) as Api;
const same = (a: Set, b: Set): boolean => Buffer.from(a.xs.buffer).equals(Buffer.from(b.xs.buffer)) && Buffer.from(a.ys.buffer).equals(Buffer.from(b.ys.buffer)) && Buffer.from(a.lobe).equals(Buffer.from(b.lobe));
assert.ok(same(P.build('dock'), P2.build('dock')), 'a fixed seed: identical points');

// soft edges (FR-010): the density of the cerebrum's lobes falls over the band at each border, but there are points in it (no hard line, no gap).
// Density = points per area, from uniform reference samples of the same shape.
{
  let a = 12345; const rnd = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const bins = (d: number | null): number => (d === null ? -1 : d < 0.1 ? 0 : d > 0.9 ? 2 : 1);
  const ref = [0, 0, 0]; let inside = 0;
  for (let i = 0; i < 400000; i++) { const b = bins(P.depthAt(rnd(), rnd())); if (b >= 0) { ref[b]++; inside++; } }
  assert.ok(inside > 100000);
  const set = P.build('dock'), cnt = [0, 0, 0];
  for (let i = 0; i < set.n; i++) cnt[bins(P.depthAt(set.xs[i], set.ys[i]))]++;
  const dens = cnt.map((c, k) => c / ref[k]);
  assert.ok(cnt[0] > 20, 'points exist inside the border band: a soft edge, not a cut');
  assert.ok(dens[0] <= 0.3 * dens[2], `the band is thin: density ${dens[0].toFixed(4)} against ${dens[2].toFixed(4)} inside`);
  assert.ok(dens[0] >= 0.03 * dens[2], 'and not empty: the band thins, it does not become a gap');
}
console.log('brainpoints: ok');
