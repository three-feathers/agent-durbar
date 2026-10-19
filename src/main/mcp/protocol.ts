/**
 * The MCP subset Durbar speaks (Q3: dependency-free), spec 041 T012 [FR-004, FR-040]:
 * `initialize` with version negotiation, `notifications/initialized`, `ping`.
 * Everything else is -32601 unless a handler is registered; T013 plugs `tools/list` and `tools/call`
 * in through `methods`. Pure: one `McpSession` per connection, no I/O.
 */
import {
  ERR_INVALID_PARAMS,
  ERR_INVALID_REQUEST,
  ERR_METHOD_NOT_FOUND,
  ERR_INTERNAL,
  JsonRpcErrorResponse,
  JsonRpcResponse,
  errorResponse,
  parseMessage,
  result,
  FramerEvent,
  ERR_NOT_INITIALIZED,
} from './jsonrpc';
import { MCP_LIMITS } from '../../shared/mcpserver';

/** The one list of protocol revisions we accept, newest first. Fixtures are checked against it. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** A handler throws `McpError` to answer with a JSON-RPC error; any other throw is -32603. */
export class McpError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
  }
}

/** May return a Promise; the session awaits it. */
export type MethodHandler = (params: unknown, session: McpSession) => unknown;

export interface McpSessionOptions {
  serverInfo: { name: string; version: string };
  /** Extra request methods (T013: `tools/list`, `tools/call`). Absent methods answer -32601. */
  methods?: Record<string, MethodHandler>;
}

/** Client-reported (self-declared) identity: control characters stripped, 64 chars. */
export interface ClientInfo {
  name: string;
  version: string;
}

/** Self-reported text: no control, format (bidi, zero-width) or lone surrogate characters; 64 code points. */
function clean(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = v.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '');
  return Array.from(t).slice(0, 64).join('');
}

/** A reply is sync unless a handler was async; `null` means nothing to send. */
export type Reply = JsonRpcResponse | null | Promise<JsonRpcResponse | null>;

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';
}
function failure(id: string | number, e: unknown): JsonRpcResponse {
  if (e instanceof McpError) return errorResponse(id, e.code, e.message);
  return errorResponse(id, ERR_INTERNAL, 'Internal error');
}

export class McpSession {
  protocolVersion: string | null = null;
  clientInfo: ClientInfo | null = null;
  /** True after `notifications/initialized`. */
  initialized = false;

  constructor(private readonly opts: McpSessionOptions) {}

  /** One framer event in, zero or one reply out (a Promise when a handler is async). */
  handleEvent(ev: FramerEvent): Reply {
    if (ev.type === 'oversize') {
      return errorResponse(null, ERR_INVALID_REQUEST, `Message too large (over ${MCP_LIMITS.maxMessageBytes} bytes)`);
    }
    return this.handleLine(ev.line);
  }

  handleLine(line: string): Reply {
    const parsed = parseMessage(line);
    switch (parsed.kind) {
      case 'invalid':
        return parsed.reply;
      case 'response':
        return null;
      case 'notification':
        // only a client that completed `initialize` can mark the session ready
        if (parsed.msg.method === 'notifications/initialized' && this.protocolVersion !== null) this.initialized = true;
        return null; // notifications never get a reply, known or not
      case 'request':
        return this.request(parsed.msg.id, parsed.msg.method, parsed.msg.params);
    }
  }

  private request(id: string | number, method: string, params: unknown): Reply {
    try {
      if (method === 'ping') return result(id, {});
      if (method === 'initialize') return this.initialize(id, params);
      // Init gate: nothing else is served before a successful `initialize`.
      if (this.protocolVersion === null) return errorResponse(id, ERR_NOT_INITIALIZED, 'Server not initialized');
      const h = this.opts.methods && Object.prototype.hasOwnProperty.call(this.opts.methods, method) ? this.opts.methods[method] : undefined;
      if (!h) return errorResponse(id, ERR_METHOD_NOT_FOUND, `Method not found: ${clean(method)}`);
      const v = h(params, this);
      if (isThenable(v)) {
        // A rejection is an internal error, never an unhandled rejection and never a leaked message.
        return Promise.resolve(v).then((x) => result(id, x ?? {}), (e) => failure(id, e));
      }
      return result(id, v ?? {});
    } catch (e) {
      return failure(id, e);
    }
  }

  private initialize(id: string | number, params: unknown): JsonRpcResponse {
    if (this.protocolVersion !== null) return errorResponse(id, ERR_INVALID_REQUEST, 'Already initialized');
    const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : null;
    if (!p || typeof p.protocolVersion !== 'string') {
      return errorResponse(id, ERR_INVALID_PARAMS, 'initialize needs params.protocolVersion');
    }
    // MCP: answer with the client's version when we support it, else with ours (the client then decides).
    this.protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : LATEST_PROTOCOL_VERSION;
    const ci = typeof p.clientInfo === 'object' && p.clientInfo !== null ? (p.clientInfo as Record<string, unknown>) : {};
    this.clientInfo = { name: clean(ci.name), version: clean(ci.version) };
    return result(id, {
      protocolVersion: this.protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: this.opts.serverInfo.name, version: this.opts.serverInfo.version },
    });
  }
}

export function isErrorResponse(r: JsonRpcResponse): r is JsonRpcErrorResponse {
  return 'error' in r;
}
