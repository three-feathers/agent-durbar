/**
 * One MCP connection, pure and transport-agnostic (spec 041 T012 follow-up) [FR-040]:
 * framing + per-connection rate limit + a session + ordered, backpressure-aware replies.
 * The owner injects `write` (returns false when its buffer is full, then calls `drain()`), `onClose`
 * and a clock. No sockets here.
 *
 * Rate limit: a token bucket of 10 calls/s per connection, applied to EVERY framed line, valid or not,
 * BEFORE parsing. A line over the limit is dropped: not parsed, not answered (no amplification).
 * Sustained overflow closes the connection: 100 dropped lines within a burst, or drops that keep
 * coming for 3 s (a quiet second between drops starts a new count).
 * Replies leave in request order even when a handler is async (a stricter choice than MCP requires).
 * Backpressure: while `write` has reported a full buffer, nothing more is written (replies wait in
 * order, at most a bucket's worth) and incoming lines are dropped and counted as overflow.
 */
import { JsonRpcResponse, LineFramer, encodeMessage } from './jsonrpc';
import { McpSession } from './protocol';
import { MCP_LIMITS } from '../../shared/mcpserver';

/** Calls per second per connection (spec 041 FR-061), from the shared limits; the two close-after limits below are this module's own. */
export const RATE_PER_SECOND: number = MCP_LIMITS.maxCallsPerSecond;
export const CLOSE_AFTER_DROPPED = 100;
export const CLOSE_AFTER_MS = 3000;

export interface ConnectionOptions {
  session: McpSession;
  /** Writes one framed line; false means the buffer is full: call `drain()` when it empties. */
  write: (data: string) => boolean;
  onClose: (reason: 'overflow') => void;
  now?: () => number;
}

interface Slot {
  done: boolean;
  reply: JsonRpcResponse | null;
}

export class McpConnection {
  closed = false;
  private readonly framer = new LineFramer();
  private readonly now: () => number;
  private tokens = RATE_PER_SECOND;
  private lastRefill: number;
  private dropped = 0;
  private firstDropAt = 0;
  private lastDropAt = 0;
  private blocked = false;
  private readonly queue: Slot[] = [];

  constructor(private readonly o: ConnectionOptions) {
    this.now = o.now ?? Date.now;
    this.lastRefill = this.now();
  }

  onData(chunk: Buffer | string): void {
    if (this.closed) return;
    for (const ev of this.framer.push(chunk)) {
      if (this.closed) return;
      if (this.blocked || !this.take()) {
        this.drop();
        continue;
      }
      const slot: Slot = { done: false, reply: null };
      this.queue.push(slot);
      const r = this.o.session.handleEvent(ev);
      if (r !== null && typeof (r as Promise<unknown>).then === 'function') {
        (r as Promise<JsonRpcResponse | null>).then(
          (v) => this.finish(slot, v),
          () => this.finish(slot, null), // the session already maps rejections; this is a last guard
        );
      } else {
        slot.done = true;
        slot.reply = r as JsonRpcResponse | null;
      }
    }
    this.flush();
  }

  /** The writer's buffer emptied. */
  drain(): void {
    this.blocked = false;
    this.flush();
  }

  private finish(slot: Slot, v: JsonRpcResponse | null): void {
    slot.done = true;
    slot.reply = v;
    this.flush();
  }

  private flush(): void {
    while (!this.closed && !this.blocked && this.queue.length > 0 && this.queue[0].done) {
      const slot = this.queue.shift() as Slot;
      if (slot.reply && !this.o.write(encodeMessage(slot.reply))) this.blocked = true;
    }
  }

  private take(): boolean {
    const t = this.now();
    this.tokens = Math.min(RATE_PER_SECOND, this.tokens + ((t - this.lastRefill) / 1000) * RATE_PER_SECOND);
    this.lastRefill = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private drop(): void {
    const t = this.now();
    if (t - this.lastDropAt > 1000) {
      this.dropped = 0;
      this.firstDropAt = t;
    }
    this.dropped++;
    this.lastDropAt = t;
    if (this.dropped >= CLOSE_AFTER_DROPPED || t - this.firstDropAt >= CLOSE_AFTER_MS) {
      this.closed = true;
      this.queue.length = 0;
      this.o.onClose('overflow');
    }
  }
}
