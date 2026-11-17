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
  // per lobe, not pooled: one lobe with a hard edge must fail even if the others thin well (FR-010 "at each lobe's border")
  const L = P.LOBES.length, at = (l: string | null, k: number): number => (l === null ? -1 : P.LOBES.indexOf(l) * 3 + k);
  const ref = new Array(L * 3).fill(0);
  for (let i = 0; i < 400000; i++) { const x = rnd(), y = rnd(), b = bins(P.depthAt(x, y)); if (b >= 0) ref[at(P.lobeAt(x, y), b)]++; }
  const set = P.build('dock'), cnt = new Array(L * 3).fill(0);
  for (let i = 0; i < set.n; i++) { const b = bins(P.depthAt(set.xs[i], set.ys[i])); if (b >= 0) cnt[at(P.lobeAt(set.xs[i], set.ys[i]), b)]++; }
  for (let l = 0; l < L; l++) {
    const name = P.LOBES[l], d = [0, 1, 2].map((k) => (ref[l * 3 + k] > 0 ? cnt[l * 3 + k] / ref[l * 3 + k] : 0));
    assert.ok(ref[l * 3] > 100 && ref[l * 3 + 2] > 1000, `${name}: the reference has a band and an inside`);
    // a small lobe's band holds under four expected points, which says nothing: only lobes with a measurable band are checked for "not a cut" and "not a gap"
    const measurable = ref[l * 3] * d[2] * 0.08 >= 4;
    if (measurable) assert.ok(cnt[l * 3] >= 1, `${name}: points exist inside the border band: a soft edge, not a cut`);
    assert.ok(d[0] <= 0.3 * d[2], `${name}: the band is thin: density ${d[0].toFixed(4)} against ${d[2].toFixed(4)} inside`);
    if (measurable) assert.ok(d[0] >= 0.03 * d[2], `${name}: and not empty: the band thins, it does not become a gap`);
  }
}
console.log('brainpoints: ok');
