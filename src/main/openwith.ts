/**
 * Spec 009 FR-019..FR-025 (issue #685): the chat header's "Open with" menu. Pure apart from the injected `Deps`, so
 * `npm run test:openwith` runs it without Electron and without starting any program.
 *
 * The window sends an agent id and one fixed target id. The folder comes from the agent main started, is looked at without
 * following links, and only a real directory is ever handed to an editor or to the file manager. Editors are found by spec 009's
 * own rules (`planEdition`), the argument list is exactly the one folder, and there is no shell.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EDITIONS, defaultEnv, planEdition, spawnPlan } from './vscode';
import type { LaunchEnv, LaunchPlan, OpenResult } from './vscode';

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
  /** `lstat`: never follows a link. Throws when the path is missing. */
  lstat: (p: string) => StatLike;
  /** `shell.openPath`: resolves to '' on success, else an error text. */
  openPath: (p: string) => Promise<string>;
  /** Starts a plan (no shell). Tests give a recorder; nothing in a test ever starts an editor. */
  start: (plan: LaunchPlan) => Promise<OpenResult>;
}

export function realDeps(openPath: (p: string) => Promise<string>): Deps {
  return { platform: process.platform, launchEnv: defaultEnv(), lstat: (p) => fs.lstatSync(p), openPath, start: (plan) => spawnPlan(plan) };
}

/** FR-021: folders whose name makes the file manager run them instead of showing them. Checked on every OS (one rule). */
const LAUNCHABLE_DIR = /\.(app|bundle|workflow|action|prefpane|saver|xpc|kext|framework|plugin|command)$/i;

const abs = (p: string, platform: NodeJS.Platform): boolean => (platform === 'win32' ? path.win32.isAbsolute(p) : path.posix.isAbsolute(p));

/** FR-021: absolute, no NUL, exists, a real directory, not a link. */
export function checkFolder(p: unknown, d: Pick<Deps, 'platform' | 'lstat'>): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof p !== 'string' || !p || p.includes('\0')) return { ok: false, error: 'This agent has no usable folder.' };
  if (!abs(p, d.platform)) return { ok: false, error: 'The folder path is not absolute, so it was not opened.' };
  let st: StatLike;
  try {
    st = d.lstat(p);
  } catch {
    return { ok: false, error: 'This folder no longer exists (moved, renamed or deleted).' };
  }
  if (st.isSymbolicLink()) return { ok: false, error: 'This folder is a link. Open the real folder instead; links are not followed.' };
  if (!st.isDirectory()) return { ok: false, error: 'This is not a folder, so it was not opened.' };
  return { ok: true, path: p };
}

function fileManagerHint(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'File Explorer' : 'File manager';
}

/** FR-019: the installed editions (spec 009 discovery) and the file manager, for the agent's own folder. */
export function listTargets(agent: OwnedAgent | undefined, d: Deps): Target[] {
  if (!agent) return [];
  const out: Target[] = [];
  const dest = agent.workspaceFile ?? agent.cwd;
  for (const [id, name] of Object.entries(EDITOR_TARGETS)) {
    const ed = EDITIONS.find((e) => e.name === name);
    if (ed && planEdition(ed, dest, d.launchEnv)) out.push({ id: id as TargetId, label: name, hint: 'Opens this folder in ' + name });
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
    if (LAUNCHABLE_DIR.test(path.basename(f.path.replace(/[\\/]+$/, '')))) return { ok: false, error: 'This folder looks like an application or package, so it was not opened in the file manager.' };
    try {
      const err = await d.openPath(f.path);
      return err ? { ok: false, error: err } : { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (!Object.prototype.hasOwnProperty.call(EDITOR_TARGETS, targetId)) return { ok: false, error: 'unknown target' };
  const name = EDITOR_TARGETS[targetId];
  const ed = EDITIONS.find((e) => e.name === name);
  if (!ed) return { ok: false, error: 'unknown target' };
  let dest: string;
  if (agent.workspaceFile) {
    // a .code-workspace file of an agent main started: a regular file, not a link, never given to the file manager
    const w = agent.workspaceFile;
    if (typeof w !== 'string' || w.includes('\0') || !abs(w, d.platform) || !/\.code-workspace$/i.test(w)) return { ok: false, error: 'This workspace file is not usable.' };
    try {
      const st = d.lstat(w);
      if (st.isSymbolicLink() || !st.isFile()) return { ok: false, error: 'This workspace file is not a regular file, so it was not opened.' };
    } catch {
      return { ok: false, error: 'This workspace file no longer exists.' };
    }
    dest = w;
  } else {
    const f = checkFolder(agent.cwd, d);
    if (!f.ok) return f;
    dest = f.path;
  }
  const plan = planEdition(ed, dest, d.launchEnv);
  if (!plan) return { ok: false, error: `${name} was not found, so nothing was opened.` };
  const r = await d.start({ ...plan, edition: name });
  return r.ok ? { ok: true, edition: name } : { ok: false, error: r.error ?? 'unknown error', edition: name };
}

/** FR-020: the folder is main's. Only an agent id of an agent main started finds anything; a path (or anything else) finds nothing. */
export function ownedAgent(agents: ReadonlyMap<string, OwnedAgent>, id: unknown): OwnedAgent | undefined {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  return a ? { cwd: a.cwd, workspaceFile: a.workspaceFile } : undefined;
}
