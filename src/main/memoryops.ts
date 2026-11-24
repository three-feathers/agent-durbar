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
import type { MemoryFlavor, MemoryFolderCtx, MemoryRefusal } from '../shared/memoryfolder';
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
export function nodeMemoryCtx(fs: MemoryFsLike, base: Omit<MemoryFolderCtx, 'realpath' | 'lstat'>): MemoryFolderCtx {
  return { ...base, realpath: (p) => fs.realpathSync.native(p), lstat: (p) => fs.lstatSync(p) };
}

export interface MemoryOpsDeps {
  store(): MemoryStoreLike | undefined;
  /** the folder dialog: the chosen path, or null when cancelled (main's `pickFolder`) */
  pick(): Promise<string | null>;
  /** built at each call: the office folders change */
  ctx(): MemoryFolderCtx;
  flavor: MemoryFlavor;
  /** after a change, for the push `memory:changed` */
  changed?(): void;
  now?: () => number;
  newToken?: () => string;
}

const BAD: MemoryFail = { ok: false, error: 'invalid' };
const FAILED: MemoryFail = { ok: false, error: 'failed' };

export class MemoryOps {
  private live: { token: string; real: string; expiresAt: number } | undefined;
  /** counts every `pick`: a slower, older dialog must not replace a newer one */
  private gen = 0;
  constructor(private readonly deps: MemoryOpsDeps) {}
  private now(): number { return (this.deps.now ?? Date.now)(); }

  /** `~` for the home folder (case folded where the platform folds); anything else as it is */
  private shown(real: string): string {
    const { home } = this.deps.ctx();
    const f = this.deps.flavor;
    const fold = (s: string): string => (f.platform === 'linux' ? s : s.toLowerCase());
    const h = home.endsWith(f.path.sep) ? home.slice(0, -1) : home;
    return h && fold(real).startsWith(fold(h) + f.path.sep) ? '~' + real.slice(h.length) : real;
  }

  status(): MemoryStatus {
    const st = this.deps.store();
    const folder = st?.memoryFolder;
    const keepInGit = st?.memoryKeepInGit === true;
    if (!st || folder === undefined) return { on: false, state: 'off', keepInGit };
    const path = this.shown(folder);
    if (!st.memoryOn) return { on: false, path, state: 'off', keepInGit }; // off: the folder is not looked at (FR-001)
    let r;
    try { r = checkMemoryFolder(folder, this.deps.ctx(), this.deps.flavor); } catch { return { on: false, path, state: 'refused', reason: 'It could not be checked.', keepInGit }; }
    if (r.ok) return { on: true, path, state: 'on', keepInGit };
    const notFound: MemoryRefusal[] = ['unreadable', 'not-folder'];
    return { on: false, path, state: notFound.includes(r.reason) ? 'notFound' : 'refused', reason: r.text, keepInGit };
  }

  /** Main's dialog, then T002; a refusal gives no token. */
  async pick(): Promise<MemoryPicked> {
    const mine = ++this.gen;
    let chosen: string | null;
    try { chosen = await this.deps.pick(); } catch { return { ok: false, error: 'failed' }; }
    if (!chosen) return { ok: false, error: 'cancelled' };
    if (mine !== this.gen) return { ok: false, error: 'cancelled' }; // a newer pick won
    let r;
    try { r = checkMemoryFolder(chosen, this.deps.ctx(), this.deps.flavor); } catch { return { ok: false, error: 'failed' }; }
    if (!r.ok) { this.live = undefined; return { ok: false, error: 'refused', reason: r.text, path: this.shown(chosen) }; }
    const token = (this.deps.newToken ?? (() => randomBytes(16).toString('hex')))();
    this.live = { token, real: r.real, expiresAt: this.now() + TOKEN_MS };
    return { ok: true, token, expiresAt: this.live.expiresAt, path: this.shown(r.real) };
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
    try { r = checkMemoryFolder(e.real, this.deps.ctx(), this.deps.flavor); } catch { return FAILED; }
    if (!r.ok) return { ok: false, error: 'refused', reason: r.text };
    if (!st.setMemory(r.real)) return FAILED;
    this.deps.changed?.();
    return { ok: true, path: this.shown(r.real) };
  }

  setOn(v: unknown): MemoryResult {
    const st = this.deps.store();
    if (!st || typeof v !== 'boolean') return BAD;
    if (v) {
      const folder = st.memoryFolder;
      if (folder === undefined) return { ok: false, error: 'noFolder' };
      let r;
      try { r = checkMemoryFolder(folder, this.deps.ctx(), this.deps.flavor); } catch { return FAILED; }
      if (!r.ok) return { ok: false, error: 'refused', reason: r.text };
    }
    if (!st.setMemoryOn(v)) return FAILED;
    this.deps.changed?.();
    return { ok: true };
  }

  /** Only the settings: no file is read, written or removed. */
  stop(): MemoryResult {
    const st = this.deps.store();
    if (!st) return FAILED;
    this.live = undefined;
    const saved = st.setMemory(undefined);
    this.deps.changed?.(); // cleared for this run even when the file could not be written
    return saved ? { ok: true } : FAILED;
  }
}
