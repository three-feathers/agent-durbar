/**
 * Adapter interface between Agent Durbar and a coding-agent runtime
 * (Copilot CLI first; Claude / Codex CLIs later).
 * Every adapter translates its native protocol into the normalized events below.
 */

export type AgentStatus = 'idle' | 'working' | 'needs-permission' | 'error' | 'stopped';

export interface StartOptions {
  /** Folder or .code-workspace file; one session per workspace. */
  workspace: string;
  model?: string;
  /** For model 'auto': routing preference ('efficiency' is the cheapest). */
  autoTier?: 'efficiency' | 'balance' | 'intelligence';
  /** Soft cap on AI credits for this session, if the runtime supports it. */
  maxAiCredits?: number;
  /** Resume an existing session id (disk-backed). */
  resumeSessionId?: string;
  /**
   * Permission policy. Default (both unset): reads are approved, everything that can
   * change state (write, shell, mcp, url, custom tools, ...) is denied.
   * `allow: true` approves everything (explicit opt-in). `ask: true` leaves every
   * non-read request pending (status 'needs-permission') until `resolvePermission` is called.
   */
  allow?: boolean;
  ask?: boolean;
}

export interface Attachment {
  path: string;
  kind: 'file' | 'image';
}

export interface AgentMessage {
  text: string;
  attachments?: Attachment[];
}

interface BaseEvent {
  /** Durbar session id (stable per adapter instance). */
  sessionId: string;
  /** Set for sub-agent events; undefined means the top-level agent. */
  agentId?: string;
  timestamp: number;
}

export interface StatusEvent extends BaseEvent {
  type: 'status';
  status: AgentStatus;
  /** Short current intent, e.g. "Refactoring auth module". */
  intent?: string;
  /** Set when status is 'needs-permission'. */
  permission?: PermissionInfo;
}

export interface PermissionInfo {
  requestId: string;
  /** SDK permission kind: write | shell | read | mcp | url | custom-tool | ... */
  kind: string;
  summary: string;
  /** 'pending' = waiting for resolvePermission; otherwise already decided (by policy, the user or a session grant). */
  state: 'pending' | 'approved' | 'denied';
  /** What "Approve for this session" would remember (ask mode): a stable key and a short chip label. */
  scopeKey?: string;
  scopeLabel?: string;
  /** Who decided: the user, an earlier "Approve for this session" grant, or the session being stopped. */
  via?: 'user' | 'session' | 'stopped';
  /** True when the user approved this one *and* remembered the scope for the session. */
  remembered?: boolean;
}

/** A remembered "Approve for this session" permission; can be revoked. */
export interface SessionGrant {
  key: string;
  kind: string;
  label: string;
}

/** A permission request got its final answer (or was auto-approved by a session grant). No status change. */
export interface PermissionEvent extends BaseEvent {
  type: 'permission';
  permission: PermissionInfo;
}

/** The set of active session grants changed (full list). */
export interface GrantsEvent extends BaseEvent {
  type: 'grants';
  grants: SessionGrant[];
}

export interface ThinkingEvent extends BaseEvent {
  type: 'thinking';
  /** Incremental reasoning text (delta). */
  delta: string;
}

export interface OutputEvent extends BaseEvent {
  type: 'output';
  /** Incremental assistant text (delta). */
  delta: string;
  /** True on the closing event of one assistant message; `text` then holds the full message. */
  final?: boolean;
  text?: string;
}

export interface ToolCallEvent extends BaseEvent {
  type: 'toolCall';
  callId: string;
  tool: string;
  phase: 'start' | 'update' | 'complete' | 'failed';
  args?: unknown;
  output?: string;
}

export interface SubagentEvent extends BaseEvent {
  type: 'subagent';
  subagentId: string;
  name?: string;
  phase: 'started' | 'completed' | 'failed';
  task?: string;
}

/** Per model call usage. Credits are reported by the runtime as nano-AIU when available. */
export interface UsageEvent extends BaseEvent {
  type: 'usage';
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  /** Cost of this call in nano-AI units (1e-9 AIU) as reported by the Copilot API. */
  nanoAiu?: number;
  /** Model cost multiplier reported by the runtime (experimental). */
  costMultiplier?: number;
  creditsStatus?: 'complete' | 'partial' | 'unavailable';
}

/**
 * Echo of a user message. Emitted by the simulator and by adapters that can replay history;
 * the renderer also adds its own bubble when the user types, so live adapters need not emit it.
 */
export interface UserEvent extends BaseEvent {
  type: 'user';
  text: string;
  attachments?: Attachment[];
}

export type AgentEvent =
  | UserEvent
  | StatusEvent
  | PermissionEvent
  | GrantsEvent
  | ThinkingEvent
  | OutputEvent
  | ToolCallEvent
  | SubagentEvent
  | UsageEvent;

export type Unsubscribe = () => void;

export interface AgentAdapter {
  /** Adapter id, e.g. "copilot". */
  readonly id: string;
  /** Start (or resume) a session for a workspace. Resolves with the session id. */
  start(options: StartOptions): Promise<string>;
  /** Send a user message (with optional files/images) to a running session. */
  send(sessionId: string, message: AgentMessage): Promise<void>;
  /** Stop/cancel a session. */
  stop(sessionId: string): Promise<void>;
  /** Approve/deny a permission request left pending by `ask: true`; `remember` = approve for the rest of the session. Optional. */
  resolvePermission?(sessionId: string, requestId: string, approve: boolean, remember?: boolean): void;
  /** Forget one "Approve for this session" grant. Optional. */
  revokeGrant?(sessionId: string, key: string): void;
  /** Subscribe to normalized events from all sessions of this adapter. */
  onEvent(listener: (event: AgentEvent) => void): Unsubscribe;
}
