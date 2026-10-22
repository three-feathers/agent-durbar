/**
 * Simulator mode never reaches a real agent app (spec 010 FR-022..FR-027; incident on PR #505, 2026-10-22).
 *
 * Under `DURBAR_SIM` only the window is simulated. Main still answers IPC, so a page script that called the real preload API
 * (`window.agentDurbar`) used to start real sessions and one-shot prompts. Two default-deny checks live in main:
 *  - `ipcguard.ts` refuses every channel except `SIM_OPEN_CHANNELS` before its handler runs (FR-023);
 *  - the adapter registry gets inert stand-ins, so no real adapter is ever constructed (FR-024).
 * Pure: no Electron import, so `scripts/test-simguard.ts` tests it.
 */
import type { AdapterDescriptor } from '../adapters/capabilities';
import type { AgentAdapter } from '../adapters/types';

/** FR-022: simulator mode, as the window sees it (`main.ts` puts `?sim=N` on the page only for a whole number above 0). */
export function simulatorOn(dev: Readonly<Record<string, string | undefined>>): boolean {
  return simulatorCount(dev) > 0;
}

/** The simulated agents' count `N` of `DURBAR_SIM=N` (a whole number above 0), else 0: off. */
export function simulatorCount(dev: Readonly<Record<string, string | undefined>>): number {
  const v = (dev.DURBAR_SIM ?? '').trim();
  return /^\d+$/.test(v) ? parseInt(v, 10) : 0;
}

/**
 * FR-023: the only channels main answers in simulator mode, each with its reason. Keep it short: an entry must not reach an
 * adapter, the router, `addWorkspace`, `generateText`, a spawn or an install run (`test:simguard` checks the handler).
 */
export const SIM_OPEN_CHANNELS: Readonly<Record<string, string>> = Object.freeze({
  'harness:plans': 'the simulator asks main for this OS\'s install routes (spec 060 FR-002); main answers from the simulated managers and runs nothing',
});

export function simChannelOpen(channel: string): boolean {
  return Object.prototype.hasOwnProperty.call(SIM_OPEN_CHANNELS, channel);
}

/** The refusal every blocked call gets (FR-023, FR-024). */
export function simRefusal(what: string): string {
  return `The simulator never starts or talks to a real agent app ("${what}" is refused under DURBAR_SIM). Run a real check without DURBAR_SIM.`;
}

const BLOCKED = Symbol('durbar.simBlocked');

/** True for the FR-024 stand-in (the driver context reports it). */
export function isSimBlocked(ad: unknown): boolean {
  return !!ad && typeof ad === 'object' && (ad as Record<symbol, unknown>)[BLOCKED] === true;
}

/**
 * FR-024: an inert adapter with the descriptor's identity. `isLive` is false, `onEvent` and `dispose` do nothing, `debug` and
 * `writeGuard` can be set (the router sets them); every other member that exists is a function that throws the refusal. Not a thenable.
 * FR-028: an optional member exists exactly when the real adapter's contract (C2) says so for these capabilities, so `typeof`, `in`
 * and the capabilities agree; optional members with no capability behind them are absent (callers check before calling).
 */
/**
 * The optional members of `AgentAdapter` (spec 012 FR-027) and, for the ones a capability decides, that capability (contract C2 in
 * scripts/test-adapter-contract.ts). `scripts/test-simguard.ts` checks this list against the interface, so a new optional member fails there.
 */
type Caps = AdapterDescriptor['capabilities'];
export const SIM_OPTIONAL_MEMBERS: Readonly<Record<string, ((c: Caps) => boolean) | null>> = Object.freeze({
  interrupt: (c: Caps) => !!c.interrupt,
  listModelOptions: (c: Caps) => !!c.models,
  listPreviousSessions: (c: Caps) => !!c.history,
  history: (c: Caps) => !!c.history,
  setCap: (c: Caps) => !!c.caps,
  resolveLimit: (c: Caps) => !!c.caps,
  setMcpEnabled: (c: Caps) => !!c.mcpToggle,
  restartMcpServer: (c: Caps) => !!c.mcpRestart,
  listMcpTools: (c: Caps) => !!c.mcpTools,
  handoffSummary: (c: Caps) => !!c.handoff,
  generateText: (c: Caps) => !!c.oneShot,
  setRemote: (c: Caps) => !!c.remote,
  renameSession: (c: Caps) => !!c.renameSession,
  deleteSession: (c: Caps) => !!c.deleteSession,
  startMcpSignIn: (c: Caps) => !!c.mcpSignIn,
  cancelMcpSignIn: (c: Caps) => !!c.mcpSignIn,
  setPermMode: (c: Caps) => c.permModeSwitch !== 'none',
  resolvePermission: null, revokeGrant: null, setModel: null, cancelQueuedModel: null, compact: null, resolvePlan: null,
  answerQuestion: null, answerElicitation: null, listAgentProfiles: null, selectAgentProfile: null, authStatus: null, verifySignIn: null,
  refreshAuth: null, resumeIdOf: null, debug: null, writeGuard: null,
});

export function blockedAdapter(d: AdapterDescriptor): AgentAdapter {
  const base: Record<string | symbol, unknown> = {
    id: d.id,
    displayName: d.displayName,
    capabilities: d.capabilities,
    isLive: () => false,
    onEvent: () => () => undefined,
    dispose: () => Promise.resolve(),
    [BLOCKED]: true,
  };
  const settable = new Set<string | symbol>(['debug', 'writeGuard']);
  const caps = (d.capabilities ?? {}) as Caps;
  /** An optional member the contract does not give these capabilities is absent, not a throwing function (FR-028). */
  const absent = (prop: string | symbol): boolean => {
    if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return true;
    if (!Object.prototype.hasOwnProperty.call(SIM_OPTIONAL_MEMBERS, prop)) return false;
    const gate = SIM_OPTIONAL_MEMBERS[prop];
    return !gate || !gate(caps);
  };
  return new Proxy(base, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (absent(prop)) return undefined;
      return () => {
        throw new Error(simRefusal(`${d.id}.${String(prop)}`));
      };
    },
    has(t, prop) {
      return prop in t || !absent(prop);
    },
    set(t, prop, value) {
      if (!settable.has(prop)) return false;
      t[prop] = value;
      return true;
    },
  }) as unknown as AgentAdapter;
}

/** FR-024: in simulator mode every descriptor creates the stand-in; the real `create` is never called. Off: the list as given. */
export function simGuardDescriptors(descs: readonly AdapterDescriptor[], on: boolean): AdapterDescriptor[] {
  if (!on) return [...descs];
  return descs.map((d) => ({ ...d, create: () => blockedAdapter(d) }));
}
