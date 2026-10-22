/**
 * Pure mapping from Codex app-server JSON-RPC notifications (`codex app-server`, JSON-RPC 2.0 over stdio) to Agent
 * Durbar's normalized events (spec 012 plan, "Codex (codexMap.ts)"). No process, no I/O, no vendor import: it is unit-tested
 * with SYNTHETIC fixtures written from the vendor docs (`scripts/fixtures/codex/`). Nothing here was seen from a real Codex.
 *
 * Tolerant reader (FR-020): unknown notifications, unknown item types and malformed shapes produce nothing and never throw.
 * Only own properties of plain objects are read, so inherited keys (`__proto__` tricks, `Object.create`) are ignored.
 *
 * Sub-agents (FR-018): a `collabAgentToolCall` or `subAgentActivity` item becomes a `subagent` event whose `subagentId` is the
 * item id. The child thread ids it names are remembered, and later notifications of such a thread carry that id as `agentId`.
 * Notifications of a thread that is neither the main one nor a known child are ignored. Whether a real app-server routes
 * child-thread events on the parent's connection is unverified, so the adapter keeps `helpers: false` until it is recorded.
 */
import type { EventBody } from './map';
import { resetMs, usageLimitClosing } from './usagelimit';
import { isObj, nonEmptyStr as str } from '../shared/guards';
import { isMcpAuthChallenge } from './mcpauth';

/** The shape of a JSON-RPC notification as read off the wire (`id` absent). Names mirror the protocol; not a vendor type. */
export interface CodexNotification {
  method: string;
  params?: unknown;
}

type Obj = Record<string, unknown>;

/** Longest tool output kept on a `toolCall` event. */
export const CODEX_OUTPUT_CAP = 2000;
/** Longest assistant message text kept (accumulated from deltas, or taken from the completed item). */
export const CODEX_TEXT_CAP = 20000;
/** Longest `intent` of a status event. */
export const CODEX_INTENT_CAP = 300;
/** Most child threads remembered (oldest forgotten first). */
export const CODEX_CHILD_LIMIT = 256;

/** Own property only (never from the prototype chain). */
const own = (o: unknown, k: string): unknown => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const cap = (s: string): string => (s.length > CODEX_OUTPUT_CAP ? s.slice(0, CODEX_OUTPUT_CAP) : s);
const capText = (s: string): string => (s.length > CODEX_TEXT_CAP ? s.slice(0, CODEX_TEXT_CAP) : s);
const capIntent = (s: string): string => (s.length > CODEX_INTENT_CAP ? s.slice(0, CODEX_INTENT_CAP) : s);
const ownStr = (o: unknown, k: string): string | undefined => str(own(o, k));

/** `codexErrorInfo` is a string ("UsageLimitExceeded") or a one-key object ({ HttpConnectionFailed: {...} }). */
function errorKind(info: unknown): string | undefined {
  if (typeof info === 'string') return info || undefined;
  if (isObj(info)) {
    const k = Object.keys(info)[0];
    return k || undefined;
  }
  return undefined;
}

/**
 * Spec 068: from `account/rateLimits/updated` (`{ rateLimits: { primary, secondary } }`, each `{ usedPercent, windowDurationMins, resetsAt }`,
 * `read:` the app-server docs, spec 012 research): the window at 100 % that resets last (both full: wait for both), with a fixed label.
 * Nothing at 100 % -> undefined. `resetsAt` seconds or ms -> ms (resetMs).
 */
export function codexRateLimit(params: unknown, now = Date.now()): { resetsAt?: number; label: string } | undefined {
  const rl = own(params, 'rateLimits');
  let best: { resetsAt?: number; label: string } | undefined;
  for (const k of ['primary', 'secondary']) {
    const w = own(rl, k);
    const used = num(own(w, 'usedPercent'));
    if (used === undefined || used < 100) continue;
    const mins = num(own(w, 'windowDurationMins'));
    const label = mins === 300 ? '5-hour window' : mins === 10080 ? 'weekly limit' : 'usage limit';
    const resetsAt = resetMs(own(w, 'resetsAt'), now);
    if (!best || (resetsAt ?? 0) > (best.resetsAt ?? 0)) best = { ...(resetsAt ? { resetsAt } : {}), label };
  }
  return best;
}

export class CodexMapper {
  /** Spec 068: the latest used-up window seen in `account/rateLimits/updated`. */
  private rateLimit: { resetsAt?: number; label: string } | undefined;
  /** Thread id of the main agent (from `thread/started`); events without a `threadId` belong to it too. */
  private main: string | undefined;
  /** Child thread id -> id of the sub-agent item that named it. */
  private children = new Map<string, string>();
  /** Item id -> tool identity, so updates and completions carry it even when the item is partial. */
  private tools = new Map<string, { tool: string; mcpServer?: string; mcpTool?: string }>();
  /** Item id -> agentMessage text streamed so far. */
  private messages = new Map<string, string>();
  /** Item ids of reasoning that already streamed as deltas. */
  private reasoningSeen = new Set<string>();
  private cwd: string | undefined;

  constructor(private readonly emit: (body: EventBody) => void) {}

  /** The vendor session id (Codex assigns it) once `thread/started` was seen. */
  get threadId(): string | undefined {
    return this.main;
  }

  /**
   * Make `threadId` the main thread without a `thread/started` (a thread resumed on a fresh child may never announce itself;
   * without this every notification that names the thread is dropped by `route`). Emits nothing. Only when no main thread
   * is known yet: a mapper that already follows a thread is never re-pointed.
   */
  adopt(threadId: string, cwd?: string): void {
    if (this.main !== undefined || !threadId || typeof threadId !== 'string') return;
    this.main = threadId;
    this.cwd = cwd;
  }

  reset(): void {
    this.main = this.cwd = undefined;
    this.children.clear();
    this.tools.clear();
    this.messages.clear();
    this.reasoningSeen.clear();
  }

  private addChild(thread: string, item: string): void {
    this.children.delete(thread);
    if (this.children.size >= CODEX_CHILD_LIMIT) this.children.delete(this.children.keys().next().value as string);
    this.children.set(thread, item);
  }

  /**
   * `undefined` = ignore; `{ agentId }` = main agent (agentId undefined) or a known child thread.
   * Safer reading: a `threadId` that is present but not a non-empty string is malformed, so the notification is ignored; and
   * before `thread/started` no thread is known, so a notification naming one is ignored (an arbitrary thread is never adopted
   * as the main one). A notification with no `threadId` at all belongs to the main agent.
   */
  private route(params: unknown): { agentId: string | undefined } | undefined {
    if (isObj(params) && Object.prototype.hasOwnProperty.call(params, 'threadId')) {
      const tid = ownStr(params, 'threadId');
      if (tid === undefined || this.main === undefined) return undefined;
      if (tid === this.main) return { agentId: undefined };
      const child = this.children.get(tid);
      return child ? { agentId: child } : undefined;
    }
    return { agentId: undefined };
  }

  map(n: CodexNotification): void {
    if (!isObj(n)) return;
    const method = ownStr(n, 'method');
    const params = own(n, 'params');
    if (method === undefined || !isObj(params)) return;

    if (method === 'account/rateLimits/updated') {
      this.rateLimit = codexRateLimit(params); // spec 068: the window that is used up and when it resets, for a later UsageLimitExceeded
      return;
    }

    if (method === 'thread/started') {
      const thread = own(params, 'thread');
      const id = ownStr(thread, 'id') ?? ownStr(params, 'threadId');
      if (!id) return;
      if (this.main === undefined) {
        this.main = id;
        this.cwd = ownStr(thread, 'cwd');
        return this.emit({ type: 'status', status: 'idle', intent: capIntent(this.cwd ? `Ready in ${this.cwd}` : 'Ready') });
      }
      return; // a child thread starting (named by a sub-agent item) or a repeat: nothing to show
    }

    const r = this.route(params);
    if (!r) return;
    const agentId = r.agentId;

    switch (method) {
      case 'turn/started':
        return this.emit({ type: 'status', status: 'working', intent: 'Thinking', agentId });
      case 'turn/plan/updated': {
        const plan = own(params, 'plan');
        const step = Array.isArray(plan) ? plan.find((p) => ownStr(p, 'status') === 'inProgress') : undefined;
        const intent = ownStr(step, 'step');
        return intent ? this.emit({ type: 'status', status: 'working', intent: capIntent(intent), agentId }) : undefined;
      }
      case 'turn/completed':
        return this.turnCompleted(params, agentId);
      case 'item/agentMessage/delta': {
        const delta = ownStr(params, 'delta');
        if (delta === undefined) return;
        const id = ownStr(params, 'itemId');
        if (id) this.messages.set(id, capText((this.messages.get(id) ?? '') + delta));
        return this.emit({ type: 'output', delta, agentId });
      }
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        const delta = ownStr(params, 'delta') ?? ownStr(params, 'textDelta');
        const id = ownStr(params, 'itemId');
        if (delta === undefined || !id) return;
        this.reasoningSeen.add(id);
        const idx = num(own(params, method === 'item/reasoning/textDelta' ? 'contentIndex' : 'summaryIndex')) ?? 0;
        return this.emit({ type: 'thinking', delta, reasoningId: `${id}:${idx}`, agentId });
      }
      case 'item/commandExecution/outputDelta': {
        const id = ownStr(params, 'itemId');
        const delta = ownStr(params, 'delta');
        if (!id || delta === undefined) return;
        const meta = this.tools.get(id) ?? { tool: 'shell' };
        return this.emit({ type: 'toolCall', callId: id, ...meta, phase: 'update', output: cap(delta), agentId });
      }
      case 'item/started':
        return this.item(own(params, 'item'), 'started', agentId);
      case 'item/completed':
        return this.item(own(params, 'item'), 'completed', agentId);
      case 'thread/tokenUsage/updated':
        return this.usage(own(params, 'tokenUsage'), agentId);
      default:
        return; // warning, configWarning, model/rerouted, account/*, mcpServer/*, hook/*, unknown: ignored (FR-020)
    }
  }

  private turnCompleted(params: Obj, agentId: string | undefined): void {
    if (agentId === undefined) {
      // The main turn is over: nothing of it can still update, so drop what was kept for it.
      this.messages.clear();
      this.reasoningSeen.clear();
      this.tools.clear();
    }
    const turn = own(params, 'turn');
    const status = ownStr(turn, 'status');
    if (status === 'completed') return this.emit({ type: 'status', status: 'idle', agentId });
    if (status === 'interrupted') return this.emit({ type: 'status', status: 'idle', intent: 'Aborted', agentId });
    if (status === 'failed') {
      const err = own(turn, 'error');
      const kind = errorKind(own(err, 'codexErrorInfo'));
      const message = ownStr(err, 'message');
      if (kind === 'UsageLimitExceeded' && !agentId) {
        // spec 068 FR-002: the plan's usage window is used up: a coffee break (with the reset time from the last rate-limit update), not an error
        const rl = this.rateLimit;
        const at = rl?.resetsAt && rl.resetsAt > Date.now() ? rl.resetsAt : undefined; // a window update read long ago may have reset already: unknown
        this.emit({ type: 'usageLimit', scope: 'plan', ...(at ? { resetsAt: at } : {}), source: `Codex ${rl?.label ?? 'usage limit'}` });
        return this.emit(usageLimitClosing());
      }
      const text = kind === 'UsageLimitExceeded' ? 'Codex usage limit reached' : kind && message ? `${kind}: ${message}` : (kind ?? message ?? 'Turn failed');
      return this.emit({ type: 'status', status: 'error', intent: capIntent(text), agentId });
    }
  }

  private usage(tu: unknown, agentId: string | undefined): void {
    const last = own(tu, 'last');
    if (!isObj(last)) return;
    const input = num(own(last, 'inputTokens'));
    const output = num(own(last, 'outputTokens'));
    const cached = num(own(last, 'cachedInputTokens'));
    if (input === undefined && output === undefined && cached === undefined) return; // nothing countable: not a model call
    // Codex reports tokens only: no credits (nanoAiu) and no money (costUsd).
    this.emit({ type: 'usage', agentId, inputTokens: input, outputTokens: output, cacheReadTokens: cached });
    if (input !== undefined) this.emit({ type: 'context', agentId, tokens: input, limit: num(own(tu, 'modelContextWindow')) ?? 0 });
  }

  private item(item: unknown, phase: 'started' | 'completed', agentId: string | undefined): void {
    const type = ownStr(item, 'type');
    const id = ownStr(item, 'id');
    if (!type || !id) return;
    const done = phase === 'completed';
    const status = ownStr(item, 'status');
    const exit = own(item, 'exitCode');
    const failed = status === 'failed' || status === 'declined' || (type === 'commandExecution' && done && typeof exit === 'number' && exit !== 0);
    const call = (meta: { tool: string; mcpServer?: string; mcpTool?: string }, args?: unknown, output?: string, mcpAuth?: true): void => {
      if (!done) this.tools.set(id, meta);
      else this.tools.delete(id);
      this.emit({ type: 'toolCall', callId: id, ...meta, phase: done ? (failed ? 'failed' : 'complete') : 'start', ...(done ? {} : { args }), ...(done && output ? { output: cap(output) } : {}), ...(done && failed && mcpAuth && meta.mcpServer ? { mcpAuth } : {}), agentId });
    };

    switch (type) {
      case 'agentMessage': {
        if (!done) return;
        const text = ownStr(item, 'text') ?? this.messages.get(id);
        this.messages.delete(id);
        if (text) this.emit({ type: 'output', delta: '', final: true, text: capText(text), agentId });
        return;
      }
      case 'reasoning': {
        // Complete reasoning item: show it whole only when no delta streamed for it.
        if (!done || this.reasoningSeen.delete(id)) return;
        const summary = own(item, 'summary');
        const text = Array.isArray(summary) ? summary.filter((s) => typeof s === 'string' && s).join('\n') : undefined;
        if (text) this.emit({ type: 'thinking', delta: text, reasoningId: `${id}:0`, agentId });
        return;
      }
      case 'commandExecution': {
        const output = status === 'declined' ? 'declined' : ownStr(item, 'aggregatedOutput');
        return call({ tool: 'shell' }, { command: ownStr(item, 'command'), cwd: ownStr(item, 'cwd') }, output);
      }
      case 'fileChange': {
        const changes = own(item, 'changes');
        const files = (Array.isArray(changes) ? changes : []).map((c) => ownStr(c, 'path')).filter((p): p is string => !!p);
        const output = status === 'declined' ? 'declined' : files.length ? `${files.length} file${files.length === 1 ? '' : 's'} changed` : undefined;
        return call({ tool: 'apply_patch' }, { files }, output);
      }
      case 'mcpToolCall': {
        const server = ownStr(item, 'server');
        const tool = ownStr(item, 'tool');
        const meta = server && tool ? { tool: `${server}.${tool}`, mcpServer: server, mcpTool: tool } : { tool: tool ?? 'mcp' };
        const result = own(item, 'result');
        const content = own(result, 'content');
        const text = Array.isArray(content) ? content.map((c) => ownStr(c, 'text')).filter(Boolean).join('\n') : undefined;
        const output = failed ? (ownStr(own(item, 'error'), 'message') ?? 'failed') : text;
        // Spec 058 FR-060: a failed MCP call whose error is the server's OAuth challenge says "sign in" (the adapter refreshes the list)
        return call(meta, own(item, 'arguments'), output, failed && isMcpAuthChallenge(output) ? true : undefined);
      }
      case 'dynamicToolCall':
        return call({ tool: ownStr(item, 'tool') ?? type }, own(item, 'arguments'));
      case 'webSearch':
        return call({ tool: type }, { query: ownStr(item, 'query') });
      case 'imageView':
        return call({ tool: type }, { path: ownStr(item, 'path') });
      case 'collabAgentToolCall': {
        // FR-149 (real, Codex 0.163): `wait`, `send_input`, `close_agent` and the like coordinate helpers; only a spawn is one
        if (!/spawn/i.test(ownStr(item, 'tool') ?? '')) return;
        const receivers = own(item, 'receiverThreadIds');
        if (Array.isArray(receivers)) for (const t of receivers) if (typeof t === 'string' && t) this.addChild(t, id);
        return this.subagent(id, phase, status, { task: ownStr(item, 'prompt'), model: ownStr(item, 'model'), agentName: ownStr(item, 'tool'), error: ownStr(own(item, 'error'), 'message') }, agentId);
      }
      case 'subAgentActivity': {
        // FR-149 (real, Codex 0.163): one item per activity (`kind` started | completed, each with its own id, opened and closed at
        // once); the helper is the agent thread. Key by `agentThreadId`, act once per kind, name it by the last part of `agentPath`.
        const t = ownStr(item, 'agentThreadId') ?? id;
        const kind = ownStr(item, 'kind');
        const path = ownStr(item, 'agentPath');
        const f = { model: ownStr(item, 'model'), agentName: path ? path.split('/').filter(Boolean).pop() ?? path : undefined, error: ownStr(own(item, 'error'), 'message') };
        if (kind === 'started' && !this.helpersStarted.has(t)) {
          this.helpersStarted.add(t);
          if (this.helpersStarted.size > CODEX_CHILD_LIMIT) this.helpersStarted.delete(this.helpersStarted.values().next().value as string);
          this.addChild(t, t);
          return this.subagent(t, 'started', undefined, f, agentId);
        }
        if ((kind === 'completed' || kind === 'failed' || kind === 'errored' || status === 'failed') && phase === 'completed' && !this.helpersDone.has(t)) {
          this.helpersDone.add(t);
          if (this.helpersDone.size > CODEX_CHILD_LIMIT) this.helpersDone.delete(this.helpersDone.values().next().value as string);
          return this.subagent(t, 'completed', kind === 'completed' && status !== 'failed' ? undefined : 'failed', f, agentId);
        }
        return;
      }
      default:
        return; // userMessage, plan, contextCompaction, review items, unknown
    }
  }

  /** FR-149: helper threads already announced as started / ended (bounded by the session). */
  private helpersStarted = new Set<string>();
  private helpersDone = new Set<string>();

  private subagent(id: string, phase: 'started' | 'completed', status: string | undefined, f: { task?: string; model?: string; agentName?: string; error?: string }, agentId: string | undefined): void {
    const p = phase === 'started' ? 'started' : status === 'failed' ? 'failed' : 'completed';
    const { error, ...rest } = f;
    this.emit({ type: 'subagent', subagentId: id, phase: p, ...rest, ...(p === 'failed' && error ? { error: capIntent(error) } : {}), agentId });
  }
}
