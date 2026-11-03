/**
 * Spec 009 FR-019..FR-027 (issue #685): the chat header's "Open with" menu. Pure apart from the injected `Deps`, so
 * `npm run test:openwith` runs it without Electron and without starting any program.
 *
 * The window sends an agent id and one fixed target id. The folder comes from the agent main started. It is resolved once with
 * `realpath` (a link is followed, by owner decision), that real path is checked with `lstat`, and only that same real path, a real
 * directory (or a regular `.code-workspace` file for an editor), is handed to an editor or to the file manager, in the same synchronous
 * step as the check. Editors are found by spec 009's own rules (`planEdition`), the argument list is exactly the one path, and there
 * is no shell. What this cannot close: something that renames entries inside the real path's parent can still swap it between the
 * last `lstat` and the program opening it (FR-023).
 */
import * as fs from 'fs';
import * as path from 'path';
import { EDITIONS, EDITOR_NOT_FOUND, defaultEnv, planEdition, spawnPlan } from './vscode';
import type { LaunchEnv, LaunchPlan, OpenResult } from './vscode';
import { CMD_UNSAFE } from '../shared/wincmd';

export type TargetId = 'vscode' | 'vscode-insiders' | 'vscodium' | 'folder';
/** FR-020: the only target ids; each editor id is one of spec 009's editions. */
const EDITOR_TARGETS: Readonly<Record<string, string>> = Object.freeze({ vscode: 'VS Code', 'vscode-insiders': 'VS Code Insiders', vscodium: 'VSCodium' });
export interface Target {
  id: TargetId;
  label: string;
  hint: string;
}
/** What main knows about an agent it started. */
export interface OwnedAgent {
  cwd: string;
  workspaceFile?: string;
}
export interface StatLike {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}
export interface Deps {
  platform: NodeJS.Platform;
  launchEnv: LaunchEnv;
  /** `lstat`: never follows a link. Throws when the path is missing. Tells whether the agent's path is itself a link (for the note) and checks the real path. */
  lstat: (p: string) => StatLike;
  /** The real path, every link in it resolved (`fs.realpathSync`). Always called; throws when it leads nowhere. */
  realpath: (p: string) => string;
  /** `shell.openPath`: resolves to '' on success, else an error text. */
  openPath: (p: string) => Promise<string>;
  /** `shell.showItemInFolder`: selects the item in the file manager and runs nothing. */
  reveal: (p: string) => void;
  /** Starts a plan (no shell). Tests give a recorder; nothing in a test ever starts an editor. */
  start: (plan: LaunchPlan) => Promise<OpenResult>;
}

export function realDeps(openPath: (p: string) => Promise<string>, reveal: (p: string) => void): Deps {
  return { platform: process.platform, launchEnv: defaultEnv(), lstat: (p) => fs.lstatSync(p), realpath: (p) => fs.realpathSync(p), openPath, reveal, start: (plan) => spawnPlan(plan) };
}

/** FR-026: a folder the file manager would run instead of showing: on macOS a name with an extension or a bundle's `Contents`, on Windows a `name.{CLSID}` shell folder. */
function isPackage(p: string, d: Pick<Deps, 'platform' | 'lstat'>): boolean {
  if (d.platform === 'win32') return /\.\{[0-9a-f-]+\}[. ]*$/i.test(path.win32.basename(p));
  if (d.platform !== 'darwin') return false;
  if (path.posix.extname(path.posix.basename(p))) return true;
  try {
    d.lstat(path.posix.join(p, 'Contents'));
    return true;
  } catch {
    return false;
  }
}

const abs = (p: string, platform: NodeJS.Platform): boolean => (platform === 'win32' ? path.win32.isAbsolute(p) : path.posix.isAbsolute(p));

/** The note of an answer whose folder was a link (spec *Changes* 2026-11-01). No path in it. */
export const LINK_NOTE = 'This folder is a link, so its real folder was opened.';
export const WORKSPACE_LINK_NOTE = 'This workspace file is a link, so its real file was opened.';
/** A folder named like an application: shown, because opening it would run it (spec *Changes* 2026-11-02). */
export const PACKAGE_NOTE = 'It looks like an application or package, so it is selected, not opened.';

const NO_FOLDER = 'This agent has no usable folder.';
const NO_WORKSPACE = 'This workspace file is not usable.';

/** FR-021: absolute, no NUL, exists, a directory. The path is resolved once with `realpath` (owner decision, spec *Changes* 2026-11-01:
 *  links are followed) and the real path is what is checked and returned, so what is handed on is the path that was checked. */
export function checkFolder(p: unknown, d: Pick<Deps, 'platform' | 'lstat' | 'realpath'>): { ok: true; path: string; linked?: boolean } | { ok: false; error: string } {
  if (typeof p !== 'string' || !p || p.includes('\0')) return { ok: false, error: NO_FOLDER };
  if (!abs(p, d.platform)) return { ok: false, error: 'The folder path is not absolute, so it was not opened.' };
  let st: StatLike;
  let real: string;
  let linked: boolean;
  try {
    linked = d.lstat(p).isSymbolicLink();
    real = d.realpath(p);
    st = d.lstat(real);
  } catch {
    return { ok: false, error: 'This folder no longer exists (moved, renamed or deleted).' };
  }
  // lstat of the real path: a link put there after realpath is no directory, so it is refused, never followed a second time
  if (!st.isDirectory()) return { ok: false, error: 'This is not a folder, so it was not opened.' };
  return linked ? { ok: true, path: real, linked: true } : { ok: true, path: real };
}

/** The workspace file of an agent main started: a regular `.code-workspace` file, or a link to one (with a note); only ever for an editor. */
function checkWorkspace(w: unknown, d: Pick<Deps, 'platform' | 'lstat' | 'realpath'>): { ok: true; path: string; linked: boolean } | { ok: false; error: string } {
  if (typeof w !== 'string' || !w || w.includes('\0') || !abs(w, d.platform) || !/\.code-workspace$/i.test(w)) return { ok: false, error: NO_WORKSPACE };
  let st: StatLike;
  let real: string;
  let linked: boolean;
  try {
    linked = d.lstat(w).isSymbolicLink();
    real = d.realpath(w);
    st = d.lstat(real);
  } catch {
    return { ok: false, error: 'This workspace file no longer exists.' };
  }
  if (!st.isFile() || !/\.code-workspace$/i.test(real)) return { ok: false, error: 'This workspace file is not a regular file, so it was not opened.' };
  return { ok: true, path: real, linked };
}

/** FR-019: the hint of Show in folder names the OS's file manager. */
export function fileManagerHint(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'File Explorer' : 'File manager';
}

/** An edition counts as installed if it can be planned for a harmless folder name (a name cmd.exe could misread must not hide an installed editor). */
function installed(ed: (typeof EDITIONS)[number], d: Deps): boolean {
  return !!planEdition(ed, d.platform === 'win32' ? 'C:\\durbar-probe' : '/durbar-probe', d.launchEnv);
}

/** FR-019: the installed editions (spec 009 discovery) and the file manager, for the agent's own folder. */
export function listTargets(agent: OwnedAgent | undefined, d: Deps): Target[] {
  if (!agent) return [];
  const out: Target[] = [];
  for (const [id, name] of Object.entries(EDITOR_TARGETS)) {
    const ed = EDITIONS.find((e) => e.name === name);
    if (ed && installed(ed, d)) out.push({ id: id as TargetId, label: name, hint: (agent.workspaceFile ? 'Opens this workspace in ' : 'Opens this folder in ') + name });
  }
  out.push({ id: 'folder', label: 'Show in folder', hint: 'Opens it in ' + fileManagerHint(d.platform) });
  return out;
}

/** FR-020..FR-024. `agent` is looked up by main from the id; `targetId` must be one of the fixed ids. */
export async function openWith(agent: OwnedAgent | undefined, targetId: unknown, d: Deps): Promise<OpenResult> {
  if (!agent) return { ok: false, error: 'unknown agent' };
  if (typeof targetId !== 'string') return { ok: false, error: 'unknown target' };
  if (targetId === 'folder') {
    const f = checkFolder(agent.cwd, d);
    if (!f.ok) return f;
    if (isPackage(f.path, d)) {
      d.reveal(f.path);
      return { ok: true, note: f.linked ? LINK_NOTE + ' ' + PACKAGE_NOTE : PACKAGE_NOTE };
    }
    try {
      const err = await d.openPath(f.path);
      return err ? { ok: false, error: err } : { ok: true, ...(f.linked ? { note: LINK_NOTE } : {}) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (!Object.prototype.hasOwnProperty.call(EDITOR_TARGETS, targetId)) return { ok: false, error: 'unknown target' };
  const name = EDITOR_TARGETS[targetId];
  const ed = EDITIONS.find((e) => e.name === name);
  if (!ed) return { ok: false, error: 'unknown target' };
  const t = editorDest(agent, d);
  if (!t.ok) return t;
  const plan = planEdition(ed, t.dest, d.launchEnv);
  if (!plan) return { ok: false, error: installed(ed, d) ? cmdRefusal(name, t.dest, t.what) : `${name} was not found, so nothing was opened.` };
  return launch(plan, name, t.note, d);
}

/** What an editor gets: the workspace file if the agent has one, else the folder; both checked and resolved (FR-021, FR-027). */
function editorDest(agent: OwnedAgent, d: Deps): { ok: true; dest: string; what: 'folder' | 'workspace file'; note?: string } | { ok: false; error: string } {
  if (agent.workspaceFile != null) {
    const w = checkWorkspace(agent.workspaceFile, d);
    return w.ok ? { ok: true, dest: w.path, what: 'workspace file', ...(w.linked ? { note: WORKSPACE_LINK_NOTE } : {}) } : w;
  }
  const f = checkFolder(agent.cwd, d);
  return f.ok ? { ok: true, dest: f.path, what: 'folder', ...(f.linked ? { note: LINK_NOTE } : {}) } : f;
}

const CMD_UNSAFE_ALL = new RegExp(CMD_UNSAFE.source, 'g');
/** FR-022: an edition found only as a `.cmd` cannot take a path cmd.exe could misread. The text names the characters in that path. */
function cmdRefusal(name: string, dest: string, what: 'folder' | 'workspace file'): string {
  const found = [...new Set((dest.match(CMD_UNSAFE_ALL) ?? []).map((c) => (c === '\r' || c === '\n' ? 'a line break' : c)))];
  const why = found.length ? `its path has ${found.join(' ')}, which cmd.exe could misread` : 'cmd.exe could misread its path';
  return `${name} is installed, but it cannot open this ${what} safely (${why}). Rename the ${what === 'folder' ? 'folder' : 'workspace file or its folder'}, or open it from ${name} itself.`;
}

async function launch(plan: LaunchPlan, name: string, note: string | undefined, d: Deps): Promise<OpenResult> {
  const r = await d.start({ ...plan, edition: name });
  return r.ok ? { ok: true, edition: name, ...(note ? { note } : {}) } : { ok: false, error: r.error ?? 'unknown error', edition: name };
}

/** FR-027: Open in editor and Continue in VS Code: the first edition in FR-015's order that can open this path, through the same checks
 *  as the menu. An edition that cannot open it safely (on Windows, a `.cmd` only and a path cmd.exe could misread) is skipped for the next. */
export async function openInFirstEditor(agent: OwnedAgent | undefined, d: Deps): Promise<OpenResult> {
  if (!agent) return { ok: false, error: 'unknown agent' };
  const t = editorDest(agent, d);
  if (!t.ok) return t;
  let refused: string | undefined;
  for (const name of Object.values(EDITOR_TARGETS)) {
    const ed = EDITIONS.find((e) => e.name === name);
    if (!ed) continue;
    const plan = planEdition(ed, t.dest, d.launchEnv);
    if (plan) return launch(plan, name, t.note, d);
    if (!refused && installed(ed, d)) refused = cmdRefusal(name, t.dest, t.what);
  }
  return { ok: false, error: refused ?? EDITOR_NOT_FOUND };
}

/** FR-020: the folder is main's. Only an agent id of an agent main started finds anything; a path (or anything else) finds nothing. */
export function ownedAgent(agents: ReadonlyMap<string, OwnedAgent>, id: unknown): OwnedAgent | undefined {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  return a ? { cwd: a.cwd, workspaceFile: a.workspaceFile } : undefined;
}
