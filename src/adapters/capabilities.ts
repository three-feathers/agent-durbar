/**
 * What an adapter can do, as plain data (spec 012 FR-009, FR-026). Types only: no SDK, no I/O.
 * Each optional member of `AgentAdapter` is present exactly when its flag here says so (FR-027).
 */

import type { AgentAdapter } from './types';

export type PermissionMode = 'read-only' | 'ask' | 'allow';

export interface AdapterCapabilities {
  /** `interrupt()` stops the running turn and keeps the session. */
  readonly interrupt: boolean;
  /** An earlier session can be resumed by the vendor's session id. */
  readonly resume: boolean;
  readonly images: boolean;
  /** `listModelOptions()` exists. */
  readonly models: boolean;
  readonly effort: boolean;
  /** The permission modes the adapter can enforce. */
  readonly permissionModes: readonly PermissionMode[];
  /** How a mode change reaches a running session (`setPermMode()` exists unless `none`). */
  readonly permModeSwitch: 'live' | 'next-message' | 'none';
  /** Which usage figures the adapter reports. `costUsd` is the vendor's estimate, never a bill. */
  readonly usage: Readonly<{ tokens: boolean; costUsd: boolean; nanoAiu: boolean }>;
  readonly context: boolean;
  /** `setCap()` and `resolveLimit()` exist. */
  readonly caps: boolean;
  /** The unit of the cap and its limit events: AI credits (the default) or the vendor's dollar estimate (spec 012 FR-150). */
  readonly capUnit?: 'aiu' | 'usd';
  readonly helpers: boolean;
  /** `listPreviousSessions()` and `history()` exist. */
  readonly history: boolean;
  readonly mcpStatus: boolean;
  /** `setMcpEnabled()` exists. */
  readonly mcpToggle: boolean;
  /** Spec 058 FR-010: when this agent app starts a session's MCP servers: with the session, or with the next message (Claude launches its CLI then). Missing = not said. */
  readonly mcpStart?: 'session' | 'next-message';
  /** Spec 058 FR-010: when `setMcpEnabled()` takes effect in a running session. Missing = not said. */
  readonly mcpToggleApplies?: 'live' | 'next-message';
  /** Spec 058 FR-012: `restartMcpServer()` exists: one server of a running session can be restarted on its own; missing = false. */
  readonly mcpRestart?: boolean;
  /** Spec 069 FR-031: `listMcpTools()` exists: the tools of one server of a running session can be listed; missing = false. */
  readonly mcpTools?: boolean;
  /** Spec 058 FR-064: `startMcpSignIn()` (and `cancelMcpSignIn()`) exist: the agent app's own sign-in for an MCP server can be started; missing = false. */
  readonly mcpSignIn?: boolean;
  /** Spec 058 FR-068: plain text for signing in from a terminal when the in-app sign-in cannot run; `{name}` stands for the server name. Missing = a generic line. */
  readonly mcpSignInSteps?: string;
  /** `handoffSummary()` exists (spec 030 FR-034); missing = false. */
  readonly handoff?: boolean;
  /** `generateText()` exists: one prompt, no tools, no session kept (spec 040 FR-015); missing = false. */
  readonly oneShot?: boolean;
  /** `setRemote()` exists: the session can be followed and steered from the vendor's web or mobile app (spec 054 FR-001); missing = false. */
  readonly remote?: boolean;
  /**
   * `renameSession()` exists (spec 059 FR-007); missing = none. `'any'`: the call renames the session now, open or stored.
   * `'next-turn'`: the call remembers the name and the adapter applies it the next time it starts that session's CLI.
   */
  readonly renameSession?: 'any' | 'next-turn';
  /** Spec 066: plan first: the app's own plan mode (nothing runs while planning), answered with `resolvePlan`; missing = false. */
  readonly planMode?: boolean;
  /** `deleteSession()` exists: one earlier session can be removed through the vendor's own API, never by deleting files (spec 006 FR-028); missing = false. */
  readonly deleteSession?: boolean;
  /** Spec 054 FR-060: the service a session is controlled from when `remote` is on: its name, the only host its links may use, and its phone app. */
  readonly remoteService?: Readonly<{ name: string; host: string; mobile: string }>;
  /** Spec 030 FR-040: how `setModel` behaves: `verified` = checked on a real account (else the UI says it is not), `contextTier` = a long-context tier can be chosen. Missing = not verified, tier offered (the Copilot default before this field). */
  readonly modelSwitch?: Readonly<{ verified: boolean; contextTier: boolean }>;
}

/** Where an adapter stands on this machine (spec 012 FR-030). `unknown` also covers a detect that failed. */
export type AdapterState = 'ready' | 'not-installed' | 'too-old' | 'not-signed-in' | 'unknown';

export interface DetectResult {
  state: AdapterState;
  version?: string;
  hint?: string;
  /** Spec 060 FR-003: where the app was found, safe to show: `~/…` under the home folder, otherwise only the file name. */
  where?: string;
}

/** Static description of an adapter plus a factory; creating the adapter is lazy (FR-031). */
export interface AdapterDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly installHint?: string;
  readonly capabilities: AdapterCapabilities;
  create(): AgentAdapter;
}
