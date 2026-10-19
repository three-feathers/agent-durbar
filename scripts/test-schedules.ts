/** Scheduled prompts (spec 044): the store and the scheduler with a fake clock and sender. `npm run test:schedules`. No session, no credits. */
import * as assert from 'assert';
import { Scheduler, cleanSchedule, dueAt, parseSchedules } from '../src/main/schedules';
import type { Schedule, SchedulesDoc } from '../src/main/schedules';

const MIN = 60_000;
function harness(doc: SchedulesDoc, t0 = 1_000_000_000_000) {
  let now = t0;
  const sent: string[] = [];
  const busy = new Set<string>();
  const timers: { at: number; fn: () => void }[] = [];
  let saved = 0;
  const sch = new Scheduler(doc, {
    now: () => now,
    isBusy: (f) => busy.has(f),
    send: async (f, p) => (sent.push(`${f}:${p}`), !f.includes('fail')),
    setTimer: (ms, fn) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t as never); if (i >= 0) timers.splice(i, 1); },
    save: () => { saved++; },
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
  return { sch, sent, busy, timers, advance, get now() { return now; }, get saved() { return saved; } };
}

async function main(): Promise<void> {
  const now = 1_000_000_000_000;
  // parsing and validation
  assert.deepStrictEqual(parseSchedules('nope', now), { pausedAll: false, schedules: [] });
  const p = parseSchedules(JSON.stringify({ pausedAll: true, schedules: [{ id: 'aaaaaaaa-1', folder: '/w', prompt: ' hi ', every: 30, next: now + 5 }, { folder: '/w', prompt: 'x', every: 2 }, { folder: '', prompt: 'x', at: 5 }, { folder: '/w', prompt: '', every: 30 }, { folder: '/w', prompt: 'once', at: now + MIN }] }), now);
  assert.strictEqual(p.pausedAll, true);
  assert.deepStrictEqual(p.schedules.map((s) => [s.prompt, s.every, s.at]), [['hi', 30, undefined], ['once', undefined, now + MIN]], 'bad entries are dropped (interval under 5 min, no folder, no prompt)');
  assert.strictEqual(cleanSchedule({ folder: '/w', prompt: 'x'.repeat(3000), every: 60 }, now)?.prompt.length, 2000);
  assert.strictEqual(cleanSchedule({ folder: '/w', prompt: 'x', every: 1441 }, now), undefined);
  assert.strictEqual(cleanSchedule({ folder: '/w', prompt: 'x', every: 7.5 }, now), undefined);
  assert.strictEqual(dueAt({ id: 'i', folder: '/w', prompt: 'x', every: 5, next: 9, paused: true } as Schedule), undefined);

  // an interval schedule sends when due, again after the interval; busy skips (no pile-up); pause all skips
  {
    const h = harness({ pausedAll: false, schedules: [] });
    h.sch.start();
    const r = h.sch.save({ folder: '/w', prompt: 'summarise', every: 30 }, () => true);
    assert.ok(r.ok);
    await h.advance(29 * MIN);
    assert.deepStrictEqual(h.sent, [], 'not before it is due');
    await h.advance(1 * MIN);
    assert.deepStrictEqual(h.sent, ['/w:summarise']);
    h.busy.add('/w');
    await h.advance(30 * MIN);
    assert.deepStrictEqual(h.sent, ['/w:summarise'], 'busy: skipped');
    assert.strictEqual(h.sch.doc.schedules[0].last?.outcome, 'skipped-busy');
    h.busy.delete('/w');
    await h.advance(10 * MIN);
    assert.strictEqual(h.sent.length, 1, 'a skipped run is not caught up later');
    await h.advance(20 * MIN);
    assert.strictEqual(h.sent.length, 2, 'the next regular run');
    h.sch.setPausedAll(true);
    await h.advance(30 * MIN);
    assert.strictEqual(h.sent.length, 2, 'pause all: nothing sent');
    assert.strictEqual(h.sch.doc.schedules[0].last?.outcome, 'skipped-paused');
    await h.advance(95 * MIN);
    h.sch.setPausedAll(false);
    await h.advance(0);
    assert.strictEqual(h.sent.length, 2, 'resuming does not fire a burst');
    await h.advance(30 * MIN);
    assert.strictEqual(h.sent.length, 3, 'then the interval continues from the resume');
  }
  // once: sends once at its time, then done; a past time is refused; a failed send is recorded
  {
    const h = harness({ pausedAll: false, schedules: [] });
    h.sch.start();
    assert.ok(!h.sch.save({ folder: '/w', prompt: 'x', at: h.now - 1 }, () => true).ok, 'a time in the past is refused');
    assert.ok(!h.sch.save({ folder: '/nope', prompt: 'x', every: 10 }, (f) => f === '/w').ok, 'an unknown folder is refused');
    h.sch.save({ folder: '/w', prompt: 'once', at: h.now + 10 * MIN }, () => true);
    h.sch.save({ folder: '/fail', prompt: 'nope', at: h.now + 10 * MIN }, () => true);
    await h.advance(10 * MIN);
    await h.advance(60 * MIN);
    assert.deepStrictEqual(h.sent, ['/w:once', '/fail:nope'], 'each once-schedule runs exactly once');
    assert.deepStrictEqual(h.sch.doc.schedules.map((s) => [s.done, s.last?.outcome]), [[true, 'sent'], [true, 'failed']]);
    assert.strictEqual(h.timers.length, 0, 'nothing left to wait for');
  }
  // start after the app was closed: a past once-schedule is missed (not sent), an interval continues from now
  {
    const doc: SchedulesDoc = { pausedAll: false, schedules: [
      { id: 'aaaaaaaa-once', folder: '/w', prompt: 'old', at: now - 2 * 3600_000 },
      { id: 'aaaaaaaa-every', folder: '/w', prompt: 'tick', every: 60, next: now - 5 * 3600_000 },
    ] };
    const h = harness(doc, now);
    h.sch.start();
    await h.advance(0);
    assert.deepStrictEqual(h.sent, [], 'nothing is caught up at start');
    assert.deepStrictEqual(h.sch.doc.schedules.map((s) => s.last?.outcome), ['missed', 'missed']);
    await h.advance(60 * MIN);
    assert.deepStrictEqual(h.sent, ['/w:tick']);
  }
  // remove, folder removal, edits keep the last outcome
  {
    const h = harness({ pausedAll: false, schedules: [] });
    h.sch.start();
    const a = h.sch.save({ folder: '/a', prompt: 'x', every: 10 }, () => true);
    h.sch.save({ folder: '/b', prompt: 'y', every: 10 }, () => true);
    assert.ok(a.ok);
    assert.ok(h.sch.remove(a.ok ? a.schedule.id : ''));
    assert.ok(!h.sch.remove('nope'));
    h.sch.removeFolder('/b');
    assert.strictEqual(h.sch.doc.schedules.length, 0);
    for (let i = 0; i < 50; i++) h.sch.save({ folder: '/c', prompt: 'p' + i, every: 10 }, () => true);
    assert.ok(!h.sch.save({ folder: '/c', prompt: 'one too many', every: 10 }, () => true).ok, 'at most 50');
  }
  console.log('schedules tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
