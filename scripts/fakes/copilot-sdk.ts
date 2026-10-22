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
  /** What `rpc.name.get` answers (issue #126); null = no name yet. */
  nameAnswer: string | null = null;
  compactAnswer: unknown = { success: true, tokensRemoved: 5000, messagesRemoved: 4, contextWindow: { tokenLimit: 100000, currentTokens: 12000, messagesLength: 3 } };
  removed = true;
  /** Events `send` replays through the handler, in order (a recorded fixture). */
  turnScript: ScriptEvent[] = [];
  /** `send` rejects with this message (spec 040 FR-015 error path). */
  sendFail = '';
  /** `send` never settles (spec 040 FR-015 timeout path). */
  sendHangs = false;
  constructor(public sessionId: string, public config: Record<string, unknown>) {}
  private rec<T>(name: string, v: T, ...args: unknown[]): T { this.calls.push({ name, args }); return v; }
  on(h: (ev: unknown) => void): () => void { this.handler = h; return () => { this.handler = undefined; }; }
  fire(type: string, data: Record<string, unknown>): void { this.handler?.({ type, data }); }
  /** Records the prompt, fires every event of `turnScript` through the session handler, then resolves (what the real runtime does while a turn runs). */
  async send(opts: unknown): Promise<string> {
    this.calls.push({ name: 'send', args: [opts] });
    if (this.sendFail) throw new Error(this.sendFail);
    if (this.sendHangs) return new Promise<string>(() => undefined);
    for (const e of this.turnScript) this.handler?.(e);
    return 'msg-' + this.calls.length;
  }
  getEvents = async (): Promise<unknown[]> => [];
  abort = async (): Promise<void> => this.rec('abort', undefined);
  disconnect = async (): Promise<void> => this.rec('disconnect', undefined);
  rpc = {
    eventLog: { registerInterest: async (a: unknown) => this.rec('registerInterest', undefined, a) },
    options: { update: async (a: unknown) => this.rec('options.update', undefined, a) },
    mode: { set: async (a: unknown) => this.rec('mode.set', { mode: (a as { mode?: string }).mode }, a) }, // spec 066 (plan first)
    model: { switchTo: async (a: unknown) => this.rec('switchTo', this.switchAnswer, a) },
    queue: { removeAt: async (a: unknown) => this.rec('removeAt', { removed: this.removed }, a) },
    history: { compact: async (a: unknown) => this.rec('compact', this.compactAnswer, a) },
    name: {
      get: async () => this.rec('name.get', { name: this.nameAnswer }),
      set: async (a: unknown) => { this.calls.push({ name: 'name.set', args: [a] }); if (this.nameSetFail) throw new Error(this.nameSetFail); },
    },
    metadata: { isProcessing: async () => this.rec('isProcessing', { processing: this.processing }) },
    mcp: {
      enable: async (a: unknown) => this.rec('mcp.enable', undefined, a),
      disable: async (a: unknown) => this.rec('mcp.disable', undefined, a),
      // spec 058 FR-012: per-server restart (@experimental); a test deletes it to act as an older runtime. stopServer and reload are recorded so a test can say they were never used.
      restartServer: async (a: unknown) => this.rec('mcp.restartServer', undefined, a),
      stopServer: async (a: unknown) => this.rec('mcp.stopServer', undefined, a),
      reload: async () => this.rec('mcp.reload', undefined),
    } as Record<string, unknown>,
    // spec 054: remote control (@experimental). `remoteFail` / `visibilityFail` make the call reject with that message.
    remote: {
      enable: async (a: unknown) => { this.calls.push({ name: 'remote.enable', args: [a] }); if (this.remoteFail) throw new Error(this.remoteFail); return this.remoteAnswer; },
      disable: async () => { this.calls.push({ name: 'remote.disable', args: [] }); if (this.remoteFail) throw new Error(this.remoteFail); },
    } as Record<string, unknown> | undefined,
    visibility: {
      get: async () => { this.calls.push({ name: 'visibility.get', args: [] }); if (this.visibilityFail) throw new Error(this.visibilityFail); return this.visibilityAnswer; },
    } as Record<string, unknown> | undefined,
  };
  remoteAnswer: unknown = { url: 'https://github.com/o/r/tasks/1', remoteSteerable: true };
  remoteFail = '';
  /** `rpc.name.set` rejects with this message (spec 059). */
  nameSetFail = '';
  visibilityAnswer: unknown = { synced: true, status: 'unshared', shareUrl: 'https://github.com/o/r/tasks/1' };
  visibilityFail = '';
}

export class FakeClient {
  created: Array<Record<string, unknown>> = [];
  resumed: Array<{ id: string; config: Record<string, unknown> }> = [];
  onDisk = new Set<string>();
  /** Handed to every session this client creates or resumes. */
  turnScript: ScriptEvent[] = [];
  /** `rpc.name.get` answer for every session this client creates or resumes (issue #126). */
  nameAnswer: string | null = null;
  sessions = new Map<string, FakeSession>();
  last!: FakeSession;
  n = 0;
  /** Ids passed to `deleteSession`, in order (spec 040 FR-015). */
  deleted: string[] = [];
  /** Handed to every session this client creates (spec 040 FR-015 error and timeout paths). */
  sendFail = '';
  sendHangs = false;
  /** Handed to every session this client creates or resumes (spec 059). */
  nameSetFail = '';
  private track(s: FakeSession): FakeSession {
    s.turnScript = this.turnScript;
    s.nameAnswer = this.nameAnswer;
    s.sendFail = this.sendFail;
    s.sendHangs = this.sendHangs;
    s.nameSetFail = this.nameSetFail;
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
    if (this.resumeFail.has(id)) throw new Error(`cannot resume ${id}`);
    if (this.resumeGate) { const g = this.resumeGate; this.resumeGate = undefined; await g; } // spec 059: holds the first resume until the test lets it go
    this.resumed.push({ id, config });
    this.last = this.track(new FakeSession(id, config));
    return this.last;
  }
  /** Like the SDK: throws when the session is not on disk. */
  async deleteSession(id: string): Promise<void> {
    this.deleted.push(id);
    if (!this.onDisk.delete(id)) throw new Error(`session ${id} not found`);
  }
  /** Spec 012 FR-158: `stop()` was called (graceful); `stopFail` makes it reject. */
  stopped = 0;
  stopFail = '';
  async stop(): Promise<Error[]> { this.stopped++; if (this.stopFail) throw new Error(this.stopFail); return []; }
  /** Spec 059: the first `resumeSession` waits for this promise (a rename-resume that is still running). */
  resumeGate?: Promise<void>;
  /** `resumeSession` rejects for these ids (FR-158 error path). */
  resumeFail = new Set<string>();
  /** Stored sessions that are not open: id -> the folder Copilot kept for them (spec 059). */
  storedDirs = new Map<string, string>();
  async getSessionMetadata(id: string): Promise<unknown> {
    const dir = this.storedDirs.get(id);
    if (dir !== undefined) return { sessionId: id, context: { workingDirectory: dir } };
    return this.onDisk.has(id) ? { sessionId: id } : undefined;
  }
  async listModels(): Promise<unknown[]> { this.authCalls.push('listModels'); if (this.listModelsFail) throw new Error(this.listModelsFail); return []; }
  /** Spec 012 FR-156: what `getAuthStatus()` says (local), and the server calls `verifySignIn` makes, in order. */
  authenticated = true;
  authStatusFail = '';
  authCalls: string[] = [];
  /** `rpc.account.getQuota` / `rpc.models.list` / `listModels` reject with this message; `noQuota` / `noRpcModels` leave the method out. */
  quotaFail = '';
  modelsFail = '';
  listModelsFail = '';
  noQuota = false;
  noRpcModels = false;
  async getAuthStatus(): Promise<unknown> {
    this.authCalls.push('getAuthStatus');
    if (this.authStatusFail) throw new Error(this.authStatusFail);
    return { isAuthenticated: this.authenticated, authType: 'user', login: 'someone', statusMessage: 'ok' };
  }
  get rpc(): Record<string, unknown> {
    return {
      ...(this.noQuota ? {} : { account: { getQuota: async (p: unknown) => { this.authCalls.push('account.getQuota'); void p; if (this.quotaFail) throw new Error(this.quotaFail); return { quotaSnapshots: {} }; } } }),
      ...(this.noRpcModels ? {} : { models: { list: async () => { this.authCalls.push('models.list'); if (this.modelsFail) throw new Error(this.modelsFail); return { models: [] }; } } }),
    };
  }
}

export class FakeCopilot extends CopilotAdapter {
  constructor(public fake: FakeClient, oneShotTimeoutMs?: number) { super(); if (oneShotTimeoutMs !== undefined) this.oneShotTimeoutMs = oneShotTimeoutMs; }
  protected async getClient(): Promise<never> { return this.fake as never; }
}

/**
 * Spec 012 FR-158: a `CopilotAdapter` whose real `getClient()` caching runs, with a new `FakeClient` from `createClient()` each
 * time (as the SDK starts a new runtime). `clients` lists them in order; `prepare` sets up each new one.
 */
export class RestartingFakeCopilot extends CopilotAdapter {
  clients: FakeClient[] = [];
  constructor(public prepare: (c: FakeClient, n: number) => void = () => undefined) { super(); }
  protected async createClient(): Promise<never> {
    const c = new FakeClient();
    this.prepare(c, this.clients.length);
    this.clients.push(c);
    return c as never;
  }
  currentClient(): Promise<FakeClient> { return this.getClient() as unknown as Promise<FakeClient>; }
}

/** Former name, kept so existing tests keep working. */
export { FakeCopilot as TestAdapter };
