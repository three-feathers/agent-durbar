/** Spec 041 T015: main-process simulator planner and gate (FR-045, SC-001). No Electron, no real agents. */
import * as assert from 'assert';
import { PRODUCTION_DESCRIPTORS } from '../src/adapters/descriptors';
import type { AgentEvent } from '../src/adapters/types';
import { devEnv } from '../src/main/devhooks';
import { parseSimMainCount, planSimMain, simMainPlanFor, startSimMain } from '../src/main/mcp/simmain';
import { parseFloors } from '../src/shared/floors';

(async () => {
  const prodIds = PRODUCTION_DESCRIPTORS.map((d) => d.id);

  // count parsing
  for (const bad of [undefined, '', '0', '-3', 'abc', '1.5', '1e1', '9999']) assert.strictEqual(parseSimMainCount(bad), 0, String(bad));
  assert.strictEqual(parseSimMainCount('15'), 15);
  assert.strictEqual(parseSimMainCount('500'), 40, 'clamped');

  // absent / zero gives nothing
  for (const e of [{}, { DURBAR_SIM_MAIN: '0' }] as NodeJS.ProcessEnv[]) {
    const p = simMainPlanFor(devEnv(e, false));
    assert.deepStrictEqual(p, { floors: [], agents: [] });
    assert.strictEqual(await startSimMain(devEnv(e, false)), undefined);
  }

  // packaged-style devEnv gives nothing, even with the hook; DURBAR_DEV=1 lets it through
  const hook = { DURBAR_SIM_MAIN: '15' } as NodeJS.ProcessEnv;
  assert.deepStrictEqual(simMainPlanFor(devEnv(hook, true)), { floors: [], agents: [] });
  assert.strictEqual(await startSimMain(devEnv(hook, true)), undefined);
  assert.strictEqual(simMainPlanFor(devEnv({ ...hook, DURBAR_DEV: '1' } as NodeJS.ProcessEnv, true)).agents.length, 15);

  // N=15
  const plan = planSimMain(15);
  assert.strictEqual(plan.agents.length, 15);
  assert.strictEqual(new Set(plan.agents.map((a) => a.id)).size, 15, 'unique ids');
  const doc = parseFloors(plan.floors, 'ground');
  assert.deepStrictEqual(doc.floors, plan.floors, 'floors survive the spec 033 parser unchanged');
  const used = new Set(plan.agents.map((a) => a.floor));
  assert.ok(used.size >= 2, 'at least two floors');
  assert.ok(plan.floors.some((f) => !f.on && used.has(f.id)), 'an off floor holds agents');
  assert.ok(plan.floors.some((f) => f.on), 'an on floor exists');
  for (const a of plan.agents) assert.ok(plan.floors.some((f) => f.id === a.floor), 'known floor');
  const kinds = new Set(plan.agents.map((a) => a.kind));
  for (const k of ['waiting', 'limit', 'error', 'lazy', 'working', 'idle'] as const) assert.ok(kinds.has(k), k);
  assert.ok(plan.agents.filter((a) => a.lazy).every((a) => a.events.length === 0 && a.kind === 'lazy'));
  // the scripted agents sit on floors that are on (so they show up in a default view)
  for (const k of ['waiting', 'limit', 'error', 'lazy'] as const) {
    const a = plan.agents.find((x) => x.kind === k)!;
    assert.ok(plan.floors.find((f) => f.id === a.floor)!.on, `${k} on an on floor`);
  }
  assert.deepStrictEqual(planSimMain(15), plan, 'deterministic');
  assert.strictEqual(planSimMain(3).agents.length, 3);
  assert.strictEqual(planSimMain(1).agents[0].kind, 'waiting');

  // starter: the events go through the adapter's normal stream; the registry is separate from production
  const seen: AgentEvent[] = [];
  const h = (await startSimMain(devEnv(hook, false), (e) => seen.push(e)))!;
  assert.ok(h);
  assert.strictEqual(h.registry.list().length, 1);
  assert.ok(!prodIds.includes(h.registry.list()[0].id), 'dev registry id is not a production id');
  const byKind = (k: string) => h.plan.agents.find((a) => a.kind === k)!;
  const lastStatus = (id: string) => seen.filter((e) => e.sessionId === id && e.type === 'status').pop();
  assert.strictEqual((lastStatus(byKind('waiting').id) as { status: string }).status, 'needs-permission');
  assert.strictEqual((lastStatus(byKind('error').id) as { status: string }).status, 'error');
  assert.ok(seen.some((e) => e.type === 'limit' && e.phase === 'exhausted' && e.sessionId === byKind('limit').id));
  assert.ok(h.adapter.isLive(byKind('working').id), 'non-lazy agent has a session');
  assert.ok(!h.adapter.isLive(byKind('lazy').id) && !seen.some((e) => e.sessionId === byKind('lazy').id), 'lazy agent: no session, no events');
  await h.stop();
  assert.ok(seen.some((e) => e.type === 'status' && e.status === 'stopped'), 'stop is reported');

  // production registry unchanged
  assert.deepStrictEqual(prodIds, ['copilot']);
  console.log('mcp simmain ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
