/**
 * A scripted adapter for tests (spec 012 FR-051). Pure: no SDK, no file system, no processes, no Electron.
 * Test and simulator double only: never register it in the production registry (`main.ts` registers only real
 * descriptors, see `descriptors.ts`; `test-router.ts` guards it). It lives in `src/` so a future simulator mode
 * (`DURBAR_SIM_MAIN`, spec 012 plan) can use it. Its optional members exist exactly when its capabilities say so (FR-027), and it
 * follows the same permission rules as the real adapters through `PermissionBroker` and `startModeOf` (FR-028, FR-052).
 */
import type { AdapterCapabilities } from './capabilities';
import type { HandoffResult } from './handoff';
import type { EventBody } from './map';
import { PermissionBroker, mcpToolBlockList, startModeOf } from './permissions';
import type { BrokerEvent, PermissionLike } from './permissions';
import { normMcpTools } from './mcptools';
import type { AgentAdapter, AgentEvent, AgentMessage, CompactResult, LimitAction, McpSignInResult, McpToolInfo, ModelOption, ModelSwitchRequest, ModelSwitchResult, PermissionMode, StartOptions, UsageEvent } from './types';
import type { HistoryResult, PreviousSession } from './history';

export type OptionalMember =
  | 'interrupt' | 'resolvePermission' | 'revokeGrant' | 'setCap' | 'resolveLimit' | 'setMcpEnabled' | 'setModel'
  | 'cancelQueuedModel' | 'compact' | 'listModelOptions' | 'listPreviousSessions' | 'history' | 'setPermMode' | 'handoffSummary' | 'generateText' | 'renameSession' | 'deleteSession' | 'restartMcpServer' | 'listMcpTools'
  | 'startMcpSignIn' | 'cancelMcpSignIn' | 'refreshMcpStatus';

export type Step =
  | { output: string }
  | { thinking: string }
  | { tool: string; args?: unknown }
  | { usage: Partial<UsageEvent> }
  | { permission: PermissionLike }
  | { wait: number };

export interface FakeConfig {
  id?: string;
  displayName?: string;
  capabilities?: Partial<AdapterCapabilities>;
  omit?: OptionalMember[];
  script?: Step[];
  /** Earlier sessions `listPreviousSessions` answers with (a delete removes one). */
  previous?: PreviousSession[];
}

const DEFAULT_CAPS: AdapterCapabilities = {
  interrupt: true,
  resume: true,
  images: true,
  models: true,
  effort: true,
  permissionModes: ['read-only', 'ask', 'allow'],
  permModeSwitch: 'live',
  usage: { tokens: true, costUsd: false, nanoAiu: false },
  context: true,
  caps: true,
  helpers: true,
  history: true,
  mcpStatus: true,
  mcpToggle: true,
  mcpRestart: true,
  mcpTools: true,
  mcpToolFilter: true,
  handoff: true,
  oneShot: true,
};

interface FakeSession {
  broker: PermissionBroker;
  workspace: string;
  /** Bumped by `interrupt` and `stop`: a running turn that sees another value ends without emitting more. */
  epoch: number;
  wake?: () => void;
}

const FAKE_MODEL: ModelOption = { id: 'fake-model', name: 'Fake model', efforts: [], disabled: false };

export class FakeAdapter implements AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: AdapterCapabilities;
  debug?: (message: string) => void;
  // Optional members: `declare` keeps them off the instance until the constructor assigns them (FR-027).
  declare interrupt?: (sessionId: string) => Promise<void>;
  declare resolvePermission?: (sessionId: string, requestId: string, approve: boolean, remember?: boolean, broad?: boolean) => void;
  declare revokeGrant?: (sessionId: string, key: string) => void;
  declare setCap?: (sessionId: string, credits: number | null) => Promise<void>;
  declare resolveLimit?: (sessionId: string, requestId: string, action: LimitAction) => Promise<void>;
  declare setMcpEnabled?: (sessionId: string, name: string, enabled: boolean) => Promise<void>;
  declare restartMcpServer?: (sessionId: string, name: string) => Promise<void>;
  /** Spec 058: every `restartMcpServer` call, in order. */
  readonly restartCalls: Array<{ sessionId: string; name: string }> = [];
  /** Spec 058: when set, `restartMcpServer` rejects with this message. */
  failRestart?: string;
  declare listMcpTools?: (sessionId: string, name: string) => Promise<McpToolInfo[]>;
  /** Spec 069: what `listMcpTools` answers per server name (raw, as an agent app would send it), or a rejection text. */
  toolsByServer: Record<string, unknown> = {};
  failTools?: string;
  declare setModel?: (sessionId: string, request: ModelSwitchRequest) => Promise<ModelSwitchResult>;
  declare cancelQueuedModel?: (sessionId: string, queueId: string) => Promise<void>;
  declare compact?: (sessionId: string, focus?: string) => Promise<CompactResult>;
  declare listModelOptions?: () => Promise<ModelOption[]>;
  declare listPreviousSessions?: (cwd: string, excludeIds?: ReadonlySet<string>) => Promise<PreviousSession[]>;
  declare history?: (sessionId: string) => Promise<HistoryResult>;
  declare handoffSummary?: (sessionId: string) => Promise<HandoffResult>;
  declare generateText?: (prompt: string) => Promise<{ text: string; costUsd?: number }>;
  declare renameSession?: (sessionId: string, name: string) => Promise<void>;
  declare startMcpSignIn?: (sessionId: string, name: string, opts?: { again?: boolean }) => Promise<McpSignInResult>;
  declare cancelMcpSignIn?: (sessionId: string, name: string) => Promise<void>;
  declare refreshMcpStatus?: (sessionId: string, name?: string) => Promise<void>;
  /** Spec 058: how many `refreshMcpStatus` calls were made, and when (call number N) the named server is reported connected (a test of the poll). */
  refreshCalls = 0;
  connectOnRefresh?: { name: string; at: number };
  /** Spec 058 FR-180: on read number N, report the named server with this `signInEnd` (still needs-auth), as an adapter that learned how its sign-in ended. */
  endOnRefresh?: { name: string; at: number; end: 'next-message' | 'failed'; error?: string };
  /** Every name `refreshMcpStatus` was called with (undefined = no name). */
  readonly refreshNames: Array<string | undefined> = [];
  /** Test hook: a refresh that takes this long (ms) or never settles (`Infinity`), to see that calls never overlap. */
  refreshDelay?: number;
  refreshFail?: string;
  /** Spec 058: every `startMcpSignIn` / `cancelMcpSignIn` call, in order (test log; no browser is opened). */
  readonly signInCalls: Array<{ sessionId: string; name: string; cancel?: true; again?: true }> = [];
  /** Spec 058: what the next `startMcpSignIn` resolves with. */
  signInResult: McpSignInResult = { kind: 'browser', url: 'https://auth.example.test/authorize' };
  declare deleteSession?: (sessionId: string) => Promise<void>;
  /** Every id `deleteSession` was called with (test log; nothing real is deleted). */
  readonly deleteCalls: string[] = [];
  declare setPermMode?: (sessionId: string, mode: PermissionMode, opts?: { clearGrants?: boolean; approvePending?: boolean }) => { pending: number };

  /** Spec 059: every `renameSession` call, in order. */
  readonly renameCalls: Array<{ sessionId: string; name: string }> = [];
  /** Spec 059: when set, the next `renameSession` calls throw this message (cleared by setting it to undefined). */
  failRename?: string;

  private listeners = new Set<(event: AgentEvent) => void>();
  private sessions = new Map<string, FakeSession>();
  private script: Step[];
  private previous: PreviousSession[];
  private counter = 0;
  private calls = 0;

  constructor(cfg: FakeConfig = {}) {
    this.id = cfg.id ?? 'fake';
    this.displayName = cfg.displayName ?? 'Fake agent';
    this.script = cfg.script ?? [{ output: 'fake reply' }];
    this.previous = (cfg.previous ?? []).map((p) => ({ ...p }));
    const omit = new Set(cfg.omit ?? []);
    const c: AdapterCapabilities = { ...DEFAULT_CAPS, ...cfg.capabilities, usage: { ...DEFAULT_CAPS.usage, ...cfg.capabilities?.usage } };
    // An omitted member forces its capability off; a capability that is off removes every member it covers (FR-027).
    const caps = {
      ...c,
      interrupt: c.interrupt && !omit.has('interrupt'),
      models: c.models && !omit.has('listModelOptions'),
      history: c.history && !omit.has('listPreviousSessions') && !omit.has('history'),
      caps: c.caps && !omit.has('setCap') && !omit.has('resolveLimit'),
      mcpToggle: c.mcpToggle && !omit.has('setMcpEnabled'),
      mcpRestart: !!c.mcpRestart && !omit.has('restartMcpServer'),
      mcpTools: !!c.mcpTools && !omit.has('listMcpTools'),
      handoff: !!c.handoff && !omit.has('handoffSummary'),
      oneShot: !!c.oneShot && !omit.has('generateText'),
      mcpSignIn: !!c.mcpSignIn && !omit.has('startMcpSignIn'),
      deleteSession: !!c.deleteSession && !omit.has('deleteSession'),
      permModeSwitch: omit.has('setPermMode') ? ('none' as const) : c.permModeSwitch,
    };
    if (!caps.mcpSignIn) delete (caps as { mcpSignIn?: unknown }).mcpSignIn;
    if (c.mcpSignInSteps === undefined) delete (caps as { mcpSignInSteps?: unknown }).mcpSignInSteps;
    if (c.mcpSignInNote === undefined) delete (caps as { mcpSignInNote?: unknown }).mcpSignInNote;
    if (!c.mcpSignInRestart || !caps.mcpRestart) delete (caps as { mcpSignInRestart?: unknown }).mcpSignInRestart;
    if (!c.renameSession || omit.has('renameSession')) delete (caps as { renameSession?: unknown }).renameSession;
    this.capabilities = caps;
    const has = (m: OptionalMember): boolean => !omit.has(m);
    if (caps.interrupt && has('interrupt')) this.interrupt = (sid) => this.doInterrupt(sid);
    if (has('resolvePermission')) this.resolvePermission = (sid, rid, approve, remember = false, broad = false) => void this.sessions.get(sid)?.broker.resolve(rid, approve, remember, broad);
    if (has('revokeGrant')) this.revokeGrant = (sid, key) => void this.sessions.get(sid)?.broker.revoke(key);
    if (caps.caps) {
      this.setCap = async (sid, credits) => {
        this.mustGet(sid);
        if (credits !== null && !(credits > 0 && Number.isFinite(credits))) throw new Error('Invalid credit cap.');
        this.emit(sid, { type: 'limit', phase: 'changed', maxAiCredits: credits });
      };
      this.resolveLimit = async (sid, requestId, action) => {
        this.mustGet(sid);
        this.emit(sid, { type: 'limit', phase: 'resolved', requestId, action: action.kind });
      };
    }
    if (caps.mcpToggle) this.setMcpEnabled = async (sid) => void this.mustGet(sid);
    if (caps.mcpRestart) {
      this.restartMcpServer = async (sid, name) => {
        this.restartCalls.push({ sessionId: sid, name });
        if (!this.sessions.has(sid)) throw new Error('This session is not running. Send a message to start it.');
        if (this.failRestart !== undefined) throw new Error(this.failRestart);
        this.emit(sid, { type: 'mcp', servers: [{ name, status: 'connected' }] });
      };
    }
    if (caps.mcpTools) {
      this.listMcpTools = async (sid, name) => {
        if (!this.sessions.has(sid)) throw new Error('This session is not running. Send a message to start it.');
        if (this.failTools !== undefined) throw new Error(this.failTools);
        if (!(name in this.toolsByServer)) throw new Error(`${name} is not running in this session.`);
        return normMcpTools(this.toolsByServer[name]);
      };
    }
    if (caps.mcpSignIn) {
      if (has('startMcpSignIn')) {
        this.startMcpSignIn = async (sid, name, opts) => {
          this.mustGet(sid);
          this.signInCalls.push({ sessionId: sid, name, ...(opts?.again === true ? { again: true } : {}) });
          return this.signInResult;
        };
      }
      if (has('refreshMcpStatus')) {
        this.refreshMcpStatus = async (sid, name?: string) => {
          this.mustGet(sid);
          this.refreshCalls++;
          this.refreshNames.push(name);
          if (this.refreshDelay === Infinity) return new Promise<void>(() => undefined);
          if (this.refreshDelay) await new Promise((r) => setTimeout(r, this.refreshDelay));
          if (this.refreshFail) throw new Error(this.refreshFail);
          const c = this.connectOnRefresh;
          if (c && this.refreshCalls >= c.at) this.emit(sid, { type: 'mcp', servers: [{ name: c.name, status: 'connected' }] });
          const f = this.endOnRefresh;
          if (f && this.refreshCalls >= f.at) this.emit(sid, { type: 'mcp', servers: [{ name: f.name, status: 'needs-auth', errorClass: 'auth', signInEnd: f.end, ...(f.error ? { error: f.error } : {}) }] });
        };
      }
      if (has('cancelMcpSignIn')) {
        this.cancelMcpSignIn = async (sid, name) => {
          this.mustGet(sid);
          this.signInCalls.push({ sessionId: sid, name, cancel: true });
        };
      }
    }
    if (caps.oneShot) this.generateText = async () => ({ text: '{"name":"Fake","tokens":{"--bg":"#ffffff","--surface":"#ffffff","--ink":"#111111","--muted":"#555555"}}' });
    if (caps.renameSession) {
      this.renameSession = async (sid, name) => {
        this.renameCalls.push({ sessionId: sid, name });
        if (this.failRename !== undefined) throw new Error(this.failRename);
      };
    }
    if (caps.handoff) this.handoffSummary = async (sid) => (this.mustGet(sid), { summary: '## Goal\nFake hand-off summary.' });
    if (has('setModel')) this.setModel = async (sid, request) => (this.mustGet(sid), { status: 'applied', model: request.model });
    if (has('cancelQueuedModel')) this.cancelQueuedModel = async (sid) => void this.mustGet(sid);
    if (has('compact')) this.compact = async (sid) => (this.mustGet(sid), { success: true, tokensRemoved: 0 });
    if (caps.models) this.listModelOptions = async () => [{ ...FAKE_MODEL }];
    if (caps.history) {
      this.listPreviousSessions = async (_cwd, exclude) => this.previous.filter((p) => !exclude?.has(p.id)).map((p) => ({ ...p }));
      this.history = async (sid) => (this.mustGet(sid), { items: [], total: 0, truncated: false });
    }
    if (caps.deleteSession) {
      this.deleteSession = async (sid) => {
        this.deleteCalls.push(sid);
        if (this.sessions.has(sid)) throw new Error('That session is open.');
        const at = this.previous.findIndex((p) => p.id === sid);
        if (at < 0) throw new Error('Session not found.');
        this.previous.splice(at, 1);
      };
    }
    if (caps.permModeSwitch !== 'none') this.setPermMode = (sid, mode, opts = {}) => this.doSetPermMode(sid, mode, opts);
  }

  isLive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async start(options: StartOptions): Promise<string> {
    const mode = startModeOf(options);
    if (!this.capabilities.permissionModes.includes(mode)) throw new Error(`The ${this.displayName} adapter does not support the ${mode} permission mode.`);
    const sid = options.resumeSessionId ?? options.sessionId ?? `fake-${++this.counter}`;
    const blocked = mcpToolBlockList(options.disabledMcpTools); // spec 069 FR-063
    const broker = new PermissionBroker({
      roots: [options.workspace],
      mode,
      blockedTools: () => blocked,
      emit: (e: BrokerEvent) => {
        switch (e.type) {
          case 'pending':
            return this.emit(sid, { type: 'status', status: 'needs-permission', intent: `Waiting for permission: ${e.permission.summary}`, permission: e.permission });
          case 'denied-policy':
            return this.emit(sid, { type: 'status', status: 'needs-permission', intent: `Denied (read-only mode): ${e.permission.summary}`, permission: e.permission });
          case 'resolved':
            this.emit(sid, { type: 'permission', permission: e.permission });
            if (e.permission.via !== 'stopped') {
              const word = e.permission.state === 'approved' ? (e.permission.via === 'session' ? 'Allowed for this session' : 'Allowed') : 'Denied';
              this.emit(sid, { type: 'status', status: 'working', intent: `${word}: ${e.permission.summary}` });
            }
            return;
          case 'auto': // Allow all approved it: a permission event for the activity log; the window shows no card (spec 052 FR-071)
            return this.emit(sid, { type: 'permission', permission: e.permission });
          case 'grants':
            return this.emit(sid, { type: 'grants', grants: e.grants });
        }
      },
    });
    this.sessions.set(sid, { broker, workspace: options.workspace, epoch: 0 });
    if (!options.quiet) this.emit(sid, { type: 'status', status: 'idle', intent: `Ready in ${options.workspace}` });
    return sid;
  }

  async send(sessionId: string, _message: AgentMessage): Promise<void> {
    const s = this.mustGet(sessionId);
    const epoch = s.epoch;
    const alive = (): boolean => this.sessions.get(sessionId) === s && s.epoch === epoch;
    this.emit(sessionId, { type: 'status', status: 'working', intent: 'Thinking' });
    let text = '';
    for (const step of this.script) {
      if (!alive()) return;
      if ('output' in step) {
        text += step.output;
        this.emit(sessionId, { type: 'output', delta: step.output });
      } else if ('thinking' in step) {
        this.emit(sessionId, { type: 'thinking', delta: step.thinking });
      } else if ('tool' in step) {
        const callId = `fake-call-${++this.calls}`;
        this.emit(sessionId, { type: 'toolCall', callId, tool: step.tool, phase: 'start', args: step.args });
        this.emit(sessionId, { type: 'toolCall', callId, tool: step.tool, phase: 'complete' });
      } else if ('usage' in step) {
        this.emit(sessionId, this.usageBody(step.usage));
      } else if ('permission' in step) {
        const callId = `fake-call-${++this.calls}`;
        const d = await s.broker.request({ toolCallId: callId, ...step.permission });
        if (!alive()) return;
        this.emit(sessionId, { type: 'toolCall', callId, tool: step.permission.kind, phase: d.kind === 'approve-once' ? 'complete' : 'failed' });
      } else if ('wait' in step) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, step.wait);
          s.wake = () => {
            clearTimeout(t);
            resolve();
          };
        });
        s.wake = undefined;
      }
    }
    if (!alive()) return;
    this.emit(sessionId, { type: 'output', delta: '', final: true, text });
    this.emit(sessionId, { type: 'status', status: 'idle' });
  }

  async stop(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.broker.stop();
    s.epoch++;
    s.wake?.();
    this.sessions.delete(sessionId);
    this.emit(sessionId, { type: 'status', status: 'stopped' });
  }

  async dispose(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.stop(id);
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Test hook: the runtime asks for one permission now. Resolves with the broker's decision (it waits in Ask first). */
  request(sessionId: string, req: PermissionLike): ReturnType<PermissionBroker['request']> {
    return this.mustGet(sessionId).broker.request(req);
  }

  private async doInterrupt(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.broker.denyPending();
    s.epoch++;
    s.wake?.();
    this.emit(sessionId, { type: 'status', status: 'idle', intent: 'Aborted' });
  }

  private doSetPermMode(sessionId: string, mode: PermissionMode, opts: { clearGrants?: boolean; approvePending?: boolean }): { pending: number } {
    const live = this.sessions.get(sessionId);
    if (!live) return { pending: 0 };
    live.broker.setMode(mode);
    if (opts.clearGrants) live.broker.clearGrants();
    let pending = live.broker.pendingCount();
    if (pending) {
      if (opts.approvePending && mode !== 'read-only') pending -= live.broker.approvePending();
      else if (mode === 'read-only') pending -= live.broker.denyPendingByUser();
    }
    return { pending };
  }

  /** Only the figures the capabilities declare (FR-027, C5): no `nanoAiu` or `costUsd` unless declared, and `costUsd` is an estimate. */
  private usageBody(u: Partial<UsageEvent>): EventBody {
    const { usage } = this.capabilities;
    const { type: _t, sessionId: _s, timestamp: _ts, nanoAiu, costUsd, costBasis: _cb, inputTokens, outputTokens, cacheReadTokens, ...rest } = u;
    return {
      ...rest,
      type: 'usage',
      ...(usage.tokens ? { inputTokens, outputTokens, cacheReadTokens } : {}),
      ...(usage.nanoAiu ? { nanoAiu } : {}),
      ...(usage.costUsd && costUsd !== undefined ? { costUsd, costBasis: 'estimate' as const } : {}),
    } as EventBody;
  }

  private mustGet(sessionId: string): FakeSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Unknown or stopped session: ${sessionId}`);
    return s;
  }

  private emit(sessionId: string, body: EventBody): void {
    const event = { ...body, sessionId, timestamp: Date.now() } as AgentEvent;
    for (const l of [...this.listeners]) l(event);
  }
}
