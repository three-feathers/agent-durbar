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
  private nextThread = 1;
  private nextTurn = 1;
  private nextServerId = 1000;
  private queue: Array<() => void> = [];
  private pumping = false;
  private waiters: Array<() => void> = [];
  private serverPending = new Map<string, { childIndex: number; method: string; resolve: (v: ServerReply) => void }>();
  /** The open turn per thread (id), if any. */
  private openTurn = new Map<string, string>();
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
      if (init === 'error' || (init === 'refuse-experimental' && caps?.experimentalApi === true)) return this.fail(child, id, -32600, 'experimentalApi is not supported');
      return this.reply(child, id, { userAgent: 'fake-codex/0.0.0' });
    }
    if (!child.initializeSeen || !child.initializedSeen) return this.fail(child, id, -32002, 'Not initialized');
    switch (method) {
      case 'thread/start': {
        if (this.opts.refusePermissions && isObj(params) && params.permissions !== undefined) return this.fail(child, id, -32602, 'permissions is not supported here');
        const tid = `thr_${this.nextThread++}`;
        const cwd = isObj(params) && typeof params.cwd === 'string' ? params.cwd : '';
        this.threads.set(tid, cwd);
        this.threadChild.set(tid, child);
        this.reply(child, id, { thread: { id: tid, cwd } });
        this.enqueue(child, { method: 'thread/started', params: { thread: { id: tid, cwd } } });
        return;
      }
      case 'thread/resume': {
        const tid = isObj(params) && typeof params.threadId === 'string' ? params.threadId : '';
        const cwd = this.threads.get(tid);
        if (cwd === undefined) return this.fail(child, id, -32600, 'no rollout found for thread');
        this.threadChild.set(tid, child);
        return this.reply(child, id, { thread: { id: tid, cwd } });
      }
      case 'turn/start': {
        const tid = isObj(params) && typeof params.threadId === 'string' ? params.threadId : '';
        if (!this.threads.has(tid)) return this.fail(child, id, -32600, 'thread not found');
        const turnId = `turn_${this.nextTurn++}`;
        this.openTurn.set(tid, turnId);
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

  /** The child that serves a thread (the one that answered its `thread/start` or `thread/resume`). */
  childOfThread(tid: string): FakeChild | undefined {
    return this.threadChild.get(tid);
  }
}
