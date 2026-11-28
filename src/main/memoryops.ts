/**
 * Office memory (spec 116 T003; FR-001, FR-002, FR-004): which folder is linked, whether it is on, and how the person links one. Pure logic over
 * injected dependencies (no Electron, no disk here): `scripts/test-memoryops.ts` drives it with fakes; `src/main/ipc/memory.ts` is only the
 * `ipcHandle` wiring.
 *
 * The window never sends a path. `pick` opens main's own folder dialog, runs `checkMemoryFolder` (T002, the one path check; not rebuilt here) and
 * answers a token (128 bits, 10 minutes, one alive at a time, the shape of `teamops.ts`) that stands for the checked real path. `apply(token)` takes the
 * token once (an unknown, expired or used token fails), runs the check AGAIN on the stored real path (a folder may have changed since the pick), and only
 * then saves. `stop` clears the two settings and touches no file. While it is off, `status` does not look at the folder at all (FR-001).
 *
 * Answers are fixed words and numbers; the path is shown as the person knows it, under `~` (owner decision of 2026-11-23: paths are shown, only real
 * secrets are masked). No log line, no throw text.
 */
import { randomBytes } from 'crypto';
import { checkMemoryFolder } from '../shared/memoryfolder';
import { readCapped } from '../shared/cappedread';
import type { CappedFs, CappedFlags } from '../shared/cappedread';
import type { MemoryFlavor, MemoryFolderCtx, MemoryFolderCheck, MemoryRefusal, RemoteAnswer } from '../shared/memoryfolder';
import type { MemoryApplied, MemoryFail, MemoryPicked, MemoryResult, MemoryStatus } from '../shared/api';

/** how long a pick's token lives */
export const TOKEN_MS = 600_000;
const TOKEN_RE = /^[0-9a-f]{32}$/;

export interface MemoryStoreLike {
  readonly memoryFolder: string | undefined;
  readonly memoryOn: boolean;
  readonly memoryKeepInGit: boolean;
  setMemory(folder: string | undefined): boolean;
  setMemoryOn(v: unknown): boolean;
}
/** The pieces of `fs` the check needs; main passes the real `fs`. */
export interface MemoryFsLike {
  realpathSync: { native(p: string): string };
  lstatSync(p: string): { isDirectory(): boolean };
}
/** `ctx.realpath` is `fs.realpathSync.native`, never the JS `realpathSync` (it keeps Windows 8.3 short names, so `PROGRA~1` would not match a denylist entry; T003). */
export function nodeMemoryCtx(fs: MemoryFsLike, base: Omit<MemoryFolderCtx, 'realpath' | 'lstat' | 'officeFolders'>): Omit<MemoryFolderCtx, 'officeFolders'> {
  return { ...base, realpath: (p) => fs.realpathSync.native(p), lstat: (p) => fs.lstatSync(p) };
}

/**
 * Every office folder for rule 4, each `.code-workspace` entry (open or saved) expanded to ALL its member folders through `read` (main passes
 * `readCodeWorkspaceFolders`): the first folder is only the session's cwd. A workspace file that cannot be read THROWS (fail closed: the memory
 * folder cannot be judged, so it is refused, never accepted).
 */
/** A workspace file that could not be read; the refusal names it (paths are shown, owner decision of 2026-11-23). */
export class WorkspaceUnreadable extends Error {
  constructor(readonly file: string) { super('workspace unreadable'); }
}

export function expandOfficeFolders(entries: readonly string[], read: (file: string) => string[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    out.push(e);
    if (isWorkspaceFile(e)) {
      try { out.push(...read(e)); } catch { throw new WorkspaceUnreadable(e); }
    }
  }
  return out;
}
const isWorkspaceFile = (e: string): boolean => /\.code-workspace$/i.test(e);

/**
 * The office folders for rule 4 (spec 116 round 4, P2): an OPEN agent contributes the folders it actually runs with (`folders`, never re-read from its
 * file: an edited file must not make a live write root pickable) and its workspace file; a SAVED folder with no live agent is expanded from its file.
 * `liveKeys` are the saved-folder keys of the open agents (`workspaceFile ?? cwd`). An unreadable workspace file throws `WorkspaceUnreadable`.
 */
export function collectOfficeFolders(live: ReadonlyArray<{ key: string; folders: readonly string[]; workspaceFile?: string }>, saved: readonly string[], read: (file: string) => string[]): string[] {
  const out: string[] = [];
  const open = new Set<string>();
  for (const a of live) { open.add(a.key); out.push(...a.folders); if (a.workspaceFile) out.push(a.workspaceFile); }
  out.push(...expandOfficeFolders(saved.filter((s) => !open.has(s)), read));
  return out;
}

/** 1 MB: a `.code-workspace` file is a few lines (P1: never read a bigger one, and never open a FIFO). */
export const MAX_WORKSPACE_BYTES = 1024 * 1024;
/**
 * The reader of a workspace file for `expandOfficeFolders`: the file's `realpath` is resolved first (a symlinked `.code-workspace` is common) and that
 * path goes through the one capped, non-blocking, no-follow read (`readCapped`, the flags of `memoryGitFlags`): a FIFO or a huge file behind a link still
 * fails fast. Decisions (spec 116 round 5): a hard link is read (`readCapped` refuses `nlink > 1`; following one only adds folders to the refusal list, so
 * the check is switched off here by reporting one link); a file that does not exist, or a dangling link, adds no folder (nothing to protect; it is read again
 * when it appears) and does NOT block every pick; any other failure (a FIFO, too big, no access, bad JSON) throws and refuses, naming the file.
 */
export function cappedWorkspaceReader(fs: CappedFs, k: CappedFlags, parse: (text: string, file: string) => string[], realpath: (p: string) => string): (file: string) => string[] {
  // never spread a real fs.Stats: `isFile` lives on its prototype (a spread loses it and every real file would be refused)
  const hardLinksOk: CappedFs = { ...fs, openSync: (f, fl) => fs.openSync(f, fl), fstatSync: (fd) => { const st = fs.fstatSync(fd); return { isFile: () => st.isFile(), size: st.size, nlink: 1 }; } };
  return (file) => {
    let real: string;
    try { real = realpath(file); } catch (e) {
      if ((e as { code?: unknown } | null)?.code === 'ENOENT') return []; // missing or dangling
      throw new Error('workspace unreadable');
    }
    const r = readCapped(hardLinksOk, k, real, MAX_WORKSPACE_BYTES);
    if (!r.ok) {
      if (r.code === 'missing') return [];
      throw new Error('workspace unreadable');
    }
    return parse(r.buf.toString('utf8'), file);
  };
}

/**
 * The one hook of T008: the office's agents live in one Map, and every add (new session, add folder, add workspace file, restore at start, a team
 * member) and every removal goes through its `set` and `delete`, so `onChange` (main: `memoryOps.recheck()`) runs after each. It runs after the change
 * and never throws into the caller.
 */
export class OfficeMap<K, V> extends Map<K, V> {
  constructor(private readonly onChange: () => void) { super(); }
  override set(k: K, v: V): this { super.set(k, v); this.notify(); return this; }
  override delete(k: K): boolean { const r = super.delete(k); if (r) this.notify(); return r; }
  private notify(): void { try { this.onChange(); } catch { /* the office change already happened */ } }
}

export interface MemoryOpsDeps {
  store(): MemoryStoreLike | undefined;
  /** the folder dialog: the chosen path, or null when cancelled (main's `pickFolder`) */
  pick(): Promise<string | null>;
  /** built at each call */
  ctx(): Omit<MemoryFolderCtx, 'officeFolders'>;
  /** built at each call: the office folders change; every workspace member included (`expandOfficeFolders`); throws when a workspace file cannot be read */
  officeFolders(): string[];
  /** `memoryGitRemote` on a real path (T004): the answer goes to the window as it is */
  remote?(real: string): RemoteAnswer;
  flavor: MemoryFlavor;
  /** after a change, for the push `memory:changed` */
  changed?(): void;
  now?: () => number;
  newToken?: () => string;
}

const CHANGED = 'The folder is not the one you chose (it changed since). Choose it again.';
const wsUnreadable = (file: unknown): string => `The workspace file ${typeof file === 'string' ? file.slice(0, 300) : ''} could not be read, so the folder cannot be checked.`;
const BAD: MemoryFail = { ok: false, error: 'invalid' };
const FAILED: MemoryFail = { ok: false, error: 'failed' };

export class MemoryOps {
  private live: { token: string; chosen: string; real: string; expiresAt: number } | undefined;
  /** counts every `pick`: a slower, older dialog must not replace a newer one */
  private gen = 0;
  /** what the window last saw (a `status` read or a push): `recheck` pushes only a difference */
  private seen: string | undefined;
  constructor(private readonly deps: MemoryOpsDeps) {}
  private now(): number { return (this.deps.now ?? Date.now)(); }

  /** T002 with the office folders of this moment; an unreadable workspace file refuses (fixed words) */
  private check(candidate: string, extraOffice: readonly string[] = []): MemoryFolderCheck {
    let office: string[];
    try { office = this.deps.officeFolders(); } catch (e) { return { ok: false, reason: 'office-folder', text: wsUnreadable((e as { file?: unknown } | null)?.file) }; }
    return checkMemoryFolder(candidate, { ...this.deps.ctx(), officeFolders: [...office, ...extraOffice] }, this.deps.flavor);
  }

  /** `~` for the home folder (case folded where the platform folds); anything else as it is */
  private shown(real: string): string {
    const { home } = this.deps.ctx();
    const f = this.deps.flavor;
    const fold = (s: string): string => (f.platform === 'linux' ? s : s.toLowerCase());
    const h = home.endsWith(f.path.sep) ? home.slice(0, -1) : home;
    return h && fold(real).startsWith(fold(h) + f.path.sep) ? '~' + real.slice(h.length) : real;
  }

  /** the refusal's sentence, with the clashing office folder named when there is one (T008; paths are shown) */
  private said(r: { text: string; clash?: string }): string {
    return r.clash === undefined ? r.text : `${r.text} The folder: ${this.shown(r.clash.slice(0, 300))}`;
  }

  private same(a: string, b: string): boolean {
    const fold = (x: string): string => (this.deps.flavor.platform === 'linux' ? x : x.toLowerCase());
    return fold(a) === fold(b);
  }

  status(): MemoryStatus {
    const r = this.statusNow();
    this.seen = JSON.stringify(r);
    return r;
  }

  private statusNow(): MemoryStatus {
    const st = this.deps.store();
    const folder = st?.memoryFolder;
    const keepInGit = st?.memoryKeepInGit === true;
    if (!st || folder === undefined) return { on: false, state: 'off', keepInGit };
    const path = this.shown(folder);
    if (!st.memoryOn) return { on: false, path, state: 'off', keepInGit }; // off: the folder is not looked at (FR-001)
    let r;
    try { r = this.check(folder); } catch { return { on: false, path, state: 'refused', reason: 'It could not be checked.', keepInGit }; }
    if (r.ok) return { on: true, path, state: 'on', keepInGit };
    const notFound: MemoryRefusal[] = ['unreadable', 'not-folder'];
    return { on: false, path, state: notFound.includes(r.reason) ? 'notFound' : 'refused', reason: this.said(r), keepInGit };
  }

  /**
   * Spec 116 FR-020/FR-023: the real path of the memory folder for a session start, or none. Empty while the memory is off, refused or not found: T002
   * runs again now (the stored path is not trusted: the folder may have become a link, moved or been refused since), and any doubt gives none.
   * `extraOffice`: the folders (workspace file and members included) of the session being started: a folder that holds the memory folder, or lies inside it, gets none.
   */
  readRoots(extraOffice: readonly string[] = []): string[] {
    const st = this.deps.store();
    const folder = st?.memoryFolder;
    if (!st || folder === undefined || !st.memoryOn) return [];
    try {
      const r = this.check(folder, extraOffice); // the session being started is not in the office yet (main adds it after the start), so the caller names its folders
      return r.ok ? [r.real] : [];
    } catch { return []; }
  }

  /** Main's dialog, then T002; a refusal gives no token. */
  async pick(): Promise<MemoryPicked> {
    const mine = ++this.gen;
    let chosen: string | null;
    try { chosen = await this.deps.pick(); } catch { return { ok: false, error: 'failed' }; }
    if (!chosen) return { ok: false, error: 'cancelled' };
    if (mine !== this.gen) return { ok: false, error: 'cancelled' }; // a newer pick won
    let r;
    try { r = this.check(chosen); } catch { return { ok: false, error: 'failed' }; }
    if (!r.ok) { this.live = undefined; return { ok: false, error: 'refused', reason: r.text, path: this.shown(chosen) }; }
    const token = (this.deps.newToken ?? (() => randomBytes(16).toString('hex')))();
    this.live = { token, chosen, real: r.real, expiresAt: this.now() + TOKEN_MS };
    let remote: RemoteAnswer = { kind: 'unknown' };
    try { if (this.deps.remote) remote = this.deps.remote(r.real); } catch { remote = { kind: 'unknown' }; }
    return { ok: true, token, expiresAt: this.live.expiresAt, path: this.shown(r.real), remote };
  }

  /** The token is taken once. The check runs again before anything is saved. */
  apply(token: unknown): MemoryApplied {
    const e = this.live;
    if (!e || typeof token !== 'string' || !TOKEN_RE.test(token) || token !== e.token) return BAD;
    this.live = undefined;
    if (this.now() >= e.expiresAt) return BAD;
    const st = this.deps.store();
    if (!st) return FAILED;
    let r;
    try { r = this.check(e.chosen); } catch { return FAILED; }
    if (!r.ok) return { ok: false, error: 'refused', reason: r.text };
    // the picked path is resolved again: a link repointed since the person confirmed must not slip in (FR-002); what is saved is this fresh real path
    if (!this.same(r.real, e.real)) return { ok: false, error: 'refused', reason: CHANGED };
    if (!st.setMemory(r.real)) return FAILED;
    this.emit();
    return { ok: true, path: this.shown(r.real) };
  }

  setOn(v: unknown): MemoryResult {
    const st = this.deps.store();
    if (!st || typeof v !== 'boolean') return BAD;
    if (v) {
      const folder = st.memoryFolder;
      if (folder === undefined) return { ok: false, error: 'noFolder' };
      let r;
      try { r = this.check(folder); } catch { return FAILED; }
      if (!r.ok) return { ok: false, error: 'refused', reason: r.text };
    }
    if (!st.setMemoryOn(v)) return FAILED;
    this.emit();
    return { ok: true };
  }

  private emit(): void {
    this.status(); // what the window is about to be told is what it has seen
    this.deps.changed?.();
  }

  /**
   * T008 (FR-004): an office folder was added, removed or changed. The check of rule 4 runs again on the memory folder as it is now; when the
   * answer differs from what the window last saw (a new clash turns the memory off as `state: refused`, naming the folder; a clash that went away
   * brings it back), `changed` pushes once. Nothing is stored: the stored folder and `on` stay as the person set them, so `on` is not rewritten behind
   * her back and no file is touched; `readRoots` runs the same check at every session start, so new sessions get no root while the clash lasts and
   * running sessions keep the roots they started with until they restart (US1.5). With no baseline yet (the window never read it) only a refusal is
   * pushed. Never throws: a failure here must not break adding a folder.
   */
  recheck(): void {
    try {
      const st = this.deps.store();
      if (!st || st.memoryFolder === undefined || !st.memoryOn) return; // off or no folder: nothing to turn off, and no folder is looked at (FR-001)
      const before = this.seen;
      const now = this.statusNow();
      const key = JSON.stringify(now);
      if (key === before) return;
      if (before === undefined && now.state === 'on') { this.seen = key; return; }
      this.seen = key;
      this.deps.changed?.();
    } catch { /* adding a folder never fails because of the memory */ }
  }

  /** Only the settings: no file is read, written or removed. */
  stop(): MemoryResult {
    const st = this.deps.store();
    if (!st) return FAILED;
    this.live = undefined;
    this.gen++; // a pick dialog still open answers cancelled
    const saved = st.setMemory(undefined);
    this.emit(); // cleared for this run even when the file could not be written
    return saved ? { ok: true } : FAILED;
  }
}
