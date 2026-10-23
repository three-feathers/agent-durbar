/**
 * IPC for cabin doors the user closes (spec 017 FR-015..FR-018; spec 044 FR-110, FR-111; spec 054 FR-040). The rules are in
 * doorops.ts (unit-tested); this file checks the frame and the input (an agent id, a boolean, one of two words) and wires main's parts.
 */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo } from '../../shared/api';
import type { Doors, HeldRun } from '../doors';
import { createDoorOps } from '../doorops';
import type { ReleaseResult } from '../doorops';
import type { createRemoteOps } from '../remoteops';

export interface DoorsIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  doors(): Doors | undefined;
  /** The stable key of a session (its resume id), so a door survives a restart. */
  keyOf(a: AgentInfo): string;
  remoteOps: ReturnType<typeof createRemoteOps>;
  toRenderer(channel: string, payload: unknown): void;
  /** The scheduler's release path (Scheduler.releaseHeld): Pause all, the schedule, its limit and busy checked; credited; recorded. */
  release(run: HeldRun): Promise<ReleaseResult>;
}

export type DoorsList = Record<string, { closed: boolean; held: number }>;

export function register(deps: DoorsIpcDeps): { list(): DoorsList; changed(): void; full(a: AgentInfo): void } {
  const { agents, router } = deps;
  const list = (): DoorsList => {
    const d = deps.doors(), out: DoorsList = {};
    if (!d) return out;
    for (const a of agents.values()) {
      const v = d.view(deps.keyOf(a));
      if (v.closed || v.held) out[a.id] = v;
    }
    return out;
  };
  const changed = (): void => deps.toRenderer('doors:changed', list());
  const ops = createDoorOps({
    doors: deps.doors,
    keyOf: (id) => {
      const a = agents.get(id);
      return a ? deps.keyOf(a) : undefined;
    },
    remote: { has: (id) => deps.remoteOps.has(id), setRemote: (id, on) => deps.remoteOps.setRemote(id, on) },
    remoteOff: (id, reason) => deps.toRenderer('agents:remoteOff', { id, reason }),
    release: deps.release,
    changed,
    stopped: (id, why) => deps.toRenderer('doors:stopped', { id, why }),
  });
  // the next held run goes when the agent is free again (its turn ended)
  router.onEvent((e) => {
    if (e.type !== 'status' || e.agentId || e.status !== 'idle') return;
    if (agents.has(e.sessionId)) setTimeout(() => void ops.pump(e.sessionId), 0); // after main has noted the new status
  });
  const okId = (id: unknown): id is string => typeof id === 'string' && id.length <= 200 && agents.has(id);
  ipcHandle('doors:list', (e) => (fromApp(e) ? list() : {}));
  ipcHandle('doors:held', (e, id: unknown) => (fromApp(e) && okId(id) ? ops.held(id) : []));
  ipcHandle('doors:set', (e, id: unknown, closed: unknown) => (fromApp(e) && okId(id) && typeof closed === 'boolean' ? ops.setDoor(id, closed) : { ok: false, error: 'invalid request' }));
  ipcHandle('doors:release', (e, id: unknown, action: unknown) => (fromApp(e) && okId(id) && (action === 'send' || action === 'discard') ? ops.release(id, action) : { ok: false, error: 'invalid request' }));
  /* FR-016 (review on #631): a run that could not be kept at a full door is never dropped silently */
  const full = (a: AgentInfo): void => deps.toRenderer('doors:full', { id: a.id });
  return { list, changed, full };
}
