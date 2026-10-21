/**
 * Pure mapping from raw Copilot SDK session events to Agent Durbar's normalized events (no SDK import at run time,
 * so it is unit-tested with recorded fixtures and no credits). See specs/015 for what the real runtime sends.
 *
 * Sub-agents: the runtime tags every event of a sub-agent with its instance `agentId`; `subagent.started` links that
 * instance to the parent's `task` tool call (`data.toolCallId`). Normalized sub-agent events carry that tool call id as
 * `agentId`, which is also the id of the helper card (`SubagentEvent.subagentId`).
 */
import { isMcpAuthChallenge } from './mcpauth';
import type { AgentEvent, CompactionEvent, ContextTier, McpServerStatus } from './types';
import { cleanSessionTitle } from './history';
import { nonEmptyStr as str } from '../shared/guards';

export type EventBody = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, 'sessionId' | 'timestamp'> : never) : never;

/** The few fields of an SDK event the mapper reads (a structural subset of `SessionEvent`). */
export interface RawEvent {
  type: string;
  agentId?: string;
  data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const tierOf = (v: unknown): ContextTier | undefined => (v === 'long_context' ? 'long' : v === 'default' ? 'default' : undefined);
const positive = (v: unknown): number | undefined => (typeof v === 'number' && v > 0 ? v : undefined);
const triggerOf = (v: unknown): CompactionEvent['trigger'] => (v === 'manual' ? 'manual' : v === 'model_switch' ? 'model-switch' : v === 'context_limit_retry' ? 'overflow' : 'auto');

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
  /** Model and tier last reported by the runtime, attached to context events (spec 030). */
  private model: string | undefined;
  private tier: ContextTier | undefined;
  /** Trigger of the compaction in progress (the complete event does not repeat it) and the window it started with. */
  private compaction: { trigger: CompactionEvent['trigger']; limit?: number } | undefined;
  /** A model Agent Durbar asked for: the next change to it is the user's own (cause `user`), not the runtime's. */
  private expected: string | undefined;

  constructor(private readonly emit: (body: EventBody) => void) {}

  reset(): void {
    this.toolNames.clear();
    this.mcp.clear();
    this.reasoningSeen.clear();
    this.instances.clear();
    this.model = this.tier = this.compaction = this.expected = undefined;
  }

  /** Tell the mapper the user asked for `model`, so the matching `session.model_change` is reported with cause `user`. */
  expectUserModel(model: string | undefined): void {
    this.expected = model;
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
        // spec 058 FR-060/FR-063 (T094): a failed MCP tool whose text is the server's OAuth challenge says "sign in"; the server shows
        // needs-auth until the runtime's next status for it (status_changed or servers_loaded replaces the row)
        const mcpAuth = !d.success && !!meta.mcpServer && isMcpAuthChallenge(output);
        this.emit({ type: 'toolCall', callId: d.toolCallId, ...meta, phase: d.success ? 'complete' : 'failed', output, ...(mcpAuth ? { mcpAuth: true } : {}), agentId });
        if (mcpAuth && meta.mcpServer) {
          const prev = this.mcp.get(meta.mcpServer);
          this.mcp.set(meta.mcpServer, { ...(prev ?? { name: meta.mcpServer }), status: 'needs-auth', errorClass: 'auth' });
          this.emitMcp();
        }
        return;
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
          ...(this.model ? { model: this.model } : {}),
          ...(this.tier ? { tier: this.tier } : {}),
        });
      case 'session.model_change': {
        if (agentId || typeof d.newModel !== 'string' || !d.newModel) return;
        const tier = tierOf(d.contextTier);
        const cause = d.cause === 'rate_limit_auto_switch' ? 'rate-limit' : d.cause === 'refusal_fallback' ? 'fallback' : this.expected === d.newModel ? 'user' : 'runtime';
        if (this.expected === d.newModel) this.expected = undefined;
        this.model = d.newModel;
        this.tier = tier;
        return this.emit({
          type: 'model',
          model: d.newModel,
          previousModel: str(d.previousModel),
          effort: typeof d.reasoningEffort === 'string' ? d.reasoningEffort : undefined,
          previousEffort: str(d.previousReasoningEffort),
          tier,
          cause,
        });
      }
      case 'session.compaction_start': {
        if (agentId) return;
        const trigger = triggerOf(d.trigger);
        this.compaction = { trigger, limit: positive(d.tokenLimit) };
        return this.emit({ type: 'compaction', phase: 'start', trigger, tokensBefore: num(d.currentTokens), limit: positive(d.tokenLimit) });
      }
      case 'session.compaction_complete': {
        if (agentId) return;
        const c = this.compaction ?? { trigger: 'auto' as const };
        this.compaction = undefined;
        const before = num(d.preCompactionTokens);
        const after = num(d.postCompactionTokens);
        // real: (T043) the compaction is one model call with its own cost (`compactionTokensUsed`); count it like any other usage so totals and caps are honest.
        const cu = d.compactionTokensUsed;
        if (d.success === true && cu && typeof cu === 'object' && Number(cu.copilotUsage?.totalNanoAiu) > 0) {
          this.emit({ type: 'usage', model: str(cu.model) ?? str(d.behaviorModelId), inputTokens: num(cu.inputTokens), outputTokens: num(cu.outputTokens), cacheReadTokens: num(cu.cacheReadTokens), nanoAiu: Number(cu.copilotUsage.totalNanoAiu), creditsStatus: cu.copilotUsage.aiCreditsStatus ?? cu.aiCreditsStatus });
        }
        if (d.success !== true) return this.emit({ type: 'compaction', phase: 'failed', trigger: c.trigger, tokensBefore: before, limit: c.limit, error: str(d.error) });
        return this.emit({
          type: 'compaction',
          phase: 'complete',
          trigger: c.trigger,
          tokensBefore: before,
          tokensAfter: after,
          tokensRemoved: before !== undefined && after !== undefined ? Math.max(0, before - after) : undefined,
          limit: positive(d.tokenLimit) ?? c.limit,
        });
      }
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
      case 'subagent.selected': {
        // spec 043 FR-002: the session's selected custom agent (top level only); source and details come from the adapter's list
        if (agentId || typeof d.agentName !== 'string' || !d.agentName) return;
        return this.emit({ type: 'agentProfile', profile: { id: d.agentName, name: cleanSessionTitle(d.agentDisplayName, 60) ?? d.agentName, source: 'other', ...(Array.isArray(d.tools) ? { tools: d.tools.filter((t: unknown): t is string => typeof t === 'string').slice(0, 100) } : {}) } });
      }
      case 'subagent.deselected':
        return agentId ? undefined : this.emit({ type: 'agentProfile', profile: null });
      case 'session.title_changed': {
        // The main agent's display title (issue #126); a sub-agent's title is not shown.
        const title = agentId ? undefined : cleanSessionTitle(d.title);
        return title ? this.emit({ type: 'title', title }) : undefined;
      }
      case 'session.schedule_created': {
        // spec 044 FR-016: the session's own scheduled prompts (`/every`, `/after`, `manage_schedule`), shown read-only
        if (agentId || (typeof d.id !== 'number' && typeof d.id !== 'string')) return;
        const prompt = cleanSessionTitle(str(d.displayPrompt) ?? str(d.prompt), 300);
        return this.emit({
          type: 'agentSchedule', phase: 'created', scheduleId: String(d.id).slice(0, 64),
          ...(prompt ? { prompt } : {}),
          ...(positive(d.intervalMs) ? { everyMs: d.intervalMs } : {}),
          ...(str(d.cron) ? { cron: (d.cron as string).slice(0, 100) } : {}),
          ...(str(d.tz) ? { tz: (d.tz as string).slice(0, 64) } : {}),
          ...(positive(d.at) ? { at: d.at } : {}),
          ...(typeof d.recurring === 'boolean' ? { recurring: d.recurring } : {}),
          ...(d.selfPaced === true ? { selfPaced: true } : {}),
          ...(d.origin === 'user' || d.origin === 'model' ? { origin: d.origin } : {}),
        });
      }
      case 'session.schedule_cancelled':
        if (agentId || (typeof d.id !== 'number' && typeof d.id !== 'string')) return;
        return this.emit({ type: 'agentSchedule', phase: 'cancelled', scheduleId: String(d.id).slice(0, 64) });
      case 'session.schedule_rearmed':
        if (agentId || (typeof d.id !== 'number' && typeof d.id !== 'string')) return;
        return this.emit({ type: 'agentSchedule', phase: 'rearmed', scheduleId: String(d.id).slice(0, 64), ...(positive(d.nextRunAt) ? { nextAt: d.nextRunAt } : {}) });
      case 'session.idle':
        // spec 002 FR-016 (T024): what a turn left behind (a tool that never completed, reasoning never closed, e.g. after Stop) is dropped
        this.toolNames.clear();
        this.reasoningSeen.clear();
        return this.emit({ type: 'status', status: 'idle', intent: d.aborted ? 'Aborted' : undefined });
      case 'session.error': {
        // spec 068 FR-002: a used-up quota or a rate limit that stopped the turn is a coffee break, not an error
        const lim = agentId ? null : copilotUsageLimit(d.errorType, d.errorCode);
        if (lim) {
          this.emit(lim);
          return this.emit({ type: 'status', status: 'idle', intent: 'Usage limit reached' });
        }
        // spec 012 FR-157: the runtime's own category decides when it has one; otherwise the message is read (markAuthError)
        return this.emit({ type: 'status', status: 'error', intent: `${d.errorType}: ${d.message}`, agentId, ...copilotErrorKind(d.errorType, d.message) });
      }
      default:
        return;
    }
  }
}

/** Spec 068: Copilot's `rate_limit` codes and their fixed labels (`read:` SDK typings, `RateLimitErrorCode`). */
const COPILOT_RATE: Record<string, string> = {
  user_weekly_rate_limited: 'Copilot weekly limit',
  user_global_rate_limited: 'Copilot rate limit',
  rate_limited: 'Copilot rate limit',
  user_model_rate_limited: 'Copilot model rate limit',
  integration_rate_limited: 'Copilot rate limit',
};
/**
 * Spec 068 FR-002: `session.error` -> coffee break. `rate_limit` (any code) is a rate window (no money); `quota` with `quota_exceeded` or
 * `session_quota_exceeded` is the premium-request quota (going on may be billed as overage: `paid`). Other quota codes
 * (`billing_not_configured`, ...) and every other category stay errors. The reset time comes later from the adapter (account.getQuota).
 */
export function copilotUsageLimit(errorType: unknown, errorCode: unknown): (EventBody & { type: 'usageLimit' }) | null {
  const code = typeof errorCode === 'string' ? errorCode : '';
  if (errorType === 'rate_limit') return { type: 'usageLimit', scope: 'rate', source: Object.prototype.hasOwnProperty.call(COPILOT_RATE, code) ? COPILOT_RATE[code] : 'Copilot rate limit' };
  if (errorType === 'quota' && (code === 'quota_exceeded' || code === 'session_quota_exceeded')) return { type: 'usageLimit', scope: 'quota', paid: true, source: 'Copilot premium requests' };
  return null;
}

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

/** FR-157: Copilot's `session.error` category: `authentication` is a sign-in failure; a known other category never is (a 403 for a model policy is not a sign-in problem). */
const NO_AUTH_SESSION = /not created with authentication info/i;
const NOT_SIGN_IN = ['authorization', 'policy', 'quota', 'rate_limit', 'context_limit', 'query'];
export function copilotErrorKind(errorType: unknown, message?: unknown): { errorKind?: 'auth' } {
  if (errorType === 'authentication') return { errorKind: 'auth' };
  // spec 012 T124 (real, 2026-10-20): with a refused token runtime 1.0.98 reports the first Send as `query` with this text; only this
  // exact phrase is read, so other `query` errors stay "not a sign-in problem"
  if (errorType === 'query' && typeof message === 'string' && NO_AUTH_SESSION.test(message)) return { errorKind: 'auth' };
  if (typeof errorType === 'string' && NOT_SIGN_IN.includes(errorType)) return { errorKind: undefined };
  return {};
}
