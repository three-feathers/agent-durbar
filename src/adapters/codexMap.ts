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
import { codexEdit } from './edits';
import type { EventBody } from './map';
import type { EditInfo } from './types';
import { resetMs, usageLimitClosing } from './usagelimit';
import { isObj, nonEmptyStr as str } from '../shared/guards';
import { isMcpAuthChallenge } from './mcpauth';
import { RetryTracker, codexRetry } from './retry';
import { isAuthError } from './autherrors';

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
/** Open fileChange items started from a streamed patch, kept at most (oldest dropped first). */
const CODEX_TOOLS_LIMIT = 256;

/** Own property only (never from the prototype chain). */
const own = (o: unknown, k: string): unknown => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const cap = (s: string): string => (s.length > CODEX_OUTPUT_CAP ? s.slice(0, CODEX_OUTPUT_CAP) : s);
const capText = (s: string): string => (s.length > CODEX_TEXT_CAP ? s.slice(0, CODEX_TEXT_CAP) : s);
const capIntent = (s: string): string => (s.length > CODEX_INTENT_CAP ? s.slice(0, CODEX_INTENT_CAP) : s);
const ownStr = (o: unknown, k: string): string | undefined => str(own(o, k));

/** Spec 068 FR-002 (#646): the usage-limit kind in either spelling ("usageLimitExceeded" is the protocol's, "UsageLimitExceeded" an older one). */
const isUsageLimitKind = (kind: string | undefined): boolean => !!kind && kind.charAt(0).toLowerCase() + kind.slice(1) === 'usageLimitExceeded';

/** `codexErrorInfo` is a string (the protocol spells it "usageLimitExceeded") or a one-key object ({ httpConnectionFailed: {...} }). The first letter's case differs between sources, so compare with `isUsageLimitKind`. */
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
  /** Spec 005 FR-019: fileChange items that already started from `item/fileChange/patchUpdated`. */
  private patching = new Set<string>();
  private cwd: string | undefined;
  /** Spec 034 FR-017: the main agent's model-call retries in this turn (`error` with `willRetry`). */
  private retries = new RetryTracker();

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
    this.compacting = false;
    this.main = this.cwd = undefined;
    this.children.clear();
    this.tools.clear();
    this.messages.clear();
    this.reasoningSeen.clear();
    this.patching.clear();
    this.retries.reset();
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
    // spec 034 FR-017: anything the model streams or starts for the main agent means the retried call went through
    if (!agentId && method.startsWith('item/')) this.retries.progress(); // not usage: a failed turn can report tokens too

    switch (method) {
      case 'error': {
        // spec 034 FR-017: Codex retries the request by itself (`willRetry: true`); a fixed reason and the status only, never the message
        const info = agentId ? null : codexRetry(params);
        if (info) this.emit(this.retries.retry(info));
        return;
      }
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
      case 'item/fileChange/patchUpdated': {
        // Spec 005 FR-019: the patch as the model writes it (generated types, codex-cli 0.163.0); the row starts at the first one
        const id = ownStr(params, 'itemId');
        const edit = codexEdit(own(params, 'changes'), true);
        if (!id || !edit) return;
        if (!this.tools.has(id)) {
          if (this.tools.size >= CODEX_TOOLS_LIMIT) this.tools.delete(this.tools.keys().next().value as string);
          this.tools.set(id, { tool: 'apply_patch' });
          if (this.patching.size >= CODEX_TOOLS_LIMIT) this.patching.delete(this.patching.values().next().value as string);
          this.patching.add(id);
          this.emit({ type: 'toolCall', callId: id, tool: 'apply_patch', phase: 'start', args: { files: edit.files.map((f) => f.path) }, agentId });
        }
        return this.emit({ type: 'toolCall', callId: id, tool: 'apply_patch', phase: 'update', edit, agentId });
      }
      case 'thread/tokenUsage/updated':
        return this.usage(own(params, 'tokenUsage'), agentId);
      default:
        return; // warning, configWarning, model/rerouted, account/*, mcpServer/*, hook/*, unknown: ignored (FR-020)
    }
  }

  private turnCompleted(params: Obj, agentId: string | undefined): void {
    if (agentId === undefined) {
      if (this.compacting) {
        this.compacting = false;
        this.emit({ type: 'compaction', phase: 'failed', trigger: 'unknown' }); // an open compaction at the turn's end did not finish
      }
      // The main turn is over: nothing of it can still update, so drop what was kept for it.
      this.messages.clear();
      this.reasoningSeen.clear();
      this.tools.clear();
      this.patching.clear();
    }
    const turn = own(params, 'turn');
    const status = ownStr(turn, 'status');
    // spec 034 FR-017: not at a usage limit and not at a sign-in failure (the error text the adapter marks as one, markAuthError)
    const failRaw = errorKind(own(own(turn, 'error'), 'codexErrorInfo'));
    const failMsg = ownStr(own(turn, 'error'), 'message');
    const failKind = failRaw?.toLowerCase();
    const failAuth = isAuthError(failRaw && failMsg ? `${failRaw}: ${failMsg}` : (failRaw ?? failMsg)); // the same text the adapter marks (markAuthError on the intent)
    const gaveUp = agentId === undefined && status === 'failed' && failKind !== 'usagelimitexceeded' && !failAuth ? this.retries.gaveUp() : undefined;
    if (agentId === undefined) this.retries.reset();
    if (gaveUp) this.emit(gaveUp); // a turn that failed after a retry gave up (not at a usage limit)
    if (status === 'completed') return this.emit({ type: 'status', status: 'idle', agentId });
    if (status === 'interrupted') return this.emit({ type: 'status', status: 'idle', intent: 'Aborted', agentId });
    if (status === 'failed') {
      const err = own(turn, 'error');
      const kind = errorKind(own(err, 'codexErrorInfo'));
      const message = ownStr(err, 'message');
      if (isUsageLimitKind(kind) && !agentId) {
        // spec 068 FR-002: the plan's usage window is used up: a coffee break (with the reset time from the last rate-limit update), not an error
        const rl = this.rateLimit;
        const at = rl?.resetsAt && rl.resetsAt > Date.now() ? rl.resetsAt : undefined; // a window update read long ago may have reset already: unknown
        this.emit({ type: 'usageLimit', scope: 'plan', ...(at ? { resetsAt: at } : {}), source: `Codex ${rl?.label ?? 'usage limit'}` });
        return this.emit(usageLimitClosing());
      }
      const text = isUsageLimitKind(kind) ? 'Codex usage limit reached' : kind && message ? `${kind}: ${message}` : (kind ?? message ?? 'Turn failed');
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
    const call = (meta: { tool: string; mcpServer?: string; mcpTool?: string }, args?: unknown, output?: string, edit?: EditInfo, mcpAuth?: true): void => {
      // FR-019: a fileChange that already started from its streamed patch gets its start as an update (no second row)
      const early = this.patching.has(id);
      if (!done) this.tools.set(id, meta);
      else {
        this.tools.delete(id);
        this.patching.delete(id);
      }
      this.emit({ type: 'toolCall', callId: id, ...meta, phase: done ? (failed ? 'failed' : 'complete') : early ? 'update' : 'start', ...(done ? {} : { args }), ...(done && output ? { output: cap(output) } : {}), ...(done && failed && mcpAuth && meta.mcpServer ? { mcpAuth } : {}), ...(edit ? { edit } : {}), agentId });
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
        return call({ tool: 'apply_patch' }, { files }, output, codexEdit(changes));
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
        return call(meta, own(item, 'arguments'), output, undefined, failed && isMcpAuthChallenge(output) ? true : undefined);
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
      case 'contextCompaction': {
        // spec 015 FR-008 (issue #601, `read:`): the app-server summarises the thread; the main agent only. The item has no numbers.
        if (agentId) return;
        if (!done) {
          if (this.compacting) return;
          this.compacting = true;
          return this.emit({ type: 'compaction', phase: 'start', trigger: 'unknown' });
        }
        this.compacting = false;
        return this.emit({ type: 'compaction', phase: 'complete', trigger: 'unknown' });
      }
      default:
        return; // userMessage, plan, review items, unknown
    }
  }

  /** Spec 015 FR-008: a context compaction of the main thread is open (ended by its completed item, or failed at the turn's end). */
  private compacting = false;

  /** FR-149: helper threads already announced as started / ended (bounded by the session). */
  private helpersStarted = new Set<string>();
  private helpersDone = new Set<string>();

  private subagent(id: string, phase: 'started' | 'completed', status: string | undefined, f: { task?: string; model?: string; agentName?: string; error?: string }, agentId: string | undefined): void {
    const p = phase === 'started' ? 'started' : status === 'failed' ? 'failed' : 'completed';
    const { error, ...rest } = f;
    this.emit({ type: 'subagent', subagentId: id, phase: p, ...rest, ...(p === 'failed' && error ? { error: capIntent(error) } : {}), agentId });
  }
}
