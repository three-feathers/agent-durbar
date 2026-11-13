/**
 * Spec 011 FR-070..FR-074: the Copilot adapter enforces the session cap itself (when the runtime does and does not: spec 052 FR-231). Fake SDK only:
 * no runtime, no account, no credits.
 */
import * as assert from 'assert';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FakeClient, FakeCopilot, RestartingFakeCopilot } from './fakes/copilot-sdk';
import type { FakeSession } from './fakes/copilot-sdk';
import type { AgentEvent } from '../src/adapters/types';
import { ownSleepers, parseMaxPrompts, spendRefusal } from './copilot-giveup-gate';

const NANO = 1e9;
const usage = (credits: number) => ({ type: 'assistant.usage', data: { model: 'gpt-6-luna', inputTokens: 10, outputTokens: 1, copilotUsage: { totalNanoAiu: credits * NANO } } });
const idle = (aborted = false) => ({ type: 'session.idle', data: aborted ? { aborted: true } : {} });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const until = async (ok: () => boolean, ms = 2000): Promise<void> => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 5)); };

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

  // spec 052 FR-232 (real 2026-11-02): the abort answers 1 ms before its idle, and that `Aborted` settles a card: the next card waits for it
  lateWait(5000);
  const h6 = await hungSession();
  await ad.stop(h6.id);
  client.turnScript = [];
  const h6Id = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30 });
  const h6s = client.last as FakeSession;
  let landAbort: () => void = () => undefined;
  (h6s as unknown as { abort: () => Promise<void> }).abort = () => new Promise<void>((r) => { landAbort = r; });
  h6s.fire('session.usage_checkpoint', { totalNanoAiu: 31 * NANO });
  (h6s as unknown as { processing: boolean }).processing = true;
  await ad.interrupt(h6Id);
  events.length = 0;
  const next6 = ad.send(h6Id, { text: 'held' });
  await tick();
  landAbort();
  await new Promise((r) => setTimeout(r, 180)); // past the grace, so only `processing` holds it
  assert.strictEqual(limits().length, 0, 'no card while the stopped turn has not ended');
  (h6s as unknown as { processing: boolean }).processing = false;
  h6s.fire('session.idle', { aborted: true });
  await next6;
  const kinds6 = events.filter((e) => e.sessionId === h6Id && (e.type === 'limit' || (e.type === 'status' && (e as { intent?: unknown }).intent === 'Aborted'))).map((e) => e.type);
  assert.deepStrictEqual(kinds6, ['status', 'limit'], 'the abort\'s Aborted first, then the card, which it cannot settle');
  assert.strictEqual(sends(h6s), 0, 'over the cap: held, not sent');
  // the idle can come just after isProcessing said no: the grace covers it
  const h7Id = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30 });
  const h7s = client.last as FakeSession;
  let landAbort7: () => void = () => undefined;
  (h7s as unknown as { abort: () => Promise<void> }).abort = () => new Promise<void>((r) => { landAbort7 = r; });
  h7s.fire('session.usage_checkpoint', { totalNanoAiu: 31 * NANO });
  await ad.interrupt(h7Id);
  events.length = 0;
  const next7 = ad.send(h7Id, { text: 'held' });
  await tick();
  landAbort7();
  await new Promise((r) => setTimeout(r, 20));
  h7s.fire('session.idle', { aborted: true });
  await next7;
  assert.deepStrictEqual(events.filter((e) => e.sessionId === h7Id && (e.type === 'limit' || (e.type === 'status' && (e as { intent?: unknown }).intent === 'Aborted'))).map((e) => e.type), ['status', 'limit'], 'the idle just after the answer is still first');

  // spec 052 FR-233 (real 2026-11-02): Stop on a limit request: the runtime's `query` error is that Stop, and only until the idle
  const queryError = { errorType: 'query', message: 'No response was returned. Send your message again to retry.' };
  const errors = (id: string): number => events.filter((e) => e.type === 'status' && e.sessionId === id && e.status === 'error').length;
  client.turnScript = [];
  const e1 = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30 });
  const e1s = client.last as FakeSession;
  (e1s.rpc as Record<string, unknown>).ui = { handlePendingSessionLimitsExhausted: async () => ({ success: true }) } as never;
  e1s.fire('session_limits_exhausted.requested', { requestId: 'rt-q', maxAiCredits: 30, usedAiCredits: 31 });
  events.length = 0;
  await ad.interrupt(e1);
  e1s.fire('session.error', queryError);
  assert.strictEqual(errors(e1), 0, 'Stop at a limit shows no error');
  e1s.fire('session.error', { errorType: 'other', message: 'something else' });
  assert.strictEqual(errors(e1), 1, 'another error does');
  e1s.fire('session.idle', { aborted: true });
  e1s.fire('session.error', queryError);
  assert.strictEqual(errors(e1), 2, 'after the idle the same error is real');
  // ... and a Stop with no limit request does not hide it
  const e2 = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true });
  const e2s = client.last as FakeSession;
  events.length = 0;
  await ad.interrupt(e2);
  e2s.fire('session.error', queryError);
  assert.strictEqual(errors(e2), 1, 'no limit cancelled: it shows');

  // spec 052 FR-234 (real 2026-11-02): the runtime refuses a cap under what was used, and takes an `add` under it with no error while ending the turn
  const r1 = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30 });
  const r1s = client.last as FakeSession;
  r1s.fire('session.usage_checkpoint', { totalNanoAiu: 36 * NANO });
  events.length = 0;
  await ad.send(r1, { text: 'kept' });
  const r1a = limits()[0];
  r1s.calls.length = 0;
  await ad.resolveLimit(r1, r1a.requestId!, { kind: 'add', credits: 1 });
  assert.strictEqual(r1s.calls.filter((c) => c.name === 'options.update').length, 0, 'a raise under what was used never reaches the runtime');
  const r1b = limits().filter((e) => e.phase === 'exhausted')[1];
  assert.ok(r1b && r1b.requestId !== r1a.requestId, 'it asks again');
  const askedBefore = limits().filter((e) => e.phase === 'exhausted').length;
  await ad.resolveLimit(r1, r1b.requestId!, { kind: 'set', credits: 36 });
  assert.strictEqual(limits().filter((e) => e.phase === 'exhausted').length, askedBefore + 1, 'at what was used is not above it: asked again');
  assert.strictEqual(r1s.calls.filter((c) => c.name === 'options.update').length, 0, 'and it does not reach the runtime');
  const r1c = limits().filter((e) => e.phase === 'exhausted').pop() as Extract<AgentEvent, { type: 'limit' }>;
  // a refused update puts the card and its message back
  const update = r1s.rpc.options.update;
  (r1s.rpc.options as { update: unknown }).update = async () => { throw new Error('This session has already used 40 AI credits. The session limit must be above 40'); };
  await assert.rejects(ad.resolveLimit(r1, r1c.requestId!, { kind: 'set', credits: 37 }), /already used 40/);
  (r1s.rpc.options as { update: unknown }).update = update;
  await ad.resolveLimit(r1, r1c.requestId!, { kind: 'set', credits: 50 });
  assert.deepStrictEqual((r1s.calls.filter((c) => c.name === 'send').pop()?.args[0] as { prompt: string }).prompt, 'kept', 'the message survived the refusal and goes now');
  // the runtime's own request: nothing is sent to it, the turn keeps waiting, the card stays
  const r2 = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30 });
  const r2s = client.last as FakeSession;
  (r2s.rpc as Record<string, unknown>).ui = { handlePendingSessionLimitsExhausted: async (x: unknown) => { r2s.calls.push({ name: 'handlePending', args: [x] }); } } as never;
  r2s.fire('session.usage_checkpoint', { totalNanoAiu: 36 * NANO });
  r2s.fire('session_limits_exhausted.requested', { requestId: 'rt-low', maxAiCredits: 30, usedAiCredits: 36 });
  r2s.calls.length = 0;
  await assert.rejects(ad.resolveLimit(r2, 'rt-low', { kind: 'add', credits: 1 }), /already used 36\.00 AI credits/);
  await assert.rejects(ad.resolveLimit(r2, 'rt-low', { kind: 'set', credits: 36 }), /already used 36\.00 AI credits/, 'at what was used is not above it');
  assert.strictEqual(r2s.calls.filter((c) => c.name === 'handlePending').length, 0, 'the runtime got nothing');
  await ad.resolveLimit(r2, 'rt-low', { kind: 'add', credits: 7 });
  assert.strictEqual(r2s.calls.filter((c) => c.name === 'handlePending').length, 1, 'a raise above it goes');
  await ad.resolveLimit(r2, 'rt-low2', { kind: 'unset' });
  assert.strictEqual(r2s.calls.filter((c) => c.name === 'handlePending').length, 2, 'removing the limit always goes');

  // spec 052 FR-235 (real 2026-11-02): a resume with a cap under what was used is refused; it opens with Durbar's cap standing in
  const o1 = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30 });
  await ad.stop(o1);
  client.resumeOverCap = 48.2;
  const resumedBefore = client.resumed.length;
  await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30, resumeSessionId: o1 });
  assert.strictEqual(client.resumed.length, resumedBefore + 1, 'opened');
  assert.strictEqual(client.resumed[client.resumed.length - 1].config.sessionLimits, undefined, 'with no runtime limit');
  const o1s = client.last as FakeSession;
  events.length = 0;
  await ad.send(o1, { text: 'after' });
  assert.strictEqual(sends(o1s), 0, 'nothing is sent unasked');
  const o1a = limits()[0];
  assert.deepStrictEqual([o1a.phase, o1a.maxAiCredits, o1a.usedAiCredits], ['exhausted', 30, 48.2], 'the card says what was used');
  await ad.resolveLimit(o1, o1a.requestId!, { kind: 'set', credits: 60 });
  assert.strictEqual(sends(o1s), 1, 'a raise sends it');
  assert.deepStrictEqual(o1s.calls.filter((c) => c.name === 'options.update').pop()?.args, [{ sessionLimits: { maxAiCredits: 60 } }], 'and the runtime has its limit again');
  // a known id goes the same way; any other refusal is still a failure
  await ad.stop(o1);
  await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30, sessionId: o1 });
  assert.strictEqual(client.resumed[client.resumed.length - 1].config.sessionLimits, undefined, 'by sessionId too');
  await ad.stop(o1);
  client.resumeOverCap = 0;
  const o1Resume = client.resumeSession.bind(client);
  (client as unknown as { resumeSession: unknown }).resumeSession = async () => { (client as unknown as { resumeSession: unknown }).resumeSession = o1Resume; throw new Error('another refusal'); };
  await assert.rejects(ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30, resumeSessionId: o1 }), /another refusal/, 'another refusal stays a failure: the limit is not dropped to get past it');
  (client as unknown as { resumeSession: unknown }).resumeSession = o1Resume;
  // the reconnect after a sign-in: refused too, and the session lives on with its cap held by Durbar
  const re = new RestartingFakeCopilot();
  const reEvents: AgentEvent[] = [];
  re.onEvent((e) => reEvents.push(e));
  const reId = await re.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30 });
  re.prepare = (c) => { c.resumeOverCap = 31.5; };
  await re.refreshAuth();
  const reClient = re.clients[re.clients.length - 1];
  assert.strictEqual(reClient.resumed.length, 1, 'the reconnect opened it');
  assert.strictEqual(reClient.resumed[0].config.sessionLimits, undefined, 'with no runtime limit');
  await re.send(reId, { text: 'reconnected' });
  assert.strictEqual(sends(reClient.last), 0, 'and it holds the message');
  const reLimit = reEvents.filter((e) => e.type === 'limit' && e.phase === 'exhausted').pop() as Extract<AgentEvent, { type: 'limit' }>;
  assert.deepStrictEqual([reLimit.maxAiCredits, reLimit.usedAiCredits], [30, 31.5]);
  await re.stop(reId);
  await re.dispose();
  client.resumeOverCap = 0;

  // review of #1038, FR-229: a send made while the cancel is still out does not go before the abort that follows it has landed
  lateWait(5000);
  (ad as unknown as { stopStepMs: number }).stopStepMs = 150;
  const c1 = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true });
  const c1s = client.last as FakeSession;
  let landCancel: () => void = () => undefined;
  let landStop: () => void = () => undefined;
  let aborts = 0;
  (c1s.rpc as Record<string, unknown>).ui = { handlePendingSessionLimitsExhausted: () => new Promise<void>((r) => { landCancel = r; }) } as never;
  (c1s as unknown as { abort: () => Promise<void> }).abort = () => { aborts++; return new Promise<void>((r) => { landStop = r; }); };
  c1s.fire('session_limits_exhausted.requested', { requestId: 'rt-both', maxAiCredits: 30, usedAiCredits: 31 });
  const stop1 = ad.interrupt(c1);
  await new Promise((r) => setTimeout(r, 10));
  const next1b = ad.send(c1, { text: 'after both' });
  await new Promise((r) => setTimeout(r, 10));
  landCancel();
  await until(() => aborts === 1);
  await new Promise((r) => setTimeout(r, 200)); // past the wait's own grace: it must be the abort that holds it
  assert.strictEqual(sends(c1s), 0, 'nothing goes while the abort is out');
  landStop();
  await stop1;
  await next1b;
  assert.strictEqual(sends(c1s), 1, 'it goes once the abort landed');
  (ad as unknown as { stopStepMs: number }).stopStepMs = 80;
  // ... also a send in the very same tick as the Stop, before the abort has gone out
  const c2 = await hungSession();
  const stop2 = ad.interrupt(c2.id);
  const next2b = ad.send(c2.id, { text: 'same tick' });
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(sends(c2.s), 0, 'not before the abort');
  await stop2;
  c2.land();
  await next2b;
  assert.strictEqual(sends(c2.s), 1);

  // second review of #1038, FR-229: the Stop holds a send from its first line, however long its cancel step takes to hand over to the abort
  // the gap is held by the test, not by a timer: under load a timer could end before the checks (issue #1089)
  const slowCancel = (): { undo: () => void; release: () => void; inGap: () => boolean } => {
    const at = ad as unknown as { cancelLimit: (l: unknown) => Promise<void> };
    const real = at.cancelLimit;
    let inGap = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => { release = r; });
    at.cancelLimit = async function (this: unknown, l: unknown): Promise<void> { await real.call(this, l); inGap = true; await held; };
    return { undo: () => { delete (at as { cancelLimit?: unknown }).cancelLimit; }, release: () => release(), inGap: () => inGap };
  };
  const g1 = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true });
  const g1s = client.last as FakeSession;
  let g1Land: () => void = () => undefined;
  let g1Aborts = 0;
  (g1s as unknown as { abort: () => Promise<void> }).abort = () => { g1Aborts++; return new Promise<void>((r) => { g1Land = r; }); };
  (ad as unknown as { stopStepMs: number }).stopStepMs = 400;
  let slow = slowCancel();
  const g1Stop = ad.interrupt(g1);
  await tick();
  const g1Next = ad.send(g1, { text: 'in the gap' });
  await until(() => slow.inGap());
  await new Promise((r) => setTimeout(r, 20)); // the send's chance to go wrongly; the gap stays open until release()
  assert.ok(slow.inGap() && g1Aborts === 0 && sends(g1s) === 0, 'in the gap between cancel and abort nothing goes');
  slow.release();
  await until(() => g1Aborts === 1);
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(sends(g1s), 0, 'nor before the abort has landed');
  g1Land();
  await g1Stop;
  await g1Next;
  assert.strictEqual(sends(g1s), 1, 'then it goes');
  slow.undo();
  // End session the same: a send in the gap is dropped with the session, never sent into it
  const g2 = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true });
  const g2s = client.last as FakeSession;
  slow = slowCancel();
  const g2Stop = ad.stop(g2);
  await tick();
  const g2Next = ad.send(g2, { text: 'into the end' });
  await until(() => slow.inGap());
  await new Promise((r) => setTimeout(r, 20)); // as for Stop: the send's chance to go wrongly while the gap is held open
  assert.ok(slow.inGap() && !g2s.calls.some((c) => c.name === 'abort') && sends(g2s) === 0, 'End: in the gap between cancel and abort nothing goes');
  slow.release();
  await g2Stop;
  await g2Next;
  assert.strictEqual(sends(g2s), 0, 'End holds it from its first line');
  slow.undo();
  (ad as unknown as { stopStepMs: number }).stopStepMs = 80;
  // a Stop or an End that throws leaves nothing behind: the next message goes at once
  for (const end of ['interrupt', 'stop'] as const) {
    const g3 = await ad.start({ workspace: ws, model: 'gpt-6-luna', quiet: true });
    const g3s = client.last as FakeSession;
    const abort = g3s.abort;
    (g3s as unknown as { abort: () => Promise<void> }).abort = () => { throw new Error('thrown at once'); };
    await assert.rejects(ad[end](g3), /thrown at once/);
    (g3s as unknown as { abort: () => Promise<void> }).abort = abort;
    const quickNext = await Promise.race([ad.send(g3, { text: 'next' }).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 150))]);
    assert.ok(quickNext && sends(g3s) === 1, `after a ${end} that threw the send does not wait`);
    await ad.stop(g3);
  }

  // review of #1038: `rpc.metadata` is experimental: without it the message still goes, and any failure leaves the row idle
  const m1 = await hungSession();
  await ad.interrupt(m1.id);
  (m1.s.rpc as Record<string, unknown>).metadata = undefined;
  const nextM = ad.send(m1.id, { text: 'no metadata' });
  await tick();
  m1.land();
  (ad as unknown as { turnEndWaitMs: number }).turnEndWaitMs = 60;
  await nextM;
  assert.strictEqual(sends(m1.s), 1, 'the message goes without the metadata call');
  const m2 = await hungSession();
  await ad.interrupt(m2.id);
  const adAny = ad as unknown as { turnEnded: unknown };
  const realTurnEnded = adAny.turnEnded;
  adAny.turnEnded = async () => { throw new Error('boom'); };
  events.length = 0;
  const nextM2 = ad.send(m2.id, { text: 'fails' });
  await tick();
  m2.land();
  await assert.rejects(nextM2, /boom/);
  assert.strictEqual((events.filter((e) => e.type === 'status' && e.sessionId === m2.id).pop() as { status?: string } | undefined)?.status, 'idle', 'never left on working');
  adAny.turnEnded = realTurnEnded;
  (ad as unknown as { turnEndWaitMs: number }).turnEndWaitMs = 2000;

  // review of #1038: a reconnect drops what belonged to the old runtime
  const rc = new RestartingFakeCopilot();
  const rcEvents: AgentEvent[] = [];
  rc.onEvent((e) => rcEvents.push(e));
  (rc as unknown as { stopStepMs: number }).stopStepMs = 30;
  const rcErr = await rc.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, maxAiCredits: 30 });
  let rcSess = (await rc.currentClient()).last as FakeSession;
  (rcSess.rpc as Record<string, unknown>).ui = { handlePendingSessionLimitsExhausted: async () => ({ success: true }) } as never;
  rcSess.fire('session_limits_exhausted.requested', { requestId: 'rt-rc', maxAiCredits: 30, usedAiCredits: 31 });
  await rc.interrupt(rcErr);
  await rc.refreshAuth();
  rcSess = (await rc.currentClient()).last as FakeSession;
  rcEvents.length = 0;
  rcSess.fire('session.error', { errorType: 'query', message: 'a real one' });
  assert.strictEqual(rcEvents.filter((e) => e.type === 'status' && e.status === 'error').length, 1, 'FR-233: the new runtime\'s error shows');
  // ... a Stop given up on, then the sign-in: the next message does not wait for the dead runtime
  (rcSess as unknown as { abort: () => Promise<void> }).abort = () => new Promise<void>(() => undefined);
  await rc.interrupt(rcErr);
  await rc.refreshAuth();
  rcSess = (await rc.currentClient()).last as FakeSession;
  const quick = await Promise.race([rc.send(rcErr, { text: 'after the sign-in' }).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 1000))]);
  assert.ok(quick && sends(rcSess) === 1, 'FR-230: the send goes at once');
  // ... and an End given up on: the start does not wait for it
  (rcSess as unknown as { disconnect: () => Promise<void> }).disconnect = () => new Promise<void>(() => undefined);
  await rc.stop(rcErr);
  await rc.refreshAuth();
  const quickStart = await Promise.race([rc.start({ workspace: ws, model: 'gpt-6-luna', quiet: true, resumeSessionId: rcErr }).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 1000))]);
  assert.ok(quickStart, 'FR-230: the start goes at once');
  await rc.stop(rcErr);
  await rc.dispose();

  // review of #1038: the probe's own gates
  for (const bad of ['x', '', '0', '-1', '1.5', 'NaN', '1e3', undefined]) assert.throws(() => parseMaxPrompts(bad), /positive integer/, `--max-prompts ${bad}`);
  assert.strictEqual(parseMaxPrompts('7'), 7);
  const gate = { prompts: 1, maxPrompts: 2, aiu: 1, maxAiu: 6 };
  assert.strictEqual(spendRefusal(gate), null);
  assert.match(String(spendRefusal({ ...gate, prompts: 2 })), /prompts used/);
  assert.match(String(spendRefusal({ ...gate, aiu: 6 })), /credits used/);
  assert.match(String(spendRefusal({ ...gate, maxPrompts: NaN })), /refused/, 'NaN refuses');
  assert.match(String(spendRefusal({ ...gate, aiu: NaN })), /refused/, 'NaN refuses');
  const ps = ['100 1 copilot-runtime', '101 100 /bin/sh -c sleep 62', '102 101 sleep 62', '103 100 sleep 62', '200 1 sleep 62', '201 200 sleep 62', '300 102 sleep 620', '301 1 x sleep 62'].join('\n');
  assert.deepStrictEqual(ownSleepers(ps, 100, 62), [102, 103], 'only the runtime\'s own, at any depth, exact argv');
  const probe = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'copilot-giveup-real.ts'), 'utf8');
  assert.strictEqual((probe.match(/prompts\+\+/g) ?? []).length, 1, 'every real send of the probe goes through the one gate');

  // spec 058 FR-242: records of a replay checkpoint (`checkpoint: true`, SDK 1.0.32) repeat history: no chat line, no usage, no cap total
  {
    const cc = new FakeClient();
    const ca = new FakeCopilot(cc);
    const evs: AgentEvent[] = [];
    ca.onEvent((e) => evs.push(e));
    const cid = await ca.start({ workspace: ws, model: 'gpt-6-luna', maxAiCredits: 30, quiet: true });
    const cs = cc.last;
    const replay = (type: string, data: Record<string, unknown>): void => cs.handler?.({ type, data, checkpoint: true });
    replay('assistant.message', { messageId: 'old', content: 'said before' });
    replay('assistant.usage', usage(29).data);
    replay('session.usage_checkpoint', { totalNanoAiu: 40 * NANO });
    await tick();
    assert.ok(!evs.some((e) => e.type === 'output' || e.type === 'usage'), 'FR-242 live replay skipped: no second chat line or usage call');
    cs.turnScript = [];
    await ca.send(cid, { text: 'go' });
    assert.strictEqual(sends(cs), 1, 'FR-242 live replay skipped: a replayed total over the cap holds nothing');
    assert.ok(!evs.some((e) => e.type === 'limit'), 'FR-242: no limit from replayed usage');
    // a replayed limit request still shows (fail safe: the agent waits for an answer)
    replay('session_limits_exhausted.requested', { requestId: 'rq', maxAiCredits: 30, usedAiCredits: 31 });
    await tick();
    assert.ok(evs.some((e) => e.type === 'limit' && (e as { requestId?: string }).requestId === 'rq'), 'FR-242: a replayed limit request is still shown');
    // spec 058 FR-242 (trackCap): a replayed OLDER usage_checkpoint and a replayed usage leave the live used total unchanged
    {
      const live = (ca as unknown as { sessions: Map<string, { usedCheckpointNano?: number; usedSinceNano?: number }> }).sessions.get(cid)!;
      const usedNow = (): number => ((live.usedCheckpointNano ?? 0) + (live.usedSinceNano ?? 0)) / NANO;
      cs.handler?.({ type: 'session.usage_checkpoint', data: { totalNanoAiu: 20 * NANO } }); // the session's own total
      cs.handler?.({ type: 'assistant.usage', data: usage(2).data }); // and its own call since
      await tick();
      assert.strictEqual(usedNow(), 22, 'FR-242 trackCap: own records counted (20 + 2)');
      replay('session.usage_checkpoint', { totalNanoAiu: 5 * NANO });
      replay('assistant.usage', usage(9).data);
      await tick();
      assert.strictEqual(usedNow(), 22, 'FR-242 trackCap: a replayed older usage_checkpoint and a replayed usage leave the used total unchanged');
    }
    // the session's own records still count
    cs.handler?.({ type: 'assistant.message', data: { messageId: 'new', content: 'said now' } });
    await tick();
    assert.ok(evs.some((e) => e.type === 'output'), 'FR-242: an own record is shown');
    await ca.stop(cid).catch(() => undefined);
    await ca.dispose();
  }

  await ad.stop(sid).catch(() => undefined);
  fs.rmSync(ws, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log('copilot cap: held send, add/set/unset/cancel, still over, mid-turn stop, Stop drops, runtime path, late abort and late close, a raise under the used amount, a resume over the cap OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
