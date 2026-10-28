/**
 * Spec 093 (create a folder from + Folder): the part of main that creates the folder. No Electron: every outside effect is injected
 * (the file system, the git runner, `addMany`, settings, the clock), so `test:newfolderop` drives it with fakes and the real-git test
 * with the real ones. Phase 1: an empty folder or a new repository (`git init`). Phase 2 adds the clone (URL, progress, Cancel).
 *
 * - The window never passes a path (FR-005, D1): main picks the parent with the system dialog and keeps it behind a token.
 * - The name is checked here (FR-010) and claimed with a non-recursive `mkdir` (FR-012, D3): nothing is created before the claim.
 * - Any failure after the claim removes exactly that folder, without following links (FR-050).
 * - Success adds it through `addMany` in the window's mode read with `validMode` (FR-060, FR-061), like Add existing.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import type { AddResult, PermMode, SessionOptions } from '../shared/api';
import { NEW_FOLDER_LIMITS, checkNewFolderName, parseNewFolderParent } from '../shared/newfolder';
import { maskHomePaths, maskSecretUrl } from '../shared/redact';
import { validMode } from './agentops';
import { runGitCreate } from './gitstatus';
import type { GitCreateDeps, GitCreateHandle, GitCreateRequest } from './gitstatus';

/** A parent pick is valid this long (FR-005). */
export const PARENT_TOKEN_MS = 10 * 60 * 1000;
/** Phase 1 has no Cancel in the window: `git init` that runs longer than this is ended and its folder removed. */
export const INIT_LIMIT_MS = 30 * 1000;
/** Removal tries (FR-050: Windows may hold a file for a moment after the process ends) and the wait between them. */
export const REMOVE_TRIES = 10;
export const REMOVE_WAIT_MS = 500;

export type NewFolderKind = 'init' | 'empty';
export const NEW_FOLDER_KINDS: readonly NewFolderKind[] = ['init', 'empty'];

export type PickResult = { ok: true; token: string; parent: string } | { ok: false; cancelled?: true; error?: string };
export type CheckResult = { ok: true } | { ok: false; error: string };
/** `retry` tells the window which step to offer again: the name field, or the place (*Change place…*). */
export type CreateResult = (AddResult & { name?: string; retry?: 'name' | 'place' });

export interface NewFolderFs {
  /** Non-recursive: the atomic claim (EEXIST when the name is taken). */
  mkdir(p: string): Promise<void>;
  /** Recursive and forced; must not follow links (Node's `fs.rm` uses lstat and unlinks a link). */
  rm(p: string): Promise<void>;
  /** A private empty folder for the hooks path (FR-032). */
  mkdtemp(prefix: string): Promise<string>;
  /** Whether the path is a folder now (follows links: a symlinked parent is fine). */
  isDir(p: string): Promise<boolean>;
}

export interface NewFolderDeps {
  fs: NewFolderFs;
  /** Where the private hooks folder is made (os.tmpdir()). */
  tmpDir(): string;
  runGitCreate(req: GitCreateRequest, cwd: string, deps: GitCreateDeps): GitCreateHandle;
  addMany(paths: string[], permMode: PermMode, opts?: SessionOptions & { persist?: boolean }): Promise<AddResult>;
  /** Read and written only here; `undefined` while settings are not loaded. */
  settings(): { newFolderParent: string | undefined; setNewFolderParent(p: string): void } | undefined;
  /** A monotonic clock in ms (performance.now): a token never outlives its 10 minutes because the wall clock moved. */
  now(): number;
  newToken(): string;
  platform: NodeJS.Platform;
  sleep(ms: number): Promise<void>;
  /** Ends a git run that went over `INIT_LIMIT_MS` (setTimeout in the app; tests drive it). Returns a function that clears it. */
  timer(ms: number, fn: () => void): () => void;
}

const errCode = (e: unknown): string => (e && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : '');

/** FR-070: git's text for the window: credentials and secret values masked, home paths shortened, then cut (mask, then cut). */
export function gitLineForWindow(stderrTail: string): string {
  const lines = String(stderrTail || '').split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : '';
  return maskHomePaths(maskSecretUrl(last)).slice(0, 300);
}

/** FR-012: the plain message for a failed claim. */
export function mkdirError(code: string, name: string): { error: string; retry: 'name' | 'place' } {
  if (code === 'EEXIST') return { error: `A folder or file named ${name} already exists there.`, retry: 'name' };
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return { error: 'You cannot create a folder there: it is read-only or not yours. Choose another place.', retry: 'place' };
  if (code === 'ENOENT' || code === 'ENOTDIR') return { error: 'That place no longer exists. Choose another place.', retry: 'place' };
  if (code === 'ENOSPC') return { error: 'The disk is full. Free some space or choose another place.', retry: 'place' };
  if (code === 'ENAMETOOLONG') return { error: 'This path is too long. Choose a shorter place or name.', retry: 'name' };
  return { error: `You cannot create a folder there${code ? ` (${code})` : ''}. Choose another place.`, retry: 'place' };
}

export const GIT_MISSING = 'Git was not found. Install Git and try again; Empty folder works without it.';

export function createNewFolderOp(d: NewFolderDeps) {
  /** FR-005: one pick at a time; a new pick replaces the old one. Spent by a successful create; a refusal or failure keeps it. */
  let pick: { token: string; path: string; at: number } | undefined;
  let busy = false;

  /** D2: the remembered parent, only when it is still an absolute path to a folder; else the system default (nothing shown). */
  async function startDir(): Promise<string | undefined> {
    const p = parseNewFolderParent(d.settings()?.newFolderParent);
    if (!p) return undefined;
    return (await d.fs.isDir(p).catch(() => false)) ? p : undefined;
  }

  /** `choose(start)` is main's system dialog (FR-004); it returns the picked folder or `undefined` when cancelled. */
  async function pickParent(choose: (start: string | undefined) => Promise<string | undefined>): Promise<PickResult> {
    const chosen = await choose(await startDir());
    if (typeof chosen !== 'string' || !chosen) return { ok: false, cancelled: true };
    if (!path.isAbsolute(chosen)) return { ok: false, error: 'Choose a folder on this computer.' };
    pick = { token: d.newToken(), path: chosen, at: d.now() };
    return { ok: true, token: pick.token, parent: chosen };
  }

  /** Own properties only: nothing is read from a prototype the window could have shaped. */
  const field = (r: unknown, k: string): unknown => (r && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, k) ? (r as Record<string, unknown>)[k] : undefined);
  const kindOf = (r: unknown): NewFolderKind | undefined => {
    const k = field(r, 'kind');
    return (NEW_FOLDER_KINDS as readonly unknown[]).includes(k) ? (k as NewFolderKind) : undefined;
  };

  /** FR-022 for phase 1: early feedback on the kind and the name; nothing is created. `folders:create` checks again. */
  function check(req: unknown): CheckResult {
    if (!kindOf(req)) return { ok: false, error: 'Choose what to create.' };
    const n = checkNewFolderName(field(req, 'name'));
    return n.ok ? { ok: true } : { ok: false, error: n.error };
  }

  /** FR-050: remove the folder this run claimed, retrying for Windows locks; '' when gone, else the message naming it. */
  async function removeClaimed(target: string): Promise<string> {
    for (let i = 0; i < REMOVE_TRIES; i++) {
      try {
        await d.fs.rm(target);
        return '';
      } catch (e) {
        const c = errCode(e);
        if (i === REMOVE_TRIES - 1 || !(c === 'EBUSY' || c === 'EPERM' || c === 'ENOTEMPTY' || c === 'EACCES')) break;
        await d.sleep(REMOVE_WAIT_MS);
      }
    }
    return ` The folder ${target} could not be removed: remove it by hand.`;
  }

  async function runInit(target: string): Promise<{ ok: true } | { ok: false; error: string }> {
    let hooksDir: string;
    try {
      hooksDir = await d.fs.mkdtemp(path.join(d.tmpDir(), 'durbar-hooks-'));
    } catch {
      return { ok: false, error: 'Could not prepare git (no temporary folder).' };
    }
    try {
      const h = d.runGitCreate({ kind: 'init' }, target, { hooksDir });
      let late = false;
      const clear = d.timer(INIT_LIMIT_MS, () => { late = true; h.cancel(); });
      const r = await h.done.finally(clear);
      if (r.spawnError === 'ENOENT') return { ok: false, error: GIT_MISSING };
      if (late) return { ok: false, error: 'git init did not finish in time.' };
      if (r.spawnError || r.code !== 0) {
        const line = gitLineForWindow(r.stderrTail);
        return { ok: false, error: `git init failed${line ? `: ${line}` : '.'}` };
      }
      return { ok: true };
    } finally {
      await d.fs.rm(hooksDir).catch(() => undefined); // FR-051: after every run
    }
  }

  /**
   * FR-005..FR-013, FR-042, FR-050, FR-060..FR-062. `req` is `{ kind, token, name }` from the window (unknown keys ignored, a path
   * is never read from it); `mode` is read with `validMode` (anything unknown is Read-only); `opts` is already parsed by the IPC layer.
   */
  async function create(req: unknown, mode: unknown, opts: SessionOptions & { persist?: boolean }): Promise<CreateResult> {
    const no = (error: string, retry?: 'name' | 'place'): CreateResult => ({ ok: false, agents: [], error, ...(retry ? { retry } : {}) });
    const kind = kindOf(req);
    if (!kind) return no('Choose what to create.');
    if (busy) return no('A folder is still being created.');
    const token = field(req, 'token');
    if (!pick || typeof token !== 'string' || token !== pick.token || d.now() - pick.at > PARENT_TOKEN_MS || d.now() < pick.at) return no('Choose the place again.', 'place');
    const n = checkNewFolderName(field(req, 'name'));
    if (!n.ok) return no(n.error, 'name');
    const parent = pick.path;
    const target = path.join(parent, n.name);
    if (d.platform === 'win32' && path.win32.join(parent, n.name).length > NEW_FOLDER_LIMITS.winPath) return no('This path is too long for Windows. Choose a shorter place or name.', 'name');
    busy = true;
    try {
      try {
        await d.fs.mkdir(target);
      } catch (e) {
        const m = mkdirError(errCode(e), n.name);
        return no(m.error, m.retry);
      }
      // from here on the folder is ours: every way out that does not add it removes it
      if (kind === 'init') {
        const r = await runInit(target);
        if (!r.ok) return no(r.error + (await removeClaimed(target)));
      }
      let added: AddResult;
      try {
        added = await d.addMany([target], validMode(mode), opts);
      } catch (e) {
        added = { ok: false, agents: [], error: e instanceof Error ? e.message : String(e) };
      }
      if (!added.ok || !added.agents.length) return no(`Could not add the new folder: ${added.error || 'unknown error'}.` + (await removeClaimed(target)));
      if (pick && pick.token === token) pick = undefined; // spent
      d.settings()?.setNewFolderParent(parent); // FR-006: on success only
      return { ...added, name: n.name };
    } finally {
      busy = false;
    }
  }

  return { pickParent, check, create, startDir };
}
export type NewFolderOp = ReturnType<typeof createNewFolderOp>;

/**
 * The real dependencies (the app, and the real-git test): Node's fs, where `rm` is recursive and forced and never follows a link
 * (it lstat's each entry and unlinks a link; nothing resolves the path first, FR-050, R2), the one git runner, a monotonic clock.
 */
export function nodeNewFolderDeps(o: { addMany: NewFolderDeps['addMany']; settings(): { newFolderParent: string | undefined; setNewFolderParent(p: string): void } | undefined; runGitCreate?: NewFolderDeps['runGitCreate'] }): NewFolderDeps {
  return {
    fs: {
      mkdir: (p) => fs.promises.mkdir(p), // never recursive: the claim (FR-012)
      rm: (p) => fs.promises.rm(p, { recursive: true, force: true }),
      mkdtemp: (prefix) => fs.promises.mkdtemp(prefix),
      isDir: (p) => fs.promises.stat(p).then((s) => s.isDirectory(), () => false),
    },
    tmpDir: () => os.tmpdir(),
    runGitCreate: o.runGitCreate ?? runGitCreate,
    addMany: o.addMany,
    settings: o.settings,
    now: () => performance.now(),
    newToken: () => randomUUID(),
    platform: process.platform,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    timer: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
  };
}
