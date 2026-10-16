/**
 * Pure mapping from raw Copilot SDK session events to Agent Durbar's normalized events (no SDK import at run time,
 * so it is unit-tested with recorded fixtures and no credits). See specs/015 for what the real runtime sends.
 *
 * Sub-agents: the runtime tags every event of a sub-agent with its instance `agentId`; `subagent.started` links that
 * instance to the parent's `task` tool call (`data.toolCallId`). Normalized sub-agent events carry that tool call id as
 * `agentId`, which is also the id of the helper card (`SubagentEvent.subagentId`).
 */
import type { AgentEvent, McpServerStatus } from './types';

export type EventBody = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, 'sessionId' | 'timestamp'> : never) : never;

/** The few fields of an SDK event the mapper reads (a structural subset of `SessionEvent`). */
export interface RawEvent {
  type: string;
  agentId?: string;
  data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const SUBAGENT_NAME_FALLBACK = 'Sub-agent';

export class EventMapper {
  /** callId -> tool name (and MCP origin), so complete/update events can carry them. */
  private toolNames = new Map<string, { tool: string; mcpServer?: string; mcpTool?: string }>();
  /** MCP servers of the session by name (the runtime reports a list once and then single changes). */
  private mcp = new Map<string, McpServerStatus>();
  /** Reasoning block ids that already streamed as deltas (so the complete block is not shown twice). */
  private reasoningSeen = new Set<string>();
  /** SDK sub-agent instance id -> spawning `task` tool call id. */
  private instances = new Map<string, string>();

  constructor(private readonly emit: (body: EventBody) => void) {}

  reset(): void {
    this.toolNames.clear();
    this.mcp.clear();
    this.reasoningSeen.clear();
    this.instances.clear();
  }

  private emitMcp(): void {
    this.emit({ type: 'mcp', servers: [...this.mcp.values()].map((x) => ({ ...x })) });
  }

  /** Id used as `agentId` of a normalized event: undefined for the main agent. */
  private who(ev: RawEvent): string | undefined {
    const inst = ev.agentId;
    if (!inst) return undefined;
    return this.instances.get(inst) ?? (ev.data?.parentToolCallId as string | undefined) ?? inst;
  }

  map(ev: RawEvent): void {
    const d = ev.data ?? {};
    if (ev.type === 'subagent.started' && ev.agentId && d.toolCallId) this.instances.set(ev.agentId, d.toolCallId);
    const agentId = this.who(ev);
    switch (ev.type) {
      case 'user.message':
        // The main agent's user message is the one the user typed (the renderer already shows it); a sub-agent's is its task prompt.
        if (agentId && typeof d.content === 'string') this.emit({ type: 'user', text: d.content, agentId });
        return;
      case 'assistant.turn_start':
        return this.emit({ type: 'status', status: 'working', agentId });
      case 'assistant.intent':
        return this.emit({ type: 'status', status: 'working', intent: d.intent, agentId });
      case 'assistant.reasoning_delta':
        this.reasoningSeen.add(d.reasoningId);
        return this.emit({ type: 'thinking', delta: d.deltaContent, reasoningId: d.reasoningId, agentId });
      case 'assistant.reasoning':
        // Complete reasoning block. When no deltas came for it (streaming off or not provided), show it whole.
        if (this.reasoningSeen.delete(d.reasoningId)) return;
        if (d.content) this.emit({ type: 'thinking', delta: d.content, reasoningId: d.reasoningId, agentId });
        return;
      case 'assistant.message_delta':
        return this.emit({ type: 'output', delta: d.deltaContent, agentId });
      case 'assistant.message':
        if (d.content) this.emit({ type: 'output', delta: '', final: true, text: d.content, agentId });
        return;
      case 'assistant.usage':
        return this.emit({
          type: 'usage',
          agentId,
          model: d.model,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          cacheReadTokens: d.cacheReadTokens,
          nanoAiu: d.copilotUsage?.totalNanoAiu,
          costMultiplier: d.cost,
          creditsStatus: d.aiCreditsStatus,
        });
      case 'tool.execution_start': {
        // MCP tools: the runtime names the tool `<server>-<tool>` and adds the server and tool name as separate fields.
        const mcpServer = str(d.mcpConfigServerName) ?? str(d.mcpServerName);
        const meta = { tool: d.toolName, ...(mcpServer ? { mcpServer, mcpTool: str(d.mcpToolName) ?? d.toolName } : {}) };
        this.toolNames.set(d.toolCallId, meta);
        return this.emit({ type: 'toolCall', callId: d.toolCallId, ...meta, phase: 'start', args: d.arguments, agentId });
      }
      case 'tool.execution_partial_result':
        return this.emit({ type: 'toolCall', callId: d.toolCallId, ...(this.toolNames.get(d.toolCallId) ?? { tool: '' }), phase: 'update', output: d.partialOutput, agentId });
      case 'tool.execution_complete': {
        const meta = this.toolNames.get(d.toolCallId) ?? { tool: '' };
        this.toolNames.delete(d.toolCallId);
        const output = d.success ? contentOf(d.result) : d.error?.message;
        return this.emit({ type: 'toolCall', callId: d.toolCallId, ...meta, phase: d.success ? 'complete' : 'failed', output, agentId });
      }
      case 'session.usage_info':
        // Context window of the main agent (a sub-agent has its own window and is not shown).
        if (agentId || typeof d.currentTokens !== 'number') return;
        return this.emit({
          type: 'context',
          tokens: d.currentTokens,
          limit: typeof d.tokenLimit === 'number' && d.tokenLimit > 0 ? d.tokenLimit : 0,
          system: num(d.systemTokens),
          conversation: num(d.conversationTokens),
          toolDefinitions: num(d.toolDefinitionsTokens),
          messages: num(d.messagesLength),
        });
      case 'session.mcp_servers_loaded':
        this.mcp.clear();
        for (const s of Array.isArray(d.servers) ? d.servers : []) if (s && typeof s.name === 'string') this.mcp.set(s.name, mcpStatus(s.name, s));
        return this.emitMcp();
      case 'session.mcp_server_status_changed':
        if (typeof d.serverName !== 'string') return;
        this.mcp.set(d.serverName, mcpStatus(d.serverName, { status: d.status, error: d.error, source: d.configSource ?? this.mcp.get(d.serverName)?.source, transport: this.mcp.get(d.serverName)?.transport }));
        return this.emitMcp();
      case 'session.mcp_server_removed':
        if (typeof d.serverName === 'string' && this.mcp.delete(d.serverName)) this.emitMcp();
        return;
      case 'subagent.started':
        return this.emit({
          type: 'subagent',
          subagentId: d.toolCallId,
          name: d.agentDisplayName || d.agentName || SUBAGENT_NAME_FALLBACK,
          phase: 'started',
          task: d.agentDescription,
          agentName: d.agentName,
          model: d.model,
        });
      case 'subagent.completed':
        return this.emit({
          type: 'subagent',
          subagentId: d.toolCallId,
          name: d.agentDisplayName || d.agentName || SUBAGENT_NAME_FALLBACK,
          phase: 'completed',
          agentName: d.agentName,
          model: d.model,
          durationMs: d.durationMs,
          totalTokens: d.totalTokens,
          totalToolCalls: d.totalToolCalls,
        });
      case 'subagent.failed':
        return this.emit({
          type: 'subagent',
          subagentId: d.toolCallId,
          name: d.agentDisplayName || d.agentName || SUBAGENT_NAME_FALLBACK,
          phase: 'failed',
          task: d.error,
          error: d.error,
          agentName: d.agentName,
          model: d.model,
          durationMs: d.durationMs,
          totalTokens: d.totalTokens,
          totalToolCalls: d.totalToolCalls,
        });
      case 'session_limits_exhausted.requested':
        // The cap belongs to the session, so sub-agent tagging is dropped on purpose.
        if (typeof d.requestId !== 'string') return;
        return this.emit({ type: 'limit', phase: 'exhausted', requestId: d.requestId, maxAiCredits: num(d.maxAiCredits), usedAiCredits: num(d.usedAiCredits) });
      case 'session_limits_exhausted.completed':
        if (typeof d.requestId !== 'string') return;
        return this.emit({ type: 'limit', phase: 'resolved', requestId: d.requestId, action: str(d.response?.action) });
      case 'session.session_limits_changed': {
        const cap = num(d.sessionLimits?.maxAiCredits);
        return this.emit({ type: 'limit', phase: 'changed', maxAiCredits: cap && cap > 0 ? cap : null });
      }
      case 'session.idle':
        return this.emit({ type: 'status', status: 'idle', intent: d.aborted ? 'Aborted' : undefined });
      case 'session.error':
        return this.emit({ type: 'status', status: 'error', intent: `${d.errorType}: ${d.message}`, agentId });
      default:
        return;
    }
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && v >= 0 ? v : undefined);

function mcpStatus(name: string, s: Record<string, any>): McpServerStatus { // eslint-disable-line @typescript-eslint/no-explicit-any
  return { name, status: str(s.status) ?? 'pending', source: str(s.source), transport: str(s.transport), error: str(s.error)?.slice(0, 300) };
}

/** `tool.execution_complete.result` is `{content, detailedContent?}` (an object in the SDK types, a JSON string in some logs). */
function contentOf(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === 'string') return result;
  const c = (result as { content?: unknown }).content;
  return typeof c === 'string' ? c : undefined;
}
