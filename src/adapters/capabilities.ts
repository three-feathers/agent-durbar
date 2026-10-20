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
  /** `handoffSummary()` exists (spec 030 FR-034); missing = false. */
  readonly handoff?: boolean;
  /** `generateText()` exists: one prompt, no tools, no session kept (spec 040 FR-015); missing = false. */
  readonly oneShot?: boolean;
  /** `setRemote()` exists: the session can be followed and steered from the vendor's web or mobile app (spec 054 FR-001); missing = false. */
  readonly remote?: boolean;
  /** `deleteSession()` exists: one earlier session can be removed through the vendor's own API, never by deleting files (spec 006 FR-028); missing = false. */
  readonly deleteSession?: boolean;
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
