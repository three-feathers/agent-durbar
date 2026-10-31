/**
 * Spec 044 FR-180..FR-184 (T140..T143): a schedule's own mode. A real Scheduler with a fake clock, the real RunModes on a FakeAdapter, the real
 * IPC module on a stand-in electron. Part of `npm run test:schedules`. No session, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { FakeAdapter } from '../src/adapters/fake';
import type { AgentAdapter } from '../src/adapters/types';
import { startGuardOp, startModeOf } from '../src/main/agentops';
import { RunModes, modeCheckOp } from '../src/main/schedmode';
import { MODE_PROOF_MS, Scheduler, cleanSchedule, loopSupport, parseMode, parseSchedules, waitingForMode } from '../src/main/schedules';
import type { ModeAgentInfo, ModeVerdict, Schedule, SchedulesDoc, SchedulerDeps } from '../src/main/schedules';
import type { AgentInfo, PermMode } from '../src/shared/api';

const MIN = 60_000;
const T0 = 1_000_000_000_000;
const WHO: ModeAgentInfo = { app: 'copilot', appName: 'GitHub Copilot', agent: 'Ada', folderName: 'proj' };
process.exitCode = 1; // a promise that never settles must not look like a pass; set to 0 at the end

function harness(doc: SchedulesDoc = { pausedAll: false, schedules: [] }, extra: Partial<SchedulerDeps> = {}) {
  let now = T0;
  const sent: string[] = [];
  const check: { v: ModeVerdict } = { v: undefined };
  const held: string[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  const sch = new Scheduler(doc, {
    now: () => now,
    mono: () => now,
    isBusy: () => false,
    hasSession: () => true,
    capUnitOf: () => 'aiu',
    send: async (_f, p, s) => (sent.push(`${p}@${s.mode}`), s.target ? s.target.session : 'agent-1'),
    modeCheck: () => check.v,
    modeAgent: () => WHO,
    orgWords: () => 'Your organization blocks Allow all (the policy words).',
    setTimer: (ms, fn) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t as never); if (i >= 0) timers.splice(i, 1); },
    save: () => undefined,
    ...extra,
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
  return { sch, sent, check, held, advance, get now() { return now; } };
}
const stored = (o: Record<string, unknown>): Schedule => cleanSchedule({ id: 'sched-0001', folder: '/w', prompt: 'p', every: 30, next: T0 + 30 * MIN, ...o }, T0) as Schedule;
const FOR = { app: 'copilot' };
const addAllow = (h: ReturnType<typeof harness>, o: Record<string, unknown> = {}): Schedule => {
  const q = { folder: '/w', prompt: 'nightly', every: 30, ...o };
  const a = h.sch.askMode({ ...q, mode: 'allow' });
  assert.ok(a.ok && a.needed);
  const r = h.sch.save({ ...q, mode: 'allow', modeProof: (a as { token: string }).token }, () => true);
  assert.ok(r.ok, JSON.stringify(r));
  return (r as { schedule: Schedule }).schedule;
};

async function main(): Promise<void> {
  // ---- FR-181: a missing or unknown stored mode: kept, no mode, never Read-only ----
  for (const bad of [undefined, null, '', 'turbo', 'READ-ONLY', 'Read-only', 'readonly', 'allow ', 0, 1, true, {}, [], ['ask'], '__proto__', 'constructor', 'toString']) {
    assert.strictEqual(parseMode(bad), undefined, `not a mode: ${JSON.stringify(bad)}`);
    const s = stored({ mode: bad, modeFor: FOR });
    assert.ok(s, `the schedule stays: ${JSON.stringify(bad)}`);
    assert.strictEqual(s.mode, undefined, `no mode, not Read-only: ${JSON.stringify(bad)}`);
    assert.ok(waitingForMode(s));
  }
  for (const m of ['read-only', 'ask', 'allow'] as const) {
    assert.strictEqual(stored({ mode: m, modeFor: FOR }).mode, m);
    assert.strictEqual(stored({ mode: m }).mode, undefined, 'a mode with no agent it was chosen for is no mode');
    assert.strictEqual(stored({ mode: m, modeFor: { app: 'bad app!' } }).mode, undefined, 'a bad agent is no agent');
  }
  // `parseSchedules` keeps a whole file's waiting schedules
  {
    const d = parseSchedules(JSON.stringify({ pausedAll: false, schedules: [{ id: 'sched-a001', folder: '/w', prompt: 'old', every: 30 }, { id: 'sched-a002', folder: '/w', prompt: 'odd', every: 30, mode: 'future-mode', modeFor: FOR }] }), T0);
    assert.deepStrictEqual(d.schedules.map((s) => [s.id, s.mode]), [['sched-a001', undefined], ['sched-a002', undefined]]);
  }

  // never sends, nothing deleted, `skipped-mode` at each due time, folded (FR-037), the next time still planned
  for (const raw of [{}, { mode: 'turbo', modeFor: FOR }, { mode: 7, modeFor: FOR }]) {
    const h = harness({ pausedAll: false, schedules: [stored(raw)] });
    h.sch.start();
    await h.advance(30 * MIN);
    await h.advance(30 * MIN);
    await h.advance(30 * MIN);
    assert.deepStrictEqual(h.sent, [], 'never sent');
    const s = h.sch.doc.schedules[0];
    assert.ok(s && !s.done && !s.paused, 'nothing deleted, finished or paused');
    assert.deepStrictEqual(s.last && [s.last.outcome, s.last.reason], ['skipped-mode', 'no-mode']);
    const runs = h.sch.runsOf(s.id);
    assert.deepStrictEqual(runs.map((r) => [r.outcome, r.reason, r.n]), [['skipped-mode', 'no-mode', 3]], 'one folded entry per reason');
    assert.strictEqual(s.next, h.now + 30 * MIN, 'an interval waits for its next time');
  }
  // a once schedule whose time passes with no mode: finished with that word, kept, still "waiting", offered the choice; choosing does not send
  {
    const h = harness({ pausedAll: false, schedules: [cleanSchedule({ id: 'sched-once', folder: '/w', prompt: 'once', at: T0 + MIN }, T0) as Schedule] });
    h.sch.start();
    await h.advance(2 * MIN);
    const s = h.sch.doc.schedules[0];
    assert.deepStrictEqual([h.sent, s.done, s.last?.outcome, waitingForMode(s)], [[], true, 'skipped-mode', true]);
    const r = h.sch.setMode(s.id, 'ask');
    assert.ok(r.ok);
    await h.advance(60 * MIN);
    assert.deepStrictEqual(h.sent, [], 'choosing a mode does not send');
    assert.strictEqual(waitingForMode(h.sch.doc.schedules[0]), false);
    assert.deepStrictEqual(await h.sch.runNow(s.id), { ok: true }, 'Run missed now works once it has a mode');
    assert.deepStrictEqual(h.sent, ['once@ask']);
  }
  // an old finished schedule asks for nothing
  assert.strictEqual(waitingForMode(cleanSchedule({ id: 'sched-old1', folder: '/w', prompt: 'x', at: T0 - MIN, done: true, last: { at: T0 - MIN, outcome: 'sent' } }, T0) as Schedule), false);
  // at start: a time passed while closed says the same word, not "missed" (and nothing is sent)
  {
    const h = harness({ pausedAll: false, schedules: [cleanSchedule({ id: 'sched-st01', folder: '/w', prompt: 'x', at: T0 - 5 * MIN }, T0) as Schedule, stored({ id: 'sched-st02', next: T0 - 5 * MIN })] });
    h.sch.start();
    assert.deepStrictEqual(h.sch.doc.schedules.map((s) => s.last?.outcome), ['skipped-mode', 'skipped-mode']);
    assert.deepStrictEqual(h.sent, []);
  }
  // Pause all and a closed door come as they did: paused says so, and a schedule with no mode is never queued at a door
  {
    const queued: string[] = [];
    const h = harness({ pausedAll: false, schedules: [stored({})] }, { hold: (s) => (queued.push(s.id), true) });
    h.sch.start();
    await h.advance(30 * MIN);
    assert.deepStrictEqual(queued, [], 'not queued at a door');
    assert.strictEqual(h.sch.doc.schedules[0].last?.outcome, 'skipped-mode');
    h.sch.setPausedAll(true);
    await h.advance(30 * MIN);
    assert.strictEqual(h.sch.doc.schedules[0].last?.outcome, 'skipped-paused');
  }
  // every other way out checks it too
  {
    const h = harness({ pausedAll: false, schedules: [stored({})] });
    const r = await h.sch.runNow('sched-0001');
    assert.ok(!r.ok && /Choose a mode/.test(r.error), 'Run now is no choice of a mode');
    assert.strictEqual(await h.sch.releaseDoorRun('sched-0001', 'p'), 'mode', 'a released run stays held');
    assert.deepStrictEqual(h.sent, []);
  }

  // ---- FR-180: a new schedule must have a mode; it runs with it ----
  {
    const h = harness();
    for (const bad of [undefined, 'turbo', '', null, 'READ-ONLY']) {
      const r = h.sch.save({ folder: '/w', prompt: 'x', every: 30, mode: bad }, () => true);
      assert.ok(!r.ok, `refused: ${JSON.stringify(bad)}`);
    }
    assert.strictEqual(h.sch.doc.schedules.length, 0);
    const r = h.sch.save({ folder: '/w', prompt: 'x', every: 30, mode: 'read-only' }, () => true);
    assert.ok(r.ok);
    assert.deepStrictEqual(r.schedule.modeFor, { app: 'copilot' }, 'main stores who it was chosen for');
    await h.advance(30 * MIN);
    assert.deepStrictEqual(h.sent, ['x@read-only']);
    // the renderer's identity is not read
    const forged = h.sch.save({ folder: '/w', prompt: 'y', every: 30, mode: 'ask', modeFor: { app: 'other', session: 'zzz' } }, () => true);
    assert.ok(forged.ok);
    assert.deepStrictEqual(forged.schedule.modeFor, { app: 'copilot' });
    // a target's session goes in its identity
    const t = h.sch.save({ folder: '/w', prompt: 'z', every: 30, mode: 'ask', target: { session: 's1', agent: 'copilot' } }, () => true);
    assert.ok(t.ok);
    assert.deepStrictEqual(t.schedule.modeFor, { app: 'copilot', session: 's1' });
    // no agent to choose for: refused for a mode that needs one
    const none = harness(undefined, { modeAgent: () => undefined });
    assert.ok(!none.sch.save({ folder: '/w', prompt: 'x', every: 30, mode: 'ask' }, () => true).ok);
  }

  // ---- FR-184 [KNOWN GAP until spec 099 T097]: Autopilot is parsed and kept, never sent, not settable ----
  {
    const h = harness({ pausedAll: false, schedules: [stored({ mode: 'autopilot' })] });
    h.sch.start();
    assert.strictEqual(h.sch.doc.schedules[0].mode, 'autopilot', 'parsed and kept, with or without an agent');
    assert.strictEqual(stored({ mode: 'autopilot', modeFor: FOR }).modeFor?.app, 'copilot');
    await h.advance(30 * MIN);
    await h.advance(30 * MIN);
    let s = h.sch.doc.schedules[0];
    assert.deepStrictEqual(h.sent, [], 'not sent');
    assert.deepStrictEqual(s.last && [s.last.outcome, s.last.reason], ['mode-refused', 'mode-autopilot'], 'a visible reason on the row');
    assert.strictEqual(s.mode, 'autopilot', 'kept after a refusal');
    assert.strictEqual(h.sch.runsOf(s.id)[0].n, 2);
    const again = await h.sch.runNow(s.id);
    assert.ok(!again.ok);
    // it survives a restart's parse, a Pause and a Resume
    const back = parseSchedules(JSON.stringify(h.sch.doc), h.now);
    assert.strictEqual(back.schedules[0].mode, 'autopilot');
    assert.ok(h.sch.save({ ...s, paused: true }, () => true).ok);
    assert.strictEqual(h.sch.doc.schedules[0].mode, 'autopilot', 'after Pause');
    s = h.sch.doc.schedules[0];
    assert.ok(h.sch.save({ ...s, paused: false }, () => true).ok);
    assert.strictEqual(h.sch.doc.schedules[0].mode, 'autopilot', 'after Resume');
    // an edit that changes only the time keeps it; prompt or target cannot be confirmed yet, and setting it new is refused
    s = h.sch.doc.schedules[0];
    assert.ok(h.sch.save({ id: s.id, edit: true, prompt: s.prompt, every: 45, mode: 'autopilot' }, () => true).ok);
    assert.strictEqual(h.sch.doc.schedules[0].mode, 'autopilot');
    assert.ok(!h.sch.save({ id: s.id, edit: true, prompt: 'changed', every: 45, mode: 'autopilot' }, () => true).ok);
    assert.ok(!h.sch.save({ id: s.id, edit: true, prompt: 'changed', every: 45 }, () => true).ok, 'no mode key keeps it, by the same rule');
    assert.strictEqual(h.sch.doc.schedules[0].prompt, s.prompt);
    const n = harness();
    assert.ok(!n.sch.save({ folder: '/w', prompt: 'x', every: 30, mode: 'autopilot' }, () => true).ok, 'not on a new schedule');
    const m = harness({ pausedAll: false, schedules: [stored({ mode: 'ask', modeFor: FOR })] });
    assert.ok(!m.sch.setMode('sched-0001', 'autopilot').ok, 'not by Choose a mode');
    assert.deepStrictEqual(m.sch.askMode({ id: 'sched-0001', mode: 'autopilot' }), { ok: true, needed: false });
    assert.ok(!m.sch.setMode('sched-0001', 'autopilot', 'anything').ok, 'and no token helps');
  }

  // ---- FR-182: Allow all goes through the confirmation path, or main refuses ----
  {
    const h = harness();
    const q = { folder: '/w', prompt: 'nightly', every: 30 };
    assert.ok(!h.sch.save({ ...q, mode: 'allow' }, () => true).ok, 'no proof');
    assert.ok(!h.sch.save({ ...q, mode: 'allow', modeProof: 'made-up' }, () => true).ok, 'a made-up proof');
    assert.strictEqual(h.sch.doc.schedules.length, 0);
    const a = h.sch.askMode({ ...q, mode: 'allow' });
    assert.ok(a.ok && a.needed);
    if (a.ok && a.needed) {
      for (const word of ['nightly', 'Ada', 'GitHub Copilot', 'proj', 'Allow all']) assert.ok(a.body.includes(word), `the confirmation names ${word}: ${a.body}`);
      // proof for another question: another prompt, target, mode or folder
      assert.ok(!h.sch.save({ ...q, prompt: 'nightly, and delete things', mode: 'allow', modeProof: a.token }, () => true).ok, 'other prompt');
      assert.ok(!h.sch.save({ ...q, mode: 'allow', target: { session: 's1', agent: 'copilot' }, modeProof: a.token }, () => true).ok, 'other target');
      assert.ok(!h.sch.save({ ...q, folder: '/other', mode: 'allow', modeProof: a.token }, () => true).ok, 'other folder');
      // a wrong question did not use it up; the right one does, once
      const ok = h.sch.save({ ...q, mode: 'allow', modeProof: a.token }, () => true);
      assert.ok(ok.ok, 'the question it was asked for');
      assert.ok(!h.sch.save({ ...q, prompt: 'nightly', mode: 'allow', modeProof: a.token }, () => true).ok, 'one time only');
      assert.ok(ok.ok && !('modeProof' in ok.schedule), 'a token is never stored');
    }
    // it runs on the mode it was confirmed for
    await h.advance(30 * MIN);
    assert.deepStrictEqual(h.sent, ['nightly@allow']);
    // an old token runs out
    const old = h.sch.askMode({ folder: '/w', prompt: 'late', every: 30, mode: 'allow' });
    await h.advance(MODE_PROOF_MS + 1);
    assert.ok(old.ok && old.needed && !h.sch.save({ folder: '/w', prompt: 'late', every: 30, mode: 'allow', modeProof: old.token }, () => true).ok, 'expired');
    // read-only and ask need no confirmation (nothing runs without asking)
    assert.deepStrictEqual(h.sch.askMode({ ...q, mode: 'ask' }), { ok: true, needed: false });
  }
  // asked again on any edit of prompt, target or mode; not on one of time
  {
    const h = harness();
    const s = addAllow(h);
    const edit = (o: Record<string, unknown>): ReturnType<typeof h.sch.save> => h.sch.save({ id: s.id, edit: true, prompt: 'nightly', every: 30, mode: 'allow', ...o }, () => true);
    assert.ok(edit({ every: 60 }).ok, 'only the time changed');
    assert.deepStrictEqual(h.sch.askMode({ id: s.id, prompt: 'nightly', mode: 'allow' }), { ok: true, needed: false }, 'main says no question is due');
    assert.ok(!edit({ prompt: 'nightly 2' }).ok, 'the prompt changed');
    assert.ok(!edit({ target: { session: 's1', agent: 'copilot' } }).ok, 'the target changed');
    assert.strictEqual(h.sch.doc.schedules[0].prompt, 'nightly', 'a refused edit changes nothing');
    assert.strictEqual(h.sch.doc.schedules[0].target, undefined);
    // the mode changed: down needs nothing, back up asks again
    assert.ok(edit({ mode: 'ask' }).ok);
    assert.ok(!edit({ mode: 'allow' }).ok, 'raising it again');
    const a = h.sch.askMode({ id: s.id, prompt: 'nightly', target: null, mode: 'allow' });
    assert.ok(a.ok && a.needed);
    assert.ok(a.ok && a.needed && edit({ mode: 'allow', modeProof: a.token }).ok);
    // an edit with a new prompt and a proof for it
    const b = h.sch.askMode({ id: s.id, prompt: 'nightly 2', target: null, mode: 'allow' });
    assert.ok(b.ok && b.needed && edit({ prompt: 'nightly 2', modeProof: b.token }).ok);
  }
  // a save that is not an edit cannot raise a mode (Pause, Resume, retarget carry the whole schedule)
  {
    const h = harness();
    const r = h.sch.save({ folder: '/w', prompt: 'x', every: 30, mode: 'read-only' }, () => true);
    assert.ok(r.ok);
    const s = r.schedule;
    assert.ok(!h.sch.save({ ...s, mode: 'allow' }, () => true).ok, 'raising by a plain save is refused');
    assert.ok(!h.sch.save({ ...s, mode: 'autopilot' }, () => true).ok);
    assert.strictEqual(h.sch.doc.schedules[0].mode, 'read-only');
    assert.ok(h.sch.save({ ...s, paused: true }, () => true).ok, 'Pause keeps it');
    assert.strictEqual(h.sch.doc.schedules[0].mode, 'read-only');
    // setMode raises only with a proof, and sends nothing
    assert.ok(!h.sch.setMode(s.id, 'allow').ok);
    assert.ok(!h.sch.setMode(s.id, 'allow', 'made-up').ok);
    assert.strictEqual(h.sch.doc.schedules[0].mode, 'read-only');
    const a = h.sch.askMode({ id: s.id, mode: 'allow' });
    assert.ok(a.ok && a.needed && h.sch.setMode(s.id, 'allow', a.token).ok);
    assert.strictEqual(h.sch.doc.schedules[0].mode, 'allow');
    assert.deepStrictEqual(h.sent, []);
    // a non-edit save that moves it (*Use the folder's agent*), or changes its prompt: the choice was for the schedule as it was
    const cur = h.sch.doc.schedules[0];
    assert.ok(h.sch.save({ ...cur, prompt: 'something else' }, () => true).ok);
    assert.strictEqual(h.sch.doc.schedules[0].mode, undefined, 'back to waiting');
    assert.ok(waitingForMode(h.sch.doc.schedules[0]));
  }
  // an edit with no mode key keeps the mode, by the same re-ask rule
  {
    const h = harness();
    const s = addAllow(h);
    assert.ok(h.sch.save({ id: s.id, edit: true, prompt: 'nightly', every: 45 }, () => true).ok);
    assert.strictEqual(h.sch.doc.schedules[0].mode, 'allow');
    assert.ok(!h.sch.save({ id: s.id, edit: true, prompt: 'other', every: 45 }, () => true).ok, 'a new prompt without a confirmation');
  }
  // a stored Allow all whose agent changed between saves is asked for again
  {
    const who: { v: ModeAgentInfo } = { v: WHO };
    const h = harness(undefined, { modeAgent: () => who.v });
    const s = addAllow(h);
    who.v = { ...WHO, app: 'claude' };
    assert.ok(!h.sch.save({ id: s.id, edit: true, prompt: 'nightly', every: 30, mode: 'allow' }, () => true).ok, 'another app: asks again');
    const a = h.sch.askMode({ id: s.id, prompt: 'nightly', mode: 'allow' });
    assert.ok(a.ok && a.needed, 'and main says so');
  }

  // ---- FR-182: a run that would go to another agent is not sent and waits for a mode again; a later return does not bring it back ----
  {
    const h = harness();
    const s = addAllow(h);
    h.check.v = 'other-agent';
    await h.advance(30 * MIN);
    assert.deepStrictEqual(h.sent, []);
    let c = h.sch.doc.schedules.find((x) => x.id === s.id) as Schedule;
    assert.deepStrictEqual([c.last?.outcome, c.last?.reason, c.mode, c.modeFor, waitingForMode(c)], ['skipped-mode', 'other-agent', undefined, undefined, true]);
    h.check.v = undefined;
    await h.advance(30 * MIN);
    assert.deepStrictEqual(h.sent, [], 'the same agent back: still waiting');
    c = h.sch.doc.schedules.find((x) => x.id === s.id) as Schedule;
    assert.strictEqual(c.last?.reason, 'no-mode');
    // for every mode (coordinator choice, see the spec)
    const r = harness();
    const q = r.sch.save({ folder: '/w', prompt: 'x', every: 30, mode: 'read-only' }, () => true);
    assert.ok(q.ok);
    r.check.v = 'other-agent';
    await r.advance(30 * MIN);
    assert.deepStrictEqual(r.sent, []);
    assert.strictEqual(r.sch.doc.schedules[0].mode, undefined);
  }

  // ---- FR-183, FR-184: refused at a save and at each run; visible; the schedule stays ----
  {
    const h = harness();
    h.check.v = 'mode-org';
    const a = h.sch.save({ folder: '/w', prompt: 'x', every: 30, mode: 'ask' }, () => true);
    assert.ok(!a.ok && /policy words/.test(a.error), 'at a save, in the policy\'s own words');
    h.check.v = undefined;
    const r = h.sch.save({ folder: '/w', prompt: 'x', every: 30, mode: 'ask' }, () => true);
    assert.ok(r.ok);
    h.check.v = 'mode-org';
    assert.ok(!h.sch.setMode(r.schedule.id, 'read-only').ok, 'at Choose a mode');
    await h.advance(30 * MIN);
    assert.deepStrictEqual(h.sent, [], 'at a run');
    const s = h.sch.doc.schedules[0];
    assert.deepStrictEqual([s.last?.outcome, s.last?.reason, s.mode], ['mode-refused', 'mode-org', 'ask'], 'on the row; the mode is kept');
    assert.ok(!JSON.stringify(h.sch.doc).includes('policy words'), 'the policy\'s text is not stored');
    h.check.v = 'mode-live';
    await h.advance(30 * MIN);
    assert.deepStrictEqual(h.sent, []);
    assert.deepStrictEqual(h.sch.doc.schedules[0].last?.reason, 'mode-live');
    assert.strictEqual(h.sch.runsOf(s.id).length, 2, 'two reasons, two entries');
    const n = await h.sch.runNow(s.id);
    assert.ok(!n.ok && /cannot switch/.test(n.error));
    h.check.v = undefined;
    await h.advance(30 * MIN);
    assert.deepStrictEqual(h.sent, ['x@ask'], 'the policy lifted: it runs again');
  }
  // a refusal `send` learns late (the session could not take the mode): not sent, not "failed"
  {
    const h = harness(undefined, { send: async () => ({ refused: 'mode-live' as const }) });
    const r = h.sch.save({ folder: '/w', prompt: 'x', at: T0 + MIN, mode: 'ask' }, () => true);
    assert.ok(r.ok);
    await h.advance(MIN);
    const s = h.sch.doc.schedules[0];
    assert.deepStrictEqual([s.last?.outcome, s.last?.reason, s.done, s.mode], ['mode-refused', 'mode-live', true, 'ask']);
    assert.ok(!(await h.sch.runNow(s.id)).ok);
    assert.strictEqual(await h.sch.releaseDoorRun(s.id, 'x'), 'mode');
  }
  // a run held at a door before an Allow all edit does not go out on the new confirmation
  {
    const h = harness();
    const s = addAllow(h);
    assert.strictEqual(await h.sch.releaseDoorRun(s.id, 'the old prompt'), 'mode');
    assert.deepStrictEqual(h.sent, []);
    assert.strictEqual(await h.sch.releaseDoorRun(s.id, 'nightly'), 'sent');
  }

  // ---- FR-180: main's check on a fake router (`modeCheckOp`) ----
  {
    const ad = new FakeAdapter({ capabilities: { permissionModes: ['read-only', 'ask', 'allow'] } });
    const noSwitch = new FakeAdapter({ omit: ['setPermMode'] });
    const roOnly = new FakeAdapter({ capabilities: { permissionModes: ['read-only'] } });
    const a = { id: 'a1', permMode: 'read-only', adapterId: 'copilot' } as AgentInfo;
    const org: { v?: string } = {};
    const d = (x: AgentAdapter, app = 'copilot') => ({ router: { forAgent: () => x, adapterIdOf: () => app }, orgRefusal: () => org.v });
    const s = (o: Partial<Schedule>): Pick<Schedule, 'mode' | 'modeFor' | 'target'> => ({ mode: 'allow', modeFor: { app: 'copilot' }, ...o });
    assert.strictEqual(modeCheckOp(d(ad), s({}), a), undefined);
    assert.strictEqual(modeCheckOp(d(ad), s({}), undefined), undefined, 'no agent: send says so');
    assert.strictEqual(modeCheckOp(d(ad, 'claude'), s({}), a), 'other-agent', 'another app');
    assert.strictEqual(modeCheckOp(d(ad), s({ modeFor: undefined }), a), 'other-agent', 'no identity');
    assert.strictEqual(modeCheckOp(d(ad), s({ target: { session: 'a1', agent: 'copilot' } }), a), 'other-agent', 'chosen for the folder, sent to a session');
    assert.strictEqual(modeCheckOp(d(ad), s({ modeFor: { app: 'copilot', session: 'old' }, target: { session: 'a1', agent: 'copilot' } }), a), 'other-agent', 'chosen for another session');
    assert.strictEqual(modeCheckOp(d(ad), s({ modeFor: { app: 'copilot', session: 'a1' }, target: { session: 'a1', agent: 'copilot' } }), a), undefined);
    assert.strictEqual(modeCheckOp(d(roOnly), s({}), a), 'mode-lacking', 'FR-184: not a mode this app has');
    assert.strictEqual(modeCheckOp(d(ad), s({ mode: undefined }), a), 'mode-lacking', 'no word is read as a mode here either');
    assert.strictEqual(modeCheckOp(d(ad), s({ mode: 'autopilot' }), a), 'mode-lacking', 'no Autopilot capability exists here');
    assert.strictEqual(modeCheckOp(d(noSwitch), s({}), a), 'mode-live', 'cannot switch');
    assert.strictEqual(modeCheckOp(d(noSwitch), s({ mode: 'read-only' }), a), undefined, 'its own mode needs no switch');
    org.v = 'blocked';
    assert.strictEqual(modeCheckOp(d(ad), s({}), a), 'mode-org', 'FR-183');
    org.v = undefined;
  }

  // ---- FR-180: the temporary mode on a FakeAdapter: back at each ending, never saved ----
  const fx = async (mode: PermMode = 'read-only', cfg: ConstructorParameters<typeof FakeAdapter>[0] = {}) => {
    const ad = new FakeAdapter({ id: 'copilot', ...cfg });
    await ad.start({ sessionId: 'a1', cwd: '/w', permissionMode: mode } as never);
    const a = { id: 'a1', permMode: mode, adapterId: 'copilot', cwd: '/w' } as AgentInfo;
    const agents = new Map([['a1', a]]);
    const sets: PermMode[] = [];
    const real = ad.setPermMode?.bind(ad);
    if (real) ad.setPermMode = (id, m, o) => (sets.push(m), real(id, m, o));
    const logs: string[] = [];
    const runs = new RunModes({ agents, router: { forAgent: () => ad, adapterIdOf: () => 'copilot' }, log: (_a, t) => logs.push(t) });
    return { ad, a, agents, sets, runs, logs };
  };
  {
    const { a, sets, runs, logs } = await fx();
    // the turn ends: back
    assert.strictEqual(runs.apply(a, 'allow'), undefined);
    assert.deepStrictEqual(sets, ['allow']);
    assert.strictEqual(a.permMode, 'read-only', 'the session\'s saved mode never changes');
    assert.strictEqual(runs.modeOf('a1'), 'allow');
    assert.strictEqual(runs.holds('a1'), true, 'another schedule waits');
    assert.strictEqual(runs.apply(a, 'ask'), 'mode-live', 'never stacked');
    // an `idle` left over from before the send does not end it
    runs.onStatus('a1', 'idle');
    assert.strictEqual(runs.modeOf('a1'), 'allow', 'a leftover idle before the send');
    runs.onStatus('a1', 'working');
    runs.sent('a1');
    runs.onStatus('a1', 'needs-permission');
    assert.strictEqual(runs.modeOf('a1'), 'allow');
    runs.onStatus('a1', 'idle');
    assert.deepStrictEqual(sets, ['allow', 'read-only'], 'back when the turn ended');
    assert.strictEqual(runs.modeOf('a1'), undefined);
    assert.ok(logs.length === 2 && !logs.join().includes('nightly'), 'one row each way, no prompt');
    // it ends for a send that returned with no status, on error and on stop
    for (const end of ['error', 'stopped', 'idle']) {
      assert.strictEqual(runs.apply(a, 'ask'), undefined);
      runs.sent('a1');
      runs.onStatus('a1', end);
      assert.strictEqual(runs.modeOf('a1'), undefined, end);
      assert.strictEqual(sets[sets.length - 1], 'read-only', end);
    }
  }
  // a send that fails: main calls `end`
  {
    const { a, sets, runs } = await fx('allow');
    assert.strictEqual(runs.apply(a, 'read-only'), undefined, 'a Read-only schedule on an Allow all session');
    runs.end('a1');
    assert.deepStrictEqual(sets, ['read-only', 'allow']);
    assert.strictEqual(a.permMode, 'allow');
  }
  // the session ends mid-turn: nothing to restore, the record goes, the next start uses its own mode
  {
    const { ad, a, sets, runs } = await fx();
    assert.strictEqual(runs.apply(a, 'allow'), undefined);
    await ad.stop('a1');
    assert.strictEqual(runs.holds('a1'), false, 'an ended session is not held');
    assert.deepStrictEqual(sets, ['allow'], 'no call on a session that is gone');
    assert.strictEqual(a.permMode, 'read-only');
    // and removed
    await ad.start({ sessionId: 'a1', cwd: '/w', permissionMode: a.permMode } as never);
    assert.strictEqual(runs.apply(a, 'allow'), undefined);
    runs.forget('a1');
    assert.strictEqual(runs.holds('a1'), false);
  }
  // a restart in the middle of a turn: nothing in memory comes back, the saved mode is as it was, the start uses it (constitution III)
  {
    const { ad, a, runs } = await fx();
    const store = { setPermMode: 0, setSessionMode: 0 };
    assert.strictEqual(runs.apply(a, 'allow'), undefined);
    // the app dies here: new process, a new RunModes, the agent rebuilt from its saved mode
    const fresh = new RunModes({ agents: new Map([['a1', a]]), router: { forAgent: () => ad, adapterIdOf: () => 'copilot' } });
    assert.strictEqual(fresh.modeOf('a1'), undefined);
    assert.strictEqual(a.permMode, 'read-only');
    assert.deepStrictEqual(store, { setPermMode: 0, setSessionMode: 0 });
    const started: string[] = [];
    await startGuardOp({ refusal: async () => undefined }, { id: 'copilot', start: async (o) => (started.push(startModeOf(o)), 'a1') }, { cwd: '/w', permissionMode: a.permMode } as never);
    assert.deepStrictEqual(started, ['read-only']);
  }
  // no temporary mode ever goes near the saved ones: the source has no way to them
  {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'schedmode.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const banned of ['setModeOp', 'setSessionMode', '.store', 'validMode', 'permMode =', 'sessionModes']) assert.ok(!src.includes(banned), `schedmode.ts must not use ${banned}`);
  }
  // a mode the session already has: no switch, nothing to restore; an adapter that cannot switch
  {
    const same = await fx('ask');
    assert.strictEqual(same.runs.apply(same.a, 'ask'), undefined);
    assert.deepStrictEqual(same.sets, []);
    assert.strictEqual(same.runs.holds('a1'), false);
    const no = await fx('read-only', { omit: ['setPermMode'] });
    assert.strictEqual(no.runs.apply(no.a, 'allow'), 'mode-live', 'FR-184: a live session that cannot switch is refused (`refusesLive`)');
    assert.strictEqual(no.runs.apply(no.a, 'read-only'), undefined);
    assert.strictEqual(same.runs.apply(same.a, undefined), 'mode-lacking', 'never read as a mode');
    assert.strictEqual(same.runs.apply(same.a, 'autopilot'), 'mode-lacking');
    const stopped = await fx();
    await stopped.ad.stop('a1');
    assert.strictEqual(stopped.runs.apply(stopped.a, 'ask'), 'mode-live', 'not live: the switch would do nothing');
  }
  // a switch that throws is refused; a restore that throws stops the session, so it cannot stay in the run's mode
  {
    const t = await fx();
    const real = t.ad.setPermMode;
    t.ad.setPermMode = () => { throw new Error('x'); };
    assert.strictEqual(t.runs.apply(t.a, 'allow'), 'mode-live');
    assert.strictEqual(t.runs.holds('a1'), false);
    t.ad.setPermMode = real;
    assert.strictEqual(t.runs.apply(t.a, 'allow'), undefined);
    t.ad.setPermMode = () => { throw new Error('x'); };
    t.runs.end('a1');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(t.ad.isLive('a1'), false, 'stopped: its next start uses the saved mode');
  }
  // the mode the user picks during that turn stands; a typed message never runs under a higher mode
  {
    const t = await fx();
    assert.strictEqual(t.runs.apply(t.a, 'allow'), undefined);
    assert.ok(t.runs.userSendRefusal('a1', true)?.includes('Allow all'), 'refused while the higher mode runs');
    t.a.permMode = 'ask'; // the user switched (setModeOp) during the turn
    t.runs.sent('a1');
    t.runs.onStatus('a1', 'idle');
    assert.strictEqual(t.sets[t.sets.length - 1], 'ask', 'back to what the session has now');
    assert.strictEqual(t.runs.userSendRefusal('a1', true), undefined);
    // a run with less power than the session: a typed message stays allowed
    const lo = await fx('allow');
    assert.strictEqual(lo.runs.apply(lo.a, 'read-only'), undefined);
    assert.strictEqual(lo.runs.userSendRefusal('a1', true), undefined);
    // a turn that ended without a status: the next typed message puts the mode back first
    const gone = await fx();
    assert.strictEqual(gone.runs.apply(gone.a, 'allow'), undefined);
    assert.strictEqual(gone.runs.userSendRefusal('a1', false), undefined);
    assert.strictEqual(gone.sets[gone.sets.length - 1], 'read-only');
  }

  // ---- FR-180 and the open point on loops: the field per pass, no Autopilot on a loop ----
  {
    loopSupport.enabled = true;
    try {
      const loop = { minDelay: 5, maxDelay: 60, defaultDelay: 15, maxPasses: 10, endAt: T0 + 3_600_000 };
      const base = { folder: '/w', prompt: 'check CI', target: { session: 's1', agent: 'copilot' }, cap: { amount: 50, unit: 'aiu' }, loop };
      const h = harness();
      assert.ok(!h.sch.save({ ...base }, () => true).ok, 'a loop needs a mode');
      assert.ok(!h.sch.save({ ...base, mode: 'autopilot' }, () => true).ok, 'no Autopilot on a loop');
      assert.ok(!h.sch.save({ ...base, mode: 'allow' }, () => true).ok, 'Allow all needs its confirmation');
      const r = h.sch.save({ ...base, mode: 'ask' }, () => true);
      assert.ok(r.ok, JSON.stringify(r));
      await h.advance(0);
      assert.deepStrictEqual(h.sent, ['check CI@ask'], 'the pass has the field');
      h.sch.turnEnded('s1', { finalText: 'LOOP: next 5 ok' });
      // the field is read at each pass: refused here, and nothing counts as a pass
      h.check.v = 'mode-org';
      const passes = h.sch.doc.schedules[0].loop?.passes;
      await h.advance(15 * MIN);
      assert.strictEqual(h.sent.length, 1, 'a refused pass is not sent');
      let s = h.sch.doc.schedules[0];
      assert.deepStrictEqual([s.last?.outcome, s.last?.reason, s.loop?.passes, s.loop?.ended], ['mode-refused', 'mode-org', passes, undefined]);
      assert.ok((s.next ?? 0) > h.now, 'it looks again later, it does not spin');
      h.check.v = undefined;
      await h.advance(15 * MIN);
      assert.strictEqual(h.sent.length, 2, 'it goes again');
      // a stored Autopilot on a loop is refused with its own reason, and the loop still ends at its limits
      const al = stored({ id: 'sched-loop1', every: undefined, next: T0 + MIN, target: { session: 's2', agent: 'copilot' }, loop, mode: 'autopilot' });
      assert.strictEqual(al.mode, 'autopilot');
      const h2 = harness({ pausedAll: false, schedules: [al] });
      h2.sch.setPausedAll(false);
      await h2.advance(MIN);
      s = h2.sch.doc.schedules[0];
      assert.deepStrictEqual([h2.sent, s.last?.outcome, s.last?.reason, s.loop?.passes ?? 0], [[], 'mode-refused', 'mode-loop-autopilot', 0]);
      // and it cannot be kept by an edit either: Autopilot is not offered on a loop
      const keep = h2.sch.save({ id: s.id, edit: true, prompt: s.prompt, target: s.target, loop, mode: 'autopilot' }, () => true);
      assert.ok(!keep.ok && /on a loop/.test(keep.error), JSON.stringify(keep));
      // no mode: a loop waits a pass length
      const none = stored({ id: 'sched-loop2', every: undefined, next: T0 + MIN, target: { session: 's2', agent: 'copilot' }, loop });
      const h3 = harness({ pausedAll: false, schedules: [none] });
      h3.sch.setPausedAll(false);
      await h3.advance(MIN);
      s = h3.sch.doc.schedules[0];
      assert.deepStrictEqual([h3.sent, s.last?.outcome, s.last?.reason], [[], 'skipped-mode', 'no-mode']);
      // the session refuses at the send: not a pass, not a failed one
      const h4 = harness(undefined, { send: async () => ({ refused: 'mode-live' as const }) });
      const r4 = h4.sch.save({ ...base, mode: 'ask' }, () => true);
      assert.ok(r4.ok);
      await h4.advance(0);
      s = h4.sch.doc.schedules[0];
      assert.deepStrictEqual([s.last?.outcome, s.last?.reason, s.loop?.passes, s.loop?.inPass, s.loop?.errorStreak ?? 0], ['mode-refused', 'mode-live', 0, false, 0]);
      // Pause and Resume of a loop keep the field; a plain save does not raise it
      const cur = h.sch.doc.schedules[0];
      assert.ok(!h.sch.save({ ...cur, mode: 'allow' }, () => true).ok);
      assert.strictEqual(h.sch.doc.schedules[0].mode, 'ask');
    } finally {
      loopSupport.enabled = false;
    }
  }

  // ---- FR-182: the IPC: not from the app is refused; only the window reaches these; no MCP or remote path ----
  {
    const electronPath = require.resolve('electron');
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const saved = require.cache[electronPath];
    require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { ipcMain: { handle: (c: string, f: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(c, f), on: () => undefined } } } as unknown as NodeJS.Module;
    try {
      (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
      const h = harness();
      (require('../src/main/ipc/schedules') as typeof import('../src/main/ipc/schedules')).register({ getScheduler: () => h.sch, getFolderStore: () => ({ get: () => ({}) }) as never });
      const other = { url: 'https://example.test/' };
      const foreign = { senderFrame: other, sender: { mainFrame: other } };
      for (const c of ['schedules:askMode', 'schedules:setMode', 'schedules:save']) {
        assert.ok(handlers.has(c), `${c} is registered through ipcHandle`);
        assert.throws(() => (handlers.get(c) as (e: unknown, ...a: unknown[]) => unknown)(foreign, { id: 'x', mode: 'allow', folder: '/w', prompt: 'x', every: 30 }), /did not come from its own window/, `${c}: refused from anywhere else`);
      }
      assert.strictEqual(h.sch.doc.schedules.length, 0);
    } finally {
      if (saved) require.cache[electronPath] = saved; else delete require.cache[electronPath];
    }
    // the only callers in src/ that can write a schedule's mode are in the IPC module: MCP tools and remote control have none
    const root = path.join(__dirname, '..', '..', 'src');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.ts$/.test(e.name) ? [path.join(d, e.name)] : []));
    const writers: string[] = [];
    for (const f of walk(root)) {
      if (/[\\/]renderer[\\/]/.test(f) || f.endsWith('schedules.ts') && !f.includes('ipc')) continue;
      const t = fs.readFileSync(f, 'utf8');
      if (/scheduler\(?\)?!?\??\.(save|setMode|askMode)\(/.test(t) || /\bsch(eduler)?\b[^\n]*\.(setMode|askMode)\(/.test(t)) writers.push(path.relative(root, f).replace(/\\/g, '/'));
    }
    assert.deepStrictEqual(writers, ['main/ipc/schedules.ts'], 'one writer of a schedule\'s mode');
    const ipc = fs.readFileSync(path.join(root, 'main', 'ipc', 'schedules.ts'), 'utf8');
    for (const c of ['schedules:askMode', 'schedules:setMode', 'schedules:save']) assert.ok(new RegExp(`'${c}', \\(e[^\\n]*!fromApp\\(e\\)`).test(ipc), `${c} checks fromApp itself`);
    for (const f of walk(path.join(root, 'main', 'mcp')).concat(path.join(root, 'main', 'remoteops.ts'), path.join(root, 'main', 'mcpipc.ts'))) {
      const t = fs.readFileSync(f, 'utf8');
      assert.ok(!/from '\.\.?\/(\.\.\/)?(main\/)?schedules'|schedules:(save|setMode|askMode)|\.saveSchedule\b|\.setScheduleMode\b/.test(t.replace(/import type[^\n]*/g, '')), `${f} must not reach a schedule's mode`);
    }
    // main's send applies the mode before it sends and takes it back on a failure; a typed message passes the guard
    const m = fs.readFileSync(path.join(root, 'main', 'main.ts'), 'utf8');
    const send = m.slice(m.indexOf('const scheduleDeps ='), m.indexOf('modeCheck: (s) =>'));
    assert.ok(send.indexOf('runModes.apply(a, s.mode)') > 0 && send.indexOf('runModes.apply(a, s.mode)') < send.indexOf('ad.send(a.id'), 'the mode goes on before the prompt');
    assert.ok(/catch \(err\) \{\s*runModes\.end\(a\.id\)/.test(send), 'a failed send restores');
    assert.ok(m.includes('runModes.onStatus(e.sessionId, e.status)'), 'a turn\'s end restores');
    assert.ok(/async function sendOp[^\n]*\n\s*const heldMode = runModes\.userSendRefusal/.test(m), 'a typed message checks first');
    const s = fs.readFileSync(path.join(root, 'main', 'schedules.ts'), 'utf8');
    assert.ok(!/validMode/.test(s.replace(/\/\*[\s\S]*?\*\//g, '')), 'schedules.ts must not read a mode with validMode (it turns anything into Read-only)');
  }

  // FR-036: a run log holds no prompt text
  {
    const h = harness();
    const r = h.sch.save({ folder: '/w', prompt: 'SECRET-PROMPT-WORDS', every: 30, mode: 'ask' }, () => true);
    assert.ok(r.ok);
    h.check.v = 'mode-org';
    await h.advance(30 * MIN);
    assert.ok(!JSON.stringify(h.sch.runsOf(r.schedule.id)).includes('SECRET-PROMPT-WORDS'));
  }

  process.exitCode = 0;
  console.log('test-schedmode: OK');
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
