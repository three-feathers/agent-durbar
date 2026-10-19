/** Office and per-folder usage totals (spec 011 FR-018..FR-023): `npm run test:usagetotals`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';
type Total = { calls: number; inTokens: number; outTokens: number; nano: number; unreported: number };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const U = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'usagetotals.js')) as {
  createLedger: () => { record: (room: string, e: unknown) => void; room: (id: string, key?: string) => Total; roomRun: (id: string) => Total; roomIds: () => string[]; office: () => Total; officeRun: () => Total; setBaseline: (v: unknown) => void; clearRun: () => void; since: () => string; hasUnlisted: () => boolean };
  validNano: (x: unknown) => boolean;
  fmtTotal: (t: Total, digits?: number) => string;
  fmtShort: (t: Total) => string;
  tooltip: (t: Total, o?: { scope?: string; removed?: boolean; since?: string; run?: Total; offFloors?: Total }) => string;
  sum: (list: Total[]) => Total;
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
assert.strictEqual(U.fmtTotal(bad.room('r')), 'cost not reported', 'all calls unreported: never 0.00 AIU');
assert.strictEqual(U.fmtShort(bad.room('r')), 'n/r');
assert.ok(!/NaN|Infinity/.test(U.tooltip(bad.room('r'))));
assert.ok(/cost not reported/.test(U.tooltip(bad.room('r'), { scope: 'folder' })));
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

// spec 011 FR-027 (issue #21): totals saved before this run (the baseline) plus what this run records
const nums = (calls: number, aiu: number, unreported = 0): Total => ({ calls, inTokens: calls * 100, outTokens: calls * 10, nano: aiu * AIU, unreported });
const bl = U.createLedger();
assert.strictEqual(bl.since(), '', 'no baseline yet'); assert.strictEqual(bl.hasUnlisted(), false);
bl.setBaseline({ since: '2026-10-01T09:00:00.000Z', office: nums(120, 41.7), folders: [{ path: '/work/app', name: 'app', ...nums(50, 12.4) }, { path: '/work/blog', name: 'blog', ...nums(30, 8.1) }] });
assert.strictEqual(bl.since(), '2026-10-01T09:00:00.000Z');
assert.strictEqual(bl.office().calls, 120, 'before anything happens this run the office shows what was saved');
assert.strictEqual(bl.office().nano, 41.7 * AIU);
assert.strictEqual(bl.hasUnlisted(), true, '120 saved calls but only 80 in the listed folders: some folder is not listed any more');
assert.strictEqual(bl.room('r0', '/work/app').calls, 50, 'a folder shows its saved total before it has any usage this run');
assert.strictEqual(bl.room('r0').calls, 0, 'without a key only this run counts');
assert.strictEqual(bl.room('r0', '/never/seen').calls, 0);
bl.record('r0', ev(1000, 100, 0.5 * AIU)); bl.record('r0', ev(1, 1, undefined));
assert.strictEqual(bl.office().calls, 122); assert.strictEqual(bl.office().nano, 42.2 * AIU); assert.strictEqual(bl.office().unreported, 1);
assert.strictEqual(bl.officeRun().calls, 2); assert.strictEqual(bl.officeRun().nano, 0.5 * AIU, 'the run part alone, for the tooltip');
assert.strictEqual(bl.room('r0', '/work/app').calls, 52); assert.strictEqual(bl.room('r0', '/work/app').nano, 12.9 * AIU);
assert.strictEqual(bl.roomRun('r0').calls, 2);
const after = bl.office().calls;
bl.setBaseline({ since: '2026-10-01T09:00:00.000Z', office: nums(120, 41.7), folders: [{ path: '/work/app', ...nums(50, 12.4) }, { path: '/work/blog', ...nums(30, 8.1) }, { path: '/old', ...nums(40, 1) }] });
assert.strictEqual(bl.office().calls, after, 'asking for the baseline again (an agent was added) never changes the office total');
assert.strictEqual(bl.hasUnlisted(), false, 'every saved call now belongs to a listed folder');
assert.strictEqual(bl.room('r9', '/old').calls, 40, 'a folder added later gets its saved total');
// a reset: this run's figures and the baseline both go
bl.clearRun(); bl.setBaseline({ ok: true, since: '2026-10-19T09:00:00.000Z', office: nums(0, 0), folders: [] });
assert.strictEqual(bl.office().calls, 0); assert.strictEqual(bl.since(), '2026-10-19T09:00:00.000Z'); assert.strictEqual(bl.room('r0', '/work/app').calls, 0);
// hostile baselines count as zero and never throw
for (const v of [undefined, null, 5, 'x', [], {}, { office: 'x', folders: 'y' }, { office: { calls: -5, nano: NaN }, folders: [null, 3, { path: 7 }, { path: '/p', calls: 'x' }] }]) {
  const h = U.createLedger(); h.setBaseline(v);
  assert.strictEqual(h.office().calls, 0, String(JSON.stringify(v))); assert.strictEqual(h.hasUnlisted(), false);
  assert.ok(Number.isFinite(h.office().nano));
}
const half = U.createLedger(); half.setBaseline({ since: 5, office: nums(2, 1), folders: [] }); assert.strictEqual(half.since(), '', 'a since that is not text is ignored');
// the tooltip: saved since, and this run alone
const t2 = U.tooltip(nums(122, 42.2), { scope: 'office', since: '2026-10-01T09:00:00.000Z', run: nums(2, 0.5), removed: true });
assert.ok(/Saved since 2026-10-01 \(reset in Settings\); ended sessions are included\./.test(t2), t2);
assert.ok(/Since the app opened \(or the last reset\): 0\.500 AIU in 2 calls\./.test(t2), t2);
assert.ok(/Includes folders no longer shown\./.test(t2));
assert.ok(!/Since the app opened/.test(U.tooltip(nums(122, 42.2), { scope: 'office', since: '2026-10-01', run: nums(0, 0) })), 'no run line before this run recorded anything');
assert.ok(/Since Agent Durbar opened; ended sessions are included\./.test(U.tooltip(nums(3, 1), { scope: 'office' })), 'without a saved baseline the old text stays');
assert.ok(!/Saved since/.test(U.tooltip(nums(3, 1), { scope: 'office', since: 'garbage' })), 'a since that is not a date is not shown');
assert.ok(/cost not reported in 4 calls|cost not reported/.test(U.tooltip(nums(4, 0, 4), { scope: 'folder', since: '2026-10-01', run: nums(4, 0, 4) })));
// spec 033 FR-016: the office total keeps counting floors that are off; the tooltip says how much of it is from them
{
  const f = U.createLedger();
  f.record('on', ev(100, 10, 1 * AIU));
  f.record('off1', ev(100, 10, 0.5 * AIU));
  f.record('off2', ev(100, 10, 0.25 * AIU));
  const off = U.sum([f.room('off1'), f.room('off2'), f.room('missing')]);
  assert.deepStrictEqual(off, { calls: 2, inTokens: 200, outTokens: 20, nano: 0.75 * AIU, unreported: 0 });
  assert.strictEqual(U.fmtTotal(f.office()), '1.75 AIU', 'the total value is unchanged');
  const t = U.tooltip(f.office(), { scope: 'office', offFloors: off });
  assert.ok(/Includes 0\.750 AIU from floors that are off/.test(t), t);
  assert.ok(!/floors that are off/.test(U.tooltip(f.office(), { scope: 'office', offFloors: U.sum([]) })), 'no line when nothing comes from off floors');
  assert.ok(!/floors that are off/.test(U.tooltip(f.room('off1'), { scope: 'folder', offFloors: off })), 'office tooltip only');
  const g = U.createLedger();
  g.record('x', ev(1, 1, 'bad'));
  assert.ok(/1 call with cost not reported from floors that are off/.test(U.tooltip(g.office(), { scope: 'office', offFloors: g.room('x') })));
}

console.log('usagetotals tests passed');
