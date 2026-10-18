/**
 * Pure mapping from Claude Agent SDK stream messages (`SDKMessage`) to Agent Durbar's normalized events (spec 012, FR-014,
 * FR-018, FR-020). No SDK import (the dependency is task T040 and needs the owner's approval): the types below mirror the
 * shapes in specs/012-claude-codex-adapters/research.md section 2.2, which come from the SDK docs and are NOT yet checked
 * against a real run. Every field is read defensively; unknown message types and fields are ignored, never fatal.
 * Same pattern as `EventMapper` in map.ts: stateful, emits event bodies (the adapter adds `sessionId` and `timestamp`).
 * Needs the SDK options `includePartialMessages: true` and `forwardSubagentText: true`.
 */
import type { EventBody } from './map';
import type { McpServerStatus } from './types';

/** Fields of the SDK messages this mapper reads (structural subset; shapes from the SDK docs, unverified on a real account). */
export interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}
export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}
export interface ClaudeMessage {
  type: string;
  subtype?: string;
  /** Spawning `Agent`/`Task` tool_use id for messages of a sub-agent. */
  parent_tool_use_id?: string | null;
  /** Sub-agent instance id (= `task_id`), SDK 0.3.292 and later. */
  agent_id?: string;
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface ClaudeSessionInfo {
  sessionId?: string;
  cwd?: string;
  model?: string;
  cliVersion?: string;
  apiKeySource?: string;
}

/** Cap on tool output text kept in an event (characters). */
export const TOOL_OUTPUT_CAP = 4000;
/** How many assistant message ids are remembered for the usage dedupe (FR-082). */
export const USAGE_IDS_CAP = 512;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** The CLI turns characters outside [A-Za-z0-9_-] in a server name into `_` when it builds `mcp__<server>__<tool>`. */
const normalizeServer = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '_');
const isSubagentTool = (name: string): boolean => name === 'Agent' || name === 'Task';

/**
 * Split `mcp__<server>__<tool>` against the configured server names of the init message. The longest matching server wins
 * (names may hold `_` and `-`); a name that is not of that form, or whose server is not in the list, gives `undefined`:
 * never guess a server name (FR-014).
 */
export function parseMcpToolName(name: string, servers: readonly string[]): { mcpServer: string; mcpTool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined;
  const rest = name.slice(5);
  let best: { mcpServer: string; mcpTool: string } | undefined;
  for (const s of servers) {
    const prefix = `${normalizeServer(s)}__`;
    if (rest.startsWith(prefix) && rest.length > prefix.length && (!best || s.length > best.mcpServer.length)) best = { mcpServer: s, mcpTool: rest.slice(prefix.length) };
  }
  return best;
}

function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const t = content.map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).filter(Boolean).join('\n');
    return t || undefined;
  }
  return undefined;
}
const cap = (s: string | undefined): string | undefined => (s !== undefined && s.length > TOOL_OUTPUT_CAP ? s.slice(0, TOOL_OUTPUT_CAP) : s);

export class ClaudeMapper {
  /** Configured MCP server names from `system/init`. */
  private servers: string[] = [];
  /** tool_use id -> tool name (and MCP origin), so the result carries them. */
  private tools = new Map<string, { tool: string; mcpServer?: string; mcpTool?: string }>();
  /** Sub-agent `task_id` -> spawning tool_use id (from `task_started`). */
  private tasks = new Map<string, string>();
  /** Current assistant message id per stream (key '' = main agent, else the spawning tool_use id). */
  private streamMessage = new Map<string, string>();
  /** Message ids that streamed thinking deltas (their complete thinking block is not shown again). */
  private thinkingStreamed = new Set<string>();
  /** Sub-agents started and not yet closed (by `task_notification` or by the Agent tool's own result): each gets exactly one closing event. */
  private openSubagents = new Set<string>();
  /** Running `total_cost_usd` already reported (streaming mode: the SDK sends totals, Durbar wants per-call amounts). */
  private lastCostTotal = 0;
  /** Per assistant message id, the usage already emitted (the most recent USAGE_IDS_CAP ids, oldest dropped first; FR-082). */
  private usageCounted = new Map<string, { input: number; output: number; cacheRead: number }>();
  /** What `system/init` reported (read by the adapter). */
  info: ClaudeSessionInfo = {};

  /** `quiet`: do not emit the "Ready" status on init (the session is started for a message that is about to be sent). */
  constructor(private readonly emit: (body: EventBody) => void, private readonly opts: { quiet?: boolean; /** Called when a message or block was skipped because it was malformed or threw (not for unknown types, which are ignored on purpose). */ onDropped?: (reason: string) => void } = {}) {}

  /** Sizes of the internal tables (tests assert they stay bounded). */
  stats(): { tools: number; tasks: number; openSubagents: number; streamMessage: number; thinkingStreamed: number } {
    return { tools: this.tools.size, tasks: this.tasks.size, openSubagents: this.openSubagents.size, streamMessage: this.streamMessage.size, thinkingStreamed: this.thinkingStreamed.size };
  }

  reset(): void {
    this.servers = [];
    this.tools.clear();
    this.tasks.clear();
    this.openSubagents.clear();
    this.streamMessage.clear();
    this.thinkingStreamed.clear();
    this.lastCostTotal = 0;
    this.usageCounted.clear();
    this.info = {};
  }

  /** `agentId` of a normalized event: the spawning tool_use id, undefined for the main agent. */
  private who(m: ClaudeMessage): string | undefined {
    const p = str(m.parent_tool_use_id);
    if (p) return p;
    const a = str(m.agent_id);
    return a ? this.tasks.get(a) ?? a : undefined;
  }

  /** Map one SDK message. Never throws on unknown or malformed input. */
  map(m: ClaudeMessage): void {
    if (!m || typeof m !== 'object') return;
    try {
      this.dispatch(m);
    } catch (e) {
      // A shape the mapper does not expect must not end the session (FR-020).
      this.opts.onDropped?.(`message ${String(m.type)}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  private dispatch(m: ClaudeMessage): void {
    const agentId = this.who(m);
    switch (m.type) {
      case 'system':
        return this.system(m);
      case 'stream_event':
        return this.stream(m, agentId);
      case 'assistant':
        return this.assistant(m, agentId);
      case 'user':
        return this.user(m, agentId);
      case 'result':
        return this.result(m);
      case 'rate_limit_event': {
        const info = (m.rate_limit_info ?? m) as Record<string, unknown>;
        if (info.errorCode === 'credits_required' || m.errorCode === 'credits_required') this.emit({ type: 'status', status: 'error', intent: 'Claude usage limit reached' });
        return;
      }
      default:
        return;
    }
  }

  private system(m: ClaudeMessage): void {
    switch (m.subtype) {
      case 'init': {
        const list: unknown[] = Array.isArray(m.mcp_servers) ? m.mcp_servers : [];
        const servers: McpServerStatus[] = [];
        for (const s of list) {
          const name = str((s as { name?: unknown })?.name);
          if (!name) continue;
          const source = str((s as { source?: unknown }).source);
          servers.push({ name, status: str((s as { status?: unknown }).status) ?? 'pending', ...(source ? { source } : {}) });
        }
        this.servers = servers.map((s) => s.name);
        this.info = { sessionId: str(m.session_id), cwd: str(m.cwd), model: str(m.model), cliVersion: str(m.claude_code_version), apiKeySource: str(m.apiKeySource) };
        if (!this.opts.quiet) this.emit({ type: 'status', status: 'idle', intent: `Ready in ${this.info.cwd ?? 'the folder'}` });
        this.emit({ type: 'mcp', servers });
        return;
      }
      case 'task_started': {
        const task = str(m.task_id);
        const tool = str(m.tool_use_id);
        if (task && tool) this.tasks.set(task, tool);
        return;
      }
      case 'task_notification': {
        const id = str(m.tool_use_id) ?? (str(m.task_id) ? this.tasks.get(str(m.task_id)!) : undefined);
        if (!id || !this.openSubagents.has(id)) return;
        const parentTask = str(m.parent_task_id);
        const parent = parentTask ? this.tasks.get(parentTask) : undefined;
        this.closeSubagent(id);
        const u = (m.usage ?? {}) as { total_tokens?: unknown; tool_uses?: unknown; duration_ms?: unknown };
        const status = str(m.status);
        const failed = status === 'failed' || status === 'stopped';
        return this.emit({
          type: 'subagent',
          subagentId: id,
          phase: failed ? 'failed' : 'completed',
          ...(failed ? { error: status === 'stopped' ? 'stopped' : cap(str(m.summary)) ?? 'failed' } : {}),
          durationMs: num(u.duration_ms),
          totalTokens: num(u.total_tokens),
          totalToolCalls: num(u.tool_uses),
          agentId: parent,
        });
      }
      default:
        // task_progress (no `update` phase exists for sub-agents in v1), status, compact_boundary, api_retry, hooks...: ignored.
        return;
    }
  }

  /** Mark a sub-agent closed and drop its task table entries; false when it was not open (already closed or never started). */
  private closeSubagent(id: string): boolean {
    if (!this.openSubagents.delete(id)) return false;
    for (const [task, tool] of this.tasks) if (tool === id) this.tasks.delete(task);
    return true;
  }

  private stream(m: ClaudeMessage, agentId: string | undefined): void {
    const ev = m.event as { type?: string; index?: number; message?: { id?: string }; delta?: { type?: string; text?: unknown; thinking?: unknown } } | undefined;
    if (!ev || typeof ev !== 'object') return;
    const key = agentId ?? '';
    if (ev.type === 'message_start') {
      const id = str(ev.message?.id);
      if (id) this.streamMessage.set(key, id);
      return;
    }
    if (ev.type !== 'content_block_delta' || !ev.delta || typeof ev.delta !== 'object') return;
    const text = str(ev.delta.text);
    const thinking = str(ev.delta.thinking);
    if (ev.delta.type === 'text_delta' && text) return this.emit({ type: 'output', delta: text, agentId });
    if (ev.delta.type === 'thinking_delta' && thinking) {
      const msg = this.streamMessage.get(key);
      if (msg) this.thinkingStreamed.add(msg);
      return this.emit({ type: 'thinking', delta: thinking, reasoningId: `${msg ?? 'stream'}:${num(ev.index) ?? 0}`, agentId });
    }
  }

  private assistant(m: ClaudeMessage, agentId: string | undefined): void {
    const msg = (m.message ?? {}) as { id?: string; model?: string; content?: ClaudeContentBlock[]; usage?: ClaudeUsage };
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const id = str(msg.id);
    blocks.forEach((b, i) => {
      if (!b || typeof b !== 'object') return this.opts.onDropped?.('assistant block is not an object');
      try {
        const text = str(b.text);
        const thinking = str(b.thinking);
        if (b.type === 'thinking') {
          if (thinking && !(id && this.thinkingStreamed.has(id))) this.emit({ type: 'thinking', delta: thinking, reasoningId: `${id ?? 'msg'}:${i}`, agentId });
        } else if (b.type === 'text') {
          if (text) this.emit({ type: 'output', delta: '', final: true, text, agentId });
        } else if (b.type === 'tool_use') {
          const callId = str(b.id);
          const name = str(b.name);
          if (!callId || !name) return this.opts.onDropped?.('tool_use without a string id and name');
          const mcp = parseMcpToolName(name, this.servers);
          const meta = { tool: name, ...(mcp ?? {}) };
          this.tools.set(callId, meta);
          this.emit({ type: 'toolCall', callId, ...meta, phase: 'start', args: b.input, agentId });
          if (isSubagentTool(name) && !this.openSubagents.has(callId)) {
            this.openSubagents.add(callId);
            const input = (b.input ?? {}) as { prompt?: unknown; description?: unknown; subagent_type?: unknown };
            this.emit({ type: 'subagent', subagentId: callId, phase: 'started', task: str(input.prompt) ?? str(input.description), agentName: str(input.subagent_type), agentId });
          }
        }
      } catch (e) {
        this.opts.onDropped?.(`assistant block ${String(b.type)}: ${e instanceof Error ? e.message : 'error'}`);
      }
    });
    const u = msg.usage;
    // Once per message.id (FR-082). A usage object with no numeric token field is not usage: no event, and the id stays unused.
    if (u && typeof u === 'object' && [u.input_tokens, u.output_tokens, u.cache_read_input_tokens].some((v) => num(v) !== undefined)) {
      const usage = this.usageToCount(id, num(u.input_tokens), num(u.output_tokens), num(u.cache_read_input_tokens));
      if (usage) this.emit({ type: 'usage', model: str(msg.model), ...usage, agentId });
    }
    if (m.aborted === true) this.emit({ type: 'status', status: 'idle', intent: 'Aborted' });
  }

  /**
   * The usage to emit for a message: all of it the first time its id is seen (and always without an id), later only the growth per
   * field over what was already counted for that id (never negative), or `undefined` when nothing grew.
   */
  private usageToCount(id: string | undefined, input?: number, output?: number, cacheRead?: number): { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } | undefined {
    if (id === undefined) return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead };
    const seen = this.usageCounted.get(id);
    if (!seen) {
      this.usageCounted.set(id, { input: input ?? 0, output: output ?? 0, cacheRead: cacheRead ?? 0 });
      if (this.usageCounted.size > USAGE_IDS_CAP) this.usageCounted.delete(this.usageCounted.keys().next().value as string);
      return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead };
    }
    const grow = (now: number | undefined, was: number): number => (now !== undefined && now > was ? now - was : 0);
    const gi = grow(input, seen.input), go = grow(output, seen.output), gc = grow(cacheRead, seen.cacheRead);
    if (!gi && !go && !gc) return undefined;
    seen.input += gi; seen.output += go; seen.cacheRead += gc;
    return { ...(gi ? { inputTokens: gi } : {}), ...(go ? { outputTokens: go } : {}), ...(gc ? { cacheReadTokens: gc } : {}) };
  }

  private user(m: ClaudeMessage, agentId: string | undefined): void {
    const content = (m.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return; // the user's own text is already shown by the renderer
    for (const b of content as ClaudeContentBlock[]) {
      if (!b || typeof b !== 'object' || b.type !== 'tool_result' || typeof b.tool_use_id !== 'string' || !b.tool_use_id) continue;
      const meta = this.tools.get(b.tool_use_id) ?? { tool: '' };
      this.tools.delete(b.tool_use_id);
      this.emit({ type: 'toolCall', callId: b.tool_use_id, ...meta, phase: b.is_error === true ? 'failed' : 'complete', output: cap(textOf(b.content)), agentId });
      // The sub-agent tool's own result closes its helper if no task_notification did.
      if (isSubagentTool(meta.tool) && this.closeSubagent(b.tool_use_id)) this.emit({ type: 'subagent', subagentId: b.tool_use_id, phase: b.is_error === true ? 'failed' : 'completed', ...(b.is_error === true ? { error: cap(textOf(b.content)) ?? 'failed' } : {}), agentId });
    }
  }

  private result(m: ClaudeMessage): void {
    // End of turn: forget per-turn stream state so the tables stay bounded.
    this.thinkingStreamed.clear();
    this.streamMessage.clear();
    // `total_cost_usd` is a running total in streaming mode: report only what is new since the last result.
    const total = num(m.total_cost_usd);
    if (total !== undefined) {
      const delta = total - this.lastCostTotal;
      this.lastCostTotal = total;
      if (delta > 0) this.emit({ type: 'usage', costUsd: delta, costBasis: 'estimate' });
    }
    const subtype = str(m.subtype) ?? 'success';
    if (subtype === 'success' && m.is_error !== true) return this.emit({ type: 'status', status: 'idle' });
    const denials = Array.isArray(m.permission_denials) ? m.permission_denials.length : 0;
    const text = subtype === 'success' ? 'error' : subtype;
    this.emit({ type: 'status', status: 'error', intent: denials ? `${text} (${denials} permission denial${denials === 1 ? '' : 's'})` : text });
  }
}
