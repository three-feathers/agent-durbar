/**
 * Pure mapping from raw Copilot SDK session events to Agent Durbar's normalized events (no SDK import at run time,
 * so it is unit-tested with recorded fixtures and no credits). See specs/015 for what the real runtime sends.
 *
 * Sub-agents: the runtime tags every event of a sub-agent with its instance `agentId`; `subagent.started` links that
 * instance to the parent's `task` tool call (`data.toolCallId`). Normalized sub-agent events carry that tool call id as
 * `agentId`, which is also the id of the helper card (`SubagentEvent.subagentId`).
 */
import type { AgentEvent } from './types';

export type EventBody = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, 'sessionId' | 'timestamp'> : never) : never;

/** The few fields of an SDK event the mapper reads (a structural subset of `SessionEvent`). */
export interface RawEvent {
  type: string;
  agentId?: string;
  data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const SUBAGENT_NAME_FALLBACK = 'Sub-agent';

export class EventMapper {
  /** callId -> tool name, so complete/update events can carry the tool name. */
  private toolNames = new Map<string, string>();
  /** Reasoning block ids that already streamed as deltas (so the complete block is not shown twice). */
  private reasoningSeen = new Set<string>();
  /** SDK sub-agent instance id -> spawning `task` tool call id. */
  private instances = new Map<string, string>();

  constructor(private readonly emit: (body: EventBody) => void) {}

  reset(): void {
    this.toolNames.clear();
    this.reasoningSeen.clear();
    this.instances.clear();
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
      case 'tool.execution_start':
        this.toolNames.set(d.toolCallId, d.toolName);
        return this.emit({ type: 'toolCall', callId: d.toolCallId, tool: d.toolName, phase: 'start', args: d.arguments, agentId });
      case 'tool.execution_partial_result':
        return this.emit({ type: 'toolCall', callId: d.toolCallId, tool: this.toolNames.get(d.toolCallId) ?? '', phase: 'update', output: d.partialOutput, agentId });
      case 'tool.execution_complete': {
        const tool = this.toolNames.get(d.toolCallId) ?? '';
        this.toolNames.delete(d.toolCallId);
        const output = d.success ? contentOf(d.result) : d.error?.message;
        return this.emit({ type: 'toolCall', callId: d.toolCallId, tool, phase: d.success ? 'complete' : 'failed', output, agentId });
      }
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
      case 'session.idle':
        return this.emit({ type: 'status', status: 'idle', intent: d.aborted ? 'Aborted' : undefined });
      case 'session.error':
        return this.emit({ type: 'status', status: 'error', intent: `${d.errorType}: ${d.message}`, agentId });
      default:
        return;
    }
  }
}

/** `tool.execution_complete.result` is `{content, detailedContent?}` (an object in the SDK types, a JSON string in some logs). */
function contentOf(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === 'string') return result;
  const c = (result as { content?: unknown }).content;
  return typeof c === 'string' ? c : undefined;
}
