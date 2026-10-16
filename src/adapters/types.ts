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
  /** Soft cap on AI credits for this session, if the runtime supports it. */
  maxAiCredits?: number;
  /** Resume an existing session id (disk-backed). */
  resumeSessionId?: string;
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
  final?: boolean;
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

export type AgentEvent = StatusEvent | ThinkingEvent | OutputEvent | ToolCallEvent | SubagentEvent;

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
  /** Subscribe to normalized events from all sessions of this adapter. */
  onEvent(listener: (event: AgentEvent) => void): Unsubscribe;
}
