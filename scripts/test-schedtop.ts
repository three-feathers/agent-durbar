/** The top-bar Schedules button's facts (spec 044 FR-027..FR-029, FR-033): the count, the "did not run" mark, the texts. `npm run test:schedtop`. No credits spent. */
import assert from 'assert';
import path from 'path';

type Sched = { id: string; folder: string; prompt: string; every?: number; at?: number; rule?: { kind: string; time: string }; next?: number; paused?: boolean; done?: boolean; last?: { at: number; outcome: string } };
type Doc = { pausedAll: boolean; schedules: Sched[] };
type Text = { count: number; paused: boolean; trouble: number; label: string; title: string };
const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'schedtop.js')) as {
  activeCount(d: Doc): number;
  troubleSince(d: Doc, seenAt: number | null | undefined, now: number): number;
  missedOrFailed(s: unknown): boolean;
  topText(d: Doc, seenAt: number | null | undefined, now: number, o?: { keys?: string; clockOf?: (ms: number) => string }): Text;
};

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0), H = 3600000;
const clockOf = (ms: number): string => 'T' + Math.round((ms - NOW) / H); // locale-free
const s = (id: string, o: Partial<Sched> = {}): Sched => ({ id, folder: '/f', prompt: 'p', every: 30, next: NOW + H, ...o });
const doc = (schedules: Sched[], pausedAll = false): Doc => ({ pausedAll, schedules });

// the count: not done and not paused; Pause all does not change it
assert.strictEqual(T.activeCount(doc([])), 0);
assert.strictEqual(T.activeCount(doc([s('a'), s('b', { paused: true }), s('c', { done: true }), s('d', { at: NOW + H, every: undefined })])), 2);
assert.strictEqual(T.activeCount(doc([s('a'), s('b')], true)), 2);
assert.strictEqual(T.activeCount(undefined as unknown as Doc), 0);
assert.strictEqual(T.activeCount({ pausedAll: false } as unknown as Doc), 0);

// the mark: missed and failed runs newer than the stamp
const miss = (id: string, outcome: string, ago: number, o: Partial<Sched> = {}): Sched => s(id, { last: { at: NOW - ago, outcome }, ...o });
assert.strictEqual(T.troubleSince(doc([miss('a', 'missed', 1 * H)]), NOW - 2 * H, NOW), 1);
assert.strictEqual(T.troubleSince(doc([miss('a', 'failed', 1 * H)]), NOW - 2 * H, NOW), 1);
assert.strictEqual(T.troubleSince(doc([miss('a', 'failed', 3 * H)]), NOW - 2 * H, NOW), 0, 'older than the stamp');
assert.strictEqual(T.troubleSince(doc([miss('a', 'missed', 2 * H)]), NOW - 2 * H, NOW), 0, 'not newer than the stamp');
assert.strictEqual(T.troubleSince(doc([miss('a', 'missed', 1 * H), miss('b', 'failed', 1 * H), miss('c', 'missed', 9 * H)]), NOW - 2 * H, NOW), 2);
// a done one-time schedule that missed still counts; a paused one too
assert.strictEqual(T.troubleSince(doc([miss('a', 'missed', 1 * H, { done: true, every: undefined, at: NOW - H })]), NOW - 2 * H, NOW), 1);
assert.strictEqual(T.troubleSince(doc([miss('a', 'missed', 1 * H, { paused: true })]), NOW - 2 * H, NOW), 1);
// the expected outcomes never mark it
for (const o of ['sent', 'skipped-busy', 'skipped-paused', 'skipped-cap', 'skipped-ended']) assert.strictEqual(T.troubleSince(doc([miss('a', o, H / 2)]), NOW - 2 * H, NOW), 0, o);
assert.strictEqual(T.troubleSince(doc([s('a')]), NOW - 2 * H, NOW), 0, 'no last run');
// no stamp: the last 24 hours only
for (const none of [undefined, null, 0, NaN, -5]) {
  assert.strictEqual(T.troubleSince(doc([miss('a', 'missed', 23 * H), miss('b', 'failed', 25 * H)]), none, NOW), 1, String(none));
}
// a later run replaces `last`: the mark clears by itself
assert.strictEqual(T.troubleSince(doc([s('a', { last: { at: NOW, outcome: 'sent' } })]), null, NOW), 0);

// the texts
const keysWin = 'Ctrl+Shift+S', keysMac = '⇧⌘S';
const o = { keys: keysWin, clockOf };
let t = T.topText(doc([s('a'), s('b', { next: NOW + 3 * H })]), NOW - H, NOW, o);
assert.deepStrictEqual([t.count, t.paused, t.trouble], [2, false, 0]);
assert.strictEqual(t.title, 'Schedules: 2 active, next T1 (Ctrl+Shift+S)');
assert.strictEqual(t.label, 'Schedules: 2 active, next at T1.');
t = T.topText(doc([s('a'), miss('b', 'missed', H / 2)]), NOW - H, NOW, o);
assert.strictEqual(t.trouble, 1);
assert.strictEqual(t.label, 'Schedules: 2 active, next at T1. 1 schedule missed or failed a run.');
assert.strictEqual(t.title, 'Schedules: 2 active, next T1. 1 schedule missed or failed a run (Ctrl+Shift+S)');
t = T.topText(doc([miss('a', 'missed', H / 2), miss('b', 'failed', H / 2)]), NOW - H, NOW, o);
assert.ok(t.label.includes('2 schedules missed or failed a run'));
// Pause all: the number stays, the words say it, no "next"
t = T.topText(doc([s('a'), s('b')], true), null, NOW, o);
assert.deepStrictEqual([t.count, t.paused], [2, true]);
assert.strictEqual(t.label, 'Schedules: all paused, 2 set.');
assert.strictEqual(t.title, 'Schedules: all paused (2 set) (Ctrl+Shift+S)');
// Pause all with nothing to run is just "none"
t = T.topText(doc([], true), null, NOW, o);
assert.strictEqual(t.paused, false);
assert.strictEqual(t.title, 'Schedules: none yet. Add one to a folder (Ctrl+Shift+S)');
assert.strictEqual(t.label, 'Schedules: none yet.');
assert.strictEqual(t.count, 0);
// schedules exist but none is active
t = T.topText(doc([s('a', { paused: true }), s('b', { done: true })]), null, NOW, o);
assert.strictEqual(t.count, 0);
assert.strictEqual(t.label, 'Schedules: none active, 2 set.');
// a Mac shows its own keys
t = T.topText(doc([s('a')]), null, NOW, { keys: keysMac, clockOf });
assert.ok(t.title.endsWith('(⇧⌘S)'), t.title);
// no keys, no clock function
t = T.topText(doc([s('a')]), null, NOW);
assert.ok(!t.title.includes('()'), t.title);
// 50 schedules (the store's limit), all with trouble and a long clock text: at most 120 characters
const many = Array.from({ length: 50 }, (_, i) => miss('m' + i, i % 2 ? 'missed' : 'failed', H / 2));
t = T.topText(doc(many), null, NOW, { keys: keysMac, clockOf: () => 'Wednesday, 22 October 2026 at 12:00:00 Central European Summer Time' });
assert.ok(t.title.length <= 120 && t.label.length <= 120, `${t.title.length}/${t.label.length}`);
assert.ok(t.count <= 99 && t.trouble === 50);
t = T.topText(doc(many.map((x) => ({ ...x, last: undefined }))), null, NOW, { keys: keysWin, clockOf: () => 'x'.repeat(200) });
assert.ok(t.title.length <= 120 && t.label.length <= 120, `${t.title.length}/${t.label.length}`);

// no next time when nothing has one (an active schedule without `next`/`at`)
t = T.topText(doc([s('a', { next: undefined })]), null, NOW, o);
assert.strictEqual(t.title, 'Schedules: 1 active (Ctrl+Shift+S)');
assert.strictEqual(t.label, 'Schedules: 1 active.');
// nextAt must skip a paused or done schedule that is due sooner than the active one
t = T.topText(doc([s('p', { paused: true, next: NOW + H }), s('d', { done: true, every: undefined, at: NOW + H }), s('a', { next: NOW + 5 * H })]), null, NOW, o);
assert.strictEqual(t.title, 'Schedules: 1 active, next T5 (Ctrl+Shift+S)');
// a stamp from the future is clamped to now: a run since "now" is not hidden by it
assert.strictEqual(T.troubleSince(doc([miss('a', 'missed', H)]), NOW + 10 * H, NOW), 0, 'older than now');
assert.strictEqual(T.troubleSince(doc([{ ...s('a'), last: { at: NOW + 1, outcome: 'failed' } }]), NOW + 10 * H, NOW), 1, 'newer than now');
// null, non-object and missing entries cannot throw
const junk = { pausedAll: false, schedules: [null, undefined, 5, 'x', s('a')] } as unknown as Doc;
assert.strictEqual(T.activeCount(junk), 1);
assert.strictEqual(T.troubleSince(junk, null, NOW), 0);
assert.strictEqual(T.topText(junk, null, NOW, o).count, 1);
// the words count schedules: one schedule that failed three times is still 1 schedule, not "3 runs"
t = T.topText(doc([miss('a', 'failed', H / 2)]), NOW - H, NOW, o);
assert.ok(t.label.endsWith('1 schedule missed or failed a run.') && !/runs/.test(t.label), t.label);
// the shared rule (also used by the lobby Postbox): done one-time schedules count, a done recurring one does not, skipped-* never
assert.strictEqual(T.missedOrFailed(miss('a', 'missed', H, { done: true, every: undefined, at: NOW - H })), true);
assert.strictEqual(T.missedOrFailed(miss('a', 'failed', H, { done: true })), false, 'done and recurring');
assert.strictEqual(T.missedOrFailed(miss('a', 'skipped-busy', H)), false);
assert.strictEqual(T.missedOrFailed(null), false);
assert.strictEqual(T.missedOrFailed(s('a')), false);
// a failure that happens while the Schedules section is on screen: the app stamps "now" first, so it raises nothing
assert.strictEqual(T.troubleSince(doc([{ ...s('a'), last: { at: NOW - 5, outcome: 'failed' } }]), NOW, NOW), 0);
assert.strictEqual(T.troubleSince(doc([{ ...s('a'), last: { at: NOW + 5, outcome: 'failed' } }]), NOW, NOW + 10), 1, 'a later failure, not seen, raises it');
console.log('test-schedtop: ok');
