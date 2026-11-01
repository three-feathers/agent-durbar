/**
 * Spec 099 T021, T023..T028 on the scripted app-server: no process, no account, no credits. Notifications replay the probes (T093).
 */
import * as assert from 'assert';
import * as os from 'os';
import { CODEX_CAPABILITIES, CodexAdapter } from '../src/adapters/codex';
import { AUTOPILOT_ANSWER } from '../src/adapters/autopilot';
import { LINE_BACKSTOP, LINE_CLOSED, LINE_SELF_STARTED, LINE_UNCONFIRMED } from '../src/adapters/autopilotHost';
import type { AutopilotTuning } from '../src/adapters/autopilotHost';
import { eventProblems } from '../src/adapters/eventguard';
import type { AgentEvent } from '../src/adapters/types';
import { FakeCodexServer } from './fakes/codex-app-server';
import type { FakeCodexOptions } from './fakes/codex-app-server';

const settle = async (s: FakeCodexServer, n = 10): Promise<void> => { for (let i = 0; i < n; i++) { await s.flush(); await new Promise((r) => setImmediate(r)); } };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let finished = false;
process.on('beforeExit', () => { if (!finished) { console.error('autopilot codex: did not finish'); process.exitCode = 1; } });

interface Rig { ad: CodexAdapter; srv: FakeCodexServer; sid: string; tid: string; events: AgentEvent[]; ap: () => Array<Extract<AgentEvent, { type: 'autopilot' }>>; reasons: () => unknown[]; lines: () => string[]; wire: () => string[] }
function make(o: FakeCodexOptions = {}, tuning?: AutopilotTuning): { ad: CodexAdapter; srv: FakeCodexServer; events: AgentEvent[] } {
  const srv = new FakeCodexServer({ goals: true, ...o });
  const ad = new CodexAdapter({ spawn: srv.spawn, locate: async () => ({ path: '/fake/codex', version: '0.163.0' }), platform: 'linux', env: {}, realpath: (p) => p, closeGraceMs: 5, killGraceMs: 5, autopilot: { waitMs: 40, ...tuning } });
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  return { ad, srv, events };
}
async function rig(o: FakeCodexOptions = {}, tuning?: AutopilotTuning, mode: 'allow' | 'ask' = 'allow'): Promise<Rig> {
  const { ad, srv, events } = make(o, tuning);
  const sid = await ad.start({ workspace: os.tmpdir(), permissionMode: mode, quiet: true });
  const tid = ad.resumeIdOf(sid) as string;
  return view(ad, srv, events, sid, tid);
}
function view(ad: CodexAdapter, srv: FakeCodexServer, events: AgentEvent[], sid: string, tid: string): Rig {
  return {
    ad, srv, sid, tid, events,
    ap: () => events.filter((e) => e.type === 'autopilot') as Array<Extract<AgentEvent, { type: 'autopilot' }>>,
    reasons: () => (events.filter((e) => e.type === 'autopilot' && e.phase === 'ended') as Array<{ reason?: unknown }>).map((e) => e.reason),
    lines: () => events.filter((e) => e.type === 'status' && e.intent).map((e) => (e as { intent: string }).intent),
    wire: () => srv.wire.map((w) => w.method).filter((m) => /^(thread\/goal\/|turn\/|thread\/resume)/.test(m)),
  };
}
const valid = (r: Rig): void => { for (const e of r.events) assert.deepStrictEqual(eventProblems(e), [], `event ${e.type} is valid: ${JSON.stringify(e).slice(0, 200)}`); };
const status = (r: Rig, s: string, used?: number): void => r.srv.goalUpdate(r.tid, s, used);
async function onRun(r: Rig, limit = 5, more: Record<string, unknown> = {}): Promise<void> {
  await r.ad.setAutopilot(r.sid, { limit, ...more });
  await r.ad.send(r.sid, { text: 'do it' });
  await settle(r.srv);
}
/** The open goal turn ends and the app starts the next one. */
async function next(r: Rig): Promise<void> {
  r.srv.endTurn(r.tid);
  r.srv.goalTurn(r.tid);
  await settle(r.srv);
}

async function main(): Promise<void> {
  process.exitCode = 1;
  assert.deepStrictEqual({ ...CODEX_CAPABILITIES.autopilot }, { capUnit: 'tokens', attachments: false, planApproval: false, verified: false }, 'T021');

  {
    const r = await rig({}, undefined, 'ask');
    await assert.rejects(r.ad.setAutopilot(r.sid, { limit: 5 }), /only in Allow all/);
  }

  // to done: goal/set in place of turn/start with tokenBudget, the first turn is no continuation, status complete, clear after; stays on Autopilot
  {
    const r = await rig();
    await onRun(r, 5, { cap: 8000 });
    assert.deepStrictEqual(r.wire(), ['thread/goal/set'], 'FR-012: no turn/start');
    const set = r.srv.requests('thread/goal/set')[0].params as Record<string, unknown>;
    assert.deepStrictEqual(set, { threadId: r.tid, objective: 'do it', tokenBudget: 8000, origin: 'user' });
    assert.strictEqual(r.ap().filter((e) => e.phase === 'continued').length, 0, 'FR-020: the first turn is not a continuation');
    await next(r);
    await next(r);
    assert.deepStrictEqual(r.ap().filter((e) => e.phase === 'continued').map((e) => e.n), [1, 2]);
    status(r, 'active');
    await settle(r.srv);
    assert.deepStrictEqual(r.reasons(), [], 'active is no end');
    status(r, 'complete', 1234);
    await settle(r.srv);
    assert.deepStrictEqual(r.reasons(), ['done']);
    assert.deepStrictEqual(r.ap().at(-1)!.spend, { unit: 'tokens', value: 1234 });
    assert.deepStrictEqual(r.wire().slice(-1), ['thread/goal/clear'], 'FR-041; the turn may finish');
    assert.ok(!r.wire().includes('turn/interrupt'));
    r.srv.endTurn(r.tid);
    await settle(r.srv);
    await r.ad.send(r.sid, { text: 'next' });
    await settle(r.srv);
    assert.strictEqual(r.srv.requests('thread/goal/set').length, 2, 'D8: a new run');
    assert.strictEqual((r.srv.requests('thread/goal/set')[1].params as { tokenBudget: unknown }).tokenBudget, 8000);
    assert.ok(!r.lines().includes(LINE_BACKSTOP));
    valid(r);
  }

  // every other status
  for (const [st, want] of [['budgetLimited', 'cap'], ['usageLimited', 'cap'], ['blocked', 'blocked'], ['paused', 'blocked']] as const) {
    const r = await rig();
    await onRun(r);
    status(r, st);
    await settle(r.srv);
    assert.deepStrictEqual(r.reasons(), [want], st);
    assert.ok(!r.wire().includes('turn/interrupt'), `${st}: the running turn finishes (FR-022)`);
    assert.ok(r.wire().includes('thread/goal/clear'));
    await r.ad.send(r.sid, { text: 'plain' });
    await settle(r.srv);
    assert.ok(r.wire().includes('turn/start'), 'S3: a plain message, not a new goal');
    assert.strictEqual(r.srv.requests('thread/goal/set').length, 1);
  }

  // to the limit: goal/clear, then turn/interrupt; a later turn is interrupted again and not counted
  {
    const r = await rig();
    await onRun(r, 1);
    await next(r);
    await next(r);
    assert.deepStrictEqual(r.reasons(), ['limit']);
    assert.strictEqual(r.ap().at(-1)!.n, 1);
    assert.deepStrictEqual(r.wire(), ['thread/goal/set', 'thread/goal/clear', 'turn/interrupt'], 'FR-050');
    r.srv.goalTurn(r.tid);
    await settle(r.srv);
    assert.strictEqual(r.wire().filter((m) => m === 'turn/interrupt').length, 2, 'the guard');
    assert.strictEqual(r.ap().filter((e) => e.phase === 'continued').length, 1);
    valid(r);
    // a plain message after the end is not a continuation and not interrupted
    const p = await rig();
    await onRun(p, 1);
    await next(p);
    await next(p);
    await settle(p.srv);
    const n = p.wire().filter((m) => m === 'turn/interrupt').length;
    await p.ad.send(p.sid, { text: 'plain' });
    await settle(p.srv);
    assert.strictEqual(p.wire().filter((m) => m === 'turn/interrupt').length, n, 'its own turn is left alone');
  }

  // Stop mid-run, and before the first turn's id is known
  {
    const r = await rig();
    await onRun(r);
    await r.ad.interrupt(r.sid);
    await settle(r.srv);
    assert.deepStrictEqual(r.reasons(), ['stopped']);
    assert.deepStrictEqual(r.wire(), ['thread/goal/set', 'thread/goal/clear', 'turn/interrupt']);
    assert.ok(r.lines().includes('Aborted'));
    assert.ok(!r.srv.goals.has(r.tid));
    const e = await rig();
    await e.ad.setAutopilot(e.sid, { limit: 5 });
    await e.ad.send(e.sid, { text: 'x' });
    await e.ad.interrupt(e.sid);
    await settle(e.srv);
    assert.deepStrictEqual(e.wire(), ['thread/goal/set', 'thread/goal/clear', 'turn/interrupt'], 'the interrupt goes as soon as the id arrives');
  }

  // FR-051
  {
    const r = await rig();
    await onRun(r);
    r.ad.setPermMode(r.sid, 'ask');
    await settle(r.srv);
    assert.deepStrictEqual(r.reasons(), ['stopped']);
    await assert.rejects(r.ad.setAutopilot(r.sid, { limit: 5 }), /only in Allow all/, 'SC-002');
  }

  // refusals: attachments, plan first, empty; and FR-011's Claude words are text here
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await assert.rejects(r.ad.send(r.sid, { text: 'x', attachments: [{ path: '/a', kind: 'file' } as never] }), /text only/);
    await assert.rejects(r.ad.send(r.sid, { text: 'x', plan: true }), /Plan first/);
    await assert.rejects(r.ad.send(r.sid, { text: '  ' }), /finished result/);
    assert.deepStrictEqual(r.wire(), []);
    assert.deepStrictEqual(r.ap(), []);
    await assert.rejects(r.ad.setAutopilot(r.sid, { limit: 5, cap: 0 }), /token cap/);
    await assert.rejects(r.ad.setAutopilot(r.sid, { limit: 0 }), /limit/);
    await r.ad.send(r.sid, { text: 'stop' });
    await settle(r.srv);
    assert.strictEqual((r.srv.requests('thread/goal/set')[0].params as { objective: string }).objective, 'stop');
  }

  // goal/set refused: the run ends error, the chat says so, the send fails
  {
    const r = await rig({ goalSetError: 'ephemeral threads do not support goals' });
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await assert.rejects(r.ad.send(r.sid, { text: 'x' }), /ephemeral/);
    await settle(r.srv);
    assert.deepStrictEqual(r.reasons(), ['error']);
    assert.ok(r.lines().some((l) => /refused the message/.test(l)));
    assert.ok(!r.lines().includes(LINE_BACKSTOP));
  }

  // a typed message: not counted; a turn/started before its reply is held; a failed reply counts it
  {
    const r = await rig({ holdTurn: true, turnScript: [] });
    await onRun(r, 5);
    await r.ad.send(r.sid, { text: 'typed' });
    await settle(r.srv);
    assert.strictEqual(r.ap().filter((e) => e.phase === 'continued').length, 0, 'FR-058: typed reply first');
    assert.strictEqual(r.srv.requests('thread/goal/set').length, 1, 'never a new goal');
    // the same turn's own turn/started, replied first
    const typedId = (r.srv.wire.length, [...(r.ad as unknown as { sessions: Map<string, { ownTurns: Set<string> }> }).sessions.values()][0].ownTurns);
    assert.strictEqual(typedId.size, 1);
    r.srv.note(r.tid, 'turn/started', { turn: { id: [...typedId][0], status: 'inProgress' } });
    r.srv.note(r.tid, 'turn/completed', { turn: { id: [...typedId][0], status: 'completed' } });
    await settle(r.srv);
    assert.strictEqual(r.ap().filter((e) => e.phase === 'continued').length, 0);

    const h = await rig({ holdTurnStart: true });
    await onRun(h, 5);
    const pending = h.ad.send(h.sid, { text: 'typed' }).catch(() => undefined);
    await settle(h.srv);
    h.srv.note(h.tid, 'turn/started', { turn: { id: 'early', status: 'inProgress' } });
    await settle(h.srv);
    assert.strictEqual(h.ap().filter((e) => e.phase === 'continued').length, 0, 'held while the reply is outstanding');
    h.srv.releaseTurnStart();
    await pending;
    await settle(h.srv);
    assert.strictEqual(h.ap().filter((e) => e.phase === 'continued').length, 1, 'not the typed one: counted at the reply');

    const f = await rig({ holdTurnStart: true });
    await onRun(f, 5);
    const a = f.srv.requests('turn/start').length;
    f.srv.opts.exitOn = undefined;
    const rpc = [...(f.ad as unknown as { sessions: Map<string, { rpc: { request: (m: string, p: unknown) => Promise<unknown> } }> }).sessions.values()][0].rpc;
    const orig = rpc.request.bind(rpc);
    let failReply!: (e: Error) => void;
    rpc.request = (m: string, p: unknown): Promise<unknown> => (m === 'turn/start' ? new Promise((_, rej) => { failReply = rej; }) : orig(m, p));
    const pend = f.ad.send(f.sid, { text: 'typed' }).catch(() => undefined);
    await settle(f.srv);
    assert.strictEqual(f.srv.requests('turn/start').length, a);
    f.srv.note(f.tid, 'turn/started', { turn: { id: 'early', status: 'inProgress' } });
    await settle(f.srv);
    assert.strictEqual(f.ap().filter((e) => e.phase === 'continued').length, 0);
    failReply(Object.assign(new Error('refused'), { kind: 'rpc' }));
    await pend;
    await settle(f.srv);
    assert.strictEqual(f.ap().filter((e) => e.phase === 'continued').length, 1, 'FR-058: a failed reply counts it');
  }

  // the backstop with turn/started removed: more than limit + 1 turn/completed of its thread; typed ones left out; time too
  {
    const r = await rig();
    await r.ad.setAutopilot(r.sid, { limit: 1 });
    await r.ad.send(r.sid, { text: 'x' });
    await settle(r.srv);
    r.srv.endTurn(r.tid);
    await settle(r.srv);
    r.srv.note(r.tid, 'turn/completed', { turn: { id: 'm2', status: 'completed' } });
    await settle(r.srv);
    assert.deepStrictEqual(r.reasons(), [], 'exactly limit + 1');
    r.srv.note(r.tid, 'turn/completed', { turn: { id: 'm3', status: 'completed' } });
    await settle(r.srv);
    assert.deepStrictEqual(r.reasons(), ['error'], 'FR-021');
    assert.ok(r.lines().includes(LINE_BACKSTOP));
    valid(r);
    let fire: (() => void) | undefined;
    let clock = 0;
    const t = await rig({}, { now: () => clock, setTimer: (fn) => { fire = fn; return () => undefined; } });
    await onRun(t, 5, { hours: 1 });
    clock = 3_600_000;
    fire!();
    await settle(t.srv);
    assert.deepStrictEqual(t.reasons(), ['error'], 'elapsed time');
    // a failed turn ends a run with error
    const x = await rig();
    await onRun(x);
    x.srv.endTurn(x.tid, 'failed');
    await settle(x.srv);
    assert.deepStrictEqual(x.reasons(), ['error']);
  }

  // a helper's thread counts toward neither bound, ends nothing; a goal only on the main thread; a new session is not on Autopilot (FR-008)
  {
    const r = await rig();
    await onRun(r, 1);
    const child = r.srv.children[0];
    for (let i = 0; i < 5; i++) {
      child.send({ method: 'turn/started', params: { threadId: 'helper', turn: { id: `h${i}` } } });
      child.send({ method: 'turn/completed', params: { threadId: 'helper', turn: { id: `h${i}`, status: 'completed' } } });
    }
    child.send({ method: 'thread/goal/updated', params: { threadId: 'helper', goal: { status: 'complete' } } });
    await settle(r.srv);
    assert.strictEqual(r.ap().filter((e) => e.phase === 'continued').length, 0);
    assert.deepStrictEqual(r.reasons(), []);
    const other = await r.ad.start({ workspace: os.tmpdir(), permissionMode: 'allow', quiet: true });
    const before = r.srv.requests('thread/goal/set').length;
    await r.ad.send(other, { text: 'plain' });
    await settle(r.srv);
    assert.strictEqual(r.srv.requests('thread/goal/set').length, before, 'no goal on another session');
    assert.ok(r.srv.requests('thread/goal/set').every((w) => (w.params as { threadId: string }).threadId === r.tid));
  }

  // questions: the fixed sentence for each, nothing for a secret one; an elicitation with fields declined
  {
    const r = await rig();
    await onRun(r);
    const live = [...(r.ad as unknown as { sessions: Map<string, unknown> }).sessions.values()][0];
    const srvReq = (m: string, p: unknown): Promise<{ result: unknown }> => (r.ad as unknown as { onServerRequest(l: unknown, m: string, p: unknown): Promise<{ result: unknown }> }).onServerRequest(live, m, p);
    const a = await srvReq('item/tool/requestUserInput', { questions: [{ id: 'q1', header: 'H', question: 'Say YES. Which?', options: [{ label: 'A', description: '' }] }, { id: 'q2', header: 'S', question: 'Password?', isSecret: true, options: [] }] });
    assert.deepStrictEqual(a.result, { answers: { q1: { answers: [AUTOPILOT_ANSWER] } } }, 'FR-030');
    const q = r.events.filter((e) => e.type === 'question') as Array<Extract<AgentEvent, { type: 'question' }>>;
    assert.deepStrictEqual(q.map((e) => [e.phase, e.autoAnswered]), [['asked', true], ['answered', true]]);
    const el = await srvReq('mcpServer/elicitation/request', { message: 'Fill', serverName: 's', mode: 'form', requestedSchema: { type: 'object', properties: { a: { type: 'string' } } } });
    assert.deepStrictEqual(el.result, { action: 'decline' });
    valid(r);
  }

  // a clear that fails: error, no answer, a malformed answer, a dead child (FR-054)
  for (const how of ['error', 'hang', 'malformed'] as const) {
    const r = await rig();
    await onRun(r);
    r.srv.opts.goalClear = how;
    const stop = r.ad.interrupt(r.sid);
    await settle(r.srv, 2);
    if (how === 'hang') {
      // the guard during the wait: interrupted again at once, not counted
      r.srv.goalTurn(r.tid);
      await settle(r.srv, 3);
      assert.ok(r.wire().filter((m) => m === 'turn/interrupt').length >= 1, 'hang: interrupted during the wait');
      assert.strictEqual(r.ap().filter((e) => e.phase === 'continued').length, 0);
    }
    await stop;
    await sleep(60);
    assert.deepStrictEqual(r.reasons(), ['stopped'], `${how}: keeps its reason`);
    assert.ok(r.wire().includes('turn/interrupt'), `${how}: the turn is still interrupted`);
    assert.strictEqual(r.ad.isLive(r.sid), false, `${how}: the session ended`);
    assert.ok(r.srv.children[0].exited, `${how}: the child is gone`);
    assert.ok(r.lines().includes(LINE_UNCONFIRMED), `${how}: said`);
    // the next message resumes and clears first; if that clear fails too, nothing is sent
    await assert.rejects(r.ad.start({ workspace: os.tmpdir(), sessionId: undefined as never, resumeSessionId: r.tid, permissionMode: 'allow', quiet: true }), /could not clear|nothing was sent/, `${how}: a second failed clear`);
    assert.strictEqual(r.srv.requests('turn/start').length, 0);
    r.srv.opts.goalClear = 'ok';
    r.srv.goals.add(r.tid);
    const sid = await r.ad.start({ workspace: os.tmpdir(), resumeSessionId: r.tid, permissionMode: 'allow', quiet: true });
    await r.ad.send(sid, { text: 'plain' });
    await settle(r.srv);
    const w = r.wire();
    assert.deepStrictEqual(w.slice(w.lastIndexOf('thread/resume')), ['thread/resume', 'thread/goal/clear', 'turn/start'], 'FR-053: the clear comes first');
    assert.ok(r.lines().includes(LINE_CLOSED), 'FR-005: found, so said');
  }
  {
    const r = await rig();
    await onRun(r);
    r.srv.children[0].exit(1, null);
    await settle(r.srv);
    await sleep(10);
    assert.deepStrictEqual(r.reasons(), ['error'], 'a dead child');
    assert.strictEqual(r.ad.isLive(r.sid), false);
    assert.ok(r.lines().includes(LINE_UNCONFIRMED));
    valid(r);
  }

  // Stop, a stricter mode and End session while `send` reopens the session: no goal, and the mode read again (the 044 approach)
  {
    const reopening = async (): Promise<{ r: Rig; p: Promise<void> }> => {
      const r = await rig({}, undefined, 'ask');
      r.ad.setPermMode(r.sid, 'allow');
      await r.ad.setAutopilot(r.sid, { limit: 5 });
      const p = r.ad.send(r.sid, { text: 'go' });
      await new Promise((res) => setImmediate(res));
      assert.strictEqual(r.ad.isLive(r.sid), false, 'the window: closed, not yet open');
      return { r, p };
    };
    const a = await reopening();
    await a.r.ad.interrupt(a.r.sid);
    await a.p;
    await settle(a.r.srv);
    assert.strictEqual(a.r.srv.requests('thread/goal/set').length, 0, 'Stop during the reopen sends no goal');
    assert.strictEqual(a.r.srv.requests('turn/start').length, 0, 'and nothing else');
    assert.ok(a.r.ad.isLive(a.r.sid), 'the session is back');
    assert.deepStrictEqual(a.r.ap(), [], 'no run began');
    assert.strictEqual(a.r.lines().at(-1), 'Aborted');
    await a.r.ad.send(a.r.sid, { text: 'plain' });
    await settle(a.r.srv);
    assert.strictEqual(a.r.srv.requests('thread/goal/set').length, 0, 'Autopilot is off after that Stop');
    assert.strictEqual(a.r.srv.requests('turn/start').length, 1);

    const b = await reopening();
    b.r.ad.setPermMode(b.r.sid, 'read-only');
    await b.p;
    await settle(b.r.srv);
    assert.strictEqual(b.r.srv.requests('thread/goal/set').length, 0, 'FR-051: no goal after a stricter mode');
    const lastLive = (b.r.ad as unknown as { sessions: Map<string, { mode: string; broker: { getMode(): string } }> }).sessions.get(b.r.sid)!;
    assert.deepStrictEqual([lastLive.mode, lastLive.broker.getMode()], ['read-only', 'read-only'], 'the mode wanted now, not the one read before the awaits');
    assert.strictEqual(b.r.srv.requests('turn/start').length, 1, 'the message runs in that mode');

    const c = await reopening();
    await c.r.ad.setAutopilot(c.r.sid, null, 'stopped');
    await c.p;
    await settle(c.r.srv);
    assert.strictEqual(c.r.srv.requests('thread/goal/set').length, 0, 'setAutopilot(null) during the reopen');

    const d = await reopening();
    await d.r.ad.stop(d.r.sid);
    await assert.rejects(d.p, /ended/);
    assert.strictEqual(d.r.ad.isLive(d.r.sid), false, 'End session: it does not open again');
    assert.strictEqual(d.r.srv.requests('thread/goal/set').length, 0);
    assert.strictEqual((d.r.ad as unknown as { parked: Map<string, unknown> }).parked.size, 0, 'a throw during the reopen leaves no entry');
    assert.strictEqual((a.r.ad as unknown as { parked: Map<string, unknown> }).parked.size, 0, 'nor does a Stop');

    // a value that is no mode cannot spin the reopen: it opens as Read-only, and no goal goes
    const e = await reopening();
    e.r.ad.setPermMode(e.r.sid, 'junk' as never);
    const ended = await Promise.race([e.p.then(() => 'done'), sleep(1000).then(() => 'spinning')]);
    assert.strictEqual(ended, 'done', 'the loop ends');
    assert.strictEqual((e.r.ad as unknown as { sessions: Map<string, { mode: string }> }).sessions.get(e.r.sid)!.mode, 'read-only');
    assert.strictEqual(e.r.srv.requests('thread/goal/set').length, 0);

    // a mode that keeps moving: the reopen is bounded, nothing is sent
    const f = await rig({}, undefined, 'ask');
    f.ad.setPermMode(f.sid, 'allow');
    let flip = false;
    const a2 = f.ad as unknown as { spawnFn: (...x: unknown[]) => unknown };
    const spawn = a2.spawnFn;
    a2.spawnFn = (...x: unknown[]) => { flip = !flip; f.ad.setPermMode(f.sid, flip ? 'read-only' : 'ask'); return spawn(...x); };
    const moved = await Promise.race([f.ad.send(f.sid, { text: 'x' }).then(() => 'sent', (err: Error) => err.message), sleep(3000).then(() => 'spinning')]);
    assert.ok(/kept changing/.test(moved), `bounded, got: ${moved}`);
    assert.strictEqual(f.srv.requests('turn/start').length, 0);
    assert.ok(f.srv.spawns.length <= 10, 'at most the bound');
    assert.strictEqual((f.ad as unknown as { reopenStarts: Map<string, number> }).reopenStarts.size, 0, 'the count goes with the send');
  }

  // an MCP switch during a run does not relaunch it; it applies when the run ended
  {
    const r = await rig();
    await onRun(r);
    await r.ad.setMcpEnabled(r.sid, 'echo', false);
    r.srv.endTurn(r.tid);
    await settle(r.srv);
    await r.ad.send(r.sid, { text: 'typed' });
    await settle(r.srv);
    assert.strictEqual(r.srv.spawns.length, 1, 'a run does not relaunch');
    await r.ad.interrupt(r.sid);
    await settle(r.srv);
    r.srv.endTurn(r.tid);
    await settle(r.srv);
    await r.ad.send(r.sid, { text: 'plain' });
    await settle(r.srv);
    assert.strictEqual(r.srv.spawns.length, 2, 'the switch applies after the end');
  }

  // Stop with Autopilot on and no run: a typed turn still going after a done ending is really stopped
  {
    const r = await rig({ holdTurn: true });
    await onRun(r);
    await r.ad.send(r.sid, { text: 'typed' });
    await settle(r.srv);
    status(r, 'complete');
    await settle(r.srv);
    assert.deepStrictEqual(r.reasons(), ['done']);
    const before = r.wire().filter((m) => m === 'turn/interrupt').length;
    await r.ad.interrupt(r.sid);
    await settle(r.srv);
    assert.strictEqual(r.wire().filter((m) => m === 'turn/interrupt').length, before + 1, 'Stop stops the running turn');
    await r.ad.send(r.sid, { text: 'plain' });
    await settle(r.srv);
    assert.strictEqual(r.srv.requests('thread/goal/set').length, 1, 'and Autopilot is off');
  }

  // FR-053: the mode-switch relaunch, a fresh child that resumes the same thread, clears before the goal
  {
    const r = await rig({}, undefined, 'ask');
    r.ad.setPermMode(r.sid, 'allow');
    await r.ad.setAutopilot(r.sid, { limit: 5 });
    await r.ad.send(r.sid, { text: 'go' });
    await settle(r.srv);
    assert.strictEqual(r.srv.spawns.length, 2, 'FR-144: a fresh child');
    assert.deepStrictEqual(r.wire(), ['thread/resume', 'thread/goal/clear', 'thread/goal/set'], 'clear first');
    assert.strictEqual(r.srv.requests('thread/goal/set')[0].childIndex, 1);
    await r.ad.interrupt(r.sid); // the state followed onto the new child
    await settle(r.srv);
    assert.deepStrictEqual(r.reasons(), ['stopped']);
    assert.ok(r.srv.requests('thread/goal/clear').at(-1)!.childIndex === 1);
  }

  // FR-053 on a plain resume: none found says nothing, an older Codex has nothing to clear; off in real sessions until T030
  {
    const m = make({}, { wired: true });
    const first = await m.ad.start({ workspace: os.tmpdir(), permissionMode: 'allow', quiet: true });
    const tid = m.ad.resumeIdOf(first) as string;
    await m.ad.stop(first);
    const n = m.events.length;
    const sid = await m.ad.start({ workspace: os.tmpdir(), resumeSessionId: tid, permissionMode: 'allow', quiet: true });
    assert.ok(m.srv.requests('thread/goal/clear').length === 1);
    assert.ok(!m.events.slice(n).some((e) => e.type === 'status' && e.intent === LINE_CLOSED));
    await m.ad.stop(sid);
    const old = make({ goals: false }, { wired: true });
    const f2 = await old.ad.start({ workspace: os.tmpdir(), permissionMode: 'allow', quiet: true });
    const t2 = old.ad.resumeIdOf(f2) as string;
    await old.ad.stop(f2);
    const s2 = await old.ad.start({ workspace: os.tmpdir(), resumeSessionId: t2, permissionMode: 'allow', quiet: true });
    assert.ok(old.ad.isLive(s2), 'method not found: no goal can exist');
    await old.ad.stop(s2);
    const off = make({}, { wired: false });
    const f3 = await off.ad.start({ workspace: os.tmpdir(), permissionMode: 'allow', quiet: true });
    const t3 = off.ad.resumeIdOf(f3) as string;
    await off.ad.stop(f3);
    const s3 = await off.ad.start({ workspace: os.tmpdir(), resumeSessionId: t3, permissionMode: 'allow', quiet: true });
    assert.strictEqual(off.srv.requests('thread/goal/clear').length, 0, '`wired` false (the default build): nothing new on a resume');
    await off.ad.stop(s3);
  }

  // End session: no card
  {
    const r = await rig();
    await onRun(r);
    await r.ad.stop(r.sid);
    assert.deepStrictEqual(r.reasons(), [], 'FR-052');
  }

  // FR-006: a goal nobody asked for is cleared and said; Durbar does not follow. Until T030 a session not on Autopilot is left alone.
  {
    const n = await rig();
    n.srv.goals.add(n.tid);
    status(n, 'active');
    await settle(n.srv);
    assert.deepStrictEqual(n.wire(), [], 'nothing changes for a session not on Autopilot in this phase');
    assert.ok(!n.lines().includes(LINE_SELF_STARTED));
    const r = await rig({}, { wired: true });
    r.srv.goals.add(r.tid);
    status(r, 'active');
    await settle(r.srv);
    assert.ok(r.lines().includes(LINE_SELF_STARTED));
    assert.ok(r.wire().includes('thread/goal/clear'));
    assert.deepStrictEqual(r.ap(), []);
    // after a done ending, a turn nobody counts is stopped
    const d = await rig();
    await onRun(d);
    status(d, 'complete');
    await settle(d.srv);
    d.srv.endTurn(d.tid);
    await settle(d.srv);
    d.srv.goalTurn(d.tid);
    await settle(d.srv);
    assert.deepStrictEqual(d.reasons(), ['done', 'error']);
    assert.ok(d.wire().includes('turn/interrupt'));
    valid(d);
    // cleared from elsewhere ends the run
    const c = await rig();
    await onRun(c);
    c.srv.note(c.tid, 'thread/goal/cleared', {});
    await settle(c.srv);
    assert.deepStrictEqual(c.reasons(), ['stopped']);
  }

  finished = true;
  process.exitCode = 0;
  console.log('test-autopilot-codex: OK');
}
void main().catch((e) => { console.error(e); finished = true; process.exitCode = 1; });
