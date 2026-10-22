/**
 * Slash entries (spec 073): the skills, commands and prompt files an agent app offers after "/", read by Durbar because its sessions
 * start the apps without their own settings and skill discovery (spec 012 Q8, spec 043, spec 061), so the apps do not know them.
 *
 * - `discoverSlash` lists entries from the places an adapter names (`claudeSlashPlaces`, `copilotSlashPlaces`, `codexSlashPlaces`):
 *   only inside the session's folders and the documented user directories, with real paths checked (no symbolic link leads out of
 *   its folder or user directory), at most 100 files per directory and 300 in all, files over 64 KB skipped, 8 KB read per file.
 * - `expandSlash` turns a message that starts with `/<name>` of a folder or user entry into that entry's text (FR-005).
 * - `SlashCache` keeps one discovery per set of places (30 s, unchanged directory mtimes) so a send never rescans: a message that is
 *   not `/<name>` causes no IO at all, and a `/<name>` one reads only that entry's file (review on #535).
 * - `cleanBuiltins` keeps the allow-listed app built-ins (FR-007).
 * No Electron, no shell, nothing executed; file contents are never logged. Unit tests: `npm run test:slashcommands`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cleanSessionTitle } from './history';
import { isInsideRoots } from './permissions';
import type { SlashCommand } from './types';

export const MAX_SLASH_PER_DIR = 100;
export const MAX_SLASH_FILES = 300;
export const MAX_SLASH_BYTES = 64 * 1024;
export const SLASH_HEAD_BYTES = 8 * 1024;
/** A command name (FR-001 / data model): a letter or digit first; `:` for Codex's `prompts:` names. */
export const SLASH_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const isSlashName = (n: unknown): n is string => typeof n === 'string' && SLASH_NAME.test(n) && !n.includes('..');

/** Front matter (`---` lines at the top) and the body after it. Lists (`- item` under an empty key) go to `lists`. */
export interface FrontMatter {
  fm: Record<string, string>;
  lists: Record<string, string[]>;
  body: string;
}

/** Reads a Markdown file's `---` front matter (simple `key: value` lines and `- item` lists), shared with `parseClaudeAgent` (spec 043). */
export function parseFrontMatter(text: string): FrontMatter {
  const t = text.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(t);
  const head = m ? m[1] : '';
  const body = m ? m[2] : t;
  const fm: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let listKey = '';
  for (const line of head.split(/\r?\n/)) {
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (item && listKey) {
      (lists[listKey] ??= []).push(item[1].trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    listKey = kv[2].trim() === '' ? kv[1] : '';
    fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fm, lists, body };
}

/** Where an app keeps one kind of entry. `root` is the directory the entries must stay inside (the folder, or the user directory). */
export interface SlashPlace {
  dir: string;
  root: string;
  scope: 'folder' | 'user';
  kind: 'skill' | 'command' | 'prompt';
  /** `skill-dirs`: `<dir>/<name>/SKILL.md`; `md-files`: `<dir>/<name>.md`. */
  layout: 'skill-dirs' | 'md-files';
  /** Put before the file name (Codex: `prompts:`). */
  prefix?: string;
  /** How `root` is shown: `''` for the only folder, the folder's name in a workspace, `~/.claude` for a user directory. */
  whereBase: string;
}

/** An entry as main keeps it: the normalized fields plus the real file and the root it was checked against (never sent to the window). */
export interface SlashEntry extends SlashCommand {
  file?: string;
  root?: string;
  dir?: string;
}

export interface SlashFs {
  realpath(p: string): string;
  lstat(p: string): { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number };
  readdir(p: string): string[];
  /** At most `max` bytes of a file, as UTF-8; throws when the file is larger than `limit`. */
  readHead(p: string, max: number, limit: number): string;
  /** A directory's modification time (follows links); throws when it is missing. Used only to check a cached discovery. */
  mtime(p: string): number;
}

const realFs: SlashFs = {
  realpath: (p) => fs.realpathSync(p),
  lstat: (p) => fs.lstatSync(p),
  readdir: (p) => fs.readdirSync(p),
  readHead: (p, max, limit) => {
    const fd = fs.openSync(p, 'r');
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > limit) throw new Error('too large');
      const buf = Buffer.alloc(Math.min(max, st.size));
      const n = buf.length ? fs.readSync(fd, buf, 0, buf.length, 0) : 0;
      return buf.subarray(0, n).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  },
  mtime: (p) => fs.statSync(p).mtimeMs,
};

export interface DiscoverOptions {
  fs?: SlashFs;
  caseInsensitive?: boolean;
}

const oneLine = (v: unknown, max: number): string | undefined => cleanSessionTitle(v, max);

/** The real path of `p` when it stays inside `root` (both real), else undefined. */
function inside(p: string, root: string, o: Required<DiscoverOptions>): string | undefined {
  let real: string;
  let realRoot: string;
  try {
    real = o.fs.realpath(p);
    realRoot = o.fs.realpath(root);
  } catch {
    return undefined;
  }
  return isInsideRoots(real, [realRoot], { realpath: (x) => x, caseInsensitive: o.caseInsensitive }) ? real : undefined;
}

const whereOf = (place: SlashPlace, file: string): string => {
  const rel = path.relative(place.root, file).split(path.sep).join('/');
  return place.whereBase ? `${place.whereBase.replace(/\/+$/, '')}/${rel}` : rel;
};

/** Lists the entries of the given places in order; the first entry of a name wins (folder before user, FR-003). */
export function discoverSlash(places: readonly SlashPlace[], opts: DiscoverOptions = {}): SlashEntry[] {
  const o: Required<DiscoverOptions> = { fs: opts.fs ?? realFs, caseInsensitive: opts.caseInsensitive ?? (process.platform === 'win32' || process.platform === 'darwin') };
  const out = new Map<string, SlashEntry>();
  let files = 0;
  for (const place of places) {
    if (files >= MAX_SLASH_FILES) break;
    const dir = inside(place.dir, place.root, o);
    if (!dir) continue;
    let names: string[];
    try {
      names = o.fs.readdir(dir).sort();
    } catch {
      continue;
    }
    let inDir = 0;
    const group: SlashEntry[] = [];
    for (const n of names) {
      if (inDir >= MAX_SLASH_PER_DIR || files >= MAX_SLASH_FILES) break;
      if (n.startsWith('.')) continue;
      let candidate: string;
      if (place.layout === 'skill-dirs') candidate = path.join(dir, n, 'SKILL.md');
      else if (n.toLowerCase().endsWith('.md')) candidate = path.join(dir, n);
      else continue;
      inDir++;
      files++;
      const file = inside(candidate, place.root, o);
      if (!file) continue;
      let text: string;
      try {
        const st = o.fs.lstat(file);
        if (!st.isFile() || st.size > MAX_SLASH_BYTES) continue;
        text = o.fs.readHead(file, SLASH_HEAD_BYTES, MAX_SLASH_BYTES);
      } catch {
        continue;
      }
      const { fm } = parseFrontMatter(text);
      if (/^false$/i.test(fm['user-invocable'] ?? '')) continue;
      const base = place.layout === 'skill-dirs' ? n : n.replace(/\.md$/i, '');
      const own = place.kind === 'skill' && fm.name ? fm.name.trim() : base;
      const name = (place.prefix ?? '') + own;
      if (!isSlashName(name)) continue;
      const description = oneLine(fm.description, 200);
      const argumentHint = oneLine(fm['argument-hint'], 80);
      group.push({
        name,
        ...(description ? { description } : {}),
        ...(argumentHint ? { argumentHint } : {}),
        source: place.scope,
        kind: place.kind,
        where: whereOf(place, path.join(place.dir, path.relative(dir, file))),
        file,
        root: place.root,
        dir: path.dirname(file),
      });
    }
    group.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    for (const e of group) if (!out.has(e.name.toLowerCase())) out.set(e.name.toLowerCase(), e);
  }
  return orderSlash([...out.values()]);
}

const RANK: Record<SlashCommand['source'], number> = { folder: 0, user: 1, app: 2 };
/** Folder, then user, then app; by name inside a group (stable for entries already in folder order). */
export function orderSlash<T extends SlashCommand>(list: readonly T[]): T[] {
  return list
    .map((e, i) => ({ e, i }))
    .sort((a, b) => RANK[a.e.source] - RANK[b.e.source] || (a.e.source === 'folder' && b.e.source === 'folder' ? a.i - b.i : a.e.name.localeCompare(b.e.name, 'en', { sensitivity: 'base' })))
    .map((x) => x.e);
}

/** Merges groups; the first entry of a name (case-insensitive) wins, then orders (FR-003). */
export function mergeSlash<T extends SlashCommand>(...groups: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const g of groups) for (const e of g) if (!seen.has(e.name.toLowerCase())) { seen.add(e.name.toLowerCase()); out.push(e); }
  return orderSlash(out);
}

/**
 * FR-007 (constitution III): the only Claude Code built-ins Durbar offers, and only when the CLI lists them. Checked, harmless names:
 * `context` real: (run by the CLI, no model call); the others read: (Claude Code's docs and `initialize` list). Anything else, including
 * a built-in a later Claude Code adds (`sandbox`, `add-dir`, `hooks`, ...), is not offered. Typing one by hand still sends it.
 */
export const BUILTIN_ALLOW: ReadonlySet<string> = new Set(['compact', 'context', 'cost', 'init', 'review', 'security-review']);

/** FR-006/FR-007: an app's built-in list (Claude's `initialize` `commands`) as entries, only the allow-listed ones. */
export function cleanBuiltins(list: unknown): SlashEntry[] {
  if (!Array.isArray(list)) return [];
  const out: SlashEntry[] = [];
  for (const c of list.slice(0, 500)) {
    if (!c || typeof c !== 'object') continue;
    const r = c as { name?: unknown; description?: unknown; argumentHint?: unknown };
    const name = typeof r.name === 'string' ? r.name.replace(/^\//, '') : '';
    if (!isSlashName(name) || !BUILTIN_ALLOW.has(name.toLowerCase())) continue;
    const description = oneLine(r.description, 200);
    if (description && /^\(removed\)|^renamed to /i.test(description)) continue;
    const argumentHint = oneLine(r.argumentHint, 80);
    out.push({ name, ...(description ? { description } : {}), ...(argumentHint ? { argumentHint } : {}), source: 'app', kind: 'builtin' });
  }
  return out;
}

const SLASH_LINE = /^\/([A-Za-z0-9][A-Za-z0-9._:-]{0,63})(?:\s+([\s\S]*))?$/;

/** The text an entry's file expands to (FR-005), or undefined when the file cannot be read again. */
export function expansionOf(e: SlashEntry, rest: string, opts: DiscoverOptions = {}): string | undefined {
  if (!e.file || !e.root || e.source === 'app') return undefined;
  const o: Required<DiscoverOptions> = { fs: opts.fs ?? realFs, caseInsensitive: opts.caseInsensitive ?? (process.platform === 'win32' || process.platform === 'darwin') };
  const file = inside(e.file, e.root, o);
  if (!file) return undefined;
  let text: string;
  try {
    text = o.fs.readHead(file, MAX_SLASH_BYTES, MAX_SLASH_BYTES);
  } catch {
    return undefined;
  }
  const body = parseFrontMatter(text).body.trim();
  const args = rest.trim();
  if (e.kind === 'skill') {
    return `Use the "${e.name}" skill below. Its folder is ${e.dir ?? path.dirname(file)}.\n\n${body}${args ? `\n\nARGUMENTS: ${args}` : ''}`;
  }
  const words = args ? args.split(/\s+/) : [];
  let used = false;
  const out = body.replace(/\$(ARGUMENTS|[1-9])\b/g, (_m, k: string) => {
    used = true;
    return k === 'ARGUMENTS' ? args : (words[Number(k) - 1] ?? '');
  });
  return used || !args ? out : `${out}\n\nARGUMENTS: ${args}`;
}

/**
 * FR-005: a message that starts with `/<name>` of a folder or user entry becomes that entry's text; `where` is shown in the chat.
 * Built-ins, unknown names and unreadable files give undefined (the typed text is sent unchanged).
 */
export function expandSlash(text: string, entries: readonly SlashEntry[], opts: DiscoverOptions = {}): { text: string; where: string } | undefined {
  const m = SLASH_LINE.exec(String(text ?? '').trim());
  if (!m) return undefined;
  const e = entries.find((x) => x.source !== 'app' && x.name.toLowerCase() === m[1].toLowerCase());
  if (!e) return undefined;
  const out = expansionOf(e, m[2] ?? '', opts);
  return out === undefined ? undefined : { text: out, where: e.where ?? e.name };
}

const placesKey = (places: readonly SlashPlace[]): string => JSON.stringify(places.map((p) => [p.dir, p.root, p.scope, p.kind, p.layout, p.prefix ?? '', p.whereBase]));

/**
 * One discovery per set of places (a folder or workspace and its user directories), FR-002 / FR-005 (review on #535). `list` with
 * `refresh` (the window opening the list) always reads afresh; otherwise a discovery under `ttlMs` old whose place directories still
 * have the same mtimes is reused. `expand` tests the `/name` line pattern first, so a message like "hi" causes no IO at all.
 */
export class SlashCache {
  private readonly cache = new Map<string, { at: number; stamps: number[]; entries: SlashEntry[] }>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly opts: DiscoverOptions;
  private readonly max: number;
  constructor(o: DiscoverOptions & { ttlMs?: number; now?: () => number; max?: number } = {}) {
    this.ttlMs = o.ttlMs ?? 30_000;
    this.now = o.now ?? Date.now;
    this.opts = { ...(o.fs ? { fs: o.fs } : {}), ...(o.caseInsensitive !== undefined ? { caseInsensitive: o.caseInsensitive } : {}) };
    this.max = o.max ?? 32;
  }
  private stamps(places: readonly SlashPlace[]): number[] {
    const f = this.opts.fs ?? realFs;
    return places.map((p) => {
      try {
        return f.mtime(p.dir);
      } catch {
        return -1;
      }
    });
  }
  list(places: readonly SlashPlace[], o: { refresh?: boolean } = {}): SlashEntry[] {
    const key = placesKey(places);
    const hit = this.cache.get(key);
    const stamps = this.stamps(places);
    if (!o.refresh && hit && this.now() - hit.at < this.ttlMs && hit.stamps.every((v, i) => v === stamps[i])) return hit.entries;
    const entries = discoverSlash(places, this.opts);
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), stamps, entries });
    while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value as string); // oldest set of places first
    return entries;
  }
  /** FR-005: `expandSlash` over the cached entries; no IO unless the text is a `/name` line. */
  expand(text: string, places: () => readonly SlashPlace[]): { text: string; where: string } | undefined {
    if (!slashLineName(text)) return undefined;
    return expandSlash(text, this.list(places()), this.opts);
  }
}

/** The `<name>` of a message that starts with `/<name>` (the FR-005 line pattern), else undefined. No IO. */
export function slashLineName(text: unknown): string | undefined {
  const m = SLASH_LINE.exec(String(text ?? '').trim());
  return m ? m[1] : undefined;
}

/** `~/…` for a path under the home folder, else the path's last two parts (never a full absolute path in the window). */
export function displayBase(dir: string, home = os.homedir()): string {
  const rel = path.relative(home, dir);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return '~/' + rel.split(path.sep).join('/');
  return dir.split(/[\\/]+/).filter(Boolean).slice(-2).join('/');
}

const folderBase = (roots: readonly string[], f: string): string => (roots.length > 1 ? path.basename(f) : '');
const uniq = (roots: readonly string[]): string[] => [...new Set(roots.filter((r) => typeof r === 'string' && r))];

/** FR-004 Claude Code: each folder's `.claude/skills` and `.claude/commands`, then the user's under `CLAUDE_CONFIG_DIR` (default `~/.claude`). */
export function claudeSlashPlaces(roots: readonly string[], configDir: string, home = os.homedir()): SlashPlace[] {
  const rs = uniq(roots);
  const out: SlashPlace[] = [];
  for (const f of rs) {
    out.push({ dir: path.join(f, '.claude', 'skills'), root: f, scope: 'folder', kind: 'skill', layout: 'skill-dirs', whereBase: folderBase(rs, f) });
    out.push({ dir: path.join(f, '.claude', 'commands'), root: f, scope: 'folder', kind: 'command', layout: 'md-files', whereBase: folderBase(rs, f) });
  }
  const ub = displayBase(configDir, home);
  out.push({ dir: path.join(configDir, 'skills'), root: configDir, scope: 'user', kind: 'skill', layout: 'skill-dirs', whereBase: ub });
  out.push({ dir: path.join(configDir, 'commands'), root: configDir, scope: 'user', kind: 'command', layout: 'md-files', whereBase: ub });
  return out;
}

/** The Copilot CLI's home: `COPILOT_HOME` replaces the whole `~/.copilot` path (GitHub's config-dir reference, read:). */
export function copilotHomeDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return env.COPILOT_HOME || path.join(home, '.copilot');
}

/**
 * FR-004 GitHub Copilot CLI: each folder's `.github/skills`, `.claude/skills`, `.agents/skills`; the user's `$COPILOT_HOME/skills`
 * (default `~/.copilot`) and `~/.agents/skills`.
 */
export function copilotSlashPlaces(roots: readonly string[], copilotHome: string, home = os.homedir()): SlashPlace[] {
  const rs = uniq(roots);
  const out: SlashPlace[] = [];
  for (const f of rs) for (const d of ['.github', '.claude', '.agents']) out.push({ dir: path.join(f, d, 'skills'), root: f, scope: 'folder', kind: 'skill', layout: 'skill-dirs', whereBase: folderBase(rs, f) });
  for (const root of [copilotHome, path.join(home, '.agents')]) {
    out.push({ dir: path.join(root, 'skills'), root, scope: 'user', kind: 'skill', layout: 'skill-dirs', whereBase: displayBase(root, home) });
  }
  return out;
}

/** FR-004 Codex: each folder's `.agents/skills`; the user's `~/.agents/skills`, `$CODEX_HOME/skills` and `$CODEX_HOME/prompts` (as `prompts:<name>`). */
export function codexSlashPlaces(roots: readonly string[], codexHome: string, home = os.homedir()): SlashPlace[] {
  const rs = uniq(roots);
  const out: SlashPlace[] = rs.map((f) => ({ dir: path.join(f, '.agents', 'skills'), root: f, scope: 'folder' as const, kind: 'skill' as const, layout: 'skill-dirs' as const, whereBase: folderBase(rs, f) }));
  const agents = path.join(home, '.agents');
  const cb = displayBase(codexHome, home);
  out.push({ dir: path.join(agents, 'skills'), root: agents, scope: 'user', kind: 'skill', layout: 'skill-dirs', whereBase: displayBase(agents, home) });
  out.push({ dir: path.join(codexHome, 'skills'), root: codexHome, scope: 'user', kind: 'skill', layout: 'skill-dirs', whereBase: cb });
  out.push({ dir: path.join(codexHome, 'prompts'), root: codexHome, scope: 'user', kind: 'prompt', layout: 'md-files', prefix: 'prompts:', whereBase: cb });
  return out;
}

/** What crosses to the window (FR-001, FR-010): the normalized fields only, strings re-checked and cut; at most 300. */
export function publicSlash(list: readonly SlashCommand[]): SlashCommand[] {
  const out: SlashCommand[] = [];
  const SOURCES = new Set(['folder', 'user', 'app']);
  const KINDS = new Set(['skill', 'command', 'prompt', 'builtin']);
  for (const e of list) {
    if (out.length >= MAX_SLASH_FILES) break;
    if (!e || !isSlashName(e.name) || !SOURCES.has(e.source) || !KINDS.has(e.kind)) continue;
    const description = oneLine(e.description, 200);
    const argumentHint = oneLine(e.argumentHint, 80);
    const where = typeof e.where === 'string' && !path.isAbsolute(e.where) && !/^[A-Za-z]:/.test(e.where) ? oneLine(e.where, 160) : undefined;
    out.push({ name: e.name, ...(description ? { description } : {}), ...(argumentHint ? { argumentHint } : {}), source: e.source, kind: e.kind, ...(where ? { where } : {}) });
  }
  return out;
}
