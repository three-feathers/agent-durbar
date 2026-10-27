/**
 * Spec 058 FR-187..FR-189 (issue #779 A): the outcome of the last tool call of each MCP server, per session, as a class word only.
 * A failed call whose text reads like a refused sign-in (`auth`) or an organization access policy (`policy`) sets it; a later successful
 * call of the same server clears it; a stopped session drops it. The text of the call is classified and forgotten: only the word is kept.
 */
import type { AgentEvent } from '../adapters/types';
import { classifyMcpCall, type McpCallClass } from '../shared/mcpcall';

export class McpCallTracker {
  private readonly bySession = new Map<string, Map<string, McpCallClass>>();

  /** Feed every adapter event; non-MCP and in-flight calls change nothing. */
  onEvent(e: AgentEvent): void {
    if (e.type === 'status' && e.status === 'stopped') {
      this.bySession.delete(e.sessionId);
      return;
    }
    if (e.type !== 'toolCall' || !e.mcpServer) return;
    if (e.phase === 'complete') {
      const m = this.bySession.get(e.sessionId);
      if (m?.delete(e.mcpServer) && !m.size) this.bySession.delete(e.sessionId);
    } else if (e.phase === 'failed') {
      const cls = classifyMcpCall(e.output, e.mcpAuth === true);
      const m = this.bySession.get(e.sessionId) ?? new Map<string, McpCallClass>();
      if (cls) {
        if (m.size >= 200 && !m.has(e.mcpServer)) return; // never grows without bound
        m.set(e.mcpServer, cls);
        this.bySession.set(e.sessionId, m);
      } else if (m.delete(e.mcpServer) && !m.size) this.bySession.delete(e.sessionId); // another kind of failure is the newest outcome
    }
  }

  /** The class of this server's last call, or undefined. */
  get(sessionId: string, name: string): McpCallClass | undefined {
    return this.bySession.get(sessionId)?.get(name);
  }
}
