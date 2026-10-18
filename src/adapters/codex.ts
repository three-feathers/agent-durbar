/**
 * Codex adapter on `codex app-server` (spec 012 FR-089..FR-097, T043a). One app-server child per session (D2), spoken to
 * through `codexRpc.ts`, mapped by `codexMap.ts`, decided by `PermissionBroker`. Everything here is written from the docs and
 * exercised only against a scripted fake (`scripts/fakes/codex-app-server.ts`): nothing was ever run against a real Codex.
 * No Codex type leaves this folder. Not registered anywhere the app loads (FR-100 is T043c).
 *
 * Not in this file yet (T043b): resume of a known thread (FR-093) and its folder and profile checks.
 */
import * as fs from 'fs';
import * as os from 'os';
import type { AdapterCapabilities, AgentAdapter, AgentEvent, AgentMessage, PermissionMode, StartOptions, Unsubscribe } from './types';
import type { AdapterDescriptor } from './capabilities';
import type { EventBody } from './map';
import { CodexMapper } from './codexMap';
import { createCodexRpc, realSpawn } from './codexRpc';
import type { CodexRpc, RequestOutcome, SpawnFn } from './codexRpc';
import { CODEX_INITIALIZE_CAPABILITIES, codexModeSettings, codexPermission, codexProfileArgs, codexReadEnforceable, codexReply, codexWorkspaceRoots } from './codexModes';
import type { DurbarAnswer } from './codexModes';
import { CODEX_BINARY, detectBinary, nodeExec } from './detect';
import type { DetectEnv } from './detect';
import { PermissionBroker, startModeOf } from './permissions';
import type { BrokerEvent } from './permissions';
import { resolveWorkspaceCwd } from './workspace';
import { redact } from '../shared/redact';

const CODEX_ID = 'codex';
const CODEX_NAME = 'OpenAI Codex';

/** From the plan and the modules (spec 012 FR-089); none of it verified on a real account. Deeply frozen. */
export const CODEX_CAPABILITIES: AdapterCapabilities = Object.freeze({
  interrupt: true,
  resume: true,
  images: true,
  models: false,
  effort: false,
  permissionModes: Object.freeze(['read-only', 'ask', 'allow'] as const),
  // T046 turns this into 'next-message' and adds setPermMode.
  permModeSwitch: 'none',
  usage: Object.freeze({ tokens: true, costUsd: false, nanoAiu: false }),
  context: true,
  caps: false,
  helpers: false,
  history: false,
  mcpStatus: false,
  mcpToggle: false,
});

/** Where the `codex` binary is and which version it reports. */
export interface CodexLocation {
  path: string;
  version?: string;
}

export interface CodexAdapterOptions {
  spawn?: SpawnFn;
  locate?: () => Promise<CodexLocation | undefined>;
  platform?: string;
  /** Environment of the child. Default: the process environment (the D5 deny list is T043c). Never logged. */
  env?: NodeJS.ProcessEnv;
  /** Shown to Codex in `clientInfo`. */
  appVersion?: string;
  /** Resolves symlinks in session folders before they become Codex roots. Default `fs.realpathSync.native`; tests inject a fake. */
  realpath?: (p: string) => string;
  closeGraceMs?: number;
  killGraceMs?: number;
}

/** The real `locate`: the same PATH search and `--version` probe `adapters:list` uses. */
async function detectLocate(): Promise<CodexLocation | undefined> {
  const env: DetectEnv = {
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),
    isFile: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
  };
  const r = await detectBinary(CODEX_BINARY, env, nodeExec);
  return r.path ? { path: r.path, version: r.version } : undefined;
}

const isShim = (file: string): boolean => /\.(cmd|bat)$/i.test(file);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface Live {
  sid: string;
  threadId: string;
  cwd: string;
  mode: PermissionMode;
  roots: string[];
  rpc: CodexRpc;
  mapper: CodexMapper;
  broker: PermissionBroker;
  /** Resolves when the child has exited. */
  exited: Promise<void>;
  /** Drops mapper events (while starting with `quiet`, and once the session is stopping or dead). */
  muted: boolean;
  turnId?: string;
  stopping: boolean;
  interrupting: boolean;
  /** The next mapper `Aborted` is the one `interrupt` already reported itself. */
  expectAborted: boolean;
  anon: number;
}

interface Child {
  rpc: CodexRpc;
  exited: Promise<void>;
}

export class CodexAdapter implements AgentAdapter {
  readonly id = CODEX_ID;
  readonly displayName = CODEX_NAME;
  readonly capabilities: AdapterCapabilities = CODEX_CAPABILITIES;
  /** Optional debug sink (DURBAR_LOG). Receives short redacted lines only: never env values, prompts or stderr text. */
  debug?: (message: string) => void;
  private listeners = new Set<(event: AgentEvent) => void>();
  private sessions = new Map<string, Live>();
  private readonly spawnFn: SpawnFn;
  private readonly locate: () => Promise<CodexLocation | undefined>;
  private readonly platform: string;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly appVersion: string;
  private readonly realpath: (p: string) => string;
  private readonly closeGraceMs?: number;
  private readonly killGraceMs?: number;

  constructor(o: CodexAdapterOptions = {}) {
    this.spawnFn = o.spawn ?? realSpawn;
    this.locate = o.locate ?? detectLocate;
    this.platform = o.platform ?? process.platform;
    this.env = o.env ?? process.env;
    this.appVersion = o.appVersion ?? 'dev';
    this.realpath = o.realpath ?? fs.realpathSync.native;
    this.closeGraceMs = o.closeGraceMs;
    this.killGraceMs = o.killGraceMs;
  }

  isLive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Spawn one `codex app-server` child (argv array, no shell). `onExit` and the handlers are given by the caller. */
  private spawnChild(file: string, cwd: string, handlers: { onNotification: (m: string, p: unknown) => void; onRequest: (m: string, p: unknown) => Promise<RequestOutcome>; onExit: (code: number | null, signal: NodeJS.Signals | null) => void }): Child {
    let done!: () => void;
    const exited = new Promise<void>((r) => (done = r));
    const rpc = createCodexRpc({
      spawn: this.spawnFn,
      file,
      args: ['app-server', ...codexProfileArgs()],
      cwd,
      env: this.env,
      onNotification: handlers.onNotification,
      onRequest: handlers.onRequest,
      onExit: (code, signal) => {
        try {
          handlers.onExit(code, signal);
        } finally {
          done();
        }
      },
      debug: (m) => this.debug?.(`codex rpc: ${m}`),
      closeGraceMs: this.closeGraceMs,
      killGraceMs: this.killGraceMs,
    });
    return { rpc, exited };
  }

  /** Close a child and wait for its exit (bounded by the kill grace), so a failed start leaves nothing running. */
  private async closeChild(c: Child): Promise<void> {
    c.rpc.close();
    const wait = (this.closeGraceMs ?? 2000) + (this.killGraceMs ?? 1000) + 500;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([c.exited, new Promise<void>((r) => (timer = setTimeout(r, wait)))]);
    if (timer) clearTimeout(timer);
  }

  async start(options: StartOptions): Promise<string> {
    const mode = startModeOf(options);
    if (!this.capabilities.permissionModes.includes(mode)) throw new Error(`Codex cannot run in ${mode} mode.`);
    // Resume of a known thread arrives with T043b (FR-093). Refuse rather than silently starting a different thread.
    if (options.resumeSessionId) throw new Error('Resuming a Codex session is not available yet.');
    if (options.sessionId && this.sessions.has(options.sessionId)) throw new Error(`Session ${options.sessionId} is already running.`);
    const { cwd, folders } = resolveWorkspaceCwd(options.workspace);
    const roots = codexWorkspaceRoots([cwd, ...folders], this.realpath);
    const limited = mode !== 'allow';

    const loc = await this.locate();
    if (!loc?.path) throw new Error('Codex was not found on this computer. Install the Codex CLI, then restart Durbar.');
    // A .cmd/.bat shim cannot carry the profile argument and cannot be spawned without a shell: refused in every mode (D4).
    if (isShim(loc.path)) throw new Error('Codex is launched through a .cmd launcher, which Durbar cannot run safely. Use the native codex.exe instead of the .cmd shim.');
    if (limited && !roots.length) throw new Error(`Durbar has no folder it can limit Codex's reads to. Add the project folder itself, not a drive or filesystem root, or a folder Durbar can resolve.`);

    // The ids and flags the handlers need exist before the child can talk.
    const live: Live = {
      sid: options.sessionId ?? '',
      threadId: '',
      cwd,
      mode,
      roots,
      rpc: undefined as unknown as CodexRpc,
      mapper: undefined as unknown as CodexMapper,
      broker: undefined as unknown as PermissionBroker,
      exited: undefined as unknown as Promise<void>,
      muted: true, // until the session is up: the start itself reports "Ready" (or nothing, when quiet)
      stopping: false,
      interrupting: false,
      expectAborted: false,
      anon: 0,
    };
    live.mapper = new CodexMapper((body) => this.fromMapper(live, body));
    live.broker = this.makeBroker(live);

    const open = (): Child =>
      this.spawnChild(loc.path, cwd, {
        onNotification: (method, params) => this.onNotification(live, method, params),
        onRequest: (method, params) => this.onServerRequest(live, method, params),
        onExit: (code, signal) => this.onExit(live, code, signal),
      });
    const handshake = async (c: Child, withCapabilities: boolean): Promise<void> => {
      await c.rpc.request('initialize', {
        clientInfo: { name: 'agent_durbar', title: 'Agent Durbar', version: this.appVersion },
        ...(withCapabilities ? { capabilities: CODEX_INITIALIZE_CAPABILITIES } : {}),
      });
      await c.rpc.notify('initialized');
    };

    let child = open();
    let experimentalApi = false;
    try {
      try {
        await handshake(child, true);
        experimentalApi = true;
      } catch (e) {
        // Codex answered `initialize` with an error: it may not accept the experimental API. Read-only and Ask first need it.
        // Allow all does not, so it gets one more try on a fresh child (a connection is initialised once).
        if (!isRpcError(e)) throw new Error(`Codex could not be started: ${reasonOf(e)}`);
        if (limited) {
          const no = codexReadEnforceable({ version: loc.version, experimentalApi: false, platform: this.platform });
          throw new Error(`${no.ok ? 'This Codex did not accept the experimental API.' : `${no.reason} ${no.advice}`}`);
        }
        await this.closeChild(child);
        child = open();
        try {
          await handshake(child, false);
        } catch (e2) {
          throw new Error(`Codex could not be started: ${reasonOf(e2)}`);
        }
      }
      if (limited) {
        const ok = codexReadEnforceable({ version: loc.version, experimentalApi, platform: this.platform, elevatedSandbox: undefined });
        if (!ok.ok) throw new Error(`${ok.reason} ${ok.advice}`);
      }
      live.rpc = child.rpc;
      live.exited = child.exited;
      const settings = codexModeSettings(mode);
      let started: unknown;
      try {
        started = await child.rpc.request('thread/start', { cwd, ...settings, ...(limited ? { runtimeWorkspaceRoots: roots } : {}) });
      } catch (e) {
        // Never retried with a weaker setting (FR-087).
        throw new Error(`Codex refused the session settings: ${reasonOf(e)}`);
      }
      const thread = isObj(started) && isObj(started.thread) ? started.thread : undefined;
      const threadId = thread && typeof thread.id === 'string' && thread.id ? thread.id : undefined;
      if (!threadId) throw new Error('Codex did not return a thread id.');
      live.threadId = threadId;
    } catch (e) {
      await this.closeChild(child);
      throw e instanceof Error ? e : new Error(String(e));
    }

    // From here the session exists. The thread id is the Durbar session id unless the caller named one (FR-092).
    live.sid = options.sessionId ?? live.threadId;
    live.mapper.adopt(live.threadId, cwd); // thread/started may or may not have arrived yet
    live.muted = false;
    this.sessions.set(live.sid, live);
    if (live.rpc.exited) {
      // The child died between the response and now: report it like any crash.
      this.sessions.delete(live.sid);
      throw new Error('Codex stopped unexpectedly while starting.');
    }
    if (!options.quiet) this.emit(live.sid, { type: 'status', status: 'idle', intent: `Ready in ${cwd}` });
    return live.sid;
  }

  async send(sessionId: string, message: AgentMessage): Promise<void> {
    const live = this.mustGet(sessionId);
    live.expectAborted = false;
    const images = (message.attachments ?? []).filter((a) => a.kind === 'image');
    const files = (message.attachments ?? []).filter((a) => a.kind !== 'image');
    // Files the user attached are theirs to share (spec 003 FR-023).
    if (message.attachments?.length) live.broker.allowReadPaths(message.attachments.map((a) => a.path));
    this.emit(sessionId, { type: 'status', status: 'working', intent: 'Thinking' });
    const { sandbox, ...modeFields } = codexModeSettings(live.mode);
    const input: Array<Record<string, string>> = [
      { type: 'text', text: message.text },
      ...files.map((f) => ({ type: 'text', text: `Attached file: ${f.path}` })),
      ...images.map((i) => ({ type: 'localImage', path: i.path })),
    ];
    const params = {
      threadId: live.threadId,
      input,
      ...modeFields,
      // `sandboxPolicy` is an object on turn/start, not the `sandbox` string of thread/start. [KNOWN GAP] T062: shape unverified.
      ...(sandbox ? { sandboxPolicy: { type: 'dangerFullAccess' } } : { runtimeWorkspaceRoots: live.roots }),
    };
    try {
      const res = await live.rpc.request('turn/start', params);
      const id = isObj(res) && isObj(res.turn) && typeof res.turn.id === 'string' ? res.turn.id : undefined;
      if (id && live.turnId === undefined) live.turnId = id;
    } catch (e) {
      if (isRpcError(e) || (e as { kind?: string }).kind === 'timeout') this.emit(sessionId, { type: 'status', status: 'error', intent: `Codex refused the message: ${reasonOf(e)}`.slice(0, 300) });
      throw e;
    }
  }

  /** Interrupt the running turn; the session stays live and grants stay (C10). With no turn running nothing is sent. */
  async interrupt(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    live.interrupting = true;
    try {
      live.broker.denyPending();
      const turnId = live.turnId;
      if (!turnId) return;
      live.expectAborted = true;
      try {
        await live.rpc.request('turn/interrupt', { threadId: live.threadId, turnId });
      } catch {
        /* the turn ended on its own, or the child is gone */
      }
      if (this.sessions.get(sessionId) === live) this.emit(sessionId, { type: 'status', status: 'idle', intent: 'Aborted' });
    } finally {
      // Let the answers of the denied requests (which read this flag) go out first.
      await new Promise<void>((r) => setImmediate(r));
      live.interrupting = false;
    }
  }

  /** End the session: pending permissions are denied, the turn interrupted, the thread unsubscribed, the child closed. */
  async stop(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    this.sessions.delete(sessionId);
    live.stopping = true;
    live.muted = true;
    live.broker.stop();
    // Let the denied requests' answers (wire `cancel`) go out before the interrupt and the close.
    await new Promise<void>((r) => setImmediate(r));
    if (!live.rpc.exited) {
      if (live.turnId) await live.rpc.request('turn/interrupt', { threadId: live.threadId, turnId: live.turnId }).catch(() => undefined);
      await live.rpc.request('thread/unsubscribe', { threadId: live.threadId }).catch(() => undefined);
    }
    live.rpc.close();
    const wait = (this.closeGraceMs ?? 2000) + (this.killGraceMs ?? 1000) + 500;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([live.exited, new Promise<void>((r) => (timer = setTimeout(r, wait)))]);
    if (timer) clearTimeout(timer);
    this.emit(sessionId, { type: 'status', status: 'stopped' });
  }

  resolvePermission(sessionId: string, requestId: string, approve: boolean, remember = false, broad = false): void {
    this.sessions.get(sessionId)?.broker.resolve(requestId, approve, remember, broad);
  }

  revokeGrant(sessionId: string, key: string): void {
    this.sessions.get(sessionId)?.broker.revoke(key);
  }

  /** Stop every session and wait for every child. [KNOWN GAP] (T042): only the direct child is signalled. */
  async dispose(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.stop(id);
  }

  onEvent(listener: (event: AgentEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private mustGet(sessionId: string): Live {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error(`Unknown or stopped session: ${sessionId}`);
    return live;
  }

  protected emit(sessionId: string, body: EventBody): void {
    const event = { ...body, sessionId, timestamp: Date.now() } as AgentEvent;
    for (const l of this.listeners) l(event);
  }

  private fromMapper(live: Live, body: EventBody): void {
    if (live.muted) return;
    if (live.expectAborted && body.type === 'status' && body.status === 'idle' && body.intent === 'Aborted' && (body as { agentId?: string }).agentId === undefined) {
      live.expectAborted = false; // `interrupt` reports it itself, once
      return;
    }
    this.emit(live.sid, body);
  }

  private onNotification(live: Live, method: string, params: unknown): void {
    // Keep the running turn's id for interrupt and stop.
    if (isObj(params) && (params.threadId === undefined || params.threadId === live.threadId)) {
      const turn = isObj(params.turn) ? params.turn : undefined;
      if (method === 'turn/started' && turn && typeof turn.id === 'string') live.turnId = turn.id;
      else if (method === 'turn/completed') live.turnId = undefined;
    }
    live.mapper.map({ method, params });
  }

  private makeBroker(live: Live): PermissionBroker {
    return new PermissionBroker({
      roots: live.roots,
      mode: live.mode,
      emit: (e: BrokerEvent) => {
        const sid = live.sid;
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
  }

  /** A server request (approval or question). Read-only is double-locked: the broker denies and `codexReply` declines. Never `acceptForSession`. */
  private async onServerRequest(live: Live, method: string, params: unknown): Promise<RequestOutcome> {
    const perm = codexPermission(method, params);
    const itemId = isObj(params) && typeof params.itemId === 'string' && params.itemId ? params.itemId : undefined;
    const toolCallId = itemId ?? `${method}#${++live.anon}`;
    const decision = await live.broker.request({
      kind: perm.kind,
      toolCallId,
      fullCommandText: perm.fullCommandText,
      fileName: perm.fileName,
      url: perm.url,
      toolName: perm.toolName,
      serverName: perm.serverName,
    });
    const answer: DurbarAnswer = decision.kind === 'approve-once' ? 'approve' : live.stopping || live.interrupting ? 'stop' : 'deny';
    const reply = codexReply(answer, live.broker.getMode());
    if (reply.interruptTurn && !live.stopping && !live.interrupting && live.turnId && !live.rpc.exited) {
      void live.rpc.request('turn/interrupt', { threadId: live.threadId, turnId: live.turnId }).catch(() => undefined);
    }
    return { result: { decision: reply.decision } };
  }

  /** The child exited. Not caused by `stop`: the session is over and says so (FR-097). */
  private onExit(live: Live, code: number | null, signal: NodeJS.Signals | null): void {
    if (live.stopping || !live.rpc) return; // `stop`, or a child that was closed during start (a failed handshake, the Allow all retry)
    live.muted = true;
    const registered = this.sessions.get(live.sid) === live;
    if (registered) this.sessions.delete(live.sid);
    live.broker.stop();
    const tail = live.rpc?.stderrTail() ?? [];
    if (tail.length) this.debug?.(`codex stderr (last lines): ${redact(tail.slice(-5).join(' | '), this.env ?? process.env)}`);
    if (registered) {
      this.emit(live.sid, { type: 'status', status: 'error', intent: `Codex stopped unexpectedly (exit ${code ?? signal ?? 'unknown'})` });
    }
  }
}

function isRpcError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { kind?: string }).kind === 'rpc';
}

export const CODEX_DESCRIPTOR: AdapterDescriptor = {
  id: CODEX_ID,
  displayName: CODEX_NAME,
  installHint: CODEX_BINARY.installHint,
  capabilities: CODEX_CAPABILITIES,
  create: () => new CodexAdapter(),
};
