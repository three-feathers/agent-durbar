/**
 * Adapter interface between Agent Durbar and a coding-agent runtime
 * (Copilot CLI first; Claude / Codex CLIs later).
 * Every adapter translates its native protocol into the normalized events below.
 */

import type { McpServerSpec } from '../shared/mcp';
import type { CompactResult, ContextTier, ModelSwitchRequest, ModelSwitchResult } from '../shared/modelswitch';
export type { McpServerSpec, CompactResult, ContextTier, ModelSwitchRequest, ModelSwitchResult };

export type AgentStatus = 'idle' | 'working' | 'needs-permission' | 'error' | 'stopped';

export interface StartOptions {
  /** Folder or .code-workspace file; one session per workspace. */
  workspace: string;
  model?: string;
  /** For model 'auto': routing preference ('efficiency' is the cheapest). */
  autoTier?: 'efficiency' | 'balance' | 'intelligence';
  /** Cap on AI credits for this session (treated as AIU), if the runtime supports it. Soft until verified (spec 011 FR-015). */
  maxAiCredits?: number;
  /** Resume an existing session id (disk-backed). */
  resumeSessionId?: string;
  /** Use this id: resume it when it exists on disk, otherwise create a new session with exactly this id. */
  sessionId?: string;
  /** Reasoning effort for models that support it (see listModels). */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Context-window tier of the saved choice (spec 030); omitted = the model's default tier. Passed on create and on resume. */
  contextTier?: ContextTier;
  /**
   * Permission policy. Default (both unset): reads are approved, everything that can
   * change state (write, shell, mcp, url, custom tools, ...) is denied.
   * `allow: true` approves everything (explicit opt-in). `ask: true` leaves every
   * non-read request pending (status 'needs-permission') until `resolvePermission` is called.
   */
  allow?: boolean;
  ask?: boolean;
  /** Do not emit the "Ready" status when the session is up (used when starting it for a message that is about to be sent). */
  quiet?: boolean;
  /** MCP servers (global Settings, spec 019) handed to this session, by name. Never logged: env/headers may hold secrets. */
  mcpServers?: Record<string, McpServerSpec>;
  /** Exact MCP server names that must not start in this session (also switches off servers the runtime loads by itself). */
  disabledMcpServers?: string[];
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
  /**
   * Set for events of a sub-agent; undefined means the top-level agent. It is the id of the parent's `task` tool call that
   * spawned the sub-agent (the same id as `SubagentEvent.subagentId`), whichever id the runtime used for the event.
   */
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
  /** Shell only: the wider "any arguments of <command>" scope the user may pick instead (never the default). */
  broadScopeKey?: string;
  broadScopeLabel?: string;
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
  /** Reasoning block this belongs to; a new id starts a new block. A complete block that never streamed arrives as one delta. */
  reasoningId?: string;
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
  /** Set when the tool belongs to an MCP server: the server's configured name and the tool's own name there. */
  mcpServer?: string;
  mcpTool?: string;
}

export interface SubagentEvent extends BaseEvent {
  type: 'subagent';
  subagentId: string;
  name?: string;
  phase: 'started' | 'completed' | 'failed';
  task?: string;
  /** Internal agent type, e.g. "explore". */
  agentName?: string;
  model?: string;
  /** On failure: the error text. */
  error?: string;
  durationMs?: number;
  totalTokens?: number;
  totalToolCalls?: number;
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

/** Context window of the main agent, from the runtime's usage info (sent before each model call). Tokens, not characters. */
export interface ContextEvent extends BaseEvent {
  type: 'context';
  /** Tokens in the context window now. */
  tokens: number;
  /** Size of the window (0 = unknown). */
  limit: number;
  system?: number;
  conversation?: number;
  toolDefinitions?: number;
  messages?: number;
  /** Model and tier the window belongs to, when the adapter knows them (spec 030). */
  model?: string;
  tier?: ContextTier;
}

/**
 * The model, effort or context tier of the session changed (spec 030). `cause`: `user` = Agent Durbar asked for it,
 * `runtime` = the runtime changed it on its own, `rate-limit` / `fallback` = the runtime switched because of a rate limit or a
 * refused request, `resume` = restored when a session was resumed. A change the runtime makes is shown, never hidden.
 */
export interface ModelEvent extends BaseEvent {
  type: 'model';
  model: string;
  previousModel?: string;
  effort?: string;
  previousEffort?: string;
  tier?: ContextTier;
  cause: 'user' | 'runtime' | 'rate-limit' | 'fallback' | 'resume';
}

/** Compaction of the context (spec 030): `auto` = the runtime did it at its threshold, `manual` = the user asked, `model-switch` = before a switch to a smaller window, `overflow` = after the window was exceeded. */
export interface CompactionEvent extends BaseEvent {
  type: 'compaction';
  phase: 'start' | 'complete' | 'failed';
  trigger: 'auto' | 'manual' | 'model-switch' | 'overflow';
  tokensBefore?: number;
  tokensAfter?: number;
  tokensRemoved?: number;
  /** Window the compaction targeted, when known. */
  limit?: number;
  error?: string;
}

export interface McpServerStatus {
  name: string;
  /** connected | failed | needs-auth | pending | disabled | stopped | not_configured */
  status: string;
  /** Where the runtime got the server from: user | workspace | plugin | builtin | managed | account. */
  source?: string;
  transport?: string;
  error?: string;
}

/** The MCP servers of a session and their state (full list; a new event replaces the previous one). */
export interface McpStatusEvent extends BaseEvent {
  type: 'mcp';
  servers: McpServerStatus[];
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

/**
 * AI-credit cap of the session (spec 011). `exhausted`: the runtime reached the cap and waits for the user's decision
 * (`requestId` answers it); `changed`: the cap now in force (`null` = none); `resolved`: the decision was taken (any client).
 * Never tied to a sub-agent: the cap belongs to the session.
 */
export interface LimitEvent extends BaseEvent {
  type: 'limit';
  phase: 'exhausted' | 'changed' | 'resolved';
  requestId?: string;
  /** Cap in force (AI credits, treated as AIU), or null when there is none. */
  maxAiCredits?: number | null;
  /** Credits used in the current accounting window (exhausted only). */
  usedAiCredits?: number;
  /** The chosen action (resolved only): add | set | unset | cancel. */
  action?: string;
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
  | UsageEvent
  | ContextEvent
  | ModelEvent
  | CompactionEvent
  | McpStatusEvent
  | LimitEvent;

export type LimitAction = { kind: 'add'; credits: number } | { kind: 'set'; credits: number } | { kind: 'unset' } | { kind: 'cancel' };

export type Unsubscribe = () => void;

export interface AgentAdapter {
  /** Adapter id, e.g. "copilot". */
  readonly id: string;
  /** Start (or resume) a session for a workspace. Resolves with the session id. */
  start(options: StartOptions): Promise<string>;
  /** Send a user message (with optional files/images) to a running session. */
  send(sessionId: string, message: AgentMessage): Promise<void>;
  /** Interrupt the running turn; the session stays open and accepts new messages. */
  interrupt?(sessionId: string): Promise<void>;
  /** End a session and free its resources (it can be resumed later by id). */
  stop(sessionId: string): Promise<void>;
  /** Approve/deny a permission request left pending by `ask: true`; `remember` = approve for the rest of the session. Optional. */
  resolvePermission?(sessionId: string, requestId: string, approve: boolean, remember?: boolean, broad?: boolean): void;
  /** Forget one "Approve for this session" grant. Optional. */
  revokeGrant?(sessionId: string, key: string): void;
  /** Change (or with `null` remove) the credit cap of a running session. Optional: adapters that cannot enforce a cap omit it (spec 011). */
  setCap?(sessionId: string, credits: number | null): Promise<void>;
  /** Answer a "limit reached" request: add credits, set a new cap, remove the cap or cancel the blocked request. Optional. */
  resolveLimit?(sessionId: string, requestId: string, action: LimitAction): Promise<void>;
  /** Switch one MCP server on or off in a running session (spec 019). Optional. */
  setMcpEnabled?(sessionId: string, name: string, enabled: boolean): Promise<void>;
  /** Change the model, effort or context tier of a live session; applies from the next message (spec 030). Optional: adapters that cannot omit it and the UI offers a new session instead. */
  setModel?(sessionId: string, request: ModelSwitchRequest): Promise<ModelSwitchResult>;
  /** Remove a switch the runtime queued while a turn was running (`queueId` from a `queued` result). Optional. */
  cancelQueuedModel?(sessionId: string, queueId: string): Promise<void>;
  /** Compact the context now (spends a model call); `focus` steers the summary. Optional. */
  compact?(sessionId: string, focus?: string): Promise<CompactResult>;
  /** Subscribe to normalized events from all sessions of this adapter. */
  onEvent(listener: (event: AgentEvent) => void): Unsubscribe;
}
