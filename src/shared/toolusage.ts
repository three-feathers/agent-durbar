import { createHash } from 'crypto';
import { isObj } from './guards';
import { stripAnsi } from './harnesssetup';
import { maskNoteText } from './redact';
/**
 * "All time" tool usage (spec 020): cumulative counts that are kept on disk across restarts.
 * Pure (no Electron; `crypto` only for the verdict cache key) so the main process, the simulator and the tests share it.
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

/** A map with no prototype: a key such as `__proto__` or `constructor` is just a key (review of #1294). */
const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export const emptyDoc = (now: Date = new Date()): UsageDoc => ({ version: 1, since: now.toISOString(), tools: dict(), servers: dict(), agents: dict() });

const name = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_NAME) : '');

/**
 * Spec 020 FR-033 (issue #1291): a tool or MCP server name that looks like a secret (an MCP server chooses the names) is never stored.
 * It is kept under one fixed placeholder per kind, so the counts stay right and the number of keys stays bounded, and the file holds no
 * token and nothing derived from one (no hash). The mask is the shared one the notes and outgoing messages use (`maskNoteText`: values
 * that hidden characters, an escape or Markdown marks split, then `redact`); the text with its ANSI and OSC sequences cut out is tried too (a
 * sequence with a terminator, cut out of the middle of a token, leaves it whole). Either finding a secret hides the name. A name the mask
 * cannot judge (it throws) is hidden too.
 */
export const HIDDEN_TOOL = '[hidden tool]';
export const HIDDEN_SERVER = '[hidden server]';
const NAME_LOOK = 4096; // longer names are judged on their first 4096 characters, then cut to MAX_NAME as before
/* Verdict cache (review of #1294): keyed by the SHA-256 (hex) of the judged slice, so no name text, secret or not, stays in memory; at most 500
   entries, each a boolean; a throw is never cached. A repeated hostile name is judged once, not once per event. */
const hiddenCache = new Map<string, boolean>();
const CACHE_MAX = 500;
export const nameCacheStats = (): { size: number; maxKeyLength: number; allHashes: boolean } => ({ size: hiddenCache.size, allHashes: [...hiddenCache.keys()].every((k) => /^[0-9a-f]{64}$/.test(k)), maxKeyLength: Math.max(0, ...[...hiddenCache.keys()].map((k) => k.length)) });
const WHITE = /[\s\u0000-\u001f\u007f]/g;
function looksSecret(raw: string): boolean {
  const text = raw.slice(0, NAME_LOOK);
  const key = createHash('sha256').update(text).digest('hex');
  const hit = hiddenCache.get(key);
  if (hit !== undefined) return hit;
  let r: boolean;
  try {
    const plain = stripAnsi(text);
    // the text as it is, with its escape sequences cut out, and with tabs, line breaks, other control codes and spaces cut out (a token split by one is a token)
    r = [text, plain, plain.replace(WHITE, '')].some((v) => maskNoteText(v).changed);
  } catch {
    return true;
  }
  if (hiddenCache.size >= CACHE_MAX) hiddenCache.clear();
  hiddenCache.set(key, r);
  return r;
}
/** A tool or server name for the file: the plain `name`, or `placeholder` when it looks like a secret. `report.masked` counts the replaced ones. */
function hideable(v: unknown, placeholder: string, report?: { masked: number }): string {
  if (typeof v !== 'string') return '';
  const n = name(v);
  if (!n) return '';
  if (!looksSecret(v)) return n;
  if (report) report.masked++;
  return placeholder;
}
const toolName = (v: unknown, report?: { masked: number }): string => hideable(v, HIDDEN_TOOL, report);
const serverName = (v: unknown, report?: { masked: number }): string => hideable(v, HIDDEN_SERVER, report);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(MAX_COUNT, Math.floor(v)) : 0);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const okKey = (k: string): boolean => !!k && !FORBIDDEN.has(k);

/** Where a normalized toolCall event is counted (same rule as `toolKey` in renderer/toolstats.js). */
export function toolKey(ev: { tool?: unknown; mcpServer?: unknown; mcpTool?: unknown }): { key: string; source: 'builtin' | 'mcp'; server: string; name: string } {
  const server = serverName(ev.mcpServer);
  if (server) {
    const n = toolName(ev.mcpTool) || toolName(ev.tool) || '?';
    return { key: `mcp:${server}/${n}`, source: 'mcp', server, name: n };
  }
  const n = toolName(ev.tool) || '?';
  return { key: `builtin:${n}`, source: 'builtin', server: '', name: n };
}

/** Parse a stored document defensively: unknown shapes become an empty document, bad entries are dropped, limits enforced. */
export function sanitizeDoc(raw: unknown, now: Date = new Date(), report?: { masked: number }): UsageDoc {
  const doc = emptyDoc(now);
  const keyOf = new Map<string, string>(); // a stored key -> the key it is kept under now (a secret-shaped name moves to the placeholder, spec 020 FR-033)
  if (!isObj(raw)) return doc;
  if (typeof raw.since === 'string' && !Number.isNaN(Date.parse(raw.since))) doc.since = new Date(raw.since).toISOString();
  if (isObj(raw.tools)) {
    for (const [k, v] of Object.entries(raw.tools)) {
      if (Object.keys(doc.tools).length >= MAX_TOOLS) break;
      if (!isObj(v) || !okKey(k) || k.length > MAX_NAME * 2 + 8) continue;
      const source = v.source === 'mcp' ? 'mcp' : 'builtin';
      const n = toolName(v.name, report);
      if (!n) continue;
      const server = source === 'mcp' ? serverName(v.server, report) : '';
      if (source === 'mcp' && !server) continue;
      const key = source === 'mcp' ? `mcp:${server}/${n}` : `builtin:${n}`;
      const calls = count(v.calls), failed = count(v.failed);
      if (!calls && !failed) continue;
      keyOf.set(k, key);
      const cur = doc.tools[key];
      if (cur) { cur.calls = Math.min(MAX_COUNT, cur.calls + calls); cur.failed = Math.min(MAX_COUNT, cur.failed + failed); } else doc.tools[key] = { source, server, name: n, calls, failed };
    }
  }
  if (isObj(raw.servers)) {
    for (const [k, v] of Object.entries(raw.servers)) {
      if (Object.keys(doc.servers).length >= MAX_SERVERS) break;
      const n = serverName(k, report);
      if (!isObj(v) || !okKey(n)) continue;
      const calls = count(v.calls), failed = count(v.failed);
      if (calls || failed) {
        const cur = doc.servers[n];
        if (cur) { cur.calls = Math.min(MAX_COUNT, cur.calls + calls); cur.failed = Math.min(MAX_COUNT, cur.failed + failed); } else doc.servers[n] = { calls, failed };
      }
    }
  }
  if (isObj(raw.agents)) {
    for (const [k, v] of Object.entries(raw.agents)) {
      if (Object.keys(doc.agents).length >= MAX_AGENTS) break;
      const label = name(k);
      if (!isObj(v) || !okKey(label)) continue;
      const a: AgentUsage = { calls: count(v.calls), failed: count(v.failed), tools: dict() };
      if (isObj(v.tools)) {
        for (const [tk, tv] of Object.entries(v.tools)) {
          if (Object.keys(a.tools).length >= MAX_TOOLS_PER_AGENT) break;
          const nk = keyOf.get(tk);
          if (!isObj(tv) || !okKey(tk) || !nk || !doc.tools[nk]) continue; // only tools that exist in the totals
          const calls = count(tv.calls), failed = count(tv.failed);
          if (!calls && !failed) continue;
          const at = a.tools[nk];
          if (at) { at.calls = Math.min(MAX_COUNT, at.calls + calls); at.failed = Math.min(MAX_COUNT, at.failed + failed); } else a.tools[nk] = { calls, failed };
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
  if (!okKey(k.key) || (k.server && !okKey(k.server))) return false;
  let t = doc.tools[k.key];
  if (!t) {
    if (Object.keys(doc.tools).length >= MAX_TOOLS) return false;
    t = { source: k.source, server: k.server, name: k.name, calls: 0, failed: 0 };
  }
  let a = doc.agents[label];
  if (!a) {
    if (Object.keys(doc.agents).length >= MAX_AGENTS) return false;
    a = { calls: 0, failed: 0, tools: dict() };
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
