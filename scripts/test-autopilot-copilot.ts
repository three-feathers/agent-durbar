/**
 * Spec 099 T022..T028 on the fake Copilot SDK: no runtime, no account, no credits. Event shapes replay the probes (T090, T093).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import type { FakeSession } from './fakes/copilot-sdk';
import { COPILOT_CAPABILITIES, copilotTaskEnd } from '../src/adapters/copilot';
import { AUTOPILOT_ANSWER, CLOCK_SAMPLE_MS } from '../src/adapters/autopilot';
import { LINE_BACKSTOP, LINE_CAP_NOT_RESTORED, LINE_CLOSED, LINE_SELF_STARTED, LINE_UNCONFIRMED } from '../src/adapters/autopilotHost';
import type { AutopilotTuning } from '../src/adapters/autopilotHost';
import { eventProblems } from '../src/adapters/eventguard';
import type { AgentEvent } from '../src/adapters/types';

const NANO = 1e9;
const tick = async (n = 6): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
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

async function main(): Promise<void> {
  process.exitCode = 1;
  assert.deepStrictEqual({ ...COPILOT_CAPABILITIES.autopilot }, { capUnit: 'aiu', attachments: true, planApproval: true, verified: false }, 'T022: capability, not verified');

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

  // FR-053 stays off in a real session until T030 wires it (AUTOPILOT_WIRED), unless setAutopilot ran on this adapter
  {
    const client = new FakeClient();
    client.onDisk.add('old-2');
    const ad = new FakeCopilot(client);
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
    const n = await rig();
    fire(n.s, { type: 'session.mode_changed', data: { newMode: 'autopilot', previousMode: 'interactive' } });
    fire(n.s, cont);
    await tick();
    assert.deepStrictEqual(n.order(), [], 'nothing changes for a session not on Autopilot in this phase');
    assert.ok(!n.lines().includes(LINE_SELF_STARTED));
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

  fs.rmSync(ws, { recursive: true, force: true });
  process.exitCode = 0;
  console.log('test-autopilot-copilot: OK');
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
