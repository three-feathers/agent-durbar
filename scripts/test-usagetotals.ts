/** Office and per-folder usage totals (spec 011 FR-018..FR-023): `npm run test:usagetotals`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';
type Total = { calls: number; inTokens: number; outTokens: number; nano: number; unreported: number };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const U = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'usagetotals.js')) as {
  createLedger: () => { record: (room: string, e: unknown) => void; room: (id: string) => Total; roomIds: () => string[]; office: () => Total };
  validNano: (x: unknown) => boolean;
  fmtTotal: (t: Total, digits?: number) => string;
  fmtShort: (t: Total) => string;
  tooltip: (t: Total, o?: { scope?: string; removed?: boolean }) => string;
};

const ev = (inputTokens: number, outputTokens: number, nanoAiu?: unknown) => ({ type: 'usage', inputTokens, outputTokens, nanoAiu });
const AIU = 1e9;

// sums per folder and for the office; the office is the sum of the folders (SC-001)
const l = U.createLedger();
l.record('a', ev(1000, 100, 0.5 * AIU));
l.record('a', ev(2000, 200, 0.25 * AIU));
l.record('b', ev(500, 50, 1.25 * AIU));
assert.deepStrictEqual(l.room('a'), { calls: 2, inTokens: 3000, outTokens: 300, nano: 0.75 * AIU, unreported: 0 });
assert.strictEqual(l.room('b').nano, 1.25 * AIU);
assert.strictEqual(l.office().calls, 3);
assert.strictEqual(l.office().nano, l.room('a').nano + l.room('b').nano, 'office total equals the sum of the folders');
assert.deepStrictEqual(l.roomIds().sort(), ['a', 'b']);
assert.strictEqual(U.fmtTotal(l.office()), '2.00 AIU');
assert.strictEqual(U.fmtTotal(l.office(), 3), '2.000 AIU');
assert.strictEqual(U.fmtShort(l.room('a')), '0.75 AIU');

// nothing is ever subtracted: a folder that disappears from the screen still counted (the ledger has no remove)
assert.strictEqual(typeof (l as unknown as { remove?: unknown }).remove, 'undefined', 'the ledger cannot forget spend');
const before = l.office().nano;
l.record('a', ev(1, 1, 0));
assert.strictEqual(l.office().nano, before, 'a reported zero adds nothing but counts as a call');
assert.strictEqual(l.room('a').calls, 3);

// unknown folder: empty, not an error
assert.deepStrictEqual(l.room('nope'), { calls: 0, inTokens: 0, outTokens: 0, nano: 0, unreported: 0 });
assert.strictEqual(U.fmtTotal(l.room('nope')), '', 'no calls: nothing to show');
assert.strictEqual(U.fmtShort(l.room('nope')), '');
assert.strictEqual(U.tooltip(l.room('nope')), '');

// invalid credit figures are "not reported", never NaN or a huge number
const bad = U.createLedger();
for (const x of [undefined, null, '5', NaN, Infinity, -1, 1e16, {}]) bad.record('r', ev(10, 1, x));
assert.strictEqual(bad.room('r').calls, 8);
assert.strictEqual(bad.room('r').unreported, 8);
assert.strictEqual(bad.room('r').nano, 0);
assert.strictEqual(U.fmtTotal(bad.room('r')), 'credits not reported', 'all calls unreported: never 0.00 AIU');
assert.strictEqual(U.fmtShort(bad.room('r')), 'n/r');
assert.ok(!/NaN|Infinity/.test(U.tooltip(bad.room('r'))));
assert.ok(/credits not reported/.test(U.tooltip(bad.room('r'), { scope: 'folder' })));
assert.ok(U.validNano(0) && U.validNano(1e15) && !U.validNano(1e15 + 1) && !U.validNano(-0.001));

// partly reported: the value is shown and the tooltip says how many calls did not report
const mix = U.createLedger();
mix.record('m', ev(100, 10, 2 * AIU));
mix.record('m', ev(100, 10, undefined));
assert.strictEqual(U.fmtTotal(mix.room('m')), '2.00 AIU');
assert.ok(/1 call did not report credits/.test(U.tooltip(mix.room('m'))));

// bad token fields do not poison the sums; missing event or room is ignored
const tk = U.createLedger();
tk.record('t', { inputTokens: NaN, outputTokens: -5, nanoAiu: AIU });
tk.record('t', undefined);
tk.record(undefined as unknown as string, ev(1, 1, AIU));
assert.deepStrictEqual(tk.room('t'), { calls: 1, inTokens: 0, outTokens: 0, nano: AIU, unreported: 0 });
assert.strictEqual(tk.office().calls, 1);

// helper usage is recorded once, through the parent's event (the app calls record once per event): replaying one helper event
// and one parent event gives two calls, not three
const h = U.createLedger();
h.record('room', ev(3900, 60, 0.008 * AIU)); // helper event (carries an agentId in the app)
h.record('room', ev(12000, 1500, 0.041 * AIU)); // parent event
assert.strictEqual(h.office().calls, 2);
assert.strictEqual(U.fmtTotal(h.office(), 3), '0.049 AIU');

// tooltips
const tip = U.tooltip(l.office(), { scope: 'office', removed: true });
assert.ok(/^Office total: 2\.000 AIU/.test(tip) && /Includes folders no longer shown/.test(tip) && /ended sessions are included/.test(tip) && /1 AIU = 1 AI credit, not verified against billing/.test(tip));
assert.ok(/^Folder total: /.test(U.tooltip(l.room('a'), { scope: 'folder' })));
assert.ok(!/no longer shown/.test(U.tooltip(l.office(), { scope: 'office' })));

console.log('usagetotals tests passed');
