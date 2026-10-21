/**
 * Scripted, in-memory fake of `codex app-server` (spec 012 FR-098, T043a). No process, no network, no Codex: a fake `RpcChild`
 * handed to the adapter through its injected `spawn`, so it behaves the same on Windows, macOS and Linux. It speaks
 * line-delimited JSON-RPC like the server described in research.md, and records every spawn, request and reply so tests can
 * assert what the adapter sent. Fixtures replayed through it are SYNTHETIC (`scripts/fixtures/codex/`); nothing here claims to be recorded.
 */
import { EventEmitter } from 'events';
import type { RpcChild, SpawnFn, SpawnOptions } from '../../src/adapters/codexRpc';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface FakeCodexOptions {
  /** `ok` (default); `error`: answer `initialize` with an error; `refuse-experimental`: error only when `capabilities.experimentalApi` is sent; `no-answer`: never answer. */
  initialize?: 'ok' | 'error' | 'refuse-experimental' | 'no-answer';
  /** Answer `thread/start` with an error when it carries `permissions` (what an old Codex or Windows without the elevated sandbox does). */
  refusePermissions?: boolean;
  /** Fixture notifications replayed on every `turn/start` (a `thread/started` for the main thread is dropped: `thread/start` already sent one). */
  turnScript?: Array<{ method: string; params?: unknown }>;
  /** Leave the turn running after the script: it ends on `turn/interrupt` or `finishTurn()`. */
  holdTurn?: boolean;
  /** Deliver the whole turn (including `turn/completed`) before the `turn/start` response, to test the ordering race. */
  completeBeforeResponse?: boolean;
  /** Text of the error `thread/start` answers with when it refuses `permissions` (default a short one). */
  threadStartError?: string;
  /** What `thread/resume` reports as `sandbox` (default `{type: 'readOnly'}`, as real Codex 0.163 does in the read-limited profile). */
  resumeSandbox?: unknown;
  /** Text of the `initialize` error. */
  initializeErrorText?: string;
  /** Withhold the `turn/start` response and the turn's notifications until `releaseTurnStart()` (the id is unknown to the adapter meanwhile). */
  holdTurnStart?: boolean;
  /** Withhold the `initialize` answer until `releaseInitialize()`. */
  holdInitialize?: boolean;
  /**
   * Spec 012 FR-156: how `account/rateLimits/read` answers: `ok` (default, a rate-limit snapshot), `unauthorized` (an auth error),
   * `network` (another error), `missing` (method not found, an older Codex).
   */
  rateLimits?: 'ok' | 'unauthorized' | 'network' | 'missing';
  /** What `getAuthStatus` reports as `authMethod` (default `chatgpt`; null = not signed in). */
  authMethod?: string | null;
  /** spec 059: answer `thread/name/set` with this error message. */
  refuseRename?: string;
  /** Exit (no answer) when a request with this method arrives. */
  exitOn?: { method: string; code?: number | null; signal?: NodeJS.Signals | null };
}

export interface Spawned {
  file: string;
  args: string[];
  options: SpawnOptions;
  child: FakeChild;
}

export interface WireRecord {
  childIndex: number;
  /** Client-to-server request or notification. */
  method: string;
  params?: unknown;
  /** Present for requests (notifications have no id). */
  id?: unknown;
}

export interface ServerReply {
  childIndex: number;
  id: unknown;
  method: string;
  result?: unknown;
  error?: unknown;
}

/** One fake child process. */
export class FakeChild extends EventEmitter implements RpcChild {
  pid: number | undefined;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exited = false;
  stdinEnded = false;
  initializedSeen = false;
  initializeSeen = false;
  killed: Array<NodeJS.Signals | number | undefined> = [];
  private inBuf = '';
  constructor(readonly index: number, private readonly server: FakeCodexServer) {
    super();
    this.pid = 10000 + index;
  }
  stdin = {
    write: (data: string, cb?: (err?: Error | null) => void): boolean => {
      if (this.exited) {
        cb?.(new Error('write after exit'));
        return false;
      }
      this.inBuf += data;
      for (;;) {
        const nl = this.inBuf.indexOf('\n');
        if (nl < 0) break;
        const line = this.inBuf.slice(0, nl);
        this.inBuf = this.inBuf.slice(nl + 1);
        if (line.trim()) this.server.onLine(this, line);
      }
      cb?.(null);
      return true;
    },
    end: (): void => {
      if (this.stdinEnded) return;
      this.stdinEnded = true;
      // The real server exits when its stdin closes.
      setImmediate(() => this.exit(0, null));
    },
  };
  on(event: 'exit' | 'error', cb: (...a: never[]) => void): this {
    return super.on(event, cb as (...a: unknown[]) => void);
  }
  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed.push(signal);
    if (!this.exited) setImmediate(() => this.exit(null, typeof signal === 'string' ? signal : 'SIGTERM'));
    return true;
  }
  /** Leave now. Idempotent. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.emit('exit', code, signal);
  }
  /** A server-to-client line, exactly as given (for malformed and oversize input). */
  raw(text: string): void {
    if (!this.exited) this.stdout.emit('data', text);
  }
  send(msg: unknown): void {
    this.raw(JSON.stringify(msg) + '\n');
  }
  stderrText(text: string): void {
    if (!this.exited) this.stderr.emit('data', text);
  }
}

export class FakeCodexServer {
  opts: FakeCodexOptions;
  spawns: Spawned[] = [];
  /** Every request and notification the adapter sent, in order, across all children. */
  wire: WireRecord[] = [];
  /** Every reply the adapter gave to a server request. */
  replies: ServerReply[] = [];
  /** Threads this server knows: id to cwd. Shared by all children, like Codex's own thread store. */
  threads = new Map<string, string>();
  /** spec 059: thread names set with `thread/name/set`, shared by all children. */
  names = new Map<string, string>();
  private nextThread = 1;
  /** Spec 030 FR-034: forked threads; a turn on one answers with one agent message (the hand-off summary). */
  private forks = new Set<string>();
  private nextTurn = 1;
  private nextServerId = 1000;
  private queue: Array<() => void> = [];
  private pumping = false;
  private waiters: Array<() => void> = [];
  private serverPending = new Map<string, { childIndex: number; method: string; resolve: (v: ServerReply) => void }>();
  /** The open turn per thread (id), if any. */
  private openTurn = new Map<string, string>();
  private held: Array<() => void> = [];
  private heldInit: Array<() => void> = [];
  private threadChild = new Map<string, FakeChild>();

  constructor(opts: FakeCodexOptions = {}) {
    this.opts = opts;
  }

  /** The `spawn` to inject into the adapter. */
  spawn: SpawnFn = (file, args, options) => {
    const child = new FakeChild(this.spawns.length, this);
    this.spawns.push({ file, args: [...args], options, child });
    return child;
  };

  get children(): FakeChild[] {
    return this.spawns.map((s) => s.child);
  }
  get live(): FakeChild[] {
    return this.children.filter((c) => !c.exited);
  }
  requests(method: string): WireRecord[] {
    return this.wire.filter((w) => w.method === method);
  }

  /** Resolves once every scripted output has been delivered. */
  flush(): Promise<void> {
    if (!this.queue.length && !this.pumping) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  private enqueue(child: FakeChild, msg: unknown): void {
    this.queue.push(() => {
      if (!child.exited) child.send(msg);
    });
    this.pump();
  }
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    const step = (): void => {
      const f = this.queue.shift();
      if (!f) {
        this.pumping = false;
        const w = this.waiters.splice(0);
        for (const r of w) r();
        return;
      }
      f();
      setImmediate(step);
    };
    setImmediate(step);
  }

  private reply(child: FakeChild, id: unknown, result: unknown): void {
    child.send({ id, result });
  }
  private fail(child: FakeChild, id: unknown, code: number, message: string): void {
    child.send({ id, error: { code, message } });
  }

  onLine(child: FakeChild, line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObj(msg)) return;
    const hasId = msg.id !== undefined;
    if (typeof msg.method !== 'string') {
      // A reply to a server request.
      const key = `${child.index}:${String(msg.id)}`;
      const p = this.serverPending.get(key);
      if (p) {
        this.serverPending.delete(key);
        const rec: ServerReply = { childIndex: child.index, id: msg.id, method: p.method, result: msg.result, error: msg.error };
        this.replies.push(rec);
        p.resolve(rec);
      }
      return;
    }
    const { method, params } = msg;
    this.wire.push({ childIndex: child.index, method, params, ...(hasId ? { id: msg.id } : {}) });
    if (!hasId) {
      if (method === 'initialized') child.initializedSeen = true;
      return;
    }
    const id = msg.id;
    if (this.opts.exitOn && this.opts.exitOn.method === method) return child.exit(this.opts.exitOn.code ?? 1, this.opts.exitOn.signal ?? null);
    if (method === 'initialize') {
      child.initializeSeen = true;
      const caps = isObj(params) && isObj(params.capabilities) ? params.capabilities : undefined;
      const init = this.opts.initialize ?? 'ok';
      if (init === 'no-answer') return;
      if (init === 'error' || (init === 'refuse-experimental' && caps?.experimentalApi === true)) return this.fail(child, id, -32600, this.opts.initializeErrorText ?? 'experimentalApi is not supported');
      if (this.opts.holdInitialize) return void this.heldInit.push(() => this.reply(child, id, { userAgent: 'fake-codex/0.0.0' }));
      return this.reply(child, id, { userAgent: 'fake-codex/0.0.0' });
    }
    if (!child.initializeSeen || !child.initializedSeen) return this.fail(child, id, -32002, 'Not initialized');
    switch (method) {
      case 'thread/start': {
        if (this.opts.refusePermissions && isObj(params) && params.permissions !== undefined) return this.fail(child, id, -32602, this.opts.threadStartError ?? 'permissions is not supported here');
        const tid = `thr_${this.nextThread++}`;
        const cwd = isObj(params) && typeof params.cwd === 'string' ? params.cwd : '';
        this.threads.set(tid, cwd);
        this.threadChild.set(tid, child);
        this.reply(child, id, { thread: { id: tid, cwd } });
        this.enqueue(child, { method: 'thread/started', params: { thread: { id: tid, cwd } } });
        return;
      }
      case 'thread/fork': {
        const src = isObj(params) && typeof params.threadId === 'string' ? params.threadId : '';
        if (!this.threads.has(src)) return this.fail(child, id, -32600, 'no rollout found for thread');
        const tid = `thr_${this.nextThread++}`;
        this.threads.set(tid, this.threads.get(src) as string);
        this.threadChild.set(tid, child);
        this.forks.add(tid);
        return this.reply(child, id, { thread: { id: tid, cwd: this.threads.get(tid) } });
      }
      case 'thread/list': {
        const data = [...this.threads.entries()].map(([tid, cwd], i) => ({ id: tid, cwd, preview: `Prompt ${i + 1}`, createdAt: 1792403000 + i, updatedAt: 1792403100 + i, ephemeral: false, parentThreadId: null, gitInfo: null }));
        return this.reply(child, id, { data, nextCursor: null });
      }
      case 'thread/name/set': {
        // spec 059: like Codex, an empty name and an unknown thread are refused; the stored name is shared by all children
        const tid = isObj(params) && typeof params.threadId === 'string' ? params.threadId : '';
        const name = isObj(params) && typeof params.name === 'string' ? params.name.trim() : '';
        if (this.opts.refuseRename) return this.fail(child, id, -32600, this.opts.refuseRename);
        if (!name) return this.fail(child, id, -32600, 'thread name must not be empty');
        if (!this.threads.has(tid)) return this.fail(child, id, -32600, 'no rollout found for thread');
        this.names.set(tid, name);
        this.reply(child, id, {});
        const owner = this.threadChild.get(tid);
        if (owner && !owner.exited) this.enqueue(owner, { method: 'thread/name/updated', params: { threadId: tid, threadName: name } });
        return;
      }
      case 'thread/delete': {
        const tid = isObj(params) && typeof params.threadId === 'string' ? params.threadId : '';
        if (!this.threads.has(tid)) return this.fail(child, id, -32600, 'no rollout found for thread');
        this.threads.delete(tid);
        this.threadChild.delete(tid);
        this.reply(child, id, {});
        this.enqueue(child, { method: 'thread/deleted', params: { threadId: tid } });
        return;
      }
      case 'mcpServerStatus/list': {
        // spec 069 FR-031: one server's tools when `serverName` is given (a map by tool name, as the generated schema says)
        const all = [
          { name: 'echo', authStatus: 'unsupported', runtimeStatus: 'connected', tools: { echo: { name: 'echo', description: 'Echo the text back\nSecond line', inputSchema: {} }, ping: { name: 'ping', inputSchema: {} } }, resources: [], resourceTemplates: [] },
          { name: 'broken', authStatus: 'unsupported', runtimeStatus: 'failed', tools: {}, toolsError: 'tools/list failed: spawn broken-mcp ENOENT', resources: [], resourceTemplates: [] },
        ];
        const want = isObj(params) && typeof params.serverName === 'string' ? params.serverName : undefined;
        return this.reply(child, id, { data: want ? all.filter((x) => x.name === want) : all.slice(0, 1), nextCursor: null });
      }
      case 'model/list':
        return this.reply(child, id, { data: [
          { id: 'gpt-6-luna', model: 'gpt-6-luna', displayName: 'GPT-6-Luna', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium', isDefault: false, hidden: false },
          { id: 'gpt-6.1-sol', model: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', isDefault: true, hidden: false },
        ] });
      case 'thread/read': {
        const tid = isObj(params) && typeof params.threadId === 'string' ? params.threadId : '';
        const cwd = this.threads.get(tid);
        if (cwd === undefined) return this.fail(child, id, -32600, 'no rollout found for thread');
        return this.reply(child, id, { thread: { id: tid, cwd } });
      }
      case 'thread/resume': {
        const tid = isObj(params) && typeof params.threadId === 'string' ? params.threadId : '';
        if (this.threads.get(tid) === undefined) return this.fail(child, id, -32600, 'no rollout found for thread');
        // like real Codex 0.163: a cwd in the request becomes the thread's folder
        if (isObj(params) && typeof params.cwd === 'string') this.threads.set(tid, params.cwd);
        const cwd = this.threads.get(tid) as string;
        this.threadChild.set(tid, child);
        return this.reply(child, id, { cwd, sandbox: this.opts.resumeSandbox ?? { type: 'readOnly', networkAccess: false }, thread: { id: tid, cwd } });
      }
      case 'turn/start': {
        const tid = isObj(params) && typeof params.threadId === 'string' ? params.threadId : '';
        if (!this.threads.has(tid)) return this.fail(child, id, -32600, 'thread not found');
        const turnId = `turn_${this.nextTurn++}`;
        if (this.forks.has(tid)) {
          this.reply(child, id, { turn: { id: turnId, status: 'inProgress' } });
          this.enqueue(child, { method: 'turn/started', params: { threadId: tid, turn: { id: turnId, status: 'inProgress' } } });
          this.enqueue(child, { method: 'item/completed', params: { threadId: tid, turnId, item: { type: 'agentMessage', id: 'msg_fork', text: '## Goal\nFake fork summary.' } } });
          this.enqueue(child, { method: 'turn/completed', params: { threadId: tid, turn: { id: turnId, status: 'completed' } } });
          return;
        }
        this.openTurn.set(tid, turnId);
        if (this.opts.holdTurnStart) {
          this.held.push(() => {
            this.reply(child, id, { turn: { id: turnId, status: 'inProgress' } });
            this.replayTurn(child, tid, turnId);
          });
          return;
        }
        if (this.opts.completeBeforeResponse) {
          this.replayTurn(child, tid, turnId);
          this.queue.push(() => child.send({ id, result: { turn: { id: turnId, status: 'inProgress' } } }));
          this.pump();
        } else {
          this.reply(child, id, { turn: { id: turnId, status: 'inProgress' } });
          this.replayTurn(child, tid, turnId);
        }
        return;
      }
      case 'turn/interrupt': {
        const tid = isObj(params) && typeof params.threadId === 'string' ? params.threadId : '';
        this.reply(child, id, {});
        const open = this.openTurn.get(tid);
        if (open) this.completeTurn(child, tid, open, 'interrupted');
        return;
      }
      case 'account/rateLimits/read': {
        const r = this.opts.rateLimits ?? 'ok';
        if (r === 'missing') return this.fail(child, id, -32601, `method not found: ${method}`);
        if (r === 'unauthorized') return this.fail(child, id, -32603, 'failed to fetch codex rate limits: 401 Unauthorized');
        if (r === 'network') return this.fail(child, id, -32603, 'failed to fetch codex rate limits: error sending request');
        return this.reply(child, id, { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1792403999 }, secondary: null } });
      }
      case 'getAuthStatus':
        return this.reply(child, id, { authMethod: this.opts.authMethod === undefined ? 'chatgpt' : this.opts.authMethod, authToken: null, requiresOpenaiAuth: true });
      case 'thread/unsubscribe':
        return this.reply(child, id, { status: 'unsubscribed' });
      default:
        return this.fail(child, id, -32601, `method not found: ${method}`);
    }
  }

  private replayTurn(child: FakeChild, tid: string, turnId: string): void {
    const script = this.opts.turnScript ?? [{ method: 'turn/started', params: { threadId: 'thr_main', turn: { id: turnId, status: 'inProgress' } } }];
    let notes = script;
    // `thread/start` already announced the thread: a fixture's own first `thread/started` would be a repeat.
    if (notes[0]?.method === 'thread/started') notes = notes.slice(1);
    const swap = (v: unknown): unknown => (v === 'thr_main' ? tid : Array.isArray(v) ? v.map(swap) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v);
    let completed = false;
    for (const n of notes) {
      const p = swap(n.params);
      this.enqueue(child, { method: n.method, ...(n.params === undefined ? {} : { params: p }) });
      if (n.method === 'turn/completed' && isObj(p) && p.threadId === tid) completed = true;
    }
    if (completed) this.openTurn.delete(tid);
    else if (!this.opts.holdTurn) this.completeTurn(child, tid, turnId, 'completed');
  }

  private completeTurn(child: FakeChild, tid: string, turnId: string, status: 'completed' | 'interrupted'): void {
    this.openTurn.delete(tid);
    this.enqueue(child, { method: 'turn/completed', params: { threadId: tid, turn: { id: turnId, status } } });
  }

  /** Deliver what `holdTurnStart` withheld. */
  releaseTurnStart(): void {
    for (const f of this.held.splice(0)) f();
  }
  /** Deliver what `holdInitialize` withheld. */
  releaseInitialize(): void {
    for (const f of this.heldInit.splice(0)) f();
  }

  /** End a held turn normally. */
  finishTurn(tid: string): void {
    const open = this.openTurn.get(tid);
    const child = this.threadChild.get(tid);
    if (open && child) this.completeTurn(child, tid, open, 'completed');
  }

  /** Send a server-to-client request (an approval) to a child and wait for the adapter's reply. */
  serverRequest(method: string, params: unknown, child: FakeChild = this.live[this.live.length - 1]): Promise<ServerReply> {
    const id = this.nextServerId++;
    return new Promise((resolve) => {
      this.serverPending.set(`${child.index}:${id}`, { childIndex: child.index, method, resolve });
      child.send({ id, method, params });
    });
  }

  /** A notification to every live child (tests: MCP startup states, spec 012 FR-147). */
  notifyAll(method: string, params: unknown): void {
    for (const c of this.children.filter((x) => !x.exited)) this.enqueue(c, { jsonrpc: '2.0', method, params });
  }

  /** The child that serves a thread (the one that answered its `thread/start` or `thread/resume`). */
  childOfThread(tid: string): FakeChild | undefined {
    return this.threadChild.get(tid);
  }
}
