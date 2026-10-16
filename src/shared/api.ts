import type { AgentEvent } from '../adapters/types';
import type { HistoryItem, PreviousSession } from '../adapters/history';
import type { VsChatSummary, VsChatTranscript } from '../adapters/vscodeChat';
import type { UsageDoc } from './toolusage';
import type { McpServerInput, McpServerView, McpTransport, McpTrustInfo } from './mcp';

export type { McpServerInput, McpServerView, McpTransport, McpTrustInfo };

export type { HistoryItem, PreviousSession, VsChatSummary, VsChatTranscript };

/** Permission policy chosen when adding a folder. */
export type PermMode = 'read-only' | 'ask' | 'allow';

export interface AgentInfo {
  /** Session id. */
  id: string;
  name: string;
  cwd: string;
  /** Set when the agent was added from a .code-workspace file. */
  workspaceFile?: string;
  folders: string[];
  permMode: PermMode;
  model?: string;
  /** Reasoning effort chosen for this session, when the model supports it. */
  effort?: string;
  /** Restored from the saved folder list: no runtime session yet, it starts with the first message. */
  lazy?: boolean;
  /** Credit cap of this session in AIU (spec 011); unset = no cap. */
  maxAiCredits?: number;
  /** Restored from a saved Allow edits after a restart (spec 003 FR-026): shown as a small "restored" note until the mode is switched. */
  permRestored?: boolean;
  /** The folder is hidden from the office (it keeps its saved sessions). */
  hidden?: boolean;
  /** The room's door is closed (compact door plate in the office). */
  closed?: boolean;
}

/** Choices for a new session. */
export interface SessionOptions {
  /** AI-credit cap for the session (AIU). `null` = explicitly no cap; unset = the folder's saved cap, else the global default (spec 011). */
  maxAiCredits?: number | null;
  permMode?: PermMode;
  model?: string;
  effort?: string;
}

/** What the user chose for a session that reached its credit cap (spec 011). */
export type LimitChoice = { kind: 'add'; credits: number } | { kind: 'set'; credits: number } | { kind: 'unset' } | { kind: 'cancel' };

import type { AboutView } from './about';

export interface AppSettingsView {
  /** Owner, version and contributors for Settings > About (spec 008 FR-018). */
  about?: AboutView;
  /** Default cap (AIU) applied to new sessions; unset = none. */
  defaultMaxAiCredits?: number;
}

export interface ModelChoice {
  id: string;
  name: string;
  multiplier?: number;
  /** Context window in tokens; absent = unknown (the runtime reports 0 for `auto`). */
  contextWindow?: number;
  efforts: string[];
  defaultEffort?: string;
}

export interface PickedFile {
  path: string;
  name: string;
  kind: 'file' | 'image';
  /** Bytes on disk (used for the per-file cap). */
  size?: number;
}

/** Result of staging a pasted or dropped file. */
export type StageResult = { ok: true; file: PickedFile } | { ok: false; error: string };

export interface AddResult {
  ok: boolean;
  agents: AgentInfo[];
  error?: string;
}

export interface ResumeResult {
  ok: boolean;
  error?: string;
  agent?: AgentInfo;
  /** The untouched agent that was replaced by the resumed one (when `replace` was requested). */
  removedId?: string;
  title?: string;
  history?: { items: HistoryItem[]; total: number; truncated: boolean };
}

export interface VsChatListResult {
  ok: boolean;
  error?: string;
  sessions: VsChatSummary[];
  /** Matching VS Code workspace folders found on disk (0: VS Code never opened this folder, or is not installed). */
  storesFound: number;
  unreadable: number;
  tooLarge: number;
  formatNote: string;
}

/** A server of the Copilot CLI list (`~/.copilot/mcp-config.json`) or the built-in GitHub server: loaded by the runtime itself, read-only here, on/off for new sessions started by this app. */
export interface McpAmbientView {
  name: string;
  origin: 'copilot-config' | 'builtin';
  transport?: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  /** Not in the disabled list of Settings. */
  enabled: boolean;
}

/** What was found when reading the Copilot CLI file (a display label, never the real path). */
export interface McpCliFile {
  label: string;
  found: boolean;
  error?: string;
  /** Entries that could not be used. */
  skipped: number;
}

/** The global MCP list: the Copilot CLI list, read live. There is no app-level list of extras (spec 020). */
export interface McpState {
  cli: McpAmbientView[];
  file: McpCliFile;
  /** Secrets can be saved encrypted (Electron safeStorage). When false they only live in memory for this run. */
  secretsPersist: boolean;
}

/** The optional extras of ONE folder/workspace (spec 020). */
export interface McpFolderState {
  ok: boolean;
  error?: string;
  key: string;
  /** Display name of the folder. */
  name: string;
  servers: McpServerView[];
  /** Old app-level servers that are not applied; they can be moved into this folder or removed. */
  legacy: McpServerView[];
  secretsPersist: boolean;
  /** Extras that are on but are not passed to new sessions, with the reason. */
  skipped: { name: string; reason: string }[];
  /** Names of the Copilot CLI list (an extra may not reuse them). */
  cliNames: string[];
}

export interface McpResult {
  ok: boolean;
  error?: string;
  server?: McpServerView;
  /** Enabling needs the user's confirmation of this command/URL (call again with `trustAck`). */
  needsTrust?: McpTrustInfo;
}

/** All-time tool usage as the Tools view gets it (spec 020): the stored document plus the label each live agent is counted under. */
export interface UsageView {
  doc?: UsageDoc;
  labels: Record<string, string>;
  /** The last write to disk failed (counting continues in memory). */
  error?: string;
}

/** One MCP server as one agent sees it. */
export interface AgentMcpEntry {
  name: string;
  /** `cli` = Copilot CLI list or built-in, `folder` = an extra of this agent's folder, `runtime` = only reported by the runtime. */
  origin: 'cli' | 'folder' | 'runtime';
  /** Runtime state when the session is running (connected, failed, needs-auth, disabled, ...). */
  status?: string;
  error?: string;
  /** The default from Settings: on for new sessions. */
  defaultOn: boolean;
  /** This agent switched it off. */
  off: boolean;
}

/** Bridge exposed by the preload script as `window.agentDurbar`. */
export interface DurbarApi {
  version(): Promise<string>;
  addFolder(permMode: PermMode, opts?: SessionOptions): Promise<AddResult>;
  addWorkspaceFile(permMode: PermMode, opts?: SessionOptions): Promise<AddResult>;
  /** Another agent (own chat) in the same folder as agent `id`. */
  newSession?(id: string, opts: SessionOptions): Promise<{ ok: boolean; error?: string; agent?: AgentInfo }>;
  /** Models the account offers (no credits used). */
  listModels?(): Promise<{ ok: boolean; error?: string; models: ModelChoice[] }>;
  /** End the session (frees it; sending again resumes it). `stop` only interrupts the current turn. */
  end?(id: string): Promise<void>;
  /** Open an http(s) link in the system browser (anything else is refused in the main process). */
  openExternal?(url: string): Promise<{ ok: boolean }>;
  /** Change the permission mode of agent `id` now (applies to the next request). `clearGrants`: forget "Approve for this session"; `approvePending`: approve what is waiting. */
  setPermMode?(id: string, mode: PermMode, opts?: { clearGrants?: boolean; approvePending?: boolean }): Promise<{ ok: boolean; error?: string; mode?: PermMode; pending?: number }>;
  /** Close or open the door of the room (folder) of agent `id`; remembered. */
  setRoomClosed?(id: string, closed: boolean): Promise<{ ok: boolean }>;
  /** Hide or show the folder of agent `id`; the choice is remembered. */
  setFolderHidden?(id: string, hidden: boolean): Promise<{ ok: boolean }>;
  /** Remove the folder of agent `id`: ends its sessions and forgets the folder. */
  removeFolder?(id: string): Promise<{ ok: boolean; removedIds: string[] }>;

  /** Credit caps (spec 011). `credits: null` removes the cap. */
  getSettings?(): Promise<AppSettingsView>;
  setDefaultCap?(credits: number | null): Promise<{ ok: boolean; defaultMaxAiCredits?: number }>;
  setCap?(id: string, credits: number | null): Promise<{ ok: boolean; error?: string; maxAiCredits?: number }>;
  resolveLimit?(id: string, requestId: string, choice: LimitChoice): Promise<{ ok: boolean; error?: string }>;

  /** Tool usage over all runs (spec 020). */
  usageAllTime?(): Promise<UsageView>;
  usageReset?(): Promise<{ ok: boolean; doc?: UsageDoc }>;
  /** MCP (specs 019, 020): the Copilot CLI list is global and read live; extras are per folder/workspace key (`workspaceFile ?? cwd`). */
  mcpState?(): Promise<McpState>;
  mcpSetCli?(name: string, enabled: boolean): Promise<{ ok: boolean }>;
  mcpFolderState?(key: string): Promise<McpFolderState>;
  mcpUpsert?(key: string, input: McpServerInput, originalName?: string): Promise<McpResult>;
  mcpRemove?(key: string, name: string): Promise<{ ok: boolean }>;
  mcpSetEnabled?(key: string, name: string, enabled: boolean, trustAck?: boolean): Promise<McpResult>;
  mcpMoveLegacy?(name: string, key: string): Promise<McpResult>;
  mcpRemoveLegacy?(name: string): Promise<{ ok: boolean }>;
  agentMcp?(id: string): Promise<{ ok: boolean; servers: AgentMcpEntry[]; live: boolean }>;
  /** Per-agent override: `enabled=false` turns the server off for this agent (now when the session runs, else at its next start). */
  setAgentMcp?(id: string, name: string, enabled: boolean): Promise<{ ok: boolean; error?: string }>;

  /** Agents already running in main (survives renderer reloads) and startup paths. */
  listAgents(): Promise<AgentInfo[]>;
  pickAttachments(): Promise<PickedFile[]>;
  /** Pasted / dropped file bytes (renderer has no path): checked (10 MB, real image format), sanitized, written to a private temp folder. */
  stageAttachment(name: string, mime: string, data: ArrayBuffer): Promise<StageResult>;
  send(id: string, text: string, attachments: PickedFile[]): Promise<{ ok: boolean; error?: string }>;
  /** Interrupt the current turn only; the agent returns to Ready. */
  stop(id: string): Promise<void>;
  /** `remember` = "Approve for this session" (ignored when denying); `broad` = the wider "any arguments" scope of a shell request (only if offered). */
  resolvePermission(id: string, requestId: string, approve: boolean, remember?: boolean, broad?: boolean): Promise<void>;
  /** Forget one "Approve for this session" grant (key from the `grants` event). */
  revokeGrant(id: string, key: string): Promise<void>;
  openInVSCode(id: string): Promise<{ ok: boolean; error?: string }>;
  /** Earlier Copilot CLI/SDK sessions in this agent's folder (newest first). Optional: not in the simulator. */
  listPrevious?(id: string): Promise<{ ok: boolean; error?: string; sessions: PreviousSession[] }>;
  /** Resume one of them as a new agent in the same folder; `replace` retires this agent if it was never used. */
  resumeSession?(id: string, sessionId: string, replace: boolean): Promise<ResumeResult>;
  /** Read-only VS Code Copilot Chat history for this agent's folder. */
  listVsChats?(id: string): Promise<VsChatListResult>;
  readVsChat?(id: string, key: string): Promise<{ ok: boolean; error?: string; transcript?: VsChatTranscript }>;
  onEvent(cb: (e: AgentEvent) => void): () => void;
  onAgentAdded(cb: (a: AgentInfo) => void): () => void;
}
