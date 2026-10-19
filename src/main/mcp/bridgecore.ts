/**
 * Durbar MCP bridge core, spec 041 T018 [FR-005, FR-034, FR-058, Q11, US1-1, US1-5].
 * The stdio side of the bridge, pure and over injected streams: no Electron, no `net`, no `process`.
 *
 * What it does:
 * - Frames stdin (64 KB cap per message) and relays JSON-RPC lines to Durbar over an authenticated link, and
 *   relays Durbar's replies to stdout. `initialize` and `ping` are always answered here, so the client sees the
 *   same answer whether or not Durbar runs; the bridge replays the client's `initialize` (and
 *   `notifications/initialized`) to Durbar on every new connection, which is what lets a call after Durbar
 *   started (or restarted) just work.
 * - Connects lazily, on the next request that needs Durbar, and never starts Durbar (FR-005, Q11).
 * - With no server it answers `tools/list` from the static registry and every `tools/call` with an `isError`
 *   text: "Durbar is not running" when a key file exists, "the MCP server is off" when it does not (SC-005).
 * - With the agent marker set it never connects: `initialize` works, every `tools/call` is refused (FR-034).
 * - Exits when stdin ends (after the answers still owed, for a short grace time).
 *
 * Output rules: stdout carries JSON-RPC and nothing else (`emit` is the only way out, and a line from Durbar is
 * forwarded only if it parses as a JSON-RPC object). The key is only handed to the handshake; it never reaches
 * a message, a log or an error text, and nothing is logged here.
 */
import { MCP_LIMITS, MCP_SERVER_NAME } from '../../shared/mcpserver';
import { KeyReadResult, Timers, createBridgeHandshake } from './auth';
import type { PeerInfo } from './auth';
import { ERR_INTERNAL, LineFramer, encodeMessage, errorResponse, parseMessage, result } from './jsonrpc';
import type { FramerEvent, JsonRpcId, JsonRpcResponse } from './jsonrpc';
import { McpError, McpSession } from './protocol';
import { READ_TOOLS } from './tools';
import type { ToolDef } from './tools';

/** Fixed texts. None of them can contain the key. */
export const BRIDGE_TEXT = {
  notRunning: 'Durbar is not running. Start Durbar and call this tool again: the bridge connects on the next call.',
  off: "Durbar's MCP server is off. Turn it on in Durbar, Settings > MCP server.",
  noAnswer: 'Durbar is not answering. Try again in a moment, or restart Durbar.',
  authFailed: "Durbar did not accept the connection key. In Durbar, Settings > MCP server, turn the server off and on again.",
  keyUnusable: 'The connection key file is not safe to use. In Durbar, Settings > MCP server, turn the server off and on again.',
  agent: 'Durbar does not accept connections from inside an agent.',
  lost: 'Durbar closed the connection before it answered. Call this tool again.',
} as const;

/** Largest reply the bridge relays from Durbar, in bytes. Read tools can return lists; the 64 KB cap is for what the client sends. */
const MAX_UPSTREAM_LINE_BYTES = 8 * 1024 * 1024;
/** The id the bridge uses for the `initialize` it replays on a new connection. */
const REPLAY_INIT_ID = 'durbar-bridge-init';

/** One open connection to Durbar. The core sets the callbacks right after `connect` resolves; the link must not deliver anything before that. */
export interface Link {
  write(data: string): void;
  end(): void;
  onData(cb: (chunk: Buffer) => void): void;
  onClose(cb: () => void): void;
}

export interface BridgeDeps {
  /** Reads the key file (synchronous). `missing` means the server is off. */
  readKey(): KeyReadResult;
  /** Socket or pipe to dial for this install; null when there is none. */
  socketFor(pipeId: string): string | null;
  /** Rejects when nobody answers. */
  connect(socket: string): Promise<Link>;
  /** One framed line (ends with a newline). The ONLY way anything reaches stdout. */
  stdout(data: string): void;
  /** Called once, when the bridge is done. */
  exit(code: number): void;
  /** The runtime marker (FR-034) is present in the environment. */
  marker: boolean;
  /** App version for `serverInfo`. */
  version: string;
  timers: Timers;
  /** Name of the client process that started the bridge, when known (shown to the user, labelled as reported). */
  parent?: string;
  tools?: () => readonly ToolDef[];
  random?: (n: number) => Buffer;
  /** Defaults to the handshake timeout (2 s). */
  handshakeTimeoutMs?: number;
  /** How long a replayed `initialize` may take. Default 2 s. */
  initTimeoutMs?: number;
  /** After stdin ends, how long to wait for answers still owed. Default 1.5 s. */
  graceMs?: number;
}

interface Up {
  link: Link;
  phase: 'handshake' | 'init' | 'live' | 'dead';
  framer: LineFramer;
  /** Requests sent to Durbar and not answered yet: id -> method. */
  pending: Map<string, string>;
}

type Offline = 'not-running' | 'off' | 'auth-failed' | 'no-answer' | 'key-unusable';

const idKey = (id: JsonRpcId): string => `${typeof id}:${String(id)}`;

export class BridgeCore {
  private readonly framer = new LineFramer(MCP_LIMITS.maxMessageBytes);
  private readonly local: McpSession;
  private up: Up | null = null;
  private chain: Promise<void> = Promise.resolve();
  private initParams: unknown = undefined;
  private clientInitialized = false;
  private offline: { code: Offline; text: string } = { code: 'not-running', text: BRIDGE_TEXT.notRunning };
  private ended = false;
  private exited = false;
  private graceTimer: unknown = null;

  constructor(private readonly d: BridgeDeps) {
    const tools = () => (d.tools ? d.tools() : READ_TOOLS);
    this.local = new McpSession({
      serverInfo: { name: MCP_SERVER_NAME, version: d.version },
      methods: {
        'tools/list': () => ({ tools: tools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }),
        'tools/call': (params) => {
          const p = typeof params === 'object' && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : null;
          if (!p || typeof p.name !== 'string') throw new McpError(-32602, 'Invalid params');
          return { content: [{ type: 'text', text: this.d.marker ? BRIDGE_TEXT.agent : this.offline.text }], isError: true };
        },
      },
    });
  }

  /** The state of the link, for tests. */
  get connected(): boolean {
    return this.up?.phase === 'live';
  }

  /** Bytes from stdin. */
  onStdin(chunk: Buffer | string): void {
    if (this.ended) return;
    for (const ev of this.framer.push(chunk)) this.enqueue(() => this.handleEvent(ev));
  }

  /** stdin closed: finish what is queued, give owed answers a moment, then exit (once). */
  onStdinEnd(): void {
    if (this.ended) return;
    this.ended = true;
    this.enqueue(async () => {
      if (this.owed() === 0) return this.finish();
      this.graceTimer = this.d.timers.setTimeout(() => this.finish(), this.d.graceMs ?? 1500);
    });
  }

  private owed(): number {
    return this.up ? this.up.pending.size : 0;
  }

  private finish(): void {
    if (this.exited) return;
    this.exited = true;
    if (this.graceTimer !== null) { try { this.d.timers.clearTimeout(this.graceTimer); } catch { /* ignore */ } this.graceTimer = null; }
    const up = this.up;
    this.up = null;
    if (up) { up.phase = 'dead'; try { up.link.end(); } catch { /* closing */ } }
    this.d.exit(0);
  }

  private enqueue(fn: () => Promise<void> | void): void {
    this.chain = this.chain.then(fn).catch(() => undefined); // a bug in one message must not stop the next
  }

  private emit(msg: JsonRpcResponse): void {
    this.d.stdout(encodeMessage(msg));
  }

  private emitLocal(r: ReturnType<McpSession['handleLine']>): void | Promise<void> {
    if (r === null) return;
    if (typeof (r as Promise<unknown>).then === 'function') return (r as Promise<JsonRpcResponse | null>).then((v) => { if (v) this.emit(v); });
    this.emit(r as JsonRpcResponse);
  }

  private async handleEvent(ev: FramerEvent): Promise<void> {
    if (this.exited) return;
    if (ev.type === 'oversize') return void (await this.emitLocal(this.local.handleEvent(ev)));
    const parsed = parseMessage(ev.line);
    switch (parsed.kind) {
      case 'invalid':
        return this.emit(parsed.reply);
      case 'response':
        return; // a client reply to a Durbar-initiated request is dropped: the server sends none today
      case 'notification': {
        if (parsed.msg.method === 'notifications/initialized' && this.local.protocolVersion !== null && !this.clientInitialized) {
          this.clientInitialized = true;
          this.local.handleLine(ev.line);
        }
        if (this.up?.phase === 'live') this.up.link.write(ev.line + '\n'); // never connects just for a notification
        return;
      }
      case 'request': {
        const { id, method } = parsed.msg;
        if (method === 'initialize' || method === 'ping' || this.d.marker || this.local.protocolVersion === null) {
          const r = await this.local.handleLine(ev.line);
          // remember the client's handshake so a later connection can replay it
          if (method === 'initialize' && this.local.protocolVersion !== null && this.initParams === undefined) this.initParams = parsed.msg.params;
          if (r) this.emit(r);
          return;
        }
        // Everything else needs Durbar: use the open link, or try to open one (the next call after Durbar started).
        const up = this.up?.phase === 'live' ? this.up : await this.connect();
        if (up && up.phase === 'live') {
          up.pending.set(idKey(id), method);
          up.link.write(ev.line + '\n');
          return;
        }
        const r = await this.local.handleLine(ev.line);
        if (r) this.emit(r);
      }
    }
  }

  // ---- Durbar side ----

  private setOffline(code: Offline): null {
    const text = code === 'off' ? BRIDGE_TEXT.off : code === 'auth-failed' ? BRIDGE_TEXT.authFailed : code === 'no-answer' ? BRIDGE_TEXT.noAnswer : code === 'key-unusable' ? BRIDGE_TEXT.keyUnusable : BRIDGE_TEXT.notRunning;
    this.offline = { code, text };
    return null;
  }

  /** Reads the key file, dials, authenticates, replays the client's handshake. Null (and `this.offline` set) when it cannot. */
  private async connect(): Promise<Up | null> {
    let k: KeyReadResult;
    try { k = this.d.readKey(); } catch { return this.setOffline('key-unusable'); }
    if (!k.ok) return this.setOffline(k.reason === 'missing' ? 'off' : 'key-unusable');
    const socket = this.d.socketFor(k.material.pipeId);
    if (socket === null) return this.setOffline('not-running');
    let link: Link;
    try { link = await this.d.connect(socket); } catch { return this.setOffline('not-running'); }
    const up = await this.authenticate(link, k.material.key);
    if (typeof up === 'string') return this.setOffline(up);
    if (this.exited) { up.phase = 'dead'; try { link.end(); } catch { /* closing */ } return null; }
    this.up = up;
    return up;
  }

  /** `auth-failed`: the handshake did not finish. `no-answer`: it did, but the replayed `initialize` timed out, failed or the link closed. */
  private authenticate(link: Link, key: Buffer): Promise<Up | 'auth-failed' | 'no-answer'> {
    return new Promise<Up | 'auth-failed' | 'no-answer'>((resolve) => {
      const up: Up = { link, phase: 'handshake', framer: new LineFramer(MCP_LIMITS.maxMessageBytes), pending: new Map() };
      let settled = false;
      let initTimer: unknown = null;
      let wasInit = false; // set when the failure came after the handshake
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (initTimer !== null) { try { this.d.timers.clearTimeout(initTimer); } catch { /* ignore */ } initTimer = null; }
        if (!ok) { wasInit = up.phase === 'init'; up.phase = 'dead'; try { link.end(); } catch { /* closing */ } }
        resolve(ok ? up : wasInit ? 'no-answer' : 'auth-failed');
      };
      const peer: PeerInfo = { marker: false, ...(this.d.parent !== undefined ? { parent: this.d.parent } : {}) };
      const hs = createBridgeHandshake({
        key,
        peer,
        send: (m) => link.write(m + '\n'),
        timers: this.d.timers,
        ...(this.d.random ? { random: this.d.random } : {}),
        ...(this.d.handshakeTimeoutMs !== undefined ? { timeoutMs: this.d.handshakeTimeoutMs } : {}),
        onDone: (r) => {
          if (!r.ok) return settle(false);
          if (this.initParams === undefined) { up.phase = 'live'; return settle(true); }
          // Durbar's session starts un-initialized: replay what the client said, and swallow the answer.
          up.phase = 'init';
          initTimer = this.d.timers.setTimeout(() => settle(false), this.d.initTimeoutMs ?? MCP_LIMITS.handshakeTimeoutMs);
          link.write(JSON.stringify({ jsonrpc: '2.0', id: REPLAY_INIT_ID, method: 'initialize', params: this.initParams }) + '\n');
        },
      });
      // The upstream framer is bigger than the client one: replies (lists) can be long.
      const rx = new LineFramer(MAX_UPSTREAM_LINE_BYTES);
      link.onClose(() => {
        if (up.phase === 'live') this.lost(up);
        hs.abort();
        settle(false); // reads the phase before it is marked dead
        up.phase = 'dead';
      });
      link.onData((chunk) => {
        for (const ev of rx.push(chunk)) {
          if (up.phase === 'dead' || ev.type !== 'line') continue;
          if (up.phase === 'handshake') { hs.receive(ev.line); continue; }
          if (up.phase === 'init') { this.initReply(up, ev.line, settle); continue; }
          this.fromDurbar(up, ev.line);
        }
      });
      hs.start();
    });
  }

  private initReply(up: Up, line: string, settle: (ok: boolean) => void): void {
    let o: unknown;
    try { o = JSON.parse(line); } catch { return; }
    if (typeof o !== 'object' || o === null || (o as Record<string, unknown>).id !== REPLAY_INIT_ID) return;
    if (!('result' in (o as object))) return settle(false);
    if (this.clientInitialized) up.link.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    up.phase = 'live';
    settle(true);
  }

  /** A line from Durbar: relayed only when it is a JSON-RPC object, so nothing else can reach stdout. */
  private fromDurbar(up: Up, line: string): void {
    let o: unknown;
    try { o = JSON.parse(line); } catch { return; }
    if (typeof o !== 'object' || o === null || Array.isArray(o) || (o as Record<string, unknown>).jsonrpc !== '2.0') return;
    const m = o as Record<string, unknown>;
    if (('result' in m || 'error' in m) && (typeof m.id === 'string' || typeof m.id === 'number')) up.pending.delete(idKey(m.id));
    if (this.exited) return;
    this.d.stdout(line + '\n');
    if (this.ended && up.pending.size === 0) this.finish();
  }

  /** The link dropped while requests were in flight: answer each one, so the client is not left waiting. */
  private lost(up: Up): void {
    if (this.up === up) this.up = null;
    const owed = [...up.pending.entries()];
    up.pending.clear();
    if (!this.exited) {
      for (const [key, method] of owed) {
        const raw = key.slice(key.indexOf(':') + 1);
        const id: string | number = key.startsWith('number:') ? Number(raw) : raw;
        this.emit(method === 'tools/call'
          ? result(id, { content: [{ type: 'text', text: BRIDGE_TEXT.lost }], isError: true })
          : errorResponse(id, ERR_INTERNAL, 'Internal error'));
      }
    }
    if (this.ended) this.finish();
  }
}
