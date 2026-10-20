import { isAuthError, markAuthError, signInFromError } from './autherrors';
import { randomUUID } from 'crypto';
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import { parseQuestions } from './questions';
import { answerElicitation, cancelElicitations, runElicitation, type ElicitWaiter } from './elicitation';
import type { ElicitAnswer } from '../shared/elicit';
import type { CopilotSession, MCPServerConfig, ModelInfo, PermissionRequest, PermissionRequestResult, ResumeSessionConfig, SessionConfig, SessionEvent } from '@github/copilot-sdk';
import type {
  AdapterCapabilities,
  AgentAdapter,
  LimitAction,
  AgentEvent,
  AgentMessage,
  CompactResult,
  ModelSwitchRequest,
  ModelSwitchResult,
  PermissionInfo,
  PermissionMode,
  GenerateTextOptions,
  GenerateTextResult,
  SignInCheck,
  StartOptions,
  Unsubscribe,
} from './types';
import type { AdapterDescriptor } from './capabilities';
import { EventMapper } from './map';
import type { EventBody, RawEvent } from './map';
import { compactResultFrom, modelConfig, modelOptionFrom, runtimeMessage, sdkTier, switchResultFrom } from './copilotmodel';
import type { ModelOption, RawModelInfo, RawSwitchResult } from './copilotmodel';
import { PermissionBroker, isInsideRoots, startModeOf } from './permissions';
import type { BrokerEvent, PermissionLike } from './permissions';
import { resolveWorkspaceCwd } from './workspace';
import type { AgentProfile } from './types';
import { cleanSessionTitle, eventsToHistory, previousSessionsFor } from './history';
import type { HistoryResult, PreviousSession } from './history';
import { unpackedRuntimePath } from './runtime';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { cleanSummary } from './handoff';
import type { HandoffResult } from './handoff';
import { sessionIdOk } from '../shared/sessionid';
import { allowedRemoteUrl, cleanRemoteError, isRemoteVisibility } from '../shared/remote';
import type { RemoteState } from '../shared/remote';

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

export type { ModelOption };

interface Live {
  session: CopilotSession;
  unsubscribe: () => void;
  cwd: string;
  broker: PermissionBroker;
  /** `session_limits_exhausted.requested` waiting for the user (spec 011): answered with `cancel` when the turn is stopped or the session ends. */
  limitRequestId?: string;
  /** A title reached the app (event or name.get), or name.get was already asked once (issue #126). */
  titled?: boolean;
  askedTitle?: boolean;
  /** `ask_user` questions waiting for the user (spec 002 FR-058): request id -> waiter. */
  questions?: Map<string, { choices: string[]; resolve: (answer: string | null) => void }>;
  /** MCP elicitations waiting for the user (spec 012 FR-151): request id -> waiter. */
  elicitations?: Map<string, ElicitWaiter>;
  /** The session's folders (spec 043: a profile file inside one is the repository's). */
  folders?: string[];
  /** Spec 012 FR-158: what a reconnect after a sign-in needs to resume this session on a new client with the same handlers and broker. */
  resumeConfig?: () => Record<string, unknown>;
  onSessionEvent?: (ev: SessionEvent) => void;
  /** Changes made while the session ran, put back after a reconnect (FR-158): the credit cap, and MCP servers switched on or off. */
  cap?: number | null;
  mcpToggles?: Map<string, boolean>;
}

/** spec 043 FR-002: the folders Copilot reads agent files from: each session folder's `.github/agents` and the user's `~/.copilot/agents`. */
export function agentDirsFor(folders: readonly string[], home = os.homedir()): string[] {
  return [...new Set(folders)].map((f) => path.join(f, '.github', 'agents')).concat(path.join(home, '.copilot', 'agents'));
}

/** spec 043 FR-001: an SDK agent as a generic profile; undefined for sub-agent-only agents. */
export function profileOf(a: { id?: unknown; name?: unknown; displayName?: unknown; description?: unknown; path?: unknown; source?: unknown; userInvocable?: unknown; tools?: unknown; model?: unknown; mcpServers?: unknown }, folders: readonly string[] = []): AgentProfile | undefined {
  const id = typeof a.id === 'string' && a.id ? a.id : typeof a.name === 'string' ? a.name : '';
  if (!id || a.userInvocable === false) return undefined;
  const name = cleanSessionTitle(a.displayName, 60) ?? cleanSessionTitle(a.name, 60) ?? id;
  const description = cleanSessionTitle(a.description, 200);
  // real (2026-10-19): agents loaded through `agentDirectories` are all reported as `user`, so a file inside a session folder is the
  // repository's (it asks once before use, FR-003) whatever the runtime says
  const inFolder = typeof a.path === 'string' && folders.some((f) => isInsideRoots(a.path as string, [f]));
  const source: AgentProfile['source'] = inFolder || a.source === 'project' || a.source === 'inherited' ? 'repo' : a.source === 'user' ? 'user' : 'other';
  return {
    id: id.slice(0, 100),
    name,
    ...(description ? { description } : {}),
    source,
    ...(typeof a.path === 'string' ? { path: a.path } : {}),
    // real (2026-10-19): the runtime reports "all tools" as `['*']`; that is the same as no list
    ...(Array.isArray(a.tools) && !a.tools.includes('*') ? { tools: a.tools.filter((t): t is string => typeof t === 'string').slice(0, 100) } : {}),
    ...(typeof a.model === 'string' && a.model ? { model: a.model.slice(0, 100) } : {}),
    ...(a.mcpServers && typeof a.mcpServers === 'object' ? { mcpServers: Object.keys(a.mcpServers as object).slice(0, 50) } : {}),
  };
}

/** What Copilot gets when the user skips an `ask_user` question (spec 002 FR-058). */
const SKIPPED_ANSWER = '(The user skipped the question. Decide yourself.)';

const COPILOT_ID = 'copilot';
const COPILOT_NAME = 'GitHub Copilot';
/** From the code (spec 012 FR-009); not newly verified on a real account. Deeply frozen. */
export const COPILOT_CAPABILITIES: AdapterCapabilities = Object.freeze({
  interrupt: true,
  resume: true,
  images: true,
  models: true,
  effort: true,
  permissionModes: Object.freeze(['read-only', 'ask', 'allow'] as const),
  permModeSwitch: 'live',
  usage: Object.freeze({ tokens: true, costUsd: false, nanoAiu: true }),
  context: true,
  caps: true,
  helpers: true,
  history: true,
  mcpStatus: true,
  mcpToggle: true,
  handoff: true, // spec 030 FR-034: rpc.history.summarizeForHandoff (cost unverified)
  modelSwitch: Object.freeze({ verified: true, contextTier: true }), // spec 030 Phase 3 (real 2026-10-20, Copilot Pro): switch, effort, long tier, confirmation and compact-and-switch (T041, T044, T045)
  remote: true, // spec 054 FR-002: rpc.remote.enable/disable (@experimental; real 2026-10-20: `started: false` outside a GitHub repository, never seen started)
  remoteService: Object.freeze({ name: 'GitHub', host: 'github.com', mobile: 'GitHub Mobile' }), // spec 054 FR-060
  deleteSession: true, // spec 006 FR-028: CopilotClient.deleteSession (read: SDK 1.0.22 client.d.ts; never run on a real session)
  oneShot: true, // spec 040 FR-015: a throw-away SDK session with no tools and no MCP, deleted after (real 2026-10-20: no tool ran, nothing left on disk)
});

/** Spec 054 FR-063 (real, 2026-10-20): not started in a plain folder, a `git init` folder and a private GitHub repository alike, on Copilot Free. */
export const REMOTE_NOT_STARTED = 'Copilot did not start remote control and gave no reason. It needs a paid Copilot plan: on Copilot Free it never started in our checks, on Copilot Pro it did.';

/** Spec 040 FR-015: how long one `generateText` may take before it is aborted (the same 3 minutes as Claude and Codex). */
export const ONE_SHOT_TIMEOUT_MS = 180_000;

/**
 * Spec 040 FR-015: the config of the throw-away session behind `generateText`. Nothing can act and nothing is kept:
 * no tool from any source (`availableTools: []`, and `excludedTools` as a second lock), the MCP servers the runtime would load on its own
 * switched off by name, no skills, custom agents, discovered config, instructions, hooks, git context, memory, session store or
 * infinite-session workspace, an empty temp folder as the working directory, and the cheapest `auto` routing (as a new `auto` session).
 */
export function oneShotConfig(dir: string, disabledMcpServers: readonly string[] = []): Record<string, unknown> {
  return {
    workingDirectory: dir,
    ...modelConfig({ model: 'auto', autoTier: 'efficiency' }, false),
    streaming: false,
    availableTools: [],
    excludedTools: ['builtin:*', 'mcp:*', 'custom:*'],
    mcpServers: {},
    ...(disabledMcpServers.length ? { disabledMcpServers: [...disabledMcpServers] } : {}),
    enableConfigDiscovery: false,
    enableSkills: false,
    customAgents: [],
    skipCustomInstructions: true,
    enableOnDemandInstructionDiscovery: false,
    enableFileHooks: false,
    enableHostGitOperations: false,
    enableSessionStore: false,
    memory: { enabled: false },
    infiniteSessions: { enabled: false },
    embeddingCacheStorage: 'in-memory',
    remoteSession: 'off',
  };
}

/**
 * Copilot adapter on the official `@github/copilot-sdk` (1.0.x, CLI runtime 1.0.98).
 * One CopilotClient (one runtime process) is shared; one SDK session per folder.
 */
export class CopilotAdapter implements AgentAdapter {
  readonly id = COPILOT_ID;
  readonly displayName = COPILOT_NAME;
  /** One constant shared with the descriptor (spec 012 FR-034). */
  readonly capabilities: AdapterCapabilities = COPILOT_CAPABILITIES;
  private listeners = new Set<(event: AgentEvent) => void>();
  private client: CopilotClient | undefined;
  private starting: Promise<CopilotClient> | undefined;
  /** Spec 012 FR-158: a running `refreshAuth` (calls that use a session wait for it). */
  private refreshing: Promise<void> | undefined;
  private sessions = new Map<string, Live>();
  /** Optional debug sink (DURBAR_LOG): what was actually handed to the SDK. */
  debug?: (message: string) => void;
  /** Spec 040 FR-015: the `generateText` time limit; protected so a test can shorten it. */
  protected oneShotTimeoutMs = ONE_SHOT_TIMEOUT_MS;
  /** One mapper per session (it remembers tool names, reasoning ids and sub-agent ids of that session). */
  private mappers = new Map<string, EventMapper>();

  /** Lazily start the shared runtime. Uses the logged-in Copilot user (e.g. `copilot login`). Protected so a test can hand in a fake client (no runtime process, no credits). */
  protected async getClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    const starting = (this.starting ??= this.createClient().then((c) => {
      if (this.starting === starting) this.client = c;
      return c;
    }));
    return starting;
  }

  /** Start one runtime client. Protected so a test can hand in a new fake client each time (spec 012 FR-158). */
  protected async createClient(): Promise<CopilotClient> {
    // Packaged app: run the runtime from app.asar.unpacked. Dev: let the SDK locate it.
    // No token is passed or stored here; the runtime uses the Copilot login on this machine.
    const runtimePath = unpackedRuntimePath();
    this.debug?.(`runtime: ${runtimePath ?? 'sdk default'}`);
    const c = new CopilotClient(
      runtimePath ? { connection: RuntimeConnection.forStdio({ path: runtimePath }), workingDirectory: os.homedir() } : {},
    );
    await c.start();
    return c;
  }

  /**
   * Spec 012 FR-158: make the shared runtime use a new sign-in. The SDK has no call that reloads the machine's stored login
   * (its `account.login` and `session.gitHubAuth.setCredentials` take a token, which Durbar never handles), so the client is
   * stopped gracefully and dropped; the next `getClient()` starts a fresh one, and every live session is resumed on it with
   * the same handlers, permission broker and grants. A card shows "Reconnecting Copilot…" meanwhile. A turn that was running
   * is cut (its history stays). Nothing started yet: nothing to do, the first client reads the new sign-in.
   */
  async refreshAuth(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (!this.client && !this.starting) return;
    const run = this.reconnect().finally(() => {
      if (this.refreshing === run) this.refreshing = undefined;
    });
    this.refreshing = run;
    return run;
  }

  private async reconnect(): Promise<void> {
    const old = this.client ?? (await this.starting?.catch(() => undefined));
    const ids = [...this.sessions.keys()];
    const busy = new Map<string, boolean>();
    for (const sid of ids) {
      const live = this.sessions.get(sid)!;
      busy.set(sid, await this.processing(live));
      live.unsubscribe();
      live.broker.denyPending(); // the old runtime's requests and questions die with it
      this.cancelQuestions(live);
      live.limitRequestId = undefined;
      this.emit(sid, { type: 'status', status: 'working', intent: 'Reconnecting Copilot…' });
    }
    this.client = undefined;
    this.starting = undefined;
    if (old) {
      try {
        const errors = await old.stop();
        if (errors?.length) this.debug?.(`refreshAuth: ${errors.length} cleanup error(s) on the old client`);
      } catch (e) {
        this.debug?.(`refreshAuth: old client stop failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    let client: CopilotClient;
    try {
      client = await this.getClient();
    } catch (e) {
      for (const sid of ids) this.dropAfterReconnect(sid, e);
      throw e;
    }
    for (const sid of ids) {
      const live = this.sessions.get(sid);
      if (!live?.resumeConfig || !live.onSessionEvent) continue;
      try {
        const cfg = { ...live.resumeConfig(), ...(live.cap !== undefined ? { sessionLimits: live.cap === null ? undefined : { maxAiCredits: live.cap } } : {}) };
        const session = await client.resumeSession(sid, cfg as unknown as ResumeSessionConfig);
        live.session = session;
        live.unsubscribe = session.on(live.onSessionEvent);
        void session.rpc.eventLog.registerInterest({ eventType: 'session_limits_exhausted.requested' }).catch(() => undefined);
        for (const [name, on] of live.mcpToggles ?? []) {
          await (on ? session.rpc.mcp.enable({ serverName: name }) : session.rpc.mcp.disable({ serverName: name })).catch(() => undefined);
        }
        this.emit(sid, { type: 'status', status: 'idle', intent: busy.get(sid) ? 'Reconnected with the new sign-in. The running turn was stopped; send it again if needed.' : 'Reconnected with the new sign-in.' });
      } catch (e) {
        this.dropAfterReconnect(sid, e);
      }
    }
  }

  /** A session that could not be resumed after a reconnect is ended (its history stays on disk; sending again resumes it). */
  private dropAfterReconnect(sid: string, e: unknown): void {
    const live = this.sessions.get(sid);
    if (!live) return;
    live.broker.stop();
    this.sessions.delete(sid);
    this.mappers.delete(sid);
    this.debug?.(`refreshAuth: ${sid.slice(0, 8)} not resumed: ${e instanceof Error ? e.message : String(e)}`);
    this.emit(sid, { type: 'status', status: 'stopped', intent: 'Could not reconnect after the sign-in. Send a message to resume.' });
  }

  /** Spec 051 FR-007: the runtime's own sign-in status (no prompt, no credits). The login name, host and message are dropped. */
  async authStatus(): Promise<{ signedIn: boolean }> {
    const s = await (await this.getClient()).getAuthStatus();
    return { signedIn: !!s.isAuthenticated };
  }

  /**
   * Spec 012 FR-156: is the sign-in really valid? `getAuthStatus()` only looks on this computer (it also finds `gh` or keyring
   * credentials), so a "yes" is then confirmed with a server call that needs a valid token and spends nothing:
   * `account.getQuota` (@experimental; not cached by the SDK), or, when the runtime lacks it, `models.list` straight through the
   * RPC (the SDK's `listModels()` caches its first answer for the client's life, so it could not notice an expired sign-in).
   * An error that reads like a sign-in failure means signed out; anything else (network, timeout) is unknown.
   */
  async verifySignIn(): Promise<SignInCheck> {
    const client = await this.getClient();
    let local: { isAuthenticated?: boolean } | undefined;
    try {
      local = await client.getAuthStatus();
    } catch (e) {
      return { status: signInFromError(e) };
    }
    if (!local?.isAuthenticated) return { status: 'signed-out', detail: 'No Copilot sign-in on this computer.' };
    const rpc = (client as unknown as { rpc?: { account?: { getQuota?: (p: object) => Promise<unknown> }; models?: { list?: (p: object) => Promise<unknown> } } }).rpc;
    const calls: Array<() => Promise<unknown>> = [];
    if (typeof rpc?.account?.getQuota === 'function') calls.push(() => rpc.account!.getQuota!({}));
    if (typeof rpc?.models?.list === 'function') calls.push(() => rpc.models!.list!({}));
    else calls.push(() => client.listModels());
    for (const call of calls) {
      try {
        await call();
        return { status: 'signed-in', detail: 'Signed in (checked with GitHub).' };
      } catch (e) {
        if (isAuthError(e)) return { status: 'signed-out', detail: 'GitHub did not accept the Copilot sign-in.' };
        // any other error (the runtime lacks the call, a network problem): try the next call, then say unknown
      }
    }
    return { status: 'unknown' };
  }

  /** Models visible to the logged-in user (no inference, no credits). */
  async listModels(): Promise<ModelInfo[]> {
    return (await this.getClient()).listModels();
  }

  /** Cheapest model by billing multiplier, falling back to input token price. Undefined if none reports billing. */
  /** What the logged-in account offers, in the shape the UI needs (no inference, no credits). */
  async listModelOptions(): Promise<ModelOption[]> {
    return (await this.listModels()).map((m) => modelOptionFrom(m as unknown as RawModelInfo));
  }

  isLive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async cheapestModel(): Promise<ModelInfo | undefined> {
    const models = (await this.listModels()).filter((m) => m.policy?.state !== 'disabled');
    const price = (m: ModelInfo): number =>
      m.billing?.multiplier ?? m.billing?.tokenPrices?.inputPrice ?? Number.POSITIVE_INFINITY;
    return [...models].sort((a, b) => price(a) - price(b))[0];
  }

  /**
   * Earlier Copilot CLI/SDK sessions whose working directory is `cwd`, newest first (no inference, no credits).
   * Sessions open in this app and empty ones (the runtime does not list sessions without events) are left out.
   */
  async listPreviousSessions(cwd: string, excludeIds: ReadonlySet<string> = new Set()): Promise<PreviousSession[]> {
    const client = await this.getClient();
    const metas = await client.listSessions();
    return previousSessionsFor(metas, cwd, new Set([...excludeIds, ...this.sessions.keys()]), process.platform, fs.realpathSync);
  }

  /**
   * Spec 006 FR-028: permanently removes one earlier session through the SDK (`session.delete`), never by touching files. Refuses a
   * malformed id and a session that is open in this adapter; an error from the runtime (for example "not found") is passed on.
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!sessionIdOk(this.id, sessionId)) throw new Error('That is not a session id.');
    if (this.sessions.has(sessionId)) throw new Error('That session is open. End it first.');
    await (await this.getClient()).deleteSession(sessionId);
  }

  /** Persisted messages and tool calls of a live (e.g. just resumed) session, capped, for replay in the chat panel. */
  async history(sessionId: string): Promise<HistoryResult> {
    return eventsToHistory(await this.mustGet(sessionId).session.getEvents());
  }

  async start(options: StartOptions): Promise<string> {
    const { cwd, folders } = resolveWorkspaceCwd(options.workspace);
    const client = await this.getClient();
    let sid = options.resumeSessionId ?? options.sessionId ?? '';
    const broker = new PermissionBroker({
      roots: [cwd, ...folders],
      mode: startModeOf(options),
      emit: (e: BrokerEvent) => {
        switch (e.type) {
          case 'pending':
            return this.emit(sid, { type: 'status', status: 'needs-permission', intent: `Waiting for permission: ${e.permission.summary}`, permission: e.permission });
          case 'denied-policy':
            return this.emit(sid, { type: 'status', status: 'needs-permission', intent: `Denied (read-only mode): ${e.permission.summary}`, permission: e.permission });
          case 'resolved':
            this.emit(sid, { type: 'permission', permission: e.permission });
            // Back to work unless the session is being stopped (then 'stopped' follows).
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

    const onPermissionRequest = async (req: PermissionRequest): Promise<PermissionRequestResult> =>
      broker.request(req as unknown as PermissionLike);

    // spec 002 FR-058: Copilot's `ask_user` (legacy form) as a question card; allowed in every mode (a question is not an action)
    const onUserInputRequest = async (req: { question?: unknown; choices?: unknown; allowFreeform?: unknown }): Promise<{ answer: string; wasFreeform: boolean }> => {
      const live = this.sessions.get(sid);
      const asked = parseQuestions({ questions: [{ question: req.question, options: (Array.isArray(req.choices) ? req.choices : []).map((c) => ({ label: c })), multiSelect: false }] });
      if (!live || !asked.length) return { answer: SKIPPED_ANSWER, wasFreeform: true };
      const requestId = randomUUID();
      live.questions ??= new Map();
      const answer = await new Promise<string | null>((resolve) => {
        live.questions!.set(requestId, { choices: asked[0].options.map((o) => o.label), resolve });
        this.emit(sid, { type: 'question', phase: 'asked', requestId, questions: asked });
        this.emit(sid, { type: 'status', status: 'needs-permission', intent: 'Waiting for your answer' });
      });
      live.questions.delete(requestId);
      if (answer === null) {
        this.emit(sid, { type: 'question', phase: 'cancelled', requestId });
        return { answer: SKIPPED_ANSWER, wasFreeform: true };
      }
      this.emit(sid, { type: 'question', phase: 'answered', requestId, answers: { [asked[0].question]: answer } });
      this.emit(sid, { type: 'status', status: 'working', intent: 'Answered' });
      return { answer, wasFreeform: !asked[0].options.some((o) => o.label === answer) };
    };

    // spec 012 FR-151: an MCP server's elicitation (a form, or a URL flow) in the question card; like a question, every mode
    const onElicitationRequest = async (ctx: { message?: unknown; requestedSchema?: unknown; mode?: unknown; url?: unknown; elicitationSource?: unknown }): Promise<ElicitAnswer> => {
      const live = this.sessions.get(sid);
      if (!live) return { action: 'cancel' };
      live.elicitations ??= new Map();
      return runElicitation((b) => this.emit(sid, b), live.elicitations, randomUUID(), { message: ctx.message, schema: ctx.requestedSchema, mode: ctx.mode, url: ctx.url, source: ctx.elicitationSource }, (m) => this.debug?.(m));
    };

    const config = {
      workingDirectory: cwd,
      // spec 006 FR-019: a workspace's other folders (the SDK asks for them again on resume, which this config does)
      ...(folders.some((f) => f !== cwd) ? { additionalDirectories: folders.filter((f) => f !== cwd) } : {}),
      streaming: true,
      // Model, effort, tier and the `auto` routing (spec 030 FR-013): filled in below once it is known whether this is a create or a resume.
      // MCP (spec 019). The runtime also loads ~/.copilot/mcp-config.json and the built-in GitHub server on its own;
      // `disabledMcpServers` switches those off by name. Values (env, headers) are secrets: never logged, only names.
      ...(options.mcpServers && Object.keys(options.mcpServers).length ? { mcpServers: options.mcpServers as unknown as Record<string, MCPServerConfig> } : {}),
      ...(options.disabledMcpServers?.length ? { disabledMcpServers: options.disabledMcpServers } : {}),
      // AI-credit cap (spec 011): the SDK calls it "AI Credits"; the app treats 1 AIU = 1 credit. `sessionLimits` is @experimental in SDK 1.0.22.
      ...(options.maxAiCredits && options.maxAiCredits > 0 && Number.isFinite(options.maxAiCredits) ? { sessionLimits: { maxAiCredits: options.maxAiCredits } } : {}),
      onPermissionRequest,
      onUserInputRequest,
      onElicitationRequest,
      // spec 043 FR-002: custom agents from explicit folders only (no config discovery, so no repository skills)
      agentDirectories: agentDirsFor([cwd, ...folders]),
    };
    this.debug?.(`mcp: servers=[${Object.keys(options.mcpServers ?? {}).join(',')}] disabled=[${(options.disabledMcpServers ?? []).join(',')}]`);
    let session: CopilotSession;
    // The saved model, effort and tier go on create AND resume, so a model the user switched to survives an ended session or a restart.
    // `modelConfig` adds the `auto` routing preference only to a NEW session (on resume it would override the session's own).
    const resumed = (): Record<string, unknown> => ({ ...config, ...modelConfig(options, true) });
    const created = (): Record<string, unknown> => ({ ...config, ...modelConfig(options, false) });
    let resumedExisting = false; // its title is asked once (issue #126): the runtime may not send it again
    if (options.resumeSessionId) {
      session = await client.resumeSession(options.resumeSessionId, resumed() as unknown as ResumeSessionConfig);
      resumedExisting = true;
    } else if (options.sessionId) {
      // An agent that was ended (or restored from the saved folder list) keeps its id: resume it when it has
      // history on disk, otherwise start a fresh session under that same id.
      const known = await client.getSessionMetadata(options.sessionId).catch(() => undefined);
      resumedExisting = !!known;
      session = known
        ? await client.resumeSession(options.sessionId, resumed() as unknown as ResumeSessionConfig)
        : await client.createSession({ ...created(), sessionId: options.sessionId } as unknown as SessionConfig);
    } else session = await client.createSession(created() as unknown as SessionConfig);
    sid = session.sessionId;
    const onSessionEvent = (ev: SessionEvent): void => {
      // Remember an open limit request so Stop / End can answer it (the runtime waits for a consumer once interest is registered).
      const live = this.sessions.get(sid);
      if (live && ev.type === 'session_limits_exhausted.requested') live.limitRequestId = ev.data.requestId;
      else if (live && ev.type === 'session_limits_exhausted.completed' && live.limitRequestId === ev.data.requestId) live.limitRequestId = undefined;
      if (live && ev.type === 'session.title_changed' && !ev.agentId) live.titled = true;
      this.map(sid, ev);
      if (live && ev.type === 'session.idle') this.askTitle(sid);
    };
    const unsubscribe = session.on(onSessionEvent);
    // FR-158: a reconnect resumes with the same handlers but no model fields, so the session keeps the model the runtime stored
    // (it may have been switched since this start).
    this.sessions.set(sid, { session, unsubscribe, cwd, folders: [cwd, ...folders], broker, resumeConfig: () => ({ ...config }), onSessionEvent });
    // spec 043 FR-002: a resumed session keeps its selected agent (stored by the runtime): show it
    if (resumedExisting)
      void Promise.resolve()
        .then(() => session.rpc.agent.getCurrent())
        .then((r: { agent?: unknown } | undefined) => {
          const p = r?.agent ? profileOf(r.agent as Parameters<typeof profileOf>[0], [cwd, ...folders]) : undefined;
          if (p && this.sessions.has(sid)) this.emit(sid, { type: 'agentProfile', profile: p });
        })
        .catch(() => undefined);
    if (resumedExisting) this.askTitle(sid);
    // Without a registered consumer the runtime does not ask the user when the cap is reached (SDK docs of `registerInterest`).
    void session.rpc.eventLog.registerInterest({ eventType: 'session_limits_exhausted.requested' }).catch((err: unknown) => this.debug?.(`limit interest not registered: ${err instanceof Error ? err.message : String(err)}`));
    if (!options.quiet) this.emit(sid, { type: 'status', status: 'idle', intent: `Ready in ${cwd}` });
    return sid;
  }

  async send(sessionId: string, message: AgentMessage): Promise<void> {
    await this.refreshing?.catch(() => undefined); // FR-158: send on the reconnected session
    const live = this.mustGet(sessionId);
    // Files the user attached are theirs to share: the runtime may read them even outside the folders (spec 003 FR-023).
    if (message.attachments?.length) live.broker.allowReadPaths(message.attachments.map((a) => a.path));
    this.emit(sessionId, { type: 'status', status: 'working', intent: 'Thinking' });
    // Text files go as `file` attachments (the runtime reads them from disk). Images go as
    // base64 `blob` attachments with a mime type, the SDK's documented way to send an image.
    const attachments = (message.attachments ?? []).map((a) => {
      const name = path.basename(a.path);
      const mime = IMAGE_MIME[path.extname(a.path).toLowerCase()];
      if (a.kind === 'image' && mime) {
        return { type: 'blob' as const, data: fs.readFileSync(a.path).toString('base64'), mimeType: mime, displayName: name };
      }
      return { type: 'file' as const, path: a.path, displayName: name };
    });
    this.debug?.(
      `send ${sessionId.slice(0, 8)} prompt=${JSON.stringify(message.text)} attachments=${JSON.stringify(
        attachments.map((a) => (a.type === 'blob' ? { type: a.type, mimeType: a.mimeType, displayName: a.displayName, base64Chars: a.data.length } : a)),
      )}`,
    );
    await live.session.send({ prompt: message.text, attachments: attachments.length ? attachments : undefined });
  }

  /**
   * Stop = interrupt the current turn only. The session stays open and the agent returns to Ready, so the next
   * message just works. Pending permission requests are denied cleanly; "Approve for this session" grants stay.
   */
  /** spec 002 FR-058: the user's answer to an `ask_user` question; null = skipped. */
  answerQuestion(sessionId: string, requestId: string, answers: Record<string, string> | null): void {
    const q = this.sessions.get(sessionId)?.questions?.get(requestId);
    if (!q) return;
    const v = answers ? Object.values(answers).find((x) => typeof x === 'string' && x.trim()) : undefined;
    q.resolve(v ? v.replace(/\s+/g, ' ').trim().slice(0, 500) : null);
  }

  /** spec 012 FR-151: the user's answer to an MCP elicitation (main checked it against the fields). */
  answerElicitation(sessionId: string, requestId: string, answer: ElicitAnswer): void {
    answerElicitation(this.sessions.get(sessionId)?.elicitations, requestId, answer);
  }

  private cancelQuestions(live: Live): void {
    for (const q of [...(live.questions?.values() ?? [])]) q.resolve(null);
    cancelElicitations(live.elicitations);
  }

  /** spec 043 FR-002: the session's selectable custom agents (`rpc.agent.list`, @experimental). */
  async listAgentProfiles(sessionId: string): Promise<AgentProfile[]> {
    const live = this.sessions.get(sessionId);
    if (!live) return [];
    const r = (await live.session.rpc.agent.list()) as { agents?: unknown[] } | undefined;
    return (r?.agents ?? []).map((a) => profileOf(a as Parameters<typeof profileOf>[0], live.folders ?? [live.cwd])).filter((p): p is AgentProfile => !!p);
  }

  /** spec 043 FR-002: select a custom agent for the next turns, or the default agent (null). The runtime confirms with an event. */
  async selectAgentProfile(sessionId: string, id: string | null): Promise<AgentProfile | null> {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error('The session is not running.');
    if (id === null) {
      await live.session.rpc.agent.deselect();
      this.emit(sessionId, { type: 'agentProfile', profile: null });
      return null;
    }
    const p = (await this.listAgentProfiles(sessionId)).find((x) => x.id === id);
    if (!p) throw new Error('That agent is not available in this session.');
    await live.session.rpc.agent.select({ name: id });
    this.emit(sessionId, { type: 'agentProfile', profile: p });
    return p;
  }

  async interrupt(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    live.broker.denyPending();
    this.cancelQuestions(live);
    await this.cancelLimit(live);
    try {
      await live.session.abort();
    } catch {
      /* nothing running */
    }
    this.emit(sessionId, { type: 'status', status: 'idle', intent: 'Aborted' });
  }

  /** End the session: frees the runtime session. Its history stays on disk and sending again resumes it. */
  async stop(sessionId: string): Promise<void> {
    await this.refreshing?.catch(() => undefined);
    const live = this.sessions.get(sessionId);
    if (!live) return;
    await this.cancelLimit(live);
    live.broker.stop(); // pending permissions are denied cleanly (renderer clears Approve/Deny) and grants are dropped
    this.cancelQuestions(live);
    try {
      await live.session.abort();
    } catch {
      /* nothing running */
    }
    live.unsubscribe();
    await live.session.disconnect();
    this.sessions.delete(sessionId);
    this.mappers.delete(sessionId);
    this.emit(sessionId, { type: 'status', status: 'stopped' });
  }

  /**
   * Change the permission mode of a live session without restarting it: the broker reads the mode on every request.
   * Optionally clears the session grants, approves what is pending now (Allow all) or denies it (Read-only).
   */
  setPermMode(sessionId: string, mode: PermissionMode, opts: { clearGrants?: boolean; approvePending?: boolean } = {}): { pending: number } {
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

  /** Change the credit cap of a running session; `null` removes it. The SDK confirms with a `session.session_limits_changed` event. */
  /**
   * The session's name from the runtime (`rpc.name.get`, @experimental; no prompt, no credits), asked at most once per session:
   * after a resume, or when a turn ended without a `session.title_changed`. Failures are ignored and never retried (issue #126).
   */
  private askTitle(sid: string): void {
    const live = this.sessions.get(sid);
    if (!live || live.titled || live.askedTitle) return;
    live.askedTitle = true;
    void live.session.rpc.name
      .get()
      .then((r: { name?: string | null } | undefined) => {
        const title = cleanSessionTitle(r?.name);
        if (!title || live.titled || this.sessions.get(sid) !== live) return;
        live.titled = true;
        this.emit(sid, { type: 'title', title });
      })
      .catch(() => undefined);
  }

  /**
   * Switch the model of a live session (spec 030 FR-003..FR-009, SDK `rpc.model.switchTo`, @experimental).
   * Built from the SDK 1.0.22 types and docs only, never run on a real account (T041..T046 are Phase 3, they cost credits).
   * Sent: model, effort, tier, `requireAvailable`, `deferIfModelChangeQueued`, `source: 'model_picker'`, `runCompactionPreflight`.
   * NEVER sent: `repoScope`, `modelChangeScope`, `pickerPersistence` (they write Copilot's own settings) and `compactionDecision`
   * (its values are unknown). To "compact and switch" the context is compacted first with `history.compact` (trigger `model_switch`),
   * then the switch is asked again; if it still needs confirmation it is `rejected`, never looped.
   */
  async setModel(sessionId: string, request: ModelSwitchRequest): Promise<ModelSwitchResult> {
    const live = this.mustGet(sessionId);
    const model = request.model;
    if (request.confirm?.compaction === 'decline') return { status: 'rejected', model, message: 'The model was not changed.' };
    const mapper = this.mapperFor(sessionId);
    const tier = sdkTier(request.contextTier);
    const params = {
      modelId: model,
      ...(request.effort !== undefined ? { reasoningEffort: request.effort } : {}),
      ...(tier ? { contextTier: tier } : {}),
      // `auto` keeps the app's cheapest routing (same as a new `auto` session); the runtime rejects an autoTier for any other model.
      ...(model === 'auto' ? { autoTier: 'efficiency' as const } : {}),
      requireAvailable: true,
      deferIfModelChangeQueued: true,
      runCompactionPreflight: true,
      source: 'model_picker' as const,
    };
    try {
      if (request.confirm?.compaction === 'accept') {
        // Compacting needs an idle session: never while a turn runs (the runtime would queue or reject it, behaviour unverified).
        if (await this.processing(live)) return { status: 'rejected', model, message: 'Compaction needs the agent to be idle. Stop the turn or wait, then switch again.' };
        const done = compactResultFrom(await live.session.rpc.history.compact({ trigger: 'model_switch' }));
        if (!done.success) return { status: 'rejected', model, message: done.message ?? 'The conversation could not be compacted, so the model was not changed.' };
      }
      mapper.expectUserModel(model);
      const out = switchResultFrom((await live.session.rpc.model.switchTo(params)) as RawSwitchResult, model);
      if (out.status === 'needs-confirmation' && request.confirm?.compaction === 'accept') {
        mapper.expectUserModel(undefined);
        return { status: 'rejected', model, message: 'The conversation is still larger than the new model\'s window after compacting. Pick a model with a larger window or start a new session.' };
      }
      if (out.status === 'needs-confirmation' || out.status === 'rejected') mapper.expectUserModel(undefined);
      return out;
    } catch (err) {
      mapper.expectUserModel(undefined);
      return { status: 'rejected', model, message: runtimeMessage(err, 'The runtime refused the switch.') };
    }
  }

  /** Remove a switch the runtime queued during a turn (`rpc.queue.removeAt`). What Stop does to a queued switch is unverified (T042). */
  async cancelQueuedModel(sessionId: string, queueId: string): Promise<void> {
    const live = this.mustGet(sessionId);
    const r = await live.session.rpc.queue.removeAt({ id: queueId });
    this.mapperFor(sessionId).expectUserModel(undefined);
    if (!r?.removed) throw new Error('Nothing was queued any more: the switch has already been applied or was cancelled.');
  }

  /** Manual compaction (`rpc.history.compact`, one model call = credits). Refused while the session works. `focus` is never logged. */
  async compact(sessionId: string, focus?: string): Promise<CompactResult> {
    const live = this.mustGet(sessionId);
    try {
      if (await this.processing(live)) return { success: false, message: 'The agent is working. Compact when it is idle.' };
      return compactResultFrom(await live.session.rpc.history.compact({ trigger: 'manual', ...(focus ? { customInstructions: focus } : {}) }));
    } catch (err) {
      return { success: false, message: runtimeMessage(err, 'The runtime refused to compact.') };
    }
  }

  /** Spec 030 FR-034: the runtime's own hand-off summary (`rpc.history.summarizeForHandoff`, experimental); the conversation is not changed. */
  async handoffSummary(sessionId: string): Promise<HandoffResult> {
    const live = this.mustGet(sessionId);
    const r = (await live.session.rpc.history.summarizeForHandoff()) as { summary?: unknown } | undefined;
    return { summary: cleanSummary(r?.summary) };
  }

  /**
   * Spec 040 FR-015: one prompt (the AI theme maker) on a throw-away session of the shared runtime (no second process): see `oneShotConfig`.
   * Every permission request is denied; after `ONE_SHOT_TIMEOUT_MS` the turn is aborted. The session is disconnected and deleted from disk in
   * a `finally`, also on an error or a timeout, and its temp folder removed. Returns the last top-level assistant message and the AI credits
   * the runtime reported for the session (`assistant.usage`), if any. The prompt and the reply are never logged.
   */
  async generateText(prompt: string, opts: GenerateTextOptions = {}): Promise<GenerateTextResult> {
    const client = await this.getClient();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-gen-'));
    let session: CopilotSession | undefined;
    let unsubscribe: () => void = () => undefined;
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    try {
      let text = '';
      let nano = 0;
      let finish: (err?: Error) => void = () => undefined;
      const done = new Promise<void>((resolve, reject) => (finish = (err) => (err ? reject(err) : resolve())));
      done.catch(() => undefined); // an error before `send` returns is still raised below, never unhandled
      const config = {
        ...oneShotConfig(dir, opts.disabledMcpServers ?? []),
        onPermissionRequest: async (): Promise<PermissionRequestResult> => ({ kind: 'reject', feedback: 'Agent Durbar allows no tools here.' }) as PermissionRequestResult,
      };
      session = await client.createSession(config as unknown as SessionConfig);
      unsubscribe = session.on((ev: SessionEvent) => {
        const e = ev as unknown as { type: string; agentId?: string | null; data?: Record<string, unknown> };
        const d = e.data ?? {};
        if (e.type === 'assistant.message' && !e.agentId && !d.parentToolCallId && typeof d.content === 'string' && d.content.trim()) text = d.content;
        else if (e.type === 'assistant.usage') {
          const n = Number((d.copilotUsage as { totalNanoAiu?: unknown } | undefined)?.totalNanoAiu);
          if (Number.isFinite(n) && n > 0) nano += n;
        } else if (e.type === 'session.idle' && !e.agentId) finish();
        else if (e.type === 'session.error' && !e.agentId) finish(new Error(`Copilot could not answer${typeof d.errorType === 'string' ? ` (${d.errorType.slice(0, 60)})` : ''}.`));
      });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error('Copilot gave no answer in time.'));
        }, this.oneShotTimeoutMs);
      });
      await Promise.race([session.send({ prompt }).then(() => done), timeout]);
      if (!text) throw new Error('Copilot gave no answer.');
      return { text, ...(nano > 0 ? { nanoAiu: nano } : {}) };
    } finally {
      clearTimeout(timer);
      unsubscribe();
      if (session) {
        const id = session.sessionId;
        if (timedOut) await session.abort().catch(() => undefined);
        await session.disconnect().catch(() => undefined);
        await client.deleteSession(id).catch(() => undefined); // nothing kept (a session with no turn may not be on disk yet)
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Spec 054 FR-002: remote control from github.com and GitHub Mobile (`rpc.remote.enable({ mode: 'on' })` / `disable()`, @experimental).
   * Feature-detected: an SDK without `rpc.remote` answers `ok: false`. Never called by Durbar on its own; `remoteSession` and the client's
   * `enableRemoteSessions` are never set (spec 054 Q1). Only an allowed github.com URL leaves the adapter; nothing is logged.
   */
  async setRemote(sessionId: string, on: boolean): Promise<RemoteState> {
    const live = this.sessions.get(sessionId);
    if (!live) return { ok: false, error: 'This session is not running.' };
    const rpc = (live.session as unknown as { rpc?: Record<string, unknown> }).rpc;
    const remote = rpc?.remote as { enable?: (p: { mode: 'on' }) => Promise<unknown>; disable?: () => Promise<unknown> } | undefined;
    const fn = on ? remote?.enable : remote?.disable;
    if (!remote || typeof fn !== 'function') return { ok: false, error: 'This Copilot version cannot be controlled from GitHub.' };
    try {
      if (!on) {
        await remote.disable!();
        return { ok: true, on: false };
      }
      const r = ((await remote.enable!({ mode: 'on' })) ?? {}) as { url?: unknown; remoteSteerable?: unknown; started?: unknown };
      // spec 054 T020 (real, 2026-10-20): in a plain folder and in a `git init` folder with no remote the runtime answers
      // `{ started: false, remoteSteerable: false }` with no error and no URL; that is not "on"
      if (r.started === false) {
        await remote.disable!().catch(() => undefined);
        return { ok: false, error: REMOTE_NOT_STARTED };
      }
      const out: RemoteState = { ok: true, on: true, steerable: r.remoteSteerable === true };
      if (allowedRemoteUrl(r.url)) out.url = r.url;
      const vis = rpc?.visibility as { get?: () => Promise<unknown> } | undefined;
      if (vis && typeof vis.get === 'function') {
        try {
          const v = ((await vis.get()) ?? {}) as { synced?: unknown; status?: unknown; shareUrl?: unknown };
          if (isRemoteVisibility(v.status)) out.visibility = v.status;
          if (!out.url && allowedRemoteUrl(v.shareUrl)) out.url = v.shareUrl;
        } catch {
          // the visibility stays unknown; remote control itself is on
        }
      }
      return out;
    } catch (err) {
      return { ok: false, error: cleanRemoteError(err) };
    }
  }

  /** True while a turn or a background continuation runs. When the runtime cannot say, assume it does (the safe side: nothing is compacted mid-turn). */
  private async processing(live: Live): Promise<boolean> {
    try {
      return (await live.session.rpc.metadata.isProcessing()).processing !== false;
    } catch {
      return true;
    }
  }

  async setCap(sessionId: string, credits: number | null): Promise<void> {
    const live = this.mustGet(sessionId);
    if (credits !== null && !(credits > 0 && Number.isFinite(credits))) throw new Error('Invalid credit cap.');
    await live.session.rpc.options.update({ sessionLimits: credits === null ? null : { maxAiCredits: credits } });
    live.cap = credits;
  }

  /** Answer the runtime's "limit reached" question (add / set / unset / cancel). */
  async resolveLimit(sessionId: string, requestId: string, action: LimitAction): Promise<void> {
    const live = this.mustGet(sessionId);
    const response =
      action.kind === 'add' ? { action: 'add' as const, additionalAiCredits: action.credits }
      : action.kind === 'set' ? { action: 'set' as const, maxAiCredits: action.credits }
      : { action: action.kind };
    await live.session.rpc.ui.handlePendingSessionLimitsExhausted({ requestId, response });
    if (live.limitRequestId === requestId) live.limitRequestId = undefined;
  }

  private async cancelLimit(live: Live): Promise<void> {
    const id = live.limitRequestId;
    if (!id) return;
    live.limitRequestId = undefined;
    try {
      await live.session.rpc.ui.handlePendingSessionLimitsExhausted({ requestId: id, response: { action: 'cancel' } });
    } catch {
      /* already answered elsewhere */
    }
  }

  /** Switch one MCP server on or off in a running session (the runtime does not write this to ~/.copilot). */
  async setMcpEnabled(sessionId: string, name: string, enabled: boolean): Promise<void> {
    const live = this.mustGet(sessionId);
    if (enabled) await live.session.rpc.mcp.enable({ serverName: name });
    else await live.session.rpc.mcp.disable({ serverName: name });
    (live.mcpToggles ??= new Map()).set(name, enabled);
  }

  resolvePermission(sessionId: string, requestId: string, approve: boolean, remember = false, broad = false): void {
    this.sessions.get(sessionId)?.broker.resolve(requestId, approve, remember, broad);
  }

  revokeGrant(sessionId: string, key: string): void {
    this.sessions.get(sessionId)?.broker.revoke(key);
  }

  /** Stop all sessions and the shared runtime. */
  async dispose(): Promise<void> {
    await this.refreshing?.catch(() => undefined);
    for (const id of [...this.sessions.keys()]) await this.stop(id);
    await this.client?.stop();
    this.client = undefined;
    this.starting = undefined;
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
    const event = { ...markAuthError(body), sessionId, timestamp: Date.now() } as AgentEvent; // FR-157: a sign-in failure is marked
    for (const l of this.listeners) l(event);
  }

  /** SDK SessionEvent -> normalized event(s): see map.ts (pure, unit-tested with recorded fixtures). */
  private mapperFor(sid: string): EventMapper {
    let m = this.mappers.get(sid);
    if (!m) {
      m = new EventMapper((body) => this.emit(sid, body));
      this.mappers.set(sid, m);
    }
    return m;
  }

  private map(sid: string, ev: SessionEvent): void {
    this.mapperFor(sid).map(ev as unknown as RawEvent);
  }
}

export const COPILOT_DESCRIPTOR: AdapterDescriptor = {
  id: COPILOT_ID,
  displayName: COPILOT_NAME,
  capabilities: COPILOT_CAPABILITIES,
  create: () => new CopilotAdapter(),
};
