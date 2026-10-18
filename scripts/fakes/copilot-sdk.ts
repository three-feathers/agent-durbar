/**
 * Fake Copilot SDK for tests (spec 012 FR-055): a client and a session that record every call, plus `FakeCopilot`, a `CopilotAdapter`
 * that uses the fake client through the protected `getClient()` seam. No runtime process, no Copilot account, no credits.
 * `FakeSession.send` replays a recorded turn (`turnScript`) through the session handler.
 */
import { CopilotAdapter } from '../../src/adapters/copilot';

export type ScriptEvent = { type: string; data: unknown; agentId?: string | null };
export type Call = { name: string; args: unknown[] };

/** A session that records every call and answers from a script. */
export class FakeSession {
  calls: Call[] = [];
  handler: ((ev: unknown) => void) | undefined;
  processing = false;
  switchAnswer: unknown = { modelId: 'sim-deep' };
  compactAnswer: unknown = { success: true, tokensRemoved: 5000, messagesRemoved: 4, contextWindow: { tokenLimit: 100000, currentTokens: 12000, messagesLength: 3 } };
  removed = true;
  /** Events `send` replays through the handler, in order (a recorded fixture). */
  turnScript: ScriptEvent[] = [];
  constructor(public sessionId: string, public config: Record<string, unknown>) {}
  private rec<T>(name: string, v: T, ...args: unknown[]): T { this.calls.push({ name, args }); return v; }
  on(h: (ev: unknown) => void): () => void { this.handler = h; return () => { this.handler = undefined; }; }
  fire(type: string, data: Record<string, unknown>): void { this.handler?.({ type, data }); }
  /** Records the prompt, fires every event of `turnScript` through the session handler, then resolves (what the real runtime does while a turn runs). */
  async send(opts: unknown): Promise<string> {
    this.calls.push({ name: 'send', args: [opts] });
    for (const e of this.turnScript) this.handler?.(e);
    return 'msg-' + this.calls.length;
  }
  getEvents = async (): Promise<unknown[]> => [];
  abort = async (): Promise<void> => this.rec('abort', undefined);
  disconnect = async (): Promise<void> => this.rec('disconnect', undefined);
  rpc = {
    eventLog: { registerInterest: async (a: unknown) => this.rec('registerInterest', undefined, a) },
    options: { update: async (a: unknown) => this.rec('options.update', undefined, a) },
    model: { switchTo: async (a: unknown) => this.rec('switchTo', this.switchAnswer, a) },
    queue: { removeAt: async (a: unknown) => this.rec('removeAt', { removed: this.removed }, a) },
    history: { compact: async (a: unknown) => this.rec('compact', this.compactAnswer, a) },
    metadata: { isProcessing: async () => this.rec('isProcessing', { processing: this.processing }) },
  };
}

export class FakeClient {
  created: Array<Record<string, unknown>> = [];
  resumed: Array<{ id: string; config: Record<string, unknown> }> = [];
  onDisk = new Set<string>();
  /** Handed to every session this client creates or resumes. */
  turnScript: ScriptEvent[] = [];
  sessions = new Map<string, FakeSession>();
  last!: FakeSession;
  n = 0;
  private track(s: FakeSession): FakeSession {
    s.turnScript = this.turnScript;
    this.sessions.set(s.sessionId, s);
    return s;
  }
  async createSession(config: Record<string, unknown>): Promise<FakeSession> {
    this.created.push(config);
    this.last = this.track(new FakeSession((config.sessionId as string) ?? 'fake-' + ++this.n, config));
    this.onDisk.add(this.last.sessionId);
    return this.last;
  }
  async resumeSession(id: string, config: Record<string, unknown>): Promise<FakeSession> {
    this.resumed.push({ id, config });
    this.last = this.track(new FakeSession(id, config));
    return this.last;
  }
  async getSessionMetadata(id: string): Promise<unknown> { return this.onDisk.has(id) ? { sessionId: id } : undefined; }
  async listModels(): Promise<unknown[]> { return []; }
}

export class FakeCopilot extends CopilotAdapter {
  constructor(public fake: FakeClient) { super(); }
  protected async getClient(): Promise<never> { return this.fake as never; }
}

/** Former name, kept so existing tests keep working. */
export { FakeCopilot as TestAdapter };
