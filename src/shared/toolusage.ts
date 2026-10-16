/**
 * "All time" tool usage (spec 020): cumulative counts that are kept on disk across restarts.
 * Pure (no Node, no Electron) so the main process, the simulator and the tests share it.
 *
 * Privacy (FR-005): only tool names, MCP server names, agent labels and counts are stored. A recorded event's arguments, output,
 * call id and session id are never copied into the document.
 */

export interface ToolCount {
  source: 'builtin' | 'mcp';
  /** MCP server name; '' for built-in tools. */
  server: string;
  name: string;
  calls: number;
  failed: number;
}
export interface Counts {
  calls: number;
  failed: number;
}
export interface AgentUsage extends Counts {
  /** key -> counts (same keys as `tools`). */
  tools: Record<string, Counts>;
}
export interface UsageDoc {
  version: 1;
  /** ISO timestamp of the first count (or of the last reset). */
  since: string;
  tools: Record<string, ToolCount>;
  /** Per MCP server totals. */
  servers: Record<string, Counts>;
  /** Per agent label ("<agent name> · <folder name>"). */
  agents: Record<string, AgentUsage>;
}

export const MAX_TOOLS = 1000;
export const MAX_AGENTS = 200;
export const MAX_TOOLS_PER_AGENT = 400;
export const MAX_SERVERS = 100;
const MAX_NAME = 120;
const MAX_COUNT = 1e12;

export const emptyDoc = (now: Date = new Date()): UsageDoc => ({ version: 1, since: now.toISOString(), tools: {}, servers: {}, agents: {} });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const name = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_NAME) : '');
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(MAX_COUNT, Math.floor(v)) : 0);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const okKey = (k: string): boolean => !!k && !FORBIDDEN.has(k);

/** Where a normalized toolCall event is counted (same rule as `toolKey` in renderer/toolstats.js). */
export function toolKey(ev: { tool?: unknown; mcpServer?: unknown; mcpTool?: unknown }): { key: string; source: 'builtin' | 'mcp'; server: string; name: string } {
  const server = name(ev.mcpServer);
  if (server) {
    const n = name(ev.mcpTool) || name(ev.tool) || '?';
    return { key: `mcp:${server}/${n}`, source: 'mcp', server, name: n };
  }
  const n = name(ev.tool) || '?';
  return { key: `builtin:${n}`, source: 'builtin', server: '', name: n };
}

/** Parse a stored document defensively: unknown shapes become an empty document, bad entries are dropped, limits enforced. */
export function sanitizeDoc(raw: unknown, now: Date = new Date()): UsageDoc {
  const doc = emptyDoc(now);
  if (!isObj(raw)) return doc;
  if (typeof raw.since === 'string' && !Number.isNaN(Date.parse(raw.since))) doc.since = new Date(raw.since).toISOString();
  if (isObj(raw.tools)) {
    for (const [k, v] of Object.entries(raw.tools)) {
      if (Object.keys(doc.tools).length >= MAX_TOOLS) break;
      if (!isObj(v) || !okKey(k) || k.length > MAX_NAME * 2 + 8) continue;
      const source = v.source === 'mcp' ? 'mcp' : 'builtin';
      const n = name(v.name);
      if (!n) continue;
      const server = source === 'mcp' ? name(v.server) : '';
      if (source === 'mcp' && !server) continue;
      const key = source === 'mcp' ? `mcp:${server}/${n}` : `builtin:${n}`;
      const calls = count(v.calls), failed = count(v.failed);
      if (!calls && !failed) continue;
      const cur = doc.tools[key];
      if (cur) { cur.calls += calls; cur.failed += failed; } else doc.tools[key] = { source, server, name: n, calls, failed };
    }
  }
  if (isObj(raw.servers)) {
    for (const [k, v] of Object.entries(raw.servers)) {
      if (Object.keys(doc.servers).length >= MAX_SERVERS) break;
      const n = name(k);
      if (!isObj(v) || !okKey(n)) continue;
      const calls = count(v.calls), failed = count(v.failed);
      if (calls || failed) doc.servers[n] = { calls, failed };
    }
  }
  if (isObj(raw.agents)) {
    for (const [k, v] of Object.entries(raw.agents)) {
      if (Object.keys(doc.agents).length >= MAX_AGENTS) break;
      const label = name(k);
      if (!isObj(v) || !okKey(label)) continue;
      const a: AgentUsage = { calls: count(v.calls), failed: count(v.failed), tools: {} };
      if (isObj(v.tools)) {
        for (const [tk, tv] of Object.entries(v.tools)) {
          if (Object.keys(a.tools).length >= MAX_TOOLS_PER_AGENT) break;
          if (!isObj(tv) || !okKey(tk) || !doc.tools[tk]) continue; // only tools that exist in the totals
          const calls = count(tv.calls), failed = count(tv.failed);
          if (calls || failed) a.tools[tk] = { calls, failed };
        }
      }
      if (a.calls || a.failed || Object.keys(a.tools).length) doc.agents[label] = a;
    }
  }
  return doc;
}

/**
 * Count one normalized event for `agentLabel`. Returns true when the document changed. Only `toolCall` events with phase `start`
 * (a call) or `failed` (counted on top) are counted. Limits: a new tool/agent beyond the caps is not added.
 */
export function recordEvent(doc: UsageDoc, agentLabel: string, ev: unknown): boolean {
  if (!isObj(ev) || ev.type !== 'toolCall' || (ev.phase !== 'start' && ev.phase !== 'failed')) return false;
  const label = name(agentLabel);
  if (!okKey(label)) return false;
  const k = toolKey(ev);
  if (!okKey(k.key)) return false;
  let t = doc.tools[k.key];
  if (!t) {
    if (Object.keys(doc.tools).length >= MAX_TOOLS) return false;
    t = { source: k.source, server: k.server, name: k.name, calls: 0, failed: 0 };
  }
  let a = doc.agents[label];
  if (!a) {
    if (Object.keys(doc.agents).length >= MAX_AGENTS) return false;
    a = { calls: 0, failed: 0, tools: {} };
  }
  let at = a.tools[k.key];
  if (!at) {
    if (Object.keys(a.tools).length >= MAX_TOOLS_PER_AGENT) return false;
    at = { calls: 0, failed: 0 };
  }
  let s: Counts | undefined;
  if (k.source === 'mcp') {
    s = doc.servers[k.server];
    if (!s) {
      if (Object.keys(doc.servers).length >= MAX_SERVERS) return false;
      s = { calls: 0, failed: 0 };
    }
  }
  const field = ev.phase === 'start' ? 'calls' : 'failed';
  for (const c of [t, a, at, s]) if (c) c[field] = Math.min(MAX_COUNT, c[field] + 1);
  doc.tools[k.key] = t;
  doc.agents[label] = a;
  a.tools[k.key] = at;
  if (s) doc.servers[k.server] = s;
  return true;
}

/** "<agent name> · <folder name>": the key an agent's counts are kept under. The folder is reduced to its base name (no path). */
export function agentLabel(agentName: string, folderPath: string): string {
  const base = String(folderPath || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  return base ? `${name(agentName) || 'agent'} · ${name(base)}` : name(agentName) || 'agent';
}
