/**
 * Fake MCP client for tests (spec 041 T012). Talks to an `McpSession` through the real framing, in
 * memory: no socket, no process. Later tasks reuse the same client over a real socket by passing their
 * own `write` and calling `onData`. `chunkSize` splits what is written, to exercise partial reads.
 */
import { LineFramer } from '../../src/main/mcp/jsonrpc';
import { McpConnection, ConnectionOptions } from '../../src/main/mcp/connection';
import { McpSession } from '../../src/main/mcp/protocol';

export class FakeMcpClient {
  /** Every parsed reply line, in order. */
  readonly replies: any[] = [];
  private readonly rx = new LineFramer();
  private nextId = 1;

  constructor(private readonly write: (chunk: Buffer) => void, private readonly chunkSize = 0) {}

  /** Feed bytes that came from the server. */
  onData(chunk: Buffer): void {
    for (const ev of this.rx.push(chunk)) if (ev.type === 'line') this.replies.push(JSON.parse(ev.line));
  }

  sendRaw(data: string | Buffer): void {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    if (!this.chunkSize) return this.write(buf);
    for (let i = 0; i < buf.length; i += this.chunkSize) this.write(buf.subarray(i, i + this.chunkSize));
  }

  send(msg: object): void {
    this.sendRaw(JSON.stringify(msg) + '\n');
  }

  /** Sends a request and returns the reply that arrived (loopback is synchronous). */
  request(method: string, params?: unknown): any {
    const id = this.nextId++;
    const before = this.replies.length;
    this.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    const r = this.replies.slice(before).find((x) => x.id === id);
    if (!r) throw new Error(`no reply to ${method}`);
    return r;
  }

  /** For async handlers: send a request and wait (a few turns of the event loop) for its reply. */
  async requestAsync(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    for (let i = 0; i < 50; i++) {
      const r = this.replies.find((x) => x.id === id);
      if (r) return r;
      await new Promise((res) => setImmediate(res));
    }
    throw new Error(`no reply to ${method}`);
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }
}

/**
 * A client wired straight to a session through `McpConnection` (framing, rate limit, ordered replies).
 * `conn` is exposed so tests can call `drain()`; `extra` overrides the writer, clock or close hook.
 */
export function loopback(session: McpSession, chunkSize = 0, extra: Partial<ConnectionOptions> = {}): FakeMcpClient & { conn: McpConnection } {
  const client: FakeMcpClient & { conn: McpConnection } = new FakeMcpClient((chunk) => conn.onData(chunk), chunkSize) as FakeMcpClient & { conn: McpConnection };
  const conn = new McpConnection({
    session,
    write: (data) => {
      client.onData(Buffer.from(data, 'utf8'));
      return true;
    },
    onClose: () => {},
    ...extra,
  });
  client.conn = conn;
  return client;
}
