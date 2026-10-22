/**
 * Spec 069 FR-032: `agents:mcpTools(id, name)`, the tools of one MCP server of a running session for the expanded row. Pure (no Electron):
 * a known agent, a valid server name, an adapter with `listMcpTools`, a running session; at most 500 tools, names cut at 128 characters,
 * each description reduced to its first line, masked (the session's own secret values first) and cut at 200 characters; 10 s at most.
 */
import type { AdapterRouter } from '../adapters/router';
import type { AgentInfo, McpToolsResult } from '../shared/api';
import { cut } from '../shared/redact';
import { maskMcpError, maskMcpText } from './mcpmask';

export const MCP_TOOLS_MAX = 500;
export const MCP_TOOL_NAME_MAX = 128;
export const MCP_TOOL_DESC_MAX = 200;
export const MCP_TOOLS_TIMEOUT_MS = 10_000;

export interface McpToolsDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  secrets(agentId: string): readonly string[];
  timeoutMs?: number;
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function mcpToolsOp(d: McpToolsDeps, id: unknown, name: unknown): Promise<McpToolsResult> {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  if (!a || typeof name !== 'string' || !name || name.length > 64) return { ok: false, error: 'Unknown agent or server.' };
  const ad = d.router.forAgent(a.id);
  if (!ad) return { ok: false, error: 'Unknown agent or server.' };
  if (typeof ad.listMcpTools !== 'function') return { ok: false, error: `${ad.displayName} cannot list a server's tools.` };
  if (!ad.isLive(a.id)) return { ok: false, notRunning: true, error: 'Start the session to see its tools.' };
  const secrets = d.secrets(a.id);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const list = await Promise.race([
      ad.listMcpTools(a.id, name),
      new Promise<never>((_r, reject) => {
        timer = setTimeout(() => reject(new Error('The server did not answer in time.')), d.timeoutMs ?? MCP_TOOLS_TIMEOUT_MS);
      }),
    ]);
    const all = Array.isArray(list) ? list : [];
    const tools = all.slice(0, MCP_TOOLS_MAX).map((t) => {
      const first = typeof t.description === 'string' ? t.description.split(/\r?\n/).find((l) => l.trim()) : undefined;
      const desc = first === undefined ? undefined : cut(maskMcpText(first.trim(), secrets) ?? '', MCP_TOOL_DESC_MAX);
      return { name: cut(maskMcpText(String(t.name), secrets) ?? '', MCP_TOOL_NAME_MAX), ...(desc ? { description: desc } : {}) };
    });
    return { ok: true, tools, total: all.length };
  } catch (err) {
    return { ok: false, error: maskMcpError(errText(err), secrets) ?? 'Could not list the tools.' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
