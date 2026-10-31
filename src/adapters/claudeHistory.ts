/**
 * Claude Code's previous sessions and their history (spec 012 FR-125, FR-126), read-only from Claude's own session files:
 * `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<folder slug>/<session id>.jsonl`. The parsers work on text (unit-tested on
 * synthetic files); the fs part reads with caps and never writes, copies or sends anything. The file format is Claude
 * Code's internal one (observed on 2.1.302, not documented): unknown lines are skipped, never trusted.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_HISTORY_LIMITS, cleanSessionTitle, cut, sameDir, toolLabel } from './history';
import type { HistoryItem, HistoryLimits, HistoryResult, PreviousSession } from './history';
import { isObj } from '../shared/guards';

export const HEAD_BYTES = 256 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 200;
const ID_RE = /^[A-Za-z0-9-]{8,80}$/;

/** Claude's project folder name for a working directory: every character other than A-Z, a-z, 0-9 becomes `-`. */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

const lines = (text: string): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l) as unknown;
      if (isObj(o)) out.push(o);
    } catch {
      /* a cut last line (head read) or a malformed line */
    }
  }
  return out;
};
const tsOf = (o: Record<string, unknown>): number | undefined => {
  const t = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
  return Number.isFinite(t) ? t : undefined;
};
/** A prompt the user typed (not a command wrapper, a system reminder or the interrupt marker). */
const typedPrompt = (o: Record<string, unknown>): string | undefined => {
  if (o.type !== 'user' || o.isSidechain === true || o.isMeta === true || !isObj(o.message)) return undefined;
  const c = o.message.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) && c.every((b) => isObj(b) && b.type === 'text') ? c.map((b) => String((b as { text?: unknown }).text ?? '')).join('\n') : undefined;
  const t = text?.trim();
  if (!t || t.startsWith('<') || t.startsWith('[Request interrupted')) return undefined;
  return t;
};

/** What the listing needs from the start of a session file. */
export interface ClaudeSessionHead {
  cwd?: string;
  title?: string;
  startTime?: number;
  branch?: string;
}

export function parseSessionHead(text: string): ClaudeSessionHead {
  const h: ClaudeSessionHead = {};
  let named: string | undefined;
  for (const o of lines(text)) {
    if (o.type === 'custom-title' && typeof o.customTitle === 'string') named = o.customTitle;
    else if (o.type === 'summary' && typeof o.summary === 'string' && !named) named = o.summary;
    if (o.type !== 'user' || o.isSidechain === true) continue;
    if (h.cwd === undefined && typeof o.cwd === 'string') h.cwd = o.cwd;
    if (h.startTime === undefined) h.startTime = tsOf(o);
    if (h.branch === undefined && typeof o.gitBranch === 'string' && o.gitBranch && o.gitBranch !== 'HEAD') h.branch = o.gitBranch; // `HEAD`: not a git folder (or detached)
    if (h.title === undefined) h.title = typedPrompt(o);
  }
  const title = cleanSessionTitle(named, 120) ?? cleanSessionTitle(h.title, 120);
  return { ...h, title };
}

/** One listed session from a file's head and its stat; undefined when it is not this folder's or not a session. */
export function sessionFromHead(id: string, head: ClaudeSessionHead, mtimeMs: number, cwd: string, platform: NodeJS.Platform = process.platform): PreviousSession | undefined {
  if (!ID_RE.test(id) || !head.cwd || !sameDir(head.cwd, cwd, platform)) return undefined;
  return { id, title: head.title ?? 'Untitled session', startTime: head.startTime ?? mtimeMs, modifiedTime: mtimeMs, branch: head.branch };
}

/** The chat history of a session file's text: prompts, assistant text, tool calls with a short result. Side-chain lines are skipped. */
export function claudeHistoryFromText(text: string, limits: Partial<HistoryLimits> = {}): HistoryResult {
  const lim = { ...DEFAULT_HISTORY_LIMITS, ...limits };
  const items: HistoryItem[] = [];
  const toolIdx = new Map<string, number>();
  for (const o of lines(text)) {
    if (o.isSidechain === true || !isObj(o.message)) continue;
    const content = o.message.content;
    if (o.type === 'user') {
      const p = typedPrompt(o);
      if (p) {
        items.push({ type: 'user', text: cut(p, lim.maxTextChars), ts: tsOf(o) });
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (!isObj(b) || b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
        const i = toolIdx.get(b.tool_use_id);
        const it = i === undefined ? undefined : items[i];
        if (!it || it.type !== 'tool') continue;
        const c = b.content;
        const out = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => isObj(x) && x.type === 'text').map((x) => String((x as { text?: unknown }).text ?? '')).join('\n') : '';
        it.failed = b.is_error === true;
        it.output = out ? cut(out, lim.maxToolOutputChars) : undefined;
      }
    } else if (o.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (!isObj(b)) continue;
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) items.push({ type: 'output', text: cut(b.text.trim(), lim.maxTextChars), ts: tsOf(o) });
        else if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
          toolIdx.set(b.id, items.length);
          items.push({ type: 'tool', callId: b.id, tool: b.name, label: toolLabel(b.input), ts: tsOf(o) });
        }
      }
    }
  }
  const total = items.length;
  const kept = total > lim.maxItems ? items.slice(total - lim.maxItems) : items;
  return { items: kept, total, truncated: total > kept.length };
}

/* ------------------------------------------------------------------ fs (read-only, capped) ------------------------------------------------------------------ */

function readHead(file: string, bytes: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** The folder's previous Claude sessions, newest first (FR-125). */
export function listClaudeSessions(cwd: string, exclude: ReadonlySet<string> = new Set(), configDir = claudeConfigDir()): PreviousSession[] {
  const dir = path.join(configDir, 'projects', claudeProjectSlug(cwd));
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const stats: { id: string; file: string; mtime: number; size: number }[] = [];
  for (const n of names) {
    const id = n.slice(0, -'.jsonl'.length);
    if (!ID_RE.test(id) || exclude.has(id)) continue;
    try {
      const st = fs.statSync(path.join(dir, n));
      if (st.isFile() && st.size > 0 && st.size <= MAX_FILE_BYTES) stats.push({ id, file: path.join(dir, n), mtime: st.mtimeMs, size: st.size });
    } catch {
      /* gone meanwhile */
    }
  }
  stats.sort((a, b) => b.mtime - a.mtime);
  const out: PreviousSession[] = [];
  for (const s of stats.slice(0, MAX_FILES)) {
    try {
      const p = sessionFromHead(s.id, parseSessionHead(readHead(s.file, HEAD_BYTES)), s.mtime, cwd);
      if (p) out.push(p);
    } catch {
      /* unreadable: left out */
    }
  }
  return out;
}

/** The session file of an id in any project folder (the folder is not known), or undefined. */
function findSessionFile(sessionId: string, configDir: string): string | undefined {
  const projects = path.join(configDir, 'projects');
  try {
    for (const d of fs.readdirSync(projects, { withFileTypes: true }).slice(0, 5000)) {
      const f = path.join(projects, d.name, `${sessionId}.jsonl`);
      if (d.isDirectory() && fs.existsSync(f)) return f;
    }
  } catch {
    /* no Claude data */
  }
  return undefined;
}

/** The chat history of one session (FR-126); empty when the file is missing, too large or unreadable. */
export function readClaudeHistory(sessionId: string, cwd: string | undefined, configDir = claudeConfigDir()): HistoryResult {
  const empty: HistoryResult = { items: [], total: 0, truncated: false };
  if (!ID_RE.test(sessionId)) return empty;
  const file = cwd !== undefined ? path.join(configDir, 'projects', claudeProjectSlug(cwd), `${sessionId}.jsonl`) : findSessionFile(sessionId, configDir);
  if (!file) return empty;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return empty;
    return claudeHistoryFromText(fs.readFileSync(file, 'utf8'));
  } catch {
    return empty;
  }
}
