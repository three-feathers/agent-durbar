/**
 * Spec 069 FR-031: one server's tools as the agent apps report them, normalized to `{ name, description? }`. Pure (no vendor types):
 * Copilot gives an array (`rpc.mcp.listTools`), Claude Code an array in `mcp_status`, Codex a map by name (`mcpServerStatus/list`).
 * Main masks and cuts the text before the window gets it (spec 069 FR-032); this only keeps strings and caps the count.
 */
import type { McpToolInfo } from './types';

export const MAX_MCP_TOOLS = 500;

export function normMcpTools(list: unknown): McpToolInfo[] {
  const items = Array.isArray(list) ? list : list && typeof list === 'object' ? Object.entries(list as Record<string, unknown>).map(([k, v]) => (v && typeof v === 'object' ? { name: k, ...(v as object) } : { name: k })) : [];
  const out: McpToolInfo[] = [];
  for (const t of items) {
    if (out.length >= MAX_MCP_TOOLS) break;
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name) continue;
    const d = typeof o.description === 'string' && o.description ? o.description : typeof o.title === 'string' && o.title ? o.title : undefined;
    out.push({ name: o.name, ...(d ? { description: d } : {}) });
  }
  return out;
}
