/**
 * A scripted adapter for tests (spec 012 FR-051). Pure: no SDK, no file system, no processes, no Electron.
 * Test and simulator double only: never register it in the production registry (`main.ts` registers only real
 * descriptors, see `descriptors.ts`; `test-router.ts` guards it). It lives in `src/` so a future simulator mode
 * (`DURBAR_SIM_MAIN`, spec 012 plan) can use it. Its optional members exist exactly when its capabilities say so (FR-027), and it
 * follows the same permission rules as the real adapters through `PermissionBroker` and `startModeOf` (FR-028, FR-052).
 */
import type { AdapterCapabilities } from './capabilities';
import type { EventBody } from './map';
import { PermissionBroker, startModeOf } from './permissions';
import type { BrokerEvent, PermissionLike } from './permissions';
import type { AgentAdapter, AgentEvent, AgentMessage, CompactResult, LimitAction, ModelOption, ModelSwitchRequest, ModelSwitchResult, PermissionMode, StartOptions, UsageEvent } from './types';
import type { HistoryResult, PreviousSession } from './history';

export type OptionalMember =
  | 'interrupt' | 'resolvePermission' | 'revokeGrant' | 'setCap' | 'resolveLimit' | 'setMcpEnabled' | 'setModel'
  | 'cancelQueuedModel' | 'compact' | 'listModelOptions' | 'listPreviousSessions' | 'history' | 'setPermMode';

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
  declare setModel?: (sessionId: string, request: ModelSwitchRequest) => Promise<ModelSwitchResult>;
  declare cancelQueuedModel?: (sessionId: string, queueId: string) => Promise<void>;
  declare compact?: (sessionId: string, focus?: string) => Promise<CompactResult>;
  declare listModelOptions?: () => Promise<ModelOption[]>;
  declare listPreviousSessions?: (cwd: string, excludeIds?: ReadonlySet<string>) => Promise<PreviousSession[]>;
  declare history?: (sessionId: string) => Promise<HistoryResult>;
  declare setPermMode?: (sessionId: string, mode: PermissionMode, opts?: { clearGrants?: boolean; approvePending?: boolean }) => { pending: number };

  private listeners = new Set<(event: AgentEvent) => void>();
  private sessions = new Map<string, FakeSession>();
  private script: Step[];
  private counter = 0;
  private calls = 0;

  constructor(cfg: FakeConfig = {}) {
    this.id = cfg.id ?? 'fake';
    this.displayName = cfg.displayName ?? 'Fake agent';
    this.script = cfg.script ?? [{ output: 'fake reply' }];
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
      permModeSwitch: omit.has('setPermMode') ? ('none' as const) : c.permModeSwitch,
    };
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
    if (has('setModel')) this.setModel = async (sid, request) => (this.mustGet(sid), { status: 'applied', model: request.model });
    if (has('cancelQueuedModel')) this.cancelQueuedModel = async (sid) => void this.mustGet(sid);
    if (has('compact')) this.compact = async (sid) => (this.mustGet(sid), { success: true, tokensRemoved: 0 });
    if (caps.models) this.listModelOptions = async () => [{ ...FAKE_MODEL }];
    if (caps.history) {
      this.listPreviousSessions = async () => [];
      this.history = async (sid) => (this.mustGet(sid), { items: [], total: 0, truncated: false });
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
    const broker = new PermissionBroker({
      roots: [options.workspace],
      mode,
      emit: (e: BrokerEvent) => {
        switch (e.type) {
          case 'pending':
            return this.emit(sid, { type: 'status', status: 'needs-permission', intent: `Waiting for permission: ${e.permission.summary}`, permission: e.permission });
          case 'denied-policy':
            return this.emit(sid, { type: 'status', status: 'needs-permission', intent: `Denied (read-only mode): ${e.permission.summary}`, permission: e.permission });
          case 'resolved':
            this.emit(sid, { type: 'permission', permission: e.permission });
            if (e.permission.via !== 'stopped') {
              const word = e.permission.state === 'approved' ? (e.permission.via === 'session' ? 'Allowed for this session' : 'Approved') : 'Denied';
              this.emit(sid, { type: 'status', status: 'working', intent: `${word}: ${e.permission.summary}` });
            }
            return;
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

  /** Test hook: pushes one scripted event through the normal event stream, as if the session had produced it (spec 041 T015: the main-process simulator). */
  emitForTest(sessionId: string, body: EventBody): void {
    this.emit(sessionId, body);
  }

  private emit(sessionId: string, body: EventBody): void {
    const event = { ...body, sessionId, timestamp: Date.now() } as AgentEvent;
    for (const l of [...this.listeners]) l(event);
  }
}
