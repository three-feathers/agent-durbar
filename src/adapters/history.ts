/**
 * Previous Copilot (CLI / SDK) sessions of a folder, and replay of a session's persisted events as chat history.
 * Pure functions, no I/O, no Electron: unit-tested in scripts/test-history.ts.
 *
 * Never logs or uploads content. Tolerant: unknown or malformed events are skipped.
 */
import * as path from 'path';
import { isObj } from '../shared/guards';

/** What the renderer shows in the "Previous sessions" list. */
export interface PreviousSession {
  id: string;
  title: string;
  /** ms since epoch */
  startTime: number;
  modifiedTime: number;
  branch?: string;
}

/** Subset of the SDK's SessionMetadata we rely on (dates may be Date, ISO string or number). */
export interface SessionMetaLike {
  sessionId?: unknown;
  startTime?: unknown;
  modifiedTime?: unknown;
  summary?: unknown;
  /** A name given to the session (for example with /rename); wins over the summary as its title. */
  name?: unknown;
  isRemote?: unknown;
  context?: { workingDirectory?: unknown; gitRoot?: unknown; branch?: unknown } | null;
}

/** Normalize a directory for comparison: absolute, no trailing separator, case-insensitive on Windows and macOS. */
export function normDir(p: string, platform: NodeJS.Platform = process.platform): string {
  let s = platform === 'win32' ? path.win32.resolve(p) : path.posix.resolve(p);
  const root = platform === 'win32' ? path.win32.parse(s).root : '/';
  while (s.length > root.length && /[\\/]$/.test(s)) s = s.slice(0, -1);
  if (platform === 'win32') s = s.replace(/\//g, '\\');
  return platform === 'win32' || platform === 'darwin' ? s.toLowerCase() : s;
}

export function sameDir(a: string, b: string, platform: NodeJS.Platform = process.platform, realpath?: (p: string) => string): boolean {
  if (!a || !b) return false;
  if (normDir(a, platform) === normDir(b, platform)) return true;
  if (!realpath) return false;
  try {
    return normDir(realpath(a), platform) === normDir(realpath(b), platform);
  } catch {
    return false;
  }
}

const toMs = (v: unknown): number => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return 0;
};

// eslint-disable-next-line no-control-regex
const TITLE_DROP_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\u2060\ufeff\u202a-\u202e\u2066-\u2069]/g;

/**
 * A session title as the app shows it (spec 002 delta 2026-10-18): one line, control and hidden direction or zero-width
 * characters removed (ZWJ, ZWNJ, LRM, RLM kept), at most `max` characters with an ellipsis; undefined when nothing is left.
 */
export function cleanSessionTitle(v: unknown, max = 80): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(TITLE_DROP_RE, '').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** One-line title from a session summary (the first prompt, or the title the runtime generated). */
export function cleanTitle(summary: unknown, max = 120): string {
  return cleanSessionTitle(summary, max) ?? 'Untitled session';
}

/**
 * Sessions whose working directory is `cwd`, newest first. Remote (cloud) sessions and sessions that this app
 * already has open (`excludeIds`) are left out. Malformed entries are skipped.
 */
export function previousSessionsFor(
  metas: readonly SessionMetaLike[],
  cwd: string,
  excludeIds: ReadonlySet<string> = new Set(),
  platform: NodeJS.Platform = process.platform,
  realpath?: (p: string) => string,
): PreviousSession[] {
  const out: PreviousSession[] = [];
  for (const m of metas) {
    if (!m || typeof m.sessionId !== 'string' || !m.sessionId || excludeIds.has(m.sessionId) || m.isRemote === true) continue;
    const wd = m.context?.workingDirectory;
    if (typeof wd !== 'string' || !sameDir(wd, cwd, platform, realpath)) continue;
    const modifiedTime = toMs(m.modifiedTime) || toMs(m.startTime);
    out.push({
      id: m.sessionId,
      title: cleanSessionTitle(m.name, 120) ?? cleanTitle(m.summary), // a saved name (for example /rename) wins over the summary
      startTime: toMs(m.startTime) || modifiedTime,
      modifiedTime,
      branch: typeof m.context?.branch === 'string' ? m.context.branch : undefined,
    });
  }
  return out.sort((a, b) => b.modifiedTime - a.modifiedTime);
}

/* ------------------------------------------------------------------ history replay ------------------------------------------------------------------ */

export type HistoryItem =
  | { type: 'user'; text: string; attachments?: { name: string; kind: 'file' | 'image' }[]; ts?: number }
  | { type: 'output'; text: string; ts?: number }
  | { type: 'tool'; callId: string; tool: string; label: string; output?: string; failed?: boolean; ts?: number };

export interface HistoryResult {
  items: HistoryItem[];
  /** Items before the cap. */
  total: number;
  truncated: boolean;
}

export interface HistoryLimits {
  maxItems: number;
  maxTextChars: number;
  maxToolOutputChars: number;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = { maxItems: 300, maxTextChars: 20_000, maxToolOutputChars: 2_000 };

export const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s);

export function toolLabel(args: unknown): string {
  if (typeof args === 'string') return args.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!isObj(args)) return '';
  const pick = ['path', 'pattern', 'command', 'url', 'query', 'file_path'].map((k) => args[k]).find((v) => typeof v === 'string');
  const v = pick ?? Object.values(args).find((x) => typeof x === 'string') ?? '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, 300);
}

const tsOf = (ev: Record<string, unknown>): number | undefined => {
  const t = typeof ev.timestamp === 'string' ? Date.parse(ev.timestamp) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

/**
 * Convert persisted Copilot session events (session.getEvents(), or the lines of events.jsonl) into chat history:
 * user messages, the assistant's completed messages and tool calls, in order. Sub-agent events, reasoning,
 * usage and housekeeping events are left out. Only the last `maxItems` items are kept.
 */
export function eventsToHistory(events: readonly unknown[], limits: Partial<HistoryLimits> = {}): HistoryResult {
  const lim = { ...DEFAULT_HISTORY_LIMITS, ...limits };
  const items: HistoryItem[] = [];
  const toolIdx = new Map<string, number>();
  for (const raw of Array.isArray(events) ? events : []) {
    if (!isObj(raw) || typeof raw.type !== 'string' || !isObj(raw.data)) continue;
    if (raw.agentId || raw.ephemeral === true) continue; // sub-agent chatter / transient events
    const d = raw.data;
    switch (raw.type) {
      case 'user.message': {
        if (d.source !== undefined && d.source !== 'user') break; // injected by the system or another agent
        const text = typeof d.content === 'string' ? d.content.trim() : '';
        const atts = Array.isArray(d.attachments)
          ? d.attachments.filter(isObj).map((a) => {
              const name = typeof a.displayName === 'string' ? a.displayName : typeof a.path === 'string' ? path.basename(a.path) : 'attachment';
              const kind: 'file' | 'image' = a.type === 'blob' && typeof a.mimeType === 'string' && a.mimeType.startsWith('image/') ? 'image' : 'file';
              return { name: name.slice(0, 120), kind };
            })
          : [];
        if (!text && !atts.length) break;
        items.push({ type: 'user', text: cut(text, lim.maxTextChars), attachments: atts.length ? atts : undefined, ts: tsOf(raw) });
        break;
      }
      case 'assistant.message': {
        if (d.parentToolCallId) break;
        const text = typeof d.content === 'string' ? d.content.trim() : '';
        if (text) items.push({ type: 'output', text: cut(text, lim.maxTextChars), ts: tsOf(raw) });
        break;
      }
      case 'tool.execution_start': {
        if (d.parentToolCallId || typeof d.toolCallId !== 'string' || typeof d.toolName !== 'string') break;
        toolIdx.set(d.toolCallId, items.length);
        items.push({ type: 'tool', callId: d.toolCallId, tool: d.toolName, label: toolLabel(d.arguments), ts: tsOf(raw) });
        break;
      }
      case 'tool.execution_complete': {
        if (typeof d.toolCallId !== 'string') break;
        const i = toolIdx.get(d.toolCallId);
        const it = i === undefined ? undefined : items[i];
        if (!it || it.type !== 'tool') break;
        const failed = d.success === false;
        const res = isObj(d.result) ? d.result.content : undefined;
        const err = isObj(d.error) ? d.error.message : undefined;
        const out = failed ? err ?? res : res;
        it.failed = failed;
        it.output = typeof out === 'string' ? cut(out, lim.maxToolOutputChars) : undefined;
        break;
      }
      default:
        break;
    }
  }
  const total = items.length;
  const kept = total > lim.maxItems ? items.slice(total - lim.maxItems) : items;
  return { items: kept, total, truncated: total > kept.length };
}
