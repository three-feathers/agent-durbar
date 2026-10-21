/**
 * Spec 063: the git branch and uncommitted changes of a session's folder, read-only. `git` runs with argv only (no shell),
 * `--no-optional-locks` (no lock files, no index refresh written), 4 s and 512 KB per command, at most 200 files listed.
 * Any failure (no git, not a repository, a timeout) is `{ repo: false }`: the window then shows nothing extra.
 */
import { execFile } from 'child_process';

export type FileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';
export interface GitFile { path: string; state: FileState; added?: number; removed?: number; binary?: boolean }
export type GitStatus = { repo: false } | { repo: true; branch: string; detached?: boolean; ahead?: number; behind?: number; files: GitFile[]; more: number };

export const GIT_TIMEOUT_MS = 4000;
export const GIT_MAX_BYTES = 512 * 1024;
export const GIT_MAX_FILES = 200;

/** A path or branch fit to show: no control characters, at most 300 characters. */
const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 300);

function stateOf(x: string, y: string): FileState {
  if (x === '?' && y === '?') return 'untracked';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  if (x === 'R' || y === 'R' || x === 'C') return 'renamed';
  if (x === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  return 'modified';
}

/** `git status --porcelain=v1 --branch -z`: the `## branch...upstream [ahead N, behind M]` header, then `XY path` records (a rename has its old path as the next record). */
export function parsePorcelainZ(out: string): { branch: string; detached?: boolean; ahead?: number; behind?: number; files: GitFile[] } {
  const recs = out.split('\0');
  let branch = '';
  let detached: boolean | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  const files: GitFile[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!r) continue;
    if (r.startsWith('## ')) {
      const h = r.slice(3);
      if (/^HEAD \(no branch\)/.test(h) || h.startsWith('HEAD')) { detached = true; branch = 'HEAD'; continue; }
      const m = /^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(h);
      branch = clean(m ? m[1] : h);
      const a = m && m[3] ? /ahead (\d+)/.exec(m[3]) : null;
      const b = m && m[3] ? /behind (\d+)/.exec(m[3]) : null;
      if (a) ahead = Number(a[1]);
      if (b) behind = Number(b[1]);
      continue;
    }
    if (r.length < 4) continue;
    const x = r[0], y = r[1];
    const state = stateOf(x, y);
    files.push({ path: clean(r.slice(3)), state });
    if (state === 'renamed' || x === 'C') i++; // skip the old path of a rename or copy
  }
  return { branch, ...(detached ? { detached } : {}), ...(ahead ? { ahead } : {}), ...(behind ? { behind } : {}), files };
}

/** `git diff HEAD --numstat -z`: `added\tremoved\tpath` (binary: `-\t-`); a rename is `added\tremoved\t` then old and new path records. */
export function parseNumstatZ(out: string): Map<string, { added?: number; removed?: number; binary?: boolean }> {
  const m = new Map<string, { added?: number; removed?: number; binary?: boolean }>();
  const recs = out.split('\0');
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const t = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(r);
    if (!t) continue;
    let path = t[3];
    if (path === '') { i += 2; path = recs[i] ?? ''; } // rename: old path, new path
    const binary = t[1] === '-' && t[2] === '-';
    m.set(clean(path), binary ? { binary: true } : { added: Number(t[1]), removed: Number(t[2]) });
  }
  return m;
}

export type GitExec = (args: string[]) => Promise<string>;

/** The real runner: `git` from PATH, argv only, time and size limits, no optional locks. */
export const nodeGitExec: GitExec = (args) =>
  new Promise((resolve, reject) => {
    execFile('git', ['--no-optional-locks', ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BYTES, windowsHide: true, encoding: 'utf8' }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

export async function folderGitStatus(dir: string, exec: GitExec = nodeGitExec): Promise<GitStatus> {
  try {
    const st = parsePorcelainZ(await exec(['-C', dir, 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all']));
    if (!st.branch) return { repo: false };
    // line counts are best effort (a repository with no commit yet has no HEAD)
    const counts = await exec(['-C', dir, 'diff', 'HEAD', '--numstat', '-z']).then(parseNumstatZ, () => new Map());
    const files = st.files.map((f) => ({ ...f, ...(counts.get(f.path) ?? {}) }));
    return { repo: true, branch: st.branch, ...(st.detached ? { detached: true } : {}), ...(st.ahead ? { ahead: st.ahead } : {}), ...(st.behind ? { behind: st.behind } : {}), files: files.slice(0, GIT_MAX_FILES), more: Math.max(0, files.length - GIT_MAX_FILES) };
  } catch {
    return { repo: false };
  }
}
