/**
 * Main-process simulator (spec 041 T015, FR-045, plan Q10): `DURBAR_SIM_MAIN=N` gives the MCP server agents that exist in
 * main (the renderer's `DURBAR_SIM` agents live only in the window). Dev only: the hook is read through `devEnv`, so a packaged
 * build ignores it unless `DURBAR_DEV=1`. It runs a SEPARATE registry with `FakeAdapter`; `PRODUCTION_DESCRIPTORS` is never
 * touched and nothing in a production code path registers the fake. No Electron import: the planner is pure and unit-tested.
 */
import { createRegistry } from '../../adapters/registry';
import type { AdapterRegistry } from '../../adapters/registry';
import { FakeAdapter } from '../../adapters/fake';
import type { EventBody } from '../../adapters/map';
import type { AgentAdapter, AgentEvent } from '../../adapters/types';
import { GROUND, GROUND_NAME } from '../../shared/floors';
import type { Floor } from '../../shared/floors';
import type { DevEnv } from '../devhooks';

export const SIM_MAIN_ENV = 'DURBAR_SIM_MAIN';
export const SIM_MAIN_MAX = 40;
export const SIM_ADAPTER_ID = 'fake';

/** The office word each scripted agent should end up in (renderer wording, `app.js` setState labels). */
export type SimKind = 'waiting' | 'limit' | 'error' | 'lazy' | 'working' | 'idle';

export interface SimAgent {
  /** Stable session id, also the id used on the fake adapter. */
  id: string;
  name: string;
  folder: string;
  floor: string;
  kind: SimKind;
  /** Not started: no session is opened, the way a saved folder waits for its first message. */
  lazy: boolean;
  /** Normal agent events applied after the session starts (empty for a lazy agent). */
  events: EventBody[];
}

export interface SimMainPlan {
  floors: Floor[];
  agents: SimAgent[];
}

const UPPER = 'f-simupper';
const ARCHIVE = 'f-simarchv';
const FLOOR_ORDER = [GROUND, UPPER, ARCHIVE];
/** The first agents are the scripted ones, in this order; the rest alternate working and idle. */
const SCRIPTED: SimKind[] = ['waiting', 'limit', 'working', 'error', 'lazy'];

/** `DURBAR_SIM_MAIN` as a count: a whole number 1..40, anything else (absent, 0, text, negative, decimal) is "off". */
export function parseSimMainCount(raw: string | undefined): number {
  if (raw === undefined || !/^[0-9]{1,3}$/.test(raw.trim())) return 0;
  const n = Number(raw.trim());
  return n >= 1 ? Math.min(n, SIM_MAIN_MAX) : 0;
}

function eventsFor(kind: SimKind, id: string, n: number): EventBody[] {
  switch (kind) {
    case 'waiting':
      return [{ type: 'status', status: 'needs-permission', intent: 'Waiting for permission: Run npm test', permission: { requestId: `${id}-perm`, kind: 'shell', summary: 'Run npm test', state: 'pending' } }];
    case 'limit':
      return [{ type: 'limit', phase: 'exhausted', requestId: `${id}-limit`, maxAiCredits: 5, usedAiCredits: 5 }];
    case 'error':
      return [{ type: 'status', status: 'error', intent: 'Simulated error' }];
    case 'working':
      return [{ type: 'status', status: 'working', intent: `Editing file ${n}` }];
    case 'idle':
      return [{ type: 'status', status: 'idle', intent: 'Ready' }];
    default:
      return [];
  }
}

/** Pure: N agents over three floors (ground on, "Upper floor" on, "Archive" off), scripted into every state. */
export function planSimMain(count: number): SimMainPlan {
  const floors: Floor[] = [
    { id: GROUND, name: GROUND_NAME, on: true },
    { id: UPPER, name: 'Upper floor', on: true },
    { id: ARCHIVE, name: 'Archive', on: false },
  ];
  const n = Number.isInteger(count) && count > 0 ? Math.min(count, SIM_MAIN_MAX) : 0;
  if (n === 0) return { floors: [], agents: [] };
  const agents: SimAgent[] = [];
  for (let i = 0; i < n; i++) {
    const kind: SimKind = i < SCRIPTED.length ? SCRIPTED[i] : i % 2 === 0 ? 'working' : 'idle';
    const id = `sim-main-${i + 1}`;
    agents.push({
      id,
      name: `Sim agent ${i + 1}`,
      folder: `sim/main-${i + 1}`,
      floor: FLOOR_ORDER[i % FLOOR_ORDER.length],
      kind,
      lazy: kind === 'lazy',
      events: eventsFor(kind, id, i + 1),
    });
  }
  return { floors, agents };
}

/** The plan for the environment given: nothing unless `devEnv` let the hook through (a packaged build gives `{}`). */
export function simMainPlanFor(env: DevEnv): SimMainPlan {
  return planSimMain(parseSimMainCount(env[SIM_MAIN_ENV]));
}

export interface SimMainHandle {
  plan: SimMainPlan;
  /** The dev-only registry (never `PRODUCTION_DESCRIPTORS`). */
  registry: AdapterRegistry;
  adapter: AgentAdapter;
  stop(): Promise<void>;
}

/**
 * Thin starter: when the hook is set, build the dev registry, open a fake session per non-lazy agent and apply its scripted
 * events through the adapter's normal event stream (`onEvent`, attached before seeding, sees them like a real adapter's). Returns undefined
 * when the hook is not set. Not called from the normal app start.
 */
export async function startSimMain(env: DevEnv, onEvent?: (event: AgentEvent) => void): Promise<SimMainHandle | undefined> {
  const plan = simMainPlanFor(env);
  if (plan.agents.length === 0) return undefined;
  const probe = new FakeAdapter({ id: SIM_ADAPTER_ID, displayName: 'Simulated agent' });
  const registry = createRegistry([{ id: SIM_ADAPTER_ID, displayName: probe.displayName, capabilities: probe.capabilities, create: () => probe }]);
  const adapter = registry.create(SIM_ADAPTER_ID);
  if (onEvent) adapter.onEvent(onEvent);
  // `emit` is private on purpose (test double): the simulator is the one place that pushes scripted events through it.
  const emit = (sid: string, body: EventBody): void => (adapter as unknown as { emit(s: string, b: EventBody): void }).emit(sid, body);
  for (const a of plan.agents) {
    if (a.lazy) continue;
    await adapter.start({ workspace: a.folder, sessionId: a.id, permissionMode: 'read-only' });
    for (const body of a.events) emit(a.id, body);
  }
  return { plan, registry, adapter, stop: () => adapter.dispose() };
}
