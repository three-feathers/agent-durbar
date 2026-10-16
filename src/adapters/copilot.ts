import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import type { CopilotSession, ModelInfo, PermissionRequest, PermissionRequestResult, SessionEvent } from '@github/copilot-sdk';
import type {
  AgentAdapter,
  AgentEvent,
  AgentMessage,
  PermissionInfo,
  StartOptions,
  Unsubscribe,
} from './types';
import { PermissionBroker } from './permissions';
import type { BrokerEvent, PermissionLike } from './permissions';
import { resolveWorkspaceCwd } from './workspace';
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

type EventBody = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, 'sessionId' | 'timestamp'> & { agentId?: string } : never) : never;

interface Live {
  session: CopilotSession;
  unsubscribe: () => void;
  cwd: string;
  broker: PermissionBroker;
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
  /** callId -> tool name, so complete/update events can carry the tool name. */
  private toolNames = new Map<string, string>();

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
  async cheapestModel(): Promise<ModelInfo | undefined> {
    const models = (await this.listModels()).filter((m) => m.policy?.state !== 'disabled');
    const price = (m: ModelInfo): number =>
      m.billing?.multiplier ?? m.billing?.tokenPrices?.inputPrice ?? Number.POSITIVE_INFINITY;
    return [...models].sort((a, b) => price(a) - price(b))[0];
  }

  async start(options: StartOptions): Promise<string> {
    const { cwd } = resolveWorkspaceCwd(options.workspace);
    const client = await this.getClient();
    let sid = options.resumeSessionId ?? '';
    const broker = new PermissionBroker({
      allow: options.allow,
      ask: options.ask,
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
      ...(options.autoTier ? { capi: { autoTier: options.autoTier } } : {}),
      onPermissionRequest,
    };
    const session = options.resumeSessionId
      ? await client.resumeSession(options.resumeSessionId, config)
      : await client.createSession(config);
    sid = session.sessionId;
    const unsubscribe = session.on((ev) => this.map(sid, ev));
    this.sessions.set(sid, { session, unsubscribe, cwd, broker });
    this.emit(sid, { type: 'status', status: 'idle', intent: `Ready in ${cwd}` });
    return sid;
  }

  async send(sessionId: string, message: AgentMessage): Promise<void> {
    const live = this.mustGet(sessionId);
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

  async stop(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    live.broker.stop(); // pending permissions are denied cleanly (renderer clears Approve/Deny) and grants are dropped
    try {
      await live.session.abort();
    } catch {
      /* nothing running */
    }
    live.unsubscribe();
    await live.session.disconnect();
    this.sessions.delete(sessionId);
    this.emit(sessionId, { type: 'status', status: 'stopped' });
  }

  resolvePermission(sessionId: string, requestId: string, approve: boolean, remember = false): void {
    this.sessions.get(sessionId)?.broker.resolve(requestId, approve, remember);
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

  /** SDK SessionEvent -> normalized event(s). */
  private map(sid: string, ev: SessionEvent): void {
    // Events from a sub-agent carry its instance id in `agentId`; tool events inside a
    // sub-agent also reference the spawning tool call via parentToolCallId.
    const agentId = ev.agentId;
    switch (ev.type) {
      case 'assistant.turn_start':
        return this.emit(sid, { type: 'status', status: 'working', agentId });
      case 'assistant.intent':
        return this.emit(sid, { type: 'status', status: 'working', intent: ev.data.intent, agentId });
      case 'assistant.reasoning_delta':
        return this.emit(sid, { type: 'thinking', delta: ev.data.deltaContent, agentId });
      case 'assistant.message_delta':
        return this.emit(sid, { type: 'output', delta: ev.data.deltaContent, agentId });
      case 'assistant.message':
        if (ev.data.content) this.emit(sid, { type: 'output', delta: '', final: true, text: ev.data.content, agentId });
        return;
      case 'assistant.usage': {
        const d = ev.data;
        return this.emit(sid, {
          type: 'usage',
          agentId,
          model: d.model,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          cacheReadTokens: d.cacheReadTokens,
          nanoAiu: d.copilotUsage?.totalNanoAiu,
          costMultiplier: d.cost,
          creditsStatus: d.aiCreditsStatus,
        });
      }
      case 'tool.execution_start':
        this.toolNames.set(ev.data.toolCallId, ev.data.toolName);
        return this.emit(sid, {
          type: 'toolCall',
          callId: ev.data.toolCallId,
          tool: ev.data.toolName,
          phase: 'start',
          args: ev.data.arguments,
          agentId: agentId ?? ev.data.parentToolCallId,
        });
      case 'tool.execution_partial_result':
        return this.emit(sid, {
          type: 'toolCall',
          callId: ev.data.toolCallId,
          tool: this.toolNames.get(ev.data.toolCallId) ?? '',
          phase: 'update',
          output: ev.data.partialOutput,
          agentId,
        });
      case 'tool.execution_complete': {
        const tool = this.toolNames.get(ev.data.toolCallId) ?? '';
        this.toolNames.delete(ev.data.toolCallId);
        return this.emit(sid, {
          type: 'toolCall',
          callId: ev.data.toolCallId,
          tool,
          phase: ev.data.success ? 'complete' : 'failed',
          output: ev.data.success ? ev.data.result?.content : ev.data.error?.message,
          agentId: agentId ?? ev.data.parentToolCallId,
        });
      }
      case 'subagent.started':
        return this.emit(sid, {
          type: 'subagent',
          subagentId: ev.data.toolCallId,
          name: ev.data.agentDisplayName,
          phase: 'started',
          task: ev.data.agentDescription,
          agentId,
        });
      case 'subagent.completed':
        return this.emit(sid, {
          type: 'subagent',
          subagentId: ev.data.toolCallId,
          name: ev.data.agentDisplayName,
          phase: 'completed',
          agentId,
        });
      case 'subagent.failed':
        return this.emit(sid, {
          type: 'subagent',
          subagentId: ev.data.toolCallId,
          name: ev.data.agentDisplayName,
          phase: 'failed',
          task: ev.data.error,
          agentId,
        });
      case 'session.idle':
        return this.emit(sid, { type: 'status', status: 'idle', intent: ev.data.aborted ? 'Aborted' : undefined });
      case 'session.error':
        return this.emit(sid, { type: 'status', status: 'error', intent: `${ev.data.errorType}: ${ev.data.message}`, agentId });
      default:
        return;
    }
  }
}
