import type { AgentEvent } from '../adapters/types';
import type { HistoryItem, PreviousSession } from '../adapters/history';
import type { VsChatSummary, VsChatTranscript } from '../adapters/vscodeChat';

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
  /** The folder is hidden from the office (it keeps its saved sessions). */
  hidden?: boolean;
}

/** Choices for a new session. */
export interface SessionOptions {
  permMode?: PermMode;
  model?: string;
  effort?: string;
}

export interface ModelChoice {
  id: string;
  name: string;
  multiplier?: number;
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
  /** Hide or show the folder of agent `id`; the choice is remembered. */
  setFolderHidden?(id: string, hidden: boolean): Promise<{ ok: boolean }>;
  /** Remove the folder of agent `id`: ends its sessions and forgets the folder. */
  removeFolder?(id: string): Promise<{ ok: boolean; removedIds: string[] }>;

  /** Agents already running in main (survives renderer reloads) and startup paths. */
  listAgents(): Promise<AgentInfo[]>;
  pickAttachments(): Promise<PickedFile[]>;
  /** Pasted / dropped file bytes (renderer has no path): checked (10 MB, real image format), sanitized, written to a private temp folder. */
  stageAttachment(name: string, mime: string, data: ArrayBuffer): Promise<StageResult>;
  send(id: string, text: string, attachments: PickedFile[]): Promise<{ ok: boolean; error?: string }>;
  /** Interrupt the current turn only; the agent returns to Ready. */
  stop(id: string): Promise<void>;
  /** `remember` = "Approve for this session" (ignored when denying). */
  resolvePermission(id: string, requestId: string, approve: boolean, remember?: boolean): Promise<void>;
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
