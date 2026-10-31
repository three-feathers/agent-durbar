/**
 * Spec 100 FR-001: each agent app's answer as a neutral `McpContextReport`. Pure, tolerant of odd shapes; only names and numbers come out.
 * The vendor words stay in this folder: `src/shared` and the renderer see the report only (FR-043). Names are not cut here: main masks first, then cuts (`cleanReport`).
 */
import { normalizeServer, parseMcpToolName } from './claudeMap';
import { estimateTools, safeTokens } from '../shared/mcpcost';
import type { McpContextReport, McpContextServer } from '../shared/mcpcost';

/** Plan: at most this many entries or tools are read from a reply. */
const MAX_ROWS = 2000;
export const MCP_CONTEXT_TIMEOUT_MS = 10_000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nameOk = (v: unknown): v is string => typeof v === 'string' && !!v;
const rowsOf = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_ROWS) : []);

/**
 * Copilot `metadata.getContextAttribution()` (`@experimental`, `read:` SDK 1.0.22). A server is an entry of kind `mcpServer`, named by its
 * `id` (`mcpServer:<name>`; the label is presentation only). The types do not say whether its `tokens` hold its children's (`parentId`), so
 * the figure is the larger of the two and nothing counts twice (spec 100 Changes 2026-10-31, `[KNOWN GAP]`). Unknown kinds are ignored. `null`: no figures.
 */
export function copilotMcpContext(raw: unknown): McpContextReport {
  const a = isObj(raw) && 'contextAttribution' in raw ? raw.contextAttribution : raw;
  if (!isObj(a)) return { servers: [] };
  const entries = rowsOf(a.entries).filter(isObj);
  const servers = new Map<string, { name: string; own: number; children: number }>();
  for (const e of entries) {
    if (e.kind !== 'mcpServer' || !nameOk(e.id)) continue;
    servers.set(e.id, { name: e.id.replace(/^mcpServer:/, ''), own: safeTokens(e.tokens) ?? 0, children: 0 });
  }
  for (const e of entries) {
    const parent = typeof e.parentId === 'string' ? servers.get(e.parentId) : undefined;
    if (parent) parent.children += safeTokens(e.tokens) ?? 0;
  }
  const window = safeTokens(a.limit);
  const total = isObj(a.categories) ? safeTokens(a.categories.mcpTools) : undefined;
  const list: McpContextServer[] = [];
  for (const [id, s] of servers) {
    const parentIsServer = entries.some((e) => e.id === id && typeof e.parentId === 'string' && servers.has(e.parentId));
    if (!parentIsServer) list.push({ name: s.name, tokens: Math.max(s.own, s.children), source: 'reported' });
  }
  return { servers: list, ...(window ? { window } : {}), ...(total !== undefined ? { total } : {}) };
}

/**
 * Claude Code `get_context_usage`, `summary` (`read:` CLI 2.1.309 strings, 2.1.316 program). `mcpTools[]`: `serverName` is normalised, so the
 * tool's full name or the normalised form is matched back to the `mcp_status` names. `isLoaded === false` is deferred: the CLI gives such
 * a tool its full size there, and its own total leaves it out (spec 100 Changes 2026-10-31).
 */
export function claudeMcpContext(raw: unknown, names: readonly string[]): McpContextReport {
  if (!isObj(raw)) return { servers: [] };
  const byNorm = new Map(names.map((n) => [normalizeServer(n), n]));
  const servers = new Map<string, McpContextServer>();
  for (const t of rowsOf(raw.mcpTools)) {
    if (!isObj(t)) continue;
    const fromTool = nameOk(t.name) ? parseMcpToolName(t.name, names)?.mcpServer : undefined;
    const name = fromTool ?? (nameOk(t.serverName) ? (byNorm.get(t.serverName) ?? t.serverName) : undefined);
    const tokens = safeTokens(t.tokens);
    if (!name || tokens === undefined) continue;
    const s = servers.get(name) ?? { name, tokens: 0, deferredTokens: 0, tools: 0, source: 'reported' as const };
    if (t.isLoaded === false) s.deferredTokens = (s.deferredTokens ?? 0) + tokens;
    else s.tokens = (s.tokens ?? 0) + tokens;
    s.tools = (s.tools ?? 0) + 1;
    servers.set(name, s);
  }
  const usage = isObj(raw.modelUsage) ? Object.values(raw.modelUsage).find((m) => isObj(m) && safeTokens(m.contextWindow)) : undefined;
  const window = safeTokens(raw.rawMaxTokens) || safeTokens(raw.maxTokens) || (isObj(usage) ? safeTokens(usage.contextWindow) : undefined);
  return { servers: [...servers.values()], ...(window ? { window } : {}) };
}

/** Codex `mcpServerStatus/list` (`read:` generated schema): no figures of its own, so the estimate of FR-002 on each server's tools. A server whose list failed has no figure and makes the report partial. */
export function codexMcpContext(rows: readonly unknown[]): McpContextReport {
  const servers: McpContextServer[] = [];
  let partial = false;
  for (const row of rows.slice(0, MAX_ROWS)) {
    if (!isObj(row) || !nameOk(row.name)) continue;
    const name = row.name; // main masks, then cuts (a cut here could leave a token's head unmasked)
    if (typeof row.toolsError === 'string' && row.toolsError) {
      partial = true;
      servers.push({ name, source: 'unknown', error: 'list failed' }); // a fixed word: the app's text may hold anything (FR-040)
      continue;
    }
    const e = estimateTools(row.tools);
    servers.push({ name, tokens: e.tokens, tools: e.tools, source: 'estimated', ...(e.capped ? { capped: true } : {}) });
  }
  return { servers, ...(partial ? { partial: true } : {}) };
}
