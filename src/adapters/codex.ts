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
import * as path from 'path';
import type { AdapterCapabilities, AgentAdapter, AgentEvent, AgentMessage, PermissionMode, StartOptions, Unsubscribe } from './types';
import type { AdapterDescriptor } from './capabilities';
import type { EventBody } from './map';
import { CodexMapper } from './codexMap';
import { createCodexRpc, realSpawn } from './codexRpc';
import type { CodexRpc, RequestOutcome, SpawnFn } from './codexRpc';
import { codexHistory, codexModelOptions, codexPreviousSessions } from './codexHistory';
import { cleanAnswers, parseQuestionsWithOriginals } from './questions';
import { answerElicitation, cancelElicitations, runElicitation, type ElicitWaiter } from './elicitation';
import type { ElicitAnswer } from '../shared/elicit';
import { codexMcpConfig, codexMcpServers, codexMcpState } from './codexMcp';
import type { McpServerStatus } from './types';
import type { HistoryResult, PreviousSession } from './history';
import type { ModelOption } from '../shared/modelswitch';
import { CODEX_INITIALIZE_CAPABILITIES, codexInstallRoot, codexModeSettings, codexPermission, codexProfileArgs, codexReadEnforceable, codexReply, codexWorkspaceRoots } from './codexModes';
import type { DurbarAnswer } from './codexModes';
import { CODEX_BINARY, detectBinary, nodeExec } from './detect';
import type { DetectEnv } from './detect';
import { PermissionBroker, startModeOf } from './permissions';
import type { BrokerEvent } from './permissions';
import { resolveWorkspaceCwd } from './workspace';
import { redact } from '../shared/redact';
import { HANDOFF_PROMPT, cleanSummary } from './handoff';
import type { HandoffResult } from './handoff';

const CODEX_ID = 'codex';
const CODEX_NAME = 'OpenAI Codex';

/** From the plan and the modules (spec 012 FR-089); none of it verified on a real account. Deeply frozen. */
export const CODEX_CAPABILITIES: AdapterCapabilities = Object.freeze({
  interrupt: true,
  resume: true, // FR-093 (T043b): thread/read, then thread/resume on a fresh child
  images: true,
  models: true, // FR-142: model/list, model and effort per turn
  effort: true,
  permissionModes: Object.freeze(['read-only', 'ask', 'allow'] as const),
  permModeSwitch: 'next-message', // FR-144: Durbar's approvals at once, Codex's sandbox from the next message (fresh child, resume)
  usage: Object.freeze({ tokens: true, costUsd: false, nanoAiu: false }),
  context: true,
  caps: false,
  helpers: true, // FR-149: subAgentActivity by agent thread (real, Codex 0.163)
  history: true, // FR-141: thread/list and thread/read
  mcpStatus: true, // FR-147: mcpServerStatus/list and startup notifications
  mcpToggle: true, // FR-147: from the next message (fresh child, same thread)
  handoff: true, // spec 030 FR-034: an ephemeral fork, the thread is not changed
  oneShot: true, // spec 040 FR-015: an ephemeral read-only thread in an empty temp folder
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
  /** Environment of the child. Default: `codexChildEnv(process.env)` (D5). Never logged. */
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

/**
 * The environment a Codex child gets (spec 012 D5): the process environment without other tools' credentials. Dropped: names starting
 * `GH_`, `GITHUB_`, `COPILOT_`, `ANTHROPIC_`, `CLAUDE_`, `DURBAR_`, and any name that looks like a secret (the pattern `redact()` uses).
 * Kept on purpose: `OPENAI_API_KEY` and `CODEX_*` (Codex's own sign-in), proxy and CA variables, and everything that does not look like a secret
 * (`PATH`, `HOME`, `USERPROFILE`, `APPDATA`, `TMP*`). Pure. Values are never logged.
 */
const DENIED_PREFIX = /^(GH_|GITHUB_|COPILOT_|ANTHROPIC_|CLAUDE_|DURBAR_)/i;
const SECRET_LOOKING = /(TOKEN|KEY|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)/i;
const KEPT = /^(OPENAI_API_KEY|CODEX_.*|(HTTPS?|ALL|NO|FTP)_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE)$/i;
export function codexChildEnv(env: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (!KEPT.test(name) && (DENIED_PREFIX.test(name) || SECRET_LOOKING.test(name))) continue;
    out[name] = value;
  }
  return out;
}

/** `child` is `parent` or below it (paths already normalised and resolved; Windows-form paths compare case-insensitively). */
function isInside(parent: string, child: string): boolean {
  const win = /^[A-Za-z]:[\\/]|^\\\\/.test(parent);
  const api = win ? path.win32 : path.posix;
  const rel = api.relative(win ? parent.toLowerCase() : parent, win ? child.toLowerCase() : child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + api.sep) && !api.isAbsolute(rel));
}

/**
 * FR-093: a resumed thread must belong to the session folder (spec 003: resumed sessions belong to the agent's folder), and in
 * Read-only and Ask first Codex must not report a wider sandbox than the read-limited profile. Throws to refuse; the caller
 * closes the child. A field Codex does not send is not taken as permission: the fresh child with `default_permissions`
 * (FR-138) is what holds then.
 */
export function codexResumeCheck(res: unknown, o: { cwd: string; limited: boolean; realpath: (p: string) => string; required?: boolean }): void {
  const r = isObj(res) ? res : {};
  const norm = (p: string): string => {
    let x = p;
    try {
      x = o.realpath(p);
    } catch {
      /* compare as given */
    }
    const win = /^[A-Za-z]:[\\/]/.test(x);
    const n = (win ? path.win32 : path.posix).normalize(x).replace(/[\\/]+$/, '');
    return win ? n.toLowerCase() : n;
  };
  const cwd = typeof r.cwd === 'string' ? r.cwd : isObj(r.thread) && typeof r.thread.cwd === 'string' ? r.thread.cwd : undefined;
  if (cwd === undefined && o.required) throw new Error('Codex did not say which folder that session belongs to, so it is not resumed.');
  if (cwd !== undefined && norm(cwd) !== norm(o.cwd)) throw new Error('That Codex session belongs to another folder, so it is not resumed here.');
  if (!o.limited) return;
  const sb = r.sandbox;
  const kind = typeof sb === 'string' ? sb : isObj(sb) && typeof sb.type === 'string' ? sb.type : undefined;
  if (kind !== undefined && /danger|full|workspace.?write/i.test(kind)) throw new Error(`Codex resumed the session with a wider sandbox (${kind.slice(0, 40)}) than this mode allows, so it is not resumed.`);
}

/** FR-148/FR-151: does an MCP elicitation ask for form fields or a URL flow (the question card), as opposed to a plain yes/no (the approval)? */
export function codexElicitationHasFields(params: unknown): boolean {
  const schema = isObj(params) && isObj(params.requestedSchema) ? params.requestedSchema : undefined;
  if (!schema) return isObj(params) && params.mode === 'url'; // a URL flow cannot be answered here
  const props = isObj(schema.properties) ? schema.properties : {};
  return Object.keys(props).length > 0;
}

/**
 * FR-140 (real, Ubuntu 24.04+): Codex's Linux sandbox (bubblewrap) cannot start where unprivileged user namespaces are blocked
 * (`kernel.apparmor_restrict_unprivileged_userns=1`). Read-only and Ask first then fail at start (closed, as they must); say why.
 */
export function linuxSandboxHint(reason: string): string {
  return /bwrap|bubblewrap|user namespace|RTM_NEWADDR/i.test(reason)
    ? ' Codex could not start its Linux sandbox: this system blocks unprivileged user namespaces (Ubuntu AppArmor). Read-only and Ask first need that sandbox; allow it for bubblewrap (see the README, Codex) or use Allow all in a folder you trust.'
    : '';
}

/** FR-142: only a Codex model id is sent; `auto`/`default` and Copilot or Claude ids saved for the folder are left to Codex. */
export function codexModelFlag(model: string | undefined): boolean {
  return !!model && /^(gpt|o\d|codex)[A-Za-z0-9._:/-]{0,76}$/i.test(model);
}

const isShim = (file: string): boolean => /\.(cmd|bat)$/i.test(file);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A short, single-line reason: control characters stripped, 300 characters at most (server text is never trusted to be small or clean). */
const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').slice(0, 300);

interface Live {
  sid: string;
  /** Spec 030 FR-034: forked threads making a hand-off summary; their events never reach the chat. */
  forks?: Map<string, { text: string; done: (text: string) => void }>;
  /** The start options, for a relaunch with a new mode (FR-144). */
  options: StartOptions;
  /** A mode chosen while the session runs; it applies with the next message, on a fresh child (FR-144). */
  wantMode?: PermissionMode;
  threadId: string;
  /** FR-142: model and reasoning effort sent with each turn (a Codex model id only; others are left to Codex's default). */
  model?: string;
  effort?: string;
  cwd: string;
  mode: PermissionMode;
  roots: string[];
  rpc: CodexRpc;
  mapper: CodexMapper;
  broker: PermissionBroker;
  /** Resolves when the child has exited. */
  exited: Promise<void>;
  /** FR-147: the session's MCP servers and their state, by name; `relaunch` = a server was switched, applied with the next message. */
  mcp: Map<string, McpServerStatus>;
  relaunch?: boolean;
  /** The MCP list was read for this child (FR-147). */
  mcpRead?: boolean;
  /** FR-146: questions waiting for the user, by request id. */
  questions: Map<string, (answers: Record<string, string> | null) => void>;
  /** FR-151: MCP elicitations (forms, URL flows) waiting for the user, by request id. */
  elicitations: Map<string, ElicitWaiter>;
  /** Shell tool calls started and not yet ended (FR-139). */
  runningCommands: Set<string>;
  /** Drops mapper events (while starting with `quiet`, and once the session is stopping or dead). */
  muted: boolean;
  turnId?: string;
  /** Ids of turns already completed (bounded): a late `turn/start` response must not make one current again. */
  doneTurns: string[];
  /** A `turn/start` is on its way and its id is not known yet. */
  turnStarting: boolean;
  /** `interrupt` was asked before the turn id was known: send it as soon as it is. */
  pendingInterrupt: boolean;
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
  /** Optional debug sink (DURBAR_LOG). Receives short lines: rpc diagnostics, and on an unexpected exit the last stderr lines after `redact()` (FR-097). Never env values or prompts. */
  debug?: (message: string) => void;
  private listeners = new Set<(event: AgentEvent) => void>();
  private sessions = new Map<string, Live>();
  /** Ids this run has used, live or not: a stopped one cannot be silently restarted as a new thread (resume is T043b). */
  private known = new Set<string>();
  /** FR-143: Durbar session id -> Codex thread id, so a known session restarts by resuming its thread. */
  private threadOf = new Map<string, string>();
  /** Bumped by `dispose`: a start that began earlier closes its child and rejects. */
  private generation = 0;
  private inflight = new Set<Promise<unknown>>();
  /** Named sessions being started: reserved before the first await, so a second start or a stop sees them. */
  private starting = new Map<string, { cancelled: boolean; done: Promise<void> }>();
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
    this.env = o.env ?? codexChildEnv(process.env);
    this.appVersion = o.appVersion ?? 'dev';
    this.realpath = o.realpath ?? fs.realpathSync.native;
    this.closeGraceMs = o.closeGraceMs;
    this.killGraceMs = o.killGraceMs;
  }

  isLive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Spawn one `codex app-server` child (argv array, no shell). `onExit` and the handlers are given by the caller. */
  /** FR-138: Codex's own install folder, readable inside the Read-only profile (it runs its binary again in the sandbox). */
  private installRoots(file: string): string[] {
    const r = codexInstallRoot(file, this.realpath);
    return r ? [r] : [];
  }

  private spawnChild(file: string, cwd: string, handlers: { onNotification: (m: string, p: unknown) => void; onRequest: (m: string, p: unknown) => Promise<RequestOutcome>; onExit: (code: number | null, signal: NodeJS.Signals | null) => void }): Child {
    let done!: () => void;
    const exited = new Promise<void>((r) => (done = r));
    const rpc = createCodexRpc({
      spawn: this.spawnFn,
      file,
      args: ['app-server', ...codexProfileArgs(this.installRoots(file))],
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
  /**
   * FR-141/FR-142: a short-lived app-server for reads that need no session (previous sessions, a thread's history, the model
   * list): no thread, no turn, no prompt. Started in the temp folder with the same environment rules (D5); always closed.
   */
  private async probe<T>(fn: (rpc: CodexRpc) => Promise<T>, onNotification: (method: string, params: unknown) => void = () => undefined): Promise<T> {
    const loc = await this.locate();
    if (!loc?.path || isShim(loc.path)) throw new Error('Codex was not found on this computer.');
    const child = this.spawnChild(loc.path, os.tmpdir(), { onNotification, onRequest: async () => ({ error: { code: -32601, message: 'not handled in a probe' } }), onExit: () => undefined });
    try {
      await child.rpc.request('initialize', { clientInfo: { name: 'agent_durbar', title: 'Agent Durbar', version: this.appVersion }, capabilities: CODEX_INITIALIZE_CAPABILITIES });
      await child.rpc.notify('initialized');
      return await fn(child.rpc);
    } finally {
      await this.closeChild(child);
    }
  }

  /** Spec 040 FR-015: one prompt on an ephemeral, read-only thread in an empty temp folder, in a child of its own; nothing is kept. */
  async generateText(prompt: string): Promise<{ text: string }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-gen-'));
    let text = '';
    let finish: (t: string) => void = () => undefined;
    const done = new Promise<string>((r) => (finish = r));
    const onNote = (method: string, params: unknown): void => {
      const item = isObj(params) && isObj(params.item) ? params.item : undefined;
      if (method === 'item/completed' && item && item.type === 'agentMessage' && typeof item.text === 'string') text = item.text;
      else if (method === 'turn/completed') finish(text);
    };
    try {
      return await this.probe(async (rpc) => {
        const res = await rpc.request('thread/start', { cwd: dir, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' });
        const threadId = isObj(res) && isObj(res.thread) && typeof res.thread.id === 'string' ? res.thread.id : undefined;
        if (!threadId) throw new Error('Codex did not start a thread.');
        await rpc.request('turn/start', { threadId, input: [{ type: 'text', text: prompt }], approvalPolicy: 'never' });
        let timer: NodeJS.Timeout | undefined;
        const t = await Promise.race([done, new Promise<string>((r) => (timer = setTimeout(() => r(text), 180_000)))]);
        clearTimeout(timer);
        if (!t) throw new Error('Codex gave no answer.');
        return { text: t };
      }, onNote);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /** FR-141: the folder's earlier Codex threads (newest first), without the ones open now. */
  async listPreviousSessions(cwd: string, excludeIds: ReadonlySet<string> = new Set()): Promise<PreviousSession[]> {
    const res = await this.probe((rpc) => rpc.request('thread/list', { cwd, limit: 100 }));
    return codexPreviousSessions(isObj(res) ? res.data : undefined, cwd, new Set([...excludeIds, ...this.sessions.keys()]), process.platform, this.realpath);
  }

  /** FR-141: a session's prompts, answers, commands and file changes, for the chat replay after a resume. */
  async history(sessionId: string): Promise<HistoryResult> {
    const live = this.sessions.get(sessionId);
    const threadId = live?.threadId ?? sessionId;
    const read = (rpc: CodexRpc): Promise<unknown> => rpc.request('thread/read', { threadId, includeTurns: true });
    const res = live ? await read(live.rpc) : await this.probe(read);
    return codexHistory(isObj(res) ? res.thread : undefined);
  }

  private modelCache?: { at: number; list: Promise<ModelOption[]> };
  /** FR-142: the models this Codex account offers (`model/list`, no prompt). Cached 10 minutes; a failure is an empty list. */
  listModelOptions(): Promise<ModelOption[]> {
    const now = Date.now();
    if (this.modelCache && now - this.modelCache.at < 10 * 60_000) return this.modelCache.list;
    const list = this.probe((rpc) => rpc.request('model/list', {}))
      .then((res) => codexModelOptions(isObj(res) ? res.data : undefined))
      .catch(() => {
        this.modelCache = undefined;
        return [] as ModelOption[];
      });
    this.modelCache = { at: now, list };
    return list;
  }

  private async closeChild(c: Child): Promise<void> {
    c.rpc.close();
    const wait = (this.closeGraceMs ?? 2000) + (this.killGraceMs ?? 1000) + 500;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([c.exited, new Promise<void>((r) => (timer = setTimeout(r, wait)))]);
    if (timer) clearTimeout(timer);
  }

  async start(options: StartOptions): Promise<string> {
    const p = this.startReserved(options);
    this.inflight.add(p);
    try {
      return await p;
    } finally {
      this.inflight.delete(p);
    }
  }

  private async startReserved(options: StartOptions): Promise<string> {
    const named = options.sessionId;
    if (!named) return this.startInner(options, { cancelled: false });
    if (this.sessions.has(named) || this.starting.has(named)) throw new Error(`Session ${named} is already running.`);
    // FR-143: a session that ran before (End session, a crash, a mode relaunch) comes back by resuming its own thread
    const prior = this.known.has(named) ? this.threadOf.get(named) : undefined;
    if (this.known.has(named) && !prior && options.resumeSessionId === undefined) throw new Error(`Session ${named} cannot be restarted.`);
    if (prior && options.resumeSessionId === undefined) options = { ...options, resumeSessionId: prior };
    let release!: () => void;
    const token = { cancelled: false, done: new Promise<void>((r) => (release = r)) };
    this.starting.set(named, token);
    try {
      return await this.startInner(options, token);
    } finally {
      this.starting.delete(named);
      release();
    }
  }

  private async startInner(options: StartOptions, token: { cancelled: boolean }): Promise<string> {
    const generation = this.generation;
    const cancelled = (): void => {
      if (generation !== this.generation) throw new Error('Codex was shut down while the session was starting.');
      if (token.cancelled) throw new Error(`Session ${options.sessionId} was stopped while starting.`);
    };
    const mode = startModeOf(options);
    if (!this.capabilities.permissionModes.includes(mode)) throw new Error(`Codex cannot run in ${mode} mode.`);
    // FR-093: a known thread is resumed on a fresh child (below), never silently replaced by a new one.
    const resumeId = options.resumeSessionId;
    if (resumeId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(resumeId)) throw new Error('That is not a Codex session id.');
    const { cwd, folders } = resolveWorkspaceCwd(options.workspace);
    const roots = codexWorkspaceRoots([cwd, ...folders], this.realpath);
    const limited = mode !== 'allow';
    // Read-only and Ask first send the resolved cwd, consistent with the roots; Allow all uses it as given.
    let realCwd: string | undefined;
    try {
      realCwd = this.realpath(cwd);
    } catch {
      realCwd = undefined;
    }

    const loc = await this.locate();
    cancelled();
    if (!loc?.path) throw new Error('Codex was not found on this computer. Install the Codex CLI, then restart Durbar.');
    // A .cmd/.bat shim cannot carry the profile argument and cannot be spawned without a shell: refused in every mode (D4).
    if (isShim(loc.path)) throw new Error('Codex is launched through a .cmd launcher, which Durbar cannot run safely. Use the native codex.exe instead of the .cmd shim.');
    if (limited && !roots.length) throw new Error(`Durbar has no folder it can limit Codex's reads to. Add the project folder itself, not a drive or filesystem root, or a folder Durbar can resolve.`);

    if (limited && !realCwd) throw new Error(`Durbar cannot resolve the session folder (${path.basename(cwd)}), so it cannot confirm Codex reads only inside it. Check that the folder exists and Durbar can read it.`);

    if (limited) {
      // The folder Codex works in must be one of the folders it may read (or inside one), after symlinks are resolved.
      const [cwdRoot] = codexWorkspaceRoots([cwd], this.realpath);
      if (!cwdRoot || !roots.some((r) => isInside(r, cwdRoot))) {
        throw new Error(`The session folder (${path.basename(cwd)}) is not among the folders Durbar can limit Codex's reads to. Add the project folder itself, not a drive or filesystem root.`);
      }
    }

    // The ids and flags the handlers need exist before the child can talk.
    const live: Live = {
      sid: options.sessionId ?? '',
      options,
      threadId: '',
      ...(codexModelFlag(options.model) ? { model: options.model } : {}),
      ...(options.reasoningEffort && /^[a-z][a-z0-9_-]{0,15}$/.test(options.reasoningEffort) ? { effort: options.reasoningEffort } : {}),
      cwd,
      mode,
      roots,
      rpc: undefined as unknown as CodexRpc,
      mapper: undefined as unknown as CodexMapper,
      broker: undefined as unknown as PermissionBroker,
      exited: undefined as unknown as Promise<void>,
      muted: true, // until the session is up: the start itself reports "Ready" (or nothing, when quiet)
      stopping: false,
      doneTurns: [],
      runningCommands: new Set<string>(),
      questions: new Map(),
      elicitations: new Map(),
      mcp: new Map(),
      turnStarting: false,
      pendingInterrupt: false,
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
      cancelled();
      if (limited) {
        const ok = codexReadEnforceable({ version: loc.version, experimentalApi, platform: this.platform, elevatedSandbox: undefined });
        if (!ok.ok) throw new Error(`${ok.reason} ${ok.advice}`);
      }
      live.rpc = child.rpc;
      live.exited = child.exited;
      const settings = codexModeSettings(mode);
      let started: unknown;
      const mcpConfig = codexMcpConfig(options.mcpServers, options.disabledMcpServers); // FR-147
      const threadParams = { cwd: limited ? realCwd : cwd, ...settings, ...(limited ? { runtimeWorkspaceRoots: roots } : {}), ...(mcpConfig ? { config: mcpConfig } : {}) };
      if (resumeId !== undefined) {
        // FR-093 (real, Codex 0.163): `thread/resume` with a cwd REWRITES the thread's folder, so the folder check reads the
        // stored thread first and refuses before anything is changed.
        let stored: unknown;
        try {
          stored = await child.rpc.request('thread/read', { threadId: resumeId, includeTurns: false });
        } catch (e) {
          throw new Error(`That Codex session could not be found: ${reasonOf(e)}`);
        }
        codexResumeCheck(isObj(stored) && isObj(stored.thread) ? { cwd: stored.thread.cwd } : {}, { cwd: (limited ? realCwd : cwd) as string, limited: false, realpath: this.realpath, required: true });
      }
      try {
        // FR-093: resume on this fresh child, so the thread is never already loaded with an older profile
        started = resumeId !== undefined
          ? await child.rpc.request('thread/resume', { threadId: resumeId, excludeTurns: true, ...threadParams })
          : await child.rpc.request('thread/start', threadParams);
      } catch (e) {
        // Never retried with a weaker setting (FR-087).
        throw new Error(`Codex refused the session settings: ${reasonOf(e)}${linuxSandboxHint(reasonOf(e))}`);
      }
      if (resumeId !== undefined) codexResumeCheck(started, { cwd: (limited ? realCwd : cwd) as string, limited, realpath: this.realpath });
      const thread = isObj(started) && isObj(started.thread) ? started.thread : undefined;
      const threadId = thread && typeof thread.id === 'string' && thread.id ? thread.id : undefined;
      if (!threadId) throw new Error('Codex did not return a thread id.');
      live.threadId = threadId;
      cancelled();
    } catch (e) {
      await this.closeChild(child);
      throw e instanceof Error ? e : new Error(String(e));
    }

    // From here the session exists. The thread id is the Durbar session id unless the caller named one (FR-092).
    live.sid = options.sessionId ?? live.threadId;
    live.mapper.adopt(live.threadId, cwd); // thread/started may or may not have arrived yet
    live.muted = false;
    this.sessions.set(live.sid, live);
    this.known.add(live.sid);
    this.threadOf.set(live.sid, live.threadId);
    if (live.rpc.exited) {
      // The child died between the response and now: report it like any crash.
      this.sessions.delete(live.sid);
      throw new Error('Codex stopped unexpectedly while starting.');
    }
    if (!options.quiet) this.emit(live.sid, { type: 'status', status: 'idle', intent: `Ready in ${cwd}` });
    if (!options.quiet) void this.refreshMcp(live); // FR-147: the session's MCP servers; a quiet start emits nothing (C3), so its first message reads them
    return live.sid;
  }

  async send(sessionId: string, message: AgentMessage): Promise<void> {
    let live = this.mustGet(sessionId);
    // FR-144/FR-147: a mode or MCP switch chosen while it ran applies now, on a fresh child that resumes the same thread
    if (((live.wantMode && live.wantMode !== live.mode) || live.relaunch) && live.turnId === undefined && !live.turnStarting) {
      const next = { ...live.options, permissionMode: live.wantMode ?? live.mode, sessionId, resumeSessionId: undefined, quiet: true };
      await this.stop(sessionId, true);
      await this.start(next);
      live = this.mustGet(sessionId);
    }
    live.expectAborted = false;
    if (!live.mcpRead) void this.refreshMcp(live); // FR-147: after a quiet start, with the first message
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
      ...(live.model ? { model: live.model } : {}),
      ...(live.effort ? { effort: live.effort } : {}),
    };
    live.turnStarting = true;
    live.pendingInterrupt = false;
    try {
      const res = await live.rpc.request('turn/start', params);
      const id = isObj(res) && isObj(res.turn) && typeof res.turn.id === 'string' ? res.turn.id : undefined;
      if (id && live.turnId === undefined && !live.doneTurns.includes(id)) live.turnId = id;
      live.turnStarting = false;
      if (live.pendingInterrupt && live.turnId) await this.fireInterrupt(live, live.turnId);
    } catch (e) {
      live.turnStarting = false;
      live.pendingInterrupt = false;
      if (isRpcError(e) || (e as { kind?: string }).kind === 'timeout') this.emit(sessionId, { type: 'status', status: 'error', intent: `Codex refused the message: ${reasonOf(e)}`.slice(0, 300) });
      throw e;
    }
  }

  /** Interrupt the running turn; the session stays live and grants stay (C10). With no turn running nothing is sent. */
  /** Spec 030 FR-034: a hand-off summary from an ephemeral fork (read-only, no approvals); the session's thread is not changed. */
  async handoffSummary(sessionId: string): Promise<HandoffResult> {
    const live = this.sessions.get(sessionId);
    if (!live?.rpc || !live.threadId) throw new Error('Open the session first (send a message), then ask for a summary.');
    const res = await live.rpc.request('thread/fork', { threadId: live.threadId, ephemeral: true, excludeTurns: true, approvalPolicy: 'never', sandbox: 'read-only', ...(live.model ? { model: live.model } : {}) });
    const forkId = isObj(res) && isObj(res.thread) && typeof res.thread.id === 'string' ? res.thread.id : undefined;
    if (!forkId) throw new Error('Codex did not fork the conversation.');
    const forks = (live.forks ??= new Map());
    let timer: NodeJS.Timeout | undefined;
    const text = new Promise<string>((resolve) => {
      forks.set(forkId, { text: '', done: resolve });
      timer = setTimeout(() => resolve(forks.get(forkId)?.text ?? ''), 180_000);
    });
    try {
      await live.rpc.request('turn/start', { threadId: forkId, input: [{ type: 'text', text: HANDOFF_PROMPT }], approvalPolicy: 'never' });
      return { summary: cleanSummary(await text) };
    } finally {
      clearTimeout(timer);
      forks.delete(forkId);
      void live.rpc.request('thread/unsubscribe', { threadId: forkId }).catch(() => undefined);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    live.interrupting = true;
    try {
      live.broker.denyPending();
      for (const answer of [...live.questions.values()]) answer(null); // FR-146: an open question is skipped
      cancelElicitations(live.elicitations); // FR-151
      const turnId = live.turnId;
      if (!turnId) {
        // A turn is starting but its id is not known yet: remember the request and send it the moment the id arrives.
        if (live.turnStarting) live.pendingInterrupt = true;
        return;
      }
      await this.fireInterrupt(live, turnId);
    } finally {
      // Let the answers of the denied requests (which read this flag) go out first.
      await new Promise<void>((r) => setImmediate(r));
      live.interrupting = false;
    }
  }

  /** `turn/interrupt` for a known turn, then "Aborted" once (the mapper's own one for this turn is dropped). */
  private async fireInterrupt(live: Live, turnId: string): Promise<void> {
    live.pendingInterrupt = false;
    live.expectAborted = true;
    try {
      await live.rpc.request('turn/interrupt', { threadId: live.threadId, turnId });
    } catch {
      /* the turn ended on its own, or the child is gone */
    }
    // FR-139 (real, Codex 0.163): a command that already started keeps running after turn/interrupt; End session stops it
    const intent = live.runningCommands.size ? 'Aborted (a command that already started may still finish; End session stops it)' : 'Aborted';
    if (this.sessions.get(live.sid) === live) this.emit(live.sid, { type: 'status', status: 'idle', intent });
  }

  /** End the session: pending permissions are denied, the turn interrupted, the thread unsubscribed, the child closed. */
  /** FR-143: the Codex thread behind a Durbar session, the id to remember for a resume after a restart (spec 006 FR-020). */
  resumeIdOf(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.threadId ?? this.threadOf.get(sessionId);
  }

  /**
   * FR-144: change the permission mode of a running session. Durbar's own approvals follow at once; Codex's sandbox and approval
   * policy cannot change on a loaded thread, so the next message reopens the thread on a fresh child with the new settings.
   * A stricter mode during a running turn interrupts that turn, so nothing more runs under the looser mode.
   */
  setPermMode(sessionId: string, mode: PermissionMode, opts: { clearGrants?: boolean; approvePending?: boolean } = {}): { pending: number } {
    const live = this.sessions.get(sessionId);
    if (!live) return { pending: 0 };
    const rank = (m: PermissionMode): number => ({ 'read-only': 0, ask: 1, allow: 2 })[m] ?? 0;
    live.broker.setMode(mode);
    live.wantMode = mode === live.mode ? undefined : mode;
    if (opts.clearGrants) live.broker.clearGrants();
    let pending = live.broker.pendingCount();
    if (pending) {
      if (opts.approvePending && mode !== 'read-only') pending -= live.broker.approvePending();
      else if (mode === 'read-only') pending -= live.broker.denyPendingByUser();
    }
    if (rank(mode) < rank(live.mode) && (live.turnId !== undefined || live.turnStarting)) void this.interrupt(sessionId);
    return { pending };
  }

  async stop(sessionId: string, silent = false): Promise<void> {
    const starting = this.starting.get(sessionId);
    if (starting) {
      // Stop during start: the start closes its child and never registers; wait for that.
      starting.cancelled = true;
      await starting.done;
      return;
    }
    const live = this.sessions.get(sessionId);
    if (!live) return;
    this.sessions.delete(sessionId);
    live.stopping = true;
    live.muted = true;
    live.broker.stop();
    for (const answer of [...live.questions.values()]) answer(null); // FR-146
    cancelElicitations(live.elicitations); // FR-151
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
    if (!silent) this.emit(sessionId, { type: 'status', status: 'stopped' });
  }

  resolvePermission(sessionId: string, requestId: string, approve: boolean, remember = false, broad = false): void {
    this.sessions.get(sessionId)?.broker.resolve(requestId, approve, remember, broad);
  }

  revokeGrant(sessionId: string, key: string): void {
    this.sessions.get(sessionId)?.broker.revoke(key);
  }

  /** Stop every session and wait for every child. [KNOWN GAP] (T042): only the direct child is signalled. */
  async dispose(): Promise<void> {
    this.generation++; // starts in flight close their child and reject
    await Promise.allSettled([...this.inflight]);
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
    // FR-139: shell commands that are running now (Codex's turn/interrupt does not end one that already started)
    if (body.type === 'toolCall' && body.tool === 'shell' && typeof body.callId === 'string') {
      if (body.phase === 'start') live.runningCommands.add(body.callId);
      else if (body.phase !== 'update') live.runningCommands.delete(body.callId);
    }
    if (live.expectAborted && body.type === 'status' && body.status === 'idle' && body.intent === 'Aborted' && (body as { agentId?: string }).agentId === undefined) {
      live.expectAborted = false; // `interrupt` reports it itself, once
      return;
    }
    this.emit(live.sid, body);
  }

  private onNotification(live: Live, method: string, params: unknown): void {
    // Spec 030 FR-034: a hand-off fork's events are collected here and never mapped to the chat
    const fork = isObj(params) && typeof params.threadId === 'string' ? live.forks?.get(params.threadId) : undefined;
    if (fork) {
      const item = isObj(params) && isObj(params.item) ? params.item : undefined;
      if (method === 'item/completed' && item && item.type === 'agentMessage' && typeof item.text === 'string') fork.text = item.text;
      else if (method === 'turn/completed') fork.done(fork.text);
      return;
    }
    // FR-147: a server's startup state, for this thread (or all threads)
    if (method === 'mcpServer/startupStatus/updated' && isObj(params) && typeof params.name === 'string' && (params.threadId == null || params.threadId === live.threadId)) {
      const name = params.name.slice(0, 64);
      const disabled = (live.options.disabledMcpServers ?? []).includes(name);
      const err = typeof params.error === 'string' && params.error ? { error: params.error.slice(0, 300) } : {};
      live.mcp.set(name, { ...(live.mcp.get(name) ?? {}), name, status: disabled ? 'disabled' : codexMcpState(params.status), ...err });
      if (this.sessions.get(live.sid) === live) this.emitMcp(live);
      return;
    }
    // Keep the running turn's id for interrupt and stop.
    if (isObj(params) && (params.threadId === undefined || params.threadId === live.threadId)) {
      const turn = isObj(params.turn) ? params.turn : undefined;
      if (method === 'turn/started' && turn && typeof turn.id === 'string') {
        if (!live.doneTurns.includes(turn.id)) {
          live.turnId = turn.id;
          live.turnStarting = false;
          if (live.pendingInterrupt) void this.fireInterrupt(live, turn.id);
        }
      }
      else if (method === 'turn/completed') {
        const done = turn && typeof turn.id === 'string' ? turn.id : live.turnId;
        if (done) live.doneTurns = [...live.doneTurns, done].slice(-32);
        live.turnId = undefined;
        live.turnStarting = false;
        live.pendingInterrupt = false;
      }
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
  }

  /** A server request (approval or question). Read-only is double-locked: the broker denies and `codexReply` declines. Never `acceptForSession`. */
  private async onServerRequest(live: Live, method: string, params: unknown): Promise<RequestOutcome> {
    if (method === 'item/tool/requestUserInput' || method === 'tool/requestUserInput') return this.askUser(live, params);
    // FR-148 (real, Codex 0.163): an MCP elicitation answers with {action, content}, not {decision}. A plain confirmation (no
    // fields, e.g. "allow this tool call?") goes through the approval below. FR-151: one with form fields, or a URL flow, goes to
    // the question card (an unsupported required field or a non-https URL is declined there, with the reason shown).
    const elicit = method === 'mcpServer/elicitation/request';
    if (elicit && codexElicitationHasFields(params)) {
      if (live.stopping) return { result: { action: 'cancel' } };
      const p = isObj(params) ? params : {};
      const a = await runElicitation((b) => this.emit(live.sid, b), live.elicitations, `codex-e-${++live.anon}`, { message: p.message, schema: p.requestedSchema, mode: p.mode, url: p.url, source: p.serverName }, (m) => this.debug?.(`codex: ${m}`));
      return { result: { ...a } };
    }
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
    if (elicit) return { result: reply.decision === 'accept' ? { action: 'accept', content: {} } : { action: answer === 'stop' ? 'cancel' : 'decline' } };
    return { result: { decision: reply.decision } };
  }

  /**
   * FR-146: Codex asks the user (`item/tool/requestUserInput`). The questions go to the question card (spec 012 FR-128); the
   * answer goes back keyed by Codex's question id. Skip, Stop and End session answer with nothing. A secret question
   * (`isSecret`) is never shown or answered here: what is typed into the card lands in the chat.
   */
  private async askUser(live: Live, params: unknown): Promise<RequestOutcome> {
    const raw = isObj(params) && Array.isArray(params.questions) ? params.questions.filter((q) => isObj(q) && q.isSecret !== true) : [];
    const { asked, originals } = parseQuestionsWithOriginals({ questions: raw });
    const idOf = new Map<string, string>();
    asked.forEach((q, i) => {
      const src = raw.find((r) => isObj(r) && String(r.question) === originals[i]) as Record<string, unknown> | undefined;
      if (src && typeof src.id === 'string') idOf.set(q.question, src.id);
    });
    if (!asked.length || live.stopping) return { result: { answers: {} } };
    const requestId = `codex-q-${++live.anon}`;
    const answers = await new Promise<Record<string, string> | null>((resolve) => {
      live.questions.set(requestId, resolve);
      this.emit(live.sid, { type: 'question', phase: 'asked', requestId, questions: asked });
      this.emit(live.sid, { type: 'status', status: 'needs-permission', intent: 'Waiting for your answer' });
    });
    live.questions.delete(requestId);
    const clean = answers ? cleanAnswers(asked, answers) : undefined;
    if (!clean) {
      this.emit(live.sid, { type: 'question', phase: 'cancelled', requestId });
      return { result: { answers: {} } };
    }
    this.emit(live.sid, { type: 'question', phase: 'answered', requestId, answers: clean });
    this.emit(live.sid, { type: 'status', status: 'working', intent: 'Answered' });
    const out: Record<string, { answers: string[] }> = {};
    for (const [q, a] of Object.entries(clean)) {
      const id = idOf.get(q);
      if (id) out[id] = { answers: a.split(/,\s*/).filter(Boolean) };
    }
    return { result: { answers: out } };
  }

  /** FR-147: the session's MCP servers from `mcpServerStatus/list`; a failure leaves the list as it was. */
  private async refreshMcp(live: Live): Promise<void> {
    live.mcpRead = true;
    try {
      const res = await live.rpc.request('mcpServerStatus/list', { threadId: live.threadId, detail: 'toolsAndAuthOnly', limit: 100 });
      if (this.sessions.get(live.sid) !== live) return;
      live.mcp = new Map(codexMcpServers(isObj(res) ? res.data : undefined, live.options.disabledMcpServers ?? []).map((s) => [s.name, s]));
      this.emitMcp(live);
    } catch {
      /* an older Codex without the method: no list */
    }
  }

  private emitMcp(live: Live): void {
    this.emit(live.sid, { type: 'mcp', servers: [...live.mcp.values()].map((s) => ({ ...s })) });
  }

  /** FR-147: switch one MCP server of the session; it applies with the next message (fresh child, same thread), like a mode. */
  async setMcpEnabled(sessionId: string, name: string, enabled: boolean): Promise<void> {
    const live = this.mustGet(sessionId);
    const off = new Set(live.options.disabledMcpServers ?? []);
    if (enabled) off.delete(name);
    else off.add(name);
    live.options = { ...live.options, disabledMcpServers: [...off] };
    live.relaunch = true;
    const cur = live.mcp.get(name) ?? { name, status: 'pending' };
    live.mcp.set(name, { ...cur, status: enabled ? 'pending' : 'disabled' });
    this.emitMcp(live);
  }

  answerQuestion(sessionId: string, requestId: string, answers: Record<string, string> | null): void {
    this.sessions.get(sessionId)?.questions.get(requestId)?.(answers);
  }

  /** FR-151: the user's answer to an MCP elicitation (main checked it against the fields). */
  answerElicitation(sessionId: string, requestId: string, answer: ElicitAnswer): void {
    answerElicitation(this.sessions.get(sessionId)?.elicitations, requestId, answer);
  }

  /** The child exited. Not caused by `stop`: the session is over and says so (FR-097). */
  private onExit(live: Live, code: number | null, signal: NodeJS.Signals | null): void {
    if (live.stopping || !live.rpc) return; // `stop`, or a child that was closed during start (a failed handshake, the Allow all retry)
    live.muted = true;
    const registered = this.sessions.get(live.sid) === live;
    if (registered) this.sessions.delete(live.sid);
    live.broker.stop();
    const tail = live.rpc?.stderrTail() ?? [];
    if (tail.length) this.debug?.(`codex stderr (last lines): ${redact(tail.slice(-5).join(' | '), { ...process.env, ...this.env })}`);
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
