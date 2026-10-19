import { randomUUID } from 'crypto';
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import { parseQuestions } from './questions';
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
  /** The session's folders (spec 043: a profile file inside one is the repository's). */
  folders?: string[];
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
});

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
  private sessions = new Map<string, Live>();
  /** Optional debug sink (DURBAR_LOG): what was actually handed to the SDK. */
  debug?: (message: string) => void;
  /** One mapper per session (it remembers tool names, reasoning ids and sub-agent ids of that session). */
  private mappers = new Map<string, EventMapper>();

  /** Lazily start the shared runtime. Uses the logged-in Copilot user (e.g. `copilot login`). Protected so a test can hand in a fake client (no runtime process, no credits). */
  protected async getClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    this.starting ??= (async () => {
      // Packaged app: run the runtime from app.asar.unpacked. Dev: let the SDK locate it.
      // No token is passed or stored here; the runtime uses the Copilot login on this machine.
      const runtimePath = unpackedRuntimePath();
      this.debug?.(`runtime: ${runtimePath ?? 'sdk default'}`);
      const c = new CopilotClient(
        runtimePath ? { connection: RuntimeConnection.forStdio({ path: runtimePath }), workingDirectory: os.homedir() } : {},
      );
      await c.start();
      this.client = c;
      return c;
    })();
    return this.starting;
  }

  /** Spec 051 FR-007: the runtime's own sign-in status (no prompt, no credits). The login name, host and message are dropped. */
  async authStatus(): Promise<{ signedIn: boolean }> {
    const s = await (await this.getClient()).getAuthStatus();
    return { signedIn: !!s.isAuthenticated };
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
    const unsubscribe = session.on((ev) => {
      // Remember an open limit request so Stop / End can answer it (the runtime waits for a consumer once interest is registered).
      const live = this.sessions.get(sid);
      if (live && ev.type === 'session_limits_exhausted.requested') live.limitRequestId = ev.data.requestId;
      else if (live && ev.type === 'session_limits_exhausted.completed' && live.limitRequestId === ev.data.requestId) live.limitRequestId = undefined;
      if (live && ev.type === 'session.title_changed' && !ev.agentId) live.titled = true;
      this.map(sid, ev);
      if (live && ev.type === 'session.idle') this.askTitle(sid);
    });
    this.sessions.set(sid, { session, unsubscribe, cwd, folders: [cwd, ...folders], broker });
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

  private cancelQuestions(live: Live): void {
    for (const q of [...(live.questions?.values() ?? [])]) q.resolve(null);
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
  }

  resolvePermission(sessionId: string, requestId: string, approve: boolean, remember = false, broad = false): void {
    this.sessions.get(sessionId)?.broker.resolve(requestId, approve, remember, broad);
  }

  revokeGrant(sessionId: string, key: string): void {
    this.sessions.get(sessionId)?.broker.revoke(key);
  }

  /** Stop all sessions and the shared runtime. */
  async dispose(): Promise<void> {
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
    const event = { ...body, sessionId, timestamp: Date.now() } as AgentEvent;
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
