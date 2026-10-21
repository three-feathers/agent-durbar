/**
 * Spec 066 (plan first): the shared helpers, the event guard, Copilot's and Codex's plan-first flows on fake SDKs (no runtime, no
 * account, no credits), and the window-only answer IPC. Claude Code's flow is checked on a real account (spec `## Changes`).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cleanPlanText, reviseText, PLAN_REJECTED } from '../src/adapters/plan';
import { eventProblems } from '../src/adapters/eventguard';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import { FakeCodexServer } from './fakes/codex-app-server';
import { CodexAdapter } from '../src/adapters/codex';
import type { AgentEvent } from '../src/adapters/types';

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => T | undefined, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = f(); if (v !== undefined && v !== false) return v as T; if (Date.now() > end) throw new Error('timed out: ' + what); await tick(10); }
}

async function main(): Promise<void> {
  // helpers
  assert.strictEqual(cleanPlanText('  1. step\u0000\u0007\n2. next\t ok  '), '1. step\n2. next\t ok');
  assert.strictEqual(cleanPlanText(42), '');
  assert.strictEqual(cleanPlanText('x'.repeat(30000)).length, 20000);
  assert.strictEqual(reviseText({ kind: 'revise', feedback: 'keep names' }), 'Please revise the plan: keep names');
  assert.match(PLAN_REJECTED, /Do not make any changes/);
  // event guard
  const base = { sessionId: 's', timestamp: 1 };
  assert.deepStrictEqual(eventProblems({ ...base, type: 'plan', phase: 'proposed', requestId: 'r1', text: 'Plan' }), []);
  assert.deepStrictEqual(eventProblems({ ...base, type: 'plan', phase: 'resolved', requestId: 'r1', action: 'approve' }), []);
  assert.ok(eventProblems({ ...base, type: 'plan', phase: 'maybe', requestId: 'r1' }).length > 0);
  assert.ok(eventProblems({ ...base, type: 'plan', phase: 'resolved', requestId: '', action: 'approve' }).length > 0);
  assert.ok(eventProblems({ ...base, type: 'plan', phase: 'resolved', requestId: 'r', action: 'autopilot' }).length > 0);

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-plan-test-'));
  // ---- Copilot (FR-003): mode.set plan before the message; the runtime's exit-plan request waits for the user ----
  {
    const client = new FakeClient();
    const ad = new FakeCopilot(client);
    const events: AgentEvent[] = [];
    ad.onEvent((e) => events.push(e));
    assert.strictEqual(ad.capabilities.planMode, true);
    const sid = await ad.start({ workspace: ws, model: 'auto', quiet: true });
    const s = client.last;
    const handler = (s.config as { onExitPlanModeRequest?: (r: unknown) => Promise<Record<string, unknown>> }).onExitPlanModeRequest;
    assert.ok(typeof handler === 'function', 'the session asks Durbar about plans');
    await ad.send(sid, { text: 'Refactor login', plan: true });
    const modeCalls = () => s.calls.filter((c) => c.name === 'mode.set').map((c) => (c.args[0] as { mode: string }).mode);
    assert.deepStrictEqual(modeCalls(), ['plan'], 'plan mode before the message');
    const sends = s.calls.filter((c) => c.name === 'send');
    assert.ok(s.calls.indexOf(s.calls.find((c) => c.name === 'mode.set')!) < s.calls.indexOf(sends[0]!), 'mode first, then the message');
    // approve -> interactive, never autopilot
    const p1 = handler!({ summary: 'short', planContent: '1. Read\n2. Edit', actions: ['interactive', 'autopilot'], recommendedAction: 'autopilot' });
    const prop1 = await until('proposed', () => events.find((e) => e.type === 'plan' && e.phase === 'proposed') as { requestId: string; text: string } | undefined);
    assert.strictEqual(prop1.text, '1. Read\n2. Edit');
    await ad.resolvePlan!(sid, prop1.requestId, { kind: 'approve' });
    assert.deepStrictEqual(await p1, { approved: true, selectedAction: 'interactive' }, 'approve continues interactively; the folder mode still decides');
    assert.ok(events.some((e) => e.type === 'plan' && e.phase === 'resolved' && e.action === 'approve'));
    // revise -> feedback, stays in plan mode
    const p2 = handler!({ summary: 'Plan B' });
    const prop2 = await until('second', () => events.filter((e) => e.type === 'plan' && e.phase === 'proposed')[1] as { requestId: string; text: string } | undefined);
    assert.strictEqual(prop2.text, 'Plan B', 'the summary when there is no full plan');
    await ad.resolvePlan!(sid, prop2.requestId, { kind: 'revise', feedback: 'smaller steps' });
    assert.deepStrictEqual(await p2, { approved: false, feedback: 'smaller steps' });
    // reject -> not approved, and plan mode is left
    const p3 = handler!({ planContent: 'Plan C' });
    const prop3 = await until('third', () => events.filter((e) => e.type === 'plan' && e.phase === 'proposed')[2] as { requestId: string } | undefined);
    await ad.resolvePlan!(sid, prop3.requestId, { kind: 'reject' });
    assert.deepStrictEqual(await p3, { approved: false });
    await tick();
    assert.deepStrictEqual(modeCalls(), ['plan', 'interactive'], 'a rejected plan leaves plan mode');
    // Stop rejects an open plan
    const p4 = handler!({ planContent: 'Plan D' });
    await until('fourth', () => events.filter((e) => e.type === 'plan' && e.phase === 'proposed')[3]);
    await ad.interrupt(sid);
    assert.deepStrictEqual(await p4, { approved: false });
    // review on #441: a plan-first turn that ends without a plan leaves plan mode before the next normal message
    {
      const before = modeCalls().length;
      await ad.send(sid, { text: 'Plan this', plan: true });
      await ad.send(sid, { text: 'Now just do it' });
      assert.deepStrictEqual(modeCalls().slice(before), ['plan', 'interactive'], 'the next normal message leaves plan mode first');
      const last = s.calls.filter((c) => c.name === 'send').pop()!;
      assert.ok(s.calls.lastIndexOf(s.calls.filter((c) => c.name === 'mode.set').pop()!) < s.calls.lastIndexOf(last), 'mode first, then the message');
      await ad.send(sid, { text: 'Another one' });
      assert.deepStrictEqual(modeCalls().slice(before), ['plan', 'interactive'], 'no extra mode switch once interactive');
    }
    // an unknown request id does nothing
    await ad.resolvePlan!(sid, 'nope', { kind: 'approve' });
    await ad.stop(sid).catch(() => undefined);
  }

  // ---- Codex (FR-005): collaborationMode plan; the `plan` item becomes the proposal; approve runs a default-mode turn ----
  {
    const server = new FakeCodexServer({
      turnScript: [
        { method: 'turn/started', params: { threadId: 'thr_main', turn: { id: 'turn_1', status: 'inProgress' } } },
        { method: 'item/completed', params: { threadId: 'thr_main', item: { id: 'p1', type: 'plan', text: '1. Look\n2. Change' } } },
        { method: 'turn/completed', params: { threadId: 'thr_main', turn: { id: 'turn_1', status: 'completed' } } },
      ],
    });
    const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: '/usr/bin/codex', version: '0.163.0' }), platform: 'linux', env: {}, appVersion: '9.9.9', closeGraceMs: 20, killGraceMs: 20 });
    const events: AgentEvent[] = [];
    ad.onEvent((e) => events.push(e));
    assert.strictEqual(ad.capabilities.planMode, true);
    const sid = await ad.start({ workspace: ws, model: 'gpt-6-luna', permissionMode: 'read-only', quiet: true });
    await ad.send(sid, { text: 'Refactor login', plan: true });
    const t1 = server.requests('turn/start')[0].params as { collaborationMode?: { mode: string; settings: { model: string; developer_instructions: null } } };
    assert.deepStrictEqual(t1.collaborationMode, { mode: 'plan', settings: { model: 'gpt-6-luna', developer_instructions: null } });
    const prop = await until('codex proposed', () => events.find((e) => e.type === 'plan' && e.phase === 'proposed') as { requestId: string; text: string } | undefined);
    assert.strictEqual(prop.text, '1. Look\n2. Change');
    await ad.resolvePlan!(sid, prop.requestId, { kind: 'approve' });
    const t2 = await until('approve turn', () => server.requests('turn/start')[1]);
    const p2 = t2.params as { input: Array<{ text: string }>; collaborationMode?: { mode: string } };
    assert.strictEqual(p2.input[0].text, 'Go ahead with the plan above.');
    assert.strictEqual(p2.collaborationMode?.mode, 'default', 'back to the default mode explicitly after a plan turn');
    // a normal message after that sends no collaboration mode at all
    await tick(20);
    await ad.send(sid, { text: 'thanks' });
    const t3 = await until('third turn', () => server.requests('turn/start')[2]);
    assert.ok(!('collaborationMode' in (t3.params as object)), 'a normal turn sends nothing extra');
    await ad.stop(sid).catch(() => undefined);
    await ad.dispose();
  }

  // ---- main (FR-007): the answer IPC is window-only and plan-first needs the capability ----
  {
    const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8').replace(/\r\n/g, '\n'); // Windows checkouts have CRLF
    assert.match(main, /ipcHandle\('agents:resolvePlan', async \(e, id: unknown, requestId: unknown, answer: unknown\) => \{\n  if \(!fromApp\(e\)\) return/, 'only Durbar\'s own window answers a plan');
    assert.match(main, /if \(plan && \(!fromApp\(e\) \|\| !ad\.capabilities\.planMode\)\)/, 'plan first only from the window, only with planMode');
  }
  fs.rmSync(ws, { recursive: true, force: true });
  console.log('plan mode: helpers, guard, Copilot (approve/revise/reject/stop), Codex (plan turn, approve), window-only IPC OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
