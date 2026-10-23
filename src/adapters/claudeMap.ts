/**
 * Pure mapping from Claude Agent SDK stream messages (`SDKMessage`) to Agent Durbar's normalized events (spec 012, FR-014,
 * FR-018, FR-020). No SDK import (the dependency is task T040 and needs the owner's approval): the types below mirror the
 * shapes in specs/012-claude-codex-adapters/research.md section 2.2, which come from the SDK docs and are NOT yet checked
 * against a real run. Every field is read defensively; unknown message types and fields are ignored, never fatal.
 * Same pattern as `EventMapper` in map.ts: stateful, emits event bodies (the adapter adds `sessionId` and `timestamp`).
 * Needs the SDK options `includePartialMessages: true` and `forwardSubagentText: true`.
 */
import { isAuthError } from './autherrors';
import { isMcpAuthChallenge } from './mcpauth';
import { resetMs, usageLimitClosing } from './usagelimit';
import { RetryTracker, claudeRetry } from './retry';
import type { EventBody } from './map';
import type { McpServerStatus } from './types';
import { nonEmptyStr as str } from '../shared/guards';
import { EditStreams, editOf } from './edits';

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
  cache_creation_input_tokens?: number;
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

/** Claude's MCP server list (`init.mcp_servers`, or the `mcp_status` reply's `mcpServers`) in the normalized shape. */
export function claudeMcpServers(list: unknown): McpServerStatus[] {
  const servers: McpServerStatus[] = [];
  for (const s of Array.isArray(list) ? list.slice(0, 100) : []) {
    const name = str((s as { name?: unknown })?.name);
    if (!name) continue;
    const source = str((s as { source?: unknown }).source);
    const error = str((s as { error?: unknown }).error);
    const status = str((s as { status?: unknown }).status) ?? 'pending';
    // Spec 058 FR-091: `config.type` (`stdio`, `sse`, `http`, ...) is the transport, only as a plain word; never inferred from other keys
    const cfg = (s as { config?: unknown }).config;
    const type = cfg && typeof cfg === 'object' ? str((cfg as { type?: unknown }).type) : undefined;
    const transport = type && /^[a-z][a-z0-9_-]{0,19}$/.test(type) ? type : undefined;
    // Spec 058 FR-060: the CLI reports a remote server that answered 401/403 as `needs-auth` (read: SDK docs; research)
    servers.push({ name, status, ...(source ? { source } : {}), ...(transport ? { transport } : {}), ...(error ? { error: error.slice(0, 300) } : {}), ...(status === 'needs-auth' ? { errorClass: 'auth' as const } : {}) });
  }
  return servers;
}

/**
 * Spec 058 FR-091 (T024, issue #603): `system/init.mcp_server_errors` (`[{name, type, message}]`: "MCP server config entries from
 * --mcp-config that failed validation and were skipped"; read: CLI 2.1.309 schema) as `failed` rows with `errorClass: 'config'`.
 * Names already in the CLI's list are not repeated.
 */
export function claudeMcpServerErrors(list: unknown, listed: readonly string[]): McpServerStatus[] {
  const out: McpServerStatus[] = [];
  const seen = new Set(listed);
  for (const e of Array.isArray(list) ? list : []) {
    if (out.length >= 100) break;
    const name = str((e as { name?: unknown } | null)?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const message = str((e as { message?: unknown }).message);
    out.push({ name, status: 'failed', errorClass: 'config', ...(message ? { error: message.slice(0, 300) } : {}) });
  }
  return out;
}

/** A later `mcp_status` list does not name the servers skipped at launch: keep them, unless the CLI now lists that name. */
export function withSkipped(list: McpServerStatus[], skipped: readonly McpServerStatus[]): McpServerStatus[] {
  if (!skipped.length) return list;
  const names = new Set(list.map((x) => x.name));
  return [...list, ...skipped.filter((x) => !names.has(x.name))];
}

export class ClaudeMapper {
  /** Configured MCP server names from `system/init`. */
  private servers: string[] = [];
  /** Spec 058 FR-091: servers the CLI skipped at launch (`init.mcp_server_errors`), as failed rows; read by the adapter for later lists. */
  skipped: McpServerStatus[] = [];
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
  /** Spec 005 FR-019: streamed arguments of file-changing tool_use blocks, and stream block index -> tool_use id per stream. */
  private edits = new EditStreams();
  private blockIds = new Map<string, string>();
  /** Running `total_cost_usd` already reported (streaming mode: the SDK sends totals, Durbar wants per-call amounts). */
  private lastCostTotal = 0;
  /** Per assistant message id, the usage already emitted (the most recent USAGE_IDS_CAP ids, oldest dropped first; FR-082). */
  private usageCounted = new Map<string, { input: number; output: number; cacheRead: number }>();
  /** FR-134: context windows per model from the latest `result`'s `modelUsage`, and the main agent's last message size. */
  private windows = new Map<string, number>();
  private lastCtx: { tokens: number; model?: string; sent?: string } | undefined;
  /** What `system/init` reported (read by the adapter). */
  info: ClaudeSessionInfo = {};

  /** `quiet`: do not emit the "Ready" status on init (the session is started for a message that is about to be sent). */
  constructor(private readonly emit: (body: EventBody) => void, private readonly opts: { quiet?: boolean; /** Called when a message or block was skipped because it was malformed or threw (not for unknown types, which are ignored on purpose). */ onDropped?: (reason: string) => void } = {}) {}

  /** Sizes of the internal tables (tests assert they stay bounded). */
  stats(): { tools: number; tasks: number; openSubagents: number; streamMessage: number; thinkingStreamed: number } {
    return { tools: this.tools.size, tasks: this.tasks.size, openSubagents: this.openSubagents.size, streamMessage: this.streamMessage.size, thinkingStreamed: this.thinkingStreamed.size };
  }

  /** The adapter asked the CLI to interrupt: the turn's closing `error_during_execution` result is an abort, not an error (seen on a real run, spec 012 T094). */
  private abortExpected = false;
  /** FR-157: an assistant message of this turn carried Claude's `error: authentication_failed`. */
  private authFailed = false;
  /** Spec 034 FR-017: the main agent's model-call retries in this turn (`api_retry`). */
  private retries = new RetryTracker();
  /** Spec 068: this turn reported a usage limit; its closing error result ends the turn quietly (the coffee break says why). */
  private limited = false;
  expectAbort(): void {
    this.abortExpected = true;
  }

  reset(): void {
    this.abortExpected = false;
    this.limited = false;
    this.servers = [];
    this.skipped = [];
    this.tools.clear();
    this.tasks.clear();
    this.openSubagents.clear();
    this.streamMessage.clear();
    this.thinkingStreamed.clear();
    this.edits.clear();
    this.blockIds.clear();
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
        if (!agentId) this.retries.progress(); // spec 034 FR-017: the model answered, so a retry went through
        return this.stream(m, agentId);
      case 'assistant':
        if (!agentId) this.retries.progress();
        if (!agentId && claudeAuthFailure(m)) this.authFailed = true;
        return this.assistant(m, agentId);
      case 'user':
        return this.user(m, agentId);
      case 'result':
        return this.result(m);
      case 'rate_limit_event': {
        // spec 068 FR-002: a usage window that is used up (`rejected`) or `credits_required` puts the agent on a coffee break
        const lim = claudeUsageLimit(m);
        if (lim && !this.limited) {
          this.limited = true;
          this.emit(lim);
        }
        return;
      }
      default:
        return;
    }
  }

  private system(m: ClaudeMessage): void {
    switch (m.subtype) {
      case 'api_retry': {
        // spec 034 FR-017: Claude Code retries a failed API call by itself; a fixed reason and numbers only (never the provider's text)
        const info = this.who(m) ? null : claudeRetry(m); // a helper's retry is not shown (main agent only)
        if (info) this.emit(this.retries.retry(info));
        return;
      }
      case 'init': {
        const listed = claudeMcpServers(m.mcp_servers);
        this.servers = listed.map((s) => s.name);
        this.skipped = claudeMcpServerErrors(m.mcp_server_errors, this.servers);
        const servers = withSkipped(listed, this.skipped);
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
        // task_progress (no `update` phase exists for sub-agents in v1), status, compact_boundary, hooks...: ignored.
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
    const ev = m.event as { type?: string; index?: number; message?: { id?: string }; content_block?: { type?: string; id?: unknown; name?: unknown }; delta?: { type?: string; text?: unknown; thinking?: unknown; partial_json?: unknown } } | undefined;
    if (!ev || typeof ev !== 'object') return;
    const key = agentId ?? '';
    if (ev.type === 'message_start') {
      const id = str(ev.message?.id);
      if (id) this.streamMessage.set(key, id);
      for (const k of this.blockIds.keys()) if (k.startsWith(key + '\u0000')) this.blockIds.delete(k);
      return;
    }
    // Spec 005 FR-019: a file-changing tool_use streams its arguments; the call starts as soon as they name the file
    if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') {
      const id = str(ev.content_block.id);
      const name = str(ev.content_block.name);
      if (id && name && num(ev.index) !== undefined) {
        if (this.blockIds.size >= 64) this.blockIds.delete(this.blockIds.keys().next().value as string);
        this.blockIds.set(`${key}\u0000${ev.index}`, id);
        this.edits.begin(id, name);
      }
      return;
    }
    if (ev.type !== 'content_block_delta' || !ev.delta || typeof ev.delta !== 'object') return;
    if (ev.delta.type === 'input_json_delta') {
      const id = this.blockIds.get(`${key}\u0000${num(ev.index) ?? -1}`);
      const part = typeof ev.delta.partial_json === 'string' ? ev.delta.partial_json : '';
      if (!id || !part || !this.edits.toolOf(id)) return; // only file-changing tools are streamed
      for (const step of this.edits.delta(id, part)) {
        if (step.phase === 'start') {
          const tool = this.edits.toolOf(id) ?? '';
          this.tools.set(id, { tool });
          this.emit({ type: 'toolCall', callId: id, tool, phase: 'start', args: step.args, agentId });
        } else this.emit({ type: 'toolCall', callId: id, ...(this.tools.get(id) ?? { tool: '' }), phase: 'update', edit: step.edit, agentId });
      }
      return;
    }
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
          const edit = editOf(name, b.input);
          // FR-019: a call that already started from its streamed arguments gets its whole arguments as an update (no second row)
          const early = this.edits.takeStarted(callId);
          this.emit({ type: 'toolCall', callId, ...meta, phase: early ? 'update' : 'start', args: b.input, ...(edit ? { edit } : {}), agentId });
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
    if (u && typeof u === 'object' && [u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens].some((v) => num(v) !== undefined)) {
      // FR-124: all input of the call, as the other adapters count it; Claude reports cache writes and reads apart from `input_tokens`
      const parts = [num(u.input_tokens), num(u.cache_creation_input_tokens), num(u.cache_read_input_tokens)];
      const input = parts.some((v) => v !== undefined) ? parts.reduce<number>((s, v) => s + (v ?? 0), 0) : undefined;
      const usage = this.usageToCount(id, input, num(u.output_tokens), num(u.cache_read_input_tokens));
      if (usage) this.emit({ type: 'usage', model: str(msg.model), ...usage, agentId });
      // FR-134: the main agent's whole prompt plus its reply is what the context holds now (helpers have their own)
      if (agentId === undefined && input !== undefined) {
        this.lastCtx = { tokens: input + (num(u.output_tokens) ?? 0), model: str(msg.model), sent: this.lastCtx?.sent };
        this.emitContext();
      }
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
      const text = textOf(b.content);
      // Spec 058 FR-060/FR-063: judge the whole text before the output cut, only for a failed MCP tool call
      const mcpAuth = b.is_error === true && !!meta.mcpServer && isMcpAuthChallenge(text);
      this.emit({ type: 'toolCall', callId: b.tool_use_id, ...meta, phase: b.is_error === true ? 'failed' : 'complete', output: cap(text), ...(mcpAuth ? { mcpAuth: true as const } : {}), agentId });
      // The sub-agent tool's own result closes its helper if no task_notification did.
      if (isSubagentTool(meta.tool) && this.closeSubagent(b.tool_use_id)) this.emit({ type: 'subagent', subagentId: b.tool_use_id, phase: b.is_error === true ? 'failed' : 'completed', ...(b.is_error === true ? { error: cap(textOf(b.content)) ?? 'failed' } : {}), agentId });
    }
  }

  /** FR-134: one `context` event per change, once the window of the model is known (from a `result`). */
  private emitContext(): void {
    const c = this.lastCtx;
    if (!c) return;
    const limit = (c.model !== undefined ? this.windows.get(c.model) : undefined) ?? Math.max(0, ...this.windows.values());
    if (!limit) return;
    const key = `${c.tokens}/${limit}`;
    if (c.sent === key) return;
    c.sent = key;
    this.emit({ type: 'context', tokens: c.tokens, limit, ...(c.model ? { model: c.model } : {}) });
  }

  private result(m: ClaudeMessage): void {
    // End of turn: forget per-turn stream state so the tables stay bounded.
    this.thinkingStreamed.clear();
    this.edits.clear();
    this.blockIds.clear();
    this.streamMessage.clear();
    const mu = m.modelUsage;
    if (mu && typeof mu === 'object') {
      for (const [model, v] of Object.entries(mu as Record<string, unknown>).slice(0, 20)) {
        const w = v && typeof v === 'object' ? num((v as Record<string, unknown>).contextWindow) : undefined;
        if (w !== undefined && w > 0 && w < 1e9) this.windows.set(model, Math.round(w));
      }
      this.emitContext();
    }
    // `total_cost_usd` is a running total in streaming mode: report only what is new since the last result.
    const total = num(m.total_cost_usd);
    if (total !== undefined) {
      const delta = total - this.lastCostTotal;
      this.lastCostTotal = total;
      if (delta > 0) this.emit({ type: 'usage', costUsd: delta, costBasis: 'estimate' });
    }
    const subtype = str(m.subtype) ?? 'success';
    const aborted = this.abortExpected;
    this.abortExpected = false;
    // FR-157: "Failed to authenticate. API Error: 401 …", "Invalid API key · Please run /login": the sign-in, not the turn, failed.
    // The text of a turn that ended well is never read (an answer may well talk about a 401); Claude's own error marker is.
    const auth = this.authFailed || ((subtype !== 'success' || m.is_error === true) && isAuthError(m.result));
    this.authFailed = false;
    const limited = this.limited;
    this.limited = false;
    // spec 034 FR-017: the turn's retry run ends here; it is emitted only on the plain error path below (a usage limit, an abort and a
    // sign-in failure return before it, so they never "gave up")
    const gaveUp = this.retries.gaveUp();
    if (!auth && subtype === 'success' && m.is_error !== true) return this.emit({ type: 'status', status: 'idle' });
    if (!auth && limited) return this.emit(usageLimitClosing());
    if (!auth && aborted && subtype === 'error_during_execution') return; // the adapter already reported "Aborted"
    if (auth) return this.emit({ type: 'status', status: 'error', intent: (str(m.result) ?? 'Claude Code could not authenticate.').replace(/\s+/g, ' ').slice(0, 300), errorKind: 'auth' });
    if (gaveUp) this.emit(gaveUp);
    const denials = Array.isArray(m.permission_denials) ? m.permission_denials.length : 0;
    const text = subtype === 'success' ? 'error' : subtype;
    this.emit({ type: 'status', status: 'error', intent: denials ? `${text} (${denials} permission denial${denials === 1 ? '' : 's'})` : text });
  }
}

/** Spec 068: the fixed labels a Claude usage window may get (never the provider's own text). */
const CLAUDE_WINDOWS: Record<string, string> = { five_hour: '5-hour window', seven_day: 'weekly limit', seven_day_opus: 'weekly Opus limit', seven_day_sonnet: 'weekly Sonnet limit', overage: 'extra usage' };

/**
 * Spec 068 FR-002: a `rate_limit_event` that means the turn cannot go on: `rate_limit_info.status === 'rejected'` (a usage window is
 * used up) or `errorCode: 'credits_required'` (extra usage needs credits: paid). `resetsAt` may be seconds or ms. `allowed` and
 * `allowed_warning` are information only (null). `read:` the field names come from the SDK docs (spec 012 research), not a real run.
 */
export function claudeUsageLimit(m: ClaudeMessage, now = Date.now()): (EventBody & { type: 'usageLimit' }) | null {
  const info = (m.rate_limit_info && typeof m.rate_limit_info === 'object' ? m.rate_limit_info : m) as Record<string, unknown>;
  const credits = info.errorCode === 'credits_required' || m.errorCode === 'credits_required';
  if (!credits && info.status !== 'rejected') return null;
  const kind = typeof info.rateLimitType === 'string' && Object.prototype.hasOwnProperty.call(CLAUDE_WINDOWS, info.rateLimitType) ? CLAUDE_WINDOWS[info.rateLimitType] : undefined;
  const resetsAt = resetMs(info.resetsAt, now);
  return {
    type: 'usageLimit',
    scope: credits ? 'quota' : 'plan',
    ...(resetsAt ? { resetsAt } : {}),
    ...(credits ? { paid: true } : {}),
    source: credits ? 'Claude extra usage' : `Claude ${kind ?? 'usage limit'}`,
  };
}

/**
 * FR-157: an assistant message that is Claude Code's own sign-in error, not the model's words: it carries `error`
 * (`authentication_failed`) or it is a synthetic message (no model call happened) whose text reads like a sign-in failure.
 */
export function claudeAuthFailure(m: ClaudeMessage): boolean {
  if (typeof m.error === 'string' && /auth/i.test(m.error)) return true;
  const msg = m.message as { model?: unknown; content?: unknown } | undefined;
  if (!msg || msg.model !== '<synthetic>' || !Array.isArray(msg.content)) return false;
  return msg.content.some((b) => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && isAuthError((b as { text?: unknown }).text));
}
