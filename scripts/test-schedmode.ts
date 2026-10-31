/**
 * Spec 044 FR-180..FR-184 (T140..T143): a schedule's own mode. A real Scheduler with a fake clock, the real RunModes on a FakeAdapter, the real
 * IPC module on a stand-in electron. Part of `npm run test:schedules`. No session, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { FakeAdapter } from '../src/adapters/fake';
import type { AgentAdapter } from '../src/adapters/types';
import { setModeOp, startGuardOp, startModeOf, stopTurnOp } from '../src/main/agentops';
import { OrgPolicyCache } from '../src/main/orgpolicy';
import { RunModes, createScheduleWiring, modeCheckOp } from '../src/main/schedmode';
import { wholeOrgPolicy } from '../src/shared/orgpolicy';
import { MODE_PROOF_MS, SEND_PATIENCE_MS, Scheduler, cleanSchedule, loopSupport, parseMode, parseSchedules, publicDoc, publicSchedule, sealFrom, waitingForMode } from '../src/main/schedules';
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
    seal: { encrypt: (x) => `S:${x}`, decrypt: (b) => (b.startsWith('S:') ? b.slice(2) : undefined) },
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
    assert.strictEqual(await h.sch.releaseDoorRun(s.id, 'the old prompt'), 'prompt-changed');
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
    const d = (x: AgentAdapter, app = 'copilot') => ({ router: { forAgent: () => x, adapterIdOf: () => app }, orgNow: () => org.v });
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

  // ---- FR-180..FR-184: main's wiring (`createScheduleWiring`) with the real Scheduler and a FakeAdapter's events: every transition of a run ----
  const wired = async (mode: PermMode = 'read-only', o: { doc?: SchedulesDoc; cfg?: ConstructorParameters<typeof FakeAdapter>[0]; orgRun?: (m: PermMode, raised: boolean) => Promise<string | undefined>; orgNow?: (m: PermMode, raised: boolean) => string | undefined; remote?: boolean } = {}) => {
    const ad = new FakeAdapter({ id: 'copilot', ...o.cfg });
    await ad.start({ sessionId: 'a1', cwd: '/w', permissionMode: mode } as never);
    const a = { id: 'a1', permMode: mode, adapterId: 'copilot', cwd: '/w', name: 'Ada' } as AgentInfo;
    const agents = new Map([['a1', a]]);
    const sets: PermMode[] = [];
    const real = ad.setPermMode?.bind(ad);
    if (real) ad.setPermMode = (id, m, x) => (sets.push(m), real(id, m, x));
    const last = new Map<string, string>();
    const shown: Array<PermMode | undefined> = [];
    const notes = { ok: 0, failed: 0 };
    const announced: boolean[] = [];
    const live: { gate?: Promise<void> } = {};
    const w = createScheduleWiring({
      agents,
      router: { forAgent: () => ad, adapterIdOf: () => 'copilot' },
      statusBusy: (id) => ['working', 'needs-permission'].includes(last.get(id) ?? ''),
      remote: () => !!o.remote,
      changed: (_a, m) => shown.push(m),
      agentOf: () => a,
      ensureLive: async () => { if (live.gate) await live.gate; },
      orgNow: (_a, m, r) => o.orgNow?.(m, r),
      orgRun: async (_a, m, r) => o.orgRun?.(m, r),
      noteSend: () => undefined,
      noteSendFailed: () => { notes.failed++; },
      noteSent: () => { notes.ok++; },
      announce: (_a, _s, _p, t) => announced.push(t),
      appName: () => 'GitHub Copilot',
      agentName: () => 'Ada',
      folderName: () => 'proj',
    });
    // as main's router listener does
    ad.onEvent((e) => { if (e.type === 'status' && !e.agentId) { last.set(e.sessionId, e.status); w.onStatus(e.sessionId, e.status); } });
    const emit = (status: string): void => (ad as unknown as { emit(id: string, e: unknown): void }).emit('a1', { type: 'status', status });
    const h = harness(o.doc, { isBusy: () => w.busy('a1'), send: (_f, p, s) => w.send(s, p), modeCheck: w.modeCheck, modeAgent: w.modeAgent, orgWords: w.orgWords, primeMode: w.primeMode });
    const sentOut: string[] = [];
    /** A send that stays in flight until `release`, as an adapter's own awaits do. */
    const holdSend = (before?: () => void | Promise<void>): { release(): void; entered: Promise<void> } => {
      let release = (): void => undefined;
      let entered = (): void => undefined;
      const p = new Promise<void>((r) => { release = r; });
      const e = new Promise<void>((r) => { entered = r; });
      ad.send = async (_id, msg) => { sentOut.push(msg.text); entered(); await before?.(); await p; };
      return { release, entered: e };
    };
    const typed = (go: () => Promise<string> = async () => 'sent'): Promise<string> => w.userSend<string>('a1', (err) => `refused: ${err}`, go);
    const addRun = (m: 'read-only' | 'ask' | 'allow', at = MIN): Schedule => {
      const q = { folder: '/w', prompt: 'nightly', at: h.now + at };
      const t = h.sch.askMode({ ...q, mode: m });
      const r = h.sch.save({ ...q, mode: m, modeProof: t.ok && t.needed ? t.token : undefined }, () => true);
      assert.ok(r.ok, JSON.stringify(r));
      return (r as { schedule: Schedule }).schedule;
    };
    const tick = async (): Promise<void> => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
    return { ad, a, agents, w, h, sets, last, shown, notes, announced, live, emit, holdSend, typed, addRun, tick, sentOut, runs: w.runs };
  };
  // the plain path, on the FakeAdapter's own send: switched for the turn, back when it ended, logged sent, saved mode untouched
  {
    const t = await wired();
    t.addRun('allow');
    await t.h.advance(MIN);
    await t.tick();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(t.sets, ['allow', 'read-only'], 'for the turn, then back');
    assert.strictEqual(t.a.permMode, 'read-only', 'the session\'s saved mode never changes');
    assert.strictEqual(t.a.runMode, undefined);
    assert.deepStrictEqual(t.shown, ['allow', undefined], 'the window is told both ways');
    assert.deepStrictEqual(t.announced, [true]);
    assert.strictEqual(t.h.sch.doc.schedules[0].last?.outcome, 'sent');
    assert.strictEqual(t.w.busy('a1'), false);
  }
  // review 1: a Codex session reopens inside its send and is not live: a read or a typed message never drops the raised mode
  {
    const t = await wired();
    t.addRun('allow');
    const s = t.holdSend(async () => { await t.ad.stop('a1'); });
    await t.h.advance(MIN);
    await s.entered;
    await t.tick();
    assert.strictEqual(t.ad.isLive('a1'), false, 'reopening');
    assert.strictEqual(t.runs.modeOf('a1'), 'allow', 'an activity row reads the real mode');
    assert.strictEqual(t.w.busy('a1'), true, 'still held while not live');
    assert.ok((await t.typed()).startsWith('refused'), 'a typed message during the reopen');
    assert.deepStrictEqual(t.sets, ['allow'], 'nothing dropped it');
    await t.ad.start({ sessionId: 'a1', cwd: '/w', permissionMode: 'allow' } as never);
    t.emit('working');
    s.release();
    await t.tick();
    assert.strictEqual(t.runs.modeOf('a1'), 'allow', 'the turn runs');
    t.emit('idle');
    assert.deepStrictEqual(t.sets, ['allow', 'read-only'], 'and it is restored');
    assert.strictEqual(t.w.busy('a1'), false);
  }
  // Stop while the session reopens: it cannot take a mode yet, so it comes back when the send returns
  {
    const t = await wired();
    t.addRun('allow');
    const s = t.holdSend(async () => { await t.ad.stop('a1'); });
    await t.h.advance(MIN);
    await s.entered;
    await t.tick();
    t.runs.end('a1');
    assert.strictEqual(t.w.busy('a1'), true, 'its send has not returned: schedules wait');
    assert.strictEqual(await t.typed(), 'sent', 'but the person has the session back');
    await t.ad.start({ sessionId: 'a1', cwd: '/w', permissionMode: 'allow' } as never);
    t.emit('working');
    s.release();
    await t.tick();
    assert.deepStrictEqual(t.sets, ['allow', 'read-only'], 'back when it returned: it could not take the mode while it reopened');
    assert.strictEqual(t.runs.busy('a1'), false, 'the gate is free (the turn itself is still stopping)');
  }
  // review 2: one gate: a typed message on its way stops a run; a run in setup stops a typed message; a turn that began during the setup stops the switch
  {
    const t = await wired();
    let release = (): void => undefined;
    const typing = t.typed(() => new Promise<string>((r) => { release = () => r('sent'); }));
    t.addRun('allow');
    await t.h.advance(MIN);
    await t.tick();
    assert.deepStrictEqual(t.sets, [], 'no switch under a message on its way');
    assert.strictEqual(t.runs.reserve('a1'), undefined, 'and the gate itself says so, whatever the scheduler\'s busy check saw before');
    assert.deepStrictEqual(t.h.sent, []);
    assert.strictEqual(t.h.sch.doc.schedules[0].last?.outcome, 'skipped-busy');
    release();
    await typing;
    assert.strictEqual(t.w.busy('a1'), false, 'the count comes back');
  }
  {
    const t = await wired();
    let open = (): void => undefined;
    t.live.gate = new Promise((r) => { open = r; });
    t.addRun('allow');
    const s = t.holdSend();
    await t.h.advance(MIN);
    await t.tick();
    assert.ok((await t.typed()).startsWith('refused'), 'typed during the run\'s setup');
    t.emit('working'); // something began a turn while ensureLive waited
    open();
    await t.tick();
    assert.deepStrictEqual(t.sets, [], 'rechecked right before the switch');
    assert.deepStrictEqual(t.sentOut, [], 'not sent');
    assert.strictEqual(t.h.sch.doc.schedules[0].last?.outcome, 'skipped-busy');
    assert.strictEqual(t.w.busy('a1'), true, 'its status is working');
    t.emit('idle');
    assert.strictEqual(t.w.busy('a1'), false, 'the gate is free');
    s.release();
  }
  // the reviewer's P4: a session already working cannot be reserved or applied
  {
    const t = await wired();
    t.emit('working');
    assert.strictEqual(t.runs.reserve('a1'), undefined);
    assert.deepStrictEqual(t.sets, []);
  }
  // review 3: a typed message before the run's first status does not restore: a Read-only schedule on an Allow all session stays Read-only
  {
    const t = await wired('allow');
    t.addRun('read-only');
    const s = t.holdSend(); // Copilot's `sandboxApplying`: up to 15 s before its `working`
    await t.h.advance(MIN);
    await s.entered;
    assert.strictEqual(t.last.get('a1') ?? 'idle', 'idle', 'its last status still says idle');
    assert.ok((await t.typed()).startsWith('refused'));
    t.runs.onStatus('a1', 'idle'); // a leftover idle
    assert.deepStrictEqual(t.sets, ['read-only'], 'never back to Allow all during the run');
    t.emit('working');
    s.release();
    await t.tick();
    assert.ok((await t.typed()).startsWith('refused'), 'and during the turn');
    t.emit('idle');
    assert.deepStrictEqual(t.sets, ['read-only', 'allow']);
    assert.strictEqual(await t.typed(), 'sent', 'free when it ended');
  }
  // review 4: the policy is read after the session is there, an empty cache is not a yes, and a run in a refused mode changes nothing
  {
    const reads: PermMode[] = [];
    const t = await wired('read-only', { orgRun: async (m) => (reads.push(m), m === 'allow' ? 'blocked' : undefined) });
    t.addRun('allow');
    await t.h.advance(MIN);
    await t.tick();
    const c = t.h.sch.doc.schedules[0];
    assert.deepStrictEqual([reads, t.sets, t.sentOut, c.last?.outcome, c.last?.reason, t.w.busy('a1')], [['allow'], [], [], 'mode-refused', 'mode-org', false]);
  }
  // re-review 1: with the real cache. A policy Durbar could not read (a reader that threw, a value it does not know: `doubt`) refuses a raised mode only
  {
    const mk = (read: () => Promise<ReturnType<typeof wholeOrgPolicy> | undefined>) => new OrgPolicyCache({ ids: () => ['copilot'], adapter: () => ({ displayName: 'App', readOrgPolicy: read }) as never, now: () => 0 });
    for (const [name, c] of [['a reader that threw', mk(async () => { throw new Error('no'); })], ['a value it did not know', mk(async () => wholeOrgPolicy('App', [], ['odd'], 'doubt'))]] as Array<[string, OrgPolicyCache]>) {
      assert.ok(/cannot run unattended/.test((await c.runRefusal('copilot', 'allow', true)) ?? ''), `${name}: a raised mode is refused`);
      assert.ok(/cannot run unattended/.test(c.runRefusalNow('copilot', 'ask', true) ?? ''), `${name}: also the check that cannot wait`);
      assert.strictEqual(await c.runRefusal('copilot', 'read-only', false), undefined, `${name}: Read-only is not refused`);
      assert.strictEqual(await c.runRefusal('copilot', 'allow', false), undefined, `${name}: the mode the session has is not`);
      assert.strictEqual(await c.refusal('copilot', { mode: 'allow' }), undefined, `${name}: a start with the person there: advice as before`);
    }
    const c2 = mk(async () => undefined);
    assert.strictEqual(await c2.runRefusal('copilot', 'allow', true), undefined, 'a policy with nothing in it refuses nothing');
    const blocked = mk(async () => wholeOrgPolicy('App', [], ['x'], 'fatal'));
    assert.ok(await blocked.runRefusal('copilot', 'read-only', false), 'a real refusal refuses any mode');
    const doubt = mk(async () => { throw new Error('no'); });
    const t = await wired('read-only', { orgRun: (m, r) => doubt.runRefusal('copilot', m, r), orgNow: (m, r) => doubt.runRefusalNow('copilot', m, r) });
    await t.h.sch.readyForMode({ folder: '/w', prompt: 'x' });
    const r = t.h.sch.save({ folder: '/w', prompt: 'x', every: 30, mode: 'ask' }, () => true);
    assert.ok(!r.ok && /cannot run unattended/.test(r.error), 'refused at a save, in its words');
    const ro = t.h.sch.save({ folder: '/w', prompt: 'ro', at: t.h.now + MIN, mode: 'read-only' }, () => true);
    assert.ok(ro.ok, 'Read-only saves');
    t.ad.send = async () => { t.emit('working'); t.emit('idle'); };
    await t.h.advance(MIN);
    await t.tick();
    assert.strictEqual(t.h.sch.doc.schedules[0].last?.outcome, 'sent', 'and runs');
    const primed: string[] = [];
    const p = harness(undefined, { primeMode: async (x) => { primed.push(x.folder); throw new Error('a failed read must not throw out of here'); } });
    await p.sch.readyForMode({ folder: '/w' });
    assert.deepStrictEqual(primed, ['/w']);
  }
  // review 5: a send that went nowhere has a defined end: idle then return (Copilot's sandbox hold), return with no status (Claude's), a throw at a limit
  for (const [name, send] of [
    ['idle then return', async (e: (s: string) => void) => { e('idle'); }],
    ['return with no status', async () => undefined],
  ] as Array<[string, (e: (s: string) => void) => Promise<void>]>) {
    const t = await wired();
    t.addRun('allow');
    t.ad.send = async () => send(t.emit);
    await t.h.advance(MIN);
    await t.tick();
    const c = t.h.sch.doc.schedules[0];
    assert.deepStrictEqual([t.sets, t.runs.modeOf('a1'), t.w.busy('a1'), t.a.runMode], [['allow', 'read-only'], undefined, false, undefined], `${name}: the mode is back at once`);
    assert.deepStrictEqual([c.last?.outcome, t.notes.ok], ['failed', 0], `${name}: not logged as sent`);
    assert.strictEqual(await t.typed(), 'sent', `${name}: the session is free`);
  }
  // a message in a temporary mode is not kept by the app for later; one in the session's own mode is as before
  {
    const seen: Array<boolean | undefined> = [];
    const t = await wired();
    t.ad.send = async (_i, m) => { seen.push(m.noHold); t.emit('working'); t.emit('idle'); };
    t.addRun('allow');
    t.h.sch.save({ folder: '/w', prompt: 'own', at: t.h.now + 2 * MIN, mode: 'read-only' }, () => true);
    await t.h.advance(MIN);
    await t.tick();
    await t.h.advance(MIN);
    await t.tick();
    assert.deepStrictEqual(seen, [true, undefined]);
    // a run in the session's own mode that returned with no status: nothing to restore, held no longer, and its limit path stays as it was
    const own = await wired();
    own.ad.send = async () => undefined;
    own.addRun('read-only');
    await own.h.advance(MIN);
    await own.tick();
    assert.deepStrictEqual([own.sets, own.w.busy('a1'), own.h.sch.doc.schedules[0].last?.outcome], [[], false, 'sent']);
  }
  // the person's own spending limit is a warning: the app's notice asks them, the run is not kept, the mode comes back, the row says what to do, the next time goes
  {
    const t = await wired();
    const r = t.h.sch.save({ folder: '/w', prompt: 'p', every: 30, mode: 'ask' }, () => true);
    assert.ok(r.ok);
    t.ad.send = async () => { throw Object.assign(new Error('at the limit'), { code: 'at-limit' }); };
    await t.h.advance(30 * MIN);
    await t.tick();
    const c = t.h.sch.doc.schedules[0];
    assert.deepStrictEqual([c.last?.outcome, c.last?.reason, c.paused, c.mode, t.sets, t.w.busy('a1')], ['mode-refused', 'mode-limit', undefined, 'ask', ['ask', 'read-only'], false], 'not paused, nothing to undo');
    t.ad.send = async () => { t.emit('working'); t.emit('idle'); }; // the person raised it
    await t.h.advance(30 * MIN);
    await t.tick();
    assert.strictEqual(t.h.sch.doc.schedules[0].last?.outcome, 'sent', 'the next time goes');
  }
  // a send that throws gives the mode back, once
  {
    const t = await wired('allow');
    t.addRun('read-only');
    t.ad.send = async () => { throw new Error('/home/me/secret'); };
    await t.h.advance(MIN);
    await t.tick();
    const c = t.h.sch.doc.schedules[0];
    assert.deepStrictEqual([t.sets, t.a.permMode, c.last?.outcome, t.notes.failed], [['read-only', 'allow'], 'allow', 'failed', 1]);
    assert.ok(!JSON.stringify(t.h.sch.doc).includes('secret'));
  }
  // error and stopped end a turn like idle; a status while the send is in flight ends it too once it began, and the send's return only finishes
  for (const end of ['error', 'stopped', 'idle']) {
    const t = await wired();
    t.addRun('allow');
    t.ad.send = async () => { t.emit('working'); t.emit(end); };
    await t.h.advance(MIN);
    await t.tick();
    assert.deepStrictEqual([t.sets, t.w.busy('a1'), t.h.sch.doc.schedules[0].last?.outcome], [['allow', 'read-only'], false, 'sent'], end);
  }
  // the session ends in the turn: nothing to restore on it, the next start uses its own mode, the gate is free; a look is all it takes
  {
    const t = await wired();
    t.addRun('allow');
    t.ad.send = async () => { t.emit('working'); };
    await t.h.advance(MIN);
    await t.tick();
    assert.strictEqual(t.runs.modeOf('a1'), 'allow');
    await t.ad.stop('a1');
    t.last.delete('a1');
    assert.strictEqual(t.w.busy('a1'), false, 'an ended session is not held');
    assert.deepStrictEqual(t.sets, ['allow'], 'no call on a session that is gone');
    assert.strictEqual(t.a.runMode, undefined, 'the window is told');
    assert.strictEqual(t.a.permMode, 'read-only');
    const started: string[] = [];
    await startGuardOp({ refusal: async () => undefined }, { id: 'copilot', start: async (o) => (started.push(startModeOf(o)), 'a1') }, { cwd: '/w', permissionMode: t.a.permMode } as never);
    assert.deepStrictEqual(started, ['read-only'], 'a restart mid-turn starts in its own mode');
    // removed
    const r = await wired();
    r.addRun('allow');
    r.ad.send = async () => { r.emit('working'); };
    await r.h.advance(MIN);
    await r.tick();
    r.runs.forget('a1');
    assert.strictEqual(r.runs.busy('a1'), false);
  }
  // a restart in the middle of a turn: nothing in memory comes back, and the saved mode was never written
  {
    const t = await wired();
    t.addRun('allow');
    t.ad.send = async () => { t.emit('working'); };
    await t.h.advance(MIN);
    await t.tick();
    const fresh = new RunModes({ agents: t.agents, router: { forAgent: () => t.ad, adapterIdOf: () => 'copilot' }, statusBusy: () => false });
    assert.strictEqual(fresh.modeOf('a1'), undefined);
    assert.strictEqual(t.a.permMode, 'read-only');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'schedmode.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const banned of ['setModeOp', 'setSessionMode', '.store', 'validMode', 'permMode =', 'sessionModes']) assert.ok(!src.includes(banned), `schedmode.ts must not use ${banned}`);
  }
  // a switch or a restore that throws
  {
    const t = await wired();
    t.addRun('allow');
    const real = t.ad.setPermMode;
    t.ad.setPermMode = () => { throw new Error('x'); };
    await t.h.advance(MIN);
    await t.tick();
    assert.deepStrictEqual([t.h.sch.doc.schedules[0].last?.reason, t.w.busy('a1'), t.sentOut], ['mode-live', false, []], 'not sent');
    const u = await wired();
    u.addRun('allow');
    const set = u.ad.setPermMode;
    u.ad.send = async () => { u.emit('working'); u.ad.setPermMode = () => { throw new Error('x'); }; };
    await u.h.advance(MIN);
    await u.tick();
    u.emit('idle');
    await u.tick();
    assert.strictEqual(u.ad.isLive('a1'), false, 'stopped: its next start uses the saved mode');
    void real; void set;
    // no switch at all, or not live
    const no = await wired('read-only', { cfg: { omit: ['setPermMode'] } });
    no.addRun('read-only');
    const hold = (x: typeof no): NonNullable<ReturnType<typeof no.runs.reserve>> => x.runs.reserve('a1') as NonNullable<ReturnType<typeof no.runs.reserve>>;
    let k = hold(no);
    assert.strictEqual(no.runs.apply(no.a, 'allow', k), 'mode-live', 'FR-184: a live session that cannot switch (`refusesLive`)');
    assert.deepStrictEqual(no.runs.settle('a1', k, false), { started: false });
    k = hold(no);
    assert.strictEqual(no.runs.apply(no.a, undefined, k), 'mode-lacking', 'never read as a mode');
    no.runs.settle('a1', k, false);
    k = hold(no);
    assert.strictEqual(no.runs.apply(no.a, 'autopilot', k), 'mode-lacking');
    no.runs.settle('a1', k, false);
    const stopped = await wired();
    await stopped.ad.stop('a1');
    k = hold(stopped);
    assert.strictEqual(stopped.runs.apply(stopped.a, 'ask', k), 'mode-live', 'not live: the switch would do nothing');
    stopped.runs.settle('a1', k, false);
  }
  // item 7: remote control on: a raised mode is refused; a lowered one is no risk
  {
    const t = await wired('read-only', { remote: true });
    t.addRun('allow');
    await t.h.advance(MIN);
    await t.tick();
    assert.deepStrictEqual([t.h.sch.doc.schedules[0].last?.outcome, t.h.sch.doc.schedules[0].last?.reason, t.sets, t.sentOut], ['mode-refused', 'mode-live', [], []]);
    const lo = await wired('allow', { remote: true });
    lo.addRun('read-only');
    lo.ad.send = async () => { lo.emit('working'); };
    await lo.h.advance(MIN);
    await lo.tick();
    assert.deepStrictEqual(lo.sets, ['read-only']);
  }
  // item 6: the user's way down: a mode chosen during the turn (`setModeOp`) or Stop (`stopTurnOp`) replaces the run's at once
  {
    const t = await wired();
    t.addRun('allow');
    t.ad.send = async () => { t.emit('working'); };
    await t.h.advance(MIN);
    await t.tick();
    assert.strictEqual(t.a.runMode, 'allow', 'the window has the real mode');
    const saved: string[] = [];
    const ops = { agents: t.agents, router: { forAgent: () => t.ad } as never, store: { setPermMode: (_w: string, m: string) => { saved.push(m); return true; }, setSessionMode: () => true, setMaxAiCredits: () => true } as never, wsKey: () => '/w', endRunMode: (id: string) => t.runs.end(id) };
    assert.deepStrictEqual(setModeOp(ops, 'a1', 'read-only', {}), { ok: true, mode: 'read-only', pending: 0 });
    assert.deepStrictEqual([t.a.runMode, t.w.busy('a1') && t.last.get('a1') !== 'working', t.runs.modeOf('a1')], [undefined, false, undefined], 'brought down');
    assert.strictEqual(t.sets[t.sets.length - 1], 'read-only');
    assert.deepStrictEqual(t.shown, ['allow', undefined], 'and the window hears it');
    const u = await wired();
    u.addRun('allow');
    u.ad.send = async () => { u.emit('working'); };
    await u.h.advance(MIN);
    await u.tick();
    u.ad.interrupt = async () => undefined; // an app that says nothing more after Stop
    assert.strictEqual(await stopTurnOp({ agents: u.agents, router: { forAgent: () => u.ad } as never, wsKey: () => '/w', endRunMode: (id: string) => u.runs.end(id) }, 'a1'), undefined);
    assert.strictEqual(u.runs.modeOf('a1'), undefined, 'Stop ends it even if the app says nothing more');
    assert.strictEqual(u.sets[u.sets.length - 1], 'read-only');
    // what the user chose during the turn stands at its end
    const v = await wired();
    v.addRun('allow');
    v.ad.send = async () => { v.emit('working'); };
    await v.h.advance(MIN);
    await v.tick();
    v.a.permMode = 'ask';
    v.emit('idle');
    assert.strictEqual(v.sets[v.sets.length - 1], 'ask', 'back to what the session has now');
  }
  // re-review 3: Stop during the setup: no mode set, nothing sent, the session free
  {
    const t = await wired();
    let open = (): void => undefined;
    t.live.gate = new Promise((r) => { open = r; });
    t.addRun('allow');
    await t.h.advance(MIN);
    await t.tick();
    t.runs.end('a1');
    await t.tick();
    assert.strictEqual(await t.typed(), 'sent', 'free at once, while ensureLive still waits');
    open();
    await t.tick();
    assert.deepStrictEqual([t.sets, t.sentOut, t.announced], [[], [], []], 'no mode set, no send');
    assert.strictEqual(t.h.sch.doc.schedules[0].last?.outcome, 'skipped-busy');
    // the reviewer's N1 at the same point: a run whose setup was stopped cannot apply
    const u = await wired();
    const k = u.runs.reserve('a1');
    assert.ok(k);
    u.runs.end('a1');
    assert.strictEqual(u.runs.apply(u.a, 'allow', k as never), 'busy');
    assert.deepStrictEqual(u.sets, []);
  }
  // re-review 4: a send that never returns: a person's Stop or End brings the mode down and frees the session; its late return sets the mode right once more
  for (const how of ['Stop', 'End'] as const) {
    const t = await wired();
    t.addRun('allow');
    const s = t.holdSend();
    await t.h.advance(MIN);
    await s.entered;
    assert.strictEqual(t.runs.modeOf('a1'), 'allow');
    if (how === 'Stop') t.runs.end('a1');
    else t.runs.forget('a1');
    await t.tick();
    assert.deepStrictEqual([t.runs.modeOf('a1'), t.a.runMode, t.sets], [undefined, undefined, ['allow', 'read-only']], `${how}: the mode is down`);
    assert.strictEqual(await t.typed(), 'sent', `${how}: the person has the session`);
    const c = t.h.sch.doc.schedules[0];
    assert.deepStrictEqual([c.last?.outcome, c.done], ['failed', true], `${how}: the run's outcome is recorded, once`);
    if (how === 'End') assert.strictEqual(t.runs.busy('a1'), false, 'End: a hung send\'s count goes with the session');
    else assert.strictEqual(t.runs.busy('a1'), true, 'Stop: schedules wait for the send still inside the adapter');
    // a typed mode change while it is hung, then the hung send returns: the session's own mode is set again
    t.a.permMode = 'ask';
    s.release();
    await t.tick();
    if (how === 'Stop') assert.strictEqual(t.sets[t.sets.length - 1], 'ask', 'its late return sets the mode right');
    assert.strictEqual(t.runs.busy('a1'), false);
  }
  // one hung session does not stop the other schedules; its own schedule is not fired twice; a late answer is recorded
  {
    let release = (): void => undefined;
    const sent: string[] = [];
    const h = harness(undefined, { send: async (_f, p) => { sent.push(p); if (p === 'hangs') await new Promise<void>((r) => { release = r; }); return 'x'; } });
    const a = h.sch.save({ folder: '/w', prompt: 'hangs', every: 5, mode: 'ask' }, () => true);
    const b = h.sch.save({ folder: '/w', prompt: 'other', every: 5, mode: 'ask' }, () => true);
    assert.ok(a.ok && b.ok);
    h.sch.start();
    await h.advance(5 * MIN);
    assert.deepStrictEqual(sent, ['hangs'], 'the first is out');
    await h.advance(SEND_PATIENCE_MS);
    assert.deepStrictEqual(sent, ['hangs', 'other'], 'the other goes after a bounded wait');
    await h.advance(5 * MIN);
    await h.advance(SEND_PATIENCE_MS);
    assert.strictEqual(sent.filter((x) => x === 'hangs').length, 1, 'never twice');
    assert.strictEqual(sent.filter((x) => x === 'other').length, 2, 'the others keep their times');
    release();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(h.sch.doc.schedules[0].last?.outcome, 'sent', 'its answer is recorded when it comes');
    assert.ok((h.sch.doc.schedules[0].next ?? 0) > h.now, 'and it is due again');
  }
  // re-review 5: Stop brings the mode down before an app's stop that never answers
  {
    const u = await wired();
    u.addRun('allow');
    u.ad.send = async () => { u.emit('working'); };
    await u.h.advance(MIN);
    await u.tick();
    u.ad.interrupt = () => new Promise<void>(() => undefined);
    void stopTurnOp({ agents: u.agents, router: { forAgent: () => u.ad } as never, wsKey: () => '/w', endRunMode: (id: string) => u.runs.end(id) }, 'a1');
    assert.strictEqual(u.runs.modeOf('a1'), undefined, 'in the same tick');
    assert.strictEqual(u.sets[u.sets.length - 1], 'read-only');
  }
  // re-review 10: a schedule deleted while an earlier one's send is awaited does not fire
  {
    const t = await wired();
    const q1 = t.h.sch.save({ folder: '/w', prompt: 'first', at: t.h.now + MIN, mode: 'read-only' }, () => true);
    const q2 = t.h.sch.save({ folder: '/w', prompt: 'deleted', at: t.h.now + MIN, mode: 'read-only' }, () => true);
    assert.ok(q1.ok && q2.ok);
    const s = t.holdSend();
    await t.h.advance(MIN);
    await s.entered;
    assert.ok(t.h.sch.remove(q2.schedule.id));
    s.release();
    await t.tick();
    assert.deepStrictEqual(t.sentOut, ['first'], 'the deleted one never goes');
  }
  // the suspicion of a second send: `setMode` or `save` replaces the object while a tick awaits its send: `done` and `next` reach the stored one
  {
    const t = await wired();
    const s0 = t.addRun('read-only');
    const s = t.holdSend();
    await t.h.advance(MIN);
    await s.entered;
    assert.ok(t.h.sch.setMode(s0.id, 'ask').ok, 'replaces the object in flight');
    s.release();
    await t.tick();
    const stored = t.h.sch.doc.schedules[0];
    assert.deepStrictEqual([stored.done, stored.last?.outcome], [true, 'sent'], 'the stored object is finished');
    await t.h.advance(10 * MIN);
    await t.tick();
    assert.strictEqual(t.sentOut.length, 1, 'it does not run again');
    const r = await wired();
    const q = r.h.sch.save({ folder: '/w', prompt: 'p', every: 30, mode: 'read-only' }, () => true);
    assert.ok(q.ok);
    const m = r.holdSend();
    await r.h.advance(30 * MIN);
    await m.entered;
    assert.ok(r.h.sch.setMode(q.schedule.id, 'ask').ok);
    m.release();
    await r.tick();
    assert.ok((r.h.sch.doc.schedules[0].next ?? 0) > r.h.now, 'an interval\'s next time reaches the stored one too');
  }
  // the seal on a stored Allow all: missing, wrong or from another prompt reads as no mode, it waits, says why, and is not sent
  {
    const h = harness();
    const s = addAllow(h);
    assert.ok(s.modeSeal && s.modeSeal.startsWith('S:'), 'main seals it');
    assert.ok(!('modeSeal' in publicDoc(h.sch.doc).schedules[0]), 'the window never gets it');
    assert.ok(!h.sch.save({ ...publicSchedule(s), paused: true, mode: 'read-only' }, () => true).ok);
    assert.ok(h.sch.save({ ...publicSchedule(s), paused: true }, () => true).ok);
    assert.strictEqual(h.sch.doc.schedules[0].modeSeal, s.modeSeal, 'a plain save keeps it');
    const load = (o: Record<string, unknown>, deps: Partial<SchedulerDeps> = {}) => {
      const raw = JSON.parse(JSON.stringify({ pausedAll: false, schedules: [{ ...s, paused: false, ...o }] }));
      const x = harness(parseSchedules(JSON.stringify(raw), T0), deps);
      x.sch.start();
      return x;
    };
    assert.strictEqual(load({}).sch.doc.schedules[0].mode, 'allow', 'as it was written');
    for (const [why, o, deps] of [
      ['no seal', { modeSeal: undefined }, {}],
      ['a made-up seal', { modeSeal: 'S:["forged"]' }, {}],
      ['not decryptable', { modeSeal: 'junk' }, {}],
      ['another prompt', { prompt: 'delete everything' }, {}],
      ['another app', { modeFor: { app: 'claude' } }, {}],
      ['an old seal with the time changed', { every: 5, next: undefined }, {}],
      ['an old seal with the limit changed', { cap: { amount: 999, unit: 'aiu' } }, {}],
      ['no safe storage', {}, { seal: undefined }],
      ['safe storage failing', {}, { seal: sealFrom({ available: () => true, encrypt: () => { throw new Error('x'); }, decrypt: () => { throw new Error('x'); } }) }],
    ] as Array<[string, Record<string, unknown>, Partial<SchedulerDeps>]>) {
      const x = load(o, deps);
      const c = x.sch.doc.schedules[0];
      assert.deepStrictEqual([c.mode, c.modeFor, c.modeSeal, c.modeLost, c.last?.outcome, c.last?.reason, waitingForMode(c)], [undefined, undefined, undefined, 'no-seal', 'skipped-mode', 'no-seal', true], why);
    }
    // a prompt of any length seals: a digest, not the text; an edit of the time in the app seals again and needs no question
    const long0 = 'y'.repeat(9_500);
    const lh = harness();
    const ls = addAllow(lh, { prompt: long0 });
    assert.ok((ls.modeSeal ?? '').length < 100, 'small whatever the prompt');
    const back = harness(parseSchedules(JSON.stringify(lh.sch.doc), T0));
    back.sch.start();
    assert.strictEqual(back.sch.doc.schedules[0].mode, 'allow', 'a long prompt keeps its Allow all over a restart');
    assert.ok(lh.sch.save({ id: ls.id, edit: true, prompt: long0, every: 45, mode: 'allow' }, () => true).ok);
    const back2 = harness(parseSchedules(JSON.stringify(lh.sch.doc), T0));
    back2.sch.start();
    assert.strictEqual(back2.sch.doc.schedules[0].mode, 'allow', 'the time edited in the app stays sealed');
    // re-review 11: overdue at the same start, later due times and later launches keep saying why, and choosing clears it
    const od = load({ next: T0 - 5 * MIN, modeSeal: undefined });
    assert.deepStrictEqual([od.sch.doc.schedules[0].last?.outcome, od.sch.doc.schedules[0].last?.reason, od.sch.doc.schedules[0].modeLost], ['skipped-mode', 'no-seal', 'no-seal'], 'overdue does not overwrite it');
    await od.advance(30 * MIN);
    assert.strictEqual(od.sch.doc.schedules[0].last?.reason, 'no-seal', 'nor does a due time');
    const od2 = harness(parseSchedules(JSON.stringify(od.sch.doc), od.now));
    od2.sch.start();
    assert.strictEqual(od2.sch.doc.schedules[0].modeLost, 'no-seal', 'nor a later launch: it keeps asking');
    assert.ok(od2.sch.save({ ...publicSchedule(od2.sch.doc.schedules[0]), paused: true }, () => true).ok);
    assert.strictEqual(od2.sch.doc.schedules[0].modeLost, 'no-seal', 'nor a Pause');
    assert.ok(od2.sch.setMode(od2.sch.doc.schedules[0].id, 'ask').ok);
    assert.strictEqual(od2.sch.doc.schedules[0].modeLost, undefined, 'a choice clears it');
    // no store at all: Allow all works until the app closes, then it asks again
    const none = harness(undefined, { seal: undefined });
    const n = addAllow(none);
    assert.strictEqual(n.mode, 'allow');
    assert.strictEqual(n.modeSeal, undefined);
    await none.advance(30 * MIN);
    assert.deepStrictEqual(none.sent, ['nightly@allow']);
    const again = harness(parseSchedules(JSON.stringify(none.sch.doc), none.now), { seal: undefined });
    again.sch.start();
    assert.strictEqual(again.sch.doc.schedules[0].mode, undefined);
    assert.strictEqual(sealFrom({ available: () => false, encrypt: () => 'x', decrypt: () => 'x' }).encrypt('t'), undefined);
    // Autopilot stays as a refused value (spec 099 T097 must seal it when it sets it)
    const ap = harness({ pausedAll: false, schedules: [stored({ mode: 'autopilot' })] });
    ap.sch.start();
    assert.strictEqual(ap.sch.doc.schedules[0].mode, 'autopilot');
    // the whole prompt goes with the question, whatever its length
    const long = 'x'.repeat(9_000) + ' THE-TAIL';
    const a = h.sch.askMode({ folder: '/w', prompt: long, every: 30, mode: 'allow' });
    assert.ok(a.ok && a.needed && a.prompt.endsWith('THE-TAIL') && !a.body.includes('THE-TAIL'), 'the tail is shown');
    assert.ok(a.ok && a.needed && /this folder's GitHub Copilot agent, now Ada/.test(a.body), 'a folder schedule is bound to the app, and says so');
    const b = h.sch.askMode({ folder: '/w', prompt: 'p', every: 30, target: { session: 's1', agent: 'copilot' }, mode: 'allow' });
    assert.ok(b.ok && b.needed && /run Ada \(GitHub Copilot\)/.test(b.body));
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
    const rel = (f: string): string => path.relative(root, f).replace(/\\/g, '/');
    const writers: string[] = [];
    for (const f of walk(path.join(root, 'main'))) {
      const name = rel(f);
      if (name === 'main/schedules.ts' || name === 'main/ipc/schedules.ts') continue;
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      for (const l of lines) if (/\.(setMode|askMode)\(/.test(l) || /[sS]cheduler\w*(\(\))?[!?]*\.save\(/.test(l)) writers.push(`${name}: ${l.trim().slice(0, 60)}`);
    }
    assert.deepStrictEqual(writers, [], 'one writer of a schedule\'s mode: ipc/schedules.ts');
    const ipc = fs.readFileSync(path.join(root, 'main', 'ipc', 'schedules.ts'), 'utf8');
    for (const c of ['schedules:askMode', 'schedules:setMode', 'schedules:save']) assert.ok(new RegExp(`'${c}', (async )?\\(e[^\\n]*(\\n\\s*if \\()?!fromApp\\(e\\)`).test(ipc), `${c} checks fromApp itself`);
    assert.strictEqual((ipc.match(/await s\.readyForMode\(/g) ?? []).length, 2, 'a save and a choice read the policy first');
    assert.strictEqual((ipc.match(/clean\(s\.(save|setMode)\(/g) ?? []).length, 2, 'the seal does not reach the window');
    for (const f of walk(path.join(root, 'main', 'mcp')).concat(path.join(root, 'main', 'remoteops.ts'), path.join(root, 'main', 'mcpipc.ts'))) {
      const x = fs.readFileSync(f, 'utf8');
      assert.ok(!/from '\.\.?\/(\.\.\/)?(main\/)?schedules'|schedules:(save|setMode|askMode)|\.saveSchedule\b|\.setScheduleMode\b/.test(x.replace(/import type[^\n]*/g, '')), `${f} must not reach a schedule's mode`);
    }
    // main passes every part of the wiring the test above runs, and to the right place
    const m = fs.readFileSync(path.join(root, 'main', 'main.ts'), 'utf8');
    for (const [piece, why] of [
      ['send: (_folder, prompt, s) => scheduleWiring.send(s, prompt)', 'the scheduler sends through the wiring'],
      ['busy: scheduleWiring.busy', 'busy includes the gate'],
      ['modeCheck: scheduleWiring.modeCheck', 'the check at a run'],
      ['modeAgent: scheduleWiring.modeAgent', 'the confirmation\'s names'],
      ['orgWords: scheduleWiring.orgWords', 'the refusal at a save'],
      ['primeMode: scheduleWiring.primeMode', 'a save reads the policy'],
      ['seal: sealFrom(safeStorageCodec)', 'a stored Allow all is sealed'],
      ['orgNow: (a, mode, raised) => orgPolicies.runRefusalNow(', 'a policy not read refuses a raised mode'],
      ['orgRun: (a, mode, raised) => orgPolicies.runRefusal(', 'the read at a run'],
      ['remote: (id) => remoteOps.has(id)', 'remote control'],
      ['statusBusy: busyStatus', 'the gate reads the status'],
      ['runModes.onStatus(e.sessionId, e.status)', 'a turn\'s end restores'],
      ['scheduleWiring.userSend<', 'a typed message goes through the gate'],
      ['endRunMode: (id) => runModes.end(id)', 'Stop and a chosen mode bring it down'],
      ['forgetRunMode: (id) => runModes.forget(id)', 'a removed agent'],
      ['runModeOf: (id) => runModes.modeOf(id)', 'remote control cannot start during a raised turn'],
      ['runModes.modeOf(a.id) ?? a.permMode', 'the activity log has the real mode'],
      ["toRenderer('schedule:mode'", 'the window is told'],
    ]) assert.ok(m.includes(piece), `main.ts: ${why} (${piece})`);
    assert.ok(fs.readFileSync(path.join(root, 'main', 'ipc', 'agents.ts'), 'utf8').includes('deps.forgetRunMode?.(id); // spec 044'), 'ipc/agents.ts: End frees the session first');
    assert.ok(fs.readFileSync(path.join(root, 'main', 'ipc', 'remote.ts'), 'utf8').includes('deps.runModeOf?.(id) ??'), 'ipc/remote.ts: the real mode');
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
