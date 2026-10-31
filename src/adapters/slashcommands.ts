/**
 * Slash entries (spec 073): the skills, commands and prompt files an agent app offers after "/", read by Durbar because its sessions
 * start the apps without their own settings and skill discovery (spec 012 Q8, spec 043, spec 061), so the apps do not know them.
 *
 * - `discoverSlash` lists entries from the places an adapter names (`claudeSlashPlaces`, `copilotSlashPlaces`, `codexSlashPlaces`):
 *   only inside the session's folders and the documented user directories, with real paths checked (no symbolic link leads out of
 *   its folder or user directory; the real file is `SKILL.md` or `*.md` and not under `.git`), at most 100 files per directory and 300 in all, files over 64 KB skipped, 8 KB read per file.
 * - `expandSlash` turns a message that starts with `/<name>` of a folder or user entry into that entry's text (FR-005).
 * - `SlashCache` keeps one discovery per set of places (30 s, unchanged directory mtimes) so a send never rescans: a message that is
 *   not `/<name>` causes no IO at all, and a `/<name>` one reads only that entry's file (review on #535).
 * - `cleanBuiltins` keeps the allow-listed app built-ins (FR-007).
 * - VS Code prompt files (`*.prompt.md`, FR-012, delta 2026-10-23): listed for every app from each folder's `.github/prompts` and VS Code's
 *   user prompt folders (`vscodeUserPromptDirs`); `fillPromptFile` fills `${input:…}`; settings in the front matter are named, not applied.
 * No Electron, no shell, nothing executed; file contents are never logged. Unit tests: `npm run test:slashcommands`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cleanSessionTitle } from './history';
import { isInsideRoots } from './permissions';
import { redact, redactMarkdown } from '../shared/redact';
import { readCapped } from '../shared/cappedread';
import type { SlashCommand, SlashExpansion } from './types';

export const MAX_SLASH_PER_DIR = 100;
export const MAX_SLASH_FILES = 300;
export const MAX_SLASH_BYTES = 64 * 1024;
/** The most an expanded entry may grow to (review on #615): over it, nothing is expanded and the line is sent as typed, with a note. */
export const MAX_SLASH_EXPANDED = 256 * 1024;
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
  /** `skill-dirs`: `<dir>/<name>/SKILL.md`; `md-files`: `<dir>/<name>.md`; `prompt-files`: VS Code prompt files `<dir>/<name>.prompt.md`. */
  layout: 'skill-dirs' | 'md-files' | 'prompt-files';
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
  /** A VS Code prompt file (`*.prompt.md`, 2026-10-23 delta): its real file must keep that suffix, and it expands `${input:…}` too. */
  vscode?: true;
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
    // the shared read (issue #917): never blocks, never follows a final link, regular file with one link, at most `limit` bytes (review on #535)
    const r = readCapped(fs, fs.constants, p, limit);
    if (!r.ok) throw new Error(r.code === 'not-file' || r.code === 'too-big' ? 'too large' : `cannot read (${r.code})`);
    return r.buf.subarray(0, Math.min(max, r.buf.length)).toString('utf8');
  },
  mtime: (p) => fs.statSync(p).mtimeMs,
};

export interface DiscoverOptions {
  fs?: SlashFs;
  caseInsensitive?: boolean;
}

/* FR-014 (issue #608; review of PR #614): everything `redact` knows (token shapes, credentials in a URL, an `authorization:` value, the
   environment's secret values) is masked BEFORE the cut, so no half secret (which no pattern knows) reaches the window. Markdown can split
   a token (`gh`+backtick+`p_...`, `ghp_<20>**K1l2...**`) or glue it to a word (`x**ghp_...**`): `redactMarkdown` masks the text with
   the Markdown marks removed AND everything the raw pass finds (the same rule as the window's DurbarSafeText, spec 041 FR-065). */
const MD_ESC = /\\([\\`*_{}\[\]()#+\-.!~|<>])/g;
const MD_MARKS = /[*`~[\]]/g;
export function maskSlashText(s: string): string {
  const u = s.replace(MD_ESC, '$1');
  if (!/[*`~[\]]/.test(u)) return redact(u);
  const k = u.replace(MD_MARKS, '');
  const m = redactMarkdown(u, k);
  return m !== k ? m : redact(u);
}
/** One line, secrets masked (redact), then cut to `max` (FR-003, FR-010, FR-014). */
const oneLine = (v: unknown, max: number): string | undefined => {
  const s = cleanSessionTitle(v, Number.MAX_SAFE_INTEGER);
  return s === undefined ? undefined : cleanSessionTitle(maskSlashText(s), max);
};

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

/**
 * FR-002 (review on #535): the real path of an entry's file when it stays inside `root`, is not under a `.git` folder and is named
 * `SKILL.md` (skills) or `*.md` (commands, prompts), checked on the real target so a link such as `review.md -> ../../.env` is refused.
 * Used by discovery and again by expansion.
 */
function entryFile(p: string, root: string, kind: SlashCommand['kind'], o: Required<DiscoverOptions>, vscode = false): string | undefined {
  let real: string;
  let realRoot: string;
  try {
    real = o.fs.realpath(p);
    realRoot = o.fs.realpath(root);
  } catch {
    return undefined;
  }
  if (!isInsideRoots(real, [realRoot], { realpath: (x) => x, caseInsensitive: o.caseInsensitive })) return undefined;
  const fold = (x: string): string => (o.caseInsensitive ? x.toLowerCase() : x);
  if (path.relative(realRoot, real).split(/[\\/]+/).some((part) => fold(part) === '.git')) return undefined;
  const base = path.basename(real);
  const named = kind === 'skill' ? fold(base) === fold('SKILL.md') : base.toLowerCase().endsWith(vscode ? PROMPT_SUFFIX : '.md');
  return named ? real : undefined;
}

/** The suffix of a VS Code prompt file (`.github/prompts/<name>.prompt.md`, VS Code docs `read:`). */
export const PROMPT_SUFFIX = '.prompt.md';
/** VS Code prompt-file front-matter keys that change how VS Code runs the prompt; Durbar shows them but cannot apply them ([KNOWN GAP]). */
export const VSCODE_PROMPT_SETTINGS = ['mode', 'agent', 'model', 'tools'] as const;
const INPUT_VAR = /\$\{input:([A-Za-z_][\w-]{0,63})(?::([^}\r\n]{0,200}))?\}/g;

/** The `${input:name}` / `${input:name:placeholder}` variables of a prompt file's body, first appearance first, each name once. */
export function promptInputs(body: string): { name: string; placeholder?: string }[] {
  const out: { name: string; placeholder?: string }[] = [];
  for (const m of body.matchAll(INPUT_VAR)) if (!out.some((x) => x.name === m[1])) out.push({ name: m[1], ...(m[2] ? { placeholder: m[2].trim() } : {}) });
  return out;
}

/** The VS Code settings a prompt file's front matter names (`mode`, `agent`, `model`, `tools`), which Durbar does not apply. */
export function promptSettings(fm: Record<string, string>): string[] {
  return VSCODE_PROMPT_SETTINGS.filter((k) => Object.prototype.hasOwnProperty.call(fm, k));
}

/**
 * A VS Code prompt file's body for the line's arguments (2026-10-23 delta, FR-005): `${input:name}` and `${input:name:placeholder}` get
 * `name=value` words first, then the other words in order (the last variable left takes the rest of the line); `$ARGUMENTS` and
 * `$1`..`$9` as for any command; when nothing took the arguments they follow as `ARGUMENTS: …`. Any other `${…}` (`${selection}`,
 * `${file}`, an input with no value) stays as written and is named in `left`.
 */
export function fillPromptFile(body: string, rest: string, cap = MAX_SLASH_EXPANDED): { text: string; left: string[] } | undefined {
  const args = rest.trim();
  const tokens: string[] = [];
  for (const m of args.matchAll(/(?:[^\s"]+|"[^"]*")+/g)) tokens.push(m[0].replace(/"([^"]*)"/g, '$1')); // words; "a b" is one word
  const inputs = promptInputs(body).map((x) => x.name);
  const value = new Map<string, string>();
  const positional: string[] = [];
  for (const t of tokens) {
    const kv = /^([A-Za-z_][\w-]{0,63})=([\s\S]*)$/.exec(t);
    const key = kv ? inputs.find((n) => n === kv[1]) ?? inputs.find((n) => n.toLowerCase() === kv[1].toLowerCase()) : undefined;
    if (kv && key && !value.has(key)) value.set(key, kv[2]);
    else positional.push(t);
  }
  const open = inputs.filter((n) => !value.has(n));
  open.forEach((n, i) => {
    if (!positional.length) return;
    value.set(n, i === open.length - 1 ? positional.splice(0).join(' ') : (positional.shift() as string));
  });
  let used = value.size > 0;
  const words = args ? args.split(/\s+/) : [];
  const left: string[] = [];
  const keep = (m: string, inner: string): string => {
    const shown = /^[A-Za-z_][\w.:-]{0,40}$/.test(inner) ? '${' + inner + '}' : '${…}'; // only plain names are echoed back in the note
    if (!left.includes(shown) && left.length < 6) left.push(shown);
    return m;
  };
  // one pass over the file's own text, so the user's words are never read as placeholders themselves; the size is counted on the
  // way and the pass stops as soon as it would pass the cap (review on #615: 6,500 placeholders x a 10 KB argument = 66 M characters)
  let out: string;
  try {
    const grow = sizeGuard(cap);
    out = body.replace(new RegExp(`${INPUT_VAR.source}|\\$\\{([^}\\r\\n]{1,80})\\}|\\$(ARGUMENTS|[1-9])\\b`, 'g'), (m: string, n: string | undefined, _ph: string | undefined, other: string | undefined, k: string | undefined, at: number) => {
      if (n !== undefined) return grow(m, value.has(n) ? (value.get(n) as string) : keep(m, m.slice(2, -1)), at);
      if (other !== undefined) return keep(m, other);
      used = true;
      return grow(m, k === 'ARGUMENTS' ? args : (words[Number(k) - 1] ?? ''), at);
    });
  } catch (err) {
    if (err instanceof TooLarge) return undefined;
    throw err;
  }
  const text = used || !args ? out : `${out}\n\nARGUMENTS: ${args}`;
  return text.length > cap ? undefined : { text, left };
}

class TooLarge extends Error {}
/**
 * Counts the output of a `replace` as it goes and throws `TooLarge` the moment the part already built (everything up to the end of
 * this replacement) passes `cap`, so nothing huge is built. That part only grows, so passing the cap there means the whole output
 * would pass it too; a body that shrinks (long placeholders, short words) is never refused early. The caller checks the total at the end.
 */
function sizeGuard(cap: number): (match: string, replacement: string, offset: number) => string {
  let delta = 0;
  return (match, replacement, offset) => {
    delta += replacement.length - match.length;
    if (offset + match.length + delta > cap) throw new TooLarge();
    return replacement;
  };
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
      const vscode = place.layout === 'prompt-files';
      if (place.layout === 'skill-dirs') candidate = path.join(dir, n, 'SKILL.md');
      else if (n.toLowerCase().endsWith(vscode ? PROMPT_SUFFIX : '.md')) candidate = path.join(dir, n);
      else continue;
      inDir++;
      files++;
      const file = entryFile(candidate, place.root, place.kind, o, vscode);
      if (!file) continue;
      let text: string;
      try {
        const st = o.fs.lstat(file);
        if (!st.isFile() || st.size > MAX_SLASH_BYTES) continue;
        text = o.fs.readHead(file, SLASH_HEAD_BYTES, MAX_SLASH_BYTES);
      } catch {
        continue;
      }
      const { fm, body } = parseFrontMatter(text);
      if (/^false$/i.test(fm['user-invocable'] ?? '')) continue;
      const base = place.layout === 'skill-dirs' ? n : vscode ? n.slice(0, -PROMPT_SUFFIX.length) : n.replace(/\.md$/i, '');
      // a VS Code prompt file may rename itself with `name` (VS Code docs); one that is not a safe command name keeps the file's name
      const own = place.kind === 'skill' && fm.name ? fm.name.trim() : vscode && fm.name && isSlashName(fm.name.trim()) ? fm.name.trim() : base;
      const name = (place.prefix ?? '') + own;
      if (!isSlashName(name)) continue;
      // VS Code settings (mode, agent, model, tools) are shown, not applied ([KNOWN GAP]); the hint keeps its room in the description
      const unapplied = vscode ? promptSettings(fm) : [];
      const note = unapplied.length ? ` (VS Code settings not applied: ${unapplied.join(', ')})` : '';
      const own200 = oneLine(fm.description, 200 - note.length);
      const description = note ? (own200 ? own200 + note : note.trim().slice(1, -1)) : own200;
      const inputs = vscode && !fm['argument-hint'] ? promptInputs(body) : [];
      const argumentHint = oneLine(fm['argument-hint'] || inputs.map((x) => `<${x.placeholder || x.name}>`).join(' '), 80);
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
        ...(vscode ? { vscode: true as const } : {}),
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
  const r = expansionWithNote(e, rest, opts);
  return r && 'text' in r ? r.text : undefined;
}

/**
 * `expansionOf` plus a note for the chat (a VS Code prompt file: settings not applied, variables left as written). `tooLarge`: the
 * expansion would pass `MAX_SLASH_EXPANDED` (review on #615), for every kind (skill, command, prompt, VS Code prompt file).
 */
export function expansionWithNote(e: SlashEntry, rest: string, opts: DiscoverOptions = {}, cap = MAX_SLASH_EXPANDED): { text: string; note?: string } | { tooLarge: true } | undefined {
  if (!e.file || !e.root || e.source === 'app') return undefined;
  const o: Required<DiscoverOptions> = { fs: opts.fs ?? realFs, caseInsensitive: opts.caseInsensitive ?? (process.platform === 'win32' || process.platform === 'darwin') };
  const file = entryFile(e.file, e.root, e.kind, o, !!e.vscode); // every FR-002 rule again: the file may have been swapped since the list was made
  if (!file) return undefined;
  let text: string;
  try {
    text = o.fs.readHead(file, MAX_SLASH_BYTES, MAX_SLASH_BYTES);
  } catch {
    return undefined;
  }
  const { fm, body: raw } = parseFrontMatter(text);
  const body = raw.trim();
  const args = rest.trim();
  const tooLarge = { tooLarge: true as const };
  if (e.kind === 'skill') {
    const head = `Use the "${e.name}" skill below. Its folder is ${e.dir ?? path.dirname(file)}.\n\n`;
    if (head.length + body.length + (args ? args.length + 13 : 0) > cap) return tooLarge; // measured before it is built
    return { text: `${head}${body}${args ? `\n\nARGUMENTS: ${args}` : ''}` };
  }
  if (e.vscode) {
    const f = fillPromptFile(body, args, cap);
    if (!f) return tooLarge;
    const { text: filled, left } = f;
    const settings = promptSettings(fm);
    const notes = [
      ...(settings.length ? [`VS Code settings not applied: ${settings.join(', ')}`] : []),
      ...(left.length ? [`left as written: ${left.join(', ')}`] : []),
    ];
    return { text: filled, ...(notes.length ? { note: notes.join('; ') + '.' } : {}) };
  }
  const words = args ? args.split(/\s+/) : [];
  let used = false;
  let out: string;
  try {
    const grow = sizeGuard(cap); // stops the pass as soon as it would pass the cap (review on #615)
    out = body.replace(/\$(ARGUMENTS|[1-9])\b/g, (m: string, k: string, at: number) => {
      used = true;
      return grow(m, k === 'ARGUMENTS' ? args : (words[Number(k) - 1] ?? ''), at);
    });
  } catch (err) {
    if (err instanceof TooLarge) return tooLarge;
    throw err;
  }
  const done = used || !args ? out : `${out}\n\nARGUMENTS: ${args}`;
  return done.length > cap ? tooLarge : { text: done };
}

/**
 * FR-005: a message that starts with `/<name>` of a folder or user entry becomes that entry's text; `where` is shown in the chat.
 * Built-ins, unknown names and unreadable files give undefined (the typed text is sent unchanged).
 */
export function expandSlash(text: string, entries: readonly SlashEntry[], opts: DiscoverOptions = {}): SlashExpansion | undefined {
  const m = SLASH_LINE.exec(String(text ?? '').trim());
  if (!m) return undefined;
  const e = entries.find((x) => x.source !== 'app' && x.name.toLowerCase() === m[1].toLowerCase());
  if (!e) return undefined;
  const out = expansionWithNote(e, m[2] ?? '', opts);
  if (out === undefined) return undefined;
  const where = e.where ?? e.name;
  // over the cap: the line goes as typed, and the chat says why (review on #615)
  if ('tooLarge' in out) return { text: String(text ?? ''), where, asTyped: true, note: `Not expanded: the text of ${where} with these words would be over ${MAX_SLASH_EXPANDED / 1024} KB, so the line was sent as typed.` };
  // the note echoes `${input:NAME}` names (up to 41 characters): masked here too, so a token-shaped name never reaches the chat (FR-014)
  return { text: out.text, where, ...(out.note ? { note: redact(out.note) } : {}) };
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
  expand(text: string, places: () => readonly SlashPlace[]): SlashExpansion | undefined {
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

/**
 * VS Code's user prompt-file folders (2026-10-23 delta): `prompts` in VS Code's user data folder `Code/User` (VS Code docs, settings
 * file locations, `read:`): `%APPDATA%` on Windows, `~/Library/Application Support` on macOS, `$XDG_CONFIG_HOME` (default `~/.config`)
 * on Linux; VS Code Insiders (`Code - Insiders`) too. Only the default profile's folder (a named profile keeps its own, [KNOWN GAP]).
 */
export function vscodeUserPromptDirs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = os.homedir()): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  // every base from the environment must be absolute, or it would resolve against main's working folder (review on #615)
  const abs = (v: string | undefined): string | undefined => (v && p.isAbsolute(v) ? v : undefined);
  const h = abs(home);
  const base = platform === 'win32' ? abs(env.APPDATA) ?? (h && p.join(h, 'AppData', 'Roaming'))
    : platform === 'darwin' ? h && p.join(h, 'Library', 'Application Support')
    : abs(env.XDG_CONFIG_HOME) ?? (h && p.join(h, '.config'));
  if (!base) return [];
  return ['Code', 'Code - Insiders'].map((app) => p.join(base, app, 'User', 'prompts'));
}

/** Each folder's `.github/prompts/*.prompt.md` and VS Code's user prompt folders (2026-10-23 delta), listed for every app. */
function promptPlaces(rs: readonly string[], vscodeDirs: readonly string[], home: string): { folder: (f: string) => SlashPlace; user: SlashPlace[] } {
  return {
    folder: (f) => ({ dir: path.join(f, '.github', 'prompts'), root: f, scope: 'folder', kind: 'prompt', layout: 'prompt-files', whereBase: folderBase(rs, f) }),
    user: uniq(vscodeDirs).map((d) => ({ dir: d, root: d, scope: 'user' as const, kind: 'prompt' as const, layout: 'prompt-files' as const, whereBase: displayBase(d, home) })),
  };
}

/** FR-004 Claude Code: each folder's `.claude/skills` and `.claude/commands`, then the user's under `CLAUDE_CONFIG_DIR` (default `~/.claude`). */
export function claudeSlashPlaces(roots: readonly string[], configDir: string, home = os.homedir(), vscodeDirs: readonly string[] = []): SlashPlace[] {
  const rs = uniq(roots);
  const pp = promptPlaces(rs, vscodeDirs, home);
  const out: SlashPlace[] = [];
  for (const f of rs) {
    out.push({ dir: path.join(f, '.claude', 'skills'), root: f, scope: 'folder', kind: 'skill', layout: 'skill-dirs', whereBase: folderBase(rs, f) });
    out.push({ dir: path.join(f, '.claude', 'commands'), root: f, scope: 'folder', kind: 'command', layout: 'md-files', whereBase: folderBase(rs, f) });
    out.push(pp.folder(f));
  }
  const ub = displayBase(configDir, home);
  out.push({ dir: path.join(configDir, 'skills'), root: configDir, scope: 'user', kind: 'skill', layout: 'skill-dirs', whereBase: ub });
  out.push({ dir: path.join(configDir, 'commands'), root: configDir, scope: 'user', kind: 'command', layout: 'md-files', whereBase: ub });
  return out.concat(pp.user);
}

/** The Copilot CLI's home: `COPILOT_HOME` replaces the whole `~/.copilot` path (GitHub's config-dir reference, read:). */
export function copilotHomeDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  return (env.COPILOT_HOME && path.isAbsolute(env.COPILOT_HOME) ? env.COPILOT_HOME : '') || path.join(home, '.copilot'); // a relative one is ignored (review on #615)
}

/**
 * FR-004 GitHub Copilot CLI: each folder's `.github/skills`, `.claude/skills`, `.agents/skills`; the user's `$COPILOT_HOME/skills`
 * (default `~/.copilot`) and `~/.agents/skills`. Every app also gets each folder's `.github/prompts` and VS Code's user prompt folders.
 */
export function copilotSlashPlaces(roots: readonly string[], copilotHome: string, home = os.homedir(), vscodeDirs: readonly string[] = []): SlashPlace[] {
  const rs = uniq(roots);
  const pp = promptPlaces(rs, vscodeDirs, home);
  const out: SlashPlace[] = [];
  for (const f of rs) {
    for (const d of ['.github', '.claude', '.agents']) out.push({ dir: path.join(f, d, 'skills'), root: f, scope: 'folder', kind: 'skill', layout: 'skill-dirs', whereBase: folderBase(rs, f) });
    out.push(pp.folder(f));
  }
  for (const root of [copilotHome, path.join(home, '.agents')]) {
    out.push({ dir: path.join(root, 'skills'), root, scope: 'user', kind: 'skill', layout: 'skill-dirs', whereBase: displayBase(root, home) });
  }
  return out.concat(pp.user);
}

/** FR-004 Codex: each folder's `.agents/skills`; the user's `~/.agents/skills`, `$CODEX_HOME/skills` and `$CODEX_HOME/prompts` (as `prompts:<name>`). */
export function codexSlashPlaces(roots: readonly string[], codexHome: string, home = os.homedir(), vscodeDirs: readonly string[] = []): SlashPlace[] {
  const rs = uniq(roots);
  const pp = promptPlaces(rs, vscodeDirs, home);
  const out: SlashPlace[] = rs.flatMap((f) => [{ dir: path.join(f, '.agents', 'skills'), root: f, scope: 'folder' as const, kind: 'skill' as const, layout: 'skill-dirs' as const, whereBase: folderBase(rs, f) }, pp.folder(f)]);
  const agents = path.join(home, '.agents');
  const cb = displayBase(codexHome, home);
  out.push({ dir: path.join(agents, 'skills'), root: agents, scope: 'user', kind: 'skill', layout: 'skill-dirs', whereBase: displayBase(agents, home) });
  out.push({ dir: path.join(codexHome, 'skills'), root: codexHome, scope: 'user', kind: 'skill', layout: 'skill-dirs', whereBase: cb });
  out.push({ dir: path.join(codexHome, 'prompts'), root: codexHome, scope: 'user', kind: 'prompt', layout: 'md-files', prefix: 'prompts:', whereBase: cb });
  return out.concat(pp.user);
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
