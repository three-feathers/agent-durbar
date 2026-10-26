/*
 * Spec 050 FR-012: palette-compress the documentation screenshots (the website size budget, issue #759). Plain Node, no dependency,
 * no binary (pngquant/oxipng are not needed): it reads an 8-bit PNG with zlib, quantises it to at most 256 colours (median cut on the
 * colour histogram, then a few k-means steps), and writes a palette PNG. Lossless re-encoding gains ~0% on these pictures (they are
 * already well deflated); a 256-colour palette gains about 60%. It is LOSSY, so a quality guard compares the result with the original
 * and KEEPS THE ORIGINAL when the picture would get visibly worse (or when the result is not smaller).
 *
 *   node scripts/compress-shots.js [--check] [--dither] [--allow-outside] [files...]     default files: the linked pictures (shots-docs.js linkedImages)
 *   DURBAR_SHOTS_COMPRESS=off                                          shots:docs writes the drivers' pictures untouched
 *
 * Files must be regular files (never symlinks) inside docs/screenshots; --allow-outside lifts the folder rule only.
 * --check changes nothing: it lists what it would do and exits 1 when a linked picture could still shrink by 10% or more.
 * Module: compressPng(buffer, opts) -> { status, buffer, before, after, stats, reason }, compressFile(file, opts).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_FILE = 64 * 1024 * 1024, MAX_SIDE = 8192, MAX_PIXELS = 36e6; // screenshots here are a few thousand pixels wide
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The guard: per-pixel error is the largest channel difference (0..255); `badAbove` is what counts as a visible pixel error. */
const GUARD = { mean: 1.0, maxChannel: 96, badAbove: 24, badFraction: 0.004, minSaving: 0.05 };

// ---------- PNG container ----------
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function readChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file');
  const chunks = [];
  let p = 8;
  while (p + 12 <= buf.length) {
    const n = buf.readUInt32BE(p);
    if (p + 12 + n > buf.length) throw new Error('truncated PNG');
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + n);
    if (crc32(buf.subarray(p + 4, p + 8 + n)) !== buf.readUInt32BE(p + 8 + n)) throw new Error(`bad CRC in ${type}`);
    chunks.push({ type, data });
    p += 12 + n;
    if (type === 'IEND') break;
  }
  return chunks;
}

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

/** Decode an 8-bit, non-interlaced PNG (gray, RGB, palette, gray+alpha, RGBA) to RGBA. Anything else throws 'unsupported: ...'. */
function decodePng(buf) {
  if (buf.length > MAX_FILE) throw new Error('unsupported: file larger than 64 MB');
  const chunks = readChunks(buf);
  if (chunks.some((c) => c.type === 'acTL')) throw new Error('unsupported: animated PNG (APNG)');
  const bad = chunks.find((c) => /^[A-Z]/.test(c.type) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(c.type));
  if (bad) throw new Error(`unsupported: critical chunk ${bad.type}`);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('no IHDR');
  const width = ihdr.data.readUInt32BE(0), height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8], ct = ihdr.data[9], interlace = ihdr.data[12];
  if (depth !== 8 || interlace !== 0 || ![0, 2, 3, 4, 6].includes(ct)) throw new Error(`unsupported: bit depth ${depth}, colour type ${ct}, interlace ${interlace}`);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw new Error(`unsupported: size ${width}x${height}`);
  // a colour-key tRNS (gray, RGB) is transparency this code does not carry over: keep the original rather than drop it
  if ((ct === 0 || ct === 2) && chunks.some((c) => c.type === 'tRNS')) throw new Error('unsupported: colour-key transparency (tRNS on a gray or RGB picture)');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const stride = width * channels;
  // the inflated size is known from the header: never inflate more (a decompression bomb stops at once)
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)), { maxOutputLength: (stride + 1) * height }); }
  catch (e) { throw new Error(e instanceof RangeError || e.code === 'ERR_BUFFER_TOO_LARGE' ? 'image data is larger than its header says' : `bad image data: ${e.message}`); }
  if (raw.length !== (stride + 1) * height) throw new Error('bad image data length');
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= channels ? px[dst + i - channels] : 0;
      const b = y > 0 ? px[up + i] : 0;
      const c = i >= channels && y > 0 ? px[up + i - channels] : 0;
      let v;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error('bad filter type');
      }
      px[dst + i] = v & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  const plte = chunks.find((c) => c.type === 'PLTE');
  const trns = chunks.find((c) => c.type === 'tRNS');
  if (ct === 3 && !plte) throw new Error('palette PNG without PLTE');
  for (let i = 0, n = width * height; i < n; i++) {
    const o = i * 4;
    if (ct === 6) { px.copy(rgba, o, i * 4, i * 4 + 4); }
    else if (ct === 2) { rgba[o] = px[i * 3]; rgba[o + 1] = px[i * 3 + 1]; rgba[o + 2] = px[i * 3 + 2]; rgba[o + 3] = 255; }
    else if (ct === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[i]; rgba[o + 3] = 255; }
    else if (ct === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[i * 2]; rgba[o + 3] = px[i * 2 + 1]; }
    else {
      const k = px[i];
      if (k * 3 + 2 >= plte.data.length) throw new Error('palette index out of range');
      rgba[o] = plte.data[k * 3]; rgba[o + 1] = plte.data[k * 3 + 1]; rgba[o + 2] = plte.data[k * 3 + 2];
      rgba[o + 3] = trns && k < trns.data.length ? trns.data[k] : 255;
    }
  }
  return { width, height, rgba, chunks };
}

/** Renumber the palette in the order the colours first appear (raster order): neighbouring pixels then get neighbouring numbers, and the same picture always gets the same palette, so a second pass changes nothing. */
function firstAppearance(indices, palette) {
  const map = new Int16Array(palette.length).fill(-1), order = [];
  const out = Buffer.alloc(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const k = indices[i];
    if (map[k] < 0) { map[k] = order.length; order.push(palette[k]); }
    out[i] = map[k];
  }
  return { indices: out, palette: order };
}

/** Encode palette indices as an 8-bit palette PNG; `keep` = colour-related ancillary chunks (iCCP, sRGB, ...) copied from the source. */
function encodePalettePng(width, height, indices, palette, keep = [], { filter } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 3;
  const plte = Buffer.alloc(palette.length * 3);
  const alpha = Buffer.alloc(palette.length);
  let hasAlpha = false;
  palette.forEach((c, i) => { plte[i * 3] = c[0]; plte[i * 3 + 1] = c[1]; plte[i * 3 + 2] = c[2]; alpha[i] = c[3] === undefined ? 255 : c[3]; if (alpha[i] !== 255) hasAlpha = true; });
  // two filterings, the smaller wins: none, or the usual per-row choice (smallest sum of absolute values)
  const plain = Buffer.alloc((width + 1) * height);
  const adaptive = Buffer.alloc((width + 1) * height);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(width));
  for (let y = 0; y < height; y++) {
    const row = indices.subarray(y * width, (y + 1) * width);
    plain.set(row, y * (width + 1) + 1);
    const prev = y ? indices.subarray((y - 1) * width, y * width) : null;
    let best = 0, bestSum = Infinity;
    for (let f = filter === undefined ? 0 : filter; f < (filter === undefined ? 5 : filter + 1); f++) {
      const o = cand[f]; let sum = 0;
      for (let i = 0; i < width; i++) {
        const a = i ? row[i - 1] : 0, b = prev ? prev[i] : 0, c = i && prev ? prev[i - 1] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (row[i] - pred) & 255; o[i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    adaptive[y * (width + 1)] = best;
    cand[best].copy(adaptive, y * (width + 1) + 1);
  }
  const def = (b) => zlib.deflateSync(b, { level: 9, memLevel: 9 });
  const a = filter === undefined ? def(plain) : null, b = def(adaptive); // `filter` (0..4) forces one filter on every row, for tests
  const parts = [SIG, chunk('IHDR', ihdr), ...keep.map((k) => chunk(k.type, k.data)), chunk('PLTE', plte)];
  if (hasAlpha) parts.push(chunk('tRNS', alpha));
  parts.push(chunk('IDAT', a && a.length <= b.length ? a : b), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ---------- quantiser ----------
// Distance weights: green counts most, blue least (a rough perceptual weighting).
const WR = 0.6, WG = 1.0, WB = 0.4;

/** Unique colours of an RGBA buffer: { keys: Uint32 (r<<16|g<<8|b), counts }, or null when any pixel is not opaque. */
function histogram(rgba) {
  const map = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 255) return null;
    const k = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    map.set(k, (map.get(k) || 0) + 1);
  }
  const keys = Uint32Array.from(map.keys());
  const counts = Float64Array.from(keys, (k) => map.get(k));
  return { keys, counts };
}

/** Median cut (box with the largest weighted squared error is split at its weighted median), then k-means steps. Returns [[r,g,b]...]. */
function medianCut(keys, counts, maxColors, iterations = 4) {
  const n = keys.length;
  const R = new Float64Array(n), G = new Float64Array(n), B = new Float64Array(n);
  for (let i = 0; i < n; i++) { R[i] = (keys[i] >> 16) * WR; G[i] = ((keys[i] >> 8) & 255) * WG; B[i] = (keys[i] & 255) * WB; }
  const stat = (idx) => {
    let w = 0, sr = 0, sg = 0, sb = 0;
    for (const i of idx) { const c = counts[i]; w += c; sr += c * R[i]; sg += c * G[i]; sb += c * B[i]; }
    let err = 0, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const mr = sr / w, mg = sg / w, mb = sb / w;
    for (const i of idx) {
      const c = counts[i];
      err += c * ((R[i] - mr) ** 2 + (G[i] - mg) ** 2 + (B[i] - mb) ** 2);
      lo = [Math.min(lo[0], R[i]), Math.min(lo[1], G[i]), Math.min(lo[2], B[i])];
      hi = [Math.max(hi[0], R[i]), Math.max(hi[1], G[i]), Math.max(hi[2], B[i])];
    }
    return { idx, err, lo, hi };
  };
  const all = new Array(n); for (let i = 0; i < n; i++) all[i] = i;
  let boxes = [stat(all)];
  while (boxes.length < maxColors) {
    let bi = -1, be = 0;
    boxes.forEach((b, i) => { if (b.idx.length > 1 && b.err > be) { be = b.err; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi];
    const ext = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
    const ch = ext[0] >= ext[1] && ext[0] >= ext[2] ? R : ext[1] >= ext[2] ? G : B;
    const sorted = b.idx.slice().sort((x, y) => ch[x] - ch[y]);
    let total = 0; for (const i of sorted) total += counts[i];
    let acc = 0, cut = 1;
    for (let j = 0; j < sorted.length - 1; j++) { acc += counts[sorted[j]]; cut = j + 1; if (acc >= total / 2) break; }
    boxes.splice(bi, 1, stat(sorted.slice(0, cut)), stat(sorted.slice(cut)));
  }
  let pal = boxes.map((b) => {
    let w = 0, sr = 0, sg = 0, sb = 0;
    for (const i of b.idx) { const c = counts[i]; w += c; sr += c * R[i]; sg += c * G[i]; sb += c * B[i]; }
    return [sr / w, sg / w, sb / w];
  });
  // k-means (Lloyd) on the weighted unique colours
  for (let it = 0; it < iterations; it++) {
    const acc = pal.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < pal.length; k++) { const d = (R[i] - pal[k][0]) ** 2 + (G[i] - pal[k][1]) ** 2 + (B[i] - pal[k][2]) ** 2; if (d < bd) { bd = d; best = k; } }
      const a = acc[best], c = counts[i]; a[0] += c * R[i]; a[1] += c * G[i]; a[2] += c * B[i]; a[3] += c;
    }
    pal = pal.map((p, k) => (acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : p));
  }
  return pal.map((p) => [Math.round(p[0] / WR), Math.round(p[1] / WG), Math.round(p[2] / WB)].map((v) => Math.max(0, Math.min(255, v))));
}

/** Map every pixel to its nearest palette entry (memoised per colour); `dither`: Floyd-Steinberg error diffusion (serpentine). */
function mapPixels(rgba, width, height, palette, dither) {
  const n = palette.length;
  const pr = palette.map((p) => p[0] * WR), pg = palette.map((p) => p[1] * WG), pb = palette.map((p) => p[2] * WB);
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let v = cache.get(key);
    if (v !== undefined) return v;
    let best = 0, bd = Infinity;
    const rr = r * WR, gg = g * WG, bb = b * WB;
    for (let k = 0; k < n; k++) { const d = (rr - pr[k]) ** 2 + (gg - pg[k]) ** 2 + (bb - pb[k]) ** 2; if (d < bd) { bd = d; best = k; if (d === 0) break; } }
    cache.set(key, best);
    return best;
  };
  const out = Buffer.alloc(width * height);
  if (!dither) {
    for (let i = 0; i < width * height; i++) out[i] = nearest(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    return out;
  }
  let cur = new Float32Array((width + 2) * 3), nxt = new Float32Array((width + 2) * 3);
  for (let y = 0; y < height; y++) {
    const ltr = y % 2 === 0;
    for (let s = 0; s < width; s++) {
      const x = ltr ? s : width - 1 - s, i = y * width + x, e = (x + 1) * 3;
      const r = Math.max(0, Math.min(255, Math.round(rgba[i * 4] + cur[e]))), g = Math.max(0, Math.min(255, Math.round(rgba[i * 4 + 1] + cur[e + 1]))), b = Math.max(0, Math.min(255, Math.round(rgba[i * 4 + 2] + cur[e + 2])));
      const k = nearest(r, g, b);
      out[i] = k;
      const er = r - palette[k][0], eg = g - palette[k][1], eb = b - palette[k][2];
      if (!er && !eg && !eb) continue;
      const dir = ltr ? 1 : -1;
      const spread = (arr, xx, w) => { const o = (xx + 1) * 3; arr[o] += er * w; arr[o + 1] += eg * w; arr[o + 2] += eb * w; };
      if (x + dir >= 0 && x + dir < width) spread(cur, x + dir, 7 / 16);
      if (x - dir >= 0 && x - dir < width) spread(nxt, x - dir, 3 / 16);
      spread(nxt, x, 5 / 16);
      if (x + dir >= 0 && x + dir < width) spread(nxt, x + dir, 1 / 16);
    }
    [cur, nxt] = [nxt, cur]; nxt.fill(0);
  }
  return out;
}

/** Error of `indices`+`palette` against the original: mean per-channel error, largest channel error, share of pixels whose largest channel error exceeds badAbove. */
function measure(rgba, indices, palette, badAbove = GUARD.badAbove) {
  const n = indices.length;
  let sum = 0, max = 0, bad = 0;
  for (let i = 0; i < n; i++) {
    const p = palette[indices[i]];
    const dr = Math.abs(rgba[i * 4] - p[0]), dg = Math.abs(rgba[i * 4 + 1] - p[1]), db = Math.abs(rgba[i * 4 + 2] - p[2]);
    sum += dr + dg + db;
    const m = Math.max(dr, dg, db);
    if (m > max) max = m;
    if (m > badAbove) bad++;
  }
  return { mean: sum / (3 * n), max, badFraction: bad / n };
}

/** null when the numbers are within the guard, else the first limit that is broken (a sentence). */
function guardFailure(stats, guard = GUARD) {
  if (stats.mean > guard.mean) return `mean error ${stats.mean.toFixed(2)} > ${guard.mean}`;
  if (stats.max > guard.maxChannel) return `largest channel error ${stats.max} > ${guard.maxChannel}`;
  if (stats.badFraction > guard.badFraction) return `${(stats.badFraction * 100).toFixed(2)}% of pixels off by more than ${guard.badAbove} > ${(guard.badFraction * 100).toFixed(2)}%`;
  return null;
}

/** Default quantiser; tests pass their own through opts.quantise to show the guard refuses a too-lossy one. */
function quantise(rgba, width, height, { maxColors = 256, dither = false } = {}) {
  const h = histogram(rgba);
  if (!h) return null;
  const exact = h.keys.length <= maxColors;
  const palette = exact ? Array.from(h.keys, (k) => [k >> 16, (k >> 8) & 255, k & 255]) : medianCut(h.keys, h.counts, maxColors);
  return { palette, indices: mapPixels(rgba, width, height, palette, dither && !exact), exact };
}

/**
 * Compress one PNG. status: 'compressed' | 'kept' (with a reason: smaller not enough, guard refused, alpha, unsupported) -- `buffer` is
 * always a valid picture to write (the new one, or the original untouched).
 * opts: { guard, quantise, dither, maxColors }
 */
function compressPng(input, opts = {}) {
  const before = input.length;
  const keep = (reason, stats) => ({ status: 'kept', buffer: input, before, after: before, reason, stats });
  let img;
  try { img = decodePng(input); } catch (e) { return keep(/^unsupported/.test(e.message) ? e.message : `cannot read: ${e.message}`); }
  const { width, height, rgba } = img;
  const keepChunks = img.chunks.filter((c) => ['gAMA', 'cHRM', 'sRGB', 'iCCP', 'pHYs'].includes(c.type));
  const q = opts.quantise || quantise;
  let attempt = q(rgba, width, height, { maxColors: opts.maxColors || 256, dither: false });
  if (!attempt) {
    // transparency: kept as it is unless the picture already has few enough exact colours (then a lossless palette with tRNS)
    const seen = new Map();
    for (let i = 0; i < rgba.length; i += 4) { const k = rgba.readUInt32BE(i); if (!seen.has(k) && seen.size <= 256) seen.set(k, seen.size); if (seen.size > 256) break; }
    if (seen.size > 256) return keep('has transparency and more than 256 colours: kept');
    const palette = [...seen.keys()].map((k) => [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255, k & 255]);
    const indices = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) indices[i] = seen.get(rgba.readUInt32BE(i * 4));
    const ord = firstAppearance(indices, palette);
    const out = encodePalettePng(width, height, ord.indices, ord.palette, keepChunks);
    return out.length < before * (1 - GUARD.minSaving) ? { status: 'compressed', buffer: out, before, after: out.length, exact: true, stats: { mean: 0, max: 0, badFraction: 0 } } : keep('no smaller');
  }
  const guard = { ...GUARD, ...(opts.guard || {}) };
  let stats = measure(rgba, attempt.indices, attempt.palette, guard.badAbove);
  let fail = guardFailure(stats, guard);
  if (fail && opts.dither !== false && !attempt.exact && !opts.quantise) {
    // flat colours stay exact either way; dithering only helps smooth gradients, so it is the second try
    const dithered = quantise(rgba, width, height, { maxColors: opts.maxColors || 256, dither: true });
    const s2 = measure(rgba, dithered.indices, dithered.palette, guard.badAbove);
    if (!guardFailure(s2, guard)) { attempt = dithered; stats = s2; fail = null; }
  }
  if (fail) return keep(`quality guard refused: ${fail}`, stats);
  if (attempt.palette.length > 256) return keep('quantiser returned more than 256 colours', stats);
  const ord = firstAppearance(attempt.indices, attempt.palette);
  const out = encodePalettePng(width, height, ord.indices, ord.palette, keepChunks);
  if (out.length >= before * (1 - guard.minSaving)) return keep(`not smaller by ${guard.minSaving * 100}% (${before} -> ${out.length} B)`, stats);
  return { status: 'compressed', buffer: out, before, after: out.length, exact: attempt.exact, stats };
}

const ROOT_SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');
const inside = (root, p) => { const r = path.relative(root, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };

/** Why this file may not be touched, or null: a regular file (not a symlink) whose real path is inside `root` (default docs/screenshots); `allowOutside` lifts the root rule only. */
function confinement(file, { root = ROOT_SHOTS, allowOutside = false } = {}) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) { return `cannot read: ${e.code || e.message}`; }
  if (st.isSymbolicLink()) return 'refused: it is a symbolic link';
  if (!st.isFile()) return 'refused: not a regular file';
  if (!allowOutside) {
    let real, realRoot;
    try { real = fs.realpathSync(file); realRoot = fs.realpathSync(root); } catch (e) { return `refused: cannot resolve the path (${e.code || e.message})`; }
    if (!inside(realRoot, real)) return `refused: outside ${path.basename(path.dirname(realRoot))}/${path.basename(realRoot)} (use --allow-outside to compress a file elsewhere)`;
  }
  return null;
}

/**
 * Compress a file in place. Confined (spec 050 FR-012, review on #761): never a symlink, never outside `opts.root` (default docs/screenshots)
 * unless `opts.allowOutside`; written through a new temp file in the same folder, then renamed, after checking the target is still the same file.
 * `write: false` only reports. `opts.beforeRename(file)` is a test-only hook called just before the rename.
 */
function compressFile(file, opts = {}) {
  const why = confinement(file, opts);
  if (why) return { file, status: 'kept', before: 0, after: 0, reason: why };
  const st = fs.lstatSync(file, { bigint: true }); // bigint: a file id can exceed 2^53 (Windows)
  const input = fs.readFileSync(file);
  const r = compressPng(input, opts);
  if (r.status === 'compressed' && opts.write !== false) {
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp-compress`);
    let done = false;
    try {
      fs.writeFileSync(tmp, r.buffer, { flag: 'wx' }); // fails when something is already there, never follows a planted link
      if (opts.beforeRename) opts.beforeRename(file); // test-only hook: runs right before the rename (the window the check below guards)
      const now = fs.lstatSync(file, { bigint: true });
      if (!now.isFile() || now.ino !== st.ino || now.dev !== st.dev) throw new Error('the file changed while it was compressed');
      fs.renameSync(tmp, file);
      done = true;
    } catch (e) { return { file, status: 'kept', before: r.before, after: r.before, reason: `refused: ${e.message}` }; }
    finally { if (!done) fs.rmSync(tmp, { force: true }); }
  }
  return { file, ...r, buffer: undefined };
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const dither = argv.includes('--dither') ? undefined : false;
  const allowOutside = argv.includes('--allow-outside');
  let files = argv.filter((a) => !a.startsWith('--'));
  const root = path.join(__dirname, '..');
  if (!files.length) files = require('./shots-docs.js').linkedImages(root).map((f) => path.join(root, 'docs', 'screenshots', f));
  let before = 0, after = 0, refused = 0, big = 0;
  for (const f of files) {
    const r = compressFile(f, { write: !check, dither, allowOutside });
    before += r.before; after += r.status === 'compressed' ? r.after : r.before;
    if (r.status === 'compressed') {
      if (check && r.after < r.before * 0.9) big++;
      console.log(`${check ? 'would shrink' : 'compressed'} ${path.basename(f)}: ${r.before} -> ${r.after} B (${r.exact ? 'exact palette' : `mean error ${r.stats.mean.toFixed(2)}, ${(r.stats.badFraction * 100).toFixed(3)}% pixels off`})`);
    } else {
      if (/guard refused/.test(r.reason)) refused++;
      console.log(`kept ${path.basename(f)}: ${r.reason}`);
    }
  }
  console.log(`compress-shots: ${files.length} file(s), ${before} -> ${after} B${refused ? `, ${refused} kept because of the quality guard` : ''}`);
  if (check && big) { console.error(`compress-shots: ${big} linked picture(s) could still shrink by 10% or more: run node scripts/compress-shots.js`); process.exitCode = 1; }
}

module.exports = { confinement, GUARD, decodePng, encodePalettePng, quantise, medianCut, measure, guardFailure, compressPng, compressFile, histogram };
if (require.main === module) main();
