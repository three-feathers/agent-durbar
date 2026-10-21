/**
 * Codex previous sessions, history replay and model list (spec 012 FR-141, FR-142): pure mappers from the app-server's
 * `thread/list`, `thread/read {includeTurns: true}` and `model/list` results (shapes as Codex 0.163 sends them, real
 * 2026-10-19) to Durbar's shapes. Server data is untrusted: every field is checked, text is capped, unknown items are skipped.
 */
import type { HistoryItem, HistoryResult, PreviousSession } from './history';
import { cleanSessionTitle, cleanTitle, sameDir } from './history';
import type { ModelOption } from '../shared/modelswitch';
import { isObj, nonEmptyStr as str } from '../shared/guards';

/** Codex sends seconds since the epoch; Durbar uses milliseconds. */
const ms = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? (v < 1e12 ? Math.round(v * 1000) : Math.round(v)) : 0);

export const MAX_LISTED = 200;
export const MAX_ITEMS = 300;
export const MAX_TEXT = 20_000;
export const MAX_OUTPUT = 2_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** `thread/list` `data` to previous sessions of this folder: same folder, not open now, not a sub-agent thread, newest first. */
export function codexPreviousSessions(
  data: unknown,
  cwd: string,
  exclude: ReadonlySet<string> = new Set(),
  platform: NodeJS.Platform = process.platform,
  realpath?: (p: string) => string,
): PreviousSession[] {
  if (!Array.isArray(data)) return [];
  const out: PreviousSession[] = [];
  for (const t of data.slice(0, MAX_LISTED * 4)) {
    if (!isObj(t)) continue;
    const id = str(t.id);
    const tcwd = str(t.cwd);
    if (!id || !ID.test(id) || exclude.has(id) || !tcwd || t.ephemeral === true || str(t.parentThreadId)) continue;
    if (!sameDir(tcwd, cwd, platform, realpath)) continue;
    const modifiedTime = ms(t.updatedAt) || ms(t.createdAt);
    const git = isObj(t.gitInfo) ? t.gitInfo : undefined;
    out.push({
      id,
      title: cleanSessionTitle(t.name, 120) ?? cleanTitle(t.preview),
      startTime: ms(t.createdAt) || modifiedTime,
      modifiedTime,
      branch: git && str(git.branch) && git.branch !== 'HEAD' ? (git.branch as string) : undefined,
    });
    if (out.length >= MAX_LISTED) break;
  }
  return out.sort((a, b) => b.modifiedTime - a.modifiedTime);
}

const textOf = (content: unknown): string =>
  Array.isArray(content) ? content.map((c) => (isObj(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('').trim() : '';
const cap = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s);

/** `thread/read {includeTurns: true}` `thread` to the chat replay: prompts, final answers, commands and file changes. */
export function codexHistory(thread: unknown): HistoryResult {
  const all: HistoryItem[] = [];
  const turns = isObj(thread) && Array.isArray(thread.turns) ? thread.turns : [];
  for (const turn of turns) {
    const items = isObj(turn) && Array.isArray(turn.items) ? turn.items : [];
    for (const it of items) {
      if (!isObj(it)) continue;
      if (it.type === 'userMessage') {
        const text = textOf(it.content);
        if (text) all.push({ type: 'user', text: cap(text, MAX_TEXT) });
      } else if (it.type === 'agentMessage') {
        const text = typeof it.text === 'string' ? it.text.trim() : '';
        if (text) all.push({ type: 'output', text: cap(text, MAX_TEXT) });
      } else if (it.type === 'commandExecution' && str(it.id)) {
        const out = typeof it.aggregatedOutput === 'string' ? it.aggregatedOutput : undefined;
        all.push({ type: 'tool', callId: it.id as string, tool: 'shell', label: cap(str(it.command) ?? 'command', 200), ...(out ? { output: cap(out, MAX_OUTPUT) } : {}), ...(it.status === 'failed' || it.status === 'declined' ? { failed: true } : {}) });
      } else if (it.type === 'fileChange' && str(it.id)) {
        const paths = Array.isArray(it.changes) ? it.changes.map((c) => (isObj(c) ? str(c.path) : undefined)).filter((p): p is string => !!p) : [];
        all.push({ type: 'tool', callId: it.id as string, tool: 'edit', label: cap(paths.join(', ') || 'file change', 200), ...(it.status === 'failed' || it.status === 'declined' ? { failed: true } : {}) });
      }
    }
  }
  const items = all.length > MAX_ITEMS ? all.slice(all.length - MAX_ITEMS) : all;
  return { items, total: all.length, truncated: all.length > MAX_ITEMS };
}

const EFFORT = /^[a-z][a-z0-9_-]{0,15}$/;

/** `model/list` `data` to the model picker: visible models, their reasoning efforts and default, Codex's default first. */
export function codexModelOptions(data: unknown): ModelOption[] {
  if (!Array.isArray(data)) return [];
  const out: Array<ModelOption & { isDefault: boolean }> = [];
  for (const m of data.slice(0, 50)) {
    if (!isObj(m) || m.hidden === true) continue;
    const id = str(m.model) ?? str(m.id);
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/.test(id) || out.some((x) => x.id === id)) continue;
    const efforts = Array.isArray(m.supportedReasoningEfforts)
      ? m.supportedReasoningEfforts.map((e) => (isObj(e) ? str(e.reasoningEffort) : str(e))).filter((e): e is string => !!e && EFFORT.test(e))
      : [];
    const def = str(m.defaultReasoningEffort);
    out.push({ id, name: cleanSessionTitle(m.displayName, 60) ?? id, efforts, defaultEffort: def && efforts.includes(def) ? def : undefined, disabled: false, isDefault: m.isDefault === true });
  }
  out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return out.map(({ isDefault: _d, ...o }) => o);
}
