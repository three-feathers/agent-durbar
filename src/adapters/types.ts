/**
 * Adapter interface between Agent Durbar and a coding-agent runtime
 * (Copilot CLI first; Claude / Codex CLIs later).
 * Every adapter translates its native protocol into the normalized events below.
 */

import type { FolderSetupStart } from '../shared/foldersetup';
import type { ElicitAction, ElicitAnswer, ElicitRequest } from '../shared/elicit';
import type { McpServerSpec } from '../shared/mcp';
import type { CompactResult, ContextTier, ModelOption, ModelSwitchRequest, ModelSwitchResult } from '../shared/modelswitch';
import type { AdapterCapabilities, PermissionMode } from './capabilities';
import type { HandoffResult } from './handoff';
import type { HistoryResult, PreviousSession } from './history';
import type { RemoteState } from '../shared/remote';
export type { ElicitAction, ElicitAnswer, ElicitRequest, McpServerSpec, CompactResult, ContextTier, ModelOption, ModelSwitchRequest, ModelSwitchResult, AdapterCapabilities, PermissionMode };

export type AgentStatus = 'idle' | 'working' | 'needs-permission' | 'error' | 'stopped';

/** Spec 040 FR-015: options of `generateText`. */
export interface GenerateTextOptions {
  disabledMcpServers?: string[];
}

/** Spec 040 FR-015: what `generateText` returns. */
export interface GenerateTextResult {
  text: string;
  costUsd?: number;
  nanoAiu?: number;
}

/** Spec 065 FR-001: the paths a file-edit tool is about to write (absolute, or relative to the session's folder). Never rejects. */
export type WriteGuard = (sessionId: string, paths: string[]) => Promise<void>;

export interface StartOptions {
  /** Folder or .code-workspace file; one session per workspace. */
  workspace: string;
  model?: string;
  /** For model 'auto': routing preference ('efficiency' is the cheapest). */
  autoTier?: 'efficiency' | 'balance' | 'intelligence';
  /** Cap for this session in the adapter's `capUnit`: AI credits (treated as AIU, spec 011 FR-015) or dollars (spec 012 FR-150). Soft. */
  maxAiCredits?: number;
  /** Resume an existing session by the vendor's own session id (disk-backed). */
  resumeSessionId?: string;
  /** Use this id: resume it when it exists on disk, otherwise create a new session with exactly this id. */
  sessionId?: string;
  /** Reasoning effort for models that support it (see listModels). */
  /** The model's own effort name (spec 007 FR-008: `none` too; `src/shared/effort.ts`). */
  reasoningEffort?: string;
  /** Context-window tier of the saved choice (spec 030); omitted = the model's default tier. Passed on create and on resume. */
  contextTier?: ContextTier;
  /**
   * Permission policy. Default (both unset): reads are approved, everything that can
   * change state (write, shell, mcp, url, custom tools, ...) is denied.
   * `allow: true` approves everything (explicit opt-in). `ask: true` leaves every
   * non-read request pending (status 'needs-permission') until `resolvePermission` is called.
   * `permissionMode`, when present, wins over both booleans; an unknown value means read-only. The booleans stay for scripts and tests.
   */
  permissionMode?: PermissionMode;
  allow?: boolean;
  ask?: boolean;
  /** Do not emit the "Ready" status when the session is up (used when starting it for a message that is about to be sent). */
  quiet?: boolean;
  /** Spec 061 FR-004: the folder's own hooks and permission rules the person accepted, for this agent app. Never logged. */
  folderSetup?: FolderSetupStart;
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
  /** Spec 066 FR-001: plan first: the agent proposes a plan in its app's own plan mode and waits for `resolvePlan`. Needs `capabilities.planMode`. */
  plan?: boolean;
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
  /**
   * Spec 012 FR-157: set on an `error` status when the agent app refused the turn because its sign-in is missing, expired or
   * invalid. Main then marks the app `not-signed-in` and the chat offers Sign in. Only this word leaves the adapter, never the account.
   */
  errorKind?: 'auth';
  /**
   * Spec 068 FR-002: set on the `idle` status that closes a turn the agent app ended at a usage limit (right after its `usageLimit`).
   * The window and the MCP read state key the coffee break on this marker, never on the display text of `intent` (2026-10-22).
   */
  reason?: 'usage-limit';
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
  /** Who decided: the user, an earlier "Approve for this session" grant, the session being stopped, or Allow all (`policy`: no card is shown, spec 052 FR-071). */
  via?: 'user' | 'session' | 'stopped' | 'policy';
  /** True when the user approved this one *and* remembered the scope for the session. */
  remembered?: boolean;
  /**
   * Spec 052 FR-063: what an edit would change, as unified-diff text ("--- a/x", "+++ b/x", "@@", "+", "-" lines), at most 20000
   * characters. Optional: only pending requests that carry the edit's text have it (Claude Code Edit, MultiEdit and Write; the
   * simulator). Copilot and Codex leave it out. Display text only: never run or applied.
   */
  diff?: string;
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
  /** Spec 058 FR-063: this failed MCP tool call needs the user to sign in to `mcpServer` (set by the adapter, never carries vendor text). Only on `phase: 'failed'` with `mcpServer`. */
  mcpAuth?: true;
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
  /** The vendor's own estimate of this call's cost in USD. Never a bill, and never added to AIU or to any credit total. */
  costUsd?: number;
  costBasis?: 'estimate';
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

/** Result of `startMcpSignIn` (spec 058 FR-064). */
export type McpSignInResult = { kind: 'browser'; url: string } | { kind: 'connected' };

export interface McpServerStatus {
  name: string;
  /** connected | failed | needs-auth | pending | disabled | stopped | not_configured */
  status: string;
  /** Where the runtime got the server from: user | workspace | plugin | builtin | managed | account. */
  source?: string;
  transport?: string;
  error?: string;
  /** Spec 058 FR-011: normalized kind of failure, set by the adapter only when the vendor says so; missing = not said. */
  errorClass?: 'auth' | 'not-found' | 'timeout' | 'exited' | 'config';
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

/**
 * Spec 068 FR-001: a usage limit of the agent app stopped or blocked the turn (a plan window, a quota or a rate limit), so the
 * agent goes on a coffee break. Never a vendor field: `source` is a short fixed label chosen by the adapter ("5-hour window"),
 * never the provider's message, account or plan name. `resetsAt` (epoch ms) only when the agent app said when it resets;
 * `estimated` when it said the time is a guess; `update` for a later detail of the same break; `paid` when going on after the reset may lead to paid usage (the default asks first).
 * Durbar's own spending limit is the `limit` event, not this one.
 */
export interface UsageLimitEvent extends BaseEvent {
  type: 'usageLimit';
  scope: 'plan' | 'quota' | 'rate';
  resetsAt?: number;
  estimated?: boolean;
  paid?: boolean;
  source: string;
  /** A later detail of the break this turn already reported (a reset time read afterwards); ignored when the agent is no longer on a break. */
  update?: boolean;
}

/**
 * The session's display title from the runtime (spec 002 delta 2026-10-18, issue #126): a title made from the first prompt,
 * an auto summary or a name given elsewhere. Top-level agent only, already cleaned (one line, ≤ 80 characters). User text:
 * shown, never put in tool-usage labels or usage totals.
 */
export interface TitleEvent extends BaseEvent {
  type: 'title';
  title: string;
}

/** One question the agent asks the user (spec 012 FR-128); text already cleaned and capped. */
export interface AskedQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: { label: string; description?: string }[];
}

/** The agent asks the user to choose (spec 012 FR-128): `asked` with the questions, then `answered` or `cancelled`. */
export interface QuestionEvent extends BaseEvent {
  type: 'question';
  phase: 'asked' | 'answered' | 'cancelled';
  requestId: string;
  questions?: AskedQuestion[];
  /** `answered` only: question text -> chosen label(s), comma-separated. Never set for an elicitation (its values can be secrets). */
  answers?: Record<string, string>;
  /** `asked` only (spec 012 FR-151): an MCP elicitation, a form (`fields`) or a URL flow (`url`); answered with `answerElicitation`. */
  elicitation?: ElicitRequest;
  /** `answered` of an elicitation: what the user did (`accept` = submitted or Done, `decline`); a cancel is `phase: 'cancelled'`. */
  elicitAction?: ElicitAction;
}

/** A custom agent the user can select for a session (spec 043 FR-001); generic across adapters. */
export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  /** `repo`: from the session folder's repository (asks once before use); `user`: the user's own folder. */
  source: 'repo' | 'user' | 'other';
  /** Definition file, when the profile comes from a file. */
  path?: string;
  /** Allowed tools; undefined = all the session's tools. */
  tools?: string[];
  /** The model the profile asks for (the runtime may use another). */
  model?: string;
  /** Names of the MCP servers the profile brings. */
  mcpServers?: string[];
}

/** The selected agent profile of the session changed (spec 043 FR-001); null = the default agent. */
export interface AgentProfileEvent extends BaseEvent {
  type: 'agentProfile';
  profile: AgentProfile | null;
}

/**
 * A prompt scheduled inside the agent app's own session (spec 044 FR-016), e.g. Copilot `/every`, `/after` or its
 * `manage_schedule` tool. Display only: Agent Durbar shows it read-only and never changes it. Text already cleaned and capped.
 */
export interface AgentScheduleEvent extends BaseEvent {
  type: 'agentSchedule';
  phase: 'created' | 'cancelled' | 'rearmed';
  scheduleId: string;
  /** `created`: the prompt (or the app's short label for it), one line, at most 300 characters. */
  prompt?: string;
  /** Relative interval between runs (ms). */
  everyMs?: number;
  /** Five-field cron expression and its IANA time zone. */
  cron?: string;
  tz?: string;
  /** One-off run time (epoch ms). */
  at?: number;
  /** `rearmed`: the next run the agent chose (epoch ms). */
  nextAt?: number;
  recurring?: boolean;
  /** No fixed cadence: the agent arms each next run itself. */
  selfPaced?: boolean;
  /** Who made it: the user (a command) or the agent (its tool). */
  origin?: 'user' | 'model';
}

/**
 * Spec 054 FR-062: remote control changed without the user asking: it ended (a relaunch could not turn it back on), or it is still on
 * with a new link after a relaunch (`on: true` with `url`; main checks the host again before the window sees it).
 */
export interface RemoteEvent extends BaseEvent {
  type: 'remote';
  on: boolean;
  /** One plain line for the window. */
  reason?: string;
  url?: string;
}

/** Spec 066 FR-002: a plan the agent proposes (plan first), and its end. */
export interface PlanEvent extends BaseEvent {
  type: 'plan';
  phase: 'proposed' | 'resolved';
  requestId: string;
  /** The plan as the agent wrote it (Markdown); `proposed` only. */
  text?: string;
  /** `resolved` only. */
  action?: 'approve' | 'reject' | 'revise';
}

/** Spec 066 FR-002: the user's answer to a proposed plan. */
export type PlanAnswer = { kind: 'approve' } | { kind: 'reject' } | { kind: 'revise'; feedback: string };

export type AgentEvent =
  | PlanEvent
  | RemoteEvent
  | AgentScheduleEvent
  | UserEvent
  | QuestionEvent
  | AgentProfileEvent
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
  | LimitEvent
  | UsageLimitEvent
  | TitleEvent;

/** Spec 012 FR-156: the answer of `verifySignIn`. */
export interface SignInCheck {
  status: 'signed-in' | 'signed-out' | 'unknown';
  detail?: string;
}

export type LimitAction = { kind: 'add'; credits: number } | { kind: 'set'; credits: number } | { kind: 'unset' } | { kind: 'cancel' };

export type Unsubscribe = () => void;

export interface AgentAdapter {
  /** Adapter id, e.g. "copilot". */
  readonly id: string;
  /** Name shown to the user, e.g. "GitHub Copilot". */
  readonly displayName: string;
  /** What this adapter can do; each optional member below is present exactly when its flag says so. */
  readonly capabilities: AdapterCapabilities;
  /** Optional debug sink (DURBAR_LOG); assigned by the main process; the sink redacts env values and key-like strings before writing, but callers should still not pass secrets. */
  debug?: (message: string) => void;
  /** Spec 065 FR-001: called (and awaited, bounded) just before an agent's file-edit tool writes these paths; assigned by the main process. */
  writeGuard?: WriteGuard;
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
  /** Spec 066 FR-002: answer a proposed plan (approve, reject, or revise with feedback). Optional (`capabilities.planMode`). */
  resolvePlan?(sessionId: string, requestId: string, answer: PlanAnswer): Promise<void>;
  /** Answer a `question` event (spec 012 FR-128); `null` = the user skipped it. Unknown ids are ignored. */
  answerQuestion?(sessionId: string, requestId: string, answers: Record<string, string> | null): void;
  /** Answer an elicitation `question` event (spec 012 FR-151); main has checked it against the fields. Unknown ids are ignored. */
  answerElicitation?(sessionId: string, requestId: string, answer: ElicitAnswer): void;
  /** Agent profiles the session can use (spec 043 FR-001). */
  listAgentProfiles?(sessionId: string): Promise<AgentProfile[]>;
  /** Select a profile for the next turns, or null for the default agent (spec 043 FR-001). Emits `agentProfile`. */
  selectAgentProfile?(sessionId: string, id: string | null): Promise<AgentProfile | null>;
  /** Switch one MCP server on or off in a running session (spec 019). Optional. */
  setMcpEnabled?(sessionId: string, name: string, enabled: boolean): Promise<void>;
  /**
   * Spec 058 FR-012: restart one MCP server of a running session, only that one, with the configuration it already has. Optional
   * (`capabilities.mcpRestart`). Rejects with a short, user-facing sentence when the session is not running or the server cannot be
   * restarted now; never starts a session and never restarts the others. The new state follows as an `mcp` event.
   */
  restartMcpServer?(sessionId: string, name: string): Promise<void>;
  /**
   * Spec 058 FR-064: start the agent app's own sign-in for one MCP server of a running session. Optional (`capabilities.mcpSignIn`).
   * `browser`: the user finishes in the browser at `url` (main keeps it, the window only gets the host); `connected`: already signed in.
   * Rejects when the runtime has no such call or refuses it (the UI then shows `capabilities.mcpSignInSteps`).
   */
  startMcpSignIn?(sessionId: string, name: string): Promise<McpSignInResult>;
  /** Spec 058 FR-064: stop a sign-in started by `startMcpSignIn` where the runtime can. Optional, only with `startMcpSignIn`. */
  cancelMcpSignIn?(sessionId: string, name: string): Promise<void>;
  /** Change the model, effort or context tier of a live session; applies from the next message (spec 030). Optional: adapters that cannot omit it and the UI offers a new session instead. */
  setModel?(sessionId: string, request: ModelSwitchRequest): Promise<ModelSwitchResult>;
  /** Remove a switch the runtime queued while a turn was running (`queueId` from a `queued` result). Optional. */
  cancelQueuedModel?(sessionId: string, queueId: string): Promise<void>;
  /** Compact the context now (spends a model call); `focus` steers the summary. Optional. */
  compact?(sessionId: string, focus?: string): Promise<CompactResult>;
  /** A markdown hand-off summary of the conversation, made without changing it (spec 030 FR-034). Optional (`capabilities.handoff`). */
  handoffSummary?(sessionId: string): Promise<HandoffResult>;
  /**
   * One prompt answered with no tools, no MCP and no session kept, in an empty temp folder (spec 040 FR-015). Optional (`capabilities.oneShot`).
   * `opts.disabledMcpServers`: names of servers the harness would load on its own, to keep switched off (Copilot); others ignore it.
   * The reply carries the spend the harness reports: a dollar estimate (`costUsd`) or AI credits (`nanoAiu`, 1e9 = 1 credit).
   */
  generateText?(prompt: string, opts?: GenerateTextOptions): Promise<GenerateTextResult>;
  /** Spec 054 FR-001: turn remote control (follow and steer from the vendor's web or mobile app) on or off for a live session. Optional (`capabilities.remote`). Never on by default. */
  setRemote?(sessionId: string, on: boolean): Promise<RemoteState>;
  /**
   * Spec 059 FR-007: store the user's name for a session in the agent app. Optional (`capabilities.renameSession`). `sessionId` is the
   * vendor's own id (also of a stored session that is not live). `name` already passed Durbar's name rule. Throws when the app refuses
   * (the caller keeps a Durbar-only name). `'next-turn'` adapters only remember the name here and report it as a `title` event once applied.
   */
  renameSession?(sessionId: string, name: string): Promise<void>;
  /** Spec 051 FR-007: whether this harness is signed in, checked without a prompt (no credits). Only the yes/no leaves the adapter. */
  authStatus?(): Promise<{ signedIn: boolean }>;
  /**
   * Spec 012 FR-156: whether the sign-in really works, asked of the service where the app offers a free call (no prompt, no
   * credits); `unknown` when it cannot tell. `detail` is a short, safe sentence: never a token, email or account name.
   */
  verifySignIn?(): Promise<SignInCheck>;
  /**
   * Spec 012 FR-158: pick up a new sign-in made outside the adapter (Settings or the chat's sign-in card) in anything the adapter
   * keeps across sessions (Copilot's shared runtime client). Live sessions survive it. Optional: an adapter that starts a
   * process per session needs nothing. Never takes or returns a token.
   */
  refreshAuth?(): Promise<void>;
  /** True while the session is open in this adapter. */
  isLive(sessionId: string): boolean;
  /** Stop every session and free the runtime. */
  dispose(): Promise<void>;
  /** The models the account offers, in the UI's shape (no inference, no credits). Optional (`capabilities.models`). */
  listModelOptions?(): Promise<ModelOption[]>;
  /** Earlier sessions of a folder, newest first; `excludeIds` are left out. Optional (`capabilities.history`). */
  listPreviousSessions?(cwd: string, excludeIds?: ReadonlySet<string>): Promise<PreviousSession[]>;
  /** Persisted messages and tool calls of a live session, for replay. Optional (`capabilities.history`). */
  history?(sessionId: string): Promise<HistoryResult>;
  /** Change the permission mode of a live session; returns how many requests stay pending. Optional (`capabilities.permModeSwitch` is not `none`). */
  setPermMode?(sessionId: string, mode: PermissionMode, opts?: { clearGrants?: boolean; approvePending?: boolean }): { pending: number };
  /**
   * Spec 006 FR-028: permanently remove one earlier session through the vendor's own API (never by touching files). Refuses a session
   * that is live in this adapter. Optional (`capabilities.deleteSession`).
   */
  deleteSession?(sessionId: string): Promise<void>;
  /** The vendor's own id to resume this session later, when it differs from Durbar's session id (spec 006 FR-020; Codex's thread id). */
  resumeIdOf?(sessionId: string): string | undefined;
  /** Subscribe to normalized events from all sessions of this adapter. */
  onEvent(listener: (event: AgentEvent) => void): Unsubscribe;
}
