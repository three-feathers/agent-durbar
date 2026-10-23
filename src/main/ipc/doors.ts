/**
 * IPC for cabin doors the user closes (spec 017 FR-015..FR-018; spec 044 FR-110, FR-111; spec 054 FR-040). The window asks for the doors,
 * closes or opens one, and sends or discards what was held. Send all goes one by one: the first now (when the agent is free), each next
 * one when the agent is free again. Nothing here trusts the page beyond an agent id, a boolean and one of two words.
 */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo } from '../../shared/api';
import type { Doors, HeldRun } from '../doors';
import type { createRemoteOps } from '../remoteops';

export interface DoorsIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  doors(): Doors | undefined;
  /** The stable key of a session (its resume id), so a door survives a restart. */
  keyOf(a: AgentInfo): string;
  remoteOps: ReturnType<typeof createRemoteOps>;
  toRenderer(channel: string, payload: unknown): void;
  /** The agent is working or waits for a permission (a held run then waits for the next idle). */
  busy(id: string): boolean;
  /** Sends one held prompt through the same path as a scheduled run; true when it went out. */
  sendHeld(a: AgentInfo, run: HeldRun): Promise<boolean>;
}

export type DoorsList = Record<string, { closed: boolean; held: number }>;

export function register(deps: DoorsIpcDeps): { list(): DoorsList; changed(): void } {
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
  const agentOf = (id: unknown): AgentInfo | undefined => (typeof id === 'string' && id.length <= 200 ? agents.get(id) : undefined);
  /** Sends the next held run of a releasing door, if the agent is free; a failed send puts it back (never lost) and stops. */
  const sending = new Set<string>();
  const pump = async (a: AgentInfo): Promise<void> => {
    const d = deps.doors(), key = deps.keyOf(a);
    if (!d || !d.releasing(key) || sending.has(key) || deps.busy(a.id)) return;
    const run = d.next(key);
    if (!run) return changed();
    sending.add(key);
    try {
      const ok = await deps.sendHeld(a, run).catch(() => false);
      if (!ok) d.putBack(key, run);
    } finally {
      sending.delete(key);
      changed();
    }
  };
  // the next held run goes when the agent is free again (its turn ended)
  router.onEvent((e) => {
    if (e.type !== 'status' || e.agentId || (e.status !== 'idle')) return;
    const a = agents.get(e.sessionId);
    if (a) setTimeout(() => void pump(a), 0); // after main has noted the new status
  });
  ipcHandle('doors:list', (e) => (fromApp(e) ? list() : {}));
  ipcHandle('doors:set', async (e, id: unknown, closed: unknown) => {
    const a = agentOf(id), d = deps.doors();
    if (!fromApp(e) || !a || !d || typeof closed !== 'boolean') return { ok: false, error: 'invalid request' };
    const v = d.setClosed(deps.keyOf(a), closed);
    if (!v) return { ok: false, error: 'Could not change the door.' };
    // spec 054 FR-040: a closed door turns remote control off (nothing from github.com or claude.ai reaches the agent)
    if (closed && deps.remoteOps.has(a.id)) await deps.remoteOps.setRemote(a.id, false).catch(() => undefined);
    changed();
    return { ok: true, ...v };
  });
  ipcHandle('doors:release', async (e, id: unknown, action: unknown) => {
    const a = agentOf(id), d = deps.doors();
    if (!fromApp(e) || !a || !d || (action !== 'send' && action !== 'discard')) return { ok: false, error: 'invalid request' };
    const key = deps.keyOf(a);
    if (d.isClosed(key)) return { ok: false, error: 'Open the door first.' };
    if (action === 'discard') {
      const n = d.discard(key);
      changed();
      return { ok: true, discarded: n };
    }
    const n = d.view(key).held;
    if (!d.arm(key)) return { ok: true, sent: 0 };
    await pump(a);
    return { ok: true, queued: n };
  });
  return { list, changed };
}
