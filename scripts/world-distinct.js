/* Spec 102 FR-016, T093 (picture half): the comparison behind `check-world-distinct.js` and `test-world-distinct.js`.
   Pure functions, no Electron and no decoder: a picture arrives as RGBA bytes (decoded by the caller) or, for the exact test, as its file bytes.
   The method is in spec 102 "Changes 2026-11-14": exact sha256 of each fixture file (copies), a mask hash and a difference hash of
   each fixture (recoloured or re-encoded copies), and the average colour of wall, floor and desk. */
'use strict';
const crypto = require('crypto');

const MASK_N = 16; // silhouette: 16x16 cells, each set when the cell is mostly opaque
const DH_W = 9, DH_H = 8; // difference hash: 9x8 luminance cells, 64 bits
const DH_CELLS = (DH_W - 1) * DH_H; // 64 positions
const DH_DEAD = 3; // luminance steps under this between neighbours count as level, so re-encoding noise does not flip them
/* Limits, set from the measured real pairs (spec 102 Changes 2026-11-14). A pair is near when BOTH hashes are within their limit. */
const LIMITS = { dhash: 8, mask: 24, deltaE: 8 };
const FLAT_RANGE = 12; // a picture whose cell luminance varies by less than this carries no shape to hash: it is compared by colour only

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Box-averages RGBA (w*h*4) into gw*gh cells: alpha-weighted mean colour and mean alpha per cell. */
function cells(rgba, w, h, gw, gh) {
  const out = [];
  for (let cy = 0; cy < gh; cy++) {
    const y0 = Math.floor((cy * h) / gh), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * h) / gh));
    for (let cx = 0; cx < gw; cx++) {
      const x0 = Math.floor((cx * w) / gw), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * w) / gw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4, al = rgba[i + 3];
        r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al; n++;
      }
      out.push(a ? { r: r / a, g: g / a, b: b / a, a: a / (255 * n) } : { r: 0, g: 0, b: 0, a: 0 });
    }
  }
  return out;
}

/* The plain mean of the channels, not the weighted luminance: swapping or rotating the colour channels of a copy leaves it unchanged. */
const lumOf = (c) => (c.r + c.g + c.b) / 3;

/** sRGB 0..255 to CIE Lab (D65). */
function lab(r, g, b) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), fy = f(0.2126 * R + 0.7152 * G + 0.0722 * B), fz = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Features of one decoded picture: { w, h, mask: 256-char 0/1 string, dh: 64-char string, per neighbouring pair 1 (lighter than its right), 2 (darker) or 0 (level), flat, avg: [r, g, b] (alpha-weighted, 0..255) }. */
function features(rgba, w, h) {
  const m = cells(rgba, w, h, MASK_N, MASK_N);
  const mask = m.map((c) => (c.a >= 0.5 ? '1' : '0')).join('');
  /* Over mid-grey, so a transparent corner reads the same in every picture. */
  const d = cells(rgba, w, h, DH_W, DH_H).map((c) => c.a * lumOf(c) + (1 - c.a) * 128);
  let dh = '';
  for (let y = 0; y < DH_H; y++) for (let x = 0; x < DH_W - 1; x++) { const diff = d[y * DH_W + x] - d[y * DH_W + x + 1]; dh += diff > DH_DEAD ? '1' : diff < -DH_DEAD ? '2' : '0'; }
  const flat = Math.max(...d) - Math.min(...d) < FLAT_RANGE && /^(0+|1+)$/.test(mask);
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < w * h * 4; i += 4) { const al = rgba[i + 3]; r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al; }
  return { w, h, mask, dh, flat, avg: a ? [r / a, g / a, b / a] : [0, 0, 0] };
}

const hamming = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
const swapLD = (dh) => dh.replace(/[12]/g, (c) => (c === '1' ? '2' : '1'));
/** The picture flipped left to right: each row of the difference hash reversed with lighter and darker swapped (a pair now reads the other way round), each row of the mask reversed. */
const mirrorDh = (dh) => { let o = ''; for (let y = 0; y < DH_H; y++) o += swapLD(dh.slice(y * (DH_W - 1), (y + 1) * (DH_W - 1))).split('').reverse().join(''); return o; };
const mirrorMask = (m) => { let o = ''; for (let y = 0; y < MASK_N; y++) o += m.slice(y * MASK_N, (y + 1) * MASK_N).split('').reverse().join(''); return o; };
/** Difference-hash distance; the light and dark swapped counts too, so an inverted copy is still near. */
const dhDistance = (a, b) => Math.min(hamming(a.dh, b.dh), hamming(a.dh, swapLD(b.dh)));
const maskDistance = (a, b) => hamming(a.mask, b.mask);
/** The nearer of the picture and its left-right mirror: { dh, mask, mirrored }. A mirrored copy is as much a copy as a recoloured one. */
function distances(a, b) {
  const plain = { dh: dhDistance(a, b), mask: maskDistance(a, b), mirrored: false };
  const m = { dh: Math.min(hamming(a.dh, mirrorDh(b.dh)), hamming(a.dh, swapLD(mirrorDh(b.dh)))), mask: hamming(a.mask, mirrorMask(b.mask)), mirrored: true };
  return m.dh + m.mask / 4 < plain.dh + plain.mask / 4 ? m : plain;
}
function deltaE(a, b) {
  const p = lab(...a.avg), q = lab(...b.avg);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** One world's pictures: { id, fixtures: { name: { sha, f? } }, colours: { wall|floor|desk: { name, f } } }. Names are file names. */
const COLOUR_ROLES = { wall: /^wall\.webp$/, floor: /^floor\.webp$/, desk: /^desk\.webp$/ };
const isFixtureFile = (n) => /^(fx-[a-z0-9-]+|desk(\.h)?|monitor(-[a-z]+)?)\.webp$/.test(n);

/**
 * Failures between two worlds: [{ kind: 'copy'|'near'|'colour', msg }].
 * copy: the same sha256 (a file copied, whatever its name). near: both hashes within LIMITS (a recoloured or re-encoded copy).
 * colour: the average colour of the wall, floor or desk within LIMITS.deltaE. Flat pictures are skipped by `near` (nothing to hash).
 */
function comparePair(A, B, limits = LIMITS) {
  const out = [];
  const seen = new Set();
  for (const [na, fa] of Object.entries(A.fixtures)) for (const [nb, fb] of Object.entries(B.fixtures)) {
    if (fa.sha && fa.sha === fb.sha) { out.push({ kind: 'copy', msg: `${A.id}/${na} and ${B.id}/${nb} are the same file (sha256 ${fa.sha.slice(0, 12)})` }); seen.add(na + '|' + nb); continue; }
    if (!fa.f || !fb.f || fa.f.flat || fb.f.flat || seen.has(na + '|' + nb)) continue;
    const { dh: dd, mask: md, mirrored } = distances(fa.f, fb.f);
    if (dd <= limits.dhash && md <= limits.mask) out.push({ kind: 'near', msg: `${A.id}/${na} and ${B.id}/${nb} look the same (difference hash ${dd}/64 apart, silhouette ${md}/256 apart${mirrored ? ', mirrored' : ''}): a recoloured, re-encoded or mirrored copy` });
  }
  for (const role of Object.keys(COLOUR_ROLES)) {
    const a = A.colours[role], b = B.colours[role];
    if (!a || !b) continue;
    const de = deltaE(a.f, b.f);
    if (de <= limits.deltaE) out.push({ kind: 'colour', msg: `${A.id}/${a.name} and ${B.id}/${b.name} have the same average colour (delta E ${de.toFixed(1)}, limit ${limits.deltaE})` });
  }
  return out;
}

/** Rejects with a message naming the step when `p` has not settled in `ms` (the Electron check's watchdog). */
const within = (p, ms, label) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`check-world-distinct: "${label}" did not finish in ${ms / 1000} s`)), ms);
  Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/** Every pair of the worlds, sorted by id. */
function compareAll(worlds, limits = LIMITS) {
  const ws = [...worlds].sort((x, y) => (x.id < y.id ? -1 : 1));
  const out = [];
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) out.push(...comparePair(ws[i], ws[j], limits));
  return out;
}

/** Exact copies only, from file bytes: what plain Node can do without a decoder. `files` maps name to Buffer. */
function worldFromBytes(id, files) {
  const fixtures = {};
  for (const [n, buf] of Object.entries(files)) if (isFixtureFile(n)) fixtures[n] = { sha: sha256(buf) };
  return { id, fixtures, colours: {} };
}

module.exports = { within, LIMITS, MASK_N, DH_CELLS, sha256, features, cells, lab, hamming, dhDistance, maskDistance, distances, mirrorDh, mirrorMask, deltaE, comparePair, compareAll, worldFromBytes, isFixtureFile, COLOUR_ROLES };
