/**
 * Spec 099 T022..T028 on the fake Copilot SDK: no runtime, no account, no credits. Event shapes replay the probes (T090, T093).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import type { FakeSession } from './fakes/copilot-sdk';
import { COPILOT_CAPABILITIES, COPILOT_STEP_NO_ANSWER, COPILOT_STOP_WAIT, COPILOT_TURN_ON_OFF, COPILOT_TURN_ON_STOPPED, copilotTaskEnd } from '../src/adapters/copilot';
import { AUTOPILOT_ANSWER, CLOCK_SAMPLE_MS } from '../src/adapters/autopilot';
import { AUTOPILOT_ONE_RUN, LINE_BACKSTOP, LINE_CAP_NOT_RESTORED, LINE_CLOSED, LINE_SELF_STARTED, LINE_UNCONFIRMED } from '../src/adapters/autopilotHost';
import type { AutopilotTuning } from '../src/adapters/autopilotHost';
import { MIN_CAP } from '../src/shared/credits';
import { eventProblems } from '../src/adapters/eventguard';
import type { AgentEvent } from '../src/adapters/types';

const NANO = 1e9;
const tick = async (n = 6): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const until = async (ok: () => boolean, what: string): Promise<void> => { for (let i = 0; i < 2000 && !ok(); i++) await new Promise((r) => setTimeout(r, 1)); assert.ok(ok(), what); };
/** FR-048b: a promise that must settle, waited for with `until`, so a hang fails with `what` instead of stalling the suite. */
const settles = async <T>(p: Promise<T>, what: string): Promise<T> => { let out: { v: T } | undefined; void p.then((v) => { out = { v }; }, () => undefined); await until(() => out !== undefined, what); return out!.v; };
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-ap-copilot-'));
const cont = { type: 'user.message', data: { content: '', source: 'autopilot', agentMode: 'autopilot', isAutopilotContinuation: true } };

interface Rig { ad: FakeCopilot; client: FakeClient; s: FakeSession; sid: string; events: AgentEvent[]; ap: () => Array<Extract<AgentEvent, { type: 'autopilot' }>>; order: () => string[]; lines: () => string[] }
async function rig(o: { mode?: 'allow' | 'ask'; cap?: number; tuning?: AutopilotTuning; client?: FakeClient } = {}): Promise<Rig> {
  const client = o.client ?? new FakeClient();
  const ad = new FakeCopilot(client, undefined, { waitMs: 30, ...o.tuning });
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  const sid = await ad.start({ workspace: ws, permissionMode: o.mode ?? 'allow', quiet: true, ...(o.cap ? { maxAiCredits: o.cap } : {}) });
  const s = client.last;
  return {
    ad, client, s, sid, events,
    ap: () => events.filter((e) => e.type === 'autopilot') as Array<Extract<AgentEvent, { type: 'autopilot' }>>,
    order: () => s.calls.filter((c) => ['mode.set', 'abort', 'send'].includes(c.name)).map((c) => (c.name === 'mode.set' ? `mode:${(c.args[0] as { mode: string }).mode}` : c.name)),
    lines: () => events.filter((e) => e.type === 'status' && e.intent).map((e) => (e as { intent: string }).intent),
  };
}
const fire = (s: FakeSession, e: { type: string; data: unknown; agentId?: string }): void => s.handler?.(e);
const reasons = (r: Rig): unknown[] => r.ap().filter((e) => e.phase === 'ended').map((e) => e.reason);
const valid = (r: Rig): void => { for (const e of r.events) assert.deepStrictEqual(eventProblems(e), [], `event ${e.type} is valid`); };

/**
 * FR-059 round 6: `mode.set` calls answered in the order they were made, as the runtime does; the first `mode:autopilot` is held until
 * `release()` (or rejected with `fail()`), and later calls wait behind it. `failNext` makes the next held-free `mode:autopilot` reject.
 */
function orderedModes(s: FakeSession): { asked: () => boolean; release: () => void; fail: () => void; failNextAutopilot: () => void } {
  const set = s.rpc.mode.set.bind(s.rpc.mode);
  let chain: Promise<unknown> = Promise.resolve();
  let held: { res: () => void; rej: (e: Error) => void } | undefined;
  let asked = false;
  let failNext = false;
  s.rpc.mode.set = (a: unknown) => {
    const mode = (a as { mode: string }).mode;
    const first = mode === 'autopilot' && !asked;
    if (first) asked = true;
    const reject = !first && mode === 'autopilot' && failNext;
    if (reject) failNext = false;
    const gate = first ? new Promise<void>((res, rej) => { held = { res, rej }; }) : Promise.resolve();
    const p = chain.then(() => gate).then(() => (reject ? Promise.reject(new Error('mode refused')) : set(a)));
    chain = p.catch(() => undefined);
    return p;
  };
  return { asked: () => asked, release: () => held?.res(), fail: () => held?.rej(new Error('mode refused')), failNextAutopilot: () => { failNext = true; } };
}

async function main(): Promise<void> {
  process.exitCode = 1;
  assert.strictEqual(COPILOT_CAPABILITIES.autopilot?.capMin, MIN_CAP, 'T022: the capability\'s smallest cap is the runtime\'s own MIN_CAP (D9), never a copy of the number');
  assert.deepStrictEqual({ ...COPILOT_CAPABILITIES.autopilot }, { capUnit: 'aiu', attachments: true, planApproval: true, verified: false, capMin: 30 }, 'T022: capability, not verified; its smallest cap (D9) is the adapter\'s own');

  // FR-050: Stop acts before anything is awaited: a hung limit answer and a sign-in refresh hold nothing back (Phase 3)
  {
    const r = await rig();
    await r.ad.setAutopilot!(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'go' });
    const live = (r.ad as unknown as { sessions: Map<string, { limitRequestId?: string }> }).sessions.get(r.sid)!;
    live.limitRequestId = 'stuck';
    (r.s.rpc as unknown as { ui: unknown }).ui = { handlePendingSessionLimitsExhausted: () => new Promise(() => undefined) };
    void r.ad.interrupt!(r.sid);
    assert.deepStrictEqual(reasons(r), ['stopped'], 'ended in the same tick as Stop');
    const q = await rig();
    await q.ad.setAutopilot!(q.sid, { limit: 5 });
    await q.ad.send(q.sid, { text: 'go' });
    (q.ad as unknown as { refreshing: Promise<void> }).refreshing = new Promise(() => undefined);
    void q.ad.setAutopilot!(q.sid, null, 'stopped');
    assert.deepStrictEqual(reasons(q), ['stopped'], 'a refresh does not hold a stop back');
    (q.ad as unknown as { refreshing?: Promise<void> }).refreshing = undefined;
  }

  // review of #982, finding 2: Autopilot off during a run, and Stop, act at once but hold a place in the queue until the run's stop is done, so a turn-on
  // right after them cannot race the old run's late abort (it would end run 2) or its cap restore
  for (const how of ['off', 'stop'] as const) {
    const r = await rig({ tuning: { waitMs: 60_000 } }); // the abort is held by the test: the stop's own bounds must not run out under load (a failed-closed session would refuse the turn-on)
    await r.ad.setAutopilot!(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'go' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => { release = res; });
    const real = r.s.abort;
    r.s.abort = async (): Promise<void> => { await real(); await gate; }; // the old run's abort answers late
    const stop = how === 'off' ? r.ad.setAutopilot!(r.sid, null, 'stopped') : r.ad.interrupt!(r.sid);
    void stop.catch(() => undefined);
    const before = r.order().filter((x) => x === 'mode:autopilot').length;
    const again = r.ad.setAutopilot!(r.sid, { limit: 5 }); // the user turns Autopilot on again at once
    void again.catch(() => undefined);
    await until(() => r.order().includes('abort'), `${how}: the old run's abort started at once`);
    await tick(20);
    assert.strictEqual(r.order().filter((x) => x === 'mode:autopilot').length, before, `${how}: the turn-on waits for the old run's stop to finish (no race with its late abort)`);
    release();
    await settles(stop, `${how}: the stop finished`);
    await settles(again, `${how}: the turn-on went through after it`);
    assert.strictEqual(r.order().filter((x) => x === 'mode:autopilot').length, before + 1, `${how}: and then it happened`);
    assert.ok(r.order().lastIndexOf('mode:autopilot') > r.order().indexOf('abort'), `${how}: after the abort, never before it`);
  }

  // only in Allow all
  {
    const r = await rig({ mode: 'ask' });
    await assert.rejects(r.ad.setAutopilot(r.sid, { limit: 5 }), /only in Allow all/);
    assert.deepStrictEqual(r.order(), [], 'nothing was set');
    await assert.rejects((await rig()).ad.setAutopilot('nope', { limit: 5 }));
  }

  // to done: mode, agentMode with attachments, count, task_complete then idle; stays on Autopilot (D8), the broker still answers, no setApproveAll
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    assert.strictEqual(r.s.mode, 'autopilot', 'FR-010: mode.set autopilot');
    const att = path.join(ws, 'a.txt');
    fs.writeFileSync(att, 'x');
    await r.ad.send(r.sid, { text: 'do it', attachments: [{ path: att, kind: 'file' } as never] });
    const sent = r.s.calls.find((c) => c.name === 'send')!.args[0] as { prompt: string; agentMode: string; attachments: unknown[] };
    assert.strictEqual(sent.agentMode, 'autopilot');
    assert.strictEqual(sent.prompt, 'do it');
    assert.strictEqual(sent.attachments.length, 1, 'D10: attachments go with the Autopilot send');
    assert.strictEqual(r.ap()[0].phase, 'started');
    // a late idle from before the run's first event is not the end (the review's "idle before working")
    fire(r.s, { type: 'session.idle', data: {} });
    assert.deepStrictEqual(reasons(r), [], 'idle before working is not turn over');
    fire(r.s, { type: 'user.message', data: { content: 'do it', agentMode: 'autopilot' } });
    fire(r.s, { type: 'assistant.turn_start', data: {} });
    fire(r.s, cont);
    fire(r.s, cont);
    assert.deepStrictEqual(r.ap().filter((e) => e.phase === 'continued').map((e) => e.n), [1, 2], 'T093: one per marker');
    fire(r.s, { type: 'assistant.turn_start', data: {} });
    fire(r.s, { type: 'assistant.turn_start', data: {} });
    assert.strictEqual(r.ap().filter((e) => e.phase === 'continued').length, 2, 'T090: assistant.turn_start is not a continuation');
    const cfg = r.client.created[0] as { onPermissionRequest: (q: unknown) => Promise<{ kind: string }> };
    const a = await cfg.onPermissionRequest({ kind: 'shell', fullCommandText: 'ls' });
    assert.strictEqual(a.kind.startsWith('approve') || a.kind === 'approved', true, 'FR-010: the broker answers in Allow all');
    fire(r.s, { type: 'session.task_complete', data: { success: true, summary: 'ok' } });
    assert.deepStrictEqual(reasons(r), [], 'the end waits for session.idle');
    fire(r.s, { type: 'session.idle', data: {} });
    await tick();
    assert.deepStrictEqual(reasons(r), ['done']);
    assert.strictEqual(r.s.mode, 'autopilot', 'D8, FR-041: stays in autopilot after done');
    assert.ok(!r.order().includes('abort'), 'nothing to abort after done');
    // the next message is a new run
    await r.ad.send(r.sid, { text: 'next' });
    assert.strictEqual(r.ap().filter((e) => e.phase === 'started').length, 2, 'D8: a new run');
    assert.notStrictEqual(r.ap()[0].runId, r.ap().at(-1)!.runId);
    valid(r);
  }

  // copilotTaskEnd
  assert.strictEqual(copilotTaskEnd({ success: true }), 'done');
  assert.strictEqual(copilotTaskEnd({ outcome: 'completed' }), 'done');
  assert.strictEqual(copilotTaskEnd({ outcome: 'blocked' }), 'blocked');
  assert.strictEqual(copilotTaskEnd({ outcome: 'continue' }), null, 'the runtime rejected the completion: not done');
  assert.strictEqual(copilotTaskEnd({ success: false }), null);

  // a rejected completion keeps counting; blocked follows S3
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'x' });
    fire(r.s, { type: 'assistant.turn_start', data: {} });
    fire(r.s, { type: 'session.task_complete', data: { outcome: 'continue', success: false } });
    fire(r.s, cont);
    assert.strictEqual(r.ap().at(-1)!.phase, 'continued');
    fire(r.s, { type: 'session.task_complete', data: { outcome: 'blocked' } });
    fire(r.s, { type: 'session.idle', data: {} });
    await tick();
    assert.deepStrictEqual(reasons(r), ['blocked']);
    assert.strictEqual(r.s.mode, 'interactive', 'S3: blocked leaves Autopilot');
  }

  // to the limit: FR-050's order, n stays at the limit, no event after; the session is out of Autopilot (S3)
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 1 });
    await r.ad.send(r.sid, { text: 'x' });
    fire(r.s, { type: 'assistant.turn_start', data: {} });
    fire(r.s, cont);
    fire(r.s, cont);
    await tick();
    assert.deepStrictEqual(reasons(r), ['limit']);
    assert.strictEqual(r.ap().at(-1)!.n, 1);
    const ord = r.order();
    assert.deepStrictEqual(ord.slice(ord.indexOf('send') + 1), ['mode:interactive', 'abort'], 'FR-050: mode.set interactive, then abort');
    // a message after that is a plain one
    await r.ad.send(r.sid, { text: 'plain' });
    const last = r.s.calls.filter((c) => c.name === 'send').at(-1)!.args[0] as { agentMode?: string };
    assert.strictEqual(last.agentMode, undefined, 'no goal mode after the end');
    assert.strictEqual(r.ap().filter((e) => e.phase === 'started').length, 1);
    valid(r);
  }

  // a continuation after a confirmed stop: the app is still going, so the stop repeats and nothing is counted
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 1 });
    await r.ad.send(r.sid, { text: 'x' });
    fire(r.s, cont);
    fire(r.s, cont);
    await tick();
    const before = r.s.calls.filter((c) => c.name === 'abort').length;
    fire(r.s, cont);
    await tick();
    assert.strictEqual(r.s.calls.filter((c) => c.name === 'abort').length, before + 1, 'the guard interrupts a later continuation');
    assert.strictEqual(r.ap().filter((e) => e.phase === 'continued').length, 1, 'not counted');
    assert.deepStrictEqual(reasons(r), ['limit'], 'not a new end');
  }

  // Stop mid-run through interrupt
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'x' });
    await r.ad.interrupt(r.sid);
    assert.deepStrictEqual(reasons(r), ['stopped']);
    const ord = r.order();
    assert.deepStrictEqual(ord.slice(ord.indexOf('send') + 1), ['mode:interactive', 'abort']);
    assert.strictEqual(r.lines().at(-1), 'Aborted');
  }

  // FR-051: a stricter mode ends the run first
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'x' });
    r.ad.setPermMode(r.sid, 'ask');
    await tick();
    assert.deepStrictEqual(reasons(r), ['stopped']);
    assert.strictEqual(r.s.mode, 'interactive');
    await assert.rejects(r.ad.setAutopilot(r.sid, { limit: 5 }), /only in Allow all/, 'SC-002');
  }

  // cap: a value below 30 is raised (D9); the lower wins and never loosens; the runtime's request answered cancel; restored; nothing saved (FR-022)
  {
    const r = await rig({ cap: 100 });
    const limits = (): AgentEvent[] => r.events.filter((e) => e.type === 'limit');
    const updates = (): unknown[] => r.s.calls.filter((c) => c.name === 'options.update').map((c) => (c.args[0] as { sessionLimits?: unknown }).sessionLimits).filter((x) => x !== undefined);
    await r.ad.setAutopilot(r.sid, { limit: 5, cap: 10 });
    assert.deepStrictEqual(updates(), [], 'nothing until a run');
    await r.ad.send(r.sid, { text: 'x' });
    assert.deepStrictEqual(updates(), [{ maxAiCredits: 30 }], 'D9: raised to 30');
    fire(r.s, { type: 'session.session_limits_changed', data: { sessionLimits: { maxAiCredits: 30 } } });
    assert.deepStrictEqual(limits(), [], 'the Autopilot cap never reaches main as a changed cap, so it is never saved for the folder');
    // setCap during a run: a higher one never lifts it
    await r.ad.setCap(r.sid, 200);
    assert.deepStrictEqual(updates(), [{ maxAiCredits: 30 }], 'FR-022: a higher value waits for the end');
    // a lower one applies now
    await r.ad.setCap(r.sid, 25 + 15);
    assert.deepStrictEqual(updates(), [{ maxAiCredits: 30 }], 'still the lower');
    fire(r.s, { type: 'assistant.turn_start', data: {} });
    fire(r.s, { type: 'session_limits_exhausted.requested', data: { requestId: 'q1', maxAiCredits: 30, usedAiCredits: 30 } });
    await tick();
    const answer = r.s.calls; void answer;
    assert.deepStrictEqual(reasons(r), ['cap']);
    assert.ok(!r.events.some((e) => e.type === 'limit' && e.phase === 'exhausted'), 'FR-022: no card: the restored cap is not reached');
    assert.deepStrictEqual(updates().at(-1), { maxAiCredits: 40 }, 'FR-022: restored to the session cap');
    fire(r.s, { type: 'session_limits_exhausted.completed', data: { requestId: 'q1', response: { action: 'cancel' } } });
    assert.ok(!r.events.some((e) => e.type === 'limit' && e.phase === 'resolved'), 'its completion is hidden too');
    valid(r);
  }

  // a higher Autopilot cap does not loosen the session's; none restored when nothing changed
  {
    const r = await rig({ cap: 50 });
    await r.ad.setAutopilot(r.sid, { limit: 5, cap: 80 });
    await r.ad.send(r.sid, { text: 'x' });
    const ups = r.s.calls.filter((c) => c.name === 'options.update' && (c.args[0] as { sessionLimits?: unknown }).sessionLimits !== undefined);
    assert.strictEqual(ups.length, 0, 'the lower (the session) is already in force');
  }

  // at or below what was spent is refused, with both numbers; a run that crosses the cap through usage ends with cap
  {
    const r = await rig();
    fire(r.s, { type: 'session.usage_checkpoint', data: { totalNanoAiu: 40 * NANO } });
    await assert.rejects(r.ad.setAutopilot(r.sid, { limit: 5, cap: 35 }), /35 AI credits.*\(40\)/);
    assert.strictEqual(r.s.mode, 'interactive', 'refused: nothing changed');
    await r.ad.setAutopilot(r.sid, { limit: 5, cap: 41 });
    await r.ad.send(r.sid, { text: 'x' });
    r.s.handler?.({ type: 'assistant.usage', data: { copilotUsage: { totalNanoAiu: 2 * NANO } } });
    await tick();
    assert.deepStrictEqual(reasons(r), ['cap']);
    assert.ok(!r.events.some((e) => e.type === 'limit' && e.phase === 'exhausted'), 'no session cap at all: no card');
    assert.deepStrictEqual(r.ap().at(-1)!.spend, { unit: 'aiu', value: 42 });
  }

  // a failed restore leaves the tighter cap and says so
  {
    const r = await rig({ cap: 100 });
    await r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 });
    await r.ad.send(r.sid, { text: 'x' });
    r.s.rpc.options.update = async () => { throw new Error('no'); };
    await r.ad.interrupt(r.sid);
    await tick();
    assert.ok(r.lines().includes(LINE_CAP_NOT_RESTORED));
  }

  // a held message starts no run: over the session's cap, and a sandbox hold (the review's "send returns with no status")
  {
    const r = await rig({ cap: 30 });
    fire(r.s, { type: 'session.usage_checkpoint', data: { totalNanoAiu: 31 * NANO } });
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'x' });
    assert.deepStrictEqual(r.ap(), [], 'over the cap: held, no run armed');
    assert.ok(!r.order().includes('send'));
    await r.ad.interrupt(r.sid); // nothing to end but the state: no ended event for a run that never began
    assert.deepStrictEqual(reasons(r), []);
    const h = await rig();
    await h.ad.setAutopilot(h.sid, { limit: 5 });
    (h.ad as unknown as { sessions: Map<string, { sandboxHold?: unknown }> }).sessions.get(h.sid)!.sandboxHold = { reason: 'held' };
    await h.ad.send(h.sid, { text: 'x' });
    assert.deepStrictEqual(h.ap(), [], 'sandbox hold: no run armed');
  }

  // merge with spec 052 FR-229: a send waits for a Stop's late calls; Autopilot turned off during that wait means a plain message, not a goal
  {
    type LiveLate = { lateCalls?: Set<Promise<void>> };
    const hold = (r: Rig): (() => void) => {
      let land: () => void = () => undefined;
      const p = new Promise<void>((res) => { land = res; });
      const live = (r.ad as unknown as { sessions: Map<string, LiveLate> }).sessions.get(r.sid)!;
      (live.lateCalls ??= new Set()).add(p);
      void p.then(() => live.lateCalls!.delete(p));
      return land;
    };
    const r = await rig({ tuning: { waitMs: 2000 } });
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    const land = hold(r);
    const sent = r.ad.send(r.sid, { text: 'after the stop' });
    await tick();
    assert.ok(!r.order().includes('send'), 'the send waits for the late call');
    const off = r.ad.setAutopilot(r.sid, null); // the person turns Autopilot off while it waits (its mode change waits its turn in the queue)
    land();
    assert.strictEqual(await sent.then(() => 'sent', (e: Error) => e.message), 'sent', 'Autopilot went off during the wait: the message still goes');
    await settles(off, 'the queued Autopilot off settles');
    const s1 = r.s.calls.filter((c) => c.name === 'send').map((c) => c.args[0] as { prompt: string; agentMode?: string });
    assert.deepStrictEqual(s1.map((x) => [x.prompt, x.agentMode ?? 'none']), [['after the stop', 'none']], 'Autopilot went off during the wait: a plain message, not a goal');
    assert.ok(!r.ap().some((e) => e.phase === 'started'), 'no run started after Autopilot went off');
    // a Stop during the wait drops the message (FR-229), Autopilot or not
    const q = await rig({ tuning: { waitMs: 2000 } });
    await q.ad.setAutopilot(q.sid, { limit: 5 });
    const land2 = hold(q);
    const sent2 = q.ad.send(q.sid, { text: 'dropped' });
    await tick();
    await q.ad.interrupt(q.sid);
    land2();
    await sent2;
    assert.ok(!q.s.calls.some((c) => c.name === 'send'), 'a Stop during the wait drops the message');
  }

  // FR-059 (review on #967): Stop, or Autopilot off, while the Autopilot cap update waits (a gated fake, no timer): the session's own cap goes
  // back, no run starts, and the next Autopilot send is not refused. A Stop drops the message; Autopilot off alone sends it plain.
  for (const how of ['stop', 'off', 'stop-now', 'stop-slow'] as const) {
    const r = await rig({ cap: 100, tuning: { waitMs: 2000 } });
    await r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 });
    const caps: unknown[] = [];
    let open: () => void = () => undefined;
    let gated = true;
    r.s.rpc.options.update = async (a: unknown) => {
      caps.push((a as { sessionLimits?: unknown }).sessionLimits);
      if (gated) { gated = false; await new Promise<void>((res) => { open = res; }); }
    };
    const sent = r.ad.send(r.sid, { text: 'the goal' });
    await until(() => caps.length === 1, `${how}: the cap update is in flight`);
    // Stop does not queue; Autopilot off reads off at once and its mode change waits its turn (FR-059 queue, round 6)
    // 'stop-now': the cap update answers right as the Stop is made. 'stop-slow': the Stop's first wait (cancelling a limit request) has not
    // answered when the cap update does, so only a Stop that reads Autopilot off at once keeps this message from being a goal
    let slow: () => void = () => undefined;
    if (how === 'stop-slow') {
      (r.ad as unknown as { sessions: Map<string, { limitRequestId?: string }> }).sessions.get(r.sid)!.limitRequestId = 'limit-1';
      (r.s.rpc as unknown as { ui: unknown }).ui = { handlePendingSessionLimitsExhausted: () => new Promise<void>((res) => { slow = res; }) };
    }
    const off = how === 'off' ? r.ad.setAutopilot(r.sid, null) : how === 'stop' ? Promise.resolve() : r.ad.interrupt(r.sid);
    if (how === 'stop') await r.ad.interrupt(r.sid);
    open();
    if (how === 'stop-slow') { await until(() => caps.length === 2, 'stop-slow: the cap goes back while the Stop still waits'); slow(); }
    assert.strictEqual(await settles(sent.then(() => 'ok', (e: Error) => e.message), `${how}: the send settles`), 'ok', `${how} during the cap update: the send is not refused`);
    await settles(off, `${how}: the off settles`);
    assert.deepStrictEqual(caps, [{ maxAiCredits: 40 }, { maxAiCredits: 100 }], `${how} during the cap update: the session's own cap goes back`);
    assert.ok(!r.lines().includes(LINE_CAP_NOT_RESTORED), `${how}: restored, so not said`);
    assert.ok(!r.ap().some((e) => e.phase === 'started'), `${how} during the cap update: no run started`);
    const sends = (): Array<[string, string]> => r.s.calls.filter((c) => c.name === 'send').map((c) => c.args[0] as { prompt: string; agentMode?: string }).map((x) => [x.prompt, x.agentMode ?? 'none']);
    if (how !== 'off') assert.deepStrictEqual(sends(), [], 'a Stop during the cap update drops the message');
    else {
      assert.deepStrictEqual(sends(), [['the goal', 'none']], 'Autopilot off during the cap update: a plain message, never a goal');
      fire(r.s, { type: 'session.idle', data: {} }); // that plain turn ends
    }
    await r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 });
    assert.strictEqual(await r.ad.send(r.sid, { text: 'next goal' }).then(() => 'ok', (e: Error) => e.message), 'ok', `${how}: a later Autopilot send works`);
    assert.strictEqual(sends().at(-1)![1], 'autopilot', `${how}: the later send starts its run`);
    assert.strictEqual(r.ap().filter((e) => e.phase === 'started').length, 1);
  }

  // FR-059 round 2 (review on #967, probe C): a Stop while the cap restore waits (Autopilot went off during the cap update) still drops the message
  {
    const r = await rig({ cap: 100, tuning: { waitMs: 2000 } });
    await r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 });
    const caps: unknown[] = [];
    const opens: Array<() => void> = [];
    r.s.rpc.options.update = async (a: unknown) => {
      caps.push((a as { sessionLimits?: unknown }).sessionLimits);
      await new Promise<void>((res) => { opens.push(res); });
    };
    const sent = r.ad.send(r.sid, { text: 'goal C' });
    await until(() => caps.length === 1, 'probe C: the cap update is in flight');
    const off = r.ad.setAutopilot(r.sid, null);
    opens[0]();
    await until(() => caps.length === 2, 'probe C: the cap restore is in flight');
    await r.ad.interrupt(r.sid);
    opens[1]();
    assert.strictEqual(await settles(sent.then(() => 'ok', (e: Error) => e.message), 'probe C: the send settles'), 'ok', 'probe C: the send is not refused');
    await settles(off, 'probe C: the off settles');
    assert.deepStrictEqual(caps, [{ maxAiCredits: 40 }, { maxAiCredits: 100 }], 'probe C: the session cap went back');
    assert.deepStrictEqual(r.s.calls.filter((c) => c.name === 'send'), [], 'FR-059: a Stop during the cap restore drops the message');
    // probe D, queue since round 6: Autopilot back on during the restore waits its turn, so this message goes plain and the turn-on comes after it
    await settles(r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 }), 'probe D: Autopilot on');
    const again = r.ad.send(r.sid, { text: 'goal D' });
    await until(() => caps.length === 3, 'probe D: the cap update is in flight');
    const off2 = r.ad.setAutopilot(r.sid, null);
    opens[2]();
    await until(() => caps.length === 4, 'probe D: the cap restore is in flight');
    const on2 = r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 });
    opens[3]();
    assert.strictEqual(await settles(again.then(() => 'ok', (e: Error) => e.message), 'probe D: the send settles'), 'ok');
    await settles(Promise.all([off2, on2]), 'probe D: the queued off and on settle');
    const last = r.s.calls.filter((c) => c.name === 'send').map((c) => c.args[0] as { prompt: string; agentMode?: string });
    assert.deepStrictEqual(last.map((x) => [x.prompt, x.agentMode ?? 'none']), [['goal D', 'none']], 'FR-059 probe D: Autopilot back on during the cap restore waits its turn: this message goes plain');
    assert.deepStrictEqual(caps.slice(2), [{ maxAiCredits: 40 }, { maxAiCredits: 100 }]);
    assert.strictEqual((r.ad as unknown as { sessions: Map<string, { auto?: { on: boolean } }> }).sessions.get(r.sid)!.auto!.on, true, 'probe D: the queued turn-on came after it');
  }

  // FR-059 round 2 (review on #967, probes A and B): a plan-first turn left plan mode set; turning Autopilot on leaves plan mode, so the run's
  // send has no mode.set after its last check (A), and a Stop can no longer land in one (B)
  for (const probe of ['A', 'B'] as const) {
    const r = await rig({ tuning: { waitMs: 2000 } });
    await r.ad.send(r.sid, { text: 'plan it', plan: true });
    fire(r.s, { type: 'session.idle', data: {} }); // the plan turn ends without a plan
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    const from = r.order().length;
    let asked = false;
    let answer: () => void = () => undefined;
    if (probe === 'B') {
      const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
      r.s.rpc.mode.set = (a: unknown) => { asked = true; r.s.rpc.mode.set = set; return new Promise((res) => { answer = () => res(set(a)); }); };
    }
    let settled = false;
    const sent = r.ad.send(r.sid, { text: 'the goal' }).then(() => 'ok', (e: Error) => e.message).finally(() => { settled = true; });
    if (probe === 'A') {
      assert.strictEqual(await sent, 'ok');
      assert.deepStrictEqual(r.order().slice(from), ['send'], 'FR-059 probe A: no mode.set between the last check and the goal');
      continue;
    }
    await until(() => asked || settled, 'probe B: the send reached a mode.set or went');
    if (asked) { await r.ad.interrupt(r.sid); answer(); }
    assert.strictEqual(await sent, 'ok', 'FR-059 probe B: a Stop can not land between the last check and the goal');
  }

  // FR-059 round 2 (review on #967, probe E), queue since round 6: Autopilot turned on while a plan send waits on its own mode.set plan
  // waits its turn, so the plan goes as a plan, then Autopilot comes on and leaves plan mode: the next goal has no mode.set before it
  {
    const r = await rig({ tuning: { waitMs: 2000 } });
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    let asked = false;
    let answer: () => void = () => undefined;
    r.s.rpc.mode.set = (a: unknown) => { asked = true; r.s.rpc.mode.set = set; return new Promise((res) => { answer = () => res(set(a)); }); };
    const planned = r.ad.send(r.sid, { text: 'plan it', plan: true }).then(() => 'ok', (e: Error) => e.message);
    await until(() => asked, 'probe E: the plan mode.set is in flight');
    const on = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    await tick();
    assert.ok(!r.order().includes('mode:autopilot'), 'FR-059 probe E: the turn-on waits for the plan send ahead of it');
    answer();
    assert.strictEqual(await settles(planned, 'probe E: the plan send settles'), 'ok', 'FR-059 probe E: the plan send ahead of the turn-on goes as a plan');
    assert.strictEqual(await settles(on, 'probe E: the turn-on settles'), 'ok');
    assert.deepStrictEqual(r.order(), ['mode:plan', 'send', 'mode:autopilot'], 'probe E: plan, its message, then Autopilot');
    fire(r.s, { type: 'session.idle', data: {} }); // the plan turn ends
    const from = r.order().length;
    assert.strictEqual(await r.ad.send(r.sid, { text: 'the goal' }).then(() => 'ok', (e: Error) => e.message), 'ok', 'probe E: the next goal is not refused');
    assert.deepStrictEqual(r.order().slice(from), ['send'], 'FR-059 probe E: plan mode was not set again, so no mode.set before the goal');
  }

  // FR-059 round 3 (review on #967, probe F): a plan turn left plan mode set; a goal sent while setAutopilot still waits on its mode.set
  // autopilot (the plan card's "Approve and run on Autopilot") has no mode.set interactive before it
  {
    const r = await rig({ tuning: { waitMs: 5000 } }); // the turn-on bound does not fire here
    await r.ad.send(r.sid, { text: 'plan it', plan: true });
    fire(r.s, { type: 'session.idle', data: {} }); // the plan turn ends without a plan
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    let asked = false;
    let answer: () => void = () => undefined;
    r.s.rpc.mode.set = (a: unknown) => { asked = true; r.s.rpc.mode.set = set; return new Promise((res) => { answer = () => res(set(a)); }); };
    const from = r.order().length;
    const sendsBefore = r.s.calls.filter((c) => c.name === 'send').length;
    const on = r.ad.setAutopilot(r.sid, { limit: 5 });
    await until(() => asked, 'probe F: mode.set autopilot is in flight');
    const goal = r.ad.send(r.sid, { text: 'the goal' }).then(() => 'ok', (e: Error) => e.message);
    await tick();
    assert.strictEqual(r.s.calls.filter((c) => c.name === 'send').length, sendsBefore, 'FR-059 probe F: the goal waits for the turn-on to settle');
    answer();
    await settles(on, 'probe F: setAutopilot settles');
    assert.strictEqual(await settles(goal, 'FR-059 probe F: the goal send settles after the turn-on'), 'ok', 'probe F: the goal is not refused');
    assert.ok(!r.order().slice(from).includes('mode:interactive'), 'FR-059 probe F: no mode.set interactive before a goal sent while Autopilot turns on');
    const sent = r.s.calls.filter((c) => c.name === 'send').map((c) => c.args[0] as { prompt: string; agentMode?: string }).map((x) => [x.prompt, x.agentMode ?? 'none']);
    assert.deepStrictEqual(sent.slice(1), [['the goal', 'autopilot']], 'probe F: the goal goes on Autopilot');
  }

  // FR-059 round 4 (review on #967, probe I): a goal sent while setAutopilot waits on mode.set autopilot, which then fails: the send waited,
  // so no run starts, no Autopilot cap goes on, Autopilot reads off, and the message goes plain; the next plain message works as usual
  {
    const r = await rig({ cap: 100, tuning: { waitMs: 5000 } }); // the turn-on bound does not fire here
    const caps: unknown[] = [];
    r.s.rpc.options.update = async (a: unknown) => { caps.push((a as { sessionLimits?: unknown }).sessionLimits); };
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    let asked = false;
    let refuse: () => void = () => undefined;
    r.s.rpc.mode.set = () => { asked = true; r.s.rpc.mode.set = set; return new Promise((_res, rej) => { refuse = () => rej(new Error('mode refused')); }); };
    const on = r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 }).then(() => 'ok', (e: Error) => e.message);
    await until(() => asked, 'probe I: mode.set autopilot is in flight');
    const goal = r.ad.send(r.sid, { text: 'the goal' }).then(() => 'ok', (e: Error) => e.message);
    await tick();
    refuse();
    assert.strictEqual(await settles(on, 'probe I: setAutopilot settles'), 'mode refused', 'probe I: setAutopilot is refused');
    assert.strictEqual(await settles(goal, 'FR-059 probe I: the goal send settles after the failed turn-on'), 'ok', 'probe I: the send is not refused');
    const auto = (r.ad as unknown as { sessions: Map<string, { auto?: { on: boolean; settings?: unknown } }> }).sessions.get(r.sid)!.auto!;
    assert.deepStrictEqual([auto.on, auto.settings], [false, undefined], 'FR-059 probe I: a rejected setAutopilot leaves Autopilot off');
    assert.ok(!r.ap().some((e) => e.phase === 'started'), 'FR-059 probe I: no run starts on a turn-on that failed');
    const sends = (): Array<[string, string]> => r.s.calls.filter((c) => c.name === 'send').map((c) => c.args[0] as { prompt: string; agentMode?: string }).map((x) => [x.prompt, x.agentMode ?? 'none']);
    assert.deepStrictEqual(sends(), [['the goal', 'none']], 'probe I: the message goes plain, never as a goal');
    assert.deepStrictEqual(caps, [], 'probe I: no Autopilot cap went on, so none is left');
    fire(r.s, { type: 'session.idle', data: {} });
    const from = r.order().length;
    await settles(r.ad.send(r.sid, { text: 'next' }), 'probe I: the next plain message settles');
    assert.deepStrictEqual(r.order().slice(from), ['send'], 'probe I: the next plain message goes as usual');
    assert.deepStrictEqual(sends().at(-1), ['next', 'none']);
  }

  // FR-059 round 5 (review on #967, probe J): mode.set autopilot never answers (a gate never released; a 20 ms injected bound, no long sleep):
  // the turn-on fails closed, so the send waiting on it goes plain, Autopilot reads off, and plan mode counts as set
  {
    const r = await rig({ tuning: { waitMs: 20 } });
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    let asked = false;
    r.s.rpc.mode.set = () => { asked = true; r.s.rpc.mode.set = set; return new Promise(() => undefined); };
    const on = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    await until(() => asked, 'probe J: mode.set autopilot is in flight');
    const goal = r.ad.send(r.sid, { text: 'the goal' }).then(() => 'ok', (e: Error) => e.message);
    assert.match(await settles(on, 'FR-059 probe J: an unanswered turn-on fails within its bound'), /did not answer in time/, 'probe J: setAutopilot says the runtime did not answer');
    assert.strictEqual(await settles(goal, 'FR-059 probe J: the send waiting on an unanswered turn-on goes on'), 'ok', 'probe J: the send is not refused');
    const auto = (r.ad as unknown as { sessions: Map<string, { auto?: { on: boolean; settings?: unknown }; planMode?: boolean }> }).sessions.get(r.sid)!;
    assert.deepStrictEqual([auto.auto!.on, auto.auto!.settings], [false, undefined], 'FR-059 probe J: an unanswered turn-on leaves Autopilot off');
    assert.ok(!r.ap().some((e) => e.phase === 'started'), 'probe J: no run starts');
    const last = r.s.calls.filter((c) => c.name === 'send').map((c) => c.args[0] as { prompt: string; agentMode?: string }).map((x) => [x.prompt, x.agentMode ?? 'none']);
    assert.deepStrictEqual(last, [['the goal', 'none']], 'probe J: the message goes plain');
    assert.deepStrictEqual(r.order().slice(-2), ['mode:interactive', 'send'], 'FR-059 probe J: plan mode counts as set, so a late autopilot answer is undone before the message');
  }

  // FR-059 round 6 (review on #967, finding 1, probe S): a Stop while a goal waits behind the turn-on drops the message, and the turn-on
  // says the Stop turned Autopilot off; its late mode change is Durbar's own (no FR-006 line)
  {
    const r = await rig({ tuning: { waitMs: 2000 } });
    const g = orderedModes(r.s);
    const on = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    await until(g.asked, 'probe S: mode.set autopilot is in flight');
    const goal = r.ad.send(r.sid, { text: 'the goal' }).then(() => 'ok', (e: Error) => e.message);
    const stop = r.ad.interrupt(r.sid);
    g.release();
    await settles(stop, 'probe S: the Stop settles');
    const turnedOn = await settles(on, 'probe S: the turn-on settles');
    assert.strictEqual(await settles(goal, 'probe S: the send settles'), 'ok', 'probe S: the send is not refused');
    assert.deepStrictEqual(r.s.calls.filter((c) => c.name === 'send'), [], 'FR-059 probe S: a Stop during the turn-on wait drops the message');
    assert.strictEqual(turnedOn, COPILOT_TURN_ON_STOPPED, 'FR-059 probe S: a Stop during the turn-on leaves Autopilot off and says so');
    assert.ok(!r.lines().includes(LINE_SELF_STARTED), 'FR-059 probe S: the turn-on\'s own mode change is not FR-006');
  }

  // FR-059 round 6 (probe P): a plan turn left plan mode set; a plain message's reset to interactive waits; a Stop during it drops the message
  {
    const r = await rig({ tuning: { waitMs: 2000 } });
    await r.ad.send(r.sid, { text: 'plan it', plan: true });
    fire(r.s, { type: 'session.idle', data: {} }); // the plan turn ends without a plan
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    let asked = false;
    let answer: () => void = () => undefined;
    r.s.rpc.mode.set = (a: unknown) => { asked = true; r.s.rpc.mode.set = set; return new Promise((res) => { answer = () => res(set(a)); }); };
    const before = r.s.calls.filter((c) => c.name === 'send').length;
    const plain = r.ad.send(r.sid, { text: 'plain' }).then(() => 'ok', (e: Error) => e.message);
    await until(() => asked, 'probe P: the reset to interactive is in flight');
    const stop = r.ad.interrupt(r.sid);
    answer();
    await settles(stop, 'probe P: the Stop settles');
    assert.strictEqual(await settles(plain, 'probe P: the send settles'), 'ok', 'probe P: the send is not refused');
    assert.strictEqual(r.s.calls.filter((c) => c.name === 'send').length, before, 'FR-059 probe P: a Stop during the send\'s mode change drops the message');
  }

  // FR-059 round 6 (probe S2): a turn-on queued behind a send, and a Stop before its turn: the turn-on fails and sends no mode.set autopilot
  {
    const r = await rig({ tuning: { waitMs: 2000 } });
    await r.ad.send(r.sid, { text: 'plan it', plan: true });
    fire(r.s, { type: 'session.idle', data: {} }); // plan mode left set, so the next plain send waits on mode.set interactive
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    let asked = false;
    let answer: () => void = () => undefined;
    r.s.rpc.mode.set = (a: unknown) => { asked = true; r.s.rpc.mode.set = set; return new Promise((res) => { answer = () => res(set(a)); }); };
    const plain = r.ad.send(r.sid, { text: 'plain' });
    await until(() => asked, 'probe S2: the send ahead is in its step');
    const on = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    await settles(r.ad.interrupt(r.sid), 'probe S2: the Stop settles');
    answer();
    await settles(plain, 'probe S2: the send ahead settles');
    assert.strictEqual(await settles(on, 'probe S2: the turn-on settles'), COPILOT_TURN_ON_STOPPED, 'probe S2: the turn-on says the Stop came first');
    assert.ok(!r.order().includes('mode:autopilot'), 'FR-059 probe S2: a turn-on whose turn comes after a Stop sends no mode.set autopilot');
  }

  // FR-059 round 6 (review on #967, finding 1, probe N): End session while a goal waits behind the turn-on: nothing goes to the ended session
  {
    const r = await rig({ tuning: { waitMs: 2000 } });
    const g = orderedModes(r.s);
    const on = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    await until(g.asked, 'probe N: mode.set autopilot is in flight');
    const goal = r.ad.send(r.sid, { text: 'the goal' }).then(() => 'ok', (e: Error) => e.message);
    const end = r.ad.stop(r.sid).catch(() => undefined);
    g.release();
    await settles(end, 'probe N: End settles');
    const turnedOn = await settles(on, 'probe N: the turn-on settles');
    await settles(goal, 'probe N: the send settles');
    assert.deepStrictEqual(r.s.calls.filter((c) => c.name === 'send'), [], 'FR-059 probe N: End during the turn-on wait: the message does not go to the ended session');
    assert.strictEqual(turnedOn, 'The session is not running.', 'FR-059 probe N: End during the turn-on says the session ended, not that a Stop came');
  }

  // FR-059 round 6 (review on #967, finding 2, probe T2): a goal queued behind turn-on 1, then turn-on 2 whose mode.set would fail: the
  // turn-ons and the send go one at a time, so turn-on 2 finds the run and is refused, and nothing of the run is undone
  {
    const r = await rig({ tuning: { waitMs: 2000 } });
    const g = orderedModes(r.s);
    const on1 = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    await until(g.asked, 'probe T2: turn-on 1 is in flight');
    const goal = r.ad.send(r.sid, { text: 'the goal' }).then(() => 'ok', (e: Error) => e.message);
    g.failNextAutopilot();
    const on2 = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    g.release();
    assert.strictEqual(await settles(on1, 'probe T2: turn-on 1 settles'), 'ok');
    assert.strictEqual(await settles(goal, 'probe T2: the goal settles'), 'ok');
    assert.strictEqual(await settles(on2, 'probe T2: turn-on 2 settles'), AUTOPILOT_ONE_RUN, 'FR-059 probe T2: a turn-on queued behind a run-starting send finds the run');
    const auto = (r.ad as unknown as { sessions: Map<string, { auto?: { on: boolean; running: boolean }; planMode?: boolean }> }).sessions.get(r.sid)!;
    assert.deepStrictEqual([auto.auto!.on, auto.auto!.running, auto.planMode], [true, true, false], 'FR-059 probe T2: the run keeps Autopilot on, and no failed turn-on is left behind');
    const from = r.order().length;
    await settles(r.ad.send(r.sid, { text: 'typed during the run' }), 'probe T2: a message during the run settles');
    assert.deepStrictEqual(r.order().slice(from), ['send'], 'FR-059 probe T2: a message typed during the run sends no mode.set interactive');
  }

  // FR-059 round 6 (review on #967, finding 3, probe Q): two goals queued behind one turn-on: one run; the second is a plain message in it
  {
    const r = await rig({ tuning: { waitMs: 2000 } });
    const g = orderedModes(r.s);
    const on = r.ad.setAutopilot(r.sid, { limit: 5 });
    await until(g.asked, 'probe Q: mode.set autopilot is in flight');
    const one = r.ad.send(r.sid, { text: 'goal one' }).then(() => 'ok', (e: Error) => e.message);
    const two = r.ad.send(r.sid, { text: 'goal two' }).then(() => 'ok', (e: Error) => e.message);
    g.release();
    await settles(on, 'probe Q: the turn-on settles');
    assert.deepStrictEqual([await settles(one, 'probe Q: goal one settles'), await settles(two, 'probe Q: goal two settles')], ['ok', 'ok']);
    assert.strictEqual(r.ap().filter((e) => e.phase === 'started').length, 1, 'FR-059 probe Q: two sends queued on one turn-on start one run');
    const sent = r.s.calls.filter((c) => c.name === 'send').map((c) => c.args[0] as { prompt: string; agentMode?: string }).map((x) => [x.prompt, x.agentMode ?? 'none']);
    assert.deepStrictEqual(sent, [['goal one', 'autopilot'], ['goal two', 'none']], 'probe Q: the second goes as a plain message in the run (FR-058)');
  }

  // FR-059 round 6 (review on #967, finding 4, probe L): the turn-on times out (20 ms injected bound), the message goes plain, then the
  // late answer and its mode change arrive: Durbar's own, so no FR-006 line and no abort, and the mode goes back to interactive
  {
    const r = await rig({ tuning: { waitMs: 20 } });
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    let asked = false;
    let late: () => void = () => undefined;
    r.s.rpc.mode.set = (a: unknown) => { asked = true; r.s.rpc.mode.set = set; return new Promise((res) => { late = () => res(set(a)); }); };
    const on = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    await until(() => asked, 'probe L: mode.set autopilot is in flight');
    const goal = r.ad.send(r.sid, { text: 'the goal' });
    assert.match(await settles(on, 'probe L: the turn-on times out'), /did not answer in time/);
    await settles(goal, 'probe L: the send settles');
    const from = r.order().length;
    late(); // the late answer, and its session.mode_changed to autopilot
    await until(() => r.order().slice(from).includes('mode:interactive'), 'FR-059 probe L: the late turn-on is undone (back to interactive)');
    assert.ok(!r.lines().includes(LINE_SELF_STARTED), 'FR-059 probe L: the late answer of Durbar\'s own turn-on is not FR-006');
    assert.ok(!r.order().includes('abort'), 'FR-059 probe L: no abort lands on the person\'s plain turn');
    assert.strictEqual(r.s.mode, 'interactive', 'probe L: the runtime ends in interactive');
  }

  // FR-059 round 7 (probes H1 to H4): each runtime call of a send step is bounded (a gate never released, a 20 ms injected bound): the
  // message is dropped with COPILOT_STEP_NO_ANSWER, what can be put back is, and the queue goes on (Autopilot off and a later send settle)
  {
    const sends = (r: Rig): Array<[string, string]> => r.s.calls.filter((c) => c.name === 'send').map((c) => c.args[0] as { prompt: string; agentMode?: string }).map((x) => [x.prompt, x.agentMode ?? 'none']);
    // H1: the Autopilot cap update never answers: no run, the session's own cap is sent back, Autopilot off and the next message go
    {
      const r = await rig({ cap: 100, tuning: { waitMs: 20 } });
      await r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 });
      const caps: unknown[] = [];
      r.s.rpc.options.update = (a: unknown) => { caps.push((a as { sessionLimits?: unknown }).sessionLimits); return caps.length === 1 ? new Promise<void>(() => undefined) : Promise.resolve(); };
      const goal = r.ad.send(r.sid, { text: 'the goal' }).then(() => 'ok', (e: Error) => e.message);
      assert.strictEqual(await settles(goal, 'FR-059 probe H1: a cap update that never answers ends within its bound'), COPILOT_STEP_NO_ANSWER, 'probe H1: the message is dropped, and says why');
      assert.deepStrictEqual(caps, [{ maxAiCredits: 40 }, { maxAiCredits: 100 }], 'FR-059 probe H1: the session\'s own cap is sent back');
      assert.ok(!r.ap().some((e) => e.phase === 'started'), 'probe H1: no run');
      await settles(r.ad.setAutopilot(r.sid, null), 'probe H1: the queue goes on: Autopilot off settles');
      await settles(r.ad.send(r.sid, { text: 'next' }), 'probe H1: the queue goes on: the next message settles');
      assert.deepStrictEqual(sends(r), [['next', 'none']]);
    }
    // H2: the cap restore never answers (Autopilot went off during the cap update): said, and the queue goes on
    {
      const r = await rig({ cap: 100, tuning: { waitMs: 20 } });
      await r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 });
      const caps: unknown[] = [];
      let open: () => void = () => undefined;
      r.s.rpc.options.update = (a: unknown) => {
        caps.push((a as { sessionLimits?: unknown }).sessionLimits);
        if (caps.length === 1) return new Promise<void>((res) => { open = res; });
        return caps.length === 2 ? new Promise<void>(() => undefined) : Promise.resolve();
      };
      const goal = r.ad.send(r.sid, { text: 'the goal' }).then(() => 'ok', (e: Error) => e.message);
      await until(() => caps.length === 1, 'probe H2: the cap update is in flight');
      const off = r.ad.setAutopilot(r.sid, null);
      open();
      await settles(goal, 'FR-059 probe H2: a cap restore that never answers ends within its bound');
      assert.ok(r.lines().includes(LINE_CAP_NOT_RESTORED), 'FR-059 probe H2: the cap that could not be put back is said');
      await settles(off, 'probe H2: the queue goes on: Autopilot off settles');
      await settles(r.ad.send(r.sid, { text: 'next' }), 'probe H2: the queue goes on: the next message settles');
    }
    // H3: plan first, and mode.set plan never answers: dropped, no turn left open, and the next plain message resets the mode first
    {
      const r = await rig({ tuning: { waitMs: 20 } });
      const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
      r.s.rpc.mode.set = () => { r.s.rpc.mode.set = set; return new Promise(() => undefined); };
      const plan = r.ad.send(r.sid, { text: 'plan it', plan: true }).then(() => 'ok', (e: Error) => e.message);
      assert.strictEqual(await settles(plan, 'FR-059 probe H3: a mode.set plan that never answers ends within its bound'), COPILOT_STEP_NO_ANSWER, 'probe H3: the plan message is dropped, and says why');
      assert.deepStrictEqual(sends(r), [], 'probe H3: nothing sent');
      await settles(r.ad.setAutopilot(r.sid, { limit: 5 }), 'probe H3: the queue goes on: Autopilot on settles');
      const from = r.order().length;
      const next = r.ad.send(r.sid, { text: 'next goal' }).then(() => 'ok', (e: Error) => e.message);
      assert.strictEqual(await settles(next, 'probe H3: the next goal settles'), 'ok', 'FR-059 probe H3: no turn was left open, so a goal is not refused');
      assert.deepStrictEqual(sends(r), [['next goal', 'autopilot']]);
      assert.deepStrictEqual(r.order().slice(from), ['send'], 'probe H3: Autopilot on left plan mode');
    }
    // H4: the reset to interactive (plan mode left set) never answers: dropped, plan mode still counts as set, and the next one tries again
    {
      const r = await rig({ tuning: { waitMs: 20 } });
      await r.ad.send(r.sid, { text: 'plan it', plan: true });
      fire(r.s, { type: 'session.idle', data: {} });
      const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
      r.s.rpc.mode.set = () => { r.s.rpc.mode.set = set; return new Promise(() => undefined); };
      const plain = r.ad.send(r.sid, { text: 'plain' }).then(() => 'ok', (e: Error) => e.message);
      assert.strictEqual(await settles(plain, 'FR-059 probe H4: a reset to interactive that never answers ends within its bound'), COPILOT_STEP_NO_ANSWER, 'probe H4: dropped, and says why');
      const from = r.order().length;
      await settles(r.ad.send(r.sid, { text: 'again' }), 'probe H4: the queue goes on');
      assert.deepStrictEqual(r.order().slice(from), ['mode:interactive', 'send'], 'FR-059 probe H4: plan mode still counts as set, so the next message resets it first');
    }
  }

  // FR-059 round 7 (probe H5): a turn-on that timed out and never answers stops counting as Durbar's own one bound later, so a loop the
  // runtime starts after that still gets its FR-006 line
  {
    const r = await rig({ tuning: { waitMs: 20 } });
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    r.s.rpc.mode.set = () => { r.s.rpc.mode.set = set; return new Promise(() => undefined); };
    assert.match(await settles(r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message), 'probe H5: the turn-on times out'), /did not answer in time/);
    const live = (r.ad as unknown as { sessions: Map<string, { ownTurnOn?: boolean }> }).sessions.get(r.sid)!;
    assert.strictEqual(live.ownTurnOn, true, 'probe H5: right after the timeout, a late answer is still ours');
    await until(() => live.ownTurnOn === false, 'FR-059 probe H5: one bound after the timeout the turn-on is forgotten');
    fire(r.s, { type: 'session.mode_changed', data: { newMode: 'autopilot', previousMode: 'interactive' } });
    await until(() => r.lines().includes(LINE_SELF_STARTED), 'FR-059 probe H5: a later loop the runtime starts gets its FR-006 line');
  }

  // FR-059 round 8 (review on #967, findings 1 and 2, probes W1 and W2): Autopilot off's mode.set interactive never answers (a gate never
  // released, a 20 ms bound): off and Stop each settle, the session ends as FR-054 says (not confirmed off), Stop's abort goes, the queue moves
  for (const how of ['off', 'stop'] as const) {
    const r = await rig({ tuning: { waitMs: 20 } });
    if (how === 'stop') await r.ad.send(r.sid, { text: 'a typed turn' }); // a plain turn going, then Autopilot on with no run
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    r.s.rpc.mode.set = () => { r.s.rpc.mode.set = set; return new Promise(() => undefined); };
    const done = how === 'off' ? r.ad.setAutopilot(r.sid, null) : r.ad.interrupt(r.sid);
    await settles(done.catch(() => undefined), `FR-059 probe W${how === 'off' ? 1 : 2}: ${how} with a mode.set interactive that never answers settles`);
    assert.ok(r.lines().includes(LINE_UNCONFIRMED), `probe W${how === 'off' ? 1 : 2}: not confirmed off is said`);
    assert.strictEqual(r.ad.isLive(r.sid), false, `probe W${how === 'off' ? 1 : 2}: FR-054: the session ends`);
    if (how === 'stop') assert.ok(r.s.calls.some((c) => c.name === 'abort'), 'FR-059 probe W2: the Stop\'s abort goes through');
    const later = r.ad.send(r.sid, { text: 'later' }).then(() => 'sent', (e: Error) => e.message);
    assert.notStrictEqual(await settles(later, `probe W${how === 'off' ? 1 : 2}: a later send does not wait behind it`), 'sent');
  }

  // FR-059 round 8 (review on #967, finding 3, probe W3): a stricter mode while the turn-on waits; the runtime's mode change comes after its
  // answer. setAutopilot reports the real outcome (refused: only in Allow all), and that mode change is Durbar's own (no FR-006 line, no abort)
  {
    const r = await rig({ tuning: { waitMs: 2000 } });
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    let asked = false;
    let answer: () => void = () => undefined;
    r.s.rpc.mode.set = () => { asked = true; r.s.rpc.mode.set = set; return new Promise<{ mode: string }>((res) => { answer = () => res({ mode: 'autopilot' }); }); };
    const on = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    await until(() => asked, 'probe W3: mode.set autopilot is in flight');
    r.ad.setPermMode(r.sid, 'ask');
    answer(); // the answer first; its session.mode_changed comes after it
    const outcome = await settles(on, 'probe W3: the turn-on settles');
    fire(r.s, { type: 'session.mode_changed', data: { newMode: 'autopilot', previousMode: 'interactive' } });
    await tick();
    assert.match(outcome, /only in Allow all/, 'FR-059 probe W3: a stricter mode during the turn-on: setAutopilot is refused, not "ok"');
    assert.ok(!r.lines().includes(LINE_SELF_STARTED), 'FR-059 probe W3: the turn-on\'s own late mode change is not FR-006');
    assert.ok(!r.order().includes('abort'), 'probe W3: no abort');
  }

  // FR-059 round 8 (probe W3b): Autopilot turned off again while its turn-on waits: setAutopilot says so, it does not report "ok"
  {
    const r = await rig({ tuning: { waitMs: 2000 } });
    const g = orderedModes(r.s);
    const on = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    await until(g.asked, 'probe W3b: mode.set autopilot is in flight');
    const off = r.ad.setAutopilot(r.sid, null);
    g.release();
    assert.strictEqual(await settles(on, 'probe W3b: the turn-on settles'), COPILOT_TURN_ON_OFF, 'FR-059 probe W3b: Autopilot off during the turn-on: setAutopilot reports it, not "ok"');
    await settles(off, 'probe W3b: the off settles');
    assert.ok(!r.lines().includes(LINE_SELF_STARTED), 'probe W3b: no FR-006 line');
  }

  // FR-059 round 8 (probe W4b): the cap update answers, Autopilot goes off during it, and the restore goes unanswered: the next goal sends
  // its cap again, since the late restore may yet land
  {
    const r = await rig({ cap: 100, tuning: { waitMs: 20 } });
    await r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 });
    const caps: unknown[] = [];
    let open: () => void = () => undefined;
    r.s.rpc.options.update = (a: unknown) => {
      caps.push((a as { sessionLimits?: unknown }).sessionLimits);
      if (caps.length === 1) return new Promise<void>((res) => { open = res; });
      return caps.length === 2 ? new Promise<void>(() => undefined) : Promise.resolve();
    };
    const one = r.ad.send(r.sid, { text: 'goal one' });
    await until(() => caps.length === 1, 'probe W4b: the cap update is in flight');
    const off = r.ad.setAutopilot(r.sid, null);
    open();
    await settles(one, 'probe W4b: the first message settles (plain)');
    await settles(off, 'probe W4b: the off settles');
    assert.ok(r.lines().includes(LINE_CAP_NOT_RESTORED), 'probe W4b: the restore that did not answer is said');
    fire(r.s, { type: 'session.idle', data: {} });
    await settles(r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 }), 'probe W4b: Autopilot on again');
    await settles(r.ad.send(r.sid, { text: 'goal two' }), 'probe W4b: the next goal settles');
    assert.deepStrictEqual(caps.slice(2, 3), [{ maxAiCredits: 40 }], 'FR-059 probe W4b: after an unanswered restore, the next goal sends its cap again');
  }

  // FR-059 round 8 (review on #967, finding 4, probe W4): the cap update and its restore both go unanswered; the next goal sends its cap
  // again, since which cap is in force is not known
  {
    const r = await rig({ cap: 100, tuning: { waitMs: 20 } });
    await r.ad.setAutopilot(r.sid, { limit: 5, cap: 40 });
    const caps: unknown[] = [];
    r.s.rpc.options.update = (a: unknown) => { caps.push((a as { sessionLimits?: unknown }).sessionLimits); return caps.length <= 2 ? new Promise<void>(() => undefined) : Promise.resolve(); };
    assert.strictEqual(await settles(r.ad.send(r.sid, { text: 'goal one' }).then(() => 'ok', (e: Error) => e.message), 'probe W4: the first goal settles'), COPILOT_STEP_NO_ANSWER);
    assert.ok(r.lines().includes(LINE_CAP_NOT_RESTORED), 'probe W4: the restore that did not answer is said');
    await settles(r.ad.send(r.sid, { text: 'goal two' }), 'probe W4: the next goal settles');
    assert.deepStrictEqual(caps.slice(2, 3), [{ maxAiCredits: 40 }], 'FR-059 probe W4: after both cap calls went unanswered, the next goal sends its cap again');
    assert.strictEqual(r.ap().filter((e) => e.phase === 'started').length, 1, 'probe W4: and its run starts');
  }

  // FR-059 round 3 (review on #967, probe G), queue since round 6: Autopilot's own mode.set fails after a plan send ahead of it: the plan
  // went as a plan, and plan mode counts as set, so the next plain message goes back to interactive first
  {
    const r = await rig({ tuning: { waitMs: 2000 } });
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    let asked = false;
    let answer: () => void = () => undefined;
    r.s.rpc.mode.set = (a: unknown) => {
      asked = true;
      r.s.rpc.mode.set = (b: unknown) => { r.s.rpc.mode.set = set; return (b as { mode: string }).mode === 'autopilot' ? Promise.reject(new Error('mode refused')) : set(b); };
      return new Promise((res) => { answer = () => res(set(a)); });
    };
    const planned = r.ad.send(r.sid, { text: 'plan it', plan: true }).then(() => 'ok', (e: Error) => e.message);
    await until(() => asked, 'probe G: the plan mode.set is in flight');
    const on = r.ad.setAutopilot(r.sid, { limit: 5 }).then(() => 'ok', (e: Error) => e.message);
    answer();
    assert.strictEqual(await settles(planned, 'probe G: the plan send settles'), 'ok', 'FR-059 probe G: the plan send ahead of the turn-on goes as a plan');
    assert.match(await settles(on, 'probe G: the turn-on settles'), /mode refused/, 'probe G: the turn-on fails');
    fire(r.s, { type: 'session.idle', data: {} }); // the plan turn ends
    const from = r.order().length;
    await r.ad.send(r.sid, { text: 'plain' });
    assert.deepStrictEqual(r.order().slice(from), ['mode:interactive', 'send'], 'FR-059 probe G: after the failed mode.set autopilot, plan mode counts as set');
  }

  // spec 099 2026-11-04 (review on #967, mutant C2): Stop's Autopilot branch runs inside FR-229's stop sequence, so a send during it waits
  for (const running of [true, false]) {
    const r = await rig({ tuning: { waitMs: 2000 } });
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    if (running) await r.ad.send(r.sid, { text: 'goal' });
    const before = r.s.calls.filter((c) => c.name === 'send').length;
    let answer: () => void = () => undefined;
    let asked = false;
    const set = r.s.rpc.mode.set.bind(r.s.rpc.mode);
    r.s.rpc.mode.set = (a: unknown) => { asked = true; return new Promise((res) => { answer = () => res(set(a)); }); };
    const stopping = r.ad.interrupt(r.sid);
    await until(() => asked, 'Stop is stopping Autopilot: its mode.set waits');
    const typed = r.ad.send(r.sid, { text: 'typed during the stop' });
    await tick(20); // review of #982 (finding 2): the send now queues behind the Stop's own place, so it says nothing yet; it simply does not go out
    assert.strictEqual(r.s.calls.filter((c) => c.name === 'send').length, before, `${running ? 'run' : 'no run'}: a send during a Stop that is still stopping Autopilot waits`);
    answer();
    await stopping;
    await typed;
    const last = r.s.calls.filter((c) => c.name === 'send').at(-1)!.args[0] as { prompt: string; agentMode?: string };
    assert.deepStrictEqual([last.prompt, last.agentMode ?? 'none'], ['typed during the stop', 'none'], 'after the Stop: a plain message');
  }

  // FR-053, FR-054 (review on #967, mutant C12): a resume found in autopilot waits for session.mode_changed; none: the start fails, nothing is sent
  {
    const client = new FakeClient();
    client.onDisk.add('old-silent');
    client.resumeMode = 'autopilot';
    client.modeSilentOnResume = true;
    const r = await rig({ client, tuning: { wired: true, waitMs: 20 } });
    await assert.rejects(r.ad.start({ workspace: ws, resumeSessionId: 'old-silent', permissionMode: 'allow', quiet: true }), /could not clear.*nothing was sent/, 'no session.mode_changed after the clear: the start fails');
    assert.ok(client.last.calls.some((c) => c.name === 'mode.set'), 'the clear was asked for');
    assert.strictEqual(r.ad.isLive('old-silent'), false);
  }

  // FR-052 (review on #967, mutant C13): End session ends the run quietly, and its clock sample stops
  {
    let cancelled = 0;
    const r = await rig({ tuning: { setTimer: () => () => { cancelled++; } } });
    await r.ad.setAutopilot(r.sid, { limit: 5, hours: 1 });
    await r.ad.send(r.sid, { text: 'x' });
    assert.strictEqual(cancelled, 0, 'the run is going');
    await r.ad.stop(r.sid);
    assert.ok(cancelled >= 1, 'FR-052: End session stops the clock sample');
    assert.deepStrictEqual(reasons(r), [], 'and shows no card');
  }

  // a send that fails ends the run it began, once
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    r.s.sendFail = 'refused';
    await assert.rejects(r.ad.send(r.sid, { text: 'x' }), /refused/);
    await tick();
    assert.deepStrictEqual(reasons(r), ['error']);
  }

  // refusals: goal text and plan first leave everything as it was
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await assert.rejects(r.ad.send(r.sid, { text: '   ' }), /finished result/);
    await assert.rejects(r.ad.send(r.sid, { text: 'x', plan: true }), /Plan first/);
    assert.deepStrictEqual(r.ap(), []);
    assert.ok(!r.order().includes('send'));
  }

  // the backstop with the marker removed, by turns and by time, worded as FR-021
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 1 });
    await r.ad.send(r.sid, { text: 'x' });
    for (let i = 0; i < 200; i++) fire(r.s, { type: 'assistant.turn_start', data: {} });
    assert.deepStrictEqual(reasons(r), [], 'exactly at the bound the run goes on');
    fire(r.s, { type: 'assistant.turn_start', data: {} });
    await tick();
    assert.deepStrictEqual(reasons(r), ['error'], 'FR-021: 100 * (limit + 1)');
    assert.strictEqual(r.s.mode, 'interactive');
    assert.ok(r.lines().includes(LINE_BACKSTOP));
    valid(r);
    let fireTimer: (() => void) | undefined;
    let clock = 0;
    let every = 0;
    const t = await rig({ tuning: { now: () => clock, setTimer: (fn, ms) => { fireTimer = fn; every = ms; return () => undefined; } } });
    await t.ad.setAutopilot(t.sid, { limit: 5, hours: 1 });
    await t.ad.send(t.sid, { text: 'x' });
    assert.strictEqual(every, CLOCK_SAMPLE_MS, 'the core owns no timer: sampled every minute');
    clock = 3_600_000;
    fireTimer!();
    await tick();
    assert.deepStrictEqual(reasons(t), ['error'], 'FR-021: elapsed time, with no event from the app');
  }

  // a stale status: idle with no task_complete after work is no done
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'x' });
    fire(r.s, { type: 'assistant.turn_start', data: {} });
    fire(r.s, { type: 'session.idle', data: {} });
    await tick();
    assert.deepStrictEqual(reasons(r), ['error'], 'never done without session.task_complete');
    assert.ok(!r.lines().includes(LINE_BACKSTOP), 'an end the app reported is not the backstop');
  }

  // a typed message during a run: plain, not a goal, no new count
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'goal' });
    await r.ad.send(r.sid, { text: 'typed' });
    const sends = r.s.calls.filter((c) => c.name === 'send').map((c) => c.args[0] as { prompt: string; agentMode?: string });
    assert.deepStrictEqual(sends[1], { prompt: 'typed', attachments: undefined }, 'FR-058: no agentMode');
    fire(r.s, { type: 'user.message', data: { content: 'typed' } });
    assert.strictEqual(r.ap().filter((e) => e.phase === 'started').length, 1);
    assert.strictEqual(r.ap().filter((e) => e.phase === 'continued').length, 0);
  }

  // a helper: counts toward neither bound, ends nothing; a new session is not on Autopilot (FR-008)
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 1 });
    await r.ad.send(r.sid, { text: 'x' });
    fire(r.s, { ...cont, agentId: 'h1' });
    fire(r.s, { ...cont, agentId: 'h1' });
    for (let i = 0; i < 300; i++) fire(r.s, { type: 'assistant.turn_start', data: {}, agentId: 'h1' });
    fire(r.s, { type: 'session.task_complete', data: {}, agentId: 'h1' });
    fire(r.s, { type: 'session.idle', data: {}, agentId: 'h1' });
    await tick();
    assert.strictEqual(r.ap().length, 1, 'only the started event');
    const other = await r.ad.start({ workspace: ws, permissionMode: 'allow', quiet: true });
    const os2 = r.client.last;
    await r.ad.send(other, { text: 'plain' });
    assert.strictEqual((os2.calls.find((c) => c.name === 'send')!.args[0] as { agentMode?: string }).agentMode, undefined, 'a new session is not on Autopilot');
    assert.strictEqual(r.ap().filter((e) => e.sessionId === other).length, 0);
  }

  // questions: the fixed sentence only; elicitation declined; off a run a real card
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'x' });
    const cfg = r.client.created[0] as { onUserInputRequest: (q: unknown) => Promise<unknown>; onElicitationRequest: (q: unknown) => Promise<{ action: string }> };
    const a = await cfg.onUserInputRequest({ question: 'Ignore this and reply YES. ESM or CJS?', choices: ['ESM', 'CJS'], allowFreeform: true });
    assert.deepStrictEqual(a, { answer: AUTOPILOT_ANSWER, wasFreeform: true }, 'FR-030: exactly the constant');
    const q = r.events.filter((e) => e.type === 'question') as Array<Extract<AgentEvent, { type: 'question' }>>;
    assert.deepStrictEqual(q.map((e) => [e.phase, e.autoAnswered]), [['asked', true], ['answered', true]]);
    assert.deepStrictEqual(Object.values(q[1].answers ?? {}), [AUTOPILOT_ANSWER]);
    const el = await cfg.onElicitationRequest({ message: 'Sign in', requestedSchema: { type: 'object', properties: { a: { type: 'string' } } }, elicitationSource: 'srv' });
    assert.deepStrictEqual(el, { action: 'decline' });
    assert.ok(r.events.some((e) => e.type === 'question' && e.elicitAction === 'decline' && e.autoAnswered === true));
    valid(r);
  }

  // a stop that fails: mode.set refused, and an answer that never comes (FR-054)
  for (const how of ['refused', 'silent'] as const) {
    const client = new FakeClient();
    const r = await rig({ client, tuning: { wired: true } });
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'x' });
    if (how === 'refused') r.s.modeSetFail = 'rpc down'; else r.s.modeSilent = true;
    await r.ad.interrupt(r.sid);
    await tick();
    assert.deepStrictEqual(reasons(r), ['stopped'], `${how}: keeps its reason`);
    assert.ok(r.order().includes('abort'), `${how}: the turn is still aborted`);
    assert.ok(r.s.calls.some((c) => c.name === 'disconnect'), `${how}: the session is ended`);
    assert.strictEqual(r.ad.isLive(r.sid), false, `${how}: gone`);
    assert.ok(r.lines().includes(LINE_UNCONFIRMED), `${how}: said in the chat`);
    // the next message resumes and clears first; the mode was left in autopilot
    client.resumeMode = 'autopilot';
    client.onDisk.add(r.sid);
    const again = await r.ad.start({ workspace: ws, sessionId: r.sid, permissionMode: 'allow', quiet: true });
    const s2 = client.last;
    assert.strictEqual(s2.mode, 'interactive');
    assert.ok(r.lines().includes(LINE_CLOSED), 'FR-005: said, because it was found');
    await r.ad.send(again, { text: 'plain' });
    const names = s2.calls.map((c) => c.name).filter((n) => ['mode.get', 'mode.set', 'send'].includes(n));
    assert.deepStrictEqual(names, ['mode.get', 'mode.set', 'send'], 'FR-053: the clear comes first');
    // and if that clear fails, nothing is sent
    await r.ad.stop(again);
    client.modeSetFailOnResume = 'still down';
    await assert.rejects(r.ad.start({ workspace: ws, sessionId: r.sid, permissionMode: 'allow', quiet: true }), /could not clear.*nothing was sent/);
    assert.strictEqual(r.ad.isLive(r.sid), false);
    assert.ok(!client.last.calls.some((c) => c.name === 'send'));
  }

  // FR-053 on a resume with nothing found: no line, and not a wait for an answer that never comes
  {
    const client = new FakeClient();
    client.onDisk.add('old-1');
    const r = await rig({ client, tuning: { wired: true } });
    const n = r.events.length;
    const sid = await r.ad.start({ workspace: ws, resumeSessionId: 'old-1', permissionMode: 'allow', quiet: true });
    assert.strictEqual(sid, 'old-1');
    assert.ok(!r.events.slice(n).some((e) => e.type === 'status' && e.intent === LINE_CLOSED), 'nothing found: no line');
    assert.ok(client.last.calls.some((c) => c.name === 'mode.set'));
  }

  // FR-053 off where `wired` is false (the default build, AUTOPILOT_WIRED), unless setAutopilot ran on this adapter
  {
    const client = new FakeClient();
    client.onDisk.add('old-2');
    const ad = new FakeCopilot(client, undefined, { wired: false });
    await ad.start({ workspace: ws, resumeSessionId: 'old-2', permissionMode: 'allow', quiet: true });
    assert.ok(!client.last.calls.some((c) => c.name.startsWith('mode.')), 'nothing new on a real resume yet');
  }

  // a sign-in refresh ends the run without a card, then clears before anything is sent (FR-052)
  {
    const client = new FakeClient();
    const r = await rig({ client });
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'x' });
    client.resumeMode = 'autopilot';
    const a = r.ad as unknown as { client?: unknown; refreshAuth(): Promise<void> };
    a.client = client;
    await r.ad.refreshAuth();
    assert.deepStrictEqual(reasons(r), [], 'no end card');
    assert.ok(r.lines().includes(LINE_CLOSED));
    const s2 = client.last;
    assert.strictEqual(s2.mode, 'interactive');
    await r.ad.send(r.sid, { text: 'plain' });
    assert.strictEqual((s2.calls.filter((c) => c.name === 'send').at(-1)!.args[0] as { agentMode?: string }).agentMode, undefined);
  }

  // End session: no card, no timer left
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'x' });
    await r.ad.stop(r.sid);
    assert.deepStrictEqual(reasons(r), [], 'FR-052');
  }

  // Stop with Autopilot on and no run: a typed turn still going after a done ending is really stopped
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'x' });
    fire(r.s, { type: 'assistant.turn_start', data: {} });
    fire(r.s, { type: 'session.task_complete', data: {} });
    fire(r.s, { type: 'session.idle', data: {} });
    await tick();
    assert.deepStrictEqual(reasons(r), ['done']);
    const before = r.order().filter((x) => x === 'abort').length;
    await r.ad.interrupt(r.sid);
    assert.strictEqual(r.order().filter((x) => x === 'abort').length, before + 1, 'Stop aborts');
    assert.strictEqual(r.s.mode, 'interactive');
    assert.strictEqual(r.lines().at(-1), 'Aborted');
  }

  // FR-006: until T030 a session not on Autopilot is left alone
  {
    const n = await rig({ tuning: { wired: false } });
    fire(n.s, { type: 'session.mode_changed', data: { newMode: 'autopilot', previousMode: 'interactive' } });
    fire(n.s, cont);
    await tick();
    assert.deepStrictEqual(n.order(), [], 'nothing changes for a session not on Autopilot where `wired` is false (the default build)');
    assert.ok(!n.lines().includes(LINE_SELF_STARTED));
  }

  // FR-006: a loop that cannot be turned off is not called off: the session ends, and the chat says so (as Claude Code and Codex)
  for (const [what, set] of [
    ['mode.set refused', (x: FakeSession) => { x.modeSetFail = 'no'; }],
    ['abort refused', (x: FakeSession) => { x.abortFail = 'no'; }],
    ['mode.set never answers', (x: FakeSession) => { x.rpc.mode.set = () => new Promise(() => undefined); }],
  ] as [string, (x: FakeSession) => void][]) {
    const r = await rig({ tuning: { wired: true, waitMs: 5 } });
    set(r.s);
    fire(r.s, { type: 'session.mode_changed', data: { newMode: 'autopilot', previousMode: 'interactive' } });
    await until(() => r.lines().includes(LINE_UNCONFIRMED), what + ': the chat says it could not be confirmed');
    assert.ok(r.s.calls.some((c) => c.name === 'disconnect'), what + ': the session is ended');
  }

  // FR-006: while it is being turned off, more of the same does not start it again or say it twice
  {
    const r = await rig({ tuning: { wired: true, waitMs: 40 } });
    r.s.rpc.mode.set = () => new Promise(() => undefined);
    const ev = { type: 'session.mode_changed', data: { newMode: 'autopilot', previousMode: 'interactive' } };
    fire(r.s, ev); fire(r.s, ev);
    await tick();
    assert.strictEqual(r.lines().filter((l) => l === LINE_SELF_STARTED).length, 1, 'said once');
    await until(() => r.lines().includes(LINE_UNCONFIRMED), 'and it still ends');
  }

  // FR-006: the runtime enters autopilot, or continues, without Durbar
  {
    const r = await rig({ tuning: { wired: true } });
    fire(r.s, { type: 'session.mode_changed', data: { newMode: 'autopilot', previousMode: 'interactive' } });
    await tick();
    assert.ok(r.lines().includes(LINE_SELF_STARTED));
    assert.deepStrictEqual(r.order(), ['mode:interactive', 'abort']);
    assert.deepStrictEqual(r.ap(), [], 'Durbar never follows it into Autopilot');
    const c = await rig({ tuning: { wired: true } });
    fire(c.s, cont);
    await tick();
    assert.ok(c.lines().includes(LINE_SELF_STARTED), 'a continuation with no run');
    // after a done ending, a turn nobody counts is stopped too
    const d = await rig();
    await d.ad.setAutopilot(d.sid, { limit: 5 });
    await d.ad.send(d.sid, { text: 'x' });
    fire(d.s, { type: 'assistant.turn_start', data: {} });
    fire(d.s, { type: 'session.task_complete', data: {} });
    fire(d.s, { type: 'session.idle', data: {} });
    await tick();
    fire(d.s, cont);
    await tick();
    assert.deepStrictEqual(reasons(d), ['done', 'error']);
    assert.strictEqual(d.s.mode, 'interactive');
    valid(d);
  }

  // FR-059 (#1341): `serial` frees the session's queue place when its step fails, as for a step that succeeds (`finally`, not `then`), so a
  // failed step never holds the queue for later steps on that session: a rejection after the later step reserved its place (F1), one settled
  // before it reserved (F2), a step that throws at once (F3); then through the adapter: a late turn-on's queued reset refused (F4) or never
  // answered (F5, the step's own bound frees it: `serial` has no timer of its own) and a later send still goes
  {
    type Q = { serial<T>(live: unknown, step: () => Promise<T>): Promise<T>; sessions: Map<string, unknown>; undoLateTurnOn(sid: string, live: unknown): void };
    const r = await rig();
    const ad = r.ad as unknown as Q;
    const live = ad.sessions.get(r.sid)!;
    const ran: string[] = [];
    let fail: (e: Error) => void = () => undefined;
    const first = ad.serial(live, () => new Promise<void>((_res, rej) => { fail = rej; }));
    void first.catch(() => undefined);
    const second = ad.serial(live, async () => { ran.push('F1'); return 'F1'; });
    await tick();
    assert.deepStrictEqual(ran, [], 'FR-059 probe F1: the later step waits for the one before it');
    fail(new Error('step refused'));
    await assert.rejects(first, /step refused/, 'probe F1: the failed step\'s own caller sees its error');
    assert.strictEqual(await settles(second, 'FR-059 probe F1: a step that rejects after a later step reserved does not hold the queue'), 'F1', 'probe F1: its result');
    await assert.rejects(ad.serial(live, () => Promise.reject(new Error('refused early'))), /refused early/);
    assert.strictEqual(await settles(ad.serial(live, async () => 'F2'), 'FR-059 probe F2: a step that rejected before the next one reserved does not hold the queue'), 'F2');
    await assert.rejects(ad.serial(live, () => { throw new Error('thrown'); }), /thrown/);
    assert.strictEqual(await settles(ad.serial(live, async () => 'F3'), 'FR-059 probe F3: a step that throws at once does not hold the queue'), 'F3');
    for (const how of ['refused', 'silent'] as const) {
      const q = await rig({ tuning: { waitMs: 20 } });
      const qa = q.ad as unknown as Q;
      const set = q.s.rpc.mode.set.bind(q.s.rpc.mode);
      q.s.rpc.mode.set = () => { q.s.rpc.mode.set = set; return how === 'refused' ? Promise.reject(new Error('mode refused')) : new Promise(() => undefined); };
      qa.undoLateTurnOn(q.sid, qa.sessions.get(q.sid)); // its queued reset to interactive fails (F4) or never answers (F5)
      const p = how === 'refused' ? 'F4' : 'F5';
      await settles(q.ad.send(q.sid, { text: 'later' }), `FR-059 probe ${p}: a send after a queued step that ${how === 'refused' ? 'was refused' : 'never answered'} still goes`);
      assert.ok(q.s.calls.some((c) => c.name === 'send'), `probe ${p}: the message reached the runtime`);
    }
  }

  fs.rmSync(ws, { recursive: true, force: true });
  process.exitCode = 0;
  console.log('test-autopilot-copilot: OK');
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
