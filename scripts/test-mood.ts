/** How an agent is doing (spec 034 FR-001, FR-007, issue #20): `npm run test:mood`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';
type Tracker = {
  onTool: (id: string, e: unknown) => void;
  onStatus: (id: string, s: string) => void;
  onPermission: (id: string, p: unknown, ts?: unknown) => void;
  waitingMs: (id: string) => number;
  failStreak: (id: string) => number;
  errorAt: (id: string) => number;
  forget: (id: string) => void;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const M = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'mood.js')) as {
  HEAVY_PCT: number; MONSTER_PCT: number; IMPATIENT_MS: number; DIZZY_STREAK: number;
  bodyOf: (pct: unknown) => string;
  troubleOf: (o?: unknown) => string | null;
  pickAmbulance: (a: unknown) => string | null;
  roomAlertOf: (m: unknown) => { tone: string; siren: boolean };
  createMoodTracker: (o?: { now?: () => number }) => Tracker;
  phrases: (o?: unknown) => string[];
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const S = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'toolstats.js')) as { ctxLevel: (u?: number, l?: number) => { pct: number | null; level: string } };

// the body follows the context window in the same steps as the context chip
assert.strictEqual(M.bodyOf(0), 'normal'); assert.strictEqual(M.bodyOf(50), 'normal'); assert.strictEqual(M.bodyOf(69), 'normal');
assert.strictEqual(M.bodyOf(70), 'heavy', '70% is where the chip turns amber'); assert.strictEqual(M.bodyOf(89), 'heavy'); assert.strictEqual(M.bodyOf(90), 'heavy', '90% is still amber on the chip');
assert.strictEqual(M.bodyOf(91), 'monster'); assert.strictEqual(M.bodyOf(100), 'monster');
for (const bad of [null, undefined, NaN, Infinity, '80', {}, []]) assert.strictEqual(M.bodyOf(bad), 'normal', 'unknown window: ' + String(bad));
for (let used = 0; used <= 100; used++) { // never disagrees with the chip
  const lv = S.ctxLevel(used, 100).level, b = M.bodyOf(S.ctxLevel(used, 100).pct);
  assert.strictEqual(b, lv === 'high' ? 'monster' : lv === 'warn' ? 'heavy' : 'normal', 'same steps as the chip at ' + used + '%');
}
assert.strictEqual(M.bodyOf(S.ctxLevel(undefined, 100).pct), 'normal'); assert.strictEqual(M.bodyOf(S.ctxLevel(50, 0).pct), 'normal');

// trouble: one at a time, by priority
assert.strictEqual(M.troubleOf({ state: 'working' }), null);
assert.strictEqual(M.troubleOf(), null); assert.strictEqual(M.troubleOf(null), null); assert.strictEqual(M.troubleOf('x'), null);
assert.strictEqual(M.troubleOf({ state: 'error', ambulance: true }), 'ambulance');
assert.strictEqual(M.troubleOf({ state: 'error', ambulance: false }), null, 'in error but without the ambulance: today\'s error look');
assert.strictEqual(M.troubleOf({ state: 'waiting', limit: true }), 'faint');
assert.strictEqual(M.troubleOf({ state: 'waiting', waitingMs: M.IMPATIENT_MS - 1 }), null);
assert.strictEqual(M.troubleOf({ state: 'waiting', waitingMs: M.IMPATIENT_MS }), 'impatient');
assert.strictEqual(M.troubleOf({ state: 'working', failStreak: M.DIZZY_STREAK - 1 }), null);
assert.strictEqual(M.troubleOf({ state: 'working', failStreak: M.DIZZY_STREAK }), 'dizzy');
const all = { state: 'error', ambulance: true, limit: true, waitingMs: 9e9, failStreak: 9 };
assert.strictEqual(M.troubleOf(all), 'ambulance');
assert.strictEqual(M.troubleOf({ ...all, ambulance: false }), 'faint');
assert.strictEqual(M.troubleOf({ ...all, ambulance: false, limit: false }), 'impatient');
assert.strictEqual(M.troubleOf({ ...all, ambulance: false, limit: false, waitingMs: 0 }), 'dizzy');
assert.strictEqual(M.troubleOf({ state: 'error', ambulance: true, failStreak: 'x', waitingMs: 'y' }), 'ambulance');
// spec 068 FR-005: a coffee break (a usage limit, or Durbar's own cap) is calm: no trouble at all, whatever else is true; it says so in words
assert.strictEqual(M.troubleOf({ state: 'waiting', limit: true, coffee: true }), null);
assert.strictEqual(M.troubleOf({ ...all, state: 'waiting', ambulance: false, coffee: true }), null);
assert.deepStrictEqual(M.phrases({ coffee: true, trouble: null }), ['On a coffee break']);
assert.strictEqual(M.troubleOf({ state: 'working', failStreak: 'x', waitingMs: NaN }), null, 'garbage numbers are nothing');
assert.strictEqual(M.IMPATIENT_MS, 60000); assert.strictEqual(M.DIZZY_STREAK, 3);

// one ambulance: the most recent error; a tie goes to the smaller id; others are ignored
assert.strictEqual(M.pickAmbulance([]), null); assert.strictEqual(M.pickAmbulance(undefined), null); assert.strictEqual(M.pickAmbulance('x'), null);
assert.strictEqual(M.pickAmbulance([{ id: 'a', state: 'working', errorAt: 5 }, { id: 'b', state: 'idle' }]), null);
assert.strictEqual(M.pickAmbulance([{ id: 'a', state: 'error', errorAt: 100 }, { id: 'b', state: 'error', errorAt: 200 }, { id: 'c', state: 'working', errorAt: 999 }]), 'b');
assert.strictEqual(M.pickAmbulance([{ id: 'b', state: 'error', errorAt: 7 }, { id: 'a', state: 'error', errorAt: 7 }]), 'a');
assert.strictEqual(M.pickAmbulance([{ id: 'x', state: 'error' }]), 'x', 'an error without a time still gets it when it is the only one');
assert.strictEqual(M.pickAmbulance([null, { state: 'error' }, { id: 'ok', state: 'error', errorAt: NaN }]), 'ok');
// hand-over: when the newest agent leaves error, the next most recent one gets the ambulance
const agents = [{ id: 'a', state: 'error', errorAt: 100 }, { id: 'b', state: 'error', errorAt: 200 }];
assert.strictEqual(M.pickAmbulance(agents), 'b');
agents[1].state = 'working';
assert.strictEqual(M.pickAmbulance(agents), 'a', 'the ambulance moves to the remaining agent in error');

// tracker: failed-call streak (resets on a call that completes, not on one that starts)
let now = 1_000_000;
const t = M.createMoodTracker({ now: () => now });
const call = (phase: string) => ({ type: 'toolCall', phase, callId: 'c' });
t.onTool('a', call('start')); t.onTool('a', call('failed')); t.onTool('a', call('start')); t.onTool('a', call('failed'));
assert.strictEqual(t.failStreak('a'), 2, 'starts between the failures do not reset it');
t.onTool('a', call('failed')); assert.strictEqual(t.failStreak('a'), 3);
t.onTool('a', call('update')); assert.strictEqual(t.failStreak('a'), 3, 'an update changes nothing');
t.onTool('a', call('complete')); assert.strictEqual(t.failStreak('a'), 0, 'a call that works ends the streak');
t.onTool('a', call('failed')); t.onStatus('a', 'idle'); assert.strictEqual(t.failStreak('a'), 0, 'the end of the turn clears it');
t.onTool('a', call('failed')); t.onStatus('a', 'working'); assert.strictEqual(t.failStreak('a'), 1, 'working does not clear it');
t.onTool('a', call('failed')); t.onStatus('a', 'stopped'); assert.strictEqual(t.failStreak('a'), 0, 'stop clears it');
t.onTool('b', call('failed')); assert.strictEqual(t.failStreak('b'), 1); assert.strictEqual(t.failStreak('a'), 0, 'streaks are per agent');
for (const bad of [undefined, null, 5, 'x', {}, []]) t.onTool('z', bad);
t.onTool(undefined as unknown as string, call('failed')); t.onTool(null as unknown as string, call('failed'));
assert.strictEqual(t.failStreak('z'), 0); assert.strictEqual(t.failStreak('never'), 0);

// tracker: error time
assert.strictEqual(t.errorAt('a'), 0);
now += 5000; t.onStatus('a', 'error'); assert.strictEqual(t.errorAt('a'), now);
t.onStatus('a', 'working'); assert.strictEqual(t.errorAt('a'), now, 'leaving error keeps the time (the app looks at the current state)');
now += 1000; t.onStatus('a', 'error'); assert.strictEqual(t.errorAt('a'), now, 'a newer error moves it');

// tracker: waiting time from the event's timestamp when plausible, else from receipt
const w = M.createMoodTracker({ now: () => now });
assert.strictEqual(w.waitingMs('a'), 0, 'nothing pending');
w.onPermission('a', { requestId: 'r1', state: 'pending' }, now - 90_000);
assert.strictEqual(w.waitingMs('a'), 90_000, 'from the event time');
now += 10_000; assert.strictEqual(w.waitingMs('a'), 100_000);
w.onPermission('a', { requestId: 'r1', state: 'pending' }, now); assert.strictEqual(w.waitingMs('a'), 100_000, 'the same request again does not restart the wait');
w.onPermission('a', { requestId: 'r2', state: 'pending' }, now); assert.strictEqual(w.waitingMs('a'), 100_000, 'the oldest pending request counts');
w.onPermission('a', { requestId: 'r1', state: 'approved' }); assert.strictEqual(w.waitingMs('a'), 0, 'r2 just arrived: not waiting yet');
now += 61_000; assert.strictEqual(w.waitingMs('a'), 61_000); assert.strictEqual(M.troubleOf({ state: 'waiting', waitingMs: w.waitingMs('a') }), 'impatient');
w.onPermission('a', { requestId: 'r2', state: 'denied' }); assert.strictEqual(w.waitingMs('a'), 0, 'answered: nothing pending');
for (const [label, ts, expected] of [['future', now + 3_600_000, 0], ['very old', now - 3 * 86_400_000, 0], ['NaN', NaN, 0], ['text', '2026-01-01', 0], ['missing', undefined, 0]] as const) {
  const q = M.createMoodTracker({ now: () => now });
  q.onPermission('x', { requestId: 'r', state: 'pending' }, ts);
  assert.strictEqual(q.waitingMs('x'), expected, `${label} timestamp counts from receipt (0 ms so far)`);
  now += 2000; assert.strictEqual(q.waitingMs('x'), 2000, `${label}: and then grows`); now -= 2000;
}
const soon = M.createMoodTracker({ now: () => now });
soon.onPermission('x', { requestId: 'r', state: 'pending' }, now + 500); assert.strictEqual(soon.waitingMs('x'), 0, 'a timestamp a moment ahead of the clock is accepted and never negative');
// a turn that ends, an error or a stop drops what was pending
const e1 = M.createMoodTracker({ now: () => now });
for (const s of ['idle', 'stopped', 'error']) { e1.onPermission('a', { requestId: 'r', state: 'pending' }, now - 70_000); assert.ok(e1.waitingMs('a') >= 70_000); e1.onStatus('a', s); assert.strictEqual(e1.waitingMs('a'), 0, s + ' drops the pending requests'); }
e1.onPermission('a', { requestId: 'r', state: 'pending' }, now - 70_000); e1.onStatus('a', 'needs-permission'); assert.ok(e1.waitingMs('a') >= 70_000, 'needs-permission keeps them');
for (const bad of [undefined, null, 5, {}, { state: 'pending' }]) e1.onPermission('q', bad, now);
e1.onPermission(undefined as unknown as string, { requestId: 'r', state: 'pending' }, now); assert.strictEqual(e1.waitingMs('q'), 0);
e1.forget('a'); assert.strictEqual(e1.waitingMs('a'), 0); assert.strictEqual(e1.failStreak('a'), 0); assert.strictEqual(e1.errorAt('a'), 0);

// phrases (the same facts in words)
assert.deepStrictEqual(M.phrases({ body: 'monster', pct: 93 }), ['Context almost full (93%)']);
assert.deepStrictEqual(M.phrases({ body: 'heavy', pct: 75 }), [], 'only from 90% in words');
assert.deepStrictEqual(M.phrases({ body: 'normal', pct: 10 }), []);
assert.deepStrictEqual(M.phrases({ body: 'monster', pct: 95, trouble: 'ambulance' }), ['Context almost full (95%)', 'Error: please check it']);
assert.deepStrictEqual(M.phrases({ trouble: 'faint' }), ['Spending limit reached']);
assert.deepStrictEqual(M.phrases({ trouble: 'impatient', waitingMs: 125_000 }), ['Waiting 2 min for you']);
assert.deepStrictEqual(M.phrases({ trouble: 'impatient', waitingMs: 60_000 }), ['Waiting 1 min for you']);
assert.deepStrictEqual(M.phrases({ trouble: 'dizzy', failStreak: 4 }), ['4 tool calls failed in a row']);
assert.deepStrictEqual(M.phrases({ trouble: 'dizzy' }), ['3 tool calls failed in a row']);
assert.deepStrictEqual(M.phrases(), []); assert.deepStrictEqual(M.phrases({ trouble: 'unknown' }), []);

// a room takes the tone of its worst agent (spec 034 delta, issue #135)
const N = { state: 'working', body: 'normal', trouble: null };
const R = (...m: unknown[]) => M.roomAlertOf(m);
assert.deepStrictEqual(R(N, N), { tone: 'calm', siren: false }, 'all fine: as today');
assert.deepStrictEqual(R(N, { ...N, body: 'heavy' }), { tone: 'uneasy', siren: false }, 'a heavy agent: uneasy');
assert.deepStrictEqual(R({ ...N, body: 'monster' }), { tone: 'alarm', siren: false }, 'a monster: alarm, no siren');
assert.deepStrictEqual(R({ ...N, state: 'error' }), { tone: 'alarm', siren: false }, 'an agent in Error without the ambulance: alarm, no siren');
for (const t of ['impatient', 'dizzy']) assert.deepStrictEqual(R({ ...N, trouble: t }), { tone: 'alarm', siren: false }, t + ': alarm, no siren');
for (const t of ['ambulance', 'faint']) assert.deepStrictEqual(R({ ...N, trouble: t }), { tone: 'alarm', siren: true }, t + ': alarm with the siren');
assert.deepStrictEqual(R({ ...N, body: 'heavy' }, { ...N, trouble: 'dizzy' }, { ...N, body: 'heavy' }), { tone: 'alarm', siren: false }, 'the worst agent wins whatever the order');
assert.deepStrictEqual(R({ ...N, trouble: 'faint' }, { ...N, body: 'heavy' }), { tone: 'alarm', siren: true }, 'a lesser agent after the siren does not lower it');
assert.deepStrictEqual(R({ ...N, body: 'heavy' }, N), { tone: 'uneasy', siren: false });
for (const bad of [undefined, null, [], 5, 'x', {}, [null, 3, 'y', {}]]) assert.deepStrictEqual(M.roomAlertOf(bad), { tone: 'calm', siren: false }, 'garbage is calm: ' + JSON.stringify(bad));

console.log('mood tests passed');
