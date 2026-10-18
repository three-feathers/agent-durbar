/**
 * The bodies of the IPC handlers that decide what happens when an agent's adapter lacks a member, plus the restore filter
 * (spec 012 FR-054). Moved verbatim from `main.ts` and `mcpipc.ts` so they can be tested: no Electron, no file system.
 */
import type { AdapterRouter } from '../adapters/router';
import { interruptOf, refusesLive, setCapOf, setMcpEnabledOf, setPermModeOf } from '../adapters/router';
import { parseCap } from '../shared/credits';
import type { AgentInfo, PermMode } from '../shared/api';
import { adapterOf } from './folders';
import type { FolderStore, SavedFolder } from './folders';

export interface OpsDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  store?: Pick<FolderStore, 'setPermMode' | 'setMaxAiCredits'>;
  wsKey(a: AgentInfo): string;
}

const NO_INTERRUPT = 'This agent cannot stop a running turn. End the session instead.';
const NO_LIVE_SETTING = 'This agent cannot change that setting while its session is running. Start a new session with it.';
export const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
export const validMode = (m: unknown): PermMode => (m === 'ask' || m === 'allow' ? m : 'read-only');
const trunc = (v: unknown, n: number): string => String(v ?? '').slice(0, n);

/** `agents:setMode`. */
export function setModeOp(d: OpsDeps, id: unknown, mode: unknown, opts: unknown): { ok: boolean; error?: string; mode?: PermMode; pending?: number } {
  const { agents, router } = d;
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent' };
  const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
  const m = validMode(mode);
  const r = setPermModeOf(ad, a.id, m, { clearGrants: o.clearGrants === true, approvePending: o.approvePending === true });
  // A live session that cannot switch keeps its old mode: say so and save nothing (constitution III, spec 012 FR-050). Not live: it applies at the next start.
  if (refusesLive(ad, a.id, r.applied)) return { ok: false, error: NO_LIVE_SETTING };
  a.permMode = m;
  a.permRestored = undefined; // a fresh choice, no longer "restored"
  d.store?.setPermMode(d.wsKey(a), m);
  return { ok: true, mode: m, pending: r.pending };
}

/** `agents:setCap`. */
export async function setCapOp(d: OpsDeps, id: unknown, credits: unknown): Promise<{ ok: boolean; error?: string; maxAiCredits?: number }> {
  const { agents, router } = d;
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  const ad = a ? router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'unknown agent' };
  const cap = credits === null ? undefined : parseCap(credits);
  if (credits !== null && cap === undefined) return { ok: false, error: 'The cap must be a number of at least 30 AI credits (the runtime minimum).' };
  try {
    // Not started yet: nothing to change now, the cap goes in the start options. A live session whose adapter cannot take it is refused, not saved (spec 012 FR-050).
    if (ad.isLive(a.id) && refusesLive(ad, a.id, await setCapOf(ad, a.id, cap ?? null))) return { ok: false, error: NO_LIVE_SETTING };
    a.maxAiCredits = cap;
    d.store?.setMaxAiCredits(d.wsKey(a), cap);
    return { ok: true, maxAiCredits: cap };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/** `agents:stop`: interrupts the running turn only. */
export async function stopTurnOp(d: OpsDeps, id: string): Promise<{ ok: false; error: string } | undefined> {
  const ad = d.agents.has(id) ? d.router.forAgent(id) : undefined;
  if (ad && refusesLive(ad, id, await interruptOf(ad, id))) return { ok: false, error: NO_INTERRUPT };
}

/** `agents:setMcp`; `off` holds, per agent id, the servers switched off for this run. */
export async function setMcpOp(d: OpsDeps, off: Map<string, Set<string>>, id: unknown, name: unknown, enabled: unknown): Promise<{ ok: boolean; error?: string }> {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  if (!a || typeof name !== 'string' || !name || name.length > 64) return { ok: false, error: 'unknown agent or server' };
  const ad = d.router.forAgent(a.id);
  // A live session whose adapter cannot switch servers keeps them as they are: refuse and save nothing (spec 012 FR-050).
  if (ad && refusesLive(ad, a.id, !!ad.setMcpEnabled)) return { ok: false, error: 'This agent cannot switch MCP servers while its session is running.' };
  const set = off.get(a.id) ?? new Set<string>();
  if (enabled === true) set.delete(name);
  else set.add(name);
  off.set(a.id, set);
  if (!ad || !ad.isLive(a.id)) return { ok: true };
  try {
    await setMcpEnabledOf(ad, a.id, name, enabled === true);
    return { ok: true };
  } catch (err) {
    // e.g. a server that was not part of this session at start: it comes in with the next start
    return { ok: true, error: `Saved for this agent. The running session could not apply it now (${trunc(err instanceof Error ? err.message : err, 120)}); it applies at the next start.` };
  }
}

/** The saved folders whose adapter this build knows. The others stay in the file, are not shown, and are never started as another adapter. One warning per unknown id, no path in it. */
export function restorable(folders: SavedFolder[], has: (id: string) => boolean, warn: (m: string) => void): Array<{ folder: SavedFolder; adapterId: string }> {
  const out: Array<{ folder: SavedFolder; adapterId: string }> = [];
  const warned = new Set<string>();
  for (const f of folders) {
    const adapterId = adapterOf(f);
    if (!has(adapterId)) {
      // Saved by a build that knows more adapters: stays in the file, is not shown, and is never started as another adapter. No path in the log.
      if (!warned.has(adapterId)) warn(`Skipping saved folders of unknown adapter ${JSON.stringify(adapterId.slice(0, 40))}`);
      warned.add(adapterId);
      continue;
    }
    out.push({ folder: f, adapterId });
  }
  return out;
}
