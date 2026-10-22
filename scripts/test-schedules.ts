/** Scheduled prompts (spec 044): the store and the scheduler with a fake clock and sender. `npm run test:schedules`. No session, no credits. */
import * as assert from 'assert';
import { Scheduler, alignedNext, cleanSchedule, dueAt, parseSchedules } from '../src/main/schedules';
import type { Schedule, SchedulesDoc } from '../src/main/schedules';

const MIN = 60_000;
export function harness(doc: SchedulesDoc, t0 = 1_000_000_000_000) {
  let now = t0;
  const sent: string[] = [];
  const busy = new Set<string>();
  /** Sessions that exist (FR-014); a schedule without a target sends to "folder-agent". */
  const sessions = new Set<string>(['s1', 's2']);
  const unit: { v: 'aiu' | 'usd' | undefined } = { v: 'aiu' };
  const timers: { at: number; fn: () => void }[] = [];
  let saved = 0;
  const sch = new Scheduler(doc, {
    now: () => now,
    isBusy: (f, session) => (session ? busy.has(session) : busy.has(f)),
    hasSession: (id) => sessions.has(id),
    capUnitOf: () => unit.v,
    send: async (f, p, s) => (sent.push(`${f}:${p}`), f.includes('fail') ? false : s.target ? s.target.session : 'folder-agent'),
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
  return { sch, sent, busy, sessions, unit, timers, advance, get now() { return now; }, get saved() { return saved; } };
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
  // FR-007: an interval with a first time keeps that time of day (here every 12 h from "08:30"); missed and busy runs do not shift it.
  // (An "every day at" is a calendar rule since Phase 2, FR-012/FR-013; see below and test-schedrules.ts.)
  {
    const DAY = 720 * MIN;
    assert.strictEqual(alignedNext(1000, 10, 500), 1000, 'the first run when it is still ahead');
    assert.strictEqual(alignedNext(1000, 10, 1000), 1000 + 10 * MIN, 'exactly at the anchor: the next one');
    assert.strictEqual(alignedNext(1000, 10, 1000 + 25 * MIN), 1000 + 30 * MIN);
    const h = harness({ pausedAll: false, schedules: [] });
    h.sch.start();
    const first = h.now + 2 * 60 * MIN; // "08:30", two hours from now
    const r = h.sch.save({ folder: '/w', prompt: 'start my day', every: 720, at: first }, () => true);
    assert.ok(r.ok);
    assert.strictEqual(r.ok && r.schedule.next, first, 'first run at the chosen time, not now + 24 h');
    assert.strictEqual(r.ok && r.schedule.at, first, 'the anchor is kept');
    await h.advance(2 * 60 * MIN);
    assert.deepStrictEqual(h.sent, ['/w:start my day']);
    assert.strictEqual(h.sch.doc.schedules[0].next, first + DAY, 'the next anchored time');
    h.busy.add('/w');
    await h.advance(DAY + 3 * MIN); // the tick runs a little late
    assert.strictEqual(h.sch.doc.schedules[0].last?.outcome, 'skipped-busy');
    assert.strictEqual(h.sch.doc.schedules[0].next, first + 2 * DAY, 'a skipped run keeps the time of day');
    h.busy.delete('/w');
    // the app was closed for two and a half days: missed, and the next run is still at the same time of day
    const doc = { pausedAll: false, schedules: [{ ...h.sch.doc.schedules[0] }] };
    const h2 = harness(doc, first + 4 * DAY + 5 * 60 * MIN);
    h2.sch.start();
    assert.strictEqual(h2.sch.doc.schedules[0].last?.outcome, 'missed');
    assert.strictEqual(h2.sch.doc.schedules[0].next, first + 5 * DAY, 'continues at the next 08:30, not now + 24 h');
    // resume after pause all keeps the time of day too
    h2.sch.setPausedAll(true);
    await h2.advance(DAY);
    h2.sch.setPausedAll(false);
    assert.strictEqual((h2.sch.doc.schedules[0].next! - first) % DAY, 0, 'still at the same time of day');
    // a plain interval still counts from now (unchanged)
    const plain = cleanSchedule({ folder: '/w', prompt: 'x', every: 60 }, now);
    assert.strictEqual(plain?.next, now + 60 * MIN);
    assert.strictEqual(plain?.at, undefined);
  }
  // FR-006: the starter kit (pure data): every template is valid, read-only friendly and says what it needs
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const T = require(require('path').join(__dirname, '..', '..', 'src', 'renderer', 'schedtemplates.js')) as { TEMPLATES: Array<{ id: string; name: string; prompt: string; daily?: string; every?: number; needs: string; decides?: boolean }>; byId: (id: string) => unknown; nextDaily: (h: string, now: number) => number | undefined };
    assert.ok(T.TEMPLATES.length >= 4);
    assert.ok(T.byId('start-my-day'), 'the morning briefing of issue #128 is a template');
    assert.ok(T.byId('summarize-my-day'));
    for (const t of T.TEMPLATES) {
      assert.ok(t.prompt.length > 50 && t.prompt.length <= 2000, `${t.id}: prompt fits the 2,000-character limit`);
      assert.ok(/data, never as instructions/.test(t.prompt), `${t.id}: the untrusted-data rule`);
      assert.ok(/Do not (send|install|merge)/.test(t.prompt), `${t.id}: says what it must not do`);
      assert.ok(t.needs.length > 0, `${t.id}: says what it needs`);
      assert.ok((t.daily && /^\d\d:\d\d$/.test(t.daily)) || (t.every && t.every >= 5 && t.every <= 1440), `${t.id}: a valid when`);
      assert.ok(cleanSchedule({ folder: '/w', prompt: t.prompt, every: t.every ?? 1440, ...(t.daily ? { at: now + MIN } : {}) }, now), `${t.id}: a valid schedule`);
    }
    // FR-008: briefing and planning templates end with a decision asked through the question tool, with a plain-text fallback
    for (const id of ['start-my-day', 'summarize-my-day', 'plan-my-day']) {
      const t = T.byId(id) as { prompt: string; decides?: boolean };
      assert.ok(t.decides && /ask me with your tool for asking the user/.test(t.prompt) && /If you have no such tool/.test(t.prompt), `${id}: decision step`);
    }
    const base = new Date(2026, 9, 19, 9, 0, 0, 0).getTime(); // 19 Oct 2026, 09:00 local
    assert.strictEqual(new Date(T.nextDaily('08:30', base)!).getDate(), 20, '08:30 has passed: tomorrow');
    assert.strictEqual(new Date(T.nextDaily('18:00', base)!).getHours(), 18, 'later today');
    assert.strictEqual(T.nextDaily('25:00', base), undefined);
    assert.strictEqual(T.nextDaily('', base), undefined);
  }
  await phase2();
  console.log('schedules tests passed');
}
/** Phase 2 (FR-013..FR-015, FR-017): migration, validation, a schedule for one session, a per-schedule limit. */
async function phase2(): Promise<void> {
  const now = 1_000_000_000_000;
  // FR-013: an old "every day at" (every 1440 + at) is read as a daily rule at the local time of `at`; its saved next run is kept
  {
    const at = new Date(2026, 9, 19, 8, 30).getTime();
    const old = cleanSchedule({ id: 'aaaaaaaa-old', folder: '/w', prompt: 'x', every: 1440, at, next: at + 86_400_000 }, now);
    assert.deepStrictEqual(old?.rule, { kind: 'daily', time: '08:30' });
    assert.strictEqual(old?.every, undefined, 'no 24 h interval any more');
    assert.strictEqual(old?.next, at + 86_400_000, 'the saved next run is kept');
    const p = parseSchedules(JSON.stringify({ schedules: [{ id: 'aaaaaaaa-p1', folder: '/w', prompt: 'plain', every: 30, next: now + 5 }, { id: 'aaaaaaaa-p2', folder: '/w', prompt: 'old daily', every: 1440, at }] }), now);
    assert.deepStrictEqual(p.schedules.map((x) => [x.every, x.rule?.kind]), [[30, undefined], [undefined, 'daily']], 'Phase 1 files load; missing Phase 2 fields are defaults');
    assert.strictEqual(p.schedules[0].target, undefined);
    assert.strictEqual(p.schedules[0].cap, undefined);
  }
  // FR-017: validation of the new fields (a bad value drops the schedule; main's own fields never come from the renderer)
  {
    const ok = { folder: '/w', prompt: 'x', rule: { kind: 'weekly', time: '17:00', days: [4, 1, 1, 9] } };
    assert.deepStrictEqual(cleanSchedule(ok, now)?.rule, { kind: 'weekly', time: '17:00', days: [1, 4] }, 'days sorted, unique, in range');
    assert.strictEqual(cleanSchedule({ ...ok, rule: { kind: 'weekly', time: '17:00', days: [] } }, now), undefined, 'weekly needs a day');
    assert.strictEqual(cleanSchedule({ ...ok, rule: { kind: 'monthly', time: '17:00' } }, now), undefined);
    assert.strictEqual(cleanSchedule({ ...ok, rule: { kind: 'daily', time: '24:00' } }, now), undefined);
    assert.strictEqual(cleanSchedule({ ...ok, rule: 'daily' }, now), undefined);
    assert.strictEqual(cleanSchedule({ ...ok, target: { session: 'a b', agent: 'copilot' } }, now), undefined, 'a bad session id');
    assert.strictEqual(cleanSchedule({ ...ok, target: { session: 's1', agent: '../x' } }, now), undefined, 'a bad agent id');
    assert.strictEqual(cleanSchedule({ ...ok, target: { session: 's1', agent: 'copilot', name: 'a\nb\u2028c'.padEnd(200, 'z') } }, now)?.target?.name?.length, 80, 'one line, at most 80 characters');
    assert.ok(!/[\n\u2028]/.test(cleanSchedule({ ...ok, target: { session: 's1', agent: 'copilot', name: 'a\nb\u2028c' } }, now)?.target?.name ?? ''));
    assert.strictEqual(cleanSchedule({ ...ok, target: null }, now)?.target, undefined, 'null target = the folder\'s agent');
    assert.strictEqual(cleanSchedule({ ...ok, cap: { amount: 0, unit: 'aiu' } }, now), undefined, 'a zero limit');
    assert.strictEqual(cleanSchedule({ ...ok, cap: { amount: 5, unit: 'eur' } }, now), undefined, 'an unknown unit');
    assert.strictEqual(cleanSchedule({ ...ok, cap: { amount: 20_000, unit: 'usd' } }, now), undefined, 'over the dollar range');
    assert.deepStrictEqual(cleanSchedule({ ...ok, cap: { amount: 1.234, unit: 'usd' } }, now)?.cap, { amount: 1.23, unit: 'usd' });
    const h = harness({ pausedAll: false, schedules: [] });
    h.sch.start();
    const r = h.sch.save({ ...ok, cap: { amount: 5, unit: 'aiu' }, spent: -3, spentUnknown: true, pausedReason: 'cap' }, () => true);
    assert.ok(r.ok && r.schedule.spent === undefined && !r.schedule.spentUnknown && !r.schedule.pausedReason, 'spent and the pause reason are main\'s own');
    h.unit.v = undefined;
    assert.ok(!h.sch.save({ ...ok, cap: { amount: 5, unit: 'aiu' } }, () => true).ok, 'no limit when the agent app reports no spending');
    h.unit.v = 'usd';
    const u = h.sch.save({ ...ok, cap: { amount: 5, unit: 'aiu' } }, () => true);
    assert.ok(u.ok && u.schedule.cap?.unit === 'usd', 'the unit is the agent app\'s, not the renderer\'s');
    h.unit.v = 'usd';
    assert.ok(!h.sch.save({ ...ok, cap: { amount: 50_000, unit: 'aiu' } }, () => true).ok, 're-checked in the agent app\'s unit');
    assert.ok(!h.sch.save(null, () => true).ok);
  }
  // FR-014: a schedule for one session: busy is that session's; when the session is gone it pauses and is never sent elsewhere
  {
    const h = harness({ pausedAll: false, schedules: [] });
    h.sch.start();
    assert.ok(!h.sch.save({ folder: '/w', prompt: 'x', every: 10, target: { session: 'gone', agent: 'copilot' } }, () => true).ok, 'an ended session is refused');
    const r = h.sch.save({ folder: '/w', prompt: 'mine', every: 10, target: { session: 's1', agent: 'copilot', name: 'Fix the tests' } }, () => true);
    assert.ok(r.ok);
    h.busy.add('/w'); // the folder's first agent is busy, the target is not
    await h.advance(10 * MIN);
    assert.deepStrictEqual(h.sent, ['/w:mine'], 'only the target session counts as busy');
    h.busy.delete('/w');
    h.busy.add('s1');
    await h.advance(10 * MIN);
    assert.strictEqual(h.sch.doc.schedules[0].last?.outcome, 'skipped-busy');
    h.busy.delete('s1');
    // the session ends while the app runs: paused at once with the reason
    h.sessions.delete('s1');
    h.sch.sessionsChanged();
    assert.deepStrictEqual([h.sch.doc.schedules[0].paused, h.sch.doc.schedules[0].pausedReason], [true, 'session-ended']);
    await h.advance(60 * MIN);
    assert.strictEqual(h.sent.length, 1, 'nothing is sent to another session');
    const s = h.sch.doc.schedules[0];
    assert.ok(!h.sch.save({ ...s, paused: false }, () => true).ok, 'Resume is refused while the session is gone');
    assert.ok(h.sch.save({ ...s, paused: true }, () => true).ok, 'it can still be saved paused');
    assert.strictEqual(h.sch.doc.schedules[0].pausedReason, 'session-ended', 'the reason stays');
    const moved = h.sch.save({ ...s, target: null, paused: false }, () => true);
    assert.ok(moved.ok && !moved.schedule.target && !moved.schedule.paused && !moved.schedule.pausedReason, 'Use the folder\'s agent');
    await h.advance(10 * MIN);
    assert.strictEqual(h.sent.length, 2);
    // at a due run the session is gone (no sessionsChanged call): recorded and paused
    const t = h.sch.save({ folder: '/w', prompt: 'other', at: h.now + 5 * MIN, target: { session: 's2', agent: 'claude' } }, () => true);
    assert.ok(t.ok);
    h.sessions.delete('s2');
    await h.advance(5 * MIN);
    const ts = h.sch.doc.schedules.find((x) => x.prompt === 'other');
    assert.deepStrictEqual([ts?.last?.outcome, ts?.paused, ts?.pausedReason, ts?.done], ['skipped-ended', true, 'session-ended', undefined]);
    // at start: a schedule whose session did not come back pauses
    const doc: SchedulesDoc = { pausedAll: false, schedules: [{ id: 'aaaaaaaa-st', folder: '/w', prompt: 'p', every: 10, next: now + MIN, target: { session: 'old', agent: 'copilot' } }] };
    const h2 = harness(doc, now);
    h2.sch.start();
    assert.deepStrictEqual([h2.sch.doc.schedules[0].paused, h2.sch.doc.schedules[0].pausedReason], [true, 'session-ended']);
  }
  // FR-015: a per-schedule limit: usage between the scheduled send and the turn's end counts; at the limit the run is skipped and it pauses
  {
    const h = harness({ pausedAll: false, schedules: [] });
    h.sch.start();
    const r = h.sch.save({ folder: '/w', prompt: 'costly', every: 10, cap: { amount: 1, unit: 'aiu' }, target: { session: 's1', agent: 'copilot' } }, () => true);
    assert.ok(r.ok);
    h.sch.noteUsage('s1', { nanoAiu: 9e9 });
    assert.strictEqual(h.sch.doc.schedules[0].spent, undefined, 'usage before any scheduled run is not counted');
    await h.advance(10 * MIN);
    assert.strictEqual(h.sent.length, 1);
    h.sch.noteUsage('s2', { nanoAiu: 9e9 });
    h.sch.noteUsage('s1', { nanoAiu: 6e8 });
    h.sch.noteUsage('s1', { nanoAiu: 5e8, costUsd: 99 });
    assert.ok(Math.abs((h.sch.doc.schedules[0].spent ?? 0) - 1.1) < 1e-9, 'AIU from nano-AIU; other sessions do not count');
    h.sch.turnEnded('s1');
    h.sch.noteUsage('s1', { nanoAiu: 9e9 });
    assert.ok(Math.abs((h.sch.doc.schedules[0].spent ?? 0) - 1.1) < 1e-9, 'after the turn ends, usage is the user\'s again');
    await h.advance(10 * MIN);
    const s = h.sch.doc.schedules[0];
    assert.deepStrictEqual([h.sent.length, s.last?.outcome, s.paused, s.pausedReason], [1, 'skipped-cap', true, 'cap'], 'Paused: reached its limit');
    await h.advance(60 * MIN);
    assert.strictEqual(h.sent.length, 1, 'stays paused');
    assert.ok(h.sch.save({ ...s, paused: true }, () => true).ok);
    assert.ok(Math.abs((h.sch.doc.schedules[0].spent ?? 0) - 1.1) < 1e-9, 'an edit keeps the spend');
    const res = h.sch.save({ ...h.sch.doc.schedules[0], paused: false }, () => true);
    assert.ok(res.ok && res.schedule.spent === undefined && !res.schedule.pausedReason, 'Resume counts from zero');
    await h.advance(10 * MIN);
    assert.strictEqual(h.sent.length, 2, 'runs again');
    h.sch.noteUsage('s1', { creditsStatus: 'unavailable' } as never);
    assert.strictEqual(h.sch.doc.schedules[0].spentUnknown, true, 'a usage event without a figure: the spend is a lower bound');
    // dollars: from costUsd only
    const d = harness({ pausedAll: false, schedules: [] });
    d.unit.v = 'usd';
    d.sch.start();
    d.sch.save({ folder: '/w', prompt: 'usd', every: 10, cap: { amount: 0.05, unit: 'usd' } }, () => true);
    await d.advance(10 * MIN);
    d.sch.noteUsage('folder-agent', { costUsd: 0.03, nanoAiu: 9e9 });
    d.sch.noteUsage('folder-agent', { costUsd: 0.03 });
    assert.ok(Math.abs((d.sch.doc.schedules[0].spent ?? 0) - 0.06) < 1e-9);
    d.sch.turnEnded('folder-agent');
    await d.advance(10 * MIN);
    assert.strictEqual(d.sch.doc.schedules[0].pausedReason, 'cap');
    // the spend is saved with the schedule and read back
    const back = parseSchedules(JSON.stringify(d.sch.doc), d.now);
    assert.ok(Math.abs((back.schedules[0].spent ?? 0) - 0.06) < 1e-9 && back.schedules[0].pausedReason === 'cap');
  }

  // spec 052 FR-089: Run missed now sends once through the same path; the plan is unchanged; refusals send nothing
  {
    const t0 = 1_000_000_000_000;
    const h = harness({ pausedAll: false, schedules: [
      { id: 'once-1', folder: '/w', prompt: 'standup', at: t0 - 3 * 60 * MIN },
      { id: 'every-1', folder: '/w', prompt: 'digest', every: 60, next: t0 - 2 * 60 * MIN },
      { id: 'tgt-1', folder: '/w', prompt: 'gone', every: 60, next: t0 + 60 * MIN, target: { session: 'old', agent: 'Old' } },
    ] }, t0);
    h.sessions.add('old');
    h.sch.start();
    assert.deepStrictEqual(h.sch.doc.schedules.slice(0, 2).map((s) => s.last?.outcome), ['missed', 'missed']);
    const nextBefore = h.sch.doc.schedules[1].next;
    assert.deepStrictEqual(await h.sch.runNow('once-1'), { ok: true });
    assert.deepStrictEqual(h.sent, ['/w:standup']);
    assert.strictEqual(h.sch.doc.schedules[0].done, true, 'a one-time schedule stays done');
    assert.strictEqual(h.sch.doc.schedules[0].last?.outcome, 'sent');
    assert.deepStrictEqual(await h.sch.runNow('every-1'), { ok: true });
    assert.strictEqual(h.sch.doc.schedules[1].next, nextBefore, 'the next planned run is unchanged');
    assert.deepStrictEqual(await h.sch.runNow('nope'), { ok: false, error: 'That schedule is gone.' });
    assert.strictEqual((await h.sch.runNow(5)).ok, false, 'a non-string id is refused');
    h.busy.add('/w');
    assert.deepStrictEqual(await h.sch.runNow('every-1'), { ok: false, error: 'The agent is busy. Try again when it is free.' });
    h.busy.delete('/w');
    h.sch.setPausedAll(true);
    assert.strictEqual((await h.sch.runNow('every-1')).ok, false, 'Pause all is respected');
    h.sch.setPausedAll(false);
    h.sessions.delete('old');
    assert.deepStrictEqual(await h.sch.runNow('tgt-1'), { ok: false, error: 'That session has ended.' });
    assert.strictEqual(h.sent.length, 2, 'refusals send nothing');
  }

  // spec 044 FR-023: edit a schedule through save({ edit: true })
  {
    const t0 = 1_000_000_000_000;
    const base = (id: string, extra: Partial<Schedule> = {}): Schedule => ({ id, folder: '/w', prompt: 'old', every: 60, next: t0 + 60 * MIN, ...extra });
    const h = harness({ pausedAll: false, schedules: [
      base('edit-iv-001', { last: { at: t0 - MIN, outcome: 'sent' }, cap: { amount: 5, unit: 'aiu' }, spent: 1.5 }),
      base('edit-pa-001', { paused: true, pausedReason: 'session-ended', target: { session: 's1', agent: 'copilot' } }),
      { id: 'edit-once-1', folder: '/w', prompt: 'once', at: t0 + 10 * MIN },
      { id: 'edit-pone-1', folder: '/w', prompt: 'pone', at: t0 - 10 * MIN, paused: true },
      { id: 'edit-done-1', folder: '/w', prompt: 'done', at: t0 - 10 * MIN, done: true, last: { at: t0 - 10 * MIN, outcome: 'sent' } },
    ] });
    const iv = (id: string) => h.sch.doc.schedules.find((s) => s.id === id)!;
    // interval: keeps id/last/spend, the renderer cannot set paused/done/last/spent/folder/next/pausedReason
    let r = h.sch.save({ id: 'edit-iv-001', edit: true, folder: '/other', prompt: 'new', every: 30, paused: true, done: true, last: { at: 1, outcome: 'failed' }, spent: 99, spentUnknown: true, next: 5, pausedReason: 'cap', cap: { amount: 7, unit: 'aiu' } }, () => true);
    assert.ok(r.ok);
    let s = iv('edit-iv-001');
    assert.deepStrictEqual([s.id, s.folder, s.prompt, s.every, s.paused, s.done, s.pausedReason], ['edit-iv-001', '/w', 'new', 30, undefined, undefined, undefined]);
    assert.deepStrictEqual(s.last, { at: t0 - MIN, outcome: 'sent' }, 'last is main\'s');
    assert.strictEqual(s.spent, 1.5, 'spend is kept in the same unit');
    assert.strictEqual(s.spentUnknown, undefined);
    assert.deepStrictEqual(s.cap, { amount: 7, unit: 'aiu' });
    assert.strictEqual(s.next, t0 + 30 * MIN, 'next follows the new interval');
    assert.strictEqual(h.sch.doc.schedules.length, 5, 'same list, same order');
    assert.strictEqual(h.sch.doc.schedules[0].id, 'edit-iv-001');
    // another unit: the spend starts again
    h.unit.v = 'usd';
    assert.ok(h.sch.save({ id: 'edit-iv-001', edit: true, folder: '/w', prompt: 'new', every: 30, cap: { amount: 2, unit: 'usd' } }, () => true).ok);
    assert.strictEqual(iv('edit-iv-001').spent, undefined, 'a different unit drops the spend');
    h.unit.v = 'aiu';
    // rule: next from the rule
    assert.ok(h.sch.save({ id: 'edit-iv-001', edit: true, folder: '/w', prompt: 'new', rule: { kind: 'weekdays', time: '09:00' } }, () => true).ok);
    s = iv('edit-iv-001');
    assert.deepStrictEqual([s.rule?.kind, s.every], ['weekdays', undefined]);
    assert.ok(s.next !== undefined && s.next > t0 && s.next !== t0 + 30 * MIN, 'next moved to the rule');
    // paused: stays paused with its reason, next computed again
    r = h.sch.save({ id: 'edit-pa-001', edit: true, folder: '/w', prompt: 'p2', every: 15, target: { session: 's1', agent: 'copilot' } }, () => true);
    assert.ok(r.ok);
    s = iv('edit-pa-001');
    assert.deepStrictEqual([s.paused, s.pausedReason, s.next, s.prompt], [true, 'session-ended', t0 + 15 * MIN, 'p2']);
    // once: a changed past time is refused and nothing changes; a future one moves
    const before = JSON.stringify(h.sch.doc);
    assert.deepStrictEqual(h.sch.save({ id: 'edit-once-1', edit: true, folder: '/w', prompt: 'once', at: t0 - MIN }, () => true), { ok: false, error: 'That time has already passed.' });
    assert.deepStrictEqual(h.sch.save({ id: 'edit-pone-1', edit: true, folder: '/w', prompt: 'pone', at: t0 - 5 * MIN }, () => true), { ok: false, error: 'That time has already passed.' });
    assert.strictEqual(JSON.stringify(h.sch.doc), before, 'a refused edit changes nothing');
    assert.ok(h.sch.save({ id: 'edit-once-1', edit: true, folder: '/w', prompt: 'once2', at: t0 + 20 * MIN }, () => true).ok);
    assert.strictEqual(iv('edit-once-1').at, t0 + 20 * MIN);
    // a paused one-time schedule whose time is unchanged (past) can be edited
    assert.ok(h.sch.save({ id: 'edit-pone-1', edit: true, folder: '/w', prompt: 'pone2', at: t0 - 10 * MIN }, () => true).ok);
    assert.deepStrictEqual([iv('edit-pone-1').prompt, iv('edit-pone-1').paused, iv('edit-pone-1').at], ['pone2', true, t0 - 10 * MIN]);
    // done (owner Q2): needs a future time, then it runs again and keeps last
    assert.deepStrictEqual(h.sch.save({ id: 'edit-done-1', edit: true, folder: '/w', prompt: 'done', at: t0 - 10 * MIN }, () => true), { ok: false, error: 'Pick a time in the future to run it again.' });
    assert.strictEqual(iv('edit-done-1').done, true);
    assert.ok(h.sch.save({ id: 'edit-done-1', edit: true, folder: '/w', prompt: 'again', at: t0 + 5 * MIN }, () => true).ok);
    s = iv('edit-done-1');
    assert.deepStrictEqual([s.done, s.last?.outcome], [undefined, 'sent']);
    assert.strictEqual(dueAt(s), t0 + 5 * MIN);
    assert.ok(h.sch.save({ id: 'edit-done-1', edit: true, folder: '/w', prompt: 'again', every: 20 }, () => true).ok, 'a done schedule may become an interval');
    // unknown id: refused with and without edit, nothing added
    const n = h.sch.doc.schedules.length;
    assert.deepStrictEqual(h.sch.save({ id: 'nope-nope-1', edit: true, folder: '/w', prompt: 'x', every: 10 }, () => true), { ok: false, error: 'That schedule is gone.' });
    assert.deepStrictEqual(h.sch.save({ id: 'nope-nope-1', folder: '/w', prompt: 'x', every: 10 }, () => true), { ok: false, error: 'That schedule is gone.' });
    assert.deepStrictEqual(h.sch.save({ edit: true, folder: '/w', prompt: 'x', every: 10 }, () => true), { ok: false, error: 'That schedule is gone.' });
    assert.strictEqual(h.sch.doc.schedules.length, n);
    // the same checks as a new schedule (prompt, interval)
    assert.ok(!h.sch.save({ id: 'edit-iv-001', edit: true, folder: '/w', prompt: '  ', every: 30 }, () => true).ok);
    assert.ok(!h.sch.save({ id: 'edit-iv-001', edit: true, folder: '/w', prompt: 'x', every: 2 }, () => true).ok);
    assert.strictEqual(iv('edit-iv-001').rule?.kind, 'weekdays');
  }
  // an edit at 50 schedules passes; a new one does not
  {
    const h = harness({ pausedAll: false, schedules: Array.from({ length: 50 }, (_, i) => ({ id: `full-sched-${i}`, folder: '/w', prompt: 'p', every: 60, next: 1_000_000_000_000 + 60 * MIN }) as Schedule) });
    assert.ok(h.sch.save({ id: 'full-sched-3', edit: true, folder: '/w', prompt: 'edited', every: 45 }, () => true).ok);
    assert.strictEqual(h.sch.doc.schedules.length, 50);
    assert.ok(!h.sch.save({ folder: '/w', prompt: 'new', every: 45 }, () => true).ok);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
