/**
 * Line-delimited JSON-RPC client for `codex app-server` over a child process's stdio (spec 012, T042).
 *
 * Pure apart from the injected `spawn`: nothing here touches Electron or the renderer, and nothing in the app calls
 * it yet. The caller (CodexAdapter, later) passes an absolute `file` and an argv array; the real spawn never uses a
 * shell (FR-006). Windows `.cmd` shims are resolved by the caller (detect, T012); this client only forwards
 * `windowsVerbatimArguments`. [KNOWN GAP] no shim logic here.
 *
 * Wire format: one JSON object per line, "jsonrpc" field optional (app-server omits it). Unknown or malformed input
 * is dropped, never fatal (FR-020).
 */
import { spawn as nodeSpawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { isObj } from '../shared/guards';
import { killForEscalation } from './detect';

export const MAX_LINE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_CLOSE_GRACE_MS = 2_000;
export const DEFAULT_MAX_PENDING_SERVER_REQUESTS = 16;
export const DEFAULT_KILL_GRACE_MS = 1_000;
const MAX_STDERR_LINES = 50;

type Json = unknown;

/** Rejection of a request: a JSON-RPC error response, a timeout, or a dead child. */
export class CodexRpcError extends Error {
  constructor(
    message: string,
    readonly kind: 'rpc' | 'timeout' | 'exit' | 'closed' | 'write',
    readonly code?: number,
    readonly data?: Json,
  ) {
    super(message);
    this.name = 'CodexRpcError';
  }
}

export interface RpcErrorBody {
  code: number;
  message: string;
  data?: Json;
}

/** What `onRequest` returns for a server-to-client request. */
export type RequestOutcome = { result: Json } | { error: RpcErrorBody };

/** The slice of a ChildProcess the client uses (a fake implements the same). */
export interface RpcChild {
  pid?: number;
  stdin: { write(data: string, cb?: (err?: Error | null) => void): unknown; end(): unknown } | null;
  stdout: NodeJS.EventEmitter | null;
  stderr: NodeJS.EventEmitter | null;
  on(event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio: ['pipe', 'pipe', 'pipe'];
  shell: false;
  windowsHide: true;
  windowsVerbatimArguments?: boolean;
}
export type SpawnFn = (file: string, args: string[], options: SpawnOptions) => RpcChild;

/** The real spawn: argv array, no shell. */
export const realSpawn: SpawnFn = (file, args, options) => nodeSpawn(file, args, options) as unknown as RpcChild;

export interface CodexRpcOptions {
  spawn: SpawnFn;
  file: string;
  args: string[];
  cwd?: string;
  /** When undefined the child inherits the whole app environment; which variables are passed on purpose is the adapter's call (T043). */
  env?: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
  onNotification: (method: string, params: Json) => void;
  onRequest: (method: string, params: Json) => Promise<RequestOutcome>;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** Diagnostics only. Never receives env values or stderr text. */
  debug?: (msg: string) => void;
  /** Wait after stdin ends before SIGTERM (default 2 s). */
  /** Server requests allowed in flight in `onRequest` (default 16); extra ones get a -32000 error at once. */
  maxPendingServerRequests?: number;
  closeGraceMs?: number;
  /** Wait after SIGTERM before SIGKILL (default 1 s). */
  killGraceMs?: number;
  /** One kill step (tests hand in a fake); the default ends the whole tree on Windows (FR-079). */
  killChild?: (child: RpcChild, signal: NodeJS.Signals) => void;
}

export interface CodexRpc {
  request(method: string, params?: Json, opts?: { timeoutMs?: number }): Promise<Json>;
  notify(method: string, params?: Json): Promise<void>;
  /** End stdin, kill the child after a grace period if still alive. Idempotent. */
  close(): void;
  readonly pid: number | undefined;
  readonly exited: boolean;
  /** Last stderr lines, for diagnostics only. [KNOWN GAP] not yet redacted (T051): never show or log them. */
  stderrTail(): string[];
}

interface Pending {
  resolve: (v: Json) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}


export function createCodexRpc(o: CodexRpcOptions): CodexRpc {
  const debug = o.debug ?? (() => undefined);
  const killChild = o.killChild ?? ((c: RpcChild, sig: NodeJS.Signals) => killForEscalation(c, sig));
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let inFlight = 0;
  let exited = false;
  let closing = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let killTimer2: ReturnType<typeof setTimeout> | undefined;
  const stderrLines: string[] = [];
  let child: RpcChild | undefined;

  function failAll(err: () => Error): void {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      pending.delete(id);
      p.reject(err());
    }
  }

  function handleExit(code: number | null, signal: NodeJS.Signals | null, why?: string): void {
    if (exited) return;
    exited = true;
    if (killTimer) clearTimeout(killTimer);
    if (killTimer2) clearTimeout(killTimer2);
    const detail = why ?? `codex app-server exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`;
    failAll(() => new CodexRpcError(detail, 'exit'));
    try {
      o.onExit(code, signal);
    } catch (e) {
      debug(`onExit threw: ${(e as Error).message}`);
    }
  }

  function write(obj: Json): Promise<void> {
    return new Promise((resolve, reject) => {
      if (exited || closing || !child?.stdin) return reject(new CodexRpcError('codex app-server is not running', exited ? 'exit' : 'closed'));
      try {
        child.stdin!.write(JSON.stringify(obj) + '\n', (err) => (err ? reject(new CodexRpcError(`write failed: ${err.message}`, 'write')) : resolve()));
      } catch (e) {
        reject(new CodexRpcError(`write failed: ${(e as Error).message}`, 'write'));
      }
    });
  }

  function respond(id: unknown, outcome: RequestOutcome): void {
    const body = 'error' in outcome ? { id, error: outcome.error } : { id, result: outcome.result };
    write(body).catch((e) => debug(`could not answer server request: ${(e as Error).message}`));
  }

  function handleMessage(msg: Record<string, unknown>): void {
    const hasId = typeof msg.id === 'number' || typeof msg.id === 'string';
    const method = typeof msg.method === 'string' ? msg.method : undefined;
    if (method !== undefined) {
      if (hasId) {
        const id = msg.id;
        if (inFlight >= (o.maxPendingServerRequests ?? DEFAULT_MAX_PENDING_SERVER_REQUESTS)) {
          respond(id, { error: { code: -32000, message: 'too many pending requests' } });
          return;
        }
        inFlight++;
        Promise.resolve()
          .then(() => o.onRequest(method, msg.params))
          .finally(() => { inFlight--; })
          .then(
            (out) => respond(id, out && typeof out === 'object' ? out : { error: { code: -32603, message: 'invalid handler result' } }),
            (e: unknown) => respond(id, { error: { code: -32603, message: e instanceof Error ? e.message : 'request handler failed' } }),
          );
      } else {
        try {
          o.onNotification(method, msg.params);
        } catch (e) {
          debug(`onNotification threw: ${(e as Error).message}`);
        }
      }
      return;
    }
    if (hasId && ('result' in msg || 'error' in msg)) {
      const p = typeof msg.id === 'number' ? pending.get(msg.id) : undefined;
      if (!p) return debug('response for unknown id ignored');
      pending.delete(msg.id as number);
      clearTimeout(p.timer);
      if (isObj(msg.error)) {
        const e = msg.error;
        p.reject(new CodexRpcError(typeof e.message === 'string' ? e.message : 'rpc error', 'rpc', typeof e.code === 'number' ? e.code : undefined, e.data));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    debug('message with no method or response shape dropped');
  }

  function handleLine(raw: string): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return debug('non-JSON line dropped');
    }
    if (!isObj(msg)) return debug('non-object message dropped');
    handleMessage(msg);
  }

  // Framing: buffer chunks, split on \n. An over-long line is discarded up to its next newline.
  let buf = '';
  let skipping = false;
  try {
    child = o.spawn(o.file, o.args, {
      cwd: o.cwd,
      env: o.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      ...(o.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
  } catch (e) {
    handleExit(null, null, `codex app-server could not start: ${(e as Error).message}`);
  }

  const outDec = new StringDecoder('utf8');
  const errDec = new StringDecoder('utf8');
  child?.stdout?.on('data', (chunk: Buffer | string) => {
    buf += typeof chunk === 'string' ? chunk : outDec.write(chunk);
    for (;;) {
      const nl = buf.indexOf('\n');
      if (nl < 0) break;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (skipping) skipping = false;
      else if (Buffer.byteLength(line) > MAX_LINE_BYTES) debug('oversize line dropped');
      else handleLine(line);
    }
    if (buf.length > MAX_LINE_BYTES) {
      if (!skipping) debug('oversize line dropped');
      skipping = true;
      buf = '';
    }
  });

  let errBuf = '';
  child?.stderr?.on('data', (chunk: Buffer | string) => {
    errBuf += typeof chunk === 'string' ? chunk : errDec.write(chunk);
    const parts = errBuf.split(/\r?\n/);
    errBuf = parts.pop() ?? '';
    if (errBuf.length > 500) errBuf = errBuf.slice(0, 500);
    for (const l of parts) {
      if (!l) continue;
      stderrLines.push(l.slice(0, 500));
      if (stderrLines.length > MAX_STDERR_LINES) stderrLines.shift();
    }
  });

  child?.on('exit', (code, signal) => handleExit(code, signal));
  // 'error' after a successful spawn (failed kill, failed write) is not an exit: keep the child killable.
  child?.on('error', (err) => {
    if (child && child.pid === undefined) handleExit(null, null, `codex app-server failed: ${err.message}`);
    else debug(`child error: ${err.message}`);
  });

  return {
    get pid() {
      return child?.pid;
    },
    get exited() {
      return exited;
    },
    stderrTail: () => stderrLines.slice(),
    request(method, params, opts) {
      if (exited || closing) return Promise.reject(new CodexRpcError('codex app-server is not running', exited ? 'exit' : 'closed'));
      const id = nextId++;
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      return new Promise<Json>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new CodexRpcError(`${method} timed out after ${timeoutMs} ms`, 'timeout'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        write({ id, method, ...(params === undefined ? {} : { params }) }).catch((e) => {
          if (pending.delete(id)) clearTimeout(timer);
          reject(e);
        });
      });
    },
    notify(method, params) {
      return write({ method, ...(params === undefined ? {} : { params }) });
    },
    close() {
      if (closing) return;
      closing = true;
      failAll(() => new CodexRpcError('client closed', 'closed'));
      try {
        child?.stdin?.end();
      } catch {
        /* already closed */
      }
      if (exited) return;
      // Kill policy: SIGTERM after the grace, SIGKILL if still alive after a second grace; each at most once.
      // Windows: the whole tree via taskkill /t (FR-079 delta 2026-10-26). [KNOWN GAP] POSIX kills the child only; nothing kills on a Durbar crash.
      killTimer = setTimeout(() => {
        if (exited) return;
        try {
          if (child) killChild(child, 'SIGTERM');
        } catch {
          /* gone */
        }
        killTimer2 = setTimeout(() => {
          if (exited) return;
          try {
            if (child) killChild(child, 'SIGKILL');
          } catch {
            /* gone */
          }
        }, o.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
        killTimer2.unref?.();
      }, o.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS);
      killTimer.unref?.();
    },
  };
}
