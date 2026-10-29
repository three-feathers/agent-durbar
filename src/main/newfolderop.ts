/**
 * Spec 093 (create a folder from + Folder): the part of main that creates the folder. No Electron: every outside effect is injected
 * (the file system, the git runner, `addMany`, settings, the clock), so `test:newfolderop` drives it with fakes and the real-git test
 * with the real ones. Phase 1: an empty folder or a new repository (`git init`). Phase 2: the clone (URL, progress, Cancel, quit).
 *
 * - The window never passes a path (FR-005, D1): main picks the parent with the system dialog and keeps it behind a token.
 * - The name is checked here (FR-010) and claimed with a non-recursive `mkdir` (FR-012, D3): nothing is created before the claim.
 * - Any failure after the claim removes exactly that folder, without following links (FR-050).
 * - Success adds it through `addMany` in the window's mode read with `validMode` (FR-060, FR-061), like Add existing.
 * - A clone streams masked progress (FR-040, FR-070), can be cancelled (FR-041) and is ended on quit (FR-043); its URL is checked
 *   here (FR-022) and again by the git runner.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import type { AddResult, PermMode, SessionOptions } from '../shared/api';
import { NEW_FOLDER_LIMITS, checkCloneUrl, checkNewFolderName, gitFailureText, parseCloneProgress, parseNewFolderParent, suggestedName } from '../shared/newfolder';
import { maskHomePaths, maskSecretUrl } from '../shared/redact';
import { CONTROL_RE, HIDDEN_RE } from '../shared/names';
import { validMode } from './agentops';
import { readUserSshCommand, runGitCreate } from './gitstatus';
import type { GitCreateDeps, GitCreateHandle, GitCreateRequest } from './gitstatus';

/** A parent pick is valid this long (FR-005). */
export const PARENT_TOKEN_MS = 10 * 60 * 1000;
/** Phase 1 has no Cancel in the window: `git init` that runs longer than this is ended and its folder removed. */
export const INIT_LIMIT_MS = 30 * 1000;
/** Removal tries (FR-050: Windows may hold a file for a moment after the process ends) and the wait between them. */
export const REMOVE_TRIES = 10;
export const REMOVE_WAIT_MS = 500;

/** FR-040: the least time between two progress events, the lines they carry, and the characters per line (FR-070). */
export const PROGRESS_MS = 250;
export const PROGRESS_LINES = 6;
export const LINE_MAX = 300;
/** FR-044: a clone quiet this long, with no progress line yet, gets the "still waiting" line. Nothing is ended automatically. */
export const WAITING_MS = 30 * 1000;
/** FR-043: on quit, the longest wait for a running clone to end and its folder to go. */
export const QUIT_WAIT_MS = 5 * 1000;

export type NewFolderKind = 'clone' | 'init' | 'empty';
export const NEW_FOLDER_KINDS: readonly NewFolderKind[] = ['clone', 'init', 'empty'];

export type PickResult = { ok: true; token: string; parent: string } | { ok: false; cancelled?: true; error?: string };
/** A clone URL that passed: its host (FR-061's Allow all sentence), the suggested name (FR-011) and the URL masked for display. */
export type CheckResult = { ok: true; host?: string; suggested?: string; shown?: string } | { ok: false; error: string; retry?: 'url' | 'name' };
/** `retry` tells the window which step to offer again: the URL, the name field, or the place (*Change place…*). */
export type CreateResult = (AddResult & { name?: string; retry?: 'url' | 'name' | 'place'; cancelled?: true; submodules?: true });
/** FR-040: one progress event (masked); `waiting` is FR-044's line. */
export interface CreateProgress { phase?: string; percent?: number; lines: string[]; elapsedMs: number; waiting?: true }

export interface NewFolderFs {
  /** Non-recursive: the atomic claim (EEXIST when the name is taken). */
  mkdir(p: string): Promise<void>;
  /** Recursive and forced; must not follow links (Node's `fs.rm` uses lstat and unlinks a link). */
  rm(p: string): Promise<void>;
  /** A private empty folder for the hooks path (FR-032). */
  mkdtemp(prefix: string): Promise<string>;
  /** Whether the path is a folder now (follows links: a symlinked parent is fine). */
  isDir(p: string): Promise<boolean>;
  /** Whether something is at the path (does not follow a link): the submodule note reads `.gitmodules`. */
  exists(p: string): Promise<boolean>;
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
  /** The user's own `core.sshCommand` for a clone (`readUserSshCommand`, run in the private hooks folder). */
  readSshCommand(hooksDir: string, url: string): Promise<string | undefined>;
  /** Sends `folders:createProgress` to the window (already masked here). */
  progress(p: CreateProgress): void;
}

const errCode = (e: unknown): string => (e && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : '');

/**
 * Removed from git's text before it is shown (a server's `remote:` lines are untrusted): the shared control and invisible lists
 * (`CONTROL_RE`, `HIDDEN_RE`, src/shared/names.ts), plus ZWNJ, ZWJ, LRM, RLM and the Arabic letter mark, which names allow but a
 * line of git's output does not need. Built from the shared lists, so it never falls behind them.
 */
const UNSHOWN_RE = new RegExp(`${CONTROL_RE.source}|${HIDDEN_RE.source}|[\\u200c-\\u200f\\u061c]`, 'g');
/** FR-070: one line of git's text for the window or the log: masked (credentials, secret values, home paths), then cut. */
export function maskGitLine(line: string): string {
  return maskHomePaths(maskSecretUrl(String(line || '').replace(UNSHOWN_RE, ' ').trim())).slice(0, LINE_MAX);
}
/** git's stderr split into its lines (git ends a progress line with `\r`, other lines with `\n`). */
const linesOf = (text: string): string[] => String(text || '').split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
/**
 * FR-070, FR-071: git's line for the window: its last `fatal:` line (git adds a "Please make sure you have the correct access rights"
 * paragraph after it), else its last line; masked, then cut (mask, then cut).
 */
export function gitLineForWindow(stderrTail: string): string {
  const lines = linesOf(stderrTail);
  const fatal = lines.filter((l) => /^fatal:/i.test(l));
  const pick = fatal.length ? fatal[fatal.length - 1] : lines[lines.length - 1];
  return pick ? maskGitLine(pick) : '';
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
export const CANCELLED = 'Cancelled. Nothing was kept.';

export function createNewFolderOp(d: NewFolderDeps) {
  /** FR-005: one pick at a time; a new pick replaces the old one. Spent by a successful create; a refusal or failure keeps it. */
  let pick: { token: string; path: string; at: number } | undefined;
  let busy = false;
  /** The create that runs now (FR-042: one at a time): its promise (quit waits for it), whether Cancel was asked, the git run. */
  let current: { done: Promise<CreateResult>; cancelled: boolean; git?: GitCreateHandle } | undefined;

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

  /**
   * FR-022: early feedback; nothing is created and nothing runs. `folders:create` checks again. Clone: the URL, and the name when the
   * request has one (the URL dialog comes before the name); the answer carries the host, the suggested name and the masked URL.
   * Empty folder and new repository: the name.
   */
  function check(req: unknown): CheckResult {
    const kind = kindOf(req);
    if (!kind) return { ok: false, error: 'Choose what to create.' };
    let extra: { host?: string; suggested?: string; shown?: string } = {};
    if (kind === 'clone') {
      const u = checkCloneUrl(field(req, 'url'));
      if (!u.ok) return { ok: false, error: u.error, retry: 'url' };
      extra = { host: u.host, suggested: suggestedName(u.url), shown: maskGitLine(u.url) };
      if (field(req, 'name') === undefined) return { ok: true, ...extra };
    }
    const n = checkNewFolderName(field(req, 'name'));
    return n.ok ? { ok: true, ...extra } : { ok: false, error: n.error, retry: 'name' };
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

  async function runInit(target: string, cur: NonNullable<typeof current>): Promise<{ ok: true } | { ok: false; error: string }> {
    let hooksDir: string;
    try {
      hooksDir = await d.fs.mkdtemp(path.join(d.tmpDir(), 'durbar-hooks-'));
    } catch {
      return { ok: false, error: 'Could not prepare git (no temporary folder).' };
    }
    try {
      let h: GitCreateHandle;
      try {
        h = d.runGitCreate({ kind: 'init' }, target, { hooksDir });
      } catch {
        return { ok: false, error: 'Could not start git.' }; // the runner refused the call: nothing ran, the folder goes
      }
      cur.git = h; // Cancel and quit end it too
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
   * FR-036, FR-037, FR-040..FR-044, FR-071: one clone into `target` (already claimed). No overall time limit; Cancel (`cur.cancelled`)
   * ends the git run, and the caller removes the folder only after git has exited (`done` settles on close).
   */
  async function runClone(target: string, url: string, host: string, cur: NonNullable<typeof current>): Promise<{ ok: true } | { ok: false; error: string; cancelled?: true }> {
    let hooksDir: string;
    try {
      hooksDir = await d.fs.mkdtemp(path.join(d.tmpDir(), 'durbar-hooks-'));
    } catch {
      return { ok: false, error: 'Could not prepare git (no temporary folder).' };
    }
    const start = d.now();
    let raw = '';
    let lastSent = -Infinity;
    let phaseSeen = false;
    let waiting = false;
    let ended = false;
    let clearSend: (() => void) | undefined;
    let clearWait: (() => void) | undefined;
    // FR-040: only whole lines (ended by \r or \n) are shown, so a line is masked as a whole, never in pieces
    const send = (): void => {
      clearSend = undefined;
      if (ended) return;
      lastSent = d.now();
      const whole = raw.slice(0, Math.max(raw.lastIndexOf('\r'), raw.lastIndexOf('\n')) + 1);
      const all = linesOf(whole);
      let pr: ReturnType<typeof parseCloneProgress>;
      for (let i = all.length - 1; i >= 0 && !pr; i--) pr = parseCloneProgress(all[i]);
      if (pr) phaseSeen = true;
      d.progress({ ...(pr ? { phase: pr.phase, ...(pr.percent !== undefined ? { percent: pr.percent } : {}) } : {}), lines: all.slice(-PROGRESS_LINES).map(maskGitLine), elapsedMs: Math.max(0, d.now() - start), ...(waiting ? { waiting: true as const } : {}) });
    };
    // FR-044: after 30 s without output and no progress line yet, the window adds the "still waiting" line; the next output removes it
    const armWait = (): void => {
      clearWait?.();
      clearWait = d.timer(WAITING_MS, () => { if (!ended && !phaseSeen) { waiting = true; clearSend?.(); send(); } });
    };
    const onOutput = (text: string): void => {
      if (ended) return;
      raw = (raw + text).slice(-16384);
      if (waiting) { waiting = false; clearSend?.(); send(); } else if (!clearSend) {
        const gap = d.now() - lastSent;
        if (gap >= PROGRESS_MS) send();
        else clearSend = d.timer(PROGRESS_MS - gap, send);
      }
      armWait();
    };
    try {
      if (cur.cancelled) return { ok: false, error: CANCELLED, cancelled: true };
      const userSshCommand = await d.readSshCommand(hooksDir, url).catch(() => undefined);
      if (cur.cancelled) return { ok: false, error: CANCELLED, cancelled: true };
      armWait();
      let h: GitCreateHandle;
      try {
        h = d.runGitCreate({ kind: 'clone', url }, target, { hooksDir, userSshCommand, onOutput });
      } catch {
        return { ok: false, error: 'Could not start git.' }; // the runner refused the call (its own URL check): nothing ran, the folder goes
      }
      cur.git = h;
      const r = await h.done; // settles on close: git and what it started have exited
      cur.git = undefined;
      if (cur.cancelled) return { ok: false, error: CANCELLED, cancelled: true };
      if (r.spawnError === 'ENOENT') return { ok: false, error: GIT_MISSING };
      if (r.spawnError || r.code !== 0) {
        const plain = gitFailureText(r.stderrTail, host);
        const line = gitLineForWindow(r.stderrTail);
        return { ok: false, error: (plain || 'The clone failed.') + (line ? ` git said: ${line}` : '') };
      }
      return { ok: true };
    } finally {
      ended = true;
      clearSend?.();
      clearWait?.();
      await d.fs.rm(hooksDir).catch(() => undefined); // FR-051: after every run
    }
  }

  /**
   * FR-005..FR-013, FR-020..FR-023, FR-042, FR-050, FR-060..FR-062. `req` is `{ kind, token, name, url? }` from the window (unknown
   * keys ignored, a path is never read from it); `mode` is read with `validMode` (anything unknown is Read-only); `opts` is already
   * parsed by the IPC layer.
   */
  function create(req: unknown, mode: unknown, opts: SessionOptions & { persist?: boolean }): Promise<CreateResult> {
    if (busy) return Promise.resolve({ ok: false, agents: [], error: 'A folder is still being created.' });
    const cur: NonNullable<typeof current> = { done: Promise.resolve({ ok: false, agents: [] }), cancelled: false };
    cur.done = createNow(req, mode, opts, cur).finally(() => { if (current === cur) current = undefined; });
    return cur.done;
  }

  async function createNow(req: unknown, mode: unknown, opts: SessionOptions & { persist?: boolean }, cur: NonNullable<typeof current>): Promise<CreateResult> {
    const no = (error: string, retry?: 'url' | 'name' | 'place'): CreateResult => ({ ok: false, agents: [], error, ...(retry ? { retry } : {}) });
    const kind = kindOf(req);
    if (!kind) return no('Choose what to create.');
    if (busy) return no('A folder is still being created.');
    const token = field(req, 'token');
    if (!pick || typeof token !== 'string' || token !== pick.token || d.now() - pick.at > PARENT_TOKEN_MS || d.now() < pick.at) return no('Choose the place again.', 'place');
    const n = checkNewFolderName(field(req, 'name'));
    if (!n.ok) return no(n.error, 'name');
    let url: { url: string; host: string } | undefined;
    if (kind === 'clone') {
      const u = checkCloneUrl(field(req, 'url')); // FR-022: authoritative
      if (!u.ok) return no(u.error, 'url');
      url = u;
    }
    const parent = pick.path;
    const target = path.join(parent, n.name);
    if (d.platform === 'win32' && path.win32.join(parent, n.name).length > NEW_FOLDER_LIMITS.winPath) return no('This path is too long for Windows. Choose a shorter place or name.', 'name');
    busy = true;
    current = cur;
    try {
      try {
        await d.fs.mkdir(target);
      } catch (e) {
        const m = mkdirError(errCode(e), n.name);
        return no(m.error, m.retry);
      }
      // from here on the folder is ours: every way out that does not add it removes it
      if (kind === 'init') {
        const r = await runInit(target, cur);
        if (!r.ok) {
          const left = await removeClaimed(target);
          return cur.cancelled ? { ok: false, agents: [], cancelled: true, error: CANCELLED + left } : no(r.error + left);
        }
      }
      let submodules = false;
      if (kind === 'clone' && url) {
        const r = await runClone(target, url.url, url.host, cur);
        if (!r.ok) {
          const left = await removeClaimed(target); // after git has exited (FR-041), never following links (FR-050)
          return r.cancelled ? { ok: false, agents: [], cancelled: true, error: CANCELLED + left } : no(r.error + left);
        }
        submodules = await d.fs.exists(path.join(target, '.gitmodules')).catch(() => false);
      }
      if (cur.cancelled) return { ok: false, agents: [], cancelled: true, error: CANCELLED + (await removeClaimed(target)) };
      let added: AddResult;
      try {
        added = await d.addMany([target], validMode(mode), opts);
      } catch (e) {
        added = { ok: false, agents: [], error: e instanceof Error ? e.message : String(e) };
      }
      if (!added.ok || !added.agents.length) return no(`Could not add the new folder: ${added.error || 'unknown error'}.` + (await removeClaimed(target)));
      if (pick && pick.token === token) pick = undefined; // spent
      d.settings()?.setNewFolderParent(parent); // FR-006: on success only
      return { ...added, name: n.name, ...(submodules ? { submodules: true as const } : {}) };
    } finally {
      busy = false;
    }
  }

  /** FR-041: Cancel ends the running clone's git (and only it, `killChildTree` in the runner); the create then removes the folder. */
  function cancel(): { ok: boolean } {
    const cur = current;
    if (!cur || !busy) return { ok: false };
    cur.cancelled = true;
    cur.git?.cancel();
    return { ok: true };
  }

  /** FR-043: on quit, end a running create and wait for its cleanup, at most `QUIT_WAIT_MS`. True when nothing is left running. */
  async function quit(): Promise<boolean> {
    const cur = current;
    if (!cur) return true;
    cancel();
    let clear: (() => void) | undefined;
    const late = new Promise<false>((r) => { clear = d.timer(QUIT_WAIT_MS, () => r(false)); });
    const ok = await Promise.race([cur.done.then(() => true as const, () => true as const), late]);
    clear?.();
    return ok;
  }

  return { pickParent, check, create, cancel, quit, busy: () => busy, startDir };
}
export type NewFolderOp = ReturnType<typeof createNewFolderOp>;

/**
 * The real dependencies (the app, and the real-git test): Node's fs, where `rm` is recursive and forced and never follows a link
 * (it lstat's each entry and unlinks a link; nothing resolves the path first, FR-050, R2), the one git runner, a monotonic clock.
 */
export function nodeNewFolderDeps(o: { addMany: NewFolderDeps['addMany']; settings(): { newFolderParent: string | undefined; setNewFolderParent(p: string): void } | undefined; runGitCreate?: NewFolderDeps['runGitCreate']; readSshCommand?: NewFolderDeps['readSshCommand']; progress?: NewFolderDeps['progress'] }): NewFolderDeps {
  return {
    fs: {
      mkdir: (p) => fs.promises.mkdir(p), // never recursive: the claim (FR-012)
      rm: (p) => fs.promises.rm(p, { recursive: true, force: true }),
      mkdtemp: (prefix) => fs.promises.mkdtemp(prefix),
      isDir: (p) => fs.promises.stat(p).then((s) => s.isDirectory(), () => false),
      exists: (p) => fs.promises.lstat(p).then(() => true, () => false),
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
    readSshCommand: o.readSshCommand ?? ((hooksDir, url) => readUserSshCommand({ hooksDir, url })),
    progress: o.progress ?? (() => undefined),
  };
}
