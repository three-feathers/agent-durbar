/** Self-paced loops (spec 072, Phase 1 core): the pace line parser and the scheduler's loop rules with a fake clock and sender. `npm run test:loops`. No session, no credits. */
import * as assert from 'assert';
import { LOOP_DEFAULTS, clampPace, cleanReason, loopFooter, parsePace } from '../src/shared/looppace';
import { Scheduler, loopSupport, parseSchedules, saveSchedules } from '../src/main/schedules';
import { MODE_DEPS, modeful, withModes } from './test-schedules';
import type { LoopWait, Schedule, SchedulesDoc } from '../src/main/schedules';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MIN = 60_000;
const T0 = 1_000_000_000_000;

function harness(doc: SchedulesDoc = { pausedAll: false, schedules: [] }) {
  let now = T0;
  const sent: string[] = [];
  const busy = new Set<string>();
  const sessions = new Set<string>(['s1', 's2']);
  const wait: { v: LoopWait | undefined } = { v: undefined };
  const failSend = { v: false };
  const onSend: { fn?: () => void } = {};
  /** When set, `send` waits for it (so a test can act while a send is in flight), then fails or not by `failSend`. */
  const gate: { p?: Promise<void> } = {};
  /** Wall-clock jumps the monotonic clock does not see. */
  const skew = { v: 0 };
  const timers: { at: number; fn: () => void }[] = [];
  const sch = modeful(new Scheduler(withModes(doc), {
    ...MODE_DEPS,
    now: () => now,
    isBusy: (_f, session) => busy.has(session ?? ''),
    hasSession: (id) => sessions.has(id),
    capUnitOf: () => 'aiu',
    waitOf: () => wait.v,
    mono: () => now - skew.v,
    send: async (f, p, s) => {
      sent.push(p);
      onSend.fn?.();
      if (gate.p) await gate.p;
      return failSend.v ? false : s.target ? s.target.session : 'x';
    },
    setTimer: (ms, fn) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t as never); if (i >= 0) timers.splice(i, 1); },
    save: () => undefined,
  }));
  const advance = async (ms: number): Promise<void> => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
      await new Promise((r) => setImmediate(r));
    }
  };
  /** Starts a loop on s1 and runs its first pass. */
  const loop = async (over: Record<string, unknown> = {}, lim: Record<string, unknown> = {}): Promise<Schedule> => {
    const r = sch.save({ folder: '/w', prompt: 'check CI', target: { session: 's1', agent: 'copilot' }, cap: { amount: 50, unit: 'aiu' }, loop: { minDelay: 5, maxDelay: 60, defaultDelay: 30, maxPasses: 12, endAt: now + 8 * 60 * MIN, ...lim }, ...over }, () => true);
    assert.ok(r.ok, JSON.stringify(r));
    await advance(0);
    return sch.doc.schedules.find((x) => x.id === (r as { schedule: Schedule }).schedule.id) as Schedule;
  };
  return { sch, sent, busy, sessions, wait, failSend, onSend, gate, skew, advance, loop, get now() { return now; } };
}

async function main(): Promise<void> {
  loopSupport.enabled = true;
  // --- the pace line (T001) ---
  assert.deepStrictEqual(parsePace('did it\nLOOP: next 25 min - waiting for CI'), { kind: 'next', minutes: 25, reason: 'waiting for CI' });
  assert.deepStrictEqual(parsePace('LOOP: next 25 minutes'), { kind: 'next', minutes: 25 });
  assert.deepStrictEqual(parsePace('loop: NEXT 2 H - later\n\n  \n'), { kind: 'next', minutes: 120, reason: 'later' }, 'case-insensitive, trailing blank lines, hours');
  assert.deepStrictEqual(parsePace('LOOP: next 1 hour'), { kind: 'next', minutes: 60 });
  assert.deepStrictEqual(parsePace('LOOP: next 10 min – dash'), { kind: 'next', minutes: 10, reason: 'dash' });
  assert.deepStrictEqual(parsePace('LOOP: stop - all merged'), { kind: 'stop', reason: 'all merged' });
  assert.deepStrictEqual(parsePace('LOOP: stop'), { kind: 'stop' });
  assert.deepStrictEqual(parsePace('LOOP: next 0 min'), { kind: 'next', minutes: 0 }, 'the parser reports the ask; clamping is separate');
  for (const no of ['', 'LOOP: next', 'LOOP: next min', 'LOOP: next 5', 'LOOP: next -5 min', 'LOOP: next 5 days', 'LOOP: next 1.5 h', 'LOOP: stopping', 'LOOP: stop now', 'LOOP:next5min!', 'x LOOP: stop', 'LOOP: next 1234567 min', 'LOOP: next 5 min reason']) {
    assert.strictEqual(parsePace(no), undefined, JSON.stringify(no));
  }
  // markdown wrapping and a trailing full stop (7c)
  for (const w of ['**LOOP: next 25 min - CI.**', '*LOOP: next 25 min - CI*.', '`LOOP: next 25 min - CI`', '**LOOP: next 25 min - CI**.', 'LOOP: next 25 min - CI.']) {
    assert.deepStrictEqual(parsePace('text\n' + w), { kind: 'next', minutes: 25, reason: 'CI' }, w);
  }
  assert.deepStrictEqual(parsePace('`LOOP: stop`.'), { kind: 'stop' });
  assert.strictEqual(parsePace('**LOOP: next 25 min - CI'), undefined, 'unbalanced wrapping is no line');
  assert.strictEqual(parsePace('**' + 'x'.repeat(200) + '**'), undefined);
  assert.strictEqual(parsePace('**LOOP: stop - ' + 'x'.repeat(190) + '**'), undefined, 'the 200 character cap counts the wrapping');
  assert.strictEqual(parsePace('LOOP: stop - all merged\nthanks'), undefined, 'last line only');
  assert.strictEqual(parsePace('LOOP: next 5 min - ' + 'x'.repeat(200)), undefined, 'a line over 200 characters is no line');
  assert.strictEqual(parsePace(undefined), undefined);
  assert.strictEqual(parsePace({ a: 1 }), undefined);
  // hostile input: control, bidi and zero-width characters, secrets, huge text, linear time
  const hostile = parsePace('LOOP: stop - a‮b​c\u0000d\u001b[31m token ghp_' + 'A'.repeat(36));
  assert.ok(hostile?.kind === 'stop' && !/[\u0000-\u001f​‮]/.test(hostile.reason ?? '') && !(hostile.reason ?? '').includes('ghp_AAAA'), String(hostile && (hostile as { reason?: string }).reason));
  assert.strictEqual(cleanReason('x'.repeat(500))?.length, 120);
  // zero-width and bidi characters are removed, not replaced by a space, so they cannot split a secret past redact
  const tok = 'ghp_' + 'A'.repeat(36);
  for (const inv of ['\u200b', '\u202e', '\u2060', '\ufeff', '\u061c']) {
    const r = cleanReason('see ' + tok.slice(0, 10) + inv + tok.slice(10));
    assert.ok(r && !r.includes('AAAA') && !r.includes(inv), JSON.stringify(r));
  }
  assert.strictEqual(cleanReason('a\u200bb'), 'ab');
  assert.strictEqual(cleanReason('a\u2028b\u0085c'), 'a b c');
  // a long run of spaces does not push a secret past the cut
  const far = cleanReason(' '.repeat(985) + tok);
  assert.ok(far && !far.includes('AAAA'), String(far));
  const far2 = cleanReason('x ' + ' '.repeat(1500) + tok);
  assert.ok(far2 && !far2.includes('AAAA'), String(far2));
  assert.strictEqual(cleanReason('a\nb\tc'), 'a b c');
  assert.strictEqual(cleanReason('​‮ '), undefined);
  assert.strictEqual(cleanReason(42), undefined);
  for (const text of ['LOOP: next ' + ' '.repeat(5_000_000) + '5 min', 'x'.repeat(5_000_000), ('LOOP: next 5 min -' + ' -'.repeat(100_000) + 'x\n').repeat(20), '\n'.repeat(1_000_000) + 'LOOP: stop']) {
    const t = Date.now();
    parsePace(text);
    assert.ok(Date.now() - t < 500, `parsePace is linear (${Date.now() - t} ms)`);
  }
  const lim = { minDelay: 5, maxDelay: 60 };
  assert.deepStrictEqual(clampPace(25, lim), { minutes: 25, source: 'agent' });
  assert.deepStrictEqual(clampPace(2, lim), { minutes: 5, source: 'clamped' });
  assert.deepStrictEqual(clampPace(0, lim), { minutes: 5, source: 'clamped' });
  assert.deepStrictEqual(clampPace(99999, lim), { minutes: 60, source: 'clamped' });
  assert.deepStrictEqual(clampPace(NaN, lim), { minutes: 5, source: 'clamped' });
  assert.deepStrictEqual(clampPace(Infinity, lim), { minutes: 5, source: 'clamped' });
  assert.deepStrictEqual(clampPace('7', lim), { minutes: 5, source: 'clamped' });
  assert.deepStrictEqual(LOOP_DEFAULTS, { defaultDelay: 30, minDelay: 5, maxDelay: 60, maxPasses: 12, endHours: 8, capAiu: 50, capUsd: 0.5 });
  for (const mode of ['line', 'tool'] as const) {
    const f = loopFooter({ minDelay: 5, maxDelay: 1440, maxPasses: 100 }, 100, mode);
    assert.ok(f.length <= 400 && f.includes('pass 100 of 100') && (mode === 'line' ? f.includes('LOOP: next') : f.includes('schedule_next')), f);
  }

  // --- a pass, the asked delay, clamping, stop (T003) ---
  {
    const h = harness();
    h.sch.start();
    const s = await h.loop();
    assert.deepStrictEqual(h.sent, ['check CI'], 'the first pass goes out at once');
    assert.ok(s.loop?.inPass && s.loop.passes === 1 && s.next === undefined);
    await h.advance(60 * MIN);
    assert.strictEqual(h.sent.length, 1, 'nothing while the pass is in progress');
    h.sch.turnEnded('s1', { finalText: 'ok\nLOOP: next 25 min - waiting for CI' });
    assert.strictEqual(s.next, h.now + 25 * MIN);
    assert.deepStrictEqual(s.loop?.lastAsk, { minutes: 25, reason: 'waiting for CI', source: 'agent' });
    await h.advance(24 * MIN);
    assert.strictEqual(h.sent.length, 1);
    await h.advance(MIN);
    assert.strictEqual(h.sent.length, 2);
    assert.strictEqual(s.loop?.passes, 2);
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 2 min' });
    assert.deepStrictEqual([s.loop?.lastAsk?.minutes, s.loop?.lastAsk?.source, s.loop?.lastAsk?.asked], [5, 'clamped', 2]);
    await h.advance(5 * MIN);
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 99999 min' });
    assert.strictEqual(s.next, h.now + 60 * MIN);
    await h.advance(60 * MIN);
    h.sch.turnEnded('s1', { finalText: 'LOOP: stop - all green' });
    assert.deepStrictEqual([s.loop?.ended?.reason, s.loop?.ended?.text], ['agent', 'Stopped by the agent: all green']);
    const n = h.sent.length;
    await h.advance(24 * 60 * MIN);
    assert.strictEqual(h.sent.length, n, 'nothing more after a stop');
    assert.strictEqual(s.next, undefined);
  }

  // no line: default delay once, two in a row end it (Q3); an error pass counts only toward the error streak (FR-012, FR-013)
  {
    const h = harness();
    const s = await h.loop();
    h.sch.turnEnded('s1', { finalText: 'done' });
    assert.deepStrictEqual([s.next, s.loop?.lastAsk?.reason, s.loop?.lastAsk?.source], [h.now + 30 * MIN, 'the agent did not say', 'default']);
    await h.advance(30 * MIN);
    h.sch.turnEnded('s1', { error: true });
    assert.ok(!s.loop?.ended, 'an error pass does not reset or add to the no-line streak');
    assert.strictEqual(s.next, h.now + 30 * MIN, 'an error waits the default delay');
    await h.advance(30 * MIN);
    h.sch.turnEnded('s1', { finalText: 'again no line' });
    const e1 = (s as Schedule).loop?.ended;
    assert.deepStrictEqual([e1?.reason, e1?.text], ['no-pace', 'Stopped: the agent did not pace the loop']);
  }
  {
    const h = harness();
    const s = await h.loop();
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
    await h.advance(5 * MIN);
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
    assert.strictEqual(s.loop?.noPaceStreak, 0, 'a line resets the no-line streak');
    await h.advance(5 * MIN);
    h.sch.turnEnded('s1', { error: true });
    await h.advance(30 * MIN);
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
    assert.ok(!s.loop?.ended && !s.loop?.errorStreak, 'a good pass resets the error streak');
    await h.advance(5 * MIN);
    h.sch.turnEnded('s1', { error: true });
    await h.advance(30 * MIN);
    h.sch.turnEnded('s1', { error: true });
    const e2 = (s as Schedule).loop?.ended;
    assert.deepStrictEqual([e2?.reason, e2?.text], ['errors', 'Stopped after two failed passes']);
  }
  // a pass that cannot be sent is a failed pass
  {
    const h = harness();
    h.failSend.v = true;
    const s = await h.loop();
    assert.ok(!s.loop?.inPass && s.loop?.passes === 1 && s.next === h.now + 30 * MIN, 'counted, then the default delay');
    await h.advance(30 * MIN);
    assert.strictEqual(s.loop?.ended?.reason, 'errors');
  }
  // Stop during a pass ends it; a turn between passes does not touch the loop
  {
    const h = harness();
    const s = await h.loop();
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    const next = s.next;
    h.sch.turnEnded('s1', { stopped: true });
    assert.strictEqual(s.next, next, 'a user turn between passes changes nothing');
    await h.advance(10 * MIN);
    h.sch.turnEnded('s1', { stopped: true });
    assert.strictEqual(s.loop?.ended?.reason, 'user');
  }
  // max passes, end time, the loop's own cap
  {
    const h = harness();
    const s = await h.loop({}, { maxPasses: 2 });
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
    await h.advance(5 * MIN);
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
    assert.deepStrictEqual([s.loop?.ended?.reason, h.sent.length], ['passes', 2]);
  }
  {
    const h = harness();
    const s = await h.loop({}, { endAt: T0 + 20 * MIN });
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 25 min' });
    assert.strictEqual(s.loop?.ended?.reason, 'time', 'a wake after the end time is never sent');
    await h.advance(60 * MIN);
    assert.strictEqual(h.sent.length, 1);
  }
  {
    const h = harness();
    const s = await h.loop({ cap: { amount: 1, unit: 'aiu' } });
    h.sch.noteUsage('s1', { nanoAiu: 1.5e9 });
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
    assert.deepStrictEqual([s.loop?.ended?.reason, s.loop?.ended?.text], ['limit', 'Stopped: reached its limit']);
    assert.strictEqual(s.spent, 1.5, 'the pass that went over was not interrupted');
  }

  // --- holds, busy, Pause all (T004) ---
  {
    const h = harness();
    const s = await h.loop();
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    h.busy.add('s1');
    await h.advance(10 * MIN);
    assert.deepStrictEqual([h.sent.length, s.last?.outcome, s.loop?.passes, s.next], [1, 'skipped-busy', 1, h.now + 10 * MIN], 'busy skips, never queues, and is not a pass');
    h.busy.delete('s1');
    await h.advance(10 * MIN);
    assert.strictEqual(h.sent.length, 2);
  }
  {
    // a person-wait that starts between passes holds the loop; the release waits the last delay
    const h = harness();
    const s = await h.loop();
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    h.wait.v = 'person';
    h.sch.holdsChanged('s1');
    assert.strictEqual(s.loop?.hold, 'person');
    await h.advance(60 * MIN);
    assert.strictEqual(h.sent.length, 1, 'nothing while it waits for a person');
    h.wait.v = undefined;
    h.sch.holdsChanged('s1');
    assert.deepStrictEqual([s.loop?.hold, s.next], [undefined, h.now + 10 * MIN], 'never at once');
    await h.advance(9 * MIN);
    assert.strictEqual(h.sent.length, 1);
    await h.advance(MIN);
    assert.strictEqual(h.sent.length, 2);
    // a wait found at the wake holds it too (coffee break)
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    await h.advance(9 * MIN);
    h.wait.v = 'break';
    await h.advance(MIN);
    assert.deepStrictEqual([h.sent.length, s.loop?.hold, s.last?.outcome], [2, 'break', 'held']);
    await h.advance(120 * MIN);
    assert.strictEqual(h.sent.length, 2);
    h.wait.v = undefined;
    h.sch.holdsChanged('s1');
    assert.strictEqual(s.next, h.now + 10 * MIN);
    // a wait that starts while the pass runs is applied when the pass ends
    await h.advance(10 * MIN);
    h.wait.v = 'person';
    h.sch.holdsChanged('s1');
    assert.strictEqual(s.loop?.hold, undefined, 'a pass in progress is not held');
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 20 min' });
    assert.strictEqual(s.loop?.hold, 'person');
    h.wait.v = undefined;
    h.sch.holdsChanged('s1');
    assert.strictEqual(s.next, h.now + 20 * MIN);
  }
  {
    // Pause all holds every loop and releases without a burst
    const h = harness();
    const a = await h.loop();
    const b = await h.loop({ target: { session: 's2', agent: 'copilot' } });
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    h.sch.turnEnded('s2', { finalText: 'LOOP: next 20 min' });
    h.sch.setPausedAll(true);
    assert.deepStrictEqual([a.loop?.hold, b.loop?.hold], ['pause-all', 'pause-all']);
    await h.advance(3 * 60 * MIN);
    assert.strictEqual(h.sent.length, 2, 'nothing sent while paused');
    h.sch.setPausedAll(false);
    assert.deepStrictEqual([a.next, b.next], [h.now + 10 * MIN, h.now + 20 * MIN]);
    await h.advance(9 * MIN);
    assert.strictEqual(h.sent.length, 2, 'no burst');
    await h.advance(MIN);
    assert.strictEqual(h.sent.length, 3);
    // Pause all turned on during a pass: the pass ends, then the loop is held
    h.sch.setPausedAll(true);
    assert.strictEqual(a.loop?.hold, undefined, 'a pass in progress is not held');
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 30 min' });
    assert.strictEqual(a.loop?.hold, 'pause-all');
    // Pause all with a person still waiting: the release becomes a person hold
    h.wait.v = 'person';
    h.sch.setPausedAll(false);
    assert.strictEqual(a.loop?.hold, 'person');
  }
  {
    // Durbar's spending cap pauses the loop and only Resume continues (Q5)
    const h = harness();
    const s = await h.loop();
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    h.wait.v = 'cap';
    await h.advance(10 * MIN);
    assert.deepStrictEqual([s.paused, s.pausedReason, h.sent.length], [true, 'cap', 1]);
    h.wait.v = undefined;
    await h.advance(3 * 60 * MIN);
    assert.strictEqual(h.sent.length, 1, 'clearing the cap does not restart it');
    const r = h.sch.save({ ...s, paused: false }, () => true);
    assert.ok(r.ok);
    const now2 = h.sch.doc.schedules[0];
    assert.deepStrictEqual([now2.paused, now2.pausedReason, now2.next], [undefined, undefined, h.now + 10 * MIN], 'Resume waits the last delay, never at once');
    assert.strictEqual(now2.loop?.passes, 1, 'Resume keeps the loop state');
    await h.advance(10 * MIN);
    assert.strictEqual(h.sent.length, 2);
  }
  {
    // the session ends: the loop ends, it is never moved
    const h = harness();
    const s = await h.loop();
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    h.sessions.delete('s1');
    h.sch.sessionsChanged();
    assert.deepStrictEqual([s.loop?.ended?.reason, s.paused], ['session', undefined]);
    await h.advance(60 * MIN);
    assert.strictEqual(h.sent.length, 1);
    // a wake that finds the session gone ends too
    const g = harness();
    const t = await g.loop();
    g.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    g.sessions.delete('s1');
    await g.advance(10 * MIN);
    assert.strictEqual(t.loop?.ended?.reason, 'session');
    // stopLoop / stopLoopFor
    const k = harness();
    const u = await k.loop();
    assert.ok(k.sch.stopLoopFor('s1') && u.loop?.ended?.reason === 'user' && !k.sch.stopLoop(u.id));
  }

  // Resume after Durbar's cap keeps the loop's spend (3)
  {
    const h = harness();
    const s = await h.loop();
    h.sch.noteUsage('s1', { nanoAiu: 2e9 });
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    h.wait.v = 'cap';
    await h.advance(10 * MIN);
    assert.strictEqual(s.pausedReason, 'cap');
    h.wait.v = undefined;
    assert.ok(h.sch.save({ ...s, paused: false }, () => true).ok);
    assert.deepStrictEqual([h.sch.doc.schedules[0].spent, h.sch.doc.schedules[0].loop?.passes], [2, 1], 'spend and passes are kept on Resume');
  }
  // a non-edit save (Pause, Resume) never changes the limits; an edit is bounded by the loop's start (1)
  {
    const h = harness();
    const s = await h.loop();
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    const end0 = s.loop?.endAt as number;
    assert.ok(h.sch.save({ ...s, paused: true, loop: { ...s.loop, endAt: h.now + 400 * 60 * MIN, maxPasses: 100, minDelay: 5 } }, () => true).ok);
    assert.deepStrictEqual([end0, h.sch.doc.schedules[0].loop?.endAt, h.sch.doc.schedules[0].loop?.maxPasses], [end0, end0, 12], 'limits sent with a Pause are ignored');
    await h.advance(60 * MIN);
    const lim = { minDelay: 5, maxDelay: 60, defaultDelay: 30, maxPasses: 12 };
    const bad = h.sch.save({ ...s, edit: true, loop: { ...lim, endAt: T0 + 25 * 60 * MIN } }, () => true);
    assert.ok(!bad.ok, 'an edit may not end later than 24 h after the loop started, even if now is later');
    assert.ok(h.sch.save({ ...s, edit: true, loop: { ...lim, endAt: T0 + 23 * 60 * MIN } }, () => true).ok);
  }
  // the last ask is clamped to the current limits (4)
  {
    const h = harness();
    const s = await h.loop();
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
    assert.ok(h.sch.save({ ...s, edit: true, loop: { minDelay: 20, maxDelay: 60, defaultDelay: 30, maxPasses: 12, endAt: s.loop?.endAt } }, () => true).ok);
    h.busy.add('s1');
    await h.advance(5 * MIN);
    assert.strictEqual(h.sch.doc.schedules[0].last?.outcome, 'skipped-busy');
    assert.strictEqual(h.sch.doc.schedules[0].next, h.now + 20 * MIN, 'a busy skip waits the new minimum');
    h.busy.delete('s1');
    h.wait.v = 'person';
    h.sch.holdsChanged('s1');
    h.wait.v = undefined;
    h.sch.holdsChanged('s1');
    assert.strictEqual(h.sch.doc.schedules[0].next, h.now + 20 * MIN, 'a hold release waits the new minimum');
  }
  // a failed send after the turn already ended does not end the pass twice (6)
  {
    const h = harness();
    h.failSend.v = true;
    h.onSend.fn = () => h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min - hi' });
    const s = await h.loop();
    h.onSend.fn = undefined;
    assert.deepStrictEqual([s.loop?.errorStreak, s.loop?.ended, s.loop?.passes, s.loop?.lastAsk?.minutes, s.next], [0, undefined, 1, 10, h.now + 10 * MIN], 'the pass ended once, with the agent ask');
  }
  // a wall-clock jump forward does not shorten the minimum between two passes (7a)
  {
    const h = harness();
    const s = await h.loop();
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
    h.skew.v += 5 * MIN; // the wall clock jumps; the monotonic clock saw no time pass
    await h.advance(5 * MIN);
    assert.deepStrictEqual([h.sent.length, s.loop?.passes], [1, 1], 'not sent: only a jump of the wall clock');
    assert.ok(s.next !== undefined && s.next > h.now, 'it waits for the real minimum');
    await h.advance(5 * MIN);
    assert.strictEqual(h.sent.length, 2);
  }
  // the ended text has no invisible characters (7b)
  {
    const s = parseSchedules(JSON.stringify({ schedules: [{ id: 'aaaaaaaa-1', folder: '/w', prompt: 'p', target: { session: 's1', agent: 'copilot' }, loop: { minDelay: 5, maxDelay: 60, defaultDelay: 30, maxPasses: 3, endAt: T0 + MIN, ended: { at: 1, reason: 'agent', text: 'a\u202eb\u200bc\nd' } } }] }), T0).schedules[0];
    assert.strictEqual(s.loop?.ended?.text, 'abc d');
  }

  // --- review of #546: a send in flight while Pause, Resume or an edit replaces the schedule object ---
  const gated = (h: ReturnType<typeof harness>): (() => Promise<void>) => {
    let go!: () => void;
    h.gate.p = new Promise<void>((r) => (go = r));
    return async () => { h.gate.p = undefined; go(); await new Promise((r) => setImmediate(r)); };
  };
  const cur = (h: ReturnType<typeof harness>): Schedule => h.sch.doc.schedules[0];
  {
    // the exact repro: Pause during the send, the send fails, Resume
    const h = harness();
    h.failSend.v = true;
    const release = gated(h);
    const s = await h.loop();
    assert.ok(s.loop?.inPass && h.sent.length === 1);
    assert.ok(h.sch.save({ ...s, paused: true }, () => true).ok);
    assert.ok(cur(h) !== s, 'save replaced the object');
    await release();
    assert.deepStrictEqual([cur(h).loop?.inPass, cur(h).loop?.errorStreak, cur(h).last?.outcome], [false, 1, 'failed'], 'the failed pass lands on the live loop');
    h.failSend.v = false;
    assert.ok(h.sch.save({ ...cur(h), paused: false }, () => true).ok);
    assert.strictEqual(cur(h).next, h.now + 30 * MIN);
    await h.advance(30 * MIN);
    assert.strictEqual(h.sent.length, 2, 'the loop sends again after Resume');
    assert.ok(cur(h).loop?.inPass);
  }
  {
    // a second failed pass after the same interleaving still ends the loop (it is not stuck)
    const h = harness();
    h.failSend.v = true;
    const release = gated(h);
    const s = await h.loop();
    assert.ok(h.sch.save({ ...s, paused: true }, () => true).ok);
    await release();
    assert.ok(h.sch.save({ ...cur(h), paused: false }, () => true).ok);
    await h.advance(30 * MIN);
    assert.strictEqual(cur(h).loop?.ended?.reason, 'errors');
  }
  {
    // the turn ended in error during the await, then the send "succeeds": last stays failed, nothing is overwritten
    const h = harness();
    const release = gated(h);
    const s = await h.loop();
    assert.ok(h.sch.save({ ...s, paused: true }, () => true).ok);
    h.sch.turnEnded('s1', { error: true });
    await release();
    assert.deepStrictEqual([cur(h).last?.outcome, cur(h).loop?.inPass], ['failed', false]);
  }
  {
    // an edit during the send; a stop during the send is not undone; a removed loop is not touched
    const h = harness();
    h.failSend.v = true;
    const release = gated(h);
    const s = await h.loop();
    assert.ok(h.sch.save({ ...s, edit: true, loop: { ...s.loop, maxPasses: 20 } }, () => true).ok);
    await release();
    assert.deepStrictEqual([cur(h).loop?.inPass, cur(h).loop?.errorStreak, cur(h).loop?.maxPasses], [false, 1, 20]);
    const h2 = harness();
    h2.failSend.v = true;
    const release2 = gated(h2);
    const s2 = await h2.loop();
    assert.ok(h2.sch.stopLoop(s2.id));
    await release2();
    assert.deepStrictEqual([cur(h2).loop?.ended?.reason, cur(h2).loop?.errorStreak ?? 0, cur(h2).last?.outcome], ['user', 0, 'ended']);
  }

  {
    // M5: a late failed send of pass 1 returns after pass 2 has started; it must not land on pass 2
    const h = harness();
    let go1!: () => void;
    h.gate.p = new Promise<void>((r) => (go1 = r));
    const s = await h.loop();
    assert.ok(s.loop?.inPass && h.sent.length === 1);
    h.sch.turnEnded('s1', {}); // pass 1's turn ends while its send is still pending
    h.gate.p = new Promise<void>(() => undefined); // pass 2's send stays pending
    (h.sch as unknown as { running: boolean }).running = false; // the guard is defensive: tick() is serial, so free it by hand to reach this order
    (h.sch as unknown as { goingOut: Set<string> }).goingOut.clear(); // as with `running`: the guard stands behind these two (spec 044)
    await h.advance(30 * MIN);
    assert.deepStrictEqual([h.sent.length, cur(h).loop?.passes, cur(h).loop?.inPass], [2, 2, true]);
    h.failSend.v = true;
    go1();
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual([cur(h).loop?.passes, cur(h).loop?.inPass, cur(h).loop?.errorStreak ?? 0, cur(h).loop?.ended], [2, true, 0, undefined], 'pass 1 result does not land on pass 2');
    assert.notStrictEqual(cur(h).last?.outcome, 'failed');
  }
  {
    // M5: Stop then Start again while a send is pending; the late result must not land on the restarted loop
    const h = harness();
    let go1!: () => void;
    h.gate.p = new Promise<void>((r) => (go1 = r));
    const s = await h.loop();
    assert.ok(h.sch.stopLoop(s.id));
    await h.advance(MIN); // the restart gets a different startedAt
    h.gate.p = new Promise<void>(() => undefined);
    (h.sch as unknown as { running: boolean }).running = false; // the guard is defensive: tick() is serial, so free it by hand to reach this order
    (h.sch as unknown as { goingOut: Set<string> }).goingOut.clear();
    assert.ok(h.sch.restartLoop(s.id).ok);
    await h.advance(0);
    assert.deepStrictEqual([h.sent.length, cur(h).loop?.passes, cur(h).loop?.inPass], [2, 1, true]);
    h.failSend.v = true;
    go1();
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual([cur(h).loop?.passes, cur(h).loop?.inPass, cur(h).loop?.errorStreak ?? 0, cur(h).loop?.ended], [1, true, 0, undefined], 'the old send does not land on the restarted loop');
  }

  // --- the end time is a boundary: no pass at or after endAt, and a loop does not stay "running" past it ---
  {
    // a busy skip whose next wake is exactly endAt: nothing is sent, it ends with reason time
    const h = harness();
    const s = await h.loop({}, { endAt: T0 + 60 * MIN });
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 20 min' });
    h.busy.add('s1');
    await h.advance(20 * MIN);
    await h.advance(20 * MIN); // busy skip at T0+40, next = T0+60 = endAt
    assert.ok(!s.loop?.ended || s.loop.ended.at <= T0 + 60 * MIN);
    h.busy.delete('s1');
    await h.advance(20 * MIN);
    assert.strictEqual(h.sent.length, 1, 'nothing sent at endAt');
    assert.deepStrictEqual([s.loop?.ended?.reason, s.loop?.ended?.at], ['time', T0 + 60 * MIN]);
  }
  {
    // a hold released so that the next wake is exactly endAt
    const h = harness();
    const s = await h.loop({}, { endAt: T0 + 60 * MIN });
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 30 min' });
    h.wait.v = 'person';
    h.sch.holdsChanged('s1');
    await h.advance(30 * MIN);
    h.wait.v = undefined;
    h.sch.holdsChanged('s1'); // at T0+30, next = T0+60 = endAt
    await h.advance(30 * MIN);
    assert.strictEqual(h.sent.length, 1);
    assert.deepStrictEqual([s.loop?.ended?.reason, s.loop?.ended?.at], ['time', T0 + 60 * MIN]);
  }
  {
    // a held loop (a person is needed) ends at its end time, not when the hold clears; so does one on Pause all
    for (const how of ['person', 'pause-all'] as const) {
      const h = harness();
      const s = await h.loop({}, { endAt: T0 + 60 * MIN });
      h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
      if (how === 'person') {
        h.wait.v = 'person';
        h.sch.holdsChanged('s1');
      } else h.sch.setPausedAll(true);
      assert.strictEqual(s.loop?.hold, how);
      await h.advance(59 * MIN);
      assert.ok(!s.loop?.ended, 'still held before the end time');
      await h.advance(MIN);
      assert.deepStrictEqual([(s as Schedule).loop?.ended?.reason, (s as Schedule).loop?.ended?.at, h.sent.length], ['time', T0 + 60 * MIN, 1], how);
    }
    // a next wake beyond endAt (a long busy streak) ends at endAt too
    const h = harness();
    const s = await h.loop({}, { endAt: T0 + 50 * MIN });
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 40 min' });
    h.busy.add('s1');
    await h.advance(40 * MIN); // skip: next = T0+40+40 > endAt
    assert.ok(!s.loop?.ended);
    await h.advance(10 * MIN);
    assert.deepStrictEqual([(s as Schedule).loop?.ended?.reason, (s as Schedule).loop?.ended?.at], ['time', T0 + 50 * MIN]);
  }

  // --- the minimum delay runs from the END of the pass, also on the monotonic clock ---
  {
    const h = harness();
    const s = await h.loop();
    await h.advance(20 * MIN); // a long pass
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
    h.skew.v += 5 * MIN; // the wall clock jumps; the monotonic clock saw nothing since the pass ended
    await h.advance(5 * MIN);
    assert.strictEqual(h.sent.length, 1, 'not sent: the minimum counts from the end of the pass, not from the send');
    await h.advance(5 * MIN);
    assert.strictEqual(h.sent.length, 2);
    void s;
  }

  // --- usage that arrives after the turn ended still counts toward the loop's cap until its next pass starts ---
  {
    const h = harness();
    const s = await h.loop({ cap: { amount: 3, unit: 'aiu' } });
    h.sch.noteUsage('s1', { nanoAiu: 1e9 });
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
    h.sch.noteUsage('s1', { nanoAiu: 2.5e9 }); // `usage` after `idle`
    assert.strictEqual(s.spent, 3.5);
    await h.advance(5 * MIN);
    assert.deepStrictEqual([s.loop?.ended?.reason, h.sent.length], ['limit', 1], 'the late spend stops the next pass');
    h.sch.noteUsage('s1', { nanoAiu: 1e9 });
    assert.strictEqual(s.spent, 3.5, 'an ended loop counts nothing more');
  }

  // --- restart (T005) ---
  {
    const h = harness();
    const s = await h.loop({}, { endAt: T0 + 3 * 60 * MIN });
    h.sch.noteUsage('s1', { nanoAiu: 2e9 });
    h.sch.turnEnded('s1', { finalText: 'LOOP: next 10 min' });
    // Durbar closes and opens again: same file, new Scheduler
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loops-')), 's.json');
    saveSchedules(file, h.sch.doc);
    assert.ok(!/"hold"|"inPass"/.test(fs.readFileSync(file, 'utf8')));
    const h2 = harness(parseSchedules(fs.readFileSync(file, 'utf8'), T0));
    h2.sch.start();
    const r = h2.sch.doc.schedules[0];
    assert.deepStrictEqual([r.loop?.ended?.reason, r.loop?.ended?.text, r.next], ['app-closed', 'Ended when Durbar closed', undefined]);
    await h2.advance(24 * 60 * MIN);
    assert.strictEqual(h2.sent.length, 0, 'nothing is sent after a restart');
    assert.strictEqual(r.loop?.passes, 1);
    // Start again: a new run, passes and spend from zero
    assert.deepStrictEqual(h2.sch.restartLoop('nope'), { ok: false, error: 'That loop is gone.' });
    assert.ok(h2.sch.restartLoop(r.id).ok);
    assert.deepStrictEqual([r.loop?.passes, r.spent, r.loop?.ended, r.loop?.lastAsk, r.next, r.loop?.endAt], [0, undefined, undefined, undefined, h2.now, h2.now + 3 * 60 * MIN]);
    await h2.advance(0);
    assert.deepStrictEqual([h2.sent.length, r.loop?.passes], [1, 1]);
    assert.deepStrictEqual(h2.sch.restartLoop(r.id), { ok: false, error: 'That loop is still running.' });
    // a paused loop is ended at start too; one loop per session blocks a second restart
    void s;
  }
  {
    const h = harness();
    const a = await h.loop();
    h.sch.stopLoop(a.id);
    const b = await h.loop();
    assert.ok(b.loop && !b.loop.ended);
    assert.deepStrictEqual(h.sch.restartLoop(a.id), { ok: false, error: 'That session already has a loop.' });
    h.sessions.delete('s1');
    h.sch.stopLoop(b.id);
    assert.deepStrictEqual(h.sch.restartLoop(a.id), { ok: false, error: 'That session has ended.' });
  }

  // --- SC-002 fuzz: any sequence of asks, errors, waits and busy sessions ---
  {
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const asks = ['LOOP: next 0 min', 'LOOP: next 1 min', 'LOOP: next 99999 min', 'LOOP: next 5 min', 'LOOP: next 17 min - x', 'LOOP: next 2 h', 'LOOP: stop', 'no line', '', 'LOOP: next -3 min', 'LOOP: next 7 h - '.repeat(30)];
    for (let run = 0; run < 60; run++) {
      const h = harness();
      const maxPasses = 1 + Math.floor(rnd() * 10);
      const minDelay = 5 + Math.floor(rnd() * 10);
      const endAt = T0 + (30 + Math.floor(rnd() * 600)) * MIN;
      const s = await h.loop({ cap: { amount: 5, unit: 'aiu' } }, { minDelay, maxDelay: 120, defaultDelay: minDelay + 3, maxPasses, endAt });
      for (let step = 0; step < 400 && !s.loop?.ended; step++) {
        const roll = rnd();
        if (s.loop?.inPass) {
          if (rnd() < 0.5) h.sch.noteUsage('s1', { nanoAiu: rnd() * 2e9 });
          if (roll < 0.15) h.sch.turnEnded('s1', { error: true });
          else h.sch.turnEnded('s1', { finalText: asks[Math.floor(rnd() * asks.length)] });
        } else {
          if (roll < 0.1) h.busy.add('s1');
          else h.busy.delete('s1');
          if (roll > 0.9) h.wait.v = rnd() < 0.5 ? 'person' : 'break';
          else if (roll > 0.8) {
            h.wait.v = undefined;
            h.sch.holdsChanged('s1');
          }
          if (roll > 0.95) h.sch.setPausedAll(true);
          else if (roll > 0.9) h.sch.setPausedAll(false);
        }
        await h.advance(Math.floor(rnd() * 40) * MIN);
        assert.ok(h.sent.length <= maxPasses, `run ${run}: at most maxPasses`);
      }
      h.busy.clear(); h.wait.v = undefined; h.sch.setPausedAll(false);
      if (s.loop?.inPass) h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
      const before = h.sent.length;
      await h.advance(48 * 60 * MIN);
      assert.ok(h.sent.length <= maxPasses && h.sent.length >= before, `run ${run}`);
    }
  }
  // SC-002 precisely: the clock at each send, no pass earlier than minDelay after the previous pass ended, none at or after endAt, none after the cap
  {
    let seed = 777;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const asks = ['LOOP: next 0 min', 'LOOP: next 1 min', 'LOOP: next 99999 min', 'no line', 'LOOP: next 9 min'];
    for (let run = 0; run < 60; run++) {
      const h = harness();
      const minDelay = 5 + Math.floor(rnd() * 5);
      const endAt = T0 + (60 + Math.floor(rnd() * 300)) * MIN;
      const sendTimes: number[] = [];
      const s = await h.loop({ cap: { amount: 3, unit: 'aiu' } }, { minDelay, maxDelay: 90, defaultDelay: minDelay, maxPasses: 8, endAt });
      sendTimes.push(h.now);
      let endedAt = 0;
      for (let step = 0; step < 100 && !s.loop?.ended; step++) {
        if (s.loop?.inPass) {
          h.sch.noteUsage('s1', { nanoAiu: rnd() * 1.5e9 });
          endedAt = h.now;
          h.sch.turnEnded('s1', { finalText: asks[Math.floor(rnd() * asks.length)] });
          if (s.loop?.ended) break;
          const before = h.sent.length;
          await h.advance((s.next as number) - h.now);
          if (h.sent.length > before) {
            sendTimes.push(h.now);
            assert.ok(h.now - endedAt >= minDelay * MIN, `run ${run}: gap ${(h.now - endedAt) / MIN} min < ${minDelay}`);
            assert.ok(h.now < endAt, `run ${run}: sent after endAt`);
            assert.ok((s.spent ?? 0) < 3 + 1.5, `run ${run}: sent over the cap`);
          }
        }
      }
      assert.ok(sendTimes.length <= 8);
    }
  }
  // fuzz: Pause, Resume, an edit or a stop while a send is in flight, the send then fails or not: a loop is never stuck in a pass,
  // never sends after its end time or over its passes, and `last` is never "sent" for a failed pass
  {
    let seed = 4242;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let run = 0; run < 80; run++) {
      const h = harness();
      const maxPasses = 2 + Math.floor(rnd() * 6);
      const endAt = T0 + (60 + Math.floor(rnd() * 300)) * MIN;
      const sendTimes: number[] = [];
      let id = '';
      for (let step = 0; step < 60; step++) {
        const c = h.sch.doc.schedules[0];
        if (c?.loop?.ended) break;
        const release = gated(h);
        h.failSend.v = rnd() < 0.5;
        const before = h.sent.length;
        if (!c) {
          const r = h.sch.save({ folder: '/w', prompt: 'p', target: { session: 's1', agent: 'copilot' }, cap: { amount: 50, unit: 'aiu' }, loop: { minDelay: 5, maxDelay: 60, defaultDelay: 10, maxPasses, endAt } }, () => true);
          assert.ok(r.ok);
          id = (r as { schedule: Schedule }).schedule.id;
          await h.advance(0);
        } else {
          await h.advance(Math.max(0, (c.next ?? h.now) - h.now));
        }
        if (h.sent.length > before) sendTimes.push(h.now);
        const live = (): Schedule => h.sch.doc.schedules.find((x) => x.id === id) as Schedule;
        // during the send
        const act = rnd();
        if (live()?.loop?.inPass) {
          const l = live();
          if (act < 0.3) h.sch.save({ ...l, paused: true }, () => true);
          else if (act < 0.5) h.sch.save({ ...l, edit: true, loop: { ...l.loop, maxPasses } }, () => true);
          else if (act < 0.6) {
            h.sch.save({ ...l, paused: true }, () => true);
            h.sch.save({ ...live(), paused: false }, () => true);
          } else if (act < 0.65) h.sch.stopLoop(id);
          else if (act < 0.75) h.sch.turnEnded('s1', { error: true });
        }
        await release();
        const l = live();
        if (l?.loop && !l.loop.ended && h.gate.p === undefined && !(h.sch as unknown as { running: boolean }).running) {
          if (l.loop.inPass) {
            // the send succeeded: the turn is still running; it ends now
            h.sch.turnEnded('s1', { finalText: rnd() < 0.5 ? 'LOOP: next 7 min' : 'LOOP: next 1 min' });
          }
          assert.ok(!live().loop?.inPass, `run ${run}: left the pass`);
        }
        if (live()?.paused && !live().loop?.ended) h.sch.save({ ...live(), paused: false }, () => true);
        assert.ok(h.sent.length <= maxPasses, `run ${run}: at most maxPasses`);
        for (const at of sendTimes) assert.ok(at < endAt, `run ${run}: sent at or after endAt`);
      }
      h.failSend.v = false;
      h.gate.p = undefined;
      for (let k = 0; k < 40 && !h.sch.doc.schedules[0].loop?.ended; k++) {
        const f = h.sch.doc.schedules[0];
        if (f.paused) h.sch.save({ ...f, paused: false }, () => true);
        else if (f.loop?.inPass) h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 min' });
        await h.advance(60 * MIN);
        assert.ok(h.sent.length <= maxPasses, `run ${run}: at most maxPasses at the end`);
      }
      assert.ok(h.sch.doc.schedules[0].loop?.ended, `run ${run}: the loop always ends (never stuck in a pass)`);
    }
  }
}

if (require.main === module) main().then(() => console.log('loops tests passed')).catch((e) => { console.error(e); process.exit(1); });
