/**
 * What an adapter can do, as plain data (spec 012 FR-009, FR-026). Types only: no SDK, no I/O.
 * Each optional member of `AgentAdapter` is present exactly when its flag here says so (FR-027).
 */

import type { AgentAdapter } from './types';

export type PermissionMode = 'read-only' | 'ask' | 'allow';

export interface AdapterCapabilities {
  /** `interrupt()` stops the running turn and keeps the session. */
  interrupt: boolean;
  /** An earlier session can be resumed by the vendor's session id. */
  resume: boolean;
  images: boolean;
  /** `listModelOptions()` exists. */
  models: boolean;
  effort: boolean;
  /** The permission modes the adapter can enforce. */
  permissionModes: PermissionMode[];
  /** How a mode change reaches a running session (`setPermMode()` exists unless `none`). */
  permModeSwitch: 'live' | 'next-message' | 'none';
  /** Which usage figures the adapter reports. `costUsd` is the vendor's estimate, never a bill. */
  usage: { tokens: boolean; costUsd: boolean; nanoAiu: boolean };
  context: boolean;
  /** `setCap()` and `resolveLimit()` exist. */
  caps: boolean;
  helpers: boolean;
  /** `listPreviousSessions()` and `history()` exist. */
  history: boolean;
  mcpStatus: boolean;
  /** `setMcpEnabled()` exists. */
  mcpToggle: boolean;
}

/** Where an adapter stands on this machine (spec 012 FR-030). `unknown` also covers a detect that failed. */
export type AdapterState = 'ready' | 'not-installed' | 'too-old' | 'not-signed-in' | 'unknown';

export interface DetectResult {
  state: AdapterState;
  version?: string;
  hint?: string;
}

/** Static description of an adapter plus a factory; creating the adapter is lazy (FR-031). */
export interface AdapterDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly installHint?: string;
  readonly capabilities: AdapterCapabilities;
  create(): AgentAdapter;
}
