/** Self-paced loops (spec 072, Phase 1 core): the pace line parser and the scheduler's loop rules with a fake clock and sender. `npm run test:loops`. No session, no credits. */
import * as assert from 'assert';
import { LOOP_DEFAULTS, clampPace, cleanReason, loopFooter, parsePace } from '../src/shared/looppace';
import { Scheduler, parseSchedules, saveSchedules } from '../src/main/schedules';
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
  const timers: { at: number; fn: () => void }[] = [];
  const sch = new Scheduler(doc, {
    now: () => now,
    isBusy: (_f, session) => busy.has(session ?? ''),
    hasSession: (id) => sessions.has(id),
    capUnitOf: () => 'aiu',
    waitOf: () => wait.v,
    send: async (f, p, s) => (sent.push(p), failSend.v ? false : s.target ? s.target.session : 'x'),
    setTimer: (ms, fn) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t as never); if (i >= 0) timers.splice(i, 1); },
    save: () => undefined,
  });
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
  return { sch, sent, busy, sessions, wait, failSend, advance, loop, get now() { return now; } };
}

async function main(): Promise<void> {
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
  assert.strictEqual(parsePace('LOOP: stop - all merged\nthanks'), undefined, 'last line only');
  assert.strictEqual(parsePace('LOOP: next 5 min - ' + 'x'.repeat(200)), undefined, 'a line over 200 characters is no line');
  assert.strictEqual(parsePace(undefined), undefined);
  assert.strictEqual(parsePace({ a: 1 }), undefined);
  // hostile input: control, bidi and zero-width characters, secrets, huge text, linear time
  const hostile = parsePace('LOOP: stop - a‮b​c\u0000d\u001b[31m token ghp_' + 'A'.repeat(36));
  assert.ok(hostile?.kind === 'stop' && !/[\u0000-\u001f​‮]/.test(hostile.reason ?? '') && !(hostile.reason ?? '').includes('ghp_AAAA'), String(hostile && (hostile as { reason?: string }).reason));
  assert.strictEqual(cleanReason('x'.repeat(500))?.length, 120);
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
}

if (require.main === module) main().then(() => console.log('loops tests passed')).catch((e) => { console.error(e); process.exit(1); });
