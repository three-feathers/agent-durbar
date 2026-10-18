/**
 * JSON-RPC 2.0 over newline-delimited UTF-8 (the MCP stdio framing), spec 041 T012 [FR-004, FR-040].
 * Pure: no sockets, no processes. The caller feeds chunks and writes what comes back.
 */

// TODO(T013): move to src/shared/mcpserver.ts (limits) once T010 has landed it.
/** One message, in bytes, without its line break (FR-040). */
export const MAX_MESSAGE_BYTES = 64 * 1024;

export const ERR_PARSE = -32700;
export const ERR_INVALID_REQUEST = -32600;
export const ERR_METHOD_NOT_FOUND = -32601;
export const ERR_INVALID_PARAMS = -32602;
export const ERR_INTERNAL = -32603;

export type JsonRpcId = string | number | null;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}
export interface JsonRpcResult {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: JsonRpcError;
}
export type JsonRpcResponse = JsonRpcResult | JsonRpcErrorResponse;

export function result(id: string | number, value: unknown): JsonRpcResult {
  return { jsonrpc: '2.0', id, result: value };
}
export function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcErrorResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** One framed line, serialised. The JSON never contains a raw line break, so one message is one line. */
export function encodeMessage(msg: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): string {
  return JSON.stringify(msg) + '\n';
}

export type FramerEvent = { type: 'line'; line: string } | { type: 'oversize' };

/**
 * Splits a byte stream into lines. Works on bytes so a multibyte character split across chunks is
 * decoded whole, and the cap counts bytes. An oversize line yields one `oversize` event, the rest of
 * that line is dropped, and the next line is read normally (the stream stays in sync). CRLF is accepted.
 */
export class LineFramer {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private discarding = false;

  constructor(private readonly maxBytes: number = MAX_MESSAGE_BYTES) {}

  push(chunk: Buffer | string): FramerEvent[] {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    const out: FramerEvent[] = [];
    let start = 0;
    while (start < buf.length) {
      const nl = buf.indexOf(0x0a, start);
      const end = nl === -1 ? buf.length : nl;
      if (!this.discarding) {
        // Count the bytes of this piece; a trailing CR may still come, so allow it before judging.
        this.pending.push(buf.subarray(start, end));
        this.pendingBytes += end - start;
        if (this.pendingBytes > this.maxBytes + 1 || (nl !== -1 && this.contentBytes() > this.maxBytes)) {
          out.push({ type: 'oversize' });
          this.pending = [];
          this.pendingBytes = 0;
          this.discarding = nl === -1;
        } else if (nl !== -1) {
          const line = this.take();
          if (line.length > 0) out.push({ type: 'line', line });
        }
      } else if (nl !== -1) {
        this.discarding = false;
      }
      start = nl === -1 ? buf.length : nl + 1;
    }
    return out;
  }

  /** Bytes buffered for the current line, not counting a final CR. */
  private contentBytes(): number {
    const last = this.pending[this.pending.length - 1];
    const endsCr = last !== undefined && last.length > 0 && last[last.length - 1] === 0x0d;
    return this.pendingBytes - (endsCr ? 1 : 0);
  }

  private take(): string {
    let all = Buffer.concat(this.pending);
    this.pending = [];
    this.pendingBytes = 0;
    if (all.length > 0 && all[all.length - 1] === 0x0d) all = all.subarray(0, all.length - 1);
    return all.toString('utf8');
  }
}

export type ParsedMessage =
  | { kind: 'request'; msg: JsonRpcRequest }
  | { kind: 'notification'; msg: JsonRpcNotification }
  | { kind: 'response' } // a reply from the client to us: nothing in this subset sends requests, so it is ignored
  | { kind: 'invalid'; reply: JsonRpcErrorResponse };

/** Parses one line. Malformed input becomes a ready error reply (-32700 / -32600); nothing throws. */
export function parseMessage(line: string): ParsedMessage {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return { kind: 'invalid', reply: errorResponse(null, ERR_PARSE, 'Parse error') };
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return { kind: 'invalid', reply: errorResponse(null, ERR_INVALID_REQUEST, 'Invalid request') };
  }
  const o = v as Record<string, unknown>;
  const idOk = typeof o.id === 'string' || (typeof o.id === 'number' && Number.isFinite(o.id));
  const knownId: JsonRpcId = idOk ? (o.id as string | number) : null;
  if (o.jsonrpc !== '2.0') {
    return { kind: 'invalid', reply: errorResponse(knownId, ERR_INVALID_REQUEST, 'Invalid request') };
  }
  if (typeof o.method === 'string' && o.method.length > 0) {
    if ('id' in o) {
      if (!idOk) return { kind: 'invalid', reply: errorResponse(null, ERR_INVALID_REQUEST, 'Invalid request id') };
      return { kind: 'request', msg: { jsonrpc: '2.0', id: o.id as string | number, method: o.method, params: o.params } };
    }
    return { kind: 'notification', msg: { jsonrpc: '2.0', method: o.method, params: o.params } };
  }
  if ('result' in o || 'error' in o) return { kind: 'response' };
  return { kind: 'invalid', reply: errorResponse(knownId, ERR_INVALID_REQUEST, 'Invalid request') };
}
