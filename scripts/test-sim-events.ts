/**
 * Simulator contract (spec 010 FR-010, T023): every event the simulator sends passes the same `eventProblems` check the adapter
 * tests use, so the simulator cannot drift from the normalized event shapes. `npm run test:simevents`. No window, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { eventProblems } from '../src/adapters/eventguard';
import type { AgentEvent } from '../src/adapters/types';
import type { DurbarApi } from '../src/shared/api';

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'sim.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const timers: NodeJS.Timeout[] = [];
const win: Record<string, unknown> = {
  setTimeout: (f: () => void, ms: number) => setTimeout(f, Math.min(ms, 3)),
  clearTimeout: (t: NodeJS.Timeout) => clearTimeout(t),
  setInterval: (f: () => void) => { const t = setInterval(f, 2); timers.push(t); return 1; },
  clearInterval: () => undefined,
};
new Function('window', js)(win);
type Create = (o: Record<string, unknown>) => DurbarApi;
const create = (win.__durbarSim as { create: Create }).create;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const seen = new Map<string, number>();
  const bad: string[] = [];
  const check = (e: AgentEvent): void => {
    seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
    const p = eventProblems(e);
    if (p.length && bad.length < 20) bad.push(`${e.type}: ${p.join(', ')} ${JSON.stringify(e).slice(0, 160)}`);
  };
  for (const opts of [{ n: 15, seed: 1, question: true, titles: true }, { n: 12, seed: 2, unreported: 'blog' }, { n: 15, seed: 3, solo: true }]) {
    const sim = create(opts);
    sim.onEvent(check);
    const agents = await sim.listAgents();
    await sleep(400); // the background ticks run
    const id = agents[0].id;
    await sim.send(id, 'hello there', []);
    await sim.setPermMode?.(id, 'ask', {});
    await sim.setPermMode?.(id, 'read-only', {});
    if (sim.selectProfile) {
      await sim.selectProfile(agents[1].id, 'docs-writer');
      await sim.selectProfile(agents[1].id, null);
    }
    await sleep(600);
  }
  timers.forEach((t) => clearInterval(t));
  assert.deepStrictEqual(bad, [], 'every simulator event passes the event check');
  for (const t of ['status', 'output', 'toolCall', 'usage', 'thinking', 'subagent', 'context']) assert.ok((seen.get(t) ?? 0) > 0, `the run produced ${t} events (so the check saw them)`);
  // the check itself rejects what it should
  assert.ok(eventProblems({ type: 'status', sessionId: 's', timestamp: 1, status: 'busy' }).length > 0);
  assert.ok(eventProblems({ type: 'nope', sessionId: 's', timestamp: 1 }).length > 0);
  assert.ok(eventProblems({ type: 'output', sessionId: 's', timestamp: 1 }).length > 0, 'output needs delta or text');
  assert.ok(eventProblems({ type: 'usage', sessionId: 's', timestamp: 1, costUsd: 0.1 }).length > 0, 'a dollar figure must say it is an estimate');
  assert.ok(eventProblems({ type: 'usage', sessionId: 's', timestamp: 1, inputTokens: -1 }).length > 0);
  assert.deepStrictEqual(eventProblems({ type: 'toolCall', sessionId: 's', timestamp: 1, callId: 'c', tool: 'bash', phase: 'start' }), []);
  console.log(`simulator event contract passed (${[...seen.values()].reduce((a, b) => a + b, 0)} events, ${seen.size} types)`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
