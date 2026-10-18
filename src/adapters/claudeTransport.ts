/**
 * The Claude transport seam and the CLI transport (spec 012 FR-110, FR-111, T090).
 *
 * The CLI transport starts the user's own `claude` with the CLI's `stream-json` protocol on stdin/stdout: user messages
 * and `control_request`s go in, stream messages and the CLI's own `control_request`s (`can_use_tool`, `hook_callback`)
 * come out, and every request is answered by one `control_response` (shape read from the Claude Agent SDK 0.3.302 transport
 * and checked on a real run, spec 012 `## Changes` 2026-10-18). The SDK transport (claudeSdk.ts) implements the same seam.
 *
 * Pure apart from the injected `spawn`. The caller passes an absolute file and an argv array: never a shell (FR-006).
 * Malformed or oversized lines are dropped, never fatal (FR-020). Nothing here logs; stderr is kept as a short tail
 * that the caller passes through the redacting debug sink (T051).
 */
import { spawn as nodeSpawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import type { ClaudeMessage } from './claudeMap';

export const MAX_LINE_BYTES = 8 * 1024 * 1024;
export const CONTROL_TIMEOUT_MS = 30_000;
export const CLOSE_GRACE_MS = 2_000;
export const KILL_GRACE_MS = 1_000;
const STDERR_TAIL_LINES = 30;
/** Request ids the CLI used, remembered so a duplicate delivery is answered once (bounded). */
const SEEN_IDS_CAP = 512;

/** A request the CLI sends to the host (`can_use_tool`, `hook_callback`, ...); `request` is untrusted input. */
export interface IncomingControl {
  requestId: string;
  subtype: string;
  request: Record<string, unknown>;
}

/** What a handler answers: a response body, or an error string (sent as `subtype: 'error'`). */
export type ControlAnswer = { response: Record<string, unknown> } | { error: string };

export interface TransportHandlers {
  message(m: ClaudeMessage): void;
  /** Answer an incoming control request. It must settle; the transport answers `deny`/error itself if the session closes first. */
  control(req: IncomingControl): Promise<ControlAnswer>;
  /** The process (or the SDK query) ended: `code` null when killed; `stderrTail` is unredacted and must not be logged as is. */
  exit(info: { code: number | null; signal: string | null; stderrTail: string }): void;
}

/** User message content: plain text, or content blocks (text and base64 images). */
export type UserContent = string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>;

export interface ClaudeTransport {
  readonly kind: 'cli' | 'sdk';
  /** True until the process or query ends. */
  readonly alive: boolean;
  sendUser(content: UserContent): void;
  /** Send a host → CLI control request (`initialize`, `interrupt`, `set_permission_mode`, ...); resolves with its response body. */
  request(body: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  /** End stdin, wait a little, then terminate. Pending incoming requests are answered first by the handler's owner. */
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ CLI transport ------------------------------------------------------------------ */

export interface ChildLike {
  stdin: { write(chunk: string): boolean; end(): void; on?(ev: 'error', cb: (e: Error) => void): unknown } | null;
  stdout: { on(ev: 'data', cb: (chunk: Buffer | string) => void): unknown } | null;
  stderr: { on(ev: 'data', cb: (chunk: Buffer | string) => void): unknown } | null;
  on(ev: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(ev: 'error', cb: (e: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnFn = (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean; shell: false; stdio: ['pipe', 'pipe', 'pipe'] }) => ChildLike;
export const realSpawn: SpawnFn = (file, args, options) => nodeSpawn(file, args, options) as unknown as ChildLike;

export interface CliTransportOptions {
  /** Absolute path of `claude` from `detect()`. */
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  handlers: TransportHandlers;
  spawn?: SpawnFn;
  controlTimeoutMs?: number;
  closeGraceMs?: number;
  killGraceMs?: number;
  /** Request id factory for host → CLI requests (tests pass a counter). */
  nextId?: () => string;
}

export function createCliTransport(o: CliTransportOptions): ClaudeTransport {
  const spawn = o.spawn ?? realSpawn;
  const child = spawn(o.file, o.args, { cwd: o.cwd, env: o.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  let alive = true;
  let seq = 0;
  const nextId = o.nextId ?? (() => `durbar-${Date.now().toString(36)}-${++seq}`);
  const pending = new Map<string, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  const seen = new Set<string>();
  const stderrLines: string[] = [];
  let exitInfo: { code: number | null; signal: string | null } | undefined;
  const exitWaiters: Array<() => void> = [];

  const write = (obj: unknown): boolean => {
    if (!alive || !child.stdin) return false;
    try {
      child.stdin.write(JSON.stringify(obj) + '\n');
      return true;
    } catch {
      return false;
    }
  };

  const answer = (requestId: string, a: ControlAnswer): void => {
    write({ type: 'control_response', response: 'error' in a ? { subtype: 'error', request_id: requestId, error: a.error } : { subtype: 'success', request_id: requestId, response: a.response } });
  };

  const onIncoming = (msg: Record<string, unknown>): void => {
    const requestId = typeof msg.request_id === 'string' ? msg.request_id : '';
    const request = msg.request && typeof msg.request === 'object' ? (msg.request as Record<string, unknown>) : undefined;
    if (!requestId || !request) return;
    if (seen.has(requestId)) return; // duplicate delivery: answered once
    seen.add(requestId);
    if (seen.size > SEEN_IDS_CAP) seen.delete(seen.values().next().value as string);
    const subtype = typeof request.subtype === 'string' ? request.subtype : '';
    let settled = false;
    Promise.resolve()
      .then(() => o.handlers.control({ requestId, subtype, request }))
      .then(
        (a) => {
          settled = true;
          answer(requestId, a);
        },
        (e: unknown) => {
          if (settled) return;
          answer(requestId, { error: e instanceof Error ? e.message : 'host error' });
        },
      );
  };

  const onLine = (line: string): void => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    const m = msg as Record<string, unknown>;
    switch (m.type) {
      case 'control_response': {
        const r = m.response && typeof m.response === 'object' ? (m.response as Record<string, unknown>) : undefined;
        const id = r && typeof r.request_id === 'string' ? r.request_id : '';
        const p = pending.get(id);
        if (!p || !r) return;
        pending.delete(id);
        clearTimeout(p.timer);
        if (r.subtype === 'success') p.resolve(r.response && typeof r.response === 'object' ? (r.response as Record<string, unknown>) : {});
        else p.reject(new Error(typeof r.error === 'string' ? r.error.slice(0, 300) : 'control request failed'));
        return;
      }
      case 'control_request':
        return onIncoming(m);
      case 'control_cancel_request':
      case 'keep_alive':
        return; // a cancelled can_use_tool is answered when the turn ends anyway; nothing to keep alive
      default:
        try {
          o.handlers.message(m as ClaudeMessage);
        } catch {
          /* a handler bug must not end the stream */
        }
    }
  };

  // stdout: JSON lines, with a byte cap per line (an oversized line is dropped up to its newline)
  const decoder = new StringDecoder('utf8');
  let buf = '';
  let dropping = false;
  child.stdout?.on('data', (chunk) => {
    buf += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (dropping) {
        dropping = false;
        continue;
      }
      if (line.length > MAX_LINE_BYTES) continue;
      onLine(line);
    }
    if (buf.length > MAX_LINE_BYTES) {
      buf = '';
      dropping = true;
    }
  });
  child.stderr?.on('data', (chunk) => {
    for (const l of String(chunk).split(/\r?\n/)) if (l.trim()) stderrLines.push(l.slice(0, 500));
    if (stderrLines.length > STDERR_TAIL_LINES) stderrLines.splice(0, stderrLines.length - STDERR_TAIL_LINES);
  });
  child.stdin?.on?.('error', () => undefined); // EPIPE after the child died: reported through `exit`

  const finish = (code: number | null, signal: string | null): void => {
    if (exitInfo) return;
    alive = false;
    exitInfo = { code, signal };
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('claude exited'));
    }
    pending.clear();
    try {
      o.handlers.exit({ code, signal, stderrTail: stderrLines.join('\n') });
    } finally {
      exitWaiters.splice(0).forEach((w) => w());
    }
  };
  child.on('exit', (code, signal) => finish(code, signal));
  child.on('error', (e) => {
    stderrLines.push(`spawn error: ${e.message}`.slice(0, 500));
    finish(null, null);
  });

  return {
    kind: 'cli',
    get alive() {
      return alive;
    },
    sendUser(content) {
      write({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
    },
    request(body, timeoutMs = o.controlTimeoutMs ?? CONTROL_TIMEOUT_MS) {
      if (!alive) return Promise.reject(new Error('claude is not running'));
      const id = nextId();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`control request ${String(body.subtype)} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        if (!write({ type: 'control_request', request_id: id, request: body })) {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error('could not write to claude'));
        }
      });
    },
    async close() {
      if (exitInfo) return;
      const exited = new Promise<void>((r) => exitWaiters.push(r));
      try {
        child.stdin?.end();
      } catch {
        /* already closed */
      }
      const wait = (ms: number) => Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
      if (await wait(o.closeGraceMs ?? CLOSE_GRACE_MS)) return;
      child.kill('SIGTERM');
      if (await wait(o.killGraceMs ?? KILL_GRACE_MS)) return;
      child.kill('SIGKILL');
      await wait(o.killGraceMs ?? KILL_GRACE_MS);
      finish(null, 'SIGKILL');
    },
  };
}
