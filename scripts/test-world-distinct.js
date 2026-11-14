/* Spec 102 FR-016, T093 (picture half), plain Node: the comparison of scripts/world-distinct.js on planted pictures (a copied fixture,
   a recoloured copy, a re-encoded copy, the same average colour, flat pictures) and the exact-copy test on the real worlds' files.
   The perceptual half on the real WebP files needs Electron: `npm run check:world-distinct`. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('./world-distinct');

const ROOT = path.join(__dirname, '..');
const SRC = process.env.DURBAR_WORLDS_SRC || path.join(ROOT, 'src', 'renderer', 'realoffice', 'worlds');

/* A seeded cutout: some filled blobs of random colour on a transparent ground, w x h RGBA. */
function picture(seed, w = 64, h = 64, opaque = false) {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const px = Buffer.alloc(w * h * 4);
  if (opaque) for (let i = 0; i < px.length; i += 4) px[i + 3] = 255;
  for (let k = 0; k < 7; k++) {
    const x0 = Math.floor(rnd() * w * 0.7), y0 = Math.floor(rnd() * h * 0.7), bw = 6 + Math.floor(rnd() * w * 0.4), bh = 6 + Math.floor(rnd() * h * 0.4);
    const c = [rnd() * 255, rnd() * 255, rnd() * 255];
    for (let y = y0; y < Math.min(h, y0 + bh); y++) for (let x = x0; x < Math.min(w, x0 + bw); x++) { const i = (y * w + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
  }
  return { rgba: px, w, h };
}
/* An opaque picture of random 4 px blocks: no two neighbouring cells tie, so its light and dark swap exactly. */
function blocks(seed, w = 64, h = 64) {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const px = Buffer.alloc(w * h * 4);
  for (let by = 0; by < h / 4; by++) for (let bx = 0; bx < w / 4; bx++) {
    const c = [rnd() * 255, rnd() * 255, rnd() * 255];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const i = ((by * 4 + y) * w + bx * 4 + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
  }
  return { rgba: px, w, h };
}
const recolour = (p) => { const o = Buffer.from(p.rgba); for (let i = 0; i < o.length; i += 4) { o[i] = p.rgba[i + 2]; o[i + 1] = p.rgba[i]; o[i + 2] = p.rgba[i + 1]; } return { ...p, rgba: o }; };
const invert = (p) => { const o = Buffer.from(p.rgba); for (let i = 0; i < o.length; i += 4) { o[i] = 255 - o[i]; o[i + 1] = 255 - o[i + 1]; o[i + 2] = 255 - o[i + 2]; } return { ...p, rgba: o }; };
/* A lossy re-encode stand-in: halve the size by averaging 2x2, then blow it up again, and nudge every value. */
function reencode(p) {
  const o = Buffer.from(p.rgba);
  for (let y = 0; y < p.h; y += 2) for (let x = 0; x < p.w; x += 2) {
    const idx = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => ((y + dy) * p.w + x + dx) * 4);
    const al = idx.reduce((t, i) => t + p.rgba[i + 3], 0);
    for (const i of idx) {
      for (let c = 0; c < 3; c++) o[i + c] = al ? Math.max(0, Math.min(255, Math.round(idx.reduce((t, j) => t + p.rgba[j + c] * p.rgba[j + 3], 0) / al) + ((x + y) % 3) - 1)) : 0;
      o[i + 3] = Math.round(al / 4);
    }
  }
  return { ...p, rgba: o };
}
const mirror = (p) => { const o = Buffer.alloc(p.rgba.length); for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) p.rgba.copy(o, (y * p.w + x) * 4, (y * p.w + (p.w - 1 - x)) * 4, (y * p.w + (p.w - 1 - x)) * 4 + 4); return { ...p, rgba: o }; };
const double = (p) => { const o = Buffer.alloc(p.w * 2 * p.h * 2 * 4); for (let y = 0; y < p.h * 2; y++) for (let x = 0; x < p.w * 2; x++) p.rgba.copy(o, (y * p.w * 2 + x) * 4, ((y >> 1) * p.w + (x >> 1)) * 4, ((y >> 1) * p.w + (x >> 1)) * 4 + 4); return { rgba: o, w: p.w * 2, h: p.h * 2 }; };
const solid = (rgb, w = 32, h = 32) => { const px = Buffer.alloc(w * h * 4); for (let i = 0; i < px.length; i += 4) { px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255; } return { rgba: px, w, h }; };

const feat = (p) => D.features(p.rgba, p.w, p.h);
/* A world from decoded pictures: fixtures by name, colour roles by name; the "file" is the pixel bytes, so equal pixels are an exact copy. */
function world(id, fixtures, colours = {}) {
  const fx = {}; for (const [n, p] of Object.entries(fixtures)) fx[n] = { sha: D.sha256(p.rgba), f: feat(p) };
  const co = {}; for (const [r, p] of Object.entries(colours)) co[r] = { name: `${r}.webp`, f: feat(p) };
  return { id, fixtures: fx, colours: co };
}
const kinds = (a, b) => D.comparePair(a, b).map((c) => c.kind).sort();

const base = picture(1);
const A = world('a', { 'fx-bank.webp': base, 'fx-blocks.webp': blocks(7), 'fx-web.webp': picture(2) }, { floor: picture(10, 64, 64, true) });

/* The labels below are the mutants' names: each plant is killed at its own label. */
{
  const B = world('b', { 'fx-bank.webp': picture(3), 'fx-web.webp': picture(4), 'fx-boss.webp': picture(5) }, { floor: picture(11, 64, 64, true) });
  assert.deepStrictEqual(D.comparePair(A, B), [], 'two different worlds pass');
  assert.ok(D.comparePair(A, world('b', { 'fx-other.webp': base })).some((c) => c.kind === 'copy' && /a\/fx-bank\.webp and b\/fx-other\.webp are the same file/.test(c.msg)), 'COPY: a copied fixture fails as a copy, naming both files, under another name');
  assert.deepStrictEqual(kinds(A, world('b', { 'fx-bank.webp': recolour(base) })), ['near'], 'RECOLOURED: a channel-rotated copy fails as near');
  assert.deepStrictEqual(kinds(A, world('b', { 'fx-bank.webp': invert(blocks(7)) })), ['near'], 'RECOLOURED: an inverted copy fails as near');
  assert.deepStrictEqual(kinds(A, world('b', { 'fx-bank.webp': reencode(base) })), ['near'], 'RE-ENCODED: a blurred and nudged copy fails as near');
  assert.ok(D.dhDistance(feat(base), feat(reencode(base))) <= 2, 'RE-ENCODED: a nudge of one step moves the difference hash by at most 2 (the level band absorbs it)');
  /* 144 px: the cell grids (9, 8 and 16) divide it, so a flip lands on the same cells, as the real pictures' sizes mostly do closely enough (planted: 3/64). */
  const big = world('a', { 'fx-bank.webp': picture(1, 144, 144), 'fx-blocks.webp': blocks(7, 144, 144) });
  assert.deepStrictEqual(kinds(big, world('b', { 'fx-bank.webp': mirror(picture(1, 144, 144)) })), ['near'], 'MIRRORED: a left-right flipped copy fails as near');
  assert.deepStrictEqual(kinds(big, world('b', { 'fx-bank.webp': mirror(blocks(7, 144, 144)) })), ['near'], 'MIRRORED: a flipped opaque copy fails as near');
  assert.ok(/mirrored\)/.test(D.comparePair(big, world('b', { 'fx-bank.webp': mirror(picture(1, 144, 144)) }))[0].msg), 'MIRRORED: the message says it was mirrored');
  assert.deepStrictEqual(kinds(A, world('b', { 'fx-bank.webp': double(base) })), ['near'], 'RE-ENCODED: a copy at twice the size fails as near');
}
{
  const f1 = world('a', {}, { floor: solid([200, 170, 140]) }), f2 = world('b', {}, { floor: solid([203, 173, 147]) }), f3 = world('c', {}, { floor: solid([20, 60, 120]) });
  assert.deepStrictEqual(D.comparePair(f1, f2).map((c) => c.kind), ['colour'], 'COLOUR: the same average colour fails');
  assert.match(D.comparePair(f1, f2)[0].msg, /a\/floor\.webp and b\/floor\.webp have the same average colour/, 'COLOUR: the message names both files');
  assert.deepStrictEqual(D.comparePair(f1, f3), [], 'a different average colour passes');
  /* The limit is a closed bound: at it fails, over it passes. */
  const de = D.deltaE(f1.colours.floor.f, f2.colours.floor.f);
  assert.deepStrictEqual(D.comparePair(f1, f2, { ...D.LIMITS, deltaE: de }).length, 1, 'delta E at the limit fails');
  assert.deepStrictEqual(D.comparePair(f1, f2, { ...D.LIMITS, deltaE: de - 0.01 }).length, 0, 'delta E over the limit passes');
  const w1 = world('a', { 'fx-x.webp': base }), w2 = world('b', { 'fx-x.webp': recolour(base) });
  const dd = D.dhDistance(w1.fixtures['fx-x.webp'].f, w2.fixtures['fx-x.webp'].f), md = D.maskDistance(w1.fixtures['fx-x.webp'].f, w2.fixtures['fx-x.webp'].f);
  assert.strictEqual(D.comparePair(w1, w2, { dhash: dd, mask: md, deltaE: 0 }).length, 1, 'both hashes at their limits fail');
  assert.strictEqual(D.comparePair(w1, w2, { dhash: dd, mask: md - 1, deltaE: 0 }).length, 0, 'the silhouette over its limit passes: both hashes must be near');
}
{
  /* Flat pictures carry no shape: they are not compared by hash, and they do not make every world a clash. */
  const a = world('a', { 'fx-a.webp': solid([10, 10, 10]) }), b = world('b', { 'fx-b.webp': solid([240, 240, 240]) });
  assert.ok(feat(solid([10, 10, 10])).flat, 'a solid picture is flat');
  assert.ok(!feat(base).flat, 'a drawn picture is not');
  assert.deepStrictEqual(D.comparePair(a, b), [], 'two flat fixtures of different colours pass');
  assert.deepStrictEqual(D.comparePair(a, world('b', { 'fx-b.webp': solid([10, 10, 10]) })).map((c) => c.kind), ['copy'], 'but identical bytes are still a copy');
}
{
  /* File helpers: only fixtures count; a kid picture or a CSS file is not a fixture. */
  for (const n of ['fx-bank.webp', 'fx-web.webp', 'desk.webp', 'desk.h.webp', 'monitor.webp', 'monitor-half.webp']) assert.ok(D.isFixtureFile(n), n);
  for (const n of ['kid1-done.webp', 'floor.webp', 'wall.webp', 'world.css', 'glow.webp', 'fx-bank.png']) assert.ok(!D.isFixtureFile(n), n);
}

/* The limits are pinned (FR-016): the values of the spec delta, and the real pairs measured in Electron on 2026-11-14 (a committed table, not decoded here)
   all sit outside them by their margins, so a limit moved onto a real pair (14/27, say) fails here and not only in the by-hand Electron check. */
{
  assert.deepStrictEqual(D.LIMITS, { dhash: 8, mask: 24, deltaE: 8 }, 'LIMITS: difference hash 8/64, silhouette 24/256, delta E 8');
  const MEASURED = [ // nearest fixtures of each real pair (both hashes, mirror included): difference hash /64, silhouette /256
    { pair: 'cave/photo', dh: 13, mask: 27 }, { pair: 'cave/retro', dh: 17, mask: 40 }, { pair: 'photo/retro', dh: 22, mask: 42 },
  ];
  for (const m of MEASURED) {
    assert.ok(m.dh - D.LIMITS.dhash >= 5, `LIMITS: the ${m.pair} pair (${m.dh}/64) stays at least 5 bits above the difference-hash limit`);
    assert.ok(m.mask > D.LIMITS.mask, `LIMITS: the ${m.pair} pair (${m.mask}/256) stays above the silhouette limit`);
  }
  assert.ok(20.3 - D.LIMITS.deltaE >= 12, 'LIMITS: the closest real colour pair (photo and retro floors, delta E 20.3) stays 12 above the colour limit');
  /* A planted copy under the limits still fails with room: the measured planted distances are 0..4 of 64 (mirrored 3, re-encoded 2). */
  assert.ok(4 + 4 <= D.LIMITS.dhash, 'LIMITS: planted copies measured at 4/64 at most keep 4 bits under the limit');
}
{
  const done = { hung: false, quick: false };
  D.within(new Promise(() => {}), 20, 'decode x/y.webp').catch((e) => { assert.match(e.message, /"decode x\/y\.webp" did not finish/, 'WATCHDOG: a step that never settles fails, naming it'); done.hung = true; });
  D.within(Promise.resolve(7), 1000, 'quick').then((v) => { assert.strictEqual(v, 7, 'WATCHDOG: a step that settles passes its value'); done.quick = true; });
  process.on('exit', (c) => { if (c === 0 && !(done.hung && done.quick)) { console.error('FAIL WATCHDOG: a hung step was not failed, or a quick one not passed'); process.exitCode = 1; } });
}

/* The real worlds: no fixture file is the same as another world's (exact sha256 of the bytes). Plain Node needs no decoder. */
{
  const load = (dir) => {
    const worlds = [];
    for (const id of fs.readdirSync(dir).sort()) {
      const d = path.join(dir, id);
      if (!fs.statSync(d).isDirectory() || !fs.existsSync(path.join(d, 'world.json'))) continue;
      const files = {};
      for (const n of fs.readdirSync(d)) if (n.endsWith('.webp')) files[n] = fs.readFileSync(path.join(d, n));
      worlds.push(D.worldFromBytes(id, files));
    }
    return worlds;
  };
  const real = load(SRC);
  assert.ok(real.length >= 3, 'photo, cave and retro are found in ' + SRC);
  const bad = D.compareAll(real);
  for (const b of bad) console.error('FAIL ' + b.msg);
  assert.deepStrictEqual(bad, [], 'no world reuses another world\'s fixture file');
  /* A planted copy of a real fixture under another world is found (the mutant of the real test). */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-distinct-'));
  try {
    fs.cpSync(SRC, tmp, { recursive: true, filter: (s) => !/kid\d/.test(path.basename(s)) });
    fs.mkdirSync(path.join(tmp, 'zz'));
    fs.writeFileSync(path.join(tmp, 'zz', 'world.json'), '{}');
    fs.copyFileSync(path.join(SRC, 'cave', 'fx-bank.webp'), path.join(tmp, 'zz', 'fx-other.webp'));
    const planted = D.compareAll(load(tmp));
    assert.strictEqual(planted.length, 1, 'a planted copy is the only problem');
    assert.match(planted[0].msg, /cave\/fx-bank\.webp and zz\/fx-other\.webp are the same file/, 'a planted copy of a real fixture is found, naming both files');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`test-world-distinct OK (${real.length} worlds: ${real.map((w) => w.id).join(', ')})`);
}
