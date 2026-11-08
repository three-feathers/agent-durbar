/** "Needs you" outside the window and the inbox order (spec 052 FR-059, FR-061): `npm run test:attention`. No credits spent. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseBadgeCount, shouldFlash } from '../src/main/badge';
import { parseSettings } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';
import * as os from 'os';

type Item = { key: string; id: string; name: string; text: string };
type Notifier = {
  observe: (items: Item[], f: { armed?: boolean; enabled?: boolean; focused?: boolean }) => void;
  dueAt: () => number | null;
  dueIn: () => number | null;
  take: () => { title: string; body: string; id: string } | null;
};
const ROOT = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const A = require(path.join(ROOT, 'src', 'renderer', 'attention.js')) as {
  COALESCE_MS: number; THROTTLE_MS: number; BODY_MAX: number;
  titleFor: (n: unknown) => string;
  clip: (t: unknown, max?: number) => string;
  waitLabel: (ms: unknown) => string;
  sortOldestFirst: <T>(items: T[], sinceOf: (x: T) => unknown) => T[];
  createNotifier: (o?: { now?: () => number; coalesceMs?: number; throttleMs?: number }) => Notifier;
};

// the window title
assert.strictEqual(A.titleFor(0), 'Agent Durbar');
assert.strictEqual(A.titleFor(3), '(3) Agent Durbar');
assert.strictEqual(A.titleFor(1), '(1) Agent Durbar');
for (const bad of [-1, NaN, undefined, null, 'x']) assert.strictEqual(A.titleFor(bad), 'Agent Durbar', 'no count: ' + String(bad));

// the body is one line of at most 80 characters
assert.strictEqual(A.clip('Edit  src/a.ts\n(rename)'), 'Edit src/a.ts (rename)');
const long = A.clip('x'.repeat(200));
assert.strictEqual(long.length, 80); assert.ok(long.endsWith('…'));
assert.strictEqual(A.clip(null), '');

// wait labels: minutes only
assert.strictEqual(A.waitLabel(5000), 'waiting less than a minute');
assert.strictEqual(A.waitLabel(4 * 60000 + 30000), 'waiting 4 min');
assert.strictEqual(A.waitLabel(60 * 60000), 'waiting 1 h');
assert.strictEqual(A.waitLabel(75 * 60000), 'waiting 1 h 15 min');
assert.strictEqual(A.waitLabel(-1), ''); assert.strictEqual(A.waitLabel('x'), '');

// oldest first; a tie or a missing time keeps the given (office) order
const rows = [{ id: 'a', t: 300 }, { id: 'b', t: 100 }, { id: 'c', t: 300 }, { id: 'd', t: undefined }, { id: 'e', t: 200 }];
assert.deepStrictEqual(A.sortOldestFirst(rows, (r) => r.t).map((r) => r.id), ['b', 'e', 'a', 'c', 'd']);
assert.deepStrictEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd', 'e'], 'the input is not changed');

// the notifier
let t = 1000;
const now = (): number => t;
const it = (id: string, name: string, text = 'Edit src/x.ts', key = id + '|p|1'): Item => ({ key, id, name, text });
{
  const N = A.createNotifier({ now });
  // startup: what is already there is only remembered
  N.observe([it('j', 'Jonas')], { armed: false, enabled: true, focused: false });
  assert.strictEqual(N.dueAt(), null, 'nothing that existed at startup');
  N.observe([it('j', 'Jonas')], { armed: true, enabled: true, focused: false });
  assert.strictEqual(N.dueAt(), null, 'still nothing after arming');
  // a new one while in the background: due after the coalescing window
  N.observe([it('j', 'Jonas'), it('k', 'Kenji', 'Run python evals/baseline.py --compare')], { armed: true, enabled: true, focused: false });
  assert.strictEqual(N.dueAt(), 1000 + A.COALESCE_MS);
  assert.strictEqual(N.take(), null, 'not before the window ends');
  t += A.COALESCE_MS;
  assert.deepStrictEqual(N.take(), { title: 'Kenji needs you', body: 'Run python evals/baseline.py --compare', id: 'k' });
  assert.strictEqual(N.take(), null, 'shown once');
  // two more within 2 s: one notification; and the 10 s throttle
  t += 1000;
  N.observe([it('j', 'Jonas'), it('k', 'Kenji'), it('l', 'Lena')], { armed: true, enabled: true, focused: false });
  t += 500;
  N.observe([it('j', 'Jonas'), it('k', 'Kenji'), it('l', 'Lena'), it('m', 'Maya')], { armed: true, enabled: true, focused: false });
  assert.strictEqual(N.dueAt(), 3000 + A.THROTTLE_MS, 'throttled: at most one every 10 s');
  t = 3000 + A.THROTTLE_MS;
  assert.deepStrictEqual(N.take(), { title: '2 agents need you', body: 'Lena, Maya', id: 'l' });
}
{
  const N = A.createNotifier({ now });
  N.observe([], { armed: true, enabled: true, focused: false });
  N.observe([it('a', 'Ana')], { armed: true, enabled: true, focused: false });
  N.observe([], { armed: true, enabled: true, focused: false });
  assert.strictEqual(N.dueAt(), null, 'answered before it was shown: dropped');
  N.observe([it('b', 'Ben')], { armed: true, enabled: true, focused: false });
  N.observe([it('b', 'Ben')], { armed: true, enabled: true, focused: true });
  assert.strictEqual(N.dueAt(), null, 'you came back: dropped');
  N.observe([it('b', 'Ben'), it('c', 'Cy')], { armed: true, enabled: true, focused: true });
  assert.strictEqual(N.dueAt(), null, 'nothing while the window is focused');
  N.observe([it('b', 'Ben'), it('c', 'Cy'), it('d', 'Di')], { armed: true, enabled: false, focused: false });
  assert.strictEqual(N.dueAt(), null, 'nothing while turned off');
  // a new request from the same agent (another key) is new
  N.observe([it('b', 'Ben', 'Run npm test', 'b|p|2'), it('c', 'Cy'), it('d', 'Di')], { armed: true, enabled: true, focused: false });
  t += A.THROTTLE_MS;
  const n = N.take();
  assert.ok(n && n.title === 'Ben needs you' && n.body === 'Run npm test', JSON.stringify(n));
  // the same agent twice in one batch counts once
  N.observe([it('b', 'Ben', 'Run npm test', 'b|p|2'), it('b', 'Ben', 'x', 'b|q|3'), it('c', 'Cy'), it('d', 'Di')], { armed: true, enabled: true, focused: false });
  t += A.THROTTLE_MS;
  const n2 = N.take();
  assert.ok(n2 && n2.title === 'Ben needs you', JSON.stringify(n2));
}

// the badge count from the renderer is not trusted
assert.strictEqual(parseBadgeCount(0), 0); assert.strictEqual(parseBadgeCount(3), 3); assert.strictEqual(parseBadgeCount(999), 999);
for (const bad of [-1, 1000, 1.5, NaN, Infinity, '3', null, undefined, {}, []]) assert.strictEqual(parseBadgeCount(bad), null, 'refused: ' + String(bad));
assert.ok(shouldFlash(1, 2, false, 'win32'));
assert.ok(!shouldFlash(1, 2, true, 'win32'), 'not while focused');
assert.ok(!shouldFlash(2, 1, false, 'win32'), 'not when it shrinks');
assert.ok(!shouldFlash(1, 2, false, 'darwin') && !shouldFlash(1, 2, false, 'linux'), 'a badge count there');

// the setting: on by default, only false is written
assert.deepStrictEqual(parseSettings('{"notifyNeedsMe":false}'), { notifyNeedsMe: false });
for (const v of ['true', '"false"', '0', 'null']) assert.deepStrictEqual(parseSettings('{"notifyNeedsMe":' + v + '}'), {}, 'only false is kept: ' + v);
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-attention-'));
  const f = path.join(dir, 's.json');
  const ss = new SettingsStore(f);
  ss.load();
  assert.strictEqual(ss.notifyNeedsMe, true, 'on by default');
  for (const junk of ['no', 0, null, undefined, {}]) assert.strictEqual(ss.setNotifyNeedsMe(junk).value, true, 'only a boolean changes it: ' + String(junk));
  assert.strictEqual(ss.setNotifyNeedsMe(false).value, false);
  const back = new SettingsStore(f); back.load();
  assert.strictEqual(back.notifyNeedsMe, false, 'kept after a restart');
  assert.strictEqual(back.setNotifyNeedsMe(true).value, true);
  assert.ok(!('notifyNeedsMe' in JSON.parse(fs.readFileSync(f, 'utf8'))), 'on is not written');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- spec 052 FR-193 / FR-205 (T196): createArrivals(), what is new for Your door ----
type ArrItem = { key: string; id: string; kind: string; card?: boolean };
type Arrivals = { observe: (items: ArrItem[], f: { armed?: boolean; isPaused?: (id: string) => boolean }) => { fresh: ArrItem[]; startup: boolean; flips: string[][] } };
type Gate = {
  arrive: (n: number) => void; startup: () => void; dismissed: () => void;
  ruling: (s: { open: boolean; held: boolean; waiting?: number; any?: number }) => 'open' | 'startup' | 'hold' | 'none';
  waitMs: () => number;
  isPending: () => boolean;
};
const AA = A as unknown as {
  createArrivals: (o?: { now?: () => number; throttleMs?: number }) => Arrivals;
  createDoorGate: (o?: { now?: () => number; coalesceMs?: number; throttleMs?: number }) => Gate;
};
{
  let t = 1000; const now = () => t;
  const mk = () => AA.createArrivals({ now });
  const cardOf = (id: string, rq: string): ArrItem => ({ key: 'r:' + rq, id, kind: 'p', card: true });
  const plain = (id: string, kind: string): ArrItem => ({ key: id + '|' + kind, id, kind });
  const keys = (r: { fresh: ArrItem[] }): string => r.fresh.map((x) => x.key).join(',');
  const on = { armed: true };
  // before arming nothing is new, but it is remembered
  let r = mk(); let x = r.observe([cardOf('a', '1')], { armed: false });
  assert.strictEqual(keys(x), '', 'before arming nothing is new');
  assert.strictEqual(keys(r.observe([cardOf('a', '1')], on)), '', 'remembered from before arming');
  // app start (Q-NY-3): the first armed look with anything waiting says startup, once
  r = mk(); r.observe([cardOf('a', '1')], { armed: false });
  x = r.observe([cardOf('a', '1')], on); assert.strictEqual(x.startup, true, 'something waits when arming turns on: startup');
  assert.strictEqual(r.observe([cardOf('a', '1')], on).startup, false, 'startup is said once');
  r = mk(); r.observe([], { armed: false }); assert.strictEqual(r.observe([], on).startup, false, 'nothing waits at arming: no startup');
  // first sight is new, the same key again is not, a repaint with the same items is not
  r = mk(); r.observe([], on);
  assert.strictEqual(keys(r.observe([cardOf('a', '1')], on)), 'r:1', 'first sight is new');
  assert.strictEqual(keys(r.observe([cardOf('a', '1')], on)), '', 'the same key again is not');
  // a second card on a waiting agent is new (all cards are counted, not only the oldest)
  assert.strictEqual(keys(r.observe([cardOf('a', '1'), cardOf('a', '2')], on)), 'r:2', 'a second card on a waiting agent is new');
  // the demo flip: the same agent and kind gaining its card is not new
  r = mk(); r.observe([], on);
  assert.strictEqual(keys(r.observe([plain('d', 'p')], on)), 'd|p', 'a card-less ask is new');
  assert.strictEqual(keys(r.observe([cardOf('d', '9')], on)), '', 'the demo chat being built is not new');
  // a card is dropped once settled: the same request id cannot come back, a new one is new
  r = mk(); r.observe([], on); r.observe([cardOf('a', '1')], on); r.observe([], on);
  assert.strictEqual(keys(r.observe([cardOf('a', '2')], on)), 'r:2', 'after settling, a new card is new');
  // pause: the agent leaves the list but is remembered; unpausing shows the same card, which is not new; a card first seen then is
  r = mk(); r.observe([], on); r.observe([cardOf('a', '1')], on);
  const paused = { armed: true, isPaused: (id: string) => id === 'a' };
  r.observe([], paused);
  assert.strictEqual(keys(r.observe([cardOf('a', '1')], on)), '', 'a card through pause and unpause is not new');
  r.observe([], paused);
  assert.strictEqual(keys(r.observe([cardOf('a', '1'), cardOf('a', '3')], on)), 'r:3', 'a card first seen on unpausing is new');
  // an error that repeats while the agent retries gives one open within THROTTLE_MS
  r = mk(); r.observe([], on); t = 5000;
  assert.strictEqual(keys(r.observe([plain('e', 'e')], on)), 'e|e', 'an error is new');
  r.observe([], on); t += A.THROTTLE_MS - 1;
  assert.strictEqual(keys(r.observe([plain('e', 'e')], on)), '', 'the same error again within THROTTLE_MS is not');
  r.observe([], on); t += A.THROTTLE_MS + 1;
  assert.strictEqual(keys(r.observe([], on)), ''); // out of error for a full THROTTLE_MS: forgotten
  assert.strictEqual(keys(r.observe([plain('e', 'e')], on)), 'e|e', 'after a full THROTTLE_MS out of error it is new again');
  // a plain wait is forgotten at once when the agent leaves that state
  r = mk(); r.observe([], on); r.observe([plain('w', 'w')], on); r.observe([], on);
  assert.strictEqual(keys(r.observe([plain('w', 'w')], on)), 'w|w', 'a plain wait that left and came back is new');
  // a settled card is forgotten: the same key coming back is new (the map does not grow without limit)
  r = mk(); r.observe([], on);
  assert.strictEqual(keys(r.observe([cardOf('s', 'r-settle')], on)), 'r:r-settle');
  assert.strictEqual(keys(r.observe([cardOf('s', 'r-settle')], on)), '', 'a card still waiting is not new again');
  r.observe([], on);
  assert.strictEqual(keys(r.observe([cardOf('s', 'r-settle')], on)), 'r:r-settle', 'a settled card that came back is new (settled cards are forgotten)');
  // a burst: all fresh keys in one look (the app opens once)
  r = mk(); r.observe([], on);
  assert.strictEqual(r.observe(Array.from({ length: 15 }, (_, i) => cardOf('a' + i, 'b' + i)), on).fresh.length, 15, 'a burst is one look with 15 fresh');
  // the injected clock is really used
  let calls = 0; const rc = AA.createArrivals({ now: () => { calls++; return t; } }); rc.observe([plain('e', 'e')], on); rc.observe([], on);
  assert.ok(calls > 0, 'the injected clock is read');
  // junk items are skipped
  r = mk(); r.observe([], on);
  assert.strictEqual(r.observe([null, {}, { key: 'k' }] as unknown as ArrItem[], on).fresh.length, 0, 'junk items are skipped');

  // the gate: when the panel opens by itself
  t = 100000; const g = AA.createDoorGate({ now });
  assert.strictEqual(g.ruling({ open: false, held: false }), 'none', 'nothing arrived: nothing opens');
  g.arrive(3); assert.strictEqual(g.ruling({ open: false, held: false }), 'open', 'a burst opens once');
  assert.strictEqual(g.ruling({ open: false, held: false }), 'none', 'and only once');
  g.arrive(1); t += 100; assert.strictEqual(g.ruling({ open: true, held: false }), 'none', 'already open: no second slide');
  t += A.THROTTLE_MS + 1; g.arrive(1); assert.strictEqual(g.ruling({ open: false, held: true }), 'hold', 'a held opening stays held');
  assert.strictEqual(g.ruling({ open: false, held: false }), 'open', 'and opens once when the guard clears');
  t += A.THROTTLE_MS + 1; g.dismissed(); t += 100; g.arrive(1);
  assert.strictEqual(g.ruling({ open: false, held: false }), 'none', 'a new request within COALESCE_MS of a dismissal does not snap it back');
  t += A.COALESCE_MS + 1; g.arrive(1);
  assert.strictEqual(g.ruling({ open: false, held: false }), 'open', 'after the coalescing window a new request reopens it');
  t += 100; g.arrive(1);
  assert.strictEqual(g.ruling({ open: false, held: false }), 'none', 'but not twice within THROTTLE_MS of the last opening');
  t += A.THROTTLE_MS + 1; g.arrive(1);
  assert.strictEqual(g.ruling({ open: false, held: false }), 'open', 'after the throttle a new request reopens it');
  g.startup(); assert.strictEqual(g.ruling({ open: false, held: false }), 'startup', 'app start opens with Later');
  assert.strictEqual(g.ruling({ open: false, held: false }), 'none');
  g.startup(); assert.strictEqual(g.ruling({ open: false, held: true }), 'hold', 'app start is held like any opening');
  assert.strictEqual(g.ruling({ open: false, held: false }), 'startup', 'and still says startup when it opens');
  // a held opening is not lost to the throttle (FR-202, FR-194): it is kept and opens once, at the next look after the throttle ends, for everything held
  t += A.THROTTLE_MS + 1; g.arrive(1); assert.strictEqual(g.ruling({ open: false, held: false }), 'open');
  t += 100; g.arrive(1); assert.strictEqual(g.ruling({ open: false, held: true }), 'hold', 'held again right after an opening');
  t += 100; g.arrive(2); assert.strictEqual(g.ruling({ open: false, held: false }), 'none', 'released inside THROTTLE_MS: not yet');
  assert.ok(g.waitMs() > 0 && g.waitMs() <= A.THROTTLE_MS, 'and it says how long to wait');
  t += A.THROTTLE_MS + 1; assert.strictEqual(g.waitMs(), 0, 'nothing to wait for once the throttle has run out');
  assert.strictEqual(g.ruling({ open: false, held: false }), 'open', 'the held opening is kept through the throttle and opens at the next look');
  assert.strictEqual(g.ruling({ open: false, held: false }), 'none', 'once, for everything held');
  assert.strictEqual(g.waitMs(), 0, 'and nothing is left to wait for');
  // asks answered elsewhere before the opening open nothing (round 6): the throttle ends with nothing waiting
  t += A.THROTTLE_MS + 1; g.arrive(1); assert.strictEqual(g.ruling({ open: false, held: false, waiting: 1, any: 1 }), 'open');
  t += 200; g.arrive(1); assert.strictEqual(g.ruling({ open: false, held: false, waiting: 1, any: 2 }), 'none', 'throttled, kept');
  assert.strictEqual(g.isPending(), true);
  t += A.THROTTLE_MS + 1; assert.strictEqual(g.ruling({ open: false, held: false, waiting: 0, any: 1 }), 'none', 'the new ask was answered elsewhere: nothing to open for');
  assert.strictEqual(g.isPending(), false, 'and nothing is kept');
  t += A.THROTTLE_MS + 1; assert.strictEqual(g.ruling({ open: false, held: false, waiting: 0, any: 1 }), 'none');
  g.startup(); assert.strictEqual(g.ruling({ open: false, held: false, any: 0 }), 'none', 'app start with nobody waiting any more opens nothing');
  // a request within COALESCE_MS of a dismissal is dropped, not kept for later (round 6)
  t += A.THROTTLE_MS + 1; g.dismissed(); t += 100; g.arrive(1);
  assert.strictEqual(g.ruling({ open: false, held: false, waiting: 1, any: 1 }), 'none', 'right after a dismissal: not opened');
  assert.strictEqual(g.isPending(), false, 'and not kept for later');
  t += A.COALESCE_MS + A.THROTTLE_MS + 1; assert.strictEqual(g.ruling({ open: false, held: false, waiting: 1, any: 1 }), 'none', 'past both windows nothing comes back');
  // requests that arrive while the panel is open are seen there: a later close that is not a dismissal does not reopen it for them
  t += A.THROTTLE_MS + 1; g.arrive(2);
  assert.strictEqual(g.ruling({ open: true, held: false }), 'none', 'open: the arrivals are seen');
  assert.strictEqual(g.ruling({ open: false, held: false }), 'none', 'pending is cleared while the panel is open: a close that is not a dismissal does not reopen it');
  g.startup(); assert.strictEqual(g.ruling({ open: true, held: false }), 'none', 'open: the app-start opening is seen too');
  assert.strictEqual(g.ruling({ open: false, held: false }), 'none', 'the app-start flag is cleared while the panel is open');
}

// the default clock never goes back (round 6): a wall-clock jump back must not stop automatic openings
{
  const AAx = AA as unknown as { createDoorGate: (o?: object) => { arrive: (n: number) => void; ruling: (s: { open: boolean; held: boolean }) => string } };
  const realNow = Date.now; const realPerf = performance.now.bind(performance);
  let wall = 1_700_000_000_000, mono = 5000;
  Date.now = () => wall; (performance as unknown as { now: () => number }).now = () => mono;
  try {
    const g2 = AAx.createDoorGate();
    g2.arrive(1); assert.strictEqual(g2.ruling({ open: false, held: false }), 'open', 'first opening');
    mono += A.THROTTLE_MS + 5; wall -= 3_600_000; // time passes; the wall clock is set back an hour
    g2.arrive(1); assert.strictEqual(g2.ruling({ open: false, held: false }), 'open', 'after the throttle a new ask opens it even though the wall clock went back');
  } finally { Date.now = realNow; (performance as unknown as { now: () => number }).now = realPerf; }
}

// the page's scheduling of the next look at a pending notification (round 7): the delay comes from the notifier's own clock, never wall minus monotonic
{
  const S = (A as unknown as { scheduleDue: (n: Notifier, set: (f: () => void, ms: number) => number, fire: () => void) => number }).scheduleDue;
  // the real default clock, a fake setTimeout: a pending notification is scheduled once, after a positive delay of at most THROTTLE_MS
  // the monotonic clock is set well ahead first: in a fresh process it is only a few hundred ms, where an absolute due time would also look like a small delay
  const realPerf2 = performance.now.bind(performance);
  (performance as unknown as { now: () => number }).now = () => 1e7;
  const Nd = A.createNotifier();
  const delays: number[] = [];
  const fake = (_f: () => void, ms: number): number => { delays.push(ms); return delays.length; };
  assert.strictEqual(S(Nd, fake, () => undefined), 0, 'nothing pending: nothing scheduled');
  assert.strictEqual(delays.length, 0);
  Nd.observe([], { armed: true, enabled: true, focused: false });
  Nd.observe([it('z', 'Zed', 'x', 'z|p|1')], { armed: true, enabled: true, focused: false });
  assert.ok(S(Nd, fake, () => undefined) > 0, 'a pending notification is scheduled');
  assert.strictEqual(delays.length, 1, 'once');
  assert.ok(delays[0] > 0 && delays[0] <= A.THROTTLE_MS, `the delay is positive and at most THROTTLE_MS, not 0 and not a mixed-clock number (got ${delays[0]})`);
  (performance as unknown as { now: () => number }).now = realPerf2;
  // no 0 ms loop: with a fake clock that the timers advance, the page's fire-and-reschedule reaches the notification in a few steps
  let tt = 50_000; const Nf = A.createNotifier({ now: () => tt });
  Nf.observe([], { armed: true, enabled: true, focused: false }); Nf.observe([it('y', 'Why', 'x', 'y|p|1')], { armed: true, enabled: true, focused: false });
  let calls = 0, shown = false;
  const run = (): void => { const id = S(Nf, (f, ms) => { calls++; tt += ms; setImmediate(() => 0); f(); return 1; }, () => { if (Nf.take()) shown = true; else if (calls < 20) run(); }); void id; };
  run();
  assert.ok(shown && calls <= 3, `the notification is reached in a few timer steps, not a busy loop (${calls} timer calls)`);
  // the page uses it
  const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
  assert.ok(/ATT\.scheduleDue\(NOTIFIER,setTimeout/.test(appSrc), 'app.js schedules through ATT.scheduleDue');
  assert.ok(!/due-Date\.now\(\)/.test(appSrc), 'app.js never subtracts Date.now() from a notifier time');
}

// a card-less ask that gains its card is reported as a flip, so the page carries it (round 7)
{
  const ar = AA.createArrivals({ now: () => 1000 });
  const plainW: ArrItem = { key: 'a|w', id: 'a', kind: 'w' };
  ar.observe([], { armed: true });
  assert.strictEqual(ar.observe([plainW], { armed: true }).fresh.length, 1, 'a card-less wait is new');
  const o = ar.observe([{ key: 'r:9', id: 'a', kind: 'p', card: true }], { armed: true });
  assert.strictEqual(o.fresh.length, 0, 'gaining its card is not new');
  assert.deepStrictEqual(o.flips, [['a|w', 'r:9']], 'but it is reported as the same ask under a new key');
}

// wiring: the page loads the helper and the build copies it
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
assert.ok(html.indexOf('src="attention.js"') > 0 && html.indexOf('src="attention.js"') < html.indexOf('src="app.js"'), 'index.html loads attention.js before app.js');
assert.ok(/'attention\.js'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8')), 'copy-assets.js copies attention.js');

console.log('attention tests passed');
