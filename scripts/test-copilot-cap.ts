/**
 * Spec 011 FR-070..FR-074: the Copilot adapter enforces the session cap itself (the runtime did not, real 2026-10-20). Fake SDK only:
 * no runtime, no account, no credits.
 */
import * as assert from 'assert';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import type { FakeSession } from './fakes/copilot-sdk';
import type { AgentEvent } from '../src/adapters/types';

const NANO = 1e9;
const usage = (credits: number) => ({ type: 'assistant.usage', data: { model: 'gpt-6-luna', inputTokens: 10, outputTokens: 1, copilotUsage: { totalNanoAiu: credits * NANO } } });
const idle = (aborted = false) => ({ type: 'session.idle', data: aborted ? { aborted: true } : {} });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function main(): Promise<void> {
  const watchdog = setTimeout(() => { console.error('copilot cap: stuck (a Stop that waits for the runtime for ever?)'); process.exit(1); }, 30000); // a hung await would let node exit 0 without the closing line
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-cap-test-'));
  const client = new FakeClient();
  const ad = new FakeCopilot(client);
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  const limits = () => events.filter((e) => e.type === 'limit') as Array<Extract<AgentEvent, { type: 'limit' }>>;
  const sends = (s: FakeSession) => s.calls.filter((c) => c.name === 'send').length;

  // a session with a 30-credit cap; each turn reports 14 credits
  client.turnScript = [usage(14), idle()];
  const sid = await ad.start({ workspace: ws, model: 'gpt-6-luna', maxAiCredits: 30, quiet: true });
  const s = client.last;
  await ad.send(sid, { text: 'one' });
  await ad.send(sid, { text: 'two' });
  assert.strictEqual(sends(s), 2, 'under the cap: sent');
  assert.strictEqual(limits().length, 0);

  // FR-072: the third turn crosses 30 (28 -> 42): it is stopped, then the limit is raised
  await ad.send(sid, { text: 'three' });
  for (let i = 0; i < 20 && !limits().length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(s.calls.some((c) => c.name === 'abort'), 'the turn that crossed the cap is stopped');
  const ex1 = limits()[0];
  assert.deepStrictEqual([ex1.phase, ex1.maxAiCredits, ex1.usedAiCredits], ['exhausted', 30, 42]);
  assert.match(String(ex1.requestId), /^durbar-cap-\d+$/);
  // nothing held after a mid-turn stop: Raise brings the agent back to idle, nothing is sent
  await ad.resolveLimit(sid, ex1.requestId!, { kind: 'add', credits: 30 });
  assert.deepStrictEqual(s.calls.filter((c) => c.name === 'options.update').pop()?.args, [{ sessionLimits: { maxAiCredits: 60 } }], 'add raises the runtime cap too');
  assert.strictEqual(limits()[1].phase, 'resolved');
  assert.strictEqual(sends(s), 3);

  // FR-071: at or over the cap a message is held, not sent
  client.turnScript = [];
  s.turnScript = [];
  s.fire('session.usage_checkpoint', { totalNanoAiu: 61 * NANO }); // the runtime's own total wins over the sum
  events.length = 0;
  await ad.send(sid, { text: 'four' });
  assert.strictEqual(sends(s), 3, 'held');
  const ex2 = limits()[0];
  assert.deepStrictEqual([ex2.phase, ex2.maxAiCredits, ex2.usedAiCredits], ['exhausted', 60, 61]);
  assert.ok(!events.some((e) => e.type === 'status' && e.status === 'working'), 'no "working" for a held message');

  // add too little: still over, asked again with the message still held
  await ad.resolveLimit(sid, ex2.requestId!, { kind: 'add', credits: 0.5 });
  const ex3 = limits().filter((e) => e.phase === 'exhausted')[1];
  assert.ok(ex3 && ex3.requestId !== ex2.requestId && ex3.maxAiCredits === 60.5, 'asked again');
  assert.strictEqual(sends(s), 3);
  // set above: the held message goes out
  await ad.resolveLimit(sid, ex3.requestId!, { kind: 'set', credits: 100 });
  assert.strictEqual(sends(s), 4, 'the held message is sent after the cap went up');
  assert.deepStrictEqual((s.calls.filter((c) => c.name === 'send').pop()?.args[0] as { prompt: string }).prompt, 'four');

  // cancel drops the held message
  s.fire('session.usage_checkpoint', { totalNanoAiu: 100 * NANO });
  events.length = 0;
  await ad.send(sid, { text: 'five' });
  const ex4 = limits()[0];
  await ad.resolveLimit(sid, ex4.requestId!, { kind: 'cancel' });
  assert.strictEqual(sends(s), 4, 'cancel: not sent');
  assert.deepStrictEqual(limits().pop(), { type: 'limit', phase: 'resolved', requestId: ex4.requestId, action: 'cancel', sessionId: sid, timestamp: limits().pop()!.timestamp });
  assert.ok(events.some((e) => e.type === 'status' && e.status === 'idle'), 'idle after Stop here');

  // unset: no cap, the held message goes out
  events.length = 0;
  await ad.send(sid, { text: 'six' });
  const ex5 = limits()[0];
  await ad.resolveLimit(sid, ex5.requestId!, { kind: 'unset' });
  assert.deepStrictEqual(s.calls.filter((c) => c.name === 'options.update').pop()?.args, [{ sessionLimits: null }]);
  assert.strictEqual(sends(s), 5, 'unset: sent');
  await ad.send(sid, { text: 'seven' });
  assert.strictEqual(sends(s), 6, 'no cap: always sent');

  // FR-073: Stop drops a held message; a later answer to it is a runtime request id (not ours) and goes to the SDK
  await ad.setCap(sid, 50);
  events.length = 0;
  await ad.send(sid, { text: 'eight' });
  const ex6 = limits()[0];
  assert.ok(ex6 && ex6.phase === 'exhausted');
  await ad.interrupt(sid);
  (s.rpc as Record<string, unknown>).ui = { handlePendingSessionLimitsExhausted: async (a: unknown) => { s.calls.push({ name: 'handlePending', args: [a] }); } } as never;
  await ad.resolveLimit(sid, ex6.requestId!, { kind: 'unset' });
  assert.strictEqual(sends(s), 6, 'a message dropped by Stop is never sent');

  // the runtime's own cap changes keep the cap in force up to date (FR-070)
  s.fire('session.session_limits_changed', { sessionLimits: null });
  await ad.send(sid, { text: 'nine' });
  assert.strictEqual(sends(s), 7, 'the runtime removed the cap: sent');
  await tick();

  // FR-074: a runtime-raised limit still goes to the SDK
  s.calls.length = 0;
  await ad.resolveLimit(sid, 'rt-1', { kind: 'add', credits: 10 });
  assert.deepStrictEqual(s.calls.map((c) => c.name), ['handlePending']);

  // a resumed session learns what was spent before from the runtime's first checkpoint: crossing it during a turn stops the turn too
  client.turnScript = [{ type: 'session.usage_checkpoint', data: { totalNanoAiu: 35 * NANO } }, idle()];
  const sid2 = await ad.start({ workspace: ws, model: 'gpt-6-luna', maxAiCredits: 34, quiet: true });
  const s2 = client.last;
  events.length = 0;
  await ad.send(sid2, { text: 'resumed' });
  for (let i = 0; i < 20 && !limits().length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(s2.calls.some((c) => c.name === 'abort'), 'checkpoint over the cap during a turn: stopped');
  assert.deepStrictEqual([limits()[0]?.phase, limits()[0]?.usedAiCredits], ['exhausted', 35]);
  await ad.stop(sid2).catch(() => undefined);

  // spec 052 FR-209: a runtime that never answers the pending-limit call does not keep Stop from finishing
  client.turnScript = [usage(40), idle()];
  const sid3 = await ad.start({ workspace: ws, model: 'gpt-6-luna', maxAiCredits: 30, quiet: true });
  const s3 = client.last;
  (ad as unknown as { stopStepMs: number }).stopStepMs = 80;
  events.length = 0;
  await ad.send(sid3, { text: 'over' });
  for (let i = 0; i < 20 && !limits().length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(limits().length, 'the third session reached its cap');
  let hung = 0;
  (s3 as unknown as { abort: () => Promise<void>; disconnect: () => Promise<void> }).abort = () => new Promise(() => undefined); // abort and disconnect hang too
  (s3 as unknown as { disconnect: () => Promise<void> }).disconnect = () => new Promise(() => undefined);
  (s3.rpc as Record<string, unknown>).ui = { handlePendingSessionLimitsExhausted: () => { hung++; return new Promise(() => undefined); } } as never; // hangs for ever
  s3.fire('session_limits_exhausted.requested', { requestId: 'rt-hang', maxAiCredits: 30, usedAiCredits: 35 }); // the runtime's own pending limit, which Stop must cancel
  const t0 = Date.now();
  await ad.interrupt(sid3); // Interrupt goes on too
  assert.ok(Date.now() - t0 < 3000, 'interrupt() finished with cancel and abort hanging');
  s3.fire('session_limits_exhausted.requested', { requestId: 'rt-hang2', maxAiCredits: 30, usedAiCredits: 35 });
  await ad.stop(sid3);
  assert.ok(Date.now() - t0 < 3000, 'stop() finished although the runtime never answered the limit');
  assert.strictEqual(hung, 2, 'the hung pending-limit call was made twice (interrupt, stop) and given up on');
  assert.ok(Date.now() - t0 < 6000, '... with cancel, abort and disconnect all hanging');
  assert.strictEqual((ad as unknown as { sessions: Map<string, unknown> }).sessions.has(sid3), false, '... and the session is gone from the adapter');

  // spec 052 FR-229 (real 2026-11-02): a message sent before a late abort lands is cleared by it, so it waits; the row says what is true
  const hungSession = async (): Promise<{ id: string; s: FakeSession; land: () => void }> => {
    client.turnScript = [];
    const id = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, sessionId: randomUUID() });
    const s = client.last as FakeSession;
    let land: () => void = () => undefined;
    (s as unknown as { abort: () => Promise<void> }).abort = () => new Promise<void>((r) => { land = r; });
    return { id, s, land: () => land() };
  };
  const intents = (id: string): unknown[] => events.filter((e) => e.type === 'status' && e.sessionId === id).map((e) => (e as { intent?: unknown }).intent);
  const lateWait = (ms: number): void => { (ad as unknown as { lateWaitMs: number }).lateWaitMs = ms; };
  const h1 = await hungSession();
  events.length = 0;
  await ad.interrupt(h1.id);
  assert.deepStrictEqual(intents(h1.id), ['Aborted', 'Stop sent: Copilot has not answered yet'], 'an interrupt given up on says Aborted (the window settles its cards) and then what is true');
  let sent1 = false;
  const next1 = ad.send(h1.id, { text: 'next' }).then(() => { sent1 = true; });
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(sends(h1.s), 0, 'nothing is sent while the abort has not landed');
  assert.ok(intents(h1.id).includes('Waiting for Copilot to stop the last turn'), 'the row says it waits');
  h1.land();
  await next1;
  assert.ok(sent1 && sends(h1.s) === 1, 'the message goes once the abort landed');
  // no answer at all: not sent, and the send fails with a sentence, so the message is not lost silently
  const h2 = await hungSession();
  await ad.interrupt(h2.id);
  lateWait(60);
  events.length = 0;
  await assert.rejects(ad.send(h2.id, { text: 'next' }), /has not answered Stop yet, so your message was not sent/, 'the send fails when the abort never lands');
  assert.strictEqual(sends(h2.s), 0, 'nothing was sent');
  assert.strictEqual((events.filter((e) => e.type === 'status' && e.sessionId === h2.id).pop() as { status?: string } | undefined)?.status, 'idle', 'the row does not stay on working');
  // a second Stop during the wait drops the message
  lateWait(150);
  const next2 = ad.send(h2.id, { text: 'dropped' });
  await new Promise((r) => setTimeout(r, 20));
  await ad.interrupt(h2.id);
  h2.land();
  await next2;
  assert.strictEqual(sends(h2.s), 0, 'Stop during the wait drops the message');
  // an abort that answered in time holds nothing back
  client.turnScript = [];
  const h3Id = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true });
  await ad.interrupt(h3Id);
  events.length = 0;
  await ad.send(h3Id, { text: 'plain' });
  assert.ok(!intents(h3Id).includes('Waiting for Copilot to stop the last turn') && !intents(h3Id).includes('Stop sent: Copilot has not answered yet'), 'a healthy Stop adds nothing to the next message');

  // spec 052 FR-230 (real 2026-11-02): a late `session.detach` kills a resumed session of that id, so nothing resumes it before the close lands
  lateWait(5000);
  const h4 = await hungSession();
  let landClose: () => void = () => undefined;
  (h4.s as unknown as { disconnect: () => Promise<void> }).disconnect = () => new Promise<void>((r) => { landClose = r; });
  const resumeCalls: string[] = [];
  const realResume = client.resumeSession.bind(client);
  client.resumeSession = (id: string, config: Record<string, unknown>) => { resumeCalls.push(id); return realResume(id, config); };
  const resumesOf = (id: string): number => resumeCalls.filter((x) => x === id).length;
  await ad.stop(h4.id);
  assert.strictEqual((ad as unknown as { sessions: Map<string, unknown> }).sessions.has(h4.id), false, 'stop finished');
  const before = resumesOf(h4.id);
  const resumed = ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, resumeSessionId: h4.id });
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(resumesOf(h4.id), before, 'no resume while abort and detach have not landed');
  h4.land();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(resumesOf(h4.id), before, '... also not with only the abort landed');
  landClose();
  await resumed;
  assert.strictEqual(resumesOf(h4.id), before + 1, 'the resume goes once the close landed');
  await ad.stop(h4.id);
  // a close that never lands: the start fails with a sentence, nothing is resumed; a rename waits the same way
  lateWait(60);
  const h5 = await hungSession();
  (h5.s as unknown as { disconnect: () => Promise<void> }).disconnect = () => new Promise(() => undefined);
  await ad.stop(h5.id);
  await assert.rejects(ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, resumeSessionId: h5.id }), /has not finished closing this session/, 'a close that never lands refuses the resume');
  await assert.rejects(ad.renameSession(h5.id, 'A name'), /has not finished closing this session/, 'and the rename');
  assert.strictEqual(resumesOf(h5.id), 0, 'nothing resumed it');

  await ad.stop(sid).catch(() => undefined);
  fs.rmSync(ws, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log('copilot cap: held send, add/set/unset/cancel, still over, mid-turn stop, Stop drops, runtime path, late abort and late close OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
