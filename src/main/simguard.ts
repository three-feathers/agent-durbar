/**
 * Simulator mode never reaches a real agent app (spec 010 FR-022..FR-027; incident on PR #505, 2026-10-22).
 *
 * Under `DURBAR_SIM` only the window is simulated. Main still answers IPC, so a page script that called the real preload API
 * (`window.agentDurbar`) used to start real sessions and one-shot prompts. Two default-deny checks live in main:
 *  - `ipcguard.ts` refuses every channel except `SIM_OPEN_CHANNELS` before its handler runs (FR-023);
 *  - the adapter registry gets inert stand-ins, so no real adapter is ever constructed (FR-024).
 * Pure: no Electron import, so `scripts/test-simguard.ts` tests it.
 */
import type { AdapterDescriptor, DetectResult } from '../adapters/capabilities';
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
  'app:version': 'renderer.ts asks for the app version on every page load (FR-032, review on #514); main only returns app.getVersion(): no adapter, no process, no profile file',
  'window:titleDoubleClick': 'a double-click on the Mac top bar zooms or minimizes the app\'s own window (spec 052 FR-085); main only reads a system setting and calls the window: no adapter, no process, no file',
  'browser:open': 'spec 080 T014: creates the session browser view in the simulator and loads the bundled test pages; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:state': 'spec 080 T014: reads the url, title and loading state of the session browser view; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:navigate': 'spec 080 T014: loads an address in the session browser view (http, https or the simulator test scheme); no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:back': 'spec 080 T014: moves the session browser view back in its own history; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:forward': 'spec 080 T014: moves the session browser view forward in its own history; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:reload': 'spec 080 T014: reloads the page of the session browser view; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:stop': 'spec 080 T014: stops the page load of the session browser view; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:bounds': 'spec 080 T014: sets where the session browser view sits in the window, after main checked the rectangle; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:visible': 'spec 080 T014: attaches or detaches the session browser view to the window; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:overlay': 'spec 080 T014: hides the session browser view while a Durbar overlay covers it; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:mute': 'spec 080 T014: mutes or unmutes the session browser view; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:openSystem': 'spec 080 T014: asks to open the view page in the system browser; the simulator answers not ok and opens nothing; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:consentAccept': 'spec 080 T014: remembers that the one-time note of the session browser was accepted in the settings file of this profile; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:snapshot': 'spec 080 T014: returns a still picture of the session browser page area, in memory, while an overlay hides the view; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:leaveAnswer': 'spec 080 T014: passes the answer of the Leave this page box to the view; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses typed in the window',
  'browser:openLink': 'spec 080 T017: classifies a link from the chat and opens a web one in the session browser view; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses, and the simulator opens nothing outside the window',
  'browser:openMail': 'spec 080 T017: checks a mail link after the click; under the simulator nothing is handed to the system; no adapter, no agent app, no agent session: the view loads only simulator pages or http(s) addresses, and the simulator opens nothing outside the window',
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
  mcpContext: (c: Caps) => !!c.mcpContext,
  handoffSummary: (c: Caps) => !!c.handoff,
  generateText: (c: Caps) => !!c.oneShot,
  setRemote: (c: Caps) => !!c.remote,
  renameSession: (c: Caps) => !!c.renameSession,
  deleteSession: (c: Caps) => !!c.deleteSession,
  startMcpSignIn: (c: Caps) => !!c.mcpSignIn,
  cancelMcpSignIn: (c: Caps) => !!c.mcpSignIn,
  refreshMcpStatus: (c: Caps) => !!c.mcpSignIn,
  setPermMode: (c: Caps) => c.permModeSwitch !== 'none',
  sandboxHost: (c: Caps) => !!c.osSandbox, // spec 087 FR-012
  continueWithoutSandbox: null, // spec 087 FR-007a: no capability of its own (Codex has osSandbox without it); absent from the stand-in
  resolvePermission: null, revokeGrant: null, revokeCall: null, setModel: null, cancelQueuedModel: null, compact: null, resolvePlan: null,
  answerQuestion: null, answerElicitation: null, listAgentProfiles: null, reloadAgentProfiles: null, selectAgentProfile: null, authStatus: null, verifySignIn: null, accountInfo: null,
  refreshAuth: null, resumeIdOf: null, debug: null, writeGuard: null,
  readOrgPolicy: null, // spec 076 FR-198: absent from the stand-in; the simulator's canned policy is the window's (?simorgpolicy=1)
  listSlashCommands: null, expandSlashCommand: null, // spec 073: no capability; absent from the stand-in, so no "/" list and no expansion under the simulator
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

/** FR-030: what detection reports for every adapter under the simulator (no agent app is asked). */
export const SIM_DETECT_HINT = 'Simulator (DURBAR_SIM): not checked; no agent app is started.';
type Detector = (d: AdapterDescriptor) => Promise<DetectResult>;
/**
 * FR-030 (review on #514): the detector `adaptersList` uses. On: a canned `ready` per adapter and the real detector (`--version`,
 * `auth status`, `login status`) is never called, so a driver's `addMany(..., { adapterId })` starts nothing. Off: the real one.
 */
export function simDetectorFor(on: boolean, real: (id: string) => Detector | undefined): Detector {
  if (on) return () => Promise.resolve({ state: 'ready', hint: SIM_DETECT_HINT });
  return (d) => real(d.id)?.(d) ?? Promise.resolve({ state: 'unknown' });
}

/** FR-030: the `child_process` functions that start a process; under the simulator each one refuses. */
export const CHILD_PROCESS_STARTERS = Object.freeze(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const);
/**
 * FR-030 backstop: replaces every starter on the given `child_process` module object with a function that counts the attempt and
 * throws the refusal, so a probe nobody listed cannot start a process under the simulator. Callers that import `child_process` by
 * name (TypeScript's CommonJS output reads the property at call time) see the sealed function. Returns the attempt counter.
 */
export function sealChildProcess(cp: Record<string, unknown>): { attempts(): number; tried(): readonly string[] } {
  const tried: string[] = [];
  for (const name of CHILD_PROCESS_STARTERS) {
    cp[name] = (file?: unknown) => {
      tried.push(`${name} ${typeof file === 'string' ? file.split(/[\\/]/).pop() : '?'}`);
      throw new Error(simRefusal(`child_process.${name}`));
    };
  }
  return { attempts: () => tried.length, tried: () => [...tried] };
}
