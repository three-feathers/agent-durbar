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
  confinement: (f: string, o?: Record<string, unknown>) => string | null;
  compressFile: (f: string, o?: Record<string, unknown>) => { status: string; reason?: string; before: number; after: number };
  encodePalettePng: (w: number, h: number, idx: Buffer, pal: number[][], keep?: unknown[], o?: { filter?: number }) => Buffer;
  GUARD: { mean: number; maxChannel: number; badAbove: number; badFraction: number; minSaving: number };
  decodePng: (b: Buffer) => { width: number; height: number; rgba: Buffer; chunks: { type: string; data: Buffer }[] };
  compressPng: (b: Buffer, o?: Record<string, unknown>) => { status: string; buffer: Buffer; before: number; after: number; reason?: string; stats?: { mean: number; max: number; badFraction: number } };
  guardFailure: (s: { mean: number; max: number; badFraction: number }) => string | null;
  measure: (rgba: Buffer, idx: Buffer, pal: number[][]) => { mean: number; max: number; badFraction: number };
};
const docs = require(path.join(ROOT, 'scripts', 'shots-docs.js')) as { squeeze: (f: string, env?: Record<string, string>, root?: string) => number; main: (o: Record<string, unknown>) => Promise<{ copied: string[] } | undefined> };
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

// 5b. hostile or unsupported input is kept, never half-handled (review on #761)
{
  const withChunks = (png: Buffer, extra: Buffer[]) => { // insert chunks right after IHDR
    const at = 8 + 12 + 13; return Buffer.concat([png.subarray(0, at), ...extra, png.subarray(at)]);
  };
  // colour-key transparency on an RGB picture: kept (it used to be compressed and lose the transparency)
  const keyed = withChunks(original, [ch('tRNS', Buffer.from([0, 0, 0, 0, 0, 0]))]);
  const rk = cs.compressPng(keyed);
  assert.strictEqual(rk.status, 'kept'); assert.ok(/colour-key/.test(rk.reason || ''), rk.reason); assert.ok(rk.buffer.equals(keyed));
  // an unknown critical chunk, 16-bit depth, interlace: kept
  const crit = withChunks(original, [ch('ZZZZ', Buffer.from([1]))]);
  assert.ok(/critical chunk/.test(cs.compressPng(crit).reason || ''), 'unknown critical chunk');
  assert.strictEqual(cs.compressPng(withChunks(original, [ch('zZZZ', Buffer.from([1]))])).status, 'compressed', 'an unknown ancillary chunk is fine (and dropped)');
  for (const [i, v, what] of [[24, 16, '16-bit'], [28, 1, 'interlaced']] as [number, number, string][]) {
    const b = Buffer.from(original); b[i] = v; b.writeUInt32BE(crc(b.subarray(12, 29)), 29);
    const rr = cs.compressPng(b); assert.strictEqual(rr.status, 'kept', what); assert.ok(/unsupported/.test(rr.reason || ''), `${what}: ${rr.reason}`); assert.ok(rr.buffer.equals(b));
  }
  // a bad CRC and a chunk that claims more than the file holds
  const badCrc = Buffer.from(original); badCrc[badCrc.length - 20] ^= 1;
  assert.strictEqual(cs.compressPng(badCrc).status, 'kept');
  const longChunk = Buffer.from(original); longChunk.writeUInt32BE(0x7fffffff, 33);
  assert.strictEqual(cs.compressPng(longChunk).status, 'kept');
  // a size beyond the cap is refused before anything is allocated
  const huge = Buffer.from(original); huge.writeUInt32BE(20000, 16); huge.writeUInt32BE(crc(huge.subarray(12, 29)), 29);
  assert.ok(/unsupported: size/.test(cs.compressPng(huge).reason || ''), 'a huge IHDR is refused');
  // a decompression bomb: a small IDAT that inflates to 40 MB while the header says 50x50. Refused at once, not inflated.
  const ih = Buffer.alloc(13); ih.writeUInt32BE(50, 0); ih.writeUInt32BE(50, 4); ih[8] = 8; ih[9] = 2;
  const bomb = Buffer.concat([original.subarray(0, 8), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(Buffer.alloc(40 * 1024 * 1024), { level: 9 })), ch('IEND', Buffer.alloc(0))]);
  assert.ok(bomb.length < 100000, `the bomb is small (${bomb.length} B)`);
  const tb = Date.now(); const rb2 = cs.compressPng(bomb);
  assert.strictEqual(rb2.status, 'kept'); assert.ok(/larger than its header says/.test(rb2.reason || ''), `bomb: ${rb2.reason}`);
  assert.ok(Date.now() - tb < 5000, 'refused quickly');
}

// 5c. APNG: an acTL chunk means an animation; flattening it to a still would lose frames, so the original stays
{
  const at = 8 + 12 + 13;
  const apng = Buffer.concat([original.subarray(0, at), ch('acTL', Buffer.alloc(8)), original.subarray(at)]);
  const ra = cs.compressPng(apng);
  assert.strictEqual(ra.status, 'kept'); assert.ok(/APNG/.test(ra.reason || ''), ra.reason); assert.ok(ra.buffer.equals(apng));
}

// 5d. the encoder, every PNG filter forced in turn, read back by a separate reference decoder that shares no code with the module
// (review on #761: a broken Paeth filter wrote corrupt PNGs and the module's own decoder could not tell)
function refDecodeIndices(png: Buffer): { w: number; h: number; idx: Buffer; pal: number[][]; endOk: boolean } {
  let p = 8, w = 0, h = 0, idat: Buffer[] = [], plte: Buffer = Buffer.alloc(0);
  while (p < png.length) {
    const n = png.readUInt32BE(p), t = png.toString('latin1', p + 4, p + 8), d = png.subarray(p + 8, p + 8 + n);
    assert.strictEqual(png.readUInt32BE(p + 8 + n), crc(png.subarray(p + 4, p + 8 + n)), `CRC of ${t}`);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); assert.strictEqual(d[9], 3); }
    if (t === 'PLTE') plte = d;
    if (t === 'IDAT') idat.push(d);
    p += 12 + n;
  }
  const endOk = png.subarray(png.length - 12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.strictEqual(raw.length, (w + 1) * h);
  const out = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)];
    for (let x = 0; x < w; x++) {
      const v = raw[y * (w + 1) + 1 + x];
      const a = x ? out[y * w + x - 1] : 0, b = y ? out[(y - 1) * w + x] : 0, c = x && y ? out[(y - 1) * w + x - 1] : 0;
      let pr = 0;
      if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else assert.strictEqual(f, 0);
      out[y * w + x] = (v + pr) & 255;
    }
  }
  const pal: number[][] = []; for (let i = 0; i < plte.length; i += 3) pal.push([plte[i], plte[i + 1], plte[i + 2]]);
  return { w, h, idx: out, pal, endOk };
}
{
  const W = 37, H = 29, pal = Array.from({ length: 20 }, (_, i) => [i * 12, 255 - i * 9, (i * 37) % 256]);
  const idx = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) idx[i] = ((i % W) * 3 + Math.floor(i / W) * 5 + (i % 7 === 0 ? 4 : 0)) % 20;
  for (const f of [undefined, 0, 1, 2, 3, 4]) {
    const png = cs.encodePalettePng(W, H, idx, pal, [], f === undefined ? {} : { filter: f });
    const d = refDecodeIndices(png);
    assert.ok(d.endOk, `filter ${f}: the file ends with a correct IEND chunk`);
    assert.strictEqual(d.w, W); assert.strictEqual(d.h, H);
    assert.ok(d.idx.equals(idx), `filter ${f}: the reference decoder reads back the same indices`);
    assert.deepStrictEqual(d.pal, pal);
    assert.ok(cs.decodePng(png).rgba.length === W * H * 4, `filter ${f}: the module reads it too`);
  }
  // and what compressPng writes for a real-looking picture is read back correctly by the reference decoder
  const dd = refDecodeIndices(r.buffer);
  assert.ok(dd.endOk && dd.w === w && dd.h === h, 'compressed output: valid end, same size');
  for (let i = 0; i < w * h; i += 97) { const c = dd.pal[dd.idx[i]], o = get(back.rgba, w, i % w, Math.floor(i / w)); assert.deepStrictEqual(c, o.slice(0, 3)); }
}

// 5e. confinement: a regular file inside the root is fine; a symlink, a path that escapes with `..` and a file outside the root are refused
{
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-confine-'));
  try {
    const root = path.join(base, 'shots'), outside = path.join(base, 'outside');
    fs.mkdirSync(root); fs.mkdirSync(outside);
    const inRoot = path.join(root, 'a.png'), out = path.join(outside, 'b.png');
    fs.writeFileSync(inRoot, original); fs.writeFileSync(out, original);
    assert.strictEqual(cs.confinement(inRoot, { root }), null, 'a regular file in the root is allowed');
    assert.ok(/outside/.test(cs.confinement(out, { root }) || ''), 'a file outside the root is refused');
    assert.ok(/outside/.test(cs.confinement(path.join(root, '..', 'outside', 'b.png'), { root }) || ''), 'a .. escape is refused');
    assert.strictEqual(cs.confinement(out, { root, allowOutside: true }), null, '--allow-outside lifts the folder rule');
    const rr = cs.compressFile(out, { root });
    assert.strictEqual(rr.status, 'kept'); assert.ok(fs.readFileSync(out).equals(original), 'the outside file is untouched');
    let linked = true;
    try { fs.symlinkSync(out, path.join(root, 'link.png')); } catch { linked = false; } // Windows may refuse symlinks
    if (linked) {
      assert.ok(/symbolic link/.test(cs.confinement(path.join(root, 'link.png'), { root }) || ''), 'a symlink is refused');
      assert.ok(/symbolic link/.test(cs.confinement(path.join(root, 'link.png'), { root, allowOutside: true }) || ''), 'a symlink is refused even with --allow-outside');
      const rl2 = cs.compressFile(path.join(root, 'link.png'), { root });
      assert.strictEqual(rl2.status, 'kept');
      assert.ok(fs.readFileSync(out).equals(original), 'the symlink target is untouched');
      assert.ok(fs.lstatSync(path.join(root, 'link.png')).isSymbolicLink(), 'and the link is still a link');
      const sq = docs.squeeze(path.join(root, 'link.png'), {}, root);
      assert.strictEqual(sq, 0); assert.ok(fs.readFileSync(out).equals(original), 'shots-docs squeeze does not follow it either');
    }
    // a normal file is compressed in place, no temp file left
    assert.strictEqual(cs.compressFile(inRoot, { root }).status, 'compressed');
    assert.ok(fs.statSync(inRoot).size < original.length * 0.7);
    assert.deepStrictEqual(fs.readdirSync(root).filter((n) => n.includes('tmp')), []);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

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
  const c1 = spawnSync(process.execPath, [cli, '--check', '--allow-outside', f], { encoding: 'utf8' });
  assert.strictEqual(c1.status, 1, 'check fails while the picture can shrink');
  assert.ok(fs.readFileSync(f).equals(original), '--check changes nothing');
  execFileSync(process.execPath, [cli, '--allow-outside', f], { stdio: 'pipe' });
  assert.ok(fs.statSync(f).size < original.length * 0.7, 'the CLI compressed it in place');
  assert.strictEqual(spawnSync(process.execPath, [cli, '--check', '--allow-outside', f], { encoding: 'utf8' }).status, 0, 'check passes after compression');
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
  assert.ok(/squeeze\(path\.join\(out, t\), process\.env, out\)/.test(src), 'main() squeezes every file it copies');
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
