/*
 * scripts/pencil-park.js (spec 097 FR-365): where the pencil-ease driver parks the pointer. Made-up screen and window numbers, no Electron, no simulator.
 *   PARK_MUTANT=old   the points of the first version (the page's middle above the stage, whatever the screen): must fail "every candidate is on the visible screen"
 *   PARK_MUTANT=stage the spots a bar and a half lower, in the stage: must fail "every candidate is above the stage"
 */
const assert = require('assert');
const { visibleOf, parkVisible, parkCandidates } = require('./pencil-park');
const OLD = process.env.PARK_MUTANT === 'old';
const IN_STAGE = process.env.PARK_MUTANT === 'stage';
const cands = (o) => IN_STAGE ? parkCandidates({ ...o, top: o.top * 2 + 40 }) : OLD ? [{ x: Math.round(o.view[0] / 2), y: Math.max(1, Math.round(o.top) - 4) }, { x: 1, y: 1 }, { x: o.view[0] - 2, y: 1 }] : parkCandidates(o);
const CASES = [
  /* the Linux/Xvfb case of the review: a 1440x900 window at devicePixelRatio 2 (2880x1800 device px) at (0, 62) on a 1280x1024 screen */
  { name: 'Xvfb 1280x1024, window 2880x1800 at DPR 2', o: { view: [1440, 900], top: 62, screen: [1280, 1024], at: [0, 62], dpr: 2 }, visible: [640, 481] },
  { name: 'Xvfb 1280x1024, DPR 1, window 1440x900', o: { view: [1440, 900], top: 62, screen: [1280, 1024], at: [0, 62], dpr: 1 }, visible: [1280, 900] },
  { name: 'a large screen, DPR 2 (the Mac)', o: { view: [1440, 900], top: 62, screen: [3456, 2234], at: [0, 76], dpr: 2 }, visible: [1440, 900] },
  { name: 'a window moved right, off the screen by 100 css px at DPR 1', o: { view: [1440, 900], top: 62, screen: [1920, 1080], at: [580, 0], dpr: 1 }, visible: [1340, 900] },
];
for (const c of CASES) {
  assert.deepStrictEqual(visibleOf(c.o), c.visible, `${c.name}: the visible part of the page`);
  const list = cands(c.o);
  assert.ok(list.length > 0, `${c.name}: there is a candidate`);
  assert.deepStrictEqual(list.filter((p) => !parkVisible(p, c.o)), [], `${c.name}: every candidate is on the visible screen (${JSON.stringify(list)})`);
}
/* every candidate is above the stage (in the bar), so no desk, monitor, table or plate is under it, and the corner (1, 1) is on the screen in every case */
for (const c of CASES) {
  assert.ok(cands(c.o).every((p) => p.y < c.o.top), `${c.name}: every candidate is above the stage (y < ${c.o.top})`);
  assert.ok(cands(c.o).some((p) => p.x === 1 && p.y === 1), `${c.name}: the corner (1, 1) is a candidate and on the screen`);
}
/* the first choice is the page's middle above the stage where it is on the screen, else the top-left corner */
assert.deepStrictEqual(parkCandidates(CASES[2].o)[0], { x: 720, y: 31 }, 'a large screen: the middle of the bar above the stage first');
assert.deepStrictEqual(parkCandidates(CASES[0].o)[0], { x: 320, y: 31 }, 'the small screen at DPR 2: the middle of the visible part, in the bar above the stage');
assert.deepStrictEqual(parkCandidates({ view: [1440, 900], top: 62, screen: [10, 10], at: [0, 62], dpr: 1 }), [], 'a screen with no visible page: no candidate (the driver says so, labelled)');
console.log('test-pencil-park: ok' + (OLD ? ' (mutant old: should not get here)' : ''));
