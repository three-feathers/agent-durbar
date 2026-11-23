/* Spec 102 T445 (issue #2009): the arcade's `wallSigns` boxes (grid pixels of the 720 x 118 wall picture) cover the neon each sign draws, at every size.
   NEON below is the drawn extent of each sign in wall-night.webp, measured once from the picture: lit pixels (max channel over 140, spread over 50)
   outside the rim rows (a tube along the whole room), as [x0, y0, x1, y1] with x1 and y1 exclusive. A box one grid pixel short on the right or the bottom
   (the first version: star 22 wide, sign 22 x 16, heart 20 wide) left 1-2 lit pixels under a name chip at 1440x900 (PR #2022 CI), so the renderer's box
   is the grid box plus the one pixel SIGN_PAD the scaled picture bleeds. Re-measure NEON when scripts/build-arcade-pack.py redraws the wall.
   WALL_SIGNS_MUTANT=short  shrinks every box by one grid pixel (dies at "the box covers the neon"). No simulator, no Electron, no credits. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const NEON = { bolt: [200, 10, 215, 33], star: [291, 9, 314, 30], sign: [407, 10, 430, 27], heart: [508, 9, 529, 27] };
const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice', 'worlds', 'retro', 'world.json'), 'utf8'));
const MUTANT = process.env.WALL_SIGNS_MUTANT || '';
const boxes = world.wallSigns.map((s) => (MUTANT === 'short' ? { ...s, w: s.w - 1, h: s.h - 1 } : s));
assert.deepStrictEqual(boxes.map((s) => s.id).sort(), Object.keys(NEON).sort(), 'the arcade names the four signs the wall draws');

/* the sizes the lobby is drawn at (lobby height / 118 per grid pixel, 103 and 105 px at 1440x900 and 1280x800): a box padded by the renderer's 1 px must hold the neon, drawn rounded outward */
for (const k of [103 / 118, 105 / 118, 1]) {
  for (const s of boxes) {
    const [x0, y0, x1, y1] = NEON[s.id];
    assert.ok(s.x <= x0 && s.y <= y0 && s.x + s.w >= x1 && s.y + s.h >= y1, `the box covers the neon: ${s.id} box ${s.x},${s.y},${s.x + s.w},${s.y + s.h} vs drawn ${x0},${y0},${x1},${y1} (k ${k.toFixed(3)})`);
  }
}
const py = fs.readFileSync(path.join(ROOT, 'scripts', 'build-arcade-pack.py'), 'utf8');
for (const s of world.wallSigns) assert.ok(py.includes(`dict(id='${s.id}', x=${s.x}, y=${s.y}, w=${s.w}, h=${s.h})`), `build-arcade-pack.py WALL_SIGNS has ${s.id} as world.json does`);
const rs = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice.js'), 'utf8');
assert.ok(/const SIGN_PAD = 1;/.test(rs) && (rs.match(/SIGN_PAD/g) || []).length >= 5, 'signRects pads each box by SIGN_PAD');
console.log('wall signs: ok');
