/** The message box's size rules (spec 005 FR-044, FR-046, FR-048; issue #592): the automatic cap, the transcript floor, keys and the
 *  remembered value. `npm run test:composersize`. Pure module; runs on any OS; no Electron, no credits. */
import * as assert from 'assert';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
type Lim = { min: number; max: number; auto: number };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const C = require(path.join(ROOT, 'src', 'renderer', 'composersize.js')) as {
  MIN: number; AUTO_FLOOR: number; AUTO_FRAC: number; KEEP: number; STEP: number; PAGE: number; KEY: string;
  limits: (m: { panelH: number; chatH: number; boxH: number }) => Lim;
  clamp: (h: number, l: Lim) => number;
  height: (o: { chosen: number | null; content: number; lim: Lim }) => number;
  keyStep: (key: string, h: number, l: Lim) => number | 'reset' | null;
  parse: (v: unknown) => number | null;
};

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log('ok ' + name); };

t('constants', () => {
  assert.strictEqual(C.MIN, 36); assert.strictEqual(C.AUTO_FLOOR, 110); assert.strictEqual(C.AUTO_FRAC, 0.4);
  assert.strictEqual(C.KEEP, 140); assert.strictEqual(C.STEP, 16); assert.strictEqual(C.PAGE, 64);
  assert.strictEqual(C.KEY, 'durbar.composerHeight');
});

t('FR-044: the automatic cap is 40% of the panel, at least 110px', () => {
  // a 1440x900 panel (about 850px), a roomy chat
  let l = C.limits({ panelH: 850, chatH: 500, boxH: 36 });
  assert.strictEqual(l.auto, 340);
  assert.strictEqual(l.min, 36);
  assert.strictEqual(l.max, 36 + 500 - 140);
  // a small panel: 40% would be under 110, the floor wins
  l = C.limits({ panelH: 200, chatH: 400, boxH: 36 });
  assert.strictEqual(l.auto, 110);
});

t('FR-046: the transcript keeps 140px; the cap never passes it', () => {
  const l = C.limits({ panelH: 850, chatH: 300, boxH: 50 }); // max = 50 + 300 - 140 = 210 < 340
  assert.strictEqual(l.max, 210);
  assert.strictEqual(l.auto, 210);
  // the sum box + chat is what counts, so measuring after a resize gives the same limits (idempotent)
  const after = C.limits({ panelH: 850, chatH: 300 - (210 - 50), boxH: 210 });
  assert.deepStrictEqual(after, l);
  // a window too small for the floor still leaves one line
  const tiny = C.limits({ panelH: 300, chatH: 60, boxH: 36 });
  assert.strictEqual(tiny.max, 36); assert.strictEqual(tiny.auto, 36);
});

t('clamp and height: chosen size fixed and clamped; automatic follows the text up to the cap', () => {
  const l = { min: 36, max: 400, auto: 300 };
  assert.strictEqual(C.clamp(10, l), 36);
  assert.strictEqual(C.clamp(999, l), 400);
  assert.strictEqual(C.clamp(123.6, l), 124);
  assert.strictEqual(C.height({ chosen: null, content: 20, lim: l }), 36);
  assert.strictEqual(C.height({ chosen: null, content: 180, lim: l }), 180);
  assert.strictEqual(C.height({ chosen: null, content: 900, lim: l }), 300);
  // a chosen size does not follow the text (FR-045), and a too tall one is shown clamped (FR-046)
  assert.strictEqual(C.height({ chosen: 200, content: 40, lim: l }), 200);
  assert.strictEqual(C.height({ chosen: 200, content: 900, lim: l }), 200);
  assert.strictEqual(C.height({ chosen: 700, content: 40, lim: l }), 400);
});

t('FR-048: keys', () => {
  const l = { min: 36, max: 400, auto: 300 };
  assert.strictEqual(C.keyStep('ArrowUp', 100, l), 116);
  assert.strictEqual(C.keyStep('ArrowDown', 100, l), 84);
  assert.strictEqual(C.keyStep('PageUp', 100, l), 164);
  assert.strictEqual(C.keyStep('PageDown', 100, l), 36);
  assert.strictEqual(C.keyStep('Home', 100, l), 36);
  assert.strictEqual(C.keyStep('End', 100, l), 400);
  assert.strictEqual(C.keyStep('ArrowUp', 395, l), 400);
  assert.strictEqual(C.keyStep('Enter', 100, l), 'reset');
  assert.strictEqual(C.keyStep('ArrowLeft', 100, l), null);
  assert.strictEqual(C.keyStep('a', 100, l), null);
});

t('FR-047: the remembered value', () => {
  assert.strictEqual(C.parse('240'), 240);
  assert.strictEqual(C.parse('240.4'), 240);
  for (const bad of [null, undefined, '', 'abc', 'NaN', 'Infinity', '-5', '0', '12', '99999', '{}', 'true']) assert.strictEqual(C.parse(bad), null, String(bad));
});

console.log(`composer size: ${n} groups passed`);
