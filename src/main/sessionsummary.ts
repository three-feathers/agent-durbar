/**
 * Spec 085: what a session did, read from git when it ends. From the first message Durbar sends in this run, main keeps a start (time,
 * start commit, whether the tree was clean); `summarize` compares the folder with it. Read-only: `git` runs with an argument array (no
 * shell), `--no-optional-locks`, the limits of spec 063; the only value that reaches an argument is a commit id that main itself read
 * and checked to be hex; `diff` runs with `--no-ext-diff --no-textconv`, so no diff helper configured for the folder runs. Nothing is stored on disk. A folder git says is not a repository is `{ repo: false }`; any other failure (a
 * timeout, output over the limit, git missing) is `{ repo: false, unreadable: true }`, never "not a git folder" and never an invented zero.
 */
import { nodeGitExec, parsePorcelainZ } from './gitstatus';
import type { GitExec } from './gitstatus';
import { cleanVendorStats } from '../adapters/vendorstats';
import type { VendorStats } from '../adapters/vendorstats';
import type { DaySum } from './summarydays';

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
  /** Untracked files could not be listed (for example more than the output limit): `newFiles` is 0 and not shown. */
  newFilesUnknown?: boolean;
}
export type SessionNoGit = { repo: false; unreadable?: true };
/** Spec 085 FR-010: what the agent app itself reported (counts only) and which app: its adapter id, never vendor text. */
export type ReportedStats = VendorStats & { source: string };
export type SessionSummary = { ok: true; ms: number; git: SessionNoGit | SessionGit; reported?: ReportedStats } | { ok: false; error: string };

/** Git said the folder is not a repository (its own message); anything else (timeout, size, git missing, another locale's words) is "could not read". */
export const isNotRepo = (e: unknown): boolean => /not a git repository/i.test(String((e as { message?: unknown } | undefined)?.message ?? e));
/** `rev-parse --verify -q HEAD` exits 1 with no output when there is no commit yet. */
const isNoHead = (e: unknown): boolean => (e as { code?: unknown } | undefined)?.code === 1;
const NOT_REPO: SessionNoGit = { repo: false };
const UNREADABLE: SessionNoGit = { repo: false, unreadable: true };

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

interface Start { at: number; ready: Promise<void>; git: 'repo' | 'none' | 'unreadable'; ref?: string; clean: boolean; noHead: boolean }

export class SessionStarts {
  private readonly starts = new Map<string, Start>();
  constructor(private readonly exec: GitExec = nodeGitExec, private readonly now: () => number = () => performance.now()) {}

  has(id: string): boolean {
    return this.starts.has(id);
  }

  /**
   * The first message of the session in this run; later calls return the same pending read. Two read-only calls run together, so the
   * first message waits for at most two git time limits (the runner's config read, then the call: 8 s): `status` without untracked file names (is the tree clean?) and
   * `rev-parse` (the start commit). Never throws. The start is stored at once with its pending read, and `summarize` waits for it, so
   * an End right after the first message never sees a half-read start.
   */
  noteStart(id: string, dir: string): Promise<void> {
    const old = this.starts.get(id);
    if (old) return old.ready;
    const s: Start = { at: this.now(), ready: Promise.resolve(), git: 'unreadable', clean: false, noHead: false };
    s.ready = (async () => {
      const [st, head] = await Promise.allSettled([
        this.exec(['-C', dir, 'status', '--porcelain=v1', '-z', '--untracked-files=normal']),
        this.exec(['-C', dir, 'rev-parse', '--verify', '-q', 'HEAD']),
      ]);
      if (st.status === 'rejected') { s.git = isNotRepo(st.reason) ? 'none' : 'unreadable'; return; }
      if (head.status === 'fulfilled') s.ref = validRef(head.value);
      else if (!isNoHead(head.reason)) { s.git = 'unreadable'; return; } // a timeout is not "no commit yet"
      s.noHead = !s.ref;
      s.clean = String(st.value) === '';
      s.git = 'repo';
    })().catch(() => { s.git = 'unreadable'; });
    this.starts.set(id, s);
    return s.ready;
  }

  forget(id: string): void {
    this.starts.delete(id);
  }

  async summarize(id: string, dir: string): Promise<SessionSummary> {
    const s = this.starts.get(id);
    if (!s) return { ok: false, error: 'This session has not been sent a message in this run.' };
    const ms = Math.max(0, Math.min(Math.round(this.now() - s.at), 366 * 24 * 3600 * 1000));
    await s.ready;
    if (s.git === 'none') return { ok: true, ms, git: NOT_REPO };
    if (s.git === 'unreadable') return { ok: true, ms, git: UNREADABLE };
    const ref = s.ref;
    const noDiff = Promise.resolve('');
    // the reads run together: the end waits for at most two git time limits (config read, then the call)
    const [stat, num, count, status] = await Promise.allSettled([
      ref ? this.exec(['-C', dir, 'diff', '--no-ext-diff', '--no-textconv', '--shortstat', ref, '--']) : noDiff, // no commit at the start: no base to compare with
      ref ? this.exec(['-C', dir, 'diff', '--no-ext-diff', '--no-textconv', '--numstat', ref, '--']) : noDiff,
      this.exec(['-C', dir, 'rev-list', '--count', ref ? `${ref}..HEAD` : 'HEAD']),
      s.clean ? this.exec(['-C', dir, 'status', '--porcelain=v1', '-z', '--untracked-files=all']) : noDiff,
    ]);
    // a folder still without a commit has no HEAD for `rev-list` either: that failure is "no commits", any other one is not a number to show
    for (const r of ref ? [stat, count] : [stat]) if (r.status === 'rejected') return { ok: true, ms, git: isNotRepo(r.reason) ? NOT_REPO : UNREADABLE };
    const v = (r: PromiseSettledResult<string>): string => (r.status === 'fulfilled' ? String(r.value) : '');
    const st = parseShortstat(v(stat));
    const bin = countBinary(v(num));
    const commits = parseCount(v(count));
    const newFiles = s.clean && status.status === 'fulfilled' ? Math.min(parsePorcelainZ(v(status)).files.filter((f) => f.state === 'untracked').length, MAX_COUNT) : 0;
    const files = s.noHead ? 0 : st.files;
    return {
      ok: true,
      ms,
      git: {
        repo: true, files, added: s.noHead ? 0 : st.added, removed: s.noHead ? 0 : st.removed, binary: Math.min(bin, files), newFiles, commits, dirtyAtStart: !s.clean,
        ...(s.noHead ? { noHead: true } : {}),
        ...(s.clean && status.status === 'rejected' ? { newFilesUnknown: true } : {}),
      },
    };
  }
}

/** The adapter's id as the window may see it: lower-case letters, digits and `-`, at most 20 characters; anything else is "agent". */
export const sourceId = (id: unknown): string => (typeof id === 'string' && /^[a-z0-9-]{1,20}$/.test(id) ? id : 'agent');

/**
 * Spec 085 FR-010: ask the adapter for its own totals. At most `limitMs` (a hang is "not reported"); a rejection, a missing method or an answer
 * with no usable count is `undefined`; every member is bounded again here whatever the adapter did. Never throws.
 */
export async function readReported(
  ad: { id: string; capabilities: { sessionStats?: boolean }; sessionStats?(id: string): Promise<unknown> } | undefined,
  sessionId: string,
  limitMs = 2000,
): Promise<ReportedStats | undefined> {
  if (!ad || ad.capabilities.sessionStats !== true || typeof ad.sessionStats !== 'function') return undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    const raw = await Promise.race([ad.sessionStats(sessionId), new Promise<undefined>((res) => { timer = setTimeout(() => res(undefined), limitMs); })]);
    const st = cleanVendorStats(raw);
    return st ? { source: sourceId(ad.id), ...st } : undefined;
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Durbar's own numbers of an ended session as the day rollup adds them (FR-009); a folder git could not read adds only the session and its minutes. */
export function dayNumbers(sum: SessionSummary): Partial<DaySum> | undefined {
  if (!sum.ok) return undefined;
  const base = { minutes: Math.floor(sum.ms / 60000) };
  const g = sum.git;
  return g.repo === true ? { ...base, files: g.files, added: g.added, removed: g.removed, commits: g.commits } : base;
}
