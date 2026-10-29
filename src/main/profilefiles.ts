/**
 * Profile files (spec 043 FR-010..FR-013): the custom agent files the agent apps load, listed, read and written by main only.
 * The window never sends a path: it gets an opaque id per file from `listProfileFiles` and sends that id back; every call lists
 * the allowed folders again and resolves the id itself, with real paths checked (no symbolic link out of an agent folder, no
 * `..`). Writes are atomic (temporary file + rename in the same folder) and keep the file's line endings and BOM. No Electron
 * here, so it is unit tested on temp folders (`npm run test:profilefiles`). File contents are never logged.
 */
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_AGENT_BYTES } from '../adapters/claudeAgents';
import { agentDirsFor } from '../adapters/copilot';
import type { ProfileFileInfo, ProfileFolderInfo } from '../shared/api';
import type { AgentProfile } from '../adapters/types';
import { DEFAULT_TEMPLATE, MAX_PROFILE_BYTES, profileTemplate } from '../shared/profiletemplates';
import type { TemplateKind } from '../shared/profiletemplates';
import { WINDOWS_RESERVED_NAME } from '../shared/newfolder';

export type { ProfileFileInfo, ProfileFolderInfo };

export type ProfileApp = 'copilot' | 'claude';
export const APP_LABEL: Record<ProfileApp, string> = { copilot: 'GitHub Copilot', claude: 'Claude Code' };
export { MAX_PROFILE_BYTES }; // the editor's and Copilot's limit, shared with the AI reply check (spec 043 FR-035)
/** The most a profile file may hold for its app (FR-012): Claude Code files use the Claude adapter's own cap (a bigger file is skipped
 * by `listClaudeAgents`, so it would vanish from the Profile menu); Copilot files the editor's 256 KB. */
export const maxBytesFor = (app: ProfileApp): number => (app === 'claude' ? MAX_AGENT_BYTES : MAX_PROFILE_BYTES);
const kb = (n: number): string => `${n / 1024} KB`;
export const MAX_PROFILE_FOLDERS = 50;
export const MAX_FILES_PER_DIR = 50;
/** All files listed at most (50 folders x 2 apps x 50 files would be 5,000); the list reads only the first 8 KB of each. */
export const MAX_FILES = 500;
const HEAD_BYTES = 8 * 1024;
/** A new profile's name (FR-011): a letter or digit first, no separators, no `..` possible as a whole name. */
export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Windows device names (constitution VI): `CON.md` or `con.backup.md` is a device there, so a repository profile with such a name
 * would break Windows checkouts. Refused on every platform, any case, with or without an extension (FR-011). One constant, shared
 * with spec 093's new-folder names (`src/shared/newfolder.ts`). */
export { WINDOWS_RESERVED_NAME };
/** A new profile's name is acceptable (FR-011): the pattern, no `..`, not a Windows device name. profileeditor.js keeps a copy (test:profilefiles keeps them equal). */
export const isProfileName = (name: unknown): name is string => typeof name === 'string' && PROFILE_NAME.test(name) && !name.includes('..') && !WINDOWS_RESERVED_NAME.test(name);
export const PROFILE_FILE_ID = /^[0-9a-f]{32}$/;

/** One folder a profile file may live in. `folder` is the office folder it belongs to (scope `folder`). */
export interface ProfileDir {
  app: ProfileApp;
  scope: 'folder' | 'user';
  dir: string;
  folder?: string;
  /** For `folder` scope: the folder the agent folder must stay inside (realpath checked after creating). */
  root?: string;
}


export interface ProfileEnv {
  home: string;
  claudeConfigDir: string;
}
export const defaultProfileEnv = (env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): ProfileEnv => ({ home, claudeConfigDir: env.CLAUDE_CONFIG_DIR || path.join(home, '.claude') });

/** The agent folders for the office's folders and the user (FR-010): the same folders the adapters load profiles from. */
export function profileDirs(folders: readonly string[], env: ProfileEnv = defaultProfileEnv()): ProfileDir[] {
  const fs0 = [...new Set(folders.filter((f) => typeof f === 'string' && path.isAbsolute(f)))].slice(0, MAX_PROFILE_FOLDERS);
  const out: ProfileDir[] = [];
  const cop = agentDirsFor(fs0, env.home); // spec 043 FR-002: each folder's .github/agents, then ~/.copilot/agents
  fs0.forEach((f, i) => out.push({ app: 'copilot', scope: 'folder', dir: cop[i], folder: f, root: f }));
  out.push({ app: 'copilot', scope: 'user', dir: cop[cop.length - 1] });
  for (const f of fs0) out.push({ app: 'claude', scope: 'folder', dir: path.join(f, '.claude', 'agents'), folder: f, root: f });
  out.push({ app: 'claude', scope: 'user', dir: path.join(env.claudeConfigDir, 'agents') });
  return out;
}

/** The user agent folders (FR-013 hint): where a new profile in "your user folder" goes, per app, as `profileDirs` has them. */
export function userAgentDirs(dirs: readonly ProfileDir[]): Partial<Record<ProfileApp, string>> {
  const out: Partial<Record<ProfileApp, string>> = {};
  for (const d of dirs) if (d.scope === 'user' && !out[d.app]) out[d.app] = d.dir;
  return out;
}

export const fileIdOf = (file: string): string => createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 32);
/** An office folder's id for the New profile form (FR-013): a hash of its path, so a folder added or removed while the form is open never shifts the choice to another folder. */
export const folderIdOf = (folder: string): string => createHash('sha256').update('folder\0' + path.resolve(folder)).digest('hex').slice(0, 32);
/** The folders a new profile can go into: exactly the folder-scope folders of `profileDirs` (absolute, no duplicates, at most 50). */
export function profileFolders(dirs: readonly ProfileDir[]): ProfileFolderInfo[] {
  const seen = new Set<string>();
  const out: ProfileFolderInfo[] = [];
  for (const d of dirs) {
    if (d.scope !== 'folder' || !d.folder || seen.has(d.folder)) continue;
    seen.add(d.folder);
    out.push({ id: folderIdOf(d.folder), path: d.folder });
  }
  return out;
}
const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const realOr = (p: string): string | undefined => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return undefined;
  }
};
const sameDir = (a: string, b: string): boolean => (process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b);
/** `child` is `root` itself or inside it (both real paths). */
export function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const oneLine = (s: unknown, max: number): string | undefined => {
  if (typeof s !== 'string') return undefined;
  const t = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? (t.length > max ? t.slice(0, max - 1) + '…' : t) : undefined;
};
/** `name` and `description` from the front matter, for the list only (the editor checks the front matter itself, FR-015). */
export function headOf(text: string): { name?: string; description?: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(name|description)\s*:\s*(.*)$/.exec(line);
    if (kv && !(kv[1] in out)) out[kv[1] as 'name' | 'description'] = oneLine(kv[2].trim().replace(/^(["'])(.*)\1$/, '$2'), kv[1] === 'name' ? 80 : 200);
  }
  return out;
}

/** Whether the agent folder is a real, allowed folder: for `folder` scope its real path must stay inside the office folder. */
function dirOk(d: ProfileDir): string | undefined {
  const real = realOr(d.dir);
  if (!real) return undefined;
  if (d.root) {
    const rootReal = realOr(d.root);
    if (!rootReal || !isInside(rootReal, real)) return undefined; // a .github or .claude that links out of the folder
  }
  return real;
}

const writableNow = (p: string): boolean => {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

interface Found {
  info: ProfileFileInfo;
  dir: ProfileDir;
  dirReal: string;
  file: string;
}

/** The first bytes of a file (the front matter is at the top), so listing never reads whole files. */
function readHead(file: string): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function scan(dirs: readonly ProfileDir[], wantId?: string): Found[] {
  const out: Found[] = [];
  for (const d of dirs) {
    if (out.length >= MAX_FILES) break;
    const dirReal = dirOk(d);
    if (!dirReal) continue;
    let names: string[];
    try {
      names = fs.readdirSync(d.dir).filter((n) => n.toLowerCase().endsWith('.md') && !n.startsWith('.')).sort().slice(0, MAX_FILES_PER_DIR);
    } catch {
      continue;
    }
    for (const n of names) {
      if (out.length >= MAX_FILES) break;
      const file = path.join(d.dir, n);
      if (wantId && fileIdOf(file) !== wantId) continue; // resolving one id: only that file is looked at
      let st: fs.Stats;
      try {
        st = fs.lstatSync(file);
      } catch {
        continue;
      }
      const link = st.isSymbolicLink();
      if (!link && !st.isFile()) continue;
      if (link) {
        // a link is listed read-only only when it points at a file inside the same agent folder; one that leads out is not listed
        const r = realOr(file);
        if (!r || !isInside(dirReal, r)) continue;
        try {
          if (!fs.statSync(file).isFile()) continue;
        } catch {
          continue;
        }
      }
      const size = link ? fs.statSync(file).size : st.size;
      const max = maxBytesFor(d.app);
      const tooBig = size > max;
      let head: { name?: string; description?: string } = {};
      if (!tooBig) {
        try {
          head = headOf(readHead(file));
        } catch {
          continue;
        }
      }
      const writable = !link && !tooBig && writableNow(file) && writableNow(d.dir);
      const note = link ? 'A link: edit the file it points to.' : tooBig ? (d.app === 'claude' ? `Larger than ${kb(max)}: Claude Code does not load it. Open it in an editor.` : `Larger than ${kb(max)}: open it in an editor.`) : !writable ? 'You cannot write this file.' : undefined;
      out.push({
        info: {
          id: fileIdOf(file),
          app: d.app,
          scope: d.scope,
          ...(d.folder ? { folder: d.folder } : {}),
          fileName: n,
          path: file,
          name: head.name || n.replace(/(\.agent)?\.md$/i, ''),
          ...(head.description ? { description: head.description } : {}),
          size,
          writable,
          ...(note ? { note } : {}),
          ...(tooBig ? { tooBig } : {}),
        },
        dir: d,
        dirReal,
        file,
      });
    }
  }
  return out;
}

export function listProfileFiles(dirs: readonly ProfileDir[]): ProfileFileInfo[] {
  return scan(dirs).map((f) => f.info);
}

/** Finds a listed file by id and checks it again: still directly inside its real agent folder, not a link out. */
function resolveId(dirs: readonly ProfileDir[], id: unknown): Found | undefined {
  if (typeof id !== 'string' || !PROFILE_FILE_ID.test(id)) return undefined;
  const f = scan(dirs, id).find((x) => x.info.id === id);
  if (!f) return undefined;
  const real = realOr(f.file);
  if (!real || !sameDir(path.dirname(real), f.dirReal)) return undefined;
  return f;
}

export interface ProfileText {
  ok: true;
  info: ProfileFileInfo;
  /** Text with LF line endings and no BOM (the editor's form); main puts them back when saving. */
  text: string;
  /** SHA-256 of the bytes on disk, handed back on save to detect a change made elsewhere. */
  sha256: string;
  eol: 'lf' | 'crlf';
}
export type Fail = { ok: false; error: string; conflict?: boolean };

/** CRLF when most line breaks are CRLF. */
export const eolOf = (s: string): 'lf' | 'crlf' => {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/\n/g) || []).length - crlf;
  return crlf > lf ? 'crlf' : 'lf';
};

export function readProfileFile(dirs: readonly ProfileDir[], id: unknown): ProfileText | Fail {
  const f = resolveId(dirs, id);
  if (!f) return { ok: false, error: 'That profile file is not in the list any more.' };
  if (f.info.tooBig) return { ok: false, error: f.info.note ?? 'The file is too large.' };
  let buf: Buffer;
  try {
    buf = fs.readFileSync(f.file);
  } catch {
    return { ok: false, error: 'The file could not be read.' };
  }
  if (buf.length > maxBytesFor(f.info.app)) return { ok: false, error: 'The file is too large.' };
  const raw = buf.toString('utf8');
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  return { ok: true, info: f.info, text, sha256: sha256(buf), eol: eolOf(raw) };
}

/** The rename step of an atomic save; tests swap it to prove a failed rename leaves the original file and no temporary file (FR-012). */
export const atomicOps = { rename: (from: string, to: string): void => fs.renameSync(from, to) };

/** Writes `data` to `file` through a temporary file in the same folder and a rename. */
function writeAtomic(file: string, data: Buffer, exclusive = false): void {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  let mode: number | undefined;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    mode = undefined;
  }
  if (exclusive) {
    fs.writeFileSync(file, data, { flag: 'wx' }); // fails when the name exists: a new profile never replaces a file
    return;
  }
  fs.writeFileSync(tmp, data, { flag: 'wx', ...(mode !== undefined ? { mode } : {}) });
  try {
    atomicOps.rename(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* gone already */
    }
    throw err;
  }
}

/** The text as the file's own bytes: its line endings and BOM kept (FR-012). */
export function encodeLike(text: string, original: Buffer | undefined): Buffer {
  const raw = original ? original.toString('utf8') : '';
  let s = text.replace(/\r\n/g, '\n');
  if (original && eolOf(raw) === 'crlf') s = s.replace(/\n/g, '\r\n');
  if (raw.startsWith('﻿')) s = '﻿' + s;
  return Buffer.from(s, 'utf8');
}

export function saveProfileFile(dirs: readonly ProfileDir[], id: unknown, text: unknown, baseSha: unknown, overwrite: unknown): { ok: true; sha256: string; info: ProfileFileInfo } | Fail {
  if (typeof text !== 'string') return { ok: false, error: 'Nothing to save.' };
  if (Buffer.byteLength(text, 'utf8') > MAX_PROFILE_BYTES) return { ok: false, error: `The text is larger than ${kb(MAX_PROFILE_BYTES)}.` }; // cheap first check before any disk access
  const f = resolveId(dirs, id);
  if (!f) return { ok: false, error: 'The file was removed or moved since you opened it.', conflict: true };
  if (!f.info.writable) return { ok: false, error: f.info.note ?? 'You cannot write this file.' };
  let cur: Buffer | undefined;
  try {
    cur = fs.readFileSync(f.file);
  } catch {
    cur = undefined;
  }
  if (overwrite !== true && (!cur || typeof baseSha !== 'string' || sha256(cur) !== baseSha)) return { ok: false, conflict: true, error: 'The file changed on disk since you opened it.' };
  const data = encodeLike(text, cur);
  // the cap is checked on the bytes that will be written (CRLF and a BOM make them longer than the text), so a save never makes a file that cannot be opened again
  const max = maxBytesFor(f.info.app);
  if (data.length > max)
    return { ok: false, error: f.info.app === 'claude' ? `The file would be larger than ${kb(max)}: Claude Code does not load a bigger agent file.` : `The file would be larger than ${kb(max)}.` };
  try {
    writeAtomic(f.file, data);
  } catch {
    return { ok: false, error: 'The file could not be written.' };
  }
  const info = listProfileFiles(dirs).find((x) => x.id === f.info.id) ?? f.info;
  return { ok: true, sha256: sha256(data), info };
}

/** The text of a new profile (FR-013, FR-018): the shared templates, the Agent Success Profile by default. */
export function templateFor(app: ProfileApp, name: string, kind: TemplateKind = DEFAULT_TEMPLATE): string {
  return profileTemplate(app, name, kind);
}

/** `place`: 'user', or a folder id from `profileFolders` of the same (current) dirs; an id of a folder that left the office is refused. `text`: a reviewed AI draft (FR-029). */
export function createProfileFile(dirs: readonly ProfileDir[], app: unknown, place: unknown, name: unknown, template: unknown = DEFAULT_TEMPLATE, text?: unknown): { ok: true; id: string; info: ProfileFileInfo } | Fail {
  if (app !== 'copilot' && app !== 'claude') return { ok: false, error: 'Choose an agent app.' };
  if (template !== 'success' && template !== 'standard') return { ok: false, error: 'Choose a template.' };
  if (typeof name === 'string' && PROFILE_NAME.test(name) && WINDOWS_RESERVED_NAME.test(name)) return { ok: false, error: 'That name is reserved on Windows (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9, LPT0-9): choose another.' };
  if (!isProfileName(name)) return { ok: false, error: 'Use letters, digits, dots, dashes or underscores (up to 64), starting with a letter or digit.' };
  if (text !== undefined && (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > maxBytesFor(app))) return { ok: false, error: 'The text cannot be saved (empty or too large).' };
  const own = dirs.filter((d) => d.app === app);
  const folderDirs = own.filter((d) => d.scope === 'folder');
  const d = place === 'user' ? own.find((x) => x.scope === 'user') : typeof place === 'string' && PROFILE_FILE_ID.test(place) ? folderDirs.find((x) => !!x.folder && folderIdOf(x.folder) === place) : undefined;
  if (!d) return { ok: false, error: typeof place === 'string' && PROFILE_FILE_ID.test(place) ? 'That folder is not in the office any more: choose where to save it again.' : 'Choose where to save it.' };
  if (d.root) {
    const rootReal = realOr(d.root);
    if (!rootReal) return { ok: false, error: 'The folder is not there any more.' };
    // before making anything: the nearest existing part of the agent folder must already be inside the office folder (a linked .claude)
    let near = d.dir;
    const there = (p: string): boolean => {
      try {
        fs.lstatSync(p); // a dangling link counts as there, and its realpath then fails
        return true;
      } catch {
        return false;
      }
    };
    while (!there(near) && path.dirname(near) !== near) near = path.dirname(near);
    const nearReal = realOr(near);
    if (!nearReal || !isInside(rootReal, nearReal)) return { ok: false, error: 'The agent folder is outside this folder (a link); create the file by hand.' };
  }
  try {
    fs.mkdirSync(d.dir, { recursive: true });
  } catch {
    return { ok: false, error: 'The agent folder could not be created.' };
  }
  const dirReal = dirOk(d);
  if (!dirReal) return { ok: false, error: 'The agent folder is outside this folder (a link); create the file by hand.' };
  const fileName = app === 'copilot' ? `${name}.agent.md` : `${name}.md`;
  const file = path.join(d.dir, fileName);
  if (fs.existsSync(file)) return { ok: false, error: `${fileName} exists already.` };
  try {
    writeAtomic(file, Buffer.from(typeof text === 'string' ? text : templateFor(app, name, template), 'utf8'), true);
  } catch {
    return { ok: false, error: `${fileName} could not be written (it may exist already).` };
  }
  const info = listProfileFiles(dirs).find((x) => x.id === fileIdOf(file));
  if (!info) return { ok: false, error: 'The new file is not in the list (too many files in that folder?).' };
  return { ok: true, id: info.id, info };
}

/** The path of a listed file, for main's own use (Open in VS Code); never from the window. */
export function pathOfProfile(dirs: readonly ProfileDir[], id: unknown): string | undefined {
  return resolveId(dirs, id)?.file;
}

/**
 * Spec 043 FR-040: deletes a listed profile file by id. The id is resolved again from the current folders (directly inside its real
 * agent folder, not a link); only a writable file is deleted, with `unlinkSync` (one file, never a folder, no shell).
 */
/** The last check before the unlink; tests swap it to prove a link or folder swapped in after resolving is refused (FR-040). */
export const deleteOps = { lstat: (p: string): fs.Stats => fs.lstatSync(p) };

export function deleteProfileFile(dirs: readonly ProfileDir[], id: unknown): { ok: true; id: string } | Fail {
  const f = resolveId(dirs, id);
  if (!f) return { ok: false, error: 'That profile file is not in the list any more.' };
  if (!f.info.writable) return { ok: false, error: f.info.note ?? 'You cannot delete this file.' };
  try {
    // checked once more right before the unlink: the scan excluded links and non-files, but the entry may have been swapped since
    if (!deleteOps.lstat(f.file).isFile()) return { ok: false, error: 'Only a plain file can be deleted here.' };
    fs.unlinkSync(f.file);
  } catch {
    return { ok: false, error: 'The file could not be deleted.' };
  }
  return { ok: true, id: f.info.id };
}

/**
 * Spec 043 FR-041: profile file changes made through Durbar (create, save, delete), counted, and which change each session has
 * seen, so the next profile list of a session that missed one asks its adapter to read the agent files again, once.
 */
export interface ProfileFreshness {
  changed(): void;
  needsReload(sessionId: string): boolean;
  seen(sessionId: string): void;
  /** A session that ended or left the office (agents:end, agents:remove). */
  forget(sessionId: string): void;
  /** Drops every session `keep` says is gone (folders:remove and a replaced session leave no entry behind). */
  prune(keep: (sessionId: string) => boolean): void;
}
export function createProfileFreshness(): ProfileFreshness {
  let version = 0;
  const seenAt = new Map<string, number>();
  return {
    changed: () => void version++,
    needsReload: (id) => (seenAt.get(id) ?? 0) !== version,
    seen: (id) => void seenAt.set(id, version),
    forget: (id) => void seenAt.delete(id),
    prune: (keep) => {
      for (const id of [...seenAt.keys()]) if (!keep(id)) seenAt.delete(id);
    },
  };
}

/** FR-041: a session's profiles, after a reload when it missed a change (a failed reload lists the old list and tries again next time). */
export async function listAgentProfilesFresh(
  ad: { listAgentProfiles?(id: string): Promise<AgentProfile[]>; reloadAgentProfiles?(id: string): Promise<boolean | void> },
  id: string,
  fr: ProfileFreshness,
): Promise<AgentProfile[]> {
  if (fr.needsReload(id)) {
    let ok = true;
    if (ad.reloadAgentProfiles) {
      try {
        ok = (await ad.reloadAgentProfiles(id)) !== false;
      } catch {
        ok = false;
      }
    }
    if (ok) fr.seen(id);
  }
  return ad.listAgentProfiles ? ad.listAgentProfiles(id) : [];
}
