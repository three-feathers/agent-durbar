/**
 * Spec 085: what a session did, read from git when it ends. From the first message Durbar sends in this run, main keeps a start (time,
 * start commit, whether the tree was clean); `summarize` compares the folder with it. Read-only: `git` runs with an argument array (no
 * shell), `--no-optional-locks`, the limits of spec 063; the only value that reaches an argument is a commit id that main itself read
 * and checked to be hex; `diff` runs with `--no-ext-diff --no-textconv`, so no diff helper configured for the folder runs. Nothing is stored on disk. Any failure is `{ repo: false }`, never an invented zero.
 */
import { folderGitStatus, nodeGitExec } from './gitstatus';
import type { GitExec } from './gitstatus';

export interface SessionGit {
  repo: true;
  files: number;
  added: number;
  removed: number;
  binary: number;
  /** Untracked files now present; only counted when the tree was clean at the start. */
  newFiles: number;
  commits: number;
  /** The folder already had uncommitted changes at the start: the counts include them. */
  dirtyAtStart: boolean;
  /** The folder had no commit at the start: files and lines are not counted (there is nothing to compare with). */
  noHead?: boolean;
}
export type SessionSummary = { ok: true; ms: number; git: { repo: false } | SessionGit } | { ok: false; error: string };

const MAX_COUNT = 1_000_000_000;
/** A count from git output: a safe, bounded integer, else 0. */
const num = (s: string | undefined): number => {
  const n = s && /^\d{1,12}$/.test(s) ? Number(s) : 0;
  return Number.isSafeInteger(n) ? Math.min(n, MAX_COUNT) : 0;
};

/** A commit id as main read it: 40 (SHA-1) or 64 (SHA-256) lower-case hex characters. */
export const validRef = (s: string): string | undefined => {
  const t = s.trim();
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(t) ? t : undefined;
};

/** `git diff --shortstat`: " 3 files changed, 10 insertions(+), 2 deletions(-)" (either part may be missing). Only the first 1 KB of the output is read. */
export function parseShortstat(out: string): { files: number; added: number; removed: number } {
  const t = String(out).slice(0, 1024);
  const f = /(\d+) files? changed/.exec(t);
  const a = /(\d+) insertions?\(\+\)/.exec(t);
  const d = /(\d+) deletions?\(-\)/.exec(t);
  return { files: num(f?.[1]), added: num(a?.[1]), removed: num(d?.[1]) };
}

/** `git rev-list --count`: one integer on one line, else 0. */
export const parseCount = (out: string): number => num(String(out).slice(0, 32).trim());

/** `git diff --numstat` lines "-\t-\tpath" are binary files: how many (paths are not read, only counted). */
export function countBinary(numstat: string): number {
  let n = 0;
  for (const line of String(numstat).slice(0, 512 * 1024).split('\n')) if (line.startsWith('-\t-\t')) n++;
  return Math.min(n, MAX_COUNT);
}

interface Start { at: number; ref?: string; clean: boolean; noHead: boolean; repo: boolean }

export class SessionStarts {
  private readonly starts = new Map<string, Start>();
  constructor(private readonly exec: GitExec = nodeGitExec, private readonly now: () => number = () => performance.now()) {}

  has(id: string): boolean {
    return this.starts.has(id);
  }

  /** The first message of the session in this run; later calls do nothing. Never throws: a folder that is not a repository is a start without git. */
  async noteStart(id: string, dir: string): Promise<void> {
    if (this.starts.has(id)) return;
    const at = this.now();
    this.starts.set(id, { at, clean: false, noHead: false, repo: false }); // set at once: a second send while git runs is not a second start
    try {
      const st = await folderGitStatus(dir, this.exec);
      if (!st.repo) return;
      let ref: string | undefined;
      try {
        ref = validRef(await this.exec(['-C', dir, 'rev-parse', '--verify', '-q', 'HEAD']));
      } catch {
        ref = undefined;
      }
      this.starts.set(id, { at, ref, clean: st.files.length + st.more === 0, noHead: !ref, repo: true });
    } catch {
      /* keeps the start without git */
    }
  }

  forget(id: string): void {
    this.starts.delete(id);
  }

  async summarize(id: string, dir: string): Promise<SessionSummary> {
    const s = this.starts.get(id);
    if (!s) return { ok: false, error: 'This session has not been sent a message in this run.' };
    const ms = Math.max(0, Math.min(Math.round(this.now() - s.at), 366 * 24 * 3600 * 1000));
    if (!s.repo) return { ok: true, ms, git: { repo: false } };
    try {
      const stat = s.ref ? parseShortstat(await this.exec(['-C', dir, 'diff', '--no-ext-diff', '--no-textconv', '--shortstat', s.ref, '--'])) : { files: 0, added: 0, removed: 0 }; // no commit at the start: no base to compare with
      const bin = s.ref ? countBinary(await this.exec(['-C', dir, 'diff', '--no-ext-diff', '--no-textconv', '--numstat', s.ref, '--']).catch(() => '')) : 0;
      const commits = s.ref
        ? parseCount(await this.exec(['-C', dir, 'rev-list', '--count', `${s.ref}..HEAD`]).catch(() => '0'))
        : parseCount(await this.exec(['-C', dir, 'rev-list', '--count', 'HEAD']).catch(() => '0'));
      const now = await folderGitStatus(dir, this.exec);
      if (!now.repo) return { ok: true, ms, git: { repo: false } };
      const untracked = now.files.filter((f) => f.state === 'untracked').length;
      const newFiles = s.clean ? Math.min(untracked + (now.more > 0 ? now.more : 0), MAX_COUNT) : 0;
      return { ok: true, ms, git: { repo: true, files: stat.files, added: stat.added, removed: stat.removed, binary: Math.min(bin, stat.files), newFiles, commits, dirtyAtStart: !s.clean, ...(s.noHead ? { noHead: true } : {}) } };
    } catch {
      return { ok: true, ms, git: { repo: false } };
    }
  }
}
