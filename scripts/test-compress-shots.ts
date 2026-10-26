/**
 * Unit test (spec 050 FR-012, issue #759): scripts/compress-shots.js palette-compresses documentation screenshots with a quality guard.
 * Synthetic pictures only (flat UI colours, 1px text-like strokes, gradients, an "avatar"); no Electron, no real screenshot, no network.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { execFileSync, spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..');
/* eslint-disable @typescript-eslint/no-require-imports */
const cs = require(path.join(ROOT, 'scripts', 'compress-shots.js')) as {
  GUARD: { mean: number; maxChannel: number; badAbove: number; badFraction: number; minSaving: number };
  decodePng: (b: Buffer) => { width: number; height: number; rgba: Buffer; chunks: { type: string; data: Buffer }[] };
  compressPng: (b: Buffer, o?: Record<string, unknown>) => { status: string; buffer: Buffer; before: number; after: number; reason?: string; stats?: { mean: number; max: number; badFraction: number } };
  guardFailure: (s: { mean: number; max: number; badFraction: number }) => string | null;
  measure: (rgba: Buffer, idx: Buffer, pal: number[][]) => { mean: number; max: number; badFraction: number };
};
const docs = require(path.join(ROOT, 'scripts', 'shots-docs.js')) as { squeeze: (f: string, env?: Record<string, string>) => number; main: (o: Record<string, unknown>) => Promise<{ copied: string[] } | undefined> };
/* eslint-enable @typescript-eslint/no-require-imports */

// ---- a tiny PNG writer for the fixtures (RGB or RGBA, filter 0) ----
const T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc = (b: Buffer) => { let c = -1; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const ch = (type: string, d: Buffer) => { const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); o.write(type, 4, 'latin1'); d.copy(o, 8); o.writeUInt32BE(crc(o.subarray(4, 8 + d.length)), 8 + d.length); return o; };
function writePng(w: number, h: number, rgba: Buffer, alpha: boolean): Buffer {
  const n = alpha ? 4 : 3, raw = Buffer.alloc((w * n + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < n; c++) raw[y * (w * n + 1) + 1 + x * n + c] = rgba[(y * w + x) * 4 + c];
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ch('IHDR', ihdr), ch('IDAT', zlib.deflateSync(raw, { level: 6 })), ch('IEND', Buffer.alloc(0))]);
}
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const BG: [number, number, number] = [245, 243, 238];
const set = (px: Buffer, w: number, x: number, y: number, c: number[], a = 255) => { const o = (y * w + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = a; };
const get = (px: Buffer, w: number, x: number, y: number) => { const o = (y * w + x) * 4; return [px[o], px[o + 1], px[o + 2], px[o + 3]]; };

/** A UI-like picture: flat background, a soft vertical shadow gradient, 1px dark strokes with grey antialiasing, an "avatar" with a radial gradient. */
function uiPicture(w = 720, h = 450) {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(px, w, x, y, BG);
  // shadow: 120 rows of a gradient whose three channels move at different rates (many distinct colours)
  for (let y = 300; y < 420; y++) for (let x = 20; x < w - 20; x++) { const t = (y - 300) / 120; set(px, w, x, y, [245 - Math.round(60 * t), 243 - Math.round(70 * t) + (x % 3), 238 - Math.round(50 * t) + (x % 2)]); }
  // text-like strokes: 1px black verticals/horizontals, each with a half-grey neighbour pixel (antialiasing)
  for (let g = 0; g < 60; g++) {
    const x0 = 30 + g * 11, y0 = 40;
    for (let y = y0; y < y0 + 14; y++) { set(px, w, x0, y, [20, 20, 20]); set(px, w, x0 + 1, y, [140, 140, 140]); }
    for (let x = x0; x < x0 + 7; x++) { set(px, w, x, y0 + 7, [20, 20, 20]); set(px, w, x, y0 + 8, [150, 150, 150]); }
  }
  // avatar: a radial skin-tone gradient with a darker ring (thousands of colours)
  for (let y = 100; y < 200; y++) for (let x = 100; x < 200; x++) {
    const d = Math.hypot(x - 150, y - 150) / 50;
    if (d <= 1) set(px, w, x, y, [Math.round(235 - 60 * d), Math.round(190 - 70 * d), Math.round(160 - 60 * d)]);
  }
  return { w, h, px };
}
const ihdrOf = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], type: b[25] });
const plteCount = (b: Buffer) => { let p = 8; while (p < b.length) { const n = b.readUInt32BE(p), t = b.toString('latin1', p + 4, p + 8); if (t === 'PLTE') return n / 3; p += 12 + n; } return -1; };

// 1. the default: valid palette PNG, <= 256 colours, same size, much smaller, within the guard, text stays crisp
const { w, h, px } = uiPicture();
const original = writePng(w, h, px, false);
const r = cs.compressPng(original);
assert.strictEqual(r.status, 'compressed', `UI-like picture is compressed (${r.reason})`);
assert.deepStrictEqual(ihdrOf(r.buffer), { w, h, depth: 8, type: 3 }, 'output is an 8-bit palette PNG of the same size');
assert.ok(plteCount(r.buffer) >= 2 && plteCount(r.buffer) <= 256, `at most 256 colours (${plteCount(r.buffer)})`);
assert.ok(r.after < r.before * 0.7, `at least 30% smaller (${r.before} -> ${r.after})`);
assert.strictEqual(cs.guardFailure(r.stats!), null, 'inside the guard');
const back = cs.decodePng(r.buffer);
assert.strictEqual(back.width, w); assert.strictEqual(back.height, h);
// crisp text: flat background and the 1px strokes come back exactly (flat colours are heavy in the histogram), and the stroke keeps its contrast
assert.deepStrictEqual(get(back.rgba, w, 5, 5).slice(0, 3), BG, 'flat background stays exact');
for (const [x, y] of [[30, 45], [41, 47], [96, 40]]) { const a = get(px, w, x, y), b = get(back.rgba, w, x, y); assert.ok(Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i]))) <= 8, `stroke pixel ${x},${y}: ${a} vs ${b}`); }
const stroke = get(back.rgba, w, 30, 45)[0], bgv = get(back.rgba, w, 29, 45)[0];
assert.ok(bgv - stroke > 200, `a 1px stroke keeps its contrast (${stroke} vs ${bgv})`);
// the gradient and the avatar: small average error
const st = cs.measure(px, Buffer.from(Array.from({ length: w * h }, () => 0)), [[0, 0, 0]]); // sanity: measure runs, a black picture is far off
assert.ok(st.mean > 100, 'measure() reports a large error for a wrong picture');
assert.ok(r.stats!.mean < 0.8 && r.stats!.max <= cs.GUARD.maxChannel, `mean error ${r.stats!.mean.toFixed(2)}, max ${r.stats!.max}`);

// a picture with few colours is kept exactly: the palette is the picture's own colours, error 0
{
  const fp = Buffer.alloc(300 * 200 * 4);
  for (let i = 0; i < 300 * 200; i++) { const v = (i % 300 + Math.floor(i / 300)) % 40 < 3 ? 17 * ((i % 7) + 1) : 240; set(fp, 300, i % 300, Math.floor(i / 300), [v, 255 - v, v >> 1]); }
  const rx = cs.compressPng(writePng(300, 200, fp, false));
  assert.strictEqual(rx.status, 'compressed', rx.reason);
  assert.ok(cs.decodePng(rx.buffer).rgba.equals(Buffer.from(fp.map((v, i) => (i % 4 === 3 ? 255 : v)))), 'few colours: lossless');
  assert.strictEqual(rx.stats!.mean, 0);
}

// 2. idempotent: a second pass keeps the file (not 5% smaller) and never grows it; compressing the result again returns it byte for byte
const r2 = cs.compressPng(r.buffer);
assert.strictEqual(r2.status, 'kept', 'a second pass changes nothing');
assert.ok(r2.buffer.equals(r.buffer) && r2.after <= r.after, 'the second pass does not grow the file');

// 3. the guard: a picture full of random colours cannot be shown in 256 colours -> original kept
const noise = Buffer.alloc(200 * 100 * 4);
for (let i = 0; i < 200 * 100; i++) set(noise, 200, i % 200, Math.floor(i / 200), [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)]);
const noisy = writePng(200, 100, noise, false);
const rn = cs.compressPng(noisy);
assert.strictEqual(rn.status, 'kept', 'random colours: refused');
assert.ok(/quality guard refused/.test(rn.reason || ''), `reason names the guard: ${rn.reason}`);
assert.ok(rn.buffer.equals(noisy), 'the original bytes come back untouched');
// mutation proof: a too-lossy quantiser (4 grey levels) is refused by the guard; with the guard off it would be written
const lossy = (rgba: Buffer, ww: number, hh: number) => {
  const idx = Buffer.alloc(ww * hh), pal = [[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]];
  for (let i = 0; i < ww * hh; i++) idx[i] = Math.min(3, Math.round(((rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3) / 85));
  return { palette: pal, indices: idx, exact: false };
};
const rl = cs.compressPng(original, { quantise: lossy });
assert.strictEqual(rl.status, 'kept', 'a too-lossy quantiser is rejected');
assert.ok(/quality guard refused/.test(rl.reason || ''), rl.reason);
const rOff = cs.compressPng(original, { quantise: lossy, guard: { mean: 1e9, maxChannel: 1e9, badFraction: 1, minSaving: 0 } });
assert.strictEqual(rOff.status, 'compressed', 'mutation: with the guard limits removed the lossy picture WOULD be written, so the guard is what stops it');
// the limits themselves have a ceiling in this test, so loosening one in the module is caught here (spec 050 FR-012: mean <= 1.5, worst <= 128, <= 1% of pixels off by > 32)
assert.ok(cs.GUARD.mean <= 1.5 && cs.GUARD.maxChannel <= 128 && cs.GUARD.badAbove <= 32 && cs.GUARD.badFraction <= 0.01, `guard limits: ${JSON.stringify(cs.GUARD)}`);
// measure() sees one bad pixel: the largest channel error and the share of bad pixels
const one = cs.measure(Buffer.from([200, 0, 0, 255, 0, 0, 0, 255]), Buffer.from([0, 0]), [[0, 0, 0]]);
assert.strictEqual(one.max, 200); assert.strictEqual(one.badFraction, 0.5); assert.ok(Math.abs(one.mean - 200 / 6) < 1e-9);
// each limit on its own
const base = { mean: 0.1, max: 10, badFraction: 0 };
assert.strictEqual(cs.guardFailure(base), null);
assert.ok(/mean/.test(cs.guardFailure({ ...base, mean: cs.GUARD.mean + 0.1 }) || ''));
assert.ok(/largest channel/.test(cs.guardFailure({ ...base, max: cs.GUARD.maxChannel + 1 }) || ''));
assert.ok(/pixels off/.test(cs.guardFailure({ ...base, badFraction: cs.GUARD.badFraction + 0.001 }) || ''));

// 4. transparency: a soft shadow with many alpha levels is kept; a few exact RGBA colours go to a lossless palette with tRNS
const ta = Buffer.alloc(200 * 100 * 4);
for (let i = 0; i < 200 * 100; i++) set(ta, 200, i % 200, Math.floor(i / 200), [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)], Math.floor(rnd() * 256));
const withAlpha = writePng(200, 100, ta, true);
const rt = cs.compressPng(withAlpha);
assert.strictEqual(rt.status, 'kept'); assert.ok(/transparency/.test(rt.reason || ''), rt.reason); assert.ok(rt.buffer.equals(withAlpha));
const few = Buffer.alloc(400 * 300 * 4);
for (let i = 0; i < 400 * 300; i++) set(few, 400, i % 400, Math.floor(i / 400), i % 400 < 200 ? [10, 120, 200] : [250, 250, 250], i % 400 < 100 ? 0 : 255);
const rf = cs.compressPng(writePng(400, 300, few, true));
assert.strictEqual(rf.status, 'compressed', rf.reason);
const fb = cs.decodePng(rf.buffer);
assert.ok(fb.rgba.equals(few), 'alpha picture with few colours comes back pixel for pixel');
assert.ok(fb.chunks.some((c) => c.type === 'tRNS'), 'tRNS written');

// 5. not a PNG or unsupported: kept, never throws
assert.strictEqual(cs.compressPng(Buffer.from('not a png')).status, 'kept');
const trunc = original.subarray(0, 100);
assert.strictEqual(cs.compressPng(trunc).status, 'kept');

// 6. size and time on a real-sized picture (generous limit, not a benchmark)
{
  const big = uiPicture(1440, 900);
  const bigPng = writePng(1440, 900, big.px, false);
  const t0 = Date.now();
  const rb = cs.compressPng(bigPng);
  assert.strictEqual(rb.status, 'compressed', rb.reason);
  assert.ok(Date.now() - t0 < 30000, `1440x900 compresses in under 30 s (${Date.now() - t0} ms)`);
}

async function cliAndHook(): Promise<void> {
// 7. the CLI: --check lists and changes nothing, exits 1 while a picture could shrink; the real run writes, then --check passes
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-shots-'));
try {
  const f = path.join(tmp, 'a.png');
  fs.writeFileSync(f, original);
  const cli = path.join(ROOT, 'scripts', 'compress-shots.js');
  const c1 = spawnSync(process.execPath, [cli, '--check', f], { encoding: 'utf8' });
  assert.strictEqual(c1.status, 1, 'check fails while the picture can shrink');
  assert.ok(fs.readFileSync(f).equals(original), '--check changes nothing');
  execFileSync(process.execPath, [cli, f], { stdio: 'pipe' });
  assert.ok(fs.statSync(f).size < original.length * 0.7, 'the CLI compressed it in place');
  assert.strictEqual(spawnSync(process.execPath, [cli, '--check', f], { encoding: 'utf8' }).status, 0, 'check passes after compression');
  assert.ok(!fs.readdirSync(tmp).some((n) => n.includes('.tmp')), 'no temp file left behind');

  // 8. shots:docs calls it after each picture it writes (fail-soft), and DURBAR_SHOTS_COMPRESS=off skips it
  const g = path.join(tmp, 'b.png');
  fs.writeFileSync(g, original);
  assert.strictEqual(docs.squeeze(g, { DURBAR_SHOTS_COMPRESS: 'off' }), 0, 'off: nothing done');
  assert.ok(fs.readFileSync(g).equals(original), 'off: the file is untouched');
  assert.ok(docs.squeeze(g, {}) > 0, 'on: bytes saved');
  fs.writeFileSync(g, 'garbage');
  assert.strictEqual(docs.squeeze(g, {}), 0, 'a file it cannot read is left as it is, no throw');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'shots-docs.js'), 'utf8');
  assert.ok(/squeeze\(path\.join\(out, t\)\)/.test(src), 'main() squeezes every file it copies');
  // end to end with a fake driver: the picture a "driver" wrote ends up compressed in --out
  const outDir = path.join(tmp, 'out');
  const fake = async (_d: unknown, dir: string) => { fs.writeFileSync(path.join(dir, '005-card-menu-stop-end-1440x900.png'), original); return { ok: true, secs: 0, log: '', why: '' }; };
  const logs: string[] = []; const realLog = console.log; console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
  let res;
  try { res = await docs.main({ argv: ['--out', outDir, '--only', 'shots-005-cardmenu', '--linked-only'], run: fake, ensure: () => true, clockQuery: () => 'x' }); } finally { console.log = realLog; }
  assert.deepStrictEqual(res!.copied, ['005-card-menu-stop-end-1440x900.png']);
  assert.ok(fs.statSync(path.join(outDir, '005-card-menu-stop-end-1440x900.png')).size < original.length * 0.7, 'shots-docs wrote a compressed picture');
  assert.ok(logs.some((l) => /KB smaller/.test(l)), 'and says how much it saved');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

}
cliAndHook().then(() => console.log('compress-shots: ok'), (e) => { console.error(e); process.exit(1); });
