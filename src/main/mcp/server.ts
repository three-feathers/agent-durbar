/**
 * Durbar MCP server host, spec 041 T017 [FR-001, FR-002, FR-003, FR-040, FR-058, FR-061, SC-005].
 * Glues the pure parts to a `net` server: the key file and handshake (T011), the connection with its rate
 * limit (T012), the session and the tool registry (T012/T013) with the read handlers injected (T016).
 *
 * Rules kept here:
 * - Never listens in demo/sample mode, and nothing is created while the setting is off (`apply(false)` only stops).
 * - A live owner on the socket (a second Durbar instance) is detected BEFORE anything is created, rotated or
 *   unlinked, so a second instance never breaks the first one's key. A stale socket file (nobody answers) is unlinked.
 * - At most `MCP_LIMITS.maxConnections` AUTHENTICATED connections; a connection that has not finished the
 *   handshake neither counts nor blocks (it is closed after the handshake timeout, FR-061).
 * - `stop()` closes every connection and removes the socket and the key file synchronously (SC-005).
 * - The key is never logged or put in a status text; every text here is fixed.
 */
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import { MCP_LIMITS, MCP_SERVER_NAME } from '../../shared/mcpserver';
import { McpFs, createKeyFile, createServerHandshake, deleteKeyFile, nodeMcpFs, readKeyFile } from './auth';
import type { Handshake, KeyMaterial, Timers } from './auth';
import { McpConnection } from './connection';
import { LineFramer } from './jsonrpc';
import { McpPaths, checkFallbackDir, mcpPaths } from './paths';
import { McpSession } from './protocol';
import type { MethodHandler } from './protocol';
import { createToolRegistry } from './tools';
import type { ToolHandlers } from './tools';

/** What Settings can show (T020). `other-instance`: another Durbar answers on the socket. `unavailable`: no safe place to listen, or a failure (see `reason`). */
export type McpHostStatus = 'off' | 'listening' | 'demo' | 'other-instance' | 'unavailable';

export interface McpHostState {
  status: McpHostStatus;
  /** Fixed text for every status other than `off` and `listening`; never contains the key. */
  reason: string | null;
  /** Authenticated connections right now. */
  connections: number;
}

export interface McpHostOptions {
  /** Electron `userData` (already redirected by the `DURBAR_USER_DATA` dev hook). */
  userData: string;
  platform?: string;
  /** `process.env.XDG_RUNTIME_DIR`; pass `undefined` when a dev hook keeps everything in userData. */
  xdgRuntimeDir?: string;
  /** `process.getuid()`; null on Windows. */
  uid?: number | null;
  tmpdir?: string;
  /** App version for `serverInfo`. */
  version: string;
  /** The read tool handlers (T016). */
  handlers: ToolHandlers;
  /** True in demo/sample mode: then the host never starts. */
  demo?: () => boolean;
  /** Test seams. */
  fs?: McpFs;
  timers?: Timers;
  random?: (n: number) => Buffer;
  now?: () => number;
  handshakeTimeoutMs?: number;
  probeTimeoutMs?: number;
  maxConnections?: number;
  changeToolsEnabled?: boolean;
  onState?: (state: McpHostState) => void;
}

const DEFAULT_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

const R = {
  demo: 'The MCP server is not available in demo mode.',
  other: 'Another Durbar window already runs the MCP server, so this one does not serve.',
  noPath: 'Durbar could not find a safe place to listen for the MCP server.',
  key: 'Durbar could not write the connection key file for the MCP server.',
  dir: 'The folder for the MCP socket is not safe to use.',
  stale: 'An old file is in the way of the MCP socket and could not be removed.',
  listen: 'Durbar could not start listening for the MCP server.',
} as const;

type Probe = 'live' | 'dead';

/** Connects once: someone answered means `live`; refused or missing means `dead`. An owner that neither answers nor refuses in time counts as live (never unlink what may be in use). */
function probe(socketPath: string, timeoutMs: number): Promise<Probe> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: Probe, s: net.Socket) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      s.destroy();
      resolve(r);
    };
    const s = net.connect(socketPath);
    const t = setTimeout(() => finish('live', s), timeoutMs);
    s.on('connect', () => finish('live', s));
    s.on('error', (e: NodeJS.ErrnoException) => finish(e.code === 'ECONNREFUSED' || e.code === 'ENOENT' || e.code === 'ENOTSOCK' || e.code === 'ENOTDIR' ? 'dead' : 'live', s));
  });
}

export class McpServerHost {
  private st: McpHostState = { status: 'off', reason: null, connections: 0 };
  private server: net.Server | null = null;
  private socketPath: string | null = null;
  private ownsKeyFile = false;
  private paths: McpPaths | null = null;
  private readonly authed = new Set<net.Socket>();
  private readonly pending = new Set<net.Socket>();
  private chain: Promise<unknown> = Promise.resolve();
  private readonly o: McpHostOptions;
  private readonly fsx: McpFs;
  private readonly platform: string;
  private readonly uid: number | null;

  constructor(options: McpHostOptions) {
    this.o = options;
    this.fsx = options.fs ?? nodeMcpFs();
    this.platform = options.platform ?? process.platform;
    this.uid = options.uid !== undefined ? options.uid : typeof process.getuid === 'function' ? process.getuid() : null;
  }

  state(): McpHostState {
    return { ...this.st };
  }

  /** Where the host listens now (null when it does not); for tests and Settings. */
  get socket(): string | null {
    return this.st.status === 'listening' ? this.socketPath : null;
  }

  /** The setting changed (or the app is ready): on starts, off stops. */
  apply(on: boolean): Promise<McpHostState> {
    return on ? this.start() : this.stop();
  }

  start(): Promise<McpHostState> {
    return this.enqueue(() => this.doStart());
  }

  /** Closes everything and removes the socket and the key file now (synchronously); the promise settles when the listener is closed. */
  stop(): Promise<McpHostState> {
    this.teardownSync();
    return this.enqueue(() => this.doStop());
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private set(status: McpHostStatus, reason: string | null): McpHostState {
    this.st = { status, reason, connections: this.authed.size };
    try { this.o.onState?.(this.state()); } catch { /* a listener must not break the host */ }
    return this.state();
  }

  private pathsFor(pipeId?: string): McpPaths {
    return mcpPaths({
      platform: this.platform,
      userData: this.o.userData,
      xdgRuntimeDir: this.o.xdgRuntimeDir,
      uid: this.uid,
      tmpdir: this.o.tmpdir ?? os.tmpdir(),
      pipeId,
    });
  }

  private keyDeps(p: McpPaths) {
    return { fs: this.fsx, mcpDir: p.mcpDir as string, keyFile: p.keyFile as string, uid: this.uid, platform: this.platform, ...(this.o.random ? { random: this.o.random } : {}) };
  }

  private async doStart(): Promise<McpHostState> {
    if (this.server) return this.state(); // already listening
    if (this.o.demo?.()) return this.set('demo', R.demo);

    // 1. Is someone already serving? Look BEFORE creating or changing anything.
    const first = this.pathsFor();
    if (first.mcpDir === null || first.keyFile === null) return this.set('unavailable', first.reason ?? R.noPath);
    const existing = readKeyFile(this.keyDeps(first));
    const probePaths = this.platform === 'win32' ? (existing.ok ? this.pathsFor(existing.material.pipeId) : null) : first;
    if (probePaths?.socket && (await probe(probePaths.socket, this.o.probeTimeoutMs ?? 500)) === 'live') return this.set('other-instance', R.other);
    // a stop() or another start() may have run while we waited
    if (this.server) return this.state();

    // 2. A fresh key (a leftover file is from a crash: no live owner holds it).
    let material: KeyMaterial;
    try {
      material = createKeyFile(this.keyDeps(first));
    } catch {
      return this.set('unavailable', R.key);
    }
    this.ownsKeyFile = true;
    const paths = this.pathsFor(material.pipeId);
    this.paths = paths;
    if (paths.socket === null) {
      this.removeKeyFile();
      return this.set('unavailable', paths.reason ?? R.noPath);
    }

    // 3. The socket folder must be private; a stale socket file is removed.
    if (paths.kind === 'unix') {
      const bad = this.prepareSocketDir(paths);
      if (bad) { this.removeKeyFile(); return this.set('unavailable', bad); }
      if (!this.clearStaleSocket(paths.socket)) { this.removeKeyFile(); return this.set('unavailable', R.stale); }
    }

    // 4. Listen.
    const registry = createToolRegistry({ handlers: this.o.handlers, ...(this.o.changeToolsEnabled !== undefined ? { changeToolsEnabled: this.o.changeToolsEnabled } : {}) });
    const server = net.createServer((sock) => this.onSocket(sock, material, registry.methods()));
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(paths.socket as string, () => { server.removeListener('error', reject); resolve(); });
      });
    } catch (e) {
      try { server.close(); } catch { /* not listening */ }
      this.removeKeyFile();
      return (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? this.set('other-instance', R.other) : this.set('unavailable', R.listen);
    }
    server.on('error', () => { /* a late listener error must not crash main */ });
    if (paths.kind === 'unix') { try { fs.chmodSync(paths.socket, 0o600); } catch { /* best effort: the folder is 0700 already */ } }
    this.server = server;
    this.socketPath = paths.socket;
    return this.set('listening', null);
  }

  /** Mode 0700 folder, owned by this user, not a link (FR-062). Returns a refusal text or null. */
  private prepareSocketDir(p: McpPaths): string | null {
    if (!p.checkDir || this.uid === null) return null;
    try {
      let st: fs.Stats;
      try { st = fs.lstatSync(p.checkDir); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return R.dir;
        fs.mkdirSync(p.checkDir, { recursive: true, mode: 0o700 });
        st = fs.lstatSync(p.checkDir);
      }
      return checkFallbackDir(st, this.uid).ok ? null : R.dir;
    } catch {
      return R.dir;
    }
  }

  /** Nobody answered on this path (checked at the start), so a socket file left there is stale: it is unlinked. Anything that is not a socket is never touched. False when it could not be cleared. */
  private clearStaleSocket(sock: string): boolean {
    let st: fs.Stats;
    try { st = fs.lstatSync(sock); } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT'; }
    if (!st.isSocket()) return false;
    try { fs.unlinkSync(sock); return true; } catch { return false; }
  }

  private async doStop(): Promise<McpHostState> {
    this.teardownSync(); // also covers a start that finished after stop() was called
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => { try { server.close(() => resolve()); } catch { resolve(); } });
    return this.set('off', null);
  }

  /** Synchronous part of stop: connections, socket file and key file go now, so `will-quit` can call `stop()` without waiting. */
  private teardownSync(): void {
    for (const s of [...this.authed, ...this.pending]) s.destroy();
    this.authed.clear();
    this.pending.clear();
    const server = this.server;
    if (server) { try { server.close(); } catch { /* already closing */ } }
    if (this.socketPath && this.paths?.kind === 'unix') { try { fs.unlinkSync(this.socketPath); } catch { /* gone already */ } }
    this.socketPath = null;
    this.removeKeyFile();
  }

  private removeKeyFile(): void {
    if (!this.ownsKeyFile || !this.paths || this.paths.mcpDir === null || this.paths.keyFile === null) return;
    this.ownsKeyFile = false;
    try { deleteKeyFile(this.keyDeps(this.paths)); } catch { /* best effort */ }
  }

  private onSocket(sock: net.Socket, material: KeyMaterial, methods: Record<string, MethodHandler>): void {
    this.pending.add(sock);
    sock.on('error', () => { /* closed by the peer: 'close' follows */ });
    const framer = new LineFramer();
    const c: { conn: McpConnection | null } = { conn: null };
    let hs: Handshake | null = null;
    const closeAll = () => { hs?.abort(); this.pending.delete(sock); if (this.authed.delete(sock)) this.set(this.st.status, this.st.reason); };
    sock.on('close', closeAll);

    const authenticated = () => {
      this.pending.delete(sock);
      if (this.authed.size >= (this.o.maxConnections ?? MCP_LIMITS.maxConnections)) { sock.destroy(); return; } // only authenticated connections count
      this.authed.add(sock);
      this.set(this.st.status, this.st.reason);
      const session = new McpSession({ serverInfo: { name: MCP_SERVER_NAME, version: this.o.version }, methods });
      c.conn = new McpConnection({
        session,
        write: (data) => (sock.destroyed ? true : sock.write(data)),
        onClose: () => sock.destroy(),
        ...(this.o.now ? { now: this.o.now } : {}),
      });
      sock.on('drain', () => c.conn?.drain());
    };

    hs = createServerHandshake({
      key: material.key,
      send: (m) => { sock.write(m + '\n'); },
      timers: this.o.timers ?? DEFAULT_TIMERS,
      timeoutMs: this.o.handshakeTimeoutMs ?? MCP_LIMITS.handshakeTimeoutMs,
      ...(this.o.random ? { random: this.o.random } : {}),
      onDone: (r) => { if (r.ok) authenticated(); else sock.destroy(); }, // a failed handshake gets no reply
    });
    hs.start();

    sock.on('data', (chunk: Buffer) => {
      if (c.conn) { c.conn.onData(chunk); return; }
      if (!hs || hs.done) return;
      // Handshake phase: whole lines go to the handshake; whatever follows the last handshake line goes to the connection.
      const events = framer.push(chunk);
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const live = c.conn as McpConnection | null; // set by the handshake callback while this loop runs
        if (!live) {
          if (ev.type === 'oversize') { sock.destroy(); return; }
          hs.receive(ev.line);
          if (sock.destroyed) return;
        } else if (ev.type === 'line') {
          live.onData(ev.line + '\n');
        }
      }
    });
  }
}
