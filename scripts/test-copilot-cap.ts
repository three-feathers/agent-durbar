/**
 * Spec 011 FR-070..FR-074: the Copilot adapter enforces the session cap itself (the runtime did not, real 2026-10-20). Fake SDK only:
 * no runtime, no account, no credits.
 */
import * as assert from 'assert';
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
  (ad as unknown as { limitCancelMs: number }).limitCancelMs = 80;
  events.length = 0;
  await ad.send(sid3, { text: 'over' });
  for (let i = 0; i < 20 && !limits().length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(limits().length, 'the third session reached its cap');
  let hung = 0;
  (s3.rpc as Record<string, unknown>).ui = { handlePendingSessionLimitsExhausted: () => { hung++; return new Promise(() => undefined); } } as never; // hangs for ever
  s3.fire('session_limits_exhausted.requested', { requestId: 'rt-hang', maxAiCredits: 30, usedAiCredits: 35 }); // the runtime's own pending limit, which Stop must cancel
  const t0 = Date.now();
  await ad.stop(sid3);
  assert.ok(Date.now() - t0 < 3000, 'stop() finished although the runtime never answered the limit');
  assert.strictEqual(hung, 1, 'the hung pending-limit call was made (and given up on)');
  assert.ok(s3.calls.some((c) => c.name === 'abort'), '... and went on to abort the session');

  await ad.stop(sid).catch(() => undefined);
  fs.rmSync(ws, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log('copilot cap: held send, add/set/unset/cancel, still over, mid-turn stop, Stop drops, runtime path OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
