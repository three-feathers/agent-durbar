import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import type { CopilotSession, MCPServerConfig, ModelInfo, PermissionRequest, PermissionRequestResult, SessionEvent } from '@github/copilot-sdk';
import type {
  AgentAdapter,
  LimitAction,
  AgentEvent,
  AgentMessage,
  PermissionInfo,
  StartOptions,
  Unsubscribe,
} from './types';
import { EventMapper } from './map';
import type { EventBody, RawEvent } from './map';
import { PermissionBroker } from './permissions';
import type { BrokerEvent, PermissionLike } from './permissions';
import { resolveWorkspaceCwd } from './workspace';
import { eventsToHistory, previousSessionsFor } from './history';
import type { HistoryResult, PreviousSession } from './history';
import { unpackedRuntimePath } from './runtime';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** A model the account can use, as shown in the picker. */
export interface ModelOption {
  id: string;
  name: string;
  /** Billing cost multiplier reported by the API, when there is one. */
  multiplier?: number;
  efforts: string[];
  defaultEffort?: string;
  disabled: boolean;
  /** Context window in tokens when the runtime says so (it reports 0 for `auto`, which is treated as unknown). */
  contextWindow?: number;
}

interface Live {
  session: CopilotSession;
  unsubscribe: () => void;
  cwd: string;
  broker: PermissionBroker;
  /** `session_limits_exhausted.requested` waiting for the user (spec 011): answered with `cancel` when the turn is stopped or the session ends. */
  limitRequestId?: string;
}

/**
 * Copilot adapter on the official `@github/copilot-sdk` (1.0.x, CLI runtime 1.0.98).
 * One CopilotClient (one runtime process) is shared; one SDK session per folder.
 */
export class CopilotAdapter implements AgentAdapter {
  readonly id = 'copilot';
  private listeners = new Set<(event: AgentEvent) => void>();
  private client: CopilotClient | undefined;
  private starting: Promise<CopilotClient> | undefined;
  private sessions = new Map<string, Live>();
  /** Optional debug sink (DURBAR_LOG): what was actually handed to the SDK. */
  debug?: (message: string) => void;
  /** One mapper per session (it remembers tool names, reasoning ids and sub-agent ids of that session). */
  private mappers = new Map<string, EventMapper>();

  /** Lazily start the shared runtime. Uses the logged-in Copilot user (e.g. `copilot login`). */
  private async getClient(): Promise<CopilotClient> {
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

  /** Models visible to the logged-in user (no inference, no credits). */
  async listModels(): Promise<ModelInfo[]> {
    return (await this.getClient()).listModels();
  }

  /** Cheapest model by billing multiplier, falling back to input token price. Undefined if none reports billing. */
  /** What the logged-in account offers, in the shape the UI needs (no inference, no credits). */
  async listModelOptions(): Promise<ModelOption[]> {
    return (await this.listModels()).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      multiplier: m.billing?.multiplier,
      efforts: m.supportedReasoningEfforts ?? [],
      defaultEffort: m.defaultReasoningEffort,
      disabled: m.policy?.state === 'disabled',
      contextWindow: m.capabilities?.limits?.max_context_window_tokens > 0 ? m.capabilities.limits.max_context_window_tokens : undefined,
    }));
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
      mode: options.allow ? 'allow' : options.ask ? 'ask' : 'read-only',
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
              const word = e.permission.state === 'approved' ? (e.permission.via === 'session' ? 'Allowed for this session' : 'Approved') : 'Denied';
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

    const config = {
      workingDirectory: cwd,
      streaming: true,
      model: options.model,
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.autoTier ? { capi: { autoTier: options.autoTier } } : {}),
      // MCP (spec 019). The runtime also loads ~/.copilot/mcp-config.json and the built-in GitHub server on its own;
      // `disabledMcpServers` switches those off by name. Values (env, headers) are secrets: never logged, only names.
      ...(options.mcpServers && Object.keys(options.mcpServers).length ? { mcpServers: options.mcpServers as unknown as Record<string, MCPServerConfig> } : {}),
      ...(options.disabledMcpServers?.length ? { disabledMcpServers: options.disabledMcpServers } : {}),
      // AI-credit cap (spec 011): the SDK calls it "AI Credits"; the app treats 1 AIU = 1 credit. `sessionLimits` is @experimental in SDK 1.0.22.
      ...(options.maxAiCredits && options.maxAiCredits > 0 && Number.isFinite(options.maxAiCredits) ? { sessionLimits: { maxAiCredits: options.maxAiCredits } } : {}),
      onPermissionRequest,
    };
    this.debug?.(`mcp: servers=[${Object.keys(options.mcpServers ?? {}).join(',')}] disabled=[${(options.disabledMcpServers ?? []).join(',')}]`);
    let session: CopilotSession;
    if (options.resumeSessionId) session = await client.resumeSession(options.resumeSessionId, config);
    else if (options.sessionId) {
      // An agent that was ended (or restored from the saved folder list) keeps its id: resume it when it has
      // history on disk, otherwise start a fresh session under that same id.
      const known = await client.getSessionMetadata(options.sessionId).catch(() => undefined);
      session = known ? await client.resumeSession(options.sessionId, config) : await client.createSession({ ...config, sessionId: options.sessionId });
    } else session = await client.createSession(config);
    sid = session.sessionId;
    const unsubscribe = session.on((ev) => {
      // Remember an open limit request so Stop / End can answer it (the runtime waits for a consumer once interest is registered).
      const live = this.sessions.get(sid);
      if (live && ev.type === 'session_limits_exhausted.requested') live.limitRequestId = ev.data.requestId;
      else if (live && ev.type === 'session_limits_exhausted.completed' && live.limitRequestId === ev.data.requestId) live.limitRequestId = undefined;
      this.map(sid, ev);
    });
    this.sessions.set(sid, { session, unsubscribe, cwd, broker });
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
  async interrupt(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    live.broker.denyPending();
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
   * Optionally clears the session grants, approves what is pending now (Allow edits) or denies it (Read-only).
   */
  setPermMode(sessionId: string, mode: 'read-only' | 'ask' | 'allow', opts: { clearGrants?: boolean; approvePending?: boolean } = {}): { pending: number } {
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
  private map(sid: string, ev: SessionEvent): void {
    let m = this.mappers.get(sid);
    if (!m) {
      m = new EventMapper((body) => this.emit(sid, body));
      this.mappers.set(sid, m);
    }
    m.map(ev as unknown as RawEvent);
  }
}
