/** Spec 097 FR-322, FR-323, FR-325 (T222): the line round a monitor frame: the band the existing context level gives, the dash for the share, the words of
 *  the plate's name. Pure functions, plain Node, no DOM, no credits. Run by `npm run test:realoffice-layout`. */
import * as assert from 'assert';
import * as path from 'path';
import { ctxFrame, ctxWords } from '../src/shared/realoffice-layout';

const S = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'toolstats.js')) as { ctxLevel: (u: unknown, l: unknown) => { pct: number | null; level: string } };
/** the page's chain: share and band from the one ctxLevel, then the frame */
const frame = (used: unknown, limit: unknown) => { const c = S.ctxLevel(used, limit); return ctxFrame(c.pct, c.level); };

// bands: the existing steps (ok below 70, warn 70..90, high above 90)
for (const [pct, lv] of [[1, 'ok'], [30, 'ok'], [69, 'ok'], [70, 'warn'], [75, 'warn'], [90, 'warn'], [91, 'high'], [95, 'high'], [100, 'high']] as const) {
  const f = frame(pct * 10, 1000);
  assert.ok(f, `${pct} % has a line`);
  assert.strictEqual(f.lv, lv, `${pct} % is ${lv}`);
  assert.strictEqual(f.dash, pct + ' 100', `${pct} %: the dash is the share of a 100-long outline`);
}
// over the window: capped at the whole outline
assert.strictEqual(frame(5000, 1000)?.dash, '100 100');
// unknown, or nothing used: no line (never an empty track that reads as 0 %)
for (const [u, l] of [[undefined, 1000], [500, 0], [500, undefined], [NaN, 1000], [Infinity, 1000], ['5', 1000], [-1, 1000], [0, 1000]] as const) assert.strictEqual(frame(u, l), null, `no line for ${String(u)} of ${String(l)}`);
assert.strictEqual(ctxFrame(null, 'unknown'), null);
assert.strictEqual(ctxFrame(50, 'unknown'), null, 'a share with an unknown band draws nothing');
assert.strictEqual(ctxFrame(NaN, 'ok'), null);
// the words of the plate's name
assert.strictEqual(ctxWords(72), ', context 72 %');
assert.strictEqual(ctxWords(0), ', context 0 %');
assert.strictEqual(ctxWords(null), '');
assert.strictEqual(ctxWords(undefined), '');
assert.strictEqual(ctxWords(NaN), '');
console.log('realoffice context frame tests passed');
