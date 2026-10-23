import { copilotHooksJson } from '../shared/foldersetup';
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
  WriteGuard,
} from './types';
import type { AdapterDescriptor } from './capabilities';
import { EventMapper } from './map';
import type { EventBody, RawEvent } from './map';
import { compactResultFrom, modelConfig, modelOptionFrom, runtimeMessage, sdkTier, switchResultFrom } from './copilotmodel';
import type { ModelOption, RawModelInfo, RawSwitchResult } from './copilotmodel';
import { PermissionBroker, isInsideRoots, mcpToolBlockList, startModeOf } from './permissions';
import type { BrokerEvent, PermissionLike } from './permissions';
import { resolveWorkspaceCwd } from './workspace';
import type { AgentProfile, PlanAnswer, SlashCommand, SlashExpansion } from './types';
import type { McpSignInResult, McpToolInfo } from './types';
import { normMcpTools } from './mcptools';
import { copilotHomeDir, copilotSlashPlaces, SlashCache, vscodeUserPromptDirs } from './slashcommands';
import type { SlashPlace } from './slashcommands';
import { cleanPlanText } from './plan';
import { copilotQuotaReset } from './usagelimit';
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
import { copilotAccount, copilotPlanLabel } from './accounts';
import type { AccountIdentity, AccountInfoOptions } from '../shared/account';
import { ACCOUNT_TEMP_PREFIXES } from '../shared/account';
import { sweepStaleTempDirs } from '../shared/attachments';

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
  /** Spec 059 FR-011: the name Durbar stored with `name.set`. While it is set, a `session.title_changed` with any other title (an auto title, also after a compaction) is not passed on; the same title is a confirmation. Not cleared on idle. */
  userTitle?: string;
  askedTitle?: boolean;
  /** `ask_user` questions waiting for the user (spec 002 FR-058): request id -> waiter. */
  questions?: Map<string, { choices: string[]; resolve: (answer: string | null) => void }>;
  /** Spec 066: plans waiting for the user (request id -> answer); the runtime is in plan mode (set by a plan-first send). */
  plans?: Map<string, (answer: PlanAnswer) => void>;
  planMode?: boolean;
  /** MCP elicitations waiting for the user (spec 012 FR-151): request id -> waiter. */
  elicitations?: Map<string, ElicitWaiter>;
  /** The session's folders (spec 043: a profile file inside one is the repository's). */
  folders?: string[];
  /** Spec 012 FR-158: what a reconnect after a sign-in needs to resume this session on a new client with the same handlers and broker. */
  resumeConfig?: () => Record<string, unknown>;
  onSessionEvent?: (ev: SessionEvent) => void;
  /** Spec 061 FR-004: the private folder with the accepted folder hooks (removed when the session ends). */
  hookDir?: string;
  /** Changes made while the session ran, put back after a reconnect (FR-158): the credit cap, and MCP servers switched on or off. */
  cap?: number | null;
  mcpToggles?: Map<string, boolean>;
  /**
   * Spec 011 FR-070..FR-073: the runtime does not stop a session at its cap (real 2026-10-20), so Durbar does. The cap in force
   * (credits; null = none), the used nano-AIU (the runtime's last `usage_checkpoint` total plus the calls reported since), whether a
   * turn runs, and a Durbar-raised limit waiting for the user with the message it held back.
   */
  capNow?: number | null;
  usedCheckpointNano?: number;
  usedSinceNano?: number;
  turnOpen?: boolean;
  localLimit?: { requestId: string; held?: AgentMessage };
}

/** FR-070: credits a live session has used, as far as the runtime reported them. */
const usedCredits = (live: Live): number => ((live.usedCheckpointNano ?? 0) + (live.usedSinceNano ?? 0)) / 1e9;
/** FR-071: a cap is set and what was used reached it. */
const overCap = (live: Live): boolean => typeof live.capNow === 'number' && live.capNow > 0 && usedCredits(live) >= live.capNow;
const nanoOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** spec 043 FR-002: the folders Copilot reads agent files from: each session folder's `.github/agents` and the user's `~/.copilot/agents`. */
export function agentDirsFor(folders: readonly string[], home = os.homedir()): string[] {
  return [...new Set(folders)].map((f) => path.join(f, '.github', 'agents')).concat(path.join(home, '.copilot', 'agents'));
}

/** The part of the SDK's `session.rpc.agent` that FR-041 uses; `reload` is @experimental and may be missing in another SDK. */
export type AgentRpc = { reload?: () => Promise<unknown> } | undefined;
/** spec 043 FR-041: true when the runtime read its agent files again; false (never a throw) when it cannot. */
export async function reloadAgentsRpc(rpc: AgentRpc): Promise<boolean> {
  if (!rpc || typeof rpc.reload !== 'function') return false;
  try {
    await rpc.reload();
    return true;
  } catch {
    return false;
  }
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
  mcpStart: 'next-message', // spec 058 FR-010 (real 2026-10-21, runtime 1.0.22: the servers start with the first message, not at create or resume)
  mcpToggleApplies: 'live', // spec 019 (real: mcp.enable/disable)
  mcpToolFilter: true, // spec 069 FR-062: session excludedTools (read: SDK types; not run on a real account)
  mcpTools: true, // spec 069 FR-031: rpc.mcp.listTools (@experimental; read: SDK 1.0.22 rpc.d.ts; not run on a real account)
  mcpRestart: true, // spec 058 FR-012: rpc.mcp.restartServer (@experimental; real 2026-10-21, runtime 1.0.22), else disable then enable (fallback read: only)
  mcpSignInAgain: true, // spec 058 FR-164: oauth.login forceReauth ("clears any cached OAuth token for the server and runs a full new authorization", read: SDK 1.0.22 rpc.d.ts; not run on a real account)
  mcpSignIn: true, // spec 058 FR-064: rpc.mcp.oauth.login (@experimental; read: SDK 1.0.22 rpc.d.ts; real: worked once, macOS 2026-10-23, one server; the rest in T105)
  mcpSignInSteps: 'If Sign in is not available, sign in from the Copilot CLI: run `copilot`, type `/mcp auth {name}` and finish in your browser. Then use Restart session with these servers. This may not carry over to this session (seen on 2026-10-23).', // FR-068
  handoff: true, // spec 030 FR-034: rpc.history.summarizeForHandoff (cost unverified)
  modelSwitch: Object.freeze({ verified: true, contextTier: true }), // spec 030 Phase 3 (real 2026-10-20, Copilot Pro): switch, effort, long tier, confirmation and compact-and-switch (T041, T044, T045)
  planMode: true, // spec 066 FR-003: mode.set plan + onExitPlanModeRequest (@experimental)
  remote: true, // spec 054 FR-002: rpc.remote.enable/disable (@experimental; real 2026-10-20: `started: false` outside a GitHub repository, never seen started)
  renameSession: 'any', // spec 059 FR-007: rpc.name.set (@experimental; real 2026-10-20 on a live session, 0 credits); a stored session through a prompt-free resume: real 2026-10-21 (T050a, 0 credits)
  remoteService: Object.freeze({ name: 'GitHub', host: 'github.com', mobile: 'GitHub Mobile' }), // spec 054 FR-060
  deleteSession: true, // spec 006 FR-028: CopilotClient.deleteSession (read: SDK 1.0.22 client.d.ts; never run on a real session)
  oneShot: true, // spec 040 FR-015: a throw-away SDK session with no tools and no MCP, deleted after (real 2026-10-20: no tool ran, nothing left on disk)
});

/** Spec 059 FR-007: Copilot's own name rule is stricter than Durbar's: no double quotes, at most 100 UTF-16 units, no control characters (SDK `types.d.ts`, `SessionConfig.name`). */
export function copilotNameError(name: string): string | undefined {
  if (!name || name !== name.trim()) return 'Copilot needs a name without leading or trailing spaces.';
  if (name.length > 100) return 'Copilot names are at most 100 characters.';
  if (name.includes('"')) return 'Copilot does not accept double quotes in a name.';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return 'Copilot does not accept control characters in a name.';
  return undefined;
}

/**
 * Spec 059 FR-007: the config of the prompt-free resume that renames a stored session: every permission request is denied (none can
 * arrive, nothing is sent), no MCP server, skill, hook or git operation is started, remote control stays off, no tool is offered.
 */
export function renameResumeConfig(workingDirectory: string): Record<string, unknown> {
  return {
    // the session's own folder (from its stored metadata), so it is not resumed in the runtime's default folder; nothing else about the session changes
    workingDirectory,
    suppressResumeEvent: true, // no `session.resume` event is written
    allowTranscriptRecovery: false, // a damaged transcript is refused, never repaired by a rename
    streaming: false,
    availableTools: [],
    mcpServers: {},
    enableConfigDiscovery: false,
    enableSkills: false,
    skipCustomInstructions: true,
    enableFileHooks: false,
    enableHostGitOperations: false,
    remoteSession: 'off',
    onPermissionRequest: async (): Promise<PermissionRequestResult> => ({ kind: 'reject', feedback: 'Agent Durbar allows no tools here.' }) as PermissionRequestResult,
  };
}

/** Spec 054 FR-063 (real, 2026-10-20): not started in a plain folder, a `git init` folder and a private GitHub repository alike, on Copilot Free. */
/** Spec 012 FR-156 delta: the GitHub account is signed in but has no Copilot access (Copilot not enabled for it). */
export const NO_COPILOT_ACCESS = /not authorized to use this Copilot feature/i;
export const NO_COPILOT_ACCESS_DETAIL = 'Signed in to GitHub, but this account has no Copilot access yet: turn on Copilot for it (Copilot Free is enough) at github.com/settings/copilot, then choose Check again.';
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? ''));

/** Spec 061: the private folder that holds a session's accepted folder hooks (removed when the session ends). */
export const HOOK_DIR_PREFIX = 'durbar-folder-hooks-';
let hookDirsSwept = false;
/** Review nit #424: once per run, remove copies left by a crash (older than a day, so another running Durbar's are never touched). */
export function sweepOldHookDirs(now = Date.now(), dir = os.tmpdir()): void {
  if (hookDirsSwept) return;
  hookDirsSwept = true;
  try {
    for (const n of fs.readdirSync(dir)) {
      if (!n.startsWith(HOOK_DIR_PREFIX)) continue;
      const p = path.join(dir, n);
      try { const st = fs.lstatSync(p); if (st.isDirectory() && !st.isSymbolicLink() && now - st.mtimeMs > 24 * 3600_000) fs.rmSync(p, { recursive: true, force: true }); } catch { /* gone or not ours */ }
    }
  } catch { /* the temp folder cannot be listed: nothing to sweep */ }
}

export const REMOTE_NOT_STARTED = 'Copilot did not start remote control and gave no reason. It needs a paid Copilot plan: on Copilot Free it never started in our checks, on Copilot Pro it did.';

/** Spec 040 FR-015: how long one `generateText` may take before it is aborted (the same 3 minutes as Claude and Codex). */
export const ONE_SHOT_TIMEOUT_MS = 180_000;

/** Spec 058 FR-163: what `listMcpTools` says for a server that is not connected (nothing is asked of the runtime). */
export const MCP_NOT_CONNECTED = 'This server is not connected. Restart it or sign in first, then its tools can be listed.';
/** Spec 058 FR-163 (review on #625): the same for a server that is still starting. */
export const MCP_STARTING = 'This server is still starting. Its tools can be listed once it is connected.';

/**
 * Spec 040 FR-015: the config of the throw-away session behind `generateText`. Nothing can act and nothing is kept:
 * no tool from any source (`availableTools: []`, and `excludedTools` as a second lock), the MCP servers the runtime would load on its own
 * switched off by name, no skills, custom agents, discovered config, instructions, hooks, git context, memory, session store or
 * infinite-session workspace, an empty temp folder as the working directory, and the cheapest `auto` routing (as a new `auto` session).
 */
/** Spec 069 FR-062: Copilot's filter strings for the tools turned off in Durbar (`mcp:<server>-<tool>`). */
export function copilotExcludedTools(off: Readonly<Record<string, readonly string[]>> | undefined): string[] {
  const out: string[] = [];
  for (const [server, tools] of Object.entries(off ?? {})) for (const t of tools ?? []) if (typeof t === 'string' && t) out.push(`mcp:${server}-${t}`);
  return out.slice(0, 5000);
}

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
  /** Spec 011 FR-071: ids of Durbar-raised limit requests. */
  private capSeq = 0;
  /** Optional debug sink (DURBAR_LOG): what was actually handed to the SDK. */
  debug?: (message: string) => void;
  /** Spec 065 FR-001: assigned by the main process (router.setWriteGuard). */
  writeGuard?: WriteGuard;
  /** Spec 040 FR-015: the `generateText` time limit; protected so a test can shorten it. */
  protected oneShotTimeoutMs = ONE_SHOT_TIMEOUT_MS;
  /** One mapper per session (it remembers tool names, reasoning ids and sub-agent ids of that session). */
  private mappers = new Map<string, EventMapper>();

  /**
   * Lazily start the shared runtime. Uses the logged-in Copilot user (e.g. `copilot login`). Protected so a test can hand in a fake client (no runtime process, no credits).
   * Spec 058 FR-161: ONE runtime per app run for every session, one-shot and check (each runtime process reads Copilot's keychain items
   * again, so a runtime per session would ask again per session on a Mac). A start that failed is not kept: the next call starts again
   * instead of failing for the rest of the run. A runtime that exits later is restarted by the SDK itself on the next create or resume
   * (`read:` SDK 1.0.22 `client.js` `createSession`/`resumeSessionInternal`: `if (!this.connection) await this.start()`).
   */
  protected async getClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    const starting = (this.starting ??= this.createClient().then(
      (c) => {
        if (this.starting === starting) this.client = c;
        return c;
      },
      (e: unknown) => {
        if (this.starting === starting) this.starting = undefined;
        throw e;
      },
    ));
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
    this.planCache = undefined; // spec 051 FR-022: a new sign-in may have a new plan
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
   * Spec 051 FR-011, FR-018, FR-022: the account the runtime reports (`getAuthStatus()`: login, host, how it signed in) and its plan.
   * No prompt; no credits (FR-022 evidence). `statusMessage` is not read. Personal data: never passed to `debug` (FR-015).
   */
  async accountInfo(opts: AccountInfoOptions = {}): Promise<AccountIdentity> {
    try {
      const client = await this.getClient();
      const id = copilotAccount(await client.getAuthStatus());
      if (id.status !== 'signed-in') return id;
      const plan = await this.planOf(client, opts).catch(() => undefined);
      return plan ? { ...id, plan } : id;
    } catch {
      return { status: 'unknown' };
    }
  }

  /** The whole plan read (a live session, or the throw-away's create, status and cleanup) may take this long; then no plan (FR-022). */
  protected planTimeoutMs = 3000;
  /** Each cleanup call of the throw-away session (disconnect, delete) may take this long. */
  protected planCleanupMs = 2000;
  /** A throw-away read still running after this long is not waited for again (a hung `createSession` never blocks Check again). */
  protected planStaleMs = 30_000;
  /** The plan, once per run (FR-022): asked again only on `recheck` (Check again, a finished sign-in) or after `refreshAuth`. */
  private planCache?: Promise<string | undefined>;
  /** The throw-away read in flight, also after its cap, so a second one never starts beside it. */
  private planInflight?: { p: Promise<string | undefined>; at: number };

  private capped<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<undefined>((res) => { timer = setTimeout(() => res(undefined), ms); });
    return Promise.race([p.catch(() => undefined), limit]).finally(() => clearTimeout(timer));
  }

  /**
   * FR-022: the plan from a live session first (`gitHubAuth.getStatus` on a running session costs nothing more); otherwise one
   * throw-away session per run (kept until a recheck or a sign-in). The whole read is capped at `planTimeoutMs`.
   */
  private async planOf(client: CopilotClient, opts: AccountInfoOptions): Promise<string | undefined> {
    for (const live of this.sessions.values()) {
      const auth = (live.session.rpc as unknown as { gitHubAuth?: { getStatus?: () => Promise<unknown> } }).gitHubAuth;
      if (typeof auth?.getStatus !== 'function') continue;
      const st = await this.capped(auth.getStatus(), this.planTimeoutMs);
      const plan = copilotPlanLabel(st && typeof st === 'object' ? (st as { copilotPlan?: unknown }).copilotPlan : undefined);
      if (plan) return plan;
      break; // one live session answers for all of them
    }
    if (opts.recheck) this.planCache = undefined;
    if (!this.planCache) {
      const fresh = this.planInflight && Date.now() - this.planInflight.at < this.planStaleMs ? this.planInflight.p : this.startPlanRead(client, opts.disabledMcpServers ?? []);
      this.planCache = this.capped(fresh, this.planTimeoutMs);
    }
    return this.planCache;
  }

  /**
   * Spec 051 FR-018, FR-022: the Copilot plan, which only a session's `gitHubAuth.getStatus()` reports (`copilotPlan`; the client-level
   * `getAuthStatus()` has none). A throw-away session like the one-shot's (`oneShotConfig`: no tools, no custom agents, a temp folder,
   * and every MCP server the runtime would start by itself switched off by name, `disabledMcpServers`), with no message sent. It is
   * disconnected and deleted (each call capped), and its folder removed, in a `finally`, also when it resolves after the cap. Only
   * `copilotPlan` is read (the login and message in the same answer are dropped).
   */
  private startPlanRead(client: CopilotClient, disabledMcpServers: readonly string[]): Promise<string | undefined> {
    const run = (async (): Promise<string | undefined> => {
      sweepStaleTempDirs(os.tmpdir(), ACCOUNT_TEMP_PREFIXES, Date.now(), 3600_000); // leftovers of a quit mid-call (FR-022)
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-acct-'));
      let session: CopilotSession | undefined;
      try {
        const config = { ...oneShotConfig(dir, disabledMcpServers), onPermissionRequest: async (): Promise<PermissionRequestResult> => ({ kind: 'reject', feedback: 'Agent Durbar allows no tools here.' }) as PermissionRequestResult };
        session = await client.createSession(config as unknown as SessionConfig);
        const auth = (session.rpc as unknown as { gitHubAuth?: { getStatus?: () => Promise<unknown> } }).gitHubAuth;
        if (typeof auth?.getStatus !== 'function') return undefined;
        const st = await this.capped(auth.getStatus(), this.planTimeoutMs);
        return copilotPlanLabel(st && typeof st === 'object' ? (st as { copilotPlan?: unknown }).copilotPlan : undefined);
      } finally {
        if (session) {
          const id = session.sessionId;
          await this.capped(session.disconnect(), this.planCleanupMs);
          await this.capped(client.deleteSession(id), this.planCleanupMs);
        }
        fs.rmSync(dir, { recursive: true, force: true });
        sweepStaleTempDirs(os.tmpdir(), ACCOUNT_TEMP_PREFIXES, Date.now(), 3600_000);
      }
    })();
    const entry = { p: run, at: Date.now() };
    this.planInflight = entry;
    void run.catch(() => undefined).finally(() => { if (this.planInflight === entry) this.planInflight = undefined; });
    return run;
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
    // spec 012 FR-156 delta (real, CI account 2026-10-20): a GitHub sign-in without Copilot enabled passes the quota call, but
    // every model call answers 403 "not authorized to use this Copilot feature"; the model list (free) tells the two apart
    const listing = (): Promise<unknown> => (typeof rpc?.models?.list === 'function' ? rpc.models.list({}) : client.listModels());
    for (const call of calls) {
      try {
        await call();
        try {
          if (calls.length > 1) await listing();
        } catch (e) {
          if (NO_COPILOT_ACCESS.test(errorText(e))) return { status: 'unknown', detail: NO_COPILOT_ACCESS_DETAIL };
        }
        return { status: 'signed-in', detail: 'Signed in (checked with GitHub).' };
      } catch (e) {
        if (NO_COPILOT_ACCESS.test(errorText(e))) return { status: 'unknown', detail: NO_COPILOT_ACCESS_DETAIL };
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
    const id = options.resumeSessionId ?? options.sessionId;
    return id ? this.withSessionLock(id, () => this.startLocked(options)) : this.startLocked(options);
  }

  private async startLocked(options: StartOptions): Promise<string> {
    const { cwd, folders } = resolveWorkspaceCwd(options.workspace);
    const client = await this.getClient();
    let sid = options.resumeSessionId ?? options.sessionId ?? '';
    const blocked = mcpToolBlockList(options.disabledMcpTools); // spec 069 FR-063
    const broker = new PermissionBroker({
      roots: [cwd, ...folders],
      mode: startModeOf(options),
      blockedTools: () => blocked,
      beforeWrite: (paths) => this.writeGuard?.(sid, paths) ?? Promise.resolve(), // spec 065 FR-001
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

    // spec 066 FR-003: the runtime's plan (plan mode) waits for the user's answer; approve continues interactively (never autopilot)
    const onExitPlanModeRequest = async (req: { summary?: unknown; planContent?: unknown }): Promise<{ approved: boolean; selectedAction?: string; feedback?: string }> => {
      const live = this.sessions.get(sid);
      if (!live) return { approved: false };
      const text = cleanPlanText(typeof req.planContent === 'string' && req.planContent.trim() ? req.planContent : req.summary);
      const requestId = `copilot-plan-${randomUUID()}`;
      live.plans ??= new Map();
      const answer = await new Promise<PlanAnswer>((resolve) => {
        live.plans!.set(requestId, resolve);
        this.emit(sid, { type: 'plan', phase: 'proposed', requestId, text });
      });
      live.plans.delete(requestId);
      this.emit(sid, { type: 'plan', phase: 'resolved', requestId, action: answer.kind });
      if (answer.kind === 'approve') {
        live.planMode = false; // the runtime leaves plan mode with the selected action
        return { approved: true, selectedAction: 'interactive' };
      }
      if (answer.kind === 'revise') return { approved: false, feedback: answer.feedback };
      live.planMode = false;
      void live.session.rpc.mode.set({ mode: 'interactive' }).catch(() => undefined); // rejected: leave plan mode, nothing runs
      return { approved: false };
    };

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

    // spec 061 FR-004 (research R3): the folder's ACCEPTED hooks only, in a private folder Durbar writes, through the SDK's explicit
    // `hookDirectories`; the repository's own hook files stay off (`enableFileHooks: false`, FR-017). Removed when the session ends.
    const hooksJson = copilotHooksJson(options.folderSetup);
    let hookDir: string | undefined;
    if (hooksJson) {
      sweepOldHookDirs();
      hookDir = fs.mkdtempSync(path.join(os.tmpdir(), HOOK_DIR_PREFIX));
      fs.chmodSync(hookDir, 0o700);
      fs.writeFileSync(path.join(hookDir, 'durbar-folder.json'), hooksJson, { mode: 0o600 });
    }
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
      // spec 069 FR-062: single MCP tools turned off in Durbar; `excludedTools` "always takes precedence" (read: SDK 1.0.22 types.d.ts), MCP
      // tools by the runtime's wire name `<server>-<tool>` (read: toolSet.d.ts addMcp("github-list_issues")); not run on a real account
      ...(copilotExcludedTools(options.disabledMcpTools).length ? { excludedTools: copilotExcludedTools(options.disabledMcpTools) } : {}),
      // AI-credit cap (spec 011): the SDK calls it "AI Credits"; the app treats 1 AIU = 1 credit. `sessionLimits` is @experimental in SDK 1.0.22.
      ...(options.maxAiCredits && options.maxAiCredits > 0 && Number.isFinite(options.maxAiCredits) ? { sessionLimits: { maxAiCredits: options.maxAiCredits } } : {}),
      onPermissionRequest,
      onUserInputRequest,
      onExitPlanModeRequest,
      onElicitationRequest,
      // spec 043 FR-002: custom agents from explicit folders only (no config discovery, so no repository skills)
      agentDirectories: agentDirsFor([cwd, ...folders]),
      // spec 061 FR-017 (real 2026-10-20): without this the runtime runs a repository's own hooks (`.github/hooks/*.json`,
      // `.github/copilot/settings.json`) unasked, even in Read-only. Accepted ones come through `hookDirectories` instead.
      enableFileHooks: false,
      ...(hookDir ? { hookDirectories: [hookDir] } : {}),
      // spec 058 FR-070 (owner Q12 B): the runtime keeps an MCP server's OAuth sign-in in the OS keychain (types.d.ts: "shared
      // across sessions"); the SDK default "in-memory" drops it when the session ends. The runtime's own store: Durbar never
      // reads, lists or clears it. On create AND resume (the same config), so the FR-158 reconnect re-resume keeps it; not in
      // `oneShotConfig` or `renameResumeConfig` (no MCP there).
      mcpOAuthTokenStorage: 'persistent' as const,
    };
    this.debug?.(`mcp: servers=[${Object.keys(options.mcpServers ?? {}).join(',')}] disabled=[${(options.disabledMcpServers ?? []).join(',')}]`);
    let session: CopilotSession;
    // The saved model, effort and tier go on create AND resume, so a model the user switched to survives an ended session or a restart.
    // `modelConfig` adds the `auto` routing preference only to a NEW session (on resume it would override the session's own).
    const resumed = (): Record<string, unknown> => ({ ...config, ...modelConfig(options, true) });
    const created = (): Record<string, unknown> => ({ ...config, ...modelConfig(options, false) });
    let resumedExisting = false; // its title is asked once (issue #126): the runtime may not send it again
    try {
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
    } catch (e) {
      // review nit #424: the private copy of the accepted folder hooks does not outlive a session that never started
      if (hookDir) fs.rmSync(hookDir, { recursive: true, force: true });
      throw e;
    }
    sid = session.sessionId;
    const onSessionEvent = (ev: SessionEvent): void => {
      // Remember an open limit request so Stop / End can answer it (the runtime waits for a consumer once interest is registered).
      const live = this.sessions.get(sid);
      if (live && ev.type === 'session_limits_exhausted.requested') live.limitRequestId = ev.data.requestId;
      else if (live && ev.type === 'session_limits_exhausted.completed' && live.limitRequestId === ev.data.requestId) live.limitRequestId = undefined;
      if (live && ev.type === 'session.title_changed' && !ev.agentId) {
        // spec 059 FR-011: only this event is skipped; every other event (usage, cap, idle) goes on below
        if (live.userTitle !== undefined && (ev.data as { title?: unknown } | undefined)?.title !== live.userTitle) return;
        live.titled = true;
      }
      this.map(sid, ev);
      if (live) this.trackCap(sid, live, ev);
      if (live && ev.type === 'session.idle') {
        this.askTitle(sid);
      }
    };
    const unsubscribe = session.on(onSessionEvent);
    // FR-158: a reconnect resumes with the same handlers but no model fields, so the session keeps the model the runtime stored
    // (it may have been switched since this start).
    const startCap = options.maxAiCredits && options.maxAiCredits > 0 && Number.isFinite(options.maxAiCredits) ? options.maxAiCredits : null;
    this.sessions.set(sid, { session, unsubscribe, cwd, folders: [cwd, ...folders], broker, resumeConfig: () => ({ ...config }), onSessionEvent, capNow: startCap, ...(hookDir ? { hookDir } : {}) });
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
    // spec 011 FR-071: at or over the cap the message is held and the user is asked (the runtime would send it anyway)
    if (overCap(live)) {
      this.raiseLocalLimit(sessionId, live, message);
      return;
    }
    live.turnOpen = true;
    // spec 066 FR-003: plan first: the runtime's own plan mode (it reads and proposes; nothing changes until the user approves)
    if (message.plan) {
      await live.session.rpc.mode.set({ mode: 'plan' });
      live.planMode = true;
    } else if (live.planMode) {
      // review on #441: a plan-first turn that ended without a plan (the model just answered) left the runtime in plan mode, so a
      // normal message would never act: back to interactive first
      await live.session.rpc.mode.set({ mode: 'interactive' });
      live.planMode = false;
    }
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

  /** Spec 066 FR-002: the user's answer to a proposed plan. */
  async resolvePlan(sessionId: string, requestId: string, answer: PlanAnswer): Promise<void> {
    const w = this.sessions.get(sessionId)?.plans?.get(requestId);
    if (w) w(answer);
  }

  private cancelQuestions(live: Live): void {
    for (const q of [...(live.questions?.values() ?? [])]) q.resolve(null);
    for (const p of [...(live.plans?.values() ?? [])]) p({ kind: 'reject' }); // spec 066: Stop / End reject an open plan
    cancelElicitations(live.elicitations);
  }

  /**
   * Spec 073 FR-004/FR-009: the folder's and the user's skills, read by Durbar (the session has no config discovery, so the runtime does
   * not load them; real 2026-10-22). No built-ins: `session.send` hands a typed built-in to the model as text (real 2026-10-22).
   */
  private readonly slash = new SlashCache();
  private slashPlaces(live: { cwd: string; folders?: string[] }): SlashPlace[] {
    return copilotSlashPlaces([live.cwd, ...(live.folders ?? [])], copilotHomeDir(), undefined, vscodeUserPromptDirs());
  }

  async listSlashCommands(sessionId: string): Promise<SlashCommand[]> {
    const live = this.sessions.get(sessionId);
    return live ? this.slash.list(this.slashPlaces(live), { refresh: true }) : []; // the window opening its list: read afresh
  }

  async expandSlashCommand(sessionId: string, text: string): Promise<SlashExpansion | undefined> {
    const live = this.sessions.get(sessionId);
    return live ? this.slash.expand(text, () => this.slashPlaces(live)) : undefined; // no IO unless the text is a `/name` line
  }

  /** spec 043 FR-002: the session's selectable custom agents (`rpc.agent.list`, @experimental). */
  async listAgentProfiles(sessionId: string): Promise<AgentProfile[]> {
    const live = this.sessions.get(sessionId);
    if (!live) return [];
    const r = (await live.session.rpc.agent.list()) as { agents?: unknown[] } | undefined;
    return (r?.agents ?? []).map((a) => profileOf(a as Parameters<typeof profileOf>[0], live.folders ?? [live.cwd])).filter((p): p is AgentProfile => !!p);
  }

  /** spec 043 FR-041: read the agent files again (`rpc.agent.reload`, @experimental), so a new or deleted file shows in the list. */
  async reloadAgentProfiles(sessionId: string): Promise<boolean> {
    const live = this.sessions.get(sessionId);
    return live ? reloadAgentsRpc(live.session.rpc.agent as unknown as AgentRpc) : false;
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
    try {
      await live.session.disconnect();
    } finally {
      // spec 061: the accepted folder hooks' private copy, removed even when disconnect() throws (re-review #424)
      if (live.hookDir) fs.rmSync(live.hookDir, { recursive: true, force: true });
    }
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
   * Spec 059 FR-007 (Q2 B): store the user's name in Copilot (`rpc.name.set`, @experimental), the field the CLI's `/rename` writes. A live
   * session is renamed directly. A session that is not live is resumed WITHOUT a prompt (`resumeSession` only, no `send`: no model
   * call, 0 credits expected), renamed, and released again (`disconnect`, in a `finally`); it stays on disk. Any error is thrown so
   * the caller keeps a Durbar-only name. The name is never logged.
   */
  async renameSession(sessionId: string, name: string): Promise<void> {
    if (!sessionIdOk(this.id, sessionId)) throw new Error('That is not a session id.');
    const bad = copilotNameError(name);
    if (bad) throw new Error(bad);
    await this.refreshing?.catch(() => undefined);
    // one lock per session id: a start or resume of the same session waits for a rename in flight, and the other way round
    return this.withSessionLock(sessionId, async () => {
      const live = this.sessions.get(sessionId);
      if (live) {
        await live.session.rpc.name.set({ name });
        live.titled = true; // the name is the user's: a later auto title must not replace it on screen
        live.userTitle = name; // and no other title reaches Durbar's sync rule while this session is open (spec 059 FR-011)
        return;
      }
      const client = await this.getClient();
      const meta = await client.getSessionMetadata(sessionId).catch(() => undefined);
      const dir = meta?.context?.workingDirectory;
      if (!dir) throw new Error('Copilot has no folder stored for that session.');
      const session = await client.resumeSession(sessionId, renameResumeConfig(dir) as unknown as ResumeSessionConfig);
      try {
        await session.rpc.name.set({ name });
      } finally {
        await session.disconnect().catch(() => undefined);
      }
    });
  }

  /** Spec 059: runs `fn` after any earlier call for the same session id has finished (rename-resume and start/resume never overlap). */
  private sessionLocks = new Map<string, Promise<unknown>>();
  private withSessionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.sessionLocks.get(id) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.sessionLocks.set(id, tail);
    void tail.then(() => {
      if (this.sessionLocks.get(id) === tail) this.sessionLocks.delete(id);
    });
    return run;
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
    live.capNow = credits;
  }

  /** FR-070: keep the used credits and the cap in force up to date from the session's own events; FR-072: stop a turn that crosses the cap. */
  private trackCap(sid: string, live: Live, ev: SessionEvent): void {
    const d = (ev as { data?: Record<string, unknown> }).data ?? {};
    if (ev.type === 'session.usage_checkpoint') {
      const n = nanoOf(d.totalNanoAiu);
      if (n !== undefined) { live.usedCheckpointNano = n; live.usedSinceNano = 0; }
    } else if (ev.type === 'assistant.usage') {
      const n = nanoOf((d.copilotUsage as { totalNanoAiu?: unknown } | undefined)?.totalNanoAiu);
      if (n !== undefined) live.usedSinceNano = (live.usedSinceNano ?? 0) + n;
    } else if (ev.type === 'session.session_limits_changed') {
      const cap = nanoOf((d.sessionLimits as { maxAiCredits?: unknown } | undefined)?.maxAiCredits);
      live.capNow = cap && cap > 0 ? cap : null;
    } else if (ev.type === 'session.idle') live.turnOpen = false;
    // after a call's report or the runtime's own total (on a resumed session the first checkpoint brings what was spent before)
    if ((ev.type === 'assistant.usage' || ev.type === 'session.usage_checkpoint') && live.turnOpen && !live.localLimit && overCap(live)) void this.stopAtCap(sid, live);
  }

  /** FR-071/FR-072: ask the user through the usual limit event; `held` is the message that was not sent. */
  private raiseLocalLimit(sid: string, live: Live, held?: AgentMessage): void {
    const requestId = `durbar-cap-${++this.capSeq}`;
    live.localLimit = { requestId, ...(held ? { held } : {}) };
    this.emit(sid, { type: 'limit', phase: 'exhausted', requestId, maxAiCredits: live.capNow ?? null, usedAiCredits: Math.round(usedCredits(live) * 100) / 100 });
  }

  /**
   * FR-072: a turn crossed the cap. Stop it first and let its "Aborted" idle reach the window (which settles any open limit as
   * cancelled), then ask. The call already in flight has spent what it spent: the cap is soft by one call.
   */
  private async stopAtCap(sid: string, live: Live): Promise<void> {
    live.localLimit = { requestId: 'durbar-cap-stopping' };
    try {
      await live.session.abort();
    } catch {
      /* already ended */
    }
    for (let i = 0; i < 50 && live.turnOpen && this.sessions.get(sid) === live; i++) await new Promise((r) => setTimeout(r, 100));
    live.turnOpen = false;
    // the session ended, or Stop answered meanwhile (it clears the placeholder): nothing to ask
    if (this.sessions.get(sid) !== live || live.localLimit?.requestId !== 'durbar-cap-stopping') return;
    this.raiseLocalLimit(sid, live);
  }

  /** Answer a limit: Durbar's own (FR-071/FR-072) here, the runtime's (`add` / `set` / `unset` / `cancel`) through the SDK. */
  async resolveLimit(sessionId: string, requestId: string, action: LimitAction): Promise<void> {
    const live = this.mustGet(sessionId);
    if (live.localLimit && live.localLimit.requestId === requestId) {
      const { held } = live.localLimit;
      live.localLimit = undefined;
      if (action.kind === 'cancel') {
        this.emit(sessionId, { type: 'limit', phase: 'resolved', requestId, action: 'cancel' });
        this.emit(sessionId, { type: 'status', status: 'idle', intent: 'Stopped at the spending limit' });
        return;
      }
      const cap = action.kind === 'add' ? (live.capNow ?? 0) + action.credits : action.kind === 'set' ? action.credits : null;
      await this.setCap(sessionId, cap);
      this.emit(sessionId, { type: 'limit', phase: 'resolved', requestId, action: action.kind });
      if (overCap(live)) {
        this.raiseLocalLimit(sessionId, live, held);
        return;
      }
      if (held) await this.send(sessionId, held);
      else this.emit(sessionId, { type: 'status', status: 'idle', intent: 'Ready' });
      return;
    }
    const response =
      action.kind === 'add' ? { action: 'add' as const, additionalAiCredits: action.credits }
      : action.kind === 'set' ? { action: 'set' as const, maxAiCredits: action.credits }
      : { action: action.kind };
    await live.session.rpc.ui.handlePendingSessionLimitsExhausted({ requestId, response });
    if (live.limitRequestId === requestId) live.limitRequestId = undefined;
  }

  private async cancelLimit(live: Live): Promise<void> {
    live.localLimit = undefined; // FR-073: a held message is dropped
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

  /**
   * Spec 058 FR-012: restart one MCP server of this session. `rpc.mcp.restartServer` ("stops then starts", session-scoped, read: SDK
   * 1.0.22, @experimental) when the runtime has it; otherwise that one server off, then on (Q3). Never `stopServer` (it acts on the
   * session's host, Q2) and never `reload` (every server). The new state follows as `session.mcp_server_status_changed`.
   */
  async restartMcpServer(sessionId: string, name: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error('This session is not running. Send a message to start it.');
    const mcp = live.session.rpc.mcp as unknown as { restartServer?: (p: { serverName: string }) => Promise<void>; enable(p: { serverName: string }): Promise<void>; disable(p: { serverName: string }): Promise<void> };
    if (typeof mcp.restartServer === 'function') {
      try {
        await mcp.restartServer({ serverName: name });
        return;
      } catch (err) {
        // SDK 1.0.22 always has the generated method (`dist/generated/rpc.js`): an older runtime answers that it does not know it
        // (JSON-RPC -32601, as the SDK's own `connect` check reads it). Only then fall back; any other error is the restart's own.
        // real 2026-10-21: a failed restart reads "Request session.mcp.restartServer failed with message: <the server's reason>"
        if (!isMethodNotFound(err)) throw new Error(sdkErrorText(err));
      }
    }
    await mcp.disable({ serverName: name });
    await mcp.enable({ serverName: name });
  }

  /**
   * Spec 058 FR-064 (T098): the runtime's own OAuth sign-in for one remote MCP server of this session. `rpc.mcp.oauth.login`
   * (`@experimental`, read: SDK 1.0.22 `McpOauthLoginRequest`) with only the server name and two display texts: the runtime keeps its
   * default loopback flow (discovery, PKCE, its own callback listener, token exchange, storage and reconnect), so no token and no
   * callback ever pass through Durbar. Never `handlePendingRequest`, `complete`, `prepareLogin`, `cancelLogin` or `onMcpAuthRequest`,
   * and never `clientId`, `clientSecret`, `redirectUri` or `grantType`. `forceReauth` only for the user's **Sign in again** (FR-164, owner
   * 2026-10-23): the runtime forgets the stored sign-in and writes a new one itself (no keychain access by Durbar). No `authorizationUrl` in the answer = cached
   * tokens were still valid and the server is already connected. The result arrives later as `session.mcp_server_status_changed`.
   * A missing method, or a runtime that does not know it, rejects with a plain message (main then shows the terminal steps).
   */
  async startMcpSignIn(sessionId: string, name: string, opts: { again?: boolean } = {}): Promise<McpSignInResult> {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error('This session is not running. Send a message to start it, then sign in.');
    const oauth = (live.session.rpc.mcp as unknown as { oauth?: { login?: (p: { serverName: string; clientName: string; callbackSuccessMessage: string; forceReauth?: boolean }) => Promise<{ authorizationUrl?: unknown }> } }).oauth;
    if (!oauth || typeof oauth.login !== 'function') throw new Error('This Copilot version cannot start a sign-in from Agent Durbar.');
    let r: { authorizationUrl?: unknown } | undefined;
    try {
      r = await oauth.login({ serverName: name, clientName: 'Agent Durbar', callbackSuccessMessage: 'You can close this tab and go back to Agent Durbar.', ...(opts.again === true ? { forceReauth: true } : {}) });
    } catch (err) {
      if (isMethodNotFound(err)) throw new Error('This Copilot version cannot start a sign-in from Agent Durbar.');
      throw new Error(sdkErrorText(err));
    }
    const url = r?.authorizationUrl;
    if (url === undefined || url === null || url === '') return { kind: 'connected' };
    if (typeof url !== 'string') throw new Error('Copilot sent a sign-in page that Agent Durbar cannot read.');
    return { kind: 'browser', url };
  }

  /**
   * Spec 058 FR-064: read the session's server list again (`rpc.mcp.list`, @experimental: "Cache misses may start and wait for MCP
   * servers", read: SDK 1.0.22) and hand it to the mapper's `reread`, which keeps a needs-auth mark that the tool failures set while the list still says `connected` (a re-read is not a new status from the runtime; issue #364), so the usual `mcp` event follows.
   * Real 2026-10-23: after a browser sign-in the runtime sent no status event for a long while. A missing method or a failure changes nothing. `[KNOWN GAP]` (T105) whether `list` can still start other servers on a real runtime.
   */
  async refreshMcpStatus(sessionId: string, name?: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    const mcp = live.session.rpc.mcp as unknown as { list?: () => Promise<{ servers?: unknown }>; isServerRunning?: (p: { serverName: string }) => Promise<{ running?: unknown }> };
    if (typeof mcp.list !== 'function') return;
    // `isServerRunning` is the one-server check ("has an active client and transport", it starts nothing): `list` ("cache misses may start
    // and wait for MCP servers") is only called once this server has a client, which is the case a finished sign-in leads to
    if (name !== undefined && typeof mcp.isServerRunning === 'function') {
      const q = await mcp.isServerRunning({ serverName: name });
      if (q?.running !== true) return;
    }
    const r = await mcp.list();
    if (this.sessions.get(sessionId) === live && Array.isArray(r?.servers)) this.mapperFor(sessionId).reread(r.servers);
  }

  /** Spec 069 FR-031: a live `tools/list` through the runtime; it throws when the server is not connected. */
  async listMcpTools(sessionId: string, name: string): Promise<McpToolInfo[]> {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error('This session is not running. Send a message to start it.');
    const mcp = live.session.rpc.mcp as unknown as { listTools?: (p: { serverName: string }) => Promise<{ tools?: unknown }> };
    if (typeof mcp.listTools !== 'function') throw new Error('This Copilot version cannot list a server\'s tools.');
    // Spec 058 FR-163 (issue #623, real macOS 2026-10-23): a tools/list for a server that is not connected makes the runtime try to
    // connect it again, and each attempt can read its sign-in from the keychain (one more macOS prompt). Only a connected server, or one
    // the runtime has not reported yet, is asked; a failed, needs-sign-in or pending one waits for the user's Restart or Sign in.
    const st = this.mappers.get(sessionId)?.mcpStatusOf(name);
    if (st !== undefined && st !== 'connected') throw new Error(st === 'pending' ? MCP_STARTING : MCP_NOT_CONNECTED);
    try {
      const r = await mcp.listTools({ serverName: name });
      return normMcpTools(r?.tools);
    } catch (err) {
      throw new Error(sdkErrorText(err));
    }
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
    // review on #625: a quit during the first start must still stop the runtime that start brings up (else it outlives the app)
    const pending = this.client ? undefined : this.starting;
    this.starting = undefined;
    const client = this.client ?? (await pending?.catch(() => undefined));
    this.client = undefined;
    await client?.stop();
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

  /**
   * Spec 068 FR-002: the premium-request quota is used up but the error said nothing about when it resets: ask `account.getQuota` once
   * (a read that spends nothing, spec 012 FR-156) and send the same break again with the reset date. Best effort: any failure keeps the
   * break without a time ("resets later").
   */
  private async quotaReset(sid: string, body: EventBody & { type: 'usageLimit' }): Promise<void> {
    try {
      const client = await this.getClient();
      const rpc = (client as unknown as { rpc?: { account?: { getQuota?: (p: object) => Promise<unknown> } } }).rpc;
      if (typeof rpc?.account?.getQuota !== 'function') return;
      const r = copilotQuotaReset(await rpc.account.getQuota({}));
      if (r && this.sessions.has(sid)) this.emit(sid, { ...body, resetsAt: r.resetsAt, ...(r.estimated ? { estimated: true } : {}), update: true }); // update: ignored when the break already ended (Try now, a message)
    } catch (e) {
      this.debug?.(`quota reset not read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** SDK SessionEvent -> normalized event(s): see map.ts (pure, unit-tested with recorded fixtures). */
  private mapperFor(sid: string): EventMapper {
    let m = this.mappers.get(sid);
    if (!m) {
      m = new EventMapper((body) => {
        this.emit(sid, body);
        if (body.type === 'usageLimit' && body.scope === 'quota' && !body.resetsAt) void this.quotaReset(sid, body);
      });
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

/** Spec 058 FR-012: an SDK request error without its "Request <method> failed with message: " prefix (the runtime's own reason). */
export function sdkErrorText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/^Request \S+ failed with message: /, '') || m;
}

/** Spec 058 FR-012: the runtime does not know an RPC method (JSON-RPC MethodNotFound, -32601, or its "Unhandled method" text). */
export function isMethodNotFound(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e && e.code === -32601) return true;
  const m = e && typeof e.message === 'string' ? e.message : '';
  return /^Unhandled method\b|\bmethod not found\b/i.test(m);
}
