import type { AgentAdapter, AgentEvent, AgentMessage, StartOptions, Unsubscribe } from './types';

/**
 * Stub Copilot adapter. No SDK calls yet.
 *
 * TODO: add `@github/copilot-sdk` and create one CopilotClient (or one runtime per folder).
 * TODO: start(): createSession({ workingDirectory, model, streaming: true, onPermissionRequest }) / resumeSession.
 * TODO: map SDK events to normalized events:
 *   assistant.reasoning_delta -> thinking, assistant.message_delta -> output,
 *   tool.execution_start/complete -> toolCall, subagent.started/completed/failed -> subagent,
 *   assistant.intent / session.idle / permission.requested -> status.
 * TODO: send(): forward text + attachments (files/images).
 * TODO: stop(): abort the turn and dispose the session.
 * TODO: surface assistant.usage as a per-agent AI-credit counter.
 * TODO: permission prompts: approve/deny UI instead of allow-all.
 * TODO: read-only discovery of VS Code-started sessions from disk (listSessions / chatSessions/*.jsonl).
 * TODO: pin CLI/SDK versions (preview protocols).
 */
export class CopilotAdapter implements AgentAdapter {
  readonly id = 'copilot';
  private listeners = new Set<(event: AgentEvent) => void>();

  async start(_options: StartOptions): Promise<string> {
    throw new Error('CopilotAdapter.start not implemented');
  }

  async send(_sessionId: string, _message: AgentMessage): Promise<void> {
    throw new Error('CopilotAdapter.send not implemented');
  }

  async stop(_sessionId: string): Promise<void> {
    throw new Error('CopilotAdapter.stop not implemented');
  }

  onEvent(listener: (event: AgentEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected emit(event: AgentEvent): void {
    for (const l of this.listeners) l(event);
  }
}
